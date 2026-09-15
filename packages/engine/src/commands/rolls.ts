/**
 * The rolls a command makes on a creature's behalf, and what they gather first.
 *
 * `savingSupport` is the reason this is a module: three separate domains roll
 * a saving throw — a casting's Concentration check, a D20 Test a DM calls for,
 * the save a turn boundary owes — and every one of them has to gather the same
 * three sources of bonus and mode before the die is thrown. One gatherer, or
 * three places for a stored Bless to be forgotten.
 */

import {
  type Ability,
  ABILITY_NAMES,
  type CharacterId,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { type DamageComponent, rollAttackDamage } from '../attack.js';
import { type Bonus, bonusesFor, flatBonusTotal, type ModeSource } from '../bonuses.js';
import { type CharacterSheet } from '../character.js';
import { type D20TestResult, skillName } from '../checks.js';
import { type ConditionState } from '../conditions.js';
import { type EffectCheck } from '../duration.js';
import { type CreatureState, type GameEvent, type GameState } from '../events.js';
import { sightBetween } from '../positioning.js';
import { type SpellCheck } from '../spell-definitions.js';
import {
  effectiveConditions,
  rollModesFor,
  standingBonuses,
  standingSaveBonuses,
} from '../standing.js';
import { type Supply } from './casting.js';

/**
 * Turn a completed D20 test into the log's record of it.
 *
 * `roll-recorded` changes no state; it exists so the log can say why a number
 * was what it was. Every named contribution goes in, including ones that
 * subtracted, so a normal-looking total can still explain itself.
 */
export function recordD20Test(
  who: CharacterId,
  label: string,
  result: D20TestResult,
  outcome?: string,
): GameEvent {
  return {
    type: 'roll-recorded',
    who,
    label,
    natural: result.natural,
    total: result.total,
    contributions: [
      // What is left of the modifier once every named flat bonus inside it has
      // been named: the ability, the proficiency, and whatever else the sheet
      // contributed. The named ones follow, so the sum is unchanged and a +1
      // Longsword or an Aura of Protection reads as itself rather than as a
      // bigger number nobody can account for.
      { source: 'modifier', amount: result.modifier - flatBonusTotal(result.flatBonuses) },
      ...result.flatBonuses.map((bonus) => ({ source: bonus.source, amount: bonus.flat ?? 0 })),
      ...result.bonuses.map((bonus) => ({ source: bonus.source, amount: bonus.total })),
    ],
    ...(outcome === undefined ? {} : { outcome }),
  };
}

/**
 * Roll a spell's dice, with no weapon and no ability modifier attached.
 *
 * `rollAttackDamage` is the engine's one damage roller and it is built around
 * a weapon, so a spell borrows it with `weapon: null` and its own dice as
 * `extraDamage`, then keeps only its own components. The Unarmed Strike the
 * weaponless branch contributes is flat, so nothing is rolled for it and the
 * generator does not move — but it would be in the total, which is why the
 * filter is here rather than at each call site.
 */
/**
 * Fold a spell's printed flat addend into what its dice rolled.
 *
 * SRD prints two of these — Finger of Death's "7d8 + 30" and Disintegrate's
 * "10d6 + 40" — and the number is part of the damage rather than a separate
 * effect. `DiceScaling` carried it from the start and nothing on this path
 * read it, so both spells rolled their dice and silently dropped the addend.
 *
 * It lands once, on the first component, and it does **not** double on a
 * critical: "roll the attack's damage dice twice, add them together, and add
 * any relevant modifiers as normal."
 */
export function withFlatAddend(
  components: readonly DamageComponent[],
  addend: number,
): readonly DamageComponent[] {
  if (addend === 0 || components.length === 0) return components;
  const [first, ...rest] = components as readonly [DamageComponent, ...DamageComponent[]];
  return [{ ...first, flat: first.flat + addend, total: first.total + addend }, ...rest];
}

export function rollSpellDice(
  supply: Supply,
  sheet: CharacterSheet,
  source: string,
  type: string,
  dice: string,
): Result<readonly DamageComponent[]> {
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    sheet,
    { weapon: null, targetAc: 0, extraDamage: [{ source, type, dice }] },
    false,
  );
  if (!rolled.ok) return rolled;
  return ok(rolled.value.components.filter((component) => component.source === source));
}

/**
 * Everything that applies to a creature's saving throw, gathered in one place.
 *
 * Same rule as Alert on Initiative: a modifier somebody has to remember is a
 * modifier a character silently stops having. Three sources, and they arrive
 * by three different routes:
 *
 * - **Stored** on the creature, by a spell that hung it there — Bless, Bane.
 * - **Standing**, from a class feature, derived from the state of the world at
 *   this instant — Aura of Protection, Danger Sense. Nothing stores these,
 *   because whether they apply changes when somebody walks away.
 * - **Supplied** by the caller, for whatever the engine cannot see.
 *
 * Deduplicated by source, so a helpful caller passing Bless as well does not
 * apply it twice. The conditions come back too: a feature can say a condition
 * has no effect on this creature right now, and every roll that reads
 * conditions has to read that instead.
 */
export function savingSupport(
  state: GameState,
  who: CharacterId,
  victim: CreatureState,
  ability: Ability,
  supply: {
    readonly bonuses?: readonly Bonus[] | undefined;
    readonly modes?: readonly (RollMode | ModeSource)[] | undefined;
  },
): {
  readonly bonuses: readonly Bonus[];
  readonly modes: readonly (RollMode | ModeSource)[];
  readonly conditions: ConditionState;
} {
  const merged = new Map<string, Bonus>();
  for (const bonus of bonusesFor(victim.bonuses, 'save')) merged.set(bonus.source, bonus);
  for (const bonus of standingSaveBonuses(state, who, ability)) merged.set(bonus.source, bonus);
  // And the flat half: a Ring of Protection's "+1 bonus to ... saving throws".
  // No narrowing is offered because a saving throw is not made *with* anything,
  // which is the pairing `checkContent` refuses outright.
  for (const bonus of standingBonuses(state, who, 'save')) merged.set(bonus.source, bonus);
  for (const bonus of supply.bonuses ?? []) merged.set(bonus.source, bonus);

  // A bare RollMode has no source to deduplicate on, so it rides through as
  // given; a ModeSource is keyed, which is what stops a caller who also knows
  // about Danger Sense applying it twice.
  const named = new Map<string, ModeSource>();
  const bare: RollMode[] = [];
  for (const mode of rollModesFor(state, { family: 'saving-throw', roller: who, ability }).modes) {
    named.set(mode.source, mode);
  }
  for (const mode of supply.modes ?? []) {
    if (typeof mode === 'string') bare.push(mode);
    else named.set(mode.source, mode);
  }

  return {
    bonuses: [...merged.values()],
    modes: [...bare, ...named.values()],
    conditions: effectiveConditions(state, who),
  };
}

/**
 * The flat bonuses standing on a creature that reach an ability check.
 *
 * {@link savingSupport}'s thin counterpart, and thin for a reason: a saving
 * throw has one command behind it and an ability check has four, each
 * gathering its own modes from its own question. What they all lacked was the
 * *bonuses* — a Stone of Good Luck's "+1 bonus to ability checks" reached none
 * of them — so this is the one place that answer is worked out, rather than
 * four places that could come to disagree.
 *
 * Deduplicated by source and the caller's copy wins, exactly as
 * {@link savingSupport} merges, so a DM who also knows about the stone does not
 * apply it twice.
 *
 * Initiative is one of the four: SRD makes it an ability check, which is why
 * "a magic item's bonus applies" to it and why `rollInitiativeFor` asks here.
 *
 * No narrowing is offered. An ability check is not made *with* an object the
 * way an attack is — the SRD's tool bonuses are worded as the character's, not
 * the tool's — and `checkContent` refuses the pairing outright.
 */
export function checkBonuses(
  state: GameState,
  who: CharacterId,
  supplied: readonly Bonus[] | undefined,
): readonly Bonus[] {
  const standing = standingBonuses(state, who, 'ability-check');
  if (standing.length === 0) return supplied ?? [];

  const merged = new Map<string, Bonus>();
  for (const bonus of standing) merged.set(bonus.source, bonus);
  for (const bonus of supplied ?? []) merged.set(bonus.source, bonus);
  return [...merged.values()];
}

/**
 * Every standing mode that reaches an attack roll, gathered from both ends.
 *
 * **SRD Dodge says "any attack roll made against you"; it does not say "with a
 * weapon."** Blur writes the same sentence. `resolveAttack` read the
 * defender's standing effects and the spell attack inside `resolveEffects`
 * read nothing about the defender at all, so a **Dodging creature was easier
 * to hit with a Fire Bolt than with a club** — silently, because each path was
 * correct on its own terms.
 *
 * One gatherer for both, because two copies of this block is exactly how that
 * fork came about, and splitting the command layer by domain put the copies in
 * different modules — where neither author would see the other.
 *
 * The sight clause is the **target's** view of the attacker, not the
 * attacker's of the target, and a scene nobody has set is `null` rather than
 * `false`: undeclared is not the same as blind.
 */
export function defendingModes(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  return rollModesFor(
    state,
    { family: 'attack', roller: attacker, against: target },
    { seenByHolder: state.scene === null ? null : sightBetween(state.scene, target, attacker) },
  );
}

/**
 * Turn a definition's check into the one the timer will carry.
 *
 * The DC is the caster's spell save DC unless the SRD prints a number, and the
 * label is derived rather than transcribed so that thirty definitions cannot
 * disagree about how a roll reads in the log.
 */
export function effectCheckFrom(
  check: SpellCheck | undefined,
  spell: string,
  saveDc: number,
): EffectCheck | undefined {
  if (check === undefined) return undefined;
  return {
    ability: check.ability,
    ...(check.skill === undefined ? {} : { skill: check.skill }),
    dc: check.dc ?? saveDc,
    onSuccess: check.onSuccess,
    label: `${ABILITY_NAMES[check.ability]}${check.skill === undefined ? '' : ` (${skillName(check.skill)})`} check vs ${spell}`,
  };
}

