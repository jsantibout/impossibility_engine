import type { Ability, RollMode, Skill } from '@ie/shared';
import { rollD20, type Rng } from './dice.js';
import {
  modifierFor,
  saveModifier,
  skillModifier,
  untrainedArmorPenalty,
  type CharacterSheet,
} from './character.js';

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
export function combineRollModes(modes: Iterable<RollMode>): RollMode {
  let advantage = false;
  let disadvantage = false;

  for (const mode of modes) {
    if (mode === 'advantage') advantage = true;
    else if (mode === 'disadvantage') disadvantage = true;
  }

  if (advantage === disadvantage) return 'normal';
  return advantage ? 'advantage' : 'disadvantage';
}

/**
 * Advantage and disadvantage the character carries by virtue of their own
 * state, before anything situational the caller adds.
 */
export function characterRollModes(
  sheet: CharacterSheet,
  ability: Ability,
  skill: Skill | null,
): RollMode[] {
  const modes: RollMode[] = [];

  // SRD: armour marked "Disadvantage" applies it to Dexterity (Stealth) checks
  // specifically — not to Dexterity checks in general.
  if (skill === 'stealth' && sheet.armor?.stealthDisadvantage === true) {
    modes.push('disadvantage');
  }

  // SRD "Armor Training": wearing armour you lack training in gives
  // Disadvantage on any D20 Test involving Strength or Dexterity.
  if ((ability === 'str' || ability === 'dex') && untrainedArmorPenalty(sheet)) {
    modes.push('disadvantage');
  }

  return modes;
}

export type D20TestKind = 'ability-check' | 'saving-throw';

export interface D20TestOptions {
  readonly dc: number;
  /** The skill applied, when the check uses one. */
  readonly skill?: Skill;
  /** Situational advantage or disadvantage from the fiction. */
  readonly modes?: readonly RollMode[];
  /** Circumstantial bonus or penalty from a feature, spell, or other rule. */
  readonly bonus?: number;
}

export interface D20TestResult {
  readonly kind: D20TestKind;
  readonly ability: Ability;
  readonly skill: Skill | null;
  readonly dc: number;
  readonly mode: RollMode;
  /** Every d20 rolled, in order — two of them under advantage or disadvantage. */
  readonly rolls: readonly number[];
  /** The die that counted, after advantage or disadvantage was applied. */
  readonly natural: number;
  /** Everything added to the die: ability, proficiency, circumstantial bonus. */
  readonly modifier: number;
  readonly total: number;
  readonly success: boolean;
  /** How much the total beat the DC by; negative when it failed. */
  readonly margin: number;
}

function resolve(
  rng: Rng,
  kind: D20TestKind,
  sheet: CharacterSheet,
  ability: Ability,
  modifier: number,
  options: D20TestOptions,
): D20TestResult {
  const skill = options.skill ?? null;
  const bonus = options.bonus ?? 0;

  const mode = combineRollModes([
    ...characterRollModes(sheet, ability, skill),
    ...(options.modes ?? []),
  ]);

  const total = modifier + bonus;
  const outcome = rollD20(rng, mode, total);

  return {
    kind,
    ability,
    skill,
    dc: options.dc,
    mode,
    rolls: outcome.rolls,
    natural: outcome.natural,
    modifier: total,
    total: outcome.total,
    // SRD: "If the total of the d20 and its modifiers equals or exceeds the
    // target number, the D20 Test succeeds." Nothing about naturals — those
    // rules are written for attack rolls only, so a natural 20 on a check
    // against an impossible DC still fails.
    success: outcome.total >= options.dc,
    margin: outcome.total - options.dc,
  };
}

export function rollAbilityCheck(
  rng: Rng,
  sheet: CharacterSheet,
  ability: Ability,
  options: D20TestOptions,
): D20TestResult {
  const modifier =
    options.skill === undefined
      ? modifierFor(sheet, ability)
      : skillModifier(sheet, options.skill);

  return resolve(rng, 'ability-check', sheet, ability, modifier, options);
}

export function rollSavingThrow(
  rng: Rng,
  sheet: CharacterSheet,
  ability: Ability,
  options: Omit<D20TestOptions, 'skill'>,
): D20TestResult {
  return resolve(rng, 'saving-throw', sheet, ability, saveModifier(sheet, ability), options);
}
