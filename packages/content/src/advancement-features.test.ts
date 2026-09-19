import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  fold,
  planCharacter,
  type CharacterChoices,
  type CreationProblem,
  type FeatureDefinition,
  type GameEvent,
} from '@ie/engine';

/**
 * The twenty-six printed features that raise an ability score.
 *
 * Twelve Ability Score Improvements, twelve Epic Boons and the two capstones
 * that raise two scores outright — every feature in the catalogue that the two
 * retired shapes blocked. The vocabulary itself is driven in
 * `packages/engine/src/ability-score-improvement.test.ts` against a homebrew
 * class, so what is asked here is the other question: does **the book's own
 * feature**, at the level the book grants it, offer the choice, take the
 * answer and refuse a spread it does not print.
 *
 * Every class is driven through the real `checkCharacter`, which answers every
 * question about a set of choices rather than the first — so a Wizard whose
 * spellbook this fixture has not filled in still gives a complete answer about
 * its Ability Score Improvement, and the assertions read only that feature's
 * problems. The two classes with no spells to fill in — Barbarian and Monk —
 * are built all the way through `createCharacter` and `planCharacter`
 * afterwards, where the points land on a sheet.
 */

/**
 * The twelve, written out rather than read off the catalogue.
 *
 * `blocked-on.test.ts`'s rule: a population derived from the thing under test
 * agrees with it by construction, so the list is typed and the first
 * assertion below holds it to what the catalogue publishes.
 */
const CLASSES: readonly string[] = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
];

/** The subclass the catalogue actually publishes for each class. */
const subclassFor = (classId: string): string => {
  const found = SRD_CONTENT.subclasses.find((one) => one.classId === classId);
  if (found === undefined) throw new Error(`no subclass for ${classId}`);
  return found.id;
};

const featureOn = (classId: string, suffix: string): FeatureDefinition => {
  const found = SRD_CONTENT.classById(classId)?.features.find(
    (feature) => feature.id === `${classId}:${suffix}`,
  );
  if (found === undefined) throw new Error(`${classId} has no ${suffix}`);
  return found;
};

/**
 * A character of this class at this level, with everything this test is not
 * about left as it comes.
 *
 * Deliberately not a complete character for the casters: filling in twenty
 * levels of prepared spells for eleven classes would be a fixture about
 * spellbooks. `checkCharacter` reports every problem, and {@link about} reads
 * only the ones this feature caused.
 */
const character = (
  classId: string,
  level: number,
  featureChoices: Readonly<Record<string, readonly string[]>> = {},
  feats: Readonly<Record<string, { readonly featId: string }>> = {},
): CharacterChoices => ({
  name: 'Vashti',
  classId,
  level,
  subclassId: subclassFor(classId),
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: [],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
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
    ...feats,
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** The problems one feature caused, out of everything wrong with the sheet. */
const about = (
  problems: readonly CreationProblem[],
  feature: FeatureDefinition,
): readonly CreationProblem[] =>
  problems.filter(
    (problem) => problem.reason.includes(feature.id) || problem.reason.startsWith(feature.name),
  );

const codesAbout = (choices: CharacterChoices, feature: FeatureDefinition): readonly string[] =>
  about(checkCharacter(SRD_CONTENT, choices), feature).map((problem) => problem.code);

describe('every class prints an Ability Score Improvement that raises scores', () => {
  it('registers the twelve classes this file drives', () => {
    expect(SRD_CONTENT.classes.map((one) => one.id).sort()).toEqual(
      [...CLASSES].sort(),
    );
  });

  for (const classId of CLASSES) {
    describe(classId, () => {
      const feature = featureOn(classId, 'ability-score-improvement');
      const level = feature.level;

      it('is executed rather than left to the table', () => {
        expect(feature.automation).toBe('engine');
        expect(feature.choice).toEqual({
          kind: 'ability-score',
          spreads: [[2], [1, 1]],
          orFeat: {},
        });
      });

      it('offers the choice at the level the class grants it', () => {
        expect(codesAbout(character(classId, level - 1), feature)).toEqual([]);
        expect(codesAbout(character(classId, level), feature)).toEqual([
          'missing_feature_choice',
        ]);
      });

      it('takes two points into one score, or one into each of two', () => {
        expect(
          codesAbout(character(classId, level, { [feature.id]: ['str', 'str'] }), feature),
        ).toEqual([]);
        expect(
          codesAbout(character(classId, level, { [feature.id]: ['str', 'dex'] }), feature),
        ).toEqual([]);
      });

      it('refuses a spread the printed sentence does not offer', () => {
        expect(
          codesAbout(character(classId, level, { [feature.id]: ['str'] }), feature),
        ).toEqual(['ability_spread_not_offered']);
      });

      it('still takes a feat instead, and refuses both', () => {
        expect(
          codesAbout(
            character(classId, level, {}, { [feature.id]: { featId: 'savage-attacker' } }),
            feature,
          ),
        ).toEqual([]);
        expect(
          codesAbout(
            character(
              classId,
              level,
              { [feature.id]: ['str', 'str'] },
              { [feature.id]: { featId: 'savage-attacker' } },
            ),
            feature,
          ),
        ).toEqual(['ability_increase_and_feat']);
      });
    });
  }
});

describe('every class prints an Epic Boon that lifts one score past twenty', () => {
  for (const classId of CLASSES) {
    describe(classId, () => {
      const feature = featureOn(classId, 'epic-boon');
      const improvement = featureOn(classId, 'ability-score-improvement');
      const level = feature.level;
      /** The improvement is answered too, so the boon is the only subject. */
      const answered = (picks: readonly string[] | undefined) =>
        character(classId, level, {
          [improvement.id]: ['wis', 'cha'],
          ...(picks === undefined ? {} : { [feature.id]: picks }),
        });

      it('is executed, raises one score by one and lifts that score’s ceiling', () => {
        expect(feature.automation).toBe('engine');
        expect(feature.choice).toEqual({
          kind: 'ability-score',
          spreads: [[1]],
          orFeat: { category: 'epic-boon' },
        });
        expect(feature.grants).toEqual({ kind: 'ability-score-increase', maximum: 30 });
      });

      it('offers the choice at level nineteen and not before', () => {
        expect(level).toBe(19);
        expect(codesAbout(character(classId, 18), feature)).toEqual([]);
        expect(codesAbout(answered(undefined), feature)).toEqual(['missing_feature_choice']);
      });

      it('takes the one point the boon prints, and refuses two', () => {
        expect(codesAbout(answered(['str']), feature)).toEqual([]);
        expect(codesAbout(answered(['str', 'dex']), feature)).toEqual([
          'ability_spread_not_offered',
        ]);
      });
    });
  }
});

/**
 * The two classes whose whole sheet this fixture can fill in, driven all the
 * way to a folded creature.
 *
 * Neither casts, so the points and the ceilings are the only things left to
 * get wrong — which is what makes them the pair worth building rather than
 * checking.
 */
describe('a Barbarian and a Monk carry the points onto a sheet', () => {
  const WHO = asCharacterId('vashti');

  /** A complete Barbarian, at whatever level, with every choice answered. */
  const barbarian = (
    level: number,
    over: Partial<CharacterChoices> = {},
    boon = 'str',
  ): CharacterChoices => {
    const base = character('barbarian', level);
    return {
      ...base,
      classSkills: ['athletics', 'survival'],
      featureChoices: {
        ...base.featureChoices,
        ...(level >= 3 ? { 'barbarian:primal-knowledge': ['intimidation'] } : {}),
        ...(level >= 4 ? { 'barbarian:ability-score-improvement': ['str', 'str'] } : {}),
        ...(level >= 19 ? { 'barbarian:epic-boon': [boon] } : {}),
      },
      ...over,
    };
  };

  it('builds a Barbarian 4 whose two points landed on Strength', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, barbarian(4)), 'plan');
    expect(plan.sheet.abilities.str).toBe(17);
    expect(plan.sheet.abilities.con).toBe(15);
  });

  /**
   * And at 20, where all three features stack: the improvement's two points,
   * the boon's one, and Primal Champion's four — with the ceiling the
   * capstone prints rather than the one every other score keeps.
   */
  it('builds a Barbarian 20 at Strength twenty-two and Constitution nineteen', () => {
    const log = unwrap(createCharacter(SRD_CONTENT, barbarian(20), WHO), 'create');
    const creature = fold('seed', log as GameEvent[]).creatures[WHO];
    expect(creature?.sheet.abilities.str).toBe(22);
    expect(creature?.sheet.abilities.con).toBe(19);
    // Nothing lifted Dexterity, and nothing raised it.
    expect(creature?.sheet.abilities.dex).toBe(14);
  });

  /**
   * Two ceilings on one sheet, each governing the score it was lifted for.
   *
   * Primal Champion's 25 for Strength and Constitution, the boon's 30 for
   * whichever score the player named — here Charisma, so Strength answers to
   * the capstone alone.
   */
  it('refuses a Barbarian 20 whose Strength would pass the capstone’s own 25', () => {
    const scores = (str: number) => ({
      method: 'manual' as const,
      assignment: { str, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    });
    // 19, two from the improvement and four from the capstone is 25 — legal.
    expect(
      checkCharacter(SRD_CONTENT, barbarian(20, { abilities: scores(19) }, 'cha')).map(
        (p) => p.code,
      ),
    ).not.toContain('score_above_maximum');
    // And one more point is not.
    expect(
      checkCharacter(SRD_CONTENT, barbarian(20, { abilities: scores(20) }, 'cha')).map(
        (p) => p.code,
      ),
    ).toContain('score_above_maximum');
    // Whereas the boon named on Strength lifts that same score to 30, and the
    // twenty-seventh point is legal after all.
    expect(
      checkCharacter(SRD_CONTENT, barbarian(20, { abilities: scores(20) }, 'str')).map(
        (p) => p.code,
      ),
    ).not.toContain('score_above_maximum');
  });

  /** Advancement honours the choice exactly as creation does. */
  it('levels a Barbarian 3 into a Barbarian 4 and moves the sheet', () => {
    const log = unwrap(createCharacter(SRD_CONTENT, barbarian(3), WHO), 'create') as GameEvent[];
    const up = unwrap(
      advanceCharacter(fold('seed', log), SRD_CONTENT, WHO, {
        featureChoices: { 'barbarian:ability-score-improvement': ['str', 'con'] },
      }),
      'advance',
    );
    const after = fold('seed', [...log, ...up]);
    expect(after.creatures[WHO]?.sheet.abilities.str).toBe(16);
    expect(after.creatures[WHO]?.sheet.abilities.con).toBe(16);
  });

  /** Body and Mind, the Monk's capstone: the other pair, and the other 25. */
  const monk = (level: number): CharacterChoices => {
    const base = character('monk', level);
    return {
      ...base,
      classSkills: ['acrobatics', 'stealth'],
      featureChoices: {
        ...base.featureChoices,
        ...(level >= 4 ? { 'monk:ability-score-improvement': ['dex', 'wis'] } : {}),
        ...(level >= 19 ? { 'monk:epic-boon': ['wis'] } : {}),
      },
    };
  };

  it('builds a Monk 20 whose Dexterity and Wisdom both took the capstone’s four', () => {
    const log = unwrap(createCharacter(SRD_CONTENT, monk(20), WHO), 'create') as GameEvent[];
    const creature = fold('seed', log).creatures[WHO];
    // 14 and one from the improvement and four from the capstone.
    expect(creature?.sheet.abilities.dex).toBe(19);
    // 10, one from the improvement, one from the boon, four from the capstone.
    expect(creature?.sheet.abilities.wis).toBe(16);
    expect(creature?.sheet.abilities.str).toBe(15);
  });
});
