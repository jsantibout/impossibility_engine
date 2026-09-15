/**
 * Whether the build the report is measured from is current, asked of the
 * compiler that owns the question.
 *
 * **`npm run coverage` reads two different days and used to say so in prose.**
 * The script runs under `tsx`, so `@ie/content` resolves through the package's
 * `main` to `dist`; but `auditSpells` reads `packages/srd/src/generated/
 * spells.json` off the working tree, and `VERIFIED_SPELLS` is a literal in
 * `coverage-data.ts`. Run the report before rebuilding and the executed list
 * is yesterday's while the verified list is today's — which is how a report
 * came to claim a spell was "verified but not executable" when it was both,
 * and then wrote that claim into the file as a line of prose. The gauntlet
 * misses it by luck: `typecheck` happens to run first.
 *
 * **The obvious check is wrong, and wrong in the direction that teaches
 * people to ignore it.** Comparing the newest source mtime against the oldest
 * output reports a package `git checkout` merely touched — and `npm run
 * typecheck`, the remedy such a message would name, does *not* clear it:
 * TypeScript compares content hashes, finds the project up to date, and leaves
 * the output timestamps where they are. A refusal whose named fix does not
 * work is worse than no refusal.
 *
 * So the question goes to `tsc -b --dry`, which runs the same up-to-date logic
 * `tsc -b` runs and prints one line per project saying whether a real build
 * would rebuild it. It exits **zero** either way — that is the one surprise —
 * so the output is parsed rather than the exit status read.
 *
 * Importing this module writes nothing and runs no compiler: the only thing
 * that happens at top level is locating the `tsc` this repository installed,
 * which is a resolution and not a build. `build-freshness.test.ts` imports it,
 * and the sweep in `coverage-script.test.ts` holds the whole directory to the
 * no-writes half of that.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The compiler this repository installed, located rather than guessed at. */
export const TSC: string = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/**
 * The project whose build the report is measured from.
 *
 * `packages/content` references `@ie/engine`, which references `@ie/srd` and
 * `@ie/shared`, and `tsc -b` walks the reference graph — so asking about this
 * one asks about every package the report reads, and about nothing else. The
 * root `tsconfig.json` would drag in `tools/llm-probe`, whose build has
 * nothing to do with this report and whose staleness must not stop it.
 */
export const MEASURED_PROJECT: string = fileURLToPath(new URL('..', import.meta.url)).replace(
  /[\\/]$/,
  '',
);

/** `tsc -b --dry` over a project, as text. Never throws on a stale build. */
export function dryBuild(project: string = MEASURED_PROJECT): string {
  return execFileSync(process.execPath, [TSC, '-b', '--dry', project], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Every project a real build would rebuild, in the order tsc names them.
 *
 * One sentence, matched as tsc writes it: `A non-dry build would build project
 * 'C:/…/tsconfig.json'`. The complement — "is up to date" — is deliberately
 * not what is matched: a line this parser fails to recognise should read as
 * *nothing to report about a project tsc did not mention*, and an unrecognised
 * "would build" would then be silence. Both directions are driven in the test.
 */
export function staleProjects(output: string): readonly string[] {
  const found: string[] = [];
  for (const match of output.matchAll(/A non-dry build would build project '([^']+)'/g)) {
    const project = match[1];
    if (project !== undefined) found.push(project);
  }
  return found;
}

/**
 * Refuse to report from a build that is behind its source.
 *
 * Throws rather than returning a refusal value: this is a programmer's mistake
 * about how the repository is built, not a rules-legal question about a world,
 * and the only useful answer is to stop before writing anything. The message
 * names every stale project and the command that clears it, because a refusal
 * that does not say what to run is a refusal somebody works around.
 */
export function refuseStaleBuild(output: string): void {
  const stale = staleProjects(output);
  if (stale.length === 0) return;
  throw new Error(
    [
      'COVERAGE.md was not written: it would have been measured from a build older than its source.',
      'These projects would be rebuilt by a real build:',
      ...stale.map((project) => `  ${project}`),
      'Run `npm run typecheck` and then `npm run coverage` again.',
    ].join('\n'),
  );
}
