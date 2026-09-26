/**
 * The last charge: what spending it does to the item it came out of.
 *
 * SRD prints one sentence under nine wands and staffs — "If you expend the
 * wand's last charge, roll 1d20. On a 1, the wand crumbles into ashes and is
 * destroyed" — and a talisman prints the same consequence with no die. The
 * pool says which (`LastCharge`, on the item's `pool` grant); this module is
 * the one place the engine reads it.
 *
 * **Asked at the two places a charge is spent on something, and nowhere
 * else.** The casting route spends a charge inside the casting's own batch
 * (`resolveOnTargets`), and a priced conferral spends one inside the use's
 * (`useItem`). `expendCharges` on its own is not a third: nothing calls it for
 * a spend but `useItem`, which is this module's second caller.
 *
 * **Thrown at the spend that takes the pool to 0**, whether it took one charge
 * or three — "expend the wand's last charge" is true of a Fireball at three
 * charges out of three left. A spend that leaves a charge behind throws
 * nothing, because a die thrown for an outcome already decided moves the
 * generator for nothing, which is the quiet way a replay stops matching.
 *
 * **A destroyed copy leaves by the Wind Fan's road**: `item-unequipped`, then
 * `items-lost` naming the copy — so a crumbled wand is neither in the pack nor
 * in the hand, and `itemRoute` cannot find it to cast again. The die goes down
 * the path every recorded die goes down, `roll-recorded` and then
 * `rolls-issued`, so a replay reads the face rather than throwing another.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import type { CatalogueItem } from '../catalogue.js';
import type { CreatureState, GameEvent } from '../events.js';
import type { LastCharge } from '../progression.js';
import { rollRecorded } from '../rolls.js';
import type { Supply } from './casting.js';

/** The die a last charge is thrown against: SRD's "roll 1d20". */
const LAST_CHARGE_DIE = '1d20';

/**
 * What this item's pool says about its last charge, or null.
 *
 * The **first** pool, which is the one `itemChargePool` reads and the only one
 * `checkContent` lets an item declare.
 */
export function itemLastCharge(item: CatalogueItem): LastCharge | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind !== 'pool') continue;
    return grant.onLastCharge ?? null;
  }
  return null;
}

/** What spending the last charge wrote: the die, and the copy leaving. */
export interface LastChargeSpent {
  /** `roll-recorded` and `rolls-issued`, where a die was thrown. */
  readonly rolled: readonly GameEvent[];
  /** `item-unequipped` and `items-lost`, where the copy was destroyed. */
  readonly destroyed: readonly GameEvent[];
}

const NOTHING: LastChargeSpent = { rolled: [], destroyed: [] };

/**
 * What spending `spent` of the `left` charges in this copy does to it.
 *
 * Nothing unless the spend empties the pool and the pool says something about
 * that. The copy is the one **in hand** — the one whose pool was spent from —
 * named by its instance so the loss takes that wand and not the other one in
 * the pack.
 */
export function lastChargeSpent(
  who: CharacterId,
  creature: CreatureState,
  item: CatalogueItem,
  instance: string | undefined,
  left: number,
  spent: number,
  supply: Supply,
): Result<LastChargeSpent> {
  const rule = itemLastCharge(item);
  if (rule === null || left - spent > 0) return ok(NOTHING);

  let rolled: readonly GameEvent[] = [];
  let crumbles = rule.destroyed === 'always';
  if (rule.destroyed === true) {
    const issuedBefore = supply.issuer.count;
    const thrown = rollRecorded(supply.issuer, supply.rng, LAST_CHARGE_DIE);
    if (!thrown.ok) return thrown;
    crumbles = thrown.value.total <= rule.onD20AtOrBelow;
    rolled = [
      {
        type: 'roll-recorded',
        who,
        label: `${item.name}'s last charge (${LAST_CHARGE_DIE}, destroyed on ${rule.onD20AtOrBelow} or lower)`,
        natural: thrown.value.total,
        total: thrown.value.total,
        contributions: [],
        outcome: crumbles ? 'it is destroyed' : 'it holds',
      },
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    ];
  }
  if (!crumbles) return ok({ rolled, destroyed: [] });

  const held = creature.equipped.some(
    (worn) => worn.id === item.id && worn.instance === instance,
  );
  return ok({
    rolled,
    destroyed: [
      ...(held ? [{ type: 'item-unequipped' as const, id: who, item: item.id }] : []),
      {
        type: 'items-lost',
        id: who,
        items: [
          { id: item.id, quantity: 1, ...(instance === undefined ? {} : { instance }) },
        ],
        source: `${item.name}, destroyed as its last charge was spent`,
      },
    ],
  });
}
