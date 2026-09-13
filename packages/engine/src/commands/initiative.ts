/**
 * Rolling Initiative for a creature the engine knows.
 *
 * Its own module because it is its own thing, which the single file had
 * obscured by filing it at the end of the spell region. Initiative is an
 * ability check, so a feat's Proficiency Bonus and a magic item's bonus apply,
 * and the creature's own `initiativeBonuses` ride on it without a caller
 * having to remember them.
 */

import { type CharacterId, type Result, type RollMode } from '@ie/shared';
import { type ModeSource } from '../bonuses.js';
import { type InitiativeOptions, type InitiativeRoll, rollInitiative } from '../combat.js';
import { type Rng } from '../dice.js';
import { type GameState } from '../events.js';
import { type RollIssuer } from '../rolls.js';
import { effectiveConditions, rollModesFor } from '../standing.js';
import { creatureOf, unknownCreature } from './command.js';

/**
 * Roll Initiative for a creature, with whatever its own features contribute.
 *
 * SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus to
 * the roll." The engine already knows about that — creation worked it out — so
 * making a caller remember to pass it is how a character silently stops having
 * the feat they paid for. Supplied once, named in the roll, and deduplicated
 * against anything the caller adds, so it cannot land twice.
 */
export function rollInitiativeFor(
  state: GameState,
  id: CharacterId,
  issuer: RollIssuer,
  rng: Rng,
  options: InitiativeOptions = {},
): Result<InitiativeRoll> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const own = creature.initiativeBonuses;
  const supplied = options.bonuses ?? [];
  const mine = own.filter((bonus) => !supplied.some((other) => other.source === bonus.source));

  // SRD Feral Instinct and Remarkable Athlete both say "Advantage on
  // Initiative rolls", and a modifier somebody has to remember is one a
  // character silently stops having — the same rule Alert's bonus above
  // already follows. Deduplicated by source, so a caller who also knows about
  // the feature does not apply it twice.
  const named = new Map<string, ModeSource>();
  for (const mode of rollModesFor(state, { family: 'initiative', roller: id }).modes) {
    named.set(mode.source, mode);
  }
  const bare: (RollMode | ModeSource)[] = [];
  for (const mode of options.modes ?? []) {
    if (typeof mode === 'string') bare.push(mode);
    else named.set(mode.source, mode);
  }

  return rollInitiative(issuer, rng, id, creature.sheet, {
    ...options,
    conditions: options.conditions ?? effectiveConditions(state, id),
    bonuses: [...supplied, ...mine],
    modes: [...bare, ...named.values()],
  });
}

