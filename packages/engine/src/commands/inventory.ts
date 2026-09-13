/**
 * What a creature owns, what it is wearing, and what it can buy.
 *
 * Owning and wearing are two facts: `inventory` is everything carried,
 * `equipped` is the subset worn or wielded, and Armour Class reads only the
 * second. Chain mail in a backpack protects nobody.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { type CatalogueItem, expandPack, itemFor, type ItemKind } from '../catalogue.js';
import { type GameEvent, type GameState, type InventoryLine } from '../events.js';
import { creatureOf, unknownCreature } from './command.js';
import { once } from '../idempotency.js';

/** Everything this creature is carrying, by catalogue id. */
export function carrying(state: GameState, id: CharacterId): readonly InventoryLine[] {
  return creatureOf(state, id)?.inventory ?? [];
}

/** Money on hand, in copper. */
export function coinsOf(state: GameState, id: CharacterId): number {
  return creatureOf(state, id)?.coins ?? 0;
}

export const quantityOf = (state: GameState, id: CharacterId, itemId: string): number =>
  carrying(state, id).find((line) => line.id === itemId)?.quantity ?? 0;

/**
 * Buy something, at the price the SRD prints.
 *
 * Atomic on purpose: the items and the coin move in one batch, so there is no
 * state in which a character has paid and not received. A price the SRD leaves
 * as "Varies" is refused rather than guessed — the book declined to say, and
 * inventing a number is worse than asking.
 *
 * Buying a pack buys what is in it: SRD prices the bundle and lists the
 * contents, so a Scholar's Pack puts nine things in your hands.
 */
export function purchaseItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  quantity = 1,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string; quantity: number } =
    commandId === undefined ? { itemId, quantity } : { commandId, itemId, quantity };
  return once(state, `purchase:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return err('bad_quantity', `a purchase takes a positive whole number, got ${quantity}`);
    }

    const item = itemFor(itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (item.costCp === null) {
      return err(
        'no_price',
        `the SRD prints no single price for ${item.name}; choose a variant, or have the GM set one`,
      );
    }

    const price = item.costCp * quantity;
    if (creature.coins < price) {
      return err(
        'cannot_afford',
        `${item.name} costs ${price} copper and ${id} has ${creature.coins}`,
      );
    }

    const items = expandPack(itemId).map((line) => ({
      id: line.id,
      quantity: line.quantity * quantity,
    }));

    return ok([
      {
        type: 'items-gained',
        id,
        items,
        source: `bought ${quantity} × ${item.name}`,
        ...(stamp === null ? {} : { command: stamp }),
      },
      { type: 'coins-changed', id, copper: -price, source: `bought ${item.name}` },
    ]);
  });
}

/** Armour and weapons are worn or wielded; a sack of parchment is not. */
const EQUIPPABLE: ReadonlySet<ItemKind> = new Set<ItemKind>(['armor', 'weapon']);

/**
 * Wear or wield something already owned.
 *
 * The separation this exists for: **owning is not wearing**. Chain mail in a
 * backpack protects nobody, so Armour Class reads the equipped set and this is
 * the only thing that moves it.
 *
 * SRD allows one suit of body armour and one shield, so a second of either is
 * refused rather than silently replacing the first — taking armour off is a
 * decision, and it should look like one in the log.
 */
export function equipItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `equip:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const item = itemFor(itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (!EQUIPPABLE.has(item.kind)) {
      return err('not_equippable', `${item.name} is carried, not worn or wielded`);
    }
    if (quantityOf(state, id, itemId) < 1) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    if (creature.equipped.includes(itemId)) {
      return err('already_equipped', `${item.name} is already in hand`);
    }

    // One suit of body armour, one shield.
    if (item.armor !== null) {
      const slot = item.armor.category === 'shield' ? 'shield' : 'body armour';
      const taken = creature.equipped
        .map((held) => itemFor(held))
        .find((held): held is CatalogueItem => {
          if (held?.armor == null) return false;
          const heldSlot = held.armor.category === 'shield' ? 'shield' : 'body armour';
          return heldSlot === slot;
        });
      if (taken !== undefined) {
        return err('slot_taken', `${taken.name} is already worn as ${slot}; take it off first`);
      }
    }

    return ok([
      {
        type: 'item-equipped',
        id,
        item: itemId,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/** Put something away. It stays owned: taking armour off is not selling it. */
export function unequipItem(
  state: GameState,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `unequip:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.equipped.includes(itemId)) {
      const item = itemFor(itemId);
      return err('not_equipped', `${item?.name ?? itemId} is not worn or wielded`);
    }

    return ok([
      { type: 'item-unequipped', id, item: itemId, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

