import {
  err,
  ok,
  type Ability,
  type ConditionName,
  type Result,
  type Skill,
} from '@ie/shared';
import type { CreatureSize, WeaponMastery } from '@ie/srd';
import type { WeaponNarrowing, WeaponSelector } from './attack.js';
import type { NamedAction } from './combat.js';
import type { ArmorTraining } from './character.js';
import type { TurnAnchor } from './time.js';
import type { EffectEndCause } from './timers.js';
import type { D20TestKind } from './checks.js';
import type { ReactionReach } from './reactions.js';
import type { Recovery } from './resources.js';
// Type-only, so nothing is imported at run time and no cycle exists: `rest.ts`
// owns the two kinds of rest and `creation.ts` reads them off a grant.
import type { RestKind } from './rest.js';
import type { SpellArea, SpellEffect } from './spell-definitions.js';
import { CASTING_MARK, type CastingTime } from './spells.js';
import type {
  ActivationEnd,
  CastingCostAlteration,
  HitForcedMove,
  HitRiderAnchor,
  HitRiderDamage,
  HungGrant,
  StandingGrant,
  StandingRequirement,
} from './standing.js';

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

/**
 * What one option of an `option` question demands before it may be taken.
 *
 * SRD prints the line on the invocation rather than on the feature —
 * "**Prerequisite:** Level 5+ Warlock, Pact of the Blade feature" — so it is a
 * fact about the named option and is checked per answer. Both clauses the SRD
 * writes are here and neither is a guess: a level in the class that granted
 * the feature, and another option of the **same** question already taken,
 * which is what "the Pact of the Blade feature" is once a Pact is an
 * invocation.
 *
 * A prerequisite that is not met is a refusal rather than a silent omission:
 * an option filed on a sheet whose grants nothing honours is the failure this
 * repository refuses to build.
 */
export interface OptionPrerequisite {
  /** The option this line is printed over — one of the question's `from`. */
  readonly option: string;
  /** SRD's "Level 2+ Warlock", read at the granting class's own level. */
  readonly level?: number;
  /** SRD's "Pact of the Blade feature": another option of this same question. */
  readonly requiresOption?: string;
}

/** What a feature asks the player to decide, when it asks anything. */
export type FeatureQuestion =
  | { readonly kind: 'skill'; readonly choose: number; readonly from?: readonly Skill[] }
  | {
      readonly kind: 'spell';
      readonly choose: number;
      readonly school?: string;
      readonly maxLevel?: number;
      /**
       * SRD Pact of the Tome: "The spells can be from **any class's spell
       * list**."
       *
       * Every other feature that offers a spell offers one from the list of
       * the class that is asking, which is what creation checks a pick
       * against; this is the sentence that widens it, and it widens it to the
       * whole catalogue rather than to a second list. Absent is the ordinary
       * narrowing and is every other question in the book.
       */
      readonly fromAnyList?: true;
      /**
       * SRD Pact of the Tome: "two level 1 spells that have the **Ritual
       * tag**."
       *
       * A property of the spell the definition already carries, asked of the
       * answer rather than of the grant — the reading {@link school} takes one
       * field along. One writer, and it is here rather than on the grant
       * because it is a rule about what may be *chosen*.
       */
      readonly ritualOnly?: true;
    }
  /**
   * One of a named set the feature itself lists.
   *
   * SRD Divine Order offers Protector or Thaumaturge; Fighting Style, Manoeuvres
   * and Metamagic are all the same shape. Modelling it as a feat was wrong in
   * a way that showed immediately: there is no Protector feat, so the feat
   * category check refused a legal character.
   */
  | {
      readonly kind: 'option';
      /** The count where the book prints one: "choose one of the following". */
      readonly choose?: number;
      /**
       * The count where the book prints a **column** instead. Exactly one of
       * the two, which `checkFeatureDefinition` holds it to.
       *
       * SRD Eldritch Invocations: "You gain one invocation of your choice ...
       * You gain more invocations at higher levels, as shown in the
       * Invocations column of the Warlock Features table." The same sentence
       * Weapon Mastery prints one member along, and read the same way — at the
       * level of the class that granted the feature rather than the
       * character's, which is what `weaponsAsked` already settled.
       *
       * **Exactly the count that level holds in total**, which is where it
       * parts company with the weapon question beside it: SRD's Weapon Mastery
       * is re-chosen on every Long Rest, so naming fewer is a standing decision
       * and only naming more is refused, while an invocation is gained and kept
       * — so a Warlock who named four of five has an invocation nobody has
       * spent, and creation says so.
       */
      readonly chooseByLevel?: readonly number[];
      readonly from: readonly string[];
      /**
       * What an option costs before it may be taken at all.
       *
       * SRD prints a **Prerequisite** line over most Eldritch Invocations —
       * "Level 2+ Warlock", "Level 5+ Warlock, Pact of the Blade feature" —
       * and it is a rule about one option rather than about the feature, which
       * is why it hangs here rather than on the question. An option with no
       * entry asks nothing, which is every option the SRD prints bare.
       */
      readonly prerequisites?: readonly OptionPrerequisite[];
      /**
       * The options this question may be answered with **more than once**.
       *
       * SRD Eldritch Invocations: "You can't pick the same invocation more
       * than once **unless its description says otherwise**", and four
       * descriptions say otherwise — Agonizing Blast, Eldritch Spear, Lessons
       * of the First Ones and Repelling Blast each print "You can gain this
       * invocation more than once. Each time you do so, choose a different
       * qualifying cantrip" (or feat).
       *
       * **A list on the question rather than a flag on the feature**, because
       * the exception is printed per option: a Warlock may take Agonizing
       * Blast twice and Armor of Shadows once, and a feature-wide flag would
       * permit both or neither. Every id here must be one the question offers,
       * which `checkFeatureDefinition` holds it to — a licence over an option
       * nobody is offered would permit nothing.
       *
       * **What a repeat costs is a second answer to every question the option
       * gates.** The book's second sentence is the whole reason the exception
       * exists — "each time you do so, choose a *different* qualifying
       * cantrip" — so a question written `onlyIfChoice: 'Agonizing Blast'` is
       * asked once per copy taken, and the copies after the first are answered
       * under {@link repeatAnswerKey}. A repeat that named nothing new would
       * be an invocation spent on what its holder already had.
       */
      readonly repeatable?: readonly string[];
    }
  | { readonly kind: 'subclass'; readonly choose: 1 }
  | { readonly kind: 'feat'; readonly choose: number; readonly category?: string }
  /**
   * A language the feature lets the player pick.
   *
   * SRD Thieves' Cant: "You know Thieves' Cant **and one other language of
   * your choice, which you choose from the language tables**." The first half
   * is a `language` grant; this is the second.
   *
   * **The whole catalogue, and the SRD says so in as many words.** A
   * character's two creation choices come from the *Standard* Languages table
   * — which is what `LanguageDefinition.availability` narrows — and this
   * sentence names the language **tables**, plural, with the Rare table's own
   * line printed over it: "Some features let a character learn a rare
   * language." So a feature's question offers what the world holds, and the
   * narrowing that belongs to Step 2 of creation stays there.
   *
   * **"One *other* language" is a rule about the answer**, checked against
   * every language the character already knows — the free ones, the two they
   * chose, and the ones a feature granted, this one included. It refuses
   * `duplicate_language`, which is the code creation already gives a language
   * named twice, because knowing a tongue twice is the same nothing either
   * way.
   */
  | { readonly kind: 'language'; readonly choose: number }
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
 * Which of a feature's questions this is, when a feature asks more than one.
 *
 * `GrantGate`'s twin, one field up: a feature's grants became plural the day
 * SRD Draconic Resilience printed two mechanics under one heading, and its
 * questions become plural for the same reason — SRD Divine Order asks which
 * order **and**, for one of the two orders, which extra cantrip from the class
 * list. Gate G1's argument arriving at the other field.
 *
 * **The key is where the answer is filed.** `CharacterChoices.featureChoices`
 * is keyed by feature id and every answer ever written is keyed by the bare
 * id, so a question with no key keeps that key and is the feature's *primary*
 * question — the one a grant's `onlyIfChoice` reads. A keyed question is
 * answered under `${feature.id}:${key}`, which splits unambiguously because a
 * feature id is `namespace:name` and the validator holds it to exactly one
 * colon.
 *
 * **`onlyIfChoice` is when the question is asked at all**, and it is the same
 * word a grant uses because it is the same gate: a Protector is never asked
 * which cantrip, so an answer from one is refused rather than ignored, and a
 * Thaumaturge who names none is missing an answer rather than holding a
 * question nobody printed.
 */
export interface ChoiceKey {
  /** Absent on the feature's own first question, which is keyed by its id. */
  readonly key?: string;
  /** The option of the **primary** question that makes this one worth asking. */
  readonly onlyIfChoice?: string;
}

/**
 * One question, with the key its answer is filed under.
 *
 * The intersection rather than two optional fields on each of seven members,
 * which is {@link GatedFeatureGrant}'s argument in the same file: the same
 * type either way and one place to document it.
 */
export type FeatureChoice = FeatureQuestion & ChoiceKey;

/**
 * Where a question's answer lives in `CharacterChoices.featureChoices`.
 *
 * One function because creation, the validator and the content registry all
 * have to agree about it, and three spellings of a key is how one of them
 * comes to look for an answer nobody filed.
 */
export const choiceAnswerKey = (featureId: string, key: string | undefined): string =>
  key === undefined ? featureId : `${featureId}:${key}`;

/**
 * The feature an answer key belongs to: the key above, undone.
 *
 * A feature id is `namespace:name` — one colon, enforced by
 * `checkFeatureDefinition` — so everything from a third segment on is the
 * question's own key. What this is for is the **gate**: `onlyIfChoice` always
 * reads the primary answer of the feature a `choiceFrom` names, while the
 * grant's content reads the full key it was given, and a `choiceFrom` naming a
 * keyed question would otherwise look for an option inside the cantrip.
 */
export const featureOfAnswerKey = (answerKey: string): string =>
  answerKey.split(':').slice(0, 2).join(':');

/**
 * Where the *n*th copy of a repeated question's answer lives.
 *
 * SRD prints the exception on four Eldritch Invocations — "You can gain this
 * invocation more than once. Each time you do so, choose a different
 * qualifying cantrip" — so an option taken twice asks its gated question
 * twice, and the two answers need two places to be.
 *
 * **The first copy keeps the key it always had.** `repeat` is zero-based and
 * zero is {@link choiceAnswerKey} exactly, so every answer ever written stays
 * where it was and a question nobody repeats is untouched; a later copy is
 * suffixed `#2`, `#3`, and so on, which is a separator no feature id and no
 * question key may contain. `featureOfAnswerKey` splits on colons and is
 * therefore unaffected: the feature a repeat belongs to is still the feature.
 */
export const repeatAnswerKey = (
  featureId: string,
  key: string | undefined,
  repeat: number,
): string =>
  repeat === 0
    ? choiceAnswerKey(featureId, key)
    : `${choiceAnswerKey(featureId, key)}#${repeat + 1}`;

/**
 * Every question one feature asks, however it wrote them.
 *
 * {@link featureGrants}'s twin, and it exists for the same reason: a feature
 * that writes only `choices` has `choice === undefined`, so a reader that went
 * on asking for the singular would drop the whole feature out of validation
 * and out of creation — silently, which is the one failure this repository
 * refuses to build. **Every reader of a feature's question goes through here.**
 */
export const featureChoicesOf = (
  feature:
    | { readonly choice?: FeatureChoice; readonly choices?: readonly FeatureChoice[] }
    | undefined,
): readonly FeatureChoice[] => {
  const plural = feature?.choices;
  if (plural !== undefined) return plural;
  const single = feature?.choice;
  return single === undefined ? [] : [single];
};

/**
 * The question whose answer is filed under the feature's own id.
 *
 * The one a gate reads, and the one every answer written before questions were
 * plural is. Absent where a feature asks nothing.
 */
export const primaryChoiceOf = (
  feature:
    | { readonly choice?: FeatureChoice; readonly choices?: readonly FeatureChoice[] }
    | undefined,
): FeatureChoice | undefined =>
  featureChoicesOf(feature).find((question) => question.key === undefined);

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
   * What the player must decide when a feature asks more than one thing.
   *
   * `grants`'s plural, one field up and normalised the same way: every reader
   * goes through {@link featureChoicesOf}, so a feature writing one question
   * writes `choice` exactly as it always did and one writing two writes them
   * here. The first is the feature's own — answered under its id, read by
   * every gate — and each one after it carries a {@link ChoiceKey}.
   *
   * SRD Divine Order is the sentence: "**Protector.** ... **Thaumaturge.** You
   * know one extra cantrip from the Cleric spell list." Which order is one
   * question and which cantrip is another, asked only of the Thaumaturge.
   *
   * Writing both fields is refused rather than merged: a `choice` beside a
   * `choices` is a question the accessor would drop, and a dropped question is
   * a feature that silently grants nothing.
   */
  readonly choices?: readonly FeatureChoice[];
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
  readonly grants?: GatedFeatureGrant | readonly GatedFeatureGrant[];
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

/** The spelling {@link featureSource} writes, read back by {@link featureOfSource}. */
const FEATURE_PREFIX = 'feature:';

/**
 * The feature inside a source, or null where a feature did not write it.
 *
 * {@link castingIdOf}'s twin on the other family, and written for the same
 * reason: a grant filed under a feature is **named** by that feature
 * everywhere a caller answers it — `AttackCommand.featureDamageTypes` is keyed
 * by a feature's own id — while a casting's is named by the spell.
 * `spellOfSource` hands a feature's source back unchanged, which is right for
 * a log line and wrong for a key, so the two questions are asked by two
 * functions.
 *
 * **The bare form only.** {@link conferredSource} puts a giver after an `@`
 * and {@link hungSource} a clause after the casting mark, and both come back
 * here with that tail still attached — deliberately, because the id they
 * carry is not the identity either of them ends on. Nothing asks this of
 * either: a weapon rider a feature hangs is filed under the bare source,
 * because one activation imbues one weapon and there is no second clause to
 * tell apart.
 */
export const featureOfSource = (source: string): string | null =>
  source.startsWith(FEATURE_PREFIX) ? source.slice(FEATURE_PREFIX.length) : null;

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
 * How the log names one of the grants a *use* of a feature hung.
 *
 * {@link featureSource} with the clause in it, because a use may hang more
 * than one grant and **each of them ends on its own**: `releaseGrants` matches
 * the whole source string, so everything filed under one source ends together.
 * SRD Steady Aim is why that matters — the attack roll that spends its
 * Advantage would otherwise hand back the Speed of 0 the same sentence imposed,
 * since `roll-modifier-consumed`'s fold body *is* `releaseGrants`.
 *
 * The mark is the casting mark and that is deliberate: `castingIdOf` reads
 * `cast:<n>` and nothing else after it, so a clause name can never forge a link
 * to a casting. `conferredSource`'s `@` makes the same argument from the other
 * side.
 */
export const hungSource = (featureId: string, clause: string): string =>
  `${featureSource(featureId)}${CASTING_MARK}${clause}`;

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
/**
 * One form already on a menu, and what a later feature makes it also do.
 *
 * SRD Sear Undead: "Whenever you use Turn Undead, you can roll a number of d8s
 * equal to your Wisdom modifier (minimum of 1d8) and add the rolls together.
 * Each Undead that fails its saving throw against that use of Turn Undead
 * takes Radiant damage equal to the roll's total. This damage doesn't end the
 * turn effect."
 *
 * **It is a rider on an outcome the option already settles, not a second
 * effect**, and that is the whole of why it can be said at all. "Each Undead
 * that fails its saving throw" names the failure branch of the save the option
 * has just rolled — one save, one DC, one set of creatures who failed it — so
 * the amendment is applied by giving the option's own `save` the damage a
 * `save-damage` carries, with the conditions it imposed riding the same
 * failure. An effect appended to the list would roll a second saving throw a
 * creature could fail only half of, or would damage the ones who made theirs.
 *
 * **"This damage doesn't end the turn effect" needs no field**, and reading
 * why is the check that the shape is right: the Frightened is a rider on the
 * same failure, and damage that lands beside it takes nothing away. A rule
 * that ended a condition on damage would have to be written; none is.
 */
export interface PoolOptionAmendment {
  /** The host's printed option this changes — SRD Sear Undead's Turn Undead. */
  readonly option: string;
  /**
   * Damage the creatures that **failed this option's saving throw** also take.
   *
   * The count is a {@link PoolSizing} because the SRD sizes it the way it
   * sizes a pool — "a number of d8s equal to your Wisdom modifier (minimum of
   * 1d8)" is `fromAbilityModifier` with a `minimum`, read at creation by the
   * one reader every other sizing goes through. The die stays on the
   * amendment, exactly as `diceCountByLevel` leaves the die on the effect and
   * reads only the count.
   */
  readonly damagesFailures: {
    /** One die, written as the notation a single die is: SRD's `1d8`. */
    readonly die: string;
    readonly count: PoolSizing;
    readonly damageType: string;
  };
}

export interface PoolOptionGrant {
  /** The option's own id, named by the caller who spends the use. */
  readonly id: string;
  /** What the log calls it — SRD's "Turn Undead". */
  readonly name: string;
  /**
   * What using it costs in the action economy; outside combat, nothing.
   *
   * `one-attack` is SRD Breath Weapon's price and is a third member rather
   * than an Action, because the sentence is neither: "When you take the Attack
   * action on your turn, you can **replace one of your attacks** with an
   * exhalation of magical energy." The Attack action has already been paid for
   * by the swing that opened it; what this spends is one of the swings inside
   * it, which is what `TurnBudget.attacksRemaining` counts. An option that
   * cost an Action would let a Dragonborn breathe *and* take the Attack
   * action, and one that cost nothing would let them breathe on somebody
   * else's turn.
   */
  readonly action: 'action' | 'bonus-action' | 'one-attack';
  /**
   * The ability the save DC is derived from, where the option prints one.
   *
   * SRD Breath Weapon: "DC 8 plus your **Constitution** modifier and
   * Proficiency Bonus". `HitOptionGrant`'s host writes the same field one
   * trigger along (`on-hit`'s `saveAbility`, for SRD Monk's Focus) and for the
   * same absence: a species casts nothing, so the spell save DC a pool option
   * otherwise falls back to is a number its holder has not got, and what it
   * would fall back to *instead* is an item's `8 + Proficiency Bonus` — the
   * Dragonborn's own DC short by a Constitution modifier.
   *
   * Absent means the granting class's spellcasting ability, which is what SRD
   * Channel Divinity says and what every option written before this read.
   */
  readonly saveAbility?: Ability;
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
   * The areas it offers, for an option whose **shape is chosen at the use**.
   *
   * SRD Breath Weapon: "an exhalation of magical energy in a 15-foot Cone or a
   * 30-foot Line that is 5 feet wide (**choose the shape each time**)."
   *
   * Beside {@link area} and never with it, which is `damageTypeStated`'s
   * relation to a fixed damage type exactly: one field says what the option
   * *is* and the other says what it offers, and a caller who names a shape for
   * an option that prints one is refused rather than ignored. Each entry is a
   * different `kind` — the caller names the shape by it — so a menu that
   * printed two Cones would be a choice nobody could state, and `checkContent`
   * refuses that rather than picking the first.
   */
  readonly areas?: readonly SpellArea[];
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
  /**
   * What one use mints, where what it buys is **hit points divided among
   * several creatures** rather than an effect list.
   *
   * SRD Preserve Life: "evoke healing energy that can restore a number of Hit
   * Points equal to five times your Cleric level. Choose Bloodied creatures
   * within 30 feet of yourself (which can include you), and divide those Hit
   * Points among them."
   *
   * **Beside {@link effects} and never with it.** Every other option on a menu
   * runs the resolver over the creatures the option's reach or area found; this
   * one runs no effect at all — the amounts are a division the *caller* makes
   * out of a budget the engine works out, which no effect list can state,
   * because an effect carries its own amount and reaches every target alike.
   * `reach` is the field it shares, and it is read the same way: the thirty
   * feet is measured to each creature the share names.
   *
   * It is a field on an option rather than a grant of its own for the reason
   * `options` is a field on a pool: SRD prints one feature whose uses buy
   * different things, and this is one of the things a Channel Divinity use
   * buys.
   */
  readonly distributes?: HitPointDivision;
}

/**
 * One thing a pool's use buys, where what it buys is room in the turn budget.
 *
 * Two SRD sentences and one shape:
 *
 * | | SRD | |
 * |---|---|---|
 * | Action Surge | "On your turn, you can take one additional action, except the Magic action" | {@link extraAction}, costing nothing to invoke |
 * | Flurry of Blows | "expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action" | {@link extraAttacks}, costing a Bonus Action |
 *
 * **What it may not say is as much the point as what it may.** There is no
 * field for an action granted to somebody *else*, and none for an extra action
 * that arrives every turn for a while rather than once when it is bought:
 * the first is the budget of a creature the engine is not playing, and the
 * second has no host here at all, because a pool use happens once and a
 * `TurnBudget` is rebuilt at every turn.
 */
export interface BudgetPurchaseGrant {
  /** The purchase's own id, named by the caller who spends the use. */
  readonly id: string;
  /** What the log calls it — SRD's "Flurry of Blows". */
  readonly name: string;
  /**
   * What invoking it costs in the economy, beside the use itself.
   *
   * `none` is Action Surge's answer and is a member rather than an absence
   * because the SRD prints it: "On your turn, you can take one additional
   * action" costs nothing to say, and a purchase that cost an Action to buy an
   * Action would buy nothing at all.
   */
  readonly action: 'action' | 'bonus-action' | 'none';
  /** SRD Action Surge: "one additional action, except the Magic action". */
  readonly extraAction?: { readonly except?: readonly NamedAction[] };
  /** SRD Flurry of Blows: "two Unarmed Strikes". */
  readonly extraAttacks?: { readonly count: number; readonly unarmedOnly: boolean };
  /**
   * SRD Action Surge at Fighter 17: "you can use it twice before a rest but
   * **only once on a turn**."
   *
   * The ledger this reads is the one Sneak Attack's "once per turn" already
   * uses — `featureUsedOnTurn`, keyed by the turn rather than by a flag,
   * because the two are only distinguishable on somebody else's turn and the
   * budget refresh would clear a flag at the one moment that does not matter.
   */
  readonly oncePerTurn?: boolean;
}

/**
 * A budget of hit points one use mints, and the two sentences that bound it.
 *
 * The budget is sized the way a pool is, which is the same arithmetic asked of
 * a different quantity: `poolSizeOf`'s four branches, of which SRD Preserve
 * Life uses "five times your Cleric level" and homebrew may use any of the
 * rest. Counting a feature's hit points with the same reader that counts its
 * uses is the reading `HealingTouch` already takes of Lay On Hands — a pool
 * measured in hit points, "which the pool system carries without caring".
 */
export interface HitPointDivision {
  /** How many hit points one use mints. */
  readonly hitPoints: PoolSizing;
  /**
   * SRD Preserve Life: "This feature can restore a creature to no more than
   * half its Hit Point maximum."
   *
   * One member, because the SRD prints one such ceiling and a cap the book
   * does not print is a rule invented here. It is also the whole of "Choose
   * **Bloodied** creatures": a creature above half its maximum has no room
   * under the cap at all, so the sentence needs no second check.
   */
  readonly cap: 'half-maximum';
  /**
   * SRD Preserve Life: "You can't use this feature on an Undead or a
   * Construct."
   *
   * Creature types a share may not name — a **refusal** rather than the filter
   * `mustBeType` is, because the caller named this creature rather than
   * standing it in an area, and an area is the only thing that quietly leaves
   * somebody out.
   */
  readonly excludesTypes?: readonly string[];
}

/**
 * One thing a casting may buy, where what it buys is a change to the casting
 * itself.
 *
 * SRD Metamagic is the shape this is built to, and it is {@link
 * PoolOptionGrant}'s sentence with the host changed: one feature, one pool,
 * and a named menu the holder picks from — except that a Metamagic option is
 * not *used* at a moment of its own. It is elected **on a casting**, which is
 * the whole difference: the price is paid inside that casting's own batch,
 * after every validation and before the first die, exactly where a feat's free
 * casting and an item's charge already stand.
 *
 * **The menu the grant prints and the menu the holder has are different
 * things.** SRD gives a Sorcerer "two Metamagic options of your choice", so
 * the feature asks an `option` choice and creation keeps the options whose
 * name the player answered with. A grant on a feature that asks nothing grants
 * all of them, which is the homebrew case where the menu has one entry.
 */
export interface CastingOptionGrant {
  /** The option's own id, named by the casting that elects it. */
  readonly id: string;
  /**
   * What the log calls it — SRD's "Distant Spell".
   *
   * **The same string the feature's `option` choice offers**, because that
   * answer is what creation filters the menu by; `checkContent` refuses an
   * option this feature's own choice does not print.
   */
  readonly name: string;
  /** What electing it costs, in the grant's pool. */
  readonly cost: number;
  readonly alters: CastingCostAlteration;
}

/**
 * One thing a hit buys, where what it buys is an effect list.
 *
 * {@link PoolOptionGrant} with everything an *action* owns taken off it: there
 * is no action to spend, no reach to measure and no area to fill, because the
 * creature this reaches is the one the attack just hit. What is left is the
 * list, what to call it, and how long what it hangs lasts.
 *
 * **A list rather than a single effect list on the grant**, for the reason a
 * pool's menu is one: SRD Open Hand Technique prints three named effects under
 * one sentence and Cunning Strike prints three more, and the holder picks at
 * the moment of the hit. A feature with one option prints one.
 */
export interface HitOptionGrant {
  /** The option's own id, named by the caller whose swing buys it. */
  readonly id: string;
  /** What the log calls it — SRD's "Stunning Strike", "Topple". */
  readonly name: string;
  readonly effects: readonly SpellEffect[];
  /**
   * How long what it hangs lasts, as a moment in the turn order.
   *
   * SRD Stunning Strike: "the target has the Stunned condition **until the
   * start of your next turn**", anchored on the holder of the feature, which
   * is who "your" is. Beside {@link durationSeconds} and never with it: two
   * deadlines for one effect is a choice nothing could make.
   *
   * Outside combat there is no turn boundary to end at, and the rider is
   * refused rather than applied with no deadline — the difference between a
   * condition the engine cannot time and one that would never lift.
   */
  readonly lasts?: TurnAnchor;
  /**
   * Whose next turn {@link lasts} is anchored on.
   *
   * Omitted, the **holder's**, which is what SRD Stunning Strike writes:
   * "until the start of **your** next turn". SRD Open Hand Technique's Addle
   * writes the other one in the same breath — "until the start of **its** next
   * turn" — and the two are a round apart in the order, so filing one on the
   * other is a wrong rule rather than a refusal. `HitOption.lastsOn` is the
   * compiled field and a printed stat line already writes it; this is the door
   * a **feature** says it through.
   */
  readonly lastsOn?: HitRiderAnchor;
  /**
   * A shove the rider itself delivers — SRD Open Hand Technique's Push: "The
   * target must succeed on a Strength saving throw or be **pushed up to 15
   * feet away from you**."
   *
   * `HitOption.forcedMove` is the compiled field and a printed stat line
   * already writes it, unconditionally: a satyr simply pushes. What a feature
   * adds is the branch — {@link HitForcedMove.save} — and the reason it is
   * here rather than in the effect list is `HitOption.forcedMove`'s own: a
   * shove is arithmetic **between two creatures**, and an effect is a thing
   * hung on one of them.
   */
  readonly forcedMove?: HitForcedMove;
  /**
   * How long what it hangs lasts, in seconds — SRD Cunning Strike's Poison,
   * "the target has the Poisoned condition for 1 minute".
   *
   * The same field a pool option carries and read the same way: required
   * exactly when one of the effects hangs something on somebody and refused
   * when none does, because there is no casting for `releaseCasting` to end.
   */
  readonly durationSeconds?: number;
  /** What ends a conferred condition before its span is up. */
  readonly endsEarly?: readonly EffectEndCause[];
  /**
   * Dice this rider adds to the blow — SRD Fire's Burn's "1d10 Fire damage",
   * SRD Frost's Chill's "1d6 Cold damage".
   *
   * **Not an effect in {@link effects}**, and the difference is the whole of
   * why this field exists: the list runs after the damage has been rolled and
   * landed, and `rider_deals_damage` refuses damage there because an attack
   * holds one damage roll at a time. `HitOption.extraDamage` is the compiled
   * field and the attack path gathers it where a smite's dice are gathered, so
   * the blow carries it — doubled by a critical, met by the target's defences
   * with everything else, under one `damage-rolled`.
   */
  readonly extraDamage?: HitRiderDamage;
  /**
   * SRD Cunning Strike: "**(Cost: 1d6)**" — how many of the dice the grant's
   * {@link FeatureGrant} `on-hit` `forgoesDiceOf` names this option forgoes.
   *
   * On the option because the book writes it on the effect — "Each effect has
   * a die cost" — and Devious Strikes prices six of them differently under one
   * feature. `checkContent` refuses it where the grant names no feature to
   * take it from, and refuses a grant that names one where no option pays.
   */
  readonly costsDice?: number;
  /**
   * SRD Cunning Strike's Poison: "To use this effect, you must have a
   * **Poisoner's Kit** on your person."
   *
   * The catalogue id of a thing the holder must be carrying, read off the
   * inventory at the swing so the refusal arrives before the die. On the
   * option rather than on the grant because the SRD prints it on one of the
   * three: Trip and Withdraw ask for nothing.
   *
   * **A fact the engine holds.** A kit is an item like any other, so this is
   * one more thing content says by id and nothing the engine knows by name;
   * `checkContent` holds the id to the catalogue the feature was loaded with.
   */
  readonly requiresItem?: string;
  /**
   * Feet this rider hands the turn — SRD Cunning Strike's Withdraw:
   * "Immediately after the attack, you move up to half your Speed without
   * provoking Opportunity Attacks."
   *
   * The same `movement-granted` SRD Tactical Shift writes, from the other
   * trigger: a hit rather than a Bonus Action heal. It carries no
   * `withFeature`, and that is the difference — Tactical Shift is one
   * feature's sentence about *another's* use, and this is the option's own, so
   * the grant is filed under the feature the rider belongs to.
   *
   * One share, because the SRD prints one: half a Speed. What it provokes is
   * not a field: **every** move spent out of a grant provokes nobody, which is
   * `spendMovement`'s own rule and the whole reason feet a feature hands over
   * are a counter rather than more allowance.
   */
  readonly handsMove?: { readonly share: 'half-speed' };
  /**
   * SRD Cunning Strike's Trip: "**If the target is Large or smaller**, it must
   * succeed on a Dexterity saving throw."
   *
   * The `on-hit` grant carries the same field for the feature that writes the
   * clause in its trigger sentence — SRD Hill's Tumble — and this is the other
   * place the book prints it: on **one** option of three. A gate written on
   * the grant would have refused the Poison a Cunning Strike may put in an
   * Ogre, which the book does not. Where both are written the option's is
   * read, because it is the narrower sentence.
   */
  readonly targetNoLargerThan?: CreatureSize;
}

/**
 * Which of a character's own answers a rest re-asks — see the
 * `rechosen-on-a-rest` member of {@link FeatureGrant}.
 *
 * Two members because the SRD writes two sentences, and they differ in *whose*
 * answer is re-asked rather than in what happens afterwards: Circle of the Land
 * re-asks the feature's own `choice`, and Memorize Spell re-asks a line of the
 * character's prepared list. Both land in `CharacterChoices` and both are then
 * re-planned by the same call.
 */
export type RestRechoice =
  /**
   * This feature's own `choice`, answered again.
   *
   * SRD Circle of the Land Spells' type of land, and the shape the coordinator's
   * Wild Shape forms take: any feature whose grants are gated on the answer
   * (`GrantGate.onlyIfChoice`) changes what it grants when the answer changes,
   * with no further vocabulary.
   *
   * **It also makes the choice a standing decision rather than a creation
   * quota**, which `checkFeatureChoices` reads: a character who has named no
   * land has named none, exactly as a Weapon Mastery choice is a ceiling and
   * for the same printed reason — the sentence starts "Whenever you finish".
   */
  | { readonly kind: 'this-features-choice' }
  /**
   * Prepared spells, a bounded number of them swapped for spells the character
   * already has.
   *
   * SRD Memorize Spell swaps one. {@link swap} is the count because the SRD
   * prints a count — Spell Mastery's Long Rest sentence swaps one of *two*
   * named spells — and a feature that swapped every prepared spell would be the
   * class's own re-preparation rather than a feature at all.
   */
  | { readonly kind: 'prepared-spells'; readonly swap: number }
  /**
   * The one spell a `spells` grant hands over, handed over as a different one.
   *
   * SRD Elven Lineage, High Elf: "You know the Prestidigitation cantrip.
   * Whenever you finish a Long Rest, you can replace that cantrip with a
   * different cantrip from the Wizard spell list."
   *
   * **The third member because the SRD writes a third sentence**, and what
   * makes it third is *whose* answer is re-asked: the land is the feature's own
   * question, the swap is a line of the character's prepared list, and this is
   * a spell **nobody chose** — a fixed grant, on the sheet from level 1, whose
   * one entry the rest lets its holder replace. There is no question at
   * creation to re-ask, so the offer carries the terms instead: which spell is
   * standing there now, and what may stand there in its place.
   *
   * Nothing here is new machinery either. The answer lands in
   * `CharacterChoices.featureChoices` under {@link rechosenSpellKey} and the
   * character is re-planned by the same call, so the grant is compiled out of
   * the answer the next time anything reads it.
   */
  | {
      readonly kind: 'granted-spell';
      /** The spell the grant prints — the one the replacement stands in for. */
      readonly granted: string;
      /** The class whose spell list a replacement must be on: SRD's Wizard. */
      readonly fromClass: string;
      /** The highest level a replacement may be. SRD's "cantrip" is 0. */
      readonly maxLevel: number;
    };

/**
 * Where the replacement for a re-chosen granted spell is filed.
 *
 * The granted spell's own id is the key, because the sentence is "replace
 * **that** cantrip": one grant hands over one spell, the validator holds it to
 * one, and the answer belongs to the thing it replaces rather than to a
 * question the feature never asked. One function because creation, the rest
 * and the validator all have to agree about it — `choiceAnswerKey`'s argument,
 * one host along.
 */
export const rechosenSpellKey = (featureId: string, granted: string): string =>
  choiceAnswerKey(featureId, granted);

/**
 * What one use of a feature does to **one object** — SRD Sacred Weapon's
 * "imbue one Melee weapon that you are holding".
 *
 * **A third place a use puts something, beside the two an activation already
 * has.** `whileActive` is derived from the holder's state on every read and
 * `hangs` is stored on the holder; both are facts about a *creature*, and a
 * standing grant narrowed by a {@link WeaponNarrowing} reaches a **kind** of
 * weapon, so a Paladin carrying two Longswords had both imbued and a Paladin
 * who drew a third during the minute had that one imbued too. The SRD writes
 * "**that** weapon", and the one record in the engine keyed to a particular
 * object is `GrantedWeaponRider` — which, until this, only a casting wrote.
 *
 * So the activation **names the weapon**: `activateFeature` takes an item id,
 * reads the catalogue as any command may, refuses one the holder is not
 * carrying or one of the wrong kind before the use is spent, and hangs a
 * feature-sourced weapon rider on that id. The fold reads the rider and never
 * this record, so what a swing gets is pinned at the moment of use.
 *
 * **The two clauses here are the two the SRD prints beside the naming**, and
 * they are exactly what a `whileActive` grant would otherwise have said about
 * a kind of weapon: an attack bonus the holder's own modifier sizes, and a
 * damage type the holder may name at each hit. Both are optional because an
 * imbuing that only *marks* an object — a light, a sentence the table narrates
 * — is a feature the vocabulary should be able to write without inventing a
 * bonus for it.
 */
export interface ImbuedWeapon {
  /**
   * The weapons the sentence reaches — SRD Sacred Weapon's "one **Melee**
   * weapon". Absent admits any weapon the holder is carrying, which is SRD
   * Magic Weapon's "a weapon" said by a feature.
   */
  readonly weapons?: WeaponNarrowing;
  /**
   * SRD Sacred Weapon: "you add your Charisma modifier to attack rolls you
   * make with that weapon (minimum bonus of +1)."
   *
   * The ability is the **holder's**, read off their scores as they stand
   * rather than pinned at the use, which is the reading every other
   * ability-sized bonus in the engine takes: a Paladin wearing something that
   * moves their Charisma swings at the score they have. `minimum` is the
   * printed floor under the modifier, not a default.
   *
   * **The attack roll and not the damage roll.** `GrantedWeaponRider.bonus`
   * one field along is SRD Magic Weapon's, which the book sends to both; this
   * sentence names one of them, and a rider that sent it to both would hand
   * out damage the book does not print.
   */
  readonly attackBonusFrom?: { readonly ability: Ability; readonly minimum: number };
  /**
   * SRD Pact of the Blade: "Whenever you attack with the bonded weapon, you
   * **can** use your Charisma modifier for the attack and damage rolls instead
   * of using Strength or Dexterity."
   *
   * **Not {@link attackBonusFrom} beside it**, and the difference is the whole
   * sentence: Sacred Weapon *adds* a modifier to the attack roll and leaves
   * the damage alone; this *replaces* the modifier the weapon would have used,
   * on both rolls.
   *
   * **And offered rather than imposed**, which is what the book's "can" says
   * and what this engine has read that word as since SRD Dexterous Attacks:
   * `attackAbility` weighs an offered ability against the weapon's own and
   * takes the better, or the one the attacker named. So a Warlock with a
   * higher Strength than Charisma swings with Strength, which is the whole
   * point of a permission. The imposition is `AttackOptions.imposedAbility` —
   * SRD True Strike's "The attack **uses** your spellcasting ability" — and
   * nothing a feature imbues reaches it.
   *
   * Carried onto `GrantedWeaponRider.ability`, which SRD Shillelagh has
   * written since it landed and which `strikeStyleFor` already reads for both
   * rolls: one sentence, two writers, one field.
   */
  readonly offersAbility?: Ability;
  /**
   * SRD Pact of the Blade: "Until the bond ends, you have proficiency with the
   * weapon."
   *
   * On the imbuing rather than on the sheet, because the sentence is about
   * **that** weapon: a Warlock who bonds a Glaive is not thereby trained in
   * Glaives. See `GrantedWeaponRider.proficient`, which is what the use hangs
   * and what the swing reads.
   */
  readonly grantsProficiency?: true;
  /**
   * SRD Sacred Weapon: "each time you hit with it, you cause it to deal its
   * normal damage type or Radiant damage."
   *
   * The types offered **in place of** the weapon's own, answered per hit under
   * this feature's id in `AttackCommand.featureDamageTypes` and declined by
   * saying nothing — which is the same offer SRD Shillelagh's second sentence
   * makes from the casting's side, read by the same reader.
   */
  readonly damageTypes?: readonly string[];
  /**
   * SRD Sacred Weapon: "This effect also ends if you aren't carrying the
   * weapon."
   *
   * **Declared rather than assumed of every imbuing**, which is the reading
   * `GrantedWeaponRider.endsWhenLetGo` takes of a casting's: SRD Magic Weapon
   * imbues a weapon for an hour and prints no such sentence, so a weapon put
   * down under it is still a magic weapon when it is picked up. A benefit that
   * is *on the object* survives the hand that held it unless its own text says
   * otherwise, and a rule assumed here would end an hour of enchantment the
   * book never ended.
   *
   * What ends is the whole activation and not merely the rider — "this
   * **effect** also ends" is the imbuing, the light it shed and its deadline
   * together — and `settleWeaponRiders` in the fold is where that is done.
   */
  readonly endsWhenLetGo?: true;
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
  | {
      readonly kind: 'spells';
      readonly fixed?: readonly string[];
      /**
       * The feature casts these spells for **nothing**, as often as it likes.
       *
       * SRD Armor of Shadows: "You can cast _Mage Armor_ on yourself without
       * expending a spell slot." Mask of Many Faces, Misty Visions,
       * Otherworldly Leap and Fiendish Vigor print the same sentence over
       * another spell, and not one of them prints a count.
       *
       * **The third price, not a pool of infinity.** {@link freeCasting} names
       * a pool and a number of uses, and a slot route is a slot; an at-will
       * casting spends neither, which is exactly what `GrantedSpell.atWill`
       * already says for a stat block's "**At Will:** _Etherealness_". So this
       * field produces that flag and brings no machinery of its own.
       *
       * Never beside {@link freeCasting}, which `checkContent` refuses: a
       * casting is priced once, and a grant naming both would be a pool that
       * can never run out wearing a pool's name.
       */
      readonly atWill?: true;
      /**
       * What must be true of the caster for this route to be open at all.
       *
       * SRD One with Shadows: "**While you're in an area of Dim Light or
       * Darkness**, you can cast _Invisibility_ on yourself without expending
       * a spell slot." The clause is about where the caster is standing when
       * they cast rather than about the spell, so it cannot live on the
       * definition and it cannot be settled at creation — the same three-line
       * argument `standing.ts` makes for deriving every conditional benefit on
       * every read, arriving at the one grant that hands out a *route*.
       *
       * The vocabulary is the standing one, and the reader is the same:
       * `requirementsHold`. Checked where the route is settled, before a slot,
       * an action or a die, so a Warlock standing in Bright Light is refused
       * while refusing is still free — and refused rather than quietly sent to
       * a spell slot, because the route the caller named is the route they
       * meant.
       */
      readonly requires?: readonly StandingRequirement[];
      /**
       * The casting time this route states, over the spell's own.
       *
       * SRD Pact of the Chain: "You learn the _Find Familiar_ spell and can
       * cast it **as a Magic action** without expending a spell slot." The
       * spell takes an hour; this Warlock's route to it does not. A clause
       * about the route rather than about the spell, so it compiles onto
       * {@link GrantedSpell.castingTime} and a Wizard who prepared the same
       * spell still takes the hour.
       */
      readonly castingTime?: CastingTime;
      /**
       * Stat blocks this route adds to the forms a summoning spell offers.
       *
       * SRD Pact of the Chain: "you choose one of the normal forms for your
       * familiar **or one of the following special forms**: Imp,
       * Pseudodragon, Quasit, Skeleton, Sphinx of Wonder, Sprite, or Venomous
       * Snake." `freeCasting.fixesChoice` narrows a stated value to one; this
       * lengthens a list the spell prints, which is the other half and a
       * different question. Compiles onto {@link GrantedSpell.widensForm};
       * `checkContent` refuses an id the bestiary does not hold.
       */
      readonly widensForm?: readonly string[];
      /**
       * SRD Fiendish Vigor: "When you cast the spell with this feature, you
       * don't roll the die for the Temporary Hit Points; you automatically get
       * the highest number on the die."
       *
       * A rule about the dice of a casting made **through this grant**, which
       * is why it is here and not on the spell: a Warlock who prepared False
       * Life some other way rolls it. The reading `maximisedHealing` already
       * gives SRD Beacon of Hope — every die is still thrown and still says
       * what it showed, and each takes its highest face — so nothing is added
       * to the dice layer.
       *
       * Its one SRD writer is a Temporary Hit Point roll, which is the only
       * roll it reaches today; a grant that named it over a spell rolling
       * nothing of the kind would change nothing, and `checkContent` says so
       * rather than letting a feature promise what no resolver would honour.
       */
      readonly maximisedDice?: true;
      /**
       * SRD Elven Lineage, High Elf: "Whenever you finish a Long Rest, you can
       * replace that cantrip with a different cantrip from the Wizard spell
       * list."
       *
       * A mark on the grant rather than a `rechosen-on-a-rest` grant beside it,
       * and the sentence is why: what is re-asked is **this grant's own
       * fixed spell**, so the terms — which spell is standing there, which list
       * may replace it, how high it may be — are all read off the grant that
       * prints it. A second grant would have to name the first, and two
       * declarations of one cantrip is how the two come to disagree.
       *
       * Exactly one entry in {@link fixed}, which the validator holds it to:
       * the book says "replace **that** cantrip", and a grant handing over two
       * spells has no *that*.
       *
       * The answer is filed under {@link rechosenSpellKey} and read back here
       * by creation, so the swap survives a level-up and a re-plan without
       * anything having to remember it.
       */
      readonly rechosenOn?: {
        /** Which rest re-asks it. */
        readonly rest: RestKind;
        /** The class whose spell list a replacement must be on: SRD's Wizard. */
        readonly fromClass: string;
        /** The highest level a replacement may be. SRD's "cantrip" is 0. */
        readonly maxLevel: number;
      };
      /**
       * The abilities the feature offers for the spells it grants, where the
       * source is not a class and has none of its own.
       *
       * SRD Fiendish Legacy: "Intelligence, Wisdom, or Charisma is your
       * spellcasting ability for the spells you cast with this trait (choose
       * the ability when you select the legacy)." A class feature needs none —
       * a class's spells are cast off the class's ability — and a species has
       * no such ability at all, so the trait offers a set and the player picks
       * one, which is stored on `CharacterChoices.featureSpellcasting`.
       *
       * A grant that reads a **sibling's** answer names it in
       * {@link GrantGate.choiceFrom} and carries none of its own: SRD
       * Otherworldly Presence is "the spell uses the same spellcasting ability
       * you use for your Fiendish Legacy trait", which is one question and two
       * traits written in terms of it.
       */
      readonly abilities?: readonly Ability[];
      /**
       * The **character** level this grant arrives at, where that is later
       * than the feature's own.
       *
       * SRD Elven Lineage and Fiendish Legacy: "When you reach character
       * levels 3 and 5, you learn a higher-level spell, as shown on the
       * table." One printed trait, chosen at level 1, whose table has three
       * rows and hands one of them over two levels later.
       *
       * A field rather than three feature ids, for gate G1's reason: the
       * ledger population, the origin sweep and the surface's holdings are
       * keyed by the feature the **book** prints, so a `tiefling:fiendish-
       * legacy-3` would be a feature nobody printed turning up in every
       * report. Counted in character levels because that is the phrase the
       * book uses, which for a species trait is the only level there is.
       */
      readonly fromLevel?: number;
      /**
       * Castings of one of those spells the **feature** pays for, out of a
       * pool instead of a spell slot.
       *
       * SRD writes the sentence on class feature after class feature and
       * always in the same breath as the grant above it: "You always have the
       * _Hunter's Mark_ spell prepared. You can cast it twice without
       * expending a spell slot, and you regain all expended uses of this
       * ability when you finish a Long Rest." Faithful Steed's is the same
       * sentence with a pool of one behind it, and Wild Companion's is the
       * same sentence spending a pool another feature declared.
       *
       * **A field on the `spells` grant rather than a kind of its own**, for
       * the reason `options` hangs off `pool`: `FeatureDefinition.grants` is
       * singular, and the feature that grants the spell *is* the feature that
       * pays for casting it. Two grants cannot say one sentence, and a
       * feature that had to choose between "always prepared" and "twice
       * without a slot" would print half of what the book prints.
       *
       * **Nothing here is new machinery.** What it produces is a
       * {@link GrantedSpell} with a `freeCastPool`, which is what a feat's
       * Magic Initiate has produced since it landed: `choosePayment` spends
       * the pool, `resolveSpell` writes `slotless: 'special-ability'`, and
       * the casting is the casting every other route takes — an id, a record,
       * the Concentration the definition asks for. The feature supplies the
       * two things the sheet cannot: which pool, and how many.
       *
       * **The numbers are the granting class's**, resolved at creation, which
       * is the same reading `PoolOption.ability` takes: a multiclassed holder
       * has more than one spellcasting ability and the feature belongs to
       * exactly one of them.
       */
      readonly freeCasting?: {
        /**
         * The spell cast without a slot, resolved through `Content.spell`.
         *
         * Usually one of {@link fixed} and not required to be: SRD Wild
         * Companion spends a Wild Shape use to cast a spell the Druid has no
         * other claim on, so the free casting is the *only* route to it.
         */
        readonly spell: string;
        /** The pool a casting comes out of — this feature's, or another's. */
        readonly pool: string;
        readonly poolLabel?: string;
        /**
         * Set when *this* feature is the one that declares the pool.
         *
         * The reading `reaction.declares` already takes, and for the same
         * fork: Favored Enemy's uses are a column of its own class table and
         * Faithful Steed's is the pool of one that "once ... until you finish
         * a Long Rest" always means, while Wild Companion names a pool Wild
         * Shape declared and sizes nothing.
         */
        readonly declares?: PoolSizing & { readonly recovers: Recovery };
        /**
         * SRD: "You can also cast the spell using any spell slots you have of
         * the appropriate level."
         *
         * Off by default and said where the book says it. A class feature's
         * free casting is the free route and nothing else — "a granted route
         * that allowed both would make the engine choose between a resource a
         * player is saving and one they are not" — and the lineages print the
         * other sentence, for a holder who may have no slots at all.
         */
        readonly withSlots?: true;
        /**
         * SRD Wild Companion: "When you cast the spell in this way, the
         * familiar is Fey." The one value a `choiceStated` spell leaves to its
         * caster, fixed by the feature instead: a casting through this grant
         * that states another is refused `choice_fixed`, and one that states
         * none is not asked.
         */
        readonly fixesChoice?: string;
        /**
         * SRD Wild Companion: "and disappears when you finish a Long Rest" — a
         * lifetime the grant puts on the summons over what the spell prints,
         * recorded on the bond when the creature arrives.
         */
        readonly keptUntilSummonerLongRests?: true;
      };
    }
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
      /**
       * The damage types come from the choice this feature asked for — or
       * from the one {@link GrantGate.choiceFrom} names.
       */
      readonly damageTypesFromChoice?: boolean;
      /**
       * The spell a `casting-damage` grant reaches comes from the choice this
       * feature asked for — {@link damageTypesFromChoice} on the other
       * narrowing of the same `when`.
       *
       * SRD Agonizing Blast: "Choose one of your known Warlock cantrips that
       * deals damage. You can add your Charisma modifier to **that spell's**
       * damage rolls." The engine knows no spell by name and neither does the
       * class table: which cantrip it is, is the player's answer, so the grant
       * says where to read it rather than naming one.
       *
       * Read off the **keyed** answer {@link GrantGate.choiceFrom} names —
       * which is that field's second job, stated in its own docstring — so an
       * invocation's cantrip is read from the question that asked for it and
       * not from the list of invocations taken. An unanswered question grants
       * nothing at all rather than a narrowing that reaches every casting.
       */
      readonly spellFromChoice?: boolean;
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
      /**
       * That the pool above is **somebody else's**, and this activation only
       * spends it.
       *
       * SRD Sacred Weapon: "you can expend one use of your **Channel
       * Divinity**" — the pool is the Paladin class's, printed under its own
       * heading and sized by its own column, and the subclass names a way to
       * spend a use. Declaring it a second time is two pools with one key,
       * which the fold refuses outright.
       *
       * **The distinction the vocabulary already draws twice**, spelled a
       * third time on a third host: `reaction` declares a pool only when it
       * carries `declares` — "Cutting Words spends Bardic Inspiration, which
       * is somebody else's pool, and declares nothing" — and a `spells`
       * grant's free casting the same. This says it as a flag rather than as a
       * sub-object because an activation's sizing is its own fields, and
       * moving them would be a migration of six grants that all declare.
       *
       * A sizing beside it is refused, because a use count on a pool this
       * feature does not own is a number nothing would ever read.
       */
      readonly spendsOnly?: true;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      /** SRD Stonecunning: "a number of times equal to your Proficiency Bonus". */
      readonly perProficiencyBonus?: true;
      /** A flat count the book prints — SRD Innate Sorcery's "twice" — where no table sizes it. */
      readonly minimum?: number;
      readonly poolLabel?: string;
      readonly recovers?: Recovery;
      /** SRD Rage: "You regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      /**
       * Either moment, which is what the `ActivatedFeature` this becomes has
       * always held.
       *
       * It was narrowed to Rage's for as long as Rage was the only written
       * feature with one, and the narrowing said what would widen it: "widening
       * it to the pair is a word here and not a second vocabulary". SRD
       * Reckless Attack is the word — "Advantage on attack rolls using
       * Strength **until the start of your next turn**, but attack rolls
       * against you have Advantage during that time" — and the two anchors are
       * a full round apart, so nothing derives one from the other.
       */
      readonly lasts?: TurnAnchor;
      /**
       * The other lifetime the book prints: a span. SRD Innate Sorcery "for 1
       * minute"; Stonecunning, Large Form and Draconic Flight "for 10 minutes"
       * — on the clock, in and out of a fight alike, and never maintained.
       * Exactly one of `lasts` and `lastsSeconds` is written, and the
       * validator refuses both and neither.
       */
      readonly lastsSeconds?: number;
      /**
       * The third answer: the feature prints **no** deadline at all.
       *
       * SRD Pact of the Blade: "Your bond with the weapon ends if you use this
       * feature's Bonus Action again, if the weapon is more than 5 feet away
       * from you for 1 minute or more, or if you die." Three endings and not a
       * span among them — so a `lastsSeconds` here would be a number the book
       * does not print, and a `lasts` would end the bond at a turn boundary
       * nothing in the sentence names.
       *
       * Written as a flag rather than as the absence of the other two, because
       * the absence is how a feature loses its deadline to a typo: exactly one
       * of the three is declared and the validator says which are missing.
       */
      readonly lastsUntilEnded?: true;
      /**
       * The use **makes** the weapon it imbues, rather than finding it in the
       * holder's hands.
       *
       * SRD Pact of the Blade: "you can conjure a pact weapon in your hand — a
       * Simple or Martial Melee weapon of your choice with which you bond".
       * Which weapon is the use's own answer, named on the activation and held
       * to {@link ImbuedWeapon.weapons} — the book writes one clause over both
       * halves of the sentence, so there is one narrowing.
       *
       * A flag, and it carries no hand count, which is where this differs from
       * a spell's {@link ConjuredItems}. Goodberry's ten berries are a
       * *handful* and the number of hands is the spell's to print; a weapon's
       * hands are the weapon's own, answered by `handsFor` off the catalogue
       * record, and a Glaive out of the air is swung with two hands for the
       * same reason a Glaive off the rack is. So the line is an ordinary owned
       * line with a lifetime, and "in your hand" is `equipItem`'s door and its
       * `no_free_hand`.
       *
       * Declared beside `imbuesWeapon` and never instead of it: what is
       * conjured is a weapon the use has already decided to hang a rider on,
       * and a conjuring with nothing hung on it would be a feature that hands
       * its holder an ordinary Glaive out of the air.
       * `checkFeatureDefinition` refuses one without the other.
       *
       * **The line's lifetime is the activation's**, derived in the fold the
       * way a casting's conjured line is derived from its casting: "A conjured
       * weapon disappears when the bond ends", and the bond ends by three
       * doors that write no event about a weapon.
       */
      readonly conjuresWeapon?: true;
      /**
       * SRD Large Form: "you can change your size to Large" — the size the
       * holder is while the feature runs. The fold keeps the map's copy in
       * step with it, and puts the creature's own back when it ends.
       */
      readonly size?: CreatureSize;
      readonly capSeconds?: number;
      readonly endsOn?: readonly ActivationEnd[];
      /**
       * SRD Divine Sense: "you know the location of any creature of those types
       * within 60 feet of yourself, and you know its creature type."
       *
       * **A question the engine can answer**, which is what makes it a field
       * rather than a note handed to the table: every creature's type and every
       * creature's distance are already in state, so what the feature supplies
       * is only the filter and the radius. Nothing is hung on anybody and
       * nothing is spent by reading it — `detectedBy` in `standing.ts` computes
       * the answer afresh on every read, exactly as `sensesOf` does, so an
       * awareness stops the instant its holder is Stunned without anything
       * having to remember to.
       *
       * **Not a `sense`.** A `standing` grant's `sense` is Darkvision or
       * Blindsight: it answers `canSee`, and every rule that asks whether one
       * creature can see another goes through it. This answers a different
       * question — *what is out there, of these kinds* — which no sight rule
       * reads and which is true of a creature behind a wall.
       *
       * The half of the SRD's sentence that is **not** here is the second one:
       * "any place or object that has been consecrated or desecrated". Nothing
       * in the engine consecrates a place, so a radius would search for a fact
       * nothing can state, and the feature's own note hands that sentence over.
       */
      readonly detects?: {
        /** SRD's "within 60 feet of yourself". */
        readonly feet: number;
        /**
         * The creature types it reports — SRD's "Celestials, Fiends, and
         * Undead".
         *
         * The same word a stat block's `Fey` and an object's `Object` are, and
         * not a catalogue id: it is the noun the glossary puts over the
         * category, which `mustBeType` on a pool option already reads.
         */
        readonly creatureTypes: readonly string[];
      };
      readonly forbidsCasting?: boolean;
      /**
       * SRD Steady Aim: "You can use this feature only if you haven't moved
       * during this turn." See `ActivatedFeature.onlyIfUnmoved`.
       */
      readonly onlyIfUnmoved?: boolean;
      /**
       * What a *use* hangs on its holder, as against what running it derives.
       *
       * `whileActive` below is the derived half: standing effects that hold
       * while the feature is on and are re-read from the world every time
       * anybody asks. This is the stored half, emitted where the action is
       * spent — and it is the only half that can be *spent in turn*, because
       * `consumedRollModifiers` reads stored state. See {@link HungGrant}.
       */
      readonly hangs?: readonly HungGrant[];
      /**
       * SRD Sacred Weapon: "you can expend one use of your Channel Divinity to
       * **imbue one Melee weapon that you are holding**".
       *
       * The third thing an activation can do, beside what it derives
       * (`whileActive`) and what it hangs on its holder (`hangs`): it hangs a
       * benefit on an **object**. See {@link ImbuedWeapon} for why that is a
       * different kind of thing from either.
       */
      readonly imbuesWeapon?: ImbuedWeapon;
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
   * A fact the holder simply **knows** about one other creature.
   *
   * SRD Hunter's Lore: "While a creature is marked by your _Hunter's Mark_,
   * you know whether that creature has any Immunities, Resistances, or
   * Vulnerabilities, and if so, what they are."
   *
   * **No action is spent and no event is written.** Every other grant here
   * either changes a number a rule reads or buys a use; this changes nothing
   * at all. The ranger knows, and the only thing that can go wrong is a door
   * not saying so — which is the same shape `detects` is in and the reason
   * the ruling that admitted `detects` admits this: the engine may hold a
   * fact only the table reads when the fact is derived from state and a door
   * publishes it. `knownDefencesOf` in `knowledge.ts` is the derivation and
   * the player door's `look` is the door.
   *
   * **Not `detects`, one member up**, though the two answer for the same
   * ruling. `detects` is an *action*: it is a field on `activated`, it is
   * switched on by spending something, it runs for a printed span and it
   * searches a **radius** for creatures of named types. This is standing
   * knowledge about **one** creature, true at any distance and for as long as
   * the mark is, with nothing to switch on and nothing to end. Writing it as
   * a `detects` with an infinite radius would be a use nobody spends wearing
   * an activation's name.
   *
   * **And not a `standing` grant**, though the lifetime is right: a standing
   * grant's members each change what some rule computes — a bonus, a mode, a
   * defence — and are gathered by the readers of those rules. Nothing about a
   * knower's own numbers moves here.
   */
  | {
      readonly kind: 'knowledge';
      /**
       * What the holder is told. One member, named for its sentence: SRD's
       * "any Immunities, Resistances, or Vulnerabilities" is the damage table
       * and the condition immunities beside it, which is the run a stat block
       * prints under one heading.
       */
      readonly reveals: 'defenses';
      /**
       * Which creature the sentence is about.
       *
       * One member, and it is a **mechanical** relation rather than a spell's
       * name: SRD's "marked by your Hunter's Mark" is, to the engine, a
       * running casting of this creature's whose `attack-rider` effect named
       * a target. Any definition writing `marksTarget` marks a creature, so a
       * homebrew spell that says the same sentence is read by the same rule
       * and no spell id reaches the engine.
       */
      readonly about: 'a-creature-your-casting-marks';
    }
  /**
   * A feature that **makes a thing with statistics of its own** — SRD Gnomish
   * Lineage's clockwork device.
   *
   * > "you can spend 10 minutes casting Prestidigitation to create a Tiny
   * > clockwork device (AC 5, 1 HP) ... You can have three such devices in
   * > existence at a time, and each falls apart 8 hours after its creation or
   * > when it is dismantled by you or another creature."
   *
   * **Not an `activated` grant and not a pool option**, and the printed
   * sentence is why: both of those buy something that happens to a creature —
   * a span on the holder, an effect list over targets — and this puts a
   * *second thing* in the room, with an Armour Class, a hit point and a
   * lifetime of its own. `objects.ts` already says what such a thing is and
   * `declareObject` already raises one when a DM describes it; what was
   * missing was the door a **feature** makes one through.
   *
   * **And not a pool.** "Three such devices in existence at a time" is a count
   * of things standing, not of uses spent: a device dismantled makes room for
   * another the same minute, and a pool with no recovery would refuse the
   * fourth for ever. So the ceiling is derived from the room rather than
   * stored on the sheet, which is the same reading `strandedSummons` takes of
   * a summons — a question about the world as it stands.
   *
   * What the device *does* is **prose the table narrates**, pinned at the
   * making. The SRD's own sentence hands it over: the function is "one effect
   * from the Prestidigitation spell", and the engine holds no candle to light.
   * So {@link functions} is the menu the book prints, the maker names one of
   * them, and the Bonus Action that activates the device spends the slot and
   * hands the sentence back — the reading `take_printed_action` already takes
   * of a stat block's line.
   */
  | {
      readonly kind: 'creates-object';
      /**
       * SRD: "spend **10 minutes** casting Prestidigitation".
       *
       * **The whole of what a making costs, and there is no action beside
       * it.** The field for one was here and is gone: a making moves the clock,
       * and inside a fight the clock is the turn order's — `advanceTime` states
       * that rule and this command keeps it — so every making happens outside
       * combat, where there is no economy to spend an action from. A price
       * nothing could ever charge is a number on a sheet that lies to whoever
       * reads it, which is the failure this vocabulary is built to avoid.
       */
      readonly castingSeconds: number;
      /**
       * The spell the making is a casting of.
       *
       * Required, because the thing that is made is **kept** by its maker and
       * a kept creature's bond records which spell keeps it — the same field
       * a familiar's does. A feature that made something without casting
       * anything would need a second kind of bond, which is a sentence no book
       * has written.
       */
      readonly spell: string;
      /** SRD: "a Tiny clockwork device (AC 5, 1 HP)". */
      readonly object: {
        readonly size: CreatureSize;
        readonly armorClass: number;
        readonly hitPoints: number;
      };
      /** SRD: "each falls apart 8 hours after its creation". */
      readonly lastsSeconds: number;
      /** SRD: "You can have three such devices in existence at a time." */
      readonly atOnce: number;
      /**
       * The functions the maker chooses between, each one a sentence the table
       * narrates.
       *
       * Content, because it is the printed list of another spell's effects and
       * the engine holds no catalogue. A making that names anything else is
       * refused rather than pinned, so a device always does something its own
       * trait prints.
       */
      readonly functions: readonly string[];
      /** SRD: "takes a Bonus Action to activate it with a touch". */
      readonly activation: 'action' | 'bonus-action';
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
   * italicised clauses. A feature may carry several grants now, and three of
   * these would spell the same gate out three times and leave nothing holding
   * them together.
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
   * Languages the feature puts on the sheet without asking.
   *
   * SRD Druidic: "You know Druidic, the secret language of Druids." SRD
   * Thieves' Cant: "You know Thieves' Cant **and** one other language of your
   * choice" — the first half, the half nobody chooses.
   *
   * **A grant rather than a proficiency, and the reason is the sheet.** A
   * character's languages were, until this member, exactly the ones
   * `CharacterChoices.languages` named plus whatever the world gives
   * everybody: there was no way at all for a *feature* to put one there, so
   * the two class features that print the sentence recorded it in a note and
   * the sheet said nothing. `languagesKnown` in `creation.ts` reads this
   * beside the chosen ones.
   *
   * **The name and not an id**, which is what every other language in the
   * engine is keyed by: `Content.languageNamed` is the lookup, because the
   * name is what a choice carries and what a stored sheet already holds.
   * `checkContent` refuses a name this catalogue does not hold, exactly as it
   * refuses a fixed spell grant naming nothing.
   *
   * **The chosen half is a question, not this.** SRD Thieves' Cant's "one
   * other language of your choice" is a `FeatureQuestion` of kind `language`
   * one union up, answered under the feature's own key and held to the
   * catalogue there — the same division `spells` already draws between its
   * `fixed` list and the `spell` question beside it.
   *
   * **`known` and not `fixed`**, which is the one place this member parts
   * from `spells`' spelling on purpose. `spell-schema.test.ts`'s sweep reads
   * every `fixed: [...]` a class file writes and holds the ids inside it to
   * the allowance for a spell id; a second population sharing the field name
   * would arrive there as a spell the catalogue does not define, and widening
   * that sweep to let a capitalised name through would weaken the guard it
   * exists to be. SRD's own verb is the better word anyway: "You **know**
   * Druidic."
   */
  | { readonly kind: 'language'; readonly known: readonly string[] }
  /**
   * SRD Divine Order (Protector): "you gain proficiency with Martial weapons
   * and training with Heavy armor"; Primal Order (Warden) prints the same
   * sentence over Medium armour.
   *
   * **One grant because the book prints one sentence**, which is the argument
   * `initiative` and `strike-style` already make: two grants would be two
   * things a gate has to be written on twice and two readers looking for "the"
   * grant of a kind on a feature that carries one of each.
   *
   * What it feeds is the two lists a class already declares — the weapon
   * categories `proficientWith` reads and the `ArmorTraining` the armour
   * penalty reads — folded in `creation.ts` beside a class's own and a
   * multiclass's, so nothing downstream of the sheet learns that a feature can
   * say this. Both fields are optional and a grant raising neither is refused:
   * a sentence about training that trains nobody is one somebody meant to
   * finish.
   *
   * **Named for both halves rather than "proficiency"**, because
   * `readableGrantKinds` probes reader source for the kind's own literal and
   * `content.ts` already writes `grant['proficiency']` for the Initiative
   * grant's field — a kind spelled `proficiency` would read as executed
   * whether or not anything executed it.
   */
  | {
      readonly kind: 'weapon-and-armor-training';
      /** The categories of weapon, exactly as a class's own list spells them. */
      readonly weapons?: readonly ('simple' | 'martial')[];
      /** The armour a holder is trained with, as `ArmorTraining`'s four flags. */
      readonly armor?: readonly ('light' | 'medium' | 'heavy' | 'shields')[];
    }
  /**
   * What the holder gains when an enemy falls.
   *
   * SRD Dark One's Blessing: "When you reduce an enemy to 0 Hit Points, you
   * gain Temporary Hit Points equal to your Charisma modifier plus your
   * Warlock level (minimum of 1 Temporary Hit Point). You also gain this
   * benefit if someone else reduces an enemy within 10 feet of you to 0 Hit
   * Points."
   *
   * **A moment, not a price.** The `activated` grant beside this one pays its
   * holder when they switch something on and an allowance's
   * `temporaryHitPoints` pays when the price is taken — both are a thing the
   * holder *did*. This one is an outcome: the number is paid because a
   * creature's Hit Points reached 0, which is a fact the damage path computes
   * and which nobody decides.
   *
   * **`within` is the second sentence and not a range on the first.** A
   * holder's own kill pays wherever it happened; somebody else's pays only
   * within the printed distance of the *target*. So absent means "your own
   * kills only", which is what a homebrew feature printing the first sentence
   * alone would say, and the two sentences are one grant because the book
   * prints one feature.
   *
   * **The ability stays symbolic and the level does not.** A Charisma modifier
   * is a number on the sheet at the moment the enemy falls — an Amulet of
   * Health's reasoning, one ability along — while "your Warlock level" is a
   * column of one class's table, which only creation knows how to read for a
   * character who is also something else. That is the split `reaction` already
   * makes with its die.
   */
  | {
      readonly kind: 'on-dropping-a-hostile';
      readonly temporaryHitPoints: {
        /** SRD's "your Charisma modifier". */
        readonly ability: Ability;
        /** SRD's "plus your Warlock level" — the granting class's own level. */
        readonly plusClassLevel?: true;
        /** SRD's "(minimum of 1 Temporary Hit Point)". */
        readonly minimum: number;
      };
      /** SRD's "if someone else reduces an enemy within 10 feet of you". */
      readonly within?: number;
    }
  /**
   * What the holder may do about Initiative, which SRD Alert prints twice.
   *
   * **One member with two flags, because `FeatureDefinition.grants` is
   * singular and one feat prints both benefits.** SRD Alert is "*Initiative
   * Proficiency.* When you roll Initiative, you can add your Proficiency Bonus
   * to the roll" and "*Initiative Swap.* Immediately after you roll
   * Initiative, you can swap your Initiative with the Initiative of one
   * willing ally in the same combat" — two named benefits under one heading,
   * which two grants cannot say while the field holds one. It is the argument
   * `strike-style` makes about Martial Arts' three clauses, arriving at a feat.
   *
   * Named for the rules rather than for the feat that has them, as `evasion`
   * next door is named for the rule two classes share. Both flags are optional
   * and `checkContent` refuses a grant that raises neither: a grant about
   * Initiative that changes nothing about it is a sentence somebody meant to
   * finish.
   *
   * **It exists because the engine used to pay it out itself.** `creation.ts`
   * compared a chosen feat's id against a literal, which is inviolable rule 4
   * broken mechanically: a catalogue without that feat lost the rule, and a
   * catalogue that spelled it differently never got it. A feat declares this
   * instead, and creation reads the declaration.
   *
   * **`proficiency` is a number rather than a mode**, and the distinction is
   * the SRD's own. Feral Instinct's "Advantage on Initiative rolls" is a
   * `standing` `roll-mode` on the `initiative` family and already works; this
   * is arithmetic, and it is the Proficiency Bonus rather than a printed
   * figure, which is why `flat-bonus` cannot say it — that member carries a
   * number the item printed, and this one is read off the character's own
   * level.
   *
   * **`swap` is a permission rather than an effect.** It grants nothing and
   * changes no number: it is what `swapInitiativeBetween` asks before it will
   * write the swap, in the window the SRD opens and with the ally's consent
   * stated. The engine had the arithmetic and the Incapacitated clause and
   * checked neither of the other two, so a creature with no feat at all could
   * be reordered at any point in a fight.
   */
  | {
      readonly kind: 'initiative';
      /** SRD Alert: "you can add your Proficiency Bonus to the roll". */
      readonly proficiency?: boolean;
      /** SRD Alert: "you can swap your Initiative ... with one willing ally". */
      readonly swap?: boolean;
    }
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
      /** SRD Breath Weapon: "a number of times equal to your Proficiency Bonus". */
      readonly perProficiencyBonus?: true;
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
       * A **later feature** that rewrites this pool's recovery.
       *
       * SRD Font of Inspiration, at Bard level 5: "you regain all your expended
       * uses of Bardic Inspiration when you finish a Short Rest." The pool was
       * declared four levels earlier with a Long Rest on it, and the second
       * feature changes that one tag and nothing else — not what a use buys,
       * not how many there are.
       *
       * **It is declared here rather than on the feature that prints it**, for
       * the reason {@link FeatureDefinition.executedBy} gives: a later feature
       * that only moves a number an earlier declaration already carries is a
       * *step in the earlier feature's table*, and `FeatureDefinition.grants`
       * is not where the rewrite belongs: a second grant on the *later*
       * feature would declare a second pool rather than move this one. So the
       * pool names the feature whose arrival moves it, and creation applies the
       * rewrite exactly when the character holds that feature: at creation for
       * one built past the level, and through
       * `resource-pool-recovery-changed` for one who reaches it in play.
       *
       * **Not {@link regainsOnShortRest}**, which is the partial rule — "one
       * back on a Short, all on a Long" — and would hand back a single use.
       * This is the whole tag, and `restoreOn` needs no new branch to read it:
       * a rest emits both tags on a Long Rest, so a pool moved to the Short is
       * still refilled by the night.
       */
      readonly recoversSooner?: {
        /**
         * The feature whose sentence rewrites it, out of the features this
         * source reaches: its own, and for a subclass its parent class's —
         * `checkContent` holds it to that list because `recoveryOf` gates on
         * the whole list a character earned.
         *
         * A class feature that moves a *subclass*'s pool cannot also claim
         * `executedBy`, which is held to one source, so it records `manual`
         * and says in its note what the other declaration does.
         */
        readonly withFeature: string;
        readonly recovers: Recovery;
      };
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
      readonly heals?: HealGrant & {
        readonly action: 'action' | 'bonus-action';
        /**
         * Feet a **later** feature hands over whenever this heal is used.
         *
         * SRD Tactical Shift: "Whenever you activate your Second Wind with a
         * Bonus Action, you can move up to half your Speed without provoking
         * Opportunity Attacks." One sentence about somebody else's feature, on
         * a feature of its own, at a level of its own — which is exactly
         * {@link recoversSooner}'s shape above, and it is written the same way
         * for the same reason: the rider belongs to the use it rides on, and
         * restating the pool beside it would be a second place to get the
         * Fighter's table wrong.
         *
         * `withFeature` is the feature whose sentence hands it over, out of
         * the features this source reaches, and it is also the **source** the
         * grant is filed under — so a move spends what a reader can name. The
         * feature it names claims `executedBy` rather than a grant of its own,
         * which is the member for a feature another's declaration executes.
         *
         * One share, because the SRD prints one: half a Speed.
         */
        readonly handsMove?: {
          readonly withFeature: string;
          readonly share: 'half-speed';
        };
      };
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
       * The damage the options above deal is of the type the choice this
       * feature reads names — or the one {@link GrantGate.choiceFrom} names.
       *
       * SRD Breath Weapon: "a creature takes 1d10 damage of the type
       * **determined by your Draconic Ancestry trait**." The same field a
       * `standing` grant carries for SRD Damage Resistance, which is the trait
       * printed directly beneath it and reads the same answer off the same
       * table — so this is one sentence arriving at a second host rather than
       * a second mechanism.
       *
       * **The option still declares a type, and the choice replaces it.** That
       * is `statedDamageType`'s own rule, written where a casting's stated
       * choice is: "the definition carries a value so the shape is
       * well-formed, the casting carries the answer, and the answer is what
       * lands". Here the answer is the player's, given once at creation, so
       * the substitution happens there and the command sees a type.
       */
      readonly damageTypesFromChoice?: boolean;
      /**
       * What one use buys, where what it buys is a **Reaction somebody else
       * holds** — SRD Bardic Inspiration.
       *
       * The fourth answer to "what does a use of this pool buy", beside
       * {@link heals}, `touchHeals` and {@link options}, and it hangs here for
       * the reason they do: the feature that declares the pool **is** the
       * feature that gives the die away, so a kind of its own would have to
       * name the pool and its holder a second time to say what this says by
       * sitting here.
       *
       * **Nothing is handed over.** The use is spent on the holder at the
       * moment of conferral, and what the recipient then has is a sourced
       * grant with a deadline — the tenth family — consumed by the first use
       * of it. So the pool is counted in exactly one place and a recipient
       * needs no pool of their own.
       */
      readonly confersReaction?: ConferredReactionGrant;
      /**
       * What one use buys, where what it buys is **room in the turn's own
       * budget** — SRD Action Surge and SRD Flurry of Blows.
       *
       * The fifth answer to "what does a use of this pool buy", beside
       * {@link heals}, `touchHeals`, {@link options} and
       * {@link confersReaction}, and a list for the reason `options` is one:
       * the SRD prints one feature whose points buy several different things,
       * so what varies is what a *use* buys rather than what the feature
       * grants. Monk's Focus is that
       * feature exactly — "You start knowing three such features: Flurry of
       * Blows, Patient Defense, and Step of the Wind" — which is the owner's
       * Channel Divinity ruling arriving at a second pool: a shell with one
       * pool, and each purchase a form the shell takes.
       *
       * **It is not {@link options}.** Those buy an effect list resolved over
       * targets; these buy nothing that happens to anybody at all. What they
       * write is a `TurnBudget`, which no effect kind reaches and no resolver
       * may — see `GrantedAction`.
       */
      readonly buysBudget?: readonly BudgetPurchaseGrant[];
    }
  /**
   * A form **another feature's** menu takes — a subclass adding an option to a
   * pool it does not declare.
   *
   * The owner's ruling on Channel Divinity: it "is a shell with one shared
   * pool, and each option is a form the shell takes". A level 3 Life Cleric
   * has three of them — Divine Spark, Turn Undead and Preserve Life — spent in
   * any combination out of the uses the *class* feature sized. So the shape
   * the Cleric already declares is the right one and what was missing is the
   * door: `options` hangs off the pool grant that prices it, and a subclass
   * feature has no pool grant and must not grow one.
   *
   * **A grant of its own rather than a second pool**, and the failure it
   * avoids is the one the whole vocabulary is built around: a Preserve Life
   * with uses of its own would be two pools where the book prints one, so a
   * Cleric who turned undead twice would still have a Preserve Life in hand.
   * It is `casting-options`' argument with the host changed — that grant
   * spends a pool another feature declared, and this one joins a menu another
   * feature prints.
   *
   * What the options themselves are is unchanged: the same
   * {@link PoolOptionGrant} the host's own menu is written in, compiled onto
   * the sheet under the **host's** id, at the host's class level and on the
   * host's spellcasting ability — because a Channel Divinity option's DC is
   * "the spell save DC from this class's Spellcasting feature" wherever the
   * option was written down.
   */
  | {
      readonly kind: 'pool-options';
      /**
       * The feature whose menu these join — SRD's Channel Divinity.
       *
       * Checked by `checkContent` against the features in scope, which for a
       * subclass is its own and its parent class's: a form that names a menu
       * nobody prints, or one that arrives later than the form does, is a line
       * on a class table that looks executed and is inert.
       */
      readonly feature: string;
      /** Forms added to the menu, each with an id the caller who spends names. */
      readonly options?: readonly PoolOptionGrant[];
      /**
       * Forms already on the menu that this feature **changes** — SRD Sear
       * Undead.
       *
       * The other half of the same door. Joining a menu was the only thing a
       * later feature could do to an earlier one's pool, and the SRD writes
       * both sentences: Preserve Life adds a way to spend a Channel Divinity,
       * and Sear Undead says "Whenever you use Turn Undead, you can roll a
       * number of d8s … Each Undead that fails its saving throw against that
       * use of Turn Undead takes Radiant damage equal to the roll's total."
       * Nothing is added to the menu by that sentence; one entry on it does
       * more.
       *
       * `checkContent` holds each amendment to an option the host really
       * prints, off the same set the add form is checked against — an
       * amendment naming a form nobody wrote is a feature that validates,
       * compiles and changes nothing.
       */
      readonly amends?: readonly PoolOptionAmendment[];
    }
  /**
   * An effect list bought by **a hit that has already landed**, rather than by
   * an action its holder takes.
   *
   * SRD Stunning Strike is the shape this is built to: "Once per turn when you
   * hit a creature with a Monk weapon or an Unarmed Strike, you can expend 1
   * Focus Point to attempt a stunning strike. The target must make a
   * Constitution saving throw." A Cunning Strike, an Open Hand Technique and a
   * Goliath's Hill's Tumble write the same sentence about the same moment.
   *
   * **The trigger is the whole of what is new.** What an option buys is
   * {@link PoolOptionGrant}'s effect list over again — the same `runEffects`
   * loop, the same feature origin, the same `featureSource` on whatever it
   * hangs — because a rider with a resolver of its own would be a second place
   * for every rules fix to be missed. What a pool option cannot say is *when*:
   * every option on a Channel Divinity's menu is a purchase somebody makes
   * with an action, and this one is bought by an attack roll that has already
   * been settled.
   *
   * **A grant of its own rather than a field on the pool grant**, and SRD is
   * why: Stunning Strike spends Monk's Focus, which is a *different feature's*
   * pool, and Open Hand Technique spends nothing at all. A pool grant declares
   * the pool it is — its key, its sizing, its recovery — so a feature that
   * spends somebody else's would have to redeclare all three and would resize
   * the pool it borrowed.
   *
   * **What it is not is a Reaction.** A Reaction is a window somebody answers
   * and costs the answerer their Reaction; this is the attacker's own hit, and
   * the SRD charges the action economy nothing for it.
   */
  | {
      readonly kind: 'on-hit';
      /**
       * The pool a use is spent from — SRD Stunning Strike's "expend 1 Focus
       * Point", which is Monk's Focus rather than a pool of this feature's own.
       *
       * Absent where the book charges nothing, which is Open Hand Technique and
       * the Goliath's boons: "you can impose one of the following effects" with
       * no price at all. A cost with no pool to take it from is refused.
       */
      readonly pool?: string;
      /** How many uses one rider costs. Absent is one, which is what SRD prints. */
      readonly costs?: number;
      /**
       * SRD Stunning Strike: "**Once per turn** when you hit a creature".
       *
       * The allowance `attack-damage` already counts and counted the same way:
       * a `feature-used` mark under this feature's id and the turn it was spent
       * on. Outside combat there are no turns and nothing restricts it.
       */
      readonly oncePerTurn?: boolean;
      /**
       * The weapons the hit has to have been made with — SRD's "with a Monk
       * weapon".
       *
       * Absent asks nothing, which is the Goliath's "when you hit a creature
       * with an attack roll". An Unarmed Strike is in no set of weapons because
       * it is not a weapon, so a rule that covers both says so in two clauses
       * exactly as SRD Martial Arts does — see {@link unarmedStrike}.
       */
      readonly weapons?: readonly WeaponSelector[];
      /** SRD Stunning Strike: "or an Unarmed Strike", the second clause. */
      readonly unarmedStrike?: boolean;
      /**
       * The purchase the swing has to have been **bought by** — SRD Open Hand
       * Technique's "an attack granted by your Flurry of Blows".
       *
       * A third clause beside {@link weapons} and {@link unarmedStrike}, and a
       * different question from both: those ask what is in the holder's hand
       * and this asks where the swing came from. `budgetPurchaseSlot`'s key,
       * `<feature>/<purchase>`, which is the one string a purchase already
       * mints and the one the budget already pins.
       *
       * Absent asks nothing, which is every other rider in the book: SRD
       * Stunning Strike rides on any qualifying swing and a Goliath's boon on
       * "an attack roll".
       */
      readonly fromGrant?: string;
      /**
       * The ability the save DC is derived from, where the feature prints one.
       *
       * SRD Monk's Focus: "Some features that use Focus Points require your
       * target to make a saving throw. The save DC equals 8 plus your Wisdom
       * modifier and Proficiency Bonus." A Monk casts nothing, so the spell
       * save DC a pool option falls back to is a number the class does not
       * have — and what it would fall back to instead is an item's `8 +
       * Proficiency Bonus`, which is the Monk's own DC short by a Wisdom
       * modifier.
       *
       * Absent means the granting class's spellcasting ability, which is what
       * SRD Channel Divinity says ("the DC equals the spell save DC from this
       * class's Spellcasting feature") and what a pool option already reads.
       */
      readonly saveAbility?: Ability;
      /**
       * SRD Hill's Tumble: "When you hit a **Large or smaller** creature with
       * an attack roll and deal damage to it."
       *
       * On the grant rather than on each option, because the SRD writes the
       * clause in the trigger sentence — the same place {@link weapons} and
       * {@link oncePerTurn} are written — and every option a feature that
       * prints one offers is bought by that same hit. Absent asks nothing,
       * which is every other rider in the book.
       *
       * Read through `effectiveSizeOf` at the swing, so the refusal arrives
       * before the action and before the die; a printed line's identical
       * `ifNoLargerThan` is answered after the blow instead, because nobody
       * asked for that one.
       */
      readonly targetNoLargerThan?: CreatureSize;
      /**
       * A **sibling feature's extra damage dice**, spent as the price of a
       * rider.
       *
       * SRD Cunning Strike: "Each effect has a die cost, which is the number
       * of Sneak Attack damage dice you must forgo to add the effect. You
       * remove the die before rolling."
       *
       * **Named the way {@link pool} is named, and for the same sentence.**
       * Stunning Strike spends a *different feature's* pool and says which;
       * this spends a different feature's dice and says which. The engine
       * knows no feature by name, so what is written here is the id of the
       * `standing` grant whose `attack-damage` dice pay — checked by
       * `checkContent` against the features in scope, exactly as
       * `recoversSooner.withFeature` is.
       *
       * **Never beside {@link pool}.** A rider is bought with one currency:
       * the book prices each of these sentences once, and a grant that named
       * both would be two prices for one purchase with nothing to say which
       * came first.
       *
       * The count is on the option rather than here, because the book puts it
       * there — "**Each effect** has a die cost" — and Devious Strikes prices
       * its six differently on one feature.
       */
      readonly forgoesDiceOf?: string;
      /** What a rider buys, by name. One of them is named at the hit. */
      readonly options: readonly HitOptionGrant[];
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
  /**
   * A menu of things a casting may buy, priced in a pool — see
   * {@link CastingOptionGrant}.
   *
   * SRD Metamagic, which is the only feature in the book that changes what a
   * casting *costs* rather than what it does. The pool is another feature's:
   * Font of Magic declares the Sorcery Points and Metamagic spends them, which
   * is why the key is a field here rather than a pool this grant owns.
   */
  | {
      readonly kind: 'casting-options';
      /**
       * The key of the pool every option is priced in.
       *
       * Declared by some other feature's `pool` grant. A feature that both
       * declared the pool and spent it would be `FeatureGrant.grants` carrying
       * two grants, which it does not.
       */
      readonly pool: string;
      /**
       * How many of this feature's options may ride on one casting.
       *
       * SRD Metamagic: "You can use only one Metamagic option on a spell when
       * you cast it unless otherwise noted in one of those options." The
       * *unless* is a later feature lifting an earlier feature's limit, which
       * is a shape the vocabulary does not have — so this is the printed one
       * and nothing raises it.
       */
      readonly perCasting: number;
      readonly options: readonly CastingOptionGrant[];
    }
  /**
   * One resource spent to buy another.
   *
   * The member beside it gives a pool's uses **back**; this one pays for them
   * out of something else, which is the half the SRD writes constantly and the
   * engine had no word for: "you can give yourself one use by expending a
   * spell slot", "you can expend one use of Wild Shape to give yourself a
   * level 1 spell slot", "you can expend a spell slot to regain one expended
   * use of Bardic Inspiration".
   *
   * **A list, because the SRD prints two directions in one feature**, and two
   * `trade` grants on one feature are refused for the reason every repeated
   * kind but two is: a command looking for the trade would find both. Wild Resurgence is two sentences with two
   * different limits and two different conditions — `PoolOptionGrant` and
   * `ReactionGrantEffect.does` are lists for exactly this reason.
   *
   * **What it is not is a new kind of pool.** Both ends are pools the engine
   * already has, named by key, and the arithmetic is `spend` and `restore` in
   * `resources.ts`. So a trade can never mint a use above a pool's maximum:
   * "give yourself a level 1 spell slot" gives back one the caster has spent,
   * and a caster holding all of theirs is refused rather than handed a slot
   * their class table never printed. That refusal is the conservative reading
   * of a sentence this engine has nowhere to put, and it is stated rather than
   * hidden — `tradeResource` names it `nothing_to_regain`.
   */
  | {
      readonly kind: 'trade';
      /** At least one, each with an id the command names. */
      readonly trades: readonly ResourceTradeGrant[];
      /**
       * The pool this feature's trades run between, where *this* feature is
       * also the one that declares it.
       *
       * The move `reaction`'s own `declares` already makes, for the same
       * reason and with the same words: SRD Font of Magic is one feature that
       * both declares the Sorcery Points and prints the two conversions they
       * run through. Splitting it would put a printed feature's name on two
       * ids, and leaving the declaration out would take the pool off every
       * Sorcerer's sheet.
       *
       * Absent where the pool belongs to another feature, which is the
       * commoner case — SRD Wild Resurgence trades Wild Shape's uses and
       * declares none of them.
       */
      readonly pool?: string;
      readonly poolLabel?: string;
      /** Set where *this* feature is the one that declares {@link pool}. */
      readonly declares?: PoolSizing & { readonly recovers: Recovery };
    }
  | {
      readonly kind: 'unarmored-defense';
      readonly ability: Ability;
      /** SRD Barbarian: "You can use a Shield and still gain this benefit." */
      readonly shieldAllowed: boolean;
    }
  /**
   * A creature that becomes another creature for a while: SRD Wild Shape.
   *
   * "Your game statistics are replaced by the Beast's stat block, but you
   * retain your creature type; Hit Points; Hit Point Dice; Intelligence,
   * Wisdom, and Charisma scores; class features; languages; and feats." The
   * grant names what that sentence leaves to the class — which type of block,
   * the rows of the Beast Shapes table, how the hours and the Temporary Hit
   * Points scale with the level, which scores are kept — and the engine does
   * the laying-over in `assumeStatBlock`, so a second class printing the same
   * sentence over Elementals writes a grant and no engine line.
   *
   * **It declares its own pool, as `activated` does**, because the SRD prints
   * the uses on the same feature ("You can use Wild Shape twice"); a feature
   * spending a pool it does not declare is Cutting Words' shape, not this one.
   * The forms a character *knows* are a choice on the character —
   * `CharacterChoices.knownForms` — checked against the row for the class
   * level, because the list is the player's and the ceiling is the table's.
   *
   * Not a member of `activated`, and the difference is what the fold holds.
   * What an activation does is standing effects requiring `feature-active`,
   * re-read from the world on every read; a form is the opposite — a whole
   * sheet pinned at the moment of use and put back by a derived pass when the
   * feature ends. The two share `feature-activated` and the `feature` timer,
   * which is what lets one Incapacitated end both.
   */
  | {
      readonly kind: 'shape-shift';
      /** SRD Wild Shape: "As a Bonus Action" — to enter, and to leave early. */
      readonly action: 'action' | 'bonus-action' | 'none';
      /** The pool a use comes out of, declared here. */
      readonly pool: string;
      readonly poolLabel?: string;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      readonly recovers?: Recovery;
      /** SRD: "You regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      /** The creature type a form must print: SRD "a Beast form". */
      readonly formType: string;
      /** The Beast Shapes table: one row per level at which it changes, ascending. */
      readonly forms: readonly ShapeShiftRow[];
      /**
       * SRD: "a number of hours equal to half your Druid level" — the class
       * level times this, rounded down as every fraction in the game is.
       */
      readonly hoursPerLevel: number;
      /** SRD: "Temporary Hit Points equal to your Druid level" — per class level. */
      readonly temporaryHitPointsPerLevel?: number;
      /** What the holder keeps of their own sheet: the three mental scores. */
      readonly keeps: { readonly abilities: readonly Ability[] };
      /** SRD: "You can't cast spells." */
      readonly forbidsCasting?: boolean;
    }
  /**
   * Hit points a feature adds to the maximum the class table already gives.
   *
   * **Written here rather than through the `hit-point-maximum` spell effect,
   * and the difference is the lifetime.** A casting's maximum is a sourced
   * grant hung on a creature: `settleHitPointMaxima` holds `Vitals.hpMax` up
   * while the casting runs and every ending gives it back, which is SRD Aid.
   * A feature's is not a loan — it is part of what the class table says the
   * maximum *is*, the number `hpMax - hpMaxAdjustment` denotes, recomputed by
   * every level-up and taken away by nothing. So it is resolved in
   * `planCharacter`'s own arithmetic, which is also what makes advancement
   * right without a word: `advanceCharacter` subtracts the **unadjusted**
   * maximum before asking what the new level was worth.
   *
   * **The per-level term is one hit point, and the SRD is why.** Both writers
   * print the same two sentences with the same second half — Dwarven
   * Toughness's "increases by 1, and it increases by 1 again whenever you gain
   * a level" and Draconic Resilience's "increases by 3, and it increases by 1
   * whenever you gain another Sorcerer level" — so the flat and the step are
   * different numbers and only the flat varies. A feature whose step is not 1
   * would need a field, and no printed feature has one.
   *
   * The fork {@link PoolSizing.perClassLevel} already draws: Dwarven
   * Toughness counts **character** levels and Draconic Resilience counts the
   * Sorcerer's own, so a Sorcerer 3 / Fighter 2 has three of the one and five
   * of the other. Either way the step is counted from the level the feature
   * itself arrives at, because that is the level at which the flat was given.
   */
  | {
      readonly kind: 'hit-point-maximum';
      /** What the feature is worth at the level it arrives: Draconic Resilience's 3. */
      readonly flat: number;
      /** Whose levels the "and 1 again whenever you gain a level" counts. */
      readonly perLevel?: 'character' | 'class';
    }
  /**
   * A choice the holder answers **again** whenever they finish a rest.
   *
   * SRD Circle of the Land Spells: "Whenever you finish a Long Rest, choose one
   * type of land: arid, polar, temperate, or tropical … you have the spells
   * listed for your Druid level and lower prepared." SRD Memorize Spell:
   * "Whenever you finish a Short Rest, you can study your spellbook and replace
   * one of the level 1+ Wizard spells you have prepared … with another level 1+
   * spell from the book."
   *
   * **What is declared here is the question, not the answer.** Everything a
   * re-choice changes is already a `CharacterChoices` field that creation reads
   * — the land is this feature's own `choice`, the swap is `preparedSpells` —
   * and a re-choice is the same field answered a second time, run back through
   * `planCharacter` by `rechooseCharacter` so that only the differences are
   * emitted. A grant that carried the *new* answer would be a second place the
   * character is derived from, and the two would eventually disagree.
   *
   * **A grant rather than a note on the rest**, and rule 4 is why: "the engine
   * holds no catalogue". `endRest` must be able to ask which questions this
   * character's features re-ask without naming a feature, a class or a subclass,
   * and this is what it asks.
   *
   * **The rest named here is the rest the holder *finished*.** A Long Rest
   * broken after an hour pays out a Short Rest's benefits and is not a Short
   * Rest somebody finished, so it re-asks nothing: both printed features open
   * with "Whenever you finish", and a broken rest is the one thing that did not
   * happen.
   */
  | {
      readonly kind: 'rechosen-on-a-rest';
      /** Which rest re-asks it. */
      readonly rest: RestKind;
      /** Which of the character's own answers is re-asked. */
      readonly rechooses: RestRechoice;
    }
  /**
   * How long a Long Rest takes this creature — SRD Trance's four hours.
   *
   * A rest's length was one of the constants `a-rule-the-engine-fixes-for-
   * everybody` was named for: eight hours held inside `rest.ts` for every
   * creature alive, so a trait that shortens it for its holder had nothing to
   * bend. This is the per-creature answer, compiled onto
   * `CharacterSheet.longRestSeconds` and absent everywhere nobody printed one.
   *
   * **A member of its own rather than a `standing` effect**, and the reading
   * `standing.ts` insists on is why: a standing grant is derived from its
   * holder's state on every read, *because* what it says is conditional. This
   * is not. An Elf Stunned, Poisoned, in Heavy armour or at one hit point
   * finishes a Long Rest in four hours, so there is no state for a reader to
   * consult and a derived grant would recompute one number for ever.
   *
   * **Only the Long Rest**, because only the Long Rest has a writer: the SRD
   * prints no trait that shortens a Short Rest, and a field for one would be a
   * column of a book nobody has written. The sixteen-hour cooldown is
   * untouched for the sharper version of the same reason — Trance says nothing
   * about it, and shortening it would be the engine inventing a sentence.
   */
  | { readonly kind: 'long-rest-length'; readonly seconds: number }
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
 * One option of a choice, and the grant that belongs to it alone.
 *
 * SRD writes "You gain one of the following options of your choice" over
 * feature after feature, and what follows the colon is **anything**: Hunter's
 * Prey's extra damage is a standing benefit, Divine Order's extra cantrip is a
 * `spells` grant, Giant Ancestry's Stone's Endurance is a Reaction. The gate
 * lived on the `standing` member alone until the second kind wanted it, which
 * made it a property of one grant kind rather than of the sentence.
 *
 * **Per grant and never per feature**, which is the decision worth writing
 * down: SRD Elven Lineage is one printed feature that wants a Wood Elf's Speed
 * *and* a Drow's Darkvision *and* a cantrip that differs per lineage, and a
 * gate on the feature could only say one of the three. A feature whose chosen
 * option is the other one grants nothing at all, which is different from
 * granting something inert.
 *
 * Applied in exactly one place — `grantedFeatures` in `creation.ts`, before
 * any grant is compiled — so the pools, the Reactions, the spells, the
 * activations, the hit points and the standing loop all see only the grants
 * whose option was taken. A gate honoured by whichever pass remembered to ask
 * is a gate with a hole in it.
 */
export interface GrantGate {
  /** The option this grant belongs to, out of the ones the choice offers. */
  readonly onlyIfChoice?: string;
  /**
   * Where that choice was made, when it was not made on this feature.
   *
   * The SRD writes a species as one trait that asks which ancestry, lineage or
   * legacy you have and later traits written as "determined by" it. The choice
   * is one fact and belongs to one feature; a second feature restating it
   * would be the player typing an answer they have already given, and two
   * places to disagree about it.
   *
   * So a grant may name the feature whose choice it reads, and the validator
   * holds the name to a **sibling** — a feature of the same class, subclass,
   * species or background — that asks a choice and does not arrive later than
   * this one. Both things a grant reads off a choice follow it: the gate above
   * and a `standing` grant's damage types. Absent means this feature's own
   * choice, which is the ordinary case.
   */
  readonly choiceFrom?: string;
}

/**
 * What a **feature** grants: one of the kinds above, and the option it belongs
 * to where the feature offers several.
 *
 * The intersection rather than a field on each of two dozen members, which is
 * the same type either way and one place to document it. A feat's grant and an
 * item's are {@link FeatureGrant} without the gate, because neither has a
 * choice to read — `checkContent` refuses `onlyIfChoice` and `choiceFrom` by
 * name on the one kind either of them may carry a gate-bearing field on, and
 * the type says it one step earlier for every kind.
 */
export type GatedFeatureGrant = FeatureGrant & GrantGate;

/**
 * The grants one feature carries, however it wrote them.
 *
 * `FeatureDefinition.grants` was singular until SRD Draconic Resilience, which
 * is one printed heading over two mechanics — an unarmoured Armour Class and a
 * hit point maximum — and the vocabulary could say only the first. Gate G1
 * decided the plural and this is it: one grant or a list of them, so every
 * entry written against the singular field stays valid, and one normaliser
 * every reader goes through.
 *
 * **Splitting the page's feature into two ids is the answer that was refused**,
 * and for a reason outside the vocabulary: the ledger population, the origin
 * sweep and the surface's `holdingsOf` are all keyed by the feature the book
 * prints, so a second id would be a feature nobody printed turning up in every
 * report.
 *
 * Named `featureGrants` because `grantsOf` is taken: `fold/release.ts` uses it
 * for the ten families of effect hung on a creature, which is a different
 * question with a similar shape.
 */
export const featureGrants = (
  feature: { readonly grants?: GatedFeatureGrant | readonly GatedFeatureGrant[] } | undefined,
): readonly GatedFeatureGrant[] => {
  const grants = feature?.grants;
  if (grants === undefined) return [];
  return Array.isArray(grants) ? grants : [grants as GatedFeatureGrant];
};

/**
 * One end of a trade: what is spent, or what is bought.
 *
 * Two members, because the SRD's trades are between a feature's pool and a
 * spell slot in both directions and nothing else. A spell slot is not "a pool
 * called `spell-slot:1`" here for the reason `pactSlotKey` exists: the key
 * carries a level, and a grant that wrote the key out would be content
 * spelling a derivation the engine owns.
 */
export type TradedResource =
  /** A named pool — the feature's own, or another feature's. */
  | { readonly kind: 'pool'; readonly key: string; readonly uses: TradedAmount }
  /**
   * A spell slot.
   *
   * The level is **required where one is bought** and optional where one is
   * spent: SRD gives "a level 1 spell slot" and takes "a spell slot", so the
   * caller says which they are burning and the engine never picks between
   * candidates the caller could have named.
   *
   * A **bought** slot with no level is the third answer and the mirror of the
   * second: SRD Font of Magic creates a slot at a level the Sorcerer picks,
   * and what tells the engine so is the price — the other end pays by the
   * table in {@link TradedAmount}, which is indexed by the level bought and
   * could not be read if nobody chose one.
   */
  | { readonly kind: 'spell-slot'; readonly level?: number }
  /**
   * Several spell slots at once, the caller naming their levels, bounded by
   * their **combined** level rather than priced one at a time.
   *
   * SRD Arcane Recovery: "you can choose expended spell slots to recover. The
   * spell slots can have a combined level equal to no more than half your
   * Wizard level (round up), and none of them can be level 6+."
   *
   * A member of its own rather than a field on the one above, because it is a
   * different sentence with a different bound: the slot above is bought and
   * priced, and these are chosen inside an allowance and cost nothing each.
   * It only ever appears as what a trade **gains** — nothing in the book
   * spends a handful of slots at once.
   */
  | {
      readonly kind: 'spell-slots';
      /**
       * The allowance, resolved at the granting class's own level at creation.
       *
       * One member, because the SRD prints one sentence of this shape. Named
       * rather than computed here for `RecoveryFeature.upTo`'s reason: the
       * word carries which way it rounds, and "half your Sorcerer level (round
       * down)" is already a different word one file over.
       */
      readonly combinedLevel: 'half-class-level-round-up';
      /** SRD: "none of them can be level 6+", which is a maximum of 5. */
      readonly maxLevel: number;
    };

/**
 * How many uses one end of a trade moves.
 *
 * A flat number for every trade the SRD prints one on, and one derivation the
 * engine owns rather than letting a class file spell out: SRD Font of Magic,
 * "you can expend a spell slot to gain a number of Sorcery Points **equal to
 * the slot's level**". The level it reads is the one in this same trade —
 * there is exactly one slot in a trade and the caller has just named it — so
 * `checkContent` refuses it on a trade whose other end is not a slot the
 * caller levels.
 */
export type TradedAmount =
  | number
  | 'the-slot-level'
  /**
   * SRD Font of Magic's Created Spell Slots table: what one slot costs, by the
   * level of the slot being bought. Index 0 is a level 1 slot.
   *
   * It sits on the end that **pays**, because that is what it is — the number
   * of Sorcery Points expended — and a table beside the thing bought would be
   * a price nothing charged, with a flat `uses` next to it that no reader
   * reads. Its length is also the cap the SRD prints in the same breath: "You
   * can create a spell slot no higher than level 5" is five rows, not a sixth
   * field that can disagree with them.
   */
  | { readonly byBoughtSlotLevel: readonly number[] };

/**
 * One direction of a trade, with the clause that limits it.
 *
 * Every field is one of the SRD's own words on Wild Resurgence, which is the
 * feature this was written from: "Once on each of your turns" ({@link limit}),
 * "if you have no uses of Wild Shape left" ({@link onlyIfEmpty}), "(no action
 * required)" ({@link action}), and "you can't do so again until you finish a
 * Long Rest", which is a pool of one — the same reading `recovery` takes of
 * the same sentence, so it is the same mechanism rather than a second kind of
 * limit beside the pools.
 */
export interface ResourceTradeGrant {
  /** Named, because a feature offers more than one and a command says which. */
  readonly id: string;
  /** What the log calls it. The feature's own name where this is absent. */
  readonly name?: string;
  /** SRD's "(no action required)" is `none`. */
  readonly action: 'none' | 'action' | 'bonus-action';
  readonly spends: TradedResource;
  readonly gains: TradedResource;
  /**
   * The clause that limits it, **including the one that says there is none**.
   *
   * The pair was Wild Resurgence's two sentences and nothing else, and its own
   * declaration named the three features waiting on a third member: Font of
   * Inspiration is "a spell slot bought into a pool, with no action and no
   * limit", Sorcery Incarnate is "one pool spent to refill another", and Holy
   * Nimbus's is "a slot spent on a feature's own pool". None of the three
   * prints a limit of any kind, and the reason to say so with a member rather
   * than by leaving the field out is the failure a widening like this one
   * causes: an **absent** limit is a value every reader has to remember to
   * treat as "no limit", and one reader forgetting turns Font of Inspiration
   * into a once-a-turn feature that nothing would catch. There is no absence
   * here to misread — a trade states which of the three it is, and `tsc`
   * refuses one that states none.
   *
   * What still bounds an unlimited trade is what it spends: the Bard runs out
   * of slots, the Sorcerer out of points, and a trade that would give back
   * more than was spent is `nothing_to_regain` whatever its limit says.
   */
  readonly limit: 'once-per-turn' | 'once-per-long-rest' | 'unlimited';
  /**
   * The moment the trade may be made at, where the SRD names one.
   *
   * SRD Arcane Recovery: "**When you finish a Short Rest**, you can choose
   * expended spell slots to recover." The same word `recovery`'s own `moment`
   * carries and read the same way — `lastShortRestAt` against the clock —
   * because it is the same sentence with the free half made expensive.
   *
   * Absent on a trade the book lets its holder make whenever they like, which
   * is every other one: {@link limit} bounds how often and this bounds when,
   * and only Arcane Recovery prints both.
   */
  readonly moment?: 'short-rest';
  /**
   * A pool of one this trade **declares**, because neither of the two
   * sentences that need it has a pool of its own to spend, and a second `pool`
   * grant beside this one would be a second resource rather than this limit.
   *
   * It is read two ways, and {@link limit} says which:
   *
   * - `once-per-long-rest` — the pool *is* the limit. SRD Wild Resurgence:
   *   "you can't do so again until you finish a Long Rest", which is a pool of
   *   one, the same reading `recovery` takes of the same sentence. The trade
   *   spends it.
   * - `unlimited` — the pool is what the trade **fills**, and then it must be
   *   the one {@link gains} names. SRD Holy Nimbus: "Once you use this feature,
   *   you can't use it again until you finish a Long Rest, unless you expend a
   *   level 5 spell slot to restore your use of it." The feature's own single
   *   use is a pool of one; the trade buys it back and spends nothing of it.
   *
   * A once-a-turn trade declares none: the turn's own ledger counts that one,
   * so a pool beside it would be one nothing ever spends.
   */
  readonly pool?: string;
  readonly poolLabel?: string;
  /**
   * SRD Wild Resurgence: "**if you have no uses of Wild Shape left**".
   *
   * The key of a pool that must be empty for the trade to be legal. A clause
   * about the holder's own resources rather than about the world, which is why
   * it is here and not a `StandingRequirement`.
   */
  readonly onlyIfEmpty?: string;
}

/**
 * How the SRD sizes a pool, in the three ways it does.
 *
 * Named rather than restated because two grants need the same three, and the
 * one function that reads them — `poolSizeOf` — must read them identically.
 */
/**
 * One row of a shape-shifting feature's table — SRD Beast Shapes.
 *
 * Read at the class level like every other column: the row with the highest
 * `fromLevel` the character has reached is the one that holds.
 */
export interface ShapeShiftRow {
  /** The class level this row arrives at. */
  readonly fromLevel: number;
  /** How many forms are known at once. */
  readonly known: number;
  /** The highest Challenge Rating a form may print. */
  readonly maxChallengeRating: number;
  /** Whether a form with a Fly Speed may be taken. */
  readonly flying: boolean;
}

export interface PoolSizing {
  /** Uses by class level, straight off the class table. */
  readonly usesByLevel?: readonly number[];
  /** SRD Dark One's Own Luck: "equal to your Charisma modifier". */
  readonly fromAbilityModifier?: Ability;
  /** The floor that modifier cannot go below: "(minimum of once)". */
  readonly minimum?: number;
  /** SRD Lay On Hands: "five times your Paladin level". */
  readonly perClassLevel?: number;
  /**
   * SRD Breath Weapon, Stonecunning, Adrenaline Rush: "a number of times equal
   * to your Proficiency Bonus" — the sizing every origin trait with a limit
   * prints, and one no class table could give, because a species has no table.
   * Read at the **character's** level, since that is whose bonus it is, and
   * grown by advancement exactly as a column is.
   */
  readonly perProficiencyBonus?: true;
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
  | {
      readonly kind: 'reroll';
      readonly bonus?: 'class-level';
      /**
       * Which D20 Tests it answers. Absent is SRD Indomitable's "If you fail
       * a saving throw": saving throws alone. SRD Heroic Inspiration answers
       * "any die", which on this window is both kinds of test.
       *
       * Every reroll answers a **failure**, and there is no field for the
       * other outcome on purpose. Heroic Inspiration's sentence would let a
       * made roll be thrown again too, and the window stays shut on one: a
       * window that opened on every check a Human made would turn every
       * ordinary roll into a two-command negotiation, and the one case where a
       * made roll's total still matters — a Stealth check's total is the DC to
       * find the hider — is the table's to allow.
       */
      readonly tests?: readonly D20TestKind[];
    }
  | { readonly kind: 'melee-attack'; readonly withinFeet: number }
  /**
   * Damage dealt **back** to whoever struck — SRD Storm's Thunder: "When you
   * take damage from a creature within 60 feet of you, you can take a Reaction
   * to deal 1d8 Thunder damage to that creature."
   *
   * The fifth member, and the second window-answering shape the SRD writes
   * that `melee-attack` cannot say: Retaliation swings a weapon and this
   * throws dice at a creature sixty feet away with no attack roll, no save and
   * no weapon in it. It is the class of sentence SRD Hellish Rebuke writes as
   * a *spell* on the same window, which is what tells you it is a shape rather
   * than one trait's quirk.
   *
   * It lands through `dealSpellDamage`, so the target's Resistance, its
   * Temporary Hit Points, the Concentration the damage puts at risk and the
   * watcher that pays a Warlock for dropping it are the engine's usual
   * answers rather than a second set.
   */
  | {
      readonly kind: 'damage-back';
      /** SRD's "1d8". Rolled by the engine at the moment the Reaction is taken. */
      readonly dice: string;
      /** SRD's "Thunder". */
      readonly damageType: string;
      /**
       * SRD's "within 60 feet of you", measured to the creature that dealt the
       * triggering damage — the same question `melee-attack`'s `withinFeet`
       * asks of the same window, five feet further out than a sword reaches.
       */
      readonly within: number;
    };

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
