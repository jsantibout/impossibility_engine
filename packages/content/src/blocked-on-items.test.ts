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

/**
 * A real entry to hang synthetic readings on, chosen for a short, table-free
 * paragraph.
 *
 * It is a **transcribed** entry now — the sense reader landed and the goggles
 * went into the catalogue — and that changes nothing here: every guard below
 * passes the classifier an explicit transcribed set and an explicit map, so
 * the specimen is being used for its two sentences rather than for its pile.
 * Reaching for the real `TRANSCRIBED` with it would answer `transcribed`
 * before any of the readings were looked at, which is why none of them does.
 */
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
   * The finding, **and what happened when it was acted on — twice**.
   *
   * The largest blocker in the book's magic items was a **spell** the
   * catalogue could not execute: a wand tranche planned from a shape-level
   * impression would have bought wands and found the spells underneath them
   * missing, which is the failure the spell map was written to end arriving on
   * the other population. That finding was briefed from, the definitions were
   * written, and the entries the shape was the *only* blocker for came off it.
   * The id that replaced it at the top — an item copy with a state of its own
   * — was then built, and a second reading took two thirds of *its* entries
   * away. So the heaviest blocker is an item mechanism now, which is what the
   * reading was for.
   *
   * **All three halves are asserted, because each is what one reading bought
   * and the next one cost.** A map that kept claiming the spells were the
   * heaviest problem after they had been written would be the prose these maps
   * replaced; one that kept claiming the identity was, after it shipped, would
   * be the same mistake one landing later.
   */
  it('has spent the three largest blockers it found, and names the one that is heaviest now', () => {
    const ranked = [...allItemShapeConsumers()].sort((a, b) => b.blocks.length - a.blocks.length);
    // **The third finding, and the only one that cost nothing to act on.**
    // The id that replaced the identity at the top was `a-condition-an-item-
    // imposes`, and it was never built: it was *re-read*, entry by entry,
    // against what `content.ts` had come to admit. Eighteen of its
    // twenty-eight entries named it for a condition the vocabulary could
    // already write down, and the blocker underneath them turned out to be a
    // distance. So what sits at the top now is a shape no engine work can
    // reach — the version of an item the book leaves to the GM — which is
    // itself the finding: the heaviest thing between this catalogue and the
    // book is not a missing mechanism.
    expect(ranked[0]?.shape).toBe('a-version-of-an-item-the-book-leaves-to-the-gm');

    // **The spell shape was read entry by entry after the definitions
    // landed**, not trusted: thirteen entries named it with every spell they
    // print already defined. What it finishes now is four, and each is the
    // *second* half of the shape rather than the first — a potion or an oil
    // that **confers** rather than casts, waiting on a definition that exists
    // and resolves nothing, plus the one ring whose spell nothing defines at
    // all. No amount of transcription reaches the first three, because an item
    // that confers an empty list confers nothing.
    const spells = itemConsumersOf('a-spell-an-item-casts-that-nothing-executes');
    expect(spells.finishes).toEqual([
      'oil-of-etherealness',
      'potion-of-clairvoyance',
      'potion-of-mind-reading',
      'ring-of-three-wishes',
    ]);

    // **And the identity is spent too.** What is left under it is never a
    // count — a copy's charges are a pool keyed to the copy now — so every
    // entry still naming it says which other fact it keeps, and the two it
    // finishes are the two whose whole rule is one of those.
    const copies = itemConsumersOf('an-item-instance-with-a-state-of-its-own');
    expect(copies.blocks.length).toBeLessThan(spells.blocks.length);
    expect(copies.finishes).toEqual(['ammunition-1-2-or-3', 'oil-of-sharpness']);

    // And the ranking is still worth reading: the top row really does finish
    // entries, which is the column a tranche is planned from.
    expect(ranked[0]?.finishes.length).toBeGreaterThan(0);
  });
});

/**
 * **What the re-derivation of the two heaviest item shapes actually found**,
 * pinned by name so the next reading has something to disagree with.
 *
 * The table said `a-condition-an-item-imposes` blocked twenty-eight entries
 * and finished none of them, and a tranche sized off that row would have
 * built a mechanism that was already there: a conferral has hung a condition
 * outright since the Potion of Invisibility, a saving throw has imposed one
 * since the weld was cut, and a span the item **rolls** has been a field since
 * the Potion of Diminution. What the shape's own description called its
 * residue — "a condition whose duration the item rolls for, which no conferral
 * can state" — was untrue when it was written.
 *
 * So the entries were read one at a time against the SRD paragraph and against
 * what `checkContent` admits, and three quarters of them named a shape they
 * had no business naming. Every assertion below is one claim of that reading,
 * written out rather than counted: a count cannot be wrong in a way anybody
 * notices, and the next reader's job is to find the entry this one got wrong.
 */
describe('the two shapes the re-derivation was sent to check', () => {
  /**
   * What is left of the condition shape, and each of these has one of the
   * three residues its description now names — a rider welded to the same
   * save as the damage, an escape check or a span that is not seconds, or an
   * end cause that names whoever did the harm.
   */
  it('leaves the condition shape ten entries, each for a reason it still has', () => {
    expect(itemConsumersOf('a-condition-an-item-imposes').blocks).toEqual([
      'decanter-of-endless-water',
      'dragon-orb',
      'energy-bow',
      'horn-of-blasting',
      'iron-bands',
      'mace-of-disruption',
      'robe-of-scintillating-colors',
      'rod-of-rulership',
      'rope-of-entanglement',
      'staff-of-thunder-and-lightning',
    ]);
  });

  /**
   * And the damage shape answered the question it was carrying: the residue
   * it shared with the spell vocabulary is the spell vocabulary's, and what
   * is its own is an attack roll an item makes for itself.
   */
  it('leaves the damage shape the two entries that roll an item’s own attack', () => {
    expect(itemConsumersOf('a-damage-roll-an-item-makes').blocks).toEqual([
      'iron-bands',
      'ring-of-the-ram',
    ]);
    // Potion of Poison is where the question was decided: its save-gated half
    // is writable and its 4d6 is not, so the whole entry is the spell id.
    expect(itemBlockersOf('potion-of-poison')).toEqual([
      'damage-with-neither-an-attack-roll-nor-a-save',
    ]);
  });

  /**
   * The blocker the reading found underneath them, and the entry that shows
   * it cleanest: every clause of a Wand of Paralysis is writable but the
   * sixty feet its ray travels and the die that crumbles it.
   */
  it('names the distance that was really in the way', () => {
    const range = itemConsumersOf('a-range-an-item-names');
    expect(range.blocks.length).toBeGreaterThan(5);
    expect(range.finishes).toEqual(['necklace-of-fireballs']);

    expect(itemBlockersOf('wand-of-paralysis')).toEqual([
      'a-range-an-item-names',
      'a-rider-on-the-face-the-die-showed',
    ]);
  });

  /**
   * And two entries left the map altogether, which is the three-part move a
   * transcription makes: the line goes, the record arrives, and the shape it
   * named is claimed by somebody else or retired.
   */
  it('has transcribed the two entries the reading freed', () => {
    for (const id of ['dust-of-disappearance', 'periapt-of-health']) {
      expect(TRANSCRIBED.has(id), id).toBe(true);
      expect(ITEM_BLOCKED_ON[id], id).toBeUndefined();
    }
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
