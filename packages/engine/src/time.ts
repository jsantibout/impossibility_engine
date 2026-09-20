/**
 * Time: the clock, and how long a thing lasts.
 *
 * Elapsed time first, because everything here is measured against it. The game
 * measures duration in four units and they nest exactly: SRD, "A round
 * represents about 6 seconds in the game world", ten rounds to the minute,
 * sixty minutes to the hour. Seconds is the finest of them, so every duration
 * the rules name is a whole number of them and nothing ever lands between two
 * rounds.
 *
 * One clock, counting up from the start of the campaign. There is no calendar
 * and no time of day: those are fiction, and the DM owns them. What the engine
 * needs is the ability to answer "how long since", which is subtraction — the
 * sixteen hours between Long Rests, the hour that turns a broken Long Rest
 * into a Short one.
 *
 * Then the two shapes of "how long", which is the substance of this file and
 * is documented over {@link Duration} below. **What is *not* here is what a
 * deadline is hung on**: a condition, a casting, a debt a turn boundary
 * raises. Those are `timers.ts`, and the split is the same one the clock and
 * the duration make — this file answers *when*, and nothing in it knows what
 * an effect is.
 */
import { err, ok, type CharacterId, type Result } from '@ie/shared';
import type { CombatState, TurnCount } from './combat.js';

/** SRD: "A round represents about 6 seconds in the game world." */
export const ROUND = 6;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;

function whole(n: number, unit: string): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`a duration in ${unit} must be a non-negative integer, got ${n}`);
  }
  return n;
}

export const rounds = (n: number): number => whole(n, 'rounds') * ROUND;
export const minutes = (n: number): number => whole(n, 'minutes') * MINUTE;
export const hours = (n: number): number => whole(n, 'hours') * HOUR;
export const days = (n: number): number => whole(n, 'days') * DAY;

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Say a span in the largest unit it fills exactly, for the log.
 *
 * Deliberately coarse: a DM says "about an hour", never "3,600 seconds", and
 * a span that does not divide evenly reports the unit below it rather than
 * inventing a fraction the game has no notion of.
 */
export function describeElapsed(seconds: number): string {
  if (seconds <= 0) return 'no time';
  if (seconds % DAY === 0) return plural(seconds / DAY, 'day');
  if (seconds % HOUR === 0) return plural(seconds / HOUR, 'hour');
  if (seconds % MINUTE === 0) return plural(seconds / MINUTE, 'minute');
  if (seconds % ROUND === 0) return plural(seconds / ROUND, 'round');
  return plural(seconds, 'second');
}

/**
 * How long an effect lasts, and when it stops.
 *
 * The SRD writes durations two ways, and they are **not** interchangeable:
 *
 * | | |
 * |---|---|
 * | A span of time | "1 minute", "8 hours", "10 days" |
 * | A moment in the turn order | "until the start of your next turn", "until the end of your next turn" |
 *
 * It is tempting to fold the second into the first, since a round is six
 * seconds. That is wrong. Where "the start of your next turn" falls depends on
 * where the anchor sits in the Initiative order and on whose turn the effect
 * began — anything from the very next moment to a full round away. Outside
 * combat it has no meaning at all, because there are no turns.
 *
 * So there are two types. {@link Duration} is what a caller asks for, relative
 * and possibly impossible; {@link Deadline} is what the log records, absolute
 * and already resolved. {@link resolveDuration} is the one conversion between
 * them, and it can refuse — which is what keeps the two from being silently
 * swapped.
 */

/** What a caller asks for. Relative, and not always answerable. */
export type Duration =
  | { readonly kind: 'seconds'; readonly seconds: number }
  | { readonly kind: 'start-of-next-turn'; readonly of: CharacterId }
  | { readonly kind: 'end-of-next-turn'; readonly of: CharacterId }
  /**
   * The turn **in progress** ending — SRD's "until the end of the current
   * turn", which is not anybody's *next* turn.
   *
   * `end-of-next-turn` said of the creature whose turn it is resolves **two**
   * turn-endings away, because the turn in progress has not ended yet; that is
   * a full round late for this sentence. Three SRD consumers write it —
   * Stinking Cloud's Poisoned, Superior Hunter's Defense's Resistance, Steady
   * Aim's Advantage — and none of them could be said before this member.
   *
   * **It names no anchor, and that is the member rather than an omission.**
   * "The current turn" is a moment in the order, not a fact about a creature:
   * Superior Hunter's Defense is a Reaction to damage taken on somebody
   * *else's* turn, and the turn it ends at is the attacker's. So the anchor is
   * derived at resolution from whoever is taking the turn, and an `of` field
   * naming a creature would be one no reader could honestly use — the
   * speculative member this repository's sweeps exist to refuse.
   */
  | { readonly kind: 'end-of-current-turn' }
  | { readonly kind: 'indefinite' };

/** What the log records. Absolute, and always answerable. */
export type Deadline =
  | { readonly kind: 'elapsed'; readonly at: number }
  /** Fires when the anchor has begun this many turns. */
  | { readonly kind: 'turn-start'; readonly of: CharacterId; readonly count: number }
  /** Fires when the anchor has ended this many turns. */
  | { readonly kind: 'turn-end'; readonly of: CharacterId; readonly count: number }
  | { readonly kind: 'indefinite' };

/**
 * The two moments a turn has, as the vocabulary everything that fires at one
 * is written in.
 *
 * A repeat save, a payout, an area trigger and a boundary the fold raises all
 * name the same two words, and before this they each spelled them out — in
 * four different orders, with nothing tying any of them to this module.
 * `time-vocabulary.test.ts` holds every other file in the engine to the name.
 *
 * **Not to be confused with the turn-anchored {@link Duration} kinds**, which
 * look almost identical and mean something else entirely:
 *
 * | | |
 * |---|---|
 * | A {@link TurnMoment} | *when a thing fires* — the start or the end of a turn that is happening |
 * | A {@link TurnAnchor} | *how long a thing lasts* — until a moment in somebody's **next** turn |
 *
 * "At the end of each of its turns, it repeats the save" is the first; "until
 * the end of your next turn" is the second, and they are a round apart.
 *
 * As data as well as a type, because untyped content is checked against it:
 * `checkSpellDefinition` reads this list exactly as it reads `PAYOUT_KINDS`.
 */
export const TURN_MOMENTS = ['start-of-turn', 'end-of-turn'] as const;

/** One of {@link TURN_MOMENTS}. */
export type TurnMoment = (typeof TURN_MOMENTS)[number];

/**
 * The {@link Duration} kinds that hang on somebody's next turn.
 *
 * Derived from the union rather than listed, which is what keeps it honest: a
 * turn-anchored member added to `Duration` joins this type the day it lands,
 * and every `lasts` field written over it accepts the new member without a
 * second list being remembered. The `of` field is what distinguishes them —
 * `end-of-current-turn` deliberately names no anchor, which is why it is not
 * one of these.
 */
export type TurnAnchor = Extract<Duration, { readonly of: CharacterId }>['kind'];

/**
 * {@link TurnAnchor} as data, for the untyped content checked against it.
 *
 * {@link TURN_MOMENTS}' reason on the neighbouring vocabulary: a class file
 * arrives as JSON through `loadContent` and the compiler was never asked, so
 * the validator needs the members as values. `satisfies` holds every entry to
 * the type and says nothing about a member left out, so the other direction is
 * `time-vocabulary.test.ts`'s: it reads the anchored members out of
 * {@link Duration}'s own declaration and holds this list equal to them, and
 * against the two constructors beside it. A third anchor added to the union
 * and not to this line fails there rather than becoming a span a definition
 * may not write.
 */
export const TURN_ANCHORS = [
  'start-of-next-turn',
  'end-of-next-turn',
] as const satisfies readonly TurnAnchor[];

export const forSeconds = (seconds: number): Duration => ({ kind: 'seconds', seconds });
export const startOfNextTurn = (of: CharacterId): Duration => ({ kind: 'start-of-next-turn', of });
export const endOfNextTurn = (of: CharacterId): Duration => ({ kind: 'end-of-next-turn', of });
/**
 * Either turn-anchored duration, chosen by a value rather than by a branch.
 *
 * For the caller holding a {@link TurnAnchor} that came out of content — a
 * feature's `lasts`, read off a class table — where an `if` picking between
 * the two constructors is a mapping the type system already has. It builds
 * exactly what they build, so the two spellings cannot drift.
 */
export const turnAnchored = (kind: TurnAnchor, of: CharacterId): Duration => ({ kind, of });
/**
 * SRD "until the end of the current turn".
 *
 * A constant rather than a function, because it takes no anchor — which is the
 * whole difference between it and {@link endOfNextTurn}. It is still a
 * constructor in the sense that matters here: nobody writes a turn count by
 * hand, and {@link resolveDuration} is the only thing that turns it into one.
 */
export const endOfCurrentTurn: Duration = { kind: 'end-of-current-turn' };
export const indefinite: Duration = { kind: 'indefinite' };

/**
 * Everything a deadline needs to know about the world.
 *
 * Narrower than `GameState` so this module does not have to import it — which
 * would be a cycle, since the reducer is what asks whether a deadline has
 * passed.
 */
export interface TimeView {
  readonly elapsed: number;
  readonly combat: CombatState | null;
}

/** The slice of a GameState a deadline reads. Keeps this module free of a cycle. */
export const timeView = (state: { elapsed: number; combat: CombatState | null }): TimeView => ({
  elapsed: state.elapsed,
  combat: state.combat,
});

const turnsOf = (combat: CombatState | null, of: CharacterId): TurnCount | null =>
  combat?.turnCounts[of] ?? null;

/**
 * Pin a relative duration to an absolute moment.
 *
 * Turn-anchored durations refuse outside combat and refuse for an anchor that
 * is not in the fight. Approximating them in seconds would be the one mistake
 * this whole two-type split exists to prevent.
 */
export function resolveDuration(view: TimeView, duration: Duration): Result<Deadline> {
  switch (duration.kind) {
    case 'indefinite':
      return ok({ kind: 'indefinite' });

    case 'seconds': {
      if (!Number.isInteger(duration.seconds) || duration.seconds < 0) {
        return err('bad_duration', `a duration runs forwards in whole seconds, got ${duration.seconds}`);
      }
      return ok({ kind: 'elapsed', at: view.elapsed + duration.seconds });
    }

    case 'start-of-next-turn':
    case 'end-of-next-turn': {
      if (view.combat === null) {
        return err('no_turns', 'there are no turns outside combat to anchor a duration to');
      }
      const turns = turnsOf(view.combat, duration.of);
      if (turns === null) {
        return err('not_in_combat', `${duration.of} is not in this combat`);
      }

      const theirTurn = view.combat.order[view.combat.turnIndex]?.id === duration.of;

      if (duration.kind === 'start-of-next-turn') {
        // `begun` already counts the turn in progress, so the next start is
        // one more either way.
        return ok({ kind: 'turn-start', of: duration.of, count: turns.begun + 1 });
      }

      // `ended` does *not* count the turn in progress. Said on the anchor's own
      // turn, "your next turn" is the one after this, so its end is two away;
      // said on anybody else's, the upcoming turn is the next one and its end
      // is one away. This asymmetry is the whole reason the constructors exist
      // rather than callers writing counts.
      return ok({ kind: 'turn-end', of: duration.of, count: turns.ended + (theirTurn ? 2 : 1) });
    }

    case 'end-of-current-turn': {
      if (view.combat === null) {
        return err('no_turns', 'there are no turns outside combat to anchor a duration to');
      }

      // The anchor is whoever is taking the turn, which is what makes this a
      // different member rather than `end-of-next-turn` said of them: `ended`
      // does not count the turn in progress, so its end is always exactly one
      // away — never the two that "your next turn" comes to on your own turn.
      const holder = view.combat.order[view.combat.turnIndex];
      const turns = holder === undefined ? null : turnsOf(view.combat, holder.id);
      if (holder === undefined || turns === null) {
        // Not reachable through any command: `turnCounts` is kept in exact step
        // with `order` by every operation that changes either. It is a value
        // rather than a throw because this function's contract is to hand back
        // a refusal, and it is `not_in_combat` because a caller branching on a
        // turn-anchored duration's refusals should not need a third code to
        // learn the same thing — there is no turn here to anchor to.
        return err('not_in_combat', 'this combat holds no turn in progress to end');
      }

      return ok({ kind: 'turn-end', of: holder.id, count: turns.ended + 1 });
    }
  }
}

/** Whether a deadline has arrived. */
export function hasExpired(view: TimeView, deadline: Deadline): boolean {
  switch (deadline.kind) {
    case 'indefinite':
      return false;
    case 'elapsed':
      return view.elapsed >= deadline.at;
    case 'turn-start':
    case 'turn-end': {
      const turns = turnsOf(view.combat, deadline.of);
      // Turn-anchored timing is combat-scoped. With the fight over or the
      // anchor gone there is no moment left for the effect to end at, and an
      // effect that can never expire is worse than one that ends with the
      // fight.
      if (turns === null) return true;
      return deadline.kind === 'turn-start'
        ? turns.begun >= deadline.count
        : turns.ended >= deadline.count;
    }
  }
}

/**
 * Whether a scheduled hit is due **now**.
 *
 * The difference from {@link hasExpired} is the whole reason this exists. That
 * function answers "is there no moment left for this to end at", and returns
 * true when the fight is over or the anchor has gone — which is right for an
 * effect that must not outlive the fight, and exactly wrong for a debt, which
 * would then be collected at the moment it should have been forgiven.
 *
 * So a schedule whose anchor is no longer taking turns is never due. Dropping
 * it is a separate pass, and dropping is what happens to it.
 */
export function isDue(view: TimeView, deadline: Deadline): boolean {
  switch (deadline.kind) {
    case 'indefinite':
      return false;
    case 'elapsed':
      return view.elapsed >= deadline.at;
    case 'turn-start':
    case 'turn-end': {
      const turns = turnsOf(view.combat, deadline.of);
      if (turns === null) return false;
      return deadline.kind === 'turn-start'
        ? turns.begun >= deadline.count
        : turns.ended >= deadline.count;
    }
  }
}
