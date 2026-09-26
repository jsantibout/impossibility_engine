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
 *
 * **A copy that becomes another item leaves by the same road and is
 * replaced** — SRD Staff of the Woodlands' "becomes a nonmagical
 * Quarterstaff". After the loss, `items-gained` hands over one copy of the
 * named item and, where the staff was in the hand, `item-equipped` puts it
 * there, pinning what it is and grants exactly as `equipItem` pins them, so the
 * fold opens nothing. Attunement to the old copy ends by the pass that ends it
 * for any item no longer owned. The named item keeps no charges —
 * `checkContent` refuses one that does — so the gain needs no record issued
 * and no pool declared.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { itemStandingEffects, type CatalogueItem } from '../catalogue.js';
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
  /**
   * `item-unequipped` and `items-lost`, where the copy was destroyed — and,
   * where it became another item, the `items-gained` and `item-equipped` that
   * put the other item where it was.
   */
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

  // **Another item where the staff was**, looked up before the die rather than
  // trusted from the validator: a caller may hand this a catalogue nobody
  // checked, and a miss found after the throw would have moved the generator
  // for a refusal.
  const remains = 'becomes' in rule ? supply.content.item(rule.becomes) : null;
  if ('becomes' in rule && remains === null) {
    return err(
      'unknown_item',
      `${item.name}'s last charge leaves ${rule.becomes} behind, which is not in the catalogue`,
    );
  }

  let rolled: readonly GameEvent[] = [];
  let crumbles = 'destroyed' in rule && rule.destroyed === 'always';
  if ('onD20AtOrBelow' in rule) {
    const issuedBefore = supply.issuer.count;
    const thrown = rollRecorded(supply.issuer, supply.rng, LAST_CHARGE_DIE);
    if (!thrown.ok) return thrown;
    crumbles = thrown.value.total <= rule.onD20AtOrBelow;
    rolled = [
      {
        type: 'roll-recorded',
        who,
        label:
          remains === null
            ? `${item.name}'s last charge (${LAST_CHARGE_DIE}, destroyed on ${rule.onD20AtOrBelow} or lower)`
            : `${item.name}'s last charge (${LAST_CHARGE_DIE}, becomes ${remains.name} on ${rule.onD20AtOrBelow} or lower)`,
        natural: thrown.value.total,
        total: thrown.value.total,
        contributions: [],
        outcome: !crumbles ? 'it holds' : remains === null ? 'it is destroyed' : `it becomes ${remains.name}`,
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
  const leaving: GameEvent[] = [
    ...(held ? [{ type: 'item-unequipped' as const, id: who, item: item.id }] : []),
    {
      type: 'items-lost',
      id: who,
      items: [{ id: item.id, quantity: 1, ...(instance === undefined ? {} : { instance }) }],
      source:
        remains === null
          ? `${item.name}, destroyed as its last charge was spent`
          : `${item.name}, turned into ${remains.name} as its last charge was spent`,
    },
  ];
  if (remains === null) return ok({ rolled, destroyed: leaving });

  // One of a kind in `equipped`, which is the reading `equipItem` keeps: a
  // second Quarterstaff where one is already in hand goes to the pack.
  const intoHand = held && !creature.equipped.some((worn) => worn.id === remains.id);
  const grants = itemStandingEffects(remains);
  return ok({
    rolled,
    destroyed: [
      ...leaving,
      {
        type: 'items-gained',
        id: who,
        items: [{ id: remains.id, quantity: 1 }],
        source: `${item.name}, left as ${remains.name} when its last charge was spent`,
      },
      ...(intoHand
        ? [
            {
              type: 'item-equipped' as const,
              id: who,
              item: remains.id,
              armor: remains.armor,
              ...(grants.length === 0 ? {} : { grants }),
            },
          ]
        : []),
    ],
  });
}
