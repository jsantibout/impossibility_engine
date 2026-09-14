/**
 * Print the fold's declaration graph, its module graph, and whether either has
 * a cycle.
 *
 * The measurement is `fold-graph-data.ts`, which has no top-level effect and
 * is what `fold-graph.test.ts` imports; this file is the entry point, and
 * everything in it is printing and an exit code. That split is
 * `coverage-data.ts` and `coverage.ts`'s, for its reason: a module that *does*
 * something when it is loaded cannot be imported by a test that wants its
 * answer, and the answer here is now part of the suite rather than something
 * somebody remembers to run.
 *
 * It prints and never writes, so it is not one of the guarded scripts in
 * `coverage-script.test.ts`'s floor.
 *
 * Run: `npx tsx packages/engine/scripts/fold-graph.ts`
 */
import { foldGraph } from './fold-graph-data.js';

const graph = foldGraph();

console.log(`sources read: ${graph.sources.join(', ')}`);
console.log(`declarations: ${graph.declarations} (${graph.values} values)`);

console.log(
  graph.declarationCycles.length === 0
    ? 'declaration graph: acyclic — no strongly connected component larger than one'
    : `declaration graph: ${graph.declarationCycles.length} CYCLE(S)`,
);
for (const cycle of graph.declarationCycles) {
  console.log(`  cycle: ${[...cycle].sort().join(' <-> ')}`);
}

if (graph.unplaced.length > 0) {
  console.log(`\nunplaced declarations (${graph.unplaced.length}): ${graph.unplaced.join(', ')}`);
}

console.log('\nmodule graph (value edges):');
for (const module of graph.modules) {
  const out = graph.moduleEdges.get(module) ?? [];
  console.log(`  ${module} -> ${out.length === 0 ? '(nothing)' : out.join(', ')}`);
}

console.log(
  graph.moduleCycles.length === 0
    ? '\nmodule graph: ACYCLIC'
    : `\nmodule graph: ${graph.moduleCycles.length} CYCLE(S)`,
);
for (const cycle of graph.moduleCycles) console.log(`  cycle: ${[...cycle].sort().join(' -> ')}`);

if (graph.misplaced.length > 0) {
  console.log(`\nmisplaced (${graph.misplaced.length}): ${graph.misplaced.join('; ')}`);
}

if (
  graph.moduleCycles.length > 0 ||
  graph.declarationCycles.length > 0 ||
  graph.unplaced.length > 0
) {
  process.exitCode = 1;
}
