/**
 * What a creature spends and recovers, and the clock it recovers against.
 *
 * Pools, rests and elapsed time are one seam because a rest is the join: it
 * is stamped with `elapsed` when it begins, pays out against `elapsed` when
 * it ends, and what it pays out is a pool. Splitting the three would put the
 * two halves of one SRD sentence in three modules.
 */
import {
  declarePool,
  resize,
  restore,
  restoreOn,
  spend as spendResource,
  tally,
} from '../resources.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
  must,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const UPKEEP_EVENTS = [
  'resource-pool-declared',
  'resource-spent',
  'resource-regained',
  'resource-pool-resized',
  'resources-restored',
  'time-advanced',
  'rest-begun',
  'rest-ended',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type UpkeepEvent = Extract<GameEvent, { type: (typeof UPKEEP_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isUpkeepEvent = seamOf(UPKEEP_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyUpkeep({ state, next }: Applying, event: UpkeepEvent): GameState {
  switch (event.type) {
    case 'resource-pool-declared': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, declarePool(creature.resources, event.pool));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-spent': {
      const creature = creatureOf(state, event, event.id);
      // **One event, two things it can come out of.** A pool is spent and can
      // run out; a tally is counted and cannot — see `Tally` in
      // `resources.ts`. Which of the two this is, is said on the event rather
      // than guessed from whether the key happens to name a pool, because a
      // guess would turn a typo into a new count instead of a corrupt log.
      const resources =
        event.tally === undefined
          ? must(event, spendResource(creature.resources, event.key, event.amount))
          : must(event, tally(creature.resources, event.key, event.tally, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-regained': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, restore(creature.resources, event.key, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-pool-resized': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, resize(creature.resources, event.key, event.max));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resources-restored': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { resources: restoreOn(creature.resources, event.recovers) },
        creature,
      );
    }

    case 'time-advanced': {
      if (!Number.isInteger(event.seconds) || event.seconds < 0) {
        throw new CorruptLogError(event, `time runs forwards in whole seconds, got ${event.seconds}`);
      }
      return { ...next, elapsed: state.elapsed + event.seconds };
    }

    case 'rest-begun': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting !== null) {
        throw new CorruptLogError(event, `${event.id} is already resting`);
      }
      return withCreature(
        next,
        event.id,
        {
          resting: {
            kind: event.kind,
            startedAt: state.elapsed,
            interruptedBy: null,
            interruptedAt: null,
          },
        },
        creature,
      );
    }

    case 'rest-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting === null) {
        throw new CorruptLogError(event, `${event.id} is not resting`);
      }
      // A Long Rest only starts the sixteen-hour clock if it was actually
      // finished as one. A Long Rest that collapsed into a Short Rest does
      // not, or an interrupted night would lock out the next one.
      return withCreature(
        next,
        event.id,
        {
          resting: null,
          ...(event.benefit === 'long' ? { lastLongRestAt: state.elapsed } : {}),
          // SRD: an interrupted Long Rest of at least an hour "gains the
          // benefits of a Short Rest", so what is recorded is what the rest
          // earned rather than what it set out to be.
          ...(event.benefit === 'short' ? { lastShortRestAt: state.elapsed } : {}),
        },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}
