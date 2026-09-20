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
  markFeatureUsed,
  removeCombatant,
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
import { speedOf } from '../standing.js';
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
  'dash-taken',
  'disengage-taken',
  'reaction-spent',
  'movement-spent',
  'free-interaction-used',
  'combatant-joined',
  'combatant-removed',
  'initiative-swapped',
  'feature-used',
  'reaction-taken',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type CombatEvent = Extract<GameEvent, { type: (typeof COMBAT_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isCombatEvent = seamOf(COMBAT_EVENTS);

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
      return forgetSustainedTurns({ ...next, combat: null });
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
    case 'action-spent':
      return withCombat(next, state, must(event, spendAction(combatOf(state, event), event.id)));

    case 'bonus-action-spent':
      return withCombat(
        next,
        state,
        must(event, spendBonusAction(combatOf(state, event), event.id)),
      );

    case 'attack-made': {
      const creature = creatureOf(state, event, event.id);
      return withCombat(
        next,
        state,
        must(
          event,
          spendAttack(
            combatOf(state, event),
            event.id,
            creature.sheet.attacksPerAction ?? 1,
            creature.conditions,
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
          spendMovement(combatOf(state, event), event.id, event.feet, speedOf(state, event.id)),
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

    case 'feature-used': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a once-per-turn feature was used outside combat');
      }
      creatureOf(state, event, event.id);
      return { ...next, combat: markFeatureUsed(state.combat, event.id, event.feature, event.turn) };
    }

    // Changes nothing, like `roll-recorded`. It exists so the log can say why
    // a creature swung outside its turn, and so the command that did it has a
    // stamp to ride on.
    case 'reaction-taken':
      return next;
  }

  return unhandledEvent(event);
}
