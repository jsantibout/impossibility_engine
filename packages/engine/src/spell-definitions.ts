import type { Ability, ConditionName } from '@ie/shared';
import type { CastingTime } from './spells.js';

/**
 * Spells the engine can actually execute.
 *
 * `@ie/srd` parses every spell's id, level, school, class list and prose. None
 * of that says what a spell *does*: the description is English. So a spell the
 * engine resolves needs a definition here, written from the SRD text and
 * checked against it.
 *
 * The structures are the reusable part — an attack that deals scaling damage,
 * a save that imposes a condition with a repeating escape, a save that deals
 * damage with a stated outcome on a success, and healing that adds the
 * caster's own modifier. A spell that fits one of those shapes is data, not
 * design; a spell that does not is a new shape and belongs in a milestone.
 *
 * **Everything here is data the resolution reads, never a number it hardcodes.**
 * The attack modifier, save DC, damage dice, duration and repeat-save hook are
 * derived from this definition and the caster's own sheet, which is the whole
 * point of moving them out of the scenario fixtures.
 */

/** How far a spell reaches. */
export type SpellRange =
  | { readonly kind: 'self' }
  | { readonly kind: 'touch' }
  | { readonly kind: 'ranged'; readonly feet: number };

/**
 * How a spell's dice grow.
 *
 * Cantrips scale with the caster's level; levelled spells scale with the slot.
 * They are different rules and a spell uses one or the other, so they are
 * separate fields rather than one overloaded number.
 *
 * Damage and healing use the same arithmetic — Cure Wounds reads "increases by
 * 2d8 for each spell slot level above 1" in the same shape a damage spell
 * does — so this is `DiceScaling` rather than anything about damage.
 *
 * The per-slot entry is a whole notation rather than a count, because a
 * spell's upcast die is not always its base die *count*: Inflict Wounds is
 * 2d10 and grows by **1**d10, and reading the increase off the base would
 * double it.
 */
export interface DiceScaling {
  /** The base roll, e.g. `1d10`. */
  readonly dice: string;
  /**
   * SRD Cantrip Upgrade: the character levels at which one more die is added.
   * Fire Bolt's are 5, 11 and 17.
   */
  readonly cantripUpgradesAt?: readonly number[];
  /** Extra dice for each slot level above the spell's own. */
  readonly perSlotLevelAbove?: string;
}

/** What a spell does to a target it reaches. */
export type SpellEffect =
  /** A spell attack roll; damage on a hit. */
  | {
      readonly kind: 'attack';
      readonly attack: 'ranged' | 'melee';
      readonly damage: DiceScaling;
      readonly damageType: string;
    }
  /**
   * A saving throw that deals damage, with what a success buys stated.
   *
   * SRD writes both outcomes and they are not the same spell: Inflict Wounds
   * gives "half as much damage on a successful one", while Sacred Flame gives
   * nothing at all on a success. Defaulting either way silently rewrites one
   * of them.
   */
  | {
      readonly kind: 'save-damage';
      readonly ability: Ability;
      readonly damage: DiceScaling;
      readonly damageType: string;
      readonly onSuccess: 'half' | 'none';
    }
  /**
   * Hit points restored, with the caster's spellcasting modifier where the
   * spell adds it.
   *
   * "2d8 plus your spellcasting ability modifier" is the common shape, and the
   * modifier is *not* universal — Prayer of Healing and Mass Cure Wounds do
   * not add it — so whether it applies is stated rather than assumed.
   */
  | {
      readonly kind: 'heal';
      readonly healing: DiceScaling;
      readonly addSpellcastingModifier: boolean;
    }
  /** A saving throw; a condition on a failure. */
  | {
      readonly kind: 'save';
      readonly ability: Ability;
      readonly condition: ConditionName;
      /**
       * A saving throw the condition repeats at a turn boundary, if it does.
       * Feeds straight into the turn-hook machinery.
       */
      readonly repeats?: {
        readonly at: 'start-of-turn' | 'end-of-turn';
        readonly onSuccess: 'end-on-target' | 'end-casting';
      };
    };

/**
 * An area a spell fills, and where it starts.
 *
 * The *shape and its dimensions* belong to the spell — Fireball is always a
 * 20-foot-radius Sphere — while *where it goes* is the caster's decision every
 * time, so the point and the direction are supplied at the cast. Keeping those
 * apart is the same split as everywhere else: the rules are data, the
 * judgement is an argument.
 *
 * `origin` says which of the two the point comes from. `self` starts at the
 * caster, and SRD excludes them from a Cone, Cube, Line or Emanation they
 * cast; `point` is "a point you choose within range", which is checked against
 * the spell's range like any other target.
 */
export type SpellArea =
  | { readonly kind: 'sphere'; readonly radius: number; readonly origin: 'point' }
  | {
      readonly kind: 'cylinder';
      readonly radius: number;
      readonly height: number;
      readonly origin: 'point';
    }
  /** SRD: a Cone's width at any point equals that point's distance from the origin. */
  | { readonly kind: 'cone'; readonly length: number; readonly origin: 'self' | 'point' }
  | { readonly kind: 'cube'; readonly size: number; readonly origin: 'self' | 'point' }
  | {
      readonly kind: 'line';
      readonly length: number;
      readonly width: number;
      readonly origin: 'self';
    }
  | { readonly kind: 'emanation'; readonly distance: number; readonly origin: 'self' };

/** Shapes that need to be pointed somewhere as well as placed. */
export const DIRECTIONAL_AREAS: ReadonlySet<SpellArea['kind']> = new Set([
  'cone',
  'cube',
  'line',
]);

/** Who a spell may be aimed at, and how many. */
export interface TargetRule {
  readonly count: number;
  /** SRD upcasting: "one additional Humanoid for each spell slot level above 2." */
  readonly extraPerSlotLevelAbove?: number;
  /**
   * A creature type the target must be, when the spell says so.
   *
   * Checked against the target's own declared type. A creature whose type
   * nobody has stated is not waved through: the cast comes back asking for it,
   * because a silent pass would be the engine claiming to have checked
   * something it could not see.
   */
  readonly mustBeType?: string;
  /** Whether the caster may pick themselves. */
  readonly self?: boolean;
}

export interface SpellDefinition {
  /** The SRD slug, so a definition and its parsed record are the same spell. */
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly castingTime: CastingTime;
  readonly concentration: boolean;
  readonly range: SpellRange;
  readonly targets: TargetRule;
  /**
   * The area it fills, for a spell that picks its own targets.
   *
   * A spell has an area *or* a target list, never both: "each creature in a
   * 20-foot-radius Sphere" is not a list of ids the caller chose, and letting
   * a caller pass ids alongside an area would let them pick who the Fireball
   * catches. `targets.count` is ignored when this is set.
   */
  readonly area?: SpellArea;
  readonly effects: readonly SpellEffect[];
  /**
   * Whether the spell says the caster must *see* the target.
   *
   * Hold Person does — "Choose a Humanoid that you can see within range" — and
   * Fire Bolt does not, which is the difference between needing a fact
   * established and not caring.
   */
  readonly requiresSight?: boolean;
  /** How long it lasts, in seconds. Omitted for an instantaneous spell. */
  readonly durationSeconds?: number;
}

/**
 * SRD Fire Bolt:
 *
 * > _Evocation Cantrip._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Instantaneous.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 1d10 Fire damage."
 * > _Cantrip Upgrade._ "The damage increases by 1d10 when you reach levels 5
 * > (2d10), 11 (3d10), and 17 (4d10)."
 */
export const FIRE_BOLT: SpellDefinition = {
  id: 'fire-bolt',
  name: 'Fire Bolt',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '1d10', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'fire',
    },
  ],
};

/**
 * SRD Hold Person:
 *
 * > _Level 2 Enchantment._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "Choose a Humanoid that you can see within range. The target must succeed
 * > on a Wisdom saving throw or have the Paralyzed condition for the duration.
 * > At the end of each of its turns, the target repeats the save, ending the
 * > spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional Humanoid
 * > for each spell slot level above 2."
 */
export const HOLD_PERSON: SpellDefinition = {
  id: 'hold-person',
  name: 'Hold Person',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Humanoid' },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'paralyzed',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Sacred Flame:
 *
 * > _Evocation Cantrip (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "Flame-like radiance descends on a creature that you can see within range.
 * > The target must succeed on a Dexterity saving throw or take 1d8 Radiant
 * > damage. The target gains no benefit from Half Cover or Three-Quarters
 * > Cover for this save."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * A success takes *no* damage: the text says "or take", not "half as much".
 *
 * The cover clause is **not** modelled, and no field records it. Cover is not
 * applied to any spell saving throw yet — declared cover reaches Armour Class
 * and nothing else — so a field saying this spell ignores it would describe an
 * exception to a rule the engine does not have. When Dexterity saves start
 * reading cover, this spell is the first thing that needs a field.
 */
export const SACRED_FLAME: SpellDefinition = {
  id: 'sacred-flame',
  name: 'Sacred Flame',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '1d8', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'radiant',
      onSuccess: 'none',
    },
  ],
};

/**
 * SRD Inflict Wounds:
 *
 * > _Level 1 Necromancy (Cleric)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "A creature you touch makes a Constitution saving throw, taking 2d10
 * > Necrotic damage on a failed save or half as much damage on a successful
 * > one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 1."
 *
 * Note the asymmetry the scaling field exists for: the base is **2**d10 and
 * the increase is **1**d10.
 */
export const INFLICT_WOUNDS: SpellDefinition = {
  id: 'inflict-wounds',
  name: 'Inflict Wounds',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Cure Wounds:
 *
 * > _Level 1 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "A creature you touch regains a number of Hit Points equal to 2d8 plus
 * > your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 2d8 for each
 * > spell slot level above 1."
 *
 * "A creature you touch" includes yourself, so the caster is a legal target.
 */
export const CURE_WOUNDS: SpellDefinition = {
  id: 'cure-wounds',
  name: 'Cure Wounds',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d8', perSlotLevelAbove: '2d8' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Healing Word:
 *
 * > _Level 1 Abjuration (Bard, Cleric, Druid)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A creature of your choice that you can see within range regains Hit
 * > Points equal to 2d4 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 2d4 for each
 * > spell slot level above 1."
 *
 * The Bonus Action is why this sits alongside Cure Wounds: the same effect at
 * a different cost, and the action economy has to charge the right one.
 */
export const HEALING_WORD: SpellDefinition = {
  id: 'healing-word',
  name: 'Healing Word',
  level: 1,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d4', perSlotLevelAbove: '2d4' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Burning Hands:
 *
 * > _Level 1 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "A thin sheet of flames shoots forth from you. Each creature in a 15-foot
 * > Cone makes a Dexterity saving throw, taking 3d6 Fire damage on a failed
 * > save or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 *
 * Range: Self, so the Cone starts at the caster and — being a Cone — does not
 * include them.
 */
export const BURNING_HANDS: SpellDefinition = {
  id: 'burning-hands',
  name: 'Burning Hands',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 15, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Thunderwave:
 *
 * > _Level 1 Evocation (Bard, Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Instantaneous.
 * > "Each creature in a 15-foot Cube originating from you makes a Constitution
 * > saving throw. On a failed save, a creature takes 2d8 Thunder damage and is
 * > pushed 10 feet away from you. On a successful save, a creature takes half
 * > as much damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 *
 * The **push is not modelled**: forced movement out of an area is its own
 * mechanic, `moveCreature` spends movement a shove does not, and a half-done
 * version that moved nobody would read as if it had. The damage is exact and
 * the push is a gap, which is the honest pair.
 */
export const THUNDERWAVE: SpellDefinition = {
  id: 'thunderwave',
  name: 'Thunderwave',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cube', size: 15, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'thunder',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Lightning Bolt:
 *
 * > _Level 3 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "A stroke of lightning forming a 100-foot-long, 5-foot-wide Line blasts
 * > out from you in a direction you choose. Each creature in the Line makes a
 * > Dexterity saving throw, taking 8d6 Lightning damage on a failed save or
 * > half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 */
export const LIGHTNING_BOLT: SpellDefinition = {
  id: 'lightning-bolt',
  name: 'Lightning Bolt',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'line', length: 100, width: 5, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '8d6', perSlotLevelAbove: '1d6' },
      damageType: 'lightning',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Fireball:
 *
 * > _Level 3 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "A bright streak flashes from you to a point you choose within range and
 * > then blossoms with a low roar into a fiery explosion. Each creature in a
 * > 20-foot-radius Sphere centered on that point makes a Dexterity saving
 * > throw, taking 8d6 Fire damage on a failed save or half as much damage on a
 * > successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 *
 * A Sphere includes its point of origin, so a caster who drops one at their
 * own feet is in it. That is the rule, and it is not softened.
 */
export const FIREBALL: SpellDefinition = {
  id: 'fireball',
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '8d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
};

export const SPELL_DEFINITIONS: readonly SpellDefinition[] = [
  BURNING_HANDS,
  CURE_WOUNDS,
  FIREBALL,
  FIRE_BOLT,
  HEALING_WORD,
  HOLD_PERSON,
  INFLICT_WOUNDS,
  LIGHTNING_BOLT,
  SACRED_FLAME,
  THUNDERWAVE,
];

export const definitionFor = (spellId: string): SpellDefinition | null =>
  SPELL_DEFINITIONS.find((spell) => spell.id === spellId) ?? null;

/**
 * The dice a spell rolls, at this caster level and this slot level.
 *
 * A cantrip reads the caster's level and ignores the slot, because it has
 * none; a levelled spell reads the slot and ignores the level. Conflating the
 * two is how a level 3 Wizard ends up throwing a level 5 Fire Bolt.
 *
 * Damage and healing both come through here: the arithmetic is the same, and
 * the SRD writes both upcasts in the same sentence shape.
 */
export function scaledDiceFor(
  scaling: DiceScaling,
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): string {
  const [count, faces] = scaling.dice.split('d');
  const base = Number(count ?? '1');
  const sides = faces ?? '6';

  if (spellLevel === 0) {
    const upgrades = (scaling.cantripUpgradesAt ?? []).filter((at) => casterLevel >= at).length;
    return `${base + upgrades}d${sides}`;
  }

  if (scaling.perSlotLevelAbove === undefined) return scaling.dice;
  const [extraCount] = scaling.perSlotLevelAbove.split('d');
  const above = Math.max(0, slotLevel - spellLevel);
  return `${base + Number(extraCount ?? '0') * above}d${sides}`;
}

/** How many targets a casting may take, given the slot it was cast with. */
export function targetCountFor(rule: TargetRule, spellLevel: number, slotLevel: number): number {
  const above = Math.max(0, slotLevel - spellLevel);
  return rule.count + (rule.extraPerSlotLevelAbove ?? 0) * above;
}
