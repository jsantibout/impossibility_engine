import { asRollId, err, ok, type Result, type RollId, type RollMode } from '@ie/shared';
import {
  notationBounds,
  parseNotation,
  roll,
  rollD20,
  type D20Outcome,
  type DieEffect,
  type Rng,
  type RollOutcome,
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
}

export interface RecordedRoll extends RollOutcome {
  readonly provenance: RollProvenance;
}

export function rollD20Recorded(
  issuer: RollIssuer,
  rng: Rng,
  mode: RollMode,
  modifier: number,
): RecordedD20 {
  return { ...rollD20(rng, mode, modifier), provenance: issuer.issue('engine') };
}

export function rollRecorded(
  issuer: RollIssuer,
  rng: Rng,
  notation: string,
  effects: readonly DieEffect[] = [],
): Result<RecordedRoll> {
  const outcome = roll(rng, notation, effects);
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
