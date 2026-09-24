import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { expect as unwrap } from '@ie/shared';
import { extendContent } from './content.js';
import { checkCharacter, type CharacterChoices } from './creation.js';

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
 * it.** No SRD feature gates points on a repeatable option; the check that
 * reads them finds its own answer key, so a repeated question asking for
 * points would report the *first* copy's answer once per copy — one mistake
 * told twice, which is the second-worst thing a validator can do. Homebrew is
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
  featureChoices: { 'human:skillful': ['perception'], ...featureChoices },
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
   * One mistake, told once. `checkAbilityChoice` finds its own answer key, so
   * a question asked twice would otherwise report the first copy's answer once
   * per copy — see `creation.ts`, where the guard says so.
   */
  it('reports a bad spread of points once however many copies asked for them', () => {
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
  });
});
