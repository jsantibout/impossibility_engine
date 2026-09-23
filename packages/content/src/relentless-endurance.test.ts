import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  createCharacter,
  damageCreature,
  fold,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * **SRD Relentless Endurance, and the reason it is on the event.**
 *
 * > When you are reduced to 0 Hit Points but not killed outright, you can drop
 * > to 1 Hit Point instead. Once you use this trait, you can't do so again
 * > until you finish a Long Rest.
 *
 * `applyVitals` recomputes the blow from `damage-taken` — it calls
 * `applyDamageToVitals` a second time, from the event — so an interception
 * that lived only in the command would be undone the first time the log was
 * replayed, and the Orc would come back from the fold at 0. The floor is
 * therefore *pinned* by the command and *read* by the fold, which is the same
 * rule a casting's area follows: a replay reads a number somebody already
 * decided and opens no catalogue.
 *
 * "But not killed outright" needs no field at all, and this file proves it in
 * both directions.
 */

const id = (s: string) => asCharacterId(s);
const GRUK = id('gruk');
const BREN = id('bren');
const SKELETON = id('skeleton');

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
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** An Orc, a Human of the same build, and a monster that dies at zero. */
const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, choices('orc', 'Gruk'), GRUK), 'orc') as GameEvent[]),
  ...(unwrap(createCharacter(SRD_CONTENT, choices('human', 'Bren'), BREN), 'human') as GameEvent[]),
  {
    type: 'creature-added',
    id: SKELETON,
    name: 'skeleton',
    sheet: plain(),
    maxHp: 13,
    diesAtZero: true,
    creatureType: 'Undead',
  },
];

/** Bring a creature to exactly `hp` hit points, then hand back the log. */
const wounded = (who: CharacterId, to: number): readonly GameEvent[] => {
  const state = fold('seed', SETUP);
  const max = state.creatures[who]!.vitals.hpMax;
  if (max === to) return SETUP;
  return [...SETUP, { type: 'damage-taken', id: who, amount: max - to, source: 'a long day' }];
};

const hit = (
  log: readonly GameEvent[],
  who: CharacterId,
  amount: number,
): { readonly events: readonly GameEvent[]; readonly after: GameState } => {
  const events = unwrap(
    damageCreature(fold('seed', log), who, { amount, source: 'a greataxe', by: BREN }),
    'damage',
  );
  return { events, after: fold('seed', [...log, ...events]) };
};

describe('SRD Relentless Endurance holds an Orc at 1 hit point', () => {
  it('lands on 1 instead of 0, and the fold replays to 1', () => {
    // A blow of 9 against 5 remaining is a drop to 0 with 4 left over, which
    // is nowhere near the hit point maximum — so it is not killing outright.
    const out = hit(wounded(GRUK, 5), GRUK, 9);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');

    expect(taken.floor).toEqual({
      at: 1,
      feature: 'Relentless Endurance',
      spent: { key: 'orc:relentless-endurance', recovers: 'long-rest' },
    });
    expect(out.after.creatures[GRUK]!.vitals.hp).toBe(1);
    expect(out.after.creatures[GRUK]!.vitals.dead).toBe(false);
  });

  it('leaves the Orc conscious and on its feet', () => {
    const out = hit(wounded(GRUK, 5), GRUK, 9);
    expect(out.events.some((e) => e.type === 'condition-applied')).toBe(false);
    expect(
      out.after.creatures[GRUK]!.conditions.instances.some(
        (one) => one.condition === 'unconscious',
      ),
    ).toBe(false);
  });

  /**
   * **The price is on the event that carries the claim, and on no other.** A
   * `resource-spent` beside the damage would have put `damageCreature` and the
   * seven commands that land damage through it into `invariants.test.ts`'s
   * list of spenders that must ask `mayAct` — a question a blow has no
   * business asking — so the count is taken off the floor itself, and the two
   * halves of one fact cannot come apart.
   */
  it('counts the use off the same event, and emits no spend beside it', () => {
    const out = hit(wounded(GRUK, 5), GRUK, 9);
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(false);
    expect(out.after.creatures[GRUK]!.resources.tallies['orc:relentless-endurance']).toEqual({
      key: 'orc:relentless-endurance',
      count: 1,
      recovers: 'long-rest',
    });
  });

  it('carries the dealer beside the floor, for whoever reads the moment next', () => {
    const out = hit(wounded(GRUK, 5), GRUK, 9);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.by).toBe(BREN);
  });
});

describe('once, and then not again until a Long Rest', () => {
  const firstDrop = (): readonly GameEvent[] => {
    const log = wounded(GRUK, 5);
    return [...log, ...hit(log, GRUK, 9).events];
  };

  it('lands on 0 the second time the same day', () => {
    const out = hit(firstDrop(), GRUK, 4);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.floor).toBeUndefined();
    expect(out.after.creatures[GRUK]!.vitals.hp).toBe(0);
    expect(
      out.after.creatures[GRUK]!.conditions.instances.some(
        (one) => one.condition === 'unconscious',
      ),
    ).toBe(true);
  });

  it('has the use back after a Long Rest', () => {
    // The three events `endRest` emits for a finished Long Rest, written out
    // rather than driven: the command needs eight hours on the clock and the
    // fact under test is what `resources-restored` does to a tally, which is
    // the same fold body either way.
    const rested: readonly GameEvent[] = [
      ...firstDrop(),
      { type: 'healed', id: GRUK, amount: 20 },
      { type: 'rest-begun', id: GRUK, kind: 'long' },
      { type: 'resources-restored', id: GRUK, recovers: 'long-rest' },
      { type: 'rest-ended', id: GRUK, kind: 'long', benefit: 'long' },
    ];
    const state = fold('seed', rested);
    // The rest put the hit points back; take them down to 5 again and swing.
    const again: readonly GameEvent[] = [
      ...rested,
      {
        type: 'damage-taken',
        id: GRUK,
        amount: state.creatures[GRUK]!.vitals.hp - 5,
        source: 'a second long day',
      },
    ];
    const out = hit(again, GRUK, 9);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.floor?.at).toBe(1);
    expect(out.after.creatures[GRUK]!.vitals.hp).toBe(1);
  });
});

describe('"but not killed outright" is the two ways a blow kills', () => {
  /**
   * SRD Massive Damage: "if the remainder equals or exceeds their Hit Point
   * maximum, the character dies". The trait is read after that is settled, so
   * it cannot save anybody from it.
   */
  it('does not fire on Massive Damage, and does not spend the use', () => {
    const state = fold('seed', SETUP);
    const max = state.creatures[GRUK]!.vitals.hpMax;
    const out = hit(wounded(GRUK, 5), GRUK, 5 + max);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.floor).toBeUndefined();
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(false);
    expect(out.after.creatures[GRUK]!.vitals.dead).toBe(true);
  });

  it('leaves the count at nothing, so no use was quietly eaten', () => {
    const state = fold('seed', SETUP);
    const max = state.creatures[GRUK]!.vitals.hpMax;
    const out = hit(wounded(GRUK, 5), GRUK, 5 + max);
    expect(out.after.creatures[GRUK]!.resources.tallies['orc:relentless-endurance']).toBeUndefined();
  });
});

describe('the trait belongs to the creature that holds it', () => {
  it('a monster that dies at 0 never reaches the floor', () => {
    const out = hit(SETUP, SKELETON, 13);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.floor).toBeUndefined();
    expect(out.after.creatures[SKELETON]!.vitals.dead).toBe(true);
  });

  it('a Human of the same build drops to 0 exactly as before', () => {
    const out = hit(wounded(BREN, 5), BREN, 9);
    const taken = out.events.find((e) => e.type === 'damage-taken');
    if (taken?.type !== 'damage-taken') throw new Error('nothing was damaged');
    expect(taken.floor).toBeUndefined();
    expect(out.after.creatures[BREN]!.vitals.hp).toBe(0);
    expect(
      out.after.creatures[BREN]!.conditions.instances.some(
        (one) => one.condition === 'unconscious',
      ),
    ).toBe(true);
  });
});
