import { err, ok, type CharacterId, type Result } from '@ie/shared';
import type { Rng } from './dice.js';
import type { GameEvent } from './events.js';
import { hitDieSides, remaining } from './resources.js';
import { rollRecorded, type RollIssuer } from './rolls.js';
import type { CreatureState } from './state.js';

/**
 * Hit Point Dice spent — the one place a spent Hit Die is checked and thrown.
 *
 * Two roads spend a creature's dice down: a rest it finished (`endRest`) and a
 * rest's benefits a spell hands it (SRD Prayer of Healing's `rest-benefits`).
 * Both ask these two functions, so the rule is written once.
 *
 * **Deliberately not on the engine's barrel.** `hitDiceRolled` throws dice and
 * hands back the events of a spend with no rest and no casting around them —
 * a primitive a caller holding the barrel could spend somebody's dice with —
 * so it is reached only by the two commands above, which own the generator's
 * accounting and the healing.
 */

/** One Hit Die spent, and what it gave back. */
export interface HitDieSpent {
  readonly key: string;
  readonly sides: number;
  /** What the die showed. */
  readonly natural: number;
  /** The die plus Constitution, never below 1. */
  readonly regained: number;
}

/**
 * Which Hit Point Dice a request names, each with its size — or the refusal
 * the request earns. Every die is checked before any is rolled: a request for
 * more dice than are left costs neither a die nor a turn of the generator.
 */
export function hitDiceRequested(
  creature: CreatureState,
  id: CharacterId,
  requested: readonly string[],
): Result<readonly { readonly key: string; readonly sides: number }[]> {
  const dice: { readonly key: string; readonly sides: number }[] = [];
  const needed = new Map<string, number>();
  for (const key of requested) {
    const sides = hitDieSides(key);
    if (sides === null) return err('bad_hit_die', `${key} is not a Hit Die pool`);
    dice.push({ key, sides });
    needed.set(key, (needed.get(key) ?? 0) + 1);
  }
  for (const [key, count] of needed) {
    const left = remaining(creature.resources, key);
    if (left < count) {
      return err('not_enough_hit_dice', `${id} has ${left} ${key} left, and asked to spend ${count}`);
    }
  }
  return ok(dice);
}

/**
 * Hit Point Dice spent: one `resource-spent` and one `roll-recorded` per die,
 * and what they regained between them.
 *
 * SRD: "For each Hit Point Die you spend in this way, roll the die and add your
 * Constitution modifier to it. You regain Hit Points equal to the total
 * (minimum of 1 Hit Point)." **No `rolls-issued` and no `healed`**: the caller
 * owns the generator's accounting and the healing event, so a rest and a
 * spell each write those once, in their own batch. What each die gave back is
 * appended to `spent`, the caller's own list, for the total it heals by.
 */
export function hitDiceRolled(
  issuer: RollIssuer,
  rng: Rng,
  id: CharacterId,
  constitution: number,
  dice: readonly { readonly key: string; readonly sides: number }[],
  spent: HitDieSpent[],
): Result<readonly GameEvent[]> {
  const events: GameEvent[] = [];
  for (const { key, sides } of dice) {
    const rolled = rollRecorded(issuer, rng, `1d${sides}`);
    if (!rolled.ok) return rolled;

    // SRD: "You regain Hit Points equal to the total (minimum of 1)."
    const natural = rolled.value.total;
    const gain = Math.max(1, natural + constitution);
    spent.push({ key, sides, natural, regained: gain });

    events.push(
      { type: 'resource-spent', id, key, amount: 1 },
      {
        type: 'roll-recorded',
        who: id,
        label: `Hit Die (d${sides})`,
        natural,
        total: natural + constitution,
        contributions: [{ source: 'Constitution', amount: constitution }],
        outcome: `${gain} hit points`,
      },
    );
  }
  return ok(events);
}
