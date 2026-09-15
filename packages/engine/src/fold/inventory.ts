/**
 * What a creature is carrying, wearing and holding in coin.
 *
 * `withEquipment` lives here rather than with the sheet because equipment is
 * the authoritative fact and the sheet's armour is a view of it — and the
 * seam that replaces a sheet wholesale, `roster.ts`, asks this one to
 * recompute that view rather than keeping a second copy of the rule.
 */
import type { CharacterSheet } from '../character.js';
import type { GameEvent } from '../events.js';
import type { EquippedItem, GameState, InventoryLine } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const INVENTORY_EVENTS = [
  'items-gained',
  'items-lost',
  'coins-changed',
  'item-equipped',
  'item-unequipped',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type InventoryEvent = Extract<GameEvent, { type: (typeof INVENTORY_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isInventoryEvent = seamOf(INVENTORY_EVENTS);

/**
 * Quantities merge and the list stays sorted, so two identical packs agree.
 *
 * Exported because a plan has to describe the same inventory the log will
 * produce: two packages that both hold a quarterstaff own one line of two, not
 * two lines of one, before a single event is appended.
 */
export function mergeItems(
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] {
  const counts = new Map(inventory.map((line) => [line.id, line.quantity]));
  for (const line of items) counts.set(line.id, (counts.get(line.id) ?? 0) + line.quantity);
  return [...counts.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const removeItems = (
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] =>
  mergeItems(inventory, items.map((line) => ({ ...line, quantity: -line.quantity })));

/**
 * Derive the sheet's armour from what is equipped.
 *
 * `equipped` is the authoritative fact; `sheet.armor` and `sheet.shield` are a
 * view of it that Armour Class happens to read. So this recomputes both from
 * the whole list rather than patching one slot per event — patching is only
 * correct if every event arrives in the right order and nothing else ever
 * touches the sheet, and `character-advanced` replaces the sheet wholesale.
 *
 * Anything that is not armour or a shield contributes nothing: a dagger in
 * hand is tracked, but it is not Armour Class.
 */
export function withEquipment(
  sheet: CharacterSheet,
  equipped: readonly EquippedItem[],
): CharacterSheet {
  const pieces = equipped.map((held) => held.armor);
  return {
    ...sheet,
    armor: pieces.find((piece) => piece !== null && piece.category !== 'shield') ?? null,
    shield: pieces.find((piece) => piece !== null && piece.category === 'shield') ?? null,
  };
}

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyInventory({ state, next, legacy }: Applying, event: InventoryEvent): GameState {
  switch (event.type) {
    case 'items-gained': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: mergeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'items-lost': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: removeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'coins-changed': {
      const creature = creatureOf(state, event, event.id);
      const coins = creature.coins + event.copper;
      if (coins < 0) {
        throw new CorruptLogError(event, `${event.id} cannot hold ${coins} copper`);
      }
      return withCreature(next, event.id, { coins }, creature);
    }

    case 'item-equipped': {
      const creature = creatureOf(state, event, event.id);
      if (creature.equipped.some((held) => held.id === event.item)) {
        throw new CorruptLogError(event, `${event.item} is already equipped`);
      }
      // What the item is was pinned on the event; a log older than that field
      // is read through the content it was written against, or refused.
      let armor = event.armor;
      if (armor === undefined) {
        if (legacy === null) {
          throw new CorruptLogError(
            event,
            `${event.item} was equipped by a log that predates pinned armour; replay it with the content it was written against`,
          );
        }
        armor = legacy.item(event.item)?.armor ?? null;
      }
      const equipped = [...creature.equipped, { id: event.item, armor }].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }

    case 'item-unequipped': {
      const creature = creatureOf(state, event, event.id);
      if (!creature.equipped.some((held) => held.id === event.item)) {
        throw new CorruptLogError(event, `${event.item} is not equipped`);
      }
      const equipped = creature.equipped.filter((held) => held.id !== event.item);
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}
