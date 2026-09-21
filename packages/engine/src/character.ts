import { SKILL_ABILITY, type Ability, type RollMode, type Skill } from '@ie/shared';
import type {
  ActivatedFeature,
  CastingOption,
  HealingTouch,
  HitOption,
  PoolOption,
  RecoveryFeature,
  SelfHealFeature,
  StandingEffect,
  StrikeStyle,
  TradeFeature,
} from './standing.js';
import type { ConferrableReaction, ReactionFeature } from './reactions.js';
import type {
  Armor,
  MonsterAttack,
  MonsterMultiattack,
  MonsterTrait,
  WeaponMastery,
} from '@ie/srd';

/**
 * Derived character statistics.
 *
 * Everything here is a pure function of a {@link CharacterSheet} — no dice, no
 * state, no I/O. These are the numbers the rest of the engine builds on: what a
 * check adds, what a save adds, what a hit has to beat.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export type AbilityScores = Readonly<Record<Ability, number>>;

/**
 * The ceiling on an ability score, for every character and every score no
 * feature has lifted.
 *
 * **Here rather than in `progression.ts` beside `MAX_LEVEL`, and rather than
 * as the bare `20` `creation.ts` used to carry inside one refusal.** A level
 * is progression's subject; a score is this file's — `AbilityScores` and
 * `abilityModifier` are what the rest of the engine reads a score through, so
 * the number a score may not pass belongs beside them, and one name is what
 * lets a second reader ask the same question rather than repeat the literal.
 *
 * It is a **default and not a constant of the rules**: an `ability-score-increase`
 * grant lifts it for the scores its own feature touches — SRD's Epic Boons
 * reach 30 and two capstones reach 25 — and nothing lifts it for all six at
 * once. `creation.ts` resolves the per-ability ceiling, because only the
 * character's features know which of them have been lifted.
 */
export const ABILITY_SCORE_MAXIMUM = 20;

/**
 * The highest score anything in the rules reaches, lifted ceiling included.
 *
 * SRD's Epic Boons print "to a maximum of 30" and nothing prints more, so 30
 * is what a score *can* be rather than what a character may raise one to —
 * the difference between this and {@link ABILITY_SCORE_MAXIMUM}. It is the
 * bound `checkAbilities` holds a raw assignment to and the bound an item that
 * **sets** a score is held to, and it is one name because it was the same
 * literal in two files the moment the second reader existed.
 */
export const MAX_ABILITY_SCORE = 30;

export type ProficiencyLevel = 'none' | 'proficient' | 'expertise';

export interface ArmorTraining {
  readonly light: boolean;
  readonly medium: boolean;
  readonly heavy: boolean;
  readonly shields: boolean;
}

/**
 * One attack a stat block prints, under the name it prints it: `Bite`.
 *
 * The line's own numbers — see `MonsterAttack` — plus the heading they were
 * printed under, because that heading is how a caller names the attack and how
 * a log reads afterwards.
 */
export interface StatedAttack extends MonsterAttack {
  readonly name: string;
}

/**
 * Values a stat block states outright instead of deriving.
 *
 * A character's Armour Class follows from what they are wearing and their
 * Dexterity; a monster's is simply printed. The same goes for its saving
 * throws, its skills and its proficiency bonus — a stat block can and does
 * carry numbers that no derivation would produce. Forcing a monster through
 * the character derivations would quietly change its numbers.
 *
 * **A block states what it *does* on the same terms it states what it is.**
 * `+4, reach 5 ft., 5 (1d6 + 2) Piercing` is four printed numbers, and the
 * Engine owing them to a caller rather than asking for them is the same rule
 * that put the printed Armour Class here. So the two lists below are on this
 * shelf beside the numbers rather than in the feature vocabulary a class is
 * written in: nothing compiled them, nothing may end them, and a reader
 * reaches them exactly where it reaches a monster's Armour Class.
 */
export interface StatedValues {
  readonly armorClass?: number;
  readonly proficiencyBonus?: number;
  /**
   * The Initiative modifier a stat block prints, which need not equal the
   * Dexterity modifier: an Adult Red Dragon has +0 Dexterity and Initiative
   * +12. Callers should never have to construct a compensating bonus.
   */
  readonly initiative?: number;
  readonly saves?: Partial<Record<Ability, number>>;
  readonly skills?: Partial<Record<Skill, number>>;
  /**
   * The attacks the block's Actions section prints, in printed order.
   *
   * Absent for every character and for a block whose attacks nobody could
   * read, which are the same absence: this creature makes no attack the engine
   * can roll on its own, and a caller who wants one names a weapon.
   */
  readonly attacks?: readonly StatedAttack[];
  /**
   * The mechanics the block's traits state, where the parser recognised one.
   *
   * A short list on purpose — a trait is English, and what is here is the
   * handful of sentences somebody has matched. The rest of a creature's traits
   * stay prose in the catalogue, where a DM reads them.
   */
  readonly traits?: readonly MonsterTrait[];
  /**
   * The **named sequence** the block's Multiattack prints, where it prints one
   * this engine can execute.
   *
   * A stat block is not a character's sheet. `attacksPerAction` says how many
   * swings the Attack action holds, which is the whole of what a class feature
   * gives — and it is *not* the whole of what a Multiattack says: "the ghoul
   * makes two Bite attacks" names the attacks as well as counting them, and a
   * creature allowed two of anything is a creature the book did not print.
   *
   * So the count and the composition are two fields, both stated: the count is
   * `attacksPerAction` above, derived from this one's total, and this is what
   * each of those swings is allowed to be. Absent for every character and for
   * every block whose sentence says something else — an alternative, a free
   * choice from a menu, a use that is not an attack — and absent is what the
   * engine had before any of this: one attack, named by the caller.
   *
   * Every name here is a line the same block prints, bound by the adapter
   * before it reaches the sheet, so nothing downstream has to wonder whether
   * a sequence names an attack that exists.
   */
  readonly multiattack?: MonsterMultiattack;
  /**
   * The **names** of the Actions lines the parser read nothing out of.
   *
   * Not the prose: a block's sentences are kilobytes and the stat block's id
   * is deliberately not stored either, so what is pinned is the shortest thing
   * that makes a report legible — "Multiattack", "Change Shape". The engine
   * branches on none of them; it quotes them.
   *
   * It exists because an absence otherwise looks like an answer. A block that
   * prints no Multiattack and a block whose Multiattack the parser could not
   * read both reach the sheet with no sequence on them, and only the second is
   * a creature whose Attack action the engine has *assumed* the size of — SRD
   * Hydra's "as many Bite attacks as it has heads" is the sentence.
   *
   * **It does not tell the two apart, and a reader must not think it does.**
   * Which line went unread is all this holds; whether that line was the one
   * that sized the action is exactly what the parser could not say. So a swing
   * whose block left *anything* unread reports what it was — a Winter Wolf's
   * Cold Breath as readily as a Hydra's Multiattack — and claims only that
   * something went unread. That is narrower than every stat block without a
   * sequence, which would be noise about a fact that is not missing, and wider
   * than the handful of blocks whose unread line is the one that sizes the
   * action — which is the honest width of what the engine knows.
   *
   * Absent for every character and for every block the parser read whole.
   */
  readonly unreadActions?: readonly string[];
}

export interface CharacterSheet {
  readonly level: number;
  readonly abilities: AbilityScores;
  readonly skills: Readonly<Partial<Record<Skill, ProficiencyLevel>>>;
  readonly saveProficiencies: readonly Ability[];
  /** Body armour worn, if any. Must not be a Shield. */
  readonly armor: Armor | null;
  /** Shield held, if any. Must be category `shield`. */
  readonly shield: Armor | null;
  readonly armorTraining: ArmorTraining;
  /** Walking speed in feet before armour penalties. */
  readonly baseSpeed: number;
  readonly spellcastingAbility: Ability | null;
  /**
   * Weapon categories this character is proficient with.
   *
   * The vocabulary a class definition uses — `simple`, `martial`, and the two
   * qualified ones the SRD actually prints: the Monk's "Martial weapons that
   * have the Light property" and the Rogue's "Martial weapons that have the
   * Finesse or Light property". Absent means nobody has said, and a creature
   * nobody has said about is treated as proficient — a stat block prints its
   * attack bonus outright, so deriving one for a monster would be inventing a
   * number the block already gave.
   */
  readonly weaponProficiencies?: readonly string[];
  /**
   * Alternative ways to work out base Armour Class, from class features.
   *
   * SRD writes three of these and they differ in both halves. Absent, and a
   * creature's Armour Class is derived exactly as it always was.
   */
  readonly unarmoredDefense?: readonly UnarmoredDefense[];
  /**
   * Benefits this creature's features grant for as long as their rule holds.
   *
   * Resolved at creation, evaluated from state at every read — see
   * `standing.ts`. On the sheet rather than on the creature because it is a
   * property of what the character *is*, not of what has happened to them:
   * nothing applies an aura and nothing takes it away.
   */
  readonly standing?: readonly StandingEffect[];
  /**
   * Features this character can switch on, and what switching them on costs.
   *
   * Resolved at creation like `standing`, and for the same reason: the reducer
   * has to know what ends a running Rage without re-deriving a class table on
   * every event.
   */
  readonly activated?: readonly ActivatedFeature[];
  /**
   * Features that give another pool's uses back — Sorcerous Restoration,
   * Magical Cunning.
   *
   * Resolved at creation beside `activated`, and for the same reason: what a
   * feature refills is named by a class table, and Pact Magic's pool key
   * carries a slot level that moves as the Warlock levels.
   */
  readonly recoveries?: readonly RecoveryFeature[];
  /**
   * Features that spend one resource to buy another — Wild Resurgence.
   *
   * Resolved at creation beside `recoveries`, and for the same reason: what a
   * trade gives and takes is a pool key, and a spell slot's key carries a
   * level the grant cannot write.
   */
  readonly trades?: readonly TradeFeature[];
  /**
   * Features whose use is spent to heal their own holder — Second Wind,
   * Wholeness of Body.
   *
   * Resolved at creation beside `recoveries`, because one of the two reads its
   * die off a class table.
   */
  readonly selfHeals?: readonly SelfHealFeature[];
  /**
   * Pools of hit points spent by touching somebody — Lay On Hands, and the
   * Restoring Touch that lengthens the list of conditions it lifts.
   *
   * Resolved at creation, because what one feature can lift is the union of
   * what several of them say.
   */
  readonly healingTouch?: readonly HealingTouch[];
  /**
   * What a use of a feature's pool buys, where what it buys is an effect list
   * — SRD Channel Divinity's menu.
   *
   * Resolved at creation beside `healingTouch`, and for the same reason both
   * of its neighbours are: the dice are a column of a class table read at that
   * class's own level, and the spellcasting ability the DC comes from belongs
   * to the class that granted the feature rather than to the character.
   */
  readonly poolOptions?: readonly PoolOption[];
  /**
   * What a casting of this character's may buy, and what each purchase costs
   * — SRD Metamagic's menu.
   *
   * Resolved at creation beside `poolOptions`, and for the nearer of that
   * field's two reasons: the menu the book prints is not the menu this
   * character has. SRD gives a Sorcerer "two Metamagic options of your choice"
   * out of ten, so the answer is read once, here, and the casting command sees
   * a sheet with two entries on it rather than a class table and a choice to
   * re-apply on every spell.
   */
  readonly castingOptions?: readonly CastingOption[];
  /**
   * What a **hit** buys, where what it buys is an effect list — SRD Stunning
   * Strike.
   *
   * Resolved at creation beside `poolOptions` and for its reasons: the DC is
   * the granting class's to derive, and the pool a rider spends belongs to a
   * feature that may not be this one. The attack path reads the sheet and
   * never a class table.
   */
  readonly hitOptions?: readonly HitOption[];
  /**
   * Reactions this character's features offer, and what each one costs.
   *
   * Resolved at creation beside `selfHeals`, because what one is worth is read
   * off a class table — Deflect Attacks adds the Monk's level, Cutting Words
   * rolls the Bardic Inspiration die, which is a d6 at Bard 1 and a d12 at 15.
   * Recomputing a class table to find out whether an attack opens a window is
   * not a thing to do on every swing.
   */
  readonly reactions?: readonly ReactionFeature[];
  /**
   * Reactions this character can hand to **somebody else** — SRD Bardic
   * Inspiration's die.
   *
   * Resolved at creation beside `reactions`, and for exactly the same reason:
   * the die is a column of the class table, read at that class's own level.
   * What makes it a second field rather than a flag on the first is who ends
   * up holding it — a Reaction on this list is never taken by this character,
   * and one on the list above is never given away.
   */
  readonly conferredReactions?: readonly ConferrableReaction[];
  /**
   * How many attacks this character's Attack action holds. One, unless a
   * feature says otherwise.
   *
   * SRD Multiclassing: "If you gain the Extra Attack feature from more than
   * one class, the features don't stack. You can't make more than two attacks
   * with this feature unless you have a feature that says you can." So a
   * Fighter/Ranger has two, not three — the highest grant wins rather than the
   * sum, and the Fighter's own later features are the ones that say more.
   */
  readonly attacksPerAction?: number;
  /**
   * The catalogue ids of the weapons this character has mastery with, sorted.
   *
   * SRD: "a weapon's mastery property is usable only by a character who has a
   * feature, such as Weapon Mastery, that unlocks the property" — so this is
   * the unlocking, per weapon kind, and the properties themselves are printed
   * on the weapons. On the sheet beside `criticalOn` for the reason that one
   * is: it is unconditional, there is no state of the world in which it is not
   * true, and an attack would otherwise re-derive a class table on every
   * swing.
   *
   * **Ids, which are the player's answer rather than the engine's list.** What
   * is written here came out of `featureChoices`, and nothing in the engine
   * names a weapon.
   */
  readonly weaponMasteries?: readonly string[];
  /**
   * Mastery properties this character may use **in place of** a weapon's own.
   *
   * SRD Tactical Master: "you can replace its mastery property with Push, Sap,
   * or Slow for that attack." The substitution is offered per attack and is
   * refused for any property not on this list.
   */
  readonly masterySubstitutions?: readonly WeaponMastery[];
  /**
   * The lowest natural d20 that scores a Critical Hit. 20 unless a feature
   * lowers it.
   *
   * SRD Improved Critical: "Your attack rolls with weapons and Unarmed Strikes
   * can score a Critical Hit on a roll of 19 or 20 on the d20", and Superior
   * Critical lowers it again to 18. On the sheet rather than in `standing.ts`
   * because it is unconditional — there is no state of the world in which a
   * Champion's 19 stops being a critical — and `attacksPerAction` beside it is
   * the same kind of always-on number read off the features.
   */
  readonly criticalOn?: number;
  /**
   * Ways this character's features redefine an attack of their own — the
   * Monk's growing fist, and whatever a homebrew class writes with the same
   * grant.
   *
   * Resolved at creation beside `reactions`, and for the same reason: the die
   * is a column of a class table read at *that class's* level, so a Monk 5 /
   * Fighter 5 rolls the Monk's d8 rather than a level 10 character's d10.
   *
   * **Not in `standing` beside the other conditional benefits**, because a
   * standing effect is a bonus or a mode hung on a creature and this is a
   * substitution inside one roll: which die is thrown at all, and which
   * ability is added to it. `attack.ts` is where those two are decided and a
   * `StandingGrant` has no member that could say either.
   */
  readonly strikeStyles?: readonly StrikeStyle[];
  /** Set for creatures whose numbers are printed rather than derived. */
  readonly stated?: StatedValues;
}

/**
 * SRD: "Ability Scores and Modifiers". Verified to match the printed table for
 * every score it lists — the formula rounds down, so odd negative scores land
 * where you might not expect (5 gives -3, not -2).
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** +2 at levels 1-4, rising by 1 every four levels to +6 at 17-20. */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function proficiencyBonus(sheet: CharacterSheet): number {
  return sheet.stated?.proficiencyBonus ?? proficiencyBonusForLevel(sheet.level);
}

/**
 * Half the Proficiency Bonus, rounded down.
 *
 * The Bard's Jack of All Trades adds this "to any ability check you make that
 * **uses a skill proficiency you lack** and that doesn't otherwise use your
 * Proficiency Bonus".
 *
 * Note what that excludes. Initiative is a *bare* Dexterity check — it uses no
 * skill at all — so Jack of All Trades does **not** apply to it, despite the
 * 2014 version having done so. Earlier guidance here said otherwise and had a
 * test enshrining it; both were wrong. The rounding is still worth a primitive.
 */
export function halfProficiencyBonus(sheet: CharacterSheet): number {
  return Math.floor(proficiencyBonus(sheet) / 2);
}

export function modifierFor(sheet: CharacterSheet, ability: Ability): number {
  return abilityModifier(sheet.abilities[ability]);
}

export function saveModifier(sheet: CharacterSheet, ability: Ability): number {
  const stated = sheet.stated?.saves?.[ability];
  if (stated !== undefined) return stated;

  const proficient = sheet.saveProficiencies.includes(ability);
  return modifierFor(sheet, ability) + (proficient ? proficiencyBonus(sheet) : 0);
}

export function skillModifier(sheet: CharacterSheet, skill: Skill): number {
  const stated = sheet.stated?.skills?.[skill];
  if (stated !== undefined) return stated;

  const ability = SKILL_ABILITY[skill];
  const level = sheet.skills[skill] ?? 'none';

  const multiplier = level === 'expertise' ? 2 : level === 'proficient' ? 1 : 0;
  return modifierFor(sheet, ability) + multiplier * proficiencyBonus(sheet);
}

/**
 * A class feature that replaces the Armour Class calculation.
 *
 * SRD writes three, and they differ in both halves — which ability joins
 * Dexterity, and whether a Shield is allowed:
 *
 * | Feature | Ability | Shield |
 * |---|---|---|
 * | Barbarian Unarmored Defense | Constitution | "You can use a Shield and still gain this benefit" |
 * | Monk Unarmored Defense | Wisdom | "or wielding a Shield" — forbidden |
 * | Draconic Resilience | Charisma | not mentioned, so allowed |
 *
 * The Monk's Shield clause is the half that gets dropped, and it is not the
 * obvious one: a Monk holding a Shield does not lose the Shield's bonus, they
 * lose the whole alternative calculation and fall back to 10 + Dexterity.
 *
 * None of these applies in armour — every one of them says "while you aren't
 * wearing armor" — so armour still replaces everything, as it always did.
 */
export interface UnarmoredDefense {
  /** The feature that grants it, so a log can say which rule made the number. */
  readonly source: string;
  /** The ability added alongside Dexterity. */
  readonly ability: Ability;
  /** SRD Monk: "while you aren't wearing armor **or wielding a Shield**". */
  readonly shieldAllowed: boolean;
}

/**
 * An alternative base Armour Class an **ongoing effect** supplies.
 *
 * SRD Mage Armor: "the target's base AC becomes 13 plus its Dexterity
 * modifier." That is the same shape {@link UnarmoredDefense} is — a base
 * calculation that replaces `10 + Dexterity` while the wearer is unarmoured,
 * competing with every other such calculation for the best applicable one —
 * and it differs in exactly two ways, which is why it is a second type rather
 * than a reuse of the first:
 *
 * - **the base is not 10.** Every class feature starts from the ordinary base
 *   and adds a second ability; Mage Armor states its own number and adds no
 *   second ability at all;
 * - **it is not on the sheet.** A feature is part of what a creature *is*; a
 *   spell's grant is part of what is currently happening to it, so it lives on
 *   `CreatureState` and carries the casting inside its `source` — the same
 *   link `ActiveBonus` uses, which is what ends it when the casting does.
 *
 * The comparison itself is shared: {@link armorClassCalculation} folds both
 * sources into one "best applicable" pass, because SRD Multiclassing settles
 * that question once for all of them — "If you have multiple ways to calculate
 * your Armor Class, you can benefit from only one at a time."
 */
export interface GrantedArmorClass {
  /** What granted it, carrying the casting: `Mage Armor#cast:3`. */
  readonly source: string;
  /**
   * The number Dexterity is added to: SRD Mage Armor's "13".
   *
   * 10 for every class feature, because every one of them is written as an
   * addition to the ordinary base. Mage Armor is the reason this is a field.
   */
  readonly base: number;
  /**
   * A **second** ability added alongside Dexterity, or null for none.
   *
   * Dexterity is in every base Armour Class calculation the SRD writes, so it
   * is in the formula rather than in this field — which is what the field
   * being null means for Mage Armor. "13 plus its Dexterity modifier" is
   * `base: 13, plusAbility: null`; a Barbarian's is `base: 10,
   * plusAbility: 'con'`. Naming this `ability` reads as though Mage Armor
   * should name Dexterity, and adds it twice.
   */
  readonly plusAbility: Ability | null;
  /** Whether a Shield still adds on top. */
  readonly shieldAllowed: boolean;
}

/** How a creature's Armour Class was arrived at, and by which rule. */
export interface ArmorClassCalculation {
  /** The base before a Shield: 10 + Dexterity, armour's own, or a feature's. */
  readonly base: number;
  /** What a Shield added, or 0. */
  readonly shield: number;
  /**
   * The feature whose calculation won, or null for the ordinary ones.
   *
   * Null covers both "10 + Dexterity" and "the armour being worn", because
   * neither is a feature and the sheet already says which of the two applied.
   */
  readonly source: string | null;
  readonly total: number;
}

/**
 * SRD: base AC is 10 + Dexterity modifier. Armour supplies a *different* base
 * calculation rather than adding to that one — you use one or the other, never
 * both. A Shield then adds on top of whichever base applies.
 *
 * A class feature is a third way, and SRD Multiclassing settles what happens
 * when a character has several: "If you have multiple ways to calculate your
 * Armor Class, you can benefit from only one at a time." That is a choice with
 * exactly one sensible answer — a higher Armour Class costs nothing and gives
 * up nothing — so the best *applicable* calculation is taken and recorded,
 * rather than asking a question whose answer is arithmetic. It is also why a
 * feature never lowers the number: 10 + Dexterity is itself one of the ways.
 *
 * `granted` is the same question asked by an ongoing effect rather than by a
 * feature — see {@link GrantedArmorClass}. It joins the same comparison rather
 * than being applied afterwards, which is what keeps Mage Armor from stacking
 * with a Barbarian's Unarmoured Defense, and it is consulted in the unarmoured
 * branch only, which is what keeps it from applying through plate.
 */
export function armorClassCalculation(
  sheet: CharacterSheet,
  granted: readonly GrantedArmorClass[] = [],
): ArmorClassCalculation {
  const stated = sheet.stated?.armorClass;
  if (stated !== undefined) {
    return { base: stated, shield: 0, source: null, total: stated };
  }

  const { armor, shield } = sheet;

  // Wrong slot is a programmer error, not a rules-legal refusal, so it throws.
  if (armor !== null && armor.category === 'shield') {
    throw new Error(`${armor.name} is a shield and cannot be worn as body armor`);
  }
  if (shield !== null && shield.category !== 'shield') {
    throw new Error(`${shield.name} is not a shield and cannot be held as one`);
  }

  const dex = modifierFor(sheet, 'dex');

  let base: number;
  let source: string | null = null;

  if (armor === null) {
    base = 10 + dex;
    // Every alternative reads Dexterity too, so they differ only in the second
    // ability — but the comparison is on the whole number, because a future
    // feature need not be shaped that way. Mage Armor is the proof of that:
    // it states its own base and adds no second ability.
    const alternatives: readonly GrantedArmorClass[] = [
      ...(sheet.unarmoredDefense ?? []).map((feature) => ({
        source: feature.source,
        base: 10,
        plusAbility: feature.ability as Ability | null,
        shieldAllowed: feature.shieldAllowed,
      })),
      ...granted,
    ];
    for (const alternative of alternatives) {
      if (shield !== null && !alternative.shieldAllowed) continue;
      const theirs =
        alternative.base +
        dex +
        (alternative.plusAbility === null ? 0 : modifierFor(sheet, alternative.plusAbility));
      if (theirs > base) {
        base = theirs;
        source = alternative.source;
      }
    }
  } else {
    const cap = armor.maxDexBonus;
    // The cap limits how much Dex helps; it never turns a penalty into a bonus.
    const dexContribution = armor.addsDexModifier ? (cap === null ? dex : Math.min(dex, cap)) : 0;
    base = (armor.baseAc ?? 10) + dexContribution;
  }

  // A Shield only helps someone trained to use one.
  const shieldBonus = shield !== null && sheet.armorTraining.shields ? (shield.acBonus ?? 0) : 0;

  return { base, shield: shieldBonus, source, total: base + shieldBonus };
}

export function armorClass(
  sheet: CharacterSheet,
  granted: readonly GrantedArmorClass[] = [],
): number {
  return armorClassCalculation(sheet, granted).total;
}

/**
 * SRD: armour listing a Strength score reduces speed by 10 feet unless the
 * wearer's Strength *score* — not modifier — meets it.
 */
export function speed(sheet: CharacterSheet): number {
  const requirement = sheet.armor?.strengthRequirement ?? null;
  const penalty = requirement !== null && sheet.abilities.str < requirement ? 10 : 0;
  return Math.max(0, sheet.baseSpeed - penalty);
}

/** SRD: armour marked "Disadvantage" imposes it on Dexterity (Stealth) checks. */
export function stealthRollMode(sheet: CharacterSheet): RollMode {
  return sheet.armor?.stealthDisadvantage === true ? 'disadvantage' : 'normal';
}

/**
 * SRD "Armor Training": wearing armour you lack training in gives Disadvantage
 * on any D20 Test involving Strength or Dexterity, and prevents spellcasting.
 * This reports the condition; applying it is the caller's job.
 */
export function untrainedArmorPenalty(sheet: CharacterSheet): boolean {
  const armor = sheet.armor;
  if (armor === null || armor.category === 'shield') return false;
  return !sheet.armorTraining[armor.category];
}

/**
 * SRD: 10 + the Wisdom (Perception) check modifier, adjusted by 5 in either
 * direction when the creature has advantage or disadvantage on those checks.
 */
export function passivePerception(sheet: CharacterSheet, mode: RollMode = 'normal'): number {
  const adjustment = mode === 'advantage' ? 5 : mode === 'disadvantage' ? -5 : 0;
  return 10 + skillModifier(sheet, 'perception') + adjustment;
}

/** SRD: 8 + Proficiency Bonus + spellcasting ability modifier. */
export function spellSaveDc(sheet: CharacterSheet): number | null {
  const ability = sheet.spellcastingAbility;
  if (ability === null) return null;
  return 8 + proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

/** SRD: Proficiency Bonus + spellcasting ability modifier. */
export function spellAttackModifier(sheet: CharacterSheet): number | null {
  const ability = sheet.spellcastingAbility;
  if (ability === null) return null;
  return spellAttackModifierWith(sheet, ability);
}

/**
 * The same numbers, for a spellcasting ability that is not the sheet's.
 *
 * A feat brings its own: SRD Magic Initiate says "Intelligence, Wisdom, or
 * Charisma is your spellcasting ability for this feat's spells (choose when
 * you select this feat)". Reading the class's ability for those would be quietly
 * wrong for every character whose feat ability differs — and flatly wrong for a
 * Fighter, who has none at all.
 */
export function spellAttackModifierWith(sheet: CharacterSheet, ability: Ability): number {
  return proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

export function spellSaveDcWith(sheet: CharacterSheet, ability: Ability): number {
  return 8 + proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

/**
 * What a creature adds to its Initiative roll.
 *
 * A character derives it from Dexterity. A stat block prints it, and the two
 * need not agree — an Adult Red Dragon has a +0 Dexterity modifier and prints
 * Initiative +12. Reading Dexterity for a monster silently dropped twelve
 * points off every legendary creature's place in the order.
 */
export function initiativeModifier(sheet: CharacterSheet): number {
  return sheet.stated?.initiative ?? modifierFor(sheet, 'dex');
}
