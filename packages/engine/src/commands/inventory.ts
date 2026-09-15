/**
 * What a creature owns, what it is wearing, and what it can buy.
 *
 * Owning and wearing are two facts: `inventory` is everything carried,
 * `equipped` is the subset worn or wielded, and Armour Class reads only the
 * second. Chain mail in a backpack protects nobody.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import { type CatalogueItem, itemChargePool, itemStandingEffects, type ItemKind } from '../catalogue.js';
import { type Content } from '../content.js';
import { type CreatureState, type GameEvent, type GameState, type InventoryLine } from '../events.js';
import { creatureOf, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import { once } from '../idempotency.js';
import { hasPool, remaining } from '../resources.js';

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
  content: Content,
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

    const item = content.item(itemId);
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

    const items = content.expandPack(itemId).map((line) => ({
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

/**
 * What can be worn or wielded; a sack of parchment cannot.
 *
 * Armour and weapons, and the five categories the SRD prints its magic items
 * under. A Potion and a Scroll are deliberately absent: they are consumed
 * rather than worn, which is a mechanism nothing has built — and letting one
 * be equipped would be a benefit that never runs out.
 */
const EQUIPPABLE: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'armor',
  'weapon',
  'ring',
  'rod',
  'staff',
  'wand',
  'wondrous',
]);

/** SRD: "You can be attuned to no more than three magic items at a time." */
export const ATTUNEMENT_LIMIT = 3;

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
  content: Content,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `equip:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const item = content.item(itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (!EQUIPPABLE.has(item.kind)) {
      return err('not_equippable', `${item.name} is carried, not worn or wielded`);
    }
    if (quantityOf(state, id, itemId) < 1) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    if (creature.equipped.some((held) => held.id === itemId)) {
      return err('already_equipped', `${item.name} is already in hand`);
    }

    // One suit of body armour, one shield.
    if (item.armor !== null) {
      const slot = item.armor.category === 'shield' ? 'shield' : 'body armour';
      const taken = creature.equipped
        .map((held) => content.item(held.id))
        .find((held): held is CatalogueItem => {
          if (held?.armor == null) return false;
          const heldSlot = held.armor.category === 'shield' ? 'shield' : 'body armour';
          return heldSlot === slot;
        });
      if (taken !== undefined) {
        return err('slot_taken', `${taken.name} is already worn as ${slot}; take it off first`);
      }
    }

    const grants = itemStandingEffects(item);
    const charges = itemChargePool(item);

    /**
     * **A second copy of a charged item is refused**, and the refusal names
     * the record that is missing rather than pretending it is a rule.
     *
     * `InventoryLine` is `{ id, quantity }`: two Wands of Secrets are one line
     * of two, and a creature's pools are keyed by name, so one pool would hold
     * both wands' charges — spend three from one and the other is empty too.
     * Item instance identity is the decision that fixes it and it is named as
     * a later brief's subject in `docs/design/characters-and-equipment.md`.
     *
     * **A brief that adds item *transfer* cannot defer it.** Charges follow
     * the creature and not the object today, so a wand handed over would leave
     * its charges behind and arrive full — which no refusal here can catch,
     * because by then nothing says the two wands were ever the same wand.
     */
    const copies = quantityOf(state, id, itemId);
    if (charges !== null && copies > 1) {
      return err(
        'no_item_instance',
        `${id} has ${copies} of ${item.name}, and the engine has no item instance record to tell them apart — their charges would be one pool across all of them. Put all but one down, or split them between creatures`,
      );
    }

    return ok([
      {
        type: 'item-equipped',
        id,
        item: itemId,
        // Pinned: what this item *is* travels with the event, so the fold
        // never has to open a catalogue to know what the creature wears.
        armor: item.armor,
        // And what it *grants*, for the same reason and by the same rule.
        // Omitted when there is nothing, so every mundane equip event is the
        // event it has always been.
        ...(grants.length === 0 ? {} : { grants }),
        ...(stamp === null ? {} : { command: stamp }),
      },
      // And the charges, declared as the pool they are. Pinned by construction:
      // `resource-pool-declared` carries the whole declaration, so the fold
      // never opens a catalogue to know how many charges a wand had.
      //
      // Declared **once**, on the equip that finds no pool. Putting a wand down
      // does not empty it — `unequipItem` leaves the pool alone — so picking it
      // back up finds the charges where it left them rather than refilling
      // them, which is what a fresh declaration would quietly do.
      ...(charges === null || hasPool(creature.resources, charges.key)
        ? []
        : [{ type: 'resource-pool-declared' as const, id, pool: charges }]),
    ]);
  });
}

/** Put something away. It stays owned: taking armour off is not selling it. */
export function unequipItem(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `unequip:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.equipped.some((held) => held.id === itemId)) {
      const item = content.item(itemId);
      return err('not_equipped', `${item?.name ?? itemId} is not worn or wielded`);
    }

    return ok([
      { type: 'item-unequipped', id, item: itemId, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Charges left in an item this creature has held, or 0.
 *
 * Zero for an item that has no charges at all and for one whose pool nobody
 * has declared yet, on the same rule `remaining` follows: a pool nobody
 * declared has none, rather than throwing.
 *
 * **Held, rather than still holding.** The pool is keyed by catalogue id and
 * outlives both `unequipItem` and `loseItems`, which is deliberate for the
 * first — putting a wand down does not empty it — and an artefact of the
 * missing item instance record for the second: a wand taken by a thief leaves
 * its charges behind, and one re-acquired later is picked up as spent as the
 * last one was. `expendCharges` is the guard that matters, and it asks whether
 * the thing is in hand; this answers about a pool, and says so.
 */
export function chargesLeft(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
): number {
  const item = content.item(itemId);
  const pool = item === null ? null : itemChargePool(item);
  const creature = creatureOf(state, id);
  if (pool === null || creature === null) return 0;
  return remaining(creature.resources, pool.key);
}

/**
 * Spend charges from a magic item.
 *
 * **What the charges buy is not here**, and that is the boundary of this
 * command rather than an omission: a Wand of Fireballs casts _Fireball_ and a
 * Staff of Healing casts _Cure Wounds_, and resolving a spell from an item is
 * a grant kind nothing executes yet. What this owns is the economy — how many
 * are left, what a use costs, and what running out looks like — which is the
 * half `resources.ts` has had since the day it named "a magic item with seven
 * charges" as a designed use of a pool.
 *
 * Three conditions, each the item's own line rather than a general rule:
 *
 * - **"While holding it"** — SRD writes it on every charged item in the book,
 *   so the item has to be equipped. Owning a wand in a backpack is not holding
 *   it, on the same distinction Armour Class already draws.
 * - **"(Requires Attunement)"** — an item that asks for it gives nothing until
 *   it has it, so its charges are not spendable either.
 * - **Running out is a refusal, not an exception.** `spend` has said so since
 *   pools landed, and this says it in the pool's own words.
 */
export function expendCharges(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
  charges = 1,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string; charges: number } =
    commandId === undefined ? { itemId, charges } : { commandId, itemId, charges };
  return once(state, `expend-charges:${id}`, inputs, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const item = content.item(itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);

    const pool = itemChargePool(item);
    if (pool === null) return err('no_charges', `${item.name} has no charges to spend`);

    if (!creature.equipped.some((held) => held.id === itemId)) {
      return err('not_equipped', `${item.name}'s charges are spent while holding it, and ${id} is not`);
    }
    if (item.attunement !== undefined && !creature.attuned.some((held) => held.id === itemId)) {
      return err(
        'not_attuned',
        `${item.name} requires attunement, and ${id} has not attuned to it`,
      );
    }
    if (!Number.isInteger(charges) || charges < 1) {
      return err('bad_amount', `spending takes a positive whole number of charges, got ${charges}`);
    }
    if (!hasPool(creature.resources, pool.key)) {
      /**
       * The pool arrives with the equip event, so this is what is left when
       * the item was equipped by something that is not `equipItem`.
       *
       * **Creation is that something, today.** `createCharacter` writes its
       * own `item-equipped` straight from `choices.equipped` and pins only the
       * armour record — it does not pin an item's `grants` either, which is
       * the same gap this one sits in and which predates charges. A character
       * born holding a wand therefore holds a wand with no pool, and is told
       * so here rather than silently finding it empty. Closing it properly is
       * `creation.ts`'s to do, in the brief that gives creation the item
       * compiler; `charges.test.ts` pins the hole so it is a recorded fact.
       */
      return err(
        'unknown_pool',
        `nothing has declared ${item.name}'s charges for ${id}; take it off and put it back on`,
      );
    }

    const left = remaining(creature.resources, pool.key);
    if (left < charges) {
      return err('exhausted', `${pool.label} has ${left} left, and ${charges} were asked for`);
    }

    return ok([
      {
        type: 'resource-spent',
        id,
        key: pool.key,
        amount: charges,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/** The magic items this creature is attuned to, by catalogue id. */
export function attunedItems(state: GameState, id: CharacterId): readonly string[] {
  return (creatureOf(state, id)?.attuned ?? []).map((held) => held.id);
}

/**
 * Whether this creature meets the line the item prints after "requires
 * attunement", or what stands in the way.
 *
 * Three answers, not two. A Barbarian is **not** a spellcaster and that is a
 * refusal; a creature nobody has said anything about is an unanswered question
 * and gets `declareSpellcasting` named as the command that would settle it.
 * Collapsing the two would refuse a stat block's warlock its own wand.
 */
function prerequisiteProblem(creature: CreatureState, item: CatalogueItem): Result<null> {
  const attunement = item.attunement;
  if (attunement === undefined) return ok(null);

  const classes = attunement.byClass ?? [];
  if (classes.length > 0) {
    const record = creature.character;
    const taken =
      record === null
        ? []
        : [record.classId, ...(record.choices.multiclass ?? []).map((entry) => entry.classId)];
    if (!classes.some((wanted) => taken.includes(wanted))) {
      return err(
        'prerequisite_unmet',
        `${item.name} requires attunement by a ${classes.join(' or ')}, and ${creature.id} is ${
          taken.length === 0 ? 'of no class the engine has been told about' : taken.join('/')
        }`,
      );
    }
  }

  if (attunement.bySpellcaster === true) {
    const casts =
      creature.spellcasting.classes.length > 0 || creature.spellcasting.granted.length > 0;
    if (!casts) {
      // A character's spellcasting is derived from the class table at
      // creation, so an empty one is an answer. A creature with no character
      // record has simply never been asked.
      if (creature.character === null) {
        return needsContext(
          'unknown_spellcasting',
          `${item.name} requires attunement by a spellcaster, and nothing says whether ${creature.id} casts anything`,
          [
            {
              kind: 'creature',
              subject: creature.id,
              need: `what ${creature.id} can cast, if anything`,
              because: 'the item is attunable only by a spellcaster',
              satisfyWith: `a declareSpellcasting command for ${creature.id}`,
            },
          ],
        );
      }
      return err(
        'prerequisite_unmet',
        `${item.name} requires attunement by a spellcaster, and ${creature.id} casts nothing`,
      );
    }
  }

  return ok(null);
}

/**
 * Attune to a magic item, which is what switches its benefit on.
 *
 * SRD: "Attuning to an item requires a creature to spend a Short Rest focused
 * on only that item while being in physical contact with it."
 *
 * **The rest is read as one in progress, not as one that ended**, and that is
 * this command's own decision — the brief left it open and both readings were
 * defensible. The sentence says the Short Rest is *spent* on the item: the
 * attuning happens inside the hour, not at the moment it runs out. Hanging it
 * off `endRest` instead would have made a rest's payout carry a list of items,
 * given `endRest` the content argument it has never needed, and left no way to
 * attune during a Long Rest — which is a Short Rest's hour several times over.
 * So what is required is that the creature **is resting**, and a rest already
 * broken is refused, because an interrupted rest is not an hour spent focused
 * on anything.
 *
 * What is deliberately *not* enforced is "focused on only that item": whether
 * somebody spent the hour reading instead is fiction the engine cannot see.
 * Attuning to two items in one rest is therefore possible here and is the
 * table's call — named rather than silently allowed.
 */
export function attuneItem(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `attune:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const item = content.item(itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (item.attunement === undefined) {
      return err('no_attunement', `${item.name} works for anybody holding it; nothing to attune`);
    }
    // "While being in physical contact with it": owning it is the engine's
    // reading of that, rather than wearing it — you attune to a ring by
    // holding it, and the benefit is what asks to be worn.
    if (quantityOf(state, id, itemId) < 1) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    if (creature.attuned.some((held) => held.id === itemId)) {
      return err('already_attuned', `${id} is already attuned to ${item.name}`);
    }
    if (creature.attuned.length >= ATTUNEMENT_LIMIT) {
      return err(
        'attunement_limit',
        `${id} is attuned to three items already (${creature.attuned
          .map((held) => held.id)
          .join(', ')}), and a creature attunes to no more than three at a time`,
      );
    }

    const prerequisite = prerequisiteProblem(creature, item);
    if (!prerequisite.ok) return prerequisite;

    if (creature.resting === null) {
      return err(
        'not_resting',
        `attuning to ${item.name} takes a Short Rest spent focused on it, and ${id} is not resting`,
      );
    }
    if (creature.resting.interruptedBy !== null) {
      return err(
        'rest_interrupted',
        `${id}'s rest was interrupted by ${creature.resting.interruptedBy}, so no time was spent focused on ${item.name}`,
      );
    }

    const grants = itemStandingEffects(item);

    return ok([
      {
        type: 'attuned',
        id,
        item: itemId,
        // Pinned exactly as `item-equipped` pins what it reads, so an
        // attunement goes on offering what the catalogue said at the time.
        ...(grants.length === 0 ? {} : { grants }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * Give up an attunement.
 *
 * SRD lists ending it voluntarily among the ways attunement ends, alongside
 * the two nobody chooses — dying, and no longer having the item — which the
 * fold derives instead. No rest is required here: the SRD's own sentence about
 * a *second* Short Rest is about a cursed item's grip, and a curse is a thing
 * this engine has no vocabulary for. Refusing every release on the strength of
 * a rest nobody can see would be inventing the stricter rule.
 */
export function endAttunement(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `unattune:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.attuned.some((held) => held.id === itemId)) {
      const item = content.item(itemId);
      return err('not_attuned', `${id} is not attuned to ${item?.name ?? itemId}`);
    }

    return ok([
      { type: 'attunement-ended', id, item: itemId, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

