import type { Ability, CharacterId, ConditionName } from '@ie/shared';
import type { Bonus, ModeSource } from './bonuses.js';
import {
  conditionState,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import { abilityModifier } from './character.js';
import { distanceBetween } from './positioning.js';
import type { GameState } from './events.js';

/**
 * Benefits a class feature grants for as long as its rule holds.
 *
 * These are not the bonuses a spell hangs on a creature, and the difference is
 * the whole design. A spell's bonus *starts* at a moment somebody can write
 * down — `bonus-applied`, linked to the casting that made it — and ends when
 * that casting does. An aura has no such moment: whether you are in one is a
 * fact about where two creatures are standing, and it changes every time
 * either of them moves, without anything happening that a log could record.
 *
 * So these are **derived from state on every read**, and nothing is ever
 * stored on the creature they reach. That is not an optimisation; it is the
 * only way a conditional benefit stays conditional. A stored copy would be an
 * unconditional bonus wearing a feature's name, and it would go wrong at
 * exactly the moment it mattered — the paladin walks away, the barbarian is
 * stunned — because nothing would have told it to.
 *
 * What the SRD asks for, feature by feature:
 *
 * | Feature | Reach | Condition |
 * |---|---|---|
 * | Danger Sense | self | "unless you have the Incapacitated condition" |
 * | Aura of Protection | 10-foot Emanation | "inactive while you have the Incapacitated condition" |
 * | Aura of Courage | the same aura | — |
 * | Aura of Devotion | the same aura | — |
 */

/** Where a standing benefit reaches. */
export type StandingReach =
  | { readonly kind: 'self' }
  /**
   * SRD: "a 10-foot Emanation that originates from you", measured the way
   * everything else is — between volumes, on the cube lattice. The holder is
   * in their own aura because the text says so ("You and your allies in the
   * aura"), not because the geometry puts them there: an Emanation excludes
   * its own origin.
   */
  | { readonly kind: 'aura'; readonly feet: number };

/** What a standing benefit does. */
export type StandingGrant =
  /** SRD Danger Sense: "Advantage on Dexterity saving throws". */
  | { readonly kind: 'advantage'; readonly on: 'save'; readonly ability: Ability }
  /**
   * SRD Aura of Protection: "a bonus to saving throws equal to your Charisma
   * modifier (minimum bonus of +1)" — the *holder's* modifier, read off their
   * sheet rather than the beneficiary's.
   */
  | { readonly kind: 'save-bonus'; readonly fromAbility: Ability; readonly minimum: number }
  /**
   * SRD Aura of Courage: "Immunity to the Frightened condition while in your
   * Aura of Protection. If a Frightened ally enters the aura, that condition
   * **has no effect on that ally while there**."
   *
   * Suppression, not prevention and not removal. The condition stays on the
   * creature and comes back the moment they leave, which is what "while there"
   * means and what a flat immunity would get wrong in both directions.
   */
  | { readonly kind: 'condition-immunity'; readonly condition: ConditionName };

/** One benefit a feature grants, with its reach already resolved to feet. */
export interface StandingEffect {
  /** The feature that grants it, so a log can name the rule. */
  readonly feature: string;
  readonly name: string;
  readonly reach: StandingReach;
  readonly grant: StandingGrant;
}

/** A standing effect that is reaching a particular creature right now. */
export interface ActiveStanding {
  readonly from: CharacterId;
  readonly effect: StandingEffect;
}

/**
 * Whether a creature can sustain what its features radiate.
 *
 * SRD says "inactive while you have the Incapacitated condition" for the aura
 * and "unless you have the Incapacitated condition" for Danger Sense, which is
 * the same test read from the two ends. Death is not in either sentence
 * because the SRD does not contemplate a corpse radiating protection; it is
 * added here and said out loud rather than left to the fact that a dead
 * creature is usually Unconscious too.
 */
function canSustain(state: GameState, who: CharacterId): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (creature.vitals.dead) return false;
  return !isIncapacitated(creature.conditions);
}

/**
 * Whether two creatures are allies.
 *
 * Who is on your side is fiction, like cover and line of sight, so it is
 * **declared** rather than derived: a creature carries the side the table put
 * it on. Two creatures are allies when they are on the same declared side.
 *
 * A creature nobody has placed on a side is nobody's ally. That is a default,
 * and it is the conservative one — the benefit is withheld rather than
 * invented — but it is a default, so `standingFor` reports it rather than
 * letting an aura silently fail to reach somebody.
 */
function alliedWith(state: GameState, a: CharacterId, b: CharacterId): boolean {
  if (a === b) return true;
  const sideA = state.creatures[a]?.side ?? null;
  const sideB = state.creatures[b]?.side ?? null;
  return sideA !== null && sideA === sideB;
}

/** Whether this effect, held by `from`, is reaching `who` right now. */
function reaches(state: GameState, from: CharacterId, effect: StandingEffect, who: CharacterId): boolean {
  if (!canSustain(state, from)) return false;
  if (effect.reach.kind === 'self') return from === who;

  // SRD: "You and your allies in the aura."
  if (from === who) return true;
  if (!alliedWith(state, from, who)) return false;

  if (state.scene === null) return false;
  const apart = distanceBetween(state.scene, from, who);
  // An unplaced creature is not in anybody's aura. Where a creature is
  // standing has no right answer until somebody says, and inventing one to
  // hand out a bonus is the wrong direction to guess in.
  if (!apart.ok) return false;
  return apart.value <= effect.reach.feet;
}

/**
 * Every standing effect reaching this creature, from whoever is holding it.
 *
 * Sorted by holder and then by feature, so two readers of the same state agree
 * about the order — which matters because the best-of rule below picks the
 * first of a tie.
 */
export function standingFor(state: GameState, who: CharacterId): readonly ActiveStanding[] {
  const active: ActiveStanding[] = [];

  for (const holder of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[holder];
    if (creature === undefined) continue;

    for (const effect of [...(creature.sheet.standing ?? [])].sort((a, b) =>
      a.feature.localeCompare(b.feature),
    )) {
      if (reaches(state, holder as CharacterId, effect, who)) {
        active.push({ from: holder as CharacterId, effect });
      }
    }
  }

  return active;
}

/**
 * Flat bonuses this creature's standing effects add to a saving throw.
 *
 * SRD Aura of Protection: "If another Paladin is present, a creature can
 * benefit from only one Aura of Protection at a time; the creature chooses
 * which aura while in them." That is a choice with one sensible answer — a
 * bigger bonus costs nothing and gives up nothing — so the best is taken and
 * named, on the same reading that settles two Unarmoured Defenses. Two
 * *different* features would both apply; it is the same feature twice that
 * does not stack.
 */
export function standingSaveBonuses(
  state: GameState,
  who: CharacterId,
  ability: Ability,
): readonly Bonus[] {
  void ability;
  const best = new Map<string, Bonus>();

  for (const { from, effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'save-bonus') continue;

    const holder = state.creatures[from];
    if (holder === undefined) continue;

    const flat = Math.max(
      effect.grant.minimum,
      abilityModifier(holder.sheet.abilities[effect.grant.fromAbility]),
    );
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: `${effect.name} (${from})`, flat });
    }
  }

  return [...best.values()];
}

/** Advantage or disadvantage this creature's standing effects impose on a save. */
export function standingSaveModes(
  state: GameState,
  who: CharacterId,
  ability: Ability,
): readonly ModeSource[] {
  const modes: ModeSource[] = [];

  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'advantage') continue;
    if (effect.grant.on !== 'save') continue;
    if (effect.grant.ability !== ability) continue;
    modes.push({ source: effect.name, mode: 'advantage' });
  }

  return modes;
}

/**
 * Conditions that are on this creature but currently do nothing.
 *
 * Kept separate from removing them, because the SRD is explicit that the
 * condition is still there: "If a Frightened ally enters the aura, that
 * condition has no effect on that ally while there." Stepping out of the aura
 * restores it, and nothing had to remember to put it back.
 */
export function suppressedConditions(
  state: GameState,
  who: CharacterId,
): readonly ConditionName[] {
  const names = new Set<ConditionName>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind === 'condition-immunity') names.add(effect.grant.condition);
  }
  return [...names].sort();
}

/**
 * The conditions that actually bite on this creature right now.
 *
 * Every reader of condition *effects* should go through this rather than
 * through `creature.conditions`, which is the record of what is on them. The
 * two differ exactly where a feature says a condition has no effect.
 */
export function effectiveConditions(state: GameState, who: CharacterId): ConditionState {
  const creature = state.creatures[who];
  if (creature === undefined) return conditionState([]);

  return withoutConditions(creature.conditions, suppressedConditions(state, who));
}
