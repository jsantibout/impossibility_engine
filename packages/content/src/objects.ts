import type { ObjectMaterial, ObjectSize } from '@ie/engine';

/**
 * The two tables SRD 5.2.1 prints under "Breaking Objects".
 *
 * Data, and nothing else: the engine holds the rule that stands over both of
 * them ("Objects have Immunity to Poison and Psychic damage", "an object is
 * destroyed when it has 0 Hit Points"), and these are the numbers the book
 * *suggests* beside it. A world with substances the SRD never printed writes
 * its own rows and puts them through `createContent` — the door homebrew
 * already uses — without the engine changing.
 *
 * Transcribed from `packages/srd/raw/rules-glossary.md`, "Breaking Objects".
 */

/**
 * The Object Armour Class table.
 *
 * Seven rows, printed in two columns and read down the ACs. The ids are the
 * words a DM says — `wood`, `stone` — and where the book groups substances the
 * name keeps the grouping and the id names the first of them, because an id is
 * what somebody types and `cloth-paper-rope` is not.
 *
 * **No row carries a `defenses` entry**, and that is the book's own hedge
 * rather than an omission: "Paper or cloth objects **might** have Vulnerability
 * to Fire damage." *Might* is the GM's word, so the SRD's table does not apply
 * it and a table that rules otherwise says so in its own catalogue.
 */
export const SRD_OBJECT_MATERIALS: readonly ObjectMaterial[] = [
  { id: 'cloth', name: 'Cloth, paper, rope', armorClass: 11 },
  { id: 'crystal', name: 'Crystal, glass, ice', armorClass: 13 },
  { id: 'wood', name: 'Wood', armorClass: 15 },
  { id: 'stone', name: 'Stone', armorClass: 17 },
  { id: 'iron', name: 'Iron, steel', armorClass: 19 },
  { id: 'mithral', name: 'Mithral', armorClass: 21 },
  { id: 'adamantine', name: 'Adamantine', armorClass: 23 },
];

/**
 * The Object Hit Points table.
 *
 * Four rows and it stops at Large on purpose: "To track Hit Points for a Huge
 * or Gargantuan object, divide it into Large or smaller sections, and track
 * each section's Hit Points separately." Dividing is the GM's, so there is no
 * Huge row here and `declareObject` refuses one rather than extrapolating a
 * number the book declined to print.
 *
 * The averages are the book's, beside the dice it prints them for: Tiny 2
 * (1d4) / 5 (2d4), Small 3 (1d6) / 10 (3d6), Medium 4 (1d8) / 18 (4d8), Large
 * 5 (1d10) / 27 (5d10). The average and not the dice, for the reason
 * `adaptMonster` carries a stat block's average: it is the number the book
 * prints first and the one a table uses without being asked.
 */
export const SRD_OBJECT_SIZES: readonly ObjectSize[] = [
  { id: 'tiny', fragile: 2, resilient: 5, examples: ['bottle', 'lock'] },
  { id: 'small', fragile: 3, resilient: 10, examples: ['chest', 'lute'] },
  { id: 'medium', fragile: 4, resilient: 18, examples: ['barrel', 'chandelier'] },
  { id: 'large', fragile: 5, resilient: 27, examples: ['cart', 'dining table'] },
];
