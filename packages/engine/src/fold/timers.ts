/**
 * What a casting owes later: `timers`, `pendingSaves` and `scheduledDamage`.
 *
 * A deadline filed, a repeat save answered, damage scheduled and collected.
 * The passes that *find* an expiry are `expiry.ts` and `turns.ts`; this seam
 * is only the events that file a debt and settle one.
 */
import { pendingSaveKey, scheduledDamageKey, timerKey } from '../timers.js';
import { castingIdOf } from '../spells.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  sortedRecord,
  sortedTimers,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import {
  casterOf,
  endTimedCondition,
  releaseCasting,
  releaseGrants,
  releaseOnTarget,
} from './release.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const TIMERS_EVENTS = [
  'effect-scheduled',
  'effect-check-resolved',
  'damage-scheduled',
  'scheduled-damage-collected',
  'effect-save-resolved',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type TimersEvent = Extract<GameEvent, { type: (typeof TIMERS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isTimersEvent = seamOf(TIMERS_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyTimers({ state, next }: Applying, event: TimersEvent): GameState {
  switch (event.type) {
    case 'effect-scheduled':
      return {
        ...next,
        timers: sortedTimers({
          ...state.timers,
          [timerKey(event.target)]: {
            target: event.target,
            deadline: event.deadline,
            ...(event.repeatSave === undefined ? {} : { repeatSave: event.repeatSave }),
            ...(event.check === undefined ? {} : { check: event.check }),
            // Conditionally, like the two above it: an event written before
            // the field existed folds to a timer with no such key, so the two
            // frozen logs are byte-identical to what they always folded to.
            ...(event.endsEarly === undefined ? {} : { endsEarly: event.endsEarly }),
          },
        }),
      };

    case 'effect-check-resolved': {
      const timer = state.timers[event.effectKey];
      if (timer === undefined) {
        throw new CorruptLogError(event, `no effect is filed under ${event.effectKey}`);
      }
      if (timer.check === undefined) {
        throw new CorruptLogError(event, `${event.effectKey} offers no check to attempt`);
      }
      if (!event.success || timer.check.onSuccess === 'none') return next;

      // **A check against what a printed line hung on a creature**, which is
      // the second kind of target a success can end and arrived with SRD
      // Bearded Devil's infernal wound: "after the target or a creature within
      // 5 feet of it takes an action to stanch the wound". There is no
      // condition and no casting — the wound is a payout under its own source
      // with a deadline over it — so what the success ends is exactly what the
      // deadline arriving would have ended, through the same door
      // `expireEffects` opens. The timer goes with it, because a check that
      // has been passed has nothing left to be attempted against.
      if (timer.target.kind === 'grants') {
        const creature = next.creatures[timer.target.on];
        const timers = { ...next.timers };
        delete timers[event.effectKey];
        return creature === undefined
          ? { ...next, timers }
          : {
              ...next,
              timers,
              creatures: {
                ...next.creatures,
                [timer.target.on]: releaseGrants(creature, timer.target.source),
              },
            };
      }

      // The only other consequence this union can express, and it is the one
      // the repeat save already performs: the casting's effect on that
      // creature ends, and the casting itself carries on for anyone else it
      // caught.
      if (timer.target.kind !== 'condition') {
        throw new CorruptLogError(
          event,
          `${event.effectKey} ends on its target, but it is not on a creature`,
        );
      }
      // **A source that is not a casting ends on its own timer**, which is the
      // reading `effect-save-resolved` below already takes of the very same
      // sentence: SRD writes "ending the condition on itself on a success" on
      // plenty of things nobody cast — a grapple's escape is the first of them
      // to reach this door — and there is then no casting to release on a
      // target, nothing in `ongoing` and no Concentration to drop. What the
      // success ends is the condition and the deadline that was holding it.
      // This used to be a `CorruptLogError`, so a check offered against
      // anything but a spell wrote a log that could not be folded.
      const castingId = castingIdOf(timer.target.instance);
      if (castingId === null) {
        if (timer.check.onSuccess === 'end-casting') {
          // Refused at both doors before it could be written — `checkContent`
          // admits no check on a conferral, `checkSpellDefinition` refuses the
          // pair with `outlivesCasting` (`check_ends_no_casting`), and
          // `applyConditionTo` refuses a source with no casting in it
          // (`check_needs_a_casting`) — so a log that says it is a log this
          // engine did not write. The same reading `effect-save-resolved`
          // takes below.
          throw new CorruptLogError(
            event,
            `${event.effectKey} ends a casting on a success and ${timer.target.instance} is not one's`,
          );
        }
        return endTimedCondition(next, event.effectKey, timer.target);
      }
      // SRD Ensnaring Strike: "On a success, the spell ends" — the whole
      // casting, through the door a repeat save's `end-casting` already
      // opens; SRD Web's "ending the condition on itself" is the other
      // spelling and releases the casting on that creature alone.
      return timer.check.onSuccess === 'end-casting'
        ? releaseCasting(next, casterOf(next, castingId), castingId)
        : releaseOnTarget(next, timer.target.on, castingId);
    }

    case 'damage-scheduled': {
      const key = scheduledDamageKey(event.schedule.source, event.schedule.target);
      return {
        ...next,
        scheduledDamage: sortedRecord({ ...state.scheduledDamage, [key]: event.schedule }),
      };
    }

    case 'scheduled-damage-collected': {
      if (state.scheduledDamage[event.key] === undefined) {
        throw new CorruptLogError(event, `no damage is scheduled under ${event.key}`);
      }
      const scheduledDamage = { ...state.scheduledDamage };
      delete scheduledDamage[event.key];
      return { ...next, scheduledDamage };
    }

    case 'effect-save-resolved': {
      const key = pendingSaveKey(event.effectKey, event.turn);
      const pending = state.pendingSaves[key];
      if (pending === undefined) {
        throw new CorruptLogError(event, `no save is pending for ${event.effectKey} on turn ${event.turn}`);
      }

      const pendingSaves = { ...state.pendingSaves };
      delete pendingSaves[key];
      const cleared: GameState = { ...next, pendingSaves };
      if (!event.success) return cleared;

      // **A printed line's debt has nothing for a success to end.** A repeat
      // save is a save *against something the engine is holding* — a condition,
      // a casting — and making it is how a creature puts that thing down. A
      // Death Burst and a Stench hold nothing: the save decides what the line
      // does, and what it does lands through `applyPrintedClauses` in the same
      // batch, including SRD's "_Success:_ The target is immune to this
      // ghast's Stench for 24 hours". So the debt is discharged and the fold
      // is finished with it.
      if (pending.printed !== undefined) return cleared;

      // **A source that is not a casting ends on its own timer.** A potion's
      // Poisoned is filed under `item:<id>` and there is no casting to release
      // on a target, no Concentration to drop and nothing in `ongoing`; what
      // the success ends is the condition and the deadline that was holding
      // it, which is the door `endTimedCondition` already opens when the same
      // condition simply runs out of time.
      //
      // **Narrower than a casting's `end-on-target`, deliberately.**
      // `releaseOnTarget` lifts *everything* the casting hung on that
      // creature, because a casting is one thing that ends; an item's source
      // is a label on whatever the bottle did, and SRD's "ending the effect on
      // a success" is about the condition the save was against. Shaking off a
      // poison is not putting down a shield the same flask granted. Nothing
      // can currently tell the two readings apart — `checkContent` admits one
      // condition per `save` effect and no rider beside it — so this is the
      // narrow reading written down rather than a fork nothing could take.
      const castingId = castingIdOf(pending.source);
      if (castingId === null) {
        if (pending.onSuccess === 'end-casting') {
          // Refused at all three doors before it could ever be written — see
          // `RepeatSave.onSuccess` — so a log that says it is a log this
          // engine did not write.
          throw new CorruptLogError(
            event,
            `${event.effectKey} ends a casting on a success and ${pending.source} is not one`,
          );
        }
        const timer = state.timers[event.effectKey];
        // **A printed line's grants, held under one source with the repeat on
        // the timer.** SRD Gold Dragon Wyrmling's Weakening Breath hangs a mode
        // and a penalty and prints one save that ends "the effect"; the
        // failure imposes no condition, so the timer's target is the grants
        // themselves. A success releases what that source granted and drops
        // the timer — the same release a `grants` deadline performs in
        // `fold/expiry.ts` when the minute's cap arrives instead.
        if (timer !== undefined && timer.target.kind === 'grants') {
          const timers = { ...cleared.timers };
          delete timers[event.effectKey];
          const creature = cleared.creatures[timer.target.on];
          return {
            ...cleared,
            timers,
            ...(creature === undefined
              ? {}
              : {
                  creatures: {
                    ...cleared.creatures,
                    [timer.target.on]: releaseGrants(creature, timer.target.source),
                  },
                }),
          };
        }
        if (timer === undefined || timer.target.kind !== 'condition') {
          throw new CorruptLogError(
            event,
            `${event.effectKey} ends on its target, and no condition timer is filed under it`,
          );
        }
        return endTimedCondition(cleared, event.effectKey, timer.target);
      }

      // SRD Hold Person: a success ends the spell "on itself" — on that target,
      // not on everyone the casting caught. An effect whose hook says otherwise
      // ends the casting outright.
      return pending.onSuccess === 'end-casting'
        ? releaseCasting(cleared, casterOf(cleared, castingId), castingId)
        : releaseOnTarget(cleared, pending.target, castingId);
    }
  }

  return unhandledEvent(event);
}
