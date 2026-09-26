import {
  err,
  ok,
  type Ability,
  type CharacterId,
  type ConditionName,
  type DamageType,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import {
  bonusesFor,
  type Bonus,
  type BonusNarrowing,
  type ModeSource,
  type StandingBonusApplies,
} from './bonuses.js';
import type { CreatureSize } from '@ie/srd';
import type { HazardName } from './hazards.js';
import type { TurnAnchor, TurnMoment } from './time.js';
import {
  grantedRollModes,
  unsettledSightGrants,
  selectorMatches,
  type RollModifier,
  type RollQuery,
} from './roll-modifiers.js';
import { UNIVERSAL_ACTION_EFFECTS } from './actions.js';
import {
  applyCondition,
  conditionSpeed,
  conditionState,
  deniedBenefitsOf,
  hasCondition,
  isIncapacitated,
  withoutConditions,
  type ConditionState,
} from './conditions.js';
import {
  abilityModifier,
  proficiencyBonus,
  armorClass,
  armorClassFloor,
  hasSpeedInMode,
  passivePerception,
  speedInMode,
  type CharacterSheet,
  type MovementMode,
} from './character.js';
import {
  canBeTargeted,
  coverBetween,
  distanceBetween,
  distanceToPoint,
  lightAt,
  obscurementAt,
  piercesObscurement,
  positionOf,
  sensesReaching,
  sightBetween,
  SIGHT_SENSES,
  sizeAtMost,
  sizeOf,
  spaceInRegion,
  type CreatureSense,
  type LightLevel,
  type Point,
  type PositionState,
  type SenseName,
  type TerrainRegion,
} from './positioning.js';
import type { CreatureState, GameState } from './events.js';
import { typeMagicSees } from './creature-type.js';
import type { EquippedItem } from './state.js';
import {
  creaturesStandingInCastingArea,
  regionOfCastingArea,
  spellOfSource,
  type CastingTime,
} from './spells.js';
import type { OutcomeRiders, SpellArea, SpellEffect } from './spell-definitions.js';
import type { EffectEndCause } from './timers.js';
import { tallied, type Recovery } from './resources.js';
// `featureOfSource` is a runtime import and no cycle: everything `progression.ts`
// takes from this file is type-only and erased, so at run time it reaches only
// `spells.ts`.
import { featureOfSource, type ImbuedWeapon, type TradedAmount } from './progression.js';
import {
  weaponInSet,
  weaponNarrowingHolds,
  type DamageDefenses,
  type DefenseKind,
  type WeaponNarrowing,
  type WeaponSelector,
  type WieldingContext,
} from './attack.js';
import { parseNotation, treatLowRollsAs, type DieEffect, type RollRule } from './dice.js';
import type { Weapon } from '@ie/srd';
import {
  actionRuleKey,
  canUseFeatureThisTurn,
  movementLeft,
  type ActionRule,
  type GrantedActionRule,
} from './combat.js';

/**
 * Benefits a class feature grants for as long as its rule holds.
 *
 * These are not the bonuses a spell hangs on a creature, and the difference is
 * the whole design. A spell's bonus *starts* at a moment somebody can write
 * down — `bonus-applied`, linked to the casting that made it — and ends when
 * that casting does. An aura has no such moment: whether you are in one is a
 * fact about where two creatures are standing, and it changes every time
 * either of them moves, without anything happening that a log could record.
 *
 * So these are **derived from state on every read**, and nothing is ever
 * stored on the creature they reach. That is not an optimisation; it is the
 * only way a conditional benefit stays conditional. A stored copy would be an
 * unconditional bonus wearing a feature's name, and it would go wrong at
 * exactly the moment it mattered — the paladin walks away, the barbarian is
 * stunned — because nothing would have told it to.
 *
 * What the SRD asks for, feature by feature:
 *
 * | Feature | Reach | Condition |
 * |---|---|---|
 * | Danger Sense | self | "unless you have the Incapacitated condition" |
 * | Aura of Protection | 10-foot Emanation | "inactive while you have the Incapacitated condition" |
 * | Aura of Courage | the same aura | — |
 * | Aura of Devotion | the same aura | — |
 */

/** Where a standing benefit reaches. */
export type StandingReach =
  | { readonly kind: 'self' }
  /**
   * SRD: "a 10-foot Emanation that originates from you", measured the way
   * everything else is — between volumes, on the cube lattice. The holder is
   * in their own aura because the text says so ("You and your allies in the
   * aura"), not because the geometry puts them there: an Emanation excludes
   * its own origin.
   */
  | { readonly kind: 'aura'; readonly feet: number };

/**
 * What a casting's persistent area does to whoever is standing in it, for as
 * long as they stand in it.
 *
 * SRD Spirit Guardians: "Any other creature's Speed is **halved in the
 * Emanation**." The same argument this file opens with, arriving at a casting
 * instead of a class feature: which creatures that sentence reaches is a fact
 * about where two creatures are standing, it changes every time either of them
 * moves, and nothing happens that a log could record. So it is **derived on
 * every read** from the scene and the record, and nothing is stored on the
 * creature it reaches. A stored halving would be a pair of events that had to
 * stay matched — granted on the way in, released on the way out — and the
 * first route that moved a creature without remembering would leave a goblin
 * walking at half Speed a hundred feet from the cleric.
 *
 * **Not {@link StandingReach}'s `aura`, and the three differences are each a
 * rule.** That reach is a *feature's*, held on a creature's own sheet or a
 * worn item, radiating from the holder to "you and your allies"; this is a
 * *casting's*, measured over the area the casting pinned — which may be a
 * Sphere centred on a point nobody is standing on — and it reaches whoever the
 * geometry catches, ally or not, minus the list the caster designated at the
 * cast. Nothing in the SRD writes both halves of one sentence, so they are two
 * vocabularies rather than one with a flag.
 *
 * **Not {@link HungGrant} or a `speed` effect either**: both of those are
 * stored against a source and released when it ends, which is right for
 * Longstrider — touched at a moment, ended at a moment — and wrong for a
 * volume a creature can walk out of.
 *
 * **Four members and a list of them**, where there was one member and one
 * value. SRD Silence writes three sentences of this shape about one Sphere —
 * an Immunity, a condition and a casting it forbids — so a field holding one
 * clause could not have carried it, and a second field beside this one would
 * have been a second answer to "what does this area do". A definition states
 * the list; the casting pins it; every reader below walks it and names the
 * members it understands.
 *
 * | SRD | Member |
 * |---|---|
 * | Spirit Guardians, "Speed is halved in the Emanation" | {@link AreaSpeedStanding} |
 * | Pass without Trace, "+10 bonus to Dexterity (Stealth) checks" | {@link AreaBonusStanding} |
 * | Silence, "creatures have the Deafened condition while entirely inside it" | {@link AreaConditionStanding} |
 * | Silence, "has Immunity to Thunder damage" | {@link AreaDefenseStanding} |
 * | Silence, "Casting a spell that includes a Verbal component is impossible there" | {@link AreaSilenceStanding} |
 * | Tiny Hut, "All other creatures and objects are barred from passing through it" | {@link AreaBarrierStanding} |
 * | Tiny Hut, "Spells of level 3 or lower can't be cast through it" | {@link AreaWardStanding} |
 * | Wind Wall, "ordinary projectiles … are deflected upward and miss automatically" | {@link AreaDeflectionStanding} |
 * | Magic Circle, "Disadvantage on attack rolls against targets within the Cylinder" | {@link AreaAttackModeStanding} |
 * | Magic Circle, "Targets within the Cylinder can't … gain the Charmed or Frightened condition from the creature" | {@link AreaConditionImmunityStanding} |
 */
export type AreaStanding =
  | AreaSpeedStanding
  | AreaBonusStanding
  | AreaConditionStanding
  | AreaDefenseStanding
  | AreaSilenceStanding
  | AreaBarrierStanding
  | AreaWardStanding
  | AreaDeflectionStanding
  | AreaAttackModeStanding
  | AreaConditionImmunityStanding;

/**
 * How much of a creature has to be in the area for a clause to reach it.
 *
 * SRD writes both readings and writes them in one entry. Silence: "Any
 * creature or object **entirely inside** the Sphere has Immunity to Thunder
 * damage, and creatures have the Deafened condition **while entirely inside
 * it**" — and then, of the casting it forbids, only "**there**". Spirit
 * Guardians and Pass without Trace say "in the Emanation" and "while in the
 * aura", which is the ordinary reading every other area rule takes.
 *
 * So it is a field on the clause rather than a rule about the kind: the same
 * Sphere reaches a straddling ogre with one of its sentences and not with the
 * other two, and a reader that decided this per kind would have had to get
 * Silence's own paragraph wrong somewhere.
 *
 * **Absent is the ordinary reading**: any space the creature occupies inside
 * the area puts it in the area, which is what `creaturesInArea` has always
 * answered and what every record written before this field says.
 */
interface WhollyInside {
  /** SRD Silence's "entirely inside": every space the creature occupies. */
  readonly whollyInside?: true;
}

export type AreaSpeedStanding = WhollyInside & {
  /**
   * SRD Spirit Guardians' "Speed is halved in the Emanation", read through the
   * one composer — {@link combineSpeed} — so the halving meets Exhaustion's
   * flat reduction and a Grappled creature's zero in the order the architect
   * fixed, rather than in a second arithmetic of its own.
   *
   * `change` is every operation that *moves* a Speed, so a Speed a casting's
   * area moves is spelled the way every other Speed a spell moves already is.
   * `feet` is required by `add` and refused by the other two, exactly as the
   * `speed` effect's is — and `match-walk`, which gives a Speed in a mode
   * rather than moving one, is refused outright: an area has no mode to give
   * one in. See the field below for why that is a narrowing and not a
   * borrowing.
   */
  readonly kind: 'speed';
  /**
   * The three operations that move a Speed the creature already has.
   *
   * **Narrowed rather than {@link SpeedChange} whole**, which is the field
   * that taught the lesson: widening that union for "a Climb Speed equal to
   * its Speed" widened this one silently, and `speedOf`'s area loop read the
   * new member as a Speed of 0. An area has no mode to give a Speed in — it
   * says "Speed is halved in the Emanation" and nothing else — so the type
   * says so, `checkSpeedChange` says so at the door for untyped input, and
   * the loop names every member it handles.
   *
   * **`double` is excluded for the same reason and a second one.** No SRD
   * area doubles anybody's Speed — the one sentence in the book that
   * multiplies one is SRD Haste, which is a grant on a willing creature and
   * not a patch of ground — so admitting it here would be a member the area
   * loop ignores and an author could write.
   */
  readonly change: Exclude<SpeedChange, 'match-walk' | 'double' | 'only'>;
  /** Signed feet, required by `add` and refused by the other two. */
  readonly feet?: number;
};

/**
 * SRD Pass without Trace: "While in the aura, you and each creature you choose
 * have a **+10 bonus to Dexterity (Stealth) checks**."
 *
 * A flat number on a family of roll, narrowed the way {@link BonusNarrowing}
 * already narrows the ongoing bonus Guidance hangs: "Dexterity (Stealth)" is
 * `{ skill: 'stealth' }` and loses nothing, because a skill names its own
 * governing ability.
 *
 * **`applies` is the one family with a gatherer, and is typed as that family
 * rather than as `BonusApplies` whole.** Widening it would put a member
 * in the vocabulary that no reader reaches, which is the failure `bonuses.ts`
 * names in its own docstring: `checkBonuses` is where this is gathered, a
 * saving throw and an attack roll gather their own, and the day the SRD prints
 * an area that bonuses one of those the widening is a second gatherer rather
 * than a wider field.
 *
 * **Flat only, for `BonusApplies`' reason two paragraphs up in that file.** No
 * SRD area grants a rolled bonus, and a d4 derived from where somebody is
 * standing has no moment at which it could be rolled — it would be thrown
 * afresh on every read of a number that is supposed to be stable.
 *
 * **Stacked by the spell's name and not by the casting**, which is SRD's own
 * sentence: "when two or more game features have the same name, only the
 * effects of one of them — the most potent — apply". Two Pass without Traces
 * over one Rogue are +10, exactly as two Rings of Protection are +1.
 */
export type AreaBonusStanding = WhollyInside & {
  readonly kind: 'bonus';
  /** The one family an area-derived bonus has a gatherer for. */
  readonly applies: 'ability-check';
  /** Signed, so an area could print a penalty; SRD's one sentence is a plus. */
  readonly flat: number;
  /** Which of those checks it reaches — see {@link BonusNarrowing}. */
  readonly only?: BonusNarrowing;
};

/**
 * SRD Silence: "creatures have the **Deafened** condition while entirely
 * inside it."
 *
 * **Derived, and no `condition-applied` is ever written.** The cause is the
 * creature's position and nothing else, so there is no moment to record: a
 * pair of events — applied on the way in, removed on the way out — would be
 * two facts that have to stay matched, and the first route that moved a
 * creature without remembering would leave a goblin deaf a hundred feet from
 * the Sphere. It is gathered by {@link effectiveConditions}, which is the one
 * door every reader of a condition's *effects* already goes through, so the
 * auto-failed hearing check and the Disadvantage a condition carries find it
 * without a second reader being written.
 *
 * **So it cannot be removed, and that is the rule rather than a limitation.**
 * Nothing the SRD prints lifts a condition a place imposes while you are still
 * standing in the place; walking out is the whole of the ending.
 */
export type AreaConditionStanding = WhollyInside & {
  readonly kind: 'condition';
  readonly condition: ConditionName;
};

/**
 * SRD Silence: "Any creature or object entirely inside the Sphere has
 * **Immunity to Thunder damage**."
 *
 * {@link defensesOf}'s fourth input, beside the stat block's printed entries,
 * the ones a feature grants while a requirement holds, and the ones a running
 * effect has hung on a creature — and the only one of the four that is a fact
 * about *where* rather than about *whom*. It unions with the rest for the
 * SRD's own reason: "multiple instances of Resistance to the same damage type
 * count as only one", so there is no arithmetic a second copy could do.
 */
export type AreaDefenseStanding = WhollyInside & {
  readonly kind: 'damage-defense';
  readonly defense: DefenseKind;
  /** Lower-cased, and compared rather than named: the engine holds no list. */
  readonly damageTypes: readonly string[];
};

/**
 * SRD Silence: "**Casting a spell that includes a Verbal component is
 * impossible there.**"
 *
 * **A pinned fact read by a refusal, which is what makes it a member here and
 * not a derived value.** The other four members are read at the moment
 * somebody asks what a creature's Speed, bonus, condition or defence is; this
 * one is read at the moment somebody casts, and what it produces is
 * `silenced` rather than a number. It is a member all the same because the
 * question it answers is this type's question — *what does this casting's
 * area do to whoever is standing in it* — and because the fold opens no
 * catalogue: the sentence has to be pinned at the cast beside the area it is
 * measured over, and a field of its own would be a second answer to one
 * question.
 *
 * It carries no `whollyInside`, and the book is why: the two clauses above it
 * say "entirely inside" and this one says "there".
 */
export type AreaSilenceStanding = {
  readonly kind: 'no-verbal-casting';
};

/**
 * Which side of the area a clause protects.
 *
 * SRD Magic Circle: "Each time you cast this spell, you can cause its magic to
 * operate in the reverse direction, preventing a creature of the specified type
 * from leaving the Cylinder and **protecting targets outside it**." Every other
 * clause in this file reaches whoever is standing *in* the area; the reversed
 * circle is the one sentence in the book that reaches whoever is standing
 * anywhere else. So it is a marker on the two clauses that sentence turns
 * round, read by {@link areaStandingOn} as the complement of the catch — a
 * placed creature the geometry does not catch — and absent everywhere else.
 */
interface AreaSide {
  /** The clause reaches a placed creature **outside** the area rather than inside it. */
  readonly outside?: true;
  /**
   * The clause holds only against a creature standing **inside** the area.
   *
   * SRD Magic Circle's reverse, read whole: "preventing a creature of the
   * specified type from leaving the Cylinder and protecting targets outside
   * it." The creature the sentence is about is the one *penned in* — the Fiend
   * the circle is holding — and who it is protected from is therefore that
   * Fiend and nobody else.
   *
   * {@link outside} alone said only half of it. A reversed circle gave its
   * clauses to every creature standing outside, so a second Fiend that walked
   * past on the road had Disadvantage attacking a cleric on the far side of
   * the field, and the cleric could not be Charmed by it — a protection the
   * spell does not grant and one no Magic Circle the caster ever put down
   * would have to be near.
   *
   * So this is the **other** end of the same pair: `outside` narrows whom the
   * clause protects, and this narrows whom it protects them *from*. Read off
   * the same catch the clause was measured with — the attacker's position for
   * an `attack-mode`, the causer's for a `condition-immunity` — so no reader
   * asks the geometry a second time and neither can disagree with the other.
   *
   * Absent everywhere but the reversed circle, and absent means what it always
   * meant: the clause asks nothing about where the other creature stands.
   */
  readonly attackerInside?: true;
}

/**
 * Whom a barrier stops.
 *
 * Four SRD sentences and a member for each: Tiny Hut bars "all other creatures
 * and objects"; Magic Circle bars "a creature of the chosen type" — chosen at
 * the casting, so a definition writes `'stated'` and the record carries the
 * list the caster gave; Wind Wall bars "Small or smaller flying creatures" and,
 * in its last sentence, "creatures in gaseous form".
 *
 * **Gaseous form is a mark on the creature and not a name.** SRD Gaseous Form
 * makes "the target's only method of movement … a Fly Speed of 10 feet, and it
 * can hover", and that is what the grant it hangs says: a granted Fly Speed
 * that **replaces** every other Speed (`change: 'only'`) and hovers.
 * {@link isGaseousOn} reads that pair and nothing named after a spell.
 */
export type BarredCreatures =
  | 'all'
  | { readonly types: readonly string[] | 'stated' }
  | { readonly sizeAtMost: CreatureSize; readonly flying: true }
  | 'gaseous';

/**
 * SRD Tiny Hut: "Creatures and objects within the Emanation when you cast the
 * spell can move through it freely. **All other creatures and objects are
 * barred from passing through it.**" SRD Magic Circle: "The creature can't
 * willingly enter the Cylinder by nonmagical means. If the creature tries to
 * use teleportation or interplanar travel to do so, it must first succeed on a
 * Charisma saving throw." SRD Wind Wall: "Small or smaller flying creatures or
 * objects can't pass through the wall. … Creatures in gaseous form can't pass
 * through it."
 *
 * **A surface the movement command consults, and the first one.** Every area
 * before this was a template a casting resolved over; a creature walked through
 * a Wind Wall as if it were open floor, because movement asked the lattice
 * about cost and occupancy and never about a boundary. This is the boundary:
 * `resolveMove` reads which barriers stand against the mover and refuses a step
 * that crosses one (`barred`), before any movement is spent, and `teleportTo`
 * reads the one clause the book writes about a teleport.
 *
 * **Derived on every read, like every clause here**, because which side of the
 * dome a goblin is on is a fact about where the goblin is standing.
 *
 * `crossing` is the direction the sentence forbids: Tiny Hut's "passing
 * through" is either way, Magic Circle's "enter" is inward and its reverse is
 * outward. `except` is the list the casting pinned — SRD Tiny Hut's "creatures
 * within the Emanation when you cast the spell" — read off
 * `OngoingSpell.insideAtTheCast`. `saveToCross` is the ability SRD Magic
 * Circle names for a teleport across; a clause without it lets a teleport by,
 * because a teleport passes through nothing — the reading `commands/teleport.ts`
 * has always taken of a Web.
 */
export type AreaBarrierStanding = {
  readonly kind: 'bars-passage';
  readonly to: BarredCreatures;
  readonly crossing: 'in' | 'out' | 'either';
  readonly except?: 'inside-at-the-cast';
  readonly saveToCross?: Ability;
};

/**
 * SRD Tiny Hut: "**Spells of level 3 or lower can't be cast through it, and
 * the effects of such spells can't extend into it.**"
 *
 * The other thing an area can refuse: not a creature's step but another
 * casting. Two readers, and both are pre-existing seams rather than new
 * doors. `resolveSpell`'s pre-flight refuses a casting of a level at or below
 * `maxLevel` whose caster and named target — or the point it is cast at — stand
 * on opposite sides of the boundary (`warded`), before anything is spent; and
 * `areaCatch` takes out of an area's catch every creature the boundary
 * separates from the caster, the way `chosen` and `notTheCaster` already
 * narrow it.
 *
 * **The level is the casting's**, which is the slot's when upcast — SRD: "the
 * spell assumes the higher level for that casting" — so a Cone of Cold at level
 * 5 leaves the dome and a Fireball at level 3 does not.
 *
 * **Sides, not a line.** Whether a casting is "through" the dome is read as the
 * two ends being on different sides of it, which is exact for a casting that
 * begins or ends inside and an approximation for one that begins and ends
 * outside with the dome between — the same approximation declared cover makes
 * of every area of effect, and made for the same reason.
 */
export type AreaWardStanding = {
  readonly kind: 'wards-magic';
  /** The highest spell level the ward stops; a higher casting passes. */
  readonly maxLevel: number;
};

/**
 * SRD Wind Wall: "**Arrows, bolts, and other ordinary projectiles launched at
 * targets behind the wall are deflected upward and miss automatically.**
 * Boulders hurled by Giants or siege engines, and similar projectiles, are
 * unaffected."
 *
 * Read by `resolveAttack` for a ranged **weapon** attack whose line from the
 * attacker's space to the target's crosses the area: the die is still thrown
 * and recorded — as it is for an automatic success on a save — and the roll
 * misses whatever it shows. A spell attack is not a projectile and passes; a
 * stat block's printed ranged line may be an arrow or a boulder, so it is
 * reported in `unverified` rather than ruled on.
 */
export type AreaDeflectionStanding = {
  readonly kind: 'deflects-projectiles';
};

/**
 * SRD Magic Circle: "The creature has **Disadvantage on attack rolls against
 * targets within the Cylinder**."
 *
 * A roll mode the *target's* position confers, narrowed by what the attacker
 * is. The hung version of the same sentence is SRD Protection from Evil and
 * Good's `RollSelector.attackerType`, and this reads a type the same way —
 * through `typeMagicSees`, because a ward is a spell. Gathered into
 * `defendingModes` beside the modes the target holds, so the attack site learns
 * nothing new.
 */
export type AreaAttackModeStanding = AreaSide & {
  readonly kind: 'attack-mode';
  readonly mode: RollMode;
  /** The attacker's creature types the mode reaches; `'stated'` until the casting fills it. */
  readonly attackerType?: readonly string[] | 'stated';
};

/**
 * SRD Magic Circle: "**Targets within the Cylinder can't be possessed by or
 * gain the Charmed or Frightened condition from the creature.**"
 *
 * The Immunity SRD Protection from Evil and Good hangs on one creature, read
 * off a place instead: `conditionImmunitiesOf` gathers it beside the granted
 * ones and narrows it by the causer's type exactly as
 * `GrantedConditionImmunity.fromTypes` is narrowed — a cause nobody has named
 * is not filtered out, and the possession is the table's.
 */
export type AreaConditionImmunityStanding = AreaSide & {
  readonly kind: 'condition-immunity';
  readonly conditions: readonly ConditionName[];
  /** The causer's creature types the Immunity holds against; `'stated'` until the casting fills it. */
  readonly fromTypes?: readonly string[] | 'stated';
};

/**
 * Which castings a `casting-damage` grant reaches.
 *
 * Every field is a **narrowing** and an absent one asks nothing, which is the
 * reading `RollSelector` already takes: a feature that names no school reaches
 * every school. The five SRD sentences between them write all five fields, and
 * no one feature writes more than three.
 *
 * | SRD | What it narrows |
 * |---|---|
 * | Foe Slayer, "the damage die of your _Hunter's Mark_" | {@link spell} |
 * | Empowered Evocation, "a Wizard spell from the Evocation school" | {@link classId}, {@link school} |
 * | Elemental Affinity, "a spell that deals damage of that type" | {@link damageTypes} |
 * | Potent Cantrip, "a cantrip" | {@link slotLevels} |
 * | Overchannel, "a Wizard spell with a spell slot of levels 1–5" | {@link classId}, {@link slotLevels} |
 */
export interface CastingDamageWhen {
  /** One spell, by catalogue id. The engine compares it and never names one. */
  readonly spell?: string;
  /** The school the definition declares — a property of the spell, not a branch. */
  readonly school?: string;
  /**
   * The class the casting was **routed through**.
   *
   * SRD says "a **Wizard** spell", which is not "a spell on the Wizard list": a
   * Sorcerer/Wizard who prepared Fireball through the Sorcerer half casts it as
   * a Sorcerer, and Empowered Evocation says nothing about that casting. Read
   * off `CastingRoute.classId`, so a feat's grant and an item's casting match
   * no feature that names one.
   */
  readonly classId?: string;
  /**
   * The damage types the casting deals; any one of them is enough.
   *
   * Filled from the feature's own choice where the grant says
   * `damageTypesFromChoice` — the same column Elemental Affinity's Resistance
   * already reads, because the SRD writes both halves off one choice and a
   * second question would be the player answering twice.
   */
  readonly damageTypes?: readonly string[];
  /**
   * The band of slot levels, inclusive, the casting was made at.
   *
   * The **slot's** level and not the spell's, which is what Overchannel says —
   * "a spell slot of levels 1–5" — and what makes a cantrip `0` to `0` rather
   * than a fourth kind of question.
   */
  readonly slotLevels?: { readonly from: number; readonly to: number };
  /**
   * SRD Overchannel: "a Wizard spell with a spell slot of levels 1–5 **that
   * deals damage**."
   *
   * That the casting deals damage of *some* kind, where {@link damageTypes}
   * asks which. One writer, and it is here because the feature charges for
   * itself: without it a Wizard casting Detect Magic with Overchannel elected
   * would count a use and pay 6d12 for having maximised nothing.
   */
  readonly dealsDamage?: true;
}

/**
 * What a feature does to the damage a casting was going to deal.
 *
 * **Four arms of one field rather than four grants.** All four are asked for at
 * one moment, by one reader, and each is a single arithmetic operation on a
 * notation already in hand; four grant kinds would be four copies of
 * {@link CastingDamageWhen} and four call sites for one question, and the
 * repeated `when` is precisely what makes this a shape rather than five special
 * cases.
 *
 * Only `ability-modifier` has two SRD writers. That is said rather than hidden:
 * the other three are each one feature's own sentence, exactly as
 * `attack-damage.advantageOrAdjacentAlly` is, and not one of them brings any
 * machinery of its own.
 */
export type CastingDamageAlteration =
  /**
   * SRD Elemental Affinity: "you can add your Charisma modifier to **one damage
   * roll** of that spell." SRD Empowered Evocation says the same of
   * Intelligence. Two classes, one sentence, which is what makes it a shape.
   *
   * The modifier is read off the caster's sheet at the casting, so a Headband
   * of Intellect moves it exactly as it moves the save DC.
   */
  | {
      readonly kind: 'ability-modifier';
      readonly ability: Ability;
      /**
       * SRD Agonizing Blast: "you can add your Charisma modifier to that
       * spell's **damage rolls**."
       *
       * The plural is the whole of this field. Elemental Affinity and
       * Empowered Evocation each say "one damage roll", which is what
       * `takeCastingAddend` spends once and records where it landed; an
       * invocation that names a single cantrip says it of every roll that
       * cantrip makes, and an Eldritch Blast at level 5 makes two.
       *
       * Absent is the singular, which is every other writer.
       */
      readonly everyRoll?: true;
    }
  /**
   * SRD Foe Slayer: "The damage die of your _Hunter's Mark_ is a d10 rather
   * than a d6."
   *
   * A substitution over the notation rather than a number: `3d6` becomes `3d10`
   * and a notation rolling any other die is left alone. It reaches a **pinned**
   * notation too — the die an `attack-rider` writes into its own event — which
   * is what lets a replay roll a d10 without knowing the feature exists.
   */
  | { readonly kind: 'die'; readonly from: number; readonly to: number }
  /**
   * SRD Potent Cantrip: "When you cast a cantrip at a creature and you miss
   * with the attack roll or the target succeeds on a saving throw against the
   * cantrip, the target takes half the cantrip's damage (if any) but suffers no
   * additional effect from the cantrip."
   *
   * A floor where the definition offers none: an `attack` that prints no
   * `onMiss` reads as `half`, and a `save-damage` whose `onSuccess` is `none`
   * reads as `half`. "No additional effect" is what both of those branches
   * already do — neither hangs a rider — so nothing here says it twice.
   */
  | { readonly kind: 'half-when-avoided' }
  /**
   * SRD Overchannel: "you can deal maximum damage with that spell on the turn
   * you cast it."
   *
   * **Nothing is thrown.** Every die takes its highest face, so the component
   * comes back with no roll at all and the generator has not moved — the honest
   * reading of "maximum damage", and the one a replay reproduces for free. A
   * Critical Hit is applied first, because the SRD doubles the dice and this
   * maximises whatever dice the attack ends up rolling.
   */
  | { readonly kind: 'maximum' };

/**
 * What using one of these features costs its holder — the one SRD feature of
 * this shape that prints a price.
 *
 * SRD Overchannel: "The first time you do so, you suffer no adverse effect. If
 * you use this feature again before you finish a Long Rest, you take 2d12
 * Necrotic damage for each level of the spell slot immediately after you cast
 * it. This damage ignores Resistance and Immunity. Each time you use this
 * feature again before finishing a Long Rest, the Necrotic damage per spell
 * level increases by 1d12."
 *
 * **A count, not a pool**, and `Tally` in `resources.ts` is exactly the tool: a
 * pool of one would refuse the second use, where the book has the second use
 * happen and charges for it. Nothing declares a tally, so the key and the
 * recovery ride the use, which is why both are fields here.
 *
 * One writer, stated rather than dressed up as a general mechanism. It is a
 * field on the grant the maximisation lives on because the SRD's sentence makes
 * the two one feature, and the price is meaningless without it.
 */
export interface CastingDamageCost {
  /** SRD: "The first time you do so, you suffer no adverse effect." */
  readonly freeUses: number;
  /** SRD: "2d12 Necrotic damage **for each level of the spell slot**". */
  readonly dicePerSlotLevel: string;
  /** SRD: "the Necrotic damage per spell level **increases by 1d12**". */
  readonly increasesBy: string;
  readonly damageType: string;
  /** SRD: "This damage ignores Resistance and Immunity." */
  readonly ignoresDefenses?: true;
  /** What the uses are counted under — a tally's key, as a pool's is. */
  readonly key: string;
  /** SRD: "before you finish a **Long Rest**", which zeroes the count. */
  readonly recovers: Recovery;
}

/**
 * What a feature says about the **dice an attack throws**, as a declaration.
 *
 * SRD Great Weapon Fighting: "you can treat any 1 or 2 on a damage die as a
 * 3." The arithmetic has lived in the dice layer since it was written — every
 * die is individually addressable, and a substitution is a `DieEffect` — and
 * what was missing was a way for a *declaration* to ask for one. This is that
 * way, and the reader turns it into the effect the roller already takes.
 *
 * One arm, named for its writer, which is the rule every closed vocabulary in
 * this file follows. The dice layer has two other effects and neither has a
 * declaring feature yet: an explosion belongs to a spell rather than to a
 * swing and is asked for on the spell's own definition, and a reroll the
 * roller *chooses* needs a caller who is asked which dice, which nothing in
 * the command layer does. An arm arrives with the sentence that writes it.
 *
 * Declared here rather than inside {@link StandingGrant} so that the member
 * carrying it stays one kind: the union is read out of this file as data by
 * `content.test.ts`, and a nested `kind` would be counted as a grant nobody
 * grants.
 */
export type AttackDieRule = {
  /** SRD Great Weapon Fighting's substitution, and `treatLowRollsAs`'s shape. */
  readonly kind: 'treat-low-rolls-as';
  /** SRD's "any 1 or 2": the highest face the rule reaches. */
  readonly atMost: number;
  /** SRD's "as a 3": what such a face counts as instead. */
  readonly as: number;
};

/**
 * What a feature says about the **damage roll a weapon makes**, as a
 * declaration — {@link AttackDieRule}'s sibling on the other scope.
 *
 * Declared here rather than inside {@link StandingGrant} for that type's own
 * reason: the union is read out of this file as data by `content.test.ts`, and
 * a nested `kind` would be counted as a grant nobody grants.
 *
 * One arm, named for its writer. `RollRule` in the dice layer has one member
 * too, and the two lists grow together: a roll-level behaviour arrives with the
 * sentence that asks for it, and the declaration arrives with the feature that
 * says it out loud.
 */
export type AttackRollRule = {
  /** SRD Savage Attacker's two throws, and `rollUnder`'s shape. */
  readonly kind: 'roll-twice-keep-either';
};

/** What a standing benefit does. */
/**
 * What a `sees-through` grant lets its holder see through.
 *
 * One member, declared as a list so the type is read off it rather than
 * spelled twice: SRD prints one such sentence, Devil's Sight's, and a second
 * member would be somebody's invention until a printed line asks for it.
 */
export const SEES_THROUGH = ['darkness'] as const;

export type SeesThrough = (typeof SEES_THROUGH)[number];

export type StandingGrant =
  /**
   * Advantage or Disadvantage on a kind of roll — see {@link RollModifier}.
   *
   * **One member where there were four.** Danger Sense's "Advantage on
   * Dexterity saving throws", Feral Instinct's "Advantage on Initiative
   * rolls", Remarkable Athlete's "Advantage on Strength (Athletics) checks"
   * and Dodge's "any attack roll made against you has Disadvantage" were four
   * separate grant kinds with four separate readers, because there was no key
   * that could say *which* roll a mode reached — and in particular no way at
   * all to say that a mode belongs to rolls made **against** its holder, which
   * is why Dodge's was a grant kind of its own rather than a mode.
   *
   * A spell that grants a standing mode needs exactly the same vocabulary, so
   * the two sit on one selector and one predicate rather than on two
   * parallel mechanisms that could disagree. What still differs is the
   * *lifetime*: a feature's grant is derived from the world on every read and
   * stored nowhere, while a spell's is durable state linked to its casting.
   */
  | {
      readonly kind: 'roll-mode';
      readonly modifier: RollModifier;
      /**
       * SRD Dodge: "...has Disadvantage **if you can see the attacker**".
       *
       * The holder's view of whoever is rolling, which is the opposite
       * direction from the sight every other rule reads — and three-valued,
       * like every declared fact. A clause nobody has settled is applied and
       * reported rather than dropped, the direction an Opportunity Attack
       * already takes.
       *
       * Declared per effect because it is that feature's own sentence: Danger
       * Sense says nothing of the kind, and applying Dodge's clause to
       * everything would quietly rewrite it.
       */
      readonly ifSeen?: boolean;
    }
  /**
   * SRD Aura of Protection: "a bonus to saving throws equal to your Charisma
   * modifier (minimum bonus of +1)" — the *holder's* modifier, read off their
   * sheet rather than the beneficiary's.
   */
  | { readonly kind: 'save-bonus'; readonly fromAbility: Ability; readonly minimum: number }
  /**
   * SRD Innate Sorcery: "The spell save DC of Sorcerer spells you cast
   * increases by 1."
   *
   * **The other end of a saving throw**, and that is why it is a member rather
   * than a field on the one above. `save-bonus` is a number the creature
   * *rolling* adds; this is a number added to the DC the creature rolling has
   * to beat, and the two never meet: a Paladin's aura helps whoever is inside
   * it, and this makes its holder's own magic harder to shrug off. A grant
   * that tried to be both would have to know which side of the roll it was on.
   *
   * **Flat, and read where the casting settles its numbers.** `numbersFor` is
   * the one place a class casting's DC is worked out, so the bonus is added
   * there and pinned onto the casting like every other number — which is the
   * reading the SRD's own sentence takes: the DC of a spell *you cast* while
   * the minute runs, and a Web already on the floor does not get harder when
   * its caster switches the feature on afterwards.
   */
  | {
      readonly kind: 'spell-save-dc-bonus';
      /** Signed, so a curse that lowered a DC would need no second member. */
      readonly flat: number;
      /**
       * SRD's "**Sorcerer** spells you cast" — the class the casting was made
       * through, and nothing else.
       *
       * A feature belongs to exactly one class and the SRD says so in the
       * sentence itself, so a Sorcerer 1 / Wizard 4 raises the DC of the half
       * she casts as a Sorcerer and not the other. The class is read off the
       * casting's own route, which is the only place the answer lives: a
       * feat's route and an item's name no class and are therefore never it.
       *
       * Absent reaches every casting its holder makes, which is what a magic
       * item's "your spell save DC increases by 2" prints — no class, because
       * an item does not belong to one.
       */
      readonly onlyThroughClass?: string;
    }
  /**
   * SRD Divine Order (Thaumaturge) and SRD Primal Order (Magician): "you have
   * a bonus to the Intelligence (Arcana) and Intelligence (Religion) checks
   * you make. The bonus equals your Wisdom modifier (minimum of +1)."
   *
   * `save-bonus` above is the same derivation aimed at the other family, and
   * this is a member beside it rather than a field on it because a Paladin's
   * aura and a Cleric's study are two sentences that have never been written
   * as one: widening that member would rename a grant two catalogue files
   * already write, and `flat-bonus` below is "Flat, and only flat".
   *
   * **Narrowed by skill, and by nothing else.** Both writers name two skills;
   * neither says anything about the ability the check is made with, and
   * `SKILL_ABILITY` already answers that question for anybody who asks it. A
   * bonus to *every* ability check is `flat-bonus`'s shape, which is what the
   * SRD prints on a Stone of Good Luck — as a number rather than a modifier.
   */
  | {
      readonly kind: 'check-bonus';
      readonly fromAbility: Ability;
      /** SRD's "(minimum of +1)", read as a floor under the modifier. */
      readonly minimum: number;
      /** The skills the feature's own sentence names. Never empty. */
      readonly skills: readonly Skill[];
    }
  /**
   * SRD Sacred Weapon: "you add your Charisma modifier to attack rolls you
   * make with that weapon (minimum bonus of +1)."
   *
   * The third family of one derivation, and the last of the three the SRD
   * writes. `save-bonus` is Aura of Protection's saving throw, `check-bonus`
   * above is the two Orders' named skills, and `flat-bonus` below is "Flat,
   * and only flat" — so a Charisma modifier on an attack roll had no member
   * at all, and the number was one the caller passed in.
   *
   * **A member beside the other two rather than a field on either**, for the
   * reason `check-bonus` is not a widened `save-bonus`: a bonus to a saving
   * throw, a bonus to a named skill's checks and a bonus to an attack roll are
   * three sentences the book has never written as one, and the narrowing each
   * carries is different — a skill list there, a kind of weapon here.
   *
   * **The narrowing is a kind of weapon and not an object**, which is what
   * makes this the *standing* spelling of the sentence. A standing grant is
   * hung on a creature, so it reaches every weapon the narrowing admits — the
   * right reading for a feature that says "with a Melee weapon" and the wrong
   * one for a feature that says "**that** weapon". The second is
   * `ImbuedWeapon.attackBonusFrom`, hung on one object by an activation that
   * names it; SRD Sacred Weapon comes through that door and no longer through
   * this one.
   */
  | {
      readonly kind: 'attack-bonus';
      readonly fromAbility: Ability;
      /** SRD's "(minimum bonus of +1)", read as a floor under the modifier. */
      readonly minimum: number;
      /**
       * The weapons the sentence reaches — SRD Sacred Weapon's "one **Melee**
       * weapon that you are holding". Absent reaches every attack roll,
       * including a spell's and a fist's.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
    }
  /**
   * SRD Sacred Weapon: "The weapon also emits Bright Light in a 20-foot radius
   * and Dim Light for an additional 20 feet."
   *
   * The `light` {@link SpellEffect}'s own three fields, on the other side of
   * the fence: a level, a radius, and the book's "for an additional" measured
   * **beyond** the first. What the spell side lays as a patch sourced to its
   * casting, this one is *derived* — `carriedLight` inside `lightAt` reads it
   * off the sheet on every question, beside a beetle's own Illumination and
   * never among the declared patches. So the light moves with its holder, no
   * event says that it did, and it is gone the read after the feature is, by
   * whichever door the feature left through.
   *
   * **Nonmagical, and that is the absence of a field rather than a decision
   * taken here.** The one rule that reads the flag compares spell *levels* —
   * SRD Darkness and SRD Daylight putting each other out — and a feature has
   * no level to compare with. So a feature's light loses to a magical darkness
   * exactly as a torch does, which is Darkness's own sentence.
   *
   * **Withheld from an item**, for `speed`'s reason rather than
   * `attack-bonus`'s: the reader is inside `lightAt`, which sits below
   * `standing.ts` in the import graph and cannot gather what a worn item
   * grants — and it must not, because `requirementsHold` calls `lightAt` and a
   * reader that went back through it would be asking a question of its own
   * answer. See `ITEM_EFFECT_KINDS`.
   */
  | {
      readonly kind: 'light';
      readonly level: LightLevel;
      /** SRD's "in a 20-foot radius", measured from the holder's own space. */
      readonly radius: number;
      /** SRD "Dim Light for an additional N feet": a dim sphere N wider. */
      readonly dimBeyond?: number;
    }
  /**
   * A flat number added to something, with the item or feature's name on it.
   *
   * **The commonest sentence in the book, and the one shape this union did not
   * have.** `save-bonus` above is Aura of Protection's — a number *derived*
   * from an ability, which is why it is its own member — and `attack-damage`
   * below is a feature's extra die. Between them they could not say "+1 bonus
   * to Armor Class", which the SRD prints on dozens of items and on nothing
   * else in the engine.
   *
   * **It is the spell side's shape admitted here**, the way `roll-mode` is
   * `RollModifier` admitted here: `ActiveBonus` has carried `applies` and a
   * flat number since Shield of Faith, and reading a second vocabulary for the
   * same arithmetic is how two mechanisms come to disagree. What differs is
   * the lifetime — a spell's bonus starts at a moment and is stored, this one
   * is derived on every read — and the one thing a spell never needed:
   *
   * **the narrowing.** SRD Weapon, +1: "a bonus to attack rolls and damage
   * rolls **made with this magic weapon**". A spell hangs its bonus on a
   * creature and is done; an item's rides on the *object*, so a +1 Longsword
   * must do nothing for the bow in the same pack. {@link onlyWithItem} is that
   * clause, and {@link StandingEffect.feature} is the item it names.
   *
   * Flat, and only flat. Every bonus the SRD prints in this shape is a number
   * — the rarity decides whether it is 1, 2 or 3 — and an Armour Class has no
   * moment at which a die could be thrown for it. A feature that rolled would
   * be `attack-damage` or a caller's `Bonus`, both of which already exist.
   */
  | {
      readonly kind: 'flat-bonus';
      /**
       * SRD "to Armor Class and saving throws": one sentence, two targets.
       *
       * `attack` is a **weapon** attack roll here. A spell attack gathers no
       * standing bonus, and the member that would reach one is
       * `a-bonus-to-spell-attack-rolls`, named and deliberately absent — see
       * {@link StandingBonusApplies}.
       */
      readonly applies: readonly StandingBonusApplies[];
      /** Signed, so a cursed item's penalty needs no second mechanism. */
      readonly flat: number;
      /**
       * SRD Weapon, +1: "made with this magic weapon" — and with no other.
       *
       * Keyed on {@link StandingEffect.feature}, which carries the granting
       * item's id, so the narrowing needs no second field to look anything up
       * in. Legal only where a roll is *made with* something: an Armour Class
       * and a saving throw are not, and `checkContent` refuses the pairing
       * rather than accepting a benefit that could never hold.
       */
      readonly onlyWithItem?: boolean;
      /**
       * SRD Archery: "attack rolls you make with **Ranged weapons**".
       *
       * The narrowing above's sibling and a different sentence — one names an
       * object, this names a kind of weapon. See {@link WeaponNarrowing}, and
       * `checkContent` holds it to the same two families `onlyWithItem` is
       * held to: a roll is *made with* a weapon, and an Armour Class is not.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
    }
  /**
   * A rule about the **dice** a weapon swing throws, rather than a number
   * added to it.
   *
   * SRD Great Weapon Fighting: "When you roll damage for an attack you make
   * with a Melee weapon that you are holding with two hands, you can treat any
   * 1 or 2 on a damage die as a 3. The weapon must have the Two-Handed or
   * Versatile property to gain this benefit."
   *
   * `flat-bonus` above is every sentence that adds a number and `attack-damage`
   * is every one that adds a die; this is the third thing a feature can say
   * about a hit, and neither of the other two could say it — the benefit
   * changes what a die *counts as* rather than what stands beside it.
   *
   * **Its scope is the attack, not a component.** The SRD's clause is about
   * "an attack you make", so the rule reaches every damage die the swing
   * throws, which is `AttackOptions.damageEffects` and is what `attack.test.ts`
   * has pinned since the field existed. A rule about one *spell's* dice is the
   * other scope and travels on that component — the two are different
   * sentences and both are printed.
   */
  | {
      readonly kind: 'attack-die-rule';
      readonly rule: AttackDieRule;
      /**
       * The sentence's own narrowing, read off the weapon the swing resolved.
       *
       * Absent covers every attack its holder makes, which no SRD feature
       * says and a homebrew one might.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
    }
  /**
   * A rule about the **roll** a weapon's damage is, rather than about a die in
   * it — the member above's sibling, on the other scope.
   *
   * SRD Savage Attacker: "Once per turn when you hit a target with a weapon,
   * you can roll the weapon's damage dice twice and use either roll against
   * the target."
   *
   * `attack-die-rule` reaches every die the swing throws and judges each one
   * alone; this reaches the weapon's component and judges the two totals. See
   * {@link RollRule} for why that is a different signature rather than a
   * fourth field on `DieEffect`, and {@link AttackOptions.weaponRollRule} for
   * why the scope is the weapon's own dice and not the whole hit.
   */
  | {
      readonly kind: 'attack-roll-rule';
      readonly rule: AttackRollRule;
      /**
       * SRD's "Once per turn", kept on the combat ledger `attack-damage`'s own
       * once-per-turn clause is kept on — a `feature-used` mark under this
       * feature's id and the turn it was spent. Out of combat there is no turn
       * to be once in, which is the reading every other holder of this flag
       * already takes.
       */
      readonly oncePerTurn?: true;
      /**
       * The sentence's own narrowing, read off the weapon the swing resolved.
       *
       * Absent covers every weapon its holder swings, which is what SRD
       * Savage Attacker says — "when you hit a target with a weapon", with no
       * clause about which.
       */
      readonly onlyWithWeapon?: WeaponNarrowing;
    }
  /**
   * A face of the d20 thrown again, with the new one standing.
   *
   * SRD Luck: "When you roll a 1 on the d20 of a D20 Test, you can reroll the
   * die, and you must use the new roll."
   *
   * **Not a {@link RollModifier}.** That union is modes, applied inside
   * `selectorMatches` before a die is thrown; this is a rule read *after* one
   * lands and it replaces a result rather than changing how it was reached.
   * Putting it there would make one union two things and would hand
   * `combineRollModes` a member it cannot weigh.
   *
   * **Not a Reaction either**, which is the other thing the engine already had:
   * `rerollTest` is reached only through a window a feature spends its Reaction
   * at. This trait costs nothing, is offered by nobody and fires on the face
   * rather than on the outcome, so it belongs in the pipeline — see
   * {@link CharacterSheet.rerollsD20On}, which is how it gets there.
   */
  | {
      readonly kind: 'reroll-test-die';
      /** SRD's "a 1 on the d20": the face that is thrown again. */
      readonly on: number;
    }
  /**
   * A floor this creature's Hit Points cannot be driven below by one blow,
   * paid for out of a limit the grant declares.
   *
   * SRD Relentless Endurance: "When you are reduced to 0 Hit Points but not
   * killed outright, you can drop to 1 Hit Point instead. Once you use this
   * trait, you can't do so again until you finish a Long Rest."
   *
   * **The limit rides on the grant**, exactly as {@link CastingDamageCost}'s
   * does and for the same reason: `FeatureDefinition.grants` is singular, so
   * the feature that states the rule is the feature that would have had to
   * declare the pool, and two grants cannot say one sentence. A tally rather
   * than a pool because nothing declares a tally — the key and what empties it
   * ride on the use — and the reader here is what refuses the second one,
   * which is the same division of labour Overchannel's count already has.
   *
   * **"Not killed outright" is not a field.** It is Massive Damage and a
   * monster's `diesAtZero`, both of which `applyDamageToVitals` settles before
   * it reaches the floor at all, so a grant cannot get them wrong.
   */
  | {
      readonly kind: 'hit-point-floor';
      /** SRD's "1 Hit Point": what the blow may not drive them below. */
      readonly floor: number;
      /** What the uses are counted under — a tally's key, as a pool's is. */
      readonly key: string;
      /** SRD's "until you finish a Long Rest", which zeroes the count. */
      readonly recovers: Recovery;
    }
  /**
   * The size this creature's **carrying capacity** is read at, where it is not
   * the size the creature is.
   *
   * SRD Powerful Build: "You also count as one size larger when determining
   * your carrying capacity."
   *
   * A step rather than a named size, because the SRD writes it as a relation
   * and a named one would be wrong the moment the holder is enlarged — the
   * same argument `oneLargerThan` is written on. Nothing else about the
   * creature moves: it still occupies its own space, is still grappled by the
   * same sizes and still squeezes through the same gaps.
   */
  | { readonly kind: 'carrying-capacity'; readonly sizesLarger: number }
  /**
   * How many sizes larger a creature need be for this one to walk through its
   * space, where the glossary's two are more than a feature asks.
   *
   * SRD Halfling Nimbleness: "You can move through the space of any creature
   * that is a size larger than you, but you can't stop in the same space."
   * The rule it bends is `canPassThrough`, a constant the engine applies to
   * everybody, and the second half of the sentence is not here because
   * nothing has to carry it: ending a move in an occupied space is refused to
   * every creature already.
   *
   * A step rather than a named size, for {@link StandingGrant}'s
   * `carrying-capacity` reason — a relation survives its holder being
   * enlarged — and the *larger* side alone, because that is the side the
   * sentence names.
   */
  | { readonly kind: 'passage'; readonly sizesLarger: number }
  /**
   * SRD Ritual Adept: "You can cast any spell as a Ritual if that spell has
   * the Ritual tag and the spell is in your spellbook. You needn't have the
   * spell prepared, but you must read from the book to cast a spell in this
   * way."
   *
   * The licence `chooseRoute` reads when a Ritual is cast and no route
   * supplies the spell: a class whose book holds it casts it as its own,
   * slotless, and the casting layer still refuses a spell without the tag.
   * The book being in hand is the table's.
   */
  | { readonly kind: 'ritual-from-book' }
  /**
   * SRD Jack of All Trades: "You can add half your Proficiency Bonus (round
   * down) to any ability check you make that uses a skill proficiency you lack
   * and that doesn't already include that bonus."
   *
   * Read where every check bonus is gathered, and only for a check made
   * **with a skill** the holder is not proficient in: a raw Strength check
   * uses no skill proficiency, and Initiative uses none either — the 2024
   * reading, which is the opposite of 2014's. No field, because the half is
   * the sentence's and the bonus is the sheet's.
   */
  | { readonly kind: 'half-proficiency-on-checks' }
  /**
   * SRD Naturally Stealthy: "You can take the Hide action even when you are
   * obscured only by a creature that is at least one size larger than you."
   *
   * The concealment `takeHide` asks for — Three-Quarters Cover, Total Cover or
   * Heavy Obscurement — widened for its holder alone to a creature one size
   * larger standing within five feet. Which watcher that creature stands
   * between the hider and is the table's, and the Hide says so.
   */
  | { readonly kind: 'hides-behind-larger-creature' }
  /**
   * SRD Slow Fall: "you can take a Reaction to reduce any damage you take from
   * the fall by an amount equal to five times your Monk level."
   *
   * The multiplier is the sentence's; the level is the **granting class's**,
   * pinned at creation into `classLevel` because a multiclassed Monk's sheet
   * holds only the total and this sentence counts Monk levels. `resolveFall`
   * reads it when the faller elects the Reaction.
   */
  | {
      readonly kind: 'fall-damage-reduction';
      readonly perClassLevel: number;
      /** Pinned by creation; absent on content, which never knows the level. */
      readonly classLevel?: number;
    }
  /**
   * SRD Second-Story Work: "when you make a running jump, the distance you
   * cover increases by a number of feet equal to your Dexterity modifier."
   *
   * Feet added to the running Long Jump alone, read off the holder's own
   * score as it stands where the jump's reach is measured.
   */
  | { readonly kind: 'jump-bonus'; readonly fromAbility: Ability }
  /**
   * SRD Aura of Courage: "Immunity to the Frightened condition while in your
   * Aura of Protection. If a Frightened ally enters the aura, that condition
   * **has no effect on that ally while there**."
   *
   * Suppression, not prevention and not removal. The condition stays on the
   * creature and comes back the moment they leave, which is what "while there"
   * means and what a flat immunity would get wrong in both directions.
   */
  | { readonly kind: 'condition-immunity'; readonly condition: ConditionName }
  /**
   * SRD Elemental Affinity: "You have Resistance to that damage type."
   *
   * Resistance rather than a general defence entry, because that is all any
   * SRD class feature grants this way — a feature that made somebody immune or
   * vulnerable would be a different shape and none exists to model it after.
   */
  | { readonly kind: 'damage-resistance'; readonly damageTypes: readonly string[] }
  /**
   * Extra damage on a weapon attack that hits.
   *
   * Two SRD features, and the difference between them is the whole reason this
   * carries a damage type at all:
   *
   * - **Rage Damage** is "a bonus to the damage", of the weapon's own type, so
   *   a target resisting the sword resists the bonus with it. No `damageType`.
   * - **Radiant Strikes** is "an extra 1d8 Radiant damage", which Slashing
   *   resistance does nothing to. `damageType: 'radiant'`.
   *
   * The conditions are each feature's own sentence: Rage Damage wants an
   * attack "using Strength", Radiant Strikes one "using a Melee weapon or an
   * Unarmed Strike".
   *
   * **And one clause no class feature has**: {@link onlyWithItem}, which is
   * `flat-bonus`'s narrowing on the member beside it. A feature's die belongs
   * to the *character* and rides whatever they swing; a magic weapon's belongs
   * to the *object*, and the SRD writes the difference in as many words —
   * Vicious Weapon is "this magic weapon deals an extra 2d6 damage", Frost
   * Brand "when you hit with an attack roll using this magic weapon". Without
   * it the die would follow its holder onto every other weapon in the pack,
   * which is a better item than the book prints.
   */
  /**
   * SRD Evasion, which the Rogue and the Monk both have under that name:
   *
   * > "When you're subjected to an effect that allows you to make a Dexterity
   * > saving throw to take only half damage, you instead take no damage if you
   * > succeed on the saving throw and only half damage if you fail."
   *
   * Named for the SRD rule rather than for either class, exactly as
   * `expertise` is — two features, one rule, and the rule has a name. It
   * carries no fields because both features are word for word the same; where
   * they differ is the Monk's "You can't use this feature if you have the
   * Incapacitated condition", which is an ordinary `StandingRequirement` and
   * is declared on that feature alone.
   *
   * It bites only where the effect already offers half on a success. An effect
   * that offers nothing — Sacred Flame — has no half to take, and Evasion says
   * nothing about it.
   */
  | { readonly kind: 'evasion' }
  /**
   * The ability modifier put back on the Light property's extra attack.
   *
   * SRD Two-Weapon Fighting: "When you make an extra attack as a result of
   * using a weapon that has the **Light** property, you can add your ability
   * modifier to the damage of that attack if you aren't already adding it."
   *
   * **A bare marker, for `evasion`'s reason.** It carries no number and no
   * narrowing because the sentence has none: there is one extra attack the
   * Light property buys, the property's own clause takes the modifier off it,
   * and this puts it back. Anything this grant could carry would be a rule the
   * book does not print.
   *
   * **It is named after the rule and not after the feat**, which is what keeps
   * it out of the origin sweep: `lightAttack` is a field on a swing, the Light
   * property is the equipment table's, and the feat is one thing that may
   * carry this — a homebrew class feature saying the same sentence carries it
   * too, and the reader cannot tell them apart.
   *
   * "if you aren't already adding it" is the one clause with nowhere to bite:
   * the Light property's own sentence has already taken the modifier off, so
   * there is never a case where it is still on.
   */
  | { readonly kind: 'light-extra-attack-damage' }
  /**
   * SRD Cunning Action, SRD Adrenaline Rush: a rule about the action economy
   * that a **feature** states about its own holder.
   *
   * The vocabulary is {@link ActionRule} in `combat.ts` and it is deliberately
   * the same one a casting hangs — "what this creature's action economy
   * permits *now*" is one fact, and a second mechanism for it would be a
   * second place for one sentence to be wrong. What differs is the lifetime,
   * which is the difference this whole file is about: a casting's rule is
   * stored on the creature and released when the casting ends, and a
   * feature's is **derived on every read** by {@link actionRulesOn}, because
   * whether a Rogue may Dash out of a Bonus Action is a fact about the sheet
   * they are holding rather than an event anybody could write down.
   *
   * Storing one at creation would have been the tempting reading and is wrong
   * twice over: it would put a permanent unconditional row into every Rogue's
   * state — the copy `StandingEffect` exists to refuse — and it would reach no
   * character already written into a log, because a fold replays the events a
   * log holds rather than re-compiling a sheet.
   */
  | {
      readonly kind: 'action-rule';
      readonly rule: ActionRule;
      /**
       * How a refusal finishes its sentence: "your Rage ends".
       *
       * Optional, unlike a casting's, and that is the derivation showing
       * through: a casting pins a deadline because the casting ends at a
       * moment, while a feature's rule holds exactly as long as the feature's
       * own clause does and is re-read rather than remembered. A feature that
       * has something to say about when it stops says it here.
       */
      readonly until?: string;
      /**
       * A pool a use of the allowance comes out of — SRD Adrenaline Rush: "You
       * can use this trait a number of times equal to your Proficiency Bonus."
       * Declared by a `pool` grant on the same feature. The command that takes
       * the price spends it, and refuses the price with the pool empty and
       * nothing charged. Only an `allows` rule carries one.
       */
      readonly spends?: string;
      /**
       * Temporary Hit Points the allowance pays the moment its price is taken
       * — SRD Adrenaline Rush: "When you do so, you gain a number of Temporary
       * Hit Points equal to your Proficiency Bonus." A number, or the holder's
       * Proficiency Bonus read as it stands when the price is taken.
       */
      readonly temporaryHitPoints?: number | 'proficiency-bonus';
    }
  /**
   * Feet added to the holder's Speed while the feature's own clause holds.
   *
   * Three SRD features and one sentence between them:
   *
   * | | |
   * |---|---|
   * | Fast Movement (Barbarian 5) | "Your speed increases by 10 feet while you aren't wearing Heavy armor." |
   * | Roving (Ranger 6) | "Your Speed increases by 10 feet while you aren't wearing Heavy armor." |
   * | Unarmored Movement (Monk 2) | "Your speed increases by 10 feet while you aren't wearing armor or wielding a Shield. This bonus increases when you reach certain Monk levels." |
   *
   * A flat number rather than a per-level table, because the table is
   * `FeatureGrant.feetByLevel` and is read at **that class's own** level when
   * the sheet is built — the same split `diceCountByLevel` already makes for
   * Sneak Attack, and for the same reason: a standing effect on a sheet knows
   * nothing about which class granted it.
   *
   * Speed *reductions* are not this member's business. Exhaustion's "5 times
   * your Exhaustion level" is `conditionSpeed`'s, and nothing else in the
   * engine reduces one yet — so {@link SpeedChange}'s `halve` and `zero` are
   * refused here, and the member carries the two that give a Speed.
   *
   * **And a fourth SRD feature, which is why it names a mode now.** SRD
   * Second-Story Work: "You gain a Climb Speed equal to your Speed." One
   * sentence, spelled exactly as SRD Spider Climb's is on a definition —
   * `change: 'match-walk'` and the mode — because it *is* that sentence, and
   * two spellings of one rule is two places for it to drift.
   */
  | {
      readonly kind: 'speed';
      /**
       * Absent is `add`, which is every feature written before modes existed
       * and is what keeps those three from having to be rewritten.
       */
      readonly change?: SpeedChange;
      /** Required by `add`, refused by `match-walk`. */
      readonly feet?: number;
      /** Absent is the walking Speed. */
      readonly mode?: MovementMode;
    }
  /**
   * A sense the holder has, and how far it reaches.
   *
   * SRD writes one sentence for all four of them — "You have Darkvision with
   * a range of 60 feet", "the vampire has Blindsight out to 60 feet", "you
   * have Truesight out to 120 feet" — and a species trait, a monster's stat
   * block and a magic item all print it the same way, which is what makes it
   * a shape rather than one species' quirk.
   *
   * A standing grant rather than a field on the sheet, and the two clauses
   * that decides are the SRD's own: Goggles of Night grant Darkvision "while
   * you wear" them, and Robe of Eyes while it is worn, so the sense has to be
   * derived on every read exactly as a Monk's Unarmoured Movement is. A
   * stored copy would be Darkvision that survived taking the goggles off.
   *
   * What it is **not** is a claim about light. The engine holds no Bright,
   * Dim or Darkness — see `sightBetween`, which consults a sense only where
   * nobody has declared a sight line, and obeys the declaration everywhere
   * else.
   */
  | { readonly kind: 'sense'; readonly sense: SenseName; readonly feet: number }
  /**
   * Darkness this creature sees through, and how far.
   *
   * **Not a fifth sense**, and that is the whole reason it is its own grant:
   * the rules glossary defines four, `SENSE_NAMES` is closed on them, and
   * SRD Devil's Sight is not in the list — "You can see normally in Darkness,
   * both magical and nonmagical, to a distance of 120 feet" is an exception
   * to one rule about light rather than a way of perceiving. Adding it to
   * `SENSE_NAMES` would have handed it every sentence Blindsight answers,
   * starting with Invisible's "can somehow see you".
   *
   * `through` is a closed vocabulary of one because the SRD prints one. What
   * makes the member worth naming rather than assuming is that Darkvision
   * already sees through *nonmagical* darkness: what this adds is the magical
   * half, which is the only thing the sentence buys. See
   * {@link piercesObscurement}, which is where both are read.
   */
  | { readonly kind: 'sees-through'; readonly through: SeesThrough; readonly feet: number }
  /**
   * An ability score **set** to a number while whatever grants it holds.
   *
   * A third verb beside the two `ability-score-increase` has, and the SRD
   * prints it in one sentence per item: "Your Strength is 19 while you wear
   * these gauntlets", "Your Intelligence is 19 while you wear this
   * headband", "While wearing this belt, your Strength changes to a score
   * granted by the belt". Neither of the other two verbs says it. A raise of
   * +11 would be a different item on a different character, and a lifted
   * ceiling raises nothing at all. How many entries print it is
   * `COVERAGE.md`'s question.
   *
   * **A standing grant rather than creation's arithmetic**, and the second
   * half of the same sentence decides it: the score holds *while worn*, so
   * taking the gauntlets off has to take the Strength with them. That is the
   * lifetime this file already insists must be derived on every read, for the
   * reason `sense` is — "a stored copy would be Darkvision that survived
   * taking the goggles off".
   *
   * **The set never lowers a score.** Every printed sentence says so in its
   * second clause — "It has no effect on you if your Constitution is 19 or
   * higher without it", "unless your Strength is already equal to or greater
   * than that score" — and that is one rule rather than one per item, so
   * {@link abilityScoresOf} keeps it rather than each item.
   *
   * A feature may carry it too. No SRD class feature does, and the grant is
   * a member of the one vocabulary read by the one reader, so refusing it on
   * a feature would be refusing a homebrew sentence the engine executes
   * perfectly well.
   */
  | { readonly kind: 'ability-score-set'; readonly ability: Ability; readonly score: number }
  | {
      readonly kind: 'attack-damage';
      readonly dice?: string;
      readonly flat?: number;
      /** Absent means the weapon's own type, which is what a *bonus* is. */
      readonly damageType?: string;
      /** SRD Rage Damage: "When you make an attack using Strength". */
      readonly usingAbility?: Ability;
      /** SRD Radiant Strikes: "using a Melee weapon or an Unarmed Strike". */
      readonly meleeOnly?: boolean;
      /**
       * SRD "Once per turn" / "Once on each of your turns".
       *
       * Sneak Attack, Colossus Slayer, Divine Strike and Primal Strike all say
       * it, which is what makes it the shape rather than one class's quirk —
       * and it is **not** once per round. See `featureUsedOnTurn`.
       *
       * Outside combat there are no turns and nothing restricts it.
       */
      readonly oncePerTurn?: boolean;
      /**
       * SRD Colossus Slayer: "When you hit a creature **with a weapon**".
       *
       * Distinct from `meleeOnly`: an Unarmed Strike is melee and is not a
       * weapon, so a Monk's fist qualifies for Radiant Strikes and not for
       * this.
       */
      readonly weaponOnly?: boolean;
      /** SRD Sneak Attack: "the attack uses a Finesse or a Ranged weapon". */
      readonly finesseOrRangedWeapon?: boolean;
      /**
       * SRD Colossus Slayer: "if it's missing any of its Hit Points".
       *
       * A fact about the target the engine holds exactly, which is why this
       * feature is expressible and Horde Breaker beside it is not.
       */
      readonly targetMissingHitPoints?: boolean;
      /**
       * SRD Sneak Attack's two-branch qualification, transcribed whole.
       *
       * > "if you have Advantage on the roll ... You don't need Advantage on
       * > the attack roll if at least one of your allies is within 5 feet of
       * > the target, the ally doesn't have the Incapacitated condition, and
       * > you don't have Disadvantage on the attack roll."
       *
       * One field rather than three because it is one sentence with an
       * either/or in it, and splitting it would let a definition express half
       * of a rule the SRD never writes by halves. It has one user, like
       * `usingAbility` had when Rage Damage was the only feature with it —
       * each of these is a feature's own clause rather than a generalisation.
       */
      readonly advantageOrAdjacentAlly?: boolean;
      /**
       * Damage types the holder picks between **at the hit**.
       *
       * SRD Divine Strike: "an extra 1d8 Necrotic or Radiant damage (your
       * choice)". SRD Primal Strike: "Cold, Fire, Lightning, or Thunder
       * (choose when you hit)". Per hit, so it cannot live on the sheet the
       * way Elemental Affinity's one resistance does.
       *
       * Naming no type is how a caller declines the feature, which is what
       * "**you can** cause the target to take" means. An illegal type is
       * refused before anything is rolled rather than quietly ignored.
       */
      readonly damageTypeChoices?: readonly string[];
      /**
       * SRD Vicious Weapon: "**this magic weapon** deals an extra 2d6 damage".
       *
       * The same clause `flat-bonus.onlyWithItem` carries and read the same
       * way — keyed on {@link StandingEffect.feature}, which carries the
       * granting item's id, so it needs no second field to look anything up
       * in, and a class feature declaring it would grant nothing at all.
       * `checkContent` refuses that pairing rather than accepting it.
       *
       * It narrows *which weapon*, and nothing else. Whether the die lands at
       * all still depends on the qualifications above, and an item whose
       * clause tests what the *target* is — "if the target is a Dragon" — is a
       * different narrowing that does not exist yet.
       */
      readonly onlyWithItem?: boolean;
    }
  /**
   * A feature of the **caster** that reaches into a casting's own arithmetic.
   *
   * Everything a spell deals is the definition's and is settled when the
   * casting is written; five SRD features say otherwise, and until this member
   * none of them had anywhere to say it. They are one shape because they share
   * a reader: something consulted once, at the casting, that asks *is this
   * casting one I reach* ({@link CastingDamageWhen}) and then *what do I do to
   * the damage it was going to deal* ({@link CastingDamageAlteration}).
   *
   * **A standing grant rather than a `FeatureGrant` of its own**, for the
   * reason `evasion` beside it is one: it is a property the holder has
   * continuously and is derived on every read, and the moment it bites is a
   * moment somebody else's command is in the middle of. It also lets Elemental
   * Affinity carry both halves of one SRD sentence — the Resistance and this —
   * as two effects of one grant, which a feature holding a single
   * `FeatureGrant` could not.
   *
   * **The alteration is pinned, never the feature.** A notation a feature
   * rewrote reaches the log rewritten, and nothing the fold reads has to know
   * the feature existed: `attack-rider-granted` carries the d10, and every
   * other alteration is spent before the dice and lands in the amounts the
   * damage events already record.
   *
   * It reaches the casting itself and no later moment of it. SRD Overchannel
   * says "on the turn you cast it", and what the other four alter is the damage
   * the casting deals rather than the debts it leaves behind — so an area
   * catching somebody a minute later, a delayed hit and a turn payout all roll
   * what the definition prints.
   */
  | {
      readonly kind: 'casting-damage';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingDamageWhen;
      /** What it does to what they deal. */
      readonly alters: CastingDamageAlteration;
      /**
       * SRD "**you can** add your Charisma modifier", "**you can** deal maximum
       * damage": the caster elects it, casting by casting.
       *
       * Three of the five say it and two do not — Potent Cantrip's cantrips
       * "affect even creatures that avoid the brunt of the effect" and Foe
       * Slayer's die simply *is* a d10 — so it is a field rather than a rule.
       * An elected feature is named on the request; one that is not elected
       * does nothing, which is how "you can" is declined.
       */
      readonly optional?: true;
      /** What electing it costs — see {@link CastingDamageCost}. */
      readonly costs?: CastingDamageCost;
    }
  /**
   * A feature of the caster that reaches into what a casting **restores**.
   *
   * The member above's argument on the other half of a casting's arithmetic,
   * and it is a second member rather than a fifth arm of that one because the
   * two are read at different moments by different resolvers: damage is asked
   * for once, before the dice, and folded into a notation; healing is asked
   * for per creature healed, after them, because the SRD's sentence is about
   * the creature rather than about the roll — "**that creature** regains
   * additional Hit Points".
   *
   * SRD Disciple of Life is the writer: "When a spell you cast with a spell
   * slot restores Hit Points to a creature, that creature regains additional
   * Hit Points ... equal to 2 plus the spell slot's level." Three more SRD
   * sentences want this same reader and each needs an arm this does not have
   * — Blessed Healer's echo back onto the caster, Supreme Healing's maximised
   * dice, and Preserve Life's cap at half a creature's maximum — so they are
   * named here rather than guessed at, exactly as `CastingDamageAlteration`
   * names the writers of its single-writer arms.
   *
   * **It reaches the casting and no later moment of it**, which is the rule
   * the member above already keeps: SRD says "on the turn you cast the spell",
   * so an area healing somebody a minute later and a later use of an ongoing
   * casting restore what the definition prints. The one casting it does not
   * reach that arguably should is a **readied** spell released later: the slot
   * went at the Ready, and the record a release settles from carries the
   * casting's id and nothing else for this to read.
   */
  | {
      readonly kind: 'casting-healing';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingHealingWhen;
      /** What it does to what they restore. */
      readonly alters: CastingHealingAlteration;
    }
  /**
   * A feature of the caster that reaches into how far a casting **carries**.
   *
   * SRD Eldritch Spear: "When you cast the chosen cantrip, its range increases
   * by a number of feet equal to 30 times your Warlock level."
   *
   * **The third member of the `casting-*` family, and a third because a third
   * reader asks it.** Damage is settled once the effect list is in hand,
   * healing once per creature healed, and the reach is settled *before either*
   * — before a target is validated, before the slot goes, before anything is
   * rolled. A fourth arm of `CastingDamageAlteration` would have been a number
   * asked for at a moment that half of its arms cannot be asked at.
   *
   * **It is not the option a Sorcerer buys.** `CastingCostAlteration`'s
   * `range` arm multiplies a printed distance and is priced out of a pool;
   * this adds feet, is free, and stands on one spell for as long as its holder
   * holds the feature — which is why {@link CastingDamageWhen} is the
   * narrowing and `alteredCasting` is not the reader. Both end up on the same
   * `reachFeet`, in that order: the option multiplies what the book printed
   * and this lengthens what the option left.
   *
   * A range that is not a distance — Self, Touch, or the DM's — is left
   * exactly as it was. There is nothing in the book that lengthens a range of
   * Self, and a feature that reaches nothing is a feature that did nothing
   * rather than a refusal: unlike a bought option, no price was paid for it.
   */
  | {
      readonly kind: 'casting-range';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingDamageWhen;
      /** SRD's "30 times your Warlock level", in feet per level. */
      readonly perClassLevel: number;
      /**
       * Pinned by creation; absent on content, which never knows the level.
       *
       * The reading `fall-damage-reduction` already takes of "five times your
       * Monk level": the level is the **granting class's**, so a Warlock 5 /
       * Fighter 3 lengthens by 150 feet and not 240.
       */
      readonly classLevel?: number;
    }
  /**
   * A feature of the caster that hangs **its own rider** on one spell's
   * settled outcomes.
   *
   * SRD Repelling Blast: "When you hit a Large or smaller creature with the
   * chosen cantrip, you can push the creature up to 10 feet straight away from
   * you."
   *
   * **The rider vocabulary, reached from the caster's side.** A definition
   * writes {@link OutcomeRiders} onto the outcome the book prints it on; this
   * writes the same value onto the outcomes of a spell whose *definition* says
   * nothing about it, because the sentence is printed on the Warlock rather
   * than on Eldritch Blast. Nothing new is executed: what is carried is the
   * value `applyRiders` already applies, which is what keeps a feature from
   * being a second, quieter effect format.
   *
   * **It reaches an attack's hit and nothing else.** Every rider is hung on an
   * affirmative outcome, and the only affirmative outcome a caster's feature
   * can name without knowing the spell is the hit — "when you **hit** ... with
   * the chosen cantrip". A save a spell forces is the target's branch, and a
   * grant that rode it would be a feature deciding what somebody else's
   * failure costs. A spell that makes no attack roll is simply not reached,
   * which is the narrowing's own business rather than a refusal;
   * `checkContent` refuses the one thing that cannot be anything else — a
   * rider with no slot filled at all, which is a grant promising something and
   * hanging nothing.
   */
  | {
      readonly kind: 'casting-rider';
      /** Which castings it reaches; absent fields ask nothing. */
      readonly when: CastingDamageWhen;
      /** What a hit carries besides what the definition printed. */
      readonly rides: OutcomeRiders;
    };

/**
 * Which castings a `casting-healing` grant reaches.
 *
 * {@link CastingDamageWhen}'s reading, with one field, because one narrowing
 * has a writer: SRD Disciple of Life's "a spell you cast **with a spell
 * slot**", which is what tells a Cure Wounds from a potion's conferral, a
 * wand's casting and a free casting a feature paid for. A second field here
 * would be a narrowing nothing narrows.
 */
export interface CastingHealingWhen {
  /**
   * That a spell slot paid for the casting.
   *
   * Absent asks nothing, which is the reading every narrowing in this file
   * takes; `true` is the SRD's own clause.
   */
  readonly withSlot?: true;
}

/**
 * What a feature does to the hit points a casting was going to restore.
 *
 * One arm, and it is Disciple of Life's: a flat number, optionally plus the
 * level of the slot that paid. The three other SRD sentences this reader would
 * serve are named on the grant above and none of them is written here, because
 * a member of a closed vocabulary exists when a feature writes it.
 */
export type CastingHealingAlteration = {
  readonly kind: 'flat';
  /** SRD Disciple of Life's "2", before the slot level is added to it. */
  readonly flat: number;
  /** SRD's "plus the spell slot's level". */
  readonly plusSlotLevel?: true;
};

/**
 * What must hold for a standing effect to apply at all.
 *
 * Declared per effect, from that feature's own text, because it is **not** a
 * general rule. Danger Sense stops "unless you have the Incapacitated
 * condition" and the Paladin's aura "is inactive while you have the
 * Incapacitated condition"; Elemental Affinity says nothing of the kind, and a
 * stunned Sorcerer still resists fire. An earlier version of this module
 * applied the first two features' clause to everything, which would have
 * quietly rewritten the third.
 */
export type StandingRequirement =
  | { readonly kind: 'not-incapacitated' }
  /**
   * A feature must be switched on — and **not necessarily this one**.
   *
   * SRD Rage grants Resistance and Advantage "while active", where the feature
   * required is the one granting them. Mindless Rage is the case that makes
   * the distinction real: it is the Berserker's feature, and what it requires
   * is the *Barbarian's* Rage. A requirement that meant "whichever feature
   * granted me" would have been right once and wrong the next time.
   */
  | { readonly kind: 'feature-active'; readonly feature: string }
  /**
   * SRD Dodge: "You lose these benefits ... if your Speed is 0."
   *
   * The **whole** Speed, through `speedOf`, which is the reading movement
   * takes — so a spell that sets a Speed to 0 will end a Dodge through the
   * same door Grappled already does.
   *
   * A `speed` grant may not carry this requirement, and that is what keeps the
   * reading from being circular: `speedOf` asks the requirements of the grants
   * it is adding up, so a Speed grant conditioned on a Speed would be a
   * question asked of its own answer. No SRD feature writes one — all three
   * are conditioned on armour — and `invariants.test.ts` asserts that of every
   * registered feature source rather than trusting it.
   */
  | { readonly kind: 'has-speed' }
  /**
   * SRD Fast Movement, and SRD Roving in the same words: "while you aren't
   * wearing **Heavy** armor."
   *
   * Not "unarmoured": a Barbarian in a chain shirt keeps the ten feet, and
   * reading the clause as the stricter one would quietly take them away.
   */
  | { readonly kind: 'not-wearing-heavy-armor' }
  /**
   * SRD Defense: "While you're **wearing Light, Medium, or Heavy armor**, you
   * gain a +1 bonus to Armor Class."
   *
   * The third member on the armour axis and the only one with the positive
   * polarity, which is why it could not be had by negating either of the other
   * two: a Barbarian in a chain shirt satisfies `not-wearing-heavy-armor` and
   * a Wizard in a robe satisfies both, so "not unarmoured" and "wearing
   * armour" are the same sentence only by accident of there being two slots.
   *
   * **The armour slot and not the Shield.** `unarmored` below reads both
   * slots because its own sentence names both; this one names the three
   * armour categories and stops, so a Fighter holding a Shield and wearing
   * nothing gains nothing — the reading `handsFor` already takes of a Shield
   * as a thing held rather than worn.
   *
   * The three categories are the whole of what the armour slot can hold, so
   * the question is "is anything worn there" rather than a list of names: an
   * SRD suit is Light, Medium or Heavy and there is no fourth.
   */
  | { readonly kind: 'wearing-armor' }
  /**
   * SRD Unarmored Movement: "while you aren't wearing armor **or wielding a
   * Shield**."
   *
   * Both halves, because the Shield is the half a clause named for armour
   * alone loses. Read off `equipped` through the sheet's two slots, which is
   * where "owning is not wearing" already put the answer.
   */
  | { readonly kind: 'unarmored' }
  /**
   * SRD Magic Items: "requires attunement", and the benefit is had only by a
   * creature that has attuned to the item.
   *
   * Read off `attuned` on every read, exactly as `unarmored` is read off
   * `equipped`: attunement is a relation the creature holds, not a copy of the
   * benefit stored when somebody attuned. `feature` on the effect carries the
   * item's id, which is what this looks up.
   */
  | { readonly kind: 'while-attuned' }
  /**
   * SRD, in almost every magic item's first clause: "While you wear this
   * cloak", "While holding this rod".
   *
   * Separate from `while-attuned` because the SRD writes both on one item and
   * means two different things: taking the cloak off does not break the
   * attunement, and it does stop the benefit. An item that is attuned and
   * stowed keeps the effects that ask only for attunement and loses these.
   */
  | { readonly kind: 'while-worn' }
  /**
   * SRD Sunlight Sensitivity, on four stat blocks in one sentence: "**While
   * in sunlight**, the kobold has Disadvantage on ability checks and attack
   * rolls." SRD Sunlight Weakness and the vampires' Sunlight say it too.
   *
   * The holder's own space, which is what every one of those sentences says,
   * read through `lightAt` at the moment the question is asked — so the
   * Disadvantage arrives when the creature steps into the shaft of light and
   * goes when it steps out, with nothing to remember and nothing to sweep.
   *
   * **Sunlight is Bright Light with a flag** (the owner's fourth ruling), so
   * a torch is not the sun and a lantern does not blind a wight. A space
   * nobody has said anything about is not sunlit either: the requirement
   * fails on the null, which is the conservative direction and the "no
   * default ambient" ruling read through to its consequence.
   */
  | { readonly kind: 'in-sunlight' }
  /**
   * SRD Shadow Stealth: "**While in Dim Light or Darkness**, the shadow takes
   * the Hide action."
   *
   * `in-sunlight`'s sibling and read exactly as it is — `lightAt` at the
   * holder's own space, on every question — and for the same reason: the
   * shadow that steps into the lit corridor loses the Bonus Action the moment
   * it does, with nothing to remember and nothing to sweep.
   *
   * **The two halves of the clause are one requirement** rather than two
   * effects, because the sentence prints a disjunction and a requirement list
   * is a conjunction: two effects would be the shadow holding the rule twice
   * in the dark, and a requirement per level would hold it never.
   *
   * A space nobody has said anything about fails it, which is the same
   * conservative direction `in-sunlight` takes of the same null: an undeclared
   * space is not darkness, it is silence.
   */
  | { readonly kind: 'in-dim-light-or-darkness' }
  /**
   * SRD Bloodied Fury: "**While Bloodied**, the boar has Advantage on attack
   * rolls." SRD Bloodied Frenzy prints the same clause over a wider list of
   * rolls.
   *
   * **A fact about the holder, and only about the holder.** The sahuagin's
   * Blood Frenzy sounds like this and is not — "Advantage on attack rolls
   * against any creature that doesn't have all its Hit Points" is a fact about
   * the *target*, and nothing here would express it. Widening this kind to
   * reach it would make one requirement answer two different questions.
   *
   * The rules glossary settles what it means and leaves nothing to read into
   * it: "A creature is Bloodied while it has half its Hit Points or fewer
   * remaining." So this is arithmetic on the creature's own vitals, derived on
   * every read like every other requirement here — the Advantage arrives with
   * the blow that takes it past half and goes with the healing that lifts it
   * back, and no event says so.
   *
   * **Against the effective maximum**, which is what `hpMax` already is: a
   * creature whose maximum an Aid is holding up is Bloodied at half of the
   * number the rules currently say, not half of the one its class table does.
   */
  | { readonly kind: 'while-bloodied' };

/** One benefit a feature grants, with its reach already resolved to feet. */
export interface StandingEffect {
  /**
   * The feature that grants it, so a log can name the rule.
   *
   * Or the **item**: a magic item's grant is compiled with the item's id here,
   * because the item is what grants it. That is also what `while-worn` and
   * `while-attuned` look up, so the two requirements need no second key.
   */
  readonly feature: string;
  readonly name: string;
  readonly reach: StandingReach;
  readonly grant: StandingGrant;
  /** What must be true of the holder. Empty means the benefit is unconditional. */
  readonly requires?: readonly StandingRequirement[];
}

/**
 * What ends a feature that is running, besides its own deadline.
 *
 * `death` is SRD Pact of the Blade's "Your bond with the weapon ends ... if you
 * die", and it is a member here rather than a rule about every activation for
 * the reason the other two are members: the book says it of the features that
 * say it. A Rage prints no such clause, and a corpse that is Raging is a state
 * nothing in the engine reads and no sentence forbids.
 */
export type ActivationEnd = 'incapacitated' | 'heavy-armor' | 'death';

/**
 * How long a grant an activation hangs runs for.
 *
 * The two turn anchors, resolved against the holder, and the turn in progress
 * ending. Every member is a `Duration` the engine already builds — this names
 * the three a *use* of a feature can reach, which excludes the spans a casting
 * measures on the clock: nothing a Bonus Action buys is a number of seconds,
 * and a grant with no deadline at all is a durable one, which is
 * {@link StandingGrant}'s job and not this one.
 */
export type HungSpan = TurnAnchor | 'end-of-current-turn';

/**
 * A grant a *use* of a feature hangs on its holder, at the moment it is paid
 * for.
 *
 * **The stored half of {@link StandingGrant}, and the distinction is the whole
 * reason this type exists.** A standing grant is derived from the holder's own
 * state on every read, which is what keeps an aura honest and what lets a
 * feature's benefit stop the moment its condition does. What derivation cannot
 * do is be *spent*: `consumedRollModifiers` reads `CreatureState.rollModifiers`
 * — stored state — so `oneShot` written on a standing grant is a promise
 * nothing keeps, and SRD Steady Aim's "Advantage on your next attack roll"
 * could not be written at all. Derived rules for what a feature permits; stored
 * state for what is actually spent.
 *
 * **Two kinds because one SRD sentence needs both at once.** Steady Aim hangs
 * an Advantage and a Speed of 0 out of one Bonus Action, and neither is
 * expressible the other way: the Advantage has to be stored to be spent, and
 * `StandingGrant`'s `speed` member carries feet to *add* — "Speed reductions
 * are not this member's business" — so a derived zero does not exist.
 *
 * **Each grant carries its own source, and that is a rule rather than a
 * spelling.** `roll-modifier-consumed` releases everything one source granted a
 * creature, because that is `releaseGrants` and one deadline ends one source's
 * whole sentence. Two grants filed under one source would therefore end
 * together, so the roll that spent the Advantage would hand the Speed back —
 * which is not what the book says. See `hungSource`.
 */
export type HungGrant =
  | {
      readonly kind: 'roll-mode';
      readonly modifier: RollModifier;
      readonly lasts: HungSpan;
    }
  | {
      /** SRD Steady Aim: "your Speed is 0 until the end of the current turn." */
      readonly kind: 'speed';
      /**
       * Narrowed for {@link AreaStanding}'s reason: a hung grant carries no
       * mode, so it has nowhere to give a Speed in.
       */
      readonly change: Exclude<SpeedChange, 'match-walk' | 'only'>;
      /** Signed feet, for an `add`; absent for the other two — see {@link GrantedSpeed}. */
      readonly feet?: number;
      readonly lasts: HungSpan;
    };

/**
 * A feature a creature switches on, and what switching it on costs.
 *
 * What it *does* while it runs is ordinary {@link StandingEffect}s requiring
 * `feature-active`; this is only the machinery of being switchable. SRD Rage
 * needs every field of it at once, which is what makes the shape real rather
 * than a guess: a Bonus Action, a pool sized by the class table, a deadline
 * that can be pushed, a cap it cannot be pushed past, and two ways out that
 * nobody commands.
 */
/**
 * A class's own way of striking, compiled onto the sheet.
 *
 * SRD Martial Arts is the one the book prints and it needs every field at
 * once, which is what makes the shape real rather than a guess: a set of
 * weapons the class names beside its Unarmed Strike, a die rolled in place of
 * their normal damage, an ability offered in place of the attack's own, a
 * Bonus Action strike, and a gate with two halves.
 *
 * **A style always covers its holder's Unarmed Strike**, and {@link weapons}
 * widens it to the weapons the class names. That is the sentence the SRD
 * writes — "your Unarmed Strike **and** Monk weapons" — and it is why a style
 * with no weapons at all is a coherent thing to write: a class that redefines
 * only the fist.
 *
 * Resolved at creation like `activated` and `reactions` beside it, because the
 * die is a column of a class table read at *that class's* level — a Monk 5 /
 * Fighter 5 rolls a d8 and not a level 10 character's d10 — and re-deriving a
 * class table on every swing is not a thing to do on every swing.
 */
export interface StrikeStyle {
  /** The feature that grants it. */
  readonly source: string;
  readonly name: string;
  /**
   * The weapons this style covers besides the Unarmed Strike.
   *
   * SRD Martial Arts: "Simple Melee weapons" and "Martial Melee weapons that
   * have the Light property" — a list, because the book writes a list. Absent
   * covers the fist and nothing else.
   */
  readonly weapons?: readonly WeaponSelector[];
  /** The die rolled in place of the normal damage, at this character's level. */
  readonly die?: string;
  /** The ability offered in place of the attack's own. */
  readonly ability?: Ability;
  /** SRD Bonus Unarmed Strike: "You can make an Unarmed Strike as a Bonus Action." */
  readonly bonusUnarmedStrike?: boolean;
  /**
   * SRD Martial Arts: "while you are unarmed **or wielding only Monk
   * weapons**".
   *
   * The half of the gate that reads {@link weapons} from the other end: the
   * whole style is lost the moment its holder picks up something it does not
   * cover, fist included. Absent, and what is in the other hand is nobody's
   * business — which is what a homebrew style that redefines only the fist
   * would say.
   */
  readonly whileWieldingOnly?: boolean;
  /**
   * The other half, in the vocabulary the standing effects already use.
   *
   * SRD Martial Arts: "and you aren't wearing armor or wielding a Shield",
   * which is `unarmored` word for word.
   */
  readonly requires?: readonly StandingRequirement[];
}

/**
 * How long one activation runs.
 *
 * To a moment in the holder's next turn — SRD Rage's "until the end of your
 * next turn", pushed out round by round — or for a span the book prints: SRD
 * Innate Sorcery's minute, Large Form's ten. A span runs on the clock, in and
 * out of a fight alike, and is never maintained; `extendFeature` refuses it.
 *
 * Or **neither**, which is the third and was for a long time argued not to
 * exist: `feature-schema.ts` read "an activation says how long it runs" as a
 * rule, on the evidence that every feature written until now printed a span.
 * SRD Pact of the Blade prints none — "Your bond with the weapon ends if you
 * use this feature's Bonus Action again, if the weapon is more than 5 feet away
 * from you for 1 minute or more, or if you die" is three endings and no
 * deadline — so the third member says that out loud rather than inventing a
 * number the book does not print. Nothing schedules it, `extendFeature` refuses
 * it for the same reason it refuses a span (there is no deadline to push), and
 * every other route out of an activation reaches it unchanged.
 */
export type ActivationSpan =
  | TurnAnchor
  | { readonly kind: 'seconds'; readonly seconds: number }
  | { readonly kind: 'until-ended' };

export interface ActivatedFeature {
  readonly feature: string;
  readonly name: string;
  /** What turning it on costs in the action economy, outside combat nothing. */
  readonly action: 'action' | 'bonus-action' | 'none';
  /** The pool a use comes out of, or null when it costs none. */
  readonly pool: string | null;
  /**
   * When one activation runs to, unless it is extended.
   *
   * Both moments the SRD uses, and they are a full round apart: Rage "lasts
   * until the end of your next turn", Dodge "until the start of your next
   * turn". Nothing derives one from the other. Or a printed span — see
   * {@link ActivationSpan}.
   */
  readonly lasts: ActivationSpan;
  /** SRD Rage: "You can maintain a Rage for up to 10 minutes." */
  readonly capSeconds?: number;
  /** What ends it early, each read from the feature's own text. */
  readonly endsOn?: readonly ActivationEnd[];
  /** SRD Rage: "You can't maintain Concentration, and you can't cast spells." */
  readonly forbidsCasting?: boolean;
  /**
   * SRD Steady Aim: "You can use this feature only if you haven't moved during
   * this turn."
   *
   * A gate on *paying* for the use, which is why it is here and not an
   * {@link ActivationEnd}: the list above holds what stops a feature starting
   * because it is what would end it, and moving does not end a Steady Aim
   * already taken. Nor is it a {@link StandingRequirement}: those are read
   * afresh on every read of a benefit, and this is asked once, at the moment
   * the Bonus Action is spent.
   *
   * Read off `TurnBudget.movementSpent`, which stores the feet that were spent
   * rather than what is left of them — which is exactly what lets the question
   * be asked at all.
   */
  readonly onlyIfUnmoved?: boolean;
  /** What a use of it hangs on its holder — see {@link HungGrant}. */
  readonly hangs?: readonly HungGrant[];
  /**
   * What a use of it hangs on one **object** — see `ImbuedWeapon`.
   *
   * SRD Sacred Weapon's "imbue one Melee weapon that you are holding". The use
   * names the weapon, and `activateFeature` refuses one the holder is not
   * carrying or one the narrowing does not reach before anything is spent.
   * Carried across whole from the grant, because none of it is a column of any
   * class table: the ability is named by the sentence and the floor is printed
   * beside it.
   */
  readonly imbuesWeapon?: ImbuedWeapon;
  /**
   * What a use of it puts in its holder's **hand** — SRD Pact of the Blade's
   * "you can conjure a pact weapon in your hand".
   *
   * The fourth thing an activation can do, and the one that makes an object
   * rather than changing one: `imbuesWeapon` above hangs a benefit on a weapon
   * the holder already has, and this is where the weapon comes from. Which
   * weapon is the use's own answer, held to `imbuesWeapon.weapons`; the line
   * it leaves is `InventoryLine.feature`'s, and lives exactly as long as the
   * activation does. A weapon's hands are the weapon's own, so the line
   * carries none — see the `activated` grant's `conjuresWeapon`.
   */
  readonly conjuresWeapon?: true;
  /**
   * SRD Large Form: the size the holder is while it runs. Derived onto the
   * map by the fold's `settleSizes`, which reads it off whichever size-printing
   * feature is active and the creature's own size otherwise.
   */
  readonly size?: CreatureSize;
  /**
   * SRD Divine Sense: the creature types this awareness reports, and how far.
   * Read by {@link detectedBy} while the feature is running, and by nothing
   * else. See the `activated` grant's own field.
   */
  readonly detects?: {
    readonly feet: number;
    readonly creatureTypes: readonly string[];
  };
}

/**
 * A feature that makes a thing with statistics of its own — SRD Gnomish
 * Lineage's clockwork device.
 *
 * Resolved at creation for the reason `activated` and `shapeShifts` are: a
 * command reads a sheet and never a class table, and the numbers the trait
 * prints — AC 5, one hit point, three at a time, eight hours — are the only
 * place any of this is written. What is made is a creature in the roster, so
 * nothing about it is kept here.
 */
export interface ObjectMaker {
  readonly feature: string;
  readonly name: string;
  /**
   * SRD's "10 minutes", in the seconds the clock counts — and the whole of
   * what a making costs. See the `creates-object` grant on why there is no
   * action beside it.
   */
  readonly castingSeconds: number;
  /** The spell the making is a casting of, recorded on the thing's bond. */
  readonly spell: string;
  readonly size: CreatureSize;
  readonly armorClass: number;
  readonly hitPoints: number;
  /** How long one stands before it falls apart. */
  readonly lastsSeconds: number;
  /** How many may be in existence at a time. */
  readonly atOnce: number;
  /** The functions the maker chooses between, pinned on the thing as prose. */
  readonly functions: readonly string[];
  /** What activating one costs the creature that touches it. */
  readonly activation: 'action' | 'bonus-action';
}

/**
 * A feature that lays another creature's stat block over its holder's sheet —
 * SRD Wild Shape — with its table already read at this character's level.
 *
 * Resolved at creation for the reason `activated` and `strikeStyles` are: the
 * count of forms, the Challenge Rating ceiling, whether a flier may be taken,
 * the hours and the Temporary Hit Points are all a column of a class table or
 * a multiple of a class level, and a command reads a sheet and never a class.
 * What the fold needs to *end* one is on `CreatureState.shape`, not here.
 */
export interface ShapeShift {
  readonly feature: string;
  readonly name: string;
  /** What entering costs in the action economy — and leaving early, which the SRD prices the same. */
  readonly action: 'action' | 'bonus-action' | 'none';
  readonly pool: string;
  /** The creature type a form must print. */
  readonly formType: string;
  /** How many forms may be known at this level. */
  readonly known: number;
  readonly maxChallengeRating: number;
  readonly flying: boolean;
  /** How long one form lasts, in hours. */
  readonly hours: number;
  readonly temporaryHitPoints: number;
  /** The holder's own scores that survive the swap. */
  readonly keeps: readonly Ability[];
  readonly forbidsCasting?: boolean;
  /**
   * The forms this character has learned, sorted — the answer to
   * `CharacterChoices.knownForms`, and empty until the player has given one.
   * A use names one of these and nothing else.
   */
  readonly knownForms: readonly string[];
}

/**
 * A feature whose use is spent to heal its own holder.
 *
 * Second Wind and Wholeness of Body. Both are a pool that already existed,
 * sized off the class table and refilling on the right rest, with nothing on
 * the other end of it: Second Wind's own note said *"healCreature exists and
 * nothing ties the two together."*
 *
 * The die is resolved at creation because one of the two reads it off a class
 * table — "roll your Martial Arts die" is 1d6 at Monk 1 and 1d10 at Monk 11 —
 * and the addend is kept symbolic because one of the two is an ability
 * modifier, which is a number on the sheet at the moment it is wanted.
 */
/**
 * Hit points a feature gives its holder: a die, something added to it, and
 * sometimes a floor.
 *
 * Its own type because three features write the same sum and only two of them
 * spend a pool use for it — Uncanny Metabolism's arrives riding on a recovery
 * instead. Resolved at creation, because two of the three read their die off a
 * class table.
 */
export interface HealAmount {
  /** Resolved: "1d10", or the Martial Arts die at that Monk's level. */
  readonly dice: string;
  readonly plus:
    | { readonly kind: 'level'; readonly level: number; readonly label: string }
    | { readonly kind: 'ability'; readonly ability: Ability; readonly label: string };
  /** SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". */
  readonly minimum?: number;
}

/**
 * A pool of hit points a feature spends by touching somebody.
 *
 * SRD Lay On Hands and the Restoring Touch that lengthens its list. Not
 * `SelfHealFeature`: that spends a *use* on its holder and rolls for the
 * amount, where this spends the amount itself, on anybody within reach, and
 * rolls nothing. "Those points don't also restore Hit Points to the creature"
 * is why the cost and the healing are two numbers rather than one.
 */
export interface HealingTouch {
  readonly feature: string;
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
  readonly pool: string;
  /** Sorted and deduplicated across every feature that contributes to it. */
  readonly lifts: readonly ConditionName[];
  readonly costPerCondition: number;
}

export interface SelfHealFeature extends HealAmount {
  readonly feature: string;
  readonly name: string;
  /** What using it costs in the action economy; outside combat, nothing. */
  readonly action: 'action' | 'bonus-action';
  /** The pool a use comes out of. */
  readonly pool: string;
  /**
   * Feet a use of this hands the turn, where a feature the holder has says so.
   *
   * SRD Tactical Shift, compiled here rather than read at the use for the
   * reason every other menu is: the command reads a sheet and never a class
   * table, so the number on the event is pinned rather than looked up.
   *
   * **Absent for a holder who has not got the feature that hands it over**,
   * which is what makes a level 1 Fighter's Second Wind the Second Wind it
   * always was: creation compiles it only where the named feature is one the
   * character really earned.
   */
  readonly handsMove?: {
    /** The feature whose sentence hands it over; also the grant's source. */
    readonly feature: string;
    readonly share: 'half-speed';
  };
}

/**
 * One thing a use of a feature's pool buys, compiled onto the sheet.
 *
 * `PoolOptionGrant` with the class table read out of it — the dice resolved at
 * the holder's own class level the way a self-heal's are, and the spellcasting
 * ability the class's block names, so the command reads the sheet and never a
 * class table. SRD Channel Divinity's menu is the shape: one pool, several
 * named purchases, one use apiece.
 */
export interface PoolOption {
  /** The feature the pool belongs to — `usePoolOption` is asked for both. */
  readonly feature: string;
  /** What the feature is called: SRD's "Channel Divinity". */
  readonly featureName: string;
  readonly option: string;
  /** What this option is called: SRD's "Turn Undead". */
  readonly name: string;
  /**
   * What spending it costs in the economy.
   *
   * `one-attack` is SRD Breath Weapon's, and is one swing of an Attack action
   * already taken rather than an action of its own — see
   * `PoolOptionGrant.action`.
   */
  readonly action: 'action' | 'bonus-action' | 'one-attack';
  readonly pool: string;
  /** The effects, with any class-table dice already resolved. */
  readonly effects: readonly SpellEffect[];
  /**
   * The spellcasting ability the DC and any modifier are read from.
   *
   * SRD Channel Divinity: "If a Channel Divinity effect requires a saving
   * throw, the DC equals the spell save DC from this class's Spellcasting
   * feature" — a derivation of the holder's sheet rather than a number the
   * feature prints, which is the whole difference between a feature's DC and
   * an item's. The **granting class's**
   * ability, resolved at creation, because a multiclassed holder has more than
   * one and the feature belongs to exactly one of them.
   *
   * Null where the granting class casts nothing at all, which is the one case
   * the SRD never prints: the DC then falls to `8 + Proficiency Bonus`, the
   * rule `numbersForItem` already writes for a wielder with no ability of
   * their own.
   */
  readonly ability: Ability | null;
  readonly area?: SpellArea;
  /**
   * The shapes the option offers, where the holder chooses one at the use —
   * SRD Breath Weapon's "15-foot Cone or a 30-foot Line ... (choose the shape
   * each time)".
   *
   * Beside {@link area} and never with it, and each entry a different `kind`,
   * because the kind is what the caller names the shape by.
   */
  readonly areas?: readonly SpellArea[];
  readonly reach?: number;
  readonly mustBeType?: string;
  readonly durationSeconds?: number;
  readonly endsEarly?: readonly EffectEndCause[];
  readonly damageTypeStated?: readonly string[];
  /**
   * The hit points one use mints and divides — SRD Preserve Life.
   *
   * `HitPointDivision` with the class table read out of it, exactly as the
   * dice above are: "five times your Cleric level" is fifteen at Cleric 3, and
   * the command sees a number rather than a multiplier and a level to find.
   */
  readonly distributes?: HitPointBudget;
  /** What a later feature burns the failures with — see {@link FailedSaveDamage}. */
  readonly damagesFailures?: FailedSaveDamage;
}

/**
 * Damage a **later** feature deals to whoever failed an option's saving throw,
 * resolved at creation — SRD Sear Undead's Radiant on Turn Undead.
 *
 * **One roll for the whole use, dealt to each of them.** The SRD sentence is
 * "roll a number of d8s equal to your Wisdom modifier … and add the rolls
 * together. Each Undead that fails its saving throw … takes Radiant damage
 * equal to **the roll's total**", and that is why it is a field on the option
 * rather than a `save-damage` effect: an effect is resolved once per target and
 * would roll a fresh total for each of them. What the option's own effect
 * settles is *who failed*; this is what one roll then does to all of them.
 *
 * The count is read at creation off the amending feature's sizing, so what the
 * command holds is a notation and a type, exactly as `distributes` above holds
 * a number rather than a multiplier.
 */
export interface FailedSaveDamage {
  /** The dice, counted — SRD Sear Undead's `3d8` for a Wisdom modifier of 3. */
  readonly dice: string;
  readonly damageType: string;
}

/**
 * A budget of hit points a use of a pool option mints, resolved at creation.
 *
 * The cap and the excluded types come across as they were written, because
 * neither reads a class table: what the cap is measured against is the
 * *target's* maximum at the moment of use, and a creature type is a fact about
 * whoever is on the other end.
 */
export interface HitPointBudget {
  readonly hitPoints: number;
  readonly cap: 'half-maximum';
  readonly excludesTypes?: readonly string[];
}

/**
 * A number an option counts off the caster rather than printing.
 *
 * SRD writes two of the Metamagic options with the same phrase — "up to your
 * Charisma modifier (minimum of one)" — and Charisma is the Sorcerer's
 * spellcasting ability, which is the only end of that sentence a feature may
 * say out loud: an option naming an ability would be content deciding which
 * ability a *different* class's version of the same option counted off.
 * `DieRule`'s cap is the same derivation on the same word, and this is it on a
 * head count.
 *
 * The number is read off what the casting pinned, so a Headband of Intellect
 * moves it exactly as it moves the save DC — and a modifier of zero or less
 * still buys {@link minimum}, because the book puts a floor under it rather
 * than making the option do nothing.
 */
export type CastingOptionCount =
  /**
   * SRD Careful Spell and SRD Empowered Spell: "up to your Charisma modifier
   * (minimum of one)".
   */
  | {
      readonly of: 'spellcasting-modifier';
      /** SRD's "(minimum of one)". Absent means the derivation stands alone. */
      readonly minimum?: number;
    }
  /**
   * SRD Heightened Spell: "give **one** target of the spell Disadvantage".
   *
   * A number the book printed, which is not a derivation wearing a floor: a
   * count of one written as "the modifier, but at least one" would grow with
   * the caster's Charisma, which is precisely what that sentence does not do.
   */
  | { readonly of: 'printed'; readonly count: number };

/**
 * What one purchased option does to the casting that bought it.
 *
 * **Four arms rewrite a number the casting command works out before it spends
 * anything**: how far the spell reaches, how long it runs, which part of the
 * turn it takes, and what level it counts as. Each of those rewrites a value
 * the cost-and-route half of a casting already holds in its hand, brings no
 * machinery of its own and reaches no effect that has begun to resolve.
 *
 * **Six more reach past that half into the resolution**, and they are here
 * rather than in a union of their own for the reason the first four are one
 * field rather than four grants: they are asked for at one moment, by one
 * reader, off one menu, under one price and one `perCasting` limit. A second
 * union would have been a second election, a second refusal path and a second
 * place for the price to be paid. What they have in common with the four is
 * the whole of what this type is: **a thing a casting buys**. Where they
 * differ is stated on each arm — the six are settled at the cast and *carried*
 * to the seam that reads them, so `alteredCasting` refuses them for a spell
 * that offers them nothing and then hands them on rather than applying them.
 *
 * The shape {@link CastingDamageAlteration} above already wears, asked of a
 * different half of the same command: that one alters what a casting *deals*
 * for a feature that is free, this one alters what a casting *does* for an
 * option that is bought. Its own declaration says why arms of one field beat
 * one grant each — "All four are asked for at one moment, by one reader" — and
 * the argument carries over word for word.
 *
 * **Narrowings live on the arm rather than in an eleventh `when` record**,
 * which is where this parts company with `CastingDamageWhen`: each option's
 * precondition is a fact about the very thing it rewrites — a range that is a
 * distance at all, a duration of at least a minute, a save the spell forces, a
 * damage die it throws — so a shared `when` would be ten fields of which nine
 * are always absent.
 *
 * SRD publishes **ten** Metamagic options and these ten arms are them.
 */
export type CastingCostAlteration =
  /**
   * SRD Distant Spell: "you can spend 1 Sorcery Point to double the spell's
   * range. Or when you cast a spell that has a range of Touch ... make the
   * spell's range 30 feet."
   *
   * Two sentences and one arm, because both of them answer "how far does this
   * casting reach" and the second is the first's exception. A Range: Self
   * spell has no distance to multiply and is refused — SRD's "a range of at
   * least 5 feet" is that refusal — and doubling the five feet `ranged`
   * reports for a Touch is why {@link touchBecomesFeet} is printed rather than
   * inferred.
   */
  | {
      readonly kind: 'range';
      /** What the printed distance is multiplied by. */
      readonly multiplier: number;
      /**
       * What a Touch range becomes outright, in feet.
       *
       * Absent means a Touch spell is refused rather than multiplied, because
       * `ranged` reports a Touch as five feet and doubling that is arithmetic
       * nobody printed.
       */
      readonly touchBecomesFeet?: number;
    }
  /**
   * SRD Extended Spell: "you can spend 1 Sorcery Point to double its duration
   * to a maximum duration of 24 hours."
   *
   * The **casting's** own span, which is what everything it hangs is ended by:
   * the deadline filed against the casting id is what `spell-ended` releases,
   * so doubling it doubles the Charm as well as the Charm Person. A rider with
   * a span of its own — SRD Sunburst's minute of Blindness on an Instantaneous
   * spell — is not the spell's Duration and is left alone.
   */
  | {
      readonly kind: 'duration';
      readonly multiplier: number;
      /** SRD's "to a maximum duration of 24 hours", in seconds. */
      readonly maximumSeconds?: number;
      /** SRD's "a duration of 1 minute or longer", in seconds. */
      readonly minimumSeconds?: number;
    }
  /**
   * SRD Quickened Spell: "When you cast a spell that has a casting time of an
   * action ... change the casting time to a Bonus Action for this casting."
   *
   * {@link from} is the narrowing and is required: an option that rewrote
   * *any* casting time would turn a Reaction spell into a Bonus Action one,
   * which no sentence in the book does.
   */
  | {
      readonly kind: 'casting-time';
      readonly from: CastingTime;
      readonly to: CastingTime;
    }
  /**
   * SRD Twinned Spell, whose 2024 text is one number: "you can spend 1 Sorcery
   * Point to **increase the spell's effective level by 1**."
   *
   * The level the casting counts as, which is not the level of the slot that
   * paid for it — the slot is untouched and the casting is pinned at the
   * higher level, so the extra target, the extra die and the longer duration
   * band all follow from arithmetic the engine already does.
   */
  | {
      readonly kind: 'effective-level';
      /** Whole levels, and the casting still cannot pass level 9. */
      readonly by: number;
      /**
       * SRD: "a spell, such as _Charm Person_, that **can be cast with a
       * higher-level spell slot to target an additional creature**."
       *
       * Read off `TargetRule.extraPerSlotLevelAbove`, which is that sentence
       * already transcribed on every definition that prints it. A narrowing
       * and not a rule: absent, the option reaches any casting, which is what
       * a homebrew feature that simply upcast would want.
       */
      readonly onlyIfTargetsScale?: true;
    }
  /**
   * SRD Careful Spell: "choose a number of those creatures up to your Charisma
   * modifier (minimum of one creature). A chosen creature **automatically
   * succeeds** on its saving throw against the spell, and it takes no damage
   * if it would normally take half damage on a successful save."
   *
   * **The designation the request already carries, priced.**
   * `CastSpellRequest.unaffected` is SRD Spirit Guardians' "you can designate
   * creatures to be unaffected by it", and the two sentences ask for the same
   * thing from opposite ends: one spell offers it and this option buys it for
   * a spell that does not. So the option unlocks that field on a spell whose
   * definition prints no such clause, caps how many may be named, and the
   * creatures come out of the casting's catch before a save is rolled or a die
   * is thrown.
   *
   * **A creature left out of the catch is an automatic success exactly where
   * the SRD says what a success buys**, which is the pair of sentences above:
   * no save, and no damage where a success would have halved it. Where a
   * spell's success branch does something *other* than halve — SRD Hypnotic
   * Pattern's success is simply nothing, SRD Hold Person's likewise — leaving
   * the creature out gives them what succeeding would have given them anyway.
   * The one reading this loses is a spell whose *success* is itself a
   * consequence, and the SRD prints none: a save that a creature has to make
   * and pass to be affected is not a sentence in the book.
   *
   * Refused for a spell that forces no save at all, which is the SRD's own
   * "a spell that forces other creatures to make a saving throw".
   */
  | {
      readonly kind: 'spare-from-saves';
      /** How many creatures may be spared. */
      readonly upTo: CastingOptionCount;
    }
  /**
   * SRD Heightened Spell: "you can spend 2 Sorcery Points to give one target of
   * the spell Disadvantage on saves against the spell."
   *
   * **A mode on a named creature's saves, for this casting and no other.** The
   * caster names which creature on the request and the option says which mode
   * and how many — so the engine validates a choice rather than making one,
   * and a caller who names a mode no option of theirs offers is refused rather
   * than quietly obeyed.
   *
   * The plural in "saves against the spell" is the casting's whole life: the
   * mode is carried on the casting rather than on the roll, so a repeat save
   * the same casting forces at a later turn boundary takes it too.
   */
  | {
      readonly kind: 'save-mode';
      /** What the named creature's saves against this casting are rolled at. */
      readonly mode: RollMode;
      /** How many of the casting's targets may be named. */
      readonly upTo: CastingOptionCount;
    }
  /**
   * SRD Empowered Spell: "When you roll damage for a spell, you can spend 1
   * Sorcery Point to reroll a number of the damage dice up to your Charisma
   * modifier (minimum of one), and you must use the new rolls."
   *
   * **The lowest dice, and the reroll is compulsory once bought.** The book
   * lets the player pick which dice; picking the lowest is the only choice a
   * player who wants more damage makes, so a stated *count* is the whole of
   * the choice and the engine takes it from the bottom. That is a ruling and
   * it is written here rather than buried: the alternative is a request field
   * carrying die indices, which is a caller reaching into a roll the engine
   * made.
   *
   * "When you roll damage" is one roll, so the count is taken by the first
   * damage roll the casting makes and is zero for every roll after —
   * `takeCastingAddend`'s rule on a different quantity, and for the same
   * reason: a Fireball catching six goblins rolls six times in this engine.
   */
  | {
      readonly kind: 'reroll-damage-dice';
      /** How many dice go back in the cup. */
      readonly upTo: CastingOptionCount;
    }
  /**
   * SRD Seeking Spell: "If you make an attack roll for a spell and miss, you
   * can spend 1 Sorcery Point to reroll the d20, and you must use the new
   * roll."
   *
   * **Elected at the cast and paid for at the miss.** Every other option's
   * price goes inside the casting's own batch before the first die; this one's
   * condition is a die that has already been thrown, so the pool is checked
   * where the others are checked — a casting whose caster cannot afford the
   * reroll is refused before anything is rolled — and the `resource-spent`
   * lands in the same batch at the moment the reroll happens. A casting whose
   * attack hits pays nothing, which is the sentence.
   *
   * The whole attack is thrown again rather than the bare d20, because a spell
   * attack's modes, bonuses and Armour Class are the same on the second throw
   * and the only thing that can differ is the face. Both throws reach the log,
   * and the second names the first it superseded.
   */
  | { readonly kind: 'reroll-a-missed-attack' }
  /**
   * SRD Subtle Spell: "you can spend 1 Sorcery Point to cast it without any
   * Verbal, Somatic, or Material components, except Material components that
   * are consumed by the spell or that have a cost specified in the spell."
   *
   * **The components are not modelled and the consequence is.** A
   * `SpellDefinition` carries no components at all, so there is nothing here
   * to take away; what the point buys is the rule the SRD attaches to a spell
   * cast without perceivable components — nobody can tell it is being cast, so
   * there is nothing for a Counterspell to answer. The casting is marked on
   * its own pending record and the `casting-a-spell` window does not open for
   * anybody else.
   *
   * What is therefore **not** bought is the half a caller might expect: a
   * Silenced caster still cannot cast, and a bound caster still cannot make
   * the gestures, because neither of those is a rule this engine holds. The
   * option says what it does and no more.
   */
  | { readonly kind: 'unperceived' }
  /**
   * SRD Transmuted Spell: "When you cast a spell that deals a type of damage
   * from the following list, you can spend 1 Sorcery Point to change that
   * damage type to one of the other listed types: Acid, Cold, Fire, Lightning,
   * Poison, Thunder."
   *
   * **The caster restates the type, through the door a casting already has.**
   * `CastSpellRequest.damageType` is SRD Chromatic Orb's printed list answered
   * by its caster, and `statedDamageType` is the substitution; what this option
   * buys is that door for a spell whose definition prints one fixed type. The
   * list is the option's — the engine names no damage type — and both halves
   * of the SRD sentence are checked against it: the type the spell prints has
   * to be on it, and so does the one the caster names.
   */
  | {
      readonly kind: 'restate-damage-type';
      /** The types this option moves between. SRD prints six. */
      readonly among: readonly string[];
    };

/**
 * One thing a casting may buy, compiled onto the sheet.
 *
 * `CastingOptionGrant` with the player's own answer read out of it: SRD gives
 * a Sorcerer "two Metamagic options of your choice" from a menu of ten, and
 * what reaches the sheet is the two. The casting command therefore reads a
 * sheet and never a class table, which is the rule every other compiled
 * feature here keeps.
 *
 * `perCasting` is carried on each entry rather than looked up on the feature,
 * for `PoolOption.pool`'s reason one line up: the reader has an elected option
 * in its hand and the grant it came from is a catalogue lookup away.
 */
export interface CastingOption {
  /** The feature the menu belongs to — SRD's "Metamagic". */
  readonly feature: string;
  readonly featureName: string;
  /** The option's own id, which is what a casting elects it by. */
  readonly option: string;
  /** What this option is called: SRD's "Distant Spell". */
  readonly name: string;
  /** The pool the price comes out of. */
  readonly pool: string;
  readonly cost: number;
  /** How many of this feature's options may ride on one casting. */
  readonly perCasting: number;
  readonly alters: CastingCostAlteration;
}

/**
 * One thing a hit buys, compiled onto the sheet.
 *
 * {@link PoolOption}'s twin one trigger along, and the fields it does not have
 * are the ones an action owns: no action to spend, no reach and no area,
 * because the creature a rider reaches is the one the attack just hit. What it
 * has instead is the qualification — SRD Stunning Strike's "with a Monk weapon
 * or an Unarmed Strike" — read at the swing rather than at creation, because
 * which weapon is in hand is not a fact about the character.
 *
 * The pool is nullable here and it is not on a pool option: SRD charges
 * Stunning Strike a Focus Point out of a *different feature's* pool and
 * charges Open Hand Technique nothing at all.
 */
export interface HitOption {
  /** The feature the rider belongs to — the swing names it and the option. */
  readonly feature: string;
  /** What the feature is called: SRD's "Stunning Strike". */
  readonly featureName: string;
  readonly option: string;
  /** What this option is called, for the log. */
  readonly name: string;
  /** The pool a use comes out of, or null where the book charges nothing. */
  readonly pool: string | null;
  /** What one rider costs out of that pool. */
  readonly costs: number;
  /**
   * A **sibling feature's extra damage dice**, spent instead of a pool — SRD
   * Cunning Strike's "the number of Sneak Attack damage dice you must forgo".
   *
   * The `on-hit` grant's `forgoesDiceOf`, compiled: the id of the feature
   * whose `attack-damage` grant pays. Never beside {@link pool}, which the
   * authoring door holds, because a rider is bought with one currency.
   *
   * **Settled in two places, for the reason the pool already is.** What a
   * *sheet* can answer is answered at the swing — this creature holds no such
   * grant, or fewer dice than {@link costsDice} — so a refusal arrives before
   * the die. What only the roll can answer is answered where the dice are
   * gathered: SRD Sneak Attack qualifies on "Advantage on the roll", and a
   * blow that turned out not to be one pays for nothing. That rider is
   * dropped unspent and reported, which is what a pool emptied inside a hold
   * already gets.
   */
  readonly forgoesDiceOf?: string;
  /** SRD's "(Cost: 1d6)" — how many of those dice one use of this forgoes. */
  readonly costsDice?: number;
  /**
   * A thing the holder must be **carrying** — SRD Cunning Strike's Poison:
   * "you must have a Poisoner's Kit on your person."
   *
   * A catalogue id, read off the inventory at the swing. Beside the pool and
   * the dice because it is the third thing a rider's sentence may demand
   * before it happens, and like both of them it is asked where a refusal costs
   * nothing.
   */
  readonly requiresItem?: string;
  /**
   * Feet this rider hands the turn — SRD Cunning Strike's Withdraw:
   * "Immediately after the attack, you move up to half your Speed without
   * provoking Opportunity Attacks."
   *
   * `HitOptionGrant.handsMove` compiled, paid as the `movement-granted` SRD
   * Tactical Shift already writes. The provoking half is not carried, because
   * it is not this sentence's to say: `spendMovement` charges a granted move
   * out of the grant alone and `moveCreature` offers nobody a swing for it, so
   * every foot a feature hands over already provokes nothing.
   */
  readonly handsMove?: { readonly share: 'half-speed' };
  /** SRD: "Once per turn when you hit a creature". */
  readonly oncePerTurn?: boolean;
  readonly weapons?: readonly WeaponSelector[];
  readonly unarmedStrike?: boolean;
  /**
   * The purchase the swing has to have been bought by — SRD Open Hand
   * Technique's "an attack granted by your Flurry of Blows".
   *
   * The `on-hit` grant's `fromGrant`, compiled: `budgetPurchaseSlot`'s
   * `<feature>/<purchase>` key, matched against what `GrantedAttacks.from`
   * recorded when the purchase was made. Asked at the **swing**, where every
   * other qualification is, so a rider bought by nothing is refused before the
   * die.
   */
  readonly fromGrant?: string;
  readonly effects: readonly SpellEffect[];
  /**
   * The ability the DC is read from — {@link PoolOption.ability} exactly, with
   * one more way of being answered.
   *
   * The feature's own where it prints one (SRD Monk's Focus: "8 plus your
   * Wisdom modifier and Proficiency Bonus"), the granting class's spellcasting
   * ability where it does not, and null where neither exists — which falls to
   * `8 + Proficiency Bonus`, the rule an item already falls back to.
   */
  readonly ability: Ability | null;
  /**
   * The DC a **printed** line states, in place of the one {@link ability}
   * derives.
   *
   * `CastsSpellGrant.saveDc` exactly, on the other host that has a number of
   * its own: an item prints its DC and is the same in an archmage's hand, and
   * so does a stat block. Derivation is the right answer for a class feature —
   * SRD Stunning Strike is "your spell save DC" — and the wrong one for a
   * number the book states, and the two are not distinguishable after the
   * fact: `8 + Proficiency Bonus` happens to equal the Ghoul's printed 10 and
   * does not equal the Death Dog's 12.
   *
   * It is one field for the one number the line prints, whichever sentence
   * asks for it: the save an effect forces and — where the rider is a grapple
   * — nothing, because SRD prints the escape DC inside that clause instead.
   * See {@link grapples}.
   */
  readonly saveDc?: number;
  readonly lasts?: TurnAnchor;
  /**
   * Whose next turn {@link lasts} is anchored on.
   *
   * Omitted, the **holder's**, which is what every feature that buys a rider
   * writes: SRD Stunning Strike's "until the start of your next turn". A
   * printed stat-block line writes the other one as readily — the Giant
   * Vulture's "until the end of **its** next turn" — and the two are a round
   * apart in the order. Filing one on the other is a wrong rule rather than a
   * refusal, which is what a named anchor exists to make impossible.
   */
  readonly lastsOn?: HitRiderAnchor;
  readonly durationSeconds?: number;
  readonly endsEarly?: readonly EffectEndCause[];
  /**
   * A **grapple** the blow makes, with the escape DC the line prints.
   *
   * Beside {@link effects} rather than inside it, because a grapple is not a
   * condition in this engine: it is a relation, found by the `grapple:<who>`
   * source its instance is filed under and ended on facts about the grappler.
   * An effect list files what it hangs under the source of whatever ran it, so
   * a Grappled that rode on one would be a grapple `grapplesOn` could not see,
   * `lapsedGrapples` could not end and `escapeGrapple` could not be attempted
   * against — strictly worse than the prose it replaced. This says *grapple*,
   * and the grapple is made exactly as the Attack action's own is.
   */
  readonly grapples?: HitGrapple;
  /**
   * An **attach** the blow makes — SRD Stirge: "the stirge attaches to the
   * target"; SRD Darkmantle: "the darkmantle attaches to the target."
   *
   * Beside {@link grapples} rather than inside it, because the two hold
   * opposite ends: a grapple gives the *target* the Grappled condition and is
   * read back off that instance, and an attach fixes the *attacker* to a
   * target who may walk off with it on them. `CreatureState.attachments` is
   * where it lands, and `attachmentsOf` is what finds it.
   */
  readonly attaches?: HitAttach;
  /**
   * A shove the blow itself delivers — SRD Satyr: "the satyr pushes the target
   * up to 10 feet straight away from itself"; SRD Merrow pulls fifteen.
   *
   * Beside {@link effects} for {@link grapples}' reason and a stronger form of
   * it: forced movement is arithmetic **between two creatures** on a lattice,
   * and an effect list is a thing hung on one of them. `shoveAwayFrom` and
   * `pullToward` are the two performers, and both need the attacker as an
   * origin — which an effect, resolved against a target, has no way to name.
   *
   * **A shove that cannot happen is reported, not refused.** The blow has
   * already landed by the time this runs, so a target nobody has placed, a
   * scene nobody has described and a wall are one answer: the hit stands, and
   * what could not happen is said out loud on `unverified`.
   */
  readonly forcedMove?: HitForcedMove;
  /**
   * SRD Specter: "its Hit Point maximum decreases by an amount equal to the
   * damage taken."
   *
   * A flag rather than a number, because the number is the blow's: read off
   * the damage **after the target's own defences**, at the moment it settles,
   * which is what "the damage taken" says. A Resistance that halved the blow
   * halves this too, and a blow that dealt nothing lowers nothing.
   */
  readonly lowersHitPointMaximum?: 'damage-taken';
  /**
   * A **hazard** the blow leaves the target standing in — SRD Fire Elemental's
   * Burn: "If the target is a creature or a flammable object, it starts
   * burning."
   *
   * Beside {@link effects} for {@link grapples}' reason, one step further: a
   * hazard is not a condition — the glossary prints the fifteen under one
   * heading and files this under another, so no condition immunity reaches it
   * — and an effect list can only hang what a condition, a bonus or a grant
   * can hold. It carries no span either, and that absence is the sentence: a
   * fire runs until somebody rolls on the ground, so `lasts` would have had to
   * be invented and `durationSeconds` would have put out a fire the book never
   * ends.
   *
   * The die it costs is not here for the same reason it is not on the printed
   * rider: the 1d4 is the glossary's, one rule behind three stat blocks, and a
   * copy per hit is a copy that can disagree.
   */
  readonly hazard?: HazardName;
  /**
   * Points of Armour Class the blow eats out of the armour the target is
   * **wearing** — SRD Black Pudding's Dissolving Pseudopod: "Nonmagical armor
   * worn by the target takes a −1 penalty to the AC it offers."
   *
   * Beside {@link effects} for {@link lowersHitPointMaximum}'s reason: what it
   * changes is not a creature but a *thing the creature is wearing*, and an
   * effect list hangs what it hangs on a creature. `EquippedItem.penalty` is
   * where it lands, so two suits of mail in one party wear down separately.
   *
   * The destruction is not a second field: "The armor is destroyed if the
   * penalty reduces its AC to 10" is arithmetic over the armour's own record
   * and the points already here, and `applyHitRider` does it.
   */
  readonly penalisesArmor?: number;
  /**
   * An ability score the blow **drains** — SRD Shadow's Draining Swipe: "the
   * target's Strength score decreases by 1d4. The target dies if this reduces
   * that score to 0."
   *
   * Beside {@link effects} for {@link penalisesArmor}'s reason: what it changes
   * is not a condition or a grant on the creature but a number the sheet is
   * read through, and it is thrown at the settlement rather than at the swing
   * because the die is the block's. The death is not a second field: it is
   * arithmetic over the score as it then stands, and `applyHitRider` does it.
   */
  readonly lowersAbility?: HitAbilityDrain;
  /**
   * What the blow leaves behind **only if it was the blow that emptied them**
   * — SRD Phase Spider: "If this damage reduces the target to 0 Hit Points,
   * the target becomes Stable, and it has the Poisoned condition for 1 hour."
   *
   * Beside {@link effects} rather than inside it, for the reason
   * {@link lowersHitPointMaximum} is: it reads a fact about the blow rather
   * than about a creature, and an effect list is resolved against a target
   * with no knowledge of what put it where it is. The fact here is narrower
   * still — not the amount, but whether this damage took the last hit point —
   * and "reduces to 0" is not "is at 0": a creature already on the floor takes
   * a Death Saving Throw failure instead, which is the rule the damage path
   * already writes.
   */
  readonly onDroppingToZero?: HitDropToZero;
  /**
   * Dice the rider adds to **the blow itself** — SRD Fire's Burn: "When you hit
   * a target with an attack roll and deal damage to it, you can also deal 1d10
   * Fire damage to that target."
   *
   * Beside {@link effects} rather than inside it, and the reason is the one
   * `rider_deals_damage` has been stating at the authoring door since riders
   * landed: the effect list runs **after** the damage has been rolled, landed
   * and possibly held open for a Reaction, and an attack holds one damage roll
   * at a time — a `damage-rolled` thrown there would be a log the fold
   * refuses. So this is not a second roll at all. It is a *component of the
   * blow*, gathered where a smite's dice and a Cantrip Upgrade's are, before
   * the one damage roll the swing makes: a Critical Hit doubles it, the
   * target's Resistance to its type meets it separately, and one
   * `damage-rolled` carries the whole.
   *
   * What still runs in the list is everything a rider always ran — Frost's
   * Chill takes ten feet of Speed off in the same breath as its 1d6 — and
   * damage *in the list* is refused exactly as it was.
   */
  readonly extraDamage?: HitRiderDamage;
  /**
   * SRD Hill's Tumble: "When you hit a **Large or smaller** creature with an
   * attack roll and deal damage to it, you can give that target the Prone
   * condition."
   *
   * The same gate a printed line's `ifNoLargerThan` states, read through
   * `effectiveSizeOf` — and asked at the **swing**, where every other
   * qualification on an asked-for rider is, so a Goliath who names the boon
   * against a Huge creature is refused with nothing spent. A printed rider's
   * is answered after the blow instead, because nobody asked for it and the
   * blow has already landed by the time the line is read.
   */
  readonly targetNoLargerThan?: CreatureSize;
}

/**
 * The score a blow drains and the die it throws for it — SRD Shadow's "the
 * target's Strength score decreases by 1d4". Two fields because the sentence
 * prints exactly two things.
 */
export interface HitAbilityDrain {
  readonly ability: Ability;
  /** SRD's "1d4". */
  readonly dice: string;
}

/**
 * The dice a rider adds to the blow it rides on.
 *
 * Two fields, because the two SRD sentences of this shape print exactly two
 * things — "1d10 Fire damage", "1d6 Cold damage". No flat amount: nothing in
 * the book adds a bare number this way, and a field nothing writes is the
 * speculative member the sweeps exist to refuse.
 */
export interface HitRiderDamage {
  /** SRD's "1d10". */
  readonly dice: string;
  /** SRD's "Fire". */
  readonly damageType: string;
}

/**
 * What a hit that empties its target leaves on the floor.
 *
 * `PrintedDroppedToZeroRider` compiled onto a swing, and the three clauses are
 * independent because the book prints them apart: SRD Phase Spider and SRD
 * Vampire Familiar write the Stable with a poison, SRD Gibbering Mouther
 * writes the death alone.
 */
export interface HitDropToZero {
  /** SRD's "the target becomes Stable". */
  readonly stable?: true;
  /** SRD Gibbering Mouther's "The target dies". */
  readonly dies?: true;
  /** SRD's "it has the Poisoned condition for 1 hour", in printed order. */
  readonly conditions?: readonly HitDropCondition[];
}

/** One condition such a hit leaves, and how long the line says it runs. */
export interface HitDropCondition {
  readonly condition: ConditionName;
  /**
   * SRD Phase Spider: "While Poisoned, the target also has the Paralyzed
   * condition" — carried by the instance, so it lifts with it, exactly as
   * {@link HitGrapple.whileHeld} is carried by the hold.
   */
  readonly implies?: readonly ConditionName[];
  /** SRD's "for 1 hour", in the seconds the clock counts. */
  readonly durationSeconds: number;
}

/**
 * Which of the two creatures in a hit a turn-anchored span hangs on.
 *
 * A hit's world has two creatures in it and no more, which is why this is a
 * pair rather than a `CharacterId`: a `HitOption` is written once — compiled
 * off a sheet or minted off a printed line — and bound to whoever is standing
 * there when the blow lands. {@link CounterpartRole} makes the same argument
 * for the same reason on the spell side.
 */
export type HitRiderAnchor = 'attacker' | 'target';

/** Which way a hit shoves, and how far. */
export interface HitForcedMove {
  readonly direction: 'push' | 'pull';
  /**
   * The saving throw the shove itself forces, where the sentence prints one.
   *
   * SRD Open Hand Technique's Push: "The target must succeed on a **Strength
   * saving throw** or be pushed up to 15 feet away from you." A printed stat
   * line has no such branch — a satyr simply pushes — so this is absent for
   * every one of them, and a shove with no save is the shove those already
   * deliver.
   *
   * **The save is the shove's own rather than an effect beside it**, and that
   * is the same argument the shove itself makes: forced movement is arithmetic
   * between two creatures, and a `save` effect resolved against one of them
   * would have nothing to impose on the failure — which the authoring door
   * refuses outright (`save_imposes_nothing`, "a die thrown for nothing").
   */
  readonly save?: Ability;
  /**
   * SRD's "up to 10 feet", read as the whole distance.
   *
   * The book leaves the amount to the creature doing the shoving and there is
   * no creature to ask; the printed number is the only one on the page, and a
   * shorter one would be invented. A pull stops at the puller's face whatever
   * this says, which is the one place the "up to" does any work.
   */
  readonly feet: number;
}

/** The grapple a hit makes, as the line that prints one states it. */
export interface HitGrapple {
  /**
   * SRD's "(escape DC 13)", pinned on the timer the grapple files.
   *
   * The grapple's DC and the escape's are one number in the book, and an
   * escape attempted an hour later is against the number the grapple was made
   * at — the rule `grappleTarget` already writes for the Unarmed Strike's own.
   */
  readonly escapeDc: number;
  /**
   * What the line says the creature holds on **with**, where it says.
   *
   * SRD Giant Scorpion: "from one of two claws"; the Griffon: "from both of
   * the griffon's front claws". It is a count of how many creatures the block
   * can hold at once and the engine counts no limbs, so it is carried to be
   * *reported* rather than enforced — the reading `grappleTarget` already
   * takes of the free hand SRD asks it for.
   */
  readonly withLimbs?: string;
  /**
   * Conditions the hold carries for exactly as long as it lasts — SRD
   * Crocodile: "While Grappled, the target has the Restrained condition."
   *
   * **A lifetime the engine already had, under another name.**
   * `ConditionInstance.impliedBy` is how Unconscious carries Prone, and
   * `removeConditionInstance` takes an implied instance off with the one that
   * carried it — so a Restrained filed as implied by the Grappled lifts at the
   * escape, at either automatic lapse and at a grappler's release, through the
   * doors those already go through and with nothing new to remember.
   *
   * **Per source rather than in the static table**, because the sentence is
   * per creature: a Wolf's grapple carries nothing and a Crocodile's carries
   * Restrained, and `IMPLIES` says what a *condition* means rather than what
   * one particular set of jaws does.
   */
  readonly whileHeld?: readonly ConditionName[];
  /**
   * SRD Animated Rug of Smothering: "the rug **can** give it the Grappled
   * condition (escape DC 13) instead of dealing damage."
   *
   * An offer rather than a consequence, which is the whole of why it is a flag
   * the swing answers: the book writes "can", the engine has nobody to ask,
   * and a hold made on every hit would be a rule the line does not print. A
   * swing that names the choice takes it; one that does not deals the damage.
   */
  readonly insteadOfDamage?: true;
  /** What the hold costs at each of somebody's turn boundaries, where it costs one. */
  readonly payout?: HitHoldPayout;
}

/**
 * An attach the blow makes, compiled off the line that prints one.
 *
 * Everything here is optional because the two SRD blocks that attach share
 * only the first sentence: a stirge attaches and drinks, a darkmantle
 * attaches, blinds and pins its own Speed at 0.
 */
export interface HitAttach {
  /** SRD Darkmantle's "DC 13 Strength (Athletics) check", where the line prints one. */
  readonly detachDc?: number;
  /** SRD Darkmantle: "Its Speed becomes 0" — the *attacher's*. */
  readonly holderSpeedBecomesZero?: true;
  /**
   * What the attach hangs on the creature it landed on, for as long as it
   * holds — SRD Darkmantle's Blinded.
   *
   * {@link HitGrapple.whileHeld}'s twin on the other hold, filed under the
   * attach's own source so `creature-detached` lifts it. The size gate the
   * line prints is evaluated at the swing and is not here; the *other* gate is
   * — see {@link coverNeedsAdvantage}.
   */
  readonly whileHeld?: readonly ConditionName[];
  /**
   * SRD Darkmantle: "…**and the darkmantle had Advantage on the attack roll**,
   * it covers the target."
   *
   * The one gate a printed rider carries past the moment it is built, and it
   * has to be: what a hit buys is settled before the d20 so a hold can pin it,
   * and this clause asks about the roll that has not happened yet. The swing
   * narrows the option once the mode is known — see `coveredByTheRoll`.
   */
  readonly coverNeedsAdvantage?: true;
  /** What the attach takes out of somebody at each of somebody's boundaries. */
  readonly payout?: HitHoldPayout;
}

/**
 * What a hold hands over at every one of somebody's turn boundaries — SRD
 * Stirge's 5 (2d4) Necrotic, SRD Animated Rug's 10 (2d6 + 3) Bludgeoning.
 *
 * `GrantedPayout` as a printed line states it. **`onTurnOf` is the
 * load-bearing field**: the Stirge names its own turns and the Rug writes
 * "its", which is the creature that was struck, and the two are a round apart.
 * The dice are a notation rather than a total, because a payment that repeats
 * throws a new die at each boundary.
 */
export interface HitHoldPayout {
  readonly dice: string;
  readonly flat: number;
  readonly damageType: DamageType;
  readonly at: TurnMoment;
  readonly onTurnOf: HitRiderAnchor;
}

/**
 * What the feature adds to the die, and what to call it in the log.
 *
 * Derived rather than stored for the ability case, so the number is the one on
 * the sheet when the die is thrown — the rule every conditional benefit in
 * this file follows.
 */
export function selfHealAddend(
  feature: HealAmount,
  abilities: Readonly<Record<Ability, number>>,
): { readonly amount: number; readonly label: string } {
  return feature.plus.kind === 'level'
    ? { amount: feature.plus.level, label: feature.plus.label }
    : { amount: abilityModifier(abilities[feature.plus.ability]), label: feature.plus.label };
}

/**
 * A feature that gives a *different* pool's uses back, at a moment that is not
 * a rest.
 *
 * Two features write this sentence — Sorcerous Restoration and Magical
 * Cunning — and they agree on everything structural and differ on every
 * number. Both spend one use of a pool of their own that only a Long Rest
 * refills, both regain expended uses of some other pool, and both cap what
 * comes back. What is not shared is the pool, the sizing, the rounding or the
 * moment, so each of those is declared per feature from its own sentence —
 * the rule `StandingRequirement` already follows.
 *
 * It is not `ActivatedFeature`: nothing is switched on, nothing runs for a
 * duration, and there is nothing to switch off.
 */
export interface RecoveryFeature {
  readonly feature: string;
  readonly name: string;
  /**
   * The pool holding the feature's own limit.
   *
   * "Once you use this feature, you can't do so again until you finish a Long
   * Rest" is a pool of one that recovers on a Long Rest, which is a thing the
   * engine already has — so it is one, rather than a second kind of limit.
   */
  readonly pool: string;
  /** The pool it gives uses back to. */
  readonly restores: string;
  /**
   * How the cap is sized, transcribed from the feature's own sentence.
   *
   * Two members because two features, and each names a different number to
   * halve *and* a different way to round it. Collapsing them would have made
   * one of the two wrong, silently, in exactly the way `DiceScaling`'s
   * per-slot notation was nearly made wrong by reading an increase off a base.
   */
  readonly upTo: 'half-class-level' | 'half-pool-maximum' | 'all';
  /** The level the sizing reads, which is *that class's*, not the character's. */
  readonly classLevel: number;
  /**
   * The moment the feature's sentence names.
   *
   * `short-rest` is one the engine can see and therefore enforces. `declared`
   * is one it cannot: Magical Cunning's "esoteric rite for 1 minute" is a
   * minute of fiction, and no state distinguishes it from a minute of walking.
   * That clause is the table's in the same way a disguise is — performing a
   * rite is not arithmetic — and naming it here is what keeps it from being
   * mistaken for a rule nobody built.
   */
  readonly moment: 'short-rest' | 'declared' | 'initiative';
  /**
   * Hit points the recovery brings with it.
   *
   * SRD Uncanny Metabolism: "you can regain all expended Focus Points. When
   * you do so, roll your Martial Arts die, and regain a number of Hit Points
   * equal to your Monk level plus the number rolled." One act, not two — the
   * healing has no separate cost and cannot be had without the recovery.
   */
  readonly heal?: HealAmount;
}

/**
 * One direction of a feature's trade, with its keys resolved.
 *
 * {@link RecoveryFeature}'s neighbour and the same shape of thing: what a
 * feature does to a pool that is not its own, resolved at creation because a
 * slot's key carries a level. What differs is which way the uses go — a
 * recovery gives them back for nothing, and this one pays.
 *
 * The grant's own vocabulary is `ResourceTradeGrant` in `progression.ts`; this
 * is that with the two ends turned into pool keys, because a command spends
 * and restores by key and nothing below it knows what a spell slot is.
 */
export interface TradeFeature {
  readonly feature: string;
  readonly name: string;
  /** The trade's own id, which is what a command names. */
  readonly trade: string;
  readonly action: 'none' | 'action' | 'bonus-action';
  /**
   * The pool spent, or **null** where the caller names a slot level.
   *
   * SRD's "expend a spell slot" leaves the level to the caster, and a key
   * cannot be resolved until they say — which is the one thing about a trade
   * that cannot be settled at creation.
   */
  readonly spends: { readonly key: string | null; readonly uses: TradedAmount };
  /**
   * The pool bought, or **null** where the caller names the slot levels.
   *
   * The mirror of {@link spends}, and it arrived for the mirror reason: SRD
   * Font of Magic creates "one spell slot" of a level the Sorcerer picks off
   * the Created Spell Slots table, and SRD Arcane Recovery recovers slots the
   * Wizard chooses. Which slot is bought is no more the engine's to guess than
   * which slot is burnt, so the key waits for the caller in both directions.
   */
  readonly gains: { readonly key: string | null; readonly uses: TradedAmount };
  /**
   * SRD Arcane Recovery's "combined level equal to no more than half your
   * Wizard level (round up)", read at the granting class's own level — the
   * same moment and the same rule as `RecoveryFeature.classLevel`.
   */
  readonly combinedLevel?: number;
  /** SRD Arcane Recovery: "none of them can be level 6+." */
  readonly maxSlotLevel?: number;
  /** SRD Arcane Recovery: "When you finish a Short Rest." */
  readonly moment?: 'short-rest';
  readonly limit: 'once-per-turn' | 'once-per-long-rest' | 'unlimited';
  /**
   * The pool of one the trade declares — the daily limit it lives in where
   * {@link limit} is `once-per-long-rest`, and the feature's own single use
   * that an `unlimited` trade buys back. See `ResourceTradeGrant.pool`.
   */
  readonly pool?: string;
  /** SRD: "if you have no uses of Wild Shape left". */
  readonly onlyIfEmpty?: string;
}

/**
 * The most this feature can give back, before what is actually expended is
 * taken into account.
 *
 * Derived at the moment of use rather than stored on the sheet, for the reason
 * every conditional benefit in this file is: a pool's maximum can move, and a
 * number written down at creation would go on being the old one.
 */
export function recoveryCap(feature: RecoveryFeature, poolMax: number): number {
  switch (feature.upTo) {
    // SRD Sorcerous Restoration: "no more than a number equal to half your
    // Sorcerer level (round down)."
    case 'half-class-level':
      return Math.floor(feature.classLevel / 2);
    // SRD Magical Cunning: "no more than a number equal to half your maximum
    // (round up)."
    case 'half-pool-maximum':
      return Math.ceil(poolMax / 2);
    // SRD Uncanny Metabolism and Persistent Rage: "regain **all** expended
    // ...". The pool's own maximum is the most that can ever be owed, and
    // what is actually expended narrows it at the moment of use.
    case 'all':
      return poolMax;
  }
}

/** A standing effect that is reaching a particular creature right now. */
export interface ActiveStanding {
  readonly from: CharacterId;
  readonly effect: StandingEffect;
}

/**
 * Whether the holder meets what this particular effect asks of them.
 *
 * Only what the feature's own text says. "Inactive while you have the
 * Incapacitated condition" is the aura's sentence and Danger Sense's, read
 * from the two ends; it is not a property of standing effects in general.
 */
function meetsRequirements(state: GameState, who: CharacterId, effect: StandingEffect): boolean {
  return requirementsHold(state, who, effect.requires, effect.feature);
}

/**
 * The same question, asked of a list of requirements rather than of a standing
 * effect.
 *
 * Exported because a {@link StrikeStyle} is gated by the same vocabulary and
 * is not a standing effect: SRD Martial Arts' "while you aren't wearing armor
 * or wielding a Shield" is `unarmored`, word for word the clause Unarmored
 * Movement already carries. A second spelling of that evaluation is the thing
 * this file exists to prevent, so there is one.
 *
 * `source` is what `while-worn` and `while-attuned` look up — an item's id.
 * A feature naming no item is refused by `checkContent`, so handing a feature
 * id here withholds the benefit rather than granting it by accident.
 *
 * And because a **granted spell route** is gated by it too: SRD One with
 * Shadows casts only "while you're in an area of Dim Light or Darkness", which
 * is the same clause a `standing` grant's `requires` already writes, asked of
 * a route instead of a benefit.
 */
export function requirementsHold(
  state: GameState,
  who: CharacterId,
  requires: readonly StandingRequirement[] | undefined,
  source: string,
): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;

  for (const requirement of requires ?? []) {
    if (requirement.kind === 'not-incapacitated' && isIncapacitated(creature.conditions)) {
      return false;
    }
    if (
      requirement.kind === 'feature-active' &&
      !creature.activeFeatures.includes(requirement.feature)
    ) {
      return false;
    }
    // The whole Speed, not the base one conditions are applied to: `speedOf`
    // is the one reader, and a feature or (after IE-033) a spell that moves a
    // Speed has to reach this clause like everything else.
    if (requirement.kind === 'has-speed' && speedOf(state, who) <= 0) {
      return false;
    }
    if (
      requirement.kind === 'not-wearing-heavy-armor' &&
      creature.sheet.armor?.category === 'heavy'
    ) {
      return false;
    }
    // The same slot the clause above reads, asked from the other end — and
    // only that slot, because SRD Defense names the three armour categories
    // and says nothing of a Shield.
    if (requirement.kind === 'wearing-armor' && creature.sheet.armor === null) {
      return false;
    }
    if (
      requirement.kind === 'unarmored' &&
      (creature.sheet.armor !== null || creature.sheet.shield !== null)
    ) {
      return false;
    }
    // The item's own two clauses, read off the creature's relations to it.
    // `source` is the item's id for an item grant; a *feature* that
    // carried one of these would name no item and would never hold, which is
    // the conservative direction and what `checkContent` refuses outright.
    if (
      requirement.kind === 'while-worn' &&
      !creature.equipped.some((held) => held.id === source)
    ) {
      return false;
    }
    if (
      requirement.kind === 'while-attuned' &&
      !creature.attuned.some((held) => held.id === source)
    ) {
      return false;
    }
    // Where the creature is standing, and how bright it is there — both read
    // now rather than stored, exactly as `has-speed` reads a Speed. A creature
    // nobody has placed is in no sunlight, which is the same answer an
    // undeclared space gives and the conservative one.
    if (requirement.kind === 'in-sunlight') {
      const where = state.scene === null ? null : positionOf(state.scene, who);
      if (where === null || !lightAt(state, where).sunlight) return false;
    }
    // The same reading, of the other end of the same scale. A null is
    // "nobody has said" rather than darkness, so it withholds: a shadow in a
    // room nobody has described does not get its Bonus Action by default.
    if (requirement.kind === 'in-dim-light-or-darkness') {
      const where = state.scene === null ? null : positionOf(state.scene, who);
      if (where === null) return false;
      const level = lightAt(state, where).level;
      if (level !== 'dim' && level !== 'darkness') return false;
    }
    if (requirement.kind === 'while-bloodied' && !isBloodied(creature)) {
      return false;
    }
  }
  return true;
}

/** A requirement nobody can answer yet, and which fact is missing. */
export interface UnsaidRequirement {
  readonly requirement: StandingRequirement;
  /**
   * Which silence it is, and they are three different problems: nobody has
   * described a room, nobody has put the creature in it, or nobody has said
   * how bright it is where they are standing.
   *
   * Only the last is an *answer* rather than a gap — see the paragraph on the
   * "no default ambient" ruling above — which is exactly why the three are
   * told apart here rather than lumped together as "unsaid".
   */
  readonly missing: 'scene' | 'position' | 'light';
}

/**
 * The requirements in this list that are unmet because **nobody has said**,
 * rather than because the answer is no.
 *
 * {@link requirementsHold} collapses the two, and it is right to: a shadow in
 * a room nobody has described does not get its Bonus Action by default, and
 * the answer an unlit room gives is the answer it has always given — the "no
 * default ambient" ruling, which `doors.test.ts` keeps from the other end by
 * refusing `declareLight` a `ContextRequest` kind at all. **So this does not
 * turn a refusal into a `needs-context`**, and nothing here should: what it is
 * for is the *wording*. A caster told no by a brightly lit room and a caster
 * told no by a room nobody has lit have two different problems, and only one
 * of them is repaired by saying something — so the seam that refuses says
 * which it met and names the command that would settle it.
 *
 * Only the two clauses that read the *world* can be unsaid. Every other member
 * is derived from the creature's own record, which is never absent for a
 * creature that exists — an unarmoured creature is unarmoured, and a creature
 * attuned to nothing is attuned to nothing.
 */
export function unsaidRequirements(
  state: GameState,
  who: CharacterId,
  requires: readonly StandingRequirement[] | undefined,
): readonly UnsaidRequirement[] {
  const found: UnsaidRequirement[] = [];
  for (const requirement of requires ?? []) {
    if (requirement.kind !== 'in-sunlight' && requirement.kind !== 'in-dim-light-or-darkness') {
      continue;
    }
    if (state.scene === null) {
      found.push({ requirement, missing: 'scene' });
      continue;
    }
    const where = positionOf(state.scene, who);
    if (where === null) {
      found.push({ requirement, missing: 'position' });
      continue;
    }
    if (lightAt(state, where).level === null) found.push({ requirement, missing: 'light' });
  }
  return found;
}

/**
 * SRD glossary: "A creature is Bloodied while it has half its Hit Points or
 * fewer remaining."
 *
 * Doubled rather than halved, so no rounding rule has to be invented for an
 * odd maximum. A function rather than a line inside `requirementsHold`,
 * because the same sentence is printed on a stat block's own attack line —
 * SRD Swarm of Rats bites for less "if the swarm is Bloodied" — and a second
 * spelling of the comparison is how the two would come to disagree about an
 * odd Hit Point maximum.
 *
 * A creature nobody has added is not Bloodied; it is not anything.
 */
export function isBloodied(creature: CreatureState | undefined): boolean {
  if (creature === undefined) return false;
  return creature.vitals.hp * 2 <= creature.vitals.hpMax;
}

/**
 * The query with SRD Blood Frenzy's fact worked out, where there is one to
 * work out.
 *
 * "against any creature that doesn't have all its Hit Points" — the same
 * predicate SRD Colossus Slayer writes as "if it's missing any of its Hit
 * Points", asked of the creature the roll is against. A roll that records no
 * second creature is left alone rather than answered false, because absent and
 * false read the same way to the predicate and writing one would claim the
 * engine had looked.
 *
 * **Not `isBloodied`'s threshold.** One point short of the maximum is missing
 * Hit Points and is not Bloodied, and the two sentences are in the book side
 * by side; a shared helper would quietly make them one rule.
 */
function missingHitPoints(state: GameState, query: RollQuery): RollQuery {
  const against = query.against ?? null;
  if (against === null) return query;
  const victim = state.creatures[against];
  if (victim === undefined) return query;
  return { ...query, targetMissingHitPoints: victim.vitals.hp < victim.vitals.hpMax };
}

/**
 * The query with the **roller's** creature type worked out, where the engine
 * knows one.
 *
 * SRD Protection from Evil and Good: "Creatures of those types have
 * Disadvantage on attack rolls against the target." The fact is the engine's
 * own record rather than anything the site throwing the die knows better, so
 * it is filled in here beside {@link missingHitPoints} and for the same
 * reason: one predicate decides every mode, and no attack site has to remember
 * a field.
 *
 * **Through {@link typeMagicSees}, because the sentence that reads it is a
 * spell's.** SRD Arcanist's Magic Aura makes "spells and other magical effects
 * treat the target as if it were a creature of the chosen type", and a ward is
 * one of those — so a masked Ghoul swings at the cleric as whatever the Mask
 * says it is. A roller the record does not hold is left alone rather than
 * answered null, because absent and null read the same way to the predicate
 * and writing one would claim the engine had looked.
 */
function rollerCreatureType(state: GameState, query: RollQuery): RollQuery {
  const roller = state.creatures[query.roller];
  if (roller === undefined) return query;
  return { ...query, rollerType: typeMagicSees(roller) };
}

/**
 * The query with SRD Hunter's Mark's other fact worked out: whether the creature
 * this check is being made to find is one the roller has **marked**.
 *
 * "You also have Advantage on any Wisdom (Perception or Survival) check you make
 * **to find it**." Two halves, and they are held by different people: which
 * creature the attempt is about is the asker's — nothing else could know
 * whether a Perception check is tracking the quarry or listening at a door — and
 * whether that creature is marked is the engine's own record, `attackRiders`,
 * which is what `attack-rider.marksTarget` wrote. So the purpose is stated and
 * the mark is looked up, here, beside {@link rollerCreatureType} and for its
 * reason: one predicate decides every mode and no site that throws a die has to
 * remember a field.
 *
 * **The same reader `knowledge.ts` uses**, in the sense that both ask the
 * rider's own `target` — the rider sits on the *ranger*, because Hunter's Mark
 * is cast at a quarry ninety feet away and the die is the ranger's, so this is a
 * question about the roller's own state that reaches the quarry only to compare
 * ids. And the casting's lifetime is the mark's: every door that ends a casting
 * takes the rider with it, so nothing here has to remember that the spell
 * stopped.
 *
 * A check that stated no purpose is left alone rather than answered false,
 * because absent and false read the same way to the predicate and writing one
 * would claim the engine had looked.
 */
function findingMarked(state: GameState, query: RollQuery): RollQuery {
  const finding = query.finding ?? null;
  if (finding === null) return query;
  const marked = (state.creatures[query.roller]?.attackRiders ?? []).some(
    (rider) => rider.target === finding,
  );
  return { ...query, findingMarked: marked };
}

/**
 * The style that reaches this swing, or null where none does.
 *
 * Three questions, and a style has to answer all three: its gate holds, it
 * covers the thing being swung, and — where it says so — nothing outside it is
 * in the holder's hands.
 *
 * **`wielding` is passed in rather than looked up**, because a weapon record
 * lives in the catalogue and this file holds none: `equipped` carries an
 * armour record and an item's pinned grants, and nothing else. The command has
 * the content in hand already, exactly as `reachOf` does.
 *
 * The **first** style that applies wins. No character the SRD can build has
 * two, and a rule for combining two class features that both redefine the fist
 * is a decision nobody has made — so the answer is the one the sheet lists
 * first rather than a silently invented maximum.
 */
export function strikeStyleFor(
  state: GameState,
  who: CharacterId,
  context: { readonly weapon: Weapon | null; readonly wielding: readonly Weapon[] },
): StrikeStyle | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;

  // **A casting that imbued this weapon is asked first**, and it can only ever
  // answer for the one object it was aimed at.
  //
  // SRD Shillelagh redefines a Quarterstaff's die and the ability its rolls
  // are made with, which is exactly what a style is, so it arrives here rather
  // than as a fourth thing the attack layer would have to learn to read.
  //
  // **First, and the order is a ruling rather than an accident.** A style is
  // the sheet's and a casting is an act somebody just took, so the deliberate
  // thing wins where both reach the same swing — a Monk/Druid who spends a
  // Bonus Action on Shillelagh gets Shillelagh's die and not Martial Arts'. It
  // can shadow one thing, and does so on purpose: a weapon rider is keyed on
  // one weapon's id, so an Unarmed Strike reaches this branch only through a
  // rider that says `unarmed` — SRD Alter Self's claws — and that casting is an
  // act somebody just took, so it wins over a Monk's Martial Arts die exactly
  // as Shillelagh wins over it on a staff. A style with an empty `weapons` list
  // in the same position would take every Monk's fist away; a rider reaches
  // the one fist it was cast on.
  const imbued = weaponRidersFor(creature, context.weapon).find(
    (rider) => rider.die !== undefined || rider.ability !== undefined,
  );
  if (imbued !== undefined) {
    return {
      source: imbued.source,
      name: spellOfSource(imbued.source),
      ...(imbued.die === undefined ? {} : { die: imbued.die }),
      ...(imbued.ability === undefined ? {} : { ability: imbued.ability }),
    };
  }
  // The sheet as it stands, for the reason every reader in this file takes it:
  // a Belt of Giant Strength moves the score the style's offer is weighed
  // against, and the styles themselves ride along untouched.
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  const styles = sheet.strikeStyles ?? [];
  if (styles.length === 0) return null;

  for (const style of styles) {
    if (!requirementsHold(state, who, style.requires, style.source)) continue;
    const covered = style.weapons ?? [];
    // SRD: "while you are unarmed **or wielding only Monk weapons**". Holding
    // nothing satisfies it, which is the first half of the same sentence.
    if (
      style.whileWieldingOnly === true &&
      !context.wielding.every((held) => weaponInSet(held, covered))
    ) {
      continue;
    }
    // A style always covers the fist; `weapons` is what it adds to it.
    if (context.weapon !== null && !weaponInSet(context.weapon, covered)) continue;
    return style;
  }
  return null;
}

/**
 * The standing effects this creature's **items** are offering right now.
 *
 * Gathered from the two places an item's grants are pinned — what is worn and
 * what is attuned — and deduplicated by item, because an item that is both is
 * one item with one set of benefits. Whether any of them actually applies is
 * still `meetsRequirements`' question: this is the population, not the answer.
 *
 * The two lists are both read because they have different lifetimes. Taking a
 * ring off does not break the attunement, so an attuned item that nobody is
 * wearing still offers whatever it grants without asking to be worn — and an
 * item worn by somebody who never attuned to it still offers whatever needs no
 * attunement.
 */
function itemStandingOf(creature: CreatureState): readonly StandingEffect[] {
  // SRD Wild Shape: "Equipment that merges with the form has no effect while
  // you're in that form" — and gear merges by default, which is the owner's
  // ruling of 2026-09-20. The items stay in the creature's hands and come back
  // speaking the moment the form ends, because this is read and never stored.
  if (creature.shape !== null) return [];
  if (creature.equipped.length === 0 && creature.attuned.length === 0) return [];

  const byItem = new Map<string, readonly StandingEffect[]>();
  for (const held of creature.attuned) byItem.set(held.id, held.grants ?? []);
  for (const held of creature.equipped) byItem.set(held.id, held.grants ?? []);
  return [...byItem.keys()].sort().flatMap((item) => byItem.get(item) ?? []);
}

/**
 * Whether two creatures are allies.
 *
 * Who is on your side is fiction, like cover and line of sight, so it is
 * **declared** rather than derived: a creature carries the side the table put
 * it on. Two creatures are allies when they are on the same declared side.
 *
 * A creature nobody has placed on a side is nobody's ally. That is a default,
 * and it is the conservative one — the benefit is withheld rather than
 * invented — but it is a default, so `standingFor` reports it rather than
 * letting an aura silently fail to reach somebody.
 */
function alliedWith(state: GameState, a: CharacterId, b: CharacterId): boolean {
  if (a === b) return true;
  const sideA = state.creatures[a]?.side ?? null;
  const sideB = state.creatures[b]?.side ?? null;
  return sideA !== null && sideA === sideB;
}

/** Whether this effect, held by `from`, is reaching `who` right now. */
function reaches(state: GameState, from: CharacterId, effect: StandingEffect, who: CharacterId): boolean {
  if (!meetsRequirements(state, from, effect)) return false;
  if (effect.reach.kind === 'self') return from === who;

  // A corpse radiates nothing. The SRD does not say so because it does not
  // contemplate the question; it is stated here rather than left to the fact
  // that a dead creature is usually Unconscious too. A *self* effect is
  // untouched by this — a dead sorcerer resisting fire harms nobody.
  if (state.creatures[from]?.vitals.dead === true) return false;

  // SRD: "You and your allies in the aura."
  if (from === who) return true;
  if (!alliedWith(state, from, who)) return false;

  if (state.scene === null) return false;
  const apart = distanceBetween(state.scene, from, who);
  // An unplaced creature is not in anybody's aura. Where a creature is
  // standing has no right answer until somebody says, and inventing one to
  // hand out a bonus is the wrong direction to guess in.
  if (!apart.ok) return false;
  return apart.value <= effect.reach.feet;
}

/**
 * Every standing effect reaching this creature, from whoever is holding it.
 *
 * Sorted by holder and then by feature, so two readers of the same state agree
 * about the order — which matters because the best-of rule below picks the
 * first of a tie.
 */
export function standingFor(state: GameState, who: CharacterId): readonly ActiveStanding[] {
  const active: ActiveStanding[] = [];

  for (const holder of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[holder];
    if (creature === undefined) continue;

    // A creature's own features, plus the actions anybody can take. The
    // second list is not on anybody's sheet, because it belongs to everybody.
    const held = [
      ...(creature.sheet.standing ?? []),
      // What this creature's magic items grant, pinned when they were put on
      // or attuned to, and conditional in exactly the way a feature's is.
      ...itemStandingOf(creature),
      ...UNIVERSAL_ACTION_EFFECTS,
    ].sort((a, b) => a.feature.localeCompare(b.feature));

    for (const effect of held) {
      if (reaches(state, holder as CharacterId, effect, who)) {
        active.push({ from: holder as CharacterId, effect });
      }
    }
  }

  return active;
}

/**
 * Flat bonuses this creature's standing effects add to a saving throw.
 *
 * SRD Aura of Protection: "If another Paladin is present, a creature can
 * benefit from only one Aura of Protection at a time; the creature chooses
 * which aura while in them." That is a choice with one sensible answer — a
 * bigger bonus costs nothing and gives up nothing — so the best is taken and
 * named, on the same reading that settles two Unarmoured Defenses. Two
 * *different* features would both apply; it is the same feature twice that
 * does not stack.
 */
export function standingSaveBonuses(
  state: GameState,
  who: CharacterId,
  ability: Ability,
): readonly Bonus[] {
  void ability;
  const best = new Map<string, Bonus>();

  for (const { from, effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'save-bonus') continue;

    const holder = state.creatures[from];
    if (holder === undefined) continue;

    // The holder's score as it stands, so a Paladin wearing something that
    // sets their Charisma radiates the aura that score gives.
    // `abilityScoresOf` rather than `sheetAsItStands`: this wants one
    // holder's one score, and the substitution would build a sheet nobody
    // here reads.
    const flat = Math.max(
      effect.grant.minimum,
      abilityModifier(abilityScoresOf(state, from)[effect.grant.fromAbility]),
    );
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: `${effect.name} (${from})`, flat });
    }
  }

  return [...best.values()];
}

/**
 * The ability-sized bonuses this creature's standing effects add to a check of
 * one skill.
 *
 * {@link standingSaveBonuses}' twin on the other family, and it takes every
 * one of that function's readings because they are the same sentence: the
 * modifier is the **holder's**, read off their sheet as it stands rather than
 * off the sheet of whoever is rolling; the floor is the feature's own "(minimum
 * of +1)"; and the best is kept per feature, because "when two or more game
 * features have the same name, only the effects of one of them — the most
 * potent — apply".
 *
 * The skill is the whole of the narrowing. A feature that named none would be
 * a bonus to every ability check, which is `flat-bonus`'s shape and is refused
 * here by `checkContent` rather than read as "all of them".
 */
export function standingCheckBonuses(
  state: GameState,
  who: CharacterId,
  skill: Skill,
): readonly Bonus[] {
  const best = new Map<string, Bonus>();

  for (const { from, effect } of standingFor(state, who)) {
    // SRD Jack of All Trades: half the holder's own Proficiency Bonus, on a
    // check made with a skill the holder is **not** proficient in.
    if (effect.grant.kind === 'half-proficiency-on-checks') {
      const holder = state.creatures[from];
      if (holder === undefined || from !== who) continue;
      const level = holder.sheet.skills[skill] ?? 'none';
      if (level !== 'none') continue;
      const flat = Math.floor(proficiencyBonus(sheetAsItStands(state, who) ?? holder.sheet) / 2);
      if (flat > 0) best.set(effect.feature, { source: effect.name, flat });
      continue;
    }
    if (effect.grant.kind !== 'check-bonus') continue;
    if (!effect.grant.skills.includes(skill)) continue;

    const holder = state.creatures[from];
    if (holder === undefined) continue;

    const flat = Math.max(
      effect.grant.minimum,
      abilityModifier(abilityScoresOf(state, from)[effect.grant.fromAbility]),
    );
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      // Named for the feature alone, unlike the aura beside it: both SRD
      // writers reach their own holder, so there is no second creature for a
      // reader of the log to tell the bonus apart by.
      best.set(effect.feature, { source: effect.name, flat });
    }
  }

  return [...best.values()];
}

/**
 * What this creature's standing effects add to the save DC of a casting made
 * through a named class.
 *
 * The other side of a saving throw from {@link standingSaveBonuses}, and asked
 * at the one place a class casting's numbers are settled — `numbersFor` — so a
 * Fireball's DC and a Charm Person's are raised by one reading of one grant
 * and the number is pinned onto the casting like every other.
 *
 * `through` is the class the casting is made through, or null where it is made
 * through none: a feat's granted route, a stat block's declaration, and a wand.
 * A grant narrowed to a class misses all three, which is the SRD's own reading
 * — "Sorcerer spells you cast" is a sentence about the class, and a Wand of
 * Fireballs belongs to nobody's.
 *
 * **Whoever the grant reaches, which is not only its holder.** `standingFor`
 * already answers that question — an aura's effects come back for everybody
 * standing in it — and this reads what it is given, exactly as
 * {@link standingBonuses} does with a flat bonus. No SRD sentence raises
 * somebody *else's* spell save DC, and a homebrew aura that did would be a
 * grant executed rather than validated and quietly dropped.
 *
 * **Summed across features, and the best of any one of them.** A Robe of the
 * Archmagi and an Innate Sorcery are different sentences on different pages
 * and both are true at once; two allies radiating one named aura are the SRD's
 * "when two or more game features have the same name, only the effects of one
 * of them — the most potent — apply", which is the rule
 * {@link standingCheckBonuses} already follows for the same reason.
 */
export function standingSpellSaveDcBonus(
  state: GameState,
  who: CharacterId,
  through: string | null,
): number {
  const best = new Map<string, number>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'spell-save-dc-bonus') continue;
    const only = effect.grant.onlyThroughClass;
    if (only !== undefined && only !== through) continue;
    const flat = effect.grant.flat;
    const current = best.get(effect.feature);
    if (current === undefined || current < flat) best.set(effect.feature, flat);
  }
  let total = 0;
  for (const flat of best.values()) total += flat;
  return total;
}

/**
 * What a roll is being made *with*, for the one clause that asks.
 *
 * The catalogue id of the weapon in hand, or null for an Unarmed Strike and
 * for every roll no object is made with — an Armour Class, a saving throw, a
 * Dexterity check. Absent is not null: a caller that does not know reads the
 * same as a roll made with nothing, which is the conservative direction.
 */
export interface BonusContext {
  readonly withItem?: string | null;
  /**
   * The weapon record the swing resolved, for the *other* narrowing.
   *
   * SRD Archery's "with Ranged weapons" is a question about what kind of thing
   * is in hand rather than which copy of it, so it is answered off the record
   * and not off `withItem` — see {@link WeaponNarrowing}. Absent is a roll made
   * with no weapon, which is the conservative direction: a narrowed benefit is
   * withheld from a caller who has not said.
   */
  readonly weapon?: Weapon | null;
  /** SRD Great Weapon Fighting's "holding with two hands". */
  readonly twoHanded?: boolean;
}

/**
 * The half of a context a weapon narrowing asks about.
 *
 * One conversion in one place, so the two readers that ask cannot come to
 * disagree about what an unstated hand means.
 */
const wielding = (context: { readonly weapon?: Weapon | null; readonly twoHanded?: boolean }): WieldingContext => ({
  weapon: context.weapon ?? null,
  ...(context.twoHanded === undefined ? {} : { twoHanded: context.twoHanded }),
});

/**
 * Flat bonuses this creature's standing effects add to one kind of thing.
 *
 * {@link standingSaveBonuses}' sibling, and the general one: that answers only
 * for Aura of Protection's ability-derived shape, this for the flat number an
 * item prints. Both are here rather than at their readers because whether a
 * benefit applies changes when somebody walks away, and neither is stored.
 *
 * **Stacking is the SRD's own sentence**, and it is the reason the best is
 * keyed by `feature`. "Different game features can affect a target at the same
 * time. But when two or more game features have the same name, only the
 * effects of one of them — the most potent — apply while the durations of the
 * effects overlap." The granting item's id *is* the name, so a Ring of
 * Protection and a Cloak of Protection are +2 and two rings are +1 — the same
 * reading `standingSaveBonuses` takes for two Paladins' auras.
 *
 * "Most potent" is read as the larger number, which is right for every bonus
 * the SRD prints and **unsettled for a penalty**: two same-named cursed items
 * would keep the gentler of the two, where "most potent" arguably means the
 * harsher. It is written down rather than guessed because no such item exists
 * to decide it — `flat` is signed so one could — and a test freezing today's
 * answer would be the engine settling a question the book has not asked.
 *
 * `withItem` narrows: an effect that says "made with this magic weapon" is
 * withheld from every roll made with anything else, including the rolls no
 * object is made with at all.
 */
export function standingBonuses(
  state: GameState,
  who: CharacterId,
  applies: StandingBonusApplies,
  context: BonusContext = {},
): readonly Bonus[] {
  const best = new Map<string, Bonus>();
  const withItem = context.withItem ?? null;

  for (const { from, effect } of standingFor(state, who)) {
    // **The ability-sized plus on an attack roll**, gathered in the same walk
    // as the flat one because they are the same question asked of two
    // sentences — SRD Sacred Weapon's Charisma modifier and an Archery
    // feat's +2 both end up as a named number on the same roll.
    //
    // `abilityScoresOf(from)` for `save-bonus`'s reason: the modifier is the
    // **holder's**, read off their scores as they stand, so a Paladin wearing
    // something that sets their Charisma swings at the score they have. The
    // two are the same creature for every sentence the book writes here, and
    // reading the holder anyway is what keeps them from disagreeing the day
    // one is not.
    if (effect.grant.kind === 'attack-bonus') {
      if (applies !== 'attack') continue;
      if (
        effect.grant.onlyWithWeapon !== undefined &&
        !weaponNarrowingHolds(effect.grant.onlyWithWeapon, wielding(context))
      ) {
        continue;
      }
      const holder = state.creatures[from];
      if (holder === undefined) continue;
      const flat = Math.max(
        effect.grant.minimum,
        abilityModifier(abilityScoresOf(state, from)[effect.grant.fromAbility]),
      );
      const current = best.get(effect.feature);
      if (current === undefined || (current.flat ?? 0) < flat) {
        best.set(effect.feature, { source: effect.name, flat });
      }
      continue;
    }
    if (effect.grant.kind !== 'flat-bonus') continue;
    if (!effect.grant.applies.includes(applies)) continue;
    // "Made with this magic weapon", and with no other.
    if (effect.grant.onlyWithItem === true && withItem !== effect.feature) continue;
    // "With Ranged weapons", and with nothing else — the other narrowing, read
    // off the record rather than off the id.
    if (
      effect.grant.onlyWithWeapon !== undefined &&
      !weaponNarrowingHolds(effect.grant.onlyWithWeapon, wielding(context))
    ) {
      continue;
    }

    const flat = effect.grant.flat;
    const current = best.get(effect.feature);
    if (current === undefined || (current.flat ?? 0) < flat) {
      best.set(effect.feature, { source: effect.name, flat });
    }
  }

  // **The weapon a casting imbued, folded in here rather than at the caller.**
  // SRD Magic Weapon's "+1 bonus to attack rolls **and** damage rolls" is one
  // number reaching two rolls, and this is the attack half; the damage half is
  // `standingAttackDamage`, which is the other place a flat number of the
  // weapon's own reaches a swing. Keyed apart from the feature bonuses above
  // by the casting in the source, so two castings of Magic Weapon on one
  // weapon do not stack — the same "same name, most potent" reading.
  if (applies === 'attack') {
    for (const bonus of weaponRiderBonuses(state.creatures[who], context.weapon ?? null)) {
      const current = best.get(bonus.source);
      if (current === undefined || (current.flat ?? 0) < (bonus.flat ?? 0)) {
        best.set(bonus.source, bonus);
      }
    }
    // **And the ability-sized plus on an imbued weapon**, which is SRD Sacred
    // Weapon's sentence keyed to the object the book keys it to. The same
    // derivation the `attack-bonus` grant above makes — the *holder's*
    // modifier as it stands, floored at the number the feature prints — with
    // the narrowing coming off the rider's own weapon id rather than off a
    // kind of weapon, which is the whole of what "that weapon" asked for.
    for (const rider of weaponRidersFor(state.creatures[who], context.weapon ?? null)) {
      const sized = rider.attackBonusFrom;
      if (sized === undefined) continue;
      const flat = Math.max(sized.minimum, abilityModifier(abilityScoresOf(state, who)[sized.ability]));
      const label = riderLabel(rider);
      const current = best.get(label);
      if (current === undefined || (current.flat ?? 0) < flat) {
        best.set(label, { source: label, flat });
      }
    }
  }

  return [...best.values()];
}

/**
 * The flat plus an imbued weapon carries, as the two rolls that read it take
 * their bonuses.
 *
 * Its own function because the plus reaches an attack roll and a damage roll
 * and those are gathered in two places, and a second spelling of "which rider
 * applies and what is it worth" is how the two would come to disagree about a
 * thrown Dagger.
 *
 * {@link riderLabel} gives the readable half back, so the log says "Magic
 * Weapon" rather than `Magic Weapon#cast:3`; the casting id stays in the
 * grant, which is what ends it.
 */
function weaponRiderBonuses(
  creature: CreatureState | undefined,
  weapon: Weapon | null,
): readonly Bonus[] {
  return weaponRidersFor(creature, weapon)
    .filter((rider) => rider.bonus !== undefined)
    .map((rider) => ({ source: riderLabel(rider), flat: rider.bonus as number }));
}

/**
 * How a log names what imbued a weapon.
 *
 * The pinned name where the writer was a feature and the spell's name where it
 * was a casting — one function, because a rider's two writers both reach every
 * gatherer below and a second spelling is how "Sacred Weapon" and
 * `feature:oath-of-devotion:sacred-weapon` would come to name one grant in two
 * places. Falls back to the source itself, which is what `spellOfSource` has
 * always done with anything that is not a casting.
 */
const riderLabel = (rider: GrantedWeaponRider): string =>
  rider.name ?? spellOfSource(rider.source);

/**
 * The key a swing answers a rider's offer under.
 *
 * A feature's own id where a feature imbued the weapon, and the spell's name
 * where a casting did — the two spellings `AttackCommand.featureDamageTypes`
 * already holds, because a feature's damage-type choice has always been keyed
 * by its id and a casting's by the spell. One function for
 * {@link damageTypesOffered} and {@link weaponRiderDamageType} to share, so
 * the check at the door and the reader at the damage roll cannot disagree
 * about what a blow was allowed to name.
 */
const riderChoiceKey = (rider: GrantedWeaponRider): string =>
  featureOfSource(rider.source) ?? spellOfSource(rider.source);

/**
 * Every per-die rule this creature's standing effects state about a swing.
 *
 * {@link standingBonuses}' sibling on the other half of what a feature can say
 * about a hit: that one gathers the numbers added to a roll, this the rules the
 * dice themselves are read under. Both are derived on every read and both ask
 * the same narrowing, because SRD Archery and SRD Great Weapon Fighting are one
 * clause about the weapon in hand wearing two sets of words.
 *
 * What comes back is the dice layer's own vocabulary, named after the feature
 * that stated the rule. **The name is for the deduplication rather than for the
 * log**: a substituted die records what it showed and what it counts as, side
 * by side, and `DieRoll.cause` names only the effect that *added or replaced* a
 * die — which a substitution does not do. So the log says a 1 counted as a 3
 * and does not say which rule said so.
 *
 * Deduplicated by feature, for the reason `standingBonuses` is: two holders of
 * one name are one rule, and applying a substitution twice would be a
 * substitution of a substitution.
 */
export function standingDamageEffects(
  state: GameState,
  who: CharacterId,
  context: { readonly weapon?: Weapon | null; readonly twoHanded?: boolean } = {},
): readonly DieEffect[] {
  const found = new Map<string, DieEffect>();

  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-die-rule') continue;
    if (
      grant.onlyWithWeapon !== undefined &&
      !weaponNarrowingHolds(grant.onlyWithWeapon, wielding(context))
    ) {
      continue;
    }
    found.set(effect.feature, treatLowRollsAs(grant.rule.atMost, grant.rule.as, effect.name));
  }

  return [...found.values()];
}

/**
 * The whole-roll rule this creature's standing effects state about a weapon's
 * damage, and the once-per-turn allowance taking it spends.
 *
 * {@link standingDamageEffects}' twin on the other scope, asking the same
 * weapon narrowing and answering in the dice layer's own vocabulary. Two
 * differences, and both are the SRD's:
 *
 * - **One rule, not a list.** Two rules that each said "roll it twice" would
 *   be four throws of one weapon's dice, which no reading of "use either roll"
 *   reaches. The first that qualifies wins, and the order is the order
 *   `standingFor` returns — a fact about the sheet rather than about who
 *   asked. No SRD character can hold two of these; a homebrew one that did
 *   would get one of them rather than a compounding.
 * - **It can be spent.** SRD Savage Attacker is "once per turn", which is
 *   `standingAttackDamage`'s clause exactly: the combat ledger refuses a
 *   second use on the same turn, and the caller writes the `feature-used` mark
 *   from `spent`. Out of combat there is no ledger and no turn, so the rule
 *   simply holds — the reading every other once-per-turn feature takes.
 */
export function standingWeaponRollRule(
  state: GameState,
  who: CharacterId,
  context: {
    readonly weapon?: Weapon | null;
    readonly twoHanded?: boolean;
    /** The turn this swing is on, or null outside a fight. */
    readonly turn?: number | null;
  } = {},
): { readonly rule: RollRule | null; readonly spent: readonly string[] } {
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-roll-rule') continue;
    if (
      grant.onlyWithWeapon !== undefined &&
      !weaponNarrowingHolds(grant.onlyWithWeapon, wielding(context))
    ) {
      continue;
    }
    // Last, so that a rule ruled out by its own narrowing does not spend an
    // allowance it never used — `standingAttackDamage`'s ordering, for its
    // reason.
    const spent: string[] = [];
    if (grant.oncePerTurn === true && state.combat !== null) {
      if (!canUseFeatureThisTurn(state.combat, who, effect.feature)) continue;
      if ((context.turn ?? null) !== null) spent.push(effect.feature);
    }
    return { rule: { kind: 'roll-twice-keep-either', name: effect.name }, spent };
  }

  return { rule: null, spent: [] };
}

/**
 * Every Advantage and Disadvantage that reaches this roll, from anywhere.
 *
 * **The one gatherer.** A class feature's derived grant and a spell's durable
 * one are two lifetimes of the same mechanic, and before this they were read
 * by four functions that each knew one question — so a spell could not ask the
 * question Dodge answered, and Dodge could not be asked about a spell attack.
 * Both now go through the same {@link selectorMatches} predicate, and what
 * comes back is a list of attributed modes that {@link combineRollModes}
 * settles exactly as it settles every other mode in the engine. Nothing here
 * decides an outcome; the SRD's presence rule is still the only rule that
 * does, and it is still in one place.
 *
 * Deduplicated by source, so a caller who also knows about Danger Sense does
 * not apply it twice — the rule `savingSupport` and `rollInitiativeFor` were
 * already following, hoisted to where every family benefits from it.
 *
 * `seen` is the **holder's** view of whoever is rolling, for the one clause
 * that asks: SRD Dodge's "if you can see the attacker". Three-valued, and an
 * undeclared sight line applies the benefit and says so rather than silently
 * dropping it — the direction an Opportunity Attack already takes.
 */
export function rollModesFor(
  state: GameState,
  asked: RollQuery,
  options: { readonly seenByHolder?: boolean | null } = {},
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  // **The two facts on the query this gathers rather than receives.** SRD Blood
  // Frenzy reads the Hit Points of the creature being swung at, and SRD
  // Protection from Evil and Good reads what the creature swinging **is** —
  // both the engine's own record and not something the site throwing the die
  // knows any better than this does — so they are filled in here, once, and
  // `selectorMatches` stays the single predicate every mode is decided by. A
  // roll with no second creature is left silent, and a selector asking for it
  // reads that as a miss.
  const query: RollQuery = findingMarked(
    state,
    rollerCreatureType(state, missingHitPoints(state, asked)),
  );
  const modes: ModeSource[] = [];
  const unverified: string[] = [];
  const seen = new Set<string>();

  const push = (source: string, mode: RollMode): void => {
    if (seen.has(source)) return;
    seen.add(source);
    modes.push({ source, mode });
  };

  // A feature's grant is read from whoever holds it, and which creature that
  // is depends on the relation: a mode on the roller comes off the roller's
  // own sheet, while one on rolls *against* somebody comes off the creature
  // being rolled against. So both ends are asked, and the predicate decides.
  const holders: CharacterId[] = [query.roller];
  const against = query.against ?? null;
  if (against !== null && against !== query.roller) holders.push(against);

  for (const holder of holders) {
    for (const { effect } of standingFor(state, holder)) {
      if (effect.grant.kind !== 'roll-mode') continue;
      if (!selectorMatches(effect.grant.modifier.selector, holder, query)) continue;

      if (effect.grant.ifSeen === true) {
        const sight = options.seenByHolder ?? null;
        if (sight === false) continue;
        if (sight === null) {
          unverified.push(
            `nobody has said whether ${holder} can see the creature rolling, and ${effect.name} needs that; the benefit was applied rather than withheld`,
          );
        }
      }

      push(effect.name, effect.grant.modifier.mode);
    }
  }

  // And the durable half: what a running spell has hung on a creature.
  for (const granted of grantedRollModes(state, query)) {
    push(granted.source, granted.mode);
  }
  // SRD Faerie Fire: "if the attacker can see it". A grant gated on the
  // roller's sight of the holder is applied where nobody has said, and the
  // roll says so — the direction `ifSeen` takes above, read the other way.
  for (const source of unsettledSightGrants(state, query)) {
    unverified.push(
      `nobody has said whether ${query.roller} can see ${String(query.against)}, and ${source} grants its mode only to a roller who can; the benefit was applied rather than withheld`,
    );
  }

  return { modes, unverified };
}

/**
 * Damage types this creature's features make it resistant to.
 *
 * SRD: "multiple instances of Resistance to the same damage type count as only
 * one", which is why `DamageDefenses` is booleans rather than counts — so two
 * features naming Fire is the same halving as one.
 */
export function standingDefenses(
  state: GameState,
  who: CharacterId,
): Readonly<Record<string, DamageDefenses>> {
  const defenses: Record<string, DamageDefenses> = {};

  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'damage-resistance') continue;
    for (const type of effect.grant.damageTypes) {
      defenses[type.toLowerCase()] = { resistant: true };
    }
  }

  return defenses;
}

/**
 * Everything this creature resists, is immune to, or is vulnerable to.
 *
 * **Three inputs, not two.** The stat block's entries, the ones its features
 * grant while some requirement holds, and the ones a *running effect* has hung
 * on it — Stoneskin's Resistance, Protection from Energy's. The third arrived
 * last and is the one with a lifetime: it is keyed by source so `releaseCasting`
 * and a `grants` deadline can take it away again, where the other two are
 * derived afresh on every read.
 *
 * **The answers union rather than overriding**, and the SRD is why: "multiple
 * instances of Resistance to the same damage type count as only one", so there
 * is no arithmetic for a second copy to do and no reading under which a grant
 * could *weaken* what is already there. A creature Immune to Fire that is then
 * granted Resistance to Fire still takes nothing, because `applyDefenses` reads
 * Immunity first and stops; a creature Vulnerable to Fire that is granted
 * Resistance takes the SRD's own worked order, halved and then doubled.
 */
export function defensesOf(
  state: GameState,
  who: CharacterId,
): Readonly<Record<string, DamageDefenses>> {
  const own = state.creatures[who]?.defenses ?? {};
  const standing = standingDefenses(state, who);
  const hung = state.creatures[who]?.grantedDefenses ?? [];
  // And the fourth input: what an area the creature is standing in grants it
  // for standing there. Derived on every read like the second, and stored on
  // nobody — see {@link AreaDefenseStanding}.
  const place = areaDefenses(state, who);
  if (Object.keys(standing).length === 0 && hung.length === 0 && place.length === 0) return own;

  const merged: Record<string, DamageDefenses> = { ...own };
  const add = (type: string, defence: DefenseKind): void => {
    merged[type] = { ...merged[type], [defence]: true };
  };
  for (const [type, defence] of Object.entries(standing)) {
    if (defence.resistant === true) add(type, 'resistant');
    if (defence.immune === true) add(type, 'immune');
    if (defence.vulnerable === true) add(type, 'vulnerable');
  }
  // Unsorted on purpose: a union of booleans commutes, so the order the grants
  // arrived in cannot change the answer, and `damage-defense-granted` sorts
  // them by source on the way in anyway — this is a derived read that reaches
  // no log.
  for (const granted of hung) {
    for (const type of granted.damageTypes) add(type, granted.defense);
  }
  for (const granted of place) add(granted.type, granted.defense);
  return merged;
}

/**
 * Conditions this creature cannot be given at all.
 *
 * **The one gatherer**, in {@link defensesOf}'s shape and beside it, because
 * it answers the other half of the run a stat block prints in one line: a
 * Zombie's "Immunities Poison; Exhaustion, Poisoned" is one damage type and
 * two conditions. The damage half has had a reader since defences reached
 * state; this half had none, so `adaptMonster` produced the list and nothing
 * whatever consulted it.
 *
 * **Two inputs**, in {@link defensesOf}'s shape: the creature's own printed
 * entries, and the ones a *running effect* has hung on it. The gatherer was
 * written with one and said in those words that the second was the next thing
 * to arrive and would join here rather than at the caller — reading
 * `creature.conditionImmunities` at `applyConditionTo` would be the second
 * place the question is answered, which is what this repository keeps recording
 * going wrong. It arrived, and nothing at the caller changed.
 *
 * **The answers union; a grant may never weaken what is printed.** An Immunity
 * is a boolean, so there is no arithmetic a second copy could do and no reading
 * under which a grant could take one away: a Zombie granted Mind Blank's
 * Charmed Immunity is immune to Charmed once, and is still immune to Poisoned
 * and Exhaustion when the casting ends. The damage half says the same sentence
 * — "multiple instances of Resistance to the same damage type count as only
 * one" — and `new Set` below is the whole of the rule.
 *
 * The printed half has no source and never ends; the granted half is keyed by
 * one, so `releaseCasting`, `releaseOnTarget` and a `grants` deadline take it
 * away through the door the other six sourced grants already use.
 *
 * **Suppression is deliberately not folded in.** SRD Aura of Courage says a
 * Frightened ally's condition "has no effect on that ally while there" — the
 * condition is still on them and comes back the moment they leave, which is
 * what {@link suppressedConditions} and {@link effectiveConditions} are for.
 * An immunity refuses the condition outright; a suppression lets it land and
 * does nothing with it, and merging the two would get both wrong.
 *
 * **An *implied* condition is not checked against this, and that is a residue
 * rather than a decision.** `applyCondition` expands SRD's implication table —
 * Unconscious carries Incapacitated and Prone — and it does so in the fold,
 * after the command has asked this about the condition the caller **named**.
 * So a creature immune to Prone and Incapacitated but not to Unconscious
 * acquires both the moment something makes it Unconscious. The witness is
 * real: SRD's Swarm of Crawling Claws prints "Charmed, Exhaustion, Frightened,
 * Grappled, Incapacitated, Paralyzed, Petrified, Poisoned, Prone, Restrained,
 * Stunned" and not Unconscious, and `monster-command.test.ts` pins that fact —
 * the stat block's list and the implication edge it meets — so this sentence
 * cannot quietly stop being about a real case.
 *
 * It is written down rather than fixed because **the SRD does not settle it**:
 * the book says Unconscious "includes" the other two and says nothing about
 * what an immunity to one of them does to that sentence, so filtering the
 * implications would be the engine answering a question the rules declined to
 * ask — and so would leaving a test that froze today's answer. The same shape
 * as `TurnBudget.movementGained`'s open reading. What narrows it in practice
 * is that a monster `diesAtZero`, so the hit-point route to Unconscious is
 * mostly closed; what is reachable is `applyConditionTo` and a `condition`
 * effect naming Unconscious directly. A ruling, from the errata or from the
 * table, is what would end this.
 *
 * Sorted and deduplicated, so the answer cannot depend on the order the inputs
 * were read in.
 */
export function conditionImmunitiesOf(
  state: GameState,
  who: CharacterId,
  /**
   * The creature causing the condition, where the door knows one.
   *
   * SRD Protection from Evil and Good protects against gaining the Charmed or
   * Frightened conditions "**from them**", and this function answered about a
   * condition and was told nothing whatever about what was trying to cause it
   * — which is the sentence `a-condition-immunity-narrowed-to-its-source`
   * named. See {@link GrantedConditionImmunity.fromTypes}.
   *
   * **Read through `typeMagicSees`**, because a ward is a spell and the SRD
   * says spells read a type through the Mask. Absent, or a creature this state
   * does not hold, or a creature nobody has typed: a *narrowed* grant does not
   * bite and the unqualified ones answer exactly as they always did.
   */
  from?: CharacterId,
): readonly ConditionName[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];
  const causer = from === undefined ? undefined : state.creatures[from];
  const causerType = causer === undefined ? null : typeMagicSees(causer);
  const names = new Set<ConditionName>(creature.conditionImmunities);
  for (const granted of creature.grantedConditionImmunities) {
    if (
      granted.fromTypes !== undefined &&
      (causerType === null || !granted.fromTypes.includes(causerType))
    ) {
      continue;
    }
    for (const condition of granted.conditions) names.add(condition);
  }
  // And what the place the creature is standing in refuses — SRD Magic
  // Circle's "Targets within the Cylinder can't … gain the Charmed or
  // Frightened condition from the creature" — narrowed by the causer's type
  // exactly as a granted one is. `'stated'` never reaches a record, because the
  // casting substitutes the list before pinning; a clause that somehow still
  // says it names nobody, which is the withholding direction.
  for (const { standing, inside } of areaStandingOn(state, who)) {
    if (standing.kind !== 'condition-immunity') continue;
    const fromTypes = standing.fromTypes;
    if (
      fromTypes !== undefined &&
      (fromTypes === 'stated' || causerType === null || !fromTypes.includes(causerType))
    ) {
      continue;
    }
    // And the other end of the reversed circle's pair: the protection is from
    // the creature it is holding in, and a causer nobody has placed is nowhere.
    // See {@link AreaSide.attackerInside}.
    if (standing.attackerInside === true && (from === undefined || !inside.has(from))) continue;
    for (const condition of standing.conditions) names.add(condition);
  }
  return [...names].sort();
}

/**
 * Every rule about the action economy standing over this creature right now:
 * what a casting hung on them, and what their own features say.
 *
 * **The one reader**, which is the point of it. `Spend` is built at eighteen
 * sites across nine command modules, and every one of them read
 * `creature.actionRules` — the stored half — so a feature's rule reaching only
 * seventeen of them would be a permission that worked everywhere but the
 * spender somebody happened to use.
 *
 * **The stored rules come first and the order is the fold's.** `refuseSpend`
 * takes the first rule that bites, so appending rather than merging by key is
 * what keeps every log this engine has already written answering exactly as it
 * did: a creature under Stinking Cloud is refused by Stinking Cloud, with the
 * same sentence, whatever its sheet says. The derived half is sorted by
 * {@link actionRuleKey} so that two readers of one state agree about it — a
 * tidiness rather than a rule, since nothing in this half is order-sensitive:
 * `governs` answers `false` for an `allows`, so a derived allowance never
 * reaches `refuseSpend` at all, and `allowsPrice` is an exact-match scan.
 *
 * A feature's rule is filtered by `meetsRequirements` on the way through —
 * that is what `standingFor` does — so a rule conditioned on a Rage stops the
 * moment the Rage does, with nothing having to remember to end it.
 */
export function actionRulesOn(
  state: GameState,
  who: CharacterId,
): readonly GrantedActionRule[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];

  const derived: GrantedActionRule[] = [];
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'action-rule') continue;
    derived.push({
      source: effect.feature,
      rule: effect.grant.rule,
      label: effect.name,
      // A feature holds its rule for as long as it holds the feature. Where
      // its own sentence names a shorter span it says so, and a requirement
      // that has stopped holding has already removed the rule above.
      until: effect.grant.until ?? 'you no longer have it',
      ...(effect.grant.spends === undefined ? {} : { spends: effect.grant.spends }),
      // The Proficiency Bonus as it stands at this read, which is when the
      // price is taken: a level gained since the sheet was compiled counts.
      ...(effect.grant.temporaryHitPoints === undefined
        ? {}
        : {
            temporaryHitPoints:
              effect.grant.temporaryHitPoints === 'proficiency-bonus'
                ? proficiencyBonus(sheetAsItStands(state, who) ?? creature.sheet)
                : effect.grant.temporaryHitPoints,
          }),
    });
  }
  if (derived.length === 0) return creature.actionRules;

  derived.sort((a, b) =>
    actionRuleKey(a.source, a.rule).localeCompare(actionRuleKey(b.source, b.rule)),
  );
  return [...creature.actionRules, ...derived];
}

/**
 * SRD Ritual Adept: whether a feature licenses this creature to cast a Ritual
 * from the spellbook unprepared. Read where the casting's route is chosen.
 */
export function ritualsFromBookOn(state: GameState, who: CharacterId): boolean {
  return standingFor(state, who).some(({ effect }) => effect.grant.kind === 'ritual-from-book');
}

/**
 * The senses this creature has right now, and how far each one reaches.
 *
 * Gathered through `standingFor`, so everything that grants a benefit grants
 * a sense by the same route and under the same clauses: a species trait, a
 * magic item that is worn or attuned to, and — should anything ever print one
 * — an aura. A sense whose requirement is not met is not had at all, which is
 * the whole reason this is derived on every read rather than stored.
 *
 * **One entry per sense, at the longest range granted.** The SRD writes the
 * Drow's as an increase — "The range of your Darkvision increases to 120
 * feet" — and Goggles of Night the same way, so two sources of one sense are
 * one sense, and the answer cannot depend on which was read first. Sorted by
 * name, for the reason `conditionImmunitiesOf` is.
 */
export function sensesOf(state: GameState, who: CharacterId): readonly CreatureSense[] {
  const furthest = new Map<SenseName, number>();
  const reach = (sense: SenseName, feet: number): void => {
    const had = furthest.get(sense);
    if (had === undefined || feet > had) furthest.set(sense, feet);
  };
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'sense') continue;
    reach(effect.grant.sense, effect.grant.feet);
  }
  // And what a running casting has conferred — SRD Darkvision the spell —
  // which lengthens a sense the creature already has rather than replacing it.
  for (const held of state.creatures[who]?.senseModifiers ?? []) {
    reach(held.sense, held.feet);
  }
  return [...furthest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sense, feet]) => ({ sense, feet }));
}

/**
 * One awareness a creature has switched on and is still in.
 *
 * SRD Divine Sense is the one printing. Read off the sheet's activations
 * rather than stored, so it stops the instant the feature leaves
 * `activeFeatures` — a deadline, the Incapacitated condition, death or a
 * second use — without any of those knowing an awareness existed.
 */
export interface RunningAwareness {
  readonly feature: string;
  readonly name: string;
  /** SRD's "within 60 feet of yourself". */
  readonly feet: number;
  /** SRD's "Celestials, Fiends, and Undead". */
  readonly creatureTypes: readonly string[];
}

/**
 * The awarenesses running on this creature, sorted by the feature that opened
 * them.
 *
 * `sensesOf`'s neighbour and deliberately not its member: a sense answers
 * `canSee` and is a fact about eyes, and this answers "what is out there, of
 * these kinds" — which is true through a wall and which no sight rule reads.
 */
export function awarenessesOn(state: GameState, who: CharacterId): readonly RunningAwareness[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  return (sheet.activated ?? [])
    .filter(
      (activation) =>
        activation.detects !== undefined && creature.activeFeatures.includes(activation.feature),
    )
    .map((activation) => ({
      feature: activation.feature,
      name: activation.name,
      feet: activation.detects?.feet ?? 0,
      creatureTypes: activation.detects?.creatureTypes ?? [],
    }))
    .sort((a, b) => a.feature.localeCompare(b.feature));
}

/** One creature a running awareness has found, and what it knows about it. */
export interface DetectedCreature {
  readonly id: CharacterId;
  readonly name: string;
  /**
   * The type the creature's record states, or **null where nobody has typed
   * it**.
   *
   * SRD: "you know its creature type", which is an answer a record that says
   * nothing cannot give. Reported as unknown rather than dropped, because a
   * creature the awareness reached and could not name is a different fact from
   * an empty radius — and dropping it would make the awareness quietly lie
   * about what is out there.
   */
  readonly creatureType: string | null;
  /** Feet from the aware creature, on the scene's own metric. */
  readonly feet: number;
  /** Which awareness found it. */
  readonly feature: string;
}

/**
 * A licence one of this character's features gives them to **know** something
 * about another creature, compiled onto the sheet.
 *
 * SRD Hunter's Lore, and the whole of it. The `FeatureGrant` member's own
 * comment says why this is not `detects` and not a `standing` grant; what is
 * here is the compiled copy, in the shape every other feature-derived sheet
 * line takes — the feature's id, so a caller can say which one told them, and
 * its printed name, so a door can say it in words.
 */
export interface KnownFact {
  readonly feature: string;
  readonly name: string;
  /** SRD's "any Immunities, Resistances, or Vulnerabilities". */
  readonly reveals: 'defenses';
  /** SRD's "While a creature is marked by your _Hunter's Mark_". */
  readonly about: 'a-creature-your-casting-marks';
}

/**
 * A swing this character may give up so that a creature of theirs may take one
 * — SRD Pact of the Chain's forgone attack.
 *
 * The compiled copy of the `summons-attack` grant, in the shape every other
 * feature-derived sheet line takes: the feature's id, so a caller can say which
 * one they are spending; its printed name, so a refusal can say it in words;
 * and the spell whose summons the sentence is about, which is the whole of what
 * "**your** familiar" comes to.
 */
export interface ForgoneAttack {
  readonly feature: string;
  readonly name: string;
  /** SRD's "your familiar": the creature kept from this spell. */
  readonly from: string;
}

/**
 * The facts this creature's features let them know, as the sheet stands.
 *
 * Through `sheetAsItStands`, like every other reader here, so a Hunter
 * wearing a Beast's stat block keeps what their own level taught them — the
 * merged sheet carries the character's compiled feature lines.
 *
 * **Nothing is asked about the world here and nothing is spent.** What is
 * actually known is `knownDefencesOf` in `knowledge.ts`, which asks this for
 * the licence and then derives the answer from state on every read.
 */
export function knowledgeOn(state: GameState, who: CharacterId): readonly KnownFact[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  return sheet.knows ?? [];
}

/**
 * The answer SRD Divine Sense asks for: what is within the radius, of the
 * types the feature names.
 *
 * Derived on every read, which is the reading `standing.ts` insists on for
 * everything conditional: nothing is written down when the awareness opens, so
 * a creature that walks into the radius is found and one that walks out is not,
 * and the whole list is empty the moment the feature stops running.
 *
 * **An unplaced creature is not found**, and neither is one the scene cannot
 * measure to: a radius is a distance, and a creature with no distance is not
 * inside one. Sorted by id, so the answer is fixed however the roster was
 * assembled.
 */
export function detectedBy(state: GameState, who: CharacterId): readonly DetectedCreature[] {
  const running = awarenessesOn(state, who);
  // A radius is a distance, and with no scene there is nothing to measure in.
  const scene = state.scene;
  if (running.length === 0 || scene === null) return [];

  const found: DetectedCreature[] = [];
  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === who) continue;
    const apart = distanceBetween(scene, who, other.id);
    if (!apart.ok) continue;
    for (const awareness of running) {
      if (apart.value > awareness.feet) continue;
      // A type the awareness does not name is not reported at all; a creature
      // with no type at all is, because "unknown" is an answer and "absent" is
      // a different one.
      if (
        other.creatureType !== null &&
        !awareness.creatureTypes.includes(other.creatureType)
      ) {
        continue;
      }
      found.push({
        id: other.id,
        name: other.name,
        creatureType: other.creatureType,
        feet: apart.value,
        feature: awareness.feature,
      });
      break;
    }
  }
  return found;
}

/**
 * SRD Blinded — "You can't see" — asked of the **looker**, and the one sense
 * that excepts it.
 *
 * The first step of all three sight questions below, because it is the
 * book's own flat sentence about the creature doing the looking and not a
 * fact about the pair. It therefore **outranks a declared line**: a table
 * that said this creature can see that one stated a fact about eyes that have
 * since stopped working, and a declaration is for what the engine cannot know.
 * Light and a declaration are both about what lies between two creatures;
 * this is about one of them.
 *
 * **Blindsight is the exception, and the only one.** SRD Blindsight lets a
 * creature "see within a specific range without relying on physical sight",
 * which is exactly the reliance the condition removes — so a Blinded looker
 * sees inside that range and nothing beyond it, and falls through to the
 * ordinary answer where it reaches. Darkvision "can see in Dim Light … as if
 * it were Bright Light" and Truesight "sees in normal and magical Darkness":
 * both are sight, and both go dark with the eyes.
 *
 * `blindsightReaches` is the caller's, because each of the three measures to a
 * different far end — a creature, a point, or a place with no coordinates at
 * all — and the range is the only part of this that is about the pair. It is
 * three-valued for the reason everything about range in this file is: **a
 * Blindsight nobody can measure is homework rather than blindness.** The
 * exception the SRD prints is a distance, and where there is no distance the
 * condition has settled nothing about a creature who holds the sense — while
 * one who holds none is blind either way, because no distance could have made
 * a sense they do not have reach.
 *
 * `undefined` is "the condition says nothing here", which is a third answer
 * and not a fourth: the looker is not Blinded, or their Blindsight reaches, and
 * either way the caller falls through to the ordinary question.
 *
 * `effectiveConditions` rather than the raw record, for the reason every
 * reader of a condition's *effect* goes through it: a feature that says
 * Blinded has no effect on its holder has said so about this too.
 */
function blindedTo(
  state: GameState,
  from: CharacterId,
  blindsightReaches: boolean | null,
): boolean | null | undefined {
  if (blindsightReaches === true) return undefined;
  if (!hasCondition(effectiveConditions(state, from), 'blinded')) return undefined;
  return blindsightReaches === null ? null : false;
}

/**
 * Whether the looker's Blindsight reaches that creature — `false` for a looker
 * who holds none or none long enough, and `null` where they hold some and the
 * lattice cannot say how far away the other one is.
 */
function blindsightReaching(
  state: GameState,
  scene: PositionState,
  from: CharacterId,
  to: CharacterId,
): boolean | null {
  const held = sensesOf(state, from).filter((sense) => sense.sense === 'blindsight');
  if (held.length === 0) return false;
  const apart = distanceBetween(scene, from, to);
  if (!apart.ok) return null;
  return held.some((sense) => apart.value <= sense.feet);
}

/**
 * Whether one creature can see another, with the looker's own senses read in.
 *
 * The `GameState` half of {@link sightBetween}, and the seam every rule that
 * asks about sight comes through: a sense lives on a creature and the
 * declaration lives in the scene, so only a caller holding both can put the
 * two together. Three-valued like the pairwise question it wraps — null is
 * "ask", not "no" — and null again outside a scene, where there is no
 * distance for a range to be measured against.
 *
 * Exported for the reason `speedOf` and `armorClassOf` are: a caller reading
 * the declaration alone gets half the answer, and the half it is missing is
 * the whole of what a species trait grants.
 *
 * **Every rule in the engine that asks about sight asks here**, and none of
 * them calls {@link sightBetween} any more — the pairwise question is for a
 * caller who genuinely holds no creature to read a sense off. What each call
 * has to decide is *whose* sight it wants, because the looker is not always
 * the actor:
 *
 * | Rule | The looker |
 * |---|---|
 * | a casting and its shortlist (`namedTargets`, `eligibleTargets`) | the caster: "a creature **you** can see" |
 * | a teleport (`teleportSight`) | the creature moving: "a space **you** can see" |
 * | an Opportunity Attack (`provokedBy`) | the reactor: "a creature **you** can see leaves your reach" |
 * | a Reaction feature (`reaches`) | the reactor, whose roll they answer |
 * | Dodge (`defendingModes`) | the **target**: "if **you** can see the attacker" |
 * | a ranged attack at close quarters (`enemyWithinFiveFeet`) | the enemy beside you, "who can see you" |
 *
 * Dodge is the one that runs against the direction of the action, and the
 * last is the one a sense cannot move — only a declared no, or the looker's
 * own Blinded condition, excuses that attacker. Both say so where they are
 * written.
 *
 * **And every row of that table is answered "no" by a Blinded looker**, which
 * is the point of gathering them here: SRD Blinded is one flat sentence about
 * the creature doing the looking, so it is read first, ahead of the
 * declaration, with Blindsight the one sense that excepts it. {@link blindedTo}
 * holds the ruling.
 *
 * **One sentence in the book does not ask this question**, and it is the one
 * that looks most like it: SRD Invisible's "if a creature can somehow see
 * you". See {@link canSomehowSee} below for the sense that is the difference
 * and the ruling that put it there.
 */
export function canSee(state: GameState, from: CharacterId, to: CharacterId): boolean | null {
  const scene = state.scene;
  if (scene === null) return null;
  // SRD Blinded, first and ahead of the declaration — {@link blindedTo} says
  // why. Not of the pair a creature makes with itself: that one is answered
  // before everything, because where a creature stands relative to itself is
  // the engine's fact rather than the table's, and `seeing-yourself.test.ts`
  // is the whole of what asking it cost.
  if (from !== to) {
    const forced = blindedTo(state, from, blindsightReaching(state, scene, from, to));
    if (forced !== undefined) return forced;
  }
  return sightBetween(scene, from, to, sensesOf(state, from), {
    obscured: obscuredFrom(state, from, to),
  });
}

/**
 * Whether a creature can see a **place** — {@link canSee} asked of a point.
 *
 * SRD Hypnotic Pattern: "Each creature in the area **who can see the
 * pattern**." The pattern is not a creature and stands in no square of its
 * own; it is at the casting's origin, and that is a coordinate on the
 * lattice. So the question is the sight question with the far end replaced,
 * answered by the same things in the same order and three-valued for the same
 * reason, where null is "ask" and never "no".
 *
 * **What a point does not have is a declaration**, and that is the whole of
 * the difference. Sight and cover are declared *pairwise between creatures* —
 * `coverKey` takes two ids — so there is no line a table could state about a
 * patch of air, and nothing here that could outrank the rest. `teleportSight`
 * met the same wall first and wrote down the same answer: anchored on a bare
 * point "there is no pairwise declaration to read and nothing it could read
 * instead". What is left to settle it is the half of the sight model that is
 * about places rather than pairs:
 *
 * | | |
 * |---|---|
 * | the looker's Blinded condition | {@link blindedTo}, first, as it is in {@link canSee} |
 * | the lattice over the point | a bank of fog or a dark room the table declared — `obscurementAt`, then {@link piercesObscurement} against this looker's senses |
 * | a sight sense that reaches | Blindsight or Truesight in range, Darkvision where the dark is not magical |
 * | anything else | null — nobody has said, and about a point nobody can |
 *
 * **It reads the Blinded condition, because all three of them do.** It used
 * not to, and the silence was right while {@link canSee} was silent too: one
 * of the two answering "a blind creature cannot see" while the other did not
 * would have been worse than both saying nothing, so the one rule that needed
 * it — `areaTargets`, for the clause above — composed the condition beside
 * this call itself. The composition is gone now that the helper reads it, and
 * the two questions agree again.
 *
 * **`space` may be null**, and that is a place with no coordinates rather than
 * a caller being careless — see the note at the branch. Null outside a scene
 * and null for a looker nobody has placed, for the reason {@link canSee} is
 * null outside one: there is no distance for a range to be measured against,
 * and inventing one is inventing a position.
 */
export function canSeePoint(
  state: GameState,
  from: CharacterId,
  space: Point | null,
): boolean | null {
  const scene = state.scene;
  if (scene === null) return null;

  // **A distance the lattice cannot give**: a looker nobody has placed, or —
  // `space` being null — a place with no coordinates at all. The second is a
  // real case rather than a careless caller: an intersection-anchored template
  // is centred on a corner, and "a corner is not a space".
  //
  // Nothing about *where* it is can be measured, so the only thing left that
  // answers is the fact about the looker alone. A creature who cannot see at
  // all cannot see a pattern wherever it hangs; one whose Blindsight might
  // have reached is left unsettled rather than declared blind.
  const apart = space === null ? null : distanceToPoint(scene, from, space);
  const reach = apart !== null && apart.ok ? apart.value : null;
  if (space === null || reach === null) {
    // Held but unmeasurable is `null` here as it is between two creatures, and
    // {@link blindedTo} is the one place that ruling is written.
    const blindsight = sensesOf(state, from).some((sense) => sense.sense === 'blindsight')
      ? null
      : false;
    return blindedTo(state, from, blindsight) ?? null;
  }

  // The looker's own senses, narrowed to those that are a form of sight and
  // then to those that reach — the two filters `sightBetween` and
  // `sensesReaching` make between them, made here because the far end is a
  // place and `sensesReaching` measures to a creature.
  const reaching = sensesOf(state, from).filter(
    (sense) => SIGHT_SENSES.has(sense.sense) && reach <= sense.feet,
  );

  // SRD Blinded, the same first step the other two take — {@link blindedTo}.
  // The reach is measured, so the Blindsight question has a yes or a no.
  const forced = blindedTo(
    state,
    from,
    reaching.some((sense) => sense.sense === 'blindsight'),
  );
  if (forced !== undefined) return forced;

  const darkness = seesThroughOf(state, from).darkness;
  const pierced = piercesObscurement(
    obscurementAt(state, space),
    reaching,
    darkness !== undefined && reach <= darkness ? [{ feet: darkness }] : [],
  );
  // False and never true, which is the ordering `sightBetween` sets out: heavy
  // obscurement is an impediment, and a looker who defeats it is returned to
  // the question they would have been asked in a lit room.
  if (!pierced) return false;

  return reaching.length > 0 ? true : null;
}

/**
 * The darkness this creature sees through, and how far — `sensesOf` for the
 * one grant that is not a sense.
 *
 * Gathered through `standingFor` exactly as a sense is, so an invocation, a
 * species trait and a magic item all reach the sight question by one route
 * and under the same clauses. One entry per member at the longest range, for
 * the reason `sensesOf` keeps one: two sources of one sentence are one
 * sentence, and the answer must not depend on which was read first.
 */
export function seesThroughOf(
  state: GameState,
  who: CharacterId,
): Readonly<Partial<Record<SeesThrough, number>>> {
  const furthest: Partial<Record<SeesThrough, number>> = {};
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind !== 'sees-through') continue;
    const had = furthest[effect.grant.through];
    if (had === undefined || effect.grant.feet > had) {
      furthest[effect.grant.through] = effect.grant.feet;
    }
  }
  return furthest;
}

/**
 * Whether what lies over the **target's** space stops this looker seeing in.
 *
 * **The step `docs/design/light-and-sight.md` adds, and it is here rather
 * than inside `sightBetween` on purpose.** The note's own reason: this reads
 * the looker's senses against the target's space, which is the same class of
 * question `sensesPerceiving` answers and not the class the declaration
 * answers. `positioning.ts` holds space and has no creature to read a sense
 * off; this file holds the creature. So the rule is pure and lives there, the
 * gathering lives here, and `sightBetween` is handed a yes or a no.
 *
 * The SRD's sentence is about the target's space — "while trying to see
 * something in that area" — so a creature standing in pitch darkness sees a
 * lit target perfectly, and this never reads the looker's own square.
 *
 * **False is "nothing is in the way", not "you can see"**, which is the
 * ordering the note gives and the reason this answers a boolean rather than a
 * verdict: a looker who defeats the dark is returned to the question they
 * would have been asked in a lit room, where a declaration or a sight-sense
 * settles it. SRD Devil's Sight's own word is "normally".
 */
function obscuredFrom(state: GameState, from: CharacterId, to: CharacterId): boolean {
  const scene = state.scene;
  if (scene === null || from === to) return false;
  const where = positionOf(scene, to);
  if (where === null) return false;

  const here = obscurementAt(state, where);
  // Lightly Obscured, Bright Light and a space nobody has spoken about all
  // leave the question exactly where it was: with the declaration and the
  // sense. Light changes the answer only where the book says it does.
  if (here.degree !== 'heavily') return false;

  const apart = distanceBetween(scene, from, to);
  const reach = apart.ok ? apart.value : null;
  const darkness = seesThroughOf(state, from).darkness;

  return !piercesObscurement(
    here,
    sensesReaching(scene, sensesOf(state, from), from, to),
    darkness !== undefined && reach !== null && reach <= darkness ? [{ feet: darkness }] : [],
  );
}

/**
 * The senses that see a creature who is not there to be seen.
 *
 * **The owner's ruling, 2026-09-20: Truesight and Blindsight satisfy SRD
 * Invisible's "if a creature can somehow see you". Darkvision does not.**
 *
 * The book is the reason, sense by sense. Darkvision is a rule about *light*
 * — it "can see in Dim Light within the range as if it were Bright Light and
 * in Darkness as if it were Dim Light" — and an Invisible creature is not
 * hidden by darkness, so the sense has nothing to say about it. Blindsight
 * is sight "without relying on physical sight", which is precisely the
 * reliance being Invisible defeats. Truesight is the glossary's own answer:
 * it sees "into the Ethereal Plane" and through the illusions and
 * transformations the clause exists for.
 *
 * It is a **narrowing** of `SIGHT_SENSES` rather than a second list, so no
 * member here can fail to be a form of sight in the first place — and
 * Tremorsense, which "doesn't count as a form of sight", is out of both.
 */
export const SENSES_THAT_SOMEHOW_SEE: ReadonlySet<SenseName> = new Set<SenseName>(
  [...SIGHT_SENSES].filter((sense) => sense !== 'darkvision'),
);

/**
 * Whether one creature can **somehow** see another — {@link canSee} with
 * {@link SENSES_THAT_SOMEHOW_SEE} in place of `SIGHT_SENSES`.
 *
 * SRD Invisible: "If a creature can somehow see you, you don't gain this
 * benefit against that creature," and, read from the other end, "Attack rolls
 * against you have Disadvantage." That is a *different sentence* from the
 * ones {@link canSee} answers, and the engine now says so out loud:
 *
 * | Question | Senses that answer | Whose sentence |
 * |---|---|---|
 * | {@link canSee} | Blindsight, Darkvision, Truesight | Dodge's "if you can see the attacker"; a spell's "a creature you can see"; an Opportunity Attack's |
 * | this one | Blindsight, Truesight | Invisible's "if a creature can somehow see you" |
 *
 * **The asymmetry is the ruling, not an oversight.** `defendingModes` asks
 * {@link canSee} on purpose and must keep asking it: a dwarf Dodging in a
 * lightless hall really can see the orc swinging at her, and Dodge's clause
 * is satisfied. The same dwarf's Darkvision tells her nothing about where the
 * Invisible Rogue is standing. One sense, two sentences, two answers.
 *
 * Everything else about it is {@link canSee}'s behaviour, because it *is*
 * that function with a shorter list: the looker's Blinded condition answers
 * first, a declaration outranks a sense, declared Total Cover silences one, a
 * creature sees itself, and a question nobody has answered is `null` —
 * homework rather than a verdict. The caller decides
 * what to do with the `null`; on the ordinary attack route it is an
 * `unverified` line and never a `needs-context`, because a swing must not
 * stop to ask.
 */
export function canSomehowSee(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
): boolean | null {
  if (state.scene === null) return null;
  const scene = state.scene;
  // SRD Blinded, the same first step and for the same reason: the sentence is
  // about the looker, and this question has one too.
  if (from !== to) {
    const forced = blindedTo(state, from, blindsightReaching(state, scene, from, to));
    if (forced !== undefined) return forced;
  }
  return sightBetween(
    scene,
    from,
    to,
    sensesOf(state, from).filter((sense) => SENSES_THAT_SOMEHOW_SEE.has(sense.sense)),
  );
}

/**
 * The senses one creature actually perceives another with, and nothing else.
 *
 * **The third sight-shaped question, and the one that is not about sight.**
 * {@link canSee} and {@link canSomehowSee} both answer a *sentence about
 * seeing*, so both put the table's declaration first: a declared line is the
 * answer, declared Total Cover silences every sense, and a sense speaks only
 * where nobody has said anything. That ordering is right for both of them and
 * wrong for the clause this answers.
 *
 * SRD Blur: "An attacker is immune to this effect if it **perceives you with
 * Blindsight or Truesight**." SRD Mirror Image names the same two. Ordinary
 * sight is exactly what those spells defeat, so a declared sight line must
 * not excuse anybody — asking {@link canSomehowSee} here would report `true`
 * off the declaration and hand an immunity to every attacker the table had
 * placed in the caster's line of sight, which is the whole spell undone. What
 * the sentence names is the **sense**, so what comes back is the senses and
 * not a verdict, and the rule reading it decides which of them it cares
 * about.
 *
 * Two things it keeps from its siblings, because both are facts about the
 * pair rather than about the sentence:
 *
 * - **Range.** Every sense in the glossary is written "with a range of N
 *   feet", so a sense that does not reach perceives nothing —
 *   `sensesReaching`, the same filter `sightBetween` applies.
 * - **Declared Total Cover silences a sense**, which is the glossary's own
 *   sentence on Blindsight — "you can see anything that isn't behind Total
 *   Cover" — and no less true of the other three. A creature it is illegal to
 *   target is not one an attacker is perceiving.
 *
 * Every sense, not only the sight ones: Tremorsense "doesn't count as a form
 * of sight" and is still a way of perceiving somebody, and it is a caller's
 * clause rather than this function's that decides whether it counts. No
 * clause names it today.
 *
 * Empty outside a scene, where there is no distance for a range to be
 * measured against — the same answer {@link canSee} gives as `null`, read here
 * as "no sense reaches", which leaves the effect standing.
 */
export function sensesPerceiving(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
): readonly SenseName[] {
  if (state.scene === null) return [];
  if (!canBeTargeted(coverBetween(state.scene, from, to))) return [];
  return sensesReaching(state.scene, sensesOf(state, from), from, to).map((sense) => sense.sense);
}

/**
 * This creature's six ability scores **as they stand**: what the sheet says,
 * and whatever is setting one right now.
 *
 * The reader for `ability-score-set`, and the only one. Everything that wants
 * a *sheet* goes through {@link sheetAsItStands}, which is this function plus
 * a substitution; what wants one score asks here. Two functions, one
 * derivation, so no second path can disagree with this one about what a
 * Strength is.
 *
 * Two rules, and both are the SRD's own sentence rather than a policy:
 *
 * - **A set never lowers.** "It has no effect on you if your Constitution is
 *   19 or higher without it" is printed on every item that sets a score, so
 *   it is kept here once rather than by each of them.
 * - **The highest of several wins**, which follows from the first: two belts
 *   are two sentences, each saying "your Strength is at least this", and the
 *   order they are read in cannot be allowed to matter. It is the move
 *   `armorClassCalculation` already makes with two Unarmoured Defenses.
 *
 * Derived on every read, like everything else in this file: the score is
 * gone the moment the item is off, and nothing has to remember to take it
 * away.
 */
export function abilityScoresOf(
  state: GameState,
  who: CharacterId,
): Readonly<Record<Ability, number>> {
  const creature = state.creatures[who];
  const own = creature?.sheet.abilities;
  if (own === undefined) return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

  let changed: Record<Ability, number> | null = null;
  // **What has been drained comes off first**, and a set is read over the
  // result. SRD Shadow's Draining Swipe lowers the score the creature *has*;
  // an item that sets a score says "your Strength is at least this" about
  // whatever it finds, so a drained fighter in a Belt of Giant Strength still
  // has the belt's number, and takes the belt off to a score the shadow has
  // eaten. Floored at nothing, because a score below it is not a score — and
  // the swing that reads 0 here is what writes the death the sentence prints.
  for (const held of creature?.abilityLowerings ?? []) {
    const standing: Record<Ability, number> = changed ?? { ...own };
    standing[held.ability] = Math.max(0, standing[held.ability] - held.amount);
    changed = standing;
  }
  for (const active of standingFor(state, who)) {
    const grant = active.effect.grant;
    if (grant.kind !== 'ability-score-set') continue;
    const standing: Record<Ability, number> = changed ?? { ...own };
    if (grant.score > standing[grant.ability]) standing[grant.ability] = grant.score;
    changed = standing;
  }
  return changed ?? own;
}

/**
 * The sheet a reader should be handed for this creature, rather than the one
 * stored on it.
 *
 * **One substitution, not a second pipeline.** Every modifier the engine
 * derives — a check, a save, an attack, a spell save DC, an Armour Class —
 * reads a score off a `CharacterSheet` through `modifierFor`, so an item that
 * sets a score reaches all of them by changing the sheet those functions are
 * given. Writing a second path for each would be the "second spelling of a
 * derivation" this repository keeps a record of.
 *
 * The **same object** comes back when nothing is setting a score, which is
 * every creature in almost every fight: the copy is paid for only where it
 * changes something, and identity is what a caller can cheaply check.
 *
 * Null for a creature nobody has added, which is what every other reader in
 * this file does with an unknown id — `armorClassOf` answers 0 and `sensesOf`
 * an empty list. A public export that threw where its neighbours degraded
 * would be a trap laid in the one function a caller is told to prefer.
 *
 * **The substitution is made where the state is, which is the commands.**
 * `attack.ts`, `checks.ts` and `combat.ts` take a `CharacterSheet` and hold
 * no `GameState`, and that is right rather than a gap: a roller that went
 * looking for a worn item would be the second derivation this function exists
 * to prevent. So each command asks here and hands the answer down, and an
 * attack roll, the damage it carries, an ability check, a saving throw,
 * Initiative, the save a spell rolls for its victim and the ability modifier a
 * Reaction adds all move with a set score — alongside the two readers in this
 * file that already did, `armorClassOf` through this function and
 * `standingSaveBonuses` through {@link abilityScoresOf}, which wants one
 * holder's one score rather than a sheet.
 *
 * **And the casting family is inside it now.** A spell's own numbers
 * (`numbersFor` in `commands/spell-resolution.ts`, and `numbersForItem` for
 * one an item casts, which takes the sheet the command hands it), the rolls
 * its effects make for caster and victim (`commands/spell-effect-rolls.ts`
 * and `commands/spell-effect-magic.ts`, through the `casterSheet` accessor
 * `resolveEffects` substitutes once), the Concentration save
 * (`commands/casting.ts`), the check and the save a turn boundary repeats
 * (`commands/turns.ts`) and a self-heal's addend (`commands/features.ts`) all
 * ask here. What is *not* a gap is `rollSpellDice`: it keeps only the
 * components whose source is the spell, so no ability modifier reaches it and
 * the sheet it is handed contributes nothing.
 *
 * **And `rest.ts` is inside it too, which was the last one outside.** The
 * Constitution a Hit Die adds on a Short Rest is read at the moment the die is
 * thrown, in a command holding the state and the id, so `endRest` asks here
 * like everything else and an Amulet of Health reaches it. No non-test engine
 * file reads an ability off `creature.sheet` now. What a substitution still
 * cannot reach is the one number that is genuinely *folded* rather than
 * derived — a hit point maximum, paid a level at a time — which is the whole
 * of what the Amulet of Health's one remaining `unmodelled` note records.
 */
export function sheetAsItStands(state: GameState, who: CharacterId): CharacterSheet | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;
  const abilities = abilityScoresOf(state, who);
  // **And the face this creature throws again**, folded in here for the reason
  // the scores above are: every roller in the engine asks this function for
  // the sheet it rolls from, so a rule that reaches the sheet reaches all of
  // them and taking the source of it away takes the rule with it. Derived on
  // every read rather than compiled at creation, so a ring that granted the
  // same sentence works the day it is put on. See
  // {@link CharacterSheet.rerollsD20On}.
  const reroll = d20RerollFor(state, who);
  if (abilities === creature.sheet.abilities && reroll === null) return creature.sheet;
  return {
    ...creature.sheet,
    abilities,
    ...(reroll === null ? {} : { rerollsD20On: reroll }),
  };
}

/**
 * The floor this creature's standing effects put under a blow, if any is still
 * there to spend.
 *
 * SRD Relentless Endurance: "When you are reduced to 0 Hit Points but not
 * killed outright, you can drop to 1 Hit Point instead. Once you use this
 * trait, you can't do so again until you finish a Long Rest."
 *
 * **The limit is a tally and the refusal is here.** A tally is a count with no
 * ceiling — `resources.ts` says so — and what that buys is that *nothing has
 * to declare it*: `FeatureDefinition.grants` is singular and the trait has
 * already spent it on the standing grant that states the rule, so there is no
 * second grant left to declare a pool with. The key and what empties it ride
 * on the grant, exactly as SRD Overchannel's do, and the reader is what makes
 * a count of one mean "once": above zero, this answers null.
 *
 * **The highest floor wins** where two are written, which is the only reading
 * that does not make a second trait a downgrade. No SRD creature holds two.
 */
export function hitPointFloorFor(
  state: GameState,
  who: CharacterId,
): {
  readonly at: number;
  readonly feature: string;
  readonly key: string;
  readonly recovers: Recovery;
} | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;

  let found: { at: number; feature: string; key: string; recovers: Recovery } | null = null;
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'hit-point-floor') continue;
    if (tallied(creature.resources, grant.key) > 0) continue;
    if (found === null || grant.floor > found.at) {
      found = {
        at: grant.floor,
        feature: effect.name,
        key: grant.key,
        recovers: grant.recovers,
      };
    }
  }
  return found;
}

/**
 * The d20 face this creature's standing effects throw again, or none.
 *
 * **One rule, not a list**, for `standingWeaponRollRule`'s reason: two
 * sentences that each said "reroll the die" would be a die thrown three times,
 * which no reading of "you must use the new roll" reaches. The *lowest* face
 * wins where two are written, because a rule about a 1 and a rule about a 2
 * are not two chances — they are one reroll, and a holder of both would rather
 * it were spent on the worse face. No SRD character holds two; a homebrew one
 * that did gets an answer rather than an accident.
 */
function d20RerollFor(
  state: GameState,
  who: CharacterId,
): { readonly on: number; readonly source: string } | null {
  let found: { on: number; source: string } | null = null;
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'reroll-test-die') continue;
    if (found === null || grant.on < found.on) found = { on: grant.on, source: effect.name };
  }
  return found;
}

/**
 * What acid has eaten out of the armour this creature is **wearing**, or 0.
 *
 * SRD Black Pudding's Dissolving Pseudopod and SRD Gray Ooze's Pseudopod are
 * the two lines that write it, and `EquippedItem.penalty` is where it lands:
 * on the copy rather than on the catalogue's record of what chain mail offers.
 *
 * **Narrowed to the piece the calculation actually used**, which is what makes
 * this subtraction honest rather than a second opinion about a number. Two
 * narrowings and no more, because two are all that can happen:
 *
 * - `sheet.armor` is the single piece of body armour `withEquipment` put on
 *   the sheet out of everything equipped, so a shield is never what this eats
 *   and a second suit in the pack is not being worn. Matching the equipped
 *   record back to it by name is how the record and the sheet stay in step —
 *   `withEquipment` picks the piece by that same record, so the two cannot
 *   name different suits.
 * - A creature whose **stated** Armour Class won is not standing behind the
 *   mail at all: `armorClassCalculation` returns a printed number outright and
 *   never looks at the armour, so a penalty taken off it would be acid eating
 *   a number the suit never contributed to. No SRD stat block equips armour,
 *   which is why nothing in the bestiary reaches this — and why it is a guard
 *   rather than a case.
 *
 * A feature's own calculation needs no narrowing here and could not have one:
 * `armorClassCalculation` weighs Unarmoured Defense only in the branch where
 * no armour is worn, so a creature this function finds a suit on is wearing it.
 */
function wornArmorPenalty(creature: {
  readonly sheet: CharacterSheet;
  readonly equipped: readonly EquippedItem[];
}): number {
  const worn = creature.sheet.armor;
  if (worn === null || creature.sheet.stated?.armorClass !== undefined) return 0;
  const record = creature.equipped.find(
    (held) => held.armor !== null && held.armor.name === worn.name,
  );
  return record?.penalty ?? 0;
}

/**
 * What rust has eaten out of the weapon this creature is **swinging**, as the
 * named subtraction the attack roll carries — or nothing.
 *
 * SRD Rust Monster's Antennae: "The object takes a −1 penalty … to its attack
 * rolls (weapon)." `EquippedItem.penalty` is where it lands, on the copy in
 * hand and not on the catalogue's Longsword; `wornArmorPenalty` above is the
 * same reader for the other kind of object the sentence names. Read off the
 * weapon the swing named, so the bow in the pack gets nothing; a weapon that
 * is owned and not held has no record for a penalty to have landed on, which
 * is the door's `object_not_held` refusal read from the other end.
 *
 * A `Bonus` rather than a bare number, for the log's sake: the roll names each
 * flat piece that can name itself, and "−1, Longsword penalty" is legible
 * where a smaller unexplained modifier is not.
 */
export function heldWeaponPenalty(
  creature: { readonly equipped: readonly EquippedItem[] },
  weapon: string | null,
  name: string,
): readonly Bonus[] {
  if (weapon === null) return [];
  const eaten = creature.equipped.find((held) => held.id === weapon)?.penalty ?? 0;
  return eaten > 0 ? [{ source: `${name} penalty`, flat: -eaten }] : [];
}

/**
 * A creature's Armour Class, with whatever is currently raising it.
 *
 * `armorClass` reads a sheet: armour, Dexterity, a shield, or the number a
 * stat block printed. That is the whole answer for a creature nobody has cast
 * anything on, and it was the only answer the engine had — so Shield of Faith
 * had no way to grant its +2 and Shield had no way to grant its +5.
 *
 * Only flat bonuses count. An Armour Class is a standing number rather than a
 * roll, so there is no moment at which a die could be thrown for it, and no
 * SRD spell asks for one. A rolled bonus aimed at `ac` is ignored rather than
 * guessed at.
 *
 * Cover is deliberately *not* here: it is a fact about one attacker's line to
 * one target, not about the target, and the attack that reads it adds it.
 */
export function armorClassOf(state: GameState, who: CharacterId): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 0;

  // The base calculation first, with any an ongoing effect supplied competing
  // in the same pass as the creature’s own features — SRD Multiclassing settles
  // that once for all of them, and `armorClassCalculation` is where it is
  // settled. Only then the flat bonuses, which genuinely do add.
  // The sheet as it stands, so an item that *sets* Dexterity moves the
  // Armour Class that reads it — and an item that sets Strength moves the
  // heavy-armour penalty `armorClass` applies for a Strength requirement.
  let total = armorClass(sheetAsItStands(state, who) ?? creature.sheet, creature.armorClasses);
  for (const active of creature.bonuses) {
    if (!active.applies.includes('ac')) continue;
    const flat = active.bonus.flat ?? 0;
    total += active.direction === 'subtract' ? -flat : flat;
  }
  // And the other lifetime: what a worn item is granting right now. Derived
  // rather than stored, so taking the ring off takes the +1 with it without
  // anything having to remember to. No item is used to *gain* an Armour Class,
  // so there is nothing for a narrowing to match and none may be declared.
  for (const bonus of standingBonuses(state, who, 'ac')) total += bonus.flat ?? 0;
  // And what acid has eaten out of the suit this creature is actually wearing
  // — SRD Black Pudding's Dissolving Pseudopod: "Nonmagical armor worn by the
  // target takes a −1 penalty to the AC it offers." A fact about **one copy**,
  // so it lives on the equipped record and is read here rather than written
  // into the armour record the catalogue prints, which is the same suit in
  // everybody else's game. See `wornArmorPenalty` for the two narrowings that
  // keep it off a number the suit did not contribute to.
  total -= wornArmorPenalty(creature);
  // And last of all, the floor — SRD Barkskin's "an Armor Class of 17 **if its
  // AC is lower than that**". Last because "its AC" in that sentence is the
  // finished number: the calculation, the Shield, every flat bonus and
  // whatever the ring is granting have all had their say, and what this does
  // is refuse the answer if it came out too low. See `GrantedArmorClassFloor`,
  // where the two arms of the family are held apart.
  const floor = armorClassFloor(creature.armorClasses);
  return floor === null ? total : Math.max(total, floor);
}

/**
 * What an effect does to a Speed.
 *
 * Three members, one per operation the SRD writes, and the order they compose
 * in is {@link combineSpeed}'s rather than this union's:
 *
 * > Longstrider: "The target's Speed **increases by 10 feet**."
 * > Ray of Frost: "its Speed is **reduced by 10 feet**."
 * > Haste: "the target's Speed is **doubled**."
 * > Slow: "An affected target's Speed is **halved**."
 * > Hypnotic Pattern: "the creature has ... **a Speed of 0**."
 *
 * Increase and decrease are **one** member with a sign rather than two,
 * because they are one operation: the argument `interveneAfterRoll`'s
 * `direction` already settled for adding and subtracting a die.
 */
export type SpeedChange =
  /** A signed number of feet: Longstrider's +10, Ray of Frost's −10. */
  | 'add'
  /**
   * SRD Haste, "the target's Speed is doubled" — the one sentence in the book
   * that multiplies a Speed.
   *
   * **Presence and not count**, the reading `halve` already takes: two
   * Hastes on one creature are one doubling, because the SRD's own rule for
   * two copies of a benefit is that the second does nothing.
   *
   * **It applies before the halving, and the book gives no order**, so the
   * order is fixed in {@link combineSpeed} with everything else and stated
   * there once. Doubling first is what makes SRD Slow over SRD Haste come
   * back to the walking Speed the creature started with, which is the reading
   * a table expects of two spells that cancel. Halving first would round a
   * 25-foot Speed down to 12 and then double it to 24, so the order is
   * observable and is therefore decided rather than left.
   */
  | 'double'
  /**
   * A Speed in one mode that is the creature's **only** method of movement.
   *
   * > SRD Gaseous Form: "the target's **only** method of movement is a Fly
   * > Speed of 10 feet, and it can hover."
   *
   * Not `add` with the other four zeroed, which is the shape it looks like and
   * would be wrong twice over: `zero` is unqualified and would take the Fly
   * Speed away with the rest, and a Longstrider standing on the same creature
   * would put ten feet of walking back into a body that has no legs. So it is
   * one operation — a Speed *replaced*, in a named mode — and {@link speedOf}
   * answers 0 for every other mode before any of the accumulators run.
   *
   * Carries the feet, because the sentence prints them, and may carry
   * {@link GrantedSpeed.hover} beside them, because the same sentence does.
   */
  | 'only'
  /** SRD Slow. Presence and not count, so two halvings are one halving. */
  | 'halve'
  /** SRD Hypnotic Pattern. Last, and it beats every addition. */
  | 'zero'
  /**
   * A Speed in one **mode** equal to the creature's walking Speed.
   *
   * SRD Spider Climb prints "a Climb Speed equal to its Speed", SRD Alter
   * Self and Freedom of Movement say the same of a Swim Speed, and SRD
   * Second-Story Work says it of a Climb Speed on a class table. Four printed
   * writers of one sentence, which is why it is a member rather than an
   * addition whose feet somebody would have to compute at the cast and pin.
   *
   * **The walking Speed it matches is the base one**, before a Longstrider
   * and before a halving, and then everything that reaches the mode reaches
   * it. The alternative reads the *whole* walking Speed and then halves the
   * result a second time, so a Slowed spider would climb at a quarter of what
   * it walks. It is also the reading that agrees with the rule directly above
   * this family — an increase is the walking Speed's — and there is no
   * recursion, because a match names a mode and the walking mode is refused.
   *
   * Carries no feet. The number is the creature's, and a sentence that
   * printed one would be an addition.
   */
  | 'match-walk';

/**
 * A Speed an ongoing effect has changed.
 *
 * The fifth member of the family `bonuses`, `armorClasses`, `rollModifiers`
 * and `grantedDefenses` already form, and it needed no lifecycle of its own:
 * the casting is in the `source`, so `releaseCasting`, `releaseOnTarget` and a
 * `grants` deadline all end it through the door the other four already use.
 *
 * **It lives here rather than beside the definition format**, with every other
 * grant type: `ActiveBonus` is in `bonuses.ts`, `GrantedArmorClass` in
 * `character.ts`, `ActiveRollModifier` in `roll-modifiers.ts` and
 * `GrantedDefense` in `attack.ts` — each beside the function that reads it.
 * {@link speedOf} is the reader, and {@link combineSpeed} is the order.
 *
 * **`feet` is signed and belongs to `add` alone.** SRD Longstrider increases a
 * Speed by 10 and Ray of Frost reduces one by 10, which is one operation with
 * two signs; `halve` and `zero` name a whole operation and have no number to
 * carry. `checkSpellDefinition` refuses the mismatch at authoring, which is
 * why this stays one flat record rather than a union the reducer would have to
 * narrow on every fold.
 */
/**
 * A sense a running effect confers — SRD Darkvision the spell. Read by
 * {@link sensesOf} at the longest range held, ended by the source it carries.
 */
export interface GrantedSense {
  readonly source: string;
  readonly sense: SenseName;
  readonly feet: number;
}

export interface GrantedSpeed {
  /** The casting (`Longstrider#cast:3`) or the feature that granted it. */
  readonly source: string;
  readonly change: SpeedChange;
  /** Signed feet, for an `add`; absent for the other three. */
  readonly feet?: number;
  /**
   * Which of the five Speeds this moves. Absent is the walking one.
   *
   * **Absent rather than `'walk'`, and that is what keeps the frozen logs
   * folding unchanged**: every `speed-modifier-granted` written before modes
   * existed is a walking one, and a reader that defaults the field reads them
   * exactly as it always did.
   *
   * It is meaningful on the two operations that *give* a Speed and refused on
   * the two that take one away, which is the rule `speedOf` already fixed and
   * `checkSpeedChange` now enforces at the door: SRD writes "your Speed" for
   * an increase and means walking, and writes Grappled's 0, Slow's halving
   * and Exhaustion's five feet a level about the creature rather than about a
   * mode. A `halve` that named one mode would be a sentence the book does not
   * print.
   */
  readonly mode?: MovementMode;
  /**
   * SRD Fly's "and can hover", which is the trait the fall excepts.
   *
   * Only ever beside a granted Fly Speed — `fliesWithoutFallingOn` is the
   * reader, and the pair it reads is the pair `OtherSpeeds` already prints:
   * a creature that cannot fly cannot hover either.
   */
  readonly hover?: true;
}

/**
 * Extra damage an ongoing effect adds to the holder's **later** attacks.
 *
 * The sixth member of the family `bonuses`, `armorClasses`, `rollModifiers`,
 * `grantedDefenses` and `speedModifiers` already form, and like the fifth it
 * needed no lifecycle of its own: the casting is in the `source`, so
 * `releaseCasting`, `releaseOnTarget` and a `grants` deadline all end it
 * through the door the other five already use.
 *
 * **It is held by whoever *deals* the damage, never by whoever takes it.**
 * SRD Hunter's Mark marks a quarry ninety feet away and then says "**you**
 * deal an extra 1d6 Force damage to the target" — the ranger is the one the
 * rider is on, and {@link target} is the creature it is *about*. Storing it on
 * the quarry would have been the tempting reading and would give a second
 * ranger's arrow the first ranger's die.
 *
 * **Two fields, because the SRD writes two different clauses**, and the
 * difference is the one thing about this shape that is easy to get wrong:
 *
 * | | SRD | Fields |
 * |---|---|---|
 * | Divine Favor | "**your attacks with weapons** deal an extra 1d4 Radiant damage on a hit" | `weaponOnly`, no `target` |
 * | Hunter's Mark | "you deal an extra 1d6 Force damage **to the target** whenever you hit it **with an attack roll**" | `target`, no `weaponOnly` |
 *
 * So Divine Favor reaches every weapon in the ranger's hands and no Fire Bolt,
 * and Hunter's Mark reaches a Fire Bolt aimed at the quarry and nothing aimed
 * at anybody else. Sharing one predicate would have made one of the two
 * spells wrong, silently, in the direction nothing measures.
 *
 * **The damage type is required.** Every SRD sentence of this shape names one
 * — Radiant, Force, Necrotic — and the absent-means-the-weapon's-own-type
 * reading `standingAttackDamage` takes for a *feature* has no spell consumer,
 * so a field that could be left out would be shape built ahead of the mechanic
 * that wants it.
 */
export interface GrantedAttackRider {
  /** The casting (`Divine Favor#cast:3`) that granted it. */
  readonly source: string;
  /** The extra dice, e.g. `1d4`. A notation rather than a `DiceScaling`: no
   * SRD sentence of this shape grows its dice with the slot or the level. */
  readonly dice: string;
  /**
   * The damage type the sentence names, or absent for the blow's own.
   *
   * SRD Enlarge/Reduce's "an extra 1d4 damage" prints none, so the die is of
   * whatever the weapon deals — the reading `attack-damage` already takes of a
   * feature's untyped die, and `standingAttackDamage` files the two the same
   * way: an untyped die beside the bonuses of the blow's own type, a typed one
   * as a component of its own.
   */
  readonly damageType?: string;
  /** SRD Divine Favor's "attacks **with weapons**". Absent reaches any attack. */
  readonly weaponOnly?: true;
  /**
   * SRD Enlarge/Reduce's "attacks with its enlarged **weapons or Unarmed
   * Strikes**": every attack roll but a spell's. The spell road names itself
   * to {@link grantedAttackRiders}, which is the one fact that tells a Fire
   * Bolt from a punch — both swing no weapon.
   */
  readonly weaponOrUnarmedOnly?: true;
  /** SRD Hunter's Mark's "**to the target**". Absent reaches any target. */
  readonly target?: CharacterId;
  /**
   * SRD Bestow Curse's "with an attack roll **or a spell**".
   *
   * Every other writer of this grant prints the attack roll alone — SRD Divine
   * Favor's weapons, SRD Hunter's Mark's and SRD Hex's "whenever you hit it
   * with an attack roll" — and one spell in the book widens the trigger past
   * the roll to the damage itself.
   *
   * **It is read on the road an attack does not take.** An attack's damage
   * gathers its riders before the blow is rolled, through
   * {@link grantedAttackRiders}, so this flag changes nothing there; what it
   * buys is the *other* road, a casting's damage that no attack roll bought —
   * a Fireball, a Sacred Flame, a Magic Missile — which `dealSpellDamage`
   * answers for and {@link spellDamageRiders} reads. A blow that took the
   * attack road never takes this one, which is what `fromSpell` says at the
   * three effect resolvers that raise a casting's damage without an attack.
   *
   * **Three more sites are a spell's damage and are not marked**, and the gap
   * is named rather than absorbed: a casting's scheduled hit, an ongoing
   * casting's per-turn payout and the burn a repeat save collects all arrive
   * through `commands/turns.ts`, so the die does not ride them yet. See
   * `dealSpellDamage`'s own note, where the seam is named.
   */
  readonly alsoSpells?: true;
}

/**
 * The riders on this creature's attacks that have something to say about
 * *this* attack.
 *
 * **One gatherer, three paths.** A weapon attack and the second half of a held
 * one both arrive through {@link standingAttackDamage}, which folds this in;
 * a *spell* attack calls it directly, because SRD Hunter's Mark says "whenever
 * you hit it with an attack roll" and a Fire Bolt is one. What the spell path
 * must **not** take is the feature half beside it — Sneak Attack and Rage
 * Damage are weapon rules — which is why this is its own function rather than
 * `standingAttackDamage` pointed at a third caller.
 *
 * That is the `defendingModes` lesson applied on the offensive side: emptying
 * this function fails a weapon-attack test, a held-attack test *and* a
 * spell-attack test, which is the evidence it is one gatherer and not three
 * spelled alike.
 *
 * Returned in the shape `rollAttackDamage` takes its `extraDamage` in, so the
 * die is a **component of its own** with its own type and source: it meets the
 * target's defences separately, and a Critical Hit doubles it.
 */
export function grantedAttackRiders(
  creature: CreatureState | undefined,
  context: {
    readonly weapon: Weapon | null;
    readonly target: CharacterId;
    /** The spell road says so; a weapon or an Unarmed Strike says nothing. */
    readonly spellAttack?: true;
  },
): readonly { readonly source: string; readonly type?: string; readonly dice: string }[] {
  if (creature === undefined) return [];
  return creature.attackRiders
    .filter((rider) => {
      if (rider.weaponOnly === true && context.weapon === null) return false;
      // SRD Enlarge/Reduce's "weapons or Unarmed Strikes": a punch and a Fire
      // Bolt both swing no weapon, and only the road knows which it is on.
      if (rider.weaponOrUnarmedOnly === true && context.spellAttack === true) return false;
      if (rider.target !== undefined && rider.target !== context.target) return false;
      return true;
    })
    .map((rider) => ({
      // `spellOfSource` gives the readable half back, so the log says "Divine
      // Favor" rather than `Divine Favor#cast:3`. The casting id stays in the
      // grant, which is what ends it.
      source: spellOfSource(rider.source),
      ...(rider.damageType === undefined ? {} : { type: rider.damageType }),
      dice: rider.dice,
    }));
}

/**
 * The riders on this creature's later blows that reach a **spell's** damage.
 *
 * {@link grantedAttackRiders}' sibling, and the two are deliberately not one
 * function: that one is asked by an attack roll, before the blow, and this is
 * asked by the funnel every casting's damage goes through, which no attack
 * roll has been near. A rider printed about an attack roll — SRD Divine
 * Favor's, SRD Hunter's Mark's, SRD Hex's — must not reach a Fireball, so
 * {@link GrantedAttackRider.alsoSpells} is the filter and the one spell that
 * prints the wider sentence is the one creature it lets through.
 *
 * **`weaponOnly` is not consulted and could not be**: there is no weapon on
 * this road at all, and a rider that names one has nothing here to name. The
 * flag above is the whole of what selects, beside the creature the rider is
 * about.
 *
 * Returned in the shape `dealSpellDamage` takes its components in, so the die
 * is a component of its own with its own type and source: it meets the
 * target's defences separately, exactly as the attack road's does.
 */
export function spellDamageRiders(
  creature: CreatureState | undefined,
  target: CharacterId,
): readonly { readonly source: string; readonly type: string; readonly dice: string }[] {
  if (creature === undefined) return [];
  return creature.attackRiders
    // A rider with no type of its own is of the blow's, and a spell's blow is
    // the spell's; no rider in the book prints both `alsoSpells` and no type,
    // so the narrowing is the type system's rather than a rule.
    .filter(
      (rider): rider is GrantedAttackRider & { readonly damageType: string } =>
        rider.alsoSpells === true && rider.target === target && rider.damageType !== undefined,
    )
    .map((rider) => ({
      source: spellOfSource(rider.source),
      type: rider.damageType,
      dice: rider.dice,
    }));
}

/**
 * What an ongoing effect has done to **one weapon**, read again on every later
 * attack made with it.
 *
 * The fourteenth sourced grant and the other half of the sixth's family.
 * {@link GrantedAttackRider} above hangs a notation and a damage type on the
 * *attacker* and adds a component of its own; this changes the arithmetic of a
 * particular object — SRD Shillelagh's substituted ability and replaced die,
 * SRD Magic Weapon's flat plus of the weapon's own type.
 *
 * **Keyed on the weapon's catalogue id, which is the thing neither existing
 * narrowing could say.** `StandingGrant.onlyWithItem` is keyed on the id of
 * the item that *granted* the benefit — a Weapon, +1 confining its plus to
 * itself — and no item granted this. `WeaponNarrowing` describes a *kind* of
 * weapon, so it would imbue every Quarterstaff in the pack at once. The SRD
 * writes "**that** weapon", and that is one id.
 *
 * **What the id can and cannot tell apart**, written down rather than
 * discovered: two Quarterstaves in one pack are one id, so a casting aimed at
 * either reaches both. Nothing in the engine can say otherwise today — an
 * attack names its weapon by catalogue id and `InventoryLine.instance` never
 * reaches the swing — and the alternative was a grant keyed on a fact no
 * attack carries, which would have reached no swing at all.
 *
 * **Held by whoever swings**, like the rider above it, and hung on the
 * creature the casting *touched*: Shillelagh is Range: Self and the two are
 * the same creature, and Magic Weapon is Range: Touch and they need not be.
 *
 * Ended by the casting in its `source` exactly as the other thirteen are, so
 * `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration and
 * the deadline all reach it through the door that already existed.
 */
export interface GrantedWeaponRider {
  /**
   * What imbued it: a casting (`Shillelagh#cast:1`) or a feature
   * (`feature:oath-of-devotion:sacred-weapon`).
   *
   * **Two writers now, and the record did not have to change to take the
   * second.** SRD Sacred Weapon imbues "one Melee weapon that you are
   * holding" and every other way of saying that reaches a *kind* of weapon;
   * this is the one record keyed to an object, so an activation files under
   * `featureSource` exactly as a casting files under `castingSource`, and the
   * three readers below cannot tell — nor need to — which of them wrote it.
   *
   * What the two ends differ in is the **key a swing answers under** and the
   * **name a log prints**: `featureOfSource` reads a feature's own id back out
   * for the first, and {@link name} carries the second.
   */
  readonly source: string;
  /**
   * The weapon, by catalogue id: the one the casting or the use was aimed at.
   *
   * Absent where {@link unarmed} is set — SRD Alter Self's Natural Weapons
   * imbue a fist, which has no id — and one of the two is always present.
   */
  readonly weapon?: string;
  /**
   * The rider rides the Unarmed Strike — see `weapon-rider.unarmed`.
   * `weaponRidersFor` answers with it for a swing with no weapon in it.
   */
  readonly unarmed?: true;
  /**
   * SRD Alter Self's "rather than using Strength": {@link ability} is imposed
   * on the swing rather than weighed against the weapon's own — the reading
   * `AttackOptions.imposedAbility` takes of SRD True Strike.
   */
  readonly imposesAbility?: true;
  /**
   * SRD Alter Self's "damage of the type in parentheses": a type the rider
   * imposes on the blow, as the casting stated it. Never beside
   * {@link damageTypes}, which is an offer the swing answers.
   */
  readonly damageType?: string;
  /**
   * How a log names what imbued this weapon, where the source is not a spell.
   *
   * A casting's source carries the spell's name and `spellOfSource` gives it
   * back; `feature:oath-of-devotion:sacred-weapon` is an id, and a bonus on an
   * attack roll reads "Sacred Weapon" to whoever is at the table. Pinned at
   * the use, off the sheet the activation read, so the log never depends on a
   * catalogue being opened again.
   */
  readonly name?: string;
  /** SRD Shillelagh's "the attack and damage rolls of **melee** attacks". */
  readonly meleeOnly?: true;
  /** SRD Magic Weapon's plus, pinned at the slot it was cast with. */
  readonly bonus?: number;
  /**
   * SRD Sacred Weapon: "you add your Charisma modifier to attack rolls you
   * make with that weapon (minimum bonus of +1)."
   *
   * **Not {@link bonus}, and the difference is which rolls it reaches.** Magic
   * Weapon's plus is "a +1 bonus to attack rolls **and** damage rolls" and is
   * read by both gatherers; this sentence names the attack roll alone, so it
   * is gathered only by {@link standingBonuses} and a swing under it deals the
   * damage the weapon deals.
   *
   * **The ability rather than the number**, because the SRD says "your
   * Charisma modifier" and means the modifier the holder has when the blow is
   * struck — the reading the `attack-bonus` standing grant takes of the same
   * sentence, and the reason pinning the arithmetic here would be wrong where
   * pinning Magic Weapon's band table is right: a band is a fact about the
   * casting, and this is a fact about the swinger.
   */
  readonly attackBonusFrom?: { readonly ability: Ability; readonly minimum: number };
  /**
   * SRD Sacred Weapon: "This effect also ends if you aren't carrying the
   * weapon." SRD Shillelagh: "the spell ends early ... if you let go of the
   * weapon."
   *
   * **Declared rather than assumed of every rider**, because the book does not
   * say it of every rider: SRD Magic Weapon enchants a weapon for an hour and
   * prints no such clause, so a weapon put down under it is still a magic
   * weapon when it is picked up. One sentence, two spellings, and only the
   * riders whose own text carries one.
   *
   * What ends is what hung it. A feature's activation goes with the rider —
   * "this **effect** also ends" is the whole imbuing, its light included — and
   * a casting's whole casting goes, which is what "the spell ends early"
   * says. `settleWeaponRiders` in `fold/apply.ts` is the one pass, and it
   * compares an item id against the ids in the holder's inventory, which is
   * the reading `resolveSpell` already takes of "you are holding": an
   * inventory says what a creature has, and nothing says which hand it is in.
   */
  readonly endsWhenLetGo?: true;
  /** SRD Shillelagh's die, pinned at the caster's level. */
  readonly die?: string;
  /**
   * SRD Shillelagh's offered ability, resolved to the caster's own.
   *
   * **Offered rather than imposed**, which is the reading `attackAbility`
   * gives every sentence written "you can use X instead of Y" — and SRD Pact
   * of the Blade's "you **can** use your Charisma modifier for the attack and
   * damage rolls instead of using Strength or Dexterity" is that sentence
   * word for word, so it arrives on this field and needed no other. The
   * imposition beside it is `AttackOptions.imposedAbility`, which is SRD True
   * Strike's "The attack **uses** your spellcasting ability", and the two
   * differ in whether the attacker may decline: a Warlock with more Strength
   * than Charisma swings with Strength, and a True Strike never does.
   */
  readonly ability?: Ability;
  /**
   * SRD Pact of the Blade: "Until the bond ends, you have proficiency with the
   * weapon."
   *
   * A fact about **one object** rather than about a category, which is what
   * makes it a field here and not a widening of `CharacterSheet.weaponProficiencies`:
   * a Warlock is proficient with the Glaive they bonded and with no other
   * Glaive, and the sheet's list is read as categories a whole class was
   * trained in. `proficientWith` answers the categories; this joins it where
   * the swing asks, so a rider on a weapon the holder is already trained in
   * changes nothing.
   *
   * Absent on every rider a casting writes: SRD Magic Weapon and Shillelagh
   * enchant a weapon and train nobody.
   */
  readonly proficient?: true;
  /**
   * SRD Shillelagh's "it can be Force damage or the weapon's normal damage
   * type (your choice)" — the types offered *instead of* the weapon's own.
   *
   * SRD Sacred Weapon prints the same sentence from the other side of the
   * fence — "each time you hit with it, you cause it to deal its normal damage
   * type or Radiant damage" — which is one reason the record takes a feature's
   * source as readily as a casting's.
   *
   * The one field on this record that is not settled here: the others are
   * facts about the casting or the use, and this is an offer the swing
   * answers. Which of them a blow takes is named on the attack command under
   * the spell's name or the feature's own id — `featureOfSource` and
   * `spellOfSource`, one key per writer — and naming none deals what the
   * weapon deals.
   */
  readonly damageTypes?: readonly string[];
}

/**
 * The weapon riders on this creature that have something to say about a swing
 * with **this** weapon.
 *
 * One gatherer, three readers — the flat bonus on the attack roll
 * ({@link standingBonuses}), the same bonus on the damage roll
 * ({@link standingAttackDamage}), and the die and ability
 * ({@link strikeStyleFor}). Emptying it fails a test of each, which is the
 * evidence it is one question asked in three places rather than three
 * questions spelled alike.
 *
 * **Matched off the weapon record the swing resolved**, never off a caller's
 * `withItem`: the record is what a Versatile die and a reach are already read
 * from, and a swing with no weapon at all — an Unarmed Strike, a spell attack
 * — is a swing with no imbued object in it.
 */
export function weaponRidersFor(
  creature: CreatureState | undefined,
  weapon: Weapon | null,
): readonly GrantedWeaponRider[] {
  if (creature === undefined) return [];
  // **A swing with no weapon in it is an Unarmed Strike**, and the riders that
  // answer for it are the ones that say so — SRD Alter Self's claws. Every
  // rider keyed to an object answers only for that object.
  if (weapon === null) return creature.weaponRiders.filter((rider) => rider.unarmed === true);
  return creature.weaponRiders.filter((rider) => {
    if (rider.weapon !== weapon.id) return false;
    // SRD Shillelagh: "melee attacks using that weapon". A Dagger thrown is a
    // ranged attack with a melee weapon, and the sentence does not reach it —
    // but nothing here knows whether it was thrown, so the weapon's own kind
    // is what is asked. The narrower fact lives on `AttackOptions.thrown` and
    // reaches neither of this function's three readers.
    if (rider.meleeOnly === true && weapon.kind !== 'melee') return false;
    return true;
  });
}

/**
 * Whether an imbuing has trained this creature in the weapon in hand.
 *
 * SRD Pact of the Blade: "Until the bond ends, you have proficiency with the
 * weapon." The fourth reader of {@link weaponRidersFor}, and the one that
 * answers a question the sheet cannot: proficiency on the sheet is a list of
 * *categories*, and this is one object.
 *
 * `false` is the answer for everybody, which is what makes joining it to
 * `proficientWith` safe: a swing with no weapon, with no rider, or with a
 * rider that trains nobody is exactly as proficient as it always was.
 */
export function weaponRiderProficiency(
  creature: CreatureState | undefined,
  weapon: Weapon | null,
): boolean {
  return weaponRidersFor(creature, weapon).some((rider) => rider.proficient === true);
}

/**
 * Compose a Speed out of its parts, in the order the architect fixed.
 *
 * **The SRD prints no order**, and the order is observable, so it is decided
 * once here rather than by whichever caller happens to be looking:
 *
 * > base, plus the flat changes, then **doubled once** if any doubling effect
 * > applies, then **halved once** if any halving effect applies, then **0** if
 * > any zeroing effect applies, never below 0.
 *
 * Doubling is presence and not count, exactly as halving is, and it comes
 * **before** the halving: SRD Slow cast over SRD Haste brings a creature back
 * to the Speed it walked at, which is the answer a table expects of two spells
 * that undo each other, and the other order rounds a 25-foot Speed down to 12
 * before doubling it to 24. The SRD prints no order for the pair, so it is
 * decided here and nowhere else.
 *
 * Halving is presence and not count — the reading Resistance and Advantage
 * already take, so two halvings are one halving. Zero is last and **wins**,
 * because SRD Grappled and Restrained both print "Your Speed is 0 **and can't
 * increase**": a flat bonus applied afterwards would hand a pinned creature
 * ten feet the rules had already taken away.
 *
 * `conditionSpeed` is folded in whole rather than reimplemented, and it
 * carries two of the three steps at once — Exhaustion's "reduced by a number
 * of feet equal to 5 times your Exhaustion level" is a flat change, and the
 * five pinning conditions are the zero. That puts its zero *before* the
 * halving rather than after, and the two orders are the same function:
 * halving 0 is 0, and no flat change follows either. So the arithmetic is
 * identical for every input and there is one implementation of the condition
 * rules rather than two.
 *
 * @param halvings how many halving effects apply; any number above zero halves
 *   once. IE-033's `speed` grant is the producer: SRD Slow's "An affected
 *   target's Speed is halved" is the sentence, and no *registered* definition
 *   writes it yet — Slow is blocked on two other shapes — so the branch is
 *   still reached the way `restoreOn`'s Short Rest branch is, by handing this
 *   pure function the case, as well as through a hand-written grant.
 * @param zeroed whether any zeroing effect applies. **Last, and it wins**, for
 *   the reason above: a flat change applied afterwards would hand a pinned
 *   creature feet the rules had already taken away. It is a boolean rather
 *   than a count because presence is all the SRD asks — two castings of
 *   Hypnotic Pattern on one goblin are one Speed of 0.
 * @param doublings how many doubling effects apply; any number above zero
 *   doubles once. SRD Haste's "the target's Speed is doubled" is the sentence
 *   and the only one in the book. **Appended rather than placed where it
 *   applies**, which is between the flat changes and the halving: the order
 *   is the docstring's and the parameter list's job is not to re-tell it, and
 *   a position in the middle would move a dozen call sites that pass no
 *   doubling at all. The reading `applyConditionTo`'s appended parameters
 *   already take.
 */
export function combineSpeed(
  base: number,
  flat: number,
  halvings: number,
  zeroed: boolean,
  conditions: ConditionState,
  doublings = 0,
): number {
  const flattened = conditionSpeed(conditions, base + flat);
  const doubled = doublings > 0 ? flattened * 2 : flattened;
  const halved = halvings > 0 ? Math.floor(doubled / 2) : doubled;
  return zeroed ? 0 : Math.max(0, halved);
}

/**
 * What every persistent area this creature is standing in is doing to it.
 *
 * The casting's half of {@link standingFor}, and the same discipline: a
 * casting's area reaches whoever the geometry catches *right now*, so it is
 * asked of the scene on every read and stored on nobody. See
 * {@link AreaStanding} for why a stored copy would be two facts that can
 * disagree.
 *
 * Read in casting-id order, which is the order `Object.keys` gives a record
 * the fold sorts, so two readers of one state agree. Nothing here depends on
 * the order today — halving is presence and a flat change is addition — and it
 * is fixed anyway, because a reader that reports *which* casting is slowing a
 * creature would.
 *
 * Empty when there is no scene: where a creature is standing has no right
 * answer until somebody says, and inventing one to halve a Speed is the wrong
 * direction to guess in — the reading an aura already takes for an unplaced
 * creature.
 *
 * **The casting's spell name travels with each clause**, because one of the
 * readers needs it and none of them should look it up: SRD's "when two or more
 * game features have the same name, only the effects of one of them — the most
 * potent — apply" is what decides two Pass without Traces over one Rogue, and
 * the name is the only fact that answers it. It is the *pinned* display name
 * off the record, so the fold's rule holds here too and no reader opens a
 * catalogue.
 */
export function areaStandingOn(
  state: GameState,
  who: CharacterId,
): readonly {
  readonly spell: string;
  readonly standing: AreaStanding;
  /**
   * Whom the geometry caught for **this** clause, for the one narrowing that
   * asks about a second creature: {@link AreaSide.attackerInside}.
   *
   * Handed over rather than re-derived, because it has already been computed
   * here under exactly the reading this clause was measured with — ordinary or
   * wholly inside — and a reader that asked the lattice again would be a second
   * answer to one question.
   */
  readonly inside: ReadonlySet<CharacterId>;
}[] {
  const scene = state.scene;
  if (scene === null) return [];

  const found: {
    spell: string;
    standing: AreaStanding;
    inside: ReadonlySet<CharacterId>;
  }[] = [];
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    const standings = record?.areaStanding;
    if (record === undefined || standings === undefined) continue;

    // The two readings, asked at most once each and only when a clause of this
    // casting prints the second: SRD Silence deafens whoever is *entirely*
    // inside and forbids a Verbal casting merely there, so one record answers
    // both questions about one Sphere.
    let ordinary: ReadonlySet<CharacterId> | null | undefined;
    let wholly: ReadonlySet<CharacterId> | null | undefined;
    for (const standing of standings) {
      let inside: ReadonlySet<CharacterId> | null;
      if ((standing as WhollyInside).whollyInside === true) {
        wholly ??= creaturesStandingInCastingArea(scene, record, { whollyInside: true });
        inside = wholly;
      } else {
        ordinary ??= creaturesStandingInCastingArea(scene, record);
        inside = ordinary;
      }
      if (inside === null) continue;
      // SRD Magic Circle's reverse, "protecting targets outside it": the
      // complement of the catch, over placed creatures only — a creature nobody
      // has placed is nowhere, and nowhere is not outside. See {@link AreaSide}.
      const reaches =
        (standing as AreaSide).outside === true
          ? !inside.has(who) && positionOf(scene, who) !== null
          : inside.has(who);
      if (!reaches) continue;
      found.push({ spell: record.spell, standing, inside });
    }
  }
  return found;
}

/**
 * The flat bonuses a creature has for standing where it is standing.
 *
 * {@link standingBonuses}' third sibling, and the one whose reach is a
 * *place*: that one gathers what an item or a feature grants while a
 * requirement holds, `standingCheckBonuses` gathers the ability-sized plus a
 * feature names two skills for, and this gathers what an area a creature is
 * inside is doing to its checks. All three are derived on every read, and this
 * one changes when anybody walks.
 *
 * **Keyed by the spell's name for the SRD's own reason**: "when two or more
 * game features have the same name, only the effects of one of them — the most
 * potent — apply while the durations of the effects overlap." Two Pass without
 * Traces over one Rogue are +10. "Most potent" is read as the larger number,
 * which is the reading {@link standingBonuses} already takes and leaves a
 * penalty unsettled in exactly the same way.
 *
 * The narrowing is `bonusesFor`'s and is read the same way: every filter the
 * clause names must be matched by a fact the roll supplied, so a caller with no
 * skill to name gets only the clauses that name none either.
 */
export function areaBonuses(
  state: GameState,
  who: CharacterId,
  applies: 'ability-check',
  of?: BonusNarrowing,
): readonly Bonus[] {
  const best = new Map<string, Bonus>();
  for (const { spell, standing } of areaStandingOn(state, who)) {
    if (standing.kind !== 'bonus' || standing.applies !== applies) continue;
    if (!narrowingReaches(standing.only, of)) continue;
    const current = best.get(spell);
    if (current === undefined || (current.flat ?? 0) < standing.flat) {
      best.set(spell, { source: spell, flat: standing.flat });
    }
  }
  return [...best.values()];
}

/**
 * Whether a narrowed area clause reaches the roll asking.
 *
 * `bonusesFor`'s `reaches`, which is not exported and is deliberately not made
 * so: that one is a private rule of a function about a *stored* bonus, and
 * this is the same sentence read off a clause that was never stored. Both say
 * an unanswered filter withholds, which is the direction that cannot be wrong
 * twice — a bonus narrowed to Stealth that reached a check nobody named a
 * skill for would be the unnarrowed bonus back again.
 */
function narrowingReaches(only: BonusNarrowing | undefined, of: BonusNarrowing | undefined): boolean {
  if (only === undefined) return true;
  if (only.ability !== undefined && only.ability !== of?.ability) return false;
  if (only.skill !== undefined && only.skill !== of?.skill) return false;
  return true;
}

/**
 * Damage types an area a creature is standing in resists, or does not.
 *
 * {@link standingDefenses}' twin on the other axis, gathered into
 * {@link defensesOf} beside it: that one reads what a feature grants while a
 * requirement holds, this what a place grants while a creature is in it. SRD
 * Silence writes the only sentence — "Any creature or object entirely inside
 * the Sphere has Immunity to Thunder damage" — and the union is the whole of
 * the arithmetic, because "multiple instances of Resistance to the same damage
 * type count as only one".
 */
function areaDefenses(
  state: GameState,
  who: CharacterId,
): readonly { readonly type: string; readonly defense: DefenseKind }[] {
  const found: { type: string; defense: DefenseKind }[] = [];
  for (const { standing } of areaStandingOn(state, who)) {
    if (standing.kind !== 'damage-defense') continue;
    for (const type of standing.damageTypes) {
      found.push({ type: type.toLowerCase(), defense: standing.defense });
    }
  }
  return found;
}

/**
 * Conditions a creature has for standing where it is standing.
 *
 * SRD Silence: "creatures have the Deafened condition **while entirely inside
 * it**." Gathered into {@link effectiveConditions} — the one door every reader
 * of a condition's effects already goes through — rather than applied, so no
 * `condition-applied` is written and there is nothing to take back: the cause
 * is the creature's position, which no event records, and a stored pair would
 * be two facts that can disagree the first time something moves a creature
 * without remembering.
 *
 * **The instance is sourced on the spell's pinned name rather than on the
 * casting**, so two Spheres over one goblin are one instance and not two. That
 * is the same reading the bonus beside it takes and for the SRD's own reason —
 * "when two or more game features have the same name, only the effects of one
 * of them applies" — and it costs nothing either way, because a condition is a
 * set: a goblin standing in two Silences is Deafened exactly once whichever
 * spelling is used. The name is what a log reader recognises; a casting id
 * would put two indistinguishable instances on a creature to say one thing.
 */
function areaConditionsOn(
  state: GameState,
  who: CharacterId,
): readonly { readonly condition: ConditionName; readonly source: string }[] {
  const found: { condition: ConditionName; source: string }[] = [];
  for (const { spell, standing } of areaStandingOn(state, who)) {
    if (standing.kind !== 'condition') continue;
    found.push({ condition: standing.condition, source: spell });
  }
  return found;
}

/**
 * Whether an area this creature is standing in forbids a Verbal casting.
 *
 * SRD Silence: "Casting a spell that includes a Verbal component is impossible
 * there." The name of the casting's spell, so the refusal can say what stopped
 * the caster; null when nothing does.
 *
 * **"There", and not "entirely inside"** — the same paragraph writes both and
 * this clause is the one that does not narrow. See
 * {@link AreaSilenceStanding}.
 */
export function silencedBy(state: GameState, who: CharacterId): string | null {
  for (const { spell, standing } of areaStandingOn(state, who)) {
    if (standing.kind === 'no-verbal-casting') return spell;
  }
  return null;
}

/**
 * Whether a creature is in gaseous form.
 *
 * SRD Gaseous Form: "the target's only method of movement is a Fly Speed of 10
 * feet, and it can hover." That is the mark — a granted Fly Speed that
 * replaces every other (`change: 'only'`) and hovers — and this reads the
 * pair rather than a spell's name, so SRD Wind Wall's "creatures in gaseous
 * form can't pass through it" finds the creature without either spell knowing
 * the other exists. A Fly spell's granted Speed hovers and replaces nothing,
 * and is not this.
 */
export function isGaseousOn(state: GameState, who: CharacterId): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  return creature.speedModifiers.some(
    (granted) => granted.mode === 'fly' && granted.hover === true && granted.change === 'only',
  );
}

/** One barrier standing against a creature: where it stands and what it forbids. */
export interface BarrierAgainst {
  readonly castingId: string;
  /** The casting's pinned display name, for the refusal. */
  readonly spell: string;
  /** The area, in the vocabulary the lattice answers about. */
  readonly region: TerrainRegion;
  readonly crossing: 'in' | 'out' | 'either';
  /**
   * SRD Magic Circle's "it must first succeed on a Charisma saving throw", at
   * the DC the casting pinned. Absent for a barrier no teleport may cross at
   * all — and for one a teleport passes freely, because a teleport crosses
   * nothing: see {@link AreaBarrierStanding}.
   */
  readonly saveToCross?: { readonly ability: Ability; readonly dc: number };
}

/**
 * Every barrier that stands against this creature right now.
 *
 * The casting's half of a question `resolveMove` and `teleportTo` ask, derived
 * on every read for {@link AreaStanding}'s reason: which barriers bar a goblin
 * depends on what the goblin is and how it is moving, and the list the casting
 * pinned of who was inside at the cast. The geometry — which step crosses which
 * boundary — is the caller's, asked of the region returned here.
 *
 * `flying` is whether the move is being made with a Fly Speed, which is what
 * SRD Wind Wall's "flying creatures" means for a step; a teleport says `false`,
 * because nobody flies through a Misty Step.
 */
export function barriersAgainst(
  state: GameState,
  who: CharacterId,
  movement: { readonly flying: boolean },
): readonly BarrierAgainst[] {
  const scene = state.scene;
  if (scene === null) return [];
  const creature = state.creatures[who];
  if (creature === undefined) return [];

  const found: BarrierAgainst[] = [];
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record?.areaStanding === undefined) continue;
    const region = regionOfCastingArea(record);
    if (region === null) continue;
    for (const standing of record.areaStanding) {
      if (standing.kind !== 'bars-passage') continue;
      // SRD Tiny Hut: "Creatures and objects within the Emanation when you cast
      // the spell can move through it freely" — the list the cast pinned.
      if (
        standing.except === 'inside-at-the-cast' &&
        (record.insideAtTheCast ?? []).includes(who)
      ) {
        continue;
      }
      if (!barsCreature(standing.to, state, scene, creature, movement)) continue;
      found.push({
        castingId,
        spell: record.spell,
        region,
        crossing: standing.crossing,
        ...(standing.saveToCross === undefined
          ? {}
          : { saveToCross: { ability: standing.saveToCross, dc: record.numbers.saveDc } }),
      });
    }
  }
  return found;
}

/** Whether a barrier's `to` names this creature, moving this way. */
function barsCreature(
  to: BarredCreatures,
  state: GameState,
  scene: PositionState,
  creature: CreatureState,
  movement: { readonly flying: boolean },
): boolean {
  if (to === 'all') return true;
  if (to === 'gaseous') return isGaseousOn(state, creature.id);
  if ('types' in to) {
    // A ward is a spell, so it reads the type through the Mask; `'stated'` on
    // a record is a list nobody filled and names nobody.
    if (to.types === 'stated') return false;
    const seen = typeMagicSees(creature);
    return seen !== null && to.types.includes(seen);
  }
  return movement.flying && sizeAtMost(sizeOf(scene, creature.id) ?? 'medium', to.sizeAtMost);
}

/**
 * The ward a casting of this level would cross between a caster and a target
 * or a point, or null.
 *
 * SRD Tiny Hut: "Spells of level 3 or lower can't be cast through it." A ward
 * stops a casting whose two ends are on different sides of its boundary; the
 * caster inside and the goblin inside is no crossing, and so is both outside.
 * A caster or a target nobody has placed is on no side, and the ward does not
 * bite — the withholding direction every unsettled fact here takes. See
 * {@link AreaWardStanding}.
 */
export function wardBetween(
  state: GameState,
  caster: CharacterId,
  other: CharacterId | Point,
  level: number,
): string | null {
  const scene = state.scene;
  if (scene === null || positionOf(scene, caster) === null) return null;

  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    const ward = record?.areaStanding?.find((standing) => standing.kind === 'wards-magic');
    if (record === undefined || ward === undefined || ward.kind !== 'wards-magic') continue;
    if (ward.maxLevel < level) continue;

    const inside = creaturesStandingInCastingArea(scene, record);
    if (inside === null) continue;
    let otherInside: boolean;
    if (typeof other === 'string') {
      if (positionOf(scene, other) === null) continue;
      otherInside = inside.has(other);
    } else {
      const region = regionOfCastingArea(record);
      if (region === null) continue;
      otherInside = spaceInRegion(scene, region, other);
    }
    if (inside.has(caster) !== otherInside) return record.spell;
  }
  return null;
}

/**
 * Every running area that deflects projectiles, with where it stands.
 *
 * SRD Wind Wall's sentence, gathered for `resolveAttack` to draw the line from
 * attacker to target across. The geometry is the caller's, off the region.
 */
export function deflectingAreas(
  state: GameState,
): readonly { readonly spell: string; readonly region: TerrainRegion }[] {
  const found: { spell: string; region: TerrainRegion }[] = [];
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record?.areaStanding?.some((standing) => standing.kind === 'deflects-projectiles') !== true) {
      continue;
    }
    const region = regionOfCastingArea(record);
    if (region !== null) found.push({ spell: record.spell, region });
  }
  return found;
}

/**
 * The modes an area the **target** stands in puts on an attacker's roll.
 *
 * SRD Magic Circle: "The creature has Disadvantage on attack rolls against
 * targets within the Cylinder." Gathered into `defendingModes` beside the modes
 * the target holds, and narrowed by the attacker's type the way
 * `RollSelector.attackerType` is — through `typeMagicSees`, a roller nobody has
 * typed being in no list. `'stated'` on a record names nobody.
 */
export function areaAttackModesAgainst(
  state: GameState,
  target: CharacterId,
  attacker: CharacterId,
): readonly ModeSource[] {
  const swinger = state.creatures[attacker];
  const type = swinger === undefined ? null : typeMagicSees(swinger);
  const modes: ModeSource[] = [];
  for (const { spell, standing, inside } of areaStandingOn(state, target)) {
    if (standing.kind !== 'attack-mode') continue;
    const types = standing.attackerType;
    if (types !== undefined && (types === 'stated' || type === null || !types.includes(type))) {
      continue;
    }
    // SRD Magic Circle's reverse, read whole: the creature the sentence is
    // about is the one the circle is penning in, so a Fiend outside a reversed
    // circle is nothing to do with it. See {@link AreaSide.attackerInside}.
    if (standing.attackerInside === true && !inside.has(attacker)) continue;
    modes.push({ source: spell, mode: standing.mode });
  }
  return modes;
}

/**
 * A creature's Speed, with whatever is currently moving it.
 *
 * **The one reader.** `spendMovement`'s cap, a Dash's increase, a mounting cost
 * and a readied move's allowance were three different spellings of this
 * question — one of them reaching for `sheet.baseSpeed`, one for the pinned
 * `combatant.speed`, all three passing whichever they found to
 * `conditionSpeed` — and **none of them could see a class feature**, which is
 * why a Barbarian's Fast Movement said in its own note that "Speed comes from
 * the species and nothing modifies it". It is `armorClassOf`'s shape exactly:
 * a derived number the rules are measured against, gathered in one place.
 *
 * **The base is the pinned `combatant.speed` while a fight is running**, and
 * `sheet.baseSpeed` outside one — two bases for one reader, which is harmless
 * today because `startCombat` is given the sheet's own number and is written
 * down rather than left to be discovered. `Combatant.speed` reaching
 * `combat-started` is what makes it the base inside a fight: it is in both
 * frozen logs, so a replay measures against the Speed that fight began with.
 *
 * **Feature grants are derived on every read**, like every other standing
 * effect: whether a Monk is unarmoured changes the moment they put a Shield
 * down, and a stored copy would be an unconditional bonus wearing a feature's
 * name. They are gathered from the creature's **own** sheet rather than
 * through `standingFor`, and that is a rule rather than an optimisation: no
 * SRD feature grants Speed to anybody else, and `standingFor` evaluates every
 * effect's requirements — including Dodge's `has-speed`, which asks this
 * function. Reading only `speed` grants is what keeps that from recursing.
 *
 * **A spell moves a Speed through here too, and through nowhere else.**
 * `CreatureState.speedModifiers` is the fifth sourced grant and it joins the
 * same three accumulators a feature's grant already fed, which is the whole
 * point of there being one reader: Longstrider's ten feet reach the movement
 * allowance, the Dash and the mounting cost together rather than three times
 * over, and Hypnotic Pattern's Speed of 0 arrives at the same comparison
 * Grappled already arrives at.
 *
 * **An area a spell filled moves a Speed through here too, and is the one
 * input that is neither on the sheet nor on the creature.** SRD Spirit
 * Guardians halves a Speed *in the Emanation*, and which creatures that is
 * changes every time anybody walks — so it is derived from the scene on every
 * read rather than granted and released. See {@link areaStandingOn}, and
 * {@link AreaStanding} for why the pair of events the other spelling would
 * need is the wrong shape.
 *
 * **An item's grant is not read here, and that is a decision rather than an
 * omission.** `standingFor` gathers what a magic item grants; this function
 * deliberately reads the creature's own sheet alone, because it is the
 * function `has-speed` asks — so a Speed granted by an item would be a
 * question asked of its own answer the moment one carried both clauses. Until
 * somebody settles that, `checkContent` refuses a `speed` grant on an item by
 * name rather than accepting one nothing reads.
 *
 * **The two kinds of grant are gathered differently on purpose.** A feature's
 * is derived on every read, because whether a Monk is unarmoured changes the
 * moment they put a Shield down; a spell's is *stored*, because a casting
 * started at a moment somebody can write down and ends at another. So one is
 * filtered by `meetsRequirements` and the other is not — a stored grant whose
 * requirement was re-evaluated would be a second answer to when it ends.
 *
 * **And it answers for a mode.** SRD prints five Speeds; this reader held one,
 * so a Cockatrice's Fly Speed of 40 had nowhere to be asked for and every
 * caller measuring a flight got a walk. `mode` defaults to `'walk'`, which is
 * every existing caller and every rule that says "your Speed" without
 * qualifying it. What differs between the modes is written inside, in one
 * place, for the reason the whole function exists.
 */
export function speedOf(
  state: GameState,
  who: CharacterId,
  mode: MovementMode = 'walk',
): number {
  const creature = state.creatures[who];
  if (creature === undefined) return 0;

  // **The walking Speed is the pinned one; the other four are the sheet's.**
  // `Combatant.speed` is what the fight began with and it is a walking Speed —
  // `startCombat` is handed `sheet.baseSpeed` — so reading it for a Fly Speed
  // would measure a flight against a walk.
  const walking =
    state.combat?.order.find((c) => c.id === who)?.speed ?? creature.sheet.baseSpeed;

  // **A Speed that is the creature's *only* method of movement, read before
  // everything below.** SRD Gaseous Form: "the target's only method of
  // movement is a Fly Speed of 10 feet." Every other mode is 0 and stays 0 —
  // an unqualified Longstrider reaching a walking Speed the spell has taken
  // away is not a sentence the book prints — and the mode it names takes its
  // feet as the base, so the reductions below still reach it: a Slowed cloud
  // drifts at five.
  const only = onlyMovement(creature);
  if (only !== null && (only.mode ?? 'walk') !== mode) return 0;

  // **A mode nothing gives this creature is 0, and stays 0 through everything
  // below**: nothing adds a Fly Speed to a creature that has none, and
  // {@link hasSpeedInModeOn} is the question a rule asks when it needs to tell
  // "cannot" from "stopped". It is the *state-level* question now, because a
  // casting can hand one over — a Spider Climb's Climb Speed is not on the
  // sheet and the sheet is not where it belongs.
  if (mode !== 'walk' && !hasSpeedInModeOn(state, who, mode)) return 0;

  // A `match-walk` grant supplies the base rather than adding to it, and the
  // base it supplies is the **walking** one before anything has happened to
  // it: see {@link SpeedChange}, where the alternative halves a Slowed
  // spider's climb twice.
  const matched = matchesWalkingSpeed(state, who, creature, mode);
  const base =
    only !== null
      ? (only.feet ?? 0)
      : mode === 'walk'
        ? walking
        : Math.max(speedInMode(creature.sheet, mode), matched ? walking : 0);

  // **Feet reach the mode they were granted in; an unqualified increase
  // reaches walking alone and an unqualified reduction reaches every mode.**
  // Judged grant by grant rather than netted afterwards, which is what the
  // sign split here is for: a Longstrider and a Ray of Frost on one creature
  // are two sentences, and cancelling them into a net of zero would quietly
  // hand a flier back the ten feet the ice took. See the note below the loops
  // for the ruling the sign carries.
  let flat = 0;
  const flattenInMode = (granted: {
    readonly feet?: number;
    readonly mode?: MovementMode;
  }): void => {
    const feet = granted.feet ?? 0;
    if ((granted.mode ?? 'walk') === mode) flat += feet;
    else if (granted.mode === undefined && feet < 0) flat += feet;
  };

  for (const effect of creature.sheet.standing ?? []) {
    if (effect.grant.kind !== 'speed') continue;
    if ((effect.grant.change ?? 'add') !== 'add') continue;
    if (!meetsRequirements(state, who, effect)) continue;
    flattenInMode(effect.grant);
  }

  let halvings = 0;
  let doublings = 0;
  let zeroed = false;
  for (const granted of creature.speedModifiers) {
    if (granted.change === 'add') flattenInMode(granted);
    // **A doubling is an increase, so it is the walking Speed's**, which is
    // the ruling written below about the flat accumulator's sign and read
    // here rather than a second time: SRD writes "your Speed" unqualified for
    // what *gives* Speed and means walking, and SRD Haste is that sentence
    // multiplied. A hasted Cockatrice walks at twice the pace and flies at
    // the pace it always did.
    else if (granted.change === 'double') {
      if (mode === 'walk') doublings += 1;
    } else if (granted.change === 'halve') halvings += 1;
    else if (granted.change === 'zero') zeroed = true;
  }

  // An area carries no mode — SRD Spirit Guardians halves a Speed rather than
  // granting one — so its flat changes are read exactly as an unqualified
  // grant's are.
  //
  // **Each member is named**, which is the loop above's discipline and is why
  // it has it. `AreaStanding.change` used to be {@link SpeedChange} whole, so
  // widening that union for "a Climb Speed equal to its Speed" widened this
  // field with it and a trailing `else` here read the new member as a Speed of
  // 0. The type is narrowed now, so nothing typed can arrive; naming the
  // members is what makes a *later* widening ignore what it cannot compute
  // rather than zero somebody's Speed.
  for (const { standing } of areaStandingOn(state, who)) {
    if (standing.kind !== 'speed') continue;
    if (standing.change === 'add') flattenInMode({ feet: standing.feet ?? 0 });
    else if (standing.change === 'halve') halvings += 1;
    else if (standing.change === 'zero') zeroed = true;
  }
  // `double` is deliberately absent from that loop and from the type it reads
  // — see {@link AreaSpeedStanding.change}.

  // **An increase is the walking Speed's; everything that takes Speed away is
  // every mode's.** SRD writes "your Speed" unqualified for the walking one —
  // Longstrider's ten feet and a Barbarian's Fast Movement are both that
  // sentence — so adding them to a Fly Speed would be reading a rule the book
  // does not print. Slowing is the other way round, and all four spellings of
  // it agree: Grappled's "Speed is 0", Slow's halving, Exhaustion's five feet
  // a level and Ray of Frost's flat ten are about the creature rather than
  // about a mode. A Restrained Cockatrice does not fly away at half speed,
  // and a Specter iced by Ray of Frost does not fly away at full.
  //
  // So the flat accumulator is split by sign rather than by source, which is
  // the only line here that is a ruling rather than a transcription: the book
  // prints no sentence reducing one mode and not another, and the alternative
  // — reductions that miss every mode but walking — leaves a creature whose
  // Speed is *mostly* a Fly Speed untouched by half the rules that slow
  // anybody. Exhaustion already behaved this way through `conditionSpeed`,
  // and this is the rest of the family joining it rather than an exception
  // being carved.
  //
  // What a *mode-named* grant does is not that ruling and needs none: SRD Fly
  // prints "a Fly Speed of 60 feet", so the feet go where the sentence says
  // and nowhere else.
  return combineSpeed(base, flat, halvings, zeroed, creature.conditions, doublings);
}

/**
 * The grant that says this creature's Speed in one mode is the whole of how it
 * moves, or null where none does.
 *
 * SRD Gaseous Form is the only writer, and the **first** of them wins where a
 * log somehow holds two: a second sentence of this shape would be two answers
 * to one question, and taking the earliest is the reading `speedModifiers`'
 * own order already gives — the store is keyed by source and sorted, so two
 * readers of one state agree.
 *
 * A stored grant only. The derived half — a feature's `StandingGrant` — has no
 * writer for this operation: no class feature in the SRD replaces a creature's
 * movement with one mode, and a shape that could be written and never read is
 * the thing `docs/design/spell-definitions.md` refuses by name.
 */
function onlyMovement(creature: CreatureState): GrantedSpeed | null {
  return creature.speedModifiers.find((granted) => granted.change === 'only') ?? null;
}

/**
 * Whether any grant on this creature says its Speed in a mode is its walking
 * Speed.
 *
 * Both doors at once, because SRD writes one sentence and two catalogues
 * carry it: Spider Climb's casting is a stored {@link GrantedSpeed} and
 * Second-Story Work's is a derived {@link StandingGrant}, and a reader that
 * knew only one of them would be right about half the book.
 */
function matchesWalkingSpeed(
  state: GameState,
  who: CharacterId,
  creature: CreatureState,
  mode: MovementMode,
): boolean {
  if (mode === 'walk') return false;
  if (creature.speedModifiers.some((g) => g.change === 'match-walk' && g.mode === mode)) {
    return true;
  }
  return (creature.sheet.standing ?? []).some(
    (effect) =>
      effect.grant.kind === 'speed' &&
      effect.grant.change === 'match-walk' &&
      effect.grant.mode === mode &&
      meetsRequirements(state, who, effect),
  );
}

/**
 * Whether this creature has a Speed of this kind **at all**, granted or
 * printed.
 *
 * {@link hasSpeedInMode} is the sheet-level question and it is still the right
 * one where the sheet is the whole answer — `adaptMonster` puts a Cockatrice's
 * Fly Speed there. This is the state-level sibling the reader half asked for
 * when it wrote "a spell cannot grant a mode yet": once one can, "has a Climb
 * Speed" is a fact about the creature *and everything currently on it*, and a
 * rule that asked the sheet would charge a Spider Climb's target the climbing
 * surcharge for a Speed it had just been given.
 *
 * **Having and having any left are still two questions**, which is the whole
 * reason the sheet-level one exists: a Restrained fish has a Swim Speed of 0
 * without having stopped being a fish, and a Grappled spider under Spider
 * Climb has a Climb Speed of 0 without the casting having ended. So this asks
 * what grants *say*, never what {@link speedOf} computes — a zeroing
 * condition does not take a mode away, it stops it.
 */
export function hasSpeedInModeOn(state: GameState, who: CharacterId, mode: MovementMode): boolean {
  if (mode === 'walk') return true;
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (hasSpeedInMode(creature.sheet, mode)) return true;
  if (matchesWalkingSpeed(state, who, creature, mode)) return true;

  if (
    creature.speedModifiers.some(
      (g) =>
        (g.change === 'add' || g.change === 'only') && g.mode === mode && (g.feet ?? 0) > 0,
    )
  ) {
    return true;
  }
  return (creature.sheet.standing ?? []).some(
    (effect) =>
      effect.grant.kind === 'speed' &&
      (effect.grant.change ?? 'add') === 'add' &&
      effect.grant.mode === mode &&
      (effect.grant.feet ?? 0) > 0 &&
      meetsRequirements(state, who, effect),
  );
}

/**
 * SRD "Flying": "the creature falls unless it has the Hover trait", asked of
 * the creature rather than of its sheet.
 *
 * {@link fliesWithoutFalling}'s state-level sibling, and it exists for the
 * same reason {@link hasSpeedInModeOn} does: SRD Fly hands over a Fly Speed
 * **and** the hovering in one sentence, and neither half is on the sheet. A
 * printed Hover and a granted one are the same trait, so either answers.
 */
export function fliesWithoutFallingOn(state: GameState, who: CharacterId): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  if (!hasSpeedInModeOn(state, who, 'fly')) return false;
  if (creature.sheet.speeds?.hover === true) return true;
  return creature.speedModifiers.some((g) => g.hover === true && g.mode === 'fly');
}

/**
 * What is left of a creature's movement this turn, or null outside combat.
 *
 * The `GameState` half of {@link movementLeft}: it looks the allowance up
 * through `speedOf` and hands it to the one function that does the
 * subtraction, so a caller reading a budget never has to know the formula.
 * Null rather than zero when there is no turn to have a budget in — "no
 * allowance" and "none left" are different answers, and the distinction is the
 * one `attacksRemaining` already draws.
 */
export function movementLeftFor(state: GameState, who: CharacterId): number | null {
  const budget = state.combat?.budgets[who];
  if (budget === undefined) return null;
  return movementLeft(budget, speedOf(state, who));
}

/** What an attack was, for deciding which features have anything to say about it. */
export interface AttackContext {
  /** The ability the attack roll actually used. */
  readonly ability: Ability;
  readonly melee: boolean;
  /** Null for an Unarmed Strike, which is not a weapon. */
  readonly weapon: Weapon | null;
  /**
   * The catalogue id of what the attack was made *with*, for the one clause
   * that asks — {@link BonusContext.withItem}, on the damage side.
   *
   * Not `weapon.id`, and the distinction is load-bearing: a magic weapon's
   * `weapon` record is the *mundane row* it is a magical version of, so a
   * Vicious Weapon's record is filed under `longsword` and reading the id off
   * it would hand the die to every longsword in the world. What narrows is the
   * item, and only the command knows which item was swung.
   *
   * Absent reads as a roll made with nothing, exactly as it does for a flat
   * bonus: a caller who does not say withholds the benefit rather than
   * inventing one.
   */
  readonly withItem?: string | null;
  /**
   * How the attack roll came out, after Advantage and Disadvantage cancelled.
   *
   * The *resolved* mode rather than a list of sources, because that is what
   * SRD Sneak Attack asks about: "if you have Advantage on the roll" reads the
   * roll, and a roll with one of each is a normal roll.
   */
  readonly mode: RollMode;
  readonly target: CharacterId;
  /** The turn this attack happens on; null outside combat, where none exists. */
  readonly turn: number | null;
  /**
   * The damage type chosen for each feature that offers a choice, by feature id.
   *
   * Absent for a feature means the holder declined it — SRD writes these as
   * "you can", and there is no other moment at which declining could be said.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
  /**
   * Dice a rider on this blow is **paying with** — SRD Cunning Strike: "You
   * remove the die before rolling."
   *
   * The named feature's `attack-damage` grant rolls this many fewer dice on
   * this blow and no other, and `forgone` reports how many actually came off.
   * Zero is the answer where the feature did not qualify for this hit at all,
   * which is the one question the swing could not ask: the price is a Sneak
   * Attack, and whether a blow is one is a fact about the roll.
   *
   * **Here rather than on the rider's own path**, because this is the loop
   * that decides whether the feature fires. A second reader asking the same
   * qualifications would be a second place for "if you have Advantage on the
   * roll" to be got wrong, and the two could disagree about a blow one of them
   * had already removed a die from.
   */
  readonly forgoing?: { readonly feature: string; readonly dice: number };
}

/**
 * Everything offering this swing a choice of damage type, by the name the
 * choice is made under.
 *
 * Two offerers and one map. A feature's own `attack-damage` grant is keyed by
 * its feature id — SRD Divine Strike's Necrotic or Radiant — and a weapon
 * rider by {@link riderChoiceKey}, which is the spell's name where a casting
 * imbued the weapon and the feature's own id where a use did. One gatherer, so
 * the check at the door and the reader at the damage roll cannot come to
 * disagree about what was on offer.
 *
 * `weapon` narrows the second. An imbuing's offer belongs to the object it was
 * aimed at — SRD Sacred Weapon's "one Melee weapon that you are holding", SRD
 * Shillelagh's "that weapon" — so a Paladin's Shortbow is offered nothing and
 * naming the feature on that swing is a choice nobody made.
 *
 * **There were three, and the third was this sentence written about a *kind*
 * of weapon**: a `weapon-damage-type` standing grant, which is as near as a
 * feature reached before it could name an object. It is gone, and nothing went
 * with it — what it carried is `ImbuedWeapon.damageTypes`, keyed to the one
 * weapon the book keys it to.
 */
function damageTypesOffered(
  state: GameState,
  who: CharacterId,
  weapon: Weapon | null,
): ReadonlyMap<string, readonly string[]> {
  const offered = new Map<string, readonly string[]>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind === 'attack-damage' && effect.grant.damageTypeChoices !== undefined) {
      offered.set(effect.feature, effect.grant.damageTypeChoices);
    }
  }
  for (const rider of weaponRidersFor(state.creatures[who], weapon)) {
    if (rider.damageTypes !== undefined) offered.set(riderChoiceKey(rider), rider.damageTypes);
  }
  return offered;
}

/**
 * The type an offer on this weapon puts on its own damage, or null where
 * nobody took one.
 *
 * SRD Shillelagh: "it can be Force damage **or** the weapon's normal damage
 * type (your choice)". SRD Sacred Weapon prints the same sentence from the
 * other side of the fence: "each time you hit with it, you cause it to deal
 * its normal damage type or Radiant damage." One type or the other, so what
 * comes back *replaces* the weapon's rather than joining it. Naming none is
 * how the offer is declined, which is the reading `featureDamageTypes` already
 * takes of an absent key.
 *
 * **Both writers, read in one walk**, because a swing takes at most one type:
 * the door refuses a blow that answered two, and a blow with two types is one
 * the book gives one. A casting's offer is keyed by the spell's name and a
 * feature's by its own id — {@link riderChoiceKey}, the same key the check at
 * the door gathered under — so the two can never be mistaken for each other.
 *
 * The first offer that was answered wins, and no SRD weapon can carry two: an
 * imbuing replaces its own predecessor at the same source, Shillelagh ends a
 * prior casting of itself, and Magic Weapon offers no type at all. A second
 * would be a sentence the book does not print.
 */
export function weaponRiderDamageType(
  state: GameState,
  who: CharacterId,
  weapon: Weapon | null,
  chosen: Readonly<Record<string, string>> | undefined,
): string | null {
  const riders = weaponRidersFor(state.creatures[who], weapon);
  // **An imposed type first, and it asks nobody.** SRD Alter Self's claws are
  // Slashing on every swing — "instead of dealing the normal damage" — so the
  // type is the rider's, not an offer the swing answers.
  const imposed = riders.find((rider) => rider.damageType !== undefined);
  if (imposed?.damageType !== undefined) return imposed.damageType;
  if (chosen === undefined) return null;
  for (const rider of riders) {
    if (rider.damageTypes === undefined) continue;
    const named = chosen[riderChoiceKey(rider)];
    if (named !== undefined && rider.damageTypes.includes(named)) return named;
  }
  return null;
}

/**
 * Refuse a damage type the feature does not offer, before anything is rolled.
 *
 * A caller may choose between the types the SRD prints and may not invent one:
 * Divine Strike is Necrotic or Radiant, and a Cleric asking for Fire is asking
 * for a rule that does not exist. Checked up front, so a refusal costs neither
 * a die nor the attack.
 *
 * `weapon` is the record the swing resolved, for the reason
 * {@link weaponRidersFor} takes one: a casting's offer belongs to the object
 * it imbued, so naming it on a swing with anything else is a choice nobody
 * offered — the same refusal a feature the holder does not have draws.
 */
export function checkFeatureDamageTypes(
  state: GameState,
  who: CharacterId,
  chosen: Readonly<Record<string, string>> | undefined,
  weapon: Weapon | null = null,
): Result<true> {
  if (chosen === undefined) return ok(true);
  const offered = damageTypesOffered(state, who, weapon);

  for (const [feature, type] of Object.entries(chosen)) {
    const allowed = offered.get(feature);
    if (allowed === undefined) {
      return err('no_such_feature_choice', `${who} has no feature ${feature} that chooses a damage type`);
    }
    if (!allowed.includes(type)) {
      return err(
        'bad_damage_type',
        `${feature} deals ${allowed.join(' or ')} damage, not ${type}`,
      );
    }
  }
  return ok(true);
}

/**
 * Extra damage this creature's features add to an attack that has hit.
 *
 * Split the way `rollAttackDamage` splits it: a *bonus* is damage of the
 * weapon's own type and rides with it through Resistance, while *extra* damage
 * of another type is applied separately. Collapsing the two would give a
 * Barbarian's Rage Damage the wrong answer against a Slashing-resistant
 * target, or a Paladin's Radiant the wrong one.
 *
 * `context.withItem` narrows, exactly as it does in {@link standingBonuses}:
 * an effect that says "this magic weapon" is withheld from every attack made
 * with anything else, including the attacks no object is made with at all.
 */
/**
 * SRD Sneak Attack's second branch, which is the one the engine can only
 * sometimes answer.
 *
 * > "at least one of your allies is within 5 feet of the target, the ally
 * > doesn't have the Incapacitated condition, and you don't have Disadvantage
 * > on the attack roll."
 *
 * Allegiance is **declared**, like cover and sight, and nobody is an ally by
 * default. A table that has not said who is on whose side gets no ally here —
 * which withholds the benefit rather than inventing one, and is reported so
 * the layer above knows the difference between "no ally was near" and "nobody
 * has said".
 */
function adjacentAllyOf(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
): { readonly found: boolean; readonly declared: boolean } {
  const mine = state.creatures[attacker]?.side ?? null;
  if (mine === null || state.scene === null) return { found: false, declared: false };

  for (const id of Object.keys(state.creatures).sort()) {
    if (id === attacker || id === target) continue;
    const other = state.creatures[id];
    if (other === undefined || other.side !== mine || other.vitals.dead) continue;
    if (isIncapacitated(other.conditions)) continue;
    const apart = distanceBetween(state.scene, id as CharacterId, target);
    if (apart.ok && apart.value <= 5) return { found: true, declared: true };
  }
  return { found: false, declared: true };
}

/**
 * Whether this creature's features turn a half-damage Dexterity save into none.
 *
 * Asked of the *target* rather than the caster, which is what makes it a
 * defence: the Rogue standing in the Fireball is the one who evades it.
 */
export function evadesHalfDamage(
  state: GameState,
  who: CharacterId,
  ability: Ability,
  offersHalfOnSuccess: boolean,
): boolean {
  if (ability !== 'dex' || !offersHalfOnSuccess) return false;
  return standingFor(state, who).some(({ effect }) => effect.grant.kind === 'evasion');
}

/**
 * Whether this creature adds its ability modifier to the Light property's
 * extra attack after all.
 *
 * SRD Two-Weapon Fighting, read the way every standing grant is read —
 * **from state, on every read** — so a feat gained at level 4 reaches a
 * character already in a log and an item that conferred it stops the moment
 * it is taken off.
 */
export function addsAbilityToLightExtraAttack(state: GameState, who: CharacterId): boolean {
  return standingFor(state, who).some(
    ({ effect }) => effect.grant.kind === 'light-extra-attack-damage',
  );
}

/** The casting a `casting-damage` grant is being asked about. */
export interface CastingDamageQuery {
  /** The definition's own id, for the feature that names one spell. */
  readonly spell: string;
  readonly school: string;
  /** The class the route went through; null for a feat's grant or an item's. */
  readonly classId: string | null;
  /** Every damage type this casting deals, as the definition and the cast leave it. */
  readonly damageTypes: readonly string[];
  /** The slot's level, and `0` for a cantrip. */
  readonly slotLevel: number;
  /** The features the caster elected on this casting — see `optional`. */
  readonly using: readonly string[];
}

/** One feature reaching into this casting, with the name the log reads it under. */
export interface CastingDamageFeature {
  readonly feature: string;
  readonly name: string;
  readonly when: CastingDamageWhen;
  readonly alters: CastingDamageAlteration;
  readonly costs?: CastingDamageCost;
}

/**
 * Whether one `casting-damage` grant reaches this casting.
 *
 * Every clause is a narrowing and an absent one asks nothing. Kept apart from
 * the gatherer so the rule can be read as five lines rather than found inside a
 * loop — the shape `standingAttackDamage`'s qualifications wear.
 */
function castingReached(when: CastingDamageWhen, query: CastingDamageQuery): boolean {
  if (when.spell !== undefined && when.spell !== query.spell) return false;
  if (when.school !== undefined && when.school !== query.school) return false;
  if (when.classId !== undefined && when.classId !== query.classId) return false;
  if (when.dealsDamage === true && query.damageTypes.length === 0) return false;
  if (
    when.damageTypes !== undefined &&
    !when.damageTypes.some((type) => query.damageTypes.includes(type))
  ) {
    return false;
  }
  if (
    when.slotLevels !== undefined &&
    (query.slotLevel < when.slotLevels.from || query.slotLevel > when.slotLevels.to)
  ) {
    return false;
  }
  return true;
}

/**
 * The caster's features that reach this casting's damage.
 *
 * Asked of the **caster**, which is what makes it the offensive twin of
 * {@link evadesHalfDamage}: the Evoker deciding a cantrip still stings is the
 * one casting it. Derived from standing effects on every read, so a feature
 * suppressed by its own requirement reaches nothing — and an optional one that
 * the caster did not name on this casting reaches nothing either, which is how
 * SRD's "you can" is declined.
 */
export function castingDamageFeatures(
  state: GameState,
  who: CharacterId,
  query: CastingDamageQuery,
): readonly CastingDamageFeature[] {
  const found: CastingDamageFeature[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-damage') continue;
    if (grant.optional === true && !query.using.includes(effect.feature)) continue;
    if (!castingReached(grant.when, query)) continue;
    found.push({
      feature: effect.feature,
      name: effect.name,
      when: grant.when,
      alters: grant.alters,
      ...(grant.costs === undefined ? {} : { costs: grant.costs }),
    });
  }
  return found;
}

/**
 * What the caster's features add to how far this casting reaches, in feet.
 *
 * {@link castingDamageFeatures}' reading one question earlier, and the answer
 * is a list of named bonuses for that gatherer's reason: two features
 * lengthening one casting both land and the log can name each.
 *
 * Asked of the **caster** and derived on every read, so a feature suppressed
 * by its own requirement lengthens nothing. Nothing here decides *whether*
 * there is a distance to lengthen — a range of Self has none, and that is the
 * caller's question because the caller is the one holding the printed range.
 */
export function castingRangeBonus(
  state: GameState,
  who: CharacterId,
  query: CastingDamageQuery,
): readonly Bonus[] {
  const found: Bonus[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-range') continue;
    if (!castingReached(grant.when, query)) continue;
    // Creation pins the **granting class's** level onto a feature's grant. An
    // item's carries none — an item belongs to no class — so it falls back to
    // the holder's own level, which is `fall-damage-reduction`'s reading of
    // the same absence and what keeps a rod that lengthened its bearer's
    // Eldritch Blast from quietly adding nothing.
    const level = grant.classLevel ?? state.creatures[who]?.sheet.level ?? 0;
    const feet = grant.perClassLevel * level;
    if (feet === 0) continue;
    found.push({ source: effect.name, flat: feet });
  }
  return found;
}

/**
 * The riders the caster's own features hang on this casting's hits.
 *
 * {@link castingRangeBonus}'s twin one seam along, and it returns the values
 * rather than a number for the reason that gatherer returns names: two
 * features riding one casting both land, and the caller composes them onto the
 * effect list in the order they were found.
 */
export function castingRiders(
  state: GameState,
  who: CharacterId,
  query: CastingDamageQuery,
): readonly OutcomeRiders[] {
  const found: OutcomeRiders[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-rider') continue;
    if (!castingReached(grant.when, query)) continue;
    found.push(grant.rides);
  }
  return found;
}

/** The casting a `casting-healing` grant is being asked about. */
export interface CastingHealingQuery {
  /**
   * The level of the slot that paid for this casting, or **null** where none
   * did.
   *
   * Null rather than zero, because a cantrip and an item's casting are two
   * different things a level of `0` would spell alike, and the clause this
   * answers is about whether a slot went at all.
   */
  readonly slotLevel: number | null;
}

/**
 * What the caster's features add to the hit points this casting restores.
 *
 * {@link castingDamageFeatures}' twin, and the shape of its answer is a list
 * of named bonuses rather than a single number because two features adding to
 * one casting both land and the log names each — the reading every other
 * gatherer in this file takes.
 *
 * Asked of the **caster** and derived on every read, so a feature suppressed
 * by its own requirement adds nothing. Nothing here is per-target: the same
 * answer reaches every creature the casting heals, which is what SRD's "to a
 * creature ... that creature regains" says when a spell heals several.
 */
export function castingHealingBonus(
  state: GameState,
  who: CharacterId,
  query: CastingHealingQuery,
): readonly Bonus[] {
  const found: Bonus[] = [];
  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'casting-healing') continue;
    if (grant.when.withSlot === true && query.slotLevel === null) continue;

    const flat =
      grant.alters.flat +
      (grant.alters.plusSlotLevel === true ? (query.slotLevel ?? 0) : 0);
    if (flat === 0) continue;
    found.push({ source: effect.name, flat });
  }
  return found;
}

/**
 * Every `casting-damage` feature this creature holds that the caller may elect,
 * whether or not it reaches any particular casting.
 *
 * What a refusal needs: a caller who names a feature this creature has not got
 * is told so, and one who names a feature that simply does not reach the spell
 * they are casting is not refused at all — the grant is a narrowing and casting
 * outside it is legal. The same three-valued discipline every stated fact takes.
 */
export function electableCastingDamage(
  state: GameState,
  who: CharacterId,
): readonly string[] {
  return standingFor(state, who)
    .filter(({ effect }) => effect.grant.kind === 'casting-damage' && effect.grant.optional === true)
    .map(({ effect }) => effect.feature);
}

export function standingAttackDamage(
  state: GameState,
  who: CharacterId,
  context: AttackContext,
): {
  readonly bonuses: readonly Bonus[];
  readonly extra: readonly {
    readonly source: string;
    readonly type: string;
    readonly dice?: string;
    readonly flat?: number;
  }[];
  /** Once-per-turn features this attack spends the allowance of. */
  readonly spent: readonly string[];
  /** Qualifications the engine could not settle from what it holds. */
  readonly unverified: readonly string[];
  /**
   * How many dice {@link AttackContext.forgoing} actually took off this blow.
   *
   * Zero where nothing was asked and zero where the named feature did not
   * qualify for this hit, which are the same answer to the only question the
   * caller has: was the price paid. A rider whose price went unpaid is dropped
   * rather than applied — see {@link HitOption.forgoesDiceOf}.
   */
  readonly forgone: number;
} {
  const bonuses: Bonus[] = [];
  const extra: { source: string; type: string; dice?: string; flat?: number }[] = [];
  const spent: string[] = [];
  const unverified: string[] = [];
  let forgone = 0;

  for (const { effect } of standingFor(state, who)) {
    const grant = effect.grant;
    if (grant.kind !== 'attack-damage') continue;
    // "This magic weapon deals an extra 2d6 damage", and no other weapon does.
    if (grant.onlyWithItem === true && (context.withItem ?? null) !== effect.feature) continue;
    if (grant.usingAbility !== undefined && grant.usingAbility !== context.ability) continue;
    if (grant.meleeOnly === true && !context.melee) continue;
    if (grant.weaponOnly === true && context.weapon === null) continue;
    if (
      grant.finesseOrRangedWeapon === true &&
      !(context.weapon?.properties.includes('finesse') === true ||
        context.weapon?.kind === 'ranged')
    ) {
      continue;
    }
    if (grant.targetMissingHitPoints === true) {
      const victim = state.creatures[context.target];
      if (victim === undefined || victim.vitals.hp >= victim.vitals.hpMax) continue;
    }
    if (grant.advantageOrAdjacentAlly === true && context.mode !== 'advantage') {
      // The second branch. Disadvantage rules it out outright; otherwise it
      // needs an ally the table has placed and named.
      if (context.mode === 'disadvantage') continue;
      const ally = adjacentAllyOf(state, who, context.target);
      if (!ally.found) {
        if (!ally.declared) {
          unverified.push(
            `${effect.name} could also qualify through an ally within 5 feet of ${context.target}; nobody has declared who is on whose side, so it did not`,
          );
        }
        continue;
      }
    }
    // Last, so that a feature ruled out by its own qualifications does not
    // spend an allowance it never used.
    // SRD "you can cause the target to take an extra 1d8 Necrotic or Radiant
    // damage (your choice)": naming no type declines the feature, which is the
    // only moment at which "you can" could be answered.
    let chosenType: string | undefined;
    if (grant.damageTypeChoices !== undefined) {
      chosenType = context.featureDamageTypes?.[effect.feature];
      if (chosenType === undefined || !grant.damageTypeChoices.includes(chosenType)) continue;
    }

    if (grant.oncePerTurn === true && state.combat !== null) {
      if (!canUseFeatureThisTurn(state.combat, who, effect.feature)) continue;
      if (context.turn !== null) spent.push(effect.feature);
    }

    // **The price a rider on this blow is paying, taken off here and only
    // here.** SRD Cunning Strike: "You remove the die before rolling." Last of
    // the qualifications, so a feature that did not fire is never charged for
    // a rider it could not have bought — and the count is reported, because
    // "this feature added nothing to this blow" is the answer the rider's own
    // path needs and cannot derive.
    let dice = grant.dice;
    // **A grant whose every die has been forgone adds nothing at all**, which
    // is narrower than "a component with no dice": a grant that rolls none and
    // adds no flat number is a thing the vocabulary allows and this loop has
    // always written down, so only the emptying is skipped.
    let emptied = false;
    if (context.forgoing !== undefined && context.forgoing.feature === effect.feature) {
      forgone = context.forgoing.dice;
      const left = fewerDice(dice, forgone);
      emptied = dice !== undefined && left === undefined;
      dice = left;
    }
    if (emptied && grant.flat === undefined) continue;

    const type = chosenType ?? grant.damageType;
    if (type === undefined) {
      bonuses.push({
        source: effect.name,
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
        ...(dice === undefined ? {} : { dice }),
      });
    } else {
      extra.push({
        source: effect.name,
        type,
        ...(dice === undefined ? {} : { dice }),
        ...(grant.flat === undefined ? {} : { flat: grant.flat }),
      });
    }
  }

  // **The spell riders, folded in here rather than at the two call sites.**
  // `resolveAttack` and `resolveAttackDamage` both already ask this function
  // what rides a hit, so a rider reaches a swung weapon and a held one with no
  // new call site to forget — which is exactly the fork `defendingModes`
  // closed on the defensive side. The spell-attack path calls
  // {@link grantedAttackRiders} on its own, because it must not take the
  // feature half above.
  // **A rider with no type of its own is of the blow's**, which is where SRD
  // Enlarge/Reduce's "an extra 1d4 damage" goes: beside the bonuses, exactly
  // as an untyped `attack-damage` grant went above, so a Mace under it deals
  // one Bludgeoning total rather than a Bludgeoning and a something else.
  for (const rider of grantedAttackRiders(state.creatures[who], {
    weapon: context.weapon,
    target: context.target,
  })) {
    if (rider.type === undefined) bonuses.push({ source: rider.source, dice: rider.dice });
    else extra.push({ source: rider.source, type: rider.type, dice: rider.dice });
  }

  // **And the damage half of the imbued weapon's plus.** SRD Magic Weapon's +1
  // is of the weapon's **own** type — a Mace under it deals 7 Bludgeoning, not
  // 6 Bludgeoning and 1 of something else — so it is a `bonus` and not one of
  // the typed components beside it. The attack half is `standingBonuses`.
  bonuses.push(...weaponRiderBonuses(state.creatures[who], context.weapon));

  return { bonuses, extra, spent, unverified, forgone };
}

/**
 * A notation with a number of its dice taken away — SRD Cunning Strike's
 * "remove 1d6 from the Sneak Attack's damage before rolling".
 *
 * `undefined` where nothing is left to roll, which is what an absent `dice`
 * already means to every reader of this grant: a component that rolls no dice
 * and adds no flat number is not a component. Everything else the notation
 * says is kept — a homebrew `3d6+2` traded down to `2d6+2` keeps the two, and
 * a kept-highest clause keeps no more dice than are left — and a notation the
 * dice layer cannot read is left exactly as it was rather than guessed at.
 */
function fewerDice(dice: string | undefined, fewer: number): string | undefined {
  if (dice === undefined || fewer <= 0) return dice;
  const parsed = parseNotation(dice);
  if (!parsed.ok) return dice;
  const left = parsed.value.count - fewer;
  if (left <= 0) return undefined;
  const keep = parsed.value.keep;
  const kept =
    keep === null ? '' : `k${keep.mode === 'highest' ? 'h' : 'l'}${Math.min(keep.n, left)}`;
  const modifier =
    parsed.value.modifier === 0
      ? ''
      : `${parsed.value.modifier > 0 ? '+' : '-'}${Math.abs(parsed.value.modifier)}`;
  return `${left}d${parsed.value.sides}${kept}${modifier}`;
}

/**
 * How many dice a named feature's `attack-damage` grant rolls for this
 * creature, or **null** where it holds no such grant.
 *
 * The sheet half of a dice price — SRD Cunning Strike's "the number of Sneak
 * Attack damage dice you must forgo" — asked at the swing, where a refusal
 * costs nothing. It deliberately asks nothing about *this* blow: a creature
 * holds Sneak Attack whether or not this swing will be one, and the
 * qualifications are {@link standingAttackDamage}'s to settle once, later,
 * where the dice are actually gathered.
 *
 * Null and zero are different answers and both are refusals: null is a feature
 * nobody granted, and zero is a grant that rolls a flat number instead.
 */
export function attackDamageDiceOf(
  state: GameState,
  who: CharacterId,
  feature: string,
): number | null {
  for (const { effect } of standingFor(state, who)) {
    if (effect.feature !== feature || effect.grant.kind !== 'attack-damage') continue;
    if (effect.grant.dice === undefined) return 0;
    const parsed = parseNotation(effect.grant.dice);
    return parsed.ok ? parsed.value.count : 0;
  }
  return null;
}

/**
 * This creature's Passive Perception, as the rules read it.
 *
 * SRD: "a passive check ... 10 + all modifiers that normally apply to the
 * check." `passivePerception` on the sheet is the score the sheet alone gives;
 * this is that score with what a running spell has hung on the creature's
 * Wisdom (Perception) checks added — SRD Enthrall's "a −10 penalty to Wisdom
 * (Perception) checks **and Passive Perception**" is one stored bonus read at
 * both ends, which is what keeps the two halves of that sentence from being
 * two answers.
 *
 * **Only the flat part of a bonus reaches a passive score.** A die is not a
 * modifier that "normally applies" to a check nobody rolls — SRD Guidance's
 * 1d4 lands on a check made and on nothing passive — so a dice-only bonus
 * contributes nothing here, and a flat one contributes its sign.
 * Advantage and Disadvantage are the sheet function's own `mode`, and a
 * caller that knows one passes it as it always did.
 *
 * Null for a creature this state does not hold, for `effectiveSizeOf`'s
 * reason: nothing is derived about nobody.
 */
export function passivePerceptionOf(
  state: GameState,
  who: CharacterId,
  mode: RollMode = 'normal',
): number | null {
  const creature = state.creatures[who];
  if (creature === undefined) return null;
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  const flat = bonusesFor(creature.bonuses, 'ability-check', {
    ability: 'wis',
    skill: 'perception',
  }).reduce((sum, bonus) => sum + (bonus.flat ?? 0), 0);
  return passivePerception(sheet, mode) + flat;
}

/**
 * Conditions that are on this creature but currently do nothing.
 *
 * Kept separate from removing them, because the SRD is explicit that the
 * condition is still there: "If a Frightened ally enters the aura, that
 * condition has no effect on that ally while there." Stepping out of the aura
 * restores it, and nothing had to remember to put it back.
 */
export function suppressedConditions(
  state: GameState,
  who: CharacterId,
): readonly ConditionName[] {
  const names = new Set<ConditionName>();
  for (const { effect } of standingFor(state, who)) {
    if (effect.grant.kind === 'condition-immunity') names.add(effect.grant.condition);
  }
  // **And a casting's, where its sentence says so.** SRD Calm Emotions: "If
  // the creature was already Charmed or Frightened, those conditions are
  // suppressed for the duration." The same rule Aura of Courage's standing
  // grant states, read from a second source — a sourced grant the casting
  // hung and every ending takes away — so the condition is back the moment
  // the spell ends. An Immunity that prints no such sentence suppresses
  // nothing: Heroism's Frightened stays on a creature that already had it.
  for (const granted of state.creatures[who]?.grantedConditionImmunities ?? []) {
    if (granted.suppresses !== true) continue;
    for (const condition of granted.conditions) names.add(condition);
  }
  return [...names].sort();
}

/**
 * The conditions that actually bite on this creature right now.
 *
 * Every reader of condition *effects* should go through this rather than
 * through `creature.conditions`, which is the record of what is on them. The
 * two differ exactly where a feature says a condition has no effect.
 */
export function effectiveConditions(
  state: GameState,
  who: CharacterId,
  /**
   * The creature on the other side of whatever is about to be asked, where
   * there is one — an attacker, or the creature being attacked.
   *
   * **Only a narrowed denial reads it**, and absent is the answer for every
   * question with no second participant: an Initiative roll, a boundary save,
   * a Hide check. SRD Mind Spike's "against you" is the one sentence in the
   * condition layer that has ever needed it, and handing it in here rather
   * than at each reader is what keeps `benefitsFrom` a question about a
   * `ConditionState` — the whole reason there is one gatherer.
   */
  against?: CharacterId,
): ConditionState {
  const creature = state.creatures[who];
  if (creature === undefined) return conditionState([]);

  const suppressed = suppressedConditions(state, who);
  let effective = withoutConditions(creature.conditions, suppressed);
  // **And the conditions a place imposes, gathered here and nowhere else.**
  // SRD Silence: "creatures have the Deafened condition while entirely inside
  // it." Nothing applied it, so nothing is stored and nothing ends it but
  // walking out — see {@link areaConditionsOn}. It joins *after* the
  // suppression filter rather than before it, because an aura that suppresses
  // a condition suppresses the condition a creature *has*, and this one the
  // creature acquires by standing somewhere; a suppression that reached it
  // would be an area and an aura arguing about a fact neither of them wrote
  // down. The day the SRD prints that pair the argument is written first.
  for (const { condition, source } of areaConditionsOn(state, who)) {
    if (suppressed.includes(condition)) continue;
    effective = applyCondition(effective, condition, source);
  }
  // **The benefits something has taken away, gathered here and nowhere else.**
  // SRD Starry Wisp's "can't benefit from the Invisible condition" is not the
  // condition being suppressed and not the condition ending — the creature is
  // still Invisible, and only the readers that hand a condition something good
  // are meant to notice. This is the door every one of those readers already
  // goes through, so a new one asks the question by construction rather than
  // by remembering to; `benefitsFrom` is what they ask.
  const denied = deniedBenefitsOf(creature.deniedBenefits, against);
  return denied.length === 0 ? effective : { ...effective, withoutBenefit: denied };
}
