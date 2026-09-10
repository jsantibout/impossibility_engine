import { err, ok, type Ability, type Result, type RollMode } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { parseNotation, type Rng } from './dice.js';
import {
  modifierFor,
  proficiencyBonus,
  type CharacterSheet,
} from './character.js';
import { characterRollModes, combineRollModes } from './checks.js';
import {
  rollD20Recorded,
  rollRecorded,
  type RecordedD20,
  type RollIssuer,
  type RollProvenance,
} from './rolls.js';

/**
 * Attack rolls and weapon damage — the third D20 Test, and the only one where
 * a natural 20 or natural 1 decides the outcome by itself.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export interface AttackOptions {
  /** The weapon used, or null for an Unarmed Strike. */
  readonly weapon: Weapon | null;
  readonly targetAc: number;
  /** Whether the attacker is proficient. Defaults to true. */
  readonly proficient?: boolean;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /** Which ability to use on a Finesse weapon. Defaults to the better one. */
  readonly finesseAbility?: 'str' | 'dex';
  /** Situational advantage or disadvantage from the fiction. */
  readonly modes?: readonly RollMode[];
  readonly beyondNormalRange?: boolean;
  /** An enemy is within 5 feet, which hampers a ranged attack. */
  readonly nearbyEnemy?: boolean;
}

const has = (weapon: Weapon | null, property: string): boolean =>
  weapon?.properties.some((p) => p === property) === true;

/** A ranged attack: a ranged weapon, or a melee weapon being thrown. */
function isRangedAttack(options: AttackOptions): boolean {
  return options.weapon?.kind === 'ranged' || options.thrown === true;
}

/**
 * SRD "Attack Roll Abilities": Strength for a melee weapon or Unarmed Strike,
 * Dexterity for a ranged weapon.
 *
 * Finesse lets you choose between them — and Thrown keeps a melee weapon on its
 * melee ability, so a thrown Dagger is still Finesse rather than automatically
 * Dexterity.
 */
export function attackAbility(sheet: CharacterSheet, options: AttackOptions): Ability {
  const weapon = options.weapon;

  if (has(weapon, 'finesse')) {
    if (options.finesseAbility !== undefined) return options.finesseAbility;
    // SRD leaves the choice to the player; default to whichever is better.
    return modifierFor(sheet, 'dex') > modifierFor(sheet, 'str') ? 'dex' : 'str';
  }

  return weapon?.kind === 'ranged' ? 'dex' : 'str';
}

/**
 * SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
 * plus your Proficiency Bonus" — there is no unproficient unarmed strike.
 */
export function attackModifier(sheet: CharacterSheet, options: AttackOptions): number {
  const ability = attackAbility(sheet, options);
  const proficient = options.weapon === null || (options.proficient ?? true);
  return modifierFor(sheet, ability) + (proficient ? proficiencyBonus(sheet) : 0);
}

export function attackRollModes(sheet: CharacterSheet, options: AttackOptions): RollMode[] {
  const modes: RollMode[] = [];
  const weapon = options.weapon;
  const ability = attackAbility(sheet, options);

  // SRD Heavy: Disadvantage if it's a Melee weapon and Strength isn't at least
  // 13, or a Ranged weapon and Dexterity isn't at least 13. Note this reads the
  // *score*, not the modifier — 12 and 13 share a +1 but differ here.
  if (has(weapon, 'heavy') && weapon !== null) {
    const required = weapon.kind === 'melee' ? 'str' : 'dex';
    if (sheet.abilities[required] < 13) modes.push('disadvantage');
  }

  // SRD: "Your attack roll has Disadvantage when your target is beyond normal
  // range" — and beyond long range it is not a legal attack at all, which is
  // the caller's check to make.
  if (options.beyondNormalRange === true) modes.push('disadvantage');

  // SRD: a ranged attack has Disadvantage within 5 feet of a capable enemy.
  if (options.nearbyEnemy === true && isRangedAttack(options)) modes.push('disadvantage');

  // Untrained armour hampers any Strength or Dexterity D20 Test, attacks
  // included.
  modes.push(...characterRollModes(sheet, ability, null));

  return modes;
}

export interface AttackResult {
  readonly ability: Ability;
  readonly mode: RollMode;
  readonly roll: RecordedD20;
  readonly targetAc: number;
  readonly hit: boolean;
  readonly critical: boolean;
}

export function rollAttack(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
): AttackResult {
  const ability = attackAbility(sheet, options);
  const mode = combineRollModes([...attackRollModes(sheet, options), ...(options.modes ?? [])]);
  const roll = rollD20Recorded(issuer, rng, mode, attackModifier(sheet, options));

  // SRD "Rolling 20 or 1": a natural 20 hits regardless of modifiers or AC, and
  // a natural 1 misses regardless. This is the one D20 Test where the die face
  // overrides the total.
  const hit = roll.isCriticalHit || (!roll.isCriticalMiss && roll.total >= options.targetAc);

  return {
    ability,
    mode,
    roll,
    targetAc: options.targetAc,
    hit,
    critical: roll.isCriticalHit,
  };
}

export interface AttackDamage {
  readonly type: string;
  /** The dice rolled, or null when the damage is a flat amount. */
  readonly notation: string | null;
  readonly diceTotal: number;
  readonly modifier: number;
  readonly total: number;
  readonly critical: boolean;
  readonly provenance: RollProvenance;
}

/** SRD Unarmed Strike damage: 1 Bludgeoning plus the Strength modifier. */
const UNARMED_DAMAGE = { fixed: 1, type: 'bludgeoning' } as const;

export function rollAttackDamage(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
  critical: boolean,
): Result<AttackDamage> {
  const weapon = options.weapon;
  const modifier = modifierFor(sheet, attackAbility(sheet, options));

  // SRD Versatile: the parenthesised die applies when used with two hands.
  const dice =
    weapon === null
      ? null
      : options.twoHanded === true && weapon.versatileDamage !== null
        ? weapon.versatileDamage
        : weapon.damage.dice;

  const type = weapon === null ? UNARMED_DAMAGE.type : weapon.damage.type;
  const fixed = weapon === null ? UNARMED_DAMAGE.fixed : weapon.damage.fixed;

  // Flat damage — the Blowgun, and Unarmed Strikes. There are no dice to roll,
  // so a critical hit has nothing to double.
  if (dice === null) {
    if (fixed === null) {
      return err('no_damage', `${weapon?.name ?? 'attack'} has neither damage dice nor a flat amount`);
    }
    return ok({
      type,
      notation: null,
      diceTotal: fixed,
      modifier,
      total: Math.max(0, fixed + modifier),
      critical,
      provenance: issuer.issue('engine'),
    });
  }

  const parsed = parseNotation(dice);
  if (!parsed.ok) return parsed;

  // SRD Critical Hits: "Roll the attack's damage dice twice, add them together,
  // and add any relevant modifiers as normal." The dice double; the modifier
  // does not.
  const count = critical ? parsed.value.count * 2 : parsed.value.count;
  const outcome = rollRecorded(issuer, rng, `${count}d${parsed.value.sides}`);
  if (!outcome.ok) return outcome;

  const diceTotal = outcome.value.total;

  return ok({
    type,
    notation: dice,
    diceTotal,
    modifier,
    total: Math.max(0, diceTotal + modifier),
    critical,
    provenance: outcome.value.provenance,
  });
}

export interface DamageDefenses {
  readonly immune?: boolean;
  readonly resistant?: boolean;
  readonly vulnerable?: boolean;
}

/**
 * SRD "Order of Application": adjustments such as bonuses, penalties or
 * multipliers first; Resistance second; Vulnerability third.
 *
 * The order is load-bearing. The SRD's own example: 28 Fire damage, an aura
 * reducing damage by 5, Resistance to all damage and Vulnerability to Fire —
 * reduced to 23, halved to 11, doubled to 22. Doubling before halving gives 23
 * instead, and halving a doubled number loses the rounding step entirely.
 *
 * Resistance and Vulnerability are booleans rather than counts because the SRD
 * says multiple instances affecting the same damage type count as only one.
 */
export function applyDefenses(
  amount: number,
  defenses: DamageDefenses,
  adjustment = 0,
): number {
  if (defenses.immune === true) return 0;

  let damage = Math.max(0, amount + adjustment);
  if (defenses.resistant === true) damage = Math.floor(damage / 2);
  if (defenses.vulnerable === true) damage = damage * 2;

  return damage;
}
