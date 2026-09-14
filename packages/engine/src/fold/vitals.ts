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
import { applyCondition, removeCondition, setExhaustion } from '../conditions.js';
import {
  applyDamageToVitals,
  grantTemporaryHp,
  heal,
  resolveDeathSave,
  stabilize,
} from '../vitals.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
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
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type VitalsEvent = Extract<GameEvent, { type: (typeof VITALS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isVitalsEvent = seamOf(VITALS_EVENTS);

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
      const outcome = applyDamageToVitals(
        creature.vitals,
        event.amount,
        event.critical === undefined ? {} : { critical: event.critical },
      );
      // A dealer overwrites the last one; damage from nothing in the game
      // leaves whatever was there, because a falling rock does not make the
      // thug who stabbed you a moment ago un-stabbed you. The window closes on
      // its own when the turn or the clock moves.
      return withCreature(
        next,
        event.id,
        {
          vitals: outcome.vitals,
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
      return withCreature(
        next,
        event.id,
        { vitals: grantTemporaryHp(creature.vitals, event.amount) },
        creature,
      );
    }

    case 'temporary-hp-cleared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, temporaryHp: 0 } },
        creature,
      );
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

    case 'condition-applied': {
      const creature = creatureOf(state, event, event.id);
      const conditions = applyCondition(creature.conditions, event.condition, event.source);
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
      return withCreature(next, event.id, { conditions }, creature);
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
