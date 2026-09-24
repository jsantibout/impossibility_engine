/**
 * What a creature simply **knows** about another, derived on every read.
 *
 * SRD Hunter's Lore: "You can call on the forces of nature to reveal certain
 * strengths and weaknesses of your prey. While a creature is marked by your
 * _Hunter's Mark_, you know whether that creature has any Immunities,
 * Resistances, or Vulnerabilities, and if so, what they are."
 *
 * **A fact, not a command**, which is the whole reason this is a module of
 * its own rather than a line in `commands/`. Nothing is spent, no action is
 * taken, no event is written and there is no refusal: the ranger either knows
 * or the sentence is not about them, and both answers are values. A command
 * would have to be *called* to be true, and would put a use where the book
 * puts none.
 *
 * It is the second thing the engine holds that only the table reads — SRD
 * Divine Sense's `detectedBy` is the first — and it is held under the same
 * ruling: the engine may hold such a fact when the fact is derived from state
 * and a door publishes it. The player's `look` is the door.
 *
 * **Two conditions, and neither is a catalogue id.** The knower holds a
 * `knowledge` grant compiled onto their sheet, and the target is marked by a
 * running casting of the knower's — an `attack-rider` whose effect wrote
 * `marksTarget`, which is a mechanical fact about the rider rather than a
 * spell's name. A homebrew spell that prints the same sentence marks a
 * creature, and this reads it.
 */

import type { CharacterId, ConditionName } from '@ie/shared';
import type { GameState } from './state.js';
import { conditionImmunitiesOf, defensesOf, knowledgeOn } from './standing.js';

/**
 * The run a stat block prints under one heading, as the sentence names it.
 *
 * Four lists rather than the `DamageDefenses` record `defensesOf` answers in,
 * because what the sentence asks for is "whether that creature has any … and
 * if so, what they are" — three named answers and the conditions beside them,
 * which is how a stat block prints them and how a table would say them.
 *
 * Each is sorted, so two readers of one state agree about the order.
 */
export interface KnownDefences {
  /**
   * Which feature says so — `DetectedCreature.feature`'s twin, and there for
   * the same reason: a door narrating the fact can say what told them, and a
   * caller can put the id back into `sheet` and find the line.
   */
  readonly feature: string;
  /** Damage types the creature takes nothing of. */
  readonly damageImmunities: readonly string[];
  /** Damage types it takes half of. */
  readonly damageResistances: readonly string[];
  /** Damage types it takes double of. */
  readonly damageVulnerabilities: readonly string[];
  /** Conditions it cannot be given at all — the other half of the printed run. */
  readonly conditionImmunities: readonly ConditionName[];
}

/**
 * Whether this creature's features let them know defences at all.
 *
 * Read off the compiled sheet through `standing.ts`, never off a feature id,
 * so a homebrew feature declaring the same grant is answered by the same
 * line.
 */
const licenceToKnowDefences = (state: GameState, knower: CharacterId): string | null =>
  knowledgeOn(state, knower).find(
    (fact) => fact.reveals === 'defenses' && fact.about === 'a-creature-your-casting-marks',
  )?.feature ?? null;

/**
 * Whether one of the knower's running castings has marked this creature.
 *
 * `GrantedAttackRider.target` is what `marksTarget` wrote, and the rider sits
 * on **the knower** — SRD Hunter's Mark is cast at a quarry ninety feet away
 * and the die is the ranger's — so this is a question about the knower's own
 * state and reaches the target only to compare ids.
 *
 * The casting's lifetime is the mark's: `releaseCasting`, a broken
 * Concentration, a dispel and the deadline all take the rider away through
 * the door every other sourced grant uses, so nothing here has to remember
 * that the spell has ended.
 */
const marks = (state: GameState, knower: CharacterId, target: CharacterId): boolean =>
  (state.creatures[knower]?.attackRiders ?? []).some((rider) => rider.target === target);

/**
 * What the knower knows about the target's defences, or **null**.
 *
 * Null is "this sentence is not about you two" and is the only other answer
 * there is: knowledge has no refusal, because there is nothing to refuse — no
 * action was taken and nothing was spent, so a `Result` would be a code the
 * caller could do nothing with. A caller that wants to know why asks the two
 * questions this asks.
 *
 * Both halves of a creature's defences are read through the gatherers rather
 * than off the record, so a Resistance a running spell hung on the quarry is
 * known exactly as a printed one is — the ranger is told what is true now,
 * which is what "reveal certain strengths and weaknesses" asks for.
 */
export function knownDefencesOf(
  state: GameState,
  knower: CharacterId,
  target: CharacterId,
): KnownDefences | null {
  if (state.creatures[target] === undefined) return null;
  const feature = licenceToKnowDefences(state, knower);
  if (feature === null) return null;
  if (!marks(state, knower, target)) return null;

  const defences = defensesOf(state, target);
  const withKind = (kind: 'immune' | 'resistant' | 'vulnerable'): readonly string[] =>
    Object.entries(defences)
      .filter(([, answer]) => answer[kind] === true)
      .map(([type]) => type)
      .sort();

  return {
    feature,
    damageImmunities: withKind('immune'),
    damageResistances: withKind('resistant'),
    damageVulnerabilities: withKind('vulnerable'),
    // Already sorted and deduplicated by the gatherer.
    conditionImmunities: conditionImmunitiesOf(state, target),
  };
}
