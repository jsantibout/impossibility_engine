import {
  err,
  needsContext,
  ok,
  type CharacterId,
  type Result,
  type RollMode,
} from '@ie/shared';
import type { Rng } from './dice.js';
import type { Bonus, ModeSource } from './bonuses.js';
import { initiativeModifier, type CharacterSheet } from './character.js';
import { rollD20Test, type D20Roll } from './checks.js';
import {
  exhaustionBonus,
  initiativeConditionModes,
  isIncapacitated,
  type ConditionState,
} from './conditions.js';
import type { RollIssuer } from './rolls.js';

/**
 * Initiative and the turn economy.
 *
 * Positional questions — who is within 5 feet of whom, what is in reach — are
 * not answered here; they belong to `zones.ts`. This module owns the order of
 * turns and what each combatant may still spend on theirs.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export interface InitiativeOptions {
  readonly modes?: readonly (RollMode | ModeSource)[];
  /**
   * Named modifiers. Initiative is an ability check, so the Alert feat's
   * Proficiency Bonus and a magic item's bonus both apply here.
   *
   * Jack of All Trades does *not*: it needs "an ability check ... that uses a
   * skill proficiency you lack", and Initiative uses no skill at all.
   */
  readonly bonuses?: readonly Bonus[];
  readonly conditions?: ConditionState;
  /** SRD: a combatant surprised by combat starting rolls with Disadvantage. */
  readonly surprised?: boolean;
}

export interface InitiativeRoll extends D20Roll {
  readonly id: CharacterId;
}

/**
 * SRD: "they make a Dexterity check that determines their place in the
 * Initiative order."
 *
 * A bare Dexterity check — no proficiency by default. Surprise is Disadvantage
 * on this roll rather than a condition, which is a 2024 change.
 */
export function rollInitiative(
  issuer: RollIssuer,
  rng: Rng,
  id: CharacterId,
  sheet: CharacterSheet,
  options: InitiativeOptions,
): Result<InitiativeRoll> {
  const conditions = options.conditions;

  const modeSources: ModeSource[] = [
    ...(conditions === undefined ? [] : initiativeConditionModes(conditions)),
    ...(options.surprised === true
      ? [{ source: 'surprised', mode: 'disadvantage' as const }]
      : []),
    ...(options.modes ?? []).map((m) =>
      typeof m === 'string' ? { source: 'situational', mode: m } : m,
    ),
  ];

  const exhaustion = conditions === undefined ? null : exhaustionBonus(conditions);
  const bonuses = [...(options.bonuses ?? []), ...(exhaustion === null ? [] : [exhaustion])];

  const rolled = rollD20Test(issuer, rng, initiativeModifier(sheet), modeSources, bonuses);
  if (!rolled.ok) return rolled;

  return ok({ ...rolled.value, id });
}

/**
 * SRD: "Your Initiative score equals 10 plus your Dexterity modifier. If you
 * have Advantage on Initiative rolls, increase your Initiative score by 5. If
 * you have Disadvantage on those rolls, decrease that score by 5."
 *
 * For when the GM skips rolling.
 */
export function passiveInitiative(sheet: CharacterSheet, mode: RollMode = 'normal'): number {
  const shift = mode === 'advantage' ? 5 : mode === 'disadvantage' ? -5 : 0;
  return 10 + initiativeModifier(sheet) + shift;
}

export interface Combatant {
  readonly id: CharacterId;
  /** The Initiative check total. */
  readonly initiative: number;
  /** Walking speed in feet, before conditions. */
  readonly speed: number;
  /**
   * Breaks ties, highest first. SRD leaves ties to the GM, so the engine takes
   * that decision as an input rather than inventing one.
   */
  readonly tiebreak: number;
}

export interface CombatantInput {
  readonly id: CharacterId;
  readonly initiative: number;
  readonly speed: number;
  readonly tiebreak?: number;
}

export interface TurnBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  /**
   * Feet of movement already spent this turn.
   *
   * **Store what happened, derive what is left.** This was
   * `movementRemaining` — a *derived* quantity frozen at the moment it was
   * seeded — and that is sound only while every later change to the allowance
   * moves in the direction a cap can express: downwards. A feature grant
   * raises it, and nothing but the seed can raise a remainder, so a Monk whose
   * Speed is 40 was refused at 30 by whichever reader still held the seed.
   *
   * A working live cap is not evidence that a live allowance exists. The test
   * is whether the stored number can represent an allowance **larger than its
   * seed**, and a remainder cannot.
   */
  readonly movementSpent: number;
  /**
   * Feet of extra movement banked this turn, which today is only a Dash.
   *
   * SRD Dash: "you gain extra movement for the current turn. The increase
   * equals your Speed after applying any modifiers." It is banked rather than
   * folded into the allowance because it was earned at a moment: the Speed it
   * was measured against was the Speed *then*.
   *
   * **A Dash's gained movement survives a later Speed of 0 this turn**, and
   * that is an open reading rather than a decision. SRD Grappled says "Your
   * Speed is 0 and can't increase", which is about the Speed and says nothing
   * about extra movement already banked. Today's arithmetic allowed it before
   * this field existed and this formula preserves the reading exactly; the
   * engine has not decided it, and this sentence is where that is written
   * down rather than discovered.
   */
  readonly movementGained: number;
  /**
   * Attacks left in the Attack action, or null if it has not been taken.
   *
   * SRD Extra Attack: "You can attack twice instead of once whenever you take
   * the Attack action." The action is taken once and holds however many
   * attacks a feature puts in it, so counting actions alone gave a level 5
   * Fighter one swing a turn.
   *
   * Null rather than zero, because "has not attacked yet" and "has used up the
   * attacks" are different states and only the first may take the action.
   */
  readonly attacksRemaining: number | null;
  /**
   * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
   * rest of the current turn." The turn is the whole of its life, which is why
   * it lives in the budget and not on the creature.
   */
  readonly disengaged: boolean;
  /** SRD: one free object interaction per turn; a second needs Utilize. */
  readonly freeInteraction: boolean;
  /**
   * Which turn this creature last expended a spell slot on, or null.
   *
   * SRD: "On a turn, you can expend only one spell slot to cast a spell." Note
   * *a* turn, not *your* turn — a Reaction spell cast on someone else's turn
   * is a different turn from the one you cast Fireball on. So this records the
   * turn rather than a flag that the budget refresh would clear at the wrong
   * moment.
   */
  readonly spellSlotSpentOnTurn: number | null;
  /**
   * Which turn each once-per-turn feature was last used on.
   *
   * SRD writes "Once per turn" and "Once on each of your turns" on Sneak
   * Attack, Colossus Slayer, Divine Strike and Primal Strike, and it is
   * **not** once per round. The distinction is only visible on somebody
   * else's turn: a Rogue who Sneak Attacked on their own turn may Sneak
   * Attack again on the Opportunity Attack they take during the Fighter's,
   * because that is a different turn.
   *
   * So this records the turn rather than a flag, for exactly the reason
   * `spellSlotSpentOnTurn` above it does — a flag would be cleared by the
   * budget refresh at the start of the holder's *own* turn, which is the one
   * moment that does not matter, and would go on blocking every Reaction in
   * between.
   */
  readonly featureUsedOnTurn: Readonly<Record<string, number>>;
}

/**
 * How many turns a combatant has begun and ended.
 *
 * Both, because "until the start of your next turn" and "until the end of your
 * next turn" are a full round apart and nothing derives one from the other.
 * Counted per combatant rather than globally: "your next turn" is a question
 * about one creature's place in the order, not about the round.
 */
export interface TurnCount {
  readonly begun: number;
  readonly ended: number;
}

export interface CombatState {
  /** 1-based. */
  readonly round: number;
  readonly order: readonly Combatant[];
  readonly turnIndex: number;
  readonly budgets: Readonly<Record<string, TurnBudget>>;
  /**
   * Turns taken since the fight began, counting up and never reused.
   *
   * Derived from round and turn index it would not be: combatants leave, the
   * order shrinks, and two different turns could then share a number. A rule
   * that asks "was that on this turn?" needs an answer that cannot collide.
   */
  readonly turnsTaken: number;
  /** Turns begun and ended, per combatant, for turn-anchored durations. */
  readonly turnCounts: Readonly<Record<string, TurnCount>>;
}

/**
 * A fresh turn, which **takes no Speed**.
 *
 * It used to seed `movementRemaining` from the pinned Speed, and that seed was
 * the ceiling no grant could pass. Nothing is seeded now: the allowance is
 * `speedOf + gained − spent`, derived by the command and by the fold alike.
 */
const fullBudget = (): TurnBudget => ({
  action: true,
  bonusAction: true,
  reaction: true,
  movementSpent: 0,
  movementGained: 0,
  attacksRemaining: null,
  disengaged: false,
  freeInteraction: true,
  spellSlotSpentOnTurn: null,
  featureUsedOnTurn: {},
});

/**
 * SRD: "The GM ranks the combatants, from highest to lowest Initiative." Ties
 * fall to the supplied tiebreak, then to insertion order so the result is
 * stable and replayable.
 */
export function startCombat(combatants: readonly CombatantInput[]): Result<CombatState> {
  if (combatants.length === 0) {
    return err('empty_combat', 'combat needs at least one combatant');
  }

  const seen = new Set<string>();
  for (const c of combatants) {
    if (seen.has(c.id)) return err('duplicate_combatant', `${c.id} is in the combat twice`);
    seen.add(c.id);
  }

  const order = combatants
    .map((c, index) => ({
      id: c.id,
      initiative: c.initiative,
      speed: c.speed,
      tiebreak: c.tiebreak ?? 0,
      index,
    }))
    .sort(
      (a, b) => b.initiative - a.initiative || b.tiebreak - a.tiebreak || a.index - b.index,
    )
    .map(({ id, initiative, speed, tiebreak }) => ({ id, initiative, speed, tiebreak }));

  const budgets: Record<string, TurnBudget> = {};
  const turnCounts: Record<string, TurnCount> = {};
  for (const c of order) {
    budgets[c.id] = fullBudget();
    turnCounts[c.id] = { begun: 0, ended: 0 };
  }
  // The first combatant's turn starts with the fight.
  const first = order[0];
  if (first !== undefined) turnCounts[first.id] = { begun: 1, ended: 0 };

  return ok({ round: 1, order, turnIndex: 0, budgets, turnsTaken: 0, turnCounts });
}

export function currentCombatant(state: CombatState): Combatant {
  const combatant = state.order[state.turnIndex];
  if (combatant === undefined) {
    throw new Error(`combat has no combatant at turn index ${state.turnIndex}`);
  }
  return combatant;
}

export function budgetFor(state: CombatState, id: CharacterId): TurnBudget | null {
  return state.budgets[id] ?? null;
}

const bumped = (
  counts: Readonly<Record<string, TurnCount>>,
  id: CharacterId,
  field: 'begun' | 'ended',
): Record<string, TurnCount> => {
  const current = counts[id] ?? { begun: 0, ended: 0 };
  return { ...counts, [id]: { ...current, [field]: current[field] + 1 } };
};

/** Refresh the budget of whoever is about to act, and count their turn begun. */
function beginTurn(state: CombatState): CombatState {
  const combatant = currentCombatant(state);
  return {
    ...state,
    budgets: { ...state.budgets, [combatant.id]: fullBudget() },
    turnCounts: bumped(state.turnCounts, combatant.id, 'begun'),
  };
}

/**
 * SRD: "When everyone involved in the combat has had a turn, the round ends."
 * The Initiative order itself does not change between rounds.
 */
export function advanceTurn(state: CombatState): CombatState {
  const next = state.turnIndex + 1;
  const wrapped = next >= state.order.length;

  // Whoever was acting has finished. Counted before the move, because "the end
  // of your next turn" is a moment in its own right, a full round after "the
  // start of your next turn".
  const ended = bumped(state.turnCounts, currentCombatant(state).id, 'ended');

  return beginTurn({
    ...state,
    turnCounts: ended,
    turnIndex: wrapped ? 0 : next,
    round: wrapped ? state.round + 1 : state.round,
    turnsTaken: state.turnsTaken + 1,
  });
}

function requireCombatant(state: CombatState, id: CharacterId): Result<TurnBudget> {
  const budget = state.budgets[id];
  if (budget === undefined) return needsContext('unknown_combatant', `${id} is not in this combat`);
  return ok(budget);
}

function requireTheirTurn(state: CombatState, id: CharacterId): Result<TurnBudget> {
  const budget = requireCombatant(state, id);
  if (!budget.ok) return budget;
  if (currentCombatant(state).id !== id) {
    return err('not_their_turn', `it is not ${id}'s turn`);
  }
  return budget;
}

/** SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction." */
function requireCapable(id: CharacterId, conditions: ConditionState | undefined): Result<true> {
  if (conditions !== undefined && isIncapacitated(conditions)) {
    return err('incapacitated', `${id} is Incapacitated and can't act`);
  }
  return ok(true);
}

const withBudget = (
  state: CombatState,
  id: CharacterId,
  patch: Partial<TurnBudget>,
  budget: TurnBudget,
): CombatState => ({
  ...state,
  budgets: { ...state.budgets, [id]: { ...budget, ...patch } },
});

export function spendAction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;
  if (!budget.value.action) return err('no_action', `${id} has already taken an action`);

  return ok(withBudget(state, id, { action: false }, budget.value));
}

/** SRD: "You can't take more than one Bonus Action on a turn." */
export function spendBonusAction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;
  if (!budget.value.bonusAction) {
    return err('no_bonus_action', `${id} has already taken a Bonus Action`);
  }

  return ok(withBudget(state, id, { bonusAction: false }, budget.value));
}

/**
 * SRD: "You can take a Reaction on another creature's turn... Once you take a
 * Reaction, you can't take another one until the start of your next turn."
 *
 * So this is deliberately not restricted to the current combatant — an
 * Opportunity Attack is a Reaction taken on someone else's turn — and the
 * refresh happens in {@link beginTurn}, not at the end of a round.
 */
export function spendReaction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const budget = requireCombatant(state, id);
  if (!budget.ok) return budget;
  if (!budget.value.reaction) {
    return err('no_reaction', `${id} has no Reaction until the start of their next turn`);
  }

  return ok(withBudget(state, id, { reaction: false }, budget.value));
}

/**
 * Take the Attack action, or take another swing inside the one already taken.
 *
 * SRD: "When you take the Attack action, you can make one attack roll with a
 * weapon or an Unarmed Strike", and Extra Attack puts more in the same action.
 * So the first swing spends the action and fills the quiver; every swing after
 * it empties the quiver and spends nothing.
 */
export function spendAttack(
  state: CombatState,
  id: CharacterId,
  attacksPerAction: number,
  conditions?: ConditionState,
): Result<{ readonly state: CombatState; readonly tookAction: boolean }> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  // Still inside an Attack action already taken.
  if (budget.value.attacksRemaining !== null) {
    if (budget.value.attacksRemaining < 1) {
      return err('no_attacks_left', `${id} has used every attack of their Attack action`);
    }
    return ok({
      state: withBudget(
        state,
        id,
        { attacksRemaining: budget.value.attacksRemaining - 1 },
        budget.value,
      ),
      tookAction: false,
    });
  }

  const taken = spendAction(state, id, conditions);
  if (!taken.ok) return taken;

  const after = requireTheirTurn(taken.value, id);
  if (!after.ok) return after;

  return ok({
    state: withBudget(
      taken.value,
      id,
      { attacksRemaining: Math.max(0, attacksPerAction - 1) },
      after.value,
    ),
    tookAction: true,
  });
}

/**
 * What is left of this turn's movement, derived rather than stored.
 *
 * `allowance` is the creature's Speed **now** — `speedOf`'s answer, with
 * conditions, Exhaustion and every feature grant folded in — and the budget
 * holds only what happened: feet spent, and feet a Dash banked.
 *
 * **Store what happened, derive what is left.** The budget used to hold the
 * remainder, seeded from the pinned Speed, and a remainder is a derived
 * quantity frozen at its seed: sound only while every later change to the
 * allowance moves downwards, which is the one direction a cap can express. A
 * feature grant raises it, and nothing but the seed can raise a remainder — so
 * a Monk whose Speed is 40 was capped at 30 by whichever reader still held the
 * seed, and the command and the fold could disagree about which.
 *
 * A pure function over a budget and a number, so every caller asks it the same
 * way: `movementLeftFor` in `standing.ts` is the `GameState` half that looks
 * the allowance up first.
 */
export function movementLeft(budget: TurnBudget, allowance: number): number {
  return Math.max(0, allowance + budget.movementGained - budget.movementSpent);
}

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed **after applying any modifiers**."
 *
 * After modifiers is the load-bearing half, and the SRD spells it out: "If
 * your Speed of 30 feet is reduced to 15 feet, you can move up to 30 feet this
 * turn if you Dash." So the caller passes `speedOf`'s answer rather than a
 * printed number, and a Monk's Unarmored Movement reaches the Dash exactly as
 * it reaches the allowance and the mounting cost.
 *
 * **The increase is required, not optional.** An optional parameter defaulting
 * to `combatant.speed` is how the command and the fold came to measure one
 * question against two numbers — the fork this whole change exists to close —
 * so there is nowhere for a second answer to hide.
 *
 * **It is banked rather than added to an allowance**, because it was earned at
 * a moment: the Speed it was measured against was the Speed *then*. See
 * `TurnBudget.movementGained` for the open reading that follows from it.
 */
export function dash(
  state: CombatState,
  id: CharacterId,
  increase: number,
): Result<CombatState> {
  const combatant = state.order.find((c) => c.id === id);
  if (combatant === undefined) return err('not_a_combatant', `${id} is not in this fight`);

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  return ok(
    withBudget(
      state,
      id,
      { movementGained: budget.value.movementGained + Math.max(0, increase) },
      budget.value,
    ),
  );
}

/**
 * SRD Disengage: no Opportunity Attacks from your movement, for this turn.
 *
 * The action each of these costs is spent by its own `action-spent` event, so
 * neither of them spends it here: one event, one thing, and a reducer that
 * cannot double-charge by replaying a pair.
 */
export function disengage(
  state: CombatState,
  id: CharacterId,
): Result<CombatState> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  return ok(withBudget(state, id, { disengaged: true }, budget.value));
}

/**
 * SRD: "you can move a distance up to your Speed".
 *
 * **`allowance` is required, and that is the whole correction.** It is
 * `speedOf`'s answer — conditions, Exhaustion and every feature grant folded
 * together — supplied by the caller because this module sits below
 * `standing.ts`: `speedOf` needs a whole `GameState` and a combat state is not
 * one.
 *
 * It is not optional and must not become optional. The **reducer** calls this
 * function too, as its corrupt-log backstop, and a backstop is honest only
 * when it is the command's own check with the command's own inputs. An
 * optional parameter defaulting to `combatant.speed` is exactly how the two
 * came to measure one question against two numbers: the command validated a
 * Monk's 35-foot move against 40 and the fold refused the very event the
 * command had emitted, against 30. That is the Dodge-versus-Fire-Bolt fork,
 * and it is why a green suite folded a corrupt log.
 *
 * The cap is `movementLeft`, which is `allowance + gained − spent`. There is
 * no `min` against a stored remainder and no `movedSoFar`: both were the
 * arithmetic of a seeded remainder, and the remainder is gone. A condition
 * arriving mid-turn still cannot hand back distance already travelled — a
 * creature that has walked 20 of 30 feet and is then Grappled has
 * `max(0, 0 + 0 − 20)`, which is 0 — and the rule now falls out of the
 * subtraction rather than being arranged for.
 */
export function spendMovement(
  state: CombatState,
  id: CharacterId,
  feet: number,
  allowance: number,
): Result<CombatState> {
  if (!Number.isFinite(feet) || feet < 0) {
    return err('bad_distance', `${feet} is not a distance that can be moved`);
  }

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  const allowed = movementLeft(budget.value, allowance);
  if (feet > allowed) {
    return err('not_enough_movement', `${id} has only ${allowed} feet of movement left`);
  }

  return ok(
    withBudget(state, id, { movementSpent: budget.value.movementSpent + feet }, budget.value),
  );
}

/** SRD: one free object interaction per turn; a second requires Utilize. */
export function useFreeInteraction(state: CombatState, id: CharacterId): Result<CombatState> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;
  if (!budget.value.freeInteraction) {
    return err('no_free_interaction', `${id} has already interacted with an object this turn`);
  }

  return ok(withBudget(state, id, { freeInteraction: false }, budget.value));
}

/**
 * Take a combatant out of the fight.
 *
 * The turn index has to move with them: removing someone earlier in the order
 * would otherwise silently skip whoever's turn it actually is.
 */
export function removeCombatant(state: CombatState, id: CharacterId): Result<CombatState> {
  const index = state.order.findIndex((c) => c.id === id);
  if (index === -1) return needsContext('unknown_combatant', `${id} is not in this combat`);
  if (state.order.length === 1) {
    return err('last_combatant', 'combat needs at least one combatant');
  }

  const order = state.order.filter((c) => c.id !== id);
  const budgets = { ...state.budgets };
  delete budgets[id];
  // The counts go too. A duration anchored to "your next turn" has no such
  // moment left once you have left the fight, and a deadline that can never
  // arrive would strand the effect forever.
  const turnCounts = { ...state.turnCounts };
  delete turnCounts[id];

  // Removing someone before the current combatant shifts everyone down one.
  // Removing the current combatant means the next one is now at this index.
  let turnIndex = index < state.turnIndex ? state.turnIndex - 1 : state.turnIndex;
  let round = state.round;
  if (turnIndex >= order.length) {
    turnIndex = 0;
    round += 1;
  }

  const next: CombatState = { ...state, order, turnIndex, budgets, round, turnCounts };

  // If the removed combatant was the one acting, the next one is now up and
  // its turn is beginning.
  return ok(index === state.turnIndex ? beginTurn(next) : next);
}

/**
 * SRD Alert: "Immediately after you roll Initiative, you can swap your
 * Initiative with the Initiative of one willing ally in the same combat. You
 * can't make this swap if you or the ally has the Incapacitated condition."
 */
export function swapInitiative(
  state: CombatState,
  a: CharacterId,
  b: CharacterId,
  conditionsA?: ConditionState,
  conditionsB?: ConditionState,
): Result<CombatState> {
  if (a === b) return err('same_combatant', 'a combatant cannot swap Initiative with themselves');

  const first = state.order.find((c) => c.id === a);
  const second = state.order.find((c) => c.id === b);
  if (first === undefined) return needsContext('unknown_combatant', `${a} is not in this combat`);
  if (second === undefined) return needsContext('unknown_combatant', `${b} is not in this combat`);

  for (const [id, conditions] of [
    [a, conditionsA],
    [b, conditionsB],
  ] as const) {
    if (conditions !== undefined && isIncapacitated(conditions)) {
      return err('incapacitated', `${id} is Incapacitated and can't swap Initiative`);
    }
  }

  const swapped = state.order.map((c) =>
    c.id === a
      ? { ...c, initiative: second.initiative, tiebreak: second.tiebreak }
      : c.id === b
        ? { ...c, initiative: first.initiative, tiebreak: first.tiebreak }
        : c,
  );

  const rebuilt = startCombat(swapped);
  if (!rebuilt.ok) return rebuilt;

  // Re-sorting rebuilds the order but must not reset the fight in progress.
  return ok({
    ...state,
    order: rebuilt.value.order,
    turnIndex: Math.min(state.turnIndex, rebuilt.value.order.length - 1),
  });
}

/**
 * SRD: "On a turn, you can expend only one spell slot to cast a spell."
 *
 * Whether a slot is available this turn, and recording that one went. Both
 * no-op for a creature outside the initiative order: with no turns there is
 * nothing for the restriction to attach to.
 */
export function canSpendSpellSlotThisTurn(state: CombatState, id: CharacterId): boolean {
  const budget = state.budgets[id];
  if (budget === undefined) return true;
  return budget.spellSlotSpentOnTurn !== state.turnsTaken;
}

/**
 * Whether a once-per-turn feature is still available to this creature.
 *
 * Outside combat there are no turns, so nothing restricts it — the same
 * reading the one-slot-per-turn rule takes, and for the same reason: "once per
 * turn" has no referent where nobody is taking turns.
 */
export function canUseFeatureThisTurn(
  state: CombatState,
  id: CharacterId,
  feature: string,
): boolean {
  const budget = state.budgets[id];
  if (budget === undefined) return true;
  return budget.featureUsedOnTurn[feature] !== state.turnsTaken;
}

export function markFeatureUsed(
  state: CombatState,
  id: CharacterId,
  feature: string,
  turn: number,
): CombatState {
  const budget = state.budgets[id];
  if (budget === undefined) return state;
  // Sorted, because this reaches `GameState` and a fold has to compare byte
  // for byte however the keys arrived.
  const used: Record<string, number> = {};
  for (const key of [...Object.keys(budget.featureUsedOnTurn), feature].sort()) {
    used[key] = key === feature ? turn : (budget.featureUsedOnTurn[key] ?? 0);
  }
  return withBudget(state, id, { featureUsedOnTurn: used }, budget);
}

export function markSpellSlotSpent(state: CombatState, id: CharacterId): CombatState {
  const budget = state.budgets[id];
  if (budget === undefined) return state;
  return withBudget(state, id, { spellSlotSpentOnTurn: state.turnsTaken }, budget);
}
