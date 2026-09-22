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
import type { Bonus, ModeSource, StandingBonusApplies } from './bonuses.js';
import type { TurnAnchor } from './time.js';
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
  deniedBenefitsOf,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import {
  abilityModifier,
  armorClass,
  hasSpeedInMode,
  speedInMode,
  type CharacterSheet,
  type MovementMode,
} from './character.js';
import {
  canBeTargeted,
  coverBetween,
  distanceBetween,
  lightAt,
  obscurementAt,
  piercesObscurement,
  positionOf,
  sensesReaching,
  sightBetween,
  SIGHT_SENSES,
  type CreatureSense,
  type SenseName,
} from './positioning.js';
import type { CreatureState, GameState } from './events.js';
import { creaturesStandingInCastingArea, spellOfSource, type CastingTime } from './spells.js';
import type { SpellArea, SpellEffect } from './spell-definitions.js';
import type { EffectEndCause } from './timers.js';
import type { Recovery } from './resources.js';
import type { TradedAmount } from './progression.js';
import {
  weaponInSet,
  weaponNarrowingHolds,
  type DamageDefenses,
  type DefenseKind,
  type WeaponNarrowing,
  type WeaponSelector,
  type WieldingContext,
} from './attack.js';
import { treatLowRollsAs, type DieEffect } from './dice.js';
import type { Weapon } from '@ie/srd';
import {
  actionRuleKey,
  canUseFeatureThisTurn,
  movementLeft,
  type ActionRule,
  type GrantedActionRule,
} from './combat.js';

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

/**
 * What a casting's persistent area does to whoever is standing in it, for as
 * long as they stand in it.
 *
 * SRD Spirit Guardians: "Any other creature's Speed is **halved in the
 * Emanation**." The same argument this file opens with, arriving at a casting
 * instead of a class feature: which creatures that sentence reaches is a fact
 * about where two creatures are standing, it changes every time either of them
 * moves, and nothing happens that a log could record. So it is **derived on
 * every read** from the scene and the record, and nothing is stored on the
 * creature it reaches. A stored halving would be a pair of events that had to
 * stay matched — granted on the way in, released on the way out — and the
 * first route that moved a creature without remembering would leave a goblin
 * walking at half Speed a hundred feet from the cleric.
 *
 * **Not {@link StandingReach}'s `aura`, and the three differences are each a
 * rule.** That reach is a *feature's*, held on a creature's own sheet or a
 * worn item, radiating from the holder to "you and your allies"; this is a
 * *casting's*, measured over the area the casting pinned — which may be a
 * Sphere centred on a point nobody is standing on — and it reaches whoever the
 * geometry catches, ally or not, minus the list the caster designated at the
 * cast. Nothing in the SRD writes both halves of one sentence, so they are two
 * vocabularies rather than one with a flag.
 *
 * **Not {@link HungGrant} or a `speed` effect either**: both of those are
 * stored against a source and released when it ends, which is right for
 * Longstrider — touched at a moment, ended at a moment — and wrong for a
 * volume a creature can walk out of.
 *
 * One member, because the SRD writes one sentence of this shape that the
 * engine can execute. A second sentence adds a member; it does not add a
 * second way of saying this one.
 */
export type AreaStanding = {
  /**
   * SRD Spirit Guardians' "Speed is halved in the Emanation", read through the
   * one composer — {@link combineSpeed} — so the halving meets Exhaustion's
   * flat reduction and a Grappled creature's zero in the order the architect
   * fixed, rather than in a second arithmetic of its own.
   *
   * `change` is every operation that *moves* a Speed, so a Speed a casting's
   * area moves is spelled the way every other Speed a spell moves already is.
   * `feet` is required by `add` and refused by the other two, exactly as the
   * `speed` effect's is — and `match-walk`, which gives a Speed in a mode
   * rather than moving one, is refused outright: an area has no mode to give
   * one in. See the field below for why that is a narrowing and not a
   * borrowing.
   */
  readonly kind: 'speed';
  /**
   * The three operations that move a Speed the creature already has.
   *
   * **Narrowed rather than {@link SpeedChange} whole**, which is the field
   * that taught the lesson: widening that union for "a Climb Speed equal to
   * its Speed" widened this one silently, and `speedOf`'s area loop read the
   * new member as a Speed of 0. An area has no mode to give a Speed in — it
   * says "Speed is halved in the Emanation" and nothing else — so the type
   * says so, `checkSpeedChange` says so at the door for untyped input, and
   * the loop names every member it handles.
   */
  readonly change: Exclude<SpeedChange, 'match-walk'>;
  /** Signed feet, required by `add` and refused by the other two. */
  readonly feet?: number;
};

/**
 * Which castings a `casting-damage` grant reaches.
 *
 * Every field is a **narrowing** and an absent one asks nothing, which is the
 * reading `RollSelector` already takes: a feature that names no school reaches
 * every school. The five SRD sentences between them write all five fields, and
 * no one feature writes more than three.
 *
 * | SRD | What it narrows |
 * |---|---|
 * | Foe Slayer, "the damage die of your _Hunter's Mark_" | {@link spell} |
 * | Empowered Evocation, "a Wizard spell from the Evocation school" | {@link classId}, {@link school} |
 * | Elemental Affinity, "a spell that deals damage of that type" | {@link damageTypes} |
 * | Potent Cantrip, "a cantrip" | {@link slotLevels} |
 * | Overchannel, "a Wizard spell with a spell slot of levels 1–5" | {@link classId}, {@link slotLevels} |
 */
export interface CastingDamageWhen {
  /** One spell, by catalogue id. The engine compares it and never names one. */
  readonly spell?: string;
  /** The school the definition declares — a property of the spell, not a branch. */
  readonly school?: string;
  /**
   * The class the casting was **routed through**.
   *
   * SRD says "a **Wizard** spell", which is not "a spell on the Wizard list": a
   * Sorcerer/Wizard who prepared Fireball through the Sorcerer half casts it as
   * a Sorcerer, and Empowered Evocation says nothing about that casting. Read
   * off `CastingRoute.classId`, so a feat's grant and an item's casting match
   * no feature that names one.
   */
  readonly classId?: string;
  /**
   * The damage types the casting deals; any one of them is enough.
   *
   * Filled from the feature's own choice where the grant says
   * `damageTypesFromChoice` — the same column Elemental Affinity's Resistance
   * already reads, because the SRD writes both halves off one choice and a
   * second question would be the player answering twice.
   */
  readonly damageTypes?: readonly string[];
  /**
   * The band of slot levels, inclusive, the casting was made at.
   *
   * The **slot's** level and not the spell's, which is what Overchannel says —
   * "a spell slot of levels 1–5" — and what makes a cantrip `0` to `0` rather
   * than a fourth kind of question.
   */
  readonly slotLevels?: { readonly from: number; readonly to: number };
  /**
   * SRD Overchannel: "a Wizard spell with a spell slot of levels 1–5 **that
   * deals damage**."
   *
   * That the casting deals damage of *some* kind, where {@link damageTypes}
   * asks which. One writer, and it is here because the feature charges for
   * itself: without it a Wizard casting Detect Magic with Overchannel elected
   * would count a use and pay 6d12 for having maximised nothing.
   */
  readonly dealsDamage?: true;
}

/**
 * What a feature does to the damage a casting was going to deal.
 *
 * **Four arms of one field rather than four grants.** All four are asked for at
 * one moment, by one reader, and each is a single arithmetic operation on a
 * notation already in hand; four grant kinds would be four copies of
 * {@link CastingDamageWhen} and four call sites for one question, and the
 * repeated `when` is precisely what makes this a shape rather than five special
 * cases.
 *
 * Only `ability-modifier` has two SRD writers. That is said rather than hidden:
 * the other three are each one feature's own sentence, exactly as
 * `attack-damage.advantageOrAdjacentAlly` is, and not one of them brings any
 * machinery of its own.
 */
export type CastingDamageAlteration =
  /**
   * SRD Elemental Affinity: "you can add your Charisma modifier to **one damage
   * roll** of that spell." SRD Empowered Evocation says the same of
   * Intelligence. Two classes, one sentence, which is what makes it a shape.
   *
   * The modifier is read off the caster's sheet at the casting, so a Headband
   * of Intellect moves it exactly as it moves the save DC.
   */
  | { readonly kind: 'ability-modifier'; readonly ability: Ability }
  /**
   * SRD Foe Slayer: "The damage die of your _Hunter's Mark_ is a d10 rather
   * than a d6."
   *
   * A substitution over the notation rather than a number: `3d6` becomes `3d10`
   * and a notation rolling any other die is left alone. It reaches a **pinned**
   * notation too — the die an `attack-rider` writes into its own event — which
   * is what lets a replay roll a d10 without knowing the feature exists.
   */
  | { readonly kind: 'die'; readonly from: number; readonly to: number }
  /**
   * SRD Potent Cantrip: "When you cast a cantrip at a creature and you miss
   * with the attack roll or the target succeeds on a saving throw against the
   * cantrip, the target takes half the cantrip's damage (if any) but suffers no
   * additional effect from the cantrip."
   *
   * A floor where the definition offers none: an `attack` that prints no
   * `onMiss` reads as `half`, and a `save-damage` whose `onSuccess` is `none`
   * reads as `half`. "No additional effect" is what both of those branches
   * already do — neither hangs a rider — so nothing here says it twice.
   */
  | { readonly kind: 'half-when-avoided' }
  /**
   * SRD Overchannel: "you can deal maximum damage with that spell on the turn
   * you cast it."
   *
   * **Nothing is thrown.** Every die takes its highest face, so the component
   * comes back with no roll at all and the generator has not moved — the honest
   * reading of "maximum damage", and the one a replay reproduces for free. A
   * Critical Hit is applied first, because the SRD doubles the dice and this
   * maximises whatever dice the attack ends up rolling.
   */
  | { readonly kind: 'maximum' };

/**
 * What using one of these features costs its holder — the one SRD feature of
 * this shape that prints a price.
 *
 * SRD Overchannel: "The first time you do so, you suffer no adverse effect. If
 * you use this feature again before you finish a Long Rest, you take 2d12
 * Necrotic damage for each level of the spell slot immediately after you cast
 * it. This damage ignores Resistance and Immunity. Each time you use this
 * feature again before finishing a Long Rest, the Necrotic damage per spell
 * level increases by 1d12."
 *
 * **A count, not a pool**, and `Tally` in `resources.ts` is exactly the tool: a
 * pool of one would refuse the second use, where the book has the second use
 * happen and charges for it. Nothing declares a tally, so the key and the
 * recovery ride the use, which is why both are fields here.
 *
 * One writer, stated rather than dressed up as a general mechanism. It is a
 * field on the grant the maximisation lives on because the SRD's sentence makes
 * the two one feature, and the price is meaningless without it.
 */
export interface CastingDamageCost {
  /** SRD: "The first time you do so, you suffer no adverse effect." */
  readonly freeUses: number;
  /** SRD: "2d12 Necrotic damage **for each level of the spell slot**". */
  readonly dicePerSlotLevel: string;
  /** SRD: "the Necrotic damage per spell level **increases by 1d12**". */
  readonly increasesBy: string;
  readonly damageType: string;
  /** SRD: "This damage ignores Resistance and Immunity." */
  readonly ignoresDefenses?: true;
  /** What the uses are counted under — a tally's key, as a pool's is. */
  readonly key: string;
  /** SRD: "before you finish a **Long Rest**", which zeroes the count. */
  readonly recovers: Recovery;
}

/**
 * What a feature says about the **dice an attack throws**, as a declaration.
 *
 * SRD Great Weapon Fighting: "you can treat any 1 or 2 on a damage die as a
 * 3." The arithmetic has lived in the dice layer since it was written — every
 * die is individually addressable, and a substitution is a `DieEffect` — and
 * what was missing was a way for a *declaration* to ask for one. This is that
 * way, and the reader turns it into the effect the roller already takes.
 *
 * One arm, named for its writer, which is the rule every closed vocabulary in
 * this file follows. The dice layer has two other effects and neither has a
 * declaring feature yet: an explosion belongs to a spell rather than to a
 * swing and is asked for on the spell's own definition, and a reroll the
 * roller *chooses* needs a caller who is asked which dice, which nothing in
 * the command layer does. An arm arrives with the sentence that writes it.
 *
 * Declared here rather than inside {@link StandingGrant} so that the member
 * carrying it stays one kind: the union is read out of this file as data by
 * `content.test.ts`, and a nested `kind` would be counted as a grant nobody
 * grants.
 */
export type AttackDieRule = {
  /** SRD Great Weapon Fighting's substitution, and `treatLowRollsAs`'s shape. */
  readonly kind: 'treat-low-rolls-as';
  /** SRD's "any 1 or 2": the highest face the rule reaches. */
  readonly atMost: number;
  /** SRD's "as a 3": what such a face counts as instead. */
  readonly as: number;
};

/** What a standing benefit does. */
/**
 * What a `sees-through` grant lets its holder see through.
 *
 * One member, declared as a list so the type is read off it rather than
 * spelled twice: SRD prints one such sentence, Devil's Sight's, and a second
 * member would be somebody's invention until a printed line asks for it.
 */
export const SEES_THROUGH = ['darkness'] as const;

export type SeesThrough = (typeof SEES_THROUGH)[number];

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
   * SRD Divine Order (Thaumaturge) and SRD Primal Order (Magician): "you have
   * a bonus to the Intelligence (Arcana) and Intelligence (Religion) checks
   * you make. The bonus equals your Wisdom modifier (minimum of +1)."
   *
   * `save-bonus` above is the same derivation aimed at the other family, and
   * this is a member beside it rather than a field on it because a Paladin's
   * aura and a Cleric's study are two sentences that have never been written
   * as one: widening that member would rename a grant two catalogue files
   * already write, and `flat-bonus` below is "Flat, and only flat".
   *
   * **Narrowed by skill, and by nothing else.** Both writers name two skills;
   * neither says anything about the ability the check is made with, and
   * `SKILL_ABILITY` already answers that question for anybody who asks it. A
   * bonus to *every* ability check is `flat-bonus`'s shape, which is what the
   * SRD prints on a Stone of Good Luck — as a number rather than a modifier.
   */
  | {
      readonly kind: 'check-bonus';
      readonly fromAbility: Ability;
      /** SRD's "(minimum of +1)", read as a floor under the modifier. */
      readonly minimum: number;
      /** The skills the feature's own sentence names. Never empty. */
      readonly skills: readonly Skill[];
    }
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
      /**
       * SRD Archery: "attack rolls you make with **Ranged weapons**".
       *
       * The narrowing above's sibling and a different sentence — one names an
       * object, this names a kind of weapon. See {@link WeaponNarrowing}, and
       * `checkContent` holds it to the same two families `onlyWithItem` is
       * held to: a roll is *made with* a weapon, and an Armour Class is not.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
    }
  /**
   * A rule about the **dice** a weapon swing throws, rather than a number
   * added to it.
   *
   * SRD Great Weapon Fighting: "When you roll damage for an attack you make
   * with a Melee weapon that you are holding with two hands, you can treat any
   * 1 or 2 on a damage die as a 3. The weapon must have the Two-Handed or
   * Versatile property to gain this benefit."
   *
   * `flat-bonus` above is every sentence that adds a number and `attack-damage`
   * is every one that adds a die; this is the third thing a feature can say
   * about a hit, and neither of the other two could say it — the benefit
   * changes what a die *counts as* rather than what stands beside it.
   *
   * **Its scope is the attack, not a component.** The SRD's clause is about
   * "an attack you make", so the rule reaches every damage die the swing
   * throws, which is `AttackOptions.damageEffects` and is what `attack.test.ts`
   * has pinned since the field existed. A rule about one *spell's* dice is the
   * other scope and travels on that component — the two are different
   * sentences and both are printed.
   */
  | {
      readonly kind: 'attack-die-rule';
      readonly rule: AttackDieRule;
      /**
       * The sentence's own narrowing, read off the weapon the swing resolved.
       *
       * Absent covers every attack its holder makes, which no SRD feature
       * says and a homebrew one might.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
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
   * SRD Cunning Action, SRD Adrenaline Rush: a rule about the action economy
   * that a **feature** states about its own holder.
   *
   * The vocabulary is {@link ActionRule} in `combat.ts` and it is deliberately
   * the same one a casting hangs — "what this creature's action economy
   * permits *now*" is one fact, and a second mechanism for it would be a
   * second place for one sentence to be wrong. What differs is the lifetime,
   * which is the difference this whole file is about: a casting's rule is
   * stored on the creature and released when the casting ends, and a
   * feature's is **derived on every read** by {@link actionRulesOn}, because
   * whether a Rogue may Dash out of a Bonus Action is a fact about the sheet
   * they are holding rather than an event anybody could write down.
   *
   * Storing one at creation would have been the tempting reading and is wrong
   * twice over: it would put a permanent unconditional row into every Rogue's
   * state — the copy `StandingEffect` exists to refuse — and it would reach no
   * character already written into a log, because a fold replays the events a
   * log holds rather than re-compiling a sheet.
   */
  | {
      readonly kind: 'action-rule';
      readonly rule: ActionRule;
      /**
       * How a refusal finishes its sentence: "your Rage ends".
       *
       * Optional, unlike a casting's, and that is the derivation showing
       * through: a casting pins a deadline because the casting ends at a
       * moment, while a feature's rule holds exactly as long as the feature's
       * own clause does and is re-read rather than remembered. A feature that
       * has something to say about when it stops says it here.
       */
      readonly until?: string;
    }
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
   * engine reduces one yet — so {@link SpeedChange}'s `halve` and `zero` are
   * refused here, and the member carries the two that give a Speed.
   *
   * **And a fourth SRD feature, which is why it names a mode now.** SRD
   * Second-Story Work: "You gain a Climb Speed equal to your Speed." One
   * sentence, spelled exactly as SRD Spider Climb's is on a definition —
   * `change: 'match-walk'` and the mode — because it *is* that sentence, and
   * two spellings of one rule is two places for it to drift.
   */
  | {
      readonly kind: 'speed';
      /**
       * Absent is `add`, which is every feature written before modes existed
       * and is what keeps those three from having to be rewritten.
       */
      readonly change?: SpeedChange;
      /** Required by `add`, refused by `match-walk`. */
      readonly feet?: number;
      /** Absent is the walking Speed. */
      readonly mode?: MovementMode;
    }
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
  /**
   * Darkness this creature sees through, and how far.
   *
   * **Not a fifth sense**, and that is the whole reason it is its own grant:
   * the rules glossary defines four, `SENSE_NAMES` is closed on them, and
   * SRD Devil's Sight is not in the list — "You can see normally in Darkness,
   * both magical and nonmagical, to a distance of 120 feet" is an exception
   * to one rule about light rather than a way of perceiving. Adding it to
   * `SENSE_NAMES` would have handed it every sentence Blindsight answers,
   * starting with Invisible's "can somehow see you".
   *
   * `through` is a closed vocabulary of one because the SRD prints one. What
   * makes the member worth naming rather than assuming is that Darkvision
   * already sees through *nonmagical* darkness: what this adds is the magical
   * half, which is the only thing the sentence buys. See
   * {@link piercesObscurement}, which is where both are read.
   */
  | { readonly kind: 'sees-through'; readonly through: SeesThrough; readonly feet: number }
  /**
   * An ability score **set** to a number while whatever grants it holds.
   *
   * A third verb beside the two `ability-score-increase` has, and the SRD
   * prints it in one sentence per item: "Your Strength is 19 while you wear
   * these gauntlets", "Your Intelligence is 19 while you wear this
   * headband", "While wearing this belt, your Strength changes to a score
   * granted by the belt". Neither of the other two verbs says it. A raise of
   * +11 would be a different item on a different character, and a lifted
   * ceiling raises nothing at all. How many entries print it is
   * `COVERAGE.md`'s question.
   *
   * **A standing grant rather than creation's arithmetic**, and the second
   * half of the same sentence decides it: the score holds *while worn*, so
   * taking the gauntlets off has to take the Strength with them. That is the
   * lifetime this file already insists must be derived on every read, for the
   * reason `sense` is — "a stored copy would be Darkvision that survived
   * taking the goggles off".
   *
   * **The set never lowers a score.** Every printed sentence says so in its
   * second clause — "It has no effect on you if your Constitution is 19 or
   * higher without it", "unless your Strength is already equal to or greater
   * than that score" — and that is one rule rather than one per item, so
   * {@link abilityScoresOf} keeps it rather than each item.
   *
   * A feature may carry it too. No SRD class feature does, and the grant is
   * a member of the one vocabulary read by the one reader, so refusing it on
   * a feature would be refusing a homebrew sentence the engine executes
   * perfectly well.
   */
  | { readonly kind: 'ability-score-set'; readonly ability: Ability; readonly score: number }
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
    }
  /**
   * A feature of the **caster** that reaches into a casting's own arithmetic.
   *
   * Everything a spell deals is the definition's and is settled when the
   * casting is written; five SRD features say otherwise, and until this member
   * none of them had anywhere to say it. They are one shape because they share
   * a reader: something consulted once, at the casting, that asks *is this
   * casting one I reach* ({@link CastingDamageWhen}) and then *what do I do to
   * the damage it was going to deal* ({@link CastingDamageAlteration}).
   *
   * **A standing grant rather than a `FeatureGrant` of its own**, for the
   * reason `evasion` beside it is one: it is a property the holder has
   * continuously and is derived on every read, and the moment it bites is a
   * moment somebody else's command is in the middle of. It also lets Elemental
   * Affinity carry both halves of one SRD sentence — the Resistance and this —
   * as two effects of one grant, which a feature holding a single
   * `FeatureGrant` could not.
   *
   * **The alteration is pinned, never the feature.** A notation a feature
   * rewrote reaches the log rewritten, and nothing the fold reads has to know
   * the feature existed: `attack-rider-granted` carries the d10, and every
   * other alteration is spent before the dice and lands in the amounts the
   * damage events already record.
   *
   * It reaches the casting itself and no later moment of it. SRD Overchannel
   * says "on the turn you cast it", and what the other four alter is the damage
   * the casting deals rather than the debts it leaves behind — so an area
   * catching somebody a minute later, a delayed hit and a turn payout all roll
   * what the definition prints.
   */
  | {
      readonly kind: 'casting-damage';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingDamageWhen;
      /** What it does to what they deal. */
      readonly alters: CastingDamageAlteration;
      /**
       * SRD "**you can** add your Charisma modifier", "**you can** deal maximum
       * damage": the caster elects it, casting by casting.
       *
       * Three of the five say it and two do not — Potent Cantrip's cantrips
       * "affect even creatures that avoid the brunt of the effect" and Foe
       * Slayer's die simply *is* a d10 — so it is a field rather than a rule.
       * An elected feature is named on the request; one that is not elected
       * does nothing, which is how "you can" is declined.
       */
      readonly optional?: true;
      /** What electing it costs — see {@link CastingDamageCost}. */
      readonly costs?: CastingDamageCost;
    }
  /**
   * A feature of the caster that reaches into what a casting **restores**.
   *
   * The member above's argument on the other half of a casting's arithmetic,
   * and it is a second member rather than a fifth arm of that one because the
   * two are read at different moments by different resolvers: damage is asked
   * for once, before the dice, and folded into a notation; healing is asked
   * for per creature healed, after them, because the SRD's sentence is about
   * the creature rather than about the roll — "**that creature** regains
   * additional Hit Points".
   *
   * SRD Disciple of Life is the writer: "When a spell you cast with a spell
   * slot restores Hit Points to a creature, that creature regains additional
   * Hit Points ... equal to 2 plus the spell slot's level." Three more SRD
   * sentences want this same reader and each needs an arm this does not have
   * — Blessed Healer's echo back onto the caster, Supreme Healing's maximised
   * dice, and Preserve Life's cap at half a creature's maximum — so they are
   * named here rather than guessed at, exactly as `CastingDamageAlteration`
   * names the writers of its single-writer arms.
   *
   * **It reaches the casting and no later moment of it**, which is the rule
   * the member above already keeps: SRD says "on the turn you cast the spell",
   * so an area healing somebody a minute later and a later use of an ongoing
   * casting restore what the definition prints. The one casting it does not
   * reach that arguably should is a **readied** spell released later: the slot
   * went at the Ready, and the record a release settles from carries the
   * casting's id and nothing else for this to read.
   */
  | {
      readonly kind: 'casting-healing';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingHealingWhen;
      /** What it does to what they restore. */
      readonly alters: CastingHealingAlteration;
    };

/**
 * Which castings a `casting-healing` grant reaches.
 *
 * {@link CastingDamageWhen}'s reading, with one field, because one narrowing
 * has a writer: SRD Disciple of Life's "a spell you cast **with a spell
 * slot**", which is what tells a Cure Wounds from a potion's conferral, a
 * wand's casting and a free casting a feature paid for. A second field here
 * would be a narrowing nothing narrows.
 */
export interface CastingHealingWhen {
  /**
   * That a spell slot paid for the casting.
   *
   * Absent asks nothing, which is the reading every narrowing in this file
   * takes; `true` is the SRD's own clause.
   */
  readonly withSlot?: true;
}

/**
 * What a feature does to the hit points a casting was going to restore.
 *
 * One arm, and it is Disciple of Life's: a flat number, optionally plus the
 * level of the slot that paid. The three other SRD sentences this reader would
 * serve are named on the grant above and none of them is written here, because
 * a member of a closed vocabulary exists when a feature writes it.
 */
export type CastingHealingAlteration = {
  readonly kind: 'flat';
  /** SRD Disciple of Life's "2", before the slot level is added to it. */
  readonly flat: number;
  /** SRD's "plus the spell slot's level". */
  readonly plusSlotLevel?: true;
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
  | { readonly kind: 'while-worn' }
  /**
   * SRD Sunlight Sensitivity, on four stat blocks in one sentence: "**While
   * in sunlight**, the kobold has Disadvantage on ability checks and attack
   * rolls." SRD Sunlight Weakness and the vampires' Sunlight say it too.
   *
   * The holder's own space, which is what every one of those sentences says,
   * read through `lightAt` at the moment the question is asked — so the
   * Disadvantage arrives when the creature steps into the shaft of light and
   * goes when it steps out, with nothing to remember and nothing to sweep.
   *
   * **Sunlight is Bright Light with a flag** (the owner's fourth ruling), so
   * a torch is not the sun and a lantern does not blind a wight. A space
   * nobody has said anything about is not sunlit either: the requirement
   * fails on the null, which is the conservative direction and the "no
   * default ambient" ruling read through to its consequence.
   */
  | { readonly kind: 'in-sunlight' };

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
 * How long a grant an activation hangs runs for.
 *
 * The two turn anchors, resolved against the holder, and the turn in progress
 * ending. Every member is a `Duration` the engine already builds — this names
 * the three a *use* of a feature can reach, which excludes the spans a casting
 * measures on the clock: nothing a Bonus Action buys is a number of seconds,
 * and a grant with no deadline at all is a durable one, which is
 * {@link StandingGrant}'s job and not this one.
 */
export type HungSpan = TurnAnchor | 'end-of-current-turn';

/**
 * A grant a *use* of a feature hangs on its holder, at the moment it is paid
 * for.
 *
 * **The stored half of {@link StandingGrant}, and the distinction is the whole
 * reason this type exists.** A standing grant is derived from the holder's own
 * state on every read, which is what keeps an aura honest and what lets a
 * feature's benefit stop the moment its condition does. What derivation cannot
 * do is be *spent*: `consumedRollModifiers` reads `CreatureState.rollModifiers`
 * — stored state — so `oneShot` written on a standing grant is a promise
 * nothing keeps, and SRD Steady Aim's "Advantage on your next attack roll"
 * could not be written at all. Derived rules for what a feature permits; stored
 * state for what is actually spent.
 *
 * **Two kinds because one SRD sentence needs both at once.** Steady Aim hangs
 * an Advantage and a Speed of 0 out of one Bonus Action, and neither is
 * expressible the other way: the Advantage has to be stored to be spent, and
 * `StandingGrant`'s `speed` member carries feet to *add* — "Speed reductions
 * are not this member's business" — so a derived zero does not exist.
 *
 * **Each grant carries its own source, and that is a rule rather than a
 * spelling.** `roll-modifier-consumed` releases everything one source granted a
 * creature, because that is `releaseGrants` and one deadline ends one source's
 * whole sentence. Two grants filed under one source would therefore end
 * together, so the roll that spent the Advantage would hand the Speed back —
 * which is not what the book says. See `hungSource`.
 */
export type HungGrant =
  | {
      readonly kind: 'roll-mode';
      readonly modifier: RollModifier;
      readonly lasts: HungSpan;
    }
  | {
      /** SRD Steady Aim: "your Speed is 0 until the end of the current turn." */
      readonly kind: 'speed';
      /**
       * Narrowed for {@link AreaStanding}'s reason: a hung grant carries no
       * mode, so it has nowhere to give a Speed in.
       */
      readonly change: Exclude<SpeedChange, 'match-walk'>;
      /** Signed feet, for an `add`; absent for the other two — see {@link GrantedSpeed}. */
      readonly feet?: number;
      readonly lasts: HungSpan;
    };

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
/**
 * A class's own way of striking, compiled onto the sheet.
 *
 * SRD Martial Arts is the one the book prints and it needs every field at
 * once, which is what makes the shape real rather than a guess: a set of
 * weapons the class names beside its Unarmed Strike, a die rolled in place of
 * their normal damage, an ability offered in place of the attack's own, a
 * Bonus Action strike, and a gate with two halves.
 *
 * **A style always covers its holder's Unarmed Strike**, and {@link weapons}
 * widens it to the weapons the class names. That is the sentence the SRD
 * writes — "your Unarmed Strike **and** Monk weapons" — and it is why a style
 * with no weapons at all is a coherent thing to write: a class that redefines
 * only the fist.
 *
 * Resolved at creation like `activated` and `reactions` beside it, because the
 * die is a column of a class table read at *that class's* level — a Monk 5 /
 * Fighter 5 rolls a d8 and not a level 10 character's d10 — and re-deriving a
 * class table on every swing is not a thing to do on every swing.
 */
export interface StrikeStyle {
  /** The feature that grants it. */
  readonly source: string;
  readonly name: string;
  /**
   * The weapons this style covers besides the Unarmed Strike.
   *
   * SRD Martial Arts: "Simple Melee weapons" and "Martial Melee weapons that
   * have the Light property" — a list, because the book writes a list. Absent
   * covers the fist and nothing else.
   */
  readonly weapons?: readonly WeaponSelector[];
  /** The die rolled in place of the normal damage, at this character's level. */
  readonly die?: string;
  /** The ability offered in place of the attack's own. */
  readonly ability?: Ability;
  /** SRD Bonus Unarmed Strike: "You can make an Unarmed Strike as a Bonus Action." */
  readonly bonusUnarmedStrike?: boolean;
  /**
   * SRD Martial Arts: "while you are unarmed **or wielding only Monk
   * weapons**".
   *
   * The half of the gate that reads {@link weapons} from the other end: the
   * whole style is lost the moment its holder picks up something it does not
   * cover, fist included. Absent, and what is in the other hand is nobody's
   * business — which is what a homebrew style that redefines only the fist
   * would say.
   */
  readonly whileWieldingOnly?: boolean;
  /**
   * The other half, in the vocabulary the standing effects already use.
   *
   * SRD Martial Arts: "and you aren't wearing armor or wielding a Shield",
   * which is `unarmored` word for word.
   */
  readonly requires?: readonly StandingRequirement[];
}

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
  readonly lasts: TurnAnchor;
  /** SRD Rage: "You can maintain a Rage for up to 10 minutes." */
  readonly capSeconds?: number;
  /** What ends it early, each read from the feature's own text. */
  readonly endsOn?: readonly ActivationEnd[];
  /** SRD Rage: "You can't maintain Concentration, and you can't cast spells." */
  readonly forbidsCasting?: boolean;
  /**
   * SRD Steady Aim: "You can use this feature only if you haven't moved during
   * this turn."
   *
   * A gate on *paying* for the use, which is why it is here and not an
   * {@link ActivationEnd}: the list above holds what stops a feature starting
   * because it is what would end it, and moving does not end a Steady Aim
   * already taken. Nor is it a {@link StandingRequirement}: those are read
   * afresh on every read of a benefit, and this is asked once, at the moment
   * the Bonus Action is spent.
   *
   * Read off `TurnBudget.movementSpent`, which stores the feet that were spent
   * rather than what is left of them — which is exactly what lets the question
   * be asked at all.
   */
  readonly onlyIfUnmoved?: boolean;
  /** What a use of it hangs on its holder — see {@link HungGrant}. */
  readonly hangs?: readonly HungGrant[];
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
 * One thing a use of a feature's pool buys, compiled onto the sheet.
 *
 * `PoolOptionGrant` with the class table read out of it — the dice resolved at
 * the holder's own class level the way a self-heal's are, and the spellcasting
 * ability the class's block names, so the command reads the sheet and never a
 * class table. SRD Channel Divinity's menu is the shape: one pool, several
 * named purchases, one use apiece.
 */
export interface PoolOption {
  /** The feature the pool belongs to — `usePoolOption` is asked for both. */
  readonly feature: string;
  /** What the feature is called: SRD's "Channel Divinity". */
  readonly featureName: string;
  readonly option: string;
  /** What this option is called: SRD's "Turn Undead". */
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
  readonly pool: string;
  /** The effects, with any class-table dice already resolved. */
  readonly effects: readonly SpellEffect[];
  /**
   * The spellcasting ability the DC and any modifier are read from.
   *
   * SRD Channel Divinity: "If a Channel Divinity effect requires a saving
   * throw, the DC equals the spell save DC from this class's Spellcasting
   * feature" — a derivation of the holder's sheet rather than a number the
   * feature prints, which is the whole difference between a feature's DC and
   * an item's. The **granting class's**
   * ability, resolved at creation, because a multiclassed holder has more than
   * one and the feature belongs to exactly one of them.
   *
   * Null where the granting class casts nothing at all, which is the one case
   * the SRD never prints: the DC then falls to `8 + Proficiency Bonus`, the
   * rule `numbersForItem` already writes for a wielder with no ability of
   * their own.
   */
  readonly ability: Ability | null;
  readonly area?: SpellArea;
  readonly reach?: number;
  readonly mustBeType?: string;
  readonly durationSeconds?: number;
  readonly endsEarly?: readonly EffectEndCause[];
  readonly damageTypeStated?: readonly string[];
  /**
   * The hit points one use mints and divides — SRD Preserve Life.
   *
   * `HitPointDivision` with the class table read out of it, exactly as the
   * dice above are: "five times your Cleric level" is fifteen at Cleric 3, and
   * the command sees a number rather than a multiplier and a level to find.
   */
  readonly distributes?: HitPointBudget;
}

/**
 * A budget of hit points a use of a pool option mints, resolved at creation.
 *
 * The cap and the excluded types come across as they were written, because
 * neither reads a class table: what the cap is measured against is the
 * *target's* maximum at the moment of use, and a creature type is a fact about
 * whoever is on the other end.
 */
export interface HitPointBudget {
  readonly hitPoints: number;
  readonly cap: 'half-maximum';
  readonly excludesTypes?: readonly string[];
}

/**
 * What one purchased option does to the casting that bought it.
 *
 * **Four arms, one per number the casting command works out before it spends
 * anything**: how far the spell reaches, how long it runs, which part of the
 * turn it takes, and what level it counts as. That is the whole of the
 * boundary — each arm rewrites a value the cost-and-route half of a casting
 * already holds in its hand, and not one of them brings machinery of its own
 * or reaches an effect that has begun to resolve.
 *
 * The shape {@link CastingDamageAlteration} above already wears, asked of a
 * different half of the same command: that one alters what a casting *deals*,
 * this one alters what it *costs*. Its own declaration says why four arms of
 * one field beat four grants — "All four are asked for at one moment, by one
 * reader, and each is a single arithmetic operation on a notation already in
 * hand" — and the argument carries over word for word.
 *
 * **Narrowings live on the arm rather than in a fifth `when` record**, which
 * is where this parts company with `CastingDamageWhen`: each option's
 * precondition is a fact about the very value it rewrites — a range that is a
 * distance at all, a duration of at least a minute, a casting time that is an
 * Action, a target count that moves with the slot — so a shared `when` would
 * be four fields of which three are always absent.
 *
 * SRD publishes **ten** Metamagic options and four of them are these arms. The
 * other six are deliberately not here, and none of them is a fifth arm waiting
 * to be written — each wants a mechanism that lives somewhere else entirely:
 *
 * | SRD | Why not |
 * |---|---|
 * | Careful Spell | it changes who the casting catches, not what it costs: creatures that automatically succeed on a save the resolver is about to roll |
 * | Heightened Spell | a roll mode hung on one target's saves for one casting — a modifier, which `roll-modifiers.ts` owns |
 * | Subtle Spell | a `SpellDefinition` holds no components at all, so there is nothing for it to remove |
 * | Transmuted Spell | the damage type a casting deals, which is `CastingDamageAlteration` above rather than anything a casting *costs* — and that union has no arm that substitutes one |
 * | Empowered Spell, Seeking Spell | a damage die and a d20 thrown again. `rerollDice` in `dice.ts` does it and no casting passes it, which is a gap in what an effect may ask the dice for |
 */
export type CastingCostAlteration =
  /**
   * SRD Distant Spell: "you can spend 1 Sorcery Point to double the spell's
   * range. Or when you cast a spell that has a range of Touch ... make the
   * spell's range 30 feet."
   *
   * Two sentences and one arm, because both of them answer "how far does this
   * casting reach" and the second is the first's exception. A Range: Self
   * spell has no distance to multiply and is refused — SRD's "a range of at
   * least 5 feet" is that refusal — and doubling the five feet `ranged`
   * reports for a Touch is why {@link touchBecomesFeet} is printed rather than
   * inferred.
   */
  | {
      readonly kind: 'range';
      /** What the printed distance is multiplied by. */
      readonly multiplier: number;
      /**
       * What a Touch range becomes outright, in feet.
       *
       * Absent means a Touch spell is refused rather than multiplied, because
       * `ranged` reports a Touch as five feet and doubling that is arithmetic
       * nobody printed.
       */
      readonly touchBecomesFeet?: number;
    }
  /**
   * SRD Extended Spell: "you can spend 1 Sorcery Point to double its duration
   * to a maximum duration of 24 hours."
   *
   * The **casting's** own span, which is what everything it hangs is ended by:
   * the deadline filed against the casting id is what `spell-ended` releases,
   * so doubling it doubles the Charm as well as the Charm Person. A rider with
   * a span of its own — SRD Sunburst's minute of Blindness on an Instantaneous
   * spell — is not the spell's Duration and is left alone.
   */
  | {
      readonly kind: 'duration';
      readonly multiplier: number;
      /** SRD's "to a maximum duration of 24 hours", in seconds. */
      readonly maximumSeconds?: number;
      /** SRD's "a duration of 1 minute or longer", in seconds. */
      readonly minimumSeconds?: number;
    }
  /**
   * SRD Quickened Spell: "When you cast a spell that has a casting time of an
   * action ... change the casting time to a Bonus Action for this casting."
   *
   * {@link from} is the narrowing and is required: an option that rewrote
   * *any* casting time would turn a Reaction spell into a Bonus Action one,
   * which no sentence in the book does.
   */
  | {
      readonly kind: 'casting-time';
      readonly from: CastingTime;
      readonly to: CastingTime;
    }
  /**
   * SRD Twinned Spell, whose 2024 text is one number: "you can spend 1 Sorcery
   * Point to **increase the spell's effective level by 1**."
   *
   * The level the casting counts as, which is not the level of the slot that
   * paid for it — the slot is untouched and the casting is pinned at the
   * higher level, so the extra target, the extra die and the longer duration
   * band all follow from arithmetic the engine already does.
   */
  | {
      readonly kind: 'effective-level';
      /** Whole levels, and the casting still cannot pass level 9. */
      readonly by: number;
      /**
       * SRD: "a spell, such as _Charm Person_, that **can be cast with a
       * higher-level spell slot to target an additional creature**."
       *
       * Read off `TargetRule.extraPerSlotLevelAbove`, which is that sentence
       * already transcribed on every definition that prints it. A narrowing
       * and not a rule: absent, the option reaches any casting, which is what
       * a homebrew feature that simply upcast would want.
       */
      readonly onlyIfTargetsScale?: true;
    };

/**
 * One thing a casting may buy, compiled onto the sheet.
 *
 * `CastingOptionGrant` with the player's own answer read out of it: SRD gives
 * a Sorcerer "two Metamagic options of your choice" from a menu of ten, and
 * what reaches the sheet is the two. The casting command therefore reads a
 * sheet and never a class table, which is the rule every other compiled
 * feature here keeps.
 *
 * `perCasting` is carried on each entry rather than looked up on the feature,
 * for `PoolOption.pool`'s reason one line up: the reader has an elected option
 * in its hand and the grant it came from is a catalogue lookup away.
 */
export interface CastingOption {
  /** The feature the menu belongs to — SRD's "Metamagic". */
  readonly feature: string;
  readonly featureName: string;
  /** The option's own id, which is what a casting elects it by. */
  readonly option: string;
  /** What this option is called: SRD's "Distant Spell". */
  readonly name: string;
  /** The pool the price comes out of. */
  readonly pool: string;
  readonly cost: number;
  /** How many of this feature's options may ride on one casting. */
  readonly perCasting: number;
  readonly alters: CastingCostAlteration;
}

/**
 * One thing a hit buys, compiled onto the sheet.
 *
 * {@link PoolOption}'s twin one trigger along, and the fields it does not have
 * are the ones an action owns: no action to spend, no reach and no area,
 * because the creature a rider reaches is the one the attack just hit. What it
 * has instead is the qualification — SRD Stunning Strike's "with a Monk weapon
 * or an Unarmed Strike" — read at the swing rather than at creation, because
 * which weapon is in hand is not a fact about the character.
 *
 * The pool is nullable here and it is not on a pool option: SRD charges
 * Stunning Strike a Focus Point out of a *different feature's* pool and
 * charges Open Hand Technique nothing at all.
 */
export interface HitOption {
  /** The feature the rider belongs to — the swing names it and the option. */
  readonly feature: string;
  /** What the feature is called: SRD's "Stunning Strike". */
  readonly featureName: string;
  readonly option: string;
  /** What this option is called, for the log. */
  readonly name: string;
  /** The pool a use comes out of, or null where the book charges nothing. */
  readonly pool: string | null;
  /** What one rider costs out of that pool. */
  readonly costs: number;
  /** SRD: "Once per turn when you hit a creature". */
  readonly oncePerTurn?: boolean;
  readonly weapons?: readonly WeaponSelector[];
  readonly unarmedStrike?: boolean;
  readonly effects: readonly SpellEffect[];
  /**
   * The ability the DC is read from — {@link PoolOption.ability} exactly, with
   * one more way of being answered.
   *
   * The feature's own where it prints one (SRD Monk's Focus: "8 plus your
   * Wisdom modifier and Proficiency Bonus"), the granting class's spellcasting
   * ability where it does not, and null where neither exists — which falls to
   * `8 + Proficiency Bonus`, the rule an item already falls back to.
   */
  readonly ability: Ability | null;
  /**
   * The DC a **printed** line states, in place of the one {@link ability}
   * derives.
   *
   * `CastsSpellGrant.saveDc` exactly, on the other host that has a number of
   * its own: an item prints its DC and is the same in an archmage's hand, and
   * so does a stat block. Derivation is the right answer for a class feature —
   * SRD Stunning Strike is "your spell save DC" — and the wrong one for a
   * number the book states, and the two are not distinguishable after the
   * fact: `8 + Proficiency Bonus` happens to equal the Ghoul's printed 10 and
   * does not equal the Death Dog's 12.
   *
   * It is one field for the one number the line prints, whichever sentence
   * asks for it: the save an effect forces and — where the rider is a grapple
   * — nothing, because SRD prints the escape DC inside that clause instead.
   * See {@link grapples}.
   */
  readonly saveDc?: number;
  readonly lasts?: TurnAnchor;
  /**
   * Whose next turn {@link lasts} is anchored on.
   *
   * Omitted, the **holder's**, which is what every feature that buys a rider
   * writes: SRD Stunning Strike's "until the start of your next turn". A
   * printed stat-block line writes the other one as readily — the Giant
   * Vulture's "until the end of **its** next turn" — and the two are a round
   * apart in the order. Filing one on the other is a wrong rule rather than a
   * refusal, which is what a named anchor exists to make impossible.
   */
  readonly lastsOn?: HitRiderAnchor;
  readonly durationSeconds?: number;
  readonly endsEarly?: readonly EffectEndCause[];
  /**
   * A **grapple** the blow makes, with the escape DC the line prints.
   *
   * Beside {@link effects} rather than inside it, because a grapple is not a
   * condition in this engine: it is a relation, found by the `grapple:<who>`
   * source its instance is filed under and ended on facts about the grappler.
   * An effect list files what it hangs under the source of whatever ran it, so
   * a Grappled that rode on one would be a grapple `grapplesOn` could not see,
   * `lapsedGrapples` could not end and `escapeGrapple` could not be attempted
   * against — strictly worse than the prose it replaced. This says *grapple*,
   * and the grapple is made exactly as the Attack action's own is.
   */
  readonly grapples?: HitGrapple;
}

/**
 * Which of the two creatures in a hit a turn-anchored span hangs on.
 *
 * A hit's world has two creatures in it and no more, which is why this is a
 * pair rather than a `CharacterId`: a `HitOption` is written once — compiled
 * off a sheet or minted off a printed line — and bound to whoever is standing
 * there when the blow lands. {@link CounterpartRole} makes the same argument
 * for the same reason on the spell side.
 */
export type HitRiderAnchor = 'attacker' | 'target';

/** The grapple a hit makes, as the line that prints one states it. */
export interface HitGrapple {
  /**
   * SRD's "(escape DC 13)", pinned on the timer the grapple files.
   *
   * The grapple's DC and the escape's are one number in the book, and an
   * escape attempted an hour later is against the number the grapple was made
   * at — the rule `grappleTarget` already writes for the Unarmed Strike's own.
   */
  readonly escapeDc: number;
  /**
   * What the line says the creature holds on **with**, where it says.
   *
   * SRD Giant Scorpion: "from one of two claws"; the Griffon: "from both of
   * the griffon's front claws". It is a count of how many creatures the block
   * can hold at once and the engine counts no limbs, so it is carried to be
   * *reported* rather than enforced — the reading `grappleTarget` already
   * takes of the free hand SRD asks it for.
   */
  readonly withLimbs?: string;
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
 * One direction of a feature's trade, with its keys resolved.
 *
 * {@link RecoveryFeature}'s neighbour and the same shape of thing: what a
 * feature does to a pool that is not its own, resolved at creation because a
 * slot's key carries a level. What differs is which way the uses go — a
 * recovery gives them back for nothing, and this one pays.
 *
 * The grant's own vocabulary is `ResourceTradeGrant` in `progression.ts`; this
 * is that with the two ends turned into pool keys, because a command spends
 * and restores by key and nothing below it knows what a spell slot is.
 */
export interface TradeFeature {
  readonly feature: string;
  readonly name: string;
  /** The trade's own id, which is what a command names. */
  readonly trade: string;
  readonly action: 'none' | 'action' | 'bonus-action';
  /**
   * The pool spent, or **null** where the caller names a slot level.
   *
   * SRD's "expend a spell slot" leaves the level to the caster, and a key
   * cannot be resolved until they say — which is the one thing about a trade
   * that cannot be settled at creation.
   */
  readonly spends: { readonly key: string | null; readonly uses: TradedAmount };
  /**
   * The pool bought, or **null** where the caller names the slot levels.
   *
   * The mirror of {@link spends}, and it arrived for the mirror reason: SRD
   * Font of Magic creates "one spell slot" of a level the Sorcerer picks off
   * the Created Spell Slots table, and SRD Arcane Recovery recovers slots the
   * Wizard chooses. Which slot is bought is no more the engine's to guess than
   * which slot is burnt, so the key waits for the caller in both directions.
   */
  readonly gains: { readonly key: string | null; readonly uses: TradedAmount };
  /**
   * SRD Arcane Recovery's "combined level equal to no more than half your
   * Wizard level (round up)", read at the granting class's own level — the
   * same moment and the same rule as `RecoveryFeature.classLevel`.
   */
  readonly combinedLevel?: number;
  /** SRD Arcane Recovery: "none of them can be level 6+." */
  readonly maxSlotLevel?: number;
  /** SRD Arcane Recovery: "When you finish a Short Rest." */
  readonly moment?: 'short-rest';
  readonly limit: 'once-per-turn' | 'once-per-long-rest' | 'unlimited';
  /**
   * The pool of one the trade declares — the daily limit it lives in where
   * {@link limit} is `once-per-long-rest`, and the feature's own single use
   * that an `unlimited` trade buys back. See `ResourceTradeGrant.pool`.
   */
  readonly pool?: string;
  /** SRD: "if you have no uses of Wild Shape left". */
  readonly onlyIfEmpty?: string;
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
  return requirementsHold(state, who, effect.requires, effect.feature);
}

/**
 * The same question, asked of a list of requirements rather than of a standing
 * effect.
 *
 * Exported because a {@link StrikeStyle} is gated by the same vocabulary and
 * is not a standing effect: SRD Martial Arts' "while you aren't wearing armor
 * or wielding a Shield" is `unarmored`, word for word the clause Unarmored
 * Movement already carries. A second spelling of that evaluation is the thing
 * this file exists to prevent, so there is one.
 *
 * `source` is what `while-worn` and `while-attuned` look up — an item's id.
 * A feature naming no item is refused by `checkContent`, so handing a feature
 * id here withholds the benefit rather than granting it by accident.
 */
function requirementsHold(
  state: GameState,
  who: CharacterId,
  requires: readonly StandingRequirement[] | undefined,
  source: string,
): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;

  for (const requirement of requires ?? []) {
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
    // `source` is the item's id for an item grant; a *feature* that
    // carried one of these would name no item and would never hold, which is
    // the conservative direction and what `checkContent` refuses outright.
    if (
      requirement.kind === 'while-worn' &&
      !creature.equipped.some((held) => held.id === source)
    ) {
      return false;
    }
    if (
      requirement.kind === 'while-attuned' &&
      !creature.attuned.some((held) => held.id === source)
    ) {
      return false;
    }
    // Where the creature is standing, and how bright it is there — both read
    // now rather than stored, exactly as `has-speed` reads a Speed. A creature
    // nobody has placed is in no sunlight, which is the same answer an
    // undeclared space gives and the conservative one.
    if (requirement.kind === 'in-sunlight') {
      const where = state.scene === null ? null : positionOf(state.scene, who);
      if (where === null || !lightAt(state, where).sunlight) return false;
    }
  }
  return true;
}

/**
 * The style that reaches this swing, or null where none does.
 *
 * Three questions, and a style has to answer all three: its gate holds, it
 * covers the thing being swung, and — where it says so — nothing outside it is
 * in the holder's hands.
 *
 * **`wielding` is passed in rather than looked up**, because a weapon record
 * lives in the catalogue and this file holds none: `equipped` carries an
 * armour record and an item's pinned grants, and nothing else. The command has
 * the content in hand already, exactly as `reachOf` does.
 *
 * The **first** style that applies wins. No character the SRD can build has
 * two, and a rule for combining two class features that both redefine the fist
 * is a decision nobody has made — so the answer is the one the sheet lists
 * first rather than a silently invented maximum.
 */
export function strikeStyleFor(
  state: GameState,
  who: CharacterId,
  context: { readonly weapon: Weapon | null; readonly wielding: readonly Weapon[] },
): StrikeStyle | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;

  // **A casting that imbued this weapon is asked first**, and it can only ever
  // answer for the one object it was aimed at.
  //
  // SRD Shillelagh redefines a Quarterstaff's die and the ability its rolls
  // are made with, which is exactly what a style is, so it arrives here rather
  // than as a fourth thing the attack layer would have to learn to read.
  //
  // **First, and the order is a ruling rather than an accident.** A style is
  // the sheet's and a casting is an act somebody just took, so the deliberate
  // thing wins where both reach the same swing — a Monk/Druid who spends a
  // Bonus Action on Shillelagh gets Shillelagh's die and not Martial Arts'. It
  // can shadow nothing else: a weapon rider is keyed on one weapon's id, so an
  // Unarmed Strike — which every class style covers and no rider can — never
  // reaches this branch at all. That is what makes putting it first safe,
  // where a style with an empty `weapons` list in the same position would take
  // the Monk's fist away.
  const imbued = weaponRidersFor(creature, context.weapon).find(
    (rider) => rider.die !== undefined || rider.ability !== undefined,
  );
  if (imbued !== undefined) {
    return {
      source: imbued.source,
      name: spellOfSource(imbued.source),
      ...(imbued.die === undefined ? {} : { die: imbued.die }),
      ...(imbued.ability === undefined ? {} : { ability: imbued.ability }),
    };
  }
  // The sheet as it stands, for the reason every reader in this file takes it:
  // a Belt of Giant Strength moves the score the style's offer is weighed
  // against, and the styles themselves ride along untouched.
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  const styles = sheet.strikeStyles ?? [];
  if (styles.length === 0) return null;

  for (const style of styles) {
    if (!requirementsHold(state, who, style.requires, style.source)) continue;
    const covered = style.weapons ?? [];
    // SRD: "while you are unarmed **or wielding only Monk weapons**". Holding
    // nothing satisfies it, which is the first half of the same sentence.
    if (
      style.whileWieldingOnly === true &&
      !context.wielding.every((held) => weaponInSet(held, covered))
    ) {
      continue;
    }
    // A style always covers the fist; `weapons` is what it adds to it.
    if (context.weapon !== null && !weaponInSet(context.weapon, covered)) continue;
    return style;
  }
  return null;
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
function itemStandingOf(creature: CreatureState): readonly StandingEffect[] {
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

    // The holder's score as it stands, so a Paladin wearing something that
    // sets their Charisma radiates the aura that score gives.
    // `abilityScoresOf` rather than `sheetAsItStands`: this wants one
    // holder's one score, and the substitution would build a sheet nobody
    // here reads.
    const flat = Math.max(
      effect.grant.minimum,
      abilityModifier(abilityScoresOf(state, from)[effect.grant.fromAbility]),
    );
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: `${effect.name} (${from})`, flat });
    }
  }

  return [...best.values()];
}

/**
 * The ability-sized bonuses this creature's standing effects add to a check of
 * one skill.
 *
 * {@link standingSaveBonuses}' twin on the other family, and it takes every
 * one of that function's readings because they are the same sentence: the
 * modifier is the **holder's**, read off their sheet as it stands rather than
 * off the sheet of whoever is rolling; the floor is the feature's own "(minimum
 * of +1)"; and the best is kept per feature, because "when two or more game
 * features have the same name, only the effects of one of them — the most
 * potent — apply".
 *
 * The skill is the whole of the narrowing. A feature that named none would be
 * a bonus to every ability check, which is `flat-bonus`'s shape and is refused
 * here by `checkContent` rather than read as "all of them".
 */
export function standingCheckBonuses(
  state: GameState,
  who: CharacterId,
  skill: Skill,
): readonly Bonus[] {
  const best = new Map<string, Bonus>();

  for (const { from, effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'check-bonus') continue;
    if (!effect.grant.skills.includes(skill)) continue;

    const holder = state.creatures[from];
    if (holder === undefined) continue;

    const flat = Math.max(
      effect.grant.minimum,
      abilityModifier(abilityScoresOf(state, from)[effect.grant.fromAbility]),
    );
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      // Named for the feature alone, unlike the aura beside it: both SRD
      // writers reach their own holder, so there is no second creature for a
      // reader of the log to tell the bonus apart by.
      best.set(effect.feature, { source: effect.name, flat });
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
  /**
   * The weapon record the swing resolved, for the *other* narrowing.
   *
   * SRD Archery's "with Ranged weapons" is a question about what kind of thing
   * is in hand rather than which copy of it, so it is answered off the record
   * and not off `withItem` — see {@link WeaponNarrowing}. Absent is a roll made
   * with no weapon, which is the conservative direction: a narrowed benefit is
   * withheld from a caller who has not said.
   */
  readonly weapon?: Weapon | null;
  /** SRD Great Weapon Fighting's "holding with two hands". */
  readonly twoHanded?: boolean;
}

/**
 * The half of a context a weapon narrowing asks about.
 *
 * One conversion in one place, so the two readers that ask cannot come to
 * disagree about what an unstated hand means.
 */
const wielding = (context: { readonly weapon?: Weapon | null; readonly twoHanded?: boolean }): WieldingContext => ({
  weapon: context.weapon ?? null,
  ...(context.twoHanded === undefined ? {} : { twoHanded: context.twoHanded }),
});

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
    // "With Ranged weapons", and with nothing else — the other narrowing, read
    // off the record rather than off the id.
    if (
      effect.grant.onlyWithWeapon !== undefined &&
      !weaponNarrowingHolds(effect.grant.onlyWithWeapon, wielding(context))
    ) {
      continue;
    }

    const flat = effect.grant.flat;
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: effect.name, flat });
    }
  }

  // **The weapon a casting imbued, folded in here rather than at the caller.**
  // SRD Magic Weapon's "+1 bonus to attack rolls **and** damage rolls" is one
  // number reaching two rolls, and this is the attack half; the damage half is
  // `standingAttackDamage`, which is the other place a flat number of the
  // weapon's own reaches a swing. Keyed apart from the feature bonuses above
  // by the casting in the source, so two castings of Magic Weapon on one
  // weapon do not stack — the same "same name, most potent" reading.
  if (applies === 'attack') {
    for (const bonus of weaponRiderBonuses(state.creatures[who], context.weapon ?? null)) {
      const current = best.get(bonus.source);
      if (current === undefined || (current.flat ?? 0) < (bonus.flat ?? 0)) {
        best.set(bonus.source, bonus);
      }
    }
  }

  return [...best.values()];
}

/**
 * The flat plus an imbued weapon carries, as the two rolls that read it take
 * their bonuses.
 *
 * Its own function because the plus reaches an attack roll and a damage roll
 * and those are gathered in two places, and a second spelling of "which rider
 * applies and what is it worth" is how the two would come to disagree about a
 * thrown Dagger.
 *
 * `spellOfSource` gives the readable half back, so the log says "Magic Weapon"
 * rather than `Magic Weapon#cast:3`; the casting id stays in the grant, which
 * is what ends it.
 */
function weaponRiderBonuses(
  creature: CreatureState | undefined,
  weapon: Weapon | null,
): readonly Bonus[] {
  return weaponRidersFor(creature, weapon)
    .filter((rider) => rider.bonus !== undefined)
    .map((rider) => ({ source: spellOfSource(rider.source), flat: rider.bonus as number }));
}

/**
 * Every per-die rule this creature's standing effects state about a swing.
 *
 * {@link standingBonuses}' sibling on the other half of what a feature can say
 * about a hit: that one gathers the numbers added to a roll, this the rules the
 * dice themselves are read under. Both are derived on every read and both ask
 * the same narrowing, because SRD Archery and SRD Great Weapon Fighting are one
 * clause about the weapon in hand wearing two sets of words.
 *
 * What comes back is the dice layer's own vocabulary, named after the feature
 * that stated the rule. **The name is for the deduplication rather than for the
 * log**: a substituted die records what it showed and what it counts as, side
 * by side, and `DieRoll.cause` names only the effect that *added or replaced* a
 * die — which a substitution does not do. So the log says a 1 counted as a 3
 * and does not say which rule said so.
 *
 * Deduplicated by feature, for the reason `standingBonuses` is: two holders of
 * one name are one rule, and applying a substitution twice would be a
 * substitution of a substitution.
 */
export function standingDamageEffects(
  state: GameState,
  who: CharacterId,
  context: { readonly weapon?: Weapon | null; readonly twoHanded?: boolean } = {},
): readonly DieEffect[] {
  const found = new Map<string, DieEffect>();

  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-die-rule') continue;
    if (
      grant.onlyWithWeapon !== undefined &&
      !weaponNarrowingHolds(grant.onlyWithWeapon, wielding(context))
    ) {
      continue;
    }
    found.set(effect.feature, treatLowRollsAs(grant.rule.atMost, grant.rule.as, effect.name));
  }

  return [...found.values()];
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
 * Every rule about the action economy standing over this creature right now:
 * what a casting hung on them, and what their own features say.
 *
 * **The one reader**, which is the point of it. `Spend` is built at eighteen
 * sites across nine command modules, and every one of them read
 * `creature.actionRules` — the stored half — so a feature's rule reaching only
 * seventeen of them would be a permission that worked everywhere but the
 * spender somebody happened to use.
 *
 * **The stored rules come first and the order is the fold's.** `refuseSpend`
 * takes the first rule that bites, so appending rather than merging by key is
 * what keeps every log this engine has already written answering exactly as it
 * did: a creature under Stinking Cloud is refused by Stinking Cloud, with the
 * same sentence, whatever its sheet says. The derived half is sorted by
 * {@link actionRuleKey} so that two readers of one state agree about it — a
 * tidiness rather than a rule, since nothing in this half is order-sensitive:
 * `governs` answers `false` for an `allows`, so a derived allowance never
 * reaches `refuseSpend` at all, and `allowsPrice` is an exact-match scan.
 *
 * A feature's rule is filtered by `meetsRequirements` on the way through —
 * that is what `standingFor` does — so a rule conditioned on a Rage stops the
 * moment the Rage does, with nothing having to remember to end it.
 */
export function actionRulesOn(
  state: GameState,
  who: CharacterId,
): readonly GrantedActionRule[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];

  const derived: GrantedActionRule[] = [];
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'action-rule') continue;
    derived.push({
      source: effect.feature,
      rule: effect.grant.rule,
      label: effect.name,
      // A feature holds its rule for as long as it holds the feature. Where
      // its own sentence names a shorter span it says so, and a requirement
      // that has stopped holding has already removed the rule above.
      until: effect.grant.until ?? 'you no longer have it',
    });
  }
  if (derived.length === 0) return creature.actionRules;

  derived.sort((a, b) =>
    actionRuleKey(a.source, a.rule).localeCompare(actionRuleKey(b.source, b.rule)),
  );
  return [...creature.actionRules, ...derived];
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
 * asks about sight comes through: a sense lives on a creature and the
 * declaration lives in the scene, so only a caller holding both can put the
 * two together. Three-valued like the pairwise question it wraps — null is
 * "ask", not "no" — and null again outside a scene, where there is no
 * distance for a range to be measured against.
 *
 * Exported for the reason `speedOf` and `armorClassOf` are: a caller reading
 * the declaration alone gets half the answer, and the half it is missing is
 * the whole of what a species trait grants.
 *
 * **Every rule in the engine that asks about sight asks here**, and none of
 * them calls {@link sightBetween} any more — the pairwise question is for a
 * caller who genuinely holds no creature to read a sense off. What each call
 * has to decide is *whose* sight it wants, because the looker is not always
 * the actor:
 *
 * | Rule | The looker |
 * |---|---|
 * | a casting and its shortlist (`namedTargets`, `eligibleTargets`) | the caster: "a creature **you** can see" |
 * | a teleport (`teleportSight`) | the creature moving: "a space **you** can see" |
 * | an Opportunity Attack (`provokedBy`) | the reactor: "a creature **you** can see leaves your reach" |
 * | a Reaction feature (`reaches`) | the reactor, whose roll they answer |
 * | Dodge (`defendingModes`) | the **target**: "if **you** can see the attacker" |
 * | a ranged attack at close quarters (`enemyWithinFiveFeet`) | the enemy beside you, "who can see you" |
 *
 * Dodge is the one that runs against the direction of the action, and the
 * last is the one a sense cannot move — only a declared no excuses that
 * attacker. Both say so where they are written.
 *
 * **One sentence in the book does not ask this question**, and it is the one
 * that looks most like it: SRD Invisible's "if a creature can somehow see
 * you". See {@link canSomehowSee} below for the sense that is the difference
 * and the ruling that put it there.
 */
export function canSee(state: GameState, from: CharacterId, to: CharacterId): boolean | null {
  if (state.scene === null) return null;
  return sightBetween(state.scene, from, to, sensesOf(state, from), {
    obscured: obscuredFrom(state, from, to),
  });
}

/**
 * The darkness this creature sees through, and how far — `sensesOf` for the
 * one grant that is not a sense.
 *
 * Gathered through `standingFor` exactly as a sense is, so an invocation, a
 * species trait and a magic item all reach the sight question by one route
 * and under the same clauses. One entry per member at the longest range, for
 * the reason `sensesOf` keeps one: two sources of one sentence are one
 * sentence, and the answer must not depend on which was read first.
 */
export function seesThroughOf(
  state: GameState,
  who: CharacterId,
): Readonly<Partial<Record<SeesThrough, number>>> {
  const furthest: Partial<Record<SeesThrough, number>> = {};
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'sees-through') continue;
    const had = furthest[effect.grant.through];
    if (had === undefined || effect.grant.feet > had) {
      furthest[effect.grant.through] = effect.grant.feet;
    }
  }
  return furthest;
}

/**
 * Whether what lies over the **target's** space stops this looker seeing in.
 *
 * **The step `docs/design/light-and-sight.md` adds, and it is here rather
 * than inside `sightBetween` on purpose.** The note's own reason: this reads
 * the looker's senses against the target's space, which is the same class of
 * question `sensesPerceiving` answers and not the class the declaration
 * answers. `positioning.ts` holds space and has no creature to read a sense
 * off; this file holds the creature. So the rule is pure and lives there, the
 * gathering lives here, and `sightBetween` is handed a yes or a no.
 *
 * The SRD's sentence is about the target's space — "while trying to see
 * something in that area" — so a creature standing in pitch darkness sees a
 * lit target perfectly, and this never reads the looker's own square.
 *
 * **False is "nothing is in the way", not "you can see"**, which is the
 * ordering the note gives and the reason this answers a boolean rather than a
 * verdict: a looker who defeats the dark is returned to the question they
 * would have been asked in a lit room, where a declaration or a sight-sense
 * settles it. SRD Devil's Sight's own word is "normally".
 */
function obscuredFrom(state: GameState, from: CharacterId, to: CharacterId): boolean {
  const scene = state.scene;
  if (scene === null || from === to) return false;
  const where = positionOf(scene, to);
  if (where === null) return false;

  const here = obscurementAt(state, where);
  // Lightly Obscured, Bright Light and a space nobody has spoken about all
  // leave the question exactly where it was: with the declaration and the
  // sense. Light changes the answer only where the book says it does.
  if (here.degree !== 'heavily') return false;

  const apart = distanceBetween(scene, from, to);
  const reach = apart.ok ? apart.value : null;
  const darkness = seesThroughOf(state, from).darkness;

  return !piercesObscurement(
    here,
    sensesReaching(scene, sensesOf(state, from), from, to),
    darkness !== undefined && reach !== null && reach <= darkness ? [{ feet: darkness }] : [],
  );
}

/**
 * The senses that see a creature who is not there to be seen.
 *
 * **The owner's ruling, 2026-09-20: Truesight and Blindsight satisfy SRD
 * Invisible's "if a creature can somehow see you". Darkvision does not.**
 *
 * The book is the reason, sense by sense. Darkvision is a rule about *light*
 * — it "can see in Dim Light within the range as if it were Bright Light and
 * in Darkness as if it were Dim Light" — and an Invisible creature is not
 * hidden by darkness, so the sense has nothing to say about it. Blindsight
 * is sight "without relying on physical sight", which is precisely the
 * reliance being Invisible defeats. Truesight is the glossary's own answer:
 * it sees "into the Ethereal Plane" and through the illusions and
 * transformations the clause exists for.
 *
 * It is a **narrowing** of `SIGHT_SENSES` rather than a second list, so no
 * member here can fail to be a form of sight in the first place — and
 * Tremorsense, which "doesn't count as a form of sight", is out of both.
 */
export const SENSES_THAT_SOMEHOW_SEE: ReadonlySet<SenseName> = new Set<SenseName>(
  [...SIGHT_SENSES].filter((sense) => sense !== 'darkvision'),
);

/**
 * Whether one creature can **somehow** see another — {@link canSee} with
 * {@link SENSES_THAT_SOMEHOW_SEE} in place of `SIGHT_SENSES`.
 *
 * SRD Invisible: "If a creature can somehow see you, you don't gain this
 * benefit against that creature," and, read from the other end, "Attack rolls
 * against you have Disadvantage." That is a *different sentence* from the
 * ones {@link canSee} answers, and the engine now says so out loud:
 *
 * | Question | Senses that answer | Whose sentence |
 * |---|---|---|
 * | {@link canSee} | Blindsight, Darkvision, Truesight | Dodge's "if you can see the attacker"; a spell's "a creature you can see"; an Opportunity Attack's |
 * | this one | Blindsight, Truesight | Invisible's "if a creature can somehow see you" |
 *
 * **The asymmetry is the ruling, not an oversight.** `defendingModes` asks
 * {@link canSee} on purpose and must keep asking it: a dwarf Dodging in a
 * lightless hall really can see the orc swinging at her, and Dodge's clause
 * is satisfied. The same dwarf's Darkvision tells her nothing about where the
 * Invisible Rogue is standing. One sense, two sentences, two answers.
 *
 * Everything else about it is {@link canSee}'s behaviour, because it *is*
 * that function with a shorter list: a declaration outranks a sense, declared
 * Total Cover silences one, a creature sees itself, and a question nobody has
 * answered is `null` — homework rather than a verdict. The caller decides
 * what to do with the `null`; on the ordinary attack route it is an
 * `unverified` line and never a `needs-context`, because a swing must not
 * stop to ask.
 */
export function canSomehowSee(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
): boolean | null {
  if (state.scene === null) return null;
  return sightBetween(
    state.scene,
    from,
    to,
    sensesOf(state, from).filter((sense) => SENSES_THAT_SOMEHOW_SEE.has(sense.sense)),
  );
}

/**
 * The senses one creature actually perceives another with, and nothing else.
 *
 * **The third sight-shaped question, and the one that is not about sight.**
 * {@link canSee} and {@link canSomehowSee} both answer a *sentence about
 * seeing*, so both put the table's declaration first: a declared line is the
 * answer, declared Total Cover silences every sense, and a sense speaks only
 * where nobody has said anything. That ordering is right for both of them and
 * wrong for the clause this answers.
 *
 * SRD Blur: "An attacker is immune to this effect if it **perceives you with
 * Blindsight or Truesight**." SRD Mirror Image names the same two. Ordinary
 * sight is exactly what those spells defeat, so a declared sight line must
 * not excuse anybody — asking {@link canSomehowSee} here would report `true`
 * off the declaration and hand an immunity to every attacker the table had
 * placed in the caster's line of sight, which is the whole spell undone. What
 * the sentence names is the **sense**, so what comes back is the senses and
 * not a verdict, and the rule reading it decides which of them it cares
 * about.
 *
 * Two things it keeps from its siblings, because both are facts about the
 * pair rather than about the sentence:
 *
 * - **Range.** Every sense in the glossary is written "with a range of N
 *   feet", so a sense that does not reach perceives nothing —
 *   `sensesReaching`, the same filter `sightBetween` applies.
 * - **Declared Total Cover silences a sense**, which is the glossary's own
 *   sentence on Blindsight — "you can see anything that isn't behind Total
 *   Cover" — and no less true of the other three. A creature it is illegal to
 *   target is not one an attacker is perceiving.
 *
 * Every sense, not only the sight ones: Tremorsense "doesn't count as a form
 * of sight" and is still a way of perceiving somebody, and it is a caller's
 * clause rather than this function's that decides whether it counts. No
 * clause names it today.
 *
 * Empty outside a scene, where there is no distance for a range to be
 * measured against — the same answer {@link canSee} gives as `null`, read here
 * as "no sense reaches", which leaves the effect standing.
 */
export function sensesPerceiving(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
): readonly SenseName[] {
  if (state.scene === null) return [];
  if (!canBeTargeted(coverBetween(state.scene, from, to))) return [];
  return sensesReaching(state.scene, sensesOf(state, from), from, to).map((sense) => sense.sense);
}

/**
 * This creature's six ability scores **as they stand**: what the sheet says,
 * and whatever is setting one right now.
 *
 * The reader for `ability-score-set`, and the only one. Everything that wants
 * a *sheet* goes through {@link sheetAsItStands}, which is this function plus
 * a substitution; what wants one score asks here. Two functions, one
 * derivation, so no second path can disagree with this one about what a
 * Strength is.
 *
 * Two rules, and both are the SRD's own sentence rather than a policy:
 *
 * - **A set never lowers.** "It has no effect on you if your Constitution is
 *   19 or higher without it" is printed on every item that sets a score, so
 *   it is kept here once rather than by each of them.
 * - **The highest of several wins**, which follows from the first: two belts
 *   are two sentences, each saying "your Strength is at least this", and the
 *   order they are read in cannot be allowed to matter. It is the move
 *   `armorClassCalculation` already makes with two Unarmoured Defenses.
 *
 * Derived on every read, like everything else in this file: the score is
 * gone the moment the item is off, and nothing has to remember to take it
 * away.
 */
export function abilityScoresOf(
  state: GameState,
  who: CharacterId,
): Readonly<Record<Ability, number>> {
  const creature = state.creatures[who];
  const own = creature?.sheet.abilities;
  if (own === undefined) return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

  let changed: Record<Ability, number> | null = null;
  for (const active of standingFor(state, who)) {
    const grant = active.effect.grant;
    if (grant.kind !== 'ability-score-set') continue;
    const standing: Record<Ability, number> = changed ?? { ...own };
    if (grant.score > standing[grant.ability]) standing[grant.ability] = grant.score;
    changed = standing;
  }
  return changed ?? own;
}

/**
 * The sheet a reader should be handed for this creature, rather than the one
 * stored on it.
 *
 * **One substitution, not a second pipeline.** Every modifier the engine
 * derives — a check, a save, an attack, a spell save DC, an Armour Class —
 * reads a score off a `CharacterSheet` through `modifierFor`, so an item that
 * sets a score reaches all of them by changing the sheet those functions are
 * given. Writing a second path for each would be the "second spelling of a
 * derivation" this repository keeps a record of.
 *
 * The **same object** comes back when nothing is setting a score, which is
 * every creature in almost every fight: the copy is paid for only where it
 * changes something, and identity is what a caller can cheaply check.
 *
 * Null for a creature nobody has added, which is what every other reader in
 * this file does with an unknown id — `armorClassOf` answers 0 and `sensesOf`
 * an empty list. A public export that threw where its neighbours degraded
 * would be a trap laid in the one function a caller is told to prefer.
 *
 * **The substitution is made where the state is, which is the commands.**
 * `attack.ts`, `checks.ts` and `combat.ts` take a `CharacterSheet` and hold
 * no `GameState`, and that is right rather than a gap: a roller that went
 * looking for a worn item would be the second derivation this function exists
 * to prevent. So each command asks here and hands the answer down, and an
 * attack roll, the damage it carries, an ability check, a saving throw,
 * Initiative, the save a spell rolls for its victim and the ability modifier a
 * Reaction adds all move with a set score — alongside the two readers in this
 * file that already did, `armorClassOf` through this function and
 * `standingSaveBonuses` through {@link abilityScoresOf}, which wants one
 * holder's one score rather than a sheet.
 *
 * **And the casting family is inside it now.** A spell's own numbers
 * (`numbersFor` in `commands/spell-resolution.ts`, and `numbersForItem` for
 * one an item casts, which takes the sheet the command hands it), the rolls
 * its effects make for caster and victim (`commands/spell-effect-rolls.ts`
 * and `commands/spell-effect-magic.ts`, through the `casterSheet` accessor
 * `resolveEffects` substitutes once), the Concentration save
 * (`commands/casting.ts`), the check and the save a turn boundary repeats
 * (`commands/turns.ts`) and a self-heal's addend (`commands/features.ts`) all
 * ask here. What is *not* a gap is `rollSpellDice`: it keeps only the
 * components whose source is the spell, so no ability modifier reaches it and
 * the sheet it is handed contributes nothing.
 *
 * **And `rest.ts` is inside it too, which was the last one outside.** The
 * Constitution a Hit Die adds on a Short Rest is read at the moment the die is
 * thrown, in a command holding the state and the id, so `endRest` asks here
 * like everything else and an Amulet of Health reaches it. No non-test engine
 * file reads an ability off `creature.sheet` now. What a substitution still
 * cannot reach is the one number that is genuinely *folded* rather than
 * derived — a hit point maximum, paid a level at a time — which is the whole
 * of what the Amulet of Health's one remaining `unmodelled` note records.
 */
export function sheetAsItStands(state: GameState, who: CharacterId): CharacterSheet | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;
  const abilities = abilityScoresOf(state, who);
  return abilities === creature.sheet.abilities ? creature.sheet : { ...creature.sheet, abilities };
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
  // The sheet as it stands, so an item that *sets* Dexterity moves the
  // Armour Class that reads it — and an item that sets Strength moves the
  // heavy-armour penalty `armorClass` applies for a Strength requirement.
  let total = armorClass(sheetAsItStands(state, who) ?? creature.sheet, creature.armorClasses);
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
  | 'zero'
  /**
   * A Speed in one **mode** equal to the creature's walking Speed.
   *
   * SRD Spider Climb prints "a Climb Speed equal to its Speed", SRD Alter
   * Self and Freedom of Movement say the same of a Swim Speed, and SRD
   * Second-Story Work says it of a Climb Speed on a class table. Four printed
   * writers of one sentence, which is why it is a member rather than an
   * addition whose feet somebody would have to compute at the cast and pin.
   *
   * **The walking Speed it matches is the base one**, before a Longstrider
   * and before a halving, and then everything that reaches the mode reaches
   * it. The alternative reads the *whole* walking Speed and then halves the
   * result a second time, so a Slowed spider would climb at a quarter of what
   * it walks. It is also the reading that agrees with the rule directly above
   * this family — an increase is the walking Speed's — and there is no
   * recursion, because a match names a mode and the walking mode is refused.
   *
   * Carries no feet. The number is the creature's, and a sentence that
   * printed one would be an addition.
   */
  | 'match-walk';

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
  /** Signed feet, for an `add`; absent for the other three. */
  readonly feet?: number;
  /**
   * Which of the five Speeds this moves. Absent is the walking one.
   *
   * **Absent rather than `'walk'`, and that is what keeps the frozen logs
   * folding unchanged**: every `speed-modifier-granted` written before modes
   * existed is a walking one, and a reader that defaults the field reads them
   * exactly as it always did.
   *
   * It is meaningful on the two operations that *give* a Speed and refused on
   * the two that take one away, which is the rule `speedOf` already fixed and
   * `checkSpeedChange` now enforces at the door: SRD writes "your Speed" for
   * an increase and means walking, and writes Grappled's 0, Slow's halving
   * and Exhaustion's five feet a level about the creature rather than about a
   * mode. A `halve` that named one mode would be a sentence the book does not
   * print.
   */
  readonly mode?: MovementMode;
  /**
   * SRD Fly's "and can hover", which is the trait the fall excepts.
   *
   * Only ever beside a granted Fly Speed — `fliesWithoutFallingOn` is the
   * reader, and the pair it reads is the pair `OtherSpeeds` already prints:
   * a creature that cannot fly cannot hover either.
   */
  readonly hover?: true;
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
 * What an ongoing effect has done to **one weapon**, read again on every later
 * attack made with it.
 *
 * The fourteenth sourced grant and the other half of the sixth's family.
 * {@link GrantedAttackRider} above hangs a notation and a damage type on the
 * *attacker* and adds a component of its own; this changes the arithmetic of a
 * particular object — SRD Shillelagh's substituted ability and replaced die,
 * SRD Magic Weapon's flat plus of the weapon's own type.
 *
 * **Keyed on the weapon's catalogue id, which is the thing neither existing
 * narrowing could say.** `StandingGrant.onlyWithItem` is keyed on the id of
 * the item that *granted* the benefit — a Weapon, +1 confining its plus to
 * itself — and no item granted this. `WeaponNarrowing` describes a *kind* of
 * weapon, so it would imbue every Quarterstaff in the pack at once. The SRD
 * writes "**that** weapon", and that is one id.
 *
 * **What the id can and cannot tell apart**, written down rather than
 * discovered: two Quarterstaves in one pack are one id, so a casting aimed at
 * either reaches both. Nothing in the engine can say otherwise today — an
 * attack names its weapon by catalogue id and `InventoryLine.instance` never
 * reaches the swing — and the alternative was a grant keyed on a fact no
 * attack carries, which would have reached no swing at all.
 *
 * **Held by whoever swings**, like the rider above it, and hung on the
 * creature the casting *touched*: Shillelagh is Range: Self and the two are
 * the same creature, and Magic Weapon is Range: Touch and they need not be.
 *
 * Ended by the casting in its `source` exactly as the other thirteen are, so
 * `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration and
 * the deadline all reach it through the door that already existed.
 */
export interface GrantedWeaponRider {
  /** The casting (`Shillelagh#cast:1`) that imbued it. */
  readonly source: string;
  /** The weapon, by catalogue id: the one the casting was aimed at. */
  readonly weapon: string;
  /** SRD Shillelagh's "the attack and damage rolls of **melee** attacks". */
  readonly meleeOnly?: true;
  /** SRD Magic Weapon's plus, pinned at the slot it was cast with. */
  readonly bonus?: number;
  /** SRD Shillelagh's die, pinned at the caster's level. */
  readonly die?: string;
  /** SRD Shillelagh's offered ability, resolved to the caster's own. */
  readonly ability?: Ability;
}

/**
 * The weapon riders on this creature that have something to say about a swing
 * with **this** weapon.
 *
 * One gatherer, three readers — the flat bonus on the attack roll
 * ({@link standingBonuses}), the same bonus on the damage roll
 * ({@link standingAttackDamage}), and the die and ability
 * ({@link strikeStyleFor}). Emptying it fails a test of each, which is the
 * evidence it is one question asked in three places rather than three
 * questions spelled alike.
 *
 * **Matched off the weapon record the swing resolved**, never off a caller's
 * `withItem`: the record is what a Versatile die and a reach are already read
 * from, and a swing with no weapon at all — an Unarmed Strike, a spell attack
 * — is a swing with no imbued object in it.
 */
export function weaponRidersFor(
  creature: CreatureState | undefined,
  weapon: Weapon | null,
): readonly GrantedWeaponRider[] {
  if (creature === undefined || weapon === null) return [];
  return creature.weaponRiders.filter((rider) => {
    if (rider.weapon !== weapon.id) return false;
    // SRD Shillelagh: "melee attacks using that weapon". A Dagger thrown is a
    // ranged attack with a melee weapon, and the sentence does not reach it —
    // but nothing here knows whether it was thrown, so the weapon's own kind
    // is what is asked. The narrower fact lives on `AttackOptions.thrown` and
    // reaches neither of this function's three readers.
    if (rider.meleeOnly === true && weapon.kind !== 'melee') return false;
    return true;
  });
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
 * What every persistent area this creature is standing in is doing to it.
 *
 * The casting's half of {@link standingFor}, and the same discipline: a
 * casting's area reaches whoever the geometry catches *right now*, so it is
 * asked of the scene on every read and stored on nobody. See
 * {@link AreaStanding} for why a stored copy would be two facts that can
 * disagree.
 *
 * Read in casting-id order, which is the order `Object.keys` gives a record
 * the fold sorts, so two readers of one state agree. Nothing here depends on
 * the order today — halving is presence and a flat change is addition — and it
 * is fixed anyway, because a reader that reports *which* casting is slowing a
 * creature would.
 *
 * Empty when there is no scene: where a creature is standing has no right
 * answer until somebody says, and inventing one to halve a Speed is the wrong
 * direction to guess in — the reading an aura already takes for an unplaced
 * creature.
 */
function areaStandingOn(state: GameState, who: CharacterId): readonly AreaStanding[] {
  const scene = state.scene;
  if (scene === null) return [];

  const found: AreaStanding[] = [];
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record?.areaStanding === undefined) continue;
    const inside = creaturesStandingInCastingArea(scene, record);
    if (inside === null || !inside.has(who)) continue;
    found.push(record.areaStanding);
  }
  return found;
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
 * **An area a spell filled moves a Speed through here too, and is the one
 * input that is neither on the sheet nor on the creature.** SRD Spirit
 * Guardians halves a Speed *in the Emanation*, and which creatures that is
 * changes every time anybody walks — so it is derived from the scene on every
 * read rather than granted and released. See {@link areaStandingOn}, and
 * {@link AreaStanding} for why the pair of events the other spelling would
 * need is the wrong shape.
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
 *
 * **And it answers for a mode.** SRD prints five Speeds; this reader held one,
 * so a Cockatrice's Fly Speed of 40 had nowhere to be asked for and every
 * caller measuring a flight got a walk. `mode` defaults to `'walk'`, which is
 * every existing caller and every rule that says "your Speed" without
 * qualifying it. What differs between the modes is written inside, in one
 * place, for the reason the whole function exists.
 */
export function speedOf(
  state: GameState,
  who: CharacterId,
  mode: MovementMode = 'walk',
): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 0;

  // **The walking Speed is the pinned one; the other four are the sheet's.**
  // `Combatant.speed` is what the fight began with and it is a walking Speed —
  // `startCombat` is handed `sheet.baseSpeed` — so reading it for a Fly Speed
  // would measure a flight against a walk.
  const walking =
    state.combat?.order.find((c) => c.id === who)?.speed ?? creature.sheet.baseSpeed;

  // **A mode nothing gives this creature is 0, and stays 0 through everything
  // below**: nothing adds a Fly Speed to a creature that has none, and
  // {@link hasSpeedInModeOn} is the question a rule asks when it needs to tell
  // "cannot" from "stopped". It is the *state-level* question now, because a
  // casting can hand one over — a Spider Climb's Climb Speed is not on the
  // sheet and the sheet is not where it belongs.
  if (mode !== 'walk' && !hasSpeedInModeOn(state, who, mode)) return 0;

  // A `match-walk` grant supplies the base rather than adding to it, and the
  // base it supplies is the **walking** one before anything has happened to
  // it: see {@link SpeedChange}, where the alternative halves a Slowed
  // spider's climb twice.
  const matched = matchesWalkingSpeed(state, who, creature, mode);
  const base = mode === 'walk' ? walking : Math.max(speedInMode(creature.sheet, mode), matched ? walking : 0);

  // **Feet reach the mode they were granted in; an unqualified increase
  // reaches walking alone and an unqualified reduction reaches every mode.**
  // Judged grant by grant rather than netted afterwards, which is what the
  // sign split here is for: a Longstrider and a Ray of Frost on one creature
  // are two sentences, and cancelling them into a net of zero would quietly
  // hand a flier back the ten feet the ice took. See the note below the loops
  // for the ruling the sign carries.
  let flat = 0;
  const flattenInMode = (granted: {
    readonly feet?: number;
    readonly mode?: MovementMode;
  }): void => {
    const feet = granted.feet ?? 0;
    if ((granted.mode ?? 'walk') === mode) flat += feet;
    else if (granted.mode === undefined && feet < 0) flat += feet;
  };

  for (const effect of creature.sheet.standing ?? []) {
    if (effect.grant.kind !== 'speed') continue;
    if ((effect.grant.change ?? 'add') !== 'add') continue;
    if (!meetsRequirements(state, who, effect)) continue;
    flattenInMode(effect.grant);
  }

  let halvings = 0;
  let zeroed = false;
  for (const granted of creature.speedModifiers) {
    if (granted.change === 'add') flattenInMode(granted);
    else if (granted.change === 'halve') halvings += 1;
    else if (granted.change === 'zero') zeroed = true;
  }

  // An area carries no mode — SRD Spirit Guardians halves a Speed rather than
  // granting one — so its flat changes are read exactly as an unqualified
  // grant's are.
  //
  // **Each member is named**, which is the loop above's discipline and is why
  // it has it. `AreaStanding.change` used to be {@link SpeedChange} whole, so
  // widening that union for "a Climb Speed equal to its Speed" widened this
  // field with it and a trailing `else` here read the new member as a Speed of
  // 0. The type is narrowed now, so nothing typed can arrive; naming the
  // members is what makes a *later* widening ignore what it cannot compute
  // rather than zero somebody's Speed.
  for (const standing of areaStandingOn(state, who)) {
    if (standing.change === 'add') flattenInMode({ feet: standing.feet ?? 0 });
    else if (standing.change === 'halve') halvings += 1;
    else if (standing.change === 'zero') zeroed = true;
  }

  // **An increase is the walking Speed's; everything that takes Speed away is
  // every mode's.** SRD writes "your Speed" unqualified for the walking one —
  // Longstrider's ten feet and a Barbarian's Fast Movement are both that
  // sentence — so adding them to a Fly Speed would be reading a rule the book
  // does not print. Slowing is the other way round, and all four spellings of
  // it agree: Grappled's "Speed is 0", Slow's halving, Exhaustion's five feet
  // a level and Ray of Frost's flat ten are about the creature rather than
  // about a mode. A Restrained Cockatrice does not fly away at half speed,
  // and a Specter iced by Ray of Frost does not fly away at full.
  //
  // So the flat accumulator is split by sign rather than by source, which is
  // the only line here that is a ruling rather than a transcription: the book
  // prints no sentence reducing one mode and not another, and the alternative
  // — reductions that miss every mode but walking — leaves a creature whose
  // Speed is *mostly* a Fly Speed untouched by half the rules that slow
  // anybody. Exhaustion already behaved this way through `conditionSpeed`,
  // and this is the rest of the family joining it rather than an exception
  // being carved.
  //
  // What a *mode-named* grant does is not that ruling and needs none: SRD Fly
  // prints "a Fly Speed of 60 feet", so the feet go where the sentence says
  // and nowhere else.
  return combineSpeed(base, flat, halvings, zeroed, creature.conditions);
}

/**
 * Whether any grant on this creature says its Speed in a mode is its walking
 * Speed.
 *
 * Both doors at once, because SRD writes one sentence and two catalogues
 * carry it: Spider Climb's casting is a stored {@link GrantedSpeed} and
 * Second-Story Work's is a derived {@link StandingGrant}, and a reader that
 * knew only one of them would be right about half the book.
 */
function matchesWalkingSpeed(
  state: GameState,
  who: CharacterId,
  creature: CreatureState,
  mode: MovementMode,
): boolean {
  if (mode === 'walk') return false;
  if (creature.speedModifiers.some((g) => g.change === 'match-walk' && g.mode === mode)) {
    return true;
  }
  return (creature.sheet.standing ?? []).some(
    (effect) =>
      effect.grant.kind === 'speed' &&
      effect.grant.change === 'match-walk' &&
      effect.grant.mode === mode &&
      meetsRequirements(state, who, effect),
  );
}

/**
 * Whether this creature has a Speed of this kind **at all**, granted or
 * printed.
 *
 * {@link hasSpeedInMode} is the sheet-level question and it is still the right
 * one where the sheet is the whole answer — `adaptMonster` puts a Cockatrice's
 * Fly Speed there. This is the state-level sibling the reader half asked for
 * when it wrote "a spell cannot grant a mode yet": once one can, "has a Climb
 * Speed" is a fact about the creature *and everything currently on it*, and a
 * rule that asked the sheet would charge a Spider Climb's target the climbing
 * surcharge for a Speed it had just been given.
 *
 * **Having and having any left are still two questions**, which is the whole
 * reason the sheet-level one exists: a Restrained fish has a Swim Speed of 0
 * without having stopped being a fish, and a Grappled spider under Spider
 * Climb has a Climb Speed of 0 without the casting having ended. So this asks
 * what grants *say*, never what {@link speedOf} computes — a zeroing
 * condition does not take a mode away, it stops it.
 */
export function hasSpeedInModeOn(state: GameState, who: CharacterId, mode: MovementMode): boolean {
  if (mode === 'walk') return true;
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (hasSpeedInMode(creature.sheet, mode)) return true;
  if (matchesWalkingSpeed(state, who, creature, mode)) return true;

  if (creature.speedModifiers.some((g) => g.change === 'add' && g.mode === mode && (g.feet ?? 0) > 0)) {
    return true;
  }
  return (creature.sheet.standing ?? []).some(
    (effect) =>
      effect.grant.kind === 'speed' &&
      (effect.grant.change ?? 'add') === 'add' &&
      effect.grant.mode === mode &&
      (effect.grant.feet ?? 0) > 0 &&
      meetsRequirements(state, who, effect),
  );
}

/**
 * SRD "Flying": "the creature falls unless it has the Hover trait", asked of
 * the creature rather than of its sheet.
 *
 * {@link fliesWithoutFalling}'s state-level sibling, and it exists for the
 * same reason {@link hasSpeedInModeOn} does: SRD Fly hands over a Fly Speed
 * **and** the hovering in one sentence, and neither half is on the sheet. A
 * printed Hover and a granted one are the same trait, so either answers.
 */
export function fliesWithoutFallingOn(state: GameState, who: CharacterId): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (!hasSpeedInModeOn(state, who, 'fly')) return false;
  if (creature.sheet.speeds?.hover === true) return true;
  return creature.speedModifiers.some((g) => g.hover === true && g.mode === 'fly');
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

/** The casting a `casting-damage` grant is being asked about. */
export interface CastingDamageQuery {
  /** The definition's own id, for the feature that names one spell. */
  readonly spell: string;
  readonly school: string;
  /** The class the route went through; null for a feat's grant or an item's. */
  readonly classId: string | null;
  /** Every damage type this casting deals, as the definition and the cast leave it. */
  readonly damageTypes: readonly string[];
  /** The slot's level, and `0` for a cantrip. */
  readonly slotLevel: number;
  /** The features the caster elected on this casting — see `optional`. */
  readonly using: readonly string[];
}

/** One feature reaching into this casting, with the name the log reads it under. */
export interface CastingDamageFeature {
  readonly feature: string;
  readonly name: string;
  readonly when: CastingDamageWhen;
  readonly alters: CastingDamageAlteration;
  readonly costs?: CastingDamageCost;
}

/**
 * Whether one `casting-damage` grant reaches this casting.
 *
 * Every clause is a narrowing and an absent one asks nothing. Kept apart from
 * the gatherer so the rule can be read as five lines rather than found inside a
 * loop — the shape `standingAttackDamage`'s qualifications wear.
 */
function castingReached(when: CastingDamageWhen, query: CastingDamageQuery): boolean {
  if (when.spell !== undefined && when.spell !== query.spell) return false;
  if (when.school !== undefined && when.school !== query.school) return false;
  if (when.classId !== undefined && when.classId !== query.classId) return false;
  if (when.dealsDamage === true && query.damageTypes.length === 0) return false;
  if (
    when.damageTypes !== undefined &&
    !when.damageTypes.some((type) => query.damageTypes.includes(type))
  ) {
    return false;
  }
  if (
    when.slotLevels !== undefined &&
    (query.slotLevel < when.slotLevels.from || query.slotLevel > when.slotLevels.to)
  ) {
    return false;
  }
  return true;
}

/**
 * The caster's features that reach this casting's damage.
 *
 * Asked of the **caster**, which is what makes it the offensive twin of
 * {@link evadesHalfDamage}: the Evoker deciding a cantrip still stings is the
 * one casting it. Derived from standing effects on every read, so a feature
 * suppressed by its own requirement reaches nothing — and an optional one that
 * the caster did not name on this casting reaches nothing either, which is how
 * SRD's "you can" is declined.
 */
export function castingDamageFeatures(
  state: GameState,
  who: CharacterId,
  query: CastingDamageQuery,
): readonly CastingDamageFeature[] {
  const found: CastingDamageFeature[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-damage') continue;
    if (grant.optional === true && !query.using.includes(effect.feature)) continue;
    if (!castingReached(grant.when, query)) continue;
    found.push({
      feature: effect.feature,
      name: effect.name,
      when: grant.when,
      alters: grant.alters,
      ...(grant.costs === undefined ? {} : { costs: grant.costs }),
    });
  }
  return found;
}

/** The casting a `casting-healing` grant is being asked about. */
export interface CastingHealingQuery {
  /**
   * The level of the slot that paid for this casting, or **null** where none
   * did.
   *
   * Null rather than zero, because a cantrip and an item's casting are two
   * different things a level of `0` would spell alike, and the clause this
   * answers is about whether a slot went at all.
   */
  readonly slotLevel: number | null;
}

/**
 * What the caster's features add to the hit points this casting restores.
 *
 * {@link castingDamageFeatures}' twin, and the shape of its answer is a list
 * of named bonuses rather than a single number because two features adding to
 * one casting both land and the log names each — the reading every other
 * gatherer in this file takes.
 *
 * Asked of the **caster** and derived on every read, so a feature suppressed
 * by its own requirement adds nothing. Nothing here is per-target: the same
 * answer reaches every creature the casting heals, which is what SRD's "to a
 * creature ... that creature regains" says when a spell heals several.
 */
export function castingHealingBonus(
  state: GameState,
  who: CharacterId,
  query: CastingHealingQuery,
): readonly Bonus[] {
  const found: Bonus[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-healing') continue;
    if (grant.when.withSlot === true && query.slotLevel === null) continue;

    const flat =
      grant.alters.flat +
      (grant.alters.plusSlotLevel === true ? (query.slotLevel ?? 0) : 0);
    if (flat === 0) continue;
    found.push({ source: effect.name, flat });
  }
  return found;
}

/**
 * Every `casting-damage` feature this creature holds that the caller may elect,
 * whether or not it reaches any particular casting.
 *
 * What a refusal needs: a caller who names a feature this creature has not got
 * is told so, and one who names a feature that simply does not reach the spell
 * they are casting is not refused at all — the grant is a narrowing and casting
 * outside it is legal. The same three-valued discipline every stated fact takes.
 */
export function electableCastingDamage(
  state: GameState,
  who: CharacterId,
): readonly string[] {
  return standingFor(state, who)
    .filter(({ effect }) => effect.grant.kind === 'casting-damage' && effect.grant.optional === true)
    .map(({ effect }) => effect.feature);
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

  // **And the damage half of the imbued weapon's plus.** SRD Magic Weapon's +1
  // is of the weapon's **own** type — a Mace under it deals 7 Bludgeoning, not
  // 6 Bludgeoning and 1 of something else — so it is a `bonus` and not one of
  // the typed components beside it. The attack half is `standingBonuses`.
  bonuses.push(...weaponRiderBonuses(state.creatures[who], context.weapon));

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

  const effective = withoutConditions(creature.conditions, suppressedConditions(state, who));
  // **The benefits something has taken away, gathered here and nowhere else.**
  // SRD Starry Wisp's "can't benefit from the Invisible condition" is not the
  // condition being suppressed and not the condition ending — the creature is
  // still Invisible, and only the readers that hand a condition something good
  // are meant to notice. This is the door every one of those readers already
  // goes through, so a new one asks the question by construction rather than
  // by remembering to; `benefitsFrom` is what they ask.
  const denied = deniedBenefitsOf(creature.deniedBenefits);
  return denied.length === 0 ? effective : { ...effective, withoutBenefit: denied };
}
