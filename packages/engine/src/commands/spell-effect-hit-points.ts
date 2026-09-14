/**
 * The two effect kinds that move hit points and give nobody a roll to beat:
 * temporary hit points, which sit beside the pool, and healing, which is in
 * it.
 *
 * Both throw dice and neither throws them *at* anybody, which is what keeps
 * them out of the module that hosts outcomes: there is no affirmative branch
 * here for a rider to ride.
 */

import { type CharacterId, ok, type Result } from '@ie/shared';
import { applyEvent, type CreatureState, type GameState } from '../events.js';
import { scaledDiceFor, scaledFlatFor } from '../spell-definitions.js';
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
