import { err, ok, type CharacterId, type ConditionName, type Result } from '@ie/shared';
import { hasCondition, reasonsFor } from './conditions.js';
import type { GameEvent, GameState } from './events.js';
import { applyDamageToVitals, isDown } from './vitals.js';

/**
 * Engine-owned state transitions.
 *
 * Some changes are not one event. Dropping to 0 hit points makes a creature
 * Unconscious; healing from 0 lifts that unconsciousness but nothing else;
 * dying ends both. Leaving those follow-ups to whoever called `damage` meant
 * relying on the caller — eventually a language model — to remember bookkeeping
 * the rules already mandate.
 *
 * So a transition that needs several events is produced here as one coherent
 * batch. The caller emits the batch; the reducer applies it. Validation lives
 * here and replay stays in `events.ts`, which is why these return events rather
 * than state.
 */

/**
 * The source recorded for unconsciousness that comes from having no hit points
 * left, as opposed to a spell.
 *
 * It is a named constant because healing has to lift *this* cause and leave
 * every other one standing: a character knocked out by Sleep and then dropped
 * to 0 wakes from the hit points, not from the spell.
 */
export const ZERO_HIT_POINTS = 'zero hit points';

const creatureOf = (state: GameState, id: CharacterId) => state.creatures[id] ?? null;

export interface DamageCommand {
  readonly amount: number;
  readonly critical?: boolean;
  /** What dealt it, for the audit trail. */
  readonly source?: string;
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
  const creature = creatureOf(state, id);
  if (creature === null) return err('unknown_creature', `${id} is not in this game`);

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
}

/**
 * Heal a creature, lifting the unconsciousness that having no hit points caused
 * and leaving every other cause of it alone.
 */
export function healCreature(
  state: GameState,
  id: CharacterId,
  amount: number,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return err('unknown_creature', `${id} is not in this game`);

  if (!Number.isFinite(amount) || amount <= 0) {
    return err('bad_amount', `healing must be a positive number, got ${amount}`);
  }
  if (creature.vitals.dead) {
    return err('dead', `${id} is dead; hit points alone will not bring them back`);
  }

  const events: GameEvent[] = [{ type: 'healed', id, amount }];

  // SRD: the Unconscious condition from 0 hit points lasts "until you regain
  // any Hit Points". Only that cause lifts — a creature also held by Sleep
  // stays asleep.
  if (isDown(creature.vitals) && hasCondition(creature.conditions, 'unconscious')) {
    events.push({ type: 'condition-removed', id, condition: 'unconscious', source: ZERO_HIT_POINTS });
  }

  return ok(events);
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
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }

  if (!Number.isInteger(level) || level < 0 || level > 6) {
    return err('bad_level', `an Exhaustion level runs from 0 to 6, got ${level}`);
  }

  // The reducer applies the death itself, since "you die if your Exhaustion
  // level is 6" is a rule rather than a caller's decision. Damage would be the
  // wrong instrument: a healthy creature taking exactly its maximum drops to 0
  // rather than dying.
  return ok([{ type: 'exhaustion-set', id, level }]);
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
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }

  const events: GameEvent[] = [];

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

  events.push({ type: 'creature-removed', id });
  return ok(events);
}

/**
 * Apply a condition, refusing one the creature cannot receive.
 *
 * Immunity is a rules-legal refusal rather than a silent no-op, so the DM can
 * narrate it: the spell lands and does nothing.
 */
export function applyConditionTo(
  state: GameState,
  id: CharacterId,
  condition: ConditionName,
  source: string,
  immuneTo: readonly ConditionName[] = [],
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }
  if (immuneTo.includes(condition)) {
    return err('immune', `${id} is immune to the ${condition} condition`);
  }

  return ok([{ type: 'condition-applied', id, condition, source }]);
}

/** Every distinct reason a creature currently has a condition. */
export function whyCondition(
  state: GameState,
  id: CharacterId,
  condition: ConditionName,
): readonly string[] {
  const creature = creatureOf(state, id);
  if (creature === null) return [];
  return reasonsFor(creature.conditions, condition).map((i) => i.source);
}
