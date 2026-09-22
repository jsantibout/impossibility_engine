import type { Ability, ConditionName } from '@ie/shared';
import type { SenseName } from './positioning.js';

/**
 * A defence that answers somebody else's attack with **nobody taking a
 * Reaction**.
 *
 * Owner's ruling, 2026-09-22: three SRD spells intervene in an attack that
 * another creature is making, and the defender elects nothing at all. That is
 * not the mechanism the engine already had. A Reaction is a *window* — a
 * moment held open while somebody decides to step into it — and every one of
 * these fires whether the defender is watching, asleep or unaware the attack
 * happened. So the attack path **consults** them, the way it consults a
 * target's Armour Class, and no window opens, closes or moves.
 *
 * ## The three shapes, and why they are three and not one
 *
 * | | The sentence | The moment |
 * |---|---|---|
 * | {@link PassiveDecoys} | "Each time a creature **hits** you … roll a d6 for each of your remaining duplicates" | the hit is known |
 * | {@link PassiveRetaliation} | "whenever a creature within 5 feet of you **hits** you with a melee attack roll, the shield erupts" | the hit is known |
 * | {@link PassiveWard} | "any creature who **targets** the warded creature with an attack roll … must succeed on a Wisdom saving throw" | before the roll |
 *
 * Two of them read a blow that has already landed and one of them stops a
 * blow being thrown, which is the whole reason a single "passive defence"
 * kind with a flag would be the wrong shape: the ward's answer is *no attack
 * at all*, and the other two answer an attack that was made. A definition
 * that could say "before or after" would be able to say the two things that
 * make no sense — a ward consulted after the hit, which would spend an Attack
 * action the book leaves in the attacker's hand, and duplicates consulted
 * before one, which is the reading three earlier attempts at this shape took
 * and which the book does not support.
 *
 * ## What this module is not
 *
 * **Not a roll modifier.** `RollSelector` narrows *which rolls a mode reaches*
 * and none of these changes a number on a d20: a duplicate takes a blow that
 * hit, a shield burns the creature that hit it, a ward stops the roll
 * happening. `roll-modifiers.ts` is the right home for SRD Blur and the wrong
 * home for all three of these.
 *
 * **Not a condition, and not a sense.** Mirror Image's exception names one of
 * each in one sentence — "if it has the Blinded condition, Blindsight, or
 * Truesight" — so {@link PassiveDecoys} carries both axes rather than
 * borrowing `RollSelector.unlessPerceivedWith`, which is a selector's field
 * and reads only senses. `RollSelector.condition` is not the other half: it
 * names *what a saving throw is about*, which is a different question with the
 * same word in it.
 *
 * ## Numbers are content's and the mechanism is the engine's
 *
 * Three duplicates, a d6, a 3 to deflect, 2d8 of flame, five feet of reach:
 * every one is printed by a spell and none is written down here. What is
 * written down here is that a decreasing count is rolled one die at a time
 * and spent one per deflection, that a retaliation measures a distance and a
 * melee swing, and that a ward is a save the attacker makes. No file in this
 * package names a spell.
 */

/**
 * Illusory stand-ins that take a blow meant for their holder.
 *
 * SRD Mirror Image, and it is the one passive defence with a **count that
 * decreases** — which the engine had nowhere to put before this. Spell slots,
 * Ki and charges are pools, and every one of them is declared by creation, an
 * item or a stat block; nothing a casting hangs on a creature had ever counted
 * down.
 */
export interface PassiveDecoys {
  readonly kind: 'decoys';
  /** How many appear. SRD Mirror Image: "Three illusory duplicates". */
  readonly count: number;
  /**
   * The die thrown **for each one still standing**, which is what makes the
   * spell weaken as it is used up rather than ending all at once.
   */
  readonly die: string;
  /**
   * The face that sends the blow to a duplicate. SRD: "If **any** of the d6s
   * rolls a 3 or higher, one of the duplicates is hit instead of you."
   *
   * Any, not all: one die reaching it is enough, which is why the dice are
   * read individually rather than summed.
   */
  readonly deflectsOn: number;
  /**
   * Senses that make an attacker immune, read off the **attacker**.
   *
   * SRD: "A creature is unaffected by this spell if it has … Blindsight, or
   * Truesight." The same fact `RollSelector.unlessPerceivedWith` reads for
   * Blur, asked here because this is not a roll modifier — and read with
   * `sensesPerceiving`, never with `canSee`: ordinary sight is exactly what a
   * hall of duplicates defeats, so a declared sight line must excuse nobody.
   */
  readonly unlessPerceivedWith?: readonly SenseName[];
  /**
   * Conditions that make an attacker immune, read off the **attacker**.
   *
   * SRD: "if it has the **Blinded** condition". The half of that sentence no
   * axis in the engine could express — a sense list cannot hold a condition
   * name, and the condition axis that exists is about what a saving throw
   * avoids.
   *
   * It reads the attacker's *effective* conditions, so a condition some
   * feature has suppressed excuses nobody.
   */
  readonly unlessCondition?: readonly ConditionName[];
  /**
   * The casting ends when the last one is spent.
   *
   * SRD: "The spell ends when all three duplicates are destroyed." Stated by
   * the definition rather than assumed, because a spell that left its empty
   * frame standing would be a different spell and the engine must not pick
   * which one this is.
   */
  readonly endsWhenSpent?: true;
}

/**
 * A save the **attacker** makes for daring to aim at the holder.
 *
 * SRD Sanctuary. The odd one in every way: it fires before the attack roll
 * rather than after it, the creature who rolls is the one attacking rather
 * than the one defending, and what it costs on a failure is the attack
 * itself.
 */
export interface PassiveWard {
  /** The ability the attacker saves with. SRD Sanctuary: Wisdom. */
  readonly ability: Ability;
  readonly kind: 'ward';
}

/**
 * Damage dealt back to whoever lands a blow.
 *
 * SRD Fire Shield. Nothing decreases and nobody saves; the flames simply
 * answer, which is what makes this the smallest of the three.
 */
export interface PassiveRetaliation {
  readonly kind: 'retaliation';
  /** SRD Fire Shield: "The attacker takes **2d8** Fire damage". */
  readonly damage: string;
  /** SRD Fire Shield: "hits you with a **melee** attack roll". */
  readonly melee?: true;
  /** SRD Fire Shield: "whenever a creature **within 5 feet of you** hits you". */
  readonly withinFeet?: number;
  /**
   * The pair this deals **the other** of, when the casting states one of them.
   *
   * SRD Fire Shield prints one choice and hangs two opposite answers on it:
   * "The warm shield grants you Resistance to **Cold** damage, and the chill
   * shield grants you Resistance to **Fire** damage … The attacker takes 2d8
   * **Fire** damage from a warm shield or 2d8 **Cold** damage from a chill
   * shield." The caster states the type they want Resistance to, and the
   * flames are the other one.
   *
   * `damageTypeStated` already carries a casting's choice into every effect
   * that prints a type, so the Resistance lands correctly on its own. What it
   * cannot do is *invert* one, and a rule that inverted it by naming this
   * spell would be the sweep's whole reason for existing. So the pair is
   * printed by the definition and the engine takes the member the casting did
   * not name — a statement about a two-way choice, not about a spell.
   *
   * Absent for a retaliation whose type is fixed, which is every other one
   * that could be written: then the effect's own `damageType` is dealt.
   */
  readonly complementOf?: readonly string[];
}

/** The three, as a definition prints them. */
export type PassiveDefense = PassiveDecoys | PassiveWard | PassiveRetaliation;

/** The vocabulary as data, for the validator that reads untyped input. */
export const PASSIVE_DEFENSE_KINDS: ReadonlySet<string> = new Set([
  'decoys',
  'ward',
  'retaliation',
]);

/**
 * A passive defence as it stands on a creature, with every number settled.
 *
 * The pinning rule, and the reason this is a second type rather than the one
 * above stored as it was written: a ward's DC is the caster's at the moment
 * of the casting, a retaliation's damage type is the one the casting chose,
 * and a decoy count is a number that moves. None of the three can be re-read
 * from a definition later — the fold opens no catalogue — so what the grant
 * carries is the answer rather than the question.
 */
export type PassiveDefenseState =
  | {
      readonly kind: 'decoys';
      /** How many are left. Three at the casting, and down by one per deflection. */
      readonly remaining: number;
      readonly die: string;
      readonly deflectsOn: number;
      readonly unlessPerceivedWith?: readonly SenseName[];
      readonly unlessCondition?: readonly ConditionName[];
      readonly endsWhenSpent?: true;
    }
  | {
      readonly kind: 'ward';
      readonly ability: Ability;
      /** The caster's save DC, pinned at the casting like every other one. */
      readonly dc: number;
    }
  | {
      readonly kind: 'retaliation';
      readonly damage: string;
      /** The type settled at the casting, complement and all. */
      readonly damageType: string;
      readonly melee?: true;
      readonly withinFeet?: number;
    };

/**
 * A passive defence a running casting has hung on a creature.
 *
 * The durable half, stored on `CreatureState.passiveDefenses` beside
 * `bonuses`, `armorClasses` and `rollModifiers`, and linked the same way: the
 * `source` carries the casting, so `releaseCasting` ends it with the spell
 * through machinery that already existed. There is no removal event and no
 * second lifecycle — `decoy-destroyed` moves a number and never removes a
 * grant.
 */
export interface ActivePassiveDefense {
  readonly source: string;
  readonly defense: PassiveDefenseState;
}

/**
 * Whether an attacker is excused from a set of decoys.
 *
 * Both axes at once, because the SRD writes them in one sentence and means
 * either: a Blinded attacker is unaffected, and so is one with Truesight.
 * Pure, so the attack path and a test can ask the same question.
 */
export function decoysExcuse(
  defense: Extract<PassiveDefenseState, { kind: 'decoys' }>,
  attacker: {
    readonly perceivesWith: readonly SenseName[];
    readonly conditions: readonly ConditionName[];
  },
): boolean {
  for (const sense of defense.unlessPerceivedWith ?? []) {
    if (attacker.perceivesWith.includes(sense)) return true;
  }
  for (const condition of defense.unlessCondition ?? []) {
    if (attacker.conditions.includes(condition)) return true;
  }
  return false;
}

/**
 * Whether a blow is the kind a retaliation answers.
 *
 * SRD Fire Shield asks two things of the swing and neither is about the
 * attacker: it has to be melee, and it has to come from inside five feet.
 *
 * **An undeclared distance is not a refusal.** Nobody has said where the two
 * creatures are standing, so the rule went unapplied rather than being
 * checked — the reading the whole attack path already takes of an unplaced
 * creature, and the caller is told through `unverified` rather than the
 * flames being guessed either way.
 */
export function retaliationReaches(
  defense: Extract<PassiveDefenseState, { kind: 'retaliation' }>,
  blow: { readonly melee: boolean; readonly apart: number | null },
): 'yes' | 'no' | 'unknown' {
  if (defense.melee === true && !blow.melee) return 'no';
  if (defense.withinFeet === undefined) return 'yes';
  if (blow.apart === null) return 'unknown';
  return blow.apart <= defense.withinFeet ? 'yes' : 'no';
}

/**
 * The member of a printed pair that a casting did not name.
 *
 * Null where the pair does not hold the stated type, which the validator
 * refuses at authoring time — so a null here is a definition that got past it
 * and the caller falls back to the type the effect carries rather than
 * inventing one.
 */
export function complementType(pair: readonly string[], stated: string): string | null {
  const other = pair.filter((type) => type !== stated);
  return other.length === 1 && pair.includes(stated) ? other[0]! : null;
}
