/**
 * The actions that change what a turn can do.
 *
 * Dash, Disengage, Dodge, Hide, and Ready with the release that answers it.
 * Ready is why this module sits at the top: releasing a readied spell runs the
 * whole casting path, and holding one runs part of it at the moment of
 * readying.
 *
 * **Three of them take a price now.** SRD Cunning Action and SRD Adrenaline
 * Rush buy a Dash, a Disengage or a Hide with a Bonus Action, so each of those
 * commands takes a `from` and refuses one nothing has allowed — rather than
 * holding a permission it could never be asked to honour, which is the defect
 * `STATABLE_PRICES` exists to prevent.
 */

import { type CommandIdentity, once } from '../idempotency.js';
import {
  ABILITY_NAMES,
  type Ability,
  type CharacterId,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { DODGE, DODGE_ACTION, READY, READY_ACTION } from '../actions.js';
import {
  allowsPrice,
  dash,
  isStatablePrice,
  disengage,
  spendAction,
  spendBonusAction,
  spendReaction,
  useFreeInteraction,
  type ActionSlot,
} from '../combat.js';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { type StatedAction, type StatedBonusAction } from '../character.js';
import { rollAbilityCheck, rollSavingThrow, type D20TestResult } from '../checks.js';
import { isDown } from '../vitals.js';
import {
  actionRulesOn,
  canSee,
  conditionImmunitiesOf,
  effectiveConditions,
  evadesHalfDamage,
  rollModesFor,
  sheetAsItStands,
  speedOf,
} from '../standing.js';
import {
  checkBonuses,
  recordD20Test,
  rollSpellDice,
  savingSupport,
  withFlatAddend,
} from './rolls.js';
import { dealSpellDamage } from './damage.js';
import {
  applyEvent,
  type GameEvent,
  type GameState,
  type ReadiedAction,
  type ReadiedResponse,
} from '../events.js';
import {
  coverBetween,
  type CoverDegree,
  obscurementAt,
  type Placement,
  type Point,
  positionOf,
} from '../positioning.js';
import {
  describePerDay,
  describeRecharge,
  perDayTallyKey,
  statedActionOf,
  statedBonusActionOf,
} from '../monster.js';
import { tallied, type SlotKind } from '../resources.js';
import { type Content } from '../content.js';
import { durationSecondsAt } from '../spell-definitions.js';
import {
  castSpell,
  chooseRoute,
  type ConcentrationConsequence,
  type Supply,
  nextCastingId,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { routeLabel } from './item-casting.js';
import { schedule } from './conditions.js';
import { featureTimer } from './features.js';
import { mayAct } from './holds.js';
import { type MoveResolution, moveWithin } from './movement.js';
import { castOrRelease } from './spell-resolution.js';
import { declaredFacts, type SpellResolution } from './targeting.js';

/**
 * Which slot the caller is offering to pay a Dash out of.
 *
 * The same shape as {@link DisengageOptions}, for the same reason and with the
 * same refusals: SRD Cunning Action and SRD Adrenaline Rush both say "you can
 * take the Dash action as a Bonus Action", and a permission the command could
 * not be *asked* for would land on the creature and be spent as an Action
 * anyway — which is the defect `STATABLE_PRICES` was written to close, found
 * once already on this file's other command.
 */
export interface DashOptions {
  readonly from?: ActionSlot;
}

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed after applying any modifiers."
 */
export function takeDash(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
  options: DashOptions = {},
): Result<GameEvent[]> {
  return once(state, `dash:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there is no movement budget to add to outside combat');
    }

    // The caller asks for the cheaper price and the engine rules on whether
    // they may have it, exactly as a Disengage does below: an allowance nobody
    // invokes changes nothing, and the engine never spends a slot the caller
    // did not name.
    const from: ActionSlot = options.from ?? 'action';
    if (from !== 'action' && !isStatablePrice('dash', from)) {
      return err(
        'no_such_price',
        `Dash cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
      );
    }
    const rules = actionRulesOn(state, id);
    if (from !== 'action') {
      const allowed = allowsPrice(id, 'dash', from, rules);
      if (!allowed.ok) return allowed;
    }

    // Validate the whole operation before any of it is emitted: the action has
    // to be there to spend, and the increase has to be one this creature can
    // actually receive.
    const spend = { rules, as: 'dash' as const };
    const spent =
      from === 'bonus-action'
        ? spendBonusAction(state.combat, id, creature.conditions, spend)
        : spendAction(state.combat, id, creature.conditions, spend);
    if (!spent.ok) return spent;
    const dashed = dash(spent.value, id, speedOf(state, id));
    if (!dashed.ok) return dashed;

    return ok([
      { type: from === 'bonus-action' ? 'bonus-action-spent' : 'action-spent', id },
      { type: 'dash-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/** Which slot the caller is offering to pay a Disengage out of. */
export interface DisengageOptions {
  /**
   * SRD Conjure Woodland Beings: "you can take the Disengage action **as a
   * Bonus Action** for the spell's duration."
   *
   * Absent means what the book charges, which is an Action — so an allowance
   * a caller never invokes changes nothing, and the engine never quietly
   * spends a slot nobody named. Stating one the caller does not hold is a
   * rules-legal refusal (`action_not_allowed`), not a silent downgrade to the
   * ordinary price: a caller asking for the Bonus Action wanted to keep the
   * Action, and charging it anyway would be the wrong answer told quietly.
   */
  readonly from?: ActionSlot;
}

/**
 * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
 * rest of the current turn."
 */
export function takeDisengage(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
  options: DisengageOptions = {},
): Result<GameEvent[]> {
  return once(state, `disengage:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there are no Opportunity Attacks to avoid outside combat');
    }

    // SRD Conjure Woodland Beings: "you can take the Disengage action as a
    // Bonus Action for the spell's duration." **The caller asks for the
    // cheaper price and the engine rules on whether they may have it** — an
    // allowance nobody invokes changes nothing, exactly as a Dodge nobody
    // takes does, and the engine never spends a slot the caller did not name.
    const from: ActionSlot = options.from ?? 'action';

    // **A price with no spender is refused, not quietly rounded to the
    // ordinary one.** The ternary below charges an Action for anything that
    // is not a Bonus Action, so a caller asking to Disengage out of their
    // Reaction used to have their *Action* taken — the substitution the
    // options type promises never to make, arriving through a fall-through.
    // `STATABLE_PRICES` is the one map of what a command will charge, and
    // `checkSpellDefinition` refuses an allowance against the same one; this
    // is the door, because a caller may state a price with no definition
    // anywhere in it.
    if (from !== 'action' && !isStatablePrice('disengage', from)) {
      return err(
        'no_such_price',
        `Disengage cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
      );
    }
    if (from !== 'action') {
      const allowed = allowsPrice(id, 'disengage', from, actionRulesOn(state, id));
      if (!allowed.ok) return allowed;
    }

    const spend = { rules: actionRulesOn(state, id), as: 'disengage' as const };
    const spent =
      from === 'bonus-action'
        ? spendBonusAction(state.combat, id, creature.conditions, spend)
        : spendAction(state.combat, id, creature.conditions, spend);
    if (!spent.ok) return spent;
    const taken = disengage(spent.value, id);
    if (!taken.ok) return taken;

    return ok([
      { type: from === 'bonus-action' ? 'bonus-action-spent' : 'action-spent', id },
      { type: 'disengage-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/** Which line the caller is taking, by the heading the block prints it under. */
export interface StatedBonusActionCommand extends CommandIdentity {
  readonly line: string;
}

export interface StatedBonusActionOutcome {
  readonly events: readonly GameEvent[];
  /**
   * What the line says, handed back rather than applied — see
   * `AttackResolution.unverified`.
   *
   * **Always, and that is the whole report.** The SRD prints seventy-five of
   * these lines and the engine executes none of them: they cast a spell, force
   * a saving throw, take another action, move, shape-shift, teleport, or are
   * prose. A spend that said only "the Bonus Action is gone" would leave a
   * caller believing the creature had done something.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take one of the lines a creature's stat block prints under **Bonus
 * Actions**.
 *
 * It spends the Bonus Action, writes down which line was taken, and hands the
 * sentence back. It executes nothing: a line that casts Misty Step does not
 * cast it here, a line that forces a save does not roll it, and a line that
 * says the creature Dashes does not Dash — those are seven mechanisms wearing
 * one heading, and half of one of them would be worse than none. Making the
 * spend visible is what this is for, because until it existed the seventy-five
 * lines the book prints were a section of the stat block nothing above the
 * engine could touch.
 *
 * **Which line is recorded because something reads it.** A Multiattack the
 * book gates on one — "three Slam attacks if it used Hasten this turn" — has
 * no other way to ask, and the ledger it asks is the once-per-turn one every
 * other per-turn count already uses.
 *
 * **A heading that carries a recharge is spent once.** SRD *Monsters*: "a
 * monster can use the stat block part once", and thirteen of the book's Bonus
 * Action lines print the notation. So the line is checked against what this
 * creature has expended, refused with what would bring it back, and written
 * down as spent beside the Bonus Action it cost.
 *
 * **And a heading that prints *N/Day* is spent a stated number of times.**
 * "Divine Aid (2/Day)", "Misty Step (3/Day)" — twelve of the book's Bonus
 * Action lines, which is more than any other section carries. It is a
 * different rule from the recharge and it is checked in the same place: a
 * count of what this creature has used today against the number the block
 * prints, before the economy, refused with the clock that clears it. The two
 * checks never both bite, because no SRD heading prints both notations.
 */
export function takeStatedBonusAction(
  state: GameState,
  id: CharacterId,
  command: StatedBonusActionCommand,
): Result<StatedBonusActionOutcome> {
  return once(
    state,
    `stated-bonus-action:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no Bonus Action to spend outside combat');
      }

      // Read off the sheet, which is where `creature-added` pinned the block's
      // own lines; nothing here opens a catalogue and nothing branches on the
      // name it finds.
      const line = statedBonusActionOf(creature.sheet, command.line);
      if (line === null) {
        return err(
          'no_such_line',
          `no Bonus Action called ${command.line} is printed on this creature's stat block`,
        );
      }

      // **A line already used and not yet back.** Before the economy, because
      // a refusal after the Bonus Action is gone is a refusal with a
      // footprint — the rule every other argument on this command follows.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }

      // **And a line whose day's worth is gone.** The book's other notation,
      // on the other clock, refused in the same place and for the same reason
      // — before the economy, so the refusal has no footprint. No SRD heading
      // prints both, so the order of the two checks settles nothing.
      //
      // The count is a `Tally` tagged `dawn`, which is the shape `resources.ts`
      // already holds; the *ceiling* is the block's, read off the sheet here,
      // because a tally has none and its own doc says whoever reads the count
      // decides what a high one costs.
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // SRD: "You can't take more than one Bonus Action on a turn", which is
      // the primitive's own rule and the reason nothing else has to say it —
      // so a second line in one turn is refused here, whichever line it is.
      const spent = spendBonusAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;

      return ok({
        events: [
          { type: 'bonus-action-spent', id },
          // SRD *Monsters*: "a monster can use the stat block part once."
          // Only where the block prints the notation — an ordinary line is
          // taken every turn and writes nothing here.
          ...(recharge === null
            ? []
            : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
          // And one of the day's uses, where the block prints a number of
          // them. The event a tally is already counted through — nothing new
          // in the union, and the morning that clears it is the
          // `resources-restored` a dawn already writes.
          ...(perDay === null
            ? []
            : [
                {
                  type: 'resource-spent' as const,
                  id,
                  key: perDayTallyKey(line.name),
                  amount: 1,
                  tally: 'dawn' as const,
                },
              ]),
          {
            type: 'stated-bonus-action-taken',
            id,
            // The **printed** heading rather than what the caller typed, so the
            // log and the block say the same string however it was asked for.
            line: line.name,
            turn: state.combat.turnsTaken,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        unverified: [
          `${id}'s block prints "${line.name}: ${line.text}" — the engine does not apply that; a DM does`,
        ],
        duplicate: false,
      });
    },
  );
}

/** Which line the caller is taking, by the heading the block prints it under. */
export interface StatedActionCommand extends CommandIdentity {
  readonly line: string;
}

export interface StatedActionOutcome {
  readonly events: readonly GameEvent[];
  /**
   * What the line says, handed back rather than applied — see
   * {@link StatedBonusActionOutcome.unverified}, which this is the other half
   * of.
   *
   * **Always, and that is the whole report.** Two hundred-odd of these lines
   * are printed across a third of the SRD's bestiary and *this command*
   * executes no part of any of them: they cast a spell, shape-shift, swallow,
   * teleport, force a saving throw, or are prose. A spend that said only "the
   * Action is gone" would leave a caller believing the creature had done
   * something.
   *
   * **The last of those is no longer only handed over**, which is the one
   * qualification this paragraph owes: a line whose sentence is the book's
   * save template carries a DC and dice the engine can roll, and
   * {@link forcePrintedSave} is the door that rolls them. This command is
   * still the door that does not, for every line including that one — a DM
   * who would rather adjudicate the breath has lost nothing — so what comes
   * back here is still the whole sentence and still a claim about nothing.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take one of the lines a creature's stat block prints under **Actions** that
 * the parser read nothing out of.
 *
 * The Actions section's other half. A line the parser *read* is an attack and
 * `resolveAttack` takes it, at the numbers the block prints; this is every
 * other line under that heading — and until it existed they were a section of
 * the stat block a caller could see named and could not touch, which is the
 * absence `takeStatedBonusAction` was written to close one section along.
 *
 * It spends the Action, writes down which line was taken, and hands the
 * sentence back. It executes nothing: a line that breathes a Cone of cold does
 * not roll the save, a line that says the creature casts a spell does not cast
 * it, and a line that swallows somebody moves nobody. Those are seven
 * mechanisms wearing one heading, and half of one of them would be worse than
 * none.
 *
 * **A second line on the same turn is refused by the economy**, which is the
 * one place that rule lives: a creature takes one Action on a turn, and
 * `spendAction` has always said so. Nothing is written into the once-per-turn
 * ledger, because nothing reads it — the gate a Multiattack prints names a
 * Bonus Action.
 *
 * **A heading that carries a recharge is spent once.** SRD *Monsters*: "a
 * monster can use the stat block part once", and seventy-one of these lines
 * print the notation — most of the book's, and every one of them inert until
 * something could expend a line by taking it. So the line is checked against
 * what this creature has expended, refused with what would bring it back, and
 * written down as spent beside the Action it cost.
 *
 * **And a per-day limit is enforced too**, which is the gap its Bonus Action
 * sibling used to name beside it: an *N/Day* notation is a different rule on a
 * different clock — a count between dawns, not a die at a boundary — so it is
 * a count checked against the number the block prints, refused in the same
 * position, and cleared by a sunrise rather than by a rest. Ten of these lines
 * print one.
 */
export function takeStatedAction(
  state: GameState,
  id: CharacterId,
  command: StatedActionCommand,
): Result<StatedActionOutcome> {
  return once(
    state,
    `stated-action:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no Action to spend outside combat');
      }

      // Read off the sheet, which is where `creature-added` pinned the block's
      // own lines; nothing here opens a catalogue and nothing branches on the
      // name it finds.
      const line = statedActionOf(creature.sheet, command.line);
      if (line === null) {
        // **It says what was searched and claims nothing about where else the
        // heading might be.** Four things reach this refusal — a heading no
        // block prints, an attack, a sequence, and a line printed under
        // another section — and a reason that named only the first of them
        // would be telling a caller its Multiattack is an attack.
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions with nothing the engine could read beneath it; a heading the parser did read, and a heading printed under another section, are each taken by the command that owns them`,
        );
      }

      // **A line already used and not yet back.** Before the economy, because
      // a refusal after the Action is gone is a refusal with a footprint — the
      // rule every other argument on this command follows.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }

      // **And a line whose day's worth is gone.** Ten of these lines print the
      // other notation — a Dretch's Fetid Cloud, a Treant's Animate Trees, a
      // Sphinx's Roar — and it is a different clock: a count between dawns
      // rather than a die at a boundary. Refused in the same position and for
      // the same reason, before the economy; counted as a `dawn` tally, with
      // the ceiling read off the block. See `perDayTallyKey`.
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      const spent = spendAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;

      return ok({
        events: [
          { type: 'action-spent', id },
          // SRD *Monsters*: "a monster can use the stat block part once."
          // Only where the block prints the notation — an ordinary line is
          // taken every turn and writes nothing here.
          ...(recharge === null
            ? []
            : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
          // And one of the day's uses, where the block prints a number of
          // them — a `dawn` tally, counted through the event tallies already
          // use. See `perDayTallyKey`.
          ...(perDay === null
            ? []
            : [
                {
                  type: 'resource-spent' as const,
                  id,
                  key: perDayTallyKey(line.name),
                  amount: 1,
                  tally: 'dawn' as const,
                },
              ]),
          {
            type: 'stated-action-taken',
            id,
            // The **printed** heading rather than what the caller typed, so the
            // log and the block say the same string however it was asked for.
            line: line.name,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        unverified: [
          `${id}'s block prints "${line.name}: ${line.text}" — the engine does not apply that; a DM does`,
        ],
        duplicate: false,
      });
    },
  );
}

/** Which line the caller is forcing, and who it caught. */
export interface PrintedSaveCommand extends CommandIdentity {
  readonly line: string;
  /**
   * The creatures the line reached, named by the caller.
   *
   * **The one fact the table supplies, and it is not a number the engine
   * owns.** "Each creature in a 15-foot Cone" wants an origin and a facing
   * nobody has declared, and a Cone measured out of a sentence would be the
   * Engine inventing a fact rather than adjudicating one. So the head count
   * is the DM's decision — the kind their door is *for* — and everything a
   * die decides stays here. Absent or empty is asked about rather than
   * refused, because a missing fact is not a wrong one.
   */
  readonly targets?: readonly CharacterId[];
}

/** What the line did to one creature standing in it. */
export interface PrintedSaveOnACreature {
  readonly target: CharacterId;
  readonly save: D20TestResult;
  /** What landed, after the target's own Resistance and the rest. */
  readonly damage: number;
  readonly concentration: ConcentrationConsequence;
}

export interface PrintedSaveOutcome {
  readonly events: readonly GameEvent[];
  /** One entry per creature named, in the order the caller named them. */
  readonly outcomes: readonly PrintedSaveOnACreature[];
  /**
   * The part of the line the engine did not settle — always the targeting
   * clause, because who stands in a Cone is the table's answer and the
   * caller's list is what it said.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Force the saving throw a creature's stat block prints, at the DC and dice
 * the block prints.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` is a template as
 * regular as `_Melee Attack Roll:_`, printed on a third of the bestiary, and
 * every number in it is the book's. A DC the caller stated would be a caller
 * stating the rules, and a die face the caller stated would be worse; both
 * come out of the block and out of `rolls.ts` respectively.
 *
 * **It is the second door on one line, not a replacement for the first.**
 * {@link takeStatedAction} and {@link takeStatedBonusAction} spend the slot
 * and hand the sentence back, for every line including this one, and they
 * still do — a DM who would rather adjudicate the breath themselves has lost
 * nothing. This door is for the caller that wants the engine to roll, and it
 * refuses `line_states_no_save` for a line whose sentence says something the
 * reader could not structure.
 *
 * **The economy is the one the hand-over door already spends**, in the same
 * order and for the same reason: the recharge and the day's uses are checked
 * *before* the slot, so a refusal leaves no footprint, and the same event goes
 * into the log, because the same line was taken.
 *
 * **Which slot is the heading's answer, not this command's.** The book writes
 * the template under **Actions** and under **Bonus Actions** — the Gorgon's
 * Trample, the Elephant's, the Mammoth's — and a heading in a stat block says
 * what the line under it costs. So both sections are searched, Actions first,
 * and the spend and the event follow the section the line was found in:
 * `takeStatedAction`'s pair for one, `takeStatedBonusAction`'s for the other.
 *
 * **No Reaction window opens**, which is the stated limit every spell's
 * damage already records: `dealSpellDamage` is the path, Uncanny Dodge
 * answers a sword, and a breath weapon is not one. So nothing here can close
 * a `damage-rolled` a defender was offered — there is none to close, and the
 * fold's one-held-roll rule is never asked to hold a Cone's worth.
 *
 * SRD Evasion is read off each **target**, because it is a defence: the
 * Rogue standing in the Cone is the one who evades it, exactly as they evade
 * a Fireball.
 */
export function forcePrintedSave(
  state: GameState,
  id: CharacterId,
  command: PrintedSaveCommand,
  supply: Supply,
): Result<PrintedSaveOutcome> {
  return once(
    state,
    `printed-save:${id}`,
    command,
    () => ({ events: [], outcomes: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        // Which slot the line costs is the heading's answer and the heading
        // has not been read yet, so the refusal names neither.
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      // Read off the sheet, where `creature-added` pinned the block's own
      // lines; nothing here opens a catalogue and nothing branches on a name.
      //
      // **Two sections, because the book writes the template under both.**
      // The Gorgon's Trample is a Bonus Action and the Winter Wolf's breath is
      // an Action, and what the heading changes is what the line *costs* —
      // which is exactly what is read off it below and nothing else. Actions
      // first, and no SRD block prints one heading under both — which is a
      // fact about the transcription and is asserted over the corpus in
      // `packages/srd/src/parse/monster-saves.test.ts` rather than assumed
      // here, because Actions winning a collision silently would refuse a
      // savable Bonus Action line with `line_states_no_save`.
      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions with nothing the engine could read beneath it; a heading the parser did read as an attack, and a heading printed under another section, are each taken by the command that owns them`,
        );
      }

      const printed = line.save;
      if (printed === undefined) {
        return err(
          'line_states_no_save',
          `${line.name} states no saving throw this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      // Who it caught, which is the table's to say. Asked for rather than
      // refused: a head count nobody has stated is a fact that is missing
      // rather than a call that is wrong.
      const targets = command.targets ?? [];
      if (targets.length === 0) {
        return needsContext(
          'undeclared_targets',
          `${line.name} reads "${printed.targets}", and nobody has said which creatures that is`,
          [
            {
              kind: 'creature',
              subject: id,
              need: `the creatures ${line.name} caught — the line reads "${printed.targets}"`,
              because:
                'an area is measured from an origin and a facing the engine has not been told; the saving throws are its own',
              satisfyWith: 'forcePrintedSave again with its targets filled in',
            },
          ],
        );
      }
      for (const target of targets) {
        if (state.creatures[target] === undefined) return unknownCreature(target);
      }

      // **A line already used and not yet back**, and **a line whose day's
      // worth is gone** — both before the economy, because a refusal after
      // the Action is gone is a refusal with a footprint.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // The slot the **heading** names: one Action on a turn, or the one
      // Bonus Action, each refused by the primitive that owns its rule.
      const spent =
        action !== null
          ? spendAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            })
          : spendBonusAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            });
      if (!spent.ok) return spent;

      const events: GameEvent[] = [
        action !== null
          ? { type: 'action-spent', id }
          : { type: 'bonus-action-spent' as const, id },
        // SRD *Monsters*: "a monster can use the stat block part once."
        ...(recharge === null
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [
              {
                type: 'resource-spent' as const,
                id,
                key: perDayTallyKey(line.name),
                amount: 1,
                tally: 'dawn' as const,
              },
            ]),
        // The same event the door that hands the sentence over writes, because
        // the same line was taken — including the turn a Bonus Action line is
        // written down against, which is what a gated Multiattack reads.
        action !== null
          ? {
              type: 'stated-action-taken' as const,
              id,
              // The **printed** heading rather than what the caller typed.
              line: line.name,
              ...(stamp === null ? {} : { command: stamp }),
            }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
      ];

      const ability: Ability = printed.ability;
      const outcomes: PrintedSaveOnACreature[] = [];
      let current = events.reduce(applyEvent, state);

      for (const target of targets) {
        const victim = current.creatures[target];
        if (victim === undefined) return unknownCreature(target);

        const support = savingSupport(current, target, victim, ability, {});
        // The sheet as it stands, so an item that sets the ability this save
        // is made with reaches the save rather than stopping at the page —
        // the reading a spell's save already takes.
        const sheet = sheetAsItStands(current, target) ?? victim.sheet;
        const save = rollSavingThrow(supply.issuer, supply.rng, sheet, ability, {
          dc: printed.dc,
          conditions: support.conditions,
          modes: support.modes,
          bonuses: support.bonuses,
        });
        if (!save.ok) return save;

        events.push(
          recordD20Test(
            target,
            `${ABILITY_NAMES[ability]} save vs ${line.name}`,
            save.value,
            save.value.success ? 'resisted' : 'affected',
          ),
        );

        // SRD Evasion, read off the creature standing in it and off the
        // *line's* own sentence: it triggers on an effect that offers half on
        // a made Dexterity save, which is a fact about what was printed.
        const evading = evadesHalfDamage(current, target, ability, printed.onSuccess === 'half');

        // Nothing at all on a success means no damage roll either: the line
        // did nothing, and rolling would move the generator for no reason.
        if (save.value.success && (printed.onSuccess === 'none' || evading)) {
          outcomes.push({
            target,
            save: save.value,
            damage: 0,
            concentration: { kind: 'none' },
          });
          continue;
        }

        const rolled = rollSpellDice(
          supply,
          creature.sheet,
          line.name,
          printed.damage.type,
          printed.damage.dice ?? undefined,
        );
        if (!rolled.ok) return rolled;
        // The addend the book prints inside the parenthesis — "16 (2d10 + 5)"
        // — which is part of the damage and not a separate effect.
        const parts = withFlatAddend(rolled.value, printed.damage.flat);

        // SRD: "The halved damage is equal to half the damage that would be
        // dealt on a failed save" — half of what the line deals, and therefore
        // *before* the target's own Resistance, which then halves again. With
        // Evasion it is the failure that is halved; the success took nothing
        // above.
        const halve = evading ? !save.value.success : save.value.success;
        const components = halve
          ? parts.map((component) => ({
              ...component,
              total: Math.floor(component.total / 2),
            }))
          : parts;

        const hurt = dealSpellDamage(current, target, components, line.name, supply, { by: id });
        if (!hurt.ok) return hurt;
        events.push(...hurt.value.events);
        current = hurt.value.events.reduce(applyEvent, current);

        outcomes.push({
          target,
          save: save.value,
          damage: hurt.value.amount,
          concentration: hurt.value.concentration,
        });
      }

      return ok({
        events,
        outcomes,
        // The clause the engine did not settle, said out loud in the channel
        // the whole sentence used to come back in. The caller named who was
        // caught; nothing here checked that answer against a map.
        unverified: [
          `${line.name} reads "${printed.targets}" — the engine rolled the save for the creatures named and measured no area; who stands in it is the table's`,
        ],
        duplicate: false,
      });
    },
  );
}

/**
 * SRD Dodge: "until the start of your next turn, any attack roll made against
 * you has Disadvantage if you can see the attacker, and you make Dexterity
 * saving throws with Advantage."
 *
 * An action anybody can take, so the benefits come out of `actions.ts` rather
 * than off a sheet — but everything else about it is the shape `activateFeature`
 * already has, including the turn-anchored deadline and the end when the
 * dodger is Incapacitated.
 */
export function takeDodge(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  return once(state, `dodge:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (creature.activeFeatures.includes(DODGE)) {
      return err('already_active', `${id} is already Dodging`);
    }

    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[id] !== undefined) {
      const spent = spendAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
        as: 'dodge',
      });
      if (!spent.ok) return spent;
      events.push({ type: 'action-spent', id });
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: DODGE,
      ...(stamp === null ? {} : { command: stamp }),
    });

    const timer = featureTimer(state, id, DODGE_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/** SRD Hide: "you must succeed on a DC 15 Dexterity (Stealth) check". */
export const HIDE_DC = 15;

/**
 * The cover a Hide can be taken behind: "Three-Quarters Cover or Total Cover".
 *
 * Half Cover is the degree the sentence leaves out, and leaving it out is the
 * point — a +2 to Armour Class is not a thing you can disappear behind, and
 * reading the third degree in would print a better Hide than the book does.
 */
const HIDING_COVER: readonly CoverDegree[] = ['three-quarters', 'total'];

/**
 * What the Invisible condition a Hide buys is recorded under.
 *
 * A source string rather than a casting, for the reason every condition has
 * one: ending the hiding must lift *this* Invisible and leave the Greater
 * Invisibility somebody cast on the same creature exactly where it is.
 */
export const HIDE = 'action:hide';

export interface HideCommand extends CommandIdentity {
  /**
   * SRD Cunning Action: "you can take the Hide action as a Bonus Action."
   *
   * The same parameter `takeDash` and `takeDisengage` take, refused the same
   * way: a price `STATABLE_PRICES` does not hold, or one nothing has allowed
   * this creature, is a refusal rather than a quiet charge of the Action.
   */
  readonly from?: ActionSlot;
  /**
   * SRD: "while you're **Heavily Obscured**" — and now only where nothing on
   * the lattice already says so.
   *
   * **P3-S took back what the old docstring said this cost.** It read: "the
   * log does not carry it … a reader of the log alone cannot tell this attempt
   * from one taken behind a wall. Whoever models obscurement takes it back."
   * A Heavily Obscured patch is a declared fact with an event behind it now —
   * `obscurement-declared`, or the darkness a `light-declared` implies — so a
   * Rogue standing in a Fog Cloud needs nothing on this command and the log
   * says why the Hide was legal.
   *
   * What it stays is the table's fact where the lattice holds none: the engine
   * still models no smoke nobody declared, and stating it here is the same
   * move `declaredFacts` makes for every clause a caster cannot see for
   * itself. Declared **or** derived, and either is enough.
   */
  readonly obscured?: boolean;
  /** Advantage or Disadvantage the table knows about and the engine does not. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies: Guidance's 1d4, a tool's bonus. */
  readonly bonuses?: readonly Bonus[];
}

export interface HideResolution {
  readonly events: readonly GameEvent[];
  /** The check, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  /**
   * Whether **this attempt** hid them — false, like `check`, on a replay.
   *
   * A retry is told its command already landed rather than re-answered about
   * the world its own first run made, which is what `duplicate` is for: the
   * creature may well be hiding, and this did not do it.
   */
  readonly hidden: boolean;
  /** True when this command id had already been applied. */
  readonly duplicate?: boolean;
}

/**
 * Whoever might catch this creature hiding.
 *
 * "Any enemy", read through the one allegiance fact the engine holds: a
 * creature on another declared side, and **a creature nobody has sided with
 * too**. That is the conservative direction and the reading `alliedWith`
 * already takes — "a creature nobody has placed on a side is nobody's ally" —
 * so an unsided goblin is asked about rather than quietly hidden from.
 *
 * Somebody on the floor is nobody's watcher: an Unconscious creature sees
 * nothing, and a dead one less. The same "on their feet" reading `endCombat`
 * takes of the same question.
 */
function watchersOf(state: GameState, hider: CharacterId): readonly CharacterId[] {
  const side = state.creatures[hider]?.side ?? null;
  return Object.keys(state.creatures)
    .sort()
    .flatMap((who) => {
      if (who === hider) return [];
      const creature = state.creatures[who as CharacterId];
      if (creature === undefined) return [];
      if (creature.vitals.dead || isDown(creature.vitals)) return [];
      if (side !== null && creature.side === side) return [];
      return [who as CharacterId];
    });
}

/**
 * SRD Hide: conceal yourself.
 *
 * > "With this action, you try to conceal yourself. To do so, you must succeed
 * > on a DC 15 Dexterity (Stealth) check while you're Heavily Obscured or
 * > behind Three-Quarters Cover or Total Cover, and you must be out of any
 * > enemy's line of sight."
 *
 * **The sixth named action, and the one that arrived with its own spender.**
 * `NAMED_ACTIONS` admits a member only where a command can be told it apart,
 * and Hide was out of the list for four batches because nothing took it —
 * which is what left SRD Cunning Action, Naturally Stealthy and Supreme Sneak
 * unexecuted however good the grant vocabulary got.
 *
 * **What is the table's and what is the engine's** is the whole of the design,
 * and it is the owner's ruling rather than this command's invention: who can
 * see the hider is declared, exactly as cover is declared and as sides are;
 * the check, the DC and the Invisible condition it buys are the engine's. So a
 * sight line nobody has settled is *homework* — `needs-context`, one request
 * per watcher — where a declared one that says the enemy is looking straight
 * at the hider is a refusal.
 *
 * **Nothing is rolled until the whole attempt is known to be legal**, which is
 * this repository's oldest discipline: the price, the watchers, the cover and
 * an immunity are all settled before the generator moves, so a refused Hide
 * costs neither the slot nor a turn of the dice.
 *
 * What ends it is **not** here, and the SRD's own sentence says why: the
 * condition ends when the creature makes a sound, attacks, casts a spell, or
 * is found by somebody's Search — four moments the table narrates. It is an
 * ordinary condition under an ordinary source, so `endConditionsOn` lifts it.
 */
export function takeHide(
  state: GameState,
  id: CharacterId,
  command: HideCommand,
  supply: Supply,
): Result<HideResolution> {
  return once(
    state,
    `hide:${id}`,
    command,
    () => ({ events: [], check: null, hidden: false, duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

      const from: ActionSlot = command.from ?? 'action';
      if (from !== 'action' && !isStatablePrice('hide', from)) {
        return err(
          'no_such_price',
          `Hide cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
        );
      }
      const rules = actionRulesOn(state, id);
      if (from !== 'action') {
        const allowed = allowsPrice(id, 'hide', from, rules);
        if (!allowed.ok) return allowed;
      }

      // Before the die, because a condition that could never land is a check
      // nobody should have to throw.
      if (conditionImmunitiesOf(state, id).includes('invisible')) {
        return err('immune', `${id} is immune to the Invisible condition, so hiding buys nothing`);
      }

      // Heavily Obscured, either way it can be true: what the table said on
      // this command, or what the lattice already holds over the hider's own
      // space. The **hider's** space and not a watcher's, because the clause
      // is about where they are hiding.
      const here = state.scene === null ? null : positionOf(state.scene, id);
      const obscured =
        command.obscured === true ||
        (here !== null && obscurementAt(state, here).degree === 'heavily');

      const watchers = watchersOf(state, id);
      if (state.scene === null && (watchers.length > 0 || !obscured)) {
        return needsContext(
          'no_scene',
          'hiding is about cover and sight lines, and there is no scene for either to be in',
          [
            {
              kind: 'scene',
              subject: id,
              need: 'a scene, so that cover and sight mean something',
              because: 'SRD Hide asks what is between the hider and whoever is looking',
              satisfyWith: 'a setScene command',
            },
          ],
        );
      }

      // — "out of any enemy's line of sight" —
      const unsettled: ContextRequest[] = [];
      for (const watcher of watchers) {
        const seen = canSee(state, watcher, id);
        if (seen === true) {
          return err('seen', `${watcher} can see ${id}, who is therefore not out of their sight`);
        }
        if (seen === null) {
          unsettled.push({
            kind: 'visibility',
            subject: watcher,
            need: `whether ${watcher} can see ${id}`,
            because: 'SRD Hide asks the hider to be out of any enemy\'s line of sight',
            satisfyWith: `a declareSightBetween command from ${watcher} to ${id}`,
          });
        }
      }
      if (unsettled.length > 0) {
        return needsContext(
          'undeclared_sight',
          `nobody has said whether ${unsettled.map((request) => request.subject).join(', ')} can see ${id}, and a Hide turns on it`,
          unsettled,
        );
      }

      // — "Heavily Obscured or behind Three-Quarters Cover or Total Cover" —
      //
      // Half Cover is deliberately not enough: the book names two degrees and
      // reading the third in would be a better Hide than the SRD prints.
      if (!obscured) {
        const scene = state.scene;
        const exposed =
          scene === null
            ? watchers
            : watchers.filter((watcher) => !HIDING_COVER.includes(coverBetween(scene, watcher, id)));
        if (watchers.length === 0 || exposed.length > 0) {
          return err(
            'not_concealed',
            watchers.length === 0
              ? `${id} has nobody to take cover from and nothing declared obscuring them; SRD Hide wants Heavily Obscured or Three-Quarters Cover, and cover is declared between two creatures`
              : `${id} is behind neither Three-Quarters nor Total Cover from ${exposed.join(', ')}, and nobody has said they are Heavily Obscured`,
          );
        }
      }

      const events: GameEvent[] = [];
      if (state.combat !== null && state.combat.budgets[id] !== undefined) {
        const spend = { rules, as: 'hide' as const };
        const spent =
          from === 'bonus-action'
            ? spendBonusAction(state.combat, id, creature.conditions, spend)
            : spendAction(state.combat, id, creature.conditions, spend);
        if (!spent.ok) return spent;
        events.push({
          type: from === 'bonus-action' ? 'bonus-action-spent' : 'action-spent',
          id,
        });
      }

      // The check itself: the engine's ability, the engine's skill, the
      // engine's DC and the engine's die. What the caller may hand over is a
      // mode or a named bonus the table knows about, which is what every other
      // check in the engine already takes.
      const issuedBefore = supply.issuer.count;
      const fromFeatures = rollModesFor(state, {
        family: 'ability-check',
        roller: id,
        ability: 'dex',
        skill: 'stealth',
      }).modes;
      const sheet = sheetAsItStands(state, id) ?? creature.sheet;
      const rolled = rollAbilityCheck(supply.issuer, supply.rng, sheet, 'dex', {
        dc: HIDE_DC,
        skill: 'stealth',
        conditions: effectiveConditions(state, id),
        modes: [...fromFeatures, ...(command.modes ?? [])],
        bonuses: checkBonuses(state, id, command.bonuses, 'stealth'),
      });
      if (!rolled.ok) return rolled;

      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      // The stamp rides the roll, which happens whether the Hide works or not:
      // stamping the condition would leave a failed attempt retryable and
      // rolled twice, which is `resolveAttack`'s reasoning about a miss.
      events.push({
        ...recordD20Test(
          id,
          'Dexterity (Stealth) check to Hide',
          rolled.value,
          rolled.value.success ? 'hidden' : 'in plain sight',
        ),
        ...(stamp === null ? {} : { command: stamp }),
      });

      if (rolled.value.success) {
        events.push({ type: 'condition-applied', id, condition: 'invisible', source: HIDE });
      }

      return ok({ events, check: rolled.value, hidden: rolled.value.success });
    },
  );
}

/**
 * Open the door on the way past.
 *
 * SRD: "You can interact with one object or feature of the environment for
 * free, during either your move or action", and "when time is short, such as
 * in combat, interactions with objects are limited: one free interaction per
 * turn. Any additional interactions require the Utilize action."
 *
 * `useFreeInteraction` has enforced exactly that since the action economy
 * landed, with one caller: the **reducer**, folding an event no command wrote.
 *
 * **Outside combat there is nothing to limit**, so this refuses rather than
 * quietly succeeding: the allowance is per *turn*, there are no turns, and the
 * reducer throws for a `free-interaction-used` with no combat. That is the one
 * place this differs from Dodge, which has a benefit worth having either way.
 *
 * **It spends from the turn budget, so `mayAct` applies.** The action-economy
 * sweep derives that from the call rather than from this sentence —
 * `useFreeInteraction` is one of its seeds, beside the five that spend an
 * Action, a Bonus Action, a Reaction, movement or an attack, because the
 * budget field it consumes is one of the same six.
 */
export function useFreeObjectInteraction(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `free-interaction:${id}`, command, () => [], (stamp) => {
    // **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    if (state.combat === null) {
      return err(
        'not_in_combat',
        'interactions are limited to one a turn only when time is short; outside combat there is no turn to spend one on',
      );
    }

    const spent = useFreeInteraction(state.combat, id);
    if (!spent.ok) return spent;

    return ok([
      { type: 'free-interaction-used', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * What a Ready is being held for, and what it will do.
 *
 * The trigger is free text and stays that way. SRD asks for "a perceivable
 * circumstance", and the circumstances a table readies against live almost
 * entirely in fiction the engine has never been told about — a trapdoor, a
 * chant, a door. **Absence from structured state is not evidence that a thing
 * does not exist**, so an engine that judged the trigger would be refusing
 * readied actions on the strength of its own ignorance. Maestro says when it
 * fired; everything around it is the engine's.
 */
export interface ReadyCommand extends CommandIdentity {
  readonly trigger: string;
  readonly response: ReadyResponse;
}

/** The response as a caller states it, before the engine has paid for it. */
export type ReadyResponse =
  | { readonly kind: 'action'; readonly note?: string }
  | { readonly kind: 'move' }
  | ({
      readonly kind: 'spell';
      readonly spellId: string;
      /** The slot to expend now. Omitted for a cantrip. */
      readonly slotLevel?: number;
      readonly slotKind?: SlotKind;
      readonly source?: string;
    } & StatedFacts);

/**
 * The four facts a casting states rather than derives.
 *
 * SRD Ready: "you cast it as normal (expending any resources used to cast it)
 * but hold its energy" — so the slot goes at the Ready, and everything the
 * caster said about the spell was said there too. They take exactly the shape
 * they take on `CastSpellRequest`, are validated by exactly the same
 * {@link declaredFacts}, and are handed back to `castOrRelease` at the
 * release, which normalises them through the same two functions a settlement
 * uses. Whether a casting is settled in one breath, held open for a
 * Counterspell or waiting on a trigger changes nothing about what the caster
 * said.
 *
 * One type here and one on `ReadiedResponse`, because the caller's word and
 * the held record are two different moments; what must not be written twice is
 * the *copying*, which is {@link statedOf}.
 */
export interface StatedFacts {
  /** Which of the damage types the spell prints this casting deals. */
  readonly damageType?: string;
  /** The value the caster chose, where the spell prints a choice. */
  readonly choice?: string;
  /** Which creatures the caster or their allies are fighting. */
  readonly fought?: readonly CharacterId[];
  /** Creatures the caster designated unaffected, for a spell that offers it. */
  readonly unaffected?: readonly CharacterId[];
  /** Where a teleporting spell puts its target. */
  readonly teleportTo?: Placement;
}

/** What this creature is holding for a trigger, or null. */
export function readiedBy(state: GameState, id: CharacterId): ReadiedAction | null {
  return creatureOf(state, id)?.readied ?? null;
}

/**
 * Ready an action: spend it now, to take a Reaction later.
 *
 * SRD: "You take the Ready action to wait for a particular circumstance before
 * you act. To do so, you take this action on your turn, which lets you act by
 * taking a Reaction before the start of your next turn."
 *
 * The deadline is the same turn-anchored one Dodge uses, expressed the same
 * way — an activated feature with a timer — because the benefit has to outlive
 * the turn that bought it, and a turn budget is cleared when the turn ends.
 *
 * A readied **spell** is the SRD's own special case and the only part of this
 * the engine has real rules for: "you cast it as normal (expending any
 * resources used to cast it) but hold its energy, which you release with your
 * Reaction when the trigger occurs... To be readied, a spell must have a
 * casting time of an action, and holding on to the spell's magic requires
 * Concentration." So the slot goes now and the effects do not, which is why
 * the casting and its resolution are two commands rather than one.
 */
export function takeReady(
  state: GameState,
  id: CharacterId,
  command: ReadyCommand,
  content: Content,
): Result<GameEvent[]> {
  return once(state, `ready:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    // SRD: "you take this action on your turn, which lets you act by taking a
    // Reaction before the start of your next turn." Both halves need turns.
    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'a readied action waits for a Reaction, and there are no turns to take one in');
    }
    if (creature.readied !== null) {
      return err('already_readied', `${id} is already holding a readied action`);
    }
    // **Not `no_trigger`.** That code says a Reaction's moment has not arrived,
    // which is a fact about the world and something a caller waits out; this
    // says the command did not say what it is waiting for, which is a fact
    // about the command and something a caller fixes by re-sending it. One
    // code carried both, and a tool surface branching on it could not tell a
    // Shield with no attack to answer from a Ready with an empty string.
    if (command.trigger.trim() === '') {
      return err('no_trigger_stated', 'a readied action waits for something; say what');
    }

    // Validate the whole thing before any of it is emitted, casting included:
    // a Ready that refuses must leave the action, the slot and the
    // Concentration exactly as they were.
    const spent = spendAction(state.combat, id, creature.conditions, {
      rules: actionRulesOn(state, id),
    });
    if (!spent.ok) return spent;

    const events: GameEvent[] = [{ type: 'action-spent', id }];
    let response: ReadiedResponse;

    if (command.response.kind === 'spell') {
      const held = holdSpell(state, content, id, command.response);
      if (!held.ok) return held;
      events.push(...held.value.events);
      response = held.value.response;
    } else if (command.response.kind === 'move') {
      response = { kind: 'move' };
    } else {
      response = {
        kind: 'action',
        ...(command.response.note === undefined ? {} : { note: command.response.note }),
      };
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: READY,
      ...(stamp === null ? {} : { command: stamp }),
    });
    events.push({ type: 'readied-declared', id, readied: { trigger: command.trigger, response } });

    const timer = featureTimer(state, id, READY_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/**
 * Cast the spell being readied, without resolving it.
 *
 * SRD: "you cast it as normal (expending any resources used to cast it) but
 * hold its energy." So this is an ordinary casting with the effects left
 * undone — the slot goes, and the Concentration that holds the magic starts,
 * whether or not the spell itself is a Concentration spell.
 *
 * The action is **not** spent here: the Ready action is the casting's action,
 * and charging for both would take two actions for one thing the SRD charges
 * once for. `castSpell` is the half beneath `resolveCast` that leaves the
 * economy alone, which is exactly the half this wants.
 */
function holdSpell(
  state: GameState,
  content: Content,
  id: CharacterId,
  response: ReadyResponse & { readonly kind: 'spell' },
): Result<{ readonly events: readonly GameEvent[]; readonly response: ReadiedResponse }> {
  const definition = content.spell(response.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${response.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD: "To be readied, a spell must have a casting time of an action."
  if (definition.castingTime !== 'action') {
    return err(
      'not_readiable',
      `${definition.name} is cast with a ${definition.castingTime}, and only a spell cast with an action can be readied`,
    );
  }

  const caster = creatureOf(state, id);
  if (caster === null) return unknownCreature(id);

  // SRD: you ready what you know or have prepared, and nothing else.
  const chosen = chooseRoute(caster.spellcasting, response.spellId, response.source);
  if (!chosen.ok) return chosen;
  const route = chosen.value;

  // — the four facts the caster states, and the engine will not guess ————————
  //
  // **The same validator, not a second copy of it.** `declaredFacts` is what
  // the atomic cast and the declaration both ask, so a spell that prints a
  // clause and a Ready that says nothing is refused with the same code, and a
  // spell that prints none and is told the fact is refused with the same code.
  // The three Dominates could not be readied at all before this: SRD prints
  // "It does so with Advantage if you or your allies are fighting it", so the
  // casting *requires* the fact and nothing on a `ReadyResponse` could say it.
  //
  // Asked here, **before the slot** — SRD spends it at the Ready and the
  // release has nothing left to refund, so a fact missing until the release
  // would be an action and a slot spent on a casting that could never be let
  // go. It reads only the four fields; a readied spell names its targets at
  // the release, and `targets` is empty because there are none to name yet.
  const stated = declaredFacts(state, definition, {
    spellId: response.spellId,
    targets: [],
    ...statedOf(response),
  });
  if (!stated.ok) return stated;

  const castLevel = Math.max(definition.level, response.slotLevel ?? definition.level);
  const castingId = nextCastingId(state);

  const cast = castSpell(state, id, {
    spell: definition.name,
    level: definition.level,
    // SRD: "holding on to the spell's magic requires Concentration" — for
    // every readied spell, not only the ones whose own Duration says so.
    concentration: true,
    castingTime: definition.castingTime,
    ...(response.slotLevel === undefined
      ? { slotless: 'cantrip' as const }
      : {
          slotLevel: response.slotLevel,
          ...(response.slotKind === undefined ? {} : { slotKind: response.slotKind }),
        }),
    route: routeLabel(route),
    // The printed text the book leaves to the table, pinned onto the casting
    // this Ready writes. CLAUDE.md's rule 5: a handover is something this
    // command read from content, and a Ready's `spell-cast` is written a turn
    // before the spell takes effect — so it is the only event that could carry
    // it. No SRD spell reaches here, because a Ready takes an Action casting
    // and all three SRD handovers take a minute or more; a homebrew definition
    // does.
    ...(definition.dmDecides === undefined ? {} : { dmDecides: definition.dmDecides }),
    // No duration. The spell has not taken effect, so its own clock has not
    // started; what *is* capped is the hold, and that is the Ready feature's
    // deadline rather than the spell's.
  });
  if (!cast.ok) return cast;

  return ok({
    events: cast.value,
    response: {
      kind: 'spell',
      spellId: response.spellId,
      castingId,
      castLevel,
      // Exactly what the caster said, and nothing the caller did not say:
      // `statedOf` elides an absent field rather than defaulting it, so a
      // Ready written before these existed folds to the state it always did.
      ...statedOf(response),
    },
  });
}

/**
 * The four stated facts, lifted off whichever record is carrying them.
 *
 * **One reader for all three places a readied spell touches them** — what
 * `declaredFacts` validates at the Ready, what the readied record stores, and
 * the request the release hands to `castOrRelease` — so a fifth stated fact is
 * one edit here rather than three that have to agree. The parameter is the
 * structural shape rather than either named type, because `ReadyResponse` and
 * `ReadiedResponse` are the *same four facts* said at two moments, and a
 * reader that named one of them would need a twin for the other, which is the
 * duplication this exists to prevent.
 *
 * **It normalises nothing, and that is the decision.** `statedFacts` sorts the
 * designation and elides it when empty, `foughtFor` sorts the fought list and
 * never elides it, and both belong to `spell-resolution.ts`, which owns the
 * two records a *casting* writes. A readied response is neither of those: it
 * is the caster's stated intent, held, and it reaches those two functions at
 * the release, through `castOrRelease`, which is the same door a settlement
 * goes through. Normalising half of it here — `foughtFor` is exported and
 * `statedFacts` is not — would be the second answer to one question this
 * repository keeps finding wrong.
 *
 * **Absent means absent**, in both directions: a field the caller omitted is
 * omitted from the record, and an empty `fought` is kept, because "none of
 * them" is an answer the spell insisted on — the one place `fought` and
 * `unaffected` part company, which `foughtFor` in `targeting.ts` records.
 *
 * Idempotent, which is what lets the release call it on a record `holdSpell`
 * already built rather than spelling the copy out a second time — the property
 * `statedFacts` has for the same reason.
 */
function statedOf(response: StatedFacts): StatedFacts {
  return {
    ...(response.damageType === undefined ? {} : { damageType: response.damageType }),
    ...(response.choice === undefined ? {} : { choice: response.choice }),
    ...(response.fought === undefined ? {} : { fought: response.fought }),
    ...(response.unaffected === undefined ? {} : { unaffected: response.unaffected }),
    ...(response.teleportTo === undefined ? {} : { teleportTo: response.teleportTo }),
  };
}

/**
 * What letting the held action go actually did.
 *
 * One shape with two optional halves rather than a union, because what the
 * release *always* does — spend the Reaction, close the hold — is the same
 * whichever response was held, and the rest is what that response happened to
 * be. An `action` response fills in neither: the engine has commands for a
 * handful of the SRD's open action list, so the caller takes it from here.
 */
export interface ReadyRelease {
  readonly events: readonly GameEvent[];
  /** Whether the Reaction was taken, or the trigger let pass. */
  readonly took: boolean;
  /** The spell that landed, for a readied spell. */
  readonly spell?: SpellResolution;
  /** The move that was made, for a readied move. */
  readonly move?: MoveResolution;
}

/** How the held action is being let go. */
export interface ReleaseCommand extends CommandIdentity {
  /**
   * SRD: "you can either take your Reaction right after the trigger finishes
   * **or ignore the trigger**." Ignoring costs nothing and keeps the Reaction.
   */
  readonly ignore?: boolean;
  /** Who a readied spell lands on. Empty for an area spell, which picks its own. */
  readonly targets?: readonly CharacterId[];
  /** Where a readied area spell's origin goes. */
  readonly at?: Point;
  /** Where a readied move goes, relative to something already established. */
  readonly placement?: Placement;
  /** How many feet of that move are through Difficult Terrain. */
  readonly difficultFeet?: number;
  /**
   * The 5-foot spaces that move passed through — `MoveCommand.route`, and for
   * the same reason.
   *
   * **A readied move is charged for the ground it crosses, so it can be asked
   * which ground that was.** The allowance is the mover's Speed and the patches
   * the table has declared come off it exactly as they do on the mover's own
   * turn, so `chargeTerrain` reaches `route_required` here as readily as it
   * does from `resolveMove` — and until this field existed the answer to that
   * question had nowhere to go. The caller was told to send the same command
   * again with a field the command did not have, which is a refusal that
   * cannot be acted on however carefully it is read.
   */
  readonly route?: readonly Point[];
}

/**
 * Take the Reaction a readied action was held for — or let the trigger pass.
 *
 * The trigger is Maestro's call and has already been made by the time this is
 * reached; what the engine owns is the Reaction, the hold, and, for a readied
 * spell, everything the spell does.
 *
 * For an `action` response this spends the Reaction and clears the hold; the
 * action itself goes through its own command afterwards, because the SRD's
 * action list is open and the engine has commands for a handful of it. An
 * attack taken this way is `resolveAttack({ free: true })` — the Reaction is
 * what paid for it, exactly as an Opportunity Attack is.
 */
export function releaseReady(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: Supply,
): Result<ReadyRelease> {
  // Without this the retry came back `nothing_readied` — a refusal, telling
  // the caller the hold never existed when in fact their first call consumed
  // it. A retry that reads as a rules problem is worse than one that doubles,
  // because the DM narrates the lie.
  return once(state, `release:${id}`, command, () => ({ events: [], took: true }), (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    const readied = creature.readied;
    if (readied === null) {
      return err('nothing_readied', `${id} is not holding a readied action`);
    }

    // SRD: "or ignore the trigger." Nothing is spent and nothing happens — but
    // the hold is gone, because the trigger it was waiting for has been and
    // passed. A held spell dissipates with it.
    if (command.ignore === true) {
      return ok({
        events: [
          {
            type: 'readied-released',
            id,
            took: false,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        took: false,
      });
    }

    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'there is no Reaction to spend outside combat');
    }
    const spent = spendReaction(state.combat, id, creature.conditions, {
      rules: actionRulesOn(state, id),
    });
    if (!spent.ok) return spent;

    const events: GameEvent[] = [
      { type: 'reaction-spent', id },
      { type: 'readied-released', id, took: true, ...(stamp === null ? {} : { command: stamp }) },
    ];

    if (readied.response.kind === 'spell') {
      return releaseSpell(state, id, readied.response, command, supply, events);
    }
    if (readied.response.kind === 'move') {
      return releaseMove(state, id, command, supply, events);
    }

    return ok({ events, took: true });
  });
}

/**
 * Move as the Reaction a Ready held back.
 *
 * SRD: "you choose to move up to your Speed in response to it." The Reaction
 * is what paid for this, so no Speed is spent — a turn budget belongs to a
 * turn and this is somebody else's, which is why `spendMovement` refuses it by
 * construction and is right to. The allowance is the mover's Speed **now**,
 * read through `speedOf` like every other Speed the command layer asks for —
 * so whatever has arrived since they readied applies: a creature Grappled
 * while waiting has a Speed of 0 and goes nowhere, and a Monk who put their
 * Shield down has the ten feet their feature gives back.
 *
 * Everything else is an ordinary move. It provokes, because it is the
 * creature's own movement and SRD offers the Opportunity Attack for leaving a
 * reach without caring what paid for the leaving.
 */
function releaseMove(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: Supply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  if (command.placement === undefined) {
    return err('no_placement', `${id} readied a move; say where to`);
  }

  const combat = state.combat;
  const creature = creatureOf(state, id);
  if (combat === null || creature === null) {
    return err('not_in_combat', 'there is no Reaction to spend outside combat');
  }

  const allowance = speedOf(state, id);

  const after = spentSoFar.reduce(applyEvent, state);
  const moved = moveWithin(
    after,
    id,
    {
      placement: command.placement,
      ...(command.difficultFeet === undefined ? {} : { difficultFeet: command.difficultFeet }),
      ...(command.route === undefined ? {} : { route: command.route }),
    },
    supply,
    allowance,
  );
  if (!moved.ok) return moved;

  return ok({
    events: [...spentSoFar, ...moved.value.events],
    took: true,
    move: moved.value,
  });
}

/**
 * Let a held spell go, and resolve it where it lands.
 *
 * The slot went when it was readied, so nothing is paid here. What still has
 * to happen is the half `castSpell` would have done had the spell been cast
 * normally at this moment: the Concentration settles, and the spell's own
 * duration starts now rather than when the magic was first gathered.
 */
function releaseSpell(
  state: GameState,
  id: CharacterId,
  response: ReadiedResponse & { readonly kind: 'spell' },
  command: ReleaseCommand,
  supply: Supply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  const definition = supply.content.spell(response.spellId);
  if (definition === null) {
    return err('no_definition', `${response.spellId} has no executable definition`);
  }

  const events: GameEvent[] = [...spentSoFar];

  // The Concentration was holding the magic, not the spell. A spell whose own
  // Duration does not say Concentration has nothing left to concentrate on
  // once it has happened, so the hold ends — **before** the effects land, or
  // ending the casting would take the conditions the release just created.
  if (!definition.concentration) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: response.castingId,
      reason: 'released',
    });
  }

  const after = events.reduce(applyEvent, state);
  const resolved = castOrRelease(
    after,
    id,
    {
      spellId: response.spellId,
      targets: command.targets ?? [],
      ...(command.at === undefined ? {} : { at: command.at }),
      ...(definition.level === 0 ? {} : { slotLevel: response.castLevel }),
      // What the caster stated at the Ready, put back on the request the
      // resolution reads — through the same `statedOf` that validated them and
      // wrote them down, so a fifth stated fact is one edit rather than three
      // that have to agree. **Not restated by the release**: `ReleaseCommand`
      // carries no field for any of the four, so a Dimension Door readied at
      // the far end of the hall cannot be let go beside its caster — the same
      // rule as `resolveDeclaredCast`, which takes no fresh request either.
      // They reach `statedFacts` and `foughtFor` from here exactly as a
      // settlement's do, which is what keeps one normaliser for three doors.
      ...statedOf(response),
    },
    supply,
    { castingId: response.castingId },
  );
  // A refusal of any kind takes the whole batch with it: the Reaction is
  // still there and the spell is still held. That was already true of a rules
  // refusal; it is now true of a missing fact too, which used to come back as
  // a success and needed unpicking here.
  if (!resolved.ok) return resolved;

  events.push(...resolved.value.events);

  // SRD writes a readied spell's Duration from the moment it takes effect, and
  // that moment is now. `castSpell` would have scheduled this at the casting;
  // the casting was a turn ago and did nothing.
  if (definition.durationSeconds !== undefined) {
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'casting', castingId: response.castingId },
      // The band the slot reached, through the same reader the ordinary
      // resolution uses — a readied spell cast from a level 5 slot lasts what
      // a level 5 slot buys, and two spellings of that arithmetic would be two
      // places for one sentence to go wrong.
      { kind: 'seconds', seconds: durationSecondsAt(definition, response.castLevel)! },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok({ events, took: true, spell: resolved.value });
}

