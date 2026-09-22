/**
 * Forced movement a spell causes, and the one place it is performed.
 *
 * `moveCreature` has taken `forced: true` since positioning landed and has
 * reported whose space is being shared, and for as long as it did nothing in
 * the definition format reached it: SRD Thunderwave dealt its damage and moved
 * nobody. This is the missing half — the recurring finding in this repository
 * that a pure function nothing calls is a rule nothing enforces.
 *
 * **One function, because the SRD writes one sentence.** The push is measured
 * *straight away from the caster*, which on this lattice is the bearing from
 * the caster to the creature being shoved, applied from **the creature's own
 * anchor**. Anchoring on the caster instead would add a box-to-box distance to
 * an anchor-to-anchor projection, and those are the same number only while
 * both are Medium — the correction `masteryAfterHit`'s Push and the Shove both
 * already carry, and the reason this reads like them.
 *
 * **A shove that cannot happen is a gap, not a refusal.** The casting has
 * already spent its slot and landed its damage by the time a rider runs, and
 * `creature-moved` is applied by the fold through `must` — so a push into a
 * wall would be a log that cannot be folded rather than a refusal. It is asked
 * before it is written, and what could not happen is said out loud on the
 * casting's `unverified`, exactly as the Push mastery says it.
 */

import { type CharacterId } from '@ie/shared';
import { type GameEvent, type GameState } from '../events.js';
import { bearingBetween, moveCreature } from '../positioning.js';
import { type ForcedMovement } from '../spell-definitions.js';

/** What a shove came to: the event it wrote, or the reason it wrote none. */
export interface PushOutcome {
  readonly events: readonly GameEvent[];
  /** What the engine could not settle, in the caller's own words. */
  readonly unverified: readonly string[];
}

/**
 * Push a creature straight away from the creature that caused it.
 *
 * Takes the world rather than a scene so the two refusals a bare scene cannot
 * answer — nobody has described a room, nobody has said where anybody is
 * standing — come back as the same reported gap as a wall, because by the time
 * a rider runs none of them is a question the caller can still be asked.
 */
export function shoveAwayFrom(
  state: GameState,
  target: CharacterId,
  source: CharacterId,
  movement: ForcedMovement,
  /** What the log calls the thing that pushed: the spell's name. */
  name: string,
): PushOutcome {
  const scene = state.scene;
  if (scene === null) {
    return {
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${target} was not pushed`],
    };
  }

  // Two creatures in the same space have no bearing between them, and that is
  // the honest answer rather than north: SRD's "straight away from yourself"
  // names no direction when there is no distance.
  const bearing = bearingBetween(scene, source, target);
  if (!bearing.ok) return { events: [], unverified: [`${name}: ${bearing.reason}`] };

  const placement = {
    from: { creature: target },
    feet: movement.feet,
    bearing: bearing.value,
  } as const;

  // SRD: "You can't **willingly** end a move in a space occupied by another
  // creature." A shove is the "somehow" that rule leaves room for, so
  // occupancy does not stop it — `forced: true` is what says so, and it is the
  // same flag the fold applies this event under.
  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) {
    return { events: [], unverified: [`${name}: ${target} could not be pushed: ${moved.reason}`] };
  }

  // Nobody spent their Speed on this, nobody provoked anything, and no
  // Difficult Terrain was charged — a shove is not the creature's movement.
  return { events: [{ type: 'creature-moved', id: target, placement, forced: true }], unverified: [] };
}
