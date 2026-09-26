/**
 * A tentacle that is a thing, and a Multiattack with a use in it — W7-B10.
 *
 * SRD Roper, Tentacle: "_Melee Attack Roll:_ +7, reach 60 ft. _Hit:_ The target
 * has the Grappled condition (escape DC 14) from one of six tentacles, and the
 * target has the Poisoned condition until the grapple ends. The tentacle can be
 * damaged, freeing a creature it has Grappled when destroyed (AC 20, HP 10,
 * Immunity to Poison and Psychic damage). Damaging the tentacle deals no damage
 * to the roper, and a destroyed tentacle regrows at the start of the roper's
 * next turn." SRD Roper, Multiattack: "The roper makes two Tentacle attacks,
 * uses Reel, and makes two Bite attacks."
 *
 * The one hit in the book that deals no damage, read now; the hold it makes
 * is made with an object the hit raises, and the Reel is a slot the Attack
 * action holds.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  damageCreature,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  setScene,
  takePrintedPull,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRiders } from './monster.js';
import { conditionInstanceId } from './conditions.js';
import { schedule } from './commands/conditions.js';
import { distanceBetween } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { grappleSource, grapplerOf, grapplesOn } from './commands/unarmed.js';

const id = (s: string) => asCharacterId(s);
const ROPER = id('roper');
const BREN = id('bren');
const SABLE = id('sable');
const SEED = 'stalactite';

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(SEED, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
  private draws = 0;
  supply() {
    this.draws += 1;
    return {
      issuer: createRollIssuer(`r${this.draws}`),
      rng: createRng(`${SEED}:${this.draws}`) as Rng,
      content: SRD_CONTENT,
    };
  }
}

/** The roper on the cave floor with two knights thirty feet off, the roper's turn first. */
function cavern(): Table {
  const table = new Table();
  table.did('the roper arrives', (s) => addCreature(s, SRD_CONTENT, ROPER, 'roper'));
  for (const who of [BREN, SABLE]) table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'knight'));
  table.do('the cavern', (s) => setScene(s, { width: 300, depth: 300, height: 60 }));
  table.do('the floor', (s) => addSceneLandmark(s, 'the floor', { x: 100, y: 100, z: 0 }));
  table.do('the roper stands', (s) => placeCreatureInScene(s, ROPER, { from: { landmark: 'the floor' }, feet: 0 }));
  // North of the roper's Large box (100..110): thirty feet off its far edge.
  table.do('Bren far off', (s) => placeCreatureInScene(s, BREN, { from: { point: { x: 100, y: 140, z: 0 } }, feet: 0, bearing: 0 }));
  table.do('Sable beside him', (s) => placeCreatureInScene(s, SABLE, { from: { point: { x: 105, y: 140, z: 0 } }, feet: 0, bearing: 0 }));
  table.do("the roper's side", (s) => declareCreatureSide(s, ROPER, 'wild'));
  for (const who of [BREN, SABLE]) table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: ROPER, initiative: 20, speed: 10 },
      { id: BREN, initiative: 10, speed: 30 },
      { id: SABLE, initiative: 5, speed: 30 },
    ]),
  );
  return table;
}

const swing = (table: Table, action: string, target: CharacterId, commandId?: string) =>
  resolveAttack(
    table.state,
    ROPER,
    {
      target,
      weapon: null,
      action,
      attackBonuses: [{ source: 'forced', flat: 40 }],
      ...(commandId === undefined ? {} : { commandId }),
    },
    table.supply(),
  );

/** The tentacle objects the roper has raised, live or dead, in id order. */
const tentaclesOf = (state: GameState): readonly CharacterId[] =>
  (Object.keys(state.creatures) as CharacterId[]).filter((who) => who.startsWith(`tentacle:${ROPER}:`)).sort();

describe("the Roper's Tentacle, read", () => {
  it('reads the hold, the Poisoned it carries, the thing it is made with, the cap, and hands the regrowth over', () => {
    const read = readPrintedRiders(
      "The target has the Grappled condition (escape DC 14) from one of six tentacles, and the target has the Poisoned condition until the grapple ends. The tentacle can be damaged, freeing a creature it has Grappled when destroyed (AC 20, HP 10, Immunity to Poison and Psychic damage). Damaging the tentacle deals no damage to the roper, and a destroyed tentacle regrows at the start of the roper's next turn.",
    );
    expect(read.riders).toEqual([
      {
        kind: 'grapple',
        escapeDc: 14,
        withLimbs: 'one of six tentacles',
        whileHeld: ['poisoned'],
        heldByObject: { noun: 'tentacle', armorClass: 20, hitPoints: 10, immunities: ['poison', 'psychic'] },
        capacity: { creatures: 6 },
      },
    ]);
    expect(read.handedOver).toEqual(["a destroyed tentacle regrows at the start of the roper's next turn."]);
  });
});

describe('a hold filed with the limb it was made with', () => {
  /**
   * `grapple:<who>/held-by:<limb>` names both, and the grappler is read up to
   * the limb — not up to the first slash, because a creature id is free text.
   */
  it('reads the grappler whole, slash and all, and the limb apart', () => {
    const orc = id('orc/1');
    expect(grapplerOf(grappleSource(orc))).toBe(orc);
    expect(grapplerOf(`${grappleSource(ROPER)}/held-by:tentacle:${ROPER}:${BREN}:1`)).toBe(ROPER);
    expect(grapplerOf(`${grappleSource(orc)}/held-by:tentacle:${orc}:${BREN}:1`)).toBe(orc);
  });
});

describe("the Roper's Tentacle, swung", () => {
  it('grapples the knight with Poisoned, raises a tentacle with the printed numbers, and deals the knight no damage', () => {
    const table = cavern();
    const before = table.state.creatures[BREN]!.vitals.hp;
    const out = unwrap(swing(table, 'Tentacle', BREN), 'the tentacle');
    table.log.push(...out.events);
    const state = table.state;
    expect(out.attack?.hit).toBe(true);
    expect(state.creatures[BREN]!.vitals.hp).toBe(before);
    expect(grapplesOn(state, BREN).map((one) => one.grappler)).toEqual([ROPER]);
    for (const condition of ['grappled', 'poisoned'] as const) {
      expect(hasCondition(state.creatures[BREN]!.conditions, condition)).toBe(true);
    }
    const [tentacle] = tentaclesOf(state);
    expect(tentacle).toBeDefined();
    const limb = state.creatures[tentacle!]!;
    expect(limb.sheet.armor).toBeNull();
    expect(limb.vitals.hpMax).toBe(10);
    expect(limb.defenses['poison']).toEqual({ immune: true });
    expect(limb.defenses['psychic']).toEqual({ immune: true });
    // The regrowth is the one clause handed to the table.
    expect(out.unverified.join(' ')).toContain('regrows at the start of the roper');
  });

  it('frees the knight when the tentacle is destroyed, and none of it reaches the roper', () => {
    const table = cavern();
    table.log.push(...unwrap(swing(table, 'Tentacle', BREN), 'the tentacle').events);
    const [tentacle] = tentaclesOf(table.state);
    const roperHp = table.state.creatures[ROPER]!.vitals.hp;
    table.do('the tentacle is hacked', (s) => damageCreature(s, tentacle!, { amount: 10, source: 'a sword' }));
    const state = table.state;
    expect(state.creatures[tentacle!]!.vitals.dead).toBe(true);
    expect(state.creatures[ROPER]!.vitals.hp).toBe(roperHp);
    expect(grapplesOn(state, BREN)).toEqual([]);
    expect(hasCondition(state.creatures[BREN]!.conditions, 'grappled')).toBe(false);
    expect(hasCondition(state.creatures[BREN]!.conditions, 'poisoned')).toBe(false);
  });
});

describe("the Roper's Multiattack", () => {
  it('spends two Tentacles, a Reel and two Bites inside one Attack action, and no more', () => {
    const table = cavern();
    table.log.push(...unwrap(swing(table, 'Tentacle', BREN, 't1'), 'the first tentacle').events);
    table.log.push(...unwrap(swing(table, 'Tentacle', SABLE, 't2'), 'the second tentacle').events);
    // A third Tentacle is not what is left of the sequence.
    const third = swing(table, 'Tentacle', BREN, 't3');
    expect(isErr(third) && third.code === 'not_in_multiattack').toBe(true);
    // The Reel, spent out of the Attack action rather than as an Action of its
    // own: the action is already taken, and a slot of it goes.
    const reeled = unwrap(takePrintedPull(table.state, ROPER, { line: 'Reel' }), 'the reel');
    table.log.push(...reeled.events);
    expect([...reeled.pulled].sort()).toEqual([BREN, SABLE]);
    expect(reeled.events.some((e) => e.type === 'attack-made')).toBe(true);
    expect(reeled.events.some((e) => e.type === 'action-spent')).toBe(false);
    for (const who of [BREN, SABLE]) {
      expect(distanceBetween(table.state.scene!, who, ROPER)).toEqual({ ok: true, value: 5 });
    }
    expect(reeled.events.find((e) => e.type === 'attack-made')).toMatchObject({ use: 'Reel' });
    // A second Reel is not what is left either.
    const again = takePrintedPull(table.state, ROPER, { line: 'Reel', commandId: 'reel again' });
    expect(isErr(again) && again.code === 'not_in_multiattack').toBe(true);
    // Then the two Bites, at the creatures reeled in.
    table.log.push(...unwrap(swing(table, 'Bite', BREN, 'b1'), 'the first bite').events);
    table.log.push(...unwrap(swing(table, 'Bite', SABLE, 'b2'), 'the second bite').events);
    expect(table.state.combat!.budgets[ROPER]!.attacksRemaining).toBe(0);
    expect(swing(table, 'Bite', BREN, 'b3').ok).toBe(false);
  });
});

/**
 * The same `uses` entry, reached by the book's other wording — SRD Wight: "The
 * wight makes two attacks, using Necrotic Sword or Necrotic Bow in any
 * combination. It can replace one attack with a use of Life Drain." Life
 * Drain is a save line, and the door that forces it spends a slot of the
 * Attack action where the sequence names it, exactly as the Reel's does.
 */
describe("the Wight's Multiattack", () => {
  const WIGHT = id('wight');
  const barrow = (): Table => {
    const table = new Table();
    table.did('the wight arrives', (s) => addCreature(s, SRD_CONTENT, WIGHT, 'wight'));
    table.did('bren arrives', (s) => addCreature(s, SRD_CONTENT, BREN, 'knight'));
    table.do('the barrow', (s) => setScene(s, { width: 100, depth: 100, height: 20 }));
    table.do('the bier', (s) => addSceneLandmark(s, 'the bier', { x: 50, y: 50, z: 0 }));
    table.do('the wight stands', (s) => placeCreatureInScene(s, WIGHT, { from: { landmark: 'the bier' }, feet: 0 }));
    table.do('bren beside it', (s) => placeCreatureInScene(s, BREN, { from: { creature: WIGHT }, feet: 5, bearing: 90 }));
    table.do("the wight's side", (s) => declareCreatureSide(s, WIGHT, 'wild'));
    table.do("bren's side", (s) => declareCreatureSide(s, BREN, 'party'));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: WIGHT, initiative: 20, speed: 30 },
        { id: BREN, initiative: 10, speed: 30 },
      ]),
    );
    return table;
  };
  const sword = (table: Table, commandId: string) =>
    resolveAttack(
      table.state,
      WIGHT,
      { target: BREN, weapon: null, action: 'Necrotic Sword', attackBonuses: [{ source: 'forced', flat: 40 }], commandId },
      table.supply(),
    );
  const drain = (table: Table, commandId: string) =>
    forcePrintedSave(table.state, WIGHT, { line: 'Life Drain', targets: [BREN], commandId }, table.supply());

  it('spends Life Drain as one of the two, and leaves one swing beside it', () => {
    const table = barrow();
    const drained = unwrap(drain(table, 'drain'), 'the drain');
    table.log.push(...drained.events);
    expect(drained.events.some((e) => e.type === 'attack-made')).toBe(true);
    expect(drained.events.some((e) => e.type === 'action-spent')).toBe(false);
    expect(table.state.combat!.budgets[WIGHT]!.attacksRemaining).toBe(1);
    table.log.push(...unwrap(sword(table, 's1'), 'the one swing left').events);
    expect(table.state.combat!.budgets[WIGHT]!.attacksRemaining).toBe(0);
    expect(sword(table, 's2').ok).toBe(false);
  });

  it('refuses Life Drain once both swings are made, since there is no attack left to replace', () => {
    const table = barrow();
    table.log.push(...unwrap(sword(table, 's1'), 'the first swing').events);
    table.log.push(...unwrap(sword(table, 's2'), 'the second swing').events);
    const late = drain(table, 'late');
    expect(isErr(late) && late.code).toBe('not_in_multiattack');
  });
});

/**
 * A use spent out of the Attack action makes no attack roll, so nothing that
 * ends "immediately after the target makes an attack roll" ends on it — SRD
 * Invisibility's sentence, hung here on the roper by hand.
 */
describe('a use inside the Attack action is not an attack', () => {
  it("leaves the roper's Invisibility standing through a Reel, and a Tentacle ends it", () => {
    const table = cavern();
    const source = 'a borrowed Invisibility';
    const invisible = (): boolean => hasCondition(table.state.creatures[ROPER]!.conditions, 'invisible');
    const hang = (): void => {
      table.log.push({ type: 'condition-applied', id: ROPER, condition: 'invisible', source });
      table.log.push(unwrapSchedule(table.state, source));
    };
    hang();
    expect(invisible()).toBe(true);
    // A Tentacle is an attack roll, and ends it.
    table.log.push(...unwrap(swing(table, 'Tentacle', BREN, 't1'), 'the tentacle').events);
    expect(invisible()).toBe(false);
    // Hung again by hand, the Reel after it leaves it standing.
    hang();
    table.log.push(...unwrap(takePrintedPull(table.state, ROPER, { line: 'Reel' }), 'the reel').events);
    expect(invisible()).toBe(true);
  });
});

function unwrapSchedule(state: GameState, source: string): GameEvent {
  return unwrap(
    schedule(
      state,
      { kind: 'condition', on: ROPER, instance: conditionInstanceId('invisible', source) },
      { kind: 'seconds', seconds: 60 },
      undefined,
      undefined,
      ['target-attacks'],
    ),
    'the span',
  );
}
