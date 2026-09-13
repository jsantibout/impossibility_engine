/**
 * Declaring a fact the engine could not see, so a refused command can be sent
 * again.
 *
 * A `ContextRequest` names the command that satisfies it; this is where those
 * commands live. Creature type is the durable one — declared once, and a
 * contradicting declaration is refused rather than absorbed.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { creatureOf, unknownCreature } from './command.js';

/**
 * Establish a creature's type, once.
 *
 * The authoritative path for a fact `resolveSpell` has been asking for by
 * name: Hold Person wants "a Humanoid", the request said which event would
 * settle it, and nothing produced that event — so the layer above wrote one
 * into the log by hand. That is narration writing directly to truth, which is
 * the first thing docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md forbids.
 *
 * Two rules, both from the doctrine's sixth invariant. **Fiction may supply
 * a fact**: a creature nobody has typed takes the type it is given. **Fiction
 * may not overwrite established truth**: a creature already typed — by its
 * stat block, its species, or an earlier declaration — refuses a different
 * one, because a spell may already have been cast on the strength of it.
 * Declaring the same type again emits nothing; completing the record adds a
 * fact, it never restates the world.
 *
 * The refusal is a verdict rather than homework: the fact is *known*, and the
 * caller is contradicting it. A DM who genuinely misspoke has no path here to
 * take it back, deliberately — a retcon facility would need its own event
 * and its own audit trail, and inventing one for a case nobody has hit yet is
 * the kind of abstraction the doctrine says to wait for.
 */
export function declareCreatureType(
  state: GameState,
  id: CharacterId,
  creatureType: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-type:${id}`, { ...command, creatureType }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (creature.creatureType === creatureType) return ok([]);
    if (creature.creatureType !== null) {
      return err(
        'type_established',
        `${id} is already established as ${creature.creatureType}; a declaration cannot make them ${creatureType}`,
      );
    }

    return ok([
      { type: 'creature-type-declared', id, creatureType, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

