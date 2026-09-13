/**
 * What a casting costs, and what damage it settles.
 *
 * `resolveCast` is the whole cost of a casting — the spell validated, the
 * action or Bonus Action or Reaction spent, the slot expended, Concentration
 * moved — or a refusal that changes nothing at all. `castSpell` beneath it is
 * the documented low-level half, for a caller reconstructing a log.
 *
 * `resolveDamage` is here for the same reason `healCreature` is not: damage
 * settles the Concentration it puts at risk, so the operation that applies it
 * has to know about castings.
 */

import { type CommandIdentity, once } from '../idempotency.js';
import {
  type CharacterId,
  type ConditionName,
  err,
  type Err,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { untrainedArmorPenalty } from '../character.js';
import { type D20TestResult, rollSavingThrow } from '../checks.js';
import {
  canSpendSpellSlotThisTurn,
  spendAction,
  spendBonusAction,
  spendReaction,
} from '../combat.js';
import { isIncapacitated } from '../conditions.js';
import { type Rng } from '../dice.js';
import {
  type Deadline,
  type Duration,
  type EffectCheck,
  type RepeatSave,
  resolveDuration,
  timeView,
} from '../duration.js';
import {
  applyEvent,
  castingIdFor,
  type CommandStamp,
  type CreatureState,
  type GameEvent,
  type GameState,
  type PendingCasting,
} from '../events.js';
import { type Point, type PointAnchoring } from '../positioning.js';
import { damageWindowOpen } from '../reactions.js';
import { remaining, slotKeyOf, type SlotKind } from '../resources.js';
import { type RollIssuer } from '../rolls.js';
import { type ReactionTrigger, type SpellDefinition } from '../spell-definitions.js';
import { type CastingRoute, routesFor, type SpellcastingState } from '../spellcasting.js';
import {
  castingIdOf,
  castingSource,
  type CastingTime,
  type ConcentrationCheck,
  type ConcentrationEndReason,
  slotFits,
  type SlotlessReason,
  validateSpellName,
} from '../spells.js';
import { armorClassOf } from '../standing.js';
import { concentrationSaveDc } from '../vitals.js';
import { creatureOf, unknownCreature } from './command.js';
import { applyConditionTo, schedule } from './conditions.js';
import { type DamageCommand, damageCreature } from './creatures.js';
import { recordD20Test, savingSupport } from './rolls.js';
import { type CastSpellRequest } from './targeting.js';

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
export function triggerRefusal(
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
export function deflectTriggeringAttack(
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
  return once(state, `cast:${id}`, command, () => [], (stamp) => {
    return castSpellWith(state, id, command, stamp);
  });
}

/**
 * {@link castSpell}, with the command's identity already established.
 *
 * Whoever *is* the command owns the identity, and for a spell the engine has a
 * definition for that is `resolveSpell` rather than this. It holds a
 * `CastSpellRequest` — the targets, the point, the designations — and this
 * holds the `CastCommand` derived from it, so two `identify` calls would
 * fingerprint two different objects under one id and refuse every honest
 * retry. One identity, established by the outermost command, stamped on the
 * event that records the casting.
 */
function castSpellWith(
  state: GameState,
  id: CharacterId,
  command: CastCommand,
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
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
export function settlementEvents(pending: PendingCasting, stamp: CommandStamp | null): GameEvent[] {
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
  return once(state, `end-concentration:${id}`, { ...command, reason }, () => [], (stamp) => {
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
  });
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
  return once(state, `damage:${id}`, command, () => {
    return { events: [], concentration: { kind: 'none' }, duplicate: true };
  }, () => {
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
  // Before anything else: a retry of a command that has already landed is a
  // no-op, and the action it spent stays spent.
  return once(state, `cast:${id}`, command, () => [], (stamp) => {
    return resolveCastWith(state, id, command, stamp);
  });
}

/** {@link resolveCast}, with the command's identity already established. */
export function resolveCastWith(
  state: GameState,
  id: CharacterId,
  command: CastCommand,
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const cast = castSpellWith(state, id, command, stamp);
  if (!cast.ok) return cast;

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
export function chooseRoute(
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
export function choosePayment(
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

