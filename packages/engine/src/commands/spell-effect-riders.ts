/**
 * What a settled outcome carries with it, and the one thing more than one
 * resolver module shares.
 *
 * `applyRiders` is the whole of it — conditions, then modifiers, then the
 * delayed hit — with the three pieces it composes beside it, because two of
 * them are reached from outside it as well: the standalone `condition` kind
 * builds its options with `riderOptions` and lands them with
 * `imposeCondition`, having no outcome for anything to ride.
 *
 * Beneath the resolvers rather than beside them. Nothing here reads an
 * {@link EffectContext}: each takes the bindings its rule needs, which is
 * what lets it sit under both the module that rolls and the module that does
 * not.
 */

import { type Content } from '../content.js';
import { forcedDrop } from './inventory.js';
import {
  type Ability,
  ABILITY_NAMES,
  type CharacterId,
  type ConditionName,
  ok,
  type Result,
} from '@ie/shared';
import { resolveDuration, timeView } from '../time.js';
import { type RepeatSave } from '../timers.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import {
  type ConditionRider,
  delayedDuration,
  type DelayedDamage,
  type OutcomeRiders,
  riderDuration,
  riderDurationPhrase,
  scaledDiceFor,
  type SpellDefinition,
} from '../spell-definitions.js';
import { type ActionSlot, canSpendSlot } from '../combat.js';
import { actionRulesOn } from '../standing.js';
import { castingSource } from '../spells.js';
import { applySpellEffect, type SpellEffectOptions } from './casting.js';
import { schedule } from './conditions.js';
import { lift, shoveAwayFrom } from './spell-effect-movement.js';
import { effectCheckFrom } from './rolls.js';
import { lightShedOn } from './spell-effect-grants.js';

/**
 * The `damage-scheduled` event a delayed hit needs, or nothing.
 *
 * The moment is {@link delayedDuration}'s and not this function's: SRD writes
 * it as "at the end of its next turn", anchored to the **target**, and it is
 * read from the one place so that the pre-flight and the schedule cannot come
 * to disagree about which moment they mean.
 *
 * **The question is asked earlier, where nothing has been spent yet.** A
 * printed later consequence that needs a turn timeline is a fact the casting
 * requests before the slot, the action and the first die — the engine says it
 * needs turn context to adjudicate this, and the layer above rules on the
 * fiction and supplies it. This used to be where the problem surfaced instead:
 * the slot went, the attack rolled, the first 4d4 landed, and only then was
 * the second hit dropped with a line in `unverified`. That is a consequence
 * forgiven rather than adjudicated, and it was reported to a caller who could
 * no longer do anything about it.
 *
 * So the ordinary casting never arrives here with a moment that cannot be
 * pinned. What still can is a path that reaches this rule long after the
 * casting was validated — an area trigger settling a minute later, an
 * activation, a casting declared and settled after the fight ended. Those have
 * already rolled and already landed the first hit, so the debt is **reported
 * rather than refused**: discarding a resolution whose generator has moved is
 * exactly what asking early exists to prevent.
 */
export function scheduleDelayed(
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

  // **The one amount that has to roll something.** A delayed hit is filed as a
  // notation and thrown at the boundary it falls due, so that randomness
  // enters the log at the roll rather than at the cast; an amount with no dice
  // has nothing to file. `checkSpellDefinition` refuses one
  // (`delayed_rolls_nothing`) before any content loads, so reaching here is
  // the validator and the resolver disagreeing — `casterSheet`'s pattern and
  // its argument.
  const notation = scaledDiceFor(delayed.damage, definition.level, casterLevel, castLevel);
  if (notation === undefined) {
    throw new Error(
      `${definition.name} owes ${target} a later hit with no dice to roll when it falls due; ` +
        'checkSpellDefinition refuses a delayed amount that rolls nothing, so the validator and the resolver disagree',
    );
  }

  const deadline = resolveDuration(timeView(state), delayedDuration(target));
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
      notation,
      damageType: delayed.damageType,
      // Through the canonical encoder, not by hand: `castingIdOf` reads this
      // back to find the casting, and a second spelling of the link is a
      // second place for it to drift out of step with the reader.
      source: castingSource(definition.name, castingId),
      label: `${definition.name} (delayed)`,
    },
  };
}

/**
 * The repeat save a rider asks for, against the host's own saving throw.
 *
 * SRD writes "the target repeats **the** save" — the one the effect already
 * made — so the ability and the DC are the host's and a rider that named its
 * own would be a second place for one sentence to go wrong.
 *
 * **Two callers, one spelling**, which is the reason it is a function.
 * {@link riderOptions} builds it for a casting; the item arm of
 * `resolveSaveEffect` builds it for a conferral, where `name` is the item's
 * rather than the spell's and there is no casting anywhere in it. A second
 * translation would be a second place for the label, the anchor or the DC to
 * drift.
 *
 * Nothing where the rider asks for none, and nothing where the host rolled no
 * saving throw to repeat: `checkSpellDefinition` refuses that combination at
 * authoring, so this reads a value the validator has already rejected rather
 * than stating a rule of its own.
 */
export function repeatSaveFrom(
  repeats: ConditionRider['repeats'],
  context: {
    /** Whose turns the boundary is anchored to: whoever it landed on. */
    readonly of: CharacterId;
    /** The ability the host rolled with, or null for a host that rolled none. */
    readonly ability: Ability | null;
    readonly dc: number;
    /** What the log calls the thing that did it: a spell, or an item. */
    readonly name: string;
  },
): RepeatSave | undefined {
  const { ability } = context;
  if (repeats === undefined || ability === null) return undefined;
  return {
    at: repeats.at,
    of: context.of,
    ability,
    dc: context.dc,
    onSuccess: repeats.onSuccess,
    // SRD Sleep's deepening, carried across unchanged: the condition the
    // failure imposes is the definition's and the source it lands under is the
    // one the first condition already carries, so nothing is decided here.
    ...(repeats.onFailure === undefined ? {} : { onFailure: repeats.onFailure }),
    label: `${ABILITY_NAMES[ability]} save vs ${context.name}`,
  };
}

/**
 * The `applySpellEffect` options one condition rider asks for.
 *
 * Four effect kinds impose a condition — an `attack` on a hit, a `save-damage`
 * or a `save` on a failure, and a `condition` with nothing rolled at all — and
 * before this there were three near-identical blocks translating a rider into
 * options, each reading a different subset of the fields. That was an accident
 * of the order the spells were written in: an escape check reached two of the
 * three, `outlivesCasting` reached one. One translation means a rider's field
 * works wherever the rider does.
 *
 * `held` is the other half a caller still does for itself, because it is not
 * an option: `outlivesCasting` keeps the target out of what the casting is
 * holding, and the branch that knows whether the target was affected at all is
 * the one that decides to add them.
 *
 * **`repeats` is here too, and its ability and DC are the host's.** SRD writes
 * "the target repeats **the** save" — the one the spell already asked for — so
 * a rider that named its own would be a second place for one sentence to go
 * wrong. `saveAbility` is null for a host that rolled none, and a rider on
 * such a host has no save to repeat; `checkSpellDefinition` refuses that
 * combination at authoring, so this reads a value the validator has already
 * rejected rather than stating a rule of its own.
 */
export function riderOptions(
  rider: ConditionRider,
  context: {
    readonly castingId: string;
    readonly spell: string;
    readonly casterId: CharacterId;
    readonly saveDc: number;
    /** Who the rider landed on, for a repeat save anchored to their turns. */
    readonly target: CharacterId;
    /** The ability the host rolled its saving throw with, or null for none. */
    readonly saveAbility: Ability | null;
  },
): SpellEffectOptions {
  const escape = effectCheckFrom(rider.check, context.spell, context.saveDc);
  // **The target as well as the caster**, for the reason the modifier rider
  // below passes both: `RiderDuration` has a member anchored to the creature
  // the rider lands on, and this is where that creature is known. Bound to
  // the caster it would be a *wrong deadline* rather than a refusal, which is
  // the one failure a closed vocabulary is supposed to make impossible.
  const duration = riderDuration(rider.lasts, context.casterId, context.target);
  const repeats = repeatSaveFrom(rider.repeats, {
    of: context.target,
    ability: context.saveAbility,
    dc: context.saveDc,
    name: context.spell,
  });
  return {
    casting: { castingId: context.castingId, spell: context.spell },
    ...(rider.outlivesCasting === true ? { unowned: true as const } : {}),
    ...(escape === undefined ? {} : { check: escape }),
    ...(duration === undefined ? {} : { duration }),
    ...(repeats === undefined ? {} : { repeatSave: repeats }),
  };
}

/**
 * Land a condition a casting imposes, or report that the target is immune.
 *
 * **An immune creature is unaffected by that clause; the casting still
 * happens.** `applyConditionTo` refuses with `immune`, which is the right
 * answer to a DM who has said "make this creature Poisoned" — it is a verdict
 * they asked for, and the spell lands and does nothing. Inside a casting it is
 * not a verdict about the casting: SRD Ray of Sickness aimed at a Zombie still
 * rolls its attack and deals its (immune, therefore zero) Poison damage, and a
 * whole spell refused because one of its clauses could not touch one target
 * would be a rules bug in the other direction — worse, one that also left the
 * generator advanced with no events emitted.
 *
 * So the *decision* stays in one place, `applyConditionTo` reading the one
 * gatherer, and this reads its answer. Two condition sites reach it — an
 * outcome's riders and the standalone `condition` kind — and they go through
 * one function rather than each interpreting the code, which is the fork
 * `defendingModes` closed on the defensive side.
 */
export function imposeCondition(
  state: GameState,
  target: CharacterId,
  rider: ConditionRider,
  casterId: CharacterId,
  options: SpellEffectOptions,
): Result<ConditionLanding> {
  return conditionLanding(applySpellEffect(state, target, rider.name, casterId, options));
}

/** What landing a condition leaves behind, and whether it landed at all. */
export interface ConditionLanding {
  readonly events: readonly GameEvent[];
  readonly landed: boolean;
}

/**
 * The immunity reading above, over a bare `applyConditionTo` result.
 *
 * **Immunity is the answer and not the error**, which is the whole of the
 * paragraph above and is just as true of a potion as of a spell: a Zombie
 * cannot be made Poisoned by a flask either, and the flask is still drunk. The
 * item route has no casting and therefore cannot go through
 * {@link applySpellEffect}, so the two share this rather than the sentence
 * being written twice and drifting once.
 */
export function conditionLanding(
  out: Result<readonly GameEvent[]>,
): Result<ConditionLanding> {
  if (out.ok) return ok({ events: out.value, landed: true });
  if (out.code === 'immune') return ok({ events: [], landed: false });
  return out;
}

/**
 * Everything one settled outcome carries with it, applied in one place.
 *
 * Three host branches used to do this inline and each knew a different subset:
 * the attack's condition block and the saving throw's were near-copies, the
 * `save` branch built its repeat save by hand, and nothing anywhere applied a
 * *grant* that a roll had already settled. That is the drift IE-001 removed
 * once for `riderOptions`, applied to the whole of what an outcome carries.
 *
 * **The branch is the host's and never this function's.** A caller reaches
 * here having already decided that the affirmative outcome happened — the
 * attack hit, the save failed — so there is no success branch, no miss branch
 * and no predicate. That is the invariant the whole rider design rests on, and
 * what makes it hold is that there is nowhere here for one to be written.
 *
 * **Order is fixed: conditions, then modifiers, then delayed, then the
 * shove.** It is observable in the log and nowhere else, so it is decided once
 * rather than by whichever branch a reader happens to be looking at — and the
 * shove is last because it is the only one of the four that moves the
 * creature, so it is the only one whose position in the order any later reader
 * of the scene could tell apart.
 *
 * **A rider rolls nothing.** The only die below this line is the delayed hit's,
 * and that one is *scheduled* rather than thrown — the generator does not move.
 * That is what makes a rider a leaf rather than a second resolution hiding
 * inside the first.
 */
export function applyRiders(
  state: GameState,
  target: CharacterId,
  riders: OutcomeRiders,
  context: {
    readonly definition: SpellDefinition;
    readonly castingId: string;
    readonly casterId: CharacterId;
    readonly saveDc: number;
    readonly castLevel: number;
    readonly casterLevel: number;
    readonly unverified: string[];
    /** Whom the casting is holding something on, for the record it writes. */
    readonly held: Set<CharacterId>;
    /** The ability the host rolled its saving throw with, or null for none. */
    readonly saveAbility: Ability | null;
    /** The catalogue, for the one rider that has to read an item's record. */
    readonly content: Content;
    /**
     * The object this casting was pointed at, for {@link OutcomeRiders.drops}.
     *
     * Stated at the casting and refused there when a spell that names no
     * object is given one, so a `drops` rider reaching here without it is the
     * definition and the command layer disagreeing rather than a rules
     * dispute.
     */
    readonly object?: string;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly conditions: readonly ConditionName[];
}> {
  const { definition, castingId, casterId, saveDc, held } = context;
  const source = castingSource(definition.name, castingId);
  const events: GameEvent[] = [];
  const conditions: ConditionName[] = [];
  let current = state;

  for (const rider of riders.conditions ?? []) {
    const landed = imposeCondition(
      current,
      target,
      rider,
      casterId,
      riderOptions(rider, {
        castingId,
        spell: definition.name,
        casterId,
        saveDc,
        target,
        saveAbility: context.saveAbility,
      }),
    );
    if (!landed.ok) return landed;
    // **After the attempt, not before it.** A condition the target is immune
    // to put nothing on them, so the casting is not holding anything there and
    // must not claim to be — `spellOn` is what Dispel Magic reads, and one of
    // its two halves is exactly this set. And a condition the casting *causes
    // and does not keep* is recorded under the spell's bare name, linked to
    // nothing that could later take it away, so it does not put the casting on
    // the target either.
    if (!landed.value.landed) continue;
    if (rider.outlivesCasting !== true) held.add(target);
    events.push(...landed.value.events);
    current = landed.value.events.reduce(applyEvent, current);
    conditions.push(rider.name);
  }

  for (const modifier of riders.modifiers ?? []) {
    // A grant is always the casting's, so every door that ends the spell — a
    // broken Concentration, the deadline, a dispel, the caster leaving — ends
    // it too, through machinery that already existed. There is no
    // `outlivesCasting` here: what a rider may say instead is `lasts`, a
    // deadline of its own that ends the grant **sooner** than the casting,
    // which is what `EffectTarget.grants` was built for and what an
    // Instantaneous host has no alternative to.
    held.add(target);
    const granted: GameEvent =
      modifier.kind === 'action'
        ? {
            type: 'action-rule-granted',
            id: target,
            // **Both strings pinned at the cast**, because `combat.ts` sits
            // beneath `GameState` and a refusal there can reach neither the
            // catalogue that named the spell nor the timer that holds the
            // deadline. `riderDurationPhrase` is the same reader
            // `riderDuration` below is, so the sentence a refusal prints and
            // the moment the grant actually ends cannot come apart.
            rule: {
              source,
              rule: modifier.rule,
              label: definition.name,
              until: riderDurationPhrase(modifier.lasts),
            },
          }
        : modifier.kind === 'bonus'
        ? {
            type: 'bonus-applied',
            id: target,
            bonus: {
              source,
              bonus: { ...modifier.bonus, source: definition.name },
              applies: modifier.applies,
              direction: modifier.direction,
            },
          }
        : modifier.kind === 'mode'
          ? {
              type: 'roll-modifier-granted',
              id: target,
              modifier: {
                source,
                modifier:
                  modifier.counterpart === undefined
                    ? modifier.modifier
                    : {
                        ...modifier.modifier,
                        // **The only place a role becomes an id**, which is
                        // the rule every number on a casting follows: a
                        // definition is written once and cast at whoever is
                        // standing there, and the fold opens no catalogue, so
                        // "that creature" has to be pinned here or it is not a
                        // fact at all. SRD Bestow Curse's "attack rolls
                        // against you" is the caster; the Vex property's
                        // "against that creature" is the target.
                        selector: {
                          ...modifier.modifier.selector,
                          counterpart: modifier.counterpart === 'caster' ? casterId : target,
                        },
                      },
              },
            }
          : modifier.kind === 'healing'
            ? {
                type: 'healing-rule-granted',
                id: target,
                // SRD Chill Touch: "it can't regain Hit Points until the end
                // of your next turn." Nothing of the casting's is pinned into
                // the rule itself — it says one word about arithmetic — so the
                // source is the whole of the link, and the deadline below is
                // what ends it on a cantrip that never becomes an ongoing.
                rule: { source, rule: modifier.rule },
              }
            : modifier.kind === 'benefit'
              ? {
                  type: 'benefit-denied',
                  id: target,
                  // SRD Starry Wisp: "it … can't benefit from the Invisible
                  // condition." The condition is not touched and is not this
                  // casting's to touch — it may have come out of a potion —
                  // so what is hung is the denial, under the casting's own
                  // source, and the deadline below is what hands the benefit
                  // back on a cantrip that never becomes an ongoing.
                  // **And the creature it holds against, where the sentence
                  // narrows it.** SRD Mind Spike's "against you" is the
                  // caster, bound to an id here for the reason the `mode`
                  // rider's `counterpart` is bound here: a definition names
                  // the role and the fold opens no catalogue.
                  denial: {
                    source,
                    condition: modifier.denies,
                    ...(modifier.against === undefined ? {} : { against: casterId }),
                  },
                }
            : {
                type: 'speed-modifier-granted',
                id: target,
                modifier: {
                  source,
                  change: modifier.change,
                  ...(modifier.feet === undefined ? {} : { feet: modifier.feet }),
                },
              };
    events.push(granted);
    current = applyEvent(current, granted);

    // **A deadline on what this source granted here, and on nothing else.**
    // SRD Ray of Frost: "until the start of your next turn", on a cantrip
    // whose casting is over the instant it resolves — so `grants` is the only
    // `EffectTarget` member that could ever take the reduction back. It names
    // the source rather than the casting, so it ends what this casting hung on
    // *this* creature and leaves what it hung on anybody else alone.
    //
    // Scheduled after the grant, because the deadline is only meaningful once
    // there is something to end; and the duration is `resolveDuration`'s to
    // refuse, which `riderDurations` has already asked before a die was thrown.
    // The five riders that may end sooner than the casting — see
    // {@link ModifierRider}, where each is argued from its Instantaneous host.
    const lasts =
      modifier.kind === 'speed-change' ||
      modifier.kind === 'action' ||
      modifier.kind === 'mode' ||
      modifier.kind === 'healing' ||
      modifier.kind === 'benefit'
        ? modifier.lasts
        : undefined;
    // **The target as well as the caster**, because SRD Vicious Mockery
    // anchors its deadline to the creature the rider is on — "before the end
    // of **its** next turn" — and binding it to anybody else would be a
    // wrong deadline rather than a refusal. The pre-flight asks the same
    // question of the same creature before a die is thrown, which is what
    // makes this call the *binding* rather than the first anybody hears of
    // it; `anchoredOnTarget` is the one reader that keeps the two agreeing.
    const duration = riderDuration(lasts, casterId, target);
    if (duration !== undefined) {
      const timer = schedule(current, { kind: 'grants', on: target, source }, duration);
      if (!timer.ok) return timer;
      events.push(timer.value);
      current = applyEvent(current, timer.value);
    }
  }

  if (riders.delayed !== undefined) {
    const scheduled = scheduleDelayed(current, target, riders.delayed, {
      casterId,
      definition,
      castingId,
      castLevel: context.castLevel,
      casterLevel: context.casterLevel,
      unverified: context.unverified,
    });
    if (scheduled !== null) {
      events.push(scheduled);
      current = applyEvent(current, scheduled);
    }
  }

  // The movement, last of the four, and **asked before it is written**: a push
  // into a wall, a lift into a ceiling or either out of the scene is a log the
  // fold could not apply, so what cannot happen simply does not, and says so on
  // the casting's own `unverified` rather than refusing a casting whose slot
  // and damage are already spent.
  //
  // **Two performers, one slot** — see {@link ForcedMovement.kind}. A push is
  // measured from the caster along the bearing to the creature; a lift is
  // measured from nobody, because up is not a direction anybody stands in, and
  // it hangs the grant that records whose magic is holding the creature there.
  // Absent is a push, which is what every definition written before the field
  // existed meant and still means.
  if (riders.movement !== undefined) {
    const moved =
      riders.movement.kind === 'lift'
        ? lift(current, target, riders.movement, source, definition.name)
        : shoveAwayFrom(current, target, casterId, riders.movement, definition.name);
    // **The casting is holding them**, which a push never is: `spellOn` is what
    // Dispel Magic reads, and a levitated creature the record did not know
    // about is one a dispel aimed at them would leave in the air.
    if (riders.movement.kind === 'lift' && moved.events.length > 0) held.add(target);
    events.push(...moved.events);
    current = moved.events.reduce(applyEvent, current);
    context.unverified.push(...moved.unverified);
  }

  // **A slot of the target's own turn, used up.** SRD Dissonant Whispers, and
  // the fifth rider — see {@link SpentBudget}, where the owner's ruling and
  // the line it left standing are both written down.
  //
  // **After the grants, because "if available" is asked of the world this
  // failure leaves.** A rule the same save just hung could be the very thing
  // that makes the slot unavailable, and asking first would spend a Reaction
  // the spell had already taken away.
  if (riders.spends !== undefined) {
    for (const slot of riders.spends.slots) {
      const spent = compelBudget(current, target, slot, riders.spends.on, source);
      if (spent === null) continue;
      events.push(spent);
      current = applyEvent(current, spent);
    }
  }

  // **Somebody else's Concentration, taken by this outcome** — SRD Sleet
  // Storm's "or have the Prone condition **and lose Concentration**", welded
  // to the condition above because one failed save costs both.
  //
  // Before the glow and after the grants, which is where the other endings sit
  // relative to what a failure hands out: the grants this save hung are the
  // casting's own and survive, and what goes is whatever the *target* was
  // holding. A creature concentrating on nothing loses nothing and the rest of
  // the failure lands anyway — `SpentBudget`'s silence, for its reason.
  //
  // The event is the one every other ending writes, so a Bless goes by the
  // door a failed Constitution save, a recast and a dispel all go through; the
  // fold refuses a mismatch, which is why the casting id is read off the
  // creature rather than named.
  if (riders.breaksConcentration === true) {
    const holding = current.creatures[target]?.concentration ?? null;
    if (holding !== null) {
      const broken: GameEvent = {
        type: 'concentration-ended',
        id: target,
        castingId: holding.castingId,
        reason: 'broken-by-an-effect',
      };
      events.push(broken);
      current = applyEvent(current, broken);
    }
  }

  // **The thing let go of, before the glow and after the grants.** SRD Heat
  // Metal: "must succeed on a Constitution saving throw **or drop the object
  // if it can**. **If it doesn't drop the object**, it has Disadvantage…" —
  // two sentences about one branch, where the second is conditional on what
  // the first did, which is why they are one rider with an `orElse` rather
  // than two riders the resolver would have to know to skip one of.
  //
  // The drop is `forcedDrop`'s: an unequip and then the refusal `dropItem`
  // makes of a thing still in hand, so the placement, the pile on the floor
  // and the pools a labelled copy carries are all the command's own rules
  // rather than a second spelling of them here.
  if (riders.drops !== undefined) {
    const object = context.object;
    if (object === undefined) {
      throw new Error(
        `${definition.name} makes its target drop an object and none was named; ` +
          'the caller should have been refused `object_required` before reaching here',
      );
    }
    const letGo = forcedDrop(current, context.content, target, object);
    if (!letGo.ok) return letGo;
    events.push(...letGo.value.events);
    current = letGo.value.events.reduce(applyEvent, current);

    // "If it doesn't drop the object" — the clause the book puts after the
    // one above, and the branch the engine can actually see.
    const instead = riders.drops.orElse ?? [];
    if (!letGo.value.dropped && instead.length > 0) {
      const hung = applyRiders(current, target, { modifiers: instead }, context);
      if (!hung.ok) return hung;
      events.push(...hung.value.events);
      current = hung.value.events.reduce(applyEvent, current);
    }
  }

  // **The glow, last, and after the shove** — SRD Faerie Fire's "For the
  // duration, objects and affected creatures shed Dim Light in a 10-foot
  // radius." The patch's region has the creature for its origin, so it walks
  // with them and a push before it or after it makes no difference; it is last
  // because it is a fact about the *scene* rather than about the creature, and
  // reading it before the shove would put the first reading of the lattice
  // ahead of the move that changed it.
  //
  // The same landing the `light` effect kind takes, reached from the other
  // host: two hosts, one geometry. Sourced to the casting, so a dispel, a
  // broken Concentration and the deadline all take it away.
  if (riders.light !== undefined) {
    const shed = lightShedOn(current, target, riders.light, {
      name: definition.name,
      source,
      castingId,
      spellLevel: definition.level,
    });
    held.add(target);
    events.push(...shed.events);
    current = shed.events.reduce(applyEvent, current);
    context.unverified.push(...shed.unverified);
  }

  return ok({ events, conditions });
}

/**
 * The event that charges one slot, or nothing at all.
 *
 * **The command's own check with the command's own inputs**, which is what the
 * fold's backstop will ask again: the primitive that would refuse this spend
 * is asked here, and a refusal becomes silence rather than an event the
 * reducer would call corrupt. SRD's "if available" is exactly that silence —
 * a slot already gone, a creature not in the fight, an Incapacitated target,
 * or a rule that had already forbidden the slot.
 *
 * `movement` is not reachable: `checkBudgetSpend` refuses it at authoring, and
 * the event's own type has only the three.
 */
function compelBudget(
  state: GameState,
  target: CharacterId,
  slot: ActionSlot,
  on: string,
  source: string,
): GameEvent | null {
  const combat = state.combat;
  if (combat === null || slot === 'movement') return null;
  const allowed = canSpendSlot(combat, target, slot, state.creatures[target]?.conditions, {
    rules: actionRulesOn(state, target),
  });
  if (!allowed.ok) return null;
  return { type: 'budget-compelled', id: target, slot, on, source };
}
