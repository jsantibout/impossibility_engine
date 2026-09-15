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
import { castingSource } from '../spells.js';
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
  const { casterSheet, definition, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.amount, definition.level, numbers.casterLevel, castLevel);
  const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'temporary', dice);
  if (!rolled.ok) return rolled;

  const flat = scaledFlatFor(effect.amount, definition.level, castLevel);
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
  const { casterId, casterSheet, definition, castLevel, numbers, supply, events, outcomes } = ctx;
  let current = world;

  const dice = scaledDiceFor(effect.healing, definition.level, numbers.casterLevel, castLevel);
  const rolled = rollSpellDice(supply, casterSheet().sheet, definition.name, 'healing', dice);
  if (!rolled.ok) return rolled;

  // SRD: "2d8 plus your spellcasting ability modifier" — and it is the
  // *chosen route's* ability, so a feat's version heals by its own.
  const bonus = effect.addSpellcastingModifier ? numbers.spellcastingModifier : 0;
  const addend = scaledFlatFor(effect.healing, definition.level, castLevel);
  const amount = Math.max(
    0,
    rolled.value.reduce((sum, c) => sum + c.total, 0) + bonus + addend,
  );

  events.push({
    type: 'roll-recorded',
    who: casterId,
    label: `${definition.name} healing`,
    natural: 0,
    total: amount,
    contributions: [{ source: 'spellcasting modifier', amount: bonus }],
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
  const { definition, castingId, numbers, events, outcomes, held } = ctx;

  const modifier = effect.addSpellcastingModifier === true ? numbers.spellcastingModifier : 0;

  held.add(target);
  events.push({
    type: 'turn-payout-granted',
    id: target,
    payout: {
      source: castingSource(definition.name, castingId),
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
