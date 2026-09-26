/**
 * What a settled outcome owes a creature's next turn: the seam that files the
 * debt and the one that pays it. (W7-S22)
 *
 * SRD Command: "The target must succeed on a Wisdom saving throw or follow the
 * command **on its next turn**." The save is rolled at the casting and the
 * riders it buys are owed — `riders-deferred` appends one {@link
 * DeferredRiders} to `deferredRiders` — and the turn boundary lands them as
 * that creature's turn begins, writing each landing as its own event and
 * `deferred-riders-settled` beside them to close the debt.
 *
 * The region is its own because nothing else writes it: a debt that is not a
 * save (`pendingSaves`), not an area's (`owedAreaEffects`) and not a hit on the
 * clock (`scheduledDamage`). A fight ending clears it — see {@link
 * forgetDeferredRiders} — because "its next turn" names a turn of the fight the
 * word was spoken in.
 */
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { CorruptLogError, creatureOf, seamOf, unhandledEvent, type Applying } from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const DEFERRED_EVENTS = ['riders-deferred', 'deferred-riders-settled'] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type DeferredEvent = Extract<GameEvent, { type: (typeof DEFERRED_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isDeferredEvent = seamOf(DEFERRED_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyDeferred({ state, next }: Applying, event: DeferredEvent): GameState {
  switch (event.type) {
    case 'riders-deferred': {
      // Owed by somebody who is here, in a fight: the pre-flight asked for the
      // target's place in the order before the save was rolled, so a debt
      // with nobody to owe it or no turn to land on is a log that contradicts
      // itself.
      creatureOf(state, event, event.owed.target);
      if (state.combat === null) {
        throw new CorruptLogError(event, `${event.owed.target} has no next turn outside a fight`);
      }
      return { ...next, deferredRiders: [...state.deferredRiders, event.owed] };
    }

    case 'deferred-riders-settled': {
      const at = state.deferredRiders.findIndex(
        (owed) => owed.target === event.id && owed.source === event.source,
      );
      if (at < 0) {
        throw new CorruptLogError(event, `${event.id} owes nothing to ${event.source}`);
      }
      return {
        ...next,
        deferredRiders: state.deferredRiders.filter((_, index) => index !== at),
      };
    }
  }

  return unhandledEvent(event);
}

/**
 * Every deferred debt, gone with the fight it was owed in.
 *
 * Called by `combat-ended`'s reducer beside the turn stamps it forgets, and
 * for their reason: a turn number, and a "next turn", belong to one fight.
 * Returns the state untouched where nothing is owed, so a log that never
 * deferred anything folds exactly as it did.
 */
export function forgetDeferredRiders(state: GameState): GameState {
  return state.deferredRiders.length === 0 ? state : { ...state, deferredRiders: [] };
}
