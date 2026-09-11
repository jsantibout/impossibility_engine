import { AMMUNITION, ARMOR, GEAR, TOOLS, WEAPONS, type Armor, type Weapon } from '@ie/srd';

/**
 * Every mundane thing a character can own, under one stable id.
 *
 * The SRD splits its equipment across four tables that a character sheet does
 * not distinguish between: gear, tools, weapons and armour all end up in the
 * same pack. So this is one lookup over all of them, keyed by the slug the
 * parsers already assign, and it is the only way inventory refers to an item.
 *
 * **Ids, not names.** A name is display text — the gear table alphabetises by
 * inverting them, so it prints `Lantern, Hooded` where a person says "hooded
 * lantern" — and matching on display text is how a starting package silently
 * stops containing a lantern. An id is the parser's slug and does not move.
 */

export type ItemKind = 'gear' | 'tool' | 'weapon' | 'armor' | 'ammunition';

export interface CatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** Weight in pounds. Null where the SRD prints "Varies" or a dash. */
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
   * How many the SRD sells at once, for a row priced by the bundle.
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

/** Copper as gold, rounding down, which is how a purse is counted out. */
export const copperToGold = (copper: number): number => Math.floor(copper / COPPER_PER.gp);

const priceInCopper = (cost: { kind: string; value?: { amount: number; currency: string } }):
  | number
  | null => {
  if (cost.kind !== 'cost' || cost.value === undefined) return null;
  const per = COPPER_PER[cost.value.currency as keyof typeof COPPER_PER];
  return per === undefined ? null : cost.value.amount * per;
};

const weightInPounds = (weight: { kind: string; value?: number }): number | null => {
  if (weight.kind === 'lb') return weight.value ?? null;
  // "Negligible" is a real answer and it is zero; "Varies" is not an answer.
  return weight.kind === 'negligible' ? 0 : null;
};

/**
 * Things a class hands you that the equipment tables never list.
 *
 * SRD 5.2.1's Adventuring Gear table has no Spellbook row — the object is
 * defined by the Wizard's Spellbook feature instead ("a Tiny object that
 * weighs 3 pounds, contains 100 pages"), and the class package grants one. So
 * the catalogue carries it from the text that does describe it, rather than
 * letting a starting package name an item that resolves to nothing.
 *
 * No price, because the book prints none: buying one is refused rather than
 * guessed, same as any row the SRD leaves as "Varies".
 */
const CLASS_ITEMS: readonly CatalogueItem[] = [
  {
    id: 'spellbook',
    name: 'Spellbook',
    kind: 'gear',
    weightLb: 3,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
  },
];

function build(): Map<string, CatalogueItem> {
  const items = new Map<string, CatalogueItem>();

  for (const item of CLASS_ITEMS) items.set(item.id, item);

  for (const entry of GEAR) {
    items.set(entry.id, {
      id: entry.id,
      name: entry.name,
      kind: 'gear',
      weightLb: weightInPounds(entry.weight),
      costCp: priceInCopper(entry.cost),
      armor: null,
      weapon: null,
      contents: entry.contents.map((line) => ({ id: line.gearId, quantity: line.quantity })),
    });
  }

  // SRD prices ammunition by the bundle — "Arrows (20)" costs 1 GP — so the
  // catalogue entry is one arrow and `bundleSize` says what a purchase buys.
  // Pricing the bundle as a single item would make one arrow cost a gold piece.
  for (const round of AMMUNITION) {
    const bundle = priceInCopper(round.cost);
    const weight = weightInPounds(round.weight);
    items.set(round.id, {
      id: round.id,
      name: round.name,
      kind: 'ammunition',
      weightLb: weight === null ? null : weight / round.amount,
      costCp: bundle === null ? null : bundle / round.amount,
      armor: null,
      weapon: null,
      contents: [],
      bundleSize: round.amount,
    });
  }

  for (const tool of TOOLS) {
    items.set(tool.id, {
      id: tool.id,
      name: tool.name,
      kind: 'tool',
      weightLb: weightInPounds(tool.weight),
      costCp: priceInCopper(tool.cost),
      armor: null,
      weapon: null,
      contents: [],
    });
  }

  for (const weapon of WEAPONS) {
    items.set(weapon.id, {
      id: weapon.id,
      name: weapon.name,
      kind: 'weapon',
      weightLb: weapon.weightLb,
      costCp: weapon.cost.amount * (COPPER_PER[weapon.cost.currency] ?? 1),
      armor: null,
      weapon,
      contents: [],
    });
  }

  for (const piece of ARMOR) {
    items.set(piece.id, {
      id: piece.id,
      name: piece.name,
      kind: 'armor',
      weightLb: piece.weightLb,
      costCp: piece.cost.amount * (COPPER_PER[piece.cost.currency] ?? 1),
      armor: piece,
      weapon: null,
      contents: [],
    });
  }

  return items;
}

const CATALOGUE = build();

export const itemFor = (id: string): CatalogueItem | null => CATALOGUE.get(id) ?? null;

export const catalogueIds = (): readonly string[] => [...CATALOGUE.keys()].sort();

/**
 * Everything a pack puts in your hands, the pack itself included.
 *
 * SRD lists a pack's contents in its description and prices the bundle: buying
 * a Scholar's Pack gets you the pack *and* the backpack, book, ink, pen, lamp,
 * ten flasks of oil, ten sheets of parchment and tinderbox inside it. A
 * character who owns the pack but not its contents owns a label.
 */
export function expandPack(id: string): readonly { id: string; quantity: number }[] {
  const item = itemFor(id);
  if (item === null) return [];
  if (item.contents.length === 0) return [{ id, quantity: 1 }];
  return [{ id, quantity: 1 }, ...item.contents.map((line) => ({ ...line }))];
}
