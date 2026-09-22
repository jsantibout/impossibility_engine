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
import { canSee } from '../standing.js';
import { type SlotKind } from '../resources.js';
import {
  attackRollsIn,
  rollsDealtTo,
  DIRECTIONAL_AREAS,
  isCreatureType,
  type SpellArea,
  type SpellDefinition,
  statesFoughtFact,
  targetCountFor,
  teleportOf,
  weaponRiderOf,
} from '../spell-definitions.js';
import { type SlotlessReason } from '../spells.js';
import { type ConcentrationConsequence } from './casting.js';
import { creatureOf, unknownCreature } from './command.js';

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
   */
  readonly unaffected?: readonly CharacterId[];
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
 * **`rollsAt` is the same sentence twice more.** A split is a *mapping* from
 * creature to share, so the order the pairs were written in says nothing about
 * the casting — and a split that spells out the deal says nothing at all. Both
 * are normalised away here, and `rollsAimedAt` drops the second from what a
 * declaration pins, so the fingerprint and the record agree about which
 * castings are one casting.
 */
export const castingIdentity = ({
  anchoring,
  rollsAt,
  ...rest
}: CastSpellRequest): CastSpellRequest => {
  const aimed = aimedIdentity(rest.targets, rollsAt);
  return {
    ...rest,
    ...(anchoring === undefined || anchoring === 'space' ? {} : { anchoring }),
    ...(aimed === undefined ? {} : { rollsAt: aimed }),
  };
};

/**
 * A stated split as the fingerprint should see it: sorted, or gone.
 *
 * Both normalisations are decidable from the request alone, which is what lets
 * this run before any definition is fetched. The total is the sum the caller
 * stated — `rollsAimedAt` refuses any sum but the casting's own, so a split
 * that survives validation states its own total — and the deal is read off the
 * order the creatures were named, which is on the request too.
 *
 * An ill-formed split is sorted and kept rather than judged. It is about to be
 * refused, and a fingerprint's job is to be stable, not to have opinions.
 */
function aimedIdentity(
  targets: readonly CharacterId[],
  rollsAt: readonly AimedRolls[] | undefined,
): readonly AimedRolls[] | undefined {
  if (rollsAt === undefined) return undefined;
  const share = new Map(rollsAt.map((aim) => [aim.target, aim.count]));
  const covers = share.size === rollsAt.length && targets.every((target) => share.has(target));
  if (covers && targets.length === rollsAt.length) {
    const total = rollsAt.reduce((sum, aim) => sum + aim.count, 0);
    const deal = targets.every(
      (target, index) => share.get(target) === rollsDealtTo(total, targets.length, index),
    );
    if (deal) return undefined;
  }
  return [...rollsAt].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

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
}

/** A definition's own answers to {@link AreaSource}, in one place. */
export const areaSourceOf = (definition: SpellDefinition): AreaSource => ({
  name: definition.name,
  ...(definition.anchoring === undefined ? {} : { anchoring: definition.anchoring }),
  ...(definition.targets.mustBeType === undefined
    ? {}
    : { mustBeType: definition.targets.mustBeType }),
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
  readonly anchoring?: PointAnchoring;
}

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
): Result<null> {
  const named = request.unaffected ?? [];
  if (named.length > 0) {
    if (definition.designatesUnaffected !== true) {
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
  if (weaponRiderOf(definition) !== null) {
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

  // — the one value the spell asks its caster to choose ————————————————————
  //
  // The fifth stated fact, and the same two refusals a fourth time. The list
  // is the spell's, the answer is the caster's, and the engine makes neither:
  // picking Blinded because Blindness/Deafness prints it first is the engine
  // answering "(your choice)" on the caster's behalf, and it would answer the
  // same way for ever.
  const choice = definition.choiceStated;
  if (choice === undefined) {
    if (request.choice !== undefined) {
      return err(
        'no_choice_clause',
        `${definition.name} offers the caster no choice; which one this is is not a fact it asks for`,
      );
    }
  } else if (request.choice === undefined) {
    return err(
      'choice_required',
      `${definition.name} prints ${choice.options.join(', ')} and the engine will not choose between them; name which`,
    );
  } else if (!choice.options.includes(request.choice)) {
    return err(
      'unknown_choice',
      `${definition.name} prints ${choice.options.join(', ')}, not ${request.choice}`,
    );
  }

  const types = definition.damageTypeStated;
  if (types === undefined) {
    if (request.damageType !== undefined) {
      return err(
        'damage_type_fixed',
        `${definition.name} prints one damage type; naming another is not a choice the spell offers`,
      );
    }
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
 */
export function areaTargets(
  state: GameState,
  casterId: CharacterId,
  source: AreaSource,
  area: SpellArea,
  request: AreaRequest,
  reach: number | null,
): Result<readonly CharacterId[]> {
  if (request.targets.length > 0) {
    return err(
      'area_picks_its_own_targets',
      `${source.name} fills an area and catches whoever is in it; it does not take a target list`,
    );
  }
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

  // A creature the spell cannot affect is filtered out, not refused. "Each
  // Humanoid in the area" leaves the ogre standing there unbothered; it does
  // not make the casting illegal, which is the difference between an area and
  // a target a caller named.
  const wanted = source.mustBeType;
  const eligible = caught.value.filter((who: CharacterId) => {
    const creature = state.creatures[who];
    if (creature === undefined) return false;
    if (creature.vitals.dead) return false;
    // The same comparison the outcome side makes, rather than a second one
    // spelled alike: an undeclared type is not a match here, and an area
    // *filters* rather than asking, because "each Humanoid in the area" leaves
    // the ogre standing there unbothered.
    if (wanted !== undefined && !isCreatureType(creature.creatureType, wanted)) {
      return false;
    }
    // SRD: "A spell's area of effect is blocked by Total Cover." Cover here is
    // declared pairwise from the caster rather than traced through the area,
    // which is the documented approximation the whole cover model makes.
    if (state.scene !== null && coverBetween(state.scene, casterId, who) === 'total') return false;
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
          attackRollsIn(definition.effects, definition.level, casterLevel, castLevel),
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
      const actual = state.creatures[target]?.creatureType ?? null;
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

    if (state.scene === null) {
      needs.push({
        kind: 'scene',
        subject: target,
        need: 'a scene, so that distances mean something',
        because: `${definition.name} has a range to check`,
        satisfyWith: 'a setScene command',
      });
    } else if (reach !== null) {
      // SRD Hold Person: "a Humanoid that you can see." Unknown is a fact to
      // establish; declared *unseen* is the refusal.
      if (definition.requiresSight === true) {
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
      } else {
        const apart = distanceBetween(state.scene, casterId, target);
        if (!apart.ok) {
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
      if (coverBetween(state.scene, casterId, target) === 'total') {
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
 * `attackRollsIn` that bounds the target list.
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
  const total = attackRollsIn(definition.effects, definition.level, casterLevel, castLevel);
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
  // one log. The fingerprint drops it for the same reason — see
  // `castingIdentity`.
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
 */
export function eligibleTargets(
  state: GameState,
  content: Content,
  casterId: CharacterId,
  spellId: string,
  slotLevel: number,
): EligibleTargets {
  const definition = content.spell(spellId);
  const caster = creatureOf(state, casterId);
  if (definition === null || caster === null) {
    return { eligible: [], excluded: [], needsContext: [] };
  }
  void slotLevel;

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
  const reach =
    (definition.range.kind === 'ranged' ? definition.range.feet : 5) +
    (definition.origin?.reach ?? 0);

  for (const key of Object.keys(state.creatures).sort()) {
    const target = state.creatures[key];
    if (target === undefined) continue;
    if (target.id === casterId && definition.targets.self !== true) continue;
    if (target.vitals.dead) {
      excluded.push({ target: target.id, reason: `${target.name} is dead` });
      continue;
    }

    const wanted = definition.targets.mustBeType;
    if (wanted !== undefined) {
      const actual = target.creatureType;
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

