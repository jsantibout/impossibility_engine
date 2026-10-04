/**
 * **Harm that outlasts the fight** — M-LINGER.
 *
 * SRD Death Dog's Bite, SRD Mummy's Rotting Fist, SRD Otyugh's Bite and SRD
 * Incubus's Restless Touch each leave something behind that the fight's end
 * does not end: a maximum a Long Rest does not give back, a toll every 24
 * hours, a save every Long Rest throws, a Short Rest that pays nothing. One
 * record holds all of it (`LingeringHarm`, hosted by the curse or the
 * condition instance it lives exactly as long as), and this module is where it
 * is laid and where its clock is settled:
 *
 * - {@link lingeringHarmEvents} lays a harm — from the hit path for the
 *   Mummy's, the Incubus's and the Otyugh's lines, from the printed-save
 *   executor for the Death Dog's;
 * - {@link dailyTollsDue} and {@link settleDailyTolls} are the 24 hours: a debt
 *   the clock raises and the engine throws the dice for, on
 *   `settleBlockDeadlines`' pattern exactly — `resolveTurn` and `endRest`
 *   refuse while one is owed;
 * - {@link longRestTollEvents} is the Otyugh's save, thrown by `endRest` the
 *   moment a Long Rest is finished;
 * - {@link withheldBy} and {@link shortRestDeniedBy} are the two questions the
 *   rests ask.
 *
 * Nothing here names a monster: every number is the harm's, pinned when it was
 * laid.
 */

import { ABILITY_NAMES, type Ability, type CharacterId, err, ok, type Result } from '@ie/shared';
import type { PrintedLingering } from '@ie/srd';
import { rollSavingThrow } from '../checks.js';
import type { Rng } from '../dice.js';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { rollRecorded, type RollIssuer } from '../rolls.js';
import { sheetAsItStands } from '../standing.js';
import {
  type CreatureState,
  type LingeringAmount,
  type LingeringHarm,
  type LingeringHost,
  lingeringSource,
} from '../state.js';
import { recordD20Test, savingSupport } from './rolls.js';

/** What throwing a toll needs: dice, and nothing out of a catalogue. */
export interface TollSupply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
}

/** The harms standing on a creature, which is every one the fold has kept. */
const harmsOn = (creature: CreatureState | undefined): readonly LingeringHarm[] =>
  creature?.lingering ?? [];

/**
 * The events that lay a harm on a creature, and the healing rule it carries.
 *
 * **The toll's progress survives a second landing.** SRD's "every 24 hours
 * that elapse" counts from the curse, and a mummy that strikes a creature it
 * has already cursed has not started a new day: a harm under the same host
 * keeps the clock it had. Everything else is the line's, pinned again.
 *
 * "can't regain Hit Points" is the `prevented` healing rule every healing door
 * already reads, hung under the harm's own source so the harm's ending ends it
 * (`dropHostlessHarms`).
 */
export function lingeringHarmEvents(
  world: GameState,
  target: CharacterId,
  host: LingeringHost,
  by: CharacterId,
  line: string,
  lingers: PrintedLingering,
  /** The line's own save, which a toll that "repeats the save" throws. */
  save?: { readonly ability: Ability; readonly dc: number },
): readonly GameEvent[] {
  const source = lingeringSource(host);
  const standing = harmsOn(world.creatures[target]).find((one) => one.source === source);
  const amount = (printed: { readonly dice: string; readonly flat: number }): LingeringAmount => ({
    dice: printed.dice,
    flat: printed.flat,
  });
  const tolls = lingers.tolls;
  // A toll that "repeats the save" repeats the line's own, which only a
  // printed save's door holds: reaching here without one is a caller's
  // mistake, not a rule of the game.
  if (tolls?.repeatsSave === true && save === undefined) {
    throw new Error(`${line}'s toll repeats a save, and the caller laying it named none`);
  }
  const harm: LingeringHarm = {
    source,
    by,
    line,
    host,
    ...(lingers.withholdsMaximum === true ? { withholdsMaximum: true as const } : {}),
    ...(lingers.deniesShortRests === true ? { deniesShortRests: true as const } : {}),
    ...(tolls === undefined
      ? {}
      : {
          tolls: {
            from: standing?.tolls?.from ?? world.elapsed,
            everySeconds: tolls.everySeconds,
            paid: standing?.tolls?.paid ?? 0,
            ...(tolls.decreases === undefined ? {} : { decreases: amount(tolls.decreases) }),
            ...(tolls.repeatsSave === true && save !== undefined
              ? { save: { ability: save.ability, dc: save.dc } }
              : {}),
          },
        }),
    ...(lingers.atLongRest === undefined
      ? {}
      : {
          atLongRest: {
            ability: lingers.atLongRest.ability,
            dc: lingers.atLongRest.dc,
            decreases: amount(lingers.atLongRest.decreases),
          },
        }),
  };
  return [
    { type: 'lingering-harm-laid', id: target, harm },
    ...(lingers.preventsHealing === true
      ? [
          {
            type: 'healing-rule-granted' as const,
            id: target,
            rule: { source, rule: 'prevented' as const },
          },
        ]
      : []),
  ];
}

/** When a harm's next toll falls due, or null where it tolls nothing. */
const nextTollAt = (harm: LingeringHarm): number | null =>
  harm.tolls === undefined ? null : harm.tolls.from + (harm.tolls.paid + 1) * harm.tolls.everySeconds;

/** The harms on one creature whose toll the clock has passed. */
const dueOn = (state: GameState, creature: CreatureState | undefined): readonly LingeringHarm[] =>
  creature === undefined || creature.vitals.dead
    ? []
    : harmsOn(creature).filter((harm) => {
        const at = nextTollAt(harm);
        return at !== null && state.elapsed >= at;
      });

/**
 * Every creature owing a toll the clock has passed, alive, in id order —
 * SRD Mummy's "every 24 hours that elapse", SRD Death Dog's repeat save.
 *
 * **Derived from the world as it stands**, `blockDeadlinesDue`'s reading of
 * the same kind of debt: a corpse owes nothing, and a harm whose host has gone
 * is gone with it.
 */
export function dailyTollsDue(state: GameState): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[])
    .sort()
    .filter((who) => dueOn(state, state.creatures[who]).length > 0);
}

/** What settling the due tolls threw, and what each period cost. */
export interface DailyTollsSettled {
  readonly events: readonly GameEvent[];
  readonly duplicate: boolean;
}

/** The events that end a harm's host — a made save "ending the effect on itself". */
function endingTheHost(state: GameState, who: CharacterId, harm: LingeringHarm): readonly GameEvent[] {
  const host = harm.host;
  if (host.kind === 'curse') return [{ type: 'printed-curse-lifted', id: who, source: host.source }];
  const instance = state.creatures[who]?.conditions.instances.find((one) => one.id === host.instance);
  return instance === undefined
    ? []
    : [{ type: 'condition-removed', id: who, condition: instance.condition, source: instance.source }];
}

/** The condition a harm lives as long as, for the save that would end it. */
const hostCondition = (state: GameState, who: CharacterId, harm: LingeringHarm) => {
  const host = harm.host;
  if (host.kind !== 'condition') return undefined;
  return state.creatures[who]?.conditions.instances.find((one) => one.id === host.instance)?.condition;
};

/**
 * One save against a harm, thrown through the pipeline every save goes
 * through — the creature's own sheet, its standing modes and bonuses, and
 * what the save is about, so SRD Dwarven Resilience's "Advantage on saving
 * throws you make to avoid or end the Poisoned condition" reaches it.
 */
function saveAgainst(
  state: GameState,
  who: CharacterId,
  harm: LingeringHarm,
  save: { readonly ability: Ability; readonly dc: number },
  supply: TollSupply,
  label: string,
): Result<{ readonly event: GameEvent; readonly success: boolean }> {
  const creature = state.creatures[who];
  if (creature === undefined) return err('unknown_creature', `${who} is not in this game`);
  const sheet = sheetAsItStands(state, who) ?? creature.sheet;
  const about = hostCondition(state, who, harm);
  const support = savingSupport(
    state,
    who,
    creature,
    save.ability,
    {},
    about === undefined ? [] : [about],
    false,
    false,
    harm.by,
  );
  const rolled = rollSavingThrow(supply.issuer, supply.rng, sheet, save.ability, {
    dc: save.dc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
  });
  if (!rolled.ok) return rolled;
  return ok({
    event: recordD20Test(
      who,
      `${ABILITY_NAMES[save.ability]} save vs ${harm.line} (${label}, DC ${save.dc})`,
      rolled.value,
      rolled.value.success ? `${harm.line} ends` : `${harm.line} goes on`,
    ),
    success: rolled.value.success,
  });
}

/** What a toll's dice took off the maximum, as the event that records the throw. */
function decreaseBy(
  who: CharacterId,
  harm: LingeringHarm,
  amount: LingeringAmount,
  supply: TollSupply,
  label: string,
): Result<{ readonly event: GameEvent; readonly total: number }> {
  const rolled = rollRecorded(supply.issuer, supply.rng, amount.dice);
  if (!rolled.ok) return rolled;
  const total = rolled.value.total + amount.flat;
  return ok({
    event: {
      type: 'roll-recorded',
      who,
      label: `${harm.line}: ${label} (${amount.dice}${amount.flat === 0 ? '' : ` + ${amount.flat}`})`,
      natural: rolled.value.total,
      total,
      contributions: amount.flat === 0 ? [] : [{ source: harm.line, amount: amount.flat }],
      outcome: `Hit Point maximum decreases by ${total}`,
    },
    total,
  });
}

/** One period of one harm's toll, thrown and written down. */
function payOneToll(
  state: GameState,
  who: CharacterId,
  harm: LingeringHarm,
  supply: TollSupply,
): Result<readonly GameEvent[]> {
  const tolls = harm.tolls!;
  const day = tolls.paid + 1;
  const label = `day ${day}`;
  const issuedBefore = supply.issuer.count;
  const thrown: GameEvent[] = [];

  let ends = false;
  if (tolls.save !== undefined) {
    const saved = saveAgainst(state, who, harm, tolls.save, supply, label);
    if (!saved.ok) return saved;
    thrown.push(saved.value.event);
    ends = saved.value.success;
  }
  let lowered = 0;
  if (!ends && tolls.decreases !== undefined) {
    const cut = decreaseBy(who, harm, tolls.decreases, supply, label);
    if (!cut.ok) return cut;
    thrown.push(cut.value.event);
    lowered = cut.value.total;
  }
  if (supply.issuer.count > issuedBefore) {
    thrown.push({ type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() });
  }

  // The count first: a made save ends the host, and the harm goes with it in
  // the very next derived pass — after which there is no toll to count.
  return ok([
    ...thrown,
    { type: 'daily-toll-paid', id: who, source: harm.source, day },
    // **Sourced to the day**, so it is a lowering with no lifetime of its own:
    // it comes back at a Long Rest once nothing withholds it, which is what SRD
    // Death Dog and SRD Mummy both say by saying when it does not.
    ...(lowered > 0
      ? [
          {
            type: 'hit-point-maximum-adjusted' as const,
            id: who,
            adjustment: { source: `${harm.source}:day-${day}`, amount: -lowered },
          },
        ]
      : []),
    ...(ends ? endingTheHost(state, who, harm) : []),
  ]);
}

/**
 * Throw every toll the clock has passed — one period at a time, in id order,
 * until nothing is owed.
 *
 * SRD Mummy: "its Hit Point maximum decreases by 10 (3d6) every 24 hours that
 * elapse." SRD Death Dog: "it repeats the save every 24 hours that elapse,
 * ending the effect on itself on a success. _Subsequent Failures:_ The
 * Poisoned target's Hit Point maximum decreases by 5 (1d10)." The dice are
 * the engine's, out of the generator and recorded; three days passed at once
 * are three periods, each thrown in turn, and a made save on the second ends
 * the third before it is owed.
 *
 * **Refused without a generator** where a throw is owed, and **an empty batch**
 * where nothing is due — `settleBlockDeadlines`' two answers, for its reason.
 */
export function settleDailyTolls(
  state: GameState,
  supply: TollSupply | undefined,
  command: CommandIdentity = {},
): Result<DailyTollsSettled> {
  return once(state, 'settle-daily-tolls', { ...command }, () => ({ events: [], duplicate: true }), (stamp) => {
    if (dailyTollsDue(state).length === 0) return ok({ events: [], duplicate: false });
    if (supply === undefined) {
      return err(
        'daily_toll_owed',
        `${dailyTollsDue(state).join(', ')} owe the toll a lingering harm takes every period; settling it needs a generator to throw the dice`,
      );
    }

    const events: GameEvent[] = [];
    let current = state;
    for (;;) {
      const who = dailyTollsDue(current)[0];
      if (who === undefined) break;
      const harm = [...dueOn(current, current.creatures[who])].sort((a, b) =>
        a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
      )[0]!;
      const paid = payOneToll(current, who, harm, supply);
      if (!paid.ok) return paid;
      events.push(...paid.value);
      current = paid.value.reduce(applyEvent, current);
    }
    return ok({ events: stamped(events, stamp), duplicate: false });
  });
}

/** The stamp rides the first die's record, the one event a settlement is certain to write. */
function stamped(events: readonly GameEvent[], stamp: CommandStamp | null): readonly GameEvent[] {
  if (stamp === null) return events;
  let placed = false;
  return events.map((event) => {
    if (placed || event.type !== 'roll-recorded') return event;
    placed = true;
    return { ...event, command: stamp };
  });
}

/**
 * The saves a finished Long Rest throws, and what each costs — SRD Otyugh:
 * "Whenever the Poisoned target finishes a Long Rest, it is subjected to the
 * following effect. _Constitution Saving Throw:_ DC 15. _Failure:_ The target's
 * Hit Point maximum decreases by 5 (1d10) and doesn't return to normal until
 * the Poisoned condition ends on the target. _Success:_ The Poisoned condition
 * ends."
 *
 * **The failure's lowering is filed under the harm's own source**, which is
 * the whole of "doesn't return to normal until the Poisoned condition ends":
 * the fold releases it the moment the harm goes, and the Long Rest leaves it
 * alone while the harm stands. A second failure adds to it rather than
 * replacing it, because the record is source-keyed and the sentence is
 * cumulative — the event carries the sum.
 *
 * Empty where nothing is owed; refused without a generator where something is.
 */
export function longRestTollEvents(
  state: GameState,
  who: CharacterId,
  supply: TollSupply | undefined,
): Result<readonly GameEvent[]> {
  const owing = harmsOn(state.creatures[who]).filter((harm) => harm.atLongRest !== undefined);
  if (owing.length === 0) return ok([]);
  if (supply === undefined) {
    return err(
      'no_generator',
      `${who} finishing a Long Rest throws the save ${owing.map((harm) => harm.line).join(', ')} prints, which needs a generator`,
    );
  }

  const events: GameEvent[] = [];
  let current = state;
  for (const harm of owing) {
    const toll = harm.atLongRest!;
    const issuedBefore = supply.issuer.count;
    const saved = saveAgainst(current, who, harm, toll, supply, 'a Long Rest');
    if (!saved.ok) return saved;
    const thrown: GameEvent[] = [saved.value.event];
    let after: GameEvent[] = [];
    if (saved.value.success) {
      after = [...endingTheHost(current, who, harm)];
    } else {
      const cut = decreaseBy(who, harm, toll.decreases, supply, 'a Long Rest');
      if (!cut.ok) return cut;
      thrown.push(cut.value.event);
      const held =
        current.creatures[who]?.hitPointMaxima.find((one) => one.source === harm.source)?.amount ?? 0;
      after = [
        {
          type: 'hit-point-maximum-adjusted',
          id: who,
          adjustment: { source: harm.source, amount: held - cut.value.total },
        },
      ];
    }
    thrown.push({ type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() });
    const made = [...thrown, ...after];
    events.push(...made);
    current = made.reduce(applyEvent, current);
  }
  return ok(events);
}

/** The harm keeping this creature's lowered maximum through a Long Rest, or null. */
export function withheldBy(creature: CreatureState): LingeringHarm | null {
  return harmsOn(creature).find((harm) => harm.withholdsMaximum === true) ?? null;
}

/** The harm denying this creature a Short Rest's benefit, or null. */
export function shortRestDeniedBy(creature: CreatureState): LingeringHarm | null {
  return harmsOn(creature).find((harm) => harm.deniesShortRests === true) ?? null;
}

/** The sources a standing harm files a lowering under — a lifetime of its own. */
export function harmSourcesOn(creature: CreatureState): ReadonlySet<string> {
  return new Set(harmsOn(creature).map((harm) => harm.source));
}

/** Whether this creature owes a toll right now. */
export function owesDailyToll(state: GameState, who: CharacterId): boolean {
  return dueOn(state, state.creatures[who]).length > 0;
}
