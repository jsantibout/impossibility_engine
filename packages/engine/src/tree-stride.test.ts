import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareObject,
  placeCreatureInScene,
  setScene,
  takePrintedTeleport,
} from './commands.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { distanceBetween, positionOf } from './positioning.js';

/**
 * SRD Dryad, Tree Stride: "If within 5 feet of a Large or bigger tree, the
 * dryad teleports to an unoccupied space within 5 feet of a second Large or
 * bigger tree that is within 60 feet of the previous tree."
 *
 * A teleport whose two ends are trees — W7-B9. A tree is a declared object,
 * Large or bigger and placed, because a tree can be burnt; the DM names the
 * two (`via`), and the engine checks both sizes, the three distances and the
 * landing before `teleportTo` moves her.
 */

const id = (s: string) => asCharacterId(s);
const DRYAD = id('dryad');
const WATCH = id('watch');
const OAK_A = id('the old oak');
const OAK_B = id('the far oak');
const OAK_C = id('the oak beyond');
const SAPLING = id('the sapling');
const TREE_STRIDE = 'Tree Stride';

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('grove', this.log);
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

const tree = (name: string, size: 'large' | 'medium') => ({ name, material: 'wood', size, build: 'resilient' as const });

/**
 * The dryad at the stone; the old oak (Large) five feet east of her; the far
 * oak fifty feet north of the old one; the oak beyond seventy feet north of
 * the far one; a Medium sapling beside her; a watchman to the west.
 */
const inTheGrove = (): Table => {
  const table = new Table();
  table.did('the dryad arrives', (s) => addCreature(s, SRD_CONTENT, DRYAD, 'dryad'));
  table.did('the watch arrives', (s) => addCreature(s, SRD_CONTENT, WATCH, 'guard'));
  table.do('the old oak', (s) => declareObject(s, SRD_CONTENT, OAK_A, tree('the old oak', 'large')));
  table.do('the far oak', (s) => declareObject(s, SRD_CONTENT, OAK_B, tree('the far oak', 'large')));
  table.do('the oak beyond', (s) => declareObject(s, SRD_CONTENT, OAK_C, tree('the oak beyond', 'large')));
  table.do('the sapling', (s) => declareObject(s, SRD_CONTENT, SAPLING, tree('the sapling', 'medium')));
  table.do('the grove', (s) => setScene(s, { width: 300, depth: 300, height: 60 }));
  table.do('the stone', (s) => addSceneLandmark(s, 'the stone', { x: 50, y: 50, z: 0 }));
  table.do('the dryad', (s) => placeCreatureInScene(s, DRYAD, { from: { landmark: 'the stone' }, feet: 0 }));
  table.do('the old oak', (s) => placeCreatureInScene(s, OAK_A, { from: { point: { x: 55, y: 50, z: 0 } }, feet: 0 }));
  // Distances run between cube centres: the old oak's cubes reach y = 55, the
  // far oak's begin at y = 105 — fifty feet on — and the oak beyond's at
  // y = 180, seventy past the far oak's last cube at 110.
  table.do('the far oak', (s) => placeCreatureInScene(s, OAK_B, { from: { point: { x: 55, y: 105, z: 0 } }, feet: 0 }));
  table.do('the oak beyond', (s) => placeCreatureInScene(s, OAK_C, { from: { point: { x: 55, y: 180, z: 0 } }, feet: 0 }));
  table.do('the sapling', (s) => placeCreatureInScene(s, SAPLING, { from: { point: { x: 50, y: 55, z: 0 } }, feet: 0 }));
  table.do('the watch', (s) => placeCreatureInScene(s, WATCH, { from: { point: { x: 45, y: 50, z: 0 } }, feet: 0 }));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: DRYAD, initiative: 20, speed: 30 },
      { id: WATCH, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

describe('a Dryad’s Tree Stride', () => {
  it('asks for the two trees and a landing, then steps from beside one oak to beside the next', () => {
    const table = inTheGrove();
    expect(unwrap(distanceBetween(table.state.scene!, DRYAD, OAK_A), 'the gap')).toBe(5);
    expect(unwrap(distanceBetween(table.state.scene!, OAK_A, OAK_B), 'the trees')).toBe(50);

    const which = takePrintedTeleport(table.state, DRYAD, { line: TREE_STRIDE });
    expect(isNeedsContext(which) && isErr(which) && which.code === 'undeclared_trees').toBe(true);
    const where = takePrintedTeleport(table.state, DRYAD, { line: TREE_STRIDE, via: { from: OAK_A, to: OAK_B } });
    expect(isNeedsContext(where) && isErr(where) && where.code === 'undeclared_destination').toBe(true);

    const out = unwrap(
      takePrintedTeleport(table.state, DRYAD, {
        line: TREE_STRIDE,
        via: { from: OAK_A, to: OAK_B },
        to: { from: { creature: OAK_B }, feet: 5, bearing: 180 },
      }),
      'the stride',
    );
    table.log.push(...out.events);
    const state = table.state;
    expect(out.events.some((e) => e.type === 'bonus-action-spent')).toBe(true);
    expect(out.events.some((e) => e.type === 'stated-bonus-action-taken' && e.line === TREE_STRIDE)).toBe(true);
    expect(out.events.some((e) => e.type === 'creature-moved' && e.id === DRYAD)).toBe(true);
    expect(positionOf(state.scene!, DRYAD)).toEqual({ x: 55, y: 100, z: 0 });
    expect(unwrap(distanceBetween(state.scene!, DRYAD, OAK_B), 'beside it')).toBe(5);
    // A teleport spends no Speed and provokes nobody.
    expect(state.combat!.budgets[DRYAD]!.movementSpent).toBe(0);
    expect(out.events.some((e) => e.type === 'movement-declared')).toBe(false);
  });

  it('refuses a third oak seventy feet on, a Medium sapling, a first tree out of reach, a far landing, and a watchman', () => {
    const table = inTheGrove();
    const s = table.state;
    const beyond = takePrintedTeleport(s, DRYAD, {
      line: TREE_STRIDE,
      via: { from: OAK_A, to: OAK_C },
      to: { from: { creature: OAK_C }, feet: 5, bearing: 180 },
    });
    expect(isErr(beyond) && beyond.code === 'trees_too_far_apart').toBe(true);

    const small = takePrintedTeleport(s, DRYAD, {
      line: TREE_STRIDE,
      via: { from: SAPLING, to: OAK_B },
      to: { from: { creature: OAK_B }, feet: 5, bearing: 180 },
    });
    expect(isErr(small) && small.code === 'tree_too_small').toBe(true);

    const unreached = takePrintedTeleport(s, DRYAD, {
      line: TREE_STRIDE,
      via: { from: OAK_B, to: OAK_A },
      to: { from: { creature: OAK_A }, feet: 5, bearing: 0 },
    });
    expect(isErr(unreached) && unreached.code === 'tree_out_of_reach').toBe(true);

    const farLanding = takePrintedTeleport(s, DRYAD, {
      line: TREE_STRIDE,
      via: { from: OAK_A, to: OAK_B },
      to: { from: { creature: OAK_B }, feet: 15, bearing: 180 },
    });
    expect(isErr(farLanding) && farLanding.code === 'landing_too_far_from_tree').toBe(true);

    const notATree = takePrintedTeleport(s, DRYAD, {
      line: TREE_STRIDE,
      via: { from: WATCH, to: OAK_B },
      to: { from: { creature: OAK_B }, feet: 5, bearing: 180 },
    });
    expect(isErr(notATree) && notATree.code === 'not_a_tree').toBe(true);

    // And none of it spent anything.
    expect(table.state.combat!.budgets[DRYAD]!.bonusAction).toBe(true);
  });
});
