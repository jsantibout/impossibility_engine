import { SKILL_ABILITY, type Ability, type RollMode, type Skill } from '@ie/shared';
import type { ActivatedFeature, StandingEffect } from './standing.js';
import type { Armor } from '@ie/srd';

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

export type ProficiencyLevel = 'none' | 'proficient' | 'expertise';

export interface ArmorTraining {
  readonly light: boolean;
  readonly medium: boolean;
  readonly heavy: boolean;
  readonly shields: boolean;
}

/**
 * Values a stat block states outright instead of deriving.
 *
 * A character's Armour Class follows from what they are wearing and their
 * Dexterity; a monster's is simply printed. The same goes for its saving
 * throws, its skills and its proficiency bonus — a stat block can and does
 * carry numbers that no derivation would produce. Forcing a monster through
 * the character derivations would quietly change its numbers.
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
 */
export function armorClassCalculation(sheet: CharacterSheet): ArmorClassCalculation {
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
    // feature need not be shaped that way.
    for (const alternative of sheet.unarmoredDefense ?? []) {
      if (shield !== null && !alternative.shieldAllowed) continue;
      const theirs = 10 + dex + modifierFor(sheet, alternative.ability);
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

export function armorClass(sheet: CharacterSheet): number {
  return armorClassCalculation(sheet).total;
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
