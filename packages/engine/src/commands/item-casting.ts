/**
 * Casting a spell from a magic item, and the numbers that casting is made with.
 *
 * SRD "Spells Cast from Items" is one paragraph and it decides everything
 * here: "The spell is cast at the lowest possible spell and caster level,
 * doesn't expend any of the user's spell slots, and requires no components
 * unless the item's description notes otherwise. The spell uses its normal
 * casting time, range, and duration, and the user of the item must concentrate
 * if the spell requires Concentration." Then, a line later: "A magic item may
 * require the user to use their own spellcasting ability when casting a spell
 * from the item. If the user has more than one spellcasting ability, the user
 * chooses which one to use with the item. If the user doesn't have a
 * spellcasting ability, their spellcasting ability modifier is +0 for the item,
 * and the user's Proficiency Bonus applies."
 *
 * **The route, and nothing after it.** What this module produces is a
 * `CastingRoute` — who is casting, at what level, for how many charges, with
 * which numbers — and everything downstream of that is the pipeline a class's
 * casting already runs: `castOrRelease` validates, `resolveOnTargets` pays,
 * `resolveEffects` resolves. There is no second resolver with an item's name
 * on it, which is the whole of the decision this file implements.
 *
 * **Every refusal here is reached before anything is spent.** The charge goes
 * where a feat's free casting goes — after the targets, the range, the sight,
 * the creature types and the durations are settled, and before the first die —
 * so a wand aimed at nobody, held in an unattuned hand, or asked for a charge
 * count it does not print costs its wielder nothing at all.
 */

import type { Ability, CharacterId, Result } from '@ie/shared';
import { err, ok } from '@ie/shared';
import {
  modifierFor,
  proficiencyBonus,
  spellAttackModifierWith,
  spellSaveDcWith,
  type CharacterSheet,
} from '../character.js';
import {
  itemCasting,
  itemCastings,
  itemChargePool,
  itemSource,
  type ItemCastsGrant,
} from '../catalogue.js';
import type { Content } from '../content.js';
import type { CreatureState } from '../events.js';
import { hasPool } from '../resources.js';
import {
  castersAbilityRead,
  numbersRead,
  type SpellDefinition,
} from '../spell-definitions.js';
import type { CastingNumbers } from '../spells.js';
import type { CastingRoute } from '../spellcasting.js';

/** The item arm of {@link CastingRoute}, named once. */
export type ItemRoute = Extract<CastingRoute, { kind: 'item' }>;

/**
 * SRD: "The spell is cast at the lowest possible spell and caster level."
 *
 * The spell level is the definition's own unless the item's line names one;
 * the *caster* level has no such escape, and 1 is what "lowest possible"
 * comes to for every item in the book. It is read by a cantrip's upgrade
 * steps, which is why it has to be a number rather than the wielder's.
 */
const ITEM_CASTER_LEVEL = 1;

/** What a request says about casting from an item. */
export interface ItemCastRequest {
  /** The item's catalogue id. */
  readonly item: string;
  /** How many charges to spend, where the item lets the user choose. */
  readonly charges?: number;
  /** Which of the wielder's spellcasting abilities to use with the item. */
  readonly source?: string;
}

/**
 * Which spellcasting abilities this creature has, and what each is called.
 *
 * SRD asks the question of the *user* rather than of the spell — "if the user
 * has more than one spellcasting ability" — so this is not `routesFor`: a
 * Wizard holding a staff that casts a spell no Wizard prepares still has
 * Intelligence to bring to it.
 *
 * A class and a feat both supply one, and both are named the way `chooseRoute`
 * names them, so a caller told to pick between two says which through the same
 * `source` field they would use for a class's own casting.
 */
function abilitiesOf(creature: CreatureState): readonly { source: string; ability: Ability }[] {
  const found: { source: string; ability: Ability }[] = [];
  for (const entry of creature.spellcasting.classes) {
    found.push({ source: `class:${entry.classId}`, ability: entry.ability });
  }
  for (const grant of creature.spellcasting.granted) {
    found.push({ source: grant.source, ability: grant.ability });
  }
  return found;
}

/**
 * The wielder's own spellcasting ability for this item, or null for +0.
 *
 * SRD's three sentences in order: the one they have, the choice when they have
 * two, and "+0 for the item, and the user's Proficiency Bonus applies" when
 * they have none.
 *
 * **Distinct abilities, not distinct sources.** The book asks about the
 * ability, so a wielder with Wisdom twice over is asked nothing and one with
 * Wisdom and Intelligence is asked. The refusal is `class_required`, the code
 * `chooseRoute` answers the same question with, so a caller has one refusal to
 * recognise rather than two — and the same `source` field answers both.
 *
 * **The choice is only raised where the answer is needed.** A Wand of
 * Fireballs prints its own DC and Fireball reads nothing else, so a
 * two-ability wielder is not stopped to pick an ability the casting will never
 * read. `needed` is what says so, and it is the definition's question quite as
 * much as the item's: the same wand casting a spell *attack* would have
 * deferred a number it never printed, and SRD Dispel Magic rolls "an ability
 * check using your spellcasting ability" whatever the item's line says about
 * DCs. See where `needed` is worked out, which asks per number.
 */
function abilityForItem(
  creature: CreatureState,
  itemName: string,
  source: string | undefined,
  needed: boolean,
): Result<Ability | null> {
  const available = abilitiesOf(creature);
  const distinct = [...new Set(available.map((entry) => entry.ability))];

  if (source !== undefined) {
    const named = available.find((entry) => entry.source === source);
    if (named === undefined) {
      return err(
        'source_does_not_supply',
        `${source} gives ${creature.id} no spellcasting ability to use with ${itemName}`,
      );
    }
    return ok(named.ability);
  }

  if (distinct.length > 1) {
    if (!needed) return ok(null);
    const named = available
      .filter(
        (entry, index) =>
          available.findIndex((other) => other.ability === entry.ability) === index,
      )
      .map((entry) => entry.source)
      .join(', ');
    return err(
      'class_required',
      `${itemName} is used with your own spellcasting ability and ${creature.id} has more than one; name one of ${named}`,
    );
  }

  return ok(distinct[0] ?? null);
}

/**
 * The numbers this casting is made with, the item's first and the wielder's
 * after.
 *
 * A printed number is a field on the grant and wins outright: a Wand of
 * Fireballs held by an archmage still saves against 15, because the DC belongs
 * to the wand rather than to whoever picked it up. What the item does *not*
 * print falls to the rule the SRD prints once and no item repeats — the
 * wielder's own ability, and "+0 for the item, and the user's Proficiency
 * Bonus applies" where they have none to bring.
 *
 * The caster level is not either of those. SRD fixes it — "the lowest possible
 * spell and caster level" — so a Fire Bolt from a wand is a wand's Fire Bolt
 * however old the hand holding it is.
 */
function numbersForItem(
  sheet: CharacterSheet,
  grant: ItemCastsGrant,
  ability: Ability | null,
): CastingNumbers {
  return {
    saveDc:
      grant.saveDc ??
      (ability === null ? 8 + proficiencyBonus(sheet) : spellSaveDcWith(sheet, ability)),
    attackModifier:
      grant.attackBonus ??
      (ability === null ? proficiencyBonus(sheet) : spellAttackModifierWith(sheet, ability)),
    spellcastingModifier: ability === null ? 0 : modifierFor(sheet, ability),
    casterLevel: ITEM_CASTER_LEVEL,
  };
}

/**
 * How many charges this casting spends, and what level that buys.
 *
 * SRD Wand of Fireballs: "you can expend no more than 3 charges to cast
 * _Fireball_ (save DC 15) from it. For 1 charge, you cast the level 3 version
 * of the spell. You can increase the spell's level by 1 for each additional
 * charge you expend." An item that names no maximum casts at one price, and a
 * request that asked for a different one is refused rather than rounded down:
 * charges are the wielder's to spend and nothing else may decide how many go.
 */
function chargesFor(
  grant: ItemCastsGrant,
  itemName: string,
  asked: number | undefined,
  spellLevel: number,
): Result<{ readonly charges: number | null; readonly castLevel: number }> {
  // SRD Helm of Comprehending Languages prices its casting at nothing, so
  // there is no count to name — and a request that named one is refused rather
  // than ignored, which is what every other stated fact on a casting gets.
  if (grant.atWill === true) {
    if (asked !== undefined) {
      return err(
        'bad_charges',
        `${itemName} casts it at will and spends no charges, and ${asked} ${asked === 1 ? 'was' : 'were'} named`,
      );
    }
    return ok({ charges: null, castLevel: grant.level ?? spellLevel });
  }

  // `checkContent` has refused a grant that is neither priced nor at will, so
  // a cost is here by the time the catalogue is a `Content`.
  const cost = grant.charges ?? 0;
  const most = grant.upToCharges ?? cost;
  const spend = asked ?? cost;

  if (!Number.isInteger(spend)) {
    return err('bad_charges', `a casting spends a whole number of charges, got ${spend}`);
  }
  if (spend < cost || spend > most) {
    return err(
      'bad_charges',
      most === cost
        ? `${itemName} casts it for ${cost} charge${cost === 1 ? '' : 's'}, and ${spend} ${spend === 1 ? 'was' : 'were'} named`
        : `${itemName} casts it for ${cost} to ${most} charges, and ${spend} ${spend === 1 ? 'was' : 'were'} named`,
    );
  }

  const base = grant.level ?? spellLevel;
  return ok({ charges: spend, castLevel: base + (spend - cost) });
}

/**
 * The route a magic item supplies for this spell, or why it supplies none.
 *
 * Three of the conditions are the item's own line rather than a general rule,
 * and they are the three `expendCharges` already enforces on the economy —
 * asked here, of the route, so that **attunement gates the casting and not
 * merely the pool**: a Wand of Fireballs in an unattuned hand refuses with no
 * charge gone and no die thrown.
 *
 * - **"While holding it"**, which the SRD writes on every charged item.
 * - **"(Requires Attunement)"**, which gives nothing until it has it.
 * - **A pool that was declared**, which arrives with the equip event — asked
 *   only of an item that prices its casting, because an at-will one has no
 *   pool to declare and nothing that could run out.
 */
export function itemRoute(
  creature: CreatureState,
  /**
   * The wielder's sheet **as it stands**, handed in rather than read off the
   * creature.
   *
   * SRD leaves a wand that prints no save DC to "your spell save DC", and a
   * Headband of Intellect changes what that is. The substitution is made in the
   * command that holds the `GameState` — see `sheetAsItStands` — so this
   * function, which has none, takes the answer instead of deriving a second
   * one. The creature is still needed beside it: the attunement, what is in
   * hand and which spellcasting abilities are on offer are all facts about the
   * creature rather than about the sheet.
   */
  sheet: CharacterSheet,
  content: Content,
  definition: SpellDefinition,
  request: ItemCastRequest,
): Result<ItemRoute> {
  const item = content.item(request.item);
  if (item === null) return err('unknown_item', `${request.item} is not in the catalogue`);

  const grant = itemCasting(item, definition.id);
  if (grant === null) {
    const casts = itemCastings(item).map((one) => one.spell);
    return err(
      'item_casts_nothing',
      casts.length === 0
        ? `${item.name} casts no spell`
        : `${item.name} casts ${casts.join(' and ')}, and not this`,
    );
  }

  const held = creature.equipped.find((worn) => worn.id === item.id);
  if (held === undefined) {
    return err(
      'not_equipped',
      `${item.name} is used while holding it, and ${creature.id} is not`,
    );
  }
  if (item.attunement !== undefined && !creature.attuned.some((held) => held.id === item.id)) {
    return err(
      'not_attuned',
      `${item.name} requires attunement, and ${creature.id} has not attuned to it`,
    );
  }

  // **The pool, asked for only where there is a price to pay out of it.**
  //
  // SRD Helm of Comprehending Languages prints no charge count and no per-dawn
  // sentence, so an at-will casting has no pool, cannot find one empty and
  // cannot be refused for the want of one. `checkContent` has already refused
  // an item that is priced and declares none, so the two cases below are only
  // ever reached by a casting that really does have something to spend.
  // Keyed by the copy in hand, where the copies are told apart: a wand casts
  // out of its own charges and not out of the other wand's in the same pack.
  const priced = grant.atWill !== true;
  const pool = priced ? itemChargePool(item, held.instance) : null;
  if (priced) {
    if (pool === null) {
      return err('no_charges', `${item.name} has no charges to spend on a casting`);
    }
    if (!hasPool(creature.resources, pool.key)) {
      // A copy's pool arrives with the copy, so this is what is left when the
      // item reached this hand by a route that declared none — a hand-written
      // log, a fixture, a migration. Named rather than left looking empty,
      // which is the answer `expendCharges` gives to the same question, and
      // in the same words.
      return err(
        'unknown_pool',
        `nothing has declared ${item.name}'s charges for ${creature.id}; a copy's charges are declared when it is gained, so hand it over with awardItems`,
      );
    }
  }

  const spend = chargesFor(grant, item.name, request.charges, definition.level);
  if (!spend.ok) return spend;

  // Whether this casting needs the wielder's own ability at all, asked **per
  // number** rather than over the grant as a whole.
  //
  // SRD gives the item one clause and the spell another: "(save DC 15)" is the
  // item's and settles that number outright, while "plus your spellcasting
  // ability modifier" is the spell's and no item's line settles it. So what
  // the item deferred is exactly what it did not print, and whether the
  // wielder must be asked which of two abilities to bring depends on whether
  // *this spell* reads the number they left out. A wand printing a DC and
  // casting Fireball asks nothing; a wand printing a DC and casting a spell
  // attack has deferred the attack modifier and must ask.
  //
  // Asked here so the choice is raised — and refused — before the charge goes,
  // rather than half way through a resolution that has already taken it.
  const rollsWithIt = castersAbilityRead(definition);
  const reads = numbersRead(definition);
  const needsAbility =
    rollsWithIt ||
    reads.spellcastingModifier ||
    (grant.saveDc === undefined && reads.saveDc) ||
    (grant.attackBonus === undefined && reads.attackModifier);
  const ability = abilityForItem(creature, item.name, request.source, needsAbility);
  if (!ability.ok) return ability;

  // SRD Dispel Magic rolls "an ability check using your spellcasting ability",
  // and an ability is not a modifier: it decides the roll's modes and which
  // conditions fail it outright. "+0 for the item" answers the number and
  // nothing answers the ability, so a wielder who has none cannot make the
  // roll — said here, before anything is spent, rather than mid-resolution.
  if (rollsWithIt && ability.value === null) {
    return err(
      'no_spellcasting_ability',
      `${definition.name} is resolved with an ability check using your own spellcasting ability, and ${creature.id} has none to make it with`,
    );
  }

  return ok({
    kind: 'item',
    ability: ability.value,
    item: item.id,
    // Both absent together, and only for a casting the book prices at
    // nothing: there is no pool to name and no count to spend out of it.
    ...(pool === null || spend.value.charges === null
      ? {}
      : { pool: pool.key, charges: spend.value.charges }),
    ...(grant.targetsSelfOnly === true ? { targetsSelfOnly: true as const } : {}),
    castLevel: spend.value.castLevel,
    numbers: numbersForItem(sheet, grant, ability.value),
  });
}

/**
 * Whom this item is willing to cast at, where its own line narrows the spell.
 *
 * SRD Ring of Jumping: "While wearing this ring, you can cast _Jump_ from it,
 * but can target only yourself when you do so." Ring of Water Walking prints
 * the same narrowing over a spell that reaches ten creatures. The spell's own
 * `TargetRule` has already had its say — the range, the sight, the count and
 * the creature type are settled by the time this is asked — and what is left
 * is the one question the item asked: is every target the creature holding it.
 *
 * **A rules-legal refusal, and a value.** It is reached with the targets
 * settled and before the charge, the action and the first die, so a ring aimed
 * at an ally costs its wearer nothing; and the reason names the targets it
 * would not reach, because a caller repairing a request needs to know which.
 *
 * The holder *is* the caster: `itemRoute` has already refused a creature who
 * is not wearing or holding the item, so there is no third party for "only
 * yourself" to be ambiguous between.
 */
export function selfOnlyRefusal(
  route: CastingRoute,
  content: Content,
  definition: SpellDefinition,
  casterId: CharacterId,
  targets: readonly CharacterId[],
): Result<null> {
  if (route.kind !== 'item' || route.targetsSelfOnly !== true) return ok(null);
  const others = targets.filter((target) => target !== casterId);
  if (others.length === 0) return ok(null);
  const name = content.item(route.item)?.name ?? route.item;
  return err(
    'targets_only_yourself',
    `${name} casts ${definition.name} on whoever is holding it and nobody else, and ${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} not ${casterId}`,
  );
}

/**
 * The numbers a casting on this route is made with.
 *
 * One reader for four routes, so the item's pinned numbers and a class's
 * derived ones reach `resolveEffects` by the same door. A class route asks the
 * sheet, because that is what "your spell save DC" means; the item route
 * already answered, because a wand's answer cannot be asked for twice.
 */
export function numbersFor(sheet: CharacterSheet, route: CastingRoute): CastingNumbers {
  if (route.kind === 'item') return route.numbers;
  return {
    attackModifier: spellAttackModifierWith(sheet, route.ability),
    saveDc: spellSaveDcWith(sheet, route.ability),
    spellcastingModifier: modifierFor(sheet, route.ability),
    casterLevel: sheet.level,
  };
}

/**
 * How the log names the route that supplied the spell.
 *
 * `item:<catalogue id>` beside `class:<class id>` and a grant's own source, so
 * a log that says "cast Fireball" can say which wand did it — and so that a
 * settlement reading the record back can tell an item casting from a class's
 * without having to guess from the numbers.
 *
 * **Through {@link itemSource} rather than a second template literal**, which
 * is the same argument `castingSource` already makes: a potion's conferral
 * writes that string as the source of everything it hangs, and two spellings
 * of one name is a second place for them to drift apart.
 */
export function routeLabel(route: CastingRoute): string {
  return route.kind === 'granted'
    ? route.grant.source
    : route.kind === 'item'
      ? itemSource(route.item)
      : `class:${route.classId}`;
}

/**
 * What a request said about a casting from an item, or null when it said
 * nothing.
 *
 * `charges` without an `item` is a caller who thinks they said something: it
 * is the charge count of a wand they never named, and the shape every other
 * stated fact on the request takes is to refuse it rather than ignore it.
 */
export function itemCastOf(request: {
  readonly item?: string;
  readonly charges?: number;
  readonly source?: string;
}): Result<ItemCastRequest | null> {
  if (request.item === undefined) {
    if (request.charges !== undefined) {
      return err(
        'charges_without_an_item',
        'charges are an item\'s, and this casting named no item to spend them from',
      );
    }
    return ok(null);
  }
  return ok({
    item: request.item,
    ...(request.charges === undefined ? {} : { charges: request.charges }),
    ...(request.source === undefined ? {} : { source: request.source }),
  });
}

/**
 * Why a casting from an item may not also be paid for some other way.
 *
 * SRD: it "doesn't expend any of the user's spell slots", and the level is the
 * item's rather than a slot's. So a slot level, a payment, a stated slotless
 * reason and a Ritual are each refused rather than quietly dropped — the same
 * answer `castingOf` gives a Ritual that was handed a slot.
 */
export function itemPaysRefusal(request: {
  readonly slotLevel?: number;
  readonly slotKind?: unknown;
  readonly slotless?: unknown;
  readonly payment?: unknown;
  readonly ritual?: unknown;
}): Result<null> {
  const named =
    request.payment !== undefined
      ? 'a payment'
      : request.slotLevel !== undefined
        ? 'a slot level'
        : request.slotKind !== undefined
          ? 'a slot pool'
          : request.slotless !== undefined
            ? 'a reason for skipping a slot'
            : request.ritual !== undefined
              ? 'a Ritual'
              : null;
  if (named === null) return ok(null);
  return err(
    'item_pays_no_slot',
    `a spell cast from an item expends the item's charges and none of the caster's spell slots, so ${named} says nothing about how it is cast`,
  );
}

/** The charge count a casting from an item spends, for the batch that pays it. */
export function chargeSpend(
  route: CastingRoute,
  casterId: CharacterId,
): { readonly key: string; readonly amount: number; readonly id: CharacterId } | null {
  if (route.kind !== 'item') return null;
  // SRD Helm of Comprehending Languages prices its casting at nothing, so
  // there is no charge in the batch at all — not a charge of zero, which would
  // be a `resource-spent` for a pool that does not exist.
  if (route.pool === undefined || route.charges === undefined) return null;
  return { key: route.pool, amount: route.charges, id: casterId };
}
