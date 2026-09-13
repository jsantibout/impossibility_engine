import {
  ABILITY_NAMES,
  err,
  needsContext,
  type ContextRequest,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type Err,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { bonusesFor, type Bonus, type ModeSource } from './bonuses.js';
import {
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
  reduceDamage,
  rollAttack,
  rollAttackDamage,
  type AttackDamage,
  type AttackResult,
  type DamageComponent,
  type DamageReduction,
  type ExtraDamage,
} from './attack.js';
import type { Weapon } from '@ie/srd';
import { expandPack, itemFor, type CatalogueItem, type ItemKind } from './catalogue.js';
import {
  areaPointAt,
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  creaturesInArea,
  distanceBetween,
  distanceBetweenPoints,
  distanceToPoint,
  isInsideScene,
  moveCreature,
  positionOf,
  sightBetween,
  snapToSpace,
  type Placement,
  type AreaOrigin,
  type AreaShape,
  type Point,
  type PointAnchoring,
  type PositionState,
} from './positioning.js';
import {
  DIRECTIONAL_AREAS,
  scaledDiceFor,
  scaledFlatFor,
  definitionFor,
  targetCountFor,
  type DelayedDamage,
  type RiderDuration,
  type SpellActivation,
  type SpellArea,
  type SpellCheck,
  type SpellDefinition,
  type SpellEffect,
  type ReactionTrigger,
  type SpellRange,
} from './spell-definitions.js';
import { routesFor, type CastingRoute, type SpellcastingState } from './spellcasting.js';
import { DODGE, DODGE_ACTION, READY, READY_ACTION } from './actions.js';
import {
  armorClassOf,
  attackedWithDisadvantage,
  defensesOf,
  effectiveConditions,
  checkFeatureDamageTypes,
  evadesHalfDamage,
  recoveryCap,
  selfHealAddend,
  type HealAmount,
  standingAttackDamage,
  standingInitiativeModes,
  standingSkillModes,
  standingSaveBonuses,
  standingSaveModes,
  type ActivatedFeature,
} from './standing.js';
import {
  interveneAfterRoll,
  rerollTest,
  rollAbilityCheck,
  rollSavingThrow,
  type D20TestKind,
  type D20TestResult,
} from './checks.js';
import {
  damageWindowOpen,
  offersForDamage,
  offersForTest,
  reactionAddends,
  reactionFeatureOf,
  type ReactionAmount,
  type ReactionFeature,
  type ReactionOffer,
  type ReactionOpportunity,
  type SpellReactionWindow,
} from './reactions.js';
import type { Rng } from './dice.js';
import { rollRecorded, type RollIssuer } from './rolls.js';
import {
  conditionInstanceId,
  conditionSpeed,
  hasCondition,
  isIncapacitated,
  reasonsFor,
  type CheckContext,
  type ConditionState,
} from './conditions.js';
import {
  endOfNextTurn,
  isDue,
  resolveDuration,
  startOfNextTurn,
  timeView,
  type Deadline,
  type Duration,
  type EffectCheck,
  type EffectTarget,
  type PendingSave,
  type RepeatSave,
  type ScheduledDamage,
  type TimedEffect,
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
  type PendingCasting,
  type PendingDamage,
  type PendingMove,
  type PendingTest,
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
  type AreaMoment,
  type CastingNumbers,
  type CastingTime,
  type ConcentrationCheck,
  type ConcentrationEndReason,
  type OngoingSpell,
  type OwedAreaEffect,
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
 */
const unknownCreature = (id: CharacterId, detail = 'is not in this game') =>
  needsContext('unknown_creature', `${id} ${detail}`, [
    {
      kind: 'creature',
      subject: id,
      need: `a record for ${id}`,
      because: 'the command names a creature the engine has never been told about',
      satisfyWith: `a creature-added event for ${id}`,
    },
  ]);

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
  const identity = identify(state, `damage:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

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
  const identity = identify(state, `exhaustion:${id}`, { ...command, level });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

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
    return unknownCreature(id);
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

  // A caster who leaves mid-casting takes the casting with them. Nothing else
  // could settle it — `resolveDeclaredCast` is addressed to them — and the
  // slot was never spent, so the spell simply never happened. That is the
  // honest record, and it is the same one an interruption writes.
  const casting = state.pendingCasting;
  if (casting !== null && casting.caster === id) {
    events.push({
      type: 'spell-interrupted',
      castingId: casting.castingId,
      id: casting.caster,
      by: null,
      reason: 'caster-left',
    });
  }

  // A held hit needs both parties: one to roll the damage and one to take it.
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
  command: CommandIdentity = {},
  /**
   * A check the affected creature may attempt to shake it off.
   *
   * Ninth and last, appended rather than folded into an options object,
   * because `applyConditionTo` is a DM-facing command whose existing call
   * sites should not have to move for a field none of them passes.
   */
  check?: EffectCheck,
): Result<GameEvent[]> {
  // "You are Frightened" is the state change a narrating layer reaches for
  // most, and a retried one was a second Frightened from the same source —
  // harmless to the condition set, which keys by source, but a second
  // `effect-scheduled` that reset its deadline.
  const identity = identify(state, `condition:${id}`, {
    ...command,
    condition,
    source,
    ...(duration === undefined ? {} : { duration }),
    ...(repeatSave === undefined ? {} : { repeatSave }),
    ...(check === undefined ? {} : { check }),
  });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  if (creatureOf(state, id) === null) {
    return unknownCreature(id);
  }
  if (immuneTo.includes(condition)) {
    return err('immune', `${id} is immune to the ${condition} condition`);
  }

  const events: GameEvent[] = [
    { type: 'condition-applied', id, condition, source, ...(stamp === null ? {} : { command: stamp }) },
  ];

  // A hook needs a timer to hang on, even when the effect has no deadline of
  // its own: an indefinite one is still the thing the boundary looks at. A
  // check is the same — Black Tentacles lasts as long as its casting and has
  // no deadline of its own, and the escape still has to be attemptable.
  if (duration === undefined && (repeatSave !== undefined || check !== undefined)) {
    events.push({
      type: 'effect-scheduled',
      target: { kind: 'condition', on: id, instance: conditionInstanceId(condition, source) },
      deadline: { kind: 'indefinite' },
      ...(repeatSave === undefined ? {} : { repeatSave }),
      ...(check === undefined ? {} : { check }),
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
      check,
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
/**
 * Whether the moment a Reaction spell answers has actually arrived.
 *
 * SRD writes a Reaction's casting time as a clause, and the clause is a rule:
 * "Reaction, which you take **when you are hit by an attack roll**". The
 * engine has spent the Reaction correctly since the action economy landed and
 * checked nothing about the moment, so a Shield cast in an empty corridor cost
 * the same slot and the same Reaction as one cast into a swinging sword.
 *
 * The window is the held attack — `pendingAttack`, which exists because a
 * Divine Smite had to land between an attack's two rolls, and which is exactly
 * the state Shield needs: a hit that is known and not yet settled.
 */
function triggerRefusal(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  request: CastSpellRequest,
): Err | null {
  const trigger: ReactionTrigger | undefined = definition.trigger;

  switch (trigger) {
    case undefined:
      return null;

    case 'hit-by-attack': {
      const held = state.pendingAttack;
      if (held !== null && held.target === casterId) return null;
      return err(
        'no_trigger',
        `${definition.name} is a Reaction taken when you are hit by an attack roll, and no attack on ${casterId} is waiting to be settled`,
      );
    }

    case 'damaged-by-creature': {
      const dealt = state.creatures[casterId]?.lastDamage ?? null;
      if (dealt === null) {
        return err(
          'no_trigger',
          `${definition.name} is a Reaction taken in response to taking damage from a creature, and nothing in this game has damaged ${casterId}`,
        );
      }

      // The window, read by the function the Barbarian's Retaliation reads:
      // "in response to" means immediately, and a turn is the finest grain the
      // engine has for it — the grain the one-slot-per-turn rule already uses.
      // Outside combat there are no turns, so the clock closes it instead.
      // Two clients, one reading; see `reactions.ts`.
      const hurt = damageWindowOpen(state, casterId);
      if (hurt === null) {
        return err(
          'no_trigger',
          `${definition.name} answers damage as it lands, and the moment ${dealt.by} damaged ${casterId} has passed`,
        );
      }

      // SRD: "**The creature that damaged you** is momentarily surrounded by
      // green flames." The target is forced, so a different one is refused
      // rather than quietly redirected — however obviously better a candidate
      // is standing next to them.
      if (request.targets.length !== 1 || request.targets[0] !== hurt.by) {
        return err(
          'no_trigger',
          `${definition.name} burns the creature that damaged you, which is ${hurt.by}`,
        );
      }
      return null;
    }

    case 'casting-a-spell': {
      const open = state.pendingCasting;
      if (open === null) {
        return err(
          'no_trigger',
          `${definition.name} is a Reaction taken when you see a creature casting a spell, and nobody is midway through a casting`,
        );
      }

      // SRD: "You attempt to interrupt **a creature in the process of casting
      // a spell**." The target is forced by the trigger, exactly as Hellish
      // Rebuke's is — there is only one casting open, and answering it is the
      // only thing this Reaction does. Aiming elsewhere is refused rather than
      // redirected.
      if (request.targets.length !== 1 || request.targets[0] !== open.caster) {
        return err(
          'no_trigger',
          `${definition.name} interrupts the creature that is casting, which is ${open.caster}`,
        );
      }
      return null;
    }

    default: {
      const unhandled: never = trigger;
      throw new Error(`no trigger rule for ${String(unhandled)}`);
    }
  }
}

/**
 * SRD Shield: "+5 bonus to AC, **including against the triggering attack**."
 *
 * The hit is re-measured against what the Armour Class has just become. Two
 * details decide it, and both are in the SRD rather than in anybody's
 * judgement — which is the reason this is the engine's to do at all:
 *
 * - **The delta is applied to the number the attack was actually measured
 *   against**, not to a freshly computed Armour Class. `targetAc` already has
 *   this attacker's cover folded into it, and recomputing would quietly drop
 *   it — the barrier would cancel the pillar.
 * - **A natural 20 hits regardless.** SRD: a 20 "hits regardless of any
 *   modifiers or the target's AC", so no bonus turns one aside.
 *
 * Closing the hold is the existing `attack-damage-dealt`, which is what a hold
 * closing means — `settleHoldsInvolving` already uses it for an attack whose
 * damage is never rolled. No damage events go with it, and the Shield sitting
 * in the log immediately before says why.
 */
function deflectTriggeringAttack(
  before: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  events: readonly GameEvent[],
): readonly GameEvent[] {
  if (definition.trigger !== 'hit-by-attack') return [];

  const after = events.reduce(applyEvent, before);
  const held = after.pendingAttack;
  if (held === null || held.target !== casterId) return [];

  if (held.natural === 20) return [];

  const raised = held.targetAc + (armorClassOf(after, casterId) - armorClassOf(before, casterId));
  if (held.total >= raised) return [];

  return [{ type: 'attack-damage-dealt', attacker: held.attacker }];
}

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
  check?: EffectCheck,
): Result<GameEvent> {
  const deadline = resolveDuration({ elapsed: state.elapsed, combat: state.combat }, duration);
  if (!deadline.ok) return deadline;
  return ok({
    type: 'effect-scheduled',
    target,
    deadline: deadline.value,
    ...(repeatSave === undefined ? {} : { repeatSave }),
    ...(check === undefined ? {} : { check }),
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
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  const identity = identify(state, `temp-hp:${id}`, { ...command, amount });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  if (creatureOf(state, id) === null) {
    return unknownCreature(id);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return err('bad_amount', `temporary hit points must be a non-negative number, got ${amount}`);
  }
  return ok([
    { type: 'temporary-hp-granted', id, amount, ...(stamp === null ? {} : { command: stamp }) },
  ]);
}

// — declared facts ———————————————————————————————————————————————————————————

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
  const identity = identify(state, `declare-type:${id}`, { ...command, creatureType });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

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
): Result<GameEvent[]> {
  if (creatureOf(state, id) === null) {
    return unknownCreature(id);
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

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
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

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
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

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
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

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

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
  if (caster === null) return unknownCreature(id);

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
  if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

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
  // Walking on out of an area that has already caught you would leave the
  // engine owing a save against a Web the mover is no longer standing in.
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const mover = creatureOf(state, id);
  if (mover === null) return unknownCreature(id, 'has no record here yet; add it first');
  if (state.scene === null) return needsContext('no_scene', 'there is no scene to move within');

  const from = positionOf(state.scene, id);
  if (from === null) {
    return needsContext(
      'unplaced',
      `nobody has said where ${id} is standing, so there is nowhere to move from`,
      [
        {
          kind: 'position',
          subject: id,
          need: `where ${id} is standing`,
          because: 'a move is measured from where the mover starts',
          satisfyWith: `a creature-placed event for ${id}`,
        },
      ],
    );
  }

  // Resolve the destination through the same placement rules everything else
  // uses, so the move is measured on the lattice rather than in a straight line.
  const moved = moveCreature(state.scene, id, command.placement);
  if (!moved.ok) return moved;
  const to = positionOf(moved.value.state, id);
  if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);

  // The distance positioning itself measured, on the lattice, between volumes.
  const feet = moved.value.distance;

  // **A carried area sweeps, and a move of more than one space does not say
  // what it swept.** Checked before any cost, any budget and any Opportunity
  // Attack, so a move that needs its route stated costs nothing to ask about.
  const sweeping = sweptRoute(state, state.scene, moved.value.state);
  if (sweeping.length > 0) {
    return needsContext(
      'route_required',
      `${id} is carrying ${sweeping.length === 1 ? 'an area' : 'areas'} that catch every creature they move into, and a move of ${feet} feet crosses spaces nothing records; send the move again as single 5-foot steps`,
      sweeping,
    );
  }

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
    // Nobody is owed a swing, so this is the whole move and the stamp belongs
    // here. Without it the guard above computed a fingerprint that nothing
    // ever recorded: a retry moved the creature a second time, and an id
    // reused for different work was executed instead of refused.
    events.push({
      type: 'creature-moved',
      id,
      placement: command.placement,
      ...(command.forced === true ? { forced: true } : {}),
      ...(stamp === null ? {} : { command: stamp }),
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
  // Before the offer is checked, exactly as `declineOpportunity` does it: the
  // first run answered the offer and completed the move, so a retry finds no
  // `pendingMove` and used to come back `not_provoked` — telling the caller
  // they were never offered the swing that in fact landed. The guard has to
  // precede validation or it reports the first run's consequences instead of
  // the fact that it happened.
  const identity = identify(state, `opportunity:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], attack: null, unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

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
      // No id: this command owns the guard, and the same id fingerprinted
      // twice under two kinds would make the retry read as a reused id.
      // Same split as `releaseReady`, which guards the release and hands the
      // inner move no id of its own.
    },
    supply,
  );
  if (!swing.ok) return swing;

  const answered: GameEvent[] = [
    ...events,
    ...swing.value.events,
    {
      type: 'opportunity-answered',
      reactor,
      took: true,
      ...(stamp === null ? {} : { command: stamp }),
    },
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
  /**
   * Which damage type a feature that offers a choice deals on this hit.
   *
   * SRD Divine Strike is "Necrotic or Radiant damage (your choice)" and Primal
   * Strike "Cold, Fire, Lightning, or Thunder (choose when you hit)" — per
   * hit, so it cannot be settled on the sheet. Keyed by feature id.
   *
   * Naming no type declines the feature, which is what "you can cause" means;
   * naming one it does not offer is refused before anything is rolled.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
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
  /**
   * Who may answer the damage roll before it lands.
   *
   * Present and non-empty only when the hit opened a `damage-rolled` window,
   * which is exactly when some creature has a feature that could reduce it.
   * Then `damage` is absent, because none has been dealt yet and
   * {@link settleDamage} is what deals it.
   */
  readonly reactions?: readonly ReactionOffer[];
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

  // A second swing while the first one's damage is held would roll damage into
  // a window already holding some, and the reducer refuses a second
  // `damage-rolled` — better to say so here than to produce a corrupt log.
  if (state.pendingDamage !== null) {
    return err(
      'damage_pending',
      `damage rolled against ${state.pendingDamage.target} has not been settled; settle it first`,
    );
  }

  // And whatever this attacker has been caught by: swinging is acting.
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const attacker = creatureOf(state, id);
  if (attacker === null) return unknownCreature(id, 'has no record here yet; add it first');
  // Not a claim that no such creature exists. A DM who has just narrated a
  // second ogre out of the treeline has a real ogre; the engine has simply not
  // been told about it, and being told is all this refusal asks for.
  const victim = creatureOf(state, command.target);
  if (victim === null) {
    return unknownCreature(command.target, 'has no record here yet; add it first');
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

  // A damage type a feature does not offer is refused here, before the action
  // is spent and before a die is thrown — the same validate-before-rolling
  // rule the rest of the engine keeps.
  const legalTypes = checkFeatureDamageTypes(state, id, command.featureDamageTypes);
  if (!legalTypes.ok) return legalTypes;

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
    targetAc: armorClassOf(state, command.target) + coverAcBonus(cover),
    proficient: proficientWith(attacker.sheet, weapon),
    // SRD Improved Critical, off the attacker's own sheet rather than the
    // caller's hand: a Champion's 19 is a critical whoever is narrating.
    ...(attacker.sheet.criticalOn === undefined
      ? {}
      : { criticalOn: attacker.sheet.criticalOn }),
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
        total: attack.value.total,
        natural: attack.value.roll.natural,
        mode: attack.value.roll.mode,
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
    weapon,
    mode: attack.value.roll.mode,
    target: command.target,
    turn: state.combat?.turnsTaken ?? null,
    ...(command.featureDamageTypes === undefined
      ? {}
      : { featureDamageTypes: command.featureDamageTypes }),
  });
  unverified.push(...fromFeatures.unverified);

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

  // A once-per-turn feature that rode on this hit has now used its allowance.
  // Recorded before the damage, so a log read forwards never shows the damage
  // of a feature whose use had not yet been written down.
  for (const feature of fromFeatures.spent) {
    events.push({ type: 'feature-used', id, feature, turn: state.combat?.turnsTaken ?? 0 });
  }

  const after = events.reduce(applyEvent, state);
  const hurt = landDamage(
    after,
    command.target,
    rolled.value.components,
    weapon?.name ?? 'Unarmed Strike',
    supply,
    { by: id, fromAttack: true, ...(attack.value.critical ? { critical: true } : {}) },
  );
  if (!hurt.ok) return hurt;

  return ok({
    events: [...events, ...hurt.value.events],
    attack: attack.value,
    ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
    ...(hurt.value.concentration === undefined
      ? {}
      : { concentration: hurt.value.concentration }),
    ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
    unverified: [...unverified, ...hurt.value.unverified],
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
 * How far a target is from where the attack actually comes from.
 *
 * **Actor and spatial origin are two different things**, and Spiritual Weapon
 * is the first mechanic in the engine that separates them: the Cleric rolls
 * and the force is what is standing next to the goblin. Given a point, that
 * point is the ruler's end; given none, the actor is, which is every other
 * attack in the book.
 *
 * The alternative — moving the caster to the force, or making the force a
 * creature — would have been two lies in state to avoid one optional
 * argument.
 */
function apartFromSource(
  state: GameState,
  from: Point | undefined,
  actor: CharacterId,
  target: CharacterId,
): number | null {
  if (from === undefined) return apartFrom(state, actor, target);
  if (state.scene === null) return null;
  const measured = distanceToPoint(state.scene, target, from);
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
  /**
   * The damage type a feature that offers a choice deals on this hit.
   *
   * The choice belongs to the moment the damage is rolled, which for a held
   * attack is here rather than when it landed. See the field of the same name
   * on {@link AttackCommand}.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
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
  if (attacker === null) return unknownCreature(id);

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
  const legalTypes = checkFeatureDamageTypes(current, id, command.featureDamageTypes);
  if (!legalTypes.ok) return legalTypes;

  const fromFeatures = standingAttackDamage(current, id, {
    ability: pending.ability,
    melee: rangeOf(weapon, pending.thrown) === null,
    weapon,
    // Recorded when the attack was held. Absent only in a log written before
    // the field existed, and none has one: `resolveAttack` always sets it.
    mode: pending.mode ?? 'normal',
    target: pending.target,
    turn: current.combat?.turnsTaken ?? null,
    ...(command.featureDamageTypes === undefined
      ? {}
      : { featureDamageTypes: command.featureDamageTypes }),
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

  // The same allowance the ordinary attack path spends, spent on the half of a
  // held attack that actually deals the damage.
  for (const feature of fromFeatures.spent) {
    events.push({ type: 'feature-used', id, feature, turn: current.combat?.turnsTaken ?? 0 });
  }

  const after = events.reduce(applyEvent, state);
  const hurt = landDamage(
    after,
    pending.target,
    rolled.value.components,
    weapon?.name ?? 'Unarmed Strike',
    supply,
    { by: pending.attacker, fromAttack: true, ...(pending.critical ? { critical: true } : {}) },
  );
  if (!hurt.ok) return hurt;

  return ok({
    events: [...events, ...hurt.value.events],
    attack: null,
    ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
    ...(hurt.value.concentration === undefined
      ? {}
      : { concentration: hurt.value.concentration }),
    ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
    unverified: [...hurt.value.unverified],
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

// — reactions ————————————————————————————————————————————————————————————————
//
// Four named windows, two of which are new here, and one shared idea beneath
// them: **an outcome that is known and has not yet been applied, held open for
// a finite list of creatures who may spend something to change it.**
//
// That shape is not invented. `pendingMove.provoked` has been exactly this
// since Opportunity Attacks landed — a list of creatures who were offered a
// Reaction, answered one at a time, with the thing they were holding up
// happening when the last one answers. What was missing was the two moments
// class features actually name: a damage roll that has not landed, and a D20
// Test whose effects have not occurred.
//
// See `reactions.ts` for the vocabulary and why it is a table of five members
// rather than a trigger language.

/** The damage roll waiting on its Reactions, if one is. */
export function pendingDamageOf(state: GameState): PendingDamage | null {
  return state.pendingDamage;
}

/** The D20 Test waiting on its Reactions, if one is. */
export function pendingTestOf(state: GameState): PendingTest | null {
  return state.pendingTest;
}

const rawDamageTotal = (components: readonly DamageComponent[]): number =>
  components.reduce((sum, c) => sum + Math.max(0, c.total), 0);

/** What the held damage currently comes to, after everything taken off so far. */
function heldDamageTotal(pending: PendingDamage): number {
  const taken = pending.reductions.reduce((sum, r) => sum + r.amount, 0);
  return Math.max(0, rawDamageTotal(pending.components) - taken);
}

/**
 * Spread a reduction across the damage types it came off.
 *
 * **SRD orders this and does not apportion it.** "Modifiers to damage are
 * applied in the following order: adjustments such as bonuses, penalties, or
 * multipliers are applied first; Resistance is applied second" — so a
 * reduction is an *adjustment* and lands before Resistance, which is
 * observable: 10 Fire against a fire-resistant target reduced by 7 is 1 in
 * that order and 0 in the other.
 *
 * What the SRD never says is which *type* a reduction comes off when an attack
 * deals two, because every worked example it gives has one. Uncanny Dodge
 * halves "the attack's damage", Deflect Attacks reduces "the attack's total
 * damage" — the total, which `applyDamage` cannot take as one number because
 * Resistance is per type.
 *
 * So the engine chooses, deterministically and in one place: **largest raw
 * amount first, ties broken by type name.** It is a choice rather than a rule,
 * which is why it is stated here rather than buried; what it buys is that the
 * pre-defence total is always right and nothing is ever apportioned into a
 * fraction.
 */
function adjustmentsFor(
  components: readonly DamageComponent[],
  reduction: number,
): Record<string, number> {
  const rawByType = new Map<string, number>();
  for (const component of components) {
    rawByType.set(
      component.type,
      (rawByType.get(component.type) ?? 0) + Math.max(0, component.total),
    );
  }

  const order = [...rawByType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const adjustments: Record<string, number> = {};
  let left = reduction;
  for (const [type, raw] of order) {
    if (left <= 0) break;
    const off = Math.min(left, raw);
    adjustments[type] = -off;
    left -= off;
  }
  return adjustments;
}

/**
 * Deal damage, unless somebody may answer it first.
 *
 * The single funnel for the weapon-attack path, and the one decision that
 * keeps an ordinary attack an ordinary attack: with no eligible reactor the
 * damage is dealt in the same breath it was rolled, the same events come out,
 * and no caller learns that a window exists. That is the rule `pendingMove`
 * already follows, where a move that provokes nobody simply happens.
 *
 * **Spell damage does not come through here**, and that is a stated limit
 * rather than an oversight: a spell rolls its damage once for every target it
 * caught, so holding one target's share open would mean holding the whole
 * casting open per target — a different debt entirely. Cutting Words can
 * therefore answer a sword and not a Fireball.
 */
function landDamage(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  source: string,
  supply: ConcentrationSaveSupply,
  options: {
    readonly critical?: boolean;
    readonly by?: CharacterId;
    readonly fromAttack?: boolean;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount?: number;
  readonly concentration?: ConcentrationConsequence;
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
}> {
  const possible = offersForDamage(state, {
    target,
    by: options.by ?? null,
    fromAttack: options.fromAttack === true,
    damageTypes: [...new Set(components.map((c) => c.type))].sort(),
  });

  if (possible.offers.length === 0) {
    const dealt = dealSpellDamage(state, target, components, source, supply, options);
    if (!dealt.ok) return dealt;
    return ok({
      events: dealt.value.events,
      amount: dealt.value.amount,
      concentration: dealt.value.concentration,
      offers: [],
      unverified: possible.unverified,
    });
  }

  const damage: PendingDamage = {
    target,
    by: options.by ?? null,
    source,
    components,
    critical: options.critical === true,
    fromAttack: options.fromAttack === true,
    reductions: [],
    offers: possible.offers,
  };

  return ok({
    events: [{ type: 'damage-rolled', damage }],
    offers: possible.offers,
    unverified: possible.unverified,
  });
}

/**
 * Spend what a reaction feature costs, or refuse.
 *
 * The Reaction is only spent **in combat** — outside it there is no economy,
 * the same reading `resolveCast`, `activateFeature` and `useSelfHeal` take.
 * The pool is spent either way, because a pool is not part of the economy.
 */
function spendReactionCost(
  state: GameState,
  reactor: CharacterId,
  creature: CreatureState,
  feature: ReactionFeature,
): Result<GameEvent[]> {
  const events: GameEvent[] = [];

  if (feature.costsReaction) {
    if (state.combat !== null && state.combat.budgets[reactor] !== undefined) {
      const spent = spendReaction(state.combat, reactor, creature.conditions);
      if (!spent.ok) return spent;
      events.push({ type: 'reaction-spent', id: reactor });
    } else if (isIncapacitated(creature.conditions)) {
      // Outside combat there is no Reaction to spend and `spendReaction` is
      // never asked, but SRD Incapacitated still forbids taking one.
      return err('incapacitated', `${reactor} is Incapacitated and can't take a Reaction`);
    }
  }

  if (feature.pool !== null) {
    if (remaining(creature.resources, feature.pool) < 1) {
      return err('exhausted', `${reactor} has no uses of ${feature.name} left`);
    }
    events.push({ type: 'resource-spent', id: reactor, key: feature.pool, amount: 1 });
  }

  return ok(events);
}

/** Every named contribution a reaction's amount made, for the audit trail. */
function reactionContributions(
  amount: ReactionAmount,
  abilities: Readonly<Record<Ability, number>>,
  dieTotal: number,
  halved: number,
): { readonly source: string; readonly amount: number }[] {
  const parts: { source: string; amount: number }[] = [];
  if (amount.dice !== undefined) parts.push({ source: amount.dice, amount: dieTotal });
  if (amount.halve === true) parts.push({ source: 'halved', amount: halved });
  for (const addend of amount.plus ?? []) {
    parts.push({
      source: addend.label,
      amount: reactionAddends({ plus: [addend] }, abilities).total,
    });
  }
  return parts;
}

export interface DamageReactionCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Passing on a window.
 *
 * An offer is a (reactor, feature) pair, so a creature holding two features
 * in one window may let one lapse and keep the other — a Fighter / Fiend
 * Warlock declining Indomitable still has Dark One's Own Luck to add. Naming
 * no feature passes on every offer this creature holds, which is what
 * ignoring the trigger altogether means.
 */
export interface DeclineReactionCommand extends CommandIdentity {
  readonly feature?: string;
}

export interface ReactionResolution {
  readonly events: readonly GameEvent[];
  /** What came off the damage, when something did. */
  readonly reduction?: DamageReduction;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * Take a Reaction against a damage roll that has not landed.
 *
 * SRD Uncanny Dodge, Deflect Attacks and Cutting Words. The three differ in
 * every number and agree on the shape, which is what makes this one command:
 * spend what the feature costs, roll what it says, and take that off the
 * total — leaving the damage itself to {@link settleDamage}, so there is
 * exactly one place that decides what the target finally takes.
 *
 * **The amount comes off the total, never off a component.** A reduction is not
 * damage of any type, and subtracting it from the slashing half of a flaming
 * sword would give a fire-immune target the wrong answer — the same reasoning
 * that put `reductions` beside the components rather than inside them.
 */
export function takeDamageReaction(
  state: GameState,
  reactor: CharacterId,
  command: DamageReactionCommand,
  supply: ConcentrationSaveSupply,
): Result<ReactionResolution> {
  // Before the offer is checked, exactly as `takeOpportunityAttack` does it: a
  // retry arrives at a window its own first run has already answered, and
  // reporting "you were not offered that" for a Reaction that in fact landed
  // is the confusion command ids exist to prevent.
  const identity = identify(state, `damage-reaction:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok({ events: [], duplicate: true });
  const stamp = identity.value.stamp;

  const pending = state.pendingDamage;
  if (pending === null) {
    return err('no_pending_damage', `no damage roll is waiting for ${reactor} to answer`);
  }
  if (!pending.offers.some((o) => o.reactor === reactor && o.feature === command.feature)) {
    return err('not_offered', `${reactor} was not offered ${command.feature} against this damage`);
  }

  const feature = reactionFeatureOf(state, reactor, command.feature, 'damage-rolled');
  if (feature === null || feature.does.kind !== 'reduce-damage') {
    return err('no_such_feature', `${reactor} has no damage Reaction called ${command.feature}`);
  }

  const creature = creatureOf(state, reactor);
  if (creature === null) return unknownCreature(reactor);

  // Nothing is rolled until every refusal has had its say, so a refused
  // reaction costs neither a use nor a turn of the generator.
  const spent = spendReactionCost(state, reactor, creature, feature);
  if (!spent.ok) return spent;
  const events: GameEvent[] = [...spent.value];

  const issuedBefore = supply.issuer.count;
  const held: AttackDamage = {
    components: pending.components,
    critical: pending.critical,
    reductions: pending.reductions,
    total: heldDamageTotal(pending),
  };
  const amount = feature.does.amount;
  const addends = reactionAddends(amount, creature.sheet.abilities);
  // SRD Uncanny Dodge: "halve the attack's damage against you (**round
  // down**)". What is taken off is therefore the upper half, which is what
  // makes an odd total round the target's way.
  const halved = held.total - Math.floor(held.total / 2);
  const flat = amount.halve === true ? halved : addends.total;

  const reduced = reduceDamage(supply.issuer, supply.rng, held, {
    source: feature.name,
    flat,
    ...(amount.dice === undefined ? {} : { dice: amount.dice }),
  });
  if (!reduced.ok) return reduced;

  const applied = reduced.value.reductions[reduced.value.reductions.length - 1];
  if (applied === undefined) {
    throw new Error(`${feature.name} recorded no reduction; reduceDamage always records one`);
  }

  events.push({
    type: 'roll-recorded',
    who: reactor,
    label: feature.name,
    natural: applied.roll?.total ?? 0,
    total: applied.amount,
    contributions: reactionContributions(
      amount,
      creature.sheet.abilities,
      applied.roll?.total ?? 0,
      halved,
    ),
    outcome: `${applied.amount} damage prevented`,
  });

  events.push({
    type: 'damage-reaction-answered',
    reactor,
    took: true,
    feature: feature.feature,
    reduction: applied,
    ...(stamp === null ? {} : { command: stamp }),
  });

  if (supply.issuer.count > issuedBefore) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  return ok({ events, reduction: applied, duplicate: false });
}

/**
 * Pass on a Reaction that was offered against a damage roll.
 *
 * Costs nothing and keeps the Reaction — SRD is explicit that ignoring a
 * trigger is free — but the offer is spent, so it cannot be taken later.
 */
export function declineDamageReaction(
  state: GameState,
  reactor: CharacterId,
  command: DeclineReactionCommand = {},
): Result<GameEvent[]> {
  const identity = identify(state, `decline-damage-reaction:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const pending = state.pendingDamage;
  if (pending === null) {
    return err('no_pending_damage', `no damage roll is waiting for ${reactor} to answer`);
  }
  const held = (o: ReactionOffer): boolean =>
    o.reactor === reactor && (command.feature === undefined || o.feature === command.feature);
  if (!pending.offers.some(held)) {
    return err(
      'not_offered',
      `${reactor} was not offered ${command.feature ?? 'a Reaction'} against this damage`,
    );
  }

  return ok([
    {
      type: 'damage-reaction-answered',
      reactor,
      took: false,
      ...(command.feature === undefined ? {} : { feature: command.feature }),
      ...(stamp === null ? {} : { command: stamp }),
    },
  ]);
}

export interface SettledDamage {
  readonly events: readonly GameEvent[];
  /** What the target actually took, after the reactions and their defences. */
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
  readonly duplicate: boolean;
}

/**
 * Close the window and deal what is left.
 *
 * **This is what settles the debt, including when nobody reacts.** Any offer
 * still outstanding is recorded as passed — the engine does not wait forever
 * for a decision nobody is going to make, and it does not take the decision
 * either: whether an NPC wants to spend its Reaction is Maestro's call, and
 * calling this is how Maestro says "nobody is".
 *
 * Settlement is its own command rather than something the last answer does by
 * itself, which is the opposite choice from `pendingMove` and deliberate: the
 * damage is a *number* the reactions changed, so there is exactly one place
 * that computes it, one command id that guards it, and one refusal when the
 * turn tries to move on without it.
 */
export function settleDamage(
  state: GameState,
  supply: ConcentrationSaveSupply,
  command: CommandIdentity = {},
): Result<SettledDamage> {
  const identity = identify(state, 'settle-damage', command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], amount: 0, concentration: { kind: 'none' }, duplicate: true });
  }
  const stamp = identity.value.stamp;

  const pending = state.pendingDamage;
  if (pending === null) return err('no_pending_damage', 'no damage roll is waiting to be dealt');

  // Everyone who never answered is recorded as having passed. Their Reaction
  // is untouched — ignoring a trigger costs nothing. One pass per **offer**,
  // each naming its feature: an offer is a (reactor, feature) pair, and a
  // creature holding two features in this window owes two answers.
  const events: GameEvent[] = pending.offers.map((offer) => ({
    type: 'damage-reaction-answered' as const,
    reactor: offer.reactor,
    took: false,
    feature: offer.feature,
  }));

  events.push({
    type: 'damage-settled',
    target: pending.target,
    // The stamp rides here because this event always happens — a settlement
    // that deals nothing still closes the window, where the damage event that
    // follows could in principle be a zero nobody notices.
    ...(stamp === null ? {} : { command: stamp }),
  });

  const reduction = pending.reductions.reduce((sum, r) => sum + r.amount, 0);
  const adjustments = adjustmentsFor(pending.components, reduction);
  const applied = applyDamage(pending.components, defensesOf(state, pending.target), adjustments);

  const dealt = resolveDamage(
    state,
    pending.target,
    {
      amount: applied.total,
      source: pending.source,
      ...(pending.critical ? { critical: true } : {}),
      ...(pending.by === null ? {} : { by: pending.by }),
    },
    supply,
  );
  if (!dealt.ok) return dealt;

  const all = [...events, ...dealt.value.events];

  return ok({
    // A move that was waiting on an Opportunity Attack whose damage was held
    // can go through now. Nothing else completes it: the command that answered
    // the Reaction left the damage open, and a mover must not arrive before
    // the blow aimed at them leaving has landed.
    events: [...all, ...completeIfSettled(state, all)],
    amount: applied.total,
    concentration: dealt.value.concentration,
    duplicate: false,
  });
}

export interface TestCommand extends CommandIdentity {
  readonly kind: D20TestKind;
  readonly ability: Ability;
  readonly skill?: Skill;
  readonly dc: number;
  /** What the roll is for, in the caller's words: "vs the pit trap". */
  readonly label?: string;
  /** Advantage or Disadvantage the table knows about and the engine cannot see. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  readonly bonuses?: readonly Bonus[];
  /**
   * Which senses this attempt leans on.
   *
   * A fact about the attempt, never a result — SRD Blinded "automatically
   * fails an ability check that requires sight", and only the table knows
   * whether this one does. The same field, for the same reason, as
   * {@link EffectCheckCommand.senses}.
   */
  readonly senses?: CheckContext;
}

export interface TestResolution {
  readonly events: readonly GameEvent[];
  /** The roll, or null when this command id had already been applied. */
  readonly test: D20TestResult | null;
  /**
   * Who may push it before its effects occur.
   *
   * Empty is the ordinary case, and then the test is final the moment it comes
   * back: no window was opened and nothing has to be settled.
   */
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Roll an ability check or a saving throw for a creature.
 *
 * `rollAbilityCheck` and `rollSavingThrow` have been complete and correct since
 * the day they were written and reachable from **no command at all** except
 * from inside a spell's own resolution — the ninth instance in this codebase of
 * a pure function nothing calls. A DM asks for a check or a save constantly,
 * and the engine had no way to be asked.
 *
 * Everything derivable is derived: the modifier, proficiency, Expertise, the
 * armour penalties, the roller's conditions and the automatic failures they
 * impose, the exhaustion penalty, and the bonuses a feature or a running spell
 * has put on this creature. What the caller says is what the engine cannot see
 * — a situational Advantage, a DC, and which senses the attempt uses.
 *
 * **It holds the result open when somebody can push it.** SRD Dark One's Own
 * Luck names the window in one clause — "after seeing the roll but before any
 * of the roll's effects occur" — and Indomitable, Peerless Skill and Cutting
 * Words all live in it. With nobody eligible the test is final on return and
 * no window exists, exactly as an unanswerable damage roll simply lands.
 *
 * **What settlement means here is nothing**, deliberately. A standalone test's
 * consequence belongs to whoever asked for it; the engine owns the number. So
 * closing the window changes no state, which is the same honest answer
 * `SpellCheck.onSuccess: 'none'` gives rather than a stub.
 */
export function resolveTest(
  state: GameState,
  who: CharacterId,
  command: TestCommand,
  supply: ConcentrationSaveSupply,
): Result<TestResolution> {
  const identity = identify(state, `test:${who}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], test: null, offers: [], unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who);

  if (state.pendingTest !== null) {
    return err(
      'test_pending',
      `${state.pendingTest.who} has a D20 Test whose effects are still unsettled; settle it first`,
    );
  }

  if (!Number.isFinite(command.dc)) {
    return err('bad_dc', `${String(command.dc)} is not a Difficulty Class`);
  }

  const label =
    command.label ??
    `${ABILITY_NAMES[command.ability]} ${command.kind === 'saving-throw' ? 'save' : 'check'}`;

  const issuedBefore = supply.issuer.count;

  // Everything standing on this creature — a Paladin's aura, Bless, the
  // feature that grants Advantage on this very skill — read rather than
  // remembered, which is the rule every roll in this engine follows.
  const rolled =
    command.kind === 'saving-throw'
      ? (() => {
          const support = savingSupport(state, who, creature, command.ability, supply);
          return rollSavingThrow(supply.issuer, supply.rng, creature.sheet, command.ability, {
            dc: command.dc,
            conditions: support.conditions,
            modes: support.modes,
            bonuses: support.bonuses,
          });
        })()
      : rollAbilityCheck(supply.issuer, supply.rng, creature.sheet, command.ability, {
          dc: command.dc,
          ...(command.skill === undefined ? {} : { skill: command.skill }),
          conditions: effectiveConditions(state, who),
          modes: [
            ...(command.skill === undefined ? [] : standingSkillModes(state, who, command.skill)),
            ...(command.modes ?? []),
          ],
          ...(command.senses === undefined ? {} : { conditionContext: command.senses }),
          ...(command.bonuses === undefined ? {} : { bonuses: command.bonuses }),
        });
  if (!rolled.ok) return rolled;

  const events: GameEvent[] = [
    {
      ...recordD20Test(who, label, rolled.value, rolled.value.success ? 'success' : 'failure'),
      // On the roll, which happens whatever the outcome — the same reasoning
      // that stamps `resolveAttack` on the roll rather than on the damage a
      // miss never deals.
      ...(stamp === null ? {} : { command: stamp }),
    },
    { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
  ];

  const possible = offersForTest(state, {
    who,
    kind: command.kind,
    success: rolled.value.success,
  });

  if (possible.offers.length > 0) {
    events.push({
      type: 'test-rolled',
      test: { who, label, result: rolled.value, offers: possible.offers },
    });
  }

  return ok({
    events,
    test: rolled.value,
    offers: possible.offers,
    unverified: possible.unverified,
    duplicate: false,
  });
}

export interface TestReactionCommand extends CommandIdentity {
  readonly feature: string;
}

export interface TestReactionResolution {
  readonly events: readonly GameEvent[];
  /** The test as it now stands, or null when this command id had landed. */
  readonly test: D20TestResult | null;
  readonly duplicate: boolean;
}

/**
 * Push a D20 Test that has landed and not yet had its effects.
 *
 * Two shapes, and they are two SRD sentences rather than two designs:
 *
 * - **Add or subtract.** Dark One's Own Luck adds 1d10, Cutting Words
 *   subtracts the Bardic Inspiration die, Peerless Skill adds it to your own.
 *   One mechanism with a sign — the argument `interveneAfterRoll` already
 *   settled for itself when Bend Luck showed it could push either way.
 * - **Reroll.** Indomitable: "You **must use the new roll**", which is not
 *   take-the-better-of-two. `rerollTest` keeps the superseded number on the
 *   result, so a log still shows what was given up.
 *
 * **Whether it cost a Reaction is the feature's business, not this window's.**
 * Four of the five features here spend none at all — the SRD grants them as
 * bare permissions limited by a pool — and treating the window and the
 * action-economy cost as one thing is the commonest mistake about this corner
 * of the rules.
 */
export function takeTestReaction(
  state: GameState,
  reactor: CharacterId,
  command: TestReactionCommand,
  supply: ConcentrationSaveSupply,
): Result<TestReactionResolution> {
  const identity = identify(state, `test-reaction:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok({ events: [], test: null, duplicate: true });
  const stamp = identity.value.stamp;

  const pending = state.pendingTest;
  if (pending === null) {
    return err('no_pending_test', `no D20 Test is waiting for ${reactor} to answer`);
  }
  if (!pending.offers.some((o) => o.reactor === reactor && o.feature === command.feature)) {
    return err('not_offered', `${reactor} was not offered ${command.feature} against this roll`);
  }

  const feature = reactionFeatureOf(state, reactor, command.feature, 'test-rolled');
  if (feature === null || (feature.does.kind !== 'intervene' && feature.does.kind !== 'reroll')) {
    return err('no_such_feature', `${reactor} has no D20 Test Reaction called ${command.feature}`);
  }

  const creature = creatureOf(state, reactor);
  if (creature === null) return unknownCreature(reactor);

  const spent = spendReactionCost(state, reactor, creature, feature);
  if (!spent.ok) return spent;
  const events: GameEvent[] = [...spent.value];

  const issuedBefore = supply.issuer.count;
  const does = feature.does;

  let pushed: Result<D20TestResult>;
  if (does.kind === 'reroll') {
    const bonus = does.bonus;
    pushed = rerollTest(
      supply.issuer,
      supply.rng,
      pending.result,
      bonus === undefined
        ? undefined
        : {
            source: feature.name,
            flat: bonus.kind === 'level' ? bonus.level : modifierFor(creature.sheet, bonus.ability),
          },
    );
  } else {
    const addends = reactionAddends(does.amount, creature.sheet.abilities);
    pushed = interveneAfterRoll(supply.issuer, supply.rng, pending.result, {
      source: feature.name,
      direction: does.direction,
      ...(addends.total === 0 ? {} : { flat: addends.total }),
      ...(does.amount.dice === undefined ? {} : { dice: does.amount.dice }),
    });
  }
  if (!pushed.ok) return pushed;

  // SRD Peerless Skill: "On a failure, the Bardic Inspiration **isn't
  // expended**." The only feature here whose cost depends on whether it
  // worked, which is why the spend is decided after the new total is known.
  const refunded =
    does.kind === 'intervene' && does.refundedOnFailure === true && !pushed.value.success;
  const paid = refunded
    ? events.filter((e) => !(e.type === 'resource-spent' && e.key === feature.pool))
    : events;

  paid.push({
    ...recordD20Test(
      pending.who,
      `${pending.label} (${feature.name})`,
      pushed.value,
      pushed.value.success ? 'success' : 'failure',
    ),
  });

  paid.push({
    type: 'test-reaction-answered',
    reactor,
    took: true,
    feature: feature.feature,
    result: pushed.value,
    ...(stamp === null ? {} : { command: stamp }),
  });

  if (supply.issuer.count > issuedBefore) {
    paid.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  return ok({ events: paid, test: pushed.value, duplicate: false });
}

/** Pass on a Reaction offered against a D20 Test. Costs nothing. */
export function declineTestReaction(
  state: GameState,
  reactor: CharacterId,
  command: DeclineReactionCommand = {},
): Result<GameEvent[]> {
  const identity = identify(state, `decline-test-reaction:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const pending = state.pendingTest;
  if (pending === null) {
    return err('no_pending_test', `no D20 Test is waiting for ${reactor} to answer`);
  }
  const held = (o: ReactionOffer): boolean =>
    o.reactor === reactor && (command.feature === undefined || o.feature === command.feature);
  if (!pending.offers.some(held)) {
    return err(
      'not_offered',
      `${reactor} was not offered ${command.feature ?? 'a Reaction'} against this roll`,
    );
  }

  return ok([
    {
      type: 'test-reaction-answered',
      reactor,
      took: false,
      ...(command.feature === undefined ? {} : { feature: command.feature }),
      ...(stamp === null ? {} : { command: stamp }),
    },
  ]);
}

export interface SettledTest {
  readonly events: readonly GameEvent[];
  /** The final number, which is what the caller asked for in the first place. */
  readonly test: D20TestResult | null;
  readonly duplicate: boolean;
}

/**
 * Close a D20 Test window; anything still outstanding is recorded as passed.
 *
 * **Nothing mechanical happens**, and that is the point rather than a gap: the
 * engine owned the number and the table owns what it means. The window existed
 * so the number could be pushed, and it closes so the turn can move on.
 */
export function settleTest(
  state: GameState,
  command: CommandIdentity = {},
): Result<SettledTest> {
  const identity = identify(state, 'settle-test', command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok({ events: [], test: null, duplicate: true });
  const stamp = identity.value.stamp;

  const pending = state.pendingTest;
  if (pending === null) return err('no_pending_test', 'no D20 Test is waiting to be settled');

  const events: GameEvent[] = pending.offers.map((offer) => ({
    type: 'test-reaction-answered' as const,
    reactor: offer.reactor,
    took: false,
    feature: offer.feature,
  }));

  events.push({
    type: 'test-settled',
    who: pending.who,
    ...(stamp === null ? {} : { command: stamp }),
  });

  return ok({ events, test: pending.result, duplicate: false });
}

export interface DamageResponseCommand extends CommandIdentity {
  readonly feature: string;
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon?: string | null;
}

/**
 * Answer damage that has already landed.
 *
 * SRD Retaliation: "When you take damage from a creature that is within 5 feet
 * of you, you can take a Reaction to make one melee attack against that
 * creature." This is the third timing family and the one that proves the
 * architectural point in the other direction — **it needs no pending state at
 * all**. Everything is settled: the damage is applied, the hit points have
 * moved, and nothing the reactor does can change any of it. There is no
 * outcome being held open, so there is nothing to hold.
 *
 * What the window *is* here is two facts already in state — `lastDamage` and
 * the clock — read by the same helper that decides whether *Hellish Rebuke*
 * may be cast. One rule, one reading, a spell and a class feature.
 *
 * The attack goes through `resolveAttack` with `free: true`, so cover,
 * conditions, proficiency, reach and the target's defences all apply because
 * that command applies them — exactly as an Opportunity Attack does.
 */
export function takeDamageResponse(
  state: GameState,
  reactor: CharacterId,
  command: DamageResponseCommand,
  supply: ConcentrationSaveSupply,
): Result<AttackResolution> {
  const identity = identify(state, `damage-response:${reactor}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], attack: null, unverified: [], duplicate: true });
  }
  const stamp = identity.value.stamp;

  const feature = reactionFeatureOf(state, reactor, command.feature, 'damaged-by-creature');
  if (feature === null || feature.does.kind !== 'melee-attack') {
    return err('no_such_feature', `${reactor} has no Reaction called ${command.feature}`);
  }

  const creature = creatureOf(state, reactor);
  if (creature === null) return unknownCreature(reactor);

  // The same window *Hellish Rebuke* opens into, read by the same function.
  const hurt = damageWindowOpen(state, reactor);
  if (hurt === null) {
    return err(
      'no_trigger',
      `${feature.name} answers damage as it lands, and nothing has just damaged ${reactor}`,
    );
  }

  // SRD: "**that creature**". The target is forced by the trigger, exactly as
  // Hellish Rebuke's is — aiming it elsewhere is refused rather than quietly
  // redirected.
  const apart = state.scene === null ? null : distanceBetween(state.scene, reactor, hurt.by);
  const unverified: string[] = [];
  if (apart === null || !apart.ok) {
    return needsContext(
      'unplaced',
      `${feature.name} needs ${reactor} and ${hurt.by} to be standing somewhere before 5 feet means anything`,
      [
        {
          kind: 'position',
          subject: reactor,
          need: `where ${reactor} and ${hurt.by} are standing`,
          because: `${feature.name} answers a creature within ${feature.does.withinFeet} feet`,
          satisfyWith: 'placeCreature',
        },
      ],
    );
  }
  if (apart.value > feature.does.withinFeet) {
    return err(
      'out_of_range',
      `${hurt.by} is ${apart.value} feet away and ${feature.name} reaches ${feature.does.withinFeet}`,
    );
  }

  const spent = spendReactionCost(state, reactor, creature, feature);
  if (!spent.ok) return spent;
  const events: GameEvent[] = [...spent.value];

  const after = events.reduce(applyEvent, state);
  // No id of its own: this command owns the guard, and the same id
  // fingerprinted twice under two kinds would make the retry read as a reused
  // id. The same split `takeOpportunityAttack` and `releaseReady` make.
  const swing = resolveAttack(
    after,
    reactor,
    { target: hurt.by, weapon: command.weapon ?? null, free: true },
    supply,
  );
  if (!swing.ok) return swing;

  return ok({
    ...swing.value,
    events: [
      ...events,
      ...swing.value.events,
      // A `reaction-taken` rather than a stamp on one of the attack's own
      // events, for two reasons. The swing may miss, and a missed Reaction
      // must not be retryable; and this window has no other record that a
      // Reaction happened at all — no hold opened, nothing was held back —
      // so without it the log shows an attack out of turn and no reason for
      // it.
      {
        type: 'reaction-taken',
        reactor,
        window: 'damaged-by-creature',
        feature: feature.feature,
        against: hurt.by,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ],
    unverified: [...swing.value.unverified, ...unverified],
  });
}

/**
 * Every Reaction a creature could legally take right now, across every open
 * window.
 *
 * This is the half Maestro needs and the engine had none of. The trigger
 * machinery could *refuse* a Reaction taken at the wrong moment; nothing could
 * say a moment was open. A model that has to guess whether a *Shield* is
 * available will either never cast one or will try constantly and be refused,
 * and neither is a DM.
 *
 * **It transfers no mechanical authority.** Every entry is a fact the engine
 * already holds, and taking the opportunity goes through the command that
 * checks all of it again — this decides nothing and spends nothing. What it
 * does is let Maestro make the *choice* the rules give a creature (does this
 * NPC want to spend its Reaction?) without inventing the *trigger* that would
 * make the choice legal.
 *
 * Five windows, four sources:
 *
 * | Window | Where the opportunity comes from |
 * |---|---|
 * | `hit-by-attack` | a Reaction spell the target can cast — *Shield* |
 * | `damage-rolled` | the offers the engine computed when it held the damage |
 * | `test-rolled` | the offers the engine computed when it held the test |
 * | `damaged-by-creature` | a feature or a Reaction spell, against `lastDamage` |
 * | `casting-a-spell` | a Reaction spell somebody else can cast — *Counterspell* |
 *
 * Two of those read a list already in state and three derive one, and the
 * difference is exactly whether the window holds an outcome open. A window
 * that holds something had to know who could answer before it opened.
 *
 * **What it does not check**, and says so rather than over-reporting silently:
 * *Counterspell*'s 60 feet and line of sight, which `triggerRefusal` does not
 * check either because the engine has never modelled which castings a creature
 * perceives. A listed opportunity is legal as far as the engine can see.
 */
export function reactionOpportunities(state: GameState): readonly ReactionOpportunity[] {
  const found: ReactionOpportunity[] = [];

  const canReact = (who: CharacterId): boolean => {
    const creature = state.creatures[who];
    if (creature === undefined || creature.vitals.dead) return false;
    if (isIncapacitated(creature.conditions)) return false;
    if (state.combat === null) return true;
    return state.combat.budgets[who]?.reaction !== false;
  };

  /** Reaction spells this creature could cast for a given window. */
  const spellsFor = (who: CharacterId, window: SpellReactionWindow): ReactionOpportunity[] => {
    const creature = state.creatures[who];
    if (creature === undefined) return [];
    const known = [
      ...creature.spellcasting.classes.flatMap((c) => [...c.cantrips, ...c.prepared]),
      ...creature.spellcasting.granted.map((g) => g.spellId),
    ];
    return [...new Set(known)].sort().flatMap((spellId): ReactionOpportunity[] => {
      const definition = definitionFor(spellId);
      if (definition?.trigger !== window) return [];
      return [
        {
          window,
          reactor: who,
          id: spellId,
          name: definition.name,
          kind: 'spell',
          // SRD writes the casting time as "Reaction, which you take when…",
          // so the Reaction is always part of the cost.
          costsReaction: true,
          pool: null,
          against: null,
        },
      ];
    });
  };

  const attack = state.pendingAttack;
  if (attack !== null && canReact(attack.target)) {
    for (const chance of spellsFor(attack.target, 'hit-by-attack')) {
      found.push({ ...chance, against: attack.attacker });
    }
  }

  const casting = state.pendingCasting;
  if (casting !== null) {
    for (const key of Object.keys(state.creatures).sort()) {
      const who = key as CharacterId;
      if (who === casting.caster || !canReact(who)) continue;
      for (const chance of spellsFor(who, 'casting-a-spell')) {
        found.push({ ...chance, against: casting.caster });
      }
    }
  }

  // An offer in a pending record is who the engine asked when the window
  // opened. It can go stale — something else spent that creature's Reaction,
  // or drained the pool — and the commands re-check, so the query must too:
  // reporting an opportunity that would be refused is worse than reporting
  // none.
  const affordable = (offer: ReactionOffer): boolean => {
    if (!canReact(offer.reactor)) return false;
    if (offer.pool === null) return true;
    const creature = state.creatures[offer.reactor];
    return creature !== undefined && remaining(creature.resources, offer.pool) >= 1;
  };

  const damage = state.pendingDamage;
  if (damage !== null) {
    for (const offer of damage.offers.filter(affordable)) {
      found.push({
        window: 'damage-rolled',
        reactor: offer.reactor,
        id: offer.feature,
        name: offer.name,
        kind: 'feature',
        costsReaction: offer.costsReaction,
        pool: offer.pool,
        against: damage.by,
      });
    }
  }

  const test = state.pendingTest;
  if (test !== null) {
    for (const offer of test.offers.filter(affordable)) {
      found.push({
        window: 'test-rolled',
        reactor: offer.reactor,
        id: offer.feature,
        name: offer.name,
        kind: 'feature',
        costsReaction: offer.costsReaction,
        pool: offer.pool,
        against: test.who,
      });
    }
  }

  // The settled window. Nothing is held open, so the opportunity is derived
  // from `lastDamage` and the clock — the same two facts `damageWindowOpen`
  // reads for *Hellish Rebuke*.
  for (const key of Object.keys(state.creatures).sort()) {
    const who = key as CharacterId;
    const hurt = damageWindowOpen(state, who);
    if (hurt === null || !canReact(who)) continue;

    for (const feature of state.creatures[who]?.sheet.reactions ?? []) {
      if (feature.window !== 'damaged-by-creature') continue;
      if (feature.pool !== null && remaining(state.creatures[who]!.resources, feature.pool) < 1) {
        continue;
      }
      found.push({
        window: 'damaged-by-creature',
        reactor: who,
        id: feature.feature,
        name: feature.name,
        kind: 'feature',
        costsReaction: feature.costsReaction,
        pool: feature.pool,
        against: hurt.by,
      });
    }

    for (const chance of spellsFor(who, 'damaged-by-creature')) {
      found.push({ ...chance, against: hurt.by });
    }
  }

  return found;
}

// — ongoing spells ————————————————————————————————————————————————————————————
//
// A casting is history; what it left behind is live state. `state.ongoing`
// holds the second — see `OngoingSpell` in `spells.ts` for why each field is
// there and why none of the others are.

/**
 * The spells currently running on a creature, oldest casting first.
 *
 * SRD Dispel Magic's actual question: "Any ongoing spell ... **on the
 * target**". Sorted by casting id so two readers of the same state agree about
 * the order, which matters because Dispel Magic walks the list rolling checks.
 *
 * A pure query over live state: it looks nothing up in the log, searches no
 * history, and answers only what the rules ask for.
 */
export function ongoingSpellsOn(
  state: GameState,
  who: CharacterId,
): readonly OngoingSpell[] {
  return byCastingOrder(state).filter((record) => record.on.includes(who));
}

/** The spells this creature cast that are still running, oldest first. */
export function ongoingSpellsBy(
  state: GameState,
  caster: CharacterId,
): readonly OngoingSpell[] {
  return byCastingOrder(state).filter((record) => record.caster === caster);
}

/** One ongoing spell by the casting that made it, or null if it has ended. */
export function ongoingSpellOf(state: GameState, castingId: string): OngoingSpell | null {
  return state.ongoing[castingId] ?? null;
}

/**
 * Every ongoing spell, in the order the castings happened.
 *
 * Numerically, not lexically: `cast:2` runs before `cast:10`, and a string
 * sort would put ten first — which would silently reorder the checks Dispel
 * Magic rolls and make a replay of the same log produce different dice.
 */
function byCastingOrder(state: GameState): readonly OngoingSpell[] {
  return Object.values(state.ongoing).sort(
    (a, b) => castingNumber(a.castingId) - castingNumber(b.castingId),
  );
}

const castingNumber = (castingId: string): number =>
  Number(castingId.slice('cast:'.length)) || 0;

/**
 * Whether a casting is on its own caster rather than on whom it was aimed at.
 *
 * The SRD keeps Range and target apart and so does this. A Range: Self spell
 * is on its caster however far its effects reach — Vampiric Touch attacks
 * somebody new every turn and is on the wizard the whole time. Dispel Magic
 * reads the result, so getting this backwards would let a fighter end the
 * wizard's Vampiric Touch by standing still and being punched.
 */
function onCaster(definition: SpellDefinition): boolean {
  return definition.range.kind === 'self';
}

/**
 * Whether this casting leaves anything running.
 *
 * A duration or a Concentration, which is what "ongoing" means in the SRD's
 * own Duration line. Instantaneous spells leave nothing and get no record —
 * Fireball is history the moment it lands.
 */
function persists(definition: SpellDefinition): boolean {
  return (
    definition.concentration ||
    definition.durationSeconds !== undefined ||
    definition.durationUntil !== undefined
  );
}

/**
 * SRD Mage Hand: "The hand vanishes ... if you cast this spell again."
 *
 * The same caster, the same spell. A lookup over the live records rather than
 * a search through history, which is the difference the ongoing record makes:
 * before it, obeying this sentence meant scanning the log for a `spell-cast`
 * and then proving nothing had ended it since.
 */
function replacedCastings(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
): readonly GameEvent[] {
  if (definition.replacesPriorCasting !== true) return [];
  return ongoingSpellsBy(state, casterId)
    .filter((record) => record.spellId === definition.id)
    .map((record) => ({
      type: 'spell-ended' as const,
      castingId: record.castingId,
      on: null,
      reason: 'recast' as const,
    }));
}

export interface ActivateSpellCommand extends CommandIdentity {
  /** Which running casting to act through, from {@link ongoingSpellsBy}. */
  readonly castingId: string;
  /** Who it is aimed at this time. "The same creature or a different one." */
  readonly targets: readonly CharacterId[];
  /**
   * Where to move the point this casting holds, for a spell that may.
   *
   * SRD Spiritual Weapon: "you can **move the force up to 20 feet** and repeat
   * the attack against a creature within 5 feet of it." One Bonus Action does
   * both, which is why this is a field on the activation rather than a command
   * of its own — a second command would either charge a second Bonus Action or
   * charge none, and both are wrong.
   *
   * "Up to 20 feet" includes none of them, so it is optional. The engine owns
   * the allowance, the geometry and the identity of what is being moved; the
   * caller owns the destination.
   *
   * **Required** where the activation's whole content is the move — see
   * {@link SpellActivation.movesArea} — because a Magic action spent moving
   * nothing is not a thing SRD Moonbeam offers.
   */
  readonly to?: Point;
  /**
   * The spaces a moving **area** passed through on the way, in order.
   *
   * SRD Moonbeam moves its Cylinder "up to 60 feet" and makes every creature
   * the area arrives on save. Twelve spaces is far enough to pass clean over
   * somebody, and **the engine has no route to read**: two points do not imply
   * the line between them, and drawing one would be the engine inventing a
   * path nobody took — the same refusal `raiseAreaEntries` already makes about
   * a creature's own movement.
   *
   * So the route is the caller's to state, at whatever fidelity the fiction
   * has. Each consecutive pair is one authoritative relocation, written as its
   * own `spell-origin-moved`, and each is asked who the area arrived on. The
   * allowance caps the **sum** of the legs, which is what "up to 60 feet"
   * measures: a beam walked round three sides of a square has travelled all
   * three, however near where it started it ends up.
   *
   * Absent is one leg, which is exact when it is one space long and otherwise
   * says so in `unverified`. Not a path *finder*: nothing here searches,
   * smooths, interpolates or validates that consecutive waypoints are
   * adjacent — a waypoint is an authoritative fact the caller supplies, and a
   * caller who supplies none gets the honest gap instead.
   */
  readonly via?: readonly Point[];
}

/**
 * Use a spell that is still running, on a later turn.
 *
 * SRD Vampiric Touch: "Until the spell ends, you can make the attack again on
 * each of your turns as a Magic action, targeting the same creature or a
 * different one." Flame Blade writes the same sentence about a blade in your
 * hand. Both are the same shape and it is a narrow one: **the caster spends an
 * action and the spell does again what it already does.**
 *
 * What is pinned and what is fresh is the whole of the design:
 *
 * | Pinned at the casting | Read again now |
 * |---|---|
 * | the level it was cast at, so the dice do not grow | who it is aimed at |
 * | the route, so the attack modifier is the one it was cast with | the range to them |
 * | the caster — nobody else may act through it | their Armour Class, conditions, defences |
 *
 * **It is not generic scripting.** There is no trigger, no predicate and no
 * ordering: a definition names an action, a range and the effects the spell
 * already knows how to resolve, and this spends the one and runs the others.
 * The spells that need more — a force with its own position, moved twenty feet
 * before it strikes — are blocked on geometry, and are listed as such rather
 * than half-served here.
 */
export function activateSpell(
  state: GameState,
  casterId: CharacterId,
  command: ActivateSpellCommand,
  supply: ConcentrationSaveSupply,
): Result<SpellResolution> {
  // Before the casting is even looked up. A retry arrives after the first run
  // has already spent the action, and reporting "no such casting" for a
  // casting that has since ended would be the confusion command ids exist to
  // prevent.
  const identity = identify(state, `activate:${casterId}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    const already =
      command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return ok({
      events: [],
      castingId: already?.castingId ?? command.castingId,
      outcomes: [],
      unverified: [],
    });
  }
  const stamp = identity.value.stamp;

  // The same debts that stop a casting, read by the same function — an
  // activation is a Magic action taken into the world exactly as a casting
  // is, and a guard the casting path keeps that this one lacked let Vampiric
  // Touch strike while a damage roll against somebody was still held open.
  const unsettled = unsettledRefusal(state, casterId);
  if (unsettled !== null) return unsettled;

  // SRD Counterspell's window: while a casting is in process, the only thing
  // that may happen is the Reaction that answers it. Same rule `castOrRelease`
  // applies, with no exemption here because no activation is a Reaction.
  if (state.pendingCasting !== null) {
    return err(
      'casting_pending',
      `${state.pendingCasting.caster} is midway through casting ${state.pendingCasting.spell}; settle that casting before acting through another`,
    );
  }

  const record = state.ongoing[command.castingId];
  if (record === undefined) {
    return err(
      'not_ongoing',
      `${command.castingId} is not a spell that is still running`,
    );
  }

  // SRD: "**you** can make the attack again." A spell is not a thing lying
  // about for anyone to pick up, and this is the refusal that says so.
  if (record.caster !== casterId) {
    return err(
      'not_your_spell',
      `${command.castingId} is ${record.caster}'s casting; ${casterId} cannot act through it`,
    );
  }

  const caster = creatureOf(state, casterId);
  if (caster === null) return unknownCreature(casterId);

  const definition = definitionFor(record.spellId);
  if (definition?.activation === undefined) {
    return err(
      'no_activation',
      `${record.spell} is not a spell its caster can use again on a later turn`,
    );
  }
  const activation = definition.activation;

  // **The numbers the casting was made with**, off the record. Re-deriving
  // them from the caster's sheet is how a minute-old Vampiric Touch quietly
  // gets a better attack modifier because the wizard levelled between the
  // casting and the punch.

  // **An activation that only moves the area aims at nobody.** Not
  // `targets.optional`, which is Spiritual Weapon's "you **can** make one
  // melee spell attack" — a target that may be declined. Moonbeam's later
  // Magic action has no attack to decline, so a named target is a caller
  // asking the beam to do something it does not do.
  if (activation.movesArea !== undefined) {
    if (command.targets.length > 0) {
      return err(
        'wrong_target_count',
        `${record.spell}'s later action moves the area and strikes nobody, got ${command.targets.length} target(s)`,
      );
    }
  } else {
    const optional = definition.targets.optional === true;
    if (command.targets.length > 1 || (command.targets.length === 0 && !optional)) {
      return err(
        'wrong_target_count',
        `${record.spell} strikes one creature at a time, got ${command.targets.length}`,
      );
    }
  }
  const target = command.targets[0] ?? null;
  if (target !== null && creatureOf(state, target) === null) return unknownCreature(target);

  const unverified: string[] = [];

  // — the point moves first, and the attack is measured from where it ends —
  //
  // SRD orders it that way — "move the force up to 20 feet **and** repeat the
  // attack against a creature within 5 feet of it" — so a move that brings the
  // force into reach is the whole point of the action. Validated before
  // anything is spent, like everything else.
  const moved = relocateOrigin(state, record, definition, command);
  if (!moved.ok) return moved;
  const legs = moved.value;
  const origin = legs[legs.length - 1] ?? record.origin ?? null;

  // Checked afresh: the creature that was in reach a minute ago may not be.
  if (target !== null) {
    const checked =
      origin === null
        ? reachFromCaster(state, casterId, target, record, activation, unverified)
        : reachFromOrigin(state, target, origin, record, definition, unverified);
    if (checked !== null) return checked;
  }

  // Nothing is rolled until the action is known to be affordable — the same
  // validate-before-rolling rule casting itself obeys. Outside combat there is
  // no economy to spend.
  const events: GameEvent[] = [];
  let current = state;
  const happened = (event: GameEvent): void => {
    events.push(event);
    current = applyEvent(current, event);
  };

  const combat = state.combat;
  if (combat !== null && combat.budgets[casterId] !== undefined) {
    const spent =
      activation.action === 'bonus-action'
        ? spendBonusAction(combat, casterId, caster.conditions)
        : spendAction(combat, casterId, caster.conditions);
    if (!spent.ok) return spent;
    happened(
      activation.action === 'bonus-action'
        ? { type: 'bonus-action-spent', id: casterId }
        : { type: 'action-spent', id: casterId },
    );
  }

  // **Before its own content, not after it.** The stamp rides here because
  // this event always happens: the attack it runs may miss, and a missed
  // activation must not be retryable. What moved it *above* the movement is
  // that a beam can end its own casting halfway along — the caster walks it
  // onto themselves, fails the save, and loses Concentration — and the history
  // still has to say the caster took Moonbeam's later Magic action. An event
  // recording that, written after the casting it names has gone, would be the
  // log arriving in the wrong order.
  happened({
    type: 'spell-activated',
    castingId: record.castingId,
    by: casterId,
    ...(stamp === null ? {} : { command: stamp }),
  });

  // — the route, one leg at a time —————————————————————————————————————————
  //
  // SRD Moonbeam: a creature makes the save "when the spell's area moves into
  // its space" — **at that point in the route**, not once the whole sweep is
  // over. The difference is observable and it is not a subtlety: a beam walked
  // onto its own concentrating caster can break that Concentration, and a
  // spell that has ended does not go on to its next waypoint.
  //
  // So each leg is moved, settled, and only then followed by the next. The
  // settlement is `settleAreaEffects` — the same command a turn boundary and a
  // creature's own move already use, reached with the generator this action
  // already holds, so no second resolver exists and no caller supplies a save,
  // a DC, a damage roll or a Concentration decision.
  const outcomes: SpellTargetOutcome[] = [];
  let reached = record.origin ?? null;
  for (const space of legs) {
    // The casting ended on the leg before this one. Not an error and not a
    // rollback: the action was spent, the beam moved, and what it did to the
    // caster is why there is nothing left to move.
    if (current.ongoing[record.castingId] === undefined) break;

    happened({ type: 'spell-origin-moved', castingId: record.castingId, to: space });
    reached = space;

    // Everything this leg raised, in the deterministic order settlement
    // already imposes. No command id: this is not a caller's settlement and
    // must not consume one — the activation's own stamp is the retry guard for
    // the whole action, movement and consequences together.
    const settled = settleAreaEffects(current, supply);
    if (!settled.ok) return settled;
    for (const event of settled.value.events) happened(event);
    outcomes.push(...settled.value.outcomes);
    unverified.push(...settled.value.unverified);
  }

  // The activation's own effects, from where the area actually ended up. The
  // caster is re-read: a route that ended its own casting may have ended the
  // caster too, and `resolveEffects` is explicit about a caster who has gone.
  const resolved = resolveEffects(state, casterId, creatureOf(current, casterId), definition, {
    // The level the casting was made at. A wizard who gained a level since
    // does not upcast a spell already in the air.
    castLevel: record.level,
    route: null,
    numbers: record.numbers,
    targets: target === null ? [] : [target],
    unverified,
    supply,
    castingId: record.castingId,
    events,
    effects: activation.effects,
    label: activation.label,
    ...(reached === null ? {} : { from: reached }),
  });
  if (!resolved.ok) return resolved;

  // What the route did on the way is part of what the action did. Ordered
  // before the activation's own effects because it happened before them.
  return ok({
    ...resolved.value,
    outcomes: [...outcomes, ...resolved.value.outcomes],
  });
}

/**
 * The carried areas this move would sweep across spaces nobody named.
 *
 * **The same hole Moonbeam's route had, arriving from the other direction.**
 * There the caller asked to move an area thirty feet; here they ask to move a
 * *creature*, and the area comes along because SRD says an Emanation "moves
 * with the creature or object that is its origin". Either way the engine knows
 * two endpoints and no route, and either way the creatures who would be caught
 * are the ones who did nothing.
 *
 * So the answer is the same answer: ask. A move of one space has no space in
 * between to be unknown; anything longer is a `needs-context` naming the
 * casting, the carrier, both ends and what to send instead. Nothing is spent
 * while it waits — no Speed, no Opportunity Attack, no die.
 *
 * **Reuses the movement the engine already has rather than a route field.** A
 * creature move is already authoritative, already segmentable, and already
 * settles what it raised before the next voluntary action — the global
 * area-debt guard sees to that. A `MovePath` here would have been a second
 * mechanism for something movement can already express, built for symmetry
 * with Moonbeam rather than because a rule asked.
 *
 * Reads the carrier by **position change**, never by the id on the command: a
 * cleric carried by their horse moves on an event that names only the horse.
 */
function sweptRoute(
  state: GameState,
  before: PositionState,
  after: PositionState,
): readonly ContextRequest[] {
  const requests: ContextRequest[] = [];

  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;

    const definition = definitionFor(record.spellId);
    const area = definition?.area;
    // Only an area that is carried, and only one a rule watches as it travels.
    if (area === undefined || area.origin !== 'self') continue;
    if (definition?.areaTrigger?.onAreaEntry !== true) continue;

    const from = before.positions[record.caster];
    const to = after.positions[record.caster];
    if (from === undefined || to === undefined) continue;

    const travelled = distanceBetweenPoints(from, to);
    if (travelled <= SPACE) continue;

    requests.push({
      kind: 'route',
      subject: castingId,
      need: `which 5-foot spaces ${record.caster} passed through between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) — ${travelled} feet, carrying ${record.spell}`,
      because: `${record.spell} catches every creature its area moves into, and the spaces between two points are not something the engine may decide`,
      satisfyWith: `resolveMove again as ${travelled / SPACE} moves of one space each, settling what each raises before the next`,
    });
  }

  return requests;
}

/**
 * One space on the lattice, in feet.
 *
 * SRD: "Each square represents 5 feet." The only thing this is used for here
 * is deciding whether a leg of an area's route had anything *between* its
 * endpoints: a step to an adjacent space has no cube in between and is exact,
 * and anything longer does.
 */
const SPACE = 5;

/**
 * Every place the casting's point was during this activation, in order.
 *
 * **A spell-origin move is not creature movement, and nothing here makes it
 * one.** The rules a creature's move obeys are absent because the SRD never
 * applies them to the force: no Speed is spent, no Difficult Terrain is
 * charged, no Opportunity Attack is provoked, no space is occupied and nothing
 * ends up Prone for sharing one. Routing it through `moveCreature` to reuse
 * the geometry would have imported every one of those.
 *
 * What the engine does own is the whole of what SRD prints: the allowance in
 * feet, measured from where the point is **now**; the scene it has to stay
 * inside; and the identity of the casting being moved, which the caller named
 * and the command has already checked belongs to them.
 *
 * **A list rather than a destination, because a moving *area* makes the route
 * observable.** Twenty feet of beam passes over the space in between, and two
 * points do not imply the line between them — so each leg the caller states is
 * an authoritative relocation of its own, and a leg the caller did not break
 * up says in `unverified` that nothing records what it crossed. For a point
 * nothing triggers on, the route is unobservable and one leg is the whole
 * answer, which is every Spiritual Weapon and why nothing there changed.
 *
 * Empty when this activation moved nothing — an ordinary later-turn spell like
 * Vampiric Touch — which leaves the reach check measuring from the caster.
 */
function relocateOrigin(
  state: GameState,
  record: OngoingSpell,
  definition: SpellDefinition,
  command: ActivateSpellCommand,
): Result<readonly Point[]> {
  const current = record.origin ?? null;

  // **Two sentences, two allowances.** Spiritual Weapon's is a rider on a
  // Bonus Action that also strikes, so declining it is legal; Moonbeam's is
  // the Magic action's entire content, so declining it spends an action on
  // nothing. Which one this is decides both the number and whether `to` may
  // be left out.
  const asAction = definition.activation?.movesArea;
  const asRider = definition.origin?.movableBy;
  const allowance = asAction ?? asRider;

  if (command.to === undefined) {
    if (asAction !== undefined) {
      return err(
        'destination_required',
        `${record.spell}'s later action is moving the area; name where it goes`,
      );
    }
    if (command.via !== undefined && command.via.length > 0) {
      return err(
        'destination_required',
        `${record.spell} was given a route with nowhere to end`,
      );
    }
    return ok([]);
  }

  if (current === null || allowance === undefined) {
    return err(
      'not_movable',
      `${record.spell} holds nothing its caster can move`,
    );
  }
  if (state.scene === null) {
    return err('no_scene', `${record.spell} needs a scene to be moved about in`);
  }

  const legs = [...(command.via ?? []), command.to].map(snapToSpace);

  for (const space of legs) {
    if (!isInsideScene(state.scene, space)) {
      return err(
        'outside_scene',
        `${record.spell} cannot be moved to (${space.x}, ${space.y}, ${space.z}); that is outside this scene`,
      );
    }
  }

  // From where it is, not from where it started and not from the caster. A
  // force may be walked steadily further away than the spell's own Range,
  // which is exactly what "move the force up to 20 feet" says and what a
  // re-check against the caster would wrongly forbid.
  //
  // **The sum of the legs, not the displacement.** "Up to 60 feet" is a
  // distance travelled, so a route that doubles back spends what it walked
  // rather than what it achieved. With no waypoints the two are the same
  // number and every existing caller is untouched.
  let travelled = 0;
  let at = current;
  for (const space of legs) {
    travelled += distanceBetweenPoints(at, space);
    at = space;
  }
  if (travelled > allowance) {
    return err(
      'origin_too_far',
      `${record.spell} moves up to ${allowance} feet; that route is ${travelled} long`,
    );
  }

  // **What a leg cannot prove, and why that is a question rather than a
  // warning.** The engine knows the area was here and then there; it does not
  // know what it passed over. A leg longer than one space has spaces in
  // between that no fact in the log names, and there are only three things to
  // do about that: draw a line the engine was never told about, execute the
  // move while silently skipping whoever it crossed, or **ask**.
  //
  // The first two are the same failure in different clothes — the engine
  // answering a question nobody asked it. So this asks, through the mechanism
  // the engine already has for a thin record: nothing is spent, no die is
  // thrown, and the same activation sent again with the route filled in is the
  // activation the caller meant the first time.
  //
  // Only where a rule reads the route. A casting whose area triggers on
  // nothing as it travels has no route to be wrong about, which is every
  // Spiritual Weapon — and giving it this requirement because Moonbeam has it
  // would be a neighbouring spell's clause lending it a rule again.
  if (definition.areaTrigger?.onAreaEntry === true) {
    const coarse: ContextRequest[] = [];
    let previous = current;
    for (const space of legs) {
      const leg = distanceBetweenPoints(previous, space);
      if (leg > SPACE) coarse.push(routeRequest(record, previous, space, leg, allowance));
      previous = space;
    }
    if (coarse.length > 0) {
      return needsContext(
        'route_required',
        `${record.spell}'s area triggers on the creatures it moves into, and ${coarse.length === 1 ? 'one leg of' : `${coarse.length} legs of`} the requested route ${coarse.length === 1 ? 'crosses' : 'cross'} spaces nothing records; send the activation again with \`via\` naming each 5-foot step`,
        coarse,
      );
    }
  }

  return ok(legs);
}

/**
 * The route fact the engine will not invent, addressed to the orchestrator.
 *
 * **`via` is an adjudicated route, not player micromanagement.** A player says
 * "move the beam onto the ogre"; somebody then decides which way it goes, and
 * that decision is judgement rather than arithmetic — whether to sweep it
 * through the other two ogres, whether to keep it off the paladin, whether the
 * player said anything that settles it. Maestro owns that call, because
 * Maestro is the layer that reads the fiction. **The engine validates the
 * route and never chooses it**, which is the same boundary `eligibleTargets`
 * draws for targeting: a shortlist, not a substitution.
 *
 * So this is not a refusal and must never be described as one. The action is
 * mechanically possible; one fact it needs has not been supplied yet.
 */
function routeRequest(
  record: OngoingSpell,
  from: Point,
  to: Point,
  leg: number,
  allowance: number,
): ContextRequest {
  return {
    kind: 'route',
    subject: record.castingId,
    need: `which 5-foot spaces ${record.spell}'s area crossed between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) — ${leg} feet, of the ${allowance} it may move`,
    because: `${record.spell} catches every creature its area moves into, and the spaces between two points are not something the engine may decide`,
    satisfyWith: `activateSpell again with \`via\` listing each space the area passes through, one 5-foot step at a time`,
  };
}

/** An ordinary later-turn spell: the caster's own reach, checked afresh. */
function reachFromCaster(
  state: GameState,
  casterId: CharacterId,
  target: CharacterId,
  record: OngoingSpell,
  activation: SpellActivation,
  unverified: string[],
): Err | null {
  const reach = activation.range === undefined ? null : ranged(activation.range);
  if (reach === null) return null;

  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${record.spell} could not check that ${target} is within ${reach} feet`,
    );
    return null;
  }

  const apart = distanceBetween(state.scene, casterId, target);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${casterId} and ${target} are standing, so ${record.spell}'s ${reach}-foot reach went unchecked`,
    );
    return null;
  }
  if (apart.value > reach) {
    return err(
      'out_of_range',
      `${target} is ${apart.value} feet away and ${record.spell} reaches ${reach}`,
    );
  }
  return null;
}

/** And the other half of the seam: reach measured from the point it holds. */
function reachFromOrigin(
  state: GameState,
  target: CharacterId,
  origin: Point,
  record: OngoingSpell,
  definition: SpellDefinition,
  unverified: string[],
): Err | null {
  const reach = definition.origin?.reach;
  if (reach === undefined) return null;

  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${record.spell} could not check that ${target} is within ${reach} feet of it`,
    );
    return null;
  }

  const apart = distanceToPoint(state.scene, target, origin);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${target} is standing, so ${record.spell}'s ${reach}-foot reach went unchecked`,
    );
    return null;
  }
  if (apart.value > reach) {
    return err(
      'out_of_range',
      `${target} is ${apart.value} feet from ${record.spell} and it reaches ${reach}`,
    );
  }
  return null;
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

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

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

export interface HealingTouchCommand extends CommandIdentity {
  readonly feature: string;
  readonly target: CharacterId;
  /** Hit points to draw. Zero is legal when the touch is only lifting. */
  readonly hitPoints?: number;
  /** Conditions to lift, each at the feature's own cost. */
  readonly lift?: readonly ConditionName[];
}

/**
 * Draw on a pool of hit points by touching somebody.
 *
 * SRD Lay On Hands: "As a Bonus Action, you can touch a creature (which could
 * be yourself) and draw power from the pool of healing to restore a number of
 * Hit Points to that creature, up to the maximum amount remaining in the
 * pool. You can also expend 5 Hit Points from the pool of healing power to
 * remove the Poisoned condition from the creature; **those points don't also
 * restore Hit Points to the creature.**"
 *
 * That last clause is the whole reason the cost and the healing are two
 * numbers. Five points buy the lifting and heal nothing, so a Paladin who
 * draws 3 and lifts Poisoned spends 8 and the creature gains 3.
 *
 * Restoring Touch lengthens the list of conditions and changes nothing else,
 * which is why it is not a second command: it is the Improved Critical shape,
 * a later feature restating an earlier one.
 *
 * **The whole drawing is validated before any of it is spent**, so a Paladin
 * who asks for more than the pool holds keeps every point.
 */
export function useHealingTouch(
  state: GameState,
  id: CharacterId,
  command: HealingTouchCommand,
): Result<GameEvent[]> {
  const identity = identify(state, `healing-touch:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const definition = (creature.sheet.healingTouch ?? []).find((h) => h.feature === command.feature);
  if (definition === undefined) {
    return err('no_such_feature', `${id} has no feature called ${command.feature}`);
  }

  const target = creatureOf(state, command.target);
  if (target === null) return unknownCreature(command.target);

  const hitPoints = command.hitPoints ?? 0;
  if (!Number.isInteger(hitPoints) || hitPoints < 0) {
    return err('bad_amount', `a drawing is a whole number of hit points, got ${hitPoints}`);
  }

  const lift = command.lift ?? [];
  if (new Set(lift).size !== lift.length) {
    return err('duplicate_condition', 'a condition named twice would be charged for twice');
  }
  for (const condition of lift) {
    if (!definition.lifts.includes(condition)) {
      return err('cannot_lift', `${definition.name} does not lift the ${condition} condition`);
    }
  }

  const drawn = hitPoints + lift.length * definition.costPerCondition;
  if (drawn < 1) return err('nothing_drawn', `${definition.name} was used to draw nothing`);

  const left = remaining(creature.resources, definition.pool);
  if (left < drawn) {
    return err('exhausted', `${definition.name} has ${left} left, and ${drawn} was drawn`);
  }

  // SRD: "you can touch a creature." A Paladin always reaches themselves; for
  // anyone else it is the reach a fist has, measured the way everything else
  // is. The three-valued discipline positioning keeps everywhere: no scene is
  // a table not using positions and the touch lands, a scene with somebody
  // unplaced is a gap in a record the table *is* keeping and is asked about.
  if (command.target !== id && state.scene !== null) {
    const measured = distanceBetween(state.scene, id, command.target);
    if (!measured.ok) {
      const scene = state.scene;
      const off = [id, command.target].filter((who) => positionOf(scene, who) === null);
      return needsContext(
        'unplaced',
        `nobody has said where ${off.join(' or ')} ${off.length === 1 ? 'is' : 'are'} standing, and ${definition.name} is a touch`,
        off.map((who) => ({
          kind: 'position' as const,
          subject: who,
          need: `where ${who} is standing`,
          because: `${definition.name} reaches five feet`,
          satisfyWith: 'creature-placed',
        })),
      );
    }
    if (measured.value > 5) {
      return err(
        'out_of_reach',
        `${command.target} is ${measured.value} feet away, and ${definition.name} is a touch`,
      );
    }
  }

  const events: GameEvent[] = [];

  // The action economy only exists in combat; outside it there is nothing to
  // spend, exactly as every other feature here finds.
  if (state.combat !== null) {
    const spent = spendFor(state, id, definition.action);
    if (!spent.ok) return spent;
    events.push(spent.value);
  }

  events.push({
    type: 'resource-spent',
    id,
    key: definition.pool,
    amount: drawn,
    ...(stamp === null ? {} : { command: stamp }),
  });

  if (hitPoints > 0) {
    const healed = healCreature(state, command.target, hitPoints);
    if (!healed.ok) return healed;
    events.push(...healed.value);
  }

  // SRD removes *the condition*, not a cause of it — so an ally poisoned twice
  // over is not half-cured. Omitting the source is how the reducer says that.
  for (const condition of lift) {
    events.push({ type: 'condition-removed', id: command.target, condition });
  }

  return ok(events);
}

export interface UseSelfHealCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Spend a use of a feature, roll its die, and heal the holder.
 *
 * SRD Second Wind — "As a Bonus Action, you can use it to regain Hit Points
 * equal to 1d10 plus your Fighter level" — and Wholeness of Body, which is the
 * same sentence with the Monk's own die and modifier. Both pools were already
 * declared, sized off the class table and refilling on the right rest, and
 * neither gave back a hit point: Second Wind's note said as much out loud,
 * *"healCreature exists and nothing ties the two together."*
 *
 * **Validate before rolling.** Every refusal here — no such feature, an empty
 * pool, no Bonus Action, a dead Fighter — lands before the die is thrown, so a
 * refused use costs neither the use nor a turn of the generator. Rolling first
 * would let a rejected operation move authoritative state, and a replay would
 * then diverge from the session that produced it.
 *
 * The healing itself goes through `healCreature`, so the cap at the hit point
 * maximum and the rule that lifts unconsciousness from 0 hit points — and only
 * that unconsciousness — are the ones already written rather than a second
 * copy of them.
 */
export function useSelfHeal(
  state: GameState,
  id: CharacterId,
  command: UseSelfHealCommand,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<GameEvent[]> {
  const identity = identify(state, `self-heal:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const definition = (creature.sheet.selfHeals ?? []).find((s) => s.feature === command.feature);
  if (definition === undefined) {
    return err('no_such_feature', `${id} has no feature called ${command.feature}`);
  }

  if (remaining(creature.resources, definition.pool) < 1) {
    return err('exhausted', `${id} has no uses of ${definition.name} left`);
  }

  // Asked before the die rather than discovered after it: `healCreature`
  // refuses a corpse, and a refusal that arrived after the roll would have
  // spent a die on nothing.
  if (creature.vitals.dead) {
    return err('dead', `${id} is dead; hit points alone will not bring them back`);
  }

  const events: GameEvent[] = [];

  // The action economy only exists in combat; outside it there is nothing to
  // spend, exactly as `resolveCast` and `activateFeature` find.
  if (state.combat !== null) {
    const spent = spendFor(state, id, definition.action);
    if (!spent.ok) return spent;
    events.push(spent.value);
  }

  events.push({ type: 'resource-spent', id, key: definition.pool, amount: 1 });

  const healed = rollAndHeal(state, id, definition, definition.name, supply, stamp);
  if (!healed.ok) return healed;
  events.push(...healed.value);

  return ok(events);
}

/**
 * Roll a feature's healing die, add what its sentence adds, and heal.
 *
 * Shared by the two commands that heal from a feature, so the SRD floor and
 * the cap at the hit point maximum live in one place. The caller has already
 * refused a dead creature — this rolls, so everything that could say no must
 * have said it.
 */
function rollAndHeal(
  state: GameState,
  id: CharacterId,
  heal: HealAmount,
  name: string,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const issuedBefore = supply.issuer.count;
  const rolled = rollRecorded(supply.issuer, supply.rng, heal.dice);
  if (!rolled.ok) return rolled;

  const addend = selfHealAddend(heal, creature.sheet.abilities);
  // SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". Second Wind
  // and Uncanny Metabolism name no floor, and neither could reach one.
  const amount = Math.max(heal.minimum ?? 1, rolled.value.total + addend.amount);

  const done = healCreature(state, id, amount);
  if (!done.ok) return done;

  return ok([
    {
      type: 'roll-recorded',
      who: id,
      label: `${name} (${heal.dice})`,
      natural: rolled.value.total,
      total: rolled.value.total + addend.amount,
      contributions: [{ source: addend.label, amount: addend.amount }],
      outcome: `${amount} hit points`,
    },
    { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
    ...done.value.map((event) =>
      event.type === 'healed' && stamp !== null ? { ...event, command: stamp } : event,
    ),
  ]);
}

export interface UseRecoveryCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Use a feature that gives another pool's uses back.
 *
 * SRD Sorcerous Restoration and Magical Cunning, which are the same sentence
 * with every number changed. `restore()` in `resources.ts` has been written,
 * correct and reached by no command since the day pools landed — the eighth
 * time in this repo that a rule turned out to be a pure function nothing
 * called.
 *
 * **How much comes back is derived, never supplied.** The command names a
 * feature; the cap comes from the feature's own sentence, what is actually
 * expended comes from the pool, and the smaller of the two is what is given.
 * There is no field here for an amount, for the same reason there is none on
 * an effect check for a result.
 *
 * **Nothing expended is a refusal, not a silent success.** "You regain
 * expended Sorcery Points" has nothing to do when none are, and spending a
 * once-a-day feature for nothing is the kind of quiet loss a player discovers
 * two rooms later. A refusal costs neither the use nor anything else.
 */
export function useRecovery(
  state: GameState,
  id: CharacterId,
  command: UseRecoveryCommand,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<GameEvent[]> {
  const identity = identify(state, `recovery:${id}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, id);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const definition = (creature.sheet.recoveries ?? []).find((r) => r.feature === command.feature);
  if (definition === undefined) {
    return err('no_such_feature', `${id} has no feature called ${command.feature}`);
  }

  // SRD Sorcerous Restoration happens "when you finish a Short Rest". The
  // finest grain the engine has for "when" out of combat is the clock, which
  // is the same window a Reaction to damage uses: the rest earned a Short
  // Rest's benefits and nothing has happened since.
  if (definition.moment === 'short-rest' && creature.lastShortRestAt !== state.elapsed) {
    return err(
      'not_the_moment',
      `${definition.name} happens when a Short Rest finishes, and ${id} has not just finished one`,
    );
  }

  // SRD Uncanny Metabolism and Persistent Rage happen "when you roll
  // Initiative", which is before anybody acts. The closest the engine holds is
  // the first turn of the fight — `turnsTaken` counts turns *finished*, so it
  // is still 0 throughout it — and that window is the same for everyone in the
  // order rather than depending on where in it the holder sits. A creature who
  // is fourth in Initiative takes it during the first combatant's turn, which
  // is when the SRD says it happens.
  if (definition.moment === 'initiative' && (state.combat === null || state.combat.turnsTaken > 0)) {
    return err(
      'not_the_moment',
      `${definition.name} happens when Initiative is rolled, and that moment has passed`,
    );
  }

  if (remaining(creature.resources, definition.pool) < 1) {
    return err('exhausted', `${id} has no uses of ${definition.name} left`);
  }

  const target = creature.resources.pools[definition.restores];
  if (target === undefined) {
    return err('unknown_pool', `${id} has no ${definition.restores} to regain`);
  }
  // One check, two causes, because a mutation proved they were two checks and
  // one cause: a separate `spent === 0` guard above this one was unreachable,
  // since nothing expended makes the amount zero and lands here anyway. Which
  // cause it was still belongs in the message.
  const amount = Math.min(recoveryCap(definition, target.max), target.spent);
  if (amount < 1) {
    return err(
      'nothing_to_regain',
      target.spent === 0
        ? `${id} has spent no ${target.label}`
        : `${definition.name} gives back nothing at level ${definition.classLevel}`,
    );
  }

  // SRD Uncanny Metabolism heals "when you do so" — riding on the recovery,
  // with no cost of its own. A creature who cannot be healed still recovers:
  // the sentence gives the points first.
  const events: GameEvent[] = [
    { type: 'resource-spent', id, key: definition.pool, amount: 1 },
    {
      type: 'resource-regained',
      id,
      key: definition.restores,
      amount,
      ...(stamp === null ? {} : { command: stamp }),
    },
  ];

  if (definition.heal !== undefined && !creature.vitals.dead) {
    const healed = rollAndHeal(state, id, definition.heal, definition.name, supply, null);
    if (!healed.ok) return healed;
    events.push(...healed.value);
  }

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
  if (creature === null) return unknownCreature(id);
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
  if (creature === null) return unknownCreature(id);
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
  /**
   * Begin the casting and stop, leaving it open to be interrupted.
   *
   * SRD Counterspell interrupts "a creature in the process of casting a
   * spell", and an atomic casting has no such process. Asked for, this spends
   * the action and drops any Concentration the caster was holding — both of
   * which the SRD says are gone whatever happens next — and stops short of the
   * slot and the effects, which it does not.
   *
   * The resolution half of the record comes from the layer that worked the
   * targets out; `castSpell` supplies the casting half. Neither knows the
   * other's, which is why it arrives as an argument rather than being derived.
   */
  readonly hold?: CastingPlan;
  /**
   * A check a creature may later attempt against this casting.
   *
   * SRD Minor Illusion: "If a creature takes a Study action to examine the
   * sound or image, the creature can determine that it is an illusion with a
   * successful Intelligence (Investigation) check against your spell save DC."
   * The DC is worked out now, from the caster's sheet and the route that
   * supplied the spell, because by the time somebody looks closely the caster
   * may have levelled, changed route, or left.
   *
   * It rides on the casting's own timer, so a spell with no duration offers
   * nothing to examine — which is correct: there is nothing still standing
   * there.
   */
  readonly check?: EffectCheck;
}

/**
 * What settlement needs that the casting command cannot know.
 *
 * `castSpell` owns the slot, the level, the casting time and the id.
 * `resolveSpell` owns which definition it is, who it is aimed at, and what the
 * definition admits it does not do. A held casting has to carry both, and
 * these are the half that comes from above.
 */
export interface CastingPlan {
  readonly spellId: string;
  readonly targets: readonly CharacterId[];
  readonly unverified: readonly string[];
  /**
   * The space chosen at declaration, for a spell that holds a point.
   *
   * Beside the targets and for the same reason: settlement takes no fresh
   * request, so nothing may re-place the force between the declaration and
   * the moment it appears.
   */
  readonly origin?: Point;
  /**
   * Where a persistent area sits, for a spell that leaves one behind.
   *
   * Kept apart from `origin` rather than folded into it, because the two are
   * read by different rules: `origin` is where a casting *acts from* and
   * reaches the attack, while this is a shape's anchor and reaches nothing but
   * the geometry. A Web declared over the goblins settles over the goblins,
   * and the direction it was laid along is the one fact about it that cannot
   * be worked out again.
   */
  readonly area?: {
    readonly at: Point;
    readonly towards?: Point;
    /** Absent means `space`, so a log written before intersections existed folds unchanged. */
    readonly anchoring?: PointAnchoring;
  };
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
  if (caster === null) return unknownCreature(id);
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

  // SRD Counterspell: the casting is held open, the action is already gone,
  // and **the slot is not**. So this stops before the slot, before the
  // Concentration the spell would start, and before its deadline — all three
  // belong to a spell that has taken effect, and this one has not yet.
  //
  // The deadline is nonetheless *resolved* now, so that a turn-anchored
  // duration outside combat is refused while refusing still costs nothing. A
  // window that could not be closed would wedge the fight.
  if (command.hold !== undefined) {
    let deadline: Deadline | undefined;
    if (command.duration !== undefined) {
      const pinned = resolveDuration(timeView(state), command.duration);
      if (!pinned.ok) return pinned;
      deadline = pinned.value;
    }

    events.push({
      type: 'spell-declared',
      casting: {
        castingId,
        caster: id,
        spellId: command.hold.spellId,
        spell: name.value,
        level: castLevel,
        slot,
        slotless,
        castingTime,
        concentration,
        ...(command.route === undefined ? {} : { route: command.route }),
        targets: command.hold.targets,
        ...(command.hold.origin === undefined ? {} : { origin: command.hold.origin }),
        ...(command.hold.area === undefined ? {} : { area: command.hold.area }),
        unverified: command.hold.unverified,
        ...(deadline === undefined ? {} : { deadline }),
        ...(command.check === undefined ? {} : { check: command.check }),
      },
      ...(stamp === null ? {} : { command: stamp }),
    });
    return ok(events);
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
    const timer = schedule(
      state,
      { kind: 'casting', castingId },
      command.duration,
      undefined,
      command.check,
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok(events);
}

/**
 * The events that settle a casting held open since it was declared.
 *
 * The mirror of the block above: everything a declaration deliberately did not
 * do. The slot goes here, the Concentration starts here, and the deadline
 * pinned at declaration is scheduled here — because all three belong to a
 * spell that has actually taken effect.
 */
function settlementEvents(pending: PendingCasting, stamp: CommandStamp | null): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'spell-cast',
      castingId: pending.castingId,
      id: pending.caster,
      spell: pending.spell,
      level: pending.level,
      slot: pending.slot,
      slotless: pending.slotless,
      castingTime: pending.castingTime,
      concentration: pending.concentration,
      ...(pending.route === undefined ? {} : { route: pending.route }),
      ...(stamp === null ? {} : { command: stamp }),
    },
  ];

  if (pending.concentration) {
    events.push({
      type: 'concentration-started',
      id: pending.caster,
      castingId: pending.castingId,
      spell: pending.spell,
      level: pending.level,
    });
  }

  if (pending.deadline !== undefined) {
    events.push({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: pending.castingId },
      deadline: pending.deadline,
      ...(pending.check === undefined ? {} : { check: pending.check }),
    });
  }

  return events;
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
  /** A check the affected creature may attempt to shake it off. */
  readonly check?: EffectCheck;
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
  /**
   * The casting caused this condition and does not keep it.
   *
   * **Causation and ownership are two different links.** The engine has one
   * mechanism for both — the casting id inside the condition's source — and
   * that is right for every condition a spell *sustains*: Hold Person's
   * Paralyzed "for the duration", Web's Restrained "while in the webs", Black
   * Tentacles' "until the spell ends". SRD Grease sustains nothing: "or have
   * the Prone condition", and Prone ends when the creature stands up.
   *
   * Set, the condition is recorded under the spell's bare name. The log still
   * says what caused it; nothing can later claim it as the casting's to
   * remove, and `releaseCasting` walks past it.
   */
  readonly unowned?: true;
}

export function applySpellEffect(
  state: GameState,
  targetId: CharacterId,
  condition: ConditionName,
  casterId: CharacterId,
  options: SpellEffectOptions = {},
): Result<GameEvent[]> {
  // The caster is looked up only for the fallback below. A casting that
  // outlives its caster — SRD Grease runs its minute whether or not the wizard
  // does — names its own casting and needs no record to hang the condition on.
  const casting = options.casting ?? creatureOf(state, casterId)?.concentration;
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
    options.unowned === true ? casting.spell : castingSource(casting.spell, casting.castingId),
    options.immuneTo ?? [],
    options.duration,
    options.repeatSave,
    {},
    options.check,
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
  if (caster === null) return unknownCreature(casterId);
  if (caster.concentration === null) {
    return err('not_concentrating', `${casterId} is not concentrating on anything`);
  }

  const target = creatureOf(state, targetId);
  if (target === null) return unknownCreature(targetId);

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
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // The check comes first, or a retry of a dismissal that went through comes
  // back `not_concentrating` — a rules refusal for a command that succeeded,
  // and the caller cannot tell it from a genuine one.
  const identity = identify(state, `end-concentration:${id}`, { ...command, reason });
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok([]);
  const stamp = identity.value.stamp;

  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);
  if (creature.concentration === null) {
    return err('not_concentrating', `${id} is not concentrating on anything`);
  }

  return ok([
    {
      type: 'concentration-ended',
      id,
      castingId: creature.concentration.castingId,
      reason,
      ...(stamp === null ? {} : { command: stamp }),
    },
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
  if (caster === undefined) return unknownCreature(id);

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
 * **Reaction triggers are checked one layer up.** This is the low-level half
 * — a caller reconstructing a log or scripting a fixture has already accounted
 * for the moment. `resolveSpell` is where `triggerRefusal` reads the window a
 * Reaction spell answers, before the Reaction or the slot is spent; see "A
 * Reaction Is A Window, Not A Trigger" in CLAUDE.md. Same split as
 * `damageCreature` beneath `resolveDamage`, and the same policy: the low-level
 * half exists, and Maestro's tool surface does not expose it.
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

/**
 * Every scheduled hit whose moment has arrived, in a stable order.
 *
 * A query, so a caller may look before advancing. Due-ness is a function of
 * the turn counts alone: a schedule whose anchor has left the fight is never
 * due, and a derived pass drops it — the moment did not arrive, so the damage
 * is forgiven rather than collected.
 */
export function dueDamageOf(state: GameState): readonly (ScheduledDamage & { readonly key: string })[] {
  const view = timeView(state);
  return Object.keys(state.scheduledDamage)
    .sort()
    .flatMap((key) => {
      const scheduled = state.scheduledDamage[key];
      if (scheduled === undefined || !isDue(view, scheduled.deadline)) return [];
      return [{ ...scheduled, key }];
    });
}

/**
 * Roll and apply every scheduled hit that has fallen due.
 *
 * The damage arrives as ordinary `damage-taken` events through the same
 * `dealSpellDamage` every spell uses, so the target's Resistance, its
 * Temporary Hit Points, its Concentration save and its dropping to 0 all
 * behave exactly as they would from any other source. The only extra event is
 * the one that clears the debt.
 */
function collectDueDamage(
  state: GameState,
  supply: ConcentrationSaveSupply,
): Result<readonly GameEvent[]> {
  const due = dueDamageOf(state);
  if (due.length === 0) return ok([]);

  const events: GameEvent[] = [];
  let current = state;

  for (const scheduled of due) {
    const victim = current.creatures[scheduled.target];
    // Gone from the game entirely — not merely out of the fight, which the
    // derived pass already forgave. Nothing to hurt, so clear the debt.
    if (victim === undefined) {
      const cleared: GameEvent = { type: 'scheduled-damage-collected', key: scheduled.key };
      events.push(cleared);
      current = applyEvent(current, cleared);
      continue;
    }

    // The sheet contributes nothing: `rollSpellDice` keeps only the components
    // whose source is the spell, and the delayed hit is flat dice with no
    // ability modifier. The victim's own is used because the caster may be
    // dead by now — Acid Arrow is Instantaneous and the acid does not care.
    const rolled = rollSpellDice(
      supply,
      victim.sheet,
      scheduled.label,
      scheduled.damageType,
      scheduled.notation,
    );
    if (!rolled.ok) return rolled;

    const hurt = dealSpellDamage(current, scheduled.target, rolled.value, scheduled.label, supply, {
      by: scheduled.by,
    });
    if (!hurt.ok) return hurt;

    // Cleared first, so the log reads as the debt being settled and then the
    // damage landing — and so a `damage-taken` that drops the target cannot
    // leave the schedule behind if anything later throws.
    const cleared: GameEvent = { type: 'scheduled-damage-collected', key: scheduled.key };
    events.push(cleared, ...hurt.value.events);
    current = [cleared, ...hurt.value.events].reduce(applyEvent, current);
  }

  return ok(events);
}

/** Every turn-boundary save still owed, in a stable order. */
/**
 * An ability check a spell offers against something it is still doing.
 *
 * The SRD writes this twenty times — see through an illusion, tear free of the
 * tentacles, disbelieve the terrain — and it is a *different* mechanism from
 * the repeat save beside it, however alike the sentences read. A repeat save
 * is raised by the turn boundary and owed whether anybody remembers it; this
 * is attempted because the table said somebody tried. Nothing raises it and no
 * turn blocks on it, which is the whole reason it needs no pending-debt
 * machinery.
 *
 * **The division of authority is the point.** Maestro decides that a guard
 * peers at the illusion, or that the Restrained ogre heaves against the
 * tentacles — that is fiction, and the engine has no business inventing it.
 * Everything after that is arithmetic the engine owns and the caller may not
 * supply: which ability, which skill, the proficiency and Expertise on that
 * skill, the conditions the roller is under, the Advantage and Disadvantage
 * they carry, the die, and the DC the spell was cast at.
 */
export interface AvailableCheck {
  /** The timer it belongs to, and the handle a caller names it by. */
  readonly effectKey: string;
  /** Who may attempt it. */
  readonly by: CharacterId;
  readonly ability: Ability;
  readonly skill: Skill | null;
  readonly dc: number;
  readonly onSuccess: 'none' | 'end-on-target';
  readonly label: string;
}

/**
 * Who may attempt a check, derived from what the effect is on.
 *
 * An effect sitting on a creature is that creature's to shake off; a casting
 * with no victim — an illusion standing in a corridor — is anybody's to see
 * through. Derived rather than declared because every SRD spell the engine can
 * currently offer a check for reads this way, and a field with one exception
 * is a guess dressed as a structure.
 */
const mayAttempt = (timer: TimedEffect, who: CharacterId): boolean =>
  timer.target.kind !== 'condition' || timer.target.on === who;

/**
 * The checks this creature could attempt right now.
 *
 * The read side of {@link resolveEffectCheck}, and the same shape as
 * `eligibleTargets`: a shortlist for the layer that decides *whether* somebody
 * tries, with every number already worked out so that layer never has to.
 */
export function availableChecks(state: GameState, who: CharacterId): readonly AvailableCheck[] {
  return Object.keys(state.timers)
    .sort()
    .flatMap((effectKey): AvailableCheck[] => {
      const timer = state.timers[effectKey];
      if (timer?.check === undefined) return [];
      if (!mayAttempt(timer, who)) return [];
      return [
        {
          effectKey,
          by: who,
          ability: timer.check.ability,
          skill: timer.check.skill ?? null,
          dc: timer.check.dc,
          onSuccess: timer.check.onSuccess,
          label: timer.check.label,
        },
      ];
    });
}

export interface EffectCheckCommand extends CommandIdentity {
  /** Which ongoing effect is being tested, from {@link availableChecks}. */
  readonly effectKey: string;
  /**
   * Advantage or Disadvantage the table knows about and the engine does not.
   *
   * A mode, never a result. Everything the engine can see — the roller's
   * conditions, their armour, the features standing on them — it reads for
   * itself.
   */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies: Guidance's 1d4, a tool's bonus. */
  readonly bonuses?: readonly Bonus[];
  /**
   * Which senses this particular attempt leans on.
   *
   * A *fact* about the attempt, not a result: SRD Blinded "automatically fails
   * an ability check that requires sight", and whether this one does is
   * something only the table knows. Minor Illusion is the reason it is not a
   * property of the spell — it creates "a sound **or** an image", so the same
   * definition covers a check a blind creature can make and one it cannot.
   *
   * The caller says which sense; the engine owns what that costs.
   */
  readonly senses?: CheckContext;
}

export interface EffectCheckResolution {
  readonly events: readonly GameEvent[];
  /** The roll, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  readonly success: boolean;
  /** What the success did, so a narrating layer need not work it out. */
  readonly onSuccess: 'none' | 'end-on-target';
  /** True when this command id had already been applied. */
  readonly duplicate?: boolean;
}

/**
 * Attempt the check a spell offers against one of its ongoing effects.
 *
 * The caller says *who tries*, and nothing else that matters: the ability, the
 * skill, the DC, the modifiers and the die are all the engine's, and the
 * consequence is applied by the reducer from the recorded outcome rather than
 * by the caller from a number it chose.
 *
 * **It goes through `rollAbilityCheck`**, which is the only ability-check
 * calculator in the engine and was — until this command — reachable from no
 * command at all. Proficiency, Expertise, the armour penalties, a Blinded
 * creature's automatic failure on a sight-dependent check and the
 * exhaustion penalty all apply because that function applies them, not because
 * this one remembered to.
 *
 * **It costs the Action in combat**, because every SRD instance of this shape
 * says so — "can take an action to make a Strength (Athletics) check", "must
 * take the Study action to inspect your appearance". Outside combat there is
 * no economy to spend, exactly as with a casting.
 */
export function resolveEffectCheck(
  state: GameState,
  who: CharacterId,
  command: EffectCheckCommand,
  supply: ConcentrationSaveSupply,
): Result<EffectCheckResolution> {
  // Before validation, as always: a retry must report the duplicate rather
  // than the world its own first run made — a freed creature asking again
  // would otherwise be told there is nothing to escape from.
  const identity = identify(state, `effect-check:${who}`, command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], check: null, success: false, onSuccess: 'none', duplicate: true });
  }
  const stamp = identity.value.stamp;

  // A mandatory effect this creature has been caught by, or a turn whose start
  // has not arrived. **After the duplicate check, never before it.**
  const owedHere = mayAct(state, who);
  if (owedHere !== null) return owedHere;

  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who);

  // The engine's own timers are complete knowledge: it wrote every one of
  // them. So an effect key nobody has heard of is a refusal, not a request —
  // there is no fact out in the fiction that would make it exist.
  const timer = state.timers[command.effectKey];
  if (timer === undefined) {
    return err('unknown_effect', `nothing ongoing is filed under ${command.effectKey}`);
  }
  const check = timer.check;
  if (check === undefined) {
    return err('no_check', `${command.effectKey} offers no check to attempt`);
  }
  if (!mayAttempt(timer, who)) {
    return err(
      'not_yours_to_attempt',
      `${command.effectKey} is on somebody else, and only they can shake it off`,
    );
  }

  // Nothing is rolled until the whole operation is known to be valid, so a
  // refusal costs neither the Action nor a turn of the generator. Out of
  // combat there is no economy to spend, exactly as with a casting.
  const combat = state.combat;
  const inCombat = combat !== null && combat.budgets[who] !== undefined;
  if (inCombat) {
    const spent = spendAction(combat, who, creature.conditions);
    if (!spent.ok) return spent;
  }

  const issuedBefore = supply.issuer.count;
  // A feature that grants Advantage on this very skill — SRD Remarkable
  // Athlete: "Advantage on ... Strength (Athletics) checks", which is exactly
  // what tearing free of Black Tentacles asks for.
  const fromFeatures =
    check.skill === undefined ? [] : standingSkillModes(state, who, check.skill);

  const rolled = rollAbilityCheck(supply.issuer, supply.rng, creature.sheet, check.ability, {
    dc: check.dc,
    ...(check.skill === undefined ? {} : { skill: check.skill }),
    conditions: effectiveConditions(state, who),
    modes: [...fromFeatures, ...(command.modes ?? [])],
    ...(command.senses === undefined ? {} : { conditionContext: command.senses }),
    ...(command.bonuses === undefined ? {} : { bonuses: command.bonuses }),
  });
  if (!rolled.ok) return rolled;

  const events: GameEvent[] = [
    { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
  ];

  // The stamp rides on the roll, which happens whether the check succeeds or
  // fails — the same reasoning that put `resolveAttack`'s stamp on the roll
  // rather than on the damage a miss never deals.
  events.push({
    ...recordD20Test(
      who,
      check.label,
      rolled.value,
      rolled.value.success ? 'sees through it' : 'no wiser',
    ),
    ...(stamp === null ? {} : { command: stamp }),
  });

  // The Action goes whether or not the check lands: SRD spends it on the
  // attempt, not on the success.
  if (inCombat) events.push({ type: 'action-spent', id: who });

  // A check whose success changes nothing the engine holds emits no settling
  // event: there is no state for one to settle. The knowledge is the table's,
  // and the roll that produced it is in the log for anybody who asks why.
  if (check.onSuccess !== 'none') {
    events.push({
      type: 'effect-check-resolved',
      effectKey: command.effectKey,
      by: who,
      success: rolled.value.success,
    });
  }

  return ok({
    events,
    check: rolled.value,
    success: rolled.value.success,
    onSuccess: check.onSuccess,
  });
}

/**
 * Whether resolving this effect needs dice thrown from the caster's own sheet.
 *
 * A saving throw does not: the DC is pinned on the casting and the roll is the
 * *target's*. Everything else does — an attack is the caster's roll, and every
 * die of damage, healing or Temporary Hit Points goes through the caster's
 * sheet even when the spell's own dice are all that survive the filter.
 *
 * The distinction exists for exactly one case: a non-Concentration area whose
 * caster has left. SRD Grease is the only registered spell in it and its
 * trigger is a bare save, so the other branch is unreachable through content
 * — which is asserted rather than assumed.
 */
const needsCasterSheet = (effect: SpellEffect): boolean => effect.kind !== 'save';

/** What the persistent areas currently owe, in the order they were caught. */
export function owedAreaEffectsOf(state: GameState): readonly OwedAreaEffect[] {
  return state.owedAreaEffects;
}

/**
 * Which of two owed effects is settled first.
 *
 * **The previous creature's turn ends before the next one's begins**, and one
 * `turn-advanced` raises both. That is not a tie the keys may break: an
 * Insect Plague that drops a caster at the end of one turn ends the Web
 * somebody else was about to start their turn in, and the engine either gets
 * that right or settles whichever happened to sort first.
 *
 * `entry` sits between them because it is neither — whatever happened in
 * between — and because no guard lets it stand beside a boundary anyway.
 */
const MOMENT_ORDER: Readonly<Record<AreaMoment, number>> = {
  'end-of-turn': 0,
  // Both are things that happened between the boundaries, and the SRD orders
  // neither against the other. The area's own move is the authoritative
  // operation that raised its debt, and a creature cannot move while that debt
  // stands, so the two only ever meet in a log nothing here would write — an
  // order is given so that log still folds the same way twice.
  'area-moved': 1,
  entry: 2,
  'start-of-turn': 3,
};

const castingNumberOf = (castingId: string): number =>
  Number(castingId.slice('cast:'.length)) || 0;

/** What one settlement did. */
export interface AreaEffectResolution {
  readonly events: readonly GameEvent[];
  /** The debts discharged, in the order they were settled. */
  readonly settled: readonly OwedAreaEffect[];
  readonly outcomes: readonly SpellTargetOutcome[];
  /** Checks the rules call for that the engine still cannot make. */
  readonly unverified: readonly string[];
}

/**
 * Deal what the persistent areas owe.
 *
 * SRD writes these as clauses on the spell — "ends its turn there", "the first
 * time a creature enters the webs on a turn" — so what settles is **the spell
 * itself**, at the level and route the casting was made with, through the same
 * machinery an ordinary casting runs. There is no second save calculator here
 * and no second damage resolver, and the caller supplies no DC, no roll and no
 * outcome: it may only say that an already-owed effect should now be dealt.
 *
 * Its own command rather than a step inside the move that caused it, because
 * the move does not always have a generator: `declineOpportunity` completes
 * somebody else's declared move and has no dice to roll with. A debt that only
 * the moving command could settle would wedge the fight on exactly that path.
 *
 * Nothing is recomputed. Whether the creature was inside the area was decided
 * when the moment happened; by now they may have been thrown clear, and a
 * settlement that asked again would forgive a save the rules had already
 * called for.
 */
export function settleAreaEffects(
  state: GameState,
  supply: ConcentrationSaveSupply,
  command: CommandIdentity = {},
): Result<AreaEffectResolution> {
  // Before every guard below, as always: a retry arrives at the world its own
  // first run made, and reporting "nothing is owed" for a settlement that has
  // already happened is the confusion command ids exist to prevent.
  const identity = identify(state, 'settle-area', command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    return ok({ events: [], settled: [], outcomes: [], unverified: [] });
  }
  const stamp = identity.value.stamp;

  if (state.owedAreaEffects.length === 0) {
    return ok({ events: [], settled: [], outcomes: [], unverified: [] });
  }

  const events: GameEvent[] = [];
  const settled: OwedAreaEffect[] = [];
  const outcomes: SpellTargetOutcome[] = [];
  const unverified: string[] = [];
  let current = state;
  let first = true;

  // **The queue is re-read every time, never snapshotted**, and that is the
  // whole of the temporal guarantee at this end: settling the finishing
  // creature's end is what *brings about* the next creature's start, so the
  // start debts do not exist when this command begins. Taking the list once
  // would settle the end and leave the start standing.
  //
  // Bounded because a loop over state that raises state is a loop that has to
  // be able to stop: each pass discharges one debt and the turn stamp keeps
  // the same casting from catching the same creature again, so the ceiling is
  // reached only by a log nothing here could have written.
  for (let pass = 0; pass < 64; pass += 1) {
    const owed = nextOwed(current);
    if (owed === null) break;

    const discharge: GameEvent = {
      type: 'area-effect-settled',
      castingId: owed.castingId,
      target: owed.target as CharacterId,
      moment: owed.moment,
      ...(first && stamp !== null ? { command: stamp } : {}),
    };
    first = false;

    const record = current.ongoing[owed.castingId];
    const definition = record === undefined ? null : definitionFor(record.spellId);
    const trigger = definition?.areaTrigger;
    const casterId = (record?.caster ?? null) as CharacterId | null;
    const caster = casterId === null ? null : creatureOf(current, casterId);

    // **A casting whose caster has gone still owes what it owes.** SRD Grease
    // runs its minute whether or not the wizard does, and the DC it rolls
    // against was pinned when it was conjured — so the save happens. What
    // cannot happen is an effect that needs the caster's *sheet* to throw
    // dice, and that is said out loud rather than silently forgiven. No
    // registered spell can reach it: every non-Concentration area trigger is
    // a bare saving throw, and the area-trigger suite asserts it.
    if (record === undefined || definition === null || trigger === undefined) {
      events.push(discharge);
      current = applyEvent(current, discharge);
      settled.push(owed);
      continue;
    }
    if (caster === null && trigger.effects.some(needsCasterSheet)) {
      unverified.push(
        `${record.spell} caught ${owed.target}, and resolving it needs dice thrown from a sheet ${record.caster} took with them; nothing was rolled`,
      );
      events.push(discharge);
      current = applyEvent(current, discharge);
      settled.push(owed);
      continue;
    }

    const resolved = resolveEffects(current, casterId!, caster, definition, {
      // Pinned at the casting: a Cleric who levels does not upcast a swarm
      // that has been buzzing since the first round.
      castLevel: record.level,
      route: null,
      numbers: record.numbers,
      targets: [owed.target as CharacterId],
      unverified,
      supply,
      castingId: record.castingId,
      events: [discharge],
      effects: statedDamageType(trigger.effects, record.damageType),
      label: trigger.label,
    });
    if (!resolved.ok) return resolved;

    events.push(...resolved.value.events);
    current = resolved.value.events.reduce(applyEvent, current);
    outcomes.push(...resolved.value.outcomes);
    settled.push(owed);
  }

  return ok({ events, settled, outcomes, unverified });
}

/**
 * A trigger's effects, dealing the damage type this casting was declared with.
 *
 * SRD Spirit Guardians prints two and picks between them on the caster's
 * alignment, which is stated at the casting and pinned there — see
 * `OngoingSpell.damageType`. The definition carries one of the two so the
 * shape is well-formed and `spell-catalogue.test.ts` can cast it; the pinned
 * answer is what actually lands, and it is pinned rather than re-read for the
 * same reason the save DC is.
 *
 * Absent for every other spell, where the printed type is the only type and
 * this is the identity function.
 */
function statedDamageType(
  effects: readonly SpellEffect[],
  damageType: string | undefined,
): readonly SpellEffect[] {
  if (damageType === undefined) return effects;
  return effects.map((effect) =>
    'damageType' in effect && effect.damageType !== undefined ? { ...effect, damageType } : effect,
  );
}

/**
 * The next effect to settle: the earliest moment, then the oldest casting.
 *
 * **The previous creature's turn ends before the next one's begins**, and one
 * `turn-advanced` can leave both owed. That is not a tie the keys may break,
 * so the moment decides and everything else is only there to make the answer
 * deterministic where the SRD offers no order at all.
 *
 * `entry` sits between them because it is neither — whatever happened in
 * between — and because no guard lets it stand beside a boundary anyway.
 */
function nextOwed(state: GameState): OwedAreaEffect | null {
  let best: OwedAreaEffect | null = null;
  for (const owed of state.owedAreaEffects) {
    if (
      best === null ||
      MOMENT_ORDER[owed.moment] < MOMENT_ORDER[best.moment] ||
      (MOMENT_ORDER[owed.moment] === MOMENT_ORDER[best.moment] &&
        (castingNumberOf(owed.castingId) < castingNumberOf(best.castingId) ||
          (owed.castingId === best.castingId && owed.target.localeCompare(best.target) < 0)))
    ) {
      best = owed;
    }
  }
  return best;
}

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
      return unknownCreature(pending.target, 'owes a save but is not in this game');
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

  // Damage that has been rolled and not dealt is the newest debt of this
  // shape, and the loudest one to get wrong: advancing past it would leave a
  // creature un-hit by a blow that had already landed, with the roll sitting
  // in the log.
  if (state.pendingDamage !== null) {
    return err(
      'damage_pending',
      `${state.pendingDamage.target} has damage rolled against them that nobody has settled; settle it before the turn moves on`,
    );
  }

  // A D20 Test whose effects have not occurred. Nobody is obliged to push it,
  // but until somebody says so the number is not final — and a turn that moved
  // on would take the chance to push it with it.
  if (state.pendingTest !== null) {
    return err(
      'test_pending',
      `${state.pendingTest.who} has a D20 Test whose effects are still unsettled; settle it before the turn moves on`,
    );
  }

  // A declared casting is engine debt in exactly the way a held attack is: the
  // action is spent, the slot is not, and nothing has taken effect. Advancing
  // past it would strand a spell that the rules say is still being cast.
  if (state.pendingCasting !== null) {
    return err(
      'casting_pending',
      `${state.pendingCasting.caster} has declared ${state.pendingCasting.spell} and it has not taken effect; settle it before the turn moves on`,
    );
  }

  const outstanding = pendingSavesOf(state);
  if (outstanding.length > 0) {
    return err(
      'saves_pending',
      `${outstanding.length} turn-boundary save(s) are still owed; resolve them before the turn moves on`,
    );
  }

  // What a persistent area caught somebody doing, still undealt. Advancing
  // past it would carry the debt into a turn whose boundary may raise another,
  // and a creature would be two saves behind by the time anybody looked. The
  // creature named is the one whose turn is ending, and the area half of the
  // policy is global anyway.
  const owedNow = mayAct(state, currentCombatant(state.combat).id);
  if (owedNow !== null) return owedNow;

  const advanced: GameEvent[] = [
    { type: 'turn-advanced', ...(stamp === null ? {} : { command: stamp }) },
  ];
  let after = advanced.reduce(applyEvent, state);

  // A hit the last turn promised — SRD Acid Arrow's "at the end of its next
  // turn". Collected **before** everything below it, for two reasons that both
  // matter: the damage can break a Concentration, which ends the very effect
  // whose repeat save this boundary would otherwise raise; and in a fight with
  // one combatant the creature ending its turn is the creature beginning the
  // next, so acid that drops it to 0 must land before the Death Save is asked
  // for.
  if (dueDamageOf(after).length > 0) {
    if (supply === undefined) {
      return err(
        'damage_owed',
        `${dueDamageOf(after).length} scheduled hit(s) fall due at this boundary; advancing needs a generator to roll them`,
      );
    }
    const collected = collectDueDamage(after, supply);
    if (!collected.ok) return collected;
    advanced.push(...collected.value);
    after = collected.value.reduce(applyEvent, after);
  }

  // What the boundary's areas owe: the finishing creature's end first, then
  // the beginning creature's start. `settleAreaEffects` orders by the moment
  // rather than by anything about how the debts were filed, which is the whole
  // of the temporal guarantee — an Insect Plague that drops a caster at the
  // end of one turn ends the Web the next creature was about to start theirs
  // in, and the debt goes with the casting.
  //
  // **Before the Death Saving Throw**, deliberately. Both are "at the start of
  // your turn" and the SRD orders neither, but only one order leaves room for
  // a start-of-turn *heal* to matter — Aura of Life's shape — and an ordering
  // that makes a future rule unreachable is the wrong one to pick by accident.
  if (after.owedAreaEffects.length > 0) {
    if (supply !== undefined) {
      const dealt = settleAreaEffects(after, supply);
      if (!dealt.ok) return dealt;
      advanced.push(...dealt.value.events);
      after = dealt.value.events.reduce(applyEvent, after);
    }
  }

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
  if (creature === undefined) return unknownCreature(who, 'has no record here');

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
  /**
   * The ongoing spell this effect ended, when it ended one.
   *
   * The casting id rather than a name, because that is the handle: a log
   * reader asking which of the two Blesses went has to be able to tell them
   * apart.
   */
  readonly dispelled?: string;
  /** The ability check a dispel had to roll, when the spell was too high. */
  readonly check?: D20TestResult;
  /**
   * The casting this effect interrupted, when it interrupted one.
   *
   * Counterspell's whole outcome, and it is the *casting id* rather than a
   * boolean because that is what names the thing that stopped: a log reader
   * asking why Hold Person never landed wants `cast:3`, not `true`.
   */
  readonly interrupted?: string;
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
  /**
   * Whether `at` and `towards` name a space or a grid intersection —
   * the vertical edge four spaces share. Defaults to `space`.
   *
   * The bit that decides whether a footprint comes out odd or even. A 20-foot
   * radius centred on a space reaches nine spaces across; centred on the
   * intersection four spaces meet at, it reaches eight — the footprint most tables
   * expect, and the one a 2014 optional rule prints. SRD 5.2.1 gives no grid
   * rule for areas of effect at all, so the engine declines to pick: the
   * caster says, and the casting records which they said.
   *
   * One value for the whole template, so the origin and the point a
   * directional shape is aimed at are always read in the same frame. Refused
   * for a `self`-origin area, which is anchored by the caster's own space.
   */
  readonly anchoring?: PointAnchoring;
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
   * Creatures this casting designates unaffected, for a spell that offers it.
   *
   * SRD Spirit Guardians: "When you cast this spell, you can designate
   * creatures to be unaffected by it." Alarm prints the same shape. The choice
   * is the caster's and the engine validates rather than makes it — naming
   * somebody the engine has never heard of is refused, and naming anybody at
   * all through a spell that prints no such clause is refused too.
   *
   * **Never inferred from allegiance.** A cleric may spare an enemy and may
   * decline to spare an ally; `side` answers a different question.
   */
  readonly unaffected?: readonly CharacterId[];
  /**
   * Which of the damage types the spell prints this casting deals.
   *
   * SRD Spirit Guardians deals "Radiant damage (if you are good or neutral) or
   * Necrotic damage (if you are evil)". The engine holds alignment only for a
   * character it built and never for a monster or a declared NPC, and
   * inferring it from side, class or deity would be inventing the fact — so
   * the layer that reads the fiction states it, and the engine refuses
   * anything the spell does not print.
   *
   * Required by a spell that prints more than one and meaningless on every
   * other, both of which are refusals rather than quiet defaults.
   */
  readonly damageType?: string;
  /**
   * How to pay for it.
   *
   * **Default:** a slot when `slotLevel` is given, and nothing at all for a
   * cantrip. When a grant offers a free casting *and* a slot would serve, the
   * engine refuses to choose: spending a feat's one daily casting instead of a
   * slot is the caller's decision, not a default.
   */
  readonly payment?: 'slot' | 'free-casting';
  /**
   * Declare the casting and stop, leaving it open to be interrupted.
   *
   * SRD Counterspell answers "a creature in the process of casting a spell",
   * and an atomic casting is never in the process of anything. Asking for the
   * window costs the caster exactly what the SRD says it costs whatever
   * happens next — the action, and any Concentration they were holding — and
   * settles the rest at {@link resolveDeclaredCast}.
   *
   * **Opt-in, because most castings have no window that matters.** A spell
   * nobody can answer resolves in one call exactly as it always has; turning
   * every casting into a two-step ceremony would be a worse API for the sake
   * of a moment that is usually empty.
   */
  readonly hold?: boolean;
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
/**
 * Fold a spell's printed flat addend into what its dice rolled.
 *
 * SRD prints two of these — Finger of Death's "7d8 + 30" and Disintegrate's
 * "10d6 + 40" — and the number is part of the damage rather than a separate
 * effect. `DiceScaling` carried it from the start and nothing on this path
 * read it, so both spells rolled their dice and silently dropped the addend.
 *
 * It lands once, on the first component, and it does **not** double on a
 * critical: "roll the attack's damage dice twice, add them together, and add
 * any relevant modifiers as normal."
 */
function withFlatAddend(
  components: readonly DamageComponent[],
  addend: number,
): readonly DamageComponent[] {
  if (addend === 0 || components.length === 0) return components;
  const [first, ...rest] = components as readonly [DamageComponent, ...DamageComponent[]];
  return [{ ...first, flat: first.flat + addend, total: first.total + addend }, ...rest];
}

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
  options: { readonly critical?: boolean; readonly by?: CharacterId },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
}> {
  const victim = state.creatures[target];
  if (victim === undefined) return unknownCreature(target);

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
      ...(options.by === undefined ? {} : { by: options.by }),
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

/**
 * A skill's display form, for a log line a person reads.
 *
 * Skills are kebab-case slugs because an id is not a display name — the same
 * rule the equipment catalogue learned the hard way — so the readable half is
 * derived here rather than stored twice.
 */
const skillName = (skill: Skill): string =>
  skill
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

/**
 * Turn a definition's check into the one the timer will carry.
 *
 * The DC is the caster's spell save DC unless the SRD prints a number, and the
 * label is derived rather than transcribed so that thirty definitions cannot
 * disagree about how a roll reads in the log.
 */
function effectCheckFrom(
  check: SpellCheck | undefined,
  spell: string,
  saveDc: number,
): EffectCheck | undefined {
  if (check === undefined) return undefined;
  return {
    ability: check.ability,
    ...(check.skill === undefined ? {} : { skill: check.skill }),
    dc: check.dc ?? saveDc,
    onSuccess: check.onSuccess,
    label: `${ABILITY_NAMES[check.ability]}${check.skill === undefined ? '' : ` (${skillName(check.skill)})`} check vs ${spell}`,
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
 * The casting waiting to resolve, if one is.
 *
 * A query, so a caller — or a Reaction deciding whether it has a trigger — can
 * look without changing anything.
 */
export function pendingCastingOf(state: GameState): PendingCasting | null {
  return state.pendingCasting;
}

/**
 * Let a declared casting take effect: spend the slot, run the spell.
 *
 * The other half of {@link resolveSpell} with `hold`. Everything the
 * declaration deliberately left undone happens here, and nothing the
 * declaration already did happens twice: the action stays spent, the
 * Concentration that was dropped stays dropped, and the slot — untouched until
 * now, because SRD Counterspell spares it — is expended at last.
 *
 * **The caller does not restate the spell.** Who it was aimed at, what level it
 * was cast at and which route supplied it were all settled and written down at
 * declaration. A settlement that took a fresh request could declare Fireball
 * at the goblins and settle it at the party, and no rule in the engine would
 * have noticed.
 */
export function resolveDeclaredCast(
  state: GameState,
  supply: ConcentrationSaveSupply,
  command: CommandIdentity = {},
): Result<SpellResolution> {
  // Before the pending casting is even read. A retry that arrives after the
  // first settlement finds no casting open, and reporting "nothing is being
  // cast" for a spell that has already landed is the exact confusion command
  // ids exist to prevent.
  const identity = identify(state, 'settle-cast', command);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) {
    const already = command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return ok({
      events: [],
      castingId: already?.castingId ?? '',
      outcomes: [],
      unverified: [],
    });
  }
  const stamp = identity.value.stamp;

  const pending = state.pendingCasting;
  if (pending === null) {
    return err('no_casting_pending', 'no casting is waiting to resolve');
  }

  const caster = creatureOf(state, pending.caster);
  if (caster === null) return unknownCreature(pending.caster);

  const definition = definitionFor(pending.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${pending.spellId} has no executable definition; the casting cannot be settled`,
    );
  }

  // Re-derived rather than stored: the route is a fact about the caster's
  // sheet, which nothing between the declaration and here can have changed,
  // and a `CastingRoute` in the log would be a derived value pretending to be
  // history.
  const chosen = chooseRoute(caster.spellcasting, pending.spellId, pending.route);
  if (!chosen.ok) return chosen;

  const events: GameEvent[] = settlementEvents(pending, stamp);

  return resolveEffects(state, pending.caster, caster, definition, {
    castLevel: pending.level,
    route: chosen.value,
    targets: pending.targets,
    unverified: [...pending.unverified],
    supply,
    castingId: pending.castingId,
    events,
    ...(pending.origin === undefined ? {} : { from: pending.origin }),
    ...(persists(definition)
      ? {
          becomesOngoing: {
            spellId: definition.id,
            on: onCaster(definition)
              ? ('caster' as const)
              : pending.origin === undefined
                ? ('targets' as const)
                : ('point' as const),
            ...(definition.area === undefined ? {} : { fromArea: true as const }),
            ...((pending.origin ?? pending.area?.at) === undefined
              ? {}
              : { origin: (pending.origin ?? pending.area?.at)! }),
            ...(pending.area?.towards === undefined ? {} : { towards: pending.area.towards }),
            ...(pending.area?.anchoring === undefined
              ? {}
              : { anchoring: pending.area.anchoring }),
          },
        }
      : {}),
  });
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
function unsettledRefusal(state: GameState, who: CharacterId): Err | null {
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
  return mayAct(state, who);
}

/**
 * Whether anybody may take a voluntary action right now, and this creature in
 * particular.
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
 * One function, called by every command that spends an Action, a Bonus Action,
 * movement or a feature's use, rather than a sentence each of them writes out
 * again.
 */
export function mayAct(state: GameState, who: CharacterId): Err | null {
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
  // **The duplicate check comes first, always.** A retry arrives at whatever
  // the world has become since its first run — a damage roll somebody else
  // has since held open, a save the next boundary raised — and every guard
  // below reports that world instead of the fact that the command already
  // landed. `resolveCast` owns the identity and answers the retry with an
  // empty batch; everything between here and there is skipped for one.
  const replayed = request.commandId !== undefined && wasCommandApplied(state, request.commandId);

  // A turn-boundary save outstanding means somebody may or may not still be
  // Paralyzed, and a damage roll or a D20 Test held open is an outcome nobody
  // has settled; casting into either would change the world underneath it.
  // See `unsettledRefusal`, which `activateSpell` reads too.
  if (!replayed) {
    const unsettled = unsettledRefusal(state, casterId);
    if (unsettled !== null) return unsettled;
  }

  const caster = creatureOf(state, casterId);
  if (caster === null) return unknownCreature(casterId);

  const definition = definitionFor(request.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${request.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // Before anything is spent, and before a die is thrown. A Reaction is a
  // whole action-economy slot and usually a spell slot too, and handing both
  // over for a moment that never came is the expensive kind of wrong. A
  // released readied spell is exempt: its trigger was declared and paid for
  // when it was readied, and this is the release.
  //
  // **After the duplicate check, never before it.** The first Shield closed
  // the very attack that triggered it, so by the time a retry arrives the
  // trigger is gone — and reporting `no_trigger` for a casting that already
  // happened is the exact confusion command ids exist to prevent. A retry must
  // report the duplicate; `resolveCast` below returns the empty batch.
  if (held === null && !replayed) {
    const refused = triggerRefusal(state, casterId, definition, request);
    if (refused !== null) return refused;
  }

  // A casting already open is a moment the rules are in the middle of, and the
  // only thing that may happen in it is the Reaction that answers it. Anything
  // else would be a second spell begun before the first has taken effect.
  //
  // Checked against the trigger rather than against the spell, so this stays a
  // rule about *answering a casting* rather than a mention of Counterspell in
  // the middle of the casting path.
  //
  // **After the duplicate check, never before it** — the same trap the trigger
  // above fell into, and it bites harder here: a retried *declaration* looks
  // at a window its own first run opened, so an eager guard reports
  // `casting_pending` for the command that opened it. A retry must report the
  // duplicate; `resolveCast` below returns the empty batch.
  const open = state.pendingCasting;
  if (open !== null && !replayed && definition.trigger !== 'casting-a-spell') {
    return err(
      'casting_pending',
      `${open.caster} is midway through casting ${open.spell}; settle that casting before beginning another`,
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

  // — the two facts the caster states, and the engine will not guess ————————
  //
  // Validated here, before a slot or an action is spent, so a casting that
  // names an unknown creature or a damage type the spell never prints costs
  // nothing. Both are clauses transcribed from the book, and both refuse to be
  // used by a spell that does not print them — a field quietly ignored is a
  // caller who thinks they said something.
  const declared = declaredFacts(state, definition, request);
  if (!declared.ok) return declared;

  // — targets ————————————————————————————————————————————————————————————
  //
  // Two ways a spell finds its targets, and they do not mix. A named-target
  // spell is handed ids; an area spell is handed a place and works out for
  // itself who is standing in it.
  const reach = ranged(definition.range);
  let targets: readonly CharacterId[];

  // — the point it keeps ——————————————————————————————————————————————————
  //
  // Before the targets, because the targets are measured from it: SRD
  // Spiritual Weapon aims at "one creature within 5 feet of **the force**",
  // and the force has to be somewhere before that sentence has a meaning.
  let origin: Point | null = null;
  if (definition.origin !== undefined) {
    const placed = placeOrigin(state, casterId, definition, request.at, reach, needs);
    if (!placed.ok) return placed;
    origin = placed.value;
  }

  // Where a **persistent** area sits, kept exactly as `placeArea` resolved it.
  // The shape and its dimensions are printed and reconstruct themselves; the
  // point and the direction were decisions taken once, at this casting, and
  // nothing else in the engine remembers them.
  let area: {
    readonly at: Point;
    readonly towards?: Point;
    readonly anchoring?: PointAnchoring;
  } | null = null;

  if (definition.area !== undefined) {
    const resolved = areaTargets(state, casterId, definition, definition.area, request, reach);
    if (!resolved.ok) return resolved;
    targets = resolved.value;
    if (definition.areaTrigger !== undefined && request.at !== undefined) {
      area = {
        at: request.at,
        ...(request.towards === undefined ? {} : { towards: request.towards }),
        // `space` *is* the absence, so a casting that names it explicitly
        // serialises exactly as one that says nothing. Two records that mean
        // the same thing have to fold to the same bytes.
        ...(request.anchoring === undefined || request.anchoring === 'space'
          ? {}
          : { anchoring: request.anchoring }),
      };
    }
  } else {
    const named = namedTargets(state, casterId, definition, request, castLevel, reach, needs, origin);
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
    origin,
    area,
  });
}

/**
 * Where a spell's area sits and what shape it is.
 *
 * Shared by the two callers that need it, and they need it for opposite
 * reasons: an `area` uses the result to *find* its targets, while a
 * `targetsWithin` uses it to *bound* the targets the caller already named.
 * The rules about placing it are the same either way — a self-originating
 * shape refuses to be moved, a point must be given and must be in range, and
 * a Cone, Cube or Line has to be pointed somewhere — so they live here rather
 * than being written twice and drifting apart.
 */
/**
 * The clauses a casting states rather than derives, checked before anything is
 * spent.
 *
 * Two SRD sentences, both about facts the engine cannot see for itself:
 *
 * | Clause | Spells | Why the engine will not decide it |
 * |---|---|---|
 * | "you can designate creatures to be unaffected by it" | Spirit Guardians, Alarm | it is the caster's choice, and allegiance is a different question |
 * | "Radiant (if you are good or neutral) or Necrotic (if you are evil)" | Spirit Guardians | alignment is held for a character the engine built and for nobody else |
 *
 * **A field a spell does not print is a refusal, not a shrug.** A caller who
 * designates somebody unaffected by a Fireball has misunderstood something,
 * and silently dropping it would let them go on believing it.
 */
function declaredFacts(
  state: GameState,
  definition: SpellDefinition,
  request: CastSpellRequest,
): Result<null> {
  const named = request.unaffected ?? [];
  if (named.length > 0) {
    if (definition.designatesUnaffected !== true) {
      return err(
        'no_designation',
        `${definition.name} does not let its caster designate creatures unaffected by it`,
      );
    }
    for (const who of named) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
    }
    if (new Set(named).size !== named.length) {
      return err('duplicate_designation', `${definition.name} may not designate the same creature twice`);
    }
  }

  const types = definition.damageTypeStated;
  if (types === undefined) {
    if (request.damageType !== undefined) {
      return err(
        'damage_type_fixed',
        `${definition.name} prints one damage type; naming another is not a choice the spell offers`,
      );
    }
    return ok(null);
  }

  // **Stated or refused, never defaulted.** Picking Radiant because most
  // clerics are good would be the engine answering a question the SRD asked
  // about the caster — and a Necrotic-immune Undead is where that answer
  // shows.
  if (request.damageType === undefined) {
    return err(
      'damage_type_required',
      `${definition.name} deals ${types.join(' or ')} depending on its caster, and the engine does not hold that; name which`,
    );
  }
  if (!types.includes(request.damageType)) {
    return err(
      'unknown_damage_type',
      `${definition.name} deals ${types.join(' or ')}, not ${request.damageType}`,
    );
  }
  return ok(null);
}

function placeArea(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  area: SpellArea,
  request: CastSpellRequest,
  reach: number | null,
  placed: Point,
): Result<{ readonly origin: AreaOrigin; readonly shape: AreaShape }> {
  if (state.scene === null) {
    return err('no_scene', `${definition.name} needs a scene for its area to sit in`);
  }

  // Where it starts. `self` means the caster and refuses to be moved; `point`
  // must be given and must be within the spell's range.
  //
  // **One anchoring for the whole template.** The origin and the point a
  // directional shape is aimed at are read under the same convention, so the
  // axis between them is the difference of two coordinates in one frame and
  // cannot pick up a half-space tilt. A self-origin area is anchored by the
  // caster's own space, so there is no convention left to choose and naming
  // one is refused rather than ignored.
  const anchoring: PointAnchoring = request.anchoring ?? 'space';
  let origin: AreaOrigin;
  if (area.origin === 'self') {
    if (request.at !== undefined) {
      return err(
        'area_starts_at_caster',
        `${definition.name} originates from you; it cannot be placed elsewhere`,
      );
    }
    if (request.anchoring !== undefined && request.anchoring !== 'space') {
      return err(
        'area_starts_at_caster',
        `${definition.name} originates from you; its area is anchored by your own space`,
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
    origin = areaPointAt(request.at, anchoring);
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

  // A self-origin area is anchored by the caster's space, so its direction is
  // read the same way; otherwise the origin's own convention carries.
  const aim = areaPointAt(towards ?? placed, area.origin === 'self' ? 'space' : anchoring);

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
      shape = { kind: 'cone', length: area.length, towards: aim };
      break;
    case 'cube':
      shape = { kind: 'cube', size: area.size, towards: aim };
      break;
    case 'line':
      shape = { kind: 'line', length: area.length, width: area.width, towards: aim };
      break;
  }

  return ok({ origin, shape });
}

/**
 * Where the point a casting keeps is going to be.
 *
 * SRD Spiritual Weapon: "The force appears **within range in a space of your
 * choice**." Three facts settle it and every one of them is the engine's:
 * the space is on the lattice, it is inside the scene, and it is within the
 * spell's printed Range of the caster.
 *
 * **The caller chooses and the engine validates**, which is the same division
 * `placeArea` makes for an area's point — and the reason `at` is required
 * rather than swept for: a force that appeared somewhere nobody chose is
 * precisely the incoherence the positioning model exists to prevent.
 *
 * Returns null when a *fact* is missing rather than a rule broken: the caster
 * has no position to measure from, or there is no scene for a point to be in.
 * Those go into `needs` and the casting is retried once they are established,
 * having cost nothing.
 */
function placeOrigin(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  at: Point | undefined,
  reach: number | null,
  needs: ContextRequest[],
): Result<Point | null> {
  if (at === undefined) {
    return err(
      'no_origin',
      `${definition.name} appears in a space of your choice; name the space`,
    );
  }

  if (state.scene === null) {
    needs.push({
      kind: 'scene',
      subject: casterId,
      need: 'a scene, so that a point in it means something',
      because: `${definition.name} leaves something standing at a point you choose`,
      satisfyWith: 'a scene-set event',
    });
    return ok(null);
  }

  // "A space of your choice" — a space is a cube on the lattice, and a stored
  // coordinate should be one the engine could have produced itself.
  const space = snapToSpace(at);

  if (!isInsideScene(state.scene, space)) {
    return err(
      'outside_scene',
      `${definition.name} cannot put anything at (${space.x}, ${space.y}, ${space.z}); that is outside this scene`,
    );
  }

  if (reach !== null) {
    const away = distanceToPoint(state.scene, casterId, space);
    if (!away.ok) {
      needs.push({
        kind: 'position',
        subject: casterId,
        need: `where ${casterId} is standing`,
        because: `${definition.name} appears within ${reach} feet of you`,
        satisfyWith: `a creature-placed event for ${casterId}`,
      });
      return ok(null);
    }
    if (away.value > reach) {
      return err(
        'out_of_range',
        `${definition.name} reaches ${reach} feet; that space is ${away.value} away`,
      );
    }
  }

  return ok(space);
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

  const placement = placeArea(state, casterId, definition, area, request, reach, placed);
  if (!placement.ok) return placement;

  const caught = creaturesInArea(state.scene, placement.value.origin, placement.value.shape);
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
  /** The point this casting keeps, already placed and checked. */
  origin: Point | null,
): Result<readonly CharacterId[]> {
  // Two shapes take both a point and a target list, for different reasons: a
  // bounded list, where the point places the area the targets must stand in,
  // and a casting with an origin, where the point is what the targets are
  // measured *from*.
  const bound = definition.targetsWithin;
  const takesPoint = bound !== undefined || definition.origin !== undefined;
  if (!takesPoint && (request.at !== undefined || request.towards !== undefined)) {
    return err(
      'not_an_area',
      `${definition.name} is cast on a target, not at a place`,
    );
  }
  // A point a casting *keeps* is a place, not a template, so there is nothing
  // to aim it along.
  if (bound === undefined && request.towards !== undefined) {
    return err('not_directional', `${definition.name} has no direction to point`);
  }

  const allowed = targetCountFor(definition.targets, definition.level, castLevel);

  // A spell that aims at nobody. SRD's "Range: Self" utility spells — Detect
  // Magic, Disguise Self — and the ones that act on an object or a point, like
  // Light and Mage Hand. They are cast, they cost what they cost and they run
  // for their duration; there is simply no creature to check.
  const unlimited = definition.targets.unlimited === true;
  if (allowed === 0 && !unlimited) {
    if (request.targets.length > 0) {
      return err('takes_no_target', `${definition.name} is not cast on a creature`);
    }
    return ok([]);
  }

  if (request.targets.length === 0) {
    // SRD Spiritual Weapon: "you **can** immediately make one melee spell
    // attack." The force appears whether or not anything is standing beside
    // it, and refusing that would be a rule the book does not have.
    if (definition.targets.optional === true) return ok([]);
    return err('no_targets', `${definition.name} needs a target`);
  }
  // "Each creature of your choice" states no number, so there is none to
  // exceed. Range and sight still bound it, target by target, below.
  if (!unlimited && request.targets.length > allowed) {
    return err(
      'too_many_targets',
      `${definition.name} at level ${castLevel} takes ${allowed} target(s), got ${request.targets.length}`,
    );
  }
  if (new Set(request.targets).size !== request.targets.length) {
    return err('duplicate_target', `${definition.name} may not take the same target twice`);
  }

  // The bound, worked out once. Its point carries the spell's range, so the
  // per-target range check below stands down — SRD reaches 60 feet to place a
  // 30-foot Sphere, and a creature 85 feet away inside it is a legal target.
  let eligible: ReadonlySet<CharacterId> | null = null;
  if (bound !== undefined) {
    if (state.scene === null) {
      return needsContext(
        'no_scene',
        `${definition.name} chooses its targets inside an area and there is no scene for it to sit in`,
        [
          {
            kind: 'scene',
            subject: casterId,
            need: 'a scene, so that an area has somewhere to be',
            because: `${definition.name} bounds its targets by an area`,
            satisfyWith: 'a scene-set event',
          },
        ],
      );
    }
    const placed = positionOf(state.scene, casterId);
    if (placed === null) {
      return needsContext(
        'unplaced',
        `nobody has said where ${casterId} is standing, and ${definition.name} measures its area from there`,
        [
          {
            kind: 'position',
            subject: casterId,
            need: `where ${casterId} is standing`,
            because: `${definition.name} places its area within range of you`,
            satisfyWith: `a creature-placed event for ${casterId}`,
          },
        ],
      );
    }
    const placement = placeArea(state, casterId, definition, bound, request, reach, placed);
    if (!placement.ok) return placement;
    const caught = creaturesInArea(state.scene, placement.value.origin, placement.value.shape);
    if (!caught.ok) return caught;
    eligible = new Set(caught.value);
  }

  for (const target of request.targets) {
    if (state.creatures[target] === undefined) {
      return unknownCreature(target);
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
          satisfyWith: `declareCreatureType(${target}, …), or a creatureType when the creature is added`,
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

      if (origin !== null) {
        // SRD Spiritual Weapon: "one creature within 5 feet of **the force**."
        // The spell's own Range placed the force; it is not re-spent on the
        // target, so a creature the caster could never reach is fair game and
        // one standing beside the caster may be out of reach entirely.
        const from = definition.origin?.reach ?? 0;
        const away = distanceToPoint(state.scene, target, origin);
        if (!away.ok) {
          needs.push({
            kind: 'position',
            subject: target,
            need: `where ${target} is standing`,
            because: `${definition.name} reaches ${from} feet from the point it holds`,
            satisfyWith: `a creature-placed event for ${target}`,
          });
        } else if (away.value > from) {
          return err(
            'out_of_range',
            `${definition.name} reaches ${from} feet from where it stands; ${target} is ${away.value} away`,
          );
        }
      } else if (eligible !== null) {
        // The area is the bound, so an unplaced creature is a fact to go and
        // get rather than someone standing outside it.
        if (positionOf(state.scene, target) === null) {
          needs.push({
            kind: 'position',
            subject: target,
            need: `where ${target} is standing`,
            because: `${definition.name} may only be aimed at a creature inside its area`,
            satisfyWith: `a creature-placed event for ${target}`,
          });
        } else if (!eligible.has(target)) {
          return err(
            'outside_area',
            `${definition.name} may only be aimed at a creature inside its area; ${target} is not in it`,
          );
        }
      } else {
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
    /** The point this casting keeps, for a spell that holds one. */
    readonly origin: Point | null;
    /** Where a persistent area sits, for a spell that leaves one behind. */
    readonly area: {
      readonly at: Point;
      readonly towards?: Point;
      readonly anchoring?: PointAnchoring;
    } | null;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, held, origin, area } = context;
  const ongoingWith = (): OngoingRecordPlan => ({
    spellId: definition.id,
    // **Three answers, stated rather than inferred.** A Range: Self spell is
    // on its caster; a casting that holds a point is on the point and so on
    // nobody; everything else is on whoever it actually caught.
    on: onCaster(definition) ? 'caster' : origin === null ? 'targets' : 'point',
    ...(definition.area === undefined ? {} : { fromArea: true as const }),
    ...(origin === null && area === null ? {} : { origin: origin ?? area!.at }),
    ...(area?.towards === undefined ? {} : { towards: area.towards }),
    ...(area?.anchoring === undefined ? {} : { anchoring: area.anchoring }),
    // Two facts the caster stated at the casting, kept because every later
    // sentence of the spell reads them and neither can be recovered from
    // anything else. **A carried area records no position**: `caster` and the
    // definition's `origin: 'self'` already say where it is.
    ...(request.unaffected === undefined || request.unaffected.length === 0
      ? {}
      : { unaffected: [...request.unaffected].sort() }),
    ...(request.damageType === undefined ? {} : { damageType: request.damageType }),
  });

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
  // SRD Ready: "you cast it as normal (**expending any resources used to cast
  // it**) but hold its energy." The slot went when the spell was readied, so a
  // release has no unspent cost for Counterspell's "the slot isn't expended"
  // to spare, and there is no window to open here. `ReleaseCommand` has no
  // `hold` to ask for one, which is where that rule is actually enforced — a
  // runtime guard here would be unreachable code claiming to be a rule.
  if (held !== null) {
    return resolveEffects(state, casterId, caster, definition, {
      castLevel,
      route,
      targets,
      unverified,
      supply,
      castingId: held.castingId,
      events,
      ...(origin === null ? {} : { from: origin }),
      // A released spell leaves the same thing running that a cast one does.
      // This was the one resolution path of three that wrote no record, so a
      // readied Bless was running, concentrated on, and invisible to Dispel
      // Magic.
      ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
    });
  }

  const payment = choosePayment(definition, route, request);
  if (!payment.ok) return payment;
  const freePool = payment.value;

  // The DC a later examiner rolls against, fixed now. `route.ability` is the
  // *chosen* source's, so a Sage Fighter's Minor Illusion is seen through at
  // the feat's DC rather than at a class's.
  const offered = effectCheckFrom(
    definition.check,
    definition.name,
    spellSaveDcWith(caster.sheet, route.ability),
  );

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
    // A span of seconds, or a moment in the turn order. A definition carries
    // one or the other: Shield's "until the start of your next turn" is not
    // six seconds, and `resolveDuration` refuses to pretend otherwise where
    // there are no turns to anchor to.
    ...(definition.durationSeconds !== undefined
      ? { duration: { kind: 'seconds' as const, seconds: definition.durationSeconds } }
      : definition.durationUntil === undefined
        ? {}
        : { duration: riderDuration(definition.durationUntil, casterId)! }),
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
    // The window, and everything settlement will need to finish the job
    // without the caller getting to restate what the spell was aimed at —
    // the space it appears in included, for a spell that holds one.
    ...(request.hold === true
      ? {
          hold: {
            spellId: request.spellId,
            targets,
            unverified,
            ...(origin === null ? {} : { origin }),
            ...(area === null ? {} : { area }),
          },
        }
      : {}),
    ...(offered === undefined ? {} : { check: offered }),
  });
  if (!cast.ok) return cast;
  // A retried command: the first run did all of this. The casting id it
  // allocated is the one to report — `nextCastingId` would name the casting
  // that *would* come next, which is a different spell entirely.
  if (cast.value.length === 0) {
    const already =
      request.commandId === undefined ? null : commandOutcome(state, request.commandId);
    return ok({
      events: [],
      castingId: already?.castingId ?? castingId,
      outcomes: [],
      unverified: [],
    });
  }

  // SRD Mage Hand: "The hand vanishes ... if you cast this spell again."
  // **After the duplicate check**, so a retried casting does not end the
  // casting its own first run created — the same trap the trigger guard and
  // the pending-casting guard both sprang before it, and the third instance
  // of the rule that a retry must never look at the world it made.
  events.push(...replacedCastings(state, casterId, definition));
  events.push(...cast.value);

  // Declared and held open. The action is spent, any Concentration the caster
  // was holding is gone, and the slot is not — which is exactly the state SRD
  // Counterspell describes and the reason the effects are not run here.
  if (request.hold === true) {
    return ok({ events, castingId, outcomes: [], unverified });
  }

  const resolved = resolveEffects(state, casterId, caster, definition, {
    castLevel,
    route,
    targets,
    unverified,
    supply,
    castingId,
    events,
    ...(origin === null ? {} : { from: origin }),
    ...(persists(definition) ? { becomesOngoing: ongoingWith() } : {}),
  });
  if (!resolved.ok) return resolved;

  // The spell has landed; now the attack it answered is re-measured against
  // what it did. Nothing for any spell that is not a Reaction to a hit.
  const deflected = deflectTriggeringAttack(state, casterId, definition, resolved.value.events);
  if (deflected.length === 0) return resolved;

  return ok({ ...resolved.value, events: [...resolved.value.events, ...deflected] });
}

/**
 * What a spell does, once it has been paid for.
 *
 * Split from the payment above it for exactly one reason: SRD Ready pays on
 * one turn and resolves on another, and everything from here down is the same
 * either way. Nothing else about the two halves differs, which is why they are
 * one function called twice rather than two functions kept in step by hand.
 */
/**
 * The `damage-scheduled` event a delayed hit needs, or nothing.
 *
 * SRD writes the moment as "at the end of its next turn" — anchored to the
 * **target**, which is why this cannot reuse `riderDuration`'s caster-anchored
 * pair. `endOfNextTurn` already encodes the asymmetry that makes it right: said
 * on the target's own turn, the end of their *next* turn is two turn-endings
 * away, not one.
 *
 * Outside combat there are no turns for it to be the end of, so nothing is
 * scheduled and the caller is told. Refusing the whole casting would be worse
 * — Acid Arrow is perfectly legal at a fleeing target nobody has rolled
 * Initiative against, and its first 4d4 lands either way.
 */
function scheduleDelayed(
  state: GameState,
  target: CharacterId,
  delayed: DelayedDamage,
  context: {
    readonly casterId: CharacterId;
    readonly definition: SpellDefinition;
    readonly castingId: string;
    readonly castLevel: number;
    readonly casterLevel: number;
    readonly unverified: string[];
  },
): GameEvent | null {
  const { casterId, definition, castingId, castLevel, casterLevel, unverified } = context;

  const deadline = resolveDuration(timeView(state), endOfNextTurn(target));
  if (!deadline.ok) {
    unverified.push(
      `${definition.name} owes ${target} a second hit at the end of their next turn, and there are no turns outside combat; it was not scheduled`,
    );
    return null;
  }

  return {
    type: 'damage-scheduled',
    schedule: {
      target,
      by: casterId,
      deadline: deadline.value,
      notation: scaledDiceFor(delayed.damage, definition.level, casterLevel, castLevel),
      damageType: delayed.damageType,
      source: `${definition.name}#${castingId}`,
      label: `${definition.name} (delayed)`,
    },
  };
}

function resolveEffects(
  state: GameState,
  casterId: CharacterId,
  /**
   * Null when the casting has outlived its caster.
   *
   * SRD Grease runs its minute whether or not the wizard does, and a save it
   * calls for afterwards is still owed. Only effects that read nothing off a
   * sheet can be resolved then, which is checked before this is called —
   * {@link casterSheet} is the accessor that says so out loud.
   */
  caster: CreatureState | null,
  definition: SpellDefinition,
  context: {
    readonly castLevel: number;
    /** Null for a later use, which rolls with {@link context.numbers}. */
    readonly route: CastingRoute | null;
    /** The numbers this casting was made with, for every use after the first. */
    readonly numbers?: CastingNumbers;
    readonly targets: readonly CharacterId[];
    readonly unverified: string[];
    readonly supply: ConcentrationSaveSupply;
    readonly castingId: string;
    readonly events: GameEvent[];
    /**
     * What to run, when it is not the spell's own effect list.
     *
     * SRD Vampiric Touch does the same thing on a later turn that it did on
     * the first, so the later turn runs a list the definition supplies rather
     * than a second resolver kept in step with this one by hand.
     */
    readonly effects?: readonly SpellEffect[];
    /** How the log reads, when an activation wants its own wording. */
    readonly label?: string;
    /**
     * Where the spell acts **from**, when that is not the caster's own space.
     *
     * The one seam Spiritual Weapon needed and the smallest it could be: the
     * roller, the attack modifier and the dice are all still the caster's, and
     * only the *spatial* questions move. SRD reads the force's adjacency, not
     * the Cleric's — "a creature within 5 feet of the force" — so the Prone
     * rule ("Advantage if the attacker is within 5 feet of you") is answered
     * from here too.
     *
     * Not a teleport and not a creature: nothing about the caster's position
     * changes, and there is no second actor. Absent means the caster acts from
     * where they stand, which is every other spell in the book.
     */
    readonly from?: Point;
    /**
     * Set when this casting leaves something running.
     *
     * Recorded **after** the effects rather than beside the slot, because what
     * a spell is *on* is not who it was aimed at: a target who saved against
     * Banishment is not banished, and a record claiming otherwise would let
     * Dispel Magic end a spell that was never on them.
     *
     * Absent for an activation, which acts through a record that already
     * exists rather than making a second one.
     */
    readonly becomesOngoing?: OngoingRecordPlan;
  },
): Result<SpellResolution> {
  const { castLevel, route, targets, unverified, supply, castingId, events } = context;
  const running = context.effects ?? definition.effects;
  const label = context.label ?? definition.name;

  /**
   * The caster's sheet, for the rolls that genuinely need one.
   *
   * A casting that outlives its caster keeps its *numbers* and loses its
   * *sheet*, and the two are not the same thing: a save DC is pinned, while
   * the dice a caster throws are thrown by a creature. Every effect that needs
   * this is refused before it gets here — `settleAreaEffects` checks, and a
   * test asserts no registered spell can reach it — so arriving here with no
   * caster is a programmer error rather than a rules dispute, and is loud.
   */
  const casterSheet = (): CreatureState => {
    if (caster === null) {
      throw new Error(
        `${definition.name} needs its caster's sheet to resolve and ${casterId} has left the game; ` +
          'the caller should have refused this effect rather than reaching here',
      );
    }
    return caster;
  };

  // — what it does ———————————————————————————————————————————————————————
  let current = events.reduce(applyEvent, state);
  const outcomes: SpellTargetOutcome[] = [];
  // Whom this casting has left something of its own on — see {@link landedOn}.
  const held = new Set<CharacterId>();
  const issuedBefore = supply.issuer.count;

  // **Derived once, at the casting, and read from the record ever after.**
  // The *chosen source's* ability, not the class's — a feat brings its own —
  // and a later use of the same casting takes the numbers it was made with
  // rather than asking a sheet that may have levelled since.
  const numbers: CastingNumbers = context.numbers ?? {
    attackModifier: spellAttackModifierWith(casterSheet().sheet, route!.ability),
    saveDc: spellSaveDcWith(casterSheet().sheet, route!.ability),
    spellcastingModifier: modifierFor(casterSheet().sheet, route!.ability),
    casterLevel: casterSheet().sheet.level,
  };
  const attackModifier = numbers.attackModifier;
  const saveDc = numbers.saveDc;

  for (const target of targets) {
    for (const effect of running) {
      const victim = current.creatures[target];
      if (victim === undefined) continue;

      if (effect.kind === 'attack') {
        const attack = rollAttack(supply.issuer, supply.rng, casterSheet().sheet, {
          weapon: null,
          targetAc: armorClassOf(current, target),
          attackBonuses: [
            { source: `${definition.name} (spell attack)`, flat: attackModifier },
            // Bless is on the caster, not in the caller's head.
            ...bonusesFor((caster?.bonuses ?? []), 'attack'),
            ...(supply.bonuses ?? []),
          ],
          ...(supply.modes === undefined ? {} : { modes: supply.modes }),
          // A condition a feature has suppressed gives an attacker nothing:
          // SRD Aura of Courage says the condition "has no effect on that ally
          // while there", and being easier to hit is an effect.
          targetConditions: effectiveConditions(current, target),
          // Prone reads the distance, and a spell attack is measured the same
          // way a weapon's is — **from where the attack comes from**, which
          // for a casting that holds a point is that point rather than the
          // caster. Absent where nobody has placed them, so the rule gives no
          // answer rather than a guessed one.
          ...(apartFromSource(current, context.from, casterId, target) === null
            ? {}
            : { withinFiveFeet: apartFromSource(current, context.from, casterId, target)! <= 5 }),
        });
        if (!attack.ok) return attack;

        events.push({
          type: 'roll-recorded',
          who: casterId,
          label: `${label} attack`,
          natural: attack.value.roll.natural,
          total: attack.value.total,
          contributions: [{ source: 'spell attack', amount: attackModifier }],
          outcome: attack.value.hit ? 'hit' : 'miss',
        });

        if (!attack.value.hit) {
          outcomes.push({ target, attack: attack.value, affected: false });
          continue;
        }

        const dice = scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel);
        // A critical doubles the dice, which is `rollAttackDamage`'s job, so
        // this one call keeps the weapon-shaped signature rather than going
        // through `rollSpellDice`.
        const rolled = rollAttackDamage(
          supply.issuer,
          supply.rng,
          casterSheet().sheet,
          {
            weapon: null,
            targetAc: armorClassOf(current, target),
            extraDamage: [{ source: definition.name, type: effect.damageType, dice }],
          },
          attack.value.critical,
        );
        if (!rolled.ok) return rolled;

        const hurt = dealSpellDamage(
          current,
          target,
          withFlatAddend(
            rolled.value.components.filter((c) => c.source === definition.name),
            // SRD Flame Blade: "3d6 **plus your spellcasting ability
            // modifier**" — the chosen route's, so a feat's version adds its
            // own. A flat addend printed beside the dice adds on top of it.
            scaledFlatFor(effect.damage, definition.level, castLevel) +
              (effect.addSpellcastingModifier === true
                ? numbers.spellcastingModifier
                : 0),
          ),
          definition.name,
          supply,
          { by: casterId, ...(attack.value.critical ? { critical: true } : {}) },
        );
        if (!hurt.ok) return hurt;

        events.push(...hurt.value.events);
        current = hurt.value.events.reduce(applyEvent, current);

        // SRD Vampiric Touch: "you regain Hit Points equal to **half the
        // amount of Necrotic damage dealt**." Half of what actually landed, so
        // a resistant target heals the caster for less — which is why it reads
        // the damage taken rather than the dice thrown. Rounding is the SRD's
        // usual: down, and a single point heals nothing.
        if (effect.healsCasterForHalf === true && hurt.value.amount > 0) {
          const back = Math.floor(hurt.value.amount / 2);
          if (back > 0) {
            const drained = healCreature(current, casterId, back);
            if (!drained.ok) return drained;
            events.push(...drained.value);
            current = drained.value.reduce(applyEvent, current);
          }
        }

        // SRD Ray of Sickness: "On a hit, the target takes 2d8 Poison damage
        // **and** has the Poisoned condition". The attack roll settled it up
        // there; a miss already returned, so reaching here is the hit.
        if (effect.condition !== undefined) {
          held.add(target);
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

        // SRD Acid Arrow: "and 2d4 Acid damage at the end of its next turn".
        // A miss already returned above, so reaching here is the hit — the
        // same branch the condition rider takes, for the same reason.
        if (effect.delayed !== undefined) {
          const scheduled = scheduleDelayed(current, target, effect.delayed, {
            casterId,
            definition,
            castingId,
            castLevel,
            casterLevel: numbers.casterLevel,
            unverified,
          });
          if (scheduled !== null) {
            events.push(scheduled);
            current = applyEvent(current, scheduled);
          }
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
        const dice = scaledDiceFor(effect.amount, definition.level, numbers.casterLevel, castLevel);
        const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'temporary', dice);
        if (!rolled.ok) return rolled;

        const flat = scaledFlatFor(effect.amount, definition.level, castLevel);
        const modifier = effect.addSpellcastingModifier
          ? numbers.spellcastingModifier
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
        held.add(target);
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
        const dice = scaledDiceFor(effect.healing, definition.level, numbers.casterLevel, castLevel);
        const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'healing', dice);
        if (!rolled.ok) return rolled;

        // SRD: "2d8 plus your spellcasting ability modifier" — and it is the
        // *chosen route's* ability, so a feat's version heals by its own.
        const bonus = effect.addSpellcastingModifier ? numbers.spellcastingModifier : 0;
        const addend = scaledFlatFor(effect.healing, definition.level, castLevel);
        const amount = Math.max(
          0,
          rolled.value.reduce((sum, c) => sum + c.total, 0) + bonus + addend,
        );

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

        // SRD Evasion: a successful Dexterity save against an effect that
        // would have halved the damage takes **none** of it, and a failed one
        // takes half. Read off the *target's* features, because it is a
        // defence rather than something the caster does.
        const evading = evadesHalfDamage(current, target, effect.ability, effect.onSuccess === 'half');

        // Nothing at all on a success means no damage roll either: the spell
        // did nothing, and rolling would move the generator for no reason.
        // Evasion reaches the same place from the other direction.
        if (save.value.success && (effect.onSuccess === 'none' || evading)) {
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
          const dice = scaledDiceFor(part.damage, definition.level, numbers.casterLevel, castLevel);
          const rolled = rollSpellDice(
            supply,
            casterSheet().sheet,
            definition.name,
            part.damageType,
            dice,
          );
          if (!rolled.ok) return rolled;
          rolledParts.push(
            ...withFlatAddend(
              rolled.value,
              scaledFlatFor(part.damage, definition.level, castLevel),
            ),
          );
        }

        // SRD: "The halved damage is equal to half the damage that would be
        // dealt on a failed save." Half of what the spell deals, therefore
        // *before* the target's own Resistance — which then halves again.
        // Without Evasion the success is halved; with it the *failure* is,
        // and the success took nothing at all above.
        const halve = evading ? !save.value.success : save.value.success;
        const components = halve
          ? rolledParts.map((c) => ({ ...c, total: Math.floor(c.total / 2) }))
          : rolledParts;

        const hurt = dealSpellDamage(
          current,
          target,
          components,
          definition.name,
          supply,
          { by: casterId },
        );
        if (!hurt.ok) return hurt;

        events.push(...hurt.value.events);
        current = hurt.value.events.reduce(applyEvent, current);

        // SRD Sunbeam: "takes 6d8 Radiant damage **and** has the Blinded
        // condition". The same failed save, so no second roll — and nothing at
        // all on a success, because the condition is on the failure branch of
        // a sentence the damage only half-shares.
        if (effect.condition !== undefined && !save.value.success) {
          const escape = effectCheckFrom(effect.condition.check, definition.name, saveDc);
          held.add(target);
          const rider = applySpellEffect(current, target, effect.condition.name, casterId, {
            casting: { castingId, spell: definition.name },
            ...(riderDuration(effect.condition.lasts, casterId) === undefined
              ? {}
              : { duration: riderDuration(effect.condition.lasts, casterId)! }),
            ...(escape === undefined ? {} : { check: escape }),
          });
          if (!rider.ok) return rider;
          events.push(...rider.value);
          current = rider.value.reduce(applyEvent, current);
        }

        // SRD Vitriolic Sphere: "On a successful save, a creature takes half
        // the initial damage **only**." Half the damage, none of the later
        // hit — the success branch owes nothing, however much it still hurt.
        if (effect.delayed !== undefined && !save.value.success) {
          const scheduled = scheduleDelayed(current, target, effect.delayed, {
            casterId,
            definition,
            castingId,
            castLevel,
            casterLevel: numbers.casterLevel,
            unverified,
          });
          if (scheduled !== null) {
            events.push(scheduled);
            current = applyEvent(current, scheduled);
          }
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

      if (effect.kind === 'save') {
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

        const shakeOff = effectCheckFrom(effect.check, definition.name, saveDc);
        // A condition the casting causes but does not keep is recorded under
        // the spell's bare name: legible in the log, and linked to nothing
        // that could later take it away. See `outlivesCasting`.
        const landed = applySpellEffect(current, target, effect.condition, casterId, {
          casting: { castingId, spell: definition.name },
          ...(effect.outlivesCasting === true ? { unowned: true as const } : {}),
          ...(shakeOff === undefined ? {} : { check: shakeOff }),
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
        if (effect.outlivesCasting !== true) held.add(target);
        outcomes.push({
          target,
          save: save.value,
          condition: effect.condition,
          affected: true,
        });
        continue;
      }

      if (effect.kind === 'dispel') {
        // SRD Dispel Magic: "Any ongoing spell of level 3 or lower **on the
        // target** ends." What is on the target is live state, and before the
        // ongoing record the engine could not have answered it: a spell's
        // level lived in the log and on a concentrating caster, and neither is
        // a thing a later spell can ask about.
        const running = ongoingSpellsOn(current, target);
        if (running.length === 0) {
          outcomes.push({ target, affected: false });
          continue;
        }

        for (const spell of running) {
          // SRD "Using a Higher-Level Spell Slot": "You automatically end a
          // spell on the target if the spell's level is equal to or less than
          // the level of the spell slot you use." Dispel Magic is level 3, so
          // the printed "level 3 or lower" is the same sentence read at the
          // spell's own level — one rule, not two.
          const automatic = spell.level <= castLevel;
          let rolled: D20TestResult | undefined;

          if (!automatic) {
            // "make an ability check using your spellcasting ability (DC 10
            // plus that spell's level)" — a bare ability check, no skill and
            // no proficiency, through the one calculator the engine has.
            const check = rollAbilityCheck(
              supply.issuer,
              supply.rng,
              casterSheet().sheet,
              route!.ability,
              {
                dc: 10 + spell.level,
                conditions: effectiveConditions(current, casterId),
                ...(supply.modes === undefined ? {} : { modes: supply.modes }),
                ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
              },
            );
            if (!check.ok) return check;

            events.push(
              recordD20Test(
                casterId,
                `${definition.name} vs ${spell.spell} (level ${spell.level})`,
                check.value,
                check.value.success ? 'dispelled' : 'held',
              ),
            );

            if (!check.value.success) {
              // A failed check changes nothing at all. The spell runs on, the
              // slot is still spent, and the log says which.
              outcomes.push({ target, check: check.value, affected: false });
              continue;
            }
            rolled = check.value;
          }

          // Whether the whole casting ends or only its hold on this creature
          // is the distinction SRD draws by letting Dispel Magic target "one
          // creature, object, or magical effect": a spell that is on this
          // creature and nobody else has nothing left to be, so it ends, while
          // one that caught three creatures loses only this one.
          const whole = spell.on.length <= 1;
          const ended: GameEvent = {
            type: 'spell-ended',
            castingId: spell.castingId,
            on: whole ? null : target,
            reason: 'dispelled',
          };
          events.push(ended);
          current = applyEvent(current, ended);

          outcomes.push({
            target,
            // Present only when the spell was high enough to need one, which
            // is the difference between the two halves of the SRD's sentence.
            ...(rolled === undefined ? {} : { check: rolled }),
            dispelled: spell.castingId,
            affected: true,
          });
        }
        continue;
      }

      if (effect.kind === 'interrupt-casting') {
        // SRD Counterspell: "The creature makes a Constitution saving throw.
        // On a failed save, the spell dissipates with no effect."
        //
        // The window was proved open by the trigger before anything was spent.
        // It is read again here because the events emitted since — the
        // Counterspell's own casting — have been folded in, and reading the
        // stale copy would be reading a different game than the one being
        // changed.
        const open = current.pendingCasting;
        if (open === null) {
          return err(
            'nothing_to_interrupt',
            `${definition.name} found no casting in progress to interrupt`,
          );
        }

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

        // A success buys the caster nothing beyond their spell going ahead —
        // the SRD states no other consequence, so neither does this.
        if (save.value.success) {
          outcomes.push({ target, save: save.value, affected: false });
          continue;
        }

        const interrupted: GameEvent = {
          type: 'spell-interrupted',
          castingId: open.castingId,
          id: open.caster,
          by: casterId,
          reason: 'countered',
        };
        events.push(interrupted);
        current = applyEvent(current, interrupted);

        outcomes.push({
          target,
          save: save.value,
          affected: true,
          interrupted: open.castingId,
        });
        continue;
      }

      // Eight kinds, eight branches, and the `never` binding is what keeps
      // that true. Until now the last kind was an unguarded fall-through, so
      // an effect this chain had no rule for was read as a saving throw: it
      // took `effect.ability` off a definition that has none and rolled
      // against a DC of NaN. A definition and its resolver disagreeing is a
      // bug in this repo rather than a rules dispute, so it is loud — and,
      // more to the point, a merge that drops one of these branches now
      // fails to compile instead of failing in a fight.
      const unhandled: never = effect;
      throw new Error(
        `no spell-effect rule for ${(unhandled as SpellEffect).kind}; ` +
          'the definition and the resolver disagree',
      );
    }
  }

  if (supply.issuer.count > issuedBefore) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  // The live half of the casting, now that it is known what the casting
  // actually caught. See `OngoingSpell` for why each field is there.
  const becomes = context.becomesOngoing;
  if (becomes !== undefined) {
    events.push({
      type: 'spell-ongoing',
      casting: {
        castingId,
        caster: casterId,
        spellId: becomes.spellId,
        spell: definition.name,
        level: castLevel,
        concentration: definition.concentration,
        route: route === null ? null : route.kind === 'granted' ? route.grant.source : `class:${route.classId}`,
        numbers,
        // **A casting that holds a point is on its point, not on a creature.**
        // The force is not on the goblin it hit, so a Dispel Magic aimed at
        // the goblin must not put it out — and `on: []` is the state the
        // record already has for a spell that caught nobody.
        on:
          becomes.on === 'caster'
            ? [casterId]
            : becomes.on === 'point'
              ? []
              : landedOn(targets, outcomes, becomes.fromArea === true, held),
        ...(becomes.origin === undefined ? {} : { origin: becomes.origin }),
        ...(becomes.towards === undefined ? {} : { towards: becomes.towards }),
        ...(becomes.anchoring === undefined ? {} : { anchoring: becomes.anchoring }),
        ...(becomes.unaffected === undefined ? {} : { unaffected: becomes.unaffected }),
        ...(becomes.damageType === undefined ? {} : { damageType: becomes.damageType }),
      },
    });
  }

  return ok({ events, castingId, outcomes, unverified });
}

/**
 * Which of the creatures a spell was aimed at it is actually **on**.
 *
 * A target the spell reported nothing about keeps its place: a tracked spell
 * resolves no effects at all and is still on whoever it was cast on, which is
 * how Darkvision gets dispelled. A target every effect reported as unaffected
 * comes off — a creature that saved against Banishment is not banished, and a
 * spell is not on somebody it failed to touch.
 *
 * Sorted, so the record serialises identically however the targets arrived.
 */
function landedOn(
  targets: readonly CharacterId[],
  outcomes: readonly SpellTargetOutcome[],
  fromArea: boolean,
  held: ReadonlySet<CharacterId>,
): readonly CharacterId[] {
  return [...targets]
    .filter((target) => {
      // **A casting is on a creature while it has a live effect there that the
      // casting owns**, which is the same rule `alsoOn` applies when a
      // triggered effect lands a minute later. One rule, two moments.
      //
      // So damage alone is not being *on* somebody — the swarm bit you and is
      // not carrying anything of yours — and neither is a condition the
      // casting caused and does not keep: SRD Grease knocks you Prone and
      // Prone is yours to stand up from, so a Dispel Magic aimed at you finds
      // no Grease to end.
      if (held.has(target)) return true;
      // **Standing in an area is not being cast on.** A tracked spell keeps a
      // target it reported nothing about because somebody *aimed* it there —
      // Darkvision is on the creature it was cast on. An area spell aimed at
      // nobody: the geometry found them, and a Web that has done nothing to
      // you yet is not on you.
      const said = outcomes.filter((outcome) => outcome.target === target);
      return said.length === 0 && !fromArea;
    })
    .sort();
}

/**
 * What a resolution needs to say about the record it is about to create.
 *
 * Shared by the three paths that resolve a casting — the ordinary cast, the
 * settlement of a declared one, and the release of a readied one — so that a
 * fourth cannot quietly disagree about what a casting ends up on.
 */
interface OngoingRecordPlan {
  readonly spellId: string;
  readonly on: 'caster' | 'targets' | 'point';
  /** Set when the geometry chose the targets rather than the caller. */
  readonly fromArea?: true;
  readonly origin?: Point;
  readonly towards?: Point;
  /** Which convention `origin` and `towards` are read under. Absent means `space`. */
  readonly anchoring?: PointAnchoring;
  /** Creatures the caster designated unaffected, for a spell that offers it. */
  readonly unaffected?: readonly string[];
  /** The damage type the casting was declared with, where the spell prints two. */
  readonly damageType?: string;
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
  // A casting that holds a point reaches its own range to place the point and
  // then the point's reach beyond that, so the bound on who *could* be hit is
  // the sum: Spiritual Weapon's force goes 60 feet out and strikes 5 further.
  // Both numbers are printed; adding them is the shortlist's job, and reading
  // the spell's Range alone would leave a legal target off it.
  const reach =
    (definition.range.kind === 'ranged' ? definition.range.feet : 5) +
    (definition.origin?.reach ?? 0);

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
          satisfyWith: `declareCreatureType(${target.id}, …)`,
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
  if (creature === null) return unknownCreature(id);

  const own = creature.initiativeBonuses;
  const supplied = options.bonuses ?? [];
  const mine = own.filter((bonus) => !supplied.some((other) => other.source === bonus.source));

  // SRD Feral Instinct and Remarkable Athlete both say "Advantage on
  // Initiative rolls", and a modifier somebody has to remember is one a
  // character silently stops having — the same rule Alert's bonus above
  // already follows. Deduplicated by source, so a caller who also knows about
  // the feature does not apply it twice.
  const named = new Map<string, ModeSource>();
  for (const mode of standingInitiativeModes(state, id)) named.set(mode.source, mode);
  const bare: (RollMode | ModeSource)[] = [];
  for (const mode of options.modes ?? []) {
    if (typeof mode === 'string') bare.push(mode);
    else named.set(mode.source, mode);
  }

  return rollInitiative(issuer, rng, id, creature.sheet, {
    ...options,
    conditions: options.conditions ?? effectiveConditions(state, id),
    bonuses: [...supplied, ...mine],
    modes: [...bare, ...named.values()],
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
  if (creature === null) return unknownCreature(id);

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
  if (creature === null) return unknownCreature(id);

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
  if (creature === null) return unknownCreature(id);
  if (!creature.equipped.includes(itemId)) {
    const item = itemFor(itemId);
    return err('not_equipped', `${item?.name ?? itemId} is not worn or wielded`);
  }

  return ok([
    { type: 'item-unequipped', id, item: itemId, ...(stamp === null ? {} : { command: stamp }) },
  ]);
}
