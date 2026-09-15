/**
 * The three effect kinds a die decides: the spell attack, the saving throw
 * that deals damage, and the saving throw that does not.
 *
 * One module because they are the only three that **host an outcome** —
 * something rolled, an affirmative branch, and riders hung on that branch —
 * which is the whole of what `applyRiders` exists for. Every other kind lands
 * or does not land, and has nothing for a rider to ride.
 */

import { ABILITY_NAMES, type CharacterId, type ConditionName, ok, type Result } from '@ie/shared';
import { type DamageComponent, rollAttack, rollAttackDamage } from '../attack.js';
import { bonusesFor } from '../bonuses.js';
import { rollSavingThrow } from '../checks.js';
import { applyEvent, type CreatureState, type GameState } from '../events.js';
import { apartFromSource } from '../positioning.js';
import {
  hasOutcomeRiders,
  isCreatureType,
  outcomeRidersOf,
  scaledDiceFor,
  scaledFlatFor,
} from '../spell-definitions.js';
import {
  armorClassOf,
  effectiveConditions,
  evadesHalfDamage,
  grantedAttackRiders,
} from '../standing.js';
import { healCreature } from './creatures.js';
import { dealSpellDamage } from './damage.js';
import {
  defendingModes,
  enemyWithinFiveFeet,
  recordD20Test,
  rollSpellDice,
  savingSupport,
  withFlatAddend,
} from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';
import { applyRiders } from './spell-effect-riders.js';

/**
 * A spell attack roll, the damage a hit deals, and the riders it carries.
 *
 * The longest of the thirteen because it is three resolutions in one: the
 * attack, the miss branch SRD Acid Arrow prints, and the hit.
 */
export function resolveAttackEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'attack'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    caster,
    casterSheet,
    castLevel,
    numbers,
    supply,
    label,
    unverified,
    events,
    outcomes,
    held,
    ability,
    attackModifier,
    saveDc,
    from,
  } = ctx;
  // A rider is welded to the casting that hung it and a `damage-scheduled`
  // names one, so the three kinds that roll a D20 Test are refused on an item
  // by `checkContent` and the accessor is loud here — see `EffectContext.casting`.
  const { definition, castingId } = ctx.casting();
  let current = world;

  // **A spell attack is an attack roll.** SRD Dodge says "any attack
  // roll made against you" and Blur says "attack rolls against you";
  // neither says "with a weapon". This path never read the defender's
  // standing effects at all, so a Dodging target was easier to hit with
  // a Fire Bolt than with a dagger — the same gatherer the weapon attack
  // uses removes the fork rather than copying its version of it.
  const defending = defendingModes(current, casterId, target);
  unverified.push(...defending.unverified);

  // **A ranged spell attack is a ranged attack.** SRD "Ranged Attacks": "You
  // have Disadvantage on the attack roll if you are within 5 feet of an enemy
  // who can see you and who isn't Incapacitated." That is a sentence about the
  // attack's range, and `attack: 'ranged'` is where the spell states which of
  // the two it is. The weapon attack has always asked this question — it asked
  // it of the *weapon*, and a spell attack names none, so a Fire Bolt loosed
  // past an ogre's elbow answered no every time.
  const crowding = enemyWithinFiveFeet(current, casterId);
  unverified.push(...crowding.unverified);

  const attack = rollAttack(supply.issuer, supply.rng, casterSheet().sheet, {
    weapon: null,
    // **SRD: "Spell attack modifier = your spellcasting ability modifier plus
    // your Proficiency Bonus."** Both terms are inside `attackModifier`
    // already — pinned at the casting, or printed by the item that supplied
    // it — so it goes in as the modifier the roll is *made with* rather than
    // as a bonus beside a derivation of the same two terms. Handed in as a
    // flat bonus, the weaponless branch derived an Unarmed Strike's Strength
    // and a second Proficiency Bonus underneath it and every spell attack in
    // the engine rolled high by exactly that.
    //
    // `ranged` is the spell's own word for its range, and the only thing that
    // can answer it here: `isRangedAttack` reads it instead of the weapon.
    spellAttack: { modifier: attackModifier, ability, ranged: effect.attack === 'ranged' },
    targetAc: armorClassOf(current, target),
    modes: [...defending.modes, ...(supply.modes ?? [])],
    nearbyEnemy: crowding.near,
    attackBonuses: [
      // Bless is on the caster, not in the caller's head.
      ...bonusesFor((caster?.bonuses ?? []), 'attack'),
      ...(supply.bonuses ?? []),
    ],
    // A condition a feature has suppressed gives an attacker nothing:
    // SRD Aura of Courage says the condition "has no effect on that ally
    // while there", and being easier to hit is an effect.
    targetConditions: effectiveConditions(current, target),
    // Prone reads the distance, and a spell attack is measured the same
    // way a weapon's is — **from where the attack comes from**, which
    // for a casting that holds a point is that point rather than the
    // caster. Absent where nobody has placed them, so the rule gives no
    // answer rather than a guessed one.
    ...(apartFromSource(current, from, casterId, target) === null
      ? {}
      : { withinFiveFeet: apartFromSource(current, from, casterId, target)! <= 5 }),
  });
  if (!attack.ok) return attack;

  events.push({
    type: 'roll-recorded',
    who: casterId,
    label: `${label} attack`,
    natural: attack.value.roll.natural,
    total: attack.value.total,
    contributions: [{ source: 'spell attack', amount: attackModifier }],
    outcome: attack.value.hit ? 'hit' : 'miss',
  });

  if (!attack.value.hit) {
    // SRD Acid Arrow: "On a miss, the arrow splashes the target with
    // acid for half as much of the initial damage **only**." *Only* is
    // the whole of the branch: the riders are the hit's, and a miss owes
    // neither the condition nor the later hit. Halved before the
    // target's own defences, exactly as a made saving throw is —
    // "half the damage that would be dealt" is half of what the *spell*
    // deals, and Resistance then halves that again.
    if (effect.onMiss !== 'half') {
      outcomes.push({ target, attack: attack.value, affected: false });
      return ok(current);
    }

    const splash = rollSpellDice(
      supply,
      casterSheet().sheet,
      definition.name,
      effect.damageType,
      scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel),
    );
    if (!splash.ok) return splash;

    const splashed = dealSpellDamage(
      current,
      target,
      withFlatAddend(
        splash.value,
        scaledFlatFor(effect.damage, definition.level, castLevel) +
          (effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0),
      ).map((component) => ({ ...component, total: Math.floor(component.total / 2) })),
      definition.name,
      supply,
      { by: casterId },
    );
    if (!splashed.ok) return splashed;

    events.push(...splashed.value.events);
    current = splashed.value.events.reduce(applyEvent, current);
    outcomes.push({
      target,
      attack: attack.value,
      damage: splashed.value.amount,
      concentration: splashed.value.concentration,
      // The attack missed. A spell that still splashes has not *affected*
      // the target in the sense every other outcome uses the word —
      // the same answer `save-damage` gives a creature that saved and
      // took half anyway.
      affected: false,
    });
    return ok(current);
  }

  const dice = scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel);
  // **A spell attack is an attack roll**, and SRD Hunter's Mark says "whenever
  // you hit it with an attack roll" — so a Fire Bolt aimed at the quarry
  // carries the Force. Divine Favor's `weaponOnly` is what keeps its Radiant
  // off this path, which is the whole reason the two clauses are separate
  // fields.
  //
  // The gatherer is called directly rather than through
  // `standingAttackDamage`, because the *feature* half beside it is weapon
  // rules — Sneak Attack and Rage Damage — and a spell attack must not take
  // them.
  const carried = grantedAttackRiders(current.creatures[casterId], { weapon: null, target });
  // A critical doubles the dice, which is `rollAttackDamage`'s job, so
  // this one call keeps the weapon-shaped signature rather than going
  // through `rollSpellDice`.
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    casterSheet().sheet,
    {
      weapon: null,
      targetAc: armorClassOf(current, target),
      extraDamage: [
        // Absent when the spell's amount rolls nothing: `rollAttackDamage`
        // throws no die for a dice-free extra, and the flat number the line
        // prints lands on the component below.
        { source: definition.name, type: effect.damageType, ...(dice === undefined ? {} : { dice }) },
        ...carried,
      ],
    },
    attack.value.critical,
  );
  if (!rolled.ok) return rolled;

  // **The rider is kept beside the spell's own damage, not folded into it.**
  // The filter exists to drop the Unarmed Strike the weaponless branch
  // contributes; a rider is a real component with its own type and source, so
  // it is selected by name and appended. It goes on **after** the addend,
  // because `withFlatAddend` lands on the first component and SRD prints that
  // number beside the *spell's* dice — Hunter's Mark's 1d6 is not part of
  // Finger of Death's "+ 30".
  const riderNames = new Set(carried.map((rider) => rider.source));
  const hurt = dealSpellDamage(
    current,
    target,
    [
      ...withFlatAddend(
        rolled.value.components.filter((c) => c.source === definition.name),
        // SRD Flame Blade: "3d6 **plus your spellcasting ability
        // modifier**" — the chosen route's, so a feat's version adds its
        // own. A flat addend printed beside the dice adds on top of it.
        scaledFlatFor(effect.damage, definition.level, castLevel) +
          (effect.addSpellcastingModifier === true
            ? numbers.spellcastingModifier
            : 0),
      ),
      ...rolled.value.components.filter((c) => riderNames.has(c.source)),
    ],
    definition.name,
    supply,
    { by: casterId, ...(attack.value.critical ? { critical: true } : {}) },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);

  // SRD Vampiric Touch: "you regain Hit Points equal to **half the
  // amount of Necrotic damage dealt**." Half of what actually landed, so
  // a resistant target heals the caster for less — which is why it reads
  // the damage taken rather than the dice thrown. Rounding is the SRD's
  // usual: down, and a single point heals nothing.
  if (effect.healsCasterForHalf === true && hurt.value.amount > 0) {
    const back = Math.floor(hurt.value.amount / 2);
    if (back > 0) {
      const drained = healCreature(current, casterId, back);
      if (!drained.ok) return drained;
      events.push(...drained.value);
      current = drained.value.reduce(applyEvent, current);
    }
  }

  // SRD Ray of Sickness: "On a hit, the target takes 2d8 Poison damage
  // **and** has the Poisoned condition", and Acid Arrow's "and 2d4 Acid
  // damage at the end of its next turn". The attack roll settled it up
  // there and a miss already returned, so reaching here **is** the
  // affirmative outcome — which is why the riders need no branch of
  // their own. An attack rolls no saving throw, so nothing it hangs has
  // one to repeat.
  const riders = applyRiders(current, target, outcomeRidersOf(effect), {
    definition,
    castingId,
    casterId,
    saveDc,
    castLevel,
    casterLevel: numbers.casterLevel,
    unverified,
    held,
    saveAbility: null,
  });
  if (!riders.ok) return riders;
  events.push(...riders.value.events);
  current = riders.value.events.reduce(applyEvent, current);

  outcomes.push({
    target,
    attack: attack.value,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    ...(riders.value.conditions.length === 0
      ? {}
      : { conditions: riders.value.conditions }),
    affected: true,
  });
  return ok(current);
}

/**
 * A saving throw that deals damage, with what a success buys stated.
 */
export function resolveSaveDamageEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'save-damage'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    casterSheet,
    name,
    level,
    castLevel,
    numbers,
    supply,
    unverified,
    events,
    outcomes,
    held,
    saveDc,
  } = ctx;
  let current = world;

  const support = savingSupport(current, target, victim, effect.ability, supply);
  // SRD singles a creature type out twice, and both sentences are about
  // this save: Blight's "A Plant creature automatically fails the save"
  // and Shatter's "A Construct has Disadvantage on the save". The type
  // is known — `creatureTypeNeeds` asked for it above, before a die —
  // so the only question left is which of the two the spell printed.
  const singled =
    effect.againstType !== undefined &&
    effect.againstType.types.some((named) =>
      isCreatureType(victim.creatureType, named),
    )
      ? effect.againstType.outcome
      : null;
  const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    // Presence, not arithmetic: it goes in as a named source and
    // `combineRollModes` decides, so a Construct that is somehow also
    // helped rolls a normal save rather than a net-negative one.
    modes: [
      ...support.modes,
      ...(singled === 'disadvantage'
        ? [{ source: `${name} (${victim.creatureType})`, mode: 'disadvantage' as const }]
        : []),
    ],
    bonuses: support.bonuses,
    // The die is still thrown and recorded; the total is overridden, so
    // no bonus applied afterwards rescues it — the reading `checks.ts`
    // has taken for a condition's automatic failure since it was written.
    ...(singled === 'automatic-failure'
      ? {
          autoFail: `${name}: a ${victim.creatureType} creature automatically fails the save`,
        }
      : {}),
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  // SRD Evasion: a successful Dexterity save against an effect that
  // would have halved the damage takes **none** of it, and a failed one
  // takes half. Read off the *target's* features, because it is a
  // defence rather than something the caster does.
  const evading = evadesHalfDamage(current, target, effect.ability, effect.onSuccess === 'half');

  // Nothing at all on a success means no damage roll either: the spell
  // did nothing, and rolling would move the generator for no reason.
  // Evasion reaches the same place from the other direction.
  if (save.value.success && (effect.onSuccess === 'none' || evading)) {
    outcomes.push({ target, save: save.value, damage: 0, affected: false });
    return ok(current);
  }

  // One save, and every damage type the spell names under it. Each
  // type rolls and scales separately; the save was already made once.
  const parts = [
    { damage: effect.damage, damageType: effect.damageType },
    ...(effect.plus ?? []),
  ];
  const rolledParts: DamageComponent[] = [];
  for (const part of parts) {
    const dice = scaledDiceFor(part.damage, level, numbers.casterLevel, castLevel);
    const rolled = rollSpellDice(
      supply,
      casterSheet().sheet,
      name,
      part.damageType,
      dice,
    );
    if (!rolled.ok) return rolled;
    rolledParts.push(
      ...withFlatAddend(
        rolled.value,
        scaledFlatFor(part.damage, level, castLevel),
      ),
    );
  }

  // SRD: "The halved damage is equal to half the damage that would be
  // dealt on a failed save." Half of what the spell deals, therefore
  // *before* the target's own Resistance — which then halves again.
  // Without Evasion the success is halved; with it the *failure* is,
  // and the success took nothing at all above.
  const halve = evading ? !save.value.success : save.value.success;
  const components = halve
    ? rolledParts.map((c) => ({ ...c, total: Math.floor(c.total / 2) }))
    : rolledParts;

  const hurt = dealSpellDamage(
    current,
    target,
    components,
    name,
    supply,
    { by: casterId },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);

  // SRD Sunbeam: "takes 6d8 Radiant damage **and** has the Blinded
  // condition"; Vitriolic Sphere: "On a successful save, a creature
  // takes half the initial damage **only**." A failed save is the
  // affirmative outcome and the riders are all on it — a success buys
  // whatever `onSuccess` says about the *damage* and nothing else,
  // however much of it still landed.
  //
  // **And the casting is reached for only here.** A conferred save rolls
  // against the item's printed DC and hangs nothing, so an item that carries
  // no rider never asks for a casting it has not got; `checkContent` refuses
  // a rider on a conferral, which is what makes that guarantee rather than a
  // hope. See `EffectContext.casting`.
  let imposed: readonly ConditionName[] = [];
  const hosted = outcomeRidersOf(effect);
  if (!save.value.success && hasOutcomeRiders(hosted)) {
    const { definition, castingId } = ctx.casting();
    const riders = applyRiders(current, target, hosted, {
      definition,
      castingId,
      casterId,
      saveDc,
      castLevel,
      casterLevel: numbers.casterLevel,
      unverified,
      held,
      // SRD Sunburst: "another Constitution saving throw" — the one this
      // host just rolled, which is why a repeat save names no ability of
      // its own.
      saveAbility: effect.ability,
    });
    if (!riders.ok) return riders;
    events.push(...riders.value.events);
    current = riders.value.events.reduce(applyEvent, current);
    imposed = riders.value.conditions;
  }

  outcomes.push({
    target,
    save: save.value,
    damage: hurt.value.amount,
    concentration: hurt.value.concentration,
    ...(imposed.length === 0 ? {} : { conditions: imposed }),
    affected: !save.value.success,
  });
  return ok(current);
}

/**
 * A saving throw, and whatever a failure carries.
 */
export function resolveSaveEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'save'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const {
    casterId,
    castLevel,
    numbers,
    supply,
    unverified,
    events,
    outcomes,
    held,
    saveDc,
    fought,
  } = ctx;
  // A rider is welded to the casting that hung it and a `damage-scheduled`
  // names one, so the three kinds that roll a D20 Test are refused on an item
  // by `checkContent` and the accessor is loud here — see `EffectContext.casting`.
  const { definition, castingId } = ctx.casting();
  let current = world;

  // A saving throw, and a condition on a failure.
  const support = savingSupport(current, target, victim, effect.ability, supply);
  const save = rollSavingThrow(supply.issuer, supply.rng, victim.sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    // SRD Charm Person: "It does so with Advantage if you or your allies are
    // fighting **it**." The fact was stated at the casting and refused if it
    // was not — `declaredFacts` asked before a slot went — so the only
    // question left is whether the caster named *this* creature.
    //
    // **Per target, because that is who the sentence is about.** An upcast
    // Charm Person names several, and the goblin you are fighting and the
    // bystander you are not get different saves out of one casting.
    //
    // **Presence, not arithmetic.** It goes in as a named source and
    // `combineRollModes` decides, so a fought target who is also Restrained
    // rolls a normal save rather than a net-positive one, and `modeSources`
    // still says both effects were in play.
    modes: [
      ...support.modes,
      ...(effect.advantageIfFought === true && fought?.includes(target) === true
        ? [
            {
              source: `${definition.name} (you or your allies are fighting it)`,
              mode: 'advantage' as const,
            },
          ]
        : []),
    ],
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${definition.name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  if (save.value.success) {
    outcomes.push({ target, save: save.value, affected: false });
    return ok(current);
  }

  // `save` writes its first rider flat; `conditionRiderOf` is the one
  // place that knows, so from here the four kinds that impose a
  // condition are reading one shape — including the flat `repeats`,
  // which belongs to the saving throw this host just made rather than to
  // any one of the conditions the failure imposed.
  const landed = applyRiders(current, target, outcomeRidersOf(effect), {
    definition,
    castingId,
    casterId,
    saveDc,
    castLevel,
    casterLevel: numbers.casterLevel,
    unverified,
    held,
    saveAbility: effect.ability,
  });
  if (!landed.ok) return landed;

  events.push(...landed.value.events);
  current = landed.value.events.reduce(applyEvent, current);
  outcomes.push({
    target,
    save: save.value,
    conditions: landed.value.conditions,
    affected: true,
  });
  return ok(current);
}
