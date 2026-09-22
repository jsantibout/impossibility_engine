/**
 * The effect kind that adds a creature to the world rather than changing one.
 *
 * Alone in a module for the reason `spell-effect-teleport.ts` is: the arrival,
 * every refusal and every number are `summonCreature`'s, so there is nothing
 * here to share with a neighbour and a contrived family would be worse than a
 * module of one.
 *
 * **What this file is, measured by its body:** it works out the two numbers
 * SRD prints over a stat block, asks the order what rung its caster is on, and
 * calls the door. Everything else — reading the block out of content, pinning
 * the sheet and the printed hit points into `creature-added`, giving the
 * creature the summoner's side, refusing a stat block this world does not hold
 * — was built and shipped with `summonCreature` and is not repeated.
 *
 * **The bond is not written here.** A `creature-summoned` naming a casting
 * that is not yet in `state.ongoing` is a log the fold refuses, and a casting
 * writes its `spell-ongoing` record *after* its effects resolve. So this
 * records which creatures it raised and `resolveEffects` binds them through
 * `bindSummonsToCasting` once the record exists. That ordering is the whole
 * reason the two halves are apart, and it is the same ordering
 * `summonCreature` enforces for a DM doing it by hand.
 */

import { asCharacterId, ok, type CharacterId, type Result } from '@ie/shared';
import { applyEvent, type GameState } from '../events.js';
import type { SummonedNumber } from '../spell-definitions.js';
import { summonCreature } from './creatures.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * What the casting calls the creature it raised.
 *
 * **Derived from the casting rather than stated**, which is the one thing this
 * effect does that its neighbours do not, and it is derived for three reasons.
 * A casting id is unique and already in the log, so the key is stable across a
 * replay and a retry of the same casting resolves to the same creature rather
 * than a second one. An id a caller supplied would be a fact the request has
 * nowhere to put and one more thing for a model to get wrong. And it is
 * *pure*: no clock, no counter and no randomness, which is what an id the
 * engine mints has to be.
 *
 * The stat block's id is in it so that a spell raising two different creatures
 * has two different keys; two of the *same* block from one casting would
 * collide, and `addCreature` answers `already_present` rather than quietly
 * making one creature into two.
 */
export const summonedId = (castingId: string, monsterId: string): CharacterId =>
  asCharacterId(`${castingId}:${monsterId}`);

/** `base + perSpellLevel × level`, worked out once, at the cast. */
const scaled = (number: SummonedNumber, level: number): number =>
  number.base + number.perSpellLevel * level;

/**
 * A creature appears, out of the bestiary and on the spell's terms.
 *
 * **The level the numbers scale from is `castLevel`**, the level the casting
 * was actually made at, and not the spell's own: SRD Find Steed's "Use the
 * spell slot's level for the spell's level in the stat block" says so in as
 * many words, and it is the same number every `DiceScaling` in the catalogue
 * already reads.
 *
 * **The Initiative count is read off the order, never taken from a caller.**
 * SRD Find Steed's "it shares your Initiative count" names a number the engine
 * holds; a fight that is not running holds none, and then the creature arrives
 * with no rung exactly as a summons with no stated total always has — the two
 * commands that give one still work, because the creature is in the game.
 *
 * **The count, and not the tie.** SRD Find Steed's next sentence is "the steed
 * takes its turn **immediately after yours**", and no tiebreak is written here
 * to deliver it. `Combatant.tiebreak` says in as many words that "SRD leaves
 * ties to the GM, so the engine takes that decision as an input rather than
 * inventing one" — and an invented one would have been worse than useless:
 * `addCombatant` already seats a joiner after everyone it exactly ties with,
 * so with the rider's count and the default the steed lands immediately after
 * them, while one tiebreak *below* the rider would have pushed it behind any
 * combatant a DM had given a lower one.
 *
 * So what is left undelivered is the guarantee rather than the behaviour: a
 * third creature on the rider's count comes between the two, and "after this
 * creature" is an insertion at a named position that `byInitiative` ranks
 * nothing by. The spell's own `unmodelled` records it at that width.
 */
export function resolveSummonEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'summon'>,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes, unverified, casterId } = ctx;
  const id = summonedId(ctx.casting().castingId, effect.monster);

  // The caster's own rung, where the spell says the creature shares it and a
  // fight is running to share. `undefined` is silence rather than a refusal —
  // see `Summons.initiative`.
  const sharing =
    effect.sharesCastersInitiative === true
      ? world.combat?.order.find((combatant) => combatant.id === casterId)
      : undefined;

  const arrived = summonCreature(world, ctx.supply.content, {
    id,
    monsterId: effect.monster,
    by: casterId,
    ...(effect.armorClass === undefined
      ? {}
      : { armorClass: scaled(effect.armorClass, ctx.castLevel) }),
    ...(effect.hitPoints === undefined
      ? {}
      : { hitPointMaximum: scaled(effect.hitPoints, ctx.castLevel) }),
    // The count, and **only** the count. See the note above on why the tie is
    // not settled here.
    ...(sharing === undefined ? {} : { initiative: sharing.initiative }),
  });
  if (!arrived.ok) return arrived;

  events.push(...arrived.value.events);
  unverified.push(...arrived.value.unverified.map((gap) => `${name}: ${gap}`));
  // Recorded rather than bound: the bond waits for the casting's own record.
  ctx.summoned.push(id);
  outcomes.push({ target: casterId, affected: true });
  return ok(arrived.value.events.reduce(applyEvent, world));
}
