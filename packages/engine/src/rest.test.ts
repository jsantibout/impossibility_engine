import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { HOUR, hours, minutes } from './clock.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { castSpell, setExhaustionLevel } from './commands.js';
import {
  LONG_REST,
  LONG_REST_COOLDOWN,
  SHORT_REST,
  beginRest,
  endRest,
  hitDieKey,
  hitDieSides,
  restEarned,
  type RestResolution,
  type RestState,
} from './rest.js';

const id = (s: string) => asCharacterId(s);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const add = (name: string, maxHp: number): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
});

const pool = (who: string, key: string, label: string, max: number, recovers: 'short-rest' | 'long-rest'): GameEvent => ({
  type: 'resource-pool-declared',
  id: id(who),
  pool: { key, label, max, recovers },
});

/**
 * A level 5 wizard: 5d6 Hit Dice, two level 1 slots, one level 2, and a
 * short-rest feature. Every one of those is a declared pool — the engine does
 * not own the class table that says a Wizard gets d6s.
 */
const party = (): GameEvent[] => [
  add('wizard', 30),
  add('fighter', 50),
  pool('wizard', hitDieKey(6), 'Hit Die (d6)', 5, 'long-rest'),
  pool('wizard', spellSlotKey(1), 'level 1 spell slot', 2, 'long-rest'),
  pool('wizard', spellSlotKey(2), 'level 2 spell slot', 1, 'long-rest'),
  pool('wizard', 'arcane-recovery', 'Arcane Recovery', 1, 'short-rest'),
  pool('fighter', hitDieKey(10), 'Hit Die (d10)', 5, 'long-rest'),
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

const resolve = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<RestResolution>,
): { log: GameEvent[]; state: GameState; result: RestResolution } => {
  const result = unwrap(command(fold('seed', log)), 'rest');
  const next = [...log, ...result.events];
  return { log: next, state: fold('seed', next), result };
};

const roller = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
});

const clock = (seconds: number, reason = 'resting'): GameEvent => ({
  type: 'time-advanced',
  seconds,
  reason,
});

const hurt = (who: string, amount: number): GameEvent => ({
  type: 'damage-taken',
  id: id(who),
  amount,
});

describe('Hit Dice are just another pool', () => {
  it('round-trips a die size', () => {
    for (const sides of [4, 6, 8, 10, 12, 20]) {
      expect(hitDieSides(hitDieKey(sides))).toBe(sides);
    }
  });

  it('refuses a die the game does not use', () => {
    expect(() => hitDieKey(7)).toThrow();
    expect(() => hitDieKey(0)).toThrow();
    expect(hitDieSides(spellSlotKey(1))).toBeNull();
  });
});

describe('what a rest earns', () => {
  /** SRD: a Short Rest is 1 hour; a Long Rest is at least 8 hours. */
  it('knows how long each one takes', () => {
    expect(SHORT_REST).toBe(HOUR);
    expect(LONG_REST).toBe(hours(8));
    expect(LONG_REST_COOLDOWN).toBe(hours(16));
  });

  const rest = (kind: 'short' | 'long'): RestState => ({
    kind,
    startedAt: 0,
    interruptedBy: null,
    interruptedAt: null,
  });

  /** Broken at a given moment, which is what the payout is measured from. */
  const brokenAt = (kind: 'short' | 'long', at: number): RestState => ({
    ...rest(kind),
    interruptedBy: 'an ambush',
    interruptedAt: at,
  });

  it('grants the rest that was actually completed', () => {
    expect(restEarned(rest('short'), SHORT_REST)).toBe('short');
    expect(restEarned(rest('long'), LONG_REST)).toBe('long');
  });

  /** SRD: "An interrupted Short Rest confers no benefits." */
  it('gives an interrupted Short Rest nothing at all', () => {
    expect(restEarned(brokenAt('short', SHORT_REST), SHORT_REST)).toBe('none');
    expect(restEarned(brokenAt('short', minutes(59)), minutes(59))).toBe('none');
  });

  /**
   * SRD: "If you rested at least 1 hour before the interruption, you gain the
   * benefits of a Short Rest." An interrupted Long Rest is not simply wasted.
   */
  it('downgrades a broken Long Rest to a Short one, past the hour', () => {
    expect(restEarned(brokenAt('long', hours(3)), hours(3))).toBe('short');
    expect(restEarned(brokenAt('long', HOUR), HOUR)).toBe('short');
    expect(restEarned(brokenAt('long', minutes(59)), minutes(59))).toBe('none');

    // And waiting afterwards adds nothing: the rest ended when it broke.
    expect(restEarned(brokenAt('long', minutes(59)), hours(9))).toBe('none');
    expect(restEarned(brokenAt('long', HOUR), hours(9))).toBe('short');
  });
});

describe('taking a Short Rest', () => {
  const started = () => run(party(), (s) => beginRest(s, id('wizard'), 'short'));

  it('records that the rest began, and when', () => {
    const { state } = started();
    expect(state.creatures.wizard!.resting).toEqual({
      kind: 'short',
      startedAt: 0,
      interruptedBy: null,
      interruptedAt: null,
    });
  });

  /** SRD: "To start a Short Rest, you must have at least 1 Hit Point." */
  it('refuses to start at zero hit points', () => {
    const down = fold('seed', [...party(), hurt('wizard', 30)]);
    const result = beginRest(down, id('wizard'), 'short');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_hit_points');
  });

  it('refuses to start a second rest on top of the first', () => {
    expect(isErr(beginRest(started().state, id('wizard'), 'short'))).toBe(true);
  });

  it('refuses to end a rest that has not run its hour', () => {
    const log = [...started().log, clock(minutes(59))];
    const result = endRest(fold('seed', log), id('wizard'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('rest_incomplete');
  });

  it('recharges short-rest features and leaves the slots alone', () => {
    const spent = run(started().log, (s) =>
      castSpell(s, id('wizard'), { spell: 'Shield', level: 1, slotLevel: 1 }),
    );
    // Casting a spell interrupts the rest, so start a clean one.
    const fresh = run([...spent.log, { type: 'rest-ended', id: id('wizard'), kind: 'short', benefit: 'none' }], (s) =>
      beginRest(s, id('wizard'), 'short'),
    );
    const { state } = resolve([...fresh.log, clock(HOUR)], (s) => endRest(s, id('wizard')));

    expect(remaining(state.creatures.wizard!.resources, 'arcane-recovery')).toBe(1);
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(1))).toBe(1);
    expect(state.creatures.wizard!.resting).toBeNull();
  });

  /**
   * SRD: "For each Hit Point Die you spend in this way, roll the die and add
   * your Constitution modifier to it. You regain Hit Points equal to the total
   * (minimum of 1 Hit Point)."
   */
  it('spends Hit Dice to heal, adding Constitution to each', () => {
    const log = [...party(), hurt('wizard', 20)];
    const rested = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);

    const { state, result } = resolve([...rested.log, clock(HOUR)], (s) =>
      endRest(s, id('wizard'), { hitDice: [hitDieKey(6), hitDieKey(6)] }, roller(start)),
    );

    expect(result.hitDice).toHaveLength(2);
    // d6 + Constitution 2, twice: between 6 and 16, and never below the minimum.
    for (const die of result.hitDice) {
      expect(die.regained).toBeGreaterThanOrEqual(1);
      expect(die.regained).toBe(die.natural + 2);
    }
    expect(result.hitPointsRegained).toBe(result.hitDice.reduce((n, d) => n + d.regained, 0));
    expect(state.creatures.wizard!.vitals.hp).toBe(10 + result.hitPointsRegained);
    expect(remaining(state.creatures.wizard!.resources, hitDieKey(6))).toBe(3);
  });

  it('records each Hit Die roll in the log', () => {
    const log = [...party(), hurt('wizard', 20)];
    const rested = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    const { result } = resolve([...rested.log, clock(HOUR)], (s) =>
      endRest(s, id('wizard'), { hitDice: [hitDieKey(6)] }, roller(start)),
    );

    const recorded = result.events.find((e) => e.type === 'roll-recorded');
    expect(recorded).toMatchObject({ who: id('wizard'), label: 'Hit Die (d6)' });
    expect(result.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
  });

  /** Validate every die before rolling any, so a bad request costs nothing. */
  it('refuses more Hit Dice than are left, rolling none of them', () => {
    const log = [...party(), hurt('wizard', 20)];
    const rested = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    const supply = roller(start);

    const result = endRest(start, id('wizard'), { hitDice: Array(6).fill(hitDieKey(6)) }, supply);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_enough_hit_dice');
    expect(supply.issuer.count).toBe(0);
  });

  it('refuses a Hit Die pool the creature does not have', () => {
    const rested = run(party(), (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    expect(
      isErr(endRest(start, id('wizard'), { hitDice: [hitDieKey(10)] }, roller(start))),
    ).toBe(true);
  });

  it('needs a generator to spend a die at all', () => {
    const rested = run(party(), (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    const result = endRest(start, id('wizard'), { hitDice: [hitDieKey(6)] });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_generator');
  });

  it('heals no further than the maximum', () => {
    const log = [...party(), hurt('wizard', 2)];
    const rested = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    const { state } = resolve([...rested.log, clock(HOUR)], (s) =>
      endRest(s, id('wizard'), { hitDice: [hitDieKey(6), hitDieKey(6)] }, roller(start)),
    );
    expect(state.creatures.wizard!.vitals.hp).toBe(30);
  });
});

describe('taking a Long Rest', () => {
  const spent = (): GameEvent[] => {
    const cast = run(party(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Hold Person', level: 2, slotLevel: 2 }),
    );
    const tired = run(cast.log, (s) => setExhaustionLevel(s, id('wizard'), 3));
    return [...tired.log, hurt('wizard', 18), clock(hours(20), 'the day')];
  };

  const full = () => {
    const begun = run(spent(), (s) => beginRest(s, id('wizard'), 'long'));
    return resolve([...begun.log, clock(LONG_REST)], (s) => endRest(s, id('wizard')));
  };

  /** SRD: "You regain all lost Hit Points and all spent Hit Point Dice." */
  it('restores every hit point', () => {
    expect(full().state.creatures.wizard!.vitals.hp).toBe(30);
  });

  /**
   * 2024 restores **all** spent Hit Point Dice. 2014 restored half, minimum
   * one, and that is the version most tables still have in their heads.
   */
  it('restores every Hit Die, not half of them', () => {
    const log = [...spent()];
    const rested = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const start = fold('seed', [...rested.log, clock(HOUR)]);
    const short = resolve([...rested.log, clock(HOUR)], (s) =>
      endRest(s, id('wizard'), { hitDice: [hitDieKey(6), hitDieKey(6)] }, roller(start)),
    );
    expect(remaining(short.state.creatures.wizard!.resources, hitDieKey(6))).toBe(3);

    const begun = run([...short.log, clock(hours(20))], (s) => beginRest(s, id('wizard'), 'long'));
    const long = resolve([...begun.log, clock(LONG_REST)], (s) => endRest(s, id('wizard')));
    expect(remaining(long.state.creatures.wizard!.resources, hitDieKey(6))).toBe(5);
  });

  it('restores spell slots and short-rest features alike', () => {
    const { state } = full();
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(2))).toBe(1);
    expect(remaining(state.creatures.wizard!.resources, 'arcane-recovery')).toBe(1);
  });

  /** SRD: "If you have the Exhaustion condition, its level decreases by 1." */
  it('takes one level off Exhaustion, not all of it', () => {
    expect(full().state.creatures.wizard!.conditions.exhaustion).toBe(2);
  });

  it('leaves a creature with no Exhaustion alone', () => {
    const begun = run(party(), (s) => beginRest(s, id('fighter'), 'long'));
    const { state } = resolve([...begun.log, clock(LONG_REST)], (s) => endRest(s, id('fighter')));
    expect(state.creatures.fighter!.conditions.exhaustion).toBe(0);
  });

  /** SRD: "you must wait at least 16 hours before starting another one." */
  it('refuses a second Long Rest inside sixteen hours', () => {
    const done = full();
    const tooSoon = beginRest(fold('seed', [...done.log, clock(hours(15))]), id('wizard'), 'long');
    expect(isErr(tooSoon)).toBe(true);
    if (isErr(tooSoon)) expect(tooSoon.code).toBe('too_soon');

    const later = beginRest(fold('seed', [...done.log, clock(hours(16))]), id('wizard'), 'long');
    expect(isErr(later)).toBe(false);
  });

  it('does not stop a Short Rest inside those sixteen hours', () => {
    const done = full();
    expect(
      isErr(beginRest(fold('seed', [...done.log, clock(HOUR)]), id('wizard'), 'short')),
    ).toBe(false);
  });

  it('refuses hit dice on a completed Long Rest, which has already restored them', () => {
    const begun = run(spent(), (s) => beginRest(s, id('wizard'), 'long'));
    const start = fold('seed', [...begun.log, clock(LONG_REST)]);
    const result = endRest(start, id('wizard'), { hitDice: [hitDieKey(6)] }, roller(start));
    expect(isErr(result)).toBe(true);
  });
});

describe('the engine notices a rest being interrupted', () => {
  /**
   * SRD lists three interruptions the engine can actually see: rolling
   * Initiative, casting a spell other than a cantrip, and taking any damage.
   * A caller who had to report these would eventually forget one, and the
   * party would get a rest the rules had already broken — so the reducer marks
   * the rest itself, and ending it reads the mark rather than the caller.
   */
  const resting = () => run(party(), (s) => beginRest(s, id('wizard'), 'long'));

  it('marks a rest broken by damage', () => {
    const state = fold('seed', [...resting().log, clock(hours(2)), hurt('wizard', 4)]);
    expect(state.creatures.wizard!.resting?.interruptedBy).toBe('damage');
  });

  it('marks a rest broken by casting a spell', () => {
    const cast = run(resting().log, (s) =>
      castSpell(s, id('wizard'), { spell: 'Shield', level: 1, slotLevel: 1 }),
    );
    expect(cast.state.creatures.wizard!.resting?.interruptedBy).toBe('a spell');
  });

  /** A cantrip is not "a spell other than a cantrip", so it does not break it. */
  it('leaves a rest alone for a cantrip', () => {
    const cast = run(resting().log, (s) =>
      castSpell(s, id('wizard'), { spell: 'Fire Bolt', level: 0, slotless: 'cantrip' }),
    );
    expect(cast.state.creatures.wizard!.resting?.interruptedBy).toBeNull();
  });

  it('marks a rest broken by rolling Initiative', () => {
    const state = fold('seed', [
      ...resting().log,
      {
        type: 'combat-started',
        combatants: [
          { id: id('wizard'), initiative: 12, speed: 30 },
          { id: id('fighter'), initiative: 9, speed: 30 },
        ],
      },
    ]);
    expect(state.creatures.wizard!.resting?.interruptedBy).toBe('Initiative');
  });

  it('leaves a resting creature outside the fight alone', () => {
    const both = run(resting().log, (s) => beginRest(s, id('fighter'), 'long'));
    const state = fold('seed', [
      ...both.log,
      { type: 'combat-started', combatants: [{ id: id('fighter'), initiative: 9, speed: 30 }] },
    ]);
    expect(state.creatures.wizard!.resting?.interruptedBy).toBeNull();
    expect(state.creatures.fighter!.resting?.interruptedBy).toBe('Initiative');
  });

  /** The first interruption is the one that broke it; later ones change nothing. */
  it('keeps the first cause', () => {
    const state = fold('seed', [
      ...resting().log,
      hurt('wizard', 4),
      hurt('wizard', 4),
    ]);
    expect(state.creatures.wizard!.resting?.interruptedBy).toBe('damage');
  });

  it('ends a broken Long Rest as a Short one, without waiting out the eight hours', () => {
    const log = [...party(), hurt('wizard', 20)];
    const begun = run(log, (s) => beginRest(s, id('wizard'), 'long'));
    const broken = [...begun.log, clock(hours(3)), hurt('wizard', 1)];
    const start = fold('seed', broken);

    const { state, result } = resolve(broken, (s) =>
      endRest(s, id('wizard'), { hitDice: [hitDieKey(6)] }, roller(start)),
    );

    expect(result.benefit).toBe('short');
    expect(state.creatures.wizard!.resting).toBeNull();
    // A Short Rest heals only what the dice gave, nowhere near full.
    expect(state.creatures.wizard!.vitals.hp).toBeLessThan(30);
    expect(state.creatures.wizard!.vitals.hp).toBe(9 + result.hitPointsRegained);
    // And it is still a Short Rest, so the slots stay spent and no cooldown starts.
    expect(state.creatures.wizard!.lastLongRestAt).toBeNull();
  });

  it('gives an interrupted Short Rest nothing, and says so', () => {
    const log = [...party(), hurt('wizard', 20)];
    const begun = run(log, (s) => beginRest(s, id('wizard'), 'short'));
    const broken = [...begun.log, clock(minutes(30)), hurt('wizard', 1)];

    const { state, result } = resolve(broken, (s) => endRest(s, id('wizard')));
    expect(result.benefit).toBe('none');
    expect(result.hitPointsRegained).toBe(0);
    expect(state.creatures.wizard!.vitals.hp).toBe(9);
    expect(state.creatures.wizard!.resting).toBeNull();
  });

  it('refuses hit dice when the interruption earned nothing', () => {
    const begun = run(party(), (s) => beginRest(s, id('wizard'), 'short'));
    const broken = [...begun.log, clock(minutes(30)), hurt('wizard', 1)];
    const start = fold('seed', broken);
    expect(isErr(endRest(start, id('wizard'), { hitDice: [hitDieKey(6)] }, roller(start)))).toBe(
      true,
    );
  });

  /** A caller can still report what the engine cannot see. */
  it('takes an interruption the engine has no way to notice', () => {
    const begun = run(party(), (s) => beginRest(s, id('wizard'), 'long'));
    const { result } = resolve([...begun.log, clock(hours(4))], (s) =>
      endRest(s, id('wizard'), { interrupted: 'an hour of hard walking' }),
    );
    expect(result.benefit).toBe('short');
  });
});

describe('resting is replayable', () => {
  const played = (): GameEvent[] => {
    const log = [...party(), hurt('wizard', 20), clock(hours(20))];
    const begun = run(log, (s) => beginRest(s, id('wizard'), 'long'));
    const start = fold('seed', [...begun.log, clock(LONG_REST)]);
    const ended = resolve([...begun.log, clock(LONG_REST)], (s) =>
      endRest(s, id('wizard'), {}, roller(start)),
    );
    return ended.log;
  };

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('survives JSON, clock and all', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(revived.elapsed).toBe(hours(20) + LONG_REST);
    expect(revived.creatures.wizard!.lastLongRestAt).toBe(hours(20) + LONG_REST);
  });

  it('refuses to end a rest nobody is taking', () => {
    const result = endRest(fold('seed', party()), id('wizard'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_resting');
  });

  it('is a no-op when a rest command is retried', () => {
    const begun = run(party(), (s) => beginRest(s, id('wizard'), 'short', 'rest-1'));
    expect(unwrap(beginRest(begun.state, id('wizard'), 'short', 'rest-1'), 'retry')).toEqual([]);
  });
});
