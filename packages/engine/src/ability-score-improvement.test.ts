import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { ABILITY_SCORE_MAXIMUM } from './character.js';
import { checkContent, extendContent, loadContent } from './content.js';
import { fold } from './events.js';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';

/**
 * Two points of ability, and a score above twenty.
 *
 * The two shapes every class printed and nothing could say: an Ability Score
 * Improvement taken as **scores** rather than as a feat, and an Epic Boon that
 * lifts one score's ceiling past 20. Both are advancement rather than combat,
 * which is why no amount of work on spells or items would ever have found
 * them.
 *
 * Driven here through a homebrew class, for `content.test.ts`'s reason: a
 * mechanic proved only against the book's own catalogue is a mechanic that
 * might be reading the book. Every SRD feature that uses it is driven in
 * `packages/content/src/advancement-features.test.ts`, against the printed
 * classes.
 *
 * **The fork is not here any more, because the book does not print it here.**
 * SRD writes level 4 as "You gain the Ability Score Improvement feat ... or
 * another feat of your choice", so the choice between the points and a feat
 * is a choice between two *feats* — and `orFeat` is gone with the two tests
 * that drove it. The feat's half of the same sentence is
 * `feat-ability-scores.test.ts`; what is left here is the feature's own, which
 * no SRD class writes and homebrew may.
 */

const id = (s: string) => asCharacterId(s);
const WHO = id('ascendant');

/**
 * A homebrew class carrying all three shapes: an improvement that asks, a boon
 * that asks and lifts a ceiling, and a capstone that raises two scores
 * outright and lifts theirs.
 */
const ASCENDANT = {
  id: 'ascendant',
  name: 'Ascendant',
  primaryAbility: 'str',
  hitDie: 10,
  saveProficiencies: ['str', 'con'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 10 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  features: [
    {
      id: 'ascendant:subclass',
      name: 'Ascendant Path',
      level: 3,
      automation: 'engine',
      note: 'The path is chosen at level 3, as every class chooses one.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'ascendant:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'Increase one ability score by 2, or two ability scores by 1 each, or take a feat.',
      choice: { kind: 'ability-score', spreads: [[2], [1, 1]] },
    },
    {
      id: 'ascendant:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'Increase one ability score by 1, to a maximum of 30.',
      choice: { kind: 'ability-score', spreads: [[1]] },
      grants: { kind: 'ability-score-increase', maximum: 30 },
    },
    {
      id: 'ascendant:apotheosis',
      name: 'Apotheosis',
      level: 20,
      automation: 'engine',
      note: 'Strength and Constitution increase by 4, to a maximum of 25.',
      grants: {
        kind: 'ability-score-increase',
        raises: [
          { ability: 'str', points: 4 },
          { ability: 'con', points: 4 },
        ],
        maximum: 25,
      },
    },
  ],
};

const PATH = {
  id: 'path-of-ascent',
  name: 'Path of Ascent',
  classId: 'ascendant',
  features: [],
};

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { classes: [ASCENDANT as never], subclasses: [PATH as never] }),
  'extend',
);

/** A legal Ascendant at whatever level, with every other choice already made. */
const ascendant = (level: number, over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Vashti',
  classId: 'ascendant',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  ...(level >= 3 ? { subclassId: 'path-of-ascent' } : {}),
  featureChoices: { 'human:skillful': ['perception'] },
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
  ...over,
});

/** The character's choices with one feature's ability answer written in. */
const raising = (
  level: number,
  answers: Readonly<Record<string, readonly string[]>>,
  over: Partial<CharacterChoices> = {},
): CharacterChoices => {
  const base = ascendant(level, over);
  return { ...base, featureChoices: { ...base.featureChoices, ...answers } };
};

const codesFor = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(CONTENT, choices).map((problem) => problem.code);

const scoresOf = (choices: CharacterChoices) =>
  unwrap(planCharacter(CONTENT, choices), 'plan').sheet.abilities;

const ASI = 'ascendant:ability-score-improvement';
const BOON = 'ascendant:epic-boon';

describe('a choice that raises ability scores', () => {
  it('is offered by the feature and refused when nothing answered it', () => {
    expect(codesFor(ascendant(4))).toContain('missing_feature_choice');
  });

  it('puts two points into one score where the player put them', () => {
    expect(scoresOf(raising(4, { [ASI]: ['str', 'str'] })).str).toBe(17);
  });

  it('puts one point into each of two scores where the player put them', () => {
    const scores = scoresOf(raising(4, { [ASI]: ['str', 'dex'] }));
    expect(scores.str).toBe(16);
    expect(scores.dex).toBe(15);
  });

  it('leaves every other score exactly where the assignment and the background left it', () => {
    const scores = scoresOf(raising(4, { [ASI]: ['str', 'str'] }));
    expect(scores).toEqual({ str: 17, dex: 14, con: 15, int: 13, wis: 10, cha: 8 });
  });

  it('refuses a spread the feature’s own sentence does not print', () => {
    expect(codesFor(raising(4, { [ASI]: ['str'] }))).toContain('ability_spread_not_offered');
    expect(codesFor(raising(4, { [ASI]: ['str', 'dex', 'con'] }))).toContain(
      'ability_spread_not_offered',
    );
  });

  it('refuses a pick that is not one of the six abilities', () => {
    expect(codesFor(raising(4, { [ASI]: ['luck', 'luck'] }))).toContain('unknown_ability');
  });

  /** And the level a choice arrives at is the level it is asked at. */
  it('asks nothing of a character who has not reached the level', () => {
    expect(codesFor(ascendant(3))).toEqual([]);
  });

  it('is honoured by advancement as well as by creation', () => {
    const log = unwrap(createCharacter(CONTENT, ascendant(3), WHO), 'create');
    const state = fold('seed', log);
    const up = unwrap(
      advanceCharacter(state, CONTENT, WHO, { featureChoices: { [ASI]: ['str', 'str'] } }),
      'advance',
    );
    const after = fold('seed', [...log, ...up]);
    expect(after.creatures[WHO]?.sheet.abilities.str).toBe(17);
    expect(after.creatures[WHO]?.sheet.level).toBe(4);
  });
});

describe('the twentieth point is the last one without a boon', () => {
  it('names twenty as the maximum every score of every character keeps', () => {
    expect(ABILITY_SCORE_MAXIMUM).toBe(20);
  });

  it('refuses a twenty-first point', () => {
    const tall = {
      abilities: {
        method: 'manual' as const,
        assignment: { str: 19, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      },
      abilityIncreases: { con: 2, int: 1 },
    };
    expect(codesFor(raising(4, { [ASI]: ['str', 'str'] }, tall))).toContain('score_above_maximum');
    // And the same character taking one point in that score is legal.
    expect(codesFor(raising(4, { [ASI]: ['str', 'dex'] }, tall))).toEqual([]);
  });
});

describe('a maximum a boon lifts, for one score and not for another', () => {
  const tall = {
    abilities: {
      method: 'manual' as const,
      assignment: { str: 20, dex: 20, con: 13, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { con: 2, int: 1 },
  };

  /** Every other choice a level 19 Ascendant owes, so the boon is the subject. */
  const atNineteen = (answers: Readonly<Record<string, readonly string[]>>) =>
    raising(19, { [ASI]: ['wis', 'cha'], ...answers }, tall);

  it('lets the score the boon named pass twenty', () => {
    expect(scoresOf(atNineteen({ [BOON]: ['str'] })).str).toBe(21);
  });

  it('still refuses the score it did not name', () => {
    // The boon raised Strength; Dexterity is at 20 and the improvement would
    // be its twenty-first point.
    const codes = codesFor(
      raising(19, { [ASI]: ['dex', 'wis'], [BOON]: ['str'] }, tall),
    );
    expect(codes).toContain('score_above_maximum');
  });

  /** A capstone that names its own scores and asks nothing. */
  it('raises the scores a capstone names outright, past twenty, to its own ceiling', () => {
    const scores = scoresOf(
      raising(20, { [ASI]: ['wis', 'cha'], [BOON]: ['str'] }, tall),
    );
    expect(scores.str).toBe(25);
    expect(scores.con).toBe(19);
    expect(scores.dex).toBe(20);
  });

  /** Two ceilings on one character, each governing the score it was lifted for. */
  it('refuses a capstone’s score past the capstone’s ceiling and not past the boon’s', () => {
    const tallStrength = {
      abilities: {
        method: 'manual' as const,
        assignment: { str: 20, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      },
      abilityIncreases: { con: 2, int: 1 },
    };
    // Strength: 20, the improvement's two points, the capstone's four — 26,
    // past the 25 the capstone lifted it to. The boon raised Wisdom.
    expect(
      codesFor(raising(20, { [ASI]: ['str', 'str'], [BOON]: ['wis'] }, tallStrength)),
    ).toContain('score_above_maximum');

    // And the same total under the boon's own ceiling of 30 is legal: the
    // boon named Strength this time, so 20 + 2 + 1 + 4 is 27 and allowed.
    expect(
      codesFor(raising(20, { [ASI]: ['str', 'str'], [BOON]: ['str'] }, tallStrength)),
    ).toEqual([]);
  });
});

describe('what the vocabulary refuses at the door', () => {
  const withFeature = (change: (feature: Record<string, unknown>) => void): readonly string[] => {
    const copy = JSON.parse(JSON.stringify(ASCENDANT)) as typeof ASCENDANT;
    change(copy.features[1] as unknown as Record<string, unknown>);
    return checkContent({ classes: [copy as never], subclasses: [PATH as never] }).map(
      (problem) => problem.code,
    );
  };

  it('accepts the class as written, so the refusals below are not free', () => {
    expect(withFeature(() => {})).toEqual([]);
  });

  it('refuses a choice that prints no spread at all', () => {
    expect(withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = []; })).toContain(
      'bad_ability_spread',
    );
  });

  it('refuses a spread that puts no points anywhere', () => {
    expect(
      withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = [[]]; }),
    ).toContain('bad_ability_spread');
  });

  it('refuses a spread counted in something other than whole points', () => {
    expect(
      withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = [[1.5]]; }),
    ).toContain('bad_ability_spread');
    expect(
      withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = [[0]]; }),
    ).toContain('bad_ability_spread');
  });

  /**
   * The rule that lets the answer's length be read off the spreads: two
   * branches of one sentence hand out the same number of points.
   */
  it('refuses two branches that hand out different totals', () => {
    expect(
      withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = [[2], [1]]; }),
    ).toContain('uneven_ability_spreads');
  });

  it('refuses the same branch printed twice', () => {
    expect(
      withFeature((f) => { (f['choice'] as Record<string, unknown>)['spreads'] = [[1, 1], [1, 1]]; }),
    ).toContain('duplicate_ability_spread');
  });

  it('refuses a branch that wants more scores than a creature has', () => {
    expect(
      withFeature((f) => {
        (f['choice'] as Record<string, unknown>)['spreads'] = [[1, 1, 1, 1, 1, 1, 1]];
      }),
    ).toContain('bad_ability_spread');
  });

  const withGrant = (change: (grant: Record<string, unknown>) => void): readonly string[] => {
    const copy = JSON.parse(JSON.stringify(ASCENDANT)) as typeof ASCENDANT;
    change(copy.features[3]!.grants as unknown as Record<string, unknown>);
    return checkContent({ classes: [copy as never], subclasses: [PATH as never] }).map(
      (problem) => problem.code,
    );
  };

  it('refuses a grant that neither raises a score nor lifts a ceiling', () => {
    expect(
      withGrant((g) => {
        delete g['raises'];
        delete g['maximum'];
      }),
    ).toContain('empty_ability_grant');
  });

  it('refuses a raise that names something that is not an ability', () => {
    expect(withGrant((g) => { g['raises'] = [{ ability: 'luck', points: 4 }]; })).toContain(
      'bad_ability_raise',
    );
  });

  it('refuses a raise counted in something other than whole points', () => {
    expect(withGrant((g) => { g['raises'] = [{ ability: 'str', points: 0 }]; })).toContain(
      'bad_ability_raise',
    );
  });

  it('refuses one ability raised twice by one sentence', () => {
    expect(
      withGrant((g) => {
        g['raises'] = [
          { ability: 'str', points: 2 },
          { ability: 'str', points: 2 },
        ];
      }),
    ).toContain('duplicate_ability_raise');
  });

  /** A ceiling that is not above the general one moves nothing. */
  it('refuses a maximum at or below the one every score already has', () => {
    expect(withGrant((g) => { g['maximum'] = 20; })).toContain('bad_ability_maximum');
    expect(withGrant((g) => { g['maximum'] = 25.5; })).toContain('bad_ability_maximum');
  });

  /**
   * And a ceiling with nothing under it: a feature that lifts a maximum for
   * scores it neither names nor asks about lifts it for nobody.
   */
  it('refuses a maximum on a feature that raises no score and asks for none', () => {
    const copy = JSON.parse(JSON.stringify(ASCENDANT)) as typeof ASCENDANT;
    const feature = copy.features[3] as unknown as Record<string, unknown>;
    feature['grants'] = { kind: 'ability-score-increase', maximum: 30 };
    expect(
      checkContent({ classes: [copy as never], subclasses: [PATH as never] }).map((p) => p.code),
    ).toContain('ability_maximum_lifts_nothing');
  });

  /** One sentence or the other: a feature names the scores, or it asks. */
  it('refuses a feature that both names its scores and asks which', () => {
    const copy = JSON.parse(JSON.stringify(ASCENDANT)) as typeof ASCENDANT;
    const feature = copy.features[3] as unknown as Record<string, unknown>;
    feature['choice'] = { kind: 'ability-score', spreads: [[1]] };
    expect(
      checkContent({ classes: [copy as never], subclasses: [PATH as never] }).map((p) => p.code),
    ).toContain('ability_raise_and_choice');
  });
});

/**
 * The whole point of the vocabulary: a world that is not the SRD says the same
 * sentence through the same door and the engine does not change.
 */
describe('a homebrew class says it through loadContent', () => {
  it('loads from JSON text and raises the scores it was given', () => {
    const text = JSON.stringify({ classes: [ASCENDANT], subclasses: [PATH] });
    const loaded = unwrap(loadContent(JSON.parse(text)), 'load');
    expect(loaded.classById('ascendant')?.features.map((f) => f.id)).toContain(ASI);

    const whole = unwrap(
      extendContent(SRD_CONTENT, {
        classes: [...loaded.classes],
        subclasses: [...loaded.subclasses],
      }),
      'extend',
    );
    const plan = unwrap(
      planCharacter(whole, raising(4, { [ASI]: ['con', 'str'] })),
      'plan',
    );
    expect(plan.sheet.abilities.con).toBe(16);
    expect(plan.sheet.abilities.str).toBe(16);
  });

  it('is refused by a world that has never heard of the class', () => {
    const refused = createCharacter(SRD_CONTENT, raising(4, { [ASI]: ['str', 'str'] }), WHO);
    expect(isErr(refused)).toBe(true);
  });
});
