import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type CharacterId } from '@ie/shared';
import type { CharacterSheet, OtherSpeeds } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { altitudeOf } from './positioning.js';
import {
  declareFalling,
  endConcentration,
  reactionOpportunities,
  resolveFall,
  resolveSpell,
} from './commands.js';

/**
 * SRD Fly, the sentence the definition could not reach:
 *
 * > "When the spell ends, the target falls if it is still aloft unless it can
 * > stop the fall."
 *
 * SRD Levitate's other half ("floats gently to the ground") already set a
 * creature down in the fold at both doors out of a casting; this is the same
 * question asked of the Fly Speed the casting granted, with a fall rather
 * than a landing as its answer. The fall is **derived** — nobody decides that
 * a Concentration broke — and the height it began at is the lattice's, pinned
 * on the moment so the landing reads a number the scene supplied rather than
 * one the table has to.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const RANGER = id('ranger');
const SORCERER = id('sorcerer');
const OWL = id('owl');

const sheet = (speeds?: OtherSpeeds): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...(speeds === undefined ? {} : { speeds }),
});

const added = (who: CharacterId, speeds?: OtherSpeeds): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(speeds),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/** Everybody over the courtyard at `feet`, the wizard with Feather Fall ready. */
const field = (feet: number): readonly GameEvent[] => [
  added(WIZARD),
  added(RANGER),
  added(SORCERER),
  added(OWL, { fly: 60 }),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['fly', 'feather-fall'] }),
  },
  {
    type: 'spellcasting-declared',
    id: SORCERER,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'sorcerer', prepared: ['levitate'] }),
  },
  ...slots(WIZARD),
  ...slots(SORCERER),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 100 } },
  { type: 'landmark-added', name: 'the courtyard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the courtyard' }, feet: 0, elevation: feet } },
  {
    type: 'creature-placed',
    id: RANGER,
    placement: { from: { landmark: 'the courtyard' }, feet: 5, bearing: 90, elevation: feet },
  },
  {
    type: 'creature-placed',
    id: OWL,
    placement: { from: { landmark: 'the courtyard' }, feet: 5, bearing: 270, elevation: feet },
  },
  { type: 'creature-placed', id: SORCERER, placement: { from: { landmark: 'the courtyard' }, feet: 10, bearing: 180 } },
  ...[RANGER, OWL].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: WIZARD, to: who, seen: true },
    { type: 'sight-declared', from: SORCERER, to: who, seen: true },
  ]),
  { type: 'sight-declared', from: WIZARD, to: SORCERER, seen: true },
  { type: 'sight-declared', from: SORCERER, to: WIZARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: SORCERER, initiative: 15, speed: 30 },
      { id: RANGER, initiative: 10, speed: 30 },
      { id: OWL, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, seed = 'fly-fall') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const after = (state: GameState, events: readonly GameEvent[]): GameState => events.reduce(applyEvent, state);

/** The wizard casts Fly on the named creatures, at the slot their count needs. */
const flying = (feet: number, targets: readonly CharacterId[] = [WIZARD]) => {
  const before = fold('s', field(feet));
  const cast = unwrap(
    resolveSpell(
      before,
      WIZARD,
      { spellId: 'fly', targets, willing: targets, slotLevel: 2 + targets.length },
      supply(before),
    ),
    'Fly',
  );
  return { state: after(before, cast.events), castingId: cast.castingId! };
};

/** The wizard lets the Concentration go. */
const letGo = (state: GameState): GameState =>
  after(state, unwrap(endConcentration(state, WIZARD, 'voluntary'), 'the Concentration goes'));

describe('SRD Fly: "When the spell ends, the target falls if it is still aloft"', () => {
  it('drops a wizard thirty feet up when the Concentration goes, from the height the lattice held', () => {
    const { state } = flying(30);
    const fallen = letGo(state);
    expect(fallen.creatures[WIZARD]?.falling).toEqual({
      turn: fallen.combat?.turnsTaken ?? null,
      elapsed: fallen.elapsed,
      from: 30,
    });
  });

  it('opens Feather Fall’s window on the moment, as a declared fall does', () => {
    const fallen = letGo(flying(30).state);
    const chances = reactionOpportunities(fallen, SRD_CONTENT).filter((chance) => chance.id === 'feather-fall');
    expect(chances).toEqual([
      expect.objectContaining({ window: 'creature-falling', reactor: WIZARD, against: WIZARD }),
    ]);
  });

  it('lands the fall with no height stated: 3d6 off the pinned thirty, and Prone', () => {
    const fallen = letGo(flying(30).state);
    const landed = unwrap(resolveFall(fallen, WIZARD, {}, supply(fallen)), 'the landing');
    expect(landed.dice).toBe('3d6');
    expect(landed.prone).toBe(true);
    const down = after(fallen, landed.events);
    expect(altitudeOf(down.scene!, WIZARD)).toBe(0);
    expect(landed.unverified.join(' ')).toContain('30 feet');
  });

  it('lets a stated height win over the pinned one', () => {
    const fallen = letGo(flying(30).state);
    const landed = unwrap(resolveFall(fallen, WIZARD, { feet: 10 }, supply(fallen)), 'the landing');
    expect(landed.dice).toBe('1d6');
  });

  it('drops nobody who was standing on the floor', () => {
    const fallen = letGo(flying(0).state);
    expect(fallen.creatures[WIZARD]?.falling).toBeNull();
  });

  it('drops no owl: a Fly Speed of its own stops the fall', () => {
    const fallen = letGo(flying(30, [OWL]).state);
    expect(fallen.creatures[OWL]?.falling).toBeNull();
  });

  it('drops nobody another casting is holding up', () => {
    const state = after(flying(30, [RANGER]).state, [{ type: 'turn-advanced' }]);
    const levitated = unwrap(
      resolveSpell(
        state,
        SORCERER,
        { spellId: 'levitate', targets: [RANGER], willing: [RANGER], slotLevel: 2 },
        supply(state),
      ),
      'Levitate',
    );
    const held = after(state, levitated.events);
    expect(held.creatures[RANGER]?.lifts.length).toBe(1);
    const fallen = letGo(held);
    expect(fallen.creatures[RANGER]?.falling).toBeNull();
  });

  it('drops the one target a casting is ended on, and leaves the other flying', () => {
    const { state, castingId } = flying(30, [WIZARD, RANGER]);
    const ended = after(state, [{ type: 'spell-ended', castingId, on: RANGER, reason: 'dispelled' }]);
    expect(ended.creatures[RANGER]?.falling).toMatchObject({ from: 30 });
    expect(ended.creatures[WIZARD]?.falling).toBeNull();
  });
});

describe('a fall that carries no height', () => {
  it('still asks for one: a declared fall pins nothing', () => {
    const state = fold('s', field(30));
    const declared = after(state, unwrap(declareFalling(state, RANGER), 'the fall'));
    expect(declared.creatures[RANGER]?.falling).not.toHaveProperty('from');
    const asked = resolveFall(declared, RANGER, {}, supply(declared));
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('no_fall_height');
  });

  it('reads a pinned height only while the creature is still where the fall began', () => {
    const fallen = letGo(flying(30).state);
    const landed = after(fallen, unwrap(resolveFall(fallen, WIZARD, {}, supply(fallen)), 'the landing').events);
    // The moment is still on the creature — nothing closes a fall but the
    // clock — and a second landing is not thirty feet again.
    const again = resolveFall(landed, WIZARD, { commandId: 'again' }, supply(landed));
    expect(isNeedsContext(again)).toBe(true);
    expect(isErr(again) && again.code).toBe('no_fall_height');
  });
});
