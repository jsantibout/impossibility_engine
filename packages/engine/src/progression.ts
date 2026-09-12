import {
  err,
  ok,
  type Ability,
  type ConditionName,
  type Result,
  type Skill,
} from '@ie/shared';
import type { ArmorTraining } from './character.js';
import type { D20TestKind } from './checks.js';
import type { ReactionReach } from './reactions.js';
import type { Recovery } from './resources.js';
import type { ActivationEnd, StandingGrant, StandingRequirement } from './standing.js';

/**
 * Class progression: what a class gives you, and when.
 *
 * Three jobs live near each other in D&D and are kept apart here, because
 * conflating them is how a character sheet ends up claiming abilities that
 * nothing honours:
 *
 * | | |
 * |---|---|
 * | **Progression** (this file) | What a level grants. Pure data and lookups; knows nothing about any character |
 * | **Creation** (`creation.ts`) | Turning choices into a character, validated |
 * | **Execution** (everywhere else) | Actually doing what a feature does |
 *
 * A feature therefore says which of those last two owns it. `engine` means the
 * engine applies its mechanical effect; `manual` means the feature is recorded
 * and the DM applies it, and the note says exactly what is missing. There is no
 * third state where the engine half-does something.
 *
 * The tables here are transcribed from the SRD by hand rather than parsed,
 * because `classes.md` has no parser yet. Transcription is a place typos hide,
 * so the tests assert relationships and not just presence — a Proficiency
 * Bonus that disagrees with the formula fails loudly.
 */

export const MAX_LEVEL = 20;

/** SRD Character Advancement: experience points needed for each level. */
export const XP_THRESHOLDS: readonly number[] = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000, 100_000, 120_000,
  140_000, 165_000, 195_000, 225_000, 265_000, 305_000, 355_000,
];

export function levelForXp(xp: number): number {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new Error(`experience is a non-negative whole number of points, got ${xp}`);
  }
  let level = 1;
  for (let index = 0; index < XP_THRESHOLDS.length; index += 1) {
    if (xp >= (XP_THRESHOLDS[index] ?? Infinity)) level = index + 1;
  }
  return level;
}

/** What a feature asks the player to decide, when it asks anything. */
export type FeatureChoice =
  | { readonly kind: 'skill'; readonly choose: number; readonly from?: readonly Skill[] }
  | {
      readonly kind: 'spell';
      readonly choose: number;
      readonly school?: string;
      readonly maxLevel?: number;
    }
  /**
   * One of a named set the feature itself lists.
   *
   * SRD Divine Order offers Protector or Thaumaturge; Fighting Style, Manoeuvres
   * and Metamagic are all the same shape. Modelling it as a feat was wrong in
   * a way that showed immediately: there is no Protector feat, so the feat
   * category check refused a legal character.
   */
  | { readonly kind: 'option'; readonly choose: number; readonly from: readonly string[] }
  | { readonly kind: 'subclass'; readonly choose: 1 }
  | { readonly kind: 'feat'; readonly choose: number; readonly category?: string };

export interface FeatureDefinition {
  /** Namespaced and stable: `wizard:arcane-recovery`. */
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /**
   * `engine` — the engine applies the mechanical effect.
   * `manual` — recorded only; `note` says what a DM still has to do.
   */
  readonly automation: 'engine' | 'manual';
  readonly note: string;
  /** What the player must decide when they gain it. */
  readonly choice?: FeatureChoice;
  /** Set on the feature that opens a subclass, so creation knows to ask. */
  readonly grantsSubclass?: boolean;
  /**
   * A feat this feature grants outright, rather than offering a choice of.
   *
   * A background's Origin feat is named by the background — Sage gives Magic
   * Initiate (Wizard) and nothing else — but the feat's own choices are still
   * the player's. `spellList` pins the half the background already decided.
   */
  readonly grantsFeat?: { readonly featId: string; readonly spellList?: string };
  /**
   * What the engine does with the choice this feature asked for.
   *
   * Creation used to find these two features by **id** — `wizard:scholar` for
   * Expertise, `evoker:evocation-savant` for free spells — which worked for
   * exactly one class and would have needed a new string match for every class
   * after it. A feature says what kind of thing it grants, and creation looks
   * for the kind.
   */
  readonly grants?: FeatureGrant;
}

/**
 * Hit points a feature gives its holder, as the class text writes the sum.
 *
 * Three features say it — Second Wind, Wholeness of Body and Uncanny
 * Metabolism — and between them they name a printed die and a class-table
 * column, a class level and an ability modifier, and one floor.
 */
export interface HealGrant {
  /** SRD Second Wind: a printed "1d10". */
  readonly dice?: string;
  /** SRD Wholeness of Body: "your Martial Arts die" — a class-table column. */
  readonly diceByLevel?: readonly string[];
  /** SRD: "plus your Fighter level" or "plus your Wisdom modifier". */
  readonly plus: 'class-level' | Ability;
  /** SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". */
  readonly minimum?: number;
}

/**
 * The mechanical shapes a feature's choice can take.
 *
 * Deliberately few. A feature whose effect does not fit one of these is
 * `automation: 'manual'` with a note saying what a DM still has to do, which
 * is the honest answer far more often than a new grant kind would be.
 */
export type FeatureGrant =
  /**
   * SRD Expertise: "Choose one of the following skills **in which you have
   * proficiency**", and double the proficiency bonus on it. Wizard's Scholar
   * and Rogue's Expertise are the same feature under two names.
   */
  | { readonly kind: 'expertise' }
  /**
   * Spells the feature adds to what the character can cast, outside the
   * counts the class table prints.
   *
   * Two shapes, and the difference is who decides. The Evoker *chooses* two
   * Evocations and writes them in the book; the Life Domain is *given* Aid,
   * Bless, Cure Wounds and Lesser Restoration and always has them prepared.
   * A fixed grant asks the player nothing, so it carries no `choice` — and
   * modelling it as a choice with one legal answer would demand the player
   * type it back.
   */
  | { readonly kind: 'spells'; readonly fixed?: readonly string[] }
  /**
   * SRD Unarmored Defense and Draconic Resilience: an alternative base Armour
   * Class while unarmoured.
   *
   * A grant rather than a note, because three features want it with three
   * different abilities and two different rules about Shields — which is what
   * makes it a shape rather than one class's quirk. It asks the player
   * nothing, so it carries no `choice`.
   */
  /**
   * A benefit that holds for as long as its rule does — see `standing.ts`.
   *
   * Two shapes in one kind, because SRD writes them as one thing: a feature
   * that puts a benefit into the character's aura, and a feature that only
   * changes how big the aura is. Aura Expansion says nothing but "Your Aura of
   * Protection is now a 30-foot Emanation", and Aura of Courage says nothing
   * about distance at all — it borrows the aura it is spoken of as being
   * inside. Resolving the radius once, at creation, is what keeps the three
   * Paladin auras from disagreeing about their own size.
   */
  | {
      readonly kind: 'standing';
      readonly reach: 'self' | 'aura';
      /**
       * What it does. Empty for a feature that only resizes the aura.
       *
       * A list because SRD writes some of these as one sentence covering two
       * things: Mindless Rage is "Immunity to the Charmed and Frightened
       * conditions", which is two condition immunities and one feature.
       */
      readonly effects?: readonly StandingGrant[];
      /**
       * What the feature's own text says must hold for it to apply.
       *
       * Declared per feature rather than assumed: Danger Sense and the
       * Paladin auras both stop while Incapacitated, and Elemental Affinity
       * says nothing of the kind.
       */
      readonly requires?: readonly StandingRequirement[];
      /** The damage types come from the choice this feature asked for. */
      readonly damageTypesFromChoice?: boolean;
      /** SRD Aura Expansion: this feature makes the aura this many feet. */
      readonly auraFeet?: number;
      /**
       * How many dice an `attack-damage` grant rolls, by class level.
       *
       * SRD Sneak Attack is a column of the Rogue table — 1d6 at level 1 and
       * 10d6 at 19 — so the feature cannot name a number any more than Rage
       * Damage can. The die size stays on the grant; only the count is read at
       * the class's own level, exactly as `flatByLevel` and the pool sizes are.
       */
      readonly diceCountByLevel?: readonly number[];
      /**
       * The option this effect belongs to, for a feature that offers several.
       *
       * SRD writes "You gain one of the following options of your choice" on
       * Hunter's Prey, Elemental Fury and Blessed Strikes, and only one of the
       * options is this grant. A feature whose chosen option is the other one
       * grants nothing — which is different from granting something inert.
       */
      readonly onlyIfChoice?: string;
    }
  /**
   * A feature the character switches on — see `ActivatedFeature` in
   * `standing.ts`. What it does while it runs is `whileActive`, which becomes
   * ordinary standing effects requiring the feature to be active.
   */
  | {
      readonly kind: 'activated';
      readonly action: 'action' | 'bonus-action' | 'none';
      /** The pool key, or null when it costs no uses. */
      readonly pool: string | null;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      readonly poolLabel?: string;
      readonly recovers?: Recovery;
      /** SRD Rage: "You regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      readonly lasts: 'end-of-next-turn';
      readonly capSeconds?: number;
      readonly endsOn?: readonly ActivationEnd[];
      readonly forbidsCasting?: boolean;
      readonly whileActive?: readonly StandingGrant[];
      /**
       * The flat amount a `whileActive` damage grant adds, by class level.
       *
       * SRD Rage Damage is +2 at level 1 and rises twice, so the feature
       * cannot name a number: the number is a column of the class table, read
       * at that class's own level exactly as the pool's size is.
       */
      readonly flatByLevel?: readonly number[];
    }
  /**
   * SRD Extra Attack: "You can attack twice instead of once whenever you take
   * the Attack action."
   *
   * The *total* the Attack action holds, not the increment, because the
   * Fighter's later features restate the total — "three attacks", "four" — and
   * multiclassing takes the highest rather than adding them up.
   */
  | { readonly kind: 'extra-attack'; readonly attacks: number }
  /**
   * SRD Improved Critical: "can score a Critical Hit on a roll of 19 or 20".
   *
   * The *threshold* rather than the width, because the Champion's later
   * feature restates it — "on a roll of 18-20" — rather than widening it
   * again, exactly as Extra Attack restates a total.
   */
  | { readonly kind: 'critical-range'; readonly on: number }
  /**
   * More conditions a healing pool can lift.
   *
   * SRD Restoring Touch: "When you use Lay On Hands on a creature, you can
   * also remove one or more of the following conditions... You must expend 5
   * Hit Points from the healing pool of Lay On Hands for each of these
   * conditions you remove." It widens a feature it does not own, which is the
   * shape Improved Critical already has — a second feature restating the
   * first rather than a second mechanism. What it restates is a list instead
   * of a number, so the lists are unioned where the thresholds were minimised.
   */
  | {
      readonly kind: 'lifts-conditions';
      readonly pool: string;
      readonly conditions: readonly ConditionName[];
    }
  /**
   * SRD Slippery Mind: "You gain proficiency in Wisdom and Charisma saving
   * throws"; Disciplined Survivor: "proficiency in all saving throws".
   *
   * A list rather than a count, and `all` spelled out rather than the six
   * written by hand, because that is how the two features read.
   */
  | { readonly kind: 'save-proficiency'; readonly abilities: readonly Ability[] | 'all' }
  /**
   * A named resource the feature *is*, rather than one it spends.
   *
   * Nine features were marked as executed on the strength of a note saying
   * "declared as a pool", and no pool was ever declared: Bardic Inspiration,
   * both Channel Divinities, Wild Shape, Second Wind, Action Surge, Monk's
   * Focus, Lay On Hands and Sorcery Points. The `activated` grant beside this
   * one already declares a pool, but only for a feature that is switched *on*
   * and grants standing effects while it runs, which none of these is.
   *
   * The SRD sizes a pool three ways and each is here because a feature uses
   * it: a column of the class table (six of the nine), an ability modifier
   * with a floor (Bardic Inspiration: "equal to your Charisma modifier
   * (minimum of once)"), and a multiple of the class level (Lay On Hands:
   * "five times your Paladin level").
   */
  | {
      readonly kind: 'pool';
      readonly key: string;
      readonly label?: string;
      /** Uses by class level, straight off the class table. */
      readonly usesByLevel?: readonly number[];
      /** SRD Bardic Inspiration: "equal to your Charisma modifier". */
      readonly fromAbilityModifier?: Ability;
      /** The floor that modifier cannot go below: "(minimum of once)". */
      readonly minimum?: number;
      /** SRD Lay On Hands: "five times your Paladin level". */
      readonly perClassLevel?: number;
      readonly recovers: Recovery;
      /** SRD: "you regain one expended use when you finish a Short Rest." */
      readonly regainsOnShortRest?: number;
      /**
       * What one use buys, where what it buys is hit points for the holder.
       *
       * Second Wind and Wholeness of Body, which are one sentence apart —
       * "regain Hit Points equal to 1d10 plus your Fighter level" and "roll
       * your Martial Arts die... plus your Wisdom modifier (minimum of 1 Hit
       * Point regained)". Both pools were declared and sized correctly and
       * neither gave back a hit point, because nothing joined a pool to
       * `healCreature`.
       *
       * It hangs off the pool grant rather than standing beside it, because a
       * feature that heals from a pool is not two features: the sizing, the
       * recovery and the Short Rest clause all belong to the pool already, and
       * restating them would be a second place to get the Fighter's table
       * wrong.
       */
      readonly heals?: HealGrant & { readonly action: 'action' | 'bonus-action' };
      /**
       * A pool measured in **hit points**, and what touching somebody spends
       * them on.
       *
       * SRD Lay On Hands, the only pool in the class tables counted in hit
       * points rather than in uses — which the pool system carries without
       * caring, and the spending is the half that had never been wired. The
       * conditions it lifts are a list because a later feature lengthens it;
       * the cost is a number because the SRD prints one and then repeats it.
       */
      readonly touchHeals?: {
        readonly action: 'action' | 'bonus-action';
        /** SRD: "expend 5 Hit Points ... to remove the Poisoned condition". */
        readonly lifts: readonly ConditionName[];
        readonly costPerCondition: number;
      };
    }
  /**
   * A feature that gives a *different* pool's uses back — see
   * `RecoveryFeature` in `standing.ts`.
   *
   * Sorcerous Restoration and Magical Cunning, which are the same sentence
   * with every number changed. The grant declares the pool holding the
   * feature's own once-per-Long-Rest limit, because that limit *is* a pool of
   * one and the engine already has pools.
   */
  | {
      readonly kind: 'recovery';
      /** The key of the pool holding this feature's own single daily use. */
      readonly pool: string;
      readonly poolLabel?: string;
      /**
       * The pool it refills.
       *
       * Pact Magic's key carries its slot level, which moves as the Warlock
       * levels — so the feature cannot name it and creation resolves it. The
       * two members are the two features, not a space of possibilities.
       */
      readonly restores:
        | { readonly kind: 'pool'; readonly key: string }
        | { readonly kind: 'pact-slots' };
      readonly upTo: 'half-class-level' | 'half-pool-maximum' | 'all';
      readonly moment: 'short-rest' | 'declared' | 'initiative';
      /**
       * SRD Uncanny Metabolism: "When you do so, roll your Martial Arts die,
       * and regain a number of Hit Points equal to your Monk level plus the
       * number rolled." The healing rides on the recovery and has no cost of
       * its own, which is why it is a field here and not a second feature.
       */
      readonly heals?: HealGrant;
    }
  | {
      readonly kind: 'unarmored-defense';
      readonly ability: Ability;
      /** SRD Barbarian: "You can use a Shield and still gain this benefit." */
      readonly shieldAllowed: boolean;
    }
  /**
   * A Reaction the feature takes at one of the engine's named windows — see
   * `ReactionFeature` in `reactions.ts`.
   *
   * Eight features across five classes and three subclasses write this, which
   * is what makes it a shape rather than one class's quirk. Three details are
   * declared rather than assumed, because getting any of them wrong makes a
   * different set of features wrong:
   *
   * - **`costsReaction` is per feature.** Uncanny Dodge, Deflect Attacks,
   *   Cutting Words and Retaliation spend one; Indomitable, Dark One's Own
   *   Luck and Peerless Skill spend none at all. The window and the
   *   action-economy cost are two facts and the SRD sets them separately,
   *   which is the commonest mistake about this corner of the rules.
   * - **The window is derived from what the effect acts on**, not declared
   *   beside it. A reduction acts on a damage roll, an intervention or a
   *   reroll on a D20 Test, a melee attack on damage already taken. A field
   *   that can disagree with the effect is a field that eventually will.
   * - **`does` is a list.** Cutting Words answers "a damage roll **or** a
   *   success on an ability check or attack roll" — one feature, one
   *   Reaction, two windows — so it declares two effects and creation files
   *   it under both.
   */
  | {
      readonly kind: 'reaction';
      readonly costsReaction: boolean;
      readonly reach: ReactionReach;
      readonly requiresSight?: true;
      readonly does: readonly ReactionGrantEffect[];
      /**
       * The pool a use comes out of, or absent where the feature is free.
       *
       * Naming a key another feature declares is how Cutting Words spends
       * Bardic Inspiration; `declares` alongside it is how Indomitable gets a
       * pool of its own.
       */
      readonly pool?: string;
      readonly poolLabel?: string;
      /** Set when *this* feature is the one that declares the pool. */
      readonly declares?: PoolSizing & { readonly recovers: Recovery };
    }
  /**
   * SRD Deflect Energy: "You can now use your **Deflect Attacks feature**
   * against attacks that deal any damage type, not just Bludgeoning, Piercing,
   * or Slashing."
   *
   * A second feature restating the first rather than a second mechanism — the
   * move Improved Critical already makes on a threshold and Restoring Touch on
   * a list. Granting a second Reaction instead would give a Monk 13 two offers
   * against one blow and let them deflect twice.
   */
  | {
      readonly kind: 'widens-reaction';
      /** The feature whose Reaction this one restates. */
      readonly feature: string;
      /** What it widens to. One member, because the SRD writes one sentence. */
      readonly damageTypes: 'any';
    };

/**
 * How the SRD sizes a pool, in the three ways it does.
 *
 * Named rather than restated because two grants need the same three, and the
 * one function that reads them — `poolSizeOf` — must read them identically.
 */
export interface PoolSizing {
  /** Uses by class level, straight off the class table. */
  readonly usesByLevel?: readonly number[];
  /** SRD Dark One's Own Luck: "equal to your Charisma modifier". */
  readonly fromAbilityModifier?: Ability;
  /** The floor that modifier cannot go below: "(minimum of once)". */
  readonly minimum?: number;
  /** SRD Lay On Hands: "five times your Paladin level". */
  readonly perClassLevel?: number;
}

/**
 * A reaction's effect as a feature *declares* it, before creation resolves the
 * class-table numbers in it.
 *
 * The difference from `ReactionEffect` is one field: a die a class table sizes
 * — the Bardic Inspiration die, the Martial Arts die — cannot be written by
 * the feature, so it names the column and creation reads it at that class's
 * own level. The same move `HealGrant.diceByLevel` already makes.
 */
export type ReactionGrantEffect =
  | {
      readonly kind: 'reduce-damage';
      readonly amount: ReactionGrantAmount;
      readonly damageTypes?: readonly string[];
      readonly fromAttackOnly?: true;
    }
  | {
      readonly kind: 'intervene';
      readonly amount: ReactionGrantAmount;
      readonly direction: 'bonus' | 'penalty';
      readonly tests: readonly D20TestKind[];
      readonly outcome: 'failure' | 'success' | 'either';
      readonly refundedOnFailure?: true;
    }
  | { readonly kind: 'reroll'; readonly bonus?: 'class-level' }
  | { readonly kind: 'melee-attack'; readonly withinFeet: number };

export interface ReactionGrantAmount {
  readonly dice?: string;
  /** A column of the class table: the Bardic Inspiration die, by level. */
  readonly diceByLevel?: readonly string[];
  /** Ability modifiers and the class's own level, in the order SRD prints. */
  readonly plus?: readonly ('class-level' | Ability)[];
  readonly halve?: true;
}

export interface ClassLevelRow {
  readonly level: number;
  readonly proficiencyBonus: number;
  readonly cantripsKnown?: number;
  readonly preparedSpells?: number;
  /** Slots per spell level, lowest first. `[4, 2]` is four level 1 and two level 2. */
  readonly spellSlots?: readonly number[];
}

export interface SkillChoices {
  readonly choose: number;
  /**
   * The list to choose from, or absent for "any skill".
   *
   * SRD gives the Bard "Choose any 3 skills" where every other class names
   * six or so. Absent rather than a copy of the whole skill list, because the
   * two are different rules: a class that names every skill would have to be
   * updated if the game ever added one, and a class that says "any" would not.
   */
  readonly from?: readonly Skill[];
}

/**
 * Anything that grants features by level: a class, or a subclass.
 *
 * Shared so `featuresAt` and `cumulativeFeatures` work on both, rather than a
 * subclass needing its own parallel pair of functions.
 */
export interface FeatureSource {
  readonly id: string;
  readonly name: string;
  readonly features: readonly FeatureDefinition[];
}

/**
 * How a class comes by the spells it can cast.
 *
 * The three shapes the SRD actually uses, and they are not interchangeable —
 * a Wizard's prepared list is drawn from a book they have to fill, a Cleric's
 * from the whole class list every morning, and a Sorcerer never prepares at
 * all. Modelling the first and calling it "spellcasting" is what made
 * `spellbook.ts` Wizard-shaped.
 */
export type SpellcastingStyle =
  /** SRD Wizard: spells are copied into a book, and prepared from the book. */
  | 'spellbook'
  /** SRD Cleric, Druid, Paladin: prepared from the class's whole list. */
  | 'prepared-from-list'
  /** SRD Sorcerer, Bard, Ranger, Warlock: a fixed set known, never prepared. */
  | 'known';

export interface ClassSpellcasting {
  readonly ability: Ability;
  readonly style: SpellcastingStyle;
  /**
   * Which SRD feature this is — and they are two features, not one.
   *
   * "Spellcasting" and "Pact Magic" differ in three ways that all matter:
   * Pact Magic slots come back on a **Short** Rest, they stay **out** of the
   * Multiclass Spellcaster table, and they are therefore a **separate pool**
   * that a multiclassed character holds alongside their ordinary slots. Two
   * slots that come back every hour is a different resource from eight that
   * come back every day, and it is most of what makes a Warlock a Warlock.
   *
   * Naming the feature rather than one of its consequences is what keeps the
   * three from drifting apart. Defaults to Spellcasting.
   */
  readonly feature?: 'spellcasting' | 'pact-magic';
  /**
   * The level at which the class starts casting.
   *
   * Wizards and Clerics cast at 1; Paladins and Rangers at 2; a Fighter or
   * Rogue never does, and has no `spellcasting` block at all.
   */
  readonly startsAtLevel: number;
}

export interface ClassDefinition extends FeatureSource {
  readonly primaryAbility: Ability;
  /** How this class casts, or absent for a class that does not. */
  readonly spellcasting?: ClassSpellcasting;
  readonly hitDie: number;
  readonly saveProficiencies: readonly Ability[];
  readonly skillChoices: SkillChoices;
  readonly weaponProficiencies: readonly string[];
  readonly armorTraining: ArmorTraining;
  /** The level at which a subclass is chosen. */
  readonly subclassLevel: number;
  readonly table: readonly ClassLevelRow[];
  /** Starting equipment packages, A or B. */
  readonly startingEquipment: readonly EquipmentPackage[];
}

export interface SubclassDefinition extends FeatureSource {
  readonly classId: string;
}

/**
 * An item in a starting-equipment package.
 *
 * A **catalogue id**, not a name. The gear table alphabetises by inverting its
 * names — it prints `Lantern, Hooded` where a person says "hooded lantern" —
 * so a package written in display text silently stops containing a lantern the
 * first time anybody looks it up. The id is the parser's slug and does not move.
 */
export interface EquipmentEntry {
  readonly id: string;
  readonly quantity: number;
  /** A note the SRD prints in brackets, such as a book's subject. */
  readonly detail?: string;
}

export interface EquipmentPackage {
  /** `A` or `B`, as the SRD labels them. */
  readonly option: string;
  readonly items: readonly EquipmentEntry[];
  readonly goldPieces: number;
}

export function rowAt(definition: ClassDefinition, level: number): Result<ClassLevelRow> {
  const row = definition.table[level - 1];
  if (row === undefined) {
    return err('bad_level', `${definition.name} has no level ${level}; levels run 1 to ${MAX_LEVEL}`);
  }
  return ok(row);
}

/** Slots by spell level, with the empty levels left out rather than zeroed. */
export function spellSlotTable(slots: readonly number[]): Record<number, number> {
  const table: Record<number, number> = {};
  slots.forEach((count, index) => {
    if (count > 0) table[index + 1] = count;
  });
  return table;
}

export function slotsAt(definition: ClassDefinition, level: number): Record<number, number> {
  return spellSlotTable(definition.table[level - 1]?.spellSlots ?? []);
}

/** Features gained exactly at this level. */
export function featuresAt(source: FeatureSource, level: number): readonly FeatureDefinition[] {
  return source.features.filter((feature) => feature.level === level);
}

/** Everything gained up to and including this level, in the order it arrived. */
export function cumulativeFeatures(
  source: FeatureSource,
  level: number,
): readonly FeatureDefinition[] {
  return source.features.filter((feature) => feature.level <= level);
}
