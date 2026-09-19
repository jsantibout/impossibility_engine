/**
 * What runs out, and what a creature who leaves takes with them.
 *
 * A duration running out is not a decision anybody makes, so the reducer ends
 * expired effects after every event and no log — however assembled — can show
 * one still running past its own end. Nothing is written: expiry is derived,
 * which is the audit trade Concentration already makes.
 *
 * The three dropping passes are the same reading applied to a creature who has
 * left the game rather than to the clock. A debt whose only settling command
 * is addressed to somebody who is gone is a fight that can never advance
 * again, which is what `dropOrphanedSaves` exists to prevent.
 */
import type { CharacterId } from '@ie/shared';
import { hasExpired, type TimeView } from '../time.js';
import { type PendingSave, type ScheduledDamage, type TimedEffect } from '../timers.js';
import type { GameState } from '../state.js';
import { endTimedCondition, releaseCasting, releaseGrants } from './release.js';
import { clearTemporaryHp } from './vitals.js';

/**
 * Every timer except the ones that end something on a creature who has left.
 *
 * **A creature takes its obligations with it**, which is the rule
 * `settleHoldsInvolving` already applies to a held attack and a declared move.
 * `pendingSaves` was the one engine debt of nine with nothing doing it: a
 * Paralyzed goblin removed mid-fight left its Hold Person timer standing, so
 * the boundary went on raising a save for a creature nobody could roll for and
 * `resolveTurn` refused `saves_pending` for ever. A fight that cannot advance
 * is a campaign that cannot continue.
 *
 * **Only the timers that name *that* creature.** A Hold Person upcast holds
 * two, and one of them leaving is not the other being freed — the whole
 * distinction the casting id was built for, applied here to the target.
 *
 * **A condition's timer and a feature's are both "on" a creature**, and both
 * go. The audit named the condition, because that is the one that raises a
 * save and wedges the fight; a Rage whose Barbarian has left is the same shape
 * with nothing downstream of it — `expireEffects` already checks that the
 * creature still exists before ending the feature, so this changes no
 * behaviour and removes the dangling key rather than leaving one kind of
 * orphan behind because only the other kind had a symptom.
 *
 * A **casting's** timer is deliberately untouched: SRD does not end a Grease
 * because somebody walked out of it, and a casting whose caster leaves is
 * already handled above by `releaseCasting`.
 *
 * Nothing is written for any of it. Expiry is derived — nobody *decides* that
 * a condition on a creature who is no longer in the game has stopped — which
 * is the same audit trade a deadline arriving and a broken Concentration both
 * already make.
 */
export function timersApartFrom(
  timers: Readonly<Record<string, TimedEffect>>,
  who: CharacterId,
): Record<string, TimedEffect> {
  const kept: Record<string, TimedEffect> = {};
  for (const key of Object.keys(timers).sort()) {
    const timer = timers[key];
    if (timer === undefined) continue;
    if (timer.target.kind !== 'casting' && timer.target.on === who) continue;
    kept[key] = timer;
  }
  return kept;
}

/**
 * Drop a scheduled hit whose moment can no longer arrive.
 *
 * Turn-anchored timing is combat-scoped — CLAUDE.md argues that at length for
 * effects and the same reasoning applies here, with the sign reversed. When
 * the fight ends or the target leaves the Initiative order, the moment the
 * damage was waiting for will never come. An effect in that position **ends**;
 * a debt in that position is **forgiven**, because collecting it would mean
 * firing the acid at the instant the last enemy dropped.
 *
 * Derived rather than commanded, for the usual reason: nobody decides that a
 * combat ended, so nobody should have to remember what ending it forgives.
 */
export function dropStrandedDamage(state: GameState): GameState {
  const live: Record<string, ScheduledDamage> = {};
  let changed = false;

  for (const key of Object.keys(state.scheduledDamage).sort()) {
    const scheduled = state.scheduledDamage[key];
    if (scheduled === undefined) continue;

    const deadline = scheduled.deadline;
    const stranded =
      (deadline.kind === 'turn-start' || deadline.kind === 'turn-end') &&
      (state.combat?.turnCounts[deadline.of] ?? null) === null;

    if (stranded) {
      changed = true;
      continue;
    }
    live[key] = scheduled;
  }

  return changed ? { ...state, scheduledDamage: live } : state;
}

/**
 * Drop a pending save whose effect is already gone.
 *
 * A Concentration broken before anyone rolled, an effect that ran out of time:
 * either way there is nothing left to save against, and a debt against a
 * vanished effect would block the turn order forever.
 */
export function dropOrphanedSaves(state: GameState): GameState {
  const live: Record<string, PendingSave> = {};
  let changed = false;
  for (const [key, pending] of Object.entries(state.pendingSaves)) {
    if (state.timers[pending.effectKey] === undefined) {
      changed = true;
      continue;
    }
    live[key] = pending;
  }
  return changed ? { ...state, pendingSaves: live } : state;
}

const viewOf = (state: GameState): TimeView => ({
  elapsed: state.elapsed,
  combat: state.combat,
});

/**
 * End every effect whose moment has come.
 *
 * Derived rather than commanded, for the same reason Concentration breaking is:
 * a duration running out is not a decision anybody makes, and no log — however
 * assembled — should be able to show an effect still running past its own end.
 *
 * Keys are visited in sorted order so a fold is byte-identical however the
 * effects were scheduled. One pass settles it today: ending an effect cannot
 * bring a deadline forward. The loop is what keeps that true if one ever can.
 */
export function expireEffects(state: GameState): GameState {
  let current = state;

  for (;;) {
    const view = viewOf(current);
    const key = Object.keys(current.timers)
      .sort()
      .find((k) => {
        const timer = current.timers[k];
        return timer !== undefined && hasExpired(view, timer.deadline);
      });
    if (key === undefined) return current;

    const timer = current.timers[key];
    // **Through the one door, which deletes the key itself.** A condition on a
    // timer ends the same way whether the clock reached it or SRD's "ends
    // early if you make an attack roll" did, so both callers reach
    // `endTimedCondition` and neither owns the rule.
    if (timer !== undefined && timer.target.kind === 'condition') {
      current = endTimedCondition(current, key, timer.target);
      continue;
    }

    const timers = { ...current.timers };
    delete timers[key];
    current = { ...current, timers };
    if (timer === undefined) continue;

    const target = timer.target;
    if (target.kind === 'feature') {
      // SRD Rage: "The Rage lasts until the end of your next turn." A deadline
      // running out is not a decision anybody makes, so it ends here.
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: {
              ...creature,
              activeFeatures: creature.activeFeatures.filter((f) => f !== target.feature),
            },
          },
        };
      }
    } else if (target.kind === 'grants') {
      // SRD Superior Hunter's Defense: "Resistance to that damage ... until
      // the end of the current turn." What ends is what that source granted,
      // and nothing else — the casting or the feature that made it carries on,
      // which is the whole difference between this and a `casting` deadline.
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: releaseGrants(creature, target.source),
          },
        };
      }
    } else if (target.kind === 'temporary-hit-points') {
      // SRD, and the owner's ruling of 2026-09-18: Temporary Hit Points with
      // no stated duration last until spent or until a Long Rest, and a stated
      // duration — Potion of Heroism's hour — overrides that default. This is
      // the stated one arriving.
      //
      // **What arrives finds however many are left.** The pool is a number
      // damage eats away at, not a fact that holds or does not, so the moment
      // may find ten, four, or none — and taking none away is as quiet as
      // taking ten. `clearTemporaryHp` is quiet on an empty pool for that
      // reason, and it touches nothing else: a deadline is not a second
      // helping of damage, so no hit point moves, no death save is reset and
      // a creature already dead stays exactly as it was.
      current = clearTemporaryHp(current, target.on);
    } else if (target.kind === 'casting') {
      // Ending the casting takes its Concentration and every effect it created.
      const castingId = target.castingId;
      const caster = Object.values(current.creatures).find(
        (c) => c.concentration?.castingId === castingId,
      );
      current = releaseCasting(current, caster?.id ?? null, castingId);
    }
  }
}

