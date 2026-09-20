import {
  err,
  ok,
  type Ability,
  type ConditionName,
  type Result,
  type Skill,
} from '@ie/shared';
import type { WeaponMastery } from '@ie/srd';
import type { WeaponSelector } from './attack.js';
import type { ArmorTraining } from './character.js';
import type { TurnAnchor } from './time.js';
import type { EffectEndCause } from './timers.js';
import type { D20TestKind } from './checks.js';
import type { ReactionReach } from './reactions.js';
import type { Recovery } from './resources.js';
import type { SpellArea, SpellEffect } from './spell-definitions.js';
import type { ActivationEnd, StandingGrant, StandingRequirement } from './standing.js';

/**
 * Class progression: what a class gives you, and when.
 *
 * Three jobs live near each other in D&D and are kept apart here, because
 * conflating them is how a character sheet ends up claiming abilities that
 * nothing honours:
 *
 * | | |
 * |---|---|
 * | **Progression** (this file) | What a level grants. Pure data and lookups; knows nothing about any character |
 * | **Creation** (`creation.ts`) | Turning choices into a character, validated |
 * | **Execution** (everywhere else) | Actually doing what a feature does |
 *
 * A feature therefore says which of those last two owns it. `engine` means the
 * engine applies its mechanical effect; `manual` means the feature is recorded
 * and the DM applies it, and the note says exactly what is missing. There is no
 * third state where the engine half-does something.
 *
 * The tables here are transcribed from the SRD by hand rather than parsed,
 * because `classes.md` has no parser yet. Transcription is a place typos hide,
 * so the tests assert relationships and not just presence — a Proficiency
 * Bonus that disagrees with the formula fails loudly.
 */

export const MAX_LEVEL = 20;

/** SRD Character Advancement: experience points needed for each level. */
export const XP_THRESHOLDS: readonly number[] = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000, 100_000, 120_000,
  140_000, 165_000, 195_000, 225_000, 265_000, 305_000, 355_000,
];

export function levelForXp(xp: number): number {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new Error(`experience is a non-negative whole number of points, got ${xp}`);
  }
  let level = 1;
  for (let index = 0; index < XP_THRESHOLDS.length; index += 1) {
    if (xp >= (XP_THRESHOLDS[index] ?? Infinity)) level = index + 1;
  }
  return level;
}

/** What a feature asks the player to decide, when it asks anything. */
export type FeatureChoice =
  | { readonly kind: 'skill'; readonly choose: number; readonly from?: readonly Skill[] }
  | {
      readonly kind: 'spell';
      readonly choose: number;
      readonly school?: string;
      readonly maxLevel?: number;
    }
  /**
   * One of a named set the feature itself lists.
   *
   * SRD Divine Order offers Protector or Thaumaturge; Fighting Style, Manoeuvres
   * and Metamagic are all the same shape. Modelling it as a feat was wrong in
   * a way that showed immediately: there is no Protector feat, so the feat
   * category check refused a legal character.
   */
  | { readonly kind: 'option'; readonly choose: number; readonly from: readonly string[] }
  | { readonly kind: 'subclass'; readonly choose: 1 }
  | { readonly kind: 'feat'; readonly choose: number; readonly category?: string }
  /**
   * Points of ability score, spread the way the sentence that grants them
   * spreads them.
   *
   * The **Ability Score Improvement feat**: "Increase one ability score of
   * your choice by 2, or increase two ability scores of your choice by 1."
   * Every Epic Boon feat: "Increase one ability score of your choice by 1, to
   * a maximum of 30." Both are printed on a *feat*, and the class feature at
   * level 4 or 19 only grants one — which is why no SRD class feature carries
   * this member and the two that raise scores on the feature itself, the
   * level 20 capstones, name their scores outright with an
   * `ability-score-increase` grant instead.
   *
   * **So the SRD's own user of this member is on the feat**, not here:
   * `FeatRequirement`'s `ability-score` member is the same sentence in the
   * same units, read by the same checker and paid out by the same
   * arithmetic. What keeps this member is homebrew — a class that writes the
   * points onto the feature, which the vocabulary should be able to say even
   * though the book does not — and it is held to the standard this repository
   * holds new vocabulary to: a reader, a validator that refuses eight
   * malformed shapes by name, and a homebrew class driving it through
   * `loadContent`.
   *
   * **Answered one ability per point.** `featureChoices` is a list of strings
   * and a point is the unit the sentence counts in, so `['str', 'str']` is
   * the first branch and `['str', 'dex']` the second. The spread a player took
   * is therefore *counted out of their answer* rather than declared beside it,
   * and there is no second field for the two to disagree through.
   *
   * **`orFeat` was here and is gone.** It said "these points, or a feat
   * instead", written when the level 4 feature was read as offering the fork.
   * The book does not: the class feature grants a feat and the feat carries
   * the points, so the fork the SRD prints is between two *feats* and
   * `kind: 'feat'` already says it. It had no writer the day it was added,
   * the Ability Score Improvement feat gave it none, and it cost three
   * branches of creation — `offersOne` in `checkFeats`, the category read off
   * it, and the both-and-neither pair in `checkAbilityChoice` — that no
   * catalogue could reach. A member no content writes is a guess dressed up
   * as a structure; a homebrew class wanting the fork writes two features or
   * `kind: 'feat'`.
   */
  | {
      readonly kind: 'ability-score';
      /**
       * The branches the sentence prints, each as the points it puts into
       * that many distinct scores: `[[2], [1, 1]]` is the Improvement's own
       * sentence and `[[1]]` is an Epic Boon's.
       *
       * A list of branches rather than a total with a cap per score, because
       * two numbers would *cover* the SRD's sentence instead of saying it:
       * they admit spreads no book prints, and a feature offering three of
       * four possible splits could not be written at all.
       * `checkFeatureDefinition` holds every branch to the same total, because
       * the length of a legal answer is read from it.
       */
      readonly spreads: readonly (readonly number[])[];
    }
  /**
   * Kinds of weapon, for a feature that unlocks their mastery properties.
   *
   * SRD Weapon Mastery, on five classes, and the **first choice whose count is
   * not a fixed number**: the Barbarian's and the Fighter's are columns of
   * their class tables — three kinds at Fighter 1 and six at 16 — while the
   * Paladin, the Ranger and the Rogue print a flat two. So `chooseByLevel`
   * stands beside `choose` exactly as `usesByLevel` stands beside a pool's
   * other sizings, and the level it is read at is the level of the class that
   * granted the feature rather than the character's.
   *
   * It is on this member rather than on every member because no other choice
   * the SRD prints varies: a class that wanted a second skill at level 6
   * prints a second feature, and this is the one sentence that says "as shown
   * in the ... column of the ... Features table".
   *
   * **Proficiency is a rule of the choice and not of the feature.** Three of
   * the five classes print "with which you have proficiency" and the other two
   * are proficient with everything their sentence offers, so the narrowing is
   * checked for all five and says the same thing about each.
   */
  | {
      readonly kind: 'weapon';
      /** The count where the book prints one: "two kinds of weapons". */
      readonly choose?: number;
      /** The count where the book prints a column instead. Exactly one of the two. */
      readonly chooseByLevel?: readonly number[];
      /**
       * SRD Barbarian: "Simple or Martial **Melee** weapons", which is the one
       * class whose sentence narrows what may be picked.
       */
      readonly melee?: true;
    };

/**
 * What one option of a feature's choice *means* to whatever is written in
 * terms of it.
 *
 * The other half of a table the SRD prints beside a choice: one column is the
 * options the player picks from, and the rest of the row is what the picked
 * one supplies to the traits written as "determined by" it — an ancestry and
 * the damage type that goes with it. Without this the second column could not
 * be transcribed at all, because nothing could read it, and a table with no
 * reader is worse than an absent one.
 *
 * **Every field is optional and the reader is the judge.** A meaning carrying
 * nothing this engine knows is data written against a later one rather than
 * data that is wrong — the rule the feature validator already follows for an
 * unknown field. What refuses it is the grant that came to read something
 * specific and found nothing, which `checkContent` asks because only it can
 * see both halves.
 */
export interface FeatureOptionMeaning {
  /** The damage types this option supplies to a grant that reads them. */
  readonly damageTypes?: readonly string[];
}

export interface FeatureDefinition {
  /** Namespaced and stable: `wizard:arcane-recovery`. */
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /**
   * `engine` — the engine applies the mechanical effect.
   * `manual` — recorded only; `note` says what a DM still has to do.
   */
  readonly automation: 'engine' | 'manual';
  readonly note: string;
  /** What the player must decide when they gain it. */
  readonly choice?: FeatureChoice;
  /**
   * What each option of that choice means to the features written in terms of
   * it — see {@link FeatureOptionMeaning}.
   *
   * Keyed by the option exactly as the choice offers it, and the validator
   * holds the keys to *exactly* the options: a table missing one would leave a
   * legal character with a benefit that silently did nothing, and a table with
   * a key nobody can choose is a row of a different book.
   */
  readonly optionMeans?: Readonly<Record<string, FeatureOptionMeaning>>;
  /** Set on the feature that opens a subclass, so creation knows to ask. */
  readonly grantsSubclass?: boolean;
  /**
   * A feat this feature grants outright, rather than offering a choice of.
   *
   * A background's Origin feat is named by the background — Sage gives Magic
   * Initiate (Wizard) and nothing else — but the feat's own choices are still
   * the player's. `spellList` pins the half the background already decided.
   */
  readonly grantsFeat?: { readonly featId: string; readonly spellList?: string };
  /**
   * What the engine does with the choice this feature asked for.
   *
   * Creation used to find these two features by **id** — `wizard:scholar` for
   * Expertise, `evoker:evocation-savant` for free spells — which worked for
   * exactly one class and would have needed a new string match for every class
   * after it. A feature says what kind of thing it grants, and creation looks
   * for the kind.
   */
  readonly grants?: FeatureGrant;
  /**
   * The feature whose declaration executes this one, when this one declares
   * nothing of its own.
   *
   * SRD Improved Blessed Strikes: "The extra damage of your Divine Strike
   * increases to 2d8." An "Improved X" that only raises a number is a step in
   * the first feature's table — Blessed Strikes carries the `diceCountByLevel`
   * column and the engine reads it at the class's own level — so this feature
   * is the level at which that table steps and has no effect of its own to
   * declare. Naming the feature that does is what lets it honestly claim
   * `automation: 'engine'`; the content validator holds the name to a feature
   * on the same source that declares something a reader reads.
   */
  readonly executedBy?: string;
}

/**
 * Hit points a feature gives its holder, as the class text writes the sum.
 *
 * Three features say it — Second Wind, Wholeness of Body and Uncanny
 * Metabolism — and between them they name a printed die and a class-table
 * column, a class level and an ability modifier, and one floor.
 */
export interface HealGrant {
  /** SRD Second Wind: a printed "1d10". */
  readonly dice?: string;
  /** SRD Wholeness of Body: "your Martial Arts die" — a class-table column. */
  readonly diceByLevel?: readonly string[];
  /** SRD: "plus your Fighter level" or "plus your Wisdom modifier". */
  readonly plus: 'class-level' | Ability;
  /** SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". */
  readonly minimum?: number;
}

/**
 * How the log names a feature, wherever a feature is what something came from.
 *
 * `itemSource`'s twin, written once for the same reason: a feature's effect
 * list files everything it hangs under this, so `releaseGrants`,
 * `removeBonusFrom` and `endTimedCondition` can take it off again by name.
 *
 * **Deliberately not a casting source.** `castingSource` writes
 * `Hold Person#cast:3` and `castingIdOf` reads the id back out; this writes
 * `feature:cleric-ish-id`, which `castingIdOf` answers null for — so
 * `releaseCasting`, `ongoingSpellsOn`, `spellOn` and the Dispel resolver pass
 * over what a feature hung by construction rather than by being told about it.
 */
export const featureSource = (featureId: string): string => `feature:${featureId}`;

/**
 * How the log names a feature **somebody else's holder** is carrying.
 *
 * {@link featureSource} with the giver in it, because the source is the
 * identity a re-grant replaces on: two Bards inspiring the same ally are two
 * grants and one Bard inspiring them twice is one, which is the rule every
 * sourced family already keeps and the only question the giver's name settles.
 * It ends the same way as any other — `releaseGrants` matches the whole string
 * — and `castingIdOf` answers null for it, as it does for the bare form.
 */
export const conferredSource = (featureId: string, from: string): string =>
  `${featureSource(featureId)}@${from}`;

/**
 * One thing a use of a pool buys, where what it buys is an effect list.
 *
 * SRD Channel Divinity is the shape this is built to: one feature, one pool,
 * and a named menu the holder picks from at the moment of use — "Turn Undead",
 * "Divine Spark". Each option prints its own action, its own reach or area and
 * its own effects, and every one of them costs the same single use.
 *
 * **The effects are the engine's existing vocabulary and nothing else.** Turn
 * Undead is a Wisdom `save` with two conditions on one failure, an emanation,
 * a creature-type filter and a minute on the clock — four things the engine
 * already did for a spell. An option that needs a new effect kind is engine
 * work exactly as a spell that needs one is.
 */
export interface PoolOptionGrant {
  /** The option's own id, named by the caller who spends the use. */
  readonly id: string;
  /** What the log calls it — SRD's "Turn Undead". */
  readonly name: string;
  /** What using it costs in the action economy; outside combat, nothing. */
  readonly action: 'action' | 'bonus-action';
  readonly effects: readonly SpellEffect[];
  /**
   * The area it fills, for an option that catches whoever is standing in one.
   *
   * SRD Turn Undead: "Each Undead of your choice within 30 feet of you".
   * Beside
   * {@link reach} and never with it — an option catches an area or is aimed at
   * a creature, and one that said both would take a target list it then
   * ignored.
   */
  readonly area?: SpellArea;
  /**
   * How far it reaches, for an option aimed at one creature.
   *
   * SRD Divine Spark: "you point your Holy Symbol at another creature you can
   * see within 30 feet of yourself". Absent means the holder themselves, which
   * is the only target an option with neither field can have.
   */
  readonly reach?: number;
  /**
   * The one creature type an **area** option touches — SRD's "Each Undead of
   * your choice".
   *
   * A filter and not a refusal: the living thug standing in the same thirty
   * feet is left alone rather than making the use illegal, which is the
   * reading `areaTargets` already takes for "each Humanoid in the area".
   */
  readonly mustBeType?: string;
  /**
   * How long what it hangs lasts, in seconds — SRD Turn Undead's "1 minute".
   *
   * Required exactly when one of the effects hangs something on somebody and
   * refused when none does, which is the rule an item's conferral already
   * keeps: there is no casting for `releaseCasting` to end, so a grant with no
   * deadline would run for ever, and a deadline with nothing to end would file
   * a timer that takes nothing away.
   */
  readonly durationSeconds?: number;
  /** What ends a conferred condition before its span is up. */
  readonly endsEarly?: readonly EffectEndCause[];
  /**
   * How many dice the option's amounts roll, by class level.
   *
   * SRD Divine Spark: "You roll an additional d8 when you reach Cleric levels
   * 7 (2d8), 13 (3d8), and 18 (4d8)." A column of the class table exactly as
   * Sneak Attack's dice are, so the die
   * size stays on the effect and only the count is read at that class's own
   * level — `diceCountByLevel` on a standing grant, asked of a second host.
   *
   * **A class table rather than a `DiceScaling` field**, because every one of
   * those reads a slot level or a caster level and a feature has neither.
   */
  readonly diceCountByLevel?: readonly number[];
  /**
   * Damage types the option prints and the **caller** chooses between.
   *
   * SRD Divine Spark: "the creature takes Necrotic or Radiant damage (your
   * choice)". `SpellDefinition.damageTypeStated` word for word, on a host that
   * is not a definition — a list printed here, one value named at the use and
   * refused if it is not on the list.
   */
  readonly damageTypeStated?: readonly string[];
}

/**
 * The mechanical shapes a feature's choice can take.
 *
 * Deliberately few. A feature whose effect does not fit one of these is
 * `automation: 'manual'` with a note saying what a DM still has to do, which
 * is the honest answer far more often than a new grant kind would be.
 */
export type FeatureGrant =
  /**
   * SRD Expertise: "Choose one of the following skills **in which you have
   * proficiency**", and double the proficiency bonus on it. Wizard's Scholar
   * and Rogue's Expertise are the same feature under two names.
   */
  | { readonly kind: 'expertise' }
  /**
   * What a feature does to an ability score without asking: raise it, lift
   * its ceiling, or both.
   *
   * SRD writes the two as one sentence every time it writes either — Primal
   * Champion's "Your Strength and Constitution scores increase by 4, to a
   * maximum of 25", Body and Mind's the same of Dexterity and Wisdom, an Epic
   * Boon's "Increase one ability score of your choice by 1, to a maximum of
   * 30" — so they are one member rather than two.
   *
   * **The ceiling moves for the scores this feature touches and for no
   * others**, which is the whole of what the member is for.
   * `ABILITY_SCORE_MAXIMUM` in `character.ts` is the rule for every score of
   * every character, and a capstone that lifted it for all six would hand out
   * five more points than the book does. Which scores those are is
   * {@link raises} where the feature names them, and the abilities this
   * feature's own `ability-score` choice named where it asks instead.
   */
  | {
      readonly kind: 'ability-score-increase';
      /**
       * Scores this feature raises outright — SRD Primal Champion.
       *
       * A fixed grant asks the player nothing, exactly as a fixed `spells`
       * grant does, so a feature carrying one carries no `ability-score`
       * choice and `checkContent` refuses a feature that carries both:
       * writing a capstone as a choice with one legal answer would demand the
       * player type back an answer the book already gave.
       */
      readonly raises?: readonly { readonly ability: Ability; readonly points: number }[];
      /** SRD's "to a maximum of 25", for the scores above and for no others. */
      readonly maximum?: number;
    }
  /**
   * Spells the feature adds to what the character can cast, outside the
   * counts the class table prints.
   *
   * Two shapes, and the difference is who decides. The Evoker *chooses* two
   * Evocations and writes them in the book; the Life Domain is *given* Aid,
   * Bless, Cure Wounds and Lesser Restoration and always has them prepared.
   * A fixed grant asks the player nothing, so it carries no `choice` — and
   * modelling it as a choice with one legal answer would demand the player
   * type it back.
   */
  | { readonly kind: 'spells'; readonly fixed?: readonly string[] }
  /**
   * SRD Unarmored Defense and Draconic Resilience: an alternative base Armour
   * Class while unarmoured.
   *
   * A grant rather than a note, because three features want it with three
   * different abilities and two different rules about Shields — which is what
   * makes it a shape rather than one class's quirk. It asks the player
   * nothing, so it carries no `choice`.
   */
  /**
   * A benefit that holds for as long as its rule does — see `standing.ts`.
   *
   * Two shapes in one kind, because SRD writes them as one thing: a feature
   * that puts a benefit into the character's aura, and a feature that only
   * changes how big the aura is. Aura Expansion says nothing but "Your Aura of
   * Protection is now a 30-foot Emanation", and Aura of Courage says nothing
   * about distance at all — it borrows the aura it is spoken of as being
   * inside. Resolving the radius once, at creation, is what keeps the three
   * Paladin auras from disagreeing about their own size.
   */
  | {
      readonly kind: 'standing';
      readonly reach: 'self' | 'aura';
      /**
       * What it does. Empty for a feature that only resizes the aura.
       *
       * A list because SRD writes some of these as one sentence covering two
       * things: Mindless Rage is "Immunity to the Charmed and Frightened
       * conditions", which is two condition immunities and one feature.
       */
      readonly effects?: readonly StandingGrant[];
      /**
       * What the feature's own text says must hold for it to apply.
       *
       * Declared per feature rather than assumed: Danger Sense and the
       * Paladin auras both stop while Incapacitated, and Elemental Affinity
       * says nothing of the kind.
       */
      readonly requires?: readonly StandingRequirement[];
      /** The damage types come from the choice this feature asked for. */
      readonly damageTypesFromChoice?: boolean;
      /**
       * Where that choice was made, when it was not made on this feature.
       *
       * The SRD writes a species as one trait that asks which ancestry,
       * lineage or legacy you have and later traits written as "determined by"
       * it. The choice is one fact and belongs to one feature; a second
       * feature restating it would be the player typing an answer they have
       * already given, and two places to disagree about it.
       *
       * So a grant may name the feature whose choice it reads, and the
       * validator holds the name to a **sibling** — a feature of the same
       * class, subclass, species or background — that asks a choice and does
       * not arrive later than this one. Both things a grant reads off a choice
       * follow it: the damage types above and the option gate below. Absent
       * means this feature's own choice, which is the ordinary case.
       */
      readonly choiceFrom?: string;
      /** SRD Aura Expansion: this feature makes the aura this many feet. */
      readonly auraFeet?: number;
      /**
       * How many dice an `attack-damage` grant rolls, by class level.
       *
       * SRD Sneak Attack is a column of the Rogue table — 1d6 at level 1 and
       * 10d6 at 19 — so the feature cannot name a number any more than Rage
       * Damage can. The die size stays on the grant; only the count is read at
       * the class's own level, exactly as `flatByLevel` and the pool sizes are.
       */
      readonly diceCountByLevel?: readonly number[];
      /**
       * How many feet a `speed` grant adds, by class level.
       *
       * SRD Unarmored Movement is a column of the Monk table — +10 at level 2
       * and +30 at 18 — so the feature cannot name a number any more than
       * Sneak Attack's dice can, and it is read at **that class's own** level.
       * Fast Movement and Roving print a flat 10 and carry none of this.
       */
      readonly feetByLevel?: readonly number[];
      /**
       * The option this effect belongs to, for a feature that offers several.
       *
       * SRD writes "You gain one of the following options of your choice" on
       * Hunter's Prey, Elemental Fury and Blessed Strikes, and only one of the
       * options is this grant. A feature whose chosen option is the other one
       * grants nothing — which is different from granting something inert.
       */
      readonly onlyIfChoice?: string;
    }
  /**
   * A feature the character switches on — see `ActivatedFeature` in
   * `standing.ts`. What it does while it runs is `whileActive`, which becomes
   * ordinary standing effects requiring the feature to be active.
   */
  | {
      readonly kind: 'activated';
      readonly action: 'action' | 'bonus-action' | 'none';
      /** The pool key, or null when it costs no uses. */
      readonly pool: string | null;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      readonly poolLabel?: string;
      readonly recovers?: Recovery;
      /** SRD Rage: "You regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      /**
       * Narrower than the `ActivatedFeature` this becomes, and deliberately:
       * Rage's moment is the only one a written feature has needed, and the
       * other anchor belongs to Dodge, which is an action rather than a grant.
       * Expressed against {@link TurnAnchor} rather than as a bare literal, so
       * widening it to the pair is a word here and not a second vocabulary.
       */
      readonly lasts: Extract<TurnAnchor, 'end-of-next-turn'>;
      readonly capSeconds?: number;
      readonly endsOn?: readonly ActivationEnd[];
      readonly forbidsCasting?: boolean;
      readonly whileActive?: readonly StandingGrant[];
      /**
       * The flat amount a `whileActive` damage grant adds, by class level.
       *
       * SRD Rage Damage is +2 at level 1 and rises twice, so the feature
       * cannot name a number: the number is a column of the class table, read
       * at that class's own level exactly as the pool's size is.
       */
      readonly flatByLevel?: readonly number[];
    }
  /**
   * SRD Extra Attack: "You can attack twice instead of once whenever you take
   * the Attack action."
   *
   * The *total* the Attack action holds, not the increment, because the
   * Fighter's later features restate the total — "three attacks", "four" — and
   * multiclassing takes the highest rather than adding them up.
   */
  | { readonly kind: 'extra-attack'; readonly attacks: number }
  /**
   * A class that changes what one of its own attacks **is**.
   *
   * The attack layer reads a weapon or the fixed Unarmed Strike, and until
   * this member nothing could say that a class changes either — which is why
   * the only class whose *level 1* feature the engine could not execute was
   * the one whose level 1 feature is this.
   *
   * SRD Martial Arts is the one printing, and it wants every field of this at
   * once under a single gate: a set of weapons the class names beside its
   * Unarmed Strike ("Simple Melee weapons; Martial Melee weapons that have the
   * Light property"), a die "in place of the normal damage" of those, an
   * ability offered "instead of your Strength modifier" for the same, and an
   * Unarmed Strike "as a Bonus Action" — all of them held by "while you are
   * unarmed or wielding only Monk weapons and you aren't wearing armor or
   * wielding a Shield".
   *
   * **One grant and not three**, because the book writes one gate over three
   * italicised clauses and a feature carries one grant. Splitting them would
   * need the unbuilt "a feature that carries a second grant" shape to put them
   * back together again, and would spell the same gate out three times.
   *
   * **The weapons are here and not in `weaponProficiencies`**, because the SRD
   * prints two different sets: the Monk's Core Traits table says "Simple
   * weapons and Martial weapons that have the Light property" and Martial Arts
   * says the *Melee* halves of the same two lines. A Monk is proficient with a
   * Light Crossbow and it is not a Monk weapon.
   *
   * What this is **not** is the extra attack inside an Attack action. The
   * Bonus Action strike is paid for out of the Bonus Action the economy
   * already has, and a feature that puts more swings inside one Attack action
   * is `extra-attack` above or the gap `docs/design/characters-and-equipment.md`
   * files beside it.
   */
  | {
      readonly kind: 'strike-style';
      /**
       * The weapons the style covers besides the Unarmed Strike, which it
       * always covers. A list, because the SRD writes a list.
       */
      readonly weapons?: readonly WeaponSelector[];
      /**
       * The die rolled in place of the normal damage, by class level.
       *
       * A column of the class table read at that class's own level, exactly as
       * a pool's size and Rage Damage's bonus are — the feature cannot name a
       * number, because the number changes four times between level 1 and 17.
       */
      readonly dieByLevel?: readonly string[];
      /** The ability offered in place of the attack's own. An offer, not a swap. */
      readonly ability?: Ability;
      /** SRD: "You can make an Unarmed Strike as a Bonus Action." */
      readonly bonusUnarmedStrike?: boolean;
      /** SRD: "while you are unarmed or **wielding only Monk weapons**". */
      readonly whileWieldingOnly?: boolean;
      /** SRD: "and you aren't wearing armor or wielding a Shield" — `unarmored`. */
      readonly requires?: readonly StandingRequirement[];
    }
  /**
   * SRD Improved Critical: "can score a Critical Hit on a roll of 19 or 20".
   *
   * The *threshold* rather than the width, because the Champion's later
   * feature restates it — "on a roll of 18-20" — rather than widening it
   * again, exactly as Extra Attack restates a total.
   */
  | { readonly kind: 'critical-range'; readonly on: number }
  /**
   * SRD Weapon Mastery: "your training with weapons allows you to **use the
   * mastery properties** of ... kinds of weapons of your choice".
   *
   * The grant is the unlocking; the weapons are the feature's `choice`, and
   * the two halves are one feature. What lands on the sheet is a list of
   * catalogue ids, which is a fact about the character rather than a
   * catalogue: the engine reads what the player picked and never a list of its
   * own.
   *
   * **`substitutes` is the other shape.** SRD Tactical Master: "when you
   * attack with a weapon, you can replace its mastery property with Push, Sap,
   * or Slow for that attack" — a later feature widening what an earlier one
   * unlocked, which is the Improved Critical shape and not a second grant. A
   * feature carrying only substitutions asks for no weapons of its own.
   */
  | {
      readonly kind: 'weapon-mastery';
      /** Properties this feature lets the holder swap in, for one attack. */
      readonly substitutes?: readonly WeaponMastery[];
    }
  /**
   * More conditions a healing pool can lift.
   *
   * SRD Restoring Touch: "When you use Lay On Hands on a creature, you can
   * also remove one or more of the following conditions... You must expend 5
   * Hit Points from the healing pool of Lay On Hands for each of these
   * conditions you remove." It widens a feature it does not own, which is the
   * shape Improved Critical already has — a second feature restating the
   * first rather than a second mechanism. What it restates is a list instead
   * of a number, so the lists are unioned where the thresholds were minimised.
   */
  | {
      readonly kind: 'lifts-conditions';
      readonly pool: string;
      readonly conditions: readonly ConditionName[];
    }
  /**
   * SRD Slippery Mind: "You gain proficiency in Wisdom and Charisma saving
   * throws"; Disciplined Survivor: "proficiency in all saving throws".
   *
   * A list rather than a count, and `all` spelled out rather than the six
   * written by hand, because that is how the two features read.
   */
  | { readonly kind: 'save-proficiency'; readonly abilities: readonly Ability[] | 'all' }
  /**
   * The holder adds their Proficiency Bonus to Initiative.
   *
   * SRD Alert prints the benefit under that name — **Initiative Proficiency**:
   * "When you roll Initiative, you can add your Proficiency Bonus to the
   * roll." Named for the rule rather than for the feat that has it, exactly as
   * `evasion` next door is named for the rule two classes share, and carrying
   * no fields for the same reason: there is nothing about it to vary.
   *
   * **It exists because the engine used to pay it out itself.** `creation.ts`
   * compared a chosen feat's id against a literal, which is inviolable rule 4
   * broken mechanically: a catalogue without that feat lost the rule, and a
   * catalogue that spelled it differently never got it. A feat declares this
   * instead, and creation reads the declaration.
   *
   * **A number rather than a mode**, and the distinction is the SRD's own.
   * Feral Instinct's "Advantage on Initiative rolls" is a `standing`
   * `roll-mode` on the `initiative` family and already works; this is
   * arithmetic, and it is the Proficiency Bonus rather than a printed figure,
   * which is why `flat-bonus` cannot say it — that member carries a number the
   * item printed, and this one is read off the character's own level.
   */
  | { readonly kind: 'initiative-proficiency' }
  /**
   * A named resource the feature *is*, rather than one it spends.
   *
   * Nine features were marked as executed on the strength of a note saying
   * "declared as a pool", and no pool was ever declared: Bardic Inspiration,
   * both Channel Divinities, Wild Shape, Second Wind, Action Surge, Monk's
   * Focus, Lay On Hands and Sorcery Points. The `activated` grant beside this
   * one already declares a pool, but only for a feature that is switched *on*
   * and grants standing effects while it runs, which none of these is.
   *
   * The SRD sizes a pool three ways and each is here because a feature uses
   * it: a column of the class table (six of the nine), an ability modifier
   * with a floor (Bardic Inspiration: "equal to your Charisma modifier
   * (minimum of once)"), and a multiple of the class level (Lay On Hands:
   * "five times your Paladin level").
   */
  | {
      readonly kind: 'pool';
      readonly key: string;
      readonly label?: string;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      /** SRD Bardic Inspiration: "equal to your Charisma modifier". */
      readonly fromAbilityModifier?: Ability;
      /** The floor that modifier cannot go below: "(minimum of once)". */
      readonly minimum?: number;
      /** SRD Lay On Hands: "five times your Paladin level". */
      readonly perClassLevel?: number;
      /**
       * A flat number of uses — the fourth sizing, and the **item's**.
       *
       * SRD prints a magic item's charges as a number on the item's own line:
       * "This wand has 3 charges." An item has no class level and no ability
       * scores, so the three sizings above have nothing to read, and `minimum`
       * is a floor under a modifier rather than a count. A class feature that
       * named this would be sized by a number `poolSizeOf` never reads, so
       * `checkContent` refuses it there for the same reason it refuses
       * `while-worn` on a feature.
       */
      readonly uses?: number;
      /**
       * The **fifth** sizing, and the item's other one: dice the copy's
       * charge maximum is rolled from, where the book rolls for it rather
       * than printing a number.
       *
       * SRD Necklace of Fireballs: "A necklace has 1d6 + 3 beads". Sovereign
       * Glue: "a container contains 1d6 + 1 ounces". The count is a fact
       * about the copy the party found — this necklace has five beads, that
       * one has eight — so it is rolled once, when the copy is gained, and
       * pinned into the pool the copy is born with; replay reads the log and
       * rerolls nothing.
       *
       * **Beside {@link uses} and never with it**, because two maxima for one
       * pool is a choice nothing could make. `checkContent` refuses both, and
       * refuses a pool that names neither — a rolled maximum is what lets a
       * pool leave `uses` out, and nothing else does.
       *
       * **Item-only, for {@link uses}'s own reason.** A class feature's pool
       * is sized from its class table and no table has ever rolled, so
       * `poolSizeOf` has nothing to read here and `checkContent` refuses it on
       * a feature. It lived on `CatalogueItem` itself until it was moved here:
       * there it escaped the validator entirely, so a malformed one loaded
       * clean and refused later at the award, and one written on an item with
       * no pool was silently inert.
       *
       * Only a door that can roll may hand such a copy over — `awardItems`
       * takes a `Supply` and rolls; `purchaseItem` and `createCharacter`
       * cannot — so a copy gained through one of those is labelled and left
       * unsized, which `expendCharges` refuses out loud rather than guessing.
       */
      readonly usesRolled?: string;
      readonly recovers: Recovery;
      /** SRD: "you regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      /**
       * SRD: "regains 1d3 expended charges daily at dawn" — dice the engine
       * rolls at a declared dawn, rather than a refill. See
       * {@link ResourcePool.regainsAtDawn}.
       */
      readonly regainsAtDawn?: string;
      /**
       * What one use buys, where what it buys is hit points for the holder.
       *
       * Second Wind and Wholeness of Body, which are one sentence apart —
       * "regain Hit Points equal to 1d10 plus your Fighter level" and "roll
       * your Martial Arts die... plus your Wisdom modifier (minimum of 1 Hit
       * Point regained)". Both pools were declared and sized correctly and
       * neither gave back a hit point, because nothing joined a pool to
       * `healCreature`.
       *
       * It hangs off the pool grant rather than standing beside it, because a
       * feature that heals from a pool is not two features: the sizing, the
       * recovery and the Short Rest clause all belong to the pool already, and
       * restating them would be a second place to get the Fighter's table
       * wrong.
       */
      readonly heals?: HealGrant & { readonly action: 'action' | 'bonus-action' };
      /**
       * A pool measured in **hit points**, and what touching somebody spends
       * them on.
       *
       * SRD Lay On Hands, the only pool in the class tables counted in hit
       * points rather than in uses — which the pool system carries without
       * caring, and the spending is the half that had never been wired. The
       * conditions it lifts are a list because a later feature lengthens it;
       * the cost is a number because the SRD prints one and then repeats it.
       */
      readonly touchHeals?: {
        readonly action: 'action' | 'bonus-action';
        /** SRD: "expend 5 Hit Points ... to remove the Poisoned condition". */
        readonly lifts: readonly ConditionName[];
        readonly costPerCondition: number;
      };
      /**
       * What one use buys, where what it buys is an **effect list** — and the
       * several different things the SRD lets one pool buy.
       *
       * The twin of the `heals` field above, one kind of purchase along, and
       * the feature's answer to an item's `confers`. `runEffects` had a
       * casting origin and an item origin and no feature origin, so an effect
       * list was reachable from a spell and from a bottle and from nothing a
       * class prints — which is why "a feature forces a saving throw" and "a
       * feature imposes a condition" were two symptoms of one absence rather
       * than two gaps.
       *
       * **A list on the pool rather than a grant of its own**, because
       * `FeatureDefinition.grants` is a single grant and the SRD prints one
       * feature whose uses buy different things: a Channel Divinity is one
       * feature with two options, and two grants cannot say that while the
       * field is singular. It is the shape `reaction.does` already has, for
       * the same reason.
       *
       * **Nothing here is a spell.** There is no casting id, no slot, no
       * Concentration and no ongoing record — what an option hangs is filed
       * under {@link featureSource}, which `castingIdOf` answers null for, so
       * `releaseCasting`, `ongoingSpellsOn` and the Dispel resolver pass over
       * it by construction rather than by having been told to. What ends it is
       * the timer the command files, whose deadline is {@link
       * PoolOptionGrant.durationSeconds}.
       */
      readonly options?: readonly PoolOptionGrant[];
      /**
       * What one use buys, where what it buys is a **Reaction somebody else
       * holds** — SRD Bardic Inspiration.
       *
       * The fourth answer to "what does a use of this pool buy", beside
       * {@link heals}, `touchHeals` and {@link options}, and it hangs here for
       * the reason they do: `FeatureDefinition.grants` is singular, and the
       * feature that declares the pool **is** the feature that gives the die
       * away. A grant kind of its own could not be written on the SRD's one
       * feature at all.
       *
       * **Nothing is handed over.** The use is spent on the holder at the
       * moment of conferral, and what the recipient then has is a sourced
       * grant with a deadline — the tenth family — consumed by the first use
       * of it. So the pool is counted in exactly one place and a recipient
       * needs no pool of their own.
       */
      readonly confersReaction?: ConferredReactionGrant;
    }
  /**
   * What a charge buys: the item casts a named spell, and it is a casting.
   *
   * SRD "Spells Cast from Items": "The spell is cast at the lowest possible
   * spell and caster level, doesn't expend any of the user's spell slots, and
   * requires no components unless the item's description notes otherwise. The
   * spell uses its normal casting time, range, and duration, and the user of
   * the item must concentrate if the spell requires Concentration."
   *
   * So this is a *route to a casting* and never a second resolver: the cast
   * runs through `castOrRelease`, gets a casting id, starts the Concentration
   * the definition asks for, and leaves the ongoing record Dispel Magic reads.
   * What the grant supplies is the three things the wielder's sheet cannot
   * say — what it costs, at what level, and with which numbers.
   *
   * **An item-only member.** Nothing executes it from a class feature and
   * `checkContent` refuses it there, for the same reason a flat `uses` is
   * refused on a feature: the charges it spends are an item's pool, looked up
   * by the granting item's id, and a feature has none.
   */
  | {
      readonly kind: 'casts';
      /** The spell's catalogue id, resolved through `Content.spell`. */
      readonly spell: string;
      /**
       * What one casting costs, in the item's own charges.
       *
       * SRD Wand of Web: "you can expend 1 charge to cast _Web_". A per-day
       * property is the same sentence with a pool of one behind it — "this
       * property can't be used again until the next dawn" — and that is still
       * a price rather than an absence.
       *
       * **Optional only because {@link atWill} exists**, and never absent on
       * its own: `checkContent` refuses a grant that names neither, because
       * the absence of a cost is also what a malformed entry looks like.
       */
      readonly charges?: number;
      /**
       * That the book prices this casting at **nothing**.
       *
       * SRD Helm of Comprehending Languages: "While wearing this helm, you can
       * cast _Comprehend Languages_ from it." No charge count, no per-dawn
       * sentence, no limit of any kind — so there is no pool to declare, no
       * charge to spend, and nothing that can run out.
       *
       * **A licence that is written down rather than inferred.** A missing
       * `charges` would have been enough to *mean* free, and that is exactly
       * why it is not enough to *say* it: a typo, a dropped field and a free
       * casting would be the same record, and the item that came out of it
       * would silently be better than the one in the book. Declared with
       * `charges`, or with {@link upToCharges}, it is refused: an item prices
       * its casting once.
       */
      readonly atWill?: true;
      /**
       * The most this casting may spend, where the item lets the user choose.
       *
       * SRD Wand of Fireballs: "you can expend no more than 3 charges to cast
       * _Fireball_ ... For 1 charge, you cast the level 3 version of the
       * spell. You can increase the spell's level by 1 for each additional
       * charge you expend." Seven items in the book print that sentence; the
       * staff tables print a fixed cost instead and leave this absent.
       */
      readonly upToCharges?: number;
      /**
       * SRD Ring of Jumping: "but can target only yourself when you do so."
       *
       * The item casting the spell at fewer creatures than the spell itself
       * takes. Ring of Water Walking prints the same narrowing ("targeting
       * only yourself") over a spell that reaches ten, and a ring that granted
       * either unnarrowed would hand out a better ring than the book does.
       *
       * **A narrowing rather than a target rule of its own.** The spell's own
       * `TargetRule` still runs first — range, sight, count, creature type —
       * and this refuses afterwards, on the one question the item asked: is
       * every target the creature holding it. So it is a rules-legal refusal
       * and nothing has been spent when it arrives.
       */
      readonly targetsSelfOnly?: true;
      /**
       * The level the least charge count casts it at.
       *
       * Absent means the spell's own, which is SRD's "lowest possible spell
       * level" and is what every fixed-cost item comes to. Present where the
       * item's line names one — the Wand of Fireballs' "the level 3 version"
       * is Fireball's own level and a Wand of Lightning Bolts' is not.
       */
      readonly level?: number;
      /**
       * SRD Wand of Fireballs: "(save DC 15)" — the DC the item prints.
       *
       * A field rather than a rule, because the number is the *item's*: a wand
       * held by an archmage still saves against 15. Absent means the item's
       * line defers to the wielder — "using your spell save DC" — and the
       * fallback is a rule in the resolver, because the item cannot print a
       * rule the SRD prints once.
       */
      readonly saveDc?: number;
      /** SRD Circlet of Blasting: "(+5 to hit)", read the same way. */
      readonly attackBonus?: number;
      /**
       * That using it gets likelier to **fail** the more it is used, and that
       * failing destroys it.
       *
       * SRD Wind Fan: "Each subsequent time the fan is used before the next
       * dawn, it has a cumulative 20 percent chance of not working; if the fan
       * fails to work, it tears into useless, nonmagical tatters."
       *
       * **A count, not a pool.** The chance is `percent` times the number of
       * uses *before* this one, so the first use never fails and the sixth
       * rolls at a hundred. A pool of five would have refused the sixth with
       * nothing left to spend, where the book has it rolled for and the fan
       * torn — which is the whole of why `Tally` exists. The uses are counted
       * under {@link key}, and {@link recovers} is what starts the count again
       * ("before the next dawn").
       *
       * **Failing is an outcome and not a refusal.** The use happened, the
       * action went, the die fell and there is no casting: the resolution
       * comes back with `castingId: null`, exactly as a missed attack comes
       * back with `hit: false`. Nothing about it is retryable.
       */
      readonly failsCumulatively?: {
        /** SRD Wind Fan: "a cumulative **20 percent** chance of not working". */
        readonly percent: number;
        /** What the uses are counted under — a tally's key, as a pool's is. */
        readonly key: string;
        /** SRD Wind Fan: "before the next **dawn**", which zeroes the count. */
        readonly recovers: Recovery;
        /**
         * That a failed use destroys the item: "it tears into useless,
         * nonmagical tatters".
         *
         * Stated rather than assumed, because it is the *consequence* and not
         * the chance. Augury prints the same cumulative percentage and pays
         * for it with a wrong answer instead, so an item that fails some other
         * way is a field beside this one rather than a new mechanism — and a
         * clause that said nothing about the cost would be a fan that failed
         * and stayed whole.
         */
        readonly destroyed: true;
      };
    }
  /**
   * What the item does **without casting anything**.
   *
   * SRD "Magic Items" writes the fork in one sentence, so the engine does not
   * have to have an opinion about which side a given item falls on: "Many
   * items, such as Potions, **bypass the casting of a spell** and confer the
   * spell's effects with its usual duration." The other side of that sentence
   * is {@link FeatureGrant} `casts`, and the two are separate kinds because
   * they differ in the thing everything downstream reads — a casting has an
   * identity and this has none. One kind with two behaviours would report
   * itself read when only half of it was.
   *
   * **A `SpellEffect[]` carried directly**, which makes this the third host of
   * an effect list after a definition's own and an `AreaTrigger`'s. The
   * alternative — a spell definition with an item's name on it — would put a
   * catalogue entry in the spell index that nobody may cast, and would leave
   * `Content.spell` answering for something that is not a spell.
   *
   * **An item-only member.** A class feature that hands out an effect list has
   * `activated` and `standing` already, and `checkContent` refuses this on a
   * feature for the same reason it refuses `casts` there.
   */
  | {
      readonly kind: 'confers';
      /**
       * SRD: "Drinking a potion or administering it to another creature
       * requires a Bonus Action."
       *
       * On the grant rather than derived from the item's kind, because the
       * book prints the cost per item and a `potion` is not the only thing
       * that will ever confer without casting.
       */
      readonly action: 'action' | 'bonus-action';
      readonly effects: readonly SpellEffect[];
      /**
       * How long what it hangs lasts, in seconds — SRD Potion of Heroism's
       * "for 1 hour".
       *
       * Required exactly when one of the effects hangs something on somebody —
       * a sourced grant, or a condition — and refused when none does: a grant
       * with no deadline would run for ever, because there is no casting for
       * `releaseCasting` to end, and a deadline with nothing to end would file
       * a timer that takes nothing away. `checkContent` decides which of the
       * two an item is.
       */
      readonly durationSeconds?: number;
      /**
       * The same lifetime where the item's line **rolls** for it rather than
       * printing it — SRD Potion of Diminution's "for 1d4 hours".
       *
       * Beside {@link durationSeconds} and never with it: a span is stated or
       * rolled, and one that is both is sized twice, which is the rule
       * `usesRolled` already keeps beside `uses` on a charge pool. Everything
       * else about a lifetime is unchanged — it is required exactly when
       * something hangs and refused when nothing does, by the same two
       * questions `checkContent` asks of the printed half.
       *
       * **The engine throws it, once, at the moment the item is used**, down
       * the path `regainsAtDawn` goes down and into the same three-event
       * batch; what reaches the fold is the deadline it decided. So the span
       * is a fact in the log rather than a die a replay would throw again,
       * which is what rule 3 asks of every number.
       */
      readonly durationRolled?: {
        /** The dice the line prints: "1d4". Read by `parseNotation`. */
        readonly dice: string;
        /**
         * What one point of that roll is worth in seconds — 3600 for an hour,
         * 60 for a minute.
         *
         * The unit rather than a scale factor, because the book writes the
         * unit: "1d4 hours", "2d4 minutes". Seconds are what a `Duration`
         * speaks, and the multiplication is arithmetic the engine does once
         * rather than a second notation for a caller to get wrong.
         */
        readonly secondsEach: number;
      };
      /**
       * What ends the conferred condition **before** its hour is up.
       *
       * SRD Potion of Invisibility prints the sentence right after the
       * duration: "you have the Invisible condition for 1 hour. The effect ends
       * early if you make an attack roll, deal damage, or cast a spell." So it
       * is transcribed beside {@link durationSeconds}, which is the other half
       * of the same clause.
       *
       * On the **grant** rather than on the effect, because the SRD writes it
       * about the whole draught rather than about one clause of it, and because
       * a conferral hangs at most one condition today; the day an item confers
       * two with different escapes it becomes a field on the rider, which is
       * a move a conferral's own validator can make without touching a casting.
       *
       * Refused when the conferral hangs no condition
       * (`conferral_end_trigger_ends_nothing`), for the reason a duration that
       * ends nothing is: a sentence that could never fire is one that reads as
       * transcribed and is not. A `grants` timer takes no trigger — no SRD
       * item asks for one — so this is a condition's field in practice.
       */
      readonly endsEarly?: readonly EffectEndCause[];
      /**
       * The DC the item's own line prints — SRD Potion of Poison's "DC 13
       * Constitution saving throw".
       *
       * **The item's number, not the wielder's.** SRD writes it as the item's
       * own clause — Wand of Fireballs' "(save DC 15)" — so a flask in an
       * archmage's hand still saves against what the flask prints, and this
       * reaches the roll as `EffectContext.saveDc` without passing through
       * anybody's sheet.
       *
       * Required exactly when one of the effects rolls a saving throw against
       * it, and refused when none does: a save against no number is a save
       * nobody can fail, and a DC nothing rolls against never reaches a die.
       * `checkContent` decides which of the two an item is.
       */
      readonly saveDc?: number;
      /**
       * What one use costs, in the item's own charges.
       *
       * **Absent is the common case and means the item is used up** — which is
       * every Potion in the book: SRD, "Once used, a potion takes effect
       * immediately, and it is used up." Present is the other half of the same
       * sentence, and it is a staff or a rod rather than a bottle: the item's
       * line prints a charge count and the object survives the use.
       *
       * So the two are one fork and never both. `useItem` takes the price out
       * of the item's own pool through `expendCharges` — the one spender,
       * which is also where "while holding it" and the attunement the line
       * asks for are enforced — and leaves the `items-lost` for the bottle.
       *
       * `checkContent` refuses a price that is not a whole number of at least
       * one, and a price with no {@link FeatureGrant} `pool` on the same item
       * for it to come out of; both are the rules a `casts` grant's price has
       * always kept, asked of a second host rather than spelled a second way.
       */
      readonly charges?: number;
      /**
       * The most one use may spend, where the item's line lets the user
       * choose.
       *
       * SRD Staff of Striking: "When you hit with a melee attack using it, you
       * can expend up to 3 charges." The shape a Wand of Fireballs prints over
       * a *casting* — see {@link FeatureGrant} `casts` `upToCharges` — printed
       * over a use that casts nothing, and read the same way: a maximum above
       * the cost, the user choosing where in the range to land, and a count
       * outside it a rules-legal refusal.
       *
       * **What the extra charges buy is not here, and that is a gap rather
       * than an omission.** The staff's own sentence goes on: "For each charge
       * you expend, the target takes an extra 1d6 Force damage." Nothing in the
       * effect vocabulary scales dice by a charge count — `attack-rider`
       * carries a bare notation on purpose, and every `DiceScaling` field
       * reads a slot level or a caster level a conferral has neither of — so
       * an item written with this today pays a chosen price for a fixed
       * benefit. A field that said otherwise is a decision this vocabulary has
       * not made.
       *
       * Refused by `checkContent` when it is not a whole number above
       * {@link charges}, and when there is no {@link charges} for it to be a
       * maximum above: an item that is used up rather than spent names neither.
       */
      readonly upToCharges?: number;
    }
  /**
   * A feature that gives a *different* pool's uses back — see
   * `RecoveryFeature` in `standing.ts`.
   *
   * Sorcerous Restoration and Magical Cunning, which are the same sentence
   * with every number changed. The grant declares the pool holding the
   * feature's own once-per-Long-Rest limit, because that limit *is* a pool of
   * one and the engine already has pools.
   */
  | {
      readonly kind: 'recovery';
      /** The key of the pool holding this feature's own single daily use. */
      readonly pool: string;
      readonly poolLabel?: string;
      /**
       * The pool it refills.
       *
       * Pact Magic's key carries its slot level, which moves as the Warlock
       * levels — so the feature cannot name it and creation resolves it. The
       * two members are the two features, not a space of possibilities.
       */
      readonly restores:
        | { readonly kind: 'pool'; readonly key: string }
        | { readonly kind: 'pact-slots' };
      readonly upTo: 'half-class-level' | 'half-pool-maximum' | 'all';
      readonly moment: 'short-rest' | 'declared' | 'initiative';
      /**
       * SRD Uncanny Metabolism: "When you do so, roll your Martial Arts die,
       * and regain a number of Hit Points equal to your Monk level plus the
       * number rolled." The healing rides on the recovery and has no cost of
       * its own, which is why it is a field here and not a second feature.
       */
      readonly heals?: HealGrant;
    }
  | {
      readonly kind: 'unarmored-defense';
      readonly ability: Ability;
      /** SRD Barbarian: "You can use a Shield and still gain this benefit." */
      readonly shieldAllowed: boolean;
    }
  /**
   * A Reaction the feature takes at one of the engine's named windows — see
   * `ReactionFeature` in `reactions.ts`.
   *
   * Eight features across five classes and three subclasses write this, which
   * is what makes it a shape rather than one class's quirk. Three details are
   * declared rather than assumed, because getting any of them wrong makes a
   * different set of features wrong:
   *
   * - **`costsReaction` is per feature.** Uncanny Dodge, Deflect Attacks,
   *   Cutting Words and Retaliation spend one; Indomitable, Dark One's Own
   *   Luck and Peerless Skill spend none at all. The window and the
   *   action-economy cost are two facts and the SRD sets them separately,
   *   which is the commonest mistake about this corner of the rules.
   * - **The window is derived from what the effect acts on**, not declared
   *   beside it. A reduction acts on a damage roll, an intervention or a
   *   reroll on a D20 Test, a melee attack on damage already taken. A field
   *   that can disagree with the effect is a field that eventually will.
   * - **`does` is a list.** Cutting Words answers "a damage roll **or** a
   *   success on an ability check or attack roll" — one feature, one
   *   Reaction, two windows — so it declares two effects and creation files
   *   it under both.
   */
  | {
      readonly kind: 'reaction';
      readonly costsReaction: boolean;
      readonly reach: ReactionReach;
      readonly requiresSight?: true;
      readonly does: readonly ReactionGrantEffect[];
      /**
       * The pool a use comes out of, or absent where the feature is free.
       *
       * Naming a key another feature declares is how Cutting Words spends
       * Bardic Inspiration; `declares` alongside it is how Indomitable gets a
       * pool of its own.
       */
      readonly pool?: string;
      readonly poolLabel?: string;
      /** Set when *this* feature is the one that declares the pool. */
      readonly declares?: PoolSizing & { readonly recovers: Recovery };
    }
  /**
   * SRD Deflect Energy: "You can now use your **Deflect Attacks feature**
   * against attacks that deal any damage type, not just Bludgeoning, Piercing,
   * or Slashing."
   *
   * A second feature restating the first rather than a second mechanism — the
   * move Improved Critical already makes on a threshold and Restoring Touch on
   * a list. Granting a second Reaction instead would give a Monk 13 two offers
   * against one blow and let them deflect twice.
   */
  | {
      readonly kind: 'widens-reaction';
      /** The feature whose Reaction this one restates. */
      readonly feature: string;
      /** What it widens to. One member, because the SRD writes one sentence. */
      readonly damageTypes: 'any';
    };

/**
 * How the SRD sizes a pool, in the three ways it does.
 *
 * Named rather than restated because two grants need the same three, and the
 * one function that reads them — `poolSizeOf` — must read them identically.
 */
export interface PoolSizing {
  /** Uses by class level, straight off the class table. */
  readonly usesByLevel?: readonly number[];
  /** SRD Dark One's Own Luck: "equal to your Charisma modifier". */
  readonly fromAbilityModifier?: Ability;
  /** The floor that modifier cannot go below: "(minimum of once)". */
  readonly minimum?: number;
  /** SRD Lay On Hands: "five times your Paladin level". */
  readonly perClassLevel?: number;
}

/**
 * A reaction's effect as a feature *declares* it, before creation resolves the
 * class-table numbers in it.
 *
 * The difference from `ReactionEffect` is one field: a die a class table sizes
 * — the Bardic Inspiration die, the Martial Arts die — cannot be written by
 * the feature, so it names the column and creation reads it at that class's
 * own level. The same move `HealGrant.diceByLevel` already makes.
 */
export type ReactionGrantEffect =
  | {
      readonly kind: 'reduce-damage';
      readonly amount: ReactionGrantAmount;
      readonly damageTypes?: readonly string[];
      readonly fromAttackOnly?: true;
    }
  | {
      readonly kind: 'intervene';
      readonly amount: ReactionGrantAmount;
      readonly direction: 'bonus' | 'penalty';
      readonly tests: readonly D20TestKind[];
      readonly outcome: 'failure' | 'success' | 'either';
      readonly refundedOnFailure?: true;
    }
  | { readonly kind: 'reroll'; readonly bonus?: 'class-level' }
  | { readonly kind: 'melee-attack'; readonly withinFeet: number };

/**
 * A Reaction a use of a pool puts in somebody **else's** hands.
 *
 * Two halves, and they are two different lifetimes. The first four fields are
 * the conferral — what it costs the giver, how far it reaches, how long the
 * recipient keeps it, and what the giver's sentence says about being noticed.
 * The rest is the Reaction itself, written exactly as the `reaction` grant
 * writes one, because it *is* one: creation resolves the class-table die at
 * the giver's own level and the recipient holds the number, not the column.
 *
 * What it does **not** carry is a pool. A conferred Reaction costs its holder
 * nothing, because the cost was paid by whoever gave it; it is the grant
 * itself that the use spends.
 */
export interface ConferredReactionGrant {
  /** SRD Bardic Inspiration: "As a Bonus Action, you can inspire another …". */
  readonly action: 'action' | 'bonus-action';
  /** SRD: "another creature within 60 feet of yourself". */
  readonly range: number;
  /** SRD: "Once within the next hour" — the deadline the grant hangs on. */
  readonly durationSeconds: number;
  /**
   * SRD: "who can **see or hear** you".
   *
   * Sight is declared between two creatures and hearing is modelled nowhere,
   * so this asks for the offer to be reported rather than refused when the
   * half the engine can check is not satisfied. A sentence that says nothing
   * about being noticed leaves it absent, exactly as `requiresSight` does.
   */
  readonly requiresSightOrHearing?: true;
  /** SRD: "**another** creature" — a giver who is their own recipient is not. */
  readonly excludesSelf?: true;
  /** Whether the *recipient* spends a Reaction on it. Bardic Inspiration does not. */
  readonly costsReaction: boolean;
  /** How far the recipient's own use of it reaches. */
  readonly reach: ReactionReach;
  /** Whether the recipient must see whoever they are answering. */
  readonly requiresSight?: true;
  readonly does: readonly ReactionGrantEffect[];
}

export interface ReactionGrantAmount {
  readonly dice?: string;
  /** A column of the class table: the Bardic Inspiration die, by level. */
  readonly diceByLevel?: readonly string[];
  /** Ability modifiers and the class's own level, in the order SRD prints. */
  readonly plus?: readonly ('class-level' | Ability)[];
  readonly halve?: true;
}

export interface ClassLevelRow {
  readonly level: number;
  readonly proficiencyBonus: number;
  readonly cantripsKnown?: number;
  readonly preparedSpells?: number;
  /** Slots per spell level, lowest first. `[4, 2]` is four level 1 and two level 2. */
  readonly spellSlots?: readonly number[];
}

export interface SkillChoices {
  readonly choose: number;
  /**
   * The list to choose from, or absent for "any skill".
   *
   * SRD gives the Bard "Choose any 3 skills" where every other class names
   * six or so. Absent rather than a copy of the whole skill list, because the
   * two are different rules: a class that names every skill would have to be
   * updated if the game ever added one, and a class that says "any" would not.
   */
  readonly from?: readonly Skill[];
}

/**
 * Anything that grants features by level: a class, or a subclass.
 *
 * Shared so `featuresAt` and `cumulativeFeatures` work on both, rather than a
 * subclass needing its own parallel pair of functions.
 */
export interface FeatureSource {
  readonly id: string;
  readonly name: string;
  readonly features: readonly FeatureDefinition[];
}

/**
 * How a class comes by the spells it can cast.
 *
 * The three shapes the SRD actually uses, and they are not interchangeable —
 * a Wizard's prepared list is drawn from a book they have to fill, a Cleric's
 * from the whole class list every morning, and a Sorcerer never prepares at
 * all. Modelling the first and calling it "spellcasting" is what made
 * `spellbook.ts` Wizard-shaped.
 */
export type SpellcastingStyle =
  /** SRD Wizard: spells are copied into a book, and prepared from the book. */
  | 'spellbook'
  /** SRD Cleric, Druid, Paladin: prepared from the class's whole list. */
  | 'prepared-from-list'
  /** SRD Sorcerer, Bard, Ranger, Warlock: a fixed set known, never prepared. */
  | 'known';

export interface ClassSpellcasting {
  readonly ability: Ability;
  readonly style: SpellcastingStyle;
  /**
   * Which SRD feature this is — and they are two features, not one.
   *
   * "Spellcasting" and "Pact Magic" differ in three ways that all matter:
   * Pact Magic slots come back on a **Short** Rest, they stay **out** of the
   * Multiclass Spellcaster table, and they are therefore a **separate pool**
   * that a multiclassed character holds alongside their ordinary slots. Two
   * slots that come back every hour is a different resource from eight that
   * come back every day, and it is most of what makes a Warlock a Warlock.
   *
   * Naming the feature rather than one of its consequences is what keeps the
   * three from drifting apart. Defaults to Spellcasting.
   */
  readonly feature?: 'spellcasting' | 'pact-magic';
  /**
   * How much of this class's level counts towards the combined multiclass
   * spell-slot table: all of it, or half rounded up.
   *
   * SRD Multiclassing: "all your levels in Bard, Cleric, Druid, Sorcerer, and
   * Wizard; half your levels (round up) in Paladin and Ranger." Stated on the
   * class rather than kept as a list of class names in the multiclass rules,
   * so a class this engine has never heard of can say which it is. Required
   * for a Spellcasting class and refused for Pact Magic, which stays out of
   * the table entirely.
   */
  readonly progression?: 'full' | 'half';
  /**
   * The level at which the class starts casting.
   *
   * Wizards and Clerics cast at 1; Paladins and Rangers at 2; a Fighter or
   * Rogue never does, and has no `spellcasting` block at all.
   */
  readonly startsAtLevel: number;
}

/**
 * What a class grants when it is **not** your first.
 *
 * SRD: "you gain only some of the new class's starting proficiencies, as
 * detailed in each class's description." Every class prints its own "As a
 * Multiclass Character" paragraph, so it is a field of the class rather than
 * a table keyed by class name somewhere else.
 */
export interface MulticlassGrant {
  /** Weapon categories, in the same vocabulary a class definition uses. */
  readonly weapons: readonly string[];
  readonly armorTraining: ArmorTraining;
  /** How many skills the character chooses, and from where. */
  readonly skills?: { readonly choose: number; readonly from?: readonly Skill[] };
  /** Tools granted outright, by name as the SRD prints them. */
  readonly tools: readonly string[];
}

export interface ClassDefinition extends FeatureSource {
  readonly primaryAbility: Ability;
  /** What taking this class after another one grants. */
  readonly multiclass: MulticlassGrant;
  /** How this class casts, or absent for a class that does not. */
  readonly spellcasting?: ClassSpellcasting;
  readonly hitDie: number;
  readonly saveProficiencies: readonly Ability[];
  readonly skillChoices: SkillChoices;
  readonly weaponProficiencies: readonly string[];
  readonly armorTraining: ArmorTraining;
  /** The level at which a subclass is chosen. */
  readonly subclassLevel: number;
  readonly table: readonly ClassLevelRow[];
  /** Starting equipment packages, A or B. */
  readonly startingEquipment: readonly EquipmentPackage[];
}

export interface SubclassDefinition extends FeatureSource {
  readonly classId: string;
}

/**
 * An item in a starting-equipment package.
 *
 * A **catalogue id**, not a name. The gear table alphabetises by inverting its
 * names — it prints `Lantern, Hooded` where a person says "hooded lantern" —
 * so a package written in display text silently stops containing a lantern the
 * first time anybody looks it up. The id is the parser's slug and does not move.
 */
export interface EquipmentEntry {
  readonly id: string;
  readonly quantity: number;
  /** A note the SRD prints in brackets, such as a book's subject. */
  readonly detail?: string;
}

export interface EquipmentPackage {
  /** `A` or `B`, as the SRD labels them. */
  readonly option: string;
  readonly items: readonly EquipmentEntry[];
  readonly goldPieces: number;
}

export function rowAt(definition: ClassDefinition, level: number): Result<ClassLevelRow> {
  const row = definition.table[level - 1];
  if (row === undefined) {
    return err('bad_level', `${definition.name} has no level ${level}; levels run 1 to ${MAX_LEVEL}`);
  }
  return ok(row);
}

/** Slots by spell level, with the empty levels left out rather than zeroed. */
export function spellSlotTable(slots: readonly number[]): Record<number, number> {
  const table: Record<number, number> = {};
  slots.forEach((count, index) => {
    if (count > 0) table[index + 1] = count;
  });
  return table;
}

export function slotsAt(definition: ClassDefinition, level: number): Record<number, number> {
  return spellSlotTable(definition.table[level - 1]?.spellSlots ?? []);
}

/** Features gained exactly at this level. */
export function featuresAt(source: FeatureSource, level: number): readonly FeatureDefinition[] {
  return source.features.filter((feature) => feature.level === level);
}

/** Everything gained up to and including this level, in the order it arrived. */
export function cumulativeFeatures(
  source: FeatureSource,
  level: number,
): readonly FeatureDefinition[] {
  return source.features.filter((feature) => feature.level <= level);
}
