/**
 * A pull gated on a web — W7-B10.
 *
 * SRD Ettercap, Reel: "The ettercap pulls one creature within 30 feet of
 * itself that is Restrained by its Web Strand up to 25 feet straight toward
 * itself." The web is the thing the Web Strand save raises, and the Restrained
 * is filed under it; the pull reads that hold off the object's record rather
 * than a grapple's, and reaches only a creature this ettercap's own web holds.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveTurn,
  setScene,
  takePrintedPull,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { distanceBetween } from './positioning.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
// An id with colons in it, as a summoned creature's has, so the web's own id
// (`web:<spinner>:<webbed>:<use>`) is read whole rather than split.
const ETTERCAP = id('summon:ettercap:1');
const BREN = id('bren');
const SABLE = id('sable');
const SEEDS = Array.from({ length: 12 }, (_, i) => `strand-${i}`);

class Table {
  constructor(private readonly seed: string) {}
  readonly log: GameEvent[] = [];
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
  private draws = 0;
  supply() {
    this.draws += 1;
    return {
      issuer: createRollIssuer(`r${this.draws}`),
      rng: createRng(`${this.seed}:${this.draws}`) as Rng,
      content: SRD_CONTENT,
    };
  }
}

/** The ettercap with two knights twenty feet north, its turn first. */
function lair(seed: string): Table {
  const table = new Table(seed);
  table.did('the ettercap arrives', (s) => addCreature(s, SRD_CONTENT, ETTERCAP, 'ettercap'));
  for (const who of [BREN, SABLE]) table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'knight'));
  table.do('the lair', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the web', (s) => addSceneLandmark(s, 'the web', { x: 100, y: 100, z: 0 }));
  table.do('the ettercap stands', (s) => placeCreatureInScene(s, ETTERCAP, { from: { landmark: 'the web' }, feet: 0 }));
  table.do('Bren north', (s) => placeCreatureInScene(s, BREN, { from: { creature: ETTERCAP }, feet: 20, bearing: 0 }));
  table.do('Sable beside him', (s) => placeCreatureInScene(s, SABLE, { from: { creature: BREN }, feet: 5, bearing: 90 }));
  table.do("the ettercap's side", (s) => declareCreatureSide(s, ETTERCAP, 'wild'));
  for (const who of [BREN, SABLE]) table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: ETTERCAP, initiative: 20, speed: 30 },
      { id: BREN, initiative: 10, speed: 30 },
      { id: SABLE, initiative: 5, speed: 30 },
    ]),
  );
  return table;
}

/** A lair in which Bren failed the Web Strand save, found rather than guessed. */
function aLairWhereBrenIsWebbed(): Table {
  for (const seed of SEEDS) {
    const table = lair(seed);
    const out = unwrap(
      forcePrintedSave(table.state, ETTERCAP, { line: 'Web Strand (Recharge 5–6)', targets: [BREN] }, table.supply()),
      'the strand',
    );
    table.log.push(...out.events);
    if (hasCondition(table.state.creatures[BREN]!.conditions, 'restrained')) return table;
  }
  throw new Error('no seed webbed Bren');
}

describe("the Ettercap's Reel", () => {
  it('pulls the creature its web holds up to 25 feet toward itself, and is refused one the web does not hold', () => {
    const table = aLairWhereBrenIsWebbed();
    // Sable is not webbed.
    const wrong = takePrintedPull(table.state, ETTERCAP, { line: 'Reel', target: SABLE });
    expect(isErr(wrong) && wrong.code === 'not_held_by_web').toBe(true);
    expect(table.state.combat!.budgets[ETTERCAP]!.bonusAction).toBe(true);
    // One creature is webbed, so nobody need be named.
    const reeled = unwrap(takePrintedPull(table.state, ETTERCAP, { line: 'Reel' }), 'the reel');
    table.log.push(...reeled.events);
    expect(reeled.pulled).toEqual([BREN]);
    // Twenty feet away and "up to 25 feet" toward: he stops at the gap, which
    // `pullToward` measures as the whole distance between the two — the
    // reading `printed-hit-riders.test.ts` pins for the Merrow's Harpoon as
    // "the puller's own face" — so he ends in the ettercap's own space.
    expect(distanceBetween(table.state.scene!, BREN, ETTERCAP)).toEqual({ ok: true, value: 0 });
    expect(hasCondition(table.state.creatures[BREN]!.conditions, 'restrained')).toBe(true);
    expect(table.state.combat!.budgets[ETTERCAP]!.bonusAction).toBe(false);
  });

  it('is refused where its web holds nobody', () => {
    const table = lair('strand-empty');
    const nobody = takePrintedPull(table.state, ETTERCAP, { line: 'Reel' });
    expect(isErr(nobody) && nobody.code === 'not_held_by_web').toBe(true);
  });

  it('does not reach a creature another creature webbed', () => {
    const table = aLairWhereBrenIsWebbed();
    // A web somebody else spun, holding Sable: hand-written under a spinner
    // that is not the ettercap.
    table.log.push(
      { type: 'creature-added', id: id('web:spider:sable:1'), name: "a spider's web", sheet: table.state.creatures[ETTERCAP]!.sheet, maxHp: 5, diesAtZero: true, creatureType: 'Object' },
      { type: 'condition-applied', id: SABLE, condition: 'restrained', source: 'held-by:web:spider:sable:1' },
    );
    const wrong = takePrintedPull(table.state, ETTERCAP, { line: 'Reel', target: SABLE });
    expect(isErr(wrong) && wrong.code === 'not_held_by_web').toBe(true);
    // Round the table and back: the web still holds Bren, and the Reel still reaches him.
    for (const step of ['ettercap', 'bren', 'sable']) {
      table.did(`${step} is done`, (s) => resolveTurn(s, table.supply(), { commandId: `end ${step}` }));
    }
    expect(unwrap(takePrintedPull(table.state, ETTERCAP, { line: 'Reel' }), 'the reel').pulled).toEqual([BREN]);
  });
});
