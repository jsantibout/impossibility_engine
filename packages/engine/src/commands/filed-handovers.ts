/**
 * **A stat block's filed handovers, reported under the engine's mark** — W7-B13.
 *
 * A stat block's sentence reaches a table in one of two ways, and they are two
 * different claims. The **residue** — `handedOver` on a save, on a hit's rider
 * and on a trait — is what the reader did not read: the engine owes it, the
 * ledger counts it, and every door that meets it says so in words that carry
 * no mark. A **filed** sentence — `forTheTable` — is one somebody read and found
 * the table's for good: a compulsion the owner ruled the table's (2026-09-24),
 * or fiction no rule reads afterwards. That is the claim `DM_DECIDES` makes for
 * a spell's `dmDecides`, and it goes out under the same mark, through
 * `handedOver`, so a reader of `unverified` tells the two apart by the mark and
 * by nothing else.
 *
 * **The mark is written here and only from a filed field**, which is what keeps
 * it from being forged: every caller hands this a `forTheTable` list, and
 * `dm-handover.test.ts` pins the callers by file, each with the field it reads,
 * so a new writer fails the pin until somebody names its field.
 *
 * **When** is the entry's own `on` and `faces`: absent `on` is the moment of use
 * (once, whoever the line caught), `failure` and `success` are one target's
 * save, and `faces` is the throw of a die the line prints — a row of SRD
 * Gibbering Mouther's d8, SRD Flesh Golem's 6.
 */

import type { PrintedHandover } from '@ie/srd';
import { handedOver } from '../spell-definitions.js';

/** The moments a filed sentence is reported at. */
export type FiledMoment = 'use' | 'failure' | 'success';

/**
 * The entries of a filed list that belong to one moment.
 *
 * With a `face`, only the rows whose faces hold it; without one, only the
 * entries that are not rows at all — a row is reported beside the throw that
 * chose it, and nowhere else.
 */
export function filedFor(
  filed: readonly PrintedHandover[] | undefined,
  moment: FiledMoment,
  face?: number,
): readonly PrintedHandover[] {
  return (filed ?? []).filter((one) => {
    const when: FiledMoment = one.on ?? 'use';
    if (face === undefined) return one.faces === undefined && when === moment;
    return (
      one.faces !== undefined &&
      face >= one.faces.from &&
      face <= one.faces.to &&
      (one.on === undefined || one.on === moment)
    );
  });
}

/**
 * The filed sentences, each under the engine's handover mark and the name of
 * whose line it is — the one place a stat block's handover is written.
 */
export function reportFiled(name: string, filed: readonly PrintedHandover[]): readonly string[] {
  return filed.map((one) => handedOver(name, one.sentence));
}
