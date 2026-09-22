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
import { type DieEffect } from '../dice.js';
import { bonusesFor } from '../bonuses.js';
import { rollSavingThrow } from '../checks.js';
import { applyEvent, type CreatureState, type GameEvent, type GameState } from '../events.js';
import { apartFromSource } from '../positioning.js';
import { consumedRollModifiers } from '../roll-modifiers.js';
import { answerTheBlow } from './passive-defenses.js';
import {
  attackRollsFor,
  conditionRiderOf,
  hasOutcomeRiders,
  isCreatureType,
  outcomeRidersOf,
  rollsDealtTo,
  scaledDiceFor,
  scaledFlatFor,
} from '../spell-definitions.js';
import {
  armorClassOf,
  effectiveConditions,
  evadesHalfDamage,
  grantedAttackRiders,
  sheetAsItStands,
} from '../standing.js';
import { applyConditionTo } from './conditions.js';
import { healCreature } from './creatures.js';
import { dealSpellDamage } from './damage.js';
import {
  defendingModes,
  enemyWithinFiveFeet,
  recordD20Test,
  declaredDieEffects,
  rollSpellDice,
  savingSupport,
  takeCastingAddend,
  withFlatAddend,
  alteredCastingDice,
} from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';
import { applyRiders, conditionLanding, repeatSaveFrom } from './spell-effect-riders.js';

/**
 * What the spell being resolved says about its own damage dice, as effects.
 *
 * **Only a casting has one**, and the two other origins are absent rather than
 * empty for the same reason `EffectContext.casting` is loud: an item confers a
 * spell's *effects* and a feature's pool use has no definition at all, so
 * neither has a printed spell sentence to read `dieRule` off. Either can still
 * confer an effect that rolls damage; it simply rolls its dice plainly, which
 * is what the book prints.
 *
 * The cap comes off `numbers`, which the casting pinned — so a Headband of
 * Intellect taken off after the cast does not change how many dice the spell
 * was allowed, exactly as it does not change the save DC.
 */
const dieEffectsOf = (ctx: EffectContext): readonly DieEffect[] =>
  ctx.origin.kind === 'casting'
    ? declaredDieEffects(ctx.origin.definition.dieRule, ctx.numbers.spellcastingModifier, ctx.name)
    : [];

/**
 * Every attack roll this effect owes this creature.
 *
 * **One roll is the whole of the book bar two spells**, and those two say the
 * same thing twice: SRD Scorching Ray's "Make a ranged spell attack for each
 * ray" and Eldritch Blast's beams. So the count comes off the definition
 * ({@link attackRollsFor}), the share of it that lands here is the one the
 * caster stated, and an effect that states no count resolves exactly as it
 * always did.
 *
 * **Where the rolls go is the caster's, and they may say it unevenly.** SRD
 * leaves the middle of "at one target within range or at several" open, so
 * `EffectContext.rollsPerTarget` carries the split they stated and this
 * creature's share is read straight off it by position. Said nothing, they get
 * the deal {@link rollsDealtTo} has always made — one each in the order named,
 * round again for the surplus — which is every even split and none of the
 * lopsided ones.
 *
 * The stated vector is measured against {@link attackRollsIn}, which is the
 * **longest** attack in the list rather than this one's own; a definition
 * whose two attacks throw different numbers of rolls has no single split to
 * state, so this effect falls back to the deal rather than spending somebody
 * else's rays. No SRD spell has two, and the guard is here because a homebrew
 * definition may.
 *
 * **Each roll is its own roll, all the way down**: its own `rollAttack`, its
 * own `roll-recorded` line in the log, its own Critical Hit, its own damage
 * roll, its own one-shot modifier spent, its own riders, and its own
 * {@link SpellTargetOutcome}. A second beam lands on a creature the first one
 * killed the same way a second dagger does, because the world each roll reads
 * is the one the roll before it left.
 *
 * The loop is here rather than in the dispatch because the count is the
 * `attack` member's own: a dispatch that read it would be one kind's rule
 * written in the place that must not know which kind it has.
 */
export function resolveAttackEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'attack'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { definition } = ctx.casting();
  const total = attackRollsFor(
    effect.rolls,
    definition.level,
    ctx.numbers.casterLevel,
    ctx.castLevel,
  );
  // The creature's place in the list the caster named. Every caller iterates
  // the very list it put on the context, so a target that is not in it is a
  // programmer error and gets the exception rule 6 reserves for one: a
  // negative index can deal `rollsDealtTo` one roll too many — whenever the
  // rolls do not divide evenly — which is a casting that throws a ray nobody
  // asked for and refuses nothing while doing it.
  const where = ctx.targets.indexOf(target);
  if (where < 0) {
    throw new Error(
      `${ctx.label} is resolving an attack on ${target}, who is not among the targets it was given`,
    );
  }
  const stated = ctx.rollsPerTarget;
  const mine =
    stated !== undefined && stated.reduce((sum, count) => sum + count, 0) === total
      ? stated[where]!
      : rollsDealtTo(total, ctx.targets.length, where);

  let current = world;
  for (let thrown = 0; thrown < mine; thrown += 1) {
    const done = resolveOneAttackRoll(ctx, effect, target, current);
    if (!done.ok) return done;
    current = done.value;
  }
  return ok(current);
}

/**
 * A spell attack roll, the damage a hit deals, and the riders it carries.
 *
 * The longest of the thirteen because it is three resolutions in one: the
 * attack, the miss branch SRD Acid Arrow prints, and the hit.
 */
function resolveOneAttackRoll(
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
    alters,
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
  // The ability the casting rolls with, which is the spell attack's own: SRD
  // narrows a mode by "attack rolls using Strength" and a Fire Bolt is not one,
  // so the answer is the caster's spellcasting ability and `null` where an item
  // printed the bonus instead of a caster deriving it.
  //
  // **A ward is deliberately not asked here**, and where it *is* asked is the
  // point: SRD Sanctuary turns a creature away the moment it **targets** the
  // warded one, and for a casting that moment is the declaration —
  // `resolveSpell`, with the targets settled and before the slot, the action
  // and the first die. Asking again per roll would roll a second save for one
  // targeting, and outside combat, where there is no turn to hold an attacker
  // to one save, it would roll one for every beam of a Scorching Ray.
  const defending = defendingModes(current, casterId, target, ability);
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

  // **A spell attack is an attack roll**, which is the sentence this whole
  // resolver keeps having to say: a one-shot grant SRD Guiding Bolt hung on a
  // creature is spent by a Fire Bolt exactly as it is by a club, and the query
  // is the one `defendingModes` asked at the top. Before the miss branch,
  // because "the next attack roll made against it" does not wait for a hit.
  for (const spent of consumedRollModifiers(current, {
    family: 'attack',
    roller: casterId,
    against: target,
    ...(ability === null ? {} : { ability }),
  })) {
    const consumed: GameEvent = {
      type: 'roll-modifier-consumed',
      id: spent.holder,
      source: spent.source,
    };
    events.push(consumed);
    current = applyEvent(current, consumed);
  }

  if (!attack.value.hit) {
    // SRD Acid Arrow: "On a miss, the arrow splashes the target with
    // acid for half as much of the initial damage **only**." *Only* is
    // the whole of the branch: the riders are the hit's, and a miss owes
    // neither the condition nor the later hit. Halved before the
    // target's own defences, exactly as a made saving throw is —
    // "half the damage that would be dealt" is half of what the *spell*
    // deals, and Resistance then halves that again.
    //
    // **And the caster's own features may write this branch where the
    // definition prints none.** SRD Potent Cantrip: "you miss with the attack
    // roll ... the target takes half the cantrip's damage (if any) but suffers
    // no additional effect" — which is this branch word for word, so the
    // feature supplies the missing `half` rather than a second miss path.
    if (effect.onMiss !== 'half' && !alters.halfWhenAvoided) {
      outcomes.push({ target, attack: attack.value, affected: false });
      return ok(current);
    }

    const splashDice = alteredCastingDice(
      alters,
      scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel),
    );
    if (!splashDice.ok) return splashDice;

    const splash = rollSpellDice(
      supply,
      casterSheet().sheet,
      definition.name,
      effect.damageType,
      splashDice.value.dice,
      // SRD says "for this spell", and a miss that still splashes is this
      // spell dealing damage — the same dice, halved afterwards.
      dieEffectsOf(ctx),
    );
    if (!splash.ok) return splash;

    const splashed = dealSpellDamage(
      current,
      target,
      withFlatAddend(
        splash.value,
        scaledFlatFor(effect.damage, definition.level, castLevel) +
          (effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0) +
          splashDice.value.flat +
          takeCastingAddend(alters),
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

  // **And the defender's passive defences, the instant the hit is known.** SRD
  // Mirror Image says "each time a creature hits you with an attack roll" and
  // SRD Fire Shield "hits you with a melee attack roll"; neither says "with a
  // weapon", so a Shocking Grasp meets a duplicate exactly as a club does.
  // Before the damage is rolled, because a blow a duplicate took deals none.
  const answered = answerTheBlow(current, casterId, target, supply, {
    melee: effect.attack !== 'ranged',
  });
  if (!answered.ok) return answered;
  events.push(...answered.value.events);
  current = answered.value.events.reduce(applyEvent, current);
  unverified.push(...answered.value.unverified);
  if (answered.value.deflected) {
    // The roll is reported because it was made and it hit — what it hit was an
    // illusion. `affected` is false for the reason a splashed miss is: nothing
    // of this reached the creature.
    outcomes.push({ target, attack: attack.value, affected: false });
    return ok(current);
  }

  // The definition's dice, as the caster's own features leave them: SRD Foe
  // Slayer substitutes the die, SRD Overchannel takes the maximum and throws
  // nothing. The critical goes in because the SRD doubles the dice first and a
  // maximisation maximises whatever dice end up rolling.
  const scaled = alteredCastingDice(
    alters,
    scaledDiceFor(effect.damage, definition.level, numbers.casterLevel, castLevel),
    attack.value.critical,
  );
  if (!scaled.ok) return scaled;
  const dice = scaled.value.dice;
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
  const declared = dieEffectsOf(ctx);
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
        //
        // **The die rule rides on this component and not on the roll.** The
        // riders below are in the same call and are another casting's dice, so
        // a rule about "this spell" must not reach them — see
        // `ExtraDamage.effects`.
        {
          source: definition.name,
          type: effect.damageType,
          ...(dice === undefined ? {} : { dice }),
          ...(declared.length === 0 ? {} : { effects: declared }),
        },
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
            : 0) +
          // What the caster's features turned into a flat number — a
          // maximisation's total — and the one damage roll SRD Elemental
          // Affinity and Empowered Evocation each add a modifier to.
          scaled.value.flat +
          takeCastingAddend(alters),
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
    alters,
  } = ctx;
  let current = world;

  // **The same question the plain save asks, because this is the same save.**
  // SRD Contagion is one Constitution saving throw for damage *and* the
  // Poisoned condition, so a dwarf's Advantage to avoid being Poisoned reaches
  // it exactly as it reaches a save that only imposes. Two resolvers roll two
  // saves, and a trait that reached one of them would work against a spell and
  // not against its neighbour.
  const support = savingSupport(
    current,
    target,
    victim,
    effect.ability,
    supply,
    conditionRiderOf(effect).map((rider) => rider.name),
  );
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
  // **The sheet as it stands**, so an item that *sets* the ability this save is
  // made with reaches the save rather than stopping at the page. Read off
  // `current` — the world this effect is landing in — and asked here rather
  // than in `checks.ts`, which takes a sheet and holds no state on purpose: a
  // roller that went looking for a worn item would be the second derivation
  // `sheetAsItStands` exists to prevent.
  const sheet = sheetAsItStands(current, target) ?? victim.sheet;
  const save = rollSavingThrow(supply.issuer, supply.rng, sheet, effect.ability, {
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

  // SRD Potent Cantrip: "the target succeeds on a saving throw against the
  // cantrip, the target takes half the cantrip's damage (if any)". A floor the
  // *caster's* feature puts under a success the definition gave nothing for,
  // read here rather than at the branches below so that one value answers for
  // what a success buys and Evasion is asked about the sentence as it now
  // stands.
  const onSuccess = alters.halfWhenAvoided ? 'half' : effect.onSuccess;

  // SRD Evasion: a successful Dexterity save against an effect that
  // would have halved the damage takes **none** of it, and a failed one
  // takes half. Read off the *target's* features, because it is a
  // defence rather than something the caster does.
  //
  // **And off the definition's own sentence rather than the altered one.** SRD
  // Evasion's trigger is "an effect that allows you to make a Dexterity saving
  // throw to take only half damage", which is a fact about the spell: Acid
  // Splash allows a save to take *none*, and a caster's Potent Cantrip does not
  // turn it into a spell that offers half — it says the target still takes half
  // anyway. Reading the altered value here would have let one creature's
  // Evasion start biting because somebody else levelled, which is the wrong
  // creature's feature deciding.
  const evading = evadesHalfDamage(current, target, effect.ability, effect.onSuccess === 'half');

  // Nothing at all on a success means no damage roll either: the spell
  // did nothing, and rolling would move the generator for no reason.
  // Evasion reaches the same place from the other direction.
  if (save.value.success && (onSuccess === 'none' || evading)) {
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
  for (const [index, part] of parts.entries()) {
    const dice = alteredCastingDice(
      alters,
      scaledDiceFor(part.damage, level, numbers.casterLevel, castLevel),
    );
    if (!dice.ok) return dice;
    const rolled = rollSpellDice(
      supply,
      casterSheet().sheet,
      name,
      part.damageType,
      dice.value.dice,
      // Every part of the payload the spell prints, because "for this spell" is
      // about the spell and not about which of its damage types is rolling.
      dieEffectsOf(ctx),
    );
    if (!rolled.ok) return rolled;
    rolledParts.push(
      ...withFlatAddend(
        rolled.value,
        // The printed addend, plus whatever the caster's features turned into a
        // flat number, plus the one damage roll a modifier rides. A spell that
        // prints two types — Ice Knife's Piercing and Cold — takes the modifier
        // on the first of them and the rest of the list gets nothing, which is
        // what "one damage roll" says. SRD Divine Spark's "plus your Wisdom
        // modifier" is read the same way and on the same component.
        scaledFlatFor(part.damage, level, castLevel) +
          dice.value.flat +
          takeCastingAddend(alters) +
          (index === 0 && effect.addSpellcastingModifier === true
            ? numbers.spellcastingModifier
            : 0),
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
 *
 * **Two origins, one roll.** SRD prints the sentence on items as well as on
 * spells — "must succeed on a DC 13 Constitution saving throw or have the
 * Poisoned condition for 1 hour" — and the difference between the two is not
 * the die, the DC or the condition. It is what the condition is filed under
 * and what a repeat save later ends:
 *
 * - A **casting** files it under `Spell#cast:N` and goes out through
 *   {@link applyRiders}, which is where the other riders a failure may carry
 *   live — further conditions, a granted penalty, a delayed hit — every one of
 *   them welded to a casting id.
 * - An **item or a feature** files it under `item:<id>` or `feature:<id>`,
 *   hands over the conditions the failure imposes, and carries the repeat save
 *   with the first of them. `checkContent` refuses both hosts every field that
 *   would need a casting — the granted penalty, the delayed hit, a rider's
 *   lifetime, its escape check, its `outlivesCasting`, and a repeat whose
 *   success would end a casting — so neither arm has anything to translate and
 *   neither reaches for one.
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
    name,
    numbers,
    supply,
    unverified,
    events,
    outcomes,
    held,
    saveDc,
    fought,
  } = ctx;
  let current = world;

  // A saving throw, and a condition on a failure.
  //
  // **Which is also what the save is *about*.** SRD Fey Ancestry grants
  // Advantage "to avoid or end the Charmed condition", and the avoiding is
  // this roll: the riders this failure would impose are the conditions the
  // target is saving against, so the gatherer is handed them rather than left
  // to guess from the ability. The list may be empty — SRD Slow's failure
  // hands out grants and imposes nothing — and an empty list goes through as
  // itself: it says this save is about no condition, which is a different
  // claim from a caller that never answered, and a condition-keyed selector
  // misses both.
  const support = savingSupport(
    current,
    target,
    victim,
    effect.ability,
    supply,
    conditionRiderOf(effect).map((rider) => rider.name),
  );
  // The sheet as it stands — see `resolveSaveDamageEffect`. Two resolvers roll
  // two saves, so one of them moving is not the other moving.
  const sheet = sheetAsItStands(current, target) ?? victim.sheet;
  const save = rollSavingThrow(supply.issuer, supply.rng, sheet, effect.ability, {
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
              source: `${name} (you or your allies are fighting it)`,
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
      `${ABILITY_NAMES[effect.ability]} save vs ${name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  // **The verdict, where the sentence says somebody knows it** — SRD Zone of
  // Truth, "You know whether a creature succeeds or fails on this save."
  //
  // Before the branch below, because it is the one thing a *success* leaves
  // behind: the book's sentence is about both answers, and a record written
  // only on a failure would answer "has this creature been asked yet" with
  // silence. `checkContent` refuses the field on an item and on a feature, so
  // this arm always has a casting; the guard is the accessor's own rule — see
  // `EffectContext.casting` — rather than a second opinion about it.
  if (effect.recordsOutcome === true && ctx.origin.kind === 'casting') {
    events.push({
      type: 'casting-save-recorded',
      castingId: ctx.casting().castingId,
      target,
      failed: !save.value.success,
    });
  }

  if (save.value.success) {
    outcomes.push({ target, save: save.value, affected: false });
    return ok(current);
  }

  // **The arm with no casting behind it, which hangs conditions and asks for
  // none.** `conditionRiderOf` folds the flat fields in as the first element
  // and `save.conditions` as the rest. The list may now be **empty** — SRD
  // Slow's failure hands out grants and imposes nothing — but not here: a
  // conferral carries no riders at all (`checkContent` refuses them) and a
  // `save` that imposes nothing and hangs nothing is refused at authoring, so
  // the two rules between them leave a conferred save exactly one thing it
  // can be, which is a condition.
  //
  // **Every rider, not just the first.** An item's list is one long —
  // `checkContent` refuses `conditions` on a conferral — but SRD Turn Undead
  // is "the Frightened **and** Incapacitated conditions" off one Wisdom save,
  // so a feature's is two, and a second `save` effect would roll a second
  // saving throw a creature could fail one of. Each instance is filed under
  // the same source, which is what the paying command's timer loop then reads
  // back off the outcome.
  //
  // **The repeat rides on the first rider only.** `conditionRiderOf` folds the
  // host's flat `repeats` there because it belongs to the saving throw rather
  // than to any one condition — a copy on each would raise one debt per
  // condition at every turn boundary — and it names the source through the
  // instance it is filed under, so the boundary raises it and a success ends it
  // on the timer the conferral's own lifetime files.
  if (ctx.origin.kind !== 'casting') {
    const conferred: ConditionName[] = [];
    for (const rider of conditionRiderOf(effect)) {
      const landed = conditionLanding(
        applyConditionTo(
          current,
          target,
          rider.name,
          ctx.source,
          [],
          undefined,
          repeatSaveFrom(rider.repeats, {
            of: target,
            ability: effect.ability,
            dc: saveDc,
            name,
          }),
        ),
      );
      if (!landed.ok) return landed;
      // A target immune to the condition is **unaffected** and not an error —
      // the flask was still drunk and the save was still rolled, which is the
      // reading `conditionLanding` holds for every origin.
      if (!landed.value.landed) continue;
      events.push(...landed.value.events);
      current = landed.value.events.reduce(applyEvent, current);
      conferred.push(rider.name);
    }

    if (conferred.length === 0) {
      outcomes.push({ target, save: save.value, affected: false });
      return ok(current);
    }

    held.add(target);
    outcomes.push({
      target,
      save: save.value,
      conditions: conferred,
      affected: true,
    });
    return ok(current);
  }

  // A rider is welded to the casting that hung it and a `damage-scheduled`
  // names one, so a failure that carries more than the one condition is a
  // casting's — and the accessor is loud rather than absent when it is not.
  // See `EffectContext.casting`.
  const { definition, castingId } = ctx.casting();

  // `save` writes its first rider flat; `conditionRiderOf` is the one
  // place that knows, so from here the four kinds that impose a
  // condition are reading one shape — including the flat `repeats`,
  // which belongs to the saving throw this host just made rather than to
  // any one of the conditions the failure imposed.
  //
  // **And the list may be empty**, which is SRD Slow: one Wisdom save, three
  // grants, no condition. `applyRiders` walks whichever slots are filled, so
  // a failure that hangs only `modifiers` needs no branch here — the
  // creature is `affected`, because the grants landed on it, and `conditions`
  // is absent rather than empty for the reason every other outcome's is.
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
    ...(landed.value.conditions.length === 0 ? {} : { conditions: landed.value.conditions }),
    affected: true,
  });
  return ok(current);
}
