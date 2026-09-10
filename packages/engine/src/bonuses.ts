import { ok, type Result, type RollMode } from '@ie/shared';
import type { Rng } from './dice.js';
import { rollRecorded, type RecordedRoll, type RollIssuer } from './rolls.js';

/**
 * Named modifiers shared by every D20 Test.
 *
 * This lives in its own module because both `checks.ts` and `attack.ts` need
 * it, and `attack.ts` already imports `checks.ts`.
 */

/**
 * A named modifier to a roll.
 *
 * The `source` is carried all the way through to the result so a log can say
 * *why* a number was what it was — "Guidance", "+1 Longsword", "Archery" —
 * rather than presenting an unexplained total.
 *
 * Most modifiers are flat, but several are dice: Guidance adds 1d4 to an
 * ability check, Bless adds 1d4 to an attack roll, Bardic Inspiration adds a
 * die that grows with level. A bonus may carry either or both.
 */
export interface Bonus {
  readonly source: string;
  readonly flat?: number;
  /** Dice notation, e.g. `1d4` for Guidance. */
  readonly dice?: string;
}

/** A bonus after its dice, if any, have been rolled. */
export interface ResolvedBonus {
  readonly source: string;
  readonly flat: number;
  readonly roll: RecordedRoll | null;
  readonly total: number;
}

/**
 * Advantage or disadvantage with an attribution.
 *
 * Advantage cancels rather than stacks, so when a roll comes out normal it is
 * worth being able to say which effects cancelled each other out.
 */
export interface ModeSource {
  readonly source: string;
  readonly mode: RollMode;
}

/**
 * Flat bonuses are folded into the d20's own modifier rather than added
 * afterwards, so `roll.total` stays meaningful as "the die plus everything
 * static". Dice bonuses are rolled separately by {@link rollBonusDice}.
 */
export function flatBonusTotal(bonuses: readonly Bonus[] | undefined): number {
  return (bonuses ?? []).reduce((sum, b) => sum + (b.flat ?? 0), 0);
}

/** Roll the dice half of any bonuses that have one. */
export function rollBonusDice(
  issuer: RollIssuer,
  rng: Rng,
  bonuses: readonly Bonus[] | undefined,
): Result<ResolvedBonus[]> {
  const resolved: ResolvedBonus[] = [];

  for (const bonus of bonuses ?? []) {
    if (bonus.dice === undefined) continue;
    const outcome = rollRecorded(issuer, rng, bonus.dice);
    if (!outcome.ok) return outcome;
    resolved.push({
      source: bonus.source,
      flat: 0,
      roll: outcome.value,
      total: outcome.value.total,
    });
  }

  return ok(resolved);
}

export const sumResolved = (bonuses: readonly ResolvedBonus[]): number =>
  bonuses.reduce((sum, b) => sum + b.total, 0);
