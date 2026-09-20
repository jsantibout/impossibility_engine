/**
 * The engine holds no catalogue, and that includes the one it pays for on
 * import.
 *
 * `@ie/srd` exports a single entry point, and that barrel re-exports the
 * parsed SRD: every spell, every weapon, every piece of gear and — since the
 * bestiary landed — five hundred kilobytes of stat blocks in
 * `monster-index.ts`. So an engine module that imports *anything* by value
 * from `'@ie/srd'` loads the whole catalogue into every process that imports
 * the engine, whether or not that process was ever given a `Content`. Rule 4
 * says the engine holds no catalogue; this is the same rule read at import
 * time.
 *
 * The schemas are the legitimate need — `checkContent` validates a monster
 * against `MonsterSchema`, and `feature-schema.ts` reads `WEAPON_PROPERTIES`
 * — and they are not data. `packages/srd/src/schemas.ts` imports `zod` and
 * nothing else, so `@ie/srd/schemas` is a subpath the engine can hold without
 * holding a book. The two halves are both checked below: the engine reaches
 * only for the subpath, and the subpath stays a leaf.
 *
 * **Read off the compiler's own parse, never a timing.** What matters is
 * whether the import survives emit, and under `verbatimModuleSyntax` that is
 * not the same question as whether the *names* are types: `import { type
 * Weapon } from '@ie/srd'` emits `import {} from '@ie/srd'`, a side-effect
 * import that loads the catalogue and binds nothing. That exact line stood in
 * `commands/attacks.ts` and cost the engine the bestiary while reading, to a
 * regex and to a person, like a type import. A timing test would have caught
 * it and then flaked forever; this one reads the declaration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The barrel: the specifier that drags the whole parsed SRD in. */
const BARREL = '@ie/srd';

/** The subpath that is schemas and no data. */
const SCHEMAS = '@ie/srd/schemas';

const ENGINE_SRC = fileURLToPath(new URL('.', import.meta.url));
const SRD = fileURLToPath(new URL('../../srd/', import.meta.url));

/** Every non-test source file under `src`, at any depth. */
const sourcesUnder = (dir: string, prefix = ''): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourcesUnder(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [`${prefix}${entry.name}`]
        : [],
  );

const parse = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

/**
 * Every specifier the module still asks Node for once the types are stripped.
 *
 * A declaration is elided only when it is type-only at the *clause* — `import
 * type { X } from`, `export type { X } from`. Everything else survives: a
 * bare `import 'x'`, an ordinary clause whose names all happen to be types,
 * and any `import('x')` the code evaluates. The synthetic cases below prove
 * this reading in both directions rather than trusting the summary.
 */
const runtimeSpecifiers = (source: ts.SourceFile): readonly string[] => {
  const found: string[] = [];

  const literal = (node: ts.Expression | undefined): string | null =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null) found.push(specifier);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null) found.push(specifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = literal(node.arguments[0]);
      if (specifier !== null) found.push(specifier);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
};

describe('the engine does not load the SRD catalogue to be imported', () => {
  const ENGINE_FILES = sourcesUnder(ENGINE_SRC);

  it('reads an import the way the emitter does', () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ["import type { Weapon } from '@ie/srd';", []],
      ["export type { Weapon } from '@ie/srd';", []],
      // The line that cost the engine the bestiary: `verbatimModuleSyntax`
      // keeps the declaration and emits `import {} from '@ie/srd'`.
      ["import { type Weapon } from '@ie/srd';", ['@ie/srd']],
      ["import { WEAPON_PROPERTIES } from '@ie/srd';", ['@ie/srd']],
      ["import '@ie/srd';", ['@ie/srd']],
      ["export { WEAPONS } from '@ie/srd';", ['@ie/srd']],
      ["const m = await import('@ie/srd');", ['@ie/srd']],
    ];

    for (const [text, expected] of cases) {
      expect(runtimeSpecifiers(parse('synthetic.ts', text)), text).toEqual(expected);
    }
  });

  it('finds the engine sources to sweep', () => {
    // A sweep over an empty population is a green test that checks nothing.
    expect(ENGINE_FILES).toContain('content.ts');
    expect(ENGINE_FILES).toContain('feature-schema.ts');
    expect(ENGINE_FILES).toContain('commands/attacks.ts');
    expect(ENGINE_FILES.some((file) => file.endsWith('.test.ts'))).toBe(false);
  });

  it('imports nothing from the barrel at runtime', () => {
    const offenders = ENGINE_FILES.filter((file) =>
      runtimeSpecifiers(parse(file, readFileSync(`${ENGINE_SRC}${file}`, 'utf8'))).includes(BARREL),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the schemas subpath is a subpath, and it is a leaf', () => {
  it('is what `@ie/srd` publishes it as', () => {
    // The suite resolves `@ie/srd` through a vitest alias to source, so a
    // missing or misspelt export map is invisible to every other test here
    // and shows up only in a build. This is where it is read.
    const manifest: unknown = JSON.parse(readFileSync(`${SRD}package.json`, 'utf8'));
    const exported = (manifest as { exports?: Record<string, unknown> }).exports ?? {};

    expect(exported['./schemas']).toEqual({
      types: './dist/schemas.d.ts',
      default: './dist/schemas.js',
    });
  });

  it('pulls in no index and no generated data', () => {
    // Walked, not assumed: the subpath is worth having only while nothing
    // behind it reaches a catalogue, and `schemas.ts` is one relative import
    // away from every index in the package.
    const seen = new Set<string>();
    const reached: string[] = [];

    const walk = (path: string): void => {
      if (seen.has(path)) return;
      seen.add(path);
      reached.push(path.slice(SRD.length).replaceAll('\\', '/'));
      for (const specifier of runtimeSpecifiers(parse(path, readFileSync(path, 'utf8')))) {
        if (!specifier.startsWith('.')) continue;
        const resolved = fileURLToPath(
          new URL(specifier.replace(/\.js$/, '.ts'), `file:///${path.replaceAll('\\', '/')}`),
        );
        walk(resolved);
      }
    };

    walk(`${SRD}src/schemas.ts`);

    expect(reached).toEqual(['src/schemas.ts']);
  });

  it('is where the engine gets the shapes it validates against', () => {
    const uses = (file: string): readonly string[] =>
      runtimeSpecifiers(parse(file, readFileSync(`${ENGINE_SRC}${file}`, 'utf8')));

    expect(uses('content.ts')).toContain(SCHEMAS);
    expect(uses('feature-schema.ts')).toContain(SCHEMAS);
  });
});
