import { err, needsContext, ok, type CharacterId, type Result } from '@ie/shared';
import { abilityModifier } from './character.js';
import { HOUR, hours } from './time.js';
import type { Rng } from './dice.js';
import { timerKey } from './timers.js';
import type { GameEvent, GameState } from './events.js';
import { once } from './idempotency.js';
import { remaining } from './resources.js';
import { rollRecorded, type RollIssuer } from './rolls.js';

/**
 * Short and Long Rests.
 *
 * Two things make this more than a pair of "restore everything" buttons.
 *
 * **A rest is a span, not a moment.** It starts, time passes, and it ends — so
 * the engine can tell a completed rest from an abandoned one, and can apply
 * the rule that turns a Long Rest broken after an hour into a Short Rest
 * rather than into nothing.
 *
 * **The engine notices its own interruptions.** SRD lists four, three of which
 * the engine can actually see: rolling Initiative, casting a spell other than
 * a cantrip, and taking any damage. Those mark the rest as they happen, so
 * ending it reads what occurred rather than asking the caller to report it. A
 * caller who had to report them would eventually miss one, and the party would
 * collect a rest the rules had already broken. The fourth — "1 hour of walking
 * or other physical exertion" — is fiction the engine cannot see, so that one
 * is passed in.
 */

/** SRD: "A Short Rest is a 1-hour period of downtime". */
export const SHORT_REST = HOUR;
/** SRD: "a period of extended downtime—at least 8 hours". */
export const LONG_REST = hours(8);
/** SRD: "you must wait at least 16 hours before starting another one." */
export const LONG_REST_COOLDOWN = hours(16);

export type RestKind = 'short' | 'long';

export interface RestState {
  readonly kind: RestKind;
  /** Clock reading when it began. */
  readonly startedAt: number;
  /** What broke it off, set by the rules as it happened. */
  readonly interruptedBy: string | null;
  /**
   * The clock reading when it broke off.
   *
   * SRD pays out on the time rested *before the interruption*, so the moment
   * matters and not just the fact. Without it, ten minutes of sleep followed
   * by an hour of standing around counted as seventy minutes of rest.
   */
  readonly interruptedAt: number | null;
}

/** What a rest actually earned, which is not always what was attempted. */
export type RestBenefit = 'none' | 'short' | 'long';

function restRequires(kind: RestKind): number {
  return kind === 'short' ? SHORT_REST : LONG_REST;
}

/**
 * What a rest ending at this moment would grant.
 *
 * SRD: "An interrupted Short Rest confers no benefits", but for a Long Rest,
 * "If you rested at least 1 hour **before the interruption**, you gain the
 * benefits of a Short Rest."
 *
 * Before the interruption. Time spent lying there afterwards is not rest —
 * the rest was over the moment it broke — so this measures to
 * `interruptedAt`, not to `now`. Reading total elapsed time instead paid out a
 * Short Rest for ten minutes of sleep and an hour of waiting around.
 */
export function restEarned(rest: RestState, now: number): RestBenefit {
  if (rest.interruptedBy !== null) {
    if (rest.kind === 'short') return 'none';
    const rested = (rest.interruptedAt ?? now) - rest.startedAt;
    return rested >= SHORT_REST ? 'short' : 'none';
  }
  return now - rest.startedAt >= restRequires(rest.kind) ? rest.kind : 'none';
}

const HIT_DIE_PREFIX = 'hit-die:';
/** The die sizes the game uses: characters take d6 to d12, monsters d4 and d20. */
const HIT_DIE_SIDES = new Set([4, 6, 8, 10, 12, 20]);

/**
 * Hit Dice are a resource pool like any other, tagged `long-rest`.
 *
 * The pool's key carries the die size because nothing else knows it: a
 * character sheet has a level but no class, and the class table that says a
 * Wizard takes d6s is not modelled. Declared, never derived — same rule as
 * every other pool.
 */
export function hitDieKey(sides: number): string {
  if (!HIT_DIE_SIDES.has(sides)) {
    throw new Error(`a Hit Die is a d4, d6, d8, d10, d12 or d20, got d${sides}`);
  }
  return `${HIT_DIE_PREFIX}d${sides}`;
}

/** The die size a pool key names, or null if the key is some other pool. */
export function hitDieSides(key: string): number | null {
  if (!key.startsWith(`${HIT_DIE_PREFIX}d`)) return null;
  const sides = Number(key.slice(HIT_DIE_PREFIX.length + 1));
  return HIT_DIE_SIDES.has(sides) ? sides : null;
}

const creatureOf = (state: GameState, id: CharacterId) => state.creatures[id] ?? null;

/**
 * Begin a rest.
 *
 * SRD: "To start a Short Rest, you must have at least 1 Hit Point", and the
 * same for a Long Rest. A creature at 0 is making death saves, not resting.
 */
export function beginRest(
  state: GameState,
  id: CharacterId,
  kind: RestKind,
  commandId?: string,
): Result<GameEvent[]> {
  // The same identity check the casting commands use. A bare "have I seen this
  // id" test returned an empty success for *any* previously used id — another
  // creature's rest, a different kind of rest — which is the silent no-op an
  // idempotency key exists to avoid.
  // Named rather than inlined so the kind travels into the fingerprint: two
  // rests differing only in kind must not share an id.
  const inputs: { commandId?: string; kind: RestKind } =
    commandId === undefined ? { kind } : { commandId, kind };
  return once(state, `rest:${id}`, inputs, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);
    if (creature.vitals.dead) return err('dead', `${id} is dead and is past resting`);
    if (creature.vitals.hp < 1) {
      return err('no_hit_points', `${id} needs at least 1 hit point to start a rest`);
    }
    if (creature.resting !== null) {
      return err('already_resting', `${id} is already taking a ${creature.resting.kind} rest`);
    }

    if (kind === 'long' && creature.lastLongRestAt !== null) {
      const since = state.elapsed - creature.lastLongRestAt;
      if (since < LONG_REST_COOLDOWN) {
        return err(
          'too_soon',
          `${id} finished a Long Rest ${since} seconds ago and must wait ${LONG_REST_COOLDOWN}`,
        );
      }
    }

    return ok([
      { type: 'rest-begun', id, kind, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/** One Hit Die spent, and what it gave back. */
export interface HitDieSpent {
  readonly key: string;
  readonly sides: number;
  /** What the die showed. */
  readonly natural: number;
  /** The die plus Constitution, never below 1. */
  readonly regained: number;
}

export interface RestOptions {
  /** Hit Dice to spend, by pool key. Only a Short Rest offers this. */
  readonly hitDice?: readonly string[];
  /** An interruption the engine cannot see, such as an hour of hard walking. */
  readonly interrupted?: string;
}

export interface HitDiceSupply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
}

export interface RestResolution {
  readonly events: readonly GameEvent[];
  readonly benefit: RestBenefit;
  readonly hitDice: readonly HitDieSpent[];
  readonly hitPointsRegained: number;
}

/**
 * End a rest and grant exactly what it earned.
 *
 * The engine decides the benefit from the clock and from the interruptions it
 * recorded as they happened — a completed Long Rest, a Long Rest broken after
 * three hours (a Short Rest), a Short Rest broken at all (nothing). The caller
 * says only what the engine could not see.
 */
export function endRest(
  state: GameState,
  id: CharacterId,
  options: RestOptions = {},
  supply?: HitDiceSupply,
): Result<RestResolution> {
  const creature = creatureOf(state, id);
  if (creature === null) return needsContext('unknown_creature', `${id} is not in this game`);

  const rest = creature.resting;
  if (rest === null) return err('not_resting', `${id} is not resting`);

  const interrupted = rest.interruptedBy ?? options.interrupted ?? null;
  // An interruption the engine could not see happens when it is reported;
  // one it saw for itself carries the moment it actually happened.
  const interruptedAt =
    rest.interruptedBy !== null ? rest.interruptedAt : interrupted === null ? null : state.elapsed;
  const benefit = restEarned(
    { ...rest, interruptedBy: interrupted, interruptedAt },
    state.elapsed,
  );
  const elapsed = state.elapsed - rest.startedAt;

  // Nothing interrupted it and it has not run its course, so it is not over.
  // Ending it here would quietly grant nothing for a rest still in progress.
  if (benefit === 'none' && interrupted === null) {
    return err(
      'rest_incomplete',
      `${id} has rested ${elapsed} of the ${restRequires(rest.kind)} seconds a ${rest.kind} rest takes`,
    );
  }

  const requested = options.hitDice ?? [];
  const events: GameEvent[] = [];
  const spent: HitDieSpent[] = [];
  /**
   * The requested dice, with the size the validation pass read off each key.
   *
   * Carried forward rather than looked up again in the rolling loop below,
   * where a second `hitDieSides` could only ever answer what this one already
   * has — so its refusal was a `bad_hit_die` nothing could reach, spelled
   * identically to the live one. Two sites for one rule is two places to get
   * it wrong, and the dead one is the one nobody would notice changing.
   */
  const dice: { readonly key: string; readonly sides: number }[] = [];

  // SRD: spending Hit Point Dice is a benefit of a Short Rest. A completed
  // Long Rest restores hit points and Hit Dice outright, so spending them
  // there would be burning a resource the rest is about to hand back.
  if (requested.length > 0) {
    if (benefit !== 'short') {
      return err(
        'no_hit_dice_here',
        benefit === 'long'
          ? 'a completed Long Rest restores hit points and Hit Dice; there is nothing to spend them on'
          : 'a rest that earned nothing offers no Hit Dice',
      );
    }
    if (supply === undefined) {
      return err('no_generator', 'spending a Hit Die rolls it, which needs a generator');
    }

    // Validate every die before rolling any: a request for more dice than are
    // left must cost neither a die nor a turn of the generator.
    const needed = new Map<string, number>();
    for (const key of requested) {
      const sides = hitDieSides(key);
      if (sides === null) return err('bad_hit_die', `${key} is not a Hit Die pool`);
      dice.push({ key, sides });
      needed.set(key, (needed.get(key) ?? 0) + 1);
    }
    for (const [key, count] of needed) {
      const left = remaining(creature.resources, key);
      if (left < count) {
        return err('not_enough_hit_dice', `${id} has ${left} ${key} left, and asked to spend ${count}`);
      }
    }
  }

  switch (benefit) {
    case 'none':
      break;

    case 'short': {
      events.push({ type: 'resources-restored', id, recovers: 'short-rest' });

      if (requested.length > 0 && supply !== undefined) {
        const constitution = abilityModifier(creature.sheet.abilities.con);
        const issuedBefore = supply.issuer.count;
        let regained = 0;

        for (const { key, sides } of dice) {
          const rolled = rollRecorded(supply.issuer, supply.rng, `1d${sides}`);
          if (!rolled.ok) return rolled;

          // SRD: "You regain Hit Points equal to the total (minimum of 1)."
          const natural = rolled.value.total;
          const gain = Math.max(1, natural + constitution);
          regained += gain;
          spent.push({ key, sides, natural, regained: gain });

          events.push(
            { type: 'resource-spent', id, key, amount: 1 },
            {
              type: 'roll-recorded',
              who: id,
              label: `Hit Die (d${sides})`,
              natural,
              total: natural + constitution,
              contributions: [{ source: 'Constitution', amount: constitution }],
              outcome: `${gain} hit points`,
            },
          );
        }

        events.push({
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        });
        if (regained > 0) events.push({ type: 'healed', id, amount: regained });
      }
      break;
    }

    case 'long': {
      // SRD: "You regain all lost Hit Points and all spent Hit Point Dice."
      const missing = creature.vitals.hpMax - creature.vitals.hp;
      if (missing > 0) events.push({ type: 'healed', id, amount: missing });

      // SRD: "Temporary Hit Points last until they're depleted or you finish a
      // Long Rest." They are not hit points and healing does not touch them,
      // so the rest has to clear them itself.
      //
      // **And whether or not a deadline was ever hung on them.** The owner's
      // ruling of 2026-09-18 makes the rest the end of the default lifetime
      // *and* the outer bound of a stated one: a stated duration says when
      // they run out earlier, never that they survive the night. So the event
      // goes out for a standing deadline as well as for a live pool — the
      // fold drops the deadline with the points, and a pool already spent to
      // nothing would otherwise leave its hour behind to come due over
      // whatever the creature is holding by then.
      if (
        creature.vitals.temporaryHp > 0 ||
        state.timers[timerKey({ kind: 'temporary-hit-points', on: id })] !== undefined
      ) {
        events.push({ type: 'temporary-hp-cleared', id });
      }

      // A feature that recharges on a Short Rest recharges on a Long one too,
      // so both tags fire. The pool says which it is; the rest does not guess.
      events.push(
        { type: 'resources-restored', id, recovers: 'short-rest' },
        { type: 'resources-restored', id, recovers: 'long-rest' },
      );

      // SRD: "If you have the Exhaustion condition, its level decreases by 1."
      if (creature.conditions.exhaustion > 0) {
        events.push({
          type: 'exhaustion-set',
          id,
          level: creature.conditions.exhaustion - 1,
        });
      }
      break;
    }
  }

  events.push({
    type: 'rest-ended',
    id,
    kind: rest.kind,
    benefit,
    ...(interrupted === null ? {} : { interrupted }),
  });

  return ok({
    events,
    benefit,
    hitDice: spent,
    hitPointsRegained: spent.reduce((total, die) => total + die.regained, 0),
  });
}
