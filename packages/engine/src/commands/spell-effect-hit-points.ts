/**
 * The three effect kinds that move hit points and give nobody a roll to beat:
 * temporary hit points, which sit beside the pool, healing, which is in it, and
 * the payout that hands over one of those at every turn boundary.
 *
 * None of them throws dice *at* anybody, which is what keeps them out of the
 * module that hosts outcomes: there is no affirmative branch here for a rider
 * to ride.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import { applyEvent, type CreatureState, type GameState } from '../events.js';
import { scaledDiceFor, scaledFlatFor } from '../spell-definitions.js';
import { castingHealingBonus } from '../standing.js';
import { healingRuleOf, maximisedHealing } from '../vitals.js';
import { grantTemporaryHpTo, healCreature } from './creatures.js';
import { rollSpellDice } from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * Temporary Hit Points. Beside the hit points, never in them.
 */
export function resolveTempHpEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'temp-hp'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterSheet, name, level, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.amount, level, numbers.casterLevel, castLevel);
  // **What the route this casting was made through says about the dice.** SRD
  // Fiendish Vigor: "When you cast the spell with this feature, you don't roll
  // the die for the Temporary Hit Points; you automatically get the highest
  // number on the die." It is the *grant's* rule rather than the spell's — the
  // same Warlock casting False Life off a slot rolls it — and it reaches the
  // roll through the `DieEffect.substitute` SRD Beacon of Hope already uses, so
  // every die is still thrown, still recorded, and still says what it showed.
  const route = ctx.route;
  const maximised = route?.kind === 'granted' && route.grant.maximisedDice === true;
  const rolled = rollSpellDice(
    supply,
    casterSheet().sheet,
    name,
    'temporary',
    dice,
    maximised ? [maximisedHealing('the highest number on the die')] : [],
  );
  if (!rolled.ok) return rolled;

  const flat = scaledFlatFor(effect.amount, level, castLevel);
  const modifier = effect.addSpellcastingModifier
    ? numbers.spellcastingModifier
    : 0;
  const amount = Math.max(
    0,
    rolled.value.reduce((sum, c) => sum + c.total, 0) + flat + modifier,
  );

  const granted = grantTemporaryHpTo(current, target, amount);
  if (!granted.ok) return granted;
  events.push(...granted.value);
  current = granted.value.reduce(applyEvent, current);
  outcomes.push({ target, temporaryHp: amount, affected: true });
  return ok(current);
}

/**
 * Hit points restored. No roll to beat and nothing to resist: healing is
 * not damage, and a target at full is a legal target who gains nothing.
 */
export function resolveHealEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'heal'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { casterId, casterSheet, name, level, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.healing, level, numbers.casterLevel, castLevel);
  // **What the target's own running effects say about the dice, before they
  // are thrown.** SRD Beacon of Hope: "regains the maximum number of Hit
  // Points possible from any healing." It is the *target's* rule rather than
  // the caster's — the Cleric who blessed them need not be the one healing
  // them, and need not still be there — and it reaches the roll through the
  // same `DieEffect.substitute` Great Weapon Fighting uses, so every d8 is
  // still thrown, still recorded, and still says what it showed.
  const standing = healingRuleOf(victim.healingRules);
  const rolled = rollSpellDice(
    supply,
    casterSheet().sheet,
    name,
    'healing',
    dice,
    standing === 'maximised' ? [maximisedHealing('the maximum possible')] : [],
  );
  if (!rolled.ok) return rolled;

  // SRD: "2d8 plus your spellcasting ability modifier" — and it is the
  // *chosen route's* ability, so a feat's version heals by its own.
  const bonus = effect.addSpellcastingModifier ? numbers.spellcastingModifier : 0;
  const addend = scaledFlatFor(effect.healing, level, castLevel);
  // And what the **caster's own features** add to what this casting restores,
  // derived on every read the way every standing benefit is — SRD Disciple of
  // Life's "2 plus the spell slot's level". Nothing is added where no slot
  // paid: `ctx.slotLevel` is the slot the casting expended, and a conferral,
  // an activation and an area settling later have none.
  const fromFeatures = castingHealingBonus(current, casterId, {
    slotLevel: ctx.slotLevel ?? null,
  });
  const extra = fromFeatures.reduce((sum, one) => sum + (one.flat ?? 0), 0);
  const amount = Math.max(
    0,
    rolled.value.reduce((sum, c) => sum + c.total, 0) + bonus + addend + extra,
  );

  events.push({
    type: 'roll-recorded',
    who: casterId,
    label: `${name} healing`,
    natural: 0,
    total: amount,
    contributions: [
      { source: 'spellcasting modifier', amount: bonus },
      ...fromFeatures.map((one) => ({ source: one.source, amount: one.flat ?? 0 })),
    ],
    outcome: 'healed',
  });

  // `healCreature` refuses a corpse and refuses nothing-at-all, and it
  // lifts exactly the unconsciousness that having no hit points caused.
  // The cap at the maximum is `heal`'s, in vitals, where it always was.
  const before = victim.vitals.hp;
  const healed = healCreature(current, target, Math.max(1, amount));
  if (!healed.ok) return healed;

  events.push(...healed.value);
  current = healed.value.reduce(applyEvent, current);
  outcomes.push({
    target,
    healed: (current.creatures[target]?.vitals.hp ?? before) - before,
    affected: true,
  });
  return ok(current);
}

/**
 * A payout the recipient collects at each of their own turn boundaries, for as
 * long as the casting runs.
 *
 * SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability
 * modifier **at the start of each of its turns**." Nothing is handed over here
 * — a cast is not a boundary — so this resolver does one thing: it writes the
 * arrangement down, with every number the definition printed already resolved.
 *
 * **The whole of the pinning is the `flat` on this event.** "Your spellcasting
 * ability modifier" is a fact about the caster at the moment of the cast, so a
 * bard who levels mid-minute pays what they promised rather than what they
 * would promise now — the rule `CastingNumbers` sets for a save DC, on the one
 * number this sentence prints. The dice go over as a **notation**, because a
 * payout that repeats throws its die each time and a total rolled here would be
 * a number in the log before the moment that produced it.
 *
 * **The grant lands on the target and never on the caster**, like the Immunity
 * beside it in Heroism's one sentence and unlike Divine Favor's rider: "each of
 * **its** turns" is the recipient's boundary, and the recipient is who holds
 * the arrangement.
 */
export function resolveTurnPayoutEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'turn-payout'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, numbers, events, outcomes, held } = ctx;

  const modifier = effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0;

  held.add(target);
  events.push({
    type: 'turn-payout-granted',
    id: target,
    payout: {
      source,
      at: effect.at,
      payout: effect.payout,
      // A negative modifier cannot make a ward hurt its own recipient, and the
      // floor is here rather than at the boundary so the log records exactly
      // what will be handed over.
      flat: Math.max(0, (effect.flat ?? 0) + modifier),
      ...(effect.dice === undefined ? {} : { dice: effect.dice }),
      ...(effect.damageType === undefined ? {} : { damageType: effect.damageType }),
    },
  });
  const current = events.slice(-1).reduce(applyEvent, world);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A rule the spell leaves standing in front of the target's healing.
 *
 * SRD Beacon of Hope: each target "regains the maximum number of Hit Points
 * possible from any healing." Nothing is rolled here and nothing is restored —
 * the rule is read by whatever heals them next, which may be a different
 * caster an hour later — so this is the shape the Armour Class, the defence,
 * the Speed and the action rule already take, on the sixth thing a spell hands
 * out that is not a roll.
 *
 * The casting is in the source, so `releaseCasting`, `releaseOnTarget`, a
 * dispel, a broken Concentration and the deadline all end it through the door
 * every other grant already uses. The standalone kind carries no deadline of
 * its own; a rider does, which is SRD Chill Touch — see `applyRiders`.
 */
export function resolveHealingRuleEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'healing-rule'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;

  held.add(target);
  events.push({ type: 'healing-rule-granted', id: target, rule: { source, rule: effect.rule } });
  const current = events.slice(-1).reduce(applyEvent, world);
  outcomes.push({ target, affected: true });
  return ok(current);
}

/**
 * A hit point maximum the spell holds up for as long as it runs.
 *
 * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase by
 * 5 for the duration." Nothing is rolled and nobody resists, so this is the
 * shape its five neighbours take — and it differs from every one of them in
 * what happens *afterwards*: the fold's derived pass reads the grant and moves
 * `Vitals.hpMax` to match, both when it lands and when it goes.
 *
 * **The number is settled here and pinned**, which is the rule every number a
 * casting reads out of a definition follows. What the slot bought is worked
 * out once, at the cast, so an eight-hour Aid is worth what it was worth when
 * it was cast.
 *
 * **The hit points that come with it are the fold's, not this resolver's.**
 * Emitting a heal beside the grant would reset death saves, lift the
 * unconsciousness that 0 hit points caused and be capped by the very maximum
 * it was raising — four wrong answers to a sentence that says the points were
 * never lost. `settleHitPointMaximum` is where the one answer lives.
 */
export function resolveHitPointMaximumEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'hit-point-maximum'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, level, castLevel, events, outcomes, held } = ctx;

  const amount = scaledFlatFor(effect.amount, level, castLevel);
  // A definition that raises a maximum by nothing is refused at authoring
  // (`bad_hit_point_maximum`), so this is the validator and the resolver
  // disagreeing rather than a rules dispute — and a grant of zero would sit on
  // the creature saying nothing for eight hours.
  if (amount <= 0) return ok(world);

  held.add(target);
  events.push({ type: 'hit-point-maximum-adjusted', id: target, adjustment: { source, amount } });
  const current = events.slice(-1).reduce(applyEvent, world);
  outcomes.push({ target, affected: true });
  return ok(current);
}
