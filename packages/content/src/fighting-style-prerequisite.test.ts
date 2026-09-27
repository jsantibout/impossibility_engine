import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr } from '@ie/shared';
import {
  advanceCharacter,
  checkCharacter,
  checkContent,
  createCharacter,
  fold,
  loadContent,
  type AdvanceChoices,
  type CharacterChoices,
  type FeatChoice,
  type GameEvent,
} from '@ie/engine';
import { FIGHTING_STYLE_FEATS } from './origins.js';

/**
 * SRD "Fighting Style Feats": each is printed "_Fighting Style Feat
 * (Prerequisite: Fighting Style Feature)_", and SRD "Feats" says of any
 * prerequisite: "To take a feat, you must meet any prerequisite in its
 * description unless a feature allows you to take the feat without the
 * prerequisite."
 *
 * The Ability Score Improvement every class prints at level 4 is "the Ability
 * Score Improvement feat … or another feat of your choice **for which you
 * qualify**", so its choice names no category — and a Wizard, a Cleric or a
 * Rogue could take Archery in it, because the only thing that kept a Fighting
 * Style feat to the classes that have the feature was the category the
 * Fighting Style feature's own choice names. That held the feature's slot to
 * the category; it did nothing to hold the category to the feature.
 */

const WHO = asCharacterId('ilbert');
const STYLES = FIGHTING_STYLE_FEATS.map((feat) => feat.id);

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

/** A level 3 Wizard, whole, who is about to reach 4. */
const wizard = (): CharacterChoices => ({
  ...common,
  name: 'Ilbert',
  classId: 'wizard',
  level: 3,
  subclassId: 'evoker',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['arcana', 'history'],
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp'],
  spellbook: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'magic-missile',
    'shield',
    'sleep',
    'detect-magic',
    'feather-fall',
    'hold-person',
    'shatter',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['burning-hands', 'charm-person', 'thunderwave', 'magic-missile', 'shield', 'hold-person'],
  featureChoices: {
    'human:skillful': ['perception'],
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['chromatic-orb', 'scorching-ray'],
  },
});

/** Level 4, with the Improvement slot filled by whatever feat is named. */
const toFour = (feat: FeatChoice): AdvanceChoices => ({
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  newSpells: ['misty-step', 'invisibility'],
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'magic-missile',
    'shield',
    'hold-person',
    'misty-step',
  ],
  feats: { 'wizard:ability-score-improvement': feat },
});

const made = (): readonly GameEvent[] => unwrap(createCharacter(SRD_CONTENT, wizard(), WHO), 'wizard 3');

describe('a Fighting Style feat asks for the Fighting Style feature', () => {
  it('the fixture advances to 4 when the slot takes a feat it qualifies for', () => {
    const up = advanceCharacter(fold('seed', made()), SRD_CONTENT, WHO, toFour({ featId: 'ability-score-improvement', abilities: ['int', 'int'] }));
    expect(isErr(up) ? `${up.code}: ${up.reason}` : 'ok').toBe('ok');
  });

  it('refuses Archery in a Wizard’s Ability Score Improvement slot, going from 3 to 4', () => {
    const up = advanceCharacter(fold('seed', made()), SRD_CONTENT, WHO, toFour({ featId: 'archery' }));
    expect(isErr(up) ? up.code : 'ok').toBe('feat_prerequisite_unmet');
  });

  it('prints the prerequisite on all four, and only on those', () => {
    expect([...STYLES].sort()).toEqual(['archery', 'defense', 'great-weapon-fighting', 'two-weapon-fighting']);
    for (const feat of SRD_CONTENT.feats) {
      expect([feat.id, feat.prerequisiteFeature]).toEqual([
        feat.id,
        STYLES.includes(feat.id) ? 'Fighting Style' : undefined,
      ]);
    }
  });
});

/**
 * A level 4 character of a class, with the Improvement slot filled by one
 * feat — deliberately not a whole character (no spells for the casters), so
 * only the prerequisite's own code is read out of what `checkCharacter` finds.
 */
const atFour = (classId: string, featId: string): CharacterChoices => ({
  ...common,
  name: 'Vashti',
  classId,
  level: 4,
  subclassId: SUBCLASS[classId]!,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: [],
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    [`${classId}:ability-score-improvement`]: { featId },
    // The three that print the feature fill its own slot with Defense, so the
    // Improvement's Archery is a second style rather than the first.
    ...(HAS_THE_FEATURE.includes(classId) ? { [`${classId}:fighting-style`]: { featId: 'defense' } } : {}),
  },
});

const SUBCLASS: Readonly<Record<string, string>> = {
  wizard: 'evoker',
  cleric: 'life-domain',
  rogue: 'thief',
  fighter: 'champion',
  paladin: 'oath-of-devotion',
  ranger: 'hunter',
};
const HAS_THE_FEATURE = ['fighter', 'paladin', 'ranger'];

const unmet = (choices: CharacterChoices): boolean =>
  checkCharacter(SRD_CONTENT, choices).some((one) => one.code === 'feat_prerequisite_unmet');

describe('where a Fighting Style feat may be taken in an Improvement slot', () => {
  for (const classId of ['wizard', 'cleric', 'rogue']) {
    for (const feat of STYLES) {
      it(`refuses ${feat} to a ${classId}, who has no Fighting Style feature`, () => {
        expect(unmet(atFour(classId, feat))).toBe(true);
      });
    }
  }

  for (const classId of HAS_THE_FEATURE) {
    it(`lets a ${classId}, who prints the feature, take a second style`, () => {
      expect(unmet(atFour(classId, 'archery'))).toBe(false);
    });
  }

  it('asks nothing of a feat that prints no such prerequisite', () => {
    expect(unmet(atFour('wizard', 'alert'))).toBe(false);
  });
});

describe('the prerequisite is data, and homebrew says it the same way', () => {
  const homebrew = (prerequisiteFeature: unknown) => ({
    id: 'duelling-circle',
    name: 'Duelling Circle',
    category: 'fighting-style',
    prerequisiteFeature,
    requires: { kind: 'none' },
    repeatable: false,
    note: 'A homebrew style with the prerequisite the book prints on its own four.',
  });

  it('survives a load from JSON text', () => {
    const loaded = unwrap(loadContent({ feats: [JSON.parse(JSON.stringify(homebrew('Fighting Style')))] }), 'load');
    expect(loaded.featById('duelling-circle')?.prerequisiteFeature).toBe('Fighting Style');
  });

  it('is refused where it names no feature', () => {
    const codes = checkContent({ feats: [homebrew('') as never] }).map((one) => one.code);
    expect(codes).toContain('bad_feat_prerequisite');
  });
});
