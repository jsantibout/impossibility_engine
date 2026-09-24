/**
 * The glossary's **hazards**, which are what a creature is caught *in* rather
 * than what has been done *to* it.
 *
 * SRD *Burning* [Hazard]: "A burning creature or object takes 1d4 Fire damage
 * at the start of each of its turns. As an action, you can extinguish fire on
 * yourself by giving yourself the Prone condition and rolling on the ground.
 * The fire also goes out if it is doused, submerged, or suffocated."
 *
 * **Not a sixteenth condition, and the book is why.** The rules glossary
 * prints the fifteen conditions as one closed list and files Burning under a
 * different heading with a different bracket; a stat block's "Immunities
 * Poison; Exhaustion, Poisoned" run reaches conditions and reaches nothing
 * here, so a creature immune to every condition in the game still burns. Made
 * a condition, it would have inherited `conditionApplicability`, the immunity
 * table and every rule that counts how many conditions a creature has — none
 * of which the book says about a fire.
 *
 * **Not a sourced grant either**, which is the other family it resembles.
 * Every member of that family is *hung on* a creature by an effect and ends by
 * a source match — a casting, a deadline, a dispel — and a fire ends by a
 * creature rolling on the ground. What lights it is not its lifetime: the
 * Magmin that set somebody alight can die and the fire goes on burning, which
 * is exactly what a source-matched release would get wrong.
 *
 * **The damage is the glossary's and not a stat block's**, which is why the
 * notation is here rather than pinned into the event that lights it. SRD
 * Magmin's Touch, SRD Fire Elemental's Burn and SRD Barbed Devil's Hurl Flame
 * each print "it starts burning" and none of them prints a die: the die is the
 * rule, and the rule is the engine's, so pinning a copy per hit would be three
 * copies of one sentence that could come to disagree. That is the same reading
 * `PrintedSaveDebt` keeps — a debt says what is owed and the rule says how
 * much.
 */

import type { CharacterId } from '@ie/shared';
import type { GameState } from './state.js';

/**
 * Every hazard a creature can be caught in, as the glossary names them.
 *
 * One member, and it is a union rather than a string for the reason
 * `ConditionName` is: a hazard a rule cannot name is a hazard nothing ends.
 * The glossary prints several more — Falling, Suffocation, Malnutrition — and
 * each arrives here the day a command takes it, which is the rule
 * `NAMED_ACTIONS` is kept by.
 */
export const HAZARDS = ['burning'] as const;

/** One of {@link HAZARDS}. */
export type HazardName = (typeof HAZARDS)[number];

/** What one hazard costs the creature caught in it, at which boundary. */
export interface HazardRule {
  /** SRD Burning's "1d4", thrown fresh at every boundary it falls due at. */
  readonly dice: string;
  readonly damageType: string;
}

/**
 * What each hazard costs, as the glossary prints it.
 *
 * Read at the turn boundary that collects it and nowhere else. The moment is
 * not a field: every hazard the book prints is collected at the *start* of the
 * caught creature's turns, and a field with one value is a member nothing
 * writes.
 */
export const HAZARD_RULES: Readonly<Record<HazardName, HazardRule>> = {
  burning: { dice: '1d4', damageType: 'fire' },
};

/**
 * A fire a creature is standing in, as state holds it.
 *
 * **The hazard is the identity.** A creature is burning or it is not; a second
 * Burn from a second elemental re-lights the same fire rather than doubling
 * the die, which is what the glossary's one sentence says and what a second
 * entry would quietly contradict. {@link lit} is carried for the log — a table
 * asking why somebody is on fire has one place to look — and is read by
 * nothing.
 */
export interface CreatureHazard {
  readonly hazard: HazardName;
  /** What set it: a printed line's own heading, or whatever a caller named. */
  readonly lit: string;
}

/** The source a hazard's effects are filed under, where anything files one. */
export const hazardSource = (hazard: HazardName): string => `hazard:${hazard}`;

/** Every hazard this creature is caught in, or none. */
export function hazardsOn(state: GameState, who: CharacterId): readonly CreatureHazard[] {
  return state.creatures[who]?.hazards ?? [];
}

/** Whether this creature is caught in a named hazard. */
export const caughtIn = (state: GameState, who: CharacterId, hazard: HazardName): boolean =>
  hazardsOn(state, who).some((one) => one.hazard === hazard);
