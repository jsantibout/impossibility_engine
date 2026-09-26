/**
 * The one effect kind decided by a die that is not a d20.
 *
 * SRD Augury: "there is a **cumulative 25 percent chance for each casting
 * after the first** that you get no answer." A percentage is a number the book
 * printed and the engine throws a hundred-sided die against; there is no
 * ability, no modifier, no mode and no DC, so none of the D20 pipeline applies
 * and none of it is reached for.
 *
 * **Its own module rather than a fourth kind in `spell-effect-rolls.ts`**,
 * whose three are the kinds that host an outcome and whose fourth is the
 * damage they all deal. This deals none and hosts none: what it decides is
 * whether the casting's printed handover goes out at all.
 *
 * **Half of it was already built for items.** SRD Wind Fan prints the same
 * sentence — "a cumulative 20 percent chance of not working" — and
 * `ItemCastsGrant.failsCumulatively` says so, counted by {@link tallied} and
 * multiplied by {@link cumulativeChance}. What this file adds is the *spell's*
 * half, and what the two genuinely share is one function: the die and the line
 * it writes in the log.
 */

import { ok, type CharacterId, type Result } from '@ie/shared';
import { cumulativeChance } from '../catalogue.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { tallied } from '../resources.js';
import { rollRecorded } from '../rolls.js';
import { handedOver } from '../spell-definitions.js';
import { type Supply } from './casting.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/** SRD writes these chances as percentages, so the die has a hundred faces. */
export const FAILURE_DIE = '1d100';

/**
 * A printed percentage, thrown and recorded.
 *
 * **A percentage is the chance of *failing*, so the roll fails at or under
 * it** — and a hundred takes every face of the die, which is what the sixth
 * wave of a Wind Fan is. The comparison is here, once, because getting it
 * backwards is a silent inversion rather than a crash: both callers would go
 * on working and both would be wrong in the same direction.
 *
 * **It does not decide whether to throw.** The zero rule — no die for a chance
 * of nothing — stays with each caller, because each has something else to do
 * on that branch: the item's use still counts and still costs no action, and a
 * casting's first Augury still hands its omen over. A helper that returned
 * "nothing happened" would have both callers ask the same question again to
 * find out which kind of nothing it was.
 *
 * **No `rolls-issued` here either**, and that is the difference between the
 * two callers rather than an omission: `runEffects` writes one for the whole
 * batch of an effect list, and `itemFailure` runs outside it and writes its
 * own. Two would be two claims about one generator.
 */
export function thrownAgainst(
  supply: Supply,
  who: CharacterId,
  label: string,
  chance: number,
  outcomes: { readonly failed: string; readonly held: string },
): Result<{ readonly failed: boolean; readonly recorded: GameEvent }> {
  const thrown = rollRecorded(supply.issuer, supply.rng, FAILURE_DIE);
  if (!thrown.ok) return thrown;
  const failed = thrown.value.total <= chance;
  return ok({
    failed,
    recorded: {
      type: 'roll-recorded',
      who,
      label: `${label} (${FAILURE_DIE} against ${chance}%)`,
      natural: thrown.value.total,
      total: thrown.value.total,
      contributions: [],
      outcome: failed ? outcomes.failed : outcomes.held,
    },
  });
}

/**
 * What this casting's chance of failing currently is, and what counts it.
 *
 * Two forms and one answer. A flat percentage is the same number every time —
 * SRD Gust of Wind's 50, Sending's 5 — and counts nothing, because there is
 * nothing for a count to change. Augury's form is the cumulative one: the
 * count of castings that have gone before, times what each adds, capped at a
 * hundred by {@link cumulativeChance}.
 *
 * Read off the world this effect is landing in rather than off `ctx.caster`,
 * so a casting settled a minute after it was declared counts the castings that
 * really have happened.
 */
function chanceOf(
  effect: EffectOfKind<'chance'>,
  state: GameState,
  casterId: CharacterId,
): { readonly chance: number; readonly counted: GameEvent | null } {
  const printed = effect.percent;
  if (typeof printed === 'number') return { chance: printed, counted: null };
  const held = state.creatures[casterId];
  const used = held === undefined ? 0 : tallied(held.resources, printed.countedBy.key);
  return {
    chance: cumulativeChance(printed.perPriorCasting, used),
    // **The use is counted whether it works or not**, because the book counts
    // castings rather than failures — and the count is a tally rather than a
    // pool, so there is nothing here that can refuse. The tag rides the event
    // because nothing declares a tally; see `Tally` in `resources.ts`.
    counted: {
      type: 'resource-spent',
      id: casterId,
      key: printed.countedBy.key,
      amount: 1,
      tally: printed.countedBy.recovers,
    },
  };
}

/**
 * A casting that may simply not work, and what a failure costs.
 *
 * **The action economy and the slot are already settled when this runs**,
 * which is the rule `itemFailure`'s docstring draws for the item half: a
 * failure is an outcome rather than a refusal that arrived late. For a casting
 * the pipeline draws it for free — `resolveSpell` validates the caster, the
 * route, the slot, the action, the targets and the range before a single
 * resolver runs — so there is nothing to ask here.
 *
 * **The die is not thrown when the chance is zero.** SRD's "each casting after
 * the first" makes the first casting a decided outcome, and a die thrown for a
 * decided outcome moves the generator for nothing. That is the quiet way a
 * replay stops matching, and it is the same rule `declareDawn` keeps for a
 * pool with nothing spent.
 *
 * **What a failure costs is the handover**, which is the whole of
 * `onFailure: 'no-answer'` — and it costs it in **this resolution** rather
 * than everywhere the text has ever appeared. Be exact about what that means,
 * because a spell of a minute reports twice:
 *
 * - The **declaration** handed the text over a minute ago, into its own
 *   caller's `unverified` and pinned onto `spell-declared` for the fold. Both
 *   stand, and both are true of the moment they record: the caster began a
 *   rite that asks the table a question.
 * - The **settlement** gets a fresh copy of that list, and this is where the
 *   die finally falls. The failure takes the lines back out of that copy and
 *   says why instead, so the resolution the caller acts on reports no omen.
 *
 * The alternative was to hold every handover in the book back until every
 * effect had run, which moves one spell's rule into the pipeline every spell
 * goes through — and it would *still* have left the pinned event standing,
 * because that is written before any effect resolves. Trimming the
 * settlement's own list is the narrower change and reports the truth the
 * settlement is reporting.
 *
 * **It ends nothing and refuses nothing.** The spell was cast, the slot is
 * gone and the minute was spent; SRD says the caster gets no answer, not that
 * the casting did not happen. A refusal here would hand the slot back.
 */
export function resolveChanceEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'chance'>,
  world: GameState,
): Result<GameState> {
  const { casterId, name, supply, events, unverified, outcomes } = ctx;
  const { definition } = ctx.casting();

  // SRD Sending's "if the target is on a different plane than you": a die the
  // sentence gates on a fact only the table can declare, stated on the request
  // and refused at the pre-flight for a spell that prints no such clause. Not
  // stated, no die and no count — the generator does not move for an outcome
  // the sentence has already decided. (W7-S19)
  if (effect.onlyIf === 'other-plane' && ctx.otherPlane !== true) {
    outcomes.push({ target: casterId, affected: false });
    return ok(world);
  }

  let current = world;
  const { chance, counted } = chanceOf(effect, current, casterId);
  if (counted !== null) {
    events.push(counted);
    current = applyEvent(current, counted);
  }

  // **An outcome either way**, and the affirmative one is the *failure*: what
  // this effect can do to the caster is take their answer away, so a chance
  // that held did nothing to anybody and says so. The same reading
  // `save-damage` gives a creature that made its save.
  const report = (failed: boolean): void => {
    outcomes.push({ target: casterId, affected: failed });
  };

  if (chance <= 0) {
    report(false);
    return ok(current);
  }

  const thrown = thrownAgainst(supply, casterId, `${name} works`, chance, {
    failed: 'no answer',
    held: 'an answer',
  });
  if (!thrown.ok) return thrown;
  events.push(thrown.value.recorded);

  if (!thrown.value.failed) {
    report(false);
    return ok(current);
  }

  // The lines this very definition handed over, removed by the text they were
  // written from rather than by position: `unverified` also carries the
  // spell's `unmodelled` debts and whatever a ward or a sight question added,
  // and none of those stopped being true.
  const withheld = new Set((definition.dmDecides ?? []).map((printed) => handedOver(name, printed)));
  for (let at = unverified.length - 1; at >= 0; at -= 1) {
    if (withheld.has(unverified[at]!)) unverified.splice(at, 1);
  }
  unverified.push(
    `${name}: no answer — the casting fell under its ${chance}% chance of failing, so what the spell prints for the table is not handed over`,
  );

  report(true);
  return ok(current);
}
