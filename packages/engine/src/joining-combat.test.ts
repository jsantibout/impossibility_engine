/**
 * A creature can join a fight already under way.
 *
 * The hole this closes is the one IE-046 found from the other side: its
 * `not_in_combat` request — *the fight exists and this creature has no place in
 * it* — had to name two commands and neither did the job. `rollInitiativeFor`
 * produces a number and changes no order; `beginCombat` replaces the whole
 * order, which is not a repair for a fight that is already running. A
 * reinforcement walking in mid-fight is the most ordinary thing at a table and
 * there was no command for it.
 *
 * **The risk is entirely in the arithmetic**, so that is what these tests
 * drive. An insertion is the first operation that changes the *length* of the
 * order mid-round, and the order and the turn counts are kept in exact step by
 * every operation that changes either. Get it wrong and a creature acts twice
 * or never — a wrong number with no symptom until somebody counts turns. So
 * every case below walks a whole round before the insertion and a whole round
 * after it, and asserts the sequence of creatures that actually acted rather
 * than asserting about an index.
 */
import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { addCombatant, startCombat } from './combat.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { beginCombat, joinCombat, resolveTurn } from './commands.js';

const id = (s: string) => asCharacterId(s);
const ALPHA = id('alpha');
const BRAVO = id('bravo');
const CHARLIE = id('charlie');
const DELTA = id('delta');

const SEED = 'joining';

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng(SEED) as Rng, content: SRD_CONTENT });

const must = <T,>(result: Result<T>): T => unwrap(result, 'joining combat');
const refusal = (result: Result<unknown>): string => (isErr(result) ? result.code : 'ok');

/** Four creatures the engine knows; three of them in a fight. */
const CAST: readonly GameEvent[] = [added(ALPHA), added(BRAVO), added(CHARLIE), added(DELTA)];

const FIGHTING: readonly GameEvent[] = [
  ...CAST,
  ...must(
    beginCombat(fold(SEED, CAST), [
      { id: ALPHA, initiative: 20, speed: 30 },
      { id: BRAVO, initiative: 15, speed: 30 },
      { id: CHARLIE, initiative: 10, speed: 30 },
    ]),
  ),
];

const at = (state: GameState): string => {
  const combat = state.combat;
  if (combat === null) throw new Error('no combat');
  const combatant = combat.order[combat.turnIndex];
  if (combatant === undefined) throw new Error('no combatant is acting');
  return combatant.id;
};

/**
 * Advance `turns` turns, recording who was acting at each moment.
 *
 * The record is the assertion: a skipped turn and a repeated one are both
 * invisible in an index and obvious in a sequence.
 */
const walk = (
  log: readonly GameEvent[],
  turns: number,
): { readonly log: readonly GameEvent[]; readonly acted: readonly string[] } => {
  let current = log;
  const acted: string[] = [at(fold(SEED, current))];
  for (let n = 0; n < turns; n += 1) {
    current = [...current, ...must(resolveTurn(fold(SEED, current), supply())).events];
    acted.push(at(fold(SEED, current)));
  }
  return { log: current, acted };
};

const join = (
  log: readonly GameEvent[],
  combatant: { id: CharacterId; initiative: number; speed: number; tiebreak?: number },
): readonly GameEvent[] => [...log, ...must(joinCombat(fold(SEED, log), combatant))];

describe('a creature joins a fight already under way', () => {
  /** The fixture is a real fight, or everything below passes vacuously. */
  it('starts from three combatants in Initiative order', () => {
    expect(fold(SEED, FIGHTING).combat?.order.map((c) => c.id)).toEqual([ALPHA, BRAVO, CHARLIE]);
    expect(at(fold(SEED, FIGHTING))).toBe(ALPHA);
  });

  /**
   * The headline case: inserted **after** the creature currently acting, so
   * the order reaches them this round.
   *
   * A whole round before and a whole round after, and the two sequences are
   * what say that nobody's turn was skipped or repeated.
   */
  it('takes its first turn when the order reaches it, without disturbing anybody else', () => {
    const before = walk(FIGHTING, 3);
    expect(before.acted).toEqual([ALPHA, BRAVO, CHARLIE, ALPHA]);

    // Alpha is acting again, at the top of round 2. Delta rolls a 12, which
    // sits between Bravo and Charlie.
    const joined = join(before.log, { id: DELTA, initiative: 12, speed: 30 });
    const state = fold(SEED, joined);
    expect(state.combat?.order.map((c) => c.id)).toEqual([ALPHA, BRAVO, DELTA, CHARLIE]);
    expect(at(state)).toBe(ALPHA);
    expect(state.combat?.round).toBe(2);

    const after = walk(joined, 4);
    expect(after.acted).toEqual([ALPHA, BRAVO, DELTA, CHARLIE, ALPHA]);
    expect(fold(SEED, after.log).combat?.round).toBe(3);
  });

  /**
   * The case that is easy to get wrong: the insertion lands **earlier** in the
   * order than the creature currently acting.
   *
   * Their place in the round has already gone by, so they act next round — and
   * the creature mid-turn must go on being the creature mid-turn. An insertion
   * that did not move the turn index with it would hand the turn to whoever
   * the shift pushed into that slot, which is a creature acting twice and
   * another never acting at all.
   */
  it('does not take the turn of the creature it was inserted in front of', () => {
    // Bravo is acting: one turn past the start of the fight.
    const before = walk(FIGHTING, 1);
    expect(before.acted).toEqual([ALPHA, BRAVO]);

    // Delta rolls a 25, which is ahead of everybody — and ahead of Bravo, who
    // is mid-turn.
    const joined = join(before.log, { id: DELTA, initiative: 25, speed: 30 });
    const state = fold(SEED, joined);
    expect(state.combat?.order.map((c) => c.id)).toEqual([DELTA, ALPHA, BRAVO, CHARLIE]);
    expect(at(state)).toBe(BRAVO);

    // Bravo finishes, Charlie goes, the round wraps, and Delta's first turn is
    // the top of round 2. Alpha acts once per round and never twice.
    const after = walk(joined, 4);
    expect(after.acted).toEqual([BRAVO, CHARLIE, DELTA, ALPHA, BRAVO]);
  });

  /**
   * And the boundary between the two cases: inserted at exactly the acting
   * creature's own index, which is the insertion that displaces them.
   */
  it('lets the acting creature go on acting when it is displaced by one', () => {
    const before = walk(FIGHTING, 1);
    // 16 ranks above Bravo's 15 and below Alpha's 20, so Delta lands on the
    // index Bravo is acting from.
    const joined = join(before.log, { id: DELTA, initiative: 16, speed: 30 });
    const state = fold(SEED, joined);
    expect(state.combat?.order.map((c) => c.id)).toEqual([ALPHA, DELTA, BRAVO, CHARLIE]);
    expect(state.combat?.turnIndex).toBe(2);
    expect(at(state)).toBe(BRAVO);

    expect(walk(joined, 4).acted).toEqual([BRAVO, CHARLIE, ALPHA, DELTA, BRAVO]);
  });

  /** Last in the order is still this round: the order has not reached them. */
  it('acts at the bottom of this round when its Initiative is the lowest', () => {
    const joined = join(FIGHTING, { id: DELTA, initiative: 1, speed: 30 });
    expect(fold(SEED, joined).combat?.order.map((c) => c.id)).toEqual([
      ALPHA,
      BRAVO,
      CHARLIE,
      DELTA,
    ]);
    expect(walk(joined, 4).acted).toEqual([ALPHA, BRAVO, CHARLIE, DELTA, ALPHA]);
  });
});

describe('the ranking a joiner is placed by is the one a fight begins with', () => {
  /**
   * SRD: "The GM ranks the combatants, from highest to lowest Initiative."
   * Ties fall to the supplied tiebreak, then to the order they were listed in
   * — and a creature arriving mid-fight was listed last, so it goes after
   * everybody it is exactly level with.
   */
  it('puts a joiner after a combatant it ties with outright', () => {
    const joined = join(FIGHTING, { id: DELTA, initiative: 15, speed: 30 });
    expect(fold(SEED, joined).combat?.order.map((c) => c.id)).toEqual([
      ALPHA,
      BRAVO,
      DELTA,
      CHARLIE,
    ]);
  });

  /** And the tiebreak is read, because it is the rule the engine already has. */
  it('puts a joiner ahead of an equal Initiative when its tiebreak is higher', () => {
    const joined = join(FIGHTING, { id: DELTA, initiative: 15, speed: 30, tiebreak: 1 });
    expect(fold(SEED, joined).combat?.order.map((c) => c.id)).toEqual([
      ALPHA,
      DELTA,
      BRAVO,
      CHARLIE,
    ]);
  });

  /**
   * The claim made directly, over every place a joiner could land: joining a
   * running fight leaves the same order that starting the fight with that
   * creature in it would have produced.
   *
   * This is what "read the rule rather than inventing a second one" means as a
   * test. A second comparator would pass every case above and fail here the
   * first time it disagreed about a tie.
   */
  it('agrees with startCombat over every Initiative and tiebreak a joiner could have', () => {
    const three = unwrap(
      startCombat([
        { id: ALPHA, initiative: 20, speed: 30 },
        { id: BRAVO, initiative: 15, speed: 30 },
        { id: CHARLIE, initiative: 10, speed: 30, tiebreak: 2 },
      ]),
      'three',
    );

    for (const initiative of [25, 20, 17, 15, 12, 10, 4]) {
      for (const tiebreak of [0, 2, 5]) {
        const joining = { id: DELTA, initiative, speed: 30, tiebreak };
        const inserted = unwrap(addCombatant(three, joining), 'joined').order.map((c) => c.id);
        // Listed **last**, because that is what a latecomer is.
        const restarted = unwrap(
          startCombat([...three.order, joining]),
          'restarted',
        ).order.map((c) => c.id);
        expect([initiative, tiebreak, inserted]).toEqual([initiative, tiebreak, restarted]);
      }
    }
  });
});

describe('the order and the turn counts stay in exact step', () => {
  /**
   * Every creature the order holds has a budget and a turn count, and nobody
   * else does. This is the agreement `time.ts` relies on to answer "the
   * start of your next turn" at all, and an insertion is the first operation
   * that grows the order.
   */
  it('gives the joiner a budget and a count, and leaves nobody else with either', () => {
    const joined = join(walk(FIGHTING, 1).log, { id: DELTA, initiative: 12, speed: 30 });
    const combat = fold(SEED, joined).combat;
    expect(combat).not.toBeNull();
    const ids = combat!.order.map((c) => c.id as string).sort();
    expect(Object.keys(combat!.budgets).sort()).toEqual(ids);
    expect(Object.keys(combat!.turnCounts).sort()).toEqual(ids);
  });

  /**
   * The joiner has taken no turns, which is the honest number and the one that
   * makes "your next turn" land where the order reaches them.
   *
   * `begun` equals `ended` for everybody who is not mid-turn, and is one more
   * for whoever is — that relationship, rather than the round, is what every
   * turn-anchored deadline is computed from.
   */
  it('counts no turns for a creature that has taken none', () => {
    const joined = join(walk(FIGHTING, 1).log, { id: DELTA, initiative: 12, speed: 30 });
    const combat = fold(SEED, joined).combat!;
    expect(combat.turnCounts[DELTA]).toEqual({ begun: 0, ended: 0 });

    for (const combatant of combat.order) {
      const counts = combat.turnCounts[combatant.id]!;
      const acting = combatant.id === at(fold(SEED, joined));
      expect([combatant.id, counts.begun - counts.ended]).toEqual([
        combatant.id,
        acting ? 1 : 0,
      ]);
    }
  });

  /** And the count moves exactly once when the order reaches them. */
  it('counts the joiner’s first turn when the order reaches it and not before', () => {
    const joined = join(FIGHTING, { id: DELTA, initiative: 12, speed: 30 });
    const counts = (log: readonly GameEvent[]) => fold(SEED, log).combat!.turnCounts[DELTA];

    const one = walk(joined, 1);
    expect(counts(one.log)).toEqual({ begun: 0, ended: 0 });
    const two = walk(one.log, 1);
    expect(counts(two.log)).toEqual({ begun: 1, ended: 0 });
    const three = walk(two.log, 1);
    expect(counts(three.log)).toEqual({ begun: 1, ended: 1 });
  });

  /**
   * Joining spends nothing and takes nothing away: the clock has not moved,
   * the round has not changed, and no turn has been taken.
   */
  it('moves neither the clock, the round nor the turn counter', () => {
    const before = fold(SEED, walk(FIGHTING, 1).log);
    const after = fold(SEED, join(walk(FIGHTING, 1).log, { id: DELTA, initiative: 12, speed: 30 }));
    expect(after.elapsed).toBe(before.elapsed);
    expect(after.combat?.round).toBe(before.combat?.round);
    expect(after.combat?.turnsTaken).toBe(before.combat?.turnsTaken);
  });

  /**
   * The joiner arrives with a whole turn's budget, exactly as `startCombat`
   * hands one to everybody at the top of a fight. It matters before their
   * first turn because SRD's Reaction is "until the start of your next turn",
   * and somebody who has just walked in has not spent one.
   */
  it('arrives with a Reaction, because nothing has taken it yet', () => {
    const joined = join(FIGHTING, { id: DELTA, initiative: 12, speed: 30 });
    expect(fold(SEED, joined).combat?.budgets[DELTA]?.reaction).toBe(true);
  });
});

describe('joining is refused where there is nothing to join', () => {
  it('refuses a creature already in the order', () => {
    expect(refusal(joinCombat(fold(SEED, FIGHTING), { id: BRAVO, initiative: 9, speed: 30 }))).toBe(
      'duplicate_combatant',
    );
  });

  it('refuses a creature the engine has never been told about', () => {
    expect(
      refusal(joinCombat(fold(SEED, FIGHTING), { id: id('nobody'), initiative: 9, speed: 30 })),
    ).toBe('unknown_creature');
  });

  it('refuses a fight that is not running', () => {
    expect(refusal(joinCombat(fold(SEED, CAST), { id: DELTA, initiative: 9, speed: 30 }))).toBe(
      'not_in_combat',
    );
  });

  /** A refusal leaves the order exactly as it was. */
  it('changes nothing when it refuses', () => {
    const before = fold(SEED, FIGHTING);
    expect(refusal(joinCombat(before, { id: BRAVO, initiative: 9, speed: 30 }))).toBe(
      'duplicate_combatant',
    );
    expect(fold(SEED, FIGHTING)).toEqual(before);
  });
});

describe('joining is idempotent under one command id', () => {
  it('adds the creature once however many times the command is sent', () => {
    const first = must(joinCombat(fold(SEED, FIGHTING), { id: DELTA, initiative: 12, speed: 30 }, { commandId: 'reinforcements' }));
    const log = [...FIGHTING, ...first];
    const again = must(
      joinCombat(fold(SEED, log), { id: DELTA, initiative: 12, speed: 30 }, { commandId: 'reinforcements' }),
    );
    expect(again).toEqual([]);
    expect(fold(SEED, log).combat?.order.map((c) => c.id)).toEqual([
      ALPHA,
      BRAVO,
      DELTA,
      CHARLIE,
    ]);
  });

  it('refuses the same id used for a different Initiative', () => {
    const first = must(
      joinCombat(fold(SEED, FIGHTING), { id: DELTA, initiative: 12, speed: 30 }, { commandId: 'reinforcements' }),
    );
    const log = [...FIGHTING, ...first];
    expect(
      refusal(
        joinCombat(fold(SEED, log), { id: DELTA, initiative: 3, speed: 30 }, { commandId: 'reinforcements' }),
      ),
    ).toBe('command_id_reused');
  });
});
