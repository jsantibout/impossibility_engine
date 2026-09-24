/**
 * What a creature's type is, as a **spell or other magical effect** reads it.
 *
 * > SRD Arcanist's Magic Aura, _Mask (Creature)_: "Choose a creature type
 * > other than the target's actual type. Spells and other magical effects
 * > treat the target as if it were a creature of the chosen type."
 *
 * `CreatureState.creatureType` is what the creature *is*, and nothing writes
 * over it: `creature-type-declared` is the one fact in the engine that refuses
 * re-declaration, because what a creature is cannot be argued with. The Mask
 * does not argue with it — it leaves the fact standing and changes what one
 * class of reader believes — so this is a second question rather than a second
 * answer to the first.
 *
 * ### Where the line falls, and why it is drawn by hand
 *
 * The SRD sentence names its own readers, and the naming is the rule: *spells
 * and other magical effects*. So the askers that read through this function
 * are the ones a casting or a feature makes —
 *
 * - `spellTargets`' `mustBeType`, which is Hold Person's "Choose a Humanoid";
 * - the area filter in `areaTargets`, which is the same clause over a catch,
 *   and is what a Channel Divinity option's own `mustBeType` is read at;
 * - `eligibleTargets`' shortlist, so the query and the cast agree;
 * - `TypedSaveOutcome` and `TypedExtraDamage`, which are Blight's Plant and
 *   Divine Smite's "a Fiend or an Undead".
 *
 * — and the asker that does **not** is a creature reading a creature. SRD
 * Ghoul's claw excepts "a non-Undead creature"; a Ghoul does not cast a spell
 * to claw somebody, so its printed line asks `creatureType` directly and gets
 * the goblin. `adaptMonster` and `formIneligibility` read a *stat block*
 * rather than a creature in play and are not about this at all.
 *
 * **Drawn by hand rather than derived, and that is the honest shape**: there
 * is no field on a call site saying whether it is magic, and inventing one
 * would be a second vocabulary for a distinction the book states in five
 * words. What keeps it from rotting is that every reader on the magical side
 * goes through this one function, so a new one is a visible choice rather than
 * an accident of which field somebody reached for.
 *
 * **One reader left on the wrong side, recorded rather than argued about.**
 * `commands/features.ts` checks a pool option's `excludesTypes` — SRD Lay on
 * Hands' "can't be used on an Undead or a Construct" — against the creature's
 * own type. That is a magical effect by the sentence above and should read the
 * Mask; the file belonged to another track on the batch this arrived in, and
 * routing it is one line. Until then the engine is conservative in the
 * direction that refuses rather than the one that permits.
 */
import type { CreatureState } from './state.js';

/**
 * A creature type one running effect has put over another creature's own.
 *
 * The nineteenth member of the family `grantsOf` enumerates, and the first
 * whose subject is a *fact about what a creature is* rather than a number, a
 * roll or a condition. Linked by its `source` exactly as the other eighteen
 * are, so `releaseCasting`, a dispel, a broken Concentration and a `grants`
 * deadline all take it away through the door that already existed.
 */
export interface GrantedCreatureType {
  /** The casting (`Arcanist's Magic Aura#cast:3`) or the feature that laid it. */
  readonly source: string;
  /** One of the SRD's fourteen, as the caster chose it at the casting. */
  readonly creatureType: string;
}

/**
 * The type a spell or other magical effect treats this creature as having.
 *
 * The newest mask wins where a creature is carrying two, which the fold's own
 * ordering settles: `creatureTypeMasks` is sorted by source and a second Mask
 * from a second casting is a second source. No SRD sentence puts two on one
 * creature — the spell replaces its own prior casting on the same target by
 * being cast again — so this is a tiebreak written down rather than a rule
 * anybody meets.
 *
 * Falls through to the creature's own type, including its `null`: a creature
 * nobody has typed and nobody has masked is still a thin record, and every
 * reader of this checks for that absence before reading the answer, exactly as
 * they do of the field itself.
 */
export function typeMagicSees(creature: CreatureState): string | null {
  const masks = creature.creatureTypeMasks;
  if (masks.length === 0) return creature.creatureType;
  return masks[masks.length - 1]!.creatureType;
}
