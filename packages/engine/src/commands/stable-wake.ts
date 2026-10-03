/**
 * **The wake a Stable creature is owed** — E-STABLE.
 *
 * SRD, "Stabilizing a Character": "A Stable creature that isn't healed
 * regains 1 Hit Point after 1d4 hours."
 *
 * Four commands make a creature Stable — a third successful death save at a
 * turn's start, a DM recording a Medicine check or a Healer's Kit, SRD Spare
 * the Dying, and a stat block's "the target becomes Stable" — and each calls
 * this beside the `stabilised` (or the `death-save-recorded`) it writes, so
 * the rule is written once and every road to Stable reaches it.
 *
 * **The die is thrown now and the hours are pinned.** The d4 is the engine's,
 * recorded with provenance like any other, and what it showed becomes a
 * deadline on the clock in the `effect-scheduled` that follows: a replay reads
 * the moment back and never throws the die again. The fold does the rest —
 * `fold/expiry.ts` wakes the creature when the clock reaches the deadline,
 * whoever moved the clock, and drops the deadline the moment the creature is
 * no longer lying Stable. Nothing here has to know about healing or damage.
 *
 * **No `rolls-issued`.** Callers bracket their own generator: a casting writes
 * one for the whole effect list, a turn boundary and an attack one per roll,
 * and two claims about one generator would count its move twice.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import type { GameEvent, GameState } from '../events.js';
import { rollRecorded } from '../rolls.js';
import { STABLE_WAKE } from '../vitals.js';
import type { Supply } from './casting.js';

/**
 * The d4 thrown for a creature that has just become Stable, and the deadline
 * its hours set. `state` is the world the stabilising is written into — the
 * clock the hours are counted from.
 */
export function wakeOfTheStable(
  state: GameState,
  who: CharacterId,
  supply: Pick<Supply, 'issuer' | 'rng'>,
): Result<readonly GameEvent[]> {
  const thrown = rollRecorded(supply.issuer, supply.rng, STABLE_WAKE.dice);
  if (!thrown.ok) return thrown;
  const hours = thrown.value.total;
  return ok([
    {
      type: 'roll-recorded',
      who,
      label: `${who} is Stable and regains ${STABLE_WAKE.regains} Hit Point after ${STABLE_WAKE.dice} hours`,
      natural: hours,
      total: hours,
      contributions: [],
      outcome: `wakes in ${hours} hour${hours === 1 ? '' : 's'}`,
    },
    {
      type: 'effect-scheduled',
      target: { kind: 'stable', on: who },
      deadline: { kind: 'elapsed', at: state.elapsed + hours * STABLE_WAKE.secondsPerFace },
    },
  ]);
}
