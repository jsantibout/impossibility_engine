import {
  MagicItemRaritySchema,
  MagicItemSchema,
  slugify,
  type MagicItem,
  type MagicItemCategory,
  type MagicItemCharges,
  type MagicItemRarityLine,
  type MagicItemRarityOption,
  type ParseOutput,
  type ParseProblem,
} from '../schemas.js';
import { splitTopLevel } from './equipment.js';

/**
 * Parser for `raw/magic-items.md`.
 *
 * Entries live under "Magic Items A–Z" and look like:
 *
 * ```
 * #### Wand of Fireballs
 *
 * _Wand, Rare (Requires Attunement by a Spellcaster)_
 *
 * This wand has 7 charges. While holding it, ...
 * ```
 *
 * This is transcription. It records what the page prints — name, category,
 * subtype, rarity, attunement, charges, prose — and interprets none of it.
 *
 * ## The trap: `#### ` is not the same as "an entry"
 *
 * `grep -c '^#### '` returns 264 over this file and the book contains 258
 * magic items. Six headings are not entries, in two different ways:
 *
 * - **Four are rules subsections** printed before the A–Z list: "Spells Cast
 *   from Items" and "Charges" under "Activating a Magic Item", "Spells" under
 *   "Crafting Magic Items", and "Conflict" under "Special Purpose". They are
 *   dropped.
 * - **Two are creature stat blocks printed inside an entry.** "Giant Fly"
 *   sits in the middle of Figurine of Wondrous Power and "Avatar of Death" in
 *   the middle of Mysterious Deck, because each entry's prose points at it.
 *   Dropping their blocks would truncate the entry they interrupt — the
 *   Figurine would end at the Ebony Fly, the second of its nine figurines,
 *   losing the seven printed after it. So inside the A–Z list a heading that
 *   is not an entry is folded back into the entry above it, heading and all.
 *
 * Both kinds are reported in `skipped` rather than merely ignored: a parser
 * that quietly stopped recognising a type line would otherwise report a tidy
 * 200 and no problems at all.
 *
 * An entry is recognised by its italic type line, not by its position, so a
 * type line the parser cannot read makes the heading show up in `skipped`
 * where a test names it — it never becomes a plausible default.
 */

const HEADING = /^####\s+(.+?)\s*$/;
/** The `## Magic Items A–Z` heading; every entry is below it. */
const CATALOGUE_HEADING = /^##\s+Magic Items\s+A/;

/**
 * The type line's singular category spellings, mapped onto the plural names
 * the Magic Item Categories table uses. Longest first is not needed here
 * because the match is anchored and followed by `(` or `,`.
 */
const CATEGORY_WORDS: Readonly<Record<string, MagicItemCategory>> = {
  Armor: 'Armor',
  Potion: 'Potions',
  Ring: 'Rings',
  Rod: 'Rods',
  Scroll: 'Scrolls',
  Staff: 'Staffs',
  Wand: 'Wands',
  Weapon: 'Weapons',
  'Wondrous Item': 'Wondrous Items',
};

/** `_Wondrous Item, Rare_` — the whole line must be italicised. */
const ITALIC_LINE = /^_(.+)_$/;
/** `Wondrous Item` or `Armor (Any Light, Medium, or Heavy)`. */
const CATEGORY_CLAUSE = /^([A-Za-z][A-Za-z ]*?)\s*(?:\(([^)]*)\))?$/;
/** `Requires Attunement`, optionally followed by a prerequisite. */
const ATTUNEMENT_CLAUSE = /\s*\(Requires Attunement([^)]*)\)$/i;
const MENTIONS_ATTUNEMENT = /Requires Attunement/i;
const RARITY_VARIES = /^Rarity Varies$/i;
/** `Rare`, `or Very Rare (+3)`, `Rare (Silver or Brass)`. */
const RARITY_OPTION = /^(?:or\s+)?([A-Za-z][A-Za-z ]*?)\s*(?:\((.*)\))?$/;

/** What a type line says, before the name and prose are attached. */
export interface MagicItemType {
  readonly category: MagicItemCategory;
  readonly subtype: string | null;
  readonly rarity: MagicItemRarityLine;
  readonly requiresAttunement: boolean;
  readonly attunementPrerequisite: string | null;
}

/**
 * Read the italic line under an entry's heading.
 *
 * Returns null for anything that is not a magic item type line — including a
 * creature's `_Large Beast, Unaligned_`, which is why the two stat blocks
 * printed inside entries do not become items. Returns null rather than a
 * partial record for a line it half understands: an unknown rarity or an
 * attunement clause with nested parentheses is a format change, and the
 * caller reports it instead of filling in something plausible.
 *
 * The commas that separate category from rarity are split at the top level,
 * because `Armor (Any Medium or Heavy, Except Hide Armor), Uncommon` and
 * `Staff, Rare (Requires Attunement by a Bard, Cleric, or Druid)` both put
 * commas inside parentheses — the same trap that bit the weapon properties.
 */
export function parseMagicItemTypeLine(line: string): MagicItemType | null {
  const italic = ITALIC_LINE.exec(line.trim());
  if (!italic) return null;

  let body = italic[1]!.trim();

  let requiresAttunement = false;
  let attunementPrerequisite: string | null = null;
  const attunement = ATTUNEMENT_CLAUSE.exec(body);
  if (attunement) {
    requiresAttunement = true;
    attunementPrerequisite = attunement[1]!.trim() || null;
    body = body.slice(0, attunement.index).trim();
  }
  // The clause is there but not in the shape this reads. Refuse rather than
  // return an item that silently needs no attunement.
  if (MENTIONS_ATTUNEMENT.test(body)) return null;

  const parts = splitTopLevel(body);
  if (parts.length < 2) return null;

  const categoryClause = CATEGORY_CLAUSE.exec(parts[0]!);
  if (!categoryClause) return null;
  const category = CATEGORY_WORDS[categoryClause[1]!.trim()];
  if (category === undefined) return null;
  const subtype = categoryClause[2]?.trim() || null;

  const text = parts.slice(1).join(', ');
  if (text === '') return null;

  let rarity: MagicItemRarityLine;
  if (RARITY_VARIES.test(text)) {
    rarity = { text, varies: true, options: [] };
  } else {
    const options: MagicItemRarityOption[] = [];
    for (const part of parts.slice(1)) {
      const option = RARITY_OPTION.exec(part.trim());
      if (!option) return null;
      const named = MagicItemRaritySchema.safeParse(option[1]!.trim());
      if (!named.success) return null;
      options.push({ rarity: named.data, qualifier: option[2]?.trim() || null });
    }
    rarity = { text, varies: false, options };
  }

  return { category, subtype, rarity, requiresAttunement, attunementPrerequisite };
}

/**
 * `has 7 charges`, `have 3 charges`, `starts with 10 charges`, `its 3
 * charges`. Four phrasings cover every entry that prints a maximum; a fifth
 * the book might use would leave `charges` null, which the test catches by
 * naming every entry that says "charge" and has none.
 */
const CHARGE_COUNT =
  /\b(?:has|have|starts with|its)\s+((?:\d+d\d+(?:\s*[+-]\s*\d+)?)|\d+)\s+charges?\b/g;
/**
 * A paragraph opening in plain bold — `**Goat of Traveling.**` — introduces
 * one version of the item rather than a property of it. The Figurine of
 * Wondrous Power prints "It has 24 charges" there, and those charges belong
 * to the Goat of Traveling, not to a Figurine of Wondrous Power, which the
 * book gives no maximum at all. Bold-*italic* and italic openers
 * (`**_Life Stealing._**`, `_Ultimate End._`) are properties of the item
 * itself and are read.
 */
const VERSION_PARAGRAPH = /^\*\*[^_*][^*]*\.\*\*/;

/**
 * Read the charge maximum an entry prints, or null when it prints none.
 *
 * Null when two different maximums turn up in one entry too, rather than
 * picking the first: two would mean the page attributes them to different
 * things and this cannot tell which is the item's. No entry does that today,
 * and the test that names every charge-mentioning entry without a maximum is
 * what would say so if one started to.
 */
export function parseMagicItemCharges(description: string): MagicItemCharges | null {
  const found = new Set<string>();

  for (const paragraph of description.split(/\n\s*\n/)) {
    if (VERSION_PARAGRAPH.test(paragraph.trim())) continue;
    CHARGE_COUNT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHARGE_COUNT.exec(paragraph)) !== null) {
      found.add(match[1]!.replace(/\s+/g, ' '));
    }
  }

  if (found.size !== 1) return null;
  const printed = [...found][0]!;
  return /d/.test(printed)
    ? { maximum: null, formula: printed }
    : { maximum: Number(printed), formula: null };
}

interface RawBlock {
  readonly name: string;
  /** The heading line verbatim, needed when a block is folded back into one. */
  readonly heading: string;
  readonly lines: readonly string[];
  /** False for the four rules subsections printed above "Magic Items A–Z". */
  readonly inCatalogue: boolean;
}

/**
 * Split the whole document into `#### Heading` blocks, in print order, each
 * marked with whether it sits under "Magic Items A–Z".
 *
 * Every `#### ` heading is returned, catalogue or not, so the caller can
 * account for all 264 of them. Null when the A–Z heading is missing: a
 * re-vendor that moved or renamed it is a format change to report, not one to
 * guess around.
 */
function splitBlocks(markdown: string): RawBlock[] | null {
  const lines = markdown.split(/\r?\n/);
  if (!lines.some((line) => CATALOGUE_HEADING.test(line))) return null;

  const blocks: RawBlock[] = [];
  let inCatalogue = false;
  let heading: string | null = null;
  let headingLine = '';
  let headingInCatalogue = false;
  let body: string[] = [];

  const push = (): void => {
    if (heading !== null) {
      blocks.push({
        name: heading,
        heading: headingLine,
        lines: body,
        inCatalogue: headingInCatalogue,
      });
    }
  };

  for (const line of lines) {
    if (CATALOGUE_HEADING.test(line)) inCatalogue = true;
    const match = HEADING.exec(line);
    if (match) {
      push();
      heading = match[1]!;
      headingLine = line;
      headingInCatalogue = inCatalogue;
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  push();

  return blocks;
}

export interface MagicItemParseOutput extends ParseOutput<MagicItem> {
  /**
   * Every `#### ` heading in the file that carried no magic item type line,
   * in print order: the four rules subsections, and the two stat blocks the
   * SRD prints inside an entry. `items.length + skipped.length` is therefore
   * the number of `#### ` headings in the source.
   *
   * Reported rather than dropped so a test can assert the boundary in both
   * directions — that no rules section became an item, and that no item was
   * mistaken for one.
   */
  readonly skipped: readonly string[];
}

export function parseMagicItems(markdown: string, source: string): MagicItemParseOutput {
  const items: MagicItem[] = [];
  const problems: ParseProblem[] = [];
  const skipped: string[] = [];

  const blocks = splitBlocks(markdown);
  if (blocks === null) {
    return {
      items,
      skipped,
      problems: [
        {
          source,
          entry: 'magic-items.md',
          message: 'no "## Magic Items A–Z" heading: the file is not laid out as this parser expects',
        },
      ],
    };
  }

  /** Blocks of an entry, kept apart so a stat block can be folded back in. */
  let pending: { readonly name: string; readonly type: MagicItemType; blocks: string[] } | null =
    null;

  const flush = (): void => {
    if (pending === null) return;
    const description = pending.blocks.join('\n\n').trim();
    const item = {
      id: slugify(pending.name),
      name: pending.name,
      category: pending.type.category,
      subtype: pending.type.subtype,
      rarity: pending.type.rarity,
      requiresAttunement: pending.type.requiresAttunement,
      attunementPrerequisite: pending.type.attunementPrerequisite,
      charges: parseMagicItemCharges(description),
      description,
    };
    const validated = MagicItemSchema.safeParse(item);
    if (validated.success) items.push(validated.data);
    else {
      problems.push({
        source,
        entry: pending.name,
        message: validated.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
    pending = null;
  };

  for (const block of blocks) {
    const first = block.lines.findIndex((line) => line.trim() !== '');
    const type =
      block.inCatalogue && first !== -1 ? parseMagicItemTypeLine(block.lines[first]!) : null;

    if (type === null) {
      skipped.push(block.name);
      // Inside the A–Z list this is a stat block the book prints mid-entry.
      // Keep it where the page puts it rather than truncating the entry it
      // interrupts. Above the list there is no entry to fold it into, and the
      // four rules subsections are simply dropped.
      if (block.inCatalogue) {
        pending?.blocks.push([block.heading, ...block.lines].join('\n').trim());
      }
      continue;
    }

    flush();
    pending = { name: block.name, type, blocks: [block.lines.slice(first + 1).join('\n').trim()] };
  }
  flush();

  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      problems.push({ source, entry: item.name, message: `duplicate id "${item.id}"` });
    }
    ids.add(item.id);
  }

  return { items, problems, skipped };
}
