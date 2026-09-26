/**
 * Who a spell may be aimed at, and where its area falls.
 *
 * Maestro resolves the player's intended target and hands the engine an id;
 * the engine checks that id and only that id. `eligibleTargets` is a
 * shortlist for the layer that decides, never a substitution mechanism — no
 * part of the engine may quietly aim a spell at somebody other than the
 * creature it was handed.
 *
 * The geometry is here too, because placing an area is the other way a casting
 * finds its targets, and both answer the same question before anything is
 * spent.
 */

import { type Content } from '../content.js';
import {
  type CharacterId,
  type ConditionName,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { type AttackResult } from '../attack.js';
import { type D20TestResult } from '../checks.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity } from '../idempotency.js';
import {
  type AreaOrigin,
  areaPointAt,
  type AreaShape,
  coverBetween,
  creaturesInArea,
  distanceBetween,
  distanceToPoint,
  isInsideScene,
  type Placement,
  type Point,
  type PointAnchoring,
  positionOf,
  snapToSpace,
} from '../positioning.js';
import { fallWindowOpen } from '../reactions.js';
import { typeMagicSees } from '../creature-type.js';
import { effectiveSizeOf } from '../size.js';
import { canSee, canSeePoint, wardBetween } from '../standing.js';
import { type SlotKind } from '../resources.js';
import {
  aimedRollsIn,
  rollsDealtTo,
  DIRECTIONAL_AREAS,
  isCreatureType,
  namesAnObject,
  optionEffects,
  ranged,
  rangeFeetAt,
  type SpellArea,
  type SpellDefinition,
  statedChoiceReaches,
  statesFoughtFact,
  statesWillingFact,
  targetCountFor,
  teleportOf,
  weaponRiderOf,
  statedFormOf,
} from '../spell-definitions.js';
import { type SlotlessReason } from '../spells.js';
import { type ConcentrationConsequence } from './casting.js';
import { type CastingResolution } from './casting-options.js';
import { creatureOf, unknownCreature } from './command.js';
import { dyingProblem } from './spell-effect-creatures.js';

/** What happened to one target of one casting. */
export interface SpellTargetOutcome {
  readonly target: CharacterId;
  readonly attack?: AttackResult;
  readonly save?: D20TestResult;
  readonly damage?: number;
  /** Hit points actually restored, after the cap at the maximum. */
  readonly healed?: number;
  /** Temporary Hit Points granted. They do not stack; the larger set wins. */
  readonly temporaryHp?: number;
  /**
   * The conditions this effect imposed, when it imposed any.
   *
   * **A list, because one outcome can impose several.** SRD Hideous Laughter
   * gives "the Prone and Incapacitated conditions" on one Wisdom save, and a
   * singular field would have made a caller pick which of the two to report.
   * Absent rather than empty where nothing landed, so a reader asking whether
   * a condition was imposed asks one question.
   */
  readonly conditions?: readonly ConditionName[];
  /**
   * The conditions this effect **ended**, when it ended any.
   *
   * A field of its own rather than a sign on {@link conditions}, because the
   * two answer opposite questions and a reader asking "is the target Poisoned
   * because of this spell" must not be told yes by a Lesser Restoration. Absent
   * rather than empty where the spell found nothing to cure — which is a real
   * outcome, reported as `affected: false`, and not an error.
   */
  readonly ended?: readonly ConditionName[];
  /**
   * The Concentration this damage put at risk, and what became of it.
   *
   * Present whenever damage was dealt to a creature that was concentrating:
   * the save is rolled by the same operation that dealt the damage, so nobody
   * has to remember to ask for it.
   */
  readonly concentration?: ConcentrationConsequence;
  /**
   * The ongoing spell this effect ended, when it ended one.
   *
   * The casting id rather than a name, because that is the handle: a log
   * reader asking which of the two Blesses went has to be able to tell them
   * apart.
   */
  readonly dispelled?: string;
  /** The ability check a dispel had to roll, when the spell was too high. */
  readonly check?: D20TestResult;
  /**
   * The casting this effect interrupted, when it interrupted one.
   *
   * Counterspell's whole outcome, and it is the *casting id* rather than a
   * boolean because that is what names the thing that stopped: a log reader
   * asking why Hold Person never landed wants `cast:3`, not `true`.
   */
  readonly interrupted?: string;
  /**
   * The target’s Armour Class after a spell supplied a new calculation.
   *
   * The resulting number rather than the definition’s base, because the base
   * only wins if it beats what the creature already had — SRD Multiclassing
   * lets a creature benefit from one calculation at a time, and Mage Armor on
   * a Barbarian may well be the one that loses.
   */
  readonly armorClass?: number;
  /**
   * The target’s Speed after an effect changed it.
   *
   * The resulting number rather than the change the definition asked for, and
   * for {@link armorClass}’s reason: the grant is one input among several to
   * `speedOf`, so a Longstrider on a Grappled creature adds ten feet to a
   * Speed the rules have already pinned at 0. What the caller wants is what
   * the creature can actually move.
   */
  readonly speed?: number;
  /** Whether the effect actually landed on this target. */
  readonly affected: boolean;
}

/**
 * A cast that happened, and what it did to each target.
 *
 * There is no sibling shape for "it did not happen because a fact is missing".
 * That used to be `SpellNeedsContext`, returned as a **success** carrying
 * homework — which was the right idea reached by the wrong route. A caller had
 * to know that this one command answered the three-state question inside its
 * `ok` value while all forty-seven others answered it with an error, and no
 * amount of documentation makes a language model's tool surface remember that.
 *
 * The distinction now lives where every command already puts it:
 * `Err.kind === 'needs-context'`, with the structured requests on the error.
 * The property that made the original design right is unchanged — nothing is
 * spent, no die is thrown, and asking again after the fact is established is
 * the cast the caller meant the first time.
 */
export interface SpellResolution {
  readonly events: readonly GameEvent[];
  /**
   * The casting this made, or **null where the use made none**.
   *
   * SRD Wind Fan: "it has a cumulative 20 percent chance of not working; if
   * the fan fails to work, it tears into useless, nonmagical tatters." The use
   * happened — the action went, the die fell, the fan is gone — and no spell
   * was cast, so there is no id for anything to hang on.
   *
   * **A failed use is an ordinary success**, in the sense a missed attack is:
   * `AttackResolution.attack.hit === false` is the same shape, and so is
   * `affected: false` on a {@link SpellTargetOutcome}. It is not a fourth
   * outcome beside `ok`, `err` and `needs-context` — those three answer
   * whether the engine could do what it was asked, and it could: it asked the
   * dice and the dice said no. A fourth arm would land in `@ie/shared`'s
   * `Result` and be branched on at every command in the engine, to say
   * something only this one can say.
   *
   * Nothing downstream may read it without asking, which is the point of the
   * `null` rather than an empty string: a caller that hangs an effect on a
   * casting there is none of is a type error rather than a `cast:undefined` in
   * a log.
   */
  readonly castingId: string | null;
  readonly outcomes: readonly SpellTargetOutcome[];
  /**
   * A ward turned this casting away before anything was spent.
   *
   * SRD Sanctuary, on the casting's side of "an attack roll or a damaging
   * spell". `castingId` is null and `events` holds the save the caster failed
   * — nothing else happened, because the ward is asked with the targets
   * settled and before the slot, the action and the first die.
   *
   * Absent rather than false, so a reader asks one question and a log written
   * before wards existed reads back unchanged. It is not a fourth outcome
   * beside `ok`, `err` and `needs-context`, for the reason `castingId`'s own
   * note gives: the engine could do what it was asked, and the dice said no.
   */
  readonly warded?: true;
  /** Checks the rules call for that the engine still cannot make. */
  readonly unverified: readonly string[];
}

/**
 * One creature a casting named, and how many of its attack rolls go at them.
 *
 * The caller's half of {@link CastSpellRequest.rollsAt}. `target` rather than
 * an anonymous id because that is what every other per-creature record in this
 * module calls it — see {@link SpellTargetOutcome}.
 */
export interface AimedRolls {
  readonly target: CharacterId;
  /** A whole number of rolls, at least one. */
  readonly count: number;
}

export interface CastSpellRequest extends CommandIdentity {
  readonly spellId: string;
  /**
   * The eleventh stated fact: the caster chooses, **at the casting**, that
   * this casting can be ended early.
   *
   * > SRD Magic Mouth: "When you cast this spell, you can have the spell end
   * > after it delivers its message, or it can remain and repeat its message
   * > whenever the trigger occurs."
   *
   * Refused where the spell prints no such choice, required nowhere, and
   * pinned on the ongoing record where it was said — see
   * `SpellDefinition.offersEndAfterTrigger`, which is the printed clause it
   * answers. `false` and absent mean the same thing and both leave the casting
   * with no ending its caster can reach, which is what the book prints.
   */
  readonly endsAfterTrigger?: boolean;
  /**
   * Who to aim at. Empty for an area spell, which picks its own.
   *
   * Maestro has already resolved "him" to an id by the time this arrives; the
   * engine checks the id it was handed and never substitutes a better one.
   */
  readonly targets: readonly CharacterId[];
  /**
   * How many of this casting's attack rolls go at each creature it named.
   *
   * SRD Scorching Ray: "You can hurl them at one target within range or at
   * several"; Eldritch Blast: "you can direct the beams at the same target or
   * at different ones". Both sentences leave the middle open, and the middle is
   * the lopsided split — three rays at the ogre and one at the goblin — which
   * an ordered list alone cannot say, because dealing round it produces every
   * even split and none of the uneven ones.
   *
   * **A count beside each creature rather than a repeat inside `targets`.** A
   * spell has one effect list applied to every target, so a duplicate in that
   * list would be a creature every *other* effect kind ran on twice — a second
   * condition, a second save, a second grant. The list stays a set and the
   * distribution is stated beside it.
   *
   * **A number about targeting, never a die face.** It says where the engine's
   * rolls go; the engine still throws every one of them and the caller never
   * states an outcome.
   *
   * Absent is the deal `rollsDealtTo` has always made — one each in the order
   * named, round again for the surplus — which says both ends of the SRD
   * sentence and is what every casting written before this field folds to.
   * Present, it must name every creature in `targets` exactly once and sum to
   * exactly the rolls the casting makes; see `rollsAimedAt`.
   */
  readonly rollsAt?: readonly AimedRolls[];
  /**
   * Where an area spell's origin goes — "a point you choose within range".
   *
   * Required for an area whose origin is a point, and refused for one that
   * starts at the caster, because Burning Hands does not get to begin
   * somewhere else.
   */
  readonly at?: Point;
  /**
   * Which way a Cone, Cube or Line points.
   *
   * A point to aim at rather than an angle: Maestro speaks in landmarks and
   * creatures, and `positionOf` turns either into coordinates. An angle would
   * be the model typing raw geometry, which is the thing that is not allowed.
   */
  readonly towards?: Point;
  /**
   * The 5-foot spaces a **wall** runs through, in order along the ground.
   *
   * SRD Wind Wall: "You can shape the wall in any way you choose so long as it
   * makes one continuous path along the ground."
   *
   * **The one template the caster draws rather than aims**, and the reason it
   * is a list of spaces and not a length and a bearing: fifty feet of wall
   * bent around a corner is a shape no number reconstructs, and a wall the
   * engine picked the route of would be the engine playing. `placeWall` judges
   * what arrives — the length, the continuity, the single ground it runs along
   * and the Range to its first space — and refuses rather than straightening.
   *
   * The point the wall rises from is the first space of the path, so {@link at}
   * may be left out; stated beside a path, it has to agree with it.
   *
   * Absent for every other area, which is shaped by its own printed dimension.
   */
  readonly path?: readonly Point[];
  /**
   * Whether `at` and `towards` name a space or a grid intersection —
   * the vertical edge four spaces share. Defaults to `space`.
   *
   * The bit that decides whether a footprint comes out odd or even. A 20-foot
   * radius centred on a space reaches nine spaces across; centred on the
   * intersection four spaces meet at, it reaches eight — the footprint most tables
   * expect, and the one a 2014 optional rule prints. SRD 5.2.1 gives no grid
   * rule for areas of effect at all, so the engine declines to pick: the
   * caster says, and the casting records which they said.
   *
   * One value for the whole template, so the origin and the point a
   * directional shape is aimed at are always read in the same frame. Refused
   * for a `self`-origin area, which is anchored by the caster's own space.
   */
  readonly anchoring?: PointAnchoring;
  /**
   * The magic item casting it, by catalogue id.
   *
   * SRD "Spells Cast from Items": a wand's Fireball is a casting, and this is
   * how a caller says which wand. Everything the item decides — the charge,
   * the level, the save DC — follows from the grant on that item, so this is
   * the only thing about it the request may state. A DC never arrives here.
   */
  readonly item?: string;
  /**
   * How many of the item's charges this casting spends.
   *
   * SRD Wand of Fireballs: "you can expend no more than 3 charges ... You can
   * increase the spell's level by 1 for each additional charge you expend."
   * The charge count is what the wielder decides, exactly as the slot level is
   * for a spell of their own — and, like a slot level, the *engine* turns it
   * into a level rather than taking one.
   *
   * Refused without an {@link CastSpellRequest.item}, which is the shape every
   * other stated fact on this request takes.
   */
  readonly charges?: number;
  /** The slot to spend. Omitted for a cantrip or a free casting. */
  readonly slotLevel?: number;
  /**
   * Which pool the slot comes out of, for a caster who has both.
   *
   * Only a Warlock multiclassed into a Spellcasting class has both, and for
   * them the two are genuinely different resources. See `chooseSlotKind`.
   */
  readonly slotKind?: SlotKind;
  /** Why no slot is being spent, when none is. */
  readonly slotless?: SlotlessReason;
  /**
   * Which grant to cast it through: `class`, or a granting feature's id.
   *
   * **Default:** the class's own route when it supplies the spell, and the
   * single grant when only a feat does. Named explicitly when more than one
   * would serve and the choice matters — a feat brings its own spellcasting
   * ability, so the same spell can have two different save DCs, and so do two
   * classes that both prepared it. `class:<classId>` names one of those.
   *
   * **It names the ability for a casting from an item too**, and through the
   * same vocabulary. SRD: "If the user has more than one spellcasting ability,
   * the user chooses which one to use with the item" — the same question with
   * the same answers, so a caller has one field to learn rather than two.
   */
  readonly source?: string;
  /**
   * Creatures this casting designates unaffected, for a spell that offers it.
   *
   * SRD Spirit Guardians: "When you cast this spell, you can designate
   * creatures to be unaffected by it." Alarm prints the same shape. The choice
   * is the caster's and the engine validates rather than makes it — naming
   * somebody the engine has never heard of is refused, and naming anybody at
   * all through a spell that prints no such clause is refused too.
   *
   * **Never inferred from allegiance.** A cleric may spare an enemy and may
   * decline to spare an ally; `side` answers a different question.
   *
   * **And the field SRD Careful Spell buys for a spell that prints no such
   * clause.** "Choose a number of those creatures up to your Charisma modifier
   * (minimum of one creature). A chosen creature automatically succeeds on its
   * saving throw" is the same decision on the same list, offered by the caster
   * instead of by the spell — so an elected option unlocks this field, caps how
   * many may be named, and the refusal for a spell that offers neither stands.
   */
  readonly unaffected?: readonly CharacterId[];
  /**
   * Creatures this casting's area reaches, for a spell that offers the choice.
   *
   * SRD Pass without Trace: "While in the aura, you and **each creature you
   * choose** have a +10 bonus to Dexterity (Stealth) checks." The eleventh
   * stated fact, and {@link unaffected} with the polarity turned over — that
   * one names who an area lets alone, this names the only creatures it
   * touches.
   *
   * The caster need not be named and is on the list either way; naming
   * anybody at all through a spell that prints no such clause is refused, and
   * naming somebody the engine has never heard of is refused, both of which
   * are the reading its sibling takes.
   */
  readonly chosen?: readonly CharacterId[];
  /**
   * How a named creature rolls the saves this casting forces on it.
   *
   * SRD Heightened Spell: "give one target of the spell Disadvantage on saves
   * against the spell." **Meaningless unless an elected option offers it**,
   * which is the refusal that makes this field safe: what a caller states is
   * *which creature* an option they have already bought and are already paying
   * for applies to, and the mode has to be the one that option prints. The
   * engine reads the price, the count and the mode off the sheet, exactly as
   * {@link CastSpellRequest.usingOptions} promises.
   *
   * A map rather than a list because the mode belongs to the entry: a homebrew
   * option could offer Advantage on an ally's save against its own caster's
   * spell, and two entries of one map say which creature got which.
   */
  readonly saveModes?: Readonly<Record<string, RollMode>>;
  /**
   * Which of the damage types the spell prints this casting deals.
   *
   * SRD Spirit Guardians deals "Radiant damage (if you are good or neutral) or
   * Necrotic damage (if you are evil)". The engine holds alignment only for a
   * character it built and never for a monster or a declared NPC, and
   * inferring it from side, class or deity would be inventing the fact — so
   * the layer that reads the fiction states it, and the engine refuses
   * anything the spell does not print.
   *
   * Required by a spell that prints more than one and meaningless on every
   * other, both of which are refusals rather than quiet defaults.
   */
  readonly damageType?: string;
  /**
   * The one value this spell asks its caster to choose.
   *
   * SRD Blindness/Deafness: "it has the Blinded or Deafened condition (**your
   * choice**)"; Guidance: "choose a skill"; Enhance Ability: "choose Strength,
   * Dexterity, …"; Lesser Restoration: "end **one** condition on it". The
   * spell prints the list, the caster picks one of it, and the engine picks
   * none of them — a default here would be the engine answering a question the
   * book asked somebody else, and it would answer it the same way every time.
   *
   * Required by a spell that prints a choice and meaningless on every other,
   * both of which are refusals rather than quiet defaults — the shape
   * `damageType`, `fought` and `teleportTo` all take.
   */
  readonly choice?: string;
  /**
   * The creature types the caster chose, where the spell prints a choice of
   * one or more.
   *
   * SRD Magic Circle: "Choose one or more of the following types of creatures:
   * Celestials, Elementals, Fey, Fiends, or Undead." A list where {@link
   * choice} is one value, and the same discipline: required by a spell that
   * prints the clause (`types_required`), refused on one that does not
   * (`no_types_clause`), refused off the printed list (`type_not_offered`),
   * and never defaulted. Substituted into every clause of the area that says
   * `'stated'` and pinned on the record — see `SpellDefinition.typesStated`.
   */
  readonly types?: readonly string[];
  /**
   * Which of the branches this spell prints the casting runs.
   *
   * SRD Command: "Choose the command from these options: _Approach. Drop.
   * Flee. Grovel. Halt._"; Thaumaturgy: "You create one of the effects below";
   * Enlarge/Reduce: "see the chosen effect below". The tenth stated fact, and
   * the same two refusals every one before it makes — required where the spell
   * prints branches, refused where it prints none, refused off the list.
   *
   * **`choice`'s neighbour rather than a wider version of it.** That one names
   * a value substituted into an effect the definition already carries; this
   * names which effects run at all, and a spell may print both.
   */
  readonly option?: string;
  /**
   * Which branch each creature runs, for a spell that chooses per creature.
   *
   * SRD Calm Emotions' "(choose for each creature)" — see
   * `SpellDefinition.optionPerTarget`. Keyed by creature id, one branch name
   * each, over exactly the creatures the casting catches: a caught creature
   * left out is refused, and so is a name for one the area did not reach,
   * because a silent default would be the engine choosing. Refused outright
   * on a spell that chooses once, where {@link option} is the word.
   */
  readonly optionByTarget?: Readonly<Record<string, string>>;
  /**
   * Which creatures the caster or their allies are fighting.
   *
   * SRD Charm Person: "One Humanoid you can see within range makes a Wisdom
   * saving throw. It does so with Advantage if you or your allies are fighting
   * **it**." Charm Monster prints it word for word and the three Dominates
   * print it with the clauses swapped round.
   *
   * **A list, because the SRD asks it of the target and not of the casting.**
   * Both Charms carry `extraPerSlotLevelAbove: 1`, so an upcast casting names
   * several creatures — and a level 2 Charm Person at the goblin you are
   * fighting and the bystander you are not has two different answers. One
   * boolean would have been silently wrong for one of the two saves, with no
   * refusal and no `unverified` line to say so.
   *
   * The engine does not hold the fact and will not derive one. **`side` is a
   * different question**: allegiance may be undeclared, an enemy may be one
   * nobody has yet come to blows with, and a Charmed ally may be fought while
   * still on the party's side — so substituting it would be the engine
   * answering the question the caster was asked, which is the error recorded
   * for Spirit Guardians' designated creatures.
   *
   * Required by a spell that prints the clause and meaningless on every other,
   * both of which are refusals rather than quiet defaults: an answer the engine
   * fills in is a fact it invented.
   *
   * **An empty list is an answer and is never elided**, which is the one place
   * this differs from {@link CastSpellRequest.unaffected} — see
   * {@link foughtFor}. "We are fighting none of them" is a fact the caster
   * stated; absence is a caller who has not read the spell.
   */
  readonly fought?: readonly CharacterId[];
  /**
   * Where the orb goes when its dice pair, **in order** — SRD Chromatic Orb's
   * "the orb leaps to a different target of your choice within 30 feet of the
   * target".
   *
   * An election rather than a window: the caster says now, before a die is
   * thrown, which creatures the orb should leap to and in what order, and the
   * resolver takes the first stated creature the book allows at each leap —
   * within reach of the one just struck and not yet targeted by this casting
   * — and skips the rest. Nothing here is a number and nothing here is an
   * outcome; a creature named out of reach is simply never leapt to, and a
   * list left out means the orb does not leap. **Order is meaning**, so the
   * list is not sorted — which is the one way it differs from
   * {@link fought}.
   *
   * Refused on a spell that prints no leap (`no_leap_clause`), for a creature
   * the casting already names (`leap_to_a_target`), and for a creature named
   * twice (`duplicate_leap_target`); pinned on a held casting so a
   * Counterspell's window does not lose it.
   */
  readonly leapTo?: readonly CharacterId[];
  /**
   * Where a teleporting spell puts its target.
   *
   * SRD Misty Step: "you teleport up to 30 feet to an unoccupied space you can
   * see"; SRD Dimension Door: "You teleport to a location within range. You
   * arrive at exactly the spot desired." **Which space is the caster's**, so
   * it arrives here as an ordinary `Placement` — measured from a landmark, a
   * creature or a point already established, because the model never types raw
   * coordinates.
   *
   * The fourth fact a casting states rather than derives, and it takes the
   * shape of the other three: **required** by a spell that teleports and
   * **refused** for one that does not, both before a slot is spent. The engine
   * validates the destination — the distance, the unoccupied space, the
   * scene's extent, the declared sight — and never chooses one, which is the
   * same boundary `eligibleTargets` draws for targeting.
   */
  readonly teleportTo?: Placement;
  /**
   * The object a spell aimed at a thing rather than at its holder was pointed
   * at, by catalogue id.
   *
   * SRD Remove Curse: "the spell breaks its **owner's** Attunement to the
   * object"; SRD Heat Metal: "Choose a manufactured metal object ... that you
   * can see within range." Both name one thing out of what a creature is
   * carrying, and both leave the creature as the target the range is measured
   * to — which is why this is a fact beside the target list rather than a
   * second kind of target.
   *
   * The eighth fact a casting states rather than derives, and it takes the
   * shape of the seven before it: **required** by a spell that names an object
   * and **refused** for one that does not, both before a slot is spent. What
   * is checked beside that is the object's — it reaches an item, and the
   * relation the spell needs really holds — and every one of those is a
   * refusal rather than a substitution.
   *
   * **Distinct from {@link CastSpellRequest.weapon}**, which is the same shape
   * narrowed to a weapon and read by an entirely different clause: a
   * `weapon-rider` imbues something a later swing reads, where this names a
   * thing the spell acts on now. A definition writing both would be two
   * sentences about two objects, and no SRD spell prints one.
   *
   * **And distinct from {@link CastSpellRequest.item}**, which is the wand
   * doing the casting rather than the thing being cast at.
   */
  readonly object?: string;
  /**
   * The weapon a spell that imbues one was aimed at, by catalogue id.
   *
   * SRD Shillelagh: "A Club or Quarterstaff **you are holding**"; SRD Magic
   * Weapon: "You touch a nonmagical weapon … **that** weapon becomes a magic
   * weapon". One object out of whatever the target is carrying, and the engine
   * will not pick it: a Druid with a Club and a Quarterstaff has two answers
   * and the book asked the caster.
   *
   * The sixth fact a casting states rather than derives, and it takes the
   * shape of the other five: **required** by a spell that imbues a weapon and
   * **refused** for one that does not, both before a slot is spent. What is
   * checked beside that is the weapon's — it reaches an item, the item is a
   * weapon, the spell's own list names it where it prints one, and the target
   * has it — and every one of those is a refusal rather than a substitution.
   *
   * **A catalogue id and not an instance**, which is a limit worth stating:
   * two Quarterstaves in one pack are one id, so a casting aimed at either
   * reaches both. `InventoryLine.instance` exists and never reaches an attack,
   * which names its weapon by catalogue id — so a grant keyed on an instance
   * would reach no swing at all.
   */
  readonly weapon?: string;
  /**
   * Which stat block a summoning spell that leaves the form to its caster
   * raises, by its id in content.
   *
   * SRD Find Familiar: "an animal form you choose: Bat, Cat, Frog, Hawk,
   * Lizard, Octopus, Owl, Rat, Raven, Spider, Weasel, or another Beast that
   * has a Challenge Rating of 0." The list is the spell's, the pick is the
   * caster's, and the engine makes neither — a default here would be the
   * engine answering "you choose" on the caster's behalf, the same way every
   * time.
   *
   * The seventh fact a casting states rather than derives, in the shape of
   * the other six: **required** by a spell that leaves the form to its caster
   * and **refused** for one that names its own block, both before a slot is
   * spent. What is checked beside that needs the catalogue — the block exists,
   * and it is listed or admitted by the clause — and is asked in `resolveSpell`'s
   * pre-flight beside the weapon's.
   */
  readonly form?: string;
  /**
   * Which of this casting's targets consent to it.
   *
   * SRD Mage Armor: "You touch a **willing** creature who isn't wearing
   * armor"; SRD Levitate, from the other end: "An **unwilling** creature that
   * succeeds on a Constitution saving throw is unaffected." Spell after spell
   * in reach prints one sentence or the other, and the fact behind both is
   * one the engine holds nothing to derive: allegiance is a different question
   * — a Charmed ally is still on the party's side, an enemy nobody has come to
   * blows with is not — and "the cleric's friend would of course agree" is a
   * table's assumption rather than a rule in the book.
   *
   * The ninth fact a casting states rather than derives, and the shape of the
   * eight before it: **refused** for a spell that prints neither clause, and
   * refused for naming a creature this casting is not aimed at. What it is
   * *not* is required — the two clauses want it at two different moments and
   * neither demands an answer:
   *
   * | | |
   * |---|---|
   * | `TargetRule.willing` | a gate: a target nobody named comes back `needs-context`, before a slot is spent |
   * | `save.unlessWilling` | a die: a target nobody named is unwilling, which is the book's own default, and rolls the save |
   *
   * **A list, because the SRD asks it of the creature.** An upcast Water
   * Breathing names ten, and a Heroism cast on the caster and on somebody who
   * has not answered has two answers. `willingFor` sorts it.
   *
   * **The caster is never named and never has to be**: choosing to cast a
   * spell on yourself is the consent, and a casting that lists its own caster
   * beside a target list they are in is simply saying something already true.
   */
  readonly willing?: readonly CharacterId[];
  /**
   * How to pay for it.
   *
   * **Default:** a slot when `slotLevel` is given, and nothing at all for a
   * cantrip. When a grant offers a free casting *and* a slot would serve, the
   * engine refuses to choose: spending a feat's one daily casting instead of a
   * slot is the caller's decision, not a default.
   */
  readonly payment?: 'slot' | 'free-casting';
  /**
   * Declare the casting and stop, leaving it open to be interrupted.
   *
   * SRD Counterspell answers "a creature in the process of casting a spell",
   * and an atomic casting is never in the process of anything. Asking for the
   * window costs the caster exactly what the SRD says it costs whatever
   * happens next — the action, and any Concentration they were holding — and
   * settles the rest at {@link resolveDeclaredCast}.
   *
   * **Opt-in, because most castings have no window that matters.** A spell
   * nobody can answer resolves in one call exactly as it always has; turning
   * every casting into a two-step ceremony would be a worse API for the sake
   * of a moment that is usually empty.
   *
   * **A casting of a minute or more is declared whether or not this is set**,
   * because the SRD makes it a process rather than a moment. So this asks for
   * the window and a long casting time *has* one.
   */
  readonly hold?: boolean;
  /**
   * Which casting this Reaction answers.
   *
   * SRD Counterspell interrupts "a creature in the process of casting a
   * spell", and several castings may be in progress at once — several of them
   * possibly one creature's, since a wizard mid-rite may cast Shield when
   * attacked. So an ambiguous reference resolves to a **casting id** or is
   * refused: the engine never picks between candidates, which is the boundary
   * `eligibleTargets` already draws for targeting.
   *
   * Optional, because where the named creature has exactly one casting open
   * there is nothing to choose between and an omitted id resolves. Where they
   * have several, omitting it is `ambiguous_casting` naming them, and the
   * caller re-sends. `reactionOpportunities` reports the id to send.
   *
   * Refused for a spell whose trigger is not `casting-a-spell`, which is the
   * shape every other stated fact on this request takes.
   */
  readonly answers?: string;
  /**
   * Cast it as a Ritual.
   *
   * SRD: "The Ritual version of a spell takes 10 minutes longer to cast than
   * normal. It also doesn't expend a spell slot, **which means the ritual
   * version of a spell can't be cast at a higher level.**" All three clauses
   * follow from this one field: the casting becomes a long one 600 seconds
   * longer than the spell's printed time, no slot is expended and the log
   * records `ritual` as the reason, and a slot level above the spell's own is
   * refused rather than silently ignored.
   *
   * Legal only where the definition carries the printed Ritual tag, which is
   * the same shape `damageType` and `fought` take: a clause the spell prints,
   * refused for a spell that prints none rather than quietly doing nothing.
   *
   * **Preparation is still unjudged.** SRD requires a Ritual to be prepared or
   * to come from a feature that allows it, and spell lists and preparation are
   * not modelled — refusing on a rule the engine cannot evaluate is worse than
   * leaving it to the layer that knows, exactly as it is for every other cast.
   */
  readonly ritual?: true;
  /**
   * Which of the caster's own features this casting uses, by feature id.
   *
   * SRD writes three of the five damage-altering features as a permission —
   * "**you can** add your Charisma modifier", "**you can** deal maximum damage"
   * — and a permission is declined by saying nothing. So an optional feature
   * does nothing unless it is named here, which is the same three-valued
   * discipline {@link CastSpellRequest.fought} and the designation already take:
   * stated, or not stated, never guessed.
   *
   * **It is not a number and never could be.** What the caller supplies is the
   * caster's decision to use a feature they hold; the engine reads the feature
   * off the sheet, decides whether it reaches this casting, and does the
   * arithmetic itself. A feature the creature has not got is refused; one they
   * have that simply does not reach this spell is not, because casting outside
   * a feature's narrowing is legal and refusing it would be the engine
   * inventing a rule.
   *
   * A feature that is **not** optional needs no mention: SRD Potent Cantrip's
   * cantrips "affect even creatures that avoid the brunt of the effect" whether
   * their caster thought about it or not.
   */
  readonly usingFeatures?: readonly string[];
  /**
   * Which of the caster's own **casting options** this casting buys, by id.
   *
   * SRD Metamagic: "To use an option, you must spend the number of Sorcery
   * Points that it costs." A purchase, which is what separates this from
   * {@link CastSpellRequest.usingFeatures} beside it — that field elects a
   * feature the caster already has and pays nothing, and this one elects a
   * priced entry off the sheet's menu and is charged inside this casting's own
   * batch.
   *
   * **It is not a number and never could be.** The caller names an option; the
   * engine reads its price and its alteration off the sheet, decides whether
   * the option reaches this spell at all, and does the arithmetic. An option
   * the caster has not got is refused, and so — unlike an elected feature — is
   * one that does not reach: the book writes each of them as a condition on
   * the spending, so a casting that could not use it must not be charged.
   */
  readonly usingOptions?: readonly string[];
}

/**
 * The request as the engine will remember the casting, for fingerprinting.
 *
 * A fingerprint answers "is this the same command", and two spellings of one
 * command must not become two identities — which is why `stableStringify`
 * sorts keys rather than treating field order as part of the command.
 * `anchoring: 'space'` is the same thing one level up: **`space` is the
 * absence**, normalised away when the ongoing record is built precisely so
 * that a casting naming it serialises exactly as one that says nothing. An
 * identity that told them apart would refuse an honest retry that spelled the
 * default out.
 *
 * **`rollsAt` is the same sentence one level down**, and only that far. A split
 * is a *mapping* from creature to share, so the order the pairs were written in
 * says nothing about the casting and is sorted away ({@link aimedIdentity}).
 * What is **not** normalised is a split that spells out the deal, and the
 * difference is the whole rule this function obeys: a fingerprint may
 * canonicalise what makes two requests the same *request*, and may not decide
 * what makes two requests resolve the same way. `anchoring: 'space'` is the
 * first; whether a split is this casting's default is the second, because it
 * depends on how many rolls the casting makes and the definition is fetched on
 * the far side of the duplicate check. Guessing it would hand a caller `ok` for
 * a casting the engine would have refused — the id already landed, so the body
 * that does the refusing never runs.
 *
 * The cost is stated rather than hidden: a caller who lands a casting and then
 * retries it under the same id with the deal spelled out is told
 * `command_id_reused`. That is the conservative answer — the fingerprint never
 * says "the same" of two requests that are not — and `rollsAimedAt` still drops
 * the spelled-out deal from what a **declaration pins**, which is what
 * byte-identity of the log actually needs.
 */
export const castingIdentity = ({
  anchoring,
  rollsAt,
  ...rest
}: CastSpellRequest): CastSpellRequest => ({
  ...rest,
  ...(anchoring === undefined || anchoring === 'space' ? {} : { anchoring }),
  ...(rollsAt === undefined ? {} : { rollsAt: aimedIdentity(rollsAt)! }),
});

/**
 * A stated split as a fingerprint should see it: the same mapping, one way up.
 *
 * Sorting is sound where dropping is not, and that is the only reason this does
 * one and not the other: two lists of the same pairs **are** the same mapping,
 * whatever spell they are aimed at and whatever the definition says, so
 * canonicalising the order cannot make two different requests look alike. See
 * {@link castingIdentity} for the half that is deliberately not done.
 *
 * An ill-formed split is sorted like any other rather than judged. It is about
 * to be refused by `rollsAimedAt`, and a fingerprint's job is to be stable, not
 * to have opinions.
 *
 * Exported because a **release** states its own split — a readied casting
 * chooses its creatures when it is let go — and `releaseReady` fingerprints its
 * command exactly as this one does. One normalisation, two doors.
 */
export const aimedIdentity = (
  rollsAt: readonly AimedRolls[] | undefined,
): readonly AimedRolls[] | undefined =>
  rollsAt === undefined
    ? undefined
    : [...rollsAt].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));

/**
 * The creatures a casting said it was fighting, normalised once.
 *
 * Sorted for the reason `statedFacts` sorts the designation: the answer reaches
 * the pending record, so two declarations that mean the same thing have to fold
 * to the same bytes.
 *
 * **And never elided**, which is exactly where it parts company with the
 * designation it otherwise copies. An empty `unaffected` means the caster
 * spared nobody, which is what a spell with no such clause also means, so the
 * two are the same record. An empty `fought` means the caster answered "none of
 * them" to a question the spell **insisted** on — and absence means they
 * answered nothing, which `declaredFacts` refuses. Eliding it would turn a
 * settled casting into one that could never have been declared. The next reader
 * will expect these two fields to behave alike; here they must not.
 */
export const foughtFor = (request: {
  readonly fought?: readonly CharacterId[];
}): readonly CharacterId[] | undefined =>
  request.fought === undefined ? undefined : [...request.fought].sort();

/**
 * The creatures a casting said consented, normalised once.
 *
 * Sorted for {@link foughtFor}'s reason: the answer reaches a declaration, so
 * two castings that mean the same thing have to fold to the same bytes.
 *
 * **And elided when empty**, which is where it parts company with the list
 * above it and joins the designation. An empty `fought` is an answer to a
 * question the spell **insisted** on, so absence and emptiness are two
 * different castings; neither consent clause insists on anything, so "nobody
 * consented" and "nobody was named" are the same casting and produce the same
 * outcomes — the save is rolled, or the gate asks. A record that kept them
 * apart would be two spellings of one fact.
 */
export const willingFor = (request: {
  readonly willing?: readonly CharacterId[];
}): readonly CharacterId[] | undefined =>
  request.willing === undefined || request.willing.length === 0
    ? undefined
    : [...request.willing].sort();

/**
 * The creatures a casting's area reaches, normalised once — **with the caster
 * on the list**.
 *
 * SRD Pass without Trace: "**you** and each creature you choose." The first
 * word is the whole of this function's extra job: the sentence names the
 * caster before it names anybody else, and a reader that had to remember that
 * would be a second place for the rule to live. So the list on the record is
 * the complete answer to "whom does this aura reach", and every reader of it
 * is a set membership test.
 *
 * **And the empty list is where it parts company with the designation, which
 * is the one thing about this field that cannot be read off its sibling.** An
 * empty `unaffected` means the caster spared nobody, which is the same casting
 * as a spell that prints no such clause — so that field is elided. An empty
 * `chosen` on a spell that *offers* the clause is the opposite: the caster
 * chose nobody, and "you and each creature you choose" then reaches the caster
 * and nobody else. Eliding it would hand the aura to whoever the geometry
 * caught, enemies included, which is the rule inverted rather than narrowed.
 * So the offer decides: a spell that prints the clause always pins a list, and
 * a spell that prints none pins nothing however many names arrive — those are
 * refused by {@link declaredFacts} before this is reached.
 *
 * Sorted for {@link foughtFor}'s reason.
 *
 * **Deliberately not `unaffected`'s list read backwards.** That one names who
 * an area lets alone; this names the only creatures it touches. One field
 * meaning both would invert a rule the first time a definition set the wrong
 * one, and no SRD spell prints both about one area.
 */
export const chosenFor = (
  request: { readonly chosen?: readonly CharacterId[] },
  caster: CharacterId,
  /** Whether the spell prints the clause — `SpellDefinition.designatesChosen`. */
  offered: boolean,
): readonly CharacterId[] | undefined =>
  offered ? [...new Set([caster, ...(request.chosen ?? [])])].sort() : undefined;

/**
 * A casting that has already been paid for and is waiting to be let go.
 *
 * SRD Ready is the only thing that produces one: the slot went when the spell
 * was readied, so the release has a casting id but nothing left to spend.
 */
export interface HeldCasting {
  readonly castingId: string;
}

/**
 * Which convention this casting’s template footprint is read under.
 *
 * **Request, then definition, then `space`.** One function, because two places
 * need the answer and they must not disagree: `placeArea` builds the geometry
 * with it, and the ongoing record stores it for every later trigger.
 */
/**
 * A size as the book writes it — "Tiny", "Medium" — for a refusal a person reads.
 *
 * The vocabulary is lowercase because that is what a stat block parses to; the
 * SRD prints the category capitalised wherever a rule names one, and
 * `ACTION_TITLES` in `combat.ts` is the same courtesy for the same reason.
 */
const titleSize = (size: string): string => `${size.slice(0, 1).toUpperCase()}${size.slice(1)}`;

export const anchoringFor = (
  source: { readonly anchoring?: PointAnchoring },
  request: { readonly anchoring?: PointAnchoring },
): PointAnchoring => request.anchoring ?? source.anchoring ?? 'space';

/**
 * What an area needs to know about whatever put it there.
 *
 * `areaTargets` and `placeArea` took a whole {@link SpellDefinition} and read
 * three fields off it: what to call the thing in a refusal, which convention
 * its footprint is anchored under, and the one creature type it touches. A
 * feature's Channel Divinity option fills an emanation with no definition
 * anywhere — there is no spell, no casting and nothing in the spell index —
 * so the parameter is the three answers rather than the object that happened
 * to be the only thing that had them.
 */
export interface AreaSource {
  /** What a refusal calls it: a spell's name, or a feature option's. */
  readonly name: string;
  readonly anchoring?: PointAnchoring;
  /** SRD's "each Humanoid in the area" — a filter, never a refusal. */
  readonly mustBeType?: string;
  /** SRD Entangle's "(other than you)" — see {@link TargetRule.notTheCaster}. */
  readonly notTheCaster?: true;
  /** SRD Hypnotic Pattern's "who can see the pattern" — see {@link TargetRule.mustSeeTheOrigin}. */
  readonly mustSeeTheOrigin?: true;
  /** SRD Sleep's "each creature of your choice" — see {@link TargetRule.chosenFromTheArea}. */
  readonly chosenFromTheArea?: true;
  /**
   * The level this casting is made at, for the one filter that reads it.
   *
   * SRD Tiny Hut: "the effects of such spells can't extend into it" — *such*
   * being "spells of level 3 or lower", which is the casting's level and not
   * the spell's. Set by `resolveSpell`, which knows the slot; absent for a
   * feature's pool use and a shortlist, which ask about no casting.
   */
  readonly castLevel?: number;
}

/** A definition's own answers to {@link AreaSource}, in one place. */
export const areaSourceOf = (definition: SpellDefinition): AreaSource => ({
  name: definition.name,
  ...(definition.anchoring === undefined ? {} : { anchoring: definition.anchoring }),
  ...(definition.targets.mustBeType === undefined
    ? {}
    : { mustBeType: definition.targets.mustBeType }),
  ...(definition.targets.notTheCaster === undefined
    ? {}
    : { notTheCaster: definition.targets.notTheCaster }),
  ...(definition.targets.mustSeeTheOrigin === undefined
    ? {}
    : { mustSeeTheOrigin: definition.targets.mustSeeTheOrigin }),
  ...(definition.targets.chosenFromTheArea === undefined
    ? {}
    : { chosenFromTheArea: definition.targets.chosenFromTheArea }),
});

/**
 * What an area reads off the request that placed it.
 *
 * The three fields `placeArea` actually uses, named so that a caller with no
 * `CastSpellRequest` — a feature spending a pool use — can ask the same
 * question without inventing one.
 */
export interface AreaRequest {
  readonly targets: readonly CharacterId[];
  readonly at?: Point;
  readonly towards?: Point;
  /** The spaces a wall runs through — see {@link CastSpellRequest.path}. */
  readonly path?: readonly Point[];
  readonly anchoring?: PointAnchoring;
}

/**
 * Where an area would be laid, with nobody named — {@link AreaRequest} minus
 * the one field that is a *choice* rather than a placement.
 *
 * What {@link eligibleTargets} takes, because a shortlist is asked before any
 * target has been picked: the whole point of it is to say who could be.
 */
export type AreaPlacement = Omit<AreaRequest, 'targets'>;

/**
 * Where a spell's area sits and what shape it is.
 *
 * Shared by the two callers that need it, and they need it for opposite
 * reasons: an `area` uses the result to *find* its targets, while a
 * `targetsWithin` uses it to *bound* the targets the caller already named.
 * The rules about placing it are the same either way — a self-originating
 * shape refuses to be moved, a point must be given and must be in range, and
 * a Cone, Cube or Line has to be pointed somewhere — so they live here rather
 * than being written twice and drifting apart.
 */
/**
 * The clauses a casting states rather than derives, checked before anything is
 * spent.
 *
 * Three SRD sentences, all about facts the engine cannot see for itself:
 *
 * | Clause | Spells | Why the engine will not decide it |
 * |---|---|---|
 * | "you can designate creatures to be unaffected by it" | Spirit Guardians, Alarm | it is the caster's choice, and allegiance is a different question |
 * | "Radiant (if you are good or neutral) or Necrotic (if you are evil)" | Spirit Guardians | alignment is held for a character the engine built and for nobody else |
 * | "with Advantage if you or your allies are fighting it" | the two Charms, the three Dominates | being at war with somebody is not being on the other side, and `side` may be undeclared |
 *
 * **A field a spell does not print is a refusal, not a shrug.** A caller who
 * designates somebody unaffected by a Fireball has misunderstood something,
 * and silently dropping it would let them go on believing it.
 */
export function declaredFacts(
  state: GameState,
  definition: SpellDefinition,
  request: CastSpellRequest,
  fixedChoice?: string,
  /**
   * What the caster's elected options let this casting say, already settled
   * and already refused where the spell offered them nothing.
   *
   * Three of the six reach here, and each of them **widens** one of the facts
   * below rather than adding a fourth: SRD Careful Spell offers the
   * designation to a spell that prints none, SRD Transmuted Spell offers the
   * damage type to a spell that prints one, and SRD Heightened Spell is the
   * one that has no printed clause to widen and so stands alone. Absent for
   * every casting that bought nothing, which is what keeps this function's
   * answer for every other spell exactly what it was.
   */
  bought: CastingResolution = {},
): Result<null> {
  const named = request.unaffected ?? [];
  if (named.length > 0) {
    // SRD Careful Spell's "choose a number of those creatures" is the same
    // choice Spirit Guardians prints, bought instead of printed — so an option
    // that offers it satisfies the clause the spell does not.
    if (definition.designatesUnaffected !== true && bought.spares === undefined) {
      return err(
        'no_designation',
        `${definition.name} does not let its caster designate creatures unaffected by it`,
      );
    }
    for (const who of named) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
    }
    if (new Set(named).size !== named.length) {
      return err('duplicate_designation', `${definition.name} may not designate the same creature twice`);
    }
    // "up to your Charisma modifier (minimum of one creature)", counted off the
    // caster at the casting. Only the option's own head count is capped: a
    // spell that prints the clause prints no number with it.
    if (bought.spares !== undefined && definition.designatesUnaffected !== true) {
      if (named.length > bought.spares.upTo) {
        return err(
          'too_many_spared',
          `${bought.spares.name} spares up to ${bought.spares.upTo} creature${bought.spares.upTo === 1 ? '' : 's'} on this casting of ${definition.name}, and ${named.length} were named`,
        );
      }
    }
  }

  // — the creatures an area reaches, where the spell lets its caster pick ——
  //
  // SRD Pass without Trace's "you and each creature you choose", checked
  // exactly as the designation above it is and refused on a spell that prints
  // no such clause: a caller who names beneficiaries of a Fireball has
  // misunderstood something, and dropping the list quietly would let them go
  // on believing it. **No option buys this one**, which is why there is no
  // `bought` clause here: SRD's six Metamagics widen three of the stated
  // facts and none of them widens this.
  const chose = request.chosen ?? [];
  if (chose.length > 0) {
    if (definition.designatesChosen !== true) {
      return err(
        'no_chosen_list',
        `${definition.name} does not let its caster choose which creatures its area reaches`,
      );
    }
    for (const who of chose) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
    }
    if (new Set(chose).size !== chose.length) {
      return err('duplicate_designation', `${definition.name} may not choose the same creature twice`);
    }
  }

  // — a mode on the saves this casting forces ——————————————————————————————
  //
  // The one stated fact with no printed clause behind it: nothing in a
  // `SpellDefinition` offers a caster a mode on somebody's save, so the whole
  // of the permission is the option the caster bought. A caller who states one
  // with no option behind it is refused rather than obeyed — which is what
  // keeps this field from being a caller writing a rule.
  const modes = Object.entries(request.saveModes ?? {});
  if (modes.length > 0) {
    const offered = bought.saveMode;
    if (offered === undefined) {
      return err(
        'save_mode_not_offered',
        `nothing this casting of ${definition.name} bought puts a mode on anybody's saving throw`,
      );
    }
    if (modes.length > offered.upTo) {
      return err(
        'too_many_save_modes',
        `${offered.name} reaches ${offered.upTo} target${offered.upTo === 1 ? '' : 's'} of this casting of ${definition.name}, and ${modes.length} were named`,
      );
    }
    for (const [who, mode] of modes) {
      if (creatureOf(state, who as CharacterId) === null) return unknownCreature(who as CharacterId);
      // The mode is the option's, and a caller who names another has asked for
      // something they have not bought.
      if (mode !== offered.mode) {
        return err(
          'save_mode_not_offered',
          `${offered.name} gives ${offered.mode} on a saving throw, not ${mode}`,
        );
      }
    }
  }

  // — the ending the caster chooses at the casting —————————————————————————
  //
  // SRD Magic Mouth's "you can have the spell end after it delivers its
  // message", which takes the shape the designation above takes: **refused**
  // where the spell prints no such clause, and never required, because the
  // other half of the sentence — "or it can remain and repeat its message" —
  // is what a casting that says nothing has chosen.
  if (request.endsAfterTrigger !== undefined && definition.offersEndAfterTrigger !== true) {
    return err(
      'no_early_ending',
      `${definition.name} does not let its caster choose at the casting that it can be ended early`,
    );
  }

  // — is the caster fighting the target ————————————————————————————————————
  //
  // The same shape as the damage type below it and the same two refusals:
  // **required** where the spell prints the clause, **refused** where it does
  // not. What differs is the arity: the SRD asks this of the *target*, and an
  // upcast Charm Person names several — so the answer is a list, and an
  // **empty** one is the caster saying "none of them". That is why the
  // required half asks whether the field is `undefined` rather than whether it
  // is empty, and why {@link foughtFor} never elides it.
  if (statesFoughtFact(definition)) {
    if (request.fought === undefined) {
      return err(
        'fought_fact_required',
        `${definition.name} rolls each target's save with Advantage if you or your allies are fighting that creature, and the engine does not know which; name them, or name none`,
      );
    }
    // The same two checks the designation above makes, because it is the same
    // kind of list: creatures the caller named, which the engine validates and
    // never invents. A duplicate changes no outcome — both are read as
    // membership — and is refused for the reason a duplicate designation is,
    // that a caller listing one creature twice has lost track of its own list.
    for (const who of request.fought) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
    }
    if (new Set(request.fought).size !== request.fought.length) {
      return err(
        'duplicate_fought_target',
        `${definition.name} may not be told the same creature is being fought twice`,
      );
    }
  } else if (request.fought !== undefined) {
    return err(
      'no_fought_clause',
      `${definition.name} does not change its save for a creature you are fighting; which of them you are fighting is not a fact it asks for`,
    );
  }

  // — where the orb leaps ———————————————————————————————————————————————————
  //
  // SRD Chromatic Orb's "a different target of your choice within 30 feet of
  // the target": a list the caller names and the engine validates, in the
  // caller's order because the order is the choice. Refused where the spell
  // prints no leap, never required where it does — a caster who names nobody
  // has an orb that does not leap, which is a legal reading of "of your
  // choice" and not a missing fact. The distance is measured at each leap
  // rather than here, because it is measured from the creature the orb has
  // just struck, and the first of those is the only one known now.
  if (request.leapTo !== undefined) {
    if (
      !definition.effects.some((effect) => effect.kind === 'attack' && effect.leaps !== undefined)
    ) {
      return err(
        'no_leap_clause',
        `${definition.name} does not leap from one creature to another; where it would go next is not a fact it asks for`,
      );
    }
    for (const who of request.leapTo) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
      if (request.targets.includes(who)) {
        return err(
          'leap_to_a_target',
          `${definition.name} leaps to a different creature, and ${who} is one it is already aimed at`,
        );
      }
    }
    if (new Set(request.leapTo).size !== request.leapTo.length) {
      return err(
        'duplicate_leap_target',
        `${definition.name} may target a creature only once per casting, so it may not be told to leap to the same creature twice`,
      );
    }
  }

  // — who among them consents ——————————————————————————————————————————————
  //
  // The ninth stated fact. It takes **half** the symmetry the eight before it
  // take: refused where the spell prints neither consent clause, and *not*
  // required where it prints one. SRD Mage Armor cast on its own caster states
  // nothing and is right to — the caster consents by casting — and SRD
  // Levitate cast at a goblin states nothing either, because "unwilling" is
  // the book's own default and the die is what the sentence gives them. What
  // is missing where the gate applies is asked for at the target, in
  // `namedTargets`, and is `needs-context` rather than a refusal.
  //
  // The three checks beside it are the fought list's, because it is the same
  // kind of list: creatures the caller named, which the engine validates and
  // never invents. The third is this fact's own — consent is said **about a
  // creature this casting is aimed at**, so a name that is not in the target
  // list is a caller who has lost track of which casting they are describing,
  // and quietly ignoring it would be a caller who thinks they said something.
  if (statesWillingFact(definition)) {
    for (const who of request.willing ?? []) {
      if (creatureOf(state, who) === null) return unknownCreature(who);
    }
    if (new Set(request.willing ?? []).size !== (request.willing ?? []).length) {
      return err(
        'duplicate_willing_target',
        `${definition.name} may not be told the same creature consents twice`,
      );
    }
    const aimed = new Set(request.targets);
    const strangers = (request.willing ?? []).filter((who) => !aimed.has(who));
    if (strangers.length > 0) {
      return err(
        'willing_not_a_target',
        `${definition.name} is not being cast on ${strangers.join(', ')}, so whether they consent is not a fact about this casting`,
      );
    }
  } else if (request.willing !== undefined) {
    return err(
      'no_willing_clause',
      `${definition.name} neither asks its targets to consent nor offers a save to a creature that does not; who is willing is not a fact it asks for`,
    );
  }

  // — where a teleport goes ————————————————————————————————————————————————
  //
  // The fourth stated fact, and the same two refusals: **required** where the
  // spell teleports, **refused** where it does not. SRD Misty Step's "an
  // unoccupied space you can see" and Dimension Door's "the spot desired" are
  // both a decision the caster makes and the engine could not make for them —
  // and a destination quietly ignored is a caller who thinks they said
  // something.
  if (teleportOf(definition) !== null) {
    if (request.teleportTo === undefined) {
      return err(
        'destination_required',
        `${definition.name} teleports its target and the engine will not choose where; name the space`,
      );
    }
  } else if (request.teleportTo !== undefined) {
    return err(
      'no_teleport_clause',
      `${definition.name} does not teleport anybody; where they would go is not a fact it asks for`,
    );
  }

  // — which weapon it was aimed at ————————————————————————————————————————
  //
  // The sixth stated fact, and the same two refusals a fifth time. SRD
  // Shillelagh's "A Club or Quarterstaff you are holding" and Magic Weapon's
  // "You touch a nonmagical weapon" both name one object out of whatever the
  // target is carrying, and a Druid holding both has two answers.
  //
  // **Only the symmetry lives here**, because the rest of what a weapon has to
  // be — an item that exists, an item that is a weapon, one the spell's own
  // list names, one the target actually has — is read off the catalogue, and
  // this function holds no content. `resolveSpell`'s pre-flight is where those
  // are asked, beside the teleport destination's, and for the same reason.
  // **A rider on the fist names no weapon** — SRD Alter Self's claws — and
  // a casting that named one for it is refused as any weaponless spell is.
  const imbuesAnObject = weaponRiderOf(definition)?.unarmed !== true && weaponRiderOf(definition) !== null;
  if (imbuesAnObject) {
    if (request.weapon === undefined) {
      return err(
        'weapon_required',
        `${definition.name} imbues one weapon and the engine will not choose which; name it`,
      );
    }
  } else if (request.weapon !== undefined) {
    return err(
      'no_weapon_clause',
      `${definition.name} does nothing to a weapon; which one is not a fact it asks for`,
    );
  }

  // — which object it was aimed at ————————————————————————————————————————
  //
  // The eighth stated fact, and the same two refusals a sixth time. Two
  // clauses ask: SRD Remove Curse breaks "its owner's Attunement to the
  // object", and SRD Heat Metal heats one and makes its holder let go of it.
  // Either way a creature carrying three things has three answers, so the
  // caster says which and the engine says none.
  //
  // **Only the symmetry lives here**, for the weapon's reason above it: that
  // the object reaches an item and that the relation the spell needs really
  // holds — attuned to it, wearing it — both need the catalogue, which this
  // function has none of, and both are asked in `resolveSpell`'s pre-flight
  // before anything is spent.
  if (namesAnObject(definition)) {
    if (request.object === undefined) {
      return err(
        'object_required',
        `${definition.name} is aimed at one object and the engine will not choose which; name it`,
      );
    }
  } else if (request.object !== undefined) {
    return err(
      'no_object_clause',
      `${definition.name} does nothing to an object; which one is not a fact it asks for`,
    );
  }

  // — which form a summons takes —————————————————————————————————————————
  //
  // The seventh stated fact, and the same two refusals. SRD Find Familiar:
  // "an animal form you choose: Bat, Cat, … or another Beast that has a
  // Challenge Rating of 0" — the list is the spell's, the pick is the
  // caster's, and the engine makes neither. Only the symmetry lives here;
  // whether the block exists and is one the spell admits needs the catalogue,
  // and is asked in `resolveSpell`'s pre-flight beside the weapon's.
  if (statedFormOf(definition) !== null) {
    if (request.form === undefined) {
      return err(
        'form_required',
        `${definition.name} leaves the form to its caster and the engine will not choose one; name the stat block`,
      );
    }
  } else if (request.form !== undefined) {
    return err(
      'no_form_clause',
      `${definition.name} names its own stat block; which form is not a fact it asks for`,
    );
  }

  // — which of the spell's printed branches this casting runs ————————————
  //
  // The tenth stated fact, and the same two refusals a seventh time. SRD
  // Command prints five words and a casting speaks one; SRD Thaumaturgy
  // prints six wonders and works one; SRD Enlarge/Reduce prints two halves
  // and does one of them. The list is the spell's, the pick is the caster's,
  // and the engine makes neither — speaking Approach because it is printed
  // first would be the engine answering "Choose the command" for ever.
  const branches = definition.options;
  // **And whether the word is one or one per creature.** SRD Calm Emotions
  // prints "(choose for each creature)", so its request carries a map and no
  // word; every other spell with branches carries a word and no map. Which
  // creatures the map must cover is checked where the targets are settled —
  // `perTargetOptionProblem` — because an area's caught list does not exist
  // yet here; what this door refuses is the wrong *shape* of answer, and a
  // branch name the spell does not print.
  if (definition.optionPerTarget !== true && request.optionByTarget !== undefined) {
    return err(
      'no_per_target_option_clause',
      `${definition.name} chooses its branch once for the whole casting; a branch per creature is not a fact it asks for`,
    );
  }
  if (branches !== undefined && definition.optionPerTarget === true) {
    if (request.option !== undefined) {
      return err(
        'option_per_target',
        `${definition.name} chooses for each creature, so one word for the whole casting is not how it is asked; name a branch per creature`,
      );
    }
    if (request.optionByTarget === undefined) {
      return err(
        'option_by_target_required',
        `${definition.name} prints ${Object.keys(branches).sort().map((key) => branches[key]!.label).join(', ')} and chooses for each creature; name which each caught creature gets`,
      );
    }
    const names = Object.keys(branches).sort();
    for (const [who, named] of Object.entries(request.optionByTarget)) {
      if (!names.includes(named)) {
        return err(
          'unknown_option',
          `${definition.name} prints ${names.join(', ')}, not ${named} (named for ${who})`,
        );
      }
    }
  } else if (branches === undefined) {
    if (request.option !== undefined) {
      return err(
        'no_option_clause',
        `${definition.name} prints no branches to choose between; which one is not a fact it asks for`,
      );
    }
  } else {
    const names = Object.keys(branches).sort();
    if (request.option === undefined) {
      return err(
        'option_required',
        `${definition.name} prints ${names.map((key) => branches[key]!.label).join(', ')} and the engine will not choose between them; name which`,
      );
    }
    if (!names.includes(request.option)) {
      return err(
        'unknown_option',
        `${definition.name} prints ${names.join(', ')}, not ${request.option}`,
      );
    }
  }

  // — the one value the spell asks its caster to choose ————————————————————
  //
  // The fifth stated fact, and the same two refusals a fourth time. The list
  // is the spell's, the answer is the caster's, and the engine makes neither:
  // picking Blinded because Blindness/Deafness prints it first is the engine
  // answering "(your choice)" on the caster's behalf, and it would answer the
  // same way for ever.
  const choice = definition.choiceStated;
  // **And which branch was named decides whether it is asked for**, which is
  // why this reads the option and therefore runs after it. SRD Bestow Curse
  // prints "Choose one ability" inside the **first** of its four bullets and
  // asks nothing of the other three, so a casting that curses the target's
  // attacks against the caster is a casting the book puts no question to. The
  // test is the validator's own: does the list this casting actually runs hold
  // a slot for the value — `statedChoiceReaches` over `optionEffects`, the two
  // functions the resolution and the schema already share, so a branch that
  // grows a slot starts being asked the same day.
  //
  // Identity for every spell that prints no branches, which is all but a
  // handful: the common list is the list, and the question is the spell's.
  const asked =
    choice !== undefined &&
    statedChoiceReaches(optionEffects(definition, request.option), choice.of, choice.options[0]!);
  // SRD Wild Companion: the feature a casting comes through may fix the value
  // — "the familiar is Fey" — in which case the caster is not asked, and is
  // refused if they answer otherwise.
  if (fixedChoice !== undefined && request.choice !== undefined && request.choice !== fixedChoice) {
    return err(
      'choice_fixed',
      `${definition.name} is cast through a feature that fixes ${fixedChoice}, not ${request.choice}`,
    );
  }
  const answered = request.choice ?? fixedChoice;
  if (!asked) {
    if (answered !== undefined) {
      return err(
        'no_choice_clause',
        `${definition.name} offers the caster no choice; which one this is is not a fact it asks for`,
      );
    }
  } else if (answered === undefined) {
    return err(
      'choice_required',
      `${definition.name} prints ${choice!.options.join(', ')} and the engine will not choose between them; name which`,
    );
  } else if (!choice!.options.includes(answered)) {
    return err(
      'unknown_choice',
      `${definition.name} prints ${choice!.options.join(', ')}, not ${answered}`,
    );
  }

  // — the creature types the casting states, where the spell prints several —
  //
  // SRD Magic Circle: "Choose one or more of the following types of creatures".
  // The list is the spell's, the answer is the caster's, and the engine makes
  // neither — the discipline the single choice above follows, over a list.
  const printedTypes = definition.typesStated;
  if (printedTypes === undefined) {
    if (request.types !== undefined) {
      return err(
        'no_types_clause',
        `${definition.name} offers the caster no choice of creature types; which they are is not a fact it asks for`,
      );
    }
  } else if (request.types === undefined || request.types.length === 0) {
    return err(
      'types_required',
      `${definition.name} prints ${printedTypes.options.join(', ')} and the engine will not choose among them; name one or more`,
    );
  } else {
    const off = request.types.filter((type) => !printedTypes.options.includes(type));
    if (off.length > 0) {
      return err(
        'type_not_offered',
        `${definition.name} prints ${printedTypes.options.join(', ')}, not ${off.join(', ')}`,
      );
    }
    if (new Set(request.types).size !== request.types.length) {
      return err(
        'duplicate_designation',
        `${definition.name} may not name the same creature type twice`,
      );
    }
  }

  // SRD Transmuted Spell prints its own list — "Acid, Cold, Fire, Lightning,
  // Poison, Thunder" — and the caster restates the type out of it. Where both
  // the spell and the option print one, the spell's is the narrower question
  // and answers first: a Chromatic Orb already offers its caster the choice and
  // the option has bought nothing it did not have.
  // **And which branch was named decides whether the type is asked for**, the
  // rule the choice above already keeps: SRD Alter Self prints its growths
  // inside Natural Weapons alone — "claws (Slashing), fangs (Piercing) …" — and
  // a caster choosing gills is asked nothing. The test is the same one the
  // choice uses: does the list this casting actually runs hold a slot.
  const typeReaches =
    definition.damageTypeStated === undefined ||
    definition.options === undefined ||
    optionEffects(definition, request.option).some(
      (effect) => 'damageType' in effect && effect.damageType !== undefined,
    );
  const types = typeReaches
    ? (definition.damageTypeStated ?? bought.restatesDamageType?.among)
    : bought.restatesDamageType?.among;
  if (types === undefined) {
    if (request.damageType !== undefined) {
      return err(
        'damage_type_fixed',
        `${definition.name} prints one damage type; naming another is not a choice the spell offers`,
      );
    }
    return ok(null);
  }
  // An option that bought the restatement did not buy a *requirement* to make
  // it: SRD's "you can spend 1 Sorcery Point to change that damage type" is a
  // permission, and a caster who elects it and names nothing has simply cast
  // the spell as printed. Only a spell that prints a list demands an answer.
  if (definition.damageTypeStated === undefined && request.damageType === undefined) {
    return ok(null);
  }

  // **Stated or refused, never defaulted.** Picking Radiant because most
  // clerics are good would be the engine answering a question the SRD asked
  // about the caster — and a Necrotic-immune Undead is where that answer
  // shows.
  //
  // The two spells that print a list state it for opposite reasons — Spirit
  // Guardians reports a fact the SRD decides about the caster, Protection from
  // Energy makes a choice the caster is offered — so the refusal names the
  // list and leaves the reason to the spell. It used to say "depending on its
  // caster", which is one of those two wearing the other's name.
  if (request.damageType === undefined) {
    return err(
      'damage_type_required',
      `${definition.name} prints ${types.join(' or ')} and the engine will not choose between them; name which`,
    );
  }
  if (!types.includes(request.damageType)) {
    return err(
      'unknown_damage_type',
      `${definition.name} prints ${types.join(' or ')}, not ${request.damageType}`,
    );
  }
  return ok(null);
}

function placeArea(
  state: GameState,
  casterId: CharacterId,
  source: AreaSource,
  area: SpellArea,
  request: AreaRequest,
  reach: number | null,
  placed: Point,
): Result<{ readonly origin: AreaOrigin; readonly shape: AreaShape }> {
  if (state.scene === null) {
    return err('no_scene', `${source.name} needs a scene for its area to sit in`);
  }

  // Where it starts. `self` means the caster and refuses to be moved; `point`
  // must be given and must be within the spell's range.
  //
  // **One anchoring for the whole template.** The origin and the point a
  // directional shape is aimed at are read under the same convention, so the
  // axis between them is the difference of two coordinates in one frame and
  // cannot pick up a half-space tilt. A self-origin area is anchored by the
  // caster's own space, so there is no convention left to choose and naming
  // one is refused rather than ignored.
  //
  // **Request, then definition, then `space`.** The definition supplies the
  // footprint the spell wants — which no SRD spell states, because SRD 5.2.1
  // gives no rule for areas on a grid — and the caster keeps the last word,
  // because `CastSpellRequest.anchoring` exists precisely so a caster who
  // wants the other convention can ask for it.
  const anchoring: PointAnchoring = anchoringFor(source, request);

  // **A wall is placed by being drawn**, which is the one template the caster
  // states rather than aims: SRD Wind Wall's "you can shape the wall in any way
  // you choose so long as it makes one continuous path along the ground". The
  // path settles both halves of the placement — where the wall starts and what
  // shape it is — so it is answered before the origin question every other area
  // asks, and the point it rises from is the first space of the path.
  if (area.kind === 'wall') {
    return placeWall(state, casterId, source, area, request, reach);
  }

  let origin: AreaOrigin;
  if (area.origin === 'self') {
    if (request.at !== undefined) {
      return err(
        'area_starts_at_caster',
        `${source.name} originates from you; it cannot be placed elsewhere`,
      );
    }
    // The effective one, not the request’s: a definition that declared an
    // intersection for an area the SRD starts at the caster is refused here as
    // well as by `checkSpellDefinition`, so an unvalidated definition cannot
    // slip a convention past the geometry.
    if (anchoring !== 'space') {
      return err(
        'area_starts_at_caster',
        `${source.name} originates from you; its area is anchored by your own space`,
      );
    }
    origin = { creature: casterId };
  } else {
    if (request.at === undefined) {
      return err('no_origin', `${source.name} needs a point to centre its area on`);
    }
    if (reach !== null) {
      const away = distanceToPoint(state.scene, casterId, request.at);
      if (!away.ok) return away;
      if (away.value > reach) {
        return err(
          'out_of_range',
          `${source.name} reaches ${reach} feet; that point is ${away.value} away`,
        );
      }
    }
    origin = areaPointAt(request.at, anchoring);
  }

  // **And a path belongs to the one template that is drawn.** A Sphere stated
  // with a path is a caller who believes they have shaped something, and a
  // stated fact nobody reads is exactly the silence `not_directional` below
  // refuses on the other side of the same question.
  if (request.path !== undefined) {
    return err(
      'area_is_not_drawn',
      `a ${area.kind} is the shape its own dimensions make; only a wall is drawn space by space`,
    );
  }

  // A Cone, Cube or Line has to be pointed somewhere.
  const towards = request.towards;
  if (DIRECTIONAL_AREAS.has(area.kind) && towards === undefined) {
    return err(
      'no_direction',
      `${source.name} forms a ${area.kind} and needs a direction to point it in`,
    );
  }
  if (!DIRECTIONAL_AREAS.has(area.kind) && towards !== undefined) {
    return err('not_directional', `a ${area.kind} has no direction to point`);
  }

  // A self-origin area is anchored by the caster's space, so its direction is
  // read the same way; otherwise the origin's own convention carries.
  const aim = areaPointAt(towards ?? placed, area.origin === 'self' ? 'space' : anchoring);

  let shape: AreaShape;
  switch (area.kind) {
    case 'sphere':
      shape = { kind: 'sphere', radius: area.radius };
      break;
    case 'cylinder':
      shape = { kind: 'cylinder', radius: area.radius, height: area.height };
      break;
    case 'emanation':
      shape = { kind: 'emanation', distance: area.distance };
      break;
    case 'cone':
      shape = { kind: 'cone', length: area.length, towards: aim };
      break;
    case 'cube':
      shape = { kind: 'cube', size: area.size, towards: aim };
      break;
    case 'line':
      shape = { kind: 'line', length: area.length, width: area.width, towards: aim };
      break;
  }

  return ok({ origin, shape });
}

/**
 * A wall, drawn by whoever cast it and judged against what the book allows.
 *
 * SRD Wind Wall: "A wall of strong wind rises from the ground **at a point you
 * choose within range**. You can make the wall **up to 50 feet long**, 15 feet
 * high, and 1 foot thick. You can shape the wall in any way you choose so long
 * as it makes **one continuous path along the ground**."
 *
 * Four sentences and every one of them is a check the engine can make, which
 * is what separates this from the geometry it sits beside: nothing is
 * measured from a point, and the whole of the adjudication is whether the
 * shape the caster drew is a shape the spell permits.
 *
 * | The book | What is checked |
 * |---|---|
 * | "at a point you choose within range" | the first space, against the spell's Range |
 * | "up to 50 feet long" | the count of spaces, at five feet each |
 * | "one continuous path" | each space touches the one before it, and none twice |
 * | "along the ground" | one height for the whole path |
 *
 * **The caller draws and the engine judges**, which is `placeOrigin`'s
 * division and the reason the path is not swept for: a wall the engine chose
 * the shape of is the engine playing, and there is no shortest-path answer to
 * "where would you like your wall".
 */
function placeWall(
  state: GameState,
  casterId: CharacterId,
  source: AreaSource,
  area: Extract<SpellArea, { readonly kind: 'wall' }>,
  request: AreaRequest,
  reach: number | null,
): Result<{ readonly origin: AreaOrigin; readonly shape: AreaShape }> {
  const scene = state.scene;
  if (scene === null) {
    return err('no_scene', `${source.name} needs a scene for its wall to stand in`);
  }

  // A wall is drawn rather than aimed, so a direction stated beside one is a
  // fact nothing reads — the mirror of `not_directional`, which refuses an aim
  // at a shape that has no direction to point.
  if (request.towards !== undefined) {
    return err('not_directional', `a wall is drawn along its own path and has no direction to point`);
  }

  const drawn = request.path ?? [];
  if (drawn.length === 0) {
    return err(
      'no_wall_path',
      `${source.name} is shaped by whoever casts it; name the 5-foot spaces its wall runs through, in order`,
    );
  }

  const path = drawn.map(snapToSpace);

  // "up to 50 feet long", at one space to five feet. A wall of no length is
  // refused above; this is the other end.
  const feet = path.length * SPACE;
  if (feet > area.length) {
    return err(
      'wall_too_long',
      `${source.name} makes a wall up to ${area.length} feet long, and that path is ${feet}`,
    );
  }

  // "one continuous path along the ground", which is three things at once: one
  // height throughout, each space touching the one before it, and no space
  // twice — a path that doubled back over itself would be a wall whose fifty
  // feet had been counted for ground it covers once.
  const seen = new Set<string>();
  let previous: Point | null = null;
  for (const space of path) {
    if (!isInsideScene(scene, space)) {
      return err(
        'outside_scene',
        `${source.name} cannot run through (${space.x}, ${space.y}, ${space.z}); that is outside this scene`,
      );
    }
    const key = `${space.x},${space.y},${space.z}`;
    if (seen.has(key)) {
      return err(
        'wall_not_continuous',
        `${source.name} runs through (${space.x}, ${space.y}, ${space.z}) twice; one continuous path crosses a space once`,
      );
    }
    seen.add(key);

    if (previous !== null) {
      const step = Math.max(Math.abs(space.x - previous.x), Math.abs(space.y - previous.y));
      if (space.z !== previous.z || step !== SPACE) {
        return err(
          'wall_not_continuous',
          `${source.name} makes one continuous path along the ground, and (${space.x}, ${space.y}, ${space.z}) does not touch (${previous.x}, ${previous.y}, ${previous.z})`,
        );
      }
    }
    previous = space;
  }

  // "rises from the ground at a point you choose within range" — the first
  // space of the path is that point, so a caller states the wall and not the
  // wall and its own beginning. One stated beside it has to agree.
  const rises = path[0]!;
  if (request.at !== undefined) {
    const at = snapToSpace(request.at);
    if (at.x !== rises.x || at.y !== rises.y || at.z !== rises.z) {
      return err(
        'no_wall_path',
        `${source.name} rises at the first space of its own path; (${at.x}, ${at.y}, ${at.z}) is not (${rises.x}, ${rises.y}, ${rises.z})`,
      );
    }
  }
  if (reach !== null) {
    const away = distanceToPoint(scene, casterId, rises);
    if (!away.ok) return away;
    if (away.value > reach) {
      return err(
        'out_of_range',
        `${source.name} reaches ${reach} feet; that point is ${away.value} away`,
      );
    }
  }

  return ok({
    origin: areaPointAt(rises, 'space'),
    shape: { kind: 'wall', path, height: area.height },
  });
}

/** One space on the lattice, in feet — SRD: "Each square represents 5 feet." */
const SPACE = 5;

/**
 * Where the point a casting keeps is going to be.
 *
 * SRD Spiritual Weapon: "The force appears **within range in a space of your
 * choice**." Three facts settle it and every one of them is the engine's:
 * the space is on the lattice, it is inside the scene, and it is within the
 * spell's printed Range of the caster.
 *
 * **The caller chooses and the engine validates**, which is the same division
 * `placeArea` makes for an area's point — and the reason `at` is required
 * rather than swept for: a force that appeared somewhere nobody chose is
 * precisely the incoherence the positioning model exists to prevent.
 *
 * Returns null when a *fact* is missing rather than a rule broken: the caster
 * has no position to measure from, or there is no scene for a point to be in.
 * Those go into `needs` and the casting is retried once they are established,
 * having cost nothing.
 */
export function placeOrigin(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  at: Point | undefined,
  reach: number | null,
  needs: ContextRequest[],
): Result<Point | null> {
  if (at === undefined) {
    return err(
      'no_origin',
      `${definition.name} appears in a space of your choice; name the space`,
    );
  }

  if (state.scene === null) {
    needs.push({
      kind: 'scene',
      subject: casterId,
      need: 'a scene, so that a point in it means something',
      because: `${definition.name} leaves something standing at a point you choose`,
      satisfyWith: 'a setScene command',
    });
    return ok(null);
  }

  // "A space of your choice" — a space is a cube on the lattice, and a stored
  // coordinate should be one the engine could have produced itself.
  const space = snapToSpace(at);

  if (!isInsideScene(state.scene, space)) {
    return err(
      'outside_scene',
      `${definition.name} cannot put anything at (${space.x}, ${space.y}, ${space.z}); that is outside this scene`,
    );
  }

  if (reach !== null) {
    const away = distanceToPoint(state.scene, casterId, space);
    if (!away.ok) {
      needs.push({
        kind: 'position',
        subject: casterId,
        need: `where ${casterId} is standing`,
        because: `${definition.name} appears within ${reach} feet of you`,
        satisfyWith: `a placeCreatureInScene command for ${casterId}`,
      });
      return ok(null);
    }
    if (away.value > reach) {
      return err(
        'out_of_range',
        `${definition.name} reaches ${reach} feet; that space is ${away.value} away`,
      );
    }
  }

  return ok(space);
}

/**
 * Which creatures an area catches, and where the caller has to put it.
 *
 * The geometry is `positioning.ts`'s and is not reimplemented here: all six
 * SRD shapes, measured between volumes on the 5-foot lattice, with the origin
 * included or excluded per shape. What this adds is the spell's half — whether
 * the caller supplied the point and direction the shape needs, whether the
 * point is in range, and which of the creatures caught are ones this spell can
 * actually affect.
 *
 * **The casting's catch is settled once, here, and everything the casting
 * does reads it** — the saves, the damage, the riders, the record. So the
 * three clauses that narrow it ({@link TargetRule.notTheCaster},
 * `mustSeeTheOrigin`, `chosenFromTheArea`) are applied at this one seam and
 * nothing below has to know they exist.
 *
 * **What this is not is every catch the spell will ever make.** A persistent
 * area catches people again at the boundaries it prints, and that later catch
 * is `creaturesStandingInCastingArea` re-deriving it off the pinned record —
 * a different seam, reading `unaffected` and none of the three. So a spell
 * that printed both a filter and an `areaTrigger` would narrow its first
 * catch and not its later ones, and `checkSpellDefinition` refuses the pair
 * (`area_filter_and_a_later_catch`) rather than letting half a rule through.
 *
 * `unverified` is the caller's list, appended to rather than returned, for the
 * reason `namedTargets` takes its `needs` that way: a sight question about a
 * *point* is one nobody can answer — there is no pairwise line to declare — so
 * it is reported beside the outcome rather than refused. A caller that passes
 * nothing simply loses the report, which is right for a source that prints no
 * clause needing one.
 */
export function areaTargets(
  state: GameState,
  casterId: CharacterId,
  source: AreaSource,
  area: SpellArea,
  request: AreaRequest,
  reach: number | null,
  unverified: string[] = [],
): Result<readonly CharacterId[]> {
  // SRD "each creature of your choice" is the one sentence that makes a target
  // list mean something for an area: the geometry still says who *could* be
  // caught and the caster says which of them are. Every other area catches
  // whoever is standing in it, and a list there is a caller who has misread
  // the spell.
  if (request.targets.length > 0 && source.chosenFromTheArea !== true) {
    return err(
      'area_picks_its_own_targets',
      `${source.name} fills an area and catches whoever is in it; it does not take a target list`,
    );
  }

  const caught = areaCatch(state, casterId, source, area, request, reach, unverified);
  if (!caught.ok) return caught;
  const shortlist = caught.value;
  if (source.chosenFromTheArea !== true) return ok(shortlist);

  // SRD Sleep: "Each creature **of your choice** in a 5-foot-radius Sphere."
  //
  // The area has said who could be caught; this is the caster saying which of
  // them are. A name that is not on that shortlist is a refusal rather than a
  // filter, because unlike a creature type it is not a fact about the world
  // the spell shrugs at — it is the caster aiming at somebody the spell does
  // not reach, and quietly dropping them would be the engine casting a
  // different spell from the one it was asked for.
  //
  // **Not `outside_area`, and the two are worth keeping apart.** That one is
  // `namedTargets`' answer for a `targetsWithin` bound — a template that
  // merely *fences* a list the caller named, where being outside it is a
  // matter of geometry alone. This is an area's own catch, which the dead, a
  // creature type the spell cannot touch and Total Cover have already been
  // taken out of, so the list a caller is held to here is a different list and
  // the remedy names different creatures.
  const outside = request.targets.filter((who) => !shortlist.includes(who));
  if (outside.length > 0) {
    return err(
      'not_in_the_area',
      `${source.name} catches only creatures inside its area, and ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not among ${shortlist.length === 0 ? 'the nobody it caught' : shortlist.join(', ')}`,
    );
  }
  if (request.targets.length === 0 && shortlist.length > 0) {
    // **A choice the spell prints and the caster has not made**, answered the
    // way `choice_required` and `damage_type_required` answer theirs: the
    // engine names the options and will not pick between them. A silence read
    // as "nobody" would be every casting written before this clause quietly
    // affecting no one, which is the confident wrong answer rather than the
    // missing one.
    return err(
      'area_choice_required',
      `${source.name} catches each creature of your choice in its area and the engine will not choose between them; name which of ${shortlist.join(', ')} in \`targets\``,
    );
  }
  if (new Set(request.targets).size !== request.targets.length) {
    return err('duplicate_target', `${source.name} may not take the same target twice`);
  }
  return ok(request.targets.slice().sort());
}

/** Why one creature the geometry caught is not on the list after all. */
export interface AreaRejection {
  readonly target: CharacterId;
  readonly reason: string;
}

/**
 * **The catch itself**: every creature the template covers that this source
 * can actually affect, sorted, before "each creature of your choice" has a
 * word to say about it.
 *
 * Split out of {@link areaTargets} because two callers want it and only one of
 * them wants the choice: the casting is held to the subset the caster named,
 * and {@link eligibleTargets} is the shortlist the caster picks that subset
 * *from*. A shortlist derived any other way is a door offering creatures the
 * refusal below would then reject, which is the one thing a shortlist may not
 * do.
 *
 * `rejected` is the second optional collector beside `unverified`, filled only
 * when a caller passes one: the shortlist has to say why each creature the
 * geometry caught is not on the list, and writing those sentences twice is how
 * the two halves drift apart. A casting passes nothing and pays nothing.
 */
export function areaCatch(
  state: GameState,
  casterId: CharacterId,
  source: AreaSource,
  area: SpellArea,
  request: AreaRequest,
  reach: number | null,
  unverified: string[] = [],
  rejected?: AreaRejection[],
): Result<readonly CharacterId[]> {
  if (state.scene === null) {
    return needsContext(
      'no_scene',
      `${source.name} fills an area and there is no scene for it to fill`,
      [
        {
          kind: 'scene',
          subject: casterId,
          need: 'a scene, so that an area has somewhere to be',
          because: `${source.name} fills an area`,
          satisfyWith: 'a setScene command',
        },
      ],
    );
  }

  const placed = positionOf(state.scene, casterId);
  if (placed === null) {
    return needsContext(
      'unplaced',
      `nobody has said where ${casterId} is standing, and ${source.name} starts its area there`,
      [
        {
          kind: 'position',
          subject: casterId,
          need: `where ${casterId} is standing`,
          because: `${source.name} starts its area at the caster`,
          satisfyWith: `a placeCreatureInScene command for ${casterId}`,
        },
      ],
    );
  }

  const placement = placeArea(state, casterId, source, area, request, reach, placed);
  if (!placement.ok) return placement;

  const caught = creaturesInArea(state.scene, placement.value.origin, placement.value.shape);
  if (!caught.ok) return caught;

  // Where the area sits, as a space on the lattice, for the one clause that
  // asks a question *about the place* rather than about a creature. An
  // intersection-anchored template has none — "a corner is not a space", which
  // `areaFrame` says in as many words — and neither has a self-origin area
  // whose carrier nobody has placed. Null is then the unsettled answer rather
  // than a guessed coordinate, and the clause below reports it.
  const where = placement.value.origin;
  const originSpace: Point | null =
    'creature' in where
      ? positionOf(state.scene, where.creature)
      : 'space' in where
        ? snapToSpace(where.space)
        : null;

  // A creature the spell cannot affect is filtered out, not refused. "Each
  // Humanoid in the area" leaves the ogre standing there unbothered; it does
  // not make the casting illegal, which is the difference between an area and
  // a target a caller named.
  const wanted = source.mustBeType;
  /** Out, and why — the sentence written once for both halves. */
  const out = (who: CharacterId, reason: string): false => {
    rejected?.push({ target: who, reason });
    return false;
  };
  const eligible = caught.value.filter((who: CharacterId) => {
    const creature = state.creatures[who];
    if (creature === undefined) return false;
    if (creature.vitals.dead) return out(who, `${who} is dead`);
    // The same comparison the outcome side makes, rather than a second one
    // spelled alike: an undeclared type is not a match here, and an area
    // *filters* rather than asking, because "each Humanoid in the area" leaves
    // the ogre standing there unbothered.
    // **What magic sees**, which is the mask where one is standing and the
    // creature's own type otherwise — SRD Arcanist's Magic Aura: "Spells and
    // other magical effects treat the target as if it were a creature of the
    // chosen type." An area a casting filled and a Channel Divinity option's
    // emanation are both magical effects, and both come through here.
    const magicSees = typeMagicSees(creature);
    if (wanted !== undefined && !isCreatureType(magicSees, wanted)) {
      return out(
        who,
        `${source.name} touches only a ${wanted}, and ${who} is ${magicSees ?? 'a creature nobody has said the kind of'}`,
      );
    }
    // SRD Entangle: "Each creature (other than you) in the area". The caster
    // stands in their own grasping plants and is simply not caught — a filter
    // like every other one here, so a druid who conjures the square they are
    // standing in has cast a legal spell rather than a refused one.
    if (source.notTheCaster === true && who === casterId) {
      return out(who, `${source.name} catches every creature in its area other than you`);
    }
    // SRD Hypnotic Pattern: "Each creature in the area who can see the
    // pattern."
    //
    // **One question, asked once.** This used to compose two facts that lived
    // in two places — the looker's Blinded condition here, and the line to the
    // pattern in `canSeePoint` — because the helper deliberately did not read
    // the condition while `canSee` did not either. Both read it now, so the
    // clause is the helper's answer and nothing else, and a blind creature
    // gets the same answer from this spell as from every other sight question
    // in the engine. `canSeePoint` takes the null origin too, for the same
    // reason: a place with no coordinates is still a place a blind creature
    // cannot see.
    //
    // **Unsettled is caught, and reported.** Nobody can declare a line of
    // sight to a patch of air, so a null here is not homework anybody could
    // do — it is the ruling SRD Faerie Fire's gate already takes, applied and
    // then named in the outcome so the table can overrule it.
    if (source.mustSeeTheOrigin === true) {
      const seen = canSeePoint(state, who, originSpace);
      if (seen === false) {
        return out(who, `${source.name} catches only a creature that can see it, and ${who} cannot`);
      }
      if (seen === null) {
        unverified.push(
          `${source.name}: nobody has said whether ${who} can see the point it fills, and it catches only a creature that can; ${who} was caught rather than passed over`,
        );
      }
    }
    // SRD: "A spell's area of effect is blocked by Total Cover." Cover here is
    // declared pairwise from the caster rather than traced through the area,
    // which is the documented approximation the whole cover model makes.
    if (state.scene !== null && coverBetween(state.scene, casterId, who) === 'total') {
      return out(who, `${who} is behind Total Cover`);
    }
    // SRD Tiny Hut: "the effects of such spells can't extend into it." A ward
    // standing between the caster and a creature the geometry caught takes the
    // creature out of the catch, the way `chosen` and Total Cover do — asked of
    // the casting's level, so a Cone of Cold at level 5 reaches in and a
    // Fireball at level 3 does not. See `wardBetween`.
    if (source.castLevel !== undefined) {
      const ward = wardBetween(state, casterId, who, source.castLevel);
      if (ward !== null) {
        return out(who, `${who} is on the other side of ${ward}, and ${source.name} cannot extend into it`);
      }
    }
    return true;
  });

  return ok(eligible.slice().sort());
}

/** The other half: a list of ids somebody chose, each checked as itself. */
export function namedTargets(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  request: CastSpellRequest,
  castLevel: number,
  reach: number | null,
  needs: ContextRequest[],
  /** The point this casting keeps, already placed and checked. */
  origin: Point | null,
  /**
   * The caster's level as this casting pinned it, which a cantrip's roll count
   * is read off — an item's is the item's, exactly as its dice are.
   */
  casterLevel: number,
): Result<readonly CharacterId[]> {
  // Two shapes take both a point and a target list, for different reasons: a
  // bounded list, where the point places the area the targets must stand in,
  // and a casting with an origin, where the point is what the targets are
  // measured *from*.
  const bound = definition.targetsWithin;
  const takesPoint = bound !== undefined || definition.origin !== undefined;
  if (!takesPoint && (request.at !== undefined || request.towards !== undefined)) {
    return err(
      'not_an_area',
      `${definition.name} is cast on a target, not at a place`,
    );
  }
  // A point a casting *keeps* is a place, not a template, so there is nothing
  // to aim it along.
  if (bound === undefined && request.towards !== undefined) {
    return err('not_directional', `${definition.name} has no direction to point`);
  }

  // **A creature is named for a roll**, so a spell that makes several of them
  // may name up to that many however few its `TargetRule` prints: SRD Eldritch
  // Blast is written "against one creature" and its beams are what buy the
  // second and the third. The larger of the two rather than either alone —
  // the target rule still speaks for every spell that rolls one attack or
  // none, and a spell whose rolls outnumber its printed targets is saying that
  // each roll picks its own.
  //
  // **A spell that aims at nobody at this slot keeps aiming at nobody.** Detect
  // Magic and the object spells take no creature, and one of them rolling an
  // attack — SRD Fire Bolt hits "a creature **or object**" — must not become a
  // spell that takes a creature because it has a roll to spend on one.
  //
  // Asked of the **scaled** count and never of the printed base, which is the
  // difference between a spell that names nobody and one whose base happens to
  // be zero: `{ count: 0, extraPerSlotLevelAbove: 2 }` is a legal target rule
  // that names two creatures a slot level up, and reading `targets.count`
  // here would refuse it at every slot.
  const printed = targetCountFor(definition.targets, definition.level, castLevel);
  const allowed =
    printed === 0
      ? 0
      : Math.max(
          printed,
          aimedRollsIn(definition.effects, definition.level, casterLevel, castLevel),
        );

  // A spell that aims at nobody. SRD's "Range: Self" utility spells — Detect
  // Magic, Disguise Self — and the ones that act on an object or a point, like
  // Light and Mage Hand. They are cast, they cost what they cost and they run
  // for their duration; there is simply no creature to check.
  const unlimited = definition.targets.unlimited === true;
  if (allowed === 0 && !unlimited) {
    if (request.targets.length > 0) {
      return err('takes_no_target', `${definition.name} is not cast on a creature`);
    }
    return ok([]);
  }

  if (request.targets.length === 0) {
    // SRD Spiritual Weapon: "you **can** immediately make one melee spell
    // attack." The force appears whether or not anything is standing beside
    // it, and refusing that would be a rule the book does not have.
    if (definition.targets.optional === true) return ok([]);
    return err('no_targets', `${definition.name} needs a target`);
  }
  // "Each creature of your choice" states no number, so there is none to
  // exceed. Range and sight still bound it, target by target, below.
  if (!unlimited && request.targets.length > allowed) {
    return err(
      'too_many_targets',
      `${definition.name} at level ${castLevel} takes ${allowed} target(s), got ${request.targets.length}`,
    );
  }
  if (new Set(request.targets).size !== request.targets.length) {
    return err('duplicate_target', `${definition.name} may not take the same target twice`);
  }

  // The bound, worked out once. Its point carries the spell's range, so the
  // per-target range check below stands down — SRD reaches 60 feet to place a
  // 30-foot Sphere, and a creature 85 feet away inside it is a legal target.
  let eligible: ReadonlySet<CharacterId> | null = null;
  if (bound !== undefined) {
    if (state.scene === null) {
      return needsContext(
        'no_scene',
        `${definition.name} chooses its targets inside an area and there is no scene for it to sit in`,
        [
          {
            kind: 'scene',
            subject: casterId,
            need: 'a scene, so that an area has somewhere to be',
            because: `${definition.name} bounds its targets by an area`,
            satisfyWith: 'a setScene command',
          },
        ],
      );
    }
    const placed = positionOf(state.scene, casterId);
    if (placed === null) {
      return needsContext(
        'unplaced',
        `nobody has said where ${casterId} is standing, and ${definition.name} measures its area from there`,
        [
          {
            kind: 'position',
            subject: casterId,
            need: `where ${casterId} is standing`,
            because: `${definition.name} places its area within range of you`,
            satisfyWith: `a placeCreatureInScene command for ${casterId}`,
          },
        ],
      );
    }
    const placement = placeArea(state, casterId, areaSourceOf(definition), bound, request, reach, placed);
    if (!placement.ok) return placement;
    const caught = creaturesInArea(state.scene, placement.value.origin, placement.value.shape);
    if (!caught.ok) return caught;
    eligible = new Set(caught.value);
  }

  for (const target of request.targets) {
    if (state.creatures[target] === undefined) {
      return unknownCreature(target);
    }
    if (target === casterId && definition.targets.self !== true) {
      return err('cannot_target_self', `${definition.name} is not cast on yourself`);
    }

    // A type the spell demands is checked; a type nobody has stated is asked
    // for rather than waved through.
    const wanted = definition.targets.mustBeType;
    if (wanted !== undefined) {
      // The mask where one is standing — see `typeMagicSees`, and the area
      // filter above, which asks the same question of the same reader.
      const creature = state.creatures[target];
      const actual = creature === undefined ? null : typeMagicSees(creature);
      if (actual === null) {
        needs.push({
          kind: 'creature-type',
          subject: target,
          need: `what kind of creature ${target} is`,
          because: `${definition.name} may only target a ${wanted}`,
          satisfyWith: `declareCreatureType(${target}, …), or a creatureType when the creature is added`,
        });
      } else if (!isCreatureType(actual, wanted)) {
        return err(
          'wrong_creature_type',
          `${definition.name} may only target a ${wanted}; ${target} is ${actual}`,
        );
      }
    }

    // SRD Mage Armor: "a willing creature who isn’t wearing armor". Unlike a
    // creature type this needs nothing declared — what is worn is already
    // authoritative state, and a creature wearing nothing is a plain no rather
    // than an unknown.
    if (definition.targets.mustBeUnarmored === true) {
      const worn = state.creatures[target]?.sheet.armor ?? null;
      if (worn !== null) {
        return err(
          'target_wearing_armor',
          `${definition.name} is cast on a creature who is not wearing armor; ${target} is wearing ${worn.name}`,
        );
      }
    }

    // SRD Mage Armor: "You touch a **willing** creature". The gate, and the
    // one target clause that is a **question** rather than an answer.
    //
    // A creature type nobody stated is asked for because the fact is a thin
    // record the table keeps; armour, size and falling are the engine's own to
    // read, so each of those is a plain no. Consent is a fourth thing: nothing
    // anywhere holds it, nothing could, and there is no declaration that would
    // — so this is homework the **caller** does, by sending the casting again
    // with the creature named. `route` is the kind for that, which is the
    // reading SRD Alert's "one willing ally" already takes in `declarations.ts`
    // and the reason `cast_spell` answers it on itself.
    //
    // **Never assumed.** The engine holds no rule that an ally consents: side
    // is a different question and a table's habit is not a sentence in the
    // book, so a silence here is asked about rather than read as a yes. And
    // never refused either — the fact is merely missing, which is CLAUDE.md's
    // rule 6 and the difference between a door and a wall.
    //
    // The caster is exempt because casting it *is* the consent.
    if (
      definition.targets.willing === true &&
      target !== casterId &&
      request.willing?.includes(target) !== true
    ) {
      return needsContext(
        'consent_not_stated',
        `${definition.name} is cast on a willing creature and nobody has said whether ${target} consents; send the same casting naming them willing`,
        [
          {
            kind: 'route',
            subject: target,
            need: `whether ${target} consents to ${definition.name}`,
            because: `${definition.name} is cast on a willing creature, and consent is the table’s fiction rather than anything the engine holds — allegiance is a different question`,
            satisfyWith: `resolveSpell again with ${target} in its willing list`,
          },
        ],
      );
    }

    // SRD Animal Messenger: "A **Tiny** Beast of your choice". A size the
    // spell demands, read the way every other size rule reads one — through
    // `effectiveSizeOf`, so a shape-shifted creature answers as what it now
    // is. A creature nothing anywhere has sized is a plain no rather than a
    // question, for `mustBeUnarmored`'s reason and `mustBeFalling`'s: the fact
    // is the engine's to read, and asking here would tell a caller which
    // declaration to invent in order to widen the spell.
    const sized = definition.targets.mustBeSize;
    if (sized !== undefined) {
      const actual = effectiveSizeOf(state, target);
      if (actual !== sized) {
        return err(
          'wrong_creature_size',
          `${definition.name} is cast on a ${titleSize(sized)} creature; ${target} is ${
            actual === null
              ? 'a creature nothing has given a size — a stat block, a species or a placement would'
              : titleSize(actual)
          }`,
        );
      }
    }

    // SRD Feather Fall: "up to five **falling** creatures within range". The
    // trigger said that *somebody* is falling; this says which of them this
    // casting may reach, and the two are different questions — the thug on the
    // floor watching the climber drop past him answers the first and fails
    // the second. A creature nobody declared falling is a plain no, for the
    // reason `mustBeUnarmored` above is: the fact is the engine's to read, and
    // a question here would tell a caller which declaration to invent.
    if (definition.targets.mustBeFalling === true && fallWindowOpen(state, target) === null) {
      return err(
        'target_not_falling',
        `${definition.name} is cast on a falling creature, and nobody has said ${target} is falling`,
      );
    }

    // SRD Spare the Dying: "a creature within range that has 0 Hit Points and
    // isn't dead". The fourth clause of this kind and the first that reads
    // **vitals** — `dyingProblem` is the one reading of it, asked here so the
    // refusal costs no action and asked again in the resolver so the rule sits
    // where the event is written.
    if (definition.targets.mustBeDying === true) {
      const dying = dyingProblem(state, target, definition.name);
      if (!dying.ok) return dying;
    }

    // SRD Gentle Repose: "You touch a corpse or other remains." The twin, and
    // the only target clause in the book that wants the creature every other
    // one walks past. A plain no, for the reason the three above are: whether
    // a creature is dead is the engine's own to read.
    if (definition.targets.mustBeDead === true && state.creatures[target]?.vitals.dead !== true) {
      return err(
        'target_not_dead',
        `${definition.name} is cast on a corpse, and ${target} is alive`,
      );
    }

    // A creature is always within reach of itself and can always see itself,
    // so a touch laid on the caster's own hand — SRD Light on the torch they
    // hold — measures nothing and asks for no scene to measure it in. What it
    // does **not** skip is a reach measured from a point the spell placed and
    // the bound of an area: a force five feet from the caster is a fact of the
    // map whoever the target is, and so is standing inside a Sphere.
    const self = target === casterId;
    if (state.scene === null) {
      if (!self || origin !== null || eligible !== null) {
        needs.push({
          kind: 'scene',
          subject: target,
          need: 'a scene, so that distances mean something',
          because: `${definition.name} has a range to check`,
          satisfyWith: 'a setScene command',
        });
      }
    } else if (reach !== null) {
      // SRD Hold Person: "a Humanoid that you can see." Unknown is a fact to
      // establish; declared *unseen* is the refusal.
      if (definition.requiresSight === true && !self) {
        // **The caster's senses, because the caster is the one looking.**
        // "A creature *you* can see" names the caster in as many words, and
        // a target's own Darkvision says nothing about whether the caster
        // can pick them out. A declaration still outranks both.
        const seen = canSee(state, casterId, target);
        if (seen === null) {
          needs.push({
            kind: 'visibility',
            subject: target,
            need: `whether ${casterId} can see ${target}`,
            because: `${definition.name} targets a creature you can see`,
            satisfyWith: `a declareSightBetween command from ${casterId} to ${target}`,
          });
        } else if (!seen) {
          return err('cannot_see_target', `${casterId} cannot see ${target}`);
        }
      }

      if (origin !== null) {
        // SRD Spiritual Weapon: "one creature within 5 feet of **the force**."
        // The spell's own Range placed the force; it is not re-spent on the
        // target, so a creature the caster could never reach is fair game and
        // one standing beside the caster may be out of reach entirely.
        const from = definition.origin?.reach ?? 0;
        const away = distanceToPoint(state.scene, target, origin);
        if (!away.ok) {
          needs.push({
            kind: 'position',
            subject: target,
            need: `where ${target} is standing`,
            because: `${definition.name} reaches ${from} feet from the point it holds`,
            satisfyWith: `a placeCreatureInScene command for ${target}`,
          });
        } else if (away.value > from) {
          return err(
            'out_of_range',
            `${definition.name} reaches ${from} feet from where it stands; ${target} is ${away.value} away`,
          );
        }
      } else if (eligible !== null) {
        // The area is the bound, so an unplaced creature is a fact to go and
        // get rather than someone standing outside it.
        if (positionOf(state.scene, target) === null) {
          needs.push({
            kind: 'position',
            subject: target,
            need: `where ${target} is standing`,
            because: `${definition.name} may only be aimed at a creature inside its area`,
            satisfyWith: `a placeCreatureInScene command for ${target}`,
          });
        } else if (!eligible.has(target)) {
          return err(
            'outside_area',
            `${definition.name} may only be aimed at a creature inside its area; ${target} is not in it`,
          );
        }
      } else if (!self) {
        const apart = distanceBetween(state.scene, casterId, target);
        if (!apart.ok) {
          // A creature that is **elsewhere** is a settled fact rather than a
          // missing one: the geometry refuses `not_here`, nobody can place it,
          // and a request to would send the caller to a door that refuses.
          if (apart.code === 'not_here') return apart;
          needs.push({
            kind: 'position',
            subject: target,
            need: `where ${target} is standing`,
            because: `${definition.name} reaches ${reach} feet and the distance is unknown`,
            satisfyWith: `a placeCreatureInScene command for ${target}`,
          });
        } else if (apart.value > reach) {
          return err(
            'out_of_range',
            `${definition.name} reaches ${reach} feet; ${target} is ${apart.value} away`,
          );
        }
      }

      // SRD: "To target something with a spell, a caster must have a clear
      // path to it, so it can't be behind Total Cover."
      if (!self && coverBetween(state.scene, casterId, target) === 'total') {
        return err('total_cover', `${target} is behind Total Cover`);
      }
    }
  }

  return ok(request.targets);
}

/**
 * The split the caster stated, checked and laid out beside the targets.
 *
 * Returns one count per creature of `targets`, **in the order they were
 * named**, or `undefined` where the caster stated nothing — which is the deal
 * {@link rollsDealtTo} has always made and is what keeps every casting written
 * before this field folding exactly as it did.
 *
 * A positional vector rather than a second copy of the ids, because `targets`
 * is already the ordered, deduplicated list a casting pins and everything
 * downstream indexes into it; two lists of ids would be two places for the
 * same creature to be named and one place for them to disagree.
 *
 * Six refusals, and each is a caller saying something that is not a split:
 *
 * | code | what was said |
 * |---|---|
 * | `no_rolls_to_aim` | a casting with at most one attack roll has nothing to divide |
 * | `not_a_roll_count` | a count that is not a whole number of rolls, at least one |
 * | `not_a_target` | rolls aimed at somebody this casting never named |
 * | `duplicate_target` | one creature given two shares |
 * | `missing_roll_count` | a named creature left with no roll, having been named for one |
 * | `wrong_roll_count` | more rays than the casting hurls, or fewer |
 *
 * The count it is measured against is the casting's own — off the slot for a
 * levelled spell and off the caster's level for a cantrip — which is the same
 * `aimedRollsIn` that bounds the target list.
 */
export function rollsAimedAt(
  definition: SpellDefinition,
  request: CastSpellRequest,
  targets: readonly CharacterId[],
  castLevel: number,
  casterLevel: number,
): Result<readonly number[] | undefined> {
  const stated = request.rollsAt;
  if (stated === undefined) return ok(undefined);

  // A field quietly ignored is a caller who thinks they said something. One
  // roll has nowhere to go but the one creature it is owed to, and a casting
  // that rolls no attack at all has nothing to aim.
  const total = aimedRollsIn(definition.effects, definition.level, casterLevel, castLevel);
  if (total <= 1) {
    return err(
      'no_rolls_to_aim',
      `${definition.name} makes ${total === 0 ? 'no attack roll' : 'one attack roll'} at this level, so there is no split of them to state`,
    );
  }

  const named = new Set(targets);
  const share = new Map<CharacterId, number>();
  for (const aim of stated) {
    if (!Number.isInteger(aim.count) || aim.count < 1) {
      return err(
        'not_a_roll_count',
        `${aim.count} is not a number of ${definition.name}'s rolls; a share is a whole number, at least one`,
      );
    }
    if (!named.has(aim.target)) {
      return err(
        'not_a_target',
        `${definition.name} is not aimed at ${aim.target}; its targets are ${targets.join(', ')}`,
      );
    }
    if (share.has(aim.target)) {
      return err(
        'duplicate_target',
        `${definition.name} gives ${aim.target} one share of its rolls, not two`,
      );
    }
    share.set(aim.target, aim.count);
  }

  // **A creature is named for a roll**, which is the sentence that lets a
  // spell's targets outnumber its printed `TargetRule` in the first place — so
  // a target left out of the split was named for nothing.
  const unaimed = targets.filter((target) => !share.has(target));
  if (unaimed.length > 0) {
    return err(
      'missing_roll_count',
      `${definition.name} names ${unaimed.join(', ')} and the split gives ${unaimed.length === 1 ? 'them' : 'each of them'} no roll`,
    );
  }

  const dealt = targets.reduce((sum, target) => sum + share.get(target)!, 0);
  if (dealt !== total) {
    return err(
      'wrong_roll_count',
      `${definition.name} at level ${castLevel} makes ${total} attack roll(s) and the split spends ${dealt}`,
    );
  }

  // **A split that spells out the deal is a casting that said nothing**, and
  // must fold to the same bytes as one: the record reaches a declaration, and
  // two `spell-declared` events meaning one casting would be two states for
  // one log.
  //
  // **The fingerprint deliberately does not do this, and the asymmetry is the
  // point** — do not make it symmetric. This is downstream of the definition
  // and knows the casting's own `total`, so it can tell the deal from a split
  // that merely divides its own sum evenly. `castingIdentity` runs before any
  // definition is fetched and cannot, so it sorts and drops nothing; its
  // docstring says why, and dropping there let an illegal split replay as a
  // casting that had already landed.
  const aimed = targets.map((target) => share.get(target)!);
  const deal = aimed.every((count, index) => count === rollsDealtTo(total, targets.length, index));
  return ok(deal ? undefined : aimed);
}

/** Targets a spell could legally be aimed at, and why the others could not. */
export interface EligibleTargets {
  readonly eligible: readonly CharacterId[];
  readonly excluded: readonly { readonly target: CharacterId; readonly reason: string }[];
  /** Facts that would have to be established before a target can be judged. */
  readonly needsContext: readonly ContextRequest[];
}

/**
 * Who this caster could legally aim this spell at.
 *
 * Working out that "him" means the goblin is interpretation, and belongs to the
 * layer that reads the fiction. What the engine can do is hand that layer the
 * shortlist — so "the obvious target" has something to be obvious about — and
 * say why each of the others is out, so a refusal can be narrated rather than
 * reported.
 *
 * **This is a shortlist, not a substitution mechanism.** Maestro resolves the
 * player's intended target *before* calling `resolveSpell`, which then checks
 * the id it was handed and only that id. Nothing here nominates a replacement,
 * and `resolveSpell` will refuse an ineligible target naming that target even
 * when exactly one legal alternative is standing beside it. A player who said
 * "the goblin" and hit the thug has been lied to about what happened.
 *
 * **An area spell is not a walk over the creatures.** It fills a template, and
 * who is on the list is whoever is standing in the template — so this defers
 * to {@link areaCatch}, the same function the casting settles its catch with,
 * rather than asking each creature the questions a named target is asked. It
 * used to do the latter, and the two then disagreed: Sleep's door offered
 * every Humanoid within sixty feet and the casting refused all but the three
 * inside the five-foot Sphere, and the caster — whom the Sphere really does
 * catch — was left off because the spell's target line prints no `self`.
 *
 * `placement` is the one fact the catch turns on that the definition does not
 * hold, and it is the caller's rather than the engine's: where the area is
 * laid. Absent, the shortlist asks for it instead of guessing a point, and a
 * spell with no area ignores it.
 */
export function eligibleTargets(
  state: GameState,
  content: Content,
  casterId: CharacterId,
  spellId: string,
  slotLevel: number,
  placement?: AreaPlacement,
): EligibleTargets {
  const definition = content.spell(spellId);
  const caster = creatureOf(state, casterId);
  if (definition === null || caster === null) {
    return { eligible: [], excluded: [], needsContext: [] };
  }
  void slotLevel;

  if (definition.area !== undefined) {
    return areaShortlist(state, casterId, definition, definition.area, placement);
  }

  const eligible: CharacterId[] = [];
  const excluded: { target: CharacterId; reason: string }[] = [];
  const needsContext: ContextRequest[] = [];
  // A casting that holds a point reaches its own range to place the point and
  // then the point's reach beyond that, so the bound on who *could* be hit is
  // the sum: Spiritual Weapon's force goes 60 feet out and strikes 5 further.
  // Both numbers are printed; adding them is the shortlist's job, and reading
  // the spell's Range alone would leave a legal target off it.
  //
  // **And a Range the DM decides bounds nobody.** `{ kind: 'dm' }` says the
  // book printed a question rather than a distance, so there is no number to
  // compare against — and the fallback above would have answered *five feet*,
  // which is the engine inventing the one number it has just said is not its
  // to invent. Worse here than anywhere: this list is what a model is shown,
  // so a shortlist that quietly narrowed to five feet would have `resolveSpell`
  // accepting a target the shortlist had already excluded. Everything else the
  // shortlist checks — Total Cover, sight, creature type, the dead — still
  // applies, because none of those is the Range.
  const bounded = definition.range.kind !== 'dm';
  // **The band the caster has reached, not the printed number.** SRD Spare the
  // Dying's range doubles at levels 5, 11 and 17, and `rangeFeetAt` is the one
  // reader — so the shortlist a caller is shown and the casting they then send
  // agree about how far the spell goes. Five for a Range that is not a
  // distance, which is what this line has always answered for a Touch.
  const reach =
    (rangeFeetAt(definition, caster.sheet.level) ?? 5) + (definition.origin?.reach ?? 0);

  for (const key of Object.keys(state.creatures).sort()) {
    const target = state.creatures[key];
    if (target === undefined) continue;
    if (target.id === casterId && definition.targets.self !== true) continue;
    // **Unless the spell is about a body**, which is the reason `mustBeDead`
    // exists: a spell cast on a corpse and on nobody else would be offered an
    // empty shortlist for every legal casting. `namedTargets` has never
    // refused a corpse, so this is the shortlist catching up with the cast
    // rather than a new permission — and it reaches the spells whose target
    // rule says so and no others, which is why the flag is a target rule and
    // not a guess about what raising the dead looks like.
    if (target.vitals.dead && definition.targets.mustBeDead !== true) {
      excluded.push({ target: target.id, reason: `${target.name} is dead` });
      continue;
    }
    if (definition.targets.mustBeDead === true && !target.vitals.dead) {
      excluded.push({ target: target.id, reason: `${target.name} is alive` });
      continue;
    }
    // SRD Spare the Dying: "0 Hit Points and isn't dead". The same reading the
    // cast takes, so the shortlist offers exactly whom the casting would reach.
    if (definition.targets.mustBeDying === true && !dyingProblem(state, target.id, definition.name).ok) {
      excluded.push({
        target: target.id,
        reason: target.vitals.dead ? `${target.name} is dead` : `${target.name} is not dying`,
      });
      continue;
    }

    const wanted = definition.targets.mustBeType;
    if (wanted !== undefined) {
      // The mask, so the shortlist and the cast agree about who a spell could
      // be aimed at — see `typeMagicSees`.
      const actual = typeMagicSees(target);
      if (actual === null) {
        needsContext.push({
          kind: 'creature-type',
          subject: target.id,
          need: `what kind of creature ${target.name} is`,
          because: `${definition.name} may only target a ${wanted}`,
          satisfyWith: `declareCreatureType(${target.id}, …)`,
        });
        continue;
      }
      if (!isCreatureType(actual, wanted)) {
        excluded.push({ target: target.id, reason: `${target.name} is ${actual}, not ${wanted}` });
        continue;
      }
    }

    // The same size rule the named-target path applies, so the shortlist and
    // the cast agree about who this spell could ever be aimed at. An excluded
    // creature rather than a refusal, because that is what this query answers.
    const sized = definition.targets.mustBeSize;
    if (sized !== undefined) {
      const actual = effectiveSizeOf(state, target.id);
      if (actual !== sized) {
        excluded.push({
          target: target.id,
          reason: `${target.name} is ${actual === null ? 'a creature nothing has given a size' : titleSize(actual)}, not ${titleSize(sized)}`,
        });
        continue;
      }
    }

    if (state.scene !== null) {
      const apart = distanceBetween(state.scene, casterId, target.id);
      if (!apart.ok) {
        needsContext.push({
          kind: 'position',
          subject: target.id,
          need: `where ${target.name} is standing`,
          because: bounded
            ? `${definition.name} reaches ${reach} feet`
            : `${definition.name} reaches as far as the DM says, and Total Cover is still measured`,
          satisfyWith: `a placeCreatureInScene command for ${target.id}`,
        });
        continue;
      }
      if (bounded && apart.value > reach) {
        excluded.push({
          target: target.id,
          reason: `${target.name} is ${apart.value} feet away, outside the range of ${reach}`,
        });
        continue;
      }
      if (coverBetween(state.scene, casterId, target.id) === 'total') {
        excluded.push({ target: target.id, reason: `${target.name} is behind Total Cover` });
        continue;
      }
      if (definition.requiresSight === true) {
        // The caster's senses again, and for the reason `namedTargets` gives:
        // the shortlist and the resolution must answer one question the same
        // way, or a target the engine offered would be refused when aimed at.
        const seen = canSee(state, casterId, target.id);
        if (seen === null) {
          needsContext.push({
            kind: 'visibility',
            subject: target.id,
            need: `whether ${casterId} can see ${target.name}`,
            because: `${definition.name} targets a creature you can see`,
            satisfyWith: `a declareSightBetween command from ${casterId} to ${target.id}`,
          });
          continue;
        }
        if (!seen) {
          excluded.push({ target: target.id, reason: `${casterId} cannot see ${target.name}` });
          continue;
        }
      }
    }

    eligible.push(target.id);
  }

  return { eligible, excluded, needsContext };
}

/**
 * Which fields would place this template, in the words a caller can act on.
 *
 * **A self-origin area is never told to supply an `at`**, and that is the
 * whole reason this is a function rather than a sentence: `placeArea` refuses
 * a point for one (`area_starts_at_caster`), so a request naming `at` for SRD
 * Burning Hands would send a caller between two refusals forever — which is
 * precisely what a `needs-context` exists not to do.
 */
const howToPlace = (area: SpellArea): string => {
  const aim = DIRECTIONAL_AREAS.has(area.kind) ? `\`towards\` pointing the ${area.kind}` : null;
  if (area.origin === 'self') {
    return aim === null
      ? `no placement of any kind: the ${area.kind} starts at you and goes nowhere else`
      : `${aim}, which is all of it: the ${area.kind} starts at you`;
  }
  return aim === null ? `\`at\` placing the ${area.kind}` : `\`at\` and ${aim}`;
};

/**
 * {@link eligibleTargets} for a spell that fills a template.
 *
 * Three answers, and the middle one is the whole of why this exists:
 *
 * | | |
 * |---|---|
 * | the area places | the catch, exactly as the casting settles it, and the reason the catch wrote for everyone it dropped |
 * | the area does not place | a `route` request for the field that would place it — never a guessed point, and never the Range standing in for the template |
 * | a creature the template never covered | off the list, and told so in the geometry's terms rather than the target rule's |
 *
 * **The placement refusal is a `route` and not a `refusal`**, because that is
 * what it is: `no_origin`, `no_direction` and `out_of_range` are all answered
 * by the caller asking again with the field corrected, which is `route`'s own
 * definition. Where the refusal already carries its own requests — no scene,
 * an unplaced caster — those are the better ones and they travel unchanged.
 */
function areaShortlist(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  area: SpellArea,
  placement: AreaPlacement | undefined,
): EligibleTargets {
  const rejected: AreaRejection[] = [];
  const caught = areaCatch(
    state,
    casterId,
    areaSourceOf(definition),
    area,
    { targets: [], ...placement },
    ranged(definition.range),
    // **The catch's `unverified` is dropped here on purpose.** Its one entry
    // is Hypnotic Pattern's unanswerable question — whether a creature can see
    // a point, which no table can declare — and the catch answers it by
    // catching them, so the shortlist offers exactly whom the casting would
    // catch. `EligibleTargets` has three channels and none of them is a
    // caveat: `needsContext` is for a fact somebody could go and establish,
    // and this is not one. The casting still reports it on the outcome, which
    // is where a table can overrule it.
    [],
    rejected,
  );

  if (!caught.ok) {
    return {
      eligible: [],
      excluded: [],
      needsContext:
        caught.requests ??
        [
          {
            kind: 'route',
            subject: casterId,
            need: caught.reason,
            because: `${definition.name} catches whoever is standing in its area, so who is on the list turns on where the area is laid`,
            satisfyWith: `eligibleTargets again with ${howToPlace(area)}`,
          },
        ],
    };
  }

  // Everyone the template never covered in the first place. The catch only
  // reports the creatures it *narrowed away*, because those are the ones a
  // clause has something to say about; standing somewhere else is geometry,
  // and the sentence for it belongs here where the rest of the scene is.
  const excluded = [...rejected];
  const inside = new Set(caught.value);
  const named = new Set(rejected.map((entry) => entry.target));
  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || inside.has(other.id) || named.has(other.id)) continue;
    excluded.push({
      target: other.id,
      reason: `${other.name} is not standing in the area ${definition.name} fills`,
    });
  }

  return { eligible: caught.value, excluded, needsContext: [] };
}

