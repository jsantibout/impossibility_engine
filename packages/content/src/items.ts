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
 *
 * The SRD prints no price for these — the tables that do are for mundane gear
 * — so it is null, and buying one is refused exactly as buying anything the
 * book declines to price is. Weight is null for the same reason, *except*
 * where the item is a magical version of a row that does print one: a +1
 * Longsword is a Longsword, and it weighs what the table says a Longsword
 * weighs.
 *
 * **Three entries are expressible and are not here**, which is a boundary
 * rather than a reading. The `ability-score-set` standing grant landed with
 * the batch that wrote this paragraph, so "Your Constitution is 19 while you
 * wear this amulet" is now a sentence the vocabulary says — the Amulet of
 * Health, the Gauntlets of Ogre Power and the Headband of Intellect each
 * have that one clause and nothing else. Transcribing one makes its line in
 * `scripts/missing-shapes.ts` stale, and `blocked-on-items.test.ts` fails
 * until the line goes with the record; that file was reserved to other work
 * while this was written, so the grant is proved through homebrew in
 * `packages/engine/src/ability-score-set.test.ts` and the three records wait
 * for one commit that can hold both halves.
 *
 * Two neighbours of theirs are **not** freed by it, and the difference is the
 * verb. The Belt of Giant Strength sets a score and keeps a second blocker —
 * five versions on one printed table. The three manuals and three tomes are
 * "your Constitution increases by 2, to a maximum of 30" after forty-eight
 * hours of study: a *permanent* change, applied by an event nothing emits,
 * which is what is left of `an-ability-score-a-spell-changes`.
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
): ItemGrant => ({
  kind: 'pool',
  key: `${id}:charges`,
  label: `${name} charges`,
  uses,
  recovers: 'dawn',
  ...(regainsAtDawn === undefined ? {} : { regainsAtDawn }),
});

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
       * SRD "Combining Game Effects": "when two or more game features have the
       * same name, only the effects of one of them — the most potent — apply."
       * Two *different* names both apply, so a character wearing both is +2 —
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

  // ── worn things that grant a defence ─────────────────────────────────────
  wornItem(
    { id: 'boots-of-the-winterlands', name: 'Boots of the Winterlands', kind: 'wondrous' },
    {
      /**
       * SRD Boots of the Winterlands: "_Cold Resistance._ You have Resistance
       * to Cold damage and can tolerate temperatures of 0 degrees Fahrenheit
       * or lower without any additional protection."
       */
      attunement: {},
      grants: [resistanceWhileWorn(['cold'])],
      unmodelled: [
        'the other half of the same sentence — you "can tolerate temperatures of 0 degrees Fahrenheit or lower without any additional protection" — and there is no weather here to tolerate',
        '"_Winter Strider._ You ignore Difficult Terrain created by ice or snow": terrain has no kinds in the engine, and what a square is made of is the DM\'s',
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
      unmodelled: [
        '"your steps make no sound, regardless of the surface you are moving across": silence is not Advantage on anything, and whether a guard hears you is the DM\'s',
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
      /** SRD: "While wearing this armor, you gain a +1 bonus to Armor Class." */
      grants: [armorClassWhileWorn(1)],
      unmodelled: [
        'the glamour: "You can also take a Bonus Action to cause the armor to assume the appearance of a normal set of clothing or some other kind of armor" — what a suit of armour looks like is the DM\'s, and an illusion costs an action nothing here would spend',
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
       * and Slashing damage while you wear this armor."
       */
      attunement: {},
      grants: [resistanceWhileWorn(['bludgeoning', 'piercing', 'slashing'])],
      unmodelled: [
        '"**_Metal Shell._** You can take a Magic action to give yourself Immunity to Bludgeoning, Piercing, and Slashing damage for 10 minutes or until you are no longer wearing the armor. Once this property is used, it can\'t be used again until the next dawn": an action that switches a defence on for a span is the unbuilt `use` grant, and a standing grant offers Resistance rather than Immunity',
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
       * weapon."
       */
      grants: [madeWithThisWeapon(1)],
      unmodelled: [
        '"The weapon deals an extra 3d6 damage of the weapon\'s type if the target is a Dragon": the narrowing to the weapon is sayable now and the narrowing to the *target* is not — `attack-damage` has no test of what the creature being hit is, so the die would land on everything this sword touched',
      ],
    },
  ),
  magicWeapon(
    { id: 'giant-slayer', name: 'Giant Slayer', row: 'greataxe' },
    {
      /**
       * SRD Giant Slayer: "Weapon (Any Simple or Martial), Rare. You gain a +1
       * bonus to attack rolls and damage rolls made with this magic weapon."
       */
      grants: [madeWithThisWeapon(1)],
      unmodelled: [
        '"When you hit a Giant with this weapon, the Giant takes an extra 2d6 damage of the weapon\'s type and must succeed on a DC 15 Strength saving throw or have the Prone condition": the narrowing to the weapon is sayable, but "a Giant" is a test of what the target is and the rest is a save a weapon forces, and an item declares neither',
      ],
    },
  ),
  magicWeapon(
    { id: 'mace-of-smiting', name: 'Mace of Smiting', row: 'mace' },
    {
      /**
       * SRD Mace of Smiting: "Weapon (Mace), Rare. You gain a +1 bonus to
       * attack rolls and damage rolls made with this magic weapon."
       */
      grants: [madeWithThisWeapon(1)],
      unmodelled: [
        '"The bonus increases to +3 when you use the weapon to attack a Construct": a flat bonus is one number and has no test of what it is swung at',
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
      grants: [madeWithThisWeapon(3, true)],
      unmodelled: [
        '"When you hit a Fiend or an Undead with it, that creature takes an extra 2d10 Radiant damage": narrowing the die to the weapon is sayable and narrowing it to what the target is is not — nothing on the damage path reads a creature\'s type',
        '"You and all creatures Friendly to you in the Emanation have Advantage on saving throws against spells and other magical effects": the aura is writable and the narrowing is not — a save has no key for what it is *against*, so the mode would reach every save of every ally',
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
      unmodelled: [
        '"_Alarm._ The weapon magically awakens each subject who is sleeping naturally when combat begins": natural sleep is not a condition the engine holds',
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
      grants: [charges('eyes-of-charming', 'Eyes of Charming', 3)],
      unmodelled: [
        'what the charges buy: "you can expend 1 or more charges to cast _Charm Person_ (save DC 13) ... You increase the spell\'s level by one for each additional charge you expend" — a spell cast from an item, at a level the charges decide',
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
        charges('wand-of-fireballs', 'Wand of Fireballs', 7, '1d6 + 1'),
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
      unmodelled: [
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself, which nothing removes from an inventory',
      ],
    },
  ),
  /**
   * **The four wands whose whole remainder was one sentence**, and the
   * sentence was already a note rather than a blocker.
   *
   * Every wand in this family prints "If you expend the wand's last charge,
   * roll 1d20. On a 1, the wand crumbles into ashes and is destroyed", and
   * the Wand of Fireballs and the Wand of Web above carry it in
   * {@link CatalogueItem.unmodelled} — because nothing removes a line from an
   * inventory, so a record without the clause is a wand that lasts *longer*
   * than the book's rather than one that does more. That is rule 2 of this
   * file, not rule 3: the unsayable clause takes the item away, so leaving it
   * out cannot hand a party a better wand than the page prints.
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
        charges('wand-of-polymorph', 'Wand of Polymorph', 7, '1d6 + 1'),
        castsSpell('polymorph', 1, { saveDc: 15 }),
      ],
      unmodelled: [
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself on a die face, which nothing removes from an inventory',
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
        charges('wand-of-lightning-bolts', 'Wand of Lightning Bolts', 7, '1d6 + 1'),
        castsSpell('lightning-bolt', 1, { upToCharges: 3, saveDc: 15 }),
      ],
      unmodelled: [
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself on a die face, which nothing removes from an inventory',
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
        charges('wand-of-binding', 'Wand of Binding', 7, '1d6 + 1'),
        castsSpell('hold-monster', 5, { saveDc: 17 }),
        castsSpell('hold-person', 2, { saveDc: 17 }),
      ],
      unmodelled: [
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself on a die face, which nothing removes from an inventory',
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
       * **Both parentheticals are notes, and both for the same reason as the
       * crumble: each leaves the wand weaker than the page.** Command is
       * tracked and resolves nothing, so there are no options for "flee or
       * grovel only" to narrow; and Fear's own area is a 30-foot Cone, so a
       * casting from this wand catches half of what the book's wand catches
       * rather than twice as much.
       */
      attunement: {},
      grants: [
        charges('wand-of-fear', 'Wand of Fear', 7, '1d6 + 1'),
        castsSpell('command', 1, { saveDc: 15 }),
        castsSpell('fear', 3, { saveDc: 15 }),
      ],
      unmodelled: [
        '"*Fear* (60-foot Cone)": the wand widens the spell\'s area and a `casts` grant hands the definition to the pipeline whole, so a casting from this wand fills Fear\'s own 30-foot Cone — half the page\'s wand rather than twice it',
        '"*Command* (flee or grovel only)": the narrowing has nothing to narrow, because Command is a tracked definition and the option a caster chooses is what it leaves to the table',
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself on a die face, which nothing removes from an inventory',
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
        charges('wand-of-web', 'Wand of Web', 7, '1d6 + 1'),
        castsSpell('web', 1, { saveDc: 13 }),
      ],
      unmodelled: [
        '"If you expend the wand\'s last charge, roll 1d20. On a 1, the wand crumbles into ashes and is destroyed": an item that destroys itself, which nothing removes from an inventory',
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
        charges('staff-of-fire', 'Staff of Fire', 10, '1d6 + 4'),
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
         * book prices each spell separately and the two the catalogue can cast
         * are priced differently.
         */
        castsSpell('burning-hands', 1),
        castsSpell('fireball', 3),
      ],
      unmodelled: [
        'the third row of the staff\'s table, "_Wall of Fire_" at 4 charges: the catalogue has no definition of that spell, which is blocked on a wall — an area shape the engine does not hold — and on damage with neither an attack roll nor a save',
        '"If you expend the last charge, roll 1d20. On a 1, the staff crumbles into cinders and is destroyed": an item that destroys itself, which nothing removes from an inventory',
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
        '"_Giant\'s Bane._ While you are attuned to the weapon and wearing either a _Belt of Giant Strength_ or _Gauntlets of Ogre Power_ to which you are also attuned, you gain the following benefits": a benefit conditional on *another item* being attuned, which no requirement asks — and neither of the two named items is transcribed, because both set an ability score',
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
       */
      attunement: {},
      grants: [castsSpellAtWill('scrying', { saveDc: 17 })],
      unmodelled: [
        'the sight the orb is named for: "you have Truesight with a range of 120 feet centered on the spell\'s sensor" measures from the Scrying sensor, and a `sense` effect reaches out from the creature holding it — so a grant here would put the Truesight on the wearer instead of where the book puts it',
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
       */
      grants: [
        countedUses('chime-of-opening', 'Chime of Opening strikes', 10),
        castsSpell('knock', 1),
      ],
      unmodelled: [
        '"After the tenth time, it cracks and becomes useless": the pool at zero refuses every further strike, which is the whole of what the chime then does — but nothing takes the cracked tube out of the inventory it is carried in',
        'the sound: "The spell\'s customary knocking sound is replaced by the clear, ringing tone of the chime, which is audible out to 300 feet" — what a casting sounds like, and how far, is the table\'s',
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
      unmodelled: [
        'the faces themselves are the DM\'s: "This cube is about an inch across. Each face has a distinct marking on it" describes an object, and which marking a face carries is not a fact the engine holds — what it holds is that six spells come out of one pool at six prices',
      ],
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
       */
      grants: [
        charges('cubic-gate', 'Cubic Gate', 3, '1d3'),
        castsSpell('gate', 1),
        castsSpell('plane-shift', 1),
      ],
      unmodelled: [
        'the six sides and what they lead to: "The six sides of the cube are each keyed to a different plane of existence, one of which is the Material Plane. The other sides are linked to planes determined by the GM" — the GM chooses the planes and the engine holds one scene, so which side was pressed decides nothing it could read',
        'how each casting is asked for: "Pressing one side of the cube" and "Pressing one side of the cube twice" are the gesture that chooses the row, and a `casts` grant is chosen by naming the spell',
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
       * The entry is two suits of armour and the record is one. The book names
       * both in its type line rather than leaving the GM to choose, so this is
       * not the "GM chooses the version" shape — it is one entry that would
       * need two ids, and the Half Plate version is the note below rather than
       * a second record invented here.
       */
      attunement: {},
      grants: [
        charges('plate-armor-of-etherealness', 'Plate Armor of Etherealness', 1),
        castsSpell('etherealness', 1),
      ],
      unmodelled: [
        'the Half Plate version: the book files this entry under Half Plate Armor or Plate Armor, and this record is the Plate one — a catalogue holds a suit of armour rather than a template, so the second suit would need an id of its own',
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
        charges('rod-of-resurrection', 'Rod of Resurrection', 5, '1'),
        castsSpell('heal', 1),
        castsSpell('resurrection', 5),
      ],
      unmodelled: [
        '"If you expend the last charge, roll 1d20. On a 1, the rod disappears in a harmless burst of radiance": an item that destroys itself on a die face, which is neither a reader the engine has nor something that removes a line from an inventory',
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
      grants: [rolledUses('sovereign-glue', 'Sovereign Glue ounces', '1d6 + 1')],
      unmodelled: [
        'the bond itself: a substance that "can form a permanent adhesive bond between any two objects" is not a mechanical state — nothing holds two objects together and no rule would ask — so an ounce is spent and the table says what it stuck to',
        'what dissolves the bond: "the bond it creates can be broken only by the application of _Universal Solvent_ or _Oil of Etherealness_, or with a _Wish_ spell" names the same absent state from the other end',
        'the jar the glue is kept in: "It must be stored in a jar or flask that has been coated inside with _Oil of Slipperiness_" is one item\'s condition on another, and inventory holds neither containers nor coatings',
      ],
    },
  ),
  wornItem(
    { id: 'universal-solvent', name: 'Universal Solvent', kind: 'wondrous' },
    {
      /**
       * The Sovereign Glue's tube, with the same rolled count and the same
       * absent state on the other side of it.
       */
      grants: [rolledUses('universal-solvent', 'Universal Solvent ounces', '1d6 + 1')],
      unmodelled: [
        'what an ounce dissolves: "Each ounce instantly dissolves up to 1 square foot of adhesive it touches" — an adhesive is not a state the engine holds, so the ounce is spent and the dissolving is the table\'s',
        '"onto a surface within reach": the reach here is an arm\'s rather than a weapon\'s — nothing is targeted, no roll is made, and the engine\'s ruler is never asked',
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
 * Three of them, by the three rules above {@link NAMED_ITEMS}. Most of the
 * rest of the book's potions say "you gain the effect of the X spell (no
 * Concentration required)", which a conferral cannot express: it carries an
 * effect list and not a spell id, so the whole of such a potion's text is
 * beyond the vocabulary and rule 1 leaves it out. The others set an ability
 * score, or roll a save to impose a condition.
 *
 * **A condition handed over outright is now sayable**, which is what the
 * Potion of Invisibility is: no casting, no roll, a condition filed under
 * `item:<id>` and a timer that holds the hour and the sentence that cuts it
 * short. What is still not sayable is a condition a *save* imposes.
 *
 * **Potion of Poison is the one worth naming, because it looks admissible and
 * is not.** SRD: "If you drink this potion, you take 4d6 Poison damage and
 * must succeed on a DC 13 Constitution saving throw or have the Poisoned
 * condition for 1 hour." A conferral may now print a DC and roll a save
 * against it, so the middle clause is sayable; the other two are not. The
 * `save` kind carries a `repeats`, and a repeat save is a `PendingSave` that
 * names a casting id — so a condition a save imposes still waits, even though
 * one handed over outright no longer does. And the 4d6 is **not** on the
 * save — it lands whether the save is made or not — which is a hit with no
 * roll to make it, the shape Magic Missile is blocked on and the one
 * `save-damage` cannot be bent into without inventing a rule the book does
 * not print. What would be left is a saving throw that decides nothing, on a
 * potion that does nothing, so rule 1 leaves it out.
 */
const POTIONS: readonly CatalogueItem[] = [
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
     * grant with different dice and are not transcribed, because the SRD files
     * all four under one entry with one id and item instance identity is what
     * would tell four potions apart on one line of an inventory.
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
    unmodelled: [
      'the three other rows of the Potions of Healing table — "Potion of Healing (greater)" 4d4 + 4, "(superior)" 8d4 + 8, "(supreme)" 10d4 + 20 — which the SRD files under one entry and which would need four ids, or an item instance record, to sit on one inventory line',
    ],
  },
  {
    /**
     * SRD Potion of Heroism: "When you drink this potion, you gain 10
     * Temporary Hit Points that last for 1 hour. For the same duration, you
     * are under the effect of the _Bless_ spell (no Concentration required)."
     *
     * **Bless written out rather than named.** A conferral carries an effect
     * list and not a spell id, so the Bless half is Bless's own effect —
     * `{ dice: '1d4' }` on attack rolls and saving throws — transcribed here.
     * "No Concentration required" is then not a clause the engine has to
     * honour but a description of what a conferral already is: there is no
     * casting to concentrate on.
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
      '"if you make an attack roll": the engine reads `target-attacks` off `attack-made`, which is the Attack action rather than every attack roll. A free swing that misses — an Opportunity Attack, an attack outside combat — leaves the potion running, because the only event naming the roller of one is `roll-recorded` and that event changes no state by rule. A free swing that lands deals damage, and `target-deals-damage` catches it. The same residue SRD Invisibility records',
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
      'the size category the enlarge branch grants — one step up, Medium to Large — is not applied: size is a fact the engine holds authoritatively and reads for sharing a space, passing through and what a template catches, and nothing may write over one for a duration (see the Enlarge/Reduce definition, whose notes this repeats because a conferral carries an effect list rather than a spell id)',
      'the extra 1d4 on the drinker\'s later attacks with enlarged weapons or Unarmed Strikes is not hung: the damage has no type printed and so is the weapon\'s own, which no rider says',
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
     * Haste's two writable benefits, out of a bottle: the +2 to Armour Class
     * and the Advantage on Dexterity saving throws, for the potion's minute.
     * What the spell cannot say the potion cannot either, and the note says
     * which halves those are.
     *
     * **The lethargy clause is the one that needs care.** It *removes* a
     * drawback, and the engine never applies that drawback — so the sentence
     * is honoured by accident rather than by rule, and saying so is the
     * difference between a transcription and a coincidence.
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
        effects: [
          { kind: 'buff', bonus: { source: 'Potion of Speed', flat: 2 }, applies: ['ac'], direction: 'add' },
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'dex' } },
          },
        ],
      },
    ],
    unmodelled: [
      'the doubled Speed Haste grants is not applied: a Speed is composed from a halving, which is presence rather than count, and a zero, which is last and wins, and there is no operation that multiplies one',
      'the additional action Haste grants on each of the target\'s turns, and the five actions it may be spent on, are not granted: the action economy counts what a turn holds and nothing an effect writes adds to that count',
      '"without suffering the wave of lethargy that typically occurs when the effect ends": the lethargy is Haste\'s own clause and the engine does not apply it either, because nothing fires when a duration runs out — so this potion is no better than the spell here, and the sentence is honoured by an absence rather than by a rule',
    ],
  },
  {
    /**
     * SRD Potion of Gaseous Form: "Potion, Rare. When you drink this potion,
     * you gain the effect of the _Gaseous Form_ spell for 1 hour (no
     * Concentration required) or until you end the effect as a Bonus Action."
     *
     * Five effects out of one sentence of the spell: the Resistance to three
     * physical damage types, Immunity to the Prone condition, and Advantage
     * on saving throws with each of three abilities. Everything else about
     * being a cloud is the spell's note, and the ones a drinker would notice
     * are repeated here because a conferral hands nothing over from a
     * definition — it carries its own list, so it carries its own gaps too.
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
        ],
      },
    ],
    unmodelled: [
      '"or until you end the effect as a Bonus Action": a conferral is a moment with a lifetime the item states and there is no casting for a dismissal to address, so the hour runs to the end',
      'the movement Gaseous Form prescribes — a Fly Speed of 10 feet and hovering, and no other method — is not applied: the engine tracks one Speed and no movement modes, so the drinker keeps the Speed they had',
      'what Gaseous Form forbids is not forbidden: talking, manipulating objects, letting go of anything held, attacking and casting are an action economy rider and a fact about what is in a creature\'s hands, and the engine has neither',
      'passing through narrow openings, treating liquids as solid surfaces, and occupying another creature\'s space are the DM\'s',
    ],
  },
];

const MAGIC_ITEMS: readonly CatalogueItem[] = [
  ...PLUS_WEAPONS,
  ...PLUS_ARMOR,
  ...PLUS_SHIELDS,
  ...MITHRAL_ARMOR,
  ...NAMED_ITEMS,
  ...POTIONS,
];

function build(): readonly CatalogueItem[] {
  const items = new Map<string, CatalogueItem>();

  for (const item of CLASS_ITEMS) items.set(item.id, item);
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
