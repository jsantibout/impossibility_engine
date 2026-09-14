/**
 * What a citation is made of, shared by every guard that checks one.
 *
 * IE-022 built the first of these inside `blocked-on.test.ts`: a quoted run in
 * a missing-shape description is held against the document that description
 * names, after two misquotes of `CLAUDE.md` shipped inside tranche 4 and were
 * caught by a reviewer reading rather than by a test. IE-052 points the same
 * instrument at `docs/dev/tasks/*.md`, where a brief that quotes a run the
 * file it names does not contain costs a builder a round of confusion.
 *
 * **Two corpora, one convention.** What is genuinely shared is moved here and
 * imported by both: the floor, the normalisation, the elision-aware
 * containment test, the scan for named sources and the scan for quoted runs.
 * What is *not* shared is which documents may be named and how a run is
 * attributed to one of them, because those differ per corpus and pretending
 * otherwise would be a flag argument standing in for two honest rules. Each
 * guard composes the primitives below into its own `citationsIn`, and says in
 * its own prose what its attribution rule costs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The repository root, from this file's own location rather than the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The shortest run worth holding against a document, and what the floor costs.
 *
 * Eight characters, which is `spell-honesty.test.ts`'s floor for the same job
 * on the other axis — one convention in this repository rather than two. What
 * it costs is that a shorter quotation goes unchecked, and that is the right
 * way round: `"D20 Tests"` and `"within reach"` are quoted *terms* rather than
 * citations, and a run that short is as likely to land in a document by
 * coincidence as by quotation. Measured on the shape corpus the floor is not
 * load-bearing — every citation from eight characters upward passes, and so
 * does every one from thirty upward — so it sits where it under-fires rather
 * than where it would start guessing.
 */
export const CITATION_FLOOR = 8;

/** A document a citation may name, and what that name resolves to. */
export interface CitedSource {
  /** What a citation writes, matched as it stands and case-insensitively. */
  readonly name: string;
  /** What a failure names, which for a directory of records is the directory. */
  readonly label: string;
  /** Tracked paths, repository-root relative. Empty means *resolve to nothing*. */
  readonly files: readonly string[];
}

/** A source named at a known offset in a piece of prose. */
export interface NamedSource {
  readonly at: number;
  /**
   * How many characters the name occupied.
   *
   * Carried because one table's names overlap — `srd` sits inside
   * `srd-policy.md` — and a caller that reads *every* name in a unit rather
   * than the nearest one needs to be able to drop a match another match
   * already covers.
   */
  readonly length: number;
  readonly source: string;
  readonly files: readonly string[];
}

/** A quoted run at a known offset, with its quotation marks removed. */
export interface QuotedRun {
  readonly at: number;
  readonly run: string;
}

/** One run, attributed to one document, waiting to be held against it. */
export interface Citation {
  /** The shape, the spell and clause, or the brief the run was written in. */
  readonly where: string;
  readonly source: string;
  readonly run: string;
  readonly files: readonly string[];
}

/**
 * Emphasis, smart quotes and line wrapping are typesetting; the wording is not.
 *
 * Both sides are normalised, so a citation may be typeset differently from the
 * sentence it quotes and still be that sentence. What survives is every word
 * and every mark of punctuation between them — a quotation closing with a full
 * stop where the document goes on with a colon is a different sentence, which
 * is why the citing sentence's own stop belongs *outside* the closing quote.
 */
export const normaliseProse = (text: string): string =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const documents = new Map<string, string>();

/** A tracked document, normalised and read once. */
export const documentText = (path: string): string => {
  const cached = documents.get(path);
  if (cached !== undefined) return cached;
  const text = normaliseProse(readFileSync(`${REPO_ROOT}${path}`, 'utf8'));
  documents.set(path, text);
  return text;
};

/**
 * Does the cited document contain this run, reading an elision forwards?
 *
 * A citation may elide with `...`, which this repository's prose does
 * constantly, and the parts either side must then appear **in the document's
 * order** — a quotation that reorders a document is not that document's
 * sentence. With no elision it is a plain containment test, which is the whole
 * of the behaviour.
 */
export function containsRun(path: string, run: string): boolean {
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
 * Every source this prose names, in the order the prose names them.
 *
 * A source carrying no file is returned like any other, because *naming* it is
 * what a guard needs to know: the shape corpus reads a mention of the SRD as
 * an instruction to stop attributing, and it can only do that if the mention
 * is reported. Deciding what a named source with no file means is the caller's
 * job, not this scan's.
 *
 * Where two names match at the same offset — one a substring of the other, as
 * `srd` is of `srd-policy.md` — the later entry in `sources` wins for a caller
 * that takes the last match, so a table lists the more specific name last.
 *
 * **A name is matched as literal text**, every metacharacter escaped rather
 * than only the dot. IE-022's table was hand-written and a dot was the only
 * metacharacter in it; the brief corpus derives its names from six directory
 * listings, and a file whose name carried a `+` or a `(` would otherwise
 * either throw or quietly match the wrong thing.
 */
export function namesIn(
  sources: readonly CitedSource[],
  prose: string,
): readonly NamedSource[] {
  const named: NamedSource[] = [];
  for (const { name, label, files } of sources) {
    const mark = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let found: RegExpExecArray | null;
    while ((found = mark.exec(prose)) !== null) {
      named.push({ at: found.index, length: found[0].length, source: label, files });
    }
  }
  return named.sort((a, b) => a.at - b.at);
}

/** Every double-quoted run at or above the floor, with its offset. */
export function quotedRunsIn(prose: string): readonly QuotedRun[] {
  const runs: QuotedRun[] = [];
  const quoted = new RegExp(`"[^"]{${CITATION_FLOOR},}"`, 'g');
  let found: RegExpExecArray | null;
  while ((found = quoted.exec(prose)) !== null) {
    runs.push({ at: found.index, run: found[0].slice(1, -1) });
  }
  return runs;
}

/**
 * The citations a corpus makes that the document it named does not contain.
 *
 * Parameterised over the corpus and over the attribution rule, because a guard
 * that can only be run against the data it already agrees with is not a guard:
 * every consumer drives it with a misquote built to be caught before it runs
 * it on the real thing. Every failure carries where it was written, the run,
 * and the document it was checked against, because a guard that reports only a
 * failure teaches nobody.
 */
export function misquotes(
  corpus: Iterable<readonly [string, string]>,
  attribute: (where: string, prose: string) => readonly Citation[],
): string[] {
  const found: string[] = [];
  for (const [where, prose] of corpus) {
    for (const citation of attribute(where, prose)) {
      if (citation.files.some((path) => containsRun(path, citation.run))) continue;
      found.push(
        `${citation.where} attributes to ${citation.source} a run it does not contain: "${normaliseProse(citation.run)}"`,
      );
    }
  }
  return found;
}
