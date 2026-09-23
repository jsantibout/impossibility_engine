import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  carryingCapacity,
  createCharacter,
  createRollIssuer,
  escapeGrapple,
  fold,
  grapplesOn,
  grappleTarget,
  resolveEffectCheck,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * **SRD Powerful Build, which is two sentences and was blocked on two things.**
 *
 * > You have Advantage on any ability check you make to end the Grappled
 * > condition. You also count as one size larger when determining your
 * > carrying capacity.
 *
 * The first named a **condition**, and the condition axis a `RollSelector`
 * carries was legal on a saving throw and refused everywhere else — because no
 * ability check in this engine said what it was about, so a grant written
 * there would have picked out nothing for ever. Two checks say now, and they
 * are the two doors out of an effect: `resolveEffectCheck`, and `escapeGrapple`
 * for the second ability the book offers. Both derive the answer from the
 * timer they are settling, so neither can drift from the other.
 *
 * The second was blocked on there being no capacity at all. There is one since
 * the objects batch — `carryingCapacity` reads the printed table — so what was
 * missing is only which row.
 */

const id = (s: string) => asCharacterId(s);
const KOTH = id('koth');
const BREN = id('bren');
const OGRE = id('ogre');

const choices = (speciesId: string, who: string): CharacterChoices => ({
  name: who,
  classId: 'fighter',
  level: 5,
  speciesId,
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'fighter:weapon-mastery': [],
    ...(speciesId === 'human' ? { 'human:skillful': ['perception'] } : {}),
    ...(speciesId === 'goliath' ? { 'goliath:giant-ancestry': ["Stone's Endurance"] } : {}),
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'defense' },
    'fighter:ability-score-improvement': { featId: 'two-weapon-fighting' },
    ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, choices('goliath', 'Koth'), KOTH), 'goliath') as GameEvent[]),
  ...(unwrap(createCharacter(SRD_CONTENT, choices('human', 'Bren'), BREN), 'human') as GameEvent[]),
  { type: 'creature-side-declared', id: KOTH, side: 'party' },
  { type: 'creature-side-declared', id: BREN, side: 'party' },
  {
    type: 'creature-added',
    id: OGRE,
    name: 'ogre',
    sheet: plain(),
    maxHp: 59,
    diesAtZero: true,
    creatureType: 'Giant',
    size: 'large',
    side: 'ogres',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: KOTH, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: BREN, placement: { from: { creature: KOTH }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: KOTH }, feet: 5, bearing: 0 } },
];

const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rng: Rng) => ({ issuer: createRollIssuer('r'), rng, content: SRD_CONTENT });

/** The Ogre grabs somebody — its save fails — and the world that leaves. */
const grabbed = (who: CharacterId): GameState => {
  const held = unwrap(
    grappleTarget(
      fold('seed', SETUP),
      OGRE,
      { target: who, save: 'str' },
      supply(scripted({ 20: [1] })),
    ),
    'grapple',
  );
  if (!held.applied) throw new Error('the grapple did not land');
  return fold('seed', [...SETUP, ...held.events]);
};

/** The modes the escape roll was made under, as the log recorded them. */
const modesOf = (events: readonly GameEvent[]): readonly string[] => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return (record.modes ?? []).map((one) => `${one.source}:${one.mode}`);
};

describe('the check that ends a Grapple says what it is about', () => {
  it('gives a Goliath Advantage on the escape, naming the trait', () => {
    const state = grabbed(KOTH);
    const out = unwrap(
      escapeGrapple(state, KOTH, { ability: 'str' }, supply(scripted({ 20: [14, 3] }))),
      'escape',
    );
    expect(modesOf(out.events)).toContain('Powerful Build:advantage');
    expect(out.check?.mode).toBe('advantage');
  });

  /** The book offers two abilities, so the trait must reach both. */
  it('reaches the Dexterity half of the same sentence', () => {
    const state = grabbed(KOTH);
    const out = unwrap(
      escapeGrapple(state, KOTH, { ability: 'dex' }, supply(scripted({ 20: [14, 3] }))),
      'escape',
    );
    expect(out.check?.mode).toBe('advantage');
  });

  /**
   * A Human of the same build gets nothing from this sentence. The Dexterity
   * half is the honest comparison: the Champion's Remarkable Athlete already
   * hands both of them Advantage on Athletics, which is a different sentence
   * about a different set of checks and is exactly what a trait keyed to the
   * condition must not be confused with.
   */
  it('gives a Human nothing on the same escape', () => {
    const state = grabbed(BREN);
    const out = unwrap(
      escapeGrapple(state, BREN, { ability: 'dex' }, supply(scripted({ 20: [14, 3] }))),
      'escape',
    );
    expect(modesOf(out.events)).toEqual([]);
    expect(out.check?.mode).toBe('normal');
  });

  /**
   * **The other door, and the reason both had to be taught the same fact.**
   * A grapple files its escape as the Strength half of the SRD's pair, so the
   * generic `resolveEffectCheck` performs a real escape too; a trait that
   * reached only `escapeGrapple` would be a trait that depended on which
   * function the caller happened to pick.
   */
  it('reaches the escape made through the generic effect-check door', () => {
    const state = grabbed(KOTH);
    const held = grapplesOn(state, KOTH);
    expect(held).toHaveLength(1);
    const out = unwrap(
      resolveEffectCheck(
        state,
        KOTH,
        { effectKey: held[0]!.effectKey },
        supply(scripted({ 20: [14, 3] })),
      ),
      'effect check',
    );
    expect(modesOf(out.events)).toContain('Powerful Build:advantage');
    expect(out.check?.mode).toBe('advantage');
  });
});

describe('the Goliath reads the row above its own', () => {
  /**
   * SRD Carrying Capacity: Strength × 15 for a Small or Medium creature, and
   * double that for a Large one. Both Goliath and Human here have a Strength
   * of 15, and the Goliath is Medium.
   */
  it('carries and drags the Large figures', () => {
    const state = fold('seed', SETUP);
    expect(state.creatures[KOTH]!.size).toBe('medium');
    expect(carryingCapacity(state, KOTH)).toEqual({ carry: 15 * 15 * 2, dragLiftPush: 15 * 15 * 4 });
  });

  it('leaves a Human of the same Strength on its own row', () => {
    const state = fold('seed', SETUP);
    expect(carryingCapacity(state, BREN)).toEqual({ carry: 15 * 15, dragLiftPush: 15 * 15 * 2 });
  });

  /** Nothing else about the creature's size moved. */
  it('does not make the Goliath Large for anything but the table', () => {
    const state = fold('seed', SETUP);
    expect(state.creatures[KOTH]!.size).toBe('medium');
  });
});
