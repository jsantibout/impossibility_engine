import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  advanceCharacter,
  checkCharacter,
  checkContent,
  createCharacter,
  extendContent,
  fold,
  planCharacter,
  type CharacterChoices,
  type Content,
  type CreationProblem,
  type FeatDefinition,
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
 * The vocabulary is not idle for it — the capstones use the grant, and
 * `packages/engine/src/ability-score-improvement.test.ts` drives the choice,
 * the spreads, the cap and the lifted ceiling through a homebrew class and
 * `loadContent`. What is missing is the **host**, which is one blocker with
 * its own id on the map now.
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
 * An Epic Boon feat, which the SRD catalogue publishes none of.
 *
 * Homebrew, and it has to be: no character of any class can reach level 19
 * against `SRD_CONTENT` alone, because the level 19 feature asks for a feat of
 * a category nothing fills. The boon below is the sentence every printed boon
 * opens with, written where the book writes it — on the feat — and it is what
 * lets the two level 20 capstones be driven at all.
 *
 * It carries **no grant**, and could not: `FEAT_GRANT_KINDS` admits one kind,
 * so the sentence the book prints on it is refused by name — which the last
 * test in the first block asserts, because that refusal is the specification
 * for the brief that finishes this. So the boon's own +1 is not applied here
 * and the capstone's four points are.
 */
const BOON_OF_MIGHT: FeatDefinition = {
  id: 'boon-of-might',
  name: 'Boon of Might',
  category: 'epic-boon',
  requires: { kind: 'none' },
  repeatable: false,
  note: 'Homebrew, and a stand-in: the ability score increase every SRD Epic Boon prints is not applied, because nothing reads an ability-score grant off a feat. It exists so a level 19 character can be built at all.',
};

const WITH_BOONS: Content = unwrap(
  extendContent(SRD_CONTENT, { feats: [BOON_OF_MIGHT] }),
  'boons',
);

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

        const right = character(
          classId,
          19,
          {},
          {
            [improvement.id]: { featId: 'savage-attacker' },
            [boon.id]: { featId: 'boon-of-might' },
          },
        );
        expect(codesAbout(right, boon)).toEqual([]);
      });
    });
  }

  /**
   * And the reason no level 19 character exists yet, asserted rather than
   * described: against the book's own catalogue the feat has nothing to be.
   */
  it('cannot reach level 19 against a catalogue with no Epic Boon feat', () => {
    expect(SRD_CONTENT.feats.filter((feat) => feat.category === 'epic-boon')).toEqual([]);
    const named = character(
      'barbarian',
      19,
      {},
      {
        'barbarian:ability-score-improvement': { featId: 'savage-attacker' },
        'barbarian:epic-boon': { featId: 'boon-of-might' },
      },
    );
    // The boon this fixture names is homebrew, so the book's own catalogue
    // has nothing to resolve it to — and naming a printed feat instead is the
    // wrong category. There is no third answer.
    expect(checkCharacter(SRD_CONTENT, named).map((p) => p.code)).toContain('unknown_feat');
    expect(checkCharacter(WITH_BOONS, named).map((p) => p.code)).not.toContain('unknown_feat');
  });

  /**
   * And the refusal that is the specification for finishing this.
   *
   * The vocabulary exists and the host does not: a feat that declares the
   * sentence the book prints on it is refused by name, because
   * `FEAT_GRANT_KINDS` admits one kind and creation reads a feat's
   * declaration on its own. Pinning it here means the follow-up — publish the
   * Ability Score Improvement feat and the nine Epic Boons, and teach
   * creation to read a feat's grants — fails this test until it lands.
   */
  it('refuses the grant a boon feat would need, which is the work left', () => {
    const declaring = {
      ...BOON_OF_MIGHT,
      grants: { kind: 'ability-score-increase', maximum: 30 },
    };
    expect(checkContent({ feats: [declaring as never] }).map((one) => one.code)).toEqual([
      'feat_grant_not_read',
    ]);
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

  const withFeats = (classId: string, level: number): Record<string, { featId: string }> => ({
    ...(level >= 4 ? { [`${classId}:ability-score-improvement`]: { featId: 'savage-attacker' } } : {}),
    ...(level >= 19 ? { [`${classId}:epic-boon`]: { featId: 'boon-of-might' } } : {}),
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
