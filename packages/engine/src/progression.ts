import { err, ok, type Ability, type Result, type Skill } from '@ie/shared';
import type { ArmorTraining } from './character.js';

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
  | { readonly kind: 'subclass'; readonly choose: 1 }
  | { readonly kind: 'feat'; readonly choose: number; readonly category?: string };

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
  /** Set on the feature that opens a subclass, so creation knows to ask. */
  readonly grantsSubclass?: boolean;
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
  readonly from: readonly Skill[];
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

export interface ClassDefinition extends FeatureSource {
  readonly primaryAbility: Ability;
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

/** An item as the SRD lists it in a starting-equipment package. */
export interface EquipmentEntry {
  readonly name: string;
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
