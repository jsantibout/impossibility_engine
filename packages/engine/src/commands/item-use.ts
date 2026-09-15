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
 * **Every refusal is reached before anything is spent.** The creature, the
 * hold, the item, what it confers, whether it is owned, who it is aimed at and
 * whether they are in reach are all settled before the action goes and before
 * the first die — so a potion aimed at nobody, or at somebody across the room,
 * costs its holder nothing at all.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { CONFERRED_LEVEL, itemConferral, itemSource } from '../catalogue.js';
import { conditionInstanceId } from '../conditions.js';
import { grantSourcesOf, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { type Supply } from './casting.js';
import { creatureOf, reachedBy, spendFor, unknownCreature } from './command.js';
import { schedule } from './conditions.js';
import { mayAct } from './holds.js';
import { quantityOf } from './inventory.js';
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
 * Drink a potion, or administer one — and everything else an item confers
 * without casting.
 *
 * The item is used up in the same batch that resolves it: one off the
 * inventory, then the effects, then the deadline on anything they hung. There
 * is no second command and no second id, for the reason a wand's charge is
 * spent inside its casting's own batch — two commands would be two ids, and
 * the first would land while the second refused.
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

    if (quantityOf(state, id, command.item) < 1) {
      return err('not_owned', `${id} does not have ${item.name}`);
    }
    // **Owning and wearing are two facts**, and using the item up moves only
    // the first: a conferring item still in hand would leave `equipped` naming
    // something nobody owns. Taking it off is a decision and `unequipItem` is
    // where it looks like one — the reading `loseItems` already takes.
    if (creature.equipped.some((worn) => worn.id === command.item)) {
      return err('equipped', `${item.name} is worn or wielded by ${id}; take it off first`);
    }

    const target = command.target ?? id;
    if (creatureOf(state, target) === null) return unknownCreature(target);

    // SRD: "administer it to another creature within 5 feet of yourself" — the
    // rule a Paladin's touch already asks, asked from the one place.
    const beyond = reachedBy(state, id, target, item.name);
    if (beyond !== null) return beyond;

    // — from here it costs something ——————————————————————————————————————
    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as every feature finds.
    if (state.combat !== null) {
      const spent = spendFor(state, id, conferral.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    // SRD: "Once used, a potion takes effect immediately, and it is used up."
    // Before the effects rather than after, so the batch never holds a state
    // in which the benefit has landed and the bottle is still full.
    events.push({
      type: 'items-lost',
      id,
      items: [{ id: item.id, quantity: 1 }],
      source: `${item.name}, used`,
      ...(stamp === null ? {} : { command: stamp }),
    });

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
    // the only door — and there are two kinds of it, because there are two
    // kinds of thing a conferral leaves behind and they are ended by different
    // doors and keyed by different strings.
    //
    // A **grant** is filed per creature the run is holding one on rather than
    // per effect, because `timerKey` is `grants|<who>|<source>` and what such a
    // deadline ends is everything that source granted there; `held` is also the
    // only answer that covers an `attack-rider`, which lands on the user and
    // not on the target. A **condition** is filed per instance, because that is
    // what identifies it and what a refresh has to replace.
    //
    // `checkContent` has already refused a conferral that hangs either and
    // names no duration, and one that names a duration and hangs nothing.
    if (conferral.durationSeconds !== undefined) {
      const source = itemSource(item.id);
      const lasts = { kind: 'seconds', seconds: conferral.durationSeconds } as const;
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
          const timer = schedule(
            world,
            {
              kind: 'condition',
              on: outcome.target,
              instance: conditionInstanceId(condition, source),
            },
            lasts,
            undefined,
            undefined,
            conferral.endsEarly,
          );
          if (!timer.ok) return timer;
          events.push(timer.value);
        }
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
        const timer = schedule(world, { kind: 'grants', on, source }, lasts);
        if (!timer.ok) return timer;
        events.push(timer.value);
      }
    }

    return ok({ events, outcomes: resolved.value.outcomes, unverified });
  });
}
