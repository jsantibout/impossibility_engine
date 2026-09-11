import { err, ok, type CharacterId, type Result } from '@ie/shared';
import type { CombatState, TurnCount } from './combat.js';

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
  | { readonly kind: 'indefinite' };

/** What the log records. Absolute, and always answerable. */
export type Deadline =
  | { readonly kind: 'elapsed'; readonly at: number }
  /** Fires when the anchor has begun this many turns. */
  | { readonly kind: 'turn-start'; readonly of: CharacterId; readonly count: number }
  /** Fires when the anchor has ended this many turns. */
  | { readonly kind: 'turn-end'; readonly of: CharacterId; readonly count: number }
  | { readonly kind: 'indefinite' };

export const forSeconds = (seconds: number): Duration => ({ kind: 'seconds', seconds });
export const startOfNextTurn = (of: CharacterId): Duration => ({ kind: 'start-of-next-turn', of });
export const endOfNextTurn = (of: CharacterId): Duration => ({ kind: 'end-of-next-turn', of });
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

/** What an expiring timer ends. */
export type EffectTarget =
  /** One condition instance on one creature, by its deterministic id. */
  | { readonly kind: 'condition'; readonly on: CharacterId; readonly instance: string }
  /** A whole casting, and everything it created. */
  | { readonly kind: 'casting'; readonly castingId: string };

export interface TimedEffect {
  readonly target: EffectTarget;
  readonly deadline: Deadline;
}

/**
 * The key a timer is filed under.
 *
 * Derived from the target rather than a counter, so re-applying the same
 * effect from the same source *replaces* its deadline instead of leaving a
 * stale one behind to end it early.
 */
export function timerKey(target: EffectTarget): string {
  return target.kind === 'condition'
    ? `condition|${target.on}|${target.instance}`
    : `casting|${target.castingId}`;
}
