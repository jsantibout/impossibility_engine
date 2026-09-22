import type { Armor, Weapon } from '@ie/srd';
import type { FeatureGrant } from './progression.js';
import type { PoolDeclaration, Recovery } from './resources.js';
import type { StandingEffect } from './standing.js';

/**
 * What an item is, as far as the rules are concerned.
 *
 * A character sheet does not distinguish gear from tools from weapons from
 * armour — they all end up in the same pack — so every item is one record
 * under one stable id, and inventory refers to items by id and nothing else.
 * Which items exist is content (`Content.item`); this is only their shape and
 * the coin they are priced in.
 *
 * **Ids, not names.** A name is display text — the SRD's gear table
 * alphabetises by inverting them, so it prints `Lantern, Hooded` where a
 * person says "hooded lantern" — and matching on display text is how a
 * starting package silently stops containing a lantern.
 */

/**
 * What sort of thing an item is.
 *
 * The first five are the SRD's equipment tables. The rest are the categories
 * its magic items are printed under — "Ring, Rare (requires attunement)" — and
 * they are kinds rather than a flag because the book sorts by them and because
 * `EQUIPPABLE` in `commands/inventory.ts` reads exactly this to know what can
 * be worn or held. A Potion and a Scroll are the two that are *not* worn: they
 * are used up, which is a mechanism nothing has built yet.
 */
export type ItemKind =
  | 'gear'
  | 'tool'
  | 'weapon'
  | 'armor'
  | 'ammunition'
  | 'ring'
  | 'rod'
  | 'staff'
  | 'wand'
  | 'wondrous'
  | 'potion'
  | 'scroll';

/**
 * What the item's own line demands of whoever attunes to it.
 *
 * Presence is the requirement: SRD prints "(requires attunement)" with nothing
 * after it far more often than it prints a prerequisite, so an empty object is
 * a complete and common answer and an *absent* one means the item simply works
 * for anybody holding it.
 *
 * Both prerequisites the SRD actually writes, and no more. "By a Cleric or
 * Paladin" is a list because the book writes one; "by a spellcaster" is a
 * separate field because it asks a different question of a different part of
 * the sheet, and collapsing the two would make "spellcaster" a class.
 */
export interface ItemAttunement {
  /** SRD: "requires attunement by a Druid" — class ids, any one of which does. */
  readonly byClass?: readonly string[];
  /** SRD: "requires attunement by a spellcaster". */
  readonly bySpellcaster?: boolean;
}

export interface CatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** Weight in pounds. Null where the source prints "Varies" or a dash. */
  readonly weightLb: number | null;
  /** Price in copper, the one unit everything divides into. Null for "Varies". */
  readonly costCp: number | null;
  /** The armour record, for the few items Armour Class reads. */
  readonly armor: Armor | null;
  /** The weapon record, for the things an attack roll reads. */
  readonly weapon: Weapon | null;
  /** What a pack holds, in ids and quantities. Empty for everything else. */
  readonly contents: readonly { readonly id: string; readonly quantity: number }[];
  /**
   * How many the source sells at once, for a row priced by the bundle.
   *
   * Arrows are "1 GP for 20", so the catalogue holds *one arrow* at a
   * twentieth of the price and this says twenty. An inventory counts arrows,
   * not bundles — a character who shoots three has seventeen left, and a
   * bundle-shaped entry could not say so.
   */
  readonly bundleSize?: number;
  /**
   * How many hands holding this item takes up, where the printed record does
   * not already say.
   *
   * Absent is the rule in {@link handsFor}, which answers for everything the
   * SRD prints: a weapon's own properties say whether it takes one hand or
   * two, a Shield takes one, and armour is worn rather than held. This is for
   * the rest — a homebrew orb that must be held, a wondrous thing the book
   * describes as carried — and for the one direction the rule cannot reach,
   * which is an item that takes **no** hand at all.
   */
  readonly hands?: number;
  /**
   * That this item requires attunement, and what it requires of whoever does.
   *
   * Absent for everything mundane, which is almost everything.
   */
  readonly attunement?: ItemAttunement;
  /**
   * What the item does, in the vocabulary a class feature is already written
   * in.
   *
   * A magic item is a `CatalogueItem` that has grown grants rather than a
   * fourth population beside spells and classes — the SRD argues the same way,
   * calling a magic weapon "a magical version of" the equipment entry — so an
   * item's benefit is a {@link FeatureGrant} and is executed by the readers
   * that already execute one. See `docs/design/characters-and-equipment.md`.
   *
   * Today a `standing` grant and a `pool` grant are executed from an item, and
   * `checkContent` refuses the others by name rather than accepting a grant
   * nothing runs.
   */
  readonly grants?: readonly FeatureGrant[];
  /**
   * Parts of the printed item this record does **not** do.
   *
   * `SpellDefinition.unmodelled` for an item, and for the same reason: almost
   * every SRD magic item is one clean mechanic plus a rider — a cloak that
   * grants Advantage on Stealth *and* makes the Perception checks against its
   * wearer Disadvantaged, a sword that is +1 *and* burns Dragons — and the
   * riders need machinery the engine does not have. The choice is between
   * leaving the item out of the catalogue entirely and transcribing the part
   * it can while saying plainly what it left out.
   *
   * Saying so in a docstring is not enough, and one item proves it: the Cloak
   * of Elvenkind's second clause sat in a **code comment**, which nothing can
   * count, no report can total and no narrating layer can hand to a DM. This
   * is the same sentence somewhere a program can reach it.
   *
   * An item that does everything its line says carries none of these, and an
   * item whose whole text is beyond the engine is not in the catalogue at all
   * — a record with nothing but notes would be a benefit that never arrives
   * wearing an item's name.
   */
  readonly unmodelled?: readonly string[];
}

/**
 * How many hands wielding this item takes up.
 *
 * **Read off the printed record wherever the book prints it**, which is the
 * whole of the SRD's equipment table:
 *
 * | | |
 * |---|---|
 * | a weapon with the Two-Handed property | two — SRD: "this weapon requires two hands when you attack with it" |
 * | any other weapon | one |
 * | a Shield | one — SRD: "wielded in one hand" |
 * | body armour | none: it is worn |
 * | everything else | none, unless the item says otherwise |
 *
 * **Versatile is one.** SRD: "can be used with one or two hands", and the
 * damage is what changes — `attack.ts` already reads the second die off the
 * swing rather than off the hand, so a Longsword in a hand beside a Shield is
 * exactly the legal wielding the book describes.
 *
 * The last row is a default rather than a claim about wands: an item's line
 * may say what holding it costs (`CatalogueItem.hands`), and the engine's
 * rule is what answers when it does not. Refusing to equip a fifth wondrous
 * trinket is not a rule the SRD prints, and inventing one here would refuse
 * a legal character at creation.
 */
export function handsFor(item: CatalogueItem): number {
  if (item.hands !== undefined) return Math.max(0, item.hands);
  if (item.weapon !== null) return item.weapon.properties.includes('two-handed') ? 2 : 1;
  return item.armor?.category === 'shield' ? 1 : 0;
}

/**
 * The standing effects an item puts on whoever is wearing or holding it.
 *
 * The item's compiler, and the counterpart of what `creation.ts` does with a
 * feature's `standing` grant. It runs **in the command**, so what comes out is
 * pinned into the event and the fold never opens a catalogue to know what a
 * creature's cloak does.
 *
 * `feature` carries the item's id, because the item is the thing granting it:
 * that is what a log names when it says where a benefit came from, and it is
 * what `while worn` and `while attuned` look up in `equipped` and `attuned`.
 */
export function itemStandingEffects(item: CatalogueItem): readonly StandingEffect[] {
  const effects: StandingEffect[] = [];
  for (const grant of item.grants ?? []) {
    if (grant.kind !== 'standing') continue;
    for (const effect of grant.effects ?? []) {
      effects.push({
        feature: item.id,
        name: item.name,
        // An item has no class level, makes no choices and has no siblings, so
        // the fields a feature's grant reads off its table or its choice —
        // `diceCountByLevel`, `feetByLevel`, `onlyIfChoice`,
        // `damageTypesFromChoice`, `choiceFrom` — have nothing to read and are
        // refused on an item by `checkContent` rather than silently ignored
        // here.
        reach: grant.reach === 'self' ? { kind: 'self' } : { kind: 'aura', feet: grant.auraFeet ?? 0 },
        grant: effect,
        ...(grant.requires === undefined ? {} : { requires: grant.requires }),
      });
    }
  }
  return effects;
}

/**
 * The key one copy's charges are kept under: what content declared, suffixed.
 *
 * Two wands are two pools, and the only thing that can tell them apart is the
 * copy's own id. Written here, once, so the command that declares the pool and
 * the command that spends from it cannot spell it differently — and an
 * unlabelled copy keeps the unsuffixed key it has always had, which is what
 * makes every log written before copies had records fold unchanged.
 */
const instancedPoolKey = (key: string, instance: string | undefined): string =>
  instance === undefined ? key : `${key}@${instance}`;

/**
 * The keys a creature holds that belong to one copy: what
 * {@link instancedPoolKey} wrote, read back off the pools themselves.
 *
 * What a transfer needs, and the reason it needs no catalogue: the pool that
 * moves with a wand is the pool keyed to *that wand*, and the suffix the
 * engine appended is the only thing that says so. A key is otherwise a name
 * nothing reads inside — `resources.ts` says as much — so the reading lives
 * here, beside the writing, rather than there.
 */
export const instancedPoolKeys = (
  keys: readonly string[],
  instance: string,
): readonly string[] => keys.filter((key) => key.endsWith(`@${instance}`)).sort();

/**
 * The charge pool an item declares, or null for the almost everything that
 * declares none.
 *
 * The other half of the item's compiler, beside {@link itemStandingEffects}
 * and running where that one runs — **in the command** — so what comes out is
 * pinned into a `resource-pool-declared` event and the fold never opens a
 * catalogue to know how many charges a wand has.
 *
 * Charges are the pool mechanism reused rather than a second one: `resources.ts`
 * named "a magic item with seven charges" as a designed use of pools on the day
 * it was written, and `Recovery` has carried `dawn` since. So an item's line —
 * "This wand has 3 charges and regains 1d3 expended charges daily at dawn" — is
 * a `pool` grant with a flat `uses` and a `regainsAtDawn`, and everything that
 * spends, refuses and refills a Warlock's slots spends, refuses and refills
 * these.
 *
 * The **first** pool grant, because `checkContent` refuses an item that carries
 * two: an item's charges are one pool in the book and one pool here.
 *
 * **Per copy, where the copy has a record.** Charges are the one piece of
 * state an item keeps for itself, so the pool belongs to the wand rather than
 * to the kind of wand: give the copy's instance id and the key content wrote
 * comes back with that copy appended. Content writes one key per item and
 * knows nothing about copies, which is what lets a homebrew wand get a record
 * per copy without a line of content changing.
 */
export function itemChargePool(item: CatalogueItem, instance?: string): PoolDeclaration | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind !== 'pool') continue;
    return {
      key: instancedPoolKey(grant.key, instance),
      label: grant.label ?? `${item.name} charges`,
      max: grant.uses ?? 0,
      recovers: grant.recovers,
      ...(grant.regainsOnShortRest === undefined
        ? {}
        : { regainsOnShortRest: grant.regainsOnShortRest }),
      ...(grant.regainsAtDawn === undefined ? {} : { regainsAtDawn: grant.regainsAtDawn }),
    };
  }
  return null;
}

/**
 * The dice this item's charge count is rolled from, or null for the almost
 * everything that prints a number.
 *
 * Read beside {@link itemChargePool} rather than folded into it, because the
 * answer decides *who may hand the item over*: a pool whose maximum is rolled
 * cannot be declared by a door with no generator, and a `PoolDeclaration`
 * carrying dice instead of a number would push that decision into the fold.
 * An item that rolls nothing and an item with no charges at all both answer
 * null, so a caller asks one question — which is the same **first** pool
 * {@link itemChargePool} reads, because `checkContent` refuses an item that
 * declares two.
 */
export function itemChargeRoll(item: CatalogueItem): string | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind !== 'pool') continue;
    return grant.usesRolled ?? null;
  }
  return null;
}

/** What the item casts, in the grant's own words. */
export type ItemCastsGrant = Extract<FeatureGrant, { kind: 'casts' }>;

/**
 * How this item casts that spell, or null if it does not.
 *
 * The third half of the item's compiler, beside {@link itemStandingEffects}
 * and {@link itemChargePool} and running where they run — **in the command** —
 * so what it says about the casting is pinned into the events the casting
 * emits and the fold never opens a catalogue to know what a wand did.
 *
 * A list rather than one, because the SRD prints a *table* on a staff: "you
 * can cast one of the spells on the following table from it. The table
 * indicates how many charges you must expend to cast the spell." One id per
 * item, though — `checkContent` refuses two grants naming the same spell,
 * because two prices for one casting is a choice nothing could make.
 */
export function itemCasting(item: CatalogueItem, spellId: string): ItemCastsGrant | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind === 'casts' && grant.spell === spellId) return grant;
  }
  return null;
}

/** Every spell this item casts, in the order its table prints them. */
export function itemCastings(item: CatalogueItem): readonly ItemCastsGrant[] {
  return (item.grants ?? []).filter((grant): grant is ItemCastsGrant => grant.kind === 'casts');
}

/**
 * What this item counts its uses under and what each one adds to the chance of
 * failing — or null for everything that cannot fail, which is every other item
 * in the book.
 *
 * The fifth half of the item's compiler, running where the others run — **in
 * the command** — so the key and the percentage reach the events pinned, and a
 * replay reads the chance the engine actually used out of the roll it wrote
 * rather than out of this year's catalogue.
 *
 * **The count follows the copy wherever a copy has a record**, by the same
 * argument and the same suffix the charges use: a wand waved five times is that
 * wand, not the other one in the pack. A copy with no record keeps the
 * unsuffixed key and so shares its count with its fellows — which is what the
 * one item in the book that can fail actually gets, because only an item with a
 * charge pool is labelled when it is gained and this one has no charges at all.
 * The Wind Fan's own record says so in its `unmodelled`.
 *
 * The chance itself is {@link cumulativeChance} over the count the command
 * reads back under this key, because the count is state and this function has
 * none.
 */
export function itemFailureCount(
  grant: ItemCastsGrant,
  instance: string | undefined,
): { readonly key: string; readonly recovers: Recovery; readonly percentEach: number } | null {
  const clause = grant.failsCumulatively;
  if (clause === undefined) return null;
  return {
    key: instancedPoolKey(clause.key, instance),
    recovers: clause.recovers,
    percentEach: clause.percent,
  };
}

/**
 * The chance this use fails, as a percentage: what each use adds, times the
 * uses before it.
 *
 * SRD Wind Fan: "Each subsequent time the fan is used before the next dawn, it
 * has a cumulative 20 percent chance of not working." **Each subsequent time**
 * — so the first use is a zero and cannot fail, and the sixth is a hundred and
 * cannot succeed.
 *
 * Capped at a hundred, which is not a rounding: a cumulative chance the book
 * lets run past certainty still means certainty, and a percentage above a
 * hundred would be a number no die can be rolled against.
 */
export const cumulativeChance = (percentEach: number, used: number): number =>
  Math.min(100, Math.max(0, percentEach * used));

/** What the item confers without casting it, in the grant's own words. */
export type ItemConfersGrant = Extract<FeatureGrant, { kind: 'confers' }>;

/**
 * What this item confers without casting anything, or null if it confers
 * nothing.
 *
 * The fourth half of the item's compiler, beside {@link itemStandingEffects},
 * {@link itemChargePool} and {@link itemCasting}, and running where they run —
 * **in the command** — so the effects it names are resolved into events the
 * fold can read without opening a catalogue.
 *
 * **One, and the first**, unlike {@link itemCastings}: a staff prints a table
 * of spells and one charge price each, and a Potion prints one sentence.
 * `checkContent` refuses an item that carries two conferrals, because two
 * things happening when one potion is drunk is a choice nothing could make.
 */
export function itemConferral(item: CatalogueItem): ItemConfersGrant | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind === 'confers') return grant;
  }
  return null;
}

/**
 * How the log names an item, wherever an item is what something came from.
 *
 * One spelling, in one function, because two readers already ask the question:
 * `routeLabel` writes it on a `spell-cast` to say which wand cast the spell,
 * and a conferral writes it as the **source** of everything it hangs, so
 * `releaseGrants` and `removeBonusFrom` can take it off again by name.
 *
 * **It is deliberately not a casting source.** `castingSource` writes
 * `Hold Person#cast:3` and `castingIdOf` reads the id back out; this writes
 * `item:potion-of-heroism`, which `castingIdOf` answers null for — so
 * `releaseCasting`, `ongoingSpellsOn`, `spellOn` and the Dispel resolver pass
 * over an item's effect by construction rather than by being told about it.
 */
export const itemSource = (itemId: string): string => `item:${itemId}`;

/**
 * The spell level an item's conferred effect is resolved at, and the level its
 * effect list is validated against.
 *
 * SRD "Spells Cast from Items" fixes a casting from an item at "the lowest
 * possible spell and caster level", and a conferral is that sentence with the
 * casting taken out of it: nothing about a Potion of Healing depends on who
 * drinks it. One rather than zero, because zero is a cantrip and a cantrip
 * scales with the *character's* level — exactly the dependency an item's
 * printed line does not have.
 *
 * Read in two places that must agree: `checkContent`, which refuses the
 * scaling fields that would read a level nothing here has, and the resolution,
 * which passes it as both the definition's level and the cast level.
 */
export const CONFERRED_LEVEL = 1;

/** SRD Coin Values: 1 gp is 100 cp, and every other coin divides into it. */
export const COPPER_PER = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 } as const;

export const goldToCopper = (gold: number): number => gold * COPPER_PER.gp;
