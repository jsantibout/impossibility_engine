import { err, ok, type Ability, type Result, type RollMode } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { parseNotation, type DieEffect, type Rng } from './dice.js';
import { modifierFor, proficiencyBonus, type CharacterSheet } from './character.js';
import { characterRollModes, combineRollModes } from './checks.js';
import {
  flatBonusTotal,
  rollBonusDice,
  sumResolved,
  validateBonusDice,
  type Bonus,
  type ModeSource,
  type ResolvedBonus,
} from './bonuses.js';
import {
  attackerConditionModes,
  exhaustionBonus,
  isAutomaticCritical,
  targetConditionModes,
  type AttackerContext,
  type ConditionState,
  type TargetContext,
} from './conditions.js';
import {
  rollD20Recorded,
  rollRecorded,
  type RecordedD20,
  type RecordedRoll,
  type RollIssuer,
} from './rolls.js';

/**
 * Attack rolls and weapon damage — the third D20 Test, and the only one where
 * a natural 20 or natural 1 decides the outcome by itself.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

/**
 * Damage of a *different* type riding along with an attack.
 *
 * Flame Tongue deals "an extra 2d6 Fire damage" on top of the weapon's own
 * damage, and resistance applies per type — so this cannot be folded into the
 * weapon's damage without giving a fire-immune target the wrong answer.
 */
export interface ExtraDamage {
  readonly source: string;
  readonly type: string;
  readonly dice?: string;
  readonly flat?: number;
}

/**
 * Whether a character is proficient with this weapon.
 *
 * SRD gives four shapes and the last two are easy to flatten into "martial":
 *
 * | Class text | Category |
 * |---|---|
 * | "Simple weapons" | `simple` |
 * | "Simple and Martial weapons" | `martial` |
 * | "Martial weapons that have the Light property" (Monk) | `martial-light` |
 * | "Martial weapons that have the Finesse or Light property" (Rogue) | `martial-finesse-or-light` |
 *
 * A sheet that names no categories is proficient with everything, which is the
 * right answer for a stat block: a monster prints its attack bonus rather than
 * deriving one, so withholding a Proficiency Bonus from it would change a
 * number the block already stated.
 */
export function proficientWith(sheet: CharacterSheet, weapon: Weapon | null): boolean {
  const categories = sheet.weaponProficiencies;
  // SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
  // plus your Proficiency Bonus" — there is no unproficient Unarmed Strike.
  if (weapon === null || categories === undefined) return true;

  const light = weapon.properties.includes('light');
  const finesse = weapon.properties.includes('finesse');

  return categories.some((category) => {
    switch (category) {
      case 'simple':
        return weapon.category === 'simple';
      case 'martial':
        return weapon.category === 'martial';
      case 'martial-light':
        return weapon.category === 'martial' && light;
      case 'martial-finesse-or-light':
        return weapon.category === 'martial' && (finesse || light);
      default:
        return false;
    }
  });
}

/**
 * How far this weapon reaches in melee, in feet.
 *
 * SRD Reach: "This weapon adds 5 feet to your reach when you attack with it."
 * Everything else, an Unarmed Strike included, reaches five.
 */
export function meleeReach(weapon: Weapon | null): number {
  return weapon?.properties.includes('reach') === true ? 10 : 5;
}

/**
 * The normal and long range of a ranged attack, or null for a melee one.
 *
 * A Thrown melee weapon uses its Thrown range; an Ammunition weapon uses its
 * own. A weapon that is neither is not making a ranged attack.
 */
export function rangeOf(
  weapon: Weapon | null,
  thrown: boolean,
): { readonly normal: number; readonly long: number } | null {
  if (weapon === null) return null;
  if (thrown) return weapon.thrownRange;
  return weapon.kind === 'ranged' ? weapon.ammunitionRange : null;
}

export interface AttackOptions {
  /** The weapon used, or null for an Unarmed Strike. */
  readonly weapon: Weapon | null;
  readonly targetAc: number;
  /**
   * The lowest natural d20 that scores a Critical Hit. 20 unless a feature
   * lowers it — SRD Improved Critical and Superior Critical are the two that
   * do. Read off the attacker's sheet by `resolveAttack`.
   */
  readonly criticalOn?: number;
  /** Whether the attacker is proficient. Defaults to true. */
  readonly proficient?: boolean;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /** Which ability to use on a Finesse weapon. Defaults to the better one. */
  readonly finesseAbility?: 'str' | 'dex';
  /** Situational advantage or disadvantage from the fiction. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  readonly beyondNormalRange?: boolean;
  /** An enemy is within 5 feet, which hampers a ranged attack. */
  readonly nearbyEnemy?: boolean;
  /** Modifiers to the attack roll: a magic weapon, Archery, Bless. */
  readonly attackBonuses?: readonly Bonus[];
  /** Modifiers to damage *of the weapon's own type*: a magic weapon, Dueling. */
  readonly damageBonuses?: readonly Bonus[];
  /** Damage of other types: Flame Tongue's fire, a Divine Smite's radiant. */
  readonly extraDamage?: readonly ExtraDamage[];
  /**
   * Per-die rules applied to damage rolls — Great Weapon Fighting, and anything
   * else that reads or reacts to an individual die.
   */
  readonly damageEffects?: readonly DieEffect[];
  /** The attacker's own conditions: Blinded, Poisoned, Prone, Invisible. */
  readonly attackerConditions?: ConditionState;
  /** The target's conditions: Prone, Restrained, Paralyzed, Invisible. */
  readonly targetConditions?: ConditionState;
  readonly attackerContext?: AttackerContext;
  readonly targetContext?: TargetContext;
  /** The attacker is within 5 feet — flips Prone, and enables automatic crits. */
  readonly withinFiveFeet?: boolean;
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
 * The flat part of the attack roll: ability, proficiency, and every flat bonus.
 * Dice bonuses such as Bless are rolled separately by {@link rollAttack}.
 *
 * SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
 * plus your Proficiency Bonus" — there is no unproficient unarmed strike.
 */
export function attackModifier(sheet: CharacterSheet, options: AttackOptions): number {
  const ability = attackAbility(sheet, options);
  const proficient = options.weapon === null || (options.proficient ?? true);
  const exhaustion =
    options.attackerConditions === undefined ? null : exhaustionBonus(options.attackerConditions);
  return (
    modifierFor(sheet, ability) +
    (proficient ? proficiencyBonus(sheet) : 0) +
    flatBonusTotal(options.attackBonuses) +
    (exhaustion?.flat ?? 0)
  );
}

export function attackRollModes(sheet: CharacterSheet, options: AttackOptions): ModeSource[] {
  const modes: ModeSource[] = [];
  const weapon = options.weapon;
  const ability = attackAbility(sheet, options);

  // SRD Heavy: Disadvantage if it's a Melee weapon and Strength isn't at least
  // 13, or a Ranged weapon and Dexterity isn't at least 13. Note this reads the
  // *score*, not the modifier — 12 and 13 share a +1 but differ here.
  if (has(weapon, 'heavy') && weapon !== null) {
    const required = weapon.kind === 'melee' ? 'str' : 'dex';
    if (sheet.abilities[required] < 13) {
      modes.push({ source: `${weapon.name} is Heavy`, mode: 'disadvantage' });
    }
  }

  // SRD: "Your attack roll has Disadvantage when your target is beyond normal
  // range" — and beyond long range it is not a legal attack at all, which is
  // the caller's check to make.
  if (options.beyondNormalRange === true) {
    modes.push({ source: 'beyond normal range', mode: 'disadvantage' });
  }

  // SRD: a ranged attack has Disadvantage within 5 feet of a capable enemy.
  if (options.nearbyEnemy === true && isRangedAttack(options)) {
    modes.push({ source: 'enemy within 5 feet', mode: 'disadvantage' });
  }

  // Untrained armour hampers any Strength or Dexterity D20 Test, attacks
  // included.
  modes.push(...characterRollModes(sheet, ability, null));

  // Conditions on both sides of the attack.
  const targetContext: TargetContext = {
    ...options.targetContext,
    ...(options.withinFiveFeet === undefined ? {} : { withinFiveFeet: options.withinFiveFeet }),
  };
  if (options.attackerConditions !== undefined) {
    modes.push(...attackerConditionModes(options.attackerConditions, options.attackerContext ?? {}));
  }
  if (options.targetConditions !== undefined) {
    modes.push(...targetConditionModes(options.targetConditions, targetContext));
  }

  return modes;
}

export interface AttackResult {
  readonly ability: Ability;
  readonly mode: RollMode;
  readonly roll: RecordedD20;
  /** Bonuses that rolled dice, e.g. Bless. Flat bonuses are already in `roll`. */
  readonly bonuses: readonly ResolvedBonus[];
  /** The d20 result plus every bonus — what is actually compared to AC. */
  readonly total: number;
  readonly targetAc: number;
  readonly hit: boolean;
  readonly critical: boolean;
}

export function rollAttack(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
): Result<AttackResult> {
  // Validate before rolling: a malformed bonus must not leave the generator
  // advanced and a roll id consumed behind a returned error.
  const valid = validateBonusDice(options.attackBonuses);
  if (!valid.ok) return valid;

  const ability = attackAbility(sheet, options);
  const mode = combineRollModes([...attackRollModes(sheet, options), ...(options.modes ?? [])]);

  // Flat bonuses ride on the d20's own modifier; dice bonuses are rolled after.
  const roll = rollD20Recorded(issuer, rng, mode, attackModifier(sheet, options));

  const bonuses = rollBonusDice(issuer, rng, options.attackBonuses);
  if (!bonuses.ok) return bonuses;

  const total = roll.total + sumResolved(bonuses.value);

  // SRD "Rolling 20 or 1": a natural 20 hits regardless of modifiers or AC, and
  // a natural 1 misses regardless. This is the one D20 Test where the die face
  // overrides the total.
  //
  // A feature may lower which face scores a Critical Hit — SRD Improved
  // Critical: "can score a Critical Hit on a roll of 19 or 20" — and the
  // auto-hit follows it rather than staying pinned to the number 20. The
  // glossary binds the two in one sentence: "you score a Critical Hit, **and
  // the attack hits** regardless of any modifiers or the target's AC." So a
  // Champion's 19 hits an Armour Class it could not otherwise reach.
  //
  // A natural 1 is untouched. No SRD feature raises the miss face, and the
  // sentence that sets it names the number rather than a rule.
  const criticalOn = options.criticalOn ?? 20;
  const naturalCritical = roll.natural >= criticalOn && !roll.isCriticalMiss;
  const hit = naturalCritical || (!roll.isCriticalMiss && total >= options.targetAc);

  // SRD Paralyzed and Unconscious: "Any attack roll that hits you is a Critical
  // Hit if the attacker is within 5 feet of you." A hit that was not a natural
  // 20 still becomes a critical.
  const automaticCritical =
    hit &&
    options.targetConditions !== undefined &&
    isAutomaticCritical(options.targetConditions, options.withinFiveFeet === true);

  return ok({
    ability,
    mode,
    roll,
    bonuses: bonuses.value,
    total,
    targetAc: options.targetAc,
    hit,
    critical: naturalCritical || automaticCritical,
  });
}

/** One typed slice of an attack's damage. */
export interface DamageComponent {
  /** Where it came from: the weapon, "Flame Tongue", "Dueling". */
  readonly source: string;
  readonly type: string;
  readonly roll: RecordedRoll | null;
  readonly flat: number;
  readonly total: number;
}

/**
 * Damage taken away after the roll, by something like Cutting Words.
 *
 * Kept alongside the components rather than folded into them, because the
 * reduction is not damage of any type — subtracting it from the slashing
 * component would make a fire-immune target's arithmetic wrong.
 */
export interface DamageReduction {
  readonly source: string;
  readonly roll: RecordedRoll | null;
  readonly amount: number;
}

export interface AttackDamage {
  /**
   * Damage broken out by type and source. Resistance applies per type, so a
   * flaming sword against a fire-immune target still deals its slashing.
   */
  readonly components: readonly DamageComponent[];
  readonly critical: boolean;
  /** Reductions applied after the roll, e.g. Cutting Words. */
  readonly reductions: readonly DamageReduction[];
  /** Sum of every component less any reductions, before the target's defences. */
  readonly total: number;
}

/** SRD Unarmed Strike damage: 1 Bludgeoning plus the Strength modifier. */
const UNARMED_DAMAGE = { fixed: 1, type: 'bludgeoning' } as const;

/**
 * SRD Critical Hits: "Roll the attack's damage dice twice ... If the attack
 * involves other damage dice, such as from the Rogue's Sneak Attack feature,
 * you also roll those dice twice." Every damage die doubles; flat modifiers do
 * not.
 */
function doubledOnCrit(notation: string, critical: boolean): Result<string> {
  const parsed = parseNotation(notation);
  if (!parsed.ok) return parsed;
  const count = critical ? parsed.value.count * 2 : parsed.value.count;
  return ok(`${count}d${parsed.value.sides}`);
}

export function rollAttackDamage(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  options: AttackOptions,
  critical: boolean,
): Result<AttackDamage> {
  const weapon = options.weapon;

  // Every notation in play — the weapon's, each bonus's, each extra damage —
  // is checked before a single die is thrown.
  const valid = validateBonusDice([
    ...(options.damageBonuses ?? []),
    ...(options.extraDamage ?? []).map((e) => ({ source: e.source, ...(e.dice === undefined ? {} : { dice: e.dice }) })),
  ]);
  if (!valid.ok) return valid;

  const effects = options.damageEffects ?? [];
  const modifier = modifierFor(sheet, attackAbility(sheet, options));
  const components: DamageComponent[] = [];

  // SRD Versatile: the parenthesised die applies when used with two hands.
  const dice =
    weapon === null
      ? null
      : options.twoHanded === true && weapon.versatileDamage !== null
        ? weapon.versatileDamage
        : weapon.damage.dice;

  const type = weapon === null ? UNARMED_DAMAGE.type : weapon.damage.type;
  const fixed = weapon === null ? UNARMED_DAMAGE.fixed : weapon.damage.fixed;
  const source = weapon?.name ?? 'Unarmed Strike';

  // The weapon's own damage, carrying the ability modifier.
  if (dice === null) {
    // Flat damage — the Blowgun, and Unarmed Strikes. No dice to double.
    if (fixed === null) {
      return err('no_damage', `${source} has neither damage dice nor a flat amount`);
    }
    components.push({
      source,
      type,
      roll: null,
      flat: fixed + modifier,
      total: fixed + modifier,
    });
  } else {
    const notation = doubledOnCrit(dice, critical);
    if (!notation.ok) return notation;
    const outcome = rollRecorded(issuer, rng, notation.value, effects);
    if (!outcome.ok) return outcome;
    components.push({
      source,
      type,
      roll: outcome.value,
      flat: modifier,
      total: outcome.value.total + modifier,
    });
  }

  // Bonuses to the weapon's own damage type: a +1 weapon, Dueling, Rage.
  for (const bonus of options.damageBonuses ?? []) {
    let roll: RecordedRoll | null = null;
    if (bonus.dice !== undefined) {
      const notation = doubledOnCrit(bonus.dice, critical);
      if (!notation.ok) return notation;
      const outcome = rollRecorded(issuer, rng, notation.value, effects);
      if (!outcome.ok) return outcome;
      roll = outcome.value;
    }
    const flat = bonus.flat ?? 0;
    components.push({
      source: bonus.source,
      type,
      roll,
      flat,
      total: (roll?.total ?? 0) + flat,
    });
  }

  // Damage of other types, which must stay separate for resistance.
  for (const extra of options.extraDamage ?? []) {
    let roll: RecordedRoll | null = null;
    if (extra.dice !== undefined) {
      const notation = doubledOnCrit(extra.dice, critical);
      if (!notation.ok) return notation;
      const outcome = rollRecorded(issuer, rng, notation.value, effects);
      if (!outcome.ok) return outcome;
      roll = outcome.value;
    }
    const flat = extra.flat ?? 0;
    components.push({
      source: extra.source,
      type: extra.type,
      roll,
      flat,
      total: (roll?.total ?? 0) + flat,
    });
  }

  const total = components.reduce((sum, c) => sum + Math.max(0, c.total), 0);

  return ok({ components, critical, reductions: [], total });
}

/**
 * Take damage away after it has been rolled.
 *
 * SRD Cutting Words: "when a creature ... makes a damage roll ... roll your
 * Bardic Inspiration die, and subtract the number rolled from the creature's
 * roll, **reducing the damage**". So this is not only a d20-test effect — the
 * same Reaction can blunt a hit that has already landed.
 *
 * The reduction comes off the total rather than off a component, because it is
 * not damage of any type. Subtracting it from the slashing half of a flaming
 * sword would give a fire-immune target the wrong answer, which is the exact
 * error typed components exist to prevent.
 */
export function reduceDamage(
  issuer: RollIssuer,
  rng: Rng,
  damage: AttackDamage,
  reduction: { readonly source: string; readonly flat?: number; readonly dice?: string },
): Result<AttackDamage> {
  const rolled = rollBonusDice(issuer, rng, [reduction]);
  if (!rolled.ok) return rolled;

  const amount = (reduction.flat ?? 0) + sumResolved(rolled.value);
  const applied: DamageReduction = {
    source: reduction.source,
    roll: rolled.value[0]?.roll ?? null,
    amount,
  };

  return ok({
    ...damage,
    reductions: [...damage.reductions, applied],
    // Damage never goes below zero, however much is subtracted.
    total: Math.max(0, damage.total - amount),
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
export function applyDefenses(amount: number, defenses: DamageDefenses, adjustment = 0): number {
  if (defenses.immune === true) return 0;

  let damage = Math.max(0, amount + adjustment);
  if (defenses.resistant === true) damage = Math.floor(damage / 2);
  if (defenses.vulnerable === true) damage = damage * 2;

  return damage;
}

export interface AppliedDamage {
  /** What actually landed, per damage type, after defences. */
  readonly byType: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * Apply a target's defences to multi-type damage.
 *
 * Components are summed per type first and the defences applied once per type,
 * because Resistance halves *an instance of damage of that type* — halving each
 * component separately would round down repeatedly and undercount.
 */
export function applyDamage(
  components: readonly DamageComponent[],
  defenses: Readonly<Record<string, DamageDefenses>>,
  adjustments: Readonly<Record<string, number>> = {},
): AppliedDamage {
  const rawByType = new Map<string, number>();
  for (const component of components) {
    rawByType.set(component.type, (rawByType.get(component.type) ?? 0) + Math.max(0, component.total));
  }

  const byType: Record<string, number> = {};
  let total = 0;
  for (const [type, raw] of rawByType) {
    const applied = applyDefenses(raw, defenses[type] ?? {}, adjustments[type] ?? 0);
    byType[type] = applied;
    total += applied;
  }

  return { byType, total };
}
