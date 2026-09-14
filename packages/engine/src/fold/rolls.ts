/**
 * The generator's own two events.
 *
 * `rolls-issued` is the only thing that moves `rng` and `rollsIssued`, which
 * is what lets a live session resume its sequence mid-fight. `roll-recorded`
 * changes no state at all: it exists so the log can answer "why did the goblin
 * die", and its consequences arrive as their own events.
 */
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { seamOf, unhandledEvent, type Applying } from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const ROLLS_EVENTS = [
  'roll-recorded',
  'rolls-issued',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type RollsEvent = Extract<GameEvent, { type: (typeof ROLLS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isRollsEvent = seamOf(ROLLS_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyRolls({ state, next }: Applying, event: RollsEvent): GameState {
  switch (event.type) {
    // A record, not a mutation: the consequences arrive as their own events.
    case 'roll-recorded':
      return next;

    case 'rolls-issued':
      return { ...next, rollsIssued: state.rollsIssued + event.count, rng: event.rng };
  }

  return unhandledEvent(event);
}
