import { ok, type Ability, type Result, type RollMode, type Skill } from '@ie/shared';
import type { Rng } from './dice.js';
import {
  flatBonusTotal,
  rollBonusDice,
  sumResolved,
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

/**
 * Ability checks and saving throws — two of the three D20 Tests. (The third,
 * the attack roll, lives in `attack.ts`: it resolves against AC rather than a
 * DC and is the only one where a natural 20 or 1 decides the outcome.)
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

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
  /** How much the total beat the DC by; negative when it failed. */
  readonly margin: number;
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

  const modeSources: ModeSource[] = [
    ...characterRollModes(sheet, ability, skill),
    ...(options.modes ?? []).map((m) =>
      typeof m === 'string' ? { source: 'situational', mode: m } : m,
    ),
  ];
  const mode = combineRollModes(modeSources);

  const modifier = baseModifier + flatBonusTotal(options.bonuses);
  const roll = rollD20Recorded(issuer, rng, mode, modifier);

  const bonuses = rollBonusDice(issuer, rng, options.bonuses);
  if (!bonuses.ok) return bonuses;

  const total = roll.total + sumResolved(bonuses.value);

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
    bonuses: bonuses.value,
    total,
    // SRD: "If the total of the d20 and its modifiers equals or exceeds the
    // target number, the D20 Test succeeds." Nothing about naturals — those
    // rules are written for attack rolls only, so a natural 20 on a check
    // against an impossible DC still fails.
    success: total >= options.dc,
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
 * Add a bonus to a test that has already been rolled, recomputing the outcome.
 *
 * Some effects are used *after* seeing the result. Bardic Inspiration is the
 * clearest: "Once within the next hour when the creature fails a D20 Test, the
 * creature can roll the Bardic Inspiration die and add the number rolled to the
 * d20, potentially turning the failure into a success."
 *
 * The engine deliberately does not check that the test failed. That condition
 * belongs to Bardic Inspiration specifically, not to the mechanism — other
 * effects amend a roll on other terms — so the rule that spends the resource
 * decides whether it may be used, exactly as bonuses are supplied by the
 * caller elsewhere.
 */
export function applyBonusAfterRoll(
  issuer: RollIssuer,
  rng: Rng,
  result: D20TestResult,
  bonus: Bonus,
): Result<D20TestResult> {
  const rolled = rollBonusDice(issuer, rng, [bonus]);
  if (!rolled.ok) return rolled;

  const flat = bonus.flat ?? 0;
  const added: ResolvedBonus[] =
    rolled.value.length > 0
      ? rolled.value.map((b) => ({ ...b, flat, total: b.total + flat }))
      : [{ source: bonus.source, flat, roll: null, total: flat }];

  const bonuses = [...result.bonuses, ...added];
  const total = result.total + sumResolved(added);

  return ok({
    ...result,
    bonuses,
    total,
    success: total >= result.dc,
    margin: total - result.dc,
  });
}
