import { describe, expect, it } from 'vitest';
import type { Armor } from '@ie/srd';
import type { Rng, RngState } from './dice.js';
import { createRng } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  applyBonusAfterRoll,
  characterRollModes,
  combineRollModes,
  rollAbilityCheck,
  rollSavingThrow,
} from './checks.js';
import { createRollIssuer } from './rolls.js';
import { expect as unwrap } from '@ie/shared';

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


const issuer = () => createRollIssuer('t');

/** Unwrapping wrappers, so each test reads as the roll it is describing. */
const check = (
  rng: Rng,
  s: CharacterSheet,
  ability: Parameters<typeof rollAbilityCheck>[3],
  options: Parameters<typeof rollAbilityCheck>[4],
) => unwrap(rollAbilityCheck(issuer(), rng, s, ability, options), 'check');

const save = (
  rng: Rng,
  s: CharacterSheet,
  ability: Parameters<typeof rollSavingThrow>[3],
  options: Parameters<typeof rollSavingThrow>[4],
) => unwrap(rollSavingThrow(issuer(), rng, s, ability, options), 'save');

/** Just the modes, for the many assertions that do not care about attribution. */
const modesOf = (sources: readonly { mode: string }[]) => sources.map((m) => m.mode);

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
    const result = check(scriptedRng([10]), sheet(), 'str', { dc: 10 });
    expect(result.total).toBe(10);
    expect(result.success).toBe(true);
    expect(result.margin).toBe(0);
  });

  it('fails when the total is one under the DC', () => {
    const result = check(scriptedRng([10]), sheet(), 'str', { dc: 11 });
    expect(result.success).toBe(false);
    expect(result.margin).toBe(-1);
  });

  it('adds the ability modifier', () => {
    const s = sheet({ abilities: scores({ str: 18 }) });
    const result = check(scriptedRng([10]), s, 'str', { dc: 10 });
    expect(result.modifier).toBe(4);
    expect(result.total).toBe(14);
  });

  it('adds proficiency when the check uses a skill', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'proficient' },
    });
    const result = check(scriptedRng([10]), s, 'dex', { dc: 10, skill: 'stealth' });
    expect(result.skill).toBe('stealth');
    expect(result.modifier).toBe(3 + 3);
  });

  it('uses the bare ability modifier when no skill applies', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'proficient' },
    });
    const result = check(scriptedRng([10]), s, 'dex', { dc: 10 });
    expect(result.skill).toBeNull();
    expect(result.modifier).toBe(3);
  });

  it('adds a circumstantial bonus', () => {
    const result = check(scriptedRng([10]), sheet(), 'str', { dc: 10, bonuses: [{ source: 'Guidance', flat: 2 }] });
    expect(result.total).toBe(12);
  });

  // SRD: the natural 20 and natural 1 rules are written for *attack rolls*.
  // An ability check is decided purely by total against DC.
  it('does not auto-succeed on a natural 20', () => {
    const s = sheet({ abilities: scores({ str: 6 }) });
    const result = check(scriptedRng([20]), s, 'str', { dc: 25 });
    expect(result.natural).toBe(20);
    expect(result.total).toBe(18);
    expect(result.success).toBe(false);
  });

  it('does not auto-fail on a natural 1', () => {
    const s = sheet({ level: 17, abilities: scores({ str: 20 }), skills: { athletics: 'expertise' } });
    const result = check(scriptedRng([1]), s, 'str', { dc: 10, skill: 'athletics' });
    expect(result.natural).toBe(1);
    expect(result.total).toBe(1 + 5 + 12);
    expect(result.success).toBe(true);
  });

  it('takes the higher die with advantage', () => {
    const result = check(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['advantage'],
    });
    expect(result.rolls).toEqual([7, 15]);
    expect(result.natural).toBe(15);
    expect(result.mode).toBe('advantage');
  });

  it('takes the lower die with disadvantage', () => {
    const result = check(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['disadvantage'],
    });
    expect(result.natural).toBe(7);
  });

  it('rolls a single die when advantage and disadvantage cancel', () => {
    const result = check(scriptedRng([7, 15]), sheet(), 'str', {
      dc: 10,
      modes: ['advantage', 'disadvantage'],
    });
    expect(result.mode).toBe('normal');
    expect(result.rolls).toEqual([7]);
  });

  it('reports the kind of test it was', () => {
    expect(check(scriptedRng([10]), sheet(), 'str', { dc: 10 }).kind).toBe(
      'ability-check',
    );
  });

  it('is reproducible from a seed', () => {
    const a = check(createRng('check'), sheet(), 'wis', { dc: 12 });
    const b = check(createRng('check'), sheet(), 'wis', { dc: 12 });
    expect(a).toEqual(b);
  });
});

describe('rollSavingThrow', () => {
  it('adds proficiency for a proficient save', () => {
    const s = sheet({ level: 5, abilities: scores({ con: 16 }), saveProficiencies: ['con'] });
    const result = save(scriptedRng([10]), s, 'con', { dc: 15 });
    expect(result.kind).toBe('saving-throw');
    expect(result.modifier).toBe(3 + 3);
    expect(result.total).toBe(16);
    expect(result.success).toBe(true);
  });

  it('uses only the ability modifier for a non-proficient save', () => {
    const s = sheet({ level: 5, abilities: scores({ con: 16 }) });
    expect(save(scriptedRng([10]), s, 'con', { dc: 15 }).modifier).toBe(3);
  });

  it('does not auto-succeed on a natural 20', () => {
    const s = sheet({ abilities: scores({ dex: 8 }) });
    const result = save(scriptedRng([20]), s, 'dex', { dc: 25 });
    expect(result.success).toBe(false);
  });

  it('never carries a skill', () => {
    expect(save(scriptedRng([10]), sheet(), 'wis', { dc: 10 }).skill).toBeNull();
  });
});

describe('characterRollModes', () => {
  it('is empty for an unencumbered character', () => {
    expect(characterRollModes(sheet(), 'dex', 'stealth')).toEqual([]);
  });

  // SRD: armour marked "Disadvantage" imposes it on Dexterity (Stealth) checks.
  it('gives disadvantage on Stealth in noisy armor', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    expect(modesOf(characterRollModes(s, 'dex', 'stealth'))).toEqual(['disadvantage']);
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
    expect(modesOf(characterRollModes(s, 'str', null))).toEqual(['disadvantage']);
    expect(modesOf(characterRollModes(s, 'dex', null))).toEqual(['disadvantage']);
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
    const result = check(scriptedRng([15, 7]), s, 'dex', { dc: 10, skill: 'stealth' });
    expect(result.mode).toBe('disadvantage');
    expect(result.natural).toBe(7);
  });

  it('lets a caller-supplied advantage cancel an armor penalty', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    const result = check(scriptedRng([15, 7]), s, 'dex', {
      dc: 10,
      skill: 'stealth',
      modes: ['advantage'],
    });
    expect(result.mode).toBe('normal');
    expect(result.rolls).toEqual([15]);
  });
});

describe('bonuses on checks', () => {
  // SRD Guidance: "the creature adds 1d4 to any ability check using the chosen
  // skill." A die, not a flat number.
  it('rolls a dice bonus and adds it to the total', () => {
    const result = check(scriptedRng([10, 3]), sheet(), 'wis', {
      dc: 10,
      skill: 'medicine',
      bonuses: [{ source: 'Guidance', dice: '1d4' }],
    });
    expect(result.bonuses).toHaveLength(1);
    expect(result.bonuses[0]).toMatchObject({ source: 'Guidance', total: 3 });
    expect(result.total).toBe(13);
  });

  it('keeps a dice bonus out of the d20 result itself', () => {
    const result = check(scriptedRng([10, 4]), sheet(), 'wis', {
      dc: 10,
      bonuses: [{ source: 'Guidance', dice: '1d4' }],
    });
    expect(result.roll.total).toBe(10);
    expect(result.total).toBe(14);
  });

  it('folds a flat bonus into the modifier', () => {
    const result = check(scriptedRng([10]), sheet(), 'int', {
      dc: 10,
      bonuses: [{ source: "Navigator's Tools", flat: 2 }],
    });
    expect(result.modifier).toBe(2);
    expect(result.total).toBe(12);
  });

  it('combines flat and dice bonuses from several sources', () => {
    const result = check(scriptedRng([10, 2]), sheet(), 'cha', {
      dc: 10,
      bonuses: [
        { source: 'Guidance', dice: '1d4' },
        { source: 'Enhance Ability', flat: 1 },
      ],
    });
    expect(result.total).toBe(10 + 1 + 2);
  });

  it('lets a bonus turn a failure into a success', () => {
    const options = { dc: 13 } as const;
    expect(check(scriptedRng([12]), sheet(), 'str', options).success).toBe(false);
    expect(
      check(scriptedRng([12, 3]), sheet(), 'str', {
        ...options,
        bonuses: [{ source: 'Guidance', dice: '1d4' }],
      }).success,
    ).toBe(true);
  });

  it('applies bonuses to saving throws too', () => {
    const result = save(scriptedRng([10, 4]), sheet(), 'wis', {
      dc: 14,
      bonuses: [{ source: 'Bless', dice: '1d4' }],
    });
    expect(result.total).toBe(14);
    expect(result.success).toBe(true);
  });

  it('records the check roll with engine provenance', () => {
    const result = check(scriptedRng([10]), sheet(), 'str', { dc: 10 });
    expect(result.roll.provenance).toMatchObject({ id: 't:1', source: 'engine' });
  });
});

describe('attributed advantage', () => {
  // SRD Boots of Elvenkind (2024): "You also have Advantage on Dexterity
  // (Stealth) checks." Flat advantage — the 2014 version was conditional on
  // moving quietly, the 2024 one is not.
  const boots = { source: 'Boots of Elvenkind', mode: 'advantage' } as const;

  it('accepts an attributed advantage source', () => {
    const result = check(scriptedRng([7, 15]), sheet(), 'dex', {
      dc: 10,
      skill: 'stealth',
      modes: [boots],
    });
    expect(result.mode).toBe('advantage');
    expect(result.natural).toBe(15);
  });

  it('still accepts a bare mode alongside an attributed one', () => {
    const result = check(scriptedRng([7, 15]), sheet(), 'dex', {
      dc: 10,
      modes: ['advantage', { source: 'high ground', mode: 'advantage' }],
    });
    expect(result.mode).toBe('advantage');
  });

  it('reports every source, including ones that cancelled out', () => {
    // Boots grant advantage; noisy armour imposes disadvantage on Stealth.
    const s = sheet({ armor: armorFixture({ name: 'Plate Armor', stealthDisadvantage: true }) });
    const result = check(scriptedRng([7, 15]), s, 'dex', {
      dc: 10,
      skill: 'stealth',
      modes: [boots],
    });

    expect(result.mode).toBe('normal');
    expect(result.modeSources.map((m) => m.source)).toEqual([
      'Plate Armor',
      'Boots of Elvenkind',
    ]);
    // The log can now explain why a normal roll was normal.
    expect(result.rolls).toEqual([7]);
  });

  it('attributes the armour that caused a stealth penalty', () => {
    const s = sheet({ armor: armorFixture({ name: 'Splint Armor', stealthDisadvantage: true }) });
    expect(characterRollModes(s, 'dex', 'stealth')).toEqual([
      { source: 'Splint Armor', mode: 'disadvantage' },
    ]);
  });

  it('attributes an untrained armour penalty', () => {
    const s = sheet({
      armor: armorFixture({ name: 'Plate Armor', category: 'heavy' }),
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    expect(characterRollModes(s, 'str', null)).toEqual([
      { source: 'untrained in Plate Armor', mode: 'disadvantage' },
    ]);
  });
});

describe('applyBonusAfterRoll', () => {
  /**
   * SRD Bardic Inspiration: "Once within the next hour when the creature fails
   * a D20 Test, the creature can roll the Bardic Inspiration die and add the
   * number rolled to the d20, potentially turning the failure into a success."
   *
   * Applied *after* the roll, once the failure is known — so it cannot be
   * supplied up front like Guidance.
   */
  it('turns a known failure into a success', () => {
    const failed = check(scriptedRng([9]), sheet(), 'cha', { dc: 13 });
    expect(failed.success).toBe(false);
    expect(failed.margin).toBe(-4);

    const inspired = unwrap(
      applyBonusAfterRoll(issuer(), scriptedRng([5]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'inspired',
    );
    expect(inspired.total).toBe(14);
    expect(inspired.success).toBe(true);
    expect(inspired.margin).toBe(1);
  });

  it('leaves the failure standing when the die is not enough', () => {
    const failed = check(scriptedRng([2]), sheet(), 'cha', { dc: 13 });
    const inspired = unwrap(
      applyBonusAfterRoll(issuer(), scriptedRng([3]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'short',
    );
    expect(inspired.success).toBe(false);
  });

  it('appends the bonus rather than replacing what was already there', () => {
    const first = check(scriptedRng([9, 2]), sheet(), 'cha', {
      dc: 20,
      bonuses: [{ source: 'Guidance', dice: '1d4' }],
    });
    const inspired = unwrap(
      applyBonusAfterRoll(issuer(), scriptedRng([6]), first, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'both',
    );
    expect(inspired.bonuses.map((b) => b.source)).toEqual(['Guidance', 'Bardic Inspiration']);
    expect(inspired.total).toBe(9 + 2 + 6);
  });

  it('accepts a flat after-the-fact bonus', () => {
    const failed = check(scriptedRng([10]), sheet(), 'str', { dc: 12 });
    const helped = unwrap(
      applyBonusAfterRoll(issuer(), scriptedRng([1]), failed, { source: 'a shove', flat: 2 }),
      'flat',
    );
    expect(helped.total).toBe(12);
    expect(helped.success).toBe(true);
  });

  it('does not disturb the original roll record', () => {
    const failed = check(scriptedRng([9]), sheet(), 'cha', { dc: 13 });
    const inspired = unwrap(
      applyBonusAfterRoll(issuer(), scriptedRng([5]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'record',
    );
    expect(inspired.natural).toBe(9);
    expect(inspired.roll).toBe(failed.roll);
    expect(failed.total).toBe(9);
  });
});
