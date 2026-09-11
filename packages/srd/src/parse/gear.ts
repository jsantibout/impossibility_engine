import {
  AmmunitionSchema,
  GearSchema,
  ToolSchema,
  slugify,
  type Ammunition,
  type Gear,
  type GearCost,
  type GearVariant,
  type GearWeight,
  type PackContent,
  type ParseProblem,
  type Tool,
  type ToolUse,
} from '../schemas.js';
import { parseCost, splitTopLevel } from './equipment.js';

/**
 * Parser for the Adventuring Gear and Tools sections of `raw/equipment.md`.
 *
 * Unlike weapons and armour, which are wholly table-driven, gear is a hybrid:
 * one master table carries every item's weight and cost, and a `####` heading
 * per item carries the prose. Tools are the other way round — no table at all,
 * just bold field lines under each entry.
 *
 * Three things in this transcription will mislead a parser that assumes the
 * obvious structure, and each has a test:
 *
 * 1. The master **Adventuring Gear** table is filed *under* the
 *    `#### Ammunition` heading rather than under `## Adventuring Gear`. Taking
 *    an entry's prose as "everything up to the next heading" folds 420 lines of
 *    table into Ammunition's description. Tables are located by their bold
 *    caption and removed from prose, so where they sit does not matter.
 * 2. `Spell Scroll` has one heading and two priced rows. An exact name match
 *    drops both.
 * 3. The Entertainer's Pack weighs `58½ lb.` — a vulgar fraction, not `58.5`.
 *    A `[\d.]+` regex reads no weight at all and the pack becomes weightless.
 */

/** U+00BD and friends. `58½` is a real weight in the gear table. */
const VULGAR_FRACTIONS: Readonly<Record<string, number>> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const EM_DASH = /^[—–-]$/;
const VARIES = /^varies$/i;

/**
 * Read a weight cell as one of three states.
 *
 * `—` and `Varies` are both non-numeric and mean opposite things — see
 * `GearWeightSchema`. Anything else unreadable returns null so the caller can
 * report a problem; it never falls back to a plausible number.
 */
export function parseGearWeight(raw: string): GearWeight | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (EM_DASH.test(trimmed)) return { kind: 'negligible' };
  if (VARIES.test(trimmed)) return { kind: 'varies' };

  // `1/2 lb.`
  const fraction = /^(\d+)\s*\/\s*(\d+)\s*lb/i.exec(trimmed);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return { kind: 'lb', value: Number(fraction[1]) / denominator };
  }

  // `58½ lb.`, `½ lb.` — an optional whole part followed by a fraction glyph.
  const vulgar = /^(\d*)\s*([½¼¾⅓⅔⅛⅜⅝⅞])\s*lb/i.exec(trimmed);
  if (vulgar) {
    const whole = vulgar[1] === '' ? 0 : Number(vulgar[1]);
    return { kind: 'lb', value: whole + VULGAR_FRACTIONS[vulgar[2]!]! };
  }

  // `5 lb.`, and the Waterskin's `5 lb. (full)` — the parenthetical is a note.
  const whole = /^([\d.]+)\s*lb/i.exec(trimmed);
  return whole ? { kind: 'lb', value: Number(whole[1]) } : null;
}

/** As `parseGearWeight`, but the cost column never prints `—`. */
export function parseGearCost(raw: string): GearCost | null {
  const trimmed = raw.trim();
  if (VARIES.test(trimmed)) return { kind: 'varies' };
  const cost = parseCost(trimmed);
  return cost === null ? null : { kind: 'cost', value: cost };
}

/**
 * Read a tool's `Variants` field.
 *
 * Two shapes share the field: a Gaming Set's `Dice (1 SP)` prices the variant
 * and nothing else, while a Musical Instrument's `Bagpipes (30 GP, 6 lb.)`
 * gives a weight too. Where the weight is not printed the variant weighs what
 * the tool weighs — a set of dice is negligible because the Gaming Set entry
 * says `—`, which is the book's own answer rather than an assumption.
 */
export function parseToolVariants(raw: string, fallbackWeight: GearWeight): GearVariant[] {
  const variants: GearVariant[] = [];

  for (const part of splitTopLevel(raw)) {
    const match = /^(.+?)\s*\(([^)]*)\)$/.exec(part.trim());
    if (!match) continue;

    const name = match[1]!.trim();
    // `30 GP, 6 lb.` — cost first, weight second when present.
    const [costRaw, weightRaw] = match[2]!.split(',').map((s) => s.trim());

    const cost = parseGearCost(costRaw ?? '');
    if (cost === null) continue;

    const weight = weightRaw === undefined ? fallbackWeight : parseGearWeight(weightRaw);
    if (weight === null) continue;

    variants.push({ id: slugify(name), name, weight, cost });
  }

  return variants;
}

interface TableBlock {
  /** The bold caption above the table, e.g. `Arcane Focuses`. */
  readonly caption: string;
  /** Line indices the caption and table occupy, so prose can exclude them. */
  readonly from: number;
  readonly to: number;
  readonly columns: number;
  readonly cells: readonly string[];
}

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, '').trim();

/**
 * Find every captioned table in a range of lines.
 *
 * Captions are how a table is identified rather than its position, because the
 * master gear table does not sit where its heading says it does.
 */
function readTables(lines: readonly string[], from: number, to: number): TableBlock[] {
  const tables: TableBlock[] = [];

  for (let i = from; i < to; i++) {
    if (lines[i]!.trim() !== '<table>') continue;

    const close = lines.findIndex((l, j) => j > i && l.trim() === '</table>');
    if (close === -1 || close >= to) continue;

    // The caption is the nearest preceding bold-only line.
    let captionAt = i - 1;
    while (captionAt > from && lines[captionAt]!.trim() === '') captionAt--;
    const caption = /^\*\*(.+)\*\*$/.exec(lines[captionAt]!.trim());

    const html = lines.slice(i, close + 1).join('\n');
    const columns = [...html.matchAll(/<th>([\s\S]*?)<\/th>/g)].length;
    const cells = [...html.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]!));

    tables.push({
      caption: caption ? caption[1]!.trim() : '',
      from: caption ? captionAt : i,
      to: close,
      columns,
      cells,
    });

    i = close;
  }

  return tables;
}

/** Group a table's cells into rows, or null when the count does not divide. */
function rowsOf(table: TableBlock): string[][] | null {
  if (table.columns === 0 || table.cells.length % table.columns !== 0) return null;

  const rows: string[][] = [];
  for (let i = 0; i < table.cells.length; i += table.columns) {
    rows.push(table.cells.slice(i, i + table.columns));
  }
  return rows;
}

/** The line range of a `## Heading` section, up to the next `## `. */
function sectionRange(lines: readonly string[], heading: string): { from: number; to: number } | null {
  const from = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (from === -1) return null;

  const next = lines.findIndex((l, i) => i > from && /^##\s+\S/.test(l.trim()));
  return { from, to: next === -1 ? lines.length : next };
}

interface Entry {
  readonly name: string;
  readonly description: string;
  readonly variants: readonly GearVariant[];
}

export interface GearOutput {
  readonly gear: readonly Gear[];
  readonly ammunition: readonly Ammunition[];
  readonly tools: readonly Tool[];
  readonly problems: readonly ParseProblem[];
}

/** Captions of tables that are not a single entry's variant list. */
const MASTER_TABLE = 'Adventuring Gear';
const AMMUNITION_TABLE = 'Ammunition';

export function parseGear(markdown: string, source: string): GearOutput {
  const lines = markdown.split(/\r?\n/);
  const problems: ParseProblem[] = [];
  const problem = (entry: string, message: string): void => {
    problems.push({ source, entry, message });
  };

  const gear = parseGearSection(lines, problem);
  const tools = parseToolsSection(lines, problem);

  // Packs reference other rows, so their contents can only be resolved once
  // every row exists. A second pass over the same list, after the first.
  const rows = gear.gear;
  const idByName = new Map(rows.map((item) => [item.name.toLowerCase(), item.id]));
  const lookup = (name: string): string | null => idByName.get(name.toLowerCase()) ?? null;

  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    if (item === undefined) continue;
    const contents = parsePackContents(item.description, lookup);
    for (const phrase of contents.unresolved) {
      problem(item.name, `contents list "${phrase}" names no row in the gear table`);
    }
    if (contents.lines.length > 0) rows[index] = { ...item, contents: [...contents.lines] };
  }

  return { gear: rows, ammunition: gear.ammunition, tools, problems };
}

type Report = (entry: string, message: string) => void;

function parseGearSection(
  lines: readonly string[],
  problem: Report,
): { gear: Gear[]; ammunition: Ammunition[] } {
  const gear: Gear[] = [];
  const ammunition: Ammunition[] = [];

  const range = sectionRange(lines, 'Adventuring Gear');
  if (range === null) {
    problem('Adventuring Gear', 'could not locate the section');
    return { gear, ammunition };
  }

  const tables = readTables(lines, range.from, range.to);
  const headings: number[] = [];
  for (let i = range.from; i < range.to; i++) {
    if (/^####\s+\S/.test(lines[i]!)) headings.push(i);
  }

  // Prose for an entry is its region with every captioned table cut out.
  const entries = new Map<string, Entry>();
  for (const [index, at] of headings.entries()) {
    const until = headings[index + 1] ?? range.to;
    // `#### Spell Scroll (Cantrip, 30 GP; Level 1, 50 GP)` -> `Spell Scroll`.
    const name = lines[at]!.replace(/^####\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();

    const inRegion = tables.filter((t) => t.from > at && t.to < until);
    const isVariantTable = (t: TableBlock): boolean =>
      t.caption !== MASTER_TABLE && t.caption !== AMMUNITION_TABLE && t.columns === 3;

    const description = lines
      .slice(at + 1, until)
      .filter((_, offset) => !inRegion.some((t) => at + 1 + offset >= t.from && at + 1 + offset <= t.to))
      .join('\n')
      .trim();

    const variantTable = inRegion.find(isVariantTable);
    const variants: GearVariant[] = [];
    if (variantTable !== undefined) {
      const rows = rowsOf(variantTable);
      if (rows === null) {
        problem(name, `${variantTable.caption}: ${variantTable.cells.length} cells is not a whole number of rows`);
      } else {
        for (const [variantName, weightRaw, costRaw] of rows as [string, string, string][]) {
          const weight = parseGearWeight(weightRaw);
          const cost = parseGearCost(costRaw);
          if (weight === null || cost === null) {
            problem(variantName, `unreadable variant weight "${weightRaw}" or cost "${costRaw}"`);
            continue;
          }
          variants.push({ id: slugify(variantName), name: variantName, weight, cost });
        }
      }
    }

    entries.set(name, { name, description, variants });
  }

  const master = tables.find((t) => t.caption === MASTER_TABLE);
  if (master === undefined) {
    problem(MASTER_TABLE, 'could not locate the master gear table');
  } else {
    const rows = rowsOf(master);
    if (rows === null) {
      problem(MASTER_TABLE, `${master.cells.length} cells is not a whole number of ${master.columns}-cell rows`);
    } else {
      const matched = new Set<string>();

      for (const [name, weightRaw, costRaw] of rows as [string, string, string][]) {
        // Exact first; then the `Spell Scroll (Cantrip)` case, where one
        // heading describes several priced rows.
        const entry =
          entries.get(name) ??
          [...entries.values()].find((e) => name.startsWith(`${e.name} (`));

        if (entry === undefined) {
          problem(name, 'priced in the gear table but has no description');
          continue;
        }
        matched.add(entry.name);

        const weight = parseGearWeight(weightRaw);
        const cost = parseGearCost(costRaw);
        if (weight === null || cost === null) {
          problem(name, `unreadable weight "${weightRaw}" or cost "${costRaw}"`);
          continue;
        }

        const candidate = {
          id: slugify(name),
          name,
          weight,
          cost,
          description: entry.description,
          variants: entry.variants,
          contents: [],
        };

        const validated = GearSchema.safeParse(candidate);
        if (!validated.success) {
          problem(name, validated.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
          continue;
        }
        gear.push(validated.data);
      }

      for (const entry of entries.values()) {
        if (!matched.has(entry.name)) problem(entry.name, 'described but absent from the gear table');
      }
    }
  }

  const ammoTable = tables.find((t) => t.caption === AMMUNITION_TABLE);
  if (ammoTable === undefined) {
    problem(AMMUNITION_TABLE, 'could not locate the ammunition table');
  } else {
    const rows = rowsOf(ammoTable);
    if (rows === null) {
      problem(AMMUNITION_TABLE, `${ammoTable.cells.length} cells is not a whole number of rows`);
    } else {
      for (const [name, amountRaw, storage, weightRaw, costRaw] of rows as [
        string,
        string,
        string,
        string,
        string,
      ][]) {
        const weight = parseGearWeight(weightRaw);
        const cost = parseGearCost(costRaw);
        if (weight === null || cost === null) {
          problem(name, `unreadable weight "${weightRaw}" or cost "${costRaw}"`);
          continue;
        }

        const candidate = {
          id: slugify(name),
          name,
          amount: Number(amountRaw),
          storage,
          weight,
          cost,
        };

        const validated = AmmunitionSchema.safeParse(candidate);
        if (!validated.success) {
          problem(name, validated.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
          continue;
        }
        ammunition.push(validated.data);
      }
    }
  }

  return { gear, ammunition };
}

/** `Identify a substance (DC 15), or start a fire (DC 15)`. */
export function parseToolUses(raw: string): ToolUse[] {
  const uses: ToolUse[] = [];

  for (const part of splitTopLevel(raw)) {
    // Only a *leading* `or` joins two uses; `10 or fewer words` must survive.
    const text = part.trim().replace(/^or\s+/i, '');
    const dc = /\(DC\s*(\d+)\)\s*$/i.exec(text);

    uses.push({
      description: dc ? text.slice(0, dc.index).trim() : text,
      dc: dc ? Number(dc[1]) : null,
    });
  }

  return uses;
}

/** `Ink, _Spell Scroll_` — italics mark a magic item, not part of its name. */
export function parseCraftList(raw: string): string[] {
  return splitTopLevel(raw).map((item) => item.replace(/_/g, '').trim());
}

const TOOL_ABILITIES: Readonly<Record<string, Tool['ability']>> = {
  strength: 'strength',
  dexterity: 'dexterity',
  constitution: 'constitution',
  intelligence: 'intelligence',
  wisdom: 'wisdom',
  charisma: 'charisma',
};

function parseToolsSection(lines: readonly string[], problem: Report): Tool[] {
  const tools: Tool[] = [];

  const range = sectionRange(lines, 'Tools');
  if (range === null) {
    problem('Tools', 'could not locate the section');
    return tools;
  }

  let category: Tool['category'] | null = null;

  for (let i = range.from; i < range.to; i++) {
    const line = lines[i]!.trim();

    if (/^####\s+Artisan's Tools\s*$/.test(line)) {
      category = 'artisan';
      continue;
    }
    if (/^####\s+Other Tools\s*$/.test(line)) {
      category = 'other';
      continue;
    }

    // A tool heading is a whole-line bold name ending in a parenthesised cost.
    // The field lines below it (`**Ability:** ... **Weight:** ...`) do not
    // match, because they carry text outside the bold markers.
    const heading = /^\*\*(.+?)\s*\(([^)]*)\)\*\*$/.exec(line);
    if (!heading || category === null) continue;

    const name = heading[1]!.trim();
    const cost = parseGearCost(heading[2]!);
    if (cost === null) {
      problem(name, `unreadable cost: "${heading[2]}"`);
      continue;
    }

    // Fields run until the next blank-separated heading; read to the next
    // bold heading or the section's end.
    const until = lines.findIndex(
      (l, j) => j > i && (/^\*\*(.+?)\s*\(([^)]*)\)\*\*$/.test(l.trim()) || /^#{1,4}\s+\S/.test(l.trim())),
    );
    const body = lines.slice(i + 1, until === -1 || until > range.to ? range.to : until).join('\n');

    const abilityRaw = /\*\*Ability:\*\*\s*([A-Za-z]+)/.exec(body);
    const weightRaw = /\*\*Weight:\*\*\s*(.+?)\s*$/m.exec(body);
    const utilizeRaw = /\*\*Utilize:\*\*\s*(.+?)\s*$/m.exec(body);
    const craftRaw = /\*\*Craft:\*\*\s*(.+?)\s*$/m.exec(body);
    const variantsRaw = /\*\*Variants:\*\*\s*(.+?)\s*$/m.exec(body);

    const ability = abilityRaw ? TOOL_ABILITIES[abilityRaw[1]!.toLowerCase()] : undefined;
    if (ability === undefined) {
      problem(name, `unknown or missing ability: "${abilityRaw?.[1] ?? ''}"`);
      continue;
    }

    const weight = weightRaw ? parseGearWeight(weightRaw[1]!) : null;
    if (weight === null) {
      problem(name, `unreadable weight: "${weightRaw?.[1] ?? ''}"`);
      continue;
    }

    if (utilizeRaw === null) {
      problem(name, 'no Utilize entry');
      continue;
    }

    const candidate = {
      id: slugify(name),
      name,
      category,
      ability,
      utilize: parseToolUses(utilizeRaw[1]!),
      craft: craftRaw ? parseCraftList(craftRaw[1]!) : [],
      variants: variantsRaw ? parseToolVariants(variantsRaw[1]!, weight) : [],
      weight,
      cost,
    };

    const validated = ToolSchema.safeParse(candidate);
    if (!validated.success) {
      problem(name, validated.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
      continue;
    }
    tools.push(validated.data);
  }

  return tools;
}

/**
 * SRD prints a pack's contents as a sentence rather than a table:
 *
 * > "A Scholar's Pack contains the following items: Backpack, Book, Ink, Ink
 * > Pen, Lamp, 10 flasks of Oil, 10 sheets of Parchment, and Tinderbox."
 *
 * Buying the pack has to put those rows into somebody's hands, so each phrase
 * is resolved back to the row it names. Three habits of the source get in the
 * way, and every one of them is the book's rather than the parser's:
 *
 * - a count with a unit: `10 flasks of Oil`, `5 days of Rations`
 * - a bare plural: `10 Candles`, `5 Ink Pens`, `10 Torches`
 * - an inverted table name: the sentence says `Hooded Lantern` where the table
 *   alphabetises it as `Lantern, Hooded`
 *
 * A phrase that resolves to nothing comes back in `unresolved` rather than
 * being dropped, because a pack quietly missing an item is a theft nobody
 * notices until the rope is needed.
 */
export interface PackContents {
  readonly lines: readonly PackContent[];
  readonly unresolved: readonly string[];
}

const CONTENTS = /contains the following items:\s*(.+?)\.\s*$/is;

/** `10 flasks of Oil` → 10 and `Oil`; `Backpack` → 1 and `Backpack`. */
function readPhrase(phrase: string): { quantity: number; name: string } {
  const counted = /^(\d+)\s+(.*)$/.exec(phrase.trim());
  if (counted === null) return { quantity: 1, name: phrase.trim() };

  const quantity = Number(counted[1]);
  const rest = (counted[2] ?? '').trim();

  // "flasks of Oil", "days of Rations", "sheets of Parchment": the unit is
  // packaging, and the row is what comes after "of".
  const unit = /^[a-z]+\s+of\s+(.+)$/.exec(rest);
  return { quantity, name: (unit === null ? rest : (unit[1] ?? rest)).trim() };
}

/** Singular forms the SRD's plurals take, tried in order. */
function singulars(name: string): string[] {
  const forms = [name];
  if (name.endsWith('ies')) forms.push(`${name.slice(0, -3)}y`);
  if (name.endsWith('es')) forms.push(name.slice(0, -2));
  if (name.endsWith('s')) forms.push(name.slice(0, -1));
  return forms;
}

/** `Hooded Lantern` is how anyone says `Lantern, Hooded`. */
function inversions(name: string): string[] {
  const words = name.split(' ');
  if (words.length < 2) return [];
  const last = words[words.length - 1];
  const rest = words.slice(0, -1).join(' ');
  return last === undefined ? [] : [`${last}, ${rest}`];
}

/**
 * Read a contents sentence, resolving each phrase with the supplied lookup.
 *
 * The lookup is passed in rather than closed over so this can be tested
 * without the whole catalogue, and so the resolution order stays visible: as
 * printed, then singular, then un-inverted, then both.
 */
export function parsePackContents(
  description: string,
  idFor: (name: string) => string | null,
): PackContents {
  const sentence = CONTENTS.exec(description);
  if (sentence === null) return { lines: [], unresolved: [] };

  const lines: PackContent[] = [];
  const unresolved: string[] = [];

  for (const raw of (sentence[1] ?? '').split(',')) {
    const printed = raw.replace(/^\s*and\s+/i, '').trim();
    if (printed === '') continue;

    const { quantity, name } = readPhrase(printed);
    const candidates = [
      ...singulars(name),
      ...singulars(name).flatMap((form) => inversions(form)),
    ];

    const gearId = candidates.map(idFor).find((id): id is string => id !== null) ?? null;
    if (gearId === null) {
      unresolved.push(printed);
      continue;
    }
    lines.push({ gearId, printed, quantity });
  }

  return { lines, unresolved };
}
