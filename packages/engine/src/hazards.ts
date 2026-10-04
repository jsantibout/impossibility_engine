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
import { abilityModifier } from './character.js';
import { hasPrintedTrait } from './monster.js';
import { abilityScoresOf, standingFor } from './standing.js';
import { attachedTo, type GameState } from './state.js';

/**
 * Every hazard a creature can be caught in, as the glossary names them.
 *
 * A union rather than a string for the reason `ConditionName` is: a hazard a
 * rule cannot name is a hazard nothing ends. The glossary prints several more
 * — Falling, Malnutrition, Dehydration — and each arrives here the day a
 * command takes it, which is the rule `NAMED_ACTIONS` is kept by. Suffocation
 * arrived with the holds that smother (M-HOLD); see {@link BreathTaken}.
 */
export const HAZARDS = ['burning', 'suffocating'] as const;

/** One of {@link HAZARDS}. */
export type HazardName = (typeof HAZARDS)[number];

/** What one hazard costs the creature caught in it, at which boundary. */
export interface HazardRule {
  /** SRD Burning's "1d4", thrown fresh at every boundary it falls due at. */
  readonly dice: string;
  readonly damageType: string;
}

/**
 * What each hazard costs in **damage**, as the glossary prints it.
 *
 * Read at the turn boundary that collects it and nowhere else. The moment is
 * not a field: every hazard the book prints damage for is collected at the
 * *start* of the caught creature's turns, and a field with one value is a
 * member nothing writes. Suffocation deals none — what it costs is Exhaustion,
 * at the *end* of the creature's turns, which {@link outOfBreath} answers and
 * the boundary in `commands/turns.ts` collects — so it has no row here.
 */
export const HAZARD_RULES: Readonly<Partial<Record<HazardName, HazardRule>>> = {
  burning: { dice: '1d4', damageType: 'fire' },
};

/**
 * A hazard a creature is caught in, as state holds it.
 *
 * **The hazard is the identity.** A creature is burning or it is not; a second
 * Burn from a second elemental re-lights the same fire rather than doubling
 * the die, which is what the glossary's one sentence says and what a second
 * entry would quietly contradict. {@link lit} is carried for the log — a table
 * asking why somebody is on fire has one place to look — and is read by
 * nothing.
 *
 * **Suffocation carries three more facts, and only it does** (M-HOLD). A fire
 * goes on burning whatever lit it; a creature that cannot breathe can breathe
 * again the moment what smothers it lets go — so its record says which holds
 * are taking its breath ({@link while}), when it began holding that breath
 * ({@link since}), and how many Exhaustion levels the suffocation has cost it
 * ({@link gained}), which the glossary takes back when it can breathe again.
 * The last two are the fold's to stamp: an event that names a hold names no
 * number, for the reason a Burn's names no die.
 */
export interface CreatureHazard {
  readonly hazard: HazardName;
  /** What set it: a printed line's own heading, or whatever a caller named. */
  readonly lit: string;
  /** Suffocation only: the holds taking the creature's breath, sorted by source. */
  readonly while?: readonly BreathTaken[];
  /** Suffocation only: the clock when its breath was first held — stamped by the fold. */
  readonly since?: number;
  /** Suffocation only: Exhaustion levels it has gained from suffocating — kept by the fold. */
  readonly gained?: number;
}

// — Suffocation — M-HOLD ————————————————————————————————————————————————————

/**
 * How a printed hold says a creature's breath is taken — M-HOLD.
 *
 * SRD Animated Rug of Smothering, SRD Darkmantle and SRD Gelatinous Cube:
 * "is suffocating". SRD Water Elemental: "is suffocating **unless it can
 * breathe water**", which is the only exception the book prints. Read by the
 * parsers (`suffocationWords` on the hit side, `printed-save.ts` on the save
 * side) and nowhere else from prose.
 */
export type Suffocates = 'always' | 'unless-it-breathes-water';

/**
 * One hold taking a creature's breath, and how to tell it still stands.
 *
 * **Three holds, three records, and the hazard reads each where it lives**
 * rather than keeping a copy of the hold: a grapple is the Grappled instance
 * filed under its source, an attach is the attacher's own `attachments`
 * record, and an engulf is the creature's `elsewhere` record. So every way a
 * hold ends — an escape, a lapse lifted, a release, a detach, a pull out, a
 * death the fold already frees the swallowed of — ends the suffocation with no
 * door of its own (see {@link holdTakesBreath}).
 */
export interface BreathTaken {
  readonly by: 'grapple' | 'attach' | 'inside';
  /**
   * What the hold files under: the Grappled's source, `attach:<attacher>` on
   * the attached creature, or the `elsewhere` record's source.
   */
  readonly source: string;
  /** SRD Water Elemental's "unless it can breathe water". */
  readonly unlessItBreathesWater?: true;
}

/**
 * Whether a creature can breathe water — M-HOLD, for the one exception the
 * book prints on a hold (SRD Whelm).
 *
 * Read off what the creature is: a stat block that prints SRD Amphibious or
 * SRD Water Breathing (`breathes-air-and-water`, `breathes-only-water` — and a
 * Wild Shape's form, whose traits are the sheet's), a standing grant a worn
 * item or a feature confers (`breathes-water`), or a casting that conferred it
 * (`CreatureState.waterBreathing`, SRD *Water Breathing* and *Alter Self*).
 */
export function breathesWater(state: GameState, who: CharacterId): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (hasPrintedTrait(creature.sheet, 'breathes-air-and-water')) return true;
  if (hasPrintedTrait(creature.sheet, 'breathes-only-water')) return true;
  if ((creature.waterBreathing ?? []).length > 0) return true;
  return standingFor(state, who).some((active) => active.effect.grant.kind === 'breathes-water');
}

/**
 * How long a creature can hold its breath, in seconds — M-HOLD.
 *
 * SRD *Suffocation* [Hazard]: "A creature can hold its breath for a number of
 * minutes equal to 1 plus its Constitution modifier (minimum of 30 seconds)
 * before suffocation begins." A stat block that prints a span of its own says
 * how long instead: SRD Hold Breath ("can hold its breath for 1 hour") and SRD
 * Giant Octopus's "It can hold its breath for 1 hour outside water", which is
 * the span the octopus has when something smothers it — the engine holds no
 * water to tell the two apart, and the longer span is the one the book gave
 * the creature. The Constitution is the score as it stands, a drain or a belt
 * included.
 */
export function breathSecondsOf(state: GameState, who: CharacterId): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 30;
  for (const trait of creature.sheet.stated?.traits ?? []) {
    if (trait.kind === 'holds-its-breath') return trait.minutes * 60;
    if (trait.kind === 'breathes-only-water' && trait.holdsBreathMinutes !== undefined) {
      return trait.holdsBreathMinutes * 60;
    }
  }
  const constitution = abilityModifier(abilityScoresOf(state, who).con);
  return Math.max(30, 60 * (1 + constitution));
}

/**
 * Whether one hold is still taking this creature's breath — M-HOLD.
 *
 * Read off the record each hold already keeps (see {@link BreathTaken}), and
 * **the Water Elemental's exception read live**: a creature whelmed and then
 * given *Water Breathing* can breathe again at once, which is the book's
 * "unless it can breathe water" read at every moment rather than only at the
 * one it was caught.
 */
export function holdTakesBreath(state: GameState, who: CharacterId, hold: BreathTaken): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (hold.unlessItBreathesWater === true && breathesWater(state, who)) return false;
  switch (hold.by) {
    case 'grapple':
      return creature.conditions.instances.some(
        (instance) => instance.condition === 'grappled' && instance.source === hold.source,
      );
    case 'attach': {
      const attacher = attachedTo(hold.source);
      return (
        attacher !== null &&
        (state.creatures[attacher]?.attachments ?? []).some((attached) => attached.to === who)
      );
    }
    case 'inside':
      return creature.elsewhere?.source === hold.source;
  }
}

/** The suffocation a creature is caught in, or null. */
export const suffocationOn = (state: GameState, who: CharacterId): CreatureHazard | null =>
  hazardsOn(state, who).find((one) => one.hazard === 'suffocating') ?? null;

/**
 * Whether some hold is taking this creature's breath right now — M-HOLD.
 *
 * Not the same as being caught: SRD Whelm holds a Merfolk that breathes water
 * and takes nothing from it. Read live, hold by hold, so the answer is the
 * world's and not a copy the fold kept.
 */
export function isSuffocating(state: GameState, who: CharacterId): boolean {
  const held = suffocationOn(state, who);
  return held !== null && (held.while ?? []).some((hold) => holdTakesBreath(state, who, hold));
}

/**
 * Whether this creature has run out of breath — M-HOLD.
 *
 * SRD *Suffocation*: "When a creature runs out of breath …, it gains 1
 * Exhaustion level at the end of each of its turns." Out of breath is the
 * clock past the moment its breath began to be held plus the span it can hold
 * it for; `at` is the clock to read, which the boundary passes as the moment
 * the turn *ended* — before a round's wrap charged six more seconds.
 */
export function outOfBreath(state: GameState, who: CharacterId, at: number = state.elapsed): boolean {
  const held = suffocationOn(state, who);
  if (held?.since === undefined) return false;
  if (!(held.while ?? []).some((hold) => holdTakesBreath(state, who, hold))) return false;
  return at >= held.since + breathSecondsOf(state, who);
}

/** The source a hazard's effects are filed under, where anything files one. */
export const hazardSource = (hazard: HazardName): string => `hazard:${hazard}`;

/** Every hazard this creature is caught in, or none. */
export function hazardsOn(state: GameState, who: CharacterId): readonly CreatureHazard[] {
  return state.creatures[who]?.hazards ?? [];
}

/**
 * The hazard a printed hold puts a creature in when it takes its breath —
 * M-HOLD. One event per hold, naming the hold and no number: the fold stamps
 * the clock and keeps the count (see {@link CreatureHazard}).
 */
export const breathTakenBy = (
  who: CharacterId,
  lit: string,
  hold: BreathTaken,
): { readonly type: 'hazard-caught'; readonly id: CharacterId; readonly hazard: CreatureHazard } => ({
  type: 'hazard-caught',
  id: who,
  hazard: { hazard: 'suffocating', lit, while: [hold] },
});

/**
 * What lighting a **declared object** reports, beside the mark — M-MATTER.
 *
 * SRD Burning's 1d4 falls due "at the start of each of its turns", and an
 * object takes none: `declare_object` says so in as many words and the turn
 * order holds only what fights. So the mark stands on the object — a Sleet
 * Storm douses it as it douses a creature — and the die never falls due on
 * its own. **The literal reading, taken and said rather than guessed past**:
 * the book prints no moment for a thing with no turns, and whether a burning
 * door is eaten at the top of each round, on the turn of whoever lit it, or
 * only when the table says is an owner's question. Until it is answered, the
 * table rolls the fire through the door that rolls damage it has ruled.
 */
export const objectHasNoTurnToBurnAt = (thing: string): string =>
  `${thing} is burning; the glossary's 1d4 Fire falls due at the start of each of its turns, and an object takes no turns — when the fire eats it is the table's to rule, and the engine rolls it when asked`;

/** Whether this creature is caught in a named hazard. */
export const caughtIn = (state: GameState, who: CharacterId, hazard: HazardName): boolean =>
  hazardsOn(state, who).some((one) => one.hazard === hazard);
