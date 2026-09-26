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
import { attachPool, detachPool, type ResourcePool } from '../resources.js';
import { placeItemOnGround, takeItemFromGround, type GroundItem } from '../positioning.js';
import {
  CorruptLogError,
  creatureOf,
  must,
  sceneOf,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const INVENTORY_EVENTS = [
  'items-gained',
  'items-lost',
  'item-transferred',
  'item-dropped',
  'item-taken-up',
  'coins-changed',
  'item-equipped',
  'item-unequipped',
  'armor-penalised',
  'weapon-penalised',
  'item-penalty-cleared',
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
 *
 * **And a conjured handful is its casting's**, on the same rule one step
 * along: berries that disappear when one spell ends are not the same line as
 * berries that disappear when another does, and neither is the same line as a
 * berry somebody picked. So the casting is part of the key, and a line without
 * one keeps exactly the key it has always had.
 *
 * **A weapon a *feature* conjured is its activation's**, for exactly that
 * reason and with exactly that consequence: SRD Pact of the Blade's Longsword
 * disappears when the bond ends, and a Warlock who bonds one while carrying a
 * Longsword of their own must not find both gone. Merged under one key they
 * would be one line of two carrying the bond's name, and `settleConjuredLines`
 * would take the pack's copy with the pact weapon.
 *
 * Both of those branches are now reached only by a line **without** a record,
 * which is a conjured handful and a log written by hand: a conjuring of one
 * thing labels it, and the copy it is keyed under already merges with nothing.
 * They stay because the answer they give is the same one and because the
 * handful is still a line neither the casting nor the kind alone identifies.
 *
 * No log written before a feature could conjure anything carries the field, so
 * every existing line keeps the key it has always had and both frozen fixtures
 * fold unchanged.
 *
 * **What a second line costs, said out loud.** Two lines of one kind are a
 * *question* to `copyNamed`, which refuses `ambiguous_copy` rather than
 * guessing. That is the right answer rather than a cost worth avoiding: the
 * alternative is the engine choosing which Longsword a caller meant, and the
 * one it chose wrongly would be the one that vanishes. Swinging is unaffected,
 * because an attack names a weapon by its catalogue id and never by its copy.
 *
 * **What has changed is that the question can now be answered.** A conjured
 * line of a single thing carries a record of its own, issued at the conjuring
 * through the item-instance door — see `conjuredLine` — so the Warlock's pact
 * Longsword has a name and can be dropped, given away or used by it, and the
 * refusal about the kind names that copy instead of saying "an unlabelled
 * copy" twice. The pack's own Longsword still has no record and so no name of
 * its own; whether the bare kind should fall to the one line that has none is
 * a question about `copyNamed` rather than about this key.
 */
const mergeKey = (line: InventoryLine): string =>
  line.instance !== undefined
    ? `copy:${line.instance}`
    : line.casting !== undefined
      ? `conjured:${line.casting}:${line.id}`
      : line.feature !== undefined
        ? `conjured:${line.feature}:${line.id}`
        : `kind:${line.id}`;

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
    // **The held line's own facts survive a line that leaves.** A loss names
    // the kind, the copy and the casting — enough to find the line — and is
    // not obliged to restate what holding it costs, which was pinned when the
    // handful was conjured. Under one key the two agree by construction, so
    // the incoming line still wins wherever it says anything.
    lines.set(key, { ...held, ...line, quantity: (held?.quantity ?? 0) + line.quantity });
  }
  return [...lines.values()]
    .filter((line) => line.quantity > 0)
    .sort(
      (a, b) =>
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
        itemInstanceNumber(a.instance ?? '') - itemInstanceNumber(b.instance ?? ''),
    );
}

/**
 * The two ways a line *leaving* a creature can contradict the record, thrown
 * where either is true.
 *
 * A negative line merges only with a line under the same key, so a departure
 * that finds none is filtered away by the `quantity > 0` rule and leaves the
 * thing still owned — silently, which is the one outcome a reducer must not
 * have. Both ways to write that of a copy with a record are refused: naming a
 * copy nobody has, and naming only the *kind* when every copy of that kind has
 * a record of its own.
 *
 * One function because two events ask it — a loss and a transfer — and two
 * copies of "which copy did you mean" would be two places to answer it
 * differently.
 */
function leavingIsNamed(
  event: GameEvent,
  creature: { readonly id: string; readonly inventory: readonly InventoryLine[] },
  line: InventoryLine,
): void {
  if (line.instance === undefined) {
    const kind = creature.inventory.filter((owned) => owned.id === line.id);
    if (kind.length > 0 && kind.every((owned) => owned.instance !== undefined)) {
      throw new CorruptLogError(
        event,
        `${creature.id}'s ${line.id} are copies with records of their own (${kind
          .map((owned) => owned.instance)
          .join(', ')}); the event has to name which`,
      );
    }
    return;
  }
  if (!creature.inventory.some((owned) => owned.instance === line.instance)) {
    throw new CorruptLogError(event, `${creature.id} does not have ${line.instance}`);
  }
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
       * The two ways a *record* can be contradicted — {@link leavingIsNamed},
       * which a transfer asks the same question of. The second of them is the
       * one a hand-written log falls into, and it is also why `loseItems` and
       * `useItem` resolve the copy before they emit.
       *
       * **Not every loss that removes nothing**, and deliberately so: taking
       * something the creature owns none of at all has always passed through
       * here and gone on doing nothing, exactly as taking five rations from
       * two removes both and says nothing. Those are `loseItems`'s `not_owned`
       * and its silence about over-taking — a command's rules, not a
       * contradiction in the log — and tightening them here would be a second
       * copy of a refusal that already exists. What is new is only that a
       * record can now be named, and a named record either exists or the log
       * is wrong.
       */
      for (const line of event.items) leavingIsNamed(event, creature, line);
      return withCreature(
        next,
        event.id,
        { inventory: removeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'item-transferred': {
      const giver = creatureOf(state, event, event.from);
      const taker = creatureOf(state, event, event.to);
      if (event.from === event.to) {
        throw new CorruptLogError(event, `${event.from} cannot hand something to itself`);
      }
      const line: InventoryLine = {
        id: event.item,
        quantity: event.quantity,
        ...(event.instance === undefined ? {} : { instance: event.instance }),
      };
      leavingIsNamed(event, giver, line);

      /**
       * **More than is carried would *make* items**, which is the one way this
       * differs from a loss: a loss over-taking removes what is there and
       * stops, and a transfer over-moving would put the difference in somebody
       * else's pack. So the arithmetic is the log's to be consistent about,
       * and `transferItem` refuses it first with a reason.
       */
      if (!Number.isInteger(event.quantity) || event.quantity < 1) {
        throw new CorruptLogError(
          event,
          `a transfer moves a whole number of things, not ${event.quantity}`,
        );
      }
      const carried = giver.inventory
        .filter((owned) =>
          line.instance === undefined
            ? owned.id === line.id && owned.instance === undefined
            : owned.instance === line.instance,
        )
        .reduce((total, owned) => total + owned.quantity, 0);
      if (carried < event.quantity) {
        throw new CorruptLogError(
          event,
          `${event.from} has ${carried} of ${event.item}, and the transfer moves ${event.quantity}`,
        );
      }

      // The copy's own state, moved **whole**: a wand with one charge left
      // arrives with one charge left, which is the whole of what keying a pool
      // to the copy bought.
      let given = giver.resources;
      let taken = taker.resources;
      for (const key of event.pools ?? []) {
        const detached = must(event, detachPool(given, key));
        given = detached.state;
        taken = must(event, attachPool(taken, detached.pool));
      }

      const afterGiving = withCreature(
        next,
        event.from,
        { inventory: removeItems(giver.inventory, [line]), resources: given },
        giver,
      );
      return withCreature(
        afterGiving,
        event.to,
        { inventory: mergeItems(taker.inventory, [line]), resources: taken },
        taker,
      );
    }

    /**
     * Something put down: off the creature, onto the floor, in one step.
     *
     * **Whether the record was minted is derived rather than declared**, and
     * that is deliberate: the fold can see whether the creature holds a line
     * under this id, so a second field saying so would be a second source of
     * truth that a hand-written log could set the wrong way. A copy the
     * creature already holds under that record is named by it; anything else
     * has to be the **next** record the engine would issue, on exactly the
     * pattern `items-gained` follows one case above — the command knows the id
     * before the event exists, and the fold is what says it is real.
     */
    case 'item-dropped': {
      const creature = creatureOf(state, event, event.id);
      const held = creature.inventory.find((line) => line.instance === event.instance);
      const minted = held === undefined;

      if (minted) {
        const expected = itemInstanceFor(state.itemsIssued + 1);
        if (event.instance !== expected) {
          throw new CorruptLogError(event, `expected item ${expected}, got ${event.instance}`);
        }
      } else if (held.id !== event.item) {
        throw new CorruptLogError(
          event,
          `${event.instance} is a ${held.id}, and the drop calls it a ${event.item}`,
        );
      }

      if (!Number.isInteger(event.quantity) || event.quantity < 1) {
        throw new CorruptLogError(
          event,
          `a drop puts down a whole number of things, not ${event.quantity}`,
        );
      }

      // **More than is carried would leave a pile nobody owned**, which is
      // `item-transferred`'s arithmetic read one door along: a loss that
      // over-takes removes what is there and stops, and this would put the
      // difference on the floor.
      const line: InventoryLine = {
        id: event.item,
        quantity: event.quantity,
        ...(minted ? {} : { instance: event.instance }),
      };
      /**
       * **A conjured handful is not stock a drop may take from**, and saying
       * so here is what stops a drop *making* things. `removeItems` merges a
       * conjured line under `conjured:<casting>:<id>` and an ordinary one
       * under `kind:<id>`, so a negative line naming only the kind finds no
       * key, is filtered away by the `quantity > 0` rule, and leaves ten
       * Goodberries in the hand with ten more on the floor. `dropItem` refuses
       * a conjured line outright — a conjured thing disappears rather than
       * landing — and this is the fold's half of the same sentence.
       */
      const carried = creature.inventory
        .filter((owned) =>
          minted
            ? owned.id === line.id && owned.instance === undefined && owned.casting === undefined
            : owned.instance === event.instance,
        )
        .reduce((total, owned) => total + owned.quantity, 0);
      if (carried < event.quantity) {
        throw new CorruptLogError(
          event,
          `${event.id} has ${carried} of ${event.item}, and the drop puts down ${event.quantity}`,
        );
      }

      // The copy's own state goes down with it: a pool belongs to whoever
      // holds the copy, and a wand on the floor is held by nobody.
      let resources = creature.resources;
      const pools: ResourcePool[] = [];
      for (const key of event.pools ?? []) {
        const detached = must(event, detachPool(resources, key));
        resources = detached.state;
        pools.push(detached.pool);
      }

      const dropped = withCreature(
        next,
        event.id,
        { inventory: removeItems(creature.inventory, [line]), resources },
        creature,
      );
      return {
        ...dropped,
        scene: must(
          event,
          placeItemOnGround(
            sceneOf(state, event),
            event.instance,
            {
              item: event.item,
              quantity: event.quantity,
              ...(minted ? { minted: true } : {}),
              ...(pools.length === 0 ? {} : { pools }),
            },
            event.placement,
          ),
        ),
        itemsIssued: minted ? state.itemsIssued + 1 : state.itemsIssued,
      };
    }

    /**
     * And back up again, whole.
     *
     * The pile carries what it is, so the event's `item` and `quantity` are
     * checked against the floor rather than believed — a hand-written log that
     * calls the wand a javelin is a contradiction, not a swap. A **minted**
     * record is handed back at this door and not reissued: the label answered
     * "which pile", and in a pack there is no pile.
     */
    case 'item-taken-up': {
      const creature = creatureOf(state, event, event.id);
      const taken = must(event, takeItemFromGround(sceneOf(state, event), event.instance));
      const pile: GroundItem = taken.pile;
      if (pile.item !== event.item || pile.quantity !== event.quantity) {
        throw new CorruptLogError(
          event,
          `${event.instance} is ${pile.quantity} of ${pile.item}, and the pick-up calls it ${event.quantity} of ${event.item}`,
        );
      }

      let resources = creature.resources;
      for (const pool of pile.pools ?? []) {
        resources = must(event, attachPool(resources, pool));
      }

      const line: InventoryLine = {
        id: pile.item,
        quantity: pile.quantity,
        ...(pile.minted === true ? {} : { instance: event.instance }),
      };
      return {
        ...withCreature(
          next,
          event.id,
          { inventory: mergeItems(creature.inventory, [line]), resources },
          creature,
        ),
        scene: taken.state,
      };
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

    // Rust eating into a held weapon — SRD Rust Monster's Antennae — lands on
    // the same record by the same arithmetic: the copy in hand, a number moved
    // rather than a record replaced. One case for the two, because the fold
    // has one thing to do for either and the event type is what says which
    // the log meant.
    case 'weapon-penalised':
    case 'armor-penalised': {
      const creature = creatureOf(state, event, event.id);
      const worn = creature.equipped.find((held) => held.id === event.item);
      if (worn === undefined) {
        throw new CorruptLogError(event, `${event.item} is not equipped`);
      }
      // **A number moved, not a record replaced** — the reading
      // `decoy-destroyed` states about the only other event in the engine that
      // edits one in place. A pudding's second pseudopod eats a second point.
      const equipped = creature.equipped.map((held) =>
        held === worn ? { ...held, penalty: (held.penalty ?? 0) + event.points } : held,
      );
      // The sheet is untouched: what armour *offers* is the catalogue's and
      // what has been eaten out of this suit is the record's, and
      // `armorClassOf` is where the two meet. See `EquippedItem.penalty`.
      return withCreature(next, event.id, { equipped }, creature);
    }

    // And the two undone — SRD Mending on the armour or the weapon. The same
    // arithmetic with the sign turned round, and the field goes entirely at
    // zero so a mended copy is indistinguishable from one nothing ever ate:
    // that is what "the penalty can be removed" says, and it is what keeps
    // every log written before a spell could lift one folding unchanged.
    case 'item-penalty-cleared': {
      const creature = creatureOf(state, event, event.id);
      const worn = creature.equipped.find((held) => held.id === event.item);
      if (worn === undefined) {
        throw new CorruptLogError(event, `${event.item} is not equipped`);
      }
      const equipped = creature.equipped.map((held) => {
        if (held !== worn) return held;
        const left = (held.penalty ?? 0) - event.points;
        if (left > 0) return { ...held, penalty: left };
        // The **field** goes, not a zero in it, so a mended copy and a copy
        // nothing ever ate are the same record — which is what keeps both
        // frozen fixtures folding to the states they always folded to.
        const mended = { ...held };
        delete (mended as { penalty?: number }).penalty;
        return mended;
      });
      return withCreature(next, event.id, { equipped }, creature);
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
