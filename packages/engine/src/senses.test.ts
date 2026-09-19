import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { canSee, sensesOf } from './standing.js';
import {
  scene,
  sensesReaching,
  sightBetween,
  SENSE_NAMES,
  SIGHT_SENSES,
  type CreatureSense,
} from './positioning.js';
import { checkContent, extendContent, loadContent } from './content.js';
import type { CatalogueItem } from './catalogue.js';
import type { SpeciesDefinition } from './origins.js';
import { createCharacter, planCharacter } from './creation.js';
import type { CharacterChoices } from './creation.js';

/**
 * A sense a creature has, beyond the sight two creatures declare about each
 * other.
 *
 * Sight in this engine is **declared**: a fact the table states pairwise,
 * never ray-cast, because computing it needs obstacle geometry and that is
 * where a rules engine becomes a VTT. A sense does not overturn that. It is a
 * fact about *one* creature — the SRD rules glossary defines four of them and
 * every one is written "you have X with a range of N feet" — and the sight
 * question consults it where nobody has declared anything.
 *
 * What this is **not** is a lighting model. The engine has no Bright, Dim or
 * Darkness, so a sense cannot be conditioned on light, and the conservative
 * consequence is stated in one rule: **a declaration always outranks a
 * sense.** A table that says a dwarf cannot see through the wall is obeyed
 * whatever the dwarf's Darkvision reaches.
 */

const id = (s: string) => asCharacterId(s);
const SEER = id('seer');
const FAR = id('far');
const NEAR = id('near');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 10,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** Darkvision 60 as a species trait grants it: a self-reaching standing effect. */
const DARKVISION_60 = {
  feature: 'a-species:a-trait',
  name: 'Darkvision',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
} as const;

/**
 * Three creatures on a line: the seer, one thirty feet off, one ninety.
 *
 * Nobody declares any sight, so every answer below is the sense's or nobody's
 * — which is the whole point of the pair of distances.
 */
const PLACED: readonly GameEvent[] = [
  added(SEER, { standing: [DARKVISION_60] }),
  added(NEAR),
  added(FAR),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { creature: SEER }, feet: 30, bearing: 90 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: SEER }, feet: 90, bearing: 90 } },
];

// — the grant, validated ——————————————————————————————————————————————————

/**
 * A species definition carrying one feature, so `checkContent` can be asked
 * about a grant rather than about a whole catalogue.
 */
const speciesGranting = (grant: unknown): SpeciesDefinition =>
  ({
    id: 'nightfolk',
    name: 'Nightfolk',
    creatureType: 'Humanoid',
    sizes: ['Medium'],
    speed: 30,
    features: [
      {
        id: 'nightfolk:darkvision',
        name: 'Darkvision',
        level: 1,
        automation: 'engine',
        note: 'Applied whole: the sense and its range reach the sight question.',
        grants: grant,
      },
    ],
  }) as unknown as SpeciesDefinition;

const itemGranting = (grant: unknown): CatalogueItem =>
  ({
    id: 'night-goggles',
    name: 'Night Goggles',
    kind: 'gear',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [grant],
  }) as unknown as CatalogueItem;

const problemsOfSpecies = (grant: unknown): readonly string[] =>
  checkContent({ species: [speciesGranting(grant)] }).map((p) => `${p.code} @ ${p.field}`);

const problemsOfItem = (grant: unknown): readonly string[] =>
  checkContent({ items: [itemGranting(grant)] }).map((p) => `${p.code} @ ${p.field}`);

const standingSense = (sense: unknown, feet: unknown) => ({
  kind: 'standing',
  reach: 'self',
  effects: [{ kind: 'sense', sense, feet }],
});

describe('the one door accepts a sense and refuses the shapes that are not one', () => {
  it('accepts a well-formed sense on a species trait and on an item', () => {
    expect(problemsOfSpecies(standingSense('darkvision', 60))).toEqual([]);
    expect(
      problemsOfItem({
        ...standingSense('darkvision', 60),
        requires: [{ kind: 'while-worn' }],
      }),
    ).toEqual([]);
  });

  /** Every name the glossary defines, so none is accepted only in principle. */
  it.each(SENSE_NAMES)('accepts %s', (name) => {
    expect(problemsOfSpecies(standingSense(name, 30))).toEqual([]);
  });

  it('refuses a sense the rules glossary does not define, and says which four it does', () => {
    expect(problemsOfSpecies(standingSense('nightvision', 60))).toEqual([
      'bad_sense @ species[nightfolk].features[0].grants.effects[0].sense',
    ]);
    const [problem] = checkContent({ species: [speciesGranting(standingSense('nightvision', 60))] });
    expect(problem?.reason).toContain('nightvision');
    expect(problem?.reason).toContain('darkvision');
  });

  it('refuses a range that is not a whole number of feet', () => {
    for (const feet of ['sixty', 12.5, -10]) {
      expect(problemsOfSpecies(standingSense('darkvision', feet))).toEqual([
        'bad_sense_range @ species[nightfolk].features[0].grants.effects[0].feet',
      ]);
    }
  });

  /** A sense that reaches nowhere is an item whose line silently does nothing. */
  it('refuses a sense with a range of nothing', () => {
    expect(problemsOfSpecies(standingSense('darkvision', 0))).toEqual([
      'sense_of_no_range @ species[nightfolk].features[0].grants.effects[0].feet',
    ]);
    expect(problemsOfItem(standingSense('darkvision', 0))).toEqual([
      'sense_of_no_range @ items[night-goggles].grants[0].effects[0].feet',
    ]);
  });

  /** Both ends of the same rule: the item path refuses the same three shapes. */
  it('refuses a malformed sense on an item too', () => {
    expect(problemsOfItem(standingSense('nightvision', 60))).toEqual([
      'bad_sense @ items[night-goggles].grants[0].effects[0].sense',
    ]);
    expect(problemsOfItem(standingSense('darkvision', 'sixty'))).toEqual([
      'bad_sense_range @ items[night-goggles].grants[0].effects[0].feet',
    ]);
  });
});

// — the reader ————————————————————————————————————————————————————————————

describe('a sense is on the creature, and only on the creature that has it', () => {
  it('reads the sense and its range off the sheet', () => {
    const state = fold('seed', PLACED);
    expect(sensesOf(state, SEER)).toEqual([{ sense: 'darkvision', feet: 60 }]);
  });

  it('gives a creature with no such trait no senses at all', () => {
    const state = fold('seed', PLACED);
    expect(sensesOf(state, NEAR)).toEqual([]);
  });

  /**
   * SRD prints the Drow's Darkvision as an *increase* to 120 feet rather than
   * a second sense, so two grants of one sense are one sense at the longer
   * range — not two entries a reader would have to choose between.
   */
  it.each([
    ['the longer first', ['a-species:a-lineage', 'a-species:a-trait']],
    ['the longer second', ['a-species:a-trait', 'a-species:a-lineage']],
  ] as const)(
    'keeps the longest range when one sense is granted twice, %s',
    (_which, [longer, shorter]) => {
      const state = fold('seed', [
        added(SEER, {
          standing: [
            {
              feature: longer,
              name: 'the deeper sight',
              reach: { kind: 'self' },
              grant: { kind: 'sense', sense: 'darkvision', feet: 120 },
            },
            {
              feature: shorter,
              name: 'Darkvision',
              reach: { kind: 'self' },
              grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
            },
          ],
        }),
      ]);
      expect(sensesOf(state, SEER)).toEqual([{ sense: 'darkvision', feet: 120 }]);
    },
  );

  /** Sorted by name, so two readers of one state agree about the order. */
  it('sorts several senses by name', () => {
    const state = fold('seed', [
      added(SEER, {
        standing: [
          {
            feature: 'a-species:a-trait',
            name: 'Tremorsense',
            reach: { kind: 'self' },
            grant: { kind: 'sense', sense: 'tremorsense', feet: 30 },
          },
          DARKVISION_60,
        ],
      }),
    ]);
    expect(sensesOf(state, SEER).map((s) => s.sense)).toEqual(['darkvision', 'tremorsense']);
  });
});

// — the sight question ————————————————————————————————————————————————————

describe('the sight question consults the seer’s own senses', () => {
  it('answers yes inside the sense’s range where nobody has declared', () => {
    const state = fold('seed', PLACED);
    expect(canSee(state, SEER, NEAR)).toBe(true);
  });

  it('still asks beyond it', () => {
    const state = fold('seed', PLACED);
    expect(canSee(state, SEER, FAR)).toBeNull();
  });

  /** And the sense belongs to the seer: the other direction is unchanged. */
  it('does not lend the sense to whoever is being looked at', () => {
    const state = fold('seed', PLACED);
    expect(canSee(state, NEAR, SEER)).toBeNull();
  });

  /**
   * The rule that keeps this from being a lighting model: the table's word
   * wins. A wall the engine cannot see is a `false` somebody declared, and a
   * sense may not talk over it.
   */
  it('obeys a declared no inside the range', () => {
    const state = fold('seed', [
      ...PLACED,
      { type: 'sight-declared', from: SEER, to: NEAR, seen: false },
    ]);
    expect(canSee(state, SEER, NEAR)).toBe(false);
  });

  it('obeys a declared yes beyond the range', () => {
    const state = fold('seed', [
      ...PLACED,
      { type: 'sight-declared', from: SEER, to: FAR, seen: true },
    ]);
    expect(canSee(state, SEER, FAR)).toBe(true);
  });

  /**
   * The edge of the range, which is the one number the grant carries.
   *
   * "A range of 60 feet" includes sixty, and the lattice is five feet a
   * space, so the first distance that is out of range is sixty-five. Both are
   * asserted because the difference between them is a single comparison.
   */
  it.each([
    [55, true],
    [60, true],
    [65, null],
  ] as const)('reaches %i feet: %s', (feet, seen) => {
    const state = fold('seed', [
      added(SEER, { standing: [DARKVISION_60] }),
      added(NEAR),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: NEAR,
        placement: { from: { creature: SEER }, feet, bearing: 90 },
      },
    ]);
    expect(canSee(state, SEER, NEAR)).toBe(seen);
  });

  /**
   * SRD Total Cover: the target "can't be targeted directly", and the
   * glossary spells the consequence out on Blindsight — "you can see anything
   * that **isn't** behind Total Cover". Cover is a declaration like sight, so
   * a sense may not talk over it either; what is left is the question, not a
   * no.
   */
  it.each([
    ['none', true],
    ['half', true],
    ['three-quarters', true],
    ['total', null],
  ] as const)('answers through %s cover: %s', (degree, seen) => {
    const state = fold('seed', [
      ...PLACED,
      { type: 'cover-declared', from: SEER, to: NEAR, degree },
    ]);
    expect(canSee(state, SEER, NEAR)).toBe(seen);
  });

  /** And a declaration still outranks the cover, in both directions. */
  it('obeys a declared yes through Total Cover', () => {
    const state = fold('seed', [
      ...PLACED,
      { type: 'cover-declared', from: SEER, to: NEAR, degree: 'total' },
      { type: 'sight-declared', from: SEER, to: NEAR, seen: true },
    ]);
    expect(canSee(state, SEER, NEAR)).toBe(true);
  });

  /** SRD Tremorsense: "it doesn't count as a form of sight." */
  it('does not let Tremorsense answer a question about sight', () => {
    const state = fold('seed', [
      added(SEER, {
        standing: [
          {
            feature: 'a-species:a-trait',
            name: 'Tremorsense',
            reach: { kind: 'self' },
            grant: { kind: 'sense', sense: 'tremorsense', feet: 60 },
          },
        ],
      }),
      added(NEAR),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: NEAR,
        placement: { from: { creature: SEER }, feet: 30, bearing: 90 },
      },
    ]);
    expect(sensesOf(state, SEER)).toEqual([{ sense: 'tremorsense', feet: 60 }]);
    expect(canSee(state, SEER, NEAR)).toBeNull();
    // It is still a sense, and still reaches: what it is not is sight.
    expect(sensesReaching(state.scene!, sensesOf(state, SEER), SEER, NEAR)).toEqual([
      { sense: 'tremorsense', feet: 60 },
    ]);
    expect([...SIGHT_SENSES].sort()).toEqual(['blindsight', 'darkvision', 'truesight']);
  });

  /** Outside a scene there is nowhere to measure a range, so there is nothing to say. */
  it('asks rather than answers when nobody is anywhere', () => {
    const state = fold('seed', [added(SEER, { standing: [DARKVISION_60] }), added(NEAR)]);
    expect(canSee(state, SEER, NEAR)).toBeNull();
  });

  /**
   * And the pairwise question itself is untouched for every caller that does
   * not hand it a sense: the fourth argument defaults to none.
   */
  it('leaves the declared question exactly as it was when no sense is supplied', () => {
    const state = fold('seed', PLACED);
    expect(sightBetween(state.scene!, SEER, NEAR)).toBeNull();
    expect(sightBetween(state.scene!, SEER, NEAR, sensesOf(state, SEER))).toBe(true);
  });

  /** A creature nobody has placed is nobody's to sense. */
  it('reaches nobody who is not on the map', () => {
    const empty = scene({ width: 100, depth: 100, height: 20 });
    const senses: readonly CreatureSense[] = [{ sense: 'darkvision', feet: 60 }];
    expect(sensesReaching(empty, senses, SEER, NEAR)).toEqual([]);
  });
});

// — a homebrew species, through the one door ——————————————————————————————

/**
 * The `content.test.ts` pattern: a species authored as JSON text, loaded
 * through `loadContent`, and a character created on it — with no engine
 * change, which is the whole claim a grant kind makes.
 */
describe('a homebrew species declares a sense and the engine never hears its name', () => {
  const CAVE_FOLK = JSON.stringify({
    id: 'cave-folk',
    name: 'Cave Folk',
    creatureType: 'Humanoid',
    sizes: ['Medium'],
    speed: 30,
    features: [
      {
        id: 'cave-folk:deep-eyes',
        name: 'Deep Eyes',
        level: 1,
        automation: 'engine',
        note: 'Applied whole: Darkvision out to 90 feet, read by the sight question.',
        grants: {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'sense', sense: 'darkvision', feet: 90 }],
        },
      },
    ],
  });

  const loaded = unwrap(loadContent({ species: [JSON.parse(CAVE_FOLK)] }), 'load');
  const content = unwrap(extendContent(SRD_CONTENT, { species: [...loaded.species] }), 'extend');

  const choices = (): CharacterChoices => ({
    name: 'Mole',
    classId: 'fighter',
    level: 1,
    speciesId: 'cave-folk',
    backgroundId: 'criminal',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { dex: 2, con: 1 },
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
    featureChoices: {},
    feats: {
      'fighter:fighting-style': { featId: 'defense' },
      'criminal:alert': { featId: 'alert' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  it('is parsed from JSON and validated beside the printed species', () => {
    expect(content.speciesById('cave-folk')?.features).toHaveLength(1);
    expect(SRD_CONTENT.speciesById('cave-folk')).toBeNull();
  });

  it('creates a character who carries the sense, and sees by it', () => {
    const plan = unwrap(planCharacter(content, choices()), 'plan');
    expect(plan.warnings).toEqual([]);

    const events = unwrap(createCharacter(content, choices(), SEER), 'creation') as GameEvent[];
    const state = fold('seed', [
      ...events,
      added(NEAR),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: NEAR,
        placement: { from: { creature: SEER }, feet: 60, bearing: 90 },
      },
    ]);

    expect(sensesOf(state, SEER)).toEqual([{ sense: 'darkvision', feet: 90 }]);
    expect(canSee(state, SEER, NEAR)).toBe(true);
  });
});
