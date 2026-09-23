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
export const FEATURES_EVENTS = [
  'feature-activated',
  'feature-ended',
  'shape-assumed',
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
