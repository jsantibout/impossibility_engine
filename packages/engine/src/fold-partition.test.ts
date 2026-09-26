/**
 * Every declared event type is claimed by exactly one seam of the fold.
 *
 * **This is the half of the exhaustiveness guarantee the compiler cannot
 * make.** `applyOne` was one switch with a `never` default, and that default
 * caught exactly one thing: a member added to `GameEvent` and to no case. The
 * dispatch keeps both halves of that — each seam carries its own `never` over
 * its own narrowed union, so a type a seam *claims* and has no case for is a
 * compile error, and the `unhandledEvent` at the end of `applyOne` sees
 * whatever no guard matched, which narrows to `never` only if the seams cover
 * the union, so a type **no** seam claims is a compile error too.
 *
 * What neither can see is a type claimed **twice**. Two seams listing the same
 * type still type-check: the first guard wins, the second case is dead, and
 * the day somebody edits the dead one the fold silently keeps doing what the
 * live one says. That is a partition fact rather than a type fact, so it is
 * asserted here, derived from the union rather than from a list.
 *
 * And it is driven over synthetic input in **both** directions, because an
 * analysis proved only against a repository it already agrees with is one that
 * can quietly stop seeing anything — the lesson `invariants.test.ts` learned
 * on its own sweeps.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { GameEvent } from './events.js';
import { fold, applyEvent } from './fold/index.js';
import { initialState } from './state.js';
import { CorruptLogError } from './fold/common.js';

import { CASTING_EVENTS } from './fold/casting.js';
import { COMBAT_EVENTS } from './fold/combat.js';
import { ELSEWHERE_EVENTS } from './fold/elsewhere.js';
import { FEATURES_EVENTS } from './fold/features.js';
import { GRANTS_EVENTS } from './fold/grants.js';
import { HOLDS_EVENTS } from './fold/holds.js';
import { INVENTORY_EVENTS } from './fold/inventory.js';
import { ONGOING_EVENTS } from './fold/ongoing.js';
import { ROLLS_EVENTS } from './fold/rolls.js';
import { ROSTER_EVENTS } from './fold/roster.js';
import { SCENE_EVENTS } from './fold/scene.js';
import { TIMERS_EVENTS } from './fold/timers.js';
import { UPKEEP_EVENTS } from './fold/upkeep.js';
import { VITALS_EVENTS } from './fold/vitals.js';

const SRC = fileURLToPath(new URL('./', import.meta.url));

/** The seams, and what each one claims. */
const CLAIMS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['fold/casting.ts', CASTING_EVENTS],
  ['fold/combat.ts', COMBAT_EVENTS],
  ['fold/elsewhere.ts', ELSEWHERE_EVENTS],
  ['fold/features.ts', FEATURES_EVENTS],
  ['fold/grants.ts', GRANTS_EVENTS],
  ['fold/holds.ts', HOLDS_EVENTS],
  ['fold/inventory.ts', INVENTORY_EVENTS],
  ['fold/ongoing.ts', ONGOING_EVENTS],
  ['fold/rolls.ts', ROLLS_EVENTS],
  ['fold/roster.ts', ROSTER_EVENTS],
  ['fold/scene.ts', SCENE_EVENTS],
  ['fold/timers.ts', TIMERS_EVENTS],
  ['fold/upkeep.ts', UPKEEP_EVENTS],
  ['fold/vitals.ts', VITALS_EVENTS],
]);

/**
 * Every type the union declares, read out of the file that declares it.
 *
 * The same reading `persistence.test.ts` takes — every distinct
 * `readonly type:` literal — because it needs no cut and cannot land early.
 */
const declaredEventTypes = (): readonly string[] => {
  const source = readFileSync(`${SRC}events.ts`, 'utf8');
  const found = [...source.matchAll(/readonly type: '([a-z-]+)'/g)].map((m) => m[1]!);
  return [...new Set(found)].sort();
};

/**
 * What is wrong with a partition, in the three ways it can be wrong.
 *
 * Separate from the data it is run on, so it can be driven over input that
 * *is* wrong. A partition test that only ever sees a correct partition proves
 * that it returns an empty list, which every broken analysis also does.
 */
const partitionProblems = (
  declared: readonly string[],
  claims: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
  const claimedBy = new Map<string, string[]>();
  for (const [seam, types] of claims) {
    for (const type of types) {
      const held = claimedBy.get(type);
      if (held === undefined) claimedBy.set(type, [seam]);
      else held.push(seam);
    }
  }

  const problems: string[] = [];
  for (const type of declared) {
    const seams = claimedBy.get(type);
    if (seams === undefined) problems.push(`${type}: claimed by no seam`);
    else if (seams.length > 1) problems.push(`${type}: claimed by ${[...seams].sort().join(' and ')}`);
  }
  for (const [type, seams] of claimedBy) {
    if (!declared.includes(type)) {
      problems.push(`${type}: claimed by ${[...seams].sort().join(' and ')} but not declared`);
    }
  }
  return problems.sort();
};

describe('the fold partitions the event union', () => {
  /**
   * The population follows the code rather than this file.
   *
   * A hand-kept list of seams is the hand-kept list this repository keeps
   * finding wrong — and here it would be wrong in the dangerous direction: a
   * fourteenth seam nobody added to `CLAIMS` would have its types reported as
   * claimed by nobody, which is loud, but a seam *deleted* from `CLAIMS` while
   * its module stayed would take its types out of the exactly-one check
   * silently. So the modules that declare a claim are read off the directory
   * and held against what this file imported.
   */
  it('reads every seam the fold declares', () => {
    const declaring = readdirSync(`${SRC}fold/`, { recursive: true, encoding: 'utf8' })
      .map((entry) => `fold/${entry.replace(/\\/g, '/')}`)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => /^export const [A-Z_]+_EVENTS = \[/m.test(readFileSync(`${SRC}${file}`, 'utf8')))
      .sort();

    expect(declaring).toEqual([...CLAIMS.keys()].sort());
    // And a seam really is a set of claims, so the check below is about
    // something: an empty map satisfies "no type is claimed twice" perfectly.
    expect([...CLAIMS.values()].flat().length).toBeGreaterThan(80);
  });

  /** The whole point: exactly one seam per declared type, and no orphans. */
  it('leaves every declared type claimed exactly once', () => {
    expect(partitionProblems(declaredEventTypes(), CLAIMS)).toEqual([]);
  });

  /** And the union it read is the real one, not an early cut of it. */
  it('read a union the size of the vocabulary', () => {
    expect(declaredEventTypes().length).toBeGreaterThan(80);
    expect(declaredEventTypes()).toContain('spell-cast');
    expect(declaredEventTypes()).toContain('rolls-issued');
  });

  /**
   * Direction one: a declared type nobody claims.
   *
   * The compiler catches this today, because the `never` at the end of
   * `applyOne` stops narrowing to `never`. It is asserted here as well because
   * the two guarantees have different failure modes — a cast, a JSON log, a
   * seam list edited without the dispatch — and because a test that only
   * passes is not evidence the analysis works.
   */
  it('would find a declared type that no seam claims', () => {
    const claims = new Map([
      ['fold/a.ts', ['a-real-event']],
      ['fold/b.ts', ['another-real-event']],
    ]);
    expect(partitionProblems(['a-real-event', 'another-real-event', 'an-orphan'], claims)).toEqual([
      'an-orphan: claimed by no seam',
    ]);
  });

  /**
   * Direction two: a type two seams both claim — the one the compiler cannot
   * see, and the reason this file exists.
   */
  it('would find a type two seams both claim', () => {
    const claims = new Map([
      ['fold/a.ts', ['a-real-event', 'a-contested-event']],
      ['fold/b.ts', ['a-contested-event']],
    ]);
    expect(partitionProblems(['a-real-event', 'a-contested-event'], claims)).toEqual([
      'a-contested-event: claimed by fold/a.ts and fold/b.ts',
    ]);
  });

  /** And a seam claiming something the union never declared. */
  it('would find a claim on a type the union does not declare', () => {
    const claims = new Map([['fold/a.ts', ['a-real-event', 'a-retired-event']]]);
    expect(partitionProblems(['a-real-event'], claims)).toEqual([
      'a-retired-event: claimed by fold/a.ts but not declared',
    ]);
  });

  /** A correct partition really does come back clean, so it is not reporting everything. */
  it('finds nothing wrong with a partition that is right', () => {
    const claims = new Map([
      ['fold/a.ts', ['a-real-event']],
      ['fold/b.ts', ['another-real-event']],
    ]);
    expect(partitionProblems(['a-real-event', 'another-real-event'], claims)).toEqual([]);
  });
});

describe('an event no seam claims is loud', () => {
  /**
   * The failure this is about is not a compile error — it is a log coming back
   * from Postgres as JSON with a type somebody wrote down last season. So it
   * is driven the way that arrives: past the type system, through the public
   * fold.
   */
  const stranger = { type: 'ley-line-surged', id: 'chr:nobody' } as unknown as GameEvent;

  it('throws rather than folding the state unchanged', () => {
    expect(() => fold('seed', [stranger])).toThrow(CorruptLogError);
    expect(() => fold('seed', [stranger])).toThrow(/no rule for this event type/);
  });

  /** And at the single-event door as well, which is where a resumed session arrives. */
  it('throws from applyEvent, and leaves nothing behind', () => {
    const before = initialState('seed');
    expect(() => applyEvent(before, stranger)).toThrow(CorruptLogError);
    expect(before).toStrictEqual(initialState('seed'));
  });

  /**
   * Not vacuous: the same door folds a type a seam *does* claim. Without this
   * a dispatch that threw at everything would pass the case above.
   */
  it('folds a type a seam claims', () => {
    const state = fold('seed', [{ type: 'time-advanced', seconds: 6 } as GameEvent]);
    expect(state.elapsed).toBe(6);
    expect(state.eventCount).toBe(1);
  });
});
