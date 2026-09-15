import { describe, expect, it } from 'vitest';
import {
  ITEM_BLOCKED_ON,
  ITEM_SHAPES,
  MISSING_SHAPES,
  allItemShapeConsumers,
  claimedItemShapes,
  isItemRead,
  itemBlockersIn,
  itemBlockersOf,
  itemClausesIn,
  itemConsumersOf,
  itemCoverageGaps,
  itemPileOf,
  itemPiles,
  itemPrintedUnitsOf,
  itemSentenceGaps,
  parsedItemIds,
  transcribedItemIds,
  unanchoredItemClauses,
  type ItemEntry,
} from '../scripts/missing-shapes.js';

/**
 * The untranscribed items' blockers, asserted the way the undefined spells' are.
 *
 * `blocked-on.test.ts` exists because one family of spells was counted by hand
 * three times and came out 17, 4 and 2. The items were never counted at all:
 * 42 of 258 entries have a record, `packages/content/src/items.ts` states the
 * three rules that **decide** an omission, and the decision itself lived only
 * in the absence of a record — so "how many are blocked by a missing shape and
 * how many are simply not yet written" had no answer but somebody's
 * impression. This is that answer, derived.
 *
 * **The pile these guards are strictest about is `ready`**, because it is the
 * one a brief transcribes from. A false positive there costs a builder an
 * afternoon and a false negative costs the catalogue an item, so every guard
 * below drives the classifier with a synthetic entry built to be sorted wrongly
 * and asserts it is not.
 */

const PARSED = parsedItemIds();
const TRANSCRIBED = transcribedItemIds();

/** A real entry to hang synthetic readings on, chosen for a short, table-free paragraph. */
const SPECIMEN = 'goggles-of-night';

describe('the item blocked-on map covers the untranscribed population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * Parameterised over both lists for `coverageGaps`'s own reason: a guard that
   * can only be run against the data it already agrees with is not a guard.
   */
  it('reports an entry added to the book with neither a record nor a line', () => {
    const synthetic = [...PARSED, 'wand-of-nothing-in-particular'];
    expect(itemCoverageGaps(synthetic, TRANSCRIBED).unrecorded).toEqual([
      'wand-of-nothing-in-particular',
    ]);
  });

  /** And the other direction: a line for an entry somebody has since transcribed. */
  it('reports a line for an entry that has since been transcribed', () => {
    // The case the next brief will really cause: it transcribes from the ready
    // list, and the line it leaves behind has to go with the record it wrote.
    const transcribed = new Set([...TRANSCRIBED, 'elixir-of-health']);
    expect(itemCoverageGaps(PARSED, transcribed).stale).toEqual(['elixir-of-health']);
  });

  /** Neither synthetic case is vacuous: the real book has no gap either way. */
  it('has a line for every untranscribed entry and no line for anything else', () => {
    expect(itemCoverageGaps(PARSED, TRANSCRIBED)).toEqual({ unrecorded: [], stale: [] });
  });

  /** Every parsed entry is accounted for exactly once. */
  it('sorts every entry of the book into exactly one pile', () => {
    const piles = itemPiles(PARSED, TRANSCRIBED);
    const all = Object.values(piles).flat();
    expect(all.length).toBe(PARSED.length);
    expect([...all].sort()).toEqual([...PARSED].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  /**
   * And the population has not silently emptied.
   *
   * **A floor has to sit below the population, not on it.** `blocked-on.test.ts`
   * records what happens otherwise: it read `> 200` against a map of exactly
   * 201, so the next task to define two spells failed a guard by succeeding,
   * and the only answers available were to lower the number or to leave two
   * built spells recorded as undefined. The very next task here transcribes
   * items off the ready list below, so this is deliberately generous: what it
   * catches is a wrong directory, a filter that reads nothing, or a map that
   * has quietly stopped being populated. The real counts are `COVERAGE.md`'s.
   */
  it('covers a population worth deriving', () => {
    expect(Object.keys(ITEM_BLOCKED_ON).length).toBeGreaterThan(150);
  });

  /** In an order two branches can both append to, and the order is the data's. */
  it('names its entries in an order two branches can both append to', () => {
    const ids = Object.keys(ITEM_BLOCKED_ON);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('an entry nobody could place is unread, never ready', () => {
  /**
   * The rule the whole map turns on, driven in the direction it must not fail.
   *
   * An entry naming no blocker looks exactly like an entry blocked by nothing,
   * and the difference is whether somebody read it. So the classifier is given
   * an empty line — the shape a careless hand would write — and must answer
   * `unread`.
   */
  it('does not call an entry with no line and no reading ready', () => {
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: [] })).toBe('unread');
    expect(itemPileOf(SPECIMEN, new Set(), {})).toBe('unread');
  });

  /** An entry that says it is unread stays unread however short its paragraph. */
  it('keeps an entry that says nobody could place it out of both piles', () => {
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: { unread: 'nobody has read it' } })).toBe(
      'unread',
    );
  });

  /**
   * A reading that leaves a marker sentence unanswered is not a reading.
   *
   * The synthetic answers one of the specimen's two sentences and claims the
   * benefit is expressible. That is the shape of the mistake this exists to
   * catch — a paragraph half read, the second sentence carrying the blocker —
   * and the classifier must refuse to call it ready.
   */
  it('does not call a half-read entry ready', () => {
    const half: ItemEntry = [
      { clause: 'you have Darkvision out to 60 feet', why: 'expressible', note: 'synthetic' },
    ];
    expect(itemSentenceGaps(SPECIMEN, half).map((gap) => gap.sentence)).toEqual([
      'If you already have Darkvision, wearing the goggles increases its range by 60 feet.',
    ]);
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: half })).toBe('unread');
  });

  /** Read all the way through, with something to write down, it is ready. */
  it('calls a fully read entry with an expressible clause ready', () => {
    const whole: ItemEntry = [
      { clause: 'you have Darkvision out to 60 feet', why: 'expressible', note: 'synthetic' },
      { clause: 'increases its range by 60 feet', why: 'table', note: 'synthetic' },
    ];
    expect(itemSentenceGaps(SPECIMEN, whole)).toEqual([]);
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: whole })).toBe('ready');
  });

  /**
   * And read all the way through with **nothing** to write down is its own pile.
   *
   * `packages/content/src/items.ts` rule 1: a record carrying nothing but notes
   * "would be an item that arrives in a pack, grants nothing and looks
   * transcribed". So an entry whose every clause is the table's is not waiting
   * on the engine and is not a record either, and putting it on the ready list
   * would send a builder to write a record with no grants in it.
   */
  it('calls a fully read entry with nothing to record fiction, not ready', () => {
    const fiction: ItemEntry = [
      { clause: 'you have Darkvision out to 60 feet', why: 'table', note: 'synthetic' },
      { clause: 'increases its range by 60 feet', why: 'table', note: 'synthetic' },
    ];
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: fiction })).toBe('fiction');
  });

  /** A named shape wins over everything: it is blocked, read or not. */
  it('calls an entry naming a shape blocked', () => {
    expect(itemPileOf(SPECIMEN, new Set(), { [SPECIMEN]: ['a-speed-an-item-grants'] })).toBe(
      'blocked',
    );
  });

  /** The real map's honest default is used rather than merely available. */
  it('has entries that say in their own words why nobody could place them', () => {
    const { unread } = itemPiles(PARSED, TRANSCRIBED);
    expect(unread.length).toBeGreaterThan(0);
    for (const id of unread) {
      const entry = ITEM_BLOCKED_ON[id];
      expect(entry, id).toBeDefined();
      expect(Array.isArray(entry), `${id} is unread by omission rather than by saying so`).toBe(
        false,
      );
      expect((entry as { unread: string }).unread.length, id).toBeGreaterThan(80);
    }
  });
});

describe('a clause names one thing the entry prints', () => {
  /** The anchoring guard, driven by a phrase the entry says twice. */
  it('reports a phrase the entry prints more than once', () => {
    const twice = unanchoredItemClauses('potion-of-longevity', [
      { clause: '1d6 + 6 years', why: 'table', note: 'synthetic' },
    ]);
    expect(twice).toEqual([
      { spell: 'potion-of-longevity', clause: '1d6 + 6 years', matches: 2 },
    ]);
  });

  /** And by one it prints nowhere, which is a reworded or invented sentence. */
  it('reports a phrase the entry prints nowhere', () => {
    expect(
      unanchoredItemClauses(SPECIMEN, [
        { clause: 'you have Truesight out to 60 feet', why: 'table', note: 'synthetic' },
      ]),
    ).toEqual([{ spell: SPECIMEN, clause: 'you have Truesight out to 60 feet', matches: 0 }]);
  });

  /** Neither case is vacuous: every clause in the real map anchors. */
  it('anchors every clause in the map', () => {
    for (const [entryId, entry] of Object.entries(ITEM_BLOCKED_ON)) {
      if (itemClausesIn(entry).length === 0) continue;
      expect(unanchoredItemClauses(entryId, entry), entryId).toEqual([]);
    }
  });

  /** A clause may also anchor to a field the book prints above the paragraph. */
  it('lets a clause anchor to the printed type line', () => {
    expect(itemPrintedUnitsOf('cloak-of-invisibility')[0]).toContain('Rarity:');
    expect(itemPrintedUnitsOf('cloak-of-invisibility')).toContain('Charges: 3');
  });

  /** And every read entry answers every sentence that names a mechanic. */
  it('has no sentence gap in any entry that names a clause', () => {
    for (const [entryId, entry] of Object.entries(ITEM_BLOCKED_ON)) {
      if (itemClausesIn(entry).length === 0) continue;
      expect(itemSentenceGaps(entryId, entry), entryId).toEqual([]);
      expect(isItemRead(entryId, entry), entryId).toBe(true);
    }
  });

  /** A clause that is neither the table's nor expressible names an enumerated shape. */
  it('names an enumerated shape for every clause that is neither', () => {
    const known = new Set<string>([...Object.keys(MISSING_SHAPES), ...Object.keys(ITEM_SHAPES)]);
    for (const [entryId, entry] of Object.entries(ITEM_BLOCKED_ON)) {
      for (const clause of itemClausesIn(entry)) {
        if (clause.why === 'table' || clause.why === 'expressible') continue;
        expect(known.has(clause.why), `${entryId} names ${clause.why}`).toBe(true);
      }
      expect(
        itemBlockersIn(entry).filter((shape) => !known.has(shape)),
        entryId,
      ).toEqual([]);
    }
  });
});

describe('a shape nobody consumes reports itself', () => {
  /**
   * The unclaimed-shape guard, asked of the item vocabulary alone.
   *
   * Asked of both vocabularies together it would pass on a spell's claim, which
   * is how a shape stays in a map after the last entry needing it has moved.
   * The spell vocabulary keeps its own guard in `blocked-on.test.ts`, over its
   * own three populations, and an item claiming a spell shape does not satisfy
   * it — so neither list can quietly keep a dead id alive through the other.
   */
  it('keeps no item shape nothing is blocked on', () => {
    const claimed = claimedItemShapes();
    expect(Object.keys(ITEM_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape neither vocabulary has. */
  it('has a vocabulary that covers every item claim', () => {
    const known = new Set<string>([...Object.keys(MISSING_SHAPES), ...Object.keys(ITEM_SHAPES)]);
    expect([...claimedItemShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });

  /**
   * The reuse is real rather than claimed: items are blocked on spell shapes.
   *
   * The instruction the item vocabulary was written under was to reuse the
   * spell one wherever it already fits, and a vocabulary that quietly did not
   * would look exactly like one that did. So the query is asked: a Belt of
   * Giant Strength is blocked on the same missing reader SRD Feeblemind is.
   */
  it('files an item under a spell shape where the gap is the same one', () => {
    expect(itemBlockersOf('belt-of-giant-strength')).toContain('an-ability-score-a-spell-changes');
    expect(itemConsumersOf('an-ability-score-a-spell-changes').blocks.length).toBeGreaterThan(1);
    const spellShapes = new Set<string>(Object.keys(MISSING_SHAPES));
    expect([...claimedItemShapes()].filter((shape) => spellShapes.has(shape)).length).toBeGreaterThan(
      5,
    );
  });
});

describe('what a shape finishes is two numbers here too', () => {
  it('partitions the entries a shape finishes, losing none', () => {
    for (const row of allItemShapeConsumers()) {
      expect([...row.finishesRead, ...row.finishesUnread].sort(), row.shape).toEqual([
        ...row.finishes,
      ].sort());
      expect(row.finishesRead.filter((id) => row.finishesUnread.includes(id))).toEqual([]);
    }
  });

  it('never claims to finish an entry it does not block', () => {
    for (const row of allItemShapeConsumers()) {
      for (const id of row.finishes) {
        expect(row.blocks, row.shape).toContain(id);
        expect(itemBlockersOf(id), id).toEqual([row.shape]);
      }
    }
  });

  /** Has some of each, so the report's two columns say something. */
  it('has read entries and grandfathered ones', () => {
    const rows = allItemShapeConsumers();
    expect(rows.some((row) => row.finishesRead.length > 0)).toBe(true);
    expect(rows.some((row) => row.finishesUnread.length > 0)).toBe(true);
  });

  /**
   * The finding, and it is not an item mechanism.
   *
   * The largest blocker in the book's magic items is a **spell** the catalogue
   * cannot execute. A wand tranche planned from a shape-level impression would
   * have bought wands and found the spells underneath them missing, which is
   * the failure the spell map was written to end, arriving on the other
   * population.
   */
  it('names the largest blocker, and it is a missing spell rather than a missing item rule', () => {
    const heaviest = [...allItemShapeConsumers()].sort(
      (a, b) => b.blocks.length - a.blocks.length,
    )[0];
    expect(heaviest?.shape).toBe('a-spell-an-item-casts-that-nothing-executes');
    expect(heaviest?.finishes.length).toBeGreaterThan(
      allItemShapeConsumers().filter(
        (row) => row.shape !== 'a-spell-an-item-casts-that-nothing-executes',
      )[0]?.finishes.length ?? 0,
    );
  });
});

/**
 * The entries a brief may transcribe from, pinned by name rather than by size.
 *
 * `BLOCKED_ON` pins its "blocked on nothing" set the same way and says why: a
 * count in a docstring is the claim these maps replace, and the set is small
 * enough to write out and interesting enough to read. Pinning it by name also
 * means the brief that transcribes one has to come here and delete it, which is
 * the same three-part move a spell makes when it leaves that map — the line
 * goes, the record arrives, and any shape that was the entry's alone is
 * claimed by somebody else or retired.
 */
describe('the entries blocked by nothing', () => {
  it('are these, read sentence by sentence and waiting on nobody', () => {
    expect(itemPiles(PARSED, TRANSCRIBED).ready).toEqual([
      'elixir-of-health',
      'potion-of-invulnerability',
    ]);
  });

  it('each name a clause the grant vocabulary can actually write down', () => {
    for (const id of itemPiles(PARSED, TRANSCRIBED).ready) {
      const entry = ITEM_BLOCKED_ON[id] ?? [];
      expect(itemBlockersIn(entry), id).toEqual([]);
      expect(
        itemClausesIn(entry).filter((clause) => clause.why === 'expressible').length,
        id,
      ).toBeGreaterThan(0);
    }
  });

  /** And the fiction pile is kept apart from them, which is rule 1's whole point. */
  it('do not include an entry whose every clause is the table’s', () => {
    const piles = itemPiles(PARSED, TRANSCRIBED);
    expect(piles.fiction.length).toBeGreaterThan(0);
    for (const id of piles.fiction) {
      expect(piles.ready, id).not.toContain(id);
      expect(
        itemClausesIn(ITEM_BLOCKED_ON[id] ?? []).every((clause) => clause.why === 'table'),
        id,
      ).toBe(true);
    }
  });
});
