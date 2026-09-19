import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { fold } from './events.js';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';
import type { FeatDefinition } from './origins.js';

/**
 * A grant read off a **feat**, and a question asked of one.
 *
 * The host the `ability-score` vocabulary was built without. SRD prints both
 * advancement sentences on a feat rather than on the class feature that hands
 * one out — `classes.md`: "You gain the Ability Score Improvement feat ... or
 * another feat of your choice for which you qualify"; `feats.md`: "Increase
 * one ability score of your choice by 2, or increase two ability scores of
 * your choice by 1" — so a feat has to be able to ask which scores, to be
 * gated on a level, and to have the ceiling it lifts read off it.
 *
 * Driven here through homebrew, for `content.test.ts`'s reason: a mechanic
 * proved only against the book's own catalogue is a mechanic that might be
 * reading the book. The SRD's own feats are driven against the printed
 * classes in `packages/content/src/advancement-features.test.ts`.
 */

const WHO = asCharacterId('vashti');

/** The Ability Score Improvement's sentence, said by a feat nobody printed. */
const REFINEMENT: FeatDefinition = {
  id: 'refinement',
  name: 'Refinement',
  category: 'general',
  requires: { kind: 'ability-score', spreads: [[2], [1, 1]] },
  minimumLevel: 4,
  repeatable: true,
  note: 'The whole of the feat is the points; nothing is left to a DM.',
};

/** An Epic Boon's: one point, a lifted ceiling, and a narrowed set to spend it in. */
const BOON_OF_SINEW: FeatDefinition = {
  id: 'boon-of-sinew',
  name: 'Boon of Sinew',
  category: 'epic-boon',
  requires: { kind: 'ability-score', spreads: [[1]], from: ['str', 'dex'] },
  minimumLevel: 19,
  repeatable: false,
  grants: { kind: 'ability-score-increase', maximum: 30 },
  note: 'The increase is applied; this boon has no second benefit.',
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { feats: [REFINEMENT, BOON_OF_SINEW] }),
  'extend',
);

const ASI = 'fighter:ability-score-improvement';
const BOON = 'fighter:epic-boon';

/** A Fighter at whatever level, with every choice this file is not about made. */
const fighter = (level: number, over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Vashti',
  classId: 'fighter',
  level,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { str: 2, con: 1 },
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
  ...(level >= 3 ? { subclassId: 'champion' } : {}),
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
    ...(level >= 7 ? { 'champion:additional-fighting-style': { featId: 'archery' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'none' },
  ...over,
});

const codesFor = (choices: CharacterChoices, content: Content = CONTENT): readonly string[] =>
  checkCharacter(content, choices).map((problem) => problem.code);

const scoresOf = (choices: CharacterChoices, content: Content = CONTENT) =>
  unwrap(planCharacter(content, choices), 'plan').sheet.abilities;

/** The base Fighter's choices with one feat written in at one feature. */
const taking = (
  level: number,
  at: string,
  feat: Record<string, unknown>,
  more: Readonly<Record<string, Record<string, unknown>>> = {},
  over: Partial<CharacterChoices> = {},
): CharacterChoices => {
  const base = fighter(level, over);
  return {
    ...base,
    feats: { ...base.feats, [at]: feat, ...more } as CharacterChoices['feats'],
  };
};

describe('a feat that asks which ability scores to raise', () => {
  it('is refused when the feat was taken and no scores were named', () => {
    expect(codesFor(taking(4, ASI, { featId: 'refinement' }))).toContain('missing_ability_choice');
  });

  it('puts two points into one score where the player put them', () => {
    const scores = scoresOf(
      taking(4, ASI, { featId: 'refinement', abilities: ['str', 'str'] }),
    );
    expect(scores.str).toBe(19);
  });

  it('puts one point into each of two scores where the player put them', () => {
    const scores = scoresOf(taking(4, ASI, { featId: 'refinement', abilities: ['dex', 'con'] }));
    expect(scores.dex).toBe(15);
    expect(scores.con).toBe(15);
    expect(scores.str).toBe(17);
  });

  it('refuses a spread the feat’s own sentence does not print', () => {
    expect(codesFor(taking(4, ASI, { featId: 'refinement', abilities: ['str'] }))).toContain(
      'ability_spread_not_offered',
    );
  });

  it('refuses a pick that is not one of the six abilities', () => {
    expect(
      codesFor(taking(4, ASI, { featId: 'refinement', abilities: ['luck', 'luck'] })),
    ).toContain('unknown_ability');
  });

  it('refuses a score outside the set the feat narrows to', () => {
    expect(
      codesFor(
        taking(
          19,
          ASI,
          { featId: 'refinement', abilities: ['wis', 'cha'] },
          { [BOON]: { featId: 'boon-of-sinew', abilities: ['wis'] } },
        ),
      ),
    ).toContain('ability_not_offered');
  });
});

describe('a level a feat is gated on', () => {
  it('refuses a character below the level the feat prints', () => {
    // The level 4 feature offers any feat the character qualifies for, and
    // the boon's bracket says Level 19+. The refusal names the level rather
    // than quietly awarding a point a level 4 character has not earned.
    expect(
      codesFor(taking(4, ASI, { featId: 'boon-of-sinew', abilities: ['str'] })),
    ).toContain('feat_level_too_low');
  });

  it('allows the same feat at the level it prints', () => {
    expect(codesFor(taking(4, ASI, { featId: 'refinement', abilities: ['str', 'dex'] }))).toEqual(
      [],
    );
  });
});

describe('a ceiling read off a feat, for the score it raised and no other', () => {
  const tall: Partial<CharacterChoices> = {
    abilities: {
      method: 'manual',
      assignment: { str: 18, dex: 20, con: 13, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { str: 2, con: 1 },
  };

  /**
   * The Fighter's table prints the Improvement six times, so a level 19 one
   * owes five more grants than this file is about. They take the SRD's own
   * repeatable Improvement feat and put its points into Charisma, which
   * nothing here reads.
   */
  const spare = (): Readonly<Record<string, Record<string, unknown>>> =>
    Object.fromEntries(
      [2, 3, 4, 5, 6].map((ordinal) => [
        `${ASI}-${ordinal}`,
        { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
      ]),
    );

  const atNineteen = (boon: readonly string[], asi: readonly string[] = ['wis', 'cha']) =>
    taking(
      19,
      ASI,
      { featId: 'refinement', abilities: asi },
      { [BOON]: { featId: 'boon-of-sinew', abilities: boon }, ...spare() },
      tall,
    );

  it('lets the score the boon named pass twenty', () => {
    expect(scoresOf(atNineteen(['str'])).str).toBe(21);
  });

  it('still refuses the score it did not name', () => {
    expect(codesFor(atNineteen(['str'], ['dex', 'wis']))).toContain('score_above_maximum');
  });

  it('builds a level 19 character end to end and folds the scores onto the sheet', () => {
    const log = unwrap(createCharacter(CONTENT, atNineteen(['str']), WHO), 'create');
    const creature = fold('seed', log).creatures[WHO];
    expect(creature?.sheet.level).toBe(19);
    expect(creature?.sheet.abilities.str).toBe(21);
    expect(creature?.sheet.abilities.dex).toBe(20);
  });

  it('is honoured by advancement as well as by creation', () => {
    const log = unwrap(createCharacter(CONTENT, fighter(3), WHO), 'create');
    const up = unwrap(
      advanceCharacter(fold('seed', log), CONTENT, WHO, {
        feats: { [ASI]: { featId: 'refinement', abilities: ['str', 'str'] } },
      }),
      'advance',
    );
    const after = fold('seed', [...log, ...up]);
    expect(after.creatures[WHO]?.sheet.level).toBe(4);
    expect(after.creatures[WHO]?.sheet.abilities.str).toBe(19);
  });
});

describe('what the vocabulary refuses at the door', () => {
  const codesOf = (feat: unknown): readonly string[] =>
    checkContent({ feats: [feat as FeatDefinition] }).map((problem) => problem.code);

  it('accepts the two feats as written, so the refusals below are not free', () => {
    expect(codesOf(REFINEMENT)).toEqual([]);
    expect(codesOf(BOON_OF_SINEW)).toEqual([]);
  });

  it('refuses a feat asking for points with no branch at all', () => {
    expect(codesOf({ ...REFINEMENT, requires: { kind: 'ability-score', spreads: [] } })).toContain(
      'bad_ability_spread',
    );
  });

  it('refuses two branches of one sentence that hand out different totals', () => {
    expect(
      codesOf({ ...REFINEMENT, requires: { kind: 'ability-score', spreads: [[2], [1]] } }),
    ).toContain('uneven_ability_spreads');
  });

  it('refuses a narrowing that names something that is not an ability', () => {
    expect(
      codesOf({
        ...BOON_OF_SINEW,
        requires: { kind: 'ability-score', spreads: [[1]], from: ['luck'] },
      }),
    ).toContain('bad_ability_choice');
  });

  it('refuses a narrowing too small for the widest branch to be answered in', () => {
    expect(
      codesOf({
        ...REFINEMENT,
        requires: { kind: 'ability-score', spreads: [[2], [1, 1]], from: ['str'] },
      }),
    ).toContain('bad_ability_choice');
  });

  it('refuses a level prerequisite that is not a level a character reaches', () => {
    expect(codesOf({ ...REFINEMENT, minimumLevel: 0 })).toContain('bad_feat_level');
    expect(codesOf({ ...REFINEMENT, minimumLevel: 21 })).toContain('bad_feat_level');
  });

  it('refuses a ceiling on a feat that raises nothing and asks for nothing', () => {
    expect(codesOf({ ...BOON_OF_SINEW, requires: { kind: 'none' } })).toContain(
      'ability_maximum_lifts_nothing',
    );
  });

  it('refuses a feat that both names its scores and asks which', () => {
    expect(
      codesOf({
        ...BOON_OF_SINEW,
        grants: {
          kind: 'ability-score-increase',
          raises: [{ ability: 'str', points: 1 }],
          maximum: 30,
        },
      }),
    ).toContain('ability_raise_and_choice');
  });

  /** The one the whole list exists for: a grant nobody reads off a feat. */
  it('still refuses a grant kind nothing reads off a feat', () => {
    expect(codesOf({ ...REFINEMENT, grants: { kind: 'expertise' } })).toContain(
      'feat_grant_not_read',
    );
  });
});

/**
 * The point of a vocabulary: a world that is not the SRD says the same
 * sentence through the same door and the engine does not change.
 */
describe('a homebrew feat says it through loadContent', () => {
  it('loads from JSON text and raises the scores it was given', () => {
    const text = JSON.stringify({ feats: [REFINEMENT, BOON_OF_SINEW] });
    const loaded = unwrap(loadContent(JSON.parse(text) as unknown), 'load');
    expect(loaded.featById('refinement')?.requires).toEqual({
      kind: 'ability-score',
      spreads: [[2], [1, 1]],
    });
    expect(loaded.featById('boon-of-sinew')?.minimumLevel).toBe(19);

    const whole = unwrap(extendContent(SRD_CONTENT, { feats: [...loaded.feats] }), 'extend');
    const scores = scoresOf(
      taking(4, ASI, { featId: 'refinement', abilities: ['int', 'wis'] }),
      whole,
    );
    expect(scores.int).toBe(13);
    expect(scores.wis).toBe(11);
  });
});
