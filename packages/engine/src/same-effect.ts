/**
 * The same spell counts once.
 *
 * SRD "Combining Spell Effects":
 *
 * > "The effects of different spells add together while their durations
 * > overlap. In contrast, the effects of the same spell cast multiple times
 * > don't combine. Instead, the most potent effect—such as the highest
 * > bonus—from those castings applies while their durations overlap. The most
 * > recent effect applies if the castings are equally potent and their
 * > durations overlap. For example, if two Clerics cast _Bless_ on the same
 * > target, that target gains the spell's benefit only once; the target
 * > doesn't receive two bonus dice. But if the durations of the spells
 * > overlap, the effect continues until the duration of the second _Bless_
 * > ends."
 *
 * **A leaf, importing nothing of the engine's**, because three readers of
 * three different grant families ask it the one question: `bonusesFor`,
 * `extraActionsOwedAtTurnStart` and `speedOf`'s flat changes.
 */

/**
 * What a grant must carry for the collapse to judge it.
 *
 * `effectOf` is the spell the grant is the effect of, **pinned by the command
 * that wrote it** — a casting's definition id, or the spell an item's
 * conferral names (SRD Potion of Speed: "you gain the effect of the _Haste_
 * spell"). Absent is every other grant, which is its own identity and never
 * collapses: a feature's, a DM's, an item's that names no spell, and every
 * grant in a log written before the field existed.
 *
 * `appliedAt` is when the fold stored it, which is the book's tie-break, "the
 * most recent effect". Stamped by the fold on a grant that carries `effectOf`
 * and on nothing else.
 */
export interface SameEffect {
  readonly source: string;
  readonly effectOf?: string;
  readonly appliedAt?: number;
}

/**
 * The grants that apply, once each spell's weaker castings are set aside.
 *
 * Within one `effectOf`, the grants are grouped by `source` — one casting, or
 * one potion — and each group is scored by `potency`. The highest score is
 * kept whole, every record of it; a tie goes to the group whose latest
 * `appliedAt` is greatest, and then to the lexically greater source, so a
 * state built by hand with no stamps is still answered one way. Grants with
 * no `effectOf` pass through untouched, and what is kept comes back in the
 * order it was given.
 *
 * **At read time, and never in the fold.** The book suppresses the weaker
 * effect *while the durations overlap*: it does not end it, and when the
 * stronger one ends the weaker applies again. So every grant stays in state
 * exactly as it was written, and each reader asks this after its own filters
 * — the kind of roll, the narrowing, a requirement — because potency is a
 * fact about what reaches *this* read. A stored "suppressed" flag would have
 * to be recomputed by every grant, expiry, consumption, dispel and release
 * path, and would still have to be skipped by every reader.
 */
export function strongestOfEachEffect<T extends SameEffect>(
  held: readonly T[],
  potency: (bySource: readonly T[]) => number,
): readonly T[] {
  const bySpell = new Map<string, Map<string, T[]>>();
  for (const grant of held) {
    if (grant.effectOf === undefined) continue;
    const sources = bySpell.get(grant.effectOf) ?? new Map<string, T[]>();
    bySpell.set(grant.effectOf, sources);
    const records = sources.get(grant.source) ?? [];
    sources.set(grant.source, records);
    records.push(grant);
  }
  if (bySpell.size === 0) return held;

  const kept = new Map<string, string>();
  for (const [effect, sources] of bySpell) {
    let best: { readonly source: string; readonly score: number; readonly at: number } | null = null;
    for (const [source, records] of sources) {
      const score = potency(records);
      const at = Math.max(...records.map((record) => record.appliedAt ?? -1));
      if (
        best === null ||
        score > best.score ||
        (score === best.score && (at > best.at || (at === best.at && source > best.source)))
      ) {
        best = { source, score, at };
      }
    }
    if (best !== null) kept.set(effect, best.source);
  }

  return held.filter(
    (grant) => grant.effectOf === undefined || kept.get(grant.effectOf) === grant.source,
  );
}
