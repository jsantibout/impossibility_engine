/**
 * What every seam of the fold reaches for.
 *
 * Two things, and they are here because more than one seam needs them rather
 * than because they had nowhere else to go.
 *
 * **The corrupt-log backstop and the accessors that throw it.** A reducer
 * failure means the log and the code disagree, so it throws rather than
 * degrading — and `creatureOf`, `sceneOf`, `combatOf` and `must` are the four
 * places that discover the disagreement. They are one family with one
 * exception, and separating them would put the throw a module away from every
 * thrower.
 *
 * **The two sort helpers**, which are what makes a fold byte-identical
 * whatever order effects were applied in. `sortedRecord` alone crosses three
 * seams — the turn boundary, the area detectors and the switch — which is the
 * evidence this module is shared rather than a drawer.
 */
import type { Content } from '../content.js';
import type { CharacterId } from '@ie/shared';
import { ROUND } from '../clock.js';
import { type TimedEffect } from '../duration.js';
import { type CombatState } from '../combat.js';
import { type PositionState } from '../positioning.js';

import type { GameEvent } from '../events.js';
import type { CreatureState, GameState } from '../state.js';

/**
 * A log that cannot be applied is corrupt, not a rules dispute.
 *
 * Rules-legal refusals never become events: the command layer asks the engine
 * first and emits nothing if the answer is no. So by the time an event exists
 * it has already been validated, and a failure here means the log and the code
 * disagree — which should be loud.
 */
export class CorruptLogError extends Error {
  constructor(event: GameEvent, reason: string) {
    super(`cannot apply ${event.type}: ${reason}`);
    this.name = 'CorruptLogError';
  }
}

/**
 * Install a new combat state and charge the clock for any rounds it crossed.
 *
 * SRD: "A round represents about 6 seconds in the game world." A round ends
 * when the Initiative order wraps — and `advanceTurn` is not the only thing
 * that wraps it. Removing the combatant who was acting, when they were last in
 * the order, also starts a new round. That path used to change the round and
 * not the clock, so a fight where enemies died on their own turns ran fast:
 * rounds ticked by and game time did not.
 *
 * One place, applied to every transition, so the two can never disagree again.
 * Transitions that do not cross a round cost nothing, which is most of them.
 */
export const withCombat = (next: GameState, state: GameState, combat: CombatState): GameState => ({
  ...next,
  combat,
  elapsed: state.elapsed + Math.max(0, combat.round - (state.combat?.round ?? combat.round)) * ROUND,
});

export const creatureOf = (state: GameState, event: GameEvent, id: CharacterId): CreatureState => {
  const creature = state.creatures[id];
  if (creature === undefined) throw new CorruptLogError(event, `${id} is not in this game`);
  return creature;
};

export const withCreature = (
  state: GameState,
  id: CharacterId,
  patch: Partial<CreatureState>,
  creature: CreatureState,
): GameState => ({
  ...state,
  creatures: { ...state.creatures, [id]: { ...creature, ...patch } },
});

export const sceneOf = (state: GameState, event: GameEvent): PositionState => {
  if (state.scene === null) throw new CorruptLogError(event, 'no scene has been set');
  return state.scene;
};

export const combatOf = (state: GameState, event: GameEvent): CombatState => {
  if (state.combat === null) throw new CorruptLogError(event, 'no combat is running');
  return state.combat;
};

/** Unwrap an engine Result, treating a refusal as a corrupt log. */
export function must<T>(event: GameEvent, result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new CorruptLogError(event, result.reason);
  return result.value;
}

/** The id of the nth casting. Sequential and never random, so replay matches. */
export const castingIdFor = (n: number): string => `cast:${n}`;

/**
 * Rebuild the timer record with its keys sorted.
 *
 * Timers reach the event log, and a record whose key order depended on which
 * effect happened to be scheduled first would serialise differently for two
 * identical tables — the same reasoning that sorts condition instances and
 * resource pools.
 */
export function sortedTimers(timers: Readonly<Record<string, TimedEffect>>): Record<string, TimedEffect> {
  const sorted: Record<string, TimedEffect> = {};
  for (const key of Object.keys(timers).sort()) {
    const timer = timers[key];
    if (timer !== undefined) sorted[key] = timer;
  }
  return sorted;
}

/** Keys sorted, so state serialises identically however it was reached. */
export function sortedRecord<T>(entries: Readonly<Record<string, T>>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

/**
 * What a domain seam is handed: the state before the event, and that same
 * state with the event counted.
 *
 * Both, and named rather than positional. Every case in the reducer reads the
 * world as it was *and* returns from the world the count has moved on in —
 * `creatureOf(state, …)` beside `{ ...next, … }` — so a seam that took one
 * would have to recompute the other, and two bare `GameState` parameters in a
 * row are a pair a call site can silently swap. `resolveEffects`' own split
 * names its context for the same reason: what was closed over in one function
 * becomes a parameter when the function is thirteen.
 */
export interface Applying {
  readonly state: GameState;
  readonly next: GameState;
  /**
   * The content a log **older than pinning** was written against, or null.
   *
   * A log this engine writes pins every fact the fold reads — a casting's
   * area, the armour an equip event puts on — so the fold opens no catalogue.
   * The two frozen fixtures predate that, and the only honest way to fold
   * them is with the catalogue they were written against, handed in
   * explicitly; a seam that meets an unpinned record with nothing here
   * throws rather than folding with the rule switched off.
   */
  readonly legacy: Content | null;
}

/**
 * The guard that says an event is a given seam's, built from the seam's own
 * list so the two cannot disagree.
 *
 * **The list is the single source and the type is derived from it.** Written
 * the other way round — a hand-written union beside a hand-written array — the
 * two drift, and the drift is silent in the direction that matters: an event
 * the array claims and the switch has no case for. Here the array is the
 * declaration, `Extract` reads it, and the seam's own `never` binding refuses
 * to compile if a claimed type has no case.
 *
 * A `Set` rather than `includes`, because this runs once per event per seam
 * and the fold is the hot path the derived passes were measured on.
 */
export function seamOf<const Types extends readonly GameEvent['type'][]>(
  types: Types,
): (event: GameEvent) => event is Extract<GameEvent, { type: Types[number] }> {
  const owned: ReadonlySet<string> = new Set(types);
  return (event): event is Extract<GameEvent, { type: Types[number] }> => owned.has(event.type);
}

/**
 * An event no rule claims, which is loud rather than absorbed.
 *
 * **A corrupt log is loud**, and this is the case that was quiet. An event the
 * switch does not recognise used to fall out of it and return `undefined`,
 * which then failed several derived passes later with a TypeError naming a
 * function that had nothing to do with it.
 *
 * That is tolerable while every log is built in this process by these
 * commands. It stops being tolerable the moment logs come back from Postgres
 * as JSON, where a type is a string somebody wrote down last season: a renamed
 * or retired event silently becomes an undefined world.
 *
 * The `never` parameter is the other half, and it is free: it is what makes a
 * variant added to `GameEvent` and claimed by no seam — or claimed by a seam
 * and given no case — a compile error rather than a runtime surprise. It is
 * called from fourteen places now rather than one, and the repetition *is* the
 * guarantee: each seam carries the same backstop over its own narrowed union,
 * and `applyOne` carries it over what no seam claimed.
 */
export function unhandledEvent(event: never): never {
  throw new CorruptLogError(
    event as GameEvent,
    'the reducer has no rule for this event type; the log and the code disagree',
  );
}
