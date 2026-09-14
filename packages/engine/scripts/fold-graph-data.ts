/**
 * The declaration-level value graph of the fold, and whether a layout for it
 * is acyclic — the measurement, with no top-level effect of any kind.
 *
 * This is IE-039's precondition and the evidence for the layout it chose.
 * Splitting a 5,400-line reducer is only safe if the pieces form a DAG, and
 * "it compiles" is not that evidence: TypeScript resolves a circular *import*
 * happily and leaves the failure to be discovered at run time, by whichever
 * module happened to be loaded first.
 *
 * It is the `invariants.test.ts` `DECLARATION` walk pointed at one subsystem:
 * every top-level declaration, the text that follows it up to the next one,
 * and the names that text mentions. It asks which *names* a declaration
 * mentions, not where they sit, which is all a call graph needs — and it reads
 * `const` as well as `function`, because the file already contains
 * function-valued consts (`withCombat`, `offerAnswered`) and a walk that saw
 * only one form would answer "no edge" to a shape it had simply never heard
 * of, which is what `animals.md` taught.
 *
 * **The layout is a map from module to declaration names, and the sources are
 * read separately — so the same script answers before and after the move.**
 * Run against the unsplit `events.ts` it partitions one file's declarations
 * and reports what the module graph *would* be; run against the split it reads
 * every file in `SOURCES` that exists and reports what it *is*. That is the
 * whole point: a precondition that could only be run after the code moved
 * would not be a precondition. The report carries the list it read, so the
 * population is in the output rather than in this comment.
 *
 * **Values only.** An `interface` or a `type` is erased, so it may be imported
 * in a circle with no runtime consequence whatever; a cycle among types is not
 * a cycle in anything that runs. Types are still recorded, so the layout can
 * place them and so an unplaced one is reported.
 *
 * **The measurement is here and the printing is in `fold-graph.ts`**, which is
 * the split `coverage-data.ts` and `coverage.ts` already make and for the same
 * reason: a module with a top-level effect cannot be imported by the test that
 * wants its answer. IE-050 made this drift detection part of the suite —
 * before that it ran only when somebody remembered, and its `SOURCES` was a
 * hand-kept list of modules, which is the failure this repository keeps
 * recording arriving inside the guard against it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * A top-level declaration of any kind, with whether it is a value.
 *
 * `class`, `const`, `function`, `let` and `enum` are values; `interface` and
 * `type` are not. The `export` prefix is irrelevant to the graph and is simply
 * allowed for.
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
 * Without this the walk reads prose: `releaseCasting`'s docstring says "the
 * fold", which under a bare word-boundary match is an edge from the grant
 * enumerator to `fold` — and that one spurious edge closes a circle through
 * `applyOne` and reports a cycle in a file that has none. Over-reporting is
 * the safe direction for *missing* a cycle and it is fatal for a script whose
 * whole job is to be the evidence, so the noise is removed rather than
 * tolerated.
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
 * into a cyclic one, never the other way round — and it is *cheap* here
 * because every spurious edge it can now produce is between declarations that
 * genuinely reference each other somehow.
 */
const mentions = (body: string, names: readonly string[], self: string): readonly string[] =>
  names.filter((name) => name !== self && new RegExp(`\\b${name}\\b`).test(body));

/**
 * The layout: which module each declaration belongs to, in dependency order.
 *
 * `state.ts` and `events.ts` hold only types and `initialState`, so they
 * contribute no value edges at all; the `fold/` seams are where the question
 * is. `fold/index.ts` declares nothing — it re-exports — so it is read and
 * contributes nothing rather than being named as an exception.
 */
const LAYOUT: Readonly<Record<string, readonly string[]>> = JSON.parse(
  readFileSync(new URL('./fold-layout.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, readonly string[]>>;

/**
 * Wherever a declaration currently lives — one file before the move, twenty
 * after.
 *
 * **The fold is a directory listing, not a list of names.** It was a hand-kept
 * array, which went stale the first time seams were added to it: IE-050 wrote
 * thirteen and the script kept answering about the eight it had been told
 * about, so a cycle among the new ones would have been invisible to the very
 * guard that exists to find one. `events.ts` and `state.ts` stay named because
 * they are not in that directory, and the whole thing is filtered by what
 * exists, which is what lets the same script answer before and after a move.
 */
export const SOURCES: readonly string[] = [
  'events.ts',
  'state.ts',
  ...(existsSync(`${SRC}fold/`)
    ? readdirSync(`${SRC}fold/`, { recursive: true, encoding: 'utf8' })
        .map((entry) => `fold/${entry.replace(/\\/g, '/')}`)
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .sort()
    : []),
].filter((file) => existsSync(`${SRC}${file}`));

/** Tarjan, over whichever graph it is handed. */
export const stronglyConnected = (
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

export interface FoldGraph {
  readonly sources: readonly string[];
  readonly declarations: number;
  readonly values: number;
  readonly declarationCycles: readonly (readonly string[])[];
  readonly modules: readonly string[];
  readonly moduleEdges: ReadonlyMap<string, readonly string[]>;
  readonly moduleCycles: readonly (readonly string[])[];
  readonly unplaced: readonly string[];
  readonly misplaced: readonly string[];
}

/** Read the fold as it stands and answer the layout's three questions. */
export function foldGraph(): FoldGraph {
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

  return {
    sources: SOURCES,
    declarations: declarations.length,
    values: values.length,
    declarationCycles: stronglyConnected(values, valueEdges).filter((c) => c.length > 1),
    modules: MODULES,
    moduleEdges: new Map(MODULES.map((m) => [m, [...moduleEdges.get(m)!].sort()])),
    moduleCycles: stronglyConnected(MODULES, (m) => [...moduleEdges.get(m)!]).filter(
      (c) => c.length > 1,
    ),
    unplaced: declarations.filter((d) => moduleOf(d.name) === null).map((d) => d.name),
    misplaced: declarations
      .filter((d) => moduleOf(d.name) !== null && SOURCES.length > 1 && moduleOf(d.name) !== d.file)
      .map((d) => `${d.name} is in ${d.file}, layout says ${moduleOf(d.name)!}`),
  };
}
