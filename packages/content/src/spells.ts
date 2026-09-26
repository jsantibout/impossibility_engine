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
import { CREATURE_TYPES } from '@ie/engine';
import type { ModifierRider, SpellDefinition, SpellEffect } from '@ie/engine';

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
    // "makes an attack roll": every roll, on every road — an Opportunity
    // Attack that misses included. See `roll-recorded.attackRoll`.
    { on: 'target-attacks', ends: 'casting' },
    { on: 'target-deals-damage', ends: 'casting' },
    { on: 'target-casts', ends: 'casting' },
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
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

/**
 * SRD Shield:
 *
 * > _Level 1 Abjuration (Sorcerer, Wizard)._ **Casting Time:** Reaction, which
 * > you take when you are hit by an attack roll or targeted by the _Magic
 * > Missile_ spell. **Range:** Self. **Duration:** 1 round.
 * > "An invisible barrier of magical force appears and protects you. Until the
 * > start of your next turn, you have a +5 bonus to AC, including against the
 * > triggering attack, and you take no damage from _Magic Missile_."
 *
 * **The one spell in the book with two triggers**, and the second waited two
 * years on a window nobody had a point in a path for. It has one now: a
 * casting that has been *declared* has settled its targets and not resolved
 * its effects, which is where Counterspell already stands — so the same hold
 * answers both, from opposite ends. `targetedBy` names the spell and
 * `negatesTriggeringCasting` is the benefit: the spell is pinned off the
 * casting that triggered it and its damage is turned aside for as long as the
 * barrier stands, which is where the SRD puts it — inside the same duration as
 * the +5, so a second caster's volley in the same round is stopped too.
 *
 * What the second trigger costs is a declaration: a Magic Missile resolved in
 * one command passes through the moment without stopping, so a table that
 * wants the defender to have their say casts it with `hold`. That is the same
 * price Counterspell pays and it is stated rather than worked around — an
 * engine that held every casting open would make every Fire Bolt a two-command
 * negotiation.
 */
export const SHIELD: SpellDefinition = {
  id: 'shield',
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  castingTime: 'reaction',
  trigger: 'hit-by-attack',
  // "…**or targeted by the _Magic Missile_ spell**." The book's one spell with
  // two triggers, and the second is a window that opens where a casting has
  // named its targets and not yet resolved on them — which is the hold
  // Counterspell already answers, read from the other end of it.
  targetedBy: 'magic-missile',
  // "Until the start of your next turn … and you take no damage from _Magic
  // Missile_." Both halves of the sentence are inside the duration, so what
  // the barrier turns aside is the spell for as long as it stands — a second
  // caster's volley included. The spell is pinned off the casting that
  // triggered it, which is why this is not `damage-defense`: that vocabulary
  // names a damage type, and nothing in the engine names this one.
  negatesTriggeringCasting: true,
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
 * **The spell the forced-movement rider was built for**, and every clause the
 * engine owns now executes. The push is a rider on the failed save rather than an
 * effect of its own, because one sentence is one saving throw: a second effect
 * would roll a second Constitution save, and a creature could then take the
 * 2d8 and stand exactly where it was. Ten feet straight away from the caster,
 * spending no Speed, charging no Difficult Terrain and provoking nobody — see
 * `ForcedMovement` in `spell-definitions.ts` for why the direction is the
 * sentence rather than a field.
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
      // "and is pushed 10 feet away from you", on the same failure as the dice.
      movement: { feet: 10 },
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
 *
 * One sentence, two consequences, one attack roll — so the refusal is a rider
 * on the hit rather than a second effect that would roll a second attack for
 * the same touch, which is Chill Touch's argument two spells down.
 *
 * **What kept this filed as debt for two batches was neither half of it.**
 * `forbids` takes a named action away and leaves the rest of the budget
 * alone, and `NAMED_ACTIONS` has listed the Opportunity Attack — against this
 * spell by name — since IE-046. It was the *deadline*: a cantrip is
 * Instantaneous, so the casting is over the instant it resolves and could
 * never hand the Reaction back, and `RiderDuration` had a word for the start
 * of the **caster's** next turn and the end of the **target's** and none for
 * the start of the target's. That is a round out from what the book says when
 * the caster acted first.
 */
export const SHOCKING_GRASP = attackCantrip({
  id: 'shocking-grasp',
  name: 'Shocking Grasp',
  school: 'evocation',
  feet: 'touch',
  attack: 'melee',
  dice: '1d8',
  damageType: 'lightning',
  // "until the start of **its** next turn" — the target's, which is the anchor
  // `start-of-targets-next-turn` names and a round from the caster's own.
  modifiers: [
    {
      kind: 'action',
      rule: { kind: 'forbids', actions: ['opportunity-attack'] },
      lasts: 'start-of-targets-next-turn',
    },
  ],
});

/**
 * SRD Chill Touch:
 *
 * > _Necromancy Cantrip (Sorcerer, Warlock, Wizard)._ **Range:** Touch.
 * > "Make a melee spell attack against a target within reach. On a hit, the
 * > target takes 1d10 Necrotic damage, and it can't regain Hit Points until
 * > the end of your next turn."
 *
 * One sentence, two consequences, one attack roll — so the refusal is a rider
 * on the hit rather than a second effect that would roll a second attack for
 * the same touch. The deadline is the rider's own because a cantrip is
 * Instantaneous: the casting is over the instant it resolves and could never
 * lift what it hung, which is the argument Ray of Frost's Speed reduction made
 * first and `checkGrantLifetimes` is what insists on.
 */
export const CHILL_TOUCH = attackCantrip({
  id: 'chill-touch',
  name: 'Chill Touch',
  school: 'necromancy',
  feet: 'touch',
  attack: 'melee',
  dice: '1d10',
  damageType: 'necrotic',
  // "until the end of **your** next turn" — the caster's, which is the anchor
  // `end-of-casters-next-turn` names and a full round from the target's own.
  modifiers: [{ kind: 'healing', rule: 'prevented', lasts: 'end-of-casters-next-turn' }],
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
 * **Two consequences of one hit, and only one of them is a condition** — which
 * is neither half of what this sentence says. The first half is light the
 * target sheds, which the engine has no model of at all; the second is the
 * *loss* of a benefit it would otherwise have, which is the `benefit` rider:
 * the creature stays Invisible and stops getting anything for it, and the
 * deadline is the rider's own because a cantrip's casting is over the instant
 * it resolves. The same argument Chill Touch's refusal makes one spell up.
 */
export const STARRY_WISP = attackCantrip({
  id: 'starry-wisp',
  name: 'Starry Wisp',
  school: 'evocation',
  feet: 60,
  dice: '1d8',
  damageType: 'radiant',
  // "until the end of **your** next turn" — the caster's, which is the anchor
  // `end-of-casters-next-turn` names and a full round from the target's own.
  modifiers: [{ kind: 'benefit', denies: 'invisible', lasts: 'end-of-casters-next-turn' }],
  unmodelled: [
    'until the end of your next turn the target emits Dim Light in a 10-foot radius',
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
 * misses on its own and may be aimed at a different creature. So the upgrade
 * is written on `rolls` and the damage is deliberately left flat: dressing the
 * beams up as extra dice would make the cantrip hit or miss all at once and be
 * worth a different amount.
 *
 * `targets: { count: 1 }` is what the spell prints \u2014 "against one creature or
 * object in range" \u2014 and the beams are what widen it, one creature per beam.
 *
 * **"At the same target or at different ones" is said in full**, the lopsided
 * middle included: a caster who wants two beams on the ogre and one on the
 * goblin states it on the casting (`rollsAt`), and one who says nothing has
 * them dealt evenly round the creatures they named. This spell carried the
 * other half of that sentence as `unmodelled` until the count could be stated.
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
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '1d10' },
      damageType: 'force',
      // "two beams at level 5, three beams at level 11, and four beams at
      // level 17" \u2014 the Cantrip Upgrade's own three levels, spent on rolls.
      rolls: { count: 1, cantripUpgradesAt: [5, 11, 17] },
    },
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
      // "the **next** attack roll made against it ... has Advantage": one roll,
      // whoever makes it, and then gone — `oneShot`, which is the half of
      // the sentence a durable grant could never say. The other half is the
      // deadline, and both endings stand: whichever arrives first.
      //
      // `against-holder` because the Advantage is on rolls made *against* the
      // creature carrying it, and `lasts` because the spell's own Duration of
      // one round leaves no casting that could take the grant back.
      modifiers: [
        {
          kind: 'mode',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'attack', relation: 'against-holder' },
            oneShot: true,
          },
          lasts: 'end-of-casters-next-turn',
        },
      ],
    },
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
      // "must immediately use its Reaction, if available, to move as far away
      // from you as it can, using the safest route." The Reaction goes and the
      // fleeing does not happen: the engine charges the economy and performs
      // nothing, so the book's own phrase rides along in the log for the table
      // to narrate from. "If available" is the resolver's silence — a target
      // that has already reacted, or that a Slow had already forbidden, simply
      // loses nothing and still takes the damage.
      spends: {
        slots: ['reaction'],
        on: 'moving as far away from the caster as it can, using the safest route',
      },
    },
  ],
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
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
      modifiers: [
        // "if it has the Invisible condition, it gains no benefit from that
        // condition **against you**" — the `benefit` rider narrowed to the
        // caster, which is what separates this from Starry Wisp's blanket
        // denial: the spiked creature is still Invisible to everybody else,
        // and still rolls Initiative with the Advantage the condition
        // confers, because that roll is against nobody.
        { kind: 'benefit', denies: 'invisible', against: 'caster' },
      ],
    },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'knowing the target’s location for the duration is the DM’s, and so is "the target can’t become hidden from you": the engine holds no knowledge model and sight is a declaration, so a DM who declares the sight has said the whole of both',
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
 * > _Level 5 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
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
      // "During that time … **it can't end the Prone condition on itself**."
      // A mark on the instance the failure creates, so it lifts when the
      // Laughter does and `standUp` refuses while it stands.
      forbidsStandingUp: true,
      conditions: [{ name: 'incapacitated' }],
      // "At the end of each of its turns **and each time it takes damage**, it
      // makes another Wisdom saving throw. The target has Advantage on the
      // save if the save is triggered by damage." One save, two moments, one
      // of which changes the mode — so the trigger rides on the repeat rather
      // than standing beside it as a second hook.
      repeats: {
        at: 'end-of-turn',
        onSuccess: 'end-casting',
        alsoWhenDamaged: { mode: 'advantage' },
      },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
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
  targets: { count: 1, self: true, extraPerSlotLevelAbove: 1, willing: true },
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
 * attention.
 *
 * **And "(your choice)" is the caster's now**, which is what the paragraph
 * here used to say was missing: the definition prints both conditions, the
 * casting names one of them, and `statedChoice` puts it on the save. The
 * effect below still carries Blinded so the definition reads as a whole spell
 * on its own — the discipline Spirit Guardians already follows with one of
 * its two damage types — and a casting that said Deafened deafens.
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
  // "the Blinded or Deafened condition (your choice)", in the order the SRD
  // prints them. The save above carries the first so the shape is whole read
  // alone; which one this casting imposes is the caster's to say.
  choiceStated: { of: 'condition', options: ['blinded', 'deafened'] },
  durationSeconds: 60,
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
 * > duration. A Frightened creature takes the Dash action and moves away from
 * > you by the safest route on each of its turns unless there is nowhere to
 * > move. If the creature ends its turn in a space where it doesn't have line
 * > of sight to you, the creature makes a Wisdom saving throw. On a
 * > successful save, the spell ends on that creature."
 *
 * Three sentences and three different answers. The first is a save, a drop
 * and a condition, all of them the engine's: `drops.all` is Command's Drop
 * — "whatever it is holding" names no object — and the Frightened is the
 * casting's for the duration. The second is a compulsion, and the ruling on
 * compulsions stands: the Action slot is narrowed to the Dash and fails
 * closed, so the engine refuses everything else and walks nobody; the route
 * and the "unless there is nowhere to move" are the table's, handed over in
 * the book's words. The third is a repeat save with a **gate** — owed only
 * where the creature cannot see the caster, which is `SpellRepeatSave.onlyIf`
 * and the sight declaration the boundary reads — ending the spell on that
 * creature alone.
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
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'frightened',
      // "drop whatever it is holding": no object is named because there is
      // none to name — SRD Command's Drop, on a failure this save settles.
      drops: { all: true },
      // "A Frightened creature takes the Dash action" — written as the
      // legality it is, and never as an instruction that executes. The Action
      // slot is narrowed to the Dash and fails closed, so the engine refuses
      // everything else and makes nobody run; whether the creature actually
      // Dashes, and where it goes, is the table's. See {@link ActionRule} in
      // `combat.ts`, which derives `permits-only` from this sentence.
      modifiers: [
        { kind: 'action', rule: { kind: 'permits-only', slot: 'action', actions: ['dash'] } },
      ],
      // "If the creature ends its turn in a space where it doesn't have line
      // of sight to you, the creature makes a Wisdom saving throw. On a
      // successful save, the spell ends on that creature." The repeat rides
      // the Frightened it imposed and is owed only behind the gate.
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target', onlyIf: 'cannot-see-caster' },
    },
  ],
  durationSeconds: 60,
  // The compulsion's route and its stop, in the book's words, under the
  // ruling that a compelled Dash is adjudicated and never performed.
  dmDecides: [
    'A Frightened creature takes the Dash action and moves away from you by the safest route on each of its turns unless there is nowhere to move.',
  ],
};

/**
 * SRD Feather Fall:
 *
 * > _Level 1 Transmutation (Bard, Sorcerer, Wizard)._
 * > **Casting Time:** Reaction, which you take when you or a creature you can
 * > see within 60 feet of you falls. **Range:** 60 feet.
 * > **Duration:** 1 minute.
 * > "Choose up to five falling creatures within range. A falling creature's
 * > rate of descent slows to 60 feet per round until the spell ends. If a
 * > creature lands before the spell ends, the creature takes no damage from
 * > the fall, and the spell ends for that creature."
 *
 * **The spell the whole `falling` shape was named for**, and it is here as a
 * *tracked* definition rather than an executed one, which is the honest split
 * of its three sentences. The first is the engine's: five targets, each of
 * whom must be falling, each within 60 feet, answered as a Reaction at the
 * moment the table declares the fall — a slot, an action-economy cost and a
 * minute on the clock, all of them the engine's to spend and to run out.
 *
 * The other two are a descent the engine does not measure and damage it does
 * not deal. The SRD gives the rate ("60 feet per round") and gives the height
 * to the DM, so a landing this engine recognised would be one it had invented
 * the distance for. `TRACKED_ADJUDICATED` records both against the shape,
 * which keeps `falling` on the map for the Monk's Slow Fall and for Reverse
 * Gravity rather than retiring it on the strength of the half that got built.
 */
export const FEATHER_FALL: SpellDefinition = {
  id: 'feather-fall',
  name: 'Feather Fall',
  level: 1,
  school: 'transmutation',
  castingTime: 'reaction',
  trigger: 'creature-falling',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  // "up to five falling creatures within range" — a maximum rather than a
  // demand, and `self: true` because the trigger names the caster first: "when
  // **you** or a creature you can see ... falls".
  targets: { count: 5, self: true, mustBeFalling: true },
  // "the creature takes no damage from the fall, and the spell ends for that
  // creature" — both halves, and the second is why a ward is hung on each of
  // the five separately rather than on the casting: one of them landing ends
  // the spell on that one and leaves the other four in the air.
  effects: [{ kind: 'fall-ward' }],
  durationSeconds: 60,
  unmodelled: [
    'the rate of descent is not slowed: nothing in the engine measures a descent, and the SRD gives the new rate as 60 feet per round against a height only the DM holds',
    'the trigger’s "a creature you can see" goes unchecked, as Counterspell’s does: the 60 feet is the spell’s Range and is checked, and which falls a caster perceives the engine has never modelled',
  ],
};

/**
 * SRD Hypnotic Pattern:
 *
 * > _Level 3 Illusion (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "Each creature in the area who can see the pattern must succeed on a
 * > Wisdom saving throw or have the Charmed condition for the duration. While
 * > Charmed, the creature has the Incapacitated condition and a Speed of 0."
 */
export const HYPNOTIC_PATTERN: SpellDefinition = {
  id: 'hypnotic-pattern',
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
  name: 'Hypnotic Pattern',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  // "Each creature in the area **who can see the pattern**": the pattern is at
  // the point the Cube was laid on, so the clause is a sight question about a
  // place. A creature the book excuses — Blinded, or standing in a fog bank
  // that swallows the pattern — is filtered out of the catch; a creature
  // nobody has spoken about is caught, and the casting says whose question it
  // was, because no table can declare a line of sight to a patch of air.
  targets: { count: 0, mustSeeTheOrigin: true },
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
  // "The spell ends for an affected creature if it takes any damage **or if
  // someone else uses an action to shake the creature out of its stupor**."
  // **Any** damage, dealer or no dealer; and both halves on that creature
  // rather than on the Cube, so the other three go on staring. `wakeCreature`
  // is the action the second half costs.
  endsEarly: [
    { on: 'target-takes-damage', ends: 'target' },
    { on: 'shaken-awake', ends: 'target' },
  ],
};

/**
 * SRD Slow:
 *
 * > _Level 3 Transmutation (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "You alter time around up to six creatures of your choice in a 40-foot
 * > Cube within range. Each target must succeed on a Wisdom saving throw or
 * > be affected by this spell for the duration."
 * > "An affected target's Speed is halved, it takes a −2 penalty to AC and
 * > Dexterity saving throws, and it can't take Reactions. On its turns, it
 * > can take either an action or a Bonus Action, not both, and it can make
 * > only one attack if it takes the Attack action. If it casts a spell with a
 * > Somatic component, there is a 25 percent chance the spell fails as a
 * > result of the target making the spell's gestures too slowly."
 * > "An affected target repeats the save at the end of each of its turns,
 * > ending the spell on itself on a success."
 *
 * **The spell `save.condition` was made optional for.** One Wisdom saving
 * throw, and what a failure buys is a list of *grants*: the Speed halved, the
 * penalty to Armour Class, the Reaction taken away, the turn's two slots
 * coupled. Every one of them is a
 * {@link ModifierRider} the engine already had, and none of them is a
 * condition — so before the flat field became optional this paragraph had no
 * host at all. Written as standalone effects instead, all three would have
 * landed on every creature the caster named whether it saved or not, which is
 * the confident wrong answer rather than the missing one.
 *
 * **The Cube bounds a choice rather than making one**, which is
 * `targetsWithin` and not `area`: "up to six creatures **of your choice** in
 * a 40-foot Cube" is Mass Cure Wounds' sentence with a saving throw on the
 * end, and an `area` would slow every ally standing in it.
 *
 * **And the turn's two slots coupled to each other is written too**, which is
 * `ActionRule`'s fifth member: "it can take either an action or a Bonus
 * Action, not both" is one rule naming the pair, and the first of them spent
 * forecloses the other for that turn. It could not be said while every member
 * judged one slot alone — a `forbids` naming both refuses the turn entirely,
 * and a `forbids` naming one takes away the choice the sentence offers.
 *
 * **The −2 reaches Dexterity saving throws too, and it is a second rider.** A
 * `bonus` rider carries a {@link BonusNarrowing} now, and an Armour Class
 * cannot carry one — it is not a roll and is made with no ability at all — so
 * one printed penalty is two grants of one casting, told apart by `bonusKey`
 * and ended together by the casting's own source. Aimed at `save` unnarrowed
 * it would have landed on every save the target ever makes, including the one
 * this spell itself calls for.
 *
 * **And the repeat save is hosted by the casting, per creature.** "Ending the
 * spell **on itself** on a success" is `end-on-target`, and the failure
 * imposes no condition for a hook to be filed on — so it rides on the
 * casting's grants on that one creature, which is a key apiece over the six
 * this spell can catch. The goblin that makes its save is free and the
 * hobgoblin beside it is still slowed.
 *
 * **What is left is two sentences and each is a different absence.** The
 * attacks counted inside the Attack action are a thing the economy does not
 * count: it counts one Attack action and not the swings in it. And the 25
 * percent is a die no `SpellEffect` asks for — a die that decides whether
 * another casting happens at all.
 */
export const SLOW: SpellDefinition = {
  id: 'slow',
  name: 'Slow',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 6 },
  targetsWithin: { kind: 'cube', size: 40, origin: 'point' },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      // "An affected target repeats the save at the end of each of its turns,
      // ending the spell **on itself** on a success." The failure imposes no
      // condition, so there is no instance to file the hook on and it rides on
      // the casting — on the casting's grants on *this* creature, which is a
      // key per creature and is what lets a spell catching six carry six of
      // them. A success lifts what the casting hung on that one target and
      // leaves the rest of the spell running.
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
      // Four grants and no condition, off one saving throw. A second `save`
      // effect for any of them would roll a second die, and a creature could
      // then be slowed and not penalised.
      modifiers: [
        // "An affected target's Speed is halved" — presence rather than
        // count, so two Slows are one halving.
        { kind: 'speed-change', change: 'halve' },
        // "it takes a −2 penalty to AC". A flat bonus with the sign turned
        // round, which is the only kind an Armour Class takes.
        { kind: 'bonus', bonus: { source: 'Slow', flat: 2 }, applies: ['ac'], direction: 'subtract' },
        // "and Dexterity saving throws" — the same −2 on a different family,
        // narrowed by the ability the roll is made with. **A second rider and
        // a second source**, for two reasons that both bite: a bonus is filed
        // by source and a second grant under `Slow` would replace the first
        // rather than stand beside it, and `BonusNarrowing` is refused beside
        // an Armour Class because an Armour Class is not a roll and is made
        // with no ability at all. So the two halves of one printed penalty are
        // two grants of one casting, ended together by the casting's own
        // source.
        {
          kind: 'bonus',
          bonus: { source: 'Slow (Dexterity saves)', flat: 2 },
          applies: ['save'],
          direction: 'subtract',
          only: { ability: 'dex' },
        },
        // "and it can't take Reactions" — one slot taken away, with
        // everything the sentence does not name left alone.
        { kind: 'action', rule: { kind: 'forbids', slots: ['reaction'] } },
        // "On its turns, it can take either an action or a Bonus Action, not
        // both" — the two slots coupled, so whichever goes first closes the
        // other for that turn. A fourth grant off the same saving throw.
        { kind: 'action', rule: { kind: 'one-of', slots: ['action', 'bonus-action'] } },
      ],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    '"it can make only one attack if it takes the Attack action" is not applied: the economy counts one Attack action and not the attacks inside it',
    'the 25 percent chance a Somatic spell fails is not rolled: it is a percentage no effect asks for, deciding whether another casting happens at all',
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
 * The 2024 wording narrowed this: it is one *chosen skill*, not any check —
 * and the cantrip needs both halves of one shape, which is why it is the spell
 * the pair was built for. The **choice** is `choiceStated`, printed as the
 * eighteen skills and answered at the casting; the **narrowing** is
 * `BonusNarrowing`, which is what a stored bonus had no axis for, so a
 * Guidance hung on ability checks reached every check its target ever made.
 *
 * The `only` below names Acrobatics for the reason the effect carries a
 * printed value everywhere else in this catalogue: the definition has to be a
 * whole spell read on its own, and the casting is what says which skill this
 * one is about.
 */
export const GUIDANCE: SpellDefinition = {
  id: 'guidance',
  name: 'Guidance',
  level: 0,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Guidance', dice: '1d4' },
      applies: ['ability-check'],
      direction: 'add',
      only: { skill: 'acrobatics' },
    },
  ],
  // "choose a skill", which is any of the eighteen: the SRD names no shorter
  // list, so neither does this.
  choiceStated: {
    of: 'skill',
    options: [
      'acrobatics',
      'animal-handling',
      'arcana',
      'athletics',
      'deception',
      'history',
      'insight',
      'intimidation',
      'investigation',
      'medicine',
      'nature',
      'perception',
      'performance',
      'persuasion',
      'religion',
      'sleight-of-hand',
      'stealth',
      'survival',
    ],
  },
  durationSeconds: 60,
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
      // "Disadvantage on the **next attack roll it makes** before the end of
      // **its** next turn": Guiding Bolt's sentence from the other end of the
      // relation — the mode is on rolls the holder makes rather than on
      // rolls made against them — and the same two endings, whichever
      // comes first.
      //
      // A cantrip and Instantaneous, so there is no casting that could ever
      // lift the Disadvantage; `lasts` is the rider's own deadline, anchored
      // to the target because the SRD anchors it to "its" turn rather than
      // yours.
      modifiers: [
        {
          kind: 'mode',
          modifier: {
            mode: 'disadvantage',
            selector: { roll: 'attack', relation: 'roller' },
            oneShot: true,
          },
          lasts: 'end-of-targets-next-turn',
        },
      ],
    },
  ],
};

/**
 * SRD Grease:
 *
 * > _Level 1 Conjuration (Sorcerer, Wizard)._ **Casting Time:** Action. **Range:** 60
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
  // "turns it into Difficult Terrain for the duration" — the glossary's own
  // rate, on the square the casting pinned, lapsing with the casting.
  areaTerrain: { costPerFoot: 2 },
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
  // **Handed over whole.** Knowing something changes no authoritative state,
  // which is the line this spell and Identify are both on: the Magic action
  // that sees an aura and the school it reports are narration, and the
  // blocking rule is a wall nobody has modelled.
  dmDecides: [
    'For the duration, you sense the presence of magical effects within 30 feet of yourself.',
    "If you sense such effects, you can take the Magic action to see a faint aura around any visible creature or object in the area that bears the magic, and if an effect was created by a spell, you learn the spell's school of magic.",
    'The spell is blocked by 1 foot of stone, dirt, or wood; 1 inch of metal; or a thin sheet of lead.',
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
  targets: { count: 1, self: true, mustBeUnarmored: true, willing: true },
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
};

/**
 * SRD Magic Missile:
 *
 * > _Level 1 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You create three glowing darts of magical force. Each dart strikes a
 * > creature of your choice that you can see within range. A dart deals 1d4 +
 * > 1 Force damage to its target. The darts all strike simultaneously, and you
 * > can direct them to hit one creature or several."
 * > _Using a Higher-Level Spell Slot._ "The spell creates one more dart for
 * > each spell slot level above 1."
 *
 * **The spell the `auto-damage` effect was built for**, and the shape is the
 * whole of it: damage with nothing rolled to decide whether it lands. Every
 * damage-bearing kind the format had hung off an attack roll or a saving
 * throw, so this paragraph could not be written at all.
 *
 * **Three darts, three damage rolls.** "A dart deals 1d4 + 1" is singular, and
 * the reading is Eldritch Blast's beams word for word: a count of hits rather
 * than a count of dice. One 3d4+3 would hand the printed +1 out once instead
 * of three times and would let a Resistance halve once instead of three times
 * — wrong in both directions, and by different amounts.
 *
 * **The two counts say two different things and happen to agree.** `targets`
 * is how many creatures may be named — "one creature or several", one more per
 * slot level — and `rolls` is how many darts there are to hand out among them.
 * Which creature gets how many is the caster's, said with `rollsAt` and dealt
 * round the list when they say nothing, exactly as Scorching Ray's rays are.
 *
 * **Shield's second trigger is answered here now**, and neither of the two
 * things it was waiting for turned out to be what finished it. The window is
 * `targeted-by-spell` — a casting that has been *declared* and not resolved,
 * which is where Counterspell already stands — and the benefit is narrowed to
 * a **casting id** rather than to a spell, so the engine names nothing and
 * `damage-defense` is left saying what it always said. A volley a defender is
 * meant to answer is declared with `hold`; see `SHIELD`.
 */
export const MAGIC_MISSILE: SpellDefinition = {
  id: 'magic-missile',
  name: 'Magic Missile',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  // "you can direct them to hit one creature or several", and one more dart
  // per slot level above the first — so up to three creatures at level 1.
  targets: { count: 3, extraPerSlotLevelAbove: 1 },
  effects: [
    {
      kind: 'auto-damage',
      // "A dart deals 1d4 + 1 Force damage" — the addend is printed on the
      // dart, so it lands on every one of them.
      damage: { dice: '1d4', flat: 1 },
      damageType: 'force',
      // "The spell creates one more dart for each spell slot level above 1."
      rolls: { count: 3, extraPerSlotLevelAbove: 1 },
    },
  ],
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
  // **Handed over whole.** The hand is not a thing in the world: where it is,
  // what it manipulates, the 30 feet it moves, the 10-pound limit and the ban
  // on attacking or activating magic items are all measured against something
  // that stands in no square.
  //
  // "The hand lasts for the duration" is **not** here, because the engine runs
  // that clock. The vanishing sentence is, and it is the one line in this list
  // the engine does half of: the book prints the 30 feet and the recast in one
  // sentence, the format's unit is a sentence, and `replacesPriorCasting`
  // above executes the recast. The table is told the printed text; the log
  // says what the engine did with it.
  dmDecides: [
    'A spectral, floating hand appears at a point you choose within range.',
    'The hand vanishes if it is ever more than 30 feet away from you or if you cast this spell again.',
    'When you cast the spell, you can use the hand to manipulate an object, open an unlocked door or container, stow or retrieve an item from an open container, or pour the contents out of a vial.',
    'As a Magic action on your later turns, you can control the hand thus again.',
    'As part of that action, you can move the hand up to 30 feet.',
    "The hand can't attack, activate magic items, or carry more than 10 pounds.",
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
  // The bearer of the object: the SRD touches "one Large or smaller object",
  // the engine holds no objects, and the object that matters is in somebody's
  // hand — so the casting names the creature carrying it, the caster included,
  // and the light goes where they go.
  targets: { count: 1, self: true },
  effects: [{ kind: 'light', level: 'bright', radius: 20, dimBeyond: 20 }],
  durationSeconds: 3600,
  replacesPriorCasting: true,
  unmodelled: [
    'the spell targets an object, and objects are not modelled: the casting names the creature carrying it, and which object that is, and whether it is worn or carried by someone else, are the DM’s. An object nobody carries is a point the table lights with `declare_light`',
    'covering the object with something opaque is the DM’s, because what is over an object is a fact about an object',
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
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true, willing: true },
  // The whole of the printed benefit, in one grant: the mode, the number of
  // feet, and the hovering the same sentence hands over. The ten minutes are
  // the casting's own deadline, so the grant needs no `lasts` — it ends
  // through the door `releaseCasting` already opens, and the Concentration is
  // the other way it ends.
  effects: [{ kind: 'speed', change: 'add', feet: 60, mode: 'fly', hover: true }],
  durationSeconds: 600,
  unmodelled: [
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
  targets: { count: 1, self: true, willing: true },
  // SRD: "the target has Darkvision with a range of 150 feet" — a sense the
  // casting confers, read beside the ones a species grants at the longest
  // range held, and gone when the eight hours are.
  effects: [{ kind: 'sense', sense: 'darkvision', feet: 150 }],
  durationSeconds: 28_800,
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
  targets: { count: 1, extraPerSlotLevelAbove: 1, willing: true },
  // "a Climb Speed equal to its Speed", which is the sentence `match-walk`
  // exists for: the number is the target's own and no definition could print
  // it.
  effects: [{ kind: 'speed', change: 'match-walk', mode: 'climb' }],
  durationSeconds: 3600,
  unmodelled: [
    'moving up, down and across vertical surfaces and along ceilings is not applied; the lattice holds elevation and no surfaces',
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
  // **Handed over whole**, minus the check above: what the caster looks like,
  // and whether the illusion holds up to a hand passing through a hat that is
  // not there, are the DM's; the Investigation check against the spell save DC
  // is the engine's and is rolled.
  dmDecides: [
    'You make yourself—including your clothing, armor, weapons, and other belongings on your person—look different until the spell ends.',
    'You can seem 1 foot shorter or taller and can appear heavier or lighter.',
    'You must adopt a form that has the same basic arrangement of limbs as you have.',
    'Otherwise, the extent of the illusion is up to you.',
    'The changes wrought by this spell fail to hold up to physical inspection.',
    'For example, if you use this spell to add a hat to your outfit, objects pass through the hat, and anyone who touches it would feel nothing.',
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
  // **Handed over whole.** The sheet records which languages a character knows
  // and nothing in play reads them, so understanding one more is a fact with
  // no reader — `docs/design/content.md`'s test applied: a table fact a rule
  // then reads is a debt, and nothing reads this one afterwards.
  dmDecides: [
    'For the duration, you understand the literal meaning of any language that you hear or see signed.',
    'You also understand any written language that you see, but you must be touching the surface on which the words are written.',
    'It takes about 1 minute to read one page of text.',
    "This spell doesn't decode symbols or secret messages.",
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
  // "The webs are Difficult Terrain" — one of the three sentences the spell
  // writes about one Cube, beside the save its trigger rolls.
  areaTerrain: { costPerFoot: 2 },
  // And the second of the three, which waited on the sight model: "The area
  // within the webs is Lightly Obscured." Not a level of light — the webbing
  // is not dim, it is thick — which is why obscurement is a record of its own
  // and why this spell could not have been finished by a light level.
  areaObscurement: { degree: 'lightly' },
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
        // "have the Restrained condition **while in the webs** or until it
        // breaks free" — two ways out of one condition, and this is the first
        // of them. The escape check below is the second.
        endsWhenOutsideArea: true,
        check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
      },
    ],
  },
  durationSeconds: 3600,
  unmodelled: [
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
        // "While Poisoned in this way, the creature can't take an action or a
        // Bonus Action." **A rider on the outcome the save already settled**,
        // because it is the same failure: a second effect would roll a second
        // Constitution save for one sentence. Its deadline is the Poisoned's
        // own — the clause is about the turn the boundary fired at, and the
        // casting's minute would go on gagging somebody for the rest of the
        // fight.
        modifiers: [
          {
            kind: 'action',
            rule: { kind: 'forbids', slots: ['action', 'bonus-action'] },
            lasts: 'end-of-current-turn',
          },
        ],
      },
    ],
  },
  durationSeconds: 60,
  unmodelled: [
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
  targets: { count: 10, willing: true },
  effects: [],
  durationSeconds: 86_400,
  // **Handed over whole.** Suffocation is not modelled, so breathing
  // underwater lifts a rule the engine does not apply.
  dmDecides: [
    'This spell grants up to ten willing creatures of your choice within range the ability to breathe underwater until the spell ends.',
    'Affected creatures also retain their normal mode of respiration.',
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
  // **Handed over whole**, and the Influence half is why it took a second
  // reading: `NAMED_ACTIONS` holds `influence` and `takeInfluence` never
  // narrowed by the target's creature type, so an Influence attempt on a Beast
  // was already legal and already rolled — there is nothing here for the spell
  // to widen. What it buys is comprehension, which is speech, and the engine
  // holds no speech.
  dmDecides: [
    "For the duration, you can comprehend and verbally communicate with Beasts, and you can use any of the Influence action's skill options with them.",
    "Most Beasts have little to say about topics that don't pertain to survival or companionship, but at minimum, a Beast can give you information about nearby locations and monsters, including whatever it has perceived within the past day.",
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
 *
 * **The 2024 sentence, which is not the one this definition was written
 * against.** The older printing tripled a jump distance, and a multiplier is
 * what the engine would have needed to build; this prints two flat numbers and
 * a cap, and all three are ordinary. So `jump-allowance` carries the thirty and
 * the ten, `checkJump` takes the longer of the spell's bound and the creature's
 * own, and `resolveMove` charges the spell's price instead of the ground's —
 * which is what makes the spell worth casting on a Wizard as well as on a
 * Barbarian.
 *
 * **The distance bounds a Long Jump**, because the sentence's thirty feet is a
 * distance and the High Jump's own number is a height. The SRD's "Jump"
 * glossary names the two separately and this spell names neither, so reading
 * one as the other would hand a level 1 spell thirty feet of altitude.
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
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true, willing: true },
  // "Once on each of its turns until the spell ends, that creature can jump up
  // to 30 feet by spending 10 feet of movement." Two numbers and a cap, and
  // the cap is stamped on the grant rather than counted anywhere else — so a
  // second casting of this spell is a second sentence with its own once.
  effects: [{ kind: 'jump-allowance', feet: 30, costsMovement: 10 }],
  durationSeconds: 60,
};

/**
 * SRD Prestidigitation:
 *
 * > _Transmutation Cantrip._ **Casting Time:** Action. **Range:** 10 feet.
 * > **Duration:** Up to 1 hour.
 * > "You create a magical effect within range. Choose the effect from the
 * > options below. If you cast this spell multiple times, you can have up to
 * > three of its non-instantaneous effects active at a time."
 *
 * **The six wonders are the table's and the cap is not.** Every option the
 * spell lists — the sparks, the candle, the smudge, the chill, the mark and
 * the trinket — is fiction nothing in the engine reads afterwards, which is
 * why this spell was tracked. The sentence above them is the one mechanical
 * rule it prints, and `maxRunning` is it: a fourth casting by the same caster
 * ends the oldest of the three still running, which is
 * {@link SpellDefinition.replacesPriorCasting} with a different number.
 *
 * **Castings, not wonders, and the difference is stated rather than glossed.**
 * The book caps the *non-instantaneous* effects, and three of the six are
 * Instantaneous — but the engine models none of the six and gives every
 * casting the hour the lasting ones print, so counting castings is counting
 * exactly the population the sentence names under the engine's own reading of
 * the spell. A caster who lit three candles and then made a mark has ended the
 * first candle here and would not have at a table; nothing mechanical hangs on
 * either answer, and the alternative is a choice between six effect lists that
 * `choiceStated` is documented as not being.
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
  maxRunning: 3,
  unmodelled: [
    'every one of the listed effects — a sensory effect, lighting or snuffing a flame, cleaning or soiling an object, chilling or warming, a mark, a trinket — is the DM’s',
    'which of the six a casting made is the DM’s, so the cap of three counts castings rather than the non-instantaneous effects the sentence names',
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
  // **Handed over whole.** The whole spell is about an object, and objects are
  // not modelled: which door was touched, who may open it despite the lock and
  // what the password is have nowhere in state to live. `untilDispelled` above
  // is the engine's half and is executed — the casting is standing and
  // findable — and Dispel Magic cannot reach it because that command ends an
  // ongoing spell **on a target** and this casting is on a door, which is a
  // fact about the target vocabulary rather than a sentence of this spell.
  dmDecides: [
    'You touch a closed door, window, gate, container, or hatch and magically lock it for the duration.',
    "This lock can't be unlocked by any nonmagical means.",
    'You and any creatures you designate when you cast the spell can open and close the object despite the lock.',
    'You can also set a password that, when spoken within 5 feet of the object, unlocks it for 1 minute.',
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
  // The bearer, for Light's reason: the flame springs from an object in
  // somebody's hand, and the light it casts goes where the hand goes.
  targets: { count: 1, self: true },
  effects: [{ kind: 'light', level: 'bright', radius: 20, dimBeyond: 20 }],
  untilDispelled: true,
  unmodelled: [
    'the flame springs from an object, and objects are not modelled: the casting names the creature carrying it, and which object was touched is the DM’s. An object set down for good is a point the table lights with `declare_light`',
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
  // **Handed over whole.** The food and the water are objects, and objects are
  // not modelled; malnutrition, dehydration and the 24 hours after which the
  // food spoils have no reader either.
  dmDecides: [
    'You create 45 pounds of food and 30 gallons of fresh water on the ground or in containers within range—both useful in fending off the hazards of malnutrition and dehydration.',
    'The food is bland but nourishing and looks like a food of your choice, and the water is clean.',
    'The food spoils after 24 hours if uneaten.',
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
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
  // **Handed over whole.** The engine knows a creature's type and reports
  // nothing off it, and a creature nobody has typed has nothing to report;
  // whether Hallow is active, and the foot of stone or inch of metal that
  // blocks the sense, are facts about a world that is declared rather than
  // modelled.
  dmDecides: [
    'For the duration, you sense the location of any Aberration, Celestial, Elemental, Fey, Fiend, or Undead within 30 feet of yourself.',
    'You also sense whether the _Hallow_ spell is active there and, if so, where.',
    'The spell is blocked by 1 foot of stone, dirt, or wood; 1 inch of metal; or a thin sheet of lead.',
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
  // **Handed over whole.** Poisons, venomous creatures and magical contagions
  // are not modelled, so what the caster senses is narration and the blocking
  // rule is the same declared wall the other two Detects print.
  dmDecides: [
    'For the duration, you sense the location of poisons, poisonous or venomous creatures, and magical contagions within 30 feet of yourself.',
    'You sense the kind of poison, creature, or contagion in each case.',
    'The spell is blocked by 1 foot of stone, dirt, or wood; 1 inch of metal; or a thin sheet of lead.',
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
  // **Handed over whole.** Neither a mechanism nor a Glyph of Warding is a
  // thing in state, so whether one is in range and the general nature of the
  // danger are the DM's to answer.
  dmDecides: [
    'You sense any trap within range that is within line of sight.',
    'A trap, for the purpose of this spell, includes any object or mechanism that was created to cause damage or other danger.',
    "Thus, the spell would sense the _Alarm_ or _Glyph of Warding_ spell or a mechanical pit trap, but it wouldn't reveal a natural weakness in the floor, an unstable ceiling, or a hidden sinkhole.",
    'This spell reveals that a trap is present but not its location.',
    'You do learn the general nature of the danger posed by a trap you sense.',
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
  // **Handed over whole.** The disk is an object: where it is, the 500 pounds
  // it holds, what rides on it, the 20 feet it follows within, the elevation
  // change it refuses and the 100 feet that end the spell are all measured
  // against a thing that is not in the scene.
  dmDecides: [
    'This spell creates a circular, horizontal plane of force, 3 feet in diameter and 1 inch thick, that floats 3 feet above the ground in an unoccupied space of your choice that you can see within range.',
    'The disk remains for the duration and can hold up to 500 pounds.',
    'If more weight is placed on it, the spell ends, and everything on the disk falls to the ground.',
    'The disk is immobile while you are within 20 feet of it.',
    'If you move more than 20 feet away from it, the disk follows you so that it remains within 20 feet of you.',
    "It can move across uneven terrain, up or down stairs, slopes and the like, but it can't cross an elevation change of 10 feet or more.",
    "For example, the disk can't move across a 10-foot-deep pit, nor could it leave such a pit if it was created at the bottom.",
    "If you move more than 100 feet from the disk (typically because it can't move around an obstacle to follow you), the spell ends.",
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
 * duration this long is subtraction rather than a special case — which is
 * exactly what the third sentence needs: `preserves` marks the body, the
 * ongoing record pins the moment the marking began, and `revive` takes the
 * span back out of the time since `Vitals.diedAt`.
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
  // "You touch a corpse" — a dead creature, which is the only remains the
  // engine holds. "Or other remains" is the table's and is handed over below.
  targets: { count: 1, mustBeDead: true },
  // "days spent under the influence of this spell don't count against the time
  // limit of spells such as _Raise Dead_" — the whole of the third sentence,
  // and the one clause in the book where a casting changes another casting's
  // arithmetic.
  effects: [{ kind: 'preserves' }],
  durationSeconds: 864_000,
  // **Two sentences handed over and one that is executed**, which was P3-S6's
  // reading of this spell and is now its whole content. Decay and becoming
  // Undead are the DM's, and so is a heap of remains that is not a creature
  // the engine holds. The third sentence was the debt this definition named:
  // `revive.within` is subtraction over `Vitals.diedAt`, so a rule the engine
  // runs really does read the time limit this spell extends — and now the
  // `preserves` mark takes the repose's own running span back out of it.
  dmDecides: [
    'You touch a corpse or other remains.',
    "For the duration, the target is protected from decay and can't become Undead.",
  ],
  unmodelled: [
    'the days are taken back only while this casting is still running: `preservedSpan` reads the castings on the body **now**, so a repose that has ended — its ten days run out, a Dispel Magic, the caster dead — gives the window back and a corpse the book would still raise is refused. SRD says "days **spent** under the influence of this spell", which is a fact about days elapsed rather than about the casting standing, and nothing accumulates a span on a creature',
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
  // **Handed over whole.** Every sentence is about an object — a lock, a bar,
  // an Arcane Lock the engine has no lock for — and no object has a state here
  // to be opened. Read to the end: nothing in it reaches a creature.
  dmDecides: [
    'Choose an object that you can see within range.',
    'The object can be a door, a box, a chest, a set of manacles, a padlock, or another object that contains a mundane or magical means that prevents access.',
    'A target that is held shut by a mundane lock or that is stuck or barred becomes unlocked, unstuck, or unbarred.',
    'If the object has multiple locks, only one of them is unlocked.',
    'If the target is held shut by _Arcane Lock_, that spell is suppressed for 10 minutes, during which time the target can be opened and closed.',
    'When you cast the spell, a loud knock, audible up to 300 feet away, emanates from the target.',
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
  // **Handed over whole.** The engine holds one scene, and a creature five
  // miles off it is not a creature at a distance — there is nothing to measure
  // a direction to.
  dmDecides: [
    'Describe or name a specific kind of Beast, Plant creature, or nonmagical plant.',
    'You learn the direction and distance to the closest creature or plant of that kind within 5 miles, if any are present.',
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
  // **Handed over whole.** Objects have no position, so where the object is
  // and whether it is moving have nothing to read; the thickness of lead that
  // blocks it is the same declared wall the Detect spells print.
  dmDecides: [
    'Describe or name an object that is familiar to you.',
    "You sense the direction to the object's location if that object is within 1,000 feet of you.",
    'If the object is in motion, you know the direction of its movement.',
    'The spell can locate a specific object known to you if you have seen it up close—within 30 feet—at least once.',
    'Alternatively, the spell can locate the nearest object of a particular kind, such as a certain kind of apparel, jewelry, furniture, tool, or weapon.',
    "This spell can't locate an object if any thickness of lead blocks a direct path between you and the object.",
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
  name: 'Message',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 6,
  // **Handed over whole.** What is said and what is whispered back are the
  // DM's. So is the wall: SRD lets this one spell be cast through a solid
  // object at a familiar target, and the engine's Total Cover is a *declared*
  // fact rather than a modelled one — a table that does not declare the wall
  // casts through it, which is the same reading the three Detect spells' own
  // blocking rules get.
  dmDecides: [
    'You point toward a creature within range and whisper a message.',
    'The target (and only the target) hears the message and can reply in a whisper that only you can hear.',
    'You can cast this spell through solid objects if you are familiar with the target and know it is beyond the barrier.',
    'Magical silence; 1 foot of stone, metal, or wood; or a thin sheet of lead blocks the spell.',
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
  targets: { count: 1, self: true, willing: true },
  effects: [],
  durationSeconds: 28_800,
  // **Tracked, not handed over, and the reason is a correction.** This note
  // used to say the refusal had no reachable case because every Divination
  // spell the engine defines is cast at Self or at no creature. That was
  // wrong: SRD Mind Spike and SRD Hunter's Mark are Divinations aimed at one
  // creature, both executed and both inside level-5 reach, so a Nondetection
  // on a quarry is a casting a table reaches. What is missing is the state a
  // creature holds that refuses a school of casting, and its reader at the one
  // seam a casting checks its targets — `an-effect-that-suppresses-other-magic`
  // from the target's side, which `missing-shapes.ts` files.
  unmodelled: [
    'the refusal is not applied: "The target can’t be targeted by any Divination spell" would stop a Mind Spike or a Hunter’s Mark aimed at the target, and no state on a creature refuses a casting by its school',
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
 * > "At your touch, all curses affecting one creature or object end. If the
 * > object is a cursed magic item, its curse remains, but the spell breaks its
 * > owner's Attunement to the object so it can be removed or discarded."
 *
 * **The second sentence was filed as fiction on a claim that is false against
 * the engine**, and it is built now. `unmodelled` said Attunement is not
 * modelled; `CreatureState.attuned` holds it, `attuneItem` writes it, and
 * `attuned` and `attunement-ended` are both events the fold applies. That is a
 * table fact a rule then reads, which `docs/design/content.md` calls a debt —
 * and `what-ends-attunement-besides-a-command` is the shape it was owed to,
 * whose own description finishes on armour that cannot be doffed until a
 * Remove Curse lands.
 *
 * So the `end-attunement` effect is the half the engine owns. **Which object**
 * is the caster's, stated at the casting through `CastSpellRequest.object`,
 * because a creature attuned to three items has three answers and the engine
 * picks none of them; an item the target is not attuned to is refused before a
 * slot is spent. What the spell deliberately does *not* do is take the thing
 * off its owner: SRD says it "can be removed or discarded", which is a
 * permission and two commands somebody may take afterwards.
 *
 * The first sentence is fiction and stays so: nothing the engine applies is a
 * curse — Bestow Curse is tracked and applies nothing — so there is no curse
 * for the touch to end.
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
  effects: [{ kind: 'end-attunement' }],
  unmodelled: [
    'a curse is not a thing in state — nothing the engine applies is one — so which curses end is the DM’s, and whether the object the Attunement is broken to was a cursed one is the same decision',
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
  // The rope: a point the casting keeps, stated at the cast within the touch
  // the Range prints, and the five feet the way in reaches from it. The same
  // field Spiritual Weapon's force stands on, for the same reason — the
  // casting has a place of its own that later commands are measured from.
  origin: { reach: 5 },
  // "Up to eight Medium or smaller creatures can climb into the
  // extradimensional space by moving up the rope … Anything inside the space
  // drops out when the spell ends." A place with a door: `enterElsewhere` is
  // the climb, each creature's own command within five feet of the rope; the
  // way back is pinned at the climb as five feet from where the creature
  // climbed in, and the casting's ending leaves everybody inside stranded
  // until `returnFromElsewhere` names where each drops out.
  effects: [
    {
      kind: 'elsewhere',
      where: 'extradimensional',
      entry: { within: 5, holds: 8, maxSize: 'medium' },
      returns: { within: 5 },
    },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'the rope hovering upward until it hangs perpendicular or meets a ceiling, the 3-foot-by-5-foot portal at its upper end, and the rope being pulled into or dropped out of the space are the table’s: the engine holds the space as a place creatures are, not a thing on the lattice',
    'what those inside make out through the portal is the table’s: a creature elsewhere is measured by nothing and declares nothing about anybody in the scene',
    'what the climb costs the climber is the table’s: the rope is nothing the lattice holds, so the engine charges nothing for going up it',
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
  // **Handed over whole**, and the sense vocabulary is why rather than the
  // reason it is not. A `StandingGrant` can confer a sense and `canSomehowSee`
  // reads one — Truesight and Blindsight are exactly the two that negate the
  // Invisible condition's benefit — but no **spell effect** kind hangs a
  // standing grant, and this spell grants neither of those senses: it grants
  // sight of one condition, which `sightBetween` answers off the table's
  // pairwise declaration before it consults any sense at all. So what the
  // spell buys is a `sight-declared` the DM makes, and the condition's own
  // readers already read it.
  dmDecides: [
    'For the duration, you see creatures and objects that have the Invisible condition as if they were visible, and you can see into the Ethereal Plane.',
    'Creatures and objects there appear ghostly.',
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
  // **Handed over whole.** The corpse is an object rather than a creature in
  // state, so the mouth it must have, the Undead it must not have been and the
  // 10 days since the last casting have nothing to read; the five answers and
  // their truthfulness are the DM's.
  dmDecides: [
    'You grant the semblance of life to a corpse of your choice within range, allowing it to answer questions you pose.',
    'The corpse must have a mouth, and this spell fails if the deceased creature was Undead when it died.',
    'The spell also fails if the corpse was the target of this spell within the past 10 days.',
    'Until the spell ends, you can ask the corpse up to five questions.',
    'The corpse knows only what it knew in life, including the languages it knew.',
    'Answers are usually brief, cryptic, or repetitive, and the corpse is under no compulsion to offer a truthful answer if you are antagonistic toward it or it recognizes you as an enemy.',
    "This spell doesn't return the creature's soul to its body, only its animating spirit.",
    "Thus, the corpse can't learn new information, doesn't comprehend anything that has happened since it died, and can't speculate about future events.",
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
 * **The halved Speed is `areaStanding` and not a third trigger**, because the
 * SRD writes it in a different grammar: "Any other creature's Speed is halved
 * in the Emanation" names no moment, asks for no save and fires nothing. It
 * holds while a creature is in the volume and lifts when it walks out, so the
 * engine derives it from the scene on every read — see `AreaStanding` — and
 * grants nobody anything that would have to be taken back.
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
  // "Any other creature's Speed is halved in the Emanation." Not a trigger:
  // nothing fires, nothing is rolled, and there is no moment — which creatures
  // it reaches is a fact about where they are standing, so the engine derives
  // it on every read and stores it on nobody. The designated-unaffected list is
  // filtered once, where the area is read, so it reaches this sentence and the
  // saving throw below alike.
  areaStanding: [{ kind: 'speed', change: 'halve' }],
  unmodelled: [
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
  // **Handed over whole**, on Comprehend Languages' reading: the sheet records
  // the languages a character knows and nothing in play reads them, so
  // understanding and being understood have no reader.
  dmDecides: [
    'This spell grants the creature you touch the ability to understand any spoken or signed language that it hears or sees.',
    'Moreover, when the target communicates by speaking or signing, any creature that knows at least one language can understand it if that creature can hear the speech or see the signing.',
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
  targets: { count: 10, self: true, willing: true },
  effects: [],
  durationSeconds: 3600,
  // **Handed over whole.** Nothing in state says there is water, acid, mud or
  // lava under the party, so what the surface is and what the heat of lava
  // does are the DM's — and the Bonus Action a target spends to drop through
  // it is charged by the DM for the same reason: there is no liquid for a
  // spender to be charged against.
  dmDecides: [
    'This spell grants the ability to move across any liquid surface—such as water, acid, mud, snow, quicksand, or lava—as if it were harmless solid ground (creatures crossing molten lava can still take damage from the heat).',
    'Up to ten willing creatures of your choice within range gain this ability for the duration.',
    "An affected target must take a Bonus Action to pass from the liquid's surface into the liquid itself and vice versa, but if the target falls into the liquid, the target passes through the surface into the liquid below.",
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
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
  // **Handed over whole**, minus the one sentence the engine rolls: the Study
  // action's Intelligence (Investigation) check against the spell save DC is
  // `check` above, so it is neither a gap nor a handover and appears in
  // neither list.
  dmDecides: [
    'You create a sound or an image of an object within range that lasts for the duration.',
    'See the descriptions below for the effects of each.',
    'If a creature discerns the illusion for what it is, the illusion becomes faint to the creature.',
    '_Sound._ If you create a sound, its volume can range from a whisper to a scream.',
    "It can be your voice, someone else's voice, a lion's roar, a beating of drums, or any other sound you choose.",
    'The sound continues unabated throughout the duration, or you can make discrete sounds at different times before the spell ends.',
    '_Image._ If you create an image of an object—such as a chair, muddy footprints, or a small chest—it must be no larger than a 5-foot Cube.',
    "The image can't create sound, light, smell, or any other sensory effect.",
    'Physical interaction with the image reveals it to be an illusion, since things can pass through it.',
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
  // **Handed over whole**, minus the check `check` above rolls. The Magic
  // action that moves the image is here rather than in a gap list: what it
  // moves is the position of a thing that stands in no square, so there is
  // nothing for a later turn to act *on* — a spender would have somewhere to
  // put its cost and nothing to spend it against.
  dmDecides: [
    'You create the image of an object, a creature, or some other visible phenomenon that is no larger than a 15-foot Cube.',
    "The image is purely visual; it isn't accompanied by sound, smell, or other sensory effects.",
    'As a Magic action, you can cause the image to move to any spot within range.',
    'As the image changes location, you can alter its appearance so that its movements appear natural for the image.',
    'For example, if you create an image of a creature and move it, you can alter the image so that it appears to be walking.',
    'Physical interaction with the image reveals it to be an illusion, since things can pass through it.',
    'If a creature discerns the illusion for what it is, the creature can see through the image.',
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
      // "against one creature **within reach**", which the Range of Self says
      // nothing about: the Range is what the spell is *on* and the five feet
      // are the arm's. Every later swing checks the activation's own `range`;
      // this is the same distance on the swing the casting makes.
      reach: 5,
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
  // SRD: "You evoke a fiery blade in your **free hand** ... If you let go of
  // the blade, it disappears, but you can evoke the blade again as a Bonus
  // Action." The hand, the letting go and the taking up again are all one
  // fact — a conjured thing the casting holds — and `dropConjured` and
  // `evokeConjured` are the two halves of the sentence.
  conjures: { item: 'flame-blade', count: 1, hands: 1, retake: 'bonus-action' },
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
 * **And the second sentence is the exception, which is now written too.**
 * `unlessPerceivedWith` names the two senses the book names, and the engine
 * reads them off the *attacker* at the moment of the swing — the sense clause
 * on the attacker's side, which nothing could ask before. It is not the sight
 * question and must not become it: a declared sight line excuses nobody,
 * because ordinary sight is exactly what a blurred shape defeats.
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
        selector: {
          roll: 'attack',
          relation: 'against-holder',
          unlessPerceivedWith: ['blindsight', 'truesight'],
        },
      },
    },
  ],
  durationSeconds: 60,
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
    // "and regains the maximum number of Hit Points possible from any
    // healing." A third effect for the third clause, and it is a *rule* rather
    // than an amount: nothing is restored here, and what it reaches is
    // whatever heals the target next — which may be a different caster, an
    // hour later, out of a potion.
    { kind: 'healing-rule', rule: 'maximised' },
  ],
  durationSeconds: 60,
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
 * **"One" is the other half, and it is the caster's.** The definition prints
 * all four, `choiceStated` says they are a choice, and the casting names the
 * single condition this touch ends — so a creature that is Blinded and
 * Poisoned keeps whichever of the two the caster did not name. The list below
 * is what the spell *offers*; the substitution collapses it to the one chosen,
 * which is the difference between offering four and ending four.
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
  // "end **one** condition on it: Blinded, Deafened, Paralyzed, or Poisoned".
  // The same four, printed twice for two different jobs: the effect says what
  // the spell can reach, and this says the caster picks one of them.
  choiceStated: {
    of: 'condition',
    options: ['blinded', 'deafened', 'paralyzed', 'poisoned'],
  },
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
 * All three sentences execute. A list of one is what a spell that names its
 * own condition looks like — nothing is chosen, so nothing is missing there —
 * and the hour it then runs makes the casting an ongoing record where an
 * Instantaneous removal leaves none at all.
 *
 * **The middle sentence was the one with a name**, and the name was a missing
 * axis: a mode was selected by roll family, ability and skill, so the nearest
 * sayable thing was Advantage on every Constitution saving throw the target
 * ever made — which would have helped against a Disintegrate. `condition` on
 * the selector is the narrowing, the same one the three species traits that
 * write this sentence now carry, and "avoid **or end**" needs no second
 * effect: one grant reaches the save a poison forces and the save a turn
 * boundary repeats against a poison already standing.
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
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'advantage',
        selector: { roll: 'saving-throw', relation: 'roller', condition: 'poisoned' },
      },
    },
    { kind: 'damage-defense', damageTypes: ['poison'], defense: 'resistant' },
  ],
  durationSeconds: 3600,
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
  unmodelled: [
    'the "willing creature" clause is not transcribed here: `TargetRule.willing` is the field that gates a casting on consent, and it has been written onto the levels the ledger counts and not yet onto this one',
  ],
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
  targets: { count: 1, self: true, willing: true },
  damageTypeStated: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
  effects: [{ kind: 'damage-defense', damageTypes: ['acid'], defense: 'resistant' }],
  durationSeconds: 3600,
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
    'the "willing creature" clause is not transcribed here: `TargetRule.willing` is the field that gates a casting on consent, and it has been written onto the levels the ledger counts and not yet onto this one',
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
  effects: [
    { kind: 'attack-rider', dice: '1d6', damageType: 'force', marksTarget: true },
    // "You also have Advantage on any Wisdom (Perception or Survival) check you
    // make **to find it**." Two grants, because a selector names one skill and
    // the book names two; both hang on the **caster** — the spell is cast at the
    // quarry and the check is the ranger's — and both are narrowed by what the
    // check is *for*, so a ranger listening at a door rolls an ordinary
    // Perception check.
    {
      kind: 'roll-mode',
      onCaster: true,
      modifier: {
        mode: 'advantage',
        selector: {
          roll: 'ability-check',
          relation: 'roller',
          ability: 'wis',
          skill: 'perception',
          purpose: 'find-marked',
        },
      },
    },
    {
      kind: 'roll-mode',
      onCaster: true,
      modifier: {
        mode: 'advantage',
        selector: {
          roll: 'ability-check',
          relation: 'roller',
          ability: 'wis',
          skill: 'survival',
          purpose: 'find-marked',
        },
      },
    },
  ],
  // "Concentration, up to 1 hour" — the cap a level 1 or 2 slot buys.
  durationSeconds: 3600,
  // "level 3–4 (up to 8 hours) or 5+ (up to 24 hours)": 8 × 3600 and 24 × 3600.
  // Two keys, because the SRD prints two bands; a level 4 slot falls in the
  // first because 5 has not been reached.
  durationAtSlot: { 3: 28800, 5: 86400 },
  // "If the target drops to 0 Hit Points before this spell ends, you can take
  // a Bonus Action to move the mark to a new creature **you can see within
  // range**." The range is the spell's own ninety feet, printed again on the
  // Bonus Action; the sight is `requiresSight` above. What moves is the rider
  // this casting granted, which is what {@link SpellActivation.reAims} names.
  activation: {
    action: 'bonus-action',
    range: { kind: 'ranged', feet: 90 },
    reAims: true,
    label: "Hunter's Mark (a new quarry)",
    effects: [],
  },
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
  // **Handed over whole**, and the `AreaTrigger` that looks like its home is
  // the reason rather than an oversight: that vocabulary is *what a place does
  // to whoever stands in it*, and every one of its clauses resolves effects
  // against the creature entering. This alarm does nothing to the intruder at
  // all — it tells the caster — so there is no outcome for a trigger to
  // produce, and the Cube the ward fills is a ceiling the caster picks rather
  // than a `SpellArea`'s one fixed size. Nothing reads any of it afterwards.
  dmDecides: [
    'You set an alarm against intrusion.',
    'Choose a door, a window, or an area within range that is no larger than a 20-foot Cube.',
    'Until the spell ends, an alarm alerts you whenever a creature touches or enters the warded area.',
    "When you cast the spell, you can designate creatures that won't set off the alarm.",
    'You also choose whether the alarm is audible or mental:',
    '**Audible Alarm.** The alarm produces the sound of a handbell for 10 seconds within 60 feet of the warded area.',
    '**Mental Alarm.** You are alerted by a mental ping if you are within 1 mile of the warded area.',
    "This ping awakens you if you're asleep.",
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
  // **Handed over whole.** Nothing is measured from the sensor and nothing is
  // resolved at it: what it buys is that the caster perceives a place, and
  // sight here is a declared pairwise fact between two creatures rather than a
  // derived one. The Bonus Action that switches seeing for hearing is the cost
  // of operating a thing the engine does not hold.
  dmDecides: [
    'You create an Invisible sensor within range in a location familiar to you (a place you have visited or seen before) or in an obvious location that is unfamiliar to you (such as behind a door, around a corner, or in a grove of trees).',
    'The intangible, invulnerable sensor remains in place for the duration.',
    'When you cast the spell, choose seeing or hearing.',
    'You can use the chosen sense through the sensor as if you were in its space.',
    'As a Bonus Action, you can switch between seeing and hearing.',
    'A creature that sees the sensor (such as a creature benefiting from _See Invisibility_ or Truesight) sees a luminous orb about the size of your fist.',
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
  //
  // **What the spirits say is handed over and the radius is not**, which is the
  // line the sweep drew twice over on this spell. The facts are descriptions of
  // a world the engine does not hold and never will; the 3 miles, the 300 feet
  // and "where nature has been replaced by construction" wait on a fact only
  // the table can declare, which is a shape with a name and other claimants.
  dmDecides: [
    'You commune with nature spirits and gain knowledge of the surrounding area.',
    "Choose three of the following facts; you learn those facts as they pertain to the spell's area:",
    '• Locations of settlements',
    '• Locations of portals to other planes of existence',
    "• Location of one Challenge Rating 10+ creature (GM's choice) that is a Celestial, an Elemental, a Fey, a Fiend, or an Undead",
    '• The most prevalent kind of plant, mineral, or Beast (you choose which to learn)',
    '• Locations of bodies of water',
  ],
  unmodelled: [
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
  // **Handed over whole.** What is learned about an object is a fact about a
  // magic item; what is learned about a creature the engine already answers as
  // a query. No effect kind reports knowledge, and the one grant in the
  // vocabulary that does — `FeatureGrant`'s `knowledge`, SRD Hunter's Lore —
  // is a *feature's* standing fact about a creature its own casting marked,
  // which no spell effect can hang and which reveals a damage table rather
  // than an item's record. Knowing something changes no authoritative state.
  dmDecides: [
    "You touch an object throughout the spell's casting.",
    'If the object is a magic item or some other magical object, you learn its properties and how to use them, whether it requires Attunement, and how many charges it has, if any.',
    'You learn whether any ongoing spells are affecting the item and what they are.',
    "If the item was created by a spell, you learn that spell's name.",
    'If you instead touch a creature throughout the casting, you learn which ongoing spells, if any, are currently affecting it.',
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
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
  // **Handed over whole.** What the text says, what the illusion makes it say
  // and the altered meaning, handwriting and language are fiction, and so is
  // the parchment; what being designated buys is the ability to read, and
  // reading is the DM's. The Truesight sentence is *not*
  // `senses-beyond-declared-sight`, which is Mirage Arcane's sentence: there
  // the sense excuses its holder from Difficult Terrain the engine would
  // otherwise lay, and here it excuses them from a message nothing reads.
  dmDecides: [
    'You write on parchment, paper, or another suitable material and imbue it with an illusion that lasts for the duration.',
    'To you and any creatures you designate when you cast the spell, the writing appears normal, seems to be written in your hand, and conveys whatever meaning you intended when you wrote the text.',
    'To all others, the writing appears as if it were written in an unknown or magical script that is unintelligible.',
    'Alternatively, the illusion can alter the meaning, handwriting, and language of the text, though the language must be one you know.',
    'If the spell is dispelled, the original script and the illusion both disappear.',
    'A creature that has Truesight can read the hidden message.',
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
  //
  // **The whole of what this spell says is handed over, and nothing is left in
  // `unmodelled`** — the only definition in the catalogue where that is true,
  // and it is true because the book says the GM twice in six sentences and says
  // nothing mechanical at all. The ten minutes, the slot and the clock are the
  // engine's and it runs them; the lore is not a debt and never becomes one.
  dmDecides: [
    'Name or describe a famous person, place, or object.',
    'The spell brings to your mind a brief summary of the significant lore about that famous thing, as described by the GM.',
    'The lore might consist of important details, amusing revelations, or even secret lore that has never been widely known.',
    'The more information you already know about the thing, the more precise and detailed the information you receive is.',
    'That information is accurate but might be couched in figurative language or poetry, as determined by the GM.',
    "If the famous thing you chose isn't actually famous, you hear sad musical notes played on a trombone, and the spell fails.",
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
  // "When you cast this spell, you can have the spell end after it delivers
  // its message, or it can remain and repeat its message whenever the trigger
  // occurs." The free dismissal is printed for a **time span** and this spell
  // has none, so without the caster's word at the casting there is no way out
  // of it at all. What fires it is the table's — the engine holds no mouth and
  // no message — so what the fact buys is the permission, and the DM spends it
  // when the mouth has spoken.
  offersEndAfterTrigger: true,
  // **Eight sentences handed over and one that is executed.** The object, the
  // message, the mouth and the circumstance somebody watches for are fiction —
  // "condition" here means circumstance rather than any of the fifteen the
  // engine applies, which is what the tracked map's `'table'` reading of the
  // opening sentence says. What was left is the caster's choice at the
  // casting, and it is written now: `offersEndAfterTrigger` is the printed
  // offer, `CastSpellRequest.endsAfterTrigger` is the answer, and the record
  // keeps it so `endOngoingSpell` stops refusing a casting whose caster said
  // it could end.
  dmDecides: [
    'You implant a message within an object in range—a message that is uttered when a trigger condition is met.',
    "Choose an object that you can see and that isn't being worn or carried by another creature.",
    'Then speak the message, which must be 25 words or fewer, though it can be delivered over as long as 10 minutes.',
    'Finally, determine the circumstance that will trigger the spell to deliver your message.',
    'When that trigger occurs, a magical mouth appears on the object and recites the message in your voice and at the same volume you spoke.',
    "If the object you chose has a mouth or something that looks like a mouth (for example, the mouth of a statue), the magical mouth appears there, so the words appear to come from the object's mouth.",
    'The trigger can be as general or as detailed as you like, though it must be based on visual or audible conditions that occur within 30 feet of the object.',
    'For example, you could instruct the mouth to speak when any creature moves within 30 feet of the object or when a silver bell rings within 30 feet of it.',
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
  // **Handed over whole.** Which break was mended and the foot it may not
  // exceed are facts about an object's *condition*, and the engine tracks what
  // a creature owns and wears and nothing about the state of it; the ban on
  // restoring magic forbids undoing something it never did.
  dmDecides: [
    'This spell repairs a single break or tear in an object you touch, such as a broken chain link, two halves of a broken key, a torn cloak, or a leaking wineskin.',
    'As long as the break or tear is no larger than 1 foot in any dimension, you mend it, leaving no trace of the former damage.',
    "This spell can physically repair a magic item, but it can't restore magic to such an object.",
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
 * **All four benefits in that run are things the engine owns now**, and they
 * are written: the +2 is Shield of Faith's sentence word for word, the
 * Advantage is a `roll-mode` narrowed to saving throws and to one ability,
 * which Beacon of Hope already writes twice in one definition, the extra
 * action is `ActionRule`'s fourth member — the one that creates rather than
 * governs — minted into the budget at the start of each of the target's turns
 * and never taken by anybody but the table, and the doubled Speed is
 * `SpeedChange`'s third operation, which arrived with the rule that settles
 * how it meets a halving: doubled first and halved second, so SRD Slow over
 * this brings the target back to the Speed it walked at.
 *
 * **And the sentence after the extra action is written too.** "That action can
 * be used to take only the Attack ... Dash, Disengage, Hide, or Utilize
 * action" is `only` on the granted action, failing closed: a spend that does
 * not name itself as one of the five is refused, which is the polarity SRD
 * Expeditious Retreat already writes and the opposite of Action Surge's
 * `except`. All five are in `NAMED_ACTIONS` and all five have a spender.
 *
 * What is left is the parenthesis and the lethargy. "One attack only" counts
 * the attacks *inside* one Attack action, and the economy counts the action
 * rather than the swings in it. The lethargy fires when the casting ends, on
 * the target, under the spell's own bare name so that it outlives the casting
 * that caused it.
 */
export const HASTE: SpellDefinition = {
  id: 'haste',
  name: 'Haste',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  // "Choose a **willing** creature that you can see within range", which
  // includes you — Fly, Jump and Mage Armor are all transcribed the same way,
  // and the consent is the field below rather than the table's to remember.
  targets: { count: 1, self: true, willing: true },
  requiresSight: true,
  effects: [
    // "the target's Speed is doubled" — the one sentence in the book that
    // multiplies a Speed, and the order it composes in is `combineSpeed`'s.
    { kind: 'speed', change: 'double' },
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
    // "it gains an additional action on each of its turns" — the rule stands on
    // the target and the turn boundary mints one every turn the casting sees —
    // and "That action can be used to take only the Attack ..., Dash,
    // Disengage, Hide, or Utilize action" is the `only` list, failing closed.
    {
      kind: 'action-rule',
      rule: {
        kind: 'grants',
        at: 'each-turn',
        only: ['attack', 'dash', 'disengage', 'hide', 'utilize'],
      },
    },
  ],
  durationSeconds: 60,
  // "When the spell ends, the target is Incapacitated and has a Speed of 0
  // until the end of its next turn, as a wave of lethargy washes over it." One
  // rider, two things, one span — laid by whichever of the four endings
  // arrives, under the spell's bare name so the release that lays it does not
  // lift it in the same breath.
  onEnd: [{ conditions: ['incapacitated'], speed: 'zero', lasts: 'end-of-next-turn' }],
  unmodelled: [
    '"(one attack only)" is not enforced: the parenthesis counts the attacks inside one Attack action, and the economy counts one Attack action and not the swings in it',
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
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true, willing: true },
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
    // "While in this form, the target's **only** method of movement is a Fly
    // Speed of 10 feet, and it can hover." One operation rather than a Speed
    // granted beside four taken away: `speedOf` answers 0 for every other
    // mode, so a Longstrider standing on the same creature does not put ten
    // feet of walking back into a body that has no legs. The hovering is what
    // `flightLost` reads, so a cloud that stops does not fall.
    { kind: 'speed', change: 'only', mode: 'fly', feet: 10, hover: true },
    // "The target can't talk or **manipulate objects**, and any objects it was
    // carrying or holding can't be dropped, used, or otherwise interacted
    // with." / "Finally, the target can't attack or cast spells." Three of the
    // four in one rule: the Attack action is one of the twelve a spender names
    // itself as, a casting is the third thing a `forbids` may take — read by
    // `castSpell`, because a casting comes out of three different slots and no
    // one of them names it — and handling is the fourth, read by every command
    // that puts a hand on a thing. Talking is the one the engine has no spender
    // for and never will.
    {
      kind: 'action-rule',
      rule: { kind: 'forbids', actions: ['attack'], casting: true, objects: true },
    },
  ],
  durationSeconds: 3600,
  // "or if it takes a Magic action to end the spell on itself" — both
  // exceptions to the free dismissal in one clause: the **target** ends it,
  // and the book charges an action. `endOngoingSpellOnSelf` is the door, and
  // it ends the casting on that target alone, exactly as the trigger below
  // does for the same sentence's other half.
  dismissibleBy: 'target',
  // "The spell ends on the target if it drops to 0 Hit Points" — on that
  // target, which is the half of the sentence a higher slot makes visible:
  // level 4 puts two creatures in mist and one of them falling leaves the
  // other one a cloud.
  endsEarly: [{ on: 'target-drops-to-0', ends: 'target' }],
  unmodelled: [
    'the cloud itself is the DM’s: what the target looks like, that it "can pass through narrow openings", and that "it treats liquids as though they were solid surfaces" are fiction, and the gear coming along changes nothing the engine holds',
    '"The target can enter and occupy the space of another creature" is not applied: occupancy is a rule the engine owns outright, and nothing lets an effect tell that rule to believe something different about one creature',
    'one of the four things the cloud cannot do is not forbidden: "The target can’t talk". Three are taken away — the Attack action, the casting, and every hand a command puts on a thing, which is "manipulate objects" and the objects that "can’t be dropped, used, or otherwise interacted with" — and talking is not an action anything spends. It is not a handover either, because the SRD prints it inside the same sentence as the object clauses the engine now enforces, and handing that sentence over would ask the table to adjudicate three quarters of a rule',
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
 * > "When the spell ends, the target floats gently to the ground if it is
 * > still aloft."
 *
 * **A save that gates a movement, which is a rider rather than a resolver of
 * its own.** The whole of what the Constitution save decides is whether the
 * creature goes up, so the lift hangs off the settled outcome exactly as
 * Thunderwave's shove does — and, being a rider, it gets Heightened Spell's
 * Disadvantage and Careful Spell's sparing for nothing, which a movement with
 * a saving throw inside it could not have.
 *
 * **The lift is the one rider the casting keeps**, because the sentence says
 * so twice: "remains suspended there for the duration", and the landing when
 * the spell ends. `GrantedLift` is the hold and `releaseCasting` is the
 * landing, so a dispel, a broken Concentration and the ten minutes running out
 * all set the target down the same way and none of them is a fall.
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
  effects: [
    {
      kind: 'save',
      ability: 'con',
      // "An **unwilling** creature that succeeds on a Constitution saving
      // throw is unaffected." The save is offered to the creature that objects
      // and to nobody else, so a target the casting named as willing — and the
      // caster, who consents by casting — is lifted with no roll at all.
      unlessWilling: true,
      // "rises vertically up to 20 feet and remains suspended there for the
      // duration." The save is the gate and the lift is the whole of what it
      // gates: a creature that fails goes up, and a creature that makes it is
      // "unaffected" in as many words.
      movement: { kind: 'lift', feet: 20 },
    },
  ],
  // "Otherwise, you can take a Magic action to move the target, which must
  // remain within the spell's range." The cap is the spell's and the distance
  // and the direction are the caster's, stated on the turn they take the
  // action — which is why `change-altitude` reads them off the request and
  // prints only the twenty feet.
  activation: {
    action: 'action',
    label: 'Levitate (the target’s altitude)',
    // "within the spell's range", checked from the caster before the action is
    // taken and again against the space the rise lands in: sixty feet up is
    // sixty feet away on a lattice that measures the climb.
    range: { kind: 'ranged', feet: 60 },
    effects: [{ kind: 'change-altitude', upTo: 20 }],
  },
  durationSeconds: 600,
  unmodelled: [
    'what the levitating creature may do with its own Speed is the DM’s, and it is a gap this spell opens: "The target can move only by pushing or pulling against a fixed object or surface within reach" is the whole of SRD’s answer, and the engine refuses only a **rise** — a creature holding station twenty feet up may still walk its thirty feet sideways through the air and come down for nothing, because gravity is not a Speed and no rule asks what is under a creature that is already off the ground. The **half of the altitude sentence a creature spends on its own movement** is the same absence: "If you are the target, you can move up or down as part of your move" would have to count the feet this creature has already risen under the lift **this turn**, and a `GrantedLift` holds only whose magic it is — so `checkRise` goes on refusing a rise nothing else granted rather than allowing one it could not cap. The Magic action that moves somebody else is built; the climbing along a wall is fiction',
    'the object the spell may target instead, and its 500-pound limit, are the DM’s: objects are not modelled',
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
 * **Three rays, three attack rolls.** `rolls` on the `attack` effect is what
 * "Make a ranged spell attack for each ray" needed and what this spell was
 * tracked without: a definition that rolled one ray would be a Scorching Ray
 * dealing a third of its damage, and one that rolled 6d6 in a single attack
 * would be a Scorching Ray that hits or misses as a whole. Each ray hits, misses
 * and crits on its own.
 *
 * The two counts say two different things and happen to agree: `targets` is
 * how many creatures may be named — "at one target within range or at several",
 * one more per slot level — and `rolls` is how many rays are hurled at them.
 *
 * **And how they are divided is the caster's, all of it.** "At one target
 * within range or at several" leaves the middle open, so four rays at two
 * creatures may go three and one as readily as two and two — stated on the
 * casting (`rollsAt`), dealt evenly when nothing is said. That middle was this
 * spell's last `unmodelled` line.
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
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '2d6' },
      damageType: 'fire',
      // "You create one additional ray for each spell slot level above 2."
      rolls: { count: 3, extraPerSlotLevelAbove: 1 },
    },
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
 * > _Level 2 Transmutation (Bard, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "For the duration, the spell enlarges or reduces a creature or an object
 * > you can see within range (see the chosen effect below)."
 *
 * **It was the spell in its batch blocked by the choice rather than by the
 * effect, and the choice is built.** That paragraph read: the two branches say
 * opposite things, so a definition would have to record which the caster
 * picked, and a choice made at the casting had nowhere to be recorded.
 * `SpellDefinition.options` is where it is recorded — the word is the tenth
 * stated fact, `OngoingSpell.option` pins it, and this definition has two
 * branches to hang the clauses on.
 *
 * **And every clause inside them is built now, each on the shape it waited
 * for.** The Advantage or Disadvantage on Strength checks and Strength saving
 * throws is two `mode` riders — SRD names an ability check **and** a saving
 * throw in one breath, and a `RollSelector` says one family, so the sentence
 * is written twice and the pair is the book's. The size change is a `size`
 * rider: a *step* hung as a sourced grant, the twin of the creature-type Mask,
 * read by `effectiveSizeOf` over whatever size the creature otherwise has and
 * given back through every door that ends a grant. The extra 1d4 is a
 * `later-blow` rider with no type of its own — the weapon's, as SRD Magic
 * Weapon's plus is — reaching weapons and Unarmed Strikes and never a spell;
 * and the −1d4 is the `damage-penalty` rider Ray of Enfeeblement writes, with
 * the floor of 1 the parenthesis prints.
 *
 * **The Constitution save is rolled, and only for a creature that objects.**
 * "If the target is an unwilling creature, it can make a Constitution saving
 * throw" is `unlessWilling`, read for the first time inside a branch: one
 * consent clause over two branches that each carry the save it gates, because
 * a save in the common list would be one roll no branch could read.
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
  // **Empty, and the save is in each branch.** "If the target is an unwilling
  // creature, it can make a Constitution saving throw. On a successful save,
  // the spell has no effect" is one roll per casting whichever half was
  // chosen, and a save in the common list would be a roll whose outcome the
  // branch could not read — the rule `SpellDefinition.options` states.
  effects: [],
  options: {
    enlarge: {
      label: 'Enlarge',
      effects: [
        {
          kind: 'save',
          ability: 'con',
          // "If the target is an unwilling creature": the save is offered to
          // the creature that objects and to nobody else.
          unlessWilling: true,
          modifiers: [
            // "The target's size increases by one category".
            { kind: 'size', steps: 1 },
            // "Advantage on Strength checks and Strength saving throws": two
            // rolls named in one clause, so two selectors.
            {
              kind: 'mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
              },
            },
            {
              kind: 'mode',
              modifier: {
                mode: 'advantage',
                selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' },
              },
            },
            // "attacks with its enlarged weapons or Unarmed Strikes deal an
            // extra 1d4 damage on a hit": no type, so the weapon's own, and
            // never a spell's.
            { kind: 'later-blow', dice: '1d4', weaponOrUnarmedOnly: true, by: 'target' },
          ],
        },
      ],
    },
    reduce: {
      label: 'Reduce',
      effects: [
        {
          kind: 'save',
          ability: 'con',
          unlessWilling: true,
          modifiers: [
            // "The target's size decreases by one category".
            { kind: 'size', steps: -1 },
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
              },
            },
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' },
              },
            },
            // "deal 1d4 less damage on a hit (this can't reduce the damage
            // below 1)".
            { kind: 'damage-penalty', dice: '1d4', floor: 1 },
          ],
        },
      ],
    },
  },
  durationSeconds: 60,
  // The gear and the thrown weapon are fiction the engine holds nothing of,
  // handed over in the book's words.
  dmDecides: [
    'Everything that a targeted creature is wearing and carrying changes size with it.',
    'Any item it drops returns to normal size at once.',
    'A thrown weapon or piece of ammunition returns to normal size immediately after it hits or misses a target.',
  ],
};

/**
 * SRD Entangle:
 *
 * > _Level 1 Conjuration (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "Grasping plants sprout from the ground in a 20-foot square within range.
 * > For the duration, these plants turn the ground in the area into Difficult
 * > Terrain. They disappear when the spell ends."
 * > "Each creature (other than you) in the area when you cast the spell must
 * > succeed on a Strength saving throw or have the Restrained condition until
 * > the spell ends. A Restrained creature can take an action to make a
 * > Strength (Athletics) check against your spell save DC. On a success, it
 * > frees itself from the grasping plants and is no longer Restrained by
 * > them."
 *
 * **The spell `notTheCaster` was named for**, and the reason it had no
 * definition until that field existed: every other sentence here is one this
 * catalogue already writes — a Cube on a point, a Strength save, a Restrained
 * condition ended by the casting, Black Tentacles' Athletics escape word for
 * word, and the glossary's rate on the ground. Written without the
 * parenthesis it would Restrain the druid who cast it, which is a confident
 * wrong answer rather than a missing one.
 *
 * **A 20-foot Cube, because the templates have no square.** `SpellArea` holds
 * the SRD's six shapes and a square is not among them; a 20-foot Cube laid on
 * the ground covers exactly the footprint the spell prints, and the height it
 * has beyond that catches nobody a square would have missed — every creature
 * standing on that ground is in both.
 *
 * **The Difficult Terrain is `areaTerrain` and not a gap.** The casting pins
 * the square it resolved, the ground charges the glossary's two feet per foot
 * while the Concentration holds, and "they disappear when the spell ends" is
 * the patch lapsing with its casting — all of which Grease, Web and Spike
 * Growth already do.
 */
export const ENTANGLE: SpellDefinition = {
  id: 'entangle',
  name: 'Entangle',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  // "Each creature (other than you) in the area": no count, because the area
  // names who it catches, and the one clause that narrows it.
  targets: { count: 0, notTheCaster: true },
  area: { kind: 'cube', size: 20, origin: 'point' },
  // "these plants turn the ground in the area into Difficult Terrain ... They
  // disappear when the spell ends" — the glossary's rate, on a patch that
  // lapses with the casting because it names it.
  areaTerrain: { costPerFoot: 2 },
  effects: [
    {
      kind: 'save',
      ability: 'str',
      // "or have the Restrained condition until the spell ends": no `lasts`,
      // so the condition's lifetime is the casting's — the minute, the
      // Concentration and a dispel all reach it.
      condition: 'restrained',
      // "A Restrained creature can take an action to make a Strength
      // (Athletics) check against your spell save DC. On a success, it frees
      // itself ... and is no longer Restrained by them." On itself: the
      // plants go on grasping everybody else, which is `end-on-target`.
      check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
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
  // "A 10-foot Emanation springs into existence around you and remains
  // stationary for the duration." The caster is inside their own dome — "if
  // you leave the Emanation" — so the origin is included, and the Emanation
  // stays where it rose rather than following the caster out of it.
  area: { kind: 'emanation', distance: 10, origin: 'self', includesOrigin: true, stays: true },
  effects: [],
  areaStanding: [
    // "Creatures and objects within the Emanation when you cast the spell can
    // move through it freely. All other creatures and objects are barred from
    // passing through it."
    { kind: 'bars-passage', to: 'all', crossing: 'either', except: 'inside-at-the-cast' },
    // "Spells of level 3 or lower can't be cast through it, and the effects of
    // such spells can't extend into it."
    { kind: 'wards-magic', maxLevel: 3 },
  ],
  durationSeconds: 28_800,
  // "The spell ends early if you leave the Emanation or if you cast it again."
  endsEarly: [{ on: 'caster-leaves-the-area', ends: 'casting' }],
  replacesPriorCasting: true,
  dmDecides: [
    "The spell fails when you cast it if the Emanation isn't big enough to fully encapsulate all creatures in its area.",
    'The atmosphere inside the Emanation is comfortable and dry, regardless of the weather outside.',
    'Until the spell ends, you can command the interior to have Dim Light or Darkness (no action required).',
    "The Emanation is opaque from the outside and of any color you choose, but it's transparent from the inside.",
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
 * > _Level 4 Abjuration (Wizard)._ **Casting Time:** Action.
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
  // One sentence of this spell asks nothing of any engine: whether a deity
  // objects. It is handed over. Everything else Gate does is a second place to
  // put a creature, which is a shape with a name and many claimants, and stays
  // below as the debt it is.
  dmDecides: [
    'Deities and other planar rulers can prevent portals created by this spell from opening in their presence or anywhere within their domains.',
  ],
  unmodelled: [
    'the portal has no far end: "a precise location on a different plane of existence" is a second place to put a creature, and there is one scene — so the diameter the caster chooses, the direction it is oriented in and the destination visible through it are all geometry of a thing with nowhere to be',
    'nobody travels through it: "Travel through the portal is possible only by moving through its front" and "Anything that does so is instantly transported to the other plane" move a creature off the scene entirely, which no command does',
    'the creature the caster names is not brought through: "the portal opens next to the named creature and transports it" fetches somebody from a plane the model has no room for, and what it does next — "It might leave, attack you, or help you" — the book gives to the GM in the same breath',
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
  // One patch for the four motes: the SRD's "up to four torch-size lights"
  // shed Dim Light in a 10-foot radius each, and the engine lays one dim
  // sphere at the point the caster names, which the table puts where the
  // nearest mote is. The 20-foot tether between two lights is the DM's.
  area: { kind: 'sphere', radius: 10, origin: 'point' },
  areaLight: { level: 'dim' },
  effects: [],
  durationSeconds: 60,
  // SRD: "As a Bonus Action, you can move the lights up to 60 feet to a new
  // spot within range." The area moves, and the light it sheds is laid again
  // where it lands.
  activation: {
    action: 'bonus-action',
    movesArea: 60,
    label: 'Dancing Lights (the lights move)',
    effects: [],
  },
  unmodelled: [
    'You create up to four torch-size lights within range, or one glowing Medium form: the engine lays one dim patch for all four, placed where the table says the nearest mote is, and the 20-foot tether between two lights and a light vanishing outside the spell’s range are the DM’s',
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
 * **The area is recorded now, and the note that refused it said why it would
 * be.** It read: "A `SpellArea` is what an effect is resolved over, and there
 * is no effect here: sunlight reaches nothing the engine holds." P3-S built
 * the thing it reaches. The Sphere is the template, `areaLight` is what
 * resolves over it, and `dimBeyond` lays the second patch the next sentence
 * prints — "sheds Dim Light for an additional 60 feet" — as a wider ring of
 * Dim Light around the bright core.
 *
 * **`sunlight: true` is a reading, and it is the printed word.** The
 * paragraph says "sunlight" three times and calls the Sphere "the sunlight's
 * area", so the flag four stat blocks read is set — which means this spell
 * gives a Kobold Disadvantage and burns a Vampire Spawn. The 2014 edition's
 * errata denied that and SRD 5.2.1's own sentence does not; `srd-policy.md`
 * ranks the printed text above the memory of a different edition, so it is
 * executed as printed and written down here rather than decided quietly.
 *
 * And the dispel is performed: `lightDispelledBy` ends a magical Darkness
 * whose casting is of level 3 or lower where the two Spheres overlap, which
 * is this spell's printed threshold and the other half of the pair Darkness
 * prints.
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
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  areaLight: { level: 'bright', dimBeyond: 60, sunlight: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the object the spell may be cast on instead, the 60-foot Emanation it carries, and covering it with a bowl or a helm are the DM’s; the engine holds no objects for an Emanation to originate from',
  ],
};

/**
 * SRD Darkness:
 *
 * > _Level 2 Evocation (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, magical Darkness spreads from a point within range and
 * > fills a 15-foot-radius Sphere. Darkvision can't see through it, and
 * > nonmagical light can't illuminate it."
 * > "Alternatively, you cast the spell on an object that isn't being worn or
 * > carried, causing the Darkness to fill a 15-foot Emanation originating from
 * > that object. Covering that object with something opaque, such as a bowl or
 * > helm, blocks the Darkness."
 * > "If any of this spell's area overlaps with an area of Bright Light or Dim
 * > Light created by a spell of level 2 or lower, that other spell is
 * > dispelled."
 *
 * **The Sphere is pinned now, and the argument that kept it quoted is the
 * argument that says so.** The old note here read: "A `SpellArea` is what an
 * effect is **resolved over**, and there is no effect here: darkness reaches
 * nothing the engine holds until the sight model does … A template nobody
 * reads is a second place to get the radius wrong." Every word of that was
 * true and every word of it was conditional on the sight model, which P3-S
 * built. There is a reader now — `lightAt` — and the fifteen feet are what it
 * reads, so the area is a template something resolves over and `areaLight` is
 * what it resolves into.
 *
 * Three of the four quoted clauses go with it. The Sphere is drawn; "Darkvision
 * can't see through it, and nonmagical light can't illuminate it" is the
 * `magical` flag the patch carries and the rule `piercesObscurement` keeps;
 * and the dispel is performed, because two areas of light can now overlap —
 * `lightDispelledBy` ends a Bright or Dim patch whose casting is of level 2
 * or lower, which is this spell's printed threshold.
 *
 * What is left is the object: an Emanation originating from a thing that is
 * not a creature, and a bowl put over it. The engine holds no objects, so
 * neither half has anywhere to sit.
 *
 * Sunburst's "This spell dispels Darkness in its area" is still the table's,
 * and the reason has moved a second time: it used to be that no Darkness
 * casting existed, then that the casting held no place, and it is now that
 * Sunburst itself pins no area for the two to overlap in.
 * `spell-honesty.test.ts` pins the new fact where it pinned the old one.
 */
export const DARKNESS: SpellDefinition = {
  id: 'darkness',
  name: 'Darkness',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 15, origin: 'point' },
  areaLight: { level: 'darkness' },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the object the spell may be cast on instead, the 15-foot Emanation originating from it, and covering it with a bowl or a helm are the DM’s — an Emanation whose origin is an object is not a template the format can state, and the engine holds no objects for one to originate from',
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
  // **Handed over whole**, which is P3-S6's reading of every sentence against
  // the book: four branches and no arithmetic in any of them, so which was
  // chosen needs nowhere to be recorded, and the weather sensor's round is not
  // a clock the engine runs on an Instantaneous casting.
  dmDecides: [
    'Whispering to the spirits of nature, you create one of the following effects within range.',
    '_Weather Sensor._ You create a Tiny, harmless sensory effect that predicts what the weather will be at your location for the next 24 hours.',
    'The effect might manifest as a golden orb for clear skies, a cloud for rain, falling snowflakes for snow, and so on.',
    'This effect persists for 1 round.',
    '_Bloom._ You instantly make a flower blossom, a seed pod open, or a leaf bud bloom.',
    '_Sensory Effect._ You create a harmless sensory effect, such as falling leaves, spectral dancing fairies, a gentle breeze, the sound of an animal, or the faint odor of skunk.',
    'The effect must fit in a 5-foot Cube.',
    '_Fire Play._ You light or snuff out a candle, a torch, or a campfire.',
  ],
};

/**
 * SRD Elementalism:
 *
 * > _Transmutation Cantrip (Druid, Sorcerer, Wizard)._
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
  // **Handed over whole.** Five branches and no arithmetic in any of them; the
  // 5-foot Cube each fits in is quoted rather than pinned because nothing is
  // resolved over it, and the minute of scent, the minute of evaporation and
  // the hour a shape holds run no clock on an Instantaneous casting.
  dmDecides: [
    'You exert control over the elements, creating one of the following effects within range.',
    "_Beckon Air._ You create a breeze strong enough to ripple cloth, stir dust, rustle leaves, and close open doors and shutters, all in a 5-foot Cube.",
    "Doors and shutters being held open by someone or something aren't affected.",
    '_Beckon Earth._ You create a thin shroud of dust or sand that covers surfaces in a 5-foot-square area, or you cause a single word to appear in your handwriting in a patch of dirt or sand.',
    '_Beckon Fire._ You create a thin cloud of harmless embers and colored, scented smoke in a 5-foot Cube.',
    'You choose the color and scent, and the embers can light candles, torches, or lamps in that area.',
    "The smoke's scent lingers for 1 minute.",
    '_Beckon Water._ You create a spray of cool mist that lightly dampens creatures and objects in a 5-foot Cube.',
    'Alternatively, you create 1 cup of clean water either in an open container or on a surface, and the water evaporates in 1 minute.',
    '_Sculpt Element._ You cause dirt, sand, fire, smoke, mist, or water that can fit in a 1-foot Cube to assume a crude shape (such as that of a creature) for 1 hour.',
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
  // **Handed over whole.** Ten gallons in a container, rain in a Cube, exposed
  // flames put out and fog destroyed are four facts about a world the engine
  // holds none of — fog is not a state it keeps even where another spell made
  // it — and the higher slot buys gallons and feet, neither of which is a
  // number any effect of this definition reads.
  dmDecides: [
    'You do one of the following:',
    '**Create Water.** You create up to 10 gallons of clean water within range in an open container.',
    'Alternatively, the water falls as rain in a 30-foot Cube within range, extinguishing exposed flames there.',
    '**Destroy Water.** You destroy up to 10 gallons of water in an open container within range.',
    'Alternatively, you destroy fog in a 30-foot Cube within range.',
    'You create or destroy 10 additional gallons of water, or the size of the Cube increases by 5 feet, for each spell slot level above 1.',
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
 * **The slot grows the area, an area is one fixed size, and the patch is not
 * an area.** The old note refused the Sphere on exactly that ground — "a
 * definition that pinned a 20-foot Sphere would resolve a level 5 casting
 * over the level 1 template" — and it is still true of `area`, which the fold
 * reads back at every later question. It is not true of the patch this spell
 * lays: the region is worked out once, at the casting, against the slot in
 * hand, so `radiusPerSlotLevelAbove` puts the hundred-foot bank a level 5 Fog
 * Cloud prints on the lattice and pins it into the event. That is the one
 * place in the vocabulary where a slot reaches a distance, and it is safe
 * only because nothing looks the number up again.
 *
 * The template stays the level 1 Sphere, because that is what the *area* is
 * and nothing resolves over it; what the higher slot buys is read off
 * `areaObscurement` and lands on the lattice instead.
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
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  areaObscurement: { degree: 'heavily', radiusPerSlotLevelAbove: 20 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
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
  // **Handed over whole.** The food and drink are objects; the Poisoned
  // condition belongs to a creature and is untouched by this spell, and a
  // definition that cured one — `end-condition` is right there — would be
  // inventing a rule the sentence does not print.
  dmDecides: [
    'You remove poison and rot from nonmagical food and drink in a 5-foot-radius Sphere centered on a point within range.',
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
 * **The save is real and what it gates is not**, and the second half of that
 * sentence is why this spell was tracked for the whole of Phase 1.
 * `AreaTrigger` has raised a save on exactly the two moments this one names
 * since Web, and the Sphere is an area like any other — but a failure would
 * then have had to impose *not being able to speak a deliberate lie*, which is
 * neither a condition nor any other state this engine holds. The engine has no
 * speech. `save_imposes_nothing` refused the definition for it, and rightly:
 * a die thrown whose answer reaches nobody is a die thrown for nothing.
 *
 * **What the spell prints next is the answer.** "You know whether a creature
 * succeeds or fails on this save" is not colour — it is the one consequence of
 * the roll the rules can see, and the gate ruled that the engine may hold a
 * fact only the table reads when the fact is the recorded outcome of a roll the
 * engine made and a door publishes it. So the save carries `recordsOutcome`,
 * the verdict is written onto the running casting, and `observe()` reports it.
 * Nothing is imposed on anybody, which is the honest reading of a spell whose
 * whole mechanical effect is that the caster knows something.
 *
 * What stays with the DM is what the knowing is *for*: whether a given
 * sentence was a deliberate lie, whether a creature is being evasive, and
 * everything the second paragraph prints.
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
  area: { kind: 'sphere', radius: 15, origin: 'point' },
  // Nothing at the cast: SRD gives this spell no cast-time save at all. "A
  // creature that enters the spell's area for the first time on a turn or
  // starts its turn there" is the whole of when it asks, so a creature already
  // standing in the Sphere when it is conjured is asked when its turn begins —
  // which is what the sentence says and not a compromise with it.
  effects: [],
  areaTrigger: {
    at: 'start-of-turn',
    onEntry: 'first-per-turn',
    label: 'Zone of Truth',
    effects: [
      {
        kind: 'save',
        ability: 'cha',
        // No condition and no rider: the failure imposes nothing the rules can
        // read, and the verdict is what the spell leaves behind.
        recordsOutcome: true,
      },
    ],
  },
  durationSeconds: 600,
  unmodelled: [
    'what a failed save buys — "a creature can’t speak a deliberate lie while in the radius" — is not imposed: the engine holds no speech, so the verdict is recorded and whether a given sentence was a deliberate lie is the DM’s',
    'a creature being aware of the spell, and its being evasive yet truthful, are the DM’s',
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
 * somebody else said.** The five words are five different effect lists and a
 * casting runs one of them, which is exactly what `SpellDefinition.options`
 * says — so the word is stated at the casting, the Wisdom save belongs to the
 * branch that has a consequence, and each consequence is a rider hung on that
 * save.
 *
 * **The save is in the branch and not in the common list**, which is the one
 * thing about this definition worth reading twice. A save in `effects` with
 * the consequence appended after it would impose the consequence on a creature
 * that had just resisted: nothing in an effect list knows how the effect
 * before it went, and only a rider does. So Halt, Drop and Grovel each write
 * "Wisdom saving throw" and hang their own sentence off the failure.
 *
 * **Approach and Flee carry no save at all**, and it is the honest end of the
 * same rule rather than an oversight: their whole consequence is a turn played
 * by somebody along a route nobody chose, so there is nothing for a failure to
 * hang and `save_imposes_nothing` refuses a die thrown for nothing. Both hand
 * the book's sentence to the table, which is where the roll goes with it.
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
  // Nothing is common to all five words but the sentence that gates them, and
  // a gate is a rider rather than a neighbour — see the note above.
  effects: [],
  options: {
    approach: {
      label: 'Approach',
      handsOver: [
        'Approach. The target moves toward you by the shortest and most direct route, ending its turn if it moves within 5 feet of you.',
      ],
      unmodelled: [
        'the Wisdom saving throw is not rolled for Approach: what a failure would buy is a route nobody chose and a whole turn spent walking it, which is a creature being played rather than a spend being charged — so the die goes to the table with the sentence',
      ],
    },
    drop: {
      label: 'Drop',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          // "The target drops whatever it is holding": no object is named
          // because there is none to name, which is the arm `DropRider.all`
          // was written for. Heat Metal points at one thing; this empties the
          // hands.
          drops: { all: true },
        },
      ],
      unmodelled: [
        'the hands are emptied at the casting rather than on the target’s next turn, and "and then ends its turn" is not applied at all: both are the directed turn itself — "follow the command on its next turn" defers every one of the five words to a turn somebody else is deciding, and a rider settles with the save that raised it',
      ],
    },
    flee: {
      label: 'Flee',
      handsOver: [
        'Flee. The target spends its turn moving away from you by the fastest available means.',
      ],
      unmodelled: [
        'the Wisdom saving throw is not rolled for Flee, for the reason Approach’s is not: the whole of what a failure buys is a direction and a turn spent running in it, which the engine adjudicates rather than performs',
      ],
    },
    grovel: {
      label: 'Grovel',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          condition: 'prone',
          // Command is Instantaneous, and Prone ends when the creature stands
          // up — Grease’s reading, on the same condition and the same word.
          outlivesCasting: true,
        },
      ],
      unmodelled: [
        'the Prone lands at the casting rather than on the target’s next turn, and the turn it cuts short is not cut short, for the reason Drop’s object hits the floor early: the word is obeyed inside a turn somebody else is directing, and nothing defers a rider into one',
      ],
    },
    halt: {
      label: 'Halt',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          modifiers: [
            {
              kind: 'action',
              // "On its turn, the target doesn't move and takes no action or
              // Bonus Action" — three slots in one sentence, which is what
              // `forbids` takes, and the Reaction is deliberately not among
              // them because the book does not name it.
              rule: { kind: 'forbids', slots: ['action', 'bonus-action', 'movement'] },
              // "On **its** turn": the rule is lifted at the end of the
              // target's next turn, which is the only turn it can govern.
              lasts: 'end-of-targets-next-turn',
            },
          ],
        },
      ],
    },
  },
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
 * and nothing narrows them for a single creature. The definition had said
 * "a `save` effect with no condition to impose would be a die thrown for
 * nothing", which was the format's rule and not the spell's: `save.condition`
 * is optional now, and the `benefit` rider is what the failure hands out.
 *
 * **The Cube picks its own targets**, which is the difference between this
 * and Slow's: "**each** creature in the Cube" is the geometry choosing, so it
 * is an `area` and not a `targetsWithin`. Nothing persists in it — the save
 * is rolled once, at the cast, exactly as Fireball's is — so the Concentration
 * holds the grant and the Cube is not a place anybody can walk into later.
 *
 * **The objects are still the table's**, and so is the Advantage the outline
 * buys: that sentence is gated on the attacker's sight, which is a pairwise
 * declaration between two creatures rather than a state on the outlined one.
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
  area: { kind: 'cube', size: 20, origin: 'point' },
  effects: [
    {
      kind: 'save',
      ability: 'dex',
      modifiers: [
        { kind: 'benefit', denies: 'invisible' },
        // SRD: "Attack rolls against an affected creature or object have
        // Advantage if the attacker can see it." A mode hung on the outlined
        // creature for the casting, gated on the roller's sight of it — the
        // declaration first, then the roller's senses — and applied with a
        // note where nobody has said.
        {
          kind: 'mode',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'attack', relation: 'against-holder', ifRollerSees: true },
          },
        },
      ],
      // "For the duration, objects and **affected** creatures shed Dim Light
      // in a 10-foot radius" — on exactly the creatures the die outlined,
      // which is what makes it a rider: a `light` effect beside the save would
      // light the ones that made it too. The patch has the creature for its
      // origin, so it walks with them, and it is the casting's, so a dispel
      // puts it out.
      light: { level: 'dim', radius: 10 },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the objects in the Cube are not outlined, and neither is the Dim Light they would shed: objects are not modelled, so which of them the light picks out is the DM’s',
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
 *
 * **The Challenge Rating the save reads is held now**, which is one of the two
 * facts this spell was waiting on: `CreatureState.cr` is pinned at the arrival
 * from the block and `save.autoSucceedIf.challengeRatingAbove` reads it, so a
 * Venomous Snake would be spared and a Raven would not.
 *
 * **What is still missing is where the verdict goes.** The save is inverted —
 * "must succeed on a Charisma saving throw, **or** it attempts to deliver a
 * message for you" — so a success is the Beast declining the errand, and the
 * errand is narration from the first word to the last. The failure therefore
 * imposes no condition and hangs no rider: the die's whole content is its
 * verdict, which is what `verdictOnly` says (ruled 2026-09-24; the area-standing
 * track built the mark and this definition is the first to write it). The
 * verdict reaches the caller in the casting's own outcomes and no ongoing
 * record is written. "If the target's Challenge Rating isn't 0, it
 * automatically succeeds" is `autoSucceedIf.challengeRatingAbove`, read off
 * the rating the block prints and pinned at the arrival.
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
  // "A **Tiny** Beast of your choice that you can see within range": two
  // facts about the target and both of them the engine's, now that a target
  // rule can ask for a size. A Wolf is a Beast and is not a messenger.
  targets: { count: 1, mustBeType: 'Beast', mustBeSize: 'tiny' },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'cha',
      verdictOnly: true,
      autoSucceedIf: { challengeRatingAbove: 0 },
    },
  ],
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
  dmDecides: [
    'You specify a location you have visited and a recipient who matches a general description, such as "a person dressed in the uniform of the town guard" or "a red-haired dwarf wearing a pointed hat."',
    'You also communicate a message of up to twenty-five words.',
    'The Beast travels for the duration toward the specified location, covering about 25 miles per 24 hours or 50 miles if the Beast can fly.',
    'When the Beast arrives, it delivers your message to the creature that you described, mimicking your communication.',
    "If the Beast doesn't reach its destination before the spell ends, the message is lost, and the Beast returns to where you cast the spell.",
  ],
};

/**
 * SRD Gust of Wind:
 *
 * > _Level 2 Evocation (Druid, Ranger, Sorcerer, Wizard)._ **Casting Time:** Action.
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
 * **The push needed no new movement at all.** "Pushed 15 feet away from you in
 * a direction following the Line" is the bearing from the caster to the
 * creature, which is what `shoveAwayFrom` has measured since Thunderwave — and
 * for a creature standing *in* a Line that blasts from the caster, the bearing
 * to it and the Line's own direction are the same reading. What was missing
 * was the **host**: the wind deals no damage, so the rider had to hang off a
 * bare `save`, and the slot lived only on the two kinds that carry
 * `& OutcomeRiders` whole.
 *
 * Two clauses ask the same save at two moments, which is exactly the pair an
 * `areaTrigger` is: everyone caught when the Line is conjured, and "a creature
 * that ends its turn in the Line" every round after.
 *
 * A Line that **turns** is still not a shape the engine has — the Bonus Action
 * re-aims it every round, and an area is fixed where the casting put it, which
 * is the same sentence SRD Sunbeam's later Magic action waits on.
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
  area: { kind: 'line', length: 60, width: 10, origin: 'self' },
  effects: [
    {
      kind: 'save',
      ability: 'str',
      // "or be pushed 15 feet away from you in a direction following the
      // Line." Away from the caster is the only direction this rider has, and
      // for a creature standing in a Line that blasts from the caster it is
      // the direction the Line follows.
      //
      // Written out rather than left absent, which means the same thing: this
      // is the spell whose own sentence names the direction, and Thunderwave
      // beside it is what keeps the omitted spelling driven.
      movement: { kind: 'push', feet: 15 },
    },
  ],
  // "A creature that ends its turn in the Line must make the same save." The
  // same save, so the same effect, written at the moment the sentence names.
  areaTrigger: {
    at: 'end-of-turn',
    label: 'Gust of Wind (the Line)',
    effects: [{ kind: 'save', ability: 'str', movement: { kind: 'push', feet: 15 } }],
  },
  // "As a Bonus Action on your later turns, you can change the direction in
  // which the Line blasts from you." The Line blasts *from the caster*, so
  // nothing is carried anywhere: what changes is the bearing, which is the one
  // fact about a persistent area that cannot be reconstructed.
  //
  // **And the turning rolls nothing.** The opening save is asked at the
  // casting and the only one that recurs is the `areaTrigger` below — "A
  // creature that ends its turn in the Line must make the same save" — which
  // reads the new bearing when that moment arrives. A save at the re-aim would
  // be a third sentence the spell does not print.
  activation: {
    action: 'bonus-action',
    label: 'Gust of Wind (the direction the Line blasts)',
    redirects: true,
    effects: [],
  },
  durationSeconds: 60,
  unmodelled: [
    'the doubled cost of walking into the wind — "must spend 2 feet of movement for every 1 foot it moves when moving closer to you" — is not charged: a casting may make ground expensive now, and a patch is a property of the **square**, charging whoever crosses it at the rate it holds. Nothing on one can say "only while moving closer to you", which is a fact about the mover rather than about the ground, so `areaTerrain` cannot carry it',
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
    'being "unaffected by Difficult Terrain" is not applied: there is ground to be excused from now — a casting pins a patch and the ruler charges for it at every space a move crosses — and the cost is read off the **square** rather than off the mover, so nothing excuses one creature from a rate the ground holds for everybody',
    'the refusal of a Speed reduction is not applied: "spells and other magical effects can neither reduce the target’s Speed" is an effect stopping another effect from landing, and `speedOf` reads every grant a source hung with no notion of one being refused',
    'the two conditions are not refused: the subject is "spells and other magical effects", so a Ghoul’s Paralyzed still lands and a Hold Person’s does not, and a condition Immunity here answers about the condition rather than about what caused it',
    'the Swim Speed equal to its Speed is not granted; the engine tracks one Speed and no movement modes',
    'the escape is not offered: "the target can spend 5 feet of movement to automatically escape from nonmagical restraints" is a later action taken by the target rather than by the caster, and a casting is acted through by its caster and nobody else',
    'the "willing creature" clause is not transcribed here: `TargetRule.willing` is the field that gates a casting on consent, and it has been written onto the levels the ledger counts and not yet onto this one',
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
 * and the two are different arithmetic with the same name. The `damage-reduction`
 * effect is the first of them the pipeline learned — an *adjustment*, which
 * SRD's "Order of Application" puts before the halving, so a 1d4 off 10 Fire
 * against a fire-resistant target leaves 3 rather than 4.
 *
 * **The eleven printed types are a `damageTypeStated` list**, and the field is
 * the same one Spirit Guardians and Protection from Energy already use: the
 * definition carries one so the shape is well-formed, the caster names one at
 * the casting, and a casting that names none is refused rather than defaulted.
 * The list here is the book's, minus Force and Psychic, which the SRD does not
 * print in this sentence.
 */
export const RESISTANCE: SpellDefinition = {
  id: 'resistance',
  name: 'Resistance',
  level: 0,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  effects: [
    {
      kind: 'damage-reduction',
      // "reduces the total damage taken by 1d4" — a notation, thrown by the
      // blow that arrives rather than at the cast.
      reduces: { dice: '1d4' },
      // Rewritten to the one the caster named; `fire` is here so the shape is
      // well-formed, exactly as Spirit Guardians carries one of its two.
      damageTypes: ['fire'],
      // "A creature can benefit from this spell only once per turn."
      oncePerTurn: true,
    },
  ],
  // The eleven the sentence prints, in the book's own order.
  damageTypeStated: [
    'acid',
    'bludgeoning',
    'cold',
    'fire',
    'lightning',
    'necrotic',
    'piercing',
    'poison',
    'radiant',
    'slashing',
    'thunder',
  ],
  durationSeconds: 60,
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
 * **The spell the `weapon-rider` grant was built for**, with Magic Weapon.
 * Every clause of it rides a *later* attack made with **one object**, and
 * neither narrowing the engine had could name one: `onlyWithItem` keys on the
 * item that granted a benefit and nothing granted this, and a
 * `WeaponNarrowing` over Simple Melee would have imbued every Dagger in the
 * pack. `CastSpellRequest.weapon` is the casting naming its own, and
 * `GrantedWeaponRider` is what a swing reads back.
 *
 * **"A Club or Quarterstaff" is two objects, not a description.** No selector
 * over category, kind and properties says it — Simple Melee and Light catches
 * a Dagger, Versatile catches a Longsword — so the two are named by id, which
 * is content naming content and not the engine learning a catalogue.
 *
 * **The Cantrip Upgrade is a band table on the caster's level**, not
 * `cantripUpgradesAt`: that field *adds* a die of the base notation, and this
 * sentence changes the die's size and then how many there are. No arithmetic
 * over 1d8 produces d10, d12, 2d6.
 *
 * **The damage-type choice is made at each later attack rather than at the
 * casting**, and that is why it is `damageTypes` on the rider rather than
 * `damageTypeStated` on the definition: a casting pins what it knows, and this
 * is a decision the druid takes a turn later with the target's Resistances in
 * front of them. The swing names it under the spell's own name and declining
 * it deals the staff's Bludgeoning, which is the second half of the book's
 * "or".
 *
 * One clause is left, and what it waits on has moved. "If you let go of the
 * weapon" is **built** as a rule: `GrantedWeaponRider.endsWhenLetGo` says a
 * rider ends when its weapon is no longer carried, and `settleWeaponRiders` in
 * the fold ends the casting with it — the id the casting pinned against the
 * ids in the holder's inventory, which needs no catalogue. SRD Sacred Weapon's
 * "This effect also ends if you aren't carrying the weapon" comes through it.
 * What is missing is only the **declaration**: a `weapon-rider` effect has no
 * field to print the clause with, and it must be declared rather than assumed,
 * because SRD Magic Weapon prints no such sentence and a weapon put down under
 * it is still a magic weapon when it is picked up.
 */
export const SHILLELAGH: SpellDefinition = {
  id: 'shillelagh',
  name: 'Shillelagh',
  level: 0,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'weapon-rider',
      // "The spell ends early if you cast it again or if you let go of the
      // weapon": the rider carries the clause, and the fold ends the casting
      // when the weapon leaves the Druid's inventory.
      endsWhenLetGo: true,
      // "A Club or Quarterstaff you are holding".
      weapons: ['club', 'quarterstaff'],
      // "the attack and damage rolls of **melee** attacks using that weapon".
      meleeOnly: true,
      // "you can use your spellcasting ability instead of Strength" — an
      // offer, which is how `attackAbility` reads a style's ability.
      castingAbility: true,
      // "the weapon's damage die becomes a d8", and the Cantrip Upgrade.
      die: '1d8',
      dieAtLevel: { 5: '1d10', 11: '1d12', 17: '2d6' },
      // "If the attack deals damage, it can be Force damage or the weapon's
      // normal damage type (your choice)" — an offer answered at each later
      // swing, so the list holds the alternative and declining it is how the
      // weapon's own type is kept.
      damageTypes: ['force'],
    },
  ],
  durationSeconds: 60,
  // SRD: "The spell ends early if you cast it again."
  replacesPriorCasting: true,
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
 *
 * **And the first definition in the book to say how its own dice behave.** The
 * exploding d8 was filed as debt on the reading that "a damage roll comes back
 * as a total" — which was true of what a definition could *ask for* and never
 * of the generator, whose dice have been individually addressable since it was
 * written. `dieRule` is the ask, and the cap is named as the derivation the
 * sentence prints rather than as a number: "the maximum number of these d8s
 * you can add to the spell's damage equals your spellcasting ability
 * modifier" is a fact about the Sorcerer, and the engine reads it off the
 * numbers the casting pinned.
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
  dieRule: { kind: 'bonus-die-on-max', cap: 'spellcasting-modifier' },
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
 * ability substituted and a die of Radiant added on top.
 *
 * **The swing is the casting, so the attack command takes the cantrip.** The
 * `weapon-attack` effect is the one kind `resolveSpell` refuses outright —
 * the shape Divine Smite's `attack-damage` already has, one command earlier —
 * and `resolveAttack` casts it beside the swing: one Action, `spell-cast`
 * before `attack-made`, the substitution and the Radiant die on this roll and
 * no other, nothing granted and nothing left standing.
 *
 * Every number here is the book's. The offer is the two types the sentence
 * prints, of which the weapon's own is the unnamed half; the band table is
 * the Cantrip Upgrade, keyed by the levels it names, with nothing below the
 * first of them.
 */
export const TRUE_STRIKE: SpellDefinition = {
  id: 'true-strike',
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
  name: 'True Strike',
  level: 0,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [
    {
      kind: 'weapon-attack',
      ability: 'spellcasting',
      // "it can be Radiant damage **or** the weapon's normal damage type (your
      // choice)" — one list, and declining it is the other half of the "or".
      damageTypes: ['radiant'],
      extraDamage: {
        damageType: 'radiant',
        diceAtLevel: { 5: '1d6', 11: '2d6', 17: '3d6' },
      },
    },
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
 * **The orb leaps now, and it leaps where the caster said.** The trigger is a
 * predicate over the whole roll — a pair among the spell's own d8s, which
 * `DieRule` could not ask because it judges one die at a time — and the
 * consequence is an attack roll at a creature the casting never named, which
 * the format could not aim. Both are `leaps` on the attack: the request states
 * `leapTo` in the caster's order, and when a pair shows the orb goes to the
 * first stated creature within thirty feet of the one just struck that this
 * casting has not yet targeted, with a new attack roll and a new damage roll
 * through the same resolver. The cap is the slot's level — one leap at level
 * 1, which is what "can't leap **again** unless" means — and a creature is
 * targeted once per casting. A caster who names nobody has an orb that does
 * not leap, which is what "of your choice" means for silence.
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
      // "If you roll the same number on two or more of the d8s, the orb leaps
      // to a different target of your choice within 30 feet of the target …
      // a maximum number of times equal to the level of the slot expended".
      leaps: { onPair: true, withinFeet: 30, maximum: 'slot-level' },
    },
  ],
};

/**
 * SRD Expeditious Retreat:
 *
 * > _Level 1 Transmutation (Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Bonus Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You take the Dash action, and until the spell ends, you can take that
 * > action again as a Bonus Action."
 *
 * Nineteen words, and both halves are the action economy — which is why this
 * spell was tracked, and why it is not any more. Its own `unmodelled` said
 * "nothing lets a spell reach the action economy except by naming a
 * condition", and that stopped being true when `ActionRule` became the ninth
 * sourced grant: `allows` moves a named action to a cheaper slot,
 * `STATABLE_PRICES` holds `dash` out of a Bonus Action, and `takeDash` takes
 * the price and refuses one that map does not hold. The second half is
 * therefore transcription, and the engine changed for none of it.
 *
 * **The first half was debt, and it is a different one.** "You take the Dash
 * action" is an *extra* action the casting hands out rather than an existing
 * one governed, which no member of `ActionRule` created — Haste's residue,
 * filed under the same shape. `grants` is that member now, and it arrives
 * `at: 'casting'` rather than at every boundary, because the book hands this
 * one over once: a per-turn reading would be a free Dash action every round
 * for ten minutes, on top of the Bonus Action price the second clause already
 * writes. **Narrowed to the Dash**, so the caster may not buy an Attack with
 * it — and still offered rather than taken, because the engine adjudicates
 * reality and does not play creatures. A free Dash it spent for the caster
 * would be fiction written into the log.
 *
 * **The doc comment it replaces quoted the 2014 wording.** "This spell lets
 * you move at an incredible pace. When you cast this spell and as a Bonus
 * Action on each of your turns until the spell ends" is not a sentence SRD
 * 5.2.1 prints, and the `unmodelled` line built on it quoted the same absent
 * text back. Corrected here rather than noted, because a transcription nobody
 * can check against the book is how the next reading goes wrong too.
 */
export const EXPEDITIOUS_RETREAT: SpellDefinition = {
  id: 'expeditious-retreat',
  name: 'Expeditious Retreat',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  // Range: Self, so the grant lands on the caster — and a caster may not name
  // themselves unless the target rule says so, which is Magic Jar's shape
  // exactly.
  targets: { count: 1, self: true },
  // Nothing is rolled and nothing is resisted, so the rules stand on their own
  // rather than riding an outcome. The ten minutes are the casting's own
  // deadline, so the allowance needs no `lasts`: `releaseCasting` lifts it when
  // the Concentration goes.
  //
  // **Two clauses, two moments, and that is the whole of the sentence.** "You
  // take the Dash action" is an action handed over *once*, as the casting
  // resolves, narrowed to the one action the book names — so the caster may
  // Dash for free this turn and may not buy an Attack with it. "You can take
  // that action again as a Bonus Action" is the standing price. The engine
  // takes neither: it offers the action and the table decides whether the
  // caster runs.
  effects: [
    { kind: 'action-rule', rule: { kind: 'grants', at: 'casting', only: ['dash'] } },
    { kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } },
  ],
  durationSeconds: 600,
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
 * **The berries are the spell**, and they are a thing a creature is holding:
 * `conjures` puts ten of them in the caster's hand, `goodberry` is the
 * catalogue item they are, and eating one is that item's conferral — a Bonus
 * Action for a hit point, run by the command that already drinks potions.
 * Uneaten berries disappear when the spell ends without anything having to
 * take them away, because a conjured line lives exactly as long as its
 * casting.
 *
 * What is left is the day's nourishment, and the engine tracks no hunger.
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
  conjures: { item: 'goodberry', count: 10, hands: 1 },
  unmodelled: [
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
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
  name: 'Ice Knife',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      // "On a hit, the target takes 1d10 Piercing damage" — and the upcast
      // is the burst's rather than the shard's, so this scales with nothing.
      damage: { dice: '1d10' },
      damageType: 'piercing',
      // "**Hit or miss**, the shard then explodes. The target and each
      // creature within 5 feet of it must succeed on a Dexterity saving
      // throw or take 2d6 Cold damage." A second roll sequenced after the
      // first rather than a rider: a rider rides a settled outcome, and this
      // rides neither branch.
      then: {
        // Centred on the space the shard reached, which is wherever the
        // target is standing. A Sphere includes its own origin, which is how
        // "the target **and**" is answered without a second clause.
        area: { kind: 'sphere', radius: 5, origin: 'point' },
        effects: [
          {
            kind: 'save-damage',
            ability: 'dex',
            // "The Cold damage increases by 1d6 for each spell slot level
            // above 1."
            damage: { dice: '2d6', perSlotLevelAbove: '1d6' },
            damageType: 'cold',
            // SRD prints no half: a creature that saves takes none of it.
            onSuccess: 'none',
          },
        ],
      },
    },
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
 * **The last sentence is Invisibility's, word for word in a different order**,
 * and it was for a long time the only half of this spell the engine did:
 * three `CastingEndTrigger`s hung on a casting with no effects under it.
 *
 * The ward is the other half, and the owner's ruling of 2026-09-22 is what
 * made it writable. Two things about it are unlike anything else in the
 * catalogue: the creature who rolls is the one **attacking**, and what a
 * failure costs is the attack itself. The engine aims nothing on a caller's
 * behalf, so it takes neither of the book's two branches for the attacker —
 * the swing is lost, **nothing is spent**, and redirecting is a second
 * command against a creature nobody warded.
 *
 * **Both halves of "an attack roll or a damaging spell" are answered, and at
 * the moment each of them targets.** A weapon swing meets the ward inside
 * `resolveAttack`, before the Attack action; a casting meets it inside
 * `resolveSpell`, with the targets settled and before the slot, the action
 * and the first die. So the price is the same on both paths — nothing —
 * and what the caster does next is theirs.
 *
 * **"This spell doesn't protect the warded creature from areas of effect" is
 * executed, and it costs a guard rather than being free.** Both branches of
 * `resolveSpell` fill one `targets` list, so an area's catch and a Fire
 * Bolt's named creature are indistinguishable by the time a ward reads it;
 * the check asks whether the definition *has* an area, and without that a
 * Fireball is turned away from everybody standing in it. It is not in
 * `unmodelled` because the engine keeps the sentence.
 *
 * The one place this is narrower than the book is deliberate and the owner
 * accepted it: an attacker gets **one save per ward per turn** rather than one
 * per targeting. Without that a failure costs nothing and can be re-declared
 * until it passes, which is the spell undone.
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
  effects: [
    {
      kind: 'passive-defense',
      // "must succeed on a Wisdom saving throw", against the caster's own
      // spell save DC — pinned at the casting, like every other number a
      // spell sets.
      defense: { kind: 'ward', ability: 'wis' },
    },
  ],
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
    'the branch the save buys is offered as two commands rather than one: "choose a new target" is a second swing at a creature nobody warded, because the engine aims nothing on a caller’s behalf, and "lose the attack" is declining to make one',
    'an attacker gets one save per ward per turn rather than one each time they target, which is a limit the book does not print — owner’s ruling, 2026-09-22, in exchange for a failure that costs nothing not being re-rollable until it passes',
  ],
};

/**
 * SRD Searing Smite:
 *
 * > _Level 1 Evocation (Paladin)._ **Casting Time:** Bonus Action,
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
 * and `resolveAttackDamage` settles it on the attack that triggered it.
 *
 * **What Divine Smite does not print is the minute afterwards**, and the
 * minute is what made this spell two mechanisms rather than one. The blow is
 * an ordinary `attack-damage`; the burning is a repeat save hosted by the
 * *casting* — the spell imposes no condition, so there is nothing else for a
 * boundary to hang one on — that deals its own damage before it is rolled and
 * ends the casting on a success. Both halves scale with the slot, because the
 * book scales them in one sentence.
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
      // "At the start of each of its turns until the spell ends, the target
      // takes 1d6 Fire damage and then makes a Constitution saving throw. On a
      // failed save, the spell continues. On a successful save, the spell
      // ends." The ability is printed here because the hit rolled no save for
      // this one to repeat; the DC is the caster's own and is pinned at the
      // cast.
      repeats: {
        at: 'start-of-turn',
        ability: 'con',
        onSuccess: 'end-casting',
        beforeTheSave: {
          damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
          damageType: 'fire',
        },
      },
    },
  ],
  durationSeconds: 60,
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
 * **2024 rewrote this spell too**, and the hit-point total everybody remembers
 * is gone: it is a save now, and the save repeats once and *deepens* on the
 * second failure. That deepening is what `SpellRepeatSave.onFailure` was built
 * for — a repeat save released an effect on a success and did nothing at all
 * on a failure, which is the wrong way round for the middle sentence of this
 * paragraph; the Cockatrice's "_First Failure:_ Restrained … _Second Failure:_
 * Petrified" writes the same shape outside the spell book.
 *
 * **The Incapacitated carries no `lasts` of its own, and that is the spell
 * rather than a shortcut.** "Until the end of its next turn" and "at which
 * point it must repeat the save" are one moment named twice: a deadline there
 * would expire the timer and drop the pending save before anybody rolled it,
 * so what the moment does is *change* the condition — deepened on a failure,
 * released on a success — and the minute the casting runs for is what ends it
 * either way.
 */
export const SLEEP: SpellDefinition = {
  id: 'sleep',
  name: 'Sleep',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "**Each creature of your choice** in a 5-foot-radius Sphere": the Sphere
  // says who could be caught and the caster says which of them are, so the
  // cast's `targets` names the subset and a casting that names nobody is
  // refused rather than putting the party to sleep. No count, because the
  // spell prints none — the Sphere is the only bound there is.
  targets: { count: 0, chosenFromTheArea: true },
  // "in a 5-foot-radius Sphere centered on a point within range" — a template
  // the engine already has, on a point the caster names.
  area: { kind: 'sphere', radius: 5, origin: 'point' },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'incapacitated',
      // "Creatures that don't sleep, such as elves, or that have Immunity to
      // the Exhaustion condition automatically succeed on saves against this
      // spell" — one sentence, two facts about the target, either of which
      // spares it, so both go in one clause. The die is still thrown and
      // recorded and the total overridden, which is the automatic *failure*'s
      // reading with the sign turned round.
      autoSucceedIf: { immuneTo: 'exhaustion', doesNotSleep: true },
      repeats: {
        // "until the end of its next turn, at which point it must repeat the
        // save" — the sleeper's own turn, and the condition's lifetime is the
        // casting's, so this moment is the only thing that changes it.
        at: 'end-of-turn',
        // A creature that shakes it off is awake; the rest go on sleeping,
        // which is what "on a target" means for a spell cast at a Sphere.
        onSuccess: 'end-on-target',
        // "If the target fails the second save, the target has the Unconscious
        // condition for the duration." Under the casting's own source, so the
        // minute, the Concentration and a dispel all reach it; and the repeat
        // stops there, because the SRD asks for a second save and not a third.
        onFailure: { condition: 'unconscious' },
      },
    },
  ],
  durationSeconds: 60,
  // "The spell ends on a target if it takes damage **or someone within 5 feet
  // of it takes an action to shake it out of the spell's effect**" — any
  // damage, from anybody or from nobody at all, and on that sleeper rather
  // than on the Sphere: the rest of the room stays asleep. Hypnotic Pattern
  // writes both sentences and reaches both causes.
  endsEarly: [
    { on: 'target-takes-damage', ends: 'target' },
    { on: 'shaken-awake', ends: 'target' },
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
 *
 * So it is not a `heal` with a bigger number: a heal is capped by the very
 * maximum this sentence moves, resets death saves and lifts the unconsciousness
 * that 0 hit points caused, and the book asks for none of those. It is a grant
 * the fold reconciles — see `hit-point-maximum` — and the current total rises
 * with it because the five were never lost.
 */
export const AID: SpellDefinition = {
  id: 'aid',
  name: 'Aid',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  // "Choose up to three creatures within range": a caster standing within
  // thirty feet of themselves is one of them, and the SRD prints no clause
  // excluding them. Three is the ceiling rather than a demand.
  targets: { count: 3, self: true },
  effects: [
    {
      kind: 'hit-point-maximum',
      // "increase by 5", and "increase by 5 for each spell slot level above
      // 2": `flat` and `flatPerSlotLevelAbove` are exactly those two printed
      // numbers, on an amount that rolls nothing at all.
      amount: { flat: 5, flatPerSlotLevelAbove: 5 },
    },
  ],
  durationSeconds: 28_800,
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
 *
 * **The fact is not written over and that is the design.** The Mask is the
 * nineteenth sourced grant, hung under the casting, so the goblin is a Fey
 * again when the day is up or the spell is dispelled and nothing had to
 * remember to undo anything. Which readers believe it is the SRD's own
 * sentence — *spells and other magical effects* — and `typeMagicSees` in the
 * engine is where that line is drawn: a spell's target rule, an area's filter
 * and an outcome that varies by type all read the mask, and a creature reading
 * a creature does not.
 *
 * The chosen type is `choiceStated`, because the book says *choose*, and the
 * engine refuses the one choice the book forbids: the type the creature
 * already is.
 */
export const ARCANISTS_MAGIC_AURA: SpellDefinition = {
  id: 'arcanists-magic-aura',
  name: "Arcanist's Magic Aura",
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  // The Mask, with the fourteen the book gives a caster to choose from. The
  // printed value is a default the casting replaces, exactly as
  // Blindness/Deafness prints Blinded: `statedChoice` substitutes what the
  // caster named, and `same_creature_type` refuses the one the book excludes.
  effects: [{ kind: 'creature-type-override', creatureType: 'Humanoid' }],
  choiceStated: { of: 'creature-type', options: [...CREATURE_TYPES] },
  durationSeconds: 86_400,
  unmodelled: [
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
 * which is the second arm of `armor-class`: read after the calculation, after
 * a Shield and after every flat bonus, because "its AC" in that sentence is
 * the total rather than the base.
 */
export const BARKSKIN: SpellDefinition = {
  id: 'barkskin',
  name: 'Barkskin',
  level: 2,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  // "the target has an Armor Class of 17 if its AC is lower than that" — the
  // whole rule, and the `if` is the arm rather than a condition anybody has
  // to write down.
  effects: [{ kind: 'armor-class', minimum: 17 }],
  durationSeconds: 3600,
  unmodelled: [
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
 * **The Advantage was always ordinary and the choice is what was missing.** A
 * `RollModifier` names Advantage on ability checks of a stated ability
 * perfectly well; what a casting had nowhere to record was which of the five
 * was picked, and `choiceStated` is that place. The selector below carries
 * Strength so the definition is a whole spell read alone, and the casting
 * replaces it with the ability the caster named.
 *
 * **The upcast is still not executed, and it is a different sentence.** "You
 * can choose a different ability for each target" is one casting whose effects
 * differ from target to target, which is a shape of its own and not a second
 * choice: this spell states one value, and every creature it caught gets it.
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
  effects: [
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'advantage',
        // "ability checks using the chosen ability" — an ability *check* and
        // not a saving throw, which is the narrowing `RollSelector` keeps
        // apart on purpose: Beacon of Hope is the same sentence about saves.
        selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
      },
    },
  ],
  // "choose Strength, Dexterity, Intelligence, Wisdom, or Charisma" — five,
  // in the order the SRD prints them, and Constitution is not among them.
  choiceStated: { of: 'ability', options: ['str', 'dex', 'int', 'wis', 'cha'] },
  durationSeconds: 3600,
  unmodelled: [
    '"You can choose a different ability for each target" is a second choice per creature rather than one per casting: a casting states one value and applies its effects to every target alike',
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
 * **One number reaching two rolls**, which is why this is not a `buff`:
 * `BonusApplies` covers attacks, saves, ability checks and an Armour Class,
 * and a damage roll is none of them. And the plus is of the weapon's **own**
 * type — a Mace under this deals 7 Bludgeoning, not 6 Bludgeoning and 1 of
 * something else — which is what keeps it out of `attack-rider` beside it.
 *
 * **Range: Touch is what makes the grant's owner a real question.**
 * Shillelagh is Range: Self and its caster and its wielder are the same
 * creature; here the Paladin may enchant the Fighter's Greatsword, and the
 * plus is the Fighter's. So the grant lands on the effect's target, which is
 * the ordinary rule every other grant follows and the opposite of the
 * asymmetry `attack-rider` needed for Hunter's Mark.
 *
 * The bands are the spell's own table, read the way `durationAtSlot` is read:
 * the highest key at or below the slot, and `bonus` for a slot below every
 * band. A level 5 slot falls in the band that opened at 3.
 *
 * "You touch a **nonmagical** weapon" is the one clause left. A weapon's
 * magicality is not a fact the engine holds — nothing reads one, so nothing
 * could refuse a second casting on an already-magic Longsword.
 */
export const MAGIC_WEAPON: SpellDefinition = {
  id: 'magic-weapon',
  name: 'Magic Weapon',
  level: 2,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'weapon-rider',
      // "a +1 bonus to attack rolls and damage rolls", and the two bands the
      // higher-slot clause prints.
      bonus: 1,
      bonusAtSlot: { 3: 2, 6: 3 },
    },
  ],
  durationSeconds: 3600,
  // "The spell ends early if you cast it again."
  replacesPriorCasting: true,
  unmodelled: [
    'the weapon is not refused for being magic already, and does not become magic: "You touch a nonmagical weapon" and "that weapon becomes a magic weapon" are both about a property of the object that nothing in the engine holds or reads',
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
 * **It fires on a hit, not on targeting**, and that one word is why three
 * earlier attempts at this spell went looking in the wrong place. The book
 * says "Each time a creature **hits** you with an attack roll", which is the
 * instant the engine already stops at: the hit is known, the damage is not
 * rolled, and the `pendingAttack` hold has not been built. Every prose note
 * this spell carried said "targeting", each inherited from the last.
 *
 * What it needed was the owner's ruling of 2026-09-22 — a defence the attack
 * path consults with **nobody taking a Reaction** — and one thing no other
 * spell had ever asked the engine for: a count that goes **down**. Slots, Ki
 * and charges are pools, and every one of them is declared by creation, an
 * item or a stat block; nothing a casting hung on a creature had ever counted
 * anything off.
 *
 * The exception is written in two axes because the sentence names two kinds of
 * thing. `unlessPerceivedWith` is the sense half, the same axis Blur's second
 * sentence uses; `unlessCondition` is the half that had nowhere to go at all —
 * `RollSelector.condition` is about what a *saving throw* avoids, which is a
 * different question with the same word in it.
 */
export const MIRROR_IMAGE: SpellDefinition = {
  id: 'mirror-image',
  name: 'Mirror Image',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  // It lands on the caster, because that is where the grant hangs: "Three
  // illusory duplicates of yourself appear in **your** space."
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'passive-defense',
      defense: {
        kind: 'decoys',
        // "Three illusory duplicates", "roll a d6 for each of your remaining
        // duplicates", "If any of the d6s rolls a 3 or higher".
        count: 3,
        die: '1d6',
        deflectsOn: 3,
        // "A creature is unaffected by this spell if it has the Blinded
        // condition, Blindsight, or Truesight."
        unlessPerceivedWith: ['blindsight', 'truesight'],
        unlessCondition: ['blinded'],
        // "The spell ends when all three duplicates are destroyed."
        endsWhenSpent: true,
      },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the duplicates are not in the world: three of them appearing in the caster’s space, moving with them and shifting position are the DM’s — what the engine holds is how many are left, which is the whole of what the deflection reads',
    '"The duplicates otherwise ignore all other damage and effects" is a rule about a thing nothing can aim at: no command targets a duplicate, so nothing has to bounce off one',
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
 * **The whole of the mechanical sentence is an `areaStanding`**, which is the
 * shape Spirit Guardians' halved Speed arrived in: the bonus holds "while in
 * the aura", so it is derived from the scene on every read and hung on nobody,
 * and it lapses the moment somebody steps out without an event saying so.
 *
 * Two of its clauses are the ones this spell added to that vocabulary.
 * `includesOrigin` is the glossary's "unless its creator decides otherwise" —
 * SRD excludes an Emanation's origin and this sentence says "**you** and each
 * creature you choose", so the caster is in their own aura by the text.
 * `designatesChosen` is the list the caster names at the casting, which is the
 * designation Spirit Guardians prints with its polarity turned over: that one
 * says who an aura lets alone and this says who it reaches.
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
  area: { kind: 'emanation', distance: 30, origin: 'self', includesOrigin: true },
  // "you and each creature you choose"
  designatesChosen: true,
  // Nothing fires and nothing is rolled: the aura appears and the bonus is a
  // fact about where somebody is standing from that moment on.
  effects: [],
  areaStanding: [
    // "a +10 bonus to Dexterity (Stealth) checks" — the skill names its own
    // governing ability, so the narrowing is the skill and loses nothing.
    { kind: 'bonus', applies: 'ability-check', flat: 10, only: { skill: 'stealth' } },
  ],
  durationSeconds: 3600,
  // **Nothing is handed over, and the leaving of no tracks stays a gap.** The
  // ruling hands over *printed text*, word for word, and the book prints no
  // unit that says only this: "you and each creature you choose have a +10
  // bonus to Dexterity (Stealth) checks **and leave no tracks**" is one
  // sentence whose first half the engine now executes, so handing the sentence
  // over would disown the bonus in the same breath as granting it.
  unmodelled: ['leaving no tracks is the DM’s: the engine holds no trail to leave or not leave'],
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
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  // "The area becomes Difficult Terrain for the duration." The whole of what
  // the casting itself does: the spikes' damage is the sentence after it and
  // is still blocked on the distance a move does not record.
  areaTerrain: { costPerFoot: 2 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
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
  targets: { count: 1, willing: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'none of the three benefits is granted: the +1 to AC, the +1 to saving throws and the Resistance to all damage are each ordinary, and all three hold only "While the target is within 60 feet of you" — a standing effect derived from where two creatures are standing, which nothing re-reads when either of them moves',
    'the shared damage is not dealt: "each time it takes damage, you take the same amount of damage" is a consequence of somebody else’s damage landing, and no effect answers one',
    'the two endings are not written: dropping to 0 Hit Points and drifting more than 60 feet apart are causes no `CastingEndTrigger` expresses, and neither is the recast on either of the connected creatures',
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
  // _Using a Higher-Level Spell Slot._ "The spell lasts until dispelled,
  // **without requiring Concentration**, if cast with a level 4+ spell slot."
  // One sentence, two facts the SRD moves independently, so two fields: the
  // deadline goes away and the Concentration goes with it. Both bands are the
  // same level here and are still written apart, because Bestow Curse prints
  // the second without the first.
  untilDispelledAtSlot: 4,
  concentrationEndsAtSlot: 4,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  // **Everything but the slot is handed over**, and the slot is the reason this
  // spell did not leave the ledger with Silent Image. What the image is, the
  // Cube it fits in, its sounds and smells, and the Magic action that moves a
  // thing standing in no square are the DM's; the Investigation check is
  // `check` and is rolled. The level 4+ sentence is the arithmetic, and it is
  // written now: `untilDispelledAtSlot` is the ending the slot changes and
  // `concentrationEndsAtSlot` is the hold it drops, the two halves
  // `durationAtSlot`'s table of seconds could say neither of.
  dmDecides: [
    'You create the image of an object, a creature, or some other visible phenomenon that is no larger than a 20-foot Cube.',
    "It seems real, including sounds, smells, and temperature appropriate to the thing depicted, but it can't deal damage or cause conditions.",
    'If you are within range of the illusion, you can take a Magic action to cause the image to move to any other spot within range.',
    'As the image changes location, you can alter its appearance so that its movements appear natural for the image.',
    'For example, if you create an image of a creature and move it, you can alter the image so that it appears to be walking.',
    'Similarly, you can cause the illusion to make different sounds at different times, even making it carry on a conversation, for example.',
    'Physical interaction with the image reveals it to be an illusion, for things can pass through it.',
    'If a creature discerns the illusion for what it is, the creature can see through the image, and its other sensory qualities become faint to the creature.',
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
  // **Handed over whole**, under the owner's ruling of 2026-09-24 that the
  // tracked map records clause by clause: the fact underneath every sentence
  // of this spell — a creature inside a rock — is a *place*, the engine holds
  // one scene of spaces creatures stand in, and a second kind of place is a
  // world model nobody has asked for rather than a mechanism somebody forgot.
  //
  // Three of these sentences trip a mechanical marker — the five feet, the 6d6
  // and the Prone — and each is handed over on the strength of the `'table'`
  // reading the map anchors to it, which is the one way past that guard and is
  // an argument somebody wrote down rather than an exemption.
  dmDecides: [
    'You step into a stone object or surface large enough to fully contain your body, merging yourself and your equipment with the stone for the duration.',
    'You must touch the stone to do so.',
    'Nothing of your presence remains visible or otherwise detectable by nonmagical senses.',
    "While merged with the stone, you can't see what occurs outside it, and any Wisdom (Perception) checks you make to hear sounds outside it are made with Disadvantage.",
    'You remain aware of the passage of time and can cast spells on yourself while merged in the stone.',
    'You can use 5 feet of movement to leave the stone where you entered it, which ends the spell.',
    "You otherwise can't move.",
    "Minor physical damage to the stone doesn't harm you, but its partial destruction or a change in its shape (to the extent that you no longer fit within it) expels you and deals 6d6 Force damage to you.",
    "The stone's complete destruction (or transmutation into a different substance) expels you and deals 50 Force damage to you.",
    'If expelled, you move into an unoccupied space closest to where you first entered and have the Prone condition.',
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
 * **Web with one more sentence**, and the sentence was the whole of what was
 * missing. The Cylinder is a shape the engine has, both trigger moments are
 * `AreaTrigger`'s by name, the Difficult Terrain is `areaTerrain` and the
 * Heavily Obscured air is `areaObscurement` — all of which Web already writes.
 * What had no slot was "and lose Concentration": breaking somebody's
 * Concentration is something the engine does readily and no *outcome* could
 * ask for one, so writing the save without it would have dropped half of what
 * a failure costs. `breaksConcentration` is that slot.
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
  // "a 40-foot-tall, 20-foot-radius Cylinder centered on a point you choose
  // within range" — tall and wide, in the order the book prints them.
  area: { kind: 'cylinder', radius: 20, height: 40, origin: 'point' },
  // "Ground in the Cylinder is Difficult Terrain."
  areaTerrain: { costPerFoot: 2 },
  // "The area is Heavily Obscured." Not a level of light — sleet is thick
  // rather than dim — which is why obscurement is a record of its own.
  areaObscurement: { degree: 'heavily' },
  effects: [],
  areaTrigger: {
    // "When a creature enters the Cylinder for the first time on a turn or
    // **starts its turn there**" — Web's pair exactly.
    at: 'start-of-turn',
    onEntry: 'first-per-turn',
    label: 'Sleet Storm (the sleet)',
    effects: [
      {
        kind: 'save',
        ability: 'dex',
        // "or have the Prone condition **and lose Concentration**" — one
        // failed save, both halves, and neither is writable without the
        // other: a second effect would roll a second saving throw.
        condition: 'prone',
        breaksConcentration: true,
      },
    ],
  },
  durationSeconds: 60,
  unmodelled: [
    'the exposed flames the sleet douses are the DM’s: a flame in the open is not a thing the engine holds',
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
 * it that goes **both ways**: the only spell in the book that can take
 * Difficult Terrain away as well as make it. Both directions are written now.
 * The Emanation `stays`, so the caster's square is pinned at the casting
 * and the ground stays changed when the druid walks off; which direction is
 * the caster's word, so each is a branch carrying its own `areaTerrain` — the
 * glossary's rate one way, and `clears` the other, a patch that overrides
 * whatever else lies over a space rather than a cheaper rate that would lose.
 * The conversation is the table's, in the book's words.
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
  // "an immobile 30-foot Emanation": the caster's square, pinned.
  area: { kind: 'emanation', distance: 30, origin: 'self', stays: true },
  effects: [],
  // "You can also turn Difficult Terrain caused by plant growth … into
  // ordinary terrain … Or you can turn ordinary terrain where plants are
  // present into Difficult Terrain": one Emanation, two directions, and the
  // caster's word says which. Which ground is plant-grown is the table's, as
  // which ground is thicket always has been.
  options: {
    clear: {
      label: 'Turn plant-grown Difficult Terrain into ordinary terrain',
      areaTerrain: { clears: true },
    },
    overgrow: {
      label: 'Turn ordinary terrain where plants are present into Difficult Terrain',
      areaTerrain: { costPerFoot: 2 },
    },
  },
  durationSeconds: 600,
  dmDecides: [
    'You imbue plants in an immobile 30-foot Emanation with limited sentience and animation, giving them the ability to communicate with you and follow your simple commands.',
    "You can question plants about events in the spell's area within the past day, gaining information about creatures that have passed, weather, and other circumstances.",
    "The spell doesn't enable plants to uproot themselves and move about, but they can move their branches, tendrils, and stalks for you.",
    'If a Plant creature is in the area, you can communicate with it as if you shared a common language.',
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
    'the "willing creature" clause is not transcribed here: `TargetRule.willing` is the field that gates a casting on consent, and it has been written onto the levels the ledger counts and not yet onto this one',
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
 * **The object is an equipped item and the target is whoever has it.** That is
 * the holding fact the engine keeps — a weapon in a hand or armour on a body,
 * both `equipped` — so the caster names the creature and the thing, and the
 * damage lands on the creature in contact with it. An unattended metal gate is
 * still the table's: nothing in the engine is touching it.
 *
 * **"Or drop the object if it can" is the verb that was missing.**
 * `what-a-creature-is-holding` was half built — hands are counted and a
 * casting may put a thing into one — and nothing took a thing out of one
 * against its holder's will. `OutcomeRiders.drops` is that verb, and "if it
 * can" is `handsFor`: a thing wielded in a hand is let go of, a suit of armour
 * is worn and comes off with a doffing no spell grants.
 *
 * **The two sentences are one rider**, because the second is conditional on
 * what the first did: `orElse` is the Disadvantage, hung only where the thing
 * could not be dropped. A creature that made its save keeps the object and
 * takes nothing — the drop that second sentence refers back to is the one the
 * failure demanded, and a creature never asked to drop anything has not failed
 * to. The other reading makes the saving throw buy nothing at all.
 *
 * The Bonus Action is the `activation` the record already supports, with the
 * range checked afresh and the object read off the record so a later turn
 * heats the same thing.
 */
/**
 * The 2d8 that lands on whoever is in contact with the object.
 *
 * Named because the Bonus Action deals **the same** damage again: one value in
 * two lists is what the sentence says, and two copies would be two places for
 * the dice to come apart.
 */
const HEAT_METAL_BURN: SpellEffect = {
  kind: 'auto-damage',
  damage: { dice: '2d8' },
  damageType: 'fire',
};

/**
 * The Constitution save the damage forces, and both clauses that hang on it.
 *
 * Named beside the burn above for the same reason: the later Bonus Action
 * forces the same save with the same consequences.
 */
const HEAT_METAL_GRIP: SpellEffect = {
  kind: 'save',
  ability: 'con',
  drops: {
    // "If it doesn't drop the object, it has Disadvantage on attack rolls and
    // ability checks until the start of your next turn." Two selectors because
    // a selector names one family of roll, and the deadline is the caster's
    // own next turn, which is what the sentence prints.
    orElse: [
      {
        kind: 'mode',
        modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
        lasts: 'start-of-casters-next-turn',
      },
      {
        kind: 'mode',
        modifier: { mode: 'disadvantage', selector: { roll: 'ability-check', relation: 'roller' } },
        lasts: 'start-of-casters-next-turn',
      },
    ],
  },
};

export const HEAT_METAL: SpellDefinition = {
  id: 'heat-metal',
  name: 'Heat Metal',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // The creature wearing or wielding the heated thing. Which thing is
  // `CastSpellRequest.object`, and the casting is refused before a slot is
  // spent when the target has no such thing in hand or on their back.
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [HEAT_METAL_BURN, HEAT_METAL_GRIP],
  activation: {
    action: 'bonus-action',
    // "if the object is within range" — measured afresh from the caster on
    // every later turn, which is what an activation's own range is for.
    range: { kind: 'ranged', feet: 60 },
    label: 'Heat Metal (again)',
    effects: [HEAT_METAL_BURN, HEAT_METAL_GRIP],
  },
  durationSeconds: 60,
  unmodelled: [
    'an object nobody is wearing or wielding is the DM’s: "any creature in physical contact with the object" is a touching the engine keeps no record of, and what it does keep is what a creature has equipped',
    'whether the thing chosen is manufactured, metal, and a weapon or a suit of Heavy or Medium armour is the DM’s; the catalogue records what an item is made of nowhere',
  ],
};

/**
 * SRD Flaming Sphere:
 *
 * > _Level 2 Conjuration (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a 5-foot-diameter sphere of fire in an unoccupied space on
 * > the ground within range. … Any creature that ends its turn within 5 feet
 * > of the sphere makes a Dexterity saving throw, taking 2d6 Fire damage on a
 * > failed save or half as much damage on a successful one. As a Bonus
 * > Action, you can move the sphere up to 30 feet, rolling it along the
 * > ground."
 *
 * **Spiritual Weapon's point with Web's trigger**, and the pair is what
 * `areaTrigger.within` is: the clause is measured from a point the casting
 * holds rather than over the template the casting laid, and the point is
 * rolled about on a Bonus Action by the machinery Moonbeam's beam already
 * uses.
 *
 * **The area is the light, which is Dancing Lights' reading.** The sphere
 * itself is one space of fire; what fills a volume is what it sheds — "Bright
 * Light in a 20-foot radius and Dim Light for an additional 20 feet" — so that
 * is the template, and the five feet that burn are the trigger's reach. Two
 * questions about one point, and neither is the other's radius.
 *
 * **The ram is its own clause and not the beam's.** Moonbeam's `onAreaEntry`
 * catches whoever the *area* sweeps over; this spell catches only the creature
 * whose *space* the sphere is rolled into, and then stops moving — so
 * `onPointEntry` is a second sentence rather than a spelling of the first,
 * and the route is asked for by the same rule Moonbeam's is.
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
  // "it sheds Bright Light in a 20-foot radius and Dim Light for an additional
  // 20 feet" — the one volume this spell fills, laid at the point the sphere
  // is conjured on and laid again wherever it is rolled to.
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  areaLight: { level: 'bright', dimBeyond: 20 },
  effects: [],
  // "You create a 5-foot-diameter sphere of fire in an unoccupied space on the
  // ground within range." Nothing happens at the casting: every save this
  // spell ever calls for comes from the trigger, exactly as Web's does.
  areaTrigger: {
    at: 'end-of-turn',
    within: 5,
    onPointEntry: true,
    label: 'Flaming Sphere (the sphere)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'dex',
        damage: { dice: '2d6', perSlotLevelAbove: '1d6' },
        damageType: 'fire',
        onSuccess: 'half',
      },
    ],
  },
  // "As a Bonus Action, you can move the sphere up to 30 feet, rolling it
  // along the ground." The action's entire content, which is why it carries no
  // effects and aims at nobody.
  activation: {
    action: 'bonus-action',
    movesArea: 30,
    label: 'Flaming Sphere (the sphere rolls)',
    effects: [],
  },
  durationSeconds: 60,
  unmodelled: [
    'the ground it is conjured on, the unoccupied space it needs, the barriers up to 5 feet tall it is directed over, the pits up to 10 feet wide it jumps and the flammable objects it sets alight are the DM’s',
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
 * **Three shapes in one spell, and each of them arrived with it.** The save is
 * a fork rather than a gate — succeeding at it costs the target something,
 * which is what `save.onSuccessRiders` is for; "Strength-based D20 Tests" is
 * one sentence over three families, which is `RollSelector`'s `d20-test`
 * narrowed by an ability; and the 1d8 is a grant on the creature's **own**
 * damage rolls, which is the twentieth sourced grant and the mirror of the
 * reduction SRD Resistance hangs on a defender.
 *
 * **The repeat has no condition to be filed on**, because the failure hands
 * out grants and imposes none — so it rides on the casting's own deadline,
 * exactly as SRD Searing Smite's does, and "ending the spell on a success" is
 * `end-casting` in as many words.
 *
 * **The success's Disadvantage is spent by the roll it reaches**, which is
 * Guiding Bolt's and Vicious Mockery's shape one relation over: `oneShot`
 * ends it at the swing, and `lasts` ends it at the start of the caster's next
 * turn if no swing comes. Both endings stand and the first to arrive wins.
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
  effects: [
    {
      kind: 'save',
      ability: 'con',
      // "On a failed save, the target has Disadvantage on Strength-based D20
      // Tests for the duration. During that time, it also subtracts 1d8 from
      // all its damage rolls." One save, two grants, no condition — SRD
      // Slow's shape, with a family of rolls where Slow has an Armour Class.
      modifiers: [
        {
          kind: 'mode',
          modifier: {
            mode: 'disadvantage',
            selector: { roll: 'd20-test', relation: 'roller', ability: 'str' },
          },
        },
        { kind: 'damage-penalty', dice: '1d8' },
      ],
      // "The target repeats the save at the end of each of its turns, ending
      // the spell on a success." No condition was imposed, so the hook rides
      // on the casting's own deadline and a success ends the spell outright.
      repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
      // "On a successful save, the target has Disadvantage on the next attack
      // roll it makes until the start of your next turn." The roll that meets
      // it spends it; the caster's next turn beginning ends it if none does.
      onSuccessRiders: {
        modifiers: [
          {
            kind: 'mode',
            modifier: {
              mode: 'disadvantage',
              selector: { roll: 'attack', relation: 'roller' },
              oneShot: true,
            },
            lasts: 'start-of-casters-next-turn',
          },
        ],
      },
    },
  ],
  durationSeconds: 60,
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
 * > _Level 4 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
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
 * **And the eruption is the complement of that choice**, which is the one
 * thing here the engine had to be taught rather than told. The caster states
 * the type they want Resistance to; the flames are the *other* of the two the
 * book prints. `damageTypeStated` carries a choice into every effect that
 * names a type and cannot invert one, and a rule that inverted it by naming
 * this spell is exactly what the catalogue sweep exists to refuse. So the pair
 * is printed here and `complementOf` is the engine's statement about a two-way
 * choice rather than about a spell.
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
  effects: [
    { kind: 'damage-defense', damageTypes: ['cold'], defense: 'resistant' },
    {
      kind: 'passive-defense',
      // The placeholder the casting's choice is written over, exactly as the
      // Resistance above it carries one. What the flames deal is the member of
      // the pair that was *not* stated.
      damageType: 'cold',
      defense: {
        kind: 'retaliation',
        damage: '2d8',
        melee: true,
        withinFeet: 5,
        complementOf: ['cold', 'fire'],
      },
    },
  ],
  durationSeconds: 600,
  unmodelled: [
    'the Bright Light in a 10-foot radius and the Dim Light beyond it are the DM’s; the engine has no lighting',
  ],
};

/**
 * SRD Guardian of Faith:
 *
 * > _Level 4 Conjuration (Cleric)._ **Casting Time:** Action.
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
 * > _Level 5 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action.
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

/**
 * SRD Thaumaturgy:
 *
 * > _Transmutation Cantrip (Cleric)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Up to 1 minute.
 * > "You manifest a minor wonder within range. You create one of the effects
 * > below within range. If you cast this spell multiple times, you can have up
 * > to three of its 1-minute effects active at a time."
 * > _Booming Voice._ "Your voice booms up to three times as loud as normal for
 * > 1 minute. For the duration, you have Advantage on Charisma (Intimidation)
 * > checks."
 *
 * **The cantrip that is one branch away from being executed**, and the branch
 * is the half of `choiceStated` that does not exist. Five of its six wonders
 * are fiction — eyes, flames, a door, a sound, tremors — and the sixth grants
 * a mode `roll-modifiers.ts` writes exactly.
 *
 * **What a stated choice does is substitute a value into an effect that is
 * already in the list; what this spell needs is a choice of *which effects
 * run*.** Blindness/Deafness prints two conditions for one save, Guidance
 * eighteen skills for one bonus, Enhance Ability five abilities for one mode:
 * every one of them is one effect wearing a different value. Booming Voice is
 * a `roll-mode` the other five wonders do not have at all, so a definition
 * that carried it would boom the caster's voice every time they flickered a
 * candle — the failure this docstring named before the field existed, and
 * which the field does not fix. Enlarge/Reduce and Glyph of Warding print the
 * same shape, which is what makes it a shape rather than this cantrip's
 * problem.
 */
export const THAUMATURGY: SpellDefinition = {
  id: 'thaumaturgy',
  name: 'Thaumaturgy',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  // "**You** have Advantage on Charisma (Intimidation) checks": the caster and
  // nobody else, which is the one target rule that hands Booming Voice's mode a
  // creature without letting a cleric boom an ally's voice. The other five
  // wonders happen within range and on nobody, and the caster names themselves
  // for those too — the whole spell is a wonder the caster manifests.
  targets: { count: 1, self: true, casterOnly: true },
  effects: [],
  // "You create **one** of the effects below": six branches, of which the
  // casting runs one and records which.
  options: {
    'altered-eyes': {
      label: 'Altered Eyes',
      handsOver: ['Altered Eyes. You alter the appearance of your eyes for 1 minute.'],
    },
    'booming-voice': {
      label: 'Booming Voice',
      // "Your voice booms up to three times as loud as normal for 1 minute" is
      // the fiction; the sentence after it is the mode.
      handsOver: ['Booming Voice. Your voice booms up to three times as loud as normal for 1 minute.'],
      effects: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'advantage',
            // "Charisma (Intimidation) checks" — the pair a selector already
            // carries, on the caster, who is this spell's only target.
            selector: {
              roll: 'ability-check',
              relation: 'roller',
              ability: 'cha',
              skill: 'intimidation',
            },
          },
        },
      ],
    },
    'fire-play': {
      label: 'Fire Play',
      handsOver: [
        'Fire Play. You cause flames to flicker, brighten, dim, or change color for 1 minute.',
      ],
    },
    'invisible-hand': {
      label: 'Invisible Hand',
      handsOver: [
        'Invisible Hand. You instantaneously cause an unlocked door or window to fly open or slam shut.',
      ],
    },
    'phantom-sound': {
      label: 'Phantom Sound',
      handsOver: [
        'Phantom Sound. You create an instantaneous sound that originates from a point of your choice within range, such as a rumble of thunder, the cry of a raven, or ominous whispers.',
      ],
    },
    tremors: {
      label: 'Tremors',
      handsOver: ['Tremors. You cause harmless tremors in the ground for 1 minute.'],
    },
  },
  durationSeconds: 60,
  // "If you cast this spell multiple times, you can have up to three of its
  // 1-minute effects active at a time" — Prestidigitation's sentence with a
  // different word for the same number, and the same field answers it.
  maxRunning: 3,
  unmodelled: [
    'the cap counts every casting rather than only the four wonders that last a minute: the two the book calls instantaneous leave a record here as the other four do, so a door flung open counts against the three',
  ],
};

/**
 * The six creature types SRD Protection from Evil and Good wards against.
 *
 * Written once and read by both benefits, because the spell's first sentence
 * names them once and the two clauses after it both say "them": two copies
 * would be two places for one printed list to be got wrong.
 */
const WARDED_AGAINST = [
  'Aberration',
  'Celestial',
  'Elemental',
  'Fey',
  'Fiend',
  'Undead',
] as const;

/**
 * SRD Protection from Evil and Good:
 *
 * > _Level 1 Abjuration (Cleric, Druid, Paladin, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "Until the spell ends, one willing creature you touch is protected against
 * > creatures that are Aberrations, Celestials, Elementals, Fey, Fiends, or
 * > Undead. The protection grants several benefits. Creatures of those types
 * > have Disadvantage on attack rolls against the target. The target also can't
 * > be possessed by or gain the Charmed or Frightened conditions from them. If
 * > the target is already possessed, Charmed, or Frightened by such a creature,
 * > the target has Advantage on any new saving throw against the relevant
 * > effect."
 *
 * **Three benefits and one word used to ruin all three: *them*.** Every clause
 * is a mechanic the engine has — a mode on an attack roll, an Immunity to two
 * named conditions, a mode on a save — and every one of them is narrowed to
 * the six creature types the first sentence names. Writing any of them
 * unqualified would protect the target from its own party, which is the
 * confident wrong answer rather than the missing one.
 *
 * **Two of the three carry the qualification now.** `RollSelector` has an axis
 * for the **attacker's** type, read off the creature rolling exactly as SRD
 * says a spell reads a type; and a granted condition Immunity may name the
 * types it holds against, which the door that applies a condition asks about
 * whatever is causing it. A Ghoul swings at Disadvantage and a bandit swings
 * normally; the Ghoul cannot frighten the target and the bandit can.
 *
 * **The third is still a debt and says so.** "The target has Advantage on any
 * new saving throw against the relevant effect" needs a save to remember what
 * it was against, which is the gap `CLAUDE.md` has recorded since
 * Countercharm; and possession is not a state the engine holds at all. Both
 * are `unmodelled` rather than handed over, because both are rules the engine
 * would execute the day it could — a handover is for a sentence nobody will
 * ever build.
 */
export const PROTECTION_FROM_EVIL_AND_GOOD: SpellDefinition = {
  id: 'protection-from-evil-and-good',
  name: 'Protection from Evil and Good',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  effects: [
    // "Creatures of those types have Disadvantage on attack rolls against the
    // target" — a mode on rolls made **against** the holder, narrowed by what
    // the creature making them is.
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'disadvantage',
        selector: {
          roll: 'attack',
          relation: 'against-holder',
          attackerType: WARDED_AGAINST,
        },
      },
    },
    // "The target also can't be ... gain the Charmed or Frightened conditions
    // from them" — the same six types, on the other reader.
    {
      kind: 'condition-immunity',
      conditions: ['charmed', 'frightened'],
      fromTypes: WARDED_AGAINST,
    },
  ],
  durationSeconds: 600,
  unmodelled: [
    'the target does not gain Advantage on any new saving throw against the relevant effect: nothing records what a save was against, so the mode could not find the saves it belongs to',
    'the clause that the target can’t be possessed by such a creature is not applied: possession is not a state the engine holds, so there is nothing for the protection to refuse',
  ],
};

/**
 * SRD Unseen Servant:
 *
 * > _Level 1 Conjuration (Bard, Warlock, Wizard) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** 60 feet.
 * > **Duration:** 1 hour.
 * > "This spell creates an Invisible, mindless, shapeless, Medium force that
 * > performs simple tasks at your command until the spell ends. The servant
 * > springs into existence in an unoccupied space on the ground within range.
 * > It has AC 10, 1 Hit Point, and a Strength of 2, and it can't attack. If it
 * > drops to 0 Hit Points, the spell ends."
 *
 * > "Once on each of your turns as a Bonus Action, you can mentally command
 * > the servant to move up to 15 feet and interact with an object. … If you
 * > command the servant to perform a task that would move it more than 60
 * > feet away from you, the spell ends."
 *
 * **A stat block in one sentence, and the sentence is the block.** The owner's
 * ruling files a spell-internal block in the bestiary, and this is the one the
 * bestiary could not take without inventing an ability table, a Speed and a
 * type the book never printed — so the `summon` effect carries it `inline`,
 * exactly as printed, and the resolver adapts it through the same road a
 * bestiary block takes. The servant is a creature: AC 10 to hit, 1 Hit Point to
 * lose, a Strength of 2 to save with, Medium on the map, Invisible from the
 * condition vocabulary under the casting's own source, forbidden the Attack
 * action by the same rule Find Familiar's familiar is, held by the casting for
 * its hour and taken away when the hour ends. "If it drops to 0 Hit Points, the
 * spell ends" is `summon-drops-to-0`, the fifth cause a casting's own record
 * can end on — read of the creature the casting is sustaining, the way Phantom
 * Steed's blow is.
 *
 * **What is moved is the servant, and the DM moves it.** The Bonus Action
 * command is the DM's move command on the servant plus an object interaction
 * the table narrates; what the engine does not yet do is charge the caster's
 * Bonus Action for it or end the spell at sixty feet, both of which are said
 * below rather than assumed.
 */
export const UNSEEN_SERVANT: SpellDefinition = {
  id: 'unseen-servant',
  name: 'Unseen Servant',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  // The spell is on its caster and what it makes is a second creature, which
  // is the shape every summons takes: the printed Range is the reach the
  // servant springs into rather than a reach to a target.
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'summon',
      // "an Invisible, mindless, shapeless, Medium force … It has AC 10, 1
      // Hit Point, and a Strength of 2, and it can't attack." Every field the
      // sentence does not print is left unprinted — see `InlineStatBlock`.
      inline: {
        name: 'Unseen Servant',
        armorClass: 10,
        hitPoints: 1,
        abilities: { str: 2 },
        size: 'medium',
        conditions: ['invisible'],
      },
      cannotAttack: true,
    },
  ],
  durationSeconds: 3600,
  // "If it drops to 0 Hit Points, the spell ends" — the whole casting, which is
  // what then takes the fallen servant away.
  endsEarly: [{ on: 'summon-drops-to-0', ends: 'casting' }],
  unmodelled: [
    'the spell does not end when a command would take the servant more than 60 feet from the caster: that is a distance the engine can measure after the servant’s move and does not yet read at the move command, which another track owns',
    'the Bonus Action the command costs its caster is not spent: the servant is moved by the DM’s move command on the servant itself, and the caster’s own economy is not charged for issuing the order',
    'what the servant fetches, cleans, mends, folds, lights, serves or pours is the DM’s and always will be',
  ],
};

/**
 * SRD Alter Self:
 *
 * > _Level 2 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 hour.
 * > "You alter your physical form. Choose one of the following options. Its
 * > effects last for the duration, during which you can take a Magic action to
 * > replace the option you chose with a different one."
 * > _Aquatic Adaptation._ "You can breathe underwater and gain a Swim Speed
 * > equal to your Speed."
 * > _Natural Weapons._ "When you use your Unarmed Strike to deal damage with
 * > that new growth, it deals 1d6 damage of the type in parentheses instead of
 * > dealing the normal damage for your Unarmed Strike."
 *
 * Three branches, chosen at the casting and swapped on a later Magic action —
 * and all three are written. **Aquatic Adaptation** is a Swim Speed that
 * matches the walking Speed, the `match-walk` member the vocabulary grew for
 * exactly this sentence; the gills are the table's. **Change Appearance** is
 * handed over whole. **Natural Weapons** is a `weapon-rider` on the Unarmed
 * Strike — `unarmed`, because a fist has no id to name — with its die, the type
 * the caster stated (`damageTypeStated`, substituted into the rider and pinned)
 * and the spellcasting ability **imposed** rather than offered, because the
 * book says "instead" and "rather than". And **the swap is `reoptions`**: a
 * Magic action that names a different branch, releases what the casting hung
 * on its caster and runs the new branch off the record's own numbers.
 */
export const ALTER_SELF: SpellDefinition = {
  id: 'alter-self',
  name: 'Alter Self',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  // On the caster, which is who a Range: Self spell alters.
  targets: { count: 1, self: true },
  // "claws (Slashing), fangs (Piercing), horns (Piercing), or hooves
  // (Bludgeoning)": the growth is the caster's, stated at the casting and
  // asked for only where the branch holds a slot for it.
  damageTypeStated: ['slashing', 'piercing', 'bludgeoning'],
  effects: [],
  options: {
    'aquatic-adaptation': {
      label: 'Aquatic Adaptation',
      // "gain a Swim Speed equal to your Speed".
      effects: [{ kind: 'speed', change: 'match-walk', mode: 'swim' }],
      handsOver: ['You sprout gills and grow webs between your fingers.'],
      unmodelled: [
        'breathing underwater is the table’s: the engine holds no water and nothing drowns in it',
      ],
    },
    'change-appearance': {
      label: 'Change Appearance',
      handsOver: [
        'You alter your appearance.',
        'You decide what you look like, including your height, weight, facial features, sound of your voice, hair length, coloration, and other distinguishing characteristics.',
        'You can make yourself appear as a member of another species, though none of your statistics change.',
        "You can't appear as a creature of a different size, and your basic shape stays the same; if you're bipedal, you can't use this spell to become quadrupedal, for instance.",
        'For the duration, you can take a Magic action to change your appearance in this way again.',
      ],
    },
    'natural-weapons': {
      label: 'Natural Weapons',
      effects: [
        {
          kind: 'weapon-rider',
          // "When you use your Unarmed Strike": the fist, not a weapon.
          unarmed: true,
          // "it deals 1d6 damage of the type in parentheses instead of dealing
          // the normal damage for your Unarmed Strike": the die replaces the
          // fist's, and the type is the stated growth's — the default is the
          // slot `statedDamageType` fills.
          die: '1d6',
          damageType: 'slashing',
          // "you use your spellcasting ability modifier for the attack and
          // damage rolls rather than using Strength": imposed, not offered.
          castingAbility: true,
          imposesAbility: true,
        },
      ],
    },
  },
  // "you can take a Magic action to replace the option you chose with a
  // different one".
  activation: { action: 'action', reoptions: true, effects: [], label: 'Alter Self (a new form)' },
  durationSeconds: 3600,
};

/**
 * SRD Augury:
 *
 * > _Level 2 Divination (Cleric, Druid, Wizard) (Ritual)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Self.
 * > **Duration:** Instantaneous.
 * > "You receive an omen from an otherworldly entity about the results of a
 * > course of action that you plan to take within the next 30 minutes. The GM
 * > chooses the omen from the Omens table."
 * > "If you cast the spell more than once before finishing a Long Rest, there
 * > is a cumulative 25 percent chance for each casting after the first that you
 * > get no answer."
 *
 * The omen is the GM's by the book's own word. What is not the GM's is the
 * percentage: a cumulative 25 per cent per casting since the last Long Rest
 * was two things the engine could not do — throw a die that is not a d20, and
 * count castings back to a rest — and it is the `chance` effect now.
 *
 * **And the two are filed apart, which is Commune's ruling arriving on the
 * spell it was written from.** The omen sat in `unmodelled` saying in its own
 * words that it was the GM's — a debt nobody may ever pay, on the list of
 * debts somebody might, inflating a blocker map with an entry blocked on
 * nothing. There is no engine that chooses an omen. It is handed over instead,
 * in the book's own words; the percentage decides whether the handover goes
 * out at all.
 *
 * **The count is kept under the spell's own id and empties on a Long Rest**,
 * which is the book's own bracket — "before finishing a Long Rest" — and the
 * same `Tally` a Wind Fan's uses are counted in. The first casting after a
 * rest throws no die, because "each casting after the first" makes it a
 * decided outcome and a die thrown for one moves the generator for nothing.
 *
 * **Range: Self, and the caster is the target.** The spell is on whoever cast
 * it and reaches nobody else; naming the caster is what every other self spell
 * in the catalogue does, and it is what gives the effect list a creature to
 * run against.
 */
export const AUGURY: SpellDefinition = {
  id: 'augury',
  name: 'Augury',
  level: 2,
  school: 'divination',
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'chance',
      // "a cumulative 25 percent chance for each casting after the first",
      // counted "before finishing a Long Rest".
      percent: { perPriorCasting: 25, countedBy: { key: 'augury', recovers: 'long-rest' } },
      // "that you get no answer": the casting happened and the slot is gone,
      // and what the caster does not get is the omen — so the printed text
      // this definition hands the table does not go out for that casting.
      onFailure: 'no-answer',
    },
  ],
  dmDecides: [
    'You receive an omen from an otherworldly entity about the results of a course of action that you plan to take within the next 30 minutes.',
    'The GM chooses the omen from the Omens table.',
    "The spell doesn't account for circumstances, such as other spells, that might change the results.",
  ],
};

/**
 * SRD Dragon's Breath:
 *
 * > _Level 2 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Bonus Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "You touch one willing creature, and choose Acid, Cold, Fire, Lightning, or
 * > Poison. Until the spell ends, the target can take a Magic action to exhale
 * > a 15-foot Cone. Each creature in that area makes a Dexterity saving throw,
 * > taking 3d6 damage of the chosen type on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 2."
 *
 * The Cone, the Dexterity save and the halved damage are all ordinary. What is
 * not is who breathes and what the action does: an activation belongs to the
 * caster and this one belongs to the creature they touched, and every
 * registered activation resolves an attack or moves an area rather than
 * evoking a fresh one.
 */
export const DRAGONS_BREATH: SpellDefinition = {
  id: 'dragons-breath',
  name: "Dragon's Breath",
  level: 2,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, willing: true },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'nobody exhales: the Magic action that breathes the Cone is taken by the creature the caster touched, and a spell’s later action is the caster’s — nobody else may act through a casting',
    'so the 15-foot Cone is never resolved either, and with it the Dexterity saving throw and the 3d6 of the chosen type, half as much on a success, growing by 1d6 for each slot level above 2',
    'which of Acid, Cold, Fire, Lightning or Poison was chosen is not recorded, because there is nothing left for the choice to type',
  ],
};

/**
 * SRD Silence:
 *
 * > _Level 2 Illusion (Bard, Cleric, Ranger) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, no sound can be created within or pass through a
 * > 20-foot-radius Sphere centered on a point you choose within range. Any
 * > creature or object entirely inside the Sphere has Immunity to Thunder
 * > damage, and creatures have the Deafened condition while entirely inside it.
 * > Casting a spell that includes a Verbal component is impossible there."
 *
 * **Three sentences about one Sphere, and they are what made `areaStanding` a
 * list.** Each is derived from where a creature is standing right now: the
 * Immunity belongs to whoever is entirely inside at the moment the damage
 * lands, the Deafened lasts "while entirely inside it" and no event applies or
 * removes it, and the casting the Sphere forbids is a refusal read at the one
 * moment somebody speaks. Two of them print "entirely inside" and the third
 * prints "there", which is why that narrowing is a field on the clause.
 */
export const SILENCE: SpellDefinition = {
  id: 'silence',
  name: 'Silence',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  ritual: true,
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [],
  areaStanding: [
    // "Any creature or object entirely inside the Sphere has Immunity to
    // Thunder damage."
    { kind: 'damage-defense', defense: 'immune', damageTypes: ['thunder'], whollyInside: true },
    // "creatures have the Deafened condition while entirely inside it"
    { kind: 'condition', condition: 'deafened', whollyInside: true },
    // "Casting a spell that includes a Verbal component is impossible there."
    // "There", and not "entirely inside": the same paragraph writes both.
    { kind: 'no-verbal-casting' },
  ],
  durationSeconds: 600,
  dmDecides: [
    'For the duration, no sound can be created within or pass through a 20-foot-radius Sphere centered on a point you choose within range.',
  ],
};

/**
 * SRD Animate Dead:
 *
 * > _Level 3 Necromancy (Cleric, Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** 10 feet. **Duration:** Instantaneous.
 * > "Choose a pile of bones or a corpse of a Medium or Small Humanoid within
 * > range. The target becomes an Undead creature: a **Skeleton** if you chose
 * > bones or a **Zombie** if you chose a corpse (see "Monsters" for the stat
 * > blocks). On each of your turns, you can take a Bonus Action to mentally
 * > command any creature you made with this spell if the creature is within 60
 * > feet of you."
 * > _Using a Higher-Level Spell Slot._ "You animate or reassert control over
 * > two additional Undead creatures for each spell slot level above 3."
 *
 * **Not one sentence of it trips a marker and every sentence of it is the
 * DM's**, which is a combination worth writing down: the spell's whole content
 * is a creature the engine cannot add to the scene and a command structure over
 * it. What is real is the rite, the ten feet and the slot.
 */
export const ANIMATE_DEAD: SpellDefinition = {
  id: 'animate-dead',
  name: 'Animate Dead',
  level: 3,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'no Skeleton and no Zombie appear: a stat block out of the monster list is still a creature added to the scene mid-fight, which no casting does',
    'the target is "a pile of bones or a corpse of a Medium or Small Humanoid", which is an object and a size and a type on something that is not a creature — the format selects creatures by type, and nothing selects a corpse',
    'so the Bonus Action that commands them, the 60 feet it reaches, the 24 hours of control, the recasting that reasserts it over up to four, and the two more per slot level above 3 are all the DM’s',
  ],
};

/**
 * SRD Blink:
 *
 * > _Level 3 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 1 minute.
 * > "Roll 1d6 at the end of each of your turns for the duration. On a roll of
 * > 4–6, you vanish from your current plane of existence and appear in the
 * > Ethereal Plane (the spell ends instantly if you are already on that
 * > plane)."
 * > "You return to the other plane at the start of your next turn and when the
 * > spell ends if you are on the Ethereal Plane. You return to an unoccupied
 * > space of your choice that you can see within 10 feet of the space you
 * > left."
 *
 * A d6 at a turn boundary deciding which of two planes the caster is on: the
 * die is one no effect can ask for, and the plane is a second place the engine
 * has nowhere to put anybody.
 */
export const BLINK: SpellDefinition = {
  id: 'blink',
  name: 'Blink',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  // Range: Self, so the caster is the target and the ten feet are the
  // return's own rather than a reach to somebody else — Misty Step's split.
  targets: { count: 1, self: true },
  // "Roll 1d6 at the end of each of your turns. On a roll of 4–6, you vanish
  // … and appear in the Ethereal Plane. At the start of your next turn …
  // you return to an unoccupied space of your choice that you can see within
  // 10 feet of the space you vanished from." The boundary throws the book's
  // die and sends the caster on its top half; the return asks for the space
  // unless exactly one qualifies, and "when the spell ends" is the stranded
  // return the turn refuses to advance past.
  effects: [
    {
      kind: 'elsewhere',
      where: 'ethereal',
      at: 'end-of-turn',
      chance: { die: '1d6', onOrAbove: 4 },
      returns: { within: 10, requiresSight: true, at: 'start-of-turn' },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'what the caster can perceive of the plane they left, and who can perceive them, are the DM’s: "cast in shades of gray", and the Ethereal Plane’s own sights and sounds, describe a place the engine holds nothing of',
  ],
};

/**
 * SRD Phantom Steed:
 *
 * > _Level 3 Illusion (Wizard) (Ritual)._ **Casting Time:** 1 minute or Ritual.
 * > **Range:** 30 feet. **Duration:** 1 hour.
 * > "A Large, quasi-real, horselike creature appears on the ground in an
 * > unoccupied space of your choice within range. ... The steed uses the Riding
 * > Horse stat block (see "Monsters"), except it has a Speed of 100 feet and
 * > can travel 13 miles in an hour. ... The spell ends early if the steed takes
 * > any damage."
 *
 * A stat block with one number changed, which is now a stat block: the owner's
 * ruling of 2026-09-21 files a spell-internal block as a catalogue entry, so
 * the steed is `phantom-steed` in the bestiary — the parsed Riding Horse with
 * the Speed the spell prints — and the casting raises it through the `summon`
 * effect kind.
 *
 * **The hour holds it here.** The casting leaves an ongoing record, the steed
 * is bound to it, and when the hour is up `strandedSummons` says the steed is
 * owed a departure and `dismissStrandedSummons` performs it. That is the whole
 * of "when the spell ends, the steed gradually fades"; the minute the rider
 * has to dismount is narration over it.
 */
export const PHANTOM_STEED: SpellDefinition = {
  id: 'phantom-steed',
  name: 'Phantom Steed',
  level: 3,
  school: 'illusion',
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  // The spell is on its caster and what it makes is a second creature, which
  // is the shape Dimension Door already takes: the printed Range is the reach
  // the steed appears within rather than a reach to a target.
  targets: { count: 1, self: true },
  effects: [{ kind: 'summon', monster: 'phantom-steed' }],
  durationSeconds: 3600,
  // "the spell ends if the steed takes any damage" — the whole casting, not a
  // release on the steed: there is nothing hung on the steed to release, and
  // the hour ending is what sends it away.
  endsEarly: [{ on: 'summon-takes-damage', ends: 'casting' }],
  unmodelled: [
    'the saddle, bit and bridle, their puff of smoke ten feet from the steed, the thirteen miles in an hour and the minute the rider has to dismount are the DM’s',
    'who sits on it — "you or a creature you choose can ride the steed" — is the table’s; the engine seats nobody on a mount',
  ],
};

/**
 * SRD Plant Growth:
 *
 * > _Level 3 Transmutation (Bard, Druid, Ranger)._
 * > **Casting Time:** Action (Overgrowth) or 8 hours (Enrichment).
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > _Overgrowth._ "Choose a point within range. All normal plants in a
 * > 100-foot-radius Sphere centered on that point become thick and overgrown. A
 * > creature moving through that area must spend 4 feet of movement for every 1
 * > foot it moves."
 * > _Enrichment._ "All plants in a half-mile radius centered on a point within
 * > range become enriched for 365 days."
 *
 * **A casting time that is two casting times**, and the oracle reads the first:
 * the Action is Overgrowth and the eight hours are Enrichment, and a definition
 * holds one bucket. So the Action branch is what is cast, and the other is said
 * plainly rather than silently dropped.
 */
export const PLANT_GROWTH: SpellDefinition = {
  id: 'plant-growth',
  name: 'Plant Growth',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 100, origin: 'point' },
  effects: [],
  // "The casting time you use determines whether the spell has the Overgrowth
  // or the Enrichment effect below." The branch is spoken as any other is, and
  // it carries the casting time with it: an Action for the thick ground, eight
  // hours for the year of doubled harvests.
  options: {
    overgrowth: {
      label: 'Overgrowth',
      castingTime: 'action',
      // "must spend 4 feet of movement for every 1 foot it moves" — the rate the
      // book prints for itself, which is why the field is a number and not a
      // flag. **Instantaneous**, so the casting leaves no record and the patch
      // names none: the plants are thick now and SRD gives them no ending.
      areaTerrain: { costPerFoot: 4 },
    },
    enrichment: {
      label: 'Enrichment',
      // "**Casting Time:** Action (Overgrowth) or **8 hours** (Enrichment)."
      castingTime: 'long',
      castingSeconds: 8 * 60 * 60,
      // A year of better harvests over half a mile, and no rule reads any of
      // it: the engine holds no crops, no acreage and no calendar of what a
      // field has already had cast on it.
      handsOver: [
        'All plants in a half-mile radius centered on a point within range become enriched for 365 days.',
        'The plants yield twice the normal amount of food when harvested.',
        'They can benefit from only one Plant Growth per year.',
      ],
    },
  },
  unmodelled: [
    'the areas the caster excludes from the Sphere are the DM’s, and so is every word about what the plants look like',
  ],
};

/**
 * SRD Revivify:
 *
 * > _Level 3 Necromancy (Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "You touch a creature that has died within the last minute. That creature
 * > revives with 1 Hit Point. This spell can't revive a creature that has died
 * > of old age, nor does it restore any missing body parts."
 *
 * Three sentences, and the middle one is a rule the engine refuses by design:
 * `healCreature` will not heal a corpse, and the refusal costs no slot. Reviving
 * is not healing with a small number in it — so it is its own effect kind and
 * its own event, which is the whole of `healing-that-raises-the-dead`.
 *
 * **The minute is subtraction.** `Vitals.diedAt` is the clock instant a
 * creature stopped being alive, derived by the fold from the fact itself
 * rather than from any one of the four events that can kill somebody, and
 * `state.elapsed` is now. A corpse older than sixty seconds is refused before
 * the slot is spent, and so is a creature who is standing up.
 *
 * What is left is what the spell says it leaves: a creature that died of old
 * age, and the body parts it does not restore. Neither is a fact the engine
 * holds, and holding one would not settle either.
 */
export const REVIVIFY: SpellDefinition = {
  id: 'revivify',
  name: 'Revivify',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [{ kind: 'revive', within: 60, hitPoints: 1 }],
  unmodelled: [
    'whether the creature died of old age is the DM’s, and the engine holds no such cause: a corpse the table says died of age is one the table declines to let this spell touch',
    'the body parts the spell does not restore are the DM’s; the engine holds no anatomy for one to be missing from',
  ],
};

/**
 * SRD Wind Wall:
 *
 * > _Level 3 Evocation (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "A wall of strong wind rises from the ground at a point you choose within
 * > range. You can make the wall up to 50 feet long, 15 feet high, and 1 foot
 * > thick. ... When the wall appears, each creature in its area makes a Strength
 * > saving throw, taking 4d8 Bludgeoning damage on a failed save or half as much
 * > damage on a successful one."
 *
 * The save and the halved damage are the most ordinary shape in the book; the
 * *area* is the seventh template, and it is the only one the caster **draws**.
 * A Sphere's radius is the whole of its shape and fifty feet of wall bent
 * around a corner is not — so `area.length` is a bound rather than a size, and
 * the path is stated at the cast and judged there: the total length, the
 * continuity, the one ground it runs along, and the Range to the space it
 * rises from.
 *
 * **It asks once, which is what the book asks.** "When the wall appears, each
 * creature in its area makes a Strength saving throw" is a casting effect, and
 * nothing in this spell's text asks again — so the path is not pinned on the
 * record and no later clause may hang on it, which `checkSpellDefinition`
 * refuses outright rather than leaving to be discovered.
 *
 * The thickness is narration: the smallest thing the lattice holds is a
 * 5-foot space, so a wall occupies the spaces its path names and one foot is
 * a description of what is in them.
 */
export const WIND_WALL: SpellDefinition = {
  id: 'wind-wall',
  name: 'Wind Wall',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  // "up to 50 feet long, 15 feet high" — both bounds, and the caster's stated
  // path is held to the first of them.
  area: { kind: 'wall', length: 50, height: 15, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'str',
      damage: { dice: '4d8' },
      damageType: 'bludgeoning',
      onSuccess: 'half',
    },
  ],
  areaStanding: [
    // "Small or smaller flying creatures or objects can't pass through the
    // wall." A step into one of the wall's spaces, made with a Fly Speed.
    { kind: 'bars-passage', to: { sizeAtMost: 'small', flying: true }, crossing: 'in' },
    // "Arrows, bolts, and other ordinary projectiles launched at targets
    // behind the wall are deflected upward and miss automatically."
    { kind: 'deflects-projectiles' },
    // "Creatures in gaseous form can't pass through it."
    { kind: 'bars-passage', to: 'gaseous', crossing: 'in' },
  ],
  durationSeconds: 60,
  unmodelled: [
    'objects are not in the scene: a Small flying object turned back, and a hurled boulder let through, are the DM’s — a stat block’s printed line does not say whether it looses an arrow or a boulder, so that shot is made and the wall reported beside it rather than deflecting it',
    'fog, smoke and gases kept at bay, and loose lightweight material flying upward, are the DM’s',
  ],
};

/**
 * SRD Divination:
 *
 * > _Level 4 Divination (Cleric, Druid, Wizard) (Ritual)._
 * > **Casting Time:** Action or Ritual. **Range:** Self.
 * > **Duration:** Instantaneous.
 * > "This spell puts you in contact with a god or a god's servants. You ask one
 * > question about a specific goal, event, or activity to occur within 7 days.
 * > The GM offers a truthful reply, which might be a short phrase or cryptic
 * > rhyme."
 * > "If you cast the spell more than once before finishing a Long Rest, there is
 * > a cumulative 25 percent chance for each casting after the first that you get
 * > no answer."
 *
 * The answer is the GM's in the book's own words. Augury's percentage, on a
 * bigger slot — and Augury's filing too: the reply is handed to the table and
 * the percentage stays a debt.
 *
 * **The first handover on an Action casting**, which is where the limit shows.
 * `spell-cast` carries no text, so this one reaches the caller that cast it and
 * not the log; the nine long rites pin theirs into `spell-declared`. That is
 * the limit `unmodelled` has always had and this inherits.
 */
export const DIVINATION: SpellDefinition = {
  id: 'divination',
  name: 'Divination',
  level: 4,
  school: 'divination',
  castingTime: 'action',
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  dmDecides: [
    "This spell puts you in contact with a god or a god's servants.",
    'You ask one question about a specific goal, event, or activity to occur within 7 days.',
    'The GM offers a truthful reply, which might be a short phrase or cryptic rhyme.',
    "The spell doesn't account for circumstances that might change the answer, such as the casting of other spells.",
  ],
  unmodelled: [
    'the "cumulative 25 percent chance for each casting after the first" is not rolled: no effect asks the generator for a die that is not a d20, and nothing counts this caster’s castings back to their last Long Rest',
  ],
};

/**
 * SRD Secret Chest:
 *
 * > _Level 4 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Until dispelled.
 * > "You hide a chest and all its contents on the Ethereal Plane. ... While the
 * > chest remains on the Ethereal Plane, you can take a Magic action and touch
 * > the replica to recall the chest. ... After 60 days, there is a cumulative 5
 * > percent chance at the end of each day that the spell ends. The spell also
 * > ends if you cast this spell again or if the Tiny replica chest is
 * > destroyed."
 *
 * Objects on a plane there is no second place for, and a casting whose ending is
 * a percentage thrown once a day after the sixtieth.
 */
export const SECRET_CHEST: SpellDefinition = {
  id: 'secret-chest',
  name: 'Secret Chest',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the chest and its twelve cubic feet are objects, and objects are not modelled; the Ethereal Plane they go to is a second place the engine has nowhere to put anything',
    'the Magic action that recalls the chest, and the one that sends it back, are not offered: an activation resolves an attack or moves an area, and neither of those is fetching a box',
    'the "cumulative 5 percent chance at the end of each day" after the sixtieth is not rolled, so the spell never ends that way; nor does it end on a recasting or on the replica being destroyed',
  ],
};

/**
 * SRD Aura of Life:
 *
 * > _Level 4 Abjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "An aura radiates from you in a 30-foot Emanation for the duration. While in
 * > the aura, you and your allies have Resistance to Necrotic damage, and your
 * > Hit Point maximums can't be reduced. If an ally with 0 Hit Points starts its
 * > turn in the aura, that ally regains 1 Hit Point."
 *
 * Three clauses and three different missing readers: a Resistance that depends on
 * where a creature is standing, a Hit Point maximum nothing may move and
 * therefore nothing may forbid moving, and a payout gated on the recipient's
 * current Hit Points.
 */
export const AURA_OF_LIFE: SpellDefinition = {
  id: 'aura-of-life',
  name: 'Aura of Life',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the Resistance to Necrotic damage is not granted: it belongs to whoever is inside the Emanation when the damage lands, and a defence is a standing grant on a creature rather than a value derived from where it is standing',
    'the Hit Point maximums that "can\'t be reduced" are not protected: no effect moves a maximum, so there is nothing to stand in front of',
    'and the ally at 0 Hit Points does not regain one: a payout at a turn boundary hands over what it was told to and cannot first ask what the recipient’s Hit Points are',
  ],
};

/**
 * SRD Wall of Stone:
 *
 * > _Level 5 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 10 minutes.
 * > "A nonmagical wall of solid stone springs into existence at a point you
 * > choose within range. The wall is 6 inches thick and is composed of ten
 * > 10-foot-by-10-foot panels. ... Each panel has AC 15 and 30 Hit Points per
 * > inch of thickness, and it has Immunity to Poison and Psychic damage. ... If
 * > you maintain your Concentration on this spell for its full duration, the
 * > wall becomes permanent and can't be dispelled."
 *
 * Ten panels, each of them an object with an Armour Class, a Hit Point total
 * and defences — and a duration that changes kind if the caster holds
 * Concentration to the end. The first is a thing with statistics that is not a
 * creature; the second is a consequence hung on a casting running out.
 */
export const WALL_OF_STONE: SpellDefinition = {
  id: 'wall-of-stone',
  name: 'Wall of Stone',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is not in the world: ten contiguous 10-foot panels shaped as the caster likes is not one of the six templates a casting may hold, and a wall that stops a creature crossing it is the geometry’s missing half besides',
    'each panel’s AC 15, its 30 Hit Points per inch and its Immunity to Poison and Psychic damage are a stat block on an object, and an object with statistics of its own is not a creature the engine can add',
    'so nobody is pushed aside when it appears, the Dexterity save against being enclosed is not rolled, and the Reaction that moves a creature its Speed out of the enclosure is not offered',
    '"If you maintain your Concentration on this spell for its full duration, the wall becomes permanent" hangs a consequence on the moment a casting runs out, and nothing fires when one does',
  ],
};

/**
 * SRD Wall of Ice:
 *
 * > _Level 6 Evocation (Wizard)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You create a wall of ice on a solid surface within range. ... If the wall
 * > cuts through a creature's space when it appears, the creature is pushed to
 * > one side of the wall (you choose which side) and makes a Dexterity saving
 * > throw, taking 10d6 Cold damage on a failed save or half as much damage on a
 * > successful one. ... It has AC 12 and 30 Hit Points per 10-foot section, and
 * > it has Immunity to Cold, Poison, and Psychic damage and Vulnerability to
 * > Fire damage."
 *
 * Wall of Stone's problems with a dome and a sheet of frigid air added: a shape
 * that is a hemisphere *or* ten panels, a second area left behind where a
 * section was destroyed, and forced movement no effect causes.
 */
export const WALL_OF_ICE: SpellDefinition = {
  id: 'wall-of-ice',
  name: 'Wall of Ice',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is not in the world: a dome, a globe or ten contiguous panels is a wall and a choice of walls, where a casting holds one fixed template — so the Dexterity save and the 10d6 Cold, half on a success, are never resolved',
    'and nobody is pushed to one side of it: forced movement is something a command does and no spell effect reaches',
    'the AC 12, the 30 Hit Points per section and the Immunities to Cold, Poison and Psychic with Vulnerability to Fire are a stat block on an object, which is not a creature the engine can add',
    'so the sheet of frigid air a destroyed section leaves behind is not created either, and with it the Constitution save and the 5d6 Cold for crossing it the first time on a turn',
    'the 2d6 and 1d6 a slot above 6 adds to those two numbers are not added, because neither number is rolled',
  ],
};

/**
 * SRD Wall of Thorns:
 *
 * > _Level 6 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You create a wall of tangled brush bristling with needle-sharp thorns. ...
 * > When the wall appears, each creature in its area makes a Dexterity saving
 * > throw, taking 7d8 Piercing damage on a failed save or half as much damage on
 * > a successful one. ... For every 1 foot a creature moves through the wall, it
 * > must spend 4 feet of movement. Furthermore, the first time a creature enters
 * > a space in the wall on a turn or ends its turn there, the creature makes a
 * > Dexterity saving throw, taking 7d8 Slashing damage."
 *
 * The trigger is Web's exactly — entering a space the first time on a turn, or
 * ending a turn there — and the thing it hangs on is a wall sixty feet long,
 * ten high and five thick, or a ring twenty across.
 */
export const WALL_OF_THORNS: SpellDefinition = {
  id: 'wall-of-thorns',
  name: 'Wall of Thorns',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is not in the world: "60 feet long, 10 feet high, and 5 feet thick or a circle that has a 20-foot diameter" is a wall, and a choice between two of them, where a casting holds one fixed template',
    'so neither Dexterity save is rolled — the 7d8 Piercing when it appears, and the 7d8 Slashing on the first entry or the end of a turn inside it, which is Web’s own trigger on a shape the engine cannot describe',
    'the four feet of movement per foot are not charged, and the rate is not what is missing: `areaTerrain` carries a printed rate and Plant Growth writes exactly this one. It is the wall above — a patch lies over the area its casting pinned, and this casting pins no area at all',
    'the wall blocking line of sight is the DM’s: cover and sight stay declared rather than ray-cast',
  ],
};

/**
 * SRD Blade Barrier:
 *
 * > _Level 6 Evocation (Cleric)._ **Casting Time:** Action. **Range:** 90 feet.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You create a wall of whirling blades made of magical energy. ... You make a
 * > straight wall up to 100 feet long, 20 feet high, and 5 feet thick, or a
 * > ringed wall up to 60 feet in diameter, 20 feet high, and 5 feet thick. The
 * > wall provides Three-Quarters Cover, and its space is Difficult Terrain. Any
 * > creature in the wall's space makes a Dexterity saving throw, taking 6d10
 * > Force damage on a failed save or half as much damage on a successful one."
 *
 * The same shape as Wall of Thorns and the same two reasons; the cover it
 * provides is the third thing, and cover is declared here rather than derived
 * from anything standing in the way.
 */
export const BLADE_BARRIER: SpellDefinition = {
  id: 'blade-barrier',
  name: 'Blade Barrier',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is not in the world: a hundred feet long by twenty high by five thick, or a ring sixty across, is a wall and a choice of walls where a casting holds one template',
    'so the Dexterity save and the 6d10 Force, half on a success, are not resolved — neither on the creature caught when it appears nor on the one that enters or ends its turn in it',
    'its space being Difficult Terrain is not charged: the ruler is told by the foot what crossed difficult ground, and no area tells it',
    'the Three-Quarters Cover it provides is the DM’s, because cover is declared rather than derived from what stands in the way',
  ],
};

/**
 * SRD Fire Storm:
 *
 * > _Level 7 Evocation (Cleric, Druid, Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "A storm of fire appears within range. The area of the storm consists of up
 * > to ten 10-foot Cubes, which you arrange as you like. Each Cube must be
 * > contiguous with at least one other Cube. Each creature in the area makes a
 * > Dexterity saving throw, taking 7d10 Fire damage on a failed save or half as
 * > much damage on a successful one."
 *
 * **One sentence of arithmetic and one sentence of geometry**, and the geometry
 * is the whole of what stops it: the save and the halved 7d10 are `save-damage`
 * exactly, over an area that is ten Cubes rather than one.
 */
export const FIRE_STORM: SpellDefinition = {
  id: 'fire-storm',
  name: 'Fire Storm',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the storm is not in the world: "up to ten 10-foot Cubes, which you arrange as you like" is ten templates in one area, and a casting holds one — so the Dexterity save and the 7d10 Fire, half on a success, have no area to be resolved over',
    'flammable objects that are not worn or carried starting to burn is the DM’s',
  ],
};

/**
 * SRD Meteor Swarm:
 *
 * > _Level 9 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 1 mile. **Duration:** Instantaneous.
 * > "Blazing orbs of fire plummet to the ground at four different points you can
 * > see within range. Each creature in a 40-foot-radius Sphere centered on each
 * > of those points makes a Dexterity saving throw. A creature takes 20d6 Fire
 * > damage and 20d6 Bludgeoning damage on a failed save or half as much damage
 * > on a successful one. A creature in the area of more than one fiery Sphere is
 * > affected only once."
 *
 * Fire Storm's problem with four Spheres instead of ten Cubes, and one sentence
 * more: a creature caught by two of them is hit once, which is a rule about the
 * overlap of areas a casting cannot have.
 */
export const METEOR_SWARM: SpellDefinition = {
  id: 'meteor-swarm',
  name: 'Meteor Swarm',
  level: 9,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 5280 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the four Spheres are not in the world: four 40-foot-radius templates at four chosen points is four areas in one casting, and a casting holds one — so the Dexterity save and the 20d6 Fire plus 20d6 Bludgeoning, half on a success, are not resolved',
    'and the rule that a creature caught by more than one Sphere "is affected only once" is a rule about areas overlapping, which there is no second area to overlap with',
    'the nonmagical objects that take the damage and catch fire are the DM’s',
  ],
};

/**
 * SRD Awaken:
 *
 * > _Level 5 Transmutation (Bard, Druid)._ **Casting Time:** 8 hours.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "The target must be either a Beast or Plant creature with an Intelligence of
 * > 3 or less or a natural plant that isn't a creature. The target gains an
 * > Intelligence of 10 and the ability to speak one language you know. ... The
 * > awakened target has the Charmed condition for 30 days or until you or your
 * > allies deal damage to it."
 *
 * **The last clause is the one the engine could write and the first two are
 * what stop it.** A Charmed condition for thirty days that ends when the caster
 * or an ally deals damage is a transcribed cause on a built mechanism; the
 * target rule selects by type *and* by an ability score, and what the spell
 * then does is set that score to 10.
 */
export const AWAKEN: SpellDefinition = {
  id: 'awaken',
  name: 'Awaken',
  level: 5,
  school: 'transmutation',
  castingTime: 'long',
  castingSeconds: 28_800,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'the target rule is not checked: "a Beast or Plant creature with an Intelligence of 3 or less" selects by type and by an ability score, and a target rule reads a type and whether armour is worn — and the other half of the sentence is a plant that is not a creature at all',
    'the Intelligence of 10 is not set: a score is fixed at creation and by advancement, and no effect moves one',
    'so the Charmed for thirty days — which the engine could hang and could end when the caster or an ally deals damage — is not applied either, because there is nothing it could be applied to that the rule above admits',
    'the awakened plant’s statistics, the language it speaks, and the attitude it chooses when the Charmed ends are the DM’s',
  ],
};

/**
 * SRD Animate Objects:
 *
 * > _Level 5 Transmutation (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose a number of nonmagical objects within range that aren't being worn
 * > or carried, aren't fixed to a surface, and aren't Gargantuan. ... Each target
 * > animates, sprouts legs, and becomes a Construct that uses the **Animated
 * > Object** stat block; this creature is under your control until the spell
 * > ends or until it is reduced to 0 Hit Points."
 *
 * The targets are objects selected by size and by whether anybody is holding
 * them, and what they become is a stat block. Both halves of the spell are
 * things the engine has no room for.
 */
export const ANIMATE_OBJECTS: SpellDefinition = {
  id: 'animate-objects',
  name: 'Animate Objects',
  level: 5,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'nothing is animated: an Animated Object is a stat block, and no casting adds a creature to the scene — so the Construct, its Initiative beside the caster’s, its Slam and the 1d4, 1d6 or 1d12 a bigger slot adds to that Slam are all the DM’s',
    'the targets cannot be chosen either: they are objects, counted by size against the caster’s spellcasting modifier, and selected by not being worn, carried, fixed down or Gargantuan',
    'so the two Hit Point sentences are not watched — control ending at 0 Hit Points, and the remaining damage carrying over to the object form',
    'the Bonus Action that commands them within 500 feet is not offered',
  ],
};

/**
 * SRD Commune:
 *
 * > _Level 5 Divination (Cleric) (Ritual)._ **Casting Time:** 1 minute or Ritual.
 * > **Range:** Self. **Duration:** 1 minute.
 * > "You contact a deity or a divine proxy and ask up to three questions that
 * > can be answered with yes or no. ... If you cast the spell more than once
 * > before finishing a Long Rest, there is a cumulative 25 percent chance for
 * > each casting after the first that you get no answer."
 *
 * The three questions are the GM's; the percentage is Augury's, on the rite
 * that runs a minute and leaves a minute to ask in.
 *
 * **And the two are filed apart now, which is the owner's ruling arriving on
 * the spell it names.** "Some text is the DM's alone ... marked explicitly as a
 * thing only the DM can decide." A deity's answer is not a clause the engine
 * has not got round to: there is no engine that produces one, and a line in
 * `unmodelled` said the opposite by sitting on a list of work somebody may do.
 * It is handed over instead, in the book's own words. The percentage stays
 * where it was, because a die that is not a d20 and a count of castings back to
 * a Long Rest really are shapes somebody may build.
 */
export const COMMUNE: SpellDefinition = {
  id: 'commune',
  name: 'Commune',
  level: 5,
  school: 'divination',
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  dmDecides: [
    'You contact a deity or a divine proxy and ask up to three questions that can be answered with yes or no.',
    'You receive a correct answer for each question.',
    "Divine beings aren't necessarily omniscient, so you might receive \"unclear\" as an answer if a question pertains to information that lies beyond the deity's knowledge.",
    "In a case where a one-word answer could be misleading or contrary to the deity's interests, the GM might offer a short phrase as an answer instead.",
  ],
  unmodelled: [
    'the "cumulative 25 percent chance for each casting after the first" is not rolled: no effect asks the generator for a die that is not a d20, and nothing counts castings back to a Long Rest',
  ],
};

/**
 * SRD Contact Other Plane:
 *
 * > _Level 5 Divination (Warlock, Wizard) (Ritual)._
 * > **Casting Time:** 1 minute or Ritual. **Range:** Self.
 * > **Duration:** 1 minute.
 * > "Contacting this otherworldly intelligence can break your mind. When you
 * > cast this spell, make a DC 15 Intelligence saving throw. On a successful
 * > save, you can ask the entity up to five questions. ... On a failed save, you
 * > take 6d6 Psychic damage and have the Incapacitated condition until you
 * > finish a Long Rest. A _Greater Restoration_ spell cast on you ends this
 * > effect."
 *
 * **A save the caster makes against a DC the book prints.** Every saving throw
 * a spell forces is measured against the casting's own pinned DC, and a spell
 * check may already name a number where a save may not; and the condition it
 * imposes lasts until a rest, which is neither a span nor a moment in the turn
 * order.
 */
export const CONTACT_OTHER_PLANE: SpellDefinition = {
  id: 'contact-other-plane',
  name: 'Contact Other Plane',
  level: 5,
  school: 'divination',
  castingTime: 'long',
  castingSeconds: 60,
  ritual: true,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  // The questions and the answers are the entity's, which is to say the GM's,
  // and the book says so in as many words. The save that decides whether you
  // get to ask is a debt with three clauses and stays one; the sentence that
  // states it — "On a successful save, you can ask the entity up to five
  // questions" — is left where it is rather than handed over, because it is
  // conditioned on a roll the engine does not yet make.
  dmDecides: [
    'You mentally contact a demigod, the spirit of a long-dead sage, or some other knowledgeable entity from another plane.',
    'You must ask your questions before the spell ends.',
    'The GM answers each question with one word, such as "yes," "no," "maybe," "never," "irrelevant," or "unclear" (if the entity doesn\'t know the answer to the question).',
    'If a one-word answer would be misleading, the GM might instead offer a short phrase as an answer.',
  ],
  unmodelled: [
    'the DC 15 Intelligence saving throw is not rolled: a save a spell forces is always measured against the casting’s own spell save DC, and a printed number has nowhere to be stated — an ability check may name one and a saving throw may not',
    'so the 6d6 Psychic damage on a failure is not dealt, and the Incapacitated condition is not applied: it lasts "until you finish a Long Rest", which is neither a span of seconds nor a moment in the turn order',
    'and Greater Restoration ending it is a spell ending another spell’s effect, which the dispel path reaches only for an ongoing casting — this one is Instantaneous in everything but the minute it gives you to ask in',
  ],
};

/**
 * SRD Creation:
 *
 * > _Level 5 Illusion (Sorcerer, Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** 30 feet. **Duration:** Special.
 * > "You pull wisps of shadow material from the Shadowfell to create an object
 * > within range. ... The object must be no larger than a 5-foot Cube, and the
 * > object must be of a form and material that you have seen. The spell's
 * > duration depends on the object's material, as shown in the Materials
 * > table."
 *
 * **The one Duration in the book the oracle has no number for**, because the
 * book gives none: "Special", resolved by a table of five materials from
 * twenty-four hours down to one minute. A definition holds one span, so this
 * one holds none and says why.
 */
export const CREATION: SpellDefinition = {
  id: 'creation',
  name: 'Creation',
  level: 5,
  school: 'illusion',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'no deadline is scheduled, because the book prints none: "Duration: Special" is resolved by the material the caster chose — a day for vegetable matter down to a minute for adamantine — and a definition carries one span, not a table indexed by a choice made at the casting',
    'the object is an object: a 5-foot Cube of a form and material the caster has seen, growing by 5 feet for each slot level above 5, and nothing here is modelled',
    'using one as another spell’s Material component causing that spell to fail is the DM’s',
  ],
};

/**
 * SRD Conjure Elemental:
 *
 * > _Level 5 Conjuration (Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "Whenever a creature you can see enters the spirit's space or starts its
 * > turn within 5 feet of the spirit, you can force that creature to make a
 * > Dexterity saving throw if the spirit has no creature Restrained. On failed
 * > save, the target takes 8d8 damage of the spirit's type, and the target has
 * > the Restrained condition until the spell ends. At the start of each of its
 * > turns, the Restrained target repeats the save. On a failed save, the target
 * > takes 4d8 damage of the spirit's type."
 *
 * **The repeat save whose failure acts**, in the clearest form the book prints
 * it: the boundary save deals 4d8 on a failure, and a repeat save releases an
 * effect on a success and does nothing at all on a failure. Beside it the area
 * catches only a creature the caster can see, and only while the spirit holds
 * nobody.
 */
export const CONJURE_ELEMENTAL: SpellDefinition = {
  id: 'conjure-elemental',
  name: 'Conjure Elemental',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the Dexterity save the spirit forces is not raised: what it catches is filtered twice — only a creature the caster can see, and only "if the spirit has no creature Restrained" — and an area catches every creature in it',
    'so the 8d8 of the chosen type and the Restrained until the spell ends are not applied, nor the 1d8 a slot above 5 adds',
    'and the repeat save at the start of the Restrained target’s turns is not raised: its failure deals 4d8, where a repeat save releases an effect on a success and has no failure branch at all',
    'which of air, earth, fire or water the spirit is, and so which of Lightning, Thunder, Fire or Cold it deals, is chosen at the casting and not recorded',
  ],
};

/**
 * SRD Geas:
 *
 * > _Level 5 Enchantment (Bard, Cleric, Druid, Paladin, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** 60 feet. **Duration:** 30 days.
 * > "You give a verbal command to a creature that you can see within range ...
 * > The target must succeed on a Wisdom saving throw or have the Charmed
 * > condition for the duration. ... While Charmed, the creature takes 5d10
 * > Psychic damage if it acts in a manner directly counter to your command. It
 * > takes this damage no more than once each day."
 * > _Using a Higher-Level Spell Slot._ "If you use a level 7 or 8 spell slot,
 * > the duration is 365 days. If you use a level 9 spell slot, the spell lasts
 * > until it is ended by one of the spells mentioned above."
 *
 * **The upcast changes what kind of duration the spell has**, which is the half
 * of that sentence a table of seconds cannot say: a level 9 Geas runs until
 * dispelled, and `durationAtSlot` holds spans. Beside it sits damage fired by
 * disobedience, once a day.
 */
export const GEAS: SpellDefinition = {
  id: 'geas',
  name: 'Geas',
  level: 5,
  school: 'enchantment',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  durationSeconds: 2_592_000,
  unmodelled: [
    'the Wisdom saving throw and the Charmed it imposes are not applied: what makes the condition worth having is the damage below it, and without that the spell would charm somebody and forbid nothing',
    'the 5d10 Psychic for acting "directly counter to your command" is not dealt: the trigger is a judgement about behaviour, and "no more than once each day" is a tally nothing keeps',
    'the 365 days a level 7 or 8 slot buys are not applied, and the level 9 slot’s "until it is ended" is not either — a slot may lengthen a span and may not change it into no deadline at all',
    'the automatic success for a target that cannot understand the command, the suicidal command that ends the spell, and Remove Curse, Greater Restoration or Wish ending it are the DM’s',
  ],
};

/**
 * SRD Mislead:
 *
 * > _Level 5 Illusion (Bard, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 hour.
 * > "You gain the Invisible condition at the same time that an illusory double
 * > of you appears where you are standing. The double lasts for the duration,
 * > but the invisibility ends immediately after you make an attack roll, deal
 * > damage, or cast a spell. As a Magic action, you can move the illusory double
 * > up to twice your Speed and make it gesture, speak, and behave in whatever
 * > way you choose."
 *
 * **Invisibility's three causes, ending one half of a casting rather than the
 * casting.** The engine ends a whole casting on those three triggers and has
 * done since Invisibility; here the double outlives the invisibility, so the
 * ending has to reach one effect and not the spell.
 */
export const MISLEAD: SpellDefinition = {
  id: 'mislead',
  // SRD prints no Verbal component on this spell, which is what SRD Silence
  // asks about — see `SpellDefinition.noVerbalComponent`.
  noVerbalComponent: true,
  name: 'Mislead',
  level: 5,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the Invisible condition is not applied, and it is the one thing here the engine could do: what it cannot do is end *it* on the three triggers Invisibility already carries while leaving the double standing, because those triggers end a casting rather than one of its effects',
    'the double is not in the scene: an intangible, invulnerable copy of the caster standing somewhere is a second thing with a position and no stat block to hang it on',
    'so the Magic action that moves it twice the caster’s Speed is not offered, and neither is seeing through its eyes or hearing through its ears',
  ],
};

/**
 * SRD Planar Binding:
 *
 * > _Level 5 Abjuration (Bard, Cleric, Druid, Warlock, Wizard)._
 * > **Casting Time:** 1 hour. **Range:** 60 feet. **Duration:** 24 hours.
 * > "You attempt to bind a Celestial, an Elemental, a Fey, or a Fiend to your
 * > service. The creature must be within range for the entire casting of the
 * > spell. ... At the completion of the casting, the target must succeed on a
 * > Charisma saving throw or be bound to serve you for the duration. If the
 * > creature was summoned or created by another spell, that spell's duration is
 * > extended to match the duration of this spell."
 * > _Using a Higher-Level Spell Slot._ "The duration increases with a spell slot
 * > of level 6 (10 days), 7 (30 days), 8 (180 days), and 9 (366 days)."
 *
 * The hour is real and the slot table is a table `durationAtSlot` could hold;
 * what the save buys is service, which is not a condition, and the sentence
 * beside it reaches into another casting and moves its deadline.
 */
export const PLANAR_BINDING: SpellDefinition = {
  id: 'planar-binding',
  name: 'Planar Binding',
  level: 5,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the target rule is not checked: "a Celestial, an Elemental, a Fey, or a Fiend" is four creature types where a target rule names one, so any creature at all may be aimed at',
    'the Charisma saving throw is not rolled, because being "bound to serve you" is not a condition and not any state the engine holds',
    'and the sentence beside it reaches into a second casting — "that spell\'s duration is extended to match the duration of this spell" — which is one ongoing spell rewriting another’s deadline, and nothing does that',
    'the ten, thirty, a hundred and eighty and three hundred and sixty-six days a bigger slot buys are not applied',
    'what the bound creature does with its orders, and how a Hostile one twists them, are the DM’s',
  ],
};

/**
 * SRD Raise Dead:
 *
 * > _Level 5 Necromancy (Bard, Cleric, Paladin)._ **Casting Time:** 1 hour.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "With a touch, you revive a dead creature if it has been dead no longer than
 * > 10 days and it wasn't Undead when it died. The creature returns to life with
 * > 1 Hit Point. ... The target takes a −4 penalty to D20 Tests. Every time the
 * > target finishes a Long Rest, the penalty is reduced by 1 until it becomes
 * > 0."
 *
 * Revivify's refusal at an hour's length, plus a penalty on every D20 Test that
 * wears off one point per Long Rest — a selector the bonus vocabulary does not
 * have, decreasing on a deadline anchored to a rest.
 */
export const RAISE_DEAD: SpellDefinition = {
  id: 'raise-dead',
  name: 'Raise Dead',
  level: 5,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'nobody is raised: "The creature returns to life with 1 Hit Point" is not a heal of one, because healing refuses a dead creature outright and lifting death is the rule that refusal keeps out of a hit point total',
    'the −4 penalty is not applied: it reaches *every* D20 Test, which is a selector the bonus vocabulary does not have — attacks, saves and ability checks are three families and there is no member meaning all of them',
    'and it would not wear off if it were: "every time the target finishes a Long Rest, the penalty is reduced by 1" is a deadline anchored to a rest, which is neither a span nor a moment in the turn order',
    'the ten days, the poisons neutralised, the mortal wounds closed and the missing head that makes the spell fail are the DM’s',
  ],
};

/**
 * SRD Reincarnate:
 *
 * > _Level 5 Necromancy (Druid)._ **Casting Time:** 1 hour. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "You touch a dead Humanoid or a piece of one. If the creature has been dead
 * > no longer than 10 days, the spell forms a new body for it and calls the soul
 * > to enter that body. Roll 1d10 and consult the table below to determine the
 * > body's species, or the GM chooses another playable species."
 *
 * A d10 indexing a table of species, and a species is content the engine holds
 * and nothing rewrites on a living sheet — on top of raising the dead, which
 * `healCreature` refuses by design.
 */
export const REINCARNATE: SpellDefinition = {
  id: 'reincarnate',
  name: 'Reincarnate',
  level: 5,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'nobody is reincarnated: forming a new body and calling a soul into it is raising the dead, which healing refuses outright and no effect kind reaches',
    'the 1d10 on the species table is not rolled: no effect asks the generator for a die that is not a d20, and there is nowhere for the face it showed to be looked up',
    'and the new species is not written onto the sheet: a species is chosen at creation, and losing the traits of one and gaining another’s is advancement rather than a spell',
  ],
};

/**
 * SRD Teleportation Circle:
 *
 * > _Level 5 Conjuration (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** 10 feet. **Duration:** 1 round.
 * > "As you cast the spell, you draw a 5-foot-radius circle on the ground
 * > inscribed with sigils that link your location to a permanent teleportation
 * > circle of your choice whose sigil sequence you know and that is on the same
 * > plane of existence as you. A shimmering portal opens within the circle you
 * > drew and remains open until the end of your next turn. Any creature that
 * > enters the portal instantly appears within 5 feet of the destination circle
 * > or in the nearest unoccupied space if that space is occupied."
 *
 * Teleportation is built and the destination is not: the far end of this spell
 * is a circle somewhere else in the world, and there is one scene.
 */
export const TELEPORTATION_CIRCLE: SpellDefinition = {
  id: 'teleportation-circle',
  name: 'Teleportation Circle',
  level: 5,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 6,
  unmodelled: [
    'nobody is teleported: the destination is "a permanent teleportation circle of your choice" somewhere else on the plane, and there is one scene — so a spell that moves a creature has no position to move it to',
    'and nobody enters a portal either: the spell moves whoever walks into the circle during the round rather than whoever the caster named, which is a trigger on a place rather than a target list',
    'the sigil sequences, the two a caster starts knowing, the minute it takes to memorise another and the 365 days of daily casting that make a circle permanent are all the DM’s',
  ],
};

/**
 * SRD Contingency:
 *
 * > _Level 6 Abjuration (Wizard)._ **Casting Time:** 10 minutes.
 * > **Range:** Self. **Duration:** 10 days.
 * > "Choose a spell of level 5 or lower that you can cast, that has a casting
 * > time of an action, and that can target you. You cast that spell — called
 * > the contingent spell — as part of casting _Contingency_, expending a spell
 * > slot for both, but the contingent spell doesn't come into effect. Instead,
 * > it takes effect when a certain circumstance occurs."
 *
 * One casting holding another for later, which is the stack `docs/design/
 * casting.md` declined outright — and a trigger stated in words the caster
 * chooses when the rite is performed.
 */
export const CONTINGENCY: SpellDefinition = {
  id: 'contingency',
  name: 'Contingency',
  level: 6,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 864_000,
  unmodelled: [
    'no contingent spell is stored and none goes off: a casting that holds another until a circumstance occurs is exactly the stack the engine declined — there is none, and a Counterspell answering a Counterspell is refused rather than nested',
    'so the second slot the rite spends is not spent either, and the ten days it would wait are only a clock',
    'the circumstance the caster describes, and whether it has occurred, are the DM’s',
  ],
};

/**
 * SRD Create Undead:
 *
 * > _Level 6 Necromancy (Cleric, Warlock, Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** 10 feet. **Duration:** Instantaneous.
 * > "You can cast this spell only at night. Choose up to three corpses of Medium
 * > or Small Humanoids within range. Each one becomes a **Ghoul** under your
 * > control (see "Monsters" for the stat blocks)."
 * > _Using a Higher-Level Spell Slot._ "If you use a level 7 spell slot, you can
 * > animate or reassert control over four Ghouls. If you use a level 8 spell
 * > slot, you can animate or reassert control over five Ghouls or two Ghasts or
 * > Wights. If you use a level 9 spell slot, you can animate or reassert control
 * > over six Ghouls, three Ghasts or Wights, or two Mummies."
 *
 * Animate Dead at night, with an upcast table that changes *which* stat block
 * arrives as well as how many. The book says where the spell's content lives —
 * "See 'Monsters' for these stat blocks" — and it is not in the spell.
 */
export const CREATE_UNDEAD: SpellDefinition = {
  id: 'create-undead',
  name: 'Create Undead',
  level: 6,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'no Ghoul appears, and no Ghast, Wight or Mummy: the spell’s whole product is a monster-list stat block, and no casting adds a creature to the scene',
    'the targets cannot be chosen either — "three corpses of Medium or Small Humanoids" selects by size, and selects corpses rather than creatures',
    'so the upcast table is not applied: four, five or six Ghouls, two or three Ghasts or Wights, two Mummies is a table naming four monster entries and choosing between them by slot level',
    'that it may be cast only at night, what the caster commands, and the Dodge an uncommanded creature takes are all the DM’s',
  ],
};

/**
 * SRD Forbiddance:
 *
 * > _Level 6 Abjuration (Cleric) (Ritual)._
 * > **Casting Time:** 10 minutes or Ritual. **Range:** Touch.
 * > **Duration:** 1 day.
 * > "You create a ward against magical travel that protects up to 40,000 square
 * > feet of floor space to a height of 30 feet above the floor. For the
 * > duration, creatures can't teleport into the area or use portals ... When a
 * > creature of a chosen type enters the spell's area for the first time on a
 * > turn or ends its turn there, the creature takes 5d10 Radiant or Necrotic
 * > damage (your choice when you cast this spell)."
 *
 * The trigger is Web's and the damage is ordinary; what the area has to do is
 * catch only the creature types chosen at the casting, and refuse a teleport
 * aimed into it.
 */
export const FORBIDDANCE: SpellDefinition = {
  id: 'forbiddance',
  name: 'Forbiddance',
  level: 6,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 600,
  ritual: true,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the 5d10 Radiant or Necrotic is not dealt: the trigger is Web’s exactly — the first entry on a turn, or ending a turn there — and the area has to catch only Aberrations, Celestials, Elementals, Fey, Fiends or Undead, chosen at the casting, where an area catches everyone standing in it',
    'the ward against teleporting and planar travel into the area is not enforced: an effect that refuses another casting has no state to sit in',
    'the forty thousand square feet by thirty high is not a template the engine holds, the password is not recorded, the overlap with another Forbiddance is not refused, and the thirty days that make it permanent are not counted',
  ],
};

/**
 * SRD Guards and Wards:
 *
 * > _Level 6 Abjuration (Bard, Wizard)._ **Casting Time:** 1 hour.
 * > **Range:** Touch. **Duration:** 24 hours.
 * > "You create a ward that protects up to 2,500 square feet of floor space ...
 * > In addition, at each intersection or branching passage offering a choice of
 * > direction, there is a 50 percent chance that a creature other than you
 * > believes it is going in the opposite direction from the one it chooses."
 *
 * A building's worth of fiction with one number in it, and that number is a
 * coin the engine has no effect to ask for — beside a list of lesser spells the
 * ward may cast, which is the stack again.
 */
export const GUARDS_AND_WARDS: SpellDefinition = {
  id: 'guards-and-wards',
  name: 'Guards and Wards',
  level: 6,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the "50 percent chance that a creature other than you believes it is going in the opposite direction" is not rolled: no effect asks the generator for a die that is not a d20',
    'the spells the ward may hold — Dancing Lights, Magic Mouth, Stinking Cloud, Gust of Wind — are a casting casting another spell, which there is no stack for',
    'the corridors, doors, stairs, fog and webs are the DM’s, and so is the 2,500 square feet of floor the ward covers',
  ],
};

/**
 * SRD Heroes' Feast:
 *
 * > _Level 6 Conjuration (Bard, Cleric, Druid)._ **Casting Time:** 10 minutes.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You conjure a feast that appears on a surface in an unoccupied 10-foot Cube
 * > next to you. The feast takes 1 hour to consume ... A creature that partakes
 * > gains several benefits, which last for 24 hours. The creature has Resistance
 * > to Poison damage, and it has Immunity to the Frightened and Poisoned
 * > conditions. Its Hit Point maximum also increases by 2d10, and it gains the
 * > same number of Hit Points."
 *
 * **Two of its three benefits are expressible and the third is not, and they
 * arrive together.** A Resistance and two condition Immunities are grants the
 * engine writes; a Hit Point maximum is set at creation and by advancement, and
 * no effect moves one.
 */
export const HEROES_FEAST: SpellDefinition = {
  id: 'heroes-feast',
  name: "Heroes' Feast",
  level: 6,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'nobody partakes: who eats is decided over the hour the feast takes to consume, and a casting applies its effects to the targets it was given at the moment it resolved — so the twelve creatures and the 24 hours their benefits run for are the DM’s',
    'the Resistance to Poison damage and the Immunity to the Frightened and Poisoned conditions are grants the engine writes, and they are not granted, because the benefit beside them cannot be',
    'the 2d10 the Hit Point maximum increases by is not applied: a maximum is set when a creature is added and by advancement, and no effect moves one — so the Hit Points gained with it have no room to go into',
  ],
};

/**
 * SRD Magnificent Mansion:
 *
 * > _Level 7 Conjuration (Bard, Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** 300 feet. **Duration:** 24 hours.
 * > "You conjure a shimmering door in range ... The door leads to an
 * > extradimensional dwelling ... When the spell ends, any creatures or objects
 * > left inside the extradimensional space are expelled into the unoccupied
 * > spaces nearest to the entrance."
 *
 * The door stands in the scene and what is behind it does not: there is one
 * scene, so nobody can be inside the dwelling and nobody has to be expelled
 * from it.
 */
export const MAGNIFICENT_MANSION: SpellDefinition = {
  id: 'magnificent-mansion',
  name: 'Magnificent Mansion',
  level: 7,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the dwelling behind the door is a second place and the engine holds one scene, so nobody is ever inside it and the expulsion into the nearest unoccupied spaces when the day runs out never happens',
    'the door itself, who may pass through it, the thirty feet within which the caster may open or close it, and the hundred servants are the DM’s',
  ],
};

/**
 * SRD Planar Ally:
 *
 * > _Level 6 Conjuration (Cleric)._ **Casting Time:** 10 minutes.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You beseech an otherworldly entity for aid. ... That entity sends a
 * > Celestial, an Elemental, or a Fiend loyal to it to aid you, making the
 * > creature appear in an unoccupied space within range."
 *
 * Whatever the GM sends, it is a stat block appearing in the fight; everything
 * after that is bargaining.
 */
export const PLANAR_ALLY: SpellDefinition = {
  id: 'planar-ally',
  name: 'Planar Ally',
  level: 6,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  // "From first word to last" was the old note's phrase for the bargain, and it
  // was exactly right, which is why it is the book's own words here rather than
  // a summary of them: sixteen sentences about what a Celestial will do for a
  // living sacrifice are not a mechanism anybody is going to build. The
  // summoning above them is, and stays a debt.
  dmDecides: [
    'When the creature appears, it is under no compulsion to behave a particular way.',
    "You can ask it to perform a service in exchange for payment, but it isn't obliged to do so.",
    'The requested task could range from simple (fly us across the chasm, or help us fight a battle) to complex (spy on our enemies, or protect us during our foray into the dungeon).',
    'You must be able to communicate with the creature to bargain for its services.',
    'Payment can take a variety of forms.',
    'A Celestial might require a sizable donation of gold or magic items to an allied temple, while a Fiend might demand a living sacrifice or a gift of treasure.',
    'Some creatures might exchange their service for a quest undertaken by you.',
    'A task that can be measured in minutes requires a payment worth 100 GP per minute.',
    'A task measured in hours requires 1,000 GP per hour.',
    'And a task measured in days (up to 10 days) requires 10,000 GP per day.',
    'The GM can adjust these payments based on the circumstances under which you cast the spell.',
    "If the task is aligned with the creature's ethos, the payment might be halved or even waived.",
    'Nonhazardous tasks typically require only half the suggested payment, while especially dangerous tasks might require a greater gift.',
    'Creatures rarely accept tasks that seem suicidal.',
    'After the creature completes the task, or when the agreed-upon duration of service expires, the creature returns to its home plane after reporting back to you if possible.',
    "If you are unable to agree on a price for the creature's service, the creature immediately returns to its home plane.",
  ],
  unmodelled: [
    'nobody is sent: a Celestial, an Elemental or a Fiend appearing in an unoccupied space within range is a stat block added to the scene mid-fight, which no casting does',
  ],
};

/**
 * SRD Irresistible Dance:
 *
 * > _Level 6 Enchantment (Bard, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "One creature that you can see within range must make a Wisdom saving throw.
 * > On a successful save, the target dances comically until the end of its next
 * > turn, during which it must spend all its movement to dance in place. On a
 * > failed save, the target has the Charmed condition for the duration. While
 * > Charmed, the target dances comically, must use all its movement to dance in
 * > place, and has Disadvantage on Dexterity saving throws and attack rolls, and
 * > other creatures have Advantage on attack rolls against it. On each of its
 * > turns, the target can take an action to collect itself and repeat the save,
 * > ending the spell on itself on a success."
 *
 * **Almost every clause is built and three sentences are not, and they are
 * three different gaps.** A *successful* save that still costs the target a
 * turn has no branch to ride; the movement spent dancing is the action economy;
 * and the repeat save is raised by the target spending an action rather than by
 * a turn boundary.
 */
export const IRRESISTIBLE_DANCE: SpellDefinition = {
  id: 'irresistible-dance',
  name: 'Irresistible Dance',
  level: 6,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom saving throw is not rolled, and its **success** is the first reason: a successful save here still makes the target dance until the end of its next turn, and a rider rides the failure — there is no success branch to hang one on',
    'so the Charmed a failure imposes is not applied, nor the Disadvantage on Dexterity saves and attack rolls, nor the Advantage other creatures get against it — all three are ordinary riders on a save that cannot be written',
    '"must use all its movement to dance in place" is the action economy, which no spell effect reaches',
    'and the repeat save is raised by the target **taking an action** to collect itself rather than by a turn boundary, which is the only thing that raises one',
  ],
};

/**
 * SRD Clone:
 *
 * > _Level 8 Necromancy (Wizard)._ **Casting Time:** 1 hour. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "You touch a creature or at least 1 cubic inch of its flesh. An inert
 * > duplicate of that creature forms inside the vessel used in the spell's
 * > casting and finishes growing after 120 days ... If the original creature
 * > dies after the clone finishes forming, the creature's soul transfers to the
 * > clone if the soul is free and willing to return."
 *
 * A hundred and twenty days of growing, and then a death that moves a soul. The
 * spell's whole content is raising the dead on a delay nothing counts.
 */
export const CLONE: SpellDefinition = {
  id: 'clone',
  name: 'Clone',
  level: 8,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'no duplicate forms and no soul transfers: bringing a creature back in another body is raising the dead, which healing refuses outright and no effect kind reaches',
    'the 120 days it takes to finish growing are not counted, and neither is the vessel remaining undisturbed — an Instantaneous casting schedules nothing',
    'the age of the finished clone, the original’s remains going inert, and whether a soul is free and willing are the DM’s',
  ],
};

/**
 * SRD Control Weather:
 *
 * > _Level 8 Transmutation (Cleric, Druid, Wizard)._
 * > **Casting Time:** 10 minutes. **Range:** Self.
 * > **Duration:** Concentration, up to 8 hours.
 * > "You take control of the weather within 5 miles of you for the duration.
 * > You must be outdoors to cast this spell, and it ends early if you go
 * > indoors. ... It takes 1d4 × 10 minutes for the new conditions to take
 * > effect. ... When you change the weather conditions, find a current condition
 * > on the following tables and change its stage by one, up or down."
 *
 * The weather is the DM's and the *delay* is not: a 1d4 multiplied by ten
 * minutes is a die no effect asks for, deciding a moment nothing schedules.
 */
export const CONTROL_WEATHER: SpellDefinition = {
  id: 'control-weather',
  name: 'Control Weather',
  level: 8,
  school: 'transmutation',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 28_800,
  // **The weather is handed over; the sentence that indexes the stage tables is
  // not.** "When you change the weather conditions, find a current condition on
  // the following tables and change its stage by one, up or down" is the DM's
  // *and* waits on the `1d4 × 10 minutes` nothing schedules, which is the one
  // clause of this spell that is genuinely both — so it stays a debt, where the
  // tracked map already names its shape, and the sentences around it, which are
  // only the weather, go to the table.
  dmDecides: [
    'When you cast the spell, you change the current weather conditions, which are determined by the GM.',
    'You can change precipitation, temperature, and wind.',
    'When the spell ends, the weather gradually returns to normal.',
    'When changing the wind, you can change its direction.',
  ],
  unmodelled: [
    'the "1d4 × 10 minutes" before the new conditions take effect is not rolled and nothing waits for it: no effect asks the generator for a die outside the D20 pipeline, and there is nothing for the result to schedule',
    'the stage tables are indexed by a sentence that waits on that delay — "find a current condition on the following tables and change its stage by one" — so the table that is the DM’s is reached through a schedule the engine does not keep',
    'being outdoors is a fact the engine does not hold, so the spell does not end when the caster walks inside',
  ],
};

/**
 * SRD Power Word Stun:
 *
 * > _Level 8 Enchantment (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You overwhelm the mind of one creature you can see within range. If the
 * > target has 150 Hit Points or fewer, it has the Stunned condition. Otherwise,
 * > its Speed is 0 until the start of your next turn. The Stunned target makes a
 * > Constitution saving throw at the end of each of its turns, ending the
 * > condition on itself on a success."
 *
 * **Every consequence is built and the question in front of them is not.** A
 * Stunned with a repeat save at the end of each turn is Hold Person's shape; a
 * Speed of zero until the start of the caster's next turn is a rider with a
 * duration. What decides between them is a threshold on the target's current
 * Hit Points, read before anything is rolled, and the vitals are there with
 * nothing to ask them.
 */
export const POWER_WORD_STUN: SpellDefinition = {
  id: 'power-word-stun',
  name: 'Power Word Stun',
  level: 8,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'neither branch is taken, because nothing can ask the question in front of them: "if the target has 150 Hit Points or fewer" is a threshold on current Hit Points read before anything is rolled, and no effect consults the vitals',
    'so the Stunned condition is not applied and its Constitution save at the end of each of the target’s turns is not raised — both are shapes the engine has had since Hold Person',
    'and the other branch, a Speed of 0 until the start of the caster’s next turn, is not applied either',
  ],
};

/**
 * SRD Power Word Kill:
 *
 * > _Level 9 Enchantment (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You compel one creature you can see within range to die. If the target has
 * > 100 Hit Points or fewer, it dies. Otherwise, it takes 12d12 Psychic damage."
 *
 * Two sentences and two different gaps: a threshold on current Hit Points, and
 * damage that neither an attack roll nor a saving throw decides.
 */
export const POWER_WORD_KILL: SpellDefinition = {
  id: 'power-word-kill',
  name: 'Power Word Kill',
  level: 9,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'the target does not die: "if the target has 100 Hit Points or fewer" is a threshold on current Hit Points read before anything is rolled, and no effect asks the vitals a question',
    'and the 12d12 Psychic on the other branch is not dealt: damage a spell simply applies, with neither an attack roll nor a saving throw in front of it, has no effect kind — the same gap Magic Missile is blocked on',
  ],
};

/**
 * SRD Power Word Heal:
 *
 * > _Level 9 Enchantment (Bard, Cleric)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A wave of healing energy washes over one creature you can see within range.
 * > The target regains all its Hit Points. If the creature has the Charmed,
 * > Frightened, Paralyzed, Poisoned, or Stunned condition, the condition ends.
 * > If the creature has the Prone condition, it can use its Reaction to stand
 * > up."
 *
 * **Heal's sentence with the number taken out.** A printed flat amount is
 * expressible now; "all its Hit Points" is an amount *derived* from the target,
 * which is the residue that shape still names — and the Reaction to stand up is
 * the action economy.
 */
export const POWER_WORD_HEAL: SpellDefinition = {
  id: 'power-word-heal',
  name: 'Power Word Heal',
  level: 9,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [],
  unmodelled: [
    'nobody is healed: a heal carries a notation or a printed number, and "all its Hit Points" is an amount derived from the target’s own maximum — the half of the flat-amount shape that is still missing',
    'so the Charmed, Frightened, Paralyzed, Poisoned and Stunned are not ended either: end-condition takes exactly that printed list and hangs on the healing above it',
    'the Reaction the Prone creature may use to stand up is the action economy, which no spell effect reaches',
  ],
};

/**
 * SRD Time Stop:
 *
 * > _Level 9 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You briefly stop the flow of time for everyone but yourself. No time passes
 * > for other creatures, while you take 1d4 + 1 turns in a row, during which you
 * > can use actions and move as normal. This spell ends if one of the actions
 * > you use during this period, or any effects that you create during it,
 * > affects a creature other than you or an object being worn or carried by
 * > someone other than you."
 *
 * A die that is not a d20 deciding how many extra turns to insert into the
 * order, and a casting ended by what the caster does with them.
 */
export const TIME_STOP: SpellDefinition = {
  id: 'time-stop',
  name: 'Time Stop',
  level: 9,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the 1d4 + 1 turns are neither rolled nor taken: no effect asks the generator for a die outside the D20 pipeline, and the initiative order is a list of creatures rather than something a spell inserts turns into',
    'so the spell does not end when one of those actions affects somebody else, nor when the caster moves more than 1,000 feet from where it was cast',
  ],
};

/**
 * SRD True Resurrection:
 *
 * > _Level 9 Necromancy (Cleric, Druid)._ **Casting Time:** 1 hour.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "You touch a creature that has been dead for no longer than 200 years and
 * > that died for any reason except old age. The creature is revived with all
 * > its Hit Points. ... The spell can provide a new body if the original no
 * > longer exists, in which case you must speak the creature's name."
 *
 * Raise Dead at the top of the book, with the amount derived rather than
 * printed: all of a maximum rather than one.
 */
export const TRUE_RESURRECTION: SpellDefinition = {
  id: 'true-resurrection',
  name: 'True Resurrection',
  level: 9,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  unmodelled: [
    'nobody is revived: healing refuses a dead creature outright, and lifting death is the rule that refusal keeps out of a hit point total',
    'and the amount could not be stated if it did: "all its Hit Points" is derived from the target’s own maximum, where a heal carries a notation or a printed number',
    'the two hundred years, the wounds closed, the poison neutralised, the contagions cured, the curses lifted, the organs replaced, the Undead restored and the new body conjured within ten feet are the DM’s',
  ],
};

/**
 * SRD Regenerate:
 *
 * > _Level 7 Transmutation (Bard, Cleric, Druid)._ **Casting Time:** 1 minute.
 * > **Range:** Touch. **Duration:** 1 hour.
 * > "A creature you touch regains 4d8 + 15 Hit Points. For the duration, the
 * > target regains 1 Hit Point at the start of each of its turns, and any
 * > severed body parts regrow after 2 minutes."
 *
 * **The one spell `a-long-casting-time` was the only recorded blocker of, and
 * that shape has been built for two tranches.** The rite runs on the clock, the
 * flat addend beside the dice is a field `DiceScaling` has always carried, and
 * the hit point a turn is the printed number `turn-payout.flat` names this
 * spell for. So the entry was not a blocker at all — it was a spell nobody had
 * written, which is the finding rather than the definition.
 *
 * The regrown limbs are the only clause left, and they are fiction.
 */
export const REGENERATE: SpellDefinition = {
  id: 'regenerate',
  name: 'Regenerate',
  level: 7,
  school: 'transmutation',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    // "regains 4d8 + 15 Hit Points" — the addend is part of the healing, which
    // is the bug `docs/rules/srd-policy.md` records Finger of Death having for
    // weeks: a minimum of 19 catches a definition that dropped the fifteen.
    { kind: 'heal', healing: { dice: '4d8', flat: 15 }, addSpellcastingModifier: false },
    // "the target regains 1 Hit Point at the start of each of its turns" — the
    // recipient's own turn, and a printed number rather than a notation.
    { kind: 'turn-payout', at: 'start-of-turn', payout: 'healing', flat: 1 },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'severed body parts regrowing after 2 minutes is fiction: a limb is not a thing the engine holds, and neither is the two minutes it takes to come back',
  ],
};

/**
 * SRD Prayer of Healing:
 *
 * > _Level 2 Abjuration (Cleric, Paladin)._ **Casting Time:** 10 minutes.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "Up to five creatures of your choice who remain within range for the
 * > spell's entire casting gain the benefits of a Short Rest and also regain
 * > 2d8 Hit Points. A creature can't be affected by this spell again until that
 * > creature finishes a Long Rest."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 1d8 for each
 * > spell slot level above 2."
 *
 * **The first executed spell in the catalogue whose casting takes ten minutes.**
 * The healing is `heal` with an upcast, over five targets; what it leaves is the
 * Short Rest the same sentence confers, and the once-per-Long-Rest limit beside
 * it.
 */
export const PRAYER_OF_HEALING: SpellDefinition = {
  id: 'prayer-of-healing',
  name: 'Prayer of Healing',
  level: 2,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 5, self: true },
  effects: [
    { kind: 'heal', healing: { dice: '2d8', perSlotLevelAbove: '1d8' }, addSpellcastingModifier: false },
  ],
  unmodelled: [
    'the benefits of a Short Rest are not conferred: a rest is a span the engine measures and its payout is the rest command’s, so no effect hands one over without the hour',
    '"A creature can’t be affected by this spell again until that creature finishes a Long Rest" is not enforced: a deadline is a span of seconds or a moment in the turn order, and a rest is neither',
    'that the five must "remain within range for the spell’s entire casting" is not checked — range is measured when the rite settles, and nobody records where they stood for the ten minutes before',
  ],
};

/**
 * SRD Shining Smite:
 *
 * > _Level 2 Transmutation (Paladin)._ **Casting Time:** Bonus Action, which
 * > you take immediately after hitting a creature with a Melee weapon or an
 * > Unarmed Strike. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "The target hit by the strike takes an extra 2d6 Radiant damage from the
 * > attack. Until the spell ends, the target sheds Bright Light in a 5-foot
 * > radius, attack rolls against it have Advantage, and it can't benefit from
 * > the Invisible condition."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 2."
 *
 * Divine Smite's shape with a rider the engine cannot reach. The extra dice
 * join the attack that has already hit, which is what `attack-damage` is for;
 * the sentence after them grants Advantage *to everybody else* and switches off
 * a benefit the Invisible condition derives.
 */
export const SHINING_SMITE: SpellDefinition = {
  id: 'shining-smite',
  name: 'Shining Smite',
  level: 2,
  school: 'transmutation',
  // The trigger is the hit `resolveAttackDamage` is settling, so the command
  // enforces it rather than the definition — Divine Smite's and Searing
  // Smite's reading, on the third spell printing that casting time.
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [{ kind: 'attack-damage', damage: { dice: '2d6', perSlotLevelAbove: '1d6' }, damageType: 'radiant' }],
  durationSeconds: 60,
  unmodelled: [
    'the Advantage on attack rolls against the target is not granted: it belongs to every other creature in the fight rather than to the one this casting touched, and a spell applies its effects to the targets it reached',
    'and "it can’t benefit from the Invisible condition" switches off a benefit the condition layer derives while leaving the condition on the creature. The rider that does that exists — Starry Wisp, Faerie Fire and Mind Spike all hang it — and what this spell cannot reach it with is the host: a smite is cast on a hit, its one effect kind is `attack-damage`, and that kind carries no riders at all',
    'the Bright Light in a 5-foot radius is the DM’s, because light is not a state the engine holds',
  ],
};

/**
 * SRD Ensnaring Strike:
 *
 * > _Level 1 Conjuration (Ranger)._ **Casting Time:** Bonus Action, which you
 * > take immediately after hitting a creature with a weapon. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "As you hit the target, grasping vines appear on it, and it makes a
 * > Strength saving throw. A Large or larger creature has Advantage on this
 * > save. On a failed save, the target has the Restrained condition until the
 * > spell ends. On a successful save, the vines shrivel away, and the spell
 * > ends. While Restrained, the target takes 1d6 Piercing damage at the start
 * > of each of its turns. The target or a creature within reach of it can take
 * > an action to make a Strength (Athletics) check against your spell save DC.
 * > On a success, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 *
 * The fourth spell to print the smites' casting time and the first whose
 * payload is a saving throw rather than dice on the blow. It takes the smites'
 * road — settled by `resolveAttackDamage` on the hit that triggered it — and
 * what it hangs is the ordinary `save` effect, aimed at the creature the weapon
 * just hit (`onTheHit`): "the target" is not a creature type and not a list
 * the caller chose, so the target rule says nobody and the effect says who.
 *
 * **Every clause is the engine's now.** The Strength save is rolled with the
 * mode the target's *size* gives it (`saveModeIf`, read off `effectiveSizeOf`);
 * a failure hangs the Restrained under the casting, so what ends the casting
 * ends it; the die at the start of each of the target's turns is a `payout`
 * rider — the arrangement Heroism hangs, dealing damage, scaled at the slot —
 * that goes with the casting; the Athletics check is open to the target **or a
 * creature within reach of it** (`byAnotherWithinReach`, measured off the map)
 * and a success ends the spell, as does the target's own successful save
 * (`endsCastingOnSuccess`). The DC is the Ranger's, off the sheet at the cast.
 */
export const ENSNARING_STRIKE: SpellDefinition = {
  id: 'ensnaring-strike',
  name: 'Ensnaring Strike',
  level: 1,
  school: 'conjuration',
  // The trigger is the hit the caster has already landed, which the smites
  // state the same way: a Bonus Action taken immediately after it.
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [
    {
      kind: 'save',
      ability: 'str',
      // "As you hit the target … it makes a Strength saving throw."
      onTheHit: true,
      // "A Large or larger creature has Advantage on this save."
      saveModeIf: { sizeAtLeast: 'large', mode: 'advantage' },
      // "On a failed save, the target has the Restrained condition until the
      // spell ends." No `lasts`: the casting's own minute is the lifetime.
      condition: 'restrained',
      // "On a successful save, the vines shrivel away, and the spell ends."
      endsCastingOnSuccess: true,
      // "While Restrained, the target takes 1d6 Piercing damage at the start
      // of each of its turns." Hung off the failure, so a creature that saved
      // takes nothing; scaled with the slot, as the book scales it.
      modifiers: [
        {
          kind: 'payout',
          at: 'start-of-turn',
          payout: 'damage',
          damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
          damageType: 'piercing',
        },
      ],
      // "The target or a creature within reach of it can take an action to
      // make a Strength (Athletics) check against your spell save DC. On a
      // success, the spell ends."
      check: {
        ability: 'str',
        skill: 'athletics',
        onSuccess: 'end-casting',
        byAnotherWithinReach: true,
      },
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Hex:
 *
 * > _Level 1 Enchantment (Warlock)._ **Casting Time:** Bonus Action.
 * > **Range:** 90 feet. **Duration:** Concentration, up to 1 hour.
 * > "You place a curse on a creature that you can see within range. Until the
 * > spell ends, you deal an extra 1d6 Necrotic damage to the target whenever
 * > you hit it with an attack roll. Also, choose one ability when you cast the
 * > spell. The target has Disadvantage on ability checks made with the chosen
 * > ability. If the target drops to 0 Hit Points before this spell ends, you
 * > can take a Bonus Action on a later turn to curse a new creature."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 2 (up to 4 hours), 3–4 (up to 8 hours), or 5+
 * > (24 hours)."
 *
 * **Three sentences, and each one is a mechanism this engine already has.**
 * The extra die is `attack-rider` with `marksTarget` — SRD Hunter's Mark's own
 * effect with Necrotic dice, hung on the Warlock and read again on every later
 * attack roll they land on the cursed creature. The chosen ability is
 * `choiceStated` of `ability`, which is SRD Enhance Ability's sentence with the
 * mode reversed: `statedChoice` puts the caster's answer on the selector, and
 * the selector says `ability-check` because the SRD does and a saving throw is
 * a different roll. And the slot table is `durationAtSlot`, three keys for the
 * three bands the book prints.
 *
 * **The Bonus Action that curses a new creature is an `activation` that
 * re-aims**, and the whole of what it resolves is this definition's own
 * effects laid on somebody else — see {@link SpellActivation.reAims}, which is
 * why the list below is empty. Its legality is the printed condition and
 * nothing looser: the creature the casting marks has to be at 0 Hit Points or
 * dead, which the command reads off the rider the casting granted.
 */
export const HEX: SpellDefinition = {
  id: 'hex',
  name: 'Hex',
  level: 1,
  school: 'enchantment',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    // "you deal an extra 1d6 Necrotic damage **to the target** whenever you
    // hit it **with an attack roll**" — the target names the mark and the
    // sentence names no weapon, so a Fire Bolt at the cursed creature carries
    // it and a mace swung at anybody else does not.
    { kind: 'attack-rider', dice: '1d6', damageType: 'necrotic', marksTarget: true },
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'disadvantage',
        // "ability checks made with the chosen ability" — a check and not a
        // save, which is the narrowing `RollSelector` keeps apart on purpose.
        // The ability printed here is the slot `statedChoice` fills.
        selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
      },
    },
  ],
  // "choose one ability when you cast the spell" — one of the six, with no
  // list printed, so the list is the six.
  choiceStated: { of: 'ability', options: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
  // "you can take a Bonus Action **on a later turn** to curse a new creature."
  // No range is printed on the Bonus Action, so it is the spell's own: a new
  // creature is placed under a casting of Hex, and a casting of Hex reaches
  // ninety feet and a creature its caster can see.
  activation: {
    action: 'bonus-action',
    range: { kind: 'ranged', feet: 90 },
    reAims: true,
    label: 'Hex (a new creature)',
    effects: [],
  },
  durationSeconds: 3600,
  // "level 2 (up to 4 hours), 3–4 (up to 8 hours), or 5+ (24 hours)": three
  // bands and therefore three keys, with a level 4 slot falling in the second
  // because 5 has not been reached.
  durationAtSlot: { 2: 14400, 3: 28800, 5: 86400 },
};

/**
 * SRD Find Familiar:
 *
 * > _Level 1 Conjuration (Wizard)._ **Casting Time:** 1 hour or Ritual.
 * > **Range:** 10 feet. **Duration:** Instantaneous.
 * > "You gain the service of a familiar, a spirit that takes an animal form
 * > you choose: Bat, Cat, Frog, Hawk, Lizard, Octopus, Owl, Rat, Raven,
 * > Spider, Weasel, or another Beast that has a Challenge Rating of 0.
 * > Appearing in an unoccupied space within range, the familiar has the
 * > statistics of the chosen form (see "Monsters"), though it is a Celestial,
 * > Fey, or Fiend (your choice) instead of a Beast. ... A familiar can't
 * > attack, but it can take other actions as normal. ... When the familiar
 * > drops to 0 Hit Points, it disappears. ... If you cast this spell while
 * > you have a familiar, you instead cause it to adopt a new eligible form."
 *
 * The eleven forms are the Monsters chapter's own CR 0 Beasts, so the spell
 * prints no block of its own: the caster names one at the casting — any of
 * the eleven, or any other Beast the bestiary rates at 0 — and the `summon`
 * effect raises it with its numbers pinned. The Celestial, Fey or Fiend is
 * the caster's stated choice, pinned over the block's type at the arrival.
 *
 * **Instantaneous, and the familiar is kept.** No record holds it; it is the
 * wizard's, owed a departure when it drops to 0 Hit Points, which
 * `strandedSummons` finds and `dismissStrandedSummons` performs. "You can't
 * have more than one familiar at a time": a second casting replaces the first,
 * which is the mechanical whole of "adopt a new eligible form". And "A
 * familiar can't attack" arrives on the creature as a stored rule the action
 * economy refuses on.
 *
 * What is left is written below and adjudicated in `missing-shapes.ts`: its
 * senses lent to the caster, the touch spell it delivers, and the pocket
 * dimension it can be sent to.
 */
export const FIND_FAMILIAR: SpellDefinition = {
  id: 'find-familiar',
  name: 'Find Familiar',
  level: 1,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 3600,
  ritual: true,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  // The spell is on its caster and what it makes is a second creature, the
  // shape Find Steed and Phantom Steed already take: the printed Range is the
  // reach the familiar appears within rather than a reach to a target.
  targets: { count: 1, self: true },
  choiceStated: { of: 'creature-type', options: ['Celestial', 'Fey', 'Fiend'] },
  effects: [
    {
      kind: 'summon',
      monster: {
        among: [
          'bat',
          'cat',
          'frog',
          'hawk',
          'lizard',
          'octopus',
          'owl',
          'rat',
          'raven',
          'spider',
          'weasel',
        ],
        orAny: { type: 'Beast', cr: 0 },
      },
      // The value the definition is written around; the casting's stated
      // choice is what lands.
      creatureType: 'Celestial',
      // "As a Magic action, you can temporarily dismiss the familiar to a
      // pocket dimension … cause it to reappear in an unoccupied space within
      // 30 feet of you." The pocket is pinned on the bond, and
      // `dismissKeptSummons` / `recallKeptSummons` are the two doors.
      kept: { pocket: { within: 30 } },
      cannotAttack: true,
    },
  ],
  unmodelled: [
    'seeing through the familiar’s eyes and hearing what it hears as a Bonus Action, with the benefits of any special senses it has, is not granted: sight here is a pairwise declaration, and one creature borrowing another’s senses has no state to sit in',
    'the familiar delivering a touch spell — "your familiar can deliver the touch" — is not offered, and neither is the Reaction it must take to do so: a casting is acted through by its caster, and a second creature spending its own Reaction to deliver another’s spell has no field',
    'the telepathic connection within 100 feet is the table’s: the distance is measurable and what it gates is conversation',
    'what it leaves behind in its space when it disappears, and what it does with the turns it acts independently on while obeying your commands, are the DM’s',
  ],
};

/**
 * SRD Find Steed:
 *
 * > _Level 2 Conjuration (Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "You summon an otherworldly being that appears as a loyal steed in an
 * > unoccupied space of your choice within range. This creature uses the
 * > **Otherworldly Steed** stat block. If you already have a steed from this
 * > spell, the steed is replaced by the new one. ... choose the steed's
 * > creature type—Celestial, Fey, or Fiend ... **AC** 10 + 1 per spell level.
 * > **HP** 5 + 10 per spell level ... **Speed** 60 ft., Fly 60 ft. (requires
 * > level 4+ spell) ... In combat, it shares your Initiative count ... the
 * > steed takes its turn immediately after yours ... _Disappearance of the
 * > Steed._ The steed disappears if it drops to 0 Hit Points or if you die."
 *
 * The SRD prints the stat block **inside the spell**, and the owner's ruling of
 * 2026-09-21 says what that is: a catalogue entry like any other. So the block
 * is `otherworldly-steed` in the bestiary and the casting raises it — and what
 * the book writes as the spell's rather than the block's is the spell's to
 * print over it: the Armour Class and the hit points as formulae over the
 * level the slot paid for, the Fly Speed gated on a level 4 slot, and the
 * creature type as the caster's stated choice. Each is worked out once, at
 * the cast, and the answers are what reach the log.
 *
 * **Instantaneous, and the steed is kept.** No record holds it; it is the
 * rider's, owed a departure when it drops to 0 Hit Points or when its rider
 * dies, and replaced by a second casting. **It shares its rider's Initiative
 * count and is seated immediately after them**, both read off the order
 * rather than stated.
 *
 * **The block's own lines are not on it**, and that is the debt this spell
 * still carries: Life Bond, Otherworldly Slam and the three type-gated Bonus
 * Actions each print a number that is the summoner's — the spell attack
 * modifier, the spell save DC, the spell's level — which a stat block holds no
 * field to name.
 */
export const FIND_STEED: SpellDefinition = {
  id: 'find-steed',
  name: 'Find Steed',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, self: true },
  choiceStated: { of: 'creature-type', options: ['Celestial', 'Fey', 'Fiend'] },
  effects: [
    {
      kind: 'summon',
      monster: 'otherworldly-steed',
      creatureType: 'Celestial',
      armorClass: { base: 10, perSpellLevel: 1 },
      hitPoints: { base: 5, perSpellLevel: 10 },
      speeds: { fly: { feet: 60, fromSpellLevel: 4 } },
      kept: { untilSummonerDies: true },
      sharesCastersInitiative: true,
    },
  ],
  unmodelled: [
    'the block’s own lines are not on the steed: Life Bond, Otherworldly Slam and the three Bonus Actions gated on its type each print a number that is the summoner’s — "Bonus equals your spell attack modifier", "1d8 plus the spell’s level", "DC equals your spell save DC" — and a stat block holds no field that names its rider, so the bestiary entry carries none of them and the steed arrives with no attack',
    'and what the steed does with the turn when its rider has the Incapacitated condition — "acts independently, focusing on protecting you" — is the table’s, the same question left open for every creature in the scene',
    'the steed resembling a Large rideable animal of the caster’s choice, the mounted combat it is controlled through, the telepathy it speaks over a mile, and the gear it leaves behind when it goes are the DM’s',
  ],
};

/**
 * SRD Bestow Curse:
 *
 * > _Level 3 Necromancy (Bard, Cleric, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "You touch a creature, which must succeed on a Wisdom saving throw or
 * > become cursed for the duration. Until the curse ends, the target suffers
 * > one of the following effects of your choice: ... The target has
 * > Disadvantage on attack rolls against you. ... In combat, the target must
 * > succeed on a Wisdom saving throw at the start of each of its turns or be
 * > forced to take the Dodge action on that turn. ... If you deal damage to
 * > the target with an attack roll or a spell, the target takes an extra 1d8
 * > Necrotic damage."
 *
 * A touch-range save with a duration is the ordinary shape, and every one of
 * this spell's blockers is in the four alternatives underneath it. They are
 * `SpellDefinition.options`: four branches of which a casting runs exactly
 * one, each carrying **its own** Wisdom save, because a save in the common
 * list would be one roll whose outcome no branch could read.
 *
 * **The ability is the branch's question and not the spell's.** "Choose one
 * ability" is printed inside the first bullet alone, so `choiceStated` is
 * asked for only where the branch holds a slot for it — `declaredFacts` reads
 * the branch that was named, and a casting that curses the target's attacks is
 * asked nothing. What the failure hands out is two `mode` riders on the save
 * it failed, one over ability checks and one over saving throws, which is the
 * pair the SRD prints and the pair a `RollSelector` keeps apart.
 *
 * **"Attack rolls against you" is `ModifierRider.counterpart`**, the field
 * written for this sentence and named after it: the holder is the cursed
 * creature and the caster is the participant the relation does not name, bound
 * to an id by the resolver because the fold opens no catalogue and "you" is
 * not a fact a book can hold.
 *
 * **The slot table is two sentences and both are written.** `durationAtSlot`
 * carries the lengths and `concentrationEndsAtSlot` carries the clause beside
 * them — "the spell doesn't require Concentration" from level 5 up — which is
 * a fact about the casting rather than about its length and so is its own
 * field. The level 9 arm is `untilDispelledAtSlot`, the third
 * field of the same family: a slot that changes what *kind* of ending the
 * spell has rather than how long it runs.
 */
export const BESTOW_CURSE: SpellDefinition = {
  id: 'bestow-curse',
  name: 'Bestow Curse',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1 },
  // **Empty, and the save is in each branch.** "must succeed on a Wisdom
  // saving throw or become cursed ... the target suffers **one** of the
  // following effects of your choice" is one roll per casting whatever the
  // choice, and a save in the common list would be a roll whose outcome the
  // branch could not read — the rule `SpellDefinition.options` states.
  effects: [],
  options: {
    ability: {
      label: 'Disadvantage on checks and saves with one ability',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          modifiers: [
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                // The ability printed here is the slot `statedChoice` fills.
                selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
              },
            },
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' },
              },
            },
          ],
        },
      ],
    },
    'attacks-against-you': {
      label: 'Disadvantage on attack rolls against you',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          modifiers: [
            {
              kind: 'mode',
              modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
              // "against **you**": the caster, bound to an id at the casting.
              counterpart: 'caster',
            },
          ],
        },
      ],
    },
    dodge: {
      label: 'A Wisdom save at the start of each of its turns or Dodge',
      unmodelled: [
        'this branch resolves nothing at all, so the opening Wisdom save the other three roll — "must succeed on a Wisdom saving throw or become cursed" — is not raised for it either, and nobody is cursed',
        'the Wisdom save at the start of each of the target’s turns is not raised, and a failure does not compel the Dodge action: a repeat save hung on a casting ends the spell on a success and this one ends nothing, and its failure spends an action rather than deepening a condition',
      ],
    },
    'extra-damage': {
      label: 'An extra 1d8 Necrotic when you damage it',
      effects: [
        {
          kind: 'save',
          ability: 'wis',
          modifiers: [
            // "If you deal damage to the target with an attack roll **or a
            // spell**, the target takes an extra 1d8 Necrotic damage." The
            // rider hangs the grant on the caster and names this creature,
            // which is SRD Hunter's Mark's shape with the trigger widened past
            // the roll.
            { kind: 'later-blow', dice: '1d8', damageType: 'necrotic', alsoSpells: true },
          ],
        },
      ],
    },
  },
  // "Choose one ability" — one of the six, with no list printed, so the list
  // is the six. Asked for by the first branch alone.
  choiceStated: { of: 'ability', options: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
  durationSeconds: 60,
  // "a level 4 spell slot ... up to 10 minutes. ... level 5+ ... 8 hours
  // (level 5–6 slot) or 24 hours (level 7–8 slot)."
  durationAtSlot: { 4: 600, 5: 28800, 7: 86400 },
  // "If you use a level 5+ spell slot, the spell doesn’t require
  // Concentration."
  concentrationEndsAtSlot: 5,
  // "If you use a level 9 spell slot, the spell lasts until dispelled." The
  // third field of the slot family, and the one a table of seconds could not
  // say: an ending rather than a length. Same reader as SRD Major Image's.
  untilDispelledAtSlot: 9,
};

/**
 * SRD Call Lightning:
 *
 * > _Level 3 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 120
 * > feet. **Duration:** Concentration, up to 10 minutes.
 * > "A storm cloud appears at a point within range ... Each creature within 5
 * > feet of that point makes a Dexterity saving throw, taking 3d10 Lightning
 * > damage on a failed save or half as much damage on a successful one. Until
 * > the spell ends, you can take a Magic action to call down lightning in that
 * > way again, targeting the same point or a different one. If you're outdoors
 * > in a storm when you cast this spell ... the spell's damage increases by
 * > 1d10."
 *
 * The bolt at the casting is an ordinary area with an ordinary save, and it is
 * not the spell: the spell is the Magic action that calls another one down at
 * a point of the caster's choosing on any later turn, ten minutes long. An
 * activation that resolves a fresh area has no field, and the storm overhead
 * is a fact about the world that nothing holds.
 */
export const CALL_LIGHTNING: SpellDefinition = {
  id: 'call-lightning',
  name: 'Call Lightning',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'no lightning falls: the spell is a Magic action taken on later turns that resolves a five-foot area at a point chosen then, and an activation calls a saving throw on a target rather than laying down a fresh template',
    'so the Dexterity save and the 3d10 Lightning, half on a success, are not resolved at the casting either — the first bolt is the same activation taken immediately, and writing only that one would be a different spell',
    'the extra 1d10 for being outdoors in a storm is not applied: whether the weather is doing that is a fact the engine does not hold and cannot derive',
    'the ten-minute cloud, its 60-foot radius and the 10 feet of its height are the DM’s',
  ],
};

/**
 * SRD Conjure Animals:
 *
 * > _Level 3 Conjuration (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You conjure nature spirits that appear as a Large pack of spectral,
 * > intangible animals ... You have Advantage on Strength saving throws while
 * > you're within 5 feet of the pack, and when you move on your turn, you can
 * > also move the pack up to 30 feet ... On a failed save, the creature takes
 * > 3d10 Slashing damage."
 *
 * **No 2024 Conjure spell prints a stat block** and this one proves what they
 * print instead: a pack that is a place rather than a creature. What blocks it
 * is that the place moves when the caster does, and that standing beside it
 * grants a benefit derived from where you are.
 */
export const CONJURE_ANIMALS: SpellDefinition = {
  id: 'conjure-animals',
  name: 'Conjure Animals',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the pack is not in the scene: an area a caster may move up to thirty feet whenever they move is an area that follows its caster, and a casting pins its template where it was put',
    'so the Dexterity save it forces on whoever it reaches, and the 3d10 Slashing on a failure, are not resolved — nor is the once-per-turn cap on that save',
    'the Advantage on Strength saving throws within five feet of the pack is not granted: a benefit that holds while you stand somewhere is derived from where you stand, and only a feature derives one',
    'and the extra 1d10 a slot above 3 buys goes with the damage it would have scaled',
  ],
};

/**
 * SRD Conjure Woodland Beings:
 *
 * > _Level 4 Conjuration (Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "You conjure nature spirits that flit around you in a 10-foot Emanation
 * > for the duration. Whenever the Emanation enters the space of a creature
 * > you can see and whenever a creature you can see enters the Emanation or
 * > ends its turn there, you can force that creature to make a Wisdom saving
 * > throw. The creature takes 5d8 Force damage on a failed save or half as
 * > much damage on a successful one. A creature makes this save only once per
 * > turn.
 * >
 * > In addition, you can take the Disengage action as a Bonus Action for the
 * > spell's duration."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 4."
 *
 * **Spirit Guardians' shape, one clause longer**, and it stood in the
 * undefined population for two tranches while `blocked-on.test.ts` called it
 * the only spell left in the book whose effects the engine could execute
 * today. What kept it there was the Disengage, filed under a shape that turned
 * out to be built: `ActionRule`'s `allows` was derived from **this sentence**
 * and `STATABLE_PRICES` holds the one price in the book that moves.
 *
 * So the reading was wrong about which gap it was and right that there was
 * one, and the real one is a target rule rather than an economy. A spell with
 * an `area` has its targets picked by the area; an Emanation excludes the
 * creature it originates from; `effects` reaches the creatures the area
 * caught. There is therefore nowhere to put a grant that lands on the
 * **caster** while everything else lands on everybody near them — which is
 * `a-spells-effects-applied-to-different-targets`, one effect list applied to
 * every target, and is what `unmodelled` says below.
 *
 * Three trigger clauses and a cap that spans them, exactly as Spirit Guardians
 * prints them, and `effects: []` for the same reason: the spirits appear and
 * the paragraph names three moments, none of which is the conjuring. "you
 * **can** force that creature to make a Wisdom saving throw" costs the engine
 * nothing either — declining is a command nobody sends.
 */
export const CONJURE_WOODLAND_BEINGS: SpellDefinition = {
  id: 'conjure-woodland-beings',
  name: 'Conjure Woodland Beings',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'emanation', distance: 10, origin: 'self' },
  // The spirits appear and nothing happens yet: every save this spell calls
  // for comes from one of the three trigger clauses below.
  effects: [],
  durationSeconds: 600,
  areaTrigger: {
    at: 'end-of-turn',
    // "whenever a creature you can see enters the Emanation", with no "first
    // time on a turn" — the cap that makes it behave like one is the separate
    // sentence below, which spans all three clauses.
    onEntry: 'every-entry',
    onAreaEntry: true,
    oncePerTurn: true,
    label: 'Conjure Woodland Beings (the nature spirits)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
        damageType: 'force',
        onSuccess: 'half',
      },
    ],
  },
  unmodelled: [
    'the caster may not take the Disengage action as a Bonus Action: the allowance itself is an `action-rule` the engine has, and what it cannot be given is a home — a spell with an area has its targets picked by the area, an Emanation excludes the creature it originates from, and one effect list reaches every target, so a grant on the caster has nowhere to sit beside an Emanation that catches everybody else',
    'which creature the caster declines to force a save on is the table’s: the book says "you can force", and declining is a command nobody sends rather than a rule the engine applies',
  ],
};

/**
 * SRD Conjure Minor Elementals:
 *
 * > _Level 4 Conjuration (Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "You conjure spirits from the Elemental Planes that flit around you in a
 * > 15-foot Emanation for the duration. Until the spell ends, any attack you
 * > make deals an extra 2d8 damage when you hit a creature in the Emanation.
 * > ... In addition, the ground in the Emanation is Difficult Terrain for your
 * > enemies."
 *
 * Hex's rider with a geometry attached: the extra dice ride every attack the
 * caster makes for ten minutes, and whether they apply is decided by where the
 * target was standing when the blow landed.
 */
export const CONJURE_MINOR_ELEMENTALS: SpellDefinition = {
  id: 'conjure-minor-elementals',
  name: 'Conjure Minor Elementals',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the extra 2d8 is not dealt: it rides every attack the caster makes for ten minutes, where the extra dice a spell hangs belong to the one attack its casting was declared on — and the die a slot above 4 adds goes with it',
    'and the condition on it is a second absence, because the rider fires only when the creature hit was standing in the Emanation at the time',
    'the damage type is chosen when the attack is made rather than when the spell is cast, which is a choice at a moment no casting record reaches',
    'the ground in the Emanation is not Difficult Terrain for the caster’s enemies: an Emanation may be expensive ground now, and a patch charges **whoever** crosses it at the rate the square holds — the lattice has no notion of a side, and a rate true of one creature and not another is not a property of the ground',
  ],
};

/**
 * SRD Control Water:
 *
 * > _Level 4 Transmutation (Cleric, Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Concentration, up to 10 minutes.
 * > "Until the spell ends, you control any water inside an area you choose
 * > that is a Cube up to 100 feet on a side, using one of the following
 * > effects. As a Magic action on your later turns, you can repeat the same
 * > effect or choose a different one. ... Any Huge or smaller vehicles struck
 * > by the wave have a 25 percent chance of capsizing. ... it makes a Strength
 * > saving throw. On a failed save, the creature takes 2d8 Bludgeoning
 * > damage."
 *
 * Four effects, switched between on any later turn, over water the world model
 * does not contain. The one clause that is arithmetic rather than fiction — a
 * twenty-five percent chance — is a die outside the D20 pipeline, which no
 * effect asks the generator for.
 */
export const CONTROL_WATER: SpellDefinition = {
  id: 'control-water',
  name: 'Control Water',
  level: 4,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'nothing is controlled: the caster picks one of Flood, Part Water, Redirect Flow and Whirlpool when the spell is cast and may switch to another as a Magic action on any later turn, and a casting records neither the choice nor the switching',
    'so the whirlpool never forms, and with it go the Strength save on entering it, the 2d8 Bludgeoning on a failure and the ten feet a creature nearby is pulled toward it',
    'the 25 percent chance of a vehicle capsizing is not rolled: no effect asks the generator for a die outside the D20 pipeline',
    'and the Strength (Athletics) check to swim away is not offered, because there is nothing to swim away from',
    'the water itself, the hundred-foot Cube, the twenty-foot rise, the wave and the trench are the DM’s — the world model holds creatures, landmarks and templates, and no water at all',
  ],
};

/**
 * SRD Giant Insect:
 *
 * > _Level 4 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** Concentration, up to 10 minutes.
 * > "You summon a giant insect ... The creature disappears when it drops to 0
 * > Hit Points or when the spell ends. ... **AC** 11 + the spell's level ...
 * > **Speed** 40 ft., Climb 40 ft., Fly 40 ft."
 *
 * Find Steed's shape at level 4: the stat block is printed inside the spell,
 * its Armour Class scales with the slot, and a casting adds no creature to a
 * scene. Its only recorded blocker, and reading the paragraph found no second.
 */
export const GIANT_INSECT: SpellDefinition = {
  id: 'giant-insect',
  name: 'Giant Insect',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'no insect appears: the spell is a stat block printed inside its own entry, and a casting adds no creature to a scene',
    'so its Armour Class of 11 + the spell’s level is not computed, its Speeds on the ground, up a wall and in the air belong to nobody, and its attacks are never rolled',
    'and it cannot disappear at 0 Hit Points or when the spell ends, for want of ever having been there',
    'which insect it is, and the orders it follows, are the DM’s',
  ],
};

/**
 * SRD Glyph of Warding:
 *
 * > _Level 3 Abjuration (Bard, Cleric, Wizard)._ **Casting Time:** 1 hour.
 * > **Range:** Touch. **Duration:** Until dispelled or triggered.
 * > "You inscribe a glyph that later unleashes a magical effect. ... The glyph
 * > is nearly imperceptible and requires a successful Wisdom (Perception)
 * > check against your spell save DC to notice. ... You decide what triggers
 * > the glyph when you cast the spell. ... You can refine the trigger so that
 * > only creatures of certain types activate it. ... _Spell Glyph._ You can
 * > store a prepared spell of level 3 or lower in the glyph by casting it as
 * > part of creating the glyph."
 *
 * The hour is real and the "until dispelled or triggered" is real — and so is
 * the rune. **The trigger is a decision**: the caster invents it and the
 * engine holds nothing it could read it from, so `triggerGlyph` on the DM's
 * door says it occurred, and `triggered` is the effect list that door fires —
 * a Dexterity save over the pinned Sphere, 5d8 of the type the caster stated
 * (Chromatic Orb's `damageTypeStated`), half on a success, a die more per slot
 * above 3, and the casting ending because it fired. The record pins the list
 * with its type substituted, so the door opens no catalogue.
 *
 * Two halves stay filed. The **spell glyph** is a casting that casts another
 * spell, stored now and set off later, which is the stack `docs/design/casting.md`
 * declined; and the **creature-type refinement** is a predicate an area does not
 * read — the rune catches whoever stands in the Sphere when the DM says it went
 * off. The check to notice the glyph is the table's to call for.
 */
export const GLYPH_OF_WARDING: SpellDefinition = {
  id: 'glyph-of-warding',
  name: 'Glyph of Warding',
  level: 3,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  // "a 20-foot-radius Sphere centered on the glyph": the glyph is a point the
  // caster touches, and the rune erupts over it later.
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  // "Acid, Cold, Fire, Lightning, or Thunder damage (your choice when you
  // create the glyph)": stated at the inscription and pinned into the rune.
  damageTypeStated: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
  // Nothing happens at the inscription; the rune is what the decision fires.
  effects: [],
  triggered: {
    label: 'Glyph of Warding (the explosive rune)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'dex',
        // "5d8 … on a failed save or half as much damage on a successful one";
        // "increases by 1d8 for each spell slot level above 3".
        damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
        damageType: 'acid',
        onSuccess: 'half',
      },
    ],
  },
  untilDispelled: true,
  dmDecides: [
    'You inscribe it either on a surface (such as a table or a section of floor) or within an object that can be closed (such as a book or chest) to conceal the glyph.',
    "You can also set conditions for creatures that don't trigger the glyph, such as those who say a certain password.",
  ],
  unmodelled: [
    'the spell glyph is not inscribed: "You can store a prepared spell of level 3 or lower in the glyph by casting it as part of creating the glyph" is a casting that casts another spell, stored now and set off later at whoever triggered it, which is the stack the casting design declined',
    'refining the trigger so that only creatures of certain types set it off is not applied: the rune catches whoever stands in the Sphere when the DM says it went off, and a predicate over a creature type is a filter an area does not read',
    'the Wisdom (Perception) check against your spell save DC to notice the glyph is not offered by the casting: the DM calls for it when somebody searches, and the DC is the sheet’s',
    'the ten feet the surface or object may be moved before the glyph breaks is the DM’s to watch, who ends the casting when it does',
  ],
};

/**
 * SRD Magic Circle:
 *
 * > _Level 3 Abjuration (Cleric, Paladin, Warlock, Wizard)._ **Casting Time:**
 * > 1 minute. **Range:** 10 feet. **Duration:** 1 hour.
 * > "... If the creature tries to use teleportation or interplanar travel to
 * > do so, it must first succeed on a Charisma saving throw. The creature has
 * > Disadvantage on attack rolls against targets within the Cylinder. Targets
 * > within the Cylinder can't be possessed by or gain the Charmed or
 * > Frightened condition from the creature."
 *
 * The minute and the hour are the definition's; the Cylinder and its four
 * clauses are four different absences, and the roll-and-damage note names this
 * spell by name for one of them — a filter on the **attacker's** creature
 * type, which a selector has at neither end.
 */
export const MAGIC_CIRCLE: SpellDefinition = {
  id: 'magic-circle',
  name: 'Magic Circle',
  level: 3,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  // "centered on a point on the ground that you can see within range"
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  // "a 10-foot-radius, 20-foot-tall Cylinder of magical energy"
  area: { kind: 'cylinder', radius: 10, height: 20, origin: 'point' },
  effects: [],
  // "Choose one or more of the following types of creatures: Celestials,
  // Elementals, Fey, Fiends, or Undead." Stated at the casting and filled into
  // every clause below that says so.
  typesStated: { options: ['Celestial', 'Elemental', 'Fey', 'Fiend', 'Undead'] },
  // "Each time you cast this spell, you can cause its magic to operate in the
  // reverse direction, preventing a creature of the specified type from
  // leaving the Cylinder and protecting targets outside it." Two directions,
  // the same three sentences turned round, so each is a branch's.
  options: {
    inward: {
      label: 'Inward',
      areaStanding: [
        // "The creature can't willingly enter the Cylinder by nonmagical
        // means. If the creature tries to use teleportation or interplanar
        // travel to do so, it must first succeed on a Charisma saving throw."
        { kind: 'bars-passage', to: { types: 'stated' }, crossing: 'in', saveToCross: 'cha' },
        // "The creature has Disadvantage on attack rolls against targets
        // within the Cylinder."
        { kind: 'attack-mode', mode: 'disadvantage', attackerType: 'stated' },
        // "Targets within the Cylinder can't be possessed by or gain the
        // Charmed or Frightened condition from the creature."
        {
          kind: 'condition-immunity',
          conditions: ['charmed', 'frightened'],
          fromTypes: 'stated',
        },
      ],
    },
    outward: {
      label: 'Reverse',
      // "preventing a creature of the specified type from **leaving** the
      // Cylinder and protecting targets outside it." Two narrowings and not
      // one, which the reversed branch needed and did not have: `outside` says
      // whom the two protective clauses reach, and `attackerInside` says whom
      // they protect them *from* — the creature the circle is penning in. With
      // only the first, a Fiend walking past on the road had Disadvantage
      // against a cleric on the far side of the field and could Charm nobody
      // out there, which is a protection the spell does not grant and one no
      // circle would have to be anywhere near.
      areaStanding: [
        { kind: 'bars-passage', to: { types: 'stated' }, crossing: 'out', saveToCross: 'cha' },
        {
          kind: 'attack-mode',
          mode: 'disadvantage',
          attackerType: 'stated',
          outside: true,
          attackerInside: true,
        },
        {
          kind: 'condition-immunity',
          conditions: ['charmed', 'frightened'],
          fromTypes: 'stated',
          outside: true,
          attackerInside: true,
        },
      ],
    },
  },
  durationSeconds: 3600,
  // "_Using a Higher-Level Spell Slot._ The duration increases by 1 hour for
  // each spell slot level above 3." An hour a level, written out as the six
  // bands the six higher slots reach: the field is a table of whole durations
  // rather than increments, because the SRD prints a different table for every
  // spell that has one and no arithmetic produces them all.
  durationAtSlot: { 4: 7200, 5: 10800, 6: 14400, 7: 18000, 8: 21600, 9: 25200 },
  dmDecides: [
    'Glowing runes appear wherever the Cylinder intersects with the floor or other surface.',
  ],
  unmodelled: [
    'possession is not a state the engine holds, so "can’t be possessed by … the creature" is the DM’s; the Charmed and Frightened halves of the sentence are refused',
    'interplanar travel is not modelled — there is one scene — so the save is raised for a teleport and for nothing else',
  ],
};

/**
 * SRD Confusion:
 *
 * > _Level 4 Enchantment (Bard, Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature in a 10-foot-radius Sphere centered on a point you choose
 * > within range must succeed on a Wisdom saving throw, or that target can't
 * > take Bonus Actions or Reactions and must roll 1d10 at the start of each of
 * > its turns to determine its behavior for that turn, consulting the table
 * > below."
 *
 * The Sphere and the Wisdom save are ordinary; what a failure buys is not. The
 * target loses two thirds of its action economy — which no spell may take
 * away — and then rolls a d10 on a behaviour table every turn, which is a die
 * outside the D20 pipeline deciding what somebody does.
 */
export const CONFUSION: SpellDefinition = {
  id: 'confusion',
  name: 'Confusion',
  level: 4,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save is not raised, because what a failure costs cannot be written: "can’t take Bonus Actions or Reactions" forbids two spenders by name, and `mayAct` is guarded by the conditions the engine names and by nothing a spell says',
    'the 1d10 rolled at the start of each of the target’s turns is not rolled either: no effect asks the generator for a die outside the D20 pipeline, and the 1d4 for a direction on one of its rows is a second one',
    'so the behaviour table — the attack on a random creature, the wasted turn, the movement in a rolled direction — is the DM’s, and it is the whole of what this spell does',
    'the Sphere growing by 5 feet for each slot level above 4 is not applied; a slot reaches damage dice, a target count and a duration, and never an area',
  ],
};

/**
 * SRD Arcane Hand:
 *
 * > _Level 5 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a Large hand of shimmering magical energy in an unoccupied
 * > space that you can see within range. ... The hand is an object that has AC
 * > 20 and Hit Points equal to your Hit Point maximum. If it drops to 0 Hit
 * > Points, the spell ends. ... **Clenched Fist.** ... On a hit, the target
 * > takes 5d8 Force damage. **Forceful Hand.** ... **Grasping Hand.** ...
 * > **Interposing Hand.** The hand grants you Half Cover."
 *
 * Eighteen clauses read sentence by sentence and ten shapes between them,
 * which makes this the most blocked spell in the book. The hand is a thing
 * with an Armour Class and a hit point total that is not a creature, it moves
 * sixty feet on a Bonus Action, and each of its four modes is a different
 * missing mechanism.
 */
export const ARCANE_HAND: SpellDefinition = {
  id: 'arcane-hand',
  name: 'Arcane Hand',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the hand is not in the scene: an object with AC 20 and Hit Points equal to the caster’s own maximum is a stat block, and one that does not occupy its space and moves sixty feet on a Bonus Action is an area that moves by itself as well',
    'so the spell does not end when it drops to 0 Hit Points, which is a casting ended by a fact nothing records',
    'and none of the four modes is offered: the Clenched Fist’s melee spell attack and 5d8 Force, the Forceful Hand’s Strength save and the push of five feet plus five times the spellcasting modifier, the Grasping Hand’s Dexterity save and Grappled condition with the spell save DC as its escape, and the Interposing Hand’s Half Cover',
    'which mode is taken is chosen on each later turn rather than at the casting, and the Huge-or-smaller rule two of them carry selects a target by size',
    'the Grasping Hand’s crush — 4d6 plus the spellcasting ability modifier on a Bonus Action while it holds somebody — is damage with neither an attack roll nor a saving throw in front of it, which has no effect kind',
    'the hand’s space counting as Difficult Terrain for the caster’s enemies is not charged, and the 2d8 and 2d6 a slot above 5 adds scale damage nothing rolls',
  ],
};

/**
 * SRD Dispel Evil and Good:
 *
 * > _Level 5 Abjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "For the duration, Celestials, Elementals, Fey, Fiends, and Undead have
 * > Disadvantage on attack rolls against you. You can end the spell early by
 * > using either of the following special functions. _Break Enchantment._ ...
 * > _Dismissal._ ... The target must succeed on a Charisma saving throw or be
 * > sent back to its home plane if it isn't there already."
 *
 * The roll-and-damage note names this spell in its table of what a selector
 * does not reach, and the two special functions are the other half: each ends
 * the casting early, and one of them puts a creature on another plane.
 */
export const DISPEL_EVIL_AND_GOOD: SpellDefinition = {
  id: 'dispel-evil-and-good',
  name: 'Dispel Evil and Good',
  level: 5,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Disadvantage five creature types have on attack rolls against the caster is not granted: a selector reaches a roll by family, ability and skill, and never by the attacker’s creature type',
    'neither special function is offered, and each of them ends the casting early on the caster’s own decision — a dismissal a spell offers rather than a deadline or a broken Concentration',
    'so Break Enchantment does not free a creature possessed by, Charmed by or Frightened by one of those types, which would also be an immunity narrowed to who caused it',
    'and Dismissal does not raise its Charisma save or send the loser home: a creature on the Shadowfell or in the Feywild is somewhere the scene has no second place for',
  ],
};

/**
 * SRD Eyebite:
 *
 * > _Level 6 Necromancy (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "One creature of your choice within 60 feet of you that you can see must
 * > succeed on a Wisdom saving throw or be affected by one of the following
 * > effects of your choice for the duration. ... On each of your turns until
 * > the spell ends, you can take a Magic action to target another creature but
 * > can't target a creature again if it has succeeded on a save against this
 * > casting of the spell."
 *
 * Three ordinary conditions behind two things the format cannot say: which of
 * the three the caster picked, and a Magic action on every later turn that
 * forces the same save on somebody new — while remembering who has already
 * saved against this casting.
 */
export const EYEBITE: SpellDefinition = {
  id: 'eyebite',
  name: 'Eyebite',
  level: 6,
  school: 'necromancy',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save is not raised: which of Asleep, Panicked and Sickened a failure buys is chosen when the spell is cast, and a casting has nowhere to record a choice made at the moment it was made',
    'so the Unconscious, Frightened and Poisoned conditions are not applied',
    'and the Magic action taken on every later turn that forces the save on a new creature is not offered — an activation calls a save on a target the caster names then, and this one also remembers who has already succeeded against this casting',
    'the sleeper waking on any damage, and the Frightened creature’s escape sixty feet away out of sight, are two more causes that would end one effect of the casting rather than the casting',
    'the Dash away from the caster by the safest and shortest route is the DM’s',
  ],
};

/**
 * SRD Magic Jar:
 *
 * > _Level 6 Necromancy (Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** Self. **Duration:** Until dispelled.
 * > "Your body falls into a catatonic state as your soul leaves it and enters
 * > the container ... The target makes a Charisma saving throw. On a failed
 * > save, your soul enters the target's body ... Your Hit Points, Hit Point
 * > Dice, Strength, Dexterity, Constitution, Speed, and senses are replaced by
 * > the creature's."
 *
 * Seventeen clauses, and the spell is one idea the engine has no room for: a
 * creature's soul somewhere other than its body. The minute and the open-ended
 * duration are real; the container, the possession and the statistics
 * overwritten by somebody else's are not.
 *
 * **What the engine can say is what the catatonic body may do**, and it is
 * two rules out of one entry — "you can't move or take Reactions" beside "The
 * only action you can take is to project your soul". This is the pair
 * `actionRuleKey` was written for: keyed by the source alone the second would
 * evict the first, and the paragraph would lose half of itself between the
 * definition and the state.
 *
 * **The narrowed slot names nothing, and that is the sentence rather than a
 * shorthand for `forbids`.** Projecting a soul is no action a spender can
 * tell apart, so every action the engine *can* name is refused and the one
 * the book permits is one it could never have offered. Leaving the Action
 * slot open instead would let a body whose soul has left it take the Attack
 * action, which is the confident wrong answer this whole file exists to
 * refuse. `checkActionRule` admits the empty list for exactly this reason,
 * and Confusion's "the target takes no action" is the other writer.
 */
export const MAGIC_JAR: SpellDefinition = {
  id: 'magic-jar',
  name: 'Magic Jar',
  level: 6,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'self' },
  // "Range: Self", so the body the spell empties is the caster's own — and a
  // caster may not name themselves unless the target rule says so.
  targets: { count: 1, self: true },
  effects: [
    { kind: 'action-rule', rule: { kind: 'forbids', slots: ['movement', 'reaction'] } },
    { kind: 'action-rule', rule: { kind: 'permits-only', slot: 'action', actions: [] } },
  ],
  untilDispelled: true,
  unmodelled: [
    'the caster’s soul does not leave: a creature is in the scene or it is not, and a soul in a container while its body lies catatonic is a second place to put one',
    'so the body is held still by the two rules the same sentence prints rather than by any account of where its soul went, and the one action the book leaves it — projecting the soul up to 100 feet — is no action a spender can tell apart',
    'so the Charisma save to possess a Humanoid is never raised, and the day a creature is safe from a second attempt after succeeding is never counted',
    'possession itself is unwritable twice over: the possessor controls the host, which is an action economy belonging to somebody else, and the host’s Hit Points, Hit Point Dice, Strength, Dexterity, Constitution, Speed and senses replace the possessor’s, which is one creature’s abilities written over another’s',
    'the creatures warded by Protection from Evil and Good or Magic Circle that cannot be possessed are a second casting refusing this one',
    'the spell lasts until dispelled and the caster may simply return to the body, which is a casting dismissed early rather than one that ran out',
    'the container, its hundred feet, the deaths when it is destroyed or the body is too far away, and the Incapacitated soul perceiving from inside it are the DM’s',
  ],
};

/**
 * SRD Summon Dragon:
 *
 * > _Level 5 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** Concentration, up to 1 hour.
 * > "You call forth a Dragon spirit. It manifests in an unoccupied space that
 * > you can see within range and uses the Draconic Spirit stat block. ...
 * > **AC** 14 + the spell's level ... **HP** 50 + 10 for each spell level
 * > above 5 ... **Speed** 30 ft., Fly 60 ft., Swim 30 ft."
 *
 * The third spell in the book whose whole content is a stat block printed
 * inside its own entry, after Find Steed and Giant Insect — and with those two
 * it is the entire population `a-stat-block-created-mid-fight` would finish.
 */
export const SUMMON_DRAGON: SpellDefinition = {
  id: 'summon-dragon',
  name: 'Summon Dragon',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'no Dragon appears: the spell is a stat block printed inside its own entry, and a casting adds no creature to a scene',
    'so its Armour Class of 14 + the spell’s level and its 50 + 10 Hit Points per level above 5 are not computed, and its Speeds on the ground, in the air and in the water belong to nobody',
    'its place in the initiative order — the caster’s count, immediately after the caster’s turn — is a turn for a creature that is not there',
    'the verbal commands it obeys, and the Dodge action it falls back on when given none, are the DM’s',
  ],
};

/**
 * SRD Wind Walk:
 *
 * > _Level 6 Transmutation (Druid)._ **Casting Time:** 1 minute.
 * > **Range:** 30 feet. **Duration:** 8 hours.
 * > "You and up to ten willing creatures of your choice within range assume
 * > gaseous forms for the duration ... While in this cloud form, a target has
 * > a Fly Speed of 300 feet and can hover; it has Immunity to the Prone
 * > condition; and it has Resistance to Bludgeoning, Piercing, and Slashing
 * > damage. The only actions a target can take in this form are the Dash
 * > action or a Magic action to begin reverting ... Reverting takes 1 minute,
 * > during which the target has the Stunned condition."
 *
 * The minute of casting, the eight hours and the ten creatures are real.
 * One sentence carries three different absences — a Fly Speed, a condition
 * immunity and a damage Resistance — and the sentence after it is the one the
 * engine can say: **the action list is narrowed**, which is the standalone
 * half of the ninth sourced grant and the sentence `ActionRule`'s
 * `permits-only` was derived from.
 *
 * **It fails closed**, which is what makes it honest about the actions the
 * engine cannot tell apart: a cloud may Dash or take the Magic action and is
 * refused everything else. "To begin reverting to its normal form" is a
 * narrowing *inside* the Magic action that no spender could tell from any
 * other, and it stays the table's rather than being quietly dropped.
 *
 * **`self: true` arrives with the effect.** "You **and** up to ten willing
 * creatures" includes the caster, and `namedTargets` refuses a caster who
 * names themselves unless the target rule says so — which did not matter
 * while the definition resolved nothing and is a wrong answer the moment it
 * does. The same correction Longstrider, Mage Armor and Stoneskin took.
 */
export const WIND_WALK: SpellDefinition = {
  id: 'wind-walk',
  name: 'Wind Walk',
  level: 6,
  school: 'transmutation',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 10, self: true },
  // No roll is asked for, so the rule stands on its own rather than riding an
  // outcome — the shape `armor-class`, `damage-defense` and `speed` already
  // take. The eight hours are the casting's own deadline, so the grant needs
  // no `lasts`: `releaseCasting` lifts it when the spell ends.
  effects: [
    {
      kind: 'action-rule',
      rule: { kind: 'permits-only', slot: 'action', actions: ['dash', 'magic'] },
    },
  ],
  durationSeconds: 28_800,
  unmodelled: [
    'nobody turns to cloud: the Fly Speed of 300 feet is a movement mode rather than a number added to a Speed, and a creature has one Speed with no modes beside it',
    'the Immunity to the Prone condition and the Resistance to Bludgeoning, Piercing and Slashing in the same sentence are not conferred either',
    'the Magic action a cloud is left is any Magic action: "to begin reverting to its normal form" narrows it to one the engine cannot tell from another, so the narrowing the spell prints is enforced and the errand inside it is the DM’s',
    'so the minute of reverting and the Stunned condition through it are not applied, and neither is reverting back',
    'the descent of 60 feet per round for a minute when the spell ends in mid-air, and the fall after it, are the DM’s: nothing falls',
  ],
};

/**
 * SRD Animal Shapes:
 *
 * > _Level 8 Transmutation (Druid)._ **Casting Time:** Action. **Range:** 30
 * > feet. **Duration:** 24 hours.
 * > "Choose any number of willing creatures that you can see within range.
 * > Each target shape-shifts into a Large or smaller Beast of your choice that
 * > has a Challenge Rating of 4 or lower. ... A target's game statistics are
 * > replaced by the chosen Beast's statistics, but the target retains its
 * > creature type; Hit Points; Hit Point Dice; alignment; ability to
 * > communicate; and Intelligence, Wisdom, and Charisma scores."
 *
 * The day is real and the "any number" is real. What is not is a form picked
 * per target out of every Beast at Challenge Rating 4 or lower — a selector by
 * size and by a rating the engine does not hold, and a different one for each
 * creature the casting caught.
 */
export const ANIMAL_SHAPES: SpellDefinition = {
  id: 'animal-shapes',
  name: 'Animal Shapes',
  level: 8,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true },
  requiresSight: true,
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'nobody shape-shifts: the form is a Beast selected by size and by a Challenge Rating of 4 or lower, and a target rule selects by creature type and by armour worn — a rating is a fact the engine does not hold at all',
    'and a different form may be chosen for each target, where a casting applies one effect list to everybody it caught',
    'so the statistics are not replaced, and the Temporary Hit Points equal to the first form’s Hit Points are not granted — nor do they vanish when the spell ends, because the rest of the sentence never happened',
    'the Magic action on later turns that transforms the targets again is not offered, and neither is the Bonus Action by which a target ends its own transformation: a casting is not dismissed by the creature it landed on',
    'the melded equipment and the anatomy that limits what a Beast may do are the DM’s',
  ],
};

/**
 * SRD Antimagic Field:
 *
 * > _Level 8 Abjuration (Cleric, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 hour.
 * > "An aura of antimagic surrounds you in 10-foot Emanation. No one can cast
 * > spells, take Magic actions, or create other magical effects inside the
 * > aura, and those things can't target or otherwise affect anything inside
 * > it. ... no one can teleport into or out of it or use planar travel there.
 * > ... Ongoing spells, except those cast by an Artifact or a deity, are
 * > suppressed in the area."
 *
 * A ten-foot Emanation on the caster is the one part of this spell that needs
 * nothing new — Spirit Guardians already writes it. Everything the Emanation
 * then does is magic refusing magic: forbidding the Magic action to everybody
 * standing in it, refusing a casting resolved somewhere else, and suspending
 * an ongoing spell while its clock goes on running.
 */
export const ANTIMAGIC_FIELD: SpellDefinition = {
  id: 'antimagic-field',
  name: 'Antimagic Field',
  level: 8,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the aura does nothing: forbidding the Magic action outright, to whoever is standing inside rather than to a named target, is a lever no spell has — the economy is guarded by the conditions the engine names',
    'and the other half is an area that refuses a casting resolved elsewhere, which is not ending a casting but declining to let one arrive',
    'ongoing spells are not suppressed, nor do their deadlines go on running while they are; a casting is running or it is over',
    'the magic items switched off inside it, the areas of effect that cannot extend into it, the portals that close, and its immunity to Dispel Magic are the DM’s',
  ],
};

/**
 * SRD Antipathy/Sympathy:
 *
 * > _Level 8 Enchantment (Bard, Druid, Wizard)._ **Casting Time:** 1 hour.
 * > **Range:** 60 feet. **Duration:** 10 days.
 * > "As you cast the spell, choose whether it creates antipathy or sympathy,
 * > and target one creature or object that is Huge or smaller. Then specify a
 * > kind of creature ... A creature of the chosen kind makes a Wisdom saving
 * > throw when it comes within 120 feet of the target. ... _Ending the
 * > Effect._ If the Frightened or Charmed creature ends its turn more than 120
 * > feet away from the target, the creature makes a Wisdom saving throw."
 *
 * The hour and the ten days are the definition's. The save is raised by
 * something that **happened** — a creature coming within a hundred and twenty
 * feet — and the turn hook is the only thing that raises one, which is the
 * clause this spell is the sole recorded consumer of.
 */
export const ANTIPATHY_SYMPATHY: SpellDefinition = {
  id: 'antipathy-sympathy',
  name: 'Antipathy/Sympathy',
  level: 8,
  school: 'enchantment',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 864_000,
  unmodelled: [
    'the Wisdom save is never raised: it is owed by a creature that has come within 120 feet of the target, and the turn boundary is the only thing that raises a repeat save',
    'whether a failure buys Frightened or Charmed is chosen when the spell is cast, and the kind of creature it answers to is named then as well — a predicate over a creature type where an area holds an explicit list',
    'so neither condition is applied, and the movement each compels — as far away as possible, or as close as possible, by the safest route — is an action economy no spell reaches',
    'the second Wisdom save at the end of a turn more than 120 feet away is a second trigger of the same kind, and the minute of immunity after a success is a third',
    'a Huge or smaller creature *or object* is a target rule selecting by size and admitting a thing that is not a creature at all',
  ],
};

/**
 * SRD Astral Projection:
 *
 * > _Level 9 Necromancy (Cleric, Warlock, Wizard)._ **Casting Time:** 1 hour.
 * > **Range:** 10 feet. **Duration:** Until dispelled.
 * > "You and up to eight willing creatures within range project your astral
 * > bodies into the Astral Plane ... Each target's body is left behind in a
 * > state of suspended animation; it has the Unconscious condition ... If a
 * > target's body or astral form drops to 0 Hit Points, the spell ends for
 * > that target."
 *
 * The hour, the eight creatures and the open-ended duration are real. The
 * spell is nine people in two places at once, which is the second place to put
 * a creature at its plainest — and it ends per target on a fact about vitals
 * the engine is not keeping for a body that is not in the scene.
 */
export const ASTRAL_PROJECTION: SpellDefinition = {
  id: 'astral-projection',
  name: 'Astral Projection',
  level: 9,
  school: 'necromancy',
  castingTime: 'long',
  castingSeconds: 3600,
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 8 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'nobody projects: an astral form on another plane while the body lies here is one creature in two places, and the scene is one place',
    'so the body is not left Unconscious in suspended animation, and the damage that reaches one form without reaching the other has nothing to reach',
    'the spell does not end for a target whose body or astral form drops to 0 Hit Points — a casting ends on its deadline, on Concentration, on a dispel or on a recast, and never per target on somebody’s vitals',
    'nor does the Magic action that dismisses it for everybody: a casting is not spent by the caster deciding it is over',
    'the silvery cord, the travelling, the re-entry on a new plane and the death when the cord is cut are the DM’s',
  ],
};

/**
 * SRD Conjure Celestial:
 *
 * > _Level 7 Conjuration (Cleric)._ **Casting Time:** Action. **Range:** 90
 * > feet. **Duration:** Concentration, up to 10 minutes.
 * > "You conjure a spirit from the Upper Planes, which manifests as a pillar
 * > of light in a 10-foot-radius, 40-foot-high Cylinder ... For each creature
 * > you can see in the Cylinder, choose which of these lights shines on it:
 * > **Healing Light.** The target regains Hit Points equal to 4d12 plus your
 * > spellcasting ability modifier. **Searing Light.** The target makes a
 * > Dexterity saving throw, taking 6d12 Radiant damage."
 *
 * **Not a stat block — a pillar of light.** What blocks it is that the caster
 * chooses *per creature* whether the pillar heals or burns, and that the
 * pillar moves thirty feet whenever the caster does.
 */
export const CONJURE_CELESTIAL: SpellDefinition = {
  id: 'conjure-celestial',
  name: 'Conjure Celestial',
  level: 7,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the Cylinder is not in the world: it may be moved up to thirty feet whenever the caster moves, and a casting pins its template where it was put',
    'and the caster picks, for each creature inside it, whether the light heals or burns — where a casting applies one effect list to everybody it caught',
    'so neither 4d12 plus the spellcasting ability modifier of healing nor the Dexterity save and 6d12 Radiant, half on a success, is resolved, and the extra 1d12 a slot above 7 buys goes with them',
    'the once-per-turn cap, and the trigger on a creature entering the Cylinder or ending its turn there, go with the Cylinder',
    'the Bright Light that fills it is the DM’s',
  ],
};

/**
 * SRD Delayed Blast Fireball:
 *
 * > _Level 7 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Concentration, up to 1 minute.
 * > "A beam of yellow light flashes from you, then condenses at a chosen point
 * > within range as a glowing bead for the duration. When the spell ends, the
 * > bead explodes ... The spell's base damage is 12d6, and the damage
 * > increases by 1d6 whenever your turn ends and the spell hasn't ended. If a
 * > creature touches the glowing bead before the spell ends, that creature
 * > makes a Dexterity saving throw."
 *
 * Fireball with its whole resolution moved to the far end of the casting: the
 * Sphere fires **when the spell ends**, which no effect does, and the damage
 * it will deal grows by a die at each of the caster's turn boundaries, which
 * no area trigger reaches.
 */
export const DELAYED_BLAST_FIREBALL: SpellDefinition = {
  id: 'delayed-blast-fireball',
  name: 'Delayed Blast Fireball',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'nothing explodes: the Sphere resolves when the casting ends rather than when it is made, and an effect fires at the casting or on a trigger and never at the deadline',
    'so the Dexterity save and the accumulated Fire damage, half on a success, are not resolved',
    'and the accumulation is a second absence: the total grows by 1d6 at the end of every one of the caster’s turns, which is a turn boundary the area does not watch',
    'the creature that touches the bead, its Dexterity save, and the forty feet it may throw the bead on a success are a trigger on handling an object the engine does not hold',
    'the flammable objects set alight are the DM’s',
  ],
};

/**
 * SRD Divine Word:
 *
 * > _Level 7 Evocation (Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "Each creature of your choice in range makes a Charisma saving throw. On a
 * > failed save, a target that has 50 Hit Points or fewer suffers an effect
 * > based on its current Hit Points, as shown in the Divine Word Effects
 * > table. Regardless of its Hit Points, a Celestial, an Elemental, a Fey, or
 * > a Fiend target that fails its save is forced back to its plane of origin."
 *
 * The Bonus Action is real and everything after the save reads a number no
 * outcome asks for. This is the fourth spell in the family a ranked map
 * counted as three: the Power Words, and this.
 */
export const DIVINE_WORD: SpellDefinition = {
  id: 'divine-word',
  name: 'Divine Word',
  level: 7,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true },
  effects: [],
  unmodelled: [
    'the Charisma save is not raised: what a failure costs is read off the target’s current Hit Points against a table of four bands, and no outcome asks the vitals a question',
    'so none of the four effects lands — the Deafened, the Blinded, the Stunned and the death at 20 Hit Points or fewer',
    'and the sentence beside them applies a fifth effect to four creature types regardless of their Hit Points, which is a second effect list inside one casting',
    'being forced back to a plane of origin, and barred from returning for 24 hours, is a second place to put a creature and a deadline on being kept there',
  ],
};

/**
 * SRD Earthquake:
 *
 * > _Level 8 Transmutation (Cleric, Druid, Sorcerer)._ **Casting Time:**
 * > Action. **Range:** 500 feet. **Duration:** Concentration, up to 1 minute.
 * > "When you cast this spell and at the end of each of your turns for the
 * > duration, each creature on the ground in the area makes a Dexterity saving
 * > throw. On a failed save, a creature has the Prone condition, and its
 * > Concentration is broken. _Fissures._ A total of 1d6 fissures open ... If a
 * > structure drops to 0 Hit Points, it collapses."
 *
 * Sleet Storm's pairing at level 8 — a condition beside a broken Concentration
 * in one failure — on an area that fires again at the end of every one of the
 * caster's turns, and with buildings that have hit points.
 */
export const EARTHQUAKE: SpellDefinition = {
  id: 'earthquake',
  name: 'Earthquake',
  level: 8,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 500 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the hundred-foot Circle is not in the world, and it would have to fire again at the end of each of the caster’s turns, which is a boundary an area does not watch',
    'so the Dexterity save is not raised — and half of what a failure costs cannot be written anyway: "has the Prone condition, and its Concentration is broken" pairs an ordinary condition with a broken Concentration, and no outcome of a saving throw asks for one',
    'the 1d6 fissures and their 1d10 × 10 feet of depth are dice outside the D20 pipeline, and what they open is ground rather than an effect',
    'so falling into one is not resolved, because nothing falls',
    'the structures are not shaken: a building with an Armour Class and Hit Points is not a creature, and the world model holds creatures, landmarks and templates',
    'so the 12d6 Bludgeoning from a collapse, the Prone beside it and the DC 20 Strength (Athletics) check to dig out are not offered — and that DC is printed rather than derived from the caster',
    'the Difficult Terrain the rubble leaves is not charged by the foot',
  ],
};

/**
 * SRD Imprisonment:
 *
 * > _Level 9 Abjuration (Warlock, Wizard)._ **Casting Time:** 1 minute.
 * > **Range:** 30 feet. **Duration:** Until dispelled.
 * > "The target must make a Wisdom saving throw. ... Divination spells can't
 * > locate or perceive the imprisoned target, and the target can't teleport.
 * > **Burial.** ... The target has the Restrained condition and can't be moved
 * > by any means. **Hedged Prison.** The target is trapped in a demiplane that
 * > is warded against teleportation and planar travel. **Slumber.** The target
 * > has the Unconscious condition and can't be awoken."
 *
 * The minute and the endless duration are the definition's. Which of the six
 * prisons the target goes into is chosen at the casting, one of them is a
 * demiplane, and the conditions all carry "and can't be ended" clauses that
 * write over what the rest of the rules believe about a creature.
 */
export const IMPRISONMENT: SpellDefinition = {
  id: 'imprisonment',
  name: 'Imprisonment',
  level: 9,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the Wisdom save is not raised: which prison a failure buys is chosen when the spell is cast, and a casting has nowhere to record a choice made at the moment it was made',
    'so none of the six lands — the Restrained that cannot be lifted by any means, the Unconscious that cannot be woken, the demiplane, the chain, the slab or the minimus containment',
    'and two of them override what the other rules believe about the creature rather than adding to it, which nothing a casting writes may do',
    'the target cannot be stopped from teleporting, and the Divination spells that cannot find it are a second casting this one refuses',
    'the named condition that releases it early is a dismissal a spell offers, and a casting ends on its deadline, on Concentration, on a dispel or on a recast',
  ],
};

/**
 * SRD Prismatic Spray:
 *
 * > _Level 7 Evocation (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "Each creature in the Cone makes a Dexterity saving throw. For each
 * > target, roll 1d8 to determine which color ray affects it, consulting the
 * > Prismatic Rays table. ... **Indigo.** *Failed Save:* The target has the
 * > Restrained condition and makes a Constitution saving throw at the end of
 * > each of its turns. ... If it fails three times, it has the Petrified
 * > condition."
 *
 * Eight different effects out of one casting, chosen per target by a d8 the
 * engine has no way to roll — and two of the eight open a running tally of
 * successes and failures, which is the death-save shape rather than the
 * repeat-save one.
 */
export const PRISMATIC_SPRAY: SpellDefinition = {
  id: 'prismatic-spray',
  name: 'Prismatic Spray',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the Cone is not laid down and the Dexterity save is not raised: which of eight rays reaches each target is decided by a d8 per creature, and no effect asks the generator for a die outside the D20 pipeline',
    'so none of the five damage rays deals its 12d6, and the eighth — two rays at once, rolled again — is a casting resolving twice over',
    'Indigo’s Restrained and the Constitution save at the end of each of the target’s turns are not applied, and the three successes or three failures they are counted toward are a running tally no repeat save holds',
    'Violet’s Blinded and the Wisdom save at the start of the caster’s next turn are not applied either, and the plane the loser is teleported to is a second place to put a creature',
  ],
};

/**
 * SRD Prismatic Wall:
 *
 * > _Level 9 Abjuration (Bard, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** 10 minutes.
 * > "If another creature that can see the wall moves within 20 feet of it or
 * > starts its turn there, the creature must succeed on a Constitution saving
 * > throw or have the Blinded condition for 1 minute. ... Each layer forces
 * > the creature to make a Dexterity saving throw ... The wall, which has AC
 * > 10, can be destroyed one layer at a time."
 *
 * Prismatic Spray's table standing up as a wall: seven layers in one place,
 * each a template of its own with its own save, destroyed in order, with an
 * Armour Class on the thing itself. One casting holds one template.
 */
export const PRISMATIC_WALL: SpellDefinition = {
  id: 'prismatic-wall',
  name: 'Prismatic Wall',
  level: 9,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is not in the world: seven layers in one place, each with its own save and its own effect, is several templates where a casting holds one',
    'so the Constitution save on coming within twenty feet, and the Blinded for a minute on a failure, are not raised',
    'nor is the Dexterity save each layer forces on a creature passing through, nor the 12d6 of Fire, Acid, Lightning, Poison or Cold behind the first five of them',
    'Indigo’s Restrained and its tally of three, and Violet’s Blinded and the plane it teleports a failure to, go with the layers they belong to',
    'the wall’s own Armour Class of 10 and the order the layers are destroyed in are a thing that can be attacked, which a casting does not create',
    'and the light it sheds, and the Darkness and lower-level magic it refuses, are the DM’s',
  ],
};

/**
 * SRD Project Image:
 *
 * > _Level 7 Illusion (Bard, Wizard)._ **Casting Time:** Action.
 * > **Range:** 500 miles. **Duration:** Concentration, up to 1 day.
 * > "A creature that takes the Study action to examine the image can determine
 * > that it is an illusion with a successful Intelligence (Investigation)
 * > check against your spell save DC."
 *
 * The day on the clock and the five hundred miles of range are the whole of
 * what a definition can hold. Mislead's double with a much longer leash: an
 * illusory copy of the caster somewhere else, seen and heard through, and the
 * casting ends when somebody sees through it.
 */
export const PROJECT_IMAGE: SpellDefinition = {
  id: 'project-image',
  name: 'Project Image',
  level: 7,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 2_640_000 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'the image is not in the scene: an illusory copy of the caster standing five hundred miles away is a second thing with a position and no stat block to hang it on',
    'so the Intelligence (Investigation) check that sees through it is not offered, and the casting does not end when somebody succeeds on one',
    'seeing and hearing through it is not offered either: sight is a pairwise declaration and no creature borrows another’s senses',
    'moving it, speaking through it and making it behave as the caster chooses are the DM’s',
  ],
};

/**
 * SRD Simulacrum:
 *
 * > _Level 7 Illusion (Wizard)._ **Casting Time:** 12 hours. **Range:** Touch.
 * > **Duration:** Until dispelled.
 * > "It uses the game statistics of the original creature at the time of
 * > casting, except it is a Construct, its Hit Point maximum is half as much,
 * > and it can't cast this spell. ... If the simulacrum takes damage, the only
 * > way to restore its Hit Points is to repair it as you take a Long Rest,
 * > during which you expend components worth 100 GP per Hit Point restored.
 * > The simulacrum lasts until it drops to 0 Hit Points."
 *
 * The twelve hours are the longest casting time in the book and they run on
 * the clock. The rest is a creature copied from another creature, healed only
 * during a rest at a hundred gold a point, and a casting that ends when it
 * falls.
 */
export const SIMULACRUM: SpellDefinition = {
  id: 'simulacrum',
  name: 'Simulacrum',
  level: 7,
  school: 'illusion',
  castingTime: 'long',
  castingSeconds: 43_200,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'no duplicate appears: a creature copied from another creature, typed Construct and given half its hit point maximum, is a stat block built at the casting, and a casting adds no creature to a scene',
    'so it cannot be healed the only way it may be — repaired over a Long Rest at 100 GP a Hit Point — which is healing gated on a rest and priced in coin',
    'and the casting does not end when the simulacrum drops to 0 Hit Points, nor when the caster dismisses it as a Magic action',
    'the snow, the ice, the melting away and the fact that it cannot cast this spell itself are the DM’s',
  ],
};

/**
 * SRD Storm of Vengeance:
 *
 * > _Level 9 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 1
 * > mile. **Duration:** Concentration, up to 1 minute.
 * > "Each creature under the cloud when it appears must succeed on a
 * > Constitution saving throw or take 2d6 Thunder damage and have the Deafened
 * > condition for the duration. ... Each creature and object under the cloud
 * > takes 4d6 Acid damage. ... Each target makes a Dexterity saving throw,
 * > taking 10d6 Lightning damage."
 *
 * Six rounds of weather, a different one on each of the caster's turns, over a
 * two-mile circle a mile away. The Acid round is the plainest instance in the
 * book of damage a spell simply applies with neither an attack roll nor a
 * saving throw in front of it.
 */
export const STORM_OF_VENGEANCE: SpellDefinition = {
  id: 'storm-of-vengeance',
  name: 'Storm of Vengeance',
  level: 9,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 5280 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the cloud is not in the world, and what it does changes at the end of each of the caster’s turns — a boundary an area does not watch, and six different effects where a casting holds one',
    'so the Constitution save, the 2d6 Thunder and the Deafened at the moment it appears are not resolved',
    'the 4d6 Acid on the second round is damage with neither an attack roll nor a saving throw in front of it, which has no effect kind',
    'nor is the Dexterity save and 10d6 Lightning of the third round resolved, and the caster chooses who it falls on',
    'the 2d6 Bludgeoning hail, the 1d6 Cold of the last rounds, the Difficult Terrain the ground becomes and the ranged attacks the gale spoils are the DM’s',
  ],
};

/**
 * SRD Symbol:
 *
 * > _Level 7 Abjuration (Bard, Cleric, Druid, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** Touch.
 * > **Duration:** Until dispelled or triggered.
 * > "The glyph is nearly imperceptible and requires a successful Wisdom
 * > (Perception) check against your spell save DC to notice. ... _Death._ Each
 * > target makes a Constitution saving throw, taking 10d10 Necrotic damage ...
 * > _Fear._ ... _Pain._ ... _Sleep._ ... _Stunning._"
 *
 * Glyph of Warding's shape at level 7 with six effects instead of two: the
 * minute of inscribing is real and the "until dispelled or triggered" is real,
 * and which of the six the glyph holds is chosen when it is drawn.
 */
export const SYMBOL: SpellDefinition = {
  id: 'symbol',
  name: 'Symbol',
  level: 7,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'no glyph is inscribed: which of Death, Discord, Fear, Pain, Sleep and Stunning it holds, and what sets it off, are both chosen when the spell is cast, and a casting has nowhere to record a choice made at the moment it was made',
    'so none of the six resolves — the Constitution save and 10d10 Necrotic, the bickering, the Frightened, the Incapacitated, the Unconscious and the Stunned',
    'Discord’s Disadvantage on attack rolls and ability checks goes with the effect that was never chosen',
    'refining the trigger so that only named creature types set it off is a predicate over a creature type, where an area holds an explicit list chosen at the casting',
    'the Wisdom (Perception) check to notice it may be made by anybody who looks, which is a check by somebody the casting never touched',
    'the glyph lasts until dispelled or triggered, and neither is a deadline: a casting the caster wipes away is a dismissal the lifecycle does not offer',
    'Sleep’s sleeper awakens if it takes damage, which would end one effect of the casting on a cause no consequence event carries',
    'the surface or object it is drawn on, the ten-foot diameter and the passwords that excuse a creature are the DM’s',
  ],
};

/**
 * SRD True Polymorph:
 *
 * > _Level 9 Transmutation (Bard, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 hour.
 * > "An unwilling creature can make a Wisdom saving throw, and if it succeeds,
 * > it isn't affected by this spell. ... The target's game statistics are
 * > replaced by the stat block of the new form, but it retains its Hit Points,
 * > Hit Point Dice, alignment, and personality. The target gains a number of
 * > Temporary Hit Points equal to the Hit Points of the new form."
 *
 * Polymorph at the top of the book, and the extra reach is what blocks it: the
 * new form may be any creature or any object, the save is offered only to an
 * *unwilling* target, and holding Concentration for the full hour makes the
 * change permanent.
 */
export const TRUE_POLYMORPH: SpellDefinition = {
  id: 'true-polymorph',
  name: 'True Polymorph',
  level: 9,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'nobody is transformed: the new form is a stat block chosen at the casting out of every creature in the book, or an object, and a casting neither builds one nor writes one over a creature that is already there',
    'so the Temporary Hit Points equal to the new form’s Hit Points are not granted, and the statistics the target keeps are not kept',
    'the Wisdom save is offered only to an unwilling target, which is a target rule reading a fact about consent that the format cannot state',
    'the spell becoming permanent when Concentration is held for the full hour is an effect that fires when the casting ends, and nothing fires then — and what it becomes is a casting that lasts until dispelled, which is a kind of duration rather than a length',
    'an object turned into a creature cannot speak or cast spells, which is an action list narrowed from outside the conditions the engine names',
    'and it does not end when the new form drops to 0 Hit Points or dies; a casting ends on its deadline, on Concentration, on a dispel or on a recast',
    'what the object becomes, and the creature it turns into being under the DM’s control, are the DM’s',
  ],
};

/**
 * SRD Tsunami:
 *
 * > _Level 8 Conjuration (Druid)._ **Casting Time:** 1 minute. **Range:** 1
 * > mile. **Duration:** Concentration, up to 6 rounds.
 * > "When the wall appears, each creature in its area makes a Strength saving
 * > throw, taking 6d10 Bludgeoning damage ... At the end of the turn, the
 * > wall's height is reduced by 50 feet, and the damage the wall deals on
 * > later rounds is reduced by 1d10. ... the creature must succeed on a
 * > Strength (Athletics) check against your spell save DC to move at all."
 *
 * A wall three hundred feet high that moves fifty feet on its own at the end
 * of every turn, shrinking as it goes and taking a die off its damage each
 * round. Six rounds is thirty-six seconds, and that is the number the
 * definition can hold.
 */
export const TSUNAMI: SpellDefinition = {
  id: 'tsunami',
  name: 'Tsunami',
  level: 8,
  school: 'conjuration',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: true,
  range: { kind: 'ranged', feet: 5280 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 36,
  unmodelled: [
    'the wall of water is not in the world: three hundred feet high by three hundred long by fifty thick, moving fifty feet at the end of every turn and losing fifty feet of height as it goes, is a template that moves and shrinks by itself',
    'so the Strength save and the 6d10 Bludgeoning when it appears are not resolved, and neither is the 5d10 on a Huge or smaller creature the wall reaches as it moves — a catch filtered by size',
    'the die the damage loses on each later round is a number that changes between one firing of an area and the next',
    'swimming creatures being unaffected is a second filter on the catch, and the Strength (Athletics) check they must pass to move at all takes a creature’s movement away',
    'the fall when the wall carries somebody, and the water itself, are the DM’s: nothing falls and there is no water',
  ],
};

/*
 * — the three the map used to delete —————————————————————————————————————————
 *
 * Spare the Dying, Enthrall and Flesh to Stone were each written, run and
 * **reverted** rather than shipped, and the reason was the same for all three
 * and had nothing to do with the spells. `TRACKED_ADJUDICATED` was keyed to a
 * mechanical marker, so a spell moving out of `BLOCKED_ON` could only carry the
 * blockers the markers can see in the SRD's English — and each of these three
 * has a blocker written in words the markers do not know: a cantrip's range
 * doubling with caster level, a −10 that reaches one skill, a Construct that
 * succeeds automatically. Those readings were dropped on the way, "no shape
 * sits unclaimed" then demanded that `a-range-that-scales-with-caster-level`,
 * `a-bonus-narrowed-to-a-skill` and `an-automatic-success-by-creature-type` be
 * retired, and retiring a gap that is still real is worse than not writing the
 * definition.
 *
 * `TrackedAdjudication.marker` may be null now, which is a marker-less entry:
 * *the markers see nothing here, and somebody read the paragraph.* So the
 * readings survive the move, the shapes keep a claimant, and these are the
 * definitions that were waiting on it. Two of the three have since been paid
 * — Spare the Dying's range and Enthrall's narrowed bonus — which is the exit
 * the form exists to make possible.
 */

/**
 * SRD Spare the Dying:
 *
 * > _Necromancy Cantrip (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** 15 feet. **Duration:** Instantaneous.
 * > "Choose a creature within range that has 0 Hit Points and isn't dead. The
 * > creature becomes Stable. _Cantrip Upgrade._ The range doubles when you
 * > reach levels 5 (30 feet), 11 (60 feet), and 17 (120 feet)."
 *
 * Three sentences and three mechanisms, all three of them written. `stabilise`
 * is the effect kind, and the event it emits is the one `stabiliseCreature`
 * emits when a DM declares the same fact; `mustBeDying` is the target rule,
 * which selects by a fact about **vitals** and is the reading
 * `a-target-rule-the-format-cannot-state` had lost; and `rangeAtLevel` is the
 * one clause in the book that grows a *reach* with the caster, read by
 * `rangeFeetAt` at the cast and at the shortlist alike.
 */
export const SPARE_THE_DYING: SpellDefinition = {
  id: 'spare-the-dying',
  name: 'Spare the Dying',
  level: 0,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  // "Range: 15 feet" — the reach of a caster who has reached none of the
  // three levels below.
  range: { kind: 'ranged', feet: 15 },
  // _Cantrip Upgrade._ "The range doubles when you reach levels 5 (30 feet),
  // 11 (60 feet), and 17 (120 feet)." The three numbers in the parentheses
  // rather than the doubling, for `rangeAtLevel`'s own reason.
  rangeAtLevel: { 5: 30, 11: 60, 17: 120 },
  // "Choose a creature within range that has 0 Hit Points and isn't dead."
  targets: { count: 1, mustBeDying: true },
  // "The creature becomes Stable." The whole of the spell.
  effects: [{ kind: 'stabilise' }],
};

/**
 * SRD Enthrall:
 *
 * > _Level 2 Enchantment (Bard, Warlock)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "You weave a distracting string of words, causing creatures of your choice
 * > that you can see within range to make a Wisdom saving throw. Any creature
 * > you or your companions are fighting automatically succeeds on this save. On
 * > a failed save, a target has a −10 penalty to Wisdom (Perception) checks and
 * > Passive Perception until the spell ends."
 *
 * One sentence of save and two of outcome, and neither outcome can be written.
 * Two halves, and each was half-built when this was written. The automatic
 * success is `autoSucceedIf: { fought: true }` — the fought fact SRD Charm
 * Person reads as Advantage, stated once on the request and read here as a
 * success — so the bandit the party is fighting is spared before the die is
 * read. The penalty is a `bonus` rider narrowed to one skill, Guidance's
 * narrowing with the sign turned round, and Passive Perception is
 * `passivePerceptionOf`: the sheet's score with the same stored bonus added,
 * so the book's two halves are one number read at two ends.
 */
export const ENTHRALL: SpellDefinition = {
  id: 'enthrall',
  name: 'Enthrall',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "creatures of your choice that you can see within range": the SRD states
  // no count, so range and sight are the whole of the bound.
  targets: { count: 0, unlimited: true },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      // "Any creature you or your companions are fighting automatically
      // succeeds on this save": the fought fact, stated at the casting.
      autoSucceedIf: { fought: true },
      // "On a failed save, a target has a −10 penalty to Wisdom (Perception)
      // checks and Passive Perception until the spell ends." One stored bonus,
      // narrowed to the skill, read by the check and by the passive score.
      modifiers: [
        {
          kind: 'bonus',
          bonus: { source: 'Enthrall', flat: 10 },
          applies: ['ability-check'],
          direction: 'subtract',
          only: { skill: 'perception' },
        },
      ],
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Flesh to Stone:
 *
 * > _Level 6 Transmutation (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "The target makes a Constitution saving throw. On a failed save, it has the
 * > Restrained condition for the duration. On a successful save, its Speed is 0
 * > until the start of your next turn. Constructs automatically succeed on the
 * > save. ... If it successfully saves against this spell three times, the
 * > spell ends. ... The successes and failures needn't be consecutive; keep
 * > track of both until the target collects three of a kind."
 *
 * The death-save shape wearing a spell: a repeat save at the end of every turn
 * carrying a running tally of three successes and three failures, either of
 * which finishes it. `RepeatSave` holds no tally, its failure branch does
 * nothing at all, and its success branch releases the effect rather than
 * acting — while this spell's success branch sets a Speed. And holding
 * Concentration for the whole minute makes the Petrified permanent, which is a
 * consequence hung on the moment a casting runs out.
 */
export const FLESH_TO_STONE: SpellDefinition = {
  id: 'flesh-to-stone',
  name: 'Flesh to Stone',
  level: 6,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the Constitution save is not raised, so the Restrained condition on a failure is not applied and the Speed of 0 on a success is not set — a rider rides the branch its host made and there is no success-branch slot for one that acts',
    'a Construct succeeding automatically is an outcome by creature type the engine prints two of and not this one: an automatic failure and Disadvantage, and no automatic success',
    'the repeat save at the end of each of the target’s turns is not raised, and it could not be counted if it were: three successes end the spell and three failures Petrify, in any order, and a repeat save carries no tally of either',
    'so the Petrified condition is never applied, and neither is the permanence a caster buys by holding Concentration for the entire minute — nothing fires when a casting runs out',
    'the statue, and whether Greater Restoration or similar magic is at hand to undo it, are the DM’s',
  ],
};

/*
 * — the two the same derivation named —————————————————————————————————————————
 *
 * The three above are the spells the marker-less entry form landed with, and
 * the commit that landed it derived them from the **shapes**: hold the tracked
 * map to the old rule and exactly three lose their last claimant. Run the same
 * derivation over the undefined population and it names five spells, because a
 * spell is unwritable under the old rule exactly when one of its blockers sits
 * in a sentence no marker can see *and* nothing else in the book claims that
 * shape.
 *
 * These are the other two. Calm Emotions' "those conditions are suppressed for
 * the duration" is the only claimant of `a-condition-a-spell-suppresses`;
 * Hallow's "the spell fails if the radius includes an area already under the
 * effect of _Hallow_" is the only claimant of
 * `a-cap-on-how-many-castings-run-at-once`. Neither sentence trips a marker —
 * "conditions" does not match `\bcondition\b` and a refusal to overlap names no
 * mechanic at all — so writing either spell would have dropped the reading and
 * retired a gap that is still real. `marker-less-blockers.test.ts` asserts the
 * counterfactual over the map as it now stands: five shapes, not three.
 */

/**
 * SRD Calm Emotions:
 *
 * > _Level 2 Enchantment (Bard, Cleric)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "Each Humanoid in a 20-foot-radius Sphere centered on a point you choose
 * > within range must succeed on a Charisma saving throw or be affected by one
 * > of the following effects (choose for each creature): The creature has
 * > Immunity to the Charmed and Frightened conditions until the spell ends. If
 * > the creature was already Charmed or Frightened, those conditions are
 * > suppressed for the duration. The creature becomes Indifferent about
 * > creatures of your choice that it's Hostile toward."
 *
 * One save and two alternative outcomes, chosen creature by creature — and
 * both are built. **The word is per creature**: `optionPerTarget` says so,
 * `CastSpellRequest.optionByTarget` names a branch for each Humanoid the
 * Sphere caught, and each creature runs the common list and then its own. The
 * save sits in each branch, for the rule `SpellDefinition.options` states: a
 * save in the common list would be one roll no branch could read. **The first
 * branch is an `immunity` rider with `suppressesHeld`**: the Immunity Mind
 * Blank writes, reached from a settled save, and the second sentence — a
 * Charmed or Frightened already on the creature goes quiet rather than being
 * ended, and is there again when the spell ends — is `suppressedConditions`
 * reading a casting's grant beside Aura of Courage's. **The second branch is
 * the table's**: an attitude is a fact the engine does not hold, so the save
 * is rolled for its verdict alone and the sentence goes out in the book's
 * words.
 */
export const CALM_EMOTIONS: SpellDefinition = {
  id: 'calm-emotions',
  name: 'Calm Emotions',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "Each Humanoid in a 20-foot-radius Sphere centered on a point you choose
  // within range": the area names who it catches, and the type narrows it.
  targets: { count: 0, mustBeType: 'Humanoid' },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  // **Empty, and the save is in each branch.** One Charisma save per creature
  // whichever branch it was given, and a save in the common list would be a
  // roll whose outcome the branch could not read.
  effects: [],
  // "(choose for each creature)": the word is per creature.
  optionPerTarget: true,
  options: {
    immunity: {
      label: 'Immunity to the Charmed and Frightened conditions',
      effects: [
        {
          kind: 'save',
          ability: 'cha',
          modifiers: [
            // "The creature has Immunity to the Charmed and Frightened
            // conditions until the spell ends. If the creature was already
            // Charmed or Frightened, those conditions are suppressed for the
            // duration."
            { kind: 'immunity', conditions: ['charmed', 'frightened'], suppressesHeld: true },
          ],
        },
      ],
    },
    indifference: {
      label: 'Indifferent about creatures of your choice',
      effects: [
        // "or be affected by one of the following effects": the save is the
        // spell's, and what a failure buys here is an attitude the engine
        // holds no fact for — so the die is rolled for its verdict and the
        // sentence goes to the table.
        { kind: 'save', ability: 'cha', verdictOnly: true },
      ],
      handsOver: [
        "The creature becomes Indifferent about creatures of your choice that it's Hostile toward.",
        'This indifference ends if the target takes damage or witnesses its allies taking damage.',
        "When the spell ends, the creature's attitude returns to normal.",
      ],
    },
  },
  durationSeconds: 60,
};

/**
 * SRD Hallow:
 *
 * > _Level 5 Abjuration (Cleric)._ **Casting Time:** 24 hours.
 * > **Range:** Touch. **Duration:** Until dispelled.
 * > "You touch a point and infuse an area around it with holy or unholy power.
 * > The area can have a radius up to 60 feet, and the spell fails if the radius
 * > includes an area already under the effect of _Hallow_ ... **Hallowed
 * > Ward.** Choose any of these creature types ... **Extra Effect.** You bind
 * > an extra effect to the area from the list below."
 *
 * The longest casting in the book and the widest entry in the map: a day's rite
 * that ends with a permanent ward, a choice of creature types every clause
 * below reads, and ten Extra Effects of which one is bound. It was the most
 * heavily read entry in the undefined map, and one of the blockers written
 * against it is the one this definition **spends**: the day, because a casting
 * of a minute or more is a declared casting the clock finishes.
 *
 * The rest is the shape of an area the engine cannot hold: one that refuses to
 * overlap another of its kind, that catches creatures by **type**, that stops a
 * creature crossing it, that suppresses somebody else's teleport, and that
 * confers a Resistance, a Vulnerability, an Immunity or a condition derived
 * from where a creature is standing rather than from a grant keyed to a source.
 */
export const HALLOW: SpellDefinition = {
  id: 'hallow',
  name: 'Hallow',
  level: 5,
  school: 'abjuration',
  castingTime: 'long',
  castingSeconds: 86_400,
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the area is not in the world: a radius of up to 60 feet chosen at the casting is not a template the engine holds, and the spell does not fail when that radius overlaps another Hallow — nothing asks whether two castings cover the same ground',
    'the creature types the Hallowed Ward is drawn against are chosen when the spell is cast, and a casting has nowhere to record a choice made when it was made; every clause below reads that choice',
    'so the ward does nothing: creatures of the chosen types are not kept out — nothing in a mover’s path may refuse it — and a creature possessed, Charmed or Frightened by one of them is not released, because an Immunity narrowed to what is causing the condition and to where the creature is standing has no argument to arrive in',
    'the Extra Effect is not bound either, and each of the ten is its own gap: Courage and Fear hang a condition on standing somewhere, Resistance and Vulnerability hang a defence there, and a grant is keyed by its source with nothing re-deriving one from where a creature now is',
    'Extradimensional Interference refuses somebody else’s teleport, which is a casting being stopped by an area it is aimed into and has no state to sit in',
    'Darkness, Daylight, Silence, Tongues and Peaceful Rest are the DM’s: there is no lighting, no sound, no shared language and nothing interred, so a prohibition on any of them reaches nothing it could refuse',
    'the incense worth 1,000+ GP the spell consumes is not spent, and the point touched is not recorded; what the engine holds is the slot, the day the rite takes, and a casting that runs until something dispels it',
  ],
};

/**
 * Three spells whose blocker was never a shape: text only the DM can decide.
 *
 * The owner's ruling: "**Some text is the DM's alone.** Commune, Dream's Range
 * `Special`, Mirage Arcane's `Sight`: the casting hands the printed text to
 * whoever is running the table, human or model, marked explicitly as a thing
 * only the DM can decide. Not a format arm to invent, a handover to make
 * visible."
 *
 * All three sat in `missing-shapes.ts` under `table` **and under protest** —
 * the entries said so in as many words: "No shape id names it, and inventing
 * one is an architecture decision rather than a reading." The reading is that
 * there is nothing to invent. A question asked of a god, a Range printed
 * `Special` and a Range printed `Sight` are not mechanisms the engine is
 * missing; they are questions it has no business answering. `dmDecides`
 * carries the book's words out of the casting under a mark of their own, and
 * `range: { kind: 'dm' }` is the Range half of the same sentence.
 *
 * What is left in `unmodelled` for each of them is the ordinary kind of debt:
 * a die that is not a d20, effects that land on two different creatures, a
 * choice made at the casting with nowhere to be recorded. Those are shapes,
 * they are still counted, and they still block what they blocked.
 */

/**
 * SRD Dream:
 *
 * > _Level 5 Illusion (Bard, Warlock, Wizard)._
 * > **Casting Time:** 1 minute. **Range:** Special. **Duration:** 8 hours.
 * > "You target a creature you know on the same plane of existence. You or a
 * > willing creature you touch enters a trance state to act as a dream
 * > messenger ... the messenger appears in the target's dreams and can converse
 * > with the target as long as it remains asleep."
 *
 * The first of the two spells whose **Range** is the handover. `Special` is not
 * a distance the book declined to print for want of space; it is the book
 * saying that where this spell reaches depends on facts about the world — who
 * the caster knows, and which plane they are both on — that the engine does not
 * hold and should not invent. So the Range is the DM's and the printed word
 * goes out with the casting.
 *
 * Everything mechanical about the spell is still a debt rather than a
 * handover, and every one of them is a shape `missing-shapes.ts` already
 * names: two creatures with different effects on them, a casting dismissed by
 * somebody who is not its caster, a rest whose benefit is taken away, and
 * damage owed at a moment that is neither a span nor a place in the turn order.
 */
export const DREAM: SpellDefinition = {
  id: 'dream',
  name: 'Dream',
  level: 5,
  school: 'illusion',
  castingTime: 'long',
  castingSeconds: 60,
  concentration: false,
  range: { kind: 'dm' },
  targets: { count: 1 },
  durationSeconds: 28_800,
  effects: [],
  dmDecides: [
    'Range: Special',
    'You target a creature you know on the same plane of existence.',
    "If the target is asleep, the messenger appears in the target's dreams and can converse with the target as long as it remains asleep, through the spell's duration.",
    "The messenger can also shape the dream's environment, creating landscapes, objects, and other images.",
    'The target recalls the dream perfectly upon waking.',
  ],
  unmodelled: [
    'the messenger is not put into the trance: "You or a willing creature you touch" is a second creature with its own effects on it, and one effect list reaches every target — so nobody gains the Incapacitated condition and nobody’s Speed becomes 0',
    'the messenger cannot emerge from the trance to end the spell, and cannot end it on finding the target awake: a casting is dismissed by its own caster, and the messenger need not be the caster at all',
    'making the messenger terrifying is a choice taken at the casting with nowhere to be recorded, so the ten words are not delivered and the Wisdom saving throw they gate is never rolled',
    'and neither branch of that save could land if it were: nothing takes the benefit away from a rest the sleeper actually finished, and 3d6 Psychic damage owed when it wakes hangs on a moment that is neither a span of seconds nor a place in the turn order',
  ],
};

/**
 * SRD Mirage Arcane:
 *
 * > _Level 7 Illusion (Bard, Druid, Wizard)._
 * > **Casting Time:** 10 minutes. **Range:** Sight. **Duration:** 10 days.
 * > "You make terrain in an area up to 1 mile square look, sound, smell, and
 * > even feel like some other sort of terrain ... Creatures with Truesight can
 * > see through the illusion to the terrain's true form."
 *
 * The second Range that is a question rather than a distance, and the plainer
 * of the two: `Sight` is bounded by what the caster can see, and declared sight
 * in this engine is a pairwise fact between two creatures rather than a horizon.
 * Rather than invent a horizon, the printed word goes to the table.
 *
 * The ten minutes are a rite the clock runs, the ten days are a deadline, and
 * the illusion itself is the DM's — which is what an illusion always is here.
 * What stays a debt is the mile the caster chooses, the Difficult Terrain an
 * area creates, and the sense that sees through it.
 */
export const MIRAGE_ARCANE: SpellDefinition = {
  id: 'mirage-arcane',
  name: 'Mirage Arcane',
  level: 7,
  school: 'illusion',
  castingTime: 'long',
  castingSeconds: 600,
  concentration: false,
  range: { kind: 'dm' },
  targets: { count: 0 },
  durationSeconds: 864_000,
  effects: [],
  dmDecides: [
    'Range: Sight',
    'You make terrain in an area up to 1 mile square look, sound, smell, and even feel like some other sort of terrain.',
    'Similarly, you can alter the appearance of structures or add them where none are present.',
    "The spell doesn't disguise, conceal, or add creatures.",
    "Any piece of the illusory terrain (such as a rock or stick) that is removed from the spell's area disappears immediately.",
  ],
  unmodelled: [
    'the mile is not drawn: the area’s size is chosen when the spell is cast, up to a printed maximum, and a `SpellArea` is one fixed size belonging to the definition with nowhere to record a choice',
    'so the illusion turns no clear ground into Difficult Terrain and takes none away: the first half waits on the mile above, because a patch lies over the area its casting pinned and this casting pins none; the second waits on nothing anybody has built, because the lattice takes the dearest rate lying over a space — the book’s own rule that Difficult Terrain is not cumulative — and nothing in it subtracts',
    'and Truesight does not see through it: sight here is a pairwise declaration between two creatures, so a sense that excuses its holder from an illusion has no state to sit in and nothing to be read off',
  ],
};

export const SPELL_DEFINITIONS: readonly SpellDefinition[] = [
  ACID_ARROW,
  ACID_SPLASH,
  AID,
  ALARM,
  ALTER_SELF,
  ANIMAL_FRIENDSHIP,
  ANIMAL_MESSENGER,
  ANIMAL_SHAPES,
  ANIMATE_DEAD,
  ANIMATE_OBJECTS,
  ANTILIFE_SHELL,
  ANTIMAGIC_FIELD,
  ANTIPATHY_SYMPATHY,
  ARCANE_EYE,
  ARCANE_HAND,
  ARCANE_LOCK,
  ARCANE_SWORD,
  ARCANISTS_MAGIC_AURA,
  ASTRAL_PROJECTION,
  AUGURY,
  AURA_OF_LIFE,
  AWAKEN,
  BANE,
  BANISHMENT,
  BARKSKIN,
  BEACON_OF_HOPE,
  BEFUDDLEMENT,
  BESTOW_CURSE,
  BLACK_TENTACLES,
  BLADE_BARRIER,
  BLESS,
  BLIGHT,
  BLINDNESS_DEAFNESS,
  BLINK,
  BLUR,
  BURNING_HANDS,
  CALL_LIGHTNING,
  CALM_EMOTIONS,
  CHAIN_LIGHTNING,
  CHARM_MONSTER,
  CHARM_PERSON,
  CHILL_TOUCH,
  CHROMATIC_ORB,
  CIRCLE_OF_DEATH,
  CLAIRVOYANCE,
  CLONE,
  CLOUDKILL,
  COLOR_SPRAY,
  COMMAND,
  COMMUNE,
  COMMUNE_WITH_NATURE,
  COMPREHEND_LANGUAGES,
  COMPULSION,
  CONE_OF_COLD,
  CONFUSION,
  CONJURE_ANIMALS,
  CONJURE_CELESTIAL,
  CONJURE_ELEMENTAL,
  CONJURE_FEY,
  CONJURE_MINOR_ELEMENTALS,
  CONJURE_WOODLAND_BEINGS,
  CONTACT_OTHER_PLANE,
  CONTAGION,
  CONTINGENCY,
  CONTINUAL_FLAME,
  CONTROL_WATER,
  CONTROL_WEATHER,
  COUNTERSPELL,
  CREATE_FOOD_AND_WATER,
  CREATE_OR_DESTROY_WATER,
  CREATE_UNDEAD,
  CREATION,
  CURE_WOUNDS,
  DANCING_LIGHTS,
  DARKNESS,
  DARKVISION,
  DAYLIGHT,
  DEATH_WARD,
  DELAYED_BLAST_FIREBALL,
  DEMIPLANE,
  DETECT_EVIL_AND_GOOD,
  DETECT_MAGIC,
  DETECT_POISON_AND_DISEASE,
  DETECT_THOUGHTS,
  DIMENSION_DOOR,
  DISGUISE_SELF,
  DISINTEGRATE,
  DISPEL_EVIL_AND_GOOD,
  DISPEL_MAGIC,
  DISSONANT_WHISPERS,
  DIVINATION,
  DIVINE_FAVOR,
  DIVINE_SMITE,
  DIVINE_WORD,
  DOMINATE_BEAST,
  DOMINATE_MONSTER,
  DOMINATE_PERSON,
  DRAGONS_BREATH,
  DREAM,
  DRUIDCRAFT,
  EARTHQUAKE,
  ELDRITCH_BLAST,
  ELEMENTALISM,
  ENHANCE_ABILITY,
  ENLARGE_REDUCE,
  ENSNARING_STRIKE,
  ENTANGLE,
  ENTHRALL,
  ETHEREALNESS,
  EXPEDITIOUS_RETREAT,
  EYEBITE,
  FABRICATE,
  FAERIE_FIRE,
  FAITHFUL_HOUND,
  FALSE_LIFE,
  FEAR,
  FEATHER_FALL,
  FIND_FAMILIAR,
  FIND_STEED,
  FIND_THE_PATH,
  FIND_TRAPS,
  FINGER_OF_DEATH,
  FIRE_BOLT,
  FIRE_SHIELD,
  FIRE_STORM,
  FIREBALL,
  FLAME_BLADE,
  FLAME_STRIKE,
  FLAMING_SPHERE,
  FLESH_TO_STONE,
  FLOATING_DISK,
  FLY,
  FOG_CLOUD,
  FORBIDDANCE,
  FORCECAGE,
  FORESIGHT,
  FREEDOM_OF_MOVEMENT,
  FREEZING_SPHERE,
  GASEOUS_FORM,
  GATE,
  GEAS,
  GENTLE_REPOSE,
  GIANT_INSECT,
  GLIBNESS,
  GLOBE_OF_INVULNERABILITY,
  GLYPH_OF_WARDING,
  GOODBERRY,
  GREASE,
  GREATER_INVISIBILITY,
  GREATER_RESTORATION,
  GUARDIAN_OF_FAITH,
  GUARDS_AND_WARDS,
  GUIDANCE,
  GUIDING_BOLT,
  GUST_OF_WIND,
  HALLOW,
  HALLUCINATORY_TERRAIN,
  HARM,
  HASTE,
  HEAL,
  HEALING_WORD,
  HEAT_METAL,
  HELLISH_REBUKE,
  HEROES_FEAST,
  HEROISM,
  HEX,
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
  IMPRISONMENT,
  INCENDIARY_CLOUD,
  INFLICT_WOUNDS,
  INSECT_PLAGUE,
  INSTANT_SUMMONS,
  INVISIBILITY,
  IRRESISTIBLE_DANCE,
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
  MAGIC_CIRCLE,
  MAGIC_JAR,
  MAGIC_MISSILE,
  MAGIC_MOUTH,
  MAGIC_WEAPON,
  MAGNIFICENT_MANSION,
  MAJOR_IMAGE,
  MASS_CURE_WOUNDS,
  MASS_HEAL,
  MASS_HEALING_WORD,
  MASS_SUGGESTION,
  MELD_INTO_STONE,
  MENDING,
  MESSAGE,
  METEOR_SWARM,
  MIND_BLANK,
  MIND_SPIKE,
  MINOR_ILLUSION,
  MIRAGE_ARCANE,
  MIRROR_IMAGE,
  MISLEAD,
  MISTY_STEP,
  MOONBEAM,
  MOVE_EARTH,
  NONDETECTION,
  PASS_WITHOUT_TRACE,
  PASSWALL,
  PHANTASMAL_KILLER,
  PHANTOM_STEED,
  PLANAR_ALLY,
  PLANAR_BINDING,
  PLANE_SHIFT,
  PLANT_GROWTH,
  POISON_SPRAY,
  POLYMORPH,
  POWER_WORD_HEAL,
  POWER_WORD_KILL,
  POWER_WORD_STUN,
  PRAYER_OF_HEALING,
  PRESTIDIGITATION,
  PRISMATIC_SPRAY,
  PRISMATIC_WALL,
  PRIVATE_SANCTUM,
  PRODUCE_FLAME,
  PROJECT_IMAGE,
  PROTECTION_FROM_ENERGY,
  PROTECTION_FROM_EVIL_AND_GOOD,
  PROTECTION_FROM_POISON,
  PURIFY_FOOD_AND_DRINK,
  RAISE_DEAD,
  RAY_OF_ENFEEBLEMENT,
  RAY_OF_FROST,
  RAY_OF_SICKNESS,
  REGENERATE,
  REINCARNATE,
  REMOVE_CURSE,
  RESILIENT_SPHERE,
  RESISTANCE,
  RESURRECTION,
  REVERSE_GRAVITY,
  REVIVIFY,
  ROPE_TRICK,
  SACRED_FLAME,
  SANCTUARY,
  SCORCHING_RAY,
  SCRYING,
  SEARING_SMITE,
  SECRET_CHEST,
  SEE_INVISIBILITY,
  SEEMING,
  SEQUESTER,
  SHAPECHANGE,
  SHATTER,
  SHIELD,
  SHIELD_OF_FAITH,
  SHILLELAGH,
  SHINING_SMITE,
  SHOCKING_GRASP,
  SILENCE,
  SILENT_IMAGE,
  SIMULACRUM,
  SLEEP,
  SLEET_STORM,
  SLOW,
  SORCEROUS_BURST,
  SPARE_THE_DYING,
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
  STORM_OF_VENGEANCE,
  SUGGESTION,
  SUMMON_DRAGON,
  SUNBEAM,
  SUNBURST,
  SYMBOL,
  TELEKINESIS,
  TELEPATHIC_BOND,
  TELEPORT,
  TELEPORTATION_CIRCLE,
  THAUMATURGY,
  THUNDERWAVE,
  TIME_STOP,
  TINY_HUT,
  TONGUES,
  TRANSPORT_VIA_PLANTS,
  TREE_STRIDE,
  TRUE_POLYMORPH,
  TRUE_RESURRECTION,
  TRUE_SEEING,
  TRUE_STRIKE,
  TSUNAMI,
  UNSEEN_SERVANT,
  VAMPIRIC_TOUCH,
  VICIOUS_MOCKERY,
  VITRIOLIC_SPHERE,
  WALL_OF_FIRE,
  WALL_OF_FORCE,
  WALL_OF_ICE,
  WALL_OF_STONE,
  WALL_OF_THORNS,
  WARDING_BOND,
  WATER_BREATHING,
  WATER_WALK,
  WEB,
  WEIRD,
  WIND_WALK,
  WIND_WALL,
  WORD_OF_RECALL,
  ZONE_OF_TRUTH,
];
