/**
 * The brief guard, driven over briefs built to be caught before it is run over
 * the real ones.
 *
 * A guard nobody has watched fire is a guard nobody has tested — this
 * repository's own lesson, learned from a `WHOLE_ENGINE_AUDIT_RECOMMENDED`
 * regex that demanded a backspace character and therefore matched nothing for
 * as long as it existed. So every rule below is asserted in both directions:
 * the failure, and the correction that clears it.
 *
 * **The errors these fixtures are shaped after are real**, even where the
 * fixture no longer spells them: two module paths under the fold that tranche
 * 6's briefs named and the repository never had; `commands.ts:6764`, a line
 * reference that survived the file being split; and a run attributed to
 * `CLAUDE.md` that a foreman found by hand while re-pointing tranche 7's
 * briefs, three weeks after IE-046 rewrote the paragraph it was quoting.
 * Synthetic fixtures prove the rule; these prove the rule was worth having.
 *
 * **Then the repository moved under three of them inside the same tranche**,
 * and the lesson is written into `listing`, `someModule` and `holding` below:
 * a fixture that spells a live path is a fact with an expiry date, so the
 * facts here are read off the tree and the premises are asserted rather than
 * assumed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  allBriefs,
  briefSources,
  briefsAwaitingWork,
  citationsIn,
  findings,
  namedPathsIn,
  unitsOf,
  unresolvedPathsIn,
  type Brief,
} from './brief-citations.js';
import { REPO_ROOT, containsRun, documentText, namesIn } from './citations.js';

/** A brief with only the fields the guard reads. */
const brief = (name: string, text: string): Brief => ({ name, state: 'PROPOSED', text });

/** The guard's whole report for one synthetic brief. */
const report = (text: string): readonly string[] => findings([brief('IE-000-fixture.md', text)]);

/**
 * The repository the fixtures stand on, **read rather than written down**.
 *
 * This file spelled `fold/casting` — the real tranche-6 error — until IE-050
 * created `packages/engine/src/fold/casting.ts` in the same tranche, and two
 * cases then asserted a finding that no longer happened. The same split moved
 * the docstring a third case named. A fixture that spells a live path is a
 * fact about a repository that moves under it, and this one moved twice in
 * four days.
 *
 * So the paths below are read off the directories that hold them. What would
 * break them next is a directory ceasing to exist, and `someModule` throws by
 * name rather than letting a case go quietly vacuous if that happens.
 */
const listing = (directory: string): readonly string[] => readdirSync(`${REPO_ROOT}${directory}`);

/** Some module this directory really holds, named without its extension. */
const someModule = (directory: string): string => {
  const held = listing(directory).find(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'index.ts',
  );
  if (held === undefined) throw new Error(`${directory} holds no module for a fixture to name`);
  return held.replace(/\.ts$/, '');
};

const linesIn = (path: string): number =>
  readFileSync(`${REPO_ROOT}${path}`, 'utf8').split('\n').length;

/**
 * Which file under a directory holds this run, or `undefined`.
 *
 * **A search, deliberately, and only a test may do it.** The guard resolves a
 * citation by the name the brief wrote; establishing that a sentence exists
 * *somewhere else* is the other half of the claim a finding makes, and there
 * is no way to establish it except by looking. Reading it off a path written
 * here is what broke when the file moved.
 */
const holding = (directory: string, run: string): string | undefined =>
  readdirSync(`${REPO_ROOT}${directory}`, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `${directory}/${entry.replaceAll('\\', '/')}`)
    .find((path) => containsRun(path, run));

const FOLD = 'packages/engine/src/fold';
const COMMANDS = 'packages/engine/src/commands';
const SCRIPTS = 'packages/engine/scripts';

/**
 * A name no seam module carries, whose absence the tests assert rather than
 * assume — so the day something creates it, the failure says which fixture's
 * premise went false instead of which assertion went red.
 */
const ABSENT = 'no-such-seam';

describe('a brief names paths this repository has', () => {
  /**
   * The error tranche 6 made twice: a brief named two modules under the fold
   * that were never there, and cost two launches a round of confusion each.
   *
   * The names here are not theirs. One of the two exists now — IE-050 created
   * it — which is the whole reason this fixture asserts its own premise: the
   * directory really is a directory, and really does not hold the module the
   * brief names.
   */
  it('catches a module path the repository does not have', () => {
    expect(listing(FOLD)).not.toContain(`${ABSENT}.ts`);
    const real = someModule(FOLD);
    expect(report(`Split \`fold/${ABSENT}\` the way \`fold/${real}.ts\` was split.`)).toEqual([
      `IE-000-fixture.md names \`fold/${ABSENT}\`, which is not a file this repository has`,
    ]);
    expect(report(`\`fold/${ABSENT}.ts\` gains the printed immunities.`)).toHaveLength(1);
  });

  /** And the paths that do exist pass, written any of the three ways. */
  it('resolves the shorthand this repository actually writes', () => {
    const seam = someModule(FOLD);
    expect(
      report(
        `Read \`${FOLD}/${seam}.ts\`, then \`commands/${someModule(COMMANDS)}.ts\`, ` +
          `then \`scripts/${someModule(SCRIPTS)}.ts\`; \`fold/${seam}\` is the pattern.`,
      ),
    ).toEqual([]);
  });

  /** A brace is two paths written once, and each half is checked. */
  it('expands a brace and checks both halves', () => {
    expect(namedPathsIn('`commands/{casting,turns}.ts`').map((named) => named.token)).toEqual([
      'commands/casting.ts',
      'commands/turns.ts',
    ]);
    expect(report(`\`commands/{${someModule(COMMANDS)},${ABSENT}}.ts\``)).toEqual([
      `IE-000-fixture.md names \`commands/${ABSENT}.ts\`, which is not a file this repository has`,
    ]);
  });

  /**
   * A line reference that ran past the end of its file, which is what happens
   * when `main` moves under a brief — `commands.ts:6764` against the 206 lines
   * the split left, in a brief this guard now reads.
   *
   * The fixture counts the file's lines rather than naming a number, so the
   * out-of-range reference stays out of range however the file grows, and the
   * in-range one is line 1, which every file that exists at all has.
   */
  it('catches a line reference past the end of the file it names', () => {
    const module = `${FOLD}/${someModule(FOLD)}.ts`;
    expect(report(`See \`${module}:${linesIn(module) + 1}\`.`)).toEqual([
      expect.stringContaining('the reference is stale'),
    ]);
    expect(report(`See \`${module}:1\`.`)).toEqual([]);
  });

  /**
   * **A bare file name is not checked, and the cost is stated rather than
   * hidden.** Resolving `common.ts` would mean searching the repository for a
   * file with that name, which is the one thing this guard may not do.
   */
  it('leaves a bare file name to the reader', () => {
    expect(report('`common.ts` and `QUEUE.md` and `nonesuch-file.ts` are named bare.')).toEqual([]);
  });

  /**
   * A git ref, a package specifier and a slash command all contain a slash and
   * none of them is a path.
   *
   * `/qb` is the one that was reported: read as a path its first segment is
   * empty, an empty segment resolves to the repository root, and the root is a
   * directory — so it passed the *looks like a path* test and then failed to
   * resolve. It arrived in a brief the day this guard was reviewed, which is
   * the argument for a guard that reports rather than gates.
   */
  it('is not fooled by a git ref, a package specifier or a slash command', () => {
    expect(
      report('Rebase on `origin/main`; import from `@ie/engine`; start with `/qb`.'),
    ).toEqual([]);
  });

  /** A directory is a thing a brief names, and a missing one is still wrong. */
  it('checks a directory a brief names', () => {
    expect(report(`Everything under \`${FOLD}/\` moves.`)).toEqual([]);
    expect(report(`Everything under \`${FOLD}-${ABSENT}/\` moves.`)).toHaveLength(1);
  });
});

describe('a brief quotes the document it names', () => {
  /**
   * The failure in its hardest form: the document is named, the document
   * exists, the subject is right, and nothing but opening it can tell the two
   * apart.
   */
  it('catches a run the named document does not contain', () => {
    expect(
      report('`docs/design/event-log.md` is explicit: "Events carry intents, not resolved outcomes".'),
    ).toEqual([
      expect.stringContaining('Events carry intents, not resolved outcomes'),
    ]);
  });

  /** And it passes the moment the quotation is the sentence the file prints. */
  it('passes once that quotation is corrected', () => {
    expect(
      report('`docs/design/event-log.md` is explicit: "Events carry resolved outcomes, not intents".'),
    ).toEqual([]);
  });

  /**
   * **The case that proves resolution is by naming.**
   *
   * The run is verbatim in `docs/design/casting.md` and nowhere in
   * `docs/design/event-log.md`. A guard that searched the documents it knows
   * would pass this and could never tell a citation of one from a citation of
   * the other; this one fails it, because the brief named the wrong file.
   */
  it('fails a run that is in a different document from the one the brief named', () => {
    const run = 'The engine has given every casting an identity since the first spell landed';
    expect(containsRun('docs/design/casting.md', run)).toBe(true);
    expect(containsRun('docs/design/event-log.md', run)).toBe(false);
    expect(report(`\`docs/design/event-log.md\`: "${run}".`)).toHaveLength(1);
    expect(report(`\`docs/design/casting.md\`: "${run}".`)).toEqual([]);
  });

  /**
   * **The instance this guard was built after.**
   *
   * IE-054's brief told its builder to remove a sentence from `CLAUDE.md`.
   * IE-046 had rewritten that paragraph, and the sentence the brief quoted
   * survives only as a docstring in `commands/spell-resolution.ts` — so the
   * brief named a document that does not contain its own quotation, which is
   * exactly the shape this half of the guard reports. The foreman found it by
   * hand; the instrument finds it in a run of the suite.
   */
  it('catches the stale citation a foreman found by hand', () => {
    const run =
      'outside combat there are no turns for it to be the end of, so nothing is scheduled and the caller is told';
    // The same sentence, capitalised, opens a docstring in the command layer —
    // so the brief is wrong about *where* the sentence lives, not about the
    // wording, which is the distinction resolving by naming is there to draw.
    //
    // **Which file holds it is searched for, not spelled.** It was
    // `commands/spell-resolution.ts` when this case was written and
    // `commands/spell-effect-riders.ts` four days later, because IE-051 split
    // the per-kind resolvers out of it. A test may search the tree to
    // establish a fact; the guard may not, and that difference is the point
    // this case is making. What would break it next is the sentence being
    // reworded or deleted, which is a change worth a red test.
    expect(holding('packages/engine/src', `O${run.slice(1)}`)).not.toBeUndefined();
    expect(documentText('CLAUDE.md').includes(run)).toBe(false);
    expect(
      report(`Remove the sentence "${run}" from \`CLAUDE.md\`.`),
    ).toEqual([expect.stringContaining('attributes to CLAUDE.md a run it does not contain')]);
  });

  /**
   * A brief that cites nothing passes. This is a guard on claims made, not a
   * requirement to make claims.
   */
  it('passes a brief that cites nothing', () => {
    expect(report('Rework `pendingCastingOf` so it returns every open casting.')).toEqual([]);
  });

  /** And a wholly correct brief passes, quotations, paths and all. */
  it('passes a brief that is right about everything', () => {
    expect(
      report(
        [
          '# IE-000 — A fixture task',
          '',
          'state: PROPOSED',
          '',
          'Read `docs/design/casting.md` first — "A casting already made does not',
          'change when its caster does" is the rule this rests on.',
          '',
          'The SRD sentence is in `packages/srd/raw/rules-glossary.md`: "You lose',
          'Concentration on an effect the moment you start casting a spell that',
          'requires Concentration or activate another effect that requires',
          'Concentration."',
          '',
          '`packages/engine/src/commands/casting.ts` is where it lands.',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  /**
   * A rules quotation resolves to the book, which is where the two corpora
   * part company: the shape corpus resolves `SRD` to no file at all, because
   * `spell-honesty.test.ts` holds those quotations against the spell's own
   * paragraph. A brief quoting a *rules section* has no such guard, and six of
   * tranche 6's eight errors were rules sections.
   */
  it('holds a quotation of the book against the book', () => {
    expect(
      report('SRD is explicit: "On a turn, you can expend only one spell slot to cast a spell."'),
    ).toEqual([]);
    expect(
      report('SRD is explicit: "On a turn, you can expend only two spell slots to cast a spell."'),
    ).toEqual([expect.stringContaining('the SRD under packages/srd/raw/')]);
  });

  /**
   * **And the truncation that made both of tranche 6's SRD quotations wrong.**
   *
   * `IE-038`'s brief quotes the same sentence as *"On a turn, you can expend
   * only one spell slot."*, closing it with a full stop where the book goes on
   * with "to cast a spell". The wording is the book's; the sentence is not, and
   * a quotation that stops early is how a scoping clause goes missing. The
   * guard reports it, which is the whole of what a containment test can offer
   * against the elision class it otherwise cannot see.
   */
  it('catches a quotation that closes early on a sentence the book continues', () => {
    expect(report('SRD: "On a turn, you can expend only one spell slot."')).toEqual([
      expect.stringContaining('On a turn, you can expend only one spell slot.'),
    ]);
  });

  /**
   * The floor is the shared one, and this is what it costs: a run of seven
   * characters goes unchecked even when the document does not contain it.
   */
  it('checks a run of eight characters and leaves a shorter one alone', () => {
    expect(report('`docs/design/event-log.md` says "absent!".')).toEqual([]);
    expect(report('`docs/design/event-log.md` says "absent!!".')).toHaveLength(1);
  });

  /**
   * An elision reads forwards, exactly as the shape corpus's does, because it
   * is the same function: a quotation may shorten a document but may not
   * reorder it.
   */
  it('reads an elision forwards and refuses one that runs backwards', () => {
    const forwards =
      '`docs/design/event-log.md`: "Events carry resolved outcomes, not intents ... A corrupt log is loud".';
    const backwards =
      '`docs/design/event-log.md`: "A corrupt log is loud ... Events carry resolved outcomes, not intents".';
    expect(report(forwards)).toEqual([]);
    expect(report(backwards)).toHaveLength(1);
  });

  /**
   * The unit is a paragraph, and a list item is its own unit — so a document
   * named in one bullet does not become the source of a quotation three
   * bullets later.
   */
  it('does not attribute a quotation to a document a different bullet named', () => {
    const bullets = [
      '- `docs/design/event-log.md` — the fold.',
      '- "A sentence no document in this repository prints at all."',
    ].join('\n');
    expect(unitsOf(bullets)).toHaveLength(2);
    expect(report(bullets)).toEqual([]);
  });

  /** A unit naming two documents lets a run match either, which is the cost. */
  it('accepts a run from either document a unit names', () => {
    expect(
      report(
        '`docs/design/event-log.md` and `docs/design/casting.md` both matter: ' +
          '"The engine has given every casting an identity since the first spell landed".',
      ),
    ).toEqual([]);
    expect(citationsIn('where', '`docs/design/casting.md` and `docs/design/event-log.md`: "a run".')).toEqual(
      [],
    );
  });
});

describe('the corpus and the table are derived, never listed', () => {
  /** Every document the table names is a file, and no name shadows another. */
  it('derives a table whose every entry resolves', () => {
    const sources = briefSources();
    for (const source of sources) {
      expect(source.files.length, source.label).toBeGreaterThan(0);
      for (const file of source.files) expect(documentText(file).length).toBeGreaterThan(0);
    }
    const names = sources.map((source) => source.name);
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([]);
  });

  /**
   * A derived name is matched as literal text.
   *
   * The shape corpus's table was hand-written and a dot was the only
   * metacharacter anybody would put in it. These names come from six directory
   * listings, so the escape has to cover the class rather than the one
   * character that has turned up so far — otherwise a document added one day
   * with a `+` in its name either throws or matches something else.
   */
  it('treats a name with a regular-expression metacharacter as text', () => {
    const source = { name: 'c++ (notes).md', label: 'somewhere', files: ['CLAUDE.md'] };
    expect(namesIn([source], 'see c++ (notes).md for it').map((named) => named.at)).toEqual([4]);
    expect(namesIn([source], 'see cccc notes .md for it')).toEqual([]);
  });

  /** The book is in it, and so is every design document the router lists. */
  it('carries the SRD raw files and the subsystem documents', () => {
    const labels = briefSources().flatMap((source) => source.files);
    expect(labels).toContain('packages/srd/raw/spells.md');
    expect(labels).toContain('packages/srd/raw/rules-glossary.md');
    expect(labels).toContain('docs/design/casting.md');
    expect(labels).toContain('docs/rules/srd-policy.md');
    expect(labels).toContain('CLAUDE.md');
  });

  /**
   * The corpus is the briefs a builder can still be launched from, read off
   * each brief's own `state:` line rather than a second list of which are live.
   */
  it('reads every brief that is not DONE, and no brief that is', () => {
    const awaiting = briefsAwaitingWork();
    expect(awaiting.length).toBeGreaterThan(0);
    expect(awaiting.map((entry) => entry.state)).not.toContain('DONE');
    expect(awaiting.length).toBeLessThan(allBriefs().length);
    expect(allBriefs().filter((entry) => entry.state === 'DONE').length).toBeGreaterThan(0);
  });

  /**
   * And the real thing: the guard reaches the live corpus, and every finding
   * it reports names the brief it came from.
   *
   * **What is asserted is the instrument, not today's queue.** The briefs are
   * the foreman's files and change with every merge; a test that asserted they
   * are clean would be asserting today's development state, and would go red
   * for reasons that have nothing to do with this code — which is the reason
   * `check-queue.test.ts` gives for driving the queue validator over fixtures.
   * The verdict on the real corpus is `npm run check:briefs`, which exits
   * non-zero and prints each finding for a reader to judge.
   *
   * There is a second reason, and it is the stronger one: **a brief about a
   * brief error contains that error on purpose.** IE-052's own brief names
   * `fold/casting` and `fold/creatures` in a table classifying what this guard
   * catches, and they are correctly reported — a report a reader dismisses in
   * a second and a suite cannot. Turning this into `expect(findings(corpus))
   * .toEqual([])` is a one-line change the day the foreman would rather have
   * the harder gate, and the line is written here so that the choice is one
   * edit rather than a redesign.
   */
  it('reaches the real corpus and reports findings against it by name', () => {
    const corpus = briefsAwaitingWork();
    const names = new Set(corpus.map((entry) => entry.name));
    for (const finding of findings(corpus)) {
      expect(names.has(finding.slice(0, finding.indexOf(' ')))).toBe(true);
      // A finding is a fact about one brief, so the same brief on its own
      // still produces it. A report that needed the rest of the corpus to
      // reproduce would be a report nobody could act on.
      const owner = corpus.find((entry) => finding.startsWith(entry.name));
      expect(findings(owner === undefined ? [] : [owner])).toContain(finding);
    }
  });

  /**
   * **The vacuity floor on the real corpus**, which is the half that bites.
   *
   * Both scans are regular expressions over prose, and the failure mode of a
   * regular expression is matching nothing at all — the `\b`-that-was-a-
   * backspace failure this repository has now met three times. So the briefs
   * are asserted to *contain* work for each half: paths the scan finds, and
   * quotations it attributes and checks.
   *
   * **Over every brief, not over the ones awaiting work, and not against a
   * count.** The live corpus drains: a tranche that closes leaves every brief
   * `DONE` and the population legitimately empty, so a floor asserted there
   * would go red between tranches for the best possible reason. The archive
   * only grows. And a number would be a count of today's queue — the thing
   * this repository regenerates rather than writes down — so the floor is
   * *any*, which is precisely the failure being guarded against.
   */
  it('finds work to do on the real corpus rather than looking at nothing', () => {
    const corpus = allBriefs();
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.flatMap((entry) => namedPathsIn(entry.text)).length).toBeGreaterThan(0);
    expect(corpus.flatMap((entry) => citationsIn(entry.name, entry.text)).length).toBeGreaterThan(
      0,
    );
  });

  /** A brief with no citations in it at all reports nothing, corpus or not. */
  it('reports nothing for an empty corpus', () => {
    expect(findings([])).toEqual([]);
    expect(unresolvedPathsIn('IE-000-fixture.md', 'No backticks here at all.')).toEqual([]);
  });
});

/**
 * The command, run rather than read.
 *
 * **The exit code is half of what a validator is for** — `check-queue.test.ts`
 * says so and spawns its script for exactly that reason. Deleting the
 * `process.exitCode` line leaves every assertion above green while the guard
 * silently stops gating anything, which is the quiet failure this repository
 * keeps finding. So the command is driven over a corpus built here: one brief
 * that is wrong in both halves, and one that is right.
 *
 * The one change that made this possible is the optional directory argument;
 * with none, the command is exactly what it was.
 */
describe('the command says what it found and exits on it', () => {
  const SCRIPT = fileURLToPath(new URL('./brief-citations.ts', import.meta.url));

  const run = (directory: string): { status: number | null; out: string } => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, directory], {
      encoding: 'utf8',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  /** A throwaway `tasks/` directory holding exactly these briefs. */
  const corpus = (briefs: Readonly<Record<string, string>>): string => {
    const directory = mkdtempSync(join(tmpdir(), 'IE-052-'));
    for (const [name, text] of Object.entries(briefs)) {
      writeFileSync(join(directory, name), text, 'utf8');
    }
    return directory;
  };

  const CLEAN = [
    '# IE-000 — A fixture task',
    '',
    'state: APPROVED_FOR_IMPLEMENTATION',
    '',
    '`docs/design/event-log.md` is the document: "Events carry resolved',
    'outcomes, not intents".',
    '',
  ].join('\n');

  it('exits 1 and prints every finding', () => {
    const { status, out } = run(
      corpus({
        'IE-000-fixture.md': [
          '# IE-000 — A fixture task',
          '',
          'state: APPROVED_FOR_IMPLEMENTATION',
          '',
          `Split \`fold/${ABSENT}\`, and note that \`docs/design/event-log.md\` says`,
          '"Events carry intents, not resolved outcomes".',
          '',
        ].join('\n'),
      }),
    );
    expect(status).toBe(1);
    expect(out).toContain(`\`fold/${ABSENT}\`, which is not a file this repository has`);
    expect(out).toContain('Events carry intents, not resolved outcomes');
    expect(out).toContain('1 brief awaiting work, 2 findings');
  });

  /** And exits 0 with the same summary line when the corpus is clean. */
  it('exits 0 on a corpus with nothing wrong in it', () => {
    const { status, out } = run(corpus({ 'IE-000-fixture.md': CLEAN }));
    expect(status).toBe(0);
    expect(out.trim()).toBe('1 brief awaiting work, 0 findings');
  });

  /** A closed brief is not a brief a builder can be launched from. */
  it('reads no brief the queue has closed', () => {
    const { status, out } = run(
      corpus({
        'IE-000-fixture.md': CLEAN,
        'IE-001-closed.md': [
          '# IE-001 — A closed task',
          '',
          'state: DONE',
          '',
          `It named \`fold/${ABSENT}\`, which was wrong, and the record stays wrong.`,
          '',
        ].join('\n'),
      }),
    );
    expect(status).toBe(0);
    expect(out.trim()).toBe('1 brief awaiting work, 0 findings');
  });
});
