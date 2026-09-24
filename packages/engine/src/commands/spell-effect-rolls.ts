/**
 * The four effect kinds that throw a die of their own: the spell attack, the
 * saving throw that deals damage, the saving throw that does not, and the
 * damage that neither decides.
 *
 * **Three of them host an outcome** — something rolled, an affirmative branch,
 * and riders hung on that branch — which is the whole of what `applyRiders`
 * exists for, and it is why they were one module before the fourth arrived.
 *
 * **The fourth hosts none and is here anyway.** SRD Magic Missile's dart is
 * decided by nothing: it lands, and the only die in it is the damage. What
 * puts it beside the other three is the machinery underneath — the same
 * `rollSpellDice` and `dealSpellDamage` pair, the same per-roll loop over a
 * caster's stated split, the same `ExtraDamage.effects` carrying the
 * definition's own die rule — so it is the same code read twice rather than
 * a second module that would have to be kept in step by hand. Every other kind
 * lands or does not land, and has nothing for a rider to ride and no die to
 * throw.
 */

import { typeMagicSees } from '../creature-type.js';
import {
  ABILITY_NAMES,
  type CharacterId,
  type ConditionName,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import {
  type AttackResult,
  type DamageComponent,
  rollAttack,
  rollAttackDamage,
} from '../attack.js';
import { type DieEffect } from '../dice.js';
import { bonusesFor, type ModeSource } from '../bonuses.js';
import { type D20TestResult, rollSavingThrow } from '../checks.js';
import { applyEvent, type CreatureState, type GameEvent, type GameState } from '../events.js';
import { apartFromSource, sizeAtLeast } from '../positioning.js';
import { effectiveSizeOf } from '../size.js';
import { consumedRollModifiers } from '../roll-modifiers.js';
import { classOfRoute } from '../spellcasting.js';
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
  type SizedSaveMode,
} from '../spell-definitions.js';
import {
  armorClassOf,
  conditionImmunitiesOf,
  effectiveConditions,
  evadesHalfDamage,
  grantedAttackRiders,
  sheetAsItStands,
} from '../standing.js';
import { applyConditionTo } from './conditions.js';
import { healCreature } from './creatures.js';
import { dealSpellDamage } from './damage.js';
import {
  type CastingAlterations,
  defendingModes,
  enemyWithinFiveFeet,
  recordD20Test,
  declaredDieEffects,
  rerollLowestDamageDice,
  rollSpellDice,
  savingSupport,
  takeCastingAddend,
  takeCastingReroll,
  withFlatAddend,
  alteredCastingDice,
} from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';
import { applyRiders, conditionLanding, repeatSaveFrom } from './spell-effect-riders.js';
import { timerKey, type EffectTarget } from '../timers.js';

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
 * The mode an elected option hung on this creature's saves against this
 * casting, as the one-entry list a roller takes.
 *
 * SRD Heightened Spell is the only sentence in the book that writes it and the
 * engine names none of it: what arrives is a map the casting pinned, keyed by
 * the creature the caster named, carrying the mode the option prints and the
 * option's own name for the log. Empty for every other save in the game, which
 * is why the two save sites can call it unconditionally.
 */
const saveModeFor = (
  alters: CastingAlterations,
  target: CharacterId,
): readonly ModeSource[] => {
  const hung = alters.saveModes[target];
  return hung === undefined ? [] : [{ source: hung.source, mode: hung.mode }];
};

/**
 * The mode a saving throw takes from the size of the creature making it, as
 * the one-entry list a roller takes — or nothing, which is every save whose
 * definition prints no such clause.
 *
 * SRD Ensnaring Strike: "A Large or larger creature has Advantage on this
 * save." `effectiveSizeOf` is the one reader of a creature's size, and a
 * creature it cannot size — unstated and unplaced — is reported rather than
 * assumed Medium: the clause was printed and the engine could not check it.
 */
const sizedSaveMode = (
  state: GameState,
  target: CharacterId,
  clause: SizedSaveMode | undefined,
  spell: string,
  unverified: string[],
): readonly ModeSource[] => {
  if (clause === undefined) return [];
  const size = effectiveSizeOf(state, target);
  if (size === null) {
    unverified.push(
      `${spell}: a ${clause.sizeAtLeast} or larger creature has ${clause.mode} on this save, and nobody has said what size ${target} is`,
    );
    return [];
  }
  if (!sizeAtLeast(size, clause.sizeAtLeast)) return [];
  const floor = clause.sizeAtLeast.charAt(0).toUpperCase() + clause.sizeAtLeast.slice(1);
  return [{ source: `${spell} (a ${floor} or larger creature)`, mode: clause.mode }];
};

/**
 * The casting's damage dice as SRD Empowered Spell leaves them.
 *
 * Called at each of the four sites a casting rolls its own damage, and a no-op
 * at every one of them but the first of a casting that bought the option:
 * "when you roll damage for a spell" is one roll, so the mark is taken once —
 * `takeCastingAddend`'s rule on the reroll beside it.
 *
 * **A roll with no dice in it does not count as the roll**, which is the one
 * subtlety: SRD Magic Missile's dart is "1d4 + 1" and a maximised casting's
 * payload is a flat number with no dice at all, so taking the mark there would
 * spend a Sorcery Point on nothing. The mark stays for a roll that has dice.
 */
const empowered = (
  ctx: EffectContext,
  components: readonly DamageComponent[],
): Result<readonly DamageComponent[]> => {
  const hasDice = components.some((component) =>
    (component.roll?.dice ?? []).some((die) => die.disposition === 'counted'),
  );
  if (ctx.alters.reroll === null || !hasDice) return ok(components);
  const taken = takeCastingReroll(ctx.alters)!;
  return rerollLowestDamageDice(ctx.supply, components, taken.count, taken.source);
};

/**
 * This creature's share of one effect's aimed rolls.
 *
 * **Where the rolls go is the caster's, and they may say it unevenly.** SRD
 * leaves the middle of "at one target within range or at several" open, so
 * `EffectContext.rollsPerTarget` carries the split they stated and this
 * creature's share is read straight off it by position. Said nothing, they get
 * the deal {@link rollsDealtTo} has always made — one each in the order named,
 * round again for the surplus — which is every even split and none of the
 * lopsided ones.
 *
 * The stated vector is measured against {@link aimedRollsIn}, which is the
 * **longest** aimed effect in the list rather than this one's own; a definition
 * whose two such effects throw different numbers has no single split to state,
 * so this falls back to the deal rather than spending somebody else's rays. No
 * SRD spell has two, and the guard is here because a homebrew definition may.
 *
 * **The creature has to be in the list.** Every caller iterates the very list
 * it put on the context, so a target that is not in it is a programmer error
 * and gets the exception rule 6 reserves for one: a negative index can deal
 * `rollsDealtTo` one roll too many — whenever the rolls do not divide evenly —
 * which is a casting that throws a ray nobody asked for and refuses nothing
 * while doing it.
 *
 * Shared by the two kinds that aim rolls, because the sharing rule is about
 * the *list* rather than about what happens at the end of one: a dart is dealt
 * exactly as a ray is, and two copies of this would be two chances to disagree
 * about a caster's stated split.
 */
function shareOf(ctx: EffectContext, total: number, target: CharacterId): number {
  const where = ctx.targets.indexOf(target);
  if (where < 0) {
    throw new Error(
      `${ctx.label} is aiming rolls at ${target}, who is not among the targets it was given`,
    );
  }
  const stated = ctx.rollsPerTarget;
  return stated !== undefined && stated.reduce((sum, count) => sum + count, 0) === total
    ? stated[where]!
    : rollsDealtTo(total, ctx.targets.length, where);
}

/**
 * Every attack roll this effect owes this creature.
 *
 * **One roll is the whole of the book bar two spells**, and those two say the
 * same thing twice: SRD Scorching Ray's "Make a ranged spell attack for each
 * ray" and Eldritch Blast's beams. So the count comes off the definition
 * ({@link attackRollsFor}), the share of it that lands here is the one the
 * caster stated, and an effect that states no count resolves exactly as it
 * always did. Where they go is {@link shareOf}'s question.
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
  const mine = shareOf(
    ctx,
    attackRollsFor(effect.rolls, definition.level, ctx.numbers.casterLevel, ctx.castLevel),
    target,
  );

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
  //
  // **And that it is a spell's**, which is the half a weapon swing cannot say
  // and the half SRD Innate Sorcery's "Advantage on the attack rolls of
  // Sorcerer spells you cast" is entirely about. The class comes off the
  // casting's own route, so a Sorcerer/Wizard's Fire Bolt is narrowed by which
  // half of her cast it, and a feat's or an item's route names no class at all.
  const through = ctx.route === null ? null : classOfRoute(ctx.route);
  const defending = defendingModes(current, casterId, target, ability, {
    ...(through === null ? {} : { through }),
  });
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

  const throwIt = (): Result<AttackResult> =>
    rollAttack(supply.issuer, supply.rng, casterSheet().sheet, {
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
    // Asked about the caster, because a spell attack has two ends too — see
    // `effectiveConditions`, and SRD Mind Spike's "against you".
    targetConditions: effectiveConditions(current, target, casterId),
    // Prone reads the distance, and a spell attack is measured the same
    // way a weapon's is — **from where the attack comes from**, which
    // for a casting that holds a point is that point rather than the
    // caster. Absent where nobody has placed them, so the rule gives no
    // answer rather than a guessed one.
    ...(apartFromSource(current, from, casterId, target) === null
      ? {}
      : { withinFiveFeet: apartFromSource(current, from, casterId, target)! <= 5 }),
  });

  const first = throwIt();
  if (!first.ok) return first;

  const record = (result: AttackResult, superseded?: AttackResult): void => {
    events.push({
      type: 'roll-recorded',
      who: casterId,
      label: `${label} attack`,
      natural: result.roll.natural,
      total: result.total,
      contributions: [{ source: 'spell attack', amount: attackModifier }],
      outcome: result.hit ? 'hit' : 'miss',
      ...(superseded === undefined
        ? {}
        : { supersedes: { natural: superseded.roll.natural, total: superseded.total } }),
    });
  };
  record(first.value);

  // — SRD Seeking Spell ——————————————————————————————————————————————————
  //
  // "If you make an attack roll for a spell and **miss**, you can spend 1
  // Sorcery Point to reroll the d20, and you must use the new roll." Elected at
  // the casting, which is where the pool was checked; spent here, because here
  // is where the sentence's condition is known.
  //
  // **The whole attack is thrown again**, not the bare face. The modes, the
  // bonuses and the Armour Class are the same on the second throw, so the only
  // thing that can differ is the die — and reaching inside the result to swap a
  // number would be a second arithmetic for what `rollAttack` already does
  // once. Both throws are in the log and the second names the first, exactly
  // as `rerollTest` records a save thrown again.
  //
  // **Nulled by the throw that uses it**, for `takeCastingReroll`'s reason: the
  // point buys one reroll and a Scorching Ray misses five times.
  let attack = first;
  const seeking = alters.rerollMissedAttack;
  if (!first.value.hit && seeking !== null) {
    alters.rerollMissedAttack = null;
    const again = throwIt();
    if (!again.ok) return again;
    record(again.value, first.value);
    const spent: GameEvent = {
      type: 'resource-spent',
      id: casterId,
      key: seeking.cost.key,
      amount: seeking.cost.amount,
    };
    events.push(spent);
    current = applyEvent(current, spent);
    attack = again;
  }

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

    const splashEmpowered = empowered(
      ctx,
      withFlatAddend(
        splash.value,
        scaledFlatFor(effect.damage, definition.level, castLevel) +
          (effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0) +
          splashDice.value.flat +
          takeCastingAddend(alters),
      ),
    );
    if (!splashEmpowered.ok) return splashEmpowered;
    const splashed = dealSpellDamage(
      current,
      target,
      splashEmpowered.value.map((component) => ({
        ...component,
        total: Math.floor(component.total / 2),
      })),
      definition.name,
      supply,
      // **A spell's damage that no attack roll bought**, which is what SRD
      // Bestow Curse's "or a spell" widens its die to — see
      // `dealSpellDamage`'s `fromSpell`. The attack road one function up does
      // not say it, because it has already gathered its riders itself.
      { by: casterId, fromSpell: true },
    );
    if (!splashed.ok) return splashed;

    events.push(...splashed.value.events);
    current = splashed.value.events.reduce(applyEvent, current);
    // **And what a feature watching the fall could not settle.** The funnel
    // reports a side nobody declared or a holder nobody placed, and a caller
    // that dropped it would be an engine that knew and did not say.
    unverified.push(...splashed.value.unverified);
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
  // The spell's own dice, and only those: SRD Empowered Spell rerolls "the
  // damage dice" of the spell, and a rider hanging off another casting —
  // Hunter's Mark's 1d6 — is not this spell's damage any more than it is part
  // of Finger of Death's "+ 30".
  const own = empowered(
    ctx,
    withFlatAddend(
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
  );
  if (!own.ok) return own;
  const hurt = dealSpellDamage(
    current,
    target,
    [...own.value, ...rolled.value.components.filter((c) => riderNames.has(c.source))],
    definition.name,
    supply,
    { by: casterId, ...(attack.value.critical ? { critical: true } : {}) },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);
  // **And what a feature watching the fall could not settle.** The funnel
  // reports a side nobody declared or a holder nobody placed, and a caller
  // that dropped it would be an engine that knew and did not say.
  unverified.push(...hurt.value.unverified);

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
    content: supply.content,
    ...(ctx.object === undefined ? {} : { object: ctx.object }),
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
 * Damage that simply lands, dealt one hit at a time.
 *
 * SRD Magic Missile: "**A dart deals 1d4 + 1 Force damage to its target.** The
 * darts all strike simultaneously, and you can direct them to hit one creature
 * or several."
 *
 * **Nothing is rolled to decide whether it lands**, so there is no attack, no
 * saving throw, no miss branch, no Critical Hit and no rider — the shortest of
 * the resolvers in this module, and short for a reason rather than by
 * omission. What is left is the dice, and they are thrown through exactly the
 * pair every other damaging effect uses.
 *
 * **One hit at a time, all the way down.** Each dart rolls its own dice, lands
 * its own `damage-dice-recorded` and `damage-taken`, meets the target's
 * defences on its own, and raises its own Concentration save. Three darts at a
 * creature with Resistance to Force are three halvings and not one, and the
 * printed `+ 1` is printed on the dart — the whole reason the count is a count
 * of *hits* rather than a multiplier on the notation.
 *
 * **A ward was asked once, at the declaration**, where SRD Sanctuary puts it:
 * "any creature who **targets** the warded creature". `aimsHarmAtATarget` is
 * what lets `resolveSpell` see that this kind is a damaging spell, and asking
 * again here would roll a second save per dart.
 *
 * **The casting is never reached for.** This hangs nothing on one — no
 * condition instance, no granted modifier, no promised later hit — so it reads
 * the spell's name and level off the context, which an item's conferral would
 * answer too. That the kind is refused on a conferral today is `checkContent`'s
 * rule rather than this resolver's; there is nothing here for one to break.
 */
export function resolveAutoDamageEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'auto-damage'>,
  target: CharacterId,
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
    alters,
  } = ctx;
  const mine = shareOf(
    ctx,
    attackRollsFor(effect.rolls, level, numbers.casterLevel, castLevel),
    target,
  );

  let current = world;
  for (let thrown = 0; thrown < mine; thrown += 1) {
    // The definition's dice as the caster's own features leave them, read
    // inside the loop for the reason the attack reads them inside its own: a
    // maximisation is spent on the roll it is spent on, and a rule that took
    // the maximum of the first dart and let the rest fall back would be a
    // feature that behaved differently at two darts than at one.
    const scaled = alteredCastingDice(
      alters,
      scaledDiceFor(effect.damage, level, numbers.casterLevel, castLevel),
    );
    if (!scaled.ok) return scaled;

    const rolled = rollSpellDice(
      supply,
      casterSheet().sheet,
      name,
      effect.damageType,
      scaled.value.dice,
      // "For this spell" is about the spell and not about which of its dice is
      // rolling, which is the reading the two neighbours above take of the
      // same field.
      dieEffectsOf(ctx),
    );
    if (!rolled.ok) return rolled;

    const dealt = empowered(
      ctx,
      withFlatAddend(
        rolled.value,
        // SRD prints "1d4 **+ 1**" on the dart, so the addend lands on every
        // one of them. Beside it, whatever the caster's features turned into a
        // flat number and the one damage roll a modifier rides.
        scaledFlatFor(effect.damage, level, castLevel) +
          scaled.value.flat +
          takeCastingAddend(alters),
      ),
    );
    if (!dealt.ok) return dealt;
    const hurt = dealSpellDamage(
      current,
      target,
      dealt.value,
      name,
      supply,
      // **A spell's damage that no attack roll bought**, which is what SRD
      // Bestow Curse's "or a spell" widens its die to — see
      // `dealSpellDamage`'s `fromSpell`. The attack road one function up does
      // not say it, because it has already gathered its riders itself.
      { by: casterId, fromSpell: true },
    );
    if (!hurt.ok) return hurt;

    events.push(...hurt.value.events);
    current = hurt.value.events.reduce(applyEvent, current);
    // **And what a feature watching the fall could not settle.** The funnel
    // reports a side nobody declared or a holder nobody placed, and a caller
    // that dropped it would be an engine that knew and did not say.
    unverified.push(...hurt.value.unverified);

    // One outcome per hit, which is what the attack beside it reports and for
    // the same reason: a creature that took three darts took three lots of
    // damage and may have made three Concentration saves, and one summed
    // outcome would have to pick which of them to report.
    outcomes.push({
      target,
      damage: hurt.value.amount,
      concentration: hurt.value.concentration,
      affected: true,
    });
  }
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
    // A spell forced it, which SRD Magic Resistance reads.
    true,
  );
  // SRD singles a creature type out twice, and both sentences are about
  // this save: Blight's "A Plant creature automatically fails the save"
  // and Shatter's "A Construct has Disadvantage on the save". The type
  // is known — `creatureTypeNeeds` asked for it above, before a die —
  // so the only question left is which of the two the spell printed.
  const singled =
    effect.againstType !== undefined &&
    effect.againstType.types.some((named) =>
      isCreatureType(typeMagicSees(victim), named),
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
      // SRD Heightened Spell: "give one target of the spell Disadvantage on
      // **saves against the spell**." Bought at the casting, named per target,
      // and presence rather than arithmetic exactly as the clause above it is
      // — so a target who is also somehow helped rolls a normal save and the
      // record still says both were in play. It reaches every save this
      // casting forces on that creature, which is the plural in the sentence.
      ...saveModeFor(alters, target),
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
  // The dice as SRD Empowered Spell leaves them, **before** the halving: "you
  // must use the new rolls" is about what the spell deals, and a made save
  // halves whatever that came to.
  const thrown = empowered(ctx, rolledParts);
  if (!thrown.ok) return thrown;
  const halve = evading ? !save.value.success : save.value.success;
  const components = halve
    ? thrown.value.map((c) => ({ ...c, total: Math.floor(c.total / 2) }))
    : thrown.value;

  const hurt = dealSpellDamage(
    current,
    target,
    components,
    name,
    supply,
    // **A spell's damage that no attack roll bought**, which is what SRD
    // Bestow Curse's "or a spell" widens its die to — see
    // `dealSpellDamage`'s `fromSpell`. The attack road one function up does
    // not say it, because it has already gathered its riders itself.
    { by: casterId, fromSpell: true },
  );
  if (!hurt.ok) return hurt;

  events.push(...hurt.value.events);
  current = hurt.value.events.reduce(applyEvent, current);
  // **And what a feature watching the fall could not settle.** The funnel
  // reports a side nobody declared or a holder nobody placed, and a caller
  // that dropped it would be an engine that knew and did not say.
  unverified.push(...hurt.value.unverified);

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
      content: supply.content,
      ...(ctx.object === undefined ? {} : { object: ctx.object }),
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
/**
 * A repeat save the **casting** hosts, hung by a failure that imposed nothing.
 *
 * SRD Ray of Enfeeblement: "The target repeats the save at the end of each of
 * its turns, ending the spell on a success." The failure hands out grants and
 * imposes no condition, so there is no condition instance for the hook to be
 * filed on — which is exactly SRD Searing Smite's position, and the answer is
 * the same one: `raiseTurnSaves` raises a repeat from a `condition` timer and
 * from a `casting` timer, and this is the second.
 *
 * **The deadline is read back rather than derived again.** The casting's own
 * timer is already standing by the time an effect resolves — `runEffects`
 * folds the casting's events onto the state before the first die — so the
 * moment the spell ends at is a fact the log holds, and re-resolving the
 * spell's duration here would be `keptRunning`'s "two derivations of one
 * number" arriving one command along. `timerKey` files the event under the key
 * the deadline already has, so this *replaces* that timer with itself plus the
 * hook rather than standing a second one beside it; whatever else the timer
 * carried travels with it.
 *
 * **Two hosts, and the definition's own `onSuccess` says which.** The paragraph
 * above is the whole story for a spell whose success ends the casting, and one
 * timer holds one hook — so `checkCastingRepeatLifetime` refuses that spelling
 * to any spell that could catch more than one creature. SRD Slow is the other
 * sentence: "An affected target repeats the save at the end of each of its
 * turns, **ending the spell on itself** on a success", over up to six
 * creatures. A hook per creature needs a key per creature, and there is one
 * already — the `grants` timer, "every grant one source made on one creature",
 * whose source *is* the casting's own mark. So the hook rides on
 * `grants|<target>|Slow#cast:3`, the deadline is still the casting's, and a
 * success is `releaseOnTarget`, which lifts exactly what this casting hung on
 * that one creature and leaves the rest of the spell running.
 *
 * **Nothing new ends it.** `releaseCasting` and `releaseOnTarget` already drop
 * a `grants` timer whose source names the casting, so the hook goes when the
 * spell does, by either door; and a deadline arriving on that timer releases
 * the grants it was standing over, which is the same moment and the same
 * effect as the casting's own deadline arriving.
 *
 * **Nothing at all where the casting has no deadline**, which no definition
 * the validator admits can produce: `checkCastingRepeatLifetime` refuses a
 * spell that prints no span. A casting that somehow reaches here without one
 * says so on its own `unverified` rather than refusing a casting whose slot is
 * already spent.
 *
 * The ability and the DC are the save's own — "the target repeats **the**
 * save" — and the creature is the one that failed it, which is whose turns
 * the boundary raises it on.
 */
function castingHostedRepeat(
  ctx: EffectContext,
  effect: EffectOfKind<'save'>,
  target: CharacterId,
  castingId: string,
  saveDc: number,
  world: GameState,
): GameEvent | null {
  const repeats = effect.repeats;
  if (repeats === undefined || effect.condition !== undefined) return null;

  const key = timerKey({ kind: 'casting', castingId });
  const standing = world.timers[key];
  if (standing === undefined) {
    ctx.unverified.push(
      `${ctx.name}: the spell is repeated at a turn boundary and this casting has no deadline for the repeat to ride on, so nobody will be asked again`,
    );
    return null;
  }

  // The casting's deadline either way; whose turns raise it and what a success
  // ends are the two things the spelling decides.
  const on: EffectTarget =
    repeats.onSuccess === 'end-on-target'
      ? { kind: 'grants', on: target, source: ctx.source }
      : standing.target;

  return {
    type: 'effect-scheduled',
    target: on,
    deadline: standing.deadline,
    repeatSave: {
      at: repeats.at,
      of: target,
      ability: effect.ability,
      dc: saveDc,
      onSuccess: repeats.onSuccess,
      label: `${ctx.name} (${ABILITY_NAMES[effect.ability]} save)`,
    },
    // **Carried only where this event *replaces* the casting's own timer**,
    // which is the `end-casting` road: whatever else that timer held has to
    // travel with it or the re-scheduling would drop it. A per-target hook
    // stands beside the casting's timer rather than over it, so copying the
    // casting's check onto it would offer the same escape once per creature.
    ...(on === standing.target && standing.check !== undefined ? { check: standing.check } : {}),
    ...(on === standing.target && standing.endsEarly !== undefined
      ? { endsEarly: standing.endsEarly }
      : {}),
  };
}

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
    willing,
    alters,
  } = ctx;
  let current = world;

  /**
   * SRD *Levitate*: "An **unwilling** creature that succeeds on a Constitution
   * saving throw is unaffected."
   *
   * The whole of the clause, and it is a save **withheld** rather than one
   * automatically failed: the book does not hand a consenting creature a die
   * it is certain to lose, it declines to offer one at all. So nothing is
   * rolled, no `d20-test-rolled` is written, and the outcome carries no save —
   * which is what tells a reader this creature apart from one that rolled and
   * failed.
   *
   * **The caster consents by casting.** A wizard levitating themselves has
   * said so in the act, and asking them to name themselves as well would be
   * one fact spelled two ways.
   *
   * `autoSucceedIf` below is the other shape and deliberately not this one:
   * there the die *is* thrown and its total overridden, because SRD Sleep says
   * the creature "automatically succeeds on saves against this spell" — a save
   * made, not a save withheld.
   */
  const consents =
    effect.unlessWilling === true &&
    (target === casterId || willing?.includes(target) === true);

  /**
   * What the die said, or **null** where no die was offered.
   *
   * Null is neither a failure nor a success: it is the absence of the roll,
   * which is what the sentence above describes and what the outcome then
   * reports by carrying no `save` at all. Everything below reads it as "was
   * there a save, and did it hold".
   */
  let thrown: D20TestResult | null = null;
  if (!consents) {
    // **The one fact this save may read that a creature can honestly lack**,
    // asked for before a die moves. SRD Animal Messenger spares a target whose
    // Challenge Rating "isn't 0", and a creature nobody has rated has no rating
    // rather than a rating of zero — a player character has none at all, and
    // zero is the one answer that would always pass. So the absence is a missing
    // fact and not a wrong one, which is what `needsContext` is for.
    //
    // Nothing is spent by asking: a casting is one `Result`, so a resolver that
    // refuses leaves no events behind it.
    if (
      effect.autoSucceedIf !== undefined &&
      'challengeRatingAbove' in effect.autoSucceedIf &&
      victim.cr === null
    ) {
      return needsContext(
        'undeclared_challenge_rating',
        `${name} spares a target whose Challenge Rating is above ${effect.autoSucceedIf.challengeRatingAbove}, and nobody has said what ${target}'s is`,
        [
          {
            kind: 'creature',
            subject: target,
            need: `${target}'s Challenge Rating`,
            because: `${name} reads it off the target, and an unstated rating is not a rating of 0`,
            satisfyWith: `add ${target} from the stat block it is playing — addCreature pins the Challenge Rating the book prints`,
          },
        ],
      );
    }

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
      // A spell forced it, which SRD Magic Resistance reads.
      true,
    );
    // The sheet as it stands — see `resolveSaveDamageEffect`. Two resolvers roll
    // two saves, so one of them moving is not the other moving.
    const sheet = sheetAsItStands(current, target) ?? victim.sheet;
    // SRD Sleep: "Creatures … that have Immunity to the Exhaustion condition
    // **automatically succeed** on saves against this spell." A defence the
    // target already has, read through the one gatherer — so a Zombie's printed
    // Immunity and a granted one answer alike — and applied as the mirror of the
    // automatic failure `againstType` writes on the other resolver: the die is
    // still thrown and recorded, and the total is overridden.
    // **Or what the target *is*, which is the field's other member.** SRD
    // Animal Messenger: "if the target's Challenge Rating isn't 0, it
    // automatically succeeds" — a number the book prints on a stat block and
    // `creature-added` pins, read here exactly as the Immunity above is read and
    // overriding the same total. The rating is never null by this point: a
    // target nobody has rated was asked about above, before a die moved.
    const sparedBy =
      effect.autoSucceedIf === undefined
        ? null
        : 'challengeRatingAbove' in effect.autoSucceedIf
          ? (victim.cr ?? 0) > effect.autoSucceedIf.challengeRatingAbove
            ? `${name}: a creature whose Challenge Rating is above ${effect.autoSucceedIf.challengeRatingAbove} automatically succeeds on the save`
            : null
          : conditionImmunitiesOf(current, target).includes(effect.autoSucceedIf.immuneTo)
            ? `${name}: a creature with Immunity to the ${effect.autoSucceedIf.immuneTo} condition automatically succeeds on the save`
            : null;
    const save = rollSavingThrow(supply.issuer, supply.rng, sheet, effect.ability, {
      dc: saveDc,
      conditions: support.conditions,
      ...(sparedBy === null ? {} : { autoSucceed: sparedBy }),
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
        // SRD Heightened Spell, on the other save resolver: two resolvers roll
        // two saves, and an option that reached one of them would work against a
        // Fireball and not against a Hold Person.
        ...saveModeFor(alters, target),
        // SRD Ensnaring Strike: "A Large or larger creature has Advantage on
        // this save." The size is the engine's own fact, read through the one
        // reader every size question goes through, and it arrives as a named
        // source for `combineRollModes` to weigh — a Large creature that is also
        // Restrained rolls a normal save, and the log still names both.
        ...sizedSaveMode(current, target, effect.saveModeIf, name, unverified),
      ],
      bonuses: support.bonuses,
    });
    if (!save.ok) return save;
    thrown = save.value;

    events.push(
      recordD20Test(
        target,
        `${ABILITY_NAMES[effect.ability]} save vs ${name}`,
        save.value,
        save.value.success ? 'resisted' : 'affected',
      ),
    );
  }

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
      // **`thrown` is never null here, and the validator is what says so.**
      // A verdict may be kept only in a list that fires off a record that
      // already exists, and `unlessWilling` may be read only in the casting's
      // own list, which is the one list a verdict may not be kept in — so no
      // definition can withhold a save and ask for its verdict at once. The
      // reading is written out rather than asserted because a creature that
      // consented is affected, which is the answer a recorded verdict would
      // want if the two ever met.
      failed: thrown === null || !thrown.success,
    });
  }

  if (thrown !== null && thrown.success) {
    // **And what the success itself carries, where the sentence gives it
    // something.** SRD Ray of Enfeeblement: "On a successful save, the target
    // has Disadvantage on the next attack roll it makes until the start of
    // your next turn." The riders are the same riders and `applyRiders` is
    // handed them without being told which branch it is serving — the slot
    // name is the branch, which is what keeps the rider design's invariant.
    //
    // **A casting, like every other rider slot.** `checkContent` refuses riders
    // on an item's or a feature's conferral, so this arm has one whenever the
    // slot is filled; the accessor is loud rather than absent when it is not.
    //
    // **The creature is still `affected: false`.** It made its save, which is
    // what the outcome word means — and what it is carrying is a grant the
    // casting hung, which `spellOn` reads off the world exactly as it reads a
    // failure's.
    const carried = effect.onSuccessRiders;
    if (carried !== undefined && ctx.origin.kind === 'casting') {
      const { definition, castingId } = ctx.casting();
      const hung = applyRiders(current, target, carried, {
        definition,
        castingId,
        casterId,
        saveDc,
        castLevel,
        casterLevel: numbers.casterLevel,
        unverified,
        held,
        content: supply.content,
        ...(ctx.object === undefined ? {} : { object: ctx.object }),
        saveAbility: effect.ability,
      });
      if (!hung.ok) return hung;
      events.push(...hung.value.events);
      current = hung.value.events.reduce(applyEvent, current);
    }
    outcomes.push({ target, save: thrown, affected: false });
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
      outcomes.push({ target, ...(thrown === null ? {} : { save: thrown }), affected: false });
      return ok(current);
    }

    held.add(target);
    outcomes.push({
      target,
      ...(thrown === null ? {} : { save: thrown }),
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
    content: supply.content,
    ...(ctx.object === undefined ? {} : { object: ctx.object }),
    saveAbility: effect.ability,
  });
  if (!landed.ok) return landed;

  events.push(...landed.value.events);
  current = landed.value.events.reduce(applyEvent, current);

  // **And the repeat, where the failure imposed no condition to file it on.**
  // SRD Ray of Enfeeblement's "The target repeats the save at the end of each
  // of its turns, ending the spell on a success" — hung on the casting's own
  // deadline, which is the road SRD Searing Smite already takes. A failure
  // that *did* impose a condition files its repeat on the instance, which
  // `conditionRiderOf` carried into `applyRiders` above, so exactly one of the
  // two roads is ever taken. See {@link castingHostedRepeat}.
  const hook = castingHostedRepeat(ctx, effect, target, castingId, saveDc, current);
  if (hook !== null) {
    events.push(hook);
    current = applyEvent(current, hook);
  }

  outcomes.push({
    target,
    ...(thrown === null ? {} : { save: thrown }),
    ...(landed.value.conditions.length === 0 ? {} : { conditions: landed.value.conditions }),
    affected: true,
  });
  return ok(current);
}
