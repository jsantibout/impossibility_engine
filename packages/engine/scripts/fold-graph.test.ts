/**
 * The fold's layout is acyclic, and the suite is what says so.
 *
 * `fold-graph.ts` was the evidence for IE-039's seams and then ran only when
 * somebody remembered — which is the hand-kept-list failure this repository
 * keeps recording, arriving inside the guard against it: it also carried a
 * hand-kept `SOURCES`, so the thirteen seams IE-050 wrote were invisible to it
 * until that list became a directory listing. Drift detection that runs on
 * request detects drift on request.
 *
 * So the measurement moved into `fold-graph-data.ts` with no top-level effect
 * — `coverage-data.ts` and `coverage.ts`'s split, for its reason — and this
 * asks it the three questions the script prints. A cycle among the seams would
 * compile, would pass every other test, and would fail at run time in whatever
 * order the modules happened to load.
 */
import { describe, expect, it } from 'vitest';
import { SOURCES, foldGraph, stronglyConnected } from './fold-graph-data.js';

describe('the fold is a DAG', () => {
  const graph = foldGraph();

  /**
   * The population is what it reads, not what it was told. A directory listing
   * that stopped listing would make every assertion below true of nothing.
   */
  it('reads the whole fold, as a directory rather than a list', () => {
    expect(SOURCES).toContain('events.ts');
    expect(SOURCES).toContain('state.ts');
    expect(SOURCES.filter((file) => file.startsWith('fold/')).length).toBeGreaterThan(15);
    expect(SOURCES).toContain('fold/apply.ts');
    expect(SOURCES).toContain('fold/common.ts');
    expect(graph.declarations).toBeGreaterThan(100);
    expect(graph.values).toBeGreaterThan(80);
  });

  it('has no cycle among its declarations', () => {
    expect(graph.declarationCycles.map((c) => [...c].sort().join(' <-> '))).toEqual([]);
  });

  it('has no cycle among its modules', () => {
    expect(graph.moduleCycles.map((c) => [...c].sort().join(' -> '))).toEqual([]);
  });

  /**
   * And the layout is not drifting. An unplaced declaration is a name the
   * layout has never heard of; a misplaced one is a name that moved file
   * without the layout following. Both are silent until somebody runs the
   * script, which is the thing this file is about.
   */
  it('places every declaration, in the file the layout says', () => {
    expect(graph.unplaced).toEqual([]);
    expect(graph.misplaced).toEqual([]);
  });

  /**
   * The instrument bites. Tarjan reporting nothing is what a correct answer
   * and a broken walk look like from here, so it is shown a cycle it must
   * find and a chain it must not.
   */
  it('finds a cycle when there is one, and none when there is not', () => {
    const cyclic = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
      ['d', ['a']],
    ]);
    const found = stronglyConnected([...cyclic.keys()], (n) => cyclic.get(n) ?? []).filter(
      (c) => c.length > 1,
    );
    expect(found.map((c) => [...c].sort().join(''))).toEqual(['abc']);

    const chain = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    expect(
      stronglyConnected([...chain.keys()], (n) => chain.get(n) ?? []).filter((c) => c.length > 1),
    ).toEqual([]);
  });
});
