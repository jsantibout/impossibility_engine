import { ok, type Result, type RollMode } from '@ie/shared';
import type { Rng } from './dice.js';
import { parseNotation } from './dice.js';
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
  /**
   * Which way the rolled dice push. Adding, unless stated.
   *
   * Bane is Bless with a minus sign — "the target must subtract 1d4 from the
   * attack roll or save" — and the sign belongs here rather than in the
   * notation, because `-1d4` is not dice notation and teaching the parser to
   * read it would make every other consumer handle negative dice counts.
   * A flat bonus needs no such flag: it can simply be negative.
   */
  readonly direction?: 'add' | 'subtract';
}

/**
 * What a lasting bonus applies to.
 *
 * The first three are rolls. `ac` is not — it is a number the rules compare a
 * roll *against* — and it is here rather than in its own mechanism because the
 * SRD writes it in the same breath: Shield of Faith's "+2 bonus to AC" and
 * Bless's "+1d4 to the attack roll" are one sentence shape with two targets.
 *
 * Only the flat half of a bonus reaches an Armour Class. No SRD spell grants a
 * rolled one, and a d4 of AC has no moment at which it could be rolled: an
 * Armour Class is a standing number that many attacks are measured against,
 * not an event.
 */
export type BonusApplies = 'attack' | 'save' | 'ability-check' | 'ac';

/**
 * A bonus an ongoing effect has hung on a creature.
 *
 * `Bonus` is a modifier a caller passes to one roll. This is the same thing
 * *stored*, with two extra facts: which rolls it touches, and which way it
 * pushes — because Bane is Bless with a minus sign and modelling them as two
 * mechanisms would be the same mistake `interveneAfterRoll` already avoided.
 *
 * The `source` carries the casting id (`Bless#cast:3`), which is what ties the
 * bonus to the spell that made it and ends it when that spell ends.
 */
export interface ActiveBonus {
  readonly source: string;
  readonly bonus: Bonus;
  readonly applies: readonly BonusApplies[];
  readonly direction: 'add' | 'subtract';
}

/**
 * The bonuses a creature carries that apply to this kind of roll.
 *
 * Subtraction is folded in here rather than at the reading site: a caller
 * asking "what applies to my save" should get modifiers it can add, not a list
 * it has to know the sign convention for.
 */
export function bonusesFor(
  held: readonly ActiveBonus[],
  kind: BonusApplies,
): readonly Bonus[] {
  return held
    .filter((active) => active.applies.includes(kind))
    .map((active) =>
      active.direction === 'add'
        ? active.bonus
        : {
            ...active.bonus,
            ...(active.bonus.flat === undefined ? {} : { flat: -active.bonus.flat }),
            direction: 'subtract' as const,
          },
    );
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

/**
 * Check every bonus's notation before anything is rolled.
 *
 * Rolling first and validating afterwards left a malformed bonus returning an
 * error *after* it had advanced the generator and consumed a roll id — so a
 * rejected operation still moved authoritative state, and a replay would
 * diverge from the live session. Validate the whole operation, then roll.
 */
export function validateBonusDice(bonuses: readonly Bonus[] | undefined): Result<true> {
  for (const bonus of bonuses ?? []) {
    if (bonus.dice === undefined) continue;
    const parsed = parseNotation(bonus.dice);
    if (!parsed.ok) return parsed;
  }
  return ok(true);
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
    // The die is rolled either way and kept in the record either way; only the
    // contribution's sign differs, so the log still shows what Bane rolled.
    const sign = bonus.direction === 'subtract' ? -1 : 1;
    resolved.push({
      source: bonus.source,
      flat: 0,
      roll: outcome.value,
      total: outcome.value.total * sign,
    });
  }

  return ok(resolved);
}

export const sumResolved = (bonuses: readonly ResolvedBonus[]): number =>
  bonuses.reduce((sum, b) => sum + b.total, 0);
