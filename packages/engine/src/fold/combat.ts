/**
 * The combat record: the Initiative order, the turn, and the action economy.
 *
 * Everything here writes `state.combat` and nothing else — including
 * `feature-used`, whose once-per-turn ledger lives on the combat record
 * because a turn is what it is measured in.
 *
 * `turn-advanced` is the seam's one derived moment, and the order of what it
 * calls is load-bearing: see `turns.ts`.
 */
import {
  addCombatant,
  advanceTurn,
  dash,
  disengage,
  grantMovement,
  markFeatureUsed,
  removeCombatant,
  grantTurnBudget,
  spendAction,
  spendAttack,
  spendBonusAction,
  spendMovement,
  spendReaction,
  startCombat,
  swapInitiative,
  useFreeInteraction,
} from '../combat.js';
/**
 * The one Speed reader, asked by the fold for exactly the reason the command
 * asks it: a reducer backstop measuring against a different number is a fork
 * rather than a guard.
 *
 * **Not a cycle, and not a catalogue lookup.** `standing.ts` imports
 * `GameState` from `state.ts` `type`-only, so the runtime edge runs one way;
 * and every input `speedOf` reads is log-held — the pinned combatant speed,
 * `sheet.standing` carried by `character-created`, `equipped`, conditions — so
 * the fence `upgradeOngoing` stands behind is intact and a future correction
 * to the Monk table changes future sheets rather than historical folds.
 */
import { actionRulesOn, speedOf } from '../standing.js';
import { MOVEMENT_MODES } from '../character.js';
import type { CharacterId } from '@ie/shared';
import { attacksInAction, statedBonusActionSlot, statedBonusActionsUsed } from '../monster.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  combatOf,
  creatureOf,
  must,
  withCombat,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import {
  failUnsustainedCastings,
  forgetCarriedTurns,
  forgetSustainedTurns,
  raiseTurnEnd,
  raiseTurnSaves,
} from './turns.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const COMBAT_EVENTS = [
  'combat-started',
  'combat-ended',
  'turn-advanced',
  'action-spent',
  'bonus-action-spent',
  'attack-made',
  'unarmed-strike-made',
  'dash-taken',
  'disengage-taken',
  'reaction-spent',
  'budget-compelled',
  'movement-spent',
  'movement-granted',
  'free-interaction-used',
  'utilize-taken',
  'help-given',
  'combatant-joined',
  'combatant-removed',
  'initiative-swapped',
  'turn-budget-granted',
  'feature-used',
  'stated-bonus-action-taken',
  'stated-action-taken',
  'reaction-taken',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type CombatEvent = Extract<GameEvent, { type: (typeof COMBAT_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isCombatEvent = seamOf(COMBAT_EVENTS);

/**
 * The most a `movement-spent` may say this creature spent: its fastest Speed.
 *
 * **The reducer's backstop is deliberately weaker than the rule, because the
 * rule needs a fact the event does not carry.** A creature with more than one
 * Speed spends the turn's feet against whichever it is using at the time —
 * SRD: "you can switch back and forth between your Speeds" — so a Cockatrice
 * that flies forty feet writes a perfectly legal `movement-spent` of 40 that
 * a walking Speed of 20 would call corrupt. Which mode a move used is the
 * *command's* to check and it does (`wayOf`, `commands/movement.ts`); this
 * asks the question the event can answer on its own, which is whether the
 * creature could have gone that far by any means it has.
 *
 * A guard that refuses an event the engine itself emits is worse than a
 * looser guard: it is a log that cannot be replayed. The exact check stays
 * where the mode is known, and this stays a coherence check — the same
 * division `endCombat`'s refusals are held to two paragraphs below.
 *
 * Identical to `speedOf(state, who)` for every creature with one Speed, which
 * is every creature in both frozen logs.
 */
const spendableSpeed = (state: GameState, who: CharacterId): number =>
  Math.max(...MOVEMENT_MODES.map((mode) => speedOf(state, who, mode)));

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyCombat({ state, next }: Applying, event: CombatEvent): GameState {
  switch (event.type) {
    case 'combat-started':
      return { ...next, combat: must(event, startCombat(event.combatants)) };

    case 'combat-ended': {
      // A fight that was never running cannot end, and a log that says it did
      // contradicts itself — so the reducer asks for the combat it is about to
      // clear and throws if there is none. That is `endCombat`'s `not_in_combat`
      // refusal read from this side: the command declines to write exactly what
      // the reducer would call corrupt. Its *other* refusals are not the
      // reducer's and cannot be — `removeCreatureEverywhere` writes a
      // `combat-ended` without asking whose side anybody was on, and a fold
      // that demanded it would refuse an event the engine itself emits.
      //
      // The rites go on running; what goes is which *turn* last sustained one,
      // because turn numbers restart with the next fight.
      combatOf(state, event);
      // Both stamps are counted in this fight's turns, and both go with it — see
      // `forgetSustainedTurns` and `forgetCarriedTurns`.
      return forgetCarriedTurns(forgetSustainedTurns({ ...next, combat: null }));
    }

    case 'turn-advanced': {
      const before = combatOf(state, event);
      const after = advanceTurn(before);
      // A rite the ending turn's caster did not keep at fails **before** the
      // end-of-turn area debts are raised, so the boundary's debts are raised
      // against the world the failure leaves. See `failUnsustainedCastings`.
      return raiseTurnEnd(
        failUnsustainedCastings(
          raiseTurnSaves(withCombat(next, state, after), before, after),
          before,
        ),
        before,
        after,
      );
    }

    // **The action rules are deliberately not re-checked here, and that is a
    // decision rather than an omission.** `spendAction` takes them and this
    // call passes none, exactly as it passes no `conditions`: the reducer has
    // never re-derived whether a creature was Incapacitated when it acted.
    //
    // The reason it must not start with *these* is the one the Speed above
    // records with the sign reversed. A rule may narrow a slot to a named few
    // — SRD Wind Walk, SRD Fear — and `action-spent` does not say **which**
    // named action was taken; only the command knew. So a fold that asked
    // would fail closed on a Dodge the command had legally permitted, and
    // refuse the very event the command emitted. That is the Dodge-versus-
    // Fire-Bolt fork arriving on a new field, and a backstop with inputs the
    // command did not have is not a guard.
    //
    // Putting the name on the event would close it, and is not this task's:
    // it widens `action-spent`, which every emitter and both frozen logs
    // already write. Whoever needs the fold to hold this line should add the
    // name there first, and then this call can ask with what the command had.
    // `grant` is the extra action the command spent, where it spent one: the
    // reducer performs the same spend rather than guessing, exactly as
    // `movement-spent` already names the grant a Tactical Shift's feet came
    // out of. Absent is the turn's own action.
    case 'action-spent':
      return withCombat(
        next,
        state,
        must(
          event,
          spendAction(combatOf(state, event), event.id, undefined, undefined, event.grant),
        ),
      );

    case 'bonus-action-spent':
      return withCombat(
        next,
        state,
        must(event, spendBonusAction(combatOf(state, event), event.id)),
      );

    // **One spend, two events**, and the second of them is here rather than in
    // a case of its own because the budget arithmetic is identical: an Unarmed
    // Strike's Grapple and Shove options are the Attack action's one attack.
    // What separates them is what `fold/endings.ts` reads, and it reads only
    // the first — see `unarmed-strike-made` in `events.ts`.
    case 'attack-made':
    case 'unarmed-strike-made': {
      const creature = creatureOf(state, event, event.id);
      return withCombat(
        next,
        state,
        must(
          event,
          spendAttack(
            combatOf(state, event),
            event.id,
            // The command's own question with the command's own inputs — the
            // sheet's count, or the head count the table declared for a block
            // whose sequence the parser could not read, or the larger branch a
            // Bonus Action the creature took this turn has bought it. A reducer
            // measuring against a different number is a fork rather than a
            // guard, and the ledger this reads was folded by the event that
            // wrote it, which is earlier in the same log.
            attacksInAction(
              creature.sheet,
              creature.heads,
              statedBonusActionsUsed(
                combatOf(state, event).budgets[event.id]?.featureUsedOnTurn ?? {},
                combatOf(state, event).turnsTaken,
              ),
            ),
            creature.conditions,
            // **The rules standing on the creature, which this case can pass and
            // `action-spent` cannot.** SRD Slow caps the Attack action at one
            // swing, and that cap is *arithmetic* — it changes what
            // `attacksRemaining` is seeded with — so a reducer that could not
            // read it would write a different budget than the command measured
            // against, which is a fork rather than a guard. The ambiguity
            // `action-spent` records does not arise: `spendAttack` names the
            // spend `attack` itself, so a `permits-only` here answers exactly
            // what the command asked it, on the same pre-event state. Passing
            // them is therefore `budget-compelled`'s case.
            { rules: actionRulesOn(state, event.id) },
            // The command's own question again: attacks a feature bought
            // outside the Attack action may be narrowed to Unarmed Strikes,
            // and which this was is a fact only the command held until the
            // event carried it. Absent is a weapon, which is what every log
            // written before the field says.
            // An `unarmed-strike-made` needs no field to answer this: Grapple
            // and Shove *are* two of the Unarmed Strike's three options, so the
            // event's own type is the answer. A `attack-made` says which it was,
            // and absent is a weapon, which is what every log written before the
            // field says.
            event.type === 'unarmed-strike-made' ? true : (event.unarmed ?? false),
            // And the Light weapon the swing used, where it used one. An
            // Unarmed Strike never does; a weapon swing says so or says
            // nothing, which is what every log written before the field says.
            event.type === 'unarmed-strike-made' ? null : (event.light ?? null),
            // And what the swing was and whom at, where the command pinned it
            // — W7-B10 — so a grant narrowed to one line at one creature is
            // spent here exactly as the command spent it.
            event.type === 'attack-made' && event.swing !== undefined
              ? { name: event.swing.line, target: event.swing.against }
              : null,
          ),
        ).state,
      );
    }

    // SRD Dash: "The increase equals your Speed **after applying any
    // modifiers**." `speedOf` is the one reader of that, so the fold asks it
    // exactly as `takeDash` does — the command's own check with the command's
    // own inputs, which is the only thing that makes a reducer backstop honest.
    case 'dash-taken':
      return withCombat(
        next,
        state,
        must(event, dash(combatOf(state, event), event.id, speedOf(state, event.id))),
      );

    case 'disengage-taken': {
      return withCombat(
        next,
        state,
        must(event, disengage(combatOf(state, event), event.id)),
      );
    }

    case 'reaction-spent':
      return withCombat(next, state, must(event, spendReaction(combatOf(state, event), event.id)));

    // **A spell spending somebody's slot, and the backstop asks with the
    // command's own inputs.** Unlike `action-spent` above, this event names no
    // action at all — the spender is a casting and there is nothing for it to
    // name — so the rules standing on the creature *can* be passed here: a
    // `permits-only` refuses an unnamed spend, and the command that emitted
    // this asked the same primitive the same question and emitted nothing
    // where the answer was no. Passing them is therefore a guard rather than
    // the fork `action-spent` records; leaving them out would let a compelled
    // Reaction through a Slow that had forbidden Reactions.
    case 'budget-compelled': {
      const creature = creatureOf(state, event, event.id);
      const spend = { rules: actionRulesOn(state, event.id) };
      const combat = combatOf(state, event);
      return withCombat(
        next,
        state,
        must(
          event,
          event.slot === 'action'
            ? spendAction(combat, event.id, creature.conditions, spend)
            : event.slot === 'bonus-action'
              ? spendBonusAction(combat, event.id, creature.conditions, spend)
              : spendReaction(combat, event.id, creature.conditions, spend),
        ),
      );
    }

    // The allowance is `speedOf`'s, here as in `resolveMove`. This call used to
    // pass no Speed at all and fell back to the pinned one, so the fold
    // measured the very event the command had emitted against a different
    // number — and refused a Monk's legal 35-foot move as a corrupt log. A
    // backstop with the wrong inputs is a fork, not a guard.
    case 'movement-spent':
      return withCombat(
        next,
        state,
        must(
          event,
          spendMovement(
            combatOf(state, event),
            event.id,
            event.feet,
            spendableSpeed(state, event.id),
            undefined,
            // Which of the two allowances this came out of, which is a fact
            // only the command held until the event carried it: a grant's feet
            // take nothing off the turn's own Speed, and measuring one against
            // the other would be the fork `spendableSpeed` exists to prevent.
            event.grant,
            // **The shape of the move, kept on the turn it was made on.** Both
            // ends or neither: an event written before the field existed, or
            // by a mover with no map under them, records no segment — and a
            // charge gate reading the turn back then finds nothing, which is
            // the answer "no record is no charge" names.
            event.from === undefined || event.to === undefined
              ? undefined
              : { from: event.from, to: event.to, feet: event.feet },
          ),
        ),
      );

    // The number is the event's, pinned at the moment the feature was used:
    // half of a Speed is half of the Speed it was used at, and `speedOf` today
    // is a different question. So the backstop asks what the command asked —
    // that it is this creature's turn — and takes the feet as stated.
    case 'movement-granted':
      return withCombat(
        next,
        state,
        must(
          event,
          grantMovement(combatOf(state, event), event.id, {
            source: event.source,
            feet: event.feet,
          }),
        ),
      );

    case 'free-interaction-used':
      return withCombat(
        next,
        state,
        must(event, useFreeInteraction(combatOf(state, event), event.id)),
      );

    // The order's length changes here and nowhere else. `addCombatant` is the
    // one path that grows it, so the reducer asks it exactly as the command
    // did: a backstop that worked the insertion out for itself would be a
    // second ranking, and a second ranking is a fork.
    case 'combatant-joined':
      return withCombat(
        next,
        state,
        must(event, addCombatant(combatOf(state, event), event.combatant)),
      );

    case 'combatant-removed':
      return withCombat(
        next,
        state,
        must(event, removeCombatant(combatOf(state, event), event.id)),
      );

    case 'initiative-swapped':
      return withCombat(
        next,
        state,
        must(event, swapInitiative(combatOf(state, event), event.a, event.b)),
      );

    // The one door that adds to a turn rather than spending from it. What it
    // cost is the `resource-spent` and the `bonus-action-spent` beside it,
    // folded here and by the resource seam like any other; this is what was
    // bought, and the numbers on it were pinned by the command that read them.
    case 'turn-budget-granted':
      return withCombat(
        next,
        state,
        must(
          event,
          grantTurnBudget(combatOf(state, event), event.id, {
            ...(event.action === undefined
              ? {}
              : {
                  action: {
                    source: event.source,
                    ...(event.action.except === undefined ? {} : { except: event.action.except }),
                    ...(event.action.only === undefined ? {} : { only: event.action.only }),
                    // SRD Haste's parenthesis, read off the event like the two
                    // narrowings beside it: the budget is written by a combat
                    // event and nothing else, so this is where the cap enters
                    // the turn it governs.
                    ...(event.action.attacksCap === undefined
                      ? {}
                      : { attacksCap: event.action.attacksCap }),
                  },
                }),
            ...(event.attacks === undefined
              ? {}
              : {
                  attacks: {
                    ...event.attacks,
                    // What sold them, read off the event beside the name the
                    // log calls it: a rider written about "an attack granted
                    // by your Flurry of Blows" asks the budget and not the
                    // catalogue.
                    ...(event.purchase === undefined ? {} : { from: event.purchase }),
                  },
                }),
          }),
        ),
      );

    case 'feature-used': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a once-per-turn feature was used outside combat');
      }
      creatureOf(state, event, event.id);
      return { ...next, combat: markFeatureUsed(state.combat, event.id, event.feature, event.turn) };
    }

    // The same ledger under its own namespace: what was spent is a line the
    // creature's block prints, and the question anything asks of it is the
    // once-per-turn one. The Bonus Action it cost is the `bonus-action-spent`
    // beside it, folded by this seam like any other.
    case 'stated-bonus-action-taken': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a printed Bonus Action was taken outside combat');
      }
      creatureOf(state, event, event.id);
      return {
        ...next,
        combat: markFeatureUsed(
          state.combat,
          event.id,
          statedBonusActionSlot(event.line),
          event.turn,
        ),
      };
    }

    // An Actions line the parser read nothing out of. It changes nothing here:
    // the Action it cost is the `action-spent` beside it, folded by this seam
    // like any other, and nothing gates a branch on one of these the way a
    // Multiattack gates on a Bonus Action — so there is no ledger entry to
    // write and no turn on the event to write it with. What it is checked for
    // is what every event in this seam is checked for: a fight to have happened
    // in and a creature it happened to.
    case 'stated-action-taken': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a printed Action was taken outside combat');
      }
      creatureOf(state, event, event.id);
      return next;
    }

    // Changes nothing, like `roll-recorded`. It exists so the log can say why
    // a creature swung outside its turn, and so the command that did it has a
    // stamp to ride on.
    case 'reaction-taken':
      return next;

    // The same two reasons, one action along: the slot beside them is what
    // was spent, and these say what it was spent on. A Utilize touches the
    // free interaction deliberately not at all — it is what a creature takes
    // instead of reaching for it — and a Help's benefit is the
    // `roll-modifier-granted` and the timer beside this event, both of which
    // `fold/grants.ts` and `fold/timers.ts` own. What is checked is what this
    // seam checks of everything: a fight, and a creature it happened to.
    case 'utilize-taken':
    case 'help-given': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'an action was taken outside combat');
      }
      creatureOf(state, event, event.id);
      if (event.type === 'help-given') creatureOf(state, event, event.ally);
      return next;
    }
  }

  return unhandledEvent(event);
}
