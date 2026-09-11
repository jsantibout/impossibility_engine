import { spellById, type SpellIndexEntry } from '@ie/srd';

/**
 * A Wizard's spellbook, and where each spell in it came from.
 *
 * The distinction that makes this its own module: **spells granted by levelling
 * are counted, and spells acquired in play are not.** SRD gives six spells at
 * level 1 and two per level after, and separately lets a Wizard copy any spell
 * they find:
 *
 * > "When you find a level 1+ Wizard spell, you can copy it into your spellbook
 * > if it's of a level you can prepare and if you have time to copy it."
 *
 * A book with a scroll copied out of a dragon's hoard is *not* over its limit.
 * An earlier version enforced an exact total, which would have made levelling
 * up reject a character for the crime of having adventured. So the rule is on
 * the level-granted subset alone, and everything else rides along.
 */

export type SpellOrigin =
  /** Granted by gaining a class level. Counted against the table. */
  | 'level'
  /** Copied from a scroll or another book in play. Not counted. */
  | 'copied'
  /** Given free by a feature, such as the Evoker's Evocation Savant. */
  | 'feature';

export interface SpellbookEntry {
  readonly spellId: string;
  /** The class level at which it was written into the book. */
  readonly acquiredAt: number;
  readonly origin: SpellOrigin;
}

/** SRD: six at level 1, "add two Wizard spells" per level after. */
export const levelGrantedSpells = (level: number): number =>
  6 + Math.max(0, level - 1) * 2;

export const countOf = (book: readonly SpellbookEntry[], origin: SpellOrigin): number =>
  book.filter((entry) => entry.origin === origin).length;

export const spellIds = (book: readonly SpellbookEntry[]): readonly string[] =>
  book.map((entry) => entry.spellId);

/** The highest spell level the character has slots for, which gates preparation. */
export const highestSlotLevel = (slots: Readonly<Record<number, number>>): number =>
  Object.keys(slots).reduce((highest, level) => Math.max(highest, Number(level)), 0);

export const lookupSpell = (id: string): SpellIndexEntry | null => spellById(id);
