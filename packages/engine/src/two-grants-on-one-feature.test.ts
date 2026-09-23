import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { expect as unwrap } from '@ie/shared';
import { armorClass } from './character.js';
import { checkContent, extendContent, loadContent } from './content.js';
import { planCharacter, type CharacterChoices } from './creation.js';
import { featureGrants, type FeatureDefinition } from './progression.js';

/**
 * A feature that carries more than one grant.
 *
 * Decided at gate G1 and never built: `FeatureDefinition.grants` was singular,
 * and the SRD prints features whose one heading covers two mechanics. SRD
 * Draconic Resilience is the plainest — "your base Armor Class equals 10 plus
 * your Dexterity and Charisma modifiers" *and* "your Hit Point maximum
 * increases by 3, and it increases by 1 whenever you gain another Sorcerer
 * level" — and the second sentence had nowhere to sit, because the one slot
 * held the first.
 *
 * **Splitting the page's feature into two ids is the refused answer**, and the
 * reason is the ledger, the origin sweep and `holdingsOf`: all three are keyed
 * by the feature the book prints, so a second id would be a feature nobody
 * printed appearing in every report.
 *
 * So the field takes one grant or a list of them, every existing entry stays
 * valid, and `featureGrants` is the one normaliser every reader goes through.
 */

/** A Draconic Sorcerer, who is the feature this is built for. */
const sorcerer = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Veska',
  classId: 'sorcerer',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    // Strength 13 for the Fighter half of the multiclassed fixture below, and
    // Charisma 15 for the Sorcerer, which is the only class this file builds.
    assignment: { str: 13, dex: 14, con: 12, int: 10, wis: 8, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  languages: ['Draconic', 'Giant'],
  alignment: 'Chaotic Neutral',
  subclassId: 'draconic-sorcery',
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  spellbook: [],
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'hold-person',
    'shatter',
    'mind-spike',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    // Asked only at level 4, and answered at every level so one fixture serves.
    'sorcerer:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/**
 * The plan at a Sorcerer level, with the answers that level asks for.
 *
 * A level 4 Sorcerer knows a fifth cantrip and has an Improvement to answer,
 * and neither is what this file is about.
 */
const plan = (level: number, over: Partial<CharacterChoices> = {}) =>
  unwrap(
    planCharacter(
      SRD_CONTENT,
      sorcerer({
        level,
        ...(level >= 4
          ? {
              cantrips: [
                'fire-bolt',
                'ray-of-frost',
                'shocking-grasp',
                'acid-splash',
                'prestidigitation',
              ],
              preparedSpells: [
                'burning-hands',
                'charm-person',
                'thunderwave',
                'hold-person',
                'shatter',
                'mind-spike',
                'magic-missile',
              ],
            }
          : {}),
        ...over,
      }),
    ),
    'plan',
  );

/** The Sorcerer's d6 and the +2 Constitution, as the class table alone writes it. */
const fromTheTable = (level: number): number => 8 + (level - 1) * 6;

describe('SRD Draconic Resilience, which is two sentences under one heading', () => {
  it('gives the Armour Class the first sentence prints', () => {
    // 10 + Dexterity (+2) + Charisma (+2), and no armour worn.
    expect(armorClass(plan(3).sheet)).toBe(14);
  });

  it('gives the three hit points the second sentence prints', () => {
    expect(plan(3).hitPointMaximum).toBe(fromTheTable(3) + 3);
  });

  it('gives one more for the next Sorcerer level', () => {
    expect(plan(4).hitPointMaximum).toBe(fromTheTable(4) + 4);
  });

  /**
   * "whenever you gain another **Sorcerer** level", which is why the term is
   * counted in the granting class's levels and not the character's: a Sorcerer
   * 3 / Fighter 1 is a level 4 character with three Sorcerer levels and three
   * hit points, and the fourth arrives with the fourth Sorcerer level.
   */
  it('counts Sorcerer levels rather than character levels', () => {
    const gish = {
      multiclass: [{ classId: 'fighter', level: 1 }],
      feats: {
        ...sorcerer().feats,
        'fighter:fighting-style': { featId: 'defense' },
      },
    };
    // The Fighter's level is not the first, so it is the average of a d10 and
    // the Constitution rather than the whole die.
    const fighter = 6 + 2;
    expect(plan(3, gish).hitPointMaximum).toBe(fromTheTable(3) + fighter + 3);
    expect(plan(4, gish).hitPointMaximum).toBe(fromTheTable(4) + fighter + 4);
  });

  it('is one feature with two grants, not two features', () => {
    const feature = SRD_CONTENT.subclassById('draconic-sorcery')?.features.find(
      (one) => one.id === 'draconic-sorcery:draconic-resilience',
    );
    expect(feature?.automation).toBe('engine');
    expect(featureGrants(feature).map((grant) => grant.kind).sort()).toEqual([
      'hit-point-maximum',
      'unarmored-defense',
    ]);
  });
});

/**
 * What composes and what does not. The table lives in the validator's
 * docstring; these are the two ends of it.
 */
describe('two grants of one kind on one feature', () => {
  const classWith = (features: readonly unknown[]) => ({
    id: 'augur',
    name: 'Augur',
    primaryAbility: 'wis',
    hitDie: 8,
    saveProficiencies: ['wis', 'cha'],
    skillChoices: { choose: 2, from: ['insight', 'arcana'] },
    weaponProficiencies: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    subclassLevel: 3,
    table: Array.from({ length: 20 }, (_, i) => ({
      level: i + 1,
      proficiencyBonus: 2 + Math.floor(i / 4),
    })),
    startingEquipment: [
      { option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 },
    ],
    multiclass: {
      weapons: ['simple'],
      armorTraining: { light: true, medium: false, heavy: false, shields: false },
      tools: [],
    },
    features,
  });

  const codes = (...features: readonly unknown[]): readonly string[] =>
    checkContent({ classes: [classWith(features) as never] }).map((one) => one.code);

  const fields = (...features: readonly unknown[]): readonly string[] =>
    checkContent({ classes: [classWith(features) as never] }).map((one) => one.field);

  const pool = (key: string) => ({
    kind: 'pool',
    key,
    label: key,
    usesByLevel: Array.from({ length: 20 }, () => 2),
    recovers: 'long-rest',
    heals: { dice: '1d4', plus: 'class-level', action: 'bonus-action' },
  });

  const standing = (feet: number) => ({
    kind: 'standing',
    reach: 'self',
    effects: [{ kind: 'speed', feet }],
  });

  it('refuses two pools, because a reader looking for the pool would find two', () => {
    const feature = {
      id: 'augur:reserves',
      name: 'Reserves',
      level: 1,
      automation: 'engine',
      note: 'Two pools under one heading.',
      grants: [pool('first'), pool('second')],
    };
    expect(codes(feature)).toContain('grants_do_not_compose');
    expect(fields(feature)).toContain('classes[augur].features[0].grants');
  });

  it('accepts two standing grants, which the SRD prints under one heading', () => {
    expect(
      codes({
        id: 'augur:poise',
        name: 'Poise',
        level: 1,
        automation: 'engine',
        note: 'Two benefits, one heading.',
        grants: [standing(5), standing(10)],
      }),
    ).toEqual([]);
  });

  /**
   * And two of a kind that does not compose are fine when they are two options
   * of one choice, because a character can only ever hold one of them.
   */
  it('accepts two of a kind under different gates', () => {
    expect(
      codes({
        id: 'augur:calling',
        name: 'Calling',
        level: 1,
        automation: 'engine',
        note: 'One pool or the other.',
        choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
        grants: [
          { ...pool('visions'), onlyIfChoice: 'Seer' },
          { ...pool('vigils'), onlyIfChoice: 'Sentinel' },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses two of a kind gated on the same option', () => {
    expect(
      codes({
        id: 'augur:calling',
        name: 'Calling',
        level: 1,
        automation: 'engine',
        note: 'One option, two pools.',
        choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
        grants: [
          { ...pool('visions'), onlyIfChoice: 'Seer' },
          { ...pool('vigils'), onlyIfChoice: 'Seer' },
        ],
      }),
    ).toContain('grants_do_not_compose');
  });
});

/** The old shape, still the shape: a feature with one grant writes one grant. */
describe('a singular grant', () => {
  it('still loads through loadContent and still reaches a reader', () => {
    const text = JSON.stringify({
      species: [
        {
          id: 'stoneborn',
          name: 'Stoneborn',
          creatureType: 'Humanoid',
          sizes: ['Medium'],
          speed: 30,
          features: [
            {
              id: 'stoneborn:granite-heart',
              name: 'Granite Heart',
              level: 1,
              automation: 'engine',
              note: 'Two hit points, written as one grant and not as a list of one.',
              grants: { kind: 'hit-point-maximum', flat: 2 },
            },
          ],
        },
      ],
    });
    const loaded = unwrap(loadContent(JSON.parse(text)), 'load');
    const whole = unwrap(extendContent(SRD_CONTENT, { species: [...loaded.species] }), 'extend');
    const stoneborn = sorcerer({
      speciesId: 'stoneborn',
      featureChoices: { 'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'] },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
      },
    });
    expect(unwrap(planCharacter(whole, stoneborn), 'plan').hitPointMaximum).toBe(
      fromTheTable(3) + 3 + 2,
    );
  });

  it('is normalised to a list of one, and an absent grant to an empty list', () => {
    const bare: FeatureDefinition = {
      id: 'x:y',
      name: 'Y',
      level: 1,
      automation: 'manual',
      note: 'nothing',
    };
    const one: FeatureDefinition = { ...bare, automation: 'engine', grants: { kind: 'expertise' } };
    expect(featureGrants(bare)).toEqual([]);
    expect(featureGrants(one)).toEqual([{ kind: 'expertise' }]);
    expect(featureGrants({ ...one, grants: [{ kind: 'expertise' }] })).toEqual([
      { kind: 'expertise' },
    ]);
  });
});
