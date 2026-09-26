/**
 * **What a stat block's own traits do to its holder as its turn begins** —
 * W7-B12.
 *
 * SRD Troll, Regeneration: "The troll regains 15 Hit Points at the start of
 * each of its turns. If the troll takes Acid or Fire damage, this trait doesn't
 * function on the troll's next turn. The troll dies only if it starts its turn
 * with 0 Hit Points and doesn't regenerate."
 *
 * SRD Vampire Spawn, Sunlight: "The vampire takes 20 Radiant damage if it
 * starts its turn in sunlight."
 *
 * **The holder's own body, read at the one moment both sentences name.** A
 * Fire Aura burns somebody else and a recharge gives back a line; these two
 * change the holder's Hit Points, and the first of them is the only rule in
 * the book that decides at a turn's start whether a monster at 0 is dead.
 *
 * **Its own module**, so the boundary's hunk is a call rather than a body —
 * `commands/turns.ts` is shared by more tracks than one, the reason
 * `turn-start-dice.ts` gave for itself.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { hasCondition } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { printedRegeneration, REGENERATION, regenerationStoppedSource } from '../monster.js';
import { lightAt, positionOf } from '../positioning.js';
import { timerKey } from '../timers.js';
import type { Supply } from './casting.js';
import { ZERO_HIT_POINTS } from './command.js';
import { healCreature } from './creatures.js';
import { dealSpellDamage } from './damage.js';

/** What the start of one creature's turn did to it, and what it could not check. */
export interface TurnStartBody {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
}

const NOTHING: TurnStartBody = { events: [], unverified: [] };

/**
 * Settle the beginning creature's Regeneration and its Sunlight, in that order.
 *
 * **Regeneration first**, because its last sentence is about the Hit Points the
 * creature *starts* its turn with: a troll the sun left at 0 in the same breath
 * would otherwise die of a death the book times before the sun. No SRD block
 * prints both.
 *
 * - **The marker stands** — acid or fire since the end of its last turn: no
 *   heal, and a creature at 0 dies.
 * - **It does not** — the printed amount through `healCreature`, the one door
 *   hit points come back through, so SRD Chill Touch's "can't regain Hit
 *   Points" stops it too; a heal that door refuses is a creature that "doesn't
 *   regenerate", and at 0 that is its death.
 * - **At its maximum** nothing is written, because there is nothing to regain.
 *
 * **Sunlight second**: the flat amount, through the funnel every spell's damage
 * goes through, where the creature is standing in sunlight by `lightAt` — a
 * creature nobody placed is in no sunlight, the reading the `in-sunlight`
 * requirement already takes. A generator is needed because the funnel may
 * throw one (an Undead Fortitude, a ward's die); without one a burn that is
 * owed is refused, on `boundary_damage_owed`'s rule.
 */
export function settleStartOfTurnBody(
  state: GameState,
  supply: Supply | undefined,
  begun: CharacterId | undefined,
): Result<TurnStartBody> {
  if (begun === undefined) return ok(NOTHING);
  const creature = state.creatures[begun];
  if (creature === undefined || creature.vitals.dead) return ok(NOTHING);

  const events: GameEvent[] = [];
  const unverified: string[] = [];
  let current = state;
  const land = (more: readonly GameEvent[]): void => {
    events.push(...more);
    current = more.reduce(applyEvent, current);
  };

  // — Regeneration ——————————————————————————————————————————————————————————
  const regeneration = printedRegeneration(creature.sheet);
  if (regeneration !== null) {
    const stopped =
      current.timers[
        timerKey({ kind: 'grants', on: begun, source: regenerationStoppedSource(begun) })
      ] !== undefined;
    let regenerated = false;
    if (!stopped && creature.vitals.hp < creature.vitals.hpMax) {
      const healed = healCreature(current, begun, regeneration.hitPoints, {}, REGENERATION);
      if (!healed.ok) return healed;
      regenerated = healed.value.length > 0;
      land(healed.value);
    }
    // "The troll dies only if it starts its turn with 0 Hit Points and doesn't
    // regenerate." Only a block this reader holds the death for is ever at 0
    // here and alive — every other monster died at the drop.
    const standing = current.creatures[begun];
    if (standing !== undefined && standing.vitals.hp === 0 && !regenerated) {
      land([
        {
          type: 'creature-died',
          id: begun,
          cause: `${REGENERATION}: it started its turn at 0 Hit Points and did not regenerate`,
        },
        ...(hasCondition(standing.conditions, 'unconscious')
          ? [
              {
                type: 'condition-removed' as const,
                id: begun,
                condition: 'unconscious' as const,
                source: ZERO_HIT_POINTS,
              },
            ]
          : []),
      ]);
      return ok({ events, unverified });
    }
  }

  // — Sunlight ——————————————————————————————————————————————————————————————
  for (const trait of creature.sheet.stated?.traits ?? []) {
    if (trait.kind !== 'disadvantage-in-sunlight' || trait.hurtAtTurnStart === undefined) continue;
    const where = current.scene === null ? null : positionOf(current.scene, begun);
    if (where === null || !lightAt(current, where).sunlight) continue;
    if (current.creatures[begun]?.vitals.dead !== false) break;
    if (supply === undefined) {
      return err(
        'boundary_damage_owed',
        `${begun} starts its turn in sunlight and its block burns it for it; advancing needs a generator for the damage the burn may set off`,
      );
    }
    const { amount, damageType } = trait.hurtAtTurnStart;
    const label = `${damageType} damage from sunlight`;
    const burnt = dealSpellDamage(
      current,
      begun,
      [{ source: label, type: damageType, roll: null, flat: amount, total: amount }],
      label,
      supply,
      {},
    );
    if (!burnt.ok) return burnt;
    land(burnt.value.events);
    unverified.push(...burnt.value.unverified);
  }

  return ok({ events, unverified });
}
