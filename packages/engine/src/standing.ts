import type { Ability, CharacterId, ConditionName } from '@ie/shared';
import type { Bonus, ModeSource } from './bonuses.js';
import { UNIVERSAL_ACTION_EFFECTS } from './actions.js';
import {
  conditionSpeed,
  conditionState,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import { abilityModifier } from './character.js';
import { distanceBetween } from './positioning.js';
import type { GameState } from './events.js';
import type { DamageDefenses } from './attack.js';

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
  | { readonly kind: 'condition-immunity'; readonly condition: ConditionName }
  /**
   * SRD Elemental Affinity: "You have Resistance to that damage type."
   *
   * Resistance rather than a general defence entry, because that is all any
   * SRD class feature grants this way — a feature that made somebody immune or
   * vulnerable would be a different shape and none exists to model it after.
   */
  | { readonly kind: 'damage-resistance'; readonly damageTypes: readonly string[] }
  /**
   * Extra damage on a weapon attack that hits.
   *
   * Two SRD features, and the difference between them is the whole reason this
   * carries a damage type at all:
   *
   * - **Rage Damage** is "a bonus to the damage", of the weapon's own type, so
   *   a target resisting the sword resists the bonus with it. No `damageType`.
   * - **Radiant Strikes** is "an extra 1d8 Radiant damage", which Slashing
   *   resistance does nothing to. `damageType: 'radiant'`.
   *
   * The conditions are each feature's own sentence: Rage Damage wants an
   * attack "using Strength", Radiant Strikes one "using a Melee weapon or an
   * Unarmed Strike".
   */
  /**
   * SRD Dodge: "any attack roll made against you has Disadvantage if you can
   * see the attacker."
   *
   * Read at the attack rather than at a save, which is why it is its own kind
   * — and `ifSeen` carries the clause, because sight here is the *target's* of
   * the attacker, not the other way round.
   */
  | { readonly kind: 'attacked-with-disadvantage'; readonly ifSeen: boolean }
  | {
      readonly kind: 'attack-damage';
      readonly dice?: string;
      readonly flat?: number;
      /** Absent means the weapon's own type, which is what a *bonus* is. */
      readonly damageType?: string;
      /** SRD Rage Damage: "When you make an attack using Strength". */
      readonly usingAbility?: Ability;
      /** SRD Radiant Strikes: "using a Melee weapon or an Unarmed Strike". */
      readonly meleeOnly?: boolean;
    };

/**
 * What must hold for a standing effect to apply at all.
 *
 * Declared per effect, from that feature's own text, because it is **not** a
 * general rule. Danger Sense stops "unless you have the Incapacitated
 * condition" and the Paladin's aura "is inactive while you have the
 * Incapacitated condition"; Elemental Affinity says nothing of the kind, and a
 * stunned Sorcerer still resists fire. An earlier version of this module
 * applied the first two features' clause to everything, which would have
 * quietly rewritten the third.
 */
export type StandingRequirement =
  | { readonly kind: 'not-incapacitated' }
  /**
   * A feature must be switched on — and **not necessarily this one**.
   *
   * SRD Rage grants Resistance and Advantage "while active", where the feature
   * required is the one granting them. Mindless Rage is the case that makes
   * the distinction real: it is the Berserker's feature, and what it requires
   * is the *Barbarian's* Rage. A requirement that meant "whichever feature
   * granted me" would have been right once and wrong the next time.
   */
  | { readonly kind: 'feature-active'; readonly feature: string }
  /**
   * SRD Dodge: "You lose these benefits ... if your Speed is 0."
   *
   * Speed after conditions, which is what Grappled, Restrained and the rest
   * set to zero — the same reading movement takes.
   */
  | { readonly kind: 'has-speed' };

/** One benefit a feature grants, with its reach already resolved to feet. */
export interface StandingEffect {
  /** The feature that grants it, so a log can name the rule. */
  readonly feature: string;
  readonly name: string;
  readonly reach: StandingReach;
  readonly grant: StandingGrant;
  /** What must be true of the holder. Empty means the benefit is unconditional. */
  readonly requires?: readonly StandingRequirement[];
}

/** What ends a feature that is running, besides its own deadline. */
export type ActivationEnd = 'incapacitated' | 'heavy-armor';

/**
 * A feature a creature switches on, and what switching it on costs.
 *
 * What it *does* while it runs is ordinary {@link StandingEffect}s requiring
 * `feature-active`; this is only the machinery of being switchable. SRD Rage
 * needs every field of it at once, which is what makes the shape real rather
 * than a guess: a Bonus Action, a pool sized by the class table, a deadline
 * that can be pushed, a cap it cannot be pushed past, and two ways out that
 * nobody commands.
 */
export interface ActivatedFeature {
  readonly feature: string;
  readonly name: string;
  /** What turning it on costs in the action economy, outside combat nothing. */
  readonly action: 'action' | 'bonus-action' | 'none';
  /** The pool a use comes out of, or null when it costs none. */
  readonly pool: string | null;
  /**
   * When one activation runs to, unless it is extended.
   *
   * Both moments the SRD uses, and they are a full round apart: Rage "lasts
   * until the end of your next turn", Dodge "until the start of your next
   * turn". Nothing derives one from the other.
   */
  readonly lasts: 'end-of-next-turn' | 'start-of-next-turn';
  /** SRD Rage: "You can maintain a Rage for up to 10 minutes." */
  readonly capSeconds?: number;
  /** What ends it early, each read from the feature's own text. */
  readonly endsOn?: readonly ActivationEnd[];
  /** SRD Rage: "You can't maintain Concentration, and you can't cast spells." */
  readonly forbidsCasting?: boolean;
}

/** A standing effect that is reaching a particular creature right now. */
export interface ActiveStanding {
  readonly from: CharacterId;
  readonly effect: StandingEffect;
}

/**
 * Whether the holder meets what this particular effect asks of them.
 *
 * Only what the feature's own text says. "Inactive while you have the
 * Incapacitated condition" is the aura's sentence and Danger Sense's, read
 * from the two ends; it is not a property of standing effects in general.
 */
function meetsRequirements(state: GameState, who: CharacterId, effect: StandingEffect): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;

  for (const requirement of effect.requires ?? []) {
    if (requirement.kind === 'not-incapacitated' && isIncapacitated(creature.conditions)) {
      return false;
    }
    if (
      requirement.kind === 'feature-active' &&
      !creature.activeFeatures.includes(requirement.feature)
    ) {
      return false;
    }
    if (
      requirement.kind === 'has-speed' &&
      conditionSpeed(creature.conditions, creature.sheet.baseSpeed) <= 0
    ) {
      return false;
    }
  }
  return true;
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
  if (!meetsRequirements(state, from, effect)) return false;
  if (effect.reach.kind === 'self') return from === who;

  // A corpse radiates nothing. The SRD does not say so because it does not
  // contemplate the question; it is stated here rather than left to the fact
  // that a dead creature is usually Unconscious too. A *self* effect is
  // untouched by this — a dead sorcerer resisting fire harms nobody.
  if (state.creatures[from]?.vitals.dead === true) return false;

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

    // A creature's own features, plus the actions anybody can take. The
    // second list is not on anybody's sheet, because it belongs to everybody.
    const held = [
      ...(creature.sheet.standing ?? []),
      ...UNIVERSAL_ACTION_EFFECTS,
    ].sort((a, b) => a.feature.localeCompare(b.feature));

    for (const effect of held) {
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
 * Whether attacks against this creature are made at Disadvantage right now.
 *
 * `seen` is the *target's* view of the attacker — SRD Dodge says "if you can
 * see the attacker" — and is three-valued like every other declared fact. A
 * benefit whose clause nobody has settled is applied and reported rather than
 * dropped, which is the same direction an Opportunity Attack takes.
 */
export function attackedWithDisadvantage(
  state: GameState,
  who: CharacterId,
  seen: boolean | null,
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  const modes: ModeSource[] = [];
  const unverified: string[] = [];

  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'attacked-with-disadvantage') continue;
    if (effect.grant.ifSeen && seen === false) continue;
    if (effect.grant.ifSeen && seen === null) {
      unverified.push(
        `nobody has said whether ${who} can see their attacker, and ${effect.name} needs that; the benefit was applied rather than withheld`,
      );
    }
    modes.push({ source: effect.name, mode: 'disadvantage' });
  }

  return { modes, unverified };
}

/**
 * Damage types this creature's features make it resistant to.
 *
 * SRD: "multiple instances of Resistance to the same damage type count as only
 * one", which is why `DamageDefenses` is booleans rather than counts — so two
 * features naming Fire is the same halving as one.
 */
export function standingDefenses(
  state: GameState,
  who: CharacterId,
): Readonly<Record<string, DamageDefenses>> {
  const defenses: Record<string, DamageDefenses> = {};

  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'damage-resistance') continue;
    for (const type of effect.grant.damageTypes) {
      defenses[type.toLowerCase()] = { resistant: true };
    }
  }

  return defenses;
}

/**
 * Everything this creature resists, is immune to, or is vulnerable to.
 *
 * The stat block's entries and the features' together, and the **stronger**
 * answer wins per type: a creature already Immune to Fire is not weakened into
 * merely resisting it by a feature that grants Resistance, because SRD applies
 * Immunity first and stops.
 */
export function defensesOf(
  state: GameState,
  who: CharacterId,
): Readonly<Record<string, DamageDefenses>> {
  const own = state.creatures[who]?.defenses ?? {};
  const granted = standingDefenses(state, who);
  if (Object.keys(granted).length === 0) return own;

  const merged: Record<string, DamageDefenses> = { ...own };
  for (const [type, defence] of Object.entries(granted)) {
    const existing = merged[type];
    merged[type] =
      existing === undefined ? defence : { ...existing, resistant: existing.resistant ?? true };
  }
  return merged;
}

/** What an attack was, for deciding which features have anything to say about it. */
export interface AttackContext {
  /** The ability the attack roll actually used. */
  readonly ability: Ability;
  readonly melee: boolean;
}

/**
 * Extra damage this creature's features add to an attack that has hit.
 *
 * Split the way `rollAttackDamage` splits it: a *bonus* is damage of the
 * weapon's own type and rides with it through Resistance, while *extra* damage
 * of another type is applied separately. Collapsing the two would give a
 * Barbarian's Rage Damage the wrong answer against a Slashing-resistant
 * target, or a Paladin's Radiant the wrong one.
 */
export function standingAttackDamage(
  state: GameState,
  who: CharacterId,
  context: AttackContext,
): {
  readonly bonuses: readonly Bonus[];
  readonly extra: readonly {
    readonly source: string;
    readonly type: string;
    readonly dice?: string;
    readonly flat?: number;
  }[];
} {
  const bonuses: Bonus[] = [];
  const extra: { source: string; type: string; dice?: string; flat?: number }[] = [];

  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-damage') continue;
    if (grant.usingAbility !== undefined && grant.usingAbility !== context.ability) continue;
    if (grant.meleeOnly === true && !context.melee) continue;

    if (grant.damageType === undefined) {
      bonuses.push({
        source: effect.name,
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
        ...(grant.dice === undefined ? {} : { dice: grant.dice }),
      });
    } else {
      extra.push({
        source: effect.name,
        type: grant.damageType,
        ...(grant.dice === undefined ? {} : { dice: grant.dice }),
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
      });
    }
  }

  return { bonuses, extra };
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
