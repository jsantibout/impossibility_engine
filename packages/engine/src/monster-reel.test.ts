import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  applyConditionTo,
  beginCombat,
  declareCreatureSide,
  grappleSource,
  placeCreatureInScene,
  setScene,
  takePrintedPull,
} from './commands.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, statedActionOf, statedBonusActionOf } from './monster.js';
import { distanceBetween } from './positioning.js';

/**
 * A line that drags toward itself what it is already holding.
 *
 * SRD Roper, Reel: "The roper pulls each creature Grappled by it up to 30 feet
 * straight toward it." Both halves are rules the engine held before the line
 * could be taken — the grapple `escapeGrapple` answers, and the `pullToward`
 * SRD Merrow's rider already goes through — so what the door adds is the
 * price and the sentence's own "each".
 *
 * The Ettercap prints the same heading over a different hold — "Restrained by
 * its Web Strand", a condition an object the ettercap raised is holding — and
 * since W7-B10 that is a pull of its own kind rather than a grapple; its road
 * is `ettercap-reel.test.ts`, and these tests pin only that the two kinds are
 * told apart.
 */

const id = (s: string) => asCharacterId(s);
const ROPER = id('roper');
const HELD = id('held');
const ALSO = id('also');
const FREE = id('free');

const SEED = 'reel';

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/** The block's own heading, read off the block rather than retyped. */
const REEL = SRD_CONTENT.monsterById('roper')!.actions.find((line) => line.name === 'Reel')!.name;

/**
 * A roper with two commoners on its tendrils and one standing clear, each at a
 * different distance so the "up to" and the cap at the gap can be told apart.
 */
const inTheCavern = (): Table => {
  const table = new Table();
  table.did('the roper arrives', (s) => addCreature(s, SRD_CONTENT, ROPER, 'roper'));
  for (const who of [HELD, ALSO, FREE]) {
    table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'commoner'));
  }
  table.do('the cavern', (s) => setScene(s, { width: 200, depth: 200, height: 60 }));
  table.do('the stalagmite', (s) => addSceneLandmark(s, 'the stalagmite', { x: 20, y: 20, z: 0 }));
  table.do('the roper by it', (s) =>
    placeCreatureInScene(s, ROPER, { from: { landmark: 'the stalagmite' }, feet: 0 }),
  );
  table.do('one forty feet out', (s) =>
    placeCreatureInScene(s, HELD, { from: { creature: ROPER }, feet: 40, bearing: 90 }),
  );
  table.do('one fifteen feet out', (s) =>
    placeCreatureInScene(s, ALSO, { from: { creature: ROPER }, feet: 15, bearing: 270 }),
  );
  table.do('one fifty feet out', (s) =>
    placeCreatureInScene(s, FREE, { from: { creature: ROPER }, feet: 50, bearing: 0 }),
  );
  table.do('the roper’s side', (s) => declareCreatureSide(s, ROPER, 'wild'));
  for (const who of [HELD, ALSO, FREE]) {
    table.do(`${who}’s side`, (s) => declareCreatureSide(s, who, 'party'));
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: ROPER, initiative: 20, speed: 10 },
      { id: HELD, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

/** The roper's tendril on somebody, filed where `grapplesOn` finds it. */
const grappled = (table: Table, who: ReturnType<typeof id>): GameState =>
  table.do(`${who} is grappled`, (s) =>
    applyConditionTo(s, who, 'grappled', grappleSource(ROPER)),
  );

describe('the adapter carries the pull the block prints', () => {
  it('pins the distance and what it pulls onto the Actions line', () => {
    const roper = adaptMonster(SRD_CONTENT.monsterById('roper')!, ROPER);
    expect(statedActionOf(roper.sheet, REEL)).toMatchObject({
      name: REEL,
      pulls: { feet: 30, of: 'grappled' },
    });
  });

  /**
   * And the Ettercap's line under the same heading — a Bonus Action there —
   * carries a pull of the other kind: its hold is a web, and reading the
   * sentence as a grapple would have been a rule nobody printed. (W7-B10)
   */
  it('carries the web-keyed kind for the ettercap, whose hold is a web', () => {
    const ettercap = adaptMonster(SRD_CONTENT.monsterById('ettercap')!, id('ettercap'));
    expect(statedActionOf(ettercap.sheet, 'Reel')).toBeNull();
    expect(statedBonusActionOf(ettercap.sheet, 'Reel')?.pulls).toMatchObject({
      of: 'restrained-by-object',
      heldBy: 'Web Strand',
    });
  });
});

describe('the roper reels', () => {
  it('drags every creature it holds, capped at the gap, and leaves the free one', () => {
    const table = inTheCavern();
    grappled(table, HELD);
    grappled(table, ALSO);

    // Measured before and after rather than against a number typed here: the
    // roper is Large and `distanceBetween` measures volume to volume, so the
    // gap is not the number the placement asked for and the claim is about
    // what the *pull* moved.
    const gap = (state: GameState, who: ReturnType<typeof id>): number =>
      unwrap(distanceBetween(state.scene!, ROPER, who), 'the gap');
    const before = { held: gap(table.state, HELD), also: gap(table.state, ALSO), free: gap(table.state, FREE) };

    const reeled = unwrap(takePrintedPull(table.state, ROPER, { line: REEL }), 'the reel');
    expect([...reeled.pulled].sort()).toEqual([ALSO, HELD].sort());

    const after = table.do('the reel', () => ({ ok: true, value: reeled.events }));
    // Dragged the thirty feet the line prints.
    expect(before.held - gap(after, HELD)).toBe(30);
    // "Up to" thirty, over a gap smaller than that: `pullToward` stops at the
    // roper's face rather than dragging anybody through it.
    expect(before.also).toBeLessThan(30);
    expect(gap(after, ALSO)).toBe(0);
    // And the one it never had hold of has not moved.
    expect(gap(after, FREE)).toBe(before.free);
    expect(after.combat!.budgets[ROPER]!.action).toBe(false);
  });

  it('spends the Action and drags nobody when it holds nobody', () => {
    const table = inTheCavern();
    const reeled = unwrap(takePrintedPull(table.state, ROPER, { line: REEL }), 'the empty reel');
    expect(reeled.pulled).toEqual([]);
    const before = unwrap(distanceBetween(table.state.scene!, ROPER, FREE), 'the gap');
    const after = table.do('the empty reel', () => ({ ok: true, value: reeled.events }));
    expect(after.combat!.budgets[ROPER]!.action).toBe(false);
    expect(unwrap(distanceBetween(after.scene!, ROPER, FREE), 'the gap')).toBe(before);
  });

  /**
   * And a creature somebody *else* has hold of is not the roper's to drag.
   * `grapplesOn` names the grappler, and the filter reads it rather than the
   * condition alone.
   */
  it('leaves a creature another grappler is holding where it is', () => {
    const table = inTheCavern();
    table.do('somebody else has hold of it', (s) =>
      applyConditionTo(s, HELD, 'grappled', grappleSource(FREE)),
    );
    const reeled = unwrap(takePrintedPull(table.state, ROPER, { line: REEL }), 'the reel');
    expect(reeled.pulled).toEqual([]);
  });

  it('refuses a line whose sentence states no pull', () => {
    // The roper's Multiattack was the line this used to try; it is read as a
    // sequence since W7-B10 and is no longer a stated action at all.
    const table = inTheCavern();
    expect(isErr(takePrintedPull(table.state, ROPER, { line: 'Multiattack' }))).toBe(true);

    const ettercap = id('ettercap');
    table.did('an ettercap arrives', (s) => addCreature(s, SRD_CONTENT, ettercap, 'ettercap'));
    table.do('it stands', (s) =>
      placeCreatureInScene(s, ettercap, { from: { creature: ROPER }, feet: 20, bearing: 180 }),
    );
    table.do('its side', (s) => declareCreatureSide(s, ettercap, 'wild'));
    const strand = SRD_CONTENT.monsterById('ettercap')!.actions.find((line) =>
      line.name.startsWith('Web Strand'),
    )!.name;
    const refused = takePrintedPull(table.state, ettercap, { line: strand });
    expect(isErr(refused) && refused.code).toBe('line_pulls_nothing');
  });
});
