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
import type { PrintedSummonSpeeds, SummonedNumber } from '../spell-definitions.js';
import type { PrintedSpeedMode } from '../monster.js';
import { removeCreatureEverywhere, summonCreature } from './creatures.js';
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
 * already reads. The Speeds the spell prints are gated on the same level —
 * "Fly 60 ft. (requires level 4+ spell)" — and withheld below it.
 *
 * **The Initiative count is read off the order, never taken from a caller,
 * and so is the seat.** SRD Find Steed's "it shares your Initiative count"
 * names a number the engine holds, and "the steed takes its turn immediately
 * after yours" names a *position* — so the creature is seated on the caster's
 * count, at the caster's tiebreak, immediately after the caster
 * (`CombatantInput.after`), and no tiebreak is invented to put it there. A
 * fight that is not running holds no order, and then the creature arrives with
 * no rung exactly as a summons with no stated total always has — the two
 * commands that give one still work, because the creature is in the game.
 *
 * **The form, where the spell leaves it to the caster**, is read off the
 * casting (`EffectContext.form`): `resolveSpell` has already refused a form
 * the spell does not admit and a spell that asks for none, before anything
 * was spent, so by here the id names a block the world holds.
 *
 * **One kept creature per spell.** SRD Find Steed: "If you already have a
 * steed from this spell, the steed is replaced by the new one"; SRD Find
 * Familiar: "If you cast this spell while you have a familiar, you instead
 * cause it to adopt a new eligible form." The creature this caster keeps from
 * this spell leaves first, through the ordinary departure, in the same batch
 * as the arrival — so the log says what happened in the order it happened.
 */
export function resolveSummonEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'summon'>,
  world: GameState,
): Result<GameState> {
  const { name, events, outcomes, unverified, casterId } = ctx;
  const { definition, castingId } = ctx.casting();
  const monsterId = typeof effect.monster === 'string' ? effect.monster : ctx.form;
  if (monsterId === undefined) {
    // Programmer error rather than a refusal: the pre-flight refuses a stated
    // form that is missing before anything is spent, so a run without one is a
    // caller that bypassed it.
    throw new Error(`${name}: a form the casting states was not checked before resolution`);
  }
  const id = summonedId(castingId, monsterId);

  let current = world;
  if (effect.kept !== undefined) {
    for (const held of keptBy(current, casterId, definition.id)) {
      const gone = removeCreatureEverywhere(current, held);
      if (!gone.ok) return gone;
      events.push(...gone.value);
      current = gone.value.reduce(applyEvent, current);
    }
  }

  // The caster's own rung, where the spell says the creature shares it and a
  // fight is running to share. `undefined` is silence rather than a refusal —
  // see `Summons.initiative`.
  const sharing =
    effect.sharesCastersInitiative === true
      ? current.combat?.order.find((combatant) => combatant.id === casterId)
      : undefined;
  const speeds = effect.speeds === undefined ? undefined : printedSpeedsAt(effect.speeds, ctx.castLevel);

  const arrived = summonCreature(current, ctx.supply.content, {
    id,
    monsterId,
    by: casterId,
    ...(effect.armorClass === undefined
      ? {}
      : { armorClass: scaled(effect.armorClass, ctx.castLevel) }),
    ...(effect.hitPoints === undefined
      ? {}
      : { hitPointMaximum: scaled(effect.hitPoints, ctx.castLevel) }),
    ...(effect.creatureType === undefined ? {} : { creatureType: effect.creatureType }),
    ...(effect.kept === undefined
      ? {}
      : {
          kept: {
            spell: definition.id,
            untilSummonerDies: effect.kept.untilSummonerDies === true,
          },
        }),
    ...(speeds === undefined ? {} : { speeds }),
    ...(effect.cannotAttack === true ? { forbidsAttacks: { label: definition.name } } : {}),
    // The count, the tiebreak and the seat, all the caster's own.
    ...(sharing === undefined
      ? {}
      : { initiative: sharing.initiative, tiebreak: sharing.tiebreak, after: casterId }),
  });
  if (!arrived.ok) return arrived;

  events.push(...arrived.value.events);
  unverified.push(...arrived.value.unverified.map((gap) => `${name}: ${gap}`));
  // A creature a casting holds is bound after the record — see
  // `resolveEffects`. A kept one was bound at the arrival, on the terms it is
  // kept on, and waits for no record.
  if (effect.kept === undefined) ctx.summoned.push(id);
  outcomes.push({ target: casterId, affected: true });
  return ok(arrived.value.events.reduce(applyEvent, current));
}

/** The creatures this caster keeps from this spell, sorted so the departure order is fixed. */
function keptBy(state: GameState, by: CharacterId, spell: string): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[]).sort().filter((who) => {
    const bond = state.creatures[who]?.summonedBy;
    return bond != null && bond.castingId === null && bond.by === by && bond.kept?.spell === spell;
  });
}

/** The Speeds the slot paid for: each printed mode whose level the casting reached. */
function printedSpeedsAt(
  speeds: PrintedSummonSpeeds,
  castLevel: number,
): Partial<Record<PrintedSpeedMode, number>> | undefined {
  const paid: Partial<Record<PrintedSpeedMode, number>> = {};
  for (const mode of ['walk', 'fly', 'climb', 'swim', 'burrow'] as const) {
    const printed = speeds[mode];
    if (printed === undefined) continue;
    if (printed.fromSpellLevel !== undefined && castLevel < printed.fromSpellLevel) continue;
    paid[mode] = printed.feet;
  }
  return Object.keys(paid).length === 0 ? undefined : paid;
}
