import { SKILL_ABILITY, type Ability, type RollMode, type Skill } from '@ie/shared';
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
 * SRD: base AC is 10 + Dexterity modifier. Armour supplies a *different* base
 * calculation rather than adding to that one — you use one or the other, never
 * both. A Shield then adds on top of whichever base applies.
 */
export function armorClass(sheet: CharacterSheet): number {
  const stated = sheet.stated?.armorClass;
  if (stated !== undefined) return stated;

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
  if (armor === null) {
    base = 10 + dex;
  } else {
    const cap = armor.maxDexBonus;
    // The cap limits how much Dex helps; it never turns a penalty into a bonus.
    const dexContribution = armor.addsDexModifier ? (cap === null ? dex : Math.min(dex, cap)) : 0;
    base = (armor.baseAc ?? 10) + dexContribution;
  }

  // A Shield only helps someone trained to use one.
  const shieldBonus = shield !== null && sheet.armorTraining.shields ? (shield.acBonus ?? 0) : 0;

  return base + shieldBonus;
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
  return proficiencyBonus(sheet) + modifierFor(sheet, ability);
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
