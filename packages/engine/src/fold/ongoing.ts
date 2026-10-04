/**
 * The spell that is running: the ongoing record, what it holds, and the two
 * ways it ends.
 *
 * `ongoing`, `castingsEnded`, the Concentration a creature holds and the area
 * effects a casting still owes. Every ending converges on `release.ts`, which
 * is the single door; this seam is what asks it.
 */
import { upgradeOngoing } from '../ongoing-compatibility.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
  sortedRecord,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import { casterOf, holdsNothingOf, releaseCasting, releaseOnTarget, releaseGrants } from './release.js';
import { castingSource } from '../spells.js';
import { raiseAreaArrivals } from './areas.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const ONGOING_EVENTS = [
  'spell-ongoing',
  'spell-ended',
  'spell-activated',
  'spell-option-changed',
  'area-effect-settled',
  'flame-tested',
  'casting-save-recorded',
  'spell-origin-moved',
  'spell-copies-moved',
  'casting-area-burning',
  'spell-aim-changed',
  'way-in-drawn',
  'way-in-height-declared',
  'concentration-started',
  'concentration-ended',
  'spell-fizzled',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type OngoingEvent = Extract<GameEvent, { type: (typeof ONGOING_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isOngoingEvent = seamOf(ONGOING_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyOngoing({ state, next, legacy }: Applying, event: OngoingEvent): GameState {
  switch (event.type) {
    case 'spell-ongoing': {
      const casting = event.casting;
      if (state.ongoing[casting.castingId] !== undefined) {
        throw new CorruptLogError(event, `${casting.castingId} is already running`);
      }
      // The casting has to have happened. A record for a casting nobody cast
      // is the shape of every "the model made it up" failure this engine
      // exists to refuse, and the counter is the one fact that proves it.
      if (Number(casting.castingId.slice('cast:'.length)) > state.castingsBegun) {
        throw new CorruptLogError(event, `${casting.castingId} has not been cast`);
      }
      // And it has to still be running. `releaseCasting` is the single place a
      // record is removed, so a record arriving for a casting that has already
      // been through it is a spell coming back from the dead — visible again
      // to Dispel Magic, to the turn boundary and to every area detector, by
      // exactly the route that "one door out" was meant to close.
      if (state.castingsEnded.includes(casting.castingId)) {
        throw new CorruptLogError(event, `${casting.castingId} has already ended`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...state.ongoing,
          // A record older than this engine is brought up to date here and
          // nowhere else, so every later read is of a record rather than of
          // the catalogue.
          //
          // **The state read is here rather than in the compatibility module
          // because only this moment has it.** A record below version 3 stored
          // the whole of "on", and what version 3 stores is the half of it the
          // world does not already hold — so the upgrade has to ask the
          // creatures. It is correct at exactly this point: the record is
          // written last in every resolution path, so everything the casting
          // holds is already on them, and the subset computed here is the one
          // the cast would have written.
          [casting.castingId]: upgradeOngoing(
            casting,
            (who) => holdsNothingOf(state, who, casting.castingId),
            legacy === null ? null : legacy.spell,
          ),
        }),
      };
    }

    case 'spell-ended': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // Two operations the engine has had since Hold Person's repeat save, and
      // the event says which: one creature shakes it off, or the whole spell
      // stops.
      return event.on === null
        ? releaseCasting(next, casterOf(state, event.castingId), event.castingId)
        : releaseOnTarget(next, event.on, event.castingId);
    }

    // Changes nothing for all but one spell, like `roll-recorded`: the action it
    // cost and the damage it dealt are their own events. It is here so the log
    // can say why a spell struck on a turn nobody cast it.
    //
    // **The one thing it writes is a creature the action named.** SRD Detect
    // Thoughts' probe turns a Range: Self casting on one mind, and the check the
    // book then offers that creature has to be narrowed to it — so the name is
    // pinned on the record here, which is the only place it could be: the cast
    // aimed at nobody, and nothing in the world holds the fact. Replaced rather
    // than joined, because "you shift your attention away from the target's
    // mind" is a sentence about one mind at a time.
    case 'spell-activated': {
      if (event.singledOut === undefined) return next;
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...next.ongoing,
          [event.castingId]: { ...record, singledOut: event.singledOut },
        }),
      };
    }

    // SRD Alter Self's swap: what the casting hung on its caster goes, and the
    // word is re-pinned. The caster's grants alone — a re-choosing spell is
    // Range: Self, and a casting that hung anything elsewhere would be one the
    // validator refused the field to.
    case 'spell-option-changed': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      const caster = next.creatures[record.caster];
      return {
        ...next,
        ...(caster === undefined
          ? {}
          : {
              creatures: {
                ...next.creatures,
                [record.caster]: releaseGrants(caster, castingSource(record.spell, record.castingId)),
              },
            }),
        ongoing: { ...next.ongoing, [event.castingId]: { ...record, option: event.option } },
      };
    }

    // **A protected flame tested** — SRD Gust of Wind. The debt goes, and a
    // flame that went out takes its light with it; a lantern that held burns
    // on, and the area owes it nothing more until it is moved onto it again.
    // (E-L2)
    case 'flame-tested': {
      const at = state.owedAreaEffects.findIndex(
        (owed) =>
          owed.castingId === event.castingId && owed.target === event.patch && owed.moment === 'flame-reached',
      );
      if (at < 0) {
        throw new CorruptLogError(event, `${event.castingId} owes the flame ${event.patch} no throw`);
      }
      const owedAreaEffects = [...state.owedAreaEffects.slice(0, at), ...state.owedAreaEffects.slice(at + 1)];
      const scene = next.scene;
      if (!event.out || scene === null || scene.light[event.patch] === undefined) {
        return { ...next, owedAreaEffects };
      }
      const { [event.patch]: _gone, ...light } = scene.light;
      void _gone;
      return { ...next, owedAreaEffects, scene: { ...scene, light } };
    }

    case 'area-effect-settled': {
      const at = state.owedAreaEffects.findIndex(
        (owed) =>
          owed.castingId === event.castingId &&
          owed.target === event.target &&
          owed.moment === event.moment,
      );
      if (at < 0) {
        throw new CorruptLogError(
          event,
          `${event.castingId} owes ${event.target} nothing at ${event.moment}`,
        );
      }
      return {
        ...next,
        owedAreaEffects: [
          ...state.owedAreaEffects.slice(0, at),
          ...state.owedAreaEffects.slice(at + 1),
        ],
      };
    }

    // **The one event whose whole consequence is that somebody now knows.**
    // SRD Zone of Truth's failure imposes nothing this engine holds, so the
    // verdict is the effect: it is written onto the casting that threw the
    // save, keyed by who, and `observe()` publishes it. Nothing else in the
    // fold reads it — no condition, no timer, no grant — which is exactly the
    // condition the gate put on the engine holding a fact only the table
    // reads.
    //
    // **An upsert, and sorted.** The book asks again rather than remembering,
    // so a creature that walks out of the Sphere and back in replaces its own
    // answer and does not accumulate one per visit; and two logs that asked in
    // different orders have to fold to one state, which a list kept in `who`
    // order gives for free.
    case 'casting-save-recorded': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      const kept = [
        ...(record.saves ?? []).filter((one) => one.who !== event.target),
        { who: String(event.target), failed: event.failed },
      ].sort((a, b) => (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
      return {
        ...next,
        ongoing: { ...next.ongoing, [event.castingId]: { ...record, saves: kept } },
      };
    }

    // SRD Web's Cube set alight: added to the record's burning Cubes, which
    // the turn boundary reads for the fire and the fold's own pass burns away
    // when the deadline arrives. (E-L2)
    case 'casting-area-burning': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      const same = (p: { readonly x: number; readonly y: number; readonly z: number }) =>
        p.x === event.space.x && p.y === event.space.y && p.z === event.space.z;
      if ((record.burning ?? []).some((cube) => same(cube.space)) || (record.burnt ?? []).some(same)) {
        throw new CorruptLogError(event, `${event.castingId} is already burning there`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...next.ongoing,
          [event.castingId]: {
            ...record,
            burning: [
              ...(record.burning ?? []),
              { space: event.space, until: event.until, dice: event.dice, damageType: event.damageType },
            ],
          },
        }),
      };
    }

    // SRD Dancing Lights' other lights, moved by the Bonus Action: the list as
    // it now stands. A casting that never laid copies cannot have moved any,
    // and a list of another length is a log and a set of rules that disagree.
    // (E-L2)
    case 'spell-copies-moved': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      if (record.copies === undefined || record.copies.length !== event.copies.length) {
        throw new CorruptLogError(event, `${event.castingId} does not hold ${event.copies.length} other templates`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...next.ongoing,
          [event.castingId]: { ...record, copies: event.copies },
        }),
      };
    }

    case 'spell-origin-moved': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // A casting that never held a point cannot have moved one. The command
      // refuses this; a hand-built log that does it anyway is a log and a set
      // of rules that disagree, which is loud rather than absorbed.
      const from = record.origin;
      if (from === undefined) {
        throw new CorruptLogError(event, `${event.castingId} holds no point to move`);
      }
      // The point moves, and then the area it defines is asked who it arrived
      // on. Derived rather than carried on the event for the reason every
      // other consequence in this file is derived: nobody *decides* that a
      // beam swept over somebody, and a replay reconstructs it because the
      // fold does.
      // **And the turn a carry happened on**, for the one rule that has to count
      // moves rather than actions: SRD Conjure Animals' pack rides the caster's
      // own movement, and a creature may break one move into six commands.
      //
      // **Only a carry, which is what the event says.** An action is its own cap —
      // Moonbeam's walk *is* the Magic action — so a beam walked by an activation
      // writes no flag and this writes no stamp, and every log written before the
      // field folds to exactly the state it always folded to. Absent outside a
      // fight too, where there is no turn to count. See `OngoingSpell.movedOnTurn`.
      const turn = event.carried === true ? state.combat?.turnsTaken : undefined;
      const moved: GameState = {
        ...next,
        ongoing: {
          ...state.ongoing,
          [event.castingId]: {
            ...record,
            origin: event.to,
            ...(turn === undefined ? {} : { movedOnTurn: turn }),
          },
        },
      };
      return raiseAreaArrivals(moved, event.castingId, from, event.to);
    }

    case 'spell-aim-changed': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // A casting whose area was never pointed anywhere has no bearing to
      // change. The command refuses this; a hand-built log that does it anyway
      // is a log and a set of rules that disagree, which is loud rather than
      // absorbed — the reading `spell-origin-moved` above takes of a casting
      // that holds no point.
      if (record.towards === undefined) {
        throw new CorruptLogError(event, `${event.castingId} has no direction to change`);
      }
      // **And nothing is raised.** The Line blasts from the caster, so turning
      // it sweeps no floor: SRD Gust of Wind prints its recurring save at the
      // end of a creature's turn, and that trigger reads this bearing when the
      // moment arrives. See the event's own note.
      return {
        ...next,
        ongoing: { ...state.ongoing, [event.castingId]: { ...record, towards: event.towards } },
      };
    }

    // **The rope drawn up or let down** — W9-S3. The casting has to be
    // running and to hold the point its way in hangs from; the command refuses
    // both, and a hand-built log that does either is loud rather than absorbed,
    // on `spell-origin-moved`'s reading.
    case 'way-in-drawn': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      if (record.origin === undefined) {
        throw new CorruptLogError(event, `${event.castingId} holds no point for a way in to hang from`);
      }
      const { wayInClosed: _was, ...rest } = record;
      void _was;
      return {
        ...next,
        ongoing: { ...state.ongoing, [event.castingId]: event.closed ? { ...rest, wayInClosed: true } : rest },
      };
    }

    // **How high the way in hangs**, the table's to say. The same two guards.
    case 'way-in-height-declared': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      if (record.origin === undefined) {
        throw new CorruptLogError(event, `${event.castingId} holds no point for a way in to hang from`);
      }
      return {
        ...next,
        ongoing: { ...state.ongoing, [event.castingId]: { ...record, wayInHeight: event.feet } },
      };
    }

    case 'concentration-started': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already concentrating on ${creature.concentration.castingId}`,
        );
      }
      // **A line held under Concentration switches its feature on in the same
      // breath** — M-REFLEX. Two events would leave a moment, between them,
      // with one half standing and `settleConcentratedFeatures` ending it.
      if (event.feature === true) {
        if (creature.activeFeatures.includes(event.castingId)) {
          throw new CorruptLogError(event, `${event.id} is already in ${event.castingId}`);
        }
        return withCreature(
          next,
          event.id,
          {
            concentration: {
              castingId: event.castingId,
              spell: event.spell,
              level: event.level,
              feature: true,
            },
            activeFeatures: [...creature.activeFeatures, event.castingId].sort(),
          },
          creature,
        );
      }
      return withCreature(
        next,
        event.id,
        {
          concentration: { castingId: event.castingId, spell: event.spell, level: event.level },
        },
        creature,
      );
    }

    case 'concentration-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration?.castingId !== event.castingId) {
        throw new CorruptLogError(event, `${event.id} is not concentrating on ${event.castingId}`);
      }
      return releaseCasting(next, event.id, event.castingId);
    }

    // **A casting made and failed** — SRD Slow's gestures. The `spell-cast`
    // before it spent the slot and may have begun a Concentration and a
    // deadline; this ends the casting through the one door out, which takes
    // both. The casting has to have been made, and to have been settled rather
    // than still held open: a declaration that fails is `spell-interrupted`'s,
    // and one that never happened is a fumble the log invented. (W7-S22)
    case 'spell-fizzled': {
      if (Number(event.castingId.slice('cast:'.length)) > state.castingsBegun) {
        throw new CorruptLogError(event, `${event.castingId} has not been cast`);
      }
      if (state.pendingCastings[event.castingId] !== undefined) {
        throw new CorruptLogError(event, `${event.castingId} is still being cast`);
      }
      return releaseCasting(next, event.id, event.castingId);
    }
  }

  return unhandledEvent(event);
}
