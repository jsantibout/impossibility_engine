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
   * of, and every one of them says what it leaves the table.
   *
   * **It said `unmodelled`, and P3-S6 is why it does not now.** Thirty-two of
   * these were read to the end and their text moved to `dmDecides`, which is
   * the list `docs/design/content.md` keeps apart from the debts — so a
   * definition printing no `unmodelled` line is now the *finished* state
   * rather than a silent one. What is still refused is silence, which is
   * `checkSpellDefinition`'s own `silent_gap` rule read from out here.
   */
  it('is the tracked half of level-5 reach, and none of it is silent', () => {
    const population = trackedInReach(LEDGER_LEVEL);
    expect(population.length).toBeGreaterThan(0);
    for (const one of population) {
      const definition = SRD_CONTENT.spell(one.id);
      expect(definition, one.id).not.toBeNull();
      expect(
        [...one.unmodelled, ...(definition?.dmDecides ?? [])].length,
        `${one.id} declares nothing at all`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * And the demand for a reading does not lapse when a definition stops
   * printing a debt.
   *
   * `trackedAdjudicationGaps` asks for an entry from every tracked definition
   * that prints an `unmodelled` line, which was the whole population when it
   * was written and is a third of it now. A definition that hands everything
   * over has *more* need of a recorded reading, not less — the claim it makes
   * is precisely that somebody read every sentence — so the demand is made
   * here over the whole population instead, unconditionally.
   */
  it('has an entry for every tracked spell in reach, debt or no debt', () => {
    const unrecorded = trackedInReach(LEDGER_LEVEL)
      .map((one) => one.id)
      .filter((id) => TRACKED_ADJUDICATED[id] === undefined)
      .sort();
    expect(unrecorded).toEqual([]);
  });

  /**
   * The finding itself. Darkness is the spell it was found on: four
   * `unmodelled` lines, one of them a dispel the book prints in numbers, and
   * no entry anywhere.
   *
   * **It is not tracked any more, and that is the finding closing rather than
   * going stale.** P3-S gave the Sphere a light level to hold, so the engine
   * resolves the whole of what the spell does and three of those four lines
   * are gone. What the read has to say now is that the spell left by being
   * *finished*: an entry in the tracked map would be a claim that the engine
   * resolves nothing of it, which is no longer true.
   */
  it('has finished Darkness, which is where the hole was found', () => {
    expect(SRD_CONTENT.spell('darkness')?.areaLight).toBeDefined();
    expect(TRACKED_ADJUDICATED['darkness']).toBeUndefined();
    expect(trackedInReach(LEDGER_LEVEL).map((one) => one.id)).not.toContain('darkness');
    expect(unreadTracked(LEDGER_LEVEL)).not.toContain('darkness');
  });

  it('has read every one of them', () => {
    expect(unreadTracked(LEDGER_LEVEL)).toEqual([]);
  });
});
