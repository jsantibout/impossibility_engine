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
import { castingSource } from '../spells.js';
import { applySpellEffect, type SpellEffectOptions } from './casting.js';
import { schedule } from './conditions.js';
import { effectCheckFrom } from './rolls.js';

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
  const duration = riderDuration(rider.lasts, context.casterId);
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
 * **Order is fixed: conditions, then modifiers, then delayed.** It is
 * observable in the log and nowhere else, so it is decided once rather than by
 * whichever branch a reader happens to be looking at.
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
              modifier: { source, modifier: modifier.modifier },
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
    // The two riders that may end sooner than the casting — see
    // {@link ModifierRider}, where each is argued from its Instantaneous host.
    const lasts =
      modifier.kind === 'speed-change' || modifier.kind === 'action'
        ? modifier.lasts
        : undefined;
    const duration = riderDuration(lasts, casterId);
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

  return ok({ events, conditions });
}
