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
  'printed-line-expended',
  'printed-line-recharged',
  'printed-line-used-today',
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
        {
          resources: restoreOn(creature.resources, event.recovers),
          // **A rest brings back every recharging line, both notations.** SRD
          // *Monsters* says it of the die form in the same sentence as the die
          // — "which also recharges when the monster finishes a Short or Long
          // Rest" — and the other notation is that clause with the die taken
          // away. So it is one answer for both arms and it is answered here,
          // on the event a rest already emits, rather than by a second event a
          // caller could forget: a creature's rest is exactly this event with
          // a rest's tag on it, and `endRest` emits both tags for a Long Rest.
          //
          // The other two tags are left alone. Dawn is not a rest, and
          // `special` is a recovery a feature spelled out for itself.
          ...(event.recovers === 'short-rest' || event.recovers === 'long-rest'
            ? { expendedLines: [] }
            : {}),
          // **And the other notation comes back on the other tag, alone.** A
          // heading that prints *N/Day* is a count between dawns, which the
          // owner has ruled directly: not on a Short Rest, not on a Long Rest.
          // The two clauses above and below this one are the same distinction
          // read from its two ends, and they are deliberately disjoint — a
          // recharge comes back on a rest and not on a morning, a per-day line
          // on a morning and not on a rest. `special` is neither, and is left
          // alone by both. See {@link CreatureState.linesUsedToday}.
          ...(event.recovers === 'dawn' ? { linesUsedToday: {} } : {}),
        },
        creature,
      );
    }

    case 'printed-line-expended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.expendedLines.includes(event.line)) {
        throw new CorruptLogError(event, `${event.id} has already spent ${event.line}`);
      }
      return withCreature(
        next,
        event.id,
        { expendedLines: [...creature.expendedLines, event.line].sort() },
        creature,
      );
    }

    case 'printed-line-recharged': {
      const creature = creatureOf(state, event, event.id);
      // A line nobody spent cannot come back, and a log that says it did is
      // describing a creature that used something twice — the loudest way this
      // rule could go wrong, so it stops rather than being absorbed.
      if (!creature.expendedLines.includes(event.line)) {
        throw new CorruptLogError(event, `${event.id} has not spent ${event.line}`);
      }
      return withCreature(
        next,
        event.id,
        { expendedLines: creature.expendedLines.filter((line) => line !== event.line) },
        creature,
      );
    }

    case 'printed-line-used-today': {
      const creature = creatureOf(state, event, event.id);
      // **No ceiling is checked here.** The limit is the sheet's — what the
      // block prints — and the command that spends a line is where it is read
      // and refused, before the economy is touched. A second copy of the rule
      // in the fold would be a second answer to one question, and the fold's
      // job on a count is that it goes up by one.
      //
      // Absent and zero are the same fact, and only one of them is written
      // down: a line joins the record the first time it is used.
      const counted = {
        ...creature.linesUsedToday,
        [event.line]: (creature.linesUsedToday[event.line] ?? 0) + 1,
      };
      // Keys in one order, for the reason `expendedLines` is sorted and with
      // more riding on it: two logs that spent the same two lines in opposite
      // orders would otherwise fold to states that compare equal and
      // serialise differently, and a frozen fixture is compared as bytes.
      const linesUsedToday: Record<string, number> = {};
      for (const line of Object.keys(counted).sort()) linesUsedToday[line] = counted[line]!;
      return withCreature(next, event.id, { linesUsedToday }, creature);
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
