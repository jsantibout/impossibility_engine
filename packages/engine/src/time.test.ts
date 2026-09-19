/**
 * `time.ts`, both halves of it: the clock that counts seconds, and the two
 * shapes of "how long" that are measured against it.
 *
 * One file because there is one module. These were `clock.test.ts` and
 * `duration.test.ts`, and every assertion in the second was already about the
 * conversion the first's units feed — `hours(8)` against an elapsed deadline,
 * a round against a turn count. Nothing here moved; the two halves are
 * neighbours now, in the order the module declares them.
 */
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { conditionInstanceId } from './conditions.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { castingSource } from './spells.js';
import {
  DAY,
  days,
  describeElapsed,
  endOfCurrentTurn,
  endOfNextTurn,
  forSeconds,
  hasExpired,
  HOUR,
  hours,
  indefinite,
  isDue,
  MINUTE,
  minutes,
  resolveDuration,
  ROUND,
  rounds,
  startOfNextTurn,
  timeView,
  type Deadline,
} from './time.js';
import {
  applyConditionTo,
  applySpellEffect,
  castSpell,
  endConcentration,
  nextCastingId,
} from './commands.js';

const id = (s: string) => asCharacterId(s);

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const add = (name: string, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
});

const table = (): GameEvent[] => [
  add('wizard'),
  add('cleric'),
  add('goblin'),
  {
    type: 'resource-pool-declared',
    id: id('wizard'),
    pool: { key: spellSlotKey(2), label: 'l2', max: 2, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: id('cleric'),
    pool: { key: spellSlotKey(2), label: 'l2', max: 1, recovers: 'long-rest' },
  },
];

const fight = (): GameEvent[] => [
  ...table(),
  {
    type: 'combat-started',
    combatants: [
      { id: id('wizard'), initiative: 20, speed: 30 },
      { id: id('goblin'), initiative: 10, speed: 30 },
      { id: id('cleric'), initiative: 5, speed: 30 },
    ],
  },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

const tick = (n: number): GameEvent[] => Array.from({ length: n }, () => ({ type: 'turn-advanced' }));
const clock = (seconds: number): GameEvent => ({ type: 'time-advanced', seconds, reason: 'time' });

const conditionsOf = (state: GameState, who: string) =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('the clock counts seconds', () => {
  /** SRD: "A round represents about 6 seconds in the game world." */
  it('knows how long the units of play are', () => {
    expect(ROUND).toBe(6);
    expect(MINUTE).toBe(60);
    expect(HOUR).toBe(3600);
    expect(DAY).toBe(86_400);
  });

  it('builds durations from units', () => {
    expect(rounds(10)).toBe(MINUTE);
    expect(minutes(60)).toBe(HOUR);
    expect(hours(24)).toBe(DAY);
    expect(days(1)).toBe(DAY);
  });

  /** Everything divides into rounds, so no duration lands between two of them. */
  it('keeps every unit a whole number of rounds', () => {
    for (const seconds of [ROUND, MINUTE, HOUR, DAY]) {
      expect(seconds % ROUND).toBe(0);
    }
  });

  it('refuses a duration that is not a whole number of seconds', () => {
    expect(() => rounds(1.5)).toThrow();
    expect(() => hours(-1)).toThrow();
    expect(() => minutes(NaN)).toThrow();
  });

  it('says an elapsed span out loud', () => {
    expect(describeElapsed(0)).toBe('no time');
    expect(describeElapsed(ROUND)).toBe('1 round');
    expect(describeElapsed(rounds(3))).toBe('3 rounds');
    expect(describeElapsed(MINUTE)).toBe('1 minute');
    expect(describeElapsed(HOUR)).toBe('1 hour');
    expect(describeElapsed(hours(8))).toBe('8 hours');
    expect(describeElapsed(days(2))).toBe('2 days');
  });
});

describe('time passes', () => {
  it('starts at zero', () => {
    expect(fold('seed', []).elapsed).toBe(0);
  });

  it('advances when something says it did', () => {
    const state = fold('seed', [
      add('fighter'),
      { type: 'time-advanced', seconds: hours(4), reason: 'travelling to the pass' },
    ]);
    expect(state.elapsed).toBe(hours(4));
  });

  it('accumulates', () => {
    const state = fold('seed', [
      { type: 'time-advanced', seconds: MINUTE, reason: 'searching' },
      { type: 'time-advanced', seconds: MINUTE, reason: 'searching' },
    ]);
    expect(state.elapsed).toBe(minutes(2));
  });

  it('refuses to run backwards', () => {
    expect(() =>
      fold('seed', [{ type: 'time-advanced', seconds: -60, reason: 'nope' }]),
    ).toThrow();
  });
});

describe('a combat round is six seconds', () => {
  const two = (): GameEvent[] => [
    add('fighter'),
    add('goblin'),
    {
      type: 'combat-started',
      combatants: [
        { id: id('fighter'), initiative: 20, speed: 30 },
        { id: id('goblin'), initiative: 5, speed: 30 },
      ],
    },
  ];

  /**
   * Time is not a decision anybody makes, so it is derived rather than
   * commanded: a round ends when the initiative order wraps, and six seconds
   * have passed. A caller that had to remember to advance the clock would
   * eventually forget, and a spell would outlive its duration.
   */
  it('does not advance mid-round', () => {
    const state = fold('seed', [...two(), { type: 'turn-advanced' }]);
    expect(state.combat?.round).toBe(1);
    expect(state.elapsed).toBe(0);
  });

  it('advances when the order wraps', () => {
    const state = fold('seed', [...two(), { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    expect(state.combat?.round).toBe(2);
    expect(state.elapsed).toBe(ROUND);
  });

  it('counts a full minute of combat as ten rounds', () => {
    const log: GameEvent[] = [...two()];
    for (let i = 0; i < 20; i += 1) log.push({ type: 'turn-advanced' });
    const state = fold('seed', log);
    expect(state.combat?.round).toBe(11);
    expect(state.elapsed).toBe(MINUTE);
  });

  it('is the same however the log is folded', () => {
    const log: GameEvent[] = [...two(), { type: 'turn-advanced' }, { type: 'turn-advanced' }];
    expect(fold('seed', log).elapsed).toBe(fold('seed', log).elapsed);
  });
});

describe('elapsed deadlines and turn deadlines are different things', () => {
  /**
   * A round is six seconds, so it is tempting to read "until the start of your
   * next turn" as "six seconds". It is not. Where that moment falls depends on
   * where the anchor sits in the Initiative order and on whose turn the effect
   * began — an effect created on the goblin's turn ends at the wizard's next
   * turn start, which may be one second of game time away or five. And outside
   * combat there are no turns at all, so the question has no answer.
   *
   * Two types rather than one, with a conversion that can refuse, is what keeps
   * the two from being quietly swapped.
   */
  it('refuses a turn deadline outside combat', () => {
    const view = timeView(fold('seed', table()));
    const result = resolveDuration(view, startOfNextTurn(id('wizard')));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_turns');

    expect(isErr(resolveDuration(view, endOfNextTurn(id('wizard'))))).toBe(true);
    // Elapsed time needs no combat.
    expect(isErr(resolveDuration(view, forSeconds(minutes(1))))).toBe(false);
  });

  it('refuses a turn deadline anchored to a creature outside the fight', () => {
    const log: GameEvent[] = [
      ...table(),
      { type: 'combat-started', combatants: [{ id: id('goblin'), initiative: 10, speed: 30 }] },
    ];
    const result = resolveDuration(timeView(fold('seed', log)), startOfNextTurn(id('wizard')));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_in_combat');
  });

  it('reads an elapsed deadline off the clock', () => {
    const state = fold('seed', [...table(), clock(hours(2))]);
    const deadline = unwrap(resolveDuration(timeView(state), forSeconds(minutes(10))), 'd');
    expect(deadline).toEqual({ kind: 'elapsed', at: hours(2) + minutes(10) });
  });

  it('never expires an indefinite duration', () => {
    const state = fold('seed', [...table(), clock(hours(500))]);
    expect(unwrap(resolveDuration(timeView(state), indefinite), 'd')).toEqual({
      kind: 'indefinite',
    });
  });

  it('refuses a duration that is not a whole number of seconds', () => {
    const view = timeView(fold('seed', table()));
    expect(isErr(resolveDuration(view, forSeconds(-1)))).toBe(true);
    expect(isErr(resolveDuration(view, forSeconds(1.5)))).toBe(true);
  });
});

describe('an effect that lasts a span of time', () => {
  const hexed = (seconds: number) =>
    run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a slow venom', [], forSeconds(seconds)),
    );

  it('stands until its moment arrives', () => {
    const { log } = hexed(minutes(1));
    expect(conditionsOf(fold('seed', [...log, clock(minutes(1) - 1)]), 'goblin')).toContain(
      'poisoned',
    );
  });

  it('ends the instant it does', () => {
    const { log } = hexed(minutes(1));
    expect(conditionsOf(fold('seed', [...log, clock(minutes(1))]), 'goblin')).not.toContain(
      'poisoned',
    );
  });

  it('ends when combat carries the clock past it', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a slow venom', [], forSeconds(rounds(2))),
    );
    // Three combatants, so a round is three turns.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).toContain('poisoned');
    expect(conditionsOf(fold('seed', [...log, ...tick(6)]), 'goblin')).not.toContain('poisoned');
  });

  it('leaves an undated effect standing forever', () => {
    const { log } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'blinded', 'a curse'),
    );
    expect(conditionsOf(fold('seed', [...log, clock(hours(500))]), 'goblin')).toContain('blinded');
  });
});

describe('an effect that lasts until a turn', () => {
  /**
   * SRD Dodge: "until the start of your next turn". Created on the wizard's own
   * turn, so it survives everyone else's turns and ends when the wizard's comes
   * round again.
   */
  it('ends at the start of the anchor next turn', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );

    // Goblin's turn, then cleric's: still running.
    expect(conditionsOf(fold('seed', [...log, ...tick(2)]), 'goblin')).toContain('restrained');
    // Back round to the wizard: gone.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).not.toContain('restrained');
  });

  /**
   * SRD Chill Touch: "until the end of your next turn". A full round longer
   * than the start-of-turn version, and the difference is exactly why the two
   * are separate deadlines rather than one with a flag.
   */
  it('ends at the end of the anchor next turn', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], endOfNextTurn(id('wizard'))),
    );

    // The wizard's next turn begins: still running, unlike the start version.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).toContain('restrained');
    // It ends when that turn does.
    expect(conditionsOf(fold('seed', [...log, ...tick(4)]), 'goblin')).not.toContain('restrained');
  });

  /**
   * Anchored to someone else, and created on *their* turn rather than the
   * caster's — a Reaction. "Your next turn" is still the anchor's next turn.
   */
  it('anchors to the creature named, not the one affected', () => {
    const onGoblinTurn = [...fight(), ...tick(1)];
    const { log } = run(onGoblinTurn, (s) =>
      applyConditionTo(s, id('wizard'), 'frightened', 'a shriek', [], startOfNextTurn(id('cleric'))),
    );

    // Cleric acts next; the effect ends as their turn begins.
    expect(conditionsOf(fold('seed', log), 'wizard')).toContain('frightened');
    expect(conditionsOf(fold('seed', [...log, ...tick(1)]), 'wizard')).not.toContain('frightened');
  });

  /**
   * Two effects laid down at the same instant with different anchors end at
   * different moments. Order is wizard, goblin, cleric, and both are created
   * on the wizard's turn: the cleric's next turn is two turns away, the
   * wizard's is a full round.
   */
  it('does not confuse the two anchors', () => {
    const a = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('cleric'))),
    );
    const b = run(a.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a fume', [], startOfNextTurn(id('wizard'))),
    );

    // The cleric's turn comes round first and ends only what it anchors.
    const midway = fold('seed', [...b.log, ...tick(2)]);
    expect(conditionsOf(midway, 'goblin')).not.toContain('restrained');
    expect(conditionsOf(midway, 'goblin')).toContain('poisoned');

    // Then the wizard's, which ends the other.
    expect(conditionsOf(fold('seed', [...b.log, ...tick(3)]), 'goblin')).not.toContain('poisoned');
  });

  /**
   * Turn-anchored timing is combat-scoped: with no turns left there is no
   * moment for the effect to end at, and an effect that can never expire is
   * worse than one that ends when the fight does.
   */
  it('ends when the fight does', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).not.toContain('restrained');
  });

  it('ends when its anchor leaves the fight', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('cleric'))),
    );
    const after = fold('seed', [...log, { type: 'combatant-removed', id: id('cleric') }]);
    expect(conditionsOf(after, 'goblin')).not.toContain('restrained');
  });

  /**
   * A consequence of ending them with the fight, pinned so nobody assumes
   * otherwise: the effect is **gone**, not paused. A second fight does not
   * resume it, because nothing was kept to resume.
   */
  it('does not come back when a new fight starts', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );
    const again = fold('seed', [
      ...log,
      { type: 'combat-ended' },
      {
        type: 'combat-started',
        combatants: [
          { id: id('wizard'), initiative: 20, speed: 30 },
          { id: id('goblin'), initiative: 10, speed: 30 },
        ],
      },
    ]);
    expect(conditionsOf(again, 'goblin')).not.toContain('restrained');
    expect(Object.keys(again.timers)).toHaveLength(0);
  });

  /**
   * And the caller is not stuck with the policy: an effect meant to outlive
   * the fight is expressed in elapsed time, which is what elapsed time is for.
   * The engine does not convert one into the other — that would be inventing a
   * number the rules never gave.
   */
  it('offers elapsed time to anyone who wants the effect to survive', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], forSeconds(minutes(10))),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).toContain('restrained');
  });

  /** An elapsed deadline has nothing to do with the fight and survives it. */
  it('leaves an elapsed deadline alone when combat ends', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).toContain('poisoned');
  });
});

/**
 * **The turn in progress, which is not anybody's *next* turn.**
 *
 * SRD writes "until the end of the current turn" — Stinking Cloud's Poisoned,
 * Superior Hunter's Defense's Resistance, Steady Aim's Advantage — and the
 * engine had no way to say it. `endOfNextTurn` said of the creature whose turn
 * it is resolves **two** turn-endings away, because the turn in progress has
 * not ended yet, which is a full round late. That off-by-a-round is the whole
 * reason this member exists, and the first test below is the one that catches
 * it: both constructors, said in the same instant, a round apart.
 *
 * **It names no anchor**, and that is the member rather than an omission. "The
 * current turn" is a moment in the order, not a fact about a creature — SRD
 * Superior Hunter's Defense is a Reaction to damage taken on somebody *else's*
 * turn, and the turn it ends at is the attacker's. So the anchor is derived at
 * resolution from whoever is taking the turn, and a field naming a creature
 * would be one nothing could read.
 */
describe('an effect that lasts until the end of the turn in progress', () => {
  /**
   * The trap, asserted as arithmetic first. The wizard is up; `ended` does not
   * count the turn in progress, so the current turn's end is one away and "the
   * end of your next turn" is two — a full round further on.
   */
  it('resolves a full round earlier than the end of the anchor next turn', () => {
    const view = timeView(fold('seed', fight()));

    expect(unwrap(resolveDuration(view, endOfCurrentTurn), 'current')).toEqual({
      kind: 'turn-end',
      of: id('wizard'),
      count: 1,
    });
    expect(unwrap(resolveDuration(view, endOfNextTurn(id('wizard'))), 'next')).toEqual({
      kind: 'turn-end',
      of: id('wizard'),
      count: 2,
    });
  });

  /**
   * And the same pair behaviourally, because the arithmetic above is only a
   * claim about two numbers until something folds them. One turn-ending ends
   * the first; the wizard's own next turn has to come round and finish before
   * the second goes.
   */
  it('ends at this turn ending, where the next-turn version lasts a round longer', () => {
    const current = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a fume', [], endOfCurrentTurn),
    );
    const next = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a fume', [], endOfNextTurn(id('wizard'))),
    );

    // The wizard's turn ends: the current-turn version is already gone.
    expect(conditionsOf(fold('seed', [...current.log, ...tick(1)]), 'goblin')).not.toContain(
      'restrained',
    );
    // The other survives the whole round, and the wizard's next turn beginning.
    expect(conditionsOf(fold('seed', [...next.log, ...tick(3)]), 'goblin')).toContain('restrained');
    expect(conditionsOf(fold('seed', [...next.log, ...tick(4)]), 'goblin')).not.toContain(
      'restrained',
    );
  });

  /**
   * Said on somebody else's turn it anchors to **them**, which is the case
   * Superior Hunter's Defense is: a Reaction to damage taken while the goblin
   * is up ends when the goblin's turn does, not when the ranger's next one
   * does.
   */
  it('anchors to whoever is taking the turn, not to whoever asked', () => {
    const onGoblinTurn = [...fight(), ...tick(1)];
    const view = timeView(fold('seed', onGoblinTurn));

    expect(unwrap(resolveDuration(view, endOfCurrentTurn), 'current')).toEqual({
      kind: 'turn-end',
      of: id('goblin'),
      count: 1,
    });

    const { log } = run(onGoblinTurn, (s) =>
      applyConditionTo(s, id('wizard'), 'frightened', 'a shriek', [], endOfCurrentTurn),
    );
    expect(conditionsOf(fold('seed', log), 'wizard')).toContain('frightened');
    // The goblin's turn ends and takes it, a turn before the cleric's begins.
    expect(conditionsOf(fold('seed', [...log, ...tick(1)]), 'wizard')).not.toContain('frightened');
  });

  /**
   * Combat-scoped exactly as its four siblings are. No conversion to seconds,
   * because there is no turn to convert: a round is six seconds only once
   * somebody is taking turns.
   */
  it('refuses outside combat, under the code its siblings use', () => {
    const view = timeView(fold('seed', table()));
    const result = resolveDuration(view, endOfCurrentTurn);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_turns');
  });

  /**
   * And refuses where the fight holds no turn anybody is taking.
   *
   * There is no `of` for a caller to get wrong, so the anchor that can be
   * missing is the combat's own: a turn index pointing at nobody, or a holder
   * with no counts. No public command can build either — `turnCounts` is kept
   * in exact step with `order`, which is the invariant `combat.test.ts` pins —
   * so the fixture is built by hand, which `resolveDuration` being pure over a
   * `TimeView` is what allows. Same move `restoreOn`'s dawn-recovering pool
   * makes for a branch no class can reach: a guard nothing can reach is not a
   * rule, and a pure function will take a fixture that reaches it.
   */
  it('refuses where the combat holds no turn in progress', () => {
    const state = fold('seed', fight());
    const combat = state.combat!;

    const noHolder = resolveDuration({ elapsed: state.elapsed, combat: { ...combat, order: [] } }, endOfCurrentTurn);
    expect(isErr(noHolder)).toBe(true);
    if (isErr(noHolder)) expect(noHolder.code).toBe('not_in_combat');

    const noCounts = resolveDuration(
      { elapsed: state.elapsed, combat: { ...combat, turnCounts: {} } },
      endOfCurrentTurn,
    );
    expect(isErr(noCounts)).toBe(true);
    if (isErr(noCounts)) expect(noCounts.code).toBe('not_in_combat');
  });

  /**
   * It ends with the fight like every other turn-anchored deadline, rather
   * than hanging on a moment that can no longer arrive.
   */
  it('ends when the fight does', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a fume', [], endOfCurrentTurn),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).not.toContain('restrained');
  });
});

describe('expiry ends one effect, not every effect like it', () => {
  /**
   * The point of expiring by instance. Two castings of the same spell on the
   * same target, with different durations: the first to run out takes its own
   * paralysis and leaves the other standing.
   */
  it('expires one casting and leaves the other running', () => {
    const a = run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
      }),
    );
    const b = run(a.log, (s) =>
      castSpell(s, id('cleric'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
      }),
    );

    const ea = run(b.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard'), { duration: forSeconds(minutes(1)) }),
    );
    const eb = run(ea.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('cleric'), { duration: forSeconds(hours(1)) }),
    );

    const after = fold('seed', [...eb.log, clock(minutes(1))]);
    const reasons = after.creatures.goblin!.conditions.instances
      .filter((i) => i.condition === 'paralyzed')
      .map((i) => i.source);

    expect(reasons).toEqual([castingSource('Hold Person', 'cast:2')]);
  });

  it('leaves an unrelated effect on the same creature alone', () => {
    const a = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(minutes(1))),
    );
    const b = run(a.log, (s) => applyConditionTo(s, id('goblin'), 'blinded', 'ash'));

    const after = fold('seed', [...b.log, clock(minutes(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('poisoned');
    expect(conditionsOf(after, 'goblin')).toContain('blinded');
  });

  it('drops what an expiring condition carried with it', () => {
    const { log } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'stunned', 'a bell', [], forSeconds(rounds(1))),
    );
    expect(conditionsOf(fold('seed', log), 'goblin')).toContain('incapacitated');

    const after = fold('seed', [...log, clock(rounds(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('stunned');
    expect(conditionsOf(after, 'goblin')).not.toContain('incapacitated');
  });

  /** Reapplying from the same source refreshes the deadline rather than adding one. */
  it('replaces the deadline when the same effect is reapplied', () => {
    const first = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(rounds(1))),
    );
    const again = run(first.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(hours(1))),
    );

    expect(Object.keys(again.state.timers)).toHaveLength(1);
    expect(conditionsOf(fold('seed', [...again.log, clock(minutes(1))]), 'goblin')).toContain(
      'poisoned',
    );
  });
});

describe('a casting with a maximum duration', () => {
  /** SRD: "Concentration, up to 1 minute" is a cap as well as a Concentration. */
  const held = () =>
    run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );

  it('ends the whole casting when the cap is reached', () => {
    const first = held();
    const effect = run(first.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')),
    );

    const during = fold('seed', [...effect.log, clock(minutes(1) - ROUND)]);
    expect(during.creatures.wizard!.concentration).not.toBeNull();

    const after = fold('seed', [...effect.log, clock(minutes(1))]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(conditionsOf(after, 'goblin')).not.toContain('paralyzed');
  });

  it('forgets the cap once Concentration is broken early', () => {
    const first = held();
    const dropped = run(first.log, (s) => endConcentration(s, id('wizard'), 'voluntary'));
    expect(Object.keys(dropped.state.timers)).toHaveLength(0);
  });
});

describe('a casting nobody is concentrating on', () => {
  /**
   * SRD Blindness/Deafness runs for a minute and needs no Concentration. Its
   * effects still belong to their casting, and the casting still has a moment
   * to stop at — the deadline does the ending that a broken Concentration
   * would otherwise have done.
   */
  it('still ends its effects when its minute runs out', () => {
    const before = fold('seed', table());
    const castingId = nextCastingId(before);

    const cast = run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Blindness/Deafness',
        level: 2,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );
    const blinded = run(cast.log, (s) =>
      applyConditionTo(
        s,
        id('goblin'),
        'blinded',
        castingSource('Blindness/Deafness', castingId),
      ),
    );
    const unrelated = run(blinded.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a bad mushroom'),
    );

    expect(unrelated.state.creatures.wizard!.concentration).toBeNull();
    expect(conditionsOf(unrelated.state, 'goblin')).toContain('blinded');

    const after = fold('seed', [...unrelated.log, clock(minutes(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('blinded');
    expect(conditionsOf(after, 'goblin')).toContain('poisoned');
    expect(Object.keys(after.timers)).toHaveLength(0);
  });
});

describe('durations survive a round trip', () => {
  const played = (): GameEvent[] => {
    const cast = run(fight(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );
    const held = run(cast.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')),
    );
    const dodge = run(held.log, (s) =>
      applyConditionTo(s, id('cleric'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );
    return [...dodge.log, ...tick(1)];
  };

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('survives JSON with its deadlines intact', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(Object.keys(revived.timers).sort()).toEqual(Object.keys(state.timers).sort());
  });

  it('expires correctly after a restore', () => {
    const log = played();
    const restored = JSON.parse(JSON.stringify(log)) as GameEvent[];
    const after = fold('seed', [...restored, ...tick(2), clock(minutes(1))]);

    expect(after.creatures.cleric!.conditions.conditions).not.toContain('restrained');
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(after.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
    expect(Object.keys(after.timers)).toHaveLength(0);
  });

  it('replays prefix by prefix to the same place', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('keeps the timer keys stable however the effects were ordered', () => {
    const a = run(table(), (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)));
    const b = run(a.log, (s) => applyConditionTo(s, id('cleric'), 'blinded', 'ash', [], forSeconds(HOUR)));

    const x = run(table(), (s) => applyConditionTo(s, id('cleric'), 'blinded', 'ash', [], forSeconds(HOUR)));
    const y = run(x.log, (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)));

    expect(JSON.stringify(b.state.timers)).toBe(JSON.stringify(y.state.timers));
  });

  it('names the instance it will end', () => {
    const { state } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)),
    );
    const timer = Object.values(state.timers)[0];
    expect(timer?.target).toEqual({
      kind: 'condition',
      on: id('goblin'),
      instance: conditionInstanceId('poisoned', 'venom'),
    });
  });
});

/**
 * The one place a deadline and a debt read the same moment differently.
 *
 * `hasExpired` answers "is there no moment left for this to end at", and says
 * **yes** once the fight is over or the anchor has gone — deliberately, so
 * that nothing runs forever. A scheduled hit asks a different question, "has
 * the moment arrived", and for it the same circumstance means the moment never
 * will. Reading one answer as the other fires Acid Arrow's second hit at the
 * instant the last enemy drops.
 *
 * `dropStrandedDamage` removes such a schedule from state before anything asks
 * either function, so this branch cannot be reached through the reducer. It is
 * pinned here rather than deleted because the guard is what keeps the ordering
 * of those two passes from becoming load-bearing — and because a mutation that
 * flips it back should fail something.
 */
describe('a deadline that can never arrive', () => {
  const gone: Deadline = { kind: 'turn-end', of: id('ghost'), count: 3 };

  it('has expired, so an effect waiting on it ends', () => {
    expect(hasExpired(timeView(fold('seed', table())), gone)).toBe(true);
  });

  it('is not due, so a debt waiting on it is forgiven rather than collected', () => {
    expect(isDue(timeView(fold('seed', table())), gone)).toBe(false);
  });

  /** In the fight and not yet there: both agree it is neither over nor due. */
  it('agrees with itself while the anchor is still taking turns', () => {
    const log: GameEvent[] = [
      ...table(),
      {
        type: 'combat-started',
        combatants: [
          { id: id('wizard'), initiative: 20, speed: 30 },
          { id: id('goblin'), initiative: 10, speed: 30 },
        ],
      },
    ];
    const view = timeView(fold('seed', log));
    const soon: Deadline = { kind: 'turn-end', of: id('goblin'), count: 2 };

    expect(hasExpired(view, soon)).toBe(false);
    expect(isDue(view, soon)).toBe(false);
  });
});
