import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { expect as unwrap } from '@ie/shared';
import { extendContent } from './content.js';
import { checkCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * An option a feature lets its holder take more than once, driven through
 * homebrew.
 *
 * SRD writes the licence on four Eldritch Invocations and always in two
 * sentences: "You can gain this invocation more than once. Each time you do
 * so, choose a different qualifying cantrip." The second is what the first is
 * worth — two copies on one cantrip would be an invocation spent on what its
 * holder already had — so a repeat asks the gated question again, under a key
 * of its own, and a repeat that names an earlier answer is refused.
 *
 * Driven here against a class the book never printed, for `content.test.ts`'s
 * reason: a mechanic proved only against the SRD catalogue is a mechanic that
 * might be reading the SRD. The printed Warlock drives the same vocabulary in
 * `packages/content/src/eldritch-invocations.test.ts`.
 *
 * **And the `ability-score` question is here because nothing else can reach
 * it.** No SRD feature gates points on a repeatable option, and both readers
 * of one used to find their own answer key — so a repeated question asking
 * for points would have had its first copy checked twice, its second checked
 * by nothing, and its second spent by nothing: an answer accepted, unread and
 * unpaid, which is the shape `unaskedAnswers` exists to refuse. Homebrew is
 * the only door onto that pairing, and this is it.
 */

const COLUMN = Array.from({ length: 20 }, (_, index) => (index < 2 ? 1 : 2));

const RITES = {
  id: 'rite-keeper',
  name: 'Rite Keeper',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['arcana', 'religion', 'insight', 'nature'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'club', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'rite-keeper:rites',
      name: 'Rites',
      level: 1,
      automation: 'engine',
      note: 'Two rites, one of which may be taken twice — and each time it is, another skill is honed and another point of ability is spent.',
      choices: [
        {
          kind: 'option',
          chooseByLevel: COLUMN,
          from: ['Honing', 'Warding'],
          repeatable: ['Honing'],
        },
        { key: 'honed', kind: 'skill', choose: 1, onlyIfChoice: 'Honing' },
        { key: 'spent', kind: 'ability-score', spreads: [[2]], onlyIfChoice: 'Honing' },
      ],
    },
    {
      id: 'rite-keeper:lore',
      name: 'Lore',
      level: 1,
      automation: 'engine',
      note: 'Two fields of study, and they are two rather than one field studied twice.',
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'rite-keeper:subclass',
      name: 'Rite Keeper Order',
      level: 3,
      automation: 'engine',
      note: 'The order is chosen at level 3, as every class chooses one.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
  ],
};

const ORDER = { id: 'order-of-the-hour', name: 'Order of the Hour', classId: 'rite-keeper', features: [] };

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { classes: [RITES as never], subclasses: [ORDER as never] }),
  'extend',
);

const RITE = 'rite-keeper:rites';

/** A Rite Keeper at the level whose column offers two rites. */
const keeper = (
  featureChoices: Readonly<Record<string, readonly string[]>>,
  level = 3,
): CharacterChoices => ({
  name: 'Ilvar',
  classId: 'rite-keeper',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'religion'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  subclassId: 'order-of-the-hour',
  featureChoices: {
    'human:skillful': ['perception'],
    'rite-keeper:lore': ['nature', 'insight'],
    ...featureChoices,
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'none' },
});

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(CONTENT, choices).map((problem) => problem.code);

describe('an option a feature lets its holder take twice', () => {
  it('asks its gated questions once per copy, under a key each', () => {
    expect(
      codes(
        keeper({
          [RITE]: ['Honing', 'Honing'],
          [`${RITE}:honed`]: ['athletics'],
          [`${RITE}:honed#2`]: ['stealth'],
          [`${RITE}:spent`]: ['wis', 'wis'],
          [`${RITE}:spent#2`]: ['con', 'con'],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a copy that names what an earlier copy named', () => {
    expect(
      codes(
        keeper({
          [RITE]: ['Honing', 'Honing'],
          [`${RITE}:honed`]: ['athletics'],
          [`${RITE}:honed#2`]: ['athletics'],
          [`${RITE}:spent`]: ['wis', 'wis'],
          [`${RITE}:spent#2`]: ['con', 'con'],
        }),
      ),
    ).toContain('repeat_names_the_same');
  });

  it('wants the second copy answered as well as the first', () => {
    expect(
      codes(
        keeper({
          [RITE]: ['Honing', 'Honing'],
          [`${RITE}:honed`]: ['athletics'],
          [`${RITE}:spent`]: ['wis', 'wis'],
          [`${RITE}:spent#2`]: ['con', 'con'],
        }),
      ),
    ).toContain('missing_feature_choice');
  });

  it('still refuses a second copy of an option carrying no licence', () => {
    expect(codes(keeper({ [RITE]: ['Warding', 'Warding'] }))).toContain('duplicate_option');
  });

  /**
   * **Each copy's spread is held to the feature's own sentence on its own.**
   * The reader used to find its own answer key, which would have validated
   * the first copy twice and the second never — an answer accepted and read
   * by nothing, which is what `askedWithKeys` exists to prevent.
   */
  it('holds each copy’s spread to the sentence, and only the bad one', () => {
    const problems = codes(
      keeper({
        [RITE]: ['Honing', 'Honing'],
        [`${RITE}:honed`]: ['athletics'],
        [`${RITE}:honed#2`]: ['stealth'],
        [`${RITE}:spent`]: ['wis'],
        [`${RITE}:spent#2`]: ['con', 'con'],
      }),
    );
    expect(problems.filter((code) => code === 'ability_spread_not_offered')).toHaveLength(1);

    // And the same mistake in the second copy is caught, which is what a
    // reader that only ever looked at the first would have missed.
    const second = codes(
      keeper({
        [RITE]: ['Honing', 'Honing'],
        [`${RITE}:honed`]: ['athletics'],
        [`${RITE}:honed#2`]: ['stealth'],
        [`${RITE}:spent`]: ['wis', 'wis'],
        [`${RITE}:spent#2`]: ['con'],
      }),
    );
    expect(second.filter((code) => code === 'ability_spread_not_offered')).toHaveLength(1);
  });

  /** And both copies are **spent**, not merely validated. */
  it('pays out every copy’s points', () => {
    const scores = unwrap(
      planCharacter(
        CONTENT,
        keeper({
          [RITE]: ['Honing', 'Honing'],
          [`${RITE}:honed`]: ['athletics'],
          [`${RITE}:honed#2`]: ['stealth'],
          [`${RITE}:spent`]: ['wis', 'wis'],
          [`${RITE}:spent#2`]: ['con', 'con'],
        }),
      ),
      'plan',
    ).sheet.abilities;
    // Wisdom 15 and Constitution 13 + 2 from the background, each raised by
    // one copy's two points.
    expect(scores.wis).toBe(17);
    expect(scores.con).toBe(17);
  });

  /**
   * A skill named twice in one answer is one proficiency wearing two of the
   * feature's picks, and it is refused where that question is checked rather
   * than by the across-copies rule.
   */
  it('refuses a skill named twice inside one answer', () => {
    expect(
      codes(
        keeper({
          [RITE]: ['Honing', 'Warding'],
          [`${RITE}:honed`]: ['athletics'],
          [`${RITE}:spent`]: ['wis', 'wis'],
          'rite-keeper:lore': ['nature', 'nature'],
        }),
      ),
    ).toContain('duplicate_skill');
  });
});
