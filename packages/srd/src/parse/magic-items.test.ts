import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMagicItems, parseMagicItemTypeLine } from './magic-items.js';
import { MagicItemSchema } from '../schemas.js';

const markdown = readFileSync(
  fileURLToPath(new URL('../../raw/magic-items.md', import.meta.url)),
  'utf8',
);
const parsed = parseMagicItems(markdown, 'magic-items.md');

const named = (name: string) => parsed.items.find((i) => i.name === name);
/** Every `#### ` heading in the file, item or not. */
const HEADINGS = markdown.split(/\r?\n/).filter((l) => l.startsWith('#### ')).length;

describe('parseMagicItems: the boundary between an entry and a rules section', () => {
  // `grep -c '^#### ' raw/magic-items.md` returns 264 and that is NOT the
  // number of magic items. Six of those headings are not entries:
  //
  //   Four are rules subsections printed before "Magic Items A-Z" —
  //   "Spells Cast from Items" and "Charges" under "Activating a Magic Item",
  //   "Spells" under "Crafting Magic Items", and "Conflict" under
  //   "Special Purpose".
  //
  //   Two are creature stat blocks printed *inside* an entry: "Giant Fly"
  //   sits in the middle of Figurine of Wondrous Power (the Ebony Fly becomes
  //   one) and "Avatar of Death" in the middle of Mysterious Deck.
  //
  // 264 - 6 = 258. Asserting only "no problems" would pass on a parser that
  // reads nothing, and asserting only the count would pass on a parser that
  // swallowed a rules section and dropped a real entry. So both directions are
  // pinned here: the total, and the exact list of what was not an entry.
  it('parses 258 items out of 264 headings', () => {
    expect(HEADINGS).toBe(264);
    expect(parsed.items).toHaveLength(258);
    expect(parsed.items.length + parsed.skipped.length).toBe(HEADINGS);
  });

  it('names every heading it declined to read as an item', () => {
    expect([...parsed.skipped].sort()).toEqual([
      'Avatar of Death',
      'Charges',
      'Conflict',
      'Giant Fly',
      'Spells',
      'Spells Cast from Items',
    ]);
  });

  it('keeps the first and last entries of the A-Z list', () => {
    expect(parsed.items[0]?.name).toBe('Adamantine Armor');
    expect(parsed.items.at(-1)?.name).toBe('Wings of Flying');
  });

  // The stat block interrupts the entry's prose. Splitting on `####` and
  // stopping there would silently truncate Figurine of Wondrous Power at the
  // Ebony Fly, the second of its nine figurines, and lose the seven printed
  // after it — so a heading that is not an entry is folded back into the
  // entry it interrupts.
  it('does not let an interrupting stat block truncate its entry', () => {
    const figurine = named('Figurine of Wondrous Power');
    expect(figurine?.description).toContain('**Ebony Fly (Rare).**');
    expect(figurine?.description).toContain('#### Giant Fly');
    expect(figurine?.description).toContain('**Silver Raven (Uncommon).**');

    const deck = named('Mysterious Deck');
    expect(deck?.description).toContain('#### Avatar of Death');
    expect(deck?.description).toContain('_Void._');
  });

  it('reports a problem rather than throwing when the A-Z heading is gone', () => {
    const output = parseMagicItems('#### Adamantine Armor\n\n_Armor (Plate Armor), Uncommon_\n\nprose.\n', 'fake.md');
    expect(output.items).toHaveLength(0);
    expect(output.problems).toHaveLength(1);
    expect(output.problems[0]?.message).toMatch(/Magic Items A/);
  });
});

// Three refusals the real file never triggers. Untested they would be three
// branches nobody has watched work, and the first re-vendor that needed one
// would be the first time anyone found out.
describe('parseMagicItems: refusals are values, not exceptions', () => {
  const page = (body: string) => `## Magic Items A–Z\n\n${body}`;

  it('reports an entry the schema rejects instead of throwing', () => {
    // A heading with a readable type line and no prose at all: `description`
    // fails `min(1)`.
    const output = parseMagicItems(page('#### Hollow Ring\n\n_Ring, Rare_\n'), 'fake.md');
    expect(output.items).toHaveLength(0);
    expect(output.problems).toEqual([
      { source: 'fake.md', entry: 'Hollow Ring', message: expect.stringContaining('description') },
    ]);
  });

  it('reports two entries that slugify to one id', () => {
    const output = parseMagicItems(
      page(
        '#### Ring of X-ray Vision\n\n_Ring, Rare_\n\nprose.\n\n' +
          '#### Ring of X Ray Vision\n\n_Ring, Rare_\n\nother prose.\n',
      ),
      'fake.md',
    );
    expect(output.items).toHaveLength(2);
    expect(output.problems).toEqual([
      {
        source: 'fake.md',
        entry: 'Ring of X Ray Vision',
        message: 'duplicate id "ring-of-x-ray-vision"',
      },
    ]);
  });

  it('skips a heading whose type line it cannot read rather than guessing', () => {
    const output = parseMagicItems(page('#### Ring of Mystery\n\n_Ring, Mythic_\n\nprose.\n'), 'fake.md');
    expect(output.items).toHaveLength(0);
    expect(output.problems).toEqual([]);
    expect(output.skipped).toEqual(['Ring of Mystery']);
  });
});

describe('parseMagicItems: every record is valid and nothing is thrown', () => {
  it('reports no problems', () => {
    expect(parsed.problems).toEqual([]);
  });

  it('satisfies the schema for every item', () => {
    for (const item of parsed.items) {
      const validated = MagicItemSchema.safeParse(item);
      expect(validated.success, `${item.name}: ${validated.error?.message ?? ''}`).toBe(true);
    }
  });

  it('gives every item a distinct id', () => {
    expect(new Set(parsed.items.map((i) => i.id)).size).toBe(parsed.items.length);
  });
});

// Per-section counts, not just the total: a category that stopped matching
// would leave the total right and file every one of its items elsewhere.
describe('parseMagicItems: categories', () => {
  it('files every item under one of the book’s nine categories', () => {
    const counts: Record<string, number> = {};
    for (const item of parsed.items) counts[item.category] = (counts[item.category] ?? 0) + 1;
    expect(counts).toEqual({
      Armor: 19,
      Potions: 24,
      Rings: 22,
      Rods: 7,
      Scrolls: 1,
      Staffs: 12,
      Wands: 13,
      Weapons: 33,
      'Wondrous Items': 127,
    });
  });
});

describe('parseMagicItems: one spot check per category, against the printed page', () => {
  // _Armor (Any Medium or Heavy, Except Hide Armor), Uncommon_
  it('Adamantine Armor', () => {
    expect(named('Adamantine Armor')).toMatchObject({
      id: 'adamantine-armor',
      category: 'Armor',
      subtype: 'Any Medium or Heavy, Except Hide Armor',
      rarity: { text: 'Uncommon', varies: false, options: [{ rarity: 'Uncommon', qualifier: null }] },
      requiresAttunement: false,
      attunementPrerequisite: null,
      charges: null,
    });
    expect(named('Adamantine Armor')?.description).toContain(
      'any Critical Hit against you becomes a normal hit',
    );
  });

  // _Potion, Common_
  it('Potion of Climbing', () => {
    expect(named('Potion of Climbing')).toMatchObject({
      category: 'Potions',
      subtype: null,
      rarity: { text: 'Common', varies: false, options: [{ rarity: 'Common', qualifier: null }] },
      requiresAttunement: false,
    });
    expect(named('Potion of Climbing')?.description).toContain(
      'you gain a Climb Speed equal to your Speed for 1 hour',
    );
  });

  // _Ring, Legendary (Requires Attunement)_ — attunement with no prerequisite.
  it('Ring of Invisibility', () => {
    expect(named('Ring of Invisibility')).toMatchObject({
      category: 'Rings',
      subtype: null,
      rarity: { text: 'Legendary', varies: false, options: [{ rarity: 'Legendary', qualifier: null }] },
      requiresAttunement: true,
      attunementPrerequisite: null,
    });
  });

  // _Rod, Uncommon_
  it('Immovable Rod', () => {
    expect(named('Immovable Rod')).toMatchObject({
      category: 'Rods',
      rarity: { text: 'Uncommon', varies: false },
      requiresAttunement: false,
    });
    expect(named('Immovable Rod')?.description).toContain('The rod can hold up to 8,000 pounds');
  });

  // _Scroll, Rarity Varies_ — the only entry in the Scrolls category, and the
  // one the gear parser's craft-list test names as unresolvable until this
  // file is parsed.
  it('Spell Scroll', () => {
    expect(named('Spell Scroll')).toMatchObject({
      id: 'spell-scroll',
      category: 'Scrolls',
      subtype: null,
      rarity: { text: 'Rarity Varies', varies: true, options: [] },
      requiresAttunement: false,
    });
  });

  // _Staff, Rare (Requires Attunement by a Druid)_ — attunement carrying a
  // printed prerequisite.
  it('Staff of the Woodlands', () => {
    expect(named('Staff of the Woodlands')).toMatchObject({
      category: 'Staffs',
      rarity: { text: 'Rare', varies: false, options: [{ rarity: 'Rare', qualifier: null }] },
      requiresAttunement: true,
      attunementPrerequisite: 'by a Druid',
      charges: { maximum: 6, formula: null },
    });
  });

  // _Wand, Rare (Requires Attunement by a Spellcaster)_
  it('Wand of Fireballs', () => {
    expect(named('Wand of Fireballs')).toMatchObject({
      category: 'Wands',
      requiresAttunement: true,
      attunementPrerequisite: 'by a Spellcaster',
      charges: { maximum: 7, formula: null },
    });
  });

  // _Weapon (Longsword), Rare (Requires Attunement)_
  it('Sun Blade', () => {
    expect(named('Sun Blade')).toMatchObject({
      category: 'Weapons',
      subtype: 'Longsword',
      rarity: { text: 'Rare', varies: false },
      requiresAttunement: true,
      attunementPrerequisite: null,
      charges: null,
    });
    expect(named('Sun Blade')?.description).toContain('This item appears to be a sword hilt.');
  });

  // _Wondrous Item, Uncommon_ — no attunement, and (2024) no qualifier on the
  // Stealth advantage; see docs/rules/srd-policy.md.
  it('Boots of Elvenkind', () => {
    expect(named('Boots of Elvenkind')).toMatchObject({
      category: 'Wondrous Items',
      subtype: null,
      rarity: { text: 'Uncommon', varies: false },
      requiresAttunement: false,
    });
    expect(named('Boots of Elvenkind')?.description).toContain(
      'You also have Advantage on Dexterity (Stealth) checks.',
    );
  });
});

describe('parseMagicItems: the awkward entries', () => {
  // The page prints ONE heading, ONE type line and ONE description covering
  // all three bonuses — "The bonus is determined by the rarity of the
  // ammunition." So this is one item with three rarity options, not three
  // items. The same is true of Armor, Shield, Weapon and Wand of the War
  // Mage. Splitting them into three would invent five entries the book does
  // not print and would have to invent their names too.
  it('Ammunition, +1, +2, or +3 is one entry with three rarities', () => {
    expect(parsed.items.filter((i) => i.name.startsWith('Ammunition'))).toHaveLength(2);
    expect(named('Ammunition, +1, +2, or +3')).toMatchObject({
      id: 'ammunition-1-2-or-3',
      category: 'Weapons',
      subtype: 'Any Ammunition',
      rarity: {
        text: 'Uncommon (+1), Rare (+2), or Very Rare (+3)',
        varies: false,
        options: [
          { rarity: 'Uncommon', qualifier: '+1' },
          { rarity: 'Rare', qualifier: '+2' },
          { rarity: 'Very Rare', qualifier: '+3' },
        ],
      },
      requiresAttunement: false,
    });
  });

  // The rarity clause and the attunement clause are both parenthesised, and
  // this is the only entry that prints both on one line.
  it('Wand of the War Mage keeps its three rarities and its prerequisite apart', () => {
    expect(named('Wand of the War Mage, +1, +2, or +3')).toMatchObject({
      rarity: {
        text: 'Uncommon (+1), Rare (+2), or Very Rare (+3)',
        varies: false,
        options: [
          { rarity: 'Uncommon', qualifier: '+1' },
          { rarity: 'Rare', qualifier: '+2' },
          { rarity: 'Very Rare', qualifier: '+3' },
        ],
      },
      requiresAttunement: true,
      attunementPrerequisite: 'by a Spellcaster',
    });
  });

  // A qualifier is not always a plus-bonus: the Horn's is the metal it is
  // made of.
  it('Horn of Valhalla qualifies its rarities by metal', () => {
    expect(named('Horn of Valhalla')?.rarity).toEqual({
      text: 'Rare (Silver or Brass), Very Rare (Bronze), or Legendary (Iron)',
      varies: false,
      options: [
        { rarity: 'Rare', qualifier: 'Silver or Brass' },
        { rarity: 'Very Rare', qualifier: 'Bronze' },
        { rarity: 'Legendary', qualifier: 'Iron' },
      ],
    });
  });

  // The prerequisite is prose, not a class list, and is kept as printed.
  it('Dwarven Thrower keeps a prerequisite that is not a class', () => {
    expect(named('Dwarven Thrower')?.attunementPrerequisite).toBe(
      'by a Dwarf or a Creature Attuned to a Belt of Dwarvenkind',
    );
    expect(named('Necklace of Prayer Beads')?.attunementPrerequisite).toBe(
      'by a Cleric, Druid, or Paladin',
    );
  });

  // "Rarity Varies" and a list of rarities are opposite states, not the same
  // absence — the same lesson as the gear table's `—` versus `Varies`.
  it('keeps "Rarity Varies" apart from a named rarity', () => {
    const varies = parsed.items.filter((i) => i.rarity.varies).map((i) => i.name);
    expect(varies.sort()).toEqual([
      'Belt of Giant Strength',
      'Feather Token',
      'Figurine of Wondrous Power',
      'Ioun Stone',
      'Potion of Giant Strength',
      'Potions of Healing',
      'Spell Scroll',
    ]);
    for (const item of parsed.items) {
      expect(item.rarity.varies).toBe(item.rarity.options.length === 0);
    }
  });

  it('Dragon Orb is an Artifact', () => {
    expect(named('Dragon Orb')?.rarity.options).toEqual([{ rarity: 'Artifact', qualifier: null }]);
  });
});

describe('parseMagicItems: charges', () => {
  it('reads the 50 entries that print a charge maximum', () => {
    expect(parsed.items.filter((i) => i.charges !== null)).toHaveLength(50);
  });

  it.each([
    ['Wand of Fireballs', 7, null], // "This wand has 7 charges."
    ['Staff of the Magi', 50, null], // "This staff has 50 charges and can be wielded..."
    ['Cube of Force', 10, null], // "The cube starts with 10 charges"
    ['Ring of Three Wishes', 3, null], // "expend 1 of its 3 charges"
    ['Winged Boots', 4, null], // "These boots have 4 charges"
    ['Nine Lives Stealer', null, '1d8 + 1'], // "The weapon has 1d8 + 1 charges."
    ['Luck Blade', null, '1d3'], // "The weapon has 1d3 charges."
  ])('%s', (name, maximum, formula) => {
    expect(named(name)?.charges).toEqual({ maximum, formula });
  });

  // Both directions again. Every entry whose prose contains the word "charge"
  // but which carries no maximum is named here, so a phrasing this parser
  // cannot read shows up as a new name rather than as a silent null.
  //
  // The six books say their words "are charged with magic" — not a charge at
  // all. The Figurine's 24 charges belong to one of its nine figurines, the
  // Goat of Traveling, and not to the item, so the parser does not hand them
  // to the item; the book prints no maximum for a Figurine of Wondrous Power.
  it('names every entry that says "charge" and has no maximum', () => {
    const silent = parsed.items
      .filter((i) => i.charges === null && /charge/i.test(i.description))
      .map((i) => i.name);
    expect(silent.sort()).toEqual([
      'Figurine of Wondrous Power',
      'Manual of Bodily Health',
      'Manual of Gainful Exercise',
      'Manual of Quickness of Action',
      'Tome of Clear Thought',
      'Tome of Leadership and Influence',
      'Tome of Understanding',
    ]);
  });
});

describe('parseMagicItemTypeLine', () => {
  it('refuses a creature type line', () => {
    expect(parseMagicItemTypeLine('_Large Beast, Unaligned_')).toBeNull();
    expect(parseMagicItemTypeLine('_Medium Undead, Neutral Evil_')).toBeNull();
  });

  it('refuses a line that is not italicised', () => {
    expect(parseMagicItemTypeLine('Wondrous Item, Rare')).toBeNull();
  });

  it('refuses a rarity it does not know rather than defaulting', () => {
    expect(parseMagicItemTypeLine('_Ring, Mythic_')).toBeNull();
  });

  it('refuses an attunement clause it cannot read rather than dropping it', () => {
    expect(parseMagicItemTypeLine('_Ring, Rare (Requires Attunement by a (Cleric))_')).toBeNull();
  });

  it('reads a bare category and rarity', () => {
    expect(parseMagicItemTypeLine('_Wondrous Item, Rare_')).toEqual({
      category: 'Wondrous Items',
      subtype: null,
      rarity: { text: 'Rare', varies: false, options: [{ rarity: 'Rare', qualifier: null }] },
      requiresAttunement: false,
      attunementPrerequisite: null,
    });
  });
});
