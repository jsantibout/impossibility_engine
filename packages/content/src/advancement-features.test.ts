import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  advanceCharacter,
  checkCharacter,
  checkContent,
  createCharacter,
  fold,
  planCharacter,
  type CharacterChoices,
  type Content,
  type CreationProblem,
  type FeatChoice,
  type FeatureDefinition,
  type GameEvent,
} from '@ie/engine';

/**
 * The printed features that raise an ability score, and the one that does not
 * but was thought to.
 *
 * Two shapes stood at the top of `missing-feature-shapes.ts` — the Ability
 * Score Improvement taken as scores, and a maximum above 20 — and the batch
 * that built the vocabulary for them found, in `packages/srd/raw`, that
 * **twenty-four of the twenty-six features do not carry the sentence at all**:
 *
 * | Where | What SRD prints |
 * |---|---|
 * | `classes.md`, level 4 | "You gain the Ability Score Improvement feat ... or another feat of your choice for which you qualify" |
 * | `feats.md`, the feat | "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1" |
 * | `classes.md`, level 19 | "You gain an Epic Boon feat ... or another feat of your choice for which you qualify" |
 * | `feats.md`, each boon | "Increase one ability score of your choice by 1, to a maximum of 30" |
 * | `classes.md`, level 20 | "Your Strength and Constitution scores increase by 4, to a maximum of 25" |
 *
 * So the last row is the only one the class feature itself says, and the two
 * capstones that say it are converted. The other twenty-four grant a feat and
 * are held here to doing exactly that: a class feature that handed out bare
 * points would print a branch the book never writes.
 *
 * **The host exists now**, which is what this file changed to say. A feat
 * asks which scores through `FeatRequirement`, answers in `FeatChoice`,
 * gates on `minimumLevel` and has an `ability-score-increase` grant read off
 * it, so the catalogue publishes the Ability Score Improvement feat and the
 * seven Epic Boons and the twenty-four features grant them. The engine half
 * is driven through homebrew in
 * `packages/engine/src/feat-ability-scores.test.ts`; the feature’s own
 * `ability-score` choice, which no SRD class writes, is driven through a
 * homebrew class in `packages/engine/src/ability-score-improvement.test.ts`.
 *
 * What is still left on the twenty-four is not a mechanic: each carries
 * `automation: 'manual'` and a note written when the host was missing, and
 * the class table grants the Improvement again at levels 8, 12 and 16 while
 * this catalogue holds one entry per class. Both are transcription in
 * `classes/*.ts`, and `missing-feature-shapes.ts` says so against each.
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
 * The boon a level 19 character takes, and the improvement a level 4 one
 * takes — both printed feats now, and both the book's own.
 *
 * This file used to carry a homebrew stand-in here, because `SRD_CONTENT`
 * published no Epic Boon at all and no character of any class could reach
 * level 19 against it. It publishes seven now, so the fixture is a name
 * rather than a definition and the catalogue under test is the book's.
 */
const BOON = 'boon-of-combat-prowess';
const IMPROVEMENT = 'ability-score-improvement';

/** The catalogue these run against: the SRD's, with nothing added. */
const WITH_BOONS: Content = SRD_CONTENT;

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
  feats: FeatsBySlot = {},
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

/** Feats keyed by the feature that granted them, as the choices carry them. */
type FeatsBySlot = Readonly<Record<string, FeatChoice>>;

/** The Improvement feat, with the scores the player put its points into. */
const improving = (abilities: readonly string[]): FeatChoice => ({
  featId: IMPROVEMENT,
  abilities,
});

/**
 * Both advancement feats a level 19 character of this class owes, answered.
 *
 * Charisma by default at both slots, because every class in this file has one
 * to spare and the score under test is whichever a caller names.
 */
const atNineteen = (
  classId: string,
  boon: readonly string[] = ['cha'],
  improvement: readonly string[] = ['cha'],
): FeatsBySlot => ({
  [`${classId}:ability-score-improvement`]: improving(improvement),
  [`${classId}:epic-boon`]: { featId: BOON, abilities: boon },
});

/** The problems one feature caused, out of everything wrong with the sheet. */
const about = (
  problems: readonly CreationProblem[],
  feature: FeatureDefinition,
): readonly CreationProblem[] =>
  problems.filter(
    (problem) => problem.reason.includes(feature.id) || problem.reason.startsWith(feature.name),
  );

const codesAbout = (
  choices: CharacterChoices,
  feature: FeatureDefinition,
  content: Content = WITH_BOONS,
): readonly string[] => about(checkCharacter(content, choices), feature).map((one) => one.code);

describe('the twenty-four class features grant a feat, and say so', () => {
  it('registers the twelve classes this file drives', () => {
    expect(SRD_CONTENT.classes.map((one) => one.id).sort()).toEqual([...CLASSES].sort());
  });

  for (const classId of CLASSES) {
    describe(classId, () => {
      const improvement = featureOn(classId, 'ability-score-improvement');
      const boon = featureOn(classId, 'epic-boon');

      /**
       * The class feature asks for a feat and nothing else, because that is
       * the whole of what the book prints on it.
       */
      it('offers a feat at level 4 and an Epic Boon feat at 19', () => {
        expect(improvement.level).toBe(4);
        expect(improvement.choice).toEqual({ kind: 'feat', choose: 1 });
        expect(boon.level).toBe(19);
        expect(boon.choice).toEqual({ kind: 'feat', choose: 1, category: 'epic-boon' });
      });

      /**
       * And it does not hand out points of its own — the check that would
       * have caught this batch's first attempt, where the class feature
       * carried the feat's sentence.
       */
      it('carries no ability-score choice and no ability-score grant', () => {
        for (const feature of [improvement, boon]) {
          expect(feature.choice?.kind).not.toBe('ability-score');
          expect(feature.grants).toBeUndefined();
          expect(feature.automation).toBe('manual');
        }
      });

      it('refuses a character who named no feat for either', () => {
        expect(codesAbout(character(classId, 4), improvement)).toEqual(['missing_feat_choice']);
        expect(
          codesAbout(
            character(classId, 19, {}, { [improvement.id]: { featId: 'savage-attacker' } }),
            boon,
          ),
        ).toEqual(['missing_feat_choice']);
      });

      it('holds the level 19 feat to the Epic Boon category', () => {
        const wrong = character(
          classId,
          19,
          {},
          {
            [improvement.id]: { featId: 'savage-attacker' },
            [boon.id]: { featId: 'savage-attacker' },
          },
        );
        expect(codesAbout(wrong, boon)).toEqual(['wrong_feat_category']);

        const right = character(classId, 19, {}, atNineteen(classId));
        expect(codesAbout(right, boon)).toEqual([]);
      });

      /**
       * The points, where the book puts them: the feature grants the feat and
       * the **feat** raises the score.
       *
       * Asked through the cap rather than through the sheet, because these
       * fixtures are deliberately not complete characters — see
       * {@link character} — and `planCharacter` refuses an incomplete one.
       * A score of 19 plus the feat’s two points is 21 and is refused; the
       * same 19 plus the other branch’s one point is 20 and is not. Nothing
       * but the points reaching the arithmetic makes both of those true.
       */
      it('puts the Improvement feat’s points into the arithmetic at level 4', () => {
        const tall = {
          method: 'manual' as const,
          assignment: { str: 15, dex: 19, con: 13, int: 12, wis: 10, cha: 8 },
        };
        const took = (abilities: readonly string[]) =>
          checkCharacter(WITH_BOONS, {
            ...character(classId, 4, {}, { [improvement.id]: improving(abilities) }),
            abilities: tall,
          }).map((one) => one.code);

        expect(took(['dex', 'dex'])).toContain('score_above_maximum');
        expect(took(['dex', 'wis'])).not.toContain('score_above_maximum');
        // And a spread the feat’s own sentence does not print.
        expect(took(['dex'])).toContain('ability_spread_not_offered');
      });

      /**
       * The boon’s ceiling, for the score it raised and for no other — the
       * whole of what "to a maximum of 30" buys, asked of every class.
       */
      it('lets the boon’s own score pass twenty at level 19 and no other score', () => {
        const tall = {
          method: 'manual' as const,
          assignment: { str: 15, dex: 20, con: 13, int: 12, wis: 10, cha: 8 },
        };
        const at = (boon: readonly string[], asi: readonly string[]) =>
          checkCharacter(WITH_BOONS, {
            ...character(classId, 19, {}, atNineteen(classId, boon, asi)),
            abilities: tall,
          }).map((one) => one.code);

        // The boon named Dexterity, so its twenty-first point is allowed.
        expect(at(['dex'], ['wis', 'cha'])).not.toContain('score_above_maximum');
        // The boon named Wisdom, so the Improvement’s point on Dexterity is
        // the twenty-first and is refused.
        expect(at(['wis'], ['dex', 'cha'])).toContain('score_above_maximum');
      });
    });
  }

  /**
   * A level 19 character, built end to end against the book’s own catalogue
   * — which nothing in this repository had ever done, because the level 19
   * feature asked for a feat of a category the catalogue did not publish.
   */
  it('builds a level 19 Barbarian against SRD_CONTENT and folds the boon’s point on', () => {
    const who = asCharacterId('vashti');
    const choices: CharacterChoices = {
      ...character('barbarian', 19, {}, atNineteen('barbarian', ['str'], ['str', 'con'])),
      classSkills: ['athletics', 'survival'],
      featureChoices: {
        'human:skillful': ['perception'],
        'barbarian:primal-knowledge': ['nature'],
      },
    };
    expect(checkCharacter(SRD_CONTENT, choices)).toEqual([]);
    const log = unwrap(createCharacter(SRD_CONTENT, choices, who), 'create') as GameEvent[];
    const creature = fold('seed', log).creatures[who];
    expect(creature?.sheet.level).toBe(19);
    // 15 assigned, one of the Improvement’s two points and the boon’s one.
    expect(creature?.sheet.abilities.str).toBe(17);
    // The Improvement’s other point went to Constitution, on top of the
    // background’s two, and the boon lifted nothing there.
    expect(creature?.sheet.abilities.con).toBe(16);
  });

  /**
   * The catalogue publishes the host now, and this is the assertion that used
   * to say it did not.
   *
   * Seven Epic Boons rather than the nine an earlier note counted:
   * `feats.md` prints Combat Prowess, Dimensional Travel, Fate, Irresistible
   * Offense, Spell Recall, the Night Spirit and Truesight, and the SRD’s
   * list is shorter than the wider game’s.
   */
  it('publishes the seven Epic Boons and the Improvement the features ask for', () => {
    expect(
      SRD_CONTENT.feats.filter((feat) => feat.category === 'epic-boon').map((one) => one.id),
    ).toEqual([
      'boon-of-combat-prowess',
      'boon-of-dimensional-travel',
      'boon-of-fate',
      'boon-of-irresistible-offense',
      'boon-of-spell-recall',
      'boon-of-the-night-spirit',
      'boon-of-truesight',
    ]);
    expect(SRD_CONTENT.featById(IMPROVEMENT)?.category).toBe('general');
    const named = character('barbarian', 19, {}, atNineteen('barbarian'));
    expect(checkCharacter(SRD_CONTENT, named).map((p) => p.code)).not.toContain('unknown_feat');
  });

  /**
   * The bracket, enforced: SRD gates both of these feats on a level and the
   * engine asks the character’s total level about it.
   */
  it('refuses a boon to a character below the bracket', () => {
    const tooSoon = character(
      'barbarian',
      4,
      {},
      { 'barbarian:ability-score-improvement': { featId: BOON, abilities: ['str'] } },
    );
    expect(checkCharacter(SRD_CONTENT, tooSoon).map((p) => p.code)).toContain('feat_level_too_low');
  });

  /** And the two boons whose sentence narrows which score it may raise. */
  it('refuses a score outside the set a narrowed boon offers', () => {
    const wrong = character(
      'barbarian',
      19,
      {},
      {
        'barbarian:ability-score-improvement': improving(['wis', 'cha']),
        'barbarian:epic-boon': { featId: 'boon-of-irresistible-offense', abilities: ['wis'] },
      },
    );
    expect(checkCharacter(SRD_CONTENT, wrong).map((p) => p.code)).toContain('ability_not_offered');
  });

  /**
   * The refusal that stood between the vocabulary and its host, now the
   * reader that answers for it.
   *
   * `FEAT_GRANT_KINDS` admits `ability-score-increase` because creation reads
   * one off a feat. It is still an allowlist, and a kind nothing reads is
   * still refused by name.
   */
  it('reads the grant a boon feat declares, and still refuses one nothing reads', () => {
    const declared = SRD_CONTENT.featById(BOON);
    expect(declared?.grants).toEqual({ kind: 'ability-score-increase', maximum: 30 });
    expect(declared?.minimumLevel).toBe(19);
    expect(declared?.requires).toEqual({ kind: 'ability-score', spreads: [[1]] });

    expect(
      checkContent({ feats: [{ ...declared, grants: { kind: 'expertise' } } as never] }).map(
        (one) => one.code,
      ),
    ).toEqual(['feat_grant_not_read']);
  });
});

/**
 * The two capstones, which do carry the sentence on the feature — and are the
 * whole of what the new vocabulary executes in the printed catalogue.
 *
 * Neither class casts, so a complete sheet is buildable and the points and the
 * ceilings are the only things left to get wrong.
 */
describe('Primal Champion and Body and Mind raise two scores each', () => {
  const WHO = asCharacterId('vashti');

  const capstone = (classId: string) => featureOn(classId, classId === 'monk' ? 'body-and-mind' : 'primal-champion');

  const withFeats = (classId: string, level: number): FeatsBySlot => ({
    ...(level >= 4 ? { [`${classId}:ability-score-improvement`]: { featId: 'savage-attacker' } } : {}),
    ...(level >= 19 ? { [`${classId}:epic-boon`]: { featId: BOON, abilities: ['cha'] } } : {}),
  });

  const barbarian = (level: number, over: Partial<CharacterChoices> = {}): CharacterChoices => {
    const base = character('barbarian', level, {}, withFeats('barbarian', level));
    return {
      ...base,
      classSkills: ['athletics', 'survival'],
      featureChoices: {
        ...base.featureChoices,
        ...(level >= 3 ? { 'barbarian:primal-knowledge': ['intimidation'] } : {}),
      },
      ...over,
    };
  };

  it('declares the sentence the book prints on the feature', () => {
    expect(capstone('barbarian')).toMatchObject({
      level: 20,
      automation: 'engine',
      grants: {
        kind: 'ability-score-increase',
        raises: [
          { ability: 'str', points: 4 },
          { ability: 'con', points: 4 },
        ],
        maximum: 25,
      },
    });
    expect(capstone('monk')).toMatchObject({
      level: 20,
      automation: 'engine',
      grants: {
        kind: 'ability-score-increase',
        raises: [
          { ability: 'dex', points: 4 },
          { ability: 'wis', points: 4 },
        ],
        maximum: 25,
      },
    });
  });

  it('raises nothing before the capstone arrives', () => {
    const plan = unwrap(planCharacter(WITH_BOONS, barbarian(19)), 'plan');
    expect(plan.sheet.abilities.str).toBe(15);
    expect(plan.sheet.abilities.con).toBe(15);
  });

  it('puts four points on each of the two scores the Barbarian’s capstone names', () => {
    const log = unwrap(createCharacter(WITH_BOONS, barbarian(20), WHO), 'create');
    const creature = fold('seed', log as GameEvent[]).creatures[WHO];
    expect(creature?.sheet.abilities.str).toBe(19);
    expect(creature?.sheet.abilities.con).toBe(19);
    // And on no other: nothing raised Dexterity and nothing lifted its ceiling.
    expect(creature?.sheet.abilities.dex).toBe(14);
  });

  /** Advancement honours the grant exactly as creation does. */
  it('levels a Barbarian 19 into a Barbarian 20 and moves the sheet', () => {
    const log = unwrap(createCharacter(WITH_BOONS, barbarian(19), WHO), 'create') as GameEvent[];
    const up = unwrap(advanceCharacter(fold('seed', log), WITH_BOONS, WHO, {}), 'advance');
    const after = fold('seed', [...log, ...up]);
    expect(after.creatures[WHO]?.sheet.abilities.str).toBe(19);
    expect(after.creatures[WHO]?.sheet.abilities.con).toBe(19);
  });

  /**
   * The ceiling the capstone prints, for the two scores it names and for no
   * others — 25 rather than the 20 every other score of the same character
   * still stops at.
   */
  it('refuses a Strength past 25 and refuses a Dexterity past 20', () => {
    const scores = (str: number, dex: number) => ({
      method: 'manual' as const,
      assignment: { str, dex, con: 13, int: 12, wis: 10, cha: 8 },
    });
    // 21 and the capstone's four is 25 exactly, which the capstone allows.
    expect(
      checkCharacter(WITH_BOONS, barbarian(20, { abilities: scores(21, 14) })).map((p) => p.code),
    ).not.toContain('score_above_maximum');
    expect(
      checkCharacter(WITH_BOONS, barbarian(20, { abilities: scores(22, 14) })).map((p) => p.code),
    ).toContain('score_above_maximum');
    // Dexterity was not named by the capstone, so its ceiling never moved.
    expect(
      checkCharacter(WITH_BOONS, barbarian(20, { abilities: scores(15, 21) })).map((p) => p.code),
    ).toContain('score_above_maximum');
  });

  it('puts four points on the Monk’s pair instead', () => {
    const base = character('monk', 20, {}, withFeats('monk', 20));
    const log = unwrap(
      createCharacter(WITH_BOONS, { ...base, classSkills: ['acrobatics', 'stealth'] }, WHO),
      'create',
    ) as GameEvent[];
    const creature = fold('seed', log).creatures[WHO];
    expect(creature?.sheet.abilities.dex).toBe(18);
    expect(creature?.sheet.abilities.wis).toBe(14);
    expect(creature?.sheet.abilities.str).toBe(15);
  });
});
