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

import type { SpellDefinition } from './spell-definitions.js';
import type { AreaStanding } from './standing.js';
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
 * **`areaStanding` arrived after version 3 and did not bump it either**, by
 * the same rule and with one consequence worth stating outright. A Spirit
 * Guardians still running in a log written before the field existed is a
 * version 3 record: `isCurrent` hands it back untouched, the catalogue fill is
 * keyed on `version === undefined` and does not reach it, so that casting's
 * Emanation halves nobody until it is recast. That is the behaviour a bump
 * would have to be justified by changing — and it does not justify one:
 * replaying such a log stays byte-identical, which is the promise, where
 * routing version 3 records through the fill would open the book for a record
 * that already pinned its own area. A *new* casting of the same spell writes
 * the field and halves from its first read.
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
  casting.version === ONGOING_RECORD_VERSION &&
  casting.aimed !== undefined &&
  // And the one field whose **arity** changed after version 3 was fixed: a
  // record written when an area could do one thing to whoever stood in it
  // carries a clause where this engine carries a list of them. It means
  // exactly what it always meant, so it is widened rather than versioned —
  // see {@link normaliseStanding} — and a record that still holds the old
  // shape is rebuilt below rather than handed back as a shape the type says
  // cannot exist.
  (casting.areaStanding === undefined || Array.isArray(casting.areaStanding));

/**
 * A record's standing clauses, however many of them it was written with.
 *
 * SRD Silence writes three sentences of that shape about one Sphere, so the
 * field became a list; SRD Spirit Guardians writes one and every record ever
 * written holds it alone. A lone clause is a list of one and always was, which
 * is why this is a widening the reader absorbs rather than a bump of
 * {@link ONGOING_RECORD_VERSION}: no clause on an old record does anything
 * different, and a bump would have sent every version 3 record through a
 * rebuild it does not need.
 */
function normaliseStanding(
  written: readonly AreaStanding[] | AreaStanding | undefined,
): readonly AreaStanding[] | undefined {
  if (written === undefined) return undefined;
  return Array.isArray(written) ? written : [written as AreaStanding];
}

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
  legacy: ((spellId: string) => SpellDefinition | null) | null,
): OngoingSpell {
  if (isCurrent(casting)) return casting;

  // **Pre-versioned only.** A version 2 record wrote its own area, so opening
  // the book for it would overwrite a fact pinned at the cast with the book as
  // it reads now — see {@link ONGOING_RECORD_VERSION}. The book it opens is
  // the one the caller says the log was written against: the engine holds no
  // catalogue of its own, and a log this old that arrives without one cannot
  // be folded honestly, so it is refused rather than folded with the rule
  // silently switched off.
  let definition: SpellDefinition | null = null;
  if (casting.version === undefined) {
    if (legacy === null) {
      throw new Error(
        `the ongoing record for ${casting.spellId} (${casting.castingId}) predates pinned areas; replay this log with the content it was written against`,
      );
    }
    definition = legacy(casting.spellId);
  }
  const area = casting.area ?? definition?.area;
  const areaTrigger = casting.areaTrigger ?? definition?.areaTrigger;
  // What the area does to whoever stands in it, read off the record first and
  // out of the legacy book only for a record written before the field existed
  // — the rule the area and the trigger above already follow.
  // **A lone clause is read as a list of one**, which is what a version 3
  // record written before Silence needed three of them says. The field grew an
  // arity rather than a meaning — every clause on such a record still does
  // exactly what it did — so this is a widening the reader absorbs rather than
  // a version bump, by the rule {@link ONGOING_RECORD_VERSION} states. What
  // makes it safe to do here is that this function is the one door into
  // `state.ongoing`.
  const areaStanding = normaliseStanding(casting.areaStanding ?? definition?.areaStanding);
  const endsEarly = casting.endsEarly ?? definition?.endsEarly;
  // And what the casting leaves behind when it ends, read the same way and for
  // the same reason: a record written before the field never wrote it down.
  const onEnd = casting.onEnd ?? definition?.onEnd;
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
    ...(areaStanding === undefined ? {} : { areaStanding }),
    // And what ends the casting early, for the same reason and by the same
    // rule: a pre-versioned record never wrote it down, so the catalogue is
    // the only place it was ever recorded. A version 2 record with no
    // `endsEarly` is a spell that prints no such sentence, which is almost all
    // of them — and what it *does* write is its own, so it is read off the
    // record first exactly as the area is.
    ...(endsEarly === undefined ? {} : { endsEarly }),
    ...(onEnd === undefined ? {} : { onEnd }),
    ...(casting.origin === undefined ? {} : { origin: casting.origin }),
    ...(casting.towards === undefined ? {} : { towards: casting.towards }),
    ...(casting.anchoring === undefined ? {} : { anchoring: casting.anchoring }),
    ...(casting.unaffected === undefined ? {} : { unaffected: casting.unaffected }),
    ...(casting.chosen === undefined ? {} : { chosen: casting.chosen }),
    ...(casting.damageType === undefined ? {} : { damageType: casting.damageType }),
    // **The four fields a rebuild used to drop**, carried now because a
    // version 3 record can reach the rebuild: until the standing clause grew
    // an arity, only a pre-versioned record was ever rebuilt and none of these
    // existed when one was written. A record that answered a Counterspell, ran
    // a branch, heated an object or pinned a choice must not lose the fact on
    // the way in.
    ...(casting.object === undefined ? {} : { object: casting.object }),
    ...(casting.choice === undefined ? {} : { choice: casting.choice }),
    ...(casting.option === undefined ? {} : { option: casting.option }),
    ...(casting.negates === undefined ? {} : { negates: casting.negates }),
  };
}
