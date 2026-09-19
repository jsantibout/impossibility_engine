import {
  err,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type Result,
  type RollMode,
} from '@ie/shared';
import type { Bonus, ModeSource, StandingBonusApplies } from './bonuses.js';
import {
  grantedRollModes,
  selectorMatches,
  type RollModifier,
  type RollQuery,
} from './roll-modifiers.js';
import { UNIVERSAL_ACTION_EFFECTS } from './actions.js';
import {
  conditionSpeed,
  conditionState,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import { abilityModifier, armorClass } from './character.js';
import {
  distanceBetween,
  sightBetween,
  type CreatureSense,
  type SenseName,
} from './positioning.js';
import type { CreatureState, GameState } from './events.js';
import { spellOfSource } from './spells.js';
import type { DamageDefenses, DefenseKind } from './attack.js';
import type { Weapon } from '@ie/srd';
import { canUseFeatureThisTurn, movementLeft } from './combat.js';

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
  /**
   * Advantage or Disadvantage on a kind of roll — see {@link RollModifier}.
   *
   * **One member where there were four.** Danger Sense's "Advantage on
   * Dexterity saving throws", Feral Instinct's "Advantage on Initiative
   * rolls", Remarkable Athlete's "Advantage on Strength (Athletics) checks"
   * and Dodge's "any attack roll made against you has Disadvantage" were four
   * separate grant kinds with four separate readers, because there was no key
   * that could say *which* roll a mode reached — and in particular no way at
   * all to say that a mode belongs to rolls made **against** its holder, which
   * is why Dodge's was a grant kind of its own rather than a mode.
   *
   * A spell that grants a standing mode needs exactly the same vocabulary, so
   * the two sit on one selector and one predicate rather than on two
   * parallel mechanisms that could disagree. What still differs is the
   * *lifetime*: a feature's grant is derived from the world on every read and
   * stored nowhere, while a spell's is durable state linked to its casting.
   */
  | {
      readonly kind: 'roll-mode';
      readonly modifier: RollModifier;
      /**
       * SRD Dodge: "...has Disadvantage **if you can see the attacker**".
       *
       * The holder's view of whoever is rolling, which is the opposite
       * direction from the sight every other rule reads — and three-valued,
       * like every declared fact. A clause nobody has settled is applied and
       * reported rather than dropped, the direction an Opportunity Attack
       * already takes.
       *
       * Declared per effect because it is that feature's own sentence: Danger
       * Sense says nothing of the kind, and applying Dodge's clause to
       * everything would quietly rewrite it.
       */
      readonly ifSeen?: boolean;
    }
  /**
   * SRD Aura of Protection: "a bonus to saving throws equal to your Charisma
   * modifier (minimum bonus of +1)" — the *holder's* modifier, read off their
   * sheet rather than the beneficiary's.
   */
  | { readonly kind: 'save-bonus'; readonly fromAbility: Ability; readonly minimum: number }
  /**
   * A flat number added to something, with the item or feature's name on it.
   *
   * **The commonest sentence in the book, and the one shape this union did not
   * have.** `save-bonus` above is Aura of Protection's — a number *derived*
   * from an ability, which is why it is its own member — and `attack-damage`
   * below is a feature's extra die. Between them they could not say "+1 bonus
   * to Armor Class", which the SRD prints on dozens of items and on nothing
   * else in the engine.
   *
   * **It is the spell side's shape admitted here**, the way `roll-mode` is
   * `RollModifier` admitted here: `ActiveBonus` has carried `applies` and a
   * flat number since Shield of Faith, and reading a second vocabulary for the
   * same arithmetic is how two mechanisms come to disagree. What differs is
   * the lifetime — a spell's bonus starts at a moment and is stored, this one
   * is derived on every read — and the one thing a spell never needed:
   *
   * **the narrowing.** SRD Weapon, +1: "a bonus to attack rolls and damage
   * rolls **made with this magic weapon**". A spell hangs its bonus on a
   * creature and is done; an item's rides on the *object*, so a +1 Longsword
   * must do nothing for the bow in the same pack. {@link onlyWithItem} is that
   * clause, and {@link StandingEffect.feature} is the item it names.
   *
   * Flat, and only flat. Every bonus the SRD prints in this shape is a number
   * — the rarity decides whether it is 1, 2 or 3 — and an Armour Class has no
   * moment at which a die could be thrown for it. A feature that rolled would
   * be `attack-damage` or a caller's `Bonus`, both of which already exist.
   */
  | {
      readonly kind: 'flat-bonus';
      /**
       * SRD "to Armor Class and saving throws": one sentence, two targets.
       *
       * `attack` is a **weapon** attack roll here. A spell attack gathers no
       * standing bonus, and the member that would reach one is
       * `a-bonus-to-spell-attack-rolls`, named and deliberately absent — see
       * {@link StandingBonusApplies}.
       */
      readonly applies: readonly StandingBonusApplies[];
      /** Signed, so a cursed item's penalty needs no second mechanism. */
      readonly flat: number;
      /**
       * SRD Weapon, +1: "made with this magic weapon" — and with no other.
       *
       * Keyed on {@link StandingEffect.feature}, which carries the granting
       * item's id, so the narrowing needs no second field to look anything up
       * in. Legal only where a roll is *made with* something: an Armour Class
       * and a saving throw are not, and `checkContent` refuses the pairing
       * rather than accepting a benefit that could never hold.
       */
      readonly onlyWithItem?: boolean;
    }
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
   *
   * **And one clause no class feature has**: {@link onlyWithItem}, which is
   * `flat-bonus`'s narrowing on the member beside it. A feature's die belongs
   * to the *character* and rides whatever they swing; a magic weapon's belongs
   * to the *object*, and the SRD writes the difference in as many words —
   * Vicious Weapon is "this magic weapon deals an extra 2d6 damage", Frost
   * Brand "when you hit with an attack roll using this magic weapon". Without
   * it the die would follow its holder onto every other weapon in the pack,
   * which is a better item than the book prints.
   */
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
  /**
   * Feet added to the holder's Speed while the feature's own clause holds.
   *
   * Three SRD features and one sentence between them:
   *
   * | | |
   * |---|---|
   * | Fast Movement (Barbarian 5) | "Your speed increases by 10 feet while you aren't wearing Heavy armor." |
   * | Roving (Ranger 6) | "Your Speed increases by 10 feet while you aren't wearing Heavy armor." |
   * | Unarmored Movement (Monk 2) | "Your speed increases by 10 feet while you aren't wearing armor or wielding a Shield. This bonus increases when you reach certain Monk levels." |
   *
   * A flat number rather than a per-level table, because the table is
   * `FeatureGrant.feetByLevel` and is read at **that class's own** level when
   * the sheet is built — the same split `diceCountByLevel` already makes for
   * Sneak Attack, and for the same reason: a standing effect on a sheet knows
   * nothing about which class granted it.
   *
   * Speed *reductions* are not this member's business. Exhaustion's "5 times
   * your Exhaustion level" is `conditionSpeed`'s, and nothing else in the
   * engine reduces one yet.
   */
  | { readonly kind: 'speed'; readonly feet: number }
  /**
   * A sense the holder has, and how far it reaches.
   *
   * SRD writes one sentence for all four of them — "You have Darkvision with
   * a range of 60 feet", "the vampire has Blindsight out to 60 feet", "you
   * have Truesight out to 120 feet" — and a species trait, a monster's stat
   * block and a magic item all print it the same way, which is what makes it
   * a shape rather than one species' quirk.
   *
   * A standing grant rather than a field on the sheet, and the two clauses
   * that decides are the SRD's own: Goggles of Night grant Darkvision "while
   * you wear" them, and Robe of Eyes while it is worn, so the sense has to be
   * derived on every read exactly as a Monk's Unarmoured Movement is. A
   * stored copy would be Darkvision that survived taking the goggles off.
   *
   * What it is **not** is a claim about light. The engine holds no Bright,
   * Dim or Darkness — see `sightBetween`, which consults a sense only where
   * nobody has declared a sight line, and obeys the declaration everywhere
   * else.
   */
  | { readonly kind: 'sense'; readonly sense: SenseName; readonly feet: number }
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
      /**
       * SRD Vicious Weapon: "**this magic weapon** deals an extra 2d6 damage".
       *
       * The same clause `flat-bonus.onlyWithItem` carries and read the same
       * way — keyed on {@link StandingEffect.feature}, which carries the
       * granting item's id, so it needs no second field to look anything up
       * in, and a class feature declaring it would grant nothing at all.
       * `checkContent` refuses that pairing rather than accepting it.
       *
       * It narrows *which weapon*, and nothing else. Whether the die lands at
       * all still depends on the qualifications above, and an item whose
       * clause tests what the *target* is — "if the target is a Dragon" — is a
       * different narrowing that does not exist yet.
       */
      readonly onlyWithItem?: boolean;
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
   * The **whole** Speed, through `speedOf`, which is the reading movement
   * takes — so a spell that sets a Speed to 0 will end a Dodge through the
   * same door Grappled already does.
   *
   * A `speed` grant may not carry this requirement, and that is what keeps the
   * reading from being circular: `speedOf` asks the requirements of the grants
   * it is adding up, so a Speed grant conditioned on a Speed would be a
   * question asked of its own answer. No SRD feature writes one — all three
   * are conditioned on armour — and `invariants.test.ts` asserts that of every
   * registered feature source rather than trusting it.
   */
  | { readonly kind: 'has-speed' }
  /**
   * SRD Fast Movement, and SRD Roving in the same words: "while you aren't
   * wearing **Heavy** armor."
   *
   * Not "unarmoured": a Barbarian in a chain shirt keeps the ten feet, and
   * reading the clause as the stricter one would quietly take them away.
   */
  | { readonly kind: 'not-wearing-heavy-armor' }
  /**
   * SRD Unarmored Movement: "while you aren't wearing armor **or wielding a
   * Shield**."
   *
   * Both halves, because the Shield is the half a clause named for armour
   * alone loses. Read off `equipped` through the sheet's two slots, which is
   * where "owning is not wearing" already put the answer.
   */
  | { readonly kind: 'unarmored' }
  /**
   * SRD Magic Items: "requires attunement", and the benefit is had only by a
   * creature that has attuned to the item.
   *
   * Read off `attuned` on every read, exactly as `unarmored` is read off
   * `equipped`: attunement is a relation the creature holds, not a copy of the
   * benefit stored when somebody attuned. `feature` on the effect carries the
   * item's id, which is what this looks up.
   */
  | { readonly kind: 'while-attuned' }
  /**
   * SRD, in almost every magic item's first clause: "While you wear this
   * cloak", "While holding this rod".
   *
   * Separate from `while-attuned` because the SRD writes both on one item and
   * means two different things: taking the cloak off does not break the
   * attunement, and it does stop the benefit. An item that is attuned and
   * stowed keeps the effects that ask only for attunement and loses these.
   */
  | { readonly kind: 'while-worn' };

/** One benefit a feature grants, with its reach already resolved to feet. */
export interface StandingEffect {
  /**
   * The feature that grants it, so a log can name the rule.
   *
   * Or the **item**: a magic item's grant is compiled with the item's id here,
   * because the item is what grants it. That is also what `while-worn` and
   * `while-attuned` look up, so the two requirements need no second key.
   */
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
 * A feature whose use is spent to heal its own holder.
 *
 * Second Wind and Wholeness of Body. Both are a pool that already existed,
 * sized off the class table and refilling on the right rest, with nothing on
 * the other end of it: Second Wind's own note said *"healCreature exists and
 * nothing ties the two together."*
 *
 * The die is resolved at creation because one of the two reads it off a class
 * table — "roll your Martial Arts die" is 1d6 at Monk 1 and 1d10 at Monk 11 —
 * and the addend is kept symbolic because one of the two is an ability
 * modifier, which is a number on the sheet at the moment it is wanted.
 */
/**
 * Hit points a feature gives its holder: a die, something added to it, and
 * sometimes a floor.
 *
 * Its own type because three features write the same sum and only two of them
 * spend a pool use for it — Uncanny Metabolism's arrives riding on a recovery
 * instead. Resolved at creation, because two of the three read their die off a
 * class table.
 */
export interface HealAmount {
  /** Resolved: "1d10", or the Martial Arts die at that Monk's level. */
  readonly dice: string;
  readonly plus:
    | { readonly kind: 'level'; readonly level: number; readonly label: string }
    | { readonly kind: 'ability'; readonly ability: Ability; readonly label: string };
  /** SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". */
  readonly minimum?: number;
}

/**
 * A pool of hit points a feature spends by touching somebody.
 *
 * SRD Lay On Hands and the Restoring Touch that lengthens its list. Not
 * `SelfHealFeature`: that spends a *use* on its holder and rolls for the
 * amount, where this spends the amount itself, on anybody within reach, and
 * rolls nothing. "Those points don't also restore Hit Points to the creature"
 * is why the cost and the healing are two numbers rather than one.
 */
export interface HealingTouch {
  readonly feature: string;
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
  readonly pool: string;
  /** Sorted and deduplicated across every feature that contributes to it. */
  readonly lifts: readonly ConditionName[];
  readonly costPerCondition: number;
}

export interface SelfHealFeature extends HealAmount {
  readonly feature: string;
  readonly name: string;
  /** What using it costs in the action economy; outside combat, nothing. */
  readonly action: 'action' | 'bonus-action';
  /** The pool a use comes out of. */
  readonly pool: string;
}

/**
 * What the feature adds to the die, and what to call it in the log.
 *
 * Derived rather than stored for the ability case, so the number is the one on
 * the sheet when the die is thrown — the rule every conditional benefit in
 * this file follows.
 */
export function selfHealAddend(
  feature: HealAmount,
  abilities: Readonly<Record<Ability, number>>,
): { readonly amount: number; readonly label: string } {
  return feature.plus.kind === 'level'
    ? { amount: feature.plus.level, label: feature.plus.label }
    : { amount: abilityModifier(abilities[feature.plus.ability]), label: feature.plus.label };
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
  readonly upTo: 'half-class-level' | 'half-pool-maximum' | 'all';
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
  readonly moment: 'short-rest' | 'declared' | 'initiative';
  /**
   * Hit points the recovery brings with it.
   *
   * SRD Uncanny Metabolism: "you can regain all expended Focus Points. When
   * you do so, roll your Martial Arts die, and regain a number of Hit Points
   * equal to your Monk level plus the number rolled." One act, not two — the
   * healing has no separate cost and cannot be had without the recovery.
   */
  readonly heal?: HealAmount;
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
    // SRD Uncanny Metabolism and Persistent Rage: "regain **all** expended
    // ...". The pool's own maximum is the most that can ever be owed, and
    // what is actually expended narrows it at the moment of use.
    case 'all':
      return poolMax;
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
    // The whole Speed, not the base one conditions are applied to: `speedOf`
    // is the one reader, and a feature or (after IE-033) a spell that moves a
    // Speed has to reach this clause like everything else.
    if (requirement.kind === 'has-speed' && speedOf(state, who) <= 0) {
      return false;
    }
    if (
      requirement.kind === 'not-wearing-heavy-armor' &&
      creature.sheet.armor?.category === 'heavy'
    ) {
      return false;
    }
    if (
      requirement.kind === 'unarmored' &&
      (creature.sheet.armor !== null || creature.sheet.shield !== null)
    ) {
      return false;
    }
    // The item's own two clauses, read off the creature's relations to it.
    // `effect.feature` is the item's id for an item grant; a *feature* that
    // carried one of these would name no item and would never hold, which is
    // the conservative direction and what `checkContent` refuses outright.
    if (
      requirement.kind === 'while-worn' &&
      !creature.equipped.some((held) => held.id === effect.feature)
    ) {
      return false;
    }
    if (
      requirement.kind === 'while-attuned' &&
      !creature.attuned.some((held) => held.id === effect.feature)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The standing effects this creature's **items** are offering right now.
 *
 * Gathered from the two places an item's grants are pinned — what is worn and
 * what is attuned — and deduplicated by item, because an item that is both is
 * one item with one set of benefits. Whether any of them actually applies is
 * still `meetsRequirements`' question: this is the population, not the answer.
 *
 * The two lists are both read because they have different lifetimes. Taking a
 * ring off does not break the attunement, so an attuned item that nobody is
 * wearing still offers whatever it grants without asking to be worn — and an
 * item worn by somebody who never attuned to it still offers whatever needs no
 * attunement.
 */
export function itemStandingOf(creature: CreatureState): readonly StandingEffect[] {
  if (creature.equipped.length === 0 && creature.attuned.length === 0) return [];

  const byItem = new Map<string, readonly StandingEffect[]>();
  for (const held of creature.attuned) byItem.set(held.id, held.grants ?? []);
  for (const held of creature.equipped) byItem.set(held.id, held.grants ?? []);
  return [...byItem.keys()].sort().flatMap((item) => byItem.get(item) ?? []);
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
      // What this creature's magic items grant, pinned when they were put on
      // or attuned to, and conditional in exactly the way a feature's is.
      ...itemStandingOf(creature),
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

/**
 * What a roll is being made *with*, for the one clause that asks.
 *
 * The catalogue id of the weapon in hand, or null for an Unarmed Strike and
 * for every roll no object is made with — an Armour Class, a saving throw, a
 * Dexterity check. Absent is not null: a caller that does not know reads the
 * same as a roll made with nothing, which is the conservative direction.
 */
export interface BonusContext {
  readonly withItem?: string | null;
}

/**
 * Flat bonuses this creature's standing effects add to one kind of thing.
 *
 * {@link standingSaveBonuses}' sibling, and the general one: that answers only
 * for Aura of Protection's ability-derived shape, this for the flat number an
 * item prints. Both are here rather than at their readers because whether a
 * benefit applies changes when somebody walks away, and neither is stored.
 *
 * **Stacking is the SRD's own sentence**, and it is the reason the best is
 * keyed by `feature`. "Different game features can affect a target at the same
 * time. But when two or more game features have the same name, only the
 * effects of one of them — the most potent — apply while the durations of the
 * effects overlap." The granting item's id *is* the name, so a Ring of
 * Protection and a Cloak of Protection are +2 and two rings are +1 — the same
 * reading `standingSaveBonuses` takes for two Paladins' auras.
 *
 * "Most potent" is read as the larger number, which is right for every bonus
 * the SRD prints and **unsettled for a penalty**: two same-named cursed items
 * would keep the gentler of the two, where "most potent" arguably means the
 * harsher. It is written down rather than guessed because no such item exists
 * to decide it — `flat` is signed so one could — and a test freezing today's
 * answer would be the engine settling a question the book has not asked.
 *
 * `withItem` narrows: an effect that says "made with this magic weapon" is
 * withheld from every roll made with anything else, including the rolls no
 * object is made with at all.
 */
export function standingBonuses(
  state: GameState,
  who: CharacterId,
  applies: StandingBonusApplies,
  context: BonusContext = {},
): readonly Bonus[] {
  const best = new Map<string, Bonus>();
  const withItem = context.withItem ?? null;

  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'flat-bonus') continue;
    if (!effect.grant.applies.includes(applies)) continue;
    // "Made with this magic weapon", and with no other.
    if (effect.grant.onlyWithItem === true && withItem !== effect.feature) continue;

    const flat = effect.grant.flat;
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: effect.name, flat });
    }
  }

  return [...best.values()];
}

/**
 * Every Advantage and Disadvantage that reaches this roll, from anywhere.
 *
 * **The one gatherer.** A class feature's derived grant and a spell's durable
 * one are two lifetimes of the same mechanic, and before this they were read
 * by four functions that each knew one question — so a spell could not ask the
 * question Dodge answered, and Dodge could not be asked about a spell attack.
 * Both now go through the same {@link selectorMatches} predicate, and what
 * comes back is a list of attributed modes that {@link combineRollModes}
 * settles exactly as it settles every other mode in the engine. Nothing here
 * decides an outcome; the SRD's presence rule is still the only rule that
 * does, and it is still in one place.
 *
 * Deduplicated by source, so a caller who also knows about Danger Sense does
 * not apply it twice — the rule `savingSupport` and `rollInitiativeFor` were
 * already following, hoisted to where every family benefits from it.
 *
 * `seen` is the **holder's** view of whoever is rolling, for the one clause
 * that asks: SRD Dodge's "if you can see the attacker". Three-valued, and an
 * undeclared sight line applies the benefit and says so rather than silently
 * dropping it — the direction an Opportunity Attack already takes.
 */
export function rollModesFor(
  state: GameState,
  query: RollQuery,
  options: { readonly seenByHolder?: boolean | null } = {},
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  const modes: ModeSource[] = [];
  const unverified: string[] = [];
  const seen = new Set<string>();

  const push = (source: string, mode: RollMode): void => {
    if (seen.has(source)) return;
    seen.add(source);
    modes.push({ source, mode });
  };

  // A feature's grant is read from whoever holds it, and which creature that
  // is depends on the relation: a mode on the roller comes off the roller's
  // own sheet, while one on rolls *against* somebody comes off the creature
  // being rolled against. So both ends are asked, and the predicate decides.
  const holders: CharacterId[] = [query.roller];
  const against = query.against ?? null;
  if (against !== null && against !== query.roller) holders.push(against);

  for (const holder of holders) {
    for (const { effect } of standingFor(state, holder)) {
      if (effect.grant.kind !== 'roll-mode') continue;
      if (!selectorMatches(effect.grant.modifier.selector, holder, query)) continue;

      if (effect.grant.ifSeen === true) {
        const sight = options.seenByHolder ?? null;
        if (sight === false) continue;
        if (sight === null) {
          unverified.push(
            `nobody has said whether ${holder} can see the creature rolling, and ${effect.name} needs that; the benefit was applied rather than withheld`,
          );
        }
      }

      push(effect.name, effect.grant.modifier.mode);
    }
  }

  // And the durable half: what a running spell has hung on a creature.
  for (const granted of grantedRollModes(state, query)) {
    push(granted.source, granted.mode);
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
 * **Three inputs, not two.** The stat block's entries, the ones its features
 * grant while some requirement holds, and the ones a *running effect* has hung
 * on it — Stoneskin's Resistance, Protection from Energy's. The third arrived
 * last and is the one with a lifetime: it is keyed by source so `releaseCasting`
 * and a `grants` deadline can take it away again, where the other two are
 * derived afresh on every read.
 *
 * **The answers union rather than overriding**, and the SRD is why: "multiple
 * instances of Resistance to the same damage type count as only one", so there
 * is no arithmetic for a second copy to do and no reading under which a grant
 * could *weaken* what is already there. A creature Immune to Fire that is then
 * granted Resistance to Fire still takes nothing, because `applyDefenses` reads
 * Immunity first and stops; a creature Vulnerable to Fire that is granted
 * Resistance takes the SRD's own worked order, halved and then doubled.
 */
export function defensesOf(
  state: GameState,
  who: CharacterId,
): Readonly<Record<string, DamageDefenses>> {
  const own = state.creatures[who]?.defenses ?? {};
  const standing = standingDefenses(state, who);
  const hung = state.creatures[who]?.grantedDefenses ?? [];
  if (Object.keys(standing).length === 0 && hung.length === 0) return own;

  const merged: Record<string, DamageDefenses> = { ...own };
  const add = (type: string, defence: DefenseKind): void => {
    merged[type] = { ...merged[type], [defence]: true };
  };
  for (const [type, defence] of Object.entries(standing)) {
    if (defence.resistant === true) add(type, 'resistant');
    if (defence.immune === true) add(type, 'immune');
    if (defence.vulnerable === true) add(type, 'vulnerable');
  }
  // Unsorted on purpose: a union of booleans commutes, so the order the grants
  // arrived in cannot change the answer, and `damage-defense-granted` sorts
  // them by source on the way in anyway — this is a derived read that reaches
  // no log.
  for (const granted of hung) {
    for (const type of granted.damageTypes) add(type, granted.defense);
  }
  return merged;
}

/**
 * Conditions this creature cannot be given at all.
 *
 * **The one gatherer**, in {@link defensesOf}'s shape and beside it, because
 * it answers the other half of the run a stat block prints in one line: a
 * Zombie's "Immunities Poison; Exhaustion, Poisoned" is one damage type and
 * two conditions. The damage half has had a reader since defences reached
 * state; this half had none, so `adaptMonster` produced the list and nothing
 * whatever consulted it.
 *
 * **Two inputs**, in {@link defensesOf}'s shape: the creature's own printed
 * entries, and the ones a *running effect* has hung on it. The gatherer was
 * written with one and said in those words that the second was the next thing
 * to arrive and would join here rather than at the caller — reading
 * `creature.conditionImmunities` at `applyConditionTo` would be the second
 * place the question is answered, which is what this repository keeps recording
 * going wrong. It arrived, and nothing at the caller changed.
 *
 * **The answers union; a grant may never weaken what is printed.** An Immunity
 * is a boolean, so there is no arithmetic a second copy could do and no reading
 * under which a grant could take one away: a Zombie granted Mind Blank's
 * Charmed Immunity is immune to Charmed once, and is still immune to Poisoned
 * and Exhaustion when the casting ends. The damage half says the same sentence
 * — "multiple instances of Resistance to the same damage type count as only
 * one" — and `new Set` below is the whole of the rule.
 *
 * The printed half has no source and never ends; the granted half is keyed by
 * one, so `releaseCasting`, `releaseOnTarget` and a `grants` deadline take it
 * away through the door the other six sourced grants already use.
 *
 * **Suppression is deliberately not folded in.** SRD Aura of Courage says a
 * Frightened ally's condition "has no effect on that ally while there" — the
 * condition is still on them and comes back the moment they leave, which is
 * what {@link suppressedConditions} and {@link effectiveConditions} are for.
 * An immunity refuses the condition outright; a suppression lets it land and
 * does nothing with it, and merging the two would get both wrong.
 *
 * **An *implied* condition is not checked against this, and that is a residue
 * rather than a decision.** `applyCondition` expands SRD's implication table —
 * Unconscious carries Incapacitated and Prone — and it does so in the fold,
 * after the command has asked this about the condition the caller **named**.
 * So a creature immune to Prone and Incapacitated but not to Unconscious
 * acquires both the moment something makes it Unconscious. The witness is
 * real: SRD's Swarm of Crawling Claws prints "Charmed, Exhaustion, Frightened,
 * Grappled, Incapacitated, Paralyzed, Petrified, Poisoned, Prone, Restrained,
 * Stunned" and not Unconscious, and `monster-command.test.ts` pins that fact —
 * the stat block's list and the implication edge it meets — so this sentence
 * cannot quietly stop being about a real case.
 *
 * It is written down rather than fixed because **the SRD does not settle it**:
 * the book says Unconscious "includes" the other two and says nothing about
 * what an immunity to one of them does to that sentence, so filtering the
 * implications would be the engine answering a question the rules declined to
 * ask — and so would leaving a test that froze today's answer. The same shape
 * as `TurnBudget.movementGained`'s open reading. What narrows it in practice
 * is that a monster `diesAtZero`, so the hit-point route to Unconscious is
 * mostly closed; what is reachable is `applyConditionTo` and a `condition`
 * effect naming Unconscious directly. A ruling, from the errata or from the
 * table, is what would end this.
 *
 * Sorted and deduplicated, so the answer cannot depend on the order the inputs
 * were read in.
 */
export function conditionImmunitiesOf(
  state: GameState,
  who: CharacterId,
): readonly ConditionName[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];
  const names = new Set<ConditionName>(creature.conditionImmunities);
  for (const granted of creature.grantedConditionImmunities) {
    for (const condition of granted.conditions) names.add(condition);
  }
  return [...names].sort();
}

/**
 * The senses this creature has right now, and how far each one reaches.
 *
 * Gathered through `standingFor`, so everything that grants a benefit grants
 * a sense by the same route and under the same clauses: a species trait, a
 * magic item that is worn or attuned to, and — should anything ever print one
 * — an aura. A sense whose requirement is not met is not had at all, which is
 * the whole reason this is derived on every read rather than stored.
 *
 * **One entry per sense, at the longest range granted.** The SRD writes the
 * Drow's as an increase — "The range of your Darkvision increases to 120
 * feet" — and Goggles of Night the same way, so two sources of one sense are
 * one sense, and the answer cannot depend on which was read first. Sorted by
 * name, for the reason `conditionImmunitiesOf` is.
 */
export function sensesOf(state: GameState, who: CharacterId): readonly CreatureSense[] {
  const furthest = new Map<SenseName, number>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'sense') continue;
    const had = furthest.get(effect.grant.sense);
    if (had === undefined || effect.grant.feet > had) {
      furthest.set(effect.grant.sense, effect.grant.feet);
    }
  }
  return [...furthest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sense, feet]) => ({ sense, feet }));
}

/**
 * Whether one creature can see another, with the looker's own senses read in.
 *
 * The `GameState` half of {@link sightBetween}, and the seam every rule that
 * asks about sight should come through: a sense lives on a creature and the
 * declaration lives in the scene, so only a caller holding both can put the
 * two together. Three-valued like the pairwise question it wraps — null is
 * "ask", not "no" — and null again outside a scene, where there is no
 * distance for a range to be measured against.
 *
 * Exported for the reason `speedOf` and `armorClassOf` are: a caller reading
 * the declaration alone gets half the answer, and the half it is missing is
 * the whole of what a species trait grants.
 *
 * **No command routes through this yet.** Every caller of `sightBetween`
 * today — targeting, movement, teleport, the Opportunity Attack window —
 * holds a `PositionState` and asks the pairwise question, and re-pointing
 * them at a creature's senses is a task of its own with its own refusals to
 * think about. What is here is the seam and the reader, said plainly rather
 * than a claim that every rule already consults a sense.
 */
export function canSee(state: GameState, from: CharacterId, to: CharacterId): boolean | null {
  if (state.scene === null) return null;
  return sightBetween(state.scene, from, to, sensesOf(state, from));
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

  // The base calculation first, with any an ongoing effect supplied competing
  // in the same pass as the creature’s own features — SRD Multiclassing settles
  // that once for all of them, and `armorClassCalculation` is where it is
  // settled. Only then the flat bonuses, which genuinely do add.
  let total = armorClass(creature.sheet, creature.armorClasses);
  for (const active of creature.bonuses) {
    if (!active.applies.includes('ac')) continue;
    const flat = active.bonus.flat ?? 0;
    total += active.direction === 'subtract' ? -flat : flat;
  }
  // And the other lifetime: what a worn item is granting right now. Derived
  // rather than stored, so taking the ring off takes the +1 with it without
  // anything having to remember to. No item is used to *gain* an Armour Class,
  // so there is nothing for a narrowing to match and none may be declared.
  for (const bonus of standingBonuses(state, who, 'ac')) total += bonus.flat ?? 0;
  return total;
}

/**
 * What an effect does to a Speed.
 *
 * Three members, one per operation the SRD writes, and the order they compose
 * in is {@link combineSpeed}'s rather than this union's:
 *
 * > Longstrider: "The target's Speed **increases by 10 feet**."
 * > Ray of Frost: "its Speed is **reduced by 10 feet**."
 * > Slow: "An affected target's Speed is **halved**."
 * > Hypnotic Pattern: "the creature has ... **a Speed of 0**."
 *
 * **A doubling is not here**, and that is a decision rather than an oversight.
 * SRD Haste prints "the target's Speed is doubled" and is the only sentence in
 * the book that does; carrying it would mean a fifth step in `combineSpeed`
 * whose order against the halving the SRD does not print, so it is a named
 * missing shape — `a-speed-an-effect-multiplies` — that arrives with a rule
 * settling that order, exactly as `TypedSaveOutcome`'s automatic success waits
 * for the spell that can write it.
 *
 * Increase and decrease are **one** member with a sign rather than two,
 * because they are one operation: the argument `interveneAfterRoll`'s
 * `direction` already settled for adding and subtracting a die.
 */
export type SpeedChange =
  /** A signed number of feet: Longstrider's +10, Ray of Frost's −10. */
  | 'add'
  /** SRD Slow. Presence and not count, so two halvings are one halving. */
  | 'halve'
  /** SRD Hypnotic Pattern. Last, and it beats every addition. */
  | 'zero';

/**
 * A Speed an ongoing effect has changed.
 *
 * The fifth member of the family `bonuses`, `armorClasses`, `rollModifiers`
 * and `grantedDefenses` already form, and it needed no lifecycle of its own:
 * the casting is in the `source`, so `releaseCasting`, `releaseOnTarget` and a
 * `grants` deadline all end it through the door the other four already use.
 *
 * **It lives here rather than beside the definition format**, with every other
 * grant type: `ActiveBonus` is in `bonuses.ts`, `GrantedArmorClass` in
 * `character.ts`, `ActiveRollModifier` in `roll-modifiers.ts` and
 * `GrantedDefense` in `attack.ts` — each beside the function that reads it.
 * {@link speedOf} is the reader, and {@link combineSpeed} is the order.
 *
 * **`feet` is signed and belongs to `add` alone.** SRD Longstrider increases a
 * Speed by 10 and Ray of Frost reduces one by 10, which is one operation with
 * two signs; `halve` and `zero` name a whole operation and have no number to
 * carry. `checkSpellDefinition` refuses the mismatch at authoring, which is
 * why this stays one flat record rather than a union the reducer would have to
 * narrow on every fold.
 */
export interface GrantedSpeed {
  /** The casting (`Longstrider#cast:3`) or the feature that granted it. */
  readonly source: string;
  readonly change: SpeedChange;
  /** Signed feet, for an `add`; absent for the other two. */
  readonly feet?: number;
}

/**
 * Extra damage an ongoing effect adds to the holder's **later** attacks.
 *
 * The sixth member of the family `bonuses`, `armorClasses`, `rollModifiers`,
 * `grantedDefenses` and `speedModifiers` already form, and like the fifth it
 * needed no lifecycle of its own: the casting is in the `source`, so
 * `releaseCasting`, `releaseOnTarget` and a `grants` deadline all end it
 * through the door the other five already use.
 *
 * **It is held by whoever *deals* the damage, never by whoever takes it.**
 * SRD Hunter's Mark marks a quarry ninety feet away and then says "**you**
 * deal an extra 1d6 Force damage to the target" — the ranger is the one the
 * rider is on, and {@link target} is the creature it is *about*. Storing it on
 * the quarry would have been the tempting reading and would give a second
 * ranger's arrow the first ranger's die.
 *
 * **Two fields, because the SRD writes two different clauses**, and the
 * difference is the one thing about this shape that is easy to get wrong:
 *
 * | | SRD | Fields |
 * |---|---|---|
 * | Divine Favor | "**your attacks with weapons** deal an extra 1d4 Radiant damage on a hit" | `weaponOnly`, no `target` |
 * | Hunter's Mark | "you deal an extra 1d6 Force damage **to the target** whenever you hit it **with an attack roll**" | `target`, no `weaponOnly` |
 *
 * So Divine Favor reaches every weapon in the ranger's hands and no Fire Bolt,
 * and Hunter's Mark reaches a Fire Bolt aimed at the quarry and nothing aimed
 * at anybody else. Sharing one predicate would have made one of the two
 * spells wrong, silently, in the direction nothing measures.
 *
 * **The damage type is required.** Every SRD sentence of this shape names one
 * — Radiant, Force, Necrotic — and the absent-means-the-weapon's-own-type
 * reading `standingAttackDamage` takes for a *feature* has no spell consumer,
 * so a field that could be left out would be shape built ahead of the mechanic
 * that wants it.
 */
export interface GrantedAttackRider {
  /** The casting (`Divine Favor#cast:3`) that granted it. */
  readonly source: string;
  /** The extra dice, e.g. `1d4`. A notation rather than a `DiceScaling`: no
   * SRD sentence of this shape grows its dice with the slot or the level. */
  readonly dice: string;
  /** The damage type the sentence names. Never the weapon's own. */
  readonly damageType: string;
  /** SRD Divine Favor's "attacks **with weapons**". Absent reaches any attack. */
  readonly weaponOnly?: true;
  /** SRD Hunter's Mark's "**to the target**". Absent reaches any target. */
  readonly target?: CharacterId;
}

/**
 * The riders on this creature's attacks that have something to say about
 * *this* attack.
 *
 * **One gatherer, three paths.** A weapon attack and the second half of a held
 * one both arrive through {@link standingAttackDamage}, which folds this in;
 * a *spell* attack calls it directly, because SRD Hunter's Mark says "whenever
 * you hit it with an attack roll" and a Fire Bolt is one. What the spell path
 * must **not** take is the feature half beside it — Sneak Attack and Rage
 * Damage are weapon rules — which is why this is its own function rather than
 * `standingAttackDamage` pointed at a third caller.
 *
 * That is the `defendingModes` lesson applied on the offensive side: emptying
 * this function fails a weapon-attack test, a held-attack test *and* a
 * spell-attack test, which is the evidence it is one gatherer and not three
 * spelled alike.
 *
 * Returned in the shape `rollAttackDamage` takes its `extraDamage` in, so the
 * die is a **component of its own** with its own type and source: it meets the
 * target's defences separately, and a Critical Hit doubles it.
 */
export function grantedAttackRiders(
  creature: CreatureState | undefined,
  context: { readonly weapon: Weapon | null; readonly target: CharacterId },
): readonly { readonly source: string; readonly type: string; readonly dice: string }[] {
  if (creature === undefined) return [];
  return creature.attackRiders
    .filter((rider) => {
      if (rider.weaponOnly === true && context.weapon === null) return false;
      if (rider.target !== undefined && rider.target !== context.target) return false;
      return true;
    })
    .map((rider) => ({
      // `spellOfSource` gives the readable half back, so the log says "Divine
      // Favor" rather than `Divine Favor#cast:3`. The casting id stays in the
      // grant, which is what ends it.
      source: spellOfSource(rider.source),
      type: rider.damageType,
      dice: rider.dice,
    }));
}

/**
 * Compose a Speed out of its parts, in the order the architect fixed.
 *
 * **The SRD prints no order**, and the order is observable, so it is decided
 * once here rather than by whichever caller happens to be looking:
 *
 * > base, plus the flat changes, then **halved once** if any halving effect
 * > applies, then **0** if any zeroing effect applies, never below 0.
 *
 * Halving is presence and not count — the reading Resistance and Advantage
 * already take, so two halvings are one halving. Zero is last and **wins**,
 * because SRD Grappled and Restrained both print "Your Speed is 0 **and can't
 * increase**": a flat bonus applied afterwards would hand a pinned creature
 * ten feet the rules had already taken away.
 *
 * `conditionSpeed` is folded in whole rather than reimplemented, and it
 * carries two of the three steps at once — Exhaustion's "reduced by a number
 * of feet equal to 5 times your Exhaustion level" is a flat change, and the
 * five pinning conditions are the zero. That puts its zero *before* the
 * halving rather than after, and the two orders are the same function:
 * halving 0 is 0, and no flat change follows either. So the arithmetic is
 * identical for every input and there is one implementation of the condition
 * rules rather than two.
 *
 * @param halvings how many halving effects apply; any number above zero halves
 *   once. IE-033's `speed` grant is the producer: SRD Slow's "An affected
 *   target's Speed is halved" is the sentence, and no *registered* definition
 *   writes it yet — Slow is blocked on two other shapes — so the branch is
 *   still reached the way `restoreOn`'s Short Rest branch is, by handing this
 *   pure function the case, as well as through a hand-written grant.
 * @param zeroed whether any zeroing effect applies. **Last, and it wins**, for
 *   the reason above: a flat change applied afterwards would hand a pinned
 *   creature feet the rules had already taken away. It is a boolean rather
 *   than a count because presence is all the SRD asks — two castings of
 *   Hypnotic Pattern on one goblin are one Speed of 0.
 */
export function combineSpeed(
  base: number,
  flat: number,
  halvings: number,
  zeroed: boolean,
  conditions: ConditionState,
): number {
  const flattened = conditionSpeed(conditions, base + flat);
  const halved = halvings > 0 ? Math.floor(flattened / 2) : flattened;
  return zeroed ? 0 : Math.max(0, halved);
}

/**
 * A creature's Speed, with whatever is currently moving it.
 *
 * **The one reader.** `spendMovement`'s cap, a Dash's increase, a mounting cost
 * and a readied move's allowance were three different spellings of this
 * question — one of them reaching for `sheet.baseSpeed`, one for the pinned
 * `combatant.speed`, all three passing whichever they found to
 * `conditionSpeed` — and **none of them could see a class feature**, which is
 * why a Barbarian's Fast Movement said in its own note that "Speed comes from
 * the species and nothing modifies it". It is `armorClassOf`'s shape exactly:
 * a derived number the rules are measured against, gathered in one place.
 *
 * **The base is the pinned `combatant.speed` while a fight is running**, and
 * `sheet.baseSpeed` outside one — two bases for one reader, which is harmless
 * today because `startCombat` is given the sheet's own number and is written
 * down rather than left to be discovered. `Combatant.speed` reaching
 * `combat-started` is what makes it the base inside a fight: it is in both
 * frozen logs, so a replay measures against the Speed that fight began with.
 *
 * **Feature grants are derived on every read**, like every other standing
 * effect: whether a Monk is unarmoured changes the moment they put a Shield
 * down, and a stored copy would be an unconditional bonus wearing a feature's
 * name. They are gathered from the creature's **own** sheet rather than
 * through `standingFor`, and that is a rule rather than an optimisation: no
 * SRD feature grants Speed to anybody else, and `standingFor` evaluates every
 * effect's requirements — including Dodge's `has-speed`, which asks this
 * function. Reading only `speed` grants is what keeps that from recursing.
 *
 * **A spell moves a Speed through here too, and through nowhere else.**
 * `CreatureState.speedModifiers` is the fifth sourced grant and it joins the
 * same three accumulators a feature's grant already fed, which is the whole
 * point of there being one reader: Longstrider's ten feet reach the movement
 * allowance, the Dash and the mounting cost together rather than three times
 * over, and Hypnotic Pattern's Speed of 0 arrives at the same comparison
 * Grappled already arrives at.
 *
 * **An item's grant is not read here, and that is a decision rather than an
 * omission.** `standingFor` gathers what a magic item grants; this function
 * deliberately reads the creature's own sheet alone, because it is the
 * function `has-speed` asks — so a Speed granted by an item would be a
 * question asked of its own answer the moment one carried both clauses. Until
 * somebody settles that, `checkContent` refuses a `speed` grant on an item by
 * name rather than accepting one nothing reads.
 *
 * **The two kinds of grant are gathered differently on purpose.** A feature's
 * is derived on every read, because whether a Monk is unarmoured changes the
 * moment they put a Shield down; a spell's is *stored*, because a casting
 * started at a moment somebody can write down and ends at another. So one is
 * filtered by `meetsRequirements` and the other is not — a stored grant whose
 * requirement was re-evaluated would be a second answer to when it ends.
 */
export function speedOf(state: GameState, who: CharacterId): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 0;

  const base = state.combat?.order.find((c) => c.id === who)?.speed ?? creature.sheet.baseSpeed;

  let flat = 0;
  for (const effect of creature.sheet.standing ?? []) {
    if (effect.grant.kind !== 'speed') continue;
    if (!meetsRequirements(state, who, effect)) continue;
    flat += effect.grant.feet;
  }

  let halvings = 0;
  let zeroed = false;
  for (const granted of creature.speedModifiers) {
    if (granted.change === 'add') flat += granted.feet ?? 0;
    else if (granted.change === 'halve') halvings += 1;
    else zeroed = true;
  }

  return combineSpeed(base, flat, halvings, zeroed, creature.conditions);
}

/**
 * What is left of a creature's movement this turn, or null outside combat.
 *
 * The `GameState` half of {@link movementLeft}: it looks the allowance up
 * through `speedOf` and hands it to the one function that does the
 * subtraction, so a caller reading a budget never has to know the formula.
 * Null rather than zero when there is no turn to have a budget in — "no
 * allowance" and "none left" are different answers, and the distinction is the
 * one `attacksRemaining` already draws.
 */
export function movementLeftFor(state: GameState, who: CharacterId): number | null {
  const budget = state.combat?.budgets[who];
  if (budget === undefined) return null;
  return movementLeft(budget, speedOf(state, who));
}

/** What an attack was, for deciding which features have anything to say about it. */
export interface AttackContext {
  /** The ability the attack roll actually used. */
  readonly ability: Ability;
  readonly melee: boolean;
  /** Null for an Unarmed Strike, which is not a weapon. */
  readonly weapon: Weapon | null;
  /**
   * The catalogue id of what the attack was made *with*, for the one clause
   * that asks — {@link BonusContext.withItem}, on the damage side.
   *
   * Not `weapon.id`, and the distinction is load-bearing: a magic weapon's
   * `weapon` record is the *mundane row* it is a magical version of, so a
   * Vicious Weapon's record is filed under `longsword` and reading the id off
   * it would hand the die to every longsword in the world. What narrows is the
   * item, and only the command knows which item was swung.
   *
   * Absent reads as a roll made with nothing, exactly as it does for a flat
   * bonus: a caller who does not say withholds the benefit rather than
   * inventing one.
   */
  readonly withItem?: string | null;
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
 *
 * `context.withItem` narrows, exactly as it does in {@link standingBonuses}:
 * an effect that says "this magic weapon" is withheld from every attack made
 * with anything else, including the attacks no object is made with at all.
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
    // "This magic weapon deals an extra 2d6 damage", and no other weapon does.
    if (grant.onlyWithItem === true && (context.withItem ?? null) !== effect.feature) continue;
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

  // **The spell riders, folded in here rather than at the two call sites.**
  // `resolveAttack` and `resolveAttackDamage` both already ask this function
  // what rides a hit, so a rider reaches a swung weapon and a held one with no
  // new call site to forget — which is exactly the fork `defendingModes`
  // closed on the defensive side. The spell-attack path calls
  // {@link grantedAttackRiders} on its own, because it must not take the
  // feature half above.
  extra.push(
    ...grantedAttackRiders(state.creatures[who], {
      weapon: context.weapon,
      target: context.target,
    }),
  );

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
