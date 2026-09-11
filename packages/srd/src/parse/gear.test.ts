import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEquipment } from './equipment.js';
import {
  parseGear,
  parseGearCost,
  parseGearWeight,
  parsePackContents,
  parseToolVariants,
} from './gear.js';
import { AmmunitionSchema, GearSchema, ToolSchema } from '../schemas.js';

const markdown = readFileSync(
  fileURLToPath(new URL('../../raw/equipment.md', import.meta.url)),
  'utf8',
);
const parsed = parseGear(markdown, 'equipment.md');
/** Weapons and armour come from the other parser over the same file. */
const equipment = parseEquipment(markdown, 'equipment.md');

const gearNamed = (name: string) => parsed.gear.find((g) => g.name === name);
const toolNamed = (name: string) => parsed.tools.find((t) => t.name === name);

describe('parseGearWeight', () => {
  it.each([
    ['1 lb.', { kind: 'lb', value: 1 }],
    ['70 lb.', { kind: 'lb', value: 70 }],
    ['1/2 lb.', { kind: 'lb', value: 0.5 }],
  ])('parses %s', (input, expected) => {
    expect(parseGearWeight(input)).toEqual(expected);
  });

  // The Entertainer's Pack prints `58½ lb.` with U+00BD, not `58.5`. A digit
  // regex stops at the 58, fails to find `lb`, and returns nothing — so a
  // 58½ lb pack becomes weightless and encumbrance silently under-counts.
  it('reads a vulgar fraction as a half', () => {
    expect(parseGearWeight('58½ lb.')).toEqual({ kind: 'lb', value: 58.5 });
    expect(parseGearWeight('½ lb.')).toEqual({ kind: 'lb', value: 0.5 });
    expect(parseGearWeight('1¼ lb.')).toEqual({ kind: 'lb', value: 1.25 });
  });

  // The Waterskin is `5 lb. (full)`. The parenthetical is a note, not a unit.
  it('ignores a parenthetical note after the unit', () => {
    expect(parseGearWeight('5 lb. (full)')).toEqual({ kind: 'lb', value: 5 });
  });

  // `—` and `Varies` are not the same absence and must not both become null.
  it('keeps negligible and varies apart', () => {
    expect(parseGearWeight('—')).toEqual({ kind: 'negligible' });
    expect(parseGearWeight('Varies')).toEqual({ kind: 'varies' });
  });

  it('refuses a cell it cannot read rather than guessing', () => {
    expect(parseGearWeight('heavyish')).toBeNull();
    expect(parseGearWeight('')).toBeNull();
  });
});

describe('parseGearCost', () => {
  it('parses a priced cell', () => {
    expect(parseGearCost('25 GP')).toEqual({ kind: 'cost', value: { amount: 25, currency: 'gp' } });
    expect(parseGearCost('1,000 GP')).toEqual({
      kind: 'cost',
      value: { amount: 1000, currency: 'gp' },
    });
  });

  it('parses Varies', () => {
    expect(parseGearCost('Varies')).toEqual({ kind: 'varies' });
  });

  it('refuses an unreadable cell', () => {
    expect(parseGearCost('—')).toBeNull();
    expect(parseGearCost('cheap')).toBeNull();
  });
});

describe('parseToolVariants', () => {
  // Two shapes in one field: a Gaming Set's variants are priced only, a
  // Musical Instrument's carry a weight too. The commas inside the
  // parentheses are the trap `splitTopLevel` already exists to handle.
  // An unpriced weight falls back to the tool's own, which is the book's
  // answer — the Gaming Set entry itself prints `—`.
  it('reads cost-only variants', () => {
    expect(parseToolVariants('Dice (1 SP), dragonchess (1 GP)', { kind: 'negligible' })).toEqual([
      {
        id: 'dice',
        name: 'Dice',
        weight: { kind: 'negligible' },
        cost: { kind: 'cost', value: { amount: 1, currency: 'sp' } },
      },
      {
        id: 'dragonchess',
        name: 'dragonchess',
        weight: { kind: 'negligible' },
        cost: { kind: 'cost', value: { amount: 1, currency: 'gp' } },
      },
    ]);
  });

  it('reads variants carrying a weight', () => {
    expect(parseToolVariants('Bagpipes (30 GP, 6 lb.), flute (2 GP, 1 lb.)', { kind: 'varies' })).toEqual([
      {
        id: 'bagpipes',
        name: 'Bagpipes',
        weight: { kind: 'lb', value: 6 },
        cost: { kind: 'cost', value: { amount: 30, currency: 'gp' } },
      },
      {
        id: 'flute',
        name: 'flute',
        weight: { kind: 'lb', value: 1 },
        cost: { kind: 'cost', value: { amount: 2, currency: 'gp' } },
      },
    ]);
  });
});

describe('parseGear', () => {
  it('parses the whole file without problems', () => {
    expect(parsed.problems).toEqual([]);
  });

  // Counts, not just "no problems": a parser that skipped every entry would
  // report nothing wrong at all. This is how animals.md once yielded zero.
  it('parses every row of the Adventuring Gear table', () => {
    expect(parsed.gear).toHaveLength(82);
  });

  it('parses all 25 tools, split into artisan and other', () => {
    expect(parsed.tools).toHaveLength(25);
    expect(parsed.tools.filter((t) => t.category === 'artisan')).toHaveLength(17);
    expect(parsed.tools.filter((t) => t.category === 'other')).toHaveLength(8);
  });

  // Gear and tools are the first SRD entries whose names carry apostrophes.
  // A slug that replaced one with a separator would give
  // `alchemist-s-supplies`, which reads as a different word.
  it('drops an apostrophe from an id rather than splitting on it', () => {
    expect(toolNamed("Alchemist's Supplies")?.id).toBe('alchemists-supplies');
    expect(toolNamed("Thieves' Tools")?.id).toBe('thieves-tools');
    expect(gearNamed("Explorer's Pack")?.id).toBe('explorers-pack');
  });

  it('gives every entry a unique id', () => {
    const ids = [...parsed.gear, ...parsed.tools].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates every entry against its schema', () => {
    for (const item of parsed.gear) expect(GearSchema.safeParse(item).success).toBe(true);
    for (const tool of parsed.tools) expect(ToolSchema.safeParse(tool).success).toBe(true);
    for (const ammo of parsed.ammunition) {
      expect(AmmunitionSchema.safeParse(ammo).success).toBe(true);
    }
  });

  it('describes every item it priced', () => {
    const undescribed = parsed.gear.filter((g) => g.description.trim() === '');
    expect(undescribed.map((g) => g.name)).toEqual([]);
  });

  it('reads the weights the naive parser got wrong', () => {
    expect(gearNamed("Entertainer's Pack")?.weight).toEqual({ kind: 'lb', value: 58.5 });
    expect(gearNamed('Waterskin')?.weight).toEqual({ kind: 'lb', value: 5 });
  });

  it('distinguishes a negligible weight from a varying one', () => {
    expect(gearNamed('Bell')?.weight).toEqual({ kind: 'negligible' });
    expect(gearNamed('Arcane Focus')?.weight).toEqual({ kind: 'varies' });
    expect(gearNamed('Arcane Focus')?.cost).toEqual({ kind: 'varies' });
  });

  // The transcription files the master Adventuring Gear table *under* the
  // `#### Ammunition` heading rather than under `## Adventuring Gear`. A
  // parser that takes everything up to the next heading as prose swallows
  // 420 lines of table into one item's description.
  it('keeps the misfiled master table out of the Ammunition description', () => {
    const ammunition = gearNamed('Ammunition');
    expect(ammunition?.description).not.toMatch(/<table|Alchemist's Fire/);
    expect(ammunition?.description).toMatch(/^Ammunition is required by a weapon/);
  });

  it('attaches a variant table to the entry it belongs to', () => {
    expect(gearNamed('Arcane Focus')?.variants.map((v) => v.name)).toEqual([
      'Crystal',
      'Orb',
      'Rod',
      'Staff (also a Quarterstaff)',
      'Wand',
    ]);
    expect(gearNamed('Druidic Focus')?.variants).toHaveLength(3);
    expect(gearNamed('Holy Symbol')?.variants).toHaveLength(3);
  });

  it('leaves a fixed-price item without variants', () => {
    expect(gearNamed('Backpack')?.variants).toEqual([]);
    expect(gearNamed('Backpack')?.weight).toEqual({ kind: 'lb', value: 5 });
    expect(gearNamed('Backpack')?.cost).toEqual({
      kind: 'cost',
      value: { amount: 2, currency: 'gp' },
    });
  });

  // One heading, two priced rows. An exact name match drops both.
  it('prices both Spell Scroll rows from the one description', () => {
    const scrolls = parsed.gear.filter((g) => g.name.startsWith('Spell Scroll'));
    expect(scrolls.map((s) => s.name)).toEqual(['Spell Scroll (Cantrip)', 'Spell Scroll (Level 1)']);
    expect(scrolls[0]?.cost).toEqual({ kind: 'cost', value: { amount: 30, currency: 'gp' } });
    expect(scrolls[1]?.cost).toEqual({ kind: 'cost', value: { amount: 50, currency: 'gp' } });
    expect(scrolls[0]?.description).toBe(scrolls[1]?.description);
  });

  it('parses the Ammunition table with its own columns', () => {
    expect(parsed.ammunition).toHaveLength(5);
    const arrows = parsed.ammunition.find((a) => a.name === 'Arrows');
    expect(arrows).toEqual({
      id: 'arrows',
      name: 'Arrows',
      amount: 20,
      storage: 'Quiver',
      weight: { kind: 'lb', value: 1 },
      cost: { kind: 'cost', value: { amount: 1, currency: 'gp' } },
    });
  });

  it('parses a tool ability, uses and craft list', () => {
    expect(toolNamed("Alchemist's Supplies")).toEqual({
      id: 'alchemists-supplies',
      name: "Alchemist's Supplies",
      category: 'artisan',
      ability: 'intelligence',
      utilize: [
        { description: 'Identify a substance', dc: 15 },
        { description: 'start a fire', dc: 15 },
      ],
      craft: ['Acid', "Alchemist's Fire", 'Component Pouch', 'Oil', 'Paper', 'Perfume'],
      variants: [],
      weight: { kind: 'lb', value: 8 },
      cost: { kind: 'cost', value: { amount: 50, currency: 'gp' } },
    });
  });

  it('records a tool that crafts nothing as crafting nothing', () => {
    expect(toolNamed('Forgery Kit')?.craft).toEqual([]);
    expect(parsed.tools.filter((t) => t.craft.length > 0)).toHaveLength(20);
  });

  it('parses the two tools that have variants', () => {
    expect(toolNamed('Gaming Set')?.variants).toHaveLength(4);
    expect(toolNamed('Musical Instrument')?.variants).toHaveLength(10);
    expect(toolNamed('Musical Instrument')?.variants[0]).toEqual({
      id: 'bagpipes',
      name: 'Bagpipes',
      weight: { kind: 'lb', value: 6 },
      cost: { kind: 'cost', value: { amount: 30, currency: 'gp' } },
    });
    expect(parsed.tools.filter((t) => t.variants.length > 0)).toHaveLength(2);
  });

  it('reads an ability from every tool', () => {
    expect(toolNamed("Thieves' Tools")?.ability).toBe('dexterity');
    expect(toolNamed('Gaming Set')?.ability).toBe('wisdom');
  });

  // A tool's own cost and weight come from its bold heading, not a table.
  it('prices a tool whose variants carry the real numbers', () => {
    expect(toolNamed('Musical Instrument')?.cost).toEqual({ kind: 'varies' });
    expect(toolNamed('Musical Instrument')?.weight).toEqual({ kind: 'varies' });
    expect(toolNamed('Gaming Set')?.weight).toEqual({ kind: 'negligible' });
  });
});

describe('a tool crafts things that exist', () => {
  /**
   * CLAUDE.md: "Where a field is derivable from another, assert the
   * relationship rather than only the presence." A craft list is a list of
   * *other rows*, so it can be checked against them — and that check is what
   * will catch the next time a comma lands somewhere unexpected.
   *
   * Two conventions it has to know about, both the source's rather than the
   * parser's:
   *
   * - **The gear table inverts its names for alphabetisation** — `Lantern,
   *   Bullseye` and `Clothes, Fine` — while a craft list writes them the way
   *   anyone would say them. The parser keeps the table's wording, which is
   *   right; matching has to un-invert.
   * - **Some entries are categories, not items**: "Any Melee weapon (except
   *   Club, Greatclub, Quarterstaff, and Whip)". Those commas are inside
   *   parentheses, which is exactly the trap that bit the weapon parser, and
   *   they survive here as one entry.
   */
  const CATEGORY = /^(any |medium armor|heavy armor|light armor|ranged weapons)/i;

  /** `Lantern, Bullseye` also answers to `Bullseye Lantern`. */
  const namesOf = (name: string): string[] => {
    const inverted = /^([^,]+),\s*(.+)$/.exec(name);
    return inverted === null
      ? [name.toLowerCase()]
      : [name.toLowerCase(), `${inverted[2]} ${inverted[1]}`.toLowerCase()];
  };

  // A craft list reaches across both parsers of this one file: Smith's Tools
  // makes weapons and armour, Weaver's Tools makes cloth armour and gear.
  const catalogue = new Set(
    [
      ...parsed.gear,
      ...parsed.tools,
      ...parsed.ammunition,
      ...equipment.weapons,
      ...equipment.armor,
    ].flatMap((item) => namesOf(item.name)),
  );

  it('names something the SRD actually lists, or a category of them', () => {
    const unresolved = new Set<string>();
    for (const tool of parsed.tools) {
      for (const craft of tool.craft) {
        if (CATEGORY.test(craft)) continue;
        if (catalogue.has(craft.toLowerCase())) continue;
        unresolved.add(craft);
      }
    }

    // Spell Scroll is the one exception, and it is honest: it is a magic item,
    // and `magic-items.md` is vendored but not parsed. When it is, this set
    // should empty and the test will say so.
    expect([...unresolved]).toEqual(['Spell Scroll']);
  });

  it('keeps a parenthesised exception list in one piece', () => {
    const smith = toolNamed("Smith's Tools");
    expect(smith?.craft).toContain('Any Melee weapon (except Club, Greatclub, Quarterstaff, and Whip)');
    // And does not leave the exceptions lying about as craftable items.
    expect(smith?.craft).not.toContain('Greatclub');
  });

  it('resolves an inverted gear name to the way a craft list says it', () => {
    // The table says "Pot, Iron"; Smith's Tools says "Iron Pot".
    expect(gearNamed('Pot, Iron')).toBeDefined();
    expect(toolNamed("Smith's Tools")?.craft).toContain('Iron Pot');
    expect(catalogue.has('iron pot')).toBe(true);
  });
});

describe('a pack lists what is in it', () => {
  /**
   * SRD prints a pack's contents as a sentence: "A Scholar's Pack contains the
   * following items: Backpack, Book, Ink, Ink Pen, Lamp, 10 flasks of Oil, 10
   * sheets of Parchment, and Tinderbox."
   *
   * Buying the pack has to put those rows in a character's hands, so each
   * phrase is resolved back to the row it names. Three things stand in the way,
   * and all three are the source's habits rather than the parser's:
   *
   * - a count and a unit: `10 flasks of Oil`, `5 days of Rations`
   * - a plural: `10 Candles`, `5 Ink Pens`, `10 Torches`
   * - an inverted table name: the sentence says `Hooded Lantern`, the table
   *   says `Lantern, Hooded`
   */
  it('resolves every phrase in every pack', () => {
    const packs = parsed.gear.filter((g) => g.name.endsWith('Pack'));
    expect(packs).toHaveLength(7);
    for (const pack of packs) {
      expect(pack.contents.length).toBeGreaterThan(0);
      for (const line of pack.contents) {
        expect(parsed.gear.some((g) => g.id === line.gearId)).toBe(true);
      }
    }
  });

  it('reads the Scholar’s Pack exactly as printed', () => {
    const pack = gearNamed("Scholar's Pack");
    expect(pack?.contents).toEqual([
      { gearId: 'backpack', printed: 'Backpack', quantity: 1 },
      { gearId: 'book', printed: 'Book', quantity: 1 },
      { gearId: 'ink', printed: 'Ink', quantity: 1 },
      { gearId: 'ink-pen', printed: 'Ink Pen', quantity: 1 },
      { gearId: 'lamp', printed: 'Lamp', quantity: 1 },
      { gearId: 'oil', printed: '10 flasks of Oil', quantity: 10 },
      { gearId: 'parchment', printed: '10 sheets of Parchment', quantity: 10 },
      { gearId: 'tinderbox', printed: 'Tinderbox', quantity: 1 },
    ]);
  });

  it('counts a bare plural', () => {
    const burglar = gearNamed("Burglar's Pack");
    expect(burglar?.contents).toContainEqual({
      gearId: 'candle',
      printed: '10 Candles',
      quantity: 10,
    });
  });

  it('un-inverts a table name the sentence writes the natural way', () => {
    // The table says "Lantern, Hooded"; the sentence says "Hooded Lantern".
    expect(gearNamed("Burglar's Pack")?.contents).toContainEqual({
      gearId: 'lantern-hooded',
      printed: 'Hooded Lantern',
      quantity: 1,
    });
    // And the plural inverted case, which is both habits at once.
    expect(gearNamed("Diplomat's Pack")?.contents).toContainEqual({
      gearId: 'case-map-or-scroll',
      printed: '2 Map or Scroll Cases',
      quantity: 2,
    });
  });

  it('leaves everything that is not a pack with no contents', () => {
    for (const item of parsed.gear.filter((g) => !g.name.endsWith('Pack'))) {
      expect(item.contents).toEqual([]);
    }
  });

  /** A pack that lost an item would be a quiet theft, so it is a parse problem. */
  it('reports a phrase it cannot resolve rather than dropping it', () => {
    const contents = parsePackContents(
      'A Test Pack contains the following items: Backpack, 3 Widgets, and Rope.',
      (name) => (name === 'Backpack' || name === 'Rope' ? `slug-${name.toLowerCase()}` : null),
    );
    expect(contents.unresolved).toEqual(['3 Widgets']);
    expect(contents.lines.map((l) => l.gearId)).toEqual(['slug-backpack', 'slug-rope']);
  });

  it('reads nothing from prose that is not a contents sentence', () => {
    const contents = parsePackContents('A sturdy Backpack holds 30 pounds.', () => 'x');
    expect(contents.lines).toEqual([]);
    expect(contents.unresolved).toEqual([]);
  });
});
