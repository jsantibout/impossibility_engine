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
import {
  itemInstanceFor,
  itemInstanceNumber,
  type AttunedItem,
  type EquippedItem,
  type GameState,
  type InventoryLine,
} from '../state.js';
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
  'attuned',
  'attunement-ended',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type InventoryEvent = Extract<GameEvent, { type: (typeof INVENTORY_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isInventoryEvent = seamOf(INVENTORY_EVENTS);

/**
 * What a line is merged under: the copy, where it has a record; the kind of
 * thing, where it has not.
 *
 * The whole of the distinction, in one expression. Two wands with three
 * charges between them are not one wand with six, so a labelled copy merges
 * with nothing — not even with another copy of the same wand — while twenty
 * arrows and twenty more are forty arrows, exactly as they have always been.
 */
const mergeKey = (line: InventoryLine): string =>
  line.instance === undefined ? `kind:${line.id}` : `copy:${line.instance}`;

/**
 * Quantities merge and the list stays sorted, so two identical packs agree.
 *
 * Exported because a plan has to describe the same inventory the log will
 * produce: two packages that both hold a quarterstaff own one line of two, not
 * two lines of one, before a single event is appended.
 *
 * **A labelled copy merges with nothing**, which is what having a record
 * means; the sort puts a kind's copies after its stack and in the order they
 * were gained, numerically, so the same log always serialises the same way.
 */
export function mergeItems(
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] {
  const lines = new Map<string, InventoryLine>();
  for (const line of [...inventory, ...items]) {
    const key = mergeKey(line);
    const held = lines.get(key);
    lines.set(key, { ...line, quantity: (held?.quantity ?? 0) + line.quantity });
  }
  return [...lines.values()]
    .filter((line) => line.quantity > 0)
    .sort(
      (a, b) =>
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
        itemInstanceNumber(a.instance ?? '') - itemInstanceNumber(b.instance ?? ''),
    );
}

/** One order for every list of items, so state serialises identically. */
const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

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
      /**
       * The copies being given records get them **in sequence**, checked here
       * rather than assigned here.
       *
       * The pattern `fold/casting.ts` already runs on a casting id, and for
       * the same two reasons: the command has to know the id before the event
       * exists — a pool is declared under it in the same batch — and the fold
       * has to be the thing that says an id is real, or a batch appended twice
       * would quietly hand one creature two records of the same copy.
       */
      let itemsIssued = state.itemsIssued;
      for (const line of event.items) {
        if (line.instance === undefined) continue;
        if (line.quantity !== 1) {
          throw new CorruptLogError(
            event,
            `${line.instance} is one copy of ${line.id}, and the line claims ${line.quantity}`,
          );
        }
        const expected = itemInstanceFor(itemsIssued + 1);
        if (line.instance !== expected) {
          throw new CorruptLogError(event, `expected item ${expected}, got ${line.instance}`);
        }
        itemsIssued += 1;
      }
      return {
        ...withCreature(
          next,
          event.id,
          { inventory: mergeItems(creature.inventory, event.items) },
          creature,
        ),
        itemsIssued,
      };
    }

    case 'items-lost': {
      const creature = creatureOf(state, event, event.id);
      /**
       * A loss that would remove nothing is a log contradicting itself, and
       * both ways of writing one are caught here.
       *
       * A negative line merges only with a line under the same key, so a loss
       * that finds none is filtered away by the `quantity > 0` rule and leaves
       * the thing still owned — silently, which is the one outcome a reducer
       * must not have. Two ways to write it: naming a copy nobody has, and
       * naming only the *kind* when every copy of that kind has a record of
       * its own. The second is the one a hand-written log falls into, and it
       * is also why `loseItems` and `useItem` resolve the copy before they
       * emit.
       *
       * Counted things keep the reading they have always had: taking five
       * rations from two removes both and says nothing, because that line did
       * find its stack. `loseItems` is what refuses to take more than there is.
       */
      for (const line of event.items) {
        if (line.instance === undefined) {
          const kind = creature.inventory.filter((owned) => owned.id === line.id);
          if (kind.length > 0 && kind.every((owned) => owned.instance !== undefined)) {
            throw new CorruptLogError(
              event,
              `${event.id}'s ${line.id} are copies with records of their own (${kind
                .map((owned) => owned.instance)
                .join(', ')}); a loss has to name which`,
            );
          }
          continue;
        }
        if (!creature.inventory.some((owned) => owned.instance === line.instance)) {
          throw new CorruptLogError(event, `${event.id} does not have ${line.instance}`);
        }
      }
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
      // Which copy went into the hand, where the log says. A named copy that
      // is not owned is a contradiction of the same kind as equipping
      // something nobody has.
      if (
        event.instance !== undefined &&
        !creature.inventory.some((line) => line.instance === event.instance)
      ) {
        throw new CorruptLogError(event, `${event.id} does not have ${event.instance}`);
      }
      const equipped = [
        ...creature.equipped,
        // Pinned, all of it: what the item *is*, what it *grants*, and which
        // copy it is. A log older than the grants field was written before an
        // item could grant anything, so an absent list is none rather than a
        // question — and an absent copy is an unlabelled one, which is what
        // every log written before this field holds.
        {
          id: event.item,
          armor,
          ...(event.grants === undefined ? {} : { grants: event.grants }),
          ...(event.instance === undefined ? {} : { instance: event.instance }),
        },
      ].sort(byId);
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

    case 'attuned': {
      const creature = creatureOf(state, event, event.id);
      if (creature.attuned.some((held) => held.id === event.item)) {
        throw new CorruptLogError(event, `${event.id} is already attuned to ${event.item}`);
      }
      // The cap is `attuneItem`'s rule, not this seam's: what the fold refuses
      // is a log that contradicts itself, and a fourth attunement is a log that
      // broke a rule. The two are different failures and only one of them is a
      // corrupt log.
      const attuned: readonly AttunedItem[] = [
        ...creature.attuned,
        { id: event.item, ...(event.grants === undefined ? {} : { grants: event.grants }) },
      ].sort(byId);
      return withCreature(next, event.id, { attuned }, creature);
    }

    case 'attunement-ended': {
      const creature = creatureOf(state, event, event.id);
      if (!creature.attuned.some((held) => held.id === event.item)) {
        throw new CorruptLogError(event, `${event.id} is not attuned to ${event.item}`);
      }
      return withCreature(
        next,
        event.id,
        { attuned: creature.attuned.filter((held) => held.id !== event.item) },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}
