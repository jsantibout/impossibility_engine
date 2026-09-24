import { describe, expect, it } from 'vitest';
import { SKILL_ABILITY, asCharacterId } from '@ie/shared';
import { rollSelectorProblems, selectorMatches, type RollSelector } from './roll-modifiers.js';

/**
 * SRD Ray of Enfeeblement, whole: "A beam of enervating energy shoots from you
 * toward a creature within range. The target must make a Constitution saving
 * throw. On a successful save, the target has Disadvantage on the next attack
 * roll it makes until the start of your next turn.
 *
 * On a failed save, the target has Disadvantage on Strength-based D20 Tests
 * for the duration. During that time, it also subtracts 1d8 from all its
 * damage rolls. The target repeats the save at the end of each of its turns,
 * ending the spell on a success."
 *
 * Three shapes in one spell, and each of them was a named gap:
 * `a-selector-for-every-d20-test`, `a-damage-penalty-a-spell-grants` and
 * `a-success-branch-that-does-something`.
 */

const problems = (selector: RollSelector): readonly string[] =>
  rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((one) => one.code);

const HOLDER = asCharacterId('goblin');
const OTHER = asCharacterId('wizard');

describe('a family of D20 Tests, picked out by the ability behind them', () => {
  const strengthTests: RollSelector = {
    roll: 'd20-test',
    relation: 'roller',
    ability: 'str',
  };

  it('reaches a Strength attack roll, a Strength check and a Strength save', () => {
    expect(problems(strengthTests)).toEqual([]);
    for (const family of ['attack', 'ability-check', 'saving-throw'] as const) {
      expect(
        selectorMatches(strengthTests, HOLDER, {
          family,
          roller: HOLDER,
          ability: 'str',
          ...(family === 'attack' ? { against: OTHER } : {}),
        }),
      ).toBe(true);
    }
  });

  it('reaches no roll made with another ability, whichever family it is', () => {
    for (const family of ['attack', 'ability-check', 'saving-throw'] as const) {
      expect(
        selectorMatches(strengthTests, HOLDER, {
          family,
          roller: HOLDER,
          ability: 'dex',
          ...(family === 'attack' ? { against: OTHER } : {}),
        }),
      ).toBe(false);
    }
  });

  it('reaches neither Initiative nor a death save, which name no ability', () => {
    for (const family of ['initiative', 'death-save'] as const) {
      expect(selectorMatches(strengthTests, HOLDER, { family, roller: HOLDER })).toBe(false);
    }
  });

  it('is refused at authoring without an ability, because no spell in reach prints the bare phrase', () => {
    expect(problems({ roll: 'd20-test', relation: 'roller' })).toEqual([
      'd20_test_without_an_ability',
    ]);
  });

  it('keeps every narrowing the single families refuse, because it is not one of them', () => {
    expect(problems({ roll: 'd20-test', relation: 'against-holder', ability: 'str' })).toContain(
      'against_holder_without_target',
    );
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', skill: 'athletics' }),
    ).toContain('skill_off_ability_check');
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', condition: 'grappled' }),
    ).toContain('condition_off_a_saving_throw');
    expect(
      problems({ roll: 'd20-test', relation: 'roller', ability: 'str', counterpart: OTHER }),
    ).toContain('counterpart_without_target');
  });
});
