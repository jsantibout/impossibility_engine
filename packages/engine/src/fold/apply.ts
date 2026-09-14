/**
 * The pipeline: one event in, the state it leaves.
 *
 * `applyOne` is the switch — one case per declared event type, with a `never`
 * default, so a member added to the union and not to the switch is a compile
 * error rather than a wrong answer in a fight. It stays **one** switch
 * deliberately: dispatching it by domain is a further move and this split is
 * the safer half of it.
 *
 * `applyEvent` is what runs afterwards, and the order of those derived passes
 * is the load-bearing part of this file. Nobody decides that Concentration
 * broke, that a turn's start arrived, that a deadline passed or that a target
 * swung — so each is found rather than commanded, and each reads the world the
 * pass before it left.
 *
 * `fold` is the reduce. The derived passes that only it runs live here with
 * it; everything a seam owns lives in that seam's module.
 */
import type { CharacterId } from '@ie/shared';
import type { CharacterSheet } from '../character.js';
import { rollModifierKey } from '../roll-modifiers.js';
import {
  applyCondition,
  conditionState,
  isIncapacitated,
  removeCondition,
  setExhaustion,
} from '../conditions.js';
import {
  declarePool,
  resize,
  resourceState,
  restore,
  restoreOn,
  spend as spendResource,
} from '../resources.js';
import type { ReactionOffer } from '../reactions.js';
import { itemFor } from '../catalogue.js';
import { READY, universalAction } from '../actions.js';
import { noSpellcasting } from '../spellcasting.js';
import { pendingSaveKey, scheduledDamageKey, timerKey, type TimedEffect } from '../duration.js';
import { castingIdOf } from '../spells.js';
import {
  advanceTurn,
  dash,
  disengage,
  markFeatureUsed,
  markSpellSlotSpent,
  startCombat,
  spendAction,
  spendBonusAction,
  spendAttack,
  spendMovement,
  spendReaction,
  useFreeInteraction,
  removeCombatant,
  swapInitiative,
} from '../combat.js';
/**
 * The one Speed reader, asked by the fold for exactly the reason the command
 * asks it: a reducer backstop measuring against a different number is a fork
 * rather than a guard.
 *
 * **Not a cycle, and not a catalogue lookup.** `standing.ts` imports
 * `GameState` from here `type`-only, so the runtime edge runs one way; and
 * every input `speedOf` reads is log-held — the pinned combatant speed,
 * `sheet.standing` carried by `character-created`, `equipped`, conditions — so
 * the fence `upgradeOngoing` stands behind is intact and a future correction
 * to the Monk table changes future sheets rather than historical folds.
 */
import { speedOf } from '../standing.js';
import {
  addLandmark,
  declareCover,
  declareSight,
  dismount,
  mount,
  moveCreature,
  placeCreature,
  removeCreature,
  scene,
} from '../positioning.js';
import { upgradeOngoing } from '../ongoing-compatibility.js';
import {
  applyDamageToVitals,
  grantTemporaryHp,
  heal,
  resolveDeathSave,
  stabilize,
  vitals,
} from '../vitals.js';

import type { GameEvent } from '../events.js';
import type { CreatureState, GameState, InventoryLine } from '../state.js';
import { initialState } from '../state.js';
import {
  CorruptLogError,
  castingIdFor,
  combatOf,
  creatureOf,
  must,
  sceneOf,
  sortedRecord,
  sortedTimers,
  withCombat,
  withCreature,
} from './common.js';
import {
  alsoOn,
  casterOf,
  releaseCasting,
  releaseOnTarget,
  withPendingCasting,
  withoutPendingCasting,
  withoutTarget,
} from './release.js';
import { dropOrphanedAreaEffects, raiseAfterMovement, raiseAreaArrivals } from './areas.js';
import {
  failUnsustainedCastings,
  forgetSustainedTurns,
  raiseTurnEnd,
  raiseTurnSaves,
  reachStartOfTurn,
} from './turns.js';
import { dropOrphanedSaves, dropStrandedDamage, expireEffects, timersApartFrom } from './expiry.js';
import { endTriggeredCastings } from './endings.js';

/**
 * Which offer an answer settles.
 *
 * **An offer is a (reactor, feature) pair, not a reactor.** One creature can
 * hold two features in one window — a Rogue 5 / Monk 3 is offered Uncanny
 * Dodge *and* Deflect Attacks against the same blow, and a Fighter / Fiend
 * Warlock may Indomitable a failed save and then add Dark One's Own Luck to
 * the new roll, which the SRD permits. Matching answers by reactor alone
 * consumed both offers on the first answer, and a settlement that recorded
 * one pass per offer then found the second already gone and threw — a legal
 * character build that crashed the settle command and corrupted the log.
 *
 * An answer that names no feature is a bare pass and lets every offer that
 * reactor held lapse, which is what declining a window means.
 */
const offerAnswered =
  (event: { readonly reactor: CharacterId; readonly feature?: string }) =>
  (offer: ReactionOffer): boolean =>
    offer.reactor === event.reactor &&
    (event.feature === undefined || offer.feature === event.feature);

/**
 * Whether any creature at all matches, without allocating anything.
 *
 * Three derived passes run after **every** event and each begins by sorting
 * the whole cast — `Object.keys(creatures).sort()`, an array of N strings and
 * an N log N comparison, to find the handful of creatures that could possibly
 * be affected. Most events affect none of them: nobody is concentrating,
 * nothing is switched on, nothing is readied.
 *
 * Measured on a cast of 128 over 2,256 events, those three passes were 90% of
 * the fold. This is the question they should ask first — a bare `for...in`
 * that allocates nothing and stops at the first match. When it says no, the
 * pass returns the state it was given; when it says yes, the original sorted
 * path runs unchanged, so the *order* effects are applied in is exactly what
 * it always was.
 */
function anyCreature(
  state: GameState,
  matches: (creature: CreatureState) => boolean,
): boolean {
  for (const key in state.creatures) {
    const creature = state.creatures[key];
    if (creature !== undefined && matches(creature)) return true;
  }
  return false;
}

/**
 * SRD Concentration: "Your Concentration ends if you have the Incapacitated
 * condition or you die."
 *
 * This is derived rather than commanded, because it is not a decision anybody
 * makes. A caster knocked to 0 hit points is Unconscious, therefore
 * Incapacitated, therefore not concentrating — and no log, however it was
 * assembled, should be able to produce a state where a dead wizard's Hold
 * Person is still running.
 *
 * Applied after every event, so it catches the break however it arrived:
 * damage, a spell, Exhaustion reaching 6.
 */
function breakLostConcentration(state: GameState): GameState {
  // Nobody concentrating, nothing to lose. The common case by a wide margin.
  if (!anyCreature(state, (c) => c.concentration !== null)) return state;

  let current = state;

  // Releasing one casting cannot Incapacitate anybody, so this settles in a
  // single pass today. The loop is what keeps that true if an effect type that
  // *can* ever lands.
  for (;;) {
    const lost = Object.keys(current.creatures)
      .sort()
      .map((key) => current.creatures[key])
      .find(
        (creature) =>
          creature !== undefined &&
          creature.concentration !== null &&
          (creature.vitals.dead || isIncapacitated(creature.conditions)),
      );

    if (lost?.concentration == null) return current;
    current = releaseCasting(current, lost.id, lost.concentration.castingId);
  }
}

/**
 * Remember that a command landed.
 *
 * Generic on purpose: any event that carries a `commandId` participates, so
 * the next operation that needs an identity gets the guarantee by adding one
 * field rather than by inventing a second mechanism. The first landing wins —
 * an id is a claim about which command this is, not about how many times it
 * may appear.
 */
function recordCommand(state: GameState, event: GameEvent): GameState {
  if (!('command' in event) || event.command === undefined) return state;
  if (state.appliedCommands[event.command.id] !== undefined) return state;

  return {
    ...state,
    appliedCommands: {
      ...state.appliedCommands,
      [event.command.id]: {
        type: event.type,
        // A declaration allocates the casting id, so a retried declaration has
        // to be able to recover it — the caller needs to name the casting it
        // already opened, not the one that would come next.
        castingId:
          event.type === 'spell-cast'
            ? event.castingId
            : event.type === 'spell-declared'
              ? event.casting.castingId
              : null,
        fingerprint: event.command.fingerprint,
      },
    },
  };
}

/**
 * SRD rest interruptions: "Rolling Initiative", "Casting a spell other than a
 * cantrip", "Taking any damage".
 *
 * Marked as they happen rather than reported by the caller. A caller who had
 * to report them would eventually miss one, and the party would collect a rest
 * the rules had already broken — which is the same reasoning that makes
 * Concentration derived. The first cause is the one that broke it; later ones
 * change nothing.
 */
function interruptedRests(state: GameState, event: GameEvent): GameState {
  const broken: [CharacterId, string][] = [];

  switch (event.type) {
    case 'damage-taken':
      if (event.amount > 0) broken.push([event.id, 'damage']);
      break;
    case 'spell-cast':
      // "other than a cantrip" — a cantrip is level 0 and breaks nothing.
      if (event.level > 0) broken.push([event.id, 'a spell']);
      break;
    case 'spell-declared':
      // The rest breaks when the casting *starts*, which is the same moment
      // the action is spent. A casting later interrupted does not un-break it:
      // the caster still stopped resting to cast.
      if (event.casting.level > 0) broken.push([event.casting.caster, 'a spell']);
      break;
    case 'combat-started':
      for (const combatant of event.combatants) broken.push([combatant.id, 'Initiative']);
      break;
    default:
      return state;
  }

  let current = state;
  for (const [id, cause] of broken) {
    const creature = current.creatures[id];
    if (creature?.resting == null || creature.resting.interruptedBy !== null) continue;
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [id]: {
          ...creature,
          // The moment matters, not just the fact: SRD pays a broken Long Rest
          // on the time rested *before* the interruption.
          resting: {
            ...creature.resting,
            interruptedBy: cause,
            interruptedAt: current.elapsed,
          },
        },
      },
    };
  }
  return current;
}

/**
 * Quantities merge and the list stays sorted, so two identical packs agree.
 *
 * Exported because a plan has to describe the same inventory the log will
 * produce: two packages that both hold a quarterstaff own one line of two, not
 * two lines of one, before a single event is appended.
 */
export function mergeItems(
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] {
  const counts = new Map(inventory.map((line) => [line.id, line.quantity]));
  for (const line of items) counts.set(line.id, (counts.get(line.id) ?? 0) + line.quantity);
  return [...counts.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const removeItems = (
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] =>
  mergeItems(inventory, items.map((line) => ({ ...line, quantity: -line.quantity })));

/**
 * Derive the sheet's armour from what is equipped.
 *
 * `equipped` is the authoritative fact; `sheet.armor` and `sheet.shield` are a
 * view of it that Armour Class happens to read. So this recomputes both from
 * the whole list rather than patching one slot per event — patching is only
 * correct if every event arrives in the right order and nothing else ever
 * touches the sheet, and `character-advanced` replaces the sheet wholesale.
 *
 * Anything that is not armour or a shield contributes nothing: a dagger in
 * hand is tracked, but it is not Armour Class.
 */
function withEquipment(sheet: CharacterSheet, equipped: readonly string[]): CharacterSheet {
  const pieces = equipped.map((itemId) => itemFor(itemId)?.armor ?? null);
  return {
    ...sheet,
    armor: pieces.find((piece) => piece !== null && piece.category !== 'shield') ?? null,
    shield: pieces.find((piece) => piece !== null && piece.category === 'shield') ?? null,
  };
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const applied = applyOne(state, event);
  return reachStartOfTurn(
    dropOrphanedAreaEffects(
      dropStrandedDamage(
        dropOrphanedSaves(
          dropLapsedReady(
            expireEffects(
              endLostFeatures(
                // Between the two passes that already end a casting nobody
                // decided to end — a lost Concentration above, an arrived
                // deadline below — because it is the same kind of fact, and
                // because the four `drop*` passes below are the safety net for
                // anything a release orphaned.
                endTriggeredCastings(
                  breakLostConcentration(recordCommand(interruptedRests(applied, event), event)),
                  event,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Features whose own conditions have stopped holding.
 *
 * SRD Rage: "it ends early if you don Heavy armor or have the Incapacitated
 * condition." Nobody decides either of those, so this is derived after every
 * event, the same way a broken Concentration is — which means no log, however
 * assembled, can show a Rage running on a stunned Barbarian in plate.
 *
 * The timer goes with it. A stale deadline would sit waiting to end something
 * that is already over, and would end the *next* Rage early if one started
 * before it fired.
 */
function endLostFeatures(state: GameState): GameState {
  // Nothing switched on anywhere, so nothing can have stopped holding.
  if (!anyCreature(state, (c) => c.activeFeatures.length > 0)) return state;

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  const dropped: { id: CharacterId; feature: string }[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    if (creature === undefined || creature.activeFeatures.length === 0) continue;

    const kept = creature.activeFeatures.filter((feature) => sustains(creature, feature));
    if (kept.length === creature.activeFeatures.length) continue;

    for (const feature of creature.activeFeatures) {
      if (!kept.includes(feature)) dropped.push({ id: creature.id, feature });
    }
    creatures[key] = { ...creature, activeFeatures: kept };
  }

  if (dropped.length === 0) return state;

  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(state.timers)) {
    const target = timer.target;
    const doomed =
      target.kind === 'feature' &&
      dropped.some((d) => d.id === target.on && d.feature === target.feature);
    if (!doomed) timers[key] = timer;
  }

  return { ...state, creatures, timers };
}

/**
 * Readied actions whose hold has stopped holding.
 *
 * Two ways it ends without being released, and neither is anybody's decision:
 *
 * - **The deadline passed.** SRD: the Ready action "lets you act by taking a
 *   Reaction before the start of your next turn". That is the `action:ready`
 *   feature's timer, so when the feature is gone the hold is gone with it.
 * - **A held spell's Concentration broke.** SRD: "holding on to the spell's
 *   magic requires Concentration... If your Concentration is broken, the spell
 *   dissipates without taking effect." The slot stays spent — it went when the
 *   spell was readied — and the Reaction was never taken, so nothing is
 *   refunded either way.
 *
 * The first case leaves a held spell's Concentration running with nothing left
 * to release, so ending the casting is part of the same cleanup: SRD caps the
 * hold at "the start of your next turn", and a Concentration that outlived it
 * would block the next spell on behalf of a casting that no longer exists.
 */
function dropLapsedReady(state: GameState): GameState {
  // Two jobs, and the guard has to cover both. The obvious half is lapsing a
  // hold, which needs a creature holding one. The half that caught this guard
  // out is sweeping a **stale Ready timer**, which by definition happens when
  // a creature's `readied` is already null — so guarding on holders alone left
  // a released Ready's deadline sitting in state, and `ready.test.ts` said so
  // within a minute of the optimisation landing.
  const holding = anyCreature(state, (c) => c.readied !== null);
  const scheduled = Object.values(state.timers).some(
    (timer) => timer.target.kind === 'feature' && timer.target.feature === READY,
  );
  if (!holding && !scheduled) return state;

  let current = state;

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = current.creatures[key];
    if (creature === undefined || creature.readied === null) continue;

    const response = creature.readied.response;
    const held =
      response.kind !== 'spell' || creature.concentration?.castingId === response.castingId;
    const running = creature.activeFeatures.includes(READY);
    if (held && running) continue;

    // The deadline is what ended it, so the spell it was holding goes too.
    if (held && response.kind === 'spell') {
      current = releaseCasting(current, creature.id, response.castingId);
    }

    const now = current.creatures[key];
    if (now === undefined) continue;
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [key]: {
          ...now,
          readied: null,
          activeFeatures: now.activeFeatures.filter((f) => f !== READY),
        },
      },
    };
  }

  // A Ready timer exists only while something is readied — released or
  // lapsed, the deadline has nothing left to end, and a stale one would sit
  // waiting to cut the *next* Ready short.
  const timers: Record<string, TimedEffect> = {};
  let dropped = false;
  for (const [key, timer] of Object.entries(current.timers)) {
    const target = timer.target;
    if (
      target.kind === 'feature' &&
      target.feature === READY &&
      current.creatures[target.on]?.readied == null
    ) {
      dropped = true;
      continue;
    }
    timers[key] = timer;
  }

  return dropped ? { ...current, timers } : current;
}

/** Whether this creature still meets what an active feature demands of them. */
function sustains(creature: CreatureState, feature: string): boolean {
  const definition =
    (creature.sheet.activated ?? []).find((a) => a.feature === feature) ??
    universalAction(feature);
  if (definition === null || definition === undefined) return true;

  for (const requirement of definition.endsOn ?? []) {
    if (requirement === 'incapacitated' && isIncapacitated(creature.conditions)) return false;
    if (requirement === 'heavy-armor' && wearsHeavyArmor(creature)) return false;
  }
  return true;
}

/** SRD Rage: "if you aren't wearing Heavy armor", and "if you don Heavy armor". */
export function wearsHeavyArmor(creature: CreatureState): boolean {
  return creature.equipped.some((itemId) => itemFor(itemId)?.armor?.category === 'heavy');
}

function applyOne(state: GameState, event: GameEvent): GameState {
  const next = { ...state, eventCount: state.eventCount + 1 };

  switch (event.type) {
    case 'creature-added': {
      if (state.creatures[event.id] !== undefined) {
        throw new CorruptLogError(event, `${event.id} is already in this game`);
      }
      return {
        ...next,
        creatures: {
          ...state.creatures,
          [event.id]: {
            id: event.id,
            name: event.name,
            sheet: event.sheet,
            vitals: vitals(event.maxHp, { diesAtZero: event.diesAtZero ?? false }),
            conditions: conditionState(),
            resources: resourceState(),
            concentration: null,
            resting: null,
            lastLongRestAt: null,
            lastShortRestAt: null,
            spellcasting: noSpellcasting(),
            creatureType: event.creatureType ?? null,
            defenses: event.defenses ?? {},
            // Absent means none, which is what every log written before this
            // field existed says — so both frozen fixtures fold unchanged.
            conditionImmunities: event.conditionImmunities ?? [],
            side: event.side ?? null,
            activeFeatures: [],
            readied: null,
            lastDamage: null,
            bonuses: [],
            armorClasses: [],
            rollModifiers: [],
            grantedDefenses: [],
            speedModifiers: [],
            attackRiders: [],
            initiativeBonuses: [],
            inventory: [],
            equipped: [],
            coins: 0,
            character: null,
          },
        },
      };
    }

    case 'creature-removed': {
      const creature = creatureOf(state, event, event.id);
      // A caster who leaves the game takes their ongoing spell with them.
      // Their record is about to be deleted, so the casting id has to be read
      // off it first or the effects it created would dangle for good.
      const cleaned =
        creature.concentration === null
          ? next
          : releaseCasting(next, event.id, creature.concentration.castingId);
      const creatures = { ...cleaned.creatures };
      delete creatures[event.id];
      // Every *other* spell that was on them stops being on them. Not ended —
      // SRD does not end a Cleric's Bless because one of the blessed walked
      // out — but a name in `on` that no longer belongs to anybody is a
      // dispellable target that does not exist.
      return withoutTarget(
        { ...cleaned, creatures, timers: timersApartFrom(cleaned.timers, event.id) },
        event.id,
        null,
      );
    }

    case 'damage-taken': {
      const creature = creatureOf(state, event, event.id);
      const outcome = applyDamageToVitals(
        creature.vitals,
        event.amount,
        event.critical === undefined ? {} : { critical: event.critical },
      );
      // A dealer overwrites the last one; damage from nothing in the game
      // leaves whatever was there, because a falling rock does not make the
      // thug who stabbed you a moment ago un-stabbed you. The window closes on
      // its own when the turn or the clock moves.
      return withCreature(
        next,
        event.id,
        {
          vitals: outcome.vitals,
          ...(event.by === undefined
            ? {}
            : {
                lastDamage: {
                  by: event.by,
                  turn: state.combat?.turnsTaken ?? null,
                  elapsed: state.elapsed,
                },
              }),
        },
        creature,
      );
    }

    case 'healed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: heal(creature.vitals, event.amount) }, creature);
    }

    case 'temporary-hp-granted': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: grantTemporaryHp(creature.vitals, event.amount) },
        creature,
      );
    }

    case 'temporary-hp-cleared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, temporaryHp: 0 } },
        creature,
      );
    }

    case 'death-save-recorded': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: resolveDeathSave(creature.vitals, event.natural, event.total ?? event.natural).vitals },
        creature,
      );
    }

    case 'stabilised': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: stabilize(creature.vitals) }, creature);
    }

    case 'condition-applied': {
      const creature = creatureOf(state, event, event.id);
      const conditions = applyCondition(creature.conditions, event.condition, event.source);
      return alsoOn(
        withCreature(next, event.id, { conditions }, creature),
        event.id,
        event.source,
      );
    }

    case 'condition-removed': {
      const creature = creatureOf(state, event, event.id);
      // Lifting a cause drops what that cause carried — losing Unconscious
      // lifts the Incapacitated it brought — while leaving any other reason
      // for the same condition standing, and leaving Prone behind.
      const conditions = removeCondition(creature.conditions, event.condition, event.source);
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'exhaustion-set': {
      const creature = creatureOf(state, event, event.id);
      const conditions = setExhaustion(creature.conditions, event.level);
      // SRD: "You die if your Exhaustion level is 6." That is a rule, not
      // something a caller opts into, so it happens here.
      const vitals =
        conditions.exhaustion >= 6 ? { ...creature.vitals, hp: 0, dead: true } : creature.vitals;
      return withCreature(next, event.id, { conditions, vitals }, creature);
    }

    case 'creature-died': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, hp: 0, dead: true } },
        creature,
      );
    }

    case 'resource-pool-declared': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, declarePool(creature.resources, event.pool));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-spent': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, spendResource(creature.resources, event.key, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-regained': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, restore(creature.resources, event.key, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-pool-resized': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, resize(creature.resources, event.key, event.max));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'character-created': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'character-advanced': {
      const creature = creatureOf(state, event, event.id);
      if (creature.character === null) {
        throw new CorruptLogError(event, `${event.id} was not created from character choices`);
      }
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          // The new level derives a fresh sheet — new hit points, new
          // proficiency, new everything the level changes — and it knows
          // nothing about what this character is wearing. So the sheet is the
          // new one, and its armour comes from the equipment state, which the
          // level did not touch. Gaining a level does not take your armour off,
          // and it does not put back what you took off either.
          sheet: withEquipment(event.sheet, creature.equipped),
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'hit-point-maximum-raised': {
      const creature = creatureOf(state, event, event.id);
      if (!Number.isInteger(event.amount) || event.amount <= 0) {
        throw new CorruptLogError(event, `a hit point maximum rises by a positive whole number, got ${event.amount}`);
      }
      // SRD: the maximum rises; current hit points rise with it, because the
      // new points were never lost. Damage already taken stays taken.
      return withCreature(
        next,
        event.id,
        {
          vitals: {
            ...creature.vitals,
            hpMax: creature.vitals.hpMax + event.amount,
            hp: creature.vitals.hp + event.amount,
          },
        },
        creature,
      );
    }

    case 'resources-restored': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { resources: restoreOn(creature.resources, event.recovers) },
        creature,
      );
    }

    case 'spell-declared': {
      // **Purely id-based, and there is deliberately no per-caster throw.**
      // The reducer is the corrupt-log backstop for *identity*, and two
      // castings by one caster is not an identity fact: SRD permits it, and
      // what refuses a second casting is the action economy, the turn's one
      // slot, or Concentration's single door. A duplicate id is impossible in
      // practice because of the sequence check below — which is exactly what
      // makes this the backstop rather than the rule.
      if (state.pendingCastings[event.casting.castingId] !== undefined) {
        throw new CorruptLogError(
          event,
          `${event.casting.castingId} is already waiting to resolve`,
        );
      }
      creatureOf(state, event, event.casting.caster);

      // The id is allocated here, so this is the event that advances the
      // sequence. The `spell-cast` that settles it must not advance it again.
      const expected = castingIdFor(state.castingsBegun + 1);
      if (event.casting.castingId !== expected) {
        throw new CorruptLogError(
          event,
          `expected casting ${expected}, got ${event.casting.castingId}`,
        );
      }

      return {
        ...next,
        castingsBegun: state.castingsBegun + 1,
        pendingCastings: withPendingCasting(state.pendingCastings, event.casting),
      };
    }

    case 'spell-ongoing': {
      const casting = event.casting;
      if (state.ongoing[casting.castingId] !== undefined) {
        throw new CorruptLogError(event, `${casting.castingId} is already running`);
      }
      // The casting has to have happened. A record for a casting nobody cast
      // is the shape of every "the model made it up" failure this engine
      // exists to refuse, and the counter is the one fact that proves it.
      if (Number(casting.castingId.slice('cast:'.length)) > state.castingsBegun) {
        throw new CorruptLogError(event, `${casting.castingId} has not been cast`);
      }
      // And it has to still be running. `releaseCasting` is the single place a
      // record is removed, so a record arriving for a casting that has already
      // been through it is a spell coming back from the dead — visible again
      // to Dispel Magic, to the turn boundary and to every area detector, by
      // exactly the route that "one door out" was meant to close.
      if (state.castingsEnded.includes(casting.castingId)) {
        throw new CorruptLogError(event, `${casting.castingId} has already ended`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...state.ongoing,
          // A pre-versioned record is filled in here and nowhere else, so
          // every later read is of a record rather than of the catalogue.
          [casting.castingId]: upgradeOngoing(casting),
        }),
      };
    }
    case 'spell-ended': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // Two operations the engine has had since Hold Person's repeat save, and
      // the event says which: one creature shakes it off, or the whole spell
      // stops.
      return event.on === null
        ? releaseCasting(next, casterOf(state, event.castingId), event.castingId)
        : releaseOnTarget(next, event.on, event.castingId);
    }
    // Changes nothing, like `roll-recorded`: the action it cost and the damage
    // it dealt are their own events. It is here so the log can say why a spell
    // struck on a turn nobody cast it.
    case 'spell-activated':
      return next;
    case 'area-effect-settled': {
      const at = state.owedAreaEffects.findIndex(
        (owed) =>
          owed.castingId === event.castingId &&
          owed.target === event.target &&
          owed.moment === event.moment,
      );
      if (at < 0) {
        throw new CorruptLogError(
          event,
          `${event.castingId} owes ${event.target} nothing at ${event.moment}`,
        );
      }
      return {
        ...next,
        owedAreaEffects: [
          ...state.owedAreaEffects.slice(0, at),
          ...state.owedAreaEffects.slice(at + 1),
        ],
      };
    }
    case 'spell-origin-moved': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // A casting that never held a point cannot have moved one. The command
      // refuses this; a hand-built log that does it anyway is a log and a set
      // of rules that disagree, which is loud rather than absorbed.
      const from = record.origin;
      if (from === undefined) {
        throw new CorruptLogError(event, `${event.castingId} holds no point to move`);
      }
      // The point moves, and then the area it defines is asked who it arrived
      // on. Derived rather than carried on the event for the reason every
      // other consequence in this file is derived: nobody *decides* that a
      // beam swept over somebody, and a replay reconstructs it because the
      // fold does.
      const moved: GameState = {
        ...next,
        ongoing: { ...state.ongoing, [event.castingId]: { ...record, origin: event.to } },
      };
      return raiseAreaArrivals(moved, event.castingId, from, event.to);
    }
    case 'spell-interrupted': {
      if (state.pendingCastings[event.castingId] === undefined) {
        throw new CorruptLogError(event, `no casting ${event.castingId} is waiting to resolve`);
      }
      // Nothing is given back. The action was wasted by the same SRD sentence
      // that spares the slot, and the slot was never spent.
      //
      // **Through the single door, which this case used not to need.** It
      // cleared the pending record itself, and that was complete while no
      // pending casting could be concentrated on. A casting of a minute or
      // more is concentrated on from its declaration, and SRD Counterspell
      // says "the spell dissipates with no effect" — so a caster left
      // concentrating on it would be holding a casting that no longer exists,
      // permanently, and rolling a Constitution save on every later hit for a
      // spell that is not there. `releaseCasting` is where every other ending
      // converges and already answers exactly this; for an ordinary casting it
      // finds no Concentration and does what this line always did.
      return releaseCasting(next, event.id, event.castingId);
    }

    case 'spell-cast': {
      const creature = creatureOf(state, event, event.id);

      // Two shapes reach this event and they are not the same. A casting held
      // open since `spell-declared` **settles** here: its id was allocated
      // then, so the sequence does not move again and the window closes. Every
      // other casting is declared and resolved in one breath, and allocates
      // its own id exactly as it always has — which is why every log written
      // before interruptible castings existed still folds unchanged.
      //
      // Matching on the id rather than on "is anything pending" is what lets a
      // Counterspell be cast *while* a casting is open: its own `spell-cast`
      // is a different casting and takes the ordinary branch. That was already
      // the reading when there was one slot, which is why the keyed record
      // needed nothing of this case but the lookup.
      const settling = state.pendingCastings[event.castingId] !== undefined;

      if (!settling) {
        // Casting ids run in sequence. Applying a batch twice — a retried
        // command appended a second time — lands here with an id that is no
        // longer next, which is a corrupt log rather than a second casting.
        const expected = castingIdFor(state.castingsBegun + 1);
        if (event.castingId !== expected) {
          throw new CorruptLogError(event, `expected casting ${expected}, got ${event.castingId}`);
        }
      }

      const resources =
        event.slot === null
          ? creature.resources
          : must(event, spendResource(creature.resources, event.slot.key));

      const cast = withCreature(next, event.id, { resources }, creature);
      return {
        ...cast,
        castingsBegun: settling ? state.castingsBegun : state.castingsBegun + 1,
        ...(settling ? { pendingCastings: withoutPendingCasting(state, event.castingId) } : {}),
        // SRD: "On a turn, you can expend only one spell slot to cast a spell."
        // It reads *expenditure*, so a casting whose slot is still unspent has
        // not used the turn's one slot — and a countered one never will.
        combat:
          event.slot === null || cast.combat === null
            ? cast.combat
            : markSpellSlotSpent(cast.combat, event.id),
      };
    }

    case 'concentration-started': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already concentrating on ${creature.concentration.castingId}`,
        );
      }
      return withCreature(
        next,
        event.id,
        {
          concentration: { castingId: event.castingId, spell: event.spell, level: event.level },
        },
        creature,
      );
    }

    case 'concentration-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration?.castingId !== event.castingId) {
        throw new CorruptLogError(event, `${event.id} is not concentrating on ${event.castingId}`);
      }
      return releaseCasting(next, event.id, event.castingId);
    }

    case 'effect-scheduled':
      return {
        ...next,
        timers: sortedTimers({
          ...state.timers,
          [timerKey(event.target)]: {
            target: event.target,
            deadline: event.deadline,
            ...(event.repeatSave === undefined ? {} : { repeatSave: event.repeatSave }),
            ...(event.check === undefined ? {} : { check: event.check }),
          },
        }),
      };

    case 'effect-check-resolved': {
      const timer = state.timers[event.effectKey];
      if (timer === undefined) {
        throw new CorruptLogError(event, `no effect is filed under ${event.effectKey}`);
      }
      if (timer.check === undefined) {
        throw new CorruptLogError(event, `${event.effectKey} offers no check to attempt`);
      }
      if (!event.success || timer.check.onSuccess === 'none') return next;

      // The only consequence this union can express, and it is the one the
      // repeat save already performs: the casting's effect on that creature
      // ends, and the casting itself carries on for anyone else it caught.
      if (timer.target.kind !== 'condition') {
        throw new CorruptLogError(
          event,
          `${event.effectKey} ends on its target, but it is not on a creature`,
        );
      }
      const castingId = castingIdOf(timer.target.instance);
      if (castingId === null) {
        throw new CorruptLogError(event, `${event.effectKey} belongs to no casting`);
      }
      return releaseOnTarget(next, timer.target.on, castingId);
    }

    case 'damage-scheduled': {
      const key = scheduledDamageKey(event.schedule.source, event.schedule.target);
      return {
        ...next,
        scheduledDamage: sortedRecord({ ...state.scheduledDamage, [key]: event.schedule }),
      };
    }

    case 'scheduled-damage-collected': {
      if (state.scheduledDamage[event.key] === undefined) {
        throw new CorruptLogError(event, `no damage is scheduled under ${event.key}`);
      }
      const scheduledDamage = { ...state.scheduledDamage };
      delete scheduledDamage[event.key];
      return { ...next, scheduledDamage };
    }

    case 'effect-save-resolved': {
      const key = pendingSaveKey(event.effectKey, event.turn);
      const pending = state.pendingSaves[key];
      if (pending === undefined) {
        throw new CorruptLogError(event, `no save is pending for ${event.effectKey} on turn ${event.turn}`);
      }

      const pendingSaves = { ...state.pendingSaves };
      delete pendingSaves[key];
      const cleared: GameState = { ...next, pendingSaves };
      if (!event.success) return cleared;

      // SRD Hold Person: a success ends the spell "on itself" — on that target,
      // not on everyone the casting caught. An effect whose hook says otherwise
      // ends the casting outright.
      return pending.onSuccess === 'end-casting'
        ? releaseCasting(cleared, casterOf(cleared, pending.castingId), pending.castingId)
        : releaseOnTarget(cleared, pending.target, pending.castingId);
    }

    case 'time-advanced': {
      if (!Number.isInteger(event.seconds) || event.seconds < 0) {
        throw new CorruptLogError(event, `time runs forwards in whole seconds, got ${event.seconds}`);
      }
      return { ...next, elapsed: state.elapsed + event.seconds };
    }

    case 'rest-begun': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting !== null) {
        throw new CorruptLogError(event, `${event.id} is already resting`);
      }
      return withCreature(
        next,
        event.id,
        {
          resting: {
            kind: event.kind,
            startedAt: state.elapsed,
            interruptedBy: null,
            interruptedAt: null,
          },
        },
        creature,
      );
    }

    case 'rest-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting === null) {
        throw new CorruptLogError(event, `${event.id} is not resting`);
      }
      // A Long Rest only starts the sixteen-hour clock if it was actually
      // finished as one. A Long Rest that collapsed into a Short Rest does
      // not, or an interrupted night would lock out the next one.
      return withCreature(
        next,
        event.id,
        {
          resting: null,
          ...(event.benefit === 'long' ? { lastLongRestAt: state.elapsed } : {}),
          // SRD: an interrupted Long Rest of at least an hour "gains the
          // benefits of a Short Rest", so what is recorded is what the rest
          // earned rather than what it set out to be.
          ...(event.benefit === 'short' ? { lastShortRestAt: state.elapsed } : {}),
        },
        creature,
      );
    }

    case 'combat-started':
      return { ...next, combat: must(event, startCombat(event.combatants)) };

    case 'combat-ended':
      // The rites go on running; what goes is which *turn* last sustained one,
      // because turn numbers restart with the next fight.
      return forgetSustainedTurns({ ...next, combat: null });

    case 'turn-advanced': {
      const before = combatOf(state, event);
      const after = advanceTurn(before);
      // A rite the ending turn's caster did not keep at fails **before** the
      // end-of-turn area debts are raised, so the boundary's debts are raised
      // against the world the failure leaves. See `failUnsustainedCastings`.
      return raiseTurnEnd(
        failUnsustainedCastings(
          raiseTurnSaves(withCombat(next, state, after), before, after),
          before,
        ),
        before,
        after,
      );
    }

    // SRD "Longer Casting Times": the Magic action a casting of a minute or
    // more costs on each of the caster's turns. The *failure* is derived at the
    // boundary; taking the action is a decision, so it is this event, and all
    // it does is record which turn saw it.
    //
    // **Three identity facts and no economy.** The backstop here is what a
    // reducer is for — that the casting exists, belongs to this creature and is
    // one the Magic action is owed on. Whether the caster had an Action to
    // spend and whether it was their turn is the `action-spent` the command
    // always emits beside this one, folded through `spendAction`, exactly as
    // `spell-declared` leaves its own economy to the `action-spent` above it.
    case 'casting-continued': {
      const combat = combatOf(state, event);
      const pending = state.pendingCastings[event.castingId];
      if (pending === undefined) {
        throw new CorruptLogError(event, `no casting ${event.castingId} is waiting to resolve`);
      }
      if (pending.caster !== event.id) {
        throw new CorruptLogError(
          event,
          `${event.castingId} is ${pending.caster}'s casting, not ${event.id}'s`,
        );
      }
      if (pending.completesAt === undefined) {
        throw new CorruptLogError(
          event,
          `${event.castingId} takes no more than an instant and is not taken up again`,
        );
      }
      return {
        ...next,
        pendingCastings: {
          ...state.pendingCastings,
          [event.castingId]: { ...pending, sustainedOnTurn: combat.turnsTaken },
        },
      };
    }

    case 'action-spent':
      return withCombat(next, state, must(event, spendAction(combatOf(state, event), event.id)));

    case 'bonus-action-spent':
      return withCombat(
        next,
        state,
        must(event, spendBonusAction(combatOf(state, event), event.id)),
      );

    case 'attack-made': {
      const creature = creatureOf(state, event, event.id);
      return withCombat(
        next,
        state,
        must(
          event,
          spendAttack(
            combatOf(state, event),
            event.id,
            creature.sheet.attacksPerAction ?? 1,
            creature.conditions,
          ),
        ).state,
      );
    }
    // SRD Dash: "The increase equals your Speed **after applying any
    // modifiers**." `speedOf` is the one reader of that, so the fold asks it
    // exactly as `takeDash` does — the command's own check with the command's
    // own inputs, which is the only thing that makes a reducer backstop honest.
    case 'dash-taken':
      return withCombat(
        next,
        state,
        must(event, dash(combatOf(state, event), event.id, speedOf(state, event.id))),
      );
    case 'disengage-taken': {
      return withCombat(
        next,
        state,
        must(event, disengage(combatOf(state, event), event.id)),
      );
    }
    case 'reaction-spent':
      return withCombat(next, state, must(event, spendReaction(combatOf(state, event), event.id)));

    // The allowance is `speedOf`'s, here as in `resolveMove`. This call used to
    // pass no Speed at all and fell back to the pinned one, so the fold
    // measured the very event the command had emitted against a different
    // number — and refused a Monk's legal 35-foot move as a corrupt log. A
    // backstop with the wrong inputs is a fork, not a guard.
    case 'movement-spent':
      return withCombat(
        next,
        state,
        must(
          event,
          spendMovement(combatOf(state, event), event.id, event.feet, speedOf(state, event.id)),
        ),
      );

    case 'free-interaction-used':
      return withCombat(
        next,
        state,
        must(event, useFreeInteraction(combatOf(state, event), event.id)),
      );

    case 'combatant-removed':
      return withCombat(
        next,
        state,
        must(event, removeCombatant(combatOf(state, event), event.id)),
      );

    case 'initiative-swapped':
      return withCombat(
        next,
        state,
        must(event, swapInitiative(combatOf(state, event), event.a, event.b)),
      );

    case 'scene-set':
      return { ...next, scene: scene(event.extent) };

    case 'landmark-added':
      return { ...next, scene: must(event, addLandmark(sceneOf(state, event), event.name, event.at)) };

    case 'creature-placed':
      return {
        ...next,
        scene: must(event, placeCreature(sceneOf(state, event), event.id, event.placement)),
      };

    case 'feature-used': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a once-per-turn feature was used outside combat');
      }
      creatureOf(state, event, event.id);
      return { ...next, combat: markFeatureUsed(state.combat, event.id, event.feature, event.turn) };
    }

    case 'feature-activated': {
      const creature = creatureOf(state, event, event.id);
      if (creature.activeFeatures.includes(event.feature)) {
        throw new CorruptLogError(event, `${event.id} is already in ${event.feature}`);
      }
      return withCreature(
        next,
        event.id,
        { activeFeatures: [...creature.activeFeatures, event.feature].sort() },
        creature,
      );
    }
    case 'feature-ended': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { activeFeatures: creature.activeFeatures.filter((f) => f !== event.feature) },
        creature,
      );
    }
    case 'readied-declared': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied !== null) {
        throw new CorruptLogError(event, `${event.id} is already holding a readied action`);
      }
      return withCreature(next, event.id, { readied: event.readied }, creature);
    }
    case 'readied-released': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied === null) {
        throw new CorruptLogError(event, `${event.id} has no readied action to release`);
      }
      return withCreature(
        next,
        event.id,
        {
          readied: null,
          activeFeatures: creature.activeFeatures.filter((f) => f !== READY),
        },
        creature,
      );
    }
    case 'movement-declared': {
      if (state.pendingMove !== null) {
        throw new CorruptLogError(event, 'a move is already waiting');
      }
      // **Built from the fields this engine knows, never stored verbatim.**
      // Both frozen logs were written when `PendingMove` carried the distance,
      // and nothing ever read it; spreading the event would put a field the
      // type no longer declares into live state for the life of the move —
      // the same data-nothing-can-explain that `upgradeOngoing` keeps out of
      // an ongoing record.
      return {
        ...next,
        pendingMove: {
          mover: event.move.mover,
          placement: event.move.placement,
          destination: event.move.destination,
          provoked: event.move.provoked,
        },
      };
    }
    case 'opportunity-answered': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      return {
        ...next,
        pendingMove: {
          ...waiting,
          provoked: waiting.provoked.filter((p) => p.reactor !== event.reactor),
        },
      };
    }
    case 'movement-completed': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      if (waiting.provoked.length > 0) {
        throw new CorruptLogError(event, 'the move still owes an Opportunity Attack');
      }
      return { ...next, pendingMove: null };
    }
    case 'attack-landed': {
      if (state.pendingAttack !== null) {
        throw new CorruptLogError(event, 'an attack is already being held');
      }
      return { ...next, pendingAttack: event.attack };
    }
    case 'attack-damage-dealt': {
      if (state.pendingAttack === null) {
        throw new CorruptLogError(event, 'no attack is being held');
      }
      return { ...next, pendingAttack: null };
    }
    case 'damage-rolled': {
      if (state.pendingDamage !== null) {
        throw new CorruptLogError(event, 'a damage roll is already being held');
      }
      return { ...next, pendingDamage: event.damage };
    }
    case 'damage-reaction-answered': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      // An answer from somebody who was never offered one is a log and a set of
      // rules that disagree, not a rules dispute — the same loudness a second
      // action in one turn gets.
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this damage`,
        );
      }
      return {
        ...next,
        pendingDamage: {
          ...waiting,
          reductions:
            event.reduction === undefined
              ? waiting.reductions
              : [...waiting.reductions, event.reduction],
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }
    case 'damage-settled': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      if (waiting.target !== event.target) {
        throw new CorruptLogError(
          event,
          `the damage being held is against ${waiting.target}, not ${event.target}`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this damage');
      }
      return { ...next, pendingDamage: null };
    }
    case 'test-rolled': {
      if (state.pendingTest !== null) {
        throw new CorruptLogError(event, 'a D20 Test is already being held');
      }
      return { ...next, pendingTest: event.test };
    }
    case 'test-reaction-answered': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this test`,
        );
      }
      return {
        ...next,
        pendingTest: {
          ...waiting,
          // The pushed roll replaces the old one. The superseded number is on
          // the result itself, so the log still shows what was given up.
          ...(event.result === undefined ? {} : { result: event.result }),
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }
    case 'test-settled': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      if (waiting.who !== event.who) {
        throw new CorruptLogError(
          event,
          `the D20 Test being held is ${waiting.who}'s, not ${event.who}'s`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this test');
      }
      return { ...next, pendingTest: null };
    }
    // Changes nothing, like `roll-recorded`. It exists so the log can say why
    // a creature swung outside its turn, and so the command that did it has a
    // stamp to ride on.
    case 'reaction-taken':
      return next;
    case 'creature-side-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { side: event.side }, creature);
    }
    case 'creature-moved': {
      const outcome = must(
        event,
        moveCreature(
          sceneOf(state, event),
          event.id,
          event.placement,
          event.forced === undefined ? {} : { forced: event.forced },
        ),
      );
      // **The authoritative transition, and the only one that is entry.** A
      // declared move is an intent an Opportunity Attack can end; this is the
      // creature actually arriving. Forced movement lands here too, because a
      // creature shoved into a Web has entered it.
      return raiseAfterMovement({ ...next, scene: outcome.state }, state.scene);
    }

    case 'creature-unplaced':
      return { ...next, scene: must(event, removeCreature(sceneOf(state, event), event.id)) };

    case 'items-gained': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: mergeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'items-lost': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: removeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'coins-changed': {
      const creature = creatureOf(state, event, event.id);
      const coins = creature.coins + event.copper;
      if (coins < 0) {
        throw new CorruptLogError(event, `${event.id} cannot hold ${coins} copper`);
      }
      return withCreature(next, event.id, { coins }, creature);
    }

    case 'item-equipped': {
      const creature = creatureOf(state, event, event.id);
      if (creature.equipped.includes(event.item)) {
        throw new CorruptLogError(event, `${event.item} is already equipped`);
      }
      const equipped = [...creature.equipped, event.item].sort();
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }

    case 'item-unequipped': {
      const creature = creatureOf(state, event, event.id);
      if (!creature.equipped.includes(event.item)) {
        throw new CorruptLogError(event, `${event.item} is not equipped`);
      }
      const equipped = creature.equipped.filter((held) => held !== event.item);
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }

    case 'bonus-applied': {
      const creature = creatureOf(state, event, event.id);
      // Re-applying the same source replaces it rather than stacking: a second
      // Bless from the same casting is the same Bless.
      const bonuses = [
        ...creature.bonuses.filter((held) => held.source !== event.bonus.source),
        event.bonus,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { bonuses }, creature);
    }

    case 'armor-class-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking, the
      // same rule `bonus-applied` follows: a second Mage Armor from the same
      // casting is the same Mage Armor.
      const armorClasses = [
        ...creature.armorClasses.filter((held) => held.source !== event.armorClass.source),
        event.armorClass,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { armorClasses }, creature);
    }

    case 'roll-modifier-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting the same rolls from the same source replaces rather than
      // stacks — the rule `bonus-applied` and `armor-class-granted` follow —
      // but **the source alone is not the identity here**, because one casting
      // can grant two: Beacon of Hope's Wisdom saves and Death Saving Throws
      // are one sentence and two modifiers. See `rollModifierKey`.
      const key = rollModifierKey(event.modifier.source, event.modifier.modifier.selector);
      const rollModifiers = [
        ...creature.rollModifiers.filter(
          (held) => rollModifierKey(held.source, held.modifier.selector) !== key,
        ),
        event.modifier,
      ].sort((a, b) => {
        const left = rollModifierKey(a.source, a.modifier.selector);
        const right = rollModifierKey(b.source, b.modifier.selector);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return withCreature(next, event.id, { rollModifiers }, creature);
    }

    case 'damage-defense-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking —
      // the rule `bonus-applied` and `armor-class-granted` follow, and the one
      // the SRD itself insists on here: "multiple instances of Resistance to
      // the same damage type count as only one", so there is nothing a second
      // copy could add.
      //
      // **The source alone is the identity**, unlike `roll-modifier-granted`.
      // Beacon of Hope needed a per-selector key because one casting grants two
      // modifiers in one sentence; no SRD sentence grants two *defences*, and a
      // per-kind key here would be the identity the `grants` timer deliberately
      // does not have.
      const grantedDefenses = [
        ...creature.grantedDefenses.filter((held) => held.source !== event.defense.source),
        {
          ...event.defense,
          // Lower-cased on the way in, so a fold compares byte for byte however
          // the type was spelled and the keys match the table `applyDamage`
          // sums into.
          damageTypes: [...event.defense.damageTypes.map((t) => t.toLowerCase())].sort(),
        },
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { grantedDefenses }, creature);
    }

    case 'speed-modifier-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, which
      // is the rule `bonus-applied`, `armor-class-granted` and
      // `damage-defense-granted` all follow. **The source alone is the
      // identity**, as it is for a defence: `roll-modifier-granted` needed a
      // per-selector key because Beacon of Hope grants two modifiers in one
      // sentence, and no SRD sentence changes one creature's Speed twice.
      const speedModifiers = [
        ...creature.speedModifiers.filter((held) => held.source !== event.modifier.source),
        event.modifier,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { speedModifiers }, creature);
    }

    case 'attack-rider-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, which
      // is the rule every other grant in the family follows. **The source
      // alone is the identity**, as it is for a defence and a Speed: no SRD
      // sentence hangs two riders on one creature from one casting, and
      // re-casting Hunter's Mark at a new quarry is the *same* casting's rider
      // pointed somewhere else rather than a second one.
      const attackRiders = [
        ...creature.attackRiders.filter((held) => held.source !== event.rider.source),
        event.rider,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { attackRiders }, creature);
    }

    case 'bonus-removed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { bonuses: creature.bonuses.filter((held) => held.source !== event.source) },
        creature,
      );
    }

    case 'spellcasting-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { spellcasting: event.spellcasting }, creature);
    }

    case 'creature-type-declared': {
      const creature = creatureOf(state, event, event.id);
      // A type is durable: a stat block prints it, a species grants it, a DM
      // declares it once. Restating it is harmless and changes nothing;
      // contradicting it is not a new fact but a rewrite of one that Hold
      // Person may already have been cast on the strength of. The command
      // layer refuses that, so a contradiction in the log means it was
      // bypassed — the corrupt-log case. A transformation that legitimately
      // changes a type (Wild Shape, Polymorph) will be its own event.
      if (creature.creatureType === event.creatureType) return next;
      if (creature.creatureType !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already established as ${creature.creatureType}; a declaration cannot make them ${event.creatureType}`,
        );
      }
      return withCreature(next, event.id, { creatureType: event.creatureType }, creature);
    }

    case 'sight-declared':
      return {
        ...next,
        scene: must(event, declareSight(sceneOf(state, event), event.from, event.to, event.seen)),
      };

    case 'cover-declared':
      return {
        ...next,
        scene: must(event, declareCover(sceneOf(state, event), event.from, event.to, event.degree)),
      };

    // Mounting and dismounting move a creature to a space it was not in — SRD
    // charges half your Speed for the first — so both are authoritative
    // transitions and both can carry somebody into an area.
    case 'mounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(
            event,
            mount(sceneOf(state, event), event.rider, event.mount, { willing: event.willing }),
          ),
        },
        state.scene,
      );

    case 'dismounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(event, dismount(sceneOf(state, event), event.rider, event.placement)),
        },
        state.scene,
      );

    // A record, not a mutation: the consequences arrive as their own events.
    case 'roll-recorded':
      return next;

    case 'rolls-issued':
      return { ...next, rollsIssued: state.rollsIssued + event.count, rng: event.rng };
  }

  // **A corrupt log is loud**, and this is the case that was quiet. An event
  // the switch does not recognise used to fall out of it and return
  // `undefined`, which then failed several derived passes later with a
  // TypeError naming a function that had nothing to do with it.
  //
  // That is tolerable while every log is built in this process by these
  // commands. It stops being tolerable the moment logs come back from
  // Postgres as JSON, where a type is a string somebody wrote down last
  // season: a renamed or retired event silently becomes an undefined world.
  //
  // The `never` binding is the other half, and it is free: adding a variant to
  // `GameEvent` without a case here is a compile error rather than a runtime
  // surprise.
  const unhandled: never = event;
  throw new CorruptLogError(
    unhandled as GameEvent,
    'the reducer has no rule for this event type; the log and the code disagree',
  );
}

/** Fold a whole log into the state it describes. */
export function fold(seed: string, events: readonly GameEvent[]): GameState {
  return events.reduce(applyEvent, initialState(seed));
}

/**
 * Everything that has happened to one creature, in order.
 *
 * The point of keeping the log rather than only the state: "show me exactly why
 * the goblin died" is a filter, not an investigation.
 */
export function historyOf(
  events: readonly GameEvent[],
  id: CharacterId,
): readonly GameEvent[] {
  return events.filter((event) => {
    if ('id' in event) return event.id === id;
    if ('rider' in event) return event.rider === id || ('mount' in event && event.mount === id);
    if ('from' in event && 'to' in event) return event.from === id || event.to === id;
    if ('a' in event) return event.a === id || event.b === id;
    if (event.type === 'combat-started') return event.combatants.some((c) => c.id === id);
    return false;
  });
}
