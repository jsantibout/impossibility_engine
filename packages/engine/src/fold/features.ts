/**
 * What a creature has switched on, and what it is holding.
 *
 * `activeFeatures` and `readied` are one seam because one event writes both:
 * releasing a Ready drops the hold **and** the `action:ready` feature that
 * was carrying its deadline. The passes that end either without anybody
 * deciding to — `endLostFeatures` and `dropLapsedReady` — are derived and
 * live with the other derived passes in `apply.ts`.
 */
import type { CharacterId } from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
import { READY } from '../actions.js';
import { concentratedLines } from '../character.js';
import { removeConditionInstance } from '../conditions.js';
import type { GameEvent } from '../events.js';
import type { CreatureState, GameState } from '../state.js';
import { type TimedEffect, timerKey } from '../timers.js';
import { attackRollMadeBy } from './endings.js';
import { printedLineSource } from '../monster.js';
import {
  CorruptLogError,
  creatureOf,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const FEATURES_EVENTS = [
  'feature-activated',
  'feature-ended',
  'shape-assumed',
  'form-assumed',
  'readied-declared',
  'readied-released',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type FeaturesEvent = Extract<GameEvent, { type: (typeof FEATURES_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isFeaturesEvent = seamOf(FEATURES_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyFeatures({ state, next }: Applying, event: FeaturesEvent): GameState {
  switch (event.type) {
    case 'feature-activated': {
      const creature = creatureOf(state, event, event.id);
      if (creature.activeFeatures.includes(event.feature)) {
        throw new CorruptLogError(event, `${event.id} is already in ${event.feature}`);
      }
      return withCreature(
        next,
        event.id,
        { activeFeatures: [...creature.activeFeatures, event.feature].sort() },
        creature,
      );
    }

    case 'feature-ended': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { activeFeatures: creature.activeFeatures.filter((f) => f !== event.feature) },
        creature,
      );
    }

    case 'shape-assumed': {
      const creature = creatureOf(state, event, event.id);
      if (!creature.activeFeatures.includes(event.feature)) {
        throw new CorruptLogError(
          event,
          `${event.id} took a form under ${event.feature}, which is not running`,
        );
      }
      // A second form laid over a first the fold has not yet put back keeps
      // the *first* original: the character's own sheet is the only one that
      // is anybody's to restore, and a Wolf's is not.
      const original = creature.shape?.original ?? {
        sheet: creature.sheet,
        size: creature.size,
        sceneSize: next.scene?.sizes[event.id] ?? null,
      };
      const worn = withCreature(
        next,
        event.id,
        {
          sheet: event.sheet,
          size: event.size,
          shape: { feature: event.feature, form: event.form, original },
        },
        creature,
      );
      return resized(worn, event.id, event.size);
    }

    case 'form-assumed': {
      const creature = creatureOf(state, event, event.id);
      // Kept from the **first** change, exactly as the shape above keeps its:
      // a werewolf going wolf-to-hybrid without passing through its own skin
      // must still have its own skin to go back to.
      const original = creature.form?.original ?? {
        sheet: creature.sheet,
        size: creature.size,
        sceneSize: next.scene?.sizes[event.id] ?? null,
      };
      const changed = withCreature(
        next,
        event.id,
        {
          sheet: event.sheet,
          size: event.size,
          form: { name: event.form, line: event.line, original },
        },
        creature,
      );
      // The scene's copy follows the form, which is the owner's ruling of
      // 2026-09-20 about Wild Shape and the same question. A form whose line
      // prints no size is the creature's own, so the footprint goes back to
      // what it was before any form was taken.
      const footprint = event.size ?? original.sceneSize ?? original.size;
      return footprint === null ? changed : resized(changed, event.id, footprint);
    }

    case 'readied-declared': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied !== null) {
        throw new CorruptLogError(event, `${event.id} is already holding a readied action`);
      }
      return withCreature(next, event.id, { readied: event.readied }, creature);
    }

    case 'readied-released': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied === null) {
        throw new CorruptLogError(event, `${event.id} has no readied action to release`);
      }
      return withCreature(
        next,
        event.id,
        {
          readied: null,
          activeFeatures: creature.activeFeatures.filter((f) => f !== READY),
        },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}

/**
 * A stat block's line held under Concentration, kept in step with the
 * Concentration that holds it up — M-REFLEX.
 *
 * SRD Will-o'-Wisp's Vanish: "The wisp and its light have the Invisible
 * condition until the wisp's Concentration ends on this effect, which ends
 * early immediately after the wisp makes an attack roll or uses Consume Life."
 * SRD Darkmantle's Darkness Aura: "This effect lasts while the darkmantle
 * maintains Concentration on it, up to 10 minutes."
 *
 * **Derived, and the reason is the number of doors.** A Concentration ends by
 * a failed save, the Incapacitated condition, a death, a second Concentration
 * and a dismissal, and each of them reaches `releaseCasting` knowing nothing of
 * features; a feature ends by its deadline (`expireEffects`) and by an ending
 * somebody states. Every one of them takes away one half of the pair, and this
 * takes away the other, so no road out of either can leave a Darkness standing
 * with nobody concentrating on it or a Concentration held on nothing.
 *
 * **And the two early endings the line prints**, read off this one event: an
 * attack roll its holder made — the reading SRD Invisibility's clause is given
 * (`attackRollMadeBy`) — and a use of a line the record names, which is the
 * `stated-action-taken` or `stated-bonus-action-taken` every door that spends a
 * printed line writes.
 *
 * What goes with the feature: the Concentration, every condition hung under the
 * line's `printedLineSource` **on any creature** — the holder's own Invisible,
 * or the Charmed a save line's failure lands on its targets — and the deadlines
 * that would have ended the feature or those instances. The light it laid and
 * the light it withheld are derived off `activeFeatures`, so they go by
 * themselves. `beginPrintedConcentration` is the door in; this is the one way
 * out, whichever road a line is taken by.
 */
export function settleConcentratedFeatures(state: GameState, event: GameEvent): GameState {
  let anyHeld = false;
  for (const key in state.creatures) {
    const creature = state.creatures[key];
    if (creature === undefined) continue;
    if (creature.activeFeatures.length > 0 || creature.concentration?.feature === true) {
      anyHeld = true;
      break;
    }
  }
  if (!anyHeld) return state;

  const attacker = attackRollMadeBy(state, event);
  const used =
    event.type === 'stated-action-taken' || event.type === 'stated-bonus-action-taken'
      ? { who: event.id, line: event.line }
      : null;

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  const timers: Record<string, TimedEffect> = { ...state.timers };
  let changed = false;
  // The sources whose effect has ended this event, whoever it was hung on.
  const ended = new Set<string>();
  for (const key of Object.keys(state.creatures).sort()) {
    const creature = creatures[key];
    if (creature === undefined) continue;
    const lines = concentratedLines(creature.sheet);
    if (lines.length === 0) continue;

    let updated = creature;
    for (const { name, concentrates } of lines) {
      const feature = concentrates.feature;
      const held =
        updated.concentration?.feature === true && updated.concentration.castingId === feature;
      const endedByDeed =
        (concentrates.endsAfter?.attackRoll === true && attacker === creature.id) ||
        (used !== null &&
          used.who === creature.id &&
          (concentrates.endsAfter?.lines ?? []).some(
            (line) => line.toLowerCase() === used.line.toLowerCase(),
          ));
      const running = updated.activeFeatures.includes(feature) && held && !endedByDeed;
      if (running) continue;
      if (!updated.activeFeatures.includes(feature) && !held) continue;

      // Ending now: every condition the line hung, on anybody, goes below.
      ended.add(printedLineSource(creature.id, name));
      updated = {
        ...updated,
        activeFeatures: updated.activeFeatures.filter((f) => f !== feature),
        ...(held ? { concentration: null } : {}),
      };
      const deadline = timerKey({ kind: 'feature', on: creature.id, feature });
      if (timers[deadline] !== undefined) delete timers[deadline];
      changed = true;
    }
    creatures[key] = updated;
  }

  // **What the line hung, on whoever it hung it on.** SRD Vanish's Invisible
  // is on the wisp; SRD Harpy's Luring Song charms the creatures that failed
  // its save — "until the song ends". A printed line hangs its clauses under
  // `printedLineSource`, so one source names everything the line is holding
  // up, and an ended line takes all of it, with any deadline that would have
  // ended an instance later.
  if (ended.size > 0) {
    for (const key of Object.keys(creatures).sort()) {
      const creature = creatures[key];
      if (creature === undefined) continue;
      const doomed = creature.conditions.instances.filter((instance) => ended.has(instance.source));
      if (doomed.length === 0) continue;
      let conditions = creature.conditions;
      for (const instance of doomed) {
        conditions = removeConditionInstance(conditions, instance.id);
        const deadline = timerKey({ kind: 'condition', on: creature.id, instance: instance.id });
        if (timers[deadline] !== undefined) delete timers[deadline];
      }
      creatures[key] = { ...creature, conditions };
      changed = true;
    }
  }

  return changed ? { ...state, creatures, timers } : state;
}

/**
 * The scene's copy of a creature's size, moved with the creature.
 *
 * SRD Wild Shape leaves the form's footprint on the map — the owner's ruling
 * of 2026-09-20: an oversized form fills the space around it, and where that
 * puts it in somebody else's space the forced-movement rule already answers.
 * Only for a creature that is standing somewhere: one nobody has placed has no
 * copy to move, and `placeCreatureInScene` reads `CreatureState.size` when it
 * is placed later.
 */
export function resized(state: GameState, id: CharacterId, size: CreatureSize): GameState {
  const scene = state.scene;
  if (scene === null || scene.sizes[id] === undefined) return state;
  return { ...state, scene: { ...scene, sizes: { ...scene.sizes, [id]: size } } };
}
