/**
 * What a turn boundary collects, and why it is two moments rather than one.
 *
 * One `turn-advanced` carries the finishing creature's end and the next
 * creature's start, and they are a round apart. Ordering the settlements is
 * not enough — whether the next creature is caught at its start is a question
 * about the world the previous creature's end left behind, and that world does
 * not exist while the end is still owed. So `raiseTurnEnd` raises the end and
 * `reachStartOfTurn` is the derived pass that reaches the start once nothing
 * the end owed is outstanding.
 *
 * `raiseTurnSaves` is the other debt a boundary raises: the reducer cannot
 * roll, so it records what is owed and an engine-owned operation settles it.
 *
 * `failUnsustainedCastings` is the third thing a boundary does and the only one
 * that *ends* something: SRD's per-turn Magic action for a casting of a minute
 * or more, which nobody decides has gone unspent.
 *
 * `openTurnStart` is the boundary a fight *opens* on, which is the same moment
 * arriving by a different door — see its own docstring.
 */
import { sourceOfInstance } from '../conditions.js';
import { isDue, pendingSaveKey, type PendingSave } from '../duration.js';
import { type CombatState } from '../combat.js';

import type { GameState, PendingCasting } from '../state.js';
import { sortedRecord } from './common.js';
import { raiseAreaBoundary } from './areas.js';
import { releaseCasting } from './release.js';

/**
 * Raise the saves a turn boundary owes.
 *
 * The reducer cannot roll — randomness enters the log once, at the point of
 * the roll — so this records the debt and an engine-owned operation settles
 * it. Derived from `turn-advanced` rather than commanded, for the same reason
 * a broken Concentration is: nobody decides that a turn ended, so nobody
 * should have to remember what ending it costs.
 *
 * Keyed by effect *and* turn, so folding the log twice raises one save, and a
 * later turn raises it again — which is what "repeats the save" means.
 *
 * **The order is the key's, and it is total over every kind of source.** The
 * timers are walked sorted and merged through `sortedRecord`, so what decides
 * which of two saves owed at one boundary is rolled first is
 * `condition|<who>|<condition>:<source>@<turn>` compared as a string — never
 * the order the timers happened to be filed in, and never a casting number a
 * potion has not got. That matters at the dice rather than at the tidiness:
 * `resolvePendingSaves` rolls them in that order out of one generator, so the
 * order *is* which save gets which die.
 */
export function raiseTurnSaves(
  state: GameState,
  before: CombatState,
  after: CombatState,
): GameState {
  const ended = before.order[before.turnIndex]?.id;
  const begun = after.order[after.turnIndex]?.id;

  const raised: Record<string, PendingSave> = {};
  for (const key of Object.keys(state.timers).sort()) {
    const timer = state.timers[key];
    const hook = timer?.repeatSave;
    if (timer === undefined || hook === undefined) continue;
    if (timer.target.kind !== 'condition') continue;

    const fires =
      hook.at === 'end-of-turn' ? hook.of === ended : hook.of === begun;
    if (!fires) continue;

    // **What put the condition there, whatever that was.** This asked
    // `castingIdOf` for a casting id and `continue`d on null, so a repeat save
    // under any other source — a potion's, a caller's own — was an obligation
    // the boundary dropped in silence. The debt is about the *effect*, and the
    // source is what a success later has to end.
    raised[pendingSaveKey(key, after.turnsTaken)] = {
      effectKey: key,
      target: timer.target.on,
      source: sourceOfInstance(timer.target.instance),
      ability: hook.ability,
      dc: hook.dc,
      onSuccess: hook.onSuccess,
      label: hook.label,
      turn: after.turnsTaken,
    };
  }

  if (Object.keys(raised).length === 0) return state;
  return { ...state, pendingSaves: sortedRecord({ ...state.pendingSaves, ...raised }) };
}

/**
 * A rite its caster let slip, ended by the turn that ended without it.
 *
 * SRD "Longer Casting Times": "you must take the Magic action on **each of your
 * turns**, and you must maintain Concentration while you do so. If your
 * Concentration is broken, the spell fails, but you don't expend a spell slot."
 *
 * **Derived, so no event.** Nobody decides that a turn ended without the Magic
 * action being taken, exactly as nobody decides that a Concentration broke —
 * so this is the reducer's, and no log however assembled can show a rite
 * running past a turn its caster let slip. It goes out through
 * `releaseCasting`, the single door every other ending already uses, which is
 * also where the slot is left unspent: nothing is refunded because nothing was
 * taken.
 *
 * **Before the end-of-turn area debts are raised.** The failure is a fact about
 * the turn that is ending, so the boundary's debts are raised against the world
 * the failure leaves rather than the other way round. That ordering is
 * unobservable today — a casting that has taken no effect owns no area, no
 * timer and no condition, so it can owe nothing and be owed nothing — and it is
 * decided here rather than left to luck, which is the argument this file
 * already makes about `isDue` against `hasExpired`.
 *
 * **The turn compared against is the one that ended**, `before.turnsTaken`,
 * which is the same number `raiseTurnEnd` stamps its end-of-turn debts with and
 * for the same reason: `turnsTaken` has already moved on by the time the
 * reducer sees `turn-advanced`.
 *
 * The iteration reads the record as it stood before any release, which is safe
 * because releasing one casting can never add another, and it is in
 * casting-number order, so the fold is a pure function of the log.
 */
export function failUnsustainedCastings(state: GameState, before: CombatState): GameState {
  const whose = before.order[before.turnIndex]?.id;
  if (whose === undefined) return state;

  let current = state;
  for (const castingId of Object.keys(state.pendingCastings)) {
    const pending = state.pendingCastings[castingId];
    if (pending === undefined) continue;
    // Only a casting of a minute or more is owed anything on a turn; an
    // instant window — a Counterspell being answered — has no such obligation,
    // and `completesAt` is the field that says which this is.
    if (pending.completesAt === undefined) continue;
    if (pending.caster !== whose) continue;
    if (pending.sustainedOnTurn === before.turnsTaken) continue;
    current = releaseCasting(current, pending.caster, castingId);
  }
  return current;
}

/**
 * Forget which turn sustained a rite, because the numbering has gone.
 *
 * `turnsTaken` restarts at zero with each fight, so a marker left over from the
 * last one names a turn that has not happened — and would silently credit turn
 * 3 of the next fight with the Magic action taken on turn 3 of the last. The
 * rite itself is untouched: a fight ending is not a Concentration broken, and
 * outside combat the casting simply runs on the clock again.
 */
export function forgetSustainedTurns(state: GameState): GameState {
  const keys = Object.keys(state.pendingCastings);
  if (!keys.some((key) => state.pendingCastings[key]?.sustainedOnTurn !== undefined)) {
    return state;
  }

  const pendingCastings: Record<string, PendingCasting> = {};
  for (const key of keys) {
    const casting = state.pendingCastings[key]!;
    if (casting.sustainedOnTurn === undefined) {
      pendingCastings[key] = casting;
      continue;
    }
    const without: PendingCasting & { sustainedOnTurn?: number } = { ...casting };
    delete without.sustainedOnTurn;
    pendingCastings[key] = without;
  }
  return { ...state, pendingCastings };
}

/**
 * The finishing creature's end, and a note that a start is still to come.
 *
 * **The end of a turn belongs to the turn that is ending.** `turnsTaken` has
 * already moved on by the time the reducer sees `turn-advanced`, so stamping
 * the end with the new number would put a creature's entry and the end of the
 * very turn it entered on into two different turns — and Insect Plague's "only
 * once per turn" would catch it twice.
 *
 * The start is **not** raised here. What catches a creature as its turn begins
 * is a question about the world the previous creature's end left behind, and
 * that world does not exist yet. See {@link GameState.pendingTurnStart}.
 */
export function raiseTurnEnd(state: GameState, before: CombatState, after: CombatState): GameState {
  const ended = raiseAreaBoundary(
    state,
    'end-of-turn',
    before.order[before.turnIndex]?.id,
    before.turnsTaken,
  );
  const begun = after.order[after.turnIndex]?.id;
  return begun === undefined
    ? ended
    : { ...ended, pendingTurnStart: { who: begun, turn: after.turnsTaken } };
}

/**
 * The start of the first turn of a fight, which nothing used to raise.
 *
 * `startCombat` has always said it in a comment of its own — "the first
 * combatant's turn starts with the fight", and it bumps that creature's
 * `begun` count to prove it — but only `turn-advanced` ever recorded a start
 * for anything to be caught by. So a creature that had been standing in a Web
 * since before anybody rolled Initiative began the fight in it and saved
 * against nothing, and every other consequence of a turn beginning was missed
 * with it.
 *
 * **It goes through `pendingTurnStart` rather than raising the debts itself**,
 * which is what makes this a repair rather than a second authority on what a
 * turn's start owes. {@link reachStartOfTurn} is the one place a start is
 * reached, and it is reached by the same route whichever door the moment came
 * through — so a consequence added there arrives at the opening turn too,
 * without anybody remembering that fights have two beginnings.
 *
 * **Only `combat-started`**, and only the creature at the front of the order.
 * A fight beginning starts exactly one turn; the rest of the order is waiting,
 * and a boundary raised for a creature whose turn has not come would catch it
 * a round early. `combatant-joined` raises nothing for the same reason —
 * joining an order does not begin a turn.
 */
export function openTurnStart(state: GameState): GameState {
  const combat = state.combat;
  if (combat === null) return state;

  // `startCombat` refuses an empty order, so this is a defensive read rather
  // than a case: a fold that got here with no combatant has nothing to raise
  // for, and throwing would be the corrupt-log backstop's job and not this
  // pass's.
  const first = combat.order[combat.turnIndex];
  if (first === undefined) return state;

  return { ...state, pendingTurnStart: { who: first.id, turn: combat.turnsTaken } };
}

/**
 * The start of the turn, once the end that preceded it has finished happening.
 *
 * Derived after every event rather than emitted, for the reason every derived
 * pass in this file exists: nobody *decides* that a moment has arrived. What
 * decides it is that the previous moment owes nothing more — no end-of-turn
 * area effect outstanding, and no scheduled hit still due at that boundary,
 * because either can end the very casting this moment would catch somebody by.
 *
 * A replay reconstructs it because the fold does: the same log leaves the same
 * debts outstanding at the same points, so the start arrives at the same event
 * it arrived at live.
 *
 * The common case passes straight through inside the fold of `turn-advanced`
 * itself — a boundary that owes nothing reaches the start at once, and no
 * caller learns there were two moments.
 */
export function reachStartOfTurn(state: GameState): GameState {
  const pending = state.pendingTurnStart;
  if (pending === null) return state;

  // A fight that has ended has no start left to arrive, and a marker nothing
  // could clear would refuse every turn for ever.
  if (state.combat === null) return { ...state, pendingTurnStart: null };

  const owing = state.owedAreaEffects.some((owed) => owed.moment === 'end-of-turn');
  if (owing) return state;

  // **A hit the boundary still owes is the other end-of-turn consequence the
  // engine holds as state**, and SRD Acid Arrow's "at the end of its next
  // turn" can drop the very caster whose area the next creature is about to
  // begin their turn in.
  //
  // Stated honestly: with today's mechanics this half has **no observable
  // case**. Every end-of-turn consequence the engine can currently produce
  // either ends the casting — and `releaseCasting` forgives its debts, so the
  // answer comes out the same whether the debt was never raised or raised and
  // dropped — or cannot change who is standing where, because nothing at a
  // boundary moves anybody. A mutation that removes this line survives, and
  // that is recorded rather than hidden.
  //
  // It stays because the *moment* is genuinely later, not because a test
  // currently fails without it: the first consequence that moves a creature or
  // moves an area is the one that would otherwise reintroduce the bug this
  // whole marker exists to fix.
  const view = { elapsed: state.elapsed, combat: state.combat };
  const dueDamage = Object.values(state.scheduledDamage).some((hit) => isDue(view, hit.deadline));
  if (dueDamage) return state;

  return {
    ...raiseAreaBoundary(state, 'start-of-turn', pending.who, pending.turn),
    pendingTurnStart: null,
  };
}

