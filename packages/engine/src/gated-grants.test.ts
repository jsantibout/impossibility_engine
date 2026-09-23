import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { checkContent, extendContent, type Content } from './content.js';
import { createCharacter } from './creation.js';
import { planCharacter, type CharacterChoices } from './creation.js';

/**
 * A grant gated on one option of a choice, whatever the grant is.
 *
 * `onlyIfChoice` arrived on the `standing` member for SRD Elven Lineage — a
 * Wood Elf's five feet of Speed, granted only to the lineage that took it —
 * and stayed there, which made the gate a property of one grant kind rather
 * than of the sentence the SRD actually prints. The book prints "you gain one
 * of the following options" over *anything*: Divine Order's extra cantrip is a
 * `spells` grant, Giant Ancestry's Stone's Endurance is a Reaction, and
 * Draconic Ancestry's whole table is read by two later traits.
 *
 * So the gate is a field every member may carry, and it is applied in one
 * place — `grantedFeatures`, before any grant is compiled — so that the pools,
 * the Reactions, the spells, the activations and the standing loop all see
 * only the grants whose option was taken. A gate honoured in the one loop that
 * remembered to ask would be a gate with a hole in it.
 *
 * **Not lifted to the feature.** A feature-level gate cannot say what Elven
 * Lineage says: a Wood Elf Speed *and* a Drow sense *and* a per-option cantrip
 * are three gates on one printed feature.
 */

const id = (s: string) => asCharacterId(s);
const WHO = id('velia');

/** A class whose level 1 feature offers two options that grant different things. */
const ORACLE = {
  id: 'oracle',
  name: 'Oracle',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['insight', 'arcana', 'religion', 'perception'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'oracle:calling',
      name: 'Calling',
      level: 1,
      automation: 'engine',
      note: 'The Sentinel’s two hit points, and nothing for the Seer.',
      choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
      grants: { kind: 'hit-point-maximum', flat: 2, onlyIfChoice: 'Sentinel' },
    },
    {
      // The other half of the same choice, on the feature that did not ask it:
      // the shape SRD writes a species in, one trait asking and the later ones
      // written as "determined by" it.
      id: 'oracle:visions',
      name: 'Visions',
      level: 1,
      automation: 'engine',
      note: 'A pool of visions, which only a Seer has.',
      grants: {
        kind: 'pool',
        key: 'visions',
        label: 'Visions',
        usesByLevel: Array.from({ length: 20 }, () => 2),
        recovers: 'long-rest',
        heals: { dice: '1d4', plus: 'class-level', action: 'bonus-action' },
        onlyIfChoice: 'Seer',
        choiceFrom: 'oracle:calling',
      },
    },
  ],
};

const PATH = { id: 'oracle-of-stars', name: 'Oracle of Stars', classId: 'oracle', features: [] };

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { classes: [ORACLE as never], subclasses: [PATH as never] }),
  'extend',
);

const oracle = (calling: string, over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Velia',
  classId: 'oracle',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'arcana'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'oracle:calling': [calling], 'human:skillful': ['perception'] },
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

const poolKeys = (calling: string): readonly string[] =>
  unwrap(createCharacter(CONTENT, oracle(calling), WHO), 'create')
    .filter((event) => event.type === 'resource-pool-declared')
    .map((event) => (event as { pool: { key: string } }).pool.key);

describe('a gate on a grant that is not a standing benefit', () => {
  /** The maximum is the class table's, plus two for the option that says so. */
  it('is honoured by the arithmetic the option belongs to', () => {
    expect(unwrap(planCharacter(CONTENT, oracle('Sentinel')), 'plan').hitPointMaximum).toBe(10 + 2);
    expect(unwrap(planCharacter(CONTENT, oracle('Seer')), 'plan').hitPointMaximum).toBe(10);
  });

  /**
   * And by the pass that declares pools, which is the half that says the gate
   * is applied once rather than in whichever loop remembered to ask.
   */
  it('declares a pool for the option that has one and not for the other', () => {
    expect(poolKeys('Seer')).toContain('visions');
    expect(poolKeys('Sentinel')).not.toContain('visions');
  });

  /** Read off the sibling that asked, which is how a species is written. */
  it('reads the answer from the feature the question was asked on', () => {
    expect(CONTENT.classById('oracle')?.features[1]?.grants).toMatchObject({
      choiceFrom: 'oracle:calling',
    });
    expect(poolKeys('Seer')).toContain('visions');
  });
});

/**
 * The gate that was already there, still there. SRD Elven Lineage's Wood Elf
 * Speed is the feature this field was built for, and
 * `packages/content/src/origins.test.ts` holds the three lineages against the
 * Speed each one walks at.
 */
describe('the standing gate the field arrived with', () => {
  const elf = (lineage: string): CharacterChoices =>
    oracle('Seer', {
      speciesId: 'elf',
      featureChoices: {
        'oracle:calling': ['Seer'],
        'elf:elven-lineage': [lineage],
        'elf:keen-senses': ['perception'],
      },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'ray-of-frost'],
          levelOneSpell: 'find-familiar',
        },
      },
    });

  it('still grants the Wood Elf the five feet and the Drow nothing', () => {
    const speeds = (lineage: string) =>
      (unwrap(planCharacter(CONTENT, elf(lineage)), 'plan').sheet.standing ?? []).filter(
        (one) => one.grant.kind === 'speed',
      );
    expect(speeds('Wood Elf')).toHaveLength(1);
    expect(speeds('Drow')).toHaveLength(0);
  });

  /** A grant with no gate is a grant every holder has. */
  it('leaves an ungated grant alone', () => {
    const darkvision = (lineage: string) =>
      (unwrap(planCharacter(CONTENT, elf(lineage)), 'plan').sheet.standing ?? []).filter(
        (one) => one.grant.kind === 'sense',
      );
    expect(darkvision('Wood Elf')).toHaveLength(1);
    expect(darkvision('Drow')).toHaveLength(1);
  });
});

/**
 * What the validator refuses, which is every way a gate can name a question
 * nobody asked. A gate that matches nothing is not an error at any moment —
 * the character simply never gets the benefit, and nothing says why.
 */
describe('a gate that reaches no answer', () => {
  const classWith = (features: readonly unknown[]) => ({
    ...ORACLE,
    id: 'augur',
    features,
  });

  const codes = (...features: readonly unknown[]): readonly string[] =>
    checkContent({ classes: [classWith(features) as never] }).map((one) => one.code);

  const fields = (...features: readonly unknown[]): readonly string[] =>
    checkContent({ classes: [classWith(features) as never] }).map((one) => one.field);

  it('refuses an option the feature’s own choice does not offer', () => {
    const feature = {
      id: 'augur:calling',
      name: 'Calling',
      level: 1,
      automation: 'engine',
      note: 'A gate on an option nobody can pick.',
      choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
      grants: { kind: 'hit-point-maximum', flat: 2, onlyIfChoice: 'Warden' },
    };
    expect(codes(feature)).toContain('option_not_offered');
    expect(fields(feature)).toContain('classes[augur].features[0].grants.onlyIfChoice');
  });

  it('refuses a gate on a feature that asks nothing', () => {
    expect(
      codes({
        id: 'augur:calling',
        name: 'Calling',
        level: 1,
        automation: 'engine',
        note: 'A gate with no question behind it.',
        grants: { kind: 'hit-point-maximum', flat: 2, onlyIfChoice: 'Seer' },
      }),
    ).toContain('gate_without_a_choice');
  });

  it('refuses a gate reading a sibling that does not offer the option', () => {
    expect(
      codes(
        {
          id: 'augur:calling',
          name: 'Calling',
          level: 1,
          automation: 'engine',
          note: 'The question.',
          choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
        },
        {
          id: 'augur:visions',
          name: 'Visions',
          level: 1,
          automation: 'engine',
          note: 'An answer nobody offered.',
          grants: {
            kind: 'hit-point-maximum',
            flat: 2,
            onlyIfChoice: 'Warden',
            choiceFrom: 'augur:calling',
          },
        },
      ),
    ).toContain('option_not_offered');
  });

  /**
   * And the reading end of the same rule, which was a `standing`-only refusal
   * until the gate stopped being a `standing`-only field.
   */
  it('refuses a grant that says where its choice was made and reads no choice', () => {
    expect(
      codes(
        {
          id: 'augur:calling',
          name: 'Calling',
          level: 1,
          automation: 'engine',
          note: 'The question.',
          choice: { kind: 'option', choose: 1, from: ['Seer', 'Sentinel'] },
        },
        {
          id: 'augur:visions',
          name: 'Visions',
          level: 1,
          automation: 'engine',
          note: 'A source for nothing.',
          grants: { kind: 'hit-point-maximum', flat: 2, choiceFrom: 'augur:calling' },
        },
      ),
    ).toContain('choice_from_reads_nothing');
  });
});

/** The SRD trait the widened gate finishes, driven through the book itself. */
describe('a species trait whose table two later traits read', () => {
  const content: Content = SRD_CONTENT;

  it('is executed rather than half-applied', () => {
    const trait = content
      .speciesById('dragonborn')
      ?.features.find((one) => one.id === 'dragonborn:draconic-ancestry');
    expect(trait?.automation).toBe('engine');
  });
});
