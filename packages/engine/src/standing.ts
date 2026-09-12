import {
  err,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import type { Bonus, ModeSource } from './bonuses.js';
import { UNIVERSAL_ACTION_EFFECTS } from './actions.js';
import {
  conditionSpeed,
  conditionState,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import { abilityModifier, armorClass } from './character.js';
import { distanceBetween } from './positioning.js';
import type { GameState } from './events.js';
import type { DamageDefenses } from './attack.js';
import type { Weapon } from '@ie/srd';
import { canUseFeatureThisTurn } from './combat.js';

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
   * SRD Feral Instinct: "you have Advantage on Initiative rolls."
   *
   * Its own member rather than a save with a Dexterity ability, because
   * Initiative is an ability check and the two are rolled by different
   * functions — and because the SRD says "Initiative rolls" rather than
   * "Dexterity checks", which are not the same set.
   */
  | { readonly kind: 'advantage'; readonly on: 'initiative' }
  /**
   * SRD Remarkable Athlete: "Advantage on ... Strength (Athletics) checks."
   *
   * Named by skill rather than by ability, because that is how the SRD writes
   * it and because a skill check and a bare ability check of the same ability
   * are different rolls.
   */
  | { readonly kind: 'advantage'; readonly on: 'skill'; readonly skill: Skill }
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
  /**
   * SRD Evasion, which the Rogue and the Monk both have under that name:
   *
   * > "When you're subjected to an effect that allows you to make a Dexterity
   * > saving throw to take only half damage, you instead take no damage if you
   * > succeed on the saving throw and only half damage if you fail."
   *
   * Named for the SRD rule rather than for either class, exactly as
   * `expertise` is — two features, one rule, and the rule has a name. It
   * carries no fields because both features are word for word the same; where
   * they differ is the Monk's "You can't use this feature if you have the
   * Incapacitated condition", which is an ordinary `StandingRequirement` and
   * is declared on that feature alone.
   *
   * It bites only where the effect already offers half on a success. An effect
   * that offers nothing — Sacred Flame — has no half to take, and Evasion says
   * nothing about it.
   */
  | { readonly kind: 'evasion' }
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
      /**
       * SRD "Once per turn" / "Once on each of your turns".
       *
       * Sneak Attack, Colossus Slayer, Divine Strike and Primal Strike all say
       * it, which is what makes it the shape rather than one class's quirk —
       * and it is **not** once per round. See `featureUsedOnTurn`.
       *
       * Outside combat there are no turns and nothing restricts it.
       */
      readonly oncePerTurn?: boolean;
      /**
       * SRD Colossus Slayer: "When you hit a creature **with a weapon**".
       *
       * Distinct from `meleeOnly`: an Unarmed Strike is melee and is not a
       * weapon, so a Monk's fist qualifies for Radiant Strikes and not for
       * this.
       */
      readonly weaponOnly?: boolean;
      /** SRD Sneak Attack: "the attack uses a Finesse or a Ranged weapon". */
      readonly finesseOrRangedWeapon?: boolean;
      /**
       * SRD Colossus Slayer: "if it's missing any of its Hit Points".
       *
       * A fact about the target the engine holds exactly, which is why this
       * feature is expressible and Horde Breaker beside it is not.
       */
      readonly targetMissingHitPoints?: boolean;
      /**
       * SRD Sneak Attack's two-branch qualification, transcribed whole.
       *
       * > "if you have Advantage on the roll ... You don't need Advantage on
       * > the attack roll if at least one of your allies is within 5 feet of
       * > the target, the ally doesn't have the Incapacitated condition, and
       * > you don't have Disadvantage on the attack roll."
       *
       * One field rather than three because it is one sentence with an
       * either/or in it, and splitting it would let a definition express half
       * of a rule the SRD never writes by halves. It has one user, like
       * `usingAbility` had when Rage Damage was the only feature with it —
       * each of these is a feature's own clause rather than a generalisation.
       */
      readonly advantageOrAdjacentAlly?: boolean;
      /**
       * Damage types the holder picks between **at the hit**.
       *
       * SRD Divine Strike: "an extra 1d8 Necrotic or Radiant damage (your
       * choice)". SRD Primal Strike: "Cold, Fire, Lightning, or Thunder
       * (choose when you hit)". Per hit, so it cannot live on the sheet the
       * way Elemental Affinity's one resistance does.
       *
       * Naming no type is how a caller declines the feature, which is what
       * "**you can** cause the target to take" means. An illegal type is
       * refused before anything is rolled rather than quietly ignored.
       */
      readonly damageTypeChoices?: readonly string[];
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

/**
 * A feature that gives a *different* pool's uses back, at a moment that is not
 * a rest.
 *
 * Two features write this sentence — Sorcerous Restoration and Magical
 * Cunning — and they agree on everything structural and differ on every
 * number. Both spend one use of a pool of their own that only a Long Rest
 * refills, both regain expended uses of some other pool, and both cap what
 * comes back. What is not shared is the pool, the sizing, the rounding or the
 * moment, so each of those is declared per feature from its own sentence —
 * the rule `StandingRequirement` already follows.
 *
 * It is not `ActivatedFeature`: nothing is switched on, nothing runs for a
 * duration, and there is nothing to switch off.
 */
export interface RecoveryFeature {
  readonly feature: string;
  readonly name: string;
  /**
   * The pool holding the feature's own limit.
   *
   * "Once you use this feature, you can't do so again until you finish a Long
   * Rest" is a pool of one that recovers on a Long Rest, which is a thing the
   * engine already has — so it is one, rather than a second kind of limit.
   */
  readonly pool: string;
  /** The pool it gives uses back to. */
  readonly restores: string;
  /**
   * How the cap is sized, transcribed from the feature's own sentence.
   *
   * Two members because two features, and each names a different number to
   * halve *and* a different way to round it. Collapsing them would have made
   * one of the two wrong, silently, in exactly the way `DiceScaling`'s
   * per-slot notation was nearly made wrong by reading an increase off a base.
   */
  readonly upTo: 'half-class-level' | 'half-pool-maximum';
  /** The level the sizing reads, which is *that class's*, not the character's. */
  readonly classLevel: number;
  /**
   * The moment the feature's sentence names.
   *
   * `short-rest` is one the engine can see and therefore enforces. `declared`
   * is one it cannot: Magical Cunning's "esoteric rite for 1 minute" is a
   * minute of fiction, and no state distinguishes it from a minute of walking.
   * That clause is the table's in the same way a disguise is — performing a
   * rite is not arithmetic — and naming it here is what keeps it from being
   * mistaken for a rule nobody built.
   */
  readonly moment: 'short-rest' | 'declared';
}

/**
 * The most this feature can give back, before what is actually expended is
 * taken into account.
 *
 * Derived at the moment of use rather than stored on the sheet, for the reason
 * every conditional benefit in this file is: a pool's maximum can move, and a
 * number written down at creation would go on being the old one.
 */
export function recoveryCap(feature: RecoveryFeature, poolMax: number): number {
  switch (feature.upTo) {
    // SRD Sorcerous Restoration: "no more than a number equal to half your
    // Sorcerer level (round down)."
    case 'half-class-level':
      return Math.floor(feature.classLevel / 2);
    // SRD Magical Cunning: "no more than a number equal to half your maximum
    // (round up)."
    case 'half-pool-maximum':
      return Math.ceil(poolMax / 2);
  }
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

/**
 * A creature's Armour Class, with whatever is currently raising it.
 *
 * `armorClass` reads a sheet: armour, Dexterity, a shield, or the number a
 * stat block printed. That is the whole answer for a creature nobody has cast
 * anything on, and it was the only answer the engine had — so Shield of Faith
 * had no way to grant its +2 and Shield had no way to grant its +5.
 *
 * Only flat bonuses count. An Armour Class is a standing number rather than a
 * roll, so there is no moment at which a die could be thrown for it, and no
 * SRD spell asks for one. A rolled bonus aimed at `ac` is ignored rather than
 * guessed at.
 *
 * Cover is deliberately *not* here: it is a fact about one attacker's line to
 * one target, not about the target, and the attack that reads it adds it.
 */
export function armorClassOf(state: GameState, who: CharacterId): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 0;

  let total = armorClass(creature.sheet);
  for (const active of creature.bonuses) {
    if (!active.applies.includes('ac')) continue;
    const flat = active.bonus.flat ?? 0;
    total += active.direction === 'subtract' ? -flat : flat;
  }
  return total;
}

/** What an attack was, for deciding which features have anything to say about it. */
export interface AttackContext {
  /** The ability the attack roll actually used. */
  readonly ability: Ability;
  readonly melee: boolean;
  /** Null for an Unarmed Strike, which is not a weapon. */
  readonly weapon: Weapon | null;
  /**
   * How the attack roll came out, after Advantage and Disadvantage cancelled.
   *
   * The *resolved* mode rather than a list of sources, because that is what
   * SRD Sneak Attack asks about: "if you have Advantage on the roll" reads the
   * roll, and a roll with one of each is a normal roll.
   */
  readonly mode: RollMode;
  readonly target: CharacterId;
  /** The turn this attack happens on; null outside combat, where none exists. */
  readonly turn: number | null;
  /**
   * The damage type chosen for each feature that offers a choice, by feature id.
   *
   * Absent for a feature means the holder declined it — SRD writes these as
   * "you can", and there is no other moment at which declining could be said.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
}

/**
 * Refuse a damage type the feature does not offer, before anything is rolled.
 *
 * A caller may choose between the types the SRD prints and may not invent one:
 * Divine Strike is Necrotic or Radiant, and a Cleric asking for Fire is asking
 * for a rule that does not exist. Checked up front, so a refusal costs neither
 * a die nor the attack.
 */
export function checkFeatureDamageTypes(
  state: GameState,
  who: CharacterId,
  chosen: Readonly<Record<string, string>> | undefined,
): Result<true> {
  if (chosen === undefined) return ok(true);
  const offered = new Map<string, readonly string[]>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind === 'attack-damage' && effect.grant.damageTypeChoices !== undefined) {
      offered.set(effect.feature, effect.grant.damageTypeChoices);
    }
  }

  for (const [feature, type] of Object.entries(chosen)) {
    const allowed = offered.get(feature);
    if (allowed === undefined) {
      return err('no_such_feature_choice', `${who} has no feature ${feature} that chooses a damage type`);
    }
    if (!allowed.includes(type)) {
      return err(
        'bad_damage_type',
        `${feature} deals ${allowed.join(' or ')} damage, not ${type}`,
      );
    }
  }
  return ok(true);
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
/**
 * SRD Sneak Attack's second branch, which is the one the engine can only
 * sometimes answer.
 *
 * > "at least one of your allies is within 5 feet of the target, the ally
 * > doesn't have the Incapacitated condition, and you don't have Disadvantage
 * > on the attack roll."
 *
 * Allegiance is **declared**, like cover and sight, and nobody is an ally by
 * default. A table that has not said who is on whose side gets no ally here —
 * which withholds the benefit rather than inventing one, and is reported so
 * the layer above knows the difference between "no ally was near" and "nobody
 * has said".
 */
function adjacentAllyOf(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
): { readonly found: boolean; readonly declared: boolean } {
  const mine = state.creatures[attacker]?.side ?? null;
  if (mine === null || state.scene === null) return { found: false, declared: false };

  for (const id of Object.keys(state.creatures).sort()) {
    if (id === attacker || id === target) continue;
    const other = state.creatures[id];
    if (other === undefined || other.side !== mine || other.vitals.dead) continue;
    if (isIncapacitated(other.conditions)) continue;
    const apart = distanceBetween(state.scene, id as CharacterId, target);
    if (apart.ok && apart.value <= 5) return { found: true, declared: true };
  }
  return { found: false, declared: true };
}

/**
 * Whether this creature's features turn a half-damage Dexterity save into none.
 *
 * Asked of the *target* rather than the caster, which is what makes it a
 * defence: the Rogue standing in the Fireball is the one who evades it.
 */
/**
 * Advantage on Initiative this creature's features grant.
 *
 * Attributed, like every other mode, because Advantage cancels rather than
 * stacks and a roll that came out normal should still be able to say what
 * cancelled what.
 */
export function standingInitiativeModes(state: GameState, who: CharacterId): ModeSource[] {
  return standingFor(state, who)
    .filter(({ effect }) => effect.grant.kind === 'advantage' && effect.grant.on === 'initiative')
    .map(({ effect }) => ({ source: effect.name, mode: 'advantage' as const }));
}

/** Advantage on a named skill's checks, from the same place. */
export function standingSkillModes(
  state: GameState,
  who: CharacterId,
  skill: Skill,
): ModeSource[] {
  return standingFor(state, who)
    .filter(
      ({ effect }) =>
        effect.grant.kind === 'advantage' &&
        effect.grant.on === 'skill' &&
        effect.grant.skill === skill,
    )
    .map(({ effect }) => ({ source: effect.name, mode: 'advantage' as const }));
}

export function evadesHalfDamage(
  state: GameState,
  who: CharacterId,
  ability: Ability,
  offersHalfOnSuccess: boolean,
): boolean {
  if (ability !== 'dex' || !offersHalfOnSuccess) return false;
  return standingFor(state, who).some(({ effect }) => effect.grant.kind === 'evasion');
}

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
  /** Once-per-turn features this attack spends the allowance of. */
  readonly spent: readonly string[];
  /** Qualifications the engine could not settle from what it holds. */
  readonly unverified: readonly string[];
} {
  const bonuses: Bonus[] = [];
  const extra: { source: string; type: string; dice?: string; flat?: number }[] = [];
  const spent: string[] = [];
  const unverified: string[] = [];

  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-damage') continue;
    if (grant.usingAbility !== undefined && grant.usingAbility !== context.ability) continue;
    if (grant.meleeOnly === true && !context.melee) continue;
    if (grant.weaponOnly === true && context.weapon === null) continue;
    if (
      grant.finesseOrRangedWeapon === true &&
      !(context.weapon?.properties.includes('finesse') === true ||
        context.weapon?.kind === 'ranged')
    ) {
      continue;
    }
    if (grant.targetMissingHitPoints === true) {
      const victim = state.creatures[context.target];
      if (victim === undefined || victim.vitals.hp >= victim.vitals.hpMax) continue;
    }
    if (grant.advantageOrAdjacentAlly === true && context.mode !== 'advantage') {
      // The second branch. Disadvantage rules it out outright; otherwise it
      // needs an ally the table has placed and named.
      if (context.mode === 'disadvantage') continue;
      const ally = adjacentAllyOf(state, who, context.target);
      if (!ally.found) {
        if (!ally.declared) {
          unverified.push(
            `${effect.name} could also qualify through an ally within 5 feet of ${context.target}; nobody has declared who is on whose side, so it did not`,
          );
        }
        continue;
      }
    }
    // Last, so that a feature ruled out by its own qualifications does not
    // spend an allowance it never used.
    // SRD "you can cause the target to take an extra 1d8 Necrotic or Radiant
    // damage (your choice)": naming no type declines the feature, which is the
    // only moment at which "you can" could be answered.
    let chosenType: string | undefined;
    if (grant.damageTypeChoices !== undefined) {
      chosenType = context.featureDamageTypes?.[effect.feature];
      if (chosenType === undefined || !grant.damageTypeChoices.includes(chosenType)) continue;
    }

    if (grant.oncePerTurn === true && state.combat !== null) {
      if (!canUseFeatureThisTurn(state.combat, who, effect.feature)) continue;
      if (context.turn !== null) spent.push(effect.feature);
    }

    const type = chosenType ?? grant.damageType;
    if (type === undefined) {
      bonuses.push({
        source: effect.name,
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
        ...(grant.dice === undefined ? {} : { dice: grant.dice }),
      });
    } else {
      extra.push({
        source: effect.name,
        type,
        ...(grant.dice === undefined ? {} : { dice: grant.dice }),
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
      });
    }
  }

  return { bonuses, extra, spent, unverified };
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
