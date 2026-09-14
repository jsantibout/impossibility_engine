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
import type { OngoingSpell } from './spells.js';

/**
 * The shape of {@link OngoingSpell} this engine writes.
 *
 * Bumped when a field a fold *reads* changes meaning, never for an addition a
 * reader can ignore. Version 2 is the shape that carries `area` and
 * `areaTrigger` and has dropped `concentration` and `route`.
 *
 * **`endsEarly` arrived after version 2 and did not bump it**, which is a
 * decision rather than an oversight. It changes the meaning of no field that
 * was already there, and bumping would be *worse*: the upgrade path fills the
 * area from the catalogue, so running a version 2 record through it would
 * overwrite an area pinned at the cast with the book as it reads now — the
 * exact hazard pinning the area was for. So absence on a version 2 record
 * means the spell prints no such sentence, which is true of every such record
 * in the repository: both frozen logs are pre-versioned, and nothing else
 * persists one yet.
 */
export const ONGOING_RECORD_VERSION = 2;

/**
 * An ongoing record as this engine reads it, whatever shape it was written in.
 *
 * A version 2 record is returned unchanged — object identity included, so the
 * common path allocates nothing and a fold of a modern log never touches the
 * catalogue at all.
 *
 * A pre-versioned record is rebuilt from the fields this engine knows, which
 * does two things at once: it fills the area and its clauses from the
 * catalogue, the only place they were ever recorded for such a log, and it
 * drops `concentration` and `route`, which the type no longer declares and
 * which would otherwise ride into `state.ongoing` as data nothing reads and
 * nothing can explain.
 */
export function upgradeOngoing(casting: OngoingSpell): OngoingSpell {
  if (casting.version === ONGOING_RECORD_VERSION) return casting;

  const definition = definitionFor(casting.spellId);
  return {
    version: ONGOING_RECORD_VERSION,
    castingId: casting.castingId,
    caster: casting.caster,
    spellId: casting.spellId,
    spell: casting.spell,
    level: casting.level,
    numbers: casting.numbers,
    on: casting.on,
    ...(definition?.area === undefined ? {} : { area: definition.area }),
    ...(definition?.areaTrigger === undefined ? {} : { areaTrigger: definition.areaTrigger }),
    // And what ends the casting early, for the same reason and by the same
    // rule: a pre-versioned record never wrote it down, so the catalogue is
    // the only place it was ever recorded. A version 2 record with no
    // `endsEarly` is a spell that prints no such sentence, which is almost all
    // of them — every version 2 record in the repository was written by code
    // that writes this field, and the two frozen logs are pre-versioned.
    ...(definition?.endsEarly === undefined ? {} : { endsEarly: definition.endsEarly }),
    ...(casting.origin === undefined ? {} : { origin: casting.origin }),
    ...(casting.towards === undefined ? {} : { towards: casting.towards }),
    ...(casting.anchoring === undefined ? {} : { anchoring: casting.anchoring }),
    ...(casting.unaffected === undefined ? {} : { unaffected: casting.unaffected }),
    ...(casting.damageType === undefined ? {} : { damageType: casting.damageType }),
  };
}
