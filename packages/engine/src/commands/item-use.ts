/**
 * Using an item that confers its effects **without casting a spell**.
 *
 * SRD "Magic Items" settles the fork in one sentence and the engine does not
 * have to have an opinion about which side an item falls on: "Many items, such
 * as Potions, **bypass the casting of a spell** and confer the spell's effects
 * with its usual duration." The other side is `commands/item-casting.ts`, where
 * a wand's Fireball goes down the pipeline a Wizard's goes down and comes out
 * with a casting id; this side has no casting at all.
 *
 * **The casting is absent rather than faked**, which is the whole of the
 * decision this file implements. What the effects hang on a creature is filed
 * under `item:<catalogue id>` — a bare source, exactly as a feature's own id
 * already is — and `castingIdOf` matches `cast:N` and nothing else, so
 * `releaseCasting`, `releaseOnTarget`, `ongoingSpellsOn`, `spellOn` and the
 * Dispel resolver pass over a potion's bonus by construction rather than by
 * having been told to. A made-up casting id would have put a casting in the
 * log that nobody cast, and offered Dispel Magic something to end.
 *
 * **What ends it is what already ended a feature's grant.** `expireEffects`
 * releases a `grants` timer by its bare source, `removeBonusFrom` takes one
 * off early — its docstring has named "a potion wearing off" since it was
 * written — and `fold/grants.ts` replaces rather than stacks when the same
 * source grants twice, which is SRD "Combining Magical Effects" and is why a
 * second potion inside the hour refreshes instead of doubling.
 *
 * **A use is paid for with the bottle or with a charge, never both.** SRD
 * prints two prices for the same kind of sentence: "Once used, a potion takes
 * effect immediately, and it is used up", and a staff's "you can expend up to
 * 3 charges", which leaves the staff. The `confers` grant says which by naming
 * a price or not, `checkContent` has already refused a price with no pool
 * behind it, and the fork reaches further than the payment — a bottle is drunk
 * out of a pack and is refused while it is still in hand, while a charge is
 * spent "while holding it" and is refused when it is not. What spends the
 * charge is `expendCharges`, the command that has owned that economy since
 * pools landed, asked for its events rather than copied: the hold, the
 * attunement, the declared pool and running out are one spender's rules.
 *
 * **Every refusal is reached before anything is spent.** The creature, the
 * hold, the item, what it confers, whether it is owned, who it is aimed at,
 * whether they are in reach, and what the use costs are all settled before the
 * action goes and before the first die — so a potion aimed at nobody, or at
 * somebody across the room, and a staff with an empty pool, cost their holder
 * nothing at all.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import {
  CONFERRED_LEVEL,
  itemConferral,
  itemSource,
  type ItemConfersGrant,
} from '../catalogue.js';
import { conditionInstanceId } from '../conditions.js';
import { type EffectTarget, timerKey } from '../timers.js';
import { grantSourcesOf, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { rollRecorded } from '../rolls.js';
import { type Supply } from './casting.js';
import { creatureOf, reachedBy, spendFor, unknownCreature } from './command.js';
import { schedule } from './conditions.js';
import { mayAct } from './holds.js';
import { copyNamed, expendCharges } from './inventory.js';
import { runEffects } from './spell-resolution.js';
import { type SpellTargetOutcome } from './targeting.js';

export interface UseItemCommand extends CommandIdentity {
  /** The catalogue id of the item being used. */
  readonly item: string;
  /**
   * Who gets the benefit. Absent is the user themselves.
   *
   * SRD Potion of Healing: "you can drink it **or administer it to another
   * creature within 5 feet of yourself**." The default is not a convenience:
   * a potion with no stated target is a potion somebody drank, which is the
   * common case and the one a caller should not have to spell out.
   */
  readonly target?: CharacterId;
  /**
   * How many charges to spend, where the item's line lets the user choose.
   *
   * SRD Staff of Striking: "you can expend up to 3 charges." Absent is the
   * cost the line prints, which is the bottom of the range and the only price
   * a fixed-cost item has. Named over an item that costs nothing is a caller
   * who thinks they said something, and is refused rather than ignored — the
   * answer `itemCastOf` already gives a charge count with no item under it.
   */
  readonly charges?: number;
}

/** What using an item did. */
export interface ItemUse {
  readonly events: readonly GameEvent[];
  /** What it did, target by target — a `SpellResolution`'s half that applies. */
  readonly outcomes: readonly SpellTargetOutcome[];
  /** What the use could not check. */
  readonly unverified: readonly string[];
}

const NOTHING: ItemUse = { events: [], outcomes: [], unverified: [] };

/**
 * How many charges this use spends, or null where the item is used up instead.
 *
 * The same arithmetic `chargesFor` does over a casting from an item, asked of
 * a conferral: the cost the line prints, a maximum above it where the line
 * offers a choice, and the count the user named refused rather than rounded
 * when it falls outside. Charges are the holder's to spend and nothing else
 * may decide how many go.
 *
 * **A price and a bottle are the two sides of one fork.** An item that names
 * no cost is used up — every Potion in the book — so there is no count to
 * name, and a request that named one is refused rather than dropped.
 */
function chargesForUse(
  conferral: ItemConfersGrant,
  itemName: string,
  asked: number | undefined,
): Result<number | null> {
  const cost = conferral.charges;
  if (cost === undefined) {
    if (asked !== undefined) {
      return err(
        'bad_charges',
        `${itemName} is used up rather than spent and costs no charges, and ${asked} ${asked === 1 ? 'was' : 'were'} named`,
      );
    }
    return ok(null);
  }

  const most = conferral.upToCharges ?? cost;
  const spend = asked ?? cost;
  if (!Number.isInteger(spend)) {
    return err('bad_charges', `a use spends a whole number of charges, got ${spend}`);
  }
  if (spend < cost || spend > most) {
    return err(
      'bad_charges',
      most === cost
        ? `${itemName} is used for ${cost} charge${cost === 1 ? '' : 's'}, and ${spend} ${spend === 1 ? 'was' : 'were'} named`
        : `${itemName} is used for ${cost} to ${most} charges, and ${spend} ${spend === 1 ? 'was' : 'were'} named`,
    );
  }
  return ok(spend);
}

/** How long a conferral's deadlines are measured out to. */
type ConferredSpan = { readonly kind: 'seconds'; readonly seconds: number };

/**
 * How long what this item hangs lasts, or null where it hangs nothing that
 * outlasts the moment.
 *
 * **One question with two answers**, because the SRD writes the same clause
 * two ways: Potion of Heroism prints "for 1 hour" and Potion of Diminution
 * rolls one — "for 1d4 hours". Which of the two an item is was settled by
 * `checkContent`, which refuses a conferral that says both and one that says
 * neither while hanging something, so the fork is taken here once and the
 * three kinds of deadline below share whichever answer came back.
 *
 * **The die goes down the path a pool's dawn recovery goes down** —
 * `rollRecorded`, then the roll, the issue and the consequence, in that order
 * — and what reaches the fold is the deadline it decided rather than the dice
 * it came from, so a replay reads the span out of the log instead of throwing
 * a second, different one.
 *
 * **Thrown at the first deadline and not before.** A die thrown for a timer
 * nobody files would move the generator for nothing, which is the quiet way a
 * replay stops matching — the reason a full pool is not rolled for at dawn
 * either. And thrown once: a draught whose condition and whose grant expired
 * an hour apart would be two lifetimes out of one printed sentence.
 */
function spanOf(
  conferral: ItemConfersGrant,
  itemName: string,
  who: CharacterId,
  supply: Supply,
  events: GameEvent[],
): (() => Result<ConferredSpan>) | null {
  const printed = conferral.durationSeconds;
  if (printed !== undefined) {
    const span: ConferredSpan = { kind: 'seconds', seconds: printed };
    return () => ok(span);
  }

  const rolled = conferral.durationRolled;
  if (rolled === undefined) return null;

  let span: ConferredSpan | null = null;
  return () => {
    if (span !== null) return ok(span);
    const issuedBefore = supply.issuer.count;
    const thrown = rollRecorded(supply.issuer, supply.rng, rolled.dice);
    if (!thrown.ok) return thrown;
    const seconds = thrown.value.total * rolled.secondsEach;
    events.push(
      {
        type: 'roll-recorded',
        who,
        label: `${itemName} lasts (${rolled.dice})`,
        natural: thrown.value.total,
        total: thrown.value.total,
        contributions: [],
        outcome: `${seconds} seconds`,
      },
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    );
    span = { kind: 'seconds', seconds };
    return ok(span);
  };
}

/**
 * Drink a potion, or administer one — and everything else an item confers
 * without casting.
 *
 * The item is paid for in the same batch that resolves it: the bottle off the
 * inventory or the charge out of the pool, then the effects, then the deadline
 * on anything they hung. There is no second command and no second id, for the
 * reason a wand's charge is spent inside its casting's own batch — two
 * commands would be two ids, and the first would land while the second
 * refused.
 *
 * **Everything mechanical is the item's, not the user's.** SRD fixes a
 * spell from an item at "the lowest possible spell and caster level", and a
 * conferral is that with the casting taken out: the dice are the ones the
 * line prints, the save DC is the one the line prints, there is no
 * spellcasting ability modifier to add, and `checkContent` refuses an item
 * that tries to say otherwise. So a Potion of Healing heals the same 2d4 + 2
 * whoever drinks it, and a flask saves against its own number in any hand.
 */
export function useItem(
  state: GameState,
  id: CharacterId,
  command: UseItemCommand,
  supply: Supply,
): Result<ItemUse> {
  return once(state, `use-item:${id}`, command, () => NOTHING, (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const holding = mayAct(state, id);
    if (holding !== null) return holding;

    const item = supply.content.item(command.item);
    if (item === null) return err('unknown_item', `${command.item} is not in the catalogue`);

    const conferral = itemConferral(item);
    if (conferral === null) {
      return err(
        'item_confers_nothing',
        `${item.name} confers nothing by being used: a benefit it gives while worn is had by equipping it, and a spell it casts is cast`,
      );
    }

    // Which copy is being used, where the copies are told apart: a flask used
    // up has to be taken off the inventory by its own id, or the loss would
    // remove nothing and leave the benefit running out of a full bottle.
    const named = copyNamed(creature, command.item);
    if (!named.ok) return named;
    const copy = named.value;
    if (copy === null) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    // **Owning and wearing are two facts**, and using the item up moves only
    // the first: a conferring item still in hand would leave `equipped` naming
    // something nobody owns. Taking it off is a decision and `unequipItem` is
    // where it looks like one — the reading `loseItems` already takes.
    //
    // **Asked of a bottle and not of a staff**, which is the same fork the
    // price is: an item that spends a charge is used "while holding it" — SRD
    // writes that on every charged item in the book — and `expendCharges`
    // insists on it below. The two refusals are opposites because the two
    // items are, and nothing in between can be written: `checkContent` has
    // already decided which of the two this grant is.
    if (
      conferral.charges === undefined &&
      creature.equipped.some((worn) => worn.id === command.item)
    ) {
      return err('equipped', `${item.name} is worn or wielded by ${id}; take it off first`);
    }

    const target = command.target ?? id;
    if (creatureOf(state, target) === null) return unknownCreature(target);

    // SRD: "administer it to another creature within 5 feet of yourself" — the
    // rule a Paladin's touch already asks, asked from the one place.
    const beyond = reachedBy(state, id, target, item.name);
    if (beyond !== null) return beyond;

    // **What this use costs, settled before anything is spent.** Both halves
    // are asked here: the count the line allows, and — through the one spender
    // — whether the item is in hand, attuned to, and has that many left. Every
    // one of them is a value, so a staff with an empty pool costs its holder
    // no charge, no die and no Action.
    const asked = chargesForUse(conferral, item.name, command.charges);
    if (!asked.ok) return asked;
    const charged =
      asked.value === null ? null : expendCharges(state, supply.content, id, item.id, asked.value);
    if (charged !== null && !charged.ok) return charged;

    // — from here it costs something ——————————————————————————————————————
    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as every feature finds.
    if (state.combat !== null) {
      const spent = spendFor(state, id, conferral.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    // **The price, which is the bottle or the charge and never both.**
    //
    // SRD: "Once used, a potion takes effect immediately, and it is used up."
    // Before the effects rather than after, so the batch never holds a state
    // in which the benefit has landed and the bottle is still full — and the
    // charge stands in exactly that place for exactly that reason.
    //
    // **The stamp rides whichever of the two was paid.** A batch carrying no
    // stamped event is a command the fold never records as applied, so a
    // retried use of a staff would spend a second charge; `expendCharges` is
    // asked without a command id of its own — one command is one identity, and
    // a second would fingerprint this derived call rather than the caller's —
    // so the stamp is put on what it gave back.
    if (charged === null) {
      events.push({
        type: 'items-lost',
        id,
        items: [
          {
            id: item.id,
            quantity: 1,
            ...(copy.instance === undefined ? {} : { instance: copy.instance }),
          },
        ],
        source: `${item.name}, used`,
        ...(stamp === null ? {} : { command: stamp }),
      });
    } else {
      events.push(
        ...charged.value.map((event, index) =>
          index === 0 && stamp !== null ? { ...event, command: stamp } : event,
        ),
      );
    }

    const unverified: string[] = [];
    const resolved = runEffects(state, id, creature, {
      origin: { kind: 'item', item },
      effects: conferral.effects,
      // **No route, no ability, and every number the item's own.** A conferral
      // has no caster, so there is nothing for "your spellcasting ability
      // modifier" to be about and no attack modifier to derive — the kinds
      // that would need one are refused by `checkContent`.
      //
      // **The save DC is the exception, and it is the item's.** SRD writes it
      // as the item's own clause — "(save DC 15)" — so it arrives from the
      // grant rather than from the drinker's sheet, and a flask in an
      // archmage's hand still saves against what the flask prints. Zero where
      // the item prints none, which `checkContent` has already refused for any
      // list that rolls one.
      route: null,
      ability: null,
      castLevel: CONFERRED_LEVEL,
      numbers: {
        attackModifier: 0,
        saveDc: conferral.saveDc ?? 0,
        spellcastingModifier: 0,
        casterLevel: CONFERRED_LEVEL,
      },
      targets: [target],
      unverified,
      supply,
      events,
    });
    if (!resolved.ok) return resolved;

    // **A deadline on what this actually hung, and on nothing else.** SRD
    // Potion of Heroism: "you are under the effect of the _Bless_ spell" for an
    // hour. There is no casting for `releaseCasting` to end, so the timer is
    // the only door — and there are three kinds of it, because there are three
    // kinds of thing a conferral leaves behind and they are ended by different
    // doors and keyed by different strings.
    //
    // A **grant** is filed per creature the run is holding one on rather than
    // per effect, because `timerKey` is `grants|<who>|<source>` and what such a
    // deadline ends is everything that source granted there; `held` is also the
    // only answer that covers an `attack-rider`, which lands on the user and
    // not on the target. A **condition** is filed per instance, because that is
    // what identifies it and what a refresh has to replace. A **pool** of
    // Temporary Hit Points is filed per creature, because a creature holds
    // exactly one and the SRD is explicit that they do not stack.
    //
    // `checkContent` has already refused a conferral that hangs either and
    // names no duration, and one that names a duration and hangs nothing.
    const lastsFor = spanOf(conferral, item.name, id, supply, events);
    if (lastsFor !== null) {
      const source = itemSource(item.id);
      const world = resolved.value.state;

      // **A condition is its own timer, keyed by the instance.** SRD Potion of
      // Invisibility: "you have the Invisible condition for 1 hour. The effect
      // ends early if you make an attack roll, deal damage, or cast a spell."
      // There is no casting, so this timer is the whole record of it — the
      // hour is the deadline and the sentence is `endsEarly` — and
      // `endTimedCondition` is the one door both ends go through.
      //
      // Read off the outcomes rather than off `held`, because what has to be
      // named is the **condition**: `timerKey` is `condition|<who>|<instance>`,
      // which is what makes a second draught of the same potion refresh the
      // deadline instead of filing a second one.
      for (const outcome of resolved.value.outcomes) {
        for (const condition of outcome.conditions ?? []) {
          const on: EffectTarget = {
            kind: 'condition',
            on: outcome.target,
            instance: conditionInstanceId(condition, source),
          };
          const lasts = lastsFor();
          if (!lasts.ok) return lasts;
          const timer = schedule(
            world,
            on,
            lasts.value,
            // **The repeat the resolution already filed, kept.** A `save`
            // effect hands its condition over with the repeat the item printed
            // and no deadline of its own, because the hour is the conferral's
            // and not the effect's. `timerKey` is the condition's, so this
            // event lands on that same record — a timer completed rather than
            // a second one — and re-stating the deadline without the repeat
            // would drop the sentence the resolver had just written down.
            world.timers[timerKey(on)]?.repeatSave,
            undefined,
            conferral.endsEarly,
          );
          if (!timer.ok) return timer;
          events.push(timer.value);
        }
      }

      // **And the pool of Temporary Hit Points, which is the third kind.**
      // SRD Potion of Heroism: "you gain 10 Temporary Hit Points **that last
      // for 1 hour**." Neither of the two above can carry that — the points
      // are not a condition and not one of the eight sourced grant families —
      // so the deadline goes on the pool itself, which `EffectTarget` names.
      //
      // **Only where the grant was actually taken.** `grantTemporaryHp` keeps
      // the larger pool, so a ten poured over a held twenty changes nothing;
      // and the key here is `temporary-hit-points|<who>`, the *creature*
      // rather than the source, because a creature holds exactly one pool. A
      // timer filed anyway would stand over points this item never granted and
      // end them early — the owner's ruling of 2026-09-18 is what that would
      // break, since Temporary Hit Points with no stated duration last until
      // they are spent or until a Long Rest. The pool moving is the honest
      // test of which of the two happened, and it is the same test
      // `fold/vitals.ts` applies when it decides whether to drop the deadline
      // the replaced pool was carrying. Asked of the world the run started
      // from and the world it ended in, so the two cannot disagree.
      //
      // **After the grant event and not before.** `temporary-hp-granted` drops
      // whatever deadline stood over the pool it replaced, so an
      // `effect-scheduled` written ahead of it would be thrown away by the
      // very event that made it necessary — the order `applyConditionTo`
      // already writes, the thing first and its timer behind it.
      //
      // **Once per creature**, because the key is the creature: a conferral
      // carrying two `temp-hp` effects at one target hands over one pool, and
      // a second identical `effect-scheduled` would be a line in the log
      // saying nothing the first did not.
      const pooled = new Set<CharacterId>();
      for (const outcome of resolved.value.outcomes) {
        if (outcome.temporaryHp === undefined || pooled.has(outcome.target)) continue;
        const before = state.creatures[outcome.target]?.vitals.temporaryHp ?? 0;
        const after = world.creatures[outcome.target]?.vitals.temporaryHp ?? 0;
        if (after === before) continue;
        pooled.add(outcome.target);
        const lasts = lastsFor();
        if (!lasts.ok) return lasts;
        const timer = schedule(
          world,
          { kind: 'temporary-hit-points', on: outcome.target },
          lasts.value,
        );
        if (!timer.ok) return timer;
        events.push(timer.value);
      }

      // **And a `grants` timer only where a grant is actually held.** `held`
      // is whom the run left *something* of its own on, and a condition is one
      // of the things it can be — so a condition-only potion used to file a
      // `grants|<who>|item:<id>` deadline against a creature holding no grant
      // at all: a timer that takes nothing away, standing until the hour, and
      // keyed where a later grant from the same item would have landed.
      // `grantSourcesOf` is the one enumerator of the eight sourced families,
      // and it is the honest question here.
      for (const on of [...resolved.value.held].sort()) {
        const creature = world.creatures[on];
        if (creature === undefined || !grantSourcesOf(creature).includes(source)) continue;
        const lasts = lastsFor();
        if (!lasts.ok) return lasts;
        const timer = schedule(world, { kind: 'grants', on, source }, lasts.value);
        if (!timer.ok) return timer;
        events.push(timer.value);
      }
    }

    return ok({ events, outcomes: resolved.value.outcomes, unverified });
  });
}
