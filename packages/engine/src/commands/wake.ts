/**
 * One creature spending its own action to end an effect on another.
 *
 * > SRD Sleep: "The spell ends on a target if it takes damage or **someone
 * > within 5 feet of it takes an action to shake it out of the spell's
 * > effect**."
 * > SRD Hypnotic Pattern: "The spell ends for an affected creature if it takes
 * > damage or if **someone else uses an action to shake the creature out of
 * > its stupor**."
 * > SRD Brass Dragon Wyrmling's Sleep Breath: "This effect ends for the target
 * > if it takes damage or **a creature within 5 feet of it takes an action to
 * > wake it**."
 * > SRD Incubus' Nightmare and SRD Pseudodragon's Sting print the same clause.
 *
 * **Five sentences and one verb the engine did not have.** Every other ending
 * in the book is a fact about the creature the effect is on — it was struck,
 * it swung, it cast, a deadline arrived — and this is the one an *onlooker*
 * buys, with their own Action and their own five feet. The damage half of the
 * same sentence has been spent since `target-takes-damage` was written; this
 * is the other half.
 *
 * **What it ends is not decided here.** The command spends the Action, checks
 * the reach and writes `creature-woken`; the fold finds what that ends, off
 * two records — a casting whose `endsEarly` names `shaken-awake`, and a
 * condition instance marked `endsWhenWoken`. Two doors onto one sentence would
 * be two rules, and the blow already goes through the fold.
 *
 * **It refuses when there is nothing to wake**, which is the one thing a table
 * cannot afford to do by accident: an Action is the scarcest thing a turn
 * holds, and a command that spent one on a creature who was merely asleep in
 * the ordinary way would be the engine charging for nothing. So the question
 * is asked *before* the spend, out of the same two records the fold will read.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { instancesEndingEarly } from '../conditions.js';
import { actionRulesOn } from '../standing.js';
import { spendAction } from '../combat.js';
import type { GameEvent, GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { creatureOf, reachedBy, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import { ongoingSpellsOn } from './ongoing.js';

/** Who is being shaken. */
export interface WakeRequest {
  readonly target: CharacterId;
}

/**
 * Everything on this creature that a neighbour's action would end.
 *
 * Read off the world rather than filed anywhere, which is what
 * `strandedSummons` already does with a debt of the same kind: whether there
 * is anything to wake is a question about how things stand, and a second
 * record of it would be a second thing to keep in step.
 *
 * Two populations, because the book prints the clause on both sides of the
 * screen: a casting that says so — SRD Sleep, SRD Hypnotic Pattern — and a
 * condition a printed line marked, which was never cast at all.
 *
 * Exported so the refusal below and the fold's own pass are not two readings
 * of one question: this is what `nothing_to_wake` asks, and a caller that
 * wants to know whether the Action is worth spending asks the same function
 * rather than a second one that agrees until it does not.
 */
export function wakeableOn(state: GameState, target: CharacterId): readonly string[] {
  const creature = state.creatures[target];
  if (creature === undefined) return [];
  // The same reader every other question about "what is running on this
  // creature" goes through — SRD Dispel Magic's question — so this cannot
  // drift from the pass in the fold that will end them.
  const castings = ongoingSpellsOn(state, target)
    .filter((record) => record.endsEarly?.some((trigger) => trigger.on === 'shaken-awake') === true)
    .map((record) => record.castingId);
  return [
    ...castings,
    ...instancesEndingEarly(creature.conditions, 'waking').map((instance) => instance.id),
  ];
}

/**
 * Shake a creature out of whatever is holding it.
 *
 * The Action is the actor's; the five feet are measured from the actor; and
 * the effects that end are the target's. Nothing is rolled — no sentence in
 * the book asks for a check here, and inventing one would be a DC nobody
 * printed.
 */
export function wakeCreature(
  state: GameState,
  id: CharacterId,
  request: WakeRequest,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `wake:${id}`, { ...command, target: request.target }, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const actor = creatureOf(state, id);
    if (actor === null) return unknownCreature(id, 'has no record here yet; add it first');
    const sleeper = creatureOf(state, request.target);
    if (sleeper === null) return unknownCreature(request.target);
    // SRD Hypnotic Pattern writes "someone **else**", and the rest write it
    // into the geometry: a creature shaking itself out of its own stupor is
    // the one reading none of the five sentences permits.
    if (request.target === id) {
      return err(
        'cannot_wake_yourself',
        `${id} cannot spend an action shaking themselves out of an effect they are under; SRD asks for somebody else`,
      );
    }

    // "within 5 feet of it" — asked before the spend, and asked of the scene
    // rather than assumed: a table that keeps no positions is not refused,
    // and one that keeps them and has lost this creature's is asked.
    const apart = reachedBy(state, id, request.target, 'shaking a creature awake');
    if (apart !== null) return apart;

    // **Nothing to wake is a refusal and not an empty batch**, because the
    // Action is what it would cost. A creature merely Unconscious at 0 Hit
    // Points is not woken by being shaken — the book says what ends that, and
    // it is hit points — so the question is which effects printed the clause.
    if (wakeableOn(state, request.target).length === 0) {
      return err(
        'nothing_to_wake',
        `nothing on ${request.target} ends when somebody shakes them: the clause is printed by a handful of effects — SRD Sleep, SRD Hypnotic Pattern, a sleep breath, a sting — and none of them is on ${request.target}`,
      );
    }

    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[id] !== undefined) {
      const spent = spendAction(state.combat, id, actor.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;
      events.push({ type: 'action-spent', id });
    }

    events.push({
      type: 'creature-woken',
      id: request.target,
      by: id,
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok(events);
  });
}
