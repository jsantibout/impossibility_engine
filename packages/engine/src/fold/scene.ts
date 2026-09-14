/**
 * Where everything is: the scene, and every event that moves a creature in it.
 *
 * Three of these are **authoritative transitions** — a creature arriving,
 * mounting and dismounting — so each asks `raiseAfterMovement` who it has just
 * carried into an area. A declared move is an intent rather than an arrival
 * and is `holds.ts`.
 */
import {
  addLandmark,
  declareCover,
  declareSight,
  dismount,
  mount,
  moveCreature,
  placeCreature,
  removeCreature,
  scene,
} from '../positioning.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { must, sceneOf, seamOf, unhandledEvent, type Applying } from './common.js';
import { raiseAfterMovement } from './areas.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const SCENE_EVENTS = [
  'scene-set',
  'landmark-added',
  'creature-placed',
  'creature-moved',
  'creature-unplaced',
  'sight-declared',
  'cover-declared',
  'mounted',
  'dismounted',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type SceneEvent = Extract<GameEvent, { type: (typeof SCENE_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isSceneEvent = seamOf(SCENE_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyScene({ state, next }: Applying, event: SceneEvent): GameState {
  switch (event.type) {
    case 'scene-set':
      return { ...next, scene: scene(event.extent) };

    case 'landmark-added':
      return { ...next, scene: must(event, addLandmark(sceneOf(state, event), event.name, event.at)) };

    case 'creature-placed':
      return {
        ...next,
        scene: must(event, placeCreature(sceneOf(state, event), event.id, event.placement)),
      };

    case 'creature-moved': {
      const outcome = must(
        event,
        moveCreature(
          sceneOf(state, event),
          event.id,
          event.placement,
          event.forced === undefined ? {} : { forced: event.forced },
        ),
      );
      // **The authoritative transition, and the only one that is entry.** A
      // declared move is an intent an Opportunity Attack can end; this is the
      // creature actually arriving. Forced movement lands here too, because a
      // creature shoved into a Web has entered it.
      return raiseAfterMovement({ ...next, scene: outcome.state }, state.scene);
    }

    case 'creature-unplaced':
      return { ...next, scene: must(event, removeCreature(sceneOf(state, event), event.id)) };

    case 'sight-declared':
      return {
        ...next,
        scene: must(event, declareSight(sceneOf(state, event), event.from, event.to, event.seen)),
      };

    case 'cover-declared':
      return {
        ...next,
        scene: must(event, declareCover(sceneOf(state, event), event.from, event.to, event.degree)),
      };

    // Mounting and dismounting move a creature to a space it was not in — SRD
    // charges half your Speed for the first — so both are authoritative
    // transitions and both can carry somebody into an area.
    case 'mounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(
            event,
            mount(sceneOf(state, event), event.rider, event.mount, { willing: event.willing }),
          ),
        },
        state.scene,
      );

    case 'dismounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(event, dismount(sceneOf(state, event), event.rider, event.placement)),
        },
        state.scene,
      );
  }

  return unhandledEvent(event);
}
