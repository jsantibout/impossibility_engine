/**
 * The one effect kind that moves its target rather than changing it.
 *
 * Alone in a module because it is alone in its family. The arithmetic and
 * every refusal are `commands/teleport.ts`'s, so there is nothing here to
 * share with a neighbour and no honest family to file it under — and a module
 * of one is the true answer where a contrived family would not be.
 */

import { ABILITY_NAMES, type CharacterId, ok, type Result } from '@ie/shared';
import { rollSavingThrow } from '../checks.js';
import { applyEvent, type GameState } from '../events.js';
import { sheetAsItStands } from '../standing.js';
import { recordD20Test, savingSupport } from './rolls.js';
import { teleportTo } from './teleport.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * The target is somewhere else, and nothing was spent getting there.
 *
 * The arithmetic and every refusal are `teleportTo`'s in `commands/teleport.ts`
 * — the range, the unoccupied space, the scene's extent and the declared sight
 * — so this resolver is the wiring and nothing more. It reaches the **low
 * half**, without the identity or the `mayAct` guard the command carries,
 * for the reason `resolveCastWith` exists beneath `resolveCast`: the casting
 * has already been paid for and already asked whether anybody may act, and a
 * second refusal here would be one arriving after the world had moved.
 *
 * **The destination is loud rather than absent when it is missing.**
 * `declaredFacts` refuses a teleporting spell that names nowhere to go before
 * a slot is spent, `PendingCasting` pins it for a settlement, and
 * `checkTeleportPlacement` refuses the effect anywhere an area trigger or an
 * activation could reach it — so arriving here with none is the definition and
 * the command layer disagreeing, which is programmer error and is the same
 * answer `casterSheet` gives a casting that outlived its caster.
 */
export function resolveTeleportEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'teleport'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes, unverified } = ctx;
  if (ctx.teleportTo === undefined) {
    throw new Error(
      `${name} teleports its target and no destination was stated; ` +
        'the caller should have been refused `destination_required` before reaching here',
    );
  }

  const moved = teleportTo(world, target, {
    placement: ctx.teleportTo,
    within: effect.feet,
    ...(effect.requiresSight === undefined ? {} : { requiresSight: effect.requiresSight }),
  });
  if (!moved.ok) return moved;

  // SRD Magic Circle: "If the creature tries to use teleportation or
  // interplanar travel to do so, it must first succeed on a Charisma saving
  // throw." `teleportTo` is pure and hands the demand back; this is the road
  // with dice. Rolled through `savingSupport` like every other save a spell
  // forces, recorded, and the creature arrives only on a success — the slot is
  // spent either way, because "must first succeed" is a casting made.
  const demanded = moved.value.saveToCross;
  if (demanded !== undefined) {
    const victim = world.creatures[target];
    if (victim !== undefined) {
      const { supply } = ctx;
      const support = savingSupport(world, target, victim, demanded.ability, supply, [], true);
      const sheet = sheetAsItStands(world, target) ?? victim.sheet;
      const save = rollSavingThrow(supply.issuer, supply.rng, sheet, demanded.ability, {
        dc: demanded.dc,
        conditions: support.conditions,
        modes: support.modes,
        bonuses: support.bonuses,
      });
      if (!save.ok) return save;
      events.push(
        recordD20Test(
          target,
          `${ABILITY_NAMES[demanded.ability]} save vs ${demanded.spell}`,
          save.value,
          save.value.success ? 'crossed' : 'held back',
        ),
      );
      if (!save.value.success) {
        outcomes.push({ target, affected: false, save: save.value });
        return ok(world);
      }
    }
  }

  events.push(...moved.value.events);
  unverified.push(...moved.value.unverified.map((gap) => `${name}: ${gap}`));
  outcomes.push({ target, affected: true });
  return ok(moved.value.events.reduce(applyEvent, world));
}
