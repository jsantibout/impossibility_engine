import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareSightBetween,
  placeCreatureInScene,
  setScene,
  takePrintedMove,
} from './commands.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { positionOf, type Point } from './positioning.js';

/**
 * SRD Centaur Trooper, Trampling Charge (Recharge 5–6): "The centaur moves up
 * to its Speed without provoking Opportunity Attacks and can move through the
 * spaces of Medium or smaller creatures. Each creature whose space the centaur
 * enters is targeted once by the following effect. _Strength Saving Throw:_
 * DC 14. _Failure:_ 7 (1d6 + 4) Bludgeoning damage, and the target has the
 * Prone condition."
 *
 * The other move a line makes — W7-B9: the caller states the route, the
 * engine checks every space entered against the printed size, moves the
 * centaur without offering anybody a swing, and rolls each creature crossed
 * one save, however many of its spaces the route touched.
 */

const id = (s: string) => asCharacterId(s);
const CENTAUR = id('centaur');
const GRIX = id('grix');
const NOB = id('nob');
const WATCH = id('watch');
const OGRE = id('ogre');
const TRAMPLING_CHARGE = 'Trampling Charge (Recharge 5–6)';

const supply = (state: GameState, seed = 'hooves') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('hooves', this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

/**
 * The centaur (Large, 50 ft.) at the gate, its box 50..60 by 50..60. Grix
 * fifteen feet north on the centaur's line, Nob twenty-five; the watchman
 * (Medium, reach 5, hostile, able to see) adjacent to the south, whom a walk
 * north would ordinarily offer an Opportunity Attack; an ogre forty feet
 * north, in the way of a longer route.
 */
const atTheGate = (): Table => {
  const table = new Table();
  table.did('the centaur arrives', (s) => addCreature(s, SRD_CONTENT, CENTAUR, 'centaur-trooper'));
  table.did('Grix arrives', (s) => addCreature(s, SRD_CONTENT, GRIX, 'goblin-warrior'));
  table.did('Nob arrives', (s) => addCreature(s, SRD_CONTENT, NOB, 'goblin-warrior'));
  table.did('the watch arrives', (s) => addCreature(s, SRD_CONTENT, WATCH, 'guard'));
  table.did('the ogre arrives', (s) => addCreature(s, SRD_CONTENT, OGRE, 'ogre'));
  table.do('the road', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the gate', (s) => addSceneLandmark(s, 'the gate', at(50, 50)));
  table.do('the centaur', (s) => placeCreatureInScene(s, CENTAUR, { from: { landmark: 'the gate' }, feet: 0 }));
  table.do('Grix', (s) => placeCreatureInScene(s, GRIX, { from: { point: at(50, 65) }, feet: 0 }));
  table.do('Nob', (s) => placeCreatureInScene(s, NOB, { from: { point: at(50, 75) }, feet: 0 }));
  // Five feet south of the centaur's anchor: an Opportunity Attack is measured
  // from the reactor to the mover's point, and a Large box runs north-east.
  table.do('the watch', (s) => placeCreatureInScene(s, WATCH, { from: { point: at(50, 45) }, feet: 0 }));
  table.do('the ogre', (s) => placeCreatureInScene(s, OGRE, { from: { point: at(50, 90) }, feet: 0 }));
  table.do('the watch sees', (s) => declareSightBetween(s, WATCH, CENTAUR, true));
  table.do('sides', (s) => declareCreatureSide(s, CENTAUR, 'raiders'));
  table.do('sides', (s) => declareCreatureSide(s, GRIX, 'goblins'));
  table.do('sides', (s) => declareCreatureSide(s, NOB, 'goblins'));
  table.do('sides', (s) => declareCreatureSide(s, WATCH, 'town'));
  table.do('sides', (s) => declareCreatureSide(s, OGRE, 'giants'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: CENTAUR, initiative: 20, speed: 50 },
      { id: GRIX, initiative: 10, speed: 30 },
      { id: NOB, initiative: 8, speed: 30 },
      { id: WATCH, initiative: 6, speed: 30 },
      { id: OGRE, initiative: 5, speed: 40 },
    ]),
  );
  return table;
};

/** North along the centaur's own line, thirty feet: through Grix once and Nob twice. */
const THROUGH_BOTH: readonly Point[] = [at(50, 55), at(50, 60), at(50, 65), at(50, 70), at(50, 75), at(50, 80)];

describe('a Centaur Trooper’s Trampling Charge', () => {
  it('asks for the route, and refuses one through a creature bigger than the line allows', () => {
    const table = atTheGate();
    const which = takePrintedMove(table.state, CENTAUR, { line: TRAMPLING_CHARGE }, supply(table.state));
    expect(isNeedsContext(which) && isErr(which) && which.code === 'route_required').toBe(true);

    // The ogre is Large; "Medium or smaller creatures" does not reach it.
    const throughTheOgre = [...THROUGH_BOTH, at(50, 85), at(50, 90), at(50, 95)];
    const blocked = takePrintedMove(table.state, CENTAUR, { line: TRAMPLING_CHARGE, route: throughTheOgre }, supply(table.state));
    expect(isErr(blocked) && blocked.code === 'blocked_by_creature').toBe(true);

    // Nothing spent, nothing expended, by either refusal.
    expect(table.state.combat!.budgets[CENTAUR]!.bonusAction).toBe(true);
    expect(table.state.creatures[CENTAUR]!.expendedLines).toEqual([]);
  });

  it('moves up to its Speed through both goblins, provokes nobody, and rolls each one save', () => {
    const table = atTheGate();
    const out = unwrap(
      takePrintedMove(table.state, CENTAUR, { line: TRAMPLING_CHARGE, route: THROUGH_BOTH }, supply(table.state)),
      'the charge',
    );
    table.log.push(...out.events);
    const state = table.state;

    expect(out.feet).toBe(30);
    expect(positionOf(state.scene!, CENTAUR)).toEqual(at(50, 80));
    // The Bonus Action, the recharge, the line.
    expect(out.events.some((e) => e.type === 'bonus-action-spent')).toBe(true);
    expect(out.events.some((e) => e.type === 'printed-line-expended' && e.line === TRAMPLING_CHARGE)).toBe(true);
    expect(out.events.some((e) => e.type === 'stated-bonus-action-taken' && e.line === TRAMPLING_CHARGE)).toBe(true);
    expect(state.creatures[CENTAUR]!.expendedLines).toContain(TRAMPLING_CHARGE);

    // "without provoking Opportunity Attacks": the watch is in reach at the
    // start and out of it at the end, and is offered nothing.
    expect(out.events.some((e) => e.type === 'movement-declared')).toBe(false);
    expect(out.events.some((e) => e.type === 'creature-moved' && e.id === CENTAUR)).toBe(true);
    expect(state.pendingMove).toBeNull();

    // The move is the line's, not the turn's own thirty feet.
    expect(state.combat!.budgets[CENTAUR]!.movementSpent).toBe(0);

    // "targeted once": Nob's space was entered twice and he saves once.
    expect(out.outcomes.map((o) => o.target)).toEqual([GRIX, NOB]);
    expect(out.events.filter((e) => e.type === 'roll-recorded')).toHaveLength(2);
    for (const outcome of out.outcomes) {
      expect(outcome.save).not.toBeNull();
      if (!outcome.save!.success) {
        expect(outcome.conditions).toContain('prone');
        expect(outcome.damage).toBeGreaterThan(0);
      } else {
        expect(outcome.damage).toBe(0);
      }
    }
  });

  it('refuses a route longer than its Speed, and a second use until the recharge', () => {
    const table = atTheGate();
    const tooFar = Array.from({ length: 11 }, (_, i) => at(50 + 5 * (i + 1), 50));
    const long = takePrintedMove(table.state, CENTAUR, { line: TRAMPLING_CHARGE, route: tooFar }, supply(table.state));
    expect(isErr(long) && long.code === 'not_enough_movement').toBe(true);

    table.did('the charge', (s) => takePrintedMove(s, CENTAUR, { line: TRAMPLING_CHARGE, route: THROUGH_BOTH }, supply(s)));
    const again = takePrintedMove(
      table.state,
      CENTAUR,
      { line: TRAMPLING_CHARGE, route: [at(50, 85)], commandId: 'again' },
      supply(table.state),
    );
    expect(isErr(again) && again.code === 'line_expended').toBe(true);
  });
});
