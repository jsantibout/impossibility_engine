import { describe, expect, it } from 'vitest';
import type { Armor } from '@ie/srd';
import type { Rng, RngState } from './dice.js';
import { createRng } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  characterRollModes,
  combineRollModes,
  rollAbilityCheck,
  rollSavingThrow,
} from './checks.js';

/**
 * A generator that returns a scripted sequence, so a test can pin an exact
 * natural roll. Seeded randomness is reproducible but not *chosen*, and some
 * rules only show up on a natural 20 or a natural 1.
 */
const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => {
      const v = values[i % values.length]!;
      i++;
      return v;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const scores = (over: Partial<AbilityScores> = {}): AbilityScores => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...over,
});

const armorFixture = (over: Partial<Armor> = {}): Armor => ({
  id: 'test-armor',
  name: 'Test Armor',
  category: 'light',
  baseAc: 11,
  acBonus: null,
  addsDexModifier: true,
  maxDexBonus: null,
  strengthRequirement: null,
  stealthDisadvantage: false,
  weightLb: 10,
  cost: { amount: 10, currency: 'gp' },
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: scores(),
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

describe('combineRollModes', () => {
  it('is normal with no sources', () => {
    expect(combineRollModes([])).toBe('normal');
  });

  it('passes a single source through', () => {
    expect(combineRollModes(['advantage'])).toBe('advantage');
    expect(combineRollModes(['disadvantage'])).toBe('disadvantage');
  });

  // SRD: "A roll can't be affected by more than one Advantage, and Advantage
  // and Disadvantage on the same roll cancel each other."
  it('does not stack multiple advantages', () => {
    expect(combineRollModes(['advantage', 'advantage', 'advantage'])).toBe('advantage');
  });

  it('does not stack multiple disadvantages', () => {
    expect(combineRollModes(['disadvantage', 'disadvantage'])).toBe('disadvantage');
  });

  it('cancels one advantage against one disadvantage', () => {
    expect(combineRollModes(['advantage', 'disadvantage'])).toBe('normal');
  });

  // The mistake this rule invites: counting sources instead of presence.
  // Three advantages against one disadvantage is a normal roll, not advantage.
  it('cancels regardless of how many of each there are', () => {
    expect(combineRollModes(['advantage', 'advantage', 'advantage', 'disadvantage'])).toBe('normal');
    expect(combineRollModes(['disadvantage', 'disadvantage', 'advantage'])).toBe('normal');
  });

  it('ignores explicit normals', () => {
    expect(combineRollModes(['normal', 'advantage', 'normal'])).toBe('advantage');
    expect(combineRollModes(['normal', 'normal'])).toBe('normal');
  });
});

describe('rollAbilityCheck', () => {
  it('succeeds when the total equals the DC', () => {
    // Natural 10, no modifier, DC 10.
    const result = rollAbilityCheck(scriptedRng([10]), sheet(), 'str', { dc: 10 });
    expect(result.total).toBe(10);
    expect(result.success).toBe(true);
    expect(result.margin).toBe(0);
  });

  it('fails when the total is one under the DC', () => {
    const result = rollAbilityCheck(scriptedRng([10]), sheet(), 'str', { dc: 11 });
    expect(result.success).toBe(false);
    expect(result.margin).toBe(-1);
  });

  it('adds the ability modifier', () => {
    const s = sheet({ abilities: scores({ str: 18 }) });
    const result = rollAbilityCheck(scriptedRng([10]), s, 'str', { dc: 10 });
    expect(result.modifier).toBe(4);
    expect(result.total).toBe(14);
  });

  it('adds proficiency when the check uses a skill', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'proficient' },
    });
    const result = rollAbilityCheck(scriptedRng([10]), s, 'dex', { dc: 10, skill: 'stealth' });
    expect(result.skill).toBe('stealth');
    expect(result.modifier).toBe(3 + 3);
  });

  it('uses the bare ability modifier when no skill applies', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'proficient' },
    });
    const result = rollAbilityCheck(scriptedRng([10]), s, 'dex', { dc: 10 });
    expect(result.skill).toBeNull();
    expect(result.modifier).toBe(3);
  });

  it('adds a circumstantial bonus', () => {
    const result = rollAbilityCheck(scriptedRng([10]), sheet(), 'str', { dc: 10, bonus: 2 });
    expect(result.total).toBe(12);
  });

  // SRD: the natural 20 and natural 1 rules are written for *attack rolls*.
  // An ability check is decided purely by total against DC.
  it('does not auto-succeed on a natural 20', () => {
    const s = sheet({ abilities: scores({ str: 6 }) });
    const result = rollAbilityCheck(scriptedRng([20]), s, 'str', { dc: 25 });
    expect(result.natural).toBe(20);
    expect(result.total).toBe(18);
    expect(result.success).toBe(false);
  });

  it('does not auto-fail on a natural 1', () => {
    const s = sheet({ level: 17, abilities: scores({ str: 20 }), skills: { athletics: 'expertise' } });
    const result = rollAbilityCheck(scriptedRng([1]), s, 'str', { dc: 10, skill: 'athletics' });
    expect(result.natural).toBe(1);
    expect(result.total).toBe(1 + 5 + 12);
    expect(result.success).toBe(true);
  });

  it('takes the higher die with advantage', () => {
    const result = rollAbilityCheck(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['advantage'],
    });
    expect(result.rolls).toEqual([7, 15]);
    expect(result.natural).toBe(15);
    expect(result.mode).toBe('advantage');
  });

  it('takes the lower die with disadvantage', () => {
    const result = rollAbilityCheck(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['disadvantage'],
    });
    expect(result.natural).toBe(7);
  });

  it('rolls a single die when advantage and disadvantage cancel', () => {
    const result = rollAbilityCheck(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['advantage', 'disadvantage'],
    });
    expect(result.mode).toBe('normal');
    expect(result.rolls).toEqual([7]);
  });

  it('reports the kind of test it was', () => {
    expect(rollAbilityCheck(scriptedRng([10]), sheet(), 'str', { dc: 10 }).kind).toBe(
      'ability-check',
    );
  });

  it('is reproducible from a seed', () => {
    const a = rollAbilityCheck(createRng('check'), sheet(), 'wis', { dc: 12 });
    const b = rollAbilityCheck(createRng('check'), sheet(), 'wis', { dc: 12 });
    expect(a).toEqual(b);
  });
});

describe('rollSavingThrow', () => {
  it('adds proficiency for a proficient save', () => {
    const s = sheet({ level: 5, abilities: scores({ con: 16 }), saveProficiencies: ['con'] });
    const result = rollSavingThrow(scriptedRng([10]), s, 'con', { dc: 15 });
    expect(result.kind).toBe('saving-throw');
    expect(result.modifier).toBe(3 + 3);
    expect(result.total).toBe(16);
    expect(result.success).toBe(true);
  });

  it('uses only the ability modifier for a non-proficient save', () => {
    const s = sheet({ level: 5, abilities: scores({ con: 16 }) });
    expect(rollSavingThrow(scriptedRng([10]), s, 'con', { dc: 15 }).modifier).toBe(3);
  });

  it('does not auto-succeed on a natural 20', () => {
    const s = sheet({ abilities: scores({ dex: 8 }) });
    const result = rollSavingThrow(scriptedRng([20]), s, 'dex', { dc: 25 });
    expect(result.success).toBe(false);
  });

  it('never carries a skill', () => {
    expect(rollSavingThrow(scriptedRng([10]), sheet(), 'wis', { dc: 10 }).skill).toBeNull();
  });
});

describe('characterRollModes', () => {
  it('is empty for an unencumbered character', () => {
    expect(characterRollModes(sheet(), 'dex', 'stealth')).toEqual([]);
  });

  // SRD: armour marked "Disadvantage" imposes it on Dexterity (Stealth) checks.
  it('gives disadvantage on Stealth in noisy armor', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    expect(characterRollModes(s, 'dex', 'stealth')).toEqual(['disadvantage']);
  });

  it('does not extend the stealth penalty to other Dexterity checks', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    expect(characterRollModes(s, 'dex', 'acrobatics')).toEqual([]);
    expect(characterRollModes(s, 'dex', null)).toEqual([]);
  });

  // SRD "Armor Training": untrained armour gives Disadvantage on any D20 Test
  // involving Strength or Dexterity — not just checks, and not other abilities.
  it('gives disadvantage on Strength and Dexterity tests in untrained armor', () => {
    const s = sheet({
      armor: armorFixture({ category: 'heavy' }),
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    expect(characterRollModes(s, 'str', null)).toEqual(['disadvantage']);
    expect(characterRollModes(s, 'dex', null)).toEqual(['disadvantage']);
  });

  it('leaves other abilities alone in untrained armor', () => {
    const s = sheet({
      armor: armorFixture({ category: 'heavy' }),
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    for (const ability of ['con', 'int', 'wis', 'cha'] as const) {
      expect(characterRollModes(s, ability, null)).toEqual([]);
    }
  });

  it('reports both penalties without double-counting the outcome', () => {
    const s = sheet({
      armor: armorFixture({ category: 'heavy', stealthDisadvantage: true }),
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    const modes = characterRollModes(s, 'dex', 'stealth');
    expect(modes.length).toBeGreaterThan(0);
    // Two sources of disadvantage still resolve to plain disadvantage.
    expect(combineRollModes(modes)).toBe('disadvantage');
  });
});

describe('the character penalties feed into rolls automatically', () => {
  it('applies armor stealth disadvantage without the caller asking', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    const result = rollAbilityCheck(scriptedRng([15, 7]), s, 'dex', { dc: 10, skill: 'stealth' });
    expect(result.mode).toBe('disadvantage');
    expect(result.natural).toBe(7);
  });

  it('lets a caller-supplied advantage cancel an armor penalty', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    const result = rollAbilityCheck(scriptedRng([15, 7]), s, 'dex', {
      dc: 10,
      skill: 'stealth',
      modes: ['advantage'],
    });
    expect(result.mode).toBe('normal');
    expect(result.rolls).toEqual([15]);
  });
});
