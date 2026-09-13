/**
 * Named pools: declaring one, and refilling it on a rest.
 *
 * Spell slots, Channel Divinity, Ki, a wand's charges and Hit Dice are the
 * same mechanism, and `resources.ts` beneath this holds the arithmetic. Pools
 * are declared, never derived, because the engine does not model class tables.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { hasPool, type PoolDeclaration, type Recovery } from '../resources.js';
import { creatureOf, unknownCreature } from './command.js';

/**
 * Declare a limited-use pool on a creature.
 *
 * Pools are declared, never derived: the engine does not own the class tables
 * that say how many slots a level 5 Wizard has. See `resources.ts`.
 */
export function declareResourcePool(
  state: GameState,
  id: CharacterId,
  pool: PoolDeclaration,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);
  if (hasPool(creature.resources, pool.key)) {
    return err('duplicate_pool', `${id} already has a ${pool.key} pool`);
  }
  if (!Number.isInteger(pool.max) || pool.max < 0) {
    return err('bad_max', `a pool's maximum must be a non-negative integer, got ${pool.max}`);
  }
  return ok([{ type: 'resource-pool-declared', id, pool }]);
}

/** SRD: "Finishing a Long Rest restores any expended spell slots." */
export function restoreResourcesOn(
  state: GameState,
  id: CharacterId,
  recovers: Recovery,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // **This is not idempotent by construction**, which is what the idempotency
  // sweep used to excuse it as. A whole refill applied twice is a whole refill
  // — but SRD's partial rule is not: "You regain **one** expended use when you
  // finish a Short Rest" is `regainsOnShortRest`, and `restoreOn` subtracts it
  // from `spent`, so a retried restoration hands back two uses of Rage, Second
  // Wind, Channel Divinity, Wild Shape or Bardic Inspiration.
  return once(state, `restore:${id}`, { ...command, recovers }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }
    return ok([
      { type: 'resources-restored', id, recovers, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

