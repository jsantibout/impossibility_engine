import { describe, expect, it } from 'vitest';
import { SKILL_ABILITY } from '@ie/shared';
import { rollSelectorProblems, type RollSelector } from './roll-modifiers.js';

/** The skill-to-ability answer the validator asks for, as every caller supplies it. */
const problems = (selector: RollSelector): readonly string[] =>
  rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((one) => one.code);

/**
 * **The second family that says what a roll is about.**
 *
 * `RollSelector.condition` has been legal on a saving throw since SRD Brave
 * and its three siblings, and refused everywhere else — with a reason that
 * named its own successor: "the ability check that ends a Grapple is the next
 * roll that will say". It says now. `resolveEffectCheck` and `escapeGrapple`
 * both derive the condition from the timer they are settling, through the one
 * `conditionEndedBy`, so a grant keyed to a condition picks out the escape and
 * nothing else its holder rolls.
 *
 * What is still refused is every family that records no such fact, and this
 * file holds the line in both directions: a widening that let the axis onto an
 * attack roll would be a grant matching nothing for ever, which is the silent
 * failure the whole selector validator exists to turn into a refusal.
 */
describe('a condition may be named on the two families that say what they are about', () => {
  it('admits one on a saving throw, which is where it started', () => {
    expect(
      problems({ roll: 'saving-throw', relation: 'roller', condition: 'frightened' }),
    ).toEqual([]);
  });

  it('admits one on an ability check, which is the escape', () => {
    expect(
      problems({ roll: 'ability-check', relation: 'roller', condition: 'grappled' }),
    ).toEqual([]);
  });

  it('still refuses one on an attack roll', () => {
    expect(
      problems({ roll: 'attack', relation: 'roller', condition: 'grappled' }),
    ).toContain('condition_off_a_saving_throw');
  });

  it('still refuses one on Initiative', () => {
    expect(
      problems({ roll: 'initiative', relation: 'roller', condition: 'frightened' }),
    ).toContain('condition_off_a_saving_throw');
  });

  it('still refuses one on a death save', () => {
    expect(
      problems({ roll: 'death-save', relation: 'roller', condition: 'unconscious' }),
    ).toContain('condition_off_a_saving_throw');
  });

  /** And the condition itself is still held to the fifteen the glossary names. */
  it('refuses a condition nobody prints, on the family that now admits the axis', () => {
    expect(
      problems({
        roll: 'ability-check',
        relation: 'roller',
        condition: 'bewildered' as never,
      }),
    ).toContain('bad_condition');
  });
});
