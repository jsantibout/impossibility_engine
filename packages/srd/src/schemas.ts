import { z } from 'zod';

/**
 * Schemas for SRD 5.2.1 content.
 *
 * `packages/srd/raw/` is a third-party transcription (see its PROVENANCE.md),
 * so nothing reaches the engine unvalidated. A malformed save DC or damage die
 * that slipped through would surface much later as a rules bug, which is the
 * hardest kind to trace.
 *
 * **This module is published on its own, as `@ie/srd/schemas`, and must stay
 * a leaf.** The engine validates a supplied monster against `MonsterSchema`
 * and reads `WEAPON_PROPERTIES`, and it may not buy those through the barrel:
 * `index.ts` re-exports `monster-index.ts` and the rest of the parsed book, so
 * an engine that imported `@ie/srd` held the whole catalogue in every process,
 * given one or not. A shape is not a catalogue, which is the whole of why the
 * subpath is honest — so nothing here may import an index or the generated
 * data. `packages/engine/src/srd-barrel.test.ts` walks this file's imports and
 * holds both halves of that.
 */

export const SPELL_SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;

export const SpellSchoolSchema = z.enum(SPELL_SCHOOLS);
export type SpellSchool = z.infer<typeof SpellSchoolSchema>;

export const SpellComponentsSchema = z.object({
  verbal: z.boolean(),
  somatic: z.boolean(),
  material: z.boolean(),
  /** The parenthesised material list, when the spell has one. */
  materialDescription: z.string().nullable(),
});
export type SpellComponents = z.infer<typeof SpellComponentsSchema>;

export const SpellSchema = z.object({
  /** Slug derived from the name, e.g. `fireball`. Stable across re-ingests. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** 0 for a cantrip. */
  level: z.number().int().min(0).max(9),
  school: SpellSchoolSchema,
  /** Lower-cased class slugs, e.g. `['sorcerer', 'wizard']`. */
  classes: z.array(z.string().regex(/^[a-z-]+$/)),
  castingTime: z.string().min(1),
  /** True when the casting time offers a Ritual option. */
  ritual: z.boolean(),
  range: z.string().min(1),
  components: SpellComponentsSchema,
  duration: z.string().min(1),
  /** True when the duration requires Concentration. */
  concentration: z.boolean(),
  description: z.string().min(1),
  /** Text of the "Using a Higher-Level Spell Slot" clause, when present. */
  higherLevel: z.string().nullable(),
});
export type Spell = z.infer<typeof SpellSchema>;

export const CREATURE_SIZES = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;
export const CreatureSizeSchema = z.enum(CREATURE_SIZES);
export type CreatureSize = z.infer<typeof CreatureSizeSchema>;

/** One ability's score, derived modifier, and saving throw bonus. */
export const AbilityBlockSchema = z.object({
  score: z.number().int().min(1).max(30),
  modifier: z.number().int(),
  save: z.number().int(),
});

export const AbilityBlockMapSchema = z.object({
  str: AbilityBlockSchema,
  dex: AbilityBlockSchema,
  con: AbilityBlockSchema,
  int: AbilityBlockSchema,
  wis: AbilityBlockSchema,
  cha: AbilityBlockSchema,
});

export const SpeedSchema = z.object({
  walk: z.number().int().min(0),
  burrow: z.number().int().min(0).nullable(),
  climb: z.number().int().min(0).nullable(),
  fly: z.number().int().min(0).nullable(),
  swim: z.number().int().min(0).nullable(),
  /** Fly speeds annotated "(hover)". */
  hover: z.boolean(),
});

export const HitPointsSchema = z.object({
  average: z.number().int().min(1),
  /** e.g. `2d6` or `13d8 + 13`. Null when the source gives only a flat value. */
  formula: z.string().nullable(),
});

/**
 * One typed slice of an attack's damage, as a stat block prints it.
 *
 * `5 (1d6 + 2) Piercing damage` is all four fields: the average the book
 * states, the dice, the modifier already folded into the parenthesis, and the
 * type. The average is carried rather than recomputed because it is the
 * book's own arithmetic and therefore the check on the other three — every
 * expression in the SRD bestiary agrees with its dice, so one that does not
 * is a misread line rather than a rounding argument.
 */
export const MonsterDamageSchema = z.object({
  /** `1d6`, or null where the block prints a flat number and no dice. */
  dice: z.string().regex(/^\d+d\d+$/).nullable(),
  /** The modifier inside the parenthesis; 0 where there is none. */
  flat: z.number().int(),
  /** Lower-cased, in the engine's own vocabulary: `piercing`, `necrotic`. */
  type: z.string().min(1),
  /** The average the block prints outside the parenthesis. */
  average: z.number().int().min(0),
});
export type MonsterDamage = z.infer<typeof MonsterDamageSchema>;

/**
 * The numbers a printed attack line states, read out of the book's template.
 *
 * A 2024 stat block does not describe its attacks in free English: it writes
 * `_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage`,
 * the same sentence in four hundred blocks. Everything before the rider is a
 * number, and a number the engine must supply itself rather than ask a caller
 * for — the same argument `adaptMonster` makes about a printed Armour Class.
 *
 * **What is deliberately not read are the two English fields.** `rider` is the
 * clause after the damage — "If the target is a Medium or smaller creature, it
 * has the Prone condition", "_Constitution Saving Throw:_ DC 10" — and
 * `qualification` is a condition on the roll itself. Both are effects, and
 * structuring an effect is a vocabulary rather than a template. Dropping
 * either would quietly make the creature weaker than the book prints it, so
 * both travel with the numbers and the command that rolls the attack reports
 * them — each at the moment it would have mattered.
 */
/**
 * What has to happen before an attack that is not available every round is
 * available again.
 *
 * The book prints it **inside the action's name** — "Whirlwind (Recharge 4–6)",
 * "Rock (Recharge 6)", "(Recharge after a Short or Long Rest)" — and a name is
 * exactly what nothing downstream may branch on. So it is read here, once, and
 * whatever has to tell a Bite from a breath weapon reads a field.
 *
 * `low` is the lowest face of the d6 that brings it back: 4 for "4–6", 6 for
 * "6". Nothing rolls that die yet, and this does not claim anybody does — what
 * it states is the fact that the line is *not* the creature's every-round
 * attack, which is the whole of what a reader needs to leave it out of one.
 */
export const MonsterRechargeSchema = z.union([
  z.object({ kind: z.literal('die'), low: z.number().int().min(1).max(6) }),
  z.object({ kind: z.literal('rest') }),
]);
export type MonsterRecharge = z.infer<typeof MonsterRechargeSchema>;

export const MonsterAttackSchema = z.object({
  kind: z.enum(['melee', 'ranged', 'melee-or-ranged']),
  /** The printed bonus to the attack roll, used whole. */
  modifier: z.number().int(),
  /** Feet of reach, for the melee half. Null for a purely ranged attack. */
  reach: z.number().int().min(0).nullable(),
  /** Normal and long range in feet. Null for a purely melee attack. */
  range: z
    .object({ normal: z.number().int().min(0), long: z.number().int().min(0) })
    .nullable(),
  damage: z.array(MonsterDamageSchema).min(1),
  /**
   * A condition the book puts on the **roll**, kept as printed and evaluated
   * by nobody: "with Advantage if the target is Grappled by the ankheg".
   *
   * Its own field rather than part of `rider` because the two are read at
   * different moments. A rider is what a *hit* does, so it is reported when
   * one lands; this could have changed whether the attack landed at all, and
   * the outcome it matters most to is the miss.
   */
  qualification: z.string().min(1).nullable(),
  /** Everything the line says after the damage, verbatim. Null where it says nothing. */
  rider: z.string().min(1).nullable(),
  /**
   * Present exactly where the line's name prints a recharge — see
   * {@link MonsterRechargeSchema}.
   *
   * On the attack rather than on the line because it is a fact about *this
   * attack's* availability, and the readers that have to leave a breath weapon
   * out of a choice hold an attack rather than the section it came from.
   */
  recharge: MonsterRechargeSchema.optional(),
});
export type MonsterAttack = z.infer<typeof MonsterAttackSchema>;

/**
 * The sequence a Multiattack prints, where the sentence states one.
 *
 * SRD Air Elemental: "The elemental makes two Thunderous Slam attacks." A
 * stat block's Multiattack is not a number of attacks — it is a *named
 * sequence*, and a count carried without its names would let a Ghoul whose
 * book prints two Bites make two Claws instead.
 *
 * Absent for the sentences that say something else: an alternative ("or it
 * makes two Hurl Flame attacks"), a free choice from a menu ("in any
 * combination"), a non-attack use ("and uses Consume Memories") or a count
 * that reads off the creature ("as many Bite attacks as it has heads"). Each
 * of those is a mechanism of its own, and half of one read into this shape
 * would be a rule nobody printed.
 */
export const MonsterMultiattackSchema = z.object({
  entries: z
    .array(
      z.object({
        count: z.number().int().min(1),
        /** The printed name of the action this clause names — `Thunderous Slam`. */
        attack: z.string().min(1),
      }),
    )
    .min(1),
});
export type MonsterMultiattack = z.infer<typeof MonsterMultiattackSchema>;

/**
 * A trait whose sentence the parser recognised as a mechanic the engine has.
 *
 * One member today, and it is named for what it *does* rather than for the
 * trait that prints it: the engine may not branch on a catalogue's names, and
 * a second block printing the same rule under another name would then reach
 * the same mechanic for free. The kinds grow one at a time, each one a
 * sentence somebody read and matched — there is no interpreter here.
 */
export const MonsterTraitSchema = z.object({
  /**
   * SRD Pack Tactics: "has Advantage on an attack roll against a creature if
   * at least one of its allies is within 5 feet of the creature and the ally
   * doesn't have the Incapacitated condition."
   */
  kind: z.enum(['advantage-when-ally-is-within-5-feet-of-the-target']),
});
export type MonsterTrait = z.infer<typeof MonsterTraitSchema>;

/**
 * A named trait, action, bonus action, reaction, or legendary action.
 *
 * The name and the book's sentence are the whole of what this was, and they
 * are still what a line *is*: `attack` and `trait` are what the parser could
 * read out of that sentence, present only where it read something. A line
 * carrying neither is prose, exactly as every line was.
 */
export const FeatureSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
  /** The numbers of a printed attack line, where this line is one. */
  attack: MonsterAttackSchema.optional(),
  /** The mechanic this trait's sentence states, where the parser knows it. */
  trait: MonsterTraitSchema.optional(),
  /** The sequence this line's sentence states, where it states one. */
  multiattack: MonsterMultiattackSchema.optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const MonsterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  size: CreatureSizeSchema,
  /**
   * Further sizes the stat block offers, for the 30-odd entries printed as
   * "Medium or Small". `size` holds the first listed.
   */
  alternateSizes: z.array(CreatureSizeSchema),
  /** e.g. `Fey`, `Humanoid`, `Dragon`. */
  type: z.string().min(1),
  /** The parenthesised tag, e.g. `Goblinoid`. */
  subtype: z.string().nullable(),
  /**
   * Set for entries printed as "Medium Swarm of Tiny Undead": `size` is the
   * swarm's own size, `type` the member type, and this the member size.
   */
  swarmMemberSize: CreatureSizeSchema.nullable(),
  alignment: z.string().min(1),

  ac: z.number().int().min(1),
  initiative: z.number().int(),
  hp: HitPointsSchema,
  speed: SpeedSchema,
  abilities: AbilityBlockMapSchema,

  /** Skill slug to bonus, e.g. `{ stealth: 6 }`. */
  skills: z.record(z.string(), z.number().int()),
  vulnerabilities: z.array(z.string()),
  resistances: z.array(z.string()),
  immunities: z.array(z.string()),
  gear: z.array(z.string()),

  senses: z.array(z.string()),
  passivePerception: z.number().int().min(0),
  languages: z.array(z.string()),

  /** Numeric challenge rating; `1/8` becomes `0.125`. */
  cr: z.number().min(0),
  /** The rating as printed, e.g. `1/8`. */
  crLabel: z.string().min(1),
  xp: z.number().int().min(0),
  proficiencyBonus: z.number().int().min(0),

  traits: z.array(FeatureSchema),
  actions: z.array(FeatureSchema),
  bonusActions: z.array(FeatureSchema),
  reactions: z.array(FeatureSchema),
  legendaryActions: z.array(FeatureSchema),
});
export type Monster = z.infer<typeof MonsterSchema>;

export const CURRENCIES = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

export const CostSchema = z.object({
  amount: z.number().min(0),
  currency: CurrencySchema,
});
export type Cost = z.infer<typeof CostSchema>;

/** Normal and long range in feet, as printed `80/320`. */
export const RangeSchema = z.object({
  normal: z.number().int().min(0),
  long: z.number().int().min(0),
});

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'reach',
  'thrown',
  'two-handed',
  'versatile',
] as const;
export const WeaponPropertySchema = z.enum(WEAPON_PROPERTIES);
export type WeaponProperty = z.infer<typeof WeaponPropertySchema>;

/** Weapon mastery properties, new in the 2024 rules. */
export const WEAPON_MASTERIES = [
  'cleave',
  'graze',
  'nick',
  'push',
  'sap',
  'slow',
  'topple',
  'vex',
] as const;
export const WeaponMasterySchema = z.enum(WEAPON_MASTERIES);
export type WeaponMastery = z.infer<typeof WeaponMasterySchema>;

export const WeaponDamageSchema = z.object({
  /** Dice notation, e.g. `1d8`. Null when the weapon deals a flat amount. */
  dice: z.string().nullable(),
  /** Flat damage — only the Blowgun, which deals exactly 1. */
  fixed: z.number().int().nullable(),
  type: z.string().min(1),
});

export const WeaponSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(['simple', 'martial']),
  kind: z.enum(['melee', 'ranged']),
  damage: WeaponDamageSchema,
  properties: z.array(WeaponPropertySchema),
  /** Damage when wielded two-handed, for Versatile weapons. */
  versatileDamage: z.string().nullable(),
  /** Range for Thrown weapons. */
  thrownRange: RangeSchema.nullable(),
  /** Range for Ammunition weapons. */
  ammunitionRange: RangeSchema.nullable(),
  /** `Bolt`, `Arrow`, `Bullet`, `Needle`. */
  ammunitionType: z.string().nullable(),
  /** Parenthetical caveats, e.g. the Lance's `unless mounted`. */
  propertyNotes: z.string().nullable(),
  mastery: WeaponMasterySchema,
  weightLb: z.number().min(0).nullable(),
  cost: CostSchema,
});
export type Weapon = z.infer<typeof WeaponSchema>;

export const ArmorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(['light', 'medium', 'heavy', 'shield']),
  /** Base AC the armour sets. Null for a Shield, which adds instead. */
  baseAc: z.number().int().min(0).nullable(),
  /** What a Shield adds to AC. Null for body armour. */
  acBonus: z.number().int().nullable(),
  addsDexModifier: z.boolean(),
  /** The `(max 2)` cap on medium armour. */
  maxDexBonus: z.number().int().nullable(),
  /** Minimum Strength score, or null when there is no requirement. */
  strengthRequirement: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  weightLb: z.number().min(0).nullable(),
  cost: CostSchema,
});
export type Armor = z.infer<typeof ArmorSchema>;

/**
 * A problem found while parsing. Collected rather than thrown so one bad entry
 * does not hide the other forty.
 */
export interface ParseProblem {
  /** Source file the entry came from, e.g. `spells.md`. */
  readonly source: string;
  /** Name or heading of the entry, when it got far enough to have one. */
  readonly entry: string;
  readonly message: string;
}

export interface ParseOutput<T> {
  readonly items: readonly T[];
  readonly problems: readonly ParseProblem[];
}

/**
 * Slugify a name into a stable id: `Acid Splash` -> `acid-splash`.
 *
 * An apostrophe is dropped rather than replaced, so `Alchemist's Supplies`
 * becomes `alchemists-supplies` and not `alchemist-s-supplies`.
 *
 * This did move three existing ids, which an earlier note here said it would
 * not: Arcanist's Magic Aura, Dragon's Breath and Hunter's Mark. The generated
 * `spell-index.ts` simply had not been regenerated yet, so the claim looked
 * true. Nothing referenced them, and the three new ids are the ones anybody
 * would guess — but the lesson is that a generated file left stale hides
 * exactly this, so regenerate before asserting what a change does not touch.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A weight the SRD prints in the Adventuring Gear or Tools tables.
 *
 * Three states, not two, which is why this is a union rather than the
 * `weightLb: number | null` that Weapon and Armor use. Those tables print
 * either a number or `—`; the gear table also prints `Varies`, and the two
 * non-numeric cells mean opposite things. A Bell weighs nothing worth
 * tracking; Ammunition's weight is simply stated elsewhere, on the variant.
 * Collapsing both to null would let an encumbrance calculation treat a
 * Musical Instrument as weightless.
 */
export const GearWeightSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lb'), value: z.number().min(0) }),
  /** The table printed `—`. */
  z.object({ kind: z.literal('negligible') }),
  /** The table printed `Varies`; the weight lives on each variant. */
  z.object({ kind: z.literal('varies') }),
]);
export type GearWeight = z.infer<typeof GearWeightSchema>;

/** As `GearWeight`, but the cost column never prints `—`. */
export const GearCostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cost'), value: CostSchema }),
  z.object({ kind: z.literal('varies') }),
]);
export type GearCost = z.infer<typeof GearCostSchema>;

/**
 * One priced form of an entry whose own cost is `Varies` — an Arcane Focus's
 * Rod, a Musical Instrument's lute. Each is bought separately, so each carries
 * its own weight and cost.
 */
export const GearVariantSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type GearVariant = z.infer<typeof GearVariantSchema>;

/**
 * One line of a pack's contents: which catalogue row, and how many.
 *
 * SRD prints these as prose — "10 flasks of Oil, 10 sheets of Parchment" — so
 * the parser resolves each phrase back to the row it names. A phrase that
 * resolves to nothing is a parse problem rather than a silently short pack.
 */
export const PackContentSchema = z.object({
  gearId: z.string().regex(/^[a-z0-9-]+$/),
  /** How the SRD wrote it, kept so a log can quote the book. */
  printed: z.string().min(1),
  quantity: z.number().int().min(1),
});
export type PackContent = z.infer<typeof PackContentSchema>;

export const GearSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
  /** The prose under the item's own heading, tables stripped out. */
  description: z.string().min(1),
  variants: z.array(GearVariantSchema),
  /** What a pack holds. Empty for everything that is not a pack. */
  contents: z.array(PackContentSchema),
});
export type Gear = z.infer<typeof GearSchema>;

/**
 * Gear as the engine sees it: everything but the prose.
 *
 * The engine is pure and ships its data as TypeScript, so the index is kept
 * compact. A description is narration and belongs to the DM layer, which can
 * read the generated JSON.
 */
export type GearIndexEntry = Omit<Gear, 'description'>;

/**
 * A row of the Ammunition table.
 *
 * Kept apart from `GearVariant` because it has columns nothing else has: how
 * many you get for the price, and what you store them in. Folding it into the
 * shared variant shape would put two permanently-null fields on every focus.
 */
export const AmmunitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** How many the listed cost buys. */
  amount: z.number().int().min(1),
  /** The item it is typically stored in. Bought separately. */
  storage: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type Ammunition = z.infer<typeof AmmunitionSchema>;

/** One thing a tool lets you do with the Utilize action, and its DC. */
export const ToolUseSchema = z.object({
  description: z.string().min(1),
  dc: z.number().int().min(0).nullable(),
});
export type ToolUse = z.infer<typeof ToolUseSchema>;

export const ToolSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Artisan's Tools each need a separate proficiency; Other Tools stand alone. */
  category: z.enum(['artisan', 'other']),
  ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']),
  utilize: z.array(ToolUseSchema).min(1),
  /** What the tool can craft. Empty for the five that craft nothing. */
  craft: z.array(z.string()),
  variants: z.array(GearVariantSchema),
  weight: GearWeightSchema,
  cost: GearCostSchema,
});
export type Tool = z.infer<typeof ToolSchema>;

/**
 * The nine categories the SRD files every magic item under, spelled as the
 * Magic Item Categories table spells them. The italic type line under an
 * entry's heading uses the singular — `_Potion, Common_`, `_Ring, Legendary_`
 * — so the parser maps one onto the other rather than storing two spellings.
 */
export const MAGIC_ITEM_CATEGORIES = [
  'Armor',
  'Potions',
  'Rings',
  'Rods',
  'Scrolls',
  'Staffs',
  'Wands',
  'Weapons',
  'Wondrous Items',
] as const;
export const MagicItemCategorySchema = z.enum(MAGIC_ITEM_CATEGORIES);
export type MagicItemCategory = z.infer<typeof MagicItemCategorySchema>;

export const MAGIC_ITEM_RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Very Rare',
  'Legendary',
  'Artifact',
] as const;
export const MagicItemRaritySchema = z.enum(MAGIC_ITEM_RARITIES);
export type MagicItemRarity = z.infer<typeof MagicItemRaritySchema>;

/** One rarity a type line names, with the parenthesis that distinguishes it. */
export const MagicItemRarityOptionSchema = z.object({
  rarity: MagicItemRaritySchema,
  /**
   * What the book prints beside the rarity to say which version it is: `+2`
   * for _Ammunition, +1, +2, or +3_, `Bronze` for the Horn of Valhalla. Null
   * when the entry names a single unqualified rarity.
   */
  qualifier: z.string().min(1).nullable(),
});
export type MagicItemRarityOption = z.infer<typeof MagicItemRarityOptionSchema>;

/**
 * The rarity clause of a type line.
 *
 * Three shapes, and — as with the gear table's `—` versus `Varies` — two of
 * them are opposites that must not collapse into one absence. `_Potion,
 * Common_` names one rarity; `_Armor, +1, +2, or +3_` names three, one per
 * version; `_Scroll, Rarity Varies_` names none, because a Spell Scroll's
 * rarity is read off a table by spell level. Letting "Rarity Varies" fall
 * through to an empty list would make those seven entries indistinguishable
 * from an entry whose rarity the parser simply failed to read.
 */
export const MagicItemRarityLineSchema = z
  .object({
    /** The clause as printed, e.g. `Uncommon (+1), Rare (+2), or Very Rare (+3)`. */
    text: z.string().min(1),
    /** The book printed "Rarity Varies". */
    varies: z.boolean(),
    /** Every rarity named, in print order. Empty only when `varies`. */
    options: z.array(MagicItemRarityOptionSchema),
  })
  .refine((rarity) => rarity.varies === (rarity.options.length === 0), {
    message: 'rarity must either vary or name at least one rarity, never both and never neither',
  });
export type MagicItemRarityLine = z.infer<typeof MagicItemRarityLineSchema>;

/**
 * How many charges an entry says the item holds.
 *
 * Printed either as a number ("This wand has 7 charges") or as a die roll
 * ("The weapon has 1d8 + 1 charges"), never as both, so exactly one field is
 * set. The clause that says how they come back is prose and stays in the
 * description.
 */
export const MagicItemChargesSchema = z
  .object({
    maximum: z.number().int().min(1).nullable(),
    /** Dice notation, e.g. `1d8 + 1`. */
    formula: z.string().min(1).nullable(),
  })
  .refine((charges) => (charges.maximum === null) !== (charges.formula === null), {
    message: 'charges are printed as a number or as dice, never both and never neither',
  });
export type MagicItemCharges = z.infer<typeof MagicItemChargesSchema>;

/**
 * One entry of "Magic Items A–Z", transcribed rather than interpreted.
 *
 * Every field is something the page prints under the entry's heading. What a
 * magic item *is* to the engine — which of these it can execute, and how — is
 * not decided here, and no field anticipates it.
 */
export const MagicItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    category: MagicItemCategorySchema,
    /**
     * The parenthesised restriction on the type line: `Shield`, `Longsword`,
     * `Any Medium or Heavy, Except Hide Armor`. Null when none is printed,
     * which is every entry outside Armor and Weapons.
     */
    subtype: z.string().min(1).nullable(),
    rarity: MagicItemRarityLineSchema,
    requiresAttunement: z.boolean(),
    /**
     * The prerequisite as printed, minus the words "Requires Attunement":
     * `by a Druid`, `by a Spellcaster`, `by a Dwarf or a Creature Attuned to
     * a Belt of Dwarvenkind`. Null when attunement is unconditional.
     */
    attunementPrerequisite: z.string().min(1).nullable(),
    charges: MagicItemChargesSchema.nullable(),
    /** The entry's prose, verbatim, tables included. */
    description: z.string().min(1),
  })
  .refine((item) => item.requiresAttunement || item.attunementPrerequisite === null, {
    message: 'an item that needs no attunement cannot carry an attunement prerequisite',
  });
export type MagicItem = z.infer<typeof MagicItemSchema>;
