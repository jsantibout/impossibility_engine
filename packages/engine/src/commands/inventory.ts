/**
 * What a creature owns, what it is wearing, and what it can buy.
 *
 * Owning and wearing are two facts: `inventory` is everything carried,
 * `equipped` is the subset worn or wielded, and Armour Class reads only the
 * second. Chain mail in a backpack protects nobody.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
import {
  type CatalogueItem,
  handsFor,
  instancedPoolKeys,
  itemChargePool,
  itemChargeRoll,
  itemStandingEffects,
  type ItemKind,
} from '../catalogue.js';
import {
  groundItems,
  groundItemsWithin,
  placeItemOnGround,
  type GroundPile,
  type Placement,
} from '../positioning.js';
import { handsOf } from '../character.js';
import { type Content } from '../content.js';
import { type ConjuredItems } from '../spell-definitions.js';
import {
  applyEvent,
  itemInstanceFor,
  type CreatureState,
  type GameEvent,
  type GameState,
  type InventoryLine,
} from '../events.js';
import { actionRulesOn, standingFor } from '../standing.js';
import { refuseObjectHandling } from '../combat.js';
import { anchorNeeded, creatureOf, sceneFor, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import { once } from '../idempotency.js';
import { hasPool, remaining, type PoolDeclaration } from '../resources.js';
import { oneLargerThan } from './unarmed.js';

/**
 * Everything this creature is carrying, by catalogue id.
 *
 * **A conjured line is here only while its casting is.** SRD Goodberry:
 * "Uneaten berries disappear when the spell ends." That is derived rather than
 * folded, on the reading a patch of Difficult Terrain naming a casting already
 * takes — a casting that runs out of time writes no event, so a removal hung
 * on one would miss the commonest way a spell ends. See
 * {@link InventoryLine.casting}.
 */
export function carrying(state: GameState, id: CharacterId): readonly InventoryLine[] {
  const creature = creatureOf(state, id);
  return creature === null ? [] : creature.inventory.filter((line) => stillThere(state, line));
}

/**
 * Whether a line is still a thing the creature has.
 *
 * True of everything owned. False only of a conjured line whose casting has
 * ended — dispelled, released, Concentration broken, or simply run out.
 */
const stillThere = (state: GameState, line: InventoryLine): boolean =>
  line.casting === undefined || state.ongoing[line.casting] !== undefined;

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
export function copyNamed(
  state: GameState,
  creature: CreatureState,
  named: string,
): Result<InventoryLine | null> {
  // The live view, for the reason `carrying` is one: a berry whose spell has
  // ended is not a berry anybody can eat, and finding it here would be finding
  // something that is not there.
  const held = creature.inventory.filter((line) => stillThere(state, line));
  const labelled = held.find((line) => line.instance === named);
  if (labelled !== undefined) return ok(labelled);

  const lines = held.filter((line) => line.id === named);
  if (lines.length === 0) return ok(null);
  if (lines.length === 1) return ok(lines[0]!);
  return err(
    'ambiguous_copy',
    // **Each named where it has a name**, which is not every line any more: a
    // conjured thing of one carries a record and the Longsword bought beside
    // it does not, so "each with a record of its own" would be a sentence the
    // list under it contradicts.
    `${creature.id} has ${lines.length} of ${named}, named where they have a name (${lines
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
 * Money in or out, for a reason that is not a purchase.
 *
 * **The other direction of `purchaseItem`**, and until this existed there was
 * none: `coins-changed` has always been signed and the fold has always taken
 * a delta either way, but the only two things that ever wrote one were
 * `createCharacter` and a purchase, and a purchase only ever wrote a negative
 * one. A party's money was therefore whatever it was born with and could only
 * go down — so the shops this engine prices in full were reachable exactly
 * once, by whoever started rich.
 *
 * **One command rather than two, because the log has one signed event.** A
 * grant and a levy are the same fact with the sign flipped, and splitting them
 * here would invent an asymmetry `coins-changed` does not have. The two doors
 * a DM sees are a surface's business, the way `awardItems` and `loseItems`
 * are two doors onto two genuinely different events.
 *
 * And a purchase cannot stand in for the negative direction: a toll buys no
 * item, a bribe has no catalogue row and a thief leaves no receipt, while
 * `purchaseItem` refuses an id the catalogue does not hold. There is no
 * fiction to buy.
 *
 * **The overdraw is refused here and never by the fold.** The reducer throws
 * `CorruptLogError` on a purse below zero, which is the right answer to a log
 * that has been corrupted and the wrong answer to a DM who named a bigger
 * bribe than the party can pay. That is `cannot_afford`'s argument exactly,
 * one command along.
 *
 * Copper, because that is what the purse is counted in and what a price is
 * quoted in. A caller who thinks in gold converts at its own door, where
 * `COPPER_PER` names every coin the book prints.
 */
export function changeCoins(
  state: GameState,
  id: CharacterId,
  copper: number,
  source: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; copper: number; source: string } =
    commandId === undefined ? { copper, source } : { commandId, copper, source };
  return once(state, `change-coins:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    // Zero is refused rather than accepted as a no-op: money that did not move
    // should not be a line in the log, and a caller who sent it meant
    // something it did not say.
    if (!Number.isInteger(copper) || copper === 0) {
      return err(
        'bad_amount',
        `coin moves by a whole number of copper pieces, one way or the other, got ${copper}`,
      );
    }

    if (creature.coins + copper < 0) {
      return err(
        'not_enough_coin',
        `${source} would take ${-copper} copper and ${id} has ${creature.coins}`,
      );
    }

    return ok([
      {
        type: 'coins-changed',
        id,
        copper,
        source,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

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

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." One reader for every
    // command that puts a hand on a thing — see `refuseObjectHandling`.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;

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

    // **And whether there are shoulders for it.** After the price, because a
    // character who cannot afford it never had to lift it, and before the
    // event, because the log should not hold a purchase that could not be
    // carried home.
    const room = wouldOvercarry(state, content, id, bought.items);
    if (!room.ok) return room;

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
const ATTUNEMENT_LIMIT = 3;

/**
 * How many of this creature's hands are full.
 *
 * Two things fill a hand and they are counted the same way: what is
 * **equipped**, whose cost is the item's own (`handsFor`), and what a casting
 * **conjured** into a hand, whose cost was pinned on the line when it appeared
 * — because a handful of ten berries is one hand and `handsFor` would charge
 * ten.
 *
 * Content is read here rather than in the fold, exactly as `equipItem` reads
 * it: this is a question a command asks, and the answer is the catalogue as it
 * stands today.
 */
export function handsInUse(state: GameState, content: Content, id: CharacterId): number {
  const creature = creatureOf(state, id);
  if (creature === null) return 0;

  const wielded = creature.equipped.reduce((total, worn) => {
    const item = content.item(worn.id);
    return total + (item === null ? 0 : handsFor(item));
  }, 0);
  // A conjured line, whichever kind of magic put it there: a casting's
  // handful, or the weapon a feature's activation made. Both pinned their own
  // hand count at the moment they appeared — see `conjuredLine` and
  // `featureConjuredLine` — and in a log **this engine writes** neither is in
  // `equipped`, because `equipItem` refuses `already_in_hand` for exactly this
  // arithmetic. That is what makes adding them to the worn total right rather
  // than double-counting.
  //
  // A log assembled by hand can put one in both, and then this charges the
  // hands twice. Said rather than guarded, because the alternative is worse:
  // counting the larger of the two would make a Warlock holding a Greatsword
  // and a conjured Glaive out of six hands' worth of gear look as though they
  // had four free, and there is no reading of `equipped` that can tell a
  // wielding written beside a conjured line from one written instead of it.
  // The door is the rule; this is arithmetic over what the door let through.
  const conjured = carrying(state, id).reduce(
    (total, line) =>
      total + (line.casting === undefined && line.feature === undefined ? 0 : (line.hands ?? 0)),
    0,
  );
  return wielded + conjured;
}

/**
 * How many hands this creature has free.
 *
 * Never below zero: a log may put more in a creature's hands than it has —
 * `createCharacter` equips a starting package without asking, and a stat block
 * may print three weapons — and the honest answer to "how many are free" is
 * none rather than a negative number nothing could interpret.
 */
export function freeHands(state: GameState, content: Content, id: CharacterId): number {
  const creature = creatureOf(state, id);
  if (creature === null) return 0;
  return Math.max(0, handsOf(creature.sheet) - handsInUse(state, content, id));
}

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

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." One reader for every
    // command that puts a hand on a thing — see `refuseObjectHandling`.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;

    // Which copy, asked first: the name may be a kind of thing or one of them,
    // and an item's own id is not in the catalogue under that name.
    const named = copyNamed(state, creature, itemId);
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
    // **And a conjured thing is already in a hand**, which is the whole of
    // what a conjuring is: SRD Flame Blade evokes a blade "in your free hand"
    // and SRD Pact of the Blade conjures a pact weapon "in your hand". The
    // hands it takes up were charged when it appeared and are pinned on the
    // line, so equipping it is not a second thing anybody can do — and
    // `handsInUse`, which counts the line's own hands beside what is worn,
    // would charge a second pair for one blade. Told apart by the pinned count
    // rather than by which magic made it, so both conjurings answer alike.
    if (copy.hands !== undefined) {
      return err(
        'already_in_hand',
        `${item.name} was conjured into ${id}'s hand and is in it; there is nothing to take up`,
      );
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

    // **And whether there is a hand for it**, which nothing asked until now:
    // a creature could wield a Greatsword, a Longsword and a Shield at once.
    // The equipment architecture recorded the gap in as many words —
    // "Nothing checks that two hands are free, either." — and this is the
    // check. SRD Two-Handed: "this weapon requires two hands"; a Shield is
    // wielded in one; and what a spell put in a hand is in that hand too.
    const wants = handsFor(item);
    const free = freeHands(state, content, id);
    if (wants > free) {
      return err(
        'no_free_hand',
        `${item.name} takes ${handCount(wants)} and ${id} has ${free === 0 ? 'none' : handCount(free)} free`,
      );
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

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." One reader for every
    // command that puts a hand on a thing — see `refuseObjectHandling`.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;
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

/** "one hand" and "two hands", so a refusal reads like the book. */
const handCount = (hands: number): string => `${hands === 1 ? 'one hand' : `${hands} hands`}`;

/**
 * What a casting conjured into this creature's hands, and which casting it was.
 *
 * Asked by both halves below and by the resolution that creates one. A
 * conjured line names its casting, so this is a filter rather than a search —
 * and it reads the live view, so a handful whose spell has ended is not here
 * to be let go of twice.
 */
export function conjuredHolds(
  state: GameState,
  id: CharacterId,
): readonly { readonly line: InventoryLine; readonly castingId: string }[] {
  return carrying(state, id)
    .filter((line) => line.casting !== undefined)
    .map((line) => ({ line, castingId: line.casting! }));
}

/**
 * Let go of a conjured thing: it disappears, and the casting runs on.
 *
 * SRD Flame Blade: "If you let go of the blade, it disappears, but you can
 * evoke the blade again as a Bonus Action." Two facts in one sentence, and
 * this is the first: the thing leaves the hand and ceases to exist, while the
 * spell it came from is untouched — the Concentration holds, the duration runs,
 * and {@link evokeConjured} is the way back.
 *
 * **It costs nothing.** SRD spends no action on letting go of anything;
 * dropping a held item is free in the same way sheathing is not, and the book
 * prices only the taking up.
 *
 * Refused for anything no casting conjured, because there is no rule here for
 * an ordinary thing put down: a dropped Longsword is on the floor, and a floor
 * is not something this engine holds.
 */
export function dropConjured(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
  commandId?: string,
): Result<GameEvent[]> {
  const inputs: { commandId?: string; itemId: string } =
    commandId === undefined ? { itemId } : { commandId, itemId };
  return once(state, `drop-conjured:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const held = conjuredHolds(state, id).find(
      (conjured) => conjured.line.id === itemId || conjured.line.instance === itemId,
    );
    if (held === undefined) {
      const item = content.item(itemId);
      return err(
        'not_conjured',
        `no casting of ${id}'s put ${item?.name ?? itemId} in their hand; only a conjured thing disappears when it is let go of`,
      );
    }

    return ok([
      {
        type: 'items-lost',
        id,
        // The whole handful: SRD's sentence is about the thing in the hand,
        // and half a blade is not a state the book describes.
        //
        // **And which copy, where the conjuring named one.** A line with a
        // record is merged under that record and nothing else, so a loss that
        // named only the kind and the casting would find no line to take, be
        // filtered away by the `quantity > 0` rule, and leave the blade in the
        // hand — which is the silent removal `leavingIsNamed` exists to refuse.
        items: [
          {
            id: held.line.id,
            quantity: held.line.quantity,
            casting: held.castingId,
            ...(held.line.instance === undefined ? {} : { instance: held.line.instance }),
          },
        ],
        source: `${content.item(held.line.id)?.name ?? held.line.id}, let go of`,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/** What {@link evokeConjured} is asked. */
export interface EvokeConjuredCommand {
  /** The conjured thing to take up again, by catalogue id. */
  readonly item: string;
  readonly commandId?: string;
}

/**
 * Evoke a conjured thing again, into a hand that is free.
 *
 * The other half of SRD Flame Blade's sentence: "you can evoke the blade again
 * as a Bonus Action." The action is the **spell's**, read off the definition
 * that conjured it (`ConjuredItems.retake`), because the book prices it per
 * spell and a spell that does not print the clause cannot be asked for one.
 *
 * Everything else is the ordinary rules: the casting must still be running,
 * there must be a hand for it, and a thing already in hand is refused rather
 * than conjured twice.
 */
export function evokeConjured(
  state: GameState,
  id: CharacterId,
  command: EvokeConjuredCommand,
  supply: { readonly content: Content },
): Result<GameEvent[]> {
  return once(state, `evoke-conjured:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const holding = mayAct(state, id);
    if (holding !== null) return holding;

    const content = supply.content;
    const item = content.item(command.item);
    if (item === null) return err('unknown_item', `${command.item} is not in the catalogue`);

    if (conjuredHolds(state, id).some((conjured) => conjured.line.id === command.item)) {
      return err('already_held', `${item.name} is already in ${id}'s hand`);
    }

    // Which casting of this creature's conjures it — read from the definitions
    // its own ongoing castings name, so a blade is re-evoked out of the spell
    // that made it and not out of somebody else's.
    const from = Object.values(state.ongoing)
      .filter((casting) => casting.caster === id)
      .map((casting) => ({ casting, conjures: content.spell(casting.spellId)?.conjures }))
      .find((held) => held.conjures?.item === command.item);
    if (from === undefined || from.conjures === undefined) {
      return err(
        'not_conjured',
        `no spell ${id} is concentrating on conjures ${item.name}; it is evoked by casting the spell rather than by taking it up`,
      );
    }
    if (from.conjures.retake === undefined) {
      return err(
        'not_re_evoked',
        `${from.casting.spell} does not print a clause for evoking ${item.name} again once it is let go of`,
      );
    }

    const hands = conjuredHands(from.conjures);
    const free = freeHands(state, content, id);
    if (hands > free) {
      return err(
        'no_free_hand',
        `${item.name} takes ${handCount(hands)} and ${id} has ${free === 0 ? 'none' : handCount(free)} free`,
      );
    }

    const events: GameEvent[] = [];
    // The economy only exists in combat, exactly as a potion and a feature find.
    if (state.combat !== null) {
      const spent = spendFor(state, id, from.conjures.retake);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    events.push({
      type: 'items-gained',
      id,
      items: [conjuredLine(state.itemsIssued, item.id, from.conjures, from.casting.castingId)],
      source: `${from.casting.spell}, evoked again`,
      ...(stamp === null ? {} : { command: stamp }),
    });
    return ok(events);
  });
}

/**
 * What a creature can carry, and what it can drag, lift or push.
 *
 * SRD Rules Glossary, "Carrying Capacity": "Your size and Strength score
 * determine the maximum weight in pounds that you can carry, as shown in the
 * Carrying Capacity table. The table also shows the maximum weight you can
 * drag, lift, or push." The printed table is Str × 15 and Str × 30 for
 * Small/Medium, half of each for Tiny, and a doubling for every size above —
 * so it is one multiplier per size rather than two columns of numbers.
 *
 * The drag figure is computed beside the carry figure because the SRD prints
 * them together and the sentence that uses it is one line further on: "While
 * dragging, lifting, or pushing weight in excess of the maximum weight you can
 * carry, your Speed can be no more than 5 feet." Nothing spends it yet; it is
 * here so that the rule it belongs to is not two reads of a table apart.
 */
const CAPACITY_BY_SIZE: Readonly<Record<CreatureSize, number>> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
};

/** SRD: Small and Medium carry Strength × 15, and drag, lift or push twice that. */
const POUNDS_PER_STRENGTH = 15;

export interface CarryingCapacity {
  readonly carry: number;
  readonly dragLiftPush: number;
}

/**
 * The two numbers the table prints for this creature.
 *
 * Derived on every read rather than stored, for the reason `standing.ts`
 * insists a conditional benefit must be: a Strength that moves — a level-up, a
 * Belt of Giant Strength, a Reduce that makes somebody Small — moves what they
 * can carry in the same instant, and a stored copy would be last week's
 * shoulders.
 *
 * A creature nobody has added has no Strength to read, and answers zero of
 * both rather than throwing: the callers here have all looked the creature up
 * already, and a reader that threw would be a reader a tool surface could not
 * ask a speculative question of.
 */
export function carryingCapacity(state: GameState, id: CharacterId): CarryingCapacity {
  const creature = creatureOf(state, id);
  if (creature === null) return { carry: 0, dragLiftPush: 0 };
  const strength = creature.sheet.abilities.str;
  // **SRD Powerful Build: "you count as one size larger when determining your
  // carrying capacity."** The step is applied to the row of the table this
  // creature reads, and to nothing else about it: it still occupies its own
  // space, is still grappled by the same sizes and still squeezes through the
  // same gaps, because the sentence is about this table and says so. Derived
  // on every read, so a creature the table has since made Large reads the row
  // above the one it is on now rather than the one it was born on.
  const size = capacitySizeOf(state, id, creature.size ?? 'medium');
  const carry = strength * POUNDS_PER_STRENGTH * CAPACITY_BY_SIZE[size];
  return { carry, dragLiftPush: carry * 2 };
}

/**
 * The row of the Carrying Capacity table this creature reads, which is not
 * always the size it is.
 *
 * The steps of every `carrying-capacity` grant it holds, summed rather than
 * maximised: two sentences that each said "one size larger" are two steps, and
 * `oneLargerThan` applied twice is what that means. Gargantuan is its own
 * answer, so a step past the top of the list is not an error.
 */
function capacitySizeOf(state: GameState, id: CharacterId, own: CreatureSize): CreatureSize {
  let steps = 0;
  for (const { effect } of standingFor(state, id)) {
    if (effect.grant.kind === 'carrying-capacity') steps += effect.grant.sizesLarger;
  }
  let size = own;
  for (let taken = 0; taken < steps; taken++) size = oneLargerThan(size);
  return size;
}

/** What a creature is carrying, and how much of it nobody has weighed. */
export interface CarriedWeight {
  /** Pounds, summed over every line the catalogue prints a weight for. */
  readonly pounds: number;
  /**
   * How many *things* are on lines the catalogue prints no weight for.
   *
   * **Null is "nobody has said", not zero**, and 56 of the SRD catalogue's 401
   * items are null — every magic item among them, and the three generic focus
   * placeholders. Adding them in as weightless would make the sum a claim the
   * book never made, and a refusal would then be made on it. So they are
   * counted here instead, beside the sum, and the number travels into the
   * refusal's own reason: what the engine knows is a **lower bound**, and a
   * bound that is too low can only ever under-refuse.
   */
  readonly unweighed: number;
}

/**
 * Add up what a creature is carrying.
 *
 * Over `carrying` rather than over the raw inventory, so a conjured handful
 * whose spell has ended weighs nothing — it is not there. Equipped items are
 * carried too, which is the whole of the distinction `equipped` draws: chain
 * mail worn and chain mail in the pack weigh the same, and only one of them is
 * Armour Class.
 */
export function carriedWeight(
  state: GameState,
  content: Content,
  id: CharacterId,
): CarriedWeight {
  let pounds = 0;
  let unweighed = 0;
  for (const line of carrying(state, id)) {
    const weight = content.item(line.id)?.weightLb ?? null;
    if (weight === null) unweighed += line.quantity;
    else pounds += weight * line.quantity;
  }
  return { pounds, unweighed };
}

/**
 * Whether taking this much more on is more than this creature could lift.
 *
 * **Which of the two printed numbers is a ceiling is the whole of this
 * function, and the SRD does not simply say.** What it says is that the rule
 * is the GM's to invoke: "You can usually carry your gear and treasure without
 * worrying about the weight of those objects. If you try to haul an unusually
 * heavy object or a massive number of lighter objects, the GM **might** require
 * you to abide by the rules for carrying capacity." There is nowhere in this
 * engine to hold "this table has turned capacity on", and inventing one is a
 * primitive nobody has asked for — so the refusal has to stand where **every**
 * reading agrees, and that is the printed Drag/Lift/Push maximum. Picking
 * something up is lifting it and buying something is walking out with it, so
 * both are measured there.
 *
 * Refusing at the Carry column instead was the first draft and it was wrong in
 * a way worth recording, because it looked right: the SRD's own starting
 * bundles are heavier than the SRD's own Carry figure for a low-Strength
 * class — a canonical Bard's kit against a Strength-8 Bard's number, pinned
 * exactly in `carrying-capacity.test.ts` rather than quoted here — so an
 * engine that refused there shipped two doors that were dead for a character
 * it had just minted itself. That is the reading the book hands the GM a
 * switch to avoid, and the switch is the thing that is missing.
 *
 * **The half this does not build, and whose it is.** Nothing yet caps the
 * Speed of a creature between the two numbers. Speed modifiers are
 * `standing.ts`'s and `speed-modifier-granted`'s, which is another track's
 * region; `carryingCapacity` returns both figures so that the rule is one read
 * away when somebody owns it.
 *
 * **Where it is asked, and where it deliberately is not.** A character buying
 * something and a character bending down for something are both the character
 * taking weight on. A **DM's declaration** is not: `awardItems` is the table
 * saying what the party found and `transferItem` is one creature handing
 * another something, and both are facts about the world that a rule about
 * shoulders does not get to veto — the same division `DECLARED_NOT_ACTED`
 * already draws in `invariants.test.ts`. Nor is `equipItem`, because putting on
 * armour you already own changes nothing about what you are carrying; the
 * hands are what that door asks about.
 *
 * **And it is only ever made on weight somebody has stated.** An unweighed
 * line adds nothing, so the bound is low and can only ever under-refuse.
 */
function wouldOvercarry(
  state: GameState,
  content: Content,
  id: CharacterId,
  gaining: readonly InventoryLine[],
): Result<null> {
  const capacity = carryingCapacity(state, id);
  const held = carriedWeight(state, content, id);
  let taking = 0;
  for (const line of gaining) {
    const weight = content.item(line.id)?.weightLb ?? null;
    if (weight !== null) taking += weight * line.quantity;
  }
  if (held.pounds + taking <= capacity.dragLiftPush) return ok(null);
  return err(
    'over_capacity',
    `${id} can lift ${capacity.dragLiftPush} lb and is already carrying ${held.pounds} lb${
      held.unweighed === 0 ? '' : ` plus ${held.unweighed} thing(s) nobody has weighed`
    }; another ${taking} lb is more than they could pick up — put something down first`,
  );
}

/**
 * SRD's arm's length: "you can interact with an object within 5 feet of you".
 *
 * A number rather than a read off the creature, because reach is a *weapon's*
 * property in this engine and an empty hand has none. A Huge creature still
 * reaches from its own volume, which is what `groundItemsWithin` measures
 * from — so a dragon lying across four squares picks up what is beside any of
 * them, without anybody having to model an arm.
 */
const ARMS_REACH = 5;

/** What {@link dropItem} is asked. */
export interface DropItemCommand {
  /** Catalogue id, or a copy's id where the copies are told apart. */
  readonly item: string;
  /** How many. The whole line if it is left out. */
  readonly quantity?: number;
  /** Where it lands. The dropper's own square if it is left out. */
  readonly placement?: Placement;
  readonly commandId?: string;
}

/**
 * Put something down. It leaves the pack and lies in the room.
 *
 * **The case `dropConjured` refused in as many words**: "a dropped Longsword is
 * on the floor, and a floor is not something this engine holds." It is now. Two
 * thirds of "where objects are" were already here — a table is a landmark, and
 * what somebody holds is in their square by construction, because a held thing
 * is a line on a creature and the creature has the placement. The missing case
 * was the thing in nobody's inventory.
 *
 * **Which copy is the whole of the work**, and the owner has ruled on it. A
 * weapon is a *catalogue* id, so "my sword on the floor" cannot be told from
 * the identical sword still in the pack; the engine already issues a record to
 * a copy with state of its own, and a dropped item **gets one if it does not
 * already have one**. A copy that has one keeps it, and its charges go down
 * with it — "one put down keeps what it had left".
 *
 * **It costs nothing**, on `dropConjured`'s reading of the same silence: the
 * SRD prices the taking up and not the letting go. Neither half spends the
 * turn's free object interaction, because `useFreeObjectInteraction` is its own
 * command and every other item command — `equipItem`, `unequipItem`,
 * `dropConjured` — leaves that allowance to whoever is having the turn.
 *
 * Refused for what a spell conjured, because a conjured thing disappears rather
 * than landing, and for what is worn or wielded, on `loseItems`' rule and for
 * its reason: `equipped` is a separate fact, so a dropped shield would go on
 * adding its Armour Class from the floor.
 */
export function dropItem(
  state: GameState,
  content: Content,
  id: CharacterId,
  command: DropItemCommand,
): Result<GameEvent[]> {
  return once(state, `drop-item:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." One reader for every
    // command that puts a hand on a thing — see `refuseObjectHandling`.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;

    const scene = sceneFor(state, id, `${id} to put something down in`);
    if (!scene.ok) return scene;

    const named = copyNamed(state, creature, command.item);
    if (!named.ok) return named;
    const copy = named.value;
    if (copy === null) {
      return err('not_owned', `${id} does not have ${content.item(command.item)?.name ?? command.item}`);
    }

    // A conjured thing has a door of its own and a different ending: it
    // disappears, and the casting runs on.
    if (copy.casting !== undefined) {
      return err(
        'conjured',
        `${copy.id} is held by a casting rather than carried; a conjured thing disappears when it is let go of, which is dropConjured`,
      );
    }

    const quantity = command.quantity ?? copy.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return err('bad_quantity', `a drop puts down a positive whole number, got ${quantity}`);
    }
    if (quantity > copy.quantity) {
      return err('not_owned', `${id} has ${copy.quantity} of ${copy.id}, not ${quantity}`);
    }

    /**
     * **What is in the hand stays in the hand, and only what is in the hand.**
     *
     * `equipped` is a fact of its own — `items-lost` does not touch it — so a
     * dropped shield would go on adding its Armour Class from the floor.
     * That is `loseItems`' rule and this is the same one.
     *
     * Counted rather than asked of the *kind*, which is the correction: a
     * barbarian holding one of four handaxes may put the spares down, and a
     * guard that found any equipped line under the id vetoed the whole stack.
     * An unlabelled equipped line answers for one copy, because that is all a
     * pair of hands ever holds of a kind — `equipItem` refuses a second — so
     * what must survive the drop is one per equipped line.
     */
    const inHand = creature.equipped.filter(
      (worn) =>
        worn.id === copy.id && (worn.instance === undefined || worn.instance === copy.instance),
    ).length;
    if (copy.quantity - quantity < inHand) {
      return err(
        'equipped',
        `${id} is wielding ${inHand} of their ${copy.quantity} ${copy.id}; putting down ${quantity} would drop what is in hand — take it off first`,
      );
    }

    // At their feet unless the caller names somewhere established. Never a
    // coordinate: the anchor is the dropper, a landmark or another creature,
    // exactly as a creature's own placement is.
    const placement: Placement = command.placement ?? { from: { creature: id }, feet: 0 };
    const instance = copy.instance ?? itemInstanceFor(state.itemsIssued + 1);

    // The refusal is `placeItemOnGround`'s, surfaced rather than restated —
    // and the anchor's own two missing facts get the requests that settle them.
    const lands = placeItemOnGround(
      scene.value,
      instance,
      { item: copy.id, quantity },
      placement,
    );
    if (!lands.ok) {
      return anchorNeeded(lands, placement.from, `${copy.id} is being put down relative to it`);
    }

    // Everything keyed to this copy goes down with it. Only a copy that
    // already had a record can have any: a record minted by this drop is one
    // nothing has ever been keyed to.
    const pools =
      copy.instance === undefined
        ? []
        : instancedPoolKeys(Object.keys(creature.resources.pools), copy.instance);

    return ok([
      {
        type: 'item-dropped',
        id,
        item: copy.id,
        quantity,
        instance,
        placement,
        ...(pools.length === 0 ? {} : { pools }),
        source: `${content.item(copy.id)?.name ?? copy.id}, put down`,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * What a forced drop did, or could not do.
 *
 * Two answers rather than one boolean, because the caller has a second clause
 * to run when the first could not happen — SRD Heat Metal's "if it can",
 * followed by "if it doesn't drop the object". A caller that got only the
 * events could not tell a thing let go of from a thing that never could be.
 */
export interface ForcedDrop {
  /** Whether the thing actually left the creature's hands. */
  readonly dropped: boolean;
  readonly events: readonly GameEvent[];
}

/**
 * Take a thing out of a creature's hands against its will.
 *
 * > SRD Heat Metal: "the creature must succeed on a Constitution saving throw
 * > or **drop the object if it can**."
 *
 * The half of `what-a-creature-is-holding` that was missing: hands are counted
 * and a casting may put a thing *into* one, and nothing took one out.
 * `dropConjured` is the door for a conjured thing, which ceases to exist and
 * refuses everything else by name; this is the ordinary object, which has to
 * land somewhere.
 *
 * **It is two commands and not a third way to write their events.** A thing in
 * a hand is both owned and equipped, and {@link dropItem} refuses to put down
 * what is still in hand — "take it off first" — so the drop is
 * {@link unequipItem} and then that refusal satisfied. Writing the two events
 * here instead would be a second spelling of two rules, and the placement, the
 * pile on the floor and the pools that travel with a labelled copy are all
 * `dropItem`'s.
 *
 * **"If it can" is a count of hands.** `handsFor` answers it off the printed
 * record: a weapon or a shield is wielded and can be let go of, body armour is
 * worn and comes off with a doffing no spell grants. A creature that is not
 * holding the thing at all is the same answer — nothing was dropped — and the
 * caller's second clause runs.
 *
 * Neither call carries a command id: this runs **inside** another command's
 * batch, which has its own identity, and a second one here would be a second
 * name for one thing.
 */
export function forcedDrop(
  state: GameState,
  content: Content,
  id: CharacterId,
  itemId: string,
): Result<ForcedDrop> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const kind = kindNamed(creature, itemId);
  const item = content.item(kind);
  if (item === null) return err('unknown_item', `${itemId} is not in the catalogue`);

  const held = creature.equipped.find((worn) => worn.id === kind);
  if (held === undefined || handsFor(item) === 0) return ok({ dropped: false, events: [] });

  const off = unequipItem(state, content, id, kind);
  if (!off.ok) return off;
  const bare = off.value.reduce(applyEvent, state);

  const down = dropItem(bare, content, id, { item: kind, quantity: 1 });
  if (!down.ok) return down;

  return ok({ dropped: true, events: [...off.value, ...down.value] });
}

/** What {@link takeItemUp} is asked. */
export interface TakeItemUpCommand {
  /** The pile's own id, or the catalogue id where one pile in reach answers to it. */
  readonly item: string;
  readonly commandId?: string;
}

/**
 * Pick a pile up off the floor, whole.
 *
 * The other half, and the half that needs a place: a thing on the ground is
 * somewhere, so taking it up asks where the taker is standing and whether they
 * can reach it. Out of reach is a **verdict** — walking over is a move the
 * caller makes, not a fact it declares — while nobody having placed the taker
 * is homework, because a creature standing nowhere is not a creature standing
 * far away.
 *
 * **Which pile** takes `copyNamed`'s three answers, read off the floor rather
 * than off a pack: a pile's own id is that pile, a kind of thing with one pile
 * in reach is that pile, and a kind with several is a question — two javelins
 * on the ground are two piles and guessing would pick up somebody else's.
 *
 * Hands are not asked for, and deliberately: picking something up puts it in
 * the pack, not in a hand. `equipItem` is what asks for a hand, and it asks
 * the same question of a thing taken off the floor as of a thing bought.
 */
export function takeItemUp(
  state: GameState,
  content: Content,
  id: CharacterId,
  command: TakeItemUpCommand,
): Result<GameEvent[]> {
  return once(state, `take-item-up:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." One reader for every
    // command that puts a hand on a thing — see `refuseObjectHandling`.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;

    const scene = sceneFor(state, id, `${id} to pick something up in`);
    if (!scene.ok) return scene;

    const near = groundItemsWithin(scene.value, id, ARMS_REACH);
    if (!near.ok) {
      return near.code === 'unplaced'
        ? needsContext(near.code, near.reason, [
            {
              kind: 'position',
              subject: id,
              need: `where ${id} is standing`,
              because: 'picking something up means being within reach of it',
              satisfyWith: `a placeCreatureInScene command for ${id}`,
            },
          ])
        : near;
    }

    const byRecord = near.value.find((pile) => pile.instance === command.item);
    const matching = byRecord === undefined
      ? near.value.filter((pile) => pile.item === command.item)
      : [byRecord];

    if (matching.length === 0) {
      // Lying somewhere else, or lying nowhere: two different things to be
      // told, and a caller that is told the second when the first is true goes
      // looking for an item rather than walking ten feet.
      const anywhere = groundItems(scene.value).filter(
        (pile) => pile.instance === command.item || pile.item === command.item,
      );
      const name = content.item(command.item)?.name ?? command.item;
      return anywhere.length === 0
        ? err('not_on_ground', `there is no ${name} lying in this scene`)
        : err(
            'out_of_reach',
            `the nearest ${name} is more than ${ARMS_REACH} feet from ${id}; move within reach of it first`,
          );
    }
    if (matching.length > 1) {
      return err(
        'ambiguous_pile',
        `there are ${matching.length} piles of ${command.item} within reach of ${id} (${matching
          .map((pile) => pile.instance)
          .join(', ')}); name the one you mean`,
      );
    }

    const pile = matching[0]!;

    // The same question the shop asks, at the other door a character takes
    // weight on. A DM handing the party what it found is not asked it — see
    // `wouldOvercarry` for why the two doors part company here.
    const room = wouldOvercarry(state, content, id, [
      { id: pile.item, quantity: pile.quantity },
    ]);
    if (!room.ok) return room;

    return ok([
      {
        type: 'item-taken-up',
        id,
        item: pile.item,
        quantity: pile.quantity,
        instance: pile.instance,
        source: `${content.item(pile.item)?.name ?? pile.item}, picked up`,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * What is lying within arm's reach of a creature.
 *
 * The read beside the two writes, so a caller can say what is on the floor
 * before deciding to bend down — and so `takeItemUp`'s own refusals are
 * measured against exactly what a caller would have seen.
 */
export function itemsWithinReach(state: GameState, id: CharacterId): Result<readonly GroundPile[]> {
  // Homework, not an empty floor. "Nobody has described a room" and "the room
  // is bare" are two different answers, and `ok([])` gave the second to the
  // first — the mistake rule 6 is about, in the one place in this file that
  // was making it.
  const scene = sceneFor(state, id, `${id} to find anything lying at their feet`);
  if (!scene.ok) return scene;
  return groundItemsWithin(scene.value, id, ARMS_REACH);
}

/**
 * How many hands a conjuring takes up, read from the definition.
 *
 * **One reading, in one place.** SRD puts every conjured thing in *a* hand —
 * Goodberry's handful, Flame Blade's blade — so a definition that says nothing
 * says one, and the free hand this asks for at the casting is the hand the
 * line goes on to fill. Written twice, the two would drift: a spell checked
 * against one free hand and then occupying none can be cast with both hands
 * full but for one, twice over, and letting go frees nothing.
 */
export const conjuredHands = (conjures: ConjuredItems): number => conjures.hands ?? 1;

/**
 * The name a conjuring gives the **one** thing it puts in a hand, out of the
 * ids the log has issued.
 *
 * SRD Pact of the Blade's Longsword beside a Longsword bought in town is two
 * lines of one kind, and two lines of one kind are a question `copyNamed`
 * refuses rather than guesses at — so before this the conjured weapon could
 * not be named at all, and the refusal it provoked named neither copy. A
 * record of its own is the answer the item-instance door already had: the
 * command computes the id from {@link GameState.itemsIssued}, pins it on the
 * event, and the fold checks it is the next one.
 *
 * **One thing, because a record is one copy.** SRD Goodberry conjures a
 * *handful* — ten berries are one line of ten — and a record stands for a
 * single copy with state of its own, which is what `items-gained` checks when
 * it sees one. So a conjured handful stays the counted stack it has always
 * been, and it loses nothing by it: a handful is already keyed to the casting
 * that made it, and two castings' berries never were one line.
 */
const conjuredInstance = (issued: number, count: number): { readonly instance?: string } =>
  count === 1 ? { instance: itemInstanceFor(issued + 1) } : {};

/**
 * The line a conjuring puts in a hand, pinned from the definition that printed
 * it.
 *
 * One spelling, because two doors write it — the casting and the re-evocation
 * — and a second copy would be two places for the count and the hands to
 * disagree. Rule 5: what the command read from content travels with the event,
 * **the default included**: a line that left the hands off would be a line
 * whose cost the fold had to go and look up.
 *
 * `issued` is what the log has issued so far, exactly as `issueItemCopies`
 * takes it and for the same reason: the id has to be the next one or the fold
 * refuses the event.
 */
export function conjuredLine(
  issued: number,
  itemId: string,
  conjures: ConjuredItems,
  castingId?: string,
): InventoryLine {
  return {
    id: itemId,
    quantity: conjures.count,
    ...(castingId === undefined ? {} : { casting: castingId }),
    ...conjuredInstance(issued, conjures.count),
    hands: conjuredHands(conjures),
  };
}

/**
 * The line a **feature's** conjuring puts in a hand — SRD Pact of the Blade's
 * "you can conjure a pact weapon in your hand".
 *
 * Beside {@link conjuredLine} rather than inside it, because the lifetime is an
 * *activation* rather than a casting, which is a different question asked of a
 * different part of state.
 *
 * **The hands are the weapon's own**, which is where this differs from a
 * spell's: SRD Goodberry conjures a *handful* and the number of hands is the
 * spell's to print, and a Glaive out of the air is swung with two hands for
 * exactly the reason a Glaive off the rack is. So `handsFor` answers it off the
 * catalogue record and the answer is pinned onto the line, which is rule 5 —
 * what the command read from the catalogue travels with the event it emitted,
 * so `handsInUse` never has to open one.
 *
 * Here rather than in `commands/features.ts` for the reason its sibling is
 * here: one spelling of what a conjuring puts in a hand, in the module that
 * owns what a creature is carrying, so the sweep in `item-instances.test.ts`
 * has one thing to count.
 *
 * **And a weapon is always one thing**, so this always names what it hands
 * over — see {@link conjuredInstance}, which is where the rule is written and
 * why a spell's handful may not be named.
 */
export function featureConjuredLine(
  issued: number,
  item: CatalogueItem,
  feature: string,
): InventoryLine {
  return {
    id: item.id,
    quantity: 1,
    feature,
    ...conjuredInstance(issued, 1),
    hands: handsFor(item),
  };
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
    const named = copyNamed(state, creature, itemId);
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
      //
      // **It asks, and it carries no `ContextRequest`**, which is deliberate
      // and is the one refusal in the engine shaped this way.
      //
      // A request's `kind` is the name of the declared-not-derived fact that
      // is missing, and there is no kind for "what this creature casts".
      // Adding one would be a kind with no door: the only command that settles
      // the fact is `declareSpellcasting`, which writes a spell list and the
      // ability a save DC comes from — authorship of a stat block, withheld
      // from the model's surface and the DM's alike. A kind whose door is shut
      // on the surface that has to answer for it is the "DOOR NOT CREATED"
      // failure wearing a nicer shape.
      //
      // What was here instead was worse than nothing: the request was tagged
      // `creature`, so the layer above answered it with the tools that *create*
      // a creature — and an orchestrator was told to add a creature already
      // standing in front of it. A question with no door says so; a question
      // pointed at the wrong door looks like progress and is a loop.
      //
      // So the prose carries what the structure cannot, which is what `reason`
      // is for on a thin record, and `doors.test.ts` holds the gap as a record
      // rather than as an argument to be had again.
      if (creature.character === null) {
        return needsContext(
          'unknown_spellcasting',
          `${item.name} requires attunement by a spellcaster, and nothing says whether ${creature.id} casts anything; a declareSpellcasting command for ${creature.id} would settle it, and no tool surface offers one — this is a fact the table states directly or not at all`,
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


/**
 * Take the penalty off a copy somebody is wearing or holding — SRD *Mending*,
 * and the only sentence in the book that lifts one.
 *
 * "The penalty can be removed by casting the _Mending_ spell on the armor or
 * weapon" is printed three times — SRD Rust Monster's Antennae, SRD Black
 * Pudding's Dissolving Pseudopod, SRD Gray Ooze's Pseudopod — and until a
 * casting could reach an item's record it was the one clause of those lines
 * nothing could honour.
 *
 * **Not a command with a door of its own**, and not on the barrel either.
 * Nobody takes an action to do this: it happens because a casting resolved, so
 * this is the event-builder the `repairs` effect calls and its refusals are the
 * casting's. `resolveRepairsEffect` imports it as a sibling, which is what an
 * export is for where a door is not. A copy that is not
 * equipped is refused rather than reported, because a penalty lives on the
 * equipped record — the thing the caster named has no record for one to have
 * landed on, and saying "mended" of it would be the engine claiming to have
 * held something it never held. A copy with no penalty is *not* refused: the
 * spell still mends the tear the table is imagining, and the engine says only
 * that there was nothing of its own to lift. (W7-B11)
 */
export function clearPrintedPenalty(
  state: GameState,
  id: CharacterId,
  item: string,
): Result<{ readonly events: readonly GameEvent[]; readonly unverified: readonly string[] }> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);
  const record = creature.equipped.find((held) => held.id === item);
  if (record === undefined) {
    return err(
      'object_not_held',
      `${id} is not wearing or holding ${item}, and a penalty is a fact about the copy in hand or on the back`,
    );
  }
  const eaten = record.penalty ?? 0;
  if (eaten <= 0) {
    return ok({
      events: [],
      unverified: [`${item} carries no penalty the engine put there, so there was none to lift`],
    });
  }
  return ok({
    events: [{ type: 'item-penalty-cleared', id, item, points: eaten }],
    unverified: [],
  });
}
