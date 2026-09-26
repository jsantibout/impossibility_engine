import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  setScene,
  takePrintedMove,
} from './commands.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { distanceBetween, positionOf } from './positioning.js';

/**
 * SRD Bulette, Deadly Leap: "The bulette spends 5 feet of movement to jump to
 * a space within 15 feet that contains one or more Large or smaller creatures.
 * _Dexterity Saving Throw:_ DC 15, each creature in the bulette's destination
 * space. _Failure:_ 19 (3d12) Bludgeoning damage, and the target has the Prone
 * condition. _Success:_ Half damage, and the target is pushed 5 feet straight
 * away from the bulette."
 *
 * A move a line makes, then a save per creature whose space was entered —
 * W7-B9. The caller states the destination; the engine checks it against the
 * printed reach, insists somebody no bigger than the printed size is standing
 * there, spends the printed feet, moves the bulette and rolls one save each.
 */

const id = (s: string) => asCharacterId(s);
const BULETTE = id('bulette');
const GRIX = id('grix');
const NOB = id('nob');
const GIANT = id('giant');
const DEADLY_LEAP = 'Deadly Leap';

const supply = (state: GameState, seed = 'landshark') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  constructor(readonly seed: string) {}
  get state(): GameState {
    return fold(this.seed, this.log);
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

/**
 * The bulette at the pit; two goblins fifteen feet north, one on the point the
 * leap lands on and one inside the Large box it lands as; a Huge giant fifteen
 * feet east. The bulette's turn.
 */
const atThePit = (seed = 'landshark'): Table => {
  const table = new Table(seed);
  table.did('the bulette arrives', (s) => addCreature(s, SRD_CONTENT, BULETTE, 'bulette'));
  table.did('Grix arrives', (s) => addCreature(s, SRD_CONTENT, GRIX, 'goblin-warrior'));
  table.did('Nob arrives', (s) => addCreature(s, SRD_CONTENT, NOB, 'goblin-warrior'));
  table.did('the giant arrives', (s) => addCreature(s, SRD_CONTENT, GIANT, 'hill-giant'));
  table.do('the pit', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the lip', (s) => addSceneLandmark(s, 'the lip', { x: 50, y: 50, z: 0 }));
  table.do('the bulette', (s) => placeCreatureInScene(s, BULETTE, { from: { landmark: 'the lip' }, feet: 0 }));
  table.do('Grix', (s) => placeCreatureInScene(s, GRIX, { from: { point: { x: 50, y: 65, z: 0 } }, feet: 0 }));
  table.do('Nob', (s) => placeCreatureInScene(s, NOB, { from: { point: { x: 55, y: 70, z: 0 } }, feet: 0 }));
  // Fifteen feet east of the bulette's anchor, so a leap onto it is in reach
  // and refused for its size rather than for the distance.
  table.do('the giant', (s) => placeCreatureInScene(s, GIANT, { from: { point: { x: 65, y: 50, z: 0 } }, feet: 0 }));
  table.do('sides', (s) => declareCreatureSide(s, BULETTE, 'wild'));
  table.do('sides', (s) => declareCreatureSide(s, GRIX, 'goblins'));
  table.do('sides', (s) => declareCreatureSide(s, NOB, 'goblins'));
  table.do('sides', (s) => declareCreatureSide(s, GIANT, 'giants'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BULETTE, initiative: 20, speed: 40 },
      { id: GRIX, initiative: 10, speed: 30 },
      { id: NOB, initiative: 8, speed: 30 },
      { id: GIANT, initiative: 5, speed: 40 },
    ]),
  );
  return table;
};

const ONTO_THE_GOBLINS = { from: { landmark: 'the lip' }, feet: 15, bearing: 0 } as const;

describe('a Bulette’s Deadly Leap', () => {
  it('asks where, and refuses an empty space, a space too far, and one holding a Huge creature', () => {
    const table = atThePit();
    const where = takePrintedMove(table.state, BULETTE, { line: DEADLY_LEAP }, supply(table.state));
    expect(isNeedsContext(where) && isErr(where) && where.code === 'undeclared_destination').toBe(true);

    const empty = takePrintedMove(
      table.state,
      BULETTE,
      { line: DEADLY_LEAP, to: { from: { landmark: 'the lip' }, feet: 15, bearing: 180 } },
      supply(table.state),
    );
    expect(isErr(empty) && empty.code === 'nobody_to_land_on').toBe(true);

    const far = takePrintedMove(
      table.state,
      BULETTE,
      { line: DEADLY_LEAP, to: { from: { landmark: 'the lip' }, feet: 20, bearing: 0 } },
      supply(table.state),
    );
    expect(isErr(far) && far.code === 'leap_too_far').toBe(true);

    // SRD: "one or more Large or smaller creatures" — a Huge giant is not one,
    // and the bulette is refused rather than landing inside it. (An Ogre is
    // Large, and the book lets the bulette land on one.)
    const huge = takePrintedMove(
      table.state,
      BULETTE,
      { line: DEADLY_LEAP, to: { from: { landmark: 'the lip' }, feet: 15, bearing: 90 } },
      supply(table.state),
    );
    expect(isErr(huge) && huge.code === 'too_large_to_land_on').toBe(true);

    // Nothing was spent by any refusal.
    expect(table.state.combat!.budgets[BULETTE]!.action).toBe(true);
    expect(table.state.combat!.budgets[BULETTE]!.movementSpent).toBe(0);
  });

  it('spends five feet and the Action, lands among both goblins, and rolls each a Dexterity save', () => {
    const table = atThePit();
    const out = unwrap(
      takePrintedMove(table.state, BULETTE, { line: DEADLY_LEAP, to: ONTO_THE_GOBLINS }, supply(table.state)),
      'the leap',
    );
    table.log.push(...out.events);
    const state = table.state;

    expect(out.feet).toBe(15);
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
    expect(out.events.some((e) => e.type === 'stated-action-taken' && e.line === DEADLY_LEAP)).toBe(true);
    // "spends 5 feet of movement": the printed price, not the fifteen cleared.
    const spent = out.events.find((e) => e.type === 'movement-spent');
    expect(spent).toMatchObject({ type: 'movement-spent', id: BULETTE, feet: 5 });
    expect(state.combat!.budgets[BULETTE]!.movementSpent).toBe(5);

    // Where it landed: on Grix's point, sharing the space with both goblins.
    expect(positionOf(state.scene!, BULETTE)).toEqual({ x: 50, y: 65, z: 0 });

    // One save each, in roster order, and no third.
    expect(out.outcomes.map((o) => o.target)).toEqual([GRIX, NOB]);
    const saves = out.events.filter((e) => e.type === 'roll-recorded');
    expect(saves).toHaveLength(2);
    for (const outcome of out.outcomes) {
      expect(outcome.save).not.toBeNull();
      if (outcome.save!.success) {
        // "_Success:_ Half damage, and the target is pushed 5 feet straight away"
        expect(outcome.pushedFeet).toBe(5);
        expect(outcome.conditions ?? []).not.toContain('prone');
      } else {
        // "_Failure:_ 19 (3d12) Bludgeoning damage, and the target has the Prone condition"
        expect(outcome.conditions).toContain('prone');
        expect(outcome.pushedFeet).toBeUndefined();
        expect(state.creatures[outcome.target]!.conditions.conditions).toContain('prone');
      }
    }
    // A goblin the bulette did not land on is untouched.
    expect(state.creatures[GIANT]!.vitals.hp).toBe(table.state.creatures[GIANT]!.vitals.hp);
  });

  it('lands both branches across seeds: the failure Prone, the success shoved five feet clear', () => {
    let sawFailure = false;
    let sawSuccess = false;
    for (let n = 0; n < 24 && !(sawFailure && sawSuccess); n += 1) {
      const table = atThePit(`leap-${n}`);
      const out = unwrap(
        takePrintedMove(table.state, BULETTE, { line: DEADLY_LEAP, to: ONTO_THE_GOBLINS }, supply(table.state, `leap-${n}`)),
        'the leap',
      );
      table.log.push(...out.events);
      const state = table.state;
      for (const outcome of out.outcomes) {
        if (outcome.save!.success) {
          sawSuccess = true;
          // Shoved clear of the bulette: no longer inside its box.
          expect(unwrap(distanceBetween(state.scene!, BULETTE, outcome.target), 'the gap')).toBeGreaterThan(0);
        } else {
          sawFailure = true;
          expect(unwrap(distanceBetween(state.scene!, BULETTE, outcome.target), 'the gap')).toBe(0);
        }
      }
    }
    expect(sawFailure).toBe(true);
    expect(sawSuccess).toBe(true);
  });

  it('is idempotent under its command id, and the head-count door refuses a line that moves first', () => {
    const table = atThePit();
    const once = unwrap(
      takePrintedMove(table.state, BULETTE, { line: DEADLY_LEAP, to: ONTO_THE_GOBLINS, commandId: 'leap-1' }, supply(table.state)),
      'the leap',
    );
    table.log.push(...once.events);
    const again = unwrap(
      takePrintedMove(table.state, BULETTE, { line: DEADLY_LEAP, to: ONTO_THE_GOBLINS, commandId: 'leap-1' }, supply(table.state)),
      'the retry',
    );
    expect(again.duplicate).toBe(true);
    expect(again.events).toEqual([]);

    // `forcePrintedSave` rolls a save over a caller's head count; this line
    // moves the creature first, and a Trample nobody moved for is refused.
    const fresh = atThePit();
    const still = forcePrintedSave(fresh.state, BULETTE, { line: DEADLY_LEAP, targets: [GRIX] }, supply(fresh.state));
    expect(isErr(still) && still.code === 'line_moves_first').toBe(true);
  });

  it('refuses a line that states no move', () => {
    const table = atThePit();
    const bite = takePrintedMove(table.state, BULETTE, { line: 'Bite', to: ONTO_THE_GOBLINS }, supply(table.state));
    expect(isErr(bite) && bite.code === 'no_such_line').toBe(true);
    // The bulette's Leap buys a jump and forces no save; it is the other door's.
    const leap = takePrintedMove(table.state, BULETTE, { line: 'Leap', to: ONTO_THE_GOBLINS }, supply(table.state));
    expect(isErr(leap) && leap.code === 'line_moves_nobody').toBe(true);
  });
});
