import type { Ability, Skill } from '@ie/shared';
import type { EquipmentPackage, FeatureDefinition } from './progression.js';

/**
 * Species and backgrounds, transcribed from SRD 5.2.1 "Character Origins".
 *
 * Both are `FeatureSource`-shaped, so the same `featuresAt` and
 * `cumulativeFeatures` that read a class table read these — a species trait
 * that arrives at character level 3 is the same kind of thing as a class
 * feature that does.
 *
 * Only what the one supported creation path needs is here. Adding the rest is
 * transcription, not design.
 */

export interface SpeciesDefinition {
  readonly id: string;
  readonly name: string;
  readonly creatureType: string;
  /** Sizes the species may be. More than one means the player chooses. */
  readonly sizes: readonly string[];
  readonly speed: number;
  readonly features: readonly FeatureDefinition[];
}

export interface BackgroundDefinition {
  readonly id: string;
  readonly name: string;
  /**
   * The three abilities the background may raise.
   *
   * SRD: "Increase one by 2 and another one by 1, or increase all three by 1.
   * None of these increases can raise a score above 20."
   */
  readonly abilities: readonly Ability[];
  /** The Origin feat it confers. Feats are recorded, not executed. */
  readonly feat: string;
  readonly skillProficiencies: readonly Skill[];
  readonly toolProficiency: string;
  readonly startingEquipment: readonly EquipmentPackage[];
  readonly features: readonly FeatureDefinition[];
}

export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** SRD Ability Score Point Costs, and the 27 points there are to spend. */
export const POINT_BUY_BUDGET = 27;
export const POINT_COSTS: Readonly<Record<number, number>> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

/**
 * SRD "Choose Languages": "Your character knows at least three languages:
 * Common plus two languages you roll or choose from the Standard Languages
 * table."
 */
export const COMMON = 'Common';
export const STANDARD_LANGUAGES: readonly string[] = [
  'Common',
  'Common Sign Language',
  'Draconic',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];
export const LANGUAGES_CHOSEN = 2;

/** What an Origin feat asks for when it is taken. */
export type FeatRequirement =
  | { readonly kind: 'none' }
  /** Magic Initiate: a spell list, a spellcasting ability, two cantrips, one level 1 spell. */
  | { readonly kind: 'magic-initiate'; readonly lists: readonly string[] }
  /** Skilled: "any combination of three skills or tools of your choice." */
  | { readonly kind: 'proficiencies'; readonly choose: number };

export interface FeatDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'origin' | 'general' | 'fighting-style' | 'epic-boon';
  readonly requires: FeatRequirement;
  /** Taking it twice is legal only for these, and only under the feat's own terms. */
  readonly repeatable: boolean;
  /** What a DM still has to apply, because the engine does not execute feats. */
  readonly note: string;
}

/**
 * SRD Step 4: "Choose your character's alignment... and note it on your
 * character sheet."
 *
 * A required choice with no mechanics attached — 2024 hangs nothing off it.
 * Recorded rather than derived from, and validated only so a typo cannot slip
 * through as an alignment nobody has heard of.
 */
export const ALIGNMENTS: readonly string[] = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
];
