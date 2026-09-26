/**
 * Where everything is: the scene, and every event that moves a creature in it.
 *
 * Three of these are **authoritative transitions** — a creature arriving,
 * mounting and dismounting — so each asks `raiseAfterMovement` who it has just
 * carried into an area. A declared move is an intent rather than an arrival
 * and is `holds.ts`.
 */
import type { CharacterId } from '@ie/shared';
import {
  addLandmark,
  altitudeOf,
  declareCover,
  declareDifficultPatch,
  declareLightPatch,
  declareObscuringPatch,
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
import { must, sceneOf, seamOf, unhandledEvent, withCreature, type Applying } from './common.js';
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
  'difficult-terrain-declared',
  'light-declared',
  'obscurement-declared',
  'mounted',
  'dismounted',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type SceneEvent = Extract<GameEvent, { type: (typeof SCENE_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isSceneEvent = seamOf(SCENE_EVENTS);

/**
 * SRD Levitate: "You can change the target's altitude by up to 20 feet in
 * either direction on your turn. If you are the target, you can move up or
 * down as part of your move."
 *
 * The feet a held-up creature was moved vertically on the current turn,
 * stamped onto every hold it carries — see `GrantedLift.altered`. **The turn
 * is read here and not carried**, on `jump-allowance-spent`'s rule: the fold
 * has the order in front of it, and an event stating a turn number would be a
 * second answer to what turn it is. Outside combat there is no turn and
 * nothing is written, which leaves the altitude uncapped — the reading every
 * once-per-turn rule in this engine takes. A move that changed no altitude,
 * or a creature nothing is holding up, is left alone; the *first* lift's own
 * rise arrives before the hold does and so is stamped on nothing, which is
 * right: the casting's twenty feet up are the casting's, not the turn's.
 *
 * Every hold is stamped and the **reader** decides whose cap it is:
 * `commands/movement.ts` caps a mover only against a hold whose casting is
 * the mover's own, because the twenty is the caster's to spend.
 *
 * **And a move somebody else made is not the creature's to be charged for.**
 * A shove, a printed push and a pull all arrive here as an altitude-changing
 * `creature-moved` on a held creature, and `checkLevitating` exempts every one
 * of them by name — "it is not the creature's movement" — so counting them
 * here made the two halves of one rule disagree: a wizard thrown ten feet down
 * the wall by a Thunderwave had ten feet of their own climb taken away by it.
 * `forced` is the flag that says whose movement it was, and this is the third
 * road the docstring used to take silently. (W7-S19R)
 *
 * **What that leaves out, deliberately and not yet closed:** the caster's own
 * Magic action moves a held creature with a `forced` move too — it is not the
 * creature's movement either — so its feet are not counted here, and a caster
 * holding themself up who takes the action first and climbs afterwards spends
 * the twenty twice.
 *
 * Telling that move from a shove needs a fact the event does not carry, and
 * **the shape of a placement is not that fact**: a fall writes the same
 * `{ feet: 0, elevation: -n, forced: true }` an altitude change does, so a
 * guess read off the geometry would charge a wizard's own allowance for
 * falling. Closing it is a marker on `creature-moved` saying whose allowance a
 * move spends, which is a decision nobody has taken; until somebody does, the
 * half that is enforced is the half the activation refuses and this docstring
 * is where the other half is written down. Not SRD Levitate's `unmodelled`,
 * which hands a clause to the table, and this is nothing a DM adjudicates.
 */
function stampAltitudeAltered(
  state: GameState,
  id: CharacterId,
  before: number | null,
  after: number | null,
  forced: boolean,
): GameState {
  if (forced || before === null || after === null || before === after) return state;
  const creature = state.creatures[id];
  if (creature === undefined || creature.lifts.length === 0) return state;
  const turn = state.combat?.turnsTaken ?? null;
  if (turn === null) return state;
  const feet = Math.abs(after - before);
  const lifts = creature.lifts.map((held) => ({
    ...held,
    altered: { turn, feet: (held.altered?.turn === turn ? held.altered.feet : 0) + feet },
  }));
  return withCreature(state, id, { lifts }, creature);
}

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
      return { ...next, scene: scene(event.extent, event.light ?? null) };

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
          // A shove, or a printed line that lands the mover among others (W7-B9):
          // the one rule either relaxes is ending in an occupied space.
          event.forced === undefined && event.intoOccupied === undefined
            ? {}
            : { forced: event.forced === true || event.intoOccupied === true },
        ),
      );
      // **The authoritative transition, and the only one that is entry.** A
      // declared move is an intent an Opportunity Attack can end; this is the
      // creature actually arriving. Forced movement lands here too, because a
      // creature shoved into a Web has entered it.
      //
      // And the vertical feet a held-up creature was moved, stamped onto the
      // hold — see {@link stampAltitudeAltered}.
      return stampAltitudeAltered(
        raiseAfterMovement({ ...next, scene: outcome.state }, state.scene),
        event.id,
        altitudeOf(sceneOf(state, event), event.id),
        altitudeOf(outcome.state, event.id),
        event.forced === true,
      );
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

    // A declared fact about the ground, held beside the declared facts about
    // sight and cover. Nothing is raised by it: terrain changes what a move
    // costs and catches nobody, so it is a property of the scene and not a
    // moment in it.
    case 'difficult-terrain-declared':
      return {
        ...next,
        scene: must(
          event,
          declareDifficultPatch(
            sceneOf(state, event),
            event.patch,
            event.region,
            event.costPerFoot,
            event.source,
            event.clears,
            {
              ...(event.damagePerFeet === undefined ? {} : { damagePerFeet: event.damagePerFeet }),
              ...(event.onlyTowards === undefined ? {} : { onlyTowards: event.onlyTowards }),
            },
          ),
        ),
      };

    // The second and third consumers of the same patch shape, reduced exactly
    // as the ground is and raising nothing for the same reason: light changes
    // what a creature can see and catches nobody, so it is a property of the
    // scene rather than a moment in it.
    case 'light-declared':
      return {
        ...next,
        scene: must(
          event,
          declareLightPatch(sceneOf(state, event), event.patch, event.region, event.level, {
            ...(event.source === undefined ? {} : { source: event.source }),
            ...(event.magical === undefined ? {} : { magical: event.magical }),
            ...(event.sunlight === undefined ? {} : { sunlight: event.sunlight }),
          }),
        ),
      };

    case 'obscurement-declared':
      return {
        ...next,
        scene: must(
          event,
          declareObscuringPatch(
            sceneOf(state, event),
            event.patch,
            event.region,
            event.degree,
            event.source,
          ),
        ),
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
