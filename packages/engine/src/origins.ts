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

export const HUMAN: SpeciesDefinition = {
  id: 'human',
  name: 'Human',
  creatureType: 'Humanoid',
  sizes: ['Medium', 'Small'],
  speed: 30,
  features: [
    {
      id: 'human:resourceful',
      name: 'Resourceful',
      level: 1,
      automation: 'manual',
      note: 'Heroic Inspiration is not modelled, so finishing a Long Rest does not grant it.',
    },
    {
      id: 'human:skillful',
      name: 'Skillful',
      level: 1,
      automation: 'engine',
      note: 'The chosen skill proficiency is applied to the sheet.',
      choice: { kind: 'skill', choose: 1 },
    },
    {
      id: 'human:versatile',
      name: 'Versatile',
      level: 1,
      automation: 'manual',
      note: 'Feats are not modelled; the chosen Origin feat is recorded only.',
      choice: { kind: 'feat', choose: 1, category: 'origin' },
    },
  ],
};

export const SAGE: BackgroundDefinition = {
  id: 'sage',
  name: 'Sage',
  abilities: ['con', 'int', 'wis'],
  feat: 'Magic Initiate (Wizard)',
  skillProficiencies: ['arcana', 'history'],
  toolProficiency: "Calligrapher's Supplies",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { name: 'Quarterstaff', quantity: 1 },
        { name: "Calligrapher's Supplies", quantity: 1 },
        { name: 'Book', quantity: 1, detail: 'history' },
        { name: 'Parchment', quantity: 8, detail: 'sheets' },
        { name: 'Robe', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'sage:magic-initiate-wizard',
      name: 'Magic Initiate (Wizard)',
      level: 1,
      automation: 'manual',
      note: 'Feats are not modelled. The two cantrips and one level 1 spell this feat grants are not added to the sheet, and the free daily casting is not tracked.',
    },
  ],
};

export const SPECIES: readonly SpeciesDefinition[] = [HUMAN];
export const BACKGROUNDS: readonly BackgroundDefinition[] = [SAGE];

export const speciesById = (id: string): SpeciesDefinition | null =>
  SPECIES.find((s) => s.id === id) ?? null;

export const backgroundById = (id: string): BackgroundDefinition | null =>
  BACKGROUNDS.find((b) => b.id === id) ?? null;

/** SRD Step 3: "Standard Array. Use the following six scores: 15, 14, 13, 12, 10, 8." */
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
