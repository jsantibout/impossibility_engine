/**
 * The printed text an item hands to the table, on its way to whoever is
 * running it.
 *
 * `docs/design/content.md`: "A table fact that a rule then reads is a debt; a
 * table fact nothing reads afterwards is a handover." A spell's handovers
 * reach a caller through `unverified` under the {@link DM_DECIDES} mark, and an
 * item's go the same way from the two doors that use one: `useItem`'s
 * conferral and the casting route. What a person reads is the item's name, the
 * mark, and the book's own words — `handedOver`, one host along.
 *
 * **The field it reads is `CatalogueItem.dmDecides`**, the item twin of
 * `SpellDefinition.dmDecides`. What it does not read is `unmodelled`: that is
 * the item's owed residue — a debt the blocker map ranks — and not a question
 * the table answers.
 */

import type { CatalogueItem } from '../catalogue.js';
import { handedOver } from '../spell-definitions.js';

/** The sentences this item hands to the table, each under the mark. */
export function itemHandovers(item: CatalogueItem | null): readonly string[] {
  if (item === null) return [];
  return (item.dmDecides ?? []).map((sentence) => handedOver(item.name, sentence));
}
