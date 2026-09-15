/**
 * The report may not be generated from a build older than the source.
 *
 * **This was found by being bitten by it.** `npm run coverage` runs under
 * `tsx`, which resolves `@ie/content` through the package's `main` — so the
 * catalogue the report measures comes from `dist`, while `auditSpells` reads
 * `packages/srd/src/generated/spells.json` off the working tree and
 * `VERIFIED_SPELLS` is a literal in the script's own source. Run the report
 * before rebuilding and those are two different days: the run that found this
 * printed "verified but not executable" about a spell that was both, because
 * the verified list came from source and the executed list came from
 * yesterday's build. The gauntlet only misses it by luck, since `typecheck`
 * happens to run first.
 *
 * **Mtimes cannot answer this question.** The obvious check — is any source
 * newer than the oldest output — reports a package `git checkout` merely
 * touched, and `npm run typecheck` does not clear it: TypeScript compares
 * content hashes, finds the project up to date, and leaves the output
 * timestamps exactly where they were. A check whose named remedy does not work
 * is worse than no check.
 *
 * So the question is asked of the authority that owns it. `tsc -b --dry`
 * is TypeScript's own answer to "is this build current", it runs the same
 * up-to-date logic `tsc -b` runs, and it says in one line per project which
 * ones a real build would rebuild. It exits **zero** either way, which is why
 * the output is parsed rather than the status read.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MEASURED_PROJECT,
  TSC,
  dryBuild,
  refuseStaleBuild,
  staleProjects,
} from '../scripts/build-freshness.js';

/** One line of `tsc -b --dry`, as it really prints it, Windows path and all. */
const upToDate = (path: string) => `10:42:25 PM - Project '${path}' is up to date`;
const wouldBuild = (path: string) =>
  `10:42:30 PM - A non-dry build would build project '${path}'`;

describe('reading tsc’s own answer about the build', () => {
  it('names nothing when every project is up to date', () => {
    expect(
      staleProjects(
        [upToDate('/repo/packages/shared/tsconfig.json'), upToDate('/repo/packages/srd/tsconfig.json')].join(
          '\n\n',
        ),
      ),
    ).toEqual([]);
  });

  /**
   * The other direction, or the parser would be satisfied by seeing nothing —
   * which is precisely the failure it is here to prevent, since `tsc -b --dry`
   * exits zero when it would rebuild the world.
   */
  it('names the project a real build would rebuild', () => {
    expect(
      staleProjects(
        [
          upToDate('/repo/packages/shared/tsconfig.json'),
          wouldBuild('/repo/packages/content/tsconfig.json'),
        ].join('\n\n'),
      ),
    ).toEqual(['/repo/packages/content/tsconfig.json']);
  });

  it('names every stale project, not only the first', () => {
    expect(
      staleProjects(
        [
          wouldBuild('/repo/packages/engine/tsconfig.json'),
          wouldBuild('/repo/packages/content/tsconfig.json'),
        ].join('\n\n'),
      ),
    ).toEqual(['/repo/packages/engine/tsconfig.json', '/repo/packages/content/tsconfig.json']);
  });
});

describe('the refusal', () => {
  it('lets a fresh build through', () => {
    expect(() => refuseStaleBuild(upToDate('/repo/packages/content/tsconfig.json'))).not.toThrow();
  });

  /**
   * A refusal that does not say what to run is a refusal somebody works around.
   */
  it('names what is stale and what to run', () => {
    let message = '';
    try {
      refuseStaleBuild(wouldBuild('/repo/packages/content/tsconfig.json'));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('/repo/packages/content/tsconfig.json');
    expect(message).toContain('npm run typecheck');
    expect(message).toContain('COVERAGE.md');
  });
});

/**
 * The condition itself, simulated with the real compiler rather than with a
 * string that looks like its output.
 *
 * A composite project is built, a source file is then changed, and `tsc -b
 * --dry` is asked the same question the coverage script asks it. Nothing in
 * the repository is touched: the whole project lives in a temp directory, so
 * the run cannot leave the tree in a state where `npm run coverage` refuses.
 */
describe('a build that has really gone stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ie-m5-'));
  const project = join(dir, 'tsconfig.json');
  const source = join(dir, 'src', 'index.ts');

  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    project,
    JSON.stringify({
      compilerOptions: {
        composite: true,
        rootDir: 'src',
        outDir: 'dist',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
      },
      include: ['src/**/*'],
    }),
    'utf8',
  );
  writeFileSync(source, 'export const answer = 1;\n', 'utf8');

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is up to date the moment it is built', () => {
    execFileSync(process.execPath, [TSC, '-b', project], { stdio: 'pipe' });
    expect(staleProjects(dryBuild(project))).toEqual([]);
  });

  it('is reported the moment its source moves ahead of it', () => {
    writeFileSync(source, 'export const answer = 2;\n', 'utf8');
    const output = dryBuild(project);
    expect(staleProjects(output)).toHaveLength(1);
    expect(() => refuseStaleBuild(output)).toThrow(/npm run typecheck/);
  });

  /** And rebuilding is what the message says it is: the thing that clears it. */
  it('is cleared by the build the message names', () => {
    execFileSync(process.execPath, [TSC, '-b', project], { stdio: 'pipe' });
    expect(staleProjects(dryBuild(project))).toEqual([]);
  });
});

describe('what the report is measured from is what is checked', () => {
  /**
   * The script resolves `@ie/content` — and through it `@ie/engine`,
   * `@ie/srd` and `@ie/shared` — out of `dist`, and one project reference
   * graph covers all four. Asking about `packages/content` therefore asks
   * about everything the report reads, and about nothing it does not: the
   * root `tsconfig.json` would drag in `tools/llm-probe`, whose build has
   * nothing to do with this report.
   */
  it('asks about the project the catalogue is built from', () => {
    expect(MEASURED_PROJECT).toMatch(/packages[\\/]content$/);
  });

  /**
   * **The graph-walking is the load-bearing half and was only prose.**
   *
   * Asking about one project is enough *because* `tsc -b` walks its
   * references, so a `packages/content/tsconfig.json` that lost one would
   * narrow the refusal to fewer packages with every test still green — the
   * report would go back to being measurable from a stale `@ie/engine` and
   * nothing would say so. This names the four the report reads.
   *
   * Their *status* is deliberately not asserted: a developer who has edited
   * source and not rebuilt should see this pass, since the suite is not the
   * place that refusal belongs. Only that tsc considered each project.
   */
  it('walks the reference graph to every package the report reads', () => {
    const output = dryBuild();
    for (const name of ['shared', 'srd', 'engine', 'content']) {
      expect(output, name).toContain(`packages/${name}/tsconfig.json`);
    }
  });
});

// `createRequire` is how the compiler is located rather than a guessed path;
// the module under test does the same, and this asserts the two agree.
const require = createRequire(import.meta.url);
it('runs the compiler this repository installed', () => {
  expect(TSC).toBe(require.resolve('typescript/bin/tsc'));
});
