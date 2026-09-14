/**
 * The one effect kind that moves its target rather than changing it.
 *
 * Alone in a module because it is alone in its family. The arithmetic and
 * every refusal are `commands/teleport.ts`'s, so there is nothing here to
 * share with a neighbour and no honest family to file it under — and a module
 * of one is the true answer where a contrived family would not be.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import { applyEvent, type GameState } from '../events.js';
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
  const { definition, events, outcomes, unverified } = ctx;
  if (ctx.teleportTo === undefined) {
    throw new Error(
      `${definition.name} teleports its target and no destination was stated; ` +
        'the caller should have been refused `destination_required` before reaching here',
    );
  }

  const moved = teleportTo(world, target, {
    placement: ctx.teleportTo,
    within: effect.feet,
    ...(effect.requiresSight === undefined ? {} : { requiresSight: effect.requiresSight }),
  });
  if (!moved.ok) return moved;

  events.push(...moved.value.events);
  unverified.push(...moved.value.unverified.map((gap) => `${definition.name}: ${gap}`));
  outcomes.push({ target, affected: true });
  return ok(moved.value.events.reduce(applyEvent, world));
}
