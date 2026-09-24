/**
 * The effect kinds that change a fact about a creature rather than a number on
 * it.
 *
 * What they have in common is the thing they are *not*: none of them moves hit
 * points, throws a die, opens a window or hangs a bonus. Each writes over
 * something the engine holds authoritatively about a creature — whether it is
 * alive, and what it is attuned to — which is why the refusals are the
 * interesting part of every one of them and why they are asked twice: once in
 * `resolveSpell`'s pre-flight so a refusal costs no slot, and once here, where
 * the rule actually lives.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { applyEvent, type GameState } from '../events.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * Why this creature may not be raised, or null where it may.
 *
 * Written once and asked twice — the pre-flight in `resolveSpell` calls it
 * before a slot is spent, and {@link resolveReviveEffect} calls it where the
 * event is written — because two readings of one rule is two answers, and the
 * one that matters is the one that stops a Cleric paying a level 3 slot to be
 * told the corpse is too cold.
 *
 * SRD Revivify: "a creature that has died **within the last minute**". Both
 * refusals are rules-legal values rather than exceptions: a Cleric who touches
 * the wrong body has not made a programmer error.
 */
export function reviveProblem(
  state: GameState,
  target: CharacterId,
  within: number,
  name: string,
): Result<true> {
  const victim = state.creatures[target];
  // A creature the casting cannot find is targeting's refusal, not this one.
  if (victim === undefined) return ok(true);

  if (!victim.vitals.dead) {
    return err('not_dead', `${name} raises the dead, and ${target} is alive`);
  }

  // **A corpse whose death this log never saw.** `diedAt` is stamped by the
  // fold on the transition, so the only creature with none is one that has
  // been dead since before the field existed — a frozen fixture, or a thin
  // record somebody added as a corpse. Refusing is the conservative answer and
  // the honest one: the spell reaches back a minute, and a death nothing dates
  // is not a death within the last minute. It says what would settle it.
  const diedAt = victim.vitals.diedAt;
  if (diedAt === null) {
    return err(
      'died_too_long_ago',
      `${name} reaches a creature that died within ${within} seconds, and nothing says when ${target} died`,
    );
  }

  const ago = state.elapsed - diedAt;
  if (ago > within) {
    return err(
      'died_too_long_ago',
      `${name} reaches a creature that died within ${within} seconds, and ${target} died ${ago} seconds ago`,
    );
  }

  return ok(true);
}

/**
 * A creature that was dead, and is not any more.
 *
 * SRD Revivify: "That creature revives with 1 Hit Point." The hit points are
 * pinned onto the event from the definition rather than assumed by the fold,
 * which is CLAUDE.md's rule 5 on the one number this sentence prints.
 *
 * **The window is checked here as well as in the pre-flight**, and the
 * duplication is the point: the pre-flight exists so the refusal is free, and
 * this exists so the rule is *in the resolver* rather than in whichever caller
 * happened to remember it. An activation or an area trigger reaching this kind
 * never goes through the pre-flight at all.
 */
export function resolveReviveEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'revive'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes } = ctx;

  const allowed = reviveProblem(world, target, effect.within, name);
  if (!allowed.ok) return allowed;

  const before = world.creatures[target]?.vitals.hp ?? 0;
  const raised = {
    type: 'creature-revived' as const,
    id: target,
    hitPoints: effect.hitPoints,
    source: name,
  };
  events.push(raised);
  const current = applyEvent(world, raised);

  // Reported as healing, because that is what a reader of an outcome wants to
  // know and what the hit points actually did — a corpse at 0 standing up at
  // 1. `affected` says the effect landed; the log's own event says what it was.
  outcomes.push({
    target,
    healed: (current.creatures[target]?.vitals.hp ?? before) - before,
    affected: true,
  });
  return ok(current);
}
