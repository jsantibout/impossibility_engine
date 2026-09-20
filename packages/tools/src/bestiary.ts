/**
 * A stat block's printed gear, turned into catalogue ids — above the engine,
 * because that is the only place it can honestly live.
 *
 * SRD prints a monster's equipment as the words on the page: `Leather Armor`,
 * `Javelins (6)`, `Thieves' Tools`. The engine holds no catalogue and reads no
 * name — `Content.item` takes an id and `awardItems` refuses anything else —
 * so turning "Javelins (6)" into six `javelin` is a *reading* of content, and
 * a reading of content belongs to the layer that already holds a `Content`
 * value and may have an opinion about English. Pushing it down would put a
 * plural rule and an apostrophe in a package whose first rule is that it has
 * no catalogue at all.
 *
 * **Why it has to happen anywhere.** `resolveAttack` refuses a weapon its
 * wielder does not own, so a Goblin Warrior added and not armed is a goblin
 * that cannot make the Scimitar attack its own block prints. Arming it is not
 * an extra the door offers; it is the difference between a creature on the
 * board and a creature in the fight.
 *
 * **What does not resolve is reported, never refused.** A Mage prints `Wand`
 * and the SRD equipment tables have no wand — it is one of the forms an Arcane
 * Focus takes, priced as the focus — so nothing is handed over and the name
 * comes back in `unverified`. The alternative is refusing to put a Mage in the
 * game over a line of flavour, which is the engine's own reading of a
 * qualified defence ("withheld and reported, never applied") applied one layer
 * up. Nothing here guesses: an unresolved name buys the creature nothing at
 * all, and the caller is told exactly which name bought nothing.
 *
 * **Three steps, and no fourth.** The count in parentheses, then the name as
 * the catalogue writes it, then — *only* where a count was printed, because a
 * count is what licenses reading a plural as one — the singular. The last
 * clause is why `Thieves' Tools` is not mangled into a thieves' tool: it
 * prints no count, so its final `s` is never touched. Anything left over is a
 * name this catalogue does not have, and saying so is the whole of the answer.
 */

import type { Content } from '@ie/engine';

/** One line of a block's gear, resolved to something `awardItems` can take. */
export interface ResolvedGearLine {
  readonly id: string;
  readonly quantity: number;
}

export interface ResolvedGear {
  /** In the order the block prints them, so the log reads as the page does. */
  readonly items: readonly ResolvedGearLine[];
  /** The names, exactly as printed, that this catalogue has nothing under. */
  readonly unresolved: readonly string[];
}

/** `Javelins (6)` — the one shape the SRD prints a count in. */
const COUNTED = /^(.*?)\s*\((\d+)\)$/;

/**
 * A name reduced to the letters and digits in it, in order.
 *
 * `Thieves' Tools` and `thieves tools` are the same item, and a lookup that
 * said otherwise would be a homebrew author's first bug report.
 */
const key = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The catalogue's names, indexed once per `Content` rather than per creature.
 *
 * A `Content` is built once and handed round, so a weak cache keyed on the
 * value is a cache with the same lifetime as the thing it describes and no
 * invalidation question to get wrong.
 */
const indexes = new WeakMap<Content, ReadonlyMap<string, string>>();

function namesOf(content: Content): ReadonlyMap<string, string> {
  const found = indexes.get(content);
  if (found !== undefined) return found;
  const built = new Map<string, string>();
  // First wins, so a catalogue that files two items under one name keeps the
  // one it declared first. `checkContent` already refuses two under one *id*;
  // two under one name is legal and is not this function's to adjudicate.
  for (const item of content.items) {
    const at = key(item.name);
    if (!built.has(at)) built.set(at, item.id);
  }
  indexes.set(content, built);
  return built;
}

/** The catalogue id this printed name means, or null. */
function idFor(content: Content, printed: string, counted: boolean): string | null {
  // An id outright, which a homebrew block may reasonably print.
  if (content.item(printed) !== null) return printed;

  const names = namesOf(content);
  const exact = names.get(key(printed));
  if (exact !== undefined) return exact;

  // `Javelins (6)` is six of the thing the catalogue calls a Javelin. Only
  // where a count was printed: see the note at the top of this file.
  if (counted && printed.endsWith('s')) {
    const singular = names.get(key(printed.slice(0, -1)));
    if (singular !== undefined) return singular;
  }
  return null;
}

/**
 * What a stat block's `gear` line buys, and what it does not.
 *
 * Duplicated ids are summed rather than listed twice, because `awardItems`
 * takes a line per item and two lines of one id would be two `items-gained`
 * entries for one thing.
 */
export function resolveGear(content: Content, printed: readonly string[]): ResolvedGear {
  const items: ResolvedGearLine[] = [];
  const unresolved: string[] = [];

  for (const line of printed) {
    const counted = COUNTED.exec(line);
    const name = counted === null ? line : counted[1]!;
    const quantity = counted === null ? 1 : Number(counted[2]);

    const id = idFor(content, name, counted !== null);
    if (id === null) {
      unresolved.push(line);
      continue;
    }
    const already = items.findIndex((held) => held.id === id);
    if (already === -1) items.push({ id, quantity });
    else items[already] = { id, quantity: items[already]!.quantity + quantity };
  }

  return { items, unresolved };
}
