import { ok, type Ability, type Result, type RollMode, type Skill } from '@ie/shared';
import type { Rng } from './dice.js';
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
  modifierFor,
  saveModifier,
  skillModifier,
  untrainedArmorPenalty,
  type CharacterSheet,
} from './character.js';
import { rollD20Recorded, type RecordedD20, type RollIssuer } from './rolls.js';
import {
  checkConditionEffect,
  exhaustionBonus,
  saveConditionEffect,
  type CheckContext,
  type ConditionState,
} from './conditions.js';

/**
 * Ability checks and saving throws — two of the three D20 Tests. (The third,
 * the attack roll, lives in `attack.ts`: it resolves against AC rather than a
 * DC and is the only one where a natural 20 or 1 decides the outcome.)
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

/**
 * A skill's display form, for a log line a person reads.
 *
 * Skills are kebab-case slugs because an id is not a display name — the same
 * rule the equipment catalogue learned the hard way — so the readable half is
 * derived here rather than stored twice.
 */
export const skillName = (skill: Skill): string =>
  skill
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

/**
 * SRD: "A roll can't be affected by more than one Advantage, and Advantage and
 * Disadvantage on the same roll cancel each other."
 *
 * Note what that means: this is presence, not arithmetic. Three sources of
 * advantage against one of disadvantage is a *normal* roll, not advantage.
 * Counting sources and taking the difference is the classic way to get this
 * wrong, and it silently favours whoever has more effects running.
 */
export function combineRollModes(modes: Iterable<RollMode | ModeSource>): RollMode {
  let advantage = false;
  let disadvantage = false;

  for (const entry of modes) {
    const mode = typeof entry === 'string' ? entry : entry.mode;
    if (mode === 'advantage') advantage = true;
    else if (mode === 'disadvantage') disadvantage = true;
  }

  if (advantage === disadvantage) return 'normal';
  return advantage ? 'advantage' : 'disadvantage';
}

/**
 * Advantage and disadvantage the character carries by virtue of their own
 * equipment, before anything situational the caller adds.
 *
 * Each is attributed, because advantage cancels rather than stacks: when a roll
 * comes out normal, the log should be able to say what cancelled what.
 */
export function characterRollModes(
  sheet: CharacterSheet,
  ability: Ability,
  skill: Skill | null,
): ModeSource[] {
  const modes: ModeSource[] = [];

  // SRD: armour marked "Disadvantage" applies it to Dexterity (Stealth) checks
  // specifically — not to Dexterity checks in general.
  if (skill === 'stealth' && sheet.armor?.stealthDisadvantage === true) {
    modes.push({ source: sheet.armor.name, mode: 'disadvantage' });
  }

  // SRD "Armor Training": wearing armour you lack training in gives
  // Disadvantage on any D20 Test involving Strength or Dexterity.
  if ((ability === 'str' || ability === 'dex') && untrainedArmorPenalty(sheet)) {
    modes.push({ source: `untrained in ${sheet.armor?.name ?? 'armor'}`, mode: 'disadvantage' });
  }

  return modes;
}

/**
 * The shared shape of a resolved d20 test: what was rolled, why it was rolled
 * that way, and what it came to.
 *
 * Initiative is a Dexterity check with no DC, so it needs everything here
 * except the success comparison — which is why this is separate from
 * {@link D20TestResult} rather than folded into it.
 */
export interface D20Roll {
  readonly mode: RollMode;
  /** Every source, including ones that cancelled each other out. */
  readonly modeSources: readonly ModeSource[];
  readonly roll: RecordedD20;
  /** Everything static added to the die: ability, proficiency, flat bonuses. */
  readonly modifier: number;
  /** Bonuses that rolled dice. Flat ones are already in `modifier`. */
  readonly bonuses: readonly ResolvedBonus[];
  readonly total: number;
}

/**
 * Roll a d20 with modes and bonuses resolved. Flat bonuses ride on the die's
 * own modifier so `roll.total` stays meaningful; dice bonuses are rolled after
 * and added, which keeps the natural-20 and natural-1 rules reading the die
 * rather than an inflated total.
 */
export function rollD20Test(
  issuer: RollIssuer,
  rng: Rng,
  baseModifier: number,
  modeSources: readonly ModeSource[],
  bonuses: readonly Bonus[],
): Result<D20Roll> {
  // Nothing is rolled until the whole operation is known to be valid, so a
  // rejected roll leaves the generator and the roll counter untouched.
  const valid = validateBonusDice(bonuses);
  if (!valid.ok) return valid;

  const mode = combineRollModes(modeSources);
  const modifier = baseModifier + flatBonusTotal(bonuses);
  const roll = rollD20Recorded(issuer, rng, mode, modifier);

  const rolled = rollBonusDice(issuer, rng, bonuses);
  if (!rolled.ok) return rolled;

  return ok({
    mode,
    modeSources,
    roll,
    modifier,
    bonuses: rolled.value,
    total: roll.total + sumResolved(rolled.value),
  });
}

export type D20TestKind = 'ability-check' | 'saving-throw';

export interface D20TestOptions {
  readonly dc: number;
  /** The skill applied, when the check uses one. */
  readonly skill?: Skill;
  /**
   * Situational advantage or disadvantage. Accepts bare modes or attributed
   * ones — Boots of Elvenkind grant Advantage on Dexterity (Stealth) checks.
   */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers: Guidance's 1d4, a tool's flat bonus, and so on. */
  readonly bonuses?: readonly Bonus[];
  /**
   * The creature's conditions. Their modes, exhaustion penalty and automatic
   * failures are folded in without the caller having to remember any of it.
   */
  readonly conditions?: ConditionState;
  /** What the check depends on, for Blinded and Deafened, and fear visibility. */
  readonly conditionContext?: CheckContext;
  /**
   * Why this test fails regardless of the die, when something other than a
   * condition decided it — and the sentence a log will read.
   *
   * SRD Blight: "A Plant creature **automatically fails the save.**" That is
   * the same phrase the Stunned condition writes, so it is the same mechanism:
   * the die is thrown and recorded, because other effects can care what it
   * showed, and {@link D20TestResult.autoFailed} overrides the total so no
   * bonus applied afterwards rescues it.
   *
   * Supplied by the caller for exactly the reason `modes` and `bonuses` are:
   * whether the target is a Plant and whether this spell singles Plants out
   * are questions the layer above already holds the answers to, and the engine
   * applies the rule. A condition's own automatic failure wins the *message*
   * where both apply, because it is the one the creature is carrying; the
   * outcome is the same either way.
   */
  readonly autoFail?: string;
}

export interface D20TestResult {
  readonly kind: D20TestKind;
  readonly ability: Ability;
  readonly skill: Skill | null;
  readonly dc: number;
  readonly mode: RollMode;
  /** Why the roll ended up at that mode, including sources that cancelled. */
  readonly modeSources: readonly ModeSource[];
  readonly roll: RecordedD20;
  /** Every d20 rolled, in order — two of them under advantage or disadvantage. */
  readonly rolls: readonly number[];
  /** The die that counted, after advantage or disadvantage was applied. */
  readonly natural: number;
  /** Everything static added to the die: ability, proficiency, flat bonuses. */
  readonly modifier: number;
  /** Bonuses that rolled dice, e.g. Guidance. Flat ones are already in `modifier`. */
  readonly bonuses: readonly ResolvedBonus[];
  readonly total: number;
  readonly success: boolean;
  /**
   * Why the test failed regardless of the roll, when a condition decided it —
   * a Blinded creature searching by sight, a Stunned creature's Strength save.
   */
  readonly autoFailed: string | null;
  /** How much the total beat the DC by; negative when it failed. */
  readonly margin: number;
  /**
   * What an earlier roll of this same test came to, when something rerolled it.
   * Indomitable must use the new roll, so the old one is history rather than a
   * choice — but the log should still show it.
   */
  readonly supersedes?: { readonly natural: number; readonly total: number };
}

function resolve(
  issuer: RollIssuer,
  rng: Rng,
  kind: D20TestKind,
  sheet: CharacterSheet,
  ability: Ability,
  baseModifier: number,
  options: D20TestOptions,
): Result<D20TestResult> {
  const skill = options.skill ?? null;

  // Conditions contribute modes, a flat exhaustion penalty, and sometimes an
  // outright failure. The caller supplies the state; the engine reads the rules.
  const conditions = options.conditions;
  const conditionEffect =
    conditions === undefined
      ? { modes: [], autoFail: null }
      : kind === 'saving-throw'
        ? saveConditionEffect(conditions, ability)
        : checkConditionEffect(conditions, options.conditionContext ?? {});

  const modeSources: ModeSource[] = [
    ...characterRollModes(sheet, ability, skill),
    ...conditionEffect.modes,
    ...(options.modes ?? []).map((m) =>
      typeof m === 'string' ? { source: 'situational', mode: m } : m,
    ),
  ];
  const mode = combineRollModes(modeSources);

  const exhaustion = conditions === undefined ? null : exhaustionBonus(conditions);
  const allBonuses = [...(options.bonuses ?? []), ...(exhaustion === null ? [] : [exhaustion])];

  const rolled = rollD20Test(issuer, rng, baseModifier, modeSources, allBonuses);
  if (!rolled.ok) return rolled;

  const { roll, modifier, bonuses, total } = rolled.value;
  // A condition's own automatic failure first, because that is the one the
  // creature is carrying and the one a reader will expect to see named; the
  // outcome is identical either way, since there is nothing to combine.
  const autoFailed = conditionEffect.autoFail ?? options.autoFail ?? null;

  return ok({
    kind,
    ability,
    skill,
    dc: options.dc,
    mode,
    modeSources,
    roll,
    rolls: roll.rolls,
    natural: roll.natural,
    modifier,
    bonuses,
    total,
    autoFailed,
    // SRD: "If the total of the d20 and its modifiers equals or exceeds the
    // target number, the D20 Test succeeds." Nothing about naturals — those
    // rules are written for attack rolls only, so a natural 20 on a check
    // against an impossible DC still fails. A condition that fails the test
    // outright overrides the total entirely; the roll is still recorded,
    // because other effects can care what the die showed.
    success: autoFailed === null && total >= options.dc,
    margin: total - options.dc,
  });
}

export function rollAbilityCheck(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  ability: Ability,
  options: D20TestOptions,
): Result<D20TestResult> {
  const modifier =
    options.skill === undefined ? modifierFor(sheet, ability) : skillModifier(sheet, options.skill);

  return resolve(issuer, rng, 'ability-check', sheet, ability, modifier, options);
}

export function rollSavingThrow(
  issuer: RollIssuer,
  rng: Rng,
  sheet: CharacterSheet,
  ability: Ability,
  options: Omit<D20TestOptions, 'skill'>,
): Result<D20TestResult> {
  return resolve(issuer, rng, 'saving-throw', sheet, ability, saveModifier(sheet, ability), options);
}

/**
 * An effect used *after* a roll lands but before its outcome is settled.
 *
 * There is a real window here in the rules, and three distinct shapes fill it:
 *
 * - **Bardic Inspiration** adds a rolled die, "when the creature fails a D20
 *   Test", once the failure is known.
 * - **Cutting Words** subtracts one, "when a creature ... succeeds on an
 *   ability check or attack roll ... potentially turning the success into a
 *   failure". The mirror image, and it also applies to damage rolls — see
 *   `reduceDamage` in `attack.ts`.
 * - **Indomitable** rerolls the save outright — see {@link rerollTest}.
 *
 * The first two are the same mechanism with a sign, so they share one function.
 * Most of these are Reactions taken by *another* creature, which is why the
 * source is carried through: the log should say who spent what.
 *
 * The engine deliberately does not check whether the test succeeded or failed.
 * Bardic Inspiration requires a failure and Cutting Words requires a success,
 * but those conditions belong to those features, not to the mechanism — and
 * Bend Luck, which is neither, can push either way.
 */
export interface Intervention {
  readonly source: string;
  readonly flat?: number;
  readonly dice?: string;
  /** Subtract rather than add. Defaults to adding. */
  readonly direction?: 'bonus' | 'penalty';
}

export function interveneAfterRoll(
  issuer: RollIssuer,
  rng: Rng,
  result: D20TestResult,
  intervention: Intervention,
): Result<D20TestResult> {
  const sign = intervention.direction === 'penalty' ? -1 : 1;

  // Only the bonus-shaped fields. `Intervention.direction` is this function's
  // own ("bonus" or "penalty") and the sign is applied below; handing it to
  // `rollBonusDice`, which now understands a direction of its own, would sign
  // the same die twice and turn Cutting Words into a bonus.
  const rolled = rollBonusDice(issuer, rng, [
    {
      source: intervention.source,
      ...(intervention.flat === undefined ? {} : { flat: intervention.flat }),
      ...(intervention.dice === undefined ? {} : { dice: intervention.dice }),
    },
  ]);
  if (!rolled.ok) return rolled;

  const flat = intervention.flat ?? 0;
  const applied: ResolvedBonus[] =
    rolled.value.length > 0
      ? rolled.value.map((b) => ({
          ...b,
          flat: sign * flat,
          total: sign * (b.total + flat),
        }))
      : [{ source: intervention.source, flat: sign * flat, roll: null, total: sign * flat }];

  const bonuses = [...result.bonuses, ...applied];
  const total = result.total + sumResolved(applied);

  return ok({
    ...result,
    bonuses,
    total,
    // A test a condition failed outright stays failed: no die turns a Stunned
    // creature's Strength save into a success.
    success: result.autoFailed === null && total >= result.dc,
    margin: total - result.dc,
  });
}

/**
 * Reroll a test that has already been made, keeping the new result.
 *
 * SRD Indomitable: "If you fail a saving throw, you can reroll it with a bonus
 * equal to your Fighter level. **You must use the new roll.**" That last
 * sentence is the rule — this is not take-the-better-of-two, and a reroll that
 * comes up worse stands.
 *
 * The superseded roll is kept on the result, so the log still shows what was
 * given up rather than quietly replacing it.
 */
export function rerollTest(
  issuer: RollIssuer,
  rng: Rng,
  result: D20TestResult,
  bonus?: Bonus,
): Result<D20TestResult> {
  const bonuses = bonus === undefined ? [] : [bonus];

  const rolled = rollD20Test(
    issuer,
    rng,
    // The original modifier already folded in its flat bonuses; re-adding the
    // dice ones would double them, so only the new bonus rides along.
    result.modifier,
    result.modeSources,
    bonuses,
  );
  if (!rolled.ok) return rolled;

  const total = rolled.value.total;

  return ok({
    ...result,
    mode: rolled.value.mode,
    roll: rolled.value.roll,
    rolls: rolled.value.roll.rolls,
    natural: rolled.value.roll.natural,
    modifier: rolled.value.modifier,
    bonuses: [...result.bonuses, ...rolled.value.bonuses],
    total,
    success: result.autoFailed === null && total >= result.dc,
    margin: total - result.dc,
    supersedes: { natural: result.natural, total: result.total },
  });
}
