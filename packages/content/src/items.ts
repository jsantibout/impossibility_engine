import { AMMUNITION, ARMOR, GEAR, TOOLS, WEAPONS, type Armor, type Weapon } from '@ie/srd';
import { COPPER_PER, type CatalogueItem } from '@ie/engine';

/**
 * Every mundane thing the SRD sells, as one catalogue under stable ids.
 *
 * The SRD splits its equipment across four tables that a character sheet does
 * not distinguish between — gear, tools, weapons, armour — so this folds all
 * of them into the engine's one `CatalogueItem` shape, keyed by the slug the
 * parsers already assign.
 */

const priceInCopper = (cost: { kind: string; value?: { amount: number; currency: string } }):
  | number
  | null => {
  if (cost.kind !== 'cost' || cost.value === undefined) return null;
  const per = COPPER_PER[cost.value.currency as keyof typeof COPPER_PER];
  return per === undefined ? null : cost.value.amount * per;
};

const weightInPounds = (weight: { kind: string; value?: number }): number | null => {
  if (weight.kind === 'lb') return weight.value ?? null;
  // "Negligible" is a real answer and it is zero; "Varies" is not an answer.
  return weight.kind === 'negligible' ? 0 : null;
};

/**
 * Things a class hands you that the equipment tables never list.
 *
 * SRD 5.2.1's Adventuring Gear table has no Spellbook row — the object is
 * defined by the Wizard's Spellbook feature instead ("a Tiny object that
 * weighs 3 pounds, contains 100 pages"), and the class package grants one. So
 * the catalogue carries it from the text that does describe it, rather than
 * letting a starting package name an item that resolves to nothing.
 *
 * No price, because the book prints none: buying one is refused rather than
 * guessed, same as any row the SRD leaves as "Varies".
 */
const CLASS_ITEMS: readonly CatalogueItem[] = [
  {
    id: 'spellbook',
    name: 'Spellbook',
    kind: 'gear',
    weightLb: 3,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
  },
];

/**
 * Things no shop sells, because a spell makes them.
 *
 * SRD Goodberry's berries and Flame Blade's blade are objects a casting puts
 * in a hand for as long as it lasts — `SpellDefinition.conjures` is how a
 * definition says so, and what appears is an ordinary catalogue item, because
 * the engine holds no things of its own. That is the same argument a magic
 * item makes about not being a population of its own, one step further along:
 * what eating a berry does is the item's `confers` grant, run by the command
 * that already drinks potions.
 *
 * **No price, and that is the entry saying what it is.** `purchaseItem`
 * refuses a row the book gives no cost for, so a berry cannot be bought and a
 * blade cannot be sold. Neither can be equipped either: `gear` is not among
 * the kinds `equipItem` accepts, so the only way either reaches a hand is the
 * casting that conjures it.
 */
const CONJURED_ITEMS: readonly CatalogueItem[] = [
  {
    /**
     * SRD Goodberry: "Ten berries appear in your hand ... A creature can take
     * a Bonus Action to eat one berry. Eating a berry restores 1 Hit Point."
     *
     * The Bonus Action and the hit point are the conferral; the ten and the
     * hand are the spell's. The nourishment is handed to the table in the
     * spell's `dmDecides`, because the engine tracks no hunger.
     */
    id: 'goodberry',
    name: 'Goodberry',
    kind: 'gear',
    weightLb: 0,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [{ kind: 'heal', healing: { flat: 1 }, addSpellcastingModifier: false }],
      },
    ],
  },
  {
    /**
     * SRD Flame Blade: "You evoke a fiery blade in your free hand. The blade
     * is similar in size and shape to a Scimitar."
     *
     * **Not a weapon record**, though it is shaped like one: the spell's own
     * Magic action is "a melee **spell** attack" for 3d6 plus the caster's
     * spellcasting modifier, which is the activation the definition already
     * writes. A weapon record here would offer a second, ordinary attack with
     * a Scimitar's die and a Strength modifier, which is a swing the book does
     * not print.
     *
     * So what the catalogue holds is the object: a thing that takes a hand.
     */
    id: 'flame-blade',
    name: 'Flame Blade',
    kind: 'gear',
    weightLb: 0,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    hands: 1,
  },
  {
    /**
     * SRD Produce Flame: "A flickering flame appears in your hand and remains
     * there for the duration."
     *
     * Flame Blade's reading one level down: the hurl is the spell's own Magic
     * action, so what the catalogue holds is the thing that takes a hand — a
     * hand a Two-Handed swing and a Somatic component both read. The light
     * the flame sheds is the spell's, shining while the flame is held.
     */
    id: 'produce-flame',
    name: 'Produce Flame',
    kind: 'gear',
    weightLb: 0,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    hands: 1,
  },
];

/**
 * Magic items, transcribed from `packages/srd/raw/magic-items.md` sentence by
 * sentence.
 *
 * A magic item is a `CatalogueItem` that has grown grants, an attunement
 * requirement and a charge pool, not a population of its own — see
 * `docs/design/characters-and-equipment.md`. `@ie/srd` parses all 258 of them;
 * what decides whether one can be *transcribed* is whether the engine has a
 * grant kind that says what its line says, and `checkContent` refuses an item
 * whose grant nothing executes rather than accepting a benefit that never
 * applies.
 *
 * **Three rules decide what is here**, and they are worth stating because the
 * absences are deliberate:
 *
 * 1. An item whose whole text is beyond the vocabulary is **left out**. A
 *    record carrying nothing but notes would be an item that arrives in a
 *    pack, grants nothing and looks transcribed.
 * 2. An item whose *remainder* is honestly recordable is transcribed, and what
 *    it does not do goes in {@link CatalogueItem.unmodelled} in the book's own
 *    words. Every note here quotes the entry it belongs to, and a test holds
 *    the quotation against the parsed record.
 * 3. An item is left out when the clause the engine **cannot** say is the one
 *    that *limits* the benefit — the Cloak of Displacement's Disadvantage
 *    stops "if you take damage", and an engine that granted the mode and not
 *    the suspension would hand out a better cloak than the book prints.
 *    **Except** (owner, 2026-09-27) where the engine already asks the table
 *    for the limit's fact on every use: then the limit may ride as a flagged
 *    `unmodelled` debt and the record stays partial. The Slippers of Spider
 *    Climbing are the case — every climb without a printed Spider Climb is
 *    reported "nobody has said what … is climbing" (`climbCheck` in
 *    `commands/movement.ts`), which is where ice or oil gets said. The
 *    Horseshoes of Speed are not: nothing asks the table about a hoof.
 *
 * The SRD prints no price for these — the tables that do are for mundane gear
 * — so it is null, and buying one is refused exactly as buying anything the
 * book declines to price is. Weight is null for the same reason, *except*
 * where the item is a magical version of a row that does print one: a +1
 * Longsword is a Longsword, and it weighs what the table says a Longsword
 * weighs.
 *
 * **Three entries arrived with the grant that says them**, and they are the
 * clearest case in the catalogue of rule 2 rather than rule 1: the Amulet of
 * Health, the Gauntlets of Ogre Power and the Headband of Intellect each
 * print one sentence, `ability-score-set` says it, and what each record does
 * *not* deliver is how far a set score reaches into the roll pipeline — which
 * is `unmodelled` on all three rather than a reason to leave them out.
 *
 * Their neighbours are **not** freed by it, and the difference is the verb.
 * `ability-score-set` writes an **absolute held while something is worn**,
 * and three other verbs are printed on entries that still wait:
 *
 * - a **bounded delta with a lifetime** — an Ioun Stone's "Your Dexterity
 *   increases by 2, to a maximum of 20, while this deep-red sphere orbits
 *   your head", the Belt of Dwarvenkind's "Your Constitution increases by 2,
 *   to a maximum of 20", and the Hammer of Thunderbolts' Might of Giants,
 *   which adds 4 to "the Strength score bestowed by your _Belt of Giant
 *   Strength_ or _Gauntlets of Ogre Power_" — a delta on top of a set, one
 *   of whose two sources is now in this file. That is
 *   `ability-score-increase`'s arithmetic on a standing grant's lifetime,
 *   and neither member has both: the one with the arithmetic is answered at
 *   creation, and the one with the lifetime writes absolutes.
 * - a **set with a deadline** rather than a garment — the Potion of Giant
 *   Strength's "your Strength score changes for 1 hour", which wants a
 *   conferral, and `CONFERRED_EFFECT_KINDS` does not admit this kind.
 * - a **permanent** raise — the three manuals and three tomes, whose +2 "to
 *   a maximum of 30" after forty-eight hours of study outlives every rest
 *   and lands on a folded number rather than a derived one.
 *
 * Two more entries print the set and are still out, for different reasons,
 * and the difference is where the number is. The Thunderous Greatclub prints
 * its own — "your Strength is 20 unless your Strength is already equal to or
 * greater than that score" — so the score has stopped being what blocks it,
 * and what keeps it out is the other four clauses: an area, a save whose
 * outcome is a fall into a fissure, a Concentration its tremor breaks, and
 * damage dealt to structures. The re-derivation of the item map took two
 * away: the Prone its Cone imposes is a condition a saving throw hands over,
 * and the extra Thunder it deals "to any creature it hits" is
 * `attack-damage` narrowed to the weapon — the clause a Frost Brand already
 * carries — so neither the condition nor a rider is what stands in its way.
 * The Belt of Giant
 * Strength prints none: "your Strength changes to a score granted by the
 * belt ... see the table below", and the table is a row per belt. So the
 * score is still its blocker as well as the versions, and it will stay one
 * until a record can say which belt this is.
 */

/** A `FeatureGrant` in the position an item puts one, named once. */
type ItemGrant = NonNullable<CatalogueItem['grants']>[number];

/** SRD, in almost every item's first clause: "while you wear this ...". */
const WORN: NonNullable<Extract<ItemGrant, { kind: 'standing' }>['requires']> = [
  { kind: 'while-worn' },
];

/** The same, plus the "(Requires Attunement)" on the line above it. */
const WORN_AND_ATTUNED: typeof WORN = [{ kind: 'while-worn' }, { kind: 'while-attuned' }];

/**
 * "You have a bonus to attack rolls and damage rolls made with this magic
 * weapon", as a grant.
 *
 * **"Made with this magic weapon" is the whole of why `onlyWithItem` exists.**
 * A character carrying this and a Shortbow has the bonus on one of them; a
 * bonus hung on the creature, which is all a spell ever needed, would quietly
 * improve the bow as well.
 *
 * One grant and not two, because the SRD writes one sentence: the attack roll
 * and the damage roll get the same number under the same clause, and the
 * damage half is of the weapon's own type, so a target resisting Slashing
 * resists the +1 with the blade.
 *
 * **Which requirements a weapon declares is what its own line prints, and it
 * is never "while you wear this".** A weapon has no wearing clause: what makes
 * a `+1, +2, or +3` weapon's bonus conditional is that `itemStandingOf` offers
 * only what is *equipped or attuned*, so a sword in a backpack grants nothing,
 * and the narrowing does the rest.
 *
 * The bracket is the other half, and it is a requirement on a weapon exactly
 * as on a ring. Seven of the weapons the book names print "(Requires
 * Attunement)", and for those the reasoning above runs out: a character who
 * picks the sword up is *equipped*, so the grant would be offered and the
 * attunement the SRD asks for would never be asked about. So an item whose
 * line prints the bracket says `while-attuned`, and an item whose line does
 * not says nothing.
 */
const madeWithThisWeapon = (flat: number, attuned = false): ItemGrant => ({
  kind: 'standing',
  reach: 'self',
  effects: [{ kind: 'flat-bonus', applies: ['attack', 'damage'], flat, onlyWithItem: true }],
  ...(attuned ? { requires: [{ kind: 'while-attuned' as const }] } : {}),
});

/**
 * "This magic weapon deals an extra NdM damage on a hit", as a grant.
 *
 * `madeWithThisWeapon`'s neighbour, and narrowed by the same clause for the
 * same reason: the die belongs to the *object*, so a character carrying a
 * Vicious Weapon and a Shortbow gets the 2d6 on one of them. A feature's extra
 * die — Rage Damage, Sneak Attack — belongs to the character and carries no
 * narrowing at all, which is the whole difference between the two populations
 * and why `checkContent` refuses this clause on a class feature.
 *
 * **The damage type decides which half of the pipeline it lands in**, and the
 * book decides the type. Vicious Weapon says "of the same type as the weapon's
 * normal damage", so it is a *bonus* and meets Resistance with the blade;
 * Frost Brand says "1d6 Cold damage", so it is *extra* and Slashing Immunity
 * does nothing to it. Naming no type here is the first of those.
 *
 * The bracket is a requirement exactly as it is for a flat bonus: a character
 * who merely picks a bracketed sword up is *equipped*, so without
 * `while-attuned` the attunement the SRD asks for would never be asked about.
 */
const extraDamageWithThisWeapon = (
  dice: string,
  damageType?: string,
  attuned = false,
): ItemGrant => ({
  kind: 'standing',
  reach: 'self',
  effects: [
    {
      kind: 'attack-damage',
      dice,
      onlyWithItem: true,
      ...(damageType === undefined ? {} : { damageType }),
    },
  ],
  ...(attuned ? { requires: [{ kind: 'while-attuned' as const }] } : {}),
});

/** "You gain a +N bonus to Armor Class while you wear this ...", as a grant. */
const armorClassWhileWorn = (flat: number, attuned = false): ItemGrant => ({
  kind: 'standing',
  reach: 'self',
  effects: [{ kind: 'flat-bonus', applies: ['ac'], flat }],
  requires: attuned ? WORN_AND_ATTUNED : WORN,
});

/** "You have Resistance to ... damage while you wear this ...", as a grant. */
const resistanceWhileWorn = (damageTypes: readonly string[], attuned = true): ItemGrant => ({
  kind: 'standing',
  reach: 'self',
  effects: [{ kind: 'damage-resistance', damageTypes }],
  requires: attuned ? WORN_AND_ATTUNED : WORN,
});

/**
 * "This wand has N charges and regains XdY expended charges daily at dawn."
 *
 * The pool mechanism reused rather than a second one: `resources.ts` named "a
 * magic item with seven charges" as a designed use of pools on the day it was
 * written, and `Recovery` has carried `dawn` since.
 */
const charges = (
  id: string,
  name: string,
  uses: number,
  regainsAtDawn?: string,
  onLastCharge?: LastCharge,
): ItemGrant => ({
  kind: 'pool',
  key: `${id}:charges`,
  label: `${name} charges`,
  uses,
  recovers: 'dawn',
  ...(regainsAtDawn === undefined ? {} : { regainsAtDawn }),
  ...(onLastCharge === undefined ? {} : { onLastCharge }),
});

/** What spending an item's last charge does to it, in the pool's words. */
type LastCharge = NonNullable<Extract<ItemGrant, { kind: 'pool' }>['onLastCharge']>;

/**
 * SRD, under nine wands and staffs and in almost the same words each time:
 * "If you expend the wand's last charge, roll 1d20. On a 1, the wand crumbles
 * into ashes and is destroyed."
 *
 * **A clause that limits the item**, which is why it is a field and not a
 * note: a record without it is a wand that outlasts the book's. The engine
 * throws the d20 at the spend that empties the pool, and on a 1 the copy
 * leaves the hand and the pack — however the entry words the leaving: ashes,
 * cinders, "a harmless burst of radiance".
 */
const CRUMBLES_ON_A_1: LastCharge = { destroyed: true, onD20AtOrBelow: 1 };

/**
 * A count with **no morning behind it**: "The chime can be used 10 times",
 * "When found, a container contains 1d6 + 1 ounces".
 *
 * The same pool as {@link charges} with the recovery the page prints, which
 * for these is none at all. `recovers: 'special'` is `resources.ts` saying so
 * — no rest and no declared dawn touches one — and the tag matters more here
 * than anywhere else in this file, because the neighbouring value is not
 * neutral: a `dawn` pool with no dice **refills**, so a chime tagged `dawn`
 * would open ten doors every morning where the book gives it ten in its life.
 * That is rule 3 of this file running the wrong way, which is why the two
 * sentences get two helpers rather than a default.
 *
 * The label is the page's noun rather than "charges", because the book counts
 * ounces and strikes and beads: a pool is a count of *something*, and the only
 * place that says which is the line printed beside it.
 */
const countedUses = (id: string, label: string, uses: number): ItemGrant => ({
  kind: 'pool',
  key: `${id}:charges`,
  label,
  uses,
  recovers: 'special',
});

/**
 * The same pool, where the book **rolls** how many it holds.
 *
 * SRD Sovereign Glue: "This glue is found in a jar or flask containing 1d6 +
 * 1 ounces." The count is a die and not a number, so the pool says so and the
 * door that hands the copy over throws it once, at the copy's birth, and pins
 * it. A pool may not print both a rolled maximum and a flat `uses` — two
 * maxima for one pool is what `item_pool_sized_twice` refuses — so this is
 * the whole of the sizing rather than a floor beneath it.
 */
const rolledUses = (id: string, label: string, usesRolled: string): ItemGrant => ({
  kind: 'pool',
  key: `${id}:charges`,
  label,
  usesRolled,
  recovers: 'special',
});

/**
 * "You can cast _X_ from it", as a grant.
 *
 * SRD "Spells Cast from Items" settles what that sentence means and the engine
 * does not have to have an opinion: the casting runs down the pipeline a
 * Wizard's casting runs down, and what the item supplies is the price, the
 * level and — where its own line prints them — the numbers.
 *
 * **What is *not* here is as deliberate as what is.** No ability, because the
 * fallback the SRD prints once ("using your spell save DC", and +0 with
 * Proficiency where there is none) is a rule in the resolver rather than
 * something an item could restate; and no caster level, because the book fixes
 * it at the lowest possible for every item at once.
 */
const castsSpell = (
  spell: string,
  cost: number,
  extra: {
    /** SRD: "you can expend no more than N charges". */
    readonly upToCharges?: number;
    /** SRD Wand of Fireballs: "(save DC 15)". */
    readonly saveDc?: number;
    /** SRD Circlet of Blasting: "(+5 to hit)". */
    readonly attackBonus?: number;
    /** The level the least charge count casts it at, where the line names one. */
    readonly level?: number;
  } = {},
): ItemGrant => ({ kind: 'casts', spell, charges: cost, ...extra });

/**
 * The same sentence with no price after it: "you can cast _X_ from it".
 *
 * SRD Helm of Comprehending Languages prints one line and nothing else — no
 * charge count, no "this property can't be used again until the next dawn",
 * no table — so the item casts and nothing at all runs out. That is a
 * different claim from the per-day property the Cape of the Mountebank writes,
 * which is a pool of one, and `atWill` is what distinguishes them: an absence
 * read as a licence would make a dropped field into a free casting.
 *
 * `targetsSelfOnly` is the other clause two rings print — "but can target only
 * yourself when you do so" — and it is rule 3 of this file answered rather
 * than triggered: the clause that limits the benefit is now one the engine can
 * say, so the item goes in narrowed instead of staying out.
 */
const castsSpellAtWill = (
  spell: string,
  extra: {
    /** SRD Ring of Jumping: "but can target only yourself when you do so." */
    readonly targetsSelfOnly?: true;
    /**
     * SRD Crystal Ball: "you can cast _Scrying_ (save DC 17) with it."
     *
     * A printed number and no price at all, which the two clauses were never
     * exclusive about: what `atWill` refuses beside it is a *cost*, and a DC
     * is not one. Left off, `numbersForItem` substitutes the holder's own
     * number rather than leaving the field empty, so an orb anybody may pick
     * up would scry against whatever the person holding it happened to be.
     */
    readonly saveDc?: number;
    /**
     * SRD Wind Fan: "Each subsequent time the fan is used before the next
     * dawn, it has a cumulative 20 percent chance of not working; if the fan
     * fails to work, it tears into useless, nonmagical tatters."
     *
     * A clause beside `atWill` rather than a price, and the two say different
     * things: the fan costs nothing to use, and using it is not free of
     * consequence. A pool would have said the second badly — running out is a
     * refusal, and what the book prints is a die and a torn fan.
     */
    readonly failsCumulatively?: NonNullable<
      Extract<ItemGrant, { kind: 'casts' }>['failsCumulatively']
    >;
  } = {},
): ItemGrant => ({ kind: 'casts', spell, atWill: true, ...extra });

/**
 * The weapon record a magic weapon is a magical version of.
 *
 * SRD writes a whole family as one entry — "Weapon, +1, +2, or +3: Weapon
 * (Any Simple or Martial)" — so a catalogue entry is that template applied to
 * one row, and the row's *mechanics* are carried verbatim: the damage, the
 * properties, the mastery and the category of a +1 Longsword are a Longsword's,
 * and `weapon.id` stays the mundane row's because that is the entry this is a
 * magical version of.
 *
 * The **name** is the magic item's, because `weapon.name` is display text and
 * nothing else — it is what the attack's label and the damage component's
 * source read — so leaving it as "Longsword" would file a magic swing under a
 * mundane name in the log and leave the +1 the only line that said which sword
 * this was.
 */
const magicalVersionOf = (id: string, name: string): Weapon => {
  const found = WEAPONS.find((weapon) => weapon.id === id);
  if (found === undefined) throw new Error(`no SRD weapon is filed under ${id}`);
  return { ...found, name };
};

/** The same template, for the armour rows. */
const magicalArmorOf = (id: string, name: string): Armor => {
  const found = ARMOR.find((piece) => piece.id === id);
  if (found === undefined) throw new Error(`no SRD armour is filed under ${id}`);
  return { ...found, name };
};

/** A magic weapon built on one row of the Weapons table. */
const magicWeapon = (
  item: {
    readonly id: string;
    readonly name: string;
    readonly row: string;
    readonly kind?: CatalogueItem['kind'];
  },
  rest: Partial<CatalogueItem>,
): CatalogueItem => {
  const weapon = magicalVersionOf(item.row, item.name);
  return {
    id: item.id,
    name: item.name,
    kind: item.kind ?? 'weapon',
    weightLb: weapon.weightLb,
    costCp: null,
    armor: null,
    weapon,
    contents: [],
    ...rest,
  };
};

/** A magic suit of armour or Shield built on one row of the Armor table. */
const magicArmor = (
  item: { readonly id: string; readonly name: string; readonly row: string },
  rest: Partial<CatalogueItem>,
): CatalogueItem => {
  const armor = magicalArmorOf(item.row, item.name);
  return {
    id: item.id,
    name: item.name,
    kind: 'armor',
    weightLb: armor.weightLb,
    costCp: null,
    armor,
    weapon: null,
    contents: [],
    ...rest,
  };
};

/** Everything else: a ring, a wand, a staff, a wondrous item. */
const wornItem = (
  item: { readonly id: string; readonly name: string; readonly kind: CatalogueItem['kind'] },
  rest: Partial<CatalogueItem>,
): CatalogueItem => ({
  id: item.id,
  name: item.name,
  kind: item.kind,
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  ...rest,
});

/**
 * The three entries the SRD writes as a template over a whole equipment table,
 * applied to every row of it.
 *
 * "Weapon (Any Simple or Martial)" is every row of the Weapons table at three
 * rarities; "Armor (Any Light, Medium, or Heavy)" is every row but the Shield,
 * which has an entry and a rarity line of its own. Written out by hand each
 * instance would be another chance to mistype a die, so it is a loop over the
 * parsed tables instead — the same argument the mundane catalogue below already
 * makes, and it means a re-vendored SRD that added a weapon adds its magic
 * versions too.
 *
 * The rarity is not carried, because a `CatalogueItem` has no rarity: what the
 * rarity *decides* is the number, and the number is on the grant. The test
 * holds each instance's bonus against the qualifier the book prints beside the
 * rarity ("Rare (+2)"), which is the same claim from the other end.
 */
const PLUS_RARITIES = [1, 2, 3] as const;

const PLUS_WEAPONS: readonly CatalogueItem[] = WEAPONS.flatMap((row) =>
  PLUS_RARITIES.map((plus) =>
    magicWeapon(
      { id: `${row.id}-plus-${plus}`, name: `+${plus} ${row.name}`, row: row.id },
      { grants: [madeWithThisWeapon(plus)] },
    ),
  ),
);

const PLUS_ARMOR: readonly CatalogueItem[] = ARMOR.filter(
  (row) => row.category !== 'shield',
).flatMap((row) =>
  PLUS_RARITIES.map((plus) =>
    magicArmor(
      { id: `${row.id}-plus-${plus}`, name: `+${plus} ${row.name}`, row: row.id },
      { grants: [armorClassWhileWorn(plus)] },
    ),
  ),
);

/**
 * SRD Shield, +1, +2, or +3: "While holding this Shield, you have a bonus to
 * Armor Class determined by the Shield's rarity, in addition to the Shield's
 * normal bonus to AC."
 *
 * "In addition to the Shield's normal bonus" needs no saying here: the +2 a
 * Shield gives is on the armour record, the magic bonus is a standing effect,
 * and `armorClassOf` adds both because they arrive by different roads.
 */
const PLUS_SHIELDS: readonly CatalogueItem[] = PLUS_RARITIES.map((plus) =>
  magicArmor(
    { id: `shield-plus-${plus}`, name: `+${plus} Shield`, row: 'shield' },
    { grants: [armorClassWhileWorn(plus)] },
  ),
);

/**
 * SRD Mithral Armor: "Armor (Any Medium or Heavy, Except Hide Armor),
 * Uncommon. Mithral is a light, flexible metal. Armor made of this substance
 * can be worn under normal clothes. If the armor normally imposes Disadvantage
 * on Dexterity (Stealth) checks or has a Strength requirement, the mithral
 * version of the armor doesn't."
 *
 * **The one magic item in this tranche that is not a grant at all.** What it
 * changes is two fields of the armour record — the fields `checks.ts` reads to
 * impose Disadvantage on Stealth and `character.ts` reads to slow a character
 * carrying too little Strength — so the mithral version is the row with those
 * two answers changed, pinned into the equip event like any other armour, and
 * nothing standing is granted or has to be derived.
 *
 * Hide Armor is excluded because the book excludes it.
 */
const MITHRAL_ARMOR: readonly CatalogueItem[] = ARMOR.filter(
  (row) => (row.category === 'medium' || row.category === 'heavy') && row.id !== 'hide-armor',
).map((row) => ({
  id: `mithral-${row.id}`,
  name: `Mithral ${row.name}`,
  kind: 'armor' as const,
  weightLb: row.weightLb,
  costCp: null,
  armor: {
    ...row,
    name: `Mithral ${row.name}`,
    stealthDisadvantage: false,
    strengthRequirement: null,
  },
  weapon: null,
  contents: [],
}));

/**
 * SRD Adamantine Armor: "Armor (Any Medium or Heavy, Except Hide Armor),
 * Uncommon. This suit of armor is reinforced with adamantine, one of the
 * hardest substances in existence. While you're wearing it, any Critical Hit
 * against you becomes a normal hit."
 *
 * **Mithral's twin over the same rows**, and a grant where Mithral is a
 * changed record: what adamantine changes is not a field of the armour but
 * what an attack against its wearer does, so every row carries the
 * `critical-hits-become-hits` marker while worn, and the command rolling an
 * attack at the wearer — a weapon's, a stat block's or a spell's — keeps the
 * hit and drops the critical.
 *
 * Hide Armor is excluded because the book excludes it.
 */
const ADAMANTINE_ARMOR: readonly CatalogueItem[] = ARMOR.filter(
  (row) => (row.category === 'medium' || row.category === 'heavy') && row.id !== 'hide-armor',
).map((row) => ({
  id: `adamantine-${row.id}`,
  name: `Adamantine ${row.name}`,
  kind: 'armor' as const,
  weightLb: row.weightLb,
  costCp: null,
  armor: { ...row, name: `Adamantine ${row.name}` },
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing' as const,
      reach: 'self' as const,
      effects: [{ kind: 'critical-hits-become-hits' as const }],
      requires: WORN,
    },
  ],
}));

/**
 * The named items, one at a time, each with the sentence it was read from.
 *
 * A family entry above is a template; these are the entries the book prints
 * under one name. Where such an entry still names a list of rows — "Weapon
 * (Any Simple or Martial)" for a Dragon Slayer — one row is chosen and said so,
 * exactly as the +1 Longsword chooses one: which row a Dragon Slayer was
 * forged from is the table's business, and the mechanics this records are the
 * same whichever it was.
 */
const NAMED_ITEMS: readonly CatalogueItem[] = [
  // ── worn things that grant a number ──────────────────────────────────────
  wornItem(
    { id: 'ring-of-protection', name: 'Ring of Protection', kind: 'ring' },
    {
      /**
       * SRD Ring of Protection: "Ring, Rare (Requires Attunement). You gain a
       * +1 bonus to Armor Class and saving throws while wearing this ring."
       *
       * The first item in the catalogue to raise an Armour Class, which no
       * grant kind could say before this one. Two requirements from two
       * clauses: the bracket on the type line and "while wearing" in the
       * sentence itself.
       *
       * **No narrowing**, and none is legal: an Armour Class and a saving
       * throw are had rather than made, so there is nothing a roll could be
       * made *with* and `checkContent` refuses the pairing.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ac', 'save'], flat: 1 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'cloak-of-protection', name: 'Cloak of Protection', kind: 'wondrous' },
    {
      /**
       * SRD Cloak of Protection: "Wondrous Item, Uncommon (Requires
       * Attunement). You gain a +1 bonus to Armor Class and saving throws
       * while you wear this cloak."
       *
       * **The Ring of Protection's sentence word for word, on a second name.**
       * The engine's "same name, most potent" reading (SRD 5.2.1 prints it for
       * spells only; the 2014 rules gave it to every game feature): two
       * *different* names both apply, so a character wearing both is +2 —
       * and the rule is only testable with two items that say the same thing.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ac', 'save'], flat: 1 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'bracers-of-defense', name: 'Bracers of Defense', kind: 'wondrous' },
    {
      /**
       * SRD Bracers of Defense: "While wearing these bracers, you gain a +2
       * bonus to Armor Class if you are wearing no armor and using no Shield."
       *
       * The last clause is `unarmored`, which the Monk's Unarmored Movement
       * already asks in the same two halves — no armour *and* no Shield — so
       * the bracers need no requirement of their own beyond the two every worn
       * item has.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ac'], flat: 2 }],
          requires: [...WORN_AND_ATTUNED, { kind: 'unarmored' }],
        },
      ],
    },
  ),
  wornItem(
    { id: 'stone-of-good-luck', name: 'Stone of Good Luck (Luckstone)', kind: 'wondrous' },
    {
      /**
       * SRD Stone of Good Luck (Luckstone): "Wondrous Item, Uncommon (Requires
       * Attunement). While this polished agate is on your person, you gain a
       * +1 bonus to ability checks and saving throws."
       *
       * **"On your person" is attunement and nothing else**, and this is the
       * one item that makes the distinction pay. A stone in a pocket is not
       * worn, so `while-worn` would withhold a benefit the book gives; but
       * attunement already requires having the item and ends when you no
       * longer do, so "attuned" says exactly what the sentence says. The whole
       * of the item is transcribed and there is nothing to declare.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ability-check', 'save'], flat: 1 }],
          requires: [{ kind: 'while-attuned' }],
        },
      ],
    },
  ),
  wornItem(
    { id: 'robe-of-stars', name: 'Robe of Stars', kind: 'wondrous' },
    {
      /**
       * SRD Robe of Stars: "You gain a +1 bonus to saving throws while you
       * wear it."
       *
       * The rest of the robe is a Magic action that spends a star and a walk
       * into the Astral Plane, and one line of it is the only `dusk` in the
       * book — a second time of day the clock has no more of than it has dawn.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['save'], flat: 1 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        'the six stars: "you can take a Magic action to remove one of the stars and expend it to cast the level 5 version of _Magic Missile_", which is a spell resolved from an item — the unbuilt `use` grant — and is refilled by the one clause in the book that says "Daily at dusk, 1d6 removed stars reappear on the robe", a time of day the clock does not have',
        '"you can take a Magic action to enter the Astral Plane along with everything you are wearing and carrying": there are no planes here, and where a creature is that is not in the scene is the DM\'s',
      ],
    },
  ),

  // ── worn things that set an ability score ──────────────────────────
  wornItem(
    { id: 'amulet-of-health', name: 'Amulet of Health', kind: 'wondrous' },
    {
      /**
       * SRD Amulet of Health: "Wondrous Item, Rare (Requires Attunement).
       * Your Constitution is 19 while you wear this amulet. It has no effect
       * on you if your Constitution is 19 or higher without it."
       *
       * The first of three entries whose whole text is one `ability-score-set`
       * grant. The second sentence is not a second clause to record: never
       * lowering a score is the rule {@link abilityScoresOf} keeps for every
       * item that sets one, so an item saying it again would be the same rule
       * written twice.
       *
       * Two requirements from two clauses, as the Ring of Protection has:
       * the bracket on the type line and "while you wear" in the sentence.
       *
       * The only one of the three that still leaves anything to the table, and
       * the one note left is about the one thing a derived read cannot reach:
       * a Constitution is *derived* into every D20 Test — and into the Hit Die
       * a Short Rest spends, which asks the sheet as it stands — but *folded*
       * into a hit point maximum the engine settled a level at a time.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'ability-score-set', ability: 'con', score: 19 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        'what a Constitution of 19 does to a hit point maximum. "Your Constitution is 19 while you wear this amulet" changes the modifier every level paid, and a maximum is a folded number rather than a derived one, so putting the amulet on does not add hit points and taking it off does not take them away',
      ],
    },
  ),
  wornItem(
    { id: 'gauntlets-of-ogre-power', name: 'Gauntlets of Ogre Power', kind: 'wondrous' },
    {
      /**
       * SRD Gauntlets of Ogre Power: "Wondrous Item, Uncommon (Requires
       * Attunement). Your Strength is 19 while you wear these gauntlets. They
       * have no effect on you if your Strength is 19 or higher without them."
       *
       * The Amulet of Health's sentence on a different score, which is what
       * made a `set` a shape rather than one item's quirk.
       *
       * **And it carries no `unmodelled` note, because there is nothing left
       * to note.** Every number a Strength decides is derived on the read now —
       * the attack roll and its damage, the Athletics check, the Strength save,
       * the Armour Class a heavy suit's requirement penalises, the Heavy
       * weapon's Disadvantage — because each command asks `sheetAsItStands` and
       * hands the answer to the roller. A note kept alive past the gap it
       * described is exactly what this field exists to prevent.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'ability-score-set', ability: 'str', score: 19 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'headband-of-intellect', name: 'Headband of Intellect', kind: 'wondrous' },
    {
      /**
       * SRD Headband of Intellect: "Wondrous Item, Uncommon (Requires
       * Attunement). Your Intelligence is 19 while you wear this headband. It
       * has no effect on you if your Intelligence is 19 or higher without
       * it."
       *
       * The third printing of the same sentence, and the one that shows what
       * the substitution bought: a Wizard's spell save DC and spell attack
       * modifier are derived from Intelligence at the moment of the casting,
       * so a headband put on between two fights changes both — and it carries
       * no `unmodelled` note for the same reason the gauntlets carry none.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'ability-score-set', ability: 'int', score: 19 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),

  // ── worn things that grant a defence ─────────────────────────────────────
  wornItem(
    { id: 'boots-of-the-winterlands', name: 'Boots of the Winterlands', kind: 'wondrous' },
    {
      /**
       * SRD Boots of the Winterlands: "_Cold Resistance._ You have Resistance
       * to Cold damage and can tolerate temperatures of 0 degrees Fahrenheit
       * or lower without any additional protection."
       *
       * **The temperature is handed over and the terrain is owed**, which is
       * the debt/handover test run on two halves of one item. How cold it is
       * is the table's, and the one rule the SRD prints about it reads nothing
       * the boots do not already grant: Extreme Cold's save is automatically
       * made by "Creatures that have Resistance or Immunity to Cold damage"
       * (Gameplay Toolbox), and the Resistance is the grant above. Ice and
       * snow are different: Difficult Terrain is a patch movement reads, and a
       * patch made of ice is a fact a rule would then consult — so that stays
       * a debt.
       */
      attunement: {},
      grants: [resistanceWhileWorn(['cold'])],
      unmodelled: [
        '"_Winter Strider._ You ignore Difficult Terrain created by ice or snow": terrain has no kinds in the engine, and what a square is made of is the DM\'s',
      ],
      dmDecides: [
        'You ... can tolerate temperatures of 0 degrees Fahrenheit or lower without any additional protection.',
      ],
    },
  ),
  wornItem(
    { id: 'brooch-of-shielding', name: 'Brooch of Shielding', kind: 'wondrous' },
    {
      /**
       * SRD Brooch of Shielding: "While wearing this brooch, you have
       * Resistance to Force damage, and you have Immunity to damage from the
       * _Magic Missile_ spell."
       *
       * Half a sentence each way: Resistance is a defence the engine grants,
       * and immunity to one named spell's damage is a defence keyed to a
       * *source* rather than a type, which nothing can express.
       */
      attunement: {},
      grants: [resistanceWhileWorn(['force'])],
      unmodelled: [
        'the second clause, "you have Immunity to damage from the _Magic Missile_ spell": a defence against one named spell rather than against a damage type, which `defensesOf` has no key for — and Magic Missile is not an executable definition here either',
      ],
    },
  ),
  wornItem(
    {
      id: 'periapt-of-proof-against-poison',
      name: 'Periapt of Proof against Poison',
      kind: 'wondrous',
    },
    {
      /**
       * SRD Periapt of Proof against Poison: "While you wear it, you have
       * Immunity to the Poisoned condition and Poison damage."
       *
       * One clause names a condition and the other a damage type, and the
       * engine grants immunity to the first and only Resistance to the second
       * — so the condition half is transcribed and the damage half is
       * declared, rather than quietly downgraded to Resistance, which would be
       * a different item.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'condition-immunity', condition: 'poisoned' }],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        'the damage half of "you have Immunity to the Poisoned condition and Poison damage": a standing grant offers Resistance and not Immunity, and halving Poison damage is not what this sentence says, so nothing at all is granted against it',
        'the condition half is granted as suppression rather than prevention: a `condition-immunity` effect is SRD Aura of Courage\'s, where the condition is still on the creature and does nothing while the effect holds, whereas "Immunity to the Poisoned condition" would keep it off them in the first place. What differs is what a reader of the record sees, and what happens the moment the pendant comes off',
      ],
    },
  ),

  // ── worn things that grant a mode ────────────────────────────────────────
  wornItem(
    { id: 'cloak-of-elvenkind', name: 'Cloak of Elvenkind', kind: 'wondrous' },
    {
      /**
       * SRD Cloak of Elvenkind: "While you wear this cloak, Wisdom
       * (Perception) checks made to perceive you have Disadvantage, and you
       * have Advantage on Dexterity (Stealth) checks."
       *
       * **Half of that sentence is transcribed and half is not, deliberately.**
       * The Stealth clause is an ordinary `roll-mode` grant. The Perception one
       * is a mode on rolls made *against* the wearer, and `against-holder` is
       * legal only on an attack roll — an attack is the one D20 Test the engine
       * records a target for, so "checks made to perceive you" cannot be picked
       * out at all.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: {
                  roll: 'ability-check',
                  relation: 'roller',
                  ability: 'dex',
                  skill: 'stealth',
                },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        'the first clause, "Wisdom (Perception) checks made to perceive you have Disadvantage": a mode on rolls made *against* the wearer, and `against-holder` is legal only on an attack roll — an attack is the one D20 Test the engine records a target for, so a check made to perceive somebody cannot be picked out at all',
      ],
    },
  ),
  wornItem(
    { id: 'boots-of-elvenkind', name: 'Boots of Elvenkind', kind: 'wondrous' },
    {
      /**
       * SRD Boots of Elvenkind: "Wondrous Item, Uncommon. While you wear these
       * boots, your steps make no sound, regardless of the surface you are
       * moving across. You also have Advantage on Dexterity (Stealth) checks."
       *
       * The Cloak's transcribable half on an item that requires no attunement:
       * one requirement rather than two, which is what makes the pair worth
       * having — "while worn" and "while attuned" are separable and this is the
       * item that separates them.
       *
       * **The silence is the table's.** Hearing is modelled nowhere: a check
       * that relies on it says so through its caller, and whether a guard
       * hears a footstep is the DM's call before any die is thrown. No rule
       * reads what a step sounds like, so the first sentence is handed over
       * and the second is granted.
       */
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: {
                  roll: 'ability-check',
                  relation: 'roller',
                  ability: 'dex',
                  skill: 'stealth',
                },
              },
            },
          ],
          requires: WORN,
        },
      ],
      dmDecides: [
        'While you wear these boots, your steps make no sound, regardless of the surface you are moving across.',
      ],
    },
  ),

  // ── armour ───────────────────────────────────────────────────────────────
  magicArmor(
    { id: 'elven-chain', name: 'Elven Chain', row: 'chain-shirt' },
    {
      /**
       * SRD Elven Chain: "Armor (Chain Mail or Chain Shirt), Rare. You gain a
       * +1 bonus to Armor Class while you wear this armor. You are considered
       * trained with this armor even if you lack training with Medium or Heavy
       * armor."
       *
       * Built on the Chain Shirt, one of the two rows its own line names.
       */
      grants: [armorClassWhileWorn(1)],
      unmodelled: [
        '"You are considered trained with this armor even if you lack training with Medium or Heavy armor": armour training is a field of the sheet rather than a standing effect, and an item cannot add one',
      ],
    },
  ),
  magicArmor(
    { id: 'glamoured-studded-leather', name: 'Glamoured Studded Leather', row: 'studded-leather-armor' },
    {
      /**
       * SRD: "While wearing this armor, you gain a +1 bonus to Armor Class."
       *
       * **The glamour is handed over whole, Bonus Action and all.** What a
       * suit of armour looks like is read by no rule, and the Bonus Action is
       * the price of that table fact — handed over the way Clairvoyance's
       * Bonus Action switching sight for hearing and Mage Hand's Magic action
       * are, because nothing it buys is anything the engine could hold.
       */
      grants: [armorClassWhileWorn(1)],
      dmDecides: [
        'You can also take a Bonus Action to cause the armor to assume the appearance of a normal set of clothing or some other kind of armor.',
        'You decide what it looks like—including color, style, and accessories—but the armor retains its normal bulk and weight.',
        'The illusory appearance lasts until you use this property again or doff the armor.',
      ],
    },
  ),
  magicArmor(
    { id: 'dwarven-plate', name: 'Dwarven Plate', row: 'plate-armor' },
    {
      /**
       * SRD Dwarven Plate: "Armor (Half Plate Armor or Plate Armor), Very
       * Rare. While wearing this armor, you gain a +2 bonus to Armor Class."
       */
      grants: [armorClassWhileWorn(2)],
      unmodelled: [
        '"if an effect moves you against your will along the ground, you can take a Reaction to reduce the distance you are moved by up to 10 feet": forced movement has no reaction window, and nothing offers one',
      ],
    },
  ),
  magicArmor(
    { id: 'armor-of-invulnerability', name: 'Armor of Invulnerability', row: 'plate-armor' },
    {
      /**
       * SRD Armor of Invulnerability: "Armor (Plate Armor), Legendary
       * (Requires Attunement). You have Resistance to Bludgeoning, Piercing,
       * and Slashing damage while you wear this armor. **_Metal Shell._** You
       * can take a Magic action to give yourself Immunity to Bludgeoning,
       * Piercing, and Slashing damage for 10 minutes or until you are no
       * longer wearing the armor. Once this property is used, it can't be used
       * again until the next dawn."
       *
       * **Transcribed whole.** The Resistance is worn; Metal Shell is the
       * Periapt of Health's shape — a per-dawn pool of one and a conferral
       * priced at it — with an Immunity where the healing is, for ten
       * minutes. What kept it out was the clause that *limits* it, which is
       * `items.ts` rule 3: a conferral used to run its span after the armour
       * came off. `source-item-removed` is that clause, filed on the grant's
       * own timer, so taking the plate off ends the shell with it.
       */
      attunement: {},
      grants: [
        resistanceWhileWorn(['bludgeoning', 'piercing', 'slashing']),
        charges('armor-of-invulnerability', 'Armor of Invulnerability', 1),
        {
          kind: 'confers',
          action: 'action',
          charges: 1,
          durationSeconds: 600,
          endsEarly: ['source-item-removed'],
          effects: [
            {
              kind: 'damage-defense',
              damageTypes: ['bludgeoning', 'piercing', 'slashing'],
              defense: 'immune',
            },
          ],
        },
      ],
    },
  ),
  magicArmor(
    { id: 'sentinel-shield', name: 'Sentinel Shield', row: 'shield' },
    {
      /**
       * SRD Sentinel Shield: "Armor (Shield), Uncommon. While holding this
       * Shield, you have Advantage on Initiative rolls and Wisdom (Perception)
       * checks. The Shield is emblazoned with a symbol of an eye."
       *
       * **Transcribed whole**, and the only item here that reaches two
       * different roll families from one sentence: Initiative is a family of
       * its own — it is neither a check nor a save — and a selector that said
       * "Wisdom" of both would have granted the wrong one.
       */
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: { mode: 'advantage', selector: { roll: 'initiative', relation: 'roller' } },
            },
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: {
                  roll: 'ability-check',
                  relation: 'roller',
                  ability: 'wis',
                  skill: 'perception',
                },
              },
            },
          ],
          requires: WORN,
        },
      ],
    },
  ),
  magicArmor(
    { id: 'shield-of-the-cavalier', name: 'Shield of the Cavalier', row: 'shield' },
    {
      /**
       * SRD Shield of the Cavalier: "While holding this Shield, you have a +2
       * bonus to Armor Class. This bonus is in addition to the Shield's normal
       * bonus to AC."
       */
      attunement: {},
      grants: [armorClassWhileWorn(2, true)],
      unmodelled: [
        '"_Forceful Bash._ When you take the Attack action, you can make one of the attack rolls using the Shield": a Shield is not a weapon row and an attack made with one is a shape the engine has no record for',
        '"_Protective Field._ As a Reaction ... you can use the Shield to create an immobile 5-foot Emanation originating from you": an area that refuses an attack or an effect from outside it, which nothing in the engine does',
      ],
    },
  ),

  // ── weapons the book names ───────────────────────────────────────────────
  magicWeapon(
    { id: 'vicious-weapon', name: 'Vicious Weapon', row: 'longsword' },
    {
      /**
       * SRD Vicious Weapon: "Weapon (Any Simple or Martial), Rare. This magic
       * weapon deals an extra 2d6 damage to any creature it hits. This extra
       * damage is of the same type as the weapon's normal damage."
       *
       * **The whole item is one clause**, which is why it was not in the
       * catalogue at all until `attack-damage` could be narrowed: a record
       * carrying nothing but a note would be an item that grants nothing and
       * looks transcribed. Now it says everything its entry says.
       *
       * "To any creature it hits" is the absence of every qualification the
       * class features carry — no ability, no melee clause, no once per turn —
       * and "of the same type as the weapon's normal damage" is the absence of
       * a damage type, which is what a *bonus* is.
       */
      grants: [extraDamageWithThisWeapon('2d6')],
    },
  ),
  magicWeapon(
    { id: 'sword-of-wounding', name: 'Sword of Wounding', row: 'longsword' },
    {
      /**
       * SRD Sword of Wounding: "Weapon (Glaive, Greatsword, Longsword, Rapier,
       * Scimitar, or Shortsword), Rare (Requires Attunement). When you hit a
       * creature with an attack using this magic weapon, the target takes an
       * extra 2d6 Necrotic damage."
       *
       * Necrotic and not the blade's own type, so it is *extra* rather than a
       * bonus: a creature Resistant to Slashing resists the sword and not the
       * wound.
       */
      attunement: {},
      grants: [extraDamageWithThisWeapon('2d6', 'necrotic', true)],
      unmodelled: [
        '"must succeed on a DC 15 Constitution saving throw or be unable to regain Hit Points for 1 hour. The target repeats the save at the end of each of its turns, ending the effect on itself on a success": a save a weapon forces, and a condition of its own that blocks healing and re-rolls each turn — an item declares neither',
      ],
    },
  ),
  magicWeapon(
    { id: 'dragon-slayer', name: 'Dragon Slayer', row: 'longsword' },
    {
      /**
       * SRD Dragon Slayer: "Weapon (Any Simple or Martial), Rare. You gain a
       * +1 bonus to attack rolls and damage rolls made with this magic
       * weapon. The weapon deals an extra 3d6 damage of the weapon's type if
       * the target is a Dragon."
       *
       * **Both narrowings, and nothing left.** "This magic weapon" is
       * `onlyWithItem` and "if the target is a Dragon" is `targetTypes`, read
       * the way a magical effect reads a type — so a Dragon under SRD
       * Arcanist's Magic Aura's Mask is spared, and a creature nobody has
       * typed is reported rather than guessed at. "Of the weapon's type" is
       * the absence of a damage type, which is what a *bonus* is: a Dragon
       * resisting Slashing resists the 3d6 with the blade.
       */
      grants: [
        madeWithThisWeapon(1),
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'attack-damage', dice: '3d6', onlyWithItem: true, targetTypes: ['Dragon'] }],
        },
      ],
    },
  ),
  magicWeapon(
    { id: 'giant-slayer', name: 'Giant Slayer', row: 'greataxe' },
    {
      /**
       * SRD Giant Slayer: "Weapon (Any Simple or Martial), Rare. You gain a +1
       * bonus to attack rolls and damage rolls made with this magic weapon.
       * When you hit a Giant with this weapon, the Giant takes an extra 2d6
       * damage of the weapon's type ..."
       *
       * Dragon Slayer's two narrowings over a different type. The save the
       * same hit forces is what is left, and leaving it out gives the Giant a
       * better day than the book does rather than the wielder.
       */
      grants: [
        madeWithThisWeapon(1),
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'attack-damage', dice: '2d6', onlyWithItem: true, targetTypes: ['Giant'] }],
        },
      ],
      unmodelled: [
        '"must succeed on a DC 15 Strength saving throw or have the Prone condition": a save a weapon forces on the hit it lands, which is a hit rider an item cannot declare',
      ],
    },
  ),
  magicWeapon(
    { id: 'mace-of-smiting', name: 'Mace of Smiting', row: 'mace' },
    {
      /**
       * SRD Mace of Smiting: "Weapon (Mace), Rare. You gain a +1 bonus to
       * attack rolls and damage rolls made with this magic weapon. The bonus
       * increases to +3 when you use the weapon to attack a Construct."
       *
       * **Two grants for one bonus that increases**, because the best of an
       * item's own bonuses is what reaches a roll — "only the effects of one
       * of them, the most potent, apply" — so against a Construct the +3
       * stands in for the +1 rather than beside it, and against anything
       * else, or anything nobody has typed, the +1 is all there is.
       */
      grants: [
        madeWithThisWeapon(1),
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'flat-bonus',
              applies: ['attack', 'damage'],
              flat: 3,
              onlyWithItem: true,
              targetTypes: ['Construct'],
            },
          ],
        },
      ],
      unmodelled: [
        '"When you roll a 20 on an attack roll made with this weapon, the target takes an extra 7 Bludgeoning damage, or 14 Bludgeoning damage if it\'s a Construct": damage that only a Critical Hit adds is a rider on the attack, not a standing effect',
      ],
    },
  ),
  magicWeapon(
    { id: 'scimitar-of-speed', name: 'Scimitar of Speed', row: 'scimitar' },
    {
      /**
       * SRD Scimitar of Speed: "Weapon (Scimitar), Very Rare (Requires
       * Attunement). You gain a +2 bonus to attack rolls and damage rolls made
       * with this magic weapon."
       */
      attunement: {},
      grants: [madeWithThisWeapon(2, true)],
      unmodelled: [
        '"In addition, you can make one attack with it as a Bonus Action on each of your turns": an item that adds to the action economy, which only a feature does',
      ],
    },
  ),
  magicWeapon(
    { id: 'nine-lives-stealer', name: 'Nine Lives Stealer', row: 'greatsword' },
    {
      /**
       * SRD Nine Lives Stealer: "Weapon (Any Simple or Martial), Very Rare
       * (Requires Attunement). You gain a +2 bonus to attack rolls and damage
       * rolls made with this magic weapon."
       */
      attunement: {},
      grants: [madeWithThisWeapon(2, true)],
      unmodelled: [
        '"**_Life Stealing._** The weapon has 1d8 + 1 charges": a charge pool whose maximum is rolled when the item is found, where `uses` is the flat number the book usually prints — and what the charge buys is an instant death on a Critical Hit, which nothing resolves',
      ],
    },
  ),
  magicWeapon(
    { id: 'quarterstaff-of-the-acrobat', name: 'Quarterstaff of the Acrobat', row: 'quarterstaff' },
    {
      /**
       * SRD Quarterstaff of the Acrobat: "Weapon (Quarterstaff), Very Rare
       * (Requires Attunement). You have a +2 bonus to attack rolls and damage
       * rolls made with this magic weapon."
       */
      attunement: {},
      grants: [madeWithThisWeapon(2, true)],
      unmodelled: [
        '"_Acrobatic Assist (Quarterstaff and 10-Foot Pole Forms Only)._ While holding this weapon, you have Advantage on Dexterity (Acrobatics) checks": the mode is writable but its condition is not — the staff has forms, and a benefit that holds in two of the three would be granted in all of them',
        '"you can take a Bonus Action to alter its form, turning it into a 6-inch rod ... or a 10-foot pole", "_Attack Deflection ..._ you can take a Reaction to twirl the weapon around you, gaining a +5 bonus to your Armor Class against the triggering attack", and the Thrown property the Quarterstaff form gains: an item that changes shape, a Reaction that answers one attack, and a weapon record edited in play',
        '"you can cause it to emit green Dim Light out to 10 feet, either as a Bonus Action or after you roll Initiative": light is the DM\'s, here as everywhere',
      ],
    },
  ),
  magicWeapon(
    { id: 'frost-brand', name: 'Frost Brand', row: 'longsword' },
    {
      /**
       * SRD Frost Brand: "Weapon (Glaive, Greatsword, Longsword, Rapier,
       * Scimitar, or Shortsword), Very Rare (Requires Attunement). When you
       * hit with an attack roll using this magic weapon, the target takes an
       * extra 1d6 Cold damage ... while you hold the weapon, you have
       * Resistance to Fire damage."
       *
       * Two grants and not one, because the book writes two sentences about
       * two different lifetimes: the Resistance is had while the sword is held
       * and the die is dealt by the sword itself, which is the clause
       * `onlyWithItem` says.
       */
      attunement: {},
      grants: [resistanceWhileWorn(['fire']), extraDamageWithThisWeapon('1d6', 'cold', true)],
      unmodelled: [
        '"In freezing temperatures, the weapon sheds Bright Light in a 10-foot radius", and "When you draw this weapon, you can extinguish all nonmagical flames within 30 feet of yourself": light, weather and open flame are the DM\'s',
      ],
    },
  ),
  magicWeapon(
    { id: 'defender', name: 'Defender', row: 'longsword' },
    {
      /**
       * SRD Defender: "Weapon (Any Melee Weapon), Legendary (Requires
       * Attunement). You gain a +3 bonus to attack rolls and damage rolls made
       * with this magic weapon."
       *
       * The +3 is what the sword does when nobody chooses otherwise, and the
       * choice is the clause below.
       */
      attunement: {},
      grants: [madeWithThisWeapon(3, true)],
      unmodelled: [
        '"The first time you attack with the weapon on each of your turns, you can transfer some or all of the weapon\'s bonus to your Armor Class ... The adjusted bonuses remain in effect until the start of your next turn": a standing bonus is derived on every read and has no place to record a choice made this turn',
      ],
    },
  ),
  magicWeapon(
    { id: 'vorpal-sword', name: 'Vorpal Sword', row: 'greatsword' },
    {
      /**
       * SRD Vorpal Sword: "Weapon (Glaive, Greatsword, Longsword, or
       * Scimitar), Legendary (Requires Attunement). You gain a +3 bonus to
       * attack rolls and damage rolls made with this magic weapon."
       */
      attunement: {},
      grants: [madeWithThisWeapon(3, true)],
      unmodelled: [
        '"In addition, the weapon ignores Resistance to Slashing damage": a weapon that overrides a defence, which the damage pipeline has no shape for',
        '"When you use this weapon to attack a creature that has at least one head and roll a 20 on the d20 for the attack roll, you cut off one of the creature\'s heads": what a creature is shaped like is the DM\'s, and death by decapitation is not a Hit Point',
      ],
    },
  ),

  // ── the standing readers (treasure T-B1) ─────────────────────────────────
  magicWeapon(
    { id: 'mace-of-disruption', name: 'Mace of Disruption', row: 'mace' },
    {
      /**
       * SRD Mace of Disruption: "Weapon (Mace), Rare (Requires Attunement).
       * When you hit a Fiend or an Undead with this magic weapon, that
       * creature takes an extra 2d6 Radiant damage."
       *
       * Holy Avenger's die at a smaller size, and narrowed the same two ways:
       * to this mace, and to what it hits. No bonus to the roll, because the
       * entry prints none.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'attack-damage',
              dice: '2d6',
              damageType: 'radiant',
              onlyWithItem: true,
              targetTypes: ['Fiend', 'Undead'],
            },
          ],
          requires: [{ kind: 'while-attuned' }],
        },
      ],
      unmodelled: [
        '"If the target has 25 Hit Points or fewer after taking this damage, it must succeed on a DC 15 Wisdom saving throw or be destroyed. On a successful save, the creature has the Frightened condition until the end of your next turn": a save a weapon forces on the hit it lands, gated on what is left after it — a hit rider an item cannot declare',
        '"While you hold this weapon, it sheds Bright Light in a 20-foot radius and Dim Light for an additional 20 feet": the `light` grant is read off the sheet alone and is withheld from an item, so the mace lights nothing',
      ],
    },
  ),
  magicWeapon(
    { id: 'luck-blade', name: 'Luck Blade', row: 'longsword' },
    {
      /**
       * SRD Luck Blade: "Weapon (Glaive, Greatsword, Longsword, Rapier,
       * Scimitar, Sickle, or Shortsword), Legendary (Requires Attunement).
       * You gain a +1 bonus to attack rolls and damage rolls made with this
       * magic weapon. While the weapon is on your person, you also gain a +1
       * bonus to saving throws."
       *
       * "On your person" is attunement's own lifetime: the fold ends an
       * attunement the moment the item leaves its holder's inventory, so a
       * blade attuned to is a blade carried, drawn or not. So the save bonus
       * asks the bracket and nothing else — and a blade merely held, never
       * attuned to, gives nothing, which the bracket says of both halves.
       */
      attunement: {},
      grants: [
        madeWithThisWeapon(1, true),
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['save'], flat: 1 }],
          requires: [{ kind: 'while-attuned' }],
        },
      ],
      unmodelled: [
        '"you can call on its luck (no action required) to reroll one failed D20 Test if you don\'t have the Incapacitated condition. You must use the second roll": a reroll of a failed test, once a dawn, elected by the holder — a pool an item would have to declare and a Reaction-free reroll no item grant carries',
        '"The weapon has 1d3 charges. While holding it, you can expend 1 charge and cast _Wish_ from it": Wish is not defined, so there is nothing for the charge to cast',
      ],
    },
  ),
  magicArmor(
    { id: 'spellguard-shield', name: 'Spellguard Shield', row: 'shield' },
    {
      /**
       * SRD Spellguard Shield: "Armor (Shield), Very Rare (Requires
       * Attunement). While holding this Shield, you have Advantage on saving
       * throws against spells and other magical effects, and spell attack
       * rolls have Disadvantage against you."
       *
       * Two modes, and both halves of the sentence are the roll's own facts:
       * a save a spell forced says `magical`, and an attack a spell makes says
       * `spellAttack`, whichever creature holds the grant — so the second is
       * written on the rolls made *against* the bearer, and a sword swung at
       * them is untouched.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
              },
            },
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll: 'attack', relation: 'against-holder', onlySpellAttacks: true },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'ring-of-swimming', name: 'Ring of Swimming', kind: 'ring' },
    {
      /**
       * SRD Ring of Swimming: "Ring, Uncommon. You have a Swim Speed of 40
       * feet while wearing this ring."
       *
       * "A Swim Speed of 40 feet" states a Speed rather than changing one —
       * SRD Fly's sentence in another mode — so it is `at-least`: a creature
       * that already swims faster keeps its own, and one that is Slowed swims
       * at half the ring's.
       */
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'speed', change: 'at-least', mode: 'swim', feet: 40 }],
          requires: WORN,
        },
      ],
    },
  ),
  wornItem(
    { id: 'cloak-of-the-manta-ray', name: 'Cloak of the Manta Ray', kind: 'wondrous' },
    {
      /**
       * SRD Cloak of the Manta Ray: "Wondrous Item, Uncommon (Requires
       * Attunement). While wearing this cloak, you can breathe underwater,
       * and you have a Swim Speed of 60 feet."
       *
       * The ring's sentence at 60 feet. The breathing is fiction, as SRD
       * Water Breathing's is and the Necklace of Adaptation's: the engine
       * holds no air and no drowning, so nothing a rule reads is missing.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'speed', change: 'at-least', mode: 'swim', feet: 60 }],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'slippers-of-spider-climbing', name: 'Slippers of Spider Climbing', kind: 'wondrous' },
    {
      /**
       * SRD Slippers of Spider Climbing: "Wondrous Item, Uncommon (Requires
       * Attunement). ... You have a Climb Speed equal to your Speed."
       *
       * SRD Spider Climb's sentence, spelled as that spell spells it —
       * `match-walk` in the climbing mode.
       *
       * **Transcribed with a limit the engine cannot see, under rule 3's
       * amendment above** (owner, 2026-09-27): "the slippers don't allow you
       * to move this way on a slippery surface". The lattice holds no
       * surfaces, so the Climb Speed holds on ice and oil too — a better pair
       * of slippers than the book prints wherever the table has laid ice. It
       * rides as the flagged `unmodelled` line below because the surface is
       * the fact the climb already asks the table about on every climb: the
       * slippers print no Spider Climb trait, so `climbCheck` reports "nobody
       * has said what … is climbing" each time the wearer climbs. Spider
       * Climb carries the same absence of surfaces for the vertical half.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'speed', change: 'match-walk', mode: 'climb' }],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        '"you can move up, down, and across vertical surfaces and along ceilings, while leaving your hands free": the lattice holds elevation and no surfaces, as it does for SRD Spider Climb',
        '"the slippers don\'t allow you to move this way on a slippery surface, such as one covered by ice or oil": a limit on the Climb Speed that the engine cannot apply, because nothing records what a surface is covered by — so the slippers climb where the book says they do not',
      ],
    },
  ),
  wornItem(
    {
      id: 'gloves-of-swimming-and-climbing',
      name: 'Gloves of Swimming and Climbing',
      kind: 'wondrous',
    },
    {
      /**
       * SRD Gloves of Swimming and Climbing: "Wondrous Item, Uncommon
       * (Requires Attunement). While wearing these gloves, you have a Climb
       * Speed and a Swim Speed equal to your Speed ..."
       *
       * SRD Spider Climb's sentence twice, one effect per mode, spelled as
       * that spell spells it — `match-walk` in the mode it names. Unlike the
       * Slippers of Spider Climbing the gloves print no surface they will not
       * climb, so nothing the book limits is given away here.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            { kind: 'speed', change: 'match-walk', mode: 'climb' },
            { kind: 'speed', change: 'match-walk', mode: 'swim' },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        '"you gain a +5 bonus to Strength (Athletics) checks made to climb or swim": narrower than the skill — a check says which skill it is made with and not what it is made for — so a +5 to Athletics would reach a Grapple escape and a jump, which is a better pair of gloves than the book prints',
      ],
    },
  ),
  wornItem(
    { id: 'gloves-of-thievery', name: 'Gloves of Thievery', kind: 'wondrous' },
    {
      /**
       * SRD Gloves of Thievery: "Wondrous Item, Uncommon. These gloves are
       * imperceptible while worn. While wearing them, you gain a +5 bonus to
       * Dexterity (Sleight of Hand) checks."
       *
       * A flat bonus narrowed to one skill, the standing twin of the narrowing
       * a casting's Guidance carries: reached by a Sleight of Hand check, and
       * by no other check. That the gloves cannot be seen is description a
       * rule never reads.
       */
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ability-check'], flat: 5, skill: 'sleight-of-hand' }],
          requires: WORN,
        },
      ],
    },
  ),
  magicWeapon(
    { id: 'holy-avenger', name: 'Holy Avenger', row: 'longsword' },
    {
      /**
       * SRD Holy Avenger: "Weapon (Any Simple or Martial), Legendary (Requires
       * Attunement by a Paladin). You gain a +3 bonus to attack rolls and
       * damage rolls made with this magic weapon."
       *
       * **The item that proves a prerequisite.** "By a Paladin" is the one
       * shape `ItemAttunement.byClass` exists for, and a class is named by id
       * here — the catalogue's own id for the Paladin — rather than by the
       * word the book prints, so a homebrew class called something else can
       * hold its own version.
       */
      attunement: { byClass: ['paladin'] },
      grants: [
        madeWithThisWeapon(3, true),
        /**
         * "When you hit a Fiend or an Undead with it, that creature takes an
         * extra 2d10 Radiant damage": Radiant, so *extra* beside the blade
         * rather than a bonus of its type, and narrowed to the target the way
         * Dragon Slayer's die is.
         */
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'attack-damage',
              dice: '2d10',
              damageType: 'radiant',
              onlyWithItem: true,
              targetTypes: ['Fiend', 'Undead'],
            },
          ],
          requires: [{ kind: 'while-attuned' }],
        },
        /**
         * "While you hold the drawn weapon, it creates a 10-foot Emanation
         * originating from you. You and all creatures Friendly to you in the
         * Emanation have Advantage on saving throws against spells and other
         * magical effects."
         *
         * An item's aura, as the Weapon of Warning's is, read as held
         * (`while-worn`) and attuned. "Friendly to you" is the declared side
         * an aura already reads for an ally. "Against spells and other
         * magical effects" is `againstMagic`, SRD Magic Resistance's own
         * words, answered by the site that throws the save — so a save a
         * spell forced is reached and a trap's is not.
         */
        {
          kind: 'standing',
          reach: 'aura',
          auraFeet: 10,
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        '"If you have 17 or more levels in the Paladin class, the size of the Emanation increases to 30 feet": an item grant declares one size for its aura and reads no class level, so the Emanation is 10 feet whoever holds it',
      ],
    },
  ),
  magicWeapon(
    { id: 'weapon-of-warning', name: 'Weapon of Warning', row: 'shortsword' },
    {
      /**
       * SRD Weapon of Warning: "Weapon (Any Simple or Martial), Uncommon
       * (Requires Attunement). As long as this weapon is within your reach and
       * you are attuned to it, you and allies within 30 feet of you gain the
       * following benefits. ... _Supernatural Readiness._ Each subject has
       * Advantage on its Initiative rolls."
       *
       * **The one item here whose benefit leaves its holder.** An aura from an
       * item is the same aura a Paladin's is — derived on every read, reaching
       * whoever is allied and in range — and it is the reason an item's grant
       * has to declare `auraFeet`: no feature is standing behind it to say how
       * far it goes.
       *
       * **The Alarm is the table's; the reach is still owed.** Natural sleep
       * is not held — `wake` refuses a creature "merely asleep in the ordinary
       * way" — and the one sleep the engine does hold, SRD Sleep's, is the
       * one the paragraph's second sentence excludes. So who is asleep, and
       * being woken, is a fact nothing afterwards reads. "Within your reach"
       * is different: a distance the engine measures, read here as wielded,
       * and it stays a debt.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'aura',
          auraFeet: 30,
          effects: [
            {
              kind: 'roll-mode',
              modifier: { mode: 'advantage', selector: { roll: 'initiative', relation: 'roller' } },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
      dmDecides: [
        'The weapon magically awakens each subject who is sleeping naturally when combat begins.',
        "This benefit doesn't wake a subject from magically induced sleep.",
      ],
      unmodelled: [
        'the weapon\'s reach: the book asks that it be "within your reach", and the engine reads that as wielded — `while-worn` — because being in hand is the nearest fact it keeps',
      ],
    },
  ),

  // ── charges ──────────────────────────────────────────────────────────────
  wornItem(
    { id: 'wand-of-secrets', name: 'Wand of Secrets', kind: 'wand' },
    {
      /**
       * SRD Wand of Secrets: "Wand, Uncommon. This wand has 3 charges and
       * regains 1d3 expended charges daily at dawn."
       *
       * **The charges are transcribed and the pointing is not.** A wand that
       * finds a secret door is a fact about a room the engine has no walls for
       * — the DM already owns whether there is a door and where — so what the
       * engine owns is the economy: three charges, one spent per look, and a
       * die at dawn.
       */
      grants: [charges('wand-of-secrets', 'Wand of Secrets', 3, '1d3')],
      unmodelled: [
        'what the charge buys: "you can take a Magic action to expend 1 charge, and if a secret door or trap is within 60 feet of you, the wand pulses and points at the one nearest to you" — the Magic action is not spent either, because an action spent on nothing is worse than an action not spent',
      ],
    },
  ),
  wornItem(
    { id: 'eyes-of-charming', name: 'Eyes of Charming', kind: 'wondrous' },
    {
      /**
       * SRD Eyes of Charming: "Wondrous Item, Uncommon (Requires Attunement).
       * ... They have 3 charges. ... The lenses regain all expended charges
       * daily at dawn."
       *
       * The other half of the dawn rule: "all expended charges" is the `dawn`
       * recovery tag on its own, with no dice beside it, and it is what
       * `restoreOn` has always done.
       */
      attunement: {},
      grants: [
        charges('eyes-of-charming', 'Eyes of Charming', 3),
        /**
         * "While wearing them, you can expend 1 or more charges to cast _Charm
         * Person_ (save DC 13). For 1 charge, you cast the level 1 version of
         * the spell. You increase the spell's level by one for each additional
         * charge you expend." The Wand of Fireballs' sentence, with "1 or
         * more" bounded by the three charges the lenses hold.
         */
        castsSpell('charm-person', 1, { upToCharges: 3, saveDc: 13 }),
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-fireballs', name: 'Wand of Fireballs', kind: 'wand' },
    {
      /**
       * SRD Wand of Fireballs: "Wand, Rare (Requires Attunement by a
       * Spellcaster). This wand has 7 charges. ... The wand regains 1d6 + 1
       * expended charges daily at dawn."
       *
       * **The item that proves the other prerequisite.** "By a spellcaster"
       * asks a different question of a different part of the sheet than "by a
       * Paladin" does, which is why it is a field of its own rather than a
       * class named "spellcaster" — and the engine's third answer to it is the
       * one that matters: a creature nobody has said anything about is asked
       * about rather than refused.
       */
      attunement: { bySpellcaster: true },
      grants: [
        charges('wand-of-fireballs', 'Wand of Fireballs', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        /**
         * "you can expend no more than 3 charges to cast _Fireball_ (save DC
         * 15) from it. For 1 charge, you cast the level 3 version of the
         * spell. You can increase the spell's level by 1 for each additional
         * charge you expend."
         *
         * **The item that proves both halves of the numbers rule.** The DC is
         * the wand's — an archmage holding it still saves against 15 — and the
         * *level* is the charges', which is the only thing about the casting
         * the wielder decides. Fireball is a level 3 spell, so "the level 3
         * version" is its own level and the grant names none.
         */
        castsSpell('fireball', 1, { upToCharges: 3, saveDc: 15 }),
      ],
    },
  ),
  /**
   * **The four wands whose whole remainder was one sentence**, and the
   * sentence was already a note rather than a blocker.
   *
   * Every wand in this family prints "If you expend the wand's last charge,
   * roll 1d20. On a 1, the wand crumbles into ashes and is destroyed". It was
   * a note on all of them while nothing removed a line from an inventory, and
   * it is {@link CRUMBLES_ON_A_1} on their pools now: the clause *limits* the
   * wand, so a record without it was one that lasted longer than the book's.
   *
   * What kept these four out was the other half — Polymorph, Command, Fear,
   * Lightning Bolt, Hold Person and Hold Monster had no definitions — and all
   * six exist now. Each is the Wand of Web's record with the numbers changed.
   */
  wornItem(
    { id: 'wand-of-polymorph', name: 'Wand of Polymorph', kind: 'wand' },
    {
      /**
       * SRD Wand of Polymorph: "Wand, Very Rare (Requires Attunement by a
       * Spellcaster). This wand has 7 charges. While holding it, you can
       * expend 1 charge to cast _Polymorph_ (save DC 15) from it."
       *
       * Polymorph is a **tracked** definition, which is the whole of what
       * `checkContent` asks a `casts` grant for — the casting is recorded
       * with the wand's DC pinned to it, and what the new shape *does* is the
       * definition's own note.
       */
      attunement: { bySpellcaster: true },
      grants: [
        charges('wand-of-polymorph', 'Wand of Polymorph', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        castsSpell('polymorph', 1, { saveDc: 15 }),
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-lightning-bolts', name: 'Wand of Lightning Bolts', kind: 'wand' },
    {
      /**
       * SRD Wand of Lightning Bolts: "Wand, Rare (Requires Attunement by a
       * Spellcaster). This wand has 7 charges. While holding it, you can
       * expend no more than 3 charges to cast _Lightning Bolt_ (save DC 15)
       * from it. For 1 charge, you cast the level 3 version of the spell."
       *
       * The Wand of Fireballs' sentence with one spell changed, down to the
       * range of charges and the level they buy.
       */
      attunement: { bySpellcaster: true },
      grants: [
        charges(
          'wand-of-lightning-bolts',
          'Wand of Lightning Bolts',
          7,
          '1d6 + 1',
          CRUMBLES_ON_A_1,
        ),
        castsSpell('lightning-bolt', 1, { upToCharges: 3, saveDc: 15 }),
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-binding', name: 'Wand of Binding', kind: 'wand' },
    {
      /**
       * SRD Wand of Binding: "Wand, Rare (Requires Attunement). This wand has
       * 7 charges. _Spells._ While holding the wand, you can cast one of the
       * spells (save DC 17) on the following table from it" — Hold Monster
       * for 5 charges, Hold Person for 2.
       *
       * Two prices on one pool, out of a table, which is the staff shape; the
       * DC is printed once and belongs to both.
       */
      attunement: {},
      grants: [
        charges('wand-of-binding', 'Wand of Binding', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        castsSpell('hold-monster', 5, { saveDc: 17 }),
        castsSpell('hold-person', 2, { saveDc: 17 }),
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-fear', name: 'Wand of Fear', kind: 'wand' },
    {
      /**
       * SRD Wand of Fear: "Wand, Rare (Requires Attunement). This wand has 7
       * charges. _Spells._ While holding the wand, you can cast one of the
       * spells (save DC 15) on the following table from it" — Command "(flee
       * or grovel only)" for 1 charge, Fear "(60-foot Cone)" for 3.
       *
       * **Both parentheticals are notes, and both for the same reason: each
       * leaves the wand weaker than the page.** Command is
       * tracked and resolves nothing, so there are no options for "flee or
       * grovel only" to narrow; and Fear's own area is a 30-foot Cone, so a
       * casting from this wand catches half of what the book's wand catches
       * rather than twice as much.
       */
      attunement: {},
      grants: [
        charges('wand-of-fear', 'Wand of Fear', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        castsSpell('command', 1, { saveDc: 15 }),
        castsSpell('fear', 3, { saveDc: 15 }),
      ],
      unmodelled: [
        '"*Fear* (60-foot Cone)": the wand widens the spell\'s area and a `casts` grant hands the definition to the pipeline whole, so a casting from this wand fills Fear\'s own 30-foot Cone — half the page\'s wand rather than twice it',
        '"*Command* (flee or grovel only)": the narrowing has nothing to narrow, because Command is a tracked definition and the option a caster chooses is what it leaves to the table',
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-web', name: 'Wand of Web', kind: 'wand' },
    {
      /**
       * SRD Wand of Web: "Wand, Uncommon (Requires Attunement by a
       * Spellcaster). This wand has 7 charges. While holding it, you can
       * expend 1 charge to cast _Web_ (save DC 13) from it."
       *
       * **The item that proves a casting from an item is really a casting.**
       * Web is Concentration and leaves a persistent area behind, so a wand
       * that casts it has to drop whatever its wielder was concentrating on,
       * leave an ongoing record Dispel Magic can find, and go on catching
       * whoever walks into the webbing on a later turn — against the *wand's*
       * DC of 13, pinned at the casting, and not the wielder's.
       *
       * It is also the whole of the entry: one charge, one spell, and nothing
       * the engine cannot say, so it carries no `unmodelled` at all.
       */
      attunement: { bySpellcaster: true },
      grants: [
        charges('wand-of-web', 'Wand of Web', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        castsSpell('web', 1, { saveDc: 13 }),
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-paralysis', name: 'Wand of Paralysis', kind: 'wand' },
    {
      /**
       * SRD Wand of Paralysis: "Wand, Rare (Requires Attunement by a
       * Spellcaster). This wand has 7 charges. While holding it, you can take
       * a Magic action to expend 1 charge to cause a thin blue ray to streak
       * from the tip toward a creature you can see within 60 feet of
       * yourself. The target must succeed on a DC 15 Constitution saving
       * throw or have the Paralyzed condition for 1 minute. At the end of
       * each of the target's turns, it repeats the save, ending the effect on
       * itself on a success. ... The wand regains 1d6 + 1 expended charges
       * daily at dawn. If you expend the wand's last charge, roll 1d20. On a
       * 1, the wand crumbles into ashes and is destroyed."
       *
       * **A ray, not a spell**: nothing is cast, so it is a conferral paid for
       * in charges, and "a creature you can see within 60 feet of yourself"
       * is the conferral's `reach`. The save and its repeat are the `save`
       * kind's, against the wand's DC; the minute is the conferral's
       * lifetime.
       *
       * The whole entry, so it carries no `unmodelled` at all.
       */
      attunement: { bySpellcaster: true },
      grants: [
        charges('wand-of-paralysis', 'Wand of Paralysis', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        {
          kind: 'confers',
          action: 'action',
          charges: 1,
          reach: 60,
          saveDc: 15,
          durationSeconds: 60,
          effects: [
            {
              kind: 'save',
              ability: 'con',
              condition: 'paralyzed',
              repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
            },
          ],
        },
      ],
    },
  ),
  wornItem(
    { id: 'wand-of-magic-detection', name: 'Wand of Magic Detection', kind: 'wand' },
    {
      /**
       * SRD Wand of Magic Detection: "Wand, Uncommon. This wand has 3 charges.
       * While holding it, you can expend 1 charge to cast _Detect Magic_ from
       * it. The wand regains 1d3 expended charges daily at dawn."
       *
       * **The first item whose spell the engine tracks rather than executes**,
       * and the reason that is an item rather than a stub is SRD's own
       * sentence about what a casting from an item is: "The spell uses its
       * normal casting time, range, and duration, and the user of the item
       * must concentrate if the spell requires Concentration." Detect Magic
       * does, so a charge off this wand costs its wielder whatever they were
       * already holding and starts a ten-minute clock — every bit of which is
       * arithmetic the engine owns. What the *spell* leaves to the table is
       * Detect Magic's own `unmodelled`, which the casting hands over through
       * `unverified`; it is not this wand's gap and does not belong in this
       * wand's notes.
       *
       * No bracket, no printed DC, no crumbling clause: the entry is four
       * sentences and the record says all four, so it carries no `unmodelled`
       * at all.
       */
      grants: [
        charges('wand-of-magic-detection', 'Wand of Magic Detection', 3, '1d3'),
        castsSpell('detect-magic', 1),
      ],
    },
  ),
  wornItem(
    { id: 'ring-of-animal-influence', name: 'Ring of Animal Influence', kind: 'ring' },
    {
      /**
       * SRD Ring of Animal Influence: "Ring, Rare. This ring has 3 charges,
       * and it regains 1d3 expended charges daily at dawn. While wearing the
       * ring, you can expend 1 charge to cast one of the following spells
       * (save DC 13) from it: _Animal Friendship_ / _Fear_ (affects Beasts
       * only) / _Speak with Animals_."
       *
       * **A grant per row of the table**, exactly as the Staff of Fire writes
       * one — and, as there, the row the engine would get wrong is left out
       * and said out loud rather than written wider than the book.
       *
       * **The DC goes on every row the parenthesis governs**, including the
       * one that rolls nothing. "(save DC 13)" is printed once, before the
       * list, so it is the ring's number for all three — and leaving it off
       * Speak with Animals would not leave the field empty: `numbersForItem`
       * is `grant.saveDc ?? <the wielder's own>`, so an omission *substitutes*
       * a number the book contradicts, pinning an 11 off a level 5 wearer's
       * sheet onto a ring whose line says 13. Nothing reads it while the spell
       * resolves nothing, and that is exactly why it has to be right: the
       * first sentence of this spell the engine executes would inherit it.
       *
       * No bracket on the type line, so anybody may put it on, which is what
       * makes it the item that proves a casting from an item needs no
       * spellcaster behind it when the item printed its own number.
       */
      grants: [
        charges('ring-of-animal-influence', 'Ring of Animal Influence', 3, '1d3'),
        castsSpell('animal-friendship', 1, { saveDc: 13 }),
        castsSpell('speak-with-animals', 1, { saveDc: 13 }),
      ],
      unmodelled: [
        'the middle row of the ring\'s table, "_Fear_ (affects Beasts only)": the parenthesis narrows the spell\'s catch to one creature type and a `casts` grant has no field that says so, so a ring granted this row would Frighten everything in the cone — which is rule 3 of this file, the clause the engine cannot say being the one that limits the benefit',
      ],
    },
  ),
  wornItem(
    { id: 'cape-of-the-mountebank', name: 'Cape of the Mountebank', kind: 'wondrous' },
    {
      /**
       * SRD Cape of the Mountebank: "Wondrous Item, Rare. This cape smells
       * faintly of brimstone. While wearing it, you can use it to cast
       * _Dimension Door_ as a Magic action. This property can't be used again
       * until the next dawn."
       *
       * **A per-day property is a pool of one.** "Can't be used again until
       * the next dawn" is the same sentence a wand's charges print with every
       * number set to one: one use, spent by the casting, given back whole by
       * `declareDawn`. So it needs no second mechanism, and the item that has
       * no charge count in the book still has a charge economy here.
       *
       * No attunement — the book prints no bracket — which makes it the one
       * casting item in the catalogue that a creature of any kind can simply
       * put on and use.
       */
      grants: [
        charges('cape-of-the-mountebank', 'Cape of the Mountebank', 1),
        castsSpell('dimension-door', 1),
      ],
      unmodelled: [
        '"When you teleport with that spell, you leave behind a cloud of smoke. The space you left is Lightly Obscured by that smoke until the end of your next turn": obscurement attached to a space rather than to a creature, which the scene has no shape for',
      ],
    },
  ),
  wornItem(
    { id: 'staff-of-fire', name: 'Staff of Fire', kind: 'staff' },
    {
      /**
       * SRD Staff of Fire: "Staff, Very Rare (Requires Attunement by a Druid,
       * Sorcerer, Warlock, or Wizard). You have Resistance to Fire damage
       * while you hold this staff. ... The staff has 10 charges. ... The staff
       * regains 1d6 + 4 expended charges daily at dawn."
       *
       * **Both shapes on one item, and a prerequisite that is a list.** The
       * Resistance is standing and conditional; the charges are a pool; and
       * "by a Druid, Sorcerer, Warlock, or Wizard" is four class ids, any one
       * of which does.
       */
      attunement: { byClass: ['druid', 'sorcerer', 'warlock', 'wizard'] },
      grants: [
        resistanceWhileWorn(['fire']),
        /**
         * "If you expend the last charge, roll 1d20. On a 1, the staff
         * crumbles into cinders and is destroyed."
         */
        charges('staff-of-fire', 'Staff of Fire', 10, '1d6 + 4', CRUMBLES_ON_A_1),
        /**
         * "you can cast one of the spells on the following table from it,
         * using your spell save DC. The table indicates how many charges you
         * must expend to cast the spell."
         *
         * **The item that prints no numbers**, and so the one that proves the
         * fallback: the DC is the wielder's own, which is a rule in the
         * resolver because the SRD prints it once and no item restates it. A
         * staff attuned by a Druid, Sorcerer, Warlock or Wizard will normally
         * have exactly one spellcasting ability to bring; one with two is
         * asked which, and one with none rolls +0 with their Proficiency
         * Bonus.
         *
         * A grant per row of the table, which is why the reader is a list: the
         * book prices each spell separately and the three rows are priced
         * three ways.
         */
        castsSpell('burning-hands', 1),
        castsSpell('fireball', 3),
        castsSpell('wall-of-fire', 4),
      ],
    },
  ),
  // ── castings the book prices at nothing ──────────────────────────────────
  wornItem(
    {
      id: 'helm-of-comprehending-languages',
      name: 'Helm of Comprehending Languages',
      kind: 'wondrous',
    },
    {
      /**
       * SRD Helm of Comprehending Languages: "Wondrous Item, Uncommon. While
       * wearing this helm, you can cast _Comprehend Languages_ from it."
       *
       * **The whole entry, and the item that proves an at-will casting.** One
       * sentence: no charge count, no per-dawn line, no bracket, no DC. So
       * there is no pool, nothing to spend and nothing to run out — which the
       * `casts` grant could not say until `atWill` existed, and which a pool
       * of one would have said wrongly, because a helm that worked once a day
       * is not the helm the book prints.
       *
       * What the spell leaves to the table is the spell's note, handed over
       * through `unverified` on every casting, so this record carries none of
       * its own.
       */
      grants: [castsSpellAtWill('comprehend-languages')],
    },
  ),
  wornItem(
    { id: 'ring-of-jumping', name: 'Ring of Jumping', kind: 'ring' },
    {
      /**
       * SRD Ring of Jumping: "Ring, Uncommon (Requires Attunement). While
       * wearing this ring, you can cast _Jump_ from it, but can target only
       * yourself when you do so."
       *
       * **Both new clauses on one line.** The casting is priced at nothing,
       * and the spell under it — which touches a willing creature, and one
       * more for each slot level above 1 — is narrowed to whoever is wearing
       * the ring. Written unnarrowed it would be a ring that let its wearer
       * Jump an ally, which is a benefit the book does not print.
       */
      attunement: {},
      grants: [castsSpellAtWill('jump', { targetsSelfOnly: true })],
    },
  ),
  wornItem(
    { id: 'ring-of-water-walking', name: 'Ring of Water Walking', kind: 'ring' },
    {
      /**
       * SRD Ring of Water Walking: "Ring, Uncommon. While wearing this ring,
       * you cast _Water Walk_ from it, targeting only yourself."
       *
       * The same two clauses, printed in different words and over a spell that
       * reaches ten willing creatures — so the narrowing is doing nine
       * creatures' worth of work here. No bracket on the type line, so anybody
       * may put it on.
       */
      grants: [castsSpellAtWill('water-walk', { targetsSelfOnly: true })],
    },
  ),
  magicWeapon(
    { id: 'hammer-of-thunderbolts', name: 'Hammer of Thunderbolts', row: 'maul' },
    {
      /**
       * SRD Hammer of Thunderbolts: "Weapon (Maul or Warhammer), Legendary
       * (Requires Attunement). You gain a +1 bonus to attack rolls and damage
       * rolls made with this magic weapon. The weapon has 5 charges. ... The
       * weapon regains 1d4 + 1 expended charges daily at dawn."
       *
       * A weapon's bonus and a charge pool on the same item, which is what
       * makes it worth transcribing before the charges buy anything: the two
       * grants are read by two readers and neither knows about the other.
       */
      attunement: {},
      grants: [
        madeWithThisWeapon(1, true),
        charges('hammer-of-thunderbolts', 'Hammer of Thunderbolts', 5, '1d4 + 1'),
      ],
      unmodelled: [
        'what the charges buy: "You can expend 1 charge and make a ranged attack with the weapon, hurling it as if it had the Thrown property ... The target and every creature within 30 feet of it other than you must succeed on a DC 17 Constitution saving throw or have the Stunned condition until the end of your next turn"',
        '"_Giant\'s Bane._ While you are attuned to the weapon and wearing either a _Belt of Giant Strength_ or _Gauntlets of Ogre Power_ to which you are also attuned, you gain the following benefits": a benefit conditional on *another item* being attuned, which no requirement asks. The Gauntlets are in this catalogue now and the Belt is not, so even a requirement that could say it would find one of the two named items missing — and _Might of Giants_, which adds 4 to the score either of them bestows, is a bounded delta on a lifetime that no grant member carries',
      ],
    },
  ),

  // ── staffs and wands through the wand door ───────────────────────────────
  //
  // Every record below casts through `cast_spell.item`. For the wand and the
  // staffs, what kept them out was never a spell: each table was defined
  // before the door onto it existed, and the last-charge d20 — printed by all
  // of them but the Staff of the Magi, whose d20 only pays out — had no
  // reader. The rod, the ring and the cloak print no last charge at all; they
  // were filed under what they do besides cast, and they come in partial with
  // exactly that as their notes. So the book's staffs are its tables, one
  // grant per row, and what an item does *besides* cast is either a grant the
  // engine reads or a note that says which clause it is.
  //
  // **Held is `while-worn`**, exactly as the Staff of Fire writes it: "while
  // you hold this staff" is being in hand, and in hand is the equipped set.

  wornItem(
    { id: 'wand-of-magic-missiles', name: 'Wand of Magic Missiles', kind: 'wand' },
    {
      /**
       * SRD Wand of Magic Missiles: "Wand, Uncommon. This wand has 7 charges.
       * While holding it, you can expend no more than 3 charges to cast _Magic
       * Missile_ from it. For 1 charge, you cast the level 1 version of the
       * spell. You can increase the spell's level by 1 for each additional
       * charge you expend. ... The wand regains 1d6 + 1 expended charges daily
       * at dawn. If you expend the wand's last charge, roll 1d20. On a 1, the
       * wand crumbles into ashes and is destroyed."
       *
       * The Wand of Fireballs' sentence over a level 1 spell, and the whole of
       * the entry: three darts for one charge, five for three, no bracket and
       * no printed number — Magic Missile rolls no save and makes no attack, so
       * there is nothing for the wand to have printed.
       */
      grants: [
        charges('wand-of-magic-missiles', 'Wand of Magic Missiles', 7, '1d6 + 1', CRUMBLES_ON_A_1),
        castsSpell('magic-missile', 1, { upToCharges: 3 }),
      ],
    },
  ),
  wornItem(
    { id: 'staff-of-healing', name: 'Staff of Healing', kind: 'staff' },
    {
      /**
       * SRD Staff of Healing: "Staff, Rare (Requires Attunement by a Bard,
       * Cleric, or Druid). This staff has 10 charges. While holding the staff,
       * you can cast one of the spells on the following table from it, using
       * your spellcasting ability modifier." Cure Wounds for "1 charge per
       * spell level (maximum 4 for a level 4 spell)", Lesser Restoration for
       * 2, Mass Cure Wounds for 5. "The staff regains 1d6 + 4 expended charges
       * daily at dawn. If you expend the last charge, roll 1d20. On a 1, the
       * staff vanishes in a flash of light, lost forever."
       *
       * **"1 charge per spell level" is the wands' own shape**, read from the
       * other end. Cure Wounds is a level 1 spell, so one charge is the level
       * 1 version and each further charge one level more — which is what
       * `upToCharges` has always done — and "maximum 4 for a level 4 spell"
       * is the ceiling. The map filed this cell as a cost that reads the slot;
       * it reads the charges, and the level follows.
       */
      attunement: { byClass: ['bard', 'cleric', 'druid'] },
      grants: [
        charges('staff-of-healing', 'Staff of Healing', 10, '1d6 + 4', CRUMBLES_ON_A_1),
        castsSpell('cure-wounds', 1, { upToCharges: 4 }),
        castsSpell('lesser-restoration', 2),
        castsSpell('mass-cure-wounds', 5),
      ],
    },
  ),
  wornItem(
    { id: 'staff-of-frost', name: 'Staff of Frost', kind: 'staff' },
    {
      /**
       * SRD Staff of Frost: "Staff, Very Rare (Requires Attunement by a Druid,
       * Sorcerer, Warlock, or Wizard). You have Resistance to Cold damage
       * while you hold this staff." Then the Staff of Fire's table with four
       * other rows — Cone of Cold 5, Fog Cloud 1, Ice Storm 4, Wall of Ice 4 —
       * "using your spell save DC", the same 1d6 + 4 at dawn, and on a 1 "the
       * staff turns to water and is destroyed".
       *
       * The Staff of Fire's record with the element changed, down to the
       * bracket, and like it the whole entry.
       */
      attunement: { byClass: ['druid', 'sorcerer', 'warlock', 'wizard'] },
      grants: [
        resistanceWhileWorn(['cold']),
        charges('staff-of-frost', 'Staff of Frost', 10, '1d6 + 4', CRUMBLES_ON_A_1),
        castsSpell('cone-of-cold', 5),
        castsSpell('fog-cloud', 1),
        castsSpell('ice-storm', 4),
        castsSpell('wall-of-ice', 4),
      ],
    },
  ),
  wornItem(
    { id: 'staff-of-charming', name: 'Staff of Charming', kind: 'staff' },
    {
      /**
       * SRD Staff of Charming: "Staff, Rare (Requires Attunement by a Bard,
       * Cleric, Druid, Sorcerer, Warlock, or Wizard). This staff has 10
       * charges. ... You can expend 1 of the staff's charges to cast _Charm
       * Person_, _Command_, or _Comprehend Languages_ from it using your spell
       * save DC. ... The staff regains 1d8 + 2 expended charges daily at dawn.
       * If you expend the last charge, roll 1d20. On a 1, the staff crumbles
       * to dust and is destroyed."
       *
       * The three castings and the crumble. What is left are two protections
       * that each *add* to the staff — a Reaction and a once-a-day turned
       * save — so leaving them out leaves a staff weaker than the page and
       * never a stronger one.
       */
      attunement: { byClass: ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'] },
      grants: [
        charges('staff-of-charming', 'Staff of Charming', 10, '1d8 + 2', CRUMBLES_ON_A_1),
        castsSpell('charm-person', 1),
        castsSpell('command', 1),
        castsSpell('comprehend-languages', 1),
      ],
      unmodelled: [
        '"_Reflect Enchantment._ If you succeed on a saving throw against an Enchantment spell that targets only you, you can take a Reaction to expend 1 charge from the staff and turn the spell back on its caster as if you had cast the spell": a Reaction an item grants, on a save a spell forced, paid for out of the staff — no item grant kind reads a Reaction',
        '"_Resist Enchantment._ If you fail a saving throw against an Enchantment spell that targets only you, you can turn your failed save into a successful one. You can\'t use this property of the staff again until the next dawn": a failed save turned into a success, narrowed to a school and to a spell that targets only its holder, which no item grant can say',
      ],
    },
  ),
  wornItem(
    { id: 'staff-of-swarming-insects', name: 'Staff of Swarming Insects', kind: 'staff' },
    {
      /**
       * SRD Staff of Swarming Insects: "Staff, Rare (Requires Attunement by a
       * Bard, Cleric, Druid, Sorcerer, Warlock, or Wizard). This staff has 10
       * charges." Giant Insect for 4 and Insect Plague for 5, "using your
       * spell save DC and spell attack modifier"; the 1d6 + 4 at dawn; and on
       * a 1, "a swarm of insects consumes and destroys the staff, then
       * disperses".
       */
      attunement: { byClass: ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'] },
      grants: [
        charges('staff-of-swarming-insects', 'Staff of Swarming Insects', 10, '1d6 + 4', CRUMBLES_ON_A_1),
        castsSpell('giant-insect', 4),
        castsSpell('insect-plague', 5),
      ],
      unmodelled: [
        '"_Insect Cloud._ While holding the staff, you can take a Magic action and expend 1 charge to cause a swarm of harmless flying insects to fill a 30-foot Emanation originating from you. The insects remain for 10 minutes, making the area Heavily Obscured for creatures other than you": an area an item lays down rather than a spell, and a conferral has a reach and no area — so the charge buys nothing here rather than something wider',
      ],
    },
  ),
  magicWeapon(
    { id: 'staff-of-the-woodlands', name: 'Staff of the Woodlands', row: 'quarterstaff', kind: 'staff' },
    {
      /**
       * SRD Staff of the Woodlands: "Staff, Rare (Requires Attunement by a
       * Druid). This staff has 6 charges and can be wielded as a magic
       * Quarterstaff that grants a +2 bonus to attack rolls and damage rolls
       * made with it." Eight castings off a table "using your spell save DC",
       * and "The staff regains 1d6 expended charges daily at dawn. If you
       * expend the last charge, roll 1d20. On a 1, the staff loses its
       * properties and becomes a nonmagical Quarterstaff."
       *
       * **The d20 is written as the page writes it**: on a 1 the staff leaves
       * by the road a crumbled wand leaves by, and a mundane `quarterstaff`
       * takes its place — in the druid's hand if the staff was there.
       */
      attunement: { byClass: ['druid'] },
      grants: [
        madeWithThisWeapon(2, true),
        charges('staff-of-the-woodlands', 'Staff of the Woodlands', 6, '1d6', {
          becomes: 'quarterstaff',
          onD20AtOrBelow: 1,
        }),
        castsSpell('animal-friendship', 1),
        castsSpell('awaken', 5),
        castsSpell('barkskin', 2),
        castsSpell('locate-animals-or-plants', 2),
        castsSpell('pass-without-trace', 2),
        castsSpell('speak-with-animals', 1),
        castsSpell('speak-with-plants', 3),
        castsSpell('wall-of-thorns', 6),
      ],
      unmodelled: [
        '"While holding it, you have a +2 bonus to spell attack rolls": no standing effect raises a spell attack roll, so the staff\'s castings and its holder\'s own are made without it',
        '"_Tree Form._ You can take a Magic action to plant one end of the staff in earth in an unoccupied space and expend 1 charge to transform the staff into a healthy tree": a 60-foot tree is an object standing in the scene, which nothing the engine keeps can be',
      ],
    },
  ),
  magicWeapon(
    { id: 'staff-of-power', name: 'Staff of Power', row: 'quarterstaff', kind: 'staff' },
    {
      /**
       * SRD Staff of Power: "Staff, Very Rare (Requires Attunement by a
       * Sorcerer, Warlock, or Wizard). This staff has 20 charges and can be
       * wielded as a magic Quarterstaff that grants a +2 bonus to attack rolls
       * and damage rolls made with it. While holding it, you gain a +2 bonus
       * to Armor Class, saving throws, and spell attack rolls." Nine castings
       * "using your spell save DC", Fireball and Lightning Bolt each as "(level
       * 5 version)" for 5; "The staff regains 2d8 + 4 expended charges daily
       * at dawn. If you expend the last charge, roll 1d20. On a 1, the staff
       * retains its +2 bonus to attack rolls and damage rolls but loses all
       * other properties. On a 20, the staff regains 1d8 + 2 charges."
       *
       * **Two of the three +2s**, because an Armour Class and a saving throw
       * are numbers the engine holds and a spell attack roll's bonus is not;
       * and **the 1 as the page writes it**: what "retains its +2 bonus to
       * attack rolls and damage rolls but loses all other properties" leaves
       * is a `quarterstaff-plus-2` — a Quarterstaff whose one property is
       * that +2 — which takes the staff's place in the hand. The 20 is a
       * benefit and is left out.
       *
       * **One reading is the record's and is said as a note.** The staff's
       * +2 is given only while attuned (its bracket), and the +2 Quarterstaff
       * asks no attunement, so after a 1 anybody swings it at +2 and the
       * wielder's attunement to the staff ends with the staff. The page says
       * the staff "loses all other properties" and does not say whether its
       * bracket is one of them; the alternative — a crumble — is harsher
       * than the page in the other direction.
       *
       * "(level 5 version)" is `level: 5` on a price of 5: five charges buy
       * the level 5 casting and nothing buys more.
       */
      attunement: { byClass: ['sorcerer', 'warlock', 'wizard'] },
      grants: [
        madeWithThisWeapon(2, true),
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'flat-bonus', applies: ['ac', 'save'], flat: 2 }],
          requires: WORN_AND_ATTUNED,
        },
        charges('staff-of-power', 'Staff of Power', 20, '2d8 + 4', {
          becomes: 'quarterstaff-plus-2',
          onD20AtOrBelow: 1,
        }),
        castsSpell('cone-of-cold', 5),
        castsSpell('fireball', 5, { level: 5 }),
        castsSpell('globe-of-invulnerability', 6),
        castsSpell('hold-monster', 5),
        castsSpell('levitate', 2),
        castsSpell('lightning-bolt', 5, { level: 5 }),
        castsSpell('magic-missile', 1),
        castsSpell('ray-of-enfeeblement', 1),
        castsSpell('wall-of-force', 5),
      ],
      unmodelled: [
        '"While holding it, you gain a +2 bonus to Armor Class, saving throws, and spell attack rolls": the third of the three is not granted, because no standing effect raises a spell attack roll',
        '"On a 20, the staff regains 1d8 + 2 charges": the last charge’s d20 is thrown for the 1, and a 20 on it pays nothing',
        '"the staff retains its +2 bonus to attack rolls and damage rolls but loses all other properties": what is left is the catalogue’s +2 Quarterstaff, which asks no attunement where the staff’s +2 was given only while attuned — so a 1 frees the attunement and hands the +2 to whoever picks the stick up, and whether the staff’s bracket survives among "all other properties" is the table’s to hold the wielder to',
        '"_Retributive Strike._ You can take a Magic action to break the staff over your knee or against a solid surface": an explosion sized by the charges left in the staff, a 50 percent trip to a random plane, and damage its breaker takes with neither an attack roll nor a save',
      ],
    },
  ),
  magicWeapon(
    { id: 'staff-of-the-magi', name: 'Staff of the Magi', row: 'quarterstaff', kind: 'staff' },
    {
      /**
       * SRD Staff of the Magi: "Staff, Legendary (Requires Attunement by a
       * Sorcerer, Warlock, or Wizard). This staff has 50 charges and can be
       * wielded as a magic Quarterstaff that grants a +2 bonus to attack rolls
       * and damage rolls made with it." Eighteen castings "using your spell
       * save DC", five of them priced "0"; "The staff regains 4d6 + 2
       * expended charges daily at dawn. If you expend the last charge, roll
       * 1d20. On a 20, the staff regains 1d12 + 1 charges."
       *
       * **A "0" in a charged staff's table is `atWill`**, and the difference
       * from a price of zero is the one the Helm of Comprehending Languages
       * made: nothing is spent, so there is no `resource-spent` of nothing.
       *
       * **No last-charge field, because the page destroys nothing.** Its d20
       * pays out on a 20 and costs nothing on any face, so leaving it out
       * leaves a staff that refills less rather than one that lasts longer.
       */
      attunement: { byClass: ['sorcerer', 'warlock', 'wizard'] },
      grants: [
        madeWithThisWeapon(2, true),
        charges('staff-of-the-magi', 'Staff of the Magi', 50, '4d6 + 2'),
        castsSpellAtWill('arcane-lock'),
        castsSpell('conjure-elemental', 7),
        castsSpellAtWill('detect-magic'),
        castsSpell('dispel-magic', 3),
        castsSpellAtWill('enlarge-reduce'),
        castsSpell('fireball', 7, { level: 7 }),
        castsSpell('flaming-sphere', 2),
        castsSpell('ice-storm', 4),
        castsSpell('invisibility', 2),
        castsSpell('knock', 2),
        castsSpellAtWill('light'),
        castsSpell('lightning-bolt', 7, { level: 7 }),
        castsSpell('passwall', 5),
        castsSpell('plane-shift', 7),
        castsSpellAtWill('protection-from-evil-and-good'),
        castsSpell('telekinesis', 5),
        castsSpell('wall-of-fire', 4),
        castsSpell('web', 2),
      ],
      unmodelled: [
        '"While you hold it, you gain a +2 bonus to spell attack rolls": no standing effect raises a spell attack roll',
        '"_Spell Absorption._ While holding the staff, you have Advantage on saving throws against spells": a mode narrowed to spells, and `againstMagic` is spells and every other magical effect as well, which is a wider staff than the page',
        '"you can take a Reaction when another creature casts a spell that targets only you. If you do, the staff absorbs the magic of the spell, canceling its effect and gaining a number of charges equal to the absorbed spell\'s level": a Reaction an item grants, and charges given back by a casting — and with it the explosion "if doing so brings the staff\'s total number of charges above 50", which only an absorption can cause',
        '"If you expend the last charge, roll 1d20. On a 20, the staff regains 1d12 + 1 charges": a d20 that only pays out, and nothing throws it',
        '"_Retributive Strike._ You can take a Magic action to break the staff over your knee or against a solid surface": an explosion sized by the charges left in the staff, a 50 percent trip to a random plane, and damage its breaker takes with neither an attack roll nor a save',
      ],
    },
  ),
  wornItem(
    { id: 'rod-of-alertness', name: 'Rod of Alertness', kind: 'rod' },
    {
      /**
       * SRD Rod of Alertness: "Rod, Very Rare (Requires Attunement). ...
       * _Alertness._ While holding the rod, you have Advantage on Wisdom
       * (Perception) checks and on Initiative rolls. _Spells._ While holding
       * the rod, you can cast the following spells from it" — Detect Evil and
       * Good, Detect Magic, Detect Poison and Disease and See Invisibility,
       * with no charge and no dawn.
       *
       * The Sentinel Shield's two modes, asked of an attuned hand, and four
       * at-will castings in the Helm of Comprehending Languages' shape.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: { mode: 'advantage', selector: { roll: 'initiative', relation: 'roller' } },
            },
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: {
                  roll: 'ability-check',
                  relation: 'roller',
                  ability: 'wis',
                  skill: 'perception',
                },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
        castsSpellAtWill('detect-evil-and-good'),
        castsSpellAtWill('detect-magic'),
        castsSpellAtWill('detect-poison-and-disease'),
        castsSpellAtWill('see-invisibility'),
      ],
      unmodelled: [
        '"_Protective Aura._ As a Magic action, you can plant the haft end of the rod in the ground, whereupon the rod\'s head sheds Bright Light in a 60-foot radius and Dim Light for an additional 60 feet. While in that Bright Light, you and your allies gain a +1 bonus to Armor Class and saving throws and can sense the location of any Invisible creature that is also in the Bright Light": a light an item sheds, a bonus to whoever stands in it and a sense of the Invisible — three shapes no item grant has',
      ],
    },
  ),
  wornItem(
    { id: 'ring-of-shooting-stars', name: 'Ring of Shooting Stars', kind: 'ring' },
    {
      /**
       * SRD Ring of Shooting Stars: "Ring, Very Rare (Requires Attunement).
       * You can cast _Dancing Lights_ or _Light_ from the ring. The ring has 6
       * charges and regains 1d6 expended charges daily at dawn. You can
       * expend its charges to use the properties below. _Faerie Fire._ You
       * can expend 1 charge to cast _Faerie Fire_ from the ring."
       *
       * **The two cantrips are free and the charges are for "the properties
       * below"**, which is what the entry's order says: the at-will sentence
       * comes before the charges are mentioned and names none. No last-charge
       * clause is printed, so none is written.
       */
      attunement: {},
      grants: [
        charges('ring-of-shooting-stars', 'Ring of Shooting Stars', 6, '1d6'),
        castsSpellAtWill('dancing-lights'),
        castsSpellAtWill('light'),
        castsSpell('faerie-fire', 1),
      ],
      unmodelled: [
        '"_Lightning Spheres._ You can expend 2 charges as a Magic action to create up to four 3-foot-diameter spheres of lightning": spheres an item makes, moved by Bonus Actions and held by a Concentration with no casting behind it, that discharge on whoever they first come near',
        '"_Shooting Stars._ You can expend 1 to 3 charges as a Magic action. For every charge you expend, you launch a glowing mote of light from the ring at a point you can see within 60 feet of yourself. Each creature in a 15-foot Cube originating from that point is showered in sparks and makes a DC 15 Dexterity saving throw": an area an item lays down at a point, one per charge, and a conferral has a reach and no area',
      ],
    },
  ),
  wornItem(
    { id: 'cloak-of-arachnida', name: 'Cloak of Arachnida', kind: 'wondrous' },
    {
      /**
       * SRD Cloak of Arachnida: "Wondrous Item, Very Rare (Requires
       * Attunement). ... While wearing it, you gain the following benefits.
       * _Poison Resistance._ You have Resistance to Poison damage. ... _Web._
       * You can cast _Web_ (save DC 13). The web created by the spell fills
       * twice its normal area. Once used, this property can't be used again
       * until the next dawn."
       *
       * The Resistance and the Web, in the Cape of the Mountebank's pool of
       * one. The doubled web is a benefit withheld — a casting from this
       * cloak fills Web's own cube — so the record is a weaker cloak than the
       * page, and the webs it walks through are benefits left out.
       *
       * _Spider Climb_ is the Slippers of Spider Climbing's sentence without
       * their slippery surface, so it is written as theirs is (W9-T): a
       * `match-walk` climb behind the same attunement bracket, and the walls
       * and ceilings the same debt.
       */
      attunement: {},
      grants: [
        resistanceWhileWorn(['poison']),
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'speed', change: 'match-walk', mode: 'climb' }],
          requires: WORN_AND_ATTUNED,
        },
        charges('cloak-of-arachnida', 'Cloak of Arachnida', 1),
        castsSpell('web', 1, { saveDc: 13 }),
      ],
      unmodelled: [
        '_Spider Climb_: "can move up, down, and across vertical surfaces and along ceilings, while leaving your hands free": the lattice holds elevation and no surfaces, as it does for SRD Spider Climb and the Slippers of Spider Climbing',
        '"_Spider Walk._ You can\'t be caught in webs of any sort and can move through webs as if they were Difficult Terrain": an immunity to a spell\'s area and a terrain rule keyed to it, neither of which an item grant can say',
        '"The web created by the spell fills twice its normal area": a `casts` grant hands the definition to the pipeline whole, so a web from this cloak fills Web\'s own 20-foot Cube — half the page\'s cloak rather than twice it',
      ],
    },
  ),

  // ── the spells eighteen entries were waiting for ─────────────────────────
  //
  // `ITEM_SHAPES`'s heaviest blocker was never an item mechanism: these entries
  // print a spell and the catalogue had no definition of it. The word that
  // decides one is *definition* rather than *executable* — `checkContent` asks
  // `spells.some(s => s.id === id)` and `castFromItem` reads `content.spell(id)`
  // — so a tracked definition answers both, and SRD's own sentence about a
  // casting from an item is every word arithmetic a tracked definition carries.

  wornItem(
    { id: 'boots-of-levitation', name: 'Boots of Levitation', kind: 'wondrous' },
    {
      /**
       * SRD Boots of Levitation: "Wondrous Item, Rare (Requires Attunement).
       * While you wear these boots, you can cast _Levitate_ on yourself."
       *
       * **One sentence, and it waited on a defect rather than on a shape.**
       * Levitate reaches "One creature ... of your choice that you can see
       * within range", so the definition carries `requiresSight`, and
       * `sightBetween` used to answer **null** for a creature and itself —
       * which the resolver turned into a request to establish a fact
       * `declareSight` refuses outright, "a creature can see itself". A record
       * every use of which is refused is rule 1 above, so the boots stayed
       * out; the pair answers `true` now, ahead of every declaration, and the
       * whole entry is the at-will casting below.
       *
       * The repair frees **every spell whose definition pairs `targets.self`
       * with `requiresSight`**, and the shape is what to look for rather than
       * a list of names: any list goes stale the next time `requiresSight` is
       * written in `spells.ts`.
       */
      attunement: {},
      grants: [castsSpellAtWill('levitate', { targetsSelfOnly: true })],
    },
  ),
  wornItem(
    { id: 'circlet-of-blasting', name: 'Circlet of Blasting', kind: 'wondrous' },
    {
      /**
       * SRD Circlet of Blasting: "Wondrous Item, Uncommon. While wearing this
       * circlet, you can cast _Scorching Ray_ with it (+5 to hit). The circlet
       * can't cast this spell again until the next dawn."
       *
       * **The item `castsSpell.attackBonus` was written for**, named in that
       * field's own docstring and until now used by nothing: "+5 to hit" is
       * the circlet's number and not its wearer's, exactly as a printed save
       * DC is, and it is pinned at the casting whoever is wearing the thing.
       *
       * The per-day line is a pool of one — the Cape of the Mountebank's
       * shape, in the circlet's own wording rather than the book's usual one.
       */
      grants: [
        charges('circlet-of-blasting', 'Circlet of Blasting', 1),
        castsSpell('scorching-ray', 1, { attackBonus: 5 }),
      ],
    },
  ),
  wornItem(
    { id: 'crystal-ball', name: 'Crystal Ball', kind: 'wondrous' },
    {
      /**
       * SRD Crystal Ball: "Wondrous Item, Very Rare (Requires Attunement).
       * While touching this crystal orb, you can cast _Scrying_ (save DC 17)
       * with it."
       *
       * A printed DC on a casting the book prices at nothing, which is a pair
       * no item in the catalogue had yet: `atWill` refuses a *cost* beside it
       * and a save DC is not one. Scrying takes ten minutes, so the orb is
       * also where a long casting time meets an item's route — the rite is
       * declared and settles on the clock exactly as a Wizard's would.
       */
      attunement: {},
      grants: [castsSpellAtWill('scrying', { saveDc: 17 })],
    },
  ),
  wornItem(
    {
      id: 'crystal-ball-of-mind-reading',
      name: 'Crystal Ball of Mind Reading',
      kind: 'wondrous',
    },
    {
      /**
       * SRD Crystal Ball of Mind Reading: "While touching this crystal orb,
       * you can cast _Scrying_ (save DC 17) with it. In addition, you can cast
       * _Detect Thoughts_ (save DC 17) targeting creatures you can see within
       * 30 feet of the spell's sensor."
       *
       * Two castings, both free and both against the orb's own seventeen. What
       * the second sentence does *to* the second casting is the note: it
       * retargets Detect Thoughts through a sensor the engine has nowhere to
       * put, and it takes the Concentration off it while welding its ending to
       * the Scrying's.
       */
      attunement: {},
      grants: [
        castsSpellAtWill('scrying', { saveDc: 17 }),
        castsSpellAtWill('detect-thoughts', { saveDc: 17 }),
      ],
      unmodelled: [
        'where the second casting reaches: "targeting creatures you can see within 30 feet of the spell\'s sensor" measures from the Scrying sensor, and the sensor is the one thing about Scrying the engine does not hold — so Detect Thoughts is cast from the orb at its own Range of Self instead',
        'the two exceptions the orb prints on that casting: "You don\'t need to concentrate on this _Detect Thoughts_ spell to maintain it during its duration, but it ends if the _Scrying_ spell ends" — a `casts` grant hands the spell to the pipeline whole, so the Concentration the spell prints is taken, and one casting ending another is a cause nothing can express',
      ],
    },
  ),
  wornItem(
    { id: 'crystal-ball-of-telepathy', name: 'Crystal Ball of Telepathy', kind: 'wondrous' },
    {
      /**
       * SRD Crystal Ball of Telepathy: "While touching this crystal orb, you
       * can cast _Scrying_ (save DC 17) with it. ... You can also cast
       * _Suggestion_ (save DC 17) through the sensor on one of those
       * creatures. ... You can't cast _Suggestion_ in this way again until the
       * next dawn."
       *
       * **The first item in the catalogue with two economies on one line.**
       * The book puts no limit at all on the Scrying and puts a per-day limit
       * on the Suggestion, so one grant is `atWill` and the other is priced
       * out of a pool of one — and a record that gave them one economy would
       * either ration a casting the book gives freely or hand out a Suggestion
       * every round.
       */
      attunement: {},
      grants: [
        charges('crystal-ball-of-telepathy', 'Crystal Ball of Telepathy', 1),
        castsSpellAtWill('scrying', { saveDc: 17 }),
        castsSpell('suggestion', 1, { saveDc: 17 }),
      ],
      unmodelled: [
        'the telepathy the orb is named for: "you can communicate telepathically with creatures you can see within 30 feet of the spell\'s sensor" is conversation through a sensor, and neither the conversation nor the sensor is a thing the engine holds',
        'where the Suggestion reaches: "through the sensor on one of those creatures" measures from that same sensor, so the spell is cast from the orb at its own range instead',
        'the exception the orb prints on that casting: "You don\'t need to concentrate on this _Suggestion_ to maintain it during its duration, but it ends if _Scrying_ ends" — a `casts` grant hands the spell to the pipeline whole, so the Concentration the spell prints is taken, and one casting ending another is a cause nothing can express',
      ],
    },
  ),
  wornItem(
    { id: 'crystal-ball-of-true-seeing', name: 'Crystal Ball of True Seeing', kind: 'wondrous' },
    {
      /**
       * SRD Crystal Ball of True Seeing: "While touching this crystal orb, you
       * can cast _Scrying_ (save DC 17) with it. In addition, you have
       * Truesight with a range of 120 feet centered on the spell's sensor."
       *
       * The fourth orb, and the shortest: one at-will casting against the
       * orb's own seventeen, exactly as the plain Crystal Ball prints it.
       *
       * **The Truesight is not a `sense` grant, and the reason is the second
       * half of the sentence.** A `sense` effect gives its holder a sense with
       * a range, measured from the holder; this one is "centered on the
       * spell's sensor", which is the one thing about Scrying the engine does
       * not hold. Granting it on the wearer would be a Truesight in the wrong
       * place, which is a better orb than the book prints.
       *
       * **And it is handed over rather than owed**, because nothing would read
       * it. The sensor is the table's — Scrying's own note calls it fiction,
       * and the tracked map rules Clairvoyance's sensor the same way: nothing
       * is measured from it and nothing is resolved at it. Sight here is a
       * declared fact between two creatures, and this orb makes no attack,
       * casting or save through its sensor, so a Truesight centred there
       * reaches no rule; what the scrier sees through it is the DM's to say.
       */
      attunement: {},
      grants: [castsSpellAtWill('scrying', { saveDc: 17 })],
      dmDecides: [
        "In addition, you have Truesight with a range of 120 feet centered on the spell's sensor.",
      ],
    },
  ),
  wornItem(
    { id: 'goggles-of-night', name: 'Goggles of Night', kind: 'wondrous' },
    {
      /**
       * SRD Goggles of Night: "Wondrous Item, Uncommon. While wearing these
       * dark lenses, you have Darkvision out to 60 feet. If you already have
       * Darkvision, wearing the goggles increases its range by 60 feet."
       *
       * **The first item in the catalogue to grant a sense**, and the item
       * the `sense` effect was named for: a species already writes exactly
       * this grant, and `sensesOf` reads it off whatever is worn and attuned
       * the same way it reads one off a species.
       *
       * The second sentence is a note rather than a blocker, and which of the
       * two it is turns on how the reader composes: `sensesOf` keeps the
       * **furthest** range each sense reaches, so a Drow in these goggles
       * sees 120 feet where the book gives them 180. That is the unsayable
       * clause leaving the wearer with *less* than the page, which is rule 2
       * of this file rather than rule 3.
       */
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
          requires: WORN,
        },
      ],
      unmodelled: [
        '"If you already have Darkvision, wearing the goggles increases its range by 60 feet": two sources of one sense compose by the furthest of them and never by the sum, so a wearer who already has Darkvision keeps the longer of the two ranges instead of adding the goggles\' sixty to it',
      ],
    },
  ),
  wornItem(
    { id: 'chime-of-opening', name: 'Chime of Opening', kind: 'wondrous' },
    {
      /**
       * SRD Chime of Opening: "Wondrous Item, Rare. This hollow metal tube
       * measures about 1 foot long and weighs 1 pound. As a Magic action, you
       * can strike the chime to cast _Knock_. ... The chime can be used 10
       * times. After the tenth time, it cracks and becomes useless."
       *
       * **A count with no morning behind it, which is the first of those in
       * the catalogue.** Every other charged item in the book prints a dawn
       * line, so `charges` hard-codes that recovery; the chime prints none at
       * all, and a `dawn` pool with no dice refills — so the tag is the whole
       * difference between ten strikes in a chime's life and ten every
       * morning. `countedUses` is the other tag, and the ten come off a pool
       * keyed to **this** chime.
       *
       * Knock is a tracked definition, which is what `checkContent` asks a
       * `casts` grant for: the word that decides one is *definition* and not
       * *executable*, and SRD's sentence about a casting from an item —
       * "uses its normal casting time, range, and duration" — is every word
       * arithmetic a tracked definition carries.
       *
       * **Both remaining sentences are the table's.** The tone is Knock's own
       * "loud knock, audible up to 300 feet away" in another voice, and
       * Knock hands that over; hearing is modelled nowhere. And "useless" is
       * already the whole of what a rule could read: the pool at zero refuses
       * every further strike. The cracked tube stays a pound in the pack,
       * which is what the book leaves it as.
       */
      grants: [
        countedUses('chime-of-opening', 'Chime of Opening strikes', 10),
        castsSpell('knock', 1),
      ],
      dmDecides: [
        "The spell's customary knocking sound is replaced by the clear, ringing tone of the chime, which is audible out to 300 feet.",
        'After the tenth time, it cracks and becomes useless.',
      ],
    },
  ),
  wornItem(
    { id: 'cube-of-force', name: 'Cube of Force', kind: 'wondrous' },
    {
      /**
       * SRD Cube of Force: "Wondrous Item, Rare (Requires Attunement). ... You
       * can press one of those faces, expend the number of charges required
       * for it, and thereby cast the spell associated with it (save DC 17), as
       * shown in the Cube of Force Faces table. The cube starts with 10
       * charges, and it regains 1d6 expended charges daily at dawn."
       *
       * **Six rows, six grants, and every one of them priced by the table.**
       * The Staff of Fire writes a grant per row and leaves out the row it
       * would get wrong; this cube leaves out nothing, because all six spells
       * are defined — two of them since before this batch, and three written
       * for this entry. The DC is printed once, before the table, so it
       * governs every row, including the two that roll nothing.
       *
       * The cube itself is handed over: its size and which marking a face
       * carries describe an object, and no rule reads either — what the
       * engine holds is six spells out of one pool at six prices, chosen by
       * naming the spell.
       */
      attunement: {},
      grants: [
        charges('cube-of-force', 'Cube of Force', 10, '1d6'),
        castsSpell('mage-armor', 1, { saveDc: 17 }),
        castsSpell('shield', 1, { saveDc: 17 }),
        castsSpell('tiny-hut', 3, { saveDc: 17 }),
        castsSpell('private-sanctum', 4, { saveDc: 17 }),
        castsSpell('resilient-sphere', 4, { saveDc: 17 }),
        castsSpell('wall-of-force', 5, { saveDc: 17 }),
      ],
      dmDecides: ['This cube is about an inch across.', 'Each face has a distinct marking on it.'],
    },
  ),
  wornItem(
    { id: 'cubic-gate', name: 'Cubic Gate', kind: 'wondrous' },
    {
      /**
       * SRD Cubic Gate: "Wondrous Item, Legendary. ... The cube has 3 charges
       * and regains 1d3 expended charges daily at dawn. As a Magic action, you
       * can expend 1 of the cube's charges to cast one of the following spells
       * using the cube. _Gate._ ... _Plane Shift._ ..."
       *
       * Two rows at one price, over the two spells in the book that are most
       * plainly about the second scene there is not — so the cube is the
       * clearest case in this batch of an item that is whole as an *economy*
       * and empty as a *journey*, and the notes on each spell say so rather
       * than this record repeating them.
       *
       * No bracket on the type line, which is the surprising half of a
       * Legendary entry: anybody may pick the cube up and press a side.
       *
       * **Which plane a side leads to is the table's**, and so is the press
       * that picks it. Plane Shift's destination is ruled the DM's in the
       * tracked map, and Gate's far end is Gate's own debt, reported on every
       * casting from its definition — what the cube adds is only *which* plane
       * that far end is, a name the GM gives and no rule reads. The press is
       * the gesture that chooses a row, and a `casts` grant is chosen by
       * naming the spell; the casting itself is elided out of both sentences,
       * because that half is the engine's.
       */
      grants: [
        charges('cubic-gate', 'Cubic Gate', 3, '1d3'),
        castsSpell('gate', 1),
        castsSpell('plane-shift', 1),
      ],
      dmDecides: [
        'The six sides of the cube are each keyed to a different plane of existence, one of which is the Material Plane.',
        'The other sides are linked to planes determined by the GM.',
        'Pressing one side of the cube ... opening a portal to the plane of existence keyed to that side.',
        'Pressing one side of the cube twice ... transporting the targets to the plane of existence keyed to that side.',
      ],
    },
  ),
  wornItem(
    { id: 'helm-of-teleportation', name: 'Helm of Teleportation', kind: 'wondrous' },
    {
      /**
       * SRD Helm of Teleportation: "Wondrous Item, Rare (Requires Attunement).
       * This helm has 3 charges. While wearing it, you can expend 1 charge to
       * cast _Teleport_ from it. The helm regains 1d3 expended charges daily
       * at dawn."
       *
       * Four sentences and no fifth: a pool, a price, a spell and a die at
       * dawn. So the record carries no `unmodelled` at all, and what Teleport
       * does not do is Teleport's note, handed to the table through
       * `unverified` on every casting.
       */
      attunement: {},
      grants: [
        charges('helm-of-teleportation', 'Helm of Teleportation', 3, '1d3'),
        castsSpell('teleport', 1),
      ],
    },
  ),
  wornItem(
    { id: 'medallion-of-thoughts', name: 'Medallion of Thoughts', kind: 'wondrous' },
    {
      /**
       * SRD Medallion of Thoughts: "Wondrous Item, Uncommon (Requires
       * Attunement). The medallion has 5 charges. While wearing it, you can
       * expend 1 charge to cast _Detect Thoughts_ (save DC 13) from it. The
       * medallion regains 1d4 expended charges daily at dawn."
       *
       * The Wand of Magic Detection's four sentences with a printed DC added,
       * and nothing else — so no `unmodelled` here either. The thirteen is the
       * medallion's: an Archmage wearing it still probes against 13.
       */
      attunement: {},
      grants: [
        charges('medallion-of-thoughts', 'Medallion of Thoughts', 5, '1d4'),
        castsSpell('detect-thoughts', 1, { saveDc: 13 }),
      ],
    },
  ),
  wornItem(
    { id: 'cloak-of-invisibility', name: 'Cloak of Invisibility', kind: 'wondrous' },
    {
      /**
       * SRD Cloak of Invisibility: "Wondrous Item, Legendary (Requires
       * Attunement). This cloak has 3 charges and regains 1d3 expended
       * charges daily at dawn. While wearing the cloak, you can take a Magic
       * action to pull its hood over your head and expend 1 charge to give
       * yourself the Invisible condition for 1 hour. The effect ends early if
       * you pull the hood down (no action required) or cease wearing the
       * cloak."
       *
       * **The Potion of Invisibility's condition on a charge**: a pool the
       * dawn partly refills, a Magic action priced at one charge out of it,
       * and the Invisible condition for the hour. The clause that limits it —
       * "or cease wearing the cloak" — is `source-item-removed` on the
       * condition's own timer, so the hour ends when the cloak comes off; it
       * was out until that cause existed, under `items.ts` rule 3.
       *
       * The hood is the one clause left, and it is a benefit withheld rather
       * than a limit dropped — a wearer who cannot pull it down ends the hour
       * by taking the cloak off, which is a narrower cloak and not a better
       * one — so this is rule 2.
       */
      attunement: {},
      grants: [
        charges('cloak-of-invisibility', 'Cloak of Invisibility', 3, '1d3'),
        {
          kind: 'confers',
          action: 'action',
          charges: 1,
          durationSeconds: 3600,
          endsEarly: ['source-item-removed'],
          effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
        },
      ],
      unmodelled: [
        '"The effect ends early if you pull the hood down (no action required)": a conferral is a moment with a lifetime the item states and offers no dismissal, so the hour runs until it is up or the cloak comes off',
      ],
    },
  ),
  magicArmor(
    {
      id: 'plate-armor-of-etherealness',
      name: 'Plate Armor of Etherealness',
      row: 'plate-armor',
    },
    {
      /**
       * SRD Plate Armor of Etherealness: "Armor (Half Plate Armor or Plate
       * Armor), Legendary (Requires Attunement). While you're wearing this
       * armor, you can take a Magic action and use a command word to gain the
       * effect of the _Etherealness_ spell. The spell ends immediately if you
       * remove the armor or take a Magic action to repeat the command word.
       * This property of the armor can't be used again until the next dawn."
       *
       * **Armour and a casting on one record**, which nothing in the catalogue
       * had: the armour half is the Plate Armor row pinned into the equip
       * event like any other, and the casting half is a pool of one and a
       * `casts` grant. "Gain the effect of the spell" is a casting rather than
       * a conferral here, and that is the book's own fork read the right way
       * round: a conferral carries an effect list, and Etherealness resolves
       * nothing, so a conferral would confer nothing — where a casting spends
       * no slot, takes the Magic action the entry asks for, and starts the
       * eight-hour clock the spell prints.
       *
       * The entry is two suits of armour, and so is the catalogue. The book
       * names both in its type line rather than leaving the GM to choose, so
       * this is not the "GM chooses the version" shape: it is one entry over
       * two rows of the Armor table, exactly as a +1 Longsword and a +1
       * Rapier are one entry over two rows of the Weapons table. The Half
       * Plate version is the record below, with its own id and its own row.
       */
      attunement: {},
      grants: [
        charges('plate-armor-of-etherealness', 'Plate Armor of Etherealness', 1),
        castsSpell('etherealness', 1),
      ],
      unmodelled: [
        'what ends the casting early: "The spell ends immediately if you remove the armor or take a Magic action to repeat the command word" — taking an item off is not one of the causes a casting can end on, and the command word is a dismissal by the caster that the book charges a Magic action for where `endOngoingSpell` charges nothing',
      ],
    },
  ),
  magicArmor(
    {
      id: 'half-plate-armor-of-etherealness',
      name: 'Half Plate Armor of Etherealness',
      row: 'half-plate-armor',
    },
    {
      /**
       * SRD Plate Armor of Etherealness, the other suit its type line names:
       * "Armor (Half Plate Armor or Plate Armor)".
       *
       * The record above on the Half Plate row — the same pool of one, the
       * same casting and the same note about what the book says ends it —
       * and so the Armor Class, weight and Stealth of Half Plate Armor, which
       * is all that differs between the two suits.
       */
      attunement: {},
      grants: [
        charges('half-plate-armor-of-etherealness', 'Half Plate Armor of Etherealness', 1),
        castsSpell('etherealness', 1),
      ],
      unmodelled: [
        'what ends the casting early: "The spell ends immediately if you remove the armor or take a Magic action to repeat the command word" — taking an item off is not one of the causes a casting can end on, and the command word is a dismissal by the caster that the book charges a Magic action for where `endOngoingSpell` charges nothing',
      ],
    },
  ),
  wornItem(
    { id: 'ring-of-telekinesis', name: 'Ring of Telekinesis', kind: 'ring' },
    {
      /**
       * SRD Ring of Telekinesis: "Ring, Very Rare (Requires Attunement). While
       * wearing this ring, you can cast _Telekinesis_ from it."
       *
       * One sentence, priced at nothing, over a Concentration spell that runs
       * ten minutes — so the ring costs its wearer whatever they were already
       * holding, which is the whole of what the engine can say about it and
       * the whole of what the entry says.
       */
      attunement: {},
      grants: [castsSpellAtWill('telekinesis')],
    },
  ),
  wornItem(
    { id: 'rod-of-resurrection', name: 'Rod of Resurrection', kind: 'rod' },
    {
      /**
       * SRD Rod of Resurrection: "Rod, Legendary (Requires Attunement). The
       * rod has 5 charges. While you hold it, you can cast one of the
       * following spells from it: _Heal_ (expends 1 charge) or _Resurrection_
       * (expends 5 charges). The rod regains 1 expended charge daily at
       * dawn."
       *
       * **The item that waited on one field, and the field is there now.**
       * `ResourcePool.regainsAtDawn` read dice and nothing else, on the
       * reasoning that the SRD "prints dice" and never once a stated number —
       * and this rod is the counterexample the book prints. Leaving the field
       * off was not neutral, because a `dawn` pool with no dice **refills**:
       * the record would have been a rod giving back five charges a morning
       * where the book gives one, which is rule 3 above. `statedDawnAmount`
       * reads the bare `'1'` as the number it is, and `declareDawn` hands it
       * back without throwing anything.
       *
       * Two prices on one pool, which is the staff shape: Heal executes and
       * Resurrection is an hour's rite the clock runs, and SRD's "uses its
       * normal casting time" is why the second is declared and settled rather
       * than cast on the spot.
       */
      attunement: {},
      grants: [
        /**
         * "If you expend the last charge, roll 1d20. On a 1, the rod
         * disappears in a harmless burst of radiance": the wands' crumble in
         * other words, and the same field — the copy leaves the hand and the
         * pack either way.
         */
        charges('rod-of-resurrection', 'Rod of Resurrection', 5, '1', CRUMBLES_ON_A_1),
        castsSpell('heal', 1),
        castsSpell('resurrection', 5),
      ],
    },
  ),
  /**
   * The two entries whose whole mechanic is **a count on this copy**, and the
   * only two in the book that print the same sentence twice.
   *
   * SRD Sovereign Glue and Universal Solvent both say "When found, a
   * container contains 1d6 + 1 ounces", and until an item copy had a record
   * there was nowhere to keep the answer: a catalogue row is the same for
   * everybody, so one jar could not be half empty while another was full.
   * `CatalogueItem.chargesRolled` is the item saying the book rolls for it,
   * `awardItems` is the one door that may throw the die, and the pool it pins
   * is keyed to the copy.
   *
   * **The dice are the whole of the sizing.** They live on the pool grant
   * rather than on the item, which is where a validator can see them: a pool
   * may not print a rolled maximum and a flat `uses` both, so there is no
   * floor beneath the roll and no placeholder pretending to be one.
   * `issueItemCopies` leaves such a copy's pool unsized for any door that
   * cannot roll, and `awardItems` throws the die once and pins what it threw.
   */
  wornItem(
    { id: 'sovereign-glue', name: 'Sovereign Glue', kind: 'wondrous' },
    {
      /**
       * **The bond is the table's, from both ends and in its jar.** Nothing
       * holds two objects together and no rule would ask whether they are:
       * movement moves no attached thing, and breaking an object is a door's
       * hit points rather than a join. So an ounce is spent, and the table says
       * what it stuck to, what may unstick it, and what it was kept in.
       *
       * The application goes over with it, for the Solvent's reason: how much
       * surface an ounce covers, the Utilize action that applies it and the
       * minute it takes to set are the price and the timing of a bond no rule
       * reads. The ounce is elided out of the application, because counting
       * ounces is the pool's.
       */
      grants: [rolledUses('sovereign-glue', 'Sovereign Glue ounces', '1d6 + 1')],
      dmDecides: [
        'This viscous, milky-white substance can form a permanent adhesive bond between any two objects.',
        'It must be stored in a jar or flask that has been coated inside with _Oil of Slipperiness_.',
        'One ounce of the glue can cover a 1-foot square surface.',
        'Applying ... takes a Utilize action, and the applied glue takes 1 minute to set.',
        'Once it has done so, the bond it creates can be broken only by the application of _Universal Solvent_ or _Oil of Etherealness_, or with a _Wish_ spell.',
      ],
    },
  ),
  wornItem(
    { id: 'universal-solvent', name: 'Universal Solvent', kind: 'wondrous' },
    {
      /**
       * The Sovereign Glue's tube, with the same rolled count and the same
       * absent state on the other side of it.
       *
       * Handed over for the glue's reason: an adhesive is not a state the
       * engine holds, so what an ounce dissolves is the table's, and so is the
       * surface it is poured on — nothing is targeted and no roll is made, so
       * "within reach" measures nothing a rule reads. The ounces are elided
       * out of the pour, because counting them is the pool's.
       */
      grants: [rolledUses('universal-solvent', 'Universal Solvent ounces', '1d6 + 1')],
      dmDecides: [
        'You can take a Utilize action to pour ... onto a surface within reach.',
        'Each ounce instantly dissolves up to 1 square foot of adhesive it touches, including _Sovereign Glue_.',
      ],
    },
  ),

  // ── the item that can fail ───────────────────────────────────────────────
  //
  // One entry, and the only one in the book whose use may simply not work.
  // What kept it out was never its spell — Gust of Wind has been defined and
  // tracked since the tracked definitions landed — but the die behind "a
  // cumulative 20 percent chance", and the count of uses that die is rolled
  // against. Both are the engine's now: a tally, which is a pool with no size
  // and so nothing that can refuse, and an outcome on the resolution rather
  // than a fourth kind of answer.
  wornItem(
    { id: 'wind-fan', name: 'Wind Fan', kind: 'wondrous' },
    {
      /**
       * SRD Wind Fan: "Wondrous Item, Uncommon. While holding this fan, you
       * can cast _Gust of Wind_ (save DC 13) from it. Each subsequent time the
       * fan is used before the next dawn, it has a cumulative 20 percent
       * chance of not working; if the fan fails to work, it tears into
       * useless, nonmagical tatters."
       *
       * **Every word of it, and the second sentence is the interesting one.**
       * The first is the Crystal Ball's shape — a casting the book prices at
       * nothing, against a DC the item prints rather than its holder's — and
       * no bracket on the type line, so anybody may pick the fan up.
       *
       * The second is a **count** and a **chance**, and it is why the fan is
       * not a pool of five. A pool would refuse the sixth use with nothing
       * left to spend; the book rolls for the sixth at a hundred percent and
       * tears the fan in half. So the uses are tallied under the key below and
       * zeroed at the next declared dawn, and the percentage is rolled against
       * `1d100` before the spell is cast at all — a failed use costs the
       * holder the action and the fan, and makes no casting.
       */
      grants: [
        castsSpellAtWill('gust-of-wind', {
          saveDc: 13,
          failsCumulatively: {
            percent: 20,
            key: 'wind-fan:uses',
            recovers: 'dawn',
            destroyed: true,
          },
        }),
      ],
      unmodelled: [
        'two fans in one pack share one count of uses: the count is keyed to the copy wherever a copy has a record, and only an item with a charge pool is given one when it is gained — the fan has no charges at all, so its copies are the stack they have always been',
      ],
    },
  ),

  // ── two conferrals that are not potions ──────────────────────────────────
  //
  // SRD writes the `confers` grant's sentence about Potions — "Many items,
  // such as Potions, bypass the casting of a spell" — and *such as* is the
  // word these two turn on. A conferral is an effect list with no casting
  // behind it, and nothing about it is a bottle: one of these is thrown into
  // the air and the other is worn round a neck and spent a charge at a time.
  //
  // Both were on the blocked map until its item shapes were re-derived, and
  // both were blocked on a claim that had stopped being true — the first on
  // "a condition whose duration the item rolls for, which no conferral can
  // state", the second on a charge buying something other than a casting.
  // `durationRolled` and `ItemConfersGrant.charges` are the two fields that
  // answer them, and neither was written for these entries.
  wornItem(
    { id: 'dust-of-disappearance', name: 'Dust of Disappearance', kind: 'wondrous' },
    {
      /**
       * SRD Dust of Disappearance: "Wondrous Item, Uncommon. This powder
       * resembles fine sand. There is enough of it for one use. When you take
       * a Utilize action to throw the dust into the air, you and each
       * creature and object within a 10-foot Emanation originating from you
       * have the Invisible condition for 2d4 minutes. The duration is the
       * same for all subjects, and the dust is consumed when its magic takes
       * effect. Immediately after an affected creature makes an attack roll,
       * deals damage, or casts a spell, the Invisible condition ends for that
       * creature."
       *
       * **The Potion of Invisibility's grant with a die where its hour is.**
       * The same condition, filed under `item:<id>` with no casting anywhere
       * near it; the same three end causes, which are three of the four
       * `EFFECT_END_CAUSES` names — `target-dons-armor` is the fourth and is
       * SRD Mage Armor's, so no dust prints it; and a span the item rolls
       * rather than prints, which `useItem` throws once at the use and pins
       * as a deadline, so a replay reads the minutes out of the log instead
       * of throwing a second, different pair of d4s.
       *
       * **Rule 2, and the clause it leaves out gives the thrower nothing
       * less than the page does.** A conferral lands on its user or on one
       * creature within five feet — SRD's own sentence about administering a
       * potion is the whole of `useItem`'s reach — so the companions the
       * Emanation catches are the table's. That is a narrower dust rather
       * than a better one, which is what separates rule 2 from rule 3.
       */
      grants: [
        {
          kind: 'confers',
          action: 'action',
          durationRolled: { dice: '2d4', secondsEach: 60 },
          endsEarly: ['target-attacks', 'target-deals-damage', 'target-casts'],
          effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
        },
      ],
      unmodelled: [
        '"you and each creature and object within a 10-foot Emanation originating from you": a conferral reaches its user or one creature within 5 feet and has no field for an area, so only the thrower is made Invisible and the companions the dust catches are the table\'s — as is every object it touches, which is not a creature at all',
        '"The duration is the same for all subjects" follows from the above rather than being honoured: there is one subject, so the sentence has nothing to keep in step',
      ],
    },
  ),
  wornItem(
    { id: 'periapt-of-health', name: 'Periapt of Health', kind: 'wondrous' },
    {
      /**
       * SRD Periapt of Health: "Wondrous Item, Uncommon (Requires
       * Attunement). While wearing this pendant, you can take a Magic action
       * to regain 2d4 + 2 Hit Points. Once used, this property can't be used
       * again until the next dawn. In addition, you have Advantage on saving
       * throws to avoid or end the Poisoned condition while you wear this
       * pendant."
       *
       * **A conferral priced in a charge, which is the half of
       * `a-charge-spent-on-something-other-than-a-casting` that is built.**
       * What the charge buys here is not a casting: it is the Potion of
       * Healing's own effect list, on an item that is worn rather than drunk.
       * So the record is the two halves the SRD prints — a per-day pool of
       * one, which is `charges` with every number set to it, and a conferral
       * that costs one of them — and `useItem` spends the charge out of the
       * pendant's own pool instead of taking the pendant off the neck.
       *
       * **The dice are the item's and the caster is nobody**, exactly as they
       * are in the bottle: `addSpellcastingModifier: false`, because a
       * conferral has no spellcasting ability modifier to add and
       * `checkContent` refuses an item that says otherwise.
       *
       * **And the second paragraph is a standing grant.** "Advantage on
       * saving throws to avoid or end the Poisoned condition" is a saving
       * throw selected by what it is *about* — `RollSelector.condition`, the
       * axis SRD Fey Ancestry and Dwarven Resilience are written on — held
       * while the pendant is worn and attuned, so the whole entry is here.
       */
      attunement: {},
      grants: [
        charges('periapt-of-health', 'Periapt of Health', 1),
        {
          kind: 'confers',
          action: 'action',
          charges: 1,
          effects: [
            { kind: 'heal', healing: { dice: '2d4', flat: 2 }, addSpellcastingModifier: false },
          ],
        },
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', condition: 'poisoned' },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'necklace-of-adaptation', name: 'Necklace of Adaptation', kind: 'wondrous' },
    {
      /**
       * SRD Necklace of Adaptation: "Wondrous Item, Uncommon (Requires
       * Attunement). While wearing this necklace, you can breathe normally in
       * any environment, and you have Advantage on saving throws made to
       * avoid or end the Poisoned condition."
       *
       * The Periapt of Health's second paragraph, worn alone. The breathing
       * is fiction, as SRD Water Breathing's is: the engine holds no air and
       * no drowning, so nothing a rule reads is missing and there is no note
       * to write.
       */
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', condition: 'poisoned' },
              },
            },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
    },
  ),
  wornItem(
    { id: 'winged-boots', name: 'Winged Boots', kind: 'wondrous' },
    {
      /**
       * SRD Winged Boots: "Wondrous Item, Uncommon (Requires Attunement).
       * These boots have 4 charges and regain 1d4 expended charges daily at
       * dawn. While wearing the boots, you can take a Magic action to expend
       * 1 charge, gaining a Fly Speed of 30 feet for 1 hour. If you are
       * flying when the duration expires, you descend at a rate of 30 feet
       * per round until you land."
       *
       * **The Periapt's shape with a Speed where its healing is**: a pool the
       * dawn partly refills, and a conferral priced at one charge out of it,
       * which `useItem` spends only from a wearer who has attuned. What the
       * charge buys is SRD Fly's own grant at half the feet and without the
       * hovering the spell prints — "a Fly Speed of 30 feet" and nothing
       * after it — for the boots' hour. A Speed stated rather than changed,
       * so `at-least`: under SRD Fly as well, the wearer flies at the
       * spell's 60 and not at 90.
       *
       * The hour is the conferral's and is not tied to the boots staying on,
       * because the book does not tie it: "while wearing the boots" governs
       * the Magic action, and what the action gains lasts "for 1 hour".
       */
      attunement: {},
      grants: [
        charges('winged-boots', 'Winged Boots', 4, '1d4'),
        {
          kind: 'confers',
          action: 'action',
          charges: 1,
          durationSeconds: 3600,
          effects: [{ kind: 'speed', change: 'at-least', feet: 30, mode: 'fly' }],
        },
      ],
      unmodelled: [
        '"If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land": nothing fires when a conferral\'s hour runs out, so a wearer still aloft is the table\'s to bring down — the fall SRD Fly leaves to the DM, and here a gentler one',
      ],
    },
  ),
  wornItem(
    { id: 'boots-of-speed', name: 'Boots of Speed', kind: 'wondrous' },
    {
      /**
       * SRD Boots of Speed: "Wondrous Item, Rare (Requires Attunement). While
       * you wear these boots, you can take a Bonus Action to click the boots'
       * heels together. If you do, the boots double your Speed, and any
       * creature that makes an Opportunity Attack against you has
       * Disadvantage on the attack roll. If you click your heels together
       * again, you end the effect. When you've used the boots' property for a
       * total of 10 minutes, the magic ceases to function for you until you
       * finish a Long Rest."
       *
       * **The Potion of Speed's doubling on a pair of boots**, for the ten
       * minutes the book allows, bought with a pool of one that a Long Rest
       * gives back. "The boots double your Speed" is the boots' own effect,
       * so it ends when they come off — `source-item-removed` — which is the
       * clause that kept them out under `items.ts` rule 3: without it the
       * doubling ran its ten minutes on bare feet.
       *
       * What is left out is benefit withheld, so this is rule 2. The ten
       * minutes are spent in one click rather than split across several, the
       * heels cannot be clicked again to stop early, and the Opportunity
       * Attack's Disadvantage is not given — each is a narrower pair of boots
       * than the book's and never a better one.
       */
      attunement: {},
      grants: [
        {
          kind: 'pool',
          key: 'boots-of-speed:charges',
          label: 'Boots of Speed',
          uses: 1,
          recovers: 'long-rest',
        },
        {
          kind: 'confers',
          action: 'bonus-action',
          charges: 1,
          durationSeconds: 600,
          endsEarly: ['source-item-removed'],
          effects: [{ kind: 'speed', change: 'double' }],
        },
      ],
      unmodelled: [
        '"any creature that makes an Opportunity Attack against you has Disadvantage on the attack roll": a conferral grants no roll mode narrowed to an Opportunity Attack, so the attack is rolled as it would be anyway',
        '"If you click your heels together again, you end the effect": a conferral offers no dismissal, so the doubling runs until its ten minutes are up or the boots come off',
        '"When you\'ve used the boots\' property for a total of 10 minutes": one click spends the whole ten minutes, because nothing counts the time a conferral ran and a pool counts uses — so the minutes cannot be split across several clicks before the Long Rest',
      ],
    },
  ),
  wornItem(
    { id: 'robe-of-the-archmagi', name: 'Robe of the Archmagi', kind: 'wondrous' },
    {
      /**
       * SRD Robe of the Archmagi: "Wondrous Item, Legendary (Requires
       * Attunement by a Sorcerer, Warlock, or Wizard). ... You gain these
       * benefits while wearing the robe. _Armor._ If you aren't wearing
       * armor, your base Armor Class is 15 plus your Dexterity modifier.
       * _Magic Resistance._ You have Advantage on saving throws against
       * spells and other magical effects. _War Mage._ Your spell save DC and
       * spell attack bonus each increase by 2."
       *
       * Two of the three benefits, and each is a sentence the vocabulary
       * already writes word for word: Magic Resistance is `againstMagic` —
       * "spells and other magical effects" is that selector's own reading —
       * and the first half of War Mage is `spell-save-dc-bonus` with no class
       * narrowing, which is the reading its own docstring gives an item. Both
       * wait on the robe being worn and on the attunement the bracket asks
       * for, and the bracket's three classes are the attunement's.
       *
       * What is left out is benefit withheld rather than limit dropped, so
       * this is rule 2: the robe below is a weaker robe than the book's, never
       * a stronger one.
       */
      attunement: { byClass: ['sorcerer', 'warlock', 'wizard'] },
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
              },
            },
            { kind: 'spell-save-dc-bonus', flat: 2 },
          ],
          requires: WORN_AND_ATTUNED,
        },
      ],
      unmodelled: [
        '"If you aren\'t wearing armor, your base Armor Class is 15 plus your Dexterity modifier": a worn item grants a flat bonus to Armor Class and has no grant that replaces the base formula, so the wearer keeps whatever base they had',
        '"Your spell save DC and spell attack bonus each increase by 2" is honoured for the DC and not for the attack bonus: nothing a worn item grants reaches a spell attack roll, which is the shape the blocked map calls `a-bonus-to-spell-attack-rolls`',
      ],
    },
  ),
];

/**
 * The Potions, which are the items the book uses up rather than wears.
 *
 * SRD "Magic Items": "Many items, such as Potions, **bypass the casting of a
 * spell** and confer the spell's effects with its usual duration", and
 * "Drinking a potion or administering it to another creature requires a Bonus
 * Action. Once used, a potion takes effect immediately, and it is used up."
 * That is the `confers` grant in one paragraph: an action, an effect list, and
 * no casting anywhere in it.
 *
 * Whichever of them the three rules above {@link NAMED_ITEMS} admit — the
 * count is `COVERAGE.md`'s and not this docstring's. Most of the rest of the
 * book's potions say "you gain the effect of the X spell (no Concentration
 * required)", which a conferral cannot express: it carries an effect list and
 * not a spell id, so where that spell is *tracked* rather than executed the
 * list would be empty, and rule 1 leaves the potion out. The others set an
 * ability score, or deal damage nothing rolls for.
 *
 * **A condition handed over outright is sayable**, which is what the Potion
 * of Invisibility is: no casting, no roll, a condition filed under
 * `item:<id>` and a timer that holds the hour and the sentence that cuts it
 * short. **And so is a condition a *save* imposes**, which this docstring
 * denied for two batches and which `CONFERRED_EFFECT_KINDS` has admitted
 * since the weld was cut — a `PendingSave` names the *source* now rather than
 * a casting id, so a repeat at the end of each turn ends the condition on its
 * own target and nothing has to have been cast.
 *
 * **Potion of Poison is the one worth naming, because the clause that keeps
 * it out is not the one this file used to say.** SRD: "If you drink this
 * potion, you take 4d6 Poison damage and must succeed on a DC 13 Constitution
 * saving throw or have the Poisoned condition for 1 hour." The middle clause
 * is a `save` effect against the bottle's own printed DC, hour and all. The
 * 4d6 is **not** on the save — it lands whether the save is made or not —
 * which is a hit with no roll to make it, the shape Magic Missile is blocked
 * on and the one `save-damage` cannot be bent into without inventing a rule
 * the book does not print. A record carrying the save without the damage
 * would be a strictly gentler poison, which is rule 3, so the flask waits.
 */
const POTIONS: readonly CatalogueItem[] = [
  {
    /**
     * SRD Potion of Animal Friendship: "_Potion, Uncommon._ When you drink
     * this potion, you can cast the level 3 version of the _Animal
     * Friendship_ spell (save DC 13)."
     *
     * **The one potion that casts rather than confers**, and the sentence says
     * which: "you can cast", where the others say "you gain the effect of". So
     * it is a `casts` grant on the item's route — Animal Friendship's own
     * Action, range, sight and Beast, at level 3 and against the bottle's 13 —
     * whose price is the bottle (`usedUp`) rather than a charge, drunk out of
     * the pack. The drinking is the Bonus Action the Potions rule prints, spent
     * beside the casting's Action and not instead of it.
     */
    id: 'potion-of-animal-friendship',
    name: 'Potion of Animal Friendship',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'casts',
        spell: 'animal-friendship',
        usedUp: { action: 'bonus-action' },
        level: 3,
        saveDc: 13,
      },
    ],
  },
  {
    /**
     * SRD Potion of Healing, printed in the equipment table as well as the
     * magic-item chapter: "As a Bonus Action, you can drink it or administer
     * it to another creature within 5 feet of yourself. The creature that
     * drinks the magical red fluid in this vial regains 2d4 + 2 Hit Points."
     *
     * The whole sentence, with nothing left out: the action, the reach and the
     * dice are the three things the grant carries, and
     * `addSpellcastingModifier: false` is the fourth — a potion has no caster,
     * so the modifier a healing *spell* adds is not added here.
     *
     * The greater, superior and supreme rows of the same table are the same
     * grant with different dice, and each is a record of its own below under
     * the name its row prints: four potions are four things an inventory can
     * hold side by side, so four ids tell them apart without a copy needing
     * a record of its own.
     */
    id: 'potion-of-healing',
    name: 'Potion of Healing',
    kind: 'potion',
    weightLb: 0.5,
    costCp: 50 * COPPER_PER.gp,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [
          { kind: 'heal', healing: { dice: '2d4', flat: 2 }, addSpellcastingModifier: false },
        ],
      },
    ],
  },
  {
    /**
     * SRD Potion of Heroism: "When you drink this potion, you gain 10
     * Temporary Hit Points that last for 1 hour. For the same duration, you
     * are under the effect of the _Bless_ spell (no Concentration required)."
     *
     * **Bless written out, and named.** A conferral carries its own effect
     * list rather than a spell's, so the Bless half is Bless's own effect —
     * `{ dice: '1d4' }` on attack rolls and saving throws — transcribed here.
     * "No Concentration required" is then not a clause the engine has to
     * honour but a description of what a conferral already is: there is no
     * casting to concentrate on. `effectOf: 'bless'` is what makes it Bless
     * where it counts: beside a Cleric's Bless it is one 1d4, not two.
     *
     * **The ten Temporary Hit Points are a `temp-hp` amount with no dice in
     * it**, which is what `DiceScaling.dice` became optional for: the book
     * prints a number, the potion hands over that number, and nothing is
     * thrown for it. `addSpellcastingModifier: false` for the reason the
     * Potion of Healing's is false — a conferral has no caster.
     *
     * **And the hour on them is kept.** `EffectTarget` names a creature's
     * pool of Temporary Hit Points, so the conferral files a deadline on it
     * beside the one it files on the Bless half, and both come due on the same
     * second. The key is the creature rather than the item, because the SRD is
     * explicit that Temporary Hit Points do not stack: a creature holds one
     * pool, and one pool has one lifetime.
     */
    id: 'potion-of-heroism',
    name: 'Potion of Heroism',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        // "For the same duration" — SRD Bless runs a minute and this one runs
        // the potion's hour, which is why the number is the item's.
        durationSeconds: 3600,
        // "you are under the effect of the _Bless_ spell"
        effectOf: 'bless',
        effects: [
          // "you gain 10 Temporary Hit Points": a printed number, and nothing
          // is thrown for it.
          { kind: 'temp-hp', amount: { flat: 10 }, addSpellcastingModifier: false },
          {
            kind: 'buff',
            bonus: { source: 'Potion of Heroism', dice: '1d4' },
            applies: ['attack', 'save'],
            direction: 'add',
          },
        ],
      },
    ],
  },
  {
    /**
     * SRD Potion of Invisibility: "This potion's container looks empty but
     * feels as though it holds liquid. When you drink the potion, you have the
     * Invisible condition for 1 hour. The effect ends early if you make an
     * attack roll, deal damage, or cast a spell."
     *
     * **The first item that confers a condition, and it needed no casting to
     * do it.** What lands is a condition instance filed under
     * `item:potion-of-invisibility` — a source `castingIdOf` answers null for,
     * so there is nothing in `ongoing`, nothing for Dispel Magic to find and
     * nothing for `releaseCasting` to address. The record of it is the
     * condition's own timer: the hour is its deadline, and the sentence that
     * cuts the hour short is `endsEarly`.
     *
     * **The three causes are the three the SRD prints, and they are the same
     * three Invisibility prints** — the spell and the potion say the sentence
     * in the same words, which is why the engine reads them off one
     * vocabulary. `target-dons-armor` is the fourth cause and is Mage Armor's;
     * no potion prints it, so this line does not.
     *
     * A second draught inside the hour **refreshes** rather than stacks, and
     * nothing here says so: one item, one condition, one creature is one
     * instance, and the timer is keyed by it. That is SRD "Combining Magical
     * Effects" falling out of the identity.
     */
    id: 'potion-of-invisibility',
    name: 'Potion of Invisibility',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 3600,
        endsEarly: ['target-attacks', 'target-deals-damage', 'target-casts'],
        effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
      },
    ],
    unmodelled: [
    ],
  },
  {
    /**
     * SRD Potion of Diminution: "Potion, Rare. When you drink this potion, you
     * gain the 'reduce' effect of the _Enlarge/Reduce_ spell for 1d4 hours (no
     * Concentration required)."
     *
     * **The Potion of Growth's sentence with the other branch and a die in
     * it.** The bottle makes the choice the casting cannot record — the label
     * says reduce — so the conferral writes that branch and nothing is
     * guessed; and where its sibling prints ten minutes, this one prints
     * dice, which is `durationRolled`: the engine throws it once when the
     * potion is drunk and pins the moment it decided into the log.
     */
    id: 'potion-of-diminution',
    name: 'Potion of Diminution',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationRolled: { dice: '1d4', secondsEach: 3600 },
        effects: [
          // "The target also has Disadvantage on Strength checks and Strength
          // saving throws": two rolls named in one clause, so two selectors.
          {
            kind: 'roll-mode',
            modifier: { mode: 'disadvantage', selector: { roll: 'ability-check', relation: 'roller', ability: 'str' } },
          },
          {
            kind: 'roll-mode',
            modifier: { mode: 'disadvantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' } },
          },
        ],
      },
    ],
    unmodelled: [
      'the size category the reduce branch takes away — one step down, Medium to Small — is not applied: the Enlarge/Reduce definition writes it as a `size` rider on its save, and a conferral may not hang riders — `modifiers` is one of the fields `checkContent` refuses on a conferred effect, because the road a rider reaches the world by is the casting arm of the save resolver and a bottle has no casting',
      'the 1d4 taken off the drinker\'s later attacks with reduced weapons or Unarmed Strikes is not hung: the spell writes it as a `damage-penalty` rider beside the size, and it is refused on a conferral for the same reason — the same half of the same sentence the Potion of Growth leaves out from the other end',
      'the gear changing size with the drinker, and a thrown weapon returning to normal after it hits or misses, are the DM\'s',
    ],
  },
  {
    /**
     * SRD Potion of Growth: "Potion, Uncommon. When you drink this potion, you
     * gain the 'enlarge' effect of the _Enlarge/Reduce_ spell for 10 minutes
     * (no Concentration required)."
     *
     * **The bottle makes the choice the casting cannot record.** Enlarge/Reduce
     * is a tracked definition and stays one, because its two branches say
     * opposite things about Strength checks and Strength saving throws and a
     * choice made at the casting has nowhere to be kept. A potion has no such
     * problem: the label says "enlarge", so the conferral writes that branch
     * and nothing is guessed — which is the Potion of Heroism's Bless written
     * out rather than named, arriving at a spell the catalogue does not
     * execute.
     *
     * "No Concentration required" is then a description of what a conferral
     * already is rather than a clause to honour, and the ten minutes are the
     * potion's own rather than the spell's minute.
     */
    id: 'potion-of-growth',
    name: 'Potion of Growth',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 600,
        effects: [
          // "The target also has Advantage on Strength checks and Strength
          // saving throws": two rolls named in one clause, so two selectors.
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'ability-check', relation: 'roller', ability: 'str' } },
          },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' } },
          },
        ],
      },
    ],
    unmodelled: [
      'the size category the enlarge branch grants — one step up, Medium to Large — is not applied: the Enlarge/Reduce definition writes it as a `size` rider on its save, and a conferral may not hang riders — `modifiers` is one of the fields `checkContent` refuses on a conferred effect, because the road a rider reaches the world by is the casting arm of the save resolver and a bottle has no casting',
      'the extra 1d4 on the drinker\'s later attacks with enlarged weapons or Unarmed Strikes is not hung: the spell writes it as a `later-blow` rider beside the size, and it is refused on a conferral for the same reason',
      'the gear changing size with the drinker, and a thrown weapon returning to normal after it hits or misses, are the DM\'s',
    ],
  },
  {
    /**
     * SRD Potion of Speed: "Potion, Very Rare. When you drink this potion, you
     * gain the effect of the _Haste_ spell for 1 minute (no Concentration
     * required) without suffering the wave of lethargy that typically occurs
     * when the effect ends."
     *
     * Haste's four benefits, out of a bottle, copied from the Haste
     * definition effect for effect: the doubled Speed, the +2 to Armour Class,
     * the Advantage on Dexterity saving throws, and the additional action on
     * each of the drinker's turns — minted at each turn's start, spendable
     * only on the five actions the spell names, and holding one attack where
     * the drinker's own Attack action may hold more.
     *
     * **The lethargy clause is honoured by construction, and it is worth
     * saying which construction.** Haste lays its wave of lethargy through
     * the definition's `onEnd`, which fires when a *casting* ends. A
     * conferral has no casting and no `onEnd` field to write one in: when the
     * minute runs out its timer takes the four grants off and lays nothing.
     * So "without suffering the wave of lethargy" is what this record does
     * because of the shape it is written in, not because a rule was skipped.
     *
     * `effectOf: 'haste'` makes it Haste for SRD "Combining Spell Effects":
     * beside a Haste it is +2 AC and one extra action, not +4 and two.
     */
    id: 'potion-of-speed',
    name: 'Potion of Speed',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        // "for 1 minute" — the potion's own span, where Haste runs on
        // Concentration for up to the same minute.
        durationSeconds: 60,
        // "you gain the effect of the _Haste_ spell"
        effectOf: 'haste',
        effects: [
          // "the target's Speed is doubled"
          { kind: 'speed', change: 'double' },
          { kind: 'buff', bonus: { source: 'Potion of Speed', flat: 2 }, applies: ['ac'], direction: 'add' },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'dex' } },
          },
          // "it gains an additional action on each of its turns. That action
          // can be used to take only the Attack (one attack only), Dash,
          // Disengage, Hide, or Utilize action."
          {
            kind: 'action-rule',
            rule: {
              kind: 'grants',
              at: 'each-turn',
              only: ['attack', 'dash', 'disengage', 'hide', 'utilize'],
              attacksCap: 1,
            },
          },
        ],
      },
    ],
  },
  {
    /**
     * SRD Potion of Gaseous Form: "Potion, Rare. When you drink this potion,
     * you gain the effect of the _Gaseous Form_ spell for 1 hour (no
     * Concentration required) or until you end the effect as a Bonus Action."
     *
     * The Gaseous Form definition's seven effects, copied effect for effect:
     * the Resistance to three physical damage types, Immunity to the Prone
     * condition, Advantage on saving throws with each of three abilities, a
     * Fly Speed of 10 feet that hovers as the drinker's **only** way to move,
     * and the rule that refuses an Attack, a casting and every hand put on a
     * thing. What the spell leaves undone the potion leaves undone too, and
     * those gaps are repeated here in the spell's own terms because a
     * conferral hands nothing over from a definition — it carries its own
     * list, so it carries its own gaps too.
     *
     * **The Immunity was the fifth and was refused by a name collision.**
     * `CONFERRED_EFFECT_KINDS` admitted `condition-immunity` and `RIDER_FIELDS`
     * refused any conferred effect carrying a field called `conditions` —
     * which is the outcome rider a saving throw hangs *and* this kind's own
     * required list. The refusal is about the rider again rather than about
     * the spelling, and the clause the spell executes is conferred here.
     */
    id: 'potion-of-gaseous-form',
    name: 'Potion of Gaseous Form',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 3600,
        // The spell's "The spell ends on the target if it drops to 0 Hit
        // Points", which the effect the potion confers carries with it: every
        // grant below is filed on one timer, and the fall ends that timer.
        endsEarly: ['target-drops-to-0'],
        effects: [
          { kind: 'damage-defense', damageTypes: ['bludgeoning', 'piercing', 'slashing'], defense: 'resistant' },
          // "You have Immunity to the Prone condition" — the spell's own
          // effect, conferred rather than cast.
          { kind: 'condition-immunity', conditions: ['prone'] },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' } },
          },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'dex' } },
          },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'con' } },
          },
          // The spell's "only method of movement is a Fly Speed of 10 feet,
          // and it can hover": one operation, so a Longstrider on the same
          // drinker puts no walking back into a cloud.
          { kind: 'speed', change: 'only', mode: 'fly', feet: 10, hover: true },
          // The spell's "can't attack or cast spells" and "can't ... manipulate
          // objects": the Attack action, a casting from any slot, and every
          // command that puts a hand on a thing.
          {
            kind: 'action-rule',
            rule: { kind: 'forbids', actions: ['attack'], casting: true, objects: true },
          },
        ],
      },
    ],
    unmodelled: [
      '"or until you end the effect as a Bonus Action": a conferral is a moment with a lifetime the item states and there is no casting for a dismissal to address, so the hour runs to the end',
      'one of the four things the cloud cannot do is not forbidden: talking, which the Gaseous Form definition leaves undone for its own reason — it is not an action anything spends, and it sits in the same printed sentence as the object clauses this record does forbid',
      'occupying another creature\'s space is not allowed: occupancy is a rule the engine owns outright, and nothing lets an effect tell that rule to believe something different about one creature — the Gaseous Form definition\'s own note',
      'passing through narrow openings and treating liquids as solid surfaces are the DM\'s, as they are for the spell: the cloud itself is fiction',
    ],
  },
  {
    /**
     * SRD Potions of Healing, the second row: "Potion of Healing (greater)",
     * 4d4 + 4, Uncommon. The Potion of Healing's grant with the row's dice.
     */
    id: 'potion-of-healing-greater',
    name: 'Potion of Healing (greater)',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [
          { kind: 'heal', healing: { dice: '4d4', flat: 4 }, addSpellcastingModifier: false },
        ],
      },
    ],
  },
  {
    /** SRD Potions of Healing, the third row: "Potion of Healing (superior)", 8d4 + 8, Rare. */
    id: 'potion-of-healing-superior',
    name: 'Potion of Healing (superior)',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [
          { kind: 'heal', healing: { dice: '8d4', flat: 8 }, addSpellcastingModifier: false },
        ],
      },
    ],
  },
  {
    /** SRD Potions of Healing, the last row: "Potion of Healing (supreme)", 10d4 + 20, Very Rare. */
    id: 'potion-of-healing-supreme',
    name: 'Potion of Healing (supreme)',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [
          { kind: 'heal', healing: { dice: '10d4', flat: 20 }, addSpellcastingModifier: false },
        ],
      },
    ],
  },
  {
    /**
     * SRD Elixir of Health: "Potion, Rare. When you drink this potion, you are
     * cured of all magical contagions. In addition, the following conditions
     * end on you: Blinded, Deafened, Paralyzed, and Poisoned."
     *
     * The four conditions are SRD Greater Restoration's `end-condition` with
     * the page's own list, in the page's own order; it hangs nothing, so the
     * conferral states no lifetime. A contagion is not a state the engine
     * holds, so curing one is the table's and there is nothing to write down.
     */
    id: 'elixir-of-health',
    name: 'Elixir of Health',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        effects: [
          { kind: 'end-condition', conditions: ['blinded', 'deafened', 'paralyzed', 'poisoned'] },
        ],
      },
    ],
  },
  {
    /**
     * SRD Potion of Invulnerability: "Potion, Rare. For 1 minute after you
     * drink this potion, you have Resistance to all damage."
     *
     * "All damage" written out as the thirteen types, the way SRD Protection
     * from Energy writes its list, and the minute as the conferral's own
     * lifetime.
     */
    id: 'potion-of-invulnerability',
    name: 'Potion of Invulnerability',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 60,
        effects: [
          {
            kind: 'damage-defense',
            // "all damage": the thirteen types, in the order the SRD's
            // Damage Types table prints them.
            damageTypes: [
              'acid',
              'bludgeoning',
              'cold',
              'fire',
              'force',
              'lightning',
              'necrotic',
              'piercing',
              'poison',
              'psychic',
              'radiant',
              'slashing',
              'thunder',
            ],
            defense: 'resistant',
          },
        ],
      },
    ],
  },
  {
    /**
     * SRD Potion of Flying: "Potion, Very Rare. When you drink this potion, you
     * gain a Fly Speed equal to your Speed for 1 hour and can hover. If you're
     * in the air when the potion wears off, you fall unless you have some
     * other means of staying aloft."
     *
     * "Equal to your Speed" is `match-walk`, the sentence SRD Spider Climb
     * prints of a Climb Speed, and "can hover" is the flag SRD Fly hands over
     * beside its own Fly Speed.
     */
    id: 'potion-of-flying',
    name: 'Potion of Flying',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 3600,
        effects: [{ kind: 'speed', change: 'match-walk', mode: 'fly', hover: true }],
      },
    ],
    unmodelled: [
      'the fall when the potion wears off on a drinker still aloft is the DM’s: "If you\'re in the air when the potion wears off, you fall unless you have some other means of staying aloft" — nothing fires when a conferral\'s hour runs out, the note SRD Fly carries for its own ending',
    ],
  },
  {
    /**
     * SRD Potion of Climbing: "Potion, Common. When you drink this potion, you
     * gain a Climb Speed equal to your Speed for 1 hour. During this time, you
     * have Advantage on Strength (Athletics) checks to climb."
     *
     * The Climb Speed is SRD Spider Climb's `match-walk`, for the potion's
     * hour. The Advantage is left out rather than widened: a mode on every
     * Strength (Athletics) check would reach a Grapple and a Shove as well as
     * a climb, which is a better potion than the book prints.
     */
    id: 'potion-of-climbing',
    name: 'Potion of Climbing',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'confers',
        action: 'bonus-action',
        durationSeconds: 3600,
        effects: [{ kind: 'speed', change: 'match-walk', mode: 'climb' }],
      },
    ],
    unmodelled: [
      '"you have Advantage on Strength (Athletics) checks to climb" is not granted: a mode may be narrowed to a skill but not to what the check is for, and the same mode on every Athletics check would reach a Grapple or a Shove the potion says nothing about',
    ],
  },
];

const MAGIC_ITEMS: readonly CatalogueItem[] = [
  ...PLUS_WEAPONS,
  ...PLUS_ARMOR,
  ...PLUS_SHIELDS,
  ...MITHRAL_ARMOR,
  ...ADAMANTINE_ARMOR,
  ...NAMED_ITEMS,
  ...POTIONS,
];

function build(): readonly CatalogueItem[] {
  const items = new Map<string, CatalogueItem>();

  for (const item of CLASS_ITEMS) items.set(item.id, item);
  for (const item of CONJURED_ITEMS) items.set(item.id, item);
  for (const item of MAGIC_ITEMS) items.set(item.id, item);

  for (const entry of GEAR) {
    items.set(entry.id, {
      id: entry.id,
      name: entry.name,
      kind: 'gear',
      weightLb: weightInPounds(entry.weight),
      costCp: priceInCopper(entry.cost),
      armor: null,
      weapon: null,
      contents: entry.contents.map((line) => ({ id: line.gearId, quantity: line.quantity })),
    });
  }

  // **The Potion of Healing is printed twice**, and the magic-item record is
  // the one that keeps: SRD's Adventuring Gear table lists it with a price and
  // its whole description, and the magic-item chapter prints it under the
  // Potions of Healing entry. The gear loop above has just overwritten it with
  // a `gear` row that confers nothing, so the transcription is laid back down.
  // Re-setting an id a `Map` already holds leaves it where it was, so the order
  // of `SRD_ITEMS` is the order it has always been.
  for (const potion of POTIONS) items.set(potion.id, potion);

  // SRD prices ammunition by the bundle — "Arrows (20)" costs 1 GP — so the
  // catalogue entry is one arrow and `bundleSize` says what a purchase buys.
  // Pricing the bundle as a single item would make one arrow cost a gold piece.
  for (const round of AMMUNITION) {
    const bundle = priceInCopper(round.cost);
    const weight = weightInPounds(round.weight);
    items.set(round.id, {
      id: round.id,
      name: round.name,
      kind: 'ammunition',
      weightLb: weight === null ? null : weight / round.amount,
      costCp: bundle === null ? null : bundle / round.amount,
      armor: null,
      weapon: null,
      contents: [],
      bundleSize: round.amount,
    });
  }

  for (const tool of TOOLS) {
    items.set(tool.id, {
      id: tool.id,
      name: tool.name,
      kind: 'tool',
      weightLb: weightInPounds(tool.weight),
      costCp: priceInCopper(tool.cost),
      armor: null,
      weapon: null,
      contents: [],
    });
  }

  for (const weapon of WEAPONS) {
    items.set(weapon.id, {
      id: weapon.id,
      name: weapon.name,
      kind: 'weapon',
      weightLb: weapon.weightLb,
      costCp: weapon.cost.amount * (COPPER_PER[weapon.cost.currency] ?? 1),
      armor: null,
      weapon,
      contents: [],
    });
  }

  for (const piece of ARMOR) {
    items.set(piece.id, {
      id: piece.id,
      name: piece.name,
      kind: 'armor',
      weightLb: piece.weightLb,
      costCp: piece.cost.amount * (COPPER_PER[piece.cost.currency] ?? 1),
      armor: piece,
      weapon: null,
      contents: [],
    });
  }

  return [...items.values()];
}

/** The SRD's equipment, weapons, armour, tools and ammunition, as engine items. */
export const SRD_ITEMS: readonly CatalogueItem[] = build();

/**
 * The magic items alone, for the guards that read them.
 *
 * Derived from the same array the catalogue is built from rather than filtered
 * out of it by a predicate: "which of these is magic" is a question with an
 * answer here and a guess anywhere else.
 */
export const SRD_MAGIC_ITEMS: readonly CatalogueItem[] = MAGIC_ITEMS;
