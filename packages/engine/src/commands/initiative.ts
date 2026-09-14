/**
 * Initiative: rolling for it, and taking a place in the order it settles.
 *
 * Its own module because it is its own thing, which the single file had
 * obscured by filing it at the end of the spell region. Initiative is an
 * ability check, so a feat's Proficiency Bonus and a magic item's bonus apply,
 * and the creature's own `initiativeBonuses` ride on it without a caller
 * having to remember them.
 *
 * The two commands here are the pair a caller needs and had only half of: a
 * number, and somewhere to put it. `beginCombat` puts a whole list of numbers
 * into a fight that has not started; {@link joinCombat} puts one into a fight
 * that has.
 */

import { err, ok, type CharacterId, type Result, type RollMode } from '@ie/shared';
import { type ModeSource } from '../bonuses.js';
import {
  addCombatant,
  type CombatantInput,
  type InitiativeOptions,
  type InitiativeRoll,
  rollInitiative,
} from '../combat.js';
import { type Rng } from '../dice.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
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


/**
 * Put one creature into a fight already under way.
 *
 * **The hole this closes was written down from the other side.** A
 * turn-anchored duration whose anchor is not in the running fight asks for "a
 * place in the Initiative order", and until this command existed the request
 * had to name two commands, neither of which did the job: `rollInitiativeFor`
 * produces a number and changes no order, and `beginCombat` *replaces* the
 * order, which is not a repair for a fight that is already running. A
 * reinforcement walking in mid-fight is the most ordinary thing at a table and
 * the engine had no way to say it had happened.
 *
 * **The Initiative total is the caller's, exactly as it is at `beginCombat`.**
 * SRD rolls it — `rollInitiativeFor` is where a creature's Alert bonus and any
 * Advantage on the roll are applied — or the GM takes `passiveInitiative`
 * instead. The engine ranks; it does not roll on anybody's behalf, and it does
 * not decide that a creature should be in a fight. The pinned Speed travels
 * with the number for the same reason, which is why the whole `CombatantInput`
 * is the argument.
 *
 * **Nothing here decides that combat has begun**, and nothing here may. When a
 * fight starts is the DM's authority; this command is what the layer above
 * calls once that judgement has been made.
 *
 * **It spends nothing and is deliberately not guarded**, which is the
 * combination `relocateCreature` documents the other half of. That command
 * spends nothing either and asks `mayAct` anyway, because it is an
 * authoritative *position* change that raises area debts, and two operations
 * that both move a creature must not disagree about whether the world has to
 * be settled first. None of that is true here: joining an order moves nobody,
 * raises no debt, rolls nothing, and leaves every budget and the creature
 * currently acting exactly as they were — so there is no world an owed
 * settlement could change out from under it. `beginCombat` is the sibling
 * operation on the same piece of state and is unguarded for the same reason.
 *
 * Three refusals. A creature the engine has never been told about is
 * `unknown_creature`, with the request that repairs it. A creature already in
 * the order is `duplicate_combatant` — `startCombat`'s own code for the same
 * miss, and the engine's own ledger rather than a thin record, so it is a
 * verdict and not homework. And a fight that is not running is
 * `not_in_combat`, which is what every command in this layer answers for an
 * absent `state.combat`; `beginCombat` is the command for that, and the reason
 * says so.
 */
export function joinCombat(
  state: GameState,
  joining: CombatantInput,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `join-combat:${joining.id}`, { ...command, joining }, () => [], (stamp) => {
    if (state.combat === null) {
      return err(
        'not_in_combat',
        'there is no Initiative order to join; a fight that has not started begins with beginCombat',
      );
    }
    if (creatureOf(state, joining.id) === null) return unknownCreature(joining.id);

    // The ranking and the turn arithmetic are `addCombatant`'s, asked here and
    // asked again by the reducer, so the command and the fold cannot disagree
    // about where the creature landed.
    const joined = addCombatant(state.combat, joining);
    if (!joined.ok) return joined;

    return ok([
      {
        type: 'combatant-joined',
        combatant: joining,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}
