/**
 * The casting being made: `pendingCastings` and the sequence that names one.
 *
 * A casting is declared, may be held open across turns or interrupted, and
 * settles at `spell-cast`. The spell that is left **running** afterwards is a
 * different record in a different seam — `ongoing.ts` — which is the same cut
 * `commands/casting.ts` and `commands/ongoing.ts` already make one layer up.
 */
import { spend as spendResource } from '../resources.js';
import { markSpellSlotSpent } from '../combat.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  castingIdFor,
  combatOf,
  creatureOf,
  must,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import { releaseCasting, withPendingCasting, withoutPendingCasting } from './release.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const CASTING_EVENTS = [
  'spell-declared',
  'spell-interrupted',
  'spell-cast',
  'casting-continued',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type CastingEvent = Extract<GameEvent, { type: (typeof CASTING_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isCastingEvent = seamOf(CASTING_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyCasting({ state, next }: Applying, event: CastingEvent): GameState {
  switch (event.type) {
    case 'spell-declared': {
      // **Purely id-based, and there is deliberately no per-caster throw.**
      // The reducer is the corrupt-log backstop for *identity*, and two
      // castings by one caster is not an identity fact: SRD permits it, and
      // what refuses a second casting is the action economy, the turn's one
      // slot, or Concentration's single door. A duplicate id is impossible in
      // practice because of the sequence check below — which is exactly what
      // makes this the backstop rather than the rule.
      if (state.pendingCastings[event.casting.castingId] !== undefined) {
        throw new CorruptLogError(
          event,
          `${event.casting.castingId} is already waiting to resolve`,
        );
      }
      creatureOf(state, event, event.casting.caster);

      // The id is allocated here, so this is the event that advances the
      // sequence. The `spell-cast` that settles it must not advance it again.
      const expected = castingIdFor(state.castingsBegun + 1);
      if (event.casting.castingId !== expected) {
        throw new CorruptLogError(
          event,
          `expected casting ${expected}, got ${event.casting.castingId}`,
        );
      }

      return {
        ...next,
        castingsBegun: state.castingsBegun + 1,
        pendingCastings: withPendingCasting(state.pendingCastings, event.casting),
      };
    }

    case 'spell-interrupted': {
      if (state.pendingCastings[event.castingId] === undefined) {
        throw new CorruptLogError(event, `no casting ${event.castingId} is waiting to resolve`);
      }
      // Nothing is given back. The action was wasted by the same SRD sentence
      // that spares the slot, and the slot was never spent.
      //
      // **Through the single door, which this case used not to need.** It
      // cleared the pending record itself, and that was complete while no
      // pending casting could be concentrated on. A casting of a minute or
      // more is concentrated on from its declaration, and SRD Counterspell
      // says "the spell dissipates with no effect" — so a caster left
      // concentrating on it would be holding a casting that no longer exists,
      // permanently, and rolling a Constitution save on every later hit for a
      // spell that is not there. `releaseCasting` is where every other ending
      // converges and already answers exactly this; for an ordinary casting it
      // finds no Concentration and does what this line always did.
      return releaseCasting(next, event.id, event.castingId);
    }

    case 'spell-cast': {
      const creature = creatureOf(state, event, event.id);

      // Two shapes reach this event and they are not the same. A casting held
      // open since `spell-declared` **settles** here: its id was allocated
      // then, so the sequence does not move again and the window closes. Every
      // other casting is declared and resolved in one breath, and allocates
      // its own id exactly as it always has — which is why every log written
      // before interruptible castings existed still folds unchanged.
      //
      // Matching on the id rather than on "is anything pending" is what lets a
      // Counterspell be cast *while* a casting is open: its own `spell-cast`
      // is a different casting and takes the ordinary branch. That was already
      // the reading when there was one slot, which is why the keyed record
      // needed nothing of this case but the lookup.
      const settling = state.pendingCastings[event.castingId] !== undefined;

      if (!settling) {
        // Casting ids run in sequence. Applying a batch twice — a retried
        // command appended a second time — lands here with an id that is no
        // longer next, which is a corrupt log rather than a second casting.
        const expected = castingIdFor(state.castingsBegun + 1);
        if (event.castingId !== expected) {
          throw new CorruptLogError(event, `expected casting ${expected}, got ${event.castingId}`);
        }
      }

      const resources =
        event.slot === null
          ? creature.resources
          : must(event, spendResource(creature.resources, event.slot.key));

      const cast = withCreature(next, event.id, { resources }, creature);
      return {
        ...cast,
        castingsBegun: settling ? state.castingsBegun : state.castingsBegun + 1,
        ...(settling ? { pendingCastings: withoutPendingCasting(state, event.castingId) } : {}),
        // SRD: "On a turn, you can expend only one spell slot to cast a spell."
        // It reads *expenditure*, so a casting whose slot is still unspent has
        // not used the turn's one slot — and a countered one never will.
        combat:
          event.slot === null || cast.combat === null
            ? cast.combat
            : markSpellSlotSpent(cast.combat, event.id),
      };
    }

    // SRD "Longer Casting Times": the Magic action a casting of a minute or
    // more costs on each of the caster's turns. The *failure* is derived at the
    // boundary; taking the action is a decision, so it is this event, and all
    // it does is record which turn saw it.
    //
    // **Three identity facts and no economy.** The backstop here is what a
    // reducer is for — that the casting exists, belongs to this creature and is
    // one the Magic action is owed on. Whether the caster had an Action to
    // spend and whether it was their turn is the `action-spent` the command
    // always emits beside this one, folded through `spendAction`, exactly as
    // `spell-declared` leaves its own economy to the `action-spent` above it.
    case 'casting-continued': {
      const combat = combatOf(state, event);
      const pending = state.pendingCastings[event.castingId];
      if (pending === undefined) {
        throw new CorruptLogError(event, `no casting ${event.castingId} is waiting to resolve`);
      }
      if (pending.caster !== event.id) {
        throw new CorruptLogError(
          event,
          `${event.castingId} is ${pending.caster}'s casting, not ${event.id}'s`,
        );
      }
      if (pending.completesAt === undefined) {
        throw new CorruptLogError(
          event,
          `${event.castingId} takes no more than an instant and is not taken up again`,
        );
      }
      return {
        ...next,
        pendingCastings: {
          ...state.pendingCastings,
          [event.castingId]: { ...pending, sustainedOnTurn: combat.turnsTaken },
        },
      };
    }
  }

  return unhandledEvent(event);
}
