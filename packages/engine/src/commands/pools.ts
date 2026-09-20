/**
 * Named pools: declaring one, and refilling it on a rest.
 *
 * Spell slots, Channel Divinity, Ki, a wand's charges and Hit Dice are the
 * same mechanism, and `resources.ts` beneath this holds the arithmetic. Pools
 * are declared, never derived, because the engine does not model class tables.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { canUseFeatureThisTurn } from '../combat.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  hasPool,
  remaining,
  spellSlotKey,
  type PoolDeclaration,
  type Recovery,
} from '../resources.js';
import { creatureOf, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';

/**
 * Declare a limited-use pool on a creature.
 *
 * Pools are declared, never derived: the engine does not own the class tables
 * that say how many slots a level 5 Wizard has. See `resources.ts`.
 */
export function declareResourcePool(
  state: GameState,
  id: CharacterId,
  pool: PoolDeclaration,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);
  // A pool is found by its key, so a blank one is a pool nothing can ever
  // spend from or refill. `declarePool` has always refused it — and this
  // command asked only whether the creature already *had* the key, which an
  // empty string never is, so the event went out and the fold threw a corrupt
  // log. That throw is the backstop for a log claiming something happened, not
  // the answer to a caller's bad argument: rules-legal refusals are values.
  if (pool.key.trim() === '') return err('bad_key', 'a pool needs a key');
  if (hasPool(creature.resources, pool.key)) {
    return err('duplicate_pool', `${id} already has a ${pool.key} pool`);
  }
  if (!Number.isInteger(pool.max) || pool.max < 0) {
    return err('bad_max', `a pool's maximum must be a non-negative integer, got ${pool.max}`);
  }
  return ok([{ type: 'resource-pool-declared', id, pool }]);
}

export interface TradeResourceCommand extends CommandIdentity {
  /** The feature that offers the trade. */
  readonly feature: string;
  /** Which of its trades — SRD Wild Resurgence prints two. */
  readonly trade: string;
  /**
   * The level of the slot to spend, where the trade lets the caller choose.
   *
   * SRD: "you can give yourself one use by expending **a spell slot**" — which
   * one is the caster's decision and never the engine's, so a trade that
   * spends an unnamed slot is refused rather than guessed at. The engine picks
   * between candidates nowhere else either.
   */
  readonly slotLevel?: number;
}

/**
 * Spend one resource to buy another — see the `trade` grant in
 * `progression.ts`.
 *
 * SRD Wild Resurgence writes both directions and this command runs either:
 * "Once on each of your turns, if you have no uses of Wild Shape left, you can
 * give yourself one use by expending a spell slot (no action required). In
 * addition, you can expend one use of Wild Shape (no action required) to give
 * yourself a level 1 spell slot, but you can't do so again until you finish a
 * Long Rest."
 *
 * Three refusals are the whole of the rule and each is a value rather than an
 * exception:
 *
 * - **Nothing to give back.** `restore` never takes a pool above its maximum,
 *   so a caster holding every slot they have would pay a use for nothing. The
 *   refusal is `useRecovery`'s, in its own words — a once-a-day feature spent
 *   for no gain is the quiet loss a player finds two rooms later — and it is
 *   also the honest answer to a sentence that would otherwise mint a slot no
 *   class table printed.
 * - **The clause the trade prints.** `onlyIfEmpty` is "if you have no uses of
 *   Wild Shape left", checked against the pool the trade would fill.
 * - **The limit.** Once a turn is the combat ledger's `feature-used`, keyed to
 *   this trade rather than to the feature, because one feature offers two and
 *   the SRD limits them differently. Once a Long Rest is a pool of one, which
 *   is what `recovery` already makes of the same sentence. And a trade the
 *   book limits not at all — Font of Inspiration, Sorcery Incarnate, Holy
 *   Nimbus — says so, and neither of the two checks below fires: what bounds
 *   it is what it spends and the refusal above.
 *
 * Everything is checked before anything is spent, so a refused trade costs
 * neither end of itself.
 */
export function tradeResource(
  state: GameState,
  id: CharacterId,
  command: TradeResourceCommand,
): Result<GameEvent[]> {
  return once(state, `trade:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const trade = (creature.sheet.trades ?? []).find(
      (one) => one.feature === command.feature && one.trade === command.trade,
    );
    if (trade === undefined) {
      return err(
        'no_such_feature',
        `${id} has no trade called ${command.trade} on ${command.feature}`,
      );
    }

    // "Once on each of your turns", which has no referent outside combat —
    // the reading `canUseFeatureThisTurn` already takes for every other
    // once-per-turn feature.
    const ledgerKey = `${trade.feature}:${trade.trade}`;
    if (
      trade.limit === 'once-per-turn' &&
      state.combat !== null &&
      !canUseFeatureThisTurn(state.combat, id, ledgerKey)
    ) {
      return err('already_used_this_turn', `${id} has already used ${trade.name} this turn`);
    }

    // "You can't do so again until you finish a Long Rest": a pool of one.
    //
    // **Read off the limit and never off the presence of the pool**, because a
    // trade declares a pool of one for two different sentences: the daily
    // limit here, and the feature's own single use that an unlimited trade
    // exists to buy back. Asking `pool !== undefined` would refuse Holy Nimbus
    // at exactly the moment it is meant to fire — its use spent — and then
    // spend the use it had just restored.
    if (
      trade.limit === 'once-per-long-rest' &&
      trade.pool !== undefined &&
      remaining(creature.resources, trade.pool) < 1
    ) {
      return err('exhausted', `${id} has no uses of ${trade.name} left`);
    }

    // "If you have no uses of Wild Shape left."
    if (trade.onlyIfEmpty !== undefined && remaining(creature.resources, trade.onlyIfEmpty) > 0) {
      const pool = creature.resources.pools[trade.onlyIfEmpty];
      return err(
        'not_yet',
        `${trade.name} is for a ${pool?.label ?? trade.onlyIfEmpty} that is spent, and ${id} has ${remaining(creature.resources, trade.onlyIfEmpty)} left`,
      );
    }

    // The slot the caller named, where the trade leaves the level to them.
    const spending = trade.spends.key ?? slotNamed(command.slotLevel);
    if (spending === null) {
      return err(
        'slot_level_required',
        `${trade.name} expends a spell slot and nothing says which level; the caster chooses`,
      );
    }

    if (remaining(creature.resources, spending) < trade.spends.uses) {
      const pool = creature.resources.pools[spending];
      return err(
        'exhausted',
        `${id} has ${remaining(creature.resources, spending)} ${pool?.label ?? spending} left, and ${trade.name} costs ${trade.spends.uses}`,
      );
    }

    // What is actually bought. A pool at its maximum has nothing to give back,
    // and a trade that paid for nothing is a refusal rather than a silence.
    const gained = creature.resources.pools[trade.gains.key];
    if (gained === undefined) {
      return err('unknown_pool', `${id} has no ${trade.gains.key} for ${trade.name} to fill`);
    }
    if (gained.spent < 1) {
      return err(
        'nothing_to_regain',
        `${id} has spent no ${gained.label}, and a trade gives back what was spent rather than minting more`,
      );
    }

    const events: GameEvent[] = [];

    // The action economy only exists in combat, exactly as `useSelfHeal`
    // finds. SRD writes "(no action required)" on both of Wild Resurgence's
    // trades, which is what `none` says.
    if (trade.action !== 'none' && state.combat !== null) {
      const spent = spendFor(state, id, trade.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    events.push({ type: 'resource-spent', id, key: spending, amount: trade.spends.uses });

    // The daily limit, spent — and only where the limit is what the pool is.
    if (trade.limit === 'once-per-long-rest' && trade.pool !== undefined) {
      events.push({ type: 'resource-spent', id, key: trade.pool, amount: 1 });
    }

    if (trade.limit === 'once-per-turn' && state.combat !== null) {
      events.push({
        type: 'feature-used',
        id,
        feature: ledgerKey,
        turn: state.combat.turnsTaken,
      });
    }

    events.push({
      type: 'resource-regained',
      id,
      key: trade.gains.key,
      // Never more than was spent, because `restore` caps at the maximum and a
      // trade that asked for more would be paid for in full and refunded in
      // part.
      amount: Math.min(trade.gains.uses, gained.spent),
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok(events);
  });
}

/** The key of the slot level a caller named, or null where they named none. */
const slotNamed = (level: number | undefined): string | null =>
  level === undefined || !Number.isInteger(level) || level < 1 || level > 9
    ? null
    : spellSlotKey(level);

/** SRD: "Finishing a Long Rest restores any expended spell slots." */
export function restoreResourcesOn(
  state: GameState,
  id: CharacterId,
  recovers: Recovery,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // **This is not idempotent by construction**, which is what the idempotency
  // sweep used to excuse it as. A whole refill applied twice is a whole refill
  // — but SRD's partial rule is not: "You regain **one** expended use when you
  // finish a Short Rest" is `regainsOnShortRest`, and `restoreOn` subtracts it
  // from `spent`, so a retried restoration hands back two uses of Rage, Second
  // Wind, Channel Divinity, Wild Shape or Bardic Inspiration.
  return once(state, `restore:${id}`, { ...command, recovers }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) {
      return unknownCreature(id);
    }
    return ok([
      { type: 'resources-restored', id, recovers, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

