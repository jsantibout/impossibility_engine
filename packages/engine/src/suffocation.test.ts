/**
 * The glossary's Suffocation hazard — M-HOLD.
 *
 * SRD *Suffocation* [Hazard]: "A creature can hold its breath for a number of
 * minutes equal to 1 plus its Constitution modifier (minimum of 30 seconds)
 * before suffocation begins. When a creature runs out of breath or is
 * choking, it gains 1 Exhaustion level at the end of each of its turns. When a
 * creature can breathe again, it removes all levels of Exhaustion it gained
 * from suffocating."
 *
 * The four holds that print "is suffocating" — the Rug's Smother, the
 * Darkmantle's Crush, the Cube's Engulf and the Water Elemental's Whelm — are
 * driven through their own lines in their own files. This one drives the
 * hazard itself, with a hold made by hand so nothing but the breath is
 * measured: the clock, the level at the end of each turn, the levels coming
 * off when the hold lets go, an Immunity to Exhaustion, a block's own Hold
 * Breath, death at the sixth level, and the clock refusing to run past a
 * creature out of breath with no turns to charge it at.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  advanceTime,
  beginCombat,
  grappleSource,
  liftConditionFrom,
  resolveTurn,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { breathSecondsOf, breathTakenBy, outOfBreath, suffocationOn } from './hazards.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const HOLDER = id('holder');
const HELD = id('held');
const SEED = 'breath';

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

const SOURCE = grappleSource(HOLDER);

/** A held creature of the given block, its breath taken by a grapple made by hand. */
function smothered(block: string, options: { readonly fight?: boolean } = {}): Table {
  const table = new Table();
  table.did('the holder arrives', (s) => addCreature(s, SRD_CONTENT, HOLDER, 'knight'));
  table.did('the held arrives', (s) => addCreature(s, SRD_CONTENT, HELD, block));
  if (options.fight !== false) begin(table);
  table.log.push(
    { type: 'condition-applied', id: HELD, condition: 'grappled', source: SOURCE },
    breathTakenBy(HELD, 'Smother', { by: 'grapple', source: SOURCE }),
  );
  return table;
}

function begin(table: Table): void {
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: HOLDER, initiative: 20, speed: 30 },
      { id: HELD, initiative: 10, speed: 30 },
    ]),
  );
}

/** One round: the holder's turn ends, then the held creature's. */
function round(table: Table, n: number): void {
  table.did(`holder ${n}`, (s) => resolveTurn(s, table.supply(), { commandId: `holder ${n}` }));
  table.did(`held ${n}`, (s) => resolveTurn(s, table.supply(), { commandId: `held ${n}` }));
}

const exhaustionOf = (table: Table): number => table.state.creatures[HELD]!.conditions.exhaustion;

describe('how long a creature holds its breath', () => {
  it('is 1 plus its Constitution modifier in minutes, at least thirty seconds, unless its block says otherwise', () => {
    const table = new Table();
    table.did('a kobold', (s) => addCreature(s, SRD_CONTENT, id('kobold'), 'kobold-warrior'));
    table.did('a knight', (s) => addCreature(s, SRD_CONTENT, id('knight'), 'knight'));
    table.did('a crocodile', (s) => addCreature(s, SRD_CONTENT, id('crocodile'), 'crocodile'));
    table.did('an octopus', (s) => addCreature(s, SRD_CONTENT, id('octopus'), 'giant-octopus'));
    const state = table.state;
    // Constitution 9: 1 + (−1) is no minutes, and the floor is thirty seconds.
    expect(breathSecondsOf(state, id('kobold'))).toBe(30);
    // Constitution 14: 1 + 2 minutes.
    expect(breathSecondsOf(state, id('knight'))).toBe(180);
    // SRD Hold Breath: "can hold its breath for 1 hour".
    expect(breathSecondsOf(state, id('crocodile'))).toBe(3600);
    // SRD Giant Octopus: "It can hold its breath for 1 hour outside water."
    expect(breathSecondsOf(state, id('octopus'))).toBe(3600);
  });
});

describe('a creature that cannot breathe', () => {
  it('holds its breath, then gains a level of Exhaustion at the end of each of its turns', () => {
    // A kobold: thirty seconds, five rounds.
    const table = smothered('kobold-warrior');
    expect(suffocationOn(table.state, HELD)).toMatchObject({ hazard: 'suffocating', since: 0, gained: 0 });
    for (let n = 1; n <= 5; n += 1) {
      round(table, n);
      expect(exhaustionOf(table), `round ${n}`).toBe(0);
    }
    // The sixth round: thirty seconds have passed when its turn ends.
    table.did('holder 6', (s) => resolveTurn(s, table.supply(), { commandId: 'holder 6' }));
    expect(exhaustionOf(table)).toBe(0);
    expect(outOfBreath(table.state, HELD)).toBe(true);
    table.did('held 6', (s) => resolveTurn(s, table.supply(), { commandId: 'held 6' }));
    expect(exhaustionOf(table)).toBe(1);
    // And again at the end of every turn after.
    round(table, 7);
    expect(exhaustionOf(table)).toBe(2);
    expect(suffocationOn(table.state, HELD)?.gained).toBe(2);
    // Only its own turns: the holder's end charges it nothing.
    table.did('holder 8', (s) => resolveTurn(s, table.supply(), { commandId: 'holder 8' }));
    expect(exhaustionOf(table)).toBe(2);
  });

  it('can breathe again when the hold lets go, and sheds the levels suffocating gave it and no others', () => {
    const table = smothered('kobold-warrior');
    // A level it already had, from something else.
    table.log.push({ type: 'exhaustion-set', id: HELD, level: 1 });
    for (let n = 1; n <= 7; n += 1) round(table, n);
    expect(exhaustionOf(table)).toBe(3);
    table.do('the holder lets go', (s) => liftConditionFrom(s, HELD, 'grappled', SOURCE));
    expect(suffocationOn(table.state, HELD)).toBeNull();
    expect(exhaustionOf(table)).toBe(1);
    // And a hold that bites again starts a fresh breath.
    table.log.push(
      { type: 'condition-applied', id: HELD, condition: 'grappled', source: SOURCE },
      breathTakenBy(HELD, 'Smother', { by: 'grapple', source: SOURCE }),
    );
    expect(suffocationOn(table.state, HELD)).toMatchObject({ since: table.state.elapsed, gained: 0 });
  });

  it('keeps its breath held through a second hold, and breathes only when both have let go', () => {
    const table = smothered('kobold-warrior');
    const second = grappleSource(id('another'));
    for (let n = 1; n <= 3; n += 1) round(table, n);
    table.log.push(
      { type: 'condition-applied', id: HELD, condition: 'grappled', source: second },
      breathTakenBy(HELD, 'Smother', { by: 'grapple', source: second }),
    );
    // The clock is the first hold's: the second takes no breath back.
    expect(suffocationOn(table.state, HELD)?.since).toBe(0);
    for (let n = 4; n <= 6; n += 1) round(table, n);
    expect(exhaustionOf(table)).toBe(1);
    table.do('the first lets go', (s) => liftConditionFrom(s, HELD, 'grappled', SOURCE));
    expect(exhaustionOf(table)).toBe(1);
    expect(suffocationOn(table.state, HELD)?.while).toEqual([{ by: 'grapple', source: second }]);
    table.do('the second lets go', (s) => liftConditionFrom(s, HELD, 'grappled', second));
    expect(exhaustionOf(table)).toBe(0);
    expect(suffocationOn(table.state, HELD)).toBeNull();
  });

  it('gains nothing where it is immune to Exhaustion, though it still cannot breathe', () => {
    const table = smothered('kobold-warrior');
    table.log.push({
      type: 'condition-immunity-granted',
      id: HELD,
      immunity: { source: 'a borrowed ward', conditions: ['exhaustion'] },
    });
    for (let n = 1; n <= 7; n += 1) round(table, n);
    expect(outOfBreath(table.state, HELD)).toBe(true);
    expect(exhaustionOf(table)).toBe(0);
  });

  it('dies at the sixth level, which is the glossary\'s Exhaustion and not a rule of its own', () => {
    const table = smothered('kobold-warrior');
    table.log.push({ type: 'exhaustion-set', id: HELD, level: 5 });
    for (let n = 1; n <= 6; n += 1) round(table, n);
    expect(exhaustionOf(table)).toBe(6);
    expect(table.state.creatures[HELD]!.vitals.dead).toBe(true);
  });

  it("holds its breath for the hour a block's Hold Breath prints", () => {
    // Out of a fight: half an hour passes with the crocodile held.
    const table = smothered('crocodile', { fight: false });
    table.do('half an hour', (s) => advanceTime(s, 1800, 'held under'));
    begin(table);
    round(table, 1);
    expect(exhaustionOf(table)).toBe(0);
    expect(outOfBreath(table.state, HELD)).toBe(false);
  });

  /**
   * The level is owed "at the end of each of its turns", and outside a fight
   * there are no turns — so the clock does not run past the moment a held
   * creature's breath gives out, for `dyingOutsideAFight`'s reason. It asks
   * for the turn order the levels are charged in.
   */
  it('refuses to let the clock run out a held breath outside a fight, and asks for the turns', () => {
    const table = smothered('kobold-warrior', { fight: false });
    // Twenty seconds is within the kobold's thirty: the clock may run.
    table.do('twenty seconds', (s) => advanceTime(s, 20, 'held'));
    const refused = advanceTime(table.state, 20, 'held longer');
    expect(isErr(refused) && refused.code).toBe('suffocating_outside_a_fight');
    expect(isNeedsContext(refused)).toBe(true);
    // Free of the hold, the clock runs as far as anybody likes.
    table.do('let go', (s) => liftConditionFrom(s, HELD, 'grappled', SOURCE));
    expect(advanceTime(table.state, 3600, 'free').ok).toBe(true);
  });

  it('refuses a hazard event that names its own clock or count, which are the fold\'s', () => {
    const table = smothered('kobold-warrior');
    const forged: GameEvent = {
      type: 'hazard-caught',
      id: HELD,
      hazard: { hazard: 'suffocating', lit: 'Smother', while: [{ by: 'grapple', source: SOURCE }], since: 999 },
    };
    expect(() => fold(SEED, [...table.log, forged])).toThrow(/clock/);
  });

  it('ends with the fight and gains nothing outside one', () => {
    const table = smothered('kobold-warrior');
    for (let n = 1; n <= 6; n += 1) round(table, n);
    expect(exhaustionOf(table)).toBe(1);
    table.log.push({ type: 'combat-ended' });
    // Still held and still out of breath: the hazard is not the fight's.
    expect(suffocationOn(table.state, HELD)?.gained).toBe(1);
    const asked = advanceTime(table.state, 6, 'a moment');
    expect(isErr(asked) && asked.code).toBe('suffocating_outside_a_fight');
  });
});
