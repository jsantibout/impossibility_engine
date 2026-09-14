import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { positionOf } from './positioning.js';
import { movementLeftFor } from './standing.js';
import {
  declineOpportunity,
  pendingMoveOf,
  resolveMove,
  resolveTurn,
  takeOpportunityAttack,
} from './commands.js';

/**
 * Moving, and what moving provokes.
 *
 * `moveCreature` and `spendMovement` have both existed since positioning and
 * combat landed, and neither was called by anything: a creature could cross a
 * battlefield without spending a foot of Speed, and nobody ever got an
 * Opportunity Attack, because no command sat between the two.
 *
 * SRD: "You can make an Opportunity Attack when a creature that you can see
 * leaves your reach using its action, its Bonus Action, its Reaction, or one
 * of its speeds. To make the Opportunity Attack, take a Reaction to make one
 * melee attack with a weapon or an Unarmed Strike against the provoking
 * creature. **The attack occurs right before the creature leaves your reach.**"
 *
 * That last sentence is the whole design problem, and it is the same one
 * Divine Smite posed: the attack has to resolve while the mover is still
 * standing where they were. So a move that provokes is **held** — the same
 * shape `pendingAttack` already uses — and completes once every provoked
 * creature has taken its Reaction or passed.
 *
 * Three clauses of that sentence are easy to lose, and each has a test:
 *
 * - **"using its action, its Bonus Action, its Reaction, or one of its
 *   speeds"** — being shoved by Thunderwave is none of those, so forced
 *   movement provokes nobody.
 * - **"leaves your reach"** — not "moves while in your reach". Stepping from
 *   five feet to ten provokes; circling at five does not.
 * - **"that you can see"** — sight is declared here, and a creature nobody has
 *   said about is not thereby blind.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const OGRE = id('ogre');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The rogue at the ford, an ogre beside them, an ally behind. */
const SETUP: readonly GameEvent[] = [
  added(ROGUE, 'party'),
  added(OGRE, 'ogres'),
  added(ALLY, 'party'),
  { type: 'items-gained', id: OGRE, items: [{ id: 'greatclub', quantity: 1 }], source: 'kit' },
  { type: 'item-equipped', id: OGRE, item: 'greatclub' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: ROGUE }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: ROGUE }, feet: 5, bearing: 180 } },
  { type: 'sight-declared', from: OGRE, to: ROGUE, seen: true },
  { type: 'sight-declared', from: ALLY, to: ROGUE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ROGUE, initiative: 20, speed: 30 },
      { id: OGRE, initiative: 10, speed: 30 },
      { id: ALLY, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'move') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** Move the rogue somewhere, relative to the ford. */
const away = (feet: number, forced = false) => ({
  placement: { from: { landmark: 'the ford' }, feet, bearing: 90 },
  ...(forced ? { forced: true } : {}),
});

const move = (log: readonly GameEvent[], request: Parameters<typeof resolveMove>[2]) => {
  const out = unwrap(resolveMove(fold('seed', log), ROGUE, request, supply()), 'move');
  return { ...out, log: [...log, ...out.events] };
};

describe('moving spends movement', () => {
  it('takes the distance out of the turn’s budget', () => {
    const out = move(SETUP, away(20));
    expect(out.feet).toBe(20);
    expect(movementLeftFor(fold('seed', out.log), ROGUE)).toBe(10);
  });

  it('refuses a move further than the Speed left', () => {
    const out = resolveMove(fold('seed', SETUP), ROGUE, away(40), supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_enough_movement');
  });

  it('leaves the creature where it was when it refuses', () => {
    resolveMove(fold('seed', SETUP), ROGUE, away(40), supply());
    const state = fold('seed', SETUP);
    expect(positionOf(state.scene!, ROGUE)).toEqual({ x: 100, y: 100, z: 0 });
  });

  /** SRD Grappled: "Your Speed becomes 0." */
  it('refuses to move a creature whose Speed is zero', () => {
    const held: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: ROGUE, condition: 'grappled', source: 'the ogre' },
    ];
    const out = resolveMove(fold('seed', held), ROGUE, away(5), supply());
    expect(isErr(out)).toBe(true);
  });

  /**
   * SRD Exhaustion: "Your Speed is reduced by a number of feet equal to 5
   * times your Exhaustion level." Two levels off a Speed of 30 is 20.
   */
  it('reads Speed after Exhaustion has taken its share', () => {
    const tired: readonly GameEvent[] = [...SETUP, { type: 'exhaustion-set', id: ROGUE, level: 2 }];
    expect(isErr(resolveMove(fold('seed', tired), ROGUE, away(25), supply()))).toBe(true);
    expect(isErr(resolveMove(fold('seed', tired), ROGUE, away(20), supply()))).toBe(false);
  });

  /** Outside combat there is no budget, so movement is narration. */
  it('spends nothing outside combat', () => {
    const peace = SETUP.filter((e) => e.type !== 'combat-started');
    const out = move(peace, away(300));
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(false);
  });
});

describe('leaving a reach provokes what the SRD says it provokes', () => {
  it('offers the Opportunity Attack to the creature whose reach was left', () => {
    const out = move(SETUP, away(20));
    const pending = pendingMoveOf(fold('seed', out.log));
    expect(pending).not.toBeNull();
    expect(pending?.provoked.map((p) => p.reactor)).toEqual([OGRE]);
  });

  /** SRD: "leaves your reach" — moving *within* it is not leaving it. */
  it('offers nothing for a move that stays inside the reach', () => {
    const out = move(SETUP, {
      placement: { from: { creature: OGRE }, feet: 5, bearing: 90 },
    });
    expect(pendingMoveOf(fold('seed', out.log))).toBeNull();
  });

  /**
   * SRD: "using its action, its Bonus Action, its Reaction, or one of its
   * speeds." Being shoved by Thunderwave is none of those.
   */
  it('offers nothing for forced movement', () => {
    const out = move(SETUP, away(20, true));
    expect(pendingMoveOf(fold('seed', out.log))).toBeNull();
    // And forced movement is not the creature's own, so it costs no Speed.
    expect(movementLeftFor(fold('seed', out.log), ROGUE)).toBe(30);
  });

  /** An ally watching you leave does not attack you. */
  it('offers nothing to a creature on your own side', () => {
    const out = move(SETUP, away(20));
    const pending = pendingMoveOf(fold('seed', out.log));
    expect(pending?.provoked.map((p) => p.reactor)).not.toContain(ALLY);
  });

  /** SRD: "a creature that you can see". A declared blindness is a refusal. */
  it('offers nothing to a creature that cannot see the mover', () => {
    const blind: readonly GameEvent[] = [
      ...SETUP,
      { type: 'sight-declared', from: OGRE, to: ROGUE, seen: false },
    ];
    expect(pendingMoveOf(fold('seed', move(blind, away(20)).log))).toBeNull();
  });

  /**
   * But an *undeclared* line of sight is not blindness. The opportunity is
   * offered and the fact is reported, so the layer that knows can decline.
   */
  it('offers it anyway when nobody has said whether they can see, and says so', () => {
    const unsaid = SETUP.filter(
      (e) => !(e.type === 'sight-declared' && e.from === OGRE),
    );
    const out = move(unsaid, away(20));
    expect(pendingMoveOf(fold('seed', out.log))?.provoked.map((p) => p.reactor)).toEqual([OGRE]);
    expect(out.unverified.join(' ')).toMatch(/see/i);
  });

  /** A Reach weapon reaches ten feet, so leaving happens later. */
  it('reads the reach of what the reactor is actually holding', () => {
    const polearm: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'item-equipped' && e.id === OGRE)),
      { type: 'items-gained', id: OGRE, items: [{ id: 'glaive', quantity: 1 }], source: 'kit' },
      { type: 'item-equipped', id: OGRE, item: 'glaive' },
    ];
    // Ten feet is still inside a glaive's reach, so nothing is provoked.
    const near = move(polearm, { placement: { from: { creature: OGRE }, feet: 10, bearing: 90 } });
    expect(pendingMoveOf(fold('seed', near.log))).toBeNull();

    const far = move(polearm, away(20));
    expect(pendingMoveOf(fold('seed', far.log))?.provoked).toHaveLength(1);
  });

  /** A creature with no Reaction left is not offered one. */
  it('offers nothing to a creature that has spent its Reaction', () => {
    const spent: readonly GameEvent[] = [...SETUP, { type: 'reaction-spent', id: OGRE }];
    expect(pendingMoveOf(fold('seed', move(spent, away(20)).log))).toBeNull();
  });

  /** SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction." */
  it('offers nothing to an Incapacitated creature', () => {
    const stunned: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: OGRE, condition: 'stunned', source: 'a spell' },
    ];
    expect(pendingMoveOf(fold('seed', move(stunned, away(20)).log))).toBeNull();
  });
});

describe('the move waits until every Reaction is settled', () => {
  const provoking = () => move(SETUP, away(20));

  it('has not moved the creature yet', () => {
    const out = provoking();
    const state = fold('seed', out.log);
    // Still at the ford: SRD says the attack happens *before* they leave.
    expect(positionOf(state.scene!, ROGUE)).toEqual({ x: 100, y: 100, z: 0 });
  });

  it('will not advance the turn while the offer stands', () => {
    const out = provoking();
    const advanced = resolveTurn(fold('seed', out.log), supply());
    expect(isErr(advanced)).toBe(true);
    if (isErr(advanced)) expect(advanced.code).toBe('move_pending');
  });

  it('completes the move when the offer is declined', () => {
    const out = provoking();
    const passed = unwrap(
      declineOpportunity(fold('seed', out.log), OGRE, {}),
      'decline',
    );
    const after = fold('seed', [...out.log, ...passed]);
    expect(pendingMoveOf(after)).toBeNull();
    expect(positionOf(after.scene!, ROGUE)).not.toEqual({ x: 100, y: 100, z: 0 });
    expect(movementLeftFor(after, ROGUE)).toBe(10);
  });

  /**
   * SRD: "take a Reaction to make one melee attack." The attack resolves
   * against the mover where they are still standing, which is why the move is
   * held rather than done and undone.
   */
  it('resolves the attack from where the mover still is, and then moves them', () => {
    const out = provoking();
    const struck = unwrap(
      takeOpportunityAttack(fold('seed', out.log), OGRE, { weapon: 'greatclub' }, supply('swing')),
      'opportunity',
    );
    const after = fold('seed', [...out.log, ...struck.events]);

    expect(struck.attack).not.toBeNull();
    expect(after.combat?.budgets.ogre?.reaction).toBe(false);
    // The move went through once the Reaction was spent.
    expect(pendingMoveOf(after)).toBeNull();
    expect(positionOf(after.scene!, ROGUE)).not.toEqual({ x: 100, y: 100, z: 0 });
  });

  it('refuses an Opportunity Attack from somebody who was not offered one', () => {
    const out = provoking();
    const wrong = takeOpportunityAttack(
      fold('seed', out.log),
      ALLY,
      { weapon: null },
      supply('swing'),
    );
    expect(isErr(wrong)).toBe(true);
    if (isErr(wrong)) expect(wrong.code).toBe('not_provoked');
  });

  it('refuses a second move while one is waiting', () => {
    const out = provoking();
    const again = resolveMove(fold('seed', out.log), ROGUE, away(5), supply());
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('move_pending');
  });
});

describe('it replays and survives a reload', () => {
  it('keeps the offer across a round trip', () => {
    const out = move(SETUP, away(20));
    const state = fold('seed', out.log);
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(pendingMoveOf(round)).toEqual(pendingMoveOf(state));
  });

  it('replays prefix by prefix', () => {
    const out = move(SETUP, away(20));
    const settled = unwrap(declineOpportunity(fold('seed', out.log), OGRE, {}), 'decline');
    const log = [...out.log, ...settled];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('is a no-op on a retried move', () => {
    const first = unwrap(
      resolveMove(fold('seed', SETUP), ROGUE, { ...away(20), commandId: 'm1' }, supply()),
      'first',
    );
    const log = [...SETUP, ...first.events];
    const retry = unwrap(
      resolveMove(fold('seed', log), ROGUE, { ...away(20), commandId: 'm1' }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
  });
});

/**
 * Difficult Terrain, which the mover declares rather than the engine deduces.
 *
 * SRD: "If a space is Difficult Terrain, every foot of movement in that space
 * costs 1 extra foot. For example, moving 5 feet through Difficult Terrain
 * costs 10 feet of movement. **Difficult Terrain isn't cumulative; either a
 * space is Difficult Terrain or it isn't.**"
 *
 * Which spaces those are is fiction in all but one of the SRD's six cases —
 * snow, rubble, furniture, a slope, waist-deep water, a narrow opening — and
 * deducing them would mean modelling the room, which is where a rules engine
 * becomes a VTT. So the same rule cover and line of sight follow applies: the
 * layer that knows says how much of the move was through it, and the engine
 * charges for it exactly.
 *
 * The seventh case, another creature's space, the engine *can* see, and
 * `isDifficultTerrain` has answered it since positioning landed — for a caller
 * working out the number to declare.
 */
describe('difficult terrain costs what the SRD says it costs', () => {
  /** "moving 5 feet through Difficult Terrain costs 10 feet of movement." */
  it('charges a foot extra for every foot of it', () => {
    const out = move(SETUP, { ...away(20), difficultFeet: 5 });
    expect(out.feet).toBe(20);
    expect(out.cost).toBe(25);
    expect(movementLeftFor(fold('seed', out.log), ROGUE)).toBe(5);
  });

  it('charges nothing extra for a move through none of it', () => {
    expect(move(SETUP, away(20)).cost).toBe(20);
  });

  /** A move entirely through it costs double, which is the SRD's example writ large. */
  it('doubles a move made entirely through it', () => {
    const out = move(SETUP, { ...away(15), difficultFeet: 15 });
    expect(out.cost).toBe(30);
    expect(movementLeftFor(fold('seed', out.log), ROGUE)).toBe(0);
  });

  it('refuses a move whose real cost is more than the Speed left', () => {
    // Twenty feet is affordable; twenty feet of bog is not.
    expect(isErr(resolveMove(fold('seed', SETUP), ROGUE, away(20), supply()))).toBe(false);
    const bogged = resolveMove(
      fold('seed', SETUP),
      ROGUE,
      { ...away(20), difficultFeet: 20 },
      supply(),
    );
    expect(isErr(bogged)).toBe(true);
    if (isErr(bogged)) expect(bogged.code).toBe('not_enough_movement');
  });

  /** More difficult feet than feet moved is a caller's mistake, not a rule. */
  it('refuses more difficult feet than the move covers', () => {
    const out = resolveMove(
      fold('seed', SETUP),
      ROGUE,
      { ...away(10), difficultFeet: 15 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_difficult_terrain');
  });

  /**
   * SRD: "Difficult Terrain isn't cumulative; either a space is Difficult
   * Terrain or it isn't." Declaring feet rather than sources is what makes
   * that true here — there is no way to say a space is difficult twice.
   */
  it('cannot be stacked, because feet are what is declared', () => {
    expect(move(SETUP, { ...away(10), difficultFeet: 10 }).cost).toBe(20);
  });

  /** Forced movement spends nothing, so the terrain has nothing to charge. */
  it('charges forced movement nothing, as it charges it nothing at all', () => {
    const out = move(SETUP, { ...away(20, true), difficultFeet: 20 });
    expect(movementLeftFor(fold('seed', out.log), ROGUE)).toBe(30);
  });
});
