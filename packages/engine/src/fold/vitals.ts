/**
 * Hit points, death and conditions — what happens to a creature that is
 * already in the game.
 *
 * One seam rather than two because the SRD keeps crossing between them in a
 * single event: dropping to 0 makes a creature Unconscious, Exhaustion 6
 * kills, and a hit point maximum that rises carries the current total with it.
 * A cut between `vitals` and `conditions` would put both halves of those
 * sentences in different modules.
 */
import type { CharacterId } from '@ie/shared';
import {
  applyCondition,
  removeCondition,
  setExhaustion,
  type ConditionState,
} from '../conditions.js';
import { timerKey, type TimedEffect } from '../timers.js';
import {
  applyDamageToVitals,
  grantTemporaryHp,
  heal,
  resolveDeathSave,
  stabilize,
} from '../vitals.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { tally } from '../resources.js';
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
export const VITALS_EVENTS = [
  'damage-taken',
  'healed',
  'temporary-hp-granted',
  'temporary-hp-cleared',
  'death-save-recorded',
  'stabilised',
  'condition-applied',
  'condition-removed',
  'exhaustion-set',
  'creature-died',
  'hit-point-maximum-raised',
  'fall-declared',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type VitalsEvent = Extract<GameEvent, { type: (typeof VITALS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isVitalsEvent = seamOf(VITALS_EVENTS);

/**
 * Drop the deadlines of the condition instances that have just gone.
 *
 * The population is the **difference between two condition states**, not the
 * name the removal happened to carry. A removal by name lifts every instance
 * of it and each of those lifts whatever it implied, so the honest question is
 * which instance ids stopped existing — and `timerKey` turns each of them back
 * into the key its deadline was filed under, the same derivation
 * `applyConditionTo` used to file it. Nothing here needs to know *why* an
 * instance went, which is what lets one line serve a cure, a dispel and a
 * source-named removal alike.
 *
 * Insertion order is preserved, so a filtered record is still the sorted one
 * `sortedTimers` built and a fold stays byte-identical.
 */
function withoutTimersFor(
  state: GameState,
  on: CharacterId,
  before: ConditionState,
  after: ConditionState,
): GameState {
  const gone = new Set(
    before.instances
      .filter((instance) => !after.instances.some((kept) => kept.id === instance.id))
      .map((instance) => timerKey({ kind: 'condition', on, instance: instance.id })),
  );
  if (gone.size === 0) return state;

  const timers: Record<string, TimedEffect> = {};
  let dropped = false;
  for (const [key, timer] of Object.entries(state.timers)) {
    if (gone.has(key)) {
      dropped = true;
      continue;
    }
    timers[key] = timer;
  }
  return dropped ? { ...state, timers } : state;
}

/**
 * Take the pool of Temporary Hit Points away, whatever is left of it.
 *
 * The one place the pool goes to zero, and **both** doors that empty it go
 * through here — a Long Rest, through `temporary-hp-cleared` below, and a
 * stated duration running out, through `expireEffects` — so the two cannot
 * come to disagree about what emptying it means. It is **only** the pool: hit
 * points, death saves, Stable and dead are all untouched, because Temporary
 * Hit Points were never any of them.
 *
 * Quiet when there is nothing there. A pool spent to nothing before its
 * deadline still has a deadline, and the moment arriving on it must change
 * exactly as much as it found, which is none.
 */
export function clearTemporaryHp(state: GameState, on: CharacterId): GameState {
  const creature = state.creatures[on];
  if (creature === undefined || creature.vitals.temporaryHp === 0) return state;
  return {
    ...state,
    creatures: {
      ...state.creatures,
      [on]: { ...creature, vitals: { ...creature.vitals, temporaryHp: 0 } },
    },
  };
}

/**
 * Drop the deadline hung on a creature's Temporary Hit Points.
 *
 * The same rule `withoutTimersFor` applies above, on the one target whose
 * identity is a creature rather than an instance: a deadline is hung on a
 * *pool*, so a pool that no longer exists has no deadline. Left standing, it
 * would come due against whatever pool the creature is holding by then and end
 * points it never measured — the failure a condition's stale timer already
 * caused once.
 *
 * Insertion order is preserved, so a filtered record is still the sorted one
 * `sortedTimers` built and a fold stays byte-identical.
 */
function withoutTemporaryHpDeadline(state: GameState, on: CharacterId): GameState {
  const key = timerKey({ kind: 'temporary-hit-points', on });
  if (state.timers[key] === undefined) return state;
  const timers: Record<string, TimedEffect> = {};
  for (const [at, timer] of Object.entries(state.timers)) {
    if (at !== key) timers[at] = timer;
  }
  return { ...state, timers };
}

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyVitals({ state, next }: Applying, event: VitalsEvent): GameState {
  switch (event.type) {
    case 'damage-taken': {
      const creature = creatureOf(state, event, event.id);
      const outcome = applyDamageToVitals(creature.vitals, event.amount, {
        ...(event.critical === undefined ? {} : { critical: event.critical }),
        // **The same arithmetic the command ran, from the number it pinned.**
        // Whether a trait intercepted the drop was decided once, where the
        // features and the resources are; this reads the answer rather than
        // asking again, which is what keeps a replay byte-identical and the
        // fold free of any catalogue. See `damage-taken.floor`.
        ...(event.floor === undefined ? {} : { floor: event.floor.at }),
      });
      // A dealer overwrites the last one; damage from nothing in the game
      // leaves whatever was there, because a falling rock does not make the
      // thug who stabbed you a moment ago un-stabbed you. The window closes on
      // its own when the turn or the clock moves.
      return withCreature(
        next,
        event.id,
        {
          vitals: outcome.vitals,
          // **And the use the floor cost, counted off the same event.** The
          // interception and its price are one fact and arrive as one event —
          // see `damage-taken.floor.spent` for why the spend is not a second
          // one — so the count is taken here, where the floor is read. A floor
          // that cost nothing carries no `spent` and counts nothing: SRD
          // Undead Fortitude rations its interception with a saving throw
          // rather than with a limit.
          ...(event.floor?.spent === undefined
            ? {}
            : {
                resources: must(
                  event,
                  tally(creature.resources, event.floor.spent.key, event.floor.spent.recovers),
                ),
              }),
          ...(event.by === undefined
            ? {}
            : {
                lastDamage: {
                  by: event.by,
                  turn: state.combat?.turnsTaken ?? null,
                  elapsed: state.elapsed,
                },
              }),
        },
        creature,
      );
    }

    case 'healed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: heal(creature.vitals, event.amount) }, creature);
    }

    case 'temporary-hp-granted': {
      const creature = creatureOf(state, event, event.id);
      const vitals = grantTemporaryHp(creature.vitals, event.amount);
      const granted = withCreature(next, event.id, { vitals }, creature);

      // **And the old deadline goes with the pool the new points replaced.**
      // SRD: Temporary Hit Points do not stack — "you choose whether to keep
      // the ones you have or gain the new ones" — so a grant that is taken is
      // a *new pool*, and an hour hung on the pool that went would come due
      // against this one. The grant is the whole of what the fold needs to see
      // that, which is what keeps a grant one event.
      //
      // **Only when the points were actually taken.** `grantTemporaryHp` keeps
      // the larger, so a smaller second grant changes nothing: the points
      // being held are still the ones the deadline was hung on, and dropping
      // it there would hand them a lifetime nobody granted. The pool moving is
      // the honest test of which of the two happened.
      //
      // A deadline for the *new* points is hung after this, by whoever granted
      // them — the order `applyConditionTo` already writes, condition first
      // and `effect-scheduled` behind it.
      return vitals.temporaryHp === creature.vitals.temporaryHp
        ? granted
        : withoutTemporaryHpDeadline(granted, event.id);
    }

    case 'temporary-hp-cleared': {
      // Read the creature first and use the helper second. `clearTemporaryHp`
      // is deliberately quiet about a creature it cannot find, because the
      // expiry pass may arrive after one has left; an *event* naming nobody is
      // a log this engine did not write, and this seam refuses it as it
      // refuses every other.
      creatureOf(state, event, event.id);

      // SRD: "Temporary Hit Points last until they're depleted or you finish a
      // Long Rest." The rest takes the pool **and** any deadline that was hung
      // on it: an hour that outlived the points it measured would be a timer
      // over nothing.
      return withoutTemporaryHpDeadline(clearTemporaryHp(next, event.id), event.id);
    }

    case 'death-save-recorded': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: resolveDeathSave(creature.vitals, event.natural, event.total ?? event.natural).vitals },
        creature,
      );
    }

    case 'stabilised': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: stabilize(creature.vitals) }, creature);
    }

    case 'fall-declared': {
      const creature = creatureOf(state, event, event.id);
      // **The two facts the engine already holds about "now", and no third.**
      // It is `damage-taken`'s line with the dealer taken off, because a fall
      // is dealt by the world: the turn in combat and the clock outside one
      // are the whole of the window, and `fallWindowOpen` reads them back with
      // the rule `damageWindowOpen` wrote. A height or a rate written here
      // would be a number nobody at the table supplied.
      return withCreature(
        next,
        event.id,
        { falling: { turn: state.combat?.turnsTaken ?? null, elapsed: state.elapsed } },
        creature,
      );
    }

    case 'condition-applied': {
      const creature = creatureOf(state, event, event.id);
      // The implications this *cause* carries, pinned on the event because the
      // fold opens no catalogue: SRD Crocodile's "While Grappled, the target
      // has the Restrained condition" is a fact about one set of jaws and not
      // about the Grappled condition.
      const conditions = applyCondition(
        creature.conditions,
        event.condition,
        event.source,
        event.implies,
      );
      // **And nothing else.** This case used to also put the creature into the
      // casting's list of who it was on, by hand — a growth pass called
      // `alsoOn`. It reached conditions and nothing else, so a Web that
      // restrained somebody an hour later found them and the five events that
      // *grant* something never did. `spellOn` reads the same link off the
      // world at every read, so growth is not an operation any more.
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'condition-removed': {
      const creature = creatureOf(state, event, event.id);
      // Lifting a cause drops what that cause carried — losing Unconscious
      // lifts the Incapacitated it brought — while leaving any other reason
      // for the same condition standing, and leaving Prone behind.
      const conditions = removeCondition(creature.conditions, event.condition, event.source);
      const lifted = withCreature(next, event.id, { conditions }, creature);

      // **And the deadline goes with the instance it was hung on.**
      // `applyConditionTo` files an `effect-scheduled` against the condition
      // *instance* whenever there is a duration, a repeat save or a check, and
      // a removal by name lifts every instance of that name — so a cure used
      // to leave those timers standing. A stale one is not merely untidy: the
      // turn boundary went on raising the repeat save against a condition that
      // was gone, and a stale span would end the *next* instance of the same
      // condition early, at a moment measured from one nobody has any more.
      //
      // **Derived from the removal rather than written beside it.** A timer is
      // a deadline on an instance, so an instance that no longer exists has no
      // deadline, and the fold can read that off the very event it is already
      // reducing — which keeps a removal one event, the way `expireEffects`
      // and `endLostFeatures` keep an expiry none at all. The population is the
      // difference between the two condition states rather than the event's own
      // name, so an implied instance that carried a deadline of its own goes
      // with the cause that carried it.
      return withoutTimersFor(lifted, event.id, creature.conditions, conditions);
    }

    case 'exhaustion-set': {
      const creature = creatureOf(state, event, event.id);
      const conditions = setExhaustion(creature.conditions, event.level);
      // SRD: "You die if your Exhaustion level is 6." That is a rule, not
      // something a caller opts into, so it happens here.
      const vitals =
        conditions.exhaustion >= 6 ? { ...creature.vitals, hp: 0, dead: true } : creature.vitals;
      return withCreature(next, event.id, { conditions, vitals }, creature);
    }

    case 'creature-died': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, hp: 0, dead: true } },
        creature,
      );
    }

    case 'hit-point-maximum-raised': {
      const creature = creatureOf(state, event, event.id);
      if (!Number.isInteger(event.amount) || event.amount <= 0) {
        throw new CorruptLogError(event, `a hit point maximum rises by a positive whole number, got ${event.amount}`);
      }
      // SRD: the maximum rises; current hit points rise with it, because the
      // new points were never lost. Damage already taken stays taken.
      return withCreature(
        next,
        event.id,
        {
          vitals: {
            ...creature.vitals,
            hpMax: creature.vitals.hpMax + event.amount,
            hp: creature.vitals.hp + event.amount,
          },
        },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}
