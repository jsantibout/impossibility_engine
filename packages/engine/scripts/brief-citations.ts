/**
 * A task brief, held against the repository it describes.
 *
 * Tranche 6 shipped eight foreman brief errors. Every one was caught by a
 * builder or a reviewer reading the source — defence in depth working — but
 * the rate is evidence that the *mechanically detectable* subset should fail
 * earlier than a builder's first hour. This is IE-022's citation instrument,
 * pointed at `docs/dev/tasks/*.md`.
 *
 * ### What it catches, and what it does not
 *
 * Sized against those eight, honestly, because the honest answer is smaller
 * than the headline:
 *
 * - a named module path that does not exist — **yes**, which is what
 *   `fold/casting` and `fold/creatures` were, and both are fixtures in the test
 *   beside this file;
 * - a stale `file:line` after `main` moved — **yes, weakly**: the line, not the
 *   meaning. Where it has fired is the closed briefs — `commands.ts:6764`
 *   against a file the split left at 206 lines, `coverage.ts:626` against one
 *   of 231 — and the first of those is a fixture in the test beside this file
 *   rather than a claim in prose. A count of how many a corpus carries belongs
 *   in the report, not here: it changes with every merge;
 * - a run quoted **accurately** but with its scoping words elided — **no**. The
 *   run is verbatim in the file, and no containment test can see the elision;
 * - a claim about engine state that has gone stale, and a design imprecision —
 *   **no**, and nothing here pretends otherwise.
 *
 * So this guard catches **stale and fabricated references**. It does not catch
 * the class that did the real damage, and the docstring is not going to imply
 * it does.
 *
 * ### Resolution is by naming, never by search
 *
 * Both halves resolve what the brief *actually wrote*: a path is tried against
 * three stated bases, and a quoted run is held against the documents its own
 * unit of prose names. Nothing asks whether similar wording appears somewhere
 * in the repository, because a citation is worth checking precisely because it
 * names a document somebody reviewed. That constraint is what makes the guard
 * reportable rather than a fuzzy matcher nobody can predict.
 *
 * ### Nothing here is a hand-kept list
 *
 * The corpus is a directory listing. The documents a brief may cite are four
 * more directory listings. The bases a path resolves against are three, written
 * down with their reason. There is no inventory of rules, sources or spells to
 * maintain, which was the owner's binding constraint on this task: a guard that
 * needed a hand-kept list of what a brief may cite would rot exactly as the
 * counts it exists to catch do.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  REPO_ROOT,
  misquotes,
  namesIn,
  normaliseProse,
  quotedRunsIn,
  type Citation,
  type CitedSource,
} from './citations.js';

/**
 * The briefs. Read, never written: `docs/dev/` is the foreman's.
 *
 * Every reader below takes the directory as an argument defaulting to this
 * one, for the reason `docs/dev/check-queue.mjs` grew the same argument: the
 * exit code is half of what a validator is for, and a test can only drive it
 * over a corpus it built.
 */
const TASKS = `${REPO_ROOT}docs/dev/tasks`;

/** One brief, as the guard reads it. */
export interface Brief {
  /** The file name, which is what a finding reports. */
  readonly name: string;
  /** The `state:` line's value, or `''` where a brief carries none. */
  readonly state: string;
  readonly text: string;
}

/** Every task brief in a directory, in name order, whatever its state. */
export function allBriefs(directory: string = TASKS): readonly Brief[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = readFileSync(`${directory}/${name}`, 'utf8');
      return { name, state: /^state:\s*(\S+)/m.exec(text)?.[1] ?? '', text };
    });
}

/**
 * The briefs a builder can still be launched from.
 *
 * **A closed task is a historical record, not an instruction.** Its citations
 * were true against the repository it was written against, and holding them
 * against today's is holding a document against a moved target. Run over the
 * closed briefs it reports quotation failures by the hundred, and almost every
 * one of them is a sentence that was in `CLAUDE.md` until the day its
 * architecture was extracted into `docs/design/` — true when written, and
 * untrue now through nobody's error. None of them can mislead anybody, because
 * no builder will ever be launched from a closed brief again, and rewriting
 * history to silence a guard is the opposite of what this instrument is for.
 * The command will still read them if it is pointed at them.
 *
 * The state is read off the brief's own `state:` line — the field
 * `docs/dev/check-queue.mjs` already owns and already refuses outside a closed
 * set — rather than from a second list of which briefs are live.
 */
export function briefsAwaitingWork(directory: string = TASKS): readonly Brief[] {
  return allBriefs(directory).filter((brief) => brief.state !== 'DONE');
}

const markdownIn = (dir: string): readonly string[] =>
  readdirSync(`${REPO_ROOT}${dir}`)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => `${dir}/${file}`);

/**
 * The documents a brief may cite, derived rather than listed.
 *
 * Four directory listings and the repository's root prose: a brief cites the
 * constitution, the doctrine, a design document, a rules document, an audit
 * record, or the book. Each resolves by its **file name**, which is how briefs
 * name them — `docs/design/casting.md`, or just `casting.md` inside a sentence
 * that already gave the path.
 *
 * **The SRD raw files are the one genuine extension over the shape corpus's
 * table, and the two corpora differ on purpose.** There, `SRD` carries no file
 * at all: a note that names a repository document and then quotes the book must
 * not have the book's sentence looked up in that document, and those quotations
 * already have a guard — `spell-honesty.test.ts` holds each against that
 * spell's own paragraph. Here there is no such guard to defer to. Six of the
 * eight tranche-6 errors quoted *rules sections* — Longer Casting Times, the
 * Duration forms, Ready's casting time — which no spell's paragraph contains,
 * and nothing in a brief says which spell it is talking about. So `SRD`
 * resolves to the raw files, and a run quoted from the book is held against the
 * book.
 *
 * `docs/dev/` is deliberately absent: it is the corpus, not a source. A brief
 * quoting another brief would be the foreman's prose checked against the
 * foreman's prose, which says nothing about the repository.
 */
export function briefSources(): readonly CitedSource[] {
  const prose = [
    ...markdownIn('packages/srd/raw'),
    ...readdirSync(REPO_ROOT)
      .filter((file) => file.endsWith('.md'))
      .sort(),
    ...markdownIn('docs'),
    ...markdownIn('docs/design'),
    ...markdownIn('docs/rules'),
    ...markdownIn('docs/architecture'),
  ];
  return [
    // The book, named as briefs name it. Listed first so that a more specific
    // name overlapping it — `srd-policy.md` — covers this match and wins.
    { name: 'srd', label: 'the SRD under packages/srd/raw/', files: markdownIn('packages/srd/raw') },
    ...prose.map((path) => ({
      name: path.slice(path.lastIndexOf('/') + 1),
      label: path,
      files: [path],
    })),
  ];
}

/**
 * A brief, divided into the units a citation lives in.
 *
 * A paragraph, and each item of a list its own unit because a markdown list has
 * no blank line between its items. Below that the text is normalised, which
 * unwraps it: a brief is hard-wrapped at about seventy-eight characters, so a
 * quotation and the document it names are routinely on different lines and a
 * line is never the right unit.
 */
export function unitsOf(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/))
    .map(normaliseProse)
    .filter((unit) => unit.length > 0);
}

/**
 * Every quoted run in a brief, attributed to the documents its own unit names.
 *
 * **Every document the unit names, rather than the nearest one named before
 * the run** — which is where this parts company with the shape corpus's rule,
 * and it is a considered difference rather than a drift. A missing-shape
 * description *is* one unit of prose, so "nearest preceding" and "named in this
 * note" almost coincide there. A brief is a document, and inside a paragraph of
 * ordinary English the source is named after the quotation at least as often as
 * before it: *remove the sentence "…" from `CLAUDE.md`* is the commonest
 * shape there is. Measured on the live corpus the two rules cost exactly one
 * finding each, and they are not the same finding: nearest-preceding reports a
 * run that **is** verbatim in a document the paragraph named a sentence earlier
 * — a false positive — and misses the real stale citation, which this rule
 * catches.
 *
 * What it costs, stated: a unit naming two documents lets a run match either,
 * so the guard cannot tell which of them the author meant. That is the honest
 * reading of a paragraph that names two documents and quotes one of them, and
 * it under-fires rather than guessing. A run in a unit that names no document
 * is nobody's citation and is skipped.
 */
export function citationsIn(where: string, text: string): readonly Citation[] {
  const sources = briefSources();
  const cited: Citation[] = [];
  for (const unit of unitsOf(text)) {
    const named = namesIn(sources, unit);
    // Where one name sits inside another — `srd` inside `srd-policy.md` — the
    // longer match is the one the author wrote.
    const outer = named.filter(
      (mention) =>
        !named.some(
          (other) =>
            other !== mention &&
            other.at <= mention.at &&
            other.at + other.length >= mention.at + mention.length &&
            other.length > mention.length,
        ),
    );
    const files = [...new Set(outer.flatMap((mention) => mention.files))];
    if (files.length === 0) continue;
    const source = [...new Set(outer.map((mention) => mention.source))].join(' or ');
    for (const { run } of quotedRunsIn(unit)) cited.push({ where, source, run, files });
  }
  return cited;
}

/**
 * Where a path shorthand is resolved from, and why there are three of them.
 *
 * The repository root, the engine package, and the engine's source directory —
 * because that is the shorthand this repository's prose actually uses:
 * `packages/engine/src/fold/apply.ts` in full, `scripts/missing-shapes.ts`
 * from the package, `commands/casting.ts` from `src`. Three stated bases is a
 * resolution table; trying every directory would be the corpus-wide search the
 * owner refused.
 */
const BASES = ['', 'packages/engine/', 'packages/engine/src/'];

/** A source file's extension, for the tokens that carry one. */
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/;

/** `commands/{casting,turns}.ts` is two paths written once. */
function expandBraces(token: string): readonly string[] {
  const brace = /\{([^{}]*)\}/.exec(token);
  if (brace === null) return [token];
  return (brace[1] ?? '')
    .split(',')
    .flatMap((piece) =>
      expandBraces(token.slice(0, brace.index) + piece + token.slice(brace.index + brace[0].length)),
    );
}

/** Where a token resolves, or `undefined` when the repository has no such thing. */
function resolvePath(token: string): { readonly path: string; readonly directory: boolean } | undefined {
  for (const base of BASES) {
    // A module is named with or without its extension: `fold/turns` and
    // `fold/turns.ts` are the same module and briefs write both.
    for (const candidate of [`${base}${token}`, `${base}${token}.ts`]) {
      if (!existsSync(`${REPO_ROOT}${candidate}`)) continue;
      return { path: candidate, directory: statSync(`${REPO_ROOT}${candidate}`).isDirectory() };
    }
  }
  return undefined;
}

const lines = new Map<string, number>();
const lineCount = (path: string): number => {
  const cached = lines.get(path);
  if (cached !== undefined) return cached;
  const count = readFileSync(`${REPO_ROOT}${path}`, 'utf8').split('\n').length;
  lines.set(path, count);
  return count;
};

/** A backticked path a brief names, with the line it points at if it gave one. */
export interface NamedPath {
  readonly token: string;
  readonly written: string;
  readonly line?: number;
}

/**
 * Every repository path a brief names, read off its backticks.
 *
 * **A token is a path when it contains a slash**, and either ends in a source
 * extension or begins with a directory this repository has. The second half is
 * what admits an extensionless module reference — the exact shape of two of
 * tranche 6's errors — while refusing `origin/main`, `and/or` and the package
 * specifiers `@ie/engine` and `@ie/srd`, none of which is a path at all.
 *
 * **A token that opens with a slash is not one either.** `/qb` is a slash
 * command; read as a path its first segment is empty, which resolves to the
 * repository root, so it would otherwise pass the directory test and then fail
 * to resolve — a finding about a thing that was never a reference. Every path
 * this repository's prose writes is relative.
 *
 * **A bare file name is not checked**, and that is the rule's stated cost.
 * This repository's prose says `common.ts`, `spells.md` and `QUEUE.md`
 * constantly, meaning whichever one the paragraph is about; resolving those
 * would mean searching for a file by its name, which is the one thing this
 * guard may not do. Sixty-seven paths in the live corpus carry a slash and are
 * checked; the bare names are left to the reader, as citations below the
 * quotation floor are.
 */
export function namedPathsIn(text: string): readonly NamedPath[] {
  const found: NamedPath[] = [];
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
    for (const written of expandBraces((span ?? '').trim())) {
      const shaped = /^([A-Za-z0-9_.@/-]+?)\/?(?::(\d+))?$/.exec(written);
      const token = shaped?.[1];
      if (token === undefined) continue;
      if (!token.includes('/') || token.startsWith('@') || token.startsWith('/')) continue;
      const first = token.slice(0, token.indexOf('/'));
      const looksLikeAPath =
        SOURCE_FILE.test(token) || BASES.some((base) => existsSync(`${REPO_ROOT}${base}${first}/`));
      if (!looksLikeAPath) continue;
      const at = shaped?.[2];
      found.push(at === undefined ? { token, written } : { token, written, line: Number(at) });
    }
  }
  return found;
}

/**
 * The paths a brief names that the repository does not have, and the line
 * references that run past the end of the file they name.
 *
 * A file that ends in a newline counts one line more than it prints, so the
 * range check is generous by one. It under-fires, which is the direction every
 * threshold in this guard leans.
 */
export function unresolvedPathsIn(where: string, text: string): readonly string[] {
  const found: string[] = [];
  for (const { token, written, line } of namedPathsIn(text)) {
    const resolved = resolvePath(token);
    if (resolved === undefined) {
      found.push(`${where} names \`${written}\`, which is not a file this repository has`);
      continue;
    }
    if (line === undefined || resolved.directory) continue;
    const count = lineCount(resolved.path);
    if (line > count) {
      found.push(
        `${where} names \`${written}\`, but ${resolved.path} has ${count} lines — the reference is stale`,
      );
    }
  }
  return found;
}

/** Everything wrong, in one report, for one corpus of briefs. */
export function findings(briefs: Iterable<Brief>): readonly string[] {
  const corpus = [...briefs];
  return [
    ...corpus.flatMap((brief) => unresolvedPathsIn(brief.name, brief.text)),
    ...misquotes(
      corpus.map((brief) => [brief.name, brief.text] as const),
      citationsIn,
    ),
  ];
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  // An optional directory, so the test can drive the command over a corpus it
  // built. With none, this is the live queue's briefs.
  const corpus = briefsAwaitingWork(process.argv[2] ?? TASKS);
  const reported = findings(corpus);
  for (const finding of reported) console.log(finding);
  console.log(
    `${corpus.length} brief${corpus.length === 1 ? '' : 's'} awaiting work, ` +
      `${reported.length} finding${reported.length === 1 ? '' : 's'}`,
  );
  if (reported.length > 0) process.exitCode = 1;
}
