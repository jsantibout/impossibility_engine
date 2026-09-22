/**
 * A tracked spell's `unmodelled` lines are debts, and the map must have read
 * them.
 *
 * Gate G1's serious finding (`docs/ROADMAP.md` §5.0, job 1): `spellShapesOf`
 * reads `TRACKED_ADJUDICATED[id] ?? []` and never opens the definition's own
 * `unmodelled`, so of the forty spells `LEDGER.md` filed under *waits on no
 * shape*, **thirty-four carried no entry at all**. `docs/design/content.md` is
 * explicit about what that list is — "An `unmodelled` line is a **debt**: the
 * blocker map ranks it, and one day somebody pays it by building the shape" —
 * and `dmDecides` is where a handover goes. So the report called thirty-four
 * spells finished business while their own definitions recorded debts.
 *
 * The guard here is the one `coverageGaps` already applies to the undefined
 * population, pointed at the tracked one: **a missing entry says nothing**, and
 * a report that reads a missing entry as "no debt" is displaying the unread
 * state as zero. It is the thing that has to be red before any of the readings
 * are written, because a reading recorded after the guard passes is a reading
 * nothing demanded.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  TRACKED_ADJUDICATED,
  trackedAdjudicationGaps,
  type TrackedDefinition,
} from '../scripts/missing-shapes.js';
import { LEDGER_LEVEL, trackedInReach, unreadTracked } from '../scripts/ledger.js';

describe('the gap between a tracked definition and the map that ranks it', () => {
  /**
   * Driven with synthetics first, because a guard that can only be run
   * against the data it already agrees with is not a guard.
   */
  const synthetic = (unmodelled: readonly string[]): TrackedDefinition => ({
    id: 'a-spell-nobody-read',
    unmodelled,
  });

  it('catches a definition that prints a debt and is in no map', () => {
    expect(trackedAdjudicationGaps([synthetic(['the light is not modelled'])], {}).unrecorded).toEqual([
      'a-spell-nobody-read',
    ]);
  });

  it('asks nothing of a definition that prints no debt at all', () => {
    expect(trackedAdjudicationGaps([synthetic([])], {}).unrecorded).toEqual([]);
  });

  /** And an entry — of any shape — answers the demand, which is the point. */
  it('is satisfied by a reading, whatever the reading concluded', () => {
    expect(
      trackedAdjudicationGaps([synthetic(['the light is not modelled'])], {
        'a-spell-nobody-read': [{ why: 'table' }],
      }).unrecorded,
    ).toEqual([]);
  });

  it('reports them sorted, so two branches can both read the failure', () => {
    const many = [
      { id: 'zither', unmodelled: ['a debt'] },
      { id: 'anvil', unmodelled: ['a debt'] },
    ];
    expect(trackedAdjudicationGaps(many, {}).unrecorded).toEqual(['anvil', 'zither']);
  });
});

describe('every tracked spell in reach has been read', () => {
  /**
   * The population, asserted before the claim over it: these are spells a
   * level 1–5 character can cast that the engine casts and resolves nothing
   * of, and every one of them prints at least one `unmodelled` line.
   */
  it('is the tracked half of level-5 reach, and none of it is silent', () => {
    const population = trackedInReach(LEDGER_LEVEL);
    expect(population.length).toBeGreaterThan(0);
    for (const one of population) {
      expect(SRD_CONTENT.spell(one.id), one.id).not.toBeNull();
      expect(one.unmodelled.length, `${one.id} prints no unmodelled line`).toBeGreaterThan(0);
    }
  });

  /**
   * The finding itself. Darkness is the spell it was found on: four
   * `unmodelled` lines, one of them a dispel the book prints in numbers, and
   * no entry anywhere.
   */
  it('has read Darkness, which is where the hole was found', () => {
    expect(TRACKED_ADJUDICATED['darkness']).toBeDefined();
    expect(unreadTracked(LEDGER_LEVEL)).not.toContain('darkness');
  });

  it('has read every one of them', () => {
    expect(unreadTracked(LEDGER_LEVEL)).toEqual([]);
  });
});
