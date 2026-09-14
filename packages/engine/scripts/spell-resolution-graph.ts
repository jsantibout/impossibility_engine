/**
 * The declaration-level value graph of spell resolution, and whether a layout
 * for it is acyclic.
 *
 * This is IE-051's precondition and the evidence for the layout it chose, and
 * it is `fold-graph.ts` pointed at the other measured bottleneck. The reason
 * is the same one IE-039 wrote down: splitting a large module is only safe if
 * the pieces form a DAG, and "it compiles" is not that evidence — TypeScript
 * resolves a circular *import* happily and leaves the failure to be discovered
 * at run time, by whichever module happened to be loaded first.
 *
 * **The layout is a map from module to declaration names, and the sources are
 * read separately — so the same script answers before and after the move.**
 * Run against the unsplit `commands/spell-resolution.ts` it partitions one
 * file's declarations and reports what the module graph *would* be; run
 * against the split it reads every file in `SOURCES` that exists and reports
 * what it *is*. A precondition that could only be run after the code moved
 * would not be a precondition. It prints the list it read, so the population
 * is in the output rather than in this comment.
 *
 * **Values only.** An `interface` or a `type` is erased, so it may be imported
 * in a circle with no runtime consequence whatever; a cycle among types is not
 * a cycle in anything that runs. Types are still recorded, so the layout can
 * place them and so an unplaced one is reported — and placing
 * {@link EffectContext} is the question this file was run to settle, because
 * leaving it in `spell-resolution.ts` would have had every resolver module
 * import the module that imports it.
 *
 * It prints and never writes, so it is not one of the guarded scripts in
 * `coverage-script.test.ts`'s floor.
 *
 * Run: `npx tsx packages/engine/scripts/spell-resolution-graph.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * A top-level declaration of any kind, with whether it is a value.
 *
 * `class`, `const`, `function`, `let` and `enum` are values; `interface` and
 * `type` are not. The `export` prefix is irrelevant to the graph and is simply
 * allowed for — which matters more here than it did for the fold, because the
 * move is exactly what adds it to sixteen of these names.
 */
const DECLARATION =
  /^(?:export )?(?:declare )?(?:(?:async )?function|const|let|class|interface|type|enum) (\w+)/gm;

const VALUE_KIND = /^(?:export )?(?:declare )?(?:(?:async )?function|const|let|class|enum) /;

interface Declaration {
  readonly name: string;
  readonly isValue: boolean;
  readonly body: string;
}

/**
 * Comments and quoted strings blanked, offsets preserved.
 *
 * Without this the walk reads prose, and this file's prose is dense with the
 * names of its own functions: every resolver's docstring names the ones it is
 * "the same shape as", and `EffectContext`'s names `resolveTeleportEffect`
 * outright. Under a bare word-boundary match those are edges, and a spurious
 * edge is the one direction that turns an acyclic answer into a cyclic one.
 *
 * It is sound to remove: a value reference cannot live inside a comment or a
 * quoted string, so blanking them can only delete edges that were never real.
 * Each character becomes a space rather than vanishing, so every line number
 * and every `^`-anchored declaration match is exactly where it was. Template
 * literals are deliberately left alone — `${…}` holds real code, and losing an
 * edge is the one direction that could hide a cycle.
 */
const withoutProse = (source: string): string => {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank);
};

const declarationsIn = (raw: string): readonly Declaration[] => {
  const source = withoutProse(raw);
  DECLARATION.lastIndex = 0;
  const found: { name: string; isValue: boolean; at: number }[] = [];
  for (let m = DECLARATION.exec(source); m !== null; m = DECLARATION.exec(source)) {
    found.push({ name: m[1]!, isValue: VALUE_KIND.test(m[0]!), at: m.index });
  }
  return found.map((entry, i) => ({
    name: entry.name,
    isValue: entry.isValue,
    body: source.slice(entry.at, found[i + 1]?.at ?? source.length),
  }));
};

/**
 * Which declarations a body mentions, other than itself.
 *
 * Word-boundary matching on the name, over a body `withoutProse` has already
 * blanked the comments and quoted strings out of — so a name in a docstring is
 * **not** an edge, which is the whole reason that function exists.
 *
 * What remains still over-reports rather than under-reporting: a name in a
 * template literal counts, and so does one in a type position the value graph
 * does not care about. That is the safe direction for a guard whose failure
 * mode is a missed cycle — a spurious edge can only turn an acyclic answer
 * into a cyclic one, never the other way round.
 */
const mentions = (body: string, names: readonly string[], self: string): readonly string[] =>
  names.filter((name) => name !== self && new RegExp(`\\b${name}\\b`).test(body));

/**
 * The layout: which module each declaration belongs to.
 *
 * `spell-effect-context.ts` holds only types, so it contributes no value edges
 * at all; it is in the layout so that the two types are *placed* rather than
 * reported unplaced, and so the module list below is the whole population.
 */
const LAYOUT: Readonly<Record<string, readonly string[]>> = JSON.parse(
  readFileSync(new URL('./spell-resolution-layout.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, readonly string[]>>;

/**
 * Wherever a declaration currently lives — one file before the move, nine
 * after. Filtered by what exists, which is what lets the same script answer
 * both.
 */
const SOURCES = [
  'commands/spell-resolution.ts',
  'commands/spell-effect-context.ts',
  'commands/spell-effect-riders.ts',
  'commands/spell-effect-rolls.ts',
  'commands/spell-effect-grants.ts',
  'commands/spell-effect-hit-points.ts',
  'commands/spell-effect-conditions.ts',
  'commands/spell-effect-magic.ts',
  'commands/spell-effect-teleport.ts',
].filter((file) => existsSync(`${SRC}${file}`));

/** Tarjan, over whichever graph it is handed. */
const stronglyConnected = (
  nodes: readonly string[],
  edgesOf: (node: string) => readonly string[],
): readonly (readonly string[])[] => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let next = 0;

  const strongConnect = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const to of edgesOf(node)) {
      if (!index.has(to)) {
        strongConnect(to);
        low.set(node, Math.min(low.get(node)!, low.get(to)!));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node)!, index.get(to)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      for (;;) {
        const popped = stack.pop()!;
        onStack.delete(popped);
        component.push(popped);
        if (popped === node) break;
      }
      components.push(component);
    }
  };

  for (const node of nodes) if (!index.has(node)) strongConnect(node);
  return components;
};

const declarations = SOURCES.flatMap((file) =>
  declarationsIn(readFileSync(`${SRC}${file}`, 'utf8')).map((d) => ({ ...d, file })),
);
const byName = new Map(declarations.map((d) => [d.name, d]));
const names = declarations.map((d) => d.name);

const MODULES = Object.keys(LAYOUT);
const moduleOf = (name: string): string | null =>
  Object.entries(LAYOUT).find(([, held]) => held.includes(name))?.[0] ?? null;

const edges = new Map<string, readonly string[]>(
  declarations.map((d) => [d.name, mentions(d.body, names, d.name)]),
);

const values = declarations.filter((d) => d.isValue).map((d) => d.name);
const valueEdges = (name: string): readonly string[] =>
  (edges.get(name) ?? []).filter((to) => byName.get(to)!.isValue);

console.log(`sources read: ${SOURCES.join(', ')}`);
console.log(`declarations: ${declarations.length} (${values.length} values)`);

const declarationCycles = stronglyConnected(values, valueEdges).filter((c) => c.length > 1);
console.log(
  declarationCycles.length === 0
    ? 'declaration graph: acyclic — no strongly connected component larger than one'
    : `declaration graph: ${declarationCycles.length} CYCLE(S)`,
);
for (const cycle of declarationCycles) console.log(`  cycle: ${[...cycle].sort().join(' <-> ')}`);

const unplaced = declarations.filter((d) => moduleOf(d.name) === null);
if (unplaced.length > 0) {
  console.log(
    `\nunplaced declarations (${unplaced.length}): ${unplaced.map((d) => d.name).join(', ')}`,
  );
}

/** The module graph, over value edges only, since a type edge is erased. */
const moduleEdges = new Map<string, Set<string>>(MODULES.map((m) => [m, new Set<string>()]));
for (const d of declarations) {
  const from = moduleOf(d.name);
  if (from === null || !d.isValue) continue;
  for (const to of edges.get(d.name) ?? []) {
    const target = byName.get(to)!;
    const into = moduleOf(to);
    if (!target.isValue || into === null || into === from) continue;
    moduleEdges.get(from)!.add(into);
  }
}

console.log('\nmodule graph (value edges):');
for (const module of MODULES) {
  const out = [...moduleEdges.get(module)!].sort();
  console.log(`  ${module} -> ${out.length === 0 ? '(nothing)' : out.join(', ')}`);
}

const moduleCycles = stronglyConnected(MODULES, (m) => [...moduleEdges.get(m)!]).filter(
  (c) => c.length > 1,
);
console.log(
  moduleCycles.length === 0
    ? '\nmodule graph: ACYCLIC'
    : `\nmodule graph: ${moduleCycles.length} CYCLE(S)`,
);
for (const cycle of moduleCycles) console.log(`  cycle: ${[...cycle].sort().join(' -> ')}`);

const misplaced = declarations.filter(
  (d) => moduleOf(d.name) !== null && SOURCES.length > 1 && moduleOf(d.name) !== d.file,
);
if (misplaced.length > 0) {
  console.log(
    `\nmisplaced (${misplaced.length}): ${misplaced
      .map((d) => `${d.name} is in ${d.file}, layout says ${moduleOf(d.name)}`)
      .join('; ')}`,
  );
}

if (moduleCycles.length > 0 || declarationCycles.length > 0 || unplaced.length > 0) {
  process.exitCode = 1;
}
