/**
 * What a feature's use buys in the turn's own budget.
 *
 * The fifth door onto a pool, beside a recovery, a self-heal, a healing touch
 * and a menu of effects — and the only one that hands nothing to anybody. What
 * it buys is room in a `TurnBudget`: SRD Action Surge's additional action and
 * SRD Flurry of Blows' two Unarmed Strikes, which are one sentence apart and
 * were both `manual` because an extra action had nowhere to live.
 *
 * **Nowhere else could it live.** `fold/combat.ts` folds `action-spent`
 * through `must(event, spendAction(...))` and throws on a refusal, so an extra
 * action held on the creature — an `actionRules` entry, a hung grant, a
 * standing effect — is an event the command legally emitted and the reducer
 * calls corrupt. Only a combat event writes a budget.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import type { BudgetPurchase } from '../character.js';
import { canUseFeatureThisTurn, grantTurnBudget } from '../combat.js';
import type { GameEvent, GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { remaining } from '../resources.js';
import { creatureOf, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';

export interface UseBudgetPurchaseCommand extends CommandIdentity {
  /** The feature that sells it, by id — `monk:focus`. */
  readonly feature: string;
  /** The purchase, by id — `flurry-of-blows`. */
  readonly purchase: string;
}

/** The ledger key a once-per-turn purchase is counted under. */
export const budgetPurchaseSlot = (purchase: BudgetPurchase): string =>
  `${purchase.feature}/${purchase.purchase}`;

/**
 * Spend a use of a pool to add to what this turn may be spent on.
 *
 * **Everything that could refuse does so before anything is spent**, which is
 * the discipline every other pool spender keeps: the creature, the feature,
 * the purchase, the fight, the once-a-turn clause, the action and the pool are
 * all settled before the first event is written, so a refused Flurry costs its
 * Monk neither the Bonus Action nor the point.
 *
 * **It refuses outside combat**, and that is the one place this differs from
 * its neighbours. A self-heal outside a fight heals and simply spends no
 * action, because what it buys exists either way; an additional action does
 * not exist outside a turn order at all, so buying one there would spend a use
 * of Action Surge on nothing and say it worked.
 */
export function useBudgetPurchase(
  state: GameState,
  id: CharacterId,
  command: UseBudgetPurchaseCommand,
): Result<GameEvent[]> {
  return once(state, `budget-purchase:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const offered = (creature.sheet.budgetPurchases ?? []).filter(
      (one) => one.feature === command.feature,
    );
    if (offered.length === 0) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }
    const purchase = offered.find((one) => one.purchase === command.purchase);
    if (purchase === undefined) {
      return err(
        'no_such_purchase',
        `${command.feature} buys ${offered.map((one) => one.purchase).join(', ')}, not ${command.purchase}`,
      );
    }

    const combat = state.combat;
    if (combat === null) {
      return err(
        'not_in_combat',
        `${purchase.name} adds to a turn, and there are no turns outside combat`,
      );
    }

    // SRD Action Surge: "you can use it twice before a rest but only once on a
    // turn." The ledger is Sneak Attack's, keyed by the turn rather than by a
    // flag, and the key is the purchase's own because one feature may sell
    // several.
    const slot = budgetPurchaseSlot(purchase);
    if (purchase.oncePerTurn === true && !canUseFeatureThisTurn(combat, id, slot)) {
      return err('already_used', `${id} has already used ${purchase.name} this turn`);
    }

    if (remaining(creature.resources, purchase.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${purchase.featureName} left`);
    }

    // What the purchase adds, worked out before anything is spent, because it
    // is also what the reducer will apply.
    const grant = {
      ...(purchase.extraAction === undefined
        ? {}
        : {
            action: {
              source: purchase.name,
              ...(purchase.extraAction.except === undefined
                ? {}
                : { except: purchase.extraAction.except }),
            },
          }),
      ...(purchase.extraAttacks === undefined
        ? {}
        : {
            attacks: {
              remaining: purchase.extraAttacks.count,
              unarmedOnly: purchase.extraAttacks.unarmedOnly,
            },
          }),
    };

    // **The command's own check with the command's own inputs**, which is the
    // rule this whole layer keeps: a command refuses exactly what the reducer
    // would call corrupt. `mayAct` does not ask whose turn it is and a
    // purchase costing no action never reaches `spendFor`, so without this a
    // Fighter could surge on the goblin's turn, be told `ok`, and have the
    // fold throw `CorruptLogError` on the events they were handed.
    const granted = grantTurnBudget(combat, id, grant);
    if (!granted.ok) return granted;

    // — from here it costs something ——————————————————————————————————————
    const events: GameEvent[] = [];

    if (purchase.action !== 'none') {
      const spent = spendFor(state, id, purchase.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    events.push({ type: 'resource-spent', id, key: purchase.pool, amount: 1 });

    if (purchase.oncePerTurn === true) {
      events.push({ type: 'feature-used', id, feature: slot, turn: combat.turnsTaken });
    }

    events.push({
      type: 'turn-budget-granted',
      id,
      source: purchase.name,
      ...(purchase.extraAction === undefined ? {} : { action: purchase.extraAction }),
      ...(grant.attacks === undefined ? {} : { attacks: grant.attacks }),
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok(events);
  });
}
