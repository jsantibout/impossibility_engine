import { asRollId, err, ok, type Result, type RollId, type RollMode } from '@ie/shared';
import {
  notationBounds,
  parseNotation,
  rollD20,
  rollUnder,
  type D20Outcome,
  type DieEffect,
  type Rng,
  type RollOutcome,
  type RollRule,
} from './dice.js';

/**
 * Roll provenance.
 *
 * Every roll the engine issues carries an id and a record of where the number
 * came from. That distinction is what lets one engine serve two very different
 * tables:
 *
 * - An **AI** DM must never be able to supply a number. Its tool surface simply
 *   does not expose the `recordExternal*` functions, so every roll it can reach
 *   is `engine`-generated.
 * - A **human** DM legitimately fudges rolls — softening a TPK, letting a good
 *   idea land. That is a core skill of running a table, not an abuse of it. A
 *   human-facing surface exposes the external functions, and the log records
 *   exactly which numbers were rolled and which were decided.
 *
 * The invariant is therefore *provenance*, not *purity*: damage is applied from
 * a roll the engine **issued**, whatever its source — never from a bare number.
 */

export type RollSource = 'engine' | 'physical-dice' | 'dm-override';

export interface RollProvenance {
  readonly id: RollId;
  readonly source: RollSource;
  /** Why a roll was overridden. Null for ordinary rolls. */
  readonly note: string | null;
}

export interface RollIssuer {
  issue(source: RollSource, note?: string | null): RollProvenance;
  /** How many ids have been issued so far. */
  readonly count: number;
}

/**
 * Ids are sequential and derived from a caller-supplied prefix rather than
 * random, so replaying the same log reproduces the same ids. A random id would
 * break every RollId reference in the event log on the next restart — and the
 * engine's purity lint forbids `crypto.randomUUID` for exactly this reason.
 */
export function createRollIssuer(prefix: string, startAt = 0): RollIssuer {
  let issued = startAt;

  return {
    issue(source: RollSource, note: string | null = null): RollProvenance {
      issued++;
      return { id: asRollId(`${prefix}:${issued}`), source, note };
    },
    get count(): number {
      return issued - startAt;
    },
  };
}

export interface RecordedD20 extends D20Outcome {
  readonly provenance: RollProvenance;
  /**
   * The roll this one replaced, where a rule threw the die again.
   *
   * SRD Luck: "you must use the new roll" — so the first roll is history
   * rather than a choice, and the whole of it is kept here so the log can show
   * what was given up. It carries its own provenance, because the two throws
   * are two rolls and a reader that saw one id for both could not tell which
   * face the engine actually used.
   */
  readonly superseded?: RecordedD20;
}

export interface RecordedRoll extends RollOutcome {
  readonly provenance: RollProvenance;
}

/**
 * A face of the d20 that is thrown again, and what says so.
 *
 * SRD Luck is the one sentence of this shape: a face rather than an outcome,
 * a replacement rather than a mode, and no Reaction spent to do it.
 */
export interface D20Reroll {
  /** SRD's "a 1 on the d20": the face the rule reaches. */
  readonly on: number;
  /** The feature that said so, for the log. */
  readonly source: string;
}

/**
 * `reroll` is a rule read **after** the die lands — see {@link D20Reroll}. The
 * counted die is the one thrown again, which under Advantage or Disadvantage
 * is the one the mode picked out and under neither is the only one there is;
 * the other die stands, because the rule names "the d20 of a D20 Test" and a
 * creature rolling two has only ever used one of them.
 *
 * **Once, never twice.** A 1 on the replacement stands: the sentence is about
 * the roll a test makes and this is the roll it made, so a rule that chased
 * its own tail would be a different sentence with no printer.
 */
export function rollD20Recorded(
  issuer: RollIssuer,
  rng: Rng,
  mode: RollMode,
  modifier: number,
  reroll: D20Reroll | null = null,
): RecordedD20 {
  const first: RecordedD20 = {
    ...rollD20(rng, mode, modifier),
    provenance: issuer.issue('engine'),
  };
  if (reroll === null || first.natural !== reroll.on) return first;

  // Which die counted, so the replacement lands on that one rather than on a
  // fresh pair. Ties go to the first, which is `rollD20`'s own reading of a
  // mode and is what keeps the two functions from disagreeing about it.
  const counted = first.rolls.indexOf(first.natural);
  const rolls = first.rolls.map((face, index) => (index === counted ? rng.int(20) : face));
  const natural =
    mode === 'advantage'
      ? Math.max(...rolls)
      : mode === 'disadvantage'
        ? Math.min(...rolls)
        : rolls[0]!;

  return {
    rolls,
    natural,
    mode,
    modifier,
    total: natural + modifier,
    isCriticalHit: natural === 20,
    isCriticalMiss: natural === 1,
    // Its own id, and no note: `note` is why a roll was *overridden* by
    // somebody, and this is the engine rolling its own dice under its own
    // rule. What said so travels on the event, beside the face it replaced.
    provenance: issuer.issue('engine'),
    superseded: first,
  };
}

/**
 * `rule` is a sentence about the roll as a whole — see {@link RollRule}. It is
 * **one** recorded roll however many dice it ends up throwing: Savage
 * Attacker's two throws are two halves of one damage roll rather than two
 * damage rolls, so they share an id and the loser's dice ride along `dropped`.
 * Absent, or null, is the roll this function has always made.
 */
export function rollRecorded(
  issuer: RollIssuer,
  rng: Rng,
  notation: string,
  effects: readonly DieEffect[] = [],
  rule: RollRule | null = null,
): Result<RecordedRoll> {
  const outcome = rollUnder(rng, notation, rule, effects);
  // Issue the id only once the roll has actually happened, so a rejected roll
  // does not leave a gap in the sequence.
  if (!outcome.ok) return outcome;
  return ok({ ...outcome.value, provenance: issuer.issue('engine') });
}

/** Guard: only this module's own roll functions may claim engine provenance. */
function checkExternalSource(source: RollSource): Result<Exclude<RollSource, 'engine'>> {
  if (source === 'engine') {
    return err(
      'forged_provenance',
      'only the engine may record a roll as engine-generated; use "physical-dice" or "dm-override"',
    );
  }
  return ok(source);
}

export interface ExternalD20 {
  /** The face the die showed, 1 to 20. */
  readonly natural: number;
  readonly modifier: number;
  readonly mode?: RollMode;
  readonly source: RollSource;
  readonly note?: string | null;
}

/**
 * Record a d20 rolled outside the engine — physical dice at a real table, or a
 * DM stating the result they want.
 *
 * The face is validated whatever the source: a d20 has twenty faces regardless
 * of who is holding it, so even an override has to name one the die could show.
 */
export function recordExternalD20(issuer: RollIssuer, input: ExternalD20): Result<RecordedD20> {
  const source = checkExternalSource(input.source);
  if (!source.ok) return source;

  const { natural, modifier } = input;
  if (!Number.isInteger(natural) || natural < 1 || natural > 20) {
    return err('impossible_die', `${natural} is not a face a d20 can show`);
  }

  return ok({
    rolls: [natural],
    natural,
    mode: input.mode ?? 'normal',
    modifier,
    total: natural + modifier,
    isCriticalHit: natural === 20,
    isCriticalMiss: natural === 1,
    provenance: issuer.issue(source.value, input.note ?? null),
  });
}

export interface ExternalDamage {
  readonly total: number;
  /** The notation the total is claimed to come from, e.g. `2d6+3`. */
  readonly notation: string;
  readonly source: RollSource;
  readonly note?: string | null;
}

/**
 * Record damage rolled outside the engine.
 *
 * Physical rolls are bounds-checked against the notation — nobody rolls 30 on a
 * `1d4`, so a total outside the range is a transcription error and trusting it
 * would corrupt the log. A DM override is *not* bounds-checked, because an
 * override is a ruling rather than a report of a die; it is simply recorded as
 * an override so the log stays honest about it.
 */
export function recordExternalDamage(
  issuer: RollIssuer,
  input: ExternalDamage,
): Result<RecordedRoll> {
  const source = checkExternalSource(input.source);
  if (!source.ok) return source;

  const parsed = parseNotation(input.notation);
  if (!parsed.ok) return parsed;

  const { total } = input;
  if (!Number.isInteger(total) || total < 0) {
    return err('impossible_damage', `${total} is not a valid damage total`);
  }

  if (source.value === 'physical-dice') {
    const { min, max } = notationBounds(parsed.value);
    if (total < min || total > max) {
      return err(
        'impossible_damage',
        `${input.notation} cannot total ${total} — it ranges from ${min} to ${max}`,
      );
    }
  }

  return ok({
    notation: parsed.value,
    dice: [],
    modifier: parsed.value.modifier,
    total,
    provenance: issuer.issue(source.value, input.note ?? null),
  });
}
