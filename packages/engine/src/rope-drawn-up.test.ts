import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet, OtherSpeeds } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { elsewhereOf } from './elsewhere.js';
import {
  declareWayInHeight,
  drawWayIn,
  enterElsewhere,
  resolveMove,
  resolveSpell,
} from './commands.js';

/**
 * SRD Rope Trick, the two sentences the space was waiting on:
 *
 * > "One end of it hovers upward until the rope hangs perpendicular to the
 * > ground or the rope reaches a ceiling. At the rope's upper end, an
 * > Invisible 3-foot-by-5-foot portal opens to an extradimensional space …
 * > That space can be reached by climbing the rope, which can be pulled into
 * > or dropped out of it."
 *
 * **The height is the room's.** How far the rope rises before a ceiling stops
 * it is a fact about the room, so the DM states it (`declareWayInHeight`, on the
 * DM's door by the §10 falling ruling) and the record pins it; until then the
 * climb is asked for it. With it, the way in is the portal at the top of the
 * rope, and a creature gets there by ordinary moves — a climb the movement
 * rules already charge — and enters within reach of it.
 *
 * **The rope is the way in, and a creature inside can take it away.** Drawn
 * up, it refuses a climber below (`way_in_drawn_up`); only a creature that can
 * reach the portal without it — a Fly Speed, or a lift — still comes in.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const ROGUE = id('rogue');
const BIRD = id('bird');

const sheet = (speeds?: OtherSpeeds): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 120,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...(speeds === undefined ? {} : { speeds }),
});

const added = (who: CharacterId, speeds?: OtherSpeeds): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(speeds),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const DOOR = { x: 100, y: 100, z: 0 };

const FIELD: readonly GameEvent[] = [
  added(WIZARD),
  added(FIGHTER),
  added(ROGUE),
  added(BIRD, { fly: 60 }),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['rope-trick'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: DOOR },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the door' }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the door' }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: BIRD, placement: { from: { landmark: 'the door' }, feet: 5, bearing: 270 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('rope') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const unwrapped = <T,>(result: Result<T>, step: string): T => unwrap(result, step);
const after = (state: GameState, events: readonly GameEvent[]): GameState => events.reduce(applyEvent, state);

/** The rope hung at the door, and — where the DM has said so — how high it rose. */
const hung = (feet?: number): { state: GameState; castingId: string } => {
  const start = fold('rope', FIELD);
  const cast = unwrapped(
    resolveSpell(start, WIZARD, { spellId: 'rope-trick', targets: [], at: DOOR, slotLevel: 2 }, supply(start)),
    'the rope',
  );
  const state = after(start, cast.events);
  const castingId = cast.castingId!;
  if (feet === undefined) return { state, castingId };
  return {
    castingId,
    state: after(state, unwrapped(declareWayInHeight(state, SRD_CONTENT, castingId, { feet }), 'the height')),
  };
};

/** Up the rope, by the ordinary climb, to the portal at its top. */
const climbTo = (state: GameState, who: CharacterId, feet: number, mode: 'climb' | 'fly' = 'climb'): GameState =>
  after(
    state,
    unwrapped(
      resolveMove(state, who, { placement: { from: { landmark: 'the door' }, feet: 5, bearing: 90, elevation: feet }, mode }, supply(state)),
      `${who} climbs`,
    ).events,
  );

const enter = (state: GameState, who: CharacterId, castingId: string, commandId?: string) =>
  enterElsewhere(state, who, SRD_CONTENT, { castingId, ...(commandId === undefined ? {} : { commandId }) });

describe('SRD Rope Trick: the portal at the rope’s upper end', () => {
  it('asks the DM how high the rope rose before anybody climbs', () => {
    const { state, castingId } = hung();
    const asked = enter(state, FIGHTER, castingId);
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('no_way_in_height');
    expect(isNeedsContext(asked) && contextRequestsOf(asked)[0]?.kind).toBe('scene');
    expect(isNeedsContext(asked) && contextRequestsOf(asked)[0]?.satisfyWith).toContain('declareWayInHeight');
  });

  it('pins the height on the running casting', () => {
    const { state, castingId } = hung(30);
    expect(state.ongoing[castingId]?.wayInHeight).toBe(30);
  });

  it('refuses a height the room cannot hold, and a casting that opens no way in', () => {
    const { state, castingId } = hung();
    const tall = declareWayInHeight(state, SRD_CONTENT, castingId, { feet: 60 });
    expect(isErr(tall) && tall.code).toBe('outside_scene');
    const bad = declareWayInHeight(state, SRD_CONTENT, castingId, { feet: -5 });
    expect(isErr(bad) && bad.code).toBe('bad_height');
    const none = declareWayInHeight(state, SRD_CONTENT, 'cast:99', { feet: 10 });
    expect(isErr(none) && none.code).toBe('not_ongoing');
  });

  it('refuses a climber still on the floor thirty feet below, and takes one who climbed to the top', () => {
    const { state, castingId } = hung(30);
    const below = enter(state, FIGHTER, castingId);
    expect(isErr(below) && below.code).toBe('out_of_reach');
    const up = climbTo(state, FIGHTER, 30);
    const inside = after(up, unwrapped(enter(up, FIGHTER, castingId), 'the way in').events);
    expect(elsewhereOf(inside, FIGHTER)?.kind).toBe('extradimensional');
  });

  it('says nothing about the climb being the table’s any more: the climb was a move', () => {
    const { state, castingId } = hung(30);
    const up = climbTo(state, FIGHTER, 30);
    const entered = unwrapped(enter(up, FIGHTER, castingId), 'the way in');
    expect(entered.unverified.join(' ')).not.toContain('movement the climb costs');
  });
});

describe('SRD Rope Trick: "which can be pulled into or dropped out of it"', () => {
  /** The fighter inside, the rope thirty feet up. */
  const withFighterInside = () => {
    const { state, castingId } = hung(30);
    const up = climbTo(state, FIGHTER, 30);
    return { castingId, state: after(up, unwrapped(enter(up, FIGHTER, castingId), 'the fighter climbs in').events) };
  };

  it('is drawn up by a creature inside, and a climber below is refused', () => {
    const { state, castingId } = withFighterInside();
    const drawn = after(state, unwrapped(drawWayIn(state, FIGHTER, SRD_CONTENT, { castingId, up: true }), 'the rope up'));
    expect(drawn.ongoing[castingId]?.wayInClosed).toBe(true);
    const rogueUp = climbTo(drawn, ROGUE, 30);
    const refused = enter(rogueUp, ROGUE, castingId);
    expect(isErr(refused) && refused.code).toBe('way_in_drawn_up');
  });

  it('lets a flier reach the portal without it', () => {
    const { state, castingId } = withFighterInside();
    const drawn = after(state, unwrapped(drawWayIn(state, FIGHTER, SRD_CONTENT, { castingId, up: true }), 'the rope up'));
    const flown = climbTo(drawn, BIRD, 30, 'fly');
    const inside = after(flown, unwrapped(enter(flown, BIRD, castingId), 'the bird flies in').events);
    expect(elsewhereOf(inside, BIRD)?.kind).toBe('extradimensional');
  });

  it('is drawn only by a creature inside', () => {
    const { state, castingId } = withFighterInside();
    const outside = drawWayIn(state, ROGUE, SRD_CONTENT, { castingId, up: true });
    expect(isErr(outside) && outside.code).toBe('not_inside');
  });

  it('is dropped again, and the way is open', () => {
    const { state, castingId } = withFighterInside();
    const drawn = after(state, unwrapped(drawWayIn(state, FIGHTER, SRD_CONTENT, { castingId, up: true }), 'the rope up'));
    const again = drawWayIn(drawn, FIGHTER, SRD_CONTENT, { castingId, up: true, commandId: 'twice' });
    expect(isErr(again) && again.code).toBe('way_in_already');
    const dropped = after(
      drawn,
      unwrapped(drawWayIn(drawn, FIGHTER, SRD_CONTENT, { castingId, up: false, commandId: 'down' }), 'the rope down'),
    );
    expect(dropped.ongoing[castingId]?.wayInClosed).toBeUndefined();
    const rogueUp = climbTo(dropped, ROGUE, 30);
    expect(enter(rogueUp, ROGUE, castingId).ok).toBe(true);
  });

  it('is idempotent under its command id', () => {
    const { state, castingId } = withFighterInside();
    const first = unwrapped(drawWayIn(state, FIGHTER, SRD_CONTENT, { castingId, up: true, commandId: 'pull' }), 'first');
    const drawn = after(state, first);
    const retry = unwrapped(drawWayIn(drawn, FIGHTER, SRD_CONTENT, { castingId, up: true, commandId: 'pull' }), 'retry');
    expect(retry).toEqual([]);
    const height = unwrapped(declareWayInHeight(drawn, SRD_CONTENT, castingId, { feet: 20, commandId: 'h' }), 'height');
    const pinned = after(drawn, height);
    expect(unwrapped(declareWayInHeight(pinned, SRD_CONTENT, castingId, { feet: 20, commandId: 'h' }), 'retry')).toEqual([]);
  });
});
