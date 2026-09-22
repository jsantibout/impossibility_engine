/**
 * Weapon attacks, and the window between the roll and the damage.
 *
 * The attack is two commands rather than one because SRD Divine Smite lands
 * between them: `resolveAttack` rolls to hit and may hold the result, and
 * `resolveAttackDamage` settles it.
 */

import {
  type Ability,
  type CharacterId,
  type Err,
  err,
  needsContext,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
// `import type`, not `import { type … }`: the second keeps the declaration
// under `verbatimModuleSyntax` and emits `import {} from '@ie/srd'`, which
// loads the whole parsed book to bind nothing at all.
import type { Weapon, WeaponMastery } from '@ie/srd';
import {
  attackAbility,
  type AttackOptions,
  type AttackResult,
  type DamageComponent,
  type ExtraDamage,
  masteryInPlay,
  type MasteryUse,
  meleeReach,
  proficientWith,
  rangeOf,
  rollAttack,
  rollAttackDamage,
  type StatedAttackInPlay,
  type StrikeStyleInPlay,
} from '../attack.js';
import { type Bonus, bonusesFor, flatBonusTotal, type ModeSource } from '../bonuses.js';
import { type Content } from '../content.js';
import {
  canUseFeatureThisTurn,
  spendAttack,
  spendBonusAction,
  MULTIATTACK_LEDGER,
  WEAPON_MASTERY_LEDGER,
} from '../combat.js';
import { applyEvent, type CreatureState, type GameEvent, type GameState } from '../events.js';
import { modifierFor, type CharacterSheet, type StatedAttack } from '../character.js';
import {
  attacksInAction,
  hasPrintedTrait,
  describeMultiattack,
  describeRecharge,
  multiattackAllows,
  multiattackOf,
  printedAttackOf,
  readPrintedRider,
  statedBonusActionsUsed,
  unreadActionsOf,
} from '../monster.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  distanceBetween,
  positionOf,
  sizeAtMost,
  sizeOf,
} from '../positioning.js';
import { type ReactionOffer } from '../reactions.js';
import { isCreatureType, scaledDiceFor, scaledFlatFor } from '../spell-definitions.js';
import {
  actionRulesOn,
  armorClassOf,
  canSomehowSee,
  checkFeatureDamageTypes,
  effectiveConditions,
  sensesPerceiving,
  sheetAsItStands,
  standingAttackDamage,
  standingBonuses,
  standingDamageEffects,
  strikeStyleFor,
  type HitOption,
  type StrikeStyle,
} from '../standing.js';
import { benefitsFrom } from '../conditions.js';
import { resolveDuration, timeView, turnAnchored } from '../time.js';
import {
  chooseRoute,
  type ConcentrationConsequence,
  hidingEndedBy,
  type Supply,
  resolveCastWith,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { routeLabel } from './item-casting.js';
import { landDamage, statedFrom } from './damage.js';
import {
  CLEAVE_REACH,
  masteryAfterHit,
  masteryArgumentProblem,
  type MasteryHit,
  type MasteryOutcome,
} from './mastery.js';
import { mayAct } from './holds.js';
import { quantityOf } from './inventory.js';
import { applyHitRider, hitRiderAsked, type HitRiderRequest } from './hit-riders.js';
import { allyWithinFiveFeetOf, defendingModes, enemyWithinFiveFeet } from './rolls.js';
import { consumedRollModifiers } from '../roll-modifiers.js';

/**
 * The weapons this creature currently has in hand, as records.
 *
 * `equipped` carries catalogue ids and an armour record; the weapon record
 * lives in the catalogue, which is why this takes the content the command
 * already holds. `reachOf` beside it asks the same question of the same list
 * for the same reason.
 */
function wieldingOf(content: Content, creature: CreatureState): readonly Weapon[] {
  const held: Weapon[] = [];
  for (const item of creature.equipped) {
    const weapon = content.item(item.id)?.weapon;
    if (weapon !== undefined && weapon !== null) held.push(weapon);
  }
  return held;
}

/** What a style changes about the arithmetic, which is all `attack.ts` needs. */
const inPlay = (style: StrikeStyle): StrikeStyleInPlay => ({
  source: style.source,
  ...(style.die === undefined ? {} : { die: style.die }),
  ...(style.ability === undefined ? {} : { ability: style.ability }),
});

/**
 * What Cleave's once-per-turn allowance is counted under.
 *
 * `feature-used` keys by a string and a turn, and the thing spent here is a
 * *weapon property* rather than a class feature — so it is written in the same
 * namespace every mastery source uses, and it is a constant because nothing in
 * any catalogue names it.
 */
const CLEAVE = `${WEAPON_MASTERY_LEDGER}cleave`;

/**
 * Where a swing inside the Attack action is counted, when the creature's block
 * states a sequence.
 *
 * **The combat ledger, which is what it is for.** `feature-used` keys by a
 * string and a turn, and what is spent here is neither a class feature nor a
 * weapon property but a *slot* the stat block printed — the second of the two
 * Bites — so it is written in the same namespace Cleave's once-per-turn
 * allowance is, for the reason that one is: the ledger is the engine's
 * per-turn record, and a second one beside it would be a second answer to the
 * same question.
 *
 * A slot rather than a count because the ledger stores a turn against a key
 * and not a number against one: `Bite#1` and `Bite#2` are two things spent
 * once each, which is exactly what "two Bite attacks" grants. The prefix is a
 * constant, and the name in the key came out of the creature's own block —
 * nothing in this file names an attack.
 */
const SEQUENCE = MULTIATTACK_LEDGER;

const sequenceSlot = (name: string, ordinal: number): string =>
  `${SEQUENCE}${name}#${ordinal}`;

/**
 * The Attack action's swings so far this turn, counted by the name each was
 * made with.
 *
 * Read back off the ledger rather than stored a second time, so there is one
 * record of what happened and a replay cannot disagree with it.
 */
function attacksMadeThisTurn(
  combat: NonNullable<GameState['combat']>,
  id: CharacterId,
): Readonly<Record<string, number>> {
  const made: Record<string, number> = {};
  const spent = combat.budgets[id]?.featureUsedOnTurn ?? {};

  for (const [key, turn] of Object.entries(spent)) {
    if (turn !== combat.turnsTaken || !key.startsWith(SEQUENCE)) continue;
    const name = key.slice(SEQUENCE.length, key.lastIndexOf('#'));
    made[name] = (made[name] ?? 0) + 1;
  }

  return made;
}

/**
 * Everything wrong with a swing that names an attack its creature prints, or
 * null.
 *
 * All four refusals are answerable before anything is spent, which is where
 * this is asked from — a swing refused after the Attack action is gone is a
 * refusal with a footprint.
 */
function printedAttackProblem(
  sheet: CharacterSheet,
  expended: readonly string[],
  command: AttackCommand,
): Err | null {
  if (command.action === undefined) return null;

  if (command.weapon !== null) {
    return err(
      'two_attacks',
      `a swing is a weapon's or the creature's own, not both: ${command.action} and ${command.weapon} were both named`,
    );
  }

  const printed = printedAttackOf(sheet, command.action);
  if (printed === null) {
    return err(
      'unknown_action',
      `no attack called ${command.action} is printed on this creature's stat block`,
    );
  }

  // **A line already used and not yet back.** SRD *Monsters*: "a monster can
  // use the stat block part once" — the Minotaur's Gore and the Ape's Rock are
  // the two the book prints an attack roll on, and a second swing of one is
  // refused here with the Attack action still in hand.
  if (expended.includes(printed.name)) {
    return err(
      'line_expended',
      `${printed.name} is a line this creature has used and not got back${
        printed.recharge === undefined ? '' : `: ${describeRecharge(printed.recharge)}`
      }`,
    );
  }

  // **And the hold is not one of them, since 2026-09-21.** A printed line used
  // to be refused here, because `attack-landed` pinned a weapon's catalogue id
  // and had nowhere to say which line was swung — a hit whose damage could
  // never be rolled. What that refusal cost was not SRD Divine Smite, which no
  // stat block buys, but the window on the *other* side of the hit: the only
  // trigger SRD Shield reads is a held attack, so a party fighting monsters —
  // which is every party — was never offered one. `PendingAttack.action` is
  // the missing fact and the owner ruled the rest.
  return null;
}

/**
 * What a printed attack changes about the arithmetic, and which half of a line
 * that prints two this swing is.
 *
 * SRD prints "Melee or Ranged Attack Roll: +6, reach 5 ft. or range 30/120
 * ft." for a Javelin an Ogre may stab or throw, and the choice is the
 * attacker's. `thrown` is the field that already means "thrown rather than
 * swung" for a weapon, so it is the field that says so here rather than a
 * second one meaning the same thing.
 */
function statedInPlay(
  printed: StatedAttack | null,
  thrown: boolean,
): StatedAttackInPlay | undefined {
  if (printed === null) return undefined;
  return {
    source: printed.name,
    modifier: printed.modifier,
    ranged: printed.kind === 'ranged' || (printed.kind === 'melee-or-ranged' && thrown),
    damage: printed.damage.map((part) => ({
      dice: part.dice,
      flat: part.flat,
      type: part.type,
    })),
  };
}

/** What a stat block's own line buys on a hit, and what it could not. */
interface PrintedRiderOnASwing {
  /** The effect list the hit buys, or null where the line is still prose. */
  readonly option: HitOption | null;
  /** Everything about this line the swing owes the table, reported on a hit. */
  readonly unverified: readonly string[];
}

const NO_PRINTED_RIDER: PrintedRiderOnASwing = { option: null, unverified: [] };

/**
 * **What a stat block says a hit does**, as the effect list a hit already buys.
 *
 * SRD Wolf: "_Hit:_ 5 (1d6 + 2) Piercing damage. If the target is a Medium or
 * smaller creature, it has the Prone condition." The numbers before the rider
 * have been the engine's since the bestiary landed and the sentence after it
 * was handed to the DM, which is honest and makes the creature weaker than the
 * book prints it.
 *
 * **Not a second path.** What a hit buys is {@link HitOption}, the effect list
 * SRD Stunning Strike rides on; this builds one off the printed line instead of
 * off a sheet, and everything after it — `runEffects`, the deadline
 * `fileDeadlines` files, and the hold the defender answers in — is the path
 * that already existed. The three fields a feature's rider has and this one
 * does not are the three the book does not print here: there is no pool, no
 * price and no allowance, because a stat block's rider is **not asked for**.
 * SRD writes "you can" on every feature that buys one and writes this one as
 * part of the Hit.
 *
 * The source the condition is filed under carries the attacker's id as well as
 * the line's name — `grappleSource`'s construction — so two wolves biting one
 * creature leave two instances with two deadlines rather than one whose
 * deadline the second bite moved.
 *
 * **Everything the engine did not do is said out loud**, in the channel the
 * verbatim clause was already reported in: a line the reader cannot read, a
 * size the sentence does not reach, a size nobody has stated, and a deadline
 * anchored on a turn order there is none of.
 */
function printedRiderOnASwing(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  printed: StatedAttack | null,
): PrintedRiderOnASwing {
  if (printed?.rider == null) return NO_PRINTED_RIDER;

  // The clause the swing has reported since the bestiary landed, for every
  // line this cannot execute. A printed rider silently dropped is a creature
  // made weaker than the book, which is the failure the honest half of the
  // shape exists to prevent.
  const handOver = `${printed.name} hit ${target}, and its line reads "${printed.rider}" — the engine does not apply that; a DM does`;

  const read = readPrintedRider(printed.rider);
  if (read === null) return { option: null, unverified: [handOver] };

  const unverified: string[] = [];

  // SRD's "If the target is a Medium or smaller creature", evaluated rather
  // than assumed — and **what somebody said before what the map assumed**,
  // which is the reading `push` takes of the same sentence: a stat block pins
  // a size into `creature-added` and the map defaults an unplaced one to
  // Medium, so asking the map first would answer Medium for a Gargantuan
  // creature nobody re-stated when they placed it.
  if (read.ifNoLargerThan !== undefined) {
    const size =
      state.creatures[target]?.size ?? (state.scene === null ? null : sizeOf(state.scene, target));
    if (size !== null && !sizeAtMost(size, read.ifNoLargerThan)) {
      return {
        option: null,
        unverified: [
          `${target} is ${size}, and ${printed.name}'s line reaches a creature that is ${read.ifNoLargerThan} or smaller — nothing was applied`,
        ],
      };
    }
    if (size === null) {
      unverified.push(
        `nobody has said how big ${target} is, so ${printed.name}'s line took them for Medium; a creature larger than ${read.ifNoLargerThan} would have been left alone`,
      );
    }
  }

  if (read.kind === 'grapple') {
    // SRD Giant Scorpion's "from one of two claws": how many creatures the
    // block can hold at once. The engine holds no record of limbs, so the
    // clause is handed back exactly as `grappleTarget` hands back the free
    // hand SRD asks it for — the grapple is made and the limit is the DM's.
    if (read.withLimbs !== undefined) {
      unverified.push(
        `${printed.name} grapples ${target} from ${read.withLimbs}, and the engine holds no record of limbs; how many creatures ${attacker} can hold at once is the table's`,
      );
    }
    return {
      option: {
        feature: `${attacker}:${printed.name}`,
        featureName: printed.name,
        option: printed.name,
        name: printed.name,
        pool: null,
        costs: 0,
        // Nothing an effect list can express: a grapple is a relation, and
        // `HitOption.grapples` is the clause that makes one.
        effects: [],
        ability: null,
        grapples: {
          escapeDc: read.escapeDc,
          ...(read.withLimbs === undefined ? {} : { withLimbs: read.withLimbs }),
        },
      },
      unverified,
    };
  }

  // SRD Ghast's "If the target is a non-Undead creature", the other gate the
  // engine holds the fact for — read off the creature rather than the map,
  // because `creatureType` is what a stat block pinned into `creature-added`.
  if (read.unlessType !== undefined) {
    const creatureType = state.creatures[target]?.creatureType ?? null;
    if (isCreatureType(creatureType, read.unlessType)) {
      return {
        option: null,
        unverified: [
          `${target} is ${creatureType}, and ${printed.name}'s line excepts one — nothing was applied`,
        ],
      };
    }
    if (creatureType === null) {
      unverified.push(
        `nobody has said what kind of creature ${target} is, so ${printed.name}'s line took them for one it reaches; a ${read.unlessType} would have been left alone`,
      );
    }
  }
  // SRD Ghoul's "or elf": the other half of the same gate, and a species
  // rather than a creature type. **Read off the record creation kept**, which
  // is a fact the engine does hold for exactly the population a Ghoul claws:
  // the choices are the character and they are stored on the creature. The
  // word compared is the *line's*, so no species id is written down here.
  //
  // A creature with no record — a monster, somebody a DM simply added — has no
  // species the engine can answer for, and the absent fact is reported rather
  // than read as a denial: the reading the size gate above already takes of
  // the same silence.
  if (read.alsoExcepts !== undefined) {
    const species = state.creatures[target]?.character?.speciesId ?? null;
    if (species !== null && species.toLowerCase() === read.alsoExcepts.toLowerCase()) {
      return {
        option: null,
        unverified: [
          `${target} is a ${species}, and ${printed.name}'s line excepts one — nothing was applied`,
        ],
      };
    }
    if (species === null) {
      unverified.push(
        `${printed.name}'s line also excepts an ${read.alsoExcepts}, and nothing on ${target} says what they are; it was applied regardless`,
      );
    }
  }

  // A deadline the clock cannot reach is a condition that would never lift, so
  // it is left to the table rather than hung on somebody for ever — the answer
  // `hitRiderAsked` gives the same absence, minus the refusal, because nobody
  // asked for this rider and a swing must not be refused for taking it.
  //
  // **The converter is asked rather than the combat**, because two different
  // absences make the moment unreachable and only one of them is "no fight":
  // a clause anchored on the *target's* next turn also has nowhere to go when
  // the creature that was hit has no place in the order, which is an ordinary
  // thing — a DM adds an ogre mid-fight and nobody has rolled for it. Asking
  // `resolveDuration` here is asking the one function that will be asked again
  // by `fileDeadlines`, so the two cannot come to disagree, and it is asked
  // *before* the swing commits rather than after the blow has landed.
  if (read.lasts !== undefined) {
    const anchor = read.lastsOn === 'target' ? target : attacker;
    const pinned = resolveDuration(timeView(state), turnAnchored(read.lasts, anchor));
    if (!pinned.ok) {
      return {
        option: null,
        unverified: [
          handOver,
          `${printed.name}'s clause lasts until a turn boundary of ${anchor}'s, and ${pinned.reason}`,
        ],
      };
    }
  }

  const save = read.save;
  return {
    option: {
      feature: `${attacker}:${printed.name}`,
      featureName: printed.name,
      option: printed.name,
      name: printed.name,
      pool: null,
      costs: 0,
      // **One save for every condition the failure imposes**, which is the
      // shape `save` already has: a second `save` effect would roll a second
      // saving throw and a creature could fail one and make the other, which
      // is not the line. A line that prints no save simply imposes them.
      effects:
        save === undefined
          ? read.conditions.map((name) => ({ kind: 'condition' as const, condition: { name } }))
          : [
              {
                kind: 'save' as const,
                ability: save.ability,
                condition: read.conditions[0]!,
                ...(read.conditions.length > 1
                  ? { conditions: read.conditions.slice(1).map((name) => ({ name })) }
                  : {}),
              },
            ],
      // The block prints no ability behind this clause — there is no sheet for
      // "your spell save DC" to be read off — and where it prints a number it
      // is stated instead. `8 + Proficiency Bonus` is what remains, and it is
      // the fallback an item's casting already falls to.
      ability: null,
      ...(save === undefined ? {} : { saveDc: save.dc }),
      ...(read.lasts === undefined ? {} : { lasts: read.lasts }),
      ...(read.lastsOn === undefined ? {} : { lastsOn: read.lastsOn }),
    },
    unverified,
  };
}

/**
 * SRD Pack Tactics, decided from where the creatures are standing.
 *
 * The trait belongs to the **attacker** and the condition it reads is about
 * the **target's** neighbours, which is why it cannot be a standing effect: a
 * standing effect is hung on a creature and asks about that creature's own
 * state, and nothing in that vocabulary can ask who is beside somebody else.
 *
 * Nothing is applied when nobody has said whose side a neighbour is on, and
 * the withholding is reported rather than silent — the reading
 * `enemyWithinFiveFeet` takes of the same absence, for the same reason: an
 * unfired rule and a rule that checked and found nothing look identical from
 * outside.
 */
function packTactics(
  state: GameState,
  sheet: CharacterSheet,
  attacker: CharacterId,
  target: CharacterId,
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  if (!hasPrintedTrait(sheet, 'advantage-when-ally-is-within-5-feet-of-the-target')) {
    return { modes: [], unverified: [] };
  }

  const beside = allyWithinFiveFeetOf(state, attacker, target);
  return {
    modes: beside.near
      ? [{ source: `an ally is within 5 feet of ${target}`, mode: 'advantage' }]
      : [],
    unverified: beside.unverified,
  };
}

export interface AttackCommand extends CommandIdentity {
  readonly target: CharacterId;
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon: string | null;
  /**
   * An attack this creature's own stat block prints, by its printed name —
   * a Wolf's `Bite`.
   *
   * **The third source of an attack's numbers**, beside a catalogue weapon and
   * a spell. It is a *name* rather than a line for the reason `addCreature`
   * takes a monster's id rather than a stat block: an entry point that accepts
   * an attack bonus is a door a model-authored +12 walks through, and nothing
   * guards it. The line was pinned onto the creature when it entered the game,
   * and the engine reads it from there.
   *
   * Exclusive with `weapon`: a swing whose numbers come from two places is a
   * question with two answers, and it is refused rather than resolved in some
   * order the caller cannot see.
   */
  readonly action?: string;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /**
   * Which ability to use where a rule offers the attacker a choice of two.
   * Defaults to the better one.
   *
   * SRD Finesse's "your choice of your Strength or Dexterity modifier", and
   * SRD Dexterous Attacks' "you can use your Dexterity modifier instead of
   * your Strength modifier" — one question with one answer, so one field. See
   * `AttackOptions.finesseAbility`.
   */
  readonly finesseAbility?: 'str' | 'dex';
  /** Advantage or disadvantage from the fiction, which the engine cannot see. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Modifiers the caller knows about: Archery, a magic weapon's plus. */
  readonly attackBonuses?: readonly Bonus[];
  readonly damageBonuses?: readonly Bonus[];
  /** Damage of other types: a Divine Smite's radiant, a Flame Tongue's fire. */
  readonly extraDamage?: readonly ExtraDamage[];
  /**
   * Roll the attack and stop, leaving the damage to a second command.
   *
   * SRD 2024 Divine Smite: "Bonus Action, which you take immediately after
   * hitting a target with a Melee weapon or an Unarmed Strike." There is no
   * such moment in an attack that rolls its damage in the same breath, so a
   * caller who might want one asks for it before swinging. Asking costs
   * nothing and decides nothing: the slot is spent only by going through with
   * it, and only on a hit.
   */
  readonly hold?: boolean;
  /**
   * This swing is not the Attack action, so it costs nothing here.
   *
   * SRD Opportunity Attack: "take a Reaction to make one melee attack" — the
   * Reaction is the cost, and the caller has already paid it. Extra Attack
   * will want the same field for the same reason: the economy counts the
   * Attack action, not the attacks inside it.
   */
  readonly free?: boolean;
  /**
   * Pay for this Unarmed Strike with a Bonus Action rather than the Attack
   * action.
   *
   * SRD Martial Arts: "**Bonus Unarmed Strike.** You can make an Unarmed
   * Strike as a Bonus Action." A class feature has to have granted it — a
   * style with `bonusUnarmedStrike` — and it has to be an Unarmed Strike,
   * because that is what the sentence gives away. Both are checked before
   * anything is spent.
   *
   * **Not `free`, and not the extra attacks inside an Attack action.** `free`
   * says somebody else has already paid; this says what pays, and the slot it
   * spends is the one SRD names and the economy already holds.
   */
  readonly bonusAction?: boolean;
  /**
   * Which damage type a feature that offers a choice deals on this hit.
   *
   * SRD Divine Strike is "Necrotic or Radiant damage (your choice)" and Primal
   * Strike "Cold, Fire, Lightning, or Thunder (choose when you hit)" — per
   * hit, so it cannot be settled on the sheet. Keyed by feature id.
   *
   * Naming no type declines the feature, which is what "you can cause" means;
   * naming one it does not offer is refused before anything is rolled.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
  /**
   * Use the mastery property of the weapon in hand.
   *
   * SRD: "Each weapon has a mastery property, which is usable only by a
   * character who has a feature ... that unlocks the property for the
   * character." Five of the eight properties are written "you can", so this
   * field is where the attacker says so — and a property the character has not
   * unlocked is refused rather than quietly skipped. Sap and Vex are not
   * written that way and are not asked for; see {@link MasteryUse}.
   */
  readonly mastery?: MasteryUse;
  /**
   * A feature's effect list bought by this hit, if it lands.
   *
   * SRD Stunning Strike: "Once per turn when you hit a creature with a Monk
   * weapon or an Unarmed Strike, **you can** expend 1 Focus Point to attempt a
   * stunning strike." Elected per swing, because every feature of the shape is
   * written "you can" — a rider nobody asked for costs nothing and does
   * nothing.
   *
   * Everything about it that can be settled without knowing whether the attack
   * hit is settled before the roll — the feature, the option it names, the
   * weapon in hand, the once-per-turn allowance and the pool — so a refusal
   * arrives with nothing spent. What it costs is spent only on a hit.
   *
   * **One rider, not a list.** No SRD feature buys two on one blow, and a
   * field that took several would be inventing the stacking rule they would
   * need.
   */
  readonly onHit?: HitRiderRequest;
}

export interface AttackResolution {
  readonly events: readonly GameEvent[];
  /**
   * Facts the engine could not check, rather than checked and found false.
   *
   * The same channel `resolveSpell` uses, and for the same reason: an unplaced
   * creature is one nobody has said the position of, not one standing
   * nowhere. A rule that needs a distance gets none rather than a guess, and
   * the layer narrating the attack is told which rule went unapplied.
   */
  readonly unverified: readonly string[];
  /** The roll, or null when this command id had already landed. */
  readonly attack: AttackResult | null;
  /** Damage that actually landed, after the target's defences. Absent on a miss. */
  readonly damage?: number;
  /** What the damage did to the target's Concentration, if they had any. */
  readonly concentration?: ConcentrationConsequence;
  /**
   * Who may answer the damage roll before it lands.
   *
   * Present and non-empty only when the hit opened a `damage-rolled` window,
   * which is exactly when some creature has a feature that could reduce it.
   * Then `damage` is absent, because none has been dealt yet and
   * {@link settleDamage} is what deals it.
   */
  readonly reactions?: readonly ReactionOffer[];
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * Swing at somebody, and let the engine work out the numbers.
 *
 * `rollAttack` is pure and always has been: hand it a sheet, a target Armour
 * Class, some modes and some bonuses, and it rolls correctly. What it cannot
 * do is *find* any of those, so every one of them was the caller's to supply —
 * which meant nothing in the engine ever checked them, and a fixture could
 * quietly swing a longsword at somebody fifty feet away.
 *
 * Everything derivable is derived here:
 *
 * | | From |
 * |---|---|
 * | Target Armour Class | the target's own sheet, plus declared cover |
 * | Reach and range | the weapon's properties and the distance between volumes |
 * | An enemy hampering a bow | who is within 5 feet and on another side |
 * | Advantage and disadvantage | both creatures' conditions, after features have suppressed any |
 * | Proficiency | the weapon's category against the sheet's |
 * | Defences | the target's own, and the ones its features grant |
 *
 * What the caller still says is what the engine cannot see: advantage from the
 * fiction, a magic weapon's plus, a Smite's extra dice.
 */
export function resolveAttack(
  state: GameState,
  id: CharacterId,
  command: AttackCommand,
  supply: Supply,
): Result<AttackResolution> {
  // A retry is a no-op rather than a refusal, and says so rather than looking
  // like a miss: the same contract `resolveDamage` keeps, for the same reason.
  return once(state, `attack:${id}`, command, () => {
    return { events: [], attack: null, unverified: [], duplicate: true };
  }, (stamp) => {
    if (state.pendingAttack !== null) {
      return err(
        'attack_pending',
        `${state.pendingAttack.attacker} has a hit whose damage is still unrolled; settle it first`,
      );
    }

    // A second swing while the first one's damage is held would roll damage into
    // a window already holding some, and the reducer refuses a second
    // `damage-rolled` — better to say so here than to produce a corrupt log.
    if (state.pendingDamage !== null) {
      return err(
        'damage_pending',
        `damage rolled against ${state.pendingDamage.target} has not been settled; settle it first`,
      );
    }

    // And whatever this attacker has been caught by: swinging is acting.
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const attacker = creatureOf(state, id);
    if (attacker === null) return unknownCreature(id, 'has no record here yet; add it first');
    // The sheet as it stands, not the one the character was built with: a Belt
    // of Giant Strength sets a Strength and `attack.ts` takes a sheet, so the
    // substitution is made here, where the state is, rather than by teaching
    // the roller to read items. The same object comes back for a creature
    // nothing is setting a score on, which is nearly every creature in nearly
    // every fight.
    const sheet = sheetAsItStands(state, id) ?? attacker.sheet;
    // Not a claim that no such creature exists. A DM who has just narrated a
    // second ogre out of the treeline has a real ogre; the engine has simply not
    // been told about it, and being told is all this refusal asks for.
    const victim = creatureOf(state, command.target);
    if (victim === null) {
      return unknownCreature(command.target, 'has no record here yet; add it first');
    }
    if (attacker.vitals.dead) return err('dead', `${id} is dead and swings at nothing`);

    // — the attack this creature's own block prints ————————————————————————
    //
    // Before the weapon, because a swing that names both is refused rather
    // than resolved in whichever order this function happens to read them.
    const printedProblem = printedAttackProblem(sheet, attacker.expendedLines, command);
    if (printedProblem !== null) return printedProblem;
    const printed =
      command.action === undefined ? null : printedAttackOf(sheet, command.action);

    // — the weapon —————————————————————————————————————————————————————————
    let weapon: Weapon | null = null;
    if (command.weapon !== null) {
      const item = supply.content.item(command.weapon);
      if (item?.weapon === undefined || item.weapon === null) {
        return err('unknown_item', `${command.weapon} is not a weapon the SRD lists`);
      }
      // Owning is not wielding, but you cannot wield what you do not own.
      if (quantityOf(state, id, command.weapon) < 1) {
        return err('not_owned', `${id} does not have a ${item.weapon.name}`);
      }
      weapon = item.weapon;
    }

    // SRD Martial Arts and SRD Flurry of Blows both say "Unarmed Strike", and
    // this is the whole of what one is here: no weapon named, and no line off
    // the creature's own block either — a Wolf's Bite is the block's attack
    // rather than a fist.
    const unarmedStrike = command.weapon === null && command.action === undefined;

    // — the mastery property, if this character has unlocked one ——————————
    //
    // Before anything is spent, for the reason the damage types below are:
    // a swing asking for a property nobody unlocked is refused with nothing
    // paid for it.
    const chosen = masteryInPlay(sheet, command.weapon, weapon, command.mastery);
    if (!chosen.ok) return chosen;
    const property = chosen.value;

    // SRD Cleave: "a **second** creature within 5 feet of the first that is
    // also within your reach ... only once per turn." The first creature is
    // named by the caller, so everything about the opening is checkable here.
    const asked = masteryArgumentProblem(property, command.mastery?.feet);
    if (!asked.ok) return asked;

    const cleaving = command.mastery?.cleaving;
    if (cleaving !== undefined) {
      const opening = cleaveOpening(state, id, command.target, cleaving, property);
      if (opening !== null) return opening;
    }

    // — can it even reach ——————————————————————————————————————————————————
    //
    // A printed line states its own reach and range, so the weapon's defaults
    // are not what a Bite with ten feet of reach is measured against.
    const stated = statedInPlay(printed, command.thrown === true);
    const carry =
      printed === null
        ? {
            label: weapon?.name ?? 'an Unarmed Strike',
            reach: meleeReach(weapon),
            range: rangeOf(weapon, command.thrown === true),
          }
        : {
            label: printed.name,
            // A line read as melee always states a reach, and one read as
            // ranged is measured by its range below — so the fallback is a
            // number nothing reaches rather than a default anybody swings at.
            reach: printed.reach ?? 0,
            range: stated?.ranged === true ? printed.range : null,
          };
    const reach = reachCheck(state, id, command.target, carry);
    if (!reach.ok) return reach;

    // What this swing is called, wherever it came from: a weapon's name, a
    // stat block's printed heading, or the Unarmed Strike the sentinel means.
    // Read by the log and by every damage component, so a Bite is a Bite in
    // the record rather than an unexplained fist.
    const attackName = printed?.name ?? weapon?.name ?? 'Unarmed Strike';

    // SRD Total Cover: the target "can't be targeted directly".
    const cover = state.scene === null ? 'none' : coverBetween(state.scene, id, command.target);
    if (!canBeTargeted(cover)) {
      return err('total_cover', `${command.target} is behind Total Cover`);
    }

    // A damage type a feature does not offer is refused here, before the action
    // is spent and before a die is thrown — the same validate-before-rolling
    // rule the rest of the engine keeps.
    const legalTypes = checkFeatureDamageTypes(state, id, command.featureDamageTypes);
    if (!legalTypes.ok) return legalTypes;

    // And the rider this swing says it is buying, for the same reason and in
    // the same breath: a Stunning Strike asked for with an empty pool, with a
    // Greatsword in hand or twice in one turn is refused here, with the action
    // unspent and no die thrown. What it costs is spent on the hit, below.
    const rider = hitRiderAsked(state, id, sheet, weapon, command.onHit);
    if (!rider.ok) return rider;

    // **And the rider this creature's own block prints**, which nobody asks
    // for: SRD writes "you can" on every feature that buys one and writes a
    // stat block's as part of the Hit. Read here rather than at the landing
    // for the same reason the asked-for one is — what rides on the blow has to
    // be settled before the blow, because the hold pins it — and it refuses
    // nothing, because a swing the book permits must not be turned away for
    // carrying a sentence the engine could not read.
    const fromTheBlock = printedRiderOnASwing(state, id, command.target, printed);
    // **One rider, and the one somebody paid for wins.** The field a hold pins
    // holds a single option, no SRD creature both prints a rider and holds a
    // feature that buys one, and a printed clause is free — so where both turn
    // up, the purchase is honoured and the printed line goes back to the DM.
    const riding = rider.value ?? fromTheBlock.option;

    // — what the class says this attack is ————————————————————————————————
    //
    // Resolved before the economy, because the Bonus Action strike is a style's
    // to give: a class that grants no style may not spend a Bonus Action on a
    // punch, and finding that out after the action was spent would be a
    // refusal with a footprint.
    const style = strikeStyleFor(state, id, {
      weapon,
      wielding: wieldingOf(supply.content, attacker),
    });

    if (command.bonusAction === true && (weapon !== null || style?.bonusUnarmedStrike !== true)) {
      return err(
        'no_bonus_strike',
        weapon === null
          ? `no feature of ${id}'s gives them an Unarmed Strike as a Bonus Action here`
          : `a Bonus Action strike is an Unarmed Strike; ${id} is swinging a ${weapon.name}`,
      );
    }

    // — the action it costs —————————————————————————————————————————————————
    //
    // SRD: an attack with a weapon is the Attack action. Outside combat there is
    // no economy to spend, exactly as `resolveCast` finds.
    const events: GameEvent[] = [];
    // Gathered from here on, because the first thing that cannot be checked is
    // the once-per-turn clause on a swing outside combat.
    const unverified: string[] = [];
    // SRD Cleave's swing is a rider on a hit rather than an attack the Attack
    // action holds, so it costs what an Opportunity Attack costs here: nothing.
    const free = command.free === true || cleaving !== undefined;

    // — the sequence this creature's block prints ——————————————————————————
    //
    // Checked here, with the Attack action still unspent, and marked below
    // once it is: a swing the sequence does not hold is refused with nothing
    // paid for it, which is the rule every other argument on this command
    // follows.
    const sequence = multiattackOf(sheet);
    const budget = state.combat?.budgets[id] ?? null;
    // The lines this creature's block prints that it has taken this turn, which
    // is what a branch the block gates asks about — SRD Clay Golem's third
    // Slam. Read off the same ledger the swings inside the action are counted
    // in, so the composition and the size of the action cannot come to disagree
    // about which branch is being taken; empty outside a fight, where there is
    // no turn to have taken anything on.
    const linesUsed =
      state.combat === null
        ? []
        : statedBonusActionsUsed(
            state.combat.budgets[id]?.featureUsedOnTurn ?? {},
            state.combat.turnsTaken,
          );
    let slot: string | null = null;
    // The composition is a rule about one Attack action, and outside combat
    // there is no turn to hold one — the same absence Cleave, Slow, Sap and Vex
    // report rather than enforce. Said out loud, because a rule that checked
    // and a rule that could not look identical from outside.
    if (sequence !== null && !free && command.bonusAction !== true && budget === null) {
      unverified.push(
        `${id}'s block prints its attacks as a sequence, and there are no turns here to count one against — nothing held this swing to it`,
      );
    }
    // **The lines the parser read nothing out of, where nothing else sizes the
    // action.** SRD Hydra: "The hydra makes as many Bite attacks as it has
    // heads" — a sentence that sizes the Attack action and that the engine
    // could not execute. The action is held to one swing, which is what it
    // always held, and the clause *says so*: a fact a command can proceed past
    // conservatively owes an `unverified` clause and never a `needs-context`,
    // because a fight must not stop to ask how many heads something has.
    //
    // **It names the lines and claims no more than that.** Which of them, if
    // any, was the one that sized the action is a thing the engine cannot
    // know: an unread Multiattack and an unread breath weapon arrive at the
    // sheet identically, as a name in `unreadActions` and nothing else — what
    // the sheet tells apart is a sequence the parser *read* from one it did
    // not. So the clause reports what went unread and offers the remedy
    // conditionally — a Winter Wolf's reader learns its Cold Breath is prose,
    // which is true, and is not told the wolf has heads.
    //
    // A block the parser read whole says nothing at all, and neither does one
    // whose sequence the engine can execute: a clause on every block without a
    // sequence would be noise about a fact that is not missing. Once at the
    // swing that takes the action, like the handover beside a sequence, rather
    // than at every swing inside it.
    if (
      sequence === null &&
      !free &&
      command.bonusAction !== true &&
      attacker.heads === null &&
      unreadActionsOf(sheet).length > 0 &&
      budget !== null &&
      budget.attacksRemaining === null
    ) {
      unverified.push(
        `${id}'s block prints ${unreadActionsOf(sheet).join(', ')}, which the engine read nothing out of, and nothing states how many swings its Attack action holds — it held one. Where one of those lines counts the swings off a number the table keeps, a declareCreatureHeads command states that number.`,
      );
    }
    if (
      sequence !== null &&
      !free &&
      command.bonusAction !== true &&
      state.combat !== null &&
      budget !== null
    ) {
      const made = attacksMadeThisTurn(state.combat, id);
      const next = { ...made, [attackName]: (made[attackName] ?? 0) + 1 };
      // **The first swing of the Attack action is unconstrained**, because a
      // stat block prints its attacks as actions of their own: a Ghoul taking
      // its Claw action makes one Claw, and the sequence is about what may
      // follow. Everything after it is measured against the whole turn's
      // swings — so a Claw and a Bite is refused as surely as two Claws are,
      // and for the same reason: neither pair is what the block printed.
      if (budget.attacksRemaining !== null && !multiattackAllows(sequence, next, linesUsed)) {
        return err(
          'not_in_multiattack',
          `${id}'s block prints ${describeMultiattack(sequence)} in one action, and a ${attackName} is not what is left of it`,
        );
      }
      // **What the line says that the engine cannot execute.** The Mummy's
      // "and uses Dreadful Glare", the dragons' "It can replace one attack
      // with a use of Spellcasting" — a permission whose subject is a save or
      // a prose action, with nothing here to spend, because making fewer
      // swings than a sequence prints was always legal. So it is reported
      // rather than enforced, in the channel a hit's printed rider already
      // uses, at the swing that opens the action: dropping it silently makes
      // the creature weaker than the book, and repeating it at every swing is
      // noise.
      if (sequence.handOver !== undefined && Object.keys(made).length === 0) {
        unverified.push(
          `${id}'s block prints "${sequence.handOver}" beside the sequence — the engine does not apply that; a DM does`,
        );
      }
      slot = sequenceSlot(attackName, next[attackName]!);
    }

    // SRD Cleave: "You can make this extra **attack** only once per turn." What
    // is allowed once is the swing, not its landing — so the allowance is spent
    // here, beside the action economy, and a Cleave that misses has still been
    // made. Outside combat there is no turn to count it against, which is the
    // same answer Slow, Sap and Vex give to the same absence.
    if (cleaving !== undefined) {
      if (state.combat === null) {
        unverified.push(
          "Cleave's extra attack is once per turn, and there are no turns outside combat to count it against",
        );
      } else {
        events.push({ type: 'feature-used', id, feature: CLEAVE, turn: state.combat.turnsTaken });
      }
    }
    if (
      !free &&
      command.bonusAction === true &&
      state.combat !== null &&
      state.combat.budgets[id] !== undefined
    ) {
      // SRD: "You can't take more than one Bonus Action on a turn", which is
      // the primitive's own rule and the reason nothing else has to say it.
      const spent = spendBonusAction(state.combat, id, attacker.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;
      events.push({ type: 'bonus-action-spent', id });
    } else if (
      !free &&
      command.bonusAction !== true &&
      state.combat !== null &&
      state.combat.budgets[id] !== undefined
    ) {
      // SRD Extra Attack: the action is taken once and holds however many
      // attacks a feature puts in it, so only the first swing costs one.
      const spent = spendAttack(
        state.combat,
        id,
        // SRD Hydra: "as many Bite attacks as it has heads" — the size of the
        // action follows a declared head count where the block states no
        // sequence the engine can execute, is the largest branch the creature
        // is offered where it states one, and is the sheet's number otherwise.
        // The fold spends the same answer.
        attacksInAction(sheet, attacker.heads, linesUsed),
        attacker.conditions,
        { rules: actionRulesOn(state, id) },
        // SRD Flurry of Blows buys attacks an Unarmed Strike may take and a
        // weapon may not, so the price of this swing depends on which it was.
        // A block's printed Claw is neither: it is the creature's own line,
        // named by `command.action`, and no Unarmed Strike at all.
        unarmedStrike,
      );
      if (!spent.ok) return spent;
      events.push({ type: 'attack-made', id, ...(unarmedStrike ? { unarmed: true } : {}) });
    }

    // The slot this swing filled, written down where the economy was spent.
    // Only in combat, because a turn is what it is counted against — the
    // answer Cleave, Slow, Sap and Vex all give to the same absence.
    if (slot !== null && state.combat !== null) {
      events.push({ type: 'feature-used', id, feature: slot, turn: state.combat.turnsTaken });
    }

    // **The line is used up by the swing, hit or miss.** SRD *Monsters*: "a
    // monster can use the stat block part once" — what is allowed once is the
    // attack, not its landing, which is the same reading Cleave's once-per-turn
    // allowance takes two blocks above. And unlike that one it is *not* counted
    // against a turn: a line comes back on a die or a rest, so it is spent here
    // whether or not there is a fight running.
    if (printed?.recharge !== undefined) {
      events.push({ type: 'printed-line-expended', id, line: printed.name });
    }

    // — the roll ———————————————————————————————————————————————————————————
    const issuedBefore = supply.issuer.count;

    // Absent, not false: see `TargetContext.withinFiveFeet`.
    const withinFiveFeet = reach.value.apart === null ? undefined : reach.value.apart <= 5;
    if (reach.value.apart === null) {
      unverified.push(
        `nobody has said where ${id} and ${command.target} are standing, so any rule that reads the distance between them — Prone, an automatic critical, an enemy within 5 feet — went unapplied rather than checked`,
      );
    }

    // SRD: a ranged attack has Disadvantage while an enemy is within 5 feet.
    const nearby = enemyWithinFiveFeet(state, id);
    unverified.push(...nearby.unverified);

    // **What this swing is made with, settled before anything reads it.** SRD
    // Reckless Attack grants Advantage on "attack rolls using Strength", so
    // the ability is a fact the gatherers below need and not only one the log
    // records afterwards. `attackAbility` asks nothing of the modes, so asking
    // it before them is the same answer the damage and the log get — and one
    // answer is the point: a second call that disagreed would be a rider
    // applying to a swing the Advantage did not.
    //
    // **A weapon attack always names an ability.** `AttackResult.ability` is
    // null only for a spell attack whose bonus an item printed, and no spell
    // attack comes through here.
    //
    // **And a printed attack gets the weaponless answer**, which is what makes
    // asking early safe rather than only convenient: `attackAbility` reads the
    // weapon, the style and the attacker's own choice, and reads `statedAttack`
    // not at all — so a stat block's line, which names no ability, comes out
    // the same here as it would after the roll. The difference is confined and
    // worth stating rather than leaving to be rediscovered: two readers use
    // this — `attack-landed`, which a printed line never reaches because
    // holding one is refused outright, and Graze, which needs a weapon and has
    // none there — and what a printed attack's own damage is rolled from is
    // `statedAttack`, where no ability appears at all. Nothing downstream is
    // handed a Strength the book did not print.
    const ability = attackAbility(sheet, {
      weapon,
      ...(style === null ? {} : { strikeStyle: inPlay(style) }),
      // Not read by `attackAbility`, and required by its options type: the
      // Armour Class belongs to the roll rather than to the question of which
      // modifier is added to it.
      targetAc: 0,
      ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
    });

    // SRD Dodge, Blur, and anything else standing that reaches this roll —
    // whether it sits on the attacker or on the creature being attacked. One
    // gatherer, shared with the spell attack, which is what stops the two
    // paths drifting apart again.
    const defending = defendingModes(state, id, command.target, ability);
    unverified.push(...defending.unverified);

    // SRD Pack Tactics, off the attacker's own stat block: "Advantage on an
    // attack roll against a creature if at least one of its allies is within 5
    // feet of the creature and the ally doesn't have the Incapacitated
    // condition." The trait is the creature's rather than the attack's, so it
    // reaches a swung Scimitar exactly as it reaches a Bite.
    const packing = packTactics(state, sheet, id, command.target);
    unverified.push(...packing.unverified);

    // Everything flat that reaches this roll, gathered before it is thrown so
    // the log can name each piece. SRD Weapon, +1: "a bonus to attack rolls …
    // made with this magic weapon" — the weapon in hand is what narrows it, so
    // the bow in the same pack gets nothing.
    // And SRD Archery: "attack rolls you make with **Ranged weapons**" — the
    // other narrowing, which asks what kind of thing is in hand rather than
    // which copy of it, so the record goes along with the id.
    const attackBonuses: readonly Bonus[] = [
      ...standingBonuses(state, id, 'attack', {
        withItem: command.weapon,
        weapon,
        ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
      }),
      // Bless is on the creature, not in the caller's head.
      ...bonusesFor(attacker.bonuses, 'attack'),
      ...(command.attackBonuses ?? []),
    ];

    // — who can see whom ——————————————————————————————————————————————————
    //
    // SRD Invisible, both halves of it: "Attack rolls against you have
    // Disadvantage, and your attack rolls have Advantage. If a creature can
    // somehow see you, you don't gain this benefit against that creature."
    // `attackerConditionModes` and `targetConditionModes` have always held the
    // exception; nothing reaching them ever carried the fact, so declaring
    // that the goblin is looking straight at the Rogue took nothing away.
    //
    // Three-valued, and the third value is homework rather than a verdict:
    // `null` is "nobody has said", and reading it as either answer would be
    // the engine inventing the one input the doctrine leaves to the fiction.
    // So an undeclared sight line keeps exactly the behaviour this roll has
    // always had — the benefit applied rather than withheld, which is
    // `rollModesFor`'s own reading of the same absence — and is *reported*
    // rather than asked about. A `needs-context` here would stop a fight to
    // settle a sight line on every swing, which is a rule nobody has ruled on.
    //
    // **`canSomehowSee`, and deliberately not `canSee`.** This is the one
    // sight question in the engine that `canSee` answers wrongly, and the
    // difference is a single sense: `sightBetween` reports `true` from any
    // member of `SIGHT_SENSES`, and Darkvision is in it — five SRD species
    // carry it as a standing grant. SRD Darkvision lets you see in Darkness;
    // it does **not** let you see a creature with the Invisible condition.
    // Asking `canSee` here would take Hide's and Greater Invisibility's
    // Advantage away from every elf, dwarf, gnome, orc and dragonborn in
    // range, silently, because a sense answers `true` rather than `null` and
    // the clause below would then have nothing to report. That is the thing a
    // future reader will be tempted to undo, and the reason not to.
    //
    // Owner's ruling, 2026-09-20: **Truesight and Blindsight satisfy "if a
    // creature can somehow see you"; Darkvision does not.** The ruling is a
    // set — `SENSES_THAT_SOMEHOW_SEE`, a narrowing of `SIGHT_SENSES` — and it
    // lives beside `canSee` in `standing.ts` rather than here, so this route
    // reads a question and never a list of sense names.
    //
    // The sibling clause `defendingModes` asks is a different sentence —
    // Dodge's "if you can see the attacker", which Darkvision genuinely
    // satisfies — so it rightly keeps `canSee`. One sense, two sentences, two
    // answers; `hide.test.ts` asserts both on one dwarf.
    const attackerConditions = effectiveConditions(state, id);
    const targetConditions = effectiveConditions(state, command.target);
    const targetCanSeeAttacker = canSomehowSee(state, command.target, id);
    const attackerCanSeeTarget = canSomehowSee(state, id, command.target);

    // **`benefitsFrom` rather than `hasCondition`, because the note claims the
    // swing kept something.** The readers below hand Invisible its Advantage
    // and its Disadvantage only while the creature may still benefit from the
    // condition — SRD Starry Wisp takes that away and leaves the condition —
    // so asking the wider question here would tell the table the swing kept a
    // mode it did not have.
    if (targetCanSeeAttacker === null && benefitsFrom(attackerConditions, 'invisible')) {
      unverified.push(
        `${id} is Invisible and nobody has said whether ${command.target} can see them; SRD takes that Advantage away only against a creature that can, so the swing kept it`,
      );
    }
    if (attackerCanSeeTarget === null && benefitsFrom(targetConditions, 'invisible')) {
      unverified.push(
        `${command.target} is Invisible and nobody has said whether ${id} can see them; SRD lifts that Disadvantage only for an attacker who can, so the swing kept it`,
      );
    }

    const swing: AttackOptions = {
      weapon,
      ...(stated === undefined ? {} : { statedAttack: stated }),
      ...(style === null ? {} : { strikeStyle: inPlay(style) }),
      targetAc: armorClassOf(state, command.target) + coverAcBonus(cover),
      proficient: proficientWith(sheet, weapon),
      // SRD Improved Critical, off the attacker's own sheet rather than the
      // caller's hand: a Champion's 19 is a critical whoever is narrating.
      ...(sheet.criticalOn === undefined ? {} : { criticalOn: sheet.criticalOn }),
      ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
      ...(command.thrown === undefined ? {} : { thrown: command.thrown }),
      ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
      modes: [...defending.modes, ...packing.modes, ...(command.modes ?? [])],
      beyondNormalRange: reach.value.beyondNormal,
      nearbyEnemy: nearby.near,
      attackBonuses,
      ...(command.damageBonuses === undefined ? {} : { damageBonuses: command.damageBonuses }),
      ...(command.extraDamage === undefined ? {} : { extraDamage: command.extraDamage }),
      // What actually bites: a condition a feature has suppressed gives nobody
      // anything. See `effectiveConditions`.
      attackerConditions,
      targetConditions,
      // Omitted rather than passed as `false` where nobody has declared it:
      // both readers ask `!== true`, so an absent fact is the behaviour the
      // roll has always had and a `false` would be a declaration nobody made.
      ...(targetCanSeeAttacker === null ? {} : { attackerContext: { targetCanSeeAttacker } }),
      ...(attackerCanSeeTarget === null ? {} : { targetContext: { attackerCanSeeTarget } }),
      ...(withinFiveFeet === undefined ? {} : { withinFiveFeet }),
    };

    const attack = rollAttack(supply.issuer, supply.rng, sheet, swing);
    if (!attack.ok) return attack;

    // **What the block says about the roll that the engine cannot evaluate.**
    // "with Advantage if the target is Grappled by the ankheg", and eight more
    // like it. Reported here rather than beside the rider below, because this
    // one could have changed whether the attack landed at all — and the
    // outcome it matters most to is the miss, which returns before the rider
    // is ever reached.
    if (printed?.qualification != null) {
      unverified.push(
        `${attackName}'s line reads "${printed.qualification}" — the engine cannot evaluate that, so the roll was made without it`,
      );
    }

    const namedFlat = attackBonuses.filter((bonus) => (bonus.flat ?? 0) !== 0);

    events.push({
      type: 'roll-recorded',
      who: id,
      label: `${attackName} attack`,
      natural: attack.value.roll.natural,
      total: attack.value.total,
      // The modifier, less every flat bonus that can name itself, and then
      // those by name — so the sum is what it always was and what a +1 did is
      // legible rather than folded into one unexplained number.
      contributions: [
        { source: 'attack', amount: attack.value.roll.modifier - flatBonusTotal(namedFlat) },
        ...namedFlat.map((bonus) => ({ source: bonus.source, amount: bonus.flat ?? 0 })),
      ],
      outcome: attack.value.hit ? 'hit' : 'miss',
      // Where the d20 came from, when it was not this engine. Absent for every
      // roll anything can make today, and read off the roll rather than
      // assumed — see `StatedRoll` in `events.ts` for why the field is here
      // before a door exists that could fill it.
      ...statedFrom(attack.value.roll.provenance),
      // Stamped on the roll rather than on the damage, because a miss deals none
      // and a missed swing must not be retryable.
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **Beside the roll, and before the miss returns.** SRD Vicious Mockery
    // says "the next attack roll it makes" and Guiding Bolt "the next attack
    // roll made against it"; neither says "the next one that hits", and a
    // grant spent only by a hit would give a fumbling attacker several bites
    // at one sentence. The same query `defendingModes` asked above, so what is
    // spent is exactly what was read — **including the sense clause**, which
    // has to be gathered again here for that sentence to stay true: a grant
    // the attacker's Truesight excused did not reach this roll, and a spender
    // that could not see the exception would eat it anyway. `sensesPerceiving`
    // is pure and state-only, so asking twice cannot disagree.
    for (const spent of consumedRollModifiers(state, {
      family: 'attack',
      roller: id,
      against: command.target,
      ability,
      rollerPerceives: sensesPerceiving(state, id, command.target),
    })) {
      events.push({ type: 'roll-modifier-consumed', id: spent.holder, source: spent.source });
    }

    // **And the hiding this swing gave away.** SRD Hide: the Invisible
    // condition "ends on you immediately after … you make an attack roll".
    //
    // *After* the roll, and the ordering is the rule rather than a
    // convenience: the swing was made from hiding, so the Advantage gathered
    // above is the Advantage it keeps. And *before the miss returns*, for the
    // reason the one-shot grants above it are spent there — the sentence
    // counts attack rolls and says nothing about whether one landed, and a
    // Hide that survived a miss would let one hider swing all day.
    events.push(...hidingEndedBy(state, id));

    if (!attack.value.hit) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });

      // SRD Graze: "If your attack roll with this weapon misses a creature,
      // you can deal damage to that creature equal to the ability modifier you
      // used to make the attack roll. This damage is the same type dealt by
      // the weapon, and the damage can be increased only by increasing the
      // ability modifier."
      //
      // A flat component with no roll and no bonuses: nothing is thrown, so
      // the count above still stands, and nothing that adds to a damage roll
      // reaches it — which is the second sentence of the property.
      const grazed = grazeDamage(weapon, sheet, ability, property);
      if (grazed !== null) {
        const world = events.reduce(applyEvent, state);
        // Not `fromAttack`: the attack roll missed, so a Reaction that answers
        // "when an attack roll hits you" has nothing to answer.
        const hurt = landDamage(world, command.target, [grazed], `${weapon?.name ?? 'Unarmed Strike'} (Graze)`, supply, {
          by: id,
        });
        if (!hurt.ok) return hurt;
        return ok({
          events: [...events, ...hurt.value.events],
          attack: attack.value,
          ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
          ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
          unverified: [...unverified, ...hurt.value.unverified],
          duplicate: false,
        });
      }

      return ok({ events, attack: attack.value, unverified, duplicate: false });
    }

    // **What the block says a hit does**, reported the moment the hit is known:
    // the clauses `printedRiderOnASwing` could not execute — the Mummy's curse,
    // a charge nobody has declared, an extra die a Bloodied swarm rolls — and
    // the parts of a clause it executed and could not check. What it *could*
    // execute is riding on `riding` and is applied below with everything else
    // a hit bought.
    unverified.push(...fromTheBlock.unverified);
    // And the printed line where the swing also bought one of its own — the
    // purchase wins and this goes back to the table, said out loud rather than
    // dropped.
    if (rider.value !== null && fromTheBlock.option !== null) {
      unverified.push(
        `${attackName} hit ${command.target}, and its line reads "${printed?.rider}" — ${rider.value.featureName} rode on this blow instead; a DM applies the rest`,
      );
    }

    // SRD Divine Smite is taken "immediately after hitting a target", which is
    // exactly here: the hit is known, the damage is not rolled. The roll that
    // got us here is already in the log, so the debt survives a reload.
    if (command.hold === true) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      events.push({
        type: 'attack-landed',
        attack: {
          attacker: id,
          target: command.target,
          weapon: command.weapon,
          // The stat block's own line, where this swing was one. Its identity
          // rather than its numbers, for the reason the weapon above it is an
          // id — see {@link PendingAttack.action}. `printed` is non-null
          // exactly when `command.action` was named and found, so the two
          // cannot disagree about which line is being held.
          ...(printed === null ? {} : { action: printed.name }),
          twoHanded: command.twoHanded === true,
          thrown: command.thrown === true,
          ...(command.finesseAbility === undefined
            ? {}
            : { finesseAbility: command.finesseAbility }),
          critical: attack.value.critical,
          ability,
          ...(property === null
            ? {}
            : {
                mastery: {
                  property,
                  ...(command.mastery?.feet === undefined ? {} : { feet: command.mastery.feet }),
                },
              }),
          targetAc: attack.value.targetAc,
          total: attack.value.total,
          natural: attack.value.roll.natural,
          mode: attack.value.roll.mode,
          // **The defender answers first**, and a hold is the window they
          // answer in: SRD Shield is cast "when you are hit by an attack roll"
          // and turns this very hit into a miss, so a rider resolved here would
          // Stun the creature out of the Reaction it had just been offered.
          // What the hit bought rides on the hold and `resolveAttackDamage`
          // settles it, which is also where the SRD's own order puts it — the
          // save is rolled after the blow rather than before damage nobody has
          // rolled. See {@link PendingAttack.rider}.
          ...(riding === null ? {} : { rider: riding }),
        },
      });

      return ok({ events, attack: attack.value, unverified, duplicate: false });
    }

    // — the damage —————————————————————————————————————————————————————————
    //
    // Everything that adds to this attack, gathered in one place: the features
    // that qualify, and whatever the caller knows about that the engine does
    // not — a magic weapon's own damage comes in that way until magic items are
    // parsed. A *bonus* is of the weapon's own type and rides with it through
    // Resistance; *extra* damage of another type does not.
    const fromFeatures = standingAttackDamage(state, id, {
      ability,
      // **The same question `isRangedAttack` answers, asked once.** A printed
      // line says which of the two it is and has no weapon behind it, so
      // asking the weapon made a Goblin's Shortbow melee — and a `meleeOnly`
      // grant would have added its damage to a shot across the moor. Nothing
      // in the bestiary holds such a grant today, which is exactly why the two
      // answers must not be left free to disagree.
      melee: stated === undefined ? rangeOf(weapon, command.thrown === true) === null : !stated.ranged,
      weapon,
      // SRD Vicious Weapon: "*this magic weapon* deals an extra 2d6 damage" —
      // the item in hand, not the row it is a magical version of, so the other
      // sword on the same belt gets nothing.
      withItem: command.weapon,
      mode: attack.value.roll.mode,
      target: command.target,
      turn: state.combat?.turnsTaken ?? null,
      ...(command.featureDamageTypes === undefined
        ? {}
        : { featureDamageTypes: command.featureDamageTypes }),
    });
    unverified.push(...fromFeatures.unverified);

    const rolled = rollAttackDamage(
      supply.issuer,
      supply.rng,
      sheet,
      {
        weapon,
        ...(stated === undefined ? {} : { statedAttack: stated }),
        ...(style === null ? {} : { strikeStyle: inPlay(style) }),
        targetAc: attack.value.targetAc,
        ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
        ...(command.thrown === undefined ? {} : { thrown: command.thrown }),
        ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
        damageBonuses: [
          // "…and damage rolls made with this magic weapon": a bonus of the
          // weapon's own type, so it meets Resistance with the blade.
          ...standingBonuses(state, id, 'damage', {
            withItem: command.weapon,
            weapon,
            ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
          }),
          ...fromFeatures.bonuses,
          ...(command.damageBonuses ?? []),
        ],
        extraDamage: [...fromFeatures.extra, ...(command.extraDamage ?? [])],
        // SRD Great Weapon Fighting: "you can treat any 1 or 2 on a damage die
        // as a 3." A rule the swing is read under rather than a number added
        // to it, gathered from the attacker's own standing effects and
        // narrowed by the weapon in hand — see `standingDamageEffects`.
        damageEffects: standingDamageEffects(state, id, {
          weapon,
          ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
        }),
        // SRD Cleave: "don't add your ability modifier to that damage unless
        // that modifier is negative."
        ...(cleaving === undefined ? {} : { withoutAbilityModifier: true as const }),
      },
      attack.value.critical,
    );
    if (!rolled.ok) return rolled;

    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });

    // A once-per-turn feature that rode on this hit has now used its allowance.
    // Recorded before the damage, so a log read forwards never shows the damage
    // of a feature whose use had not yet been written down.
    for (const feature of fromFeatures.spent) {
      events.push({ type: 'feature-used', id, feature, turn: state.combat?.turnsTaken ?? 0 });
    }

    const after = events.reduce(applyEvent, state);
    const hurt = landDamage(
      after,
      command.target,
      rolled.value.components,
      attackName,
      supply,
      {
        by: id,
        fromAttack: true,
        ...(attack.value.critical ? { critical: true } : {}),
        // **The defender answers first.** Where this opens a window, the rider
        // rides on the hold and resolves with the damage; where it opens none,
        // the field is ignored and the rider fires below exactly as it always
        // has. See {@link PendingDamage.rider}.
        ...(riding === null ? {} : { rider: { attacker: id, option: riding } }),
      },
    );
    if (!hurt.ok) return hurt;

    const landed = [...events, ...hurt.value.events];
    const mastered = masteryRider(landed.reduce(applyEvent, state), supply, {
      attacker: id,
      target: command.target,
      property,
      ability,
      ...(command.mastery?.feet === undefined ? {} : { feet: command.mastery.feet }),
      // SRD Slow and Vex both say "and deal damage to it". Damage a Reaction is
      // still holding has been rolled and not applied, and it is damage: what
      // would make the sentence false is a blow that dealt none at all —
      // Resistance to nothing, an Immunity, a reduction that ate the total.
      dealtDamage: (hurt.value.amount ?? 0) > 0 || hurt.value.offers.length > 0,
    });
    if (!mastered.ok) return mastered;

    // **What the hit bought**, on the world the blow has already changed — the
    // state the mastery property was handed, and for its reason: the save this
    // rolls is rolled by a creature the damage may have moved.
    //
    // **After the weapon's property and not before it**, because the order is
    // the engine's to fix and only one of the two orders changes an outcome: a
    // Stunned creature fails a Strength or Dexterity save automatically, so a
    // feature's condition resolved first would settle a Topple that the SRD
    // has the target roll for. Nothing in the book puts the two in an order,
    // and this one adds nothing to either.
    //
    // **And not at all where somebody was offered a Reaction to this damage**,
    // which is the one ordering the book does fix: the rider went onto the
    // hold above and `settleDamage` resolves it once the defender has spoken.
    const riderEvents: GameEvent[] = [];
    if (riding !== null && hurt.value.offers.length === 0) {
      const bought = applyHitRider(
        [...landed, ...mastered.value.events].reduce(applyEvent, state),
        supply,
        { attacker: id, target: command.target },
        riding,
      );
      if (!bought.ok) return bought;
      riderEvents.push(...bought.value.events);
      unverified.push(...bought.value.unverified);
    }

    return ok({
      events: [...landed, ...mastered.value.events, ...riderEvents],
      attack: attack.value,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...unverified, ...hurt.value.unverified, ...mastered.value.unverified],
      duplicate: false,
    });
  });
}

/**
 * Whether this swing may be the extra one SRD Cleave gives.
 *
 * Four questions, all answerable before anything is spent: the property is
 * Cleave at all, the first creature was somebody else, the second is within
 * five feet of the first, and the turn has not already had its extra swing.
 * The reach to the second creature is the ordinary one and is checked where
 * every other swing checks it.
 */
function cleaveOpening(
  state: GameState,
  id: CharacterId,
  target: CharacterId,
  cleaving: CharacterId,
  property: WeaponMastery | null,
): Err | null {
  if (property !== 'cleave') {
    return err('no_mastery', `the weapon ${id} is swinging does not have the Cleave property`);
  }
  if (target === cleaving) {
    return err('same_target', `Cleave swings at a second creature, and ${target} was the first`);
  }
  if (state.combat !== null && !canUseFeatureThisTurn(state.combat, id, CLEAVE)) {
    return err('already_cleaved', `${id} has already made a Cleave attack this turn`);
  }

  if (state.scene === null) return null;
  const apart = distanceBetween(state.scene, cleaving, target);
  // Nobody has said where one of them is standing: the ordinary reach check
  // below asks for that in its own words, so this one stays quiet.
  if (!apart.ok) return null;
  if (apart.value > CLEAVE_REACH) {
    return err(
      'out_of_reach',
      `Cleave reaches a creature within ${CLEAVE_REACH} feet of the first, and ${target} is ${apart.value} feet from ${cleaving}`,
    );
  }
  return null;
}

/**
 * What a mastery property does once the blow has landed, plus the mark Cleave's
 * once-per-turn clause reads.
 *
 * One function so the two halves of the attack path — the swing that rolls its
 * own damage and the held one that rolls it a command later — cannot come to
 * disagree about what a hit does.
 */
function masteryRider(
  world: GameState,
  supply: Supply,
  hit: Omit<MasteryHit, 'property'> & { readonly property: WeaponMastery | null },
): Result<MasteryOutcome> {
  const property = hit.property;
  if (property === null) return ok({ events: [], unverified: [] });
  return masteryAfterHit(world, supply, { ...hit, property });
}

/**
 * SRD Graze's damage: the ability modifier, of the weapon's own type.
 *
 * Null where there is nothing to deal — the property is not Graze, there is no
 * weapon, or the modifier is zero or worse, which is a hit for no damage and
 * not a hit for a negative one.
 */
function grazeDamage(
  weapon: Weapon | null,
  sheet: CharacterSheet,
  ability: Ability,
  property: WeaponMastery | null,
): DamageComponent | null {
  if (property !== 'graze' || weapon === null) return null;
  const modifier = modifierFor(sheet, ability);
  if (modifier <= 0) return null;
  return {
    source: `${weapon.name} (Graze)`,
    type: weapon.damage.type,
    roll: null,
    flat: modifier,
    total: modifier,
  };
}

/**
 * Whether the attack can reach at all, and whether it is a long shot.
 *
 * SRD melee is 5 feet, or 10 with a Reach weapon. A ranged attack has
 * Disadvantage "beyond normal range" and is not a legal attack beyond long
 * range. An unplaced creature has no distance to anything, and that is not an
 * error here: it is the same "nobody has said" the rest of positioning treats
 * as a real state, so the attack proceeds unhampered rather than being refused
 * on a fact nobody established.
 */
function reachCheck(
  state: GameState,
  id: CharacterId,
  target: CharacterId,
  /**
   * How far this attack carries, whoever decided it: a weapon's properties or
   * a stat block's printed line. One record because the question is the same
   * either way, and two copies of this walk would be two answers to it.
   */
  carry: {
    readonly label: string;
    readonly reach: number;
    readonly range: { readonly normal: number; readonly long: number } | null;
  },
): Result<{ readonly apart: number | null; readonly beyondNormal: boolean }> {
  // **No scene at all is not a gap in the record; it is a table not using
  // positioning.** An ambush in a corridor nobody drew, a brawl in a room with
  // no grid — most SRD play looks like this, and demanding a map before anyone
  // may swing a sword is exactly the obstructive behaviour this engine exists
  // not to have. So the reach check has nothing to check, the attack proceeds,
  // and `resolveAttack` reports which rules went unapplied.
  if (state.scene === null) return ok({ apart: null, beyondNormal: false });

  const measured = distanceBetween(state.scene, id, target);
  if (!measured.ok) {
    // A scene *does* exist and somebody is not on it. That is a gap in a
    // record the table is actively keeping, and whether a weapon reaches is a
    // precondition of the attack rather than a modifier on it — the same
    // question `resolveSpell` has always asked about a spell's range, which
    // until now it answered one way for a Fire Bolt and another for a sword.
    const scene = state.scene;
    const off = [id, target].filter((who) => positionOf(scene, who) === null);
    return needsContext(
      'unplaced',
      `nobody has said where ${off.join(' or ')} ${off.length === 1 ? 'is' : 'are'} standing, and whether ${carry.label} reaches depends on it`,
      off.map((who) => ({
        kind: 'position' as const,
        subject: who,
        need: `where ${who} is standing`,
        because: `${carry.label} has a reach to check`,
        satisfyWith: `a placeCreatureInScene command for ${who}`,
      })),
    );
  }
  const apart = measured.value;

  const range = carry.range;
  if (range === null) {
    if (apart > carry.reach) {
      return err(
        'out_of_reach',
        `${carry.label} reaches ${carry.reach} feet; ${target} is ${apart} away`,
      );
    }
    return ok({ apart, beyondNormal: false });
  }

  if (apart > range.long) {
    return err('out_of_range', `${carry.label} carries ${range.long} feet; ${target} is ${apart} away`);
  }
  return ok({ apart, beyondNormal: apart > range.normal });
}

export interface AttackDamageCommand extends CommandIdentity {
  /**
   * A spell cast on the hit, out of the SRD's own "immediately after hitting"
   * window. Validated and paid for as a casting, because it is one.
   */
  readonly smite?: { readonly spellId: string; readonly slotLevel: number };
  readonly damageBonuses?: readonly Bonus[];
  readonly extraDamage?: readonly ExtraDamage[];
  /**
   * The damage type a feature that offers a choice deals on this hit.
   *
   * The choice belongs to the moment the damage is rolled, which for a held
   * attack is here rather than when it landed. See the field of the same name
   * on {@link AttackCommand}.
   */
  readonly featureDamageTypes?: Readonly<Record<string, string>>;
}

/**
 * Roll the damage of an attack that was held, and settle the debt.
 *
 * Everything the roll needs was written down when the attack landed, so
 * nothing has to be remembered between the two calls — which is what makes
 * this survive a reload rather than living in the caller's hands.
 */
export function resolveAttackDamage(
  state: GameState,
  id: CharacterId,
  command: AttackDamageCommand,
  supply: Supply,
): Result<AttackResolution> {
  return once(state, `attack-damage:${id}`, command, () => {
    return { events: [], attack: null, unverified: [], duplicate: true };
  }, (stamp) => {
    const pending = state.pendingAttack;
    if (pending === null || pending.attacker !== id) {
      return err('no_pending_attack', `${id} has no hit waiting for its damage`);
    }

    const attacker = creatureOf(state, id);
    if (attacker === null) return unknownCreature(id);
    // The sheet as it stands, for `resolveAttack`'s reason: the damage carries
    // an ability modifier, and a belt that sets the Strength is on the creature
    // rather than on the sheet the character was built with. Read now rather
    // than pinned when the hit landed — the SRD's benefit lasts "while you wear
    // this", so an item taken off between the roll and the blow takes its
    // modifier with it.
    const sheet = sheetAsItStands(state, id) ?? attacker.sheet;

    const weapon = pending.weapon === null ? null : (supply.content.item(pending.weapon)?.weapon ?? null);

    // **The line the hold pinned, read back off the sheet above.** The weapon
    // beside it is re-read from the catalogue by its id; this is the same move
    // against the same identity, and the record it lands in is the creature's
    // own — a stat block's attacks were pinned into `creature-added`, so no
    // catalogue is opened here either.
    //
    // A line the sheet no longer prints is a programmer's error dressed as a
    // rules question, so it is refused rather than quietly settled as an
    // Unarmed Strike: the swing that opened this hold found it a moment ago.
    const printed = pending.action === undefined ? null : printedAttackOf(sheet, pending.action);
    if (pending.action !== undefined && printed === null) {
      return err(
        'unknown_action',
        `the hit being settled was made with ${pending.action}, and ${id}'s stat block no longer prints a line by that name`,
      );
    }
    const stated = statedInPlay(printed, pending.thrown);

    const heldStyle = strikeStyleFor(state, id, {
      weapon,
      wielding: wieldingOf(supply.content, attacker),
    });
    const events: GameEvent[] = [];
    const extra: ExtraDamage[] = [...(command.extraDamage ?? [])];

    // — the spell cast on the blow ——————————————————————————————————————————
    if (command.smite !== undefined) {
      const smite = castOnHit(state, supply.content, id, attacker, pending.target, command.smite);
      if (!smite.ok) return smite;
      events.push(...smite.value.events);
      extra.push(...smite.value.damage);
    }

    const current = events.reduce(applyEvent, state);
    const legalTypes = checkFeatureDamageTypes(current, id, command.featureDamageTypes);
    if (!legalTypes.ok) return legalTypes;

    const fromFeatures = standingAttackDamage(current, id, {
      ability: pending.ability,
      // **The same question `resolveAttack` asks, and asked the same way.** A
      // printed line says which of the two it is and has no weapon behind it,
      // so asking the weapon would make a Goblin's held Shortbow shot melee.
      melee: stated === undefined ? rangeOf(weapon, pending.thrown) === null : !stated.ranged,
      weapon,
      // The weapon the hit was made with was written down when it landed, so a
      // held attack narrows on the same fact the ordinary one does.
      withItem: pending.weapon,
      // Recorded when the attack was held. Absent only in a log written before
      // the field existed, and none has one: `resolveAttack` always sets it.
      mode: pending.mode ?? 'normal',
      target: pending.target,
      turn: current.combat?.turnsTaken ?? null,
      ...(command.featureDamageTypes === undefined
        ? {}
        : { featureDamageTypes: command.featureDamageTypes }),
    });

    const issuedBefore = supply.issuer.count;
    const rolled = rollAttackDamage(
      supply.issuer,
      supply.rng,
      sheet,
      {
        weapon,
        // What a printed line's damage is rolled from — the same field the
        // unheld swing hands `rollAttackDamage`, off the same line.
        ...(stated === undefined ? {} : { statedAttack: stated }),
        // Re-derived rather than pinned on the held attack, for the reason the
        // sheet above is re-read: the style's own gate is "while you aren't
        // wearing armor", so a Monk who put a breastplate on between the roll
        // and the blow rolls the blow without it. Nothing new is written to
        // `attack-landed` for it, and a log from before this existed resolves
        // exactly as it did.
        ...(heldStyle === null ? {} : { strikeStyle: inPlay(heldStyle) }),
        targetAc: pending.targetAc,
        twoHanded: pending.twoHanded,
        thrown: pending.thrown,
        ...(pending.finesseAbility === undefined
          ? {}
          : { finesseAbility: pending.finesseAbility }),
        damageBonuses: [
          // The weapon the hit was made with was written down when it landed,
          // and so was the hand it was in — both narrowings read the swing the
          // hold remembers rather than a fact the caller restates.
          ...standingBonuses(current, id, 'damage', {
            withItem: pending.weapon,
            weapon,
            twoHanded: pending.twoHanded,
          }),
          ...fromFeatures.bonuses,
          ...(command.damageBonuses ?? []),
        ],
        extraDamage: [...fromFeatures.extra, ...extra],
        // Re-derived like the style above and from the same swing: a rule
        // about the dice is a standing effect, and a standing effect is read
        // afresh at the moment it bites.
        damageEffects: standingDamageEffects(current, id, {
          weapon,
          twoHanded: pending.twoHanded,
        }),
      },
      pending.critical,
    );
    if (!rolled.ok) return rolled;

    events.push(
      {
        type: 'attack-damage-dealt',
        attacker: id,
        ...(stamp === null ? {} : { command: stamp }),
      },
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    );

    // The same allowance the ordinary attack path spends, spent on the half of a
    // held attack that actually deals the damage.
    for (const feature of fromFeatures.spent) {
      events.push({ type: 'feature-used', id, feature, turn: current.combat?.turnsTaken ?? 0 });
    }

    const after = events.reduce(applyEvent, state);
    const hurt = landDamage(
      after,
      pending.target,
      rolled.value.components,
      // `attackName`'s reading, on the far side of the hold: the block's own
      // heading first, so a Bite is reported as a Bite rather than as a fist.
      printed?.name ?? weapon?.name ?? 'Unarmed Strike',
      supply,
      {
        by: pending.attacker,
        fromAttack: true,
        ...(pending.critical ? { critical: true } : {}),
        // What the hit bought, carried from the hold onto the damage roll
        // where one opens a window — so a held swing whose damage somebody may
        // answer settles through `settleDamage` exactly as an ordinary one
        // does, and nothing there knows which half of a swing sent it.
        ...(pending.rider === undefined
          ? {}
          : { rider: { attacker: pending.attacker, option: pending.rider } }),
      },
    );
    if (!hurt.ok) return hurt;

    // The same riders the swung attack runs, off the property the hold pinned:
    // a mastery wired into one half of the path would be a rule a Divine Smite
    // silently switched off.
    const landed = [...events, ...hurt.value.events];
    const rider = masteryRider(landed.reduce(applyEvent, state), supply, {
      attacker: pending.attacker,
      target: pending.target,
      property: pending.mastery?.property ?? null,
      ability: pending.ability,
      ...(pending.mastery?.feet === undefined ? {} : { feet: pending.mastery.feet }),
      // SRD Slow and Vex both say "and deal damage to it". Damage a Reaction is
      // still holding has been rolled and not applied, and it is damage: what
      // would make the sentence false is a blow that dealt none at all —
      // Resistance to nothing, an Immunity, a reduction that ate the total.
      dealtDamage: (hurt.value.amount ?? 0) > 0 || hurt.value.offers.length > 0,
    });
    if (!rider.ok) return rider;

    // **What the hold still owed, now that the blow has landed.** The same two
    // rules the ordinary path follows: after the weapon's mastery property,
    // because a Stunned creature fails a Strength or Dexterity save
    // automatically and a Topple must be rolled for; and **not at all** where
    // somebody was offered a Reaction to this damage, because the rider went
    // onto that hold above and `settleDamage` resolves it once the defender
    // has spoken.
    const bought: GameEvent[] = [];
    const unverified: string[] = [];
    if (pending.rider !== undefined && hurt.value.offers.length === 0) {
      const paid = applyHitRider(
        [...landed, ...rider.value.events].reduce(applyEvent, state),
        supply,
        { attacker: pending.attacker, target: pending.target },
        pending.rider,
      );
      if (!paid.ok) return paid;
      bought.push(...paid.value.events);
      unverified.push(...paid.value.unverified);
    }

    return ok({
      events: [...landed, ...rider.value.events, ...bought],
      attack: null,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...hurt.value.unverified, ...rider.value.unverified, ...unverified],
      duplicate: false,
    });
  });
}

/**
 * A spell cast in the window a hit opens, and what it adds to the blow.
 *
 * SRD Divine Smite is a level 1 Evocation spell with a Bonus Action casting
 * time, so it goes through the casting rules like any other: the caster must
 * have it, the slot is spent, the Bonus Action is spent, and the
 * one-slot-per-turn rule applies. "The target takes an extra 2d8 Radiant
 * damage **from the attack**" — from the attack, so a critical doubles it,
 * which is why it joins the attack's own damage rather than being dealt
 * separately.
 *
 * **It reads what the target is, because the spell does.** "The damage
 * increases by 1d8 if the target is a Fiend or an Undead" is the third SRD
 * sentence that varies an outcome by creature type, and the only one on a
 * damage roll rather than a saving throw. A target nobody has typed is asked
 * about rather than assumed to be neither — and asked **before** the slot, the
 * Bonus Action and the dice, so a Paladin who has to ask pays nothing.
 */
function castOnHit(
  state: GameState,
  content: Content,
  id: CharacterId,
  attacker: CreatureState,
  target: CharacterId,
  smite: { readonly spellId: string; readonly slotLevel: number },
): Result<{ readonly events: readonly GameEvent[]; readonly damage: readonly ExtraDamage[] }> {
  const definition = content.spell(smite.spellId);
  if (definition === null) {
    return err('no_definition', `${smite.spellId} has no executable definition`);
  }

  const effect = definition.effects.find((e) => e.kind === 'attack-damage');
  if (effect === undefined || effect.kind !== 'attack-damage') {
    return err(
      'not_cast_on_a_hit',
      `${definition.name} is not a spell cast on an attack that hits`,
    );
  }

  // The route decides nothing here — Divine Smite rolls no save and makes no
  // attack — but casting a spell the caster does not have is still a refusal.
  const route = chooseRoute(attacker.spellcasting, smite.spellId, undefined);
  if (!route.ok) return route;

  // **Before the slot and before the dice.** A creature nobody has typed is a
  // thin record rather than one that is neither a Fiend nor an Undead, so the
  // engine asks; taking the smaller branch quietly would be a wrong number no
  // later assertion could see.
  const varies = effect.againstType;
  const victim = state.creatures[target];
  if (varies !== undefined && victim !== undefined && victim.creatureType === null) {
    return needsContext(
      'needs_context',
      `${definition.name} cannot be resolved until what kind of creature ${target} is has been established`,
      [
        {
          kind: 'creature-type',
          subject: target,
          need: `what kind of creature ${target} is`,
          because: `${definition.name} deals extra damage against ${varies.types.join(' or ')}`,
          satisfyWith: `declareCreatureType(${target}, …), or a creatureType when the creature is added`,
        },
      ],
    );
  }

  // **`resolveCastWith`, not `resolveCast`.** This is inside
  // `resolveAttackDamage`, which settles an attack the engine is already
  // holding open and is exempt from `mayAct` for that reason — a guard here
  // would strand the held roll. The identity is the settlement's own, and this
  // command carries no id of its own, so nothing is lost by taking the half
  // beneath the wrapper.
  const cast = resolveCastWith(state, id, {
    spell: definition.name,
    level: definition.level,
    concentration: definition.concentration,
    castingTime: definition.castingTime,
    slotLevel: smite.slotLevel,
    route: routeLabel(route.value),
    // The printed text the book leaves to the table, pinned onto the casting
    // the blow writes. CLAUDE.md's rule 5, asked of the second atomic path
    // that had been handing it to its caller alone: a spell cast on a hit has
    // no declaration, so `spell-cast` is where a handover lives. No SRD spell
    // reaches here — a cast-on-hit must print an `attack-damage` effect and
    // none of the three that hand text over does — and a homebrew one can.
    ...(definition.dmDecides === undefined ? {} : { dmDecides: definition.dmDecides }),
  }, null);
  if (!cast.ok) return cast;

  // A second component rather than a bigger notation: the SRD writes two
  // sentences, so the log shows two contributions and says *why* the second
  // one is there. Same damage type, so they meet the target's defences as one
  // pool, and a Critical Hit doubles both.
  const singled =
    varies !== undefined &&
    varies.types.some((named) => isCreatureType(victim?.creatureType, named));

  const dice = scaledDiceFor(
    effect.damage,
    definition.level,
    attacker.sheet.level,
    smite.slotLevel,
  );
  const flat = scaledFlatFor(effect.damage, definition.level, smite.slotLevel);

  return ok({
    events: cast.value,
    damage: [
      {
        source: definition.name,
        type: effect.damageType,
        // **Both halves of the amount, and either may be absent.**
        // `ExtraDamage` has carried a `flat` beside its dice since it was
        // written and this path read only the dice, so a printed number
        // beside a smite's notation was dropped — no SRD smite prints one, so
        // nothing changes today. A dice-free amount makes the pair load-
        // bearing: `rollAttackDamage` throws no die for one and hands over the
        // flat alone.
        ...(dice === undefined ? {} : { dice }),
        ...(flat === 0 ? {} : { flat }),
      },
      ...(singled
        ? [
            {
              source: `${definition.name} (${victim!.creatureType})`,
              type: effect.damageType,
              dice: varies!.extraDice,
            },
          ]
        : []),
    ],
  });
}

