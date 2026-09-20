/**
 * The suite's own guard: a parameterised table that is empty asserts nothing.
 *
 * **`it.each([])` registers no tests and goes green for ever.** Vitest refuses
 * a *file* or a *suite* with no tests at all, so an empty table is loud while
 * it is the only thing in its `describe` — and silent the moment one ordinary
 * test sits beside it, which is every real case. `blocked-on.test.ts` held a
 * one-row table whose rows leave by being built; a builder emptying it would
 * have taken the claim with it and nothing in the repository would have said
 * so. The comment there says exactly this, which is the point: the rule was
 * known, written down, and enforced by whoever happened to remember it.
 *
 * So it is enforced here instead, for every `it`, `test` and `describe` table
 * in the repository, at the moment the table is handed over — the error names
 * the file and the line, because collection fails where the empty table is
 * rather than in a report somewhere else.
 *
 * **`it.skip.each` is deliberately left alone**, and `it.only.each` with it.
 * `it.skip` hands back vitest's own collector rather than this one (asserted
 * in `each-table-guard.test.ts`), and a skipped table asserts nothing whether
 * it holds rows or not: `origin-and-feature-sweep.test.ts` keeps an empty
 * skipped table on purpose, as the written-and-skipped assertion for a breach
 * record that is currently empty. Refusing that would be this guard telling a
 * file to record a breach it does not have.
 *
 * A table that is *meant* to be empty and still registers tests has no honest
 * form, which is why there is no exemption list: the ways out are to fill the
 * table, to delete the block, or to say `skip` and mean it.
 */

import { describe, it, test } from 'vitest';

/** What every `each` collector accepts: a table, and the rest of the call. */
type EachCall = (table: unknown, ...rest: readonly unknown[]) => unknown;

interface Collector {
  each: EachCall;
}

/**
 * An empty table, refused with the words a reader needs.
 *
 * Only an array is judged. `it.each` also takes a tagged template
 * (``it.each`a | b` ``), whose `TemplateStringsArray` is an array and is never
 * empty — it carries at least one string — so the same test catches nothing
 * there and needs no special case.
 *
 * Exported for the guard's own tests, which drive it directly rather than
 * through a collector: the wiring is checked separately, and this is the rule.
 */
export const refuseEmptyTable = (owner: string, table: unknown): void => {
  if (!Array.isArray(table) || table.length > 0) return;
  throw new Error(
    `${owner}.each was given an empty table, so it registers no tests and this file ` +
      'goes green having asserted nothing. Fill the table, delete the block, or write ' +
      `${owner}.skip.each if the emptiness is the claim.`,
  );
};

/** Wrap one collector's `each`, leaving `skip` and `only` vitest's own. */
const guard = (owner: string, collector: Collector): void => {
  const original = collector.each;
  collector.each = function guarded(this: unknown, table: unknown, ...rest: readonly unknown[]) {
    refuseEmptyTable(owner, table);
    return original.call(this, table, ...rest);
  } as EachCall;
};

guard('it', it as unknown as Collector);
// `it` and `test` are the same object in vitest, so this is a second name for
// one collector rather than a second collector; guarding it twice would wrap
// the wrapper. Asserted in the guard's tests, so a release that separates them
// fails here rather than quietly leaving `test.each` unguarded.
if ((test as unknown as Collector).each !== (it as unknown as Collector).each) {
  guard('test', test as unknown as Collector);
}
guard('describe', describe as unknown as Collector);
