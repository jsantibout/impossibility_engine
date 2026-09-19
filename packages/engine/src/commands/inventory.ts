/**
 * What a creature owns, what it is wearing, and what it can buy.
 *
 * Owning and wearing are two facts: `inventory` is everything carried,
 * `equipped` is the subset worn or wielded, and Armour Class reads only the
 * second. Chain mail in a backpack protects nobody.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import {
  type CatalogueItem,
  itemChargePool,
  itemChargeRoll,
  itemStandingEffects,
  type ItemKind,
} from '../catalogue.js';
import { type Content } from '../content.js';
import {
  itemInstanceFor,
  type CreatureState,
  type GameEvent,
  type GameState,
  type InventoryLine,
} from '../events.js';
import { creatureOf, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import { once } from '../idempotency.js';
import { hasPool, remaining, type PoolDeclaration } from '../resources.js';

/** Everything this creature is carrying, by catalogue id. */
export function carrying(state: GameState, id: CharacterId): readonly InventoryLine[] {
  return creatureOf(state, id)?.inventory ?? [];
}

/** Money on hand, in copper. */
export function coinsOf(state: GameState, id: CharacterId): number {
  return creatureOf(state, id)?.coins ?? 0;
}

/**
 * How many of a kind of thing this creature has, copies with records of their
 * own included.
 *
 * Summed rather than looked up, because a kind of thing is no longer always
 * one line: two wands with charges of their own are two lines of one, and a
 * caller asking "do they have a wand" must not be told "one" when they have
 * two, nor "none" when the only line is labelled.
 */
export const quantityOf = (state: GameState, id: CharacterId, itemId: string): number =>
  carrying(state, id)
    .filter((line) => line.id === itemId)
    .reduce((total, line) => total + line.quantity, 0);

/**
 * The copy a caller means, where a name can mean a kind of thing or one of
 * them.
 *
 * Three answers, and each is the honest one. A name that matches a copy's own
 * id is that copy. A name that matches a kind of thing with one line is that
 * line — which is every mundane item and every single wand, so nothing a
 * caller wrote before copies had records has to change. A kind of thing with
 * several copies is a **question**, refused as a value with the copies named:
 * "spend a charge from a wand" cannot be answered when two wands are in the
 * pack and one of them is empty, and guessing would spend somebody's last
 * charge for them.
 *
 * `null` for a thing this creature does not have at all, so each caller gives
 * its own refusal for that — `not_owned` reads differently from `not_equipped`.
 */
export function copyNamed(creature: CreatureState, named: string): Result<InventoryLine | null> {
  const labelled = creature.inventory.find((line) => line.instance === named);
  if (labelled !== undefined) return ok(labelled);

  const lines = creature.inventory.filter((line) => line.id === named);
  if (lines.length === 0) return ok(null);
  if (lines.length === 1) return ok(lines[0]!);
  return err(
    'ambiguous_copy',
    `${creature.id} has ${lines.length} of ${named}, each with a record of its own (${lines
      .map((line) => line.instance ?? 'an unlabelled copy')
      .join(', ')}); name the one you mean`,
  );
}

/**
 * The kind of thing a name means: a copy's own id names the kind it is a copy
 * of.
 *
 * For the questions that are about the kind and not the copy — attunement is
 * a yes or no per kind of item — so that a caller holding a copy's id can ask
 * them without having to know which sort of id each command wants.
 */
const kindNamed = (creature: CreatureState, named: string): string =>
  creature.inventory.find((line) => line.instance === named)?.id ?? named;

/** Lines to gain, and the pools the copies among them arrive with. */
export interface IssuedCopies {
  readonly items: readonly InventoryLine[];
  readonly pools: readonly PoolDeclaration[];
}

/**
 * Split what is being handed over into stacks and copies, and size the copies'
 * pools.
 *
 * **The one place the decision is made**, because it is made at two doors: a
 * purchase and a character's starting equipment. Which of them a thing is,
 * is read from content here — an item with a charge pool has state of its own
 * and gets a record; everything else is a count — and the *presence* of the
 * record on the line is what the event pins, so the fold never asks the
 * question again.
 *
 * The pools come back beside the lines rather than being looked up later, for
 * the reason every other read of the catalogue in a command travels with its
 * event: a wand's three charges are what the book said on the day it was
 * handed over.
 *
 * `issued` is what the log has issued so far, so the ids are consecutive and
 * the fold can check them. Takes the count rather than the state because
 * creation has no state to take — it is producing the events that will make
 * one.
 *
 * **A copy whose count the book rolls is labelled and left unsized here.**
 * SRD Necklace of Fireballs has "1d6+3 beads", which is a number only a door
 * holding a generator can produce — so the copy gets its record and no pool
 * comes back for it, and the one door that can roll (`awardItems`) declares
 * it. Handing back the printed number instead would be the engine inventing a
 * count the book declined to print.
 */
export function issueItemCopies(
  issued: number,
  content: Content,
  requested: readonly InventoryLine[],
): IssuedCopies {
  const items: InventoryLine[] = [];
  const pools: PoolDeclaration[] = [];
  let next = issued;
  for (const line of requested) {
    const item = content.item(line.id);
    // A miss is not this function's to refuse — every caller has already
    // looked the item up, or is a caller who skipped a check somebody else
    // makes. It travels as the counted stack it was.
    if (item === null || itemChargePool(item) === null) {
      items.push(line);
      continue;
    }
    for (let copy = 0; copy < line.quantity; copy += 1) {
      next += 1;
      const instance = itemInstanceFor(next);
      items.push({ id: line.id, quantity: 1, instance });
      // Non-null: the item was just read as having one.
      if (itemChargeRoll(item) === null) pools.push(itemChargePool(item, instance)!);
    }
  }
  return { items, pools };
}

/** The same, against a state that knows how many records it has issued. */
const issueCopies = (
  state: GameState,
  content: Content,
  requested: readonly InventoryLine[],
): IssuedCopies => issueItemCopies(state.itemsIssued, content, requested);

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

    const bought = issueCopies(
      state,
      content,
      content.expandPack(itemId).map((line) => ({
        id: line.id,
        quantity: line.quantity * quantity,
      })),
    );

    return ok([
      {
        type: 'items-gained',
        id,
        items: bought.items,
        source: `bought ${quantity} × ${item.name}`,
        ...(stamp === null ? {} : { command: stamp }),
      },
      { type: 'coins-changed', id, copper: -price, source: `bought ${item.name}` },
      // The charges arrive with the copy, not with the hand it later reaches:
      // a wand bought and left in the pack is a wand with three charges in it,
      // and putting it down later does not empty it.
      ...bought.pools.map((pool) => ({ type: 'resource-pool-declared' as const, id, pool })),
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

    // Which copy, asked first: the name may be a kind of thing or one of them,
    // and an item's own id is not in the catalogue under that name.
    const named = copyNamed(creature, itemId);
    if (!named.ok) return named;
    const copy = named.value;

    const item = content.item(copy?.id ?? itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (!EQUIPPABLE.has(item.kind)) {
      return err('not_equippable', `${item.name} is carried, not worn or wielded`);
    }
    if (copy === null) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    // Per kind of thing and not per copy, which is the reading `equipped` has
    // always had: its readers ask what a creature is wearing, and two of one
    // wand in one pair of hands would be one item's grants counted twice.
    if (creature.equipped.some((held) => held.id === item.id)) {
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

    return ok([
      {
        type: 'item-equipped',
        id,
        item: item.id,
        // Pinned: what this item *is* travels with the event, so the fold
        // never has to open a catalogue to know what the creature wears.
        armor: item.armor,
        // And what it *grants*, for the same reason and by the same rule.
        // Omitted when there is nothing, so every mundane equip event is the
        // event it has always been.
        ...(grants.length === 0 ? {} : { grants }),
        // And which copy, where the copy has a record, so a charge comes out
        // of the wand in the hand rather than out of the kind of wand.
        ...(copy.instance === undefined ? {} : { instance: copy.instance }),
        ...(stamp === null ? {} : { command: stamp }),
      },
      /**
       * **And nothing else. A copy brought its charges with it**, declared at
       * the door it was gained through, which is what lets a wand be put down
       * and picked back up as spent as it was left.
       *
       * This used to declare a catalogue-keyed pool for an *unlabelled*
       * charged copy, because a hand-written `items-gained` was the only way
       * to put a wand in a hand and a wand with no charges at all would have
       * looked broken. That made two gain semantics, one of which quietly
       * shared a pool between every copy of a kind. `awardItems` is the door
       * that was missing; the branch went with its arrival, in the commit that
       * added it, and an unlabelled charged copy now has no pool — which
       * `expendCharges` says out loud rather than spending somebody else's
       * charges.
       */
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
    // By kind of thing or by copy, whichever the caller has to hand: only one
    // copy of a kind is ever in a pair of hands, so the two names find the
    // same thing and the event names the kind, as it always has.
    const held = creature.equipped.find((worn) => worn.id === itemId || worn.instance === itemId);
    if (held === undefined) {
      const item = content.item(itemId);
      return err('not_equipped', `${item?.name ?? itemId} is not worn or wielded`);
    }

    return ok([
      { type: 'item-unequipped', id, item: held.id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Which copy a charge question is about, given a kind of thing or a copy.
 *
 * The copy in hand first, because "while holding it" is the sentence every
 * charged item in the book prints and the held one is what a caller naming a
 * kind of thing almost always means. Failing that the one copy there is — so
 * a pack with a single wand answers to the wand's name — and failing *that*,
 * nothing, because two idle wands with different charges left cannot be
 * answered for as one.
 */
function copyAsked(creature: CreatureState, named: string): InventoryLine | null {
  const labelled = creature.inventory.find((line) => line.instance === named);
  if (labelled !== undefined) return labelled;
  const held = creature.equipped.find((worn) => worn.id === named)?.instance;
  if (held !== undefined) {
    return creature.inventory.find((line) => line.instance === held) ?? null;
  }
  const lines = creature.inventory.filter((line) => line.id === named);
  return lines.length === 1 ? lines[0]! : null;
}

/**
 * Charges left in an item this creature has held, or 0.
 *
 * Zero for an item that has no charges at all and for one whose pool nobody
 * has declared yet, on the same rule `remaining` follows: a pool nobody
 * declared has none, rather than throwing. Zero, too, for a kind of thing
 * this creature has several idle copies of, which is a question with no
 * single answer — name the copy and it has one.
 *
 * **Held, rather than still holding.** The pool outlives both `unequipItem`
 * and `loseItems`, which is deliberate for the first — putting a wand down
 * does not empty it, and it is the wand's pool now rather than the wand
 * kind's, so picking it back up finds it where it was left. For the second it
 * is a pool nobody can reach any more: a wand taken by a thief leaves a record
 * behind that nothing in this creature's inventory names, and the copy the
 * thief holds keeps its own. `expendCharges` is the guard that matters, and it
 * asks whether the thing is in hand; this answers about a pool, and says so.
 */
export function chargesLeft(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
): number {
  const creature = creatureOf(state, id);
  if (creature === null) return 0;
  const copy = copyAsked(creature, itemId);
  const item = content.item(copy?.id ?? itemId);
  const pool = item === null ? null : itemChargePool(item, copy?.instance);
  if (pool === null) return 0;
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

    // Which copy, before the catalogue: a copy's own id is not a catalogue id,
    // and the answer decides which pool is spent from.
    const named = copyNamed(creature, itemId);
    if (!named.ok) return named;
    const copy = named.value;

    const item = content.item(copy?.id ?? itemId);
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);

    const held = creature.equipped.find((worn) => worn.id === item.id);
    // Keyed by the copy in hand, which is the whole of what an item's record
    // buys: the charges spent are the held wand's and not the other one's.
    const pool = itemChargePool(item, held?.instance);
    if (pool === null) return err('no_charges', `${item.name} has no charges to spend`);

    if (held === undefined) {
      return err('not_equipped', `${item.name}'s charges are spent while holding it, and ${id} is not`);
    }
    if (copy !== null && copy.instance !== undefined && held.instance !== copy.instance) {
      return err(
        'not_equipped',
        `${copy.instance} is not the ${item.name} in ${id}'s hand, and charges are spent while holding it`,
      );
    }
    if (item.attunement !== undefined && !creature.attuned.some((worn) => worn.id === item.id)) {
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
       * A copy's pool arrives **with the copy**, so this is what is left when
       * the item reached this hand by a route that declared none.
       *
       * **Every route that labels a copy declares one.** `awardItems` declares
       * it as the DM hands the copy over — rolling the count for an item whose
       * line rolls it — `purchaseItem` declares it as the copy is bought, and
       * `createCharacter` declares it for anything a character is born owning.
       * What is left for this to catch is a copy nobody labelled: a
       * hand-written `items-gained`, and a rolled count gained through a door
       * that could not roll it. Neither has a pool, and neither may borrow one
       * from another copy — so the refusal names the door that works rather
       * than letting the wand look merely empty.
       */
      return err(
        'unknown_pool',
        `nothing has declared ${item.name}'s charges for ${id}; a copy's charges are declared when it is gained, so hand it over with awardItems`,
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

    // Attunement is a yes or no per kind of item, so a copy's own id is read
    // as the kind it is a copy of rather than refused for not being one.
    const item = content.item(kindNamed(creature, itemId));
    if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);
    if (item.attunement === undefined) {
      return err('no_attunement', `${item.name} works for anybody holding it; nothing to attune`);
    }
    // "While being in physical contact with it": owning it is the engine's
    // reading of that, rather than wearing it — you attune to a ring by
    // holding it, and the benefit is what asks to be worn.
    if (quantityOf(state, id, item.id) < 1) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    if (creature.attuned.some((held) => held.id === item.id)) {
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
        item: item.id,
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
    const kind = kindNamed(creature, itemId);
    if (!creature.attuned.some((held) => held.id === kind)) {
      const item = content.item(kind);
      return err('not_attuned', `${id} is not attuned to ${item?.name ?? itemId}`);
    }

    return ok([
      { type: 'attunement-ended', id, item: kind, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

