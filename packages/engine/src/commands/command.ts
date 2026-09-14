/**
 * What every command in this directory needs, and nothing else.
 *
 * Three things, and each is here because every domain asks for it: how to read
 * a creature out of the world, what to answer about one the engine has never
 * been told about, and what to answer when there is no scene to be anywhere
 * in. The fourth — `once`, the wrapper that puts the duplicate check first —
 * is in `idempotency.ts` with the rest of the identity machinery, because
 * `rest.ts` needs it too and must not reach upwards.
 *
 * It is the one module every other one in `commands/` imports, and it imports
 * none of them. That is what keeps the value-level graph a DAG: the two
 * creature readers were called from all thirteen of the regions the old single
 * file had, so leaving them in any domain would have made that domain a
 * dependency of every other. `sceneFor` arrived here by the same argument
 * measured rather than predicted: it was written privately in
 * `commands/scene.ts`, copied whole into `commands/movement.ts`, and
 * `commands/teleport.ts` is the third place that needs it.
 */

import { type CharacterId, needsContext, ok, type Result } from '@ie/shared';
import { type GameState } from '../events.js';
import { type PositionState } from '../positioning.js';

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
 * **This was the one request that named an event rather than a command**, and
 * it is not any more. Every other one names something a caller can send,
 * because a tool surface calls commands and never appends events — appending
 * one is how the model would assert a mechanical fact directly. Adding a
 * creature genuinely had no command: `createCharacter` in `creation.ts` emits
 * `creature-added`, predates the command layer, takes no `CommandIdentity` and
 * is not published through the `commands.ts` barrel, so this said "a
 * creature-added event" and `invariants.test.ts` carried a written exemption
 * saying that a barrel command adding a creature was what would end it.
 * `addCreature` is that command, and the exemption was deleted rather than
 * reworded — which is what an exemption naming the fact that would end it is
 * for.
 *
 * It names `addCreature` rather than `createCharacter` because the creature
 * the engine is asked about mid-fight is a monster far more often than a
 * character sheet, and a request has to name one thing. A caller whose missing
 * creature is a player character builds it the way every character is built.
 */
export const unknownCreature = (id: CharacterId, detail = 'is not in this game') =>
  needsContext('unknown_creature', `${id} ${detail}`, [
    {
      kind: 'creature',
      subject: id,
      need: `a record for ${id}`,
      because: 'the command names a creature the engine has never been told about',
      satisfyWith: `an addCreature command for ${id}`,
    },
  ]);

/**
 * The scene, or the request that would make one.
 *
 * Homework rather than a verdict: nothing is wrong, the record is thin, and
 * `setScene` in `commands/scene.ts` is what settles it. The reducer says the
 * same thing by throwing `no scene has been set`; a command says it as a fact
 * to go and get, because a caller who has not described the room yet has made
 * no mistake.
 *
 * **Hoisted because a third copy arrived.** It was written privately in
 * `commands/scene.ts` and copied, prose included, into `commands/movement.ts`
 * — IE-016's builder and reviewer both recorded that a third copy would be the
 * moment to move it, and `commands/teleport.ts` is that third. It belongs
 * here for the reason the two creature readers do: it is a question every
 * domain that is about a *place* has to ask, and answering it in any one of
 * them would make that domain a dependency of the others.
 */
export function sceneFor(
  state: GameState,
  subject: string,
  because: string,
): Result<PositionState> {
  if (state.scene !== null) return ok(state.scene);
  return needsContext('no_scene', `there is no scene for ${because}`, [
    {
      kind: 'scene',
      subject,
      need: 'a scene, so that a place in it means something',
      because,
      satisfyWith: 'a setScene command',
    },
  ]);
}
