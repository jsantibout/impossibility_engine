import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  placeCreatureInScene,
  resolveMove,
  setScene,
} from './commands.js';
import { grappleSource } from './commands/unarmed.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

/**
 * SRD Grappled, "Movable": "The grappler can drag or carry you when it moves,
 * but every foot of movement costs it 1 extra foot unless you are Tiny or two
 * or more sizes smaller than it." SRD Abduct, on both bugbears: "The bugbear
 * needn't spend extra movement to move a creature it is grappling."
 *
 * The drag surcharge, and the trait that waives it — W7-B9. The engine had
 * charged nothing to drag a grappled creature, so the trait was true for
 * free; now a goblin dragging a guard pays two feet per foot, a bugbear pays
 * one, and a Tiny prisoner or one two sizes smaller costs nobody extra.
 */

const id = (s: string) => asCharacterId(s);
const GOBLIN = id('goblin');
const BUGBEAR = id('bugbear');
const OGRE = id('ogre');
const GUARD = id('guard');
const RAT = id('rat');
const SNAG = id('snag');

const supply = (state: GameState, seed = 'rope') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('rope', this.log);
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

/** A mover at the post, holding a prisoner beside it, on its own turn. */
const holding = (mover: { id: ReturnType<typeof id>; monster: string }, prisoner: { id: ReturnType<typeof id>; monster: string }): Table => {
  const table = new Table();
  table.did('the mover arrives', (s) => addCreature(s, SRD_CONTENT, mover.id, mover.monster));
  table.did('the prisoner arrives', (s) => addCreature(s, SRD_CONTENT, prisoner.id, prisoner.monster));
  table.do('the yard', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the post', (s) => addSceneLandmark(s, 'the post', { x: 50, y: 50, z: 0 }));
  table.do('the mover', (s) => placeCreatureInScene(s, mover.id, { from: { landmark: 'the post' }, feet: 0 }));
  // Ten feet east: clear of a Large mover's own box, and the hold is written
  // by hand below rather than measured.
  table.do('the prisoner', (s) => placeCreatureInScene(s, prisoner.id, { from: { landmark: 'the post' }, feet: 10, bearing: 90 }));
  table.log.push({ type: 'condition-applied', id: prisoner.id, condition: 'grappled', source: grappleSource(mover.id) });
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: mover.id, initiative: 20, speed: 30 },
      { id: prisoner.id, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

const north = (feet: number) => ({ placement: { from: { landmark: 'the post' }, feet, bearing: 0 } });

describe('dragging a grappled creature', () => {
  it('costs a goblin two feet per foot to drag a guard', () => {
    const table = holding({ id: GOBLIN, monster: 'goblin-warrior' }, { id: GUARD, monster: 'guard' });
    const dragged = unwrap(resolveMove(table.state, GOBLIN, north(15), supply(table.state)), 'the drag');
    expect(dragged.feet).toBe(15);
    expect(dragged.cost).toBe(30);
    expect(dragged.events.find((e) => e.type === 'movement-spent')).toMatchObject({ feet: 30 });
    // And twenty feet is more than a Speed of 30 buys at that rate.
    const far = resolveMove(table.state, GOBLIN, north(20), supply(table.state));
    expect(isErr(far) && far.code === 'not_enough_movement').toBe(true);
  });

  it('costs a bugbear one: SRD Abduct waives the surcharge', () => {
    const table = holding({ id: BUGBEAR, monster: 'bugbear-warrior' }, { id: GUARD, monster: 'guard' });
    const dragged = unwrap(resolveMove(table.state, BUGBEAR, north(15), supply(table.state)), 'the drag');
    expect(dragged.cost).toBe(15);
  });

  it('costs nobody extra for a Tiny prisoner, or one two sizes smaller', () => {
    const tiny = holding({ id: GOBLIN, monster: 'goblin-warrior' }, { id: RAT, monster: 'rat' });
    expect(unwrap(resolveMove(tiny.state, GOBLIN, north(15), supply(tiny.state)), 'the drag').cost).toBe(15);

    // A Large ogre dragging a Small goblin: two sizes, and no extra foot.
    const small = holding({ id: OGRE, monster: 'ogre' }, { id: SNAG, monster: 'goblin-warrior' });
    expect(unwrap(resolveMove(small.state, OGRE, north(15), supply(small.state)), 'the drag').cost).toBe(15);
  });

  it('charges nothing to a mover holding nobody', () => {
    const table = holding({ id: GOBLIN, monster: 'goblin-warrior' }, { id: GUARD, monster: 'guard' });
    table.log.push({ type: 'condition-removed', id: GUARD, condition: 'grappled', source: grappleSource(GOBLIN) });
    expect(unwrap(resolveMove(table.state, GOBLIN, north(15), supply(table.state)), 'the walk').cost).toBe(15);
  });
});
