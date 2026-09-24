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
import type { CreatureSize, Weapon, WeaponMastery } from '@ie/srd';
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
  type StatedDamage,
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
  readPrintedRiders,
  type PrintedChargeGate,
  type PrintedHitGate,
  statedBonusActionsUsed,
  unreadActionsOf,
} from '../monster.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  SAME_BEARING_DEGREES,
  bearingBetween,
  bearingBetweenPoints,
  bearingsApart,
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  distanceBetween,
  distanceBetweenPoints,
  positionOf,
  sizeAtMost,
} from '../positioning.js';
import { type ReactionOffer } from '../reactions.js';
import {
  durationSecondsAt,
  isCreatureType,
  scaledDiceFor,
  scaledFlatFor,
  swungExtraDiceAt,
  type SpellDefinition,
  type SpellEffect,
} from '../spell-definitions.js';
import type { RepeatSave } from '../timers.js';
import { ONGOING_RECORD_VERSION } from '../ongoing-compatibility.js';
import { schedule } from './conditions.js';
import {
  actionRulesOn,
  addsAbilityToLightExtraAttack,
  armorClassOf,
  canSomehowSee,
  checkFeatureDamageTypes,
  effectiveConditions,
  isBloodied,
  sensesPerceiving,
  sheetAsItStands,
  standingAttackDamage,
  standingBonuses,
  standingDamageEffects,
  standingWeaponRollRule,
  strikeStyleFor,
  weaponRiderDamageType,
  type HitForcedMove,
  type HitGrapple,
  type HitOption,
  type HitRiderAnchor,
  type StrikeStyle,
  canSee,
} from '../standing.js';
import { benefitsFrom } from '../conditions.js';
import { resolveDuration, timeView, turnAnchored, type TurnAnchor } from '../time.js';
import {
  chooseRoute,
  type ConcentrationConsequence,
  hidingEndedBy,
  type Supply,
  resolveCastWith,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { numbersFor, routeLabel } from './item-casting.js';
import { remaining } from '../resources.js';
import type { CastingRoute } from '../spellcasting.js';
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
import { grapplesOn } from './unarmed.js';
import { effectiveSizeOf } from '../size.js';
import { allyWithinFiveFeetOf, defendingModes, enemyWithinFiveFeet } from './rolls.js';
import { consumedRollModifiers } from '../roll-modifiers.js';
import { answerTheBlow, wardAgainst } from './passive-defenses.js';

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
 * What the Light property's one extra attack is counted under.
 *
 * The same namespace and the same ledger Cleave's allowance uses, because it
 * is the same kind of thing: a **weapon** clause spent once a turn, which no
 * catalogue names and no class table holds. One key for both prices, because
 * the book prints one extra attack and Nick only changes what pays for it —
 * two keys would let a Nick be followed by a Bonus Action swing.
 */
const LIGHT_EXTRA_ATTACK = `${WEAPON_MASTERY_LEDGER}light-extra-attack`;

/**
 * Everything the Light property's extra attack has to be true of, asked before
 * anything is spent.
 *
 * > "When you take the Attack action on your turn and attack with a Light
 * > weapon, you can make one extra attack as a Bonus Action later on the same
 * > turn. That extra attack must be made with a **different** Light weapon."
 *
 * Five questions and the book asks four of them: there is a turn to be later
 * on, this turn's Attack action swung a Light weapon, this weapon is Light,
 * it is a different weapon, and the extra attack has not already been made.
 *
 * **"A different Light weapon" is a different copy.** Two daggers are two
 * weapons and the engine knows a creature has two of them, so the same
 * catalogue id is legal exactly when a second copy is owned — which is the
 * rule `resolveAttack` already keeps about swinging anything at all, "owning
 * is not wielding, but you cannot wield what you do not own". `equipped` is
 * per kind of thing by an older and deliberate decision, so it could not
 * answer this one: two daggers in two hands are one entry in it.
 *
 * The fifth question is Nick's, and it is the only one about the character
 * rather than about the weapons: the substitution is a mastery property, so it
 * wants the weapon to print it and the character to have unlocked it.
 */
function lightExtraProblem(
  state: GameState,
  id: CharacterId,
  sheet: CharacterSheet,
  weaponId: string | null,
  weapon: Weapon | null,
  price: 'bonus-action' | 'attack-action',
): Err | null {
  if (state.combat === null || state.combat.budgets[id] === undefined) {
    return err(
      'not_in_combat',
      "the Light property's extra attack is made later on the same turn, and there are no turns outside combat",
    );
  }
  if (weaponId === null || weapon === null || !weapon.properties.includes('light')) {
    return err(
      'not_light',
      `the Light property's extra attack is made with a Light weapon, and ${weapon?.name ?? 'an Unarmed Strike'} is not one`,
    );
  }

  const swung = state.combat.budgets[id]?.lightWeaponSwung ?? null;
  if (swung === null) {
    return err(
      'no_light_swing',
      `${id} has not taken the Attack action with a Light weapon this turn, so there is no extra attack to make`,
    );
  }
  // A different **copy**: the same kind of thing counts where the creature
  // really has two of them, and the second dagger is what the sentence is
  // about.
  if (swung === weaponId && quantityOf(state, id, weaponId) < 2) {
    return err(
      'same_weapon',
      `the Light property's extra attack is made with a different weapon, and ${id} has only one ${weapon.name}`,
    );
  }
  if (!canUseFeatureThisTurn(state.combat, id, LIGHT_EXTRA_ATTACK)) {
    return err(
      'already_swung',
      `${id} has already made the Light property's one extra attack this turn`,
    );
  }

  if (price === 'attack-action') {
    if (weapon.mastery !== 'nick') {
      return err(
        'no_nick',
        `only a weapon with the Nick property makes the extra attack as part of the Attack action, and a ${weapon.name} does not have it`,
      );
    }
    if (!(sheet.weaponMasteries ?? []).includes(weaponId)) {
      return err('no_mastery', `this character does not have mastery with a ${weapon.name}`);
    }
  }
  return null;
}

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

/**
 * What a stat block's own line says about the **damage**, once the roll that
 * gates it has been made.
 *
 * Its own reader beside {@link printedRiderOnASwing} rather than a third field
 * on it, and the reason is the moment: that one is asked *before* the d20,
 * because what a hit buys has to be settled before the blow so a hold can pin
 * it, and this one cannot be — SRD Goblin Warrior's "if the attack roll had
 * Advantage" is a fact about a roll that has not happened yet. So the swing
 * asks twice, at the two moments the two sentences are about.
 *
 * **Three of the four gates hold no absence and the fourth does.** A roll's own
 * mode, half a creature's Hit Points and a grapple the engine filed are facts
 * it holds outright, so there is nothing to own up to for any of them. The
 * charge is not: outside a fight nothing keeps a turn, so nothing records the
 * move that preceded the swing, and a Goat's smaller die going unrolled is a
 * rule that did not fire rather than a rule that checked and found nothing.
 * This reader owes the table the sentence its neighbour owes, which is why it
 * carries an {@link PrintedDamageOnASwing.unverified} at all.
 */
interface PrintedDamageOnASwing {
  /** SRD's "**plus** 2 (1d4) Slashing damage": a component of its own. */
  readonly extra: readonly ExtraDamage[];
  /**
   * SRD's "**or** 2 (1d4) Piercing damage": what the line rolls in place of
   * its printed damage, or null where nothing replaces it.
   */
  readonly instead: readonly StatedDamage[] | null;
  /**
   * What this reader could not settle, in words a table can act on.
   *
   * Empty for every gate but the charge, and empty for that one inside a fight
   * — see {@link chargeRun}. SRD Goat and SRD Giant Seahorse are the two lines
   * whose charge gates a damage clause **and nothing else**, so without this
   * channel a Goat swung outside combat would roll the smaller die and say
   * nothing whatever about why.
   */
  readonly unverified: readonly string[];
}

const NO_PRINTED_DAMAGE: PrintedDamageOnASwing = { extra: [], instead: null, unverified: [] };

function printedDamageOnASwing(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  printed: StatedAttack | null,
  mode: RollMode,
): PrintedDamageOnASwing {
  if (printed?.rider == null) return NO_PRINTED_DAMAGE;

  const extra: ExtraDamage[] = [];
  const unverified: string[] = [];
  let instead: readonly StatedDamage[] | null = null;
  // **Every damage clause the line prints, not the first one.** SRD Swarm of
  // Venomous Snakes rolls less when it is Bloodied *and* adds poison in the
  // same sentence, joined by a dash; a reader that stopped at one shape dealt
  // the smaller bite and dropped the venom.
  for (const read of readPrintedRiders(printed.rider).riders) {
    if (read.kind !== 'damage') continue;
    if (read.ifNoLargerThan !== undefined && !sizeReaches(state, target, read.ifNoLargerThan).reaches) {
      continue;
    }
    if (read.when !== undefined) {
      // The charge is the one gate that can fail for want of a record rather
      // than on the facts, and it says so — the same sentence the other reader
      // puts on a condition clause the same charge would have bought.
      if (read.when.kind === 'charged') {
        const charged = chargeRun(state, attacker, target, read.when.feet);
        if (charged.unverified !== null) unverified.push(charged.unverified);
        if (!charged.met) continue;
      } else if (!gateHolds(state, attacker, target, read.when, mode)) {
        continue;
      }
    }

    if (read.how === 'instead') {
      instead = [{ dice: read.dice, flat: read.flat, type: read.type }];
      continue;
    }
    extra.push({
      source: printed.name,
      type: read.type,
      dice: read.dice,
      ...(read.flat === 0 ? {} : { flat: read.flat }),
    });
  }

  return { extra, instead, unverified };
}

/**
 * Whether a printed gate holds, on the facts the engine keeps.
 *
 * Three gates and three records, and the closed list is the promise: a
 * sentence whose gate is not one of these never becomes a
 * {@link PrintedHitGate} at all and is handed to the table with the clause it
 * gated. The fourth — the charge — is {@link chargeRun}'s, because it is the
 * one gate that can fail for want of a record and owes the table a sentence
 * when it does; both callers ask it directly rather than through here.
 *
 * The mode is **the roll's as the pipeline settled it**, which is deliberately
 * not "somebody offered Advantage": a mode cancelled to `normal` by a
 * Disadvantage is a roll that did not have Advantage, and the book's gate is
 * about the roll rather than about what was offered.
 *
 */
function gateHolds(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  gate: Exclude<PrintedHitGate, PrintedChargeGate>,
  mode: RollMode,
): boolean {
  switch (gate.kind) {
    case 'attack-had-advantage':
      return mode === 'advantage';
    case 'bloodied':
      return isBloodied(state.creatures[gate.who === 'target' ? target : attacker]);
    case 'grappled-by-attacker':
      return grapplesOn(state, target).some((grapple) => grapple.grappler === attacker);
  }
}

/** Whether a size gate lets a clause through, and whether anybody stated a size. */
function sizeReaches(
  state: GameState,
  target: CharacterId,
  limit: CreatureSize,
): { readonly reaches: boolean; readonly size: CreatureSize | null } {
  // **The one reader of the three answers**, which is `effectiveSizeOf`: the
  // size an active feature prints, then the size somebody stated, then the
  // map's. This used to be the middle two written out here, which is why a
  // Goliath in Large Form was Large on the map and Medium to a Wolf's Prone.
  const size = effectiveSizeOf(state, target);
  return { reaches: size === null || sizeAtMost(size, limit), size };
}

/** Whether a charge gate was met, and — where it was not — why not. */
interface ChargeRun {
  readonly met: boolean;
  /** What the table is owed about a gate that failed for want of a record. */
  readonly unverified: string | null;
}

/**
 * SRD Boar: "if the boar moved 20+ feet straight toward it immediately before
 * the hit."
 *
 * Three questions, and the turn budget answers all three: the mover's most
 * recent segments, taken back from the swing **while they share one bearing**,
 * total at least the printed feet, and that bearing runs toward the target's
 * space as it stands now.
 *
 * - *Most recent, backwards.* The sentence says "immediately before the hit",
 *   so the run is read from the end of the turn's record. A boar that charged
 *   twenty feet, stopped to sniff five feet sideways and then swung has not
 *   charged: the sideways step ends the run at five feet.
 * - *While they share one bearing.* "Straight" is the whole of the gate that
 *   feet cannot express, and a creature may take a straight line in as many
 *   steps as it likes — two ten-foot steps due north are a twenty-foot charge.
 * - *Toward the target's space as it stands at the swing.* The book measures
 *   the run against where the blow lands, not against where the target was
 *   when the run began, and only one of those is a fact the engine holds.
 *
 * **No record is no charge**, said out loud. Outside combat there is no budget
 * at all and the gate is simply not met, which goes on `unverified` so a table
 * can apply the line by hand; inside one the budget is authoritative and
 * nothing is asked, because a turn that recorded no move is a turn nobody
 * moved on.
 */
function chargeRun(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  feet: number,
): ChargeRun {
  const budget = state.combat?.budgets[attacker];
  if (budget === undefined) {
    return {
      met: false,
      unverified: `this line asks whether ${attacker} moved ${feet}+ feet straight at ${target} before the hit, and nothing is keeping ${attacker}'s turn; outside a fight the engine records no moves, so the clause was not applied`,
    };
  }

  const scene = state.scene;
  if (scene === null) return { met: false, unverified: null };
  const toward = bearingBetween(scene, attacker, target);
  if (!toward.ok) return { met: false, unverified: null };

  let covered = 0;
  let run: number | null = null;
  for (const segment of [...budget.movementSegments].reverse()) {
    const bearing = bearingBetweenPoints(segment.from, segment.to);
    if (bearing === null) continue;
    if (run !== null && bearingsApart(run, bearing) > 0) break;
    run = bearing;
    covered += distanceBetweenPoints(segment.from, segment.to);
  }

  if (run === null || covered < feet) return { met: false, unverified: null };
  return {
    met: bearingsApart(run, toward.value) <= SAME_BEARING_DEGREES,
    unverified: null,
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

  const read = readPrintedRiders(printed.rider);
  const unverified: string[] = [];

  // The clause the swing has reported since the bestiary landed, **per residue
  // rather than per line**. A printed rider silently dropped is a creature
  // made weaker than the book; a rider read three quarters of the way and
  // reported as finished is worse, because nothing says anything is missing.
  for (const clause of read.handedOver) {
    unverified.push(
      `${printed.name} hit ${target}, and its line reads "${clause}" — the engine does not apply that; a DM does`,
    );
  }

  const effects: SpellEffect[] = [];
  let grapples: HitGrapple | undefined;
  let forcedMove: HitForcedMove | undefined;
  let lowersHitPointMaximum: 'damage-taken' | undefined;
  let saveDc: number | undefined;
  let span: { readonly lasts: TurnAnchor; readonly lastsOn: HitRiderAnchor } | undefined;

  /**
   * **One span for one blow.** A `HitOption` carries a single deadline, and
   * every printed line in the book names at most one — so a second and
   * different one is a sentence this engine cannot execute, and it goes back
   * to the table rather than quietly taking the first one's moment.
   *
   * A deadline the clock cannot reach is the same answer for the same reason:
   * a condition hung on a turn boundary there is none of would never lift.
   * **The converter is asked rather than the combat**, because two different
   * absences make the moment unreachable and only one of them is "no fight" —
   * a clause anchored on the *target's* next turn also has nowhere to go when
   * the creature that was hit has no place in the order. `resolveDuration` is
   * the one function `fileDeadlines` will ask again, so the two cannot come to
   * disagree, and it is asked before the swing commits.
   */
  const claimSpan = (lasts: TurnAnchor, lastsOn: HitRiderAnchor, what: string): boolean => {
    const anchor = lastsOn === 'target' ? target : attacker;
    const pinned = resolveDuration(timeView(state), turnAnchored(lasts, anchor));
    if (!pinned.ok) {
      // **Both halves, exactly as the line-at-a-time reader reported them**:
      // the book's own sentence, so a DM has the words, and the reason this
      // half of it could not be executed. A clause dropped with only the
      // reason attached is a rule nobody can apply by hand.
      unverified.push(
        `${printed.name} hit ${target}, and its line reads "${printed.rider}" — the engine does not apply that; a DM does`,
        `${printed.name}'s ${what} lasts until a turn boundary of ${anchor}'s, and ${pinned.reason}`,
      );
      return false;
    }
    if (span === undefined) {
      span = { lasts, lastsOn };
      return true;
    }
    if (span.lasts === lasts && span.lastsOn === lastsOn) return true;
    unverified.push(
      `${printed.name}'s ${what} ends at a different moment from the rest of the line, and one hit carries one deadline; a DM applies that half`,
    );
    return false;
  };

  /**
   * SRD's "If the target is a Medium or smaller creature", evaluated rather
   * than assumed — and reported both ways round: a creature the clause does
   * not reach is named, and a creature whose size nobody has stated is taken
   * for Medium out loud.
   */
  const passesSize = (limit: CreatureSize | undefined, what: string): boolean => {
    if (limit === undefined) return true;
    const { reaches, size } = sizeReaches(state, target, limit);
    if (!reaches) {
      unverified.push(
        `${target} is ${size}, and ${printed.name}'s ${what} reaches a creature that is ${limit} or smaller — it was not applied`,
      );
      return false;
    }
    if (size === null) {
      unverified.push(
        `nobody has said how big ${target} is, so ${printed.name}'s line took them for Medium; a creature larger than ${limit} would have been left alone`,
      );
    }
    return true;
  };

  for (const rider of read.riders) {
    switch (rider.kind) {
      // The damage clause is this reader's neighbour's, asked after the d20:
      // an amount is not an effect list, and whether the attack roll had
      // Advantage is a fact about a roll that has not happened yet. That
      // reader owns whatever it owes the table, the charge's own sentence
      // included — see {@link printedDamageOnASwing}.
      case 'damage':
        break;

      case 'grapple': {
        if (!passesSize(rider.ifNoLargerThan, 'grapple')) break;
        // SRD Giant Scorpion's "from one of two claws": how many creatures the
        // block can hold at once. The engine holds no record of limbs, so the
        // clause is handed back exactly as `grappleTarget` hands back the free
        // hand SRD asks it for — the grapple is made and the limit is the DM's.
        if (rider.withLimbs !== undefined) {
          unverified.push(
            `${printed.name} grapples ${target} from ${rider.withLimbs}, and the engine holds no record of limbs; how many creatures ${attacker} can hold at once is the table's`,
          );
        }
        grapples = {
          escapeDc: rider.escapeDc,
          ...(rider.withLimbs === undefined ? {} : { withLimbs: rider.withLimbs }),
          ...(rider.whileHeld === undefined ? {} : { whileHeld: rider.whileHeld }),
        };
        break;
      }

      case 'forced-move': {
        if (!passesSize(rider.ifNoLargerThan, rider.direction)) break;
        forcedMove = { direction: rider.direction, feet: rider.feet };
        break;
      }

      case 'hit-point-maximum':
        lowersHitPointMaximum = 'damage-taken';
        break;

      case 'speed-cut': {
        if (!claimSpan(rider.lasts, rider.lastsOn, 'Speed cut')) break;
        // The grant a spell's slow already hangs, released by the `grants`
        // deadline `fileDeadlines` files over it.
        effects.push({ kind: 'speed', change: 'add', feet: -rider.feet });
        break;
      }

      case 'roll-mode': {
        if (!claimSpan(rider.lasts, rider.lastsOn, 'mode on a later roll')) break;
        // SRD Ettin: "the next attack roll it makes"; SRD Worg: "the next
        // attack roll made against the target". `oneShot` is the half that
        // says *the next*, and the span is the half that says *before*; both
        // endings stand and the first to arrive wins.
        effects.push({
          kind: 'roll-mode',
          modifier: {
            mode: rider.mode,
            selector: { roll: 'attack', relation: rider.relation },
            oneShot: true,
          },
        });
        break;
      }

      case 'condition': {
        if (!passesSize(rider.ifNoLargerThan, 'clause')) break;
        // SRD Boar's charge, evaluated off the turn's own record of what it
        // was made of — and the only gate a condition clause can carry, for
        // the reason `PrintedChargeGate` gives: this is settled before the d20
        // and the other three gates are facts about the blow.
        if (rider.when !== undefined) {
          const charged = chargeRun(state, attacker, target, rider.when.feet);
          if (charged.unverified !== null) unverified.push(charged.unverified);
          if (!charged.met) break;
        }
        // SRD Ghast's "If the target is a non-Undead creature", the other gate
        // the engine holds the fact for — read off the creature rather than
        // the map, because `creatureType` is what a stat block pinned into
        // `creature-added`.
        if (rider.unlessType !== undefined) {
          const creatureType = state.creatures[target]?.creatureType ?? null;
          if (isCreatureType(creatureType, rider.unlessType)) {
            unverified.push(
              `${target} is ${creatureType}, and ${printed.name}'s line excepts one — nothing was applied`,
            );
            break;
          }
          if (creatureType === null) {
            unverified.push(
              `nobody has said what kind of creature ${target} is, so ${printed.name}'s line took them for one it reaches; a ${rider.unlessType} would have been left alone`,
            );
          }
        }
        // SRD Ghoul's "or elf": the other half of the same gate, and a species
        // rather than a creature type. **Read off the record creation kept**,
        // which is a fact the engine does hold for exactly the population a
        // Ghoul claws: the choices are the character and they are stored on
        // the creature. The word compared is the *line's*, so no species id is
        // written down here.
        //
        // A creature with no record — a monster, somebody a DM simply added —
        // has no species the engine can answer for, and the absent fact is
        // reported rather than read as a denial: the reading the size gate
        // above already takes of the same silence.
        if (rider.alsoExcepts !== undefined) {
          const species = state.creatures[target]?.character?.speciesId ?? null;
          if (species !== null && species.toLowerCase() === rider.alsoExcepts.toLowerCase()) {
            unverified.push(
              `${target} is a ${species}, and ${printed.name}'s line excepts one — nothing was applied`,
            );
            break;
          }
          if (species === null) {
            unverified.push(
              `${printed.name}'s line also excepts an ${rider.alsoExcepts}, and nothing on ${target} says what they are; it was applied regardless`,
            );
          }
        }
        if (rider.lasts !== undefined) {
          if (!claimSpan(rider.lasts, rider.lastsOn ?? 'attacker', 'clause')) break;
        }

        const save = rider.save;
        if (save !== undefined) saveDc = save.dc;
        effects.push(
          // **One save for every condition the failure imposes**, which is the
          // shape `save` already has: a second `save` effect would roll a
          // second saving throw and a creature could fail one and make the
          // other, which is not the line. A line that prints no save simply
          // imposes them.
          ...(save === undefined
            ? rider.conditions.map((name) => ({
                kind: 'condition' as const,
                condition: { name },
              }))
            : [
                {
                  kind: 'save' as const,
                  ability: save.ability,
                  condition: rider.conditions[0]!,
                  ...(rider.conditions.length > 1
                    ? { conditions: rider.conditions.slice(1).map((name) => ({ name })) }
                    : {}),
                },
              ]),
        );
        // SRD Bearded Devil: "Until this poison ends, the target can't regain
        // Hit Points." The same span the condition runs for, hung as the rule
        // Chill Touch already hangs and released by the same `grants` deadline.
        if (rider.preventsHealing === true) {
          effects.push({ kind: 'healing-rule', rule: 'prevented' });
        }
        break;
      }
    }
  }

  if (
    effects.length === 0 &&
    grapples === undefined &&
    forcedMove === undefined &&
    lowersHitPointMaximum === undefined
  ) {
    return { option: null, unverified };
  }

  return {
    option: {
      feature: `${attacker}:${printed.name}`,
      featureName: printed.name,
      option: printed.name,
      name: printed.name,
      pool: null,
      costs: 0,
      effects,
      // The block prints no ability behind this clause — there is no sheet for
      // "your spell save DC" to be read off — and where it prints a number it
      // is stated instead. `8 + Proficiency Bonus` is what remains, and it is
      // the fallback an item's casting already falls to.
      ability: null,
      ...(saveDc === undefined ? {} : { saveDc }),
      ...(span === undefined ? {} : { lasts: span.lasts, lastsOn: span.lastsOn }),
      ...(grapples === undefined ? {} : { grapples }),
      ...(forcedMove === undefined ? {} : { forcedMove }),
      ...(lowersHitPointMaximum === undefined ? {} : { lowersHitPointMaximum }),
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

/**
 * A cantrip cast **with** the swing that is about to be made, and the one
 * choice such a spell offers.
 *
 * Its own type rather than an object written inline, for the reason
 * {@link MasteryUse} and {@link HitRiderRequest} are: what a caller says about
 * a rule is a thing with a name, and a name is what a door above the engine
 * publishes a field as.
 *
 * `damageType` answers the offer the cantrip makes — SRD True Strike's "it can
 * be Radiant damage or the weapon's normal damage type (your choice)" — and
 * naming none takes the weapon's own, which is the other half of the "or". It
 * is answered here rather than in {@link AttackCommand.featureDamageTypes}
 * because that map is keyed by whatever made the offer: several imbued weapons
 * and several features can be standing at once, so a swing has to say which
 * offer it is answering. This offer arrives in the same object as the spell
 * that makes it.
 */
export interface CantripSwingRequest {
  readonly spellId: string;
  readonly damageType?: string;
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
   * This swing is the extra attack the **Light** property buys, and which slot
   * pays for it.
   *
   * SRD Light: "When you take the Attack action on your turn and attack with a
   * Light weapon, you can make one extra attack as a Bonus Action later on the
   * same turn. That extra attack must be made with a different Light weapon,
   * and you don't add your ability modifier to the extra attack's damage
   * unless that modifier is negative."
   *
   * SRD Nick: "When you make the extra attack of the Light property, you can
   * make it **as part of the Attack action** instead of as a Bonus Action. You
   * can make this extra attack only once per turn."
   *
   * **One field rather than two**, because there is one extra attack and two
   * prices for it: `'bonus-action'` is what the property prints, and
   * `'attack-action'` is Nick's substitution, refused unless the weapon prints
   * that property and the character has unlocked it. A separate `nick` flag
   * would let a caller ask for the substitution without asking for the attack
   * it substitutes the price of.
   *
   * **Not `bonusAction` beside it**, which says "this Unarmed Strike is a
   * Monk's Bonus Action strike" and is refused for anything with a weapon in
   * it. The two sentences grant different swings out of the same slot and a
   * shared field would make each of them answer for the other's refusals.
   *
   * Absent is an ordinary swing, which is every attack written before the
   * property had a door.
   */
  readonly lightAttack?: 'bonus-action' | 'attack-action';
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
  /**
   * A cantrip cast **with** this swing, and what it offers the swing a choice
   * of.
   *
   * SRD True Strike: "you make one attack with the weapon used in the spell's
   * casting." The casting and the attack are one moment — one Action, one
   * roll, nothing granted and nothing left behind — so the swing names the
   * cantrip rather than a casting command naming a swing. It is the mirror of
   * {@link AttackDamageCommand.smite}, one command earlier: that one is a
   * spell cast on a hit that has already happened, and this one is the spell
   * the hit happens inside.
   *
   * **The Action it costs is the casting's**, a Magic action like any other
   * spell's, which is why `free`, `lightAttack` and `bonusAction` are refused
   * beside it: each of those says something else paid for the swing, and the
   * casting is what pays. It follows that this is **not the Attack action**,
   * so Extra Attack adds nothing to it and a stat block's sequence has
   * nothing to say about it.
   *
   * See {@link CantripSwingRequest} for the choice it carries.
   */
  readonly cantrip?: CantripSwingRequest;
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
  /**
   * A ward turned this swing away before it was thrown.
   *
   * SRD Sanctuary. `attack` is null and nothing was spent, which is the owner's
   * ruling of 2026-09-22: the attacker may swing at a creature nobody warded
   * instead, or take the book's other branch by simply not swinging again.
   *
   * Absent rather than false, so a reader asks one question and a log written
   * before wards existed reads back unchanged.
   */
  readonly warded?: true;
  /**
   * A duplicate took the blow, so nothing of it reached the target.
   *
   * SRD Mirror Image. `attack` is the roll that was made and it *hit* — what
   * it hit was an illusion. No damage was rolled, no hold was built and
   * nobody was offered a Reaction, because a hit taken by a duplicate is not
   * a hit on the creature behind it.
   */
  readonly deflected?: true;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * Everything the swing needs from a cantrip cast with it, settled before
 * anything is spent.
 *
 * The definition and the route are what the casting below needs; the ability,
 * the type and the dice are what the roll needs. Gathered once, at the door,
 * so a refusal arrives with the Action unspent and no die thrown — the rule
 * every other argument on this command follows.
 */
interface CantripSwing {
  readonly definition: SpellDefinition;
  readonly route: CastingRoute;
  /** The ability the attack and the damage are rolled with, whatever the weapon says. */
  readonly ability: Ability;
  /** The type the caster took in place of the weapon's own, or null. */
  readonly damageType: string | null;
  /** The Cantrip Upgrade's dice at this caster's level, or undefined below every band. */
  readonly extra?: ExtraDamage;
}

/**
 * The cantrip this swing is cast with, checked against everything but the
 * dice.
 *
 * SRD True Strike is cast with "a weapon with which you have proficiency" as
 * its Material component and makes "one attack with the weapon used in the
 * spell's casting", so the questions are: is this a spell the caster can cast,
 * is it one of the kind that is cast this way, is there a weapon in the swing
 * at all, is the caster proficient with it, and is the damage type they named
 * one the spell offers. Every one of them is answerable here, which is why
 * every one of them is asked here.
 *
 * **Holding it is the swing's own question**, already asked: `resolveAttack`
 * refuses a weapon the attacker does not have, which is the same reading the
 * casting of a weapon rider takes of "you are holding" — carrying is as close
 * as this engine gets, because nothing says which hand a thing is in.
 *
 * Null where the swing names no cantrip, which is every attack in the game.
 */
function cantripAsked(
  content: Content,
  id: CharacterId,
  attacker: CreatureState,
  sheet: CharacterSheet,
  weapon: Weapon | null,
  command: AttackCommand,
): Result<CantripSwing | null> {
  const asked = command.cantrip;
  if (asked === undefined) return ok(null);

  // **The price, first.** Each of these three says something *else* paid for
  // the swing — a Reaction somebody already spent, the Light property's
  // allowance, a Monk's Bonus Action — and the casting is what pays here. A
  // swing with two prices is a question with two answers.
  if (command.free === true || command.lightAttack !== undefined || command.bonusAction === true) {
    return err(
      'cantrip_pays_for_the_swing',
      `${id}'s swing is the casting's own Action; it cannot also be free, the Light property's extra attack or a Bonus Action strike`,
    );
  }
  // **And the window a hold opens, which this swing has no way to carry
  // through.** A held attack writes down what the damage roll will need and
  // settles it in a second command; the substitution and the Radiant die are
  // this casting's and are written on no hold, so a held cantrip swing would
  // roll its damage with the Strength the spell replaced. Refused rather than
  // half-kept.
  if (command.hold === true) {
    return err(
      'cantrip_swing_not_held',
      `${id}'s swing and its casting are one moment; the damage cannot be left for a second command`,
    );
  }

  const definition = content.spell(asked.spellId);
  if (definition === null) {
    return err('no_definition', `${asked.spellId} has no executable definition`);
  }
  const effect = definition.effects.find((one) => one.kind === 'weapon-attack');
  if (effect === undefined || effect.kind !== 'weapon-attack') {
    return err(
      'not_cast_with_a_swing',
      `${definition.name} is not a spell cast with the weapon attack it makes`,
    );
  }

  // SRD: the spell's Material component is "a weapon with which you have
  // proficiency", and the attack is made "with the weapon used in the spell's
  // casting". An Unarmed Strike is not a weapon and neither is a stat block's
  // printed line, so there is nothing for the casting to be made with.
  if (weapon === null) {
    return err(
      'no_weapon_for_the_casting',
      `${definition.name} is cast with a weapon in hand, and ${id} is swinging none`,
    );
  }
  if (!proficientWith(sheet, weapon)) {
    return err(
      'not_proficient',
      `${definition.name} is cast with a weapon ${id} has proficiency with, and they have none with a ${weapon.name}`,
    );
  }

  // The route decides two things here and both matter: whether this creature
  // can cast the spell at all, and which ability the substitution puts on the
  // roll. A class's own route wins over a feat's and two class routes are a
  // refusal, which is `chooseRoute`'s rule and not a second copy of it.
  const chosen = chooseRoute(attacker.spellcasting, asked.spellId, undefined);
  if (!chosen.ok) return chosen;
  const ability = chosen.value.ability;
  if (ability === null) {
    return err(
      'no_spellcasting_ability',
      `${definition.name} rolls its attack with the caster's spellcasting ability, and ${id}'s route has none`,
    );
  }

  // "it can be Radiant damage **or** the weapon's normal damage type (your
  // choice)": a type the spell does not offer is refused before anything is
  // spent, exactly as a feature's offer is.
  const offered = effect.damageTypes ?? [];
  if (asked.damageType !== undefined && !offered.includes(asked.damageType)) {
    return err(
      'bad_damage_type',
      offered.length === 0
        ? `${definition.name} offers no damage type, and this swing named ${asked.damageType}`
        : `${definition.name} deals ${offered.join(' or ')} damage or the weapon's own, not ${asked.damageType}`,
    );
  }

  // The Cantrip Upgrade, off the **character's** level: a band table with
  // nothing at or below it adds nothing at all, which is every caster below
  // the first band.
  const upgrade = effect.extraDamage;
  const dice =
    upgrade === undefined ? undefined : swungExtraDiceAt(upgrade.diceAtLevel, sheet.level);

  return ok({
    definition,
    route: chosen.value,
    ability,
    damageType: asked.damageType ?? null,
    ...(upgrade === undefined || dice === undefined
      ? {}
      : { extra: { source: definition.name, type: upgrade.damageType, dice } }),
  });
}

/**
 * Cast the cantrip the swing is made with, and spend what it costs.
 *
 * `resolveCastWith` rather than `resolveCast`, for `castOnHit`'s reason: the
 * identity is this command's, which has already been established, and the
 * half beneath the wrapper is what takes a casting apart from an id. The
 * Action goes here — a Magic action, which is what every casting spends
 * whatever its casting time — so a caster who has already acted is refused
 * with the swing unmade.
 */
function castWithTheSwing(
  state: GameState,
  id: CharacterId,
  swing: CantripSwing,
): Result<readonly GameEvent[]> {
  const definition = swing.definition;
  return resolveCastWith(
    state,
    id,
    {
      spell: definition.name,
      level: definition.level,
      concentration: definition.concentration,
      castingTime: definition.castingTime,
      // A cantrip costs no slot, which is the one thing `slotless` says here.
      slotless: 'cantrip',
      route: routeLabel(swing.route),
      // The printed text the book leaves to the table, pinned onto the event
      // this casting writes — rule 5, on the third atomic path. No SRD spell
      // of this kind hands anything over; a homebrew one can.
      ...(definition.dmDecides === undefined ? {} : { dmDecides: definition.dmDecides }),
    },
    null,
  );
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
    const legalTypes = checkFeatureDamageTypes(state, id, command.featureDamageTypes, weapon);
    if (!legalTypes.ok) return legalTypes;

    // And the rider this swing says it is buying, for the same reason and in
    // the same breath: a Stunning Strike asked for with an empty pool, with a
    // Greatsword in hand or twice in one turn is refused here, with the action
    // unspent and no die thrown. What it costs is spent on the hit, below.
    const rider = hitRiderAsked(state, id, sheet, weapon, command.onHit);
    if (!rider.ok) return rider;

    // And the cantrip this swing is cast with, for the third time the same
    // reason: everything about it that can be known before the roll is known
    // now — the spell, the route, the weapon, the proficiency, the type
    // offered and the price — so a refusal costs neither the Action nor a die.
    // The casting itself happens where the economy is spent, below.
    const cantrip = cantripAsked(supply.content, id, attacker, sheet, weapon, command);
    if (!cantrip.ok) return cantrip;
    const castWithIt = cantrip.value;

    // **One offer answered, never two.** The cantrip cast with this swing and a
    // casting that imbued the weapon in hand make the same offer in the same
    // words — "it can be X damage **or** the weapon's normal damage type" —
    // and each *replaces* the weapon's own type rather than adding a
    // component. A swing that took both is a blow with two types where the
    // book gives it one, and picking by precedence would be the engine
    // answering a question the caller asked twice. Refused here, with nothing
    // spent, which is what `cantrip_pays_for_the_swing` does one field over
    // for the same shape of mistake.
    if (
      castWithIt?.damageType != null &&
      weaponRiderDamageType(state, id, weapon, command.featureDamageTypes) !== null
    ) {
      return err(
        'two_damage_type_offers',
        `${castWithIt.definition.name} and a casting already on this weapon both offer this blow a damage type, and a blow deals one; name the type on one of them`,
      );
    }

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

    // — SRD Light: the extra attack, and what pays for it ————————————————
    //
    // Resolved here for the reason the Bonus Action strike above is: every
    // question the two sentences ask is answerable before anything is spent
    // and before a die is thrown, so a swing that is not the extra attack the
    // property buys is refused with the turn untouched.
    const lightExtra = command.lightAttack;
    if (lightExtra !== undefined) {
      const refused = lightExtraProblem(state, id, sheet, command.weapon, weapon, lightExtra);
      if (refused !== null) return refused;
    }

    // — the ward the target is standing behind ————————————————————————————
    //
    // SRD Sanctuary: "any creature who **targets** the warded creature with an
    // attack roll ... must succeed on a Wisdom saving throw or either choose a
    // new target or lose the attack or spell." Targeting, so it is asked
    // before the roll — and **before the economy**, which is the owner's
    // ruling of 2026-09-22 and the whole of why both of the book's branches
    // stay reachable: an attacker turned away still holds the Attack action
    // and may swing at somebody nobody warded.
    //
    // Nothing is a Reaction here and nothing is held: the defender elects
    // nothing and is not asked. See `commands/passive-defenses.ts`.
    //
    // **An `ok` rather than an `err` when the save fails**, because by then a
    // d20 has been thrown: the generator has moved, and only an emitted
    // `rolls-issued` records that it did. A refusal carries no events, so
    // refusing here would lose the die and a replay would diverge. A
    // re-declaration the same turn *is* refused, and that one throws nothing.
    //
    // **Every die this command throws is counted from here**, the ward's
    // included. `rolls-issued` carries a *delta*, `fold/rolls.ts` accumulates
    // it into `state.rollsIssued`, and the layer above builds the next
    // command's issuer from that number — so a ward's d20 left out of the
    // count is a `RollId` re-issued over one already in the log. The mark is
    // above the ward rather than beside the attack roll for exactly that
    // reason, and both branches below subtract it.
    const issuedBefore = supply.issuer.count;

    const ward = wardAgainst(state, id, command.target, supply);
    if (!ward.ok) return ward;
    if (ward.value.barred) {
      return ok({
        events: [
          ...ward.value.events,
          {
            type: 'rolls-issued',
            count: supply.issuer.count - issuedBefore,
            rng: supply.rng.snapshot(),
          },
        ],
        // No roll was made, which is what losing the attack means. Not a miss
        // — `attack` being null with `duplicate` false is the one other way
        // this command comes back without one, and `warded` says which.
        attack: null,
        warded: true,
        unverified: [...ward.value.unverified],
        duplicate: false,
      });
    }

    // — the action it costs —————————————————————————————————————————————————
    //
    // SRD: an attack with a weapon is the Attack action. Outside combat there is
    // no economy to spend, exactly as `resolveCast` finds.
    const events: GameEvent[] = [...ward.value.events];
    // Gathered from here on, because the first thing that cannot be checked is
    // the once-per-turn clause on a swing outside combat. The ward's clause is
    // already in it: a save taken outside a fight has no turn to be held to.
    const unverified: string[] = [...ward.value.unverified];
    // SRD Cleave's swing is a rider on a hit rather than an attack the Attack
    // action holds, so it costs what an Opportunity Attack costs here: nothing.
    // SRD Nick pays out of the Attack action the swing is already part of, so
    // it costs nothing here either — the same answer, for the same reason, as
    // Cleave's rider and an Opportunity Attack's Reaction.
    // And a swing cast with a cantrip costs nothing *here* for the same
    // reason a Cleave does: something else is the price. SRD True Strike is a
    // Magic action, spent by the casting below — so this is not the Attack
    // action, Extra Attack puts nothing in it, and a stat block's sequence has
    // nothing to say about it.
    const free =
      command.free === true ||
      cleaving !== undefined ||
      lightExtra === 'attack-action' ||
      castWithIt !== null;
    // And the other price the property prints. Kept apart from
    // `command.bonusAction`, which is a Monk's Unarmed Strike and refuses a
    // weapon by name: one slot, two sentences, two fields.
    const bonusActionSwing = command.bonusAction === true || lightExtra === 'bonus-action';

    // — the casting this swing is made through ————————————————————————————
    //
    // **Here, and this is where the Action goes.** After the ward, because an
    // attacker the ward turned away has lost the attack and paid nothing for
    // it — the owner's ruling of 2026-09-22, which this casting must not
    // quietly overturn by spending the caster's Action on a swing that never
    // happened. Before the roll, because the spell is what makes the roll:
    // `spell-cast` stands ahead of it in the log, which is the order the book
    // prints and the order a reader needs.
    if (castWithIt !== null) {
      const cast = castWithTheSwing(state, id, castWithIt);
      if (!cast.ok) return cast;
      events.push(...cast.value);
    }

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
    // SRD Light: "**one** extra attack", and SRD Nick says the same of its own
    // substitution in as many words. The allowance is spent on the swing
    // rather than on the landing, exactly as Cleave's is, and under the same
    // ledger: one Bonus Action a turn would already stop the second of one
    // kind, and nothing would stop a Nick followed by a Bonus Action.
    if (lightExtra !== undefined && state.combat !== null) {
      events.push({
        type: 'feature-used',
        id,
        feature: LIGHT_EXTRA_ATTACK,
        turn: state.combat.turnsTaken,
      });
    }
    if (
      !free &&
      bonusActionSwing &&
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
      !bonusActionSwing &&
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
      events.push({
        type: 'attack-made',
        id,
        ...(unarmedStrike ? { unarmed: true } : {}),
        // SRD Light, recorded where the Attack action is paid for: the budget
        // is what the extra attack reads, and only this command knew which
        // weapon the swing used. Never the extra attack's own weapon — that
        // swing is above this branch and spends nothing here.
        ...(command.weapon !== null && weapon?.properties.includes('light') === true
          ? { light: command.weapon }
          : {}),
      });
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
    //
    // `issuedBefore` was taken above the ward, because the ward throws a d20
    // of its own and every one of them has to be counted.

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
      // SRD True Strike: "The attack uses your spellcasting ability for the
      // attack and damage rolls **instead of** using Strength or Dexterity."
      // Imposed rather than offered, so it is answered here and not weighed
      // against the weapon's own — see `AttackOptions.imposedAbility`.
      ...(castWithIt === null ? {} : { imposedAbility: castWithIt.ability }),
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
      ...(castWithIt === null ? {} : { imposedAbility: castWithIt.ability }),
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
      // The face this roll replaced, where a rule threw the die again — the
      // same field `recordD20Test` writes for a check or a save, written here
      // because this event is built by hand. See `roll-recorded.supersedes`.
      ...(attack.value.roll.superseded === undefined
        ? {}
        : {
            supersedes: {
              natural: attack.value.roll.superseded.natural,
              total: attack.value.roll.superseded.total,
            },
          }),
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
      rollerSees: canSee(state, id, command.target),
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
    //
    // **Once, where the swing was cast with a cantrip.** The casting above
    // ends the same hiding by the same builder — "or you cast a spell" is the
    // other clause of the same sentence — and both read the world as it stood
    // before either, so asking again here would write the removal twice.
    events.push(...(castWithIt === null ? hidingEndedBy(state, id) : []));

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

    // — what the defender's passive defences do to a blow that landed ————
    //
    // SRD Mirror Image: "Each time a creature **hits** you with an attack roll
    // ... roll a d6 for each of your remaining duplicates." SRD Fire Shield:
    // "whenever a creature within 5 feet of you **hits** you with a melee
    // attack roll, the shield erupts with flame." The hit is known and the
    // damage is not rolled, which is this line and no other.
    //
    // **Before the hold, and that ordering is the rule.** A blow a duplicate
    // took is not a blow that hit *you*, and SRD Shield is cast "when you are
    // hit by an attack roll" — so a deflected hit must build no
    // `attack-landed`, offer nobody anything and carry no rider. That is not a
    // window being closed: it is the hit that would have opened one never
    // having happened. Every other swing reaches the hold exactly as it did.
    const answered = answerTheBlow(events.reduce(applyEvent, state), id, command.target, supply, {
      // A printed line says which of the two it is and has no weapon behind
      // it; a weapon with no range is melee. The same question the damage
      // gatherer below asks, asked once and the same way.
      melee: stated === undefined ? rangeOf(weapon, command.thrown === true) === null : !stated.ranged,
    });
    if (!answered.ok) return answered;
    unverified.push(...answered.value.unverified);
    events.push(...answered.value.events);

    if (answered.value.deflected) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      return ok({
        events,
        attack: attack.value,
        deflected: true,
        unverified,
        duplicate: false,
      });
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
    // **What the block's own line says about the damage**, now that the roll
    // it is gated on has been made. SRD Goblin Warrior's extra die and SRD
    // Swarm of Rats' lesser one, read at the moment both gates can be asked.
    const printedDamage = printedDamageOnASwing(
      state,
      id,
      command.target,
      printed,
      attack.value.roll.mode,
    );
    // A charge gating a damage clause and nothing else — SRD Goat, SRD Giant
    // Seahorse — owes the table the same sentence a charge gating a condition
    // owes it, and this is the only channel it has.
    unverified.push(...printedDamage.unverified);

    // The type a casting's offer puts on the weapon's own damage, named on
    // this swing rather than pinned at the casting — see `weaponRiderDamageType`.
    const imbuedType = weaponRiderDamageType(state, id, weapon, command.featureDamageTypes);

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

    const savage = standingWeaponRollRule(state, id, {
      weapon,
      ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
      turn: state.combat?.turnsTaken ?? null,
    });
    const withoutModifier =
      cleaving !== undefined ||
      (lightExtra !== undefined && !addsAbilityToLightExtraAttack(state, id));

    const rolled = rollAttackDamage(
      supply.issuer,
      supply.rng,
      sheet,
      {
        weapon,
        // The line's printed damage, or the damage its own rider says it
        // rolls instead — a Bloodied swarm bites for less rather than for
        // more, so this replaces rather than adds.
        ...(stated === undefined
          ? {}
          : {
              statedAttack:
                printedDamage.instead === null
                  ? stated
                  : { ...stated, damage: printedDamage.instead },
            }),
        ...(castWithIt === null ? {} : { imposedAbility: castWithIt.ability }),
        ...(style === null ? {} : { strikeStyle: inPlay(style) }),
        // "it can be Force damage or the weapon's normal damage type (your
        // choice)": the offer a casting hung on this weapon, answered on this
        // swing. Absent leaves the weapon's printed type alone.
        //
        // The cantrip cast **with** this swing makes the same offer in the
        // same words and it is answered in its own request, so it lands in the
        // same field: one type or the other, whichever of the two offered it.
        // Never both — a swing that answered two offers was refused at the
        // door, so at most one of these is set.
        ...(castWithIt?.damageType != null
          ? { weaponDamageType: castWithIt.damageType }
          : imbuedType === null
            ? {}
            : { weaponDamageType: imbuedType }),
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
        extraDamage: [
          ...fromFeatures.extra,
          ...printedDamage.extra,
          // The Cantrip Upgrade's own dice: a component of its own type, so
          // it meets the target's defences separately and a Critical Hit
          // doubles it — "the attack deals extra Radiant damage", which is
          // extra damage on this attack and not a bigger weapon die.
          ...(castWithIt?.extra === undefined ? [] : [castWithIt.extra]),
          ...(command.extraDamage ?? []),
        ],
        // SRD Great Weapon Fighting: "you can treat any 1 or 2 on a damage die
        // as a 3." A rule the swing is read under rather than a number added
        // to it, gathered from the attacker's own standing effects and
        // narrowed by the weapon in hand — see `standingDamageEffects`.
        damageEffects: standingDamageEffects(state, id, {
          weapon,
          ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
        }),
        // SRD Savage Attacker: "once per turn when you hit a target with a
        // weapon, you can roll the weapon's damage dice twice and use either
        // roll." The other scope a rule about a hit can have — the weapon's
        // own roll rather than every die the swing throws — gathered beside
        // the line above and spent below.
        ...(savage.rule === null ? {} : { weaponRollRule: savage.rule }),
        // SRD Cleave: "don't add your ability modifier to that damage unless
        // that modifier is negative." SRD Light prints the same sentence about
        // its extra attack, word for word, which is why one flag answers both
        // — and SRD Two-Weapon Fighting is the one thing that puts the
        // modifier back, read off the attacker's standing effects like every
        // other rule a swing is made under.
        ...(withoutModifier ? { withoutAbilityModifier: true as const } : {}),
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
    for (const feature of [...fromFeatures.spent, ...savage.spent]) {
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
        // The blow's own total after this creature's defences, for the one
        // clause that reads it: SRD Specter's "an amount equal to the damage
        // taken". Zero where the hit dealt none, which lowers nothing.
        { attacker: id, target: command.target, dealt: hurt.value.amount ?? 0 },
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
   * window. Validated and paid for as a casting, because it is one: with the
   * slot named, or — SRD Paladin's Smite — as the free casting a feature
   * grants, out of that feature's pool. One or the other, and the engine will
   * not pick.
   */
  readonly smite?: {
    readonly spellId: string;
    readonly slotLevel?: number;
    readonly payment?: 'free-casting';
  };
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
    const legalTypes = checkFeatureDamageTypes(current, id, command.featureDamageTypes, weapon);
    if (!legalTypes.ok) return legalTypes;

    // The same two questions the unheld swing asks, off the facts the hold
    // wrote down: the mode the attack roll was made under, and the Hit Points
    // as they stand now rather than as they stood when the blow landed.
    const printedDamage = printedDamageOnASwing(
      current,
      id,
      pending.target,
      printed,
      pending.mode ?? 'normal',
    );

    const heldImbuedType = weaponRiderDamageType(current, id, weapon, command.featureDamageTypes);

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

    const savage = standingWeaponRollRule(current, id, {
      weapon,
      twoHanded: pending.twoHanded,
      turn: current.combat?.turnsTaken ?? null,
    });

    const issuedBefore = supply.issuer.count;
    const rolled = rollAttackDamage(
      supply.issuer,
      supply.rng,
      sheet,
      {
        weapon,
        // What a printed line's damage is rolled from — the same field the
        // unheld swing hands `rollAttackDamage`, off the same line, and the
        // same substitution where the line's own rider makes one.
        ...(stated === undefined
          ? {}
          : {
              statedAttack:
                printedDamage.instead === null
                  ? stated
                  : { ...stated, damage: printedDamage.instead },
            }),
        // Re-derived rather than pinned on the held attack, for the reason the
        // sheet above is re-read: the style's own gate is "while you aren't
        // wearing armor", so a Monk who put a breastplate on between the roll
        // and the blow rolls the blow without it. Nothing new is written to
        // `attack-landed` for it, and a log from before this existed resolves
        // exactly as it did.
        ...(heldStyle === null ? {} : { strikeStyle: inPlay(heldStyle) }),
        // The same offer, answered on the far side of the hold: the choice
        // belongs to the moment the damage is rolled, which for a held attack
        // is here. See `AttackDamageCommand.featureDamageTypes`.
        ...(heldImbuedType === null ? {} : { weaponDamageType: heldImbuedType }),
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
        extraDamage: [...fromFeatures.extra, ...printedDamage.extra, ...extra],
        // Re-derived like the style above and from the same swing: a rule
        // about the dice is a standing effect, and a standing effect is read
        // afresh at the moment it bites.
        damageEffects: standingDamageEffects(current, id, {
          weapon,
          twoHanded: pending.twoHanded,
        }),
        // And the rule about the roll as a whole, off the same swing. Gathered
        // here rather than pinned on the hold for the reason the line above it
        // is: the hold remembers what was swung, and what a feature says about
        // the swing is read when the dice are thrown.
        ...(savage.rule === null ? {} : { weaponRollRule: savage.rule }),
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
    for (const feature of [...fromFeatures.spent, ...savage.spent]) {
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
    // The charge's own sentence, on the half of a held swing that rolls the
    // damage — see the unheld path's copy of this line.
    const unverified: string[] = [...printedDamage.unverified];
    if (pending.rider !== undefined && hurt.value.offers.length === 0) {
      const paid = applyHitRider(
        [...landed, ...rider.value.events].reduce(applyEvent, state),
        supply,
        { attacker: pending.attacker, target: pending.target, dealt: hurt.value.amount ?? 0 },
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
 * What a smite with a **duration** leaves running behind the blow.
 *
 * SRD Searing Smite prints "Duration: 1 minute" and a minute of burning; SRD
 * Divine Smite prints "Instantaneous" and nothing at all. So this is two
 * events where the spell prints a span and none where it does not, and the
 * second half is as load-bearing as the first: a record for an Instantaneous
 * casting would be a spell with nothing able to end it.
 *
 * - **The record**, so Dispel Magic can find the spell and `look` can report
 *   it. Everything on it is pinned at the cast, which is rule 5: the level,
 *   the caster's numbers, and the creature it is on.
 * - **The deadline**, which is the minute — and which carries the repeat save
 *   where the effect prints one. The save's DC and ability are pinned here
 *   too, and so is the amount it burns for, scaled at the slot that paid:
 *   the boundary that collects it opens no catalogue.
 *
 * The ability on a casting-hosted repeat is the definition's own, which is the
 * one place the SRD prints it — the host rolled no save for this one to
 * repeat. See {@link SpellRepeatSave.ability}.
 */
function keptRunning(
  state: GameState,
  id: CharacterId,
  casting: {
    readonly definition: SpellDefinition;
    readonly effect: Extract<SpellEffect, { kind: 'attack-damage' }>;
    readonly route: CastingRoute;
    readonly target: CharacterId;
    readonly castLevel: number;
    readonly lasts: number | undefined;
    readonly events: readonly GameEvent[];
  },
): Result<readonly GameEvent[]> {
  const { definition, effect, castLevel, lasts } = casting;
  if (lasts === undefined) return ok([]);

  // The id the casting beneath has just allocated, read off the event that
  // allocated it rather than counted again here: two derivations of one number
  // is how a record comes to name a casting nobody made.
  const cast = casting.events.find((event) => event.type === 'spell-cast');
  if (cast?.type !== 'spell-cast') {
    return err(
      'no_casting',
      `${definition.name} lasts ${lasts} seconds and the casting wrote nothing for it to hang on`,
    );
  }
  const castingId = cast.castingId;

  // The sheet as it stands, for the reason the damage roll re-reads it: a save
  // DC is derived from the caster's numbers and an item that sets the ability
  // those come from is worn or it is not at the moment the spell is cast.
  const sheet = sheetAsItStands(state, id) ?? state.creatures[id]?.sheet;
  if (sheet === undefined) return unknownCreature(id);

  const repeats = effect.repeats;
  const numbers = numbersFor(state, id, sheet, casting.route);

  // What the boundary burns for, at the slot this casting paid — the same two
  // readers the hit's own amount goes through, so "all the damage increases by
  // 1d6 for each spell slot level above 1" is one arithmetic read twice rather
  // than two arithmetics.
  const burns = repeats?.beforeTheSave;
  const burntDice =
    burns === undefined
      ? undefined
      : scaledDiceFor(burns.damage, definition.level, sheet.level, castLevel);
  const burntFlat =
    burns === undefined ? 0 : scaledFlatFor(burns.damage, definition.level, castLevel);
  const payout =
    burns === undefined
      ? undefined
      : {
          ...(burntDice === undefined ? {} : { dice: burntDice }),
          ...(burntFlat === 0 ? {} : { flat: burntFlat }),
          damageType: burns.damageType,
        };

  const hook: RepeatSave | undefined =
    repeats === undefined || repeats.ability === undefined
      ? undefined
      : {
          at: repeats.at,
          // The creature the blow landed on: the SRD sentence names it twice,
          // as the one whose turns the save falls on and as the one who rolls.
          of: casting.target,
          ability: repeats.ability,
          dc: numbers.saveDc,
          onSuccess: repeats.onSuccess,
          ...(repeats.onFailure === undefined ? {} : { onFailure: repeats.onFailure }),
          ...(payout === undefined ? {} : { beforeTheSave: payout }),
          label: `${definition.name} (${repeats.ability.toUpperCase()} save)`,
        };

  const timer = schedule(
    state,
    { kind: 'casting', castingId },
    { kind: 'seconds', seconds: lasts },
    hook,
  );
  if (!timer.ok) return timer;

  return ok([
    {
      type: 'spell-ongoing',
      casting: {
        version: ONGOING_RECORD_VERSION,
        castingId,
        caster: id,
        spellId: definition.id,
        spell: definition.name,
        level: castLevel,
        numbers,
        // The creature the spell is on, which is the one the blow landed on.
        // A world fact cannot say it — nothing the casting hung is standing on
        // them — so it is written down, which is what `aimed` is for.
        aimed: [casting.target],
      },
    },
    timer.value,
  ]);
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
  smite: {
    readonly spellId: string;
    readonly slotLevel?: number;
    readonly payment?: 'free-casting';
  },
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
  //
  // SRD Paladin's Smite: "You can cast it without expending a spell slot, but
  // you must finish a Long Rest before you can cast it in this way again." The
  // free casting is a granted route with a pool, refused with the pool empty
  // and nothing charged; a slot is the class's own route. Named, never picked.
  let route: CastingRoute;
  let freePool: string | null = null;
  if (smite.payment === 'free-casting') {
    const grant = attacker.spellcasting.granted.find(
      (one) => one.spellId === smite.spellId && one.freeCastPool !== null,
    );
    if (grant === undefined || grant.freeCastPool === null) {
      return err('no_free_casting', `${id} has no free casting of ${definition.name}`);
    }
    if (remaining(attacker.resources, grant.freeCastPool) < 1) {
      return err(
        'no_free_casting',
        `${id} has used the free casting of ${definition.name} and must spend a slot`,
      );
    }
    route = { kind: 'granted', ability: grant.ability, grant };
    freePool = grant.freeCastPool;
  } else {
    if (smite.slotLevel === undefined) {
      return err(
        'no_slot_named',
        `${definition.name} is cast on a hit with a slot, or as a feature's free casting; name which`,
      );
    }
    const chosen = chooseRoute(attacker.spellcasting, smite.spellId, undefined);
    if (!chosen.ok) return chosen;
    route = chosen.value;
  }
  // The level the dice scale at: the slot's, or the spell's own for a free
  // casting, which SRD Magic Initiate's rule already fixes.
  const castLevel = smite.slotLevel ?? definition.level;

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
  // **What the spell leaves running, where it leaves anything.** SRD Divine
  // Smite is Instantaneous and the damage is the whole of it; SRD Searing
  // Smite prints a minute, and a minute is a casting that keeps going after
  // the blow — a record Dispel Magic can find and a deadline to end it.
  //
  // The band the slot falls in rather than the printed number, through the one
  // reader every other duration goes through.
  const lasts = durationSecondsAt(definition, castLevel);

  const cast = resolveCastWith(state, id, {
    spell: definition.name,
    level: definition.level,
    concentration: definition.concentration,
    castingTime: definition.castingTime,
    ...(freePool === null ? { slotLevel: castLevel } : { slotless: 'special-ability' as const }),
    route: routeLabel(route),
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
    castLevel,
  );
  const flat = scaledFlatFor(effect.damage, definition.level, castLevel);

  // **And what a spell with a duration leaves standing.** The record and the
  // deadline are written here rather than by the casting beneath, because the
  // hook the deadline carries is this effect's and the low-level half has
  // never read a definition. One site writes the timer for that reason: a
  // duration passed down would schedule the same key without the hook, and
  // two writers of one timer is the second place to get it wrong.
  const keeps = keptRunning(state, id, {
    definition,
    effect,
    route,
    target,
    castLevel,
    lasts,
    events: cast.value,
  });
  if (!keeps.ok) return keeps;

  return ok({
    // The use, where the free casting is the price: inside the settlement's
    // own batch, after every refusal and before the dice, as a slot's is.
    events: [
      ...(freePool === null ? [] : [{ type: 'resource-spent' as const, id, key: freePool, amount: 1 }]),
      ...cast.value,
      ...keeps.value,
    ],
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

