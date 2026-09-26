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
import { walkerOf } from '../state.js';
import { isCreatureType } from '../spell-definitions.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';
import { ongoingSpellsOn } from './ongoing.js';

/**
 * How many seconds of this creature's death do not count, because a casting
 * has been keeping the body.
 *
 * > SRD Gentle Repose: "days spent under the influence of this spell **don't
 * > count against the time limit** of spells such as _Raise Dead_."
 *
 * **The union of what the running castings cover, not the sum.** Every record
 * this can see is *running*, so each covers `[preserving, now]` and the union
 * of them all is `[the earliest, now]` — which is why the answer is one
 * subtraction off the earliest rather than a total over the list. Two reposes
 * laid over one body take back the days they were laid over, once.
 *
 * Clamped at the death, because a casting cannot keep a body that was not yet
 * a body: the only way to reach that is a `preserving` earlier than `diedAt`,
 * and the target rule that admits a corpse already refuses the living.
 *
 * Read off the ongoing records rather than out of the catalogue: the record
 * pins both halves at the cast, so a resurrection a week later asks the log's
 * own answer and not this month's book.
 */
export function preservedSpan(state: GameState, target: CharacterId, diedAt: number): number {
  let earliest: number | null = null;
  for (const record of ongoingSpellsOn(state, target)) {
    if (record.preserving === undefined) continue;
    const since = Math.max(record.preserving, diedAt);
    if (earliest === null || since < earliest) earliest = since;
  }
  const running = earliest === null ? 0 : Math.max(0, state.elapsed - earliest);
  // **And the days already spent.** SRD's word is "spent": a repose that has
  // ended keeps the span it ran, which the fold accrued onto the body when the
  // casting went — see `Vitals.preservedSeconds`. Added to the running span
  // rather than unioned with it, because a casting that has ended and one that
  // is running cannot overlap: the accrual is made at the ending, up to the
  // ending, and the running span begins where the record says. (W7-S19)
  const spent = state.creatures[target]?.vitals.preservedSeconds ?? 0;
  return running + spent;
}

/**
 * Why this body is not a corpse a spell may reach, or null where it is one.
 *
 * SRD Animate Dead: "The target becomes an Undead creature". A player
 * character's corpse keeps its record when it rises (the owner, 2026-09-26),
 * and while the creature it became is standing, the body is walking about as
 * that creature: Revivify, Gentle Repose and a second Animate Dead all find a
 * body that is not lying anywhere to be touched. Read off {@link walkerOf},
 * so the answer moves the moment the walker falls or leaves.
 *
 * Asked where each of those spells asks whether its target is a corpse — the
 * target rule's `mustBeDead` at the cast and in the shortlist, and
 * {@link reviveProblem} — so the refusal costs nothing; and again in the
 * raising and preserving resolvers, which is what reaches a rite declared
 * before the body rose.
 */
export function walkingBodyProblem(state: GameState, target: CharacterId, name: string): Result<true> {
  const walker = walkerOf(state, target);
  if (walker === null) return ok(true);
  return err(
    'body_walks',
    `${name} reaches a corpse, and ${target}'s body is walking about as ${walker}`,
  );
}

/**
 * Why this body may not become Undead, or null where it may.
 *
 * > SRD Gentle Repose: "For the duration, the target is protected from decay
 * > and **can't become Undead**."
 *
 * Read off the running castings on the body that keep it (`preserving` on the
 * record, pinned at the cast), which is the one fact that sentence hangs on:
 * the casting that stops the clock on a revival is the casting that stops the
 * body rising. The decay half is fiction and stays handed over.
 */
export function undeadForbiddenProblem(state: GameState, target: CharacterId, name: string): Result<true> {
  const keeping = ongoingSpellsOn(state, target).find((record) => record.preserving !== undefined);
  if (keeping === undefined) return ok(true);
  return err(
    'cannot_become_undead',
    `${name} would make ${target} Undead, and ${keeping.spell} keeps the body: it can't become Undead while that runs`,
  );
}

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

  // **A body something walks about in is not a corpse to touch** — see
  // `walkingBodyProblem`. Before the clock, so the refusal says what is
  // actually in the way while the walker stands.
  const walking = walkingBodyProblem(state, target, name);
  if (!walking.ok) return walking;

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

  // **And the days another casting has been keeping the body**, which is the
  // one sentence in the book that reaches into this arithmetic from outside —
  // SRD Gentle Repose. Subtracted rather than special-cased, because that is
  // what the sentence says: the span does not count, and everything else about
  // the window is unchanged.
  const kept = preservedSpan(state, target, diedAt);
  const ago = state.elapsed - diedAt - kept;
  if (ago > within) {
    return err(
      'died_too_long_ago',
      `${name} reaches a creature that died within ${within} seconds, and ${target} died ${state.elapsed - diedAt} seconds ago${kept === 0 ? '' : `, of which ${kept} do not count`}`,
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
 * Why this creature may not be stabilised, or null where it may.
 *
 * > SRD Spare the Dying: "Choose a creature within range that has **0 Hit
 * > Points and isn't dead**."
 *
 * **Written once and read from both ends**, which is `reviveProblem`'s rule
 * with one more consumer: `namedTargets` asks it for `TargetRule.mustBeDying`,
 * before an action is spent and before a shortlist offers anybody, and
 * {@link resolveStabiliseEffect} asks it where the event is written, for the
 * caller that never went through targeting at all. Two readings of one
 * sentence is two answers, and this sentence has two clauses to get wrong.
 *
 * The two refusals are the two `stabiliseCreature` already makes in the same
 * words — SRD names the state rather than a creature, and a corpse is Raise
 * Dead's business — under one code, because they are one clause of one spell
 * and a caller who aimed at the wrong body wants the reason rather than the
 * taxonomy.
 */
export function dyingProblem(
  state: GameState,
  target: CharacterId,
  name: string,
): Result<true> {
  const victim = state.creatures[target];
  // A creature the casting cannot find is targeting's refusal, not this one.
  if (victim === undefined) return ok(true);

  if (victim.vitals.dead) {
    return err(
      'target_not_dying',
      `${name} reaches a creature that is dying, and ${target} is dead`,
    );
  }
  if (victim.vitals.hp > 0) {
    return err(
      'target_not_dying',
      `${name} reaches a creature at 0 Hit Points, and ${target} has ${victim.vitals.hp}`,
    );
  }
  return ok(true);
}

/**
 * A dying creature that is not going to die of it.
 *
 * SRD Spare the Dying: "The creature becomes Stable." One word, and the event
 * it writes is the one `stabiliseCreature` writes when a DM declares the same
 * fact — so a Healer's Kit, a Medicine check and this cantrip all reach
 * `Vitals.stable` by the same door, and every reader of it is reached however
 * the creature came to be Stable.
 *
 * **The clause is checked here as well as in the target rule**, and the
 * duplication is `resolveReviveEffect`'s: the target rule exists so the
 * refusal is free, and this exists so the rule is *in the resolver* rather
 * than in whichever caller happened to remember it.
 */
export function resolveStabiliseEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes } = ctx;

  const allowed = dyingProblem(world, target, name);
  if (!allowed.ok) return allowed;

  const steadied = { type: 'stabilised' as const, id: target };
  events.push(steadied);
  outcomes.push({ target, affected: true });
  return ok(applyEvent(world, steadied));
}

/**
 * A body this casting keeps.
 *
 * SRD Gentle Repose. **It writes no event and reports no outcome, and both are
 * the shape rather than a gap.** What the sentence changes is a number another
 * command computes, and the two facts that command needs — which bodies, and
 * since when — are on the ongoing record the casting already leaves. There is
 * nothing about the creature to change, so there is nothing for an event to
 * say; and `aimedAt` files exactly the target a casting *reported nothing
 * about* into `OngoingSpell.aimed`, which is the bucket this belongs in and
 * what makes `isOn` — and therefore Dispel Magic, and `preservedSpan` — find
 * the casting on the body.
 *
 * The effect exists so that the definition says which spells do this rather
 * than the resolution guessing from a duration, and so that `checkEffect` has
 * something to hold to a casting that persists.
 */
export function resolvePreservesEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  // Where the rule lives, which is what reaches a ritual declared over a
  // corpse that rose before it was finished.
  const walking = walkingBodyProblem(world, target, ctx.name);
  if (!walking.ok) return walking;
  return ok(world);
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

/**
 * Whether this creature is in contact with the object, and why not where it is
 * not.
 *
 * > SRD Heat Metal: "**If a creature is holding or wearing the object** and
 * > takes the damage from it…"
 *
 * `equipped` is the whole of the contact the engine can see — armour on a body,
 * a weapon in a hand — so this is the sentence as the engine can read it.
 *
 * **Asked on both paths and not only at the cast**, which is the correction
 * this function exists for. The pre-flight in `resolveSpell` refuses a casting
 * aimed at a creature who has no such thing, and the Bonus Action on a later
 * turn goes nowhere near that pre-flight: a creature that dropped the mace on
 * the round before is no longer touching it, and without this it would have
 * taken the dice again and the Disadvantage for "not dropping" a thing it had
 * already let go of.
 *
 * Written once and asked twice, for {@link reviveProblem}'s reason.
 */
export function objectHeldProblem(
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

  if (victim.equipped.some((worn) => worn.id === item.id)) return ok(true);
  return err(
    'not_equipped',
    `${name} reaches a creature holding or wearing the object, and ${target} has no ${item.name} in hand or on their back`,
  );
}
