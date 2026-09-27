/**
 * What the engine is still owed, and the gate that makes a command settle it.
 *
 * Every debt in `GameState` is here — a declared move waiting on Opportunity
 * Attacks, a hit whose damage is unrolled, a damage roll or a D20 Test held
 * open for Reactions, a casting mid-flight, the saves a turn boundary raised,
 * the area effects a spell owes — together with the two functions that read
 * them: `unsettledRefusal`, which refuses any command while a global debt
 * stands, and `mayAct`, which is the per-creature half.
 *
 * They sit together rather than each beside the command that creates them
 * because a debt is read by the commands that did *not* create it. Scattering
 * the readers across the domains put `mayAct` in the spell region, where
 * eleven other modules had to reach for it.
 *
 * `settleHoldsInvolving` and `completeIfSettled` are here for the same
 * reason: closing a hold is what a departing creature and a settled damage
 * roll both have to do, and neither is a rule about movement.
 */

import { type CharacterId, err, type Err } from '@ie/shared';
import { type MovementMode } from '../character.js';
import { type PendingSave } from '../timers.js';
import {
  applyEvent,
  type GameEvent,
  type GameState,
  type PendingAttack,
  type PendingCasting,
  type PendingDamage,
  type PendingMove,
  type PendingTest,
} from '../events.js';
import { isIncapacitated } from '../conditions.js';
import { moveCreature } from '../positioning.js';
import { effectiveConditions, speedForMoveIn } from '../standing.js';
import { type OwedAreaEffect } from '../spells.js';

/**
 * Close any pending hold a departing creature was on either side of.
 *
 * `pendingAttack` and `pendingMove` are debts, and the engine refuses to
 * advance the turn while one stands — which is the right rule and becomes a
 * **wedged campaign** the moment the creature who owes it walks out of the
 * game. A dead-and-removed attacker never rolls their held damage; a mover who
 * has been teleported out of the scene never finishes moving. Nothing else can
 * settle those, because every command that could is addressed to the creature
 * that is leaving.
 *
 * So leaving the game settles them, in the same spirit as the Concentration
 * the removal already ends: a creature takes its obligations with it. What it
 * cannot do is pretend they were met — a held attack closes with its damage
 * unrolled, and the log shows exactly that.
 */
export function settleHoldsInvolving(state: GameState, id: CharacterId): readonly GameEvent[] {
  const events: GameEvent[] = [];

  // A caster who leaves mid-casting takes the casting with them. Nothing else
  // could settle it — `resolveDeclaredCast` is addressed to them — and the
  // slot was never spent, so the spell simply never happened. That is the
  // honest record, and it is the same one an interruption writes.
  //
  // **Every one of them, and that is genuinely plural now.** This read the
  // single slot and stopped at the first; a caster may hold a rite and a
  // Shield open at once, and a debt left standing is a fight the turn refuses
  // to advance past for ever.
  for (const casting of pendingCastingsBy(state, id)) {
    events.push({
      type: 'spell-interrupted',
      castingId: casting.castingId,
      id: casting.caster,
      by: null,
      reason: 'caster-left',
    });
  }

  // A held hit needs both parties: one to roll the damage and one to take it.
  //
  // **And a rider pinned on it goes with it, unspent.** What a hit buys is
  // owed by the *damage*, and this closes the hold with the damage unrolled:
  // where the target left there is nobody to Stun, and where the attacker did
  // there is nobody to spend the Focus Point. Resolving it on the way out
  // would apply a condition from a blow the log says never landed, and
  // charging for it would charge a creature that has left the game. Nothing is
  // refunded because nothing was charged — the cost is `applyHitRider`'s, at a
  // settlement this departure means will not happen. It is the answer
  // `pendingDamage.rider` already gets three lines below, where a target
  // leaving closes that window with the damage undealt.
  const attack = state.pendingAttack;
  if (attack !== null && (attack.attacker === id || attack.target === id)) {
    events.push({ type: 'attack-damage-dealt', attacker: attack.attacker });
  }

  // A damage roll waiting on Reactions needs somebody to take it. If the
  // *target* is leaving there is nobody left to hurt, so the window closes
  // with the damage undealt — the same honest record a held attack gets, and
  // the log shows exactly that. A departing **bystander** is different: their
  // offer stays in the record and `settleDamage` records it as passed, so the
  // blow still lands on whoever it was aimed at.
  const held = state.pendingDamage;
  if (held !== null && held.target === id) {
    for (const offer of held.offers) {
      events.push({
        type: 'damage-reaction-answered',
        reactor: offer.reactor,
        took: false,
        feature: offer.feature,
      });
    }
    events.push({ type: 'damage-settled', target: held.target });
  }

  // A D20 Test whose roller is leaving. Nothing is owed either way — the test
  // settles nothing by itself — so the window simply closes.
  const test = state.pendingTest;
  if (test !== null && test.who === id) {
    for (const offer of test.offers) {
      events.push({
        type: 'test-reaction-answered',
        reactor: offer.reactor,
        took: false,
        feature: offer.feature,
      });
    }
    events.push({ type: 'test-settled', who: test.who });
  }

  const move = state.pendingMove;
  if (move === null) return events;

  const leaving = move.mover === id;
  const wasOffered = move.provoked.some((p) => p.reactor === id);
  if (!leaving && !wasOffered) return events;

  // Every Reaction still outstanding is recorded as passed. For a reactor who
  // is leaving that is simply true; for the rest, the thing they were offered
  // an attack on is no longer there to attack.
  const outstanding = leaving ? move.provoked.map((p) => p.reactor) : [id];
  for (const reactor of outstanding) {
    events.push({ type: 'opportunity-answered', reactor, took: false });
  }

  if (leaving) {
    // No `creature-moved`: there is nobody left to arrive.
    events.push({ type: 'movement-completed', id: move.mover });
    return events;
  }

  // One reactor gone, the rest may still answer. If that was the last of them
  // the move goes through now, exactly as it would have on their decline.
  return [...events, ...completeIfSettled(state, events)];
}

/** The move waiting on the Opportunity Attacks it provoked, or null. */
export function pendingMoveOf(state: GameState): PendingMove | null {
  return state.pendingMove;
}

/**
 * The move itself, once nobody is left to answer.
 *
 * Emitted by whichever command settles the last Reaction, because a reducer
 * cannot emit events and a move that completed itself silently would be a
 * change nothing in the log accounted for.
 */
export function completeIfSettled(state: GameState, answered: readonly GameEvent[]): readonly GameEvent[] {
  const after = answered.reduce(applyEvent, state);
  const waiting = after.pendingMove;
  if (waiting === null || waiting.provoked.length > 0) return [];
  // SRD: "The attack occurs right before the creature leaves your reach." An
  // Opportunity Attack whose damage a Reaction is answering has not finished
  // occurring, so the mover has not left yet. `settleDamage` calls this again
  // once the blow has landed.
  if (after.pendingDamage !== null) return [];

  // The mover may have died to the Opportunity Attack, in which case there is
  // nobody left to move and the declaration is simply closed.
  const mover = after.creatures[waiting.mover];
  if (mover === undefined || mover.vitals.dead) {
    return [{ type: 'movement-completed', id: waiting.mover }];
  }

  // The placement is re-resolved so the mover still arrives beside whoever
  // they aimed at, even if that creature shifted in the meantime. When the
  // anchor is *gone* — commonly killed by the Opportunity Attack this move
  // provoked — there is nothing to re-resolve against, and emitting the
  // placement anyway would write an event no future fold could apply.
  const scene = after.scene;
  const resolvable =
    scene !== null && moveCreature(scene, waiting.mover, waiting.placement).ok;

  const arrived: GameEvent = {
    type: 'creature-moved',
    id: waiting.mover,
    placement: resolvable
      ? waiting.placement
      : { ...waiting.placement, from: { point: waiting.destination }, bearing: 0, feet: 0 },
  };
  return [{ type: 'movement-completed', id: waiting.mover }, arrived, ...carriedOnArrival(after, waiting, arrived)];
}

/**
 * **Whoever the move brings along**, once the mover has arrived — W7-B10.
 *
 * Each a forced move to the space the command settled when it declared the
 * move, after the mover's own so a held creature lands beside where the mover
 * now is. Asked again here rather than trusted, because Reactions came in
 * between: a passenger that has died or left the world, a prisoner the
 * grapple no longer holds, a clinger that has let go, or a space somebody now
 * stands in is left where it was — and a hold left behind lapses exactly as
 * `lapsedGrapples` says of any grappler that walked away.
 */
function carriedOnArrival(after: GameState, waiting: PendingMove, arrived: GameEvent): readonly GameEvent[] {
  const events: GameEvent[] = [];
  let world = applyEvent(after, arrived);
  for (const carried of waiting.carrying ?? []) {
    const creature = world.creatures[carried.who];
    if (creature === undefined || creature.vitals.dead || world.scene === null) continue;
    if (!stillAlongWith(creature, waiting.mover)) continue;
    if (!moveCreature(world.scene, carried.who, carried.placement, { forced: true }).ok) continue;
    const moved: GameEvent = { type: 'creature-moved', id: carried.who, placement: carried.placement, forced: true };
    events.push(moved);
    world = applyEvent(world, moved);
  }
  return events;
}

/**
 * Whether a creature is still held by the mover's grapple or still clinging to
 * it. The grapple is read off the source `grappleSource` writes — `grapple:<who>`,
 * with `/<limb>` after it for a hold made with a thing of its own — because
 * `commands/unarmed.ts` imports this module and cannot be imported back.
 */
function stillAlongWith(creature: GameState['creatures'][string], mover: CharacterId): boolean {
  const grapple = `grapple:${mover}`;
  return (
    creature.conditions.instances.some(
      (instance) =>
        instance.condition === 'grappled' &&
        (instance.source === grapple || instance.source.startsWith(`${grapple}/held-by:`)),
    ) || creature.attachments.some((one) => one.to === mover)
  );
}

/** The hit whose damage is still to be rolled, or null. */
export function pendingAttackOf(state: GameState): PendingAttack | null {
  return state.pendingAttack;
}

/** The damage roll waiting on its Reactions, if one is. */
export function pendingDamageOf(state: GameState): PendingDamage | null {
  return state.pendingDamage;
}

/** The D20 Test waiting on its Reactions, if one is. */
export function pendingTestOf(state: GameState): PendingTest | null {
  return state.pendingTest;
}

/** What the persistent areas currently owe, in the order they were caught. */
export function owedAreaEffectsOf(state: GameState): readonly OwedAreaEffect[] {
  return state.owedAreaEffects;
}

export function pendingSavesOf(state: GameState): readonly PendingSave[] {
  return Object.keys(state.pendingSaves)
    .sort()
    .map((key) => state.pendingSaves[key])
    .filter((pending): pending is PendingSave => pending !== undefined);
}

/**
 * Every casting waiting to resolve, in casting-number order.
 *
 * A query, so a caller — or a Reaction deciding whether it has a trigger — can
 * look without changing anything.
 *
 * **A list rather than an optional**, because several castings may be open at
 * once and several of them may belong to one caster. The order is the record's
 * own, which `withPendingCasting` keeps in casting-number order.
 */
export function pendingCastingsOf(state: GameState): readonly PendingCasting[] {
  return Object.values(state.pendingCastings);
}

/**
 * The castings this creature has open, in casting-number order.
 *
 * Plural, and that is the rule rather than a convenience: SRD's per-turn
 * Magic-action obligation is on the caster's *own* turns and a Reaction is
 * taken on somebody else's, so a wizard mid-rite may legally have a Shield
 * open beside it. A caller that has to choose between them names an id; the
 * engine never picks.
 */
export function pendingCastingsBy(
  state: GameState,
  caster: CharacterId,
): readonly PendingCasting[] {
  return pendingCastingsOf(state).filter((casting) => casting.caster === caster);
}

/**
 * The debt that stops a creature acting right now, or null.
 *
 * A turn-boundary save outstanding means somebody may or may not still be
 * Paralyzed; a damage roll or a D20 Test held open is an outcome nobody has
 * settled. Acting into either resolves against a state that is not yet
 * decided — a Cleric healing the Rogue who is about to be hit by damage
 * already rolled. `pendingAttack` is deliberately *not* here: SRD Divine
 * Smite is cast into that window on purpose.
 *
 * One function for the two commands that take an action through magic —
 * casting and acting through a running spell — so the list cannot drift
 * between them. It is the same rule that stops the turn advancing, and
 * `resolveTurn` keeps its own wording of it.
 */
export function unsettledRefusal(state: GameState, who: CharacterId): Err | null {
  const owed = pendingSavesOf(state);
  if (owed.length > 0) {
    return err(
      'saves_pending',
      `${owed.length} turn-boundary save(s) are still owed; resolve them before acting`,
    );
  }
  if (state.pendingDamage !== null) {
    return err(
      'damage_pending',
      `damage rolled against ${state.pendingDamage.target} has not been settled; settle it before acting`,
    );
  }
  if (state.pendingTest !== null) {
    return err(
      'test_pending',
      `the D20 Test ${state.pendingTest.who} rolled has not been settled; settle it before acting`,
    );
  }
  // And whatever this creature in particular has been caught by — see
  // {@link mayAct}, which is the half of this policy that is per-creature.
  return mayAct(state, who, 'act');
}

/**
 * What a voluntary act asks of the body taking it — the argument
 * {@link mayAct} and {@link actorRefusal} are told, by every command that
 * calls them.
 *
 * - `'act'` — an Action, a Bonus Action, a Reaction, or what is taken with
 *   one: a feature's use, a spell, a swing, a potion. Refused dead or
 *   Incapacitated.
 * - `{ move }` — voluntary movement in the mode named, paid for out of the
 *   mover's own Speed: a walk, a climb, the half-Speed that mounting costs.
 *   Refused dead, or where the Speed that mode moves with is 0. **Not**
 *   refused for being Incapacitated alone: SRD Incapacitated forbids actions,
 *   Bonus Actions and Reactions and says nothing about moving, so a Stunned
 *   creature — whose Speed the SRD leaves alone — may still walk.
 *   Unconscious, Paralyzed and Petrified stop a move through their Speed of 0,
 *   which is the sentence each of them prints.
 * - `'alive'` — refused dead, and nothing else. For a choice that costs no
 *   action at all (letting a Concentration go, dismissing a spell), and for a
 *   door that measures the move against a rule of its own rather than the
 *   mover's Speed: standing up (`cannot_stand`, SRD "If your Speed is 0, you
 *   can't right yourself"), a Darkmantle letting go on the five feet its line
 *   prints despite the Speed its hold pinned at 0, and a move somebody else
 *   pays for — a readied move's Reaction, an Unseen Servant's command.
 */
export type Doing = 'act' | 'alive' | { readonly move: MovementMode };

/** The walk, which is what "voluntary movement" is unless a mode is named. */
export const WALKING: Doing = { move: 'walk' };

/**
 * The actor's own state, asked once: whether the creature taking a voluntary
 * act is able to take it at all.
 *
 * Found by the first live playtest. A Fighter failed three death saves and
 * was dead, and the engine accepted a `move` by the corpse — and a goblin took
 * an Opportunity Attack on it. A creature that dies stops being Unconscious
 * ("a different state entirely", as `damageCreature` says when it lifts the
 * condition), so no condition stopped the corpse, and nothing asked whether it
 * was alive. The per-command refusals that did exist were partial: the turn
 * budget refuses an Incapacitated creature's Action, but only where there is a
 * budget, so outside a fight a dying hero could still swing.
 *
 * The three causes, each under its own code:
 *
 * - **`actor_dead`.** SRD "Dead": "A dead creature has no Hit Points and
 *   can't regain them unless it is first revived by magic". A corpse takes no
 *   action and makes no move of its own, whatever `doing` says. Revivify is
 *   cast *on* it, by somebody else, and meets no refusal here.
 * - **`incapacitated`** — the code the turn budget, the casting door and the
 *   Reaction door already refuse under, kept so there is one code for one
 *   rule. SRD Incapacitated: "You can't take any action, Bonus Action, or
 *   Reaction." Asked for `'act'` only.
 * - **`no_speed`.** SRD Unconscious and Grappled: "Your Speed is 0 and can't
 *   increase." Asked for `{ move }` only, of the Speed the mode moves with
 *   ({@link speedForMoveIn}). A mode the creature has no Speed in at all is
 *   not this refusal — the move's own `no_such_speed` says that — and a Dash
 *   banked before the Speed fell to 0 does not buy a step: a Speed of 0 is
 *   "can't increase", and the budget's arithmetic is for a Speed that is
 *   there.
 *
 * What is *done to* a creature is never asked here: a shove, a drag, a fall, a
 * teleport somebody else performs, damage, a death save, a heal, a Reaction
 * window's settlement. Those doors call {@link owedRefusal} or nothing, and
 * the invariant sweep in `invariants.test.ts` names each one.
 *
 * Null for a creature with no record, which is the caller's own
 * `unknown_creature` to report — this is a question about a body, and there
 * is none to ask it of.
 */
export function actorRefusal(state: GameState, who: CharacterId, doing: Doing): Err | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;
  if (creature.vitals.dead) {
    return err('actor_dead', `${who} is dead, and a dead creature takes no action and makes no move of its own`);
  }
  if (doing === 'act' && isIncapacitated(effectiveConditions(state, who))) {
    return err('incapacitated', `${who} is Incapacitated and can take no action, Bonus Action or Reaction`);
  }
  if (typeof doing === 'object') {
    const speed = speedForMoveIn(state, who, doing.move);
    if (speed !== null && speed <= 0) {
      return err('no_speed', `${who}'s Speed is 0, so ${who} cannot move of their own accord`);
    }
  }
  return null;
}

/**
 * Whether anybody may take a voluntary action right now, and this creature in
 * particular.
 *
 * **The creature's own body first**: {@link actorRefusal}, which is whether it
 * can take this act at all — dead, Incapacitated, or at a Speed of 0 — and so
 * is a fact about it that no settlement will change. A corpse told a Web save
 * is owed would settle the Web and be told it is dead.
 *
 * Then {@link owedRefusal}: what the world is owed before anybody acts into it.
 */
export function mayAct(state: GameState, who: CharacterId, doing: Doing): Err | null {
  return actorRefusal(state, who, doing) ?? owedRefusal(state, who);
}

/**
 * What the engine is owed before anybody may act, and before this creature in
 * particular may — the half of {@link mayAct} that is about the world rather
 * than about the actor's body.
 *
 * Called on its own by the doors that move or end things without anybody
 * acting: a forced move, a relocation somebody else performs, and the turn
 * boundary. They must still wait for the world to settle, and they must not
 * ask whether the creature concerned is alive — a corpse can be dragged, and a
 * dead creature's turn still has to end.
 *
 * **Two policies, and only the second is about the creature named.**
 *
 * **An owed area effect is global engine debt.** It was per-creature for one
 * commit, on the reasoning that a goblin's unmade Web save says nothing about
 * the wizard across the room. That reasoning is wrong, and the counterexample
 * is three moves long: a Cleric concentrating on Hold Person walks into an
 * Insect Plague; settling the swarm's damage can drop the Cleric, break the
 * Concentration and free the creature the Hold Person was holding — so a
 * third creature attacking *that* creature before the swarm is settled is
 * rolling against a Paralyzed target who may already be free. Advantage, an
 * automatic critical, and the whole shape of the attack turn on it.
 *
 * The engine will not dependency-analyse which actions happen to be
 * independent, because it does not need to: **settle the mandatory mechanical
 * fact first.** That is precisely why `pendingDamage`, `pendingTest` and
 * `pendingSaves` are global, and this belongs with them.
 *
 * **A turn whose start has not arrived is per-creature**, and deliberately
 * stays so. Nothing has been raised yet, so nothing can mutate: what is
 * unresolved is whether *this* creature is about to be caught, and their
 * budget has already refreshed. No mechanic makes that anybody else's problem.
 *
 * Reactions are deliberately not routed through either: a Reaction answers a
 * window that is already open, and refusing it would strand a legal one.
 * Neither is `settleAreaEffects` itself, or the commands that close an
 * already-open window — a guard that prevented its own settlement would be a
 * deadlock rather than a rule.
 *
 * One function, reached through {@link mayAct} by every command that spends an
 * Action, a Bonus Action, movement or a feature's use, rather than a sentence
 * each of them writes out again.
 */
export function owedRefusal(state: GameState, who: CharacterId): Err | null {
  const caught = state.owedAreaEffects[0];
  if (caught !== undefined) {
    return err(
      'area_effect_owed',
      `${state.owedAreaEffects.length} area effect(s) are owed — ${caught.castingId} has caught ${caught.target} — and settling them can change the world anybody else would act into`,
    );
  }
  if (state.pendingTurnStart?.who === who) {
    return err(
      'area_effect_owed',
      `${who}'s turn has begun and the effects its start owes have not been worked out; settle them before ${who} acts`,
    );
  }
  return null;
}

