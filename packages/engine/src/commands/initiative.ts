/**
 * Initiative: rolling for it, and taking a place in the order it settles.
 *
 * Its own module because it is its own thing, which the single file had
 * obscured by filing it at the end of the spell region. Initiative is an
 * ability check, so a feat's Proficiency Bonus and a magic item's bonus apply,
 * and the creature's own `initiativeBonuses` ride on it without a caller
 * having to remember them.
 *
 * The commands here are the pair a caller needs and had only half of: a
 * number, and somewhere to put it. `beginCombat` puts a whole list of numbers
 * into a fight that has not started; {@link joinCombat} puts one into a fight
 * that has.
 *
 * **Why a command that rolls *and* starts, rather than a wider `beginCombat`.**
 * {@link rollInitiativeFor} returns a roll and no events, so every caller that
 * kept a log wrote the `rolls-issued` event itself to record that the
 * generator had moved — the scripted scenario, the probe's harness, the
 * probe's parity mill. That was the one place in the repository where
 * something above the engine appended an event no command produced, and it was
 * the engine that left no other way to be correct.
 *
 * Widening `beginCombat` would have put a `Supply` in front of the
 * `CommandIdentity` every existing caller already passes, and made one command
 * mean two things depending on the shape of its list. So the rolling lives
 * here, in the module that owns Initiative, and the *event* stays exactly
 * where it was: {@link rollInitiativeAndBeginCombat} ranks nothing and builds
 * no `combat-started` of its own — it hands its combatants to `beginCombat`,
 * so there is still one door to a fight starting. Two functions writing one
 * event by hand is the shape of bug M2.6 spent a week on.
 *
 * {@link recordInitiativeRolls} is the other half of the same repair, for a DM
 * who asks for Initiative before deciding there is a fight: the dice it throws
 * are real, and now they are recorded without anybody assembling an event.
 */

import { err, ok, type CharacterId, type Result, type RollMode } from '@ie/shared';
import { flatBonusTotal, type ModeSource } from '../bonuses.js';
import {
  addCombatant,
  type CombatantInput,
  type InitiativeOptions,
  type InitiativeRoll,
  rollInitiative,
} from '../combat.js';
import { type Rng } from '../dice.js';
import { type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { type RollIssuer } from '../rolls.js';
import { effectiveConditions, rollModesFor } from '../standing.js';
import { creatureOf, unknownCreature } from './command.js';
import { checkBonuses } from './rolls.js';
import { beginCombat } from './scene.js';

/**
 * Roll Initiative for a creature, with whatever its own features contribute.
 *
 * SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus to
 * the roll." The engine already knows about that — creation worked it out — so
 * making a caller remember to pass it is how a character silently stops having
 * the feat they paid for. Supplied once, named in the roll, and deduplicated
 * against anything the caller adds, so it cannot land twice.
 *
 * **This is the roll and not the record.** It throws dice and hands back a
 * number; it emits nothing, so it does not say that the generator moved. That
 * used to leave writing the `rolls-issued` event by hand as the only correct
 * way to use it from a caller keeping a log, and it no longer is:
 * {@link recordInitiativeRolls} rolls and records for a DM who wants Initiative
 * before deciding there is a fight, and {@link rollInitiativeAndBeginCombat}
 * does it for one that has been decided. Reach for this one only when nobody
 * is keeping a log — a preview, a test, a question about a modifier.
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

  // SRD makes Initiative an ability check, so "a magic item's bonus applies" —
  // gathered by the one function that answers that for every check, and merged
  // with the caller's before the feat's own bonuses are.
  const supplied = checkBonuses(state, id, options.bonuses);
  const own = creature.initiativeBonuses;
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

/**
 * A creature entering a fight nobody has rolled for yet.
 *
 * A {@link CombatantInput} with the number taken out, because the number is
 * the thing the engine is about to produce — plus whatever shaped the roll,
 * which for SRD is surprise ("a combatant surprised by combat starting rolls
 * with Disadvantage") and anything situational the DM allows.
 *
 * **The pinned Speed stays the caller's**, exactly as it is at `beginCombat`.
 * A command that worked one out would be a second reader of a question
 * `speedOf` already answers, and the order pins a *walking* Speed before
 * conditions — not the number a Grappled creature can move this turn.
 */
export interface InitiativeEntrant extends Omit<CombatantInput, 'initiative'> {
  readonly options?: InitiativeOptions;
}

interface Rolled {
  readonly combatants: readonly CombatantInput[];
  readonly events: readonly GameEvent[];
}

/**
 * Roll for everybody, and say so in the log.
 *
 * One resumed generator across the whole list and **one** `rolls-issued` at
 * the end of it: the event records how far the generator moved, and a session
 * that rebuilds its generator from state needs the final position rather than
 * a running commentary. The per-creature `roll-recorded` is what explains the
 * totals, and it changes no state — so a log written this way folds to exactly
 * what the hand-assembled one folded to.
 *
 * The stamp rides the `rolls-issued`, which is the one event both commands
 * below always emit when they succeed.
 *
 * Private, and the only place either command rolls: two callers rolling their
 * own way is how the same Initiative comes out differently depending on which
 * door it came through.
 */
function rollFor(
  state: GameState,
  entrants: readonly InitiativeEntrant[],
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  stamp: CommandStamp | null,
): Result<Rolled> {
  const issuedBefore = supply.issuer.count;
  const combatants: CombatantInput[] = [];
  const events: GameEvent[] = [];

  for (const entrant of entrants) {
    // `options` shaped the roll; everything else is what the order pins. Taken
    // apart by name rather than rebuilt field by field, so a field added to
    // `CombatantInput` travels without this command being edited.
    const { options, ...pinned } = entrant;

    const rolled = rollInitiativeFor(state, entrant.id, supply.issuer, supply.rng, options);
    if (!rolled.ok) return rolled;

    combatants.push({ ...pinned, initiative: rolled.value.total });

    // The modifier, less every flat bonus that can name itself, and then those
    // by name — `recordD20Test`'s itemisation, written out here because an
    // `InitiativeRoll` is a `D20Roll` and not a `D20TestResult`. One lumped
    // contribution would be exactly the unexplained total
    // `roll-recorded.contributions` exists to prevent, and Alert's Proficiency
    // Bonus and a magic item's Initiative bonus are the two things it would
    // lose — the two this module's own docstring says are *named* in the roll.
    const roll = rolled.value;
    events.push({
      type: 'roll-recorded',
      who: entrant.id,
      label: 'Initiative',
      natural: roll.roll.natural,
      total: roll.total,
      contributions: [
        { source: 'modifier', amount: roll.modifier - flatBonusTotal(roll.flatBonuses) },
        ...roll.flatBonuses.map((bonus) => ({ source: bonus.source, amount: bonus.flat ?? 0 })),
        ...roll.bonuses.map((bonus) => ({ source: bonus.source, amount: bonus.total })),
      ],
    });
  }

  events.push({
    type: 'rolls-issued',
    count: supply.issuer.count - issuedBefore,
    rng: supply.rng.snapshot(),
    ...(stamp === null ? {} : { command: stamp }),
  });

  return ok({ combatants, events });
}

/**
 * Roll for Initiative, and start the fight the rolls decided the order of.
 *
 * **The command that closes the last hand-written event.** `rollInitiativeFor`
 * hands back a number and no events, so a caller keeping a log had to write the
 * `rolls-issued` that records the generator moving — and a caller who forgot is
 * not told anything: the fight simply rolls the Initiative dice again the next
 * time anything rolls. Three callers wrote that event, and it was the one place
 * in the repository where something above the engine appended an event no
 * command produced.
 *
 * **It ranks nothing and builds no `combat-started`.** The combatants go to
 * `beginCombat`, which owns the ranking, both of its refusals — a fight with
 * nobody in it, a creature listed twice — and the construction of the event
 * itself. See the module docstring for why that delegation rather than a second
 * assembly of the same event.
 *
 * `beginCombat` is called without an identity of its own on purpose: two
 * `once` wrappers under one command id would fingerprint that id twice and
 * then refuse the retry the id exists to absorb. The stamp for the whole
 * operation rides the `rolls-issued`.
 *
 * **A refusal emits nothing**, including the rolls. The dice the local
 * generator threw before the refusal are discarded with them, which is sound
 * because a caller resumes its generator from state — where nothing
 * happened — rather than from the object it passed in.
 *
 * Nothing here decides that combat has begun; that is the DM's authority, and
 * this is what the layer above calls once the judgement is made.
 */
export function rollInitiativeAndBeginCombat(
  state: GameState,
  entrants: readonly InitiativeEntrant[],
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(
    state,
    'roll-initiative-and-begin-combat',
    { ...command, entrants },
    () => [],
    (stamp) => {
      const rolled = rollFor(state, entrants, supply, stamp);
      if (!rolled.ok) return rolled;

      const started = beginCombat(state, rolled.value.combatants);
      if (!started.ok) return started;

      return ok([...rolled.value.events, ...started.value]);
    },
  );
}

/**
 * Roll for Initiative without deciding there is a fight.
 *
 * A DM asking the table to roll before saying whether the bandits attack is an
 * ordinary thing to do, and the dice it throws are real: a session that does
 * not record them rolls the same numbers again. `rollInitiativeFor` is still
 * the bare roll — a number, for anything that keeps no log — and this is what
 * a log-keeper calls, so writing the event by hand is no longer the only way
 * to use the roll correctly.
 *
 * The totals are in the `roll-recorded` events, which is where the log answers
 * "what did she roll". If the fight then happens,
 * {@link rollInitiativeAndBeginCombat} is the command for it; `beginCombat`
 * takes the numbers directly for a DM who would rather state them.
 */
export function recordInitiativeRolls(
  state: GameState,
  entrants: readonly InitiativeEntrant[],
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'record-initiative-rolls', { ...command, entrants }, () => [], (stamp) => {
    if (entrants.length === 0) {
      // `startCombat`'s own code for the same caller mistake, which is the
      // precedent `joinCombat` set two commands up: an empty list is an empty
      // list, and a surface matching this refusal should not have to learn a
      // second word for it because no fight happened to follow.
      return err('empty_combat', 'there is nobody to roll Initiative for; name at least one creature');
    }

    const rolled = rollFor(state, entrants, supply, stamp);
    if (!rolled.ok) return rolled;

    return ok([...rolled.value.events]);
  });
}
