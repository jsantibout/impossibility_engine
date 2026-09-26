/**
 * The size a creature is, as every rule that asks should read it.
 *
 * Three answers can disagree, and before this each reader picked its own
 * order. **What somebody stated** is `CreatureState.size`: a stat block pins
 * one into `creature-added` and creation pins the species'. **What the map
 * holds** is `scene.sizes`, which a placement defaults to Medium when nobody
 * stated one, and which the fold's `settleSizes` keeps in step with a feature
 * that prints a size while it runs. **What a feature prints** is that last
 * thing — SRD Large Form: "you become Large" — and it is the one answer the
 * readers were not asking: they read the record first, so a Goliath in Large
 * Form was Large on the map and Medium to every Grapple, Shove and Hide.
 *
 * So the order is: the size an active feature prints, then the size somebody
 * stated, then the map's — the map last because its default is an assumption
 * and a stated Gargantuan must beat an unstated Medium.
 */
import type { CharacterId } from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
import { shiftSize, sizeOf } from './positioning.js';
import type { CreatureState, GameState } from './state.js';

/**
 * A size one running effect has moved a creature's own by, in categories.
 *
 * SRD Enlarge/Reduce: "The target's size increases by one category — from
 * Medium to Large, for example." **A step and not a size**, because the book
 * prints a step: the same casting makes a Small goblin Medium and a Medium
 * fighter Large, and a grant that pinned "large" would have had to know at the
 * casting what the creature was. The creature-type Mask is the twin — a fact
 * about what a creature *is*, worn for a duration and given back — and this is
 * the same sourced grant over the other fact, so `releaseCasting`, a dispel, a
 * broken Concentration and a `grants` deadline all take it away through the
 * door the Mask already uses. {@link effectiveSizeOf} is the reader; the fold's
 * `settleSizes` keeps the map in step for a creature whose size is stated.
 */
export interface GrantedSize {
  /** The casting (`Enlarge/Reduce#cast:3`) that moved it. */
  readonly source: string;
  /** Categories up (positive) or down (negative); the book prints one either way. */
  readonly steps: number;
}

/**
 * A creature's base size as every running override has moved it.
 *
 * Summed, because two castings that each say "one category" say two — and
 * clamped by {@link shiftSize} at the book's ends, because there is nothing
 * below Tiny or above Gargantuan for a third to reach.
 */
export function overriddenSizeOf(creature: CreatureState, base: CreatureSize): CreatureSize {
  const steps = creature.sizeOverrides.reduce((sum, held) => sum + held.steps, 0);
  return steps === 0 ? base : shiftSize(base, steps);
}

/** The size an active feature prints for this creature, or null where none does. */
export function printedSizeOf(creature: CreatureState): CreatureSize | null {
  const printing = (creature.sheet.activated ?? []).filter((one) => one.size !== undefined);
  if (printing.length === 0) return null;
  return printing.find((one) => creature.activeFeatures.includes(one.feature))?.size ?? null;
}

/** Whether any feature on the sheet prints a size, active or not. */
export function printsASize(creature: CreatureState): boolean {
  return (creature.sheet.activated ?? []).some((one) => one.size !== undefined);
}

/**
 * The size the rules read for this creature: printed, then stated, then the
 * map's — and then moved by whatever a running effect has done to it.
 *
 * **The override is applied last and to whichever answer stood**, because SRD
 * Enlarge/Reduce prints a step rather than a size: a Goliath in Large Form
 * under Enlarge is Huge, and a goblin nobody sized is the map's Medium made
 * Large. For a creature whose size is stated, `settleSizes` in the fold has
 * already moved the map by the same step, so the two answers agree; for one
 * whose size is not, the map keeps its default and the shift is read here.
 */
export function effectiveSizeOf(state: GameState, who: CharacterId): CreatureSize | null {
  const creature = state.creatures[who];
  const mapped = state.scene === null ? null : sizeOf(state.scene, who);
  if (creature === undefined) return mapped;
  const base = printedSizeOf(creature) ?? creature.size ?? mapped;
  return base === null ? null : overriddenSizeOf(creature, base);
}
