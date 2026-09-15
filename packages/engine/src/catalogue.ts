import type { Armor, Weapon } from '@ie/srd';

/**
 * What an item is, as far as the rules are concerned.
 *
 * A character sheet does not distinguish gear from tools from weapons from
 * armour — they all end up in the same pack — so every item is one record
 * under one stable id, and inventory refers to items by id and nothing else.
 * Which items exist is content (`Content.item`); this is only their shape and
 * the coin they are priced in.
 *
 * **Ids, not names.** A name is display text — the SRD's gear table
 * alphabetises by inverting them, so it prints `Lantern, Hooded` where a
 * person says "hooded lantern" — and matching on display text is how a
 * starting package silently stops containing a lantern.
 */

export type ItemKind = 'gear' | 'tool' | 'weapon' | 'armor' | 'ammunition';

export interface CatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** Weight in pounds. Null where the source prints "Varies" or a dash. */
  readonly weightLb: number | null;
  /** Price in copper, the one unit everything divides into. Null for "Varies". */
  readonly costCp: number | null;
  /** The armour record, for the few items Armour Class reads. */
  readonly armor: Armor | null;
  /** The weapon record, for the things an attack roll reads. */
  readonly weapon: Weapon | null;
  /** What a pack holds, in ids and quantities. Empty for everything else. */
  readonly contents: readonly { readonly id: string; readonly quantity: number }[];
  /**
   * How many the source sells at once, for a row priced by the bundle.
   *
   * Arrows are "1 GP for 20", so the catalogue holds *one arrow* at a
   * twentieth of the price and this says twenty. An inventory counts arrows,
   * not bundles — a character who shoots three has seventeen left, and a
   * bundle-shaped entry could not say so.
   */
  readonly bundleSize?: number;
}

/** SRD Coin Values: 1 gp is 100 cp, and every other coin divides into it. */
export const COPPER_PER = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 } as const;

export const goldToCopper = (gold: number): number => gold * COPPER_PER.gp;
