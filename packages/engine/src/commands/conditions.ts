/**
 * Applying a condition, and giving a timed effect a moment to stop at.
 *
 * `schedule` is here rather than in its own module because everything it
 * schedules is one of two things: a condition instance on a creature, or the
 * casting that hung one. It is the other half of applying a timed effect, and
 * `applyConditionTo` is the first half.
 */

import { type CharacterId, type ConditionName, err, ok, type Result } from '@ie/shared';
import { conditionInstanceId, reasonsFor } from '../conditions.js';
import {
  type Duration,
  type EffectCheck,
  type EffectTarget,
  type RepeatSave,
  resolveDuration,
} from '../duration.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { conditionImmunitiesOf } from '../standing.js';
import { creatureOf, turnContextFor, unknownCreature } from './command.js';

/**
 * Who a scheduled effect is being hung on, for a moment that names no anchor.
 *
 * Three of the four things a timer can end are on a creature; the fourth is a
 * casting, which is about a casting. SRD's "until the end of the current turn"
 * is a moment in the order rather than a fact about a creature, so it has no
 * anchor of its own and this is what a request is then about.
 */
const holderOf = (target: EffectTarget): string =>
  target.kind === 'casting' ? target.castingId : target.on;

/**
 * Apply a condition, refusing one the creature cannot receive.
 *
 * Immunity is a rules-legal refusal rather than a silent no-op, so the DM can
 * narrate it: the spell lands and does nothing.
 *
 * **What the creature is immune to is read off the creature.** It used to be
 * the *caller's* to supply, and no caller ever supplied one — every call site
 * in the engine passed the empty list, so a Zombie's printed "Immunities …
 * Exhaustion, Poisoned" reached nothing and it was Poisoned by Ray of Sickness
 * like anybody. {@link conditionImmunitiesOf} is the one gatherer and this is
 * where it is read, which is the shape `defensesOf` already has on the damage
 * side of the same printed line.
 *
 * `immuneTo` survives as a caller's **addition**, unioned rather than
 * overriding: a caller may know an immunity the engine's record does not hold,
 * and none may take one away that it does. Nothing in the engine passes it
 * today.
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
  return once(state, `condition:${id}`, {
    ...command,
    condition,
    source,
    ...(duration === undefined ? {} : { duration }),
    ...(repeatSave === undefined ? {} : { repeatSave }),
    ...(check === undefined ? {} : { check }),
  }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }
    if (immuneTo.includes(condition) || conditionImmunitiesOf(state, id).includes(condition)) {
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
  });
}

/**
 * End named conditions on a creature — **the condition, not a cause of it.**
 *
 * SRD Lay On Hands: "you can expend 5 Hit Points ... to remove **one** of the
 * following conditions"; SRD Lesser Restoration: "You touch a creature and end
 * one condition on it: Blinded, Deafened, Paralyzed, or Poisoned"; SRD
 * Protection from Poison: "You touch a creature and end the Poisoned condition
 * on it." Every one of them names a **condition** and says nothing whatever
 * about what caused it, so an ally poisoned by a serpent *and* by a bad oyster
 * is not half-cured. Omitting the source is how the reducer is told that:
 * `removeCondition` lifts every instance of the name, and each instance takes
 * the conditions it implied along with it.
 *
 * **One removal, two callers**, which is the whole reason this is a function
 * rather than two loops. `useHealingTouch` wrote it first, for Lay On Hands,
 * and the `end-condition` spell effect reaches the same line — so the reading
 * above is preserved by being shared rather than by being remembered twice.
 * `healing-touch.test.ts` is the guard: a second removal written beside this
 * one has to diverge from it visibly.
 *
 * It reads no state and refuses nothing. **Removing a condition a creature does
 * not have is not an error** — Lay On Hands has already been paid for and a
 * spell has already been cast, and `removeCondition` finds nothing and changes
 * nothing. A caller that wants to report whether anything was actually cured
 * asks the creature first; that is a question about the outcome rather than
 * about the removal, and only one of the two callers has an outcome to report.
 */
export function endConditionsOn(
  id: CharacterId,
  conditions: readonly ConditionName[],
): readonly GameEvent[] {
  return conditions.map((condition) => ({ type: 'condition-removed', id, condition }));
}

/**
 * The event that gives an effect a moment to stop at.
 *
 * The duration is resolved here rather than in the reducer, so a relative
 * duration that cannot be answered — "the start of your next turn", asked
 * outside combat — is something the caller sees, not a deadline the log cannot
 * evaluate later.
 *
 * **And what the caller sees is homework rather than a verdict.** A moment in
 * the turn order with no turn order to be a moment in is a *thin record*: the
 * conversion beneath still refuses, because calling that moment six seconds is
 * the one mistake the two-type split exists to prevent, and this is the
 * command layer that knows which rule wanted the fact and can therefore say
 * what would settle it.
 *
 * **It is converted here because this is the single door**, the same argument
 * that put the conversion itself in one place. Five modules schedule a
 * deadline — a condition a DM hangs, a casting's own Duration, a readied
 * spell's, a feature's activation, the grant a `speed-change` rider makes —
 * and every one of them reaches this function. A sixth gets the request with
 * nothing to remember, which is the difference between one rule and five sites
 * that have to agree.
 *
 * The subject falls back to the creature the effect is being hung on, and is
 * read off the {@link EffectTarget} rather than passed beside it: a caller
 * that could name a different one is a caller that could name the wrong one.
 * A casting's deadline is about the casting, which is why a request's subject
 * is a string.
 */
export function schedule(
  state: GameState,
  target: EffectTarget,
  duration: Duration,
  repeatSave?: RepeatSave,
  check?: EffectCheck,
): Result<GameEvent> {
  const deadline = resolveDuration({ elapsed: state.elapsed, combat: state.combat }, duration);
  if (!deadline.ok) return turnContextFor(deadline, duration, holderOf(target));
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

