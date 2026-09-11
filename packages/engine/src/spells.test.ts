import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import { createRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { rollSavingThrow } from './checks.js';
import { concentrationSaveDc } from './vitals.js';
import { conditionState, applyCondition } from './conditions.js';
import type { CharacterSheet } from './character.js';
import {
  CASTING_MARK,
  castingIdOf,
  castingSource,
  slotFits,
  spellOfSource,
  validateSpellName,
} from './spells.js';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

describe('linking an effect to the casting that made it', () => {
  /**
   * A condition's source is a free-form string, and the whole cleanup story
   * rests on being able to tell "this Hold Person" from "that Hold Person".
   * Encoding the casting id into the source keeps the log readable while
   * making the link exact rather than a name match.
   */
  it('reads back the casting that created a source', () => {
    const source = castingSource('Hold Person', 'cast:3');
    expect(source).toContain('Hold Person');
    expect(castingIdOf(source)).toBe('cast:3');
    expect(spellOfSource(source)).toBe('Hold Person');
  });

  it('reports no casting for a source that never had one', () => {
    expect(castingIdOf('zero hit points')).toBeNull();
    expect(castingIdOf('a bite')).toBeNull();
    expect(spellOfSource('a bite')).toBe('a bite');
  });

  /**
   * Two casters, the same spell, the same target. The sources must differ or
   * one caster losing Concentration would end the other's spell.
   */
  it('distinguishes two castings of the same spell', () => {
    const a = castingSource('Hold Person', 'cast:1');
    const b = castingSource('Hold Person', 'cast:2');
    expect(a).not.toBe(b);

    let state = applyCondition(conditionState(), 'paralyzed', a);
    state = applyCondition(state, 'paralyzed', b);
    expect(state.conditions).toContain('paralyzed');
    expect(state.instances.filter((i) => i.condition === 'paralyzed')).toHaveLength(2);
  });

  /** The separator is what makes the link unambiguous, so a name may not carry it. */
  it('refuses a spell name that would forge the link', () => {
    expect(isErr(validateSpellName(`Hold Person${CASTING_MARK}cast:9`))).toBe(true);
    expect(isErr(validateSpellName('   '))).toBe(true);
    expect(isErr(validateSpellName(''))).toBe(true);
    expect(unwrap(validateSpellName('Hold Person'), 'name')).toBe('Hold Person');
  });
});

describe('a slot has to be big enough', () => {
  /**
   * SRD: "A level 1 spell fits into a slot of any size, but a level 2 spell
   * fits only into a slot that's at least level 2."
   */
  it('takes a slot of the spell level or higher', () => {
    expect(slotFits(1, 1)).toBe(true);
    expect(slotFits(1, 3)).toBe(true);
    expect(slotFits(3, 1)).toBe(false);
  });
});

describe('the Concentration save is an ordinary Constitution save', () => {
  /**
   * SRD: "The DC equals 10 or half the damage taken (round down), whichever
   * number is higher, up to a maximum DC of 30."
   */
  it('computes the DC from damage taken', () => {
    expect(concentrationSaveDc(1)).toBe(10);
    expect(concentrationSaveDc(20)).toBe(10);
    expect(concentrationSaveDc(21)).toBe(10);
    expect(concentrationSaveDc(22)).toBe(11);
    expect(concentrationSaveDc(100)).toBe(30);
    expect(concentrationSaveDc(0)).toBe(10);
  });

  /** Proficiency, conditions and bonuses all apply, because it is just a save. */
  it('runs through rollSavingThrow with the caster proficiency', () => {
    const issuer = createRollIssuer('t');
    const rng = createRng('seed');
    const result = unwrap(
      rollSavingThrow(issuer, rng, sheet(), 'con', { dc: concentrationSaveDc(18) }),
      'save',
    );
    expect(result.kind).toBe('saving-throw');
    expect(result.ability).toBe('con');
    expect(result.dc).toBe(10);
    // Constitution +2 and proficiency +3 at level 5.
    expect(result.modifier).toBe(5);
  });
});
