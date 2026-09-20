import { describe, expect, it, test } from 'vitest';
import { refuseEmptyTable } from '../../../vitest.setup.js';

/**
 * The guard that an `each` table is not empty, driven rather than trusted.
 *
 * **The gap it closes is narrow and was real.** Vitest refuses a file or a
 * suite that registers no tests, so `it.each([])` is loud while it is the only
 * thing in its `describe`. Put one ordinary test beside it — which is every
 * real case — and the empty table registers nothing, reports nothing and goes
 * green for ever. `blocked-on.test.ts` held a table of spells blocked on
 * exactly one shape, down to a single row, and says in its own comment that
 * emptying it would take the claim with it. That comment was the whole
 * enforcement.
 *
 * Two halves are checked here, because the guard has two: the **rule**, driven
 * directly over tables it should and should not refuse, and the **wiring** —
 * that the collectors this suite actually calls are the guarded ones, which no
 * amount of testing the rule would say.
 *
 * It lives in `packages/content/src` because vitest collects tests from
 * `packages/*​/src`, `packages/*​/scripts` and `tools/*​/src` and from nowhere
 * else, so a guard that belongs to the whole repository has no home of its own
 * to sit in. Nothing here is about the catalogue.
 */
describe('an empty parameterised table is refused', () => {
  it('refuses a table with no rows', () => {
    expect(() => refuseEmptyTable('it', [])).toThrow(/registers no tests/);
  });

  it('says which collector, and what the three ways out are', () => {
    expect(() => refuseEmptyTable('describe', [])).toThrow(
      /describe\.each was given an empty table/,
    );
    expect(() => refuseEmptyTable('it', [])).toThrow(/Fill the table, delete the block/);
    expect(() => refuseEmptyTable('it', [])).toThrow(/it\.skip\.each/);
  });

  it('allows a table with rows', () => {
    expect(() => refuseEmptyTable('it', [['a'], ['b']])).not.toThrow();
    expect(() => refuseEmptyTable('it', [0])).not.toThrow();
  });

  /**
   * A tagged template is the other shape `each` takes, and its
   * `TemplateStringsArray` is an array that always holds at least one string —
   * so the rule passes it for the same reason it passes any other non-empty
   * array, and needs no case of its own. Driven so that a future `length > 0`
   * becoming `length > 1` is caught.
   */
  it('allows the tagged-template form, whose strings array is never empty', () => {
    const strings = ((...args: readonly unknown[]) => args[0])`a | b`;
    expect(() => refuseEmptyTable('it', strings)).not.toThrow();
  });

  /** And anything that is not a table at all is not this guard's business. */
  it('judges only arrays', () => {
    expect(() => refuseEmptyTable('it', undefined)).not.toThrow();
    expect(() => refuseEmptyTable('it', {})).not.toThrow();
  });
});

/**
 * The wiring: the collectors this file imports are the guarded ones.
 *
 * Calling `it.each([])` inside a test body is safe precisely because the guard
 * throws *before* vitest's own collector is reached — nothing is registered,
 * and the throw is the assertion.
 */
describe('the guard is installed on the collectors the suite calls', () => {
  it('catches an empty table handed to it.each', () => {
    expect(() => it.each([])).toThrow(/it\.each was given an empty table/);
  });

  /**
   * `test` and `it` are one object in vitest today, so this is the same
   * collector under its other name. Asserted by behaviour rather than by
   * identity, so that a release which separates them would have to leave this
   * passing — the setup guards both.
   */
  it('catches an empty table handed to test.each', () => {
    expect(() => test.each([])).toThrow(/each was given an empty table/);
  });

  it('catches an empty table handed to describe.each', () => {
    expect(() => describe.each([])).toThrow(/describe\.each was given an empty table/);
  });

  it('lets a filled table through to vitest', () => {
    expect(() => it.each([['a']])).not.toThrow();
  });

  /**
   * **And `skip` keeps vitest's own.** `it.skip` hands back a collector this
   * setup never touched, which is what lets
   * `origin-and-feature-sweep.test.ts` keep the written-and-skipped assertion
   * for a breach record that is deliberately empty. A skipped table asserts
   * nothing whether it holds rows or not, so refusing it would be this guard
   * demanding a breach that does not exist.
   */
  it('leaves a skipped table alone, because a skipped table claims nothing', () => {
    expect(() => it.skip.each([])).not.toThrow();
  });
});
