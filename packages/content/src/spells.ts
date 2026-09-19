/**
 * The SRD 5.2.1 spells the engine can execute, transcribed as data.
 *
 * Every definition here is a plain object against the vocabulary `@ie/engine`
 * declares (`SpellDefinition` and the closed unions beneath it). None of them
 * is code: the engine dispatches on `effect.kind`, never on a spell's name,
 * and this package reaches the engine only through `createContent`, the same
 * door a homebrew catalogue goes through. The SRD text each definition was
 * transcribed from is quoted above it, because that text is the provenance
 * the conformance tests check against.
 */
import type { ModifierRider, SpellDefinition } from '@ie/engine';

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
 * SRD Greater Invisibility:
 *
 * > _Level 4 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "A creature you touch has the Invisible condition until the spell ends."
 *
 * That sentence is the whole spell, and it offers no saving throw — which is
 * the shape this definition exists to prove. "A creature you touch" includes
 * yourself, and it prints no *Using a Higher-Level Spell Slot* line, so a
 * level 9 slot still reaches one creature.
 */
export const GREATER_INVISIBILITY: SpellDefinition = {
  id: 'greater-invisibility',
  name: 'Greater Invisibility',
  level: 4,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
  durationSeconds: 60,
};

/**
 * SRD Invisibility:
 *
 * > _Level 2 Illusion (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "A creature you touch has the Invisible condition until the spell ends.
 * > The spell ends early immediately after the target makes an attack roll,
 * > deals damage, or casts a spell."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 *
 * Greater Invisibility's sentence plus one more, and that second sentence is
 * the whole of the difference between the two spells — so this one carries an
 * `endsEarly` list and its bigger sibling carries none.
 *
 * **Three causes, one sentence, and the casting ends outright**: the book says
 * "the spell ends early", where Charm Person bounds a condition instead. See
 * {@link CastingEndTrigger} for why that distinction is a field.
 */
export const INVISIBILITY: SpellDefinition = {
  id: 'invisibility',
  name: 'Invisibility',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
  durationSeconds: 3600,
  endsEarly: [
    { on: 'target-attacks', ends: 'casting' },
    { on: 'target-deals-damage', ends: 'casting' },
    { on: 'target-casts', ends: 'casting' },
  ],
  unmodelled: [
    'an attack roll that costs no Attack action — an Opportunity Attack, or any swing outside combat — ends this spell only if it hits: the attack roll itself is recorded on `roll-recorded`, which changes no state by rule, so nothing may hang the ending on it',
  ],
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
 * SRD Acid Arrow:
 *
 * > _Level 2 Evocation (Wizard)._ **Casting Time:** Action. **Range:** 90
 * > feet. **Duration:** Instantaneous.
 * > "A shimmering green arrow streaks toward a target within range and bursts
 * > in a spray of acid. Make a ranged spell attack against the target. On a
 * > hit, the target takes 4d4 Acid damage and 2d4 Acid damage at the end of
 * > its next turn. On a miss, the arrow splashes the target with acid for half
 * > as much of the initial damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage (both initial and later)
 * > increases by 1d4 for each spell slot level above 2."
 *
 * **The miss branch is not modelled and says so.** "Half as much of the
 * initial damage only" on a *miss* is a third outcome the attack shape has no
 * room for — an attack either hits or does nothing — and inventing a
 * half-damage-on-a-miss path for one spell would be a mechanism with one user.
 * So a miss deals nothing here and `unmodelled` names it, which is the honest
 * version of a gap.
 */
export const ACID_ARROW: SpellDefinition = {
  id: 'acid-arrow',
  name: 'Acid Arrow',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '4d4', perSlotLevelAbove: '1d4' },
      damageType: 'acid',
      // "both initial and later" — so the later hit scales too, and by the
      // same 1d4. Its own field, because the other spell with this shape
      // scales the initial damage and not the later one.
      delayed: {
        damage: { dice: '2d4', perSlotLevelAbove: '1d4' },
        damageType: 'acid',
      },
      // "On a miss, the arrow splashes the target with acid for half as much
      // of the initial damage **only**." *Only* is the word that makes this a
      // branch on the host's own damage rather than a rider: the later 2d4 and
      // everything else a hit would carry are the hit's, and a miss owes none
      // of them.
      onMiss: 'half',
    },
  ],
};

/**
 * SRD Shield:
 *
 * > _Level 1 Abjuration (Sorcerer, Wizard)._ **Casting Time:** Reaction, which
 * > you take when you are hit by an attack roll or targeted by the _Magic
 * > Missile_ spell. **Range:** Self. **Duration:** 1 round.
 * > "An imperceptible barrier of magical force protects you. Until the start
 * > of your next turn, you have a +5 bonus to AC, including against the
 * > triggering attack, and you take no damage from _Magic Missile_."
 *
 * **"Including against the triggering attack" is the whole spell.** A Shield
 * that only helped against what came next would be a much weaker one, so the
 * casting re-measures the hit it answered: the attack is still held, the roll
 * that made it is written down, and whether it now falls short is arithmetic
 * rather than anybody's judgement.
 *
 * Two halves of the text are not modelled and say so. Magic Missile is not a
 * trigger the engine can see — the spell has no executable definition, so
 * there is nothing to be targeted by — and the immunity to its damage has
 * nothing to attach to.
 */
/**
 * SRD Counterspell:
 *
 * > _Level 3 Abjuration (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Reaction, which you take when you see a creature within 60 feet of
 * > yourself casting a spell with Verbal, Somatic, or Material components.
 * > **Range:** 60 feet. **Components:** S. **Duration:** Instantaneous.
 * > "You attempt to interrupt a creature in the process of casting a spell.
 * > The creature makes a Constitution saving throw. On a failed save, the
 * > spell dissipates with no effect, and the action, Bonus Action, or Reaction
 * > used to cast it is wasted. If that spell was cast with a spell slot, the
 * > slot isn't expended."
 *
 * **2024 is not 2014 here, and the difference is the whole spell.** There is
 * no check against the countered spell's level, no automatic success below a
 * threshold, and — read the text again — **no "Using a Higher-Level Spell
 * Slot" clause at all**. Upcasting Counterspell buys nothing. Every one of
 * those is a 2014 memory, and a `DiceScaling` or an `onSuccess` written from
 * one would be inventing a rule.
 *
 * The save is made by **the creature being countered**, against the
 * counterspeller's spell save DC, which is why this is an effect aimed at a
 * target rather than a roll the caster makes.
 *
 * The one clause not modelled is the components qualifier, and it is worth
 * saying why rather than quietly checking nothing: **all 339 SRD 5.2.1 spells
 * have at least one of Verbal, Somatic or Material**, so the clause excludes
 * nothing the engine can currently be asked about, and a creature casting by
 * some means the engine has not been told the components of is an unknown
 * rather than a no. `counterspell.test.ts` pins that count, so the day the
 * data stops saying it, something goes red.
 */
export const COUNTERSPELL: SpellDefinition = {
  id: 'counterspell',
  name: 'Counterspell',
  level: 3,
  school: 'abjuration',
  castingTime: 'reaction',
  trigger: 'casting-a-spell',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  requiresSight: true,
  targets: { count: 1 },
  effects: [{ kind: 'interrupt-casting', ability: 'con' }],
  unmodelled: [
    'the trigger reads "casting a spell with Verbal, Somatic, or Material components"; every SRD 5.2.1 spell has one of the three, so the qualifier is not checked and excludes nothing',
  ],
};

export const SHIELD: SpellDefinition = {
  id: 'shield',
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  castingTime: 'reaction',
  trigger: 'hit-by-attack',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Shield', flat: 5 },
      applies: ['ac'],
      direction: 'add',
    },
  ],
  durationUntil: 'start-of-casters-next-turn',
  unmodelled: [
    'being targeted by Magic Missile is also a trigger, and taking no damage from it is also a benefit; neither is modelled, because Magic Missile is not executable here',
  ],
};

/**
 * SRD Shield of Faith:
 *
 * > _Level 1 Abjuration (Cleric, Paladin)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "A shimmering field surrounds a creature of your choice within range,
 * > granting it a +2 bonus to AC for the duration."
 *
 * No Reaction, no trigger, no window — and it needed exactly one of the three
 * things Shield needed: an Armour Class an effect can reach. Two spells
 * wanting the same missing piece and differing in every other way is what
 * makes `applies: ['ac']` a shape rather than a special case for Shield.
 */
export const SHIELD_OF_FAITH: SpellDefinition = {
  id: 'shield-of-faith',
  name: 'Shield of Faith',
  level: 1,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Shield of Faith', flat: 2 },
      applies: ['ac'],
      direction: 'add',
    },
  ],
  durationSeconds: 600,
};

/**
 * SRD Hellish Rebuke:
 *
 * > _Level 1 Evocation (Warlock)._ **Casting Time:** Reaction, which you take
 * > in response to taking damage from a creature that you can see within 60
 * > feet of yourself. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "The creature that damaged you is momentarily surrounded by green flames.
 * > It makes a Dexterity saving throw, taking 2d10 Fire damage on a failed
 * > save or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 1."
 *
 * **The effect is an ordinary shape; the trigger is the whole difficulty.**
 * Once the target is settled this is `save-damage` with `onSuccess: 'half'`,
 * indistinguishable from Inflict Wounds. What it needed was for damage to name
 * the creature that dealt it — `source` has always been prose, and prose
 * cannot be set on fire.
 *
 * **"The creature that damaged you" is not "a creature of your choice".** The
 * target is forced, so aiming it elsewhere is refused rather than quietly
 * redirected — the same rule `eligibleTargets` states for every other spell.
 *
 * Sight and range are the spell's own to check and are checked by the ordinary
 * machinery: `requiresSight` makes an undeclared line of sight a request and a
 * declared *unseen* a refusal, and 60 feet is the range.
 */
export const HELLISH_REBUKE: SpellDefinition = {
  id: 'hellish-rebuke',
  name: 'Hellish Rebuke',
  level: 1,
  school: 'evocation',
  castingTime: 'reaction',
  trigger: 'damaged-by-creature',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'fire',
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
 * SRD Mass Healing Word:
 *
 * > _Level 3 Abjuration (Bard, Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Up to six creatures of your choice that you can see within range regain
 * > Hit Points equal to 2d4 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 1d4 for each
 * > spell slot level above 3."
 *
 * Healing Word for six, and the upcast is the place to be careful: this one
 * grows by **1**d4 where Healing Word grows by 2d4, which is exactly the sort
 * of number that gets copied across from the neighbouring spell.
 */
export const MASS_HEALING_WORD: SpellDefinition = {
  id: 'mass-healing-word',
  name: 'Mass Healing Word',
  level: 3,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 6, self: true },
  requiresSight: true,
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d4', perSlotLevelAbove: '1d4' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Mass Cure Wounds:
 *
 * > _Level 5 Abjuration (Bard, Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A wave of healing energy washes out from a point you can see within
 * > range. Choose up to six creatures in a 30-foot-radius Sphere centered on
 * > that point. Each target regains Hit Points equal to 5d8 plus your
 * > spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 1d8 for each
 * > spell slot level above 5."
 *
 * **A target list bounded by an area**, which is what `targetsWithin` exists
 * for. `area` picks its own targets from geometry — everyone inside it, which
 * is right for Fireball and wrong here, because the caster chooses *up to six*
 * of the creatures in the Sphere and would otherwise heal the enemies standing
 * in it. Choosing is the operative rule and the Sphere bounds what may be
 * chosen, so both halves are real: the point is held to the spell's range, and
 * every name is held to the Sphere.
 */
export const MASS_CURE_WOUNDS: SpellDefinition = {
  id: 'mass-cure-wounds',
  name: 'Mass Cure Wounds',
  level: 5,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 6, self: true },
  targetsWithin: { kind: 'sphere', radius: 30, origin: 'point' },
  effects: [
    {
      kind: 'heal',
      healing: { dice: '5d8', perSlotLevelAbove: '1d8' },
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
  unmodelled: ['a creature that fails is pushed 10 feet away from you'],
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

/**
 * A ranged attack cantrip whose whole text is "hit, take dice".
 *
 * Five of these are the same spell with a different damage type and die, so
 * they are built from one function rather than copied five times — the copy is
 * where a d8 becomes a d10 and no test can see it. Every field still comes
 * from the SRD line quoted at the call site.
 */
function attackCantrip(args: {
  readonly id: string;
  readonly name: string;
  readonly school: string;
  readonly feet: number | 'touch';
  readonly dice: string;
  readonly damageType: string;
  readonly attack?: 'ranged' | 'melee';
  /**
   * Grants the hit imposes, alongside the damage.
   *
   * SRD Ray of Frost writes one sentence — "it takes 1d8 Cold damage, **and**
   * its Speed is reduced by 10 feet" — so the reduction rides the attack that
   * dealt the damage rather than being a second effect that would roll a
   * second attack for the same swing.
   */
  readonly modifiers?: readonly ModifierRider[];
  readonly unmodelled?: readonly string[];
}): SpellDefinition {
  return {
    id: args.id,
    name: args.name,
    level: 0,
    school: args.school,
    castingTime: 'action',
    concentration: false,
    range: args.feet === 'touch' ? { kind: 'touch' } : { kind: 'ranged', feet: args.feet },
    targets: { count: 1 },
    effects: [
      {
        kind: 'attack',
        attack: args.attack ?? 'ranged',
        // SRD Cantrip Upgrade is the same three levels for every cantrip.
        damage: { dice: args.dice, cantripUpgradesAt: [5, 11, 17] },
        damageType: args.damageType,
        ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
      },
    ],
    ...(args.unmodelled === undefined ? {} : { unmodelled: args.unmodelled }),
  };
}

/**
 * SRD Poison Spray:
 *
 * > _Necromancy Cantrip (Druid, Sorcerer, Warlock, Wizard)._ **Range:** 30 feet.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 1d12 Poison damage."
 * > _Cantrip Upgrade._ "...increases by 1d12 when you reach levels 5 (2d12),
 * > 11 (3d12), and 17 (4d12)."
 *
 * The only one of these with nothing left over: its text is the mechanic.
 */
export const POISON_SPRAY = attackCantrip({
  id: 'poison-spray',
  name: 'Poison Spray',
  school: 'necromancy',
  feet: 30,
  dice: '1d12',
  damageType: 'poison',
});

/**
 * SRD Ray of Frost:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Range:** 60 feet.
 * > "On a hit, it takes 1d8 Cold damage, and its Speed is reduced by 10 feet
 * > until the start of your next turn."
 */
export const RAY_OF_FROST = attackCantrip({
  id: 'ray-of-frost',
  name: 'Ray of Frost',
  school: 'evocation',
  feet: 60,
  dice: '1d8',
  damageType: 'cold',
  // "until the start of your next turn", on a cantrip \u2014 so the casting is
  // Instantaneous and cannot own the reduction. `lasts` is the rider's own
  // deadline, and the `grants` timer it schedules is the only thing that could
  // ever take the ten feet back.
  modifiers: [
    { kind: 'speed-change', change: 'add', feet: -10, lasts: 'start-of-casters-next-turn' },
  ],
});

/**
 * SRD Shocking Grasp:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Range:** Touch.
 * > "Make a melee spell attack against the target. On a hit, the target takes
 * > 1d8 Lightning damage, and it can't make Opportunity Attacks until the
 * > start of its next turn."
 */
export const SHOCKING_GRASP = attackCantrip({
  id: 'shocking-grasp',
  name: 'Shocking Grasp',
  school: 'evocation',
  feet: 'touch',
  attack: 'melee',
  dice: '1d8',
  damageType: 'lightning',
  unmodelled: ['the target cannot make Opportunity Attacks until the start of its next turn'],
});

/**
 * SRD Chill Touch:
 *
 * > _Necromancy Cantrip (Sorcerer, Warlock, Wizard)._ **Range:** Touch.
 * > "Make a melee spell attack against a target within reach. On a hit, the
 * > target takes 1d10 Necrotic damage, and it can't regain Hit Points until
 * > the end of your next turn."
 */
export const CHILL_TOUCH = attackCantrip({
  id: 'chill-touch',
  name: 'Chill Touch',
  school: 'necromancy',
  feet: 'touch',
  attack: 'melee',
  dice: '1d10',
  damageType: 'necrotic',
  unmodelled: ['the target cannot regain Hit Points until the end of your next turn'],
});

/**
 * SRD Starry Wisp:
 *
 * > _Evocation Cantrip (Bard, Druid)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** Instantaneous.
 * > "You launch a mote of light at one creature or object within range. Make a
 * > ranged spell attack against the target. On a hit, the target takes 1d8
 * > Radiant damage, and until the end of your next turn, it emits Dim Light in
 * > a 10-foot radius and can't benefit from the Invisible condition."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * The rider is not a condition: it is light, and the *loss* of a benefit the
 * target would otherwise have. `attack.condition` names a `ConditionName`, and
 * neither half of this is one.
 */
export const STARRY_WISP = attackCantrip({
  id: 'starry-wisp',
  name: 'Starry Wisp',
  school: 'evocation',
  feet: 60,
  dice: '1d8',
  damageType: 'radiant',
  unmodelled: [
    'until the end of your next turn the target emits Dim Light in a 10-foot radius and cannot benefit from the Invisible condition',
  ],
});

/**
 * SRD Eldritch Blast:
 *
 * > _Evocation Cantrip (Warlock)._ **Range:** 120 feet.
 * > "Make a ranged spell attack against one creature or object in range. On a
 * > hit, the target takes 1d10 Force damage."
 * > _Cantrip Upgrade._ "The spell creates two beams at level 5, three beams at
 * > level 11, and four beams at level 17."
 *
 * **Not the usual cantrip upgrade.** Every other attack cantrip adds dice to
 * one attack; this one adds *separate attack rolls*, each of which hits or
 * misses on its own and may be aimed at a different creature. So its scaling
 * is deliberately left flat rather than dressed up as extra dice, which would
 * make it hit-or-miss all at once and be worth a different amount.
 */
export const ELDRITCH_BLAST: SpellDefinition = {
  id: 'eldritch-blast',
  name: 'Eldritch Blast',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    { kind: 'attack', attack: 'ranged', damage: { dice: '1d10' }, damageType: 'force' },
  ],
  unmodelled: [
    'the extra beams at levels 5, 11 and 17 \u2014 each is a separate attack roll and may take a different target, which is a shape the engine does not have',
  ],
};

/**
 * SRD Guiding Bolt:
 *
 * > _Level 1 Evocation (Cleric)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** 1 round.
 * > "Make a ranged spell attack against the target. On a hit, it takes 4d6
 * > Radiant damage, and the next attack roll made against it before the end of
 * > your next turn has Advantage."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 */
export const GUIDING_BOLT: SpellDefinition = {
  id: 'guiding-bolt',
  name: 'Guiding Bolt',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '4d6', perSlotLevelAbove: '1d6' },
      damageType: 'radiant',
    },
  ],
  unmodelled: [
    'the next attack roll against the target before the end of your next turn has Advantage',
  ],
};

/**
 * SRD Ray of Sickness:
 *
 * > _Level 1 Necromancy (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 2d8 Poison damage and has the Poisoned condition until the end of your
 * > next turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 *
 * The Poisoned condition is a rider on a *hit*, not on a failed save, and the
 * `attack` effect has nowhere to put one. It is named rather than dropped.
 */
export const RAY_OF_SICKNESS: SpellDefinition = {
  id: 'ray-of-sickness',
  name: 'Ray of Sickness',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'poison',
      conditions: [{ name: 'poisoned', lasts: 'end-of-casters-next-turn' }],
    },
  ],
};

/**
 * SRD Acid Splash:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You create an acidic bubble at a point within range, where it explodes in
 * > a 5-foot-radius Sphere. Each creature in that Sphere must succeed on a
 * > Dexterity saving throw or take 1d6 Acid damage."
 * > _Cantrip Upgrade._ "...increases by 1d6 when you reach levels 5 (2d6), 11
 * > (3d6), and 17 (4d6)."
 *
 * An area cantrip: a Sphere placed at a point, and nothing on a success.
 */
export const ACID_SPLASH: SpellDefinition = {
  id: 'acid-splash',
  name: 'Acid Splash',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 5, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '1d6', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'acid',
      onSuccess: 'none',
    },
  ],
};

// — saving throws that deal damage ————————————————————————————————————————————

/**
 * SRD Blight:
 *
 * > _Level 4 Necromancy (Druid, Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "A creature that you can see within range makes a Constitution saving
 * > throw, taking 8d8 Necrotic damage on a failed save or half as much damage
 * > on a successful one. A Plant creature automatically fails the save."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 4."
 */
export const BLIGHT: SpellDefinition = {
  id: 'blight',
  name: 'Blight',
  level: 4,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '1d8' },
      damageType: 'necrotic',
      onSuccess: 'half',
      // SRD: "A Plant creature automatically fails the save." The die is still
      // thrown and recorded; `autoFailed` overrides the total, exactly as a
      // Stunned creature's Strength save does.
      againstType: { types: ['Plant'], outcome: 'automatic-failure' },
    },
  ],
  unmodelled: ['the alternative target, a nonmagical plant that is not a creature'],
};

/**
 * SRD Dissonant Whispers:
 *
 * > _Level 1 Enchantment (Bard)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target makes a Wisdom saving throw. On a failed save, it takes 3d6
 * > Psychic damage and must immediately use its Reaction, if available, to
 * > move as far away from you as it can, using the safest route. On a
 * > successful save, the target takes half as much damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 */
export const DISSONANT_WHISPERS: SpellDefinition = {
  id: 'dissonant-whispers',
  name: 'Dissonant Whispers',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a creature that fails spends its Reaction fleeing as far as it can'],
};

/**
 * SRD Mind Spike:
 *
 * > _Level 2 Divination (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 hour.
 * > "The target makes a Wisdom saving throw, taking 3d8 Psychic damage on a
 * > failed save or half as much damage on a successful one. On a failed save,
 * > you also always know the target's location until the spell ends..."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 2."
 */
export const MIND_SPIKE: SpellDefinition = {
  id: 'mind-spike',
  name: 'Mind Spike',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'knowing the target\u2019s location for the duration, and its losing the benefit of being hidden or Invisible against you',
  ],
};

/**
 * SRD Harm:
 *
 * > _Level 6 Necromancy (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target makes a Constitution saving throw. On a failed save, it takes
 * > 14d6 Necrotic damage, and its Hit Point maximum is reduced by an amount
 * > equal to the Necrotic damage it took. On a successful save, it takes half
 * > as much damage only."
 */
export const HARM: SpellDefinition = {
  id: 'harm',
  name: 'Harm',
  level: 6,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '14d6' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'the Hit Point maximum reduction equal to the damage taken, which cannot take it below 1',
  ],
};

/**
 * SRD Shatter:
 *
 * > _Level 2 Evocation (Bard, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Each creature in a 10-foot-radius Sphere centered there makes a
 * > Constitution saving throw, taking 3d8 Thunder damage on a failed save or
 * > half as much damage on a successful one. A Construct has Disadvantage on
 * > the save."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 2."
 */
export const SHATTER: SpellDefinition = {
  id: 'shatter',
  name: 'Shatter',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 10, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
      damageType: 'thunder',
      onSuccess: 'half',
      // SRD: "A Construct has Disadvantage on the save." Presence, not
      // arithmetic — it goes in as a `ModeSource` and cancels against an
      // Advantage from anywhere else rather than outweighing it.
      againstType: { types: ['Construct'], outcome: 'disadvantage' },
    },
  ],
};

/**
 * SRD Cone of Cold:
 *
 * > _Level 5 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "Each creature in a 60-foot Cone originating from you makes a Constitution
 * > saving throw, taking 8d8 Cold damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 5."
 */
export const CONE_OF_COLD: SpellDefinition = {
  id: 'cone-of-cold',
  name: 'Cone of Cold',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 60, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '1d8' },
      damageType: 'cold',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a creature killed by this spell becomes a frozen statue until it thaws'],
};

/**
 * SRD Circle of Death:
 *
 * > _Level 6 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Negative energy ripples out in a 60-foot-radius Sphere from a point you
 * > choose within range. Each creature in that area makes a Constitution
 * > saving throw, taking 8d8 Necrotic damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 2d8 for each
 * > spell slot level above 6."
 *
 * Note the **2**d8 per level, where most spells add one die. Reading the
 * increase off the base die count would give the wrong number here too.
 */
export const CIRCLE_OF_DEATH: SpellDefinition = {
  id: 'circle-of-death',
  name: 'Circle of Death',
  level: 6,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '2d8' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Chain Lightning:
 *
 * > _Level 6 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "You launch a lightning bolt toward a target you can see within range.
 * > Three bolts then leap from that target to as many as three other targets
 * > of your choice, each of which must be within 30 feet of the first target.
 * > A target can be a creature or an object and can be targeted by only one of
 * > the bolts. Each target makes a Dexterity saving throw, taking 10d8
 * > Lightning damage on a failed save or half as much damage on a successful
 * > one."
 * > _Using a Higher-Level Spell Slot._ "One additional bolt leaps from the
 * > first target to another target for each spell slot level above 6."
 *
 * Four named targets rather than an area: every one of them is the caster's
 * choice, which is what makes this a target list and not a Sphere. What the
 * list cannot carry is the geometry *between* the targets — the SRD measures
 * the three later bolts from the first target, and the engine measures every
 * target from the caster.
 */
export const CHAIN_LIGHTNING: SpellDefinition = {
  id: 'chain-lightning',
  name: 'Chain Lightning',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 4, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d8' },
      damageType: 'lightning',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'each later bolt must be within 30 feet of the first target: every target is checked against the spell\u2019s own range from the caster instead',
    'only the first target must be seen; sight is required of all four here',
  ],
};

/**
 * SRD Disintegrate:
 *
 * > _Level 6 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A creature targeted by this spell makes a Dexterity saving throw. On a
 * > failed save, the target takes 10d6 + 40 Force damage. If this damage
 * > reduces it to 0 Hit Points, it and everything nonmagical it is wearing and
 * > carrying are disintegrated into gray dust."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 3d6 for each
 * > spell slot level above 6."
 *
 * The flat 40 is why `DiceScaling` carries a `flat`, and the upcast is why it
 * carries the increase as a whole notation: 10d6 growing by **3**d6 is not the
 * base count, and reading the step off the base would more than triple it.

 *
 * `onSuccess: 'none'` is transcribed, not assumed. The SRD gives this spell no
 * success clause at all — unlike Inflict Wounds, which says "half as much" —
 * and defaulting either way rewrites one of the two spells.
 */
export const DISINTEGRATE: SpellDefinition = {
  id: 'disintegrate',
  name: 'Disintegrate',
  level: 6,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d6', flat: 40, perSlotLevelAbove: '3d6' },
      damageType: 'force',
      onSuccess: 'none',
    },
  ],
  unmodelled: [
    'a target the damage reduces to 0 Hit Points is disintegrated to dust with everything nonmagical it carries, and can then be revived only by True Resurrection or Wish',
    'the automatic disintegration of a Large or smaller nonmagical object or creation of magical force, and of a 10-foot-Cube portion of a larger one',
  ],
};

/**
 * SRD Befuddlement:
 *
 * > _Level 8 Enchantment (Bard, Druid, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 150 feet. **Duration:** Instantaneous.
 * > "You blast the mind of a creature that you can see within range. The
 * > target makes an Intelligence saving throw. On a failed save, the target
 * > takes 10d12 Psychic damage and can't cast spells or take the Magic action.
 * > At the end of every 30 days, the target repeats the save, ending the
 * > effect on a success. On a successful save, the target takes half as much
 * > damage only."
 */
export const BEFUDDLEMENT: SpellDefinition = {
  id: 'befuddlement',
  name: 'Befuddlement',
  level: 8,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'int',
      damage: { dice: '10d12' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'the failed save also stops the target casting spells or taking the Magic action, which is not a condition the engine names',
    'the save the target repeats at the end of every 30 days, and the Greater Restoration, Heal or Wish that would end it sooner',
  ],
};

/**
 * SRD Contagion:
 *
 * > _Level 5 Necromancy (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 7 days.
 * > "The target must succeed on a Constitution saving throw or take 11d8
 * > Necrotic damage and have the Poisoned condition. Also, choose one ability
 * > when you cast the spell. While Poisoned, the target has Disadvantage on
 * > saving throws made with the chosen ability."
 *
 * Damage and a condition off one save, which is the shape `condition` exists
 * for. The seven days are the *failed* branch of a mechanic the engine cannot
 * run — three successes end it, three failures fix it — so the definition
 * takes the branch the SRD prints as the duration and says which one it took.
 */
export const CONTAGION: SpellDefinition = {
  id: 'contagion',
  name: 'Contagion',
  level: 5,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '11d8' },
      damageType: 'necrotic',
      onSuccess: 'none',
      conditions: [{ name: 'poisoned' }],
    },
  ],
  durationSeconds: 604800,
  unmodelled: [
    'the ability chosen at the cast, on which the Poisoned target then has Disadvantage on saving throws',
    'the save repeated at the end of each of the target\u2019s turns until three successes end the spell or three failures fix it for the 7 days assumed here',
    'the Constitution save the target makes before any effect can end the Poisoned condition on it',
  ],
};

/**
 * SRD Freezing Sphere:
 *
 * > _Level 6 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Instantaneous.
 * > "A frigid globe streaks from you to a point of your choice within range,
 * > where it explodes in a 60-foot-radius Sphere. Each creature in that area
 * > makes a Constitution saving throw, taking 10d6 Cold damage on failed save
 * > or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 6."
 */
export const FREEZING_SPHERE: SpellDefinition = {
  id: 'freezing-sphere',
  name: 'Freezing Sphere',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '10d6', perSlotLevelAbove: '1d6' },
      damageType: 'cold',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'freezing a body of water to a depth of 6 inches, and the Restrained condition on creatures swimming there',
    'holding the globe back rather than firing it, to be thrown or slung later or to explode on its own after 1 minute',
  ],
};

/**
 * SRD Sunburst:
 *
 * > _Level 8 Evocation (Cleric, Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Brilliant sunlight flashes in a 60-foot-radius Sphere centered on a point
 * > you choose within range. Each creature in the Sphere makes a Constitution
 * > saving throw. On a failed save, a creature takes 12d6 Radiant damage and
 * > has the Blinded condition for 1 minute. On a successful save, it takes
 * > half as much damage only."
 *
 * > "A creature Blinded by this spell makes another Constitution saving throw
 * > at the end of each of its turns, ending the effect on itself on a
 * > success."
 *
 * **The rider outlives the casting and is still the casting's**, which is the
 * pair of facts that needed a third `RiderDuration` member. The spell is
 * Instantaneous, so there is no casting deadline to borrow and no ongoing
 * record for a Dispel Magic to find; the Blinded runs its minute on the clock,
 * alone. `durationSeconds: 60` on the definition was the tempting answer and
 * the wrong one — it would make a flash of light a dispellable ongoing spell.
 *
 * **And "another Constitution saving throw" is the one this spell already
 * asked for**, which is why `repeats` names no ability: the host rolled it,
 * and a rider restating it would be a second place to get one sentence wrong.
 * "Ending the effect **on itself**" is `end-on-target`: one creature blinks
 * the glare away and everybody else in the Sphere is still blind.
 */
export const SUNBURST: SpellDefinition = {
  id: 'sunburst',
  name: 'Sunburst',
  level: 8,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '12d6' },
      damageType: 'radiant',
      onSuccess: 'half',
      conditions: [
        {
          name: 'blinded',
          lasts: { seconds: 60 },
          repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
  unmodelled: ['dispelling magical Darkness in the area'],
};

/**
 * SRD Insect Plague:
 *
 * > _Level 5 Conjuration (Cleric, Druid, Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Concentration, up to 10 minutes.
 * > "Swarming locusts fill a 20-foot-radius Sphere centered on a point you
 * > choose within range... When the swarm appears, each creature in it makes a
 * > Constitution saving throw, taking 4d10 Piercing damage on a failed save or
 * > half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 5."
 *
 * The save when the swarm *appears* is the half that resolves at the cast. The
 * rest of this spell is an area that keeps acting, which is the shape nothing
 * in the engine has yet.
 */
export const INSECT_PLAGUE: SpellDefinition = {
  id: 'insect-plague',
  name: 'Insect Plague',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
      damageType: 'piercing',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 600,
  // "A creature also makes this save when it enters the spell's area for the
  // first time on a turn or ends its turn there. A creature makes this save
  // only once per turn." The cap is on the *creature*, so entering and then
  // ending the turn in the swarm is one save, not two.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'first-per-turn',
    oncePerTurn: true,
    label: 'Insect Plague (the swarm)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
        damageType: 'piercing',
        onSuccess: 'half',
      },
    ],
  },
  unmodelled: [
    'the Sphere remains for the duration, its area Lightly Obscured and Difficult Terrain',
  ],
};

/**
 * SRD Cloudkill:
 *
 * > _Level 5 Conjuration (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You create a 20-foot-radius Sphere of yellow-green fog centered on a
 * > point within range... Each creature in the Sphere makes a Constitution
 * > saving throw, taking 5d8 Poison damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 5."
 *
 * Insect Plague's shape with a fog that walks: the cloud moves 10 feet away
 * from the caster every turn, which is an area whose *position* changes on a
 * later turn rather than one that merely persists.
 */
export const CLOUDKILL: SpellDefinition = {
  id: 'cloudkill',
  name: 'Cloudkill',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
      damageType: 'poison',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 600,
  unmodelled: [
    'the fog lasts for the duration and its area is Heavily Obscured',
    'the same save again when the Sphere moves into a creature\u2019s space, or when it enters the Sphere or ends its turn there, once per turn',
    'the Sphere moving 10 feet away from you at the start of each of your turns',
    'strong wind disperses the fog and ends the spell',
  ],
};

/**
 * SRD Incendiary Cloud:
 *
 * > _Level 8 Conjuration (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Concentration, up to 1 minute.
 * > "A swirling cloud of embers and smoke fills a 20-foot-radius Sphere
 * > centered on a point within range... When the cloud appears, each creature
 * > in it makes a Dexterity saving throw, taking 10d8 Fire damage on a failed
 * > save or half as much damage on a successful one."
 *
 * Cloudkill's shape at eight levels higher, down to the cloud that walks: the
 * save when it appears is the half that resolves at the cast, and an area
 * whose position changes on a later turn is the shape nothing here has yet.
 */
export const INCENDIARY_CLOUD: SpellDefinition = {
  id: 'incendiary-cloud',
  name: 'Incendiary Cloud',
  level: 8,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d8' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the cloud lasts for the duration and its area is Heavily Obscured',
    'the same save again when the Sphere moves into a creature\u2019s space, or when it enters the Sphere or ends its turn there, once per turn',
    'the cloud moving 10 feet away from you, in a direction you choose, at the start of each of your turns',
    'a strong wind disperses the cloud and ends the spell',
  ],
};

/**
 * SRD Moonbeam:
 *
 * > _Level 2 Evocation (Druid)._ **Casting Time:** Action. **Range:** 120
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "A silvery beam of pale light shines down in a 5-foot-radius, 40-foot-high
 * > Cylinder centered on a point within range. Until the spell ends, Dim Light
 * > fills the Cylinder, and you can take a Magic action on later turns to move
 * > the Cylinder up to 60 feet."
 * > "When the Cylinder appears, each creature in it makes a Constitution
 * > saving throw. On a failed save, a creature takes 2d10 Radiant damage, and
 * > if the creature is shape-shifted ... it reverts to its true form and can't
 * > shape-shift until it leaves the Cylinder. On a successful save, a creature
 * > takes half as much damage only. A creature also makes this save **when the
 * > spell's area moves into its space** and when it enters the spell's area or
 * > ends its turn there. A creature makes this save only once per turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 2."
 *
 * **The spell that proves an area can arrive at a creature standing still.**
 * Every other persistent area in the catalogue is conjured somewhere and stays
 * there, so membership changed only when a creature changed its position.
 * Moonbeam prints three trigger clauses in one sentence and the first of them
 * is the beam's own motion — see {@link AreaTrigger.onAreaEntry}.
 *
 * Four sentences, four fields, and none of them invented:
 *
 * | SRD | Where |
 * |---|---|
 * | "a 5-foot-radius, 40-foot-high Cylinder centered on a point" | `area` |
 * | "within range" — 120 feet, measured from the caster at the cast | `range` |
 * | "take a Magic action ... to move the Cylinder up to 60 feet" | `activation.movesArea` |
 * | "when the spell's area moves into its space" | `areaTrigger.onAreaEntry` |
 *
 * **The 120 feet is not the allowance.** Range governs where the beam may
 * first be put down; the 60 feet governs how far it travels afterwards, from
 * wherever it now is. A beam walked steadily away ends up further from its
 * caster than the spell's Range, which is what the two separate sentences say.
 *
 * `onEntry: 'every-entry'` is the text and not a shortcut: Moonbeam writes
 * "when it enters the spell's area" with no "for the first time on a turn",
 * unlike Insect Plague. The cap that makes the two behave alike is the
 * separate "only once per turn" sentence, which is a cap on the *creature*
 * across all three clauses.
 */
export const MOONBEAM: SpellDefinition = {
  id: 'moonbeam',
  name: 'Moonbeam',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 5, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'radiant',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 60,
  // "A creature also makes this save when the spell's area moves into its
  // space and when it enters the spell's area or ends its turn there. A
  // creature makes this save only once per turn." Three clauses, one save, one
  // cap on the creature that spans all three.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    onAreaEntry: true,
    oncePerTurn: true,
    label: 'Moonbeam (the beam)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
        damageType: 'radiant',
        onSuccess: 'half',
      },
    ],
  },
  // "you can take a Magic action on later turns to move the Cylinder up to 60
  // feet." The action's entire content, which is why it carries no effects and
  // aims at nobody.
  activation: {
    action: 'action',
    movesArea: 60,
    label: 'Moonbeam (the beam moves)',
    effects: [],
  },
  unmodelled: [
    'the Dim Light that fills the Cylinder for the duration; light is not modelled',
    'a shape-shifted creature reverting to its true form on a failed save, and being unable to shape-shift until it leaves the Cylinder: shape-shifting is not modelled',
  ],
};

/**
 * SRD Black Tentacles:
 *
 * > _Level 4 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** 90
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Squirming, ebony tentacles fill a 20-foot square on ground that you can
 * > see within range... Each creature in that area makes a Strength saving
 * > throw. On a failed save, it takes 3d6 Bludgeoning damage, and it has the
 * > Restrained condition until the spell ends."
 *
 * A 20-foot square is modelled as a Cube, the same reading Grease's 10-foot
 * square already takes: the lattice has no 2D shape, and the SRD's squares on
 * the ground are the footprint of one.
 *
 * `onSuccess: 'none'` is the text, not a default — "On a failed save, it
 * takes..." gives a successful save nothing to take.
 */
export const BLACK_TENTACLES: SpellDefinition = {
  id: 'black-tentacles',
  name: 'Black Tentacles',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'str',
      damage: { dice: '3d6' },
      damageType: 'bludgeoning',
      onSuccess: 'none',
      conditions: [
        {
          name: 'restrained',
          // SRD: "A Restrained creature can take an action to make a Strength
          // (Athletics) check against your spell save DC, ending the condition
          // on itself on a success." On itself: the tentacles carry on for
          // everybody else standing in them, which is what `end-on-target`
          // means.
          check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
  durationSeconds: 60,
  // "A creature also makes that save if it enters the area or ends it turn
  // there. A creature makes that save only once per turn."
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    oncePerTurn: true,
    label: 'Black Tentacles (the tentacles)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'str',
        damage: { dice: '3d6' },
        damageType: 'bludgeoning',
        onSuccess: 'none',
        conditions: [
          {
            name: 'restrained',
            check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
          },
        ],
      },
    ],
  },
  unmodelled: ['the area is Difficult Terrain for the duration'],
};

/**
 * SRD Phantasmal Killer:
 *
 * > _Level 4 Illusion (Bard, Wizard)._ **Casting Time:** Action. **Range:**
 * > 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "The target makes a Wisdom saving throw. On a failed save, the target
 * > takes 4d10 Psychic damage and has Disadvantage on ability checks and
 * > attack rolls for the duration. On a successful save, the target takes half
 * > as much damage, and the spell ends."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 4."
 *
 * The opening save is the half the engine resolves. The rest is an effect a
 * later turn acts *through* — a save each turn that deals the damage again —
 * which is the shape that blocks eighteen SRD spells and is not built.
 */
export const PHANTASMAL_KILLER: SpellDefinition = {
  id: 'phantasmal-killer',
  name: 'Phantasmal Killer',
  level: 4,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
      damageType: 'psychic',
      onSuccess: 'half',
      // "On a failed save, the target takes 4d10 Psychic damage **and has
      // Disadvantage on ability checks and attack rolls** for the duration."
      // One save, two consequences — and two `roll-mode` effects beside the
      // damage would roll two saves for the same failure, so a target could
      // fail one and make the other, which is not the spell.
      //
      // **Two riders rather than one**, because they are two sentences of the
      // selector's vocabulary: a `RollModifier` names one family of roll, and
      // "ability checks and attack rolls" is two. Neither narrows by ability
      // or skill, which is what "ability checks" with nothing after it means.
      //
      // "For the duration" is the casting's, so these riders say no `lasts` —
      // the field exists on the one member whose SRD sentence asks for it, and
      // a `mode` that borrowed it would be claiming a deadline the spell does
      // not print.
      modifiers: [
        {
          kind: 'mode',
          modifier: {
            mode: 'disadvantage',
            selector: { roll: 'ability-check', relation: 'roller' },
          },
        },
        {
          kind: 'mode',
          modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
        },
      ],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save at the end of each of the target\u2019s turns, which deals the Psychic damage again on a failure',
    'a successful save ends the spell, where the engine leaves the Concentration running',
  ],
};

// — saving throws that impose a condition ————————————————————————————————————

/**
 * SRD Hideous Laughter:
 *
 * > _Level 1 Enchantment (Bard, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "One creature of your choice that you can see within range makes a Wisdom
 * > saving throw. On a failed save, it has the Prone and Incapacitated
 * > conditions for the duration."
 * > "At the end of each of its turns and each time it takes damage, it makes
 * > another Wisdom saving throw. The target has Advantage on the save if the
 * > save is triggered by damage. On a successful save, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * **The spell that makes `conditions` plural.** "The Prone **and**
 * Incapacitated conditions" is one Wisdom saving throw with two consequences,
 * and writing it as two `save` effects would roll two — a creature could then
 * fail one and make the other, which is not the spell. Exactly the argument
 * `plus` makes for a second damage type, on the second thing a failed save can
 * impose.
 *
 * **Both are the casting's, so neither `outlivesCasting`s.** SRD Grease's
 * Prone is the opposite case and is the reason that field exists: there it is
 * "or have the Prone condition", full stop, and Prone is the creature's own to
 * stand up from. Here it is "for the duration" and the spell goes further —
 * "it can't end the Prone condition on itself" — so the Laughter owns it, ends
 * it, and a Dispel Magic aimed at the target finds the spell that put them
 * there.
 *
 * The repeat save stays flat: SRD writes "it makes another Wisdom saving
 * throw" once, about the spell, not once per condition — and "the spell ends"
 * is `end-casting`, so the success lifts both without either rider naming the
 * other.
 */
export const HIDEOUS_LAUGHTER: SpellDefinition = {
  id: 'hideous-laughter',
  name: 'Hideous Laughter',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'prone',
      conditions: [{ name: 'incapacitated' }],
      repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the second Wisdom save each time the target takes damage, which is made with Advantage',
    'the target being unable to end the Prone condition on itself, so it may stand up while the spell runs',
    'laughing uncontrollably, and whether the creature is capable of laughter at all',
  ],
};

/**
 * SRD Heroism, whole:
 *
 * > _Level 1 Enchantment (Bard, Paladin)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "A willing creature you touch is imbued with bravery. Until the spell ends,
 * > the creature is immune to the Frightened condition and gains Temporary Hit
 * > Points equal to your spellcasting ability modifier at the start of each of
 * > its turns."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * **One sentence, two clauses, and they were built two tranches apart.** The
 * Immunity is IE-042's `condition-immunity` word for word — unconditional, for
 * as long as the casting runs, which is the shape that kind was built for. The
 * Temporary Hit Points are the other half, and for four tranches they were the
 * spell's only blocker: a turn boundary raised saves and paid nothing out, so
 * `grantTemporaryHpTo` existed and no effect reached it on a schedule.
 *
 * **"Equal to your spellcasting ability modifier" and nothing else**, which is
 * why the payout prints no dice and no number of its own: `addSpellcastingModifier`
 * is the whole amount, pinned at the cast like every other casting number.
 *
 * **"Each of *its* turns" is the recipient's boundary**, which is the `at` the
 * payout carries. A paladin who casts this on the barbarian and then walks away
 * still pays at the barbarian's turn, because the arrangement is on the
 * barbarian.
 *
 * The upcast buys targets rather than Temporary Hit Points —
 * `extraPerSlotLevelAbove`, the same field Bless and Hideous Laughter write.
 */
export const HEROISM: SpellDefinition = {
  id: 'heroism',
  name: 'Heroism',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  // "Duration: Concentration, up to 1 minute."
  concentration: true,
  durationSeconds: 60,
  // "Range: Touch."
  range: { kind: 'touch' },
  // "A willing creature you touch", and one more per slot level above 1.
  targets: { count: 1, self: true, extraPerSlotLevelAbove: 1 },
  effects: [
    { kind: 'condition-immunity', conditions: ['frightened'] },
    {
      kind: 'turn-payout',
      at: 'start-of-turn',
      payout: 'temporary-hit-points',
      addSpellcastingModifier: true,
    },
  ],
  unmodelled: [
    'whether the target is willing is not modelled; willingness is fiction',
    'being imbued with bravery is narration',
  ],
};

/**
 * SRD Hold Monster:
 *
 * > _Level 5 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose a creature that you can see within range. The target must succeed
 * > on a Wisdom saving throw or have the Paralyzed condition for the duration.
 * > At the end of each of its turns, the target repeats the save, ending the
 * > spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 5."
 *
 * Hold Person with the Humanoid restriction lifted, which is the whole
 * difference between the two spells and the reason the type check is data.
 */
export const HOLD_MONSTER: SpellDefinition = {
  id: 'hold-monster',
  name: 'Hold Monster',
  level: 5,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
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
 * SRD Blindness/Deafness:
 *
 * > _Level 2 Transmutation (Bard, Cleric, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 120 feet. **Duration:** 1 minute.
 * > "One creature that you can see within range must succeed on a Constitution
 * > saving throw, or it has the Blinded or Deafened condition (your choice)
 * > for the duration. At the end of each of its turns, the target repeats the
 * > save, ending the spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 *
 * **One minute and no Concentration**, which is the point of having it here:
 * it exercises a duration that runs on the clock rather than on a caster's
 * attention. The caster's choice between the two conditions is not offered —
 * a per-casting choice needs somewhere to be recorded, and inventing a default
 * would silently pick Blinded every time. It picks Blinded and says so.
 */
export const BLINDNESS_DEAFNESS: SpellDefinition = {
  id: 'blindness-deafness',
  name: 'Blindness/Deafness',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'con',
      condition: 'blinded',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
  unmodelled: ['the caster\u2019s choice of Deafened instead of Blinded'],
};

/**
 * SRD Charm Person:
 *
 * > _Level 1 Enchantment (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 hour.
 * > "One Humanoid you can see within range makes a Wisdom saving throw. It
 * > does so with Advantage if you or your allies are fighting it. On a failed
 * > save, the target has the Charmed condition until the spell ends or until
 * > you or your allies damage it."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const CHARM_PERSON: SpellDefinition = {
  id: 'charm-person',
  name: 'Charm Person',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Humanoid' },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', advantageIfFought: true, condition: 'charmed' }],
  durationSeconds: 3600,
  // "until the spell ends **or until you or your allies damage it**" — the
  // bound is on the Charmed condition, so one blow frees one creature and a
  // level 3 casting goes on holding the other.
  endsEarly: [{ on: 'caster-or-ally-damages-target', ends: 'target' }],
};

/**
 * SRD Fear:
 *
 * > _Level 3 Illusion (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Each creature in a 30-foot Cone must succeed on a Wisdom saving throw or
 * > drop whatever it is holding and have the Frightened condition for the
 * > duration."
 */
export const FEAR: SpellDefinition = {
  id: 'fear',
  name: 'Fear',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 30, origin: 'self' },
  effects: [{ kind: 'save', ability: 'wis', condition: 'frightened' }],
  durationSeconds: 60,
  unmodelled: [
    'a creature that fails drops whatever it is holding',
    'a Frightened creature Dashes away from you each turn, and saves again when it ends its turn out of your line of sight',
  ],
};

/**
 * SRD Hypnotic Pattern:
 *
 * > _Level 3 Illusion (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "Each creature in the area who can see the pattern must succeed on a
 * > Wisdom saving throw or have the Charmed condition for the duration. While
 * > Charmed, the creature has the Incapacitated condition and a Speed of 0."
 */
export const HYPNOTIC_PATTERN: SpellDefinition = {
  id: 'hypnotic-pattern',
  name: 'Hypnotic Pattern',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 30, origin: 'point' },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'charmed',
      // "While Charmed, the creature has the Incapacitated condition and a
      // Speed of 0." One Wisdom save, and neither of the other two is a second
      // roll — a second `save` effect would ask for one, and a creature could
      // then be Charmed and not Incapacitated, which the spell does not
      // permit.
      conditions: [{ name: 'incapacitated' }],
      // The Speed rides the same failure, and it needs no `lasts`: the
      // casting is a Concentration spell with a minute on it, so both doors
      // that end it — the Concentration breaking and the deadline — take the
      // Speed with them, and a release on one target frees that one alone.
      modifiers: [{ kind: 'speed-change', change: 'zero' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'only a creature that can see the pattern is affected',
    'the spell ending for a creature that takes damage or is shaken out of it',
  ],
};

/**
 * SRD Banishment:
 *
 * > _Level 4 Abjuration (Cleric, Paladin, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "One creature that you can see within range must succeed on a Charisma
 * > saving throw or be transported to a harmless demiplane for the duration.
 * > While there, the target has the Incapacitated condition."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 4."
 */
export const BANISHMENT: SpellDefinition = {
  id: 'banishment',
  name: 'Banishment',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'cha', condition: 'incapacitated' }],
  durationSeconds: 60,
  unmodelled: [
    'the target leaving the battlefield for a demiplane, so it is Incapacitated where it stands rather than gone',
    'an Aberration, Celestial, Elemental, Fey or Fiend not returning if the spell runs its full minute',
  ],
};

/**
 * SRD Suggestion:
 *
 * > _Level 2 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 30 feet. **Duration:** Concentration, up to 8 hours.
 * > "You suggest a course of activity\u2014described in no more than 25 words\u2014to
 * > one creature you can see within range that can hear and understand you...
 * > The target must succeed on a Wisdom saving throw or have the Charmed
 * > condition for the duration or until you or your allies deal damage to the
 * > target. The Charmed target pursues the suggestion to the best of its
 * > ability."
 *
 * The save and the Charmed condition are arithmetic; the suggestion is not.
 * Whether "fetch the key and give it to me" is achievable, and whether it
 * obviously harms the target, is a judgement the SRD hands the table, so the
 * engine spends the slot, runs the eight hours, and says so.
 */
export const SUGGESTION: SpellDefinition = {
  id: 'suggestion',
  name: 'Suggestion',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 28800,
  // "for the duration or until you or your allies deal damage to the target",
  // and the paragraph's last sentence says which scope the book means: "the
  // spell ends for the target upon completing it".
  endsEarly: [{ on: 'caster-or-ally-damages-target', ends: 'target' }],
  unmodelled: [
    'the course of activity you suggest, whether it sounds achievable, and whether the target pursues or completes it — the other half of the sentence that ends this spell on that target',
    'the target must be able to hear and understand you',
  ],
};

/**
 * A Dominate spell: a save, the Charmed condition, and a link to command them.
 *
 * SRD prints Dominate Beast and Dominate Person as the same paragraph with the
 * creature type and the slot levels changed, so they are built from one
 * function rather than transcribed twice. Every field still comes from the SRD
 * line quoted at the call site.
 *
 * What none of them can carry is the repeat: "whenever the target takes
 * damage, it repeats the save". `repeats` fires at a **turn boundary**, which
 * is when Hold Person's save comes round; damage is a trigger, and an effect
 * that hangs on one needs machinery the engine does not have.
 */
function dominate(args: {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Omitted by Dominate Monster, which takes anything at all. */
  readonly creatureType?: string;
  readonly durationSeconds: number;
  /**
   * How the SRD lengthens the Concentration with a bigger slot.
   *
   * **Three spells, three different tables**, which is exactly why this is a
   * parameter rather than something the shared helper could compute: Dominate
   * Beast bands at 5/6/7+, Dominate Person one level higher at 6/7/8+, and
   * Dominate Monster prints a single band at 9. A formula that fitted any two
   * of them would be silently wrong about the third.
   */
  readonly durationAtSlot: Readonly<Record<number, number>>;
}): SpellDefinition {
  return {
    id: args.id,
    name: args.name,
    level: args.level,
    school: 'enchantment',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: {
      count: 1,
      ...(args.creatureType === undefined ? {} : { mustBeType: args.creatureType }),
    },
    requiresSight: true,
    effects: [{ kind: 'save', ability: 'wis', advantageIfFought: true, condition: 'charmed' }],
    durationSeconds: args.durationSeconds,
    durationAtSlot: args.durationAtSlot,
    unmodelled: [
      'the target repeats the save whenever it takes damage, which is a trigger rather than a turn boundary',
      'the telepathic link that issues commands, and spending your own Reaction to command one of the target\u2019s',
    ],
  };
}

/**
 * SRD Dominate Beast:
 *
 * > _Level 4 Enchantment (Druid, Ranger, Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "One Beast you can see within range must succeed on a Wisdom saving throw
 * > or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 5 (up to 10 minutes), 6 (up to 1 hour), or 7+
 * > (up to 8 hours)."
 */
export const DOMINATE_BEAST = dominate({
  id: 'dominate-beast',
  name: 'Dominate Beast',
  level: 4,
  creatureType: 'Beast',
  durationSeconds: 60,
  // "level 5 (up to 10 minutes), 6 (up to 1 hour), or 7+ (up to 8 hours)":
  // 10 x 60, 60 x 60, 8 x 3600.
  durationAtSlot: { 5: 600, 6: 3600, 7: 28800 },
});

/**
 * SRD Dominate Person:
 *
 * > _Level 5 Enchantment (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "One Humanoid you can see within range must succeed on a Wisdom saving
 * > throw or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 6 (up to 10 minutes), 7 (up to 1 hour), or 8+
 * > (up to 8 hours)."
 */
export const DOMINATE_PERSON = dominate({
  id: 'dominate-person',
  name: 'Dominate Person',
  level: 5,
  creatureType: 'Humanoid',
  durationSeconds: 60,
  // "level 6 (up to 10 minutes), 7 (up to 1 hour), or 8+ (up to 8 hours)" —
  // the same three spans one slot level higher than Dominate Beast.
  durationAtSlot: { 6: 600, 7: 3600, 8: 28800 },
});

/**
 * SRD Dominate Monster:
 *
 * > _Level 8 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Concentration, up to 1 hour.
 * > "One creature you can see within range must succeed on a Wisdom saving
 * > throw or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a level 9 spell slot (up to 8 hours)."
 *
 * The same paragraph again with the creature type lifted — the difference
 * between Hold Person and Hold Monster, made the same way and for the same
 * reason: the restriction is data, not a separate spell.
 */
export const DOMINATE_MONSTER = dominate({
  id: 'dominate-monster',
  name: 'Dominate Monster',
  level: 8,
  durationSeconds: 3600,
  // "a level 9 spell slot (up to 8 hours)" — one band, and the only one the
  // book gives a level 8 spell.
  durationAtSlot: { 9: 28800 },
});

/**
 * SRD Mass Suggestion:
 *
 * > _Level 6 Enchantment (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** 24 hours.
 * > "You suggest a course of activity\u2014described in no more than 25 words\u2014to
 * > twelve or fewer creatures you can see within range that can hear and
 * > understand you... Each target must succeed on a Wisdom saving throw or
 * > have the Charmed condition for the duration or until you or your allies
 * > deal damage to the target."
 * > _Using a Higher-Level Spell Slot._ "The duration is longer with a spell
 * > slot of level 7 (10 days), 8 (30 days), or 9 (366 days)."
 *
 * Suggestion for twelve, and **without Concentration** — a full day running
 * on the clock rather than on the caster's attention, which is the difference
 * a bigger slot buys and the reason the two are separate spells.
 */
export const MASS_SUGGESTION: SpellDefinition = {
  id: 'mass-suggestion',
  name: 'Mass Suggestion',
  level: 6,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 12 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 86400,
  // "level 7 (10 days), 8 (30 days), or 9 (366 days)", in seconds: 10 × 86400,
  // 30 × 86400, 366 × 86400. **The fourth table in four spells** — and the one
  // that is not a Concentration cap at all, because this spell takes none: the
  // slot lengthens a span running on the clock, which is the same field
  // reading the same way for a different sentence.
  durationAtSlot: { 7: 864000, 8: 2592000, 9: 31622400 },
  // "the spell ends for a target upon completing it" — twelve creatures, and
  // the book is explicit that one of them leaving is not the spell ending.
  endsEarly: [{ on: 'caster-or-ally-damages-target', ends: 'target' }],
  unmodelled: [
    'the course of activity you suggest, whether it sounds achievable, and whether a target pursues or completes it — the other half of the sentence that ends this spell on that target',
    'the targets must be able to hear and understand you',
  ],
};

/**
 * SRD Compulsion:
 *
 * > _Level 4 Enchantment (Bard)._ **Casting Time:** Action. **Range:** 30
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature of your choice that you can see within range must succeed
 * > on a Wisdom saving throw or have the Charmed condition until the spell
 * > ends."
 *
 * The first spell here whose target list the SRD gives no number — see
 * `TargetRule.unlimited`. Range and sight are the bound, and both are checked
 * against every name the caller gives.
 */
export const COMPULSION: SpellDefinition = {
  id: 'compulsion',
  name: 'Compulsion',
  level: 4,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 60,
  unmodelled: [
    'the Bonus Action that designates a direction, and the movement each Charmed target must spend going that way',
    'the save a target repeats after moving, which ends the spell on itself on a success',
  ],
};

/**
 * SRD Weird:
 *
 * > _Level 9 Illusion (Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature of your choice in a 30-foot-radius Sphere centered on a
 * > point within range makes a Wisdom saving throw. On a failed save, a target
 * > takes 10d10 Psychic damage and has the Frightened condition for the
 * > duration. On a successful save, a target takes half as much damage only."
 *
 * Both of the new shapes at once, which is why it is worth having: the Sphere
 * bounds who may be chosen (`targetsWithin`) and the SRD names no number of
 * them (`unlimited`). Reading it as a plain area would terrify the caster's
 * own party, standing in the same Sphere.
 */
export const WEIRD: SpellDefinition = {
  id: 'weird',
  name: 'Weird',
  level: 9,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0, unlimited: true },
  targetsWithin: { kind: 'sphere', radius: 30, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '10d10' },
      damageType: 'psychic',
      onSuccess: 'half',
      conditions: [{ name: 'frightened' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save a Frightened target makes at the end of each of its turns, which deals 5d10 Psychic damage again on a failure and ends the spell on that target on a success',
  ],
};

// — bonuses that later rolls read, and Temporary Hit Points ———————————————————

/**
 * SRD Bless:
 *
 * > _Level 1 Enchantment (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "You bless up to three creatures within range. Whenever a target makes an
 * > attack roll or a saving throw before the spell ends, the target adds 1d4
 * > to the attack roll or save."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * No saving throw: you bless your friends and they do not resist.
 */
export const BLESS: SpellDefinition = {
  id: 'bless',
  name: 'Bless',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 3, extraPerSlotLevelAbove: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Bless', dice: '1d4' },
      applies: ['attack', 'save'],
      direction: 'add',
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Bane:
 *
 * > _Level 1 Enchantment (Bard, Cleric, Warlock)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "Up to three creatures of your choice that you can see within range must
 * > each make a Charisma saving throw. Whenever a target that fails this save
 * > makes an attack roll or a saving throw before the spell ends, the target
 * > must subtract 1d4 from the attack roll or save."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * Bless with a minus sign and a save in front of it, which is exactly how the
 * effect type models it.
 */
export const BANE: SpellDefinition = {
  id: 'bane',
  name: 'Bane',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 3, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'buff',
      ability: 'cha',
      bonus: { source: 'Bane', dice: '1d4' },
      applies: ['attack', 'save'],
      direction: 'subtract',
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Guidance:
 *
 * > _Divination Cantrip (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "You touch a willing creature and choose a skill. Until the spell ends,
 * > the creature adds 1d4 to any ability check using the chosen skill."
 *
 * The 2024 wording narrowed this: it is one *chosen skill*, not any check.
 * Choosing which skill needs somewhere to record a per-casting choice, so the
 * bonus is hung on ability checks generally and the narrowing is declared
 * rather than silently applied to everything.
 */
export const GUIDANCE: SpellDefinition = {
  id: 'guidance',
  name: 'Guidance',
  level: 0,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Guidance', dice: '1d4' },
      applies: ['ability-check'],
      direction: 'add',
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the bonus applies to any ability check rather than only the one chosen skill, because a per-casting choice has nowhere to be recorded',
  ],
};

/**
 * SRD False Life:
 *
 * > _Level 1 Necromancy (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You gain 2d4 + 4 Temporary Hit Points."
 * > _Using a Higher-Level Spell Slot._ "You gain 5 additional Temporary Hit
 * > Points for each spell slot level above 1."
 *
 * The spell the flat half of `DiceScaling` exists for: a printed `+ 4`, and an
 * upcast that adds five flat and no dice at all.
 */
export const FALSE_LIFE: SpellDefinition = {
  id: 'false-life',
  name: 'False Life',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'temp-hp',
      amount: { dice: '2d4', flat: 4, flatPerSlotLevelAbove: 5 },
      addSpellcastingModifier: false,
    },
  ],
};

/**
 * SRD Flame Strike:
 *
 * > _Level 5 Evocation (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "Each creature in a 10-foot-radius, 40-foot-high Cylinder centered on a
 * > point within range makes a Dexterity saving throw, taking 5d6 Fire damage
 * > and 5d6 Radiant damage on a failed save or half as much damage on a
 * > successful one."
 * > _Using a Higher-Level Spell Slot._ "The Fire damage and the Radiant damage
 * > increase by 1d6 for each spell slot level above 5."
 *
 * **One save, two damage types** — the spell the `plus` field exists for. Two
 * separate effects would roll two saves and let a target fail one and make the
 * other, which is not this spell. Both halves scale, and a creature resistant
 * to Fire alone still takes the Radiant in full.
 */
export const FLAME_STRIKE: SpellDefinition = {
  id: 'flame-strike',
  name: 'Flame Strike',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 10, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '5d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
      plus: [{ damage: { dice: '5d6', perSlotLevelAbove: '1d6' }, damageType: 'radiant' }],
    },
  ],
};

/**
 * SRD Ice Storm:
 *
 * > _Level 4 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Instantaneous.
 * > "Each creature in the Cylinder makes a Dexterity saving throw. A creature
 * > takes 2d10 Bludgeoning damage and 4d6 Cold damage on a failed save or half
 * > as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The Bludgeoning damage increases by
 * > 1d10 for each spell slot level above 4."
 *
 * The other half of why the two types scale separately: here **only** the
 * Bludgeoning grows. A shared scaling field would quietly upcast the Cold too.
 */
export const ICE_STORM: SpellDefinition = {
  id: 'ice-storm',
  name: 'Ice Storm',
  level: 4,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 20, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'bludgeoning',
      onSuccess: 'half',
      plus: [{ damage: { dice: '4d6' }, damageType: 'cold' }],
    },
  ],
  unmodelled: ['the ground in the Cylinder becomes Difficult Terrain until the end of your next turn'],
};

/**
 * SRD Finger of Death:
 *
 * > _Level 7 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "The target makes a Constitution saving throw, taking 7d8 + 30 Necrotic
 * > damage on a failed save or half as much damage on a successful one. A
 * > Humanoid killed by this spell rises at the start of your next turn as a
 * > **Zombie** that follows your verbal orders."
 *
 * The printed `+ 30` is why damage scaling carries a flat half as well as
 * dice; before that this spell could not be written down at all.
 */
export const FINGER_OF_DEATH: SpellDefinition = {
  id: 'finger-of-death',
  name: 'Finger of Death',
  level: 7,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '7d8', flat: 30 },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a Humanoid killed by this spell rises as a Zombie under your command'],
};

/**
 * SRD Vitriolic Sphere:
 *
 * > _Level 4 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Each creature in that area makes a Dexterity saving throw. On a failed
 * > save, a creature takes 10d4 Acid damage and another 5d4 Acid damage at the
 * > end of its next turn."
 * > _Using a Higher-Level Spell Slot._ "The initial damage increases by 2d4 for
 * > each spell slot level above 4."
 */
export const VITRIOLIC_SPHERE: SpellDefinition = {
  id: 'vitriolic-sphere',
  name: 'Vitriolic Sphere',
  level: 4,
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
      damage: { dice: '10d4', perSlotLevelAbove: '2d4' },
      damageType: 'acid',
      onSuccess: 'half',
      // "The **initial** damage increases by 2d4 for each spell slot level
      // above 4." That word is the whole difference between this spell and
      // Acid Arrow, whose text reads "both initial and later" — so the
      // later hit declares no growth, and carries its own scaling to say so.
      delayed: {
        damage: { dice: '5d4' },
        damageType: 'acid',
      },
    },
  ],
};

/**
 * SRD Vicious Mockery:
 *
 * > _Enchantment Cantrip (Bard)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target must succeed on a Wisdom saving throw or take 1d6 Psychic
 * > damage and have Disadvantage on the next attack roll it makes before the
 * > end of its next turn."
 * > _Cantrip Upgrade._ "...increases by 1d6 when you reach levels 5 (2d6), 11
 * > (3d6), and 17 (4d6)."
 */
export const VICIOUS_MOCKERY: SpellDefinition = {
  id: 'vicious-mockery',
  name: 'Vicious Mockery',
  level: 0,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '1d6', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'psychic',
      onSuccess: 'none',
    },
  ],
  unmodelled: [
    'Disadvantage on the target\u2019s next attack roll before the end of its next turn',
  ],
};

/**
 * SRD Grease:
 *
 * > _Level 1 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** 1 minute.
 * > "Nonflammable grease covers the ground in a 10-foot square centered on a
 * > point within range and turns it into Difficult Terrain for the duration.
 * > When the grease appears, each creature standing in its area must succeed
 * > on a Dexterity saving throw or have the Prone condition."
 *
 * Prone is the documented exception that outlives its cause — SRD: "when this
 * condition ends, you remain Prone" — so the spell's duration does not lift it.
 */
export const GREASE: SpellDefinition = {
  id: 'grease',
  name: 'Grease',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 10, origin: 'point' },
  // SRD says "or have the Prone condition" and stops there. Prone ends when
  // the creature stands up, not when the grease does — so the casting caused
  // it and does not keep it.
  effects: [{ kind: 'save', ability: 'dex', condition: 'prone', outlivesCasting: true }],
  durationSeconds: 60,
  // "A creature that enters the area or ends its turn there must also succeed
  // on that save or fall Prone." No "first time", no "once per turn" — Grease
  // caps nothing, and a creature that slips in and out three times falls over
  // three times.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    label: 'Grease (the slick)',
    effects: [{ kind: 'save', ability: 'dex', condition: 'prone', outlivesCasting: true }],
  },
  unmodelled: [
    'the area becoming Difficult Terrain for the duration',
  ],
};

/**
 * SRD Animal Friendship:
 *
 * > _Level 1 Enchantment (Bard, Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 24 hours.
 * > "Target a Beast that you can see within range. The target must succeed on
 * > a Wisdom saving throw or have the Charmed condition for the duration. If
 * > you or one of your allies deals damage to the target, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional Beast for
 * > each spell slot level above 1."
 */
export const ANIMAL_FRIENDSHIP: SpellDefinition = {
  id: 'animal-friendship',
  name: 'Animal Friendship',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Beast' },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 86400,
  // "If you or one of your allies deals damage to the target, the spells ends"
  // — transcribed as the raw file prints it, typo included. **The spell**, not
  // the condition: this is the sentence Charm Person's is read against, and
  // the reason the scope is a field rather than one answer for all five.
  endsEarly: [{ on: 'caster-or-ally-damages-target', ends: 'casting' }],
};

/**
 * SRD Charm Monster:
 *
 * > _Level 4 Enchantment (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 hour.
 * > "One creature you can see within range makes a Wisdom saving throw. It
 * > does so with Advantage if you or your allies are fighting it. On a failed
 * > save, the target has the Charmed condition until the spell ends or until
 * > you or your allies damage it."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 4."
 *
 * Charm Person with the Humanoid restriction lifted, exactly as Hold Monster
 * is to Hold Person — the pair that shows the type check is data.
 */
export const CHARM_MONSTER: SpellDefinition = {
  id: 'charm-monster',
  name: 'Charm Monster',
  level: 4,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', advantageIfFought: true, condition: 'charmed' }],
  durationSeconds: 3600,
  // The same sentence as Charm Person, bounding the same condition.
  endsEarly: [{ on: 'caster-or-ally-damages-target', ends: 'target' }],
};


// — spells the engine tracks rather than executes ————————————————————————————
//
// Each of these is cast for real: the action goes, the slot goes, Concentration
// moves, the duration runs. What the spell *does* is narration, and every one
// says so. The SRD line each field came from is quoted, because a tracked
// spell's numbers are exactly as easy to get wrong as an executed one's — and
// nothing downstream would catch a wrong duration.

/**
 * SRD Detect Magic:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the presence of magical effects within 30
 * > feet of yourself."
 */
export const DETECT_MAGIC: SpellDefinition = {
  id: 'detect-magic',
  name: 'Detect Magic',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'sensing magical effects within 30 feet, the Magic action to see an aura, and the school a spell belongs to, are all the DM’s to narrate',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s',
  ],
};

/**
 * SRD Mage Armor:
 *
 * > _Level 1 Abjuration._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 8 hours.
 * > "You touch a willing creature who isn't wearing armor. Until the spell
 * > ends, the target's base AC becomes 13 plus its Dexterity modifier. The
 * > spell ends early if the target dons armor."
 *
 * The first spell to **replace** an Armour Class calculation rather than add
 * to one — see the `armor-class` effect for why a `+3` bonus is the wrong
 * answer even though it is usually the same number.
 */
export const MAGE_ARMOR: SpellDefinition = {
  id: 'mage-armor',
  name: 'Mage Armor',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, mustBeUnarmored: true },
  effects: [
    // "13 plus its Dexterity modifier": Dexterity is already in the formula,
    // so the base is the whole of what the spell states. A Shield still helps
    // — it is not body armour, and "isn't wearing armor" is the body slot.
    { kind: 'armor-class', base: 13, plusAbility: null, shieldAllowed: true },
  ],
  durationSeconds: 28_800,
  // "The spell ends early if the target dons armor." Body armour, not a
  // Shield: the sentence is the other half of the targeting clause, and
  // `mustBeUnarmored` already reads the body slot.
  endsEarly: [{ on: 'target-dons-armor', ends: 'casting' }],
  unmodelled: ['whether the target is willing is not modelled; willingness is fiction'],
};

/**
 * SRD Mage Hand:
 *
 * > _Conjuration Cantrip._ **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** 1 minute.
 * > "A spectral, floating hand appears at a point you choose within range."
 */
export const MAGE_HAND: SpellDefinition = {
  id: 'mage-hand',
  name: 'Mage Hand',
  level: 0,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  // SRD: "The hand vanishes ... if you cast this spell again."
  replacesPriorCasting: true,
  unmodelled: [
    'the hand itself is not a thing in the world: manipulating an object, opening a door, or moving the hand 30 feet on a later turn are the DM’s',
    'the hand vanishing when it is ever more than 30 feet from the caster is the DM’s: the hand has no position of its own',
    'the 10-pound carrying limit and the ban on attacking or activating magic items are the DM’s',
  ],
};

/**
 * SRD Light:
 *
 * > _Evocation Cantrip._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 1 hour.
 * > "You touch one Large or smaller object that isn't being worn or carried by
 * > someone else. Until the spell ends, the object sheds Bright Light in a
 * > 20-foot radius and Dim Light for an additional 20 feet."
 */
export const LIGHT: SpellDefinition = {
  id: 'light',
  name: 'Light',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the spell targets an object, and objects are not modelled — which object was touched, and whether it is worn or carried by someone else, are the DM’s',
    'Bright Light in a 20-foot radius and Dim Light beyond it are not modelled; the engine has no lighting',
    'covering the object is the DM’s; a second casting ending the first is not the DM’s and is not done either — the engine holds every casting by caster and spell and nothing ends one on that basis',
  ],
};

/**
 * SRD Fly:
 *
 * > _Level 3 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You touch a willing creature. For the duration, the target gains a Fly
 * > Speed of 60 feet and can hover."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 3."
 */
export const FLY: SpellDefinition = {
  id: 'fly',
  name: 'Fly',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  // "A willing creature" you touch includes you, which Guidance, Jump and Mage
  // Armor are already transcribed as — and which SRD says of this spell from
  // the other end too: a Wizard casting Fly on themselves is the most ordinary
  // use the spell has, and without `self` the engine refused it outright.
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'a Fly Speed of 60 feet and hovering are not applied; the engine tracks one Speed and no movement modes',
    'the fall when the spell ends on a creature still aloft is the DM’s',
  ],
};

/**
 * SRD Longstrider:
 *
 * > _Level 1 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 1 hour.
 * > "You touch a creature. The target's Speed increases by 10 feet until the
 * > spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const LONGSTRIDER: SpellDefinition = {
  id: 'longstrider',
  name: 'Longstrider',
  level: 1,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  // "You touch a creature", which includes yourself — the reading Mage Armor
  // and Stoneskin already take of the same clause, and a correction rather
  // than a consequence of executing the spell: `namedTargets` refuses a caster
  // who names themselves whatever the definition resolves, so a tracked
  // Longstrider cast on oneself was refused too, and nothing had asked.
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  // The whole of the spell: one sentence, one operation, one number. The hour
  // is the casting's own deadline, so the grant needs no `lasts` — it ends
  // through the door `releaseCasting` already opens.
  effects: [{ kind: 'speed', change: 'add', feet: 10 }],
  durationSeconds: 3600,
};

/**
 * SRD Darkvision:
 *
 * > _Level 2 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 8 hours.
 * > "For the duration, a willing creature you touch has Darkvision with a
 * > range of 150 feet."
 */
export const DARKVISION: SpellDefinition = {
  id: 'darkvision',
  name: 'Darkvision',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'Darkvision is not modelled; sight is declared per pair of creatures rather than derived from light and senses',
  ],
};

/**
 * SRD Spider Climb:
 *
 * > _Level 2 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "Until the spell ends, one willing creature you touch gains the ability to
 * > move up, down, and across vertical surfaces and along ceilings, while
 * > leaving its hands free. The target also gains a Climb Speed equal to its
 * > Speed."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 */
export const SPIDER_CLIMB: SpellDefinition = {
  id: 'spider-climb',
  name: 'Spider Climb',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'climbing walls and ceilings, and the Climb Speed, are not applied; the engine tracks one Speed and no movement modes',
  ],
};

/**
 * SRD Misty Step:
 *
 * > _Level 2 Conjuration._ **Casting Time:** Bonus Action. **Range:** Self.
 * > **Duration:** Instantaneous.
 * > "Briefly surrounded by silvery mist, you teleport up to 30 feet to an
 * > unoccupied space you can see."
 */
export const MISTY_STEP: SpellDefinition = {
  id: 'misty-step',
  name: 'Misty Step',
  level: 2,
  school: 'conjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  // Range: Self, so the caster is the target and the thirty feet are the
  // teleport's own rather than a reach to somebody else — the split Produce
  // Flame already draws between `range` and an activation's.
  targets: { count: 1, self: true },
  effects: [{ kind: 'teleport', feet: 30, requiresSight: true }],
};

/**
 * SRD Dimension Door:
 *
 * > _Level 4 Conjuration._ **Casting Time:** Action. **Range:** 500 feet.
 * > **Duration:** Instantaneous.
 * > "You teleport to a location within range. You arrive at exactly the spot
 * > desired. It can be a place you can see, one you can visualize, or one you
 * > can describe by stating distance and direction, such as "200 feet straight
 * > downward" or "300 feet upward to the northwest at a 45-degree angle.""
 * > "You can also teleport one willing creature. The creature must be within 5
 * > feet of you when you teleport, and it teleports to a space within 5 feet
 * > of your destination space."
 * > "If you, the other creature, or both would arrive in a space occupied by a
 * > creature or completely filled by one or more objects, you and any creature
 * > traveling with you each take 4d6 Force damage, and the teleportation
 * > fails."
 *
 * The first paragraph is the whole of what this executes, and the printed
 * sight clause is the **absence** of a requirement rather than one: a spot
 * described by distance and direction is a legal destination, so no sight is
 * demanded and Misty Step's `requiresSight` is what tells the two apart.
 */
export const DIMENSION_DOOR: SpellDefinition = {
  id: 'dimension-door',
  name: 'Dimension Door',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 500 },
  targets: { count: 1, self: true },
  effects: [{ kind: 'teleport', feet: 500 }],
  unmodelled: [
    'the willing creature who comes along is not teleported: it arrives "within 5 feet of your destination space", which is a second destination for a second creature, and a spell applies one effect list to every target it names',
    'the 4d6 Force damage on a failed arrival is not dealt: the engine refuses an occupied destination before the slot is spent, where the SRD spends it and hurts everybody travelling',
  ],
};

/**
 * SRD Tree Stride:
 *
 * > _Level 5 Conjuration._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "You gain the ability to enter a tree and move from inside it to inside
 * > another tree of the same kind within 500 feet. Both trees must be living
 * > and at least the same size as you. You must use 5 feet of movement to
 * > enter a tree. You instantly know the location of all other trees of the
 * > same kind within 500 feet and, as part of the move used to enter the tree,
 * > can either pass into one of those trees or step out of the tree you're in.
 * > You appear in a spot of your choice within 5 feet of the destination tree,
 * > using another 5 feet of movement. If you have no movement left, you appear
 * > within 5 feet of the tree you entered."
 * > "You can use this transportation ability only once on each of your turns.
 * > You must end each turn outside a tree."
 *
 * **Tracked, and teleportation is not what blocks it.** Every clause of the
 * ability hangs on *being inside a tree* — a place the world model has no room
 * for, the same state Meld into Stone's whole paragraph hangs on — and the
 * relocation it performs is one the SRD charges 5 feet of movement for, which
 * is the opposite of what a teleport costs. So the engine casts it for real,
 * takes the action, spends the slot, holds the Concentration and ends it after
 * its minute; where the druid comes out is the table's.
 */
export const TREE_STRIDE: SpellDefinition = {
  id: 'tree-stride',
  name: 'Tree Stride',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'entering and leaving a tree is not performed: a tree is not a thing the world model holds, so "inside a tree" is a state nothing can sit in and the 500 feet between two of them has nothing to measure',
    'the 5 feet of movement each step costs is not charged, and the once-per-turn limit has nothing to count, because the step itself has no representation',
  ],
};

/**
 * SRD Disguise Self:
 *
 * > _Level 1 Illusion._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** 1 hour.
 * > "You make yourself—including your clothing, armor, weapons, and other
 * > belongings on your person—look different until the spell ends."
 */
export const DISGUISE_SELF: SpellDefinition = {
  id: 'disguise-self',
  name: 'Disguise Self',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  // SRD: "To discern that you are disguised, a creature must take the Study
  // action to inspect your appearance and succeed on an Intelligence
  // (Investigation) check against your spell save DC." The table decides that
  // somebody looked closely; the engine owns the roll and the number it beats.
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the caster looks like is the DM’s, and so is whether a creature thinks to inspect them',
    'the illusion failing physical inspection — objects passing through a hat that is not there — is the DM’s',
  ],
};

/**
 * SRD Comprehend Languages:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** 1 hour.
 * > "For the duration, you understand the literal meaning of any language that
 * > you hear or see signed."
 */
export const COMPREHEND_LANGUAGES: SpellDefinition = {
  id: 'comprehend-languages',
  name: 'Comprehend Languages',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'understanding a language is the DM’s; the engine records which languages a character knows but nothing reads them in play',
  ],
};

/**
 * SRD Water Breathing:
 *
 * > _Level 3 Transmutation (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** 30 feet. **Duration:** 24 hours.
 * > "This spell grants up to ten willing creatures of your choice within range
 * > the ability to breathe underwater until the spell ends."
 */
/**
 * SRD Web:
 *
 * > _Level 2 Conjuration (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 hour.
 * > "You conjure a mass of sticky webbing at a point within range. The webs
 * > fill a 20-foot Cube there for the duration."
 * > "**The first time a creature enters the webs on a turn or starts its turn
 * > there**, it must succeed on a Dexterity saving throw or have the
 * > Restrained condition while in the webs or until it breaks free."
 * > "A creature Restrained by the webs can take an action to make a Strength
 * > (Athletics) check against your spell save DC. If it succeeds, it is no
 * > longer Restrained."
 *
 * **The casting does nothing at all**, and that is the point of it here: the
 * webs simply appear, and every save Web ever calls for comes from the
 * trigger. A creature already standing in the Cube when it is conjured is not
 * caught by it — nothing in the text says so — which is why `effects` is empty
 * and the record is on nobody.
 *
 * **The cap is on the entry and not on the creature.** "The first time a
 * creature enters the webs on a turn" bounds entering; starting your turn
 * there is the other half of the sentence and is not entering, so a creature
 * that begins its turn in the webs, tears out and walks back in saves twice.
 * Insect Plague's "only once per turn" is the other reading, and the pair is
 * the only place the difference is visible.
 */
export const WEB: SpellDefinition = {
  id: 'web',
  name: 'Web',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 20, origin: 'point' },
  effects: [],
  areaTrigger: {
    at: 'start-of-turn',
    onEntry: 'first-per-turn',
    label: 'Web (the webbing)',
    effects: [
      {
        kind: 'save',
        ability: 'dex',
        condition: 'restrained',
        check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
      },
    ],
  },
  durationSeconds: 3600,
  unmodelled: [
    'Restrained by the webs lasts "while in the webs", and a condition that ends when its holder walks out of an area has no shape here: it runs until the casting ends or the creature breaks free',
    'the webs are Difficult Terrain and the area within them Lightly Obscured',
    'the webs collapsing when they are not anchored between two solid masses, which is a fact about the room',
    'the webs being flammable, and the 2d4 Fire damage a burning cube deals',
  ],
};

/**
 * SRD Stinking Cloud:
 *
 * > _Level 3 Conjuration (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a 20-foot-radius Sphere of yellow, nauseating gas centered on
 * > a point within range. The cloud is Heavily Obscured. The cloud lingers in
 * > the air for the duration or until a strong wind (such as the one created
 * > by _Gust of Wind_) disperses it."
 * > "Each creature that starts its turn in the Sphere must succeed on a
 * > Constitution saving throw or have the Poisoned condition **until the end
 * > of the current turn**. While Poisoned in this way, the creature can't take
 * > an action or a Bonus Action."
 *
 * **The casting does nothing at all**, exactly as Web's does: the gas simply
 * appears, and every save the spell ever calls for comes from the trigger. A
 * creature already standing in the Sphere when it is conjured is not caught by
 * it, because nothing in the text says so.
 *
 * **It prints one clause and takes one field.** "Starts its turn" is the
 * boundary and there is no entry clause and no once-per-turn cap, so `onEntry`
 * and `oncePerTurn` are both absent — a cloud next door must not lend this
 * spell a sentence it does not print, and `area-triggers.test.ts` holds all
 * three fields against this paragraph out of the parsed book.
 *
 * **The Poisoned is the first consumer of `end-of-current-turn`.** The clause
 * fires at a *start-of-turn* boundary, so the turn it ends at is the poisoned
 * creature's own and the condition lasts exactly that creature's turn — which
 * is the whole of what the spell does to them. `end-of-casters-next-turn`
 * would have been a round or more out and anchored to the wrong creature
 * entirely, and the casting's own minute would have left the gas poisoning
 * somebody for the rest of the fight.
 *
 * It carries **no** `perSlotLevelAbove` and no `durationAtSlot`: the spell
 * prints no _Using a Higher-Level Spell Slot_ line, so a level 9 casting is
 * the same cloud for the same minute.
 */
export const STINKING_CLOUD: SpellDefinition = {
  id: 'stinking-cloud',
  name: 'Stinking Cloud',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [],
  areaTrigger: {
    at: 'start-of-turn',
    label: 'Stinking Cloud (the gas)',
    effects: [
      {
        kind: 'save',
        ability: 'con',
        condition: 'poisoned',
        lasts: 'end-of-current-turn',
      },
    ],
  },
  durationSeconds: 60,
  unmodelled: [
    'a creature Poisoned by the gas "can\'t take an action or a Bonus Action", which is an action the spell forbids rather than a condition the engine names',
    'the cloud is Heavily Obscured, and obscurement is not modelled',
    'a strong wind dispersing the cloud, which is a fact about the weather rather than a consequence the engine records',
  ],
};

export const WATER_BREATHING: SpellDefinition = {
  id: 'water-breathing',
  name: 'Water Breathing',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 10 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'breathing underwater is the DM’s; suffocation is not modelled',
  ],
};

/**
 * SRD Speak with Animals:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "For the duration, you can comprehend and verbally communicate with
 * > Beasts, and you can use any of the Influence action's skill options with
 * > them."
 */
export const SPEAK_WITH_ANIMALS: SpellDefinition = {
  id: 'speak-with-animals',
  name: 'Speak with Animals',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'what a Beast says is the DM’s',
    'the Influence action and its skill options are not modelled',
  ],
};

/**
 * SRD Jump:
 *
 * > _Level 1 Transmutation._ **Casting Time:** Bonus Action. **Range:** Touch.
 * > **Duration:** 1 minute.
 * > "You touch a willing creature. Once on each of its turns until the spell
 * > ends, that creature can jump up to 30 feet by spending 10 feet of
 * > movement."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const JUMP: SpellDefinition = {
  id: 'jump',
  name: 'Jump',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  // "A willing creature" you touch includes you, which Guidance and Mage
  // Armor are already transcribed as — and which SRD says of this spell in as
  // many words from the other end: Ring of Jumping casts Jump "but can target
  // only yourself when you do so", a sentence with no meaning if the caster
  // were not a legal target of it.
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the 30-foot jump for 10 feet of movement is not applied; jumping is not modelled, and the once-per-turn limit has nothing to count',
  ],
};

/**
 * SRD Prestidigitation:
 *
 * > _Transmutation Cantrip._ **Casting Time:** Action. **Range:** 10 feet.
 * > **Duration:** Up to 1 hour.
 * > "You create a magical effect within range."
 */
export const PRESTIDIGITATION: SpellDefinition = {
  id: 'prestidigitation',
  name: 'Prestidigitation',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'every one of the listed effects — a sensory effect, lighting or snuffing a flame, cleaning or soiling an object, chilling or warming, a mark, a trinket — is the DM’s',
    'the limit of three effects at once, and dismissing one as an action, are not tracked',
  ],
};

// — the second tracked batch: the rest of the utility bucket that honestly fits —
//
// Audited one at a time against the SRD text rather than filed by shape. A
// spell lands here only when everything mechanically authoritative about it is
// already the engine's — the action, the slot, Concentration, the deadline,
// the range and the target count — and everything left over is fiction, an
// object, a place or a piece of information that the table owns and always
// will.
//
// The ones that did *not* land are the point of the audit. A spell carrying an
// ability check, a saving throw, damage, healing, an Armour Class, a Speed, a
// Resistance or a condition is **not** tracked, because putting those in
// `unmodelled` would be the engine calling a rule the DM's when it is really a
// shape nobody has built. `spell-tracking.test.ts` holds that line
// mechanically: it reads each tracked spell's own SRD prose and demands a
// written adjudication for every mechanical clause it finds there.

/**
 * SRD Arcane Lock:
 *
 * > _Level 2 Abjuration (Wizard)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Until dispelled.
 * > "You touch a closed door, window, gate, container, or hatch and magically
 * > lock it for the duration. This lock can't be unlocked by any nonmagical
 * > means."
 */
export const ARCANE_LOCK: SpellDefinition = {
  id: 'arcane-lock',
  name: 'Arcane Lock',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the spell locks an object, and objects are not modelled: which door was touched, who may open it despite the lock, and the password are the DM’s',
    'a duration of “Until dispelled” is no deadline at all, so no timer is scheduled and the casting simply runs; Dispel Magic executes, and cannot reach this one, because it ends an ongoing spell **on a target** and this casting is on a door',
  ],
};

/**
 * SRD Continual Flame:
 *
 * > _Level 2 Evocation (Cleric, Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Until dispelled.
 * > "A flame springs from an object that you touch. The effect casts Bright
 * > Light in a 20-foot radius and Dim Light for an additional 20 feet."
 */
export const CONTINUAL_FLAME: SpellDefinition = {
  id: 'continual-flame',
  name: 'Continual Flame',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the flame springs from an object, and objects are not modelled: which object was touched is the DM’s',
    'Bright Light in a 20-foot radius and Dim Light beyond it are not applied; the engine has no lighting, exactly as it has none for Light',
    'a duration of “Until dispelled” is no deadline at all, so no timer is scheduled and the casting simply runs',
  ],
};

/**
 * SRD Create Food and Water:
 *
 * > _Level 3 Conjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "You create 45 pounds of food and 30 gallons of fresh water on the ground
 * > or in containers within range."
 */
export const CREATE_FOOD_AND_WATER: SpellDefinition = {
  id: 'create-food-and-water',
  name: 'Create Food and Water',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the food and the water are objects, and objects are not modelled; malnutrition, dehydration and the 24 hours after which the food spoils are the DM’s',
  ],
};

/**
 * SRD Demiplane:
 *
 * > _Level 8 Conjuration (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** 1 hour.
 * > "You create a shadowy Medium door on a flat solid surface that you can see
 * > within range. This door can be opened and closed, and it leads to a
 * > demiplane that is an empty room 30 feet in each dimension."
 */
export const DEMIPLANE: SpellDefinition = {
  id: 'demiplane',
  name: 'Demiplane',
  level: 8,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the door and the room behind it are a second place, and the engine holds one scene: who is inside the demiplane, and what is in it, are the DM’s',
    'a creature that opts to be shunted out as the door vanishes lands Prone, and the DM applies that with applyConditionTo — nothing in state says who was inside',
    'connecting the door to a demiplane made by an earlier casting, or by somebody else, is the DM’s',
  ],
};

/**
 * SRD Detect Evil and Good:
 *
 * > _Level 1 Divination (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the location of any Aberration, Celestial,
 * > Elemental, Fey, Fiend, or Undead within 30 feet of yourself."
 *
 * Creature type *is* authoritative state, so the engine could in principle say
 * which of those are nearby — but what the caster is *told* is information
 * delivered into the fiction, and the blocking rule is a fact about walls the
 * engine deliberately does not model.
 */
export const DETECT_EVIL_AND_GOOD: SpellDefinition = {
  id: 'detect-evil-and-good',
  name: 'Detect Evil and Good',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'what the caster senses is narration: the engine knows a creature’s type but reports nothing, and a creature nobody has typed has nothing to report',
    'sensing whether the Hallow spell is active is the DM’s',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s, because walls are declared rather than modelled',
  ],
};

/**
 * SRD Detect Poison and Disease:
 *
 * > _Level 1 Divination (Ritual) (Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action or Ritual. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the location of poisons, poisonous or
 * > venomous creatures, and magical contagions within 30 feet of yourself."
 */
export const DETECT_POISON_AND_DISEASE: SpellDefinition = {
  id: 'detect-poison-and-disease',
  name: 'Detect Poison and Disease',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'poisons, venomous creatures and magical contagions are not modelled, and what the caster senses is narration',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s',
  ],
};

/**
 * SRD Find Traps:
 *
 * > _Level 2 Divination (Cleric, Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You sense any trap within range that is within line of sight... This
 * > spell reveals that a trap is present but not its location."
 */
export const FIND_TRAPS: SpellDefinition = {
  id: 'find-traps',
  name: 'Find Traps',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'traps are not modelled — neither a mechanism nor a Glyph of Warding is a thing in state — so whether one is in range, and the general nature of the danger, are the DM’s',
  ],
};

/**
 * SRD Floating Disk:
 *
 * > _Level 1 Conjuration (Ritual) (Wizard)._ **Casting Time:** Action or
 * > Ritual. **Range:** 30 feet. **Duration:** 1 hour.
 * > "This spell creates a circular, horizontal plane of force, 3 feet in
 * > diameter and 1 inch thick, that floats 3 feet above the ground in an
 * > unoccupied space of your choice that you can see within range."
 */
export const FLOATING_DISK: SpellDefinition = {
  id: 'floating-disk',
  name: 'Floating Disk',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the disk is an object and objects are not modelled: where it is, the 500 pounds it holds, and what is riding on it are the DM’s',
    'the disk following the caster within 20 feet, refusing an elevation change of 10 feet or more, and the spell ending beyond 100 feet are all the DM’s',
  ],
};

/**
 * SRD Gentle Repose:
 *
 * > _Level 2 Necromancy (Ritual) (Cleric, Paladin, Wizard)._
 * > **Casting Time:** Action or Ritual. **Range:** Touch.
 * > **Duration:** 10 days.
 * > "You touch a corpse or other remains. For the duration, the target is
 * > protected from decay and can't become Undead."
 *
 * Ten days is 864,000 seconds. The clock counts seconds precisely so that a
 * duration this long is subtraction rather than a special case.
 */
export const GENTLE_REPOSE: SpellDefinition = {
  id: 'gentle-repose',
  name: 'Gentle Repose',
  level: 2,
  school: 'necromancy',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 864_000,
  unmodelled: [
    'the target is a corpse or other remains, which is an object rather than a creature in state: which remains were touched is the DM’s',
    'decay, becoming Undead, and the time limit this extends on raising the dead are the DM’s — no spell the engine executes raises anybody',
  ],
};

/**
 * SRD Knock:
 *
 * > _Level 2 Transmutation (Bard, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A target that is held shut by a mundane lock or that is stuck or barred
 * > becomes unlocked, unstuck, or unbarred."
 */
export const KNOCK: SpellDefinition = {
  id: 'knock',
  name: 'Knock',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the spell opens an object, and objects are not modelled: which lock, whether it had several, and whether it was barred are the DM’s',
    'suppressing an Arcane Lock for 10 minutes is the DM’s — that casting is tracked rather than executed, so nothing reads it',
    'the loud knock audible 300 feet away is the DM’s',
  ],
};

/**
 * SRD Locate Animals or Plants:
 *
 * > _Level 2 Divination (Ritual) (Bard, Druid, Ranger)._ **Casting Time:**
 * > Action or Ritual. **Range:** Self. **Duration:** Instantaneous.
 * > "Describe or name a specific kind of Beast, Plant creature, or nonmagical
 * > plant. You learn the direction and distance to the closest creature or
 * > plant of that kind within 5 miles, if any are present."
 */
export const LOCATE_ANIMALS_OR_PLANTS: SpellDefinition = {
  id: 'locate-animals-or-plants',
  name: 'Locate Animals or Plants',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'what is within 5 miles is the DM’s: the engine holds one scene, and a creature off it is not a creature at a distance',
  ],
};

/**
 * SRD Locate Creature:
 *
 * > _Level 4 Divination (Bard, Cleric, Druid, Paladin, Ranger, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 hour.
 * > "Describe or name a creature that is familiar to you. You sense the
 * > direction to the creature's location if that creature is within 1,000 feet
 * > of you."
 */
export const LOCATE_CREATURE: SpellDefinition = {
  id: 'locate-creature',
  name: 'Locate Creature',
  level: 4,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the spell names a creature in prose rather than taking an id, and what the caster senses is narration; once a creature is off the scene, whether it is within 1,000 feet is the DM’s',
    'the spell failing against a creature in a different form, and being blocked by any thickness of lead, are the DM’s',
  ],
};

/**
 * SRD Locate Object:
 *
 * > _Level 2 Divination (Bard, Cleric, Druid, Paladin, Ranger, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "Describe or name an object that is familiar to you. You sense the
 * > direction to the object's location if that object is within 1,000 feet of
 * > you."
 */
export const LOCATE_OBJECT: SpellDefinition = {
  id: 'locate-object',
  name: 'Locate Object',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'objects are not modelled and have no position, so where the object is — and whether it is moving — is the DM’s',
    'being blocked by any thickness of lead is the DM’s',
  ],
};

/**
 * SRD Message:
 *
 * > _Transmutation Cantrip (Bard, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet. **Duration:** 1 round.
 * > "You point toward a creature within range and whisper a message. The
 * > target (and only the target) hears the message and can reply in a whisper
 * > that only you can hear."
 *
 * A round is six seconds — SRD, "A round represents about 6 seconds" — and
 * that is a span of time rather than a moment in the turn order, so it is a
 * `durationSeconds` and not a `durationUntil`. The distinction matters
 * elsewhere and is free here: nothing hangs on the deadline but the casting.
 */
export const MESSAGE: SpellDefinition = {
  id: 'message',
  name: 'Message',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 6,
  unmodelled: [
    'what is said, and what is whispered back, are the DM’s',
    'SRD lets this one spell be cast through a solid object at a familiar target; the engine refuses a target behind Total Cover as it does for every spell, and the exception is not expressible',
    'magical silence, and the foot of stone, metal or wood or thin sheet of lead that blocks it, are the DM’s',
  ],
};

/**
 * SRD Move Earth:
 *
 * > _Level 6 Transmutation (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 120 feet. **Duration:** Concentration, up to 2 hours.
 * > "Choose an area of terrain no larger than 40 feet on a side within range.
 * > You can reshape dirt, sand, or clay in the area in any manner you choose
 * > for the duration."
 */
export const MOVE_EARTH: SpellDefinition = {
  id: 'move-earth',
  name: 'Move Earth',
  level: 6,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 7200,
  unmodelled: [
    'terrain has no elevation in the engine: raising, lowering, trenching and walling the ground, and the 10 minutes the change takes, are all the DM’s',
    'choosing a new area every 10 minutes of Concentration is the DM’s',
    'whether a structure the reshaped ground undermines collapses is the DM’s',
  ],
};

/**
 * SRD Nondetection:
 *
 * > _Level 3 Abjuration (Bard, Ranger, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 8 hours.
 * > "For the duration, you hide a target that you touch from Divination
 * > spells... The target can't be targeted by any Divination spell or
 * > perceived through magical scrying sensors."
 *
 * The clause that would be a rule excludes nothing the engine can be asked
 * about: every Divination spell the engine has a definition for is cast at
 * Self or at no creature at all, so "can't be targeted by any Divination
 * spell" has no reachable case. Same reasoning as Counterspell's components
 * clause — a rule whose only answer is "not applicable" is documented rather
 * than modelled.
 */
export const NONDETECTION: SpellDefinition = {
  id: 'nondetection',
  name: 'Nondetection',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'being hidden from Divination spells excludes nothing the engine can be asked about: every Divination spell it defines is cast at Self or at no creature, so the rule has no reachable case',
    'scrying sensors are not modelled, and a place or an object as the target is not a creature in state',
  ],
};

/**
 * SRD Passwall:
 *
 * > _Level 5 Transmutation (Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 1 hour.
 * > "A passage appears at a point that you can see on a wooden, plaster, or
 * > stone surface (such as a wall, ceiling, or floor) within range and lasts
 * > for the duration."
 */
export const PASSWALL: SpellDefinition = {
  id: 'passwall',
  name: 'Passwall',
  level: 5,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'walls are declared rather than modelled — deliberately, because computing them is where a rules engine becomes a map editor — so the passage and its dimensions are the DM’s',
    'ejecting whatever is still in the passage when it closes is the DM’s',
  ],
};

/**
 * SRD Plane Shift:
 *
 * > _Level 7 Conjuration (Cleric, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "You and up to eight willing creatures who link hands in a circle are
 * > transported to a different plane of existence."
 *
 * Eight, not nine: the SRD counts the caster separately, so `self` stays off
 * and the target rule is the creatures who go with them.
 */
export const PLANE_SHIFT: SpellDefinition = {
  id: 'plane-shift',
  name: 'Plane Shift',
  level: 7,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 8 },
  effects: [],
  unmodelled: [
    'planes of existence are not modelled and the engine holds one scene, so nobody is moved: where the party arrives is the DM’s',
    'arriving at a teleportation circle from its sigil sequence is the DM’s',
  ],
};

/**
 * SRD Remove Curse:
 *
 * > _Level 3 Abjuration (Cleric, Paladin, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "At your touch, all curses affecting one creature or object end."
 */
export const REMOVE_CURSE: SpellDefinition = {
  id: 'remove-curse',
  name: 'Remove Curse',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  unmodelled: [
    'a curse is not a thing in state — nothing the engine applies is one — so which curses end is the DM’s',
    'Attunement is not modelled, so breaking it to a cursed magic item is the DM’s',
  ],
};

/**
 * SRD Rope Trick:
 *
 * > _Level 2 Transmutation (Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a rope... At the rope's upper end, an Invisible 3-foot-by-5-foot
 * > portal opens to an extradimensional space that lasts until the spell ends."
 */
export const ROPE_TRICK: SpellDefinition = {
  id: 'rope-trick',
  name: 'Rope Trick',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the rope is an object and the space above it is a second place; the engine holds one scene, so who has climbed in is the DM’s',
    'the eight Medium creatures it holds, and the rule that attacks and spells cannot cross the portal, are the DM’s',
  ],
};

/**
 * SRD See Invisibility:
 *
 * > _Level 2 Divination (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 1 hour.
 * > "For the duration, you see creatures and objects that have the Invisible
 * > condition as if they were visible, and you can see into the Ethereal
 * > Plane."
 *
 * The one clause that touches a modelled rule is the one the engine already
 * answers the right way round. Sight is **declared pairwise** — `sight[from|to]`
 * — and the Invisible condition's effect is context-dependent on whether the
 * observer can see, so a table whose caster can now see an invisible creature
 * declares that sight and every roll downstream reads it. That is existing
 * machinery used at the table, not machinery that is missing.
 */
export const SEE_INVISIBILITY: SpellDefinition = {
  id: 'see-invisibility',
  name: 'See Invisibility',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'seeing a creature with the Invisible condition is declared rather than derived: the table declares the caster’s sight of it, and the condition’s own effects read that declaration',
    'the Ethereal Plane is not modelled, so what appears ghostly there is the DM’s',
  ],
};

/**
 * SRD Speak with Dead:
 *
 * > _Level 3 Necromancy (Bard, Cleric, Wizard)._ **Casting Time:** Action.
 * > **Range:** 10 feet. **Duration:** 10 minutes.
 * > "You grant the semblance of life to a corpse of your choice within range,
 * > allowing it to answer questions you pose."
 */
export const SPEAK_WITH_DEAD: SpellDefinition = {
  id: 'speak-with-dead',
  name: 'Speak with Dead',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the target is a corpse rather than a creature in state: whether it has a mouth, whether the deceased was Undead, and whether it was questioned within the past 10 days are the DM’s',
    'the five questions and what the corpse says are the DM’s, truthfulness included',
  ],
};

/**
 * SRD Stone Shape:
 *
 * > _Level 4 Transmutation (Cleric, Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "You touch a stone object of Medium size or smaller or a section of stone
 * > no more than 5 feet in any dimension and form it into any shape you like."
 */
/**
 * SRD Spirit Guardians:
 *
 * > _Level 3 Conjuration (Cleric)._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "Protective spirits flit around you in a 15-foot Emanation for the
 * > duration. ... When you cast this spell, you can designate creatures to be
 * > unaffected by it. Any other creature's Speed is halved in the Emanation,
 * > and **whenever the Emanation enters a creature's space** and whenever a
 * > creature enters the Emanation or ends its turn there, the creature must
 * > make a Wisdom saving throw. On a failed save, the creature takes 3d8
 * > Radiant damage (if you are good or neutral) or 3d8 Necrotic damage (if you
 * > are evil). On a successful save, the creature takes half as much damage. A
 * > creature makes this save only once per turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 3."
 *
 * **The spell that proves an area can be carried.** Moonbeam's Cylinder is a
 * point the casting keeps and a Magic action moves; this Emanation is centred
 * on the caster and moves because the caster does — which is not a Spirit
 * Guardians rule at all but the definition of the shape. SRD's glossary: "An
 * Emanation **moves with the creature or object that is its origin** unless it
 * is an instantaneous or a stationary effect."
 *
 * So nothing here records where the aura is. `area.origin: 'self'` plus the
 * casting's own `caster` is the whole of it, and membership is asked of the
 * caster's live position every time — see `creaturesInCastingArea`.
 *
 * **There is no initial-appearance clause, and that is the text rather than a
 * simplification.** Moonbeam prints "When the Cylinder appears, each creature
 * in it makes a Constitution saving throw" and Cloudkill "Each creature in the
 * Sphere makes a Constitution saving throw"; Spirit Guardians prints no such
 * sentence. Its three triggers are the Emanation entering a space, a creature
 * entering the Emanation, and a creature ending its turn there — so a creature
 * already standing beside the cleric when the spirits appear takes nothing
 * until one of those happens, which for a creature that stays put is the end
 * of its own turn. `effects: []` is that reading, and Web's precedent for it.
 *
 * `onEntry: 'every-entry'` is likewise the text: "whenever a creature enters
 * the Emanation", with no "first time on a turn". The cap that makes it behave
 * like Insect Plague's is the separate "only once per turn" sentence, which
 * caps the creature across all three clauses.
 *
 * What this definition does **not** do is stated in `unmodelled` and counted
 * against it: the halved Speed inside the Emanation is a standing spatial
 * effect rather than a trigger, and needs a primitive the engine has not
 * built.
 */
export const SPIRIT_GUARDIANS: SpellDefinition = {
  id: 'spirit-guardians',
  name: 'Spirit Guardians',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'emanation', distance: 15, origin: 'self' },
  // "you can designate creatures to be unaffected by it"
  designatesUnaffected: true,
  // "3d8 Radiant damage (if you are good or neutral) or 3d8 Necrotic damage
  // (if you are evil)" — decided by the caster's alignment, which the engine
  // does not hold for every creature and will not guess.
  damageTypeStated: ['radiant', 'necrotic'],
  // The spirits appear and nothing happens yet; every save this spell ever
  // calls for comes from one of the three clauses below.
  effects: [],
  durationSeconds: 600,
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    onAreaEntry: true,
    oncePerTurn: true,
    label: 'Spirit Guardians (the spirits)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
        damageType: 'radiant',
        onSuccess: 'half',
      },
    ],
  },
  unmodelled: [
    'the halved Speed of every unaffected-list creature inside the Emanation: a standing spatial effect rather than a trigger, and the engine has no primitive that derives a Speed from where a creature is standing',
    'whether the spirits look angelic, fey or fiendish, which the SRD makes the caster’s choice and is narration',
  ],
};


/**
 * SRD Spiritual Weapon:
 *
 * > _Level 2 Evocation (Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a floating, spectral force that resembles a weapon of your
 * > choice and lasts for the duration. The force appears within range in a
 * > space of your choice, and you can immediately make one melee spell attack
 * > against one creature within 5 feet of the force. On a hit, the target takes
 * > Force damage equal to 1d8 plus your spellcasting ability modifier.
 * >
 * > As a Bonus Action on your later turns, you can move the force up to 20 feet
 * > and repeat the attack against a creature within 5 feet of it."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for every
 * > slot level above 2."
 *
 * **The spell that proves a casting can hold a point**, and the one worth
 * reading for what it does *not* say. Nothing here gives the force an Armour
 * Class, Hit Points, a space it occupies, an action of its own, or a name
 * anything else could address. Unseen Servant and Arcane Hand print every one
 * of those in the same book; this prints none, so the force is a coordinate on
 * the casting rather than a creature, an object or a world entity.
 *
 * Three numbers, three homes, and they are not interchangeable:
 *
 * | SRD | Here | Measured from |
 * |---|---|---|
 * | "within range in a space of your choice" | `range` | the caster |
 * | "one creature within 5 feet of the force" | `origin.reach` | the force |
 * | "move the force up to 20 feet" | `origin.movableBy` | the force, now |
 *
 * **2024 gives this spell Concentration**, which 2014 did not. The whole point
 * of quoting the text is that the difference is not recalled.
 */
export const SPIRITUAL_WEAPON: SpellDefinition = {
  id: 'spiritual-weapon',
  name: 'Spiritual Weapon',
  level: 2,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "you **can** immediately make one melee spell attack": the force appears
  // whether or not there is anything standing next to it.
  targets: { count: 1, optional: true },
  origin: { reach: 5, movableBy: 20 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '1d8', perSlotLevelAbove: '1d8' },
      damageType: 'force',
      addSpellcastingModifier: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    action: 'bonus-action',
    // No `range`: the five feet are measured from the force, and `origin.reach`
    // is where that number lives. Two fields saying five would be two places to
    // get one sentence wrong.
    label: 'Spiritual Weapon (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '1d8', perSlotLevelAbove: '1d8' },
        damageType: 'force',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'what the force looks like — "a weapon of your choice" — is narration, and nothing mechanical reads it',
  ],
};

/**
 * SRD Arcane Sword:
 *
 * > _Level 7 Evocation (Bard, Wizard)._ **Casting Time:** Action.
 * > **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a spectral sword that hovers within range. It lasts for the
 * > duration.
 * >
 * > When the sword appears, you make a melee spell attack against a target
 * > within 5 feet of the sword. On a hit, the target takes Force damage equal
 * > to 4d12 plus your spellcasting ability modifier.
 * >
 * > On your later turns, you can take a Bonus Action to move the sword up to
 * > 30 feet to a spot you can see and repeat the attack against the same
 * > target or a different one."
 *
 * **The second user of {@link CastingOrigin}**, and it needed nothing new,
 * which is what a second user is for. It prints the same three numbers in the
 * same three places Spiritual Weapon does — the Range that says where the
 * point may first be put, the reach the attack is measured by, and the
 * allowance a later turn may move it — and it prints them for a different
 * caster, a different action and a different die.
 *
 * Two differences from Spiritual Weapon are transcription rather than shape,
 * and both are the sort a neighbouring definition lends by habit:
 *
 * - **"you make", not "you can".** Spiritual Weapon's force appears whether or
 *   not anything is standing beside it, which is exactly what
 *   {@link TargetRule.optional} is for. This sentence names the attack without
 *   that word, so the casting takes a target like any other spell.
 * - **It does not scale.** The SRD prints no *Using a Higher-Level Spell Slot*
 *   line for this spell at all, so 4d12 cast from a level 9 slot is still
 *   4d12. A `perSlotLevelAbove` copied from the definition above would be a
 *   number the book never printed, and nothing but a test comparing two slot
 *   levels would ever have said so.
 */
export const ARCANE_SWORD: SpellDefinition = {
  id: 'arcane-sword',
  name: 'Arcane Sword',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  // "you **make** a melee spell attack": no `optional`, which is the word
  // Spiritual Weapon prints and this spell does not.
  targets: { count: 1 },
  // "within 5 feet of the sword"; "move the sword up to 30 feet".
  origin: { reach: 5, movableBy: 30 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      // "Force damage equal to 4d12 plus your spellcasting ability modifier",
      // and no higher-level line, so no `perSlotLevelAbove`.
      damage: { dice: '4d12' },
      damageType: 'force',
      addSpellcastingModifier: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    // "you can take a Bonus Action to move the sword ... and repeat the
    // attack": one action that moves and strikes, which is `origin.movableBy`
    // rather than `activation.movesArea`.
    action: 'bonus-action',
    // No `range`: the five feet are measured from the sword, and `origin.reach`
    // is where that number lives.
    label: 'Arcane Sword (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '4d12' },
        damageType: 'force',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'moving the sword "to a spot you can see" is not verified: sight is a declared fact between two creatures, a destination is a coordinate rather than a creature, and whether the caster can see the space is the DM’s',
  ],
};

export const STONE_SHAPE: SpellDefinition = {
  id: 'stone-shape',
  name: 'Stone Shape',
  level: 4,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'stone objects and stone surfaces are not modelled, so what is shaped, and what the new shape does, are the DM’s',
  ],
};

/**
 * SRD Telepathic Bond:
 *
 * > _Level 5 Divination (Ritual) (Bard, Wizard)._ **Casting Time:** Action or
 * > Ritual. **Range:** 30 feet. **Duration:** 1 hour.
 * > "You forge a telepathic link among up to eight willing creatures of your
 * > choice within range, psychically linking each creature to all the others
 * > for the duration."
 */
export const TELEPATHIC_BOND: SpellDefinition = {
  id: 'telepathic-bond',
  name: 'Telepathic Bond',
  level: 5,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 8, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'what is said through the bond is the DM’s, and the engine records which languages a character knows without reading them in play — so excluding a creature that speaks none is the DM’s too',
  ],
};

/**
 * SRD Tongues:
 *
 * > _Level 3 Divination (Bard, Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "This spell grants the creature you touch the ability to understand any
 * > spoken or signed language that it hears or sees."
 */
export const TONGUES: SpellDefinition = {
  id: 'tongues',
  name: 'Tongues',
  level: 3,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'understanding and being understood are the DM’s; the engine records which languages a character knows but nothing reads them in play',
  ],
};

/**
 * SRD Transport via Plants:
 *
 * > _Level 6 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 10
 * > feet. **Duration:** 1 minute.
 * > "This spell creates a magical link between a Large or larger inanimate
 * > plant within range and another plant, at any distance, on the same plane
 * > of existence."
 */
export const TRANSPORT_VIA_PLANTS: SpellDefinition = {
  id: 'transport-via-plants',
  name: 'Transport via Plants',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'both plants are objects and the far one is at any distance — off the scene entirely — so the link, and who steps through it, are the DM’s',
    'the 5 feet of movement a creature spends to step through is charged by the DM: the engine has no destination to move anybody to',
  ],
};

/**
 * SRD True Seeing:
 *
 * > _Level 6 Divination (Bard, Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "For the duration, the willing creature you touch has Truesight with a
 * > range of 120 feet."
 */
export const TRUE_SEEING: SpellDefinition = {
  id: 'true-seeing',
  name: 'True Seeing',
  level: 6,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'senses are not modelled: Truesight is not a thing a creature carries, and what it pierces — illusions, shapechangers, the Ethereal Plane — is the DM’s',
    'what the target can see is declared pairwise, so a table granting sight of something hidden declares it exactly as it would without this spell',
  ],
};

/**
 * SRD Wall of Force:
 *
 * > _Level 5 Evocation (Wizard)._ **Casting Time:** Action. **Range:** 120
 * > feet. **Duration:** Concentration, up to 10 minutes.
 * > "An Invisible wall of force springs into existence at a point you choose
 * > within range... Nothing can physically pass through the wall."
 *
 * Not an `area`: the shapes the engine knows are shapes a spell *catches
 * creatures in*, and this is a barrier with ten panels, an orientation and a
 * thickness. Cover and line of sight are declared rather than ray-cast for the
 * same reason, and that is a boundary the engine keeps on purpose.
 */
export const WALL_OF_FORCE: SpellDefinition = {
  id: 'wall-of-force',
  name: 'Wall of Force',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is a barrier rather than an area that catches creatures, and barriers are not modelled: where it stands, and what it separates, are the DM’s',
    'nothing being able to pass through it is the DM’s — movement does not consult walls, which is the boundary that keeps this a rules engine rather than a map editor',
    'pushing a creature whose space the wall cuts through to one side of it is the DM’s',
  ],
};

/**
 * SRD Water Walk:
 *
 * > _Level 3 Transmutation (Ritual) (Cleric, Druid, Ranger, Sorcerer)._
 * > **Casting Time:** Action or Ritual. **Range:** 30 feet.
 * > **Duration:** 1 hour.
 * > "Up to ten willing creatures of your choice within range gain this
 * > ability for the duration."
 */
export const WATER_WALK: SpellDefinition = {
  id: 'water-walk',
  name: 'Water Walk',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 10, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'liquid surfaces are not modelled: whether there is water, acid, mud or lava under the party, and what the heat of lava does, are the DM’s',
    'the Bonus Action a target spends to drop through the surface is charged by the DM, because nothing in state says the target is standing on a liquid',
  ],
};

/**
 * SRD Word of Recall:
 *
 * > _Level 6 Conjuration (Cleric)._ **Casting Time:** Action. **Range:** 5
 * > feet. **Duration:** Instantaneous.
 * > "You and up to five willing creatures within 5 feet of you instantly
 * > teleport to a previously designated sanctuary."
 *
 * Range 5 feet, which the engine checks per target like any other: a
 * companion standing ten feet away is refused. Where they *go* is a second
 * place and there is one scene, so the arrival is the DM's.
 */
export const WORD_OF_RECALL: SpellDefinition = {
  id: 'word-of-recall',
  name: 'Word of Recall',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 5 },
  targets: { count: 5 },
  effects: [],
  unmodelled: [
    'the sanctuary is a second place and the engine holds one scene, so nobody is moved: the arrival is the DM’s',
    'designating a sanctuary by an earlier casting is not recorded, so a casting with no sanctuary prepared is not refused',
  ],
};

/**
 * SRD Divine Smite:
 *
 * > _Level 1 Evocation (Paladin)._ **Casting Time:** Bonus Action, which you take
 * > immediately after hitting a target with a Melee weapon or an Unarmed
 * > Strike. **Range:** Self. **Duration:** Instantaneous.
 * > "The target takes an extra 2d8 Radiant damage from the attack. The damage
 * > increases by 1d8 if the target is a Fiend or an Undead."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 */
export const DIVINE_SMITE: SpellDefinition = {
  id: 'divine-smite',
  name: 'Divine Smite',
  level: 1,
  school: 'evocation',
  // The SRD's printed casting time is a Bonus Action with a trigger attached.
  // The trigger is the hit `resolveAttackDamage` is settling, so it is the
  // command rather than the definition that enforces it.
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [
    {
      kind: 'attack-damage',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'radiant',
      // SRD: "The damage increases by 1d8 if the target is a Fiend or an
      // Undead." A flat die rather than a scaling one — the *base* grows per
      // slot level and this sentence does not.
      againstType: { types: ['Fiend', 'Undead'], extraDice: '1d8' },
    },
  ],
};

/**
 * SRD Color Spray:
 *
 * > _Level 1 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You launch a dazzling array of flashing, colorful light. Each creature in
 * > a 15-foot Cone originating from you must succeed on a Constitution saving
 * > throw or have the Blinded condition until the end of your next turn."
 *
 * **Instantaneous, with an effect that lasts.** That combination is the whole
 * reason riders needed their own deadline: the casting is over the moment it
 * happens, so there is no casting timer for the Blinded to hang on, and before
 * `lasts` this spell could not be written down at all.
 *
 * Range: Self, so the Cone starts at the caster and — being a Cone — does not
 * include them.
 */
export const COLOR_SPRAY: SpellDefinition = {
  id: 'color-spray',
  name: 'Color Spray',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 15, origin: 'self' },
  effects: [
    {
      kind: 'save',
      ability: 'con',
      condition: 'blinded',
      lasts: 'end-of-casters-next-turn',
    },
  ],
};

/**
 * SRD Sunbeam:
 *
 * > _Level 6 Evocation (Cleric, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "You launch a sunbeam in a 5-foot-wide, 60-foot-long Line. Each creature
 * > in the Line makes a Constitution saving throw. On a failed save, a
 * > creature takes 6d8 Radiant damage and has the Blinded condition until the
 * > start of your next turn. On a successful save, it takes half as much
 * > damage only."
 *
 * The opposite proof to Color Spray. Here there *is* a casting deadline and it
 * is the wrong one by a wide margin: hanging the Blinded on the spell would
 * blind the target for a minute rather than for the part of a round the text
 * gives it. One save carries both the damage and the condition, which is why
 * the condition sits inside the `save-damage` effect rather than beside it.
 *
 * No upcast entry: SRD prints no "Using a Higher-Level Spell Slot" line for
 * Sunbeam, so a level 7 slot buys nothing but the casting.
 */
export const SUNBEAM: SpellDefinition = {
  id: 'sunbeam',
  name: 'Sunbeam',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'line', length: 60, width: 5, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '6d8' },
      damageType: 'radiant',
      onSuccess: 'half',
      conditions: [{ name: 'blinded', lasts: 'start-of-casters-next-turn' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Magic action that creates a new Line on a later turn: an activation resolves an attack at a named target and moves an area along a stated route, and resolving a **fresh** area in a direction chosen now is the shape Call Lightning waits on too',
    'the mote of radiance that sheds sunlight for the duration',
  ],
};

/**
 * Every spell the engine can resolve, **sorted by id and asserted to be**.
 *
 * Sorted because this is the one line every new spell touches, and two branches
 * that each add one should append in different places rather than fight over
 * the same hunk. `coverage.test.ts` holds the guard, along with the two things
 * a bad conflict resolution actually produces: a duplicated entry, and a spell
 * still declared above but no longer registered here.
 *
 * The definitions themselves stay in the order they were written, grouped by
 * mechanical shape. Reordering three thousand lines of them would buy nothing
 * and would itself be an unmergeable change.
 */
/**
 * SRD Minor Illusion:
 *
 * > _Illusion Cantrip (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 minute.
 * > "You create a sound or an image of an object within range that lasts for
 * > the duration."
 * > "If a creature takes a Study action to examine the sound or image, the
 * > creature can determine that it is an illusion with a successful
 * > Intelligence (Investigation) check against your spell save DC."
 *
 * The whole spell is fiction except one sentence, and that sentence is
 * arithmetic. So the casting is tracked — the action, the minute on the clock
 * — and the check the engine owns is offered against it. The cantrip is the
 * proof that the DC comes off the caster's sheet rather than off a slot: there
 * is no slot.
 */
export const MINOR_ILLUSION: SpellDefinition = {
  id: 'minor-illusion',
  name: 'Minor Illusion',
  level: 0,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  // SRD: "The illusion ends if you cast this spell again."
  replacesPriorCasting: true,
  unmodelled: [
    'what the sound or image is, and whether anybody thinks to examine it, are the DM’s',
    'the image becoming faint to a creature that saw through it is narration; the engine records the roll and nothing else changes',
    'physical interaction revealing the image, and the 5-foot Cube it fits in, are the DM’s — objects are not modelled',
  ],
};

/**
 * SRD Silent Image:
 *
 * > _Level 1 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You create the image of an object, a creature, or some other visible
 * > phenomenon that is no larger than a 15-foot Cube."
 * > "A creature that takes a Study action to examine the image can determine
 * > that it is an illusion with a successful Intelligence (Investigation)
 * > check against your spell save DC."
 *
 * Minor Illusion's Concentration cousin, and the one that proves a check
 * survives on a Concentration casting's timer: break the Concentration and the
 * image — and the check against it — are gone together, because both hang on
 * the same casting.
 */
export const SILENT_IMAGE: SpellDefinition = {
  id: 'silent-image',
  name: 'Silent Image',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the image is, where it stands, and whether anybody thinks to examine it are the DM’s',
    'the Magic action that moves the image on a later turn needs an ongoing effect a turn can act through',
    'seeing through the image is narration; the engine records the roll and nothing else changes',
  ],
};

/**
 * SRD Dispel Magic:
 *
 * > _Level 3 Abjuration (Bard, Cleric, Druid, Paladin, Ranger, Sorcerer,
 * > Warlock, Wizard)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Instantaneous.
 * > "Choose one creature, object, or magical effect within range. Any ongoing
 * > spell of level 3 or lower on the target ends. For each ongoing spell of
 * > level 4 or higher on the target, make an ability check using your
 * > spellcasting ability (DC 10 plus that spell's level). On a successful
 * > check, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You automatically end a spell on the
 * > target if the spell's level is equal to or less than the level of the
 * > spell slot you use."
 *
 * **The definition carries no numbers**, and that is the whole point of it.
 * The threshold is the level this casting was made at, the DC is ten plus the
 * level of whatever is being ended, and both of those are facts the engine
 * holds about castings that are still running. A definition that restated
 * either would be a second place to get Dispel Magic wrong.
 *
 * Note what 2024 changed: **there is no check at all** below the threshold.
 * The 2014 habit of rolling for everything is a different spell.
 */
export const DISPEL_MAGIC: SpellDefinition = {
  id: 'dispel-magic',
  name: 'Dispel Magic',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [{ kind: 'dispel' }],
  unmodelled: [
    '"one creature, object, or magical effect" — only a creature can be named, because only a creature has a record to hand the engine; a spell running on nobody (an illusion, a wall) is reachable by no target',
  ],
};

/**
 * SRD Vampiric Touch:
 *
 * > _Level 3 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Make a melee spell attack against one creature within reach. On a hit,
 * > the target takes 3d6 Necrotic damage, and you regain Hit Points equal to
 * > half the amount of Necrotic damage dealt."
 * > "Until the spell ends, you can make the attack again on each of your turns
 * > as a Magic action, targeting the same creature or a different one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 *
 * The first spell the engine can use on a turn after the one it was cast on.
 * Three things make that possible and all three are facts pinned when the
 * casting began: **the level** (so the dice do not grow when the caster does),
 * **the route** (so the attack modifier is the one it was cast with), and
 * **the caster** (so nobody else can swing it).
 *
 * Range: Self is the transcription, and it is also why the spell is *on* the
 * wizard rather than on whoever is being drained — which is what Dispel Magic
 * needs to know.
 */
export const VAMPIRIC_TOUCH: SpellDefinition = {
  id: 'vampiric-touch',
  name: 'Vampiric Touch',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'necrotic',
      healsCasterForHalf: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    action: 'action',
    // "targeting the same creature or a different one", and the attack is a
    // melee one — so five feet, checked afresh every time.
    range: { kind: 'touch' },
    label: 'Vampiric Touch (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
        damageType: 'necrotic',
        healsCasterForHalf: true,
      },
    ],
  },
  unmodelled: [
    'the *initial* attack\u2019s "within reach" goes unchecked: the spell\u2019s printed Range is Self, which is the reach the targeting rules read, and the five feet belong to the attack rather than to the spell. Every later use checks it',
  ],
};

/**
 * SRD Flame Blade:
 *
 * > _Level 2 Evocation (Druid, Sorcerer)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "You evoke a fiery blade in your free hand... **As a Magic action**, you
 * > can make a melee spell attack with the fiery blade. On a hit, the target
 * > takes Fire damage equal to 3d6 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 2."
 *
 * The second member of the later-turn family, and the one that proves the
 * shape is a shape: **the casting itself does nothing at all.** Evoking the
 * blade is not an attack, so the spell's own effect list is empty and every
 * blow it ever strikes comes through the activation.
 *
 * The blade is in the caster's hand, which is why this belongs to the family
 * that works today rather than to the one that does not: nothing has a
 * position except the caster, who already has one.
 */
export const FLAME_BLADE: SpellDefinition = {
  id: 'flame-blade',
  name: 'Flame Blade',
  level: 2,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  activation: {
    action: 'action',
    range: { kind: 'touch' },
    label: 'Flame Blade',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
        damageType: 'fire',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'letting go of the blade and evoking it again as a Bonus Action is not modelled: what is in a creature\u2019s hands is not tracked',
    'the Bright Light in a 10-foot radius and the Dim Light beyond it are the DM\u2019s; light is not modelled',
  ],
};

/**
 * SRD Produce Flame:
 *
 * > _Conjuration Cantrip (Druid)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "A flickering flame appears in your hand and remains there for the
 * > duration. While there, the flame emits no heat and ignites nothing, and it
 * > sheds Bright Light in a 20-foot radius and Dim Light for an additional 20
 * > feet. The spell ends if you cast it again.
 * >
 * > Until the spell ends, you can take a Magic action to hurl fire at a
 * > creature or an object within 60 feet of you. Make a ranged spell attack.
 * > On a hit, the target takes 1d8 Fire damage."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * Flame Blade's shape at cantrip level, and the third member of the family:
 * the casting itself resolves nothing \u2014 conjuring a flame is not an attack \u2014
 * and every bolt the spell ever throws comes through the activation.
 *
 * **The 60 feet are the activation's, not the spell's.** SRD prints
 * **Range: Self**, because what the casting reaches is the caster's own hand;
 * the distance belongs to the fire being hurled, which is checked afresh on
 * each later turn. Putting 60 feet in `range` would let the casting itself be
 * aimed at somebody, which is not a thing this spell does.
 *
 * **And the dice read the caster, never a slot.** A cantrip has no slot to
 * scale with, so the upgrade is `cantripUpgradesAt` \u2014 the exact confusion that
 * once had a level 3 Wizard throwing Fire Bolt for 2d10.
 *
 * "The spell ends if you cast it again" is the sentence Mage Hand and Minor
 * Illusion print word for word, which is what makes
 * {@link SpellDefinition.replacesPriorCasting} a rule rather than a quirk.
 */
export const PRODUCE_FLAME: SpellDefinition = {
  id: 'produce-flame',
  name: 'Produce Flame',
  level: 0,
  school: 'conjuration',
  castingTime: 'bonus-action',
  concentration: false,
  // "Range: Self" \u2014 the flame appears in the caster's hand.
  range: { kind: 'self' },
  targets: { count: 0 },
  // Conjuring the flame is not an attack; the spell's whole content is below.
  effects: [],
  // "Duration: 10 minutes."
  durationSeconds: 600,
  // "The spell ends if you cast it again."
  replacesPriorCasting: true,
  activation: {
    // "you can take a Magic action to hurl fire".
    action: 'action',
    // "at a creature or an object within 60 feet of you" \u2014 measured from the
    // caster, which is why it is the activation's range rather than an origin.
    range: { kind: 'ranged', feet: 60 },
    label: 'Produce Flame (hurl)',
    effects: [
      {
        kind: 'attack',
        attack: 'ranged',
        // "1d8 Fire damage", upgraded at character levels 5, 11 and 17.
        damage: { dice: '1d8', cantripUpgradesAt: [5, 11, 17] },
        damageType: 'fire',
      },
    ],
  },
  unmodelled: [
    'the Bright Light in a 20-foot radius and the Dim Light beyond it are the DM\u2019s; light is not modelled',
  ],
};

// — Advantage and Disadvantage a spell grants ————————————————————————————————

/**
 * SRD Blur:
 *
 * > _Level 2 Illusion (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Your body becomes blurred. For the duration, **any creature has
 * > Disadvantage on attack rolls against you**. An attacker is immune to this
 * > effect if it perceives you with Blindsight or Truesight."
 *
 * The spell the `against-holder` relation exists for, and the reason the
 * comparative audit named a roll-modification target key as what the standing
 * Advantage family needed first. Everything else Blur wants the engine has had
 * for a long time: a Concentration casting, a minute on the clock, a durable
 * effect linked to the casting, and one final rule that settles modes. What it
 * had no way to say is that the mode belongs to somebody **else's** roll.
 *
 * Note what is *not* here: no number, no target list, no per-attacker
 * bookkeeping. "Any creature" is every creature, which is what a selector with
 * no filter on the roller means.
 */
export const BLUR: SpellDefinition = {
  id: 'blur',
  name: 'Blur',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'disadvantage',
        selector: { roll: 'attack', relation: 'against-holder' },
      },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'an attacker that perceives the target with Blindsight or Truesight is immune to the effect; the engine models no senses beyond declared sight, so every attacker rolls at Disadvantage',
  ],
};

/**
 * SRD Beacon of Hope:
 *
 * > _Level 3 Abjuration (Cleric)._ **Casting Time:** Action. **Range:** 30
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose any number of creatures within range. For the duration, each
 * > target has **Advantage on Wisdom saving throws and Death Saving Throws**
 * > and regains the maximum number of Hit Points possible from any healing."
 *
 * Two effects for one sentence, and the sentence is why: a Death Saving Throw
 * is not a Wisdom saving throw and is not a saving throw of any ability at all
 * — "Unlike other saving throws, this one isn't tied to an ability score." One
 * ability-keyed grant covering both would either miss the death save or, keyed
 * loosely enough to catch it, catch every save in the game.
 *
 * It is therefore the spell that proves `death-save` is its own roll family
 * rather than a tidiness, and the mirror of Enhance Ability on the other side:
 * Advantage on Wisdom **saves** touches no Wisdom **check**.
 *
 * "Choose any number of creatures" names no count, which is what
 * `unlimited` says — range still bounds it, as it does for Compulsion.
 */
export const BEACON_OF_HOPE: SpellDefinition = {
  id: 'beacon-of-hope',
  name: 'Beacon of Hope',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true, self: true },
  effects: [
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'advantage',
        selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
      },
    },
    {
      kind: 'roll-mode',
      modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'each target regains the maximum number of Hit Points possible from any healing; healing rolls its dice and nothing reads a maximise instruction, so a Cure Wounds on a target of this spell heals its rolled amount',
  ],
};

/**
 * SRD Lesser Restoration:
 *
 * > _Level 2 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Bonus Action. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "You touch a creature and end one condition on it: Blinded, Deafened,
 * > Paralyzed, or Poisoned."
 *
 * One sentence, and the whole of the spell — which is what makes it the proof
 * that `end-condition` is a shape rather than a special case. The removal is
 * `endConditionsOn`, the same three lines Lay On Hands has used since pools
 * learned to buy things, so "the condition, not a cause of it" is preserved by
 * being shared.
 *
 * **"One" is the half that is not executed**, and it is a named missing shape
 * rather than a rounding: a condition chosen at the casting has nowhere to be
 * recorded, which is the gap Blindness/Deafness already carries. So the engine
 * ends every one of the four it finds, and the clause below says so.
 */
export const LESSER_RESTORATION: SpellDefinition = {
  id: 'lesser-restoration',
  name: 'Lesser Restoration',
  level: 2,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    // "Blinded, Deafened, Paralyzed, or Poisoned", in the order the SRD prints
    // them. No scaling: the spell prints no *Using a Higher-Level Spell Slot*
    // line, so a level 5 slot ends the same list.
    { kind: 'end-condition', conditions: ['blinded', 'deafened', 'paralyzed', 'poisoned'] },
  ],
  unmodelled: [
    'the caster chooses which single condition to end and the engine ends every one of the four that the target has; a condition chosen at the casting has nowhere to be recorded',
  ],
};

/**
 * SRD Protection from Poison:
 *
 * > _Level 2 Abjuration (Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a creature and end the Poisoned condition on it. For the
 * > duration, the target has Advantage on saving throws to avoid or end the
 * > Poisoned condition, and it has Resistance to Poison damage."
 *
 * The first and third sentences execute; the second is debt with a name. A
 * list of one is what a spell that names its own condition looks like —
 * nothing is chosen, so nothing is missing there — and the hour it then runs
 * makes the casting an ongoing record where an Instantaneous removal leaves
 * none at all.
 *
 * **That record was on nobody, and building the Resistance is what put it on
 * somebody.** A casting is on a creature while it has a live effect there that
 * the casting owns; a removal owns nothing, because it takes something away
 * and keeps nothing, so `on` was empty and a Dispel Magic aimed at the target
 * found no Protection from Poison to end. The Resistance is a thing the
 * casting owns and keeps, and `on` says so — exactly as the earlier version of
 * this docstring predicted it would, without anything else here changing.
 */
export const PROTECTION_FROM_POISON: SpellDefinition = {
  id: 'protection-from-poison',
  name: 'Protection from Poison',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    { kind: 'end-condition', conditions: ['poisoned'] },
    { kind: 'damage-defense', damageTypes: ['poison'], defense: 'resistant' },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'the target has Advantage on saving throws to avoid or end the Poisoned condition; a mode is selected by roll family, ability and skill, and there is no way to say "a saving throw against a named condition", so those saves are rolled without it',
  ],
};

/**
 * SRD Stoneskin:
 *
 * > _Level 4 Transmutation (Druid, Ranger, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "Until the spell ends, one willing creature you touch has Resistance to
 * > Bludgeoning, Piercing, and Slashing damage."
 *
 * One sentence and the whole spell, which is what makes it the proving case
 * for the `damage-defense` effect: there is nothing else in it to get right.
 * Three types in one grant, because the SRD writes one clause about all three
 * — and a second casting of it on the same creature halves the sword once,
 * because "multiple instances of Resistance to the same damage type count as
 * only one".
 */
export const STONESKIN: SpellDefinition = {
  id: 'stoneskin',
  name: 'Stoneskin',
  level: 4,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'damage-defense',
      damageTypes: ['bludgeoning', 'piercing', 'slashing'],
      defense: 'resistant',
    },
  ],
  durationSeconds: 3600,
  unmodelled: ['whether the target is willing is not modelled; willingness is fiction'],
};

/**
 * SRD Protection from Energy:
 *
 * > _Level 3 Abjuration (Cleric, Druid, Ranger, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "For the duration, the willing creature you touch has Resistance to one
 * > damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder."
 *
 * **The second spell whose damage type is named at the casting**, and it names
 * it for the opposite reason to the first. Spirit Guardians states a fact the
 * *SRD* decides — "Radiant (if you are good or neutral) or Necrotic (if you
 * are evil)" — that the engine does not hold about every caster. This states a
 * *choice*, which nothing but the caster can make. `damageTypeStated` said a
 * second user would be the evidence that anything about it should generalise;
 * the mechanism is identical and the reason stays each spell's own.
 *
 * The five printed types are the whole of the list, so naming a sixth is
 * refused rather than granted, and naming none is refused rather than guessed
 * — the discipline Spirit Guardians already follows. `damageTypes` below is
 * the placeholder that makes the definition well-formed; the stated answer is
 * what actually lands.
 */
export const PROTECTION_FROM_ENERGY: SpellDefinition = {
  id: 'protection-from-energy',
  name: 'Protection from Energy',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  damageTypeStated: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
  effects: [{ kind: 'damage-defense', damageTypes: ['acid'], defense: 'resistant' }],
  durationSeconds: 3600,
  unmodelled: ['whether the target is willing is not modelled; willingness is fiction'],
};

/**
 * SRD Mind Blank:
 *
 * > _Level 8 Abjuration (Bard, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 24 hours.
 * > "Until the spell ends, one willing creature you touch has Immunity to
 * > Psychic damage and the Charmed condition. The target is also unaffected by
 * > anything that would sense its emotions or alignment, read its thoughts, or
 * > magically detect its location, and no spell—not even _Wish_—can gather
 * > information about the target, observe it remotely, or control its mind."
 *
 * **One sentence, two effects, and that is the whole of what IE-017 found out
 * by building half of it.** A stat block prints damage types and conditions in
 * one run and the engine treats them completely differently, so "Immunity to
 * Psychic damage and the Charmed condition" is a `damage-defense` and a
 * `condition-immunity` — two kinds, two tables, two readers. `missing-shapes.ts`
 * predicted IE-017 would finish this spell and was wrong for exactly that
 * reason; it is the sharpest correction that map has recorded, and this
 * definition is the other end of it.
 *
 * **"Duration: 24 hours"**, which is 86,400 seconds and an ordinary deadline:
 * no Concentration, so the Immunity survives the caster being hit, and the
 * casting's own timer is what ends both halves.
 *
 * **The second sentence is answered twice over and neither answer is new.**
 * Every spell in this catalogue that controls a mind does it by imposing the
 * Charmed condition — Dominate Beast, Dominate Monster, Dominate Person,
 * Suggestion, Mass Suggestion, Charm Person, Charm Monster, Animal Friendship —
 * so "no spell ... can ... control its mind" is the Immunity above doing its
 * work, not a clause nobody built. What is left of it senses emotions, reads
 * thoughts, scries and gathers information, and the engine holds none of those
 * facts and casts no spell that asks for one; the clause is the DM's, and
 * `unmodelled` says so in those words.
 */
export const MIND_BLANK: SpellDefinition = {
  id: 'mind-blank',
  name: 'Mind Blank',
  level: 8,
  school: 'abjuration',
  castingTime: 'action',
  // "Range: Touch."
  range: { kind: 'touch' },
  // "one willing creature you touch" — one target, and the caster may be it.
  targets: { count: 1, self: true },
  // "Duration: 24 hours", with no Concentration printed.
  concentration: false,
  durationSeconds: 86_400,
  effects: [
    { kind: 'damage-defense', damageTypes: ['psychic'], defense: 'immune' },
    { kind: 'condition-immunity', conditions: ['charmed'] },
  ],
  unmodelled: [
    'whether the target is willing is not modelled; willingness is fiction',
    'the second sentence is the table’s, once the Charmed Immunity above has answered the mind-control half of it: nothing in this engine senses emotions or alignment, reads thoughts, magically locates a creature, gathers information about one or observes it from elsewhere, so there is no effect for the protection to refuse and Wish is not in the catalogue',
  ],
};

/**
 * SRD Divine Favor, whole:
 *
 * > _Level 1 Transmutation (Paladin)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** 1 minute.
 * > "Until the spell ends, your attacks with weapons deal an extra 1d4 Radiant
 * > damage on a hit."
 *
 * One sentence and the engine finishes all of it, which makes this the
 * cleanest consumer of the rider: no target to choose, no save, no scaling,
 * and a printed duration that is a plain span of seconds.
 *
 * **"With weapons" is the whole of `weaponOnly`.** A Paladin who casts this
 * and then throws a Sacred Flame gets no Radiant from it, and the field is
 * what says so — Hunter's Mark, three entries down, writes the other clause
 * and carries no such field.
 *
 * Range: Self, so the effect resolves on the caster and the grant lands where
 * it would have landed anyway. Hunter's Mark is what proves the grant follows
 * the *caster* rather than the target.
 */
export const DIVINE_FAVOR: SpellDefinition = {
  id: 'divine-favor',
  name: 'Divine Favor',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  // SRD prints "Duration: 1 minute" with no Concentration line, which is the
  // whole of what separates this from Hunter's Mark below.
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [{ kind: 'attack-rider', dice: '1d4', damageType: 'radiant', weaponOnly: true }],
  // "Duration: 1 minute", and no Concentration line: the SRD prints neither
  // the word nor a higher-slot clause for this spell.
  durationSeconds: 60,
};

/**
 * SRD Hunter's Mark, whole:
 *
 * > _Level 1 Divination (Ranger)._ **Casting Time:** Bonus Action. **Range:**
 * > 90 feet. **Duration:** Concentration, up to 1 hour.
 * > "You magically mark one creature you can see within range as your quarry.
 * > Until the spell ends, you deal an extra 1d6 Force damage to the target
 * > whenever you hit it with an attack roll. You also have Advantage on any
 * > Wisdom (Perception or Survival) check you make to find it."
 * > "If the target drops to 0 Hit Points before this spell ends, you can take
 * > a Bonus Action to move the mark to a new creature you can see within
 * > range."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 3–4 (up to 8 hours) or 5+ (up to 24 hours)."
 *
 * **The spell blocked on both of this task's shapes, and on nothing else** —
 * which is why the two were built together. The rider is the first sentence
 * and the bands are the last.
 *
 * **The grant is on the ranger and the mark is on the quarry.** The effect
 * resolves on the creature 90 feet away; `marksTarget` records which creature
 * the extra die is *about*, and the die itself is held by whoever is shooting.
 * Storing it on the quarry would have read naturally and would have given a
 * second ranger's arrow the first ranger's 1d6.
 *
 * **"With an attack roll" and not "with weapons"**, which is Divine Favor's
 * clause and deliberately absent here: a Fire Bolt aimed at the quarry carries
 * the Force.
 *
 * Two clauses are the table's and one is debt, and they are told apart in
 * `unmodelled` rather than in a docstring nobody rereads.
 */
export const HUNTERS_MARK: SpellDefinition = {
  id: 'hunters-mark',
  name: "Hunter's Mark",
  level: 1,
  school: 'divination',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  requiresSight: true,
  targets: { count: 1 },
  effects: [{ kind: 'attack-rider', dice: '1d6', damageType: 'force', marksTarget: true }],
  // "Concentration, up to 1 hour" — the cap a level 1 or 2 slot buys.
  durationSeconds: 3600,
  // "level 3–4 (up to 8 hours) or 5+ (up to 24 hours)": 8 × 3600 and 24 × 3600.
  // Two keys, because the SRD prints two bands; a level 4 slot falls in the
  // first because 5 has not been reached.
  durationAtSlot: { 3: 28800, 5: 86400 },
  unmodelled: [
    'the Advantage on a Wisdom (Perception or Survival) check made to find the quarry is not granted: a roll modifier selects Wisdom (Perception) and Wisdom (Survival) perfectly well, and what nothing can select is *which* check is being made to find the quarry — so a grant would hand the ranger Advantage on every Perception check they ever roll',
    'moving the mark to a new creature when the quarry drops to 0 Hit Points is not offered: nothing reads a threshold on a creature current Hit Points, and an activation resolves effects at a target rather than re-aiming what the casting already granted',
  ],
};

// — the third tracked batch: the twelve a casting time of a minute or more blocked —
//
// IE-034 built the mechanism and could reach it from no definition: a casting
// of a minute or more is declared, concentrated on, and settled when the clock
// arrives, and a Ritual is the same mechanism ten minutes longer. These are the
// twelve spells for which that refusal was the *only* thing in the way —
// `consumersOf('a-long-casting-time').unblocks`, read as data rather than
// counted by hand.
//
// **Every one of them is tracked, and that is what reading the paragraphs
// decided rather than what the batch set out to do.** A ward that warns you, a
// sensor a mile off, three facts about the countryside, an object fabricated
// or repaired, a page only your friends can read, a mouth that speaks when
// somebody walks past: not one of the twelve changes a number, a resource or a
// condition. What the engine owns is the cost — the action, the slot, the
// Concentration, the deadline, the range and the target rule — and it now
// spends all of it.
//
// The one clause among the twelve that is arithmetic is Hallucinatory
// Terrain's Intelligence (Investigation) check, which is the sentence Disguise
// Self, Minor Illusion and Silent Image already write, and it is executed.

/**
 * SRD Alarm:
 *
 * > _Level 1 Abjuration (Ritual) (Ranger, Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** 30 feet.
 * > **Duration:** 8 hours.
 * > "You set an alarm against intrusion. Choose a door, a window, or an area
 * > within range that is no larger than a 20-foot Cube. Until the spell ends,
 * > an alarm alerts you whenever a creature touches or enters the warded area.
 * > When you cast the spell, you can designate creatures that won't set off
 * > the alarm."
 *
 * **The first spell in the catalogue whose Ritual is not ten minutes**, and
 * the fixture for it — not the only one. Every definition carrying the tag
 * *before this batch* prints "Action or Ritual" and so has no casting time of
 * its own to be longer *than*, which made "adds ten minutes" and "is ten
 * minutes" the same number for all ten and left `castingOf`'s sum unwatched —
 * a mutation replacing it with the constant survived the entire suite. Alarm
 * prints "1 minute or Ritual" and its Ritual therefore takes **660** seconds,
 * so that mutation now reddens a fixture driven off the catalogue rather than
 * one built by hand to reach it.
 *
 * **Five more of this batch print the same line and come to the same 660** —
 * Commune with Nature, Identify, Illusory Script, Instant Summons and Magic
 * Mouth — so what makes Alarm the fixture is that the test was written around
 * it, rather than any uniqueness. `long-casting.test.ts` loops over *every*
 * tagged definition with a casting time of its own, which is what keeps this
 * paragraph from being the thing the guard rests on.
 *
 * **No area, and no designation, and the two go together.** `SpellArea.size`
 * is one fixed number and the SRD prints a ceiling the caster chooses under —
 * "no larger than a 20-foot Cube" — with two of the three things that may be
 * warded being objects. And `designatesUnaffected` filters which creatures an
 * area's **effects** reach: this area has none to reach anybody, because what
 * the ward does when it catches somebody is tell the caster, which changes no
 * authoritative state at all. An area carrying no effect and no trigger would
 * gather creatures for nothing, which is why no definition in the catalogue
 * has one.
 */
export const ALARM: SpellDefinition = {
  id: 'alarm',
  name: 'Alarm',
  level: 1,
  school: 'abjuration',
  // "Casting Time: 1 minute or Ritual" — the minute is the spell's own, and
  // the Ritual's ten minutes are the rule's, added at the declaration.
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: 30 feet."
  range: { kind: 'ranged', feet: 30 },
  // The ward is set on a door, a window or a patch of ground; no creature is
  // ever a target of it.
  targets: { count: 0 },
  effects: [],
  // "Duration: 8 hours."
  durationSeconds: 28_800,
  unmodelled: [
    'the warded area is the DM’s: "a door, a window, or an area within range that is no larger than a 20-foot Cube" is a choice between two objects and a Cube whose size the caster picks, where a spell’s area is one fixed number — transcribing 20 would assert as the ward’s footprint a figure the book prints as a ceiling',
    'the alarm is not raised: "an alarm alerts you whenever a creature touches or enters the warded area" changes no mechanically authoritative state — no roll, no resource, no condition, nothing about any creature — so there is nothing for the engine to decide, exactly as there is nothing for it to decide about Detect Magic’s "you sense the presence of any magical effects"',
    'designating creatures that will not set off the alarm is not recorded, because there is no alarm for them to be exempt from: the exemption is from a warning the DM gives, so it is the DM’s along with the warning',
    'whether the alarm is audible or mental, the handbell heard 60 feet off, the mental ping a mile away and being woken by it are all the DM’s',
  ],
};

/**
 * SRD Clairvoyance:
 *
 * > _Level 3 Divination (Bard, Cleric, Sorcerer, Wizard)._
 * > **Casting Time:** 10 minutes. **Range:** 1 mile.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You create an Invisible sensor within range in a location familiar to you
 * > ... The intangible, invulnerable sensor remains in place for the duration."
 * > "When you cast the spell, choose seeing or hearing. You can use the chosen
 * > sense through the sensor as if you were in its space."
 *
 * **A mile of Range and nobody to aim it at**, which is why `targets.count` is
 * zero: the spell reaches a *place*, and the place is one the caster has
 * visited rather than one anybody has declared into this scene.
 *
 * The sensor is the whole of what is left, and it is not a point a casting
 * holds. `CastingOrigin` exists to be **measured from** — a reach, an attack,
 * an area that travels — and nothing is measured from this one; what it does
 * is let the caster perceive, and perception in this engine is a *declared*
 * pairwise fact rather than anything derived. So a sensor granting sight
 * grants a fact the DM declares, and the Bonus Action that switches between
 * seeing and hearing is a cost of operating a thing the engine does not hold.
 */
export const CLAIRVOYANCE: SpellDefinition = {
  id: 'clairvoyance',
  name: 'Clairvoyance',
  level: 3,
  school: 'divination',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  // "Duration: Concentration, up to 10 minutes."
  concentration: true,
  // "Range: 1 mile" — 5,280 feet, which the oracle reads off the printed line.
  range: { kind: 'ranged', feet: 5280 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the sensor is the DM’s: "You create an Invisible sensor within range in a location familiar to you" makes an intangible, invulnerable thing that stands somewhere the caster has been, and nothing measures anything from it — what it does is let the caster see or hear, and sight in this engine is a declared pairwise fact rather than a derived one',
    'choosing seeing or hearing, and the Bonus Action that switches between them, go with the sensor: the cost is a cost of operating a thing the engine does not hold, and what changes when it is spent is what the caster perceives',
    'a creature with See Invisibility or Truesight seeing "a luminous orb about the size of your fist" is the DM’s; the engine has no senses beyond declared sight',
  ],
};

/**
 * SRD Commune with Nature:
 *
 * > _Level 5 Divination (Ritual) (Druid, Ranger)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Self.
 * > **Duration:** Instantaneous.
 * > "You commune with nature spirits and gain knowledge of the surrounding
 * > area." "Choose three of the following facts; you learn those facts as they
 * > pertain to the spell's area."
 *
 * Knowledge, and nothing else: five bullet points of geography, one of which
 * names a creature type and none of which asks the engine for a number. The
 * spell is Instantaneous, so it leaves no record to be dispelled either.
 */
export const COMMUNE_WITH_NATURE: SpellDefinition = {
  id: 'commune-with-nature',
  name: 'Commune with Nature',
  level: 5,
  school: 'divination',
  // "Casting Time: 1 minute or Ritual."
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: Self."
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  // "Duration: Instantaneous" — no deadline, and nothing left standing.
  unmodelled: [
    'what the spirits say is the DM’s: the three facts chosen from "Locations of settlements", portals, a Challenge Rating 10+ Celestial, Elemental, Fey, Fiend or Undead, the most prevalent plant, mineral or Beast, and bodies of water are all descriptions of a world the engine does not hold',
    'the 3 miles outdoors, the 300 feet underground, and the spell not functioning "where nature has been replaced by construction" are the DM’s: the engine holds one scene with an extent and no terrain at all',
  ],
};

/**
 * SRD Fabricate:
 *
 * > _Level 4 Transmutation (Wizard)._ **Casting Time:** 10 minutes.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You convert raw materials into products of the same material."
 * > "Choose raw materials that you can see within range. You can fabricate a
 * > Large or smaller object (contained within a 10-foot Cube or eight
 * > connected 5-foot Cubes) given a sufficient quantity of material."
 *
 * Objects in, objects out. The Artisan's Tools clause is the one sentence that
 * reads a fact about the caster, and it reads one the engine does not carry in
 * play: tool proficiencies are gathered when a character is planned and land
 * on the plan rather than on the sheet, and there is no fabricated object for
 * the clause to gate in any case.
 */
export const FABRICATE: SpellDefinition = {
  id: 'fabricate',
  name: 'Fabricate',
  level: 4,
  school: 'transmutation',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  // "Range: 120 feet."
  range: { kind: 'ranged', feet: 120 },
  // The spell is aimed at raw materials, never at a creature.
  targets: { count: 0 },
  effects: [],
  // "Duration: Instantaneous."
  unmodelled: [
    'what is fabricated is the DM’s: the raw materials, the product, the size limits — "a Large or smaller object (contained within a 10-foot Cube or eight connected 5-foot Cubes)", Medium for metal or stone — and the quality that follows from the materials are all facts about objects, which the engine does not model',
    'the clause that "Creatures and magic items can’t be created by this spell" forbids making a thing the engine could not have made anyway',
    'the Artisan’s Tools proficiency that gates weapons and armour is not checked: a character’s tool proficiencies are gathered when the character is planned and stay on the plan rather than reaching the sheet, so nothing in play reads one — and there is no fabricated object for it to gate',
  ],
};

/**
 * SRD Find the Path:
 *
 * > _Level 6 Divination (Bard, Cleric, Druid)._ **Casting Time:** 1 minute.
 * > **Range:** Self. **Duration:** Concentration, up to 1 day.
 * > "You magically sense the most direct physical route to a location you
 * > name." "For the duration, as long as you are on the same plane of
 * > existence as the destination, you know how far it is and in what direction
 * > it lies."
 *
 * A day of Concentration — 86,400 seconds, the longest deadline in the
 * catalogue — spent knowing which way to walk. The engine runs the clock and
 * the Concentration, and every word about the route is the DM's.
 */
export const FIND_THE_PATH: SpellDefinition = {
  id: 'find-the-path',
  name: 'Find the Path',
  level: 6,
  school: 'divination',
  // "Casting Time: 1 minute."
  castingTime: 'long',
  castingSeconds: 60,
  // "Duration: Concentration, up to 1 day."
  concentration: true,
  // "Range: Self."
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the route is the DM’s: "you know how far it is and in what direction it lies", and "Whenever you face a choice of paths along the way there, you know which path is the most direct" — the engine holds one scene and no map beyond it',
    'the spell failing for a destination on another plane, a moving one or an unspecific one is the DM’s: whether the caster is familiar with a place, and whether "a green dragon’s lair" names one, are judgements about the fiction',
  ],
};

/**
 * SRD Hallucinatory Terrain:
 *
 * > _Level 4 Illusion (Bard, Druid, Warlock, Wizard)._
 * > **Casting Time:** 10 minutes. **Range:** 300 feet. **Duration:** 24 hours.
 * > "You make natural terrain in a 150-foot Cube in range look, sound, and
 * > smell like another sort of natural terrain."
 * > "If the difference isn't obvious by touch, a creature examining the
 * > illusion can take the Study action to make an Intelligence (Investigation)
 * > check against your spell save DC to disbelieve it."
 *
 * **The one clause among these twelve that is arithmetic**, and it is the
 * sentence Disguise Self, Minor Illusion and Silent Image already write. So it
 * is the same {@link SpellCheck}, riding on the casting's own timer — which
 * this spell has, because its twenty-four hours leave an ongoing record for
 * the check to be made against.
 *
 * **No area**, for the reason Alarm has none: a `SpellArea` picks the
 * creatures a casting's effects reach, and this illusion reaches none of them.
 * "Manufactured structures, equipment, and creatures within the area aren't
 * changed" is the book saying so outright.
 */
export const HALLUCINATORY_TERRAIN: SpellDefinition = {
  id: 'hallucinatory-terrain',
  name: 'Hallucinatory Terrain',
  level: 4,
  school: 'illusion',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  // "Range: 300 feet."
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  effects: [],
  // "Duration: 24 hours."
  durationSeconds: 86_400,
  // "a creature examining the illusion can take the Study action to make an
  // Intelligence (Investigation) check against your spell save DC to
  // disbelieve it." Seeing through it changes nothing the engine holds, which
  // is what `onSuccess: 'none'` says.
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the terrain looks, sounds and smells like is the DM’s, and so is the 150-foot Cube it fills: a spell’s area picks the creatures its effects reach and this illusion reaches none — "Manufactured structures, equipment, and creatures within the area aren’t changed"',
    'whether a creature notices by touch, and whether it thinks to examine the illusion at all, are the DM’s; what the engine owns is the check itself, which `resolveEffectCheck` rolls against this casting’s own save DC',
    'the "vague image superimposed on the real terrain" a creature sees once it has disbelieved is narration',
  ],
};

/**
 * SRD Identify:
 *
 * > _Level 1 Divination (Ritual) (Bard, Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "You touch an object throughout the spell's casting. If the object is a
 * > magic item or some other magical object, you learn its properties and how
 * > to use them, whether it requires Attunement, and how many charges it has,
 * > if any."
 * > "If you instead touch a creature throughout the casting, you learn which
 * > ongoing spells, if any, are currently affecting it."
 *
 * **Two things may be touched and only one of them is a creature**, which is
 * exactly `TargetRule.optional`: the caller names the creature, or names
 * nobody because it was an object. Naming one buys the Touch range check
 * against a real creature; naming none is the spell's other half and is legal.
 *
 * What the caster *learns* is deliberately not an effect. "You learn which
 * ongoing spells, if any, are currently affecting it" is a fact the engine
 * already holds and already answers — `ongoingSpellsOn` is the query — and no
 * effect kind reports knowledge, because knowing something changes no
 * authoritative state. The spell tells the table which question to ask.
 */
export const IDENTIFY: SpellDefinition = {
  id: 'identify',
  name: 'Identify',
  level: 1,
  school: 'divination',
  // "Casting Time: 1 minute or Ritual."
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: Touch."
  range: { kind: 'touch' },
  // "If you instead touch a creature throughout the casting" — so one creature
  // may be named, and naming nobody means the object case.
  targets: { count: 1, optional: true },
  effects: [],
  // "Duration: Instantaneous."
  unmodelled: [
    'what is learned about an object is the DM’s: its properties, how to use them, whether it requires Attunement, how many charges it has and which spell created it are all facts about a magic item, and magic items are not modelled',
    'what is learned about a creature is not delivered as an effect: "you learn which ongoing spells, if any, are currently affecting it" is a fact the engine holds and already answers as a query, and no effect kind reports knowledge, because knowing something changes no authoritative state',
  ],
};

/**
 * SRD Illusory Script:
 *
 * > _Level 1 Illusion (Ritual) (Bard, Warlock, Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Touch.
 * > **Duration:** 10 days.
 * > "You write on parchment, paper, or another suitable material and imbue it
 * > with an illusion that lasts for the duration."
 * > "To you and any creatures you designate when you cast the spell, the
 * > writing appears normal ... To all others, the writing appears as if it
 * > were written in an unknown or magical script that is unintelligible."
 *
 * Ten days — 864,000 seconds — is the longest span in the catalogue, and the
 * engine runs it. Everything else is reading, which is fiction: who was
 * designated, what the script says, and what it says instead.
 *
 * "If the spell is dispelled, the original script and the illusion both
 * disappear" is half executed already, and the half that is executed is the
 * half that matters: the casting leaves an ongoing record, so Dispel Magic can
 * genuinely end it. What disappears is then the DM's.
 */
export const ILLUSORY_SCRIPT: SpellDefinition = {
  id: 'illusory-script',
  name: 'Illusory Script',
  level: 1,
  school: 'illusion',
  // "Casting Time: 1 minute or Ritual."
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: Touch" — the material written on, which is never a creature.
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  // "Duration: 10 days."
  durationSeconds: 864_000,
  unmodelled: [
    'the writing is the DM’s: what the text says, what the illusion makes it say instead, and the altered "meaning, handwriting, and language" are all fiction, and so is the parchment it is written on',
    'the creatures designated at the casting are not recorded, because what being designated buys is the ability to read, and reading is the DM’s',
    'a creature with Truesight reading the hidden message is the DM’s; the engine has no senses beyond declared sight',
  ],
};

/**
 * SRD Instant Summons:
 *
 * > _Level 6 Conjuration (Ritual) (Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Touch.
 * > **Duration:** Until dispelled.
 * > "You touch the sapphire used in the casting and an object weighing 10
 * > pounds or less ... The spell leaves an Invisible mark on that object and
 * > invisibly inscribes the object's name on the sapphire."
 * > "Thereafter, you can take a Magic action to speak the object's name and
 * > crush the sapphire. The object instantly appears in your hand regardless
 * > of physical or planar distances, and the spell ends."
 *
 * "Until dispelled" is the absence of a deadline rather than a large one, so
 * no timer is scheduled and the ward on the sapphire simply stands.
 *
 * **The Magic action that ends it is the one clause here the engine would own
 * if it could**, and it is named as debt rather than as fiction: a
 * non-Concentration ongoing casting cannot be ended ahead of time, because
 * `endConcentration` is about Concentration and there is no other door. The
 * sapphire, the object and the summoning across planes are the DM's.
 */
export const INSTANT_SUMMONS: SpellDefinition = {
  id: 'instant-summons',
  name: 'Instant Summons',
  level: 6,
  school: 'conjuration',
  // "Casting Time: 1 minute or Ritual."
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: Touch" — the sapphire and the object marked, neither a creature.
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  // "Duration: Until dispelled" — no deadline, so no timer.
  untilDispelled: true,
  unmodelled: [
    'the sapphire and the marked object are the DM’s: the weight limit, the 6-foot longest dimension, the Invisible mark, the inscribed name and the rule that "Each time you cast this spell, you must use a different sapphire" are all facts about objects, which the engine does not model',
    'the Magic action that crushes the sapphire is not offered, and ending the casting with it is debt rather than fiction: `endOngoingSpell` ends a casting by id, and it refuses this one twice over — SRD prints the free dismissal for a **time span** and this spell lasts until dispelled, and the book charges a Magic action here where a dismissal spends nothing (`a-casting-dismissed-early`, whose every claimant prints an exception of that kind)',
    'learning who is holding the object and where they are, when crushing the sapphire fails to fetch it, is the DM’s',
  ],
};

/**
 * SRD Legend Lore:
 *
 * > _Level 5 Divination (Bard, Cleric, Wizard)._ **Casting Time:** 10 minutes.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "Name or describe a famous person, place, or object. The spell brings to
 * > your mind a brief summary of the significant lore about that famous thing,
 * > as described by the GM."
 *
 * The SRD hands this one to the DM in its own words — "as described by the
 * GM", "as determined by the GM" — twice in four sentences. What was missing
 * was never the lore; it was the ten minutes, and those are the engine's.
 */
export const LEGEND_LORE: SpellDefinition = {
  id: 'legend-lore',
  name: 'Legend Lore',
  level: 5,
  school: 'divination',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  // "Range: Self."
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  // "Duration: Instantaneous."
  unmodelled: [
    'the lore is the DM’s, and the SRD says so: "a brief summary of the significant lore about that famous thing, **as described by the GM**", and whether it is "couched in figurative language or poetry, **as determined by the GM**"',
    'whether the thing named is actually famous — and the "sad musical notes played on a trombone" when it is not — is the DM’s',
  ],
};

/**
 * SRD Magic Mouth:
 *
 * > _Level 2 Illusion (Ritual) (Bard, Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** 30 feet.
 * > **Duration:** Until dispelled.
 * > "You implant a message within an object in range—a message that is uttered
 * > when a trigger condition is met."
 * > "The trigger can be as general or as detailed as you like, though it must
 * > be based on visual or audible conditions that occur within 30 feet of the
 * > object."
 *
 * **"Condition" here means circumstance**, which is why the tracked map
 * carries an adjudication for it: the guard's marker fires on the word and the
 * sentence is about a trigger the DM watches for, not about any of the fifteen
 * the engine applies.
 *
 * "you can have the spell end after it delivers its message" is the same debt
 * Instant Summons carries — a non-Concentration casting with no way to be
 * dismissed — and is named as debt rather than filed as narration.
 */
export const MAGIC_MOUTH: SpellDefinition = {
  id: 'magic-mouth',
  name: 'Magic Mouth',
  level: 2,
  school: 'illusion',
  // "Casting Time: 1 minute or Ritual."
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  // "Range: 30 feet" — to the object, which is never a creature: "an object
  // that you can see and that isn't being worn or carried by another creature".
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  // "Duration: Until dispelled" — no deadline, so no timer.
  untilDispelled: true,
  unmodelled: [
    'the object, the message and the mouth are the DM’s: which object was chosen, the 25 words spoken, the ten minutes they may be delivered over, and the mouth appearing where a statue’s mouth is are all fiction',
    'the trigger is the DM’s: "it must be based on visual or audible conditions that occur within 30 feet of the object" is a circumstance somebody watches for rather than any of the fifteen conditions the engine applies, and whether a silver bell has rung is not a fact the engine holds',
    'the choice the caster makes at the casting — "When you cast this spell, you can have the spell end after it delivers its message" — is not offered, and that half is debt rather than fiction: `endOngoingSpell` ends a casting by id, and it refuses this one, because SRD prints the free dismissal for a **time span** and this spell lasts until dispelled. So there is no way for the caster to end it early however the choice went (`a-casting-dismissed-early`, the same duration form Instant Summons carries)',
  ],
};

/**
 * SRD Mending:
 *
 * > _Transmutation Cantrip (Bard, Cleric, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "This spell repairs a single break or tear in an object you touch, such as
 * > a broken chain link, two halves of a broken key, a torn cloak, or a
 * > leaking wineskin."
 *
 * **A cantrip that takes a minute**, which is the only such combination among
 * these twelve and the reason it is worth a fixture of its own: the casting is
 * declared and settled on the clock like the rest, and no slot moves in either
 * direction, because a cantrip never had one to spare.
 */
export const MENDING: SpellDefinition = {
  id: 'mending',
  name: 'Mending',
  level: 0,
  school: 'transmutation',
  // "Casting Time: 1 minute."
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  // "Range: Touch" — the object mended, which is never a creature.
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  // "Duration: Instantaneous."
  unmodelled: [
    'the repair is the DM’s: which break or tear was mended, and the limit that it be "no larger than 1 foot in any dimension", are facts about an object, and objects are not modelled — the engine tracks what a creature owns and wears and nothing about its condition',
    'that the spell "can physically repair a magic item, but it can’t restore magic to such an object" forbids restoring something the engine never took away',
  ],
};

// — the fourth batch: the spells eighteen magic items were waiting for ————————
//
// `ITEM_SHAPES`'s heaviest blocker is not an item mechanism at all: forty-eight
// entries of "Magic Items A–Z" print a spell the catalogue had no definition of.
// The word that decides one is **definition** rather than *executable* — a
// `casts` grant is validated against `spells.some(s => s.id === id)` and
// resolved through `content.spell(id)` — so a tracked definition unblocks a
// wand exactly as an executed one does, which is SRD's own sentence about what
// a casting from an item is: "The spell uses its normal casting time, range,
// and duration, and the user of the item must concentrate if the spell
// requires Concentration."
//
// Sixteen definitions, read paragraph by paragraph, and the reading is what put
// each in its bucket. Three execute, and each of the three is partial in a way
// its own notes say: Heal's seventy Hit Points are now writable because an
// amount may carry a `flat` alone, and Haste and Gaseous Form print runs of
// clauses in which the Armour Class, the Resistance, the Immunity and the
// Advantages are all things the engine owns. The other thirteen are tracked,
// because the clause that carries the spell is a mechanic the engine lacks —
// three attack rolls from one casting, a second plane to put a creature on, a
// barrier that stops passage, an activation that forces a saving throw — and
// stretching one of those into an approximation would be a worse answer than
// the honest one.

/**
 * SRD Heal:
 *
 * > _Level 6 Abjuration (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Choose a creature that you can see within range. Positive energy washes
 * > through the target, restoring 70 Hit Points. This spell also ends the
 * > Blinded, Deafened, and Poisoned conditions on the target."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 10 for each
 * > spell slot level above 6."
 *
 * **The spell `a-flat-amount-with-no-dice` was named for, and the half of that
 * shape that is built.** `DiceScaling.dice` became optional when magic items
 * started printing bare numbers, and `flatPerSlotLevelAbove` grew the amount
 * beside it — which is seventy and ten per level, exactly. Nothing is thrown,
 * so the generator does not move, and `addSpellcastingModifier` is false
 * because the book prints no modifier to add.
 *
 * The three conditions are `end-condition`'s whole sentence and every one of
 * them is ended, which is right here where Lesser Restoration's "one" is not:
 * SRD says "ends the Blinded, Deafened, and Poisoned conditions", with no
 * choice for a caster to make.
 *
 * So the entry is whole and carries no `unmodelled` at all.
 */
export const HEAL: SpellDefinition = {
  id: 'heal',
  name: 'Heal',
  level: 6,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [
    {
      kind: 'heal',
      healing: { flat: 70, flatPerSlotLevelAbove: 10 },
      addSpellcastingModifier: false,
    },
    { kind: 'end-condition', conditions: ['blinded', 'deafened', 'poisoned'] },
  ],
};

/**
 * SRD Haste:
 *
 * > _Level 3 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose a willing creature that you can see within range. Until the spell
 * > ends, the target's Speed is doubled, it gains a +2 bonus to Armor Class,
 * > it has Advantage on Dexterity saving throws, and it gains an additional
 * > action on each of its turns. That action can be used to take only the
 * > Attack (one attack only), Dash, Disengage, Hide, or Utilize action."
 * > "When the spell ends, the target is Incapacitated and has a Speed of 0
 * > until the end of its next turn, as a wave of lethargy washes over it."
 *
 * **Two of the four benefits in that run are things the engine owns**, and
 * they are written: the +2 is Shield of Faith's sentence word for word, and
 * the Advantage is a `roll-mode` narrowed to saving throws and to one ability,
 * which Beacon of Hope already writes twice in one definition.
 *
 * The other two are not, and each is a named shape rather than a shortcut. A
 * doubled Speed is the one sentence in the book that multiplies one, and
 * `SpeedChange` composes from a halving and a zero and has no third member.
 * An extra action — and then a narrowing of what it may be spent on — is the
 * action economy, which is the engine's outright and which nothing a spell
 * writes may add to. The lethargy fires when the casting *ends*, and expiry is
 * derived rather than recorded, so there is no hook to hang it on.
 */
export const HASTE: SpellDefinition = {
  id: 'haste',
  name: 'Haste',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  // "Choose a willing creature that you can see within range", which includes
  // you: Fly, Jump and Mage Armor are all transcribed that way, and willingness
  // is fiction.
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [
    // "it gains a +2 bonus to Armor Class"
    {
      kind: 'buff',
      bonus: { source: 'Haste', flat: 2 },
      applies: ['ac'],
      direction: 'add',
    },
    // "it has Advantage on Dexterity saving throws"
    {
      kind: 'roll-mode',
      modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'dex' } },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the doubled Speed: "the target’s Speed is doubled" is the only sentence in SRD that multiplies one, and a Speed is composed from a halving, which is presence rather than count, and a zero, which is last and wins — there is no third operation and no rule saying how a doubling meets a halving',
    'the extra action and the five it may be spent on: "it gains an additional action on each of its turns. That action can be used to take only the Attack (one attack only), Dash, Disengage, Hide, or Utilize action" — the action economy counts what a turn holds and nothing an effect writes adds to that count',
    'the lethargy: "When the spell ends, the target is Incapacitated and has a Speed of 0 until the end of its next turn" fires at the moment the casting runs out, and expiry is derived rather than recorded, so nothing hangs a consequence on it',
  ],
};

/**
 * SRD Gaseous Form:
 *
 * > _Level 3 Transmutation (Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "A willing creature you touch shape-shifts, along with everything it's
 * > wearing and carrying, into a misty cloud for the duration. ... The target
 * > has Resistance to Bludgeoning, Piercing, and Slashing damage; it has
 * > Immunity to the Prone condition; and it has Advantage on Strength,
 * > Dexterity, and Constitution saving throws."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 3."
 *
 * **One sentence of the paragraph is five effects, and all five are built.**
 * The Resistance is Stoneskin's `damage-defense` over three types; the
 * Immunity is IE-042's `condition-immunity`; and three abilities named in one
 * clause are three `roll-mode` effects, because a mode is selected by roll
 * family and ability and there is one selector per ability.
 *
 * Everything else about being a cloud is not, and the notes say which gap each
 * clause waits on. The spell is therefore **partial** rather than tracked: the
 * misty-cloud half is the table's and the five numbers are the engine's, and
 * writing none of them because some of them are missing would be a Gaseous
 * Form that a Fireball hurt at full price.
 */
export const GASEOUS_FORM: SpellDefinition = {
  id: 'gaseous-form',
  name: 'Gaseous Form',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  // "A willing creature you touch", which includes you, plus one more per slot
  // level above the third.
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [
    { kind: 'damage-defense', damageTypes: ['bludgeoning', 'piercing', 'slashing'], defense: 'resistant' },
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
  durationSeconds: 3600,
  unmodelled: [
    'the cloud itself is the DM’s: what the target looks like, that it "can pass through narrow openings", and that "it treats liquids as though they were solid surfaces" are fiction, and the gear coming along changes nothing the engine holds',
    'the spell ending "if it drops to 0 Hit Points" is not applied: a casting ends by its deadline, its Concentration, a dispel or one of five transcribed causes, and dropping to 0 is not among them',
    'the target ending it "as a Magic action" is not offered: `endOngoingSpell` is the caster’s door and costs nothing, and this sentence prints both exceptions — the **target** ends it, and the book charges a Magic action for the ending',
    'the movement is not changed: "the target’s only method of movement is a Fly Speed of 10 feet, and it can hover" needs a movement mode, and the engine tracks one Speed and no modes — so the target keeps the Speed it had',
    '"The target can enter and occupy the space of another creature" is not applied: occupancy is a rule the engine owns outright, and nothing lets an effect tell that rule to believe something different about one creature',
    'the things the cloud cannot do are not forbidden: "The target can’t talk or manipulate objects", "any objects it was carrying or holding can’t be dropped, used, or otherwise interacted with", and "the target can’t attack or cast spells" are an action economy rider and a fact about what is in a creature’s hands, and the engine has neither',
  ],
};

/**
 * SRD Levitate:
 *
 * > _Level 2 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "One creature or loose object of your choice that you can see within range
 * > rises vertically up to 20 feet and remains suspended there for the
 * > duration. ... An unwilling creature that succeeds on a Constitution saving
 * > throw is unaffected."
 *
 * Tracked, because the only thing the save decides is a lift the engine cannot
 * perform: nothing moves a creature vertically, and nothing holds one there.
 */
export const LEVITATE: SpellDefinition = {
  id: 'levitate',
  name: 'Levitate',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "One creature ... of your choice that you can see within range" — which may
  // be you, and which SRD says from the other end: the Boots of Levitation cast
  // this "on yourself", a sentence with no meaning if the caster were not a
  // legal target of it.
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the lift is not applied: "rises vertically up to 20 feet and remains suspended there for the duration" is forced movement a spell causes, and no effect reaches the one function that performs it',
    'the Constitution saving throw is not rolled, because a save is written as the gate on an outcome and the outcome here is that lift — "An unwilling creature that succeeds on a Constitution saving throw is unaffected", with nothing to be affected by',
    'moving the target afterwards is the DM’s: the 20 feet of altitude a turn, the climbing along a wall, and the Magic action somebody else spends to move it are all that same missing movement',
    'the object the spell may target instead, and its 500-pound limit, are the DM’s: objects are not modelled',
    '"the target floats gently to the ground if it is still aloft" ends a lift that never happened',
  ],
};

/**
 * SRD Scorching Ray:
 *
 * > _Level 2 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You hurl three fiery rays. You can hurl them at one target within range
 * > or at several. Make a ranged spell attack for each ray. On a hit, the
 * > target takes 2d6 Fire damage."
 * > _Using a Higher-Level Spell Slot._ "You create one additional ray for each
 * > spell slot level above 2."
 *
 * **Tracked, and it is the clearest case in the batch for not stretching.**
 * An `attack` effect rolls one attack per target; three rays that may all go
 * at one target, or at three, is the shape Eldritch Blast is blocked on and
 * the definition vocabulary already records by name. A definition that rolled
 * one ray would be a Scorching Ray dealing a third of its damage, and one that
 * rolled 6d6 in a single attack would be a Scorching Ray that hits or misses
 * as a whole — both are wrong answers wearing the look of a right one, where a
 * tracked definition is a right answer that spends the slot.
 */
export const SCORCHING_RAY: SpellDefinition = {
  id: 'scorching-ray',
  name: 'Scorching Ray',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  // "at one target within range or at several", and one more ray per slot level
  // above the second — so up to three targets at the spell's own level.
  targets: { count: 3, extraPerSlotLevelAbove: 1 },
  effects: [],
  unmodelled: [
    'the three rays are not thrown: "Make a ranged spell attack for each ray. On a hit, the target takes 2d6 Fire damage" is several attack rolls from one casting, which one casting cannot make — an effect rolls one attack per target and cannot put two rays on one creature',
    'the extra ray a higher slot buys is therefore not thrown either; the target count grows with the slot so the casting still records who was aimed at',
  ],
};

/**
 * SRD Scrying:
 *
 * > _Level 5 Divination (Bard, Cleric, Druid, Warlock, Wizard)._
 * > **Casting Time:** 10 minutes. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You can see and hear a creature you choose that is on the same plane of
 * > existence as you. The target makes a Wisdom saving throw, which is
 * > modified (see the tables below) by how well you know the target and the
 * > sort of physical connection you have to it."
 *
 * The rite takes ten minutes and then runs for ten, and both are the engine's.
 * What is not is the save: its DC is modified by two printed tables of facts
 * the engine does not hold and should never guess — how well a caster knows a
 * stranger, and whether they are holding a lock of the stranger's hair.
 */
export const SCRYING: SpellDefinition = {
  id: 'scrying',
  name: 'Scrying',
  level: 5,
  school: 'divination',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  concentration: true,
  // "Range: Self" — the sensor is the spell's, and the creature scryed upon is
  // chosen in the fiction rather than named as a target within reach.
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the save is not rolled: "The target makes a Wisdom saving throw, which is modified (see the tables below) by how well you know the target and the sort of physical connection you have to it" reads two tables of facts the engine does not hold — a knowledge band and a possession — and the DM owns both, which is the line declared cover and declared sight already draw',
    'the sensor is the DM’s: "an Invisible, intangible sensor within 10 feet of the target" that moves with it, what is seen and heard through it, and the luminous orb somebody might spot are all fiction',
    'the 24 hours a successful save buys the target are not held: nothing records that a creature has already resisted this spell',
    'targeting a location instead of a creature is the DM’s, for the same reason: a place you have seen is not a thing the scene holds',
  ],
};

/**
 * SRD Detect Thoughts:
 *
 * > _Level 2 Divination (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "You activate one of the effects below. Until the spell ends, you can
 * > activate either effect as a Magic action on your later turns."
 *
 * Tracked on the machinery beside it rather than on any of it. A `SpellActivation`
 * runs an attack or moves an area on a later turn, and neither of this spell's
 * two options is either: one senses thoughts, which is narration, and the other
 * probes a mind and makes its owner save — a later action that forces a saving
 * throw, which has the machinery beside it and no consumer.
 */
export const DETECT_THOUGHTS: SpellDefinition = {
  id: 'detect-thoughts',
  name: 'Detect Thoughts',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'Sense Thoughts is the DM’s: which thinking creatures are within 30 feet, and the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — are facts about a room',
    'Read Thoughts is the DM’s: "You learn what is most on the target’s mind right now" is information rather than state',
    'the deeper probe is not run: "As a Magic action on your next turn, you can try to probe deeper into the target’s mind. If you probe deeper, the target makes a Wisdom saving throw" is an activation that forces a saving throw, and every registered activation resolves an attack or moves an area instead',
    'the target’s escape is not offered: "the target can take an action on its turn to make an Intelligence (Arcana) check against your spell save DC, ending the spell on a success" is a check made by somebody the casting holds nothing on, and whose success ends the casting — an outcome `SpellCheck` deliberately has no member for, naming this spell',
  ],
};

/**
 * SRD Enlarge/Reduce:
 *
 * > _Level 2 Transmutation (Artificer, Bard, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "For the duration, the spell enlarges or reduces a creature or an object
 * > you can see within range (see the chosen effect below)."
 *
 * **The spell in the batch that is blocked by the choice rather than by the
 * effect.** Each branch's Advantage or Disadvantage on Strength checks and
 * Strength saving throws is a `roll-mode` the engine writes easily — and the
 * two branches say opposite things, so a definition would have to record which
 * the caster picked, and a choice made at the casting has nowhere to be
 * recorded. Writing either branch would be a spell that always enlarges.
 *
 * The Potion of Growth is the other end of that: the bottle **makes** the
 * choice, so the conferral writes the enlarge branch and nothing is guessed.
 */
export const ENLARGE_REDUCE: SpellDefinition = {
  id: 'enlarge-reduce',
  name: 'Enlarge/Reduce',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'which of the two effects was chosen is not recorded, and nothing below can be applied without it: the branches say opposite things — "The target also has Advantage on Strength checks and Strength saving throws" against "Disadvantage on Strength checks and Strength saving throws" — and a choice made at the casting has nowhere to be kept',
    'the size change is not applied either way: "The target’s size increases by one category" and "decreases by one category" write over a fact the engine holds authoritatively and reads for sharing a space, passing through and what an area catches',
    'the rider on the target’s later attacks is not hung: "deal an extra 1d4 damage on a hit" is extra damage with no type, so it is the weapon’s own, and "deal 1d4 less damage on a hit (this can’t reduce the damage below 1)" is a penalty on a damage roll that nothing grants',
    'the Constitution saving throw is not rolled, because what it gates is the size change above',
    'the gear changing size with the target, and a thrown weapon returning to normal after it hits or misses, are the DM’s',
  ],
};

/**
 * SRD Tiny Hut:
 *
 * > _Level 3 Evocation (Ritual) (Bard, Wizard)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Self.
 * > **Duration:** 8 hours.
 * > "A 10-foot Emanation springs into existence around you and remains
 * > stationary for the duration."
 *
 * The rite, the eight hours and the recast are the engine's; the dome is not.
 * Nothing in the scene stops a creature crossing a line, so a hut whose whole
 * rule is that it keeps people out has nothing to be.
 */
export const TINY_HUT: SpellDefinition = {
  id: 'tiny-hut',
  name: 'Tiny Hut',
  level: 3,
  school: 'evocation',
  // "Casting Time: 1 minute or Ritual" — so the Ritual version takes 660
  // seconds, which is the sum Alarm is the fixture for.
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 28_800,
  // "The spell ends early if ... you cast it again."
  replacesPriorCasting: true,
  unmodelled: [
    'the dome is not in the scene: "All other creatures and objects are barred from passing through it" is a barrier that blocks passage, and movement consults no walls — which is the boundary that keeps this a rules engine rather than a map editor',
    'the spell failing at the casting "if the Emanation isn’t big enough to fully encapsulate all creatures in its area" is the DM’s, because there is no Emanation for anybody to be inside of',
    'the ward against magic is not applied: "Spells of level 3 or lower can’t be cast through it, and the effects of such spells can’t extend into it" is an area that refuses other magic, and no state says a casting is being refused',
    'the other half of the ending — "The spell ends early if you leave the Emanation" — is not applied: a casting ends by its deadline, its Concentration, a dispel, a recast or one of five transcribed causes, and leaving an area is not among them',
    'the weather, the light the caster commands inside, the opacity and the colour are all the DM’s',
  ],
};

/**
 * SRD Private Sanctum:
 *
 * > _Level 4 Abjuration (Wizard)._ **Casting Time:** 10 minutes.
 * > **Range:** 120 feet. **Duration:** 24 hours.
 * > "You make an area within range magically secure. The area is a Cube that
 * > can be as small as 5 feet to as large as 100 feet on each side."
 * > _Using a Higher-Level Spell Slot._ "You can increase the size of the Cube
 * > by 100 feet for each spell slot level above 4."
 *
 * Six properties chosen at the casting, and every one of them is a thing that
 * does not happen: sound, sight, divination sensors, targeting, teleportation
 * and planar travel are all refusals an area makes, and nothing in the engine
 * can be refused by a place.
 */
export const PRIVATE_SANCTUM: SpellDefinition = {
  id: 'private-sanctum',
  name: 'Private Sanctum',
  level: 4,
  school: 'abjuration',
  // "Casting Time: 10 minutes."
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  // "Range: 120 feet", to the area rather than to a creature.
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the Cube is not placed: the spell wards an area rather than catching creatures in one, and the size the caster chooses — 5 to 100 feet a side, and 100 feet more per slot level above the fourth — has nothing to be the size of',
    'the barrier is not a barrier: "Sound can’t pass through the barrier at the edge of the warded area" and the fog that prevents vision through it are things that stop passage, and nothing consults a wall',
    'the wards against other magic are not applied: "Sensors created by Divination spells can’t appear inside the protected area", "Creatures in the area can’t be targeted by Divination spells", "Nothing can teleport into or out of the warded area" and "Planar travel is blocked within the warded area" are an area refusing other magic, and no state says a casting is being refused',
    '"Casting this spell on the same spot every day for 365 days makes the spell last until dispelled" is the DM’s: the clock holds elapsed seconds and nothing counts a rite repeated on a spot',
  ],
};

/**
 * SRD Resilient Sphere:
 *
 * > _Level 4 Abjuration (Artificer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "A shimmering sphere encloses a Large or smaller creature or object within
 * > range. An unwilling creature must succeed on a Dexterity saving throw or
 * > be enclosed for the duration."
 *
 * Every rule the sphere has is the sphere's, and there is no sphere: what it
 * keeps out, what it is immune to, and the half-Speed roll somebody inside
 * gives it are all facts about a barrier the scene has no room for.
 */
export const RESILIENT_SPHERE: SpellDefinition = {
  id: 'resilient-sphere',
  name: 'Resilient Sphere',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'being enclosed is not a state: "An unwilling creature must succeed on a Dexterity saving throw or be enclosed for the duration" gates a barrier rather than one of the fifteen conditions, so the save has nothing to impose and is not rolled',
    'what the sphere keeps apart is not enforced: "Nothing—not physical objects, energy, or other spell effects—can pass through the barrier, in or out", the Immunity of the sphere itself, and neither side being able to damage the other are a barrier that blocks passage',
    'the sphere cannot be moved: "An enclosed creature can take an action to push against the sphere’s walls and thus roll the sphere at up to half the creature’s Speed" moves the barrier, and the barrier is the thing that does not exist — the same is true of other creatures picking the globe up',
    '"A _Disintegrate_ spell targeting the globe destroys it without harming anything inside" targets the same absent barrier; Disintegrate reaches creatures and objects, and the globe is neither',
    'the size limit — "a Large or smaller creature or object" — is not checked: a target rule selects by creature type and by whether armour is worn, and size is held and read by nothing here',
  ],
};

/**
 * SRD Gate:
 *
 * > _Level 9 Conjuration (Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "You conjure a portal linking an unoccupied space you can see within range
 * > to a precise location on a different plane of existence."
 *
 * There is one scene, so the far end of the portal has nowhere to be — and
 * that is the whole of the debt. The near end is an ordinary space, the minute
 * is an ordinary minute and the Concentration is real.
 */
export const GATE: SpellDefinition = {
  id: 'gate',
  name: 'Gate',
  level: 9,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // The portal stands in a space rather than on a creature.
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the portal has no far end: "a precise location on a different plane of existence" is a second place to put a creature, and there is one scene — so the diameter the caster chooses, the direction it is oriented in and the destination visible through it are all geometry of a thing with nowhere to be',
    'nobody travels through it: "Travel through the portal is possible only by moving through its front" and "Anything that does so is instantly transported to the other plane" move a creature off the scene entirely, which no command does',
    'the creature the caster names is not brought through: "the portal opens next to the named creature and transports it" fetches somebody from a plane the model has no room for, and what it does next — "It might leave, attack you, or help you" — the book gives to the GM in the same breath',
    '"Deities and other planar rulers can prevent portals created by this spell from opening in their presence" is the DM’s',
  ],
};

/**
 * SRD Teleport:
 *
 * > _Level 7 Conjuration (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 10 feet. **Duration:** Instantaneous.
 * > "This spell instantly transports you and up to eight willing creatures
 * > that you can see within range, or a single object that you can see within
 * > range, to a destination you select."
 *
 * Eight travellers counted the way Plane Shift counts them — the caster goes
 * along and is not one of the eight — and a destination the scene has no room
 * for. The whole of the familiarity table is then a d100 the GM throws.
 */
export const TELEPORT: SpellDefinition = {
  id: 'teleport',
  name: 'Teleport',
  level: 7,
  school: 'conjuration',
  castingTime: 'action',
  range: { kind: 'ranged', feet: 10 },
  concentration: false,
  // "you and up to eight willing creatures that you can see within range": the
  // caster travels regardless, so eight is the list and `self` is not offered,
  // which is Plane Shift's sentence and Plane Shift's transcription.
  targets: { count: 8, optional: true },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'the destination is not reached: "to a destination you select" is a second place to put a creature and there is one scene, so nobody is moved and the object a casting may carry instead is not held by the scene either',
    'the familiarity roll is not made: "The GM rolls 1d100 and consults the Teleportation Outcome table" is a die the generator could throw that no effect asks it for, and the table it indexes reads how well the caster knows a place — a fact the engine does not hold',
    'the three ways it can go wrong are therefore not applied: the Mishap’s "3d10 Force damage, and the GM rerolls on the table", the Off Target "2d12 miles away from the destination in a random direction" with a 1d8 for the compass point, and the Similar Area are all outcomes of that roll',
  ],
};

/**
 * SRD Etherealness:
 *
 * > _Level 7 Conjuration (Bard, Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Self. **Duration:** Up to 8 hours.
 * > "You step into the border regions of the Ethereal Plane, where it overlaps
 * > with your current plane. You remain in the Border Ethereal for the
 * > duration."
 * > _Using a Higher-Level Spell Slot._ "You can target up to three willing
 * > creatures (including yourself) for each spell slot level above 7. The
 * > creatures must be within 10 feet of you when you cast the spell."
 *
 * The eight hours run without Concentration, which makes it the longest clock
 * an item in this batch starts. Where the caster has gone is the one scene's
 * absence in its most awkward form: the creature keeps its position and is
 * unreachable, and nothing can hold both of those at once.
 */
export const ETHEREALNESS: SpellDefinition = {
  id: 'etherealness',
  name: 'Etherealness',
  level: 7,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  // At its own level it reaches nobody but the caster; three more per slot
  // level above the seventh, and "(including yourself)" is `self`.
  targets: { count: 0, extraPerSlotLevelAbove: 3, self: true },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'the Border Ethereal is not a place: "You step into the border regions of the Ethereal Plane" is a second place to put a creature, and there is one scene — so nobody leaves, nobody becomes unreachable, and "you can affect and be affected only by creatures, objects, and effects on that plane" is the DM’s',
    'the movement there is not charged: "you can move in any direction" and "If you move up or down, every foot of movement costs an extra foot" are a movement mode and the per-foot cost that rides with it',
    'the sight is not bounded: "you can’t see anything there more than 60 feet away" reaches from one plane into another, and sight here is a declaration between two creatures in one scene',
    'the return is not performed: "you return to the plane you left in the spot that corresponds to your space", the shunt to the nearest unoccupied space, and the "Force damage equal to twice the number of feet you are moved" are forced movement and an amount derived from it rather than printed',
    '"This spell ends instantly if you cast it while you are on the Ethereal Plane" reads which plane the caster is already on, which is the same absence as a precondition',
    'the 10 feet the extra targets must be within is not checked: the spell’s Range is Self, so no per-target distance is measured, and the clause travels with the slot rather than with the range',
  ],
};

/**
 * SRD Telekinesis:
 *
 * > _Level 5 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You gain the ability to move or manipulate creatures or objects by
 * > thought. When you cast the spell and as a Magic action on your later turns
 * > before the spell ends, you can exert your will on one creature or object
 * > that you can see within range."
 *
 * Everything this spell does is an **exertion** — at the casting and on every
 * later turn — and an activation that forces a saving throw has the machinery
 * beside it and no consumer. So the casting is real and takes no target: who
 * is being lifted is chosen by an exertion, and the spell may change its mind
 * round after round.
 */
export const TELEKINESIS: SpellDefinition = {
  id: 'telekinesis',
  name: 'Telekinesis',
  level: 5,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the exertion is not run: "as a Magic action on your later turns before the spell ends, you can exert your will on one creature or object" is an activation that forces a saving throw, and every registered activation resolves an attack or moves an area instead — so no target is named at the casting either',
    'a creature is not moved: "The target must succeed on a Strength saving throw, or you move it up to 30 feet in any direction within the spell’s range" is forced movement a spell causes',
    'the Restrained condition the failed save would impose is not applied, because nothing rolls the save that would impose it; nor is the fall "at the end of your next turn unless you use this option on it again"',
    'the object half is not applied: moving a loose object is a fact about objects, and pulling one away from whoever holds it reads what a creature is holding, which the engine does not keep',
    'the size limit — "a Huge or smaller creature" — is not checked: size is held and read by no target rule',
    'the fine control — "manipulating a simple tool, opening a door or a container, stowing or retrieving an item" — is the DM’s',
  ],
};

/**
 * SRD Resurrection:
 *
 * > _Level 7 Necromancy (Bard, Cleric)._ **Casting Time:** 1 hour.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "With a touch, you revive a dead creature that has been dead for no more
 * > than a century, didn't die of old age, and wasn't Undead when it died."
 *
 * An hour's rite the engine now runs, over a raising it cannot perform:
 * `healCreature` refuses a corpse and the refusal costs no slot, so hit points
 * alone will not bring anybody back.
 */
export const RESURRECTION: SpellDefinition = {
  id: 'resurrection',
  name: 'Resurrection',
  level: 7,
  school: 'necromancy',
  // "Casting Time: 1 hour."
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'nobody is raised: "The creature returns to life with all its Hit Points" is healing that raises the dead, and `healCreature` refuses a creature that is dead — a debt rather than fiction, because the hit points themselves are ordinary',
    'the three conditions on the corpse are the DM’s: how long it has been dead, whether it died of old age, and whether it was Undead are facts about a body the engine does not hold',
    'the −4 penalty on D20 Tests is not applied, and neither is its recovery: "Every time the target finishes a Long Rest, the penalty is reduced by 1 until it becomes 0" needs a selector for every D20 Test, which is deliberately absent, and a deadline anchored to a rest',
    'the cost to the caster is not applied: "Until you finish a Long Rest, you can’t cast spells again, and you have Disadvantage on D20 Tests" is the same missing selector, over a rest the clock measures and no deadline can name',
    'the poisons neutralised, the mortal wounds closed and the body parts restored are the DM’s',
  ],
};

/**
 * SRD Dancing Lights:
 *
 * > _Illusion Cantrip (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create up to four torch-size lights within range, making them appear
 * > as torches, lanterns, or glowing orbs that hover for the duration.
 * > Alternatively, you combine the four lights into one glowing Medium form
 * > that is vaguely humanlike. Whichever form you choose, each light sheds Dim
 * > Light in a 10-foot radius."
 * > "As a Bonus Action, you can move the lights up to 60 feet to a space
 * > within range. A light must be within 20 feet of another light created by
 * > this spell, and a light vanishes if it exceeds the spell's range."
 *
 * The whole spell is light, and the engine has no lighting — so not one
 * sentence of it trips a mechanical marker and the definition owes the table
 * every word. What it does owe the *engine* is the minute of Concentration a
 * cantrip is charging for, which is the thing that was going unspent.
 */
export const DANCING_LIGHTS: SpellDefinition = {
  id: 'dancing-lights',
  name: 'Dancing Lights',
  level: 0,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the lights are not in the world: four torch-size lights, or one glowing Medium form, are the DM’s, and nothing can be positioned at, moved with or seen by them',
    'the Dim Light each one sheds in a 10-foot radius is not applied; the engine has no lighting',
    'the Bonus Action that moves the lights up to 60 feet is not offered, and neither the 20-foot tether between two lights nor a light vanishing outside the spell’s range is checked — the lights have no positions to measure',
  ],
};

/**
 * SRD Daylight:
 *
 * > _Level 3 Evocation (Cleric, Druid, Paladin, Ranger, Sorcerer)._
 * > **Casting Time:** Action. **Range:** 60 feet. **Duration:** 1 hour.
 * > "For the duration, sunlight spreads from a point within range and fills a
 * > 60-foot-radius Sphere. The sunlight's area is Bright Light and sheds Dim
 * > Light for an additional 60 feet."
 * > "Alternatively, you cast the spell on an object that isn't being worn or
 * > carried, causing the sunlight to fill a 60-foot Emanation originating from
 * > that object. Covering that object with something opaque, such as a bowl or
 * > helm, blocks the sunlight."
 * > "If any of this spell's area overlaps with an area of Darkness created by
 * > a spell of level 3 or lower, that other spell is dispelled."
 *
 * **No area is recorded, and that is deliberate.** A `SpellArea` is what an
 * effect is resolved over, and there is no effect here: sunlight reaches
 * nothing the engine holds. A Sphere with nothing in it would be a template
 * the casting pins and nobody reads, which is a second place to get the radius
 * wrong for no gain — so the sixty feet are quoted to the table instead, where
 * the thing that reads them is a person.
 */
export const DAYLIGHT: SpellDefinition = {
  id: 'daylight',
  name: 'Daylight',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the light is not modelled: a 60-foot-radius Sphere of Bright Light, and Dim Light for an additional 60 feet, are the DM’s — the engine has no lighting and nothing reads whether a square is lit',
    'the object the spell may be cast on instead, the 60-foot Emanation it carries, and covering it with a bowl or a helm are the DM’s; objects are not modelled',
    'the dispel is not performed: "If any of this spell’s area overlaps with an area of Darkness created by a spell of level 3 or lower, that other spell is dispelled" — ending a casting is an operation the engine has, and no Darkness definition compiles in for it to reach',
  ],
};

/**
 * SRD Druidcraft:
 *
 * > _Transmutation Cantrip (Druid)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "Whispering to the spirits of nature, you create one of the following
 * > effects within range."
 * > _Weather Sensor._ … _Bloom._ … _Sensory Effect._ … _Fire Play._
 *
 * A choice of four, and **not one of the four is arithmetic** — which is the
 * whole of why the choice needs nowhere to be recorded. `blocked-on.test.ts`
 * draws that line by name against Thaumaturgy, whose sixth branch grants
 * Advantage on a Charisma (Intimidation) check and so *does* decide something.
 */
export const DRUIDCRAFT: SpellDefinition = {
  id: 'druidcraft',
  name: 'Druidcraft',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'which of the four effects is chosen is not recorded, because none of them is arithmetic: a weather sensor, a blossom, a sensory effect and a lit or snuffed flame are all the DM’s',
    'the weather sensor’s round of existence is not a duration the engine runs: the spell is Instantaneous and the Tiny effect it leaves is fiction',
  ],
};

/**
 * SRD Elementalism:
 *
 * > _Transmutation Cantrip (Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:**
 * > Instantaneous.
 * > "You exert control over the elements, creating one of the following
 * > effects within range."
 * > _Beckon Air._ … _Beckon Earth._ … _Beckon Fire._ … _Beckon Water._ …
 * > _Sculpt Element._
 *
 * Druidcraft with five branches instead of four, and the same answer for the
 * same reason: a breeze, a shroud of dust, a cloud of embers, a spray of mist
 * and a crude shape are the DM's, so nothing has to remember which was picked.
 */
export const ELEMENTALISM: SpellDefinition = {
  id: 'elementalism',
  name: 'Elementalism',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'which of the five effects is chosen is not recorded, because none of them is arithmetic: a breeze that closes shutters, a shroud of dust, a cloud of harmless embers, a spray of cool mist and a crude sculpted shape are all the DM’s',
    'the 5-foot Cube each branch fits in is not a template: nothing is resolved over it, so the size is quoted rather than pinned',
    'the minute the smoke’s scent lingers, the minute the cup of water takes to evaporate and the hour a sculpted shape holds are the DM’s; the spell itself is Instantaneous and runs no clock',
  ],
};

/**
 * SRD Create or Destroy Water:
 *
 * > _Level 1 Transmutation (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "You do one of the following:"
 * > _Create Water._ "You create up to 10 gallons of clean water within range
 * > in an open container. Alternatively, the water falls as rain in a 30-foot
 * > Cube within range, extinguishing exposed flames there."
 * > _Destroy Water._ "You destroy up to 10 gallons of water in an open
 * > container within range. Alternatively, you destroy fog in a 30-foot Cube
 * > within range."
 * > _Using a Higher-Level Spell Slot._ "You create or destroy 10 additional
 * > gallons of water, or the size of the Cube increases by 5 feet, for each
 * > spell slot level above 1."
 *
 * The slot buys gallons and feet of Cube, and the engine holds neither — so
 * the scaling is quoted to the table with everything else rather than being
 * half-applied to a target count nothing uses.
 */
export const CREATE_OR_DESTROY_WATER: SpellDefinition = {
  id: 'create-or-destroy-water',
  name: 'Create or Destroy Water',
  level: 1,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the water is not a thing in the world: ten gallons created in an open container, or destroyed in one, are the DM’s',
    'the rain in a 30-foot Cube and the exposed flames it extinguishes are the DM’s, and so is the fog destroyed in a Cube of the same size — fog is not a state the engine holds, even where another spell made it',
    'the higher slot buys gallons and feet — "You create or destroy 10 additional gallons of water, or the size of the Cube increases by 5 feet" — and neither is a number any effect of this definition reads',
  ],
};

/**
 * SRD Fog Cloud:
 *
 * > _Level 1 Conjuration (Druid, Ranger, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 1 hour.
 * > "You create a 20-foot-radius Sphere of fog centered on a point within
 * > range. The Sphere is Heavily Obscured. It lasts for the duration or until
 * > a strong wind (such as one created by _Gust of Wind_) disperses it."
 * > _Using a Higher-Level Spell Slot._ "The fog's radius increases by 20 feet
 * > for each spell slot level above 1."
 *
 * **The slot grows the area, and an area is one fixed size.** That is the
 * clause `blocked-on.test.ts` records under protest for Confusion's Sphere,
 * and it is the second spell in the book to print it — so a definition that
 * pinned a 20-foot Sphere would resolve a level 5 casting over the level 1
 * template. Nothing is resolved over this fog at all, which is what makes the
 * omission safe here and makes the sentence the table's rather than a
 * template's.
 */
export const FOG_CLOUD: SpellDefinition = {
  id: 'fog-cloud',
  name: 'Fog Cloud',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the fog is not in the world: a 20-foot-radius Sphere that is Heavily Obscured is the DM’s, because obscurement is not a state the engine holds and no square is inside or outside anything',
    'the radius growing by 20 feet for each slot level above 1 is not applied; a slot reaches damage dice, a target count and a duration, and never an area',
    '"until a strong wind (such as one created by Gust of Wind) disperses it" is the DM’s: the wind is fiction here, and a casting the engine ends is one it can see ending',
  ],
};

/**
 * SRD Purify Food and Drink:
 *
 * > _Level 1 Transmutation (Cleric, Druid, Paladin) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** 10 feet.
 * > **Duration:** Instantaneous.
 * > "You remove poison and rot from nonmagical food and drink in a 5-foot-
 * > radius Sphere centered on a point within range."
 *
 * One sentence, and every noun in it is an object. What is left for the engine
 * is a slot, an action and a Ritual tag — which is the whole argument for the
 * tracked bucket in its smallest possible form.
 */
export const PURIFY_FOOD_AND_DRINK: SpellDefinition = {
  id: 'purify-food-and-drink',
  name: 'Purify Food and Drink',
  level: 1,
  school: 'transmutation',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the food and drink are objects and objects are not modelled: which of them were in the 5-foot-radius Sphere, and that they are no longer poisoned or rotten, are the DM’s',
    'the Poisoned condition is a creature’s and is untouched by this spell — nothing here cures anybody, and a definition that removed one would be inventing a rule the sentence does not print',
  ],
};

/**
 * SRD Zone of Truth:
 *
 * > _Level 2 Enchantment (Bard, Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** 10 minutes.
 * > "You create a magical zone that guards against deception in a 15-foot-
 * > radius Sphere centered on a point within range. Until the spell ends, a
 * > creature that enters the spell's area for the first time on a turn or
 * > starts its turn there makes a Charisma saving throw. On a failed save, a
 * > creature can't speak a deliberate lie while in the radius. You know
 * > whether a creature succeeds or fails on this save."
 * > "An affected creature is aware of the spell and can avoid answering
 * > questions to which it would normally respond with a lie. Such a creature
 * > can be evasive yet must be truthful."
 *
 * **The save is real and what it gates is not.** `AreaTrigger` would raise the
 * Charisma save on exactly the two moments the sentence names — the engine has
 * had both since Web — and a failure would then have to impose *not being able
 * to lie*, which is neither a condition nor any other state the engine holds.
 * A trigger that rolled a save and did nothing with it would be dice thrown
 * for no reason, so the save goes to the table with the silence it buys.
 */
export const ZONE_OF_TRUTH: SpellDefinition = {
  id: 'zone-of-truth',
  name: 'Zone of Truth',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the Charisma saving throw is not rolled: what a failure buys — "a creature can’t speak a deliberate lie while in the radius" — is not a condition and not any state the engine holds, so the trigger that would raise the save on entering the zone or starting a turn there has nothing to impose and is not registered',
    'the zone is not in the world: a 15-foot-radius Sphere centred on a point is the DM’s, because nothing is resolved over it',
    'the caster knowing whether each creature succeeded or failed, a creature being aware of the spell, and its evasions are the DM’s',
  ],
};

/**
 * SRD Conjure Fey:
 *
 * > _Level 6 Conjuration (Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You conjure a Medium spirit from the Feywild in an unoccupied space you
 * > can see within range. The spirit lasts for the duration, and it looks
 * > like a Fey creature of your choice.
 * >
 * > When the spirit appears, you can make one melee spell attack against a
 * > creature within 5 feet of it. On a hit, the target takes Psychic damage
 * > equal to 3d12 plus your spellcasting ability modifier, and the target has
 * > the Frightened condition until the start of your next turn, with both you
 * > and the spirit as the source of the fear.
 * >
 * > As a Bonus Action on your later turns, you can teleport the spirit to an
 * > unoccupied space you can see within 30 feet of the space it left and make
 * > the attack against a creature within 5 feet of it."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d12 for each
 * > spell slot level above 6."
 *
 * **The Conjure that is not a summon.** `CLAUDE.md` once filed "the four
 * Conjures" under a stat block created mid-fight, and SRD 5.2.1 rewrote the
 * family as spirits: this one prints no Armour Class, no Hit Points and no
 * turn of its own. What it prints is Spiritual Weapon's three numbers in
 * Spiritual Weapon's three places — a Range that says where the point may
 * first be put, a reach the attack is measured by, and an allowance a later
 * Bonus Action may move it by — so it is executed with the machinery that
 * already existed, which is the whole of what `blocked-on.test.ts` meant by
 * recording it as blocked on nothing.
 *
 * The one word that differs is **teleport**, and it changes nothing here: the
 * spirit is a coordinate on the casting rather than a creature, so moving it
 * thirty feet and teleporting it thirty feet are the same write.
 */
export const CONJURE_FEY: SpellDefinition = {
  id: 'conjure-fey',
  name: 'Conjure Fey',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "you **can** make one melee spell attack": the spirit appears whether or
  // not there is anything standing next to it — Spiritual Weapon's wording,
  // against Arcane Sword's "you make".
  targets: { count: 1, optional: true },
  origin: { reach: 5, movableBy: 30 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '3d12', perSlotLevelAbove: '1d12' },
      damageType: 'psychic',
      addSpellcastingModifier: true,
      conditions: [{ name: 'frightened', lasts: 'start-of-casters-next-turn' }],
    },
  ],
  durationSeconds: 600,
  activation: {
    action: 'bonus-action',
    // No `range`: the five feet are the spirit's reach and live on `origin`.
    // The thirty feet the spirit may move are `origin.movableBy` for the same
    // reason — one sentence, one field.
    label: 'Conjure Fey (the spirit strikes again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '3d12', perSlotLevelAbove: '1d12' },
        damageType: 'psychic',
        addSpellcastingModifier: true,
        conditions: [{ name: 'frightened', lasts: 'start-of-casters-next-turn' }],
      },
    ],
  },
  unmodelled: [
    'what the spirit looks like — "a Fey creature of your choice" — is narration, and nothing mechanical reads it',
    '"with both you and the spirit as the source of the fear" names two sources for one Frightened condition; a condition carries the casting that imposed it and the spirit is not a creature, so the second source is the DM’s',
  ],
};

/**
 * SRD Command:
 *
 * > _Level 1 Enchantment (Bard, Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You speak a one-word command to a creature you can see within range. The
 * > target must succeed on a Wisdom saving throw or follow the command on its
 * > next turn. Choose the command from these options:"
 * > _Approach._ … _Drop._ … _Flee._ … _Grovel._ … _Halt._
 * > _Using a Higher-Level Spell Slot._ "You can affect one additional
 * > creature for each spell slot level above 1."
 *
 * The whole spell in five words: **a creature's next turn is spent doing what
 * somebody else said.** The action economy is the engine's and the only lever
 * a spell has on it is a condition the engine names, so all five options are
 * the table's — including Grovel, whose Prone is an ordinary `condition`
 * effect and whose "and then ends its turn" is not. Writing the Prone alone
 * would be half a sentence.
 */
export const COMMAND: SpellDefinition = {
  id: 'command',
  name: 'Command',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'the Wisdom saving throw is not rolled, because what it gates cannot be imposed: "follow the command on its next turn" spends somebody else’s turn, and nothing lets a spell reach the action economy except by naming a condition',
    'which of the five commands was spoken is not recorded; a per-casting choice has nowhere to be kept, and a damage type is the one choice that does',
    'Approach and Flee are not applied: a route nobody chose, a turn that ends early on arrival, and a whole turn spent running are compelled movement, and `moveCreature` has no notion of a move the rules require',
    'Drop is not applied: what is in a creature’s hands is not a fact the engine holds, so a rule that makes it let go has nothing to call',
    'Grovel is not applied: the Prone is an ordinary condition and the clause beside it that ends the creature’s turn is not, so the engine writes neither rather than half of one',
    'Halt is not applied: forbidding the move, the action and the Bonus Action together is the Incapacitated condition’s effect without the condition, and nothing reaches `mayAct` except through a condition the engine knows',
  ],
};

/**
 * SRD Faerie Fire:
 *
 * > _Level 1 Evocation (Bard, Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "Objects in a 20-foot Cube within range are outlined in blue, green, or
 * > violet light (your choice). Each creature in the Cube is also outlined if
 * > it fails a Dexterity saving throw. For the duration, objects and affected
 * > creatures shed Dim Light in a 10-foot radius and can't benefit from the
 * > Invisible condition."
 * > "Attack rolls against an affected creature or object have Advantage if
 * > the attacker can see it."
 *
 * **The save is ordinary and what it buys is a subtraction.** Failing it does
 * not *give* the target a condition; it takes away the benefit of one it may
 * already have — `conditionApplicability` grants the Invisible its effects
 * and nothing narrows them for a single creature — and hands every attacker
 * who can see it Advantage besides. A `save` effect with no condition to
 * impose would be a die thrown for nothing, so the Cube is not resolved over
 * and the sentence goes to the table whole.
 */
export const FAERIE_FIRE: SpellDefinition = {
  id: 'faerie-fire',
  name: 'Faerie Fire',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Dexterity saving throw is not rolled: what a failure buys is the loss of a condition’s benefit rather than a condition, and nothing narrows what the Invisible condition does to one creature',
    'the 20-foot Cube is not a template: nothing is resolved over it, so which creatures and objects are inside it is the DM’s',
    'the Dim Light each outlined thing sheds in a 10-foot radius is not applied; the engine has no lighting',
    '"Attack rolls against an affected creature or object have Advantage if the attacker can see it" is not granted: the Advantage is ordinary and the gate on it is not, because declared sight is a pairwise fact and the outline is not a state anything reads',
  ],
};

/**
 * SRD Animal Messenger:
 *
 * > _Level 2 Enchantment (Bard, Druid, Ranger) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** 30 feet.
 * > **Duration:** 24 hours.
 * > "A Tiny Beast of your choice that you can see within range must succeed
 * > on a Charisma saving throw, or it attempts to deliver a message for you
 * > (if the target's Challenge Rating isn't 0, it automatically succeeds). …"
 * > _Using a Higher-Level Spell Slot._ "The spell's duration increases by 48
 * > hours for each spell slot level above 2."
 *
 * The one clause here the engine could have got wrong quietly is the
 * **duration band**, and `durationAtSlot` takes the whole table: twenty-four
 * hours at level 2 and forty-eight more for every level above it, written out
 * rather than computed, because the SRD prints a different table for each
 * spell that has one.
 */
export const ANIMAL_MESSENGER: SpellDefinition = {
  id: 'animal-messenger',
  name: 'Animal Messenger',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, mustBeType: 'Beast' },
  requiresSight: true,
  effects: [],
  durationSeconds: 86_400,
  // "+48 hours for each spell slot level above 2", as the band table the
  // field takes: the value is the whole duration rather than the increase.
  durationAtSlot: {
    3: 259_200,
    4: 432_000,
    5: 604_800,
    6: 777_600,
    7: 950_400,
    8: 1_123_200,
    9: 1_296_000,
  },
  unmodelled: [
    'the Charisma saving throw is not rolled: the parenthesis that decides it — "if the target’s Challenge Rating isn’t 0, it automatically succeeds" — reads a Challenge Rating no target rule can ask for, and neither can the Tiny that picks the Beast',
    'the errand is the DM’s: the location, the recipient "who matches a general description", the message of up to twenty-five words, the 25 or 50 miles a day and the Beast returning if it does not arrive are all narration',
  ],
};

/**
 * SRD Gust of Wind:
 *
 * > _Level 2 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "A Line of strong wind 60 feet long and 10 feet wide blasts from you in a
 * > direction you choose for the duration. Each creature in the Line must
 * > succeed on a Strength saving throw or be pushed 15 feet away from you in
 * > a direction following the Line. A creature that ends its turn in the Line
 * > must make the same save. Any creature in the Line must spend 2 feet of
 * > movement for every 1 foot it moves when moving closer to you. The gust
 * > disperses gas or vapor, and it extinguishes candles and similar
 * > unprotected flames in the area. It causes protected flames, such as those
 * > of lanterns, to dance wildly and has a 50 percent chance to extinguish
 * > them. As a Bonus Action on your later turns, you can change the direction
 * > in which the Line blasts from you."
 *
 * A Line is a shape the engine has and a Line that **turns** is not: the
 * Bonus Action re-aims it every round, and an area is fixed where the casting
 * put it. So the wind is tracked, and the three sentences underneath it — a
 * save that pushes, a doubled cost to walk into it, and a coin flip over a
 * lantern — are three different missing shapes stacked in one paragraph.
 */
export const GUST_OF_WIND: SpellDefinition = {
  id: 'gust-of-wind',
  name: 'Gust of Wind',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Strength saving throw is not rolled: what a failure buys is "pushed 15 feet away from you in a direction following the Line", and no spell effect reaches the forced movement `moveCreature` already performs',
    'the Line is not a template: 60 feet long and 10 feet wide is a shape the engine has, and the Bonus Action that changes the direction it blasts in on a later turn re-aims an area a casting fixed where it was put',
    'the repeat save a creature makes for ending its turn in the Line is not raised, because the Line is not there to end a turn in',
    'the doubled cost of walking into the wind — "must spend 2 feet of movement for every 1 foot it moves when moving closer to you" — is not charged: Difficult Terrain is declared by the foot on the move that crosses it, and no area declares any',
    'the gas dispersed, the unprotected candles snuffed and the protected flames dancing are the DM’s, and so is the "50 percent chance to extinguish them", which is a random outcome that is not a d20',
  ],
};

/**
 * SRD Polymorph:
 *
 * > _Level 4 Transmutation (Bard, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Concentration, up to 1 hour.
 * > "You attempt to transform a creature that you can see within range into a
 * > Beast. The target must succeed on a Wisdom saving throw or shape-shift
 * > into a Beast form for the duration. … The target's game statistics are
 * > replaced by the stat block of the chosen Beast, but the target retains
 * > its alignment, personality, creature type, Hit Points, and Hit Point
 * > Dice. … The target gains a number of Temporary Hit Points equal to the
 * > Hit Points of the Beast form. These Temporary Hit Points vanish if any
 * > remain when the spell ends. The spell ends early on the target if it has
 * > no Temporary Hit Points left."
 *
 * Every number in this spell comes off a **second creature's** sheet, and the
 * engine holds one sheet per creature and no way to lend another. The
 * Temporary Hit Points are the clause that makes that concrete: the amount is
 * the Beast's Hit Points, which nothing can look up, and their running out is
 * the trigger `a-casting-ended-by-a-trigger` names this spell for by name.
 */
export const POLYMORPH: SpellDefinition = {
  id: 'polymorph',
  name: 'Polymorph',
  level: 4,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the Wisdom saving throw is not rolled: what a failure buys is "The target’s game statistics are replaced by the stat block of the chosen Beast", and a creature’s sheet is a fact the engine holds authoritatively with nothing that writes over one for a duration',
    'which Beast was chosen is the DM’s, and so is the bound on it: "a Challenge Rating equal to or less than the target’s (or the target’s level if it doesn’t have a Challenge Rating)" selects a form by a number no target rule can ask for',
    'the Temporary Hit Points are not granted: the amount is the Hit Points of a Beast form nothing can look up, and their vanishing when the spell ends and the spell ending early when they run out are the two halves of a trigger no casting-end cause expresses',
    'the limits on the new form are the DM’s: the anatomy that bounds its actions, being unable to speak or cast spells, and the gear that melds into it and stops working',
  ],
};

/**
 * SRD Freedom of Movement:
 *
 * > _Level 4 Abjuration (Bard, Cleric, Druid, Ranger)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a willing creature. For the duration, the target's movement is
 * > unaffected by Difficult Terrain, and spells and other magical effects can
 * > neither reduce the target's Speed nor cause the target to have the
 * > Paralyzed or Restrained conditions. The target also has a Swim Speed
 * > equal to its Speed."
 * > "In addition, the target can spend 5 feet of movement to automatically
 * > escape from nonmagical restraints, such as manacles or a creature
 * > imposing the Grappled condition on it."
 *
 * **Four sentences and four different absences**, which is why reading this
 * paragraph found a blocker the bare list had missed. Every clause is a
 * refusal — of terrain, of a Speed reduction, of two conditions, of a
 * restraint — and a refusal needs a state in which something is *being*
 * refused. `speedOf` reads every grant a source hung and has no notion of one
 * that does not land; `conditionImmunitiesOf` answers about a condition and
 * knows nothing of what caused it, so a Ghoul's Paralyzed would be turned
 * aside along with Hold Person's.
 */
export const FREEDOM_OF_MOVEMENT: SpellDefinition = {
  id: 'freedom-of-movement',
  name: 'Freedom of Movement',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'being "unaffected by Difficult Terrain" is not applied: Difficult Terrain is charged exactly and declared by the foot on the move that crosses it, so a creature excused from it has nothing to be excused from',
    'the refusal of a Speed reduction is not applied: "spells and other magical effects can neither reduce the target’s Speed" is an effect stopping another effect from landing, and `speedOf` reads every grant a source hung with no notion of one being refused',
    'the two conditions are not refused: the subject is "spells and other magical effects", so a Ghoul’s Paralyzed still lands and a Hold Person’s does not, and a condition Immunity here answers about the condition rather than about what caused it',
    'the Swim Speed equal to its Speed is not granted; the engine tracks one Speed and no movement modes',
    'the escape is not offered: "the target can spend 5 feet of movement to automatically escape from nonmagical restraints" is a later action taken by the target rather than by the caster, and a casting is acted through by its caster and nobody else',
    'whether the creature touched is willing is not modelled; willingness is fiction',
  ],
};

/**
 * SRD Wall of Fire:
 *
 * > _Level 4 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a wall of fire on a solid surface within range. You can make
 * > the wall up to 60 feet long, 20 feet high, and 1 foot thick, or a ringed
 * > wall up to 20 feet in diameter, 20 feet high, and 1 foot thick. The wall
 * > is opaque and lasts for the duration. When the wall appears, each
 * > creature in its area makes a Dexterity saving throw, taking 5d8 Fire
 * > damage on a failed save or half as much damage on a successful one. One
 * > side of the wall, selected by you when you cast this spell, deals 5d8
 * > Fire damage to each creature that ends its turn within 10 feet of that
 * > side or inside the wall. A creature takes the same damage when it enters
 * > the wall for the first time on a turn or ends its turn there. The other
 * > side of the wall deals no damage."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 4."
 *
 * **Everything but the shape is already expressible, and the shape is the
 * spell.** The opening burst is an ordinary `save-damage` with the ordinary
 * half-on-a-success branch; the entry and end-of-turn clauses are
 * `AreaTrigger`'s `first-per-turn` and `end-of-turn` transcribed; the slot
 * scaling is `DiceScaling`. What none of them has is somewhere to happen:
 * `SpellArea` holds six shapes and none of them is a wall, and this one has
 * two faces that do different things besides.
 */
export const WALL_OF_FIRE: SpellDefinition = {
  id: 'wall-of-fire',
  name: 'Wall of Fire',
  level: 4,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'there is no wall: "You create a wall of fire on a solid surface within range", up to 60 feet long, 20 feet high and 1 foot thick, or a ring 20 feet across, is a shape `SpellArea` does not have',
    'the opening burst is not resolved: "each creature in its area makes a Dexterity saving throw, taking 5d8 Fire damage" is an ordinary save for half and has no area to be resolved over',
    'the damage on a turn boundary is not dealt: "deals 5d8 Fire damage to each creature that ends its turn within 10 feet of that side" lands with neither an attack roll nor a saving throw',
    'the wall has no sides: which face was chosen, and that "The other side of the wall deals no damage", are a filter on what an area catches, and an area reaches everybody inside it',
    'the slot scaling — "The damage increases by 1d8 for each spell slot level above 4" — is ordinary and is not applied, because no damage is rolled to scale',
  ],
};

/**
 * SRD Resistance:
 *
 * > _Abjuration Cantrip (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "You touch a willing creature and choose a damage type: Acid,
 * > Bludgeoning, Cold, Fire, Lightning, Necrotic, Piercing, Poison, Radiant,
 * > Slashing, or Thunder. When the creature takes damage of the chosen type
 * > before the spell ends, the creature reduces the total damage taken by
 * > 1d4. A creature can benefit from this spell only once per turn."
 *
 * **Not Resistance the defence**, which is the reason this cantrip is worth
 * reading twice: `defensesOf` halves a type and this subtracts a die from it,
 * and the two are different arithmetic with the same name. Nothing in the
 * damage pipeline takes a die away from a total, so the minute of
 * Concentration runs and the 1d4 does not.
 */
export const RESISTANCE: SpellDefinition = {
  id: 'resistance',
  name: 'Resistance',
  level: 0,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the die is not subtracted: "the creature reduces the total damage taken by 1d4" is a reduction applied to damage, and the pipeline adjusts, halves and doubles a total but never takes a roll off one',
    'which damage type was chosen is not recorded, because nothing reads it — the eleven the spell prints would be a `damageTypeStated` list if there were an effect for it to choose the type of',
    'the once-per-turn limit is not enforced, because nothing is applied for it to limit',
    'whether the creature touched is willing is not modelled; willingness is fiction',
  ],
};

/**
 * SRD Shillelagh:
 *
 * > _Transmutation Cantrip (Druid)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** 1 minute.
 * > "A Club or Quarterstaff you are holding is imbued with nature's power.
 * > For the duration, you can use your spellcasting ability instead of
 * > Strength for the attack and damage rolls of melee attacks using that
 * > weapon, and the weapon's damage die becomes a d8. If the attack deals
 * > damage, it can be Force damage or the weapon's normal damage type (your
 * > choice). The spell ends early if you cast it again or if you let go of
 * > the weapon."
 * > _Cantrip Upgrade._ "The damage die changes when you reach levels 5 (d10),
 * > 11 (d12), and 17 (2d6)."
 *
 * Every clause rides a **later** weapon attack, which is the shape a casting
 * has no way to hang anything on. The one clause that does not is the recast
 * — `replacesPriorCasting` is exactly "if you cast it again" — so that half
 * is real and the rest is the table's.
 */
export const SHILLELAGH: SpellDefinition = {
  id: 'shillelagh',
  name: 'Shillelagh',
  level: 0,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  // SRD: "The spell ends early if you cast it again."
  replacesPriorCasting: true,
  unmodelled: [
    'the substituted ability is not applied: "you can use your spellcasting ability instead of Strength for the attack and damage rolls of melee attacks using that weapon" is a rider on every later attack with one particular weapon, and a casting hangs none',
    'the weapon’s damage die is not changed, and neither is the upgrade that changes it again: "The damage die changes when you reach levels 5 (d10), 11 (d12), and 17 (2d6)" rewrites a weapon’s printed die for a duration',
    'the choice between Force damage and the weapon’s normal type is not recorded, because no later attack reads it',
    'which weapon was imbued is not held, so "if you let go of the weapon" cannot end the spell: what is in a creature’s hands is not a fact the engine keeps',
  ],
};

/**
 * SRD Sorcerous Burst:
 *
 * > _Evocation Cantrip (Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You cast sorcerous energy at one creature or object within range. Make a
 * > ranged spell attack against the target. On a hit, the target takes 1d8
 * > damage of a type you choose: Acid, Cold, Fire, Lightning, Poison,
 * > Psychic, or Thunder. If you roll an 8 on a d8 for this spell, you can
 * > roll another d8, and add it to the damage. When you cast this spell, the
 * > maximum number of these d8s you can add to the spell's damage equals your
 * > spellcasting ability modifier."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * Fire Bolt with the type named at the casting, and one sentence more. The
 * third user of `damageTypeStated` and the first to print **seven** options,
 * which is what a field rather than a flag is for.
 */
export const SORCEROUS_BURST: SpellDefinition = {
  id: 'sorcerous-burst',
  name: 'Sorcerous Burst',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  damageTypeStated: ['acid', 'cold', 'fire', 'lightning', 'poison', 'psychic', 'thunder'],
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      // `damageType` is the placeholder that makes the definition well-formed;
      // the stated answer is what lands, exactly as Protection from Energy's
      // `damageTypes` is.
      damage: { dice: '1d8', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'acid',
    },
  ],
  unmodelled: [
    'the exploding die is not rolled: "If you roll an 8 on a d8 for this spell, you can roll another d8, and add it to the damage" reads the face of one die out of a roll that comes back as a total, and the cap beside it — as many extra dice as the caster’s spellcasting ability modifier — adds nothing because none are added',
  ],
};

/**
 * SRD True Strike:
 *
 * > _Divination Cantrip (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Self. **Duration:** Instantaneous.
 * > "Guided by a flash of magical insight, you make one attack with the
 * > weapon used in the spell's casting. The attack uses your spellcasting
 * > ability for the attack and damage rolls instead of using Strength or
 * > Dexterity. If the attack deals damage, it can be Radiant damage or the
 * > weapon's normal damage type (your choice)."
 * > _Cantrip Upgrade._ "Whether you deal Radiant damage or the weapon's
 * > normal damage type, the attack deals extra Radiant damage when you reach
 * > levels 5 (1d6), 11 (2d6), and 17 (3d6)."
 *
 * **2024 rewrote this cantrip entirely** and the 2014 version — Advantage on
 * your next attack roll — is not this spell at all. What it is now is a
 * weapon attack made through a casting, with the caster's spellcasting
 * ability substituted and a die of Radiant added on top: three riders on one
 * swing the casting does not take. So the Action goes and the swing is the
 * table's.
 */
export const TRUE_STRIKE: SpellDefinition = {
  id: 'true-strike',
  name: 'True Strike',
  level: 0,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'no attack is made: "you make one attack with the weapon used in the spell’s casting" is a weapon swing taken through a casting, and `resolveAttack` is reached by an attack command rather than by a spell',
    'the substituted ability is not applied: "The attack uses your spellcasting ability for the attack and damage rolls instead of using Strength or Dexterity" is a rider on the attack the casting did not make',
    'the extra Radiant die is not added: "the attack deals extra Radiant damage when you reach levels 5 (1d6), 11 (2d6), and 17 (3d6)" rides the same swing, and so does the choice of damage type beside it',
  ],
};

/**
 * SRD Chromatic Orb:
 *
 * > _Level 1 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 90 feet. **Duration:** Instantaneous.
 * > "You hurl an orb of energy at a target within range. Choose Acid, Cold,
 * > Fire, Lightning, Poison, or Thunder for the type of orb you create, and
 * > then make a ranged spell attack against the target. On a hit, the target
 * > takes 3d8 damage of the chosen type. If you roll the same number on two
 * > or more of the d8s, the orb leaps to a different target of your choice
 * > within 30 feet of the target. Make an attack roll against the new target,
 * > and make a new damage roll. The orb can't leap again unless you cast the
 * > spell with a level 2+ spell slot."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1. The orb can leap a maximum number of times
 * > equal to the level of the slot expended, and a creature can be targeted
 * > only once by each casting of this spell."
 *
 * **Executed rather than tracked, and Scorching Ray is the reason the two
 * spells part company here.** One of three rays is a third of that spell's
 * damage, so resolving one would be resolving a third of it; this spell's
 * whole printed payload is the first orb, and the leap is a bonus that fires
 * on a coincidence. So the 3d8 lands, scales by slot, and the leap is quoted.
 */
export const CHROMATIC_ORB: SpellDefinition = {
  id: 'chromatic-orb',
  name: 'Chromatic Orb',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1 },
  damageTypeStated: ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'],
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
      damageType: 'acid',
    },
  ],
  unmodelled: [
    'the orb does not leap, because the trigger reads the individual dice of a damage roll: "If you roll the same number on two or more of the d8s" asks which faces came up, and a damage roll comes back as a total',
    'nor is the leap resolved: hurling the orb at a second creature is a second attack roll and a second damage roll out of one casting, and an effect rolls one attack per target',
    'the bounds on the leaping are not applied either: a maximum number of times equal to the level of the slot expended, and a creature targeted only once by each casting, both count something that never happens',
  ],
};

/**
 * SRD Expeditious Retreat:
 *
 * > _Level 1 Transmutation (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Bonus Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "This spell lets you move at an incredible pace. When you cast this spell
 * > and as a Bonus Action on each of your turns until the spell ends, you can
 * > take the Dash action."
 *
 * Twenty words, and both halves are the action economy: the spell hands the
 * caster a **use of the Dash action** at the casting and again every turn.
 * The only lever a spell has on the economy is a condition the engine names,
 * so the ten minutes of Concentration run and the Dash is the table's.
 */
export const EXPEDITIOUS_RETREAT: SpellDefinition = {
  id: 'expeditious-retreat',
  name: 'Expeditious Retreat',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the Dash at the casting is not taken: "When you cast this spell and as a Bonus Action on each of your turns until the spell ends, you can take the Dash action" grants an action rather than compelling one, and nothing lets a spell reach the action economy except by naming a condition',
    'nor is the Bonus Action on each later turn offered, for the same reason and out of the same sentence',
  ],
};

/**
 * SRD Goodberry:
 *
 * > _Level 1 Conjuration (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 24 hours.
 * > "Ten berries appear in your hand and are infused with magic for the
 * > duration. A creature can take a Bonus Action to eat one berry. Eating a
 * > berry restores 1 Hit Point, and the berry provides enough nourishment to
 * > sustain a creature for one day. Uneaten berries disappear when the spell
 * > ends."
 *
 * The healing is one hit point and the engine restores hit points all day;
 * what it cannot do is hold **ten berries in somebody's hand**. `inventory`
 * and `equipped` are real and only armour and weapons have a slot, so the
 * berry that would be eaten has nowhere to sit between the casting and the
 * Bonus Action that eats it.
 */
export const GOODBERRY: SpellDefinition = {
  id: 'goodberry',
  name: 'Goodberry',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the berries are not in anybody’s hand: ten of them appearing, being eaten one at a time on a Bonus Action, and disappearing uneaten when the spell ends are all the DM’s, because what a creature is holding is not a fact the engine keeps',
    'the healing is not applied: "Eating a berry restores 1 Hit Point" is arithmetic the engine does readily, and there is no berry for it to follow from',
    'the day’s nourishment one berry provides is the DM’s; the engine tracks no hunger',
  ],
};

/**
 * SRD Ice Knife:
 *
 * > _Level 1 Conjuration (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You create a shard of ice and fling it at one creature within range.
 * > Make a ranged spell attack against the target. On a hit, the target takes
 * > 1d10 Piercing damage. Hit or miss, the shard then explodes. The target
 * > and each creature within 5 feet of it must succeed on a Dexterity saving
 * > throw or take 2d6 Cold damage."
 * > _Using a Higher-Level Spell Slot._ "The Cold damage increases by 1d6 for
 * > each spell slot level above 1."
 *
 * **Two rolls in sequence, and the second is the bigger one.** An attack for
 * 1d10 and then a burst for 2d6 on everyone nearby is one casting the format
 * resolves as two effects over two different populations — the named target,
 * and a Sphere centred on wherever the shard landed. Writing the attack alone
 * would deal less than half the spell at every slot level, which is Scorching
 * Ray's reading arriving at the same answer from the other side: a definition
 * that resolves the smaller half is not the spell.
 */
export const ICE_KNIFE: SpellDefinition = {
  id: 'ice-knife',
  name: 'Ice Knife',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'the shard is not thrown: "On a hit, the target takes 1d10 Piercing damage" is an ordinary ranged spell attack, and it is the smaller half of the spell',
    'the burst is not resolved: "The target and each creature within 5 feet of it must succeed on a Dexterity saving throw or take 2d6 Cold damage" is a second roll sequenced after the first, over an area centred on wherever the shard arrived — a point the casting does not hold',
    'the Cold damage growing by 1d6 for each slot level above 1 is ordinary scaling with nothing to scale',
  ],
};

/**
 * SRD Sanctuary:
 *
 * > _Level 1 Abjuration (Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 30 feet. **Duration:** 1 minute.
 * > "You ward a creature within range. Until the spell ends, any creature who
 * > targets the warded creature with an attack roll or a damaging spell must
 * > succeed on a Wisdom saving throw or either choose a new target or lose
 * > the attack or spell. This spell doesn't protect the warded creature from
 * > areas of effect. The spell ends if the warded creature makes an attack
 * > roll, casts a spell, or deals damage."
 *
 * **The last sentence is Invisibility's, word for word in a different
 * order**, and it is the half of this spell the engine really does: three
 * `CastingEndTrigger`s that IE-032 built, hung on a casting with no effects
 * under it. The ward itself answers a later attack, which is the shape
 * Shield and Mirror Image are also waiting on.
 */
export const SANCTUARY: SpellDefinition = {
  id: 'sanctuary',
  name: 'Sanctuary',
  level: 1,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 60,
  // "The spell ends if the warded creature makes an attack roll, casts a
  // spell, or deals damage." The same three causes Invisibility prints, and
  // the same scope: the book says *the spell* ends, not the ward on one
  // creature.
  endsEarly: [
    { on: 'target-attacks', ends: 'casting' },
    { on: 'target-casts', ends: 'casting' },
    { on: 'target-deals-damage', ends: 'casting' },
  ],
  unmodelled: [
    'the ward is not applied: "any creature who targets the warded creature with an attack roll or a damaging spell must succeed on a Wisdom saving throw" is a spell answering somebody else’s later attack, and there is no window in which an attack is offered to another creature’s casting',
    'so the branch the save buys — "either choose a new target or lose the attack or spell" — is not offered either',
    '"This spell doesn’t protect the warded creature from areas of effect" is the exception to a rule that is not applied',
    'an attack roll that costs no Attack action — an Opportunity Attack, or any swing outside combat — ends this spell only if it hits: the attack roll itself is recorded on `roll-recorded`, which changes no state by rule, so nothing may hang the ending on it',
  ],
};

/**
 * SRD Searing Smite:
 *
 * > _Level 1 Evocation (Paladin, Ranger)._ **Casting Time:** Bonus Action,
 * > which you take immediately after hitting a target with a Melee weapon or
 * > an Unarmed Strike. **Range:** Self. **Duration:** 1 minute.
 * > "As you hit the target, it takes an extra 1d6 Fire damage from the
 * > attack. At the start of each of its turns until the spell ends, the
 * > target takes 1d6 Fire damage and then makes a Constitution saving throw.
 * > On a failed save, the spell continues. On a successful save, the spell
 * > ends."
 * > _Using a Higher-Level Spell Slot._ "All the damage increases by 1d6 for
 * > each spell slot level above 1."
 *
 * Divine Smite's sibling, and the same `attack-damage` effect: the casting
 * time is a Bonus Action with the hit attached, so `resolveSpell` refuses it
 * and `resolveAttackDamage` settles it on the attack that triggered it. What
 * Divine Smite does not print is the minute of burning afterwards, and that
 * is a repeat save whose **failure** branch acts.
 */
export const SEARING_SMITE: SpellDefinition = {
  id: 'searing-smite',
  name: 'Searing Smite',
  level: 1,
  school: 'evocation',
  // The trigger is the hit `resolveAttackDamage` is settling, so it is the
  // command rather than the definition that enforces it — Divine Smite's
  // reading, on the spell that prints the same casting time.
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [
    {
      kind: 'attack-damage',
      damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the burning is not run: "At the start of each of its turns until the spell ends, the target takes 1d6 Fire damage and then makes a Constitution saving throw" is a repeat save whose failure branch acts, and a repeat save releases an effect on a success and does nothing at all on a failure',
    'so the two branches beneath it are not taken either: the spell continuing on a failed save, and ending on a successful one',
  ],
};

/**
 * SRD Sleep:
 *
 * > _Level 1 Enchantment (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature of your choice in a 5-foot-radius Sphere centered on a
 * > point within range must succeed on a Wisdom saving throw or have the
 * > Incapacitated condition until the end of its next turn, at which point it
 * > must repeat the save. If the target fails the second save, the target has
 * > the Unconscious condition for the duration. The spell ends on a target if
 * > it takes damage or someone within 5 feet of it takes an action to shake
 * > it out of the spell's effect. Creatures that don't sleep, such as elves,
 * > or that have Immunity to the Exhaustion condition automatically succeed
 * > on saves against this spell."
 *
 * **2024 rewrote this spell too**, and the hit-point total everybody
 * remembers is gone: it is a save now, and the save repeats once and
 * *deepens* on the second failure. A repeat save in this engine releases an
 * effect on a success and does nothing on a failure, which is the wrong way
 * round for every sentence here.
 */
export const SLEEP: SpellDefinition = {
  id: 'sleep',
  name: 'Sleep',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the save is not rolled and the Incapacitated is not applied: the condition lasts "until the end of its next turn, at which point it must repeat the save", and the repeat is a save whose **failure** deepens the effect rather than a save whose success releases it',
    'so the second failure is not applied either: "If the target fails the second save, the target has the Unconscious condition for the duration"',
    'the 5-foot-radius Sphere is not a template, and "Each creature of your choice" inside it is a filter on what an area catches; nothing is resolved over either',
    'the two ways out are not offered: "The spell ends on a target if it takes damage" is any damage from anybody, which no casting-end cause expresses, and somebody within 5 feet taking an action to shake the sleeper awake is a check nobody else may attempt',
    'the automatic successes are not granted: creatures that do not sleep, and creatures with Immunity to the Exhaustion condition, are an outcome read off the target’s own defences, and `checks.ts` carries an automatic failure and no automatic success',
  ],
};

/**
 * SRD Aid:
 *
 * > _Level 2 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 8 hours.
 * > "Choose up to three creatures within range. Each target's Hit Point
 * > maximum and current Hit Points increase by 5 for the duration."
 * > _Using a Higher-Level Spell Slot._ "Each target's Hit Points increase by
 * > 5 for each spell slot level above 2."
 *
 * Twenty-two words, and both of them are the **maximum**. Healing raises
 * current hit points and stops at the maximum; this raises the maximum and
 * carries the current total up with it, and puts it back eight hours later.
 * Nothing in `vitals.ts` moves a maximum for a duration, which is the one
 * absence between this spell and a definition that does it all.
 */
export const AID: SpellDefinition = {
  id: 'aid',
  name: 'Aid',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 3 },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'nobody is bolstered: "Each target’s Hit Point maximum and current Hit Points increase by 5 for the duration" moves a Hit Point maximum for a span and then moves it back, and nothing does that — healing raises the current total and stops at the maximum',
    'the slot scaling is the same sentence again with a bigger number, and lands nowhere for the same reason',
  ],
};

/**
 * SRD Arcanist's Magic Aura:
 *
 * > _Level 2 Illusion (Wizard)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 24 hours.
 * > "With a touch, you place an illusion on a willing creature or an object
 * > that isn't being worn or carried. … _Mask (Creature)._ Choose a creature
 * > type other than the target's actual type. Spells and other magical
 * > effects treat the target as if it were a creature of the chosen type."
 *
 * **The only spell in the book that lies to another spell.** A creature type
 * is a fact the engine holds authoritatively — `mustBeType` reads it, and SRD
 * policy records the Goblin Warrior being Fey as the reason it has to — and
 * this hangs a second answer over the top of it for a day. Not one sentence
 * of the paragraph trips a marker, which is the floor working as a floor:
 * what makes this a blocker is reading it.
 */
export const ARCANISTS_MAGIC_AURA: SpellDefinition = {
  id: 'arcanists-magic-aura',
  name: "Arcanist's Magic Aura",
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the Mask is not applied: "Spells and other magical effects treat the target as if it were a creature of the chosen type" overrides a creature fact the engine holds and every target rule reads, and nothing writes over one for a duration',
    'the False Aura is the DM’s: objects are not modelled, and what an aura looks like to a Detect Magic that itself resolves nothing is narration twice over',
    'the thirty consecutive castings that make the illusion permanent are the DM’s; the engine holds no such history',
  ],
};

/**
 * SRD Barkskin:
 *
 * > _Level 2 Transmutation (Druid, Ranger)._ **Casting Time:** Bonus Action.
 * > **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a willing creature. Until the spell ends, the target's skin
 * > assumes a bark-like appearance, and the target has an Armor Class of 17
 * > if its AC is lower than that."
 *
 * **A floor, not a replacement and not a bonus**, and the difference is the
 * whole spell. Mage Armor supplies a *calculation* — 13 plus Dexterity — and
 * the engine picks the best calculation a creature has. This supplies a
 * finished number and only when it beats whatever the creature already has,
 * which is neither an `armor-class` effect nor a bonus.
 */
export const BARKSKIN: SpellDefinition = {
  id: 'barkskin',
  name: 'Barkskin',
  level: 2,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the Armour Class is not floored: "the target has an Armor Class of 17 if its AC is lower than that" is a minimum applied to whatever the creature already has, and the `armor-class` effect supplies a base calculation instead — 17 written as one would beat a plate-armoured Paladin’s 18 down, or be ignored, depending on which way the comparison ran',
    'whether the creature touched is willing is not modelled; willingness is fiction',
    'the bark-like appearance is narration',
  ],
};

/**
 * SRD Enhance Ability:
 *
 * > _Level 2 Transmutation (Bard, Cleric, Druid, Ranger, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "You touch a creature and choose Strength, Dexterity, Intelligence,
 * > Wisdom, or Charisma. For the duration, the target has Advantage on
 * > ability checks using the chosen ability."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional
 * > creature for each spell slot level above 2. You can choose a different
 * > ability for each target."
 *
 * **The Advantage is ordinary and the choice is not.** A `RollModifier` names
 * Advantage on ability checks of a stated ability perfectly well — Contagion's
 * adjudication says so in the other direction — and a casting has nowhere to
 * record which of the five was picked. The upcast makes it worse rather than
 * better: one choice *per target*, which is a spell's effects differing across
 * the creatures one casting caught.
 */
export const ENHANCE_ABILITY: SpellDefinition = {
  id: 'enhance-ability',
  name: 'Enhance Ability',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the Advantage is not granted: the modifier itself is ordinary and the ability it applies to is chosen when the slot is spent, which a casting has nowhere to record',
    '"You can choose a different ability for each target" is worse than one choice: it is a casting whose effects differ from target to target, and a casting applies its effects to all of them alike',
  ],
};

/**
 * SRD Magic Weapon:
 *
 * > _Level 2 Transmutation (Paladin, Ranger, Sorcerer, Wizard)._
 * > **Casting Time:** Bonus Action. **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a nonmagical weapon. Until the spell ends, that weapon becomes
 * > a magic weapon with a +1 bonus to attack rolls and damage rolls. The
 * > spell ends early if you cast it again."
 * > _Using a Higher-Level Spell Slot._ "The bonus increases to +2 with a
 * > level 3–5 spell slot. The bonus increases to +3 with a level 6+ spell
 * > slot."
 *
 * The bonus is arithmetic the engine does on every attack a magic weapon
 * makes; what it cannot do is put the bonus on **this** weapon for an hour.
 * A weapon is an item a creature owns and wields, not a thing a casting can
 * write a property onto — which is the same absence Shillelagh has, one
 * level up and with a plus instead of a die.
 */
export const MAGIC_WEAPON: SpellDefinition = {
  id: 'magic-weapon',
  name: 'Magic Weapon',
  level: 2,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  // "The spell ends early if you cast it again."
  replacesPriorCasting: true,
  unmodelled: [
    'the weapon is not enchanted: "that weapon becomes a magic weapon with a +1 bonus to attack rolls and damage rolls" is a rider on every later attack made with one particular weapon, and a casting hangs none — nor is which weapon was touched a fact the engine keeps',
    'the bonus growing to +2 at a level 3–5 slot and +3 at level 6+ is a band table over a rider that is not applied',
  ],
};

/**
 * SRD Mirror Image:
 *
 * > _Level 2 Illusion (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Self. **Duration:** 1 minute.
 * > "Three illusory duplicates of yourself appear in your space. … Each time
 * > a creature hits you with an attack roll during the spell's duration, roll
 * > a d6 for each of your remaining duplicates. If any of the d6s rolls a 3
 * > or higher, one of the duplicates is hit instead of you, and the duplicate
 * > is destroyed. … The spell ends when all three duplicates are destroyed. A
 * > creature is unaffected by this spell if it has the Blinded condition,
 * > Blindsight, or Truesight."
 *
 * Three different absences in one paragraph, and they stack: the spell has to
 * be **offered somebody else's attack** after it has hit, it then throws a
 * handful of d6s that are not a D20 Test, and whether it applies at all is
 * decided by what the attacker can see. Sanctuary and Shield wait on the
 * first of those; this one waits on all three.
 */
export const MIRROR_IMAGE: SpellDefinition = {
  id: 'mirror-image',
  name: 'Mirror Image',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the duplicates are not in the world: three of them appearing in the caster’s space, moving with them and being destroyed one at a time are the DM’s',
    'the deflection is not offered: "Each time a creature hits you with an attack roll during the spell’s duration, roll a d6 for each of your remaining duplicates" answers somebody else’s attack after it has landed, and a casting is offered no such window',
    'so the d6s are not thrown either — a handful of dice that is not a D20 Test has nothing to ask the generator for — and "The spell ends when all three duplicates are destroyed" counts something that never happens',
    'the exception is not applied: an attacker with the Blinded condition, Blindsight or Truesight is unaffected, and what an attacker can perceive is a pairwise declaration rather than a sense the engine reads',
  ],
};

/**
 * SRD Pass without Trace:
 *
 * > _Level 2 Abjuration (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 hour.
 * > "You radiate a concealing aura in a 30-foot Emanation for the duration.
 * > While in the aura, you and each creature you choose have a +10 bonus to
 * > Dexterity (Stealth) checks and leave no tracks."
 *
 * The bonus is a `Bonus` the engine applies all day and the **while** is the
 * problem: it holds for as long as a creature is inside a 30-foot Emanation
 * that moves with the caster, and lapses the moment it steps out. Nothing
 * derives a modifier from where a creature is standing, which is the same
 * absence Spirit Guardians' halved Speed has.
 */
export const PASS_WITHOUT_TRACE: SpellDefinition = {
  id: 'pass-without-trace',
  name: 'Pass without Trace',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the bonus is not granted: "While in the aura, you and each creature you choose have a +10 bonus to Dexterity (Stealth) checks" holds only while a creature stands inside a 30-foot Emanation that travels with the caster, and no effect derives a modifier from where somebody is standing',
    'leaving no tracks is the DM’s',
  ],
};

/**
 * SRD Spike Growth:
 *
 * > _Level 2 Transmutation (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Concentration, up to 10 minutes.
 * > "The ground in a 20-foot-radius Sphere centered on a point within range
 * > sprouts hard spikes and thorns. The area becomes Difficult Terrain for
 * > the duration. When a creature moves into or within the area, it takes
 * > 2d4 Piercing damage for every 5 feet it travels. … Any creature that
 * > can't see the area when the spell is cast must take a Search action and
 * > succeed on a Wisdom (Perception or Survival) check against your spell
 * > save DC to recognize the terrain as hazardous before entering it."
 *
 * **The damage is per five feet travelled**, which is the sentence that makes
 * this more than another Difficult Terrain spell: the engine charges movement
 * by the foot and never asks how far inside an area those feet were spent, so
 * there is no number for the dice to be multiplied by.
 */
export const SPIKE_GROWTH: SpellDefinition = {
  id: 'spike-growth',
  name: 'Spike Growth',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the ground is not changed: "The area becomes Difficult Terrain for the duration" is terrain an area creates, and Difficult Terrain is declared by the foot on the move that crosses it rather than held by the ground',
    'the spikes deal nothing: "it takes 2d4 Piercing damage for every 5 feet it travels" multiplies the dice by a distance travelled **inside** the area, and a move is charged by the foot without anybody asking which feet were where',
    'the Wisdom (Perception or Survival) check that spots the hazard is not offered: it belongs to a creature that is about to walk in rather than to one the casting caught, and who may attempt a check is derived from what its timer sits on',
  ],
};

/**
 * SRD Warding Bond:
 *
 * > _Level 2 Abjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 1 hour.
 * > "You touch another creature that is willing and create a mystic
 * > connection between you and the target until the spell ends. While the
 * > target is within 60 feet of you, it gains a +1 bonus to AC and saving
 * > throws, and it has Resistance to all damage. Also, each time it takes
 * > damage, you take the same amount of damage. The spell ends if you drop
 * > to 0 Hit Points or if you and the target become separated by more than
 * > 60 feet."
 *
 * Every benefit the spell grants is one the engine applies on its own — a
 * bonus to Armour Class, a bonus to saves, Resistance to all damage — and
 * every one of them is fenced by **"while the target is within 60 feet of
 * you"**. A distance between two creatures changes on every move and nothing
 * re-reads a grant when it does, which is the same absence that makes the
 * spell's own ending unwritable.
 */
export const WARDING_BOND: SpellDefinition = {
  id: 'warding-bond',
  name: 'Warding Bond',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  // "another creature", so not the caster: the whole spell is a bond between
  // two of them.
  targets: { count: 1 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'none of the three benefits is granted: the +1 to AC, the +1 to saving throws and the Resistance to all damage are each ordinary, and all three hold only "While the target is within 60 feet of you" — a standing effect derived from where two creatures are standing, which nothing re-reads when either of them moves',
    'the shared damage is not dealt: "each time it takes damage, you take the same amount of damage" is a consequence of somebody else’s damage landing, and no effect answers one',
    'the two endings are not written: dropping to 0 Hit Points and drifting more than 60 feet apart are causes no `CastingEndTrigger` expresses, and neither is the recast on either of the connected creatures',
    'whether the creature touched is willing is not modelled; willingness is fiction',
  ],
};

/**
 * SRD Major Image:
 *
 * > _Level 3 Illusion (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You create the image of an object, a creature, or some other visible
 * > phenomenon that is no larger than a 20-foot Cube. … A creature that takes
 * > a Study action to examine the image can determine that it is an illusion
 * > with a successful Intelligence (Investigation) check against your spell
 * > save DC."
 * > _Using a Higher-Level Spell Slot._ "The spell lasts until dispelled,
 * > without requiring Concentration, if cast with a level 4+ spell slot."
 *
 * Silent Image two levels up, with the same one sentence of arithmetic — and
 * one sentence the format deliberately refuses. `durationAtSlot` names this
 * spell in its own docstring as the thing it does **not** express: a slot
 * that changes how long a spell lasts is a band table, and a slot that
 * changes *what kind of duration it has* is a different sentence.
 */
export const MAJOR_IMAGE: SpellDefinition = {
  id: 'major-image',
  name: 'Major Image',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the image is, the 20-foot Cube it fits in, and the sounds, smells and temperature it seems to have are the DM’s',
    'the Magic action that moves the image, and altering its appearance as it goes, need an ongoing effect a later turn can act through',
    'a level 4+ slot is not honoured: "The spell lasts until dispelled, without requiring Concentration" changes what kind of duration the spell has rather than how long it runs, which is the one sentence the slot-banded duration table declines to express',
    'seeing through the image is narration; the engine records the roll and nothing else changes',
  ],
};

/**
 * SRD Meld into Stone:
 *
 * > _Level 3 Transmutation (Cleric, Druid, Ranger) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** Touch.
 * > **Duration:** 8 hours.
 * > "You step into a stone object or surface large enough to fully contain
 * > your body, merging yourself and your equipment with the stone for the
 * > duration. … You can use 5 feet of movement to leave the stone where you
 * > entered it, which ends the spell. You otherwise can't move. … its partial
 * > destruction or a change in its shape … expels you and deals 6d6 Force
 * > damage to you. … If expelled, you move into an unoccupied space closest
 * > to where you first entered and have the Prone condition."
 *
 * **Every clause hangs on being inside the stone**, and there is no stone —
 * which is the same place Tree Stride's five feet of movement hang from, and
 * why both are filed under a world fact nothing can represent. The dice, the
 * Prone and the shunt to the nearest unoccupied space are all ordinary; what
 * is missing is the state they are consequences of.
 */
export const MELD_INTO_STONE: SpellDefinition = {
  id: 'meld-into-stone',
  name: 'Meld into Stone',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'nobody is merged with anything: being inside a stone object is a state the world model has no room for, and every other sentence of this spell is a consequence of it',
    'so the 5 feet of movement spent stepping out are not charged, and neither is "You otherwise can’t move"',
    'the Disadvantage on a Wisdom (Perception) check to hear through the stone is not applied, because there is nothing to hear through',
    'the expulsions are not performed: 6d6 Force damage for the stone’s partial destruction, 50 Force damage for its complete destruction, the move to the nearest unoccupied space and the Prone condition on arrival all follow from being expelled from somewhere',
  ],
};

/**
 * SRD Sleet Storm:
 *
 * > _Level 3 Conjuration (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 150 feet. **Duration:** Concentration, up to 1 minute.
 * > "Until the spell ends, sleet falls in a 40-foot-tall, 20-foot-radius
 * > Cylinder centered on a point you choose within range. The area is Heavily
 * > Obscured, and exposed flames in the area are doused. Ground in the
 * > Cylinder is Difficult Terrain. When a creature enters the Cylinder for
 * > the first time on a turn or starts its turn there, it must succeed on a
 * > Dexterity saving throw or have the Prone condition and lose
 * > Concentration."
 *
 * **One sentence short of Web.** The Cylinder is a shape the engine has, the
 * two trigger moments are `AreaTrigger`'s two by name, and the Prone is an
 * ordinary condition — so all but one clause of the save is expressible. The
 * clause that is not is "and lose Concentration": breaking somebody's
 * Concentration is something the engine does readily and nothing lets an
 * *outcome* ask for it, so writing the save would drop half of what a failure
 * costs.
 */
export const SLEET_STORM: SpellDefinition = {
  id: 'sleet-storm',
  name: 'Sleet Storm',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the save is not raised, because half of what a failure costs cannot be written: "have the Prone condition and lose Concentration" pairs an ordinary condition with a broken Concentration, and no outcome of a saving throw asks for one',
    'the Cylinder is not a template and the ground in it is not changed: Difficult Terrain is declared by the foot on the move that crosses it, and no area declares any',
    'the Heavily Obscured area and the exposed flames it douses are the DM’s; the engine has no lighting and no obscurement',
  ],
};

/**
 * SRD Speak with Plants:
 *
 * > _Level 3 Transmutation (Bard, Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "You imbue plants in an immobile 30-foot Emanation with limited sentience
 * > and animation … You can also turn Difficult Terrain caused by plant
 * > growth (such as thickets and undergrowth) into ordinary terrain that
 * > lasts for the duration. Or you can turn ordinary terrain where plants are
 * > present into Difficult Terrain that lasts for the duration."
 *
 * A conversation with a hedge, and one mechanical sentence in the middle of
 * it that goes **both ways**: this is the only spell in the book that can
 * take Difficult Terrain away as well as make it. Neither direction has
 * anywhere to be written, because the ground holds no such property.
 */
export const SPEAK_WITH_PLANTS: SpellDefinition = {
  id: 'speak-with-plants',
  name: 'Speak with Plants',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the terrain is not changed in either direction: turning plant-grown Difficult Terrain into ordinary ground, and ordinary ground into Difficult Terrain, are both terrain an area creates, and Difficult Terrain is the caller’s statement on the move that crosses it rather than a property the ground holds',
    'the conversation is the DM’s: questioning plants about the past day, giving them simple commands, and talking to a Plant creature as if you shared a language are all narration',
  ],
};

/**
 * SRD Death Ward:
 *
 * > _Level 4 Abjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 8 hours.
 * > "You touch a creature and grant it a measure of protection from death.
 * > The first time the target would drop to 0 Hit Points before the spell
 * > ends, the target instead drops to 1 Hit Point, and the spell ends. If the
 * > spell is still in effect when the target is subjected to an effect that
 * > would kill it instantly without dealing damage, that effect is negated
 * > against the target, and the spell ends."
 *
 * **Dropping to 0 is an engine-owned batch**, and that is exactly the trouble:
 * the transition from damage to unconsciousness happens inside the operation
 * that applies the damage, and there is no seam in it for a spell to say
 * "stop at 1 instead". The hit point itself is nothing; the interception is
 * the whole spell.
 */
export const DEATH_WARD: SpellDefinition = {
  id: 'death-ward',
  name: 'Death Ward',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'the ward does not catch anybody: "The first time the target would drop to 0 Hit Points before the spell ends, the target instead drops to 1 Hit Point" intercepts a transition the damage operation performs on its own, and nothing hangs on that moment',
    'nor is the second half applied: an effect that would kill the target outright without dealing damage is negated, which is the same interception on a different door',
    'so the spell does not end on either of them, because neither happens',
  ],
};

/**
 * SRD Seeming:
 *
 * > _Level 5 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 8 hours.
 * > "You give an illusory appearance to each creature of your choice that you
 * > can see within range. An unwilling target can make a Charisma saving
 * > throw, and if it succeeds, it is unaffected by this spell. … A creature
 * > that takes the Study action to examine a target can make an Intelligence
 * > (Investigation) check against your spell save DC."
 *
 * Disguise Self over a crowd, and it inherits Disguise Self's answer: what
 * anybody looks like is fiction, and the Investigation check against the
 * spell save DC is arithmetic and is rolled. The eight hours give the casting
 * a timer for the check to hang on, which a Concentration-free illusion does
 * not always have.
 */
export const SEEMING: SpellDefinition = {
  id: 'seeming',
  name: 'Seeming',
  level: 5,
  school: 'illusion',
  castingTime: 'action',
  // "each creature of your choice that you can see within range": the SRD
  // states no count, so range and sight are the whole of the bound.
  targets: { count: 0, unlimited: true },
  requiresSight: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  effects: [],
  durationSeconds: 28_800,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'the Charisma saving throw an unwilling target may make is not rolled, because what it would refuse is an appearance: nothing mechanical follows from being disguised, so the save decides nothing the engine holds',
    'the appearances are the DM’s, and so is the sentence that lets each target have a different one — a casting applies its effects to all of its targets alike',
    'the foot of height, the changed equipment and the hat things pass through are narration; the engine records the Investigation roll and nothing else changes',
  ],
};

/**
 * SRD Globe of Invulnerability:
 *
 * > _Level 6 Abjuration (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "An immobile, shimmering barrier appears in a 10-foot Emanation around
 * > you and remains for the duration. Any spell of level 5 or lower cast from
 * > outside the barrier can't affect anything within it. Such a spell can
 * > target creatures and objects within the barrier, but the spell has no
 * > effect on them. Similarly, the area within the barrier is excluded from
 * > areas of effect created by such spells."
 * > _Using a Higher-Level Spell Slot._ "The barrier blocks spells of 1 level
 * > higher for each spell slot level above 6."
 *
 * The whole spell is **other people's spells failing**, and there is no state
 * in which a casting is being refused by a place. Dispel Magic built the half
 * of that shape which *ends* a casting; this is the half that stops one
 * landing, and it needs a second fact besides — where the caster of the other
 * spell was standing when they cast it.
 */
export const GLOBE_OF_INVULNERABILITY: SpellDefinition = {
  id: 'globe-of-invulnerability',
  name: 'Globe of Invulnerability',
  level: 6,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'nothing is blocked: "Any spell of level 5 or lower cast from outside the barrier can’t affect anything within it" is an area refusing other magic, and there is no state in which a casting is being refused by a place',
    'the threshold is not read either — a level higher for each slot level above 6 — and neither is the fact it is compared against, which is where the other caster was standing',
    'the exclusion of the globe’s interior from another spell’s area is the same absence read from the area’s side',
    'the barrier itself is not in the world: a 10-foot Emanation around the caster that nothing consults',
  ],
};

/**
 * SRD Glibness:
 *
 * > _Level 8 Enchantment (Bard, Warlock)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 1 hour.
 * > "Until the spell ends, when you make a Charisma check, you can replace
 * > the number you roll with a 15. Additionally, no matter what you say,
 * > magic that would determine if you are telling the truth indicates that
 * > you are being truthful."
 *
 * **A replacement, not a bonus and not a mode.** The die is rolled and then
 * the number it showed is thrown away in favour of 15 — at the caster's
 * option, after seeing it. `interveneAfterRoll` reaches a roll that has
 * happened and adds to it; nothing substitutes the result, which is what
 * separates this from every modifier in `roll-modifiers.ts`.
 */
export const GLIBNESS: SpellDefinition = {
  id: 'glibness',
  name: 'Glibness',
  level: 8,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the number is not replaced: "when you make a Charisma check, you can replace the number you roll with a 15" substitutes a roll result rather than adding to one, and every modifier the engine has adds, subtracts or changes how many dice are thrown',
    'magic that reads the truth is told a lie: with no spell in the catalogue determining whether somebody is telling the truth, there is nothing for this sentence to answer, and it is the DM’s',
  ],
};

/**
 * SRD Foresight:
 *
 * > _Level 9 Divination (Bard, Druid, Warlock, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** Touch. **Duration:** 8 hours.
 * > "You touch a willing creature and bestow a limited ability to see into
 * > the immediate future. For the duration, the target has Advantage on D20
 * > Tests, and other creatures have Disadvantage on attack rolls against it.
 * > The spell ends early if you cast it again."
 *
 * **"D20 Tests" as a family is deliberately absent from `RollModifier`**, and
 * three SRD spells write the phrase — this one, Resurrection's toll on the
 * caster, and Raise Dead's penalty on the target. The half that names attack
 * rolls against the target is the other side of the same gap: a mode the
 * *attacker* rolls with, granted by a spell on the defender.
 */
export const FORESIGHT: SpellDefinition = {
  id: 'foresight',
  name: 'Foresight',
  level: 9,
  school: 'divination',
  // "Casting Time: 1 minute."
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 28_800,
  // "The spell ends early if you cast it again."
  replacesPriorCasting: true,
  unmodelled: [
    'the Advantage is not granted: "the target has Advantage on D20 Tests" needs a selector for D20 Tests as a family, which `RollModifier` deliberately does not carry',
    'nor is the Disadvantage: "other creatures have Disadvantage on attack rolls against it" is a mode the attacker rolls with, granted by a spell cast on the defender, and a modifier is hung on the creature that rolls',
    'whether the creature touched is willing is not modelled; willingness is fiction',
  ],
};

/**
 * SRD Shapechange:
 *
 * > _Level 9 Transmutation (Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 hour.
 * > "You shape-shift into another creature for the duration or until you take
 * > a Magic action to shape-shift into a different eligible form. … When you
 * > cast the spell, you gain a number of Temporary Hit Points equal to the
 * > Hit Points of the first form into which you shape-shift. … Your game
 * > statistics are replaced by the stat block of the chosen form, but you
 * > retain your creature type; alignment; personality; Intelligence, Wisdom,
 * > and Charisma scores; Hit Points; Hit Point Dice; proficiencies; and
 * > ability to communicate."
 *
 * Polymorph pointed at the caster and unbounded by Beast, and the same
 * absence four levels up: every number comes off a **second creature's**
 * sheet, the engine holds one sheet per creature, and the form is selected by
 * a Challenge Rating no target rule can ask for.
 */
export const SHAPECHANGE: SpellDefinition = {
  id: 'shapechange',
  name: 'Shapechange',
  level: 9,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'nobody shape-shifts: "Your game statistics are replaced by the stat block of the chosen form" writes over a creature’s sheet for a duration, and a sheet is a fact the engine holds authoritatively with nothing that overrides one',
    'which form was chosen is the DM’s, and so is the bound on it: "a creature that has a Challenge Rating no higher than your level or Challenge Rating", having seen the sort of creature before, and it being neither a Construct nor an Undead',
    'the Temporary Hit Points are not granted, because the amount is the Hit Points of a form nothing can look up, and they cannot vanish at the end of a spell that never granted them',
    'the Magic action that changes form again on a later turn needs an ongoing effect a turn can act through',
    'what happens to the caster’s equipment is the DM’s',
  ],
};

/**
 * SRD Heat Metal:
 *
 * > _Level 2 Transmutation (Bard, Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose a manufactured metal object … Any creature in physical contact
 * > with the object takes 2d8 Fire damage when you cast the spell. Until the
 * > spell ends, you can take a Bonus Action on each of your later turns to
 * > deal this damage again if the object is within range. If a creature is
 * > holding or wearing the object and takes the damage from it, the creature
 * > must succeed on a Constitution saving throw or drop the object if it can.
 * > If it doesn't drop the object, it has Disadvantage on attack rolls and
 * > ability checks until the start of your next turn."
 *
 * **The target is an object and every consequence reads who is touching it.**
 * A suit of armour a creature is wearing is a fact the engine keeps — armour
 * is equipped — and a weapon in somebody's hands is not, so "any creature in
 * physical contact with the object" has no answer to be derived from.
 */
export const HEAT_METAL: SpellDefinition = {
  id: 'heat-metal',
  name: 'Heat Metal',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  requiresSight: true,
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the object is not chosen and nobody is burned: "Any creature in physical contact with the object takes 2d8 Fire damage" lands with neither an attack roll nor a saving throw, on whoever is touching a thing the engine does not track the touching of',
    'the Bonus Action that deals the damage again on a later turn is an activation with no consumer, and the range check it carries is measured to the object',
    'the Constitution save that makes a creature drop what it is holding has nothing to drop: what is in a creature’s hands is not a fact the engine keeps',
    'the Disadvantage on attack rolls and ability checks for hanging on is ordinary, and it hangs off the failed save above it',
  ],
};

/**
 * SRD Flaming Sphere:
 *
 * > _Level 2 Conjuration (Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a 5-foot-diameter sphere of fire in an unoccupied space on
 * > the ground within range. … Any creature that ends its turn within 5 feet
 * > of the sphere makes a Dexterity saving throw, taking 2d6 Fire damage on a
 * > failed save or half as much damage on a successful one. As a Bonus
 * > Action, you can move the sphere up to 30 feet, rolling it along the
 * > ground."
 *
 * **Spiritual Weapon's point with Web's trigger**, and the pair is exactly
 * what the engine does not have: `CastingOrigin` holds a point a later Bonus
 * Action may move, and `AreaTrigger` raises a save at a turn boundary over an
 * *area the casting placed* — not over a radius measured from a point that
 * moves. Either half alone is written elsewhere in this catalogue.
 */
export const FLAMING_SPHERE: SpellDefinition = {
  id: 'flaming-sphere',
  name: 'Flaming Sphere',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the sphere burns nobody: "Any creature that ends its turn within 5 feet of the sphere makes a Dexterity saving throw, taking 2d6 Fire damage on a failed save or half as much damage on a successful one" is an ordinary save for half, raised at a turn boundary over a radius measured from a point the casting holds — and a trigger reads the area a casting placed rather than a distance from a movable point',
    'the Bonus Action that rolls the sphere up to 30 feet, and the save a creature makes when the sphere is rolled into its space, are the same absence from the other end',
    'the barriers it is directed over, the pits it jumps, the flammable objects it sets alight and the Bright Light it sheds are the DM’s',
  ],
};

/**
 * SRD Ray of Enfeeblement:
 *
 * > _Level 2 Necromancy (Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "A beam of enervating energy shoots from you toward a creature within
 * > range. The target must make a Constitution saving throw. On a successful
 * > save, the target has Disadvantage on the next attack roll it makes until
 * > the start of your next turn. On a failed save, the target has
 * > Disadvantage on Strength-based D20 Tests for the duration. During that
 * > time, it also subtracts 1d8 from all its damage rolls. The target repeats
 * > the save at the end of each of its turns, ending the spell on a success."
 *
 * **The success branch does something**, which is the rarest shape in the
 * book: a saving throw here is not a gate but a fork, and the engine's
 * `onSuccess` releases an effect or does nothing. Both branches then want
 * machinery nobody has — a modifier consumed by the one roll it changes, a
 * selector for a family of D20 Tests, and dice subtracted from a damage roll.
 */
export const RAY_OF_ENFEEBLEMENT: SpellDefinition = {
  id: 'ray-of-enfeeblement',
  name: 'Ray of Enfeeblement',
  level: 2,
  school: 'necromancy',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the save is not rolled, because succeeding at it *does* something: "On a successful save, the target has Disadvantage on the next attack roll it makes" is an outcome on the branch that normally buys a creature its freedom, and no effect writes one',
    'that Disadvantage is also consumed by the roll it changes rather than running to a deadline, which no modifier does',
    'the failure branch is not applied either: "Disadvantage on Strength-based D20 Tests" needs a selector for a family of D20 Tests, which `RollModifier` deliberately does not carry',
    'nor is the die taken away: "it also subtracts 1d8 from all its damage rolls" is a penalty on a later damage roll, and every rider the format has adds',
    'the repeat save at the end of each of the target’s turns is ordinary, and there is nothing for it to end',
  ],
};

/**
 * SRD Arcane Eye:
 *
 * > _Level 4 Divination (Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 hour.
 * > "You create an Invisible, invulnerable eye within range that hovers for
 * > the duration. You mentally receive visual information from the eye, which
 * > can see in every direction. It also has Darkvision with a range of 30
 * > feet. As a Bonus Action, you can move the eye up to 30 feet in any
 * > direction. A solid barrier blocks the eye's movement, but the eye can
 * > pass through an opening as small as 1 inch in diameter."
 *
 * Not one sentence trips a marker and the spell is still blocked, which is
 * the floor working as a floor: **movement consults no walls.** The eye is a
 * point that flies where it likes and stops at a solid barrier, and there is
 * no barrier in the model for it to stop at.
 */
export const ARCANE_EYE: SpellDefinition = {
  id: 'arcane-eye',
  name: 'Arcane Eye',
  level: 4,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the eye is not in the world: an Invisible, invulnerable point that hovers, sees in every direction and has Darkvision out to 30 feet is the DM’s, and what the caster sees through it is narration',
    'the Bonus Action that moves the eye up to 30 feet is not offered, and the rule that stops it — "A solid barrier blocks the eye’s movement, but the eye can pass through an opening as small as 1 inch in diameter" — is a barrier that blocks passage, which movement never consults',
  ],
};

/**
 * SRD Fire Shield:
 *
 * > _Level 4 Evocation (Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "Wispy flames wreathe your body for the duration, shedding Bright Light
 * > in a 10-foot radius and Dim Light for an additional 10 feet. The flames
 * > provide you with a warm shield or a chill shield, as you choose. The warm
 * > shield grants you Resistance to Cold damage, and the chill shield grants
 * > you Resistance to Fire damage. In addition, whenever a creature within 5
 * > feet of you hits you with a melee attack roll, the shield erupts with
 * > flame. The attacker takes 2d8 Fire damage from a warm shield or 2d8 Cold
 * > damage from a chill shield."
 *
 * **The fourth user of `damageTypeStated`, and the choice arrives sideways.**
 * The book names the two shields and then says what each resists, so the
 * caster's choice *is* a damage type once the sentence after it is read:
 * stating Cold is the warm shield and stating Fire is the chill one. Two
 * printed options, both in the list, and a casting that names neither is
 * refused rather than guessed at — the discipline Protection from Energy
 * already follows.
 *
 * What is not executed is the eruption, which answers somebody else's melee
 * attack after it has hit.
 */
export const FIRE_SHIELD: SpellDefinition = {
  id: 'fire-shield',
  name: 'Fire Shield',
  level: 4,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  // The type the caster asks for Resistance to, which is the shield they
  // chose said in the engine's vocabulary rather than the book's.
  damageTypeStated: ['cold', 'fire'],
  effects: [{ kind: 'damage-defense', damageTypes: ['cold'], defense: 'resistant' }],
  durationSeconds: 600,
  unmodelled: [
    'the eruption is not resolved: "whenever a creature within 5 feet of you hits you with a melee attack roll, the shield erupts with flame" answers somebody else’s attack after it has landed, and a casting is offered no such window',
    'so the 2d8 the attacker takes is not dealt, and neither is the rule that its type is the opposite of the Resistance — Fire from a warm shield, Cold from a chill one',
    'the Bright Light in a 10-foot radius and the Dim Light beyond it are the DM’s; the engine has no lighting',
  ],
};

/**
 * SRD Guardian of Faith:
 *
 * > _Level 4 Conjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 8 hours.
 * > "A Large spectral guardian appears and hovers for the duration in an
 * > unoccupied space that you can see within range. The guardian occupies
 * > that space and is invulnerable … Any enemy that moves to a space within
 * > 10 feet of the guardian for the first time on a turn or starts its turn
 * > there makes a Dexterity saving throw, taking 20 Radiant damage on a
 * > failed save or half as much damage on a successful one. The guardian
 * > vanishes when it has dealt a total of 60 damage."
 *
 * **The guardian is not a creature**, which is the correction
 * `blocked-on.test.ts` records against a prose row that once filed it under a
 * stat block: it is invulnerable, it takes no turn, and it deals its damage
 * through a save. What blocks it is the *shape of the trigger* — ten feet
 * measured from a point rather than an area the casting placed — and the
 * running total that ends the spell at sixty.
 */
export const GUARDIAN_OF_FAITH: SpellDefinition = {
  id: 'guardian-of-faith',
  name: 'Guardian of Faith',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  requiresSight: true,
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'the guardian strikes nobody: the save is raised on the two moments `AreaTrigger` already names, and it is measured ten feet from a point the casting holds rather than over an area the casting placed',
    'the flat 20 Radiant with half on a success is ordinary arithmetic waiting on that trigger, and so is the filter that catches only an enemy',
    'the guardian does not vanish: "The guardian vanishes when it has dealt a total of 60 damage" is a running total the casting would have to keep, and no casting-end cause counts anything',
    'the space it occupies is the DM’s: the guardian is not a creature, so nothing stands anywhere',
  ],
};

/**
 * SRD Faithful Hound:
 *
 * > _Level 4 Conjuration (Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 8 hours.
 * > "You conjure a phantom watchdog in an unoccupied space that you can see
 * > within range. The hound remains for the duration or until the two of you
 * > are more than 300 feet apart … At the start of each of your turns, the
 * > hound attempts to bite one enemy within 5 feet of it. That enemy must
 * > succeed on a Dexterity saving throw or take 4d8 Force damage. On your
 * > later turns, you can take a Magic action to move the hound up to 30
 * > feet."
 *
 * Guardian of Faith's sibling and the same correction: intangible,
 * invulnerable, no turn of its own. The difference is **whose** turn the bite
 * fires on — the caster's, not the victim's — and `AreaTrigger` reads the
 * boundaries of the creature standing in the area rather than the boundaries
 * of the caster who made it.
 */
export const FAITHFUL_HOUND: SpellDefinition = {
  id: 'faithful-hound',
  name: 'Faithful Hound',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  requiresSight: true,
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'the hound bites nobody: "At the start of each of your turns, the hound attempts to bite one enemy within 5 feet of it" fires on the **caster’s** turn boundary, and an area trigger reads the boundaries of whoever is standing in the area',
    'so the Dexterity save and the 4d8 Force damage behind it are not rolled either',
    'the spell does not end when the two of you are more than 300 feet apart: a distance between two creatures is a cause no `CastingEndTrigger` expresses',
    'the barking at a Small or larger creature that comes within 30 feet without the password, the hound’s Truesight, and the Magic action that walks it 30 feet are the DM’s',
  ],
};

/**
 * SRD Antilife Shell:
 *
 * > _Level 5 Abjuration (Druid)._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 hour.
 * > "An aura extends from you in a 10-foot Emanation for the duration. The
 * > aura prevents creatures other than Constructs and Undead from passing or
 * > reaching through it. An affected creature can cast spells or make attacks
 * > with Ranged or Reach weapons through the barrier. If you move so that an
 * > affected creature is forced to pass through the barrier, the spell ends."
 *
 * Four sentences, no markers, and a barrier in every one of them. Movement
 * consults no walls, so an aura that stops creatures walking through it has
 * nothing to stop them with — and the ending, which fires when the caster
 * walks *into* somebody, is that same absence read from the other side.
 */
export const ANTILIFE_SHELL: SpellDefinition = {
  id: 'antilife-shell',
  name: 'Antilife Shell',
  level: 5,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'nobody is kept out: "The aura prevents creatures other than Constructs and Undead from passing or reaching through it" is a barrier that blocks passage, and a move is checked against distance, the scene and who is standing where rather than against anything in the way',
    'so the exception for Constructs and Undead, and the one that lets an affected creature shoot or reach through, have nothing to be exceptions to',
    'the spell does not end: "If you move so that an affected creature is forced to pass through the barrier, the spell ends" is a cause no `CastingEndTrigger` expresses, and the barrier it reads is the one that is not there',
  ],
};

/**
 * SRD Greater Restoration:
 *
 * > _Level 5 Abjuration (Bard, Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "You touch a creature and magically remove one of the following effects
 * > from it: 1 Exhaustion level; the Charmed or Petrified condition; a curse,
 * > including the target's Attunement to a cursed magic item; any reduction
 * > to one of the target's ability scores; any reduction to the target's Hit
 * > Point maximum."
 *
 * **One of five, and the five are five different mechanics.** `end-condition`
 * takes a list of condition names and would do the second line whole; what it
 * cannot do is be told which of the five lines this casting chose — and three
 * of the other four are things the engine has no state for at all.
 */
export const GREATER_RESTORATION: SpellDefinition = {
  id: 'greater-restoration',
  name: 'Greater Restoration',
  level: 5,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  unmodelled: [
    'which of the five effects is being removed is not recorded, and here the choice decides something: `end-condition` would end the Charmed or the Petrified outright, and writing it would be a spell that always does that one',
    'the Exhaustion level is not removed: Exhaustion is a level the engine counts and no effect decrements one',
    'the ability score reduction and the Hit Point maximum reduction are not restored, because nothing reduces either of them for an effect to undo',
    'the curse, and the Attunement to a cursed magic item that comes with it, are the DM’s',
  ],
};

/**
 * SRD Forcecage:
 *
 * > _Level 7 Evocation (Bard, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 100 feet. **Duration:** Concentration, up to 1 hour.
 * > "An immobile, Invisible, Cube-shaped prison composed of magical force
 * > springs into existence around an area you choose within range. … When you
 * > cast the spell, any creature that is completely inside the cage's area is
 * > trapped. Creatures only partially within the area, or those too large to
 * > fit inside it, are pushed away from the center … If the creature tries to
 * > use teleportation or interplanar travel to leave, it must first make a
 * > Charisma saving throw. … This spell can't be dispelled by _Dispel
 * > Magic_."
 *
 * A prison, and the engine has no walls: being trapped is not one of the
 * fifteen conditions and is not a state at all. Three further absences ride
 * on top — who is *completely* inside a Cube rather than merely in it, a
 * shove for everyone who is not, and a saving throw raised in front of
 * somebody else's teleport.
 */
export const FORCECAGE: SpellDefinition = {
  id: 'forcecage',
  name: 'Forcecage',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 100 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'nobody is caged: being trapped is not one of the fifteen conditions and not a state at all, and a creature that "can’t leave it by nonmagical means" is stopped by a barrier movement never consults',
    'who the cage catches is not decided: "any creature that is completely inside the cage’s area" asks whether a creature fits entirely within a template rather than whether it is in one, and the creatures "only partially within the area, or those too large to fit inside it" are then pushed clear, which is forced movement no effect performs',
    'the Charisma save is not raised: it stands in front of a teleport somebody else is casting, and a casting is not offered another creature’s magic to interrupt',
    'the box that blocks matter and spells, the extension into the Ethereal Plane, and the immunity to Dispel Magic are three more refusals of other magic, and there is no state in which a casting is being refused by a place',
  ],
};

/**
 * SRD Reverse Gravity:
 *
 * > _Level 7 Transmutation (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 100 feet. **Duration:** Concentration, up to 1 minute.
 * > "This spell reverses gravity in a 50-foot-radius, 100-foot high Cylinder
 * > centered on a point within range. All creatures and objects in that area
 * > that aren't anchored to the ground fall upward and reach the top of the
 * > Cylinder. A creature can make a Dexterity saving throw to grab a fixed
 * > object it can reach, thus avoiding the fall upward. … When the spell
 * > ends, affected objects and creatures fall downward."
 *
 * The Cylinder is a shape the engine has and **falling is not a rule it
 * owns**: nothing computes the damage of a drop, and this spell needs it
 * upwards, then again downwards when the Concentration goes. The save is
 * ordinary and what it avoids is the fall.
 */
export const REVERSE_GRAVITY: SpellDefinition = {
  id: 'reverse-gravity',
  name: 'Reverse Gravity',
  level: 7,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 100 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'nobody falls upward: "All creatures and objects in that area that aren’t anchored to the ground fall upward and reach the top of the Cylinder" is forced movement along an axis, and falling is not a rule the engine has at all',
    'so the Dexterity saving throw that grabs a fixed object is not rolled, because what it avoids is the fall',
    'striking a ceiling on the way up, hovering at the top for the duration, and dropping back down when the spell ends are the same absence three more times',
  ],
};

/**
 * SRD Sequester:
 *
 * > _Level 7 Transmutation (Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Until dispelled.
 * > "With a touch, you magically sequester an object or a willing creature.
 * > For the duration, the target has the Invisible condition and can't be
 * > targeted by Divination spells, detected by magic, or viewed remotely with
 * > magic. If the target is a creature, it enters a state of suspended
 * > animation; it has the Unconscious condition … You can set a condition for
 * > the spell to end early. … This spell also ends if the target takes any
 * > damage."
 *
 * **Two of the conditions are real and neither may be written alone.** The
 * Invisible and the Unconscious are ordinary `condition` effects the engine
 * applies all day; they arrive welded to a refusal of Divination magic, to an
 * ending the caster invents at the casting, and to another that fires on any
 * damage from anybody. A definition that imposed the two conditions and none
 * of the three endings would be a spell nobody could wake from.
 */
export const SEQUESTER: SpellDefinition = {
  id: 'sequester',
  name: 'Sequester',
  level: 7,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the Invisible and the Unconscious are not applied, because neither may be written without the endings they come with: a spell that put a creature into suspended animation for ever would be a worse answer than one that puts it there not at all',
    'the refusal of magic is not applied: "can’t be targeted by Divination spells, detected by magic, or viewed remotely with magic" is an effect suppressing other magic, and there is no state in which a casting is being refused by its target',
    'the early ending the caster invents — "You can set a condition for the spell to end early" — is a cause chosen at the casting, which no `CastingEndTrigger` expresses and no casting records',
    '"This spell also ends if the target takes any damage" is any damage from anybody, which is the cause that shape names as still missing',
    'not ageing and not needing food, water or air are the DM’s',
  ],
};

/**
 * SRD Holy Aura:
 *
 * > _Level 8 Abjuration (Cleric)._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "For the duration, you emit an aura in a 30-foot Emanation. While in the
 * > aura, creatures of your choice have Advantage on all saving throws, and
 * > other creatures have Disadvantage on attack rolls against them. In
 * > addition, when a Fiend or an Undead hits an affected creature with a
 * > melee attack roll, the attacker must succeed on a Constitution saving
 * > throw or have the Blinded condition until the end of its next turn."
 *
 * Every benefit is fenced by **"while in the aura"**, which is a standing
 * effect derived from where a creature is standing; and the retaliation is
 * offered somebody else's attack after it has hit, filtered by that
 * attacker's creature type. Three absences, none of them about Advantage or
 * about the Blinded condition, both of which the engine writes readily.
 */
export const HOLY_AURA: SpellDefinition = {
  id: 'holy-aura',
  name: 'Holy Aura',
  level: 8,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Advantage on saving throws is not granted: it holds only "While in the aura", a 30-foot Emanation that travels with the caster, and no effect derives a modifier from where somebody is standing',
    'nor is the Disadvantage on attack rolls against them, which is the same fence around a mode the attacker rolls with',
    'the retaliation is not offered: a Fiend or an Undead hitting an affected creature is somebody else’s attack after it has landed, filtered by the attacker’s creature type, and a casting is offered no window on either',
  ],
};

/**
 * SRD Mass Heal:
 *
 * > _Level 9 Abjuration (Cleric)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** Instantaneous.
 * > "A flood of healing energy flows from you into creatures around you. You
 * > restore up to 700 Hit Points, divided as you choose among any number of
 * > creatures that you can see within range. Creatures healed by this spell
 * > also have the Blinded, Deafened, and Poisoned conditions removed from
 * > them."
 *
 * Heal's two halves at nine levels and any number of targets, and the second
 * word is what stops it: **divided.** Seven hundred hit points shared out as
 * the caster likes is one casting whose effects differ from target to target,
 * and a casting applies its effects to all of them alike — so writing it
 * would heal every creature in range for seven hundred.
 */
export const MASS_HEAL: SpellDefinition = {
  id: 'mass-heal',
  name: 'Mass Heal',
  level: 9,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0, unlimited: true },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'nobody is healed: "You restore up to 700 Hit Points, divided as you choose among any number of creatures" splits one casting’s effect across its targets, and a casting applies its effects to all of them alike — so the flat amount is expressible and the division is not',
    'the Blinded, Deafened and Poisoned are not removed either: `end-condition` takes exactly that printed list, and it hangs on the healing above it, which picks out the creatures it applies to',
  ],
};

export const SPELL_DEFINITIONS: readonly SpellDefinition[] = [
  ACID_ARROW,
  ACID_SPLASH,
  AID,
  ALARM,
  ANIMAL_FRIENDSHIP,
  ANIMAL_MESSENGER,
  ANTILIFE_SHELL,
  ARCANE_EYE,
  ARCANE_LOCK,
  ARCANE_SWORD,
  ARCANISTS_MAGIC_AURA,
  BANE,
  BANISHMENT,
  BARKSKIN,
  BEACON_OF_HOPE,
  BEFUDDLEMENT,
  BLACK_TENTACLES,
  BLESS,
  BLIGHT,
  BLINDNESS_DEAFNESS,
  BLUR,
  BURNING_HANDS,
  CHAIN_LIGHTNING,
  CHARM_MONSTER,
  CHARM_PERSON,
  CHILL_TOUCH,
  CHROMATIC_ORB,
  CIRCLE_OF_DEATH,
  CLAIRVOYANCE,
  CLOUDKILL,
  COLOR_SPRAY,
  COMMAND,
  COMMUNE_WITH_NATURE,
  COMPREHEND_LANGUAGES,
  COMPULSION,
  CONE_OF_COLD,
  CONJURE_FEY,
  CONTAGION,
  CONTINUAL_FLAME,
  COUNTERSPELL,
  CREATE_FOOD_AND_WATER,
  CREATE_OR_DESTROY_WATER,
  CURE_WOUNDS,
  DANCING_LIGHTS,
  DARKVISION,
  DAYLIGHT,
  DEATH_WARD,
  DEMIPLANE,
  DETECT_EVIL_AND_GOOD,
  DETECT_MAGIC,
  DETECT_POISON_AND_DISEASE,
  DETECT_THOUGHTS,
  DIMENSION_DOOR,
  DISGUISE_SELF,
  DISINTEGRATE,
  DISPEL_MAGIC,
  DISSONANT_WHISPERS,
  DIVINE_FAVOR,
  DIVINE_SMITE,
  DOMINATE_BEAST,
  DOMINATE_MONSTER,
  DOMINATE_PERSON,
  DRUIDCRAFT,
  ELDRITCH_BLAST,
  ELEMENTALISM,
  ENHANCE_ABILITY,
  ENLARGE_REDUCE,
  ETHEREALNESS,
  EXPEDITIOUS_RETREAT,
  FABRICATE,
  FAERIE_FIRE,
  FAITHFUL_HOUND,
  FALSE_LIFE,
  FEAR,
  FIND_THE_PATH,
  FIND_TRAPS,
  FINGER_OF_DEATH,
  FIRE_BOLT,
  FIRE_SHIELD,
  FIREBALL,
  FLAME_BLADE,
  FLAME_STRIKE,
  FLAMING_SPHERE,
  FLOATING_DISK,
  FLY,
  FOG_CLOUD,
  FORCECAGE,
  FORESIGHT,
  FREEDOM_OF_MOVEMENT,
  FREEZING_SPHERE,
  GASEOUS_FORM,
  GATE,
  GENTLE_REPOSE,
  GLIBNESS,
  GLOBE_OF_INVULNERABILITY,
  GOODBERRY,
  GREASE,
  GREATER_INVISIBILITY,
  GREATER_RESTORATION,
  GUARDIAN_OF_FAITH,
  GUIDANCE,
  GUIDING_BOLT,
  GUST_OF_WIND,
  HALLUCINATORY_TERRAIN,
  HARM,
  HASTE,
  HEAL,
  HEALING_WORD,
  HEAT_METAL,
  HELLISH_REBUKE,
  HEROISM,
  HIDEOUS_LAUGHTER,
  HOLD_MONSTER,
  HOLD_PERSON,
  HOLY_AURA,
  HUNTERS_MARK,
  HYPNOTIC_PATTERN,
  ICE_KNIFE,
  ICE_STORM,
  IDENTIFY,
  ILLUSORY_SCRIPT,
  INCENDIARY_CLOUD,
  INFLICT_WOUNDS,
  INSECT_PLAGUE,
  INSTANT_SUMMONS,
  INVISIBILITY,
  JUMP,
  KNOCK,
  LEGEND_LORE,
  LESSER_RESTORATION,
  LEVITATE,
  LIGHT,
  LIGHTNING_BOLT,
  LOCATE_ANIMALS_OR_PLANTS,
  LOCATE_CREATURE,
  LOCATE_OBJECT,
  LONGSTRIDER,
  MAGE_ARMOR,
  MAGE_HAND,
  MAGIC_MOUTH,
  MAGIC_WEAPON,
  MAJOR_IMAGE,
  MASS_CURE_WOUNDS,
  MASS_HEAL,
  MASS_HEALING_WORD,
  MASS_SUGGESTION,
  MELD_INTO_STONE,
  MENDING,
  MESSAGE,
  MIND_BLANK,
  MIND_SPIKE,
  MINOR_ILLUSION,
  MIRROR_IMAGE,
  MISTY_STEP,
  MOONBEAM,
  MOVE_EARTH,
  NONDETECTION,
  PASS_WITHOUT_TRACE,
  PASSWALL,
  PHANTASMAL_KILLER,
  PLANE_SHIFT,
  POISON_SPRAY,
  POLYMORPH,
  PRESTIDIGITATION,
  PRIVATE_SANCTUM,
  PRODUCE_FLAME,
  PROTECTION_FROM_ENERGY,
  PROTECTION_FROM_POISON,
  PURIFY_FOOD_AND_DRINK,
  RAY_OF_ENFEEBLEMENT,
  RAY_OF_FROST,
  RAY_OF_SICKNESS,
  REMOVE_CURSE,
  RESILIENT_SPHERE,
  RESISTANCE,
  RESURRECTION,
  REVERSE_GRAVITY,
  ROPE_TRICK,
  SACRED_FLAME,
  SANCTUARY,
  SCORCHING_RAY,
  SCRYING,
  SEARING_SMITE,
  SEE_INVISIBILITY,
  SEEMING,
  SEQUESTER,
  SHAPECHANGE,
  SHATTER,
  SHIELD,
  SHIELD_OF_FAITH,
  SHILLELAGH,
  SHOCKING_GRASP,
  SILENT_IMAGE,
  SLEEP,
  SLEET_STORM,
  SORCEROUS_BURST,
  SPEAK_WITH_ANIMALS,
  SPEAK_WITH_DEAD,
  SPEAK_WITH_PLANTS,
  SPIDER_CLIMB,
  SPIKE_GROWTH,
  SPIRIT_GUARDIANS,
  SPIRITUAL_WEAPON,
  STARRY_WISP,
  STINKING_CLOUD,
  STONE_SHAPE,
  STONESKIN,
  SUGGESTION,
  SUNBEAM,
  SUNBURST,
  TELEKINESIS,
  TELEPATHIC_BOND,
  TELEPORT,
  THUNDERWAVE,
  TINY_HUT,
  TONGUES,
  TRANSPORT_VIA_PLANTS,
  TREE_STRIDE,
  TRUE_SEEING,
  TRUE_STRIKE,
  VAMPIRIC_TOUCH,
  VICIOUS_MOCKERY,
  VITRIOLIC_SPHERE,
  WALL_OF_FIRE,
  WALL_OF_FORCE,
  WARDING_BOND,
  WATER_BREATHING,
  WATER_WALK,
  WEB,
  WEIRD,
  WORD_OF_RECALL,
  ZONE_OF_TRUTH,
];
