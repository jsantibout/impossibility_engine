/**
 * A creature's second place: the seam that takes it off the lattice and
 * puts it back.
 *
 * Two events and one derived pass. `creature-sent-elsewhere` records the
 * leaving — the space left and the clock are read off the world here, because
 * this is the one moment they are knowable — and `creature-returned` stands
 * the creature where the command settled. The pass is SRD Swallow's "if the
 * frog dies, the swallowed target is no longer Restrained": a rule about a
 * death nobody commands, so it is eventless, like a Concentration lost to
 * unconsciousness.
 *
 * What the record hangs is lifted here by **source**, exactly as a casting's
 * ending lifts what the casting hung: the return reads `elsewhere.source`,
 * takes every condition instance filed under it, and releases what those
 * instances were holding up. Nothing about which conditions a swallow imposes
 * is known to this module.
 */
import type { CharacterId } from '@ie/shared';
import type { GameEvent } from '../events.js';
import type { CreatureState, GameState } from '../state.js';
import type { Elsewhere } from '../elsewhere.js';
import { removeConditionInstance } from '../conditions.js';
import { bringBack, sendAway } from '../positioning.js';
import { CorruptLogError, creatureOf, seamOf, unhandledEvent, withCreature, type Applying } from './common.js';
import { instancesLifted, releaseInstanceGrants } from './release.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const ELSEWHERE_EVENTS = ['creature-sent-elsewhere', 'creature-returned'] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type ElsewhereEvent = Extract<GameEvent, { type: (typeof ELSEWHERE_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isElsewhereEvent = seamOf(ELSEWHERE_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyElsewhere({ state, next }: Applying, event: ElsewhereEvent): GameState {
  switch (event.type) {
    case 'creature-sent-elsewhere': {
      const creature = creatureOf(state, event, event.id);
      if (creature.elsewhere !== null) {
        throw new CorruptLogError(event, `${event.id} is already elsewhere and cannot leave twice`);
      }
      const scene = state.scene;
      const record: Elsewhere = {
        kind: event.kind,
        ...(event.host === undefined ? {} : { host: event.host }),
        from: scene?.positions[event.id] ?? null,
        since: state.elapsed,
        source: event.source,
        returns: event.returns,
        ...(event.damage === undefined ? {} : { damage: event.damage }),
      };
      const moved = withCreature(next, event.id, { elsewhere: record }, creature);
      if (scene === null) return moved;
      return {
        ...moved,
        scene: sendAway(scene, event.id, {
          kind: event.kind,
          ...(event.host === undefined ? {} : { host: event.host }),
        }),
      };
    }

    case 'creature-returned': {
      const creature = creatureOf(state, event, event.id);
      const record = creature.elsewhere;
      if (record === null) {
        throw new CorruptLogError(event, `${event.id} is not elsewhere and has nowhere to return from`);
      }
      const scene = state.scene;
      if (scene === null) {
        throw new CorruptLogError(event, `${event.id} returns to a scene nobody has set`);
      }
      return {
        ...withCreature(next, event.id, { ...withoutHung(creature, record.source), elsewhere: null }, creature),
        scene: bringBack(scene, event.id, event.at),
      };
    }

    default:
      return unhandledEvent(event);
  }
}

/**
 * The creature with everything the record hung on it lifted.
 *
 * Every condition instance filed under the record's source, and whatever those
 * instances were holding up — the same two steps `endTimedCondition` takes
 * when a deadline lifts one, reached from the return rather than the clock.
 */
function withoutHung(creature: CreatureState, source: string): CreatureState {
  const doomed = creature.conditions.instances.filter((instance) => instance.source === source);
  if (doomed.length === 0) return creature;
  const conditions = doomed.reduce(
    (held, instance) => removeConditionInstance(held, instance.id),
    creature.conditions,
  );
  return {
    ...releaseInstanceGrants(creature, instancesLifted(creature.conditions.instances, conditions.instances)),
    conditions,
  };
}

/**
 * SRD Swallow: "if the frog dies, the swallowed target is no longer
 * Restrained and can escape from the corpse".
 *
 * A rule about a death, and a death is settled inside the damage arithmetic
 * by a fold that emits nothing — so this is a derived pass, for the reason
 * `breakLostConcentration` is: nobody decides it. Only the Restrained goes;
 * the creature is still inside the corpse and still Blinded there until it
 * climbs out, which is the command's, because the space it climbs out to is a
 * choice.
 *
 * By reference where nothing changed, which is what keeps every other pass
 * from marking the world moved.
 */
export function freeTheSwallowedOfTheDead(state: GameState): GameState {
  let current = state;
  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    const record = creature?.elsewhere;
    if (creature === undefined || record?.kind !== 'inside' || record.host === undefined) continue;
    if (state.creatures[record.host]?.vitals.dead !== true) continue;
    const doomed = creature.conditions.instances.filter(
      (instance) => instance.condition === 'restrained' && instance.source === record.source,
    );
    if (doomed.length === 0) continue;
    const conditions = doomed.reduce(
      (held, instance) => removeConditionInstance(held, instance.id),
      creature.conditions,
    );
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [key]: {
          ...releaseInstanceGrants(
            creature,
            instancesLifted(creature.conditions.instances, conditions.instances),
          ),
          conditions,
        },
      },
    };
  }
  return current;
}

/** Whether anything is inside this creature — read by the doors that cap a swallow at one. */
export const holdsSomebodyInside = (state: GameState, host: CharacterId): boolean =>
  Object.values(state.creatures).some(
    (creature) => creature.elsewhere?.kind === 'inside' && creature.elsewhere.host === host,
  );
