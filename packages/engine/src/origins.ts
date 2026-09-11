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
      automation: 'engine',
      note: 'The chosen Origin feat is validated, and applied as far as that feat is executed - see the feat own note, which says what a DM still has to do.',
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
        { id: 'quarterstaff', quantity: 1 },
        { id: 'calligraphers-supplies', quantity: 1 },
        { id: 'book', quantity: 1, detail: 'history' },
        { id: 'parchment', quantity: 8, detail: 'sheets' },
        { id: 'robe', quantity: 1 },
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
      automation: 'engine',
      note: 'The chosen spells reach usable state: castable through resolveSpell on the feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool. What is missing is a definition for each spell - the engine executes only the spells it has been taught.',
      grantsFeat: { featId: 'magic-initiate', spellList: 'wizard' },
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

/** SRD "Origin Feats". The four the SRD publishes, no more. */
export const ORIGIN_FEATS: readonly FeatDefinition[] = [
  {
    id: 'alert',
    name: 'Alert',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Initiative Proficiency is applied: creation returns it as a named bonus in initiativeBonuses, which rollInitiative takes like any other. The Initiative swap is not - swapping two combatants after the roll needs a decision nobody has modelled, and swapInitiative exists but nothing offers it.',
  },
  {
    id: 'magic-initiate',
    name: 'Magic Initiate',
    category: 'origin',
    requires: { kind: 'magic-initiate', lists: ['cleric', 'druid', 'wizard'] },
    repeatable: true,
    note: 'The chosen spells are castable, on this feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool the engine spends. Spell change on levelling is not modelled, and a chosen spell still needs an executable definition before it does anything.',
  },
  {
    id: 'savage-attacker',
    name: 'Savage Attacker',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Rolling weapon damage twice once per turn is not applied; the caller can reproduce it through the dice module.',
  },
  {
    id: 'skilled',
    name: 'Skilled',
    category: 'origin',
    requires: { kind: 'proficiencies', choose: 3 },
    repeatable: true,
    note: 'The three chosen proficiencies *are* applied to the sheet; nothing else about the feat needs applying.',
  },
];

export const featById = (id: string): FeatDefinition | null =>
  ORIGIN_FEATS.find((f) => f.id === id) ?? null;

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
