import type { Armor, Weapon } from '@ie/srd';
import type { FeatureGrant } from './progression.js';
import type { PoolDeclaration } from './resources.js';
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
        // An item has no class level and makes no choices, so the three
        // level-read fields a feature's grant may carry — `diceCountByLevel`,
        // `feetByLevel`, `onlyIfChoice` — have nothing to read and are refused
        // on an item by `checkContent` rather than silently ignored here.
        reach: grant.reach === 'self' ? { kind: 'self' } : { kind: 'aura', feet: grant.auraFeet ?? 0 },
        grant: effect,
        ...(grant.requires === undefined ? {} : { requires: grant.requires }),
      });
    }
  }
  return effects;
}

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
 */
export function itemChargePool(item: CatalogueItem): PoolDeclaration | null {
  for (const grant of item.grants ?? []) {
    if (grant.kind !== 'pool') continue;
    return {
      key: grant.key,
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

/** SRD Coin Values: 1 gp is 100 cp, and every other coin divides into it. */
export const COPPER_PER = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 } as const;

export const goldToCopper = (gold: number): number => gold * COPPER_PER.gp;
