/**
 * The join between a catalogue item and the SRD entry it was read from.
 *
 * **One entry is not one item, and that is the whole reason this exists.** The
 * book writes _Weapon, +1, +2, or +3_ once, as a template over the weapon
 * table, and the catalogue holds a +1 Longsword, a +2 Longsword and a +3
 * Longsword as three separate records because an inventory holds *a sword*
 * rather than a template. Four such entries account for most of the
 * catalogue's magic items. So "how much of the book is transcribed" and "how
 * many magic items does the catalogue hold" are different questions with
 * wildly different answers, and a report that printed the second under the
 * first would claim the Weapons chapter was covered nearly four times over.
 *
 * The map lived in `magic-items.test.ts`, which is where it was first needed.
 * It is here because `coverage-data.ts` needs the same join to count entries,
 * and the standing rule in this repository is that the second spelling of a
 * derivation is the second place to get it wrong — `coverage-data.ts`'s
 * `isExecuted` carries the record of what a drifting copy cost. Both the guard
 * and the report read this one.
 *
 * Nothing here has a top-level effect. The parse is memoised behind a call, so
 * importing this module reads no file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SRD_MAGIC_ITEMS } from '@ie/content';
import {
  parseMagicItems,
  type MagicItem,
  type MagicItemCategory,
  type MagicItemParseOutput,
} from '@ie/srd';
import type { CatalogueItem, ItemKind } from '@ie/engine';

/**
 * The Magic Item Categories table, against the kinds `ItemKind` has.
 *
 * A bijection, and it is what lets a per-category count be honest without a
 * second hand-written table: the book's nine categories are the nine kinds an
 * `ItemKind` reserves for magic items.
 */
export const MAGIC_ITEM_KIND_OF: Readonly<Record<MagicItemCategory, ItemKind>> = {
  Armor: 'armor',
  Potions: 'potion',
  Rings: 'ring',
  Rods: 'rod',
  Scrolls: 'scroll',
  Staffs: 'staff',
  Wands: 'wand',
  Weapons: 'weapon',
  'Wondrous Items': 'wondrous',
};

/** The categories in the order the book's table prints them. */
export const MAGIC_ITEM_CATEGORIES: readonly MagicItemCategory[] = Object.keys(
  MAGIC_ITEM_KIND_OF,
) as MagicItemCategory[];

/**
 * The three entries the SRD writes as a template over an equipment table, and
 * the one it writes over half of one.
 *
 * **This is the whole of the hand-written link between the two populations**,
 * and it is deliberately the only thing hand-written: everything else about an
 * instance is read off the entry it resolves to, so a mistyped rarity or a
 * forgotten attunement bracket fails rather than agreeing with itself.
 */
const FAMILY: readonly {
  readonly entry: string;
  readonly matches: (item: CatalogueItem) => boolean;
}[] = [
  {
    entry: 'Weapon, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.weapon !== null,
  },
  {
    entry: 'Shield, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.armor?.category === 'shield',
  },
  {
    entry: 'Armor, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.armor !== null,
  },
  { entry: 'Mithral Armor', matches: (item) => item.name.startsWith('Mithral ') },
];

const RAW = () =>
  readFileSync(fileURLToPath(new URL('../../srd/raw/magic-items.md', import.meta.url)), 'utf8');

let parsed: MagicItemParseOutput | null = null;
let byName: Map<string, MagicItem> | null = null;

/**
 * The book, parsed.
 *
 * The parse output rather than the items, because whether it found problems is
 * the vacuity floor every reader of this needs — `magic-items.test.ts` asserts
 * it is empty before believing anything below it.
 */
export function magicItemParse(): MagicItemParseOutput {
  parsed ??= parseMagicItems(RAW(), 'magic-items.md');
  return parsed;
}

/** Every entry the book prints under "Magic Items A–Z". */
export function magicItemEntries(): readonly MagicItem[] {
  return magicItemParse().items;
}

/**
 * The entry a catalogue item was read from: by name where the book names the
 * item, through {@link FAMILY} where it writes a template instead.
 *
 * Throws on an item that resolves to nothing. That is a programmer's mistake —
 * a record transcribed from a page nobody can point at — and there is no
 * report to write once it is true.
 */
export function entryFor(item: CatalogueItem): MagicItem {
  byName ??= new Map(magicItemEntries().map((entry) => [entry.name, entry]));
  const named = byName.get(item.name);
  if (named !== undefined) return named;
  const family = FAMILY.find((template) => template.matches(item));
  const entry = family === undefined ? undefined : byName.get(family.entry);
  if (entry === undefined) {
    throw new Error(`${item.name} resolves to no entry in the SRD's magic items`);
  }
  return entry;
}

/**
 * An item that does everything its entry says.
 *
 * The same shape as `isExecuted` for a spell, and exported for the same
 * reason: the report and the transcription guard must ask one question. An
 * item whose *whole* text is beyond the vocabulary is not in the catalogue at
 * all, so the only two answers here are "complete" and "partial, and it says
 * in what way".
 */
export const isCompleteItem = (item: CatalogueItem): boolean =>
  (item.unmodelled ?? []).length === 0;

/** Every catalogue item, paired with the entry it was read from. */
export function transcribedItems(): readonly (readonly [CatalogueItem, MagicItem])[] {
  return SRD_MAGIC_ITEMS.map((item) => [item, entryFor(item)] as const);
}
