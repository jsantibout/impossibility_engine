/**
 * A script under `packages/engine/scripts/` may be imported, so it must not
 * write when it is.
 *
 * **The instrument this guards was broken, and it was broken silently.**
 * `coverage.ts` called `writeFileSync('COVERAGE.md', ...)` at module top
 * level, and two test files import that module for its data — so running the
 * suite regenerated the file the gauntlet then diffs. `git diff --exit-code
 * COVERAGE.md` therefore asserted that the suite had run, not that the
 * committed report was right, and every merge record claiming the file was
 * byte-clean was true for the wrong reason.
 *
 * Nothing downstream was wrong when this was found. That is the point: the
 * check that would have said so was not running.
 *
 * So the rule is structural rather than remembered — **every `writeFileSync`
 * in that directory sits lexically inside its module's main-module guard** —
 * and it is read off the source by the compiler rather than by a regex, so a
 * call nested inside a function, a branch or a callback is seen exactly as
 * written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The one spelling of the guard, asserted byte for byte rather than matched
 * loosely.
 *
 * A looser reading — "the condition mentions `import.meta.url`" — would accept
 * `const isMainModule = true`, which passes every source-level check and
 * breaks nothing until `npm run coverage` silently stops writing. One exact
 * line, proven in both directions against a synthetic module below, is what
 * makes the source sweep mean something.
 */
const GUARD = "const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;";

/**
 * Every scripts directory the packages keep. The rule is about anything a
 * test may import, and both hold scripts a test imports.
 */
const SCRIPT_DIRS = [
  fileURLToPath(new URL('../scripts/', import.meta.url)),
  fileURLToPath(new URL('../../engine/scripts/', import.meta.url)),
];

/**
 * Every script, whatever it is written in.
 *
 * `.ts` alone would have been the population this directory happens to hold
 * today, not the population the rule is about — and `packages/srd/scripts`
 * carries a `.mjs`, so that is a file type this repository uses rather than a
 * hypothetical one. A script Node can run is a script that can be imported.
 */
const SCRIPTS_RE = /\.(?:[cm]?ts|[cm]?js)$/;

/**
 * A test beside a script is an **entry point**, not a library, so the rule is
 * not about it.
 *
 * Vitest runs a test file the way Node runs a script: nothing imports it for
 * its exports, and it may legitimately write — `check-queue.test.ts` builds
 * throwaway `docs/dev` fixtures so it can drive the real validator, and **this
 * very file** writes a synthetic module into a temp directory below. What the
 * guard exists to catch is a module something imports *for its data* that
 * writes while being imported, which is what `coverage.ts` was.
 *
 * The exclusion is checked rather than asserted: the repository's own
 * definition of a test file in this directory is a vitest `include` glob, and
 * the test below holds that glob against this predicate. If that glob ever
 * goes, these files stop being entry points and the reason here is void.
 *
 * The failure direction is safe. If this predicate stopped matching, tests
 * would rejoin the population and — because tests write — the sweep would go
 * **red** rather than quiet.
 */
const TEST_RE = /\.test\.(?:[cm]?ts|[cm]?js)$/;

const isScript = (file: string): boolean => SCRIPTS_RE.test(file) && !TEST_RE.test(file);

const SCRIPT_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  SCRIPT_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter(isScript)
      .map((file) => [file, readFileSync(`${dir}${file}`, 'utf8')]),
  ),
);

/**
 * The scripts that write, named once and read by two assertions.
 *
 * This is the vacuity floor, and it replaced a full inventory of the
 * directory. An inventory fails when somebody adds a file the rule has nothing
 * to say about — which is exactly what happened — and a hand-kept list of
 * files is the shape this repository keeps finding wrong. What a floor has to
 * do is fail when the population **empties**: a wrong directory, a filter too
 * narrow, or an exclusion too broad all take these three out of it.
 */
const WRITING_SCRIPTS = [
  'coverage.ts',
  'ledger.ts',
  'make-golden-log-2.ts',
  'make-golden-log.ts',
];

/** A call to `writeFileSync`, however it was imported or reached. */
const isWrite = (node: ts.Node): boolean =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === 'writeFileSync') ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'writeFileSync'));

/** An `if` whose condition is exactly the guard's identifier. */
const isGuard = (node: ts.Node): node is ts.IfStatement =>
  ts.isIfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === 'isMainModule';

/**
 * Every `writeFileSync` a source performs outside its main-module guard, as
 * `file:line`.
 *
 * Lexical containment, deliberately: a write inside a function that the guard
 * happens to call is reported, because whether that function is *only* called
 * from there is not a question a source sweep can answer, and the answer stops
 * being yes the first time somebody exports it.
 */
export const unguardedWrites = (
  sources: Readonly<Record<string, string>>,
): readonly string[] => {
  const found: string[] = [];
  for (const [name, source] of Object.entries(sources)) {
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true);
    const visit = (node: ts.Node, guarded: boolean): void => {
      if (!guarded && isWrite(node)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push(`${name}:${line + 1}`);
      }
      if (isGuard(node)) {
        visit(node.thenStatement, true);
        if (node.elseStatement !== undefined) visit(node.elseStatement, guarded);
        return;
      }
      ts.forEachChild(node, (child) => visit(child, guarded));
    };
    visit(file, false);
  }
  return found.sort();
};

/** Sources that guard a write, so the guard's own spelling can be held to one. */
const guarding = (sources: Readonly<Record<string, string>>): readonly string[] =>
  Object.entries(sources)
    .filter(([, source]) => /\bisMainModule\b/.test(source))
    .map(([name]) => name)
    .sort();

describe('the sweep sees what it claims to see', () => {
  /**
   * Driven over a source it must catch, so the analysis cannot quietly stop
   * seeing anything — the standing rule for every derived sweep here.
   */
  it('catches a synthetic write at module top level', () => {
    expect(
      unguardedWrites({
        'synthetic.ts': "import { writeFileSync } from 'node:fs';\nwriteFileSync('x', 'y');\n",
      }),
    ).toEqual(['synthetic.ts:2']);
  });

  /**
   * The other direction, or the sweep would be satisfied by reporting
   * everything.
   */
  it('passes a synthetic write inside the guard', () => {
    expect(
      unguardedWrites({
        'synthetic.ts': `${GUARD}\nif (isMainModule) {\n  writeFileSync('x', 'y');\n}\n`,
      }),
    ).toEqual([]);
  });

  /**
   * Which is why `coverage.ts` writes *in* the guard block rather than in a
   * `main()` the guard calls: the second is indistinguishable, to any reader
   * and to this sweep, from a helper anything else could call too.
   */
  it('catches a write in a function the guard calls', () => {
    expect(
      unguardedWrites({
        'synthetic.ts': `function main() {\n  writeFileSync('x', 'y');\n}\n${GUARD}\nif (isMainModule) main();\n`,
      }),
    ).toEqual(['synthetic.ts:2']);
  });

  /** A nested call is reached, so a write in a callback cannot hide. */
  it('catches a write nested in a callback', () => {
    expect(
      unguardedWrites({
        'synthetic.ts': "['a'].forEach((f) => {\n  writeFileSync(f, 'y');\n});\n",
      }),
    ).toEqual(['synthetic.ts:2']);
  });

  /** A write reached through a namespace import is the same write. */
  it('catches a write through a namespace import', () => {
    expect(
      unguardedWrites({ 'synthetic.ts': "import * as fs from 'node:fs';\nfs.writeFileSync('x', 'y');\n" }),
    ).toEqual(['synthetic.ts:2']);
  });

  /**
   * A script Node can run is a script that can be imported, whatever it is
   * written in — so the analysis is held to a `.mjs` as well, which is the
   * file type the sibling `packages/srd/scripts` actually uses.
   */
  it('catches a write in a script that is not TypeScript', () => {
    expect(
      unguardedWrites({
        'synthetic.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync('x', 'y');\n",
      }),
    ).toEqual(['synthetic.mjs:2']);
  });

  /**
   * And the *filter* reaches those files, which the directory cannot show
   * while it happens to hold only `.ts`.
   */
  it('sweeps every extension a script can be written in', () => {
    for (const name of ['a.ts', 'a.mts', 'a.cts', 'a.js', 'a.mjs', 'a.cjs']) {
      expect(isScript(name)).toBe(true);
    }
    for (const name of ['a.json', 'a.md', 'a.tsx.snap', 'ats']) {
      expect(isScript(name)).toBe(false);
    }
  });

  /** A test beside a script is an entry point, so it is not in the population. */
  it('excludes a test, whatever it is written in', () => {
    for (const name of ['a.test.ts', 'a.test.mts', 'a.test.js', 'a.test.mjs']) {
      expect(isScript(name)).toBe(false);
    }
    expect(isScript('latest.ts')).toBe(true);
  });
});

describe('the population is every script and no test', () => {
  /**
   * The reason the exclusion rests on, checked against the file that decides
   * it rather than taken on this test's word.
   *
   * A test in this directory is something **vitest runs**, which is why it is
   * an entry point rather than a library. Delete that glob and these files are
   * collected by nothing, at which point the sentence above is no longer true
   * and this fails rather than going quiet.
   */
  it('is a directory vitest collects tests from', () => {
    const config = readFileSync(fileURLToPath(new URL('../../../vitest.config.ts', import.meta.url)), 'utf8');
    expect(config).toContain("'packages/*/scripts/**/*.test.ts'");
  });

  /**
   * The vacuity floor. Not an inventory: a new script with an unguarded write
   * fails the sweep itself, and a new script *without* one should fail
   * nothing — which is the whole reason the full listing this replaced was
   * wrong, since it failed for two test files the rule has nothing to say
   * about.
   */
  it('holds every script that writes', () => {
    expect(Object.keys(SCRIPT_SOURCE)).toEqual(expect.arrayContaining(WRITING_SCRIPTS));
    for (const name of WRITING_SCRIPTS) expect(SCRIPT_SOURCE[name]).toContain('writeFileSync(');
  });

  /** And nothing the rule is not about. */
  it('holds no test', () => {
    expect(Object.keys(SCRIPT_SOURCE).filter((file) => TEST_RE.test(file))).toEqual([]);
  });

  /**
   * The exclusion is exercised by the real directory rather than only by the
   * synthetic names above — so if these files move away, this says so instead
   * of leaving a predicate nothing reaches.
   */
  it('excludes the tests the directory actually holds', () => {
    const excluded = SCRIPT_DIRS.flatMap((dir) => readdirSync(dir)).filter(
      (file) => !isScript(file) && SCRIPTS_RE.test(file),
    );
    expect(excluded.length).toBeGreaterThan(0);
    for (const file of excluded) expect(TEST_RE.test(file)).toBe(true);
  });
});

describe('no script writes at import time', () => {
  /**
   * The whole point. A script that writes when it is imported turns any test
   * that wants its data into a generator, and the artefact the gauntlet diffs
   * is repaired by the very run that was meant to check it.
   */
  it('leaves no write outside a main-module guard', () => {
    expect(unguardedWrites(SCRIPT_SOURCE)).toEqual([]);
  });

  /**
   * One idiom, spelled one way. The behavioural test below proves *that*
   * spelling works in both directions; a second spelling would be a second
   * thing to be wrong.
   *
   * **Every script that writes carries the guard; not every script that
   * carries it writes.** It asserted equality until `brief-citations.ts`
   * arrived, which prints a report and sets an exit code when Node runs it and
   * must do neither when a test imports it for its functions. That is the same
   * hazard in a different currency, and the same line answers it — so the rule
   * is *writes implies guarded*, and the converse was a stronger claim than
   * the rule ever made.
   */
  it('spells the guard identically in every script that has one', () => {
    const guards = guarding(SCRIPT_SOURCE);
    expect(guards).toEqual(expect.arrayContaining(WRITING_SCRIPTS));
    for (const name of guards) expect(SCRIPT_SOURCE[name]).toContain(GUARD);
  });
});

/**
 * The guard is the load-bearing half of this task, so it is executed rather
 * than read: a module carrying exactly the line above writes when Node is
 * asked to run it and writes nothing when something imports it.
 *
 * A synthetic module rather than `coverage.ts` itself, because the positive
 * direction means *actually writing* — and the only honest positive control on
 * the real script is the gauntlet's own `npm run coverage` followed by
 * `git diff --exit-code COVERAGE.md`, which runs every time and would fail
 * loudly if the guard never fired.
 */
describe('the guard idiom itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ie-021-'));
  const script = join(dir, 'writer.mjs');
  const out = join(dir, 'written.txt');
  const importer = join(dir, 'importer.mjs');

  writeFileSync(
    script,
    [
      "import { writeFileSync } from 'node:fs';",
      "import { pathToFileURL } from 'node:url';",
      GUARD,
      'if (isMainModule) {',
      `  writeFileSync(${JSON.stringify(out)}, 'written', 'utf8');`,
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(importer, `import ${JSON.stringify(pathToPosix(script))};\n`, 'utf8');

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes when Node is asked to run it', () => {
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    expect(existsSync(out)).toBe(true);
    rmSync(out, { force: true });
  });

  it('writes nothing when it is imported', () => {
    execFileSync(process.execPath, [importer], { stdio: 'pipe' });
    expect(existsSync(out)).toBe(false);
  });
});

/** A Windows path as a module specifier an `import` statement can carry. */
function pathToPosix(path: string): string {
  return `file:///${path.replace(/\\/g, '/')}`;
}

/**
 * **A refusal after the write is not a refusal.**
 *
 * `npm run coverage` stops for two things: a build older than the source it
 * would be measured from, and a measurement that contradicts itself. Both are
 * reasons the file should not exist, so both have to happen before it is
 * written — a check that threw afterwards would leave the wrong report on disk
 * and the gauntlet's `git diff --exit-code COVERAGE.md` would then report the
 * damage as a change to commit.
 *
 * Read off the source in the same lexical way the sweep above reads writes,
 * because the order of statements in a block is exactly what the compiler can
 * see and a comment cannot promise.
 */
describe('nothing is written before the report is known to be worth writing', () => {
  /** The statements of `coverage.ts`'s main-module block, in order. */
  const guardBlock = (): readonly ts.Statement[] => {
    const source = SCRIPT_SOURCE['coverage.ts'] ?? '';
    const file = ts.createSourceFile('coverage.ts', source, ts.ScriptTarget.ESNext, true);
    for (const statement of file.statements) {
      if (!isGuard(statement)) continue;
      const { thenStatement } = statement;
      if (ts.isBlock(thenStatement)) return [...thenStatement.statements];
    }
    throw new Error('coverage.ts has no main-module guard block');
  };

  /** The index of the first statement whose subtree mentions `name`. */
  const firstMentioning = (statements: readonly ts.Statement[], name: string): number => {
    const mentions = (node: ts.Node): boolean =>
      (ts.isIdentifier(node) && node.text === name) ||
      ts.forEachChild(node, mentions) === true;
    return statements.findIndex(mentions);
  };

  it('refuses a stale build, a contradiction, and only then writes', () => {
    const statements = guardBlock();
    const stale = firstMentioning(statements, 'refuseStaleBuild');
    const contradiction = firstMentioning(statements, 'coverageInconsistencies');
    const write = firstMentioning(statements, 'writeFileSync');

    expect(stale, 'coverage.ts does not refuse a stale build').toBeGreaterThanOrEqual(0);
    expect(contradiction, 'coverage.ts does not check its own consistency').toBeGreaterThanOrEqual(
      0,
    );
    expect(write, 'coverage.ts writes nothing').toBeGreaterThanOrEqual(0);
    expect(stale).toBeLessThan(write);
    expect(contradiction).toBeLessThan(write);
  });

  /** And the reading bites, in both directions, over a block it must judge. */
  it('sees a check that happens after the write', () => {
    const file = ts.createSourceFile(
      'synthetic.ts',
      `${GUARD}\nif (isMainModule) {\n  writeFileSync('x', 'y');\n  refuseStaleBuild(dryBuild());\n}\n`,
      ts.ScriptTarget.ESNext,
      true,
    );
    const block = file.statements.find(isGuard)?.thenStatement;
    if (block === undefined || !ts.isBlock(block)) throw new Error('no guard block');
    const statements = [...block.statements];
    expect(firstMentioning(statements, 'refuseStaleBuild')).toBeGreaterThan(
      firstMentioning(statements, 'writeFileSync'),
    );
  });

  /** A name the block never mentions is reported as absent, not as first. */
  it('reports a missing check rather than passing it', () => {
    const file = ts.createSourceFile(
      'synthetic.ts',
      `${GUARD}\nif (isMainModule) {\n  writeFileSync('x', 'y');\n}\n`,
      ts.ScriptTarget.ESNext,
      true,
    );
    const block = file.statements.find(isGuard)?.thenStatement;
    if (block === undefined || !ts.isBlock(block)) throw new Error('no guard block');
    expect(firstMentioning([...block.statements], 'refuseStaleBuild')).toBe(-1);
  });
});
