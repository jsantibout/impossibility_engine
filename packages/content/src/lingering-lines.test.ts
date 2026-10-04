/**
 * **The four hits whose harm outlasts the fight are paid** — M-LINGER.
 *
 * SRD Death Dog's Bite, SRD Mummy's Rotting Fist, SRD Otyugh's Bite and SRD
 * Incubus's Restless Touch were the first row of `RIDER_HANDOVER_SHAPE`'s table,
 * each waiting on "a clock that runs for days". The engine holds that clock
 * now — a lingering harm hosted by the curse or the condition it lives as long
 * as, tolled every 24 hours, read by both rests — so each line is asked of
 * every shape the ledger counts, and none may match.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { MONSTER_LINE_SHAPES, statBlockLines } from '../scripts/coverage-data.js';

const LINES: readonly (readonly [string, string])[] = [
  ['death-dog', 'Bite'],
  ['mummy', 'Rotting Fist'],
  ['otyugh', 'Bite'],
  ['incubus', 'Restless Touch'],
];

describe('the hits that outlast the fight', () => {
  it.each(LINES)('%s / %s is on no unpaid shape', (block, heading) => {
    const monster = SRD_CONTENT.monsterById(block);
    expect(monster).not.toBeNull();
    const line = statBlockLines(monster!).find((one) => one.name === heading);
    expect(line).toBeDefined();
    const owed = MONSTER_LINE_SHAPES.filter(([, matches]) => matches(line!)).map(([shape]) => shape);
    expect(owed).toEqual([]);
  });
});
