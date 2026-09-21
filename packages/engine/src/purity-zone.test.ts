/**
 * The engine is pure, and this test is what holds the lint zone to that.
 *
 * `CLAUDE.md` rule 2: "`packages/engine` is pure. No `Math.random`,
 * `Date.now`, `crypto.randomUUID`, I/O, or content." Three of those are
 * `no-restricted-properties` entries in `eslint.config.js`; the fourth and
 * fifth are held by other sweeps. What nothing held was the rest of the
 * ambient world a module can reach without importing anything:
 * `performance.now()` is a clock, `new Date()` is the same clock under
 * another name, `process.env` is input nobody passed, `globalThis` is a
 * mutable bag shared with whatever else is running, `Intl` formats by the
 * host's locale, and `structuredClone` is a host builtin whose behaviour is
 * the runtime's rather than this repository's. Every one of them would let a
 * fold read something the event log does not contain — and rule 3 is that the
 * same seed and the same log fold to a byte-identical state, forever.
 *
 * The rule is written once, in the config; this proves it bites. A restricted
 * *global* in particular is easy to write and easy to get wrong — a name
 * ESLint does not resolve as a global reference is simply never reported, and
 * the rule sits there looking enforced. So each of the nine is driven through
 * ESLint over synthetic source, on the pattern `fold-import-boundary.test.ts`
 * set for the fold zone next door.
 *
 * **Tests are exempt and stay exempt.** The zone's `ignores` carves out
 * `packages/engine/**\/*.test.ts`, because a test may read a clock to time
 * something, and because the engine's own guards are tested by driving them.
 * That exemption is asserted below rather than assumed: it is the half of the
 * zone that could rot into "the rule never fires anywhere".
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The three rules the purity zone is written in, whichever one catches what. */
const RULES = new Set(['no-restricted-properties', 'no-restricted-globals', 'no-restricted-syntax']);

const eslint = new ESLint({ cwd: ROOT });

/** Lint `code` as if it were the file at `path` (relative to the repo root). */
async function refusals(path: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: join(ROOT, path) });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId !== null && RULES.has(message.ruleId))
    .map((message) => message.message);
}

/** One line of engine source, written the way a module would write it. */
const ENGINE_FILE = 'packages/engine/src/commands/combat.ts';

describe('the engine purity zone', () => {
  const impurities: readonly (readonly [string, string])[] = [
    // The three the zone has always held, so the harness itself is proven.
    ['Math.random', 'export const roll = () => Math.random();\n'],
    ['Date.now', 'export const at = () => Date.now();\n'],
    ['crypto.randomUUID', 'export const id = () => crypto.randomUUID();\n'],
    // And the six it could not see.
    ['performance.now', 'export const at = () => performance.now();\n'],
    ['process.env', 'export const mode = () => process.env.NODE_ENV;\n'],
    ['globalThis', 'export const bag = () => globalThis;\n'],
    ['Intl', 'export const fmt = () => new Intl.NumberFormat().format(1);\n'],
    ['new Date', 'export const now = () => new Date();\n'],
    ['structuredClone', 'export const copy = (x: object) => structuredClone(x);\n'],
  ];

  it.each(impurities)('refuses %s in an engine module', async (_name, code) => {
    expect(await refusals(ENGINE_FILE, code)).toHaveLength(1);
  });

  it.each(impurities)('says why, when it refuses %s', async (_name, code) => {
    const [message] = await refusals(ENGINE_FILE, code);
    // A refusal a reader cannot act on is a refusal they will disable.
    expect(message ?? '').toMatch(/engine|replay|determinis|seed|log/i);
  });

  it.each(impurities)('leaves %s alone in an engine test', async (_name, code) => {
    expect(await refusals('packages/engine/src/combat.test.ts', code)).toEqual([]);
  });

  /**
   * And the zone is the engine's, not everybody's. `packages/content` builds
   * its catalogue with scripts that read files and print reports, and the
   * tool surface stamps a campaign with the time; neither is the fold.
   */
  it.each(impurities)('leaves %s alone outside the engine', async (_name, code) => {
    expect(await refusals('packages/tools/src/campaign.ts', code)).toEqual([]);
  });

  /**
   * The one carve-out, and it is one file and one rule.
   *
   * `scripts/bench-fold.ts` reads `globalThis.__PASS__`, a profiling hook the
   * fold set while somebody was measuring it and that nothing in the tree sets
   * today. The scripts directory is not the engine — it reads the disk, prints
   * to stdout and times itself with `process.hrtime` — but excusing the
   * directory would take `Math.random` and `new Date()` off the *fixture
   * generators* that live beside it, and those two are the bans that matter
   * there. So the exemption is named, and asserted to be this narrow.
   */
  it('excuses globalThis in the benchmark, and nothing else there', async () => {
    const bench = 'packages/engine/scripts/bench-fold.ts';
    expect(await refusals(bench, 'export const bag = () => globalThis;\n')).toEqual([]);
    expect(await refusals(bench, 'export const roll = () => Math.random();\n')).toHaveLength(1);
    expect(await refusals(bench, 'export const now = () => new Date();\n')).toHaveLength(1);
  });

  it('holds every other script to the whole zone', async () => {
    const generator = 'packages/engine/scripts/make-golden-log.ts';
    expect(await refusals(generator, 'export const bag = () => globalThis;\n')).toHaveLength(1);
    expect(await refusals(generator, 'export const roll = () => Math.random();\n')).toHaveLength(1);
  });

  /**
   * The near misses, so the zone is not a word search.
   *
   * A property named like a banned one on an object that is not the banned
   * object is ordinary code — `clock.now()` reads a clock the caller passed,
   * which is exactly what the engine is supposed to do instead.
   */
  it.each([
    ['a now() on something the caller supplied', 'export const at = (clock: { now: () => number }) => clock.now();\n'],
    ['a local named Date', 'export const f = (Date: { of: () => number }) => Date.of();\n'],
    ['a field called env', 'export const m = (opts: { env: string }) => opts.env;\n'],
    ['a Date type annotation', 'export const f = (d: Date): number => d.getTime();\n'],
  ])('does not bite on %s', async (_name, code) => {
    expect(await refusals(ENGINE_FILE, code)).toEqual([]);
  });
});
