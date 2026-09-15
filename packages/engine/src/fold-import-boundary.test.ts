/**
 * The fold has one door, and this test is what holds it shut.
 *
 * `events.ts` re-exports `./fold/index.js`; nothing else outside
 * `packages/engine/src/fold/` may import a fold module. That sentence used to
 * live only in a comment, which meant a reviewer had to catch a violation by
 * reading it. It is now a `no-restricted-imports` zone in `eslint.config.js`,
 * and what follows runs ESLint over source text to prove the zone bites where
 * it should and stays quiet where it should not.
 *
 * Test files are deliberately exempt. Today a dozen of them reach into
 * `fold/release.js` for `spellOn`, and `fold-partition.test.ts` imports each
 * seam's event list one by one — that is the whole of what it proves. The
 * alternative is to publish those helpers through the barrel, which would make
 * them part of `@ie/engine` to buy a lint rule, exactly the trade the comment
 * in `events.ts` argues against. The zone governs the shipped import graph.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RULE = 'no-restricted-imports';

const eslint = new ESLint({ cwd: ROOT });

/** Lint `code` as if it were the file at `path` (relative to the repo root). */
async function restrictedImports(path: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: join(ROOT, path) });
  return results
    .flatMap((result) => result.messages)
    .filter((m) => m.ruleId === RULE)
    .map((m) => m.message);
}

describe('the fold/* import zone', () => {
  it('refuses a fold import from a command', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/commands/combat.ts',
      "import { applyEvent } from '../fold/apply.js';\nexport const run = applyEvent;\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('refuses a fold import from a sibling of events.ts', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/spells.ts',
      "import { spellOn } from './fold/release.js';\nexport const on = spellOn;\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('refuses a type-only fold import', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/state.ts',
      "import type { Applying } from './fold/common.js';\nexport type A = Applying;\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('refuses a fold import from two directories down', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/commands/nested/deep.ts',
      "export { spellOn } from '../../fold/release.js';\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('says where the door is and what to do instead', async () => {
    const [message] = await restrictedImports(
      'packages/engine/src/spells.ts',
      "export { applyEvent } from './fold/apply.js';\n",
    );
    expect(message).toMatch(/events\.ts/);
    expect(message).toMatch(/fold\//);
    expect(message).toMatch(/read.*state/i);
  });

  it('allows events.ts through the barrel', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/events.ts',
      "export * from './fold/index.js';\n",
    );
    expect(messages).toEqual([]);
  });

  it('refuses events.ts reaching past the barrel', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/events.ts',
      "export * from './fold/apply.js';\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('allows a seam inside fold/ to import its siblings', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/fold/release.ts',
      "import { CorruptLogError } from './common.js';\nexport { CorruptLogError };\n",
    );
    expect(messages).toEqual([]);
  });

  it('allows a seam inside fold/ to name the directory it lives in', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/fold/apply.ts',
      "export { spellOn } from '../fold/release.js';\n",
    );
    expect(messages).toEqual([]);
  });

  it('allows a test file to reach into a seam', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/ongoing-spells.test.ts',
      "import { spellOn } from './fold/release.js';\nexport const on = spellOn;\n",
    );
    expect(messages).toEqual([]);
  });

  it('refuses a fold import from outside the engine package', async () => {
    const messages = await restrictedImports(
      'packages/content/src/spells.ts',
      "export { spellOn } from '../../engine/src/fold/release.js';\n",
    );
    expect(messages).toHaveLength(1);
  });

  it('does not bite on a path that merely starts with the letters', async () => {
    const messages = await restrictedImports(
      'packages/engine/src/spells.ts',
      "export { folded } from './folding.js';\n",
    );
    expect(messages).toEqual([]);
  });
});

describe('the tree the zone was written for', () => {
  /**
   * The premise, checked rather than asserted: outside `fold/` and outside the
   * tests, `events.ts`'s barrel re-export is the only importer of a fold
   * module. If that stops being true the zone starts failing `npm run lint`,
   * and this test says which file to look at first.
   */
  it('has exactly one non-test importer of fold/*, and it imports the barrel', () => {
    const src = join(ROOT, 'packages/engine/src');
    const sources = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .map((entry) => entry.replace(/\\/g, '/'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.endsWith('.test.ts') && !file.startsWith('fold/'));

    const importers = sources.flatMap((file) =>
      [...readFileSync(join(src, file), 'utf8').matchAll(/from '([^']*fold\/[^']*)'/g)].map(
        (match) => `${file} -> ${match[1]}`,
      ),
    );

    expect(importers).toEqual(['events.ts -> ./fold/index.js']);
  });
});
