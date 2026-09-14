import { describe, expect, it } from 'vitest';
import type { Armor } from '@ie/srd';
import type { Rng, RngState } from './dice.js';
import { createRng } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  interveneAfterRoll,
  rerollTest,
  characterRollModes,
  combineRollModes,
  rollAbilityCheck,
  rollSavingThrow,
} from './checks.js';
import { createRollIssuer } from './rolls.js';
import { conditionState } from './conditions.js';
import { isErr, expect as unwrap } from '@ie/shared';

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

describe('interveneAfterRoll', () => {
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
      interveneAfterRoll(issuer(), scriptedRng([5]), failed, {
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
      interveneAfterRoll(issuer(), scriptedRng([3]), failed, {
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
      interveneAfterRoll(issuer(), scriptedRng([6]), first, {
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
      interveneAfterRoll(issuer(), scriptedRng([1]), failed, { source: 'a shove', flat: 2 }),
      'flat',
    );
    expect(helped.total).toBe(12);
    expect(helped.success).toBe(true);
  });

  it('does not disturb the original roll record', () => {
    const failed = check(scriptedRng([9]), sheet(), 'cha', { dc: 13 });
    const inspired = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([5]), failed, {
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

describe('conditions feed into checks', () => {
  it('applies Poisoned disadvantage without the caller asking', () => {
    const result = check(scriptedRng([15, 6]), sheet(), 'str', {
      dc: 10,
      conditions: conditionState(['poisoned']),
    });
    expect(result.mode).toBe('disadvantage');
    expect(result.natural).toBe(6);
  });

  it('fails a sight-dependent check outright while Blinded', () => {
    const result = check(scriptedRng([20]), sheet(), 'wis', {
      dc: 5,
      skill: 'perception',
      conditions: conditionState(['blinded']),
      conditionContext: { requiresSight: true },
    });
    // The die is still recorded — other effects can care what it showed.
    expect(result.natural).toBe(20);
    expect(result.autoFailed).toMatch(/blinded/i);
    expect(result.success).toBe(false);
  });

  it('leaves a check that does not need sight alone while Blinded', () => {
    const result = check(scriptedRng([15]), sheet(), 'wis', {
      dc: 10,
      conditions: conditionState(['blinded']),
    });
    expect(result.autoFailed).toBeNull();
    expect(result.success).toBe(true);
  });

  // SRD Exhaustion: a flat penalty, so unlike disadvantage it is not cancelled
  // by an advantage source — it stacks with everything.
  it('subtracts the exhaustion penalty from the roll', () => {
    const result = check(scriptedRng([15]), sheet(), 'str', {
      dc: 10,
      conditions: conditionState([], 3),
    });
    expect(result.total).toBe(15 - 6);
    expect(result.success).toBe(false);
  });

  it('keeps the exhaustion penalty even with advantage', () => {
    const result = check(scriptedRng([15, 18]), sheet(), 'str', {
      dc: 10,
      conditions: conditionState([], 2),
      modes: ['advantage'],
    });
    expect(result.natural).toBe(18);
    expect(result.total).toBe(18 - 4);
  });

  it('auto-fails a Stunned creature’s Strength save', () => {
    const result = save(scriptedRng([20]), sheet(), 'str', {
      dc: 5,
      conditions: conditionState(['stunned']),
    });
    expect(result.autoFailed).toMatch(/stunned/i);
    expect(result.success).toBe(false);
  });

  it('leaves a Stunned creature’s Wisdom save rollable', () => {
    const result = save(scriptedRng([15]), sheet(), 'wis', {
      dc: 10,
      conditions: conditionState(['stunned']),
    });
    expect(result.autoFailed).toBeNull();
    expect(result.success).toBe(true);
  });

  /**
   * An automatic failure a **caller** supplies, which is the other half of the
   * same rule.
   *
   * SRD Blight: "A Plant creature automatically fails the save." Whether the
   * target is a Plant and whether the spell singles Plants out are questions
   * the layer above holds the answers to — exactly as with `modes` and
   * `bonuses` — so the caller states it and the engine applies it. It must
   * mean what a condition's does: the die is still thrown and recorded,
   * because other effects can care what it showed, and the total is
   * overridden.
   */
  it('fails a save the caller says fails, whatever the die', () => {
    const result = save(scriptedRng([20]), sheet(), 'con', {
      dc: 5,
      autoFail: 'Blight: a Plant creature automatically fails the save',
    });
    expect(result.natural).toBe(20);
    expect(result.total).toBeGreaterThan(result.dc);
    expect(result.autoFailed).toMatch(/Plant/);
    expect(result.success).toBe(false);
  });

  /** And no bonus applied alongside it rescues the save. */
  it('is not rescued by a bonus on the same roll', () => {
    const result = save(scriptedRng([20, 4]), sheet(), 'con', {
      dc: 5,
      autoFail: 'Blight: a Plant creature automatically fails the save',
      bonuses: [{ source: 'Bless', dice: '1d4' }],
    });
    expect(result.total).toBeGreaterThan(result.dc);
    expect(result.success).toBe(false);
  });

  /**
   * **The condition's sentence is the one reported when both apply.**
   *
   * Unreachable through the catalogue — Blight is the only spell writing an
   * automatic failure and it is a Constitution save, while every
   * condition-sourced save failure is Strength or Dexterity — but
   * `rollSavingThrow` is pure and takes both directly, so the case can simply
   * be built. The `restoreOn` precedent rather than `placeArea`'s dead
   * `no_scene`: a guard nothing can reach is not a rule, and a pure function
   * will take a fixture that reaches it. The outcome is the same either way;
   * what is pinned is which sentence a log reads, and it is the condition's
   * because that is the one the creature is carrying.
   */
  it('names the condition rather than the caller when both fail the save', () => {
    const result = save(scriptedRng([20]), sheet(), 'str', {
      dc: 5,
      conditions: conditionState(['stunned']),
      autoFail: 'Blight: a Plant creature automatically fails the save',
    });
    expect(result.autoFailed).toMatch(/stunned/i);
    expect(result.autoFailed).not.toMatch(/Plant/);
    expect(result.success).toBe(false);
  });

  it('gives a Restrained creature disadvantage on Dexterity saves only', () => {
    const dex = save(scriptedRng([15, 4]), sheet(), 'dex', {
      dc: 10,
      conditions: conditionState(['restrained']),
    });
    expect(dex.mode).toBe('disadvantage');

    const con = save(scriptedRng([15, 4]), sheet(), 'con', {
      dc: 10,
      conditions: conditionState(['restrained']),
    });
    expect(con.mode).toBe('normal');
  });

  it('will not let Bardic Inspiration rescue an automatic failure', () => {
    const failed = save(scriptedRng([18]), sheet(), 'str', {
      dc: 5,
      conditions: conditionState(['paralyzed']),
    });
    const inspired = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([6]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'inspired',
    );
    expect(inspired.success).toBe(false);
  });
});

describe('interventions after the roll', () => {
  /**
   * There is a real window in the rules between a roll landing and its outcome
   * settling, and three distinct effects fill it. All three are Reactions,
   * usually taken by someone other than the roller.
   */

  // SRD Cutting Words: "subtract the number rolled from the creature's roll,
  // ... potentially turning the success into a failure."
  it('turns a success into a failure by subtracting a die', () => {
    const succeeded = check(scriptedRng([14]), sheet(), 'cha', { dc: 13 });
    expect(succeeded.success).toBe(true);

    const cut = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([4]), succeeded, {
        source: 'Cutting Words',
        dice: '1d6',
        direction: 'penalty',
      }),
      'cut',
    );
    expect(cut.total).toBe(10);
    expect(cut.success).toBe(false);
  });

  it('records a penalty as a negative contribution, not a positive one', () => {
    const succeeded = check(scriptedRng([14]), sheet(), 'cha', { dc: 13 });
    const cut = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([3]), succeeded, {
        source: 'Cutting Words',
        dice: '1d6',
        direction: 'penalty',
      }),
      'cut',
    );
    expect(cut.bonuses.at(-1)).toMatchObject({ source: 'Cutting Words', total: -3 });
  });

  it('still adds when no direction is given', () => {
    const failed = check(scriptedRng([9]), sheet(), 'cha', { dc: 13 });
    const helped = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([5]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'helped',
    );
    expect(helped.total).toBe(14);
    expect(helped.success).toBe(true);
  });

  // Bend Luck pushes either way, which is why direction is a parameter rather
  // than two functions.
  it('applies a flat penalty as readily as a flat bonus', () => {
    const rolled = check(scriptedRng([12]), sheet(), 'cha', { dc: 12 });
    const hindered = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([1]), rolled, {
        source: 'Bend Luck',
        flat: 3,
        direction: 'penalty',
      }),
      'hindered',
    );
    expect(hindered.total).toBe(9);
  });

  it('cannot rescue a test a condition failed outright', () => {
    const failed = save(scriptedRng([18]), sheet(), 'str', {
      dc: 5,
      conditions: conditionState(['paralyzed']),
    });
    const helped = unwrap(
      interveneAfterRoll(issuer(), scriptedRng([6]), failed, {
        source: 'Bardic Inspiration',
        dice: '1d6',
      }),
      'helped',
    );
    expect(helped.success).toBe(false);
  });
});

describe('rerollTest — Indomitable', () => {
  /**
   * SRD Indomitable: "If you fail a saving throw, you can reroll it with a
   * bonus equal to your Fighter level. **You must use the new roll.**"
   */
  it('replaces a failed save with the new roll', () => {
    const failed = save(scriptedRng([3]), sheet(), 'wis', { dc: 15 });
    expect(failed.success).toBe(false);

    const again = unwrap(
      rerollTest(issuer(), scriptedRng([14]), failed, { source: 'Indomitable', flat: 9 }),
      'again',
    );
    expect(again.natural).toBe(14);
    expect(again.total).toBe(23);
    expect(again.success).toBe(true);
  });

  // The sentence that matters: not take-the-better-of-two.
  it('keeps a reroll that comes up worse', () => {
    const failed = save(scriptedRng([9]), sheet(), 'wis', { dc: 15 });
    const again = unwrap(rerollTest(issuer(), scriptedRng([2]), failed), 'again');
    expect(again.natural).toBe(2);
    expect(again.total).toBeLessThan(failed.total);
    expect(again.success).toBe(false);
  });

  it('keeps the superseded roll on the record', () => {
    const failed = save(scriptedRng([3]), sheet(), 'wis', { dc: 15 });
    const again = unwrap(rerollTest(issuer(), scriptedRng([14]), failed), 'again');
    expect(again.supersedes).toEqual({ natural: 3, total: 3 });
  });

  it('carries the original modifiers into the reroll', () => {
    const s = sheet({ level: 5, abilities: scores({ con: 16 }), saveProficiencies: ['con'] });
    const failed = save(scriptedRng([2]), s, 'con', { dc: 15 });
    expect(failed.modifier).toBe(6);

    const again = unwrap(rerollTest(issuer(), scriptedRng([10]), failed), 'again');
    expect(again.total).toBe(16);
  });

  it('still cannot beat an automatic failure', () => {
    const failed = save(scriptedRng([2]), sheet(), 'str', {
      dc: 5,
      conditions: conditionState(['stunned']),
    });
    const again = unwrap(
      rerollTest(issuer(), scriptedRng([20]), failed, { source: 'Indomitable', flat: 9 }),
      'again',
    );
    expect(again.success).toBe(false);
  });
});

describe('an invalid operation consumes nothing', () => {
  /**
   * Rolling first and validating afterwards left a malformed bonus returning an
   * error *after* it had advanced the generator and consumed a roll id. A
   * rejected operation must leave authoritative state exactly where it was, or
   * a replay diverges from the live session that produced it.
   */
  it('leaves the generator and the roll counter untouched on a bad notation', () => {
    const i = issuer();
    const rng = createRng('seed');
    const before = rng.snapshot();

    const result = rollAbilityCheck(i, rng, sheet(), 'str', {
      dc: 10,
      bonuses: [{ source: 'Broken', dice: 'nonsense' }],
    });

    expect(isErr(result)).toBe(true);
    expect(i.count).toBe(0);
    expect(rng.snapshot()).toEqual(before);
  });

  it('does the same for a saving throw', () => {
    const i = issuer();
    const rng = createRng('seed');
    const before = rng.snapshot();
    expect(isErr(rollSavingThrow(i, rng, sheet(), 'wis', { dc: 10, bonuses: [{ source: 'x', dice: '??' }] }))).toBe(true);
    expect(i.count).toBe(0);
    expect(rng.snapshot()).toEqual(before);
  });

  // The other half of the rule: a legitimately resolved failure still costs a
  // roll. Only invalid operations are free.
  it('still consumes a roll for a check that simply fails', () => {
    const i = issuer();
    const rng = createRng('seed');
    const before = rng.snapshot();

    const result = unwrap(rollAbilityCheck(i, rng, sheet(), 'str', { dc: 30 }), 'failed');
    expect(result.success).toBe(false);
    expect(i.count).toBeGreaterThan(0);
    expect(rng.snapshot()).not.toEqual(before);
  });
});
