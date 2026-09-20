/**
 * The other facts a DM declares mid-play.
 *
 * `commands/scene.ts` closed the eight event types that set up a world for the
 * rules to run in. Six of the commands here are six of the nine that were
 * left: a creature's allegiance, Alert's Initiative swap, a stabilisation,
 * death that is not hit-point loss, an item the DM took away, and a bonus
 * whose source was no casting. Every one was a reducer case with no producer
 * outside a test fixture, so a tool surface — which calls commands and never
 * folds events itself — could not reach any of them.
 *
 * **Two more arrived the other way round**, and belong here for the same
 * reason rather than by the same route: `transferItem` and `awardItems` are
 * what a DM says when the party divides a hoard and when it finds one, and
 * each brought its own event because no reducer case said it. They sit beside
 * `loseItems` because taking something away, handing it over and handing it
 * out are one family of fact — who owns what — and none of the three spends
 * anything on anybody's turn.
 *
 * **The other three of the nine are not here, and that is the design rather
 * than a scattering.** `mounted`, `dismounted` and `free-interaction-used`
 * spend from the turn economy, so they live in the modules that own the
 * budgets they draw on — `commands/movement.ts` and `commands/actions.ts` —
 * and are swept by the action-economy sweep, which demands a `mayAct` guard
 * of every spender it finds. Filing them here would have cost the claim this
 * module's own entry in `DECLARED_NOT_ACTED` makes: that **every** command in
 * it spends nothing, which is checked against the code rather than asserted.
 *
 * `commands/scene.ts` settled four decisions and this follows them rather than
 * inventing a second set:
 *
 * **1. The command is its event's name read as an imperative**, lengthened
 * where the pure function beneath already owns the plain verb and `index.ts`
 * exports both — `swapInitiative`, `stabilize` and `dismount` are all reachable
 * from `@ie/engine`, so `swapInitiativeBetween` and `stabiliseCreature` take
 * the longer name.
 *
 * **2. A command refuses exactly what the reducer would call corrupt**, plus
 * the rules the pure function beneath it already knows and the reducer cannot
 * apply — `swapInitiative` has taken both creatures' conditions since it was
 * written and the reducer passes neither, so SRD Alert's "you can't make this
 * swap if you or the ally has the Incapacitated condition" was a rule reachable
 * from nothing at all.
 *
 * Two of these refuse *more* than the reducer, and each is a rule rather than
 * a second copy of a check: `stabiliseCreature` requires a creature at 0 hit
 * points, because SRD stabilises "a creature with 0 Hit Points"; and
 * `loseItems` refuses more than is carried, because `removeItems` folds a loss
 * in as a negative quantity and drops the line at zero — so taking five
 * rations from two silently succeeds, which is the class of wrong number this
 * repository calls its worst.
 *
 * **3. A fact already true is not restated.** `declareCreatureType` returns
 * `ok([])` for a type that already matches, and `declareCreatureDead` and
 * `removeBonusFrom` take the same reading: a creature dying again and a bonus
 * that was never there stopping are not things that happened, and a log should
 * not carry an event saying they did.
 *
 * **4. `mayAct` is not consulted.** None of these is an action in the turn
 * economy. A stabilisation is the payout of somebody else's Help action or
 * Healer's Kit and the cost was spent through that command; death by fiat, an
 * allegiance, a confiscation and a lapsed bonus cost nobody anything.
 * `DECLARED_NOT_ACTED` in `invariants.test.ts` is where that decision is
 * written down and checked, in the shape the sweep's own exemption lists use.
 *
 * Every one goes through `once`, so the duplicate check comes first and there
 * is nowhere above it to write a guard.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { instancedPoolKeys, itemChargePool, itemChargeRoll } from '../catalogue.js';
import { swapInitiative } from '../combat.js';
import { type GameEvent, type GameState, type InventoryLine } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { rollRecorded } from '../rolls.js';
import { type PoolDeclaration } from '../resources.js';
import { type Supply } from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { copyNamed, issueItemCopies, quantityOf } from './inventory.js';

/**
 * Say which side of the fight a creature is on.
 *
 * Declared rather than derived, like cover and line of sight: who counts as an
 * ally is fiction, and SRD leans on it constantly — "an ally within 5 feet of
 * you" reaches a Rogue's Sneak Attack — without ever defining it mechanically.
 *
 * **Not durable, and that is the difference from a creature's type.** A type
 * is established once and a contradiction is refused, because Hold Person may
 * already have been cast on the strength of it. An allegiance is written to be
 * changed — the event's own docstring says "a bandit is bribed, a charmed ally
 * turns" — and the reducer overwrites rather than throwing, so refusing a
 * second declaration would refuse something the log permits.
 */
export function declareCreatureSide(
  state: GameState,
  id: CharacterId,
  side: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-side:${id}`, { ...command, side }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) return unknownCreature(id);

    return ok([
      { type: 'creature-side-declared', id, side, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Say how many heads a creature has.
 *
 * SRD Hydra's Multiattack: "The hydra makes as many Bite attacks as it has
 * heads." The parser leaves that line as prose — it is a count that reads off
 * a fact nobody has declared — and the engine will not invent the number. So
 * the table states it, and the Attack action's size is then **derived** from a
 * declared fact instead of being made up: `attacksInAction` is the one reader.
 *
 * **Modelled on `declareCreatureSide`, and re-declarable for its reason.** The
 * same block's Multiple Heads trait has a head dying to 25 damage and two
 * growing back at the end of the turn, so a later declaration is the next
 * thing that happened rather than a contradiction of the first — the opposite
 * of `declareCreatureType`, where a second answer would rewrite a fact Hold
 * Person may already have been cast on.
 *
 * **A count below one is refused**, and so is a fraction. Nothing in the book
 * has half a head, and a creature with none has stopped being a creature: SRD
 * "The hydra dies if all its heads are dead" is a death, which is
 * `declareCreatureDead`'s sentence and not this one's.
 */
export function declareCreatureHeads(
  state: GameState,
  id: CharacterId,
  heads: number,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-heads:${id}`, { ...command, heads }, () => [], (stamp) => {
    if (creatureOf(state, id) === null) return unknownCreature(id);
    if (!Number.isInteger(heads) || heads < 1) {
      return err(
        'impossible_head_count',
        `${heads} is not a number of heads; a creature has a whole number of them and at least one — a creature whose last head is gone is dead, which declareCreatureDead says`,
      );
    }

    return ok([
      { type: 'creature-heads-declared', id, heads, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Swap two combatants' places in the Initiative order.
 *
 * SRD Alert: "Immediately after you roll Initiative, you can swap your
 * Initiative with the Initiative of one willing ally in the same combat."
 *
 * **This is the event a DM declares; it is not the feat's offer.** `CLAUDE.md`
 * records Alert's swap as not modelled, and it still is: nothing here checks
 * that either creature has the feat, that the moment is immediately after the
 * roll, or that the ally is willing — the first two need a feature that offers
 * a choice at a moment the engine does not hold, and willingness is fiction.
 * What the engine does own is the arithmetic, and `swapInitiative` has owned
 * it since it was written, reachable from the reducer alone.
 *
 * The Incapacitated clause is the half that was unreachable. `swapInitiative`
 * takes both creatures' conditions and the reducer passes neither, so the rule
 * could not fire; the command reads them off the creatures it was given. A
 * creature the engine has no record of simply contributes no conditions, which
 * is what `swapInitiative` already means by leaving them optional.
 *
 * **One code covers two different misses, and only one of them is homework.**
 * `swapInitiative` answers `unknown_combatant` both for a creature the engine
 * has never been told about and for one standing right there who is simply not
 * in the Initiative order. The first is a thin record with a provider; the
 * second is the engine's **own ledger**, written by `startCombat` and complete
 * — the same reading `resolveEffectCheck` takes for an effect key it holds no
 * timer for. So the request is attached only where it is true, and a bystander
 * gets a verdict rather than an instruction to establish a creature that
 * already exists.
 */
export function swapInitiativeBetween(
  state: GameState,
  a: CharacterId,
  b: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `swap-initiative:${a}<>${b}`, command, () => [], (stamp) => {
    if (state.combat === null) {
      return err('not_in_combat', 'there is no Initiative order to swap places in');
    }

    const swapped = swapInitiative(
      state.combat,
      a,
      b,
      creatureOf(state, a)?.conditions,
      creatureOf(state, b)?.conditions,
    );
    if (!swapped.ok) {
      if (swapped.code !== 'unknown_combatant') return swapped;
      // Which of the two it was about — which the reason names in prose and the
      // code does not — so that the request, where there is one, names them.
      const missing = state.combat.order.some((combatant) => combatant.id === a) ? b : a;
      return creatureOf(state, missing) === null
        ? unknownCreature(missing)
        : err('unknown_combatant', `${missing} is not in this combat`);
    }

    return ok([{ type: 'initiative-swapped', a, b, ...(stamp === null ? {} : { command: stamp }) }]);
  });
}

/**
 * Stop a dying creature from dying.
 *
 * SRD: "You can take the Help action to try to stabilize a creature with 0 Hit
 * Points, which requires a successful DC 10 Wisdom (Medicine) check", and a
 * Healer's Kit does it without one. The check and the action belong to whoever
 * is doing the stabilising and go through their own commands; this records the
 * outcome, which is a fact about the creature on the floor.
 *
 * Two refusals, both from the book. A creature that is not at 0 hit points has
 * nothing to be stabilised from — SRD names the state, not a creature. And a
 * corpse is Raise Dead's business, which is the rule `healCreature` already
 * takes for hit points.
 */
export function stabiliseCreature(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `stabilise:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (creature.vitals.dead) {
      return err('dead', `${id} is dead; stabilising is for a creature still dying`);
    }
    if (creature.vitals.hp > 0) {
      return err(
        'not_dying',
        `stabilising is for a creature with 0 Hit Points, and ${id} has ${creature.vitals.hp}`,
      );
    }

    return ok([{ type: 'stabilised', id, ...(stamp === null ? {} : { command: stamp }) }]);
  });
}

/**
 * Record a death that is not hit-point loss.
 *
 * Damage is the wrong instrument for these, and that is the whole reason the
 * event exists: a healthy creature taking exactly its maximum in damage drops
 * to 0, it does not die. Power Word Kill, a fall nobody is surviving, a DM's
 * ruling — each is a decision, so each carries its cause into the log.
 *
 * A creature already dead is not made deader: nothing is written, the reading
 * `declareCreatureType` takes for a fact that is already true.
 */
export function declareCreatureDead(
  state: GameState,
  id: CharacterId,
  cause: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-dead:${id}`, { ...command, cause }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (creature.vitals.dead) return ok([]);

    return ok([
      { type: 'creature-died', id, cause, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Take something away from a creature.
 *
 * The counterpart of `purchaseItem`'s `items-gained` for everything a purchase
 * is not: a thief in the night, a mimic that swallowed the sword, a ration
 * eaten. No price is involved, so no coin moves and the catalogue is not
 * consulted — a DM may take away something the SRD never listed.
 *
 * **Two refusals, and neither is a second copy of the reducer's.**
 * `removeItems` folds a loss in as a negative quantity and drops any line that
 * reaches zero, so taking five rations from two silently succeeds and leaves
 * none. And **owning and wearing are two facts**: `items-lost` does not touch
 * `equipped`, so confiscating worn armour would leave it worn and still adding
 * its Armour Class — the "chain mail in a backpack" bug inverted. Taking it off
 * is a decision and `unequipItem` is where it looks like one.
 */
export function loseItems(
  state: GameState,
  id: CharacterId,
  items: readonly InventoryLine[],
  source: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `lose-items:${id}`, { ...command, items, source }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (items.length === 0) return err('no_items', 'a loss has to name something that was lost');

    const lost: InventoryLine[] = [];
    for (const line of items) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        return err(
          'bad_quantity',
          `a loss takes a positive whole number, got ${line.quantity} of ${line.id}`,
        );
      }
      /**
       * **Which copy**, where the copies are told apart, and said out loud in
       * the event.
       *
       * A wand with charges of its own is a line the reducer finds by that
       * copy's id; a loss naming only the kind of thing would remove nothing
       * at all and do it silently. So the line is resolved here — the copy the
       * caller named, or the only one there is — and a kind of thing with
       * several copies is a question rather than a guess: a thief takes *a*
       * wand, and which one they took decides how many charges the party has
       * left.
       */
      const named =
        line.instance === undefined
          ? copyNamed(creature, line.id)
          : ok(creature.inventory.find((owned) => owned.instance === line.instance) ?? null);
      if (!named.ok) return named;
      const copy = named.value;
      const owned = copy?.instance === undefined ? quantityOf(state, id, line.id) : copy.quantity;
      if (copy === null || owned < line.quantity) {
        return err('not_owned', `${id} has ${owned} of ${line.id}, not ${line.quantity}`);
      }

      /**
       * **Per copy, and after the copy is resolved**, which is the old rule
       * read with the record a copy now has. "Worn or wielded" was asked of
       * the *kind* of thing, because that was the only question an inventory
       * could answer — so a creature holding one wand could not drop the
       * other, which was never the rule and only ever the reading. Where
       * either side is unlabelled the kind is all there is to ask, and the old
       * answer stands.
       */
      const held = creature.equipped.find((worn) => worn.id === copy.id);
      if (held !== undefined && sameCopy(held.instance, copy.instance)) {
        return err('equipped', `${line.id} is worn or wielded by ${id}; take it off first`);
      }
      lost.push(copy.instance === undefined ? line : { ...line, instance: copy.instance });
    }

    return ok([
      {
        type: 'items-lost',
        id,
        items: lost,
        source,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * Hand something from one creature to another.
 *
 * **One event, because the world has one fact.** A loss and a gain written
 * back to back would be two — and the second would be wrong: a gain declares a
 * pool full, so a wand handed over that way would arrive with three charges
 * however spent it left. The reducer moves the line and its pool record whole.
 *
 * It reads no catalogue and rolls nothing, which no other inventory command
 * can say: what moves is what the giver had, and the pools that move are the
 * ones keyed to the copy — a suffix the engine wrote itself, read back by
 * `instancedPoolKeys`.
 *
 * Three refusals worth the name, beside the bookkeeping ones — an unknown
 * creature, a gift to oneself, a quantity that is not a count. **Which copy**,
 * where there are several, is a question and not a guess, exactly as it is
 * for a loss. **Worn or wielded is refused**, on
 * `loseItems`' rule and for its reason: `equipped` is a separate fact, so
 * giving away what is in your hand would leave the armour still adding its
 * Armour Class on somebody who no longer owns it. And a transfer of more than
 * is carried is refused rather than silently over-giving, because unlike a
 * loss it would *make* the difference in the taker's pack.
 *
 * What is **not** here is attunement: SRD ends it when "you no longer have the
 * item", nobody decides that, and the derived pass that already ends it for a
 * thief in the night ends it for a gift without an event.
 */
export function transferItem(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
  itemId: string,
  quantity: number,
  source: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(
    state,
    `transfer:${from}->${to}`,
    { ...command, itemId, quantity, source },
    () => [],
    (stamp) => {
      const giver = creatureOf(state, from);
      if (giver === null) return unknownCreature(from);
      const taker = creatureOf(state, to);
      if (taker === null) return unknownCreature(to);
      if (from === to) {
        return err('same_creature', `${from} already has it; a transfer needs two creatures`);
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return err('bad_quantity', `a transfer moves a positive whole number, got ${quantity}`);
      }

      const named = copyNamed(giver, itemId);
      if (!named.ok) return named;
      const copy = named.value;
      if (copy === null) return err('not_owned', `${from} does not have ${itemId}`);

      /**
       * **Per copy, where the copies are told apart.** "Worn or wielded" was
       * asked of the *kind* of thing, which was the only question an inventory
       * could answer before a copy had a record — so a creature holding one
       * wand could not hand over the other. The rule is about the copy in the
       * hand; where either side is unlabelled the kind is all there is to ask,
       * and the old answer stands.
       */
      const held = giver.equipped.find((worn) => worn.id === copy.id);
      if (held !== undefined && sameCopy(held.instance, copy.instance)) {
        return err('equipped', `${copy.id} is worn or wielded by ${from}; take it off first`);
      }

      if (copy.quantity < quantity) {
        return err('not_owned', `${from} has ${copy.quantity} of ${copy.id}, not ${quantity}`);
      }

      // Everything keyed to this copy travels with it: the charges left in a
      // wand are the wand's, not the hand's.
      const pools =
        copy.instance === undefined
          ? []
          : instancedPoolKeys(Object.keys(giver.resources.pools), copy.instance);

      return ok([
        {
          type: 'item-transferred',
          from,
          to,
          item: copy.id,
          quantity,
          ...(copy.instance === undefined ? {} : { instance: copy.instance }),
          ...(pools.length === 0 ? {} : { pools }),
          source,
          ...(stamp === null ? {} : { command: stamp }),
        },
      ]);
    },
  );
}

/**
 * Whether two lines are the same copy, where either of them has a record.
 *
 * An unlabelled line answers for its whole kind, which is what "unlabelled"
 * has always meant: twenty arrows are twenty arrows, and the one in the bow is
 * not a different arrow.
 */
const sameCopy = (held: string | undefined, named: string | undefined): boolean =>
  held === undefined || named === undefined || held === named;

/** One thing a DM is handing over, and how many of it. */
export interface AwardedItem {
  readonly id: string;
  readonly quantity?: number;
}

/**
 * Hand a party what it found.
 *
 * The door that did not exist, which is why every fixture's found items were
 * written by hand — and a hand-written `items-gained` is a line with no
 * record, which is exactly the copy that used to acquire a shared pool by
 * being picked up. That branch in `equipItem` went with this command's
 * arrival: **there is one gain semantics now**, and it is this one — a copy
 * with state of its own is labelled when it is gained and its pool is
 * declared beside it, at every door.
 *
 * It takes a `Supply` for the dice, which is the one thing separating it from
 * `purchaseItem`: **some items roll how much they hold.** SRD Necklace of
 * Fireballs prints "1d6+3 beads" and Sovereign Glue "1d6+1 ounces" — a fact
 * about the copy the party found rather than about the row in the book — so
 * the engine rolls it once, here, out of the campaign's own generator, and
 * pins the number into the pool the copy is born with. Replay reads the log.
 * A caller never supplies the count; it never supplies the dice either, which
 * are the item's own line.
 *
 * A pack is opened, the way a purchase opens one: a Scholar's Pack handed over
 * is nine things handed over.
 */
export function awardItems(
  state: GameState,
  supply: Supply,
  id: CharacterId,
  items: readonly AwardedItem[],
  source: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `award:${id}`, { ...command, items, source }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (items.length === 0) return err('no_items', 'an award has to name something that was found');

    const requested: InventoryLine[] = [];
    for (const line of items) {
      const quantity = line.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1) {
        return err(
          'bad_quantity',
          `an award takes a positive whole number, got ${quantity} of ${line.id}`,
        );
      }
      // Unlike a loss, an award has to know what it is handing over: whether
      // the copy gets a record of its own is read off the catalogue here, and
      // an item nobody has heard of has no answer to that question.
      const item = supply.content.item(line.id);
      if (item === null) return err('unknown_item', `${line.id} is not in the catalogue`);
      for (const inside of supply.content.expandPack(line.id)) {
        requested.push({ id: inside.id, quantity: inside.quantity * quantity });
      }
    }

    const given = issueItemCopies(state.itemsIssued, supply.content, requested);
    const events: GameEvent[] = [
      {
        type: 'items-gained',
        id,
        items: given.items,
        source,
        ...(stamp === null ? {} : { command: stamp }),
      },
      ...given.pools.map((pool) => ({ type: 'resource-pool-declared' as const, id, pool })),
    ];

    // The copies whose count the book rolls, which `issueItemCopies` labelled
    // and deliberately left unsized: it has no generator, and this does.
    for (const line of given.items) {
      if (line.instance === undefined) continue;
      const item = supply.content.item(line.id);
      const notation = item === null ? null : itemChargeRoll(item);
      if (item === null || notation === null) continue;

      const issuedBefore = supply.issuer.count;
      const rolled = rollRecorded(supply.issuer, supply.rng, notation);
      if (!rolled.ok) return rolled;
      // Non-null: `itemChargeRoll` answered, so the item declares a pool.
      const pool = itemChargePool(item, line.instance)!;
      events.push(
        {
          type: 'roll-recorded',
          who: id,
          label: `${pool.label} (${notation})`,
          natural: rolled.value.total,
          total: rolled.value.total,
          contributions: [],
          outcome: `${rolled.value.total} to begin with`,
        },
        { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
        { type: 'resource-pool-declared', id, pool: rolledPool(pool, rolled.value.total) },
      );
    }

    return ok(events);
  });
}

/** The pool a rolled count sizes: the item's own declaration, with the number in it. */
const rolledPool = (pool: PoolDeclaration, max: number): PoolDeclaration => ({ ...pool, max });

/**
 * Stop a named bonus applying.
 *
 * A bonus a **casting** hung ends with that casting, through `releaseCasting`,
 * and needs no command — that is the one door every linked effect goes out of.
 * This is for the others: a potion wearing off, an item taken off, a DM's
 * ruling that the inspiring speech has stopped inspiring.
 *
 * A creature carrying no bonus from that source has nothing that stopped, so
 * nothing is written — the same reading as a death already recorded.
 */
export function removeBonusFrom(
  state: GameState,
  id: CharacterId,
  source: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `remove-bonus:${id}`, { ...command, source }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.bonuses.some((held) => held.source === source)) return ok([]);

    return ok([
      { type: 'bonus-removed', id, source, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}
