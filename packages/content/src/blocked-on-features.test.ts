import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CITATION_FLOOR,
  misquotes as misquotedIn,
  namesIn,
  quotedRunsIn,
  type Citation,
  type CitedSource,
} from '../scripts/citations.js';
import { ITEM_SHAPES, MISSING_SHAPES } from '../scripts/missing-shapes.js';
import {
  FEATURE_BLOCKED_ON,
  FEATURE_SHAPES,
  allFeatureShapeConsumers,
  claimedFeatureShapes,
  featureBlockersIn,
  featureBlockersOf,
  featureClausesIn,
  featureConsumersOf,
  featureCoverageGaps,
  featureNoteOf,
  featuresTheTableOwns,
  knownFeatureBlockers,
  manualFeatureIds,
  unanchoredFeatureClauses,
  type FeatureEntry,
} from '../scripts/missing-feature-shapes.js';

/**
 * The manual features' blockers, asserted the way the undefined spells' and
 * the untranscribed items' are.
 *
 * `blocked-on.test.ts` exists because one family of spells was counted by hand
 * three times and came out 17, 4 and 2. `blocked-on-items.test.ts` exists
 * because the items were never counted at all. This one exists because the
 * features were counted **honestly** and read by nothing: every feature the
 * engine does not execute has carried a note saying what is missing since the
 * day it was transcribed, and those notes were the best evidence in the
 * repository about where the next mechanic should go, scattered across twelve
 * class files in whatever words fitted.
 *
 * The two guards the map is held with are the two the other maps are:
 *
 * - **a citation checked against the document it quotes**, in both directions
 *   — a shape description must name a document this repository already
 *   reviewed, and the run it quotes must be in that document. Here it is
 *   asked twice, because the map has two corpora: the shape descriptions
 *   against the design notes and the engine's own vocabulary files, and every
 *   clause against the **feature's own note**, which is the document the
 *   clause is a citation of.
 * - **no shape claimed by nothing**, which is what keeps a vocabulary from
 *   outliving the gap it named.
 */

const MANUAL = manualFeatureIds();

/** A real feature to hang synthetic readings on, chosen for a short note. */
const SPECIMEN = 'druid:druidic';

describe('the feature blocked-on map covers the manual population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * Parameterised over the population for `coverageGaps`'s own reason: a guard
   * that can only be run against the data it already agrees with is not a
   * guard.
   */
  it('reports a feature marked manual that nobody has adjudicated', () => {
    const synthetic = [...MANUAL, 'wizard:a-feature-nobody-read'];
    expect(featureCoverageGaps(synthetic).unrecorded).toEqual(['wizard:a-feature-nobody-read']);
  });

  /**
   * And the other direction, which is the case the *next* task will cause: a
   * feature converted to `engine` leaves a line behind, and the line has to go
   * with the conversion rather than a commit later.
   */
  it('reports a line for a feature that has since been executed', () => {
    const converted = MANUAL.filter((id) => id !== 'ranger:tireless');
    expect(featureCoverageGaps(converted).stale).toEqual(['ranger:tireless']);
  });

  /** Neither synthetic case is vacuous: the real corpus has no gap either way. */
  it('has a line for every manual feature and no line for anything else', () => {
    expect(featureCoverageGaps()).toEqual({ unrecorded: [], stale: [] });
  });

  /**
   * A population worth deriving, with the floor **below** it rather than on it.
   *
   * `blocked-on.test.ts` records what happens otherwise: it read `> 200`
   * against a map of exactly 201, so the next task to define two spells failed
   * a guard by succeeding. Conversions are the whole point of this map, so the
   * number here will fall; what this catches is a wrong predicate, a filter
   * that reads nothing, or a map that has quietly stopped being populated.
   */
  it('covers a population worth deriving', () => {
    expect(Object.keys(FEATURE_BLOCKED_ON).length).toBeGreaterThan(100);
  });

  /** In an order two branches can both append to, and the order is the data's. */
  it('names its entries in an order two branches can both append to', () => {
    const ids = Object.keys(FEATURE_BLOCKED_ON);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Every entry is read, which is the difference from the item map.
   *
   * There is no grandfathered form here: a hundred and sixty short notes this
   * repository wrote about itself is not two hundred SRD paragraphs nobody has
   * opened, so an entry that names no clause is a line somebody added without
   * reading anything.
   */
  it('carries at least one clause on every entry', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      expect(featureClausesIn(entry).length, id).toBeGreaterThan(0);
    }
  });
});

describe('a clause names one thing the feature’s note says', () => {
  /** The anchoring guard, driven by a phrase the note says twice. */
  it('reports a phrase the note prints more than once', () => {
    const twice = unanchoredFeatureClauses('cleric:divine-order', [
      { clause: 'grants', why: 'table', note: 'synthetic' },
    ]);
    expect(twice).toEqual([
      { spell: 'cleric:divine-order', clause: 'grants', matches: 2 },
    ]);
  });

  /** And by one it prints nowhere, which is a reworded or invented sentence. */
  it('reports a phrase the note prints nowhere', () => {
    expect(
      unanchoredFeatureClauses(SPECIMEN, [
        { clause: 'a secret handshake and the doors it opens', why: 'table', note: 'synthetic' },
      ]),
    ).toEqual([
      { spell: SPECIMEN, clause: 'a secret handshake and the doors it opens', matches: 0 },
    ]);
  });

  /**
   * Typesetting is not wording, and the note is the side that carries it.
   *
   * The catalogue's prose uses curly apostrophes and this file's clauses are
   * written with whichever the author typed. `unanchoredWithin` normalises the
   * phrase and trusts the unit, so the note has to be flattened before it is
   * searched — which was wrong for eleven clauses the first time this ran, and
   * is asserted here rather than left to the corpus agreeing by luck.
   */
  it('matches a clause across the apostrophe the note is typeset with', () => {
    expect(featureNoteOf('barbarian:instinctive-pounce')).toContain('turn’s allowance');
    expect(
      unanchoredFeatureClauses('barbarian:instinctive-pounce', [
        { clause: "costs nothing out of the turn's allowance", why: 'table', note: 'synthetic' },
      ]),
    ).toEqual([]);
  });

  /** Neither case is vacuous: every clause in the real map anchors. */
  it('anchors every clause in the map', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      expect(unanchoredFeatureClauses(id, entry), id).toEqual([]);
    }
  });

  /** A clause that is neither the table's nor expressible names an enumerated shape. */
  it('names an enumerated shape for every clause that is neither', () => {
    const known = knownFeatureBlockers();
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      for (const clause of featureClausesIn(entry)) {
        if (clause.why === 'table' || clause.why === 'expressible') continue;
        expect(known.has(clause.why), `${id} names ${clause.why}`).toBe(true);
      }
      expect(featureBlockersIn(entry).filter((shape) => !known.has(shape)), id).toEqual([]);
    }
  });

  /** Every clause says something: a note field nobody wrote is not an adjudication. */
  it('writes a real note against every clause', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      for (const clause of featureClausesIn(entry)) {
        expect(clause.note.length, `${id}: ${clause.clause}`).toBeGreaterThan(20);
      }
    }
  });
});

describe('a shape nobody consumes reports itself', () => {
  /**
   * The unclaimed-shape guard, asked of the feature vocabulary alone.
   *
   * Asked of all three together it would pass on a spell's claim, which is how
   * a shape stays in a map after the last thing needing it has moved. The
   * other two vocabularies keep their own guards over their own populations,
   * and a feature claiming a spell shape does not satisfy either — so no list
   * can quietly keep a dead id alive through another.
   */
  it('keeps no feature shape nothing is blocked on', () => {
    const claimed = claimedFeatureShapes();
    expect(Object.keys(FEATURE_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape none of the three vocabularies has. */
  it('has a vocabulary that covers every feature claim', () => {
    const known = knownFeatureBlockers();
    expect([...claimedFeatureShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });

  /**
   * The reuse is real rather than claimed: features are blocked on spell and
   * item shapes.
   *
   * The instruction this vocabulary was written under was to reuse the other
   * two wherever the gap is the same one, and a vocabulary that quietly did
   * not would look exactly like one that did. So the query is asked: Slow Fall
   * waits on the same missing mechanic Feather Fall does, a Dragon Companion
   * on the same summons Arcane Hand does, and a Wish that Divine Intervention
   * cannot reach is a spell nothing defines.
   */
  it('files a feature under a spell or item shape where the gap is the same one', () => {
    expect(featureBlockersOf('monk:slow-fall')).toEqual(['falling']);
    expect(featureBlockersOf('draconic-sorcery:dragon-companion')).toEqual([
      'a-stat-block-created-mid-fight',
    ]);
    expect(featureBlockersOf('cleric:greater-divine-intervention')).toEqual([
      'a-spell-an-item-casts-that-nothing-executes',
    ]);

    const spellShapes = new Set<string>(Object.keys(MISSING_SHAPES));
    const itemShapes = new Set<string>(Object.keys(ITEM_SHAPES));
    const claimed = [...claimedFeatureShapes()];
    expect(claimed.filter((shape) => spellShapes.has(shape)).length).toBeGreaterThan(10);
    expect(claimed.filter((shape) => itemShapes.has(shape)).length).toBeGreaterThan(1);
  });
});

describe('what a shape finishes is the column a tranche is planned from', () => {
  it('never claims to finish a feature it does not block', () => {
    for (const row of allFeatureShapeConsumers()) {
      for (const id of row.finishes) {
        expect(row.blocks, row.shape).toContain(id);
        expect(featureBlockersOf(id), id).toEqual([row.shape]);
      }
    }
  });

  /**
   * And blocks is the larger number, which is the whole reason both are
   * printed.
   *
   * A shape that touches ten features and finishes three is worth knowing
   * about differently from one that touches three and finishes three, and
   * reporting only one of the two is how a family came to be ranked three
   * ways in three documents.
   */
  it('has shapes whose two columns differ', () => {
    const rows = allFeatureShapeConsumers();
    for (const row of rows) expect(row.finishes.length).toBeLessThanOrEqual(row.blocks.length);
    expect(rows.some((row) => row.finishes.length < row.blocks.length)).toBe(true);
    expect(rows.some((row) => row.finishes.length === 0 && row.blocks.length > 1)).toBe(true);
  });

  /**
   * The finding, which is what the next batch is planned from.
   *
   * Reading a hundred and sixty notes put the same two shapes at the top, and
   * they are the same shape twice over: every class prints an Ability Score
   * Improvement the engine can only take as a feat, and every class prints an
   * Epic Boon whose one mechanical sentence raises a score past 20. Between
   * them they are the largest single block of manual features in the
   * catalogue, and neither is a combat mechanic.
   */
  it('ranks the advancement shapes first, above anything a fight uses', () => {
    const top = allFeatureShapeConsumers()
      .slice(0, 2)
      .map((row) => row.shape)
      .sort();
    expect(top).toEqual([
      'an-ability-score-an-advancement-raises',
      'an-ability-score-maximum-above-20',
    ]);
    // Twelve classes each, which is what makes them the heaviest rather than
    // a detail: the number itself is COVERAGE.md's to print.
    for (const shape of top) {
      expect(featureConsumersOf(shape as never).finishes.length).toBeGreaterThan(9);
    }
  });

  /**
   * And the heaviest thing a **fight** would notice, which is a different
   * question and deliberately answered apart.
   */
  it('ranks weapon mastery first among the shapes a fight would notice', () => {
    const inCombat = allFeatureShapeConsumers().filter(
      (row) =>
        row.shape !== 'an-ability-score-an-advancement-raises' &&
        row.shape !== 'an-ability-score-maximum-above-20',
    );
    expect(inCombat[0]?.shape).toBe('a-weapon-mastery-property');
    expect(featureConsumersOf('a-weapon-mastery-property').blocks).toEqual([
      'barbarian:weapon-mastery',
      'fighter:tactical-master',
      'fighter:weapon-mastery',
      'paladin:weapon-mastery',
      'ranger:weapon-mastery',
      'rogue:weapon-mastery',
    ]);
  });
});

/**
 * The features that are finished business, pinned by name rather than by size.
 *
 * The *fiction* pile on the other book. A feature whose every clause is the
 * table's is not waiting on the engine and is never going to be executed —
 * Thieves' Cant is a language, a Fighting Style is its feat's debt, and
 * Hunter's Lore is knowledge. Pinning them by name means a builder who thinks
 * one of them is buildable has to come here and say so.
 */
describe('the features blocked by nothing', () => {
  it('are these, and every clause of each is the table’s', () => {
    expect(featuresTheTableOwns()).toEqual([
      'champion:additional-fighting-style',
      'druid:druidic',
      'fighter:fighting-style',
      'hunter:hunters-lore',
      'paladin:fighting-style',
      'ranger:fighting-style',
      'rogue:thieves-cant',
    ]);
    for (const id of featuresTheTableOwns()) {
      expect(
        featureClausesIn(FEATURE_BLOCKED_ON[id] ?? []).every((clause) => clause.why === 'table'),
        id,
      ).toBe(true);
    }
  });

  /**
   * And they are not the same pile as a feature the engine half does.
   *
   * Ten features are `manual` **and** carry a grant, because the engine does
   * part of what the book prints. Those halves are `'expressible'`, and a
   * feature carrying one is still blocked on whatever its other clauses name.
   */
  it('keeps a half-built feature out of the table’s pile', () => {
    const half = Object.entries(FEATURE_BLOCKED_ON).filter(([, entry]) =>
      featureClausesIn(entry).some((clause) => clause.why === 'expressible'),
    );
    expect(half.length).toBeGreaterThan(5);
    for (const [id, entry] of half) {
      if (featureBlockersIn(entry).length === 0) continue;
      expect(featuresTheTableOwns(), id).not.toContain(id);
    }
  });
});

/**
 * The documents a shape description may name, and what each resolves to.
 *
 * `blocked-on.test.ts`'s table pointed at this corpus. It is **its own table
 * rather than an import**, for the reason `citations.ts` gives: what is shared
 * is the floor, the normalisation and the two scans, and what is not shared is
 * which documents may be named — this map cites the engine's own vocabulary
 * files, which the spell map has no reason to.
 *
 * `srd` resolves to nothing on purpose, so a quotation of the book is skipped
 * rather than looked up in whichever document was named before it. It is
 * listed **before** `srd-policy.md`, whose path contains it, because
 * {@link citationsIn} takes the last name matching at an offset and the more
 * specific document has to win.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));

const CITED_SOURCES: readonly CitedSource[] = [
  { name: 'srd', label: 'the SRD', files: [] },
  {
    name: 'progression.ts',
    label: 'packages/engine/src/progression.ts',
    files: ['packages/engine/src/progression.ts'],
  },
  {
    name: 'standing.ts',
    label: 'packages/engine/src/standing.ts',
    files: ['packages/engine/src/standing.ts'],
  },
  {
    name: 'roll-modifiers.ts',
    label: 'packages/engine/src/roll-modifiers.ts',
    files: ['packages/engine/src/roll-modifiers.ts'],
  },
  {
    name: 'content.ts',
    label: 'packages/engine/src/content.ts',
    files: ['packages/engine/src/content.ts'],
  },
  { name: 'content.md', label: 'docs/design/content.md', files: ['docs/design/content.md'] },
  // Two files under one name, exactly as the spell map resolves this one: the
  // architecture was reviewed in the archived copy and the current document is
  // where the magic-item half was written afterwards.
  {
    name: 'characters-and-equipment.md',
    label: 'docs/design/characters-and-equipment.md',
    files: [
      'docs/design/characters-and-equipment.md',
      'docs/archive/design/characters-and-equipment.md',
    ],
  },
  {
    name: 'time-and-turns.md',
    label: 'docs/design/time-and-turns.md',
    files: ['docs/design/time-and-turns.md', 'docs/archive/design/time-and-turns.md'],
  },
  {
    name: 'space-and-areas.md',
    label: 'docs/design/space-and-areas.md',
    files: ['docs/design/space-and-areas.md', 'docs/archive/design/space-and-areas.md'],
  },
  {
    name: 'rolls-and-damage.md',
    label: 'docs/design/rolls-and-damage.md',
    files: ['docs/design/rolls-and-damage.md', 'docs/archive/design/rolls-and-damage.md'],
  },
];

/**
 * Every quoted run in one description, attributed to the last document named
 * before it.
 *
 * The **nearest preceding name**, which is the spell map's rule and is one an
 * author can hold in their head: name the document, then quote it. Its one
 * cost is that a quotation of something else is read as belonging to whatever
 * was named last, so a description quoting a second source has to name that
 * one too.
 */
function citationsIn(where: string, prose: string): readonly Citation[] {
  const named = namesIn(CITED_SOURCES, prose);
  const cited: Citation[] = [];
  for (const { at, run } of quotedRunsIn(prose)) {
    const attributed = named.filter((mention) => mention.at < at).pop();
    if (attributed === undefined || attributed.files.length === 0) continue;
    cited.push({ where, source: attributed.source, run, files: attributed.files });
  }
  return cited;
}

const misquotes = (corpus: Iterable<readonly [string, string]>): string[] =>
  misquotedIn(corpus, citationsIn);

/** Every piece of prose in this map that may cite the repository. */
const citedProse = (): Array<readonly [string, string]> =>
  Object.entries(FEATURE_SHAPES).map(([shape, description]) => [shape, description] as const);

describe('a shape says where this repository already described it', () => {
  /**
   * The rule that keeps the vocabulary from becoming a private language.
   *
   * The names are read off {@link CITED_SOURCES} rather than written out a
   * second time, so the list a description must name and the list a quotation
   * is checked against cannot drift apart.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = CITED_SOURCES.filter((source) => source.files.length > 0).map(
      (source) => source.name,
    );
    for (const [shape, description] of Object.entries(FEATURE_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of Object.entries(FEATURE_SHAPES)) {
      expect(description.length, shape).toBeGreaterThan(120);
    }
  });
});

/**
 * Naming a document is not quoting it, and the guard above only asks for the
 * name.
 *
 * `blocked-on.test.ts` records what that costs: two misquotes of a named file
 * shipped inside one tranche and were caught by a reviewer reading rather than
 * by a test. This is the other half of the same rule, pointed at the third
 * corpus — a claim about a document, checked against the document.
 */
describe('a citation is held against the document it names', () => {
  /**
   * The guard, driven by a misquote built to be caught.
   *
   * The synthetic **inverts a sentence the file really prints**, because that
   * is the failure in its hardest form: the file is named, the file exists,
   * the subject is right, and nothing but opening it can tell the two apart.
   */
  it('catches a description quoting a sentence the named document does not print', () => {
    const wrong =
      'packages/engine/src/standing.ts says it outright: "Suppression, and also prevention and removal".';
    expect(misquotes([['synthetic-shape', wrong]])).toEqual([
      expect.stringContaining('Suppression, and also prevention and removal'),
    ]);
  });

  /** And it passes the moment the quotation is the sentence the file prints. */
  it('passes once that quotation is corrected', () => {
    const right =
      'packages/engine/src/standing.ts says it outright: "Suppression, not prevention and not removal".';
    expect(misquotes([['synthetic-shape', right]])).toEqual([]);
  });

  /**
   * A quotation of the book is not a claim about this repository.
   *
   * Every description here quotes an SRD sentence somewhere, and looking one
   * up in whichever document was named before it would fail on prose that is
   * perfectly correct.
   */
  it('leaves a quotation attributed to the SRD to the guard that owns it', () => {
    const note =
      'packages/engine/src/progression.ts files it as debt. SRD: "You can attack twice instead of once".';
    expect(misquotes([['synthetic-shape', note]])).toEqual([]);
  });

  /** A run shorter than the floor is a quoted term rather than a citation. */
  it('leaves a quoted term alone', () => {
    expect(CITATION_FLOOR).toBe(8);
    expect(misquotes([['synthetic-shape', 'packages/engine/src/standing.ts: "aura".']])).toEqual([]);
  });

  /**
   * The corpus, and the assertion that the corpus is not vacuous.
   *
   * Every document the table names must be quoted somewhere: a name with no
   * citation is an alias nothing uses, which would make the guard quietly
   * narrower than it reads.
   */
  it('checks at least one citation of every document the table names', () => {
    const cited = new Set(
      citedProse().flatMap(([where, prose]) =>
        citationsIn(where, prose).map((citation) => citation.source),
      ),
    );
    expect(
      CITED_SOURCES.filter((source) => source.files.length > 0 && !cited.has(source.label)).map(
        (source) => source.label,
      ),
    ).toEqual([]);
  });

  /** And the real thing: every description quotes the document it names. */
  it('quotes every document this map names', () => {
    expect(misquotes(citedProse())).toEqual([]);
  });

  /** The design-note paths this table resolves really are tracked files. */
  it('names documents that exist', () => {
    const tracked = new Set([
      ...readdirSync(`${HERE}../../../docs/design`).map((file) => `docs/design/${file}`),
      ...readdirSync(`${HERE}../../../docs/archive/design`).map(
        (file) => `docs/archive/design/${file}`,
      ),
    ]);
    for (const source of CITED_SOURCES) {
      for (const path of source.files) {
        if (!path.startsWith('docs/')) continue;
        expect(tracked.has(path), path).toBe(true);
      }
    }
  });
});

/** The synthetic entry type is the real one, so a test cannot widen the map. */
const SYNTHETIC: FeatureEntry = [
  { clause: 'A secret language', why: 'table', note: 'a synthetic reading of a real note' },
];

describe('the classifier can be driven with something it must refuse', () => {
  it('reads a synthetic entry over a real note', () => {
    expect(unanchoredFeatureClauses(SPECIMEN, SYNTHETIC)).toEqual([]);
    expect(featureBlockersIn(SYNTHETIC)).toEqual([]);
  });

  it('refuses a clause naming a shape no vocabulary has', () => {
    const invented: FeatureEntry = [
      { clause: 'A secret language', why: 'a-shape-nobody-wrote-down' as never, note: 'synthetic' },
    ];
    expect(knownFeatureBlockers().has(featureBlockersIn(invented)[0] ?? '')).toBe(false);
  });
});
