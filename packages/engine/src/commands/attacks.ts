/**
 * Weapon attacks, and the window between the roll and the damage.
 *
 * The attack is two commands rather than one because SRD Divine Smite lands
 * between them: `resolveAttack` rolls to hit and may hold the result, and
 * `resolveAttackDamage` settles it.
 */

import { type CharacterId, err, needsContext, ok, type Result, type RollMode } from '@ie/shared';
import { type Weapon } from '@ie/srd';
import {
  type AttackResult,
  type ExtraDamage,
  meleeReach,
  proficientWith,
  rangeOf,
  rollAttack,
  rollAttackDamage,
} from '../attack.js';
import { type Bonus, bonusesFor, flatBonusTotal, type ModeSource } from '../bonuses.js';
import { type Content } from '../content.js';
import { spendAttack } from '../combat.js';
import { isIncapacitated } from '../conditions.js';
import { applyEvent, type CreatureState, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  canBeTargeted,
  coverAcBonus,
  coverBetween,
  distanceBetween,
  positionOf,
} from '../positioning.js';
import { type ReactionOffer } from '../reactions.js';
import { isCreatureType, scaledDiceFor } from '../spell-definitions.js';
import {
  armorClassOf,
  checkFeatureDamageTypes,
  effectiveConditions,
  standingAttackDamage,
  standingBonuses,
} from '../standing.js';
import {
  chooseRoute,
  type ConcentrationConsequence,
  type Supply,
  resolveCastWith,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { landDamage } from './damage.js';
import { mayAct } from './holds.js';
import { quantityOf } from './inventory.js';
import { defendingModes } from './rolls.js';

export interface AttackCommand extends CommandIdentity {
  readonly target: CharacterId;
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon: string | null;
  /** Wielded in two hands, for a Versatile weapon. */
  readonly twoHanded?: boolean;
  /** Thrown rather than swung, for a Thrown weapon. */
  readonly thrown?: boolean;
  /** Which ability to use on a Finesse weapon. Defaults to the better one. */
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
    // Not a claim that no such creature exists. A DM who has just narrated a
    // second ogre out of the treeline has a real ogre; the engine has simply not
    // been told about it, and being told is all this refusal asks for.
    const victim = creatureOf(state, command.target);
    if (victim === null) {
      return unknownCreature(command.target, 'has no record here yet; add it first');
    }
    if (attacker.vitals.dead) return err('dead', `${id} is dead and swings at nothing`);

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

    // — can it even reach ——————————————————————————————————————————————————
    const reach = reachCheck(state, id, command.target, weapon, command.thrown === true);
    if (!reach.ok) return reach;

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

    // — the action it costs —————————————————————————————————————————————————
    //
    // SRD: an attack with a weapon is the Attack action. Outside combat there is
    // no economy to spend, exactly as `resolveCast` finds.
    const events: GameEvent[] = [];
    if (command.free !== true && state.combat !== null && state.combat.budgets[id] !== undefined) {
      // SRD Extra Attack: the action is taken once and holds however many
      // attacks a feature puts in it, so only the first swing costs one.
      const spent = spendAttack(
        state.combat,
        id,
        attacker.sheet.attacksPerAction ?? 1,
        attacker.conditions,
      );
      if (!spent.ok) return spent;
      events.push({ type: 'attack-made', id });
    }

    // — the roll ———————————————————————————————————————————————————————————
    const issuedBefore = supply.issuer.count;

    // Absent, not false: see `TargetContext.withinFiveFeet`.
    const withinFiveFeet = reach.value.apart === null ? undefined : reach.value.apart <= 5;
    const unverified: string[] = [];
    if (reach.value.apart === null) {
      unverified.push(
        `nobody has said where ${id} and ${command.target} are standing, so any rule that reads the distance between them — Prone, an automatic critical, an enemy within 5 feet — went unapplied rather than checked`,
      );
    }

    // SRD: a ranged attack has Disadvantage while an enemy is within 5 feet.
    const nearby = enemyWithinFiveFeet(state, id);
    unverified.push(...nearby.unverified);

    // SRD Dodge, Blur, and anything else standing that reaches this roll —
    // whether it sits on the attacker or on the creature being attacked. One
    // gatherer, shared with the spell attack, which is what stops the two
    // paths drifting apart again.
    const defending = defendingModes(state, id, command.target);
    unverified.push(...defending.unverified);

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

    const attack = rollAttack(supply.issuer, supply.rng, attacker.sheet, {
      weapon,
      targetAc: armorClassOf(state, command.target) + coverAcBonus(cover),
      proficient: proficientWith(attacker.sheet, weapon),
      // SRD Improved Critical, off the attacker's own sheet rather than the
      // caller's hand: a Champion's 19 is a critical whoever is narrating.
      ...(attacker.sheet.criticalOn === undefined
        ? {}
        : { criticalOn: attacker.sheet.criticalOn }),
      ...(command.twoHanded === undefined ? {} : { twoHanded: command.twoHanded }),
      ...(command.thrown === undefined ? {} : { thrown: command.thrown }),
      ...(command.finesseAbility === undefined ? {} : { finesseAbility: command.finesseAbility }),
      modes: [...defending.modes, ...(command.modes ?? [])],
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
    });
    if (!attack.ok) return attack;

    const namedFlat = attackBonuses.filter((bonus) => (bonus.flat ?? 0) !== 0);

    events.push({
      type: 'roll-recorded',
      who: id,
      label: `${weapon?.name ?? 'Unarmed Strike'} attack`,
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

    if (!attack.value.hit) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      return ok({ events, attack: attack.value, unverified, duplicate: false });
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
          ability: attack.value.ability,
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
      ability: attack.value.ability,
      melee: rangeOf(weapon, command.thrown === true) === null,
      weapon,
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
      attacker.sheet,
      {
        weapon,
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
      weapon?.name ?? 'Unarmed Strike',
      supply,
      { by: id, fromAttack: true, ...(attack.value.critical ? { critical: true } : {}) },
    );
    if (!hurt.ok) return hurt;

    return ok({
      events: [...events, ...hurt.value.events],
      attack: attack.value,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...unverified, ...hurt.value.unverified],
      duplicate: false,
    });
  });
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
  weapon: Weapon | null,
  thrown: boolean,
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
      `nobody has said where ${off.join(' or ')} ${off.length === 1 ? 'is' : 'are'} standing, and whether ${weapon?.name ?? 'an Unarmed Strike'} reaches depends on it`,
      off.map((who) => ({
        kind: 'position' as const,
        subject: who,
        need: `where ${who} is standing`,
        because: `${weapon?.name ?? 'an Unarmed Strike'} has a reach to check`,
        satisfyWith: `a placeCreatureInScene command for ${who}`,
      })),
    );
  }
  const apart = measured.value;

  const range = rangeOf(weapon, thrown);
  if (range === null) {
    const reach = meleeReach(weapon);
    if (apart > reach) {
      return err(
        'out_of_reach',
        `${weapon?.name ?? 'an Unarmed Strike'} reaches ${reach} feet; ${target} is ${apart} away`,
      );
    }
    return ok({ apart, beyondNormal: false });
  }

  if (apart > range.long) {
    return err('out_of_range', `${weapon?.name ?? 'this attack'} carries ${range.long} feet; ${target} is ${apart} away`);
  }
  return ok({ apart, beyondNormal: apart > range.normal });
}

/**
 * SRD: a ranged attack has Disadvantage while an enemy is within 5 feet of you.
 *
 * "Enemy" is the declared side, the same fact an aura reads for "ally". A
 * creature nobody has placed on a side is nobody's enemy either, so it hampers
 * nothing — the conservative direction, and the same one `standingFor` takes.
 */
function enemyWithinFiveFeet(
  state: GameState,
  id: CharacterId,
): { readonly near: boolean; readonly unverified: readonly string[] } {
  const scene = state.scene;
  const mine = state.creatures[id]?.side ?? null;
  if (scene === null) return { near: false, unverified: [] };

  let near = false;
  const unsided: CharacterId[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === id) continue;
    // SRD says an enemy "that can see you and isn't Incapacitated"; sight is
    // declared and often unsaid, so only the half the engine can see is applied
    // and the other half is left to the caller's modes.
    if (isIncapacitated(other.conditions) || other.vitals.dead) continue;

    const apart = distanceBetween(scene, id, other.id);
    if (!apart.ok || apart.value > 5) continue;

    // Declared and allied: the rule does not apply, and nothing is missing.
    if (mine !== null && other.side === mine) continue;
    // Declared and opposed: the rule applies.
    if (mine !== null && other.side !== null) {
      near = true;
      continue;
    }
    // Nobody has said. Withholding is the conservative direction and it was
    // also **silent** — a creature standing at the archer's elbow either is or
    // is not an enemy, and an unfired rule looks exactly like a rule that
    // checked and found nothing.
    unsided.push(other.id);
  }

  return {
    near,
    unverified:
      unsided.length === 0
        ? []
        : [
            `nobody has said whose side ${unsided.join(', ')} ${unsided.length === 1 ? 'is' : 'are'} on, so the Disadvantage a ranged attack takes with an enemy within 5 feet was not applied`,
          ],
  };
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

    const weapon = pending.weapon === null ? null : (supply.content.item(pending.weapon)?.weapon ?? null);
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
      attacker.sheet,
      {
        weapon,
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

    return ok({
      events: [...events, ...hurt.value.events],
      attack: null,
      ...(hurt.value.amount === undefined ? {} : { damage: hurt.value.amount }),
      ...(hurt.value.concentration === undefined
        ? {}
        : { concentration: hurt.value.concentration }),
      ...(hurt.value.offers.length === 0 ? {} : { reactions: hurt.value.offers }),
      unverified: [...hurt.value.unverified],
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
    route: route.value.kind === 'granted' ? route.value.grant.source : `class:${route.value.classId}`,
  }, null);
  if (!cast.ok) return cast;

  // A second component rather than a bigger notation: the SRD writes two
  // sentences, so the log shows two contributions and says *why* the second
  // one is there. Same damage type, so they meet the target's defences as one
  // pool, and a Critical Hit doubles both.
  const singled =
    varies !== undefined &&
    varies.types.some((named) => isCreatureType(victim?.creatureType, named));

  return ok({
    events: cast.value,
    damage: [
      {
        source: definition.name,
        type: effect.damageType,
        dice: scaledDiceFor(effect.damage, definition.level, attacker.sheet.level, smite.slotLevel),
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

