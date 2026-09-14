/**
 * What every command in this directory needs, and nothing else.
 *
 * Two things, and each is here because every domain asks for it: how to read a
 * creature out of the world, and what to answer about one the engine has never
 * been told about. The third — `once`, the wrapper that puts the duplicate
 * check first — is in `idempotency.ts` with the rest of the identity
 * machinery, because `rest.ts` needs it too and must not reach upwards.
 *
 * It is the one module every other one in `commands/` imports, and it imports
 * none of them. That is what keeps the value-level graph a DAG: the two
 * creature readers were called from all thirteen of the regions the old single
 * file had, so leaving them in any domain would have made that domain a
 * dependency of every other.
 */

import { type CharacterId, needsContext } from '@ie/shared';
import { type GameState } from '../events.js';

/**
 * The source recorded for unconsciousness that comes from having no hit points
 * left, as opposed to a spell.
 *
 * It is a named constant because healing has to lift *this* cause and leave
 * every other one standing: a character knocked out by Sleep and then dropped
 * to 0 wakes from the hit points, not from the spell.
 */
export const ZERO_HIT_POINTS = 'zero hit points';

export const creatureOf = (state: GameState, id: CharacterId) => state.creatures[id] ?? null;

/**
 * The answer for a creature the engine has never been told about.
 *
 * The most common `needs-context` there is, and until now the one that named
 * no request — so `contextRequestsOf` came back empty and a tool surface was
 * left matching the error code, which is the thing the predicate exists to
 * make unnecessary. Absence from structured state is not evidence a thing
 * does not exist; this says what would make it exist here.
 *
 * Commands attach requests. The pure helpers beneath them (`positioning.ts`,
 * `combat.ts`) return the bare kind and leave the request to the command that
 * knows which rule wanted the fact.
 *
 * **This is the one request that names an event rather than a command, and it
 * is deliberate.** Every other one names something a caller can send, because
 * a tool surface calls commands and never appends events — appending one is
 * how the model would assert a mechanical fact directly. Adding a creature has
 * no such command: `createCharacter` in `creation.ts` emits `creature-added`,
 * predates the command layer, takes no `CommandIdentity` and is not published
 * through the `commands.ts` barrel. Naming a command that does not exist would
 * be worse than naming the event, so the honest answer stands and
 * `invariants.test.ts` carries it as a written exemption whose claim it
 * checks. A barrel command that adds a creature is what would end it.
 */
export const unknownCreature = (id: CharacterId, detail = 'is not in this game') =>
  needsContext('unknown_creature', `${id} ${detail}`, [
    {
      kind: 'creature',
      subject: id,
      need: `a record for ${id}`,
      because: 'the command names a creature the engine has never been told about',
      satisfyWith: `a creature-added event for ${id}`,
    },
  ]);
