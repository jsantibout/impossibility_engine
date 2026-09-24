/**
 * A rolled amount a running effect takes off a hit before the defences meet it.
 *
 * SRD Resistance, the cantrip: "When the creature takes damage of the chosen
 * type before the spell ends, the creature reduces the total damage taken by
 * 1d4. A creature can benefit from this spell only once per turn."
 *
 * **Not the defence of the same name, and the collision of words is the whole
 * reason this is its own file.** `GrantedDefense` names a damage type and
 * grants Resistance, Immunity or Vulnerability over it — a *multiplier*, and
 * the second step of SRD's "Order of Application". This is the **first** step:
 * an adjustment, subtracted from the total before anything is halved, which is
 * observable rather than tidy. A d4 off 10 Fire against a fire-resistant
 * target leaves 3; halving first would leave 4, and the rounding step would be
 * taken twice.
 *
 * **The engine already knew how to subtract and had one door to it.**
 * `reduceDamage` takes an amount off a total and is reachable only from
 * `takeDamageReaction` — a Reaction somebody spends at a window. A *standing*
 * arrangement on the defender, consulted by every blow that arrives whether
 * anybody is watching or not, had no path to the arithmetic at all: that is
 * the gap `a-reduction-an-effect-applies-to-damage` named, and this is the
 * record that fills it. `standingReductionOf` in `commands/damage.ts` is the
 * one reader, shared by the dealt path and the held one.
 *
 * Here rather than in `standing.ts` for the reason `GrantedSense` is there and
 * `GrantedDefense` is in `attack.ts`: a grant type lives beside the function
 * that reads it, and what reads this is the damage pipeline.
 */
import type { CharacterId } from '@ie/shared';
import type { DamageComponent } from './attack.js';
import type { GameState } from './state.js';

/**
 * A reduction a running effect has hung on a creature.
 *
 * **`dice` is a notation and not a number**, exactly as a scheduled hit's and
 * a payout's are: the d4 is thrown when a blow actually arrives, so the faces
 * enter the log at the moment that produced them. Rolling at the cast would
 * put the answer in the log a minute before the question.
 *
 * **`damageTypes` is a list because the door it comes through hands one.**
 * `statedDamageType` rewrites a `damageTypes` field to the single type a
 * caster named — the same mechanism Protection from Energy's granted defence
 * uses — so the field is plural to be reachable by that rewrite, and SRD
 * Resistance leaves it holding exactly one.
 *
 * **`oncePerTurn` is a flag rather than a pool.** What enforces it is the
 * engine's own ledger, `feature-used { id, feature, turn }`, keyed on this
 * grant's `source`: the casting id is already unique per casting, so two
 * Resistances on one creature are two allowances and no new event, state
 * field or fold seam is needed. Outside combat there are no turns and nothing
 * restricts it, which is the reading `canUseFeatureThisTurn` already takes of
 * every once-per-turn line in the book.
 */
export interface GrantedDamageReduction {
  /** The casting (`Resistance#cast:0`) or the feature that granted it. */
  readonly source: string;
  /** What the log calls it when the die is thrown. */
  readonly label: string;
  /** Thrown at the blow, never at the cast. */
  readonly dice: string;
  /**
   * The kinds of damage the sentence is about.
   *
   * Compared as written against the component types a blow is made of, which
   * is the same table `applyDamage` sums into: `checkSpellDefinition` holds a
   * definition's list to the damage types the SRD prints, and
   * `statedDamageType` rewrites it to the one the caster named, so nothing
   * here has to normalise a string somebody made up.
   */
  readonly damageTypes: readonly string[];
  /** SRD Resistance's "only once per turn". Absent is no limit at all. */
  readonly oncePerTurn?: true;
}

/**
 * The reductions standing over this creature, in a fixed order.
 *
 * Sorted by source, because two of them would otherwise be rolled in whatever
 * order the grants happened to be filed in — and the order *is* which
 * reduction gets which die, exactly as it is for the repeat saves a boundary
 * raises out of one generator.
 */
export function damageReductionsOf(
  state: GameState,
  who: CharacterId,
): readonly GrantedDamageReduction[] {
  return [...(state.creatures[who]?.damageReductions ?? [])].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );
}

/**
 * Whether this blow is of a kind the reduction is about.
 *
 * "When the creature takes damage of the chosen type" — the trigger is a
 * *type present in the blow*, and what the sentence then reduces is "the total
 * damage taken". So the question asked here is about the components and the
 * answer is a yes or a no; how much comes off which type is `adjustmentsFor`'s,
 * which is the one place in the engine that already answers it.
 */
export function reductionApplies(
  reduction: GrantedDamageReduction,
  components: readonly DamageComponent[],
): boolean {
  return components.some(
    (component) => component.total > 0 && reduction.damageTypes.includes(component.type),
  );
}
