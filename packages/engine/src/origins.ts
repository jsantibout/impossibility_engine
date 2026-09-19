import type { Ability, Skill } from '@ie/shared';
import type { EquipmentPackage, FeatureDefinition, FeatureGrant } from './progression.js';

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
  /** The Origin feat it confers; what that feat does is its own declaration. */
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
 * A language a world holds.
 *
 * Content, not engine: which tongues exist is a campaign's to say, and a
 * setting with its own — or with none of the SRD's — reaches the engine
 * through `createContent` like every other catalogue.
 *
 * The **name** is the handle. It is what a character's choices name and what
 * is written on the sheet, so it is what creation matches; the id is the
 * catalogue's own, unique as every population's is.
 */
export interface LanguageDefinition {
  readonly id: string;
  readonly name: string;
  /**
   * How a character comes by it at creation.
   *
   * - `everyone` — known without spending a choice. SRD's Common: "Common
   *   plus two languages you roll or choose".
   * - `standard` — on the table a character chooses from. The default.
   * - `rare` — the world holds it, but it is a GM's to hand out rather than a
   *   creation choice, so choosing it at creation is refused.
   */
  readonly availability?: 'everyone' | 'standard' | 'rare';
}

/**
 * How many languages a character chooses beyond the ones everyone speaks.
 *
 * **A rule of character creation, so it stays an engine number** — the same
 * kind of thing as {@link STANDARD_ARRAY} and {@link POINT_BUY_BUDGET}, which
 * SRD prints on the same page and which no catalogue supplies either. What
 * languages *exist*, and which of them everybody speaks, is the world's
 * answer and lives in content; how many a character picks is the book's.
 */
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
  /** What a DM still has to apply, beyond whatever {@link grants} declares. */
  readonly note: string;
  /**
   * What the feat confers, in the vocabulary a feature's grant is written in.
   *
   * **Why a feat has one at all.** The engine used to pay out SRD Alert's
   * Initiative bonus by reading that feat's id, which is inviolable rule 4
   * broken mechanically. A feat that declares what it confers takes the
   * knowledge out of the engine and puts it where every other mechanic of the
   * catalogue already lives, and a homebrew feat saying the same thing gets
   * the same treatment with no engine change.
   *
   * **At most one, exactly as a `FeatureDefinition` carries at most one.** A
   * feat whose text does two mechanical things is two grants' worth of
   * vocabulary and a decision about how they compose, and no SRD feat needs
   * it yet.
   *
   * **Held to what creation executes.** `checkContent` refuses a kind nothing
   * reads off a feat — see `FEAT_GRANT_KINDS` — for the reason an item's
   * conferral is held to `CONFERRED_EFFECT_KINDS`: a grant nobody reads is a
   * line in the book that quietly does nothing, which is the failure the
   * content validator exists to prevent. The list grows when a reader does.
   */
  readonly grants?: FeatureGrant;
}

/**
 * An alignment a world recognises.
 *
 * SRD Step 4: "Choose your character's alignment... and note it on your
 * character sheet." A choice with no mechanics attached — 2024 hangs nothing
 * off it — recorded rather than derived from, and checked only so a typo
 * cannot slip through as an alignment nobody has heard of.
 *
 * Which alignments there are is the setting's question, not the engine's: the
 * nine are the SRD's answer, a world with three is as good, and a world that
 * declares none makes no claim at all and any answer stands. Matched by name,
 * for the reason {@link LanguageDefinition} is.
 */
export interface AlignmentDefinition {
  readonly id: string;
  readonly name: string;
}
