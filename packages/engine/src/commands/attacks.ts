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
import { canUseFeatureThisTurn, spendAttack, spendBonusAction } from '../combat.js';
import { applyEvent, type CreatureState, type GameEvent, type GameState } from '../events.js';
import { modifierFor, type CharacterSheet, type StatedAttack } from '../character.js';
import { hasPrintedTrait, printedAttackOf } from '../monster.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  distanceBetween,
  positionOf,
} from '../positioning.js';
import { type ReactionOffer } from '../reactions.js';
import { isCreatureType, scaledDiceFor, scaledFlatFor } from '../spell-definitions.js';
import {
  armorClassOf,
  checkFeatureDamageTypes,
  effectiveConditions,
  sheetAsItStands,
  standingAttackDamage,
  standingBonuses,
  strikeStyleFor,
  type StrikeStyle,
} from '../standing.js';
import {
  chooseRoute,
  type ConcentrationConsequence,
  type Supply,
  resolveCastWith,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { routeLabel } from './item-casting.js';
import { landDamage } from './damage.js';
import {
  CLEAVE_REACH,
  masteryAfterHit,
  masteryArgumentProblem,
  type MasteryHit,
  type MasteryOutcome,
} from './mastery.js';
import { mayAct } from './holds.js';
import { quantityOf } from './inventory.js';
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
const CLEAVE = 'weapon-mastery:cleave';

/**
 * Everything wrong with a swing that names an attack its creature prints, or
 * null.
 *
 * All three refusals are answerable before anything is spent, which is where
 * this is asked from — a swing refused after the Attack action is gone is a
 * refusal with a footprint.
 */
function printedAttackProblem(sheet: CharacterSheet, command: AttackCommand): Err | null {
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

  // **SRD Divine Smite's window has nothing to hold here.** `attack-landed`
  // pins what a held attack needs to roll its damage a command later, and what
  // it pins is a weapon's catalogue id — there is nowhere in it for a printed
  // line, and a hit whose damage could never be rolled is worse than a
  // refusal. Nothing in the bestiary asks for the window.
  if (command.hold === true) {
    return err(
      'cannot_hold',
      `${printed.name} is an attack this creature's block prints, and its damage cannot be held for a second command`,
    );
  }

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
    const printedProblem = printedAttackProblem(sheet, command);
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
        rules: attacker.actionRules,
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
        sheet.attacksPerAction ?? 1,
        attacker.conditions,
        { rules: attacker.actionRules },
      );
      if (!spent.ok) return spent;
      events.push({ type: 'attack-made', id });
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
    const attackBonuses: readonly Bonus[] = [
      ...standingBonuses(state, id, 'attack', { withItem: command.weapon }),
      // Bless is on the creature, not in the caller's head.
      ...bonusesFor(attacker.bonuses, 'attack'),
      ...(command.attackBonuses ?? []),
    ];

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
      attackerConditions: effectiveConditions(state, id),
      targetConditions: effectiveConditions(state, command.target),
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
      // Stamped on the roll rather than on the damage, because a miss deals none
      // and a missed swing must not be retryable.
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **Beside the roll, and before the miss returns.** SRD Vicious Mockery
    // says "the next attack roll it makes" and Guiding Bolt "the next attack
    // roll made against it"; neither says "the next one that hits", and a
    // grant spent only by a hit would give a fumbling attacker several bites
    // at one sentence. The same query `defendingModes` asked above, so what is
    // spent is exactly what was read.
    for (const spent of consumedRollModifiers(state, {
      family: 'attack',
      roller: id,
      against: command.target,
      ability,
    })) {
      events.push({ type: 'roll-modifier-consumed', id: spent.holder, source: spent.source });
    }

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

    // **What the block says a hit does that the engine does not.** The Wolf's
    // "If the target is a Medium or smaller creature, it has the Prone
    // condition", the Ghoul's Constitution save at DC 10, and every other
    // clause the parser deliberately left as prose. Reported the moment the
    // hit is known, in the channel a caller already reads for rules that went
    // unapplied — a printed rider silently dropped is a creature made weaker
    // than the book, which is the failure the honest half of the shape exists
    // to prevent.
    if (printed?.rider != null) {
      unverified.push(
        `${attackName} hit ${command.target}, and its line reads "${printed.rider}" — the engine does not apply that; a DM does`,
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
          ...standingBonuses(state, id, 'damage', { withItem: command.weapon }),
          ...fromFeatures.bonuses,
          ...(command.damageBonuses ?? []),
        ],
        extraDamage: [...fromFeatures.extra, ...(command.extraDamage ?? [])],
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
      { by: id, fromAttack: true, ...(attack.value.critical ? { critical: true } : {}) },
    );
    if (!hurt.ok) return hurt;

    const landed = [...events, ...hurt.value.events];
    const rider = masteryRider(landed.reduce(applyEvent, state), supply, {
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
    if (!rider.ok) return rider;

    return ok({
      events: [...landed, ...rider.value.events],
      attack: attack.value,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...unverified, ...hurt.value.unverified, ...rider.value.unverified],
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
      melee: rangeOf(weapon, pending.thrown) === null,
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
          // The weapon the hit was made with was written down when it landed.
          ...standingBonuses(current, id, 'damage', { withItem: pending.weapon }),
          ...fromFeatures.bonuses,
          ...(command.damageBonuses ?? []),
        ],
        extraDamage: [...fromFeatures.extra, ...extra],
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
      weapon?.name ?? 'Unarmed Strike',
      supply,
      { by: pending.attacker, fromAttack: true, ...(pending.critical ? { critical: true } : {}) },
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

    return ok({
      events: [...landed, ...rider.value.events],
      attack: null,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...hurt.value.unverified, ...rider.value.unverified],
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

