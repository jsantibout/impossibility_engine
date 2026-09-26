import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  placeCreatureInScene,
  resolveMove,
  resolveTurn,
  setScene,
  takeStatedBonusAction,
} from './commands.js';
import { highJumpHeight, longJumpDistance } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

/**
 * SRD Lamia, Leap: "The lamia jumps up to 30 feet by spending 10 feet of
 * movement." SRD Cat, Jumper: "The cat's jump distance is determined using
 * its Dexterity rather than its Strength."
 *
 * A jump a Bonus Action buys, for the turn it was bought on — W7-B9. SRD
 * *Jump*'s allowance at a heading's price, with the lifetime the heading
 * implies: the grant hangs on a deadline at the end of the current turn, so a
 * lamia leaps thirty feet this turn and not next turn without another.
 */

const id = (s: string) => asCharacterId(s);
const LAMIA = id('lamia');
const CAT = id('cat');
const LEAP = 'Leap';

const supply = (state: GameState, seed = 'sands') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('sands', this.log);
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

const inTheSands = (): Table => {
  const table = new Table();
  table.did('the lamia arrives', (s) => addCreature(s, SRD_CONTENT, LAMIA, 'lamia'));
  table.did('the cat arrives', (s) => addCreature(s, SRD_CONTENT, CAT, 'cat'));
  table.do('the sands', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the dune', (s) => addSceneLandmark(s, 'the dune', { x: 50, y: 50, z: 0 }));
  table.do('the lamia', (s) => placeCreatureInScene(s, LAMIA, { from: { landmark: 'the dune' }, feet: 0 }));
  table.do('the cat', (s) => placeCreatureInScene(s, CAT, { from: { landmark: 'the dune' }, feet: 40, bearing: 180 }));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: LAMIA, initiative: 20, speed: 40 },
      { id: CAT, initiative: 10, speed: 40 },
    ]),
  );
  return table;
};

/** A thirty-foot standing Long Jump north, which no Strength 16 covers on its own. */
const THIRTY_FEET = { placement: { from: { landmark: 'the dune' }, feet: 30, bearing: 0 }, jump: { kind: 'long' } } as const;

describe('a Lamia’s Leap', () => {
  it('is a jump the lamia cannot make on her own legs', () => {
    const table = inTheSands();
    const own = resolveMove(table.state, LAMIA, THIRTY_FEET, supply(table.state));
    expect(isErr(own) && own.code === 'jump_too_far').toBe(true);
  });

  it('buys a thirty-foot jump for ten feet of movement, this turn', () => {
    const table = inTheSands();
    const bought = unwrap(takeStatedBonusAction(table.state, LAMIA, { line: LEAP }), 'the leap');
    table.log.push(...bought.events);
    // The grant, and a deadline at the end of this turn; the sentence is
    // applied, so nothing says a DM must.
    const grant = bought.events.find((e) => e.type === 'jump-allowance-granted');
    expect(grant).toMatchObject({ type: 'jump-allowance-granted', id: LAMIA });
    expect((grant as { allowance: { feet: number; costsMovement: number } }).allowance).toMatchObject({ feet: 30, costsMovement: 10 });
    expect(bought.events.some((e) => e.type === 'effect-scheduled')).toBe(true);
    expect(bought.unverified.join(' ')).not.toContain('does not apply');
    expect(table.state.creatures[LAMIA]!.jumpAllowances).toHaveLength(1);

    const jumped = unwrap(resolveMove(table.state, LAMIA, THIRTY_FEET, supply(table.state)), 'the jump');
    table.log.push(...jumped.events);
    expect(jumped.feet).toBe(30);
    expect(jumped.cost).toBe(10);
    expect(table.state.combat!.budgets[LAMIA]!.movementSpent).toBe(10);
    expect(jumped.events.some((e) => e.type === 'jump-allowance-spent')).toBe(true);
  });

  it('is gone on her next turn without another Bonus Action', () => {
    const table = inTheSands();
    table.did('the leap', (s) => takeStatedBonusAction(s, LAMIA, { line: LEAP }));
    for (const step of ['lamia', 'cat']) {
      table.did(`${step}’s turn ends`, (s) => resolveTurn(s, supply(s), { commandId: `end ${step}` }));
    }
    expect(table.state.combat!.turnsTaken).toBe(2);
    expect(table.state.creatures[LAMIA]!.jumpAllowances).toEqual([]);
    const again = resolveMove(table.state, LAMIA, THIRTY_FEET, supply(table.state));
    expect(isErr(again) && again.code === 'jump_too_far').toBe(true);
  });
});

describe('a Cat’s Jumper', () => {
  it('measures the cat’s jump by its Dexterity rather than its Strength', () => {
    const table = inTheSands();
    const cat = table.state.creatures[CAT]!.sheet;
    // SRD Cat: Strength 3, Dexterity 15. The glossary's Long Jump is the score
    // and the High Jump is 3 plus the modifier; a standing jump halves each.
    expect(cat.abilities.str).toBe(3);
    expect(cat.abilities.dex).toBe(15);
    expect(longJumpDistance(cat, true)).toBe(15);
    expect(longJumpDistance(cat, false)).toBe(7);
    expect(highJumpHeight(cat, true)).toBe(5);
    expect(highJumpHeight(cat, false)).toBe(2);
    // And the lamia, who prints no such trait, is still read off her Strength.
    const lamia = table.state.creatures[LAMIA]!.sheet;
    expect(longJumpDistance(lamia, true)).toBe(lamia.abilities.str);
  });
});
