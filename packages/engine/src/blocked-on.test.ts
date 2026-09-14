import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADJUDICATED,
  BLOCKED_ON,
  MISSING_SHAPES,
  SPLIT_BUNDLES,
  TRACKED_ADJUDICATED,
  allShapeConsumers,
  claimedShapes,
  consumersOf,
  coverageGaps,
  parsedSpellIds,
  DEFINED_SPELL_IDS,
  type ShapeId,
} from '../scripts/missing-shapes.js';

/**
 * The undefined population's blockers, asserted the way the executed one's are.
 *
 * `PARTIAL_SPELLS` stopped being a hand list when IE-004 made it a consequence
 * of the adjudication map. `BLOCKED_ON` is the other half: the spells the
 * engine has **no definition for at all**, each read against its own SRD
 * paragraph, so that a shape's consumer count is a query rather than a number
 * in prose that nothing regenerates.
 *
 * The failure this exists to end has happened three times on one family: 17
 * open spells in `PROGRESS.md`, 4 in the leverage audit, 2 whole and 1 partial
 * in the SRD text. None was derived.
 */

const PARSED = parsedSpellIds();
const HERE = fileURLToPath(new URL('.', import.meta.url));

describe('the blocked-on map covers the undefined population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * A guard that can only be run against the data it already agrees with is
   * not a guard, so `coverageGaps` is parameterised over both lists and driven
   * here with a synthetic catalogue containing a spell nobody has read. This
   * is the shape `spell-tracking.test.ts` uses for its markers and
   * `invariants.test.ts` for its sweeps: prove the analysis bites on a case
   * built to be caught, then run it on the real thing.
   */
  it('reports a spell added to the catalogue with neither an entry nor a definition', () => {
    const synthetic = [...PARSED, 'hurl-through-hell'];
    const gaps = coverageGaps(synthetic, DEFINED_SPELL_IDS);
    expect(gaps.unrecorded).toEqual(['hurl-through-hell']);
  });

  /** And the other direction: an entry for a spell that is no longer undefined. */
  it('reports an entry for a spell that has since been defined', () => {
    // The case this guard has already caught for real, three times: IE-014
    // defined Lesser Restoration and Protection from Poison, IE-017 Stoneskin
    // and Protection from Energy. The synthetic stands in for the next one.
    const defined = new Set([...DEFINED_SPELL_IDS, 'magic-missile']);
    expect(coverageGaps(PARSED, defined).stale).toEqual(['magic-missile']);
  });

  /** Neither synthetic case is vacuous: the real catalogue has no gap either way. */
  it('has an entry for every undefined spell and no entry for anything else', () => {
    expect(coverageGaps(PARSED, DEFINED_SPELL_IDS)).toEqual({ unrecorded: [], stale: [] });
  });

  /** And the population is the size the audit measured, not something smaller. */
  it('covers a population worth deriving', () => {
    expect(Object.keys(BLOCKED_ON).length).toBeGreaterThan(200);
  });

  it('names only shapes the vocabulary has', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, shapes] of Object.entries(BLOCKED_ON)) {
      for (const shape of shapes) {
        expect(known.has(shape), `${spellId} names ${shape}`).toBe(true);
      }
    }
  });

  /** In an order two branches can both append to, like every other list here. */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(BLOCKED_ON);
    expect(ids).toEqual([...ids].sort());
    for (const [spellId, shapes] of Object.entries(BLOCKED_ON)) {
      expect([...shapes], spellId).toEqual([...shapes].sort());
      expect(new Set(shapes).size, `${spellId} repeats a shape`).toBe(shapes.length);
    }
  });

  /**
   * An empty list is an answer, and it is pinned by **name**.
   *
   * "Blocked on nothing the engine owns" means the spell could be taken today,
   * tracked at least — the most interesting thing the map says, and the one
   * claim `CLAUDE.md` restates. A bound on the *size* is what a docstring
   * would carry and is exactly the kind of number this file exists to stop
   * trusting, so the set is written out: a spell joining or leaving it is a
   * reading somebody changed, and it should have to say so here.
   *
   * Light, obscurement and a fiction trigger are why most of them are here.
   * All three are clauses `spell-honesty.test.ts`'s marker list already leaves
   * alone by name, so calling them fiction is the line this repository already
   * draws rather than a new one.
   *
   * **A spell that offers a choice of branches is here only while every branch
   * is fiction.** Druidcraft and Elementalism each pick one of four or five
   * effects and not one of them is arithmetic, so the choice decides nothing
   * the engine would have to record. Thaumaturgy prints the same shape and one
   * of its six branches grants Advantage on Charisma (Intimidation) checks —
   * which `roll-modifiers.ts` expresses exactly — so its choice does decide
   * something, and it is *not* here. That is the whole of the difference, and
   * it was worth getting wrong once to write down.
   */
  it('records a spell blocked on nothing rather than omitting it', () => {
    const free = Object.entries(BLOCKED_ON)
      .filter(([, shapes]) => shapes.length === 0)
      .map(([id]) => id);
    expect(free).toEqual([
      'conjure-fey',
      'create-or-destroy-water',
      'dancing-lights',
      'darkness',
      'daylight',
      'druidcraft',
      'elementalism',
      'fog-cloud',
      'programmed-illusion',
      'purify-food-and-drink',
      'zone-of-truth',
    ]);
  });

  /**
   * The one spell in the book whose **range** grows with the caster.
   *
   * `SpellDefinition.range` is one fixed `SpellRange` and `ranged()` is checked
   * on every casting before a target is looked at, so a defined Spare the Dying
   * would refuse the level 5 cleric the SRD lets stabilise an ally at thirty
   * feet. The engine's path arrives and answers wrongly, which is this map's
   * own definition of debt rather than fiction — and it is the only spell that
   * prints the clause, which is exactly when a one-consumer shape is cheap to
   * name and impossible to reconstruct later.
   */
  it('files the one spell whose range scales with the caster', () => {
    expect(consumersOf('a-range-that-scales-with-caster-level').blocks).toEqual([
      'spare-the-dying',
    ]);
    expect(BLOCKED_ON['spare-the-dying']).toEqual([
      'a-range-that-scales-with-caster-level',
      'an-effect-that-stabilises-a-dying-creature',
    ]);
  });
});

/**
 * The documents a citation may name, and what each name resolves to.
 *
 * Four entries and deliberately not "any file in the repository": a citation
 * is worth checking *because* it names a document somebody reviewed, and a
 * table that matched any path would stop saying where a claim came from.
 * `docs/architecture` is **read** rather than listed, because the audits are a
 * directory that grows and a hand-kept list of them is the hand-kept count
 * this whole map exists to end. That one name therefore resolves to several
 * files and a run need appear in any of them, which is the honest reading of a
 * description that says "the audit" without saying which — and still far
 * narrower than asking whether the word appears.
 *
 * **`SRD` is in the table carrying no file, and that is the whole of what it
 * is for.** A note that names `CLAUDE.md` and then quotes the book must not
 * have the book's sentence looked up in `CLAUDE.md`. Those quotations already
 * have a guard — `spell-honesty.test.ts` holds each against that spell's own
 * paragraph — and this one would check them against the wrong document
 * entirely.
 */
const CITED_SOURCES: ReadonlyArray<{
  /** What a citation writes, matched as it stands and case-insensitively. */
  readonly name: string;
  /** What a failure names, which for the audits is the directory. */
  readonly label: string;
  readonly files: readonly string[];
}> = [
  { name: 'claude.md', label: 'CLAUDE.md', files: ['CLAUDE.md'] },
  { name: 'progress.md', label: 'PROGRESS.md', files: ['PROGRESS.md'] },
  {
    name: 'audit',
    label: 'the audit records under docs/architecture/',
    files: readdirSync(`${HERE}../../../docs/architecture`).map(
      (file) => `docs/architecture/${file}`,
    ),
  },
  {
    name: 'spell-definitions.ts',
    label: 'packages/engine/src/spell-definitions.ts',
    files: ['packages/engine/src/spell-definitions.ts'],
  },
  { name: 'srd', label: 'the SRD', files: [] },
];

/**
 * The shortest run worth holding against a document, and what the floor costs.
 *
 * Eight characters, which is `spell-honesty.test.ts`'s floor for the same job
 * on the other axis — one convention in this repository rather than two. What
 * it costs is that a shorter quotation goes unchecked, and that is the right
 * way round: `"D20 Tests"` and `"within reach"` are quoted *terms* rather than
 * citations, and a run that short is as likely to land in a document by
 * coincidence as by quotation. Measured on this corpus the floor is not
 * load-bearing — every citation from eight characters upward passes, and so
 * does every one from thirty upward — so it sits where it under-fires rather
 * than where it would start guessing.
 */
const CITATION_FLOOR = 8;

/**
 * Emphasis, smart quotes and line wrapping are typesetting; the wording is not.
 *
 * Both sides are normalised, so a citation may be typeset differently from the
 * sentence it quotes and still be that sentence. What survives is every word
 * and every mark of punctuation between them — a quotation closing with a full
 * stop where the document goes on with a colon is a different sentence, which
 * is why the descriptions put the citing sentence's own stop *outside* the
 * closing quote.
 */
const normaliseProse = (text: string): string =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const documents = new Map<string, string>();
const documentText = (path: string): string => {
  const cached = documents.get(path);
  if (cached !== undefined) return cached;
  const text = normaliseProse(readFileSync(`${HERE}../../../${path}`, 'utf8'));
  documents.set(path, text);
  return text;
};

interface Citation {
  /** The shape, or the spell and clause, the run was written in. */
  readonly where: string;
  readonly source: string;
  readonly run: string;
  readonly files: readonly string[];
}

/**
 * Every quoted run in one piece of prose, attributed to the last document
 * named before it.
 *
 * **Nearest preceding name**, which is a rule an author can hold in their head
 * rather than a matcher whose behaviour nobody can predict: name the document,
 * then quote it. Its one cost is that a quotation of something *else* is read
 * as belonging to whatever was named last, so a description quoting a second
 * source has to name that one too — which is the habit this guard exists to
 * enforce rather than a concession. A run with no document named anywhere
 * before it is nobody's citation and is skipped, as is one attributed to a
 * name the table gives no file.
 */
function citationsIn(where: string, prose: string): Citation[] {
  const named: Array<{ at: number; source: string; files: readonly string[] }> = [];
  for (const { name, label, files } of CITED_SOURCES) {
    const mark = new RegExp(name.replace(/\./g, '\\.'), 'gi');
    let found: RegExpExecArray | null;
    while ((found = mark.exec(prose)) !== null) {
      named.push({ at: found.index, source: label, files });
    }
  }
  named.sort((a, b) => a.at - b.at);

  const cited: Citation[] = [];
  const quoted = new RegExp(`"[^"]{${CITATION_FLOOR},}"`, 'g');
  let run: RegExpExecArray | null;
  while ((run = quoted.exec(prose)) !== null) {
    const at = run.index;
    const attributed = named.filter((mention) => mention.at < at).pop();
    if (attributed === undefined || attributed.files.length === 0) continue;
    cited.push({
      where,
      source: attributed.source,
      run: run[0].slice(1, -1),
      files: attributed.files,
    });
  }
  return cited;
}

/**
 * Does the cited document contain this run, reading an elision forwards?
 *
 * A citation may elide with `...`, which this repository's prose does
 * constantly, and the parts either side must then appear **in the document's
 * order** — a quotation that reorders a document is not that document's
 * sentence. With no elision it is a plain containment test, which is the whole
 * of the precedent's behaviour.
 */
function containsRun(path: string, run: string): boolean {
  const text = documentText(path);
  let cursor = 0;
  for (const part of run.split(/\s*(?:\.\.\.|…)\s*/)) {
    const fragment = normaliseProse(part);
    if (fragment.length === 0) continue;
    const at = text.indexOf(fragment, cursor);
    if (at < 0) return false;
    cursor = at + fragment.length;
  }
  return true;
}

/**
 * The citations a corpus makes that the document it named does not contain.
 *
 * Parameterised over the corpus for the reason `coverageGaps` is: a guard that
 * can only be run against the data it already agrees with is not a guard, so
 * the tests below drive it with a misquote built to be caught before they run
 * it on the real maps. Every failure carries the shape or spell, the run, and
 * the document it was checked against, because a guard that reports only a
 * failure teaches nobody.
 */
function misquotes(corpus: Iterable<readonly [string, string]>): string[] {
  const found: string[] = [];
  for (const [where, prose] of corpus) {
    for (const citation of citationsIn(where, prose)) {
      if (citation.files.some((path) => containsRun(path, citation.run))) continue;
      found.push(
        `${citation.where} attributes to ${citation.source} a run it does not contain: "${normaliseProse(citation.run)}"`,
      );
    }
  }
  return found;
}

/** Every piece of prose in these three maps that may cite this repository. */
function citedProse(): Array<readonly [string, string]> {
  return [
    ...Object.entries(MISSING_SHAPES).map(([shape, description]) => [shape, description] as const),
    ...Object.entries(ADJUDICATED).flatMap(([spellId, entries]) =>
      entries.map((entry) => [`${spellId}: ${entry.clause}`, entry.note] as const),
    ),
    ...Object.entries(TRACKED_ADJUDICATED).flatMap(([spellId, markers]) =>
      Object.entries(markers).flatMap(([marker, entry]) =>
        entry === undefined ? [] : [[`${spellId}: ${marker}`, entry.note] as const],
      ),
    ),
  ];
}

describe('a shape says where this repository already described it', () => {
  /**
   * The rule that keeps the vocabulary from becoming a private language — the
   * one `spell-honesty.test.ts` introduced, now asked of the whole map.
   *
   * The names are read off {@link CITED_SOURCES} rather than written out a
   * second time, so the list a description must name and the list a quotation
   * is checked against cannot drift apart.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = CITED_SOURCES.filter((source) => source.files.length > 0).map(
      (source) => source.name,
    );
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      expect(description.length, shape).toBeGreaterThan(120);
    }
  });

  /**
   * No shape may sit in the vocabulary unclaimed — now over all three
   * populations, which is the whole reason the three maps share one list.
   *
   * Asked of one population it deletes every shape only the others name. IE-010
   * is the precedent for what happens when a shape genuinely empties: it
   * removed `outcome-scoped-child-effects` rather than renaming it, because
   * re-filing its last claimant left a shape nothing was blocked on.
   */
  it('keeps no shape nothing is blocked on', () => {
    const claimed = claimedShapes();
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape the vocabulary has dropped. */
  it('has a vocabulary that covers every claim', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    expect([...claimedShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });
});

/**
 * Naming a document is not quoting it, and the guard above only ever asked for
 * the name.
 *
 * It is a substring test for a *source name*, so a description could name
 * `CLAUDE.md` and then quote a sentence `CLAUDE.md` does not contain — which
 * is exactly what happened: **two misquotes of `CLAUDE.md` shipped inside
 * tranche 4** and were caught by a reviewer reading rather than by a test.
 * This is the other half of the same rule, and the shape is
 * `spell-honesty.test.ts`'s, which holds an `unmodelled` note's SRD quotation
 * against that spell's own paragraph after four notes were found attributing
 * to the book a sentence it does not print. Same failure, the other axis: a
 * claim about a document, checked against the document.
 */
describe('a citation is held against the document it names', () => {
  /**
   * The guard, driven by a misquote built to be caught.
   *
   * The synthetic **inverts a sentence `CLAUDE.md` really prints**, because
   * that is the failure in its hardest form: the file is named, the file
   * exists, the subject is right, and nothing but opening it can tell the two
   * apart. A guard nobody has seen fire is a guard nobody has tested.
   */
  it('catches a description quoting a sentence CLAUDE.md does not print', () => {
    const misquoted = 'CLAUDE.md says it outright: "A Goblin Warrior is Humanoid, not Fey".';
    expect(misquotes([['synthetic-shape', misquoted]])).toEqual([
      expect.stringContaining('A Goblin Warrior is Humanoid, not Fey'),
    ]);
  });

  /** And it passes the moment the quotation is the sentence the file prints. */
  it('passes once that quotation is corrected', () => {
    const quoted = 'CLAUDE.md says it outright: "A Goblin Warrior is Fey, not Humanoid".';
    expect(misquotes([['synthetic-shape', quoted]])).toEqual([]);
  });

  /**
   * **This repository states one sentence two ways, and the guard must not
   * pick for it.**
   *
   * `CLAUDE.md` writes Mass Cure Wounds' range rule as "the point **rather
   * than** to each target" and `spell-definitions.ts` writes it as "the point,
   * **not** to each target". Both are correct in their own file, so the
   * quotation is resolved by *naming*: a citation of `CLAUDE.md` is checked
   * against `CLAUDE.md`. Neither document is edited, and neither spelling is
   * preferred.
   */
  it('holds each of the two spellings of one sentence against its own file', () => {
    expect(
      misquotes([
        ['claude-side', 'CLAUDE.md: "The range then belongs to the point rather than to each target".'],
        [
          'definition-side',
          'spell-definitions.ts: "The range then belongs to the point, not to each target".',
        ],
      ]),
    ).toEqual([]);
  });

  /**
   * And swapped, both fail — which is what resolving *by naming* buys.
   *
   * A guard that checked a run against every document the table knows would
   * pass this, and would then be unable to tell a citation of one file from a
   * citation of the other. That is the whole distinction the two spellings
   * exist to test.
   */
  it('fails each spelling when it is attributed to the other file', () => {
    expect(
      misquotes([
        ['claude-side', 'CLAUDE.md: "The range then belongs to the point, not to each target".'],
        [
          'definition-side',
          'spell-definitions.ts: "The range then belongs to the point rather than to each target".',
        ],
      ]),
    ).toHaveLength(2);
  });

  /**
   * An elision reads forwards, so a quotation cannot reorder its document.
   *
   * Citations here elide constantly — seventeen quoted runs in
   * `missing-shapes.ts` carry a `...` — so the alternative to reading one was
   * rewriting all of them. What it must not buy is a licence to assemble a
   * sentence the document never made, so the parts are matched in order.
   */
  it('reads an elision forwards and refuses one that runs backwards', () => {
    const forwards =
      'CLAUDE.md: "Advantage is presence, not arithmetic ... Three advantages against one disadvantage is a *normal* roll".';
    const backwards =
      'CLAUDE.md: "Three advantages against one disadvantage is a *normal* roll ... Advantage is presence, not arithmetic".';
    expect(misquotes([['forwards', forwards]])).toEqual([]);
    expect(misquotes([['backwards', backwards]])).toHaveLength(1);
  });

  /**
   * A quotation of the book is not a claim about this repository.
   *
   * Every `SRD:` note in these maps would otherwise be looked up in whichever
   * document was named before it. `spell-honesty.test.ts` already holds those
   * against the spell's own paragraph, which is the only text that can answer
   * them.
   */
  it('leaves a quotation attributed to the SRD to the guard that owns it', () => {
    const note =
      'CLAUDE.md files it as debt. SRD: "the sword vanishes into a puff of glittering dust".';
    expect(misquotes([['synthetic-spell', note]])).toEqual([]);
  });

  /**
   * The corpus, and the assertion that the corpus is not vacuous.
   *
   * Every document the table names must be quoted somewhere: a name with no
   * citation is an alias nothing uses, which is the speculative-member failure
   * this repository sweeps for everywhere else — and it would make the guard
   * quietly narrower than it reads.
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

  /**
   * And the real thing: every description and every note quotes the document
   * it names.
   *
   * Where this found a misquote the **description** was corrected, never the
   * cited document. Two were stale rather than invented — `PROGRESS.md`'s
   * ranked map was re-derived and its rows now carry two columns — and one,
   * "4 printed, far more in play", appears nowhere in this repository at all.
   */
  it('quotes every document these maps name', () => {
    expect(misquotes(citedProse())).toEqual([]);
  });
});

describe('the split bundles add back up', () => {
  /**
   * The evidence that splitting three bundle ids preserved the facts.
   *
   * The audit's complaint was arithmetic — "every per-shape count derived from
   * that map inherits the bundle" — so the repair is checked as arithmetic.
   * Each recorded `[spellId, clause, wentTo]` triple must still be an
   * adjudication filed exactly where the split put it.
   *
   * **Unless the shape it went to has since been built**, which is the one
   * honest reason a clause may leave the map: IE-019 built
   * `an-outcome-that-varies-by-creature-type` and executed Shatter with it, so
   * that clause is gone. A clause that vanished while its shape still stands
   * is a silent loss and fails here, which is what makes the exception a
   * branch rather than a hole.
   */
  it.each(Object.keys(SPLIT_BUNDLES))('accounts for every adjudication %s held', (bundle) => {
    const split = SPLIT_BUNDLES[bundle]!;
    const live = new Set<string>(Object.keys(MISSING_SHAPES));
    const landed = new Map<string, number>();

    for (const [spellId, clause, wentTo] of split.held) {
      const entry = (ADJUDICATED[spellId] ?? []).find((e) => e.clause === clause);
      if (entry === undefined) {
        expect(
          live.has(wentTo),
          `${spellId}: "${clause}" left the map while ${wentTo} is still missing`,
        ).toBe(false);
      } else {
        expect(entry.why, `${spellId}/${clause}`).toBe(wentTo);
      }
      landed.set(wentTo, (landed.get(wentTo) ?? 0) + 1);
    }

    // The counts sum to what the bundle claimed, over the spells it claimed.
    expect([...landed.values()].reduce((a, b) => a + b, 0)).toBe(split.adjudications);
    expect(split.held).toHaveLength(split.adjudications);
    expect(new Set(split.held.map(([id]) => id)).size).toBe(split.spells);
    // And the split really is a split: more than one destination, every one of
    // them either a live shape or one that has since been built.
    expect(new Set(split.held.map(([, , wentTo]) => wentTo)).size).toBeGreaterThan(1);
  });

  /** And the bundle id itself is gone from every map, not merely unused. */
  it.each(Object.keys(SPLIT_BUNDLES))('no longer files anything to %s', (bundle) => {
    if (Object.keys(MISSING_SHAPES).includes(bundle)) {
      // `a-mode-on-the-save-a-spell-forces` kept its id and lost five of its
      // six claimants: the audit found its *description* misstated its own
      // blocker, not that the mechanism was imaginary. What must be true is
      // that nothing it used to hold wrongly is still filed to it.
      const held = new Set(
        SPLIT_BUNDLES[bundle]!.held.map(([id, clause]) => `${id}/${clause}`),
      );
      for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
        for (const entry of entries) {
          if (entry.why !== bundle) continue;
          expect(held.has(`${spellId}/${entry.clause}`)).toBe(false);
        }
      }
      return;
    }
    expect(claimedShapes().has(bundle)).toBe(false);
  });

  /**
   * `outcome-scoped-child-effects` is IE-010's, and this file must not bring
   * it back. It removed the id when the rider vocabulary was built rather than
   * renaming it, because a shape nothing is blocked on is one the guard above
   * deletes.
   */
  it('does not resurrect the bundle IE-010 removed', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-scoped-child-effects');
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-riders');
    expect(Object.keys(SPLIT_BUNDLES)).not.toContain('outcome-scoped-child-effects');
  });
});

describe('a consumer count is a query', () => {
  /**
   * **The query predicted a build, and the build tested the query.**
   *
   * Before IE-017 existed this map said `a-defence-a-spell-grants` was the only
   * blocker for exactly two spells — Stoneskin and Mind Blank — reproducing
   * Fable's "2 whole, 1 partial" from data rather than quoting it. IE-017 then
   * built that shape, independently, and the result is the strongest evidence
   * this file has and the sharpest correction in it:
   *
   * | Predicted | What happened |
   * |---|---|
   * | Stoneskin finished | **defined and verified** — right |
   * | Mind Blank finished | still undefined — *wrong* |
   * | Protection from Energy partial | **defined and verified** — also wrong |
   *
   * Both misses are one mistake, and it is a bundle in this very vocabulary.
   * `a-defence-a-spell-grants` claimed condition Immunity was "the same storage
   * and the same sentence shape"; IE-017 built `CreatureState.defenses` and
   * touched `conditionApplicability` not at all, so Mind Blank's "Immunity to
   * Psychic damage **and the Charmed condition**" kept half a blocker. And the
   * damage type Protection from Energy chooses turned out to be expressible
   * already, once IE-017 gave `damageTypeStated` a second user.
   *
   * So the shape is retired, the condition half is its own id, and the lesson
   * is the audit's own in miniature: a count is only as good as the shape it
   * counts, and the way to find out is to build one.
   */
  it('retires the shape IE-017 built, and keeps the half it did not', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-defence-a-spell-grants');
    expect(claimedShapes().has('a-defence-a-spell-grants')).toBe(false);

    // The right half of the prediction: Stoneskin is defined, so it is out.
    expect(BLOCKED_ON['stoneskin']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-energy']).toBeUndefined();

    // The wrong half, and where it went.
    expect(BLOCKED_ON['mind-blank']).toEqual(['a-condition-immunity-a-spell-grants']);
    expect(consumersOf('a-condition-immunity-a-spell-grants').unblocks).toEqual(['mind-blank']);
  });

  /**
   * And a damage type chosen at the casting is no longer a blocker at all.
   *
   * `damageTypeStated` was written for Spirit Guardians, where the SRD decides
   * the type on a fact the engine does not hold, and its docstring said a
   * second user would be the evidence it should generalise. IE-017's
   * Protection from Energy is that user and chooses for the opposite reason,
   * so the field carries both — which takes six spells' worth of
   * `a-choice-made-at-the-casting` filings off the map.
   */
  it('no longer blocks a spell whose only choice is a damage type', () => {
    for (const id of [
      'chromatic-orb',
      'conjure-elemental',
      'dragons-breath',
      'resistance',
      'sorcerous-burst',
      'true-strike',
    ]) {
      expect(BLOCKED_ON[id], id).not.toContain('a-choice-made-at-the-casting');
    }
    // And still blocks one whose choice is anything else: an ability, a
    // condition, one of six wonders, which of five effects to remove.
    for (const id of ['hex', 'blindness-deafness', 'thaumaturgy', 'greater-restoration']) {
      const shapes = BLOCKED_ON[id] ?? ADJUDICATED[id]?.map((e) => e.why) ?? [];
      expect(shapes, id).toContain('a-choice-made-at-the-casting');
    }
  });

  /**
   * The whole "four Conjures" row, which is wrong about all six of them.
   *
   * `CLAUDE.md`'s "A stat block created mid-fight" row said "the four
   * Conjures". SRD 5.2.1 rewrote the family as *spirits* — a pack, a pillar
   * of light, an Emanation, a point you strike from — and not one of the six
   * prints an Armour Class, Hit Points or a turn. The brief said the SRD wins
   * where the prose disagrees; this is what keeps the correction from drifting
   * back, and it names spells the row *is* right about so the shape does not
   * lose its real consumers either.
   */
  it('files no Conjure spell under a stat block, and keeps the ones that print one', () => {
    const statBlock = consumersOf('a-stat-block-created-mid-fight');
    expect(statBlock.blocks.filter((id) => id.startsWith('conjure-'))).toEqual([]);
    for (const id of ['unseen-servant', 'arcane-hand', 'summon-dragon', 'giant-insect']) {
      expect(statBlock.undefined, id).toContain(id);
    }
    // Guardian of Faith and Faithful Hound are the pair that proves the row was
    // read rather than copied: both are invulnerable spectral things, and only
    // one of the two is a creature — neither, as it turns out.
    expect(BLOCKED_ON['faithful-hound']).not.toContain('a-stat-block-created-mid-fight');
    expect(BLOCKED_ON['guardian-of-faith']).not.toContain('a-stat-block-created-mid-fight');
  });

  /**
   * And the smallest number the ranked map printed, which comes out one higher.
   *
   * `PROGRESS.md` ranks "Reads the target's current Hit Points | 3" and names
   * the three Power Words. Aura of Life is a fourth — "If an ally with 0 Hit
   * Points starts its turn in the aura, that ally regains 1 Hit Point" — and it
   * is in the ranked map's own population. A three-spell family counted by hand
   * was still wrong, which is the argument for deriving even the small ones.
   */
  it('finds one more than the ranked map did for reading the target’s Hit Points', () => {
    expect(consumersOf('an-outcome-that-reads-the-targets-hit-points').blocks).toEqual([
      'aura-of-life',
      'divine-word',
      'power-word-kill',
      'power-word-stun',
    ]);
  });

  /** A shape both a definition and an undefined spell name is counted once each. */
  it('adds all three populations up', () => {
    const speed = consumersOf('speed-and-movement-modes');
    expect(speed.executed).toEqual(['hypnotic-pattern', 'ray-of-frost']);
    expect(speed.tracked).toEqual(['fly', 'longstrider', 'spider-climb']);
    expect(speed.undefined.length).toBeGreaterThan(5);
    expect(speed.blocks.length).toBe(
      speed.executed.length + speed.tracked.length + speed.undefined.length,
    );
  });

  /** `unblocks` is a subset of `blocks`, and of the undefined population. */
  it('never claims to unblock a spell it does not block', () => {
    for (const row of allShapeConsumers()) {
      for (const id of row.unblocks) {
        expect(row.undefined, row.shape).toContain(id);
        expect(BLOCKED_ON[id]).toEqual([row.shape]);
      }
    }
  });

  /** Every shape is reported, heaviest first, with no gaps or repeats. */
  it('reports every shape once, ranked', () => {
    const rows = allShapeConsumers();
    expect(rows.map((row) => row.shape).sort()).toEqual(Object.keys(MISSING_SHAPES).sort());
    for (let i = 1; i < rows.length; i += 1) {
      const before = rows[i - 1]!;
      const after = rows[i]!;
      expect(
        before.unblocks.length > after.unblocks.length ||
          (before.unblocks.length === after.unblocks.length &&
            (before.blocks.length > after.blocks.length ||
              (before.blocks.length === after.blocks.length &&
                before.shape.localeCompare(after.shape) < 0))),
        `${before.shape} before ${after.shape}`,
      ).toBe(true);
    }
  });

  /**
   * The single largest blocker in the undefined population, named rather than
   * felt: fifty-odd spells cannot be cast at all because the casting takes a
   * minute or more, which `resolveCast` refuses.
   */
  it('names the largest blocker in the undefined population', () => {
    const ranked = [...allShapeConsumers()].sort((a, b) => b.blocks.length - a.blocks.length);
    expect(ranked[0]!.shape).toBe('a-long-casting-time');
    expect(ranked[0]!.blocks.length).toBeGreaterThan(40);
  });
});

describe('a spell with one blocker is the leverage the map is for', () => {
  /**
   * Magic Missile is the spell that proves the second column is worth reading,
   * and it is **not** on the list below.
   *
   * "Damage with neither an attack roll nor a save" is the clause everybody
   * quotes it for, and `PROGRESS.md` ranks that shape at 19 open spells. But
   * the darts are *distributed* — "you can direct them to hit one creature or
   * several" — and a casting that names the same target twice is refused, so
   * three darts into one goblin cannot be said at all. That is the same gap
   * Mass Heal's "divided as you choose" has, and it is not downstream of the
   * first: you meet it in the same sentence rather than after the missing
   * mechanism is built.
   *
   * **The distinction is what keeps `unblocks` honest.** Dimension Door's 4d6
   * on a failed arrival is damage with no roll too, and it is *not* a second
   * blocker, because nothing teleports — the damage is unreachable until the
   * first shape exists. A blocker you would meet anyway counts; one you could
   * only meet afterwards does not.
   */
  it('does not call Magic Missile finished by one shape', () => {
    expect(BLOCKED_ON['magic-missile']).toEqual([
      'a-spells-effects-applied-to-different-targets',
      'damage-with-neither-an-attack-roll-nor-a-save',
    ]);
    expect(BLOCKED_ON['dimension-door']).toEqual(['teleportation']);
  });

  /**
   * Spot-checks, each transcribed from the spell's own SRD paragraph, because
   * a map that nothing reads back is the prose it replaced in another costume.
   */
  const SOLE: readonly (readonly [string, ShapeId])[] = [
    // "the target's skin assumes a bark-like appearance, and the target has an
    // Armor Class of 17 if its AC is lower than that" — a floor on the total.
    ['barkskin', 'an-armor-class-a-spell-floors'],
    // "you deal an extra 1d4 Radiant damage on a hit" with weapons.
    ['divine-favor', 'a-rider-on-a-later-weapon-attack'],
    // "restoring 70 Hit Points" — the conditions it ends are `end-condition`
    // now, and the printed 70 is the whole of what is left.
    ['heal', 'a-flat-amount-with-no-dice'],
    // "Make a ranged spell attack for each ray."
    ['scorching-ray', 'several-attack-rolls-from-one-casting'],
    // "You touch a creature that has died within the last minute."
    ['revivify', 'healing-that-raises-the-dead'],
    // "Choose up to five falling creatures within range."
    ['feather-fall', 'falling'],
    // "You teleport to a location within range."
    ['dimension-door', 'teleportation'],
    // "Immunity to Psychic damage **and the Charmed condition**" — the damage
    // half is built and the condition half is not, which is the whole of what
    // is left. Stoneskin stood here until IE-017 defined it.
    ['mind-blank', 'a-condition-immunity-a-spell-grants'],
  ];

  it.each(SOLE)('%s is blocked on %s and nothing else', (spellId, shape) => {
    expect(BLOCKED_ON[spellId]).toEqual([shape]);
  });
});

describe('a shape that gets built is content work, not a merge', () => {
  /**
   * IE-014 built condition removal as `end-condition`, and eleven entries here
   * named it. Re-reading them is the work a textual rebase would have skipped:
   * the shape ends up with **no** claimants and is retired, exactly as IE-010
   * retired `outcome-scoped-child-effects`.
   *
   * What `end-condition` takes is a list of `ConditionName`, so it finishes a
   * spell that ends a printed list and no more. The four readings below are the
   * ones worth pinning, because each is a different reason:
   */
  it('has retired the shape `end-condition` solved', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('condition-removal');
    expect(claimedShapes().has('condition-removal')).toBe(false);
  });

  // Heal ends "the Blinded, Deafened, and Poisoned conditions" — a printed
  // list, so the removal is done and the flat 70 is all that is left.
  it('finishes the removal half of Heal', () => {
    expect(BLOCKED_ON['heal']).toEqual(['a-flat-amount-with-no-dice']);
  });

  // Greater Restoration removes "one of the following", and one of them is
  // "1 Exhaustion level" — a level rather than a condition, which a list of
  // condition names cannot say.
  it('keeps what a list of condition names cannot remove', () => {
    expect(BLOCKED_ON['greater-restoration']).toContain('an-exhaustion-level-a-spell-changes');
    expect(BLOCKED_ON['greater-restoration']).toContain('a-choice-made-at-the-casting');
    expect(consumersOf('an-exhaustion-level-a-spell-changes').blocks).toEqual([
      'greater-restoration',
      'wish',
    ]);
  });

  // Calm Emotions *suppresses* a condition it did not cause and restores it
  // when the spell ends, which is the granted Immunity rather than a removal.
  it('reads suppression as the granted immunity it is', () => {
    expect(BLOCKED_ON['calm-emotions']).toEqual([
      'a-condition-immunity-a-spell-grants',
      'a-spells-effects-applied-to-different-targets',
    ]);
  });

  // And the two spells IE-014 defined leave the map entirely, with their debt
  // in ADJUDICATED where an executed spell's debt belongs.
  it('moves a newly defined spell out of the map and into the adjudications', () => {
    expect(BLOCKED_ON['lesser-restoration']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-poison']).toBeUndefined();
    expect(ADJUDICATED['lesser-restoration']?.map((e) => e.why)).toEqual([
      'a-choice-made-at-the-casting',
    ]);
    // IE-014 gave this two adjudications and IE-017 built one of them away, so
    // the Resistance clause is executed and only the condition-keyed save is
    // left. Two merges, one entry, and the map says which half survived.
    expect(ADJUDICATED['protection-from-poison']?.map((e) => e.why)).toEqual([
      'a-save-keyed-to-a-condition',
    ]);
  });
});

describe('the executed and tracked maps still cover their own populations', () => {
  /**
   * The move is a move. Both maps are keyed by spell id and the populations
   * they describe are unchanged, which is what makes the diff a relocation
   * rather than a rewrite.
   */
  it('adjudicates only executed spells and tracks only tracked ones', () => {
    const defined = new Set(DEFINED_SPELL_IDS);
    for (const id of Object.keys(ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(TRACKED_ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(BLOCKED_ON)) expect(defined.has(id), id).toBe(false);
  });
});
