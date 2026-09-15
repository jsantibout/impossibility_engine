/**
 * SRD 5.2.1 as a conformance oracle for the spell catalogue.
 *
 * `coverage.test.ts` has held every definition against the parsed book for
 * name, level, school, casting time and Concentration since tracked spells
 * landed. Two printed fields were never checked at all, and `PROGRESS.md`
 * names one of them out loud: *"the duration is the field with no automatic
 * check"*. A definition can quietly say ten minutes where the book says an
 * hour, and nothing downstream notices.
 *
 * Both of those fields turn out to be **structured in practice**. Across all
 * 339 parsed spells there are eighteen distinct range strings and twenty-four
 * distinct duration strings, and every one of them fits a grammar three lines
 * long. So they are parsed here, and a definition that disagrees with the
 * printed spell has to say why.
 *
 * **Three things this is not.**
 *
 * It is not a second source of truth. The engine definition remains
 * authoritative for execution; the oracle can say a definition disagrees with
 * the book, never what the spell does.
 *
 * It is not schema validation. `spell-schema.ts` asks whether a definition is
 * *coherent*, which a DM's invented spell can be; this asks whether it matches
 * a spell the SRD prints, which an invented spell cannot and should not.
 * Conflating the two is how "valid" comes to mean "official".
 *
 * And it does not touch the prose. Damage dice, save abilities, area shapes
 * and sizes, conditions and scaling all live in the description, and SRD 5.2.1
 * prints plain ranges (`Self`, `120 feet`) with the template in the sentence.
 * Anything claiming to oracle an area would be parsing English and calling the
 * result data. `spell-tracking.test.ts` scans that prose for *markers* and
 * demands a written adjudication, which is the honest thing to do with it.
 */

/** What a printed range means, once parsed. */
export type OracleRange =
  | { readonly kind: 'self' }
  | { readonly kind: 'touch' }
  | { readonly kind: 'ranged'; readonly feet: number }
  /** `Sight`, `Unlimited`, `Special` — real values with no number in them. */
  | { readonly kind: 'unbounded' };

/** What a printed duration means, once parsed. */
export interface OracleDuration {
  /** Whole seconds, or null for Instantaneous and for "Until dispelled". */
  readonly seconds: number | null;
  readonly concentration: boolean;
  /**
   * SRD "Until dispelled": the **absence** of a duration, not a large one.
   *
   * Distinct from Instantaneous, which also has no seconds: one spell is over
   * and the other is still running with nothing to end it. Inventing a big
   * number for either would be the engine answering a question the book
   * declined to ask.
   */
  readonly open: boolean;
}

const FEET_PER_MILE = 5280;

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  round: 6,
  rounds: 6,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86_400,
  days: 86_400,
};

/**
 * The printed Range, as a value.
 *
 * Null for a string the grammar does not cover, which is a **parser problem**
 * and never a silent default — the same rule `@ie/srd`'s own parsers follow.
 * The test asserts the whole book parses, so a re-ingest that changes the
 * wording fails here rather than quietly exempting a spell.
 */
export function srdRange(printed: string): OracleRange | null {
  const text = printed.trim();
  if (text === 'Self') return { kind: 'self' };
  if (text === 'Touch') return { kind: 'touch' };
  if (text === 'Sight' || text === 'Unlimited' || text === 'Special') {
    return { kind: 'unbounded' };
  }

  const feet = /^(\d+) (?:feet|foot)$/.exec(text);
  if (feet !== null) return { kind: 'ranged', feet: Number(feet[1]) };

  const miles = /^(\d+) miles?$/.exec(text);
  if (miles !== null) return { kind: 'ranged', feet: Number(miles[1]) * FEET_PER_MILE };

  return null;
}

/** The printed Duration, as a value. Null for a string the grammar misses. */
export function srdDuration(printed: string): OracleDuration | null {
  const text = printed.trim();
  if (text === 'Instantaneous') return { seconds: null, concentration: false, open: false };
  if (text.startsWith('Until dispelled')) {
    return { seconds: null, concentration: false, open: true };
  }
  // SRD prints one of these for a spell whose duration is a rule rather than a
  // span — "Special" — and there is nothing to compare a number against.
  if (text === 'Special') return null;

  const span = /^(Concentration, up to |Up to )?(\d+) (\w+)$/.exec(text);
  if (span === null) return null;

  const seconds = UNIT_SECONDS[span[3]!];
  if (seconds === undefined) return null;

  return {
    seconds: Number(span[2]) * seconds,
    concentration: (span[1] ?? '').startsWith('Concentration'),
    open: false,
  };
}

/**
 * The casting time the engine would record for a printed one.
 *
 * Was written inline in `coverage.test.ts`; it lives here so the three field
 * oracles are one module and a fourth has somewhere obvious to go.
 */
export function srdCastingTime(printed: string): 'action' | 'bonus-action' | 'reaction' | 'long' {
  const text = printed.toLowerCase();
  if (text.startsWith('bonus action')) return 'bonus-action';
  if (text.startsWith('reaction')) return 'reaction';
  if (text.startsWith('action')) return 'action';
  return 'long';
}

/**
 * How many seconds a printed casting time of a minute or more takes.
 *
 * Null where {@link srdCastingTime} does not answer `long`, and null for a
 * long wording the grammar does not cover — which is a **parser problem** and
 * never a plausible default, the rule `srdRange` and `srdDuration` already
 * follow and the one `animals.md` taught. The test asserts that every spell in
 * the book whose casting time reads `long` parses here, so a re-ingest that
 * changes a wording fails rather than quietly exempting a spell.
 *
 * The ` or Ritual` suffix is the *other* casting time the same line prints —
 * "1 minute or Ritual" is a one-minute casting or a Ritual — so it is stripped
 * and the number in front of it is the non-ritual answer. The ten minutes a
 * Ritual adds are the rule's, applied where the casting is declared, and are
 * deliberately not folded in here: a definition records what its spell prints.
 */
export function srdCastingSeconds(printed: string): number | null {
  if (srdCastingTime(printed) !== 'long') return null;

  const text = printed.trim().replace(/ or Ritual$/i, '');
  const span = /^(\d+) (\w+)$/.exec(text);
  if (span === null) return null;

  const seconds = UNIT_SECONDS[span[2]!.toLowerCase()];
  if (seconds === undefined) return null;

  return Number(span[1]) * seconds;
}

/** A definition that deliberately disagrees with the book, and why. */
export interface OracleExemption {
  readonly field: 'range' | 'duration';
  readonly reason: string;
}

/**
 * Where the catalogue disagrees with the printed spell on purpose.
 *
 * The same shape `spell-tracking.test.ts`'s adjudication map has, and for the
 * same reason: a disagreement that nobody had to write down is a disagreement
 * nobody reviewed. The test holds three rules against this map — every
 * mismatch needs an entry, every entry needs a mismatch, and every reason has
 * to say something.
 *
 * One entry, which is the measure of how well the catalogue was transcribed:
 * 125 definitions, 125 agreeing ranges, 124 agreeing durations.
 */
export const ORACLE_EXEMPTIONS: Readonly<Record<string, OracleExemption>> = {
  'guiding-bolt': {
    field: 'duration',
    reason:
      'SRD prints "1 round", and the whole of what that round bounds is the spell’s one unmodelled clause — "the next attack roll made against it before the end of your next turn has Advantage". Giving the definition 6 seconds would schedule a casting timer with nothing to expire and make an ongoing record for a spell that is on nobody, which is a behaviour change in service of a number nothing reads. It goes in the moment a standing Advantage a spell grants is executed.',
  },
};
