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
];

const MAGIC_ITEMS: readonly CatalogueItem[] = [
  ...PLUS_WEAPONS,
  ...PLUS_ARMOR,
  ...PLUS_SHIELDS,
  ...MITHRAL_ARMOR,
  ...NAMED_ITEMS,
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
