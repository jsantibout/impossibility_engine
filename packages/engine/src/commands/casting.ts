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
  forSeconds,
  type RepeatSave,
  resolveDuration,
  timeView,
} from '../duration.js';
import {
  applyEvent,
  castingIdFor,
  isOn,
  type CommandStamp,
  type CreatureState,
  type GameEvent,
  type GameState,
  type PendingCasting,
} from '../events.js';
import { type Placement, type Point, type PointAnchoring } from '../positioning.js';
import { damageWindowOpen } from '../reactions.js';
import { remaining, slotKeyOf, type SlotKind } from '../resources.js';
import { type RollIssuer } from '../rolls.js';
import { type ReactionTrigger, type SpellDefinition } from '../spell-definitions.js';
import { type CastingRoute, routesFor, type SpellcastingState } from '../spellcasting.js';
import {
  castingSource,
  type CastingTime,
  type ConcentrationCheck,
  type ConcentrationEndReason,
  LONG_CASTING_SECONDS,
  slotFits,
  type SlotlessReason,
  validateSpellName,
} from '../spells.js';
import { armorClassOf } from '../standing.js';
import { concentrationSaveDc } from '../vitals.js';
import { creatureOf, turnContextFor, unknownCreature } from './command.js';
import { applyConditionTo, schedule } from './conditions.js';
import { type DamageCommand, damageCreature } from './creatures.js';
import { mayAct, pendingCastingsOf } from './holds.js';
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
      //
      // **A different code from the three above it, and the difference is what
      // the caller does next.** `no_trigger` says the moment has not arrived,
      // and there is nothing to re-send; this says the moment *has* arrived and
      // the casting named the wrong creature, which a caller fixes by naming
      // the right one. One code for both told a tool surface to give up on a
      // Reaction it could in fact take.
      if (request.targets.length !== 1 || request.targets[0] !== hurt.by) {
        return err(
          'forced_target',
          `${definition.name} burns the creature that damaged you, which is ${hurt.by}`,
        );
      }
      return null;
    }

    case 'casting-a-spell': {
      const answered = answeredCasting(state, definition, request);
      return answered.ok ? null : answered;
    }

    default: {
      const unhandled: never = trigger;
      throw new Error(`no trigger rule for ${String(unhandled)}`);
    }
  }
}

/**
 * Which casting this Reaction answers — an id, never a guess.
 *
 * SRD Counterspell: "You attempt to interrupt **a creature in the process of
 * casting a spell**." While one casting could be open engine-wide, the caster
 * *was* the casting and this check could read "the" casting. Several may be
 * open now, and several of them may belong to one creature, so an ambiguous
 * reference has to resolve to a casting id or be refused — the rule
 * `eligibleTargets` obeys for targeting, arriving on the other axis.
 *
 * The three answers a caller can get differ in what they do next:
 *
 * | Code | Says | The caller |
 * |---|---|---|
 * | `no_trigger` | nothing is being cast, or that casting is over | waits |
 * | `forced_target` | the named creature is casting nothing, or is not the one casting *this* | re-sends, naming the right creature |
 * | `ambiguous_casting` | they have several open and the command named none | re-sends, naming a casting id |
 *
 * **One function, two readers.** `triggerRefusal` asks it before anything is
 * spent, and the Counterspell's own resolution asks it again on the state its
 * own events have been folded into — so the resolver settles exactly the
 * casting the trigger check accepted, by construction rather than by the
 * window happening to be unique.
 */
export function answeredCasting(
  state: GameState,
  definition: SpellDefinition,
  request: CastSpellRequest,
): Result<PendingCasting> {
  const open = pendingCastingsOf(state);
  if (open.length === 0) {
    return err(
      'no_trigger',
      `${definition.name} is a Reaction taken when you see a creature casting a spell, and nobody is midway through a casting`,
    );
  }

  // Named outright, which is what a caller with several to choose between
  // sends. A casting that is not open is the moment having passed — it settled
  // or it was already interrupted — so it is `no_trigger` and not a re-send.
  const named = request.answers;
  if (named !== undefined) {
    const found = open.find((casting) => casting.castingId === named);
    if (found === undefined) {
      return err(
        'no_trigger',
        `${named} is not a casting in progress; ${
          open.length === 1 ? 'the one that is' : 'the ones that are'
        } ${open.map((c) => `${c.castingId} (${c.caster}, ${c.spell})`).join(', ')}`,
      );
    }
    // SRD forces the target, so a command naming the wrong creature for the
    // casting it says it answers is refused rather than quietly redirected.
    if (request.targets.length !== 1 || request.targets[0] !== found.caster) {
      return err(
        'forced_target',
        `${definition.name} interrupts the creature that is casting ${found.castingId}, which is ${found.caster}`,
      );
    }
    return ok(found);
  }

  if (request.targets.length !== 1) {
    return err(
      'forced_target',
      `${definition.name} interrupts one creature in the process of casting a spell; name which`,
    );
  }
  const theirs = open.filter((casting) => casting.caster === request.targets[0]);
  if (theirs.length === 0) {
    return err(
      'forced_target',
      `${definition.name} interrupts a creature that is casting, and ${request.targets[0]} is not; ${open
        .map((c) => c.caster)
        .join(', ')} ${open.length === 1 ? 'is' : 'are'}`,
    );
  }

  // **The engine never picks between candidates.** A creature may legally have
  // two castings open — a rite and the Shield they cast when attacked — and
  // choosing one of them would be the engine answering a question the caster
  // was asked. Where there is nothing to choose between, an omitted id is not
  // ambiguous and resolves.
  if (theirs.length > 1) {
    return err(
      'ambiguous_casting',
      `${request.targets[0]} has more than one casting in progress; name which ${definition.name} answers: ${theirs
        .map((c) => `${c.castingId} (${c.spell})`)
        .join(', ')}`,
    );
  }
  return ok(theirs[0]!);
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
  /**
   * How long a `long` casting takes, in whole seconds. Required for one.
   *
   * The declaration pins `state.elapsed + this` as the moment settlement may
   * happen, so it is the whole of what makes a casting time of a minute or
   * more mean anything. `resolveSpell` derives it from the definition — and
   * adds the Ritual's ten minutes where the casting asked for one — so this is
   * the low-level half's way of being told, exactly as `castingTime` is.
   */
  readonly castingSeconds?: number;
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
  /**
   * The damage type the caster stated, where the spell prints a choice.
   *
   * Beside the targets and the origin, and for the same reason: settlement
   * takes no fresh request, so a Spirit Guardians declared Necrotic must not
   * settle Radiant. Already normalised by the layer that read the request —
   * copied here rather than re-derived, because a second normalisation is a
   * second place for one sentence to be got wrong.
   */
  readonly damageType?: string;
  /**
   * Which creatures the caster or their allies are fighting.
   *
   * The third fact stated at the casting, beside the other two and for the
   * same reason: SRD Charm Person gives each target's save Advantage "if you
   * or your allies are fighting **it**", and settlement takes no fresh request
   * — so a declaration made against a creature the party is fighting must
   * settle with the Advantage the book gives it.
   *
   * Sorted by `foughtFor` and **never elided when empty**: "none of them" is an
   * answer the spell demanded, and absence is a casting `declaredFacts` would
   * have refused.
   */
  readonly fought?: readonly CharacterId[];
  /**
   * Creatures the caster designated unaffected, for a spell that offers it.
   *
   * Sorted and non-empty, or absent. Normalised once, where the request is
   * read; this is the copy that carries it to the declaration.
   */
  readonly unaffected?: readonly CharacterId[];
  /**
   * Where a teleporting spell puts its target.
   *
   * Beside the targets and the origin, and for the same reason: settlement
   * takes no fresh request, so a Dimension Door declared at the far end of the
   * hall must not settle beside the caster. Carried verbatim from the request
   * the layer above read — it is an ordinary `Placement` and there is nothing
   * to normalise.
   */
  readonly teleportTo?: Placement;
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

  // SRD "Longer Casting Times": "While you cast a spell with a casting time of
  // 1 minute or more, you must take the Magic action on each of your turns,
  // and you must maintain Concentration while you do so." Both halves are the
  // engine's now: the Concentration is a deadline it already kept, and the
  // per-turn obligation is `PendingCasting.sustainedOnTurn`, `continueCasting`
  // and the derived failure at the caster's own turn boundary. A fight running
  // is therefore no longer a reason to refuse one.
  if (castingTime === 'long') {
    // **The same floor the validator holds a definition to, from the same
    // constant.** The low-level half takes its caller's word about the
    // economy; it does not take a caller's word about arithmetic, and two
    // spellings of one number would let a six-second "long" casting through
    // here that no definition could ever declare.
    const seconds = command.castingSeconds;
    if (
      seconds === undefined ||
      !Number.isInteger(seconds) ||
      seconds < LONG_CASTING_SECONDS
    ) {
      return err(
        'bad_casting_seconds',
        'a casting time of 1 minute or more completes at a moment on the clock, at least 60 seconds away, and this casting named none',
      );
    }

    // A long casting **is** a declared casting: the id is allocated now, the
    // Concentration starts now, and the slot waits for the settlement. The
    // resolution half of the record is the layer above's — `castSpell` does
    // not know which definition it is or who it is aimed at — so a caller that
    // supplied none has asked for a window nothing could ever close.
    if (command.hold === undefined) {
      return err(
        'unsupported_casting_time',
        'a casting time of 1 minute or more is a declared casting settled later, and this casting named nothing for the settlement to resolve',
      );
    }
  } else if (command.castingSeconds !== undefined) {
    return err(
      'casting_seconds_without_long',
      'only a casting time of a minute or more takes a span of seconds; an Action, a Bonus Action and a Reaction are moments in a turn',
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

  // SRD "Longer Casting Times": "you must maintain Concentration while you do
  // so." A casting of a minute or more therefore *requires* Concentration
  // whatever the spell itself asks for, which is why this is read here and not
  // off `concentration` alone.
  const sustained = castingTime === 'long';

  // SRD: "You lose Concentration on an effect the moment you start casting a
  // spell that requires Concentration." The moment you *start* — which is why
  // this precedes the slot going, and why a casting that goes on to accomplish
  // nothing still costs the caster the spell they were holding.
  if ((concentration || sustained) && caster.concentration !== null) {
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
    let lastsSeconds: number | undefined;
    if (command.duration !== undefined) {
      // A clock-deferred casting carries the **span** rather than a resolved
      // deadline: SRD gives a spell's Duration from the moment it takes
      // effect, and a casting that takes ten minutes has not taken effect for
      // ten minutes. Pinning it here would expire a ten-minute Detect Magic
      // ritual the instant the rite finished.
      //
      // A turn-anchored duration still resolves here, and outside combat that
      // is a refusal — before the window opens, which costs nothing. **Inside
      // combat a long casting is no longer refused**, so one could now resolve
      // to a moment in the turn order, and the branch below would pin it at the
      // *declaration*: a spell whose Duration ends at the caster's next turn,
      // scheduled a minute before the spell exists. That is precisely the bug
      // `lastsSeconds` was built against, arriving through the door IE-041
      // opened, so it is refused here instead — before the window opens, which
      // is the same validate-before-rolling rule. A span is therefore still the
      // only kind that can reach the settlement, which is why the field holds
      // seconds and why settlement cannot fail.
      //
      // **It resolves either way, and the span is read back off the answer.**
      // `resolveDuration` is the single conversion between a `Duration` and a
      // `Deadline` and the only thing that refuses one running backwards, in
      // fractions of a second or not a number at all — so a branch that stored
      // the span *instead* of resolving it would be the one place in the
      // engine where a duration goes unchecked. A `NaN` span would then settle
      // to a deadline of `null`: a casting that never expires live and expires
      // at once on reload, which is one log meaning two things.
      const pinned = resolveDuration(timeView(state), command.duration);
      // A turn-anchored one outside combat is a thin record rather than a rule
      // saying no, and this is the layer that can say which command settles it.
      // Still before the window opens, so a caller that goes and begins the
      // fight declares the casting again exactly as it meant to.
      if (!pinned.ok) return turnContextFor(pinned, command.duration, id);

      if (sustained) {
        if (pinned.value.kind !== 'elapsed') {
          return err(
            'duration_not_a_span',
            `a casting of a minute or more takes its Duration from the moment the spell takes effect, so it cannot be a moment in the turn order that was worked out a ${command.castingSeconds}-second rite earlier`,
          );
        }
        lastsSeconds = pinned.value.at - state.elapsed;
      } else {
        deadline = pinned.value;
      }
    }

    // When the casting finishes. Outside combat, so `resolveDuration` cannot
    // refuse a span of seconds — but it is what resolves every other moment in
    // this engine, and a second arithmetic for one field is a second place to
    // get it wrong.
    let completesAt: Deadline | undefined;
    if (sustained) {
      const done = resolveDuration(timeView(state), forSeconds(command.castingSeconds!));
      if (!done.ok) return done;
      completesAt = done.value;
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
        // The three facts the caster stated, carried verbatim. Already sorted
        // and already elided when empty by the layer that read the request —
        // re-normalising here would be the second copy that eventually
        // disagrees with the first.
        ...(command.hold.damageType === undefined ? {} : { damageType: command.hold.damageType }),
        ...(command.hold.fought === undefined ? {} : { fought: command.hold.fought }),
        ...(command.hold.unaffected === undefined ? {} : { unaffected: command.hold.unaffected }),
        // And where the teleport goes, which is the one fact a settlement
        // could not possibly work out again.
        ...(command.hold.teleportTo === undefined ? {} : { teleportTo: command.hold.teleportTo }),
        unverified: command.hold.unverified,
        ...(deadline === undefined ? {} : { deadline }),
        ...(completesAt === undefined ? {} : { completesAt }),
        // SRD's obligation is on "each of your turns", and the turn a rite is
        // begun on is one of them — the declaration *is* that turn's Magic
        // action, so the caster does not owe a second. Outside combat there is
        // no turn to name, and the field stays absent: the fight that starts
        // around the rite then owes it on the caster's first turn.
        ...(sustained && state.combat !== null
          ? { sustainedOnTurn: state.combat.turnsTaken }
          : {}),
        ...(lastsSeconds === undefined ? {} : { lastsSeconds }),
        ...(command.check === undefined ? {} : { check: command.check }),
      },
      ...(stamp === null ? {} : { command: stamp }),
    });

    // SRD: "you must maintain Concentration while you do so." The casting is
    // the thing being concentrated on, and it has an identity precisely so
    // other mechanics can name it while it is open — so this is the same
    // `concentration-started` every other spell writes, naming the id the
    // declaration has just allocated. Nothing is running under it yet, which
    // is what makes every reader of `concentration` correct here: they either
    // look for effects the casting hung (there are none) or simply report the
    // spell being held, which is the truth.
    //
    // A Concentration spell cast this way starts exactly one Concentration,
    // here, and settlement carries it on rather than starting a second.
    if (sustained) {
      events.push({
        type: 'concentration-started',
        id,
        castingId,
        spell: name.value,
        level: castLevel,
      });
    }

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
 *
 * **A casting of a minute or more has already started its Concentration**, at
 * the declaration, because SRD requires it to be maintained *while* the spell
 * is cast. So the two branches invert for one: a spell that needs
 * Concentration simply carries the one it has on, under the same id, and one
 * that does not has a Concentration with nothing left to hold, which ends
 * here with `completed`.
 *
 * The state is read for exactly one thing — the moment the spell takes effect,
 * which is when a deferred duration begins. See `PendingCasting.lastsSeconds`.
 */
export function settlementEvents(
  state: GameState,
  pending: PendingCasting,
  stamp: CommandStamp | null,
): GameEvent[] {
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

  // A casting the clock deferred is already concentrated on, whatever spell it
  // is. The **moment** is the fact rather than the casting time: `castingTime`
  // agrees today, because `castingOf` records a Ritual's as `long` — its
  // printed one is "Action or Ritual" and the Ritual version really does take
  // ten minutes — so the two cannot disagree and no fixture can tell them
  // apart. What this branch is *about* is whether a Concentration was already
  // started for the casting, and `completesAt` is the field that says so
  // directly rather than the one that happens to travel with it.
  const sustained = pending.completesAt !== undefined;

  if (pending.concentration && !sustained) {
    events.push({
      type: 'concentration-started',
      id: pending.caster,
      castingId: pending.castingId,
      spell: pending.spell,
      level: pending.level,
    });
  } else if (sustained && !pending.concentration) {
    // **Before the deadline below, and that ordering is load-bearing.**
    // `concentration-ended` folds through `releaseCasting`, which takes every
    // timer the casting owns with it — so a schedule written first would be
    // wiped by the very event that says the rite is over.
    events.push({
      type: 'concentration-ended',
      id: pending.caster,
      castingId: pending.castingId,
      reason: 'completed',
    });
  }

  // A span carried from the declaration starts **now**: the spell has this
  // moment taken effect, and SRD gives its Duration from here rather than from
  // whenever the caster began muttering.
  //
  // **Through the same conversion the declaration used**, rather than the
  // arithmetic spelled out a second time — `elapsed + seconds` written here as
  // well would be the second answer to one question this file warns about four
  // lines up. It cannot refuse: the span was resolved and read back off an
  // `elapsed` deadline at the declaration, so it is already a whole number of
  // seconds forwards, and `must` says so rather than a caller having to.
  const deadline =
    pending.deadline ??
    (pending.lastsSeconds === undefined
      ? undefined
      : mustResolve(state, forSeconds(pending.lastsSeconds)));

  if (deadline !== undefined) {
    events.push({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: pending.castingId },
      deadline,
      ...(pending.check === undefined ? {} : { check: pending.check }),
    });
  }

  return events;
}

/**
 * `resolveDuration` for a span the declaration already validated.
 *
 * The conversion is the same one, so the arithmetic is not written twice; what
 * this adds is the statement that the refusal cannot arrive. `lastsSeconds` is
 * stored as the difference between an `elapsed` deadline and the clock it was
 * resolved against, so it is a whole number of seconds forwards by
 * construction — and a throw here would mean the declaration's own validation
 * had stopped holding, which is programmer error rather than a rules refusal.
 */
function mustResolve(state: GameState, duration: Duration): Deadline {
  const pinned = resolveDuration(timeView(state), duration);
  if (!pinned.ok) {
    throw new Error(`a settled casting's own duration was refused: ${pinned.reason}`);
  }
  return pinned.value;
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
    // No caller-supplied immunities. `SpellEffectOptions.immuneTo` was a
    // pass-through with **zero writers** — IE-040 verified that and left it
    // only because this file was held at the time — and a parameter nothing
    // passes is a claim about the rules that nothing checks.
    // `conditionImmunitiesOf` is what actually decides this, off the creature.
    [],
    options.duration,
    options.repeatSave,
    {},
    options.check,
  );
}

/**
 * A caster lets go of a casting of their own, naming it by its id.
 *
 * SRD, on a spell with a duration: "you can dismiss it (**no action
 * required**) if you don't have the Incapacitated condition."
 *
 * **A casting is addressed by its id, never by whoever holds it.** The command
 * this replaced found the casting through `caster.concentration`, which is the
 * right question for a Concentration spell and *no question at all* for the
 * rest: a Mage Armor, a Longstrider or a Magic Mouth is nobody's
 * Concentration, so nothing held it and nothing could let it go. That was the
 * last place in the command layer a casting was reached through its holder.
 *
 * `on` carries the whole of SRD Dispel Magic's own distinction, which
 * `spell-ended` has recorded since it was written: **null** ends the casting
 * and everything it made, and a **creature** releases it there and leaves the
 * casting running for everyone else it caught. Both operations have existed
 * since Hold Person's repeat save; this is a second command that names which.
 *
 * {@link endConcentration} stays, and the two are not redundant: that one is
 * about a *Concentration* — it is what a caster reaches for when they do not
 * know or care which casting they are holding — and it writes
 * `concentration-ended` with its own reason. Both converge on `releaseCasting`,
 * which is still the single door.
 *
 * **`mayAct` applies and this is not a spender**, which is the one combination
 * worth stating rather than leaving to be inferred — `relocateCreature`'s
 * precedent exactly. SRD spends no Action, Bonus Action, Reaction, movement or
 * pool use on a dismissal, so the action-economy sweep never classifies it and
 * no exemption list has anything to say about it. It is guarded anyway,
 * because ending a casting **forgives what that casting already owes**:
 * `releaseCasting` drops the casting's outstanding `OwedAreaEffect`s, so a
 * Web dismissed while somebody's save was owed would lose a rule the boundary
 * had already raised — the engine losing a rule to its own bookkeeping, which
 * is what the global area-debt guard exists to prevent.
 *
 * The guard sits **inside** `once`, so a retry of a dismissal that landed is
 * told its command landed rather than told `not_ongoing` about the world its
 * own first run made.
 */
export function endOngoingSpell(
  state: GameState,
  casterId: CharacterId,
  castingId: string,
  on: CharacterId | null,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `end-ongoing:${castingId}`, { ...command, on }, () => [], (stamp) => {
    const owed = mayAct(state, casterId);
    if (owed !== null) return owed;

    const caster = creatureOf(state, casterId);
    if (caster === null) return unknownCreature(casterId);

    const record = state.ongoing[castingId];
    if (record === undefined) {
      return err('not_ongoing', `${castingId} is not a spell that is still running`);
    }

    // SRD: "**you** can dismiss it." A spell is not a thing lying about for
    // anyone to put out, and `activateSpell` says the same of acting through
    // one — the same code, because it is the same rule.
    if (record.caster !== casterId) {
      return err(
        'not_your_spell',
        `${castingId} is ${record.caster}'s casting; ${casterId} cannot dismiss it`,
      );
    }

    if (isIncapacitated(caster.conditions)) {
      return err('incapacitated', `${casterId} is Incapacitated and can't dismiss ${record.spell}`);
    }

    // **The SRD prints the free dismissal under one duration form, and the
    // word that scopes it is easy to elide.** Its Duration section lists three
    // — Concentration, Instantaneous, Time Span — and the clause sits under
    // the third: "While a **time-span** spell that you cast is ongoing, you
    // can dismiss it (no action required)". A Concentration is free to end by
    // its own separate sentence, which is what `endConcentration` quotes:
    // "The creator can end Concentration at any time (no action required)".
    //
    // "Until dispelled" is **neither**, and the book gives its caster no way
    // out at all — Arcane Lock and Continual Flame each consume a costly
    // component and print no ending whatever. Permitting it would be the
    // engine answering a question the SRD declined to ask, so it is refused
    // rather than quietly allowed: the shape `ritual`, `damage_type_fixed`
    // and `no_fought_clause` already take for a clause a spell does not print.
    //
    // **Read off the casting rather than off the catalogue**, because a
    // definition corrected next month must not decide whether a casting made
    // today can be let go — IE-007's rule, applied to one more fact. A time
    // span is a `casting` timer, pinned at the cast; a Concentration is the
    // caster holding it.
    const timeSpan = Object.values(state.timers).some(
      (timer) => timer.target.kind === 'casting' && timer.target.castingId === castingId,
    );
    if (!timeSpan && caster.concentration?.castingId !== castingId) {
      return err(
        'not_dismissible',
        `${record.spell} runs until dispelled and takes no Concentration, and SRD gives its caster no way to end it — the free dismissal is printed for a time span`,
      );
    }

    if (on !== null) {
      if (creatureOf(state, on) === null) return unknownCreature(on);
      // **A release names a creature the casting is actually on**, which is
      // `isOn`'s own answer. The command this replaced refused the same defect
      // by scanning for a condition instance; that is only the derived half of
      // the question, and it misses a tracked spell like Darkvision, which is
      // on somebody and hangs nothing there. Same code, because it is the same
      // mistake: the caller is releasing a spell that is not there to release.
      if (!isOn(state, record, on)) {
        return err('no_effect_there', `${record.spell} is not on ${on}, so it cannot end there`);
      }
    }

    return ok([
      {
        type: 'spell-ended',
        castingId,
        on,
        reason: 'dismissed',
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
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
 *
 * **It does consult `mayAct`, which it did not used to.** The action-economy
 * sweep exempted it as "a named debt rather than a settled exemption": being
 * the low-level half is a *policy* about who calls it, and a policy is not a
 * guard. It spends an Action and a slot, so a caller reaching it while a
 * persistent area owes somebody a saving throw would act into a world nobody
 * has settled — which is the whole of what the debt is for.
 *
 * `castOnHit` therefore calls {@link resolveCastWith} instead: settling an
 * attack the engine is already holding open must not be refused, and a guard
 * on that path would strand the held roll.
 */
export function resolveCast(
  state: GameState,
  id: CharacterId,
  command: CastCommand,
): Result<GameEvent[]> {
  // Before anything else: a retry of a command that has already landed is a
  // no-op, and the action it spent stays spent. **The guard is inside the
  // callback**, which is what `once` is for — a refusal written above it would
  // tell a retry about the world its own first run arrived in, and this file
  // records eight prior occasions on which that is exactly what happened.
  return once(state, `cast:${id}`, command, () => [], (stamp) => {
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;
    return resolveCastWith(state, id, command, stamp);
  });
}

/**
 * Take the Magic action a casting of a minute or more costs this turn.
 *
 * SRD "Longer Casting Times": "While you cast a spell with a casting time of 1
 * minute or more, you must take the Magic action on **each of your turns**, and
 * you must maintain Concentration while you do so. If your Concentration is
 * broken, the spell fails, but you don't expend a spell slot."
 *
 * **This is the half somebody decides.** The other half — a turn that ended
 * without it — is derived at the boundary and writes no event, exactly as a
 * lost Concentration does, because nobody decides that a turn ended. So the
 * split here is the one every rule in this engine obeys: rules are derived,
 * judgements are events.
 *
 * It spends the Action and nothing else. The slot is still untouched until the
 * settlement, which is the same asymmetry `spell-declared` has always written,
 * and there is no second casting: the rite is the casting already open, named
 * by its id.
 *
 * **The turn the rite was declared on needs none of this.** The declaration
 * *was* that turn's Magic action, so it stamps the record itself and a caller
 * asking for a second is refused `no_action` by the economy — which is the
 * honest refusal, because it is the economy that says so.
 */
export function continueCasting(
  state: GameState,
  casterId: CharacterId,
  castingId: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `continue-cast:${castingId}`, command, () => [], (stamp) => {
    // A mandatory effect somebody has been caught by, or a turn whose start has
    // not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, casterId);
    if (owedHere !== null) return owedHere;

    const pending = state.pendingCastings[castingId];
    if (pending === undefined) {
      return err('no_casting_pending', `no casting ${castingId} is waiting to resolve`);
    }

    // SRD: "**you** must take the Magic action." A rite in progress is not a
    // thing lying about for anyone to pick up — the rule `activateSpell`
    // already states for a spell that is running.
    if (pending.caster !== casterId) {
      return err(
        'not_your_spell',
        `${castingId} is ${pending.caster}'s casting; ${casterId} cannot keep at it`,
      );
    }

    // An instant window — a casting held open so a Counterspell can answer it —
    // is owed nothing on anybody's turn. `completesAt` is the field that says
    // which kind of casting this is, for the reason `settlementEvents` reads it
    // rather than `castingTime`.
    if (pending.completesAt === undefined) {
      return err(
        'not_a_long_casting',
        `${pending.spell} is not a casting of a minute or more; only one of those is taken up again on a later turn`,
      );
    }

    const combat = state.combat;
    if (combat === null) {
      return err(
        'not_in_combat',
        'outside combat there are no turns to take the Magic action on, and the casting runs on the clock instead',
      );
    }

    const caster = creatureOf(state, casterId);
    if (caster === null) return unknownCreature(casterId);

    // Whose turn it is, whether the Action is still there and whether the
    // caster is Incapacitated are all this one call's — the economy's own
    // question, asked where the economy answers it.
    const spent = spendAction(combat, casterId, caster.conditions);
    if (!spent.ok) return spent;

    return ok([
      { type: 'action-spent', id: casterId },
      {
        type: 'casting-continued',
        id: casterId,
        castingId,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
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

