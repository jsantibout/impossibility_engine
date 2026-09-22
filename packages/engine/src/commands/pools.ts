/**
 * Named pools: declaring one, and refilling it on a rest.
 *
 * Spell slots, Channel Divinity, Ki, a wand's charges and Hit Dice are the
 * same mechanism, and `resources.ts` beneath this holds the arithmetic. Pools
 * are declared, never derived, because the engine does not model class tables.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { canUseFeatureThisTurn } from '../combat.js';
import { type CreatureState, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  hasPool,
  remaining,
  spellSlotKey,
  type PoolDeclaration,
  type Recovery,
} from '../resources.js';
import type { TradedAmount } from '../progression.js';
import type { TradeFeature } from '../standing.js';
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
  /**
   * The levels of the slots to buy, where the trade lets the caller choose.
   *
   * {@link slotLevel}'s mirror and it arrived for the mirror reason. SRD Font
   * of Magic creates "one spell slot" at a level the Sorcerer picks off the
   * Created Spell Slots table, and SRD Arcane Recovery recovers slots the
   * Wizard chooses inside a combined-level budget: which slot is bought is no
   * more the engine's to guess than which slot is burnt.
   *
   * **A list rather than a number**, because one of the two SRD sentences
   * names several at once and a field that held one would make the other
   * unsayable. A trade that buys a single slot refuses a list of two by name
   * rather than quietly taking the first.
   */
  readonly gainedSlotLevels?: readonly number[];
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

    // "When you finish a Short Rest", which the clock answers exactly as it
    // answers `useRecovery`'s: the rest earned its benefits and nothing has
    // happened since.
    if (trade.moment === 'short-rest' && creature.lastShortRestAt !== state.elapsed) {
      return err(
        'not_the_moment',
        `${trade.name} happens when a Short Rest finishes, and ${id} has not just finished one`,
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
    // The one level in this trade, which is what `the-slot-level` reads.
    const slotLevel = trade.spends.key === null ? (command.slotLevel ?? 0) : 0;

    // What is actually bought, and where the caller has a say in it. Three
    // shapes, and every refusal below lands before anything is spent.
    const buying = slotsBought(creature.resources, trade, command.gainedSlotLevels, slotLevel);
    if (!buying.ok) return buying;

    const price = costOf(trade, buying.value, slotLevel);
    if (remaining(creature.resources, spending) < price) {
      const pool = creature.resources.pools[spending];
      return err(
        'exhausted',
        `${id} has ${remaining(creature.resources, spending)} ${pool?.label ?? spending} left, and ${trade.name} costs ${price}`,
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

    events.push({ type: 'resource-spent', id, key: spending, amount: price });

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

    // **The stamp goes on the first thing bought**, because a trade that buys
    // several slots is still one command: `once` fingerprints the call and the
    // fold reads one stamp, so a second copy would be the same command
    // claiming to have landed twice.
    buying.value.forEach((bought, position) => {
      events.push({
        type: 'resource-regained',
        id,
        key: bought.key,
        amount: bought.amount,
        ...(stamp === null || position > 0 ? {} : { command: stamp }),
      });
    });

    return ok(events);
  });
}

/** One pool a trade fills, and how much of it. */
interface Bought {
  readonly key: string;
  readonly amount: number;
  /**
   * The spell slot level, where what was bought is a slot the caller named.
   *
   * Carried rather than parsed back out of {@link key}: the level is a fact
   * this function already had, and `spellSlotKey` is a spelling for a log
   * line rather than a structure to read numbers out of.
   */
  readonly level?: number;
}

/**
 * What this trade buys, with every refusal the gained end can raise.
 *
 * Three shapes, and the trade says which by what it carries: a pool named by
 * the feature, a single slot priced off SRD Font of Magic's Created Spell
 * Slots table, or SRD Arcane Recovery's handful inside a combined-level
 * budget. The last two leave the level to the caller, which is `slotLevel`'s
 * own argument read at the other end of the same trade.
 *
 * **`nothing_to_regain` is unchanged and is the whole of the minting rule.**
 * `restore` never takes a pool above its maximum, so what a trade gives back
 * is what was expended; a Sorcerer holding every level 1 slot is refused here
 * rather than handed a slot their class table never printed. SRD Arcane
 * Recovery says "choose **expended** spell slots" and asks for nothing more.
 * Whether SRD Font of Magic's create may go further is a rules question that
 * has not been answered, and this is the conservative reading until it is.
 */
function slotsBought(
  resources: CreatureState['resources'],
  trade: TradeFeature,
  asked: readonly number[] | undefined,
  slotLevel: number,
): Result<readonly Bought[]> {
  /**
   * `exact` is the difference between a **count** the caller chose and one the
   * rules chose for them, and it is not the same question as whether they
   * chose the *level*.
   *
   * Capped, where the amount is the rules': SRD Wild Resurgence gives "a level
   * 1 spell slot" whatever is expended, and SRD Font of Magic gives "a number
   * of Sorcery Points equal to the slot's level" into a pool whose own
   * sentence is "you can't have more Sorcery Points than the maximum for your
   * level" — so a Sorcerer with one point spent who burns a level 5 slot gets
   * one point and the book says so. `restore` would cap it in any case; this
   * is that rule written where it can be read.
   *
   * Exact, where the caller named the count: a Wizard who asks Arcane Recovery
   * for two level 1 slots and has spent one would pay the day's single use in
   * full and be refunded in part, which is the quiet loss `useRecovery`
   * refuses by name. They can ask for one instead, and nothing else can.
   */
  const fill = (
    key: string,
    want: number,
    at: { readonly exact?: true; readonly level?: number } = {},
  ): Result<readonly Bought[]> => {
    const pool = resources.pools[key];
    if (pool === undefined) {
      return err('unknown_pool', `there is no ${key} for ${trade.name} to fill`);
    }
    // A trade that buys nothing is a refusal rather than a `resource-regained`
    // of zero in the log. `checkContent` refuses every authored grant that
    // could size itself to nothing, so this is the backstop and not the rule.
    if (want < 1) {
      return err('nothing_to_regain', `${trade.name} would give back no ${pool.label}`);
    }
    if (pool.spent < 1) {
      return err(
        'nothing_to_regain',
        `no ${pool.label} has been spent, and a trade gives back what was spent rather than minting more`,
      );
    }
    if (at.exact === true && pool.spent < want) {
      return err(
        'nothing_to_regain',
        `${trade.name} was asked for ${want} ${pool.label}, and ${pool.spent} of them has been spent`,
      );
    }
    // Never more than was spent, because `restore` caps at the maximum and a
    // trade that asked for more would be paid for in full and refunded in part.
    return ok([
      {
        key,
        amount: Math.min(want, pool.spent),
        ...(at.level === undefined ? {} : { level: at.level }),
      },
    ]);
  };

  if (trade.gains.key !== null) {
    return fill(trade.gains.key, amountOf(trade.gains.uses, slotLevel));
  }

  const levels = asked ?? [];
  if (levels.length === 0) {
    return err(
      'slot_level_required',
      `${trade.name} buys a spell slot and nothing says which level; the caster chooses`,
    );
  }
  for (const level of levels) {
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      return err('bad_slot_level', `${level} is not a spell slot level`);
    }
  }

  // SRD Font of Magic: "one spell slot", at the table's price. A list of two
  // is refused rather than read as its first entry.
  const priced = priceTableOf(trade);
  if (priced !== null) {
    if (levels.length > 1) {
      return err(
        'one_slot_only',
        `${trade.name} creates one spell slot, and ${levels.length} were named`,
      );
    }
    const level = levels[0]!;
    if (level > priced.length) {
      return err('slot_level_too_high', `${trade.name} creates no slot above level ${priced.length}`);
    }
    return fill(spellSlotKey(level), 1, { level });
  }

  // SRD Arcane Recovery: "a combined level equal to no more than half your
  // Wizard level (round up), and none of them can be level 6+".
  const max = trade.maxSlotLevel ?? 9;
  const tooHigh = levels.find((level) => level > max);
  if (tooHigh !== undefined) {
    return err('slot_level_too_high', `${trade.name} recovers no slot above level ${max}`);
  }
  const combined = levels.reduce((sum, level) => sum + level, 0);
  const budget = trade.combinedLevel ?? 0;
  if (combined > budget) {
    return err(
      'over_budget',
      `${trade.name} recovers ${budget} combined levels of spell slots, and ${levels.join(' + ')} is ${combined}`,
    );
  }

  // One entry per level, so two level 1 slots are one event for two uses —
  // and so a caller naming a level they have not spent is refused rather than
  // quietly given fewer than they asked for.
  const wanted = new Map<number, number>();
  for (const level of levels) wanted.set(level, (wanted.get(level) ?? 0) + 1);
  const bought: Bought[] = [];
  for (const [level, count] of [...wanted].sort(([a], [b]) => a - b)) {
    const one = fill(spellSlotKey(level), count, { exact: true, level });
    if (!one.ok) return one;
    bought.push(...one.value);
  }
  return ok(bought);
}

/**
 * What the spent end pays.
 *
 * A flat number on every trade the SRD prints one on; the Created Spell Slots
 * table's row where the feature carries one, because there the price is a
 * function of the rung the caller chose to buy.
 */
function costOf(trade: TradeFeature, bought: readonly Bought[], slotLevel: number): number {
  const table = priceTableOf(trade);
  if (table === null) return amountOf(trade.spends.uses, slotLevel);
  // The rung just bought. `slotsBought` has already refused a level this table
  // has no row for, and a table is only ever reached by the branch that buys
  // one slot and records its level.
  const level = bought[0]?.level ?? 0;
  return table[level - 1] ?? Number.POSITIVE_INFINITY;
}

/** SRD Font of Magic's Created Spell Slots table, where this trade prints one. */
const priceTableOf = (trade: TradeFeature): readonly number[] | null =>
  typeof trade.spends.uses === 'object' ? trade.spends.uses.byBoughtSlotLevel : null;

/** SRD Font of Magic: "a number of Sorcery Points equal to the slot's level". */
const amountOf = (uses: TradedAmount, slotLevel: number): number => {
  if (uses === 'the-slot-level') return slotLevel;
  // A price table is never what an end *gains*, and where it is what an end
  // spends the caller has already been charged off it.
  return typeof uses === 'object' ? 0 : uses;
};

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

