/**
 * The two effect kinds that impose a condition and lift one.
 *
 * `end-condition` is `condition` inverted, and inverted is the only thing
 * they share — a removal has no rider, no deadline and nothing for the
 * casting to own. They sit together so that the two halves of one sentence
 * stay in view, not because they share code: the imposing half reaches
 * `spell-effect-riders.ts` and the lifting half reaches nothing.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import { reasonsFor } from '../conditions.js';
import { applyEvent, type CreatureState, type GameState } from '../events.js';
import { conditionRiderOf } from '../spell-definitions.js';
import { applyConditionTo, endConditionsOn } from './conditions.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';
import { conditionLanding, imposeCondition, riderOptions } from './spell-effect-riders.js';

/**
 * SRD Greater Invisibility: "A creature you touch has the Invisible
 * condition until the spell ends." The `save` branch above, minus the
 * roll — no die, no `roll-recorded`, and the generator does not move,
 * because the spell asked for nothing to be thrown.
 *
 * **Two origins and one condition.** SRD Potion of Invisibility confers the
 * same condition with nothing cast at all — "When you drink the potion, you
 * have the Invisible condition for 1 hour" — so this is the one resolver that
 * branches on {@link EffectContext.origin}, and it branches over exactly what
 * the two origins differ by: what the condition is filed under, and who owns
 * how long it lasts.
 *
 * - A **casting** files it under `Spell#cast:N` and hands the rider's own
 *   sentences — a lifetime, an escape check, a repeat save, a mark that the
 *   casting does not keep it — to `riderOptions`, every one of which needs a
 *   casting id somewhere downstream.
 * - An **item** files it under `item:<id>`, which `castingIdOf` answers null
 *   for, and passes **none** of those four: `checkContent` refuses all four on
 *   a conferred condition, so a conferral has nothing to translate. What holds
 *   it is the timer `useItem` files afterwards, whose deadline is the item's
 *   printed hour and whose `endsEarly` is the item's printed sentence.
 *
 * Nothing else moves. `SpellEffectOptions`, `riderOptions` and
 * `applySpellEffect` are untouched and still require a casting, because the
 * item arm never reaches them.
 */
export function resolveConditionEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'condition'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, name, events, outcomes, held, saveDc } = ctx;
  let current = world;

  // **Not a rider host**, because it has no outcome: there is no roll
  // whose affirmative branch anything could ride, so the rider *is* the
  // effect and there is exactly one of it. `conditionRiderOf` types that
  // as a non-empty list, which is why the first element is not a guess.
  const [rider] = conditionRiderOf(effect);
  const landed =
    ctx.origin.kind === 'item'
      ? // No duration, no repeat save, no escape check and no casting: the
        // conferral's own deadline is filed by `useItem`, and the other three
        // are fields `checkContent` refuses an item for printing.
        conditionLanding(applyConditionTo(current, target, rider.name, ctx.source))
      : imposeCondition(
          current,
          target,
          rider,
          casterId,
          riderOptions(rider, {
            castingId: ctx.casting().castingId,
            spell: name,
            casterId,
            saveDc,
            target,
            saveAbility: null,
          }),
        );
  if (!landed.ok) return landed;

  // A target immune to the one condition this kind imposes is **unaffected**,
  // which is a real outcome and not an error — the reading `end-condition`
  // already takes for a spell that finds nothing to cure. `conditions` is
  // absent rather than empty, so a reader asking whether a condition was
  // imposed asks one question.
  if (!landed.value.landed) {
    outcomes.push({ target, affected: false });
    return ok(current);
  }

  events.push(...landed.value.events);
  current = landed.value.events.reduce(applyEvent, current);
  if (rider.outlivesCasting !== true) held.add(target);
  outcomes.push({ target, conditions: [rider.name], affected: true });
  return ok(current);
}

/**
 * SRD Lesser Restoration: "You touch a creature and end one condition on
 * it: Blinded, Deafened, Paralyzed, or Poisoned." The `condition` branch
 * above, inverted — and inverted is the only thing it shares, because a
 * removal has no rider: no deadline, no escape check, no repeat save, and
 * nothing for the casting to own. Nothing is rolled and the generator
 * does not move; the spell asked for nothing to be thrown.
 */
export function resolveEndConditionEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'end-condition'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { events, outcomes } = ctx;
  let current = world;

  // **Ask what there is to remove, of the thing the removal acts on.**
  // `removeCondition` works over the instances, so the instances are what
  // decide whether anything happens. `conditions.conditions` is derived
  // from exactly those and agrees with this today — but `hasCondition`,
  // the other reader to hand, does **not**: it special-cases Exhaustion,
  // which is a level rather than an instance, so it would report a
  // removal for an Exhaustion that `removeCondition` could never take
  // away. No registered spell ends Exhaustion; that is a reason to write
  // the direct question down rather than to rely on the agreement.
  const present = effect.conditions.filter(
    (condition) => reasonsFor(victim.conditions, condition).length > 0,
  );

  // **Nothing to cure is not an error, and it is not an event either.**
  // The casting happened and the slot went; what the log must not carry
  // is a `condition-removed` for a condition that was never there, which
  // would be a record of something that did not happen.
  if (present.length === 0) {
    outcomes.push({ target, affected: false });
    return ok(current);
  }

  // One removal, shared with `useHealingTouch` — see `endConditionsOn`
  // for why the source is omitted and what that means.
  const lifted = endConditionsOn(target, present);
  events.push(...lifted);
  current = lifted.reduce(applyEvent, current);
  outcomes.push({ target, ended: present, affected: true });
  return ok(current);
}
