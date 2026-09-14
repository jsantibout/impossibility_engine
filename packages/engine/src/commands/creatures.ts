/**
 * Hit points, Exhaustion, and a creature leaving the game.
 *
 * The batches this file was named for. Dropping to 0 hit points makes a
 * creature Unconscious; healing from 0 lifts *that* unconsciousness and
 * nothing else; Exhaustion 6 kills. Leaving those follow-ups to the caller
 * meant relying on a language model to remember bookkeeping the rules already
 * mandate.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { hasCondition } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { applyDamageToVitals, isDown } from '../vitals.js';
import { creatureOf, unknownCreature, ZERO_HIT_POINTS } from './command.js';
import { settleHoldsInvolving } from './holds.js';

export interface DamageCommand extends CommandIdentity {
  readonly amount: number;
  readonly critical?: boolean;
  /** What dealt it, for the audit trail. */
  readonly source?: string;
  /**
   * Which creature dealt it, where one did.
   *
   * Separate from `source`, which is prose and cannot be aimed at. A Reaction
   * that answers damage needs an id to answer; a trap has none, and that is a
   * real answer rather than a gap.
   */
  readonly by?: CharacterId;
}

/**
 * Damage a creature, with every consequence the rules attach to it.
 *
 * Returns the whole batch: the damage itself, and the unconsciousness that
 * follows a character dropping to 0 without dying.
 */
export function damageCreature(
  state: GameState,
  id: CharacterId,
  command: DamageCommand,
): Result<GameEvent[]> {
  // Before anything else: a retry of a command that already landed is a no-op,
  // not a second hit. This has to precede validation too — otherwise a retry
  // reports whatever the first attempt caused rather than that it happened.
  return once(state, `damage:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!Number.isFinite(command.amount) || command.amount < 0) {
      return err('bad_amount', `damage must be a non-negative number, got ${command.amount}`);
    }

    const events: GameEvent[] = [
      {
        type: 'damage-taken',
        id,
        amount: command.amount,
        ...(command.critical === undefined ? {} : { critical: command.critical }),
        ...(command.source === undefined ? {} : { source: command.source }),
        ...(command.by === undefined ? {} : { by: command.by }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    // Ask the rules what this damage does before deciding what follows it.
    const outcome = applyDamageToVitals(creature.vitals, command.amount, {
      ...(command.critical === undefined ? {} : { critical: command.critical }),
    });

    // SRD: "If you reach 0 Hit Points and don't die instantly, you have the
    // Unconscious condition ... until you regain any Hit Points."
    if (outcome.droppedToZero && !outcome.died) {
      events.push({ type: 'condition-applied', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    // A creature that dies is no longer unconscious from its hit points; it is
    // dead, which is a different state entirely.
    if (outcome.died && hasCondition(creature.conditions, 'unconscious')) {
      events.push({ type: 'condition-removed', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    return ok(events);
  });
}

/**
 * Heal a creature, lifting the unconsciousness that having no hit points caused
 * and leaving every other cause of it alone.
 */
export function healCreature(
  state: GameState,
  id: CharacterId,
  amount: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // The mirror of `damageCreature`, which has been guarded since command ids
  // landed. Healing was not, and a retried heal healed twice — the same bug in
  // the opposite direction, and the easier one to miss because nobody
  // complains about extra hit points until a boss fight.
  return once(state, `heal:${id}`, { ...command, amount }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!Number.isFinite(amount) || amount <= 0) {
      return err('bad_amount', `healing must be a positive number, got ${amount}`);
    }
    if (creature.vitals.dead) {
      return err('dead', `${id} is dead; hit points alone will not bring them back`);
    }

    const events: GameEvent[] = [
      { type: 'healed', id, amount, ...(stamp === null ? {} : { command: stamp }) },
    ];

    // SRD: the Unconscious condition from 0 hit points lasts "until you regain
    // any Hit Points". Only that cause lifts — a creature also held by Sleep
    // stays asleep.
    if (isDown(creature.vitals) && hasCondition(creature.conditions, 'unconscious')) {
      events.push({ type: 'condition-removed', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
    }

    return ok(events);
  });
}

/**
 * Set a creature's Exhaustion level, and kill it if that reaches 6.
 *
 * SRD: "You die if your Exhaustion level is 6." Bundled here so the death is
 * not something a caller has to remember to apply separately.
 */
export function setExhaustionLevel(
  state: GameState,
  id: CharacterId,
  level: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `exhaustion:${id}`, { ...command, level }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }

    if (!Number.isInteger(level) || level < 0 || level > 6) {
      return err('bad_level', `an Exhaustion level runs from 0 to 6, got ${level}`);
    }

    // The reducer applies the death itself, since "you die if your Exhaustion
    // level is 6" is a rule rather than a caller's decision. Damage would be the
    // wrong instrument: a healthy creature taking exactly its maximum drops to 0
    // rather than dying.
    return ok([{ type: 'exhaustion-set', id, level, ...(stamp === null ? {} : { command: stamp }) }]);
  });
}

/**
 * Take a creature out of the game, cleaning up everywhere it is referenced.
 *
 * A creature removed from the cast but left standing on the map and sitting in
 * the initiative order is a dangling reference waiting to be tripped over.
 */
export function removeCreatureEverywhere(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // Before the creature is looked up. A retry arrives at a world where the
  // creature has already gone, and reporting `unknown_creature` for a removal
  // that succeeded is exactly the confusion command ids exist to prevent.
  return once(state, `remove:${id}`, command, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }

    // Anything this creature was holding up has to be settled first, or the
    // fight cannot continue without them.
    const events: GameEvent[] = [...settleHoldsInvolving(state, id)];

    // A caster leaving takes their ongoing spell with them, and the log should
    // say so rather than leaving the reader to infer it from the disappearance.
    //
    // **Read off the world the settlement above leaves, not the one before
    // it.** `settleHoldsInvolving` interrupts a casting the caster had
    // declared, and a casting of a minute or more is *concentrated on* — so
    // the interruption has already taken that Concentration, and a
    // `concentration-ended` naming it would be an event the fold refuses. Two
    // events about one fact, written against two different worlds, is a batch
    // built against a snapshot; this is the same reading `resolveDamage`
    // already takes when it asks what the damage left behind.
    const creature = creatureOf(events.reduce(applyEvent, state), id);
    if (creature?.concentration != null) {
      events.push({
        type: 'concentration-ended',
        id,
        castingId: creature.concentration.castingId,
        reason: 'removed',
      });
    }

    // Order matters: leave the map and the initiative order before leaving the
    // cast, so each of those events still finds the creature it refers to.
    if (state.scene?.positions[id] !== undefined) {
      events.push({ type: 'creature-unplaced', id });
    }
    // A combat of one cannot lose its last combatant, so the fight ends instead.
    if (state.combat?.order.some((c) => c.id === id) === true) {
      events.push(
        state.combat.order.length === 1
          ? { type: 'combat-ended' }
          : { type: 'combatant-removed', id },
      );
    }

    // The one event this command always emits, whatever the creature was in the
    // middle of, so the stamp rides here rather than on a hold it happened to
    // be settling.
    events.push({ type: 'creature-removed', id, ...(stamp === null ? {} : { command: stamp }) });
    return ok(events);
  });
}

/**
 * Grant Temporary Hit Points.
 *
 * SRD: they are not healing and do not stack — "If you have Temporary Hit
 * Points and receive more of them, you choose whether to keep the ones you
 * have or gain the new ones." Keeping the larger pool is that choice made the
 * only way it is ever made.
 */
export function grantTemporaryHpTo(
  state: GameState,
  id: CharacterId,
  amount: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `temp-hp:${id}`, { ...command, amount }, () => [], (stamp) => {
  if (creatureOf(state, id) === null) {
    return unknownCreature(id);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return err('bad_amount', `temporary hit points must be a non-negative number, got ${amount}`);
  }
  return ok([
    { type: 'temporary-hp-granted', id, amount, ...(stamp === null ? {} : { command: stamp }) },
  ]);
  });
}

