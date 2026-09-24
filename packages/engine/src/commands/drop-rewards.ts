/**
 * What a creature reaching 0 Hit Points pays whoever was watching it fall.
 *
 * **A module of its own, and the reason is where it has to be called from.**
 * The moment happens on three roads — damage the engine typed, damage a DM
 * adjudicated, and a printed sentence that drops a creature without hurting
 * it — and the first two meet at `resolveDamage` in `casting.ts`. That is the
 * one true funnel, so that is where the watcher is paid; but `damage.ts`
 * imports `casting.ts` **as a value**, so a reader living in `damage.ts` and
 * called from `casting.ts` would be a module cycle with a `const` arrow in it,
 * which is a temporal-dead-zone crash waiting for an import order to change.
 *
 * So the reader lives beneath both, imports neither, and is called by
 * `resolveDamage` and by the `drops-to-zero` clause alike. Nothing else here
 * knows how the creature fell, which is the whole point: the SRD sentence does
 * not either.
 */

import type { CharacterId } from '@ie/shared';
import type { GameEvent, GameState } from '../events.js';
import { modifierFor } from '../character.js';
import { distanceBetween } from '../positioning.js';
import { sheetAsItStands } from '../standing.js';

/** What a creature falling paid whoever was watching, and what could not be settled. */
export interface DropSpoils {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
}

export const NOTHING_GAINED: DropSpoils = { events: [], unverified: [] };

/**
 * Whether this blow is the one that took the creature to 0.
 *
 * Read off the two worlds rather than off the outcome, because every road to
 * `damage-taken` already folds its own events and none of them agrees on what
 * it returns. A creature already at 0 is not dropped again — the book's "when
 * you reduce an enemy to 0 Hit Points" is about the reduction — and a floor
 * that held the blow at 1 did not drop anybody either, which falls out of
 * reading the hit points that are actually there.
 */
export const droppedToZeroBy = (
  before: GameState,
  landed: GameState,
  target: CharacterId,
): boolean =>
  (before.creatures[target]?.vitals.hp ?? 0) > 0 &&
  (landed.creatures[target]?.vitals.hp ?? 1) === 0;

/**
 * What a hostile creature reaching 0 Hit Points pays the features watching it.
 *
 * SRD Dark One's Blessing: "When you reduce an enemy to 0 Hit Points, you gain
 * Temporary Hit Points equal to your Charisma modifier plus your Warlock level
 * (minimum of 1 Temporary Hit Point). You also gain this benefit if someone
 * else reduces an enemy within 10 feet of you to 0 Hit Points."
 *
 * **Every road that deals damage calls it through `resolveDamage`, and so does
 * the sentence that drops a creature without damage.** "Reduce an enemy to 0
 * Hit Points" is what a sword, a Fire Bolt, a falling chandelier and a Sea
 * Hag's glare each do, and a reader wired into some of them would be a rule
 * that stops working on the rest. It is `standingReductionOf`'s shape: one
 * function, called wherever the moment happens.
 *
 * **"An enemy" is the *holder's* enemy, not the dealer's**, and the sentence
 * is what says so: the feature is written in the second person, "an enemy" has
 * no other referent in it, and the second half — "if **someone else** reduces
 * an enemy within 10 feet of **you**" — would otherwise mean an enemy of
 * whoever happened to swing. A charmed goblin cutting down the goblin beside
 * it drops the Warlock's enemy, and the Warlock is standing right there.
 *
 * **Hostility is the sides the table declared and nothing derived.** The
 * engine holds no notion of an enemy beyond `CreatureState.side`, which is
 * fiction and re-declarable, so a fall where either the holder's side or the
 * fallen creature's is unsaid pays nothing and **says so** — the reading a
 * size gate already takes, and the one thing here a caller may need to act
 * on. A creature on the holder's own side pays nothing and says nothing: the
 * rules answered.
 *
 * **The second sentence needs a map and the first does not.** A holder's own
 * kill pays wherever it happened; somebody else's pays only within the printed
 * distance of the *target*, which the scene answers. With no scene there are
 * no distances, so only the holder's own kills count — and that, and a
 * creature nobody has placed, are each reported rather than assumed.
 *
 * Nothing is spent and nothing is limited, because the sentence rations
 * nothing: a Warlock who drops four goblins in a round gains the points four
 * times, and `grantTemporaryHp` keeps the larger pool each time, which is the
 * SRD's own "you choose whether to keep the ones you have or gain the new
 * ones" made the only way it is ever made.
 */
export function rewardsForDropping(
  state: GameState,
  dropped: CharacterId,
  by: CharacterId | null,
): DropSpoils {
  // Nobody reduced anybody: a falling rock, a trap, a fire. Both halves of the
  // sentence name a creature doing it — "you reduce", "someone else reduces" —
  // and there is none.
  if (by === null) return NOTHING_GAINED;

  // Sorted, because this reaches a log that is compared byte for byte and the
  // order a record happens to have been built in is not a fact about the world.
  const watching = Object.keys(state.creatures)
    .sort()
    .map((who) => ({ who: who as CharacterId, creature: state.creatures[who as CharacterId]! }))
    .filter(({ creature }) => (creature.sheet.onDroppingAHostile?.length ?? 0) > 0);
  if (watching.length === 0) return NOTHING_GAINED;

  const victim = state.creatures[dropped];
  if (victim === undefined) return NOTHING_GAINED;

  const events: GameEvent[] = [];
  const unverified: string[] = [];
  for (const { who, creature } of watching) {
    for (const reward of creature.sheet.onDroppingAHostile ?? []) {
      // The reach first, so a holder the sentence never reached raises nothing
      // about a side nobody needed to declare.
      if (who !== by) {
        // "if someone else reduces an enemy within 10 feet of you": a
        // distance, and therefore a question only a scene can answer.
        if (reward.within === undefined) continue;
        if (state.scene === null) {
          unverified.push(
            `nobody has laid out a scene, so ${reward.name} could not tell whether ${who} was within ${reward.within} feet of ${dropped}; only their own kills counted`,
          );
          continue;
        }
        const apart = distanceBetween(state.scene, who, dropped);
        if (!apart.ok) {
          unverified.push(
            `${apart.reason}, so ${reward.name} could not tell whether ${who} was within ${reward.within} feet of ${dropped}`,
          );
          continue;
        }
        if (apart.value > reward.within) continue;
      }

      // And then whether what fell was an enemy **of this holder**.
      if (creature.side === null || victim.side === null) {
        const unsaid = creature.side === null ? who : dropped;
        unverified.push(
          `nobody has said whose side ${unsaid} is on, so ${reward.name} could not tell whether ${dropped} reaching 0 Hit Points was an enemy falling`,
        );
        continue;
      }
      if (creature.side === victim.side) continue;

      // The sheet as it stands, so an item setting the ability reaches this
      // the way it reaches every other modifier the engine derives.
      const sheet = sheetAsItStands(state, who) ?? creature.sheet;
      const amount = Math.max(
        reward.minimum,
        modifierFor(sheet, reward.ability) + reward.classLevel,
      );
      if (amount <= 0) continue;
      events.push({ type: 'temporary-hp-granted', id: who, amount, source: reward.name });
    }
  }
  return { events, unverified };
}
