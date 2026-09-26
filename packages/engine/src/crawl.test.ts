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
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

/**
 * SRD Crawling: "While crawling, each foot of movement costs 1 extra foot
 * (2 extra feet in Difficult Terrain)." SRD Prone: "your only movement option
 * is to crawl."
 *
 * The sentence `wayOf` already implements for an unaided climb, asked of a
 * Prone creature at last: a guard with 30 feet of Speed crawls 15 and no
 * further, and a foot of Difficult Terrain crawled over costs four — the
 * ground's two, doubled — which is the book's parenthesis made arithmetic.
 */

const id = (s: string) => asCharacterId(s);
const GUARD = id('guard');

const supply = (state: GameState, seed = 'mud') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('mud', this.log);
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

const inTheMud = (prone: boolean): Table => {
  const table = new Table();
  table.did('the guard arrives', (s) => addCreature(s, SRD_CONTENT, GUARD, 'guard'));
  table.do('the yard', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the post', (s) => addSceneLandmark(s, 'the post', { x: 50, y: 50, z: 0 }));
  table.do('the guard', (s) => placeCreatureInScene(s, GUARD, { from: { landmark: 'the post' }, feet: 0 }));
  if (prone) table.log.push({ type: 'condition-applied', id: GUARD, condition: 'prone', source: 'a trip' });
  table.do('the order', (s) => beginCombat(s, [{ id: GUARD, initiative: 10, speed: 30 }]));
  return table;
};

const north = (feet: number, difficultFeet = 0) => ({
  placement: { from: { landmark: 'the post' }, feet, bearing: 0 },
  ...(difficultFeet === 0 ? {} : { difficultFeet }),
});

describe('crawling', () => {
  it('costs a Prone guard two feet per foot, so 30 feet of Speed crawls 15', () => {
    const table = inTheMud(true);
    const crawled = unwrap(resolveMove(table.state, GUARD, north(15), supply(table.state)), 'the crawl');
    expect(crawled.feet).toBe(15);
    expect(crawled.cost).toBe(30);
    const far = resolveMove(table.state, GUARD, north(20), supply(table.state));
    expect(isErr(far) && far.code === 'not_enough_movement').toBe(true);
  });

  it('costs four per foot through Difficult Terrain — "2 extra feet" on top of the ground’s own', () => {
    const table = inTheMud(true);
    // Five feet of mud: 5 × 2 for the ground, doubled again for the crawl.
    const mud = unwrap(resolveMove(table.state, GUARD, north(5, 5), supply(table.state)), 'the crawl');
    expect(mud.cost).toBe(20);
    // Ten feet of mud would be forty, and the guard has thirty.
    const deep = resolveMove(table.state, GUARD, north(10, 10), supply(table.state));
    expect(isErr(deep) && deep.code === 'not_enough_movement').toBe(true);
  });

  it('charges a standing guard nothing extra for the same ground', () => {
    const table = inTheMud(false);
    expect(unwrap(resolveMove(table.state, GUARD, north(15), supply(table.state)), 'the walk').cost).toBe(15);
    expect(unwrap(resolveMove(table.state, GUARD, north(5, 5), supply(table.state)), 'the wade').cost).toBe(10);
  });
});
