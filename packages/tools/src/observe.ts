/**
 * Everything authoritative a caller could reasonably need, in one object.
 *
 * Not a second source of truth: every field is read off `GameState` through
 * an engine reader, and nothing here computes a rule. The two that matter are
 * read through the engine's *effective* readers rather than the record —
 * {@link armorClassOf} folds in a Shield of Faith, {@link movementLeftFor}
 * folds in a Dash and a feature grant — because a caller shown the base
 * number would be narrating against a number the engine never attacks with.
 *
 * `owed` is the half a caller forgets exists. Every engine debt refuses most
 * commands while it stands, so a surface that does not report them leaves the
 * caller discovering them one refusal at a time, and — for a held move with
 * two Opportunity Attacks outstanding — with no way to learn *who* owes what.
 */

import type { CharacterId } from '@ie/shared';
import { asCharacterId } from '@ie/shared';
import type { GameState } from '@ie/engine';
import {
  armorClassOf,
  carrying,
  distanceBetween,
  movementLeftFor,
  positionOf,
  remaining,
  speedOf,
  spellSlotKey,
  strandedSummons,
} from '@ie/engine';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface ObservedBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  readonly movementFeet: number;
  readonly spentASlotThisTurn: boolean;
}

export interface ObservedCreature {
  readonly id: string;
  readonly name: string;
  readonly side: string | null;
  readonly hp: number;
  readonly hpMax: number;
  readonly temporaryHp: number;
  readonly dead: boolean;
  /**
   * At 0 hit points and no longer dying — SRD's Stable.
   *
   * Beside `dead` because it is the other end of the same sentence, and
   * reported at all because `stabilise_creature` is what changes it: a caller
   * that cannot see whether somebody on the floor is still bleeding cannot
   * tell whether the kneeling was worth anything, and every other creature at
   * 0 hit points looks exactly the same from here.
   */
  readonly stable: boolean;
  readonly armorClass: number;
  readonly speed: number;
  readonly creatureType: string | null;
  readonly conditions: readonly string[];
  readonly carrying: readonly string[];
  readonly concentratingOn: string | null;
  readonly placed: boolean | null;
  /** Feet to every other creature, or null where nobody has said. */
  readonly feetTo: Readonly<Record<string, number | null>>;
  readonly spellSlots: Readonly<Record<string, number>>;
  readonly budget: ObservedBudget | null;
}

export interface ObservedDebts {
  readonly pendingSaves: number;
  readonly pendingAttack: string | null;
  readonly pendingDamage: string | null;
  readonly pendingTest: string | null;
  readonly pendingCastings: readonly string[];
  readonly pendingMove: {
    readonly mover: string;
    readonly mustAnswerOpportunityAttack: readonly string[];
  } | null;
  readonly owedAreaEffects: number;
  /**
   * Who is still standing on a casting that has ended.
   *
   * **Named rather than counted**, which is the one debt here that has to be:
   * the others are settled by a call that takes no argument and this one is
   * too, but a caller narrating the room has to know *which* creature is
   * about to vanish — and the refusal it would otherwise meet
   * (`summons_stranded`, from every attempt to end a turn) is the engine's
   * way of saying the same thing one wasted call later.
   *
   * Derived rather than filed, as the engine derives it: a question about the
   * world as it stands rather than a record of a moment that has passed.
   * `dismiss_stranded_summons` is the door that empties it.
   */
  readonly strandedSummons: readonly string[];
  readonly turnStartUnsettled: string | null;
}

export interface Observation {
  readonly round: number | null;
  readonly turnOf: string | null;
  readonly initiativeOrder: readonly string[] | null;
  readonly elapsedSeconds: number;
  readonly scene: {
    readonly extent: { readonly width: number; readonly depth: number; readonly height: number };
    readonly landmarks: readonly string[];
  } | null;
  readonly creatures: readonly ObservedCreature[];
  readonly owed: ObservedDebts;
}

const feet = (state: GameState, a: CharacterId, b: CharacterId): number | null => {
  if (state.scene === null) return null;
  const apart = distanceBetween(state.scene, a, b);
  return apart.ok ? apart.value : null;
};

export function observe(state: GameState): Observation {
  const ids = Object.keys(state.creatures).sort();
  const combat = state.combat;

  const creatures = ids.map((key): ObservedCreature => {
    const c = state.creatures[key]!;
    const budget = combat?.budgets[key];
    const slots: Record<string, number> = {};
    for (const level of SLOT_LEVELS) {
      const left = remaining(c.resources, spellSlotKey(level));
      if (left > 0) slots[String(level)] = left;
    }
    return {
      id: c.id,
      name: c.name,
      side: c.side ?? null,
      hp: c.vitals.hp,
      hpMax: c.vitals.hpMax,
      temporaryHp: c.vitals.temporaryHp,
      dead: c.vitals.dead,
      stable: c.vitals.stable,
      armorClass: armorClassOf(state, c.id),
      speed: speedOf(state, c.id),
      creatureType: c.creatureType ?? null,
      conditions: c.conditions.conditions,
      carrying: carrying(state, c.id).map((line) => line.id),
      concentratingOn: c.concentration?.spell ?? null,
      placed: state.scene === null ? null : positionOf(state.scene, c.id) !== null,
      feetTo: Object.fromEntries(
        ids.filter((other) => other !== key).map((other) => [other, feet(state, c.id, asCharacterId(other))]),
      ),
      spellSlots: slots,
      budget:
        budget === undefined
          ? null
          : {
              action: budget.action,
              bonusAction: budget.bonusAction,
              reaction: budget.reaction,
              movementFeet: movementLeftFor(state, c.id) ?? 0,
              spentASlotThisTurn: budget.spellSlotSpentOnTurn !== null,
            },
    };
  });

  return {
    round: combat?.round ?? null,
    turnOf: combat?.order[combat.turnIndex]?.id ?? null,
    initiativeOrder: combat?.order.map((entry) => entry.id) ?? null,
    elapsedSeconds: state.elapsed,
    scene:
      state.scene === null
        ? null
        : { extent: state.scene.extent, landmarks: Object.keys(state.scene.landmarks).sort() },
    creatures,
    owed: {
      pendingSaves: state.pendingSaves === undefined ? 0 : Object.keys(state.pendingSaves).length,
      pendingAttack: state.pendingAttack?.attacker ?? null,
      pendingDamage: state.pendingDamage?.target ?? null,
      pendingTest: state.pendingTest?.who ?? null,
      pendingCastings: Object.keys(state.pendingCastings),
      pendingMove:
        state.pendingMove === null
          ? null
          : {
              mover: state.pendingMove.mover,
              mustAnswerOpportunityAttack: state.pendingMove.provoked.map((p) => p.reactor),
            },
      owedAreaEffects: state.owedAreaEffects.length,
      strandedSummons: strandedSummons(state).map(String),
      turnStartUnsettled: state.pendingTurnStart?.who ?? null,
    },
  };
}
