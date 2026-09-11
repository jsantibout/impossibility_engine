import { z } from 'zod';

/**
 * Schemas for SRD 5.2.1 content.
 *
 * `packages/srd/raw/` is a third-party transcription (see its PROVENANCE.md),
 * so nothing reaches the engine unvalidated. A malformed save DC or damage die
 * that slipped through would surface much later as a rules bug, which is the
 * hardest kind to trace.
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

/** A named trait, action, bonus action, reaction, or legendary action. */
export const FeatureSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
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
 * becomes `alchemists-supplies` and not `alchemist-s-supplies`. Tools and gear
 * are the first entries with apostrophes in their names — no spell, monster,
 * weapon or armour has one — so this changes no existing id.
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

export const GearSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  weight: GearWeightSchema,
  cost: GearCostSchema,
  /** The prose under the item's own heading, tables stripped out. */
  description: z.string().min(1),
  variants: z.array(GearVariantSchema),
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
