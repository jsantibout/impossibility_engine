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
import { type Content } from '../content.js';
import { applyEvent, type GameState } from '../events.js';
import { isCreatureType } from '../spell-definitions.js';
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

/**
 * Why this Attunement may not be broken, or null where it may.
 *
 * Written once and asked twice, for {@link reviveProblem}'s reason: the
 * pre-flight in `resolveSpell` calls it before a slot is spent and
 * {@link resolveEndAttunementEffect} calls it where the event is written, and
 * two readings of one rule is two answers.
 *
 * The object is read as the **kind** it is a copy of, which is what
 * `attuneItem` and `endAttunement` both do: attunement is a yes or no per kind
 * of item, so a caller naming a copy's own id finds the same relation.
 */
export function attunementProblem(
  state: GameState,
  content: Content,
  target: CharacterId,
  object: string,
  name: string,
): Result<true> {
  const item = content.item(object);
  if (item === null) return err('unknown_item', `${object} is not in the catalogue`);

  const victim = state.creatures[target];
  // A creature the casting cannot find is targeting's refusal, not this one.
  if (victim === undefined) return ok(true);

  if (!victim.attuned.some((held) => held.id === item.id)) {
    return err('not_attuned', `${target} is not attuned to ${item.name}, so ${name} breaks nothing`);
  }
  return ok(true);
}

/**
 * The target stops being attuned to the object the caster named.
 *
 * SRD Remove Curse: "the spell breaks its owner's Attunement to the object so
 * it can be removed or discarded." The removing and the discarding are two
 * commands somebody may take afterwards and are deliberately not taken here:
 * the sentence says the object *can* be removed, which is a permission rather
 * than an instruction, and a spell that took the cloak off its owner would be
 * playing the creature.
 *
 * The event is the one `endAttunement` already emits, so every reader of a
 * broken attunement — the grants that come off the sheet, the benefit that
 * stops — is reached by exactly the route it always was.
 */
export function resolveEndAttunementEffect(
  ctx: EffectContext,
  _effect: EffectOfKind<'end-attunement'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { name, supply, events, outcomes } = ctx;
  const object = ctx.object;
  if (object === undefined) {
    throw new Error(
      `${name} breaks an Attunement and no object was named; ` +
        'the caller should have been refused `object_required` before reaching here',
    );
  }

  const allowed = attunementProblem(world, supply.content, target, object, name);
  if (!allowed.ok) return allowed;

  const kind = supply.content.item(object)!.id;
  const ended = { type: 'attunement-ended' as const, id: target, item: kind };
  events.push(ended);
  outcomes.push({ target, affected: true });
  return ok(applyEvent(world, ended));
}

/**
 * Why this creature may not be masked as that type, or null where it may.
 *
 * SRD Arcanist's Magic Aura: "Choose a creature type **other than the target's
 * actual type**." The clause is a refusal rather than a substitution — the
 * spell does nothing at all if the chosen type is the one the creature already
 * is, and quietly hanging an inert grant would be a slot spent on a casting
 * that changed nothing.
 *
 * **Asked of the creature's own type rather than of what magic sees**, which
 * is the distinction the mask exists to make: a goblin already wearing a
 * Humanoid mask is still a Fey, and the book's "actual type" names exactly
 * that field. A second casting choosing Humanoid over the first is therefore
 * legal, and the two masks are two sources.
 *
 * A creature nobody has typed is not refused here: `creatureTypeNeeds` has
 * already raised the request for it before anything was spent, so reaching
 * this with a null type means the caller answered it.
 *
 * Written once and asked twice, for {@link reviveProblem}'s reason.
 */
export function maskProblem(
  state: GameState,
  target: CharacterId,
  chosen: string,
  name: string,
): Result<true> {
  const victim = state.creatures[target];
  // A creature the casting cannot find is targeting's refusal, not this one.
  if (victim === undefined) return ok(true);

  if (isCreatureType(victim.creatureType, chosen)) {
    return err(
      'same_creature_type',
      `${name} masks a creature as a type other than its actual one, and ${target} is already ${chosen}`,
    );
  }
  return ok(true);
}

/**
 * A creature type put over the target's own, for what magic believes.
 *
 * SRD Arcanist's Magic Aura, _Mask (Creature)_: "Spells and other magical
 * effects treat the target as if it were a creature of the chosen type."
 *
 * The nineteenth sourced grant, hung under the casting's own source, so every
 * door that ends a grant — a dispel, a broken Concentration, the deadline, the
 * caster leaving — gives the creature its own type back without anybody having
 * to remember to. `typeMagicSees` is the reader and its docstring is where the
 * line between a magical asker and a mundane one is drawn.
 */
export function resolveCreatureTypeOverrideEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'creature-type-override'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { name, source, events, outcomes } = ctx;

  const allowed = maskProblem(world, target, effect.creatureType, name);
  if (!allowed.ok) return allowed;

  const masked = {
    type: 'creature-type-masked' as const,
    id: target,
    mask: { source, creatureType: effect.creatureType },
  };
  events.push(masked);
  outcomes.push({ target, affected: true });
  return ok(applyEvent(world, masked));
}
