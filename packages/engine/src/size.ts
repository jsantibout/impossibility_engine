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
import { sizeOf } from './positioning.js';
import type { CreatureState, GameState } from './state.js';

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

/** The size the rules read for this creature: printed, then stated, then the map's. */
export function effectiveSizeOf(state: GameState, who: CharacterId): CreatureSize | null {
  const creature = state.creatures[who];
  const mapped = state.scene === null ? null : sizeOf(state.scene, who);
  if (creature === undefined) return mapped;
  return printedSizeOf(creature) ?? creature.size ?? mapped;
}
