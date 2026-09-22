/**
 * The seven effect kinds that hang a **sourced grant** on a creature.
 *
 * One module per the enumerator that already names the family: `grantsOf` in
 * `fold/release.ts` walks `bonuses`, `armorClasses`, `rollModifiers`,
 * `grantedDefenses`, `speedModifiers`, `attackRiders` and
 * `grantedConditionImmunities`, and these are the seven resolvers that write
 * them. The two lists are kept the same shape on purpose — an eighth family
 * joining the enumerator is an eighth resolver joining this file, and a grant
 * released by a dispel and not by a deadline is the failure that enumerator was
 * built to stop.
 *
 * They are also, bar the first, the kinds that hand something out without
 * rolling for it: the docstrings below count them off in the order they
 * arrived.
 */

import { ABILITY_NAMES, type CharacterId, ok, type Result } from '@ie/shared';
import { type D20TestResult, rollSavingThrow } from '../checks.js';
import { applyEvent, type CreatureState, type GameState } from '../events.js';
import { armorClassOf, sheetAsItStands, speedOf } from '../standing.js';
import { alteredRiderDice, recordD20Test, savingSupport } from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * A named bonus later rolls will read. Bane saves first; Bless does not.
 */
export function resolveBuffEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'buff'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { name, source, supply, events, outcomes, held, saveDc } = ctx;
  let current = world;

  let save: D20TestResult | null = null;
  if (effect.ability !== undefined) {
    const support = savingSupport(current, target, victim, effect.ability, supply);
    // The victim's sheet as it stands: an item that *sets* the score this save
    // is made with is on the creature, and `checks.ts` takes a sheet. Asked of
    // `current` because that is the world every other reader in this function
    // is asked of — `savingSupport` above it and `armorClassOf` in its
    // neighbours — and not because anything has moved it yet.
    const rolled = rollSavingThrow(
      supply.issuer,
      supply.rng,
      sheetAsItStands(current, target) ?? victim.sheet,
      effect.ability,
      {
        dc: saveDc,
        conditions: support.conditions,
        modes: support.modes,
        bonuses: support.bonuses,
      },
    );
    if (!rolled.ok) return rolled;
    save = rolled.value;

    events.push(
      recordD20Test(
        target,
        `${ABILITY_NAMES[effect.ability]} save vs ${name}`,
        save,
        save.success ? 'resisted' : 'affected',
      ),
    );

    if (save.success) {
      outcomes.push({ target, save, affected: false });
      return ok(current);
    }
  }

  // The casting is in the source, so ending the spell ends the bonus.
  held.add(target);
  events.push({
    type: 'bonus-applied',
    id: target,
    bonus: {
      source,
      bonus: { ...effect.bonus, source: name },
      applies: effect.applies,
      direction: effect.direction,
      // Pinned, like every other number on a casting: the narrowing carried
      // here is the one the *casting* ended up with, which for a spell that
      // chose a skill at the cast is not the one the definition prints.
      ...(effect.only === undefined ? {} : { only: effect.only }),
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({
    target,
    ...(save === null ? {} : { save }),
    affected: true,
  });
  return ok(current);
}

/**
 * Advantage or Disadvantage for as long as the spell runs. Bane's
 * shape when the spell offers a save, Bless's when it does not — the
 * same fork the bonus above takes, because it is the same sentence
 * shape with presence in place of arithmetic.
 */
export function resolveRollModeEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'roll-mode'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  let current = world;

  // **Nothing is resisted here**, and that is the effect rather than an
  // omission: Blur and Beacon of Hope ask nobody to save, and the
  // speculative `save` field that used to sit on this kind had no user
  // in the catalogue from the day it was written. A spell that *does*
  // make a roll first says so with a host, and hangs this as a
  // `modifiers` rider on the outcome — one roll, shared.
  //
  // The casting is in the source, so every door that ends the spell —
  // a broken Concentration, the minute running out, a dispel, the
  // caster leaving — ends this too, through machinery that already
  // existed rather than a lifecycle of its own.
  held.add(target);
  events.push({
    type: 'roll-modifier-granted',
    id: target,
    modifier: {
      source,
      modifier: effect.modifier,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A base Armour Class the spell supplies, in place of the one the
 * target would otherwise calculate. Nothing is rolled and nothing is
 * resisted: SRD Mage Armor asks for no save and touches a willing
 * creature.
 */
export function resolveArmorClassEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'armor-class'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'armor-class-granted',
    id: target,
    armorClass: {
      source,
      base: effect.base,
      plusAbility: effect.plusAbility,
      shieldAllowed: effect.shieldAllowed,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  // Reported after the grant, because the number is the comparison’s
  // answer rather than the definition’s: a Barbarian whose Unarmoured
  // Defense already beats 13 + Dexterity keeps their own calculation,
  // and the outcome should say what their Armour Class actually is.
  outcomes.push({ target, armorClass: armorClassOf(current, target), affected: true });
  return ok(current);
}

/**
 * Resistance, Immunity or Vulnerability, for as long as the spell runs.
 * SRD Stoneskin touches a willing creature and Protection from Energy
 * does the same, so nothing is rolled and nothing is resisted — the same
 * shape the Armour Class above takes, on the other half of what a
 * defence is.
 *
 * The casting is in the source, so `releaseCasting` ends it with the
 * spell; a `grants` timer is what could end it sooner, and no SRD spell
 * asks for one.
 */
export function resolveDamageDefenseEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'damage-defense'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'damage-defense-granted',
    id: target,
    defense: {
      source,
      damageTypes: effect.damageTypes,
      defense: effect.defense,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A Speed the spell changes, for as long as it runs. SRD Longstrider
 * touches a creature and asks nobody to save, so nothing is rolled and
 * nothing is resisted — the same shape the Armour Class and the
 * defence above take, on the third thing a spell hands out that is
 * not a roll.
 *
 * The casting is in the source, so `releaseCasting` ends it with the
 * spell; a `grants` timer is what could end it sooner, and the
 * standalone kind carries no deadline of its own because no SRD
 * sentence writes one without a roll to hang it on. A rider does —
 * see {@link applyRiders}.
 */
export function resolveSpeedEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'speed'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'speed-modifier-granted',
    id: target,
    modifier: {
      source,
      change: effect.change,
      ...(effect.feet === undefined ? {} : { feet: effect.feet }),
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  // Reported after the grant, because the number is what the creature's
  // Speed actually *is* — a Longstrider on a Grappled creature adds ten
  // feet to a Speed the rules have already pinned at 0, and the outcome
  // should say 0 rather than what the definition asked for.
  outcomes.push({ target, speed: speedOf(current, target), affected: true });
  return ok(current);
}

/**
 * What the spell changes about how its target may spend a turn.
 *
 * SRD Wind Walk, Antimagic Field and Conjure Woodland Beings all write this
 * sentence with nothing to roll, so this is the shape the Armour Class, the
 * defence and the Speed above already take, on the fifth thing a spell hands
 * out that is not a roll — and the ninth sourced grant.
 *
 * The casting is in the source, so `releaseCasting`, `releaseOnTarget`, a
 * dispel, a broken Concentration and the deadline all end it through the door
 * every other grant already uses; the standalone kind carries no deadline of
 * its own, because no SRD sentence writes one without a roll to hang it on.
 * A rider does — see `applyRiders`, and SRD Shocking Grasp.
 */
export function resolveActionRuleEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'action-rule'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held, name } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'action-rule-granted',
    id: target,
    // **Both strings pinned here**, because a refusal has to name what
    // forbade the action and until when, and `combat.ts` sits beneath
    // `GameState` and can reach neither the catalogue nor the timer.
    rule: { source, rule: effect.rule, label: name, until: 'the spell ends' },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * Extra damage on the **caster's** later attacks, for as long as the spell
 * runs. SRD Divine Favor: "Until the spell ends, your attacks with weapons
 * deal an extra 1d4 Radiant damage on a hit." Nothing is rolled here and
 * nothing is resisted — the die is thrown by each later attack — so this is
 * the shape `armor-class`, `damage-defense` and `speed` already take, on the
 * fourth thing a spell hands out that is not a roll.
 *
 * **The grant lands on the caster and never on the target**, which is the one
 * thing about this resolver that differs from its four neighbours. SRD
 * Hunter's Mark marks a quarry ninety feet away and the extra die is the
 * ranger's: `marksTarget` records *which* creature the rider is about, and the
 * rider itself is held by whoever swings. So the effect's own target decides
 * the mark, and `held` records the **caster**, because a casting is on a
 * creature while it has a live effect there that the casting owns and the
 * thing this casting owns is on the caster.
 *
 * The casting is in the source, so `releaseCasting` ends it with the spell —
 * a dispel, a broken Concentration, the deadline and the caster leaving all
 * converge on the door every other grant already uses.
 */
export function resolveAttackRiderEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'attack-rider'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, source, events, outcomes, held, alters } = ctx;

  // **SRD Foe Slayer, pinned here and nowhere else**: "The damage die of your
  // _Hunter's Mark_ is a d10 rather than a d6." The rider is the one notation a
  // casting writes down for later turns to roll, so the caster's feature has to
  // reach it *before* the event rather than at every attack that reads it back
  // — which is what lets a replay throw a d10 with no idea the feature exists.
  const dice = alteredRiderDice(alters, effect.dice);
  if (!dice.ok) return dice;

  held.add(casterId);
  events.push({
    type: 'attack-rider-granted',
    id: casterId,
    rider: {
      source,
      dice: dice.value,
      damageType: effect.damageType,
      ...(effect.weaponOnly === undefined ? {} : { weaponOnly: effect.weaponOnly }),
      ...(effect.marksTarget === undefined ? {} : { target }),
    },
  });
  const current = events.slice(-1).reduce(applyEvent, world);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * Condition Immunities the spell hands its target, for as long as it runs.
 *
 * SRD Mind Blank: "Until the spell ends, one willing creature you touch has
 * Immunity to Psychic damage and the Charmed condition." SRD Heroism: "Until
 * the spell ends, the creature is immune to the Frightened condition." Nothing
 * is rolled and nothing is resisted — the same shape `armor-class`,
 * `damage-defense` and `speed` take, on the other half of the run a stat block
 * prints in one line.
 *
 * **The seventh sourced grant, and the same four lines as the sixth.** The
 * casting is in the source, so `releaseCasting`, `releaseOnTarget`, a dispel, a
 * broken Concentration, the deadline and a `grants` timer all end it through
 * the door every other grant already uses; `grantsOf` is what puts it in front
 * of all of them at once, and it would not compile without the enumerator line.
 *
 * **The grant lands on the target and never on the caster**, unlike the rider
 * above it: an Immunity is something the protected creature holds, and Mind
 * Blank is Range: Touch. Divine Favor's asymmetry came from the *die* being
 * thrown by whoever swings, and there is no die here.
 */
export function resolveConditionImmunityEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'condition-immunity'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  let current = world;

  held.add(target);
  events.push({
    type: 'condition-immunity-granted',
    id: target,
    immunity: {
      source,
      conditions: effect.conditions,
    },
  });
  current = events.slice(-1).reduce(applyEvent, current);
  outcomes.push({ target, affected: true });
  return ok(current);
}
