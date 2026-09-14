/**
 * Reading an ongoing record that was written before the fold stopped
 * consulting the catalogue.
 *
 * **This module exists so that `events.ts` does not import the catalogue.**
 * `OngoingSpell` now pins a casting's `area` and `areaTrigger` at the cast, by
 * the rule the pinned numbers already set — so the fold answers "who is
 * standing in the Web" out of the record, and correcting a transcribed Cube
 * size cannot rewrite what a historical fold raises. That is the whole point
 * of the change, and it leaves exactly one question: **what does a record
 * written before the field existed mean?**
 *
 * There is only one honest answer. Those logs never wrote the fact down, so
 * there is nothing to read but the catalogue, and a record with no
 * {@link OngoingSpell.version} means what it always meant. Every frozen log in
 * `fixtures/` is such a record, and a fold that quietly stopped raising their
 * area debts would not be compatibility — it would be a rule silently
 * switching off.
 *
 * So the lookup survives, in one function, applied once when the record enters
 * the fold, to records that predate the field and to nothing else. A casting
 * made from now on is immune, and every later read — the boundary detector,
 * the entry detector, the two arrival detectors, `creaturesInCastingArea` —
 * asks the record and never the book.
 *
 * **Named for the job rather than hidden in the reducer.** A `definitionFor`
 * call inside `events.ts` reads as ordinary and was: the whole-engine audit of
 * 2026-09-13 (§3.2) found five of them and no reader who knew they were there.
 * One function whose docstring says "for a log older than this field" is the
 * difference between a compatibility path and a coupling nobody meant.
 */

import { definitionFor } from './spell-definitions.js';
import type { OngoingSpell, WrittenOngoing } from './spells.js';

/**
 * The shape of {@link OngoingSpell} this engine writes.
 *
 * Bumped when a field a fold *reads* changes meaning, never for an addition a
 * reader can ignore. Version 2 was the shape that carries `area` and
 * `areaTrigger` and has dropped `concentration` and `route`; **version 3 is
 * the shape that stores `aimed`** — the half of "on" only the cast knows —
 * where version 2 stored the whole of it.
 *
 * **`endsEarly` arrived after version 2 and did not bump it**, which is a
 * decision rather than an oversight: it changes the meaning of no field that
 * was already there. So absence on a version 2 record means the spell prints
 * no such sentence.
 *
 * **What made a bump safe is the line below it**, and it had to be fixed
 * first. The catalogue fill was keyed on `!== ONGOING_RECORD_VERSION`, so
 * *any* bump routed every version 2 record through it and overwrote an area
 * pinned at the cast with the book as it reads now — the exact hazard pinning
 * the area was for, one constant edit away, and invisible to both frozen logs
 * because both are pre-versioned and take the fill either way. It is keyed on
 * `version === undefined` now, which is the condition it always meant.
 */
export const ONGOING_RECORD_VERSION = 3;

/**
 * Whether a record is already the shape this engine holds.
 *
 * Version 3 *is* an {@link OngoingSpell}, so this is a narrowing rather than a
 * test — and `aimed` is checked beside the version because a hand-built record
 * claiming version 3 without it would otherwise reach `state.ongoing` as a
 * shape the type says cannot exist.
 */
const isCurrent = (casting: WrittenOngoing): casting is OngoingSpell =>
  casting.version === ONGOING_RECORD_VERSION && casting.aimed !== undefined;

/**
 * An ongoing record as this engine reads it, whatever shape it was written in.
 *
 * A version 3 record is returned unchanged — object identity included, so the
 * common path allocates nothing and a fold of a modern log never touches the
 * catalogue at all.
 *
 * An older record is rebuilt from the fields this engine knows, which does
 * three things at once. It fills the area and its clauses from the catalogue
 * **for a pre-versioned record only**, that being the only place they were
 * ever recorded for such a log and a version 2 record having written them down
 * itself. It drops `concentration` and `route`, which the type no longer
 * declares and which would otherwise ride into `state.ongoing` as data nothing
 * reads and nothing can explain. And it takes `aimed` from the caller.
 *
 * **`aimed` comes in rather than being computed here, because it reads
 * state.** A record below version 3 stored the whole of "on", and the half of
 * that this engine stores is the half the world does *not* hold — a question
 * about the creatures, which this module has no business knowing. The
 * `spell-ongoing` reducer asks it, and the answer is right there because the
 * record is written last in every resolution path: everything the casting
 * holds is already on the creatures by the time the record arrives.
 */
export function upgradeOngoing(
  casting: WrittenOngoing,
  holdsNothingOf: (who: string) => boolean,
): OngoingSpell {
  if (isCurrent(casting)) return casting;

  // **Pre-versioned only.** A version 2 record wrote its own area, so opening
  // the book for it would overwrite a fact pinned at the cast with the book as
  // it reads now — see {@link ONGOING_RECORD_VERSION}.
  const definition = casting.version === undefined ? definitionFor(casting.spellId) : null;
  const area = casting.area ?? definition?.area;
  const areaTrigger = casting.areaTrigger ?? definition?.areaTrigger;
  const endsEarly = casting.endsEarly ?? definition?.endsEarly;
  return {
    version: ONGOING_RECORD_VERSION,
    castingId: casting.castingId,
    caster: casting.caster,
    spellId: casting.spellId,
    spell: casting.spell,
    level: casting.level,
    numbers: casting.numbers,
    aimed: casting.aimed ?? (casting.on ?? []).filter(holdsNothingOf),
    ...(area === undefined ? {} : { area }),
    ...(areaTrigger === undefined ? {} : { areaTrigger }),
    // And what ends the casting early, for the same reason and by the same
    // rule: a pre-versioned record never wrote it down, so the catalogue is
    // the only place it was ever recorded. A version 2 record with no
    // `endsEarly` is a spell that prints no such sentence, which is almost all
    // of them — and what it *does* write is its own, so it is read off the
    // record first exactly as the area is.
    ...(endsEarly === undefined ? {} : { endsEarly }),
    ...(casting.origin === undefined ? {} : { origin: casting.origin }),
    ...(casting.towards === undefined ? {} : { towards: casting.towards }),
    ...(casting.anchoring === undefined ? {} : { anchoring: casting.anchoring }),
    ...(casting.unaffected === undefined ? {} : { unaffected: casting.unaffected }),
    ...(casting.damageType === undefined ? {} : { damageType: casting.damageType }),
  };
}
