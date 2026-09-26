/**
 * What the engine is holding mid-resolution, and how each one is settled.
 *
 * A move awaiting an Opportunity Attack, an attack awaiting its damage, a
 * damage roll or a D20 Test awaiting Reactions. Every one of them is opened,
 * answered and closed by its own events, and the reducer's job is the
 * identity backstop: an answer from somebody who was never offered one is a
 * log and a set of rules that disagree.
 *
 * Named for `commands/holds.ts`, which is the same debts read from above.
 */
import type { CharacterId } from '@ie/shared';
import type { ReactionOffer } from '../reactions.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { CorruptLogError, seamOf, unhandledEvent, type Applying } from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const HOLDS_EVENTS = [
  'movement-declared',
  'opportunity-answered',
  'movement-completed',
  'attack-landed',
  'attack-damage-dealt',
  'damage-rolled',
  'damage-reaction-answered',
  'damage-settled',
  'test-rolled',
  'test-reaction-answered',
  'test-settled',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type HoldsEvent = Extract<GameEvent, { type: (typeof HOLDS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isHoldsEvent = seamOf(HOLDS_EVENTS);


/**
 * Which offer an answer settles.
 *
 * **An offer is a (reactor, feature) pair, not a reactor.** One creature can
 * hold two features in one window — a Rogue 5 / Monk 3 is offered Uncanny
 * Dodge *and* Deflect Attacks against the same blow, and a Fighter / Fiend
 * Warlock may Indomitable a failed save and then add Dark One's Own Luck to
 * the new roll, which the SRD permits. Matching answers by reactor alone
 * consumed both offers on the first answer, and a settlement that recorded
 * one pass per offer then found the second already gone and threw — a legal
 * character build that crashed the settle command and corrupted the log.
 *
 * An answer that names no feature is a bare pass and lets every offer that
 * reactor held lapse, which is what declining a window means.
 */
const offerAnswered =
  (event: { readonly reactor: CharacterId; readonly feature?: string }) =>
  (offer: ReactionOffer): boolean =>
    offer.reactor === event.reactor &&
    (event.feature === undefined || offer.feature === event.feature);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyHolds({ state, next }: Applying, event: HoldsEvent): GameState {
  switch (event.type) {
    case 'movement-declared': {
      if (state.pendingMove !== null) {
        throw new CorruptLogError(event, 'a move is already waiting');
      }
      // **Built from the fields this engine knows, never stored verbatim.**
      // Both frozen logs were written when `PendingMove` carried the distance,
      // and nothing ever read it; spreading the event would put a field the
      // type no longer declares into live state for the life of the move —
      // the same data-nothing-can-explain that `upgradeOngoing` keeps out of
      // an ongoing record.
      return {
        ...next,
        pendingMove: {
          mover: event.move.mover,
          placement: event.move.placement,
          destination: event.move.destination,
          provoked: event.move.provoked,
          // Whom the move brings along — W7-B10 — settled by the command and
          // read back by `completeIfSettled` when every Reaction is answered.
          ...(event.move.carrying === undefined ? {} : { carrying: event.move.carrying }),
        },
      };
    }

    case 'opportunity-answered': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      return {
        ...next,
        pendingMove: {
          ...waiting,
          provoked: waiting.provoked.filter((p) => p.reactor !== event.reactor),
        },
      };
    }

    case 'movement-completed': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      if (waiting.provoked.length > 0) {
        throw new CorruptLogError(event, 'the move still owes an Opportunity Attack');
      }
      return { ...next, pendingMove: null };
    }

    case 'attack-landed': {
      if (state.pendingAttack !== null) {
        throw new CorruptLogError(event, 'an attack is already being held');
      }
      return { ...next, pendingAttack: event.attack };
    }

    case 'attack-damage-dealt': {
      if (state.pendingAttack === null) {
        throw new CorruptLogError(event, 'no attack is being held');
      }
      return { ...next, pendingAttack: null };
    }

    case 'damage-rolled': {
      if (state.pendingDamage !== null) {
        throw new CorruptLogError(event, 'a damage roll is already being held');
      }
      return { ...next, pendingDamage: event.damage };
    }

    case 'damage-reaction-answered': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      // An answer from somebody who was never offered one is a log and a set of
      // rules that disagree, not a rules dispute — the same loudness a second
      // action in one turn gets.
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this damage`,
        );
      }
      return {
        ...next,
        pendingDamage: {
          ...waiting,
          reductions:
            event.reduction === undefined
              ? waiting.reductions
              : [...waiting.reductions, event.reduction],
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }

    case 'damage-settled': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      if (waiting.target !== event.target) {
        throw new CorruptLogError(
          event,
          `the damage being held is against ${waiting.target}, not ${event.target}`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this damage');
      }
      return { ...next, pendingDamage: null };
    }

    case 'test-rolled': {
      if (state.pendingTest !== null) {
        throw new CorruptLogError(event, 'a D20 Test is already being held');
      }
      return { ...next, pendingTest: event.test };
    }

    case 'test-reaction-answered': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this test`,
        );
      }
      return {
        ...next,
        pendingTest: {
          ...waiting,
          // The pushed roll replaces the old one. The superseded number is on
          // the result itself, so the log still shows what was given up.
          ...(event.result === undefined ? {} : { result: event.result }),
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }

    case 'test-settled': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      if (waiting.who !== event.who) {
        throw new CorruptLogError(
          event,
          `the D20 Test being held is ${waiting.who}'s, not ${event.who}'s`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this test');
      }
      return { ...next, pendingTest: null };
    }
  }

  return unhandledEvent(event);
}
