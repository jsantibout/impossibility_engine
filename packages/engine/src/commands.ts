import {
  ABILITY_NAMES,
  err,
  needsContext,
  type ContextRequest,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type Result,
  type RollMode,
} from '@ie/shared';
import { bonusesFor, type Bonus, type ModeSource } from './bonuses.js';
import {
  armorClass,
  modifierFor,
  spellAttackModifierWith,
  spellSaveDcWith,
  untrainedArmorPenalty,
  type CharacterSheet,
} from './character.js';
import {
  applyDamage,
  meleeReach,
  proficientWith,
  rangeOf,
  rollAttack,
  rollAttackDamage,
  type AttackResult,
  type DamageComponent,
  type ExtraDamage,
} from './attack.js';
import type { Weapon } from '@ie/srd';
import { expandPack, itemFor, type CatalogueItem, type ItemKind } from './catalogue.js';
import {
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  creaturesInArea,
  distanceBetween,
  distanceToPoint,
  moveCreature,
  positionOf,
  sightBetween,
  type Placement,
  type AreaOrigin,
  type AreaShape,
  type Point,
} from './positioning.js';
import {
  DIRECTIONAL_AREAS,
  scaledDiceFor,
  scaledFlatFor,
  definitionFor,
  targetCountFor,
  type RiderDuration,
  type SpellArea,
  type SpellDefinition,
  type SpellRange,
} from './spell-definitions.js';
import { routesFor, type CastingRoute, type SpellcastingState } from './spellcasting.js';
import { DODGE, DODGE_ACTION, READY, READY_ACTION } from './actions.js';
import {
  attackedWithDisadvantage,
  defensesOf,
  effectiveConditions,
  standingAttackDamage,
  standingSaveBonuses,
  standingSaveModes,
  type ActivatedFeature,
} from './standing.js';
import { rollSavingThrow, type D20TestResult } from './checks.js';
import type { Rng } from './dice.js';
import type { RollIssuer } from './rolls.js';
import {
  conditionInstanceId,
  conditionSpeed,
  hasCondition,
  isIncapacitated,
  reasonsFor,
  type ConditionState,
} from './conditions.js';
import {
  endOfNextTurn,
  resolveDuration,
  startOfNextTurn,
  type Duration,
  type EffectTarget,
  type PendingSave,
  type RepeatSave,
} from './duration.js';
import {
  canSpendSpellSlotThisTurn,
  currentCombatant,
  dash,
  disengage,
  rollInitiative,
  spendAction,
  spendAttack,
  spendMovement,
  spendBonusAction,
  spendReaction,
  type InitiativeOptions,
  type InitiativeRoll,
} from './combat.js';
import {
  applyEvent,
  castingIdFor,
  wearsHeavyArmor,
  type InventoryLine,
  type AppliedCommand,
  type CommandStamp,
  type CreatureState,
  type GameEvent,
  type GameState,
  type PendingAttack,
  type PendingMove,
  type ReadiedAction,
  type ReadiedResponse,
} from './events.js';
import {
  hasPool,
  remaining,
  slotKeyOf,
  type PoolDeclaration,
  type Recovery,
  type SlotKind,
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
import {
  applyDamageToVitals,
  concentrationSaveDc,
  isDown,
  rollDeathSave,
} from './vitals.js';

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
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

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
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // The mirror of `damageCreature`, which has been guarded since command ids
  // landed. Healing was not, and a retried heal healed twice — the same bug in
  // the opposite direction, and the easier one to miss because nobody
  // complains about extra hit points until a boss fight.
  const identity = identify(state, `heal:${id}`, { ...command, amount });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

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
    return needsContext('unknown_creature', `${id} is not in this game`);
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
    return needsContext('unknown_creature', `${id} is not in this game`);
  }

  // Anything this creature was holding up has to be settled first, or the
  // fight cannot continue without them.
  const events: GameEvent[] = [...settleHoldsInvolving(state, id)];

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
function settleHoldsInvolving(state: GameState, id: CharacterId): readonly GameEvent[] {
  const events: GameEvent[] = [];

  // A held hit needs both parties: one to roll the damage and one to take it.
  const attack = state.pendingAttack;
  if (attack !== null && (attack.attacker === id || attack.target === id)) {
    events.push({ type: 'attack-damage-dealt', attacker: attack.attacker });
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
    return needsContext('unknown_creature', `${id} is not in this game`);
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
 * A rider's own deadline, bound to the creature it is anchored to.
 *
 * A definition names a *role* rather than a creature, because it is written
 * once and cast at whoever is standing there. Binding it here is the only
 * place a role becomes an id, so there is exactly one reading of "your next
 * turn" in the engine.
 *
 * Returns undefined when the rider has no deadline of its own, which is the
 * ordinary case: the condition then lasts as long as the casting, on the
 * casting's own timer.
 */
function riderDuration(
  lasts: RiderDuration | undefined,
  casterId: CharacterId,
): Duration | undefined {
  if (lasts === undefined) return undefined;
  return lasts === 'end-of-casters-next-turn'
    ? endOfNextTurn(casterId)
    : startOfNextTurn(casterId);
}

/**
 * Every rider deadline a casting of this spell is going to need.
 *
 * Gathered so they can be checked before anything is spent. A turn-anchored
 * rider cannot be pinned outside combat, and finding that out at the moment
 * the condition lands is too late: the saving throw has already been rolled,
 * and the caller's generator has already moved for a cast that never happened.
 */
function riderDurations(definition: SpellDefinition): readonly RiderDuration[] {
  const found: RiderDuration[] = [];
  for (const effect of definition.effects) {
    if (effect.kind === 'save' && effect.lasts !== undefined) found.push(effect.lasts);
    if (effect.kind === 'attack' && effect.condition?.lasts !== undefined) {
      found.push(effect.condition.lasts);
    }
    if (effect.kind === 'save-damage' && effect.condition?.lasts !== undefined) {
      found.push(effect.condition.lasts);
    }
  }
  return found;
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
    return needsContext('unknown_creature', `${id} is not in this game`);
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
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
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
    return needsContext('unknown_creature', `${id} is not in this game`);
  }
  return ok([{ type: 'resources-restored', id, recovers }]);
}

// — the actions that change what a turn can do ————————————————————————————————

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed after applying any modifiers."
 */
export function takeDash(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  const identity = identify(state, `dash:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);
  if (state.combat === null) {
    return err('not_in_combat', 'there is no movement budget to add to outside combat');
  }

  // Validate the whole operation before any of it is emitted: the action has
  // to be there to spend, and the increase has to be one this creature can
  // actually receive.
  const spent = spendAction(state.combat, id, creature.conditions);
  if (!spent.ok) return spent;
  const dashed = dash(spent.value, id, creature.conditions);
  if (!dashed.ok) return dashed;

  return ok([
    { type: 'action-spent', id },
    { type: 'dash-taken', id, ...(stamp === null ? {} : { command: stamp }) },
  ]);
}

/**
 * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
 * rest of the current turn."
 */
export function takeDisengage(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  const identity = identify(state, `disengage:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);
  if (state.combat === null) {
    return err('not_in_combat', 'there are no Opportunity Attacks to avoid outside combat');
  }

  const spent = spendAction(state.combat, id, creature.conditions);
  if (!spent.ok) return spent;
  const taken = disengage(spent.value, id);
  if (!taken.ok) return taken;

  return ok([
    { type: 'action-spent', id },
    { type: 'disengage-taken', id, ...(stamp === null ? {} : { command: stamp }) },
  ]);
}

/**
 * SRD Dodge: "until the start of your next turn, any attack roll made against
 * you has Disadvantage if you can see the attacker, and you make Dexterity
 * saving throws with Advantage."
 *
 * An action anybody can take, so the benefits come out of `actions.ts` rather
 * than off a sheet — but everything else about it is the shape `activateFeature`
 * already has, including the turn-anchored deadline and the end when the
 * dodger is Incapacitated.
 */
export function takeDodge(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  const identity = identify(state, `dodge:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);
  if (creature.activeFeatures.includes(DODGE)) {
    return err('already_active', `${id} is already Dodging`);
  }

  const events: GameEvent[] = [];
  if (state.combat !== null && state.combat.budgets[id] !== undefined) {
    const spent = spendAction(state.combat, id, creature.conditions);
    if (!spent.ok) return spent;
    events.push({ type: 'action-spent', id });
  }

  events.push({
    type: 'feature-activated',
    id,
    feature: DODGE,
    ...(stamp === null ? {} : { command: stamp }),
  });

  const timer = featureTimer(state, id, DODGE_ACTION);
  if (!timer.ok) return timer;
  if (timer.value !== null) events.push(timer.value);

  return ok(events);
}

/**
 * What a Ready is being held for, and what it will do.
 *
 * The trigger is free text and stays that way. SRD asks for "a perceivable
 * circumstance", and the circumstances a table readies against live almost
 * entirely in fiction the engine has never been told about — a trapdoor, a
 * chant, a door. **Absence from structured state is not evidence that a thing
 * does not exist**, so an engine that judged the trigger would be refusing
 * readied actions on the strength of its own ignorance. Maestro says when it
 * fired; everything around it is the engine's.
 */
export interface ReadyCommand extends CommandIdentity {
  readonly trigger: string;
  readonly response: ReadyResponse;
}

/** The response as a caller states it, before the engine has paid for it. */
export type ReadyResponse =
  | { readonly kind: 'action'; readonly note?: string }
  | { readonly kind: 'move' }
  | {
      readonly kind: 'spell';
      readonly spellId: string;
      /** The slot to expend now. Omitted for a cantrip. */
      readonly slotLevel?: number;
      readonly slotKind?: SlotKind;
      readonly source?: string;
    };

/** What this creature is holding for a trigger, or null. */
export function readiedBy(state: GameState, id: CharacterId): ReadiedAction | null {
  return creatureOf(state, id)?.readied ?? null;
}

/**
 * Ready an action: spend it now, to take a Reaction later.
 *
 * SRD: "You take the Ready action to wait for a particular circumstance before
 * you act. To do so, you take this action on your turn, which lets you act by
 * taking a Reaction before the start of your next turn."
 *
 * The deadline is the same turn-anchored one Dodge uses, expressed the same
 * way — an activated feature with a timer — because the benefit has to outlive
 * the turn that bought it, and a turn budget is cleared when the turn ends.
 *
 * A readied **spell** is the SRD's own special case and the only part of this
 * the engine has real rules for: "you cast it as normal (expending any
 * resources used to cast it) but hold its energy, which you release with your
 * Reaction when the trigger occurs... To be readied, a spell must have a
 * casting time of an action, and holding on to the spell's magic requires
 * Concentration." So the slot goes now and the effects do not, which is why
 * the casting and its resolution are two commands rather than one.
 */
export function takeReady(
  state: GameState,
  id: CharacterId,
  command: ReadyCommand,
): Result<GameEvent[]> {
  const identity = identify(state, `ready:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);

  // SRD: "you take this action on your turn, which lets you act by taking a
  // Reaction before the start of your next turn." Both halves need turns.
  if (state.combat === null || state.combat.budgets[id] === undefined) {
    return err('not_in_combat', 'a readied action waits for a Reaction, and there are no turns to take one in');
  }
  if (creature.readied !== null) {
    return err('already_readied', `${id} is already holding a readied action`);
  }
  if (command.trigger.trim() === '') {
    return err('no_trigger', 'a readied action waits for something; say what');
  }

  // Validate the whole thing before any of it is emitted, casting included:
  // a Ready that refuses must leave the action, the slot and the
  // Concentration exactly as they were.
  const spent = spendAction(state.combat, id, creature.conditions);
  if (!spent.ok) return spent;

  const events: GameEvent[] = [{ type: 'action-spent', id }];
  let response: ReadiedResponse;

  if (command.response.kind === 'spell') {
    const held = holdSpell(state, id, command.response);
    if (!held.ok) return held;
    events.push(...held.value.events);
    response = held.value.response;
  } else if (command.response.kind === 'move') {
    response = { kind: 'move' };
  } else {
    response = {
      kind: 'action',
      ...(command.response.note === undefined ? {} : { note: command.response.note }),
    };
  }

  events.push({
    type: 'feature-activated',
    id,
    feature: READY,
    ...(stamp === null ? {} : { command: stamp }),
  });
  events.push({ type: 'readied-declared', id, readied: { trigger: command.trigger, response } });

  const timer = featureTimer(state, id, READY_ACTION);
  if (!timer.ok) return timer;
  if (timer.value !== null) events.push(timer.value);

  return ok(events);
}

/**
 * Cast the spell being readied, without resolving it.
 *
 * SRD: "you cast it as normal (expending any resources used to cast it) but
 * hold its energy." So this is an ordinary casting with the effects left
 * undone — the slot goes, and the Concentration that holds the magic starts,
 * whether or not the spell itself is a Concentration spell.
 *
 * The action is **not** spent here: the Ready action is the casting's action,
 * and charging for both would take two actions for one thing the SRD charges
 * once for. `castSpell` is the half beneath `resolveCast` that leaves the
 * economy alone, which is exactly the half this wants.
 */
function holdSpell(
  state: GameState,
  id: CharacterId,
  response: ReadyResponse & { readonly kind: 'spell' },
): Result<{ readonly events: readonly GameEvent[]; readonly response: ReadiedResponse }> {
  const definition = definitionFor(response.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${response.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD: "To be readied, a spell must have a casting time of an action."
  if (definition.castingTime !== 'action') {
    return err(
      'not_readiable',
      `${definition.name} is cast with a ${definition.castingTime}, and only a spell cast with an action can be readied`,
    );
  }

  const caster = creatureOf(state, id);
  if (caster === null) return needsContext('unknown_creature', `${id} is not in this game`);

  // SRD: you ready what you know or have prepared, and nothing else.
  const chosen = chooseRoute(caster.spellcasting, response.spellId, response.source);
  if (!chosen.ok) return chosen;
  const route = chosen.value;

  const castLevel = Math.max(definition.level, response.slotLevel ?? definition.level);
  const castingId = nextCastingId(state);

  const cast = castSpell(state, id, {
    spell: definition.name,
    level: definition.level,
    // SRD: "holding on to the spell's magic requires Concentration" — for
    // every readied spell, not only the ones whose own Duration says so.
    concentration: true,
    castingTime: definition.castingTime,
    ...(response.slotLevel === undefined
      ? { slotless: 'cantrip' as const }
      : {
          slotLevel: response.slotLevel,
          ...(response.slotKind === undefined ? {} : { slotKind: response.slotKind }),
        }),
    route: route.kind === 'granted' ? route.grant.source : `class:${route.classId}`,
    // No duration. The spell has not taken effect, so its own clock has not
    // started; what *is* capped is the hold, and that is the Ready feature's
    // deadline rather than the spell's.
  });
  if (!cast.ok) return cast;

  return ok({
    events: cast.value,
    response: { kind: 'spell', spellId: response.spellId, castingId, castLevel },
  });
}

/**
 * What letting the held action go actually did.
 *
 * One shape with two optional halves rather than a union, because what the
 * release *always* does — spend the Reaction, close the hold — is the same
 * whichever response was held, and the rest is what that response happened to
 * be. An `action` response fills in neither: the engine has commands for a
 * handful of the SRD's open action list, so the caller takes it from here.
 */
export interface ReadyRelease {
  readonly events: readonly GameEvent[];
  /** Whether the Reaction was taken, or the trigger let pass. */
  readonly took: boolean;
  /** The spell that landed, for a readied spell. */
  readonly spell?: SpellResolution;
  /** The move that was made, for a readied move. */
  readonly move?: MoveResolution;
}

/** How the held action is being let go. */
export interface ReleaseCommand extends CommandIdentity {
  /**
   * SRD: "you can either take your Reaction right after the trigger finishes
   * **or ignore the trigger**." Ignoring costs nothing and keeps the Reaction.
   */
  readonly ignore?: boolean;
  /** Who a readied spell lands on. Empty for an area spell, which picks its own. */
  readonly targets?: readonly CharacterId[];
  /** Where a readied area spell's origin goes. */
  readonly at?: Point;
  /** Where a readied move goes, relative to something already established. */
  readonly placement?: Placement;
  /** How many feet of that move are through Difficult Terrain. */
  readonly difficultFeet?: number;
}

/**
 * Take the Reaction a readied action was held for — or let the trigger pass.
 *
 * The trigger is Maestro's call and has already been made by the time this is
 * reached; what the engine owns is the Reaction, the hold, and, for a readied
 * spell, everything the spell does.
 *
 * For an `action` response this spends the Reaction and clears the hold; the
 * action itself goes through its own command afterwards, because the SRD's
 * action list is open and the engine has commands for a handful of it. An
 * attack taken this way is `resolveAttack({ free: true })` — the Reaction is
 * what paid for it, exactly as an Opportunity Attack is.
 */
export function releaseReady(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
): Result<ReadyRelease> {
  // Without this the retry came back `nothing_readied` — a refusal, telling
  // the caller the hold never existed when in fact their first call consumed
  // it. A retry that reads as a rules problem is worse than one that doubles,
  // because the DM narrates the lie.
  const identity = identify(state, `release:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok({ events: [], took: true });
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);

  const readied = creature.readied;
  if (readied === null) {
    return err('nothing_readied', `${id} is not holding a readied action`);
  }

  // SRD: "or ignore the trigger." Nothing is spent and nothing happens — but
  // the hold is gone, because the trigger it was waiting for has been and
  // passed. A held spell dissipates with it.
  if (command.ignore === true) {
    return ok({
      events: [
        {
          type: 'readied-released',
          id,
          took: false,
          ...(stamp === null ? {} : { command: stamp }),
        },
      ],
      took: false,
    });
  }

  if (state.combat === null || state.combat.budgets[id] === undefined) {
    return err('not_in_combat', 'there is no Reaction to spend outside combat');
  }
  const spent = spendReaction(state.combat, id, creature.conditions);
  if (!spent.ok) return spent;

  const events: GameEvent[] = [
    { type: 'reaction-spent', id },
    { type: 'readied-released', id, took: true, ...(stamp === null ? {} : { command: stamp }) },
  ];

  if (readied.response.kind === 'spell') {
    return releaseSpell(state, id, readied.response, command, supply, events);
  }
  if (readied.response.kind === 'move') {
    return releaseMove(state, id, command, supply, events);
  }

  return ok({ events, took: true });
}

/**
 * Move as the Reaction a Ready held back.
 *
 * SRD: "you choose to move up to your Speed in response to it." The Reaction
 * is what paid for this, so no Speed is spent — a turn budget belongs to a
 * turn and this is somebody else's, which is why `spendMovement` refuses it by
 * construction and is right to. The allowance is the mover's Speed **now**,
 * after whatever conditions have arrived since they readied: a creature
 * Grappled while waiting has a Speed of 0 and goes nowhere.
 *
 * Everything else is an ordinary move. It provokes, because it is the
 * creature's own movement and SRD offers the Opportunity Attack for leaving a
 * reach without caring what paid for the leaving.
 */
function releaseMove(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  if (command.placement === undefined) {
    return err('no_placement', `${id} readied a move; say where to`);
  }

  const combat = state.combat;
  const creature = creatureOf(state, id);
  if (combat === null || creature === null) {
    return err('not_in_combat', 'there is no Reaction to spend outside combat');
  }

  const declared = combat.order.find((c) => c.id === id)?.speed ?? creature.sheet.baseSpeed;
  const allowance = Math.max(0, conditionSpeed(creature.conditions, declared));

  const after = spentSoFar.reduce(applyEvent, state);
  const moved = moveWithin(
    after,
    id,
    {
      placement: command.placement,
      ...(command.difficultFeet === undefined ? {} : { difficultFeet: command.difficultFeet }),
    },
    supply,
    allowance,
  );
  if (!moved.ok) return moved;

  return ok({
    events: [...spentSoFar, ...moved.value.events],
    took: true,
    move: moved.value,
  });
}

/**
 * Let a held spell go, and resolve it where it lands.
 *
 * The slot went when it was readied, so nothing is paid here. What still has
 * to happen is the half `castSpell` would have done had the spell been cast
 * normally at this moment: the Concentration settles, and the spell's own
 * duration starts now rather than when the magic was first gathered.
 */
function releaseSpell(
  state: GameState,
  id: CharacterId,
  response: ReadiedResponse & { readonly kind: 'spell' },
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  const definition = definitionFor(response.spellId);
  if (definition === null) {
    return err('no_definition', `${response.spellId} has no executable definition`);
  }

  const events: GameEvent[] = [...spentSoFar];

  // The Concentration was holding the magic, not the spell. A spell whose own
  // Duration does not say Concentration has nothing left to concentrate on
  // once it has happened, so the hold ends — **before** the effects land, or
  // ending the casting would take the conditions the release just created.
  if (!definition.concentration) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: response.castingId,
      reason: 'released',
    });
  }

  const after = events.reduce(applyEvent, state);
  const resolved = castOrRelease(
    after,
    id,
    {
      spellId: response.spellId,
      targets: command.targets ?? [],
      ...(command.at === undefined ? {} : { at: command.at }),
      ...(definition.level === 0 ? {} : { slotLevel: response.castLevel }),
    },
    supply,
    { castingId: response.castingId },
  );
  // A refusal of any kind takes the whole batch with it: the Reaction is
  // still there and the spell is still held. That was already true of a rules
  // refusal; it is now true of a missing fact too, which used to come back as
  // a success and needed unpicking here.
  if (!resolved.ok) return resolved;

  events.push(...resolved.value.events);

  // SRD writes a readied spell's Duration from the moment it takes effect, and
  // that moment is now. `castSpell` would have scheduled this at the casting;
  // the casting was a turn ago and did nothing.
  if (definition.durationSeconds !== undefined) {
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'casting', castingId: response.castingId },
      { kind: 'seconds', seconds: definition.durationSeconds },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok({ events, took: true, spell: resolved.value });
}

// — movement ——————————————————————————————————————————————————————————————————

export interface MoveCommand extends CommandIdentity {
  /** Where to, relative to something already established. */
  readonly placement: Placement;
  /**
   * Movement somebody else is doing to you.
   *
   * SRD makes an Opportunity Attack available only when a creature leaves your
   * reach "using its action, its Bonus Action, its Reaction, or one of its
   * speeds". Being shoved by Thunderwave is none of those, and it is not the
   * creature's own movement either, so it costs no Speed and provokes nobody.
   */
  readonly forced?: boolean;
  /**
   * How many feet of this move are through Difficult Terrain.
   *
   * SRD: "every foot of movement in that space costs 1 extra foot", and
   * "Difficult Terrain isn't cumulative; either a space is Difficult Terrain or
   * it isn't" — which declaring *feet* rather than sources makes true for
   * free, since there is no way to say a space is difficult twice.
   *
   * Declared rather than deduced, on the same grounds as cover and line of
   * sight: five of the SRD's six environmental cases are fiction — snow,
   * rubble, furniture, a slope, a narrow opening — and working them out means
   * modelling the room. The seventh, another creature's space, the engine
   * *can* see, and `isDifficultTerrain` has answered it since positioning
   * landed, for a caller working out the number to declare.
   */
  readonly difficultFeet?: number;
}

export interface MoveResolution {
  readonly events: readonly GameEvent[];
  /** How far they went, on the same 5-foot lattice as everything else. */
  readonly feet: number;
  /** What it cost, which is the distance plus every difficult foot again. */
  readonly cost: number;
  /** Facts the engine could not check — see `AttackResolution.unverified`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/** The move waiting on the Opportunity Attacks it provoked, or null. */
export function pendingMoveOf(state: GameState): PendingMove | null {
  return state.pendingMove;
}

/**
 * Move, spending the Speed it costs and offering what it provokes.
 *
 * `moveCreature` and `spendMovement` have both existed since positioning and
 * combat landed, and nothing called either: a creature could cross a
 * battlefield without spending a foot, and nobody ever got an Opportunity
 * Attack, because no command sat between the two.
 *
 * SRD: "The attack occurs right before the creature leaves your reach." So a
 * move that provokes does not happen yet — it is declared, held, and completed
 * once every provoked creature has answered. Same shape as a held attack, and
 * for the same reason: the rule needs a moment between two things that would
 * otherwise happen at once.
 */
export function resolveMove(
  state: GameState,
  id: CharacterId,
  command: MoveCommand,
  supply: ConcentrationSaveSupply,
): Result<MoveResolution> {
  return moveWithin(state, id, command, supply, null);
}

/**
 * {@link resolveMove}, and the same thing paid for out of something else.
 *
 * `allowance` is null for an ordinary move, which draws on the turn budget,
 * and a number of feet for a move the turn budget knows nothing about — SRD
 * Ready's "move up to your Speed in response to it", taken on somebody else's
 * turn. One function rather than two because everything except where the feet
 * come from is identical, Opportunity Attacks included.
 */
function moveWithin(
  state: GameState,
  id: CharacterId,
  command: MoveCommand,
  supply: ConcentrationSaveSupply,
  allowance: number | null,
): Result<MoveResolution> {
  void supply;

  const identity = identify(state, `move:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], feet: 0, cost: 0, unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  if (state.pendingMove !== null) {
    return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
  }
  if (state.pendingAttack !== null) {
    return err('attack_pending', 'a hit is waiting for its damage; settle it first');
  }

  const mover = creatureOf(state, id);
  if (mover === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);
  if (state.scene === null) return needsContext('no_scene', 'there is no scene to move within');

  const from = positionOf(state.scene, id);
  if (from === null) {
    return needsContext('unplaced', `nobody has said where ${id} is standing, so there is nowhere to move from`);
  }

  // Resolve the destination through the same placement rules everything else
  // uses, so the move is measured on the lattice rather than in a straight line.
  const moved = moveCreature(state.scene, id, command.placement);
  if (!moved.ok) return moved;
  const to = positionOf(moved.value.state, id);
  if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);

  // The distance positioning itself measured, on the lattice, between volumes.
  const feet = moved.value.distance;

  // SRD: "every foot of movement in that space costs 1 extra foot."
  const difficult = command.difficultFeet ?? 0;
  if (!Number.isInteger(difficult) || difficult < 0 || difficult > feet) {
    return err(
      'bad_difficult_terrain',
      `a ${feet}-foot move cannot pass through ${difficult} feet of Difficult Terrain`,
    );
  }
  const cost = feet + difficult;

  // — what it costs ——————————————————————————————————————————————————————
  //
  // Forced movement is not the creature's own, so it spends none of their
  // Speed. Outside combat there is no budget to spend at all.
  const events: GameEvent[] = [];
  if (allowance !== null) {
    // A readied move: the Reaction paid for it, so no Speed is spent and
    // nothing is recorded against a budget this move does not belong to.
    if (cost > allowance) {
      return err(
        'not_enough_movement',
        `${id} may move up to ${allowance} feet in response, and that move costs ${cost}`,
      );
    }
  } else if (
    state.combat !== null &&
    state.combat.budgets[id] !== undefined &&
    command.forced !== true
  ) {
    const spent = spendMovement(state.combat, id, cost, mover.conditions);
    if (!spent.ok) {
      return spent.code === 'not_enough_movement' || spent.code === 'no_movement'
        ? spent
        : err('not_enough_movement', spent.reason);
    }
    events.push({ type: 'movement-spent', id, feet: cost });
  }

  // — what it provokes ———————————————————————————————————————————————————
  // SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
  // rest of the current turn." Forced movement provokes nothing either, for a
  // different reason — it is not the creature's movement at all.
  // SRD Disengage: "for the rest of the current turn." A readied move is taken
  // on a later turn, so a Disengage taken on the mover's own turn does not
  // reach it — and it could not have been taken on the same turn anyway, since
  // Disengage and Ready are both the action.
  const disengaged = allowance === null && state.combat?.budgets[id]?.disengaged === true;
  const opportunity =
    command.forced === true || disengaged
      ? { provoked: [], unverified: [] }
      : provokedBy(state, id, from, to);

  if (opportunity.provoked.length === 0) {
    events.push({
      type: 'creature-moved',
      id,
      placement: command.placement,
      ...(command.forced === true ? { forced: true } : {}),
    });
    return ok({ events, feet, cost, unverified: opportunity.unverified, duplicate: false });
  }

  events.push({
    type: 'movement-declared',
    move: {
      mover: id,
      placement: command.placement,
      destination: to,
      feet,
      provoked: opportunity.provoked,
    },
    ...(stamp === null ? {} : { command: stamp }),
  });

  return ok({ events, feet, cost, unverified: opportunity.unverified, duplicate: false });
}

/**
 * Who may attack this creature for leaving, and what the engine could not check.
 *
 * SRD: "You can make an Opportunity Attack when a creature that you can see
 * leaves your reach." Four clauses, each of which is a way to get this wrong:
 *
 * - **leaves** your reach — within it at the start and outside it at the end.
 *   Circling an ogre at five feet provokes nothing.
 * - **your reach** — the reactor's, which a Reach weapon extends to ten.
 * - **that you can see** — declared, and three-valued. A creature nobody has
 *   said about is not thereby blind, so the offer is made and the fact
 *   reported rather than the rule being silently dropped.
 * - and they must have a Reaction to take, which an Incapacitated creature
 *   does not.
 */
function provokedBy(
  state: GameState,
  mover: CharacterId,
  from: Point,
  to: Point,
): {
  readonly provoked: readonly { readonly reactor: CharacterId; readonly reach: number }[];
  readonly unverified: readonly string[];
} {
  const scene = state.scene;
  const side = state.creatures[mover]?.side ?? null;
  if (scene === null) return { provoked: [], unverified: [] };

  const provoked: { reactor: CharacterId; reach: number }[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === mover) continue;

    // An ally does not swing at you for walking away — the same conservative
    // reading an aura takes of "your allies". Declared and allied is settled;
    // an *undeclared* side is checked below, after the geometry, so that the
    // report only appears where it would actually have mattered.
    const allied = other.side !== null && side !== null && other.side === side;
    if (allied) continue;
    if (other.vitals.dead || isIncapacitated(other.conditions)) continue;
    if (state.combat !== null && state.combat.budgets[other.id]?.reaction === false) continue;

    const reach = reachOf(other);
    const before = distanceToPoint(scene, other.id, from);
    const after = distanceToPoint(scene, other.id, to);
    if (!before.ok || !after.ok) continue;
    if (!(before.value <= reach && after.value > reach)) continue;

    // Everything else about this creature says they would swing. If nobody
    // has said whose side they are on, the offer is withheld — and that is a
    // whole Reaction the table was never told about, so it is reported rather
    // than passing as a rule that checked and found nothing.
    if (other.side === null || side === null) {
      unverified.push(
        `nobody has said whose side ${other.side === null ? other.id : mover} is on, so ${other.id} was not offered an Opportunity Attack on ${mover}`,
      );
      continue;
    }

    // SRD: "a creature that you can see". Declared unseen is a refusal;
    // undeclared is a fact nobody has established, and withholding the
    // Reaction on that basis would be the engine deciding it.
    const seen = sightBetween(scene, other.id, mover);
    if (seen === false) continue;
    if (seen === null) {
      unverified.push(
        `nobody has said whether ${other.id} can see ${mover}, and an Opportunity Attack needs that; the offer was made rather than withheld`,
      );
    }

    provoked.push({ reactor: other.id, reach });
  }

  return { provoked, unverified };
}

/** The melee reach of whatever this creature is actually holding. */
function reachOf(creature: CreatureState): number {
  let reach = 5;
  for (const itemId of creature.equipped) {
    const weapon = itemFor(itemId)?.weapon;
    if (weapon === undefined || weapon === null || weapon.kind !== 'melee') continue;
    reach = Math.max(reach, meleeReach(weapon));
  }
  return reach;
}

export interface OpportunityCommand extends CommandIdentity {
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon?: string | null;
}

/**
 * Take the Opportunity Attack a move offered.
 *
 * The mover is still standing where they were, so this is an ordinary attack
 * against an ordinary distance — which is the whole reason the move was held.
 * Spending the Reaction and completing the move when the last answer comes in
 * are both this command's, because the reducer cannot emit events.
 */
export function takeOpportunityAttack(
  state: GameState,
  reactor: CharacterId,
  command: OpportunityCommand,
  supply: ConcentrationSaveSupply,
): Result<AttackResolution> {
  const waiting = state.pendingMove;
  if (waiting === null || !waiting.provoked.some((p) => p.reactor === reactor)) {
    return err('not_provoked', `${reactor} was not offered an Opportunity Attack`);
  }

  const events: GameEvent[] = [];
  if (state.combat !== null && state.combat.budgets[reactor] !== undefined) {
    const creature = creatureOf(state, reactor);
    const spent = spendReaction(state.combat, reactor, creature?.conditions);
    if (!spent.ok) return spent;
    events.push({ type: 'reaction-spent', id: reactor });
  }

  // The attack itself goes through the ordinary command, so every derivation
  // it makes — cover, conditions, proficiency, the target's defences — applies
  // here too rather than being reimplemented for this one case.
  const after = events.reduce(applyEvent, state);
  const swing = resolveAttack(
    after,
    reactor,
    {
      target: waiting.mover,
      weapon: command.weapon ?? null,
      // The Reaction above is what this costs; it is not the Attack action.
      free: true,
      ...(command.commandId === undefined ? {} : { commandId: command.commandId }),
    },
    supply,
  );
  if (!swing.ok) return swing;

  const answered: GameEvent[] = [
    ...events,
    ...swing.value.events,
    { type: 'opportunity-answered', reactor, took: true },
  ];

  return ok({
    ...swing.value,
    events: [...answered, ...completeIfSettled(state, answered)],
  });
}

/** Pass on an Opportunity Attack that was offered. */
export function declineOpportunity(
  state: GameState,
  reactor: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  // The retry used to come back `not_provoked`, which reads as "you were never
  // offered that" — and a decline that lands twice would complete the move
  // twice. Both are fixed by the same stamp.
  const identity = identify(state, `decline:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const waiting = state.pendingMove;
  if (waiting === null || !waiting.provoked.some((p) => p.reactor === reactor)) {
    return err('not_provoked', `${reactor} was not offered an Opportunity Attack`);
  }

  const answered: GameEvent[] = [
    {
      type: 'opportunity-answered',
      reactor,
      took: false,
      ...(stamp === null ? {} : { command: stamp }),
    },
  ];
  return ok([...answered, ...completeIfSettled(state, answered)]);
}

/**
 * The move itself, once nobody is left to answer.
 *
 * Emitted by whichever command settles the last Reaction, because a reducer
 * cannot emit events and a move that completed itself silently would be a
 * change nothing in the log accounted for.
 */
function completeIfSettled(state: GameState, answered: readonly GameEvent[]): readonly GameEvent[] {
  const after = answered.reduce(applyEvent, state);
  const waiting = after.pendingMove;
  if (waiting === null || waiting.provoked.length > 0) return [];

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

  return [
    { type: 'movement-completed', id: waiting.mover },
    {
      type: 'creature-moved',
      id: waiting.mover,
      placement: resolvable
        ? waiting.placement
        : { ...waiting.placement, from: { point: waiting.destination }, bearing: 0, feet: 0 },
    },
  ];
}

// — weapon attacks ————————————————————————————————————————————————————————————

export interface AttackCommand extends CommandIdentity {
  readonly target: CharacterId;
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon: string | null;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /** Which ability to use on a Finesse weapon. Defaults to the better one. */
  readonly finesseAbility?: 'str' | 'dex';
  /** Advantage or disadvantage from the fiction, which the engine cannot see. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Modifiers the caller knows about: Archery, a magic weapon's plus. */
  readonly attackBonuses?: readonly Bonus[];
  readonly damageBonuses?: readonly Bonus[];
  /** Damage of other types: a Divine Smite's radiant, a Flame Tongue's fire. */
  readonly extraDamage?: readonly ExtraDamage[];
  /**
   * Roll the attack and stop, leaving the damage to a second command.
   *
   * SRD 2024 Divine Smite: "Bonus Action, which you take immediately after
   * hitting a target with a Melee weapon or an Unarmed Strike." There is no
   * such moment in an attack that rolls its damage in the same breath, so a
   * caller who might want one asks for it before swinging. Asking costs
   * nothing and decides nothing: the slot is spent only by going through with
   * it, and only on a hit.
   */
  readonly hold?: boolean;
  /**
   * This swing is not the Attack action, so it costs nothing here.
   *
   * SRD Opportunity Attack: "take a Reaction to make one melee attack" — the
   * Reaction is the cost, and the caller has already paid it. Extra Attack
   * will want the same field for the same reason: the economy counts the
   * Attack action, not the attacks inside it.
   */
  readonly free?: boolean;
}

export interface AttackResolution {
  readonly events: readonly GameEvent[];
  /**
   * Facts the engine could not check, rather than checked and found false.
   *
   * The same channel `resolveSpell` uses, and for the same reason: an unplaced
   * creature is one nobody has said the position of, not one standing
   * nowhere. A rule that needs a distance gets none rather than a guess, and
   * the layer narrating the attack is told which rule went unapplied.
   */
  readonly unverified: readonly string[];
  /** The roll, or null when this command id had already landed. */
  readonly attack: AttackResult | null;
  /** Damage that actually landed, after the target's defences. Absent on a miss. */
  readonly damage?: number;
  /** What the damage did to the target's Concentration, if they had any. */
  readonly concentration?: ConcentrationConsequence;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * Swing at somebody, and let the engine work out the numbers.
 *
 * `rollAttack` is pure and always has been: hand it a sheet, a target Armour
 * Class, some modes and some bonuses, and it rolls correctly. What it cannot
 * do is *find* any of those, so every one of them was the caller's to supply —
 * which meant nothing in the engine ever checked them, and a fixture could
 * quietly swing a longsword at somebody fifty feet away.
 *
 * Everything derivable is derived here:
 *
 * | | From |
 * |---|---|
 * | Target Armour Class | the target's own sheet, plus declared cover |
 * | Reach and range | the weapon's properties and the distance between volumes |
 * | An enemy hampering a bow | who is within 5 feet and on another side |
 * | Advantage and disadvantage | both creatures' conditions, after features have suppressed any |
 * | Proficiency | the weapon's category against the sheet's |
 * | Defences | the target's own, and the ones its features grant |
 *
 * What the caller still says is what the engine cannot see: advantage from the
 * fiction, a magic weapon's plus, a Smite's extra dice.
 */
export function resolveAttack(
  state: GameState,
  id: CharacterId,
  command: AttackCommand,
  supply: ConcentrationSaveSupply,
): Result<AttackResolution> {
  const identity = identify(state, `attack:${id}`, command);
  if (!identity.ok) return identity;
  // A retry is a no-op rather than a refusal, and says so rather than looking
  // like a miss: the same contract `resolveDamage` keeps, for the same reason.
  if (identity.value.duplicate) {
    return ok({ events: [], attack: null, unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  if (state.pendingAttack !== null) {
    return err(
      'attack_pending',
      `${state.pendingAttack.attacker} has a hit whose damage is still unrolled; settle it first`,
    );
  }

  const attacker = creatureOf(state, id);
  if (attacker === null) return needsContext('unknown_creature', `${id} has no record here yet; add it first`);
  // Not a claim that no such creature exists. A DM who has just narrated a
  // second ogre out of the treeline has a real ogre; the engine has simply not
  // been told about it, and being told is all this refusal asks for.
  const victim = creatureOf(state, command.target);
  if (victim === null) {
    return needsContext('unknown_creature', `${command.target} has no record here yet; add it first`);
  }
  if (attacker.vitals.dead) return err('dead', `${id} is dead and swings at nothing`);

  // — the weapon —————————————————————————————————————————————————————————
  let weapon: Weapon | null = null;
  if (command.weapon !== null) {
    const item = itemFor(command.weapon);
    if (item?.weapon === undefined || item.weapon === null) {
      return err('unknown_item', `${command.weapon} is not a weapon the SRD lists`);
    }
    // Owning is not wielding, but you cannot wield what you do not own.
    if (quantityOf(state, id, command.weapon) < 1) {
      return err('not_owned', `${id} does not have a ${item.weapon.name}`);
    }
    weapon = item.weapon;
  }

  // — can it even reach ——————————————————————————————————————————————————
  const reach = reachCheck(state, id, command.target, weapon, command.thrown === true);
  if (!reach.ok) return reach;

  // SRD Total Cover: the target "can't be targeted directly".
  const cover = state.scene === null ? 'none' : coverBetween(state.scene, id, command.target);
  if (!canBeTargeted(cover)) {
    return err('total_cover', `${command.target} is behind Total Cover`);
  }

  // — the action it costs —————————————————————————————————————————————————
  //
  // SRD: an attack with a weapon is the Attack action. Outside combat there is
  // no economy to spend, exactly as `resolveCast` finds.
  const events: GameEvent[] = [];
  if (command.free !== true && state.combat !== null && state.combat.budgets[id] !== undefined) {
    // SRD Extra Attack: the action is taken once and holds however many
    // attacks a feature puts in it, so only the first swing costs one.
    const spent = spendAttack(
      state.combat,
      id,
      attacker.sheet.attacksPerAction ?? 1,
      attacker.conditions,
    );
    if (!spent.ok) return spent;
    events.push({ type: 'attack-made', id });
  }

  // — the roll ———————————————————————————————————————————————————————————
  const issuedBefore = supply.issuer.count;

  // Absent, not false: see `TargetContext.withinFiveFeet`.
  const withinFiveFeet = reach.value.apart === null ? undefined : reach.value.apart <= 5;
  const unverified: string[] = [];
  if (reach.value.apart === null) {
    unverified.push(
      `nobody has said where ${id} and ${command.target} are standing, so any rule that reads the distance between them — Prone, an automatic critical, an enemy within 5 feet — went unapplied rather than checked`,
    );
  }

  // SRD: a ranged attack has Disadvantage while an enemy is within 5 feet.
  const nearby = enemyWithinFiveFeet(state, id);
  unverified.push(...nearby.unverified);

  // SRD Dodge and anything else that makes attacks against the target harder.
  // The sight clause is the *target's* view of the attacker, and undeclared is
  // not the same as blind.
  const defending = attackedWithDisadvantage(
    state,
    command.target,
    state.scene === null ? null : sightBetween(state.scene, command.target, id),
  );
  unverified.push(...defending.unverified);

  const attack = rollAttack(supply.issuer, supply.rng, attacker.sheet, {
    weapon,
    targetAc: armorClass(victim.sheet) + coverAcBonus(cover),
    proficient: proficientWith(attacker.sheet, weapon),
    ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
    ...(command.thrown === undefined ? {} : { thrown: command.thrown }),
    ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
    modes: [...defending.modes, ...(command.modes ?? [])],
    beyondNormalRange: reach.value.beyondNormal,
    nearbyEnemy: nearby.near,
    attackBonuses: [
      // Bless is on the creature, not in the caller's head.
      ...bonusesFor(attacker.bonuses, 'attack'),
      ...(command.attackBonuses ?? []),
    ],
    ...(command.damageBonuses === undefined ? {} : { damageBonuses: command.damageBonuses }),
    ...(command.extraDamage === undefined ? {} : { extraDamage: command.extraDamage }),
    // What actually bites: a condition a feature has suppressed gives nobody
    // anything. See `effectiveConditions`.
    attackerConditions: effectiveConditions(state, id),
    targetConditions: effectiveConditions(state, command.target),
    ...(withinFiveFeet === undefined ? {} : { withinFiveFeet }),
  });
  if (!attack.ok) return attack;

  events.push({
    type: 'roll-recorded',
    who: id,
    label: `${weapon?.name ?? 'Unarmed Strike'} attack`,
    natural: attack.value.roll.natural,
    total: attack.value.total,
    contributions: [{ source: 'attack', amount: attack.value.roll.modifier }],
    outcome: attack.value.hit ? 'hit' : 'miss',
    // Stamped on the roll rather than on the damage, because a miss deals none
    // and a missed swing must not be retryable.
    ...(stamp === null ? {} : { command: stamp }),
  });

  if (!attack.value.hit) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
    return ok({ events, attack: attack.value, unverified, duplicate: false });
  }

  // SRD Divine Smite is taken "immediately after hitting a target", which is
  // exactly here: the hit is known, the damage is not rolled. The roll that
  // got us here is already in the log, so the debt survives a reload.
  if (command.hold === true) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
    events.push({
      type: 'attack-landed',
      attack: {
        attacker: id,
        target: command.target,
        weapon: command.weapon,
        twoHanded: command.twoHanded === true,
        thrown: command.thrown === true,
        ...(command.finesseAbility === undefined
          ? {}
          : { finesseAbility: command.finesseAbility }),
        critical: attack.value.critical,
        ability: attack.value.ability,
        targetAc: attack.value.targetAc,
      },
    });
    return ok({ events, attack: attack.value, unverified, duplicate: false });
  }

  // — the damage —————————————————————————————————————————————————————————
  //
  // Everything that adds to this attack, gathered in one place: the features
  // that qualify, and whatever the caller knows about that the engine does
  // not — a magic weapon's own damage comes in that way until magic items are
  // parsed. A *bonus* is of the weapon's own type and rides with it through
  // Resistance; *extra* damage of another type does not.
  const fromFeatures = standingAttackDamage(state, id, {
    ability: attack.value.ability,
    melee: rangeOf(weapon, command.thrown === true) === null,
  });

  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    attacker.sheet,
    {
      weapon,
      targetAc: attack.value.targetAc,
      ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
      ...(command.thrown === undefined ? {} : { thrown: command.thrown }),
      ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
      damageBonuses: [...fromFeatures.bonuses, ...(command.damageBonuses ?? [])],
      extraDamage: [...fromFeatures.extra, ...(command.extraDamage ?? [])],
    },
    attack.value.critical,
  );
  if (!rolled.ok) return rolled;

  events.push({
    type: 'rolls-issued',
    count: supply.issuer.count - issuedBefore,
    rng: supply.rng.snapshot(),
  });

  const after = events.reduce(applyEvent, state);
  const hurt = dealSpellDamage(
    after,
    command.target,
    rolled.value.components,
    weapon?.name ?? 'Unarmed Strike',
    supply,
    attack.value.critical ? { critical: true } : {},
  );
  if (!hurt.ok) return hurt;

  return ok({
    events: [...events, ...hurt.value.events],
    attack: attack.value,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    unverified,
    duplicate: false,
  });
}

/**
 * How far apart two creatures are, or null where nobody has said.
 *
 * Null is a real answer rather than a failure: positions are declared, so an
 * unplaced creature is one nobody has placed, not one standing nowhere. Every
 * rule that reads a distance has to decide what to do with the third case, and
 * none of them may decide it by assuming.
 */
function apartFrom(state: GameState, a: CharacterId, b: CharacterId): number | null {
  if (state.scene === null) return null;
  const measured = distanceBetween(state.scene, a, b);
  return measured.ok ? measured.value : null;
}

/**
 * Whether the attack can reach at all, and whether it is a long shot.
 *
 * SRD melee is 5 feet, or 10 with a Reach weapon. A ranged attack has
 * Disadvantage "beyond normal range" and is not a legal attack beyond long
 * range. An unplaced creature has no distance to anything, and that is not an
 * error here: it is the same "nobody has said" the rest of positioning treats
 * as a real state, so the attack proceeds unhampered rather than being refused
 * on a fact nobody established.
 */
function reachCheck(
  state: GameState,
  id: CharacterId,
  target: CharacterId,
  weapon: Weapon | null,
  thrown: boolean,
): Result<{ readonly apart: number | null; readonly beyondNormal: boolean }> {
  // **No scene at all is not a gap in the record; it is a table not using
  // positioning.** An ambush in a corridor nobody drew, a brawl in a room with
  // no grid — most SRD play looks like this, and demanding a map before anyone
  // may swing a sword is exactly the obstructive behaviour this engine exists
  // not to have. So the reach check has nothing to check, the attack proceeds,
  // and `resolveAttack` reports which rules went unapplied.
  if (state.scene === null) return ok({ apart: null, beyondNormal: false });

  const measured = distanceBetween(state.scene, id, target);
  if (!measured.ok) {
    // A scene *does* exist and somebody is not on it. That is a gap in a
    // record the table is actively keeping, and whether a weapon reaches is a
    // precondition of the attack rather than a modifier on it — the same
    // question `resolveSpell` has always asked about a spell's range, which
    // until now it answered one way for a Fire Bolt and another for a sword.
    const scene = state.scene;
    const off = [id, target].filter((who) => positionOf(scene, who) === null);
    return needsContext(
      'unplaced',
      `nobody has said where ${off.join(' or ')} ${off.length === 1 ? 'is' : 'are'} standing, and whether ${weapon?.name ?? 'an Unarmed Strike'} reaches depends on it`,
      off.map((who) => ({
        kind: 'position' as const,
        subject: who,
        need: `where ${who} is standing`,
        because: `${weapon?.name ?? 'an Unarmed Strike'} has a reach to check`,
        satisfyWith: `a creature-placed event for ${who}`,
      })),
    );
  }
  const apart = measured.value;

  const range = rangeOf(weapon, thrown);
  if (range === null) {
    const reach = meleeReach(weapon);
    if (apart > reach) {
      return err(
        'out_of_reach',
        `${weapon?.name ?? 'an Unarmed Strike'} reaches ${reach} feet; ${target} is ${apart} away`,
      );
    }
    return ok({ apart, beyondNormal: false });
  }

  if (apart > range.long) {
    return err('out_of_range', `${weapon?.name ?? 'this attack'} carries ${range.long} feet; ${target} is ${apart} away`);
  }
  return ok({ apart, beyondNormal: apart > range.normal });
}

/**
 * SRD: a ranged attack has Disadvantage while an enemy is within 5 feet of you.
 *
 * "Enemy" is the declared side, the same fact an aura reads for "ally". A
 * creature nobody has placed on a side is nobody's enemy either, so it hampers
 * nothing — the conservative direction, and the same one `standingFor` takes.
 */
function enemyWithinFiveFeet(
  state: GameState,
  id: CharacterId,
): { readonly near: boolean; readonly unverified: readonly string[] } {
  const scene = state.scene;
  const mine = state.creatures[id]?.side ?? null;
  if (scene === null) return { near: false, unverified: [] };

  let near = false;
  const unsided: CharacterId[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === id) continue;
    // SRD says an enemy "that can see you and isn't Incapacitated"; sight is
    // declared and often unsaid, so only the half the engine can see is applied
    // and the other half is left to the caller's modes.
    if (isIncapacitated(other.conditions) || other.vitals.dead) continue;

    const apart = distanceBetween(scene, id, other.id);
    if (!apart.ok || apart.value > 5) continue;

    // Declared and allied: the rule does not apply, and nothing is missing.
    if (mine !== null && other.side === mine) continue;
    // Declared and opposed: the rule applies.
    if (mine !== null && other.side !== null) {
      near = true;
      continue;
    }
    // Nobody has said. Withholding is the conservative direction and it was
    // also **silent** — a creature standing at the archer's elbow either is or
    // is not an enemy, and an unfired rule looks exactly like a rule that
    // checked and found nothing.
    unsided.push(other.id);
  }

  return {
    near,
    unverified:
      unsided.length === 0
        ? []
        : [
            `nobody has said whose side ${unsided.join(', ')} ${unsided.length === 1 ? 'is' : 'are'} on, so the Disadvantage a ranged attack takes with an enemy within 5 feet was not applied`,
          ],
  };
}

/** The hit whose damage is still to be rolled, or null. */
export function pendingAttackOf(state: GameState): PendingAttack | null {
  return state.pendingAttack;
}

export interface AttackDamageCommand extends CommandIdentity {
  /**
   * A spell cast on the hit, out of the SRD's own "immediately after hitting"
   * window. Validated and paid for as a casting, because it is one.
   */
  readonly smite?: { readonly spellId: string; readonly slotLevel: number };
  readonly damageBonuses?: readonly Bonus[];
  readonly extraDamage?: readonly ExtraDamage[];
}

/**
 * Roll the damage of an attack that was held, and settle the debt.
 *
 * Everything the roll needs was written down when the attack landed, so
 * nothing has to be remembered between the two calls — which is what makes
 * this survive a reload rather than living in the caller's hands.
 */
export function resolveAttackDamage(
  state: GameState,
  id: CharacterId,
  command: AttackDamageCommand,
  supply: ConcentrationSaveSupply,
): Result<AttackResolution> {
  const identity = identify(state, `attack-damage:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], attack: null, unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  const pending = state.pendingAttack;
  if (pending === null || pending.attacker !== id) {
    return err('no_pending_attack', `${id} has no hit waiting for its damage`);
  }

  const attacker = creatureOf(state, id);
  if (attacker === null) return needsContext('unknown_creature', `${id} is not in this game`);

  const weapon = pending.weapon === null ? null : (itemFor(pending.weapon)?.weapon ?? null);
  const events: GameEvent[] = [];
  const extra: ExtraDamage[] = [...(command.extraDamage ?? [])];

  // — the spell cast on the blow ——————————————————————————————————————————
  if (command.smite !== undefined) {
    const smite = castOnHit(state, id, attacker, command.smite);
    if (!smite.ok) return smite;
    events.push(...smite.value.events);
    extra.push(smite.value.damage);
  }

  const current = events.reduce(applyEvent, state);
  const fromFeatures = standingAttackDamage(current, id, {
    ability: pending.ability,
    melee: rangeOf(weapon, pending.thrown) === null,
  });

  const issuedBefore = supply.issuer.count;
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    attacker.sheet,
    {
      weapon,
      targetAc: pending.targetAc,
      twoHanded: pending.twoHanded,
      thrown: pending.thrown,
      ...(pending.finesseAbility === undefined
        ? {}
        : { finesseAbility: pending.finesseAbility }),
      damageBonuses: [...fromFeatures.bonuses, ...(command.damageBonuses ?? [])],
      extraDamage: [...fromFeatures.extra, ...extra],
    },
    pending.critical,
  );
  if (!rolled.ok) return rolled;

  events.push(
    {
      type: 'attack-damage-dealt',
      attacker: id,
      ...(stamp === null ? {} : { command: stamp }),
    },
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  );

  const after = events.reduce(applyEvent, state);
  const hurt = dealSpellDamage(
    after,
    pending.target,
    rolled.value.components,
    weapon?.name ?? 'Unarmed Strike',
    supply,
    pending.critical ? { critical: true } : {},
  );
  if (!hurt.ok) return hurt;

  return ok({
    events: [...events, ...hurt.value.events],
    attack: null,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    unverified: [],
    duplicate: false,
  });
}

/**
 * A spell cast in the window a hit opens, and what it adds to the blow.
 *
 * SRD Divine Smite is a level 1 Evocation spell with a Bonus Action casting
 * time, so it goes through the casting rules like any other: the caster must
 * have it, the slot is spent, the Bonus Action is spent, and the
 * one-slot-per-turn rule applies. "The target takes an extra 2d8 Radiant
 * damage **from the attack**" — from the attack, so a critical doubles it,
 * which is why it joins the attack's own damage rather than being dealt
 * separately.
 */
function castOnHit(
  state: GameState,
  id: CharacterId,
  attacker: CreatureState,
  smite: { readonly spellId: string; readonly slotLevel: number },
): Result<{ readonly events: readonly GameEvent[]; readonly damage: ExtraDamage }> {
  const definition = definitionFor(smite.spellId);
  if (definition === null) {
    return err('no_definition', `${smite.spellId} has no executable definition`);
  }

  const effect = definition.effects.find((e) => e.kind === 'attack-damage');
  if (effect === undefined || effect.kind !== 'attack-damage') {
    return err(
      'not_cast_on_a_hit',
      `${definition.name} is not a spell cast on an attack that hits`,
    );
  }

  // The route decides nothing here — Divine Smite rolls no save and makes no
  // attack — but casting a spell the caster does not have is still a refusal.
  const route = chooseRoute(attacker.spellcasting, smite.spellId, undefined);
  if (!route.ok) return route;

  const cast = resolveCast(state, id, {
    spell: definition.name,
    level: definition.level,
    concentration: definition.concentration,
    castingTime: definition.castingTime,
    slotLevel: smite.slotLevel,
    route: route.value.kind === 'granted' ? route.value.grant.source : `class:${route.value.classId}`,
  });
  if (!cast.ok) return cast;

  return ok({
    events: cast.value,
    damage: {
      source: definition.name,
      type: effect.damageType,
      dice: scaledDiceFor(effect.damage, definition.level, attacker.sheet.level, smite.slotLevel),
    },
  });
}

// — features a creature switches on ———————————————————————————————————————————

export interface ActivateFeatureCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Turn a feature on, paying everything it costs.
 *
 * SRD Rage is the shape this is built to: "You can enter it as a Bonus Action
 * if you aren't wearing Heavy armor... You can enter your Rage the number of
 * times shown for your Barbarian level." A prerequisite, an action, a pool,
 * and a deadline — and nothing is spent until all of them pass, which is the
 * same validate-before-rolling discipline casting obeys.
 *
 * The benefits are not here and should not be: they are standing effects that
 * require the feature to be active, so turning it on grants nothing directly
 * and turning it off takes nothing away directly. Neither can go stale.
 */
export function activateFeature(
  state: GameState,
  id: CharacterId,
  command: ActivateFeatureCommand,
): Result<GameEvent[]> {
  const identity = identify(state, `activate:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

  const definition = (creature.sheet.activated ?? []).find((a) => a.feature === command.feature);
  if (definition === undefined) {
    return err('no_such_feature', `${id} has no feature called ${command.feature}`);
  }

  if (creature.activeFeatures.includes(command.feature)) {
    return err('already_active', `${id} is already in ${definition.name}`);
  }

  // SRD Rage: "if you aren't wearing Heavy armor". The same clause that ends
  // it is the one that stops it starting, so it is read from one list.
  for (const requirement of definition.endsOn ?? []) {
    if (requirement === 'incapacitated' && isIncapacitated(creature.conditions)) {
      return err('incapacitated', `${id} is Incapacitated and cannot enter ${definition.name}`);
    }
    if (requirement === 'heavy-armor' && wearsHeavyArmor(creature)) {
      return err('heavy_armor', `${definition.name} cannot be entered in Heavy armour`);
    }
  }

  if (definition.pool !== null && remaining(creature.resources, definition.pool) < 1) {
    return err('exhausted', `${id} has no uses of ${definition.name} left`);
  }

  const events: GameEvent[] = [];

  // The action economy only exists in combat; outside it there is nothing to
  // spend, exactly as `resolveCast` finds.
  if (state.combat !== null && definition.action !== 'none') {
    const spent = spendFor(state, id, definition.action);
    if (!spent.ok) return spent;
    events.push(spent.value);
  }

  if (definition.pool !== null) {
    events.push({ type: 'resource-spent', id, key: definition.pool, amount: 1 });
  }

  events.push({
    type: 'feature-activated',
    id,
    feature: command.feature,
    ...(stamp === null ? {} : { command: stamp }),
  });

  const timer = featureTimer(state, id, definition);
  if (!timer.ok) return timer;
  if (timer.value !== null) events.push(timer.value);

  return ok(events);
}

export interface EndFeatureCommand extends CommandIdentity {
  readonly feature: string;
}

/** Switch a feature off deliberately. Costs nothing and refunds nothing. */
export function endFeature(
  state: GameState,
  id: CharacterId,
  command: EndFeatureCommand,
): Result<GameEvent[]> {
  const identity = identify(state, `end-feature:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
  if (!creature.activeFeatures.includes(command.feature)) {
    return err('not_active', `${id} is not in ${command.feature}`);
  }

  return ok([
    {
      type: 'feature-ended',
      id,
      feature: command.feature,
      reason: 'dismissed',
      ...(stamp === null ? {} : { command: stamp }),
    },
  ]);
}

export interface ExtendFeatureCommand extends CommandIdentity {
  readonly feature: string;
  /**
   * Which of the SRD's ways of extending it happened.
   *
   * SRD Rage offers three: "Make an attack roll against an enemy. Force an
   * enemy to make a saving throw. Take a Bonus Action to extend your Rage."
   * Only the third costs anything, so which one it was changes what is spent —
   * and the engine cannot see the first two for itself, because nothing routes
   * a weapon attack through a command yet. The caller says which, and the log
   * records it.
   */
  readonly by: 'attack' | 'forced-save' | 'bonus-action';
}

/**
 * Push a running feature's deadline out by another round.
 *
 * The timer is *replaced* rather than added to. Timers are keyed by what they
 * end, so re-scheduling overwrites — which is what stops a stale deadline
 * ending a Rage that has already been extended past it.
 */
export function extendFeature(
  state: GameState,
  id: CharacterId,
  command: ExtendFeatureCommand,
): Result<GameEvent[]> {
  const identity = identify(state, `extend:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
  if (!creature.activeFeatures.includes(command.feature)) {
    return err('not_active', `${id} is not in ${command.feature}`);
  }

  const definition = (creature.sheet.activated ?? []).find((a) => a.feature === command.feature);
  if (definition === undefined) {
    return err('no_such_feature', `${id} has no feature called ${command.feature}`);
  }

  const events: GameEvent[] = [];
  if (command.by === 'bonus-action' && state.combat !== null) {
    const spent = spendFor(state, id, 'bonus-action');
    if (!spent.ok) return spent;
    events.push(spent.value);
  }

  const timer = featureTimer(state, id, definition);
  if (!timer.ok) return timer;
  // Outside combat there is no timer and no Bonus Action, so the batch is
  // empty — and an empty batch is idempotent without needing a stamp at all.
  if (timer.value !== null) {
    events.push(
      stamp === null ? timer.value : ({ ...timer.value, command: stamp } as GameEvent),
    );
  }

  return ok(events);
}

/** The deadline one activation runs to. */
function featureTimer(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
): Result<GameEvent | null> {
  // Outside combat there are no turns, so a turn-anchored deadline has no
  // meaning — `resolveDuration` refuses it rather than inventing seconds, and
  // the feature simply runs until something ends it.
  if (state.combat === null) return ok(null);

  const timer = schedule(
    state,
    { kind: 'feature', on: id, feature: definition.feature },
    definition.lasts === 'start-of-next-turn' ? startOfNextTurn(id) : endOfNextTurn(id),
  );
  if (!timer.ok) return timer;
  return ok(timer.value);
}

/**
 * Spend the action a feature costs, whichever kind it is.
 *
 * The same two functions `resolveCast` uses, because they are the ones that
 * know the Incapacitated rule: SRD says a creature with that condition "can't
 * take any action, Bonus Action, or Reaction", and that check belongs in one
 * place rather than in every caller that spends one.
 */
function spendFor(
  state: GameState,
  id: CharacterId,
  action: 'action' | 'bonus-action',
): Result<GameEvent> {
  const combat = state.combat;
  if (combat === null) {
    return err('not_in_combat', 'there is no action economy outside combat');
  }
  const conditions = creatureOf(state, id)?.conditions;

  const spent =
    action === 'bonus-action'
      ? spendBonusAction(combat, id, conditions)
      : spendAction(combat, id, conditions);
  if (!spent.ok) return spent;

  return ok(
    action === 'bonus-action'
      ? { type: 'bonus-action-spent', id }
      : { type: 'action-spent', id },
  );
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
  /**
   * Which pool the slot comes out of, for a character who has both.
   *
   * SRD lets Pact Magic slots cast Spellcasting spells and vice versa, so this
   * is about the purse rather than the spell. Omitted, the engine uses
   * whichever pool has a slot of that level — and refuses to choose when both
   * do, on the same grounds it refuses to spend a feat's free casting: two
   * slots that come back on a Short Rest are a different resource from four
   * that do not, and nothing should spend one for you.
   */
  readonly slotKind?: SlotKind;
  /**
   * Which route supplied the spell — a class id, or a granting feature's.
   *
   * Recorded so the log can explain a save DC. A Cleric/Wizard's two routes
   * produce two different numbers for the same spell, and a log that says only
   * "cast Hold Person" cannot say which one was rolled against.
   */
  readonly route?: string;
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
  if (caster === null) return needsContext('unknown_creature', `${id} is not in this game`);
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

  // SRD Rage: "You can't maintain Concentration, and you can't cast spells."
  // Read off the running feature rather than named here, so a second feature
  // that says the same thing needs no change.
  const silencing = (caster.sheet.activated ?? []).find(
    (a) => a.forbidsCasting === true && caster.activeFeatures.includes(a.feature),
  );
  if (silencing !== undefined) {
    return err('raging', `${id} cannot cast while in ${silencing.name}`);
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

    const kind = chooseSlotKind(caster, level, command.slotKind);
    if (!kind.ok) return kind;
    slot = { key: slotKeyOf(kind.value, level), level };
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
    ...(command.route === undefined ? {} : { route: command.route }),
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
 * Which of the two slot pools pays for this casting.
 *
 * SRD: "you can use the spell slots you gain from Pact Magic to cast spells
 * you have prepared from classes with the Spellcasting feature, and you can
 * use the spell slots you gain from the Spellcasting feature to cast Warlock
 * spells you have prepared." So either pool may pay for either class's spell,
 * and the only question is which one the caster wants to spend.
 *
 * Named, it is honoured or refused. Unnamed, a caster with exactly one pool
 * holding a slot of that level spends it and is asked nothing — which is every
 * single-classed character, Warlocks included. A caster with both is refused,
 * because a Pact slot back in an hour and an ordinary slot back tomorrow are
 * not interchangeable and choosing between them is not the engine's to make.
 */
function chooseSlotKind(
  caster: CreatureState,
  level: number,
  named: SlotKind | undefined,
): Result<SlotKind> {
  const left = (kind: SlotKind): number => remaining(caster.resources, slotKeyOf(kind, level));

  if (named !== undefined) {
    if (left(named) < 1) {
      return err(
        'no_slot',
        named === 'pact'
          ? `no level ${level} Pact Magic slots left`
          : `no level ${level} spell slots left`,
      );
    }
    return ok(named);
  }

  const available: SlotKind[] = (['spell', 'pact'] as const).filter((kind) => left(kind) > 0);
  const only = available[0];
  if (only === undefined) return err('no_slot', `no level ${level} spell slots left`);
  if (available.length > 1) {
    return err(
      'slot_kind_required',
      `a level ${level} slot could come from Pact Magic or from Spellcasting; say which`,
    );
  }
  return ok(only);
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
  /**
   * The casting this effect belongs to.
   *
   * **The link is the casting, not the Concentration.** Reading it off
   * `caster.concentration` worked for every spell the engine had, because
   * every one of them concentrated — and then refused Blindness/Deafness,
   * which lasts a minute and needs no attention at all. A caller that knows
   * which casting it is resolving says so; the fallback below is for one that
   * does not.
   */
  readonly casting?: { readonly castingId: string; readonly spell: string };
}

export function applySpellEffect(
  state: GameState,
  targetId: CharacterId,
  condition: ConditionName,
  casterId: CharacterId,
  options: SpellEffectOptions = {},
): Result<GameEvent[]> {
  const caster = creatureOf(state, casterId);
  if (caster === null) return needsContext('unknown_creature', `${casterId} is not in this game`);

  const casting = options.casting ?? caster.concentration;
  if (casting === null || casting === undefined) {
    return err(
      'not_concentrating',
      `${casterId} is not concentrating on anything, and no casting was named`,
    );
  }

  return applyConditionTo(
    state,
    targetId,
    condition,
    castingSource(casting.spell, casting.castingId),
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
  if (caster === null) return needsContext('unknown_creature', `${casterId} is not in this game`);
  if (caster.concentration === null) {
    return err('not_concentrating', `${casterId} is not concentrating on anything`);
  }

  const target = creatureOf(state, targetId);
  if (target === null) return needsContext('unknown_creature', `${targetId} is not in this game`);

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
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
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
  if (caster === undefined) return needsContext('unknown_creature', `${id} is not in this game`);

  // Count only what this operation issues: a caller may hand the same issuer to
  // several operations in a turn, and `count` runs from where it was created.
  const issuedBefore = supply.issuer.count;
  const support = savingSupport(after, id, caster, 'con', supply);
  const save = rollSavingThrow(supply.issuer, supply.rng, caster.sheet, 'con', {
    dc: check.dc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
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
  /** True when this command id had already advanced the turn. */
  readonly duplicate?: boolean;
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
      return needsContext('unknown_creature', `${pending.target} owes a save but is not in this game`);
    }

    const support = savingSupport(state, pending.target, creature, pending.ability, supply);
    const save = rollSavingThrow(supply.issuer, supply.rng, creature.sheet, pending.ability, {
      dc: pending.dc,
      conditions: support.conditions,
      modes: support.modes,
      bonuses: support.bonuses,
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
  command: CommandIdentity = {},
): Result<TurnResolution> {
  // A retried advance is the duplicate nobody notices. It doubles no effect
  // and spends no resource — it **skips a combatant's whole turn**, and the
  // log it leaves behind is perfectly well-formed. The check comes before
  // every other, so a retry reports the duplicate rather than reporting
  // whatever the first advance made true.
  const identity = identify(state, 'turn', command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], saves: [], pending: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  if (state.combat === null) return err('no_combat', 'no combat is running');

  if (state.pendingMove !== null) {
    return err(
      'move_pending',
      `${state.pendingMove.mover} is mid-move and still owes an Opportunity Attack; settle it before the turn moves on`,
    );
  }

  if (state.pendingAttack !== null) {
    return err(
      'attack_pending',
      `${state.pendingAttack.attacker} has a hit whose damage is still unrolled; settle it before the turn moves on`,
    );
  }

  const outstanding = pendingSavesOf(state);
  if (outstanding.length > 0) {
    return err(
      'saves_pending',
      `${outstanding.length} turn-boundary save(s) are still owed; resolve them before the turn moves on`,
    );
  }

  const advanced: GameEvent[] = [
    { type: 'turn-advanced', ...(stamp === null ? {} : { command: stamp }) },
  ];
  let after = advanced.reduce(applyEvent, state);

  // SRD: "Whenever you start your turn with 0 Hit Points, you must make a
  // Death Saving Throw." Whenever — nobody decides it, so the turn owes it the
  // same way it owes an effect's repeat save, and for the same reason.
  const owed = deathSaveOwedBy(after);
  if (owed !== null) {
    if (supply === undefined) {
      return err(
        'death_save_owed',
        `${owed} starts their turn at 0 hit points and owes a Death Saving Throw; advancing needs a generator to roll it`,
      );
    }
    const rolled = rollTheDeathSave(after, owed, supply);
    if (!rolled.ok) return rolled;
    advanced.push(...rolled.value);
    after = rolled.value.reduce(applyEvent, after);
  }

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

/**
 * Whose turn has just begun at 0 hit points, if anybody's.
 *
 * SRD is precise about who rolls: a creature at 0 that is neither Stable nor
 * dead. A monster is none of these — it "dies the instant it drops to 0" — so
 * there is never one to ask.
 */
function deathSaveOwedBy(state: GameState): CharacterId | null {
  const combat = state.combat;
  if (combat === null) return null;

  const whose = currentCombatant(combat).id;
  const creature = state.creatures[whose];
  if (creature === undefined) return null;
  if (creature.vitals.dead || creature.vitals.stable) return null;
  return isDown(creature.vitals) ? whose : null;
}

/**
 * Roll it, and record what it was.
 *
 * Through `rollDeathSave` rather than an ordinary saving throw, because this
 * one is tied to no ability score: SRD, "Unlike other saving throws, this one
 * isn't tied to an ability score." It still takes modes and bonuses — Beacon
 * of Hope grants Advantage on it explicitly — which is why the roll starts
 * from zero rather than skipping the machinery.
 */
function rollTheDeathSave(
  state: GameState,
  who: CharacterId,
  supply: ConcentrationSaveSupply,
): Result<GameEvent[]> {
  const creature = state.creatures[who];
  if (creature === undefined) return needsContext('unknown_creature', `${who} has no record here`);

  const issuedBefore = supply.issuer.count;
  const rolled = rollDeathSave(supply.issuer, supply.rng, creature.vitals, {
    ...(supply.modes === undefined ? {} : { modes: supply.modes }),
    ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
  });
  if (!rolled.ok) return rolled;

  return ok([
    {
      type: 'death-save-recorded',
      id: who,
      natural: rolled.value.roll.natural,
      ...(rolled.value.roll.total === rolled.value.roll.natural
        ? {}
        : { total: rolled.value.roll.total }),
    },
    // SRD: a natural 20 "regains 1 Hit Point", and unconsciousness lasts only
    // "until you regain any Hit Points". The lifting is emitted here rather
    // than derived in the reducer, for the same reason healing emits it: the
    // reducer replays a record, and only the cause that put them down is
    // lifted — a character who was also put to Sleep stays asleep.
    ...(rolled.value.revived
      ? [
          {
            type: 'condition-removed' as const,
            id: who,
            condition: 'unconscious' as const,
            source: ZERO_HIT_POINTS,
          },
        ]
      : []),
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  ]);
}

// — casting a spell the engine knows ——————————————————————————————————————————

/** What happened to one target of one casting. */
export interface SpellTargetOutcome {
  readonly target: CharacterId;
  readonly attack?: AttackResult;
  readonly save?: D20TestResult;
  readonly damage?: number;
  /** Hit points actually restored, after the cap at the maximum. */
  readonly healed?: number;
  /** Temporary Hit Points granted. They do not stack; the larger set wins. */
  readonly temporaryHp?: number;
  readonly condition?: ConditionName;
  /**
   * The Concentration this damage put at risk, and what became of it.
   *
   * Present whenever damage was dealt to a creature that was concentrating:
   * the save is rolled by the same operation that dealt the damage, so nobody
   * has to remember to ask for it.
   */
  readonly concentration?: ConcentrationConsequence;
  /** Whether the effect actually landed on this target. */
  readonly affected: boolean;
}

/**
 * A cast that happened, and what it did to each target.
 *
 * There is no sibling shape for "it did not happen because a fact is missing".
 * That used to be `SpellNeedsContext`, returned as a **success** carrying
 * homework — which was the right idea reached by the wrong route. A caller had
 * to know that this one command answered the three-state question inside its
 * `ok` value while all forty-seven others answered it with an error, and no
 * amount of documentation makes a language model's tool surface remember that.
 *
 * The distinction now lives where every command already puts it:
 * `Err.kind === 'needs-context'`, with the structured requests on the error.
 * The property that made the original design right is unchanged — nothing is
 * spent, no die is thrown, and asking again after the fact is established is
 * the cast the caller meant the first time.
 */
export interface SpellResolution {
  readonly events: readonly GameEvent[];
  readonly castingId: string;
  readonly outcomes: readonly SpellTargetOutcome[];
  /** Checks the rules call for that the engine still cannot make. */
  readonly unverified: readonly string[];
}

export interface CastSpellRequest extends CommandIdentity {
  readonly spellId: string;
  /**
   * Who to aim at. Empty for an area spell, which picks its own.
   *
   * Maestro has already resolved "him" to an id by the time this arrives; the
   * engine checks the id it was handed and never substitutes a better one.
   */
  readonly targets: readonly CharacterId[];
  /**
   * Where an area spell's origin goes — "a point you choose within range".
   *
   * Required for an area whose origin is a point, and refused for one that
   * starts at the caster, because Burning Hands does not get to begin
   * somewhere else.
   */
  readonly at?: Point;
  /**
   * Which way a Cone, Cube or Line points.
   *
   * A point to aim at rather than an angle: Maestro speaks in landmarks and
   * creatures, and `positionOf` turns either into coordinates. An angle would
   * be the model typing raw geometry, which is the thing that is not allowed.
   */
  readonly towards?: Point;
  /** The slot to spend. Omitted for a cantrip or a free casting. */
  readonly slotLevel?: number;
  /**
   * Which pool the slot comes out of, for a caster who has both.
   *
   * Only a Warlock multiclassed into a Spellcasting class has both, and for
   * them the two are genuinely different resources. See `chooseSlotKind`.
   */
  readonly slotKind?: SlotKind;
  /** Why no slot is being spent, when none is. */
  readonly slotless?: SlotlessReason;
  /**
   * Which grant to cast it through: `class`, or a granting feature's id.
   *
   * **Default:** the class's own route when it supplies the spell, and the
   * single grant when only a feat does. Named explicitly when more than one
   * would serve and the choice matters — a feat brings its own spellcasting
   * ability, so the same spell can have two different save DCs, and so do two
   * classes that both prepared it. `class:<classId>` names one of those.
   */
  readonly source?: string;
  /**
   * How to pay for it.
   *
   * **Default:** a slot when `slotLevel` is given, and nothing at all for a
   * cantrip. When a grant offers a free casting *and* a slot would serve, the
   * engine refuses to choose: spending a feat's one daily casting instead of a
   * slot is the caller's decision, not a default.
   */
  readonly payment?: 'slot' | 'free-casting';
}

/**
 * Roll a spell's dice, with no weapon and no ability modifier attached.
 *
 * `rollAttackDamage` is the engine's one damage roller and it is built around
 * a weapon, so a spell borrows it with `weapon: null` and its own dice as
 * `extraDamage`, then keeps only its own components. The Unarmed Strike the
 * weaponless branch contributes is flat, so nothing is rolled for it and the
 * generator does not move — but it would be in the total, which is why the
 * filter is here rather than at each call site.
 */
function rollSpellDice(
  supply: ConcentrationSaveSupply,
  sheet: CharacterSheet,
  source: string,
  type: string,
  dice: string,
): Result<readonly DamageComponent[]> {
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    sheet,
    { weapon: null, targetAc: 0, extraDamage: [{ source, type, dice }] },
    false,
  );
  if (!rolled.ok) return rolled;
  return ok(rolled.value.components.filter((component) => component.source === source));
}

/**
 * Apply a spell's rolled damage to a target, defences and Concentration and all.
 *
 * Three things a spell must not have to remember, gathered in one place:
 *
 * - **The target's defences.** `applyDamage` has always taken them; nothing
 *   passed them, because they were not in state. A fire-immune creature took
 *   full damage from Fire Bolt, silently.
 * - **The Concentration the damage put at risk.** `resolveDamage` rolls that
 *   save itself, which is exactly why it exists — a caller who forgets leaves
 *   a spell running that the rules have ended.
 * - **Death and unconsciousness**, which `damageCreature` beneath it owns.
 *
 * Damage is summed per type before defences are applied, never per component:
 * halving 5 and 5 separately gives 4, halving their sum gives 5.
 */
function dealSpellDamage(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  source: string,
  supply: ConcentrationSaveSupply,
  options: { readonly critical?: boolean },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
}> {
  const victim = state.creatures[target];
  if (victim === undefined) return needsContext('unknown_creature', `${target} is not in this game`);

  // A creature's own defences and the ones its features grant, together. The
  // stat block's entries alone would miss a Sorcerer's Elemental Affinity.
  const applied = applyDamage(components, defensesOf(state, target));
  const resolved = resolveDamage(
    state,
    target,
    {
      amount: applied.total,
      source,
      ...(options.critical === true ? { critical: true } : {}),
    },
    supply,
  );
  if (!resolved.ok) return resolved;

  return ok({
    events: resolved.value.events,
    amount: applied.total,
    concentration: resolved.value.concentration,
  });
}

/**
 * Everything that applies to a creature's saving throw, gathered in one place.
 *
 * Same rule as Alert on Initiative: a modifier somebody has to remember is a
 * modifier a character silently stops having. Three sources, and they arrive
 * by three different routes:
 *
 * - **Stored** on the creature, by a spell that hung it there — Bless, Bane.
 * - **Standing**, from a class feature, derived from the state of the world at
 *   this instant — Aura of Protection, Danger Sense. Nothing stores these,
 *   because whether they apply changes when somebody walks away.
 * - **Supplied** by the caller, for whatever the engine cannot see.
 *
 * Deduplicated by source, so a helpful caller passing Bless as well does not
 * apply it twice. The conditions come back too: a feature can say a condition
 * has no effect on this creature right now, and every roll that reads
 * conditions has to read that instead.
 */
function savingSupport(
  state: GameState,
  who: CharacterId,
  victim: CreatureState,
  ability: Ability,
  supply: {
    readonly bonuses?: readonly Bonus[] | undefined;
    readonly modes?: readonly (RollMode | ModeSource)[] | undefined;
  },
): {
  readonly bonuses: readonly Bonus[];
  readonly modes: readonly (RollMode | ModeSource)[];
  readonly conditions: ConditionState;
} {
  const merged = new Map<string, Bonus>();
  for (const bonus of bonusesFor(victim.bonuses, 'save')) merged.set(bonus.source, bonus);
  for (const bonus of standingSaveBonuses(state, who, ability)) merged.set(bonus.source, bonus);
  for (const bonus of supply.bonuses ?? []) merged.set(bonus.source, bonus);

  // A bare RollMode has no source to deduplicate on, so it rides through as
  // given; a ModeSource is keyed, which is what stops a caller who also knows
  // about Danger Sense applying it twice.
  const named = new Map<string, ModeSource>();
  const bare: RollMode[] = [];
  for (const mode of standingSaveModes(state, who, ability)) named.set(mode.source, mode);
  for (const mode of supply.modes ?? []) {
    if (typeof mode === 'string') bare.push(mode);
    else named.set(mode.source, mode);
  }

  return {
    bonuses: [...merged.values()],
    modes: [...bare, ...named.values()],
    conditions: effectiveConditions(state, who),
  };
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
  return castOrRelease(state, casterId, request, supply, null);
}

/**
 * A casting that has already been paid for and is waiting to be let go.
 *
 * SRD Ready is the only thing that produces one: the slot went when the spell
 * was readied, so the release has a casting id but nothing left to spend.
 */
interface HeldCasting {
  readonly castingId: string;
}

/**
 * {@link resolveSpell}, and the same thing for a spell already paid for.
 *
 * One function rather than two because everything after the payment is
 * identical — targets, range, cover, the save DC, the effects — and a second
 * copy of it would be a second place for a rules fix to miss.
 */
function castOrRelease(
  state: GameState,
  casterId: CharacterId,
  request: CastSpellRequest,
  supply: ConcentrationSaveSupply,
  held: HeldCasting | null,
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
  if (caster === null) return needsContext('unknown_creature', `${casterId} is not in this game`);

  const definition = definitionFor(request.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${request.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD gives "until the end of your next turn" no meaning where there are no
  // turns, and `resolveDuration` refuses rather than inventing six seconds.
  // Asked here, before the slot and before the first die: the same
  // validate-before-rolling rule the rest of casting obeys, and the reason a
  // Color Spray outside combat costs its caster nothing at all.
  for (const lasts of riderDurations(definition)) {
    const pinned = resolveDuration(
      { elapsed: state.elapsed, combat: state.combat },
      riderDuration(lasts, casterId) as Duration,
    );
    if (!pinned.ok) return pinned;
  }

  // SRD Divine Smite is cast "immediately after hitting a target", so the
  // attack is the thing it needs and this command has none to give it.
  if (definition.effects.some((effect) => effect.kind === 'attack-damage')) {
    return err(
      'cast_on_a_hit',
      `${definition.name} is cast on an attack that has hit; settle the attack's damage with it instead`,
    );
  }

  // SRD: you cast what you know or have prepared, and nothing else.
  const chosen = chooseRoute(caster.spellcasting, request.spellId, request.source);
  if (!chosen.ok) return chosen;
  const route = chosen.value;

  const slotLevel = request.slotLevel ?? definition.level;
  const castLevel = Math.max(definition.level, slotLevel);
  // What this definition knowingly leaves out, reported on every casting so
  // the narrating layer can hand the rest to the DM rather than lose it.
  const unverified: string[] = [
    ...(definition.unmodelled ?? []).map((gap) => `${definition.name}: ${gap}`),
  ];
  const needs: ContextRequest[] = [];

  // — targets ————————————————————————————————————————————————————————————
  //
  // Two ways a spell finds its targets, and they do not mix. A named-target
  // spell is handed ids; an area spell is handed a place and works out for
  // itself who is standing in it.
  const reach = ranged(definition.range);
  let targets: readonly CharacterId[];

  if (definition.area !== undefined) {
    const resolved = areaTargets(state, casterId, definition, definition.area, request, reach);
    if (!resolved.ok) return resolved;
    targets = resolved.value;
  } else {
    const named = namedTargets(state, casterId, definition, request, castLevel, reach, needs);
    if (!named.ok) return named;
    targets = named.value;
  }

  if (needs.length > 0) {
    return needsContext(
      'needs_context',
      `${definition.name} cannot be resolved until ${needs.length === 1 ? 'a fact is' : `${needs.length} facts are`} established: ${needs.map((n) => n.need).join('; ')}`,
      needs,
    );
  }

  return resolveOnTargets(state, casterId, caster, definition, request, {
    castLevel,
    route,
    targets,
    unverified,
    supply,
    held,
  });
}

/**
 * Which creatures an area catches, and where the caller has to put it.
 *
 * The geometry is `positioning.ts`'s and is not reimplemented here: all six
 * SRD shapes, measured between volumes on the 5-foot lattice, with the origin
 * included or excluded per shape. What this adds is the spell's half — whether
 * the caller supplied the point and direction the shape needs, whether the
 * point is in range, and which of the creatures caught are ones this spell can
 * actually affect.
 */
function areaTargets(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  area: SpellArea,
  request: CastSpellRequest,
  reach: number | null,
): Result<readonly CharacterId[]> {
  if (request.targets.length > 0) {
    return err(
      'area_picks_its_own_targets',
      `${definition.name} fills an area and catches whoever is in it; it does not take a target list`,
    );
  }
  if (state.scene === null) {
    return needsContext(
      'no_scene',
      `${definition.name} fills an area and there is no scene for it to fill`,
      [
        {
          kind: 'scene',
          subject: casterId,
          need: 'a scene, so that an area has somewhere to be',
          because: `${definition.name} fills an area`,
          satisfyWith: 'a scene-set event',
        },
      ],
    );
  }

  const placed = positionOf(state.scene, casterId);
  if (placed === null) {
    return needsContext(
      'unplaced',
      `nobody has said where ${casterId} is standing, and ${definition.name} starts its area there`,
      [
        {
          kind: 'position',
          subject: casterId,
          need: `where ${casterId} is standing`,
          because: `${definition.name} starts its area at the caster`,
          satisfyWith: `a creature-placed event for ${casterId}`,
        },
      ],
    );
  }

  // Where it starts. `self` means the caster and refuses to be moved; `point`
  // must be given and must be within the spell's range.
  let origin: AreaOrigin;
  if (area.origin === 'self') {
    if (request.at !== undefined) {
      return err(
        'area_starts_at_caster',
        `${definition.name} originates from you; it cannot be placed elsewhere`,
      );
    }
    origin = { creature: casterId };
  } else {
    if (request.at === undefined) {
      return err('no_origin', `${definition.name} needs a point to centre its area on`);
    }
    if (reach !== null) {
      const away = distanceToPoint(state.scene, casterId, request.at);
      if (!away.ok) return away;
      if (away.value > reach) {
        return err(
          'out_of_range',
          `${definition.name} reaches ${reach} feet; that point is ${away.value} away`,
        );
      }
    }
    origin = { point: request.at };
  }

  // A Cone, Cube or Line has to be pointed somewhere.
  const towards = request.towards;
  if (DIRECTIONAL_AREAS.has(area.kind) && towards === undefined) {
    return err(
      'no_direction',
      `${definition.name} forms a ${area.kind} and needs a direction to point it in`,
    );
  }
  if (!DIRECTIONAL_AREAS.has(area.kind) && towards !== undefined) {
    return err('not_directional', `a ${area.kind} has no direction to point`);
  }

  let shape: AreaShape;
  switch (area.kind) {
    case 'sphere':
      shape = { kind: 'sphere', radius: area.radius };
      break;
    case 'cylinder':
      shape = { kind: 'cylinder', radius: area.radius, height: area.height };
      break;
    case 'emanation':
      shape = { kind: 'emanation', distance: area.distance };
      break;
    case 'cone':
      shape = { kind: 'cone', length: area.length, towards: towards ?? placed };
      break;
    case 'cube':
      shape = { kind: 'cube', size: area.size, towards: towards ?? placed };
      break;
    case 'line':
      shape = { kind: 'line', length: area.length, width: area.width, towards: towards ?? placed };
      break;
  }

  const caught = creaturesInArea(state.scene, origin, shape);
  if (!caught.ok) return caught;

  // A creature the spell cannot affect is filtered out, not refused. "Each
  // Humanoid in the area" leaves the ogre standing there unbothered; it does
  // not make the casting illegal, which is the difference between an area and
  // a target a caller named.
  const wanted = definition.targets.mustBeType;
  const eligible = caught.value.filter((who: CharacterId) => {
    const creature = state.creatures[who];
    if (creature === undefined) return false;
    if (creature.vitals.dead) return false;
    if (wanted !== undefined && creature.creatureType?.toLowerCase() !== wanted.toLowerCase()) {
      return false;
    }
    // SRD: "A spell's area of effect is blocked by Total Cover." Cover here is
    // declared pairwise from the caster rather than traced through the area,
    // which is the documented approximation the whole cover model makes.
    if (state.scene !== null && coverBetween(state.scene, casterId, who) === 'total') return false;
    return true;
  });

  return ok(eligible.slice().sort());
}

/** The other half: a list of ids somebody chose, each checked as itself. */
function namedTargets(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  request: CastSpellRequest,
  castLevel: number,
  reach: number | null,
  needs: ContextRequest[],
): Result<readonly CharacterId[]> {
  if (request.at !== undefined || request.towards !== undefined) {
    return err(
      'not_an_area',
      `${definition.name} is cast on a target, not at a place`,
    );
  }

  const allowed = targetCountFor(definition.targets, definition.level, castLevel);

  // A spell that aims at nobody. SRD's "Range: Self" utility spells — Detect
  // Magic, Disguise Self — and the ones that act on an object or a point, like
  // Light and Mage Hand. They are cast, they cost what they cost and they run
  // for their duration; there is simply no creature to check.
  if (allowed === 0) {
    if (request.targets.length > 0) {
      return err('takes_no_target', `${definition.name} is not cast on a creature`);
    }
    return ok([]);
  }

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

  for (const target of request.targets) {
    if (state.creatures[target] === undefined) {
      return needsContext('unknown_creature', `${target} is not in this game`);
    }
    if (target === casterId && definition.targets.self !== true) {
      return err('cannot_target_self', `${definition.name} is not cast on yourself`);
    }

    // A type the spell demands is checked; a type nobody has stated is asked
    // for rather than waved through.
    const wanted = definition.targets.mustBeType;
    if (wanted !== undefined) {
      const actual = state.creatures[target]?.creatureType ?? null;
      if (actual === null) {
        needs.push({
          kind: 'creature-type',
          subject: target,
          need: `what kind of creature ${target} is`,
          because: `${definition.name} may only target a ${wanted}`,
          satisfyWith: `a creature-type-declared event for ${target}, or a creatureType when it is added`,
        });
      } else if (actual.toLowerCase() !== wanted.toLowerCase()) {
        return err(
          'wrong_creature_type',
          `${definition.name} may only target a ${wanted}; ${target} is ${actual}`,
        );
      }
    }

    if (state.scene === null) {
      needs.push({
        kind: 'scene',
        subject: target,
        need: 'a scene, so that distances mean something',
        because: `${definition.name} has a range to check`,
        satisfyWith: 'a scene-set event',
      });
    } else if (reach !== null) {
      // SRD Hold Person: "a Humanoid that you can see." Unknown is a fact to
      // establish; declared *unseen* is the refusal.
      if (definition.requiresSight === true) {
        const seen = sightBetween(state.scene, casterId, target);
        if (seen === null) {
          needs.push({
            kind: 'visibility',
            subject: target,
            need: `whether ${casterId} can see ${target}`,
            because: `${definition.name} targets a creature you can see`,
            satisfyWith: `a sight-declared event from ${casterId} to ${target}`,
          });
        } else if (!seen) {
          return err('cannot_see_target', `${casterId} cannot see ${target}`);
        }
      }

      const apart = distanceBetween(state.scene, casterId, target);
      if (!apart.ok) {
        needs.push({
          kind: 'position',
          subject: target,
          need: `where ${target} is standing`,
          because: `${definition.name} reaches ${reach} feet and the distance is unknown`,
          satisfyWith: `a creature-placed event for ${target}`,
        });
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

  return ok(request.targets);
}

/**
 * Pay for the casting and apply its effects to the targets already settled.
 *
 * Split out from `resolveSpell` when areas arrived: how a spell finds its
 * targets and what it then does to them are two questions, and only the first
 * of them cares whether the spell fills a Cone or was aimed at a goblin.
 */
function resolveOnTargets(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  definition: SpellDefinition,
  request: CastSpellRequest,
  context: {
    readonly castLevel: number;
    readonly route: CastingRoute;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: ConcentrationSaveSupply;
    /** Set when the casting was paid for earlier — a readied spell. */
    readonly held: HeldCasting | null;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, held } = context;

  // — paying for it ——————————————————————————————————————————————————————
  //
  // A free casting from a feat spends its own pool; anything else goes through
  // the ordinary casting command, which owns slots, the action, and the
  // Concentration that starts or is replaced.
  const events: GameEvent[] = [];

  // SRD Ready: "you cast it as normal (expending any resources used to cast
  // it) but hold its energy." The expending happened when it was readied, so
  // a release skips the whole of it — including the action, which the Ready
  // itself was.
  if (held !== null) {
    return resolveEffects(state, casterId, caster, definition, {
      castLevel,
      route,
      targets,
      unverified,
      supply,
      castingId: held.castingId,
      events,
    });
  }

  const payment = choosePayment(definition, route, request);
  if (!payment.ok) return payment;
  const freePool = payment.value;

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
      : {
          slotLevel: castLevel,
          ...(request.slotKind === undefined ? {} : { slotKind: request.slotKind }),
        }),
    route: route.kind === 'granted' ? route.grant.source : `class:${route.classId}`,
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

  return resolveEffects(state, casterId, caster, definition, {
    castLevel,
    route,
    targets,
    unverified,
    supply,
    castingId,
    events,
  });
}

/**
 * What a spell does, once it has been paid for.
 *
 * Split from the payment above it for exactly one reason: SRD Ready pays on
 * one turn and resolves on another, and everything from here down is the same
 * either way. Nothing else about the two halves differs, which is why they are
 * one function called twice rather than two functions kept in step by hand.
 */
function resolveEffects(
  state: GameState,
  casterId: CharacterId,
  caster: CreatureState,
  definition: SpellDefinition,
  context: {
    readonly castLevel: number;
    readonly route: CastingRoute;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: ConcentrationSaveSupply;
    readonly castingId: string;
    readonly events: GameEvent[];
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, castingId, events } = context;

  // — what it does ———————————————————————————————————————————————————————
  let current = events.reduce(applyEvent, state);
  const outcomes: SpellTargetOutcome[] = [];
  const issuedBefore = supply.issuer.count;

  // The *chosen source's* ability, not the class's. A feat brings its own.
  const attackModifier = spellAttackModifierWith(caster.sheet, route.ability);
  const saveDc = spellSaveDcWith(caster.sheet, route.ability);

  for (const target of targets) {
    for (const effect of definition.effects) {
      const victim = current.creatures[target];
      if (victim === undefined) continue;

      if (effect.kind === 'attack') {
        const attack = rollAttack(supply.issuer, supply.rng, caster.sheet, {
          weapon: null,
          targetAc: armorClass(victim.sheet),
          attackBonuses: [
            { source: `${definition.name} (spell attack)`, flat: attackModifier },
            // Bless is on the caster, not in the caller's head.
            ...bonusesFor(caster.bonuses, 'attack'),
            ...(supply.bonuses ?? []),
          ],
          ...(supply.modes === undefined ? {} : { modes: supply.modes }),
          // A condition a feature has suppressed gives an attacker nothing:
          // SRD Aura of Courage says the condition "has no effect on that ally
          // while there", and being easier to hit is an effect.
          targetConditions: effectiveConditions(current, target),
          // Prone reads the distance, and a spell attack is measured the same
          // way a weapon's is. Absent where nobody has placed them, so the
          // rule gives no answer rather than a guessed one.
          ...(apartFrom(current, casterId, target) === null
            ? {}
            : { withinFiveFeet: apartFrom(current, casterId, target)! <= 5 }),
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

        const dice = scaledDiceFor(effect.damage, definition.level, caster.sheet.level, castLevel);
        // A critical doubles the dice, which is `rollAttackDamage`'s job, so
        // this one call keeps the weapon-shaped signature rather than going
        // through `rollSpellDice`.
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

        const hurt = dealSpellDamage(
          current,
          target,
          rolled.value.components.filter((c) => c.source === definition.name),
          definition.name,
          supply,
          { ...(attack.value.critical ? { critical: true } : {}) },
        );
        if (!hurt.ok) return hurt;

        events.push(...hurt.value.events);
        current = hurt.value.events.reduce(applyEvent, current);

        // SRD Ray of Sickness: "On a hit, the target takes 2d8 Poison damage
        // **and** has the Poisoned condition". The attack roll settled it up
        // there; a miss already returned, so reaching here is the hit.
        if (effect.condition !== undefined) {
          const rider = applySpellEffect(current, target, effect.condition.name, casterId, {
            casting: { castingId, spell: definition.name },
            ...(riderDuration(effect.condition.lasts, casterId) === undefined
              ? {}
              : { duration: riderDuration(effect.condition.lasts, casterId)! }),
          });
          if (!rider.ok) return rider;
          events.push(...rider.value);
          current = rider.value.reduce(applyEvent, current);
        }

        outcomes.push({
          target,
          attack: attack.value,
          damage: hurt.value.amount,
          concentration: hurt.value.concentration,
          ...(effect.condition === undefined ? {} : { condition: effect.condition.name }),
          affected: true,
        });
        continue;
      }

      // Temporary Hit Points. Beside the hit points, never in them.
      if (effect.kind === 'temp-hp') {
        const dice = scaledDiceFor(effect.amount, definition.level, caster.sheet.level, castLevel);
        const rolled = rollSpellDice(supply, caster.sheet, definition.name, 'temporary', dice);
        if (!rolled.ok) return rolled;

        const flat = scaledFlatFor(effect.amount, definition.level, castLevel);
        const modifier = effect.addSpellcastingModifier
          ? modifierFor(caster.sheet, route.ability)
          : 0;
        const amount = Math.max(
          0,
          rolled.value.reduce((sum, c) => sum + c.total, 0) + flat + modifier,
        );

        const granted = grantTemporaryHpTo(current, target, amount);
        if (!granted.ok) return granted;
        events.push(...granted.value);
        current = granted.value.reduce(applyEvent, current);
        outcomes.push({ target, temporaryHp: amount, affected: true });
        continue;
      }

      // A named bonus later rolls will read. Bane saves first; Bless does not.
      if (effect.kind === 'buff') {
        let save: D20TestResult | null = null;
        if (effect.ability !== undefined) {
          const support = savingSupport(current, target, victim, effect.ability, supply);
          const rolled = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
            dc: saveDc,
            conditions: support.conditions,
            modes: support.modes,
            bonuses: support.bonuses,
          });
          if (!rolled.ok) return rolled;
          save = rolled.value;

          events.push(
            recordD20Test(
              target,
              `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
              save,
              save.success ? 'resisted' : 'affected',
            ),
          );

          if (save.success) {
            outcomes.push({ target, save, affected: false });
            continue;
          }
        }

        // The casting is in the source, so ending the spell ends the bonus.
        events.push({
          type: 'bonus-applied',
          id: target,
          bonus: {
            source: castingSource(definition.name, castingId),
            bonus: { ...effect.bonus, source: definition.name },
            applies: effect.applies,
            direction: effect.direction,
          },
        });
        current = events.slice(-1).reduce(applyEvent, current);
        outcomes.push({
          target,
          ...(save === null ? {} : { save }),
          affected: true,
        });
        continue;
      }

      // Hit points restored. No roll to beat and nothing to resist: healing is
      // not damage, and a target at full is a legal target who gains nothing.
      if (effect.kind === 'heal') {
        const dice = scaledDiceFor(effect.healing, definition.level, caster.sheet.level, castLevel);
        const rolled = rollSpellDice(supply, caster.sheet, definition.name, 'healing', dice);
        if (!rolled.ok) return rolled;

        // SRD: "2d8 plus your spellcasting ability modifier" — and it is the
        // *chosen route's* ability, so a feat's version heals by its own.
        const bonus = effect.addSpellcastingModifier ? modifierFor(caster.sheet, route.ability) : 0;
        const amount = Math.max(0, rolled.value.reduce((sum, c) => sum + c.total, 0) + bonus);

        events.push({
          type: 'roll-recorded',
          who: casterId,
          label: `${definition.name} healing`,
          natural: 0,
          total: amount,
          contributions: [{ source: 'spellcasting modifier', amount: bonus }],
          outcome: 'healed',
        });

        // `healCreature` refuses a corpse and refuses nothing-at-all, and it
        // lifts exactly the unconsciousness that having no hit points caused.
        // The cap at the maximum is `heal`'s, in vitals, where it always was.
        const before = victim.vitals.hp;
        const healed = healCreature(current, target, Math.max(1, amount));
        if (!healed.ok) return healed;

        events.push(...healed.value);
        current = healed.value.reduce(applyEvent, current);
        outcomes.push({
          target,
          healed: (current.creatures[target]?.vitals.hp ?? before) - before,
          affected: true,
        });
        continue;
      }

      // A saving throw that deals damage, with what a success buys stated.
      if (effect.kind === 'save-damage') {
        const support = savingSupport(current, target, victim, effect.ability, supply);
        const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
          dc: saveDc,
          conditions: support.conditions,
          modes: support.modes,
          bonuses: support.bonuses,
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

        // Nothing at all on a success means no damage roll either: the spell
        // did nothing, and rolling would move the generator for no reason.
        if (save.value.success && effect.onSuccess === 'none') {
          outcomes.push({ target, save: save.value, damage: 0, affected: false });
          continue;
        }

        // One save, and every damage type the spell names under it. Each
        // type rolls and scales separately; the save was already made once.
        const parts = [
          { damage: effect.damage, damageType: effect.damageType },
          ...(effect.plus ?? []),
        ];
        const rolledParts: DamageComponent[] = [];
        for (const part of parts) {
          const dice = scaledDiceFor(part.damage, definition.level, caster.sheet.level, castLevel);
          const rolled = rollSpellDice(
            supply,
            caster.sheet,
            definition.name,
            part.damageType,
            dice,
          );
          if (!rolled.ok) return rolled;
          rolledParts.push(...rolled.value);
        }

        // SRD: "The halved damage is equal to half the damage that would be
        // dealt on a failed save." Half of what the spell deals, therefore
        // *before* the target's own Resistance — which then halves again.
        const components = save.value.success
          ? rolledParts.map((c) => ({ ...c, total: Math.floor(c.total / 2) }))
          : rolledParts;

        const hurt = dealSpellDamage(
          current,
          target,
          components,
          definition.name,
          supply,
          {},
        );
        if (!hurt.ok) return hurt;

        events.push(...hurt.value.events);
        current = hurt.value.events.reduce(applyEvent, current);

        // SRD Sunbeam: "takes 6d8 Radiant damage **and** has the Blinded
        // condition". The same failed save, so no second roll — and nothing at
        // all on a success, because the condition is on the failure branch of
        // a sentence the damage only half-shares.
        if (effect.condition !== undefined && !save.value.success) {
          const rider = applySpellEffect(current, target, effect.condition.name, casterId, {
            casting: { castingId, spell: definition.name },
            ...(riderDuration(effect.condition.lasts, casterId) === undefined
              ? {}
              : { duration: riderDuration(effect.condition.lasts, casterId)! }),
          });
          if (!rider.ok) return rider;
          events.push(...rider.value);
          current = rider.value.reduce(applyEvent, current);
        }

        outcomes.push({
          target,
          save: save.value,
          damage: hurt.value.amount,
          concentration: hurt.value.concentration,
          ...(effect.condition === undefined || save.value.success
            ? {}
            : { condition: effect.condition.name }),
          affected: !save.value.success,
        });
        continue;
      }

      // An on-hit spell never reaches here: `resolveSpell` refuses one up
      // front, because the attack it rides on is not this command's to give.
      if (effect.kind === 'attack-damage') continue;

      // A saving throw, and a condition on a failure.
      const support = savingSupport(current, target, victim, effect.ability, supply);
      const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
        dc: saveDc,
        conditions: support.conditions,
        modes: support.modes,
        bonuses: support.bonuses,
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
        casting: { castingId, spell: definition.name },
        ...(riderDuration(effect.lasts, casterId) === undefined
          ? {}
          : { duration: riderDuration(effect.lasts, casterId)! }),
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

/**
 * Which route supplies this spell for this casting.
 *
 * SRD Multiclassing: "Each spell you prepare is associated with one of your
 * classes, and you use the spellcasting ability of that class when you cast
 * the spell." A Cleric/Wizard who has prepared the same spell through both has
 * two spells with two save DCs, and which of them is being cast is a fact
 * about the character sheet that the engine cannot read off the spell's name.
 *
 * So: with no `source` named, a class's own route wins over a feat's — a
 * Wizard who happens to know Fire Bolt twice casts it as a Wizard — but **two
 * class routes is a refusal**, not a coin toss. Naming a source that does not
 * supply the spell is likewise a refusal rather than a quiet fallback: a
 * caller who asked for the feat's version meant it.
 */
function chooseRoute(
  spellcasting: SpellcastingState,
  spellId: string,
  source: string | undefined,
): Result<CastingRoute> {
  const routes = routesFor(spellcasting, spellId);

  if (source === undefined || source === 'class') {
    const fromClass = routes.filter((route) => route.kind !== 'granted');

    if (fromClass.length > 1) {
      const named = fromClass.map((route) => `class:${route.classId}`).join(', ');
      return err(
        'class_required',
        `${spellId} is prepared through more than one class, and each casts it with its own spellcasting ability; name one of ${named}`,
      );
    }

    const chosen = source === 'class' ? fromClass[0] : (fromClass[0] ?? routes[0]);
    if (chosen === undefined) {
      return source === 'class'
        ? err('source_does_not_supply', `no class of this creature supplies ${spellId}`)
        : err(
            'spell_not_available',
            `this creature has not prepared ${spellId} and knows it from nothing else`,
          );
    }
    return ok(chosen);
  }

  if (source.startsWith('class:')) {
    const classId = source.slice('class:'.length);
    const chosen = routes.find((route) => route.kind !== 'granted' && route.classId === classId);
    if (chosen === undefined) {
      return err('source_does_not_supply', `this creature's ${classId} half does not supply ${spellId}`);
    }
    return ok(chosen);
  }

  const grant = spellcasting.granted.find((g) => g.source === source && g.spellId === spellId);
  if (grant === undefined) {
    return err('source_does_not_supply', `${source} does not supply ${spellId}`);
  }
  return ok({ kind: 'granted', ability: grant.ability, grant });
}

/**
 * What pays for the casting: a grant's free daily use, or a spell slot.
 *
 * The engine will not pick between them. A feat's one free casting is a
 * resource a player may well be saving, and spending it because no slot level
 * happened to be named is the kind of quiet decision that loses a fight two
 * rooms later. Where both would serve, the caller says which.
 *
 * Returns the pool to spend, or null for "this is not a free casting".
 */
function choosePayment(
  definition: { readonly level: number; readonly name: string },
  route: CastingRoute,
  request: CastSpellRequest,
): Result<string | null> {
  // A cantrip costs nothing on any route.
  if (definition.level === 0) return ok(null);

  const free = route.kind === 'granted' ? route.grant.freeCastPool : null;
  const slotAllowed = route.kind !== 'granted' || route.grant.slotCasting;

  if (request.payment === 'free-casting') {
    if (free === null) {
      return err('no_free_casting', `${definition.name} has no free casting on this route`);
    }
    return ok(free);
  }
  if (request.payment === 'slot') {
    if (!slotAllowed) {
      return err('slot_not_allowed', `${definition.name} cannot be cast with a slot on this route`);
    }
    return ok(null);
  }

  if (request.slotLevel !== undefined) return ok(null);
  if (free === null) return ok(null);
  if (!slotAllowed) return ok(free);

  return err(
    'payment_required',
    `${definition.name} could be cast with this grant's free-casting or with a slot; say which`,
  );
}

/** Targets a spell could legally be aimed at, and why the others could not. */
export interface EligibleTargets {
  readonly eligible: readonly CharacterId[];
  readonly excluded: readonly { readonly target: CharacterId; readonly reason: string }[];
  /** Facts that would have to be established before a target can be judged. */
  readonly needsContext: readonly ContextRequest[];
}

/**
 * Who this caster could legally aim this spell at.
 *
 * Working out that "him" means the goblin is interpretation, and belongs to the
 * layer that reads the fiction. What the engine can do is hand that layer the
 * shortlist — so "the obvious target" has something to be obvious about — and
 * say why each of the others is out, so a refusal can be narrated rather than
 * reported.
 *
 * **This is a shortlist, not a substitution mechanism.** Maestro resolves the
 * player's intended target *before* calling `resolveSpell`, which then checks
 * the id it was handed and only that id. Nothing here nominates a replacement,
 * and `resolveSpell` will refuse an ineligible target naming that target even
 * when exactly one legal alternative is standing beside it. A player who said
 * "the goblin" and hit the thug has been lied to about what happened.
 */
export function eligibleTargets(
  state: GameState,
  casterId: CharacterId,
  spellId: string,
  slotLevel: number,
): EligibleTargets {
  const definition = definitionFor(spellId);
  const caster = creatureOf(state, casterId);
  if (definition === null || caster === null) {
    return { eligible: [], excluded: [], needsContext: [] };
  }
  void slotLevel;

  const eligible: CharacterId[] = [];
  const excluded: { target: CharacterId; reason: string }[] = [];
  const needsContext: ContextRequest[] = [];
  const reach = definition.range.kind === 'ranged' ? definition.range.feet : 5;

  for (const key of Object.keys(state.creatures).sort()) {
    const target = state.creatures[key];
    if (target === undefined) continue;
    if (target.id === casterId && definition.targets.self !== true) continue;
    if (target.vitals.dead) {
      excluded.push({ target: target.id, reason: `${target.name} is dead` });
      continue;
    }

    const wanted = definition.targets.mustBeType;
    if (wanted !== undefined) {
      const actual = target.creatureType;
      if (actual === null) {
        needsContext.push({
          kind: 'creature-type',
          subject: target.id,
          need: `what kind of creature ${target.name} is`,
          because: `${definition.name} may only target a ${wanted}`,
          satisfyWith: `a creature-type-declared event for ${target.id}`,
        });
        continue;
      }
      if (actual.toLowerCase() !== wanted.toLowerCase()) {
        excluded.push({ target: target.id, reason: `${target.name} is ${actual}, not ${wanted}` });
        continue;
      }
    }

    if (state.scene !== null) {
      const apart = distanceBetween(state.scene, casterId, target.id);
      if (!apart.ok) {
        needsContext.push({
          kind: 'position',
          subject: target.id,
          need: `where ${target.name} is standing`,
          because: `${definition.name} reaches ${reach} feet`,
          satisfyWith: `a creature-placed event for ${target.id}`,
        });
        continue;
      }
      if (apart.value > reach) {
        excluded.push({
          target: target.id,
          reason: `${target.name} is ${apart.value} feet away, outside the range of ${reach}`,
        });
        continue;
      }
      if (coverBetween(state.scene, casterId, target.id) === 'total') {
        excluded.push({ target: target.id, reason: `${target.name} is behind Total Cover` });
        continue;
      }
      if (definition.requiresSight === true) {
        const seen = sightBetween(state.scene, casterId, target.id);
        if (seen === null) {
          needsContext.push({
            kind: 'visibility',
            subject: target.id,
            need: `whether ${casterId} can see ${target.name}`,
            because: `${definition.name} targets a creature you can see`,
            satisfyWith: `a sight-declared event from ${casterId} to ${target.id}`,
          });
          continue;
        }
        if (!seen) {
          excluded.push({ target: target.id, reason: `${casterId} cannot see ${target.name}` });
          continue;
        }
      }
    }

    eligible.push(target.id);
  }

  return { eligible, excluded, needsContext };
}

/**
 * Roll Initiative for a creature, with whatever its own features contribute.
 *
 * SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus to
 * the roll." The engine already knows about that — creation worked it out — so
 * making a caller remember to pass it is how a character silently stops having
 * the feat they paid for. Supplied once, named in the roll, and deduplicated
 * against anything the caller adds, so it cannot land twice.
 */
export function rollInitiativeFor(
  state: GameState,
  id: CharacterId,
  issuer: RollIssuer,
  rng: Rng,
  options: InitiativeOptions = {},
): Result<InitiativeRoll> {
  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

  const own = creature.initiativeBonuses;
  const supplied = options.bonuses ?? [];
  const mine = own.filter((bonus) => !supplied.some((other) => other.source === bonus.source));

  return rollInitiative(issuer, rng, id, creature.sheet, {
    ...options,
    conditions: options.conditions ?? effectiveConditions(state, id),
    bonuses: [...supplied, ...mine],
  });
}

// — what a creature owns ——————————————————————————————————————————————————————

/** Everything this creature is carrying, by catalogue id. */
export function carrying(state: GameState, id: CharacterId): readonly InventoryLine[] {
  return creatureOf(state, id)?.inventory ?? [];
}

/** Money on hand, in copper. */
export function coinsOf(state: GameState, id: CharacterId): number {
  return creatureOf(state, id)?.coins ?? 0;
}

const quantityOf = (state: GameState, id: CharacterId, itemId: string): number =>
  carrying(state, id).find((line) => line.id === itemId)?.quantity ?? 0;

/**
 * Buy something, at the price the SRD prints.
 *
 * Atomic on purpose: the items and the coin move in one batch, so there is no
 * state in which a character has paid and not received. A price the SRD leaves
 * as "Varies" is refused rather than guessed — the book declined to say, and
 * inventing a number is worse than asking.
 *
 * Buying a pack buys what is in it: SRD prices the bundle and lists the
 * contents, so a Scholar's Pack puts nine things in your hands.
 */
export function purchaseItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  quantity = 1,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string; quantity: number } =
    commandId === undefined ? { itemId, quantity } : { commandId, itemId, quantity };
  const identity = identify(state, `purchase:${id}`, inputs);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

  if (!Number.isInteger(quantity) || quantity < 1) {
    return err('bad_quantity', `a purchase takes a positive whole number, got ${quantity}`);
  }

  const item = itemFor(itemId);
  if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
  if (item.costCp === null) {
    return err(
      'no_price',
      `the SRD prints no single price for ${item.name}; choose a variant, or have the GM set one`,
    );
  }

  const price = item.costCp * quantity;
  if (creature.coins < price) {
    return err(
      'cannot_afford',
      `${item.name} costs ${price} copper and ${id} has ${creature.coins}`,
    );
  }

  const items = expandPack(itemId).map((line) => ({
    id: line.id,
    quantity: line.quantity * quantity,
  }));

  return ok([
    {
      type: 'items-gained',
      id,
      items,
      source: `bought ${quantity} × ${item.name}`,
      ...(stamp === null ? {} : { command: stamp }),
    },
    { type: 'coins-changed', id, copper: -price, source: `bought ${item.name}` },
  ]);
}

/** Armour and weapons are worn or wielded; a sack of parchment is not. */
const EQUIPPABLE: ReadonlySet<ItemKind> = new Set<ItemKind>(['armor', 'weapon']);

/**
 * Wear or wield something already owned.
 *
 * The separation this exists for: **owning is not wearing**. Chain mail in a
 * backpack protects nobody, so Armour Class reads the equipped set and this is
 * the only thing that moves it.
 *
 * SRD allows one suit of body armour and one shield, so a second of either is
 * refused rather than silently replacing the first — taking armour off is a
 * decision, and it should look like one in the log.
 */
export function equipItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  const identity = identify(state, `equip:${id}`, inputs);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

  const item = itemFor(itemId);
  if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
  if (!EQUIPPABLE.has(item.kind)) {
    return err('not_equippable', `${item.name} is carried, not worn or wielded`);
  }
  if (quantityOf(state, id, itemId) < 1) {
    return err('not_owned', `${id} does not have ${item.name}`);
  }
  if (creature.equipped.includes(itemId)) {
    return err('already_equipped', `${item.name} is already in hand`);
  }

  // One suit of body armour, one shield.
  if (item.armor !== null) {
    const slot = item.armor.category === 'shield' ? 'shield' : 'body armour';
    const taken = creature.equipped
      .map((held) => itemFor(held))
      .find((held): held is CatalogueItem => {
        if (held?.armor == null) return false;
        const heldSlot = held.armor.category === 'shield' ? 'shield' : 'body armour';
        return heldSlot === slot;
      });
    if (taken !== undefined) {
      return err('slot_taken', `${taken.name} is already worn as ${slot}; take it off first`);
    }
  }

  return ok([
    {
      type: 'item-equipped',
      id,
      item: itemId,
      ...(stamp === null ? {} : { command: stamp }),
    },
  ]);
}

/** Put something away. It stays owned: taking armour off is not selling it. */
export function unequipItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  const identity = identify(state, `unequip:${id}`, inputs);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
  if (!creature.equipped.includes(itemId)) {
    const item = itemFor(itemId);
    return err('not_equipped', `${item?.name ?? itemId} is not worn or wielded`);
  }

  return ok([
    { type: 'item-unequipped', id, item: itemId, ...(stamp === null ? {} : { command: stamp }) },
  ]);
}
