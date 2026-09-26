/**
 * What an attached creature may then do — W7-B10.
 *
 * SRD Darkmantle, Crush: "While attached to a target, the darkmantle can attack
 * only the target but has Advantage on its attack rolls. Its Speed becomes 0,
 * it can't benefit from any bonus to its Speed, and it moves with the target."
 * SRD Stirge, Proboscis: "While attached, the stirge can't make Proboscis
 * attacks."
 *
 * Three sentences the hit reader used to hand back, each pinned on the
 * attachment record at the hit and read where the fact is asked: the target
 * restriction and the Advantage at the swing, the barred line at the swing,
 * the moving-with at the target's move.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  detachFrom,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { positionOf } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { speedOf } from './standing.js';
import { attachmentsOf } from './commands/unarmed.js';

const id = (s: string) => asCharacterId(s);
const BEAST = id('beast');
const ROGUE = id('rogue');
const OTHER = id('other');
const SEED = 'clung';

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

/** The beast beside a knight and another knight, the beast's turn first. */
function cave(block: string): Table {
  const table = new Table();
  table.did('the beast arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  table.did('the rogue arrives', (s) => addCreature(s, SRD_CONTENT, ROGUE, 'knight'));
  table.did('another arrives', (s) => addCreature(s, SRD_CONTENT, OTHER, 'knight'));
  table.do('the cave', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the stalagmite', (s) => addSceneLandmark(s, 'the stalagmite', { x: 100, y: 100, z: 0 }));
  table.do('the rogue stands', (s) => placeCreatureInScene(s, ROGUE, { from: { landmark: 'the stalagmite' }, feet: 0 }));
  table.do('the beast above him', (s) => placeCreatureInScene(s, BEAST, { from: { creature: ROGUE }, feet: 5, bearing: 90 }));
  table.do('the other beside', (s) => placeCreatureInScene(s, OTHER, { from: { creature: BEAST }, feet: 5, bearing: 90 }));
  table.do("the beast's side", (s) => declareCreatureSide(s, BEAST, 'wild'));
  for (const who of [ROGUE, OTHER]) table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BEAST, initiative: 20, speed: 10 },
      { id: ROGUE, initiative: 10, speed: 30 },
      { id: OTHER, initiative: 5, speed: 30 },
    ]),
  );
  return table;
}

const swing = (table: Table, action: string, target: CharacterId, commandId?: string) =>
  resolveAttack(
    table.state,
    BEAST,
    {
      target,
      weapon: null,
      action,
      attackBonuses: [{ source: 'forced', flat: 40 }],
      ...(commandId === undefined ? {} : { commandId }),
    },
    table.supply(),
  );

const endTurn = (table: Table, step: string): void => {
  table.did(step, (s) => resolveTurn(s, table.supply(), { commandId: step }));
};

describe('a Darkmantle attached to a knight', () => {
  it('attacks only the knight, with Advantage, and moves with him', () => {
    const table = cave('darkmantle');
    table.log.push(...unwrap(swing(table, 'Crush', ROGUE), 'the crush').events);
    expect(attachmentsOf(table.state, BEAST).map((one) => one.to)).toEqual([ROGUE]);
    expect(attachmentsOf(table.state, BEAST)[0]?.whileAttached).toMatchObject({
      attacksOnly: true,
      movesWithTarget: true,
      noSpeedBonus: true,
    });
    for (const step of ['darkmantle', 'rogue', 'other']) endTurn(table, `${step} is done`);
    // "can attack only the target"
    const other = swing(table, 'Crush', OTHER, 'at the other');
    expect(isErr(other) && other.code === 'attached_to_another').toBe(true);
    expect(table.state.combat!.budgets[BEAST]!.action).toBe(true);
    // "but has Advantage on its attack rolls"
    const again = unwrap(swing(table, 'Crush', ROGUE, 'at the rogue'), 'the crush again');
    expect(again.attack?.mode).toBe('advantage');
    table.log.push(...again.events);
    // "it moves with the target": the knight walks and the darkmantle rides.
    endTurn(table, 'darkmantle is done again');
    const before = positionOf(table.state.scene!, BEAST);
    table.did('the rogue walks', (s) =>
      resolveMove(s, ROGUE, { placement: { from: { creature: ROGUE }, feet: 20, bearing: 180 }, commandId: 'walk' }, table.supply()),
    );
    const state = table.state;
    expect(positionOf(state.scene!, BEAST)).not.toEqual(before);
    expect(positionOf(state.scene!, BEAST)).toEqual(positionOf(state.scene!, ROGUE));
    // Its Speed is 0 and stays 0 whatever bonus reaches it.
    expect(speedOf(state, BEAST)).toBe(0);
    // Detached, it may attack anybody again.
    endTurn(table, 'the rogue is done again');
    endTurn(table, 'the other is done again');
    table.did('it lets go', (s) => detachFrom(s, BEAST, { holder: BEAST, from: ROGUE }, table.supply()));
    expect(table.state.creatures[BEAST]!.rollModifiers).toEqual([]);
    expect(swing(table, 'Crush', OTHER, 'free again').ok).toBe(true);
  });
});

describe('a Stirge attached to a knight', () => {
  it('cannot make a Proboscis attack while attached', () => {
    const table = cave('stirge');
    table.log.push(...unwrap(swing(table, 'Proboscis', ROGUE), 'the proboscis').events);
    expect(attachmentsOf(table.state, BEAST)[0]?.whileAttached).toMatchObject({ forbidsLine: 'Proboscis' });
    for (const step of ['stirge', 'rogue', 'other']) endTurn(table, `${step} is done`);
    const again = swing(table, 'Proboscis', ROGUE, 'again');
    expect(isErr(again) && again.code === 'line_forbidden_while_attached').toBe(true);
    expect(table.state.combat!.budgets[BEAST]!.action).toBe(true);
  });
});
