import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { HOUR, hours, minutes } from './clock.js';
import { forSeconds, timerKey, type EffectTarget } from './duration.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { grantTemporaryHpTo } from './commands.js';
import { schedule } from './commands/conditions.js';
import { beginRest, endRest } from './rest.js';

/**
 * Temporary Hit Points have a lifetime.
 *
 * The owner's ruling, 2026-09-18: **if the effect that granted them does not
 * state a duration, Temporary Hit Points last until they run out or until the
 * creature holding them finishes a Long Rest, whichever comes first. An effect
 * that states a duration — the hour Potion of Heroism prints — overrides the
 * default.**
 *
 * The route is an {@link EffectTarget} naming the pool, so the ordinary timer
 * machinery expires it the way it expires a condition, a grant or a casting.
 * Nothing new is written for the expiry itself: a deadline arriving is not a
 * decision anybody makes.
 *
 * Four things this file is here to pin, and each of them is a way the rule can
 * be honoured in the easy case and broken in the real one:
 *
 * - the deadline finds **whatever is left**, which may be nothing, and taking
 *   nothing away is as quiet as taking ten;
 * - a second grant that actually replaces the pool takes the old deadline with
 *   it, because a timer left standing over a pool that has gone is the failure
 *   `removed-condition-timers.test.ts` records for conditions;
 * - a second grant the creature does **not** take — SRD keeps the larger pool
 *   — leaves the old deadline exactly where it was, because the points it was
 *   hung on are still the points being held;
 * - a Long Rest clears them whether or not a deadline was ever hung, and takes
 *   any deadline with it.
 */

const SEED = 'temp-hp';
const id = (s: string) => asCharacterId(s);
const HERO = id('hero');
const OTHER = id('other');

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

const add = (who: CharacterId, maxHp = 30): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
});

/**
 * Time passing, and damage landing, as recorded facts.
 *
 * Both are written straight into the log rather than commanded: what the rule
 * under test needs is a clock reading and a pool with a hole in it, and
 * neither the amount nor the moment is the engine's to roll.
 */
const wait = (seconds: number, reason = 'the party walks'): GameEvent => ({
  type: 'time-advanced',
  seconds,
  reason,
});
const hurt = (amount: number, who: CharacterId = HERO): GameEvent => ({
  type: 'damage-taken',
  id: who,
  amount,
  source: 'the fixture',
});

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);
const vitalsOf = (state: GameState, who: CharacterId = HERO) => {
  const creature = state.creatures[who];
  if (creature === undefined) throw new Error(`${who} is not in this game`);
  return creature.vitals;
};

/** The pool, as an effect a deadline can be hung on. */
const pool = (who: CharacterId = HERO): EffectTarget => ({
  kind: 'temporary-hit-points',
  on: who,
});
const deadlineOn = (state: GameState, who: CharacterId = HERO) =>
  state.timers[timerKey(pool(who))];

/** Grant Temporary Hit Points through the one door that grants them. */
const grant = (log: readonly GameEvent[], amount: number): GameEvent[] => [
  ...log,
  ...unwrap(grantTemporaryHpTo(at(log), HERO, amount), 'grant'),
];

/** Hang a deadline on the pool, through the same door every other timer uses. */
const lasting = (log: readonly GameEvent[], seconds: number): GameEvent[] => [
  ...log,
  unwrap(schedule(at(log), pool(), forSeconds(seconds)), 'schedule'),
];

/** A completed Long Rest: begun, eight hours, ended. */
const longRest = (log: readonly GameEvent[]): GameEvent[] => {
  const begun = [...log, ...unwrap(beginRest(at(log), HERO, 'long'), 'beginRest')];
  const waited = [...begun, wait(hours(8), 'a night of sleep')];
  return [...waited, ...unwrap(endRest(at(waited), HERO), 'endRest').events];
};

describe('the default lifetime: until spent, or until a Long Rest', () => {
  it('holds the points up to the moment the rest finishes, and not past it', () => {
    const granted = grant([add(HERO)], 10);
    expect(vitalsOf(at(granted)).temporaryHp).toBe(10);

    // Eight hours of anything else does not touch them: the default lifetime
    // is the rest, not the clock.
    const slept = longRest(granted);
    expect(vitalsOf(at([...granted, wait(hours(8))])).temporaryHp).toBe(10);
    expect(vitalsOf(at(slept)).temporaryHp).toBe(0);
  });

  it('never hangs a deadline of its own, so nothing is waiting on the clock', () => {
    const granted = grant([add(HERO)], 10);
    expect(deadlineOn(at(granted))).toBeUndefined();
  });
});

describe('a stated duration overrides the default', () => {
  const ward = (): GameEvent[] => lasting(grant([add(HERO)], 10), HOUR);

  it('still holds them a second before the hour is up', () => {
    const almost = [...ward(), wait(HOUR - 1)];
    expect(vitalsOf(at(almost)).temporaryHp).toBe(10);
    expect(deadlineOn(at(almost))).toBeDefined();
  });

  it('takes them at the deadline, with the clock advanced to it', () => {
    const due = [...ward(), wait(HOUR)];
    expect(vitalsOf(at(due)).temporaryHp).toBe(0);
    expect(deadlineOn(at(due))).toBeUndefined();
  });

  it('takes only the pool, and leaves the hit points it was sitting beside', () => {
    const due = [...ward(), hurt(4), wait(HOUR)];
    // Four of the ten soaked; the hit points were never touched and the
    // deadline is not a second helping of damage.
    expect(vitalsOf(at(due))).toMatchObject({ hp: 30, temporaryHp: 0, dead: false });
  });
});

describe('a deadline that arrives on an empty pool', () => {
  /**
   * Spent to nothing before the hour, the deadline still arrives — and
   * removing none has to be exactly as quiet as removing some. The creature's
   * whole record is compared across the moment, so a "clear" that reset a
   * death save, revived a corpse or moved a hit point would be caught.
   */
  it('changes nothing, and says nothing', () => {
    const spent = [...lasting(grant([add(HERO)], 10), HOUR), hurt(10), wait(HOUR - 1)];
    const before = at(spent);
    expect(vitalsOf(before).temporaryHp).toBe(0);
    expect(deadlineOn(before)).toBeDefined();

    const after = at([...spent, wait(1)]);
    expect(JSON.stringify(after.creatures)).toBe(JSON.stringify(before.creatures));
    expect(deadlineOn(after)).toBeUndefined();
  });

  it('arrives the same way for a creature who has already died', () => {
    const dead = [...lasting(grant([add(HERO)], 10), HOUR), hurt(10), hurt(30), hurt(30)];
    const before = at(dead);
    expect(vitalsOf(before).dead).toBe(true);

    const after = at([...dead, wait(HOUR)]);
    expect(JSON.stringify(after.creatures)).toBe(JSON.stringify(before.creatures));
    expect(deadlineOn(after)).toBeUndefined();
  });
});

describe('a second grant and the standing deadline', () => {
  /**
   * SRD: Temporary Hit Points do not stack — "you choose whether to keep the
   * ones you have or gain the new ones", and the engine keeps the larger. A
   * larger second grant is therefore a **new pool**, and the hour hung on the
   * pool that went must not come due against the one that replaced it.
   */
  it('takes the old deadline with the pool it replaces', () => {
    const first = lasting(grant([add(HERO)], 10), HOUR);
    const second = grant([...first, wait(minutes(30))], 12);

    expect(vitalsOf(at(second)).temporaryHp).toBe(12);
    expect(deadlineOn(at(second))).toBeUndefined();

    // The hour the first grant printed comes and goes, and finds nothing of
    // its own to end.
    const later = [...second, wait(hours(2))];
    expect(vitalsOf(at(later)).temporaryHp).toBe(12);
  });

  /**
   * And the other way round: a smaller grant is refused by the pool itself —
   * the ten stay — so the hour on those ten is still the hour on the points
   * being held, and dropping it would give them a lifetime nobody granted.
   */
  it('leaves the deadline standing when the new points are not taken', () => {
    const first = lasting(grant([add(HERO)], 10), HOUR);
    const second = grant([...first, wait(minutes(30))], 4);

    expect(vitalsOf(at(second)).temporaryHp).toBe(10);
    expect(deadlineOn(at(second))).toBeDefined();
    expect(vitalsOf(at([...second, wait(minutes(30))])).temporaryHp).toBe(0);
  });

  it('files one deadline per creature, so one hero’s hour is not another’s', () => {
    expect(timerKey(pool(HERO))).not.toBe(timerKey(pool(OTHER)));

    const hero = grant([add(HERO), add(OTHER)], 10);
    const both = [...hero, ...unwrap(grantTemporaryHpTo(at(hero), OTHER, 7), 'grant')];

    // The hour is the hero's alone.
    const due = at([...lasting(both, HOUR), wait(HOUR)]);
    expect(vitalsOf(due, HERO).temporaryHp).toBe(0);
    expect(vitalsOf(due, OTHER).temporaryHp).toBe(7);
  });
});

describe('a Long Rest ends them however they were granted', () => {
  it('clears the pool and drops the deadline hung on it', () => {
    const rested = longRest(lasting(grant([add(HERO)], 10), hours(24)));
    expect(vitalsOf(at(rested)).temporaryHp).toBe(0);
    expect(deadlineOn(at(rested))).toBeUndefined();
  });

  /**
   * And with the pool already spent, the deadline goes anyway. A rest that
   * left it standing would leave a timer over a pool that no longer exists —
   * the same dangling deadline a replacement grant is careful not to leave.
   */
  it('drops a deadline whose pool was already spent', () => {
    const rested = longRest([...lasting(grant([add(HERO)], 10), hours(24)), hurt(10)]);
    expect(vitalsOf(at(rested)).temporaryHp).toBe(0);
    expect(deadlineOn(at(rested))).toBeUndefined();
  });
});

describe('what a lifetime must not change', () => {
  /**
   * The regression that matters. Every rule about what Temporary Hit Points do
   * to damage is `applyDamageToVitals`'s and none of it moves: the pool is
   * spent first, a blow the pool soaks entirely still costs a death saving
   * throw at 0 hit points, and damage measured against the maximum is the
   * damage dealt rather than what got through.
   *
   * Asserted as a **comparison** rather than a list of numbers: the same
   * damage, once with a deadline hung over the pool and once without, folds to
   * the same creature.
   */
  const granted = (): GameEvent[] => grant([add(HERO)], 10);
  /** Ten soaked and thirty through, then two blows at 0 hit points. */
  const blows = [hurt(40), hurt(3), hurt(2)];

  it('spends the pool, drops the creature and counts the failures as it always did', () => {
    const plain = at([...granted(), ...blows]);
    expect(vitalsOf(plain)).toMatchObject({
      hp: 0,
      temporaryHp: 0,
      deathSaveFailures: 2,
      dead: false,
    });

    const warded = at([...lasting(granted(), HOUR), ...blows]);
    expect(JSON.stringify(vitalsOf(warded))).toBe(JSON.stringify(vitalsOf(plain)));
  });

  it('kills on damage at 0 hit points equalling the maximum, pool or no pool', () => {
    const killed = at([...granted(), hurt(40), hurt(30)]);
    expect(vitalsOf(killed)).toMatchObject({ dead: true, temporaryHp: 0 });

    const warded = at([...lasting(granted(), HOUR), hurt(40), hurt(30)]);
    expect(JSON.stringify(vitalsOf(warded))).toBe(JSON.stringify(vitalsOf(killed)));
  });
});

describe('the log', () => {
  /**
   * A log that grants, damages and expires folds to the same bytes twice.
   * Expiry is derived, so a pass that ordered its work by anything other than
   * the log would show up here and nowhere else.
   */
  it('folds twice to a byte-identical state', () => {
    const warded = lasting(grant([add(HERO), add(OTHER)], 10), HOUR);
    const hit = [...warded, hurt(3), wait(minutes(30))];
    const both = [...hit, ...unwrap(grantTemporaryHpTo(at(hit), OTHER, 5), 'grant')];
    const played = [...both, hurt(2), wait(HOUR)];
    expect(JSON.stringify(fold(SEED, played))).toBe(JSON.stringify(fold(SEED, played)));
    expect(JSON.stringify(fold(SEED, played))).toBe(
      JSON.stringify(fold(SEED, JSON.parse(JSON.stringify(played)) as GameEvent[])),
    );
  });
});
