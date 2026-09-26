/**
 * Getting up off the floor.
 *
 * > SRD Prone: "_Restricted Movement._ Your only movement options are to crawl
 * > or to spend an amount of movement equal to half your Speed (round down) to
 * > right yourself and thereby end the condition. If your Speed is 0, you
 * > can't right yourself."
 *
 * **The commonest legal act in the game, and there was no command for it.**
 * Every door that knocks a creature down has existed for batches — a Shove, a
 * Topple, a fall, a Gorgon's charge, Grease, Hideous Laughter — and the only
 * way back up was `liftConditionFrom`, which is a *DM's ruling*: it charges
 * nothing, it is not the creature's own act, and it makes standing up
 * something only the table can perform. So the price the glossary prints is
 * charged out of the same budget a walk comes out of, and the condition ends
 * through the door every condition ends by.
 *
 * **It is movement and not an action**, which is the whole of its economy: no
 * Action, no Bonus Action, no Reaction. It spends through `spendMovement`, so
 * a rule that has forbidden this creature's movement — SRD Tsunami's "it can't
 * move" — refuses it, and a rule that has only forbidden its *actions* does
 * not. Outside a fight there is no budget to draw on and the creature simply
 * stands, exactly as `resolveEffectCheck` spends no Action where there is no
 * economy.
 *
 * **The other half of the same sentence is not built, and this is the place to
 * say so.** SRD Crawling: "While you're crawling, each foot of movement costs
 * 1 extra foot (2 extra feet in Difficult Terrain)" — word for word the
 * sentence `wayOf` in `commands/movement.ts` already implements for an unaided
 * climb or swim, off a `surcharge` field that takes exactly the values it
 * would need. Nothing asks it of a Prone creature, so a Prone creature crawls
 * at full price today and getting up is the *dearer* of the two options rather
 * than the cheaper. Wiring the existing surcharge to `hasCondition(…,
 * 'prone')` is the whole of the fix and it is a movement-model change with its
 * own blast radius, so it is reported rather than smuggled in beside this.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { hasCondition, standingForbiddenBy } from '../conditions.js';
import { spendMovement } from '../combat.js';
import type { GameEvent, GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { actionRulesOn, speedOf } from '../standing.js';
import { endConditionsOn } from './conditions.js';
import { creatureOf, unknownCreature } from './command.js';
import { mayAct } from './holds.js';

/**
 * SRD's "an amount of movement equal to half your Speed (round down)".
 *
 * A function rather than an expression at the one call site, because the
 * refusal below quotes it too and a price computed twice is a price that can
 * disagree with the reason given for it.
 */
export const standingCost = (speed: number): number => Math.floor(speed / 2);

/**
 * Right yourself, ending the Prone condition.
 *
 * Every instance of it goes, and no source is named: "thereby end the
 * condition" is the glossary's own phrasing of what `endConditionsOn` does
 * with no source — a creature knocked down by a Shove *and* standing in Grease
 * is not half-upright, and the same reading Lay On Hands and Lesser
 * Restoration already take of a condition with two causes.
 */
export function standUp(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `stand-up:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (!hasCondition(creature.conditions, 'prone')) {
      return err('not_prone', `${id} is not Prone, and there is nothing to get up from`);
    }

    // **A spell that says so, read off the instance rather than off a
    // catalogue.** SRD Hideous Laughter: "it can't end the Prone condition on
    // itself." The mark travels on the condition instance the casting
    // imposed, so it lifts with the casting and the fold opens no book.
    const forbidding = standingForbiddenBy(creature.conditions);
    if (forbidding !== null) {
      return err(
        'cannot_stand',
        `${forbidding} forbids ${id} to end the Prone condition on itself`,
      );
    }

    // SRD: "If your Speed is 0, you can't right yourself." Asked of the Speed
    // the creature has **now** — Exhaustion, a Slow, a Grapple and every
    // feature grant folded in — because that is the number the sentence is
    // about, and it is the same number the price is half of.
    const speed = speedOf(state, id);
    if (speed <= 0) {
      return err(
        'cannot_stand',
        `${id} has a Speed of 0 and cannot right themselves; SRD leaves them crawling`,
      );
    }

    const cost = standingCost(speed);
    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[id] !== undefined) {
      const spent = spendMovement(state.combat, id, cost, speed, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;
      events.push({ type: 'movement-spent', id, feet: cost });
    }

    events.push(...endConditionsOn(id, ['prone'], undefined, stamp));
    return ok(events);
  });
}
