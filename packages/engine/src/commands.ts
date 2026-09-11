import {
  ABILITY_NAMES,
  err,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type Result,
  type RollMode,
} from '@ie/shared';
import type { Bonus, ModeSource } from './bonuses.js';
import {
  armorClass,
  spellAttackModifier,
  spellSaveDc,
  untrainedArmorPenalty,
} from './character.js';
import { applyDamage, rollAttack, rollAttackDamage, type AttackResult } from './attack.js';
import { coverBetween, distanceBetween } from './positioning.js';
import {
  damageDiceFor,
  definitionFor,
  targetCountFor,
  type SpellRange,
} from './spell-definitions.js';
import { routeFor } from './spellcasting.js';
import { rollSavingThrow, type D20TestResult } from './checks.js';
import type { Rng } from './dice.js';
import type { RollIssuer } from './rolls.js';
import { conditionInstanceId, hasCondition, isIncapacitated, reasonsFor } from './conditions.js';
import {
  resolveDuration,
  type Duration,
  type EffectTarget,
  type PendingSave,
  type RepeatSave,
} from './duration.js';
import {
  canSpendSpellSlotThisTurn,
  spendAction,
  spendBonusAction,
  spendReaction,
} from './combat.js';
import {
  applyEvent,
  castingIdFor,
  type AppliedCommand,
  type CommandStamp,
  type GameEvent,
  type GameState,
} from './events.js';
import {
  hasPool,
  remaining,
  spellSlotKey,
  type PoolDeclaration,
  type Recovery,
} from './resources.js';
import {
  castingIdOf,
  castingSource,
  slotFits,
  validateSpellName,
  type CastingTime,
  type ConcentrationCheck,
  type ConcentrationEndReason,
  type SlotlessReason,
} from './spells.js';
import { applyDamageToVitals, concentrationSaveDc, isDown } from './vitals.js';

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

/**
 * An idempotency key.
 *
 * Retry-safety has two halves and only one of them is free. A pure command
 * gives identical events from identical state — but a caller retrying after
 * its batch was already applied is looking at *updated* state, where casting
 * again is a genuine second casting that spends a second slot and rolls a
 * second save. An id is what tells those two situations apart.
 *
 * The same id means the same command, and the engine holds callers to that:
 * the inputs are fingerprinted alongside the id, and reusing an id for
 * different work is refused rather than silently swallowed. A silent no-op
 * there would be the worst of both worlds — the second command never runs and
 * nobody is told.
 */
export interface CommandIdentity {
  readonly commandId?: string;
}

/**
 * Serialise for comparison, with object keys sorted at every level.
 *
 * Two callers building the same command need the same fingerprint whatever
 * order they happened to write the fields in.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

export type Identified =
  | { readonly duplicate: true }
  | { readonly duplicate: false; readonly stamp: CommandStamp | null };

/**
 * Decide whether a command has already landed, and refuse a recycled id.
 *
 * The kind carries both the operation and the creature it acts on, so two
 * commands cannot collide on one id by having the same field names or by
 * being the same command aimed at somebody else. Either collision would
 * silently swallow the second command, which is the outcome this exists to
 * prevent.
 */
export function identify<T extends CommandIdentity>(
  state: GameState,
  kind: string,
  command: T,
): Result<Identified> {
  const id = command.commandId;
  if (id === undefined) return ok({ duplicate: false, stamp: null });

  const fingerprint = `${kind}|${stableStringify(command)}`;
  const prior = state.appliedCommands[id];

  if (prior === undefined) return ok({ duplicate: false, stamp: { id, fingerprint } });
  if (prior.fingerprint !== fingerprint) {
    return err(
      'command_id_reused',
      `command id ${id} has already been applied with different inputs; a command id names one command, not a slot to reuse`,
    );
  }
  return ok({ duplicate: true });
}

/** Whether a command id has already been applied to this state. */
export function wasCommandApplied(state: GameState, commandId: string): boolean {
  return state.appliedCommands[commandId] !== undefined;
}

/**
 * What a command produced, or null if it has not been applied.
 *
 * A retried casting returns no events, but the caller may still need the
 * casting id to link that spell's effects — so the outcome is recoverable
 * rather than lost with the empty batch.
 */
export function commandOutcome(state: GameState, commandId: string): AppliedCommand | null {
  return state.appliedCommands[commandId] ?? null;
}

export interface DamageCommand extends CommandIdentity {
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
  // Before anything else: a retry of a command that already landed is a no-op,
  // not a second hit. This has to precede validation too — otherwise a retry
  // reports whatever the first attempt caused rather than that it happened.
  const identity = identify(state, `damage:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

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

  // A caster leaving takes their ongoing spell with them, and the log should
  // say so rather than leaving the reader to infer it from the disappearance.
  const creature = creatureOf(state, id);
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
  duration?: Duration,
  repeatSave?: RepeatSave,
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }
  if (immuneTo.includes(condition)) {
    return err('immune', `${id} is immune to the ${condition} condition`);
  }

  const events: GameEvent[] = [{ type: 'condition-applied', id, condition, source }];

  // A hook needs a timer to hang on, even when the effect has no deadline of
  // its own: an indefinite one is still the thing the boundary looks at.
  if (duration === undefined && repeatSave !== undefined) {
    events.push({
      type: 'effect-scheduled',
      target: { kind: 'condition', on: id, instance: conditionInstanceId(condition, source) },
      deadline: { kind: 'indefinite' },
      repeatSave,
    });
  }

  if (duration !== undefined) {
    // Validate the duration before emitting anything: an unanswerable one must
    // not leave the condition applied with no way for it to end.
    const timer = schedule(
      state,
      { kind: 'condition', on: id, instance: conditionInstanceId(condition, source) },
      duration,
      repeatSave,
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok(events);
}

/**
 * The event that gives an effect a moment to stop at.
 *
 * The duration is resolved here rather than in the reducer, so a relative
 * duration that cannot be answered — "the start of your next turn", asked
 * outside combat — is a refusal the caller sees, not a deadline the log cannot
 * evaluate later.
 */
function schedule(
  state: GameState,
  target: EffectTarget,
  duration: Duration,
  repeatSave?: RepeatSave,
): Result<GameEvent> {
  const deadline = resolveDuration({ elapsed: state.elapsed, combat: state.combat }, duration);
  if (!deadline.ok) return deadline;
  return ok({
    type: 'effect-scheduled',
    target,
    deadline: deadline.value,
    ...(repeatSave === undefined ? {} : { repeatSave }),
  });
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
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return err('bad_amount', `temporary hit points must be a non-negative number, got ${amount}`);
  }
  return ok([{ type: 'temporary-hp-granted', id, amount }]);
}

// — resources ————————————————————————————————————————————————————————————————

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
  if (creature === null) return err('unknown_creature', `${id} is not in this game`);
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
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return err('unknown_creature', `${id} is not in this game`);
  }
  return ok([{ type: 'resources-restored', id, recovers }]);
}

// — casting ——————————————————————————————————————————————————————————————————

export interface CastCommand extends CommandIdentity {
  readonly spell: string;
  /** The spell's own level. 0 for a cantrip. */
  readonly level: number;
  /** Whether the spell's Duration entry says Concentration. */
  readonly concentration?: boolean;
  /** Defaults to an action. */
  readonly castingTime?: CastingTime;
  /** The level of slot to expend. Mutually exclusive with `slotless`. */
  readonly slotLevel?: number;
  /** Why no slot is being expended. Mutually exclusive with `slotLevel`. */
  readonly slotless?: SlotlessReason;
  /**
   * How long this casting lasts at most.
   *
   * SRD writes "Concentration, up to 1 minute" as a cap *and* a Concentration:
   * losing Concentration ends it early, and reaching the cap ends it whether
   * or not Concentration held. Omitted, the casting has no deadline of its own.
   */
  readonly duration?: Duration;
}

/**
 * The id the next casting will get, known before the command runs.
 *
 * Effects are linked to a casting by id, and the caller needs that id to build
 * the source string for the conditions the spell imposes. Exposing it up front
 * is what keeps the link deterministic instead of requiring the caller to dig
 * it back out of the emitted events.
 */
export function nextCastingId(state: GameState): string {
  return castingIdFor(state.castingsBegun + 1);
}

/**
 * Cast a spell: validate everything, then expend what it costs.
 *
 * Nothing is spent and no die is rolled until every check has passed, so an
 * illegal casting leaves the caster exactly as they were — the refusal is
 * something the DM narrates around, not something that quietly costs a slot.
 *
 * What this deliberately does *not* check: whether the caster knows or has
 * prepared the spell, and whether they have the components. Spell lists,
 * preparation and inventory are not modelled, and refusing on a rule the
 * engine cannot actually evaluate would be worse than leaving it to the layer
 * that knows.
 */
export function castSpell(
  state: GameState,
  id: CharacterId,
  command: CastCommand,
): Result<GameEvent[]> {
  // Before anything else, including validation: a retry of a command that has
  // already landed is a no-op. Checking later would report the damage the
  // first attempt did — "no level 2 slots left" — instead of reporting that
  // the casting already happened.
  const identity = identify(state, `cast:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const caster = creatureOf(state, id);
  if (caster === null) return err('unknown_creature', `${id} is not in this game`);
  if (caster.vitals.dead) return err('dead', `${id} is dead and casts nothing`);

  // SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction."
  // Every casting time is one of those, so none of them is available.
  if (isIncapacitated(caster.conditions)) {
    return err('incapacitated', `${id} is Incapacitated and can't cast`);
  }

  const name = validateSpellName(command.spell);
  if (!name.ok) return name;

  if (!Number.isInteger(command.level) || command.level < 0 || command.level > 9) {
    return err('bad_level', `a spell's level runs from 0 to 9, got ${command.level}`);
  }

  const castingTime = command.castingTime ?? 'action';
  // SRD: a spell of 1 minute or more "doesn't expend a spell slot" if
  // Concentration breaks before it finishes — so the slot goes at completion,
  // not at the start. Elapsed time is not modelled, so the engine says it
  // cannot do this rather than expending the slot at the wrong moment.
  if (castingTime === 'long') {
    return err(
      'unsupported_casting_time',
      'a casting time of 1 minute or more defers its slot until the casting completes, and elapsed time is not modelled yet',
    );
  }

  // SRD: "You must have training with any armor you are wearing to cast spells
  // while wearing it."
  if (untrainedArmorPenalty(caster.sheet)) {
    return err('untrained_armor', `${id} is not trained in the armour they are wearing`);
  }

  if (command.slotLevel !== undefined && command.slotless !== undefined) {
    return err('conflicting_slot', 'a casting either expends a slot or explains why it does not');
  }

  // SRD: "A cantrip is cast without a spell slot."
  if (command.level === 0 && command.slotLevel !== undefined) {
    return err('cantrip_takes_no_slot', 'a cantrip is cast without a spell slot');
  }

  let slot: { key: string; level: number } | null = null;
  let slotless: SlotlessReason | null = command.slotless ?? null;

  if (command.slotLevel === undefined) {
    if (command.level === 0) {
      slotless = slotless ?? 'cantrip';
    } else if (slotless === null) {
      return err(
        'no_slot_named',
        `${command.spell} is level ${command.level}; name the slot to expend or why none is`,
      );
    }
  } else {
    const level = command.slotLevel;
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      return err('bad_slot_level', `spell slots run from level 1 to 9, got ${level}`);
    }
    // SRD: "a level 2 spell fits only into a slot that's at least level 2."
    if (!slotFits(command.level, level)) {
      return err(
        'slot_too_small',
        `a level ${command.level} spell does not fit in a level ${level} slot`,
      );
    }

    const key = spellSlotKey(level);
    if (remaining(caster.resources, key) < 1) {
      return err('no_slot', `${id} has no level ${level} spell slots left`);
    }
    slot = { key, level };
  }

  // SRD: "On a turn, you can expend only one spell slot to cast a spell."
  // Outside combat there are no turns, so there is nothing to restrict.
  if (slot !== null && state.combat !== null && !canSpendSpellSlotThisTurn(state.combat, id)) {
    return err(
      'slot_already_spent_this_turn',
      `${id} has already expended a spell slot this turn`,
    );
  }

  // SRD: "the spell takes on the higher level for that casting."
  const castLevel = slot === null ? command.level : slot.level;
  const concentration = command.concentration === true;
  const castingId = nextCastingId(state);
  const events: GameEvent[] = [];

  // SRD: "You lose Concentration on an effect the moment you start casting a
  // spell that requires Concentration." The moment you *start* — which is why
  // this precedes the slot going, and why a casting that goes on to accomplish
  // nothing still costs the caster the spell they were holding.
  if (concentration && caster.concentration !== null) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: caster.concentration.castingId,
      reason: 'another-concentration-effect',
    });
  }

  events.push({
    type: 'spell-cast',
    castingId,
    id,
    spell: name.value,
    level: castLevel,
    slot,
    slotless,
    castingTime,
    concentration,
    ...(stamp === null ? {} : { command: stamp }),
  });

  if (concentration) {
    events.push({ type: 'concentration-started', id, castingId, spell: name.value, level: castLevel });
  }

  if (command.duration !== undefined) {
    const timer = schedule(state, { kind: 'casting', castingId }, command.duration);
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok(events);
}

/**
 * Impose a condition that belongs to the caster's ongoing Concentration.
 *
 * The source carries the casting id, so losing Concentration lifts exactly
 * this instance — not every Hold Person on the target, and not a condition
 * some other effect imposed.
 */
export interface SpellEffectOptions {
  readonly immuneTo?: readonly ConditionName[];
  readonly duration?: Duration;
  /** A saving throw this effect takes at a turn boundary. */
  readonly repeatSave?: RepeatSave;
}

export function applySpellEffect(
  state: GameState,
  targetId: CharacterId,
  condition: ConditionName,
  casterId: CharacterId,
  options: SpellEffectOptions = {},
): Result<GameEvent[]> {
  const caster = creatureOf(state, casterId);
  if (caster === null) return err('unknown_creature', `${casterId} is not in this game`);
  if (caster.concentration === null) {
    return err('not_concentrating', `${casterId} is not concentrating on anything`);
  }

  return applyConditionTo(
    state,
    targetId,
    condition,
    castingSource(caster.concentration.spell, caster.concentration.castingId),
    options.immuneTo ?? [],
    options.duration,
    options.repeatSave,
  );
}

/**
 * End one casting's effect on one creature, leaving the casting running.
 *
 * SRD Hold Person: "At the end of each of its turns, the target repeats the
 * save, **ending the spell on itself** on a success." On itself — not on
 * everyone. Upcast, Hold Person holds several Humanoids, and one of them
 * shaking it off must not free the rest or drop the caster's Concentration.
 *
 * {@link endConcentration} is the other half: that ends the casting
 * everywhere. This ends it in one place, and the caster keeps concentrating
 * because the spell is still doing something somewhere else.
 *
 * Only what *this* casting put there is removed — the link is the casting id
 * in the condition's source, so an unrelated poisoning on the same creature
 * stays exactly where it is.
 */
export function endSpellEffectOn(
  state: GameState,
  targetId: CharacterId,
  casterId: CharacterId,
): Result<GameEvent[]> {
  const caster = creatureOf(state, casterId);
  if (caster === null) return err('unknown_creature', `${casterId} is not in this game`);
  if (caster.concentration === null) {
    return err('not_concentrating', `${casterId} is not concentrating on anything`);
  }

  const target = creatureOf(state, targetId);
  if (target === null) return err('unknown_creature', `${targetId} is not in this game`);

  const castingId = caster.concentration.castingId;
  const theirs = target.conditions.instances.filter(
    (instance) => castingIdOf(instance.source) === castingId && instance.impliedBy === null,
  );
  if (theirs.length === 0) {
    return err(
      'no_effect_there',
      `${caster.concentration.spell} put nothing on ${targetId} that could end`,
    );
  }

  return ok(
    theirs.map((instance) => ({
      type: 'condition-removed',
      id: targetId,
      condition: instance.condition,
      source: instance.source,
    })),
  );
}

/**
 * End a Concentration, and with it everything that casting created.
 *
 * SRD: "The creator can end Concentration at any time (no action required)",
 * and "If the effect's creator loses Concentration, the effect ends."
 *
 * Breaking on Incapacitation or death does not come through here: that is not
 * a decision anybody makes, so the reducer derives it. See `events.ts`.
 */
export function endConcentration(
  state: GameState,
  id: CharacterId,
  reason: ConcentrationEndReason,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return err('unknown_creature', `${id} is not in this game`);
  if (creature.concentration === null) {
    return err('not_concentrating', `${id} is not concentrating on anything`);
  }

  return ok([
    { type: 'concentration-ended', id, castingId: creature.concentration.castingId, reason },
  ]);
}

/**
 * What a damaged concentrator has to roll, or null if nothing is at stake.
 *
 * SRD: "If you take damage, you must succeed on a Constitution saving throw to
 * maintain Concentration. The DC equals 10 or half the damage taken (round
 * down), whichever number is higher, up to a maximum DC of 30."
 *
 * Two details the wording decides:
 *
 * - **Damage taken, not hit points lost.** Temporary Hit Points absorb damage;
 *   they do not stop it being taken. So this reads the damage after the
 *   target's defences and *before* the temporary pool soaks any of it —
 *   otherwise a Warlock behind Armor of Agathys would concentrate through
 *   anything.
 * - **Zero is not damage.** No save is called for.
 *
 * Each instance of damage is its own save at its own DC. Two hits of 10 are
 * two DC 10 saves — and so is one hit of 20, since the floor of 10 swallows
 * both. The difference shows higher up: two hits of 30 are two DC 15 saves,
 * where one hit of 60 would be a single DC 30.
 *
 * The save itself is an ordinary Constitution saving throw — roll it through
 * `rollSavingThrow`, so proficiency, conditions and bonuses all apply — and a
 * failure is reported back with {@link endConcentration}.
 */
export function concentrationSaveAfterDamage(
  state: GameState,
  id: CharacterId,
  damage: number,
): ConcentrationCheck | null {
  const creature = creatureOf(state, id);
  if (creature?.concentration == null) return null;
  if (!Number.isFinite(damage) || damage <= 0) return null;

  return {
    castingId: creature.concentration.castingId,
    spell: creature.concentration.spell,
    ability: 'con',
    dc: concentrationSaveDc(damage),
    damage,
  };
}

/**
 * Turn a completed D20 test into the log's record of it.
 *
 * `roll-recorded` changes no state; it exists so the log can say why a number
 * was what it was. Every named contribution goes in, including ones that
 * subtracted, so a normal-looking total can still explain itself.
 */
export function recordD20Test(
  who: CharacterId,
  label: string,
  result: D20TestResult,
  outcome?: string,
): GameEvent {
  return {
    type: 'roll-recorded',
    who,
    label,
    natural: result.natural,
    total: result.total,
    contributions: [
      { source: 'modifier', amount: result.modifier },
      ...result.bonuses.map((bonus) => ({ source: bonus.source, amount: bonus.total })),
    ],
    ...(outcome === undefined ? {} : { outcome }),
  };
}

/**
 * What became of a Concentration the damage put at risk.
 *
 * Every variant is *settled*. An earlier design also returned the save as a
 * pending obligation when no generator was supplied, and that was wrong in a
 * way worth recording: nothing in the log or the state held the obligation, so
 * it did not survive a reload — and because the damage event had already
 * consumed the command id, retrying the same command to make good on it
 * returned a duplicate no-op reporting `none`. The spell stayed up, the save
 * was never made, and the engine said everything was fine.
 *
 * A caller that wants to look before rolling asks
 * {@link concentrationSaveAfterDamage}, which is a query and promises nothing.
 * `resolveDamage` settles.
 */
export type ConcentrationConsequence =
  | { readonly kind: 'none' }
  /** The damage itself ended it, so there was nothing to save against. */
  | { readonly kind: 'already-lost'; readonly castingId: string }
  | {
      readonly kind: 'resolved';
      readonly check: ConcentrationCheck;
      readonly save: D20TestResult;
      readonly maintained: boolean;
    };

export interface DamageResolution {
  readonly events: readonly GameEvent[];
  readonly concentration: ConcentrationConsequence;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * A generator and the effects that touch a Concentration save.
 *
 * War Caster grants Advantage on saves to maintain Concentration, and Bless is
 * Bless, so this takes the same modes and bonuses as any other D20 Test rather
 * than a narrow signature that would have to be widened later.
 */
export interface ConcentrationSaveSupply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  /**
   * Modifiers on the rolls this operation makes.
   *
   * War Caster on a Concentration save, Bless on a spell attack, a penalty a
   * DM is imposing. The operation does not know which roll a caller had in
   * mind, so they apply to the rolls it makes — which for a spell is the
   * attack and the target's save alike.
   */
  readonly modes?: readonly (RollMode | ModeSource)[];
  readonly bonuses?: readonly Bonus[];
}

/**
 * Damage a creature and settle the Concentration that damage put at risk, in
 * one operation.
 *
 * `damageCreature` and `concentrationSaveAfterDamage` still exist and still
 * work, but using them meant the caller had to *remember* the second call —
 * and a caller who forgot left a spell running that the rules had ended. That
 * is precisely the bookkeeping the engine exists to take off whoever is
 * driving it.
 *
 * The generator is required, not optional. Handing back an unrolled save would
 * be handing back an obligation nothing records: it would not survive a reload,
 * and the command id would already be spent, so there would be no way back to
 * it. Costing nothing to supply — every caller holding a `GameState` can
 * resume the generator from it — requiring it is the honest trade.
 *
 * The save is skipped entirely when the damage *already* ended the
 * Concentration: a caster dropped to 0 hit points is Unconscious, therefore
 * Incapacitated, therefore no longer concentrating. Rolling then would waste a
 * die and imply the spell might have survived.
 */
export function resolveDamage(
  state: GameState,
  id: CharacterId,
  command: DamageCommand,
  supply: ConcentrationSaveSupply,
): Result<DamageResolution> {
  const identity = identify(state, `damage:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], concentration: { kind: 'none' }, duplicate: true });
  }

  const held = creatureOf(state, id)?.concentration ?? null;

  const damage = damageCreature(state, id, command);
  if (!damage.ok) return damage;

  const events: GameEvent[] = [...damage.value];
  const after = events.reduce(applyEvent, state);

  const check = concentrationSaveAfterDamage(after, id, command.amount);
  if (check === null) {
    const lost = held !== null && (after.creatures[id]?.concentration ?? null) === null;
    return ok({
      events,
      concentration: lost ? { kind: 'already-lost', castingId: held.castingId } : { kind: 'none' },
      duplicate: false,
    });
  }

  const caster = after.creatures[id];
  if (caster === undefined) return err('unknown_creature', `${id} is not in this game`);

  // Count only what this operation issues: a caller may hand the same issuer to
  // several operations in a turn, and `count` runs from where it was created.
  const issuedBefore = supply.issuer.count;
  const save = rollSavingThrow(supply.issuer, supply.rng, caster.sheet, 'con', {
    dc: check.dc,
    conditions: caster.conditions,
    ...(supply.modes === undefined ? {} : { modes: supply.modes }),
    ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
  });
  if (!save.ok) return save;

  const maintained = save.value.success;
  events.push(
    recordD20Test(
      id,
      `Constitution save to maintain ${check.spell}`,
      save.value,
      maintained ? 'maintained' : 'lost',
    ),
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  );

  if (!maintained) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: check.castingId,
      reason: 'failed-save',
    });
  }

  return ok({
    events,
    concentration: { kind: 'resolved', check, save: save.value, maintained },
    duplicate: false,
  });
}

/**
 * Cast a spell and spend what it costs, action economy included.
 *
 * {@link castSpell} validates the spell and expends the slot; it does not
 * touch the action economy, because it predates having one to touch. That gap
 * let a caster throw two Fire Bolts in a turn: neither expends a slot, so the
 * one-slot-per-turn rule never fired, and nothing else was watching. SRD is
 * plain that "Most spells require the Magic action to cast", and two Magic
 * actions on one turn is not a turn.
 *
 * So this is the operation a tool surface exposes. `castSpell` stays for
 * callers reconstructing a log or scripting a fixture, where the economy has
 * already been accounted for — the same split as `damageCreature` beneath
 * `resolveDamage`.
 *
 * The spell is validated first and the economy second, so a refusal on either
 * side leaves slots, Concentration and the budget exactly as they were. A
 * retried command id is a no-op on both halves: it spends no second action any
 * more than it spends a second slot.
 *
 * **Reaction triggers are not enforced.** A spell with a casting time of a
 * Reaction spends the Reaction and is recorded, but the engine has no
 * interrupt mechanism: it does not check that a valid trigger occurred, and it
 * cannot order the casting against the event that triggered it. Counterspell
 * and Shield need that machinery and do not have it.
 */
export function resolveCast(
  state: GameState,
  id: CharacterId,
  command: CastCommand,
): Result<GameEvent[]> {
  const cast = castSpell(state, id, command);
  if (!cast.ok) return cast;
  // A duplicate command id: the first run already spent the action.
  if (cast.value.length === 0) return ok([]);

  const combat = state.combat;
  if (combat === null || combat.budgets[id] === undefined) {
    // No turns, so no economy to spend. Out of combat a spell simply happens.
    return cast;
  }

  const conditions = creatureOf(state, id)?.conditions;
  const castingTime = command.castingTime ?? 'action';

  const spent =
    castingTime === 'reaction'
      ? spendReaction(combat, id, conditions)
      : castingTime === 'bonus-action'
        ? spendBonusAction(combat, id, conditions)
        : spendAction(combat, id, conditions);
  if (!spent.ok) return spent;

  const economy: GameEvent =
    castingTime === 'reaction'
      ? { type: 'reaction-spent', id }
      : castingTime === 'bonus-action'
        ? { type: 'bonus-action-spent', id }
        : { type: 'action-spent', id };

  // The action goes first: you spend it to *start* casting, which is also the
  // moment an earlier Concentration drops.
  return ok([economy, ...cast.value]);
}

// — turn boundaries ——————————————————————————————————————————————————————————

/** One turn-boundary save, rolled and settled. */
export interface ResolvedRepeatSave {
  readonly effectKey: string;
  readonly target: CharacterId;
  readonly ability: Ability;
  readonly dc: number;
  readonly label: string;
  readonly save: D20TestResult;
  readonly success: boolean;
}

export interface TurnResolution {
  readonly events: readonly GameEvent[];
  /** Saves rolled here. Empty when none were owed, or none could be rolled. */
  readonly saves: readonly ResolvedRepeatSave[];
  /** Saves left outstanding, because no generator was supplied. */
  readonly pending: readonly PendingSave[];
}

/** Every turn-boundary save still owed, in a stable order. */
export function pendingSavesOf(state: GameState): readonly PendingSave[] {
  return Object.keys(state.pendingSaves)
    .sort()
    .map((key) => state.pendingSaves[key])
    .filter((pending): pending is PendingSave => pending !== undefined);
}

/**
 * Roll the turn-boundary saves a state already owes.
 *
 * The deferred half of {@link resolveTurn}: a caller who advanced without a
 * generator comes back here. The debt is in state, so this works after a
 * reload, on a different machine, a week later.
 */
export function resolvePendingSaves(
  state: GameState,
  supply: ConcentrationSaveSupply,
): Result<TurnResolution> {
  const owed = pendingSavesOf(state);
  if (owed.length === 0) return ok({ events: [], saves: [], pending: [] });

  const events: GameEvent[] = [];
  const saves: ResolvedRepeatSave[] = [];
  const issuedBefore = supply.issuer.count;

  for (const pending of owed) {
    const creature = state.creatures[pending.target];
    if (creature === undefined) {
      return err('unknown_creature', `${pending.target} owes a save but is not in this game`);
    }

    const save = rollSavingThrow(supply.issuer, supply.rng, creature.sheet, pending.ability, {
      dc: pending.dc,
      conditions: creature.conditions,
      ...(supply.modes === undefined ? {} : { modes: supply.modes }),
      ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
    });
    if (!save.ok) return save;

    events.push(
      recordD20Test(
        pending.target,
        pending.label,
        save.value,
        save.value.success ? 'shakes it off' : 'still held',
      ),
      {
        type: 'effect-save-resolved',
        effectKey: pending.effectKey,
        turn: pending.turn,
        success: save.value.success,
      },
    );
    saves.push({
      effectKey: pending.effectKey,
      target: pending.target,
      ability: pending.ability,
      dc: pending.dc,
      label: pending.label,
      save: save.value,
      success: save.value.success,
    });
  }

  // One generator position for the whole boundary, recorded once.
  events.splice(0, 0, {
    type: 'rolls-issued',
    count: supply.issuer.count - issuedBefore,
    rng: supply.rng.snapshot(),
  });

  return ok({ events, saves, pending: [] });
}

/**
 * End the current turn, and settle whatever ending it owes.
 *
 * SRD effects that "repeat the save at the end of each of its turns" are
 * everywhere, and leaving them to the caller means leaving them to be
 * forgotten. So the turn itself knows: advancing raises the saves the boundary
 * owes, and this rolls them.
 *
 * Given no generator the saves stay in state as a pending resolution — and the
 * engine then **refuses to advance another turn** until they are settled.
 * That is the difference between a debt and a leak: forgetting stops the game
 * rather than quietly dropping a rule. `resolvePendingSaves` clears it.
 *
 * A success ends the effect on that target, or the whole casting, as the
 * effect's own hook says. Either way the caster's Concentration, the other
 * targets, and anything an unrelated source put there are left alone.
 */
export function resolveTurn(
  state: GameState,
  supply?: ConcentrationSaveSupply,
): Result<TurnResolution> {
  if (state.combat === null) return err('no_combat', 'no combat is running');

  const outstanding = pendingSavesOf(state);
  if (outstanding.length > 0) {
    return err(
      'saves_pending',
      `${outstanding.length} turn-boundary save(s) are still owed; resolve them before the turn moves on`,
    );
  }

  const advanced: GameEvent[] = [{ type: 'turn-advanced' }];
  const after = advanced.reduce(applyEvent, state);
  const raised = pendingSavesOf(after);

  if (raised.length === 0) return ok({ events: advanced, saves: [], pending: [] });
  if (supply === undefined) return ok({ events: advanced, saves: [], pending: raised });

  const settled = resolvePendingSaves(after, supply);
  if (!settled.ok) return settled;

  return ok({
    events: [...advanced, ...settled.value.events],
    saves: settled.value.saves,
    pending: [],
  });
}

// — casting a spell the engine knows ——————————————————————————————————————————

/** What happened to one target of one casting. */
export interface SpellTargetOutcome {
  readonly target: CharacterId;
  readonly attack?: AttackResult;
  readonly save?: D20TestResult;
  readonly damage?: number;
  readonly condition?: ConditionName;
  /** Whether the effect actually landed on this target. */
  readonly affected: boolean;
}

export interface SpellResolution {
  readonly events: readonly GameEvent[];
  readonly castingId: string;
  readonly outcomes: readonly SpellTargetOutcome[];
  /**
   * Checks the rules call for that the engine could not make, named.
   *
   * A silent pass would be the engine claiming to have checked something it
   * cannot see. Creature type is the standing example: Hold Person wants a
   * Humanoid, and `CreatureState` carries a sheet, not a type.
   */
  readonly unverified: readonly string[];
}

export interface CastSpellRequest extends CommandIdentity {
  readonly spellId: string;
  readonly targets: readonly CharacterId[];
  /** The slot to spend. Omitted for a cantrip or a free casting. */
  readonly slotLevel?: number;
  /** Why no slot is being spent, when none is. */
  readonly slotless?: SlotlessReason;
}

const ranged = (range: SpellRange): number | null =>
  range.kind === 'ranged' ? range.feet : range.kind === 'touch' ? 5 : null;

/**
 * Cast a spell the engine has a definition for, and resolve it on its targets.
 *
 * Everything mechanical is derived, not supplied: the attack modifier and save
 * DC from the caster's sheet, the damage dice from the definition's scaling and
 * the caster's level or the slot, the condition and its duration and its
 * end-of-turn repeat save from the definition. A caller names a spell, some
 * targets, and a slot; it does not get to say what the spell does.
 *
 * It refuses what it can check and *reports* what it cannot. Access and
 * preparation, the slot, the action, range and Total Cover are checked; the
 * creature type a spell demands is not, because nothing in state carries one,
 * and that comes back in `unverified` rather than passing quietly.
 */
export function resolveSpell(
  state: GameState,
  casterId: CharacterId,
  request: CastSpellRequest,
  supply: ConcentrationSaveSupply,
): Result<SpellResolution> {
  // A turn-boundary save outstanding means somebody may or may not still be
  // Paralyzed, and casting at them would be resolving against a state nobody
  // has settled. The rule is the same one that stops the turn advancing.
  const owed = pendingSavesOf(state);
  if (owed.length > 0) {
    return err(
      'saves_pending',
      `${owed.length} turn-boundary save(s) are still owed; resolve them before acting`,
    );
  }

  const caster = creatureOf(state, casterId);
  if (caster === null) return err('unknown_creature', `${casterId} is not in this game`);

  const definition = definitionFor(request.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${request.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD: you cast what you know or have prepared, and nothing else.
  const route = routeFor(caster.spellcasting, request.spellId);
  if (route === null) {
    return err(
      'spell_not_available',
      `${casterId} has not prepared ${definition.name} and knows it from nothing else`,
    );
  }

  const slotLevel = request.slotLevel ?? definition.level;
  const castLevel = Math.max(definition.level, slotLevel);
  const unverified: string[] = [];

  // — targets ————————————————————————————————————————————————————————————
  const allowed = targetCountFor(definition.targets, definition.level, castLevel);
  if (request.targets.length === 0) {
    return err('no_targets', `${definition.name} needs a target`);
  }
  if (request.targets.length > allowed) {
    return err(
      'too_many_targets',
      `${definition.name} at level ${castLevel} takes ${allowed} target(s), got ${request.targets.length}`,
    );
  }
  if (new Set(request.targets).size !== request.targets.length) {
    return err('duplicate_target', `${definition.name} may not take the same target twice`);
  }

  const reach = ranged(definition.range);
  for (const target of request.targets) {
    if (state.creatures[target] === undefined) {
      return err('unknown_creature', `${target} is not in this game`);
    }
    if (target === casterId && definition.targets.self !== true) {
      return err('cannot_target_self', `${definition.name} is not cast on yourself`);
    }

    if (definition.targets.mustBeType !== undefined) {
      unverified.push(
        `${definition.name} requires a ${definition.targets.mustBeType} target; the engine does not model creature type, so ${target} was not checked`,
      );
    }

    if (state.scene === null) {
      unverified.push(`no scene is set, so ${definition.name}'s range was not checked`);
    } else if (reach !== null) {
      const apart = distanceBetween(state.scene, casterId, target);
      if (!apart.ok) {
        unverified.push(
          `${target} has no position, so ${definition.name}'s range of ${reach} feet was not checked`,
        );
      } else if (apart.value > reach) {
        return err(
          'out_of_range',
          `${definition.name} reaches ${reach} feet; ${target} is ${apart.value} away`,
        );
      }

      // SRD: "To target something with a spell, a caster must have a clear
      // path to it, so it can't be behind Total Cover."
      if (coverBetween(state.scene, casterId, target) === 'total') {
        return err('total_cover', `${target} is behind Total Cover`);
      }
    }
  }

  // — paying for it ——————————————————————————————————————————————————————
  //
  // A free casting from a feat spends its own pool; anything else goes through
  // the ordinary casting command, which owns slots, the action, and the
  // Concentration that starts or is replaced.
  const freePool =
    route.kind === 'granted' && request.slotLevel === undefined ? route.grant.freeCastPool : null;

  const events: GameEvent[] = [];
  const castingId = nextCastingId(state);

  if (freePool !== null) {
    if (remaining(caster.resources, freePool) < 1) {
      return err(
        'no_free_casting',
        `${casterId} has used the free casting of ${definition.name} and must spend a slot`,
      );
    }
    events.push({ type: 'resource-spent', id: casterId, key: freePool, amount: 1 });
  }

  const cast = resolveCast(state, casterId, {
    spell: definition.name,
    level: definition.level,
    concentration: definition.concentration,
    castingTime: definition.castingTime,
    ...(freePool !== null || definition.level === 0
      ? { slotless: definition.level === 0 ? ('cantrip' as const) : ('special-ability' as const) }
      : { slotLevel: castLevel }),
    ...(request.slotless === undefined ? {} : { slotless: request.slotless }),
    ...(definition.durationSeconds === undefined
      ? {}
      : { duration: { kind: 'seconds' as const, seconds: definition.durationSeconds } }),
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
  });
  if (!cast.ok) return cast;
  // A retried command: the first run did all of this.
  if (cast.value.length === 0) {
    return ok({ events: [], castingId, outcomes: [], unverified: [] });
  }
  events.push(...cast.value);

  // — what it does ———————————————————————————————————————————————————————
  let current = events.reduce(applyEvent, state);
  const outcomes: SpellTargetOutcome[] = [];
  const issuedBefore = supply.issuer.count;

  const attackModifier = spellAttackModifier(caster.sheet) ?? 0;
  const saveDc = spellSaveDc(caster.sheet) ?? 0;

  for (const target of request.targets) {
    for (const effect of definition.effects) {
      const victim = current.creatures[target];
      if (victim === undefined) continue;

      if (effect.kind === 'attack') {
        const attack = rollAttack(supply.issuer, supply.rng, caster.sheet, {
          weapon: null,
          targetAc: armorClass(victim.sheet),
          attackBonuses: [
            { source: `${definition.name} (spell attack)`, flat: attackModifier },
            ...(supply.bonuses ?? []),
          ],
          ...(supply.modes === undefined ? {} : { modes: supply.modes }),
          targetConditions: victim.conditions,
        });
        if (!attack.ok) return attack;

        events.push({
          type: 'roll-recorded',
          who: casterId,
          label: `${definition.name} attack`,
          natural: attack.value.roll.natural,
          total: attack.value.total,
          contributions: [{ source: 'spell attack', amount: attackModifier }],
          outcome: attack.value.hit ? 'hit' : 'miss',
        });

        if (!attack.value.hit) {
          outcomes.push({ target, attack: attack.value, affected: false });
          continue;
        }

        const dice = damageDiceFor(effect.damage, definition.level, caster.sheet.level, castLevel);
        const rolled = rollAttackDamage(
          supply.issuer,
          supply.rng,
          caster.sheet,
          {
            weapon: null,
            targetAc: armorClass(victim.sheet),
            extraDamage: [{ source: definition.name, type: effect.damageType, dice }],
          },
          attack.value.critical,
        );
        if (!rolled.ok) return rolled;

        const applied = applyDamage(
          rolled.value.components.filter((c) => c.source === definition.name),
          {},
        );
        const hurt = damageCreature(current, target, {
          amount: applied.total,
          source: definition.name,
          ...(attack.value.critical ? { critical: true } : {}),
        });
        if (!hurt.ok) return hurt;

        events.push(...hurt.value);
        current = hurt.value.reduce(applyEvent, current);
        outcomes.push({
          target,
          attack: attack.value,
          damage: applied.total,
          affected: true,
        });
        continue;
      }

      // A saving throw, and a condition on a failure.
      const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
        dc: saveDc,
        conditions: victim.conditions,
        ...(supply.modes === undefined ? {} : { modes: supply.modes }),
        ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
      });
      if (!save.ok) return save;

      events.push(
        recordD20Test(
          target,
          `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
          save.value,
          save.value.success ? 'resisted' : 'affected',
        ),
      );

      if (save.value.success) {
        outcomes.push({ target, save: save.value, affected: false });
        continue;
      }

      const landed = applySpellEffect(current, target, effect.condition, casterId, {
        ...(effect.repeats === undefined
          ? {}
          : {
              repeatSave: {
                at: effect.repeats.at,
                of: target,
                ability: effect.ability,
                dc: saveDc,
                onSuccess: effect.repeats.onSuccess,
                label: `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
              },
            }),
      });
      if (!landed.ok) return landed;

      events.push(...landed.value);
      current = landed.value.reduce(applyEvent, current);
      outcomes.push({
        target,
        save: save.value,
        condition: effect.condition,
        affected: true,
      });
    }
  }

  if (supply.issuer.count > issuedBefore) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  return ok({ events, castingId, outcomes, unverified });
}
