import { describe, expect, it } from 'vitest';
import { renderReport } from '../scripts/coverage.js';
import { isCompleteItem } from '../scripts/magic-items.js';
import { SRD_MAGIC_ITEMS } from './items.js';

/**
 * The item's handover, on the SRD's own records.
 *
 * `docs/design/content.md`: **a table fact that a rule then reads is a debt; a
 * table fact nothing reads afterwards is a handover.** Every sentence below
 * was read against that test before it moved out of `unmodelled`; the reason
 * each is the table's is written on its record in `items.ts`, beside the
 * sentence.
 *
 * What moved changes no behaviour — nothing read an item's `unmodelled` at
 * runtime, and nothing reads `dmDecides` yet — so what this proves is the
 * claim the report makes: an item whose only unexecuted text is the table's
 * is complete, and one that still owes a rule stays partial however much of
 * its text it hands over.
 */

const item = (id: string) => {
  const found = SRD_MAGIC_ITEMS.find((one) => one.id === id);
  if (found === undefined) throw new Error(`${id} is not in the catalogue`);
  return found;
};

describe('an item whose only unexecuted text is the table’s is complete', () => {
  it('carries the Cube of Force’s faces as a handover, and calls the cube complete', () => {
    const cube = item('cube-of-force');
    expect(cube.dmDecides).toContain('Each face has a distinct marking on it.');
    expect(cube.unmodelled).toBeUndefined();
    expect(isCompleteItem(cube)).toBe(true);
  });

  /**
   * The eight records the reading finished. Written down as data rather than
   * left to the totals, because "which items this finished" is the claim.
   */
  it('finishes every record whose notes were all the table’s', () => {
    for (const id of [
      'boots-of-elvenkind',
      'chime-of-opening',
      'crystal-ball-of-true-seeing',
      'cube-of-force',
      'cubic-gate',
      'glamoured-studded-leather',
      'sovereign-glue',
      'universal-solvent',
    ]) {
      const record = item(id);
      expect(record.dmDecides?.length ?? 0, id).toBeGreaterThan(0);
      expect(isCompleteItem(record), id).toBe(true);
    }
  });

  /**
   * Half a record's text handed over is not the record finished: the half a
   * rule would read stays a debt, and the record stays partial on it.
   */
  it('keeps a record partial on the debt it still owes', () => {
    const stillOwed: Readonly<Record<string, string>> = {
      'weapon-of-warning': 'within your reach',
      'boots-of-the-winterlands': 'ice or snow',
    };
    for (const [id, clause] of Object.entries(stillOwed)) {
      const record = item(id);
      expect(record.dmDecides?.length ?? 0, id).toBeGreaterThan(0);
      expect(isCompleteItem(record), id).toBe(false);
      expect(
        (record.unmodelled ?? []).some((note) => note.includes(clause)),
        `${id}: "${clause}"`,
      ).toBe(true);
    }
  });
});

describe('the report counts a handover apart from a debt', () => {
  it('prints how many records hand text to the DM, derived from the catalogue', () => {
    const handing = SRD_MAGIC_ITEMS.filter((one) => (one.dmDecides ?? []).length > 0).length;
    expect(handing).toBeGreaterThan(0);
    const report = renderReport();
    const section = report.slice(report.indexOf('## Magic items'));
    expect(section).toContain(
      `| Records handing printed text to the DM |\n|---|\n| ${handing} |`,
    );
  });
});
