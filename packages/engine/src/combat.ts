import {
  err,
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
  conditionSpeed,
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
  readonly movementRemaining: number;
  /** SRD: one free object interaction per turn; a second needs Utilize. */
  readonly freeInteraction: boolean;
}

export interface CombatState {
  /** 1-based. */
  readonly round: number;
  readonly order: readonly Combatant[];
  readonly turnIndex: number;
  readonly budgets: Readonly<Record<string, TurnBudget>>;
}

const fullBudget = (speed: number): TurnBudget => ({
  action: true,
  bonusAction: true,
  reaction: true,
  movementRemaining: Math.max(0, speed),
  freeInteraction: true,
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
  for (const c of order) budgets[c.id] = fullBudget(c.speed);

  return ok({ round: 1, order, turnIndex: 0, budgets });
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

/** Refresh the budget of whoever is about to act. */
function beginTurn(state: CombatState): CombatState {
  const combatant = currentCombatant(state);
  return {
    ...state,
    budgets: { ...state.budgets, [combatant.id]: fullBudget(combatant.speed) },
  };
}

/**
 * SRD: "When everyone involved in the combat has had a turn, the round ends."
 * The Initiative order itself does not change between rounds.
 */
export function advanceTurn(state: CombatState): CombatState {
  const next = state.turnIndex + 1;
  const wrapped = next >= state.order.length;

  return beginTurn({
    ...state,
    turnIndex: wrapped ? 0 : next,
    round: wrapped ? state.round + 1 : state.round,
  });
}

function requireCombatant(state: CombatState, id: CharacterId): Result<TurnBudget> {
  const budget = state.budgets[id];
  if (budget === undefined) return err('unknown_combatant', `${id} is not in this combat`);
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
 * SRD: "you can move a distance up to your Speed". Conditions are consulted
 * here rather than at `startCombat`, because a creature can be Grappled or gain
 * Exhaustion partway through a fight.
 */
export function spendMovement(
  state: CombatState,
  id: CharacterId,
  feet: number,
  conditions?: ConditionState,
): Result<CombatState> {
  if (!Number.isFinite(feet) || feet < 0) {
    return err('bad_distance', `${feet} is not a distance that can be moved`);
  }

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  const combatant = currentCombatant(state);
  const remaining = budget.value.movementRemaining;

  // A condition arriving mid-turn caps what is left, but cannot hand back
  // distance already travelled — a creature that has walked 20 feet and is then
  // Grappled has 0 left, not a fresh allowance measured against its new Speed.
  const movedSoFar = combatant.speed - remaining;
  const effectiveSpeed =
    conditions === undefined ? combatant.speed : conditionSpeed(conditions, combatant.speed);
  const allowed = Math.max(0, Math.min(remaining, effectiveSpeed - movedSoFar));

  if (feet > allowed) {
    return err('not_enough_movement', `${id} has only ${allowed} feet of movement left`);
  }

  return ok(
    withBudget(state, id, { movementRemaining: budget.value.movementRemaining - feet }, budget.value),
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
  if (index === -1) return err('unknown_combatant', `${id} is not in this combat`);
  if (state.order.length === 1) {
    return err('last_combatant', 'combat needs at least one combatant');
  }

  const order = state.order.filter((c) => c.id !== id);
  const budgets = { ...state.budgets };
  delete budgets[id];

  // Removing someone before the current combatant shifts everyone down one.
  // Removing the current combatant means the next one is now at this index.
  let turnIndex = index < state.turnIndex ? state.turnIndex - 1 : state.turnIndex;
  let round = state.round;
  if (turnIndex >= order.length) {
    turnIndex = 0;
    round += 1;
  }

  const next: CombatState = { ...state, order, turnIndex, budgets, round };

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
  if (first === undefined) return err('unknown_combatant', `${a} is not in this combat`);
  if (second === undefined) return err('unknown_combatant', `${b} is not in this combat`);

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
