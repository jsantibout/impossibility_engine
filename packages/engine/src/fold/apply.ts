/**
 * The pipeline: one event in, the state it leaves.
 *
 * `applyOne` is the dispatch — thirteen seams, each owning a disjoint region
 * of `GameState`, and an exhaustiveness guarantee in both directions that the
 * single `never` default it replaced could only make in one. See its own
 * docstring; the seam list is `fold-partition.test.ts`'s population and the
 * map is in `docs/design/event-log.md`.
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
import { isIncapacitated } from '../conditions.js';
import type { Content } from '../content.js';
import { READY, universalAction } from '../actions.js';
import { type TimedEffect } from '../timers.js';
import { settleHitPointMaximum } from '../vitals.js';
// The one spelling of Initiative's label, from the module that owns
// Initiative — the fold matches on what `commands/initiative.ts` writes, and
// neither end may spell it for itself. See `INITIATIVE_LABEL`.
import { INITIATIVE_LABEL } from '../combat.js';

import type { GameEvent } from '../events.js';
import type { CreatureState, EquippedItem, GameState, InventoryLine } from '../state.js';
import { initialState } from '../state.js';
import { castingIdOf } from '../spells.js';
import { featureOfSource } from '../progression.js';
import { type Applying, unhandledEvent } from './common.js';
import { releaseCasting, releaseGrants } from './release.js';
import { dropOrphanedAreaEffects } from './areas.js';
import { openTurnStart, reachStartOfTurn } from './turns.js';
import { dropOrphanedSaves, dropStrandedDamage, expireEffects } from './expiry.js';
import {
  endEarlyEndedConditions,
  endTriggeredCastings,
  endTriggeredEffects,
} from './endings.js';

import { applyRoster, isRosterEvent } from './roster.js';
import { applyVitals, isVitalsEvent, raiseDeathBursts } from './vitals.js';
import { applyUpkeep, isUpkeepEvent } from './upkeep.js';
import { applyCasting, isCastingEvent } from './casting.js';
import { applyOngoing, isOngoingEvent } from './ongoing.js';
import { applyTimers, isTimersEvent } from './timers.js';
import { applyCombat, isCombatEvent } from './combat.js';
import { applyScene, isSceneEvent } from './scene.js';
import { applyFeatures, isFeaturesEvent, resized } from './features.js';
import { overriddenSizeOf, printedSizeOf, printsASize } from '../size.js';
import { applyHolds, isHoldsEvent } from './holds.js';
import { applyInventory, isInventoryEvent, withEquipment } from './inventory.js';
import { applyGrants, isGrantsEvent } from './grants.js';
import { applyRolls, isRollsEvent } from './rolls.js';

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
 *
 * **"Rolling Initiative" is the roll, and the fight is a second door to the
 * same moment.** The book names the roll — it is the first bullet under both
 * rests — and for a while this read only `combat-started`, so a DM who asked
 * the table for Initiative before deciding whether the bandits attacked left a
 * Long Rest running through the dice. `recordInitiativeRolls` made that
 * reachable from the public surface; `rollInitiativeFor` had always been able
 * to do it silently.
 *
 * Both are kept rather than one replacing the other, because a fight can start
 * without a roll this engine can see: `beginCombat` takes the totals from the
 * caller, and the SRD's own glossary says "sometimes a GM might have combatants
 * use their Initiative scores **instead of rolling Initiative**". That is the
 * same moment of the same fiction, and a creature resting through the start of
 * a fight is not resting. When both arrive together — which is what
 * `rollInitiativeAndBeginCombat` emits — the first cause wins, and they name
 * the same cause anyway.
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
    case 'roll-recorded':
      if (event.label === INITIATIVE_LABEL) broken.push([event.who, INITIATIVE_LABEL]);
      break;
    case 'combat-started':
      for (const combatant of event.combatants) broken.push([combatant.id, INITIATIVE_LABEL]);
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

export function applyEvent(state: GameState, event: GameEvent): GameState {
  return applyEventUnder(state, event, null);
}

/**
 * {@link applyEvent} bound to the content a log older than pinning was written
 * against — see `Applying.legacy`. A reducer, so a caller stepping a stored
 * log event by event has the same one `fold` uses.
 */
export function applyEventWith(
  legacy: Content | null,
): (state: GameState, event: GameEvent) => GameState {
  return (state, event) => applyEventUnder(state, event, legacy);
}

function applyEventUnder(state: GameState, event: GameEvent, legacy: Content | null): GameState {
  // **A fight beginning starts a turn**, and `turn-advanced` used to be the
  // only event that said so.
  //
  // Derived rather than a seam's, for the reason every pass in this file is:
  // nobody *decides* that the first combatant's turn has begun — `startCombat`
  // settled it when it ranked the order, and says so in a comment of its own.
  //
  // **Here rather than further out, so the marker is standing before anything
  // below reads it.** What this sets is `pendingTurnStart`; what *reaches* the
  // start is `reachStartOfTurn` at the end of the chain, which is the same one
  // place every other turn's start is reached — so the moment arrives after
  // the expiries and the drops, exactly as it does on the ordinary path, and a
  // consequence added there arrives at the opening turn without anybody
  // remembering that fights have two beginnings.
  const settled =
    event.type === 'combat-started'
      ? openTurnStart(applyOne(state, event, legacy))
      : applyOne(state, event, legacy);
  // **What a creature that has just died owes the room.**
  //
  // Derived rather than a seam's, and comparing the world before with the
  // world after rather than reading one event, because that is what the fact
  // *is*: a monster dies inside `applyDamageToVitals`, a character at
  // Exhaustion 6, and `creature-died` is only the deaths nobody else settled.
  //
  // **Here, against the state the event itself left**, before any of the
  // passes below: the burst catches whoever was standing there when the
  // magmin went, and an expiry or a release running first could take one of
  // them out of the room between the death and the moment it is measured.
  // What it raises is a debt and not a die — `resolvePendingSaves` rolls it,
  // and `resolveTurn` refuses to advance while it stands.
  const applied = raiseDeathBursts(state, settled);
  // **Outermost, so it sees every release.** The maximum a spell is holding
  // up is the one grant the fold has to *reconcile* rather than merely carry,
  // and every pass below can take one away: a broken Concentration, a
  // deadline, a dispel, a creature leaving. Settling last means the number is
  // right whichever of them fired, rather than right for the ones somebody
  // remembered.
  return settleHitPointMaxima(reachStartOfTurn(
    // After every pass that can end a feature — a deadline, a lost condition,
    // an explicit ending — because what this puts back is a sheet a feature
    // was holding up, and it has to see the feature gone first. The size an
    // activation prints is settled after the shape for the same reason.
    settleSizes(
    settleShapes(
    // After the drops rather than before them: what ends an attunement is a
    // death or an item gone, and both are facts the event itself left behind.
    endLostAttunements(
      dropOrphanedAreaEffects(
        dropStrandedDamage(
          dropOrphanedSaves(
            dropLapsedReady(
              // **Outside the two passes that end an activation, and inside
              // the four that clean up after a release.** What this reads is
              // an activation that has already gone — a deadline that
              // arrived, a lost condition — and what it may do is end a
              // casting, which the `drop*` passes above are the safety net
              // for.
              // Immediately outside `settleWeaponRiders`, because it is the
              // same fact about the same use read on the other side: the
              // rider the bond hung, and the weapon the bond made. Outside
              // rather than inside so that a rider whose weapon was let go —
              // which ends the *activation* — has already taken the feature
              // out of `activeFeatures` by the time this looks.
              settleConjuredLines(
              settleWeaponRiders(
              expireEffects(
                endLostFeatures(
                  // Between the two passes that already end a casting nobody
                  // decided to end — a lost Concentration above, an arrived
                  // deadline below — because it is the same kind of fact, and
                  // because the four `drop*` passes below are the safety net
                  // for anything a release orphaned.
                  //
                  // **Two populations, one reading of the event.** The inner
                  // pass ends castings a trigger pulled; this one ends timed
                  // conditions nothing ever cast — a potion's Invisible — and
                  // both read the same `EndingFact`s. Outermost of the two so
                  // a casting released above has already taken its own
                  // conditions with it, leaving this walk only what a casting
                  // never owned.
                  // Outermost of the three that read one event for an early
                  // ending, because it is the one that lifts a *condition* and
                  // the two inside it may have lifted the casting that hung
                  // one: a Sleep released above has already taken its
                  // Unconscious away, leaving this walk only the instances a
                  // printed line put there. See {@link endEarlyEndedConditions}.
                  endEarlyEndedConditions(
                    endTriggeredEffects(
                      endTriggeredCastings(
                        breakLostConcentration(
                          recordCommand(interruptedRests(applied, event), event),
                        ),
                        event,
                      ),
                      event,
                    ),
                    event,
                  ),
                ),
              ),
              ),
              ),
            ),
          ),
        ),
      ),
    ),
    ),
    // The world before this event, so the pass sees an override leave.
    state,
    ),
  ));
}

/**
 * A form put back when the feature wearing it has ended.
 *
 * SRD Wild Shape ends four ways nobody commands and one they do — the hours
 * run out, a second use, the Incapacitated condition, death, and a Bonus
 * Action — and every one of them takes the feature out of `activeFeatures`
 * (`expireEffects`, `endLostFeatures`, a `feature-ended`) knowing nothing
 * about a sheet having been swapped. So the swap is undone here, derived, the
 * way a lost Concentration and a lapsed attunement are: the creature's own
 * sheet comes back wearing whatever it is wearing *now*, its size comes back
 * on the creature and on the map, and the Temporary Hit Points stay, because
 * the SRD gives them no end but their own.
 *
 * Nothing is emitted, for the reason `settleHitPointMaxima` emits nothing: a
 * pass that also wrote an event would be a second authority on a fact the
 * feature list already answers for.
 */
function settleShapes(state: GameState): GameState {
  // Nobody is wearing a form whose feature has gone, which is every state but
  // the one event that ends one.
  if (
    !anyCreature(
      state,
      (c) => c.shape !== null && !c.activeFeatures.includes(c.shape.feature),
    )
  ) {
    return state;
  }

  let current = state;
  for (const key of Object.keys(state.creatures).sort()) {
    const creature = current.creatures[key];
    if (creature === undefined || creature.shape === null) continue;
    if (creature.activeFeatures.includes(creature.shape.feature)) continue;

    const { original } = creature.shape;
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [key]: {
          ...creature,
          // The armour is read off what is equipped now, exactly as a level-up
          // reads it: taking a form off does not put back a cloak dropped
          // while it was worn.
          sheet: withEquipment(original.sheet, creature.equipped),
          size: original.size,
          shape: null,
        },
      },
    };
    const footprint = original.sceneSize ?? original.size;
    if (footprint !== null) current = resized(current, creature.id, footprint);
  }
  return current;
}

/**
 * A hit point maximum brought back in line with what is holding it up.
 *
 * SRD Aid raises a maximum for eight hours; the endings that take it away —
 * `releaseCasting`, `releaseGrants`, the expiry pass — all work by filtering a
 * grant out of an array and emit nothing at all. So the subtraction has to be
 * derived, the way a broken Concentration and a lapsed attunement already are,
 * and `settleHitPointMaximum` in `vitals.ts` is the arithmetic.
 *
 * Nothing is emitted, for the reason `endLostAttunements` emits nothing: a
 * pass that also wrote an event would be a second authority on a number the
 * grants already answer for.
 */
function settleHitPointMaxima(state: GameState): GameState {
  // Nobody's maximum has been moved and nobody's is still moved, which is the
  // state of every fight in the book. The second half of the guard is what
  // makes the *release* arrive: the grant is already gone by the time this
  // runs, and only `hpMaxAdjustment` remembers there ever was one.
  if (!anyCreature(state, (c) => c.hitPointMaxima.length > 0 || c.vitals.hpMaxAdjustment !== 0)) {
    return state;
  }

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  let moved = false;

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = creatures[key];
    if (creature === undefined) continue;
    const held = creature.hitPointMaxima.reduce((sum, one) => sum + one.amount, 0);
    const vitals = settleHitPointMaximum(creature.vitals, held);
    if (vitals === creature.vitals) continue;
    moved = true;
    creatures[key] = { ...creature, vitals };
  }

  return moved ? { ...state, creatures } : state;
}

/**
 * Attunements whose item or whose holder is gone.
 *
 * SRD: "Your attunement to an item ends if ... you no longer have the item" —
 * and death ends it too, because a corpse is attuned to nothing. Neither is a
 * decision anybody makes, so both are derived after every event, the way a
 * broken Concentration and a lapsed Rage already are. Nothing is emitted: a
 * pass that also wrote an event would be a second authority on when it ended.
 *
 * **Losing the item is read off the inventory**, which is what "have" means —
 * owning, not wearing. A thief in the night takes the ring and the attunement
 * with it, whichever command described the theft.
 */
function endLostAttunements(state: GameState): GameState {
  // Nobody attuned to anything, which is the state of almost every fight.
  if (!anyCreature(state, (c) => c.attuned.length > 0)) return state;

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  let dropped = false;

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = creatures[key];
    if (creature === undefined || creature.attuned.length === 0) continue;

    const kept = creature.vitals.dead
      ? []
      : creature.attuned.filter((held) =>
          creature.inventory.some((line) => line.id === held.id && line.quantity > 0),
        );
    if (kept.length === creature.attuned.length) continue;

    dropped = true;
    creatures[key] = { ...creature, attuned: kept };
  }

  return dropped ? { ...state, creatures } : state;
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
 * An imbuing that has outlived what it was hung on, or what it was hung *to*.
 *
 * Two clauses of one rule, and the rule is that a benefit keyed to an object
 * lives only as long as the object is in its holder's hands and the thing that
 * imbued it is still running.
 *
 * - **A feature's rider ends with its activation.** SRD Sacred Weapon imbues
 *   one weapon "for 10 minutes or until you use this feature again", and the
 *   activation ends by half a dozen doors — the span, a dismissal, a second
 *   use, a lost condition — not one of which knows that a weapon was imbued.
 *   A `grants` deadline of its own would have covered the first door and none
 *   of the others, so the rider is derived off `activeFeatures` instead: the
 *   moment the feature is gone, so is it.
 * - **A rider that says so ends when its weapon is no longer carried.** SRD
 *   Sacred Weapon: "This effect also ends if you aren't carrying the weapon."
 *   SRD Shillelagh: "the spell ends early ... if you let go of the weapon."
 *   And what ends is what hung it — the whole activation for the first, which
 *   takes the light it shed with it, and the whole casting for the second,
 *   which is what "the spell ends" says.
 *
 * **Declared, not assumed of every rider**, because the book does not say it
 * of every rider: SRD Magic Weapon enchants a weapon for an hour and prints no
 * such clause, so a Mace put down under it is still a magic Mace when it is
 * picked up. `GrantedWeaponRider.endsWhenLetGo` is the sentence; a rider
 * without it is untouched by this clause.
 *
 * **The fold opens no catalogue, and this is why it does not have to.** The
 * rider pins the weapon's catalogue id at the moment of the use, and an
 * inventory line carries the same id, so the question is `id === id` over a
 * list the creature already holds — the same comparison `endLostAttunements`
 * makes one pass along, and the reason "you are holding" is read as *carrying*
 * throughout: an inventory says what a creature has, `equipped` is per kind of
 * thing rather than per hand, and `resolveAttack` gates a swing on the same
 * list. What no pass could do is ask whether the thing in hand is a *Melee*
 * weapon, which is why that question is asked once, at the door, by a command
 * that may read a book.
 */
function settleWeaponRiders(state: GameState): GameState {
  // Nobody is carrying an imbued weapon, which is almost every state.
  if (!anyCreature(state, (c) => c.weaponRiders.length > 0)) return state;

  let current = state;
  const ended: { id: CharacterId; feature: string }[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    for (const rider of state.creatures[key]?.weaponRiders ?? []) {
      const creature = current.creatures[key];
      if (creature === undefined) continue;
      if (!creature.weaponRiders.some((held) => held.source === rider.source)) continue;

      const feature = featureOfSource(rider.source);
      const carried = creature.inventory.some(
        (line) => line.id === rider.weapon && line.quantity > 0,
      );
      // The activation is over by some other door and the rider is what it
      // left behind; nothing else about the creature moves.
      const orphaned = feature !== null && !creature.activeFeatures.includes(feature);
      const letGo = rider.endsWhenLetGo === true && !carried;
      if (!orphaned && !letGo) continue;

      if (feature !== null) {
        if (letGo) ended.push({ id: creature.id, feature });
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [key]: {
              ...releaseGrants(creature, rider.source),
              ...(letGo
                ? { activeFeatures: creature.activeFeatures.filter((f) => f !== feature) }
                : {}),
            },
          },
        };
        continue;
      }

      // A casting's, and the sentence is about the spell rather than about one
      // of its effects: `releaseCasting` takes the rider with everything else
      // that casting is holding up, wherever it landed.
      const castingId = castingIdOf(rider.source);
      current =
        castingId === null
          ? {
              ...current,
              creatures: { ...current.creatures, [key]: releaseGrants(creature, rider.source) },
            }
          : releaseCasting(current, creature.id, castingId);
    }
  }

  if (ended.length === 0) return current;

  // The deadline goes with the activation, for `endLostFeatures`' reason: a
  // stale one would sit waiting to cut the **next** imbuing short.
  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(current.timers)) {
    const target = timer.target;
    const doomed =
      target.kind === 'feature' &&
      ended.some((one) => one.id === target.on && one.feature === target.feature);
    if (!doomed) timers[key] = timer;
  }
  return { ...current, timers };
}

/**
 * A thing a feature conjured, whose feature has stopped running.
 *
 * SRD Pact of the Blade: "A conjured weapon disappears when the bond ends."
 * The sibling of {@link settleWeaponRiders} one pass up, written for exactly
 * the reason that one is: a bond ends by three doors — a second use of the
 * Bonus Action, the `endsOn` list, a condition that takes the feature away —
 * and not one of them knows a weapon was conjured, so a removal hung on any
 * of them would miss the other two.
 *
 * **Folded rather than derived at read time**, which is the one place this
 * differs from the line a *casting* conjures. A casting's line is filtered by
 * `carrying`, because the casting is looked up in `state.ongoing` and a
 * casting id is unique: a second Goodberry is a second casting with a second
 * id, so a lapsed handful and a fresh one never wear the same name. An
 * activation has no such id — the second use of Pact of the Blade is the same
 * feature — so a derived filter would keep the old Glaive alive beside the new
 * Longsword the moment the feature came back on. Dropping it here, in the
 * batch where `feature-ended` was applied and before `feature-activated`
 * reaches the reducer, is what makes "you use this feature's Bonus Action
 * again" end the first bond rather than double it.
 *
 * Nothing is emitted, for `settleShapes`' reason: a pass that also wrote an
 * event would be a second authority on a fact `activeFeatures` answers for.
 */
function settleConjuredLines(state: GameState): GameState {
  // Nobody is carrying anything a feature made, which is almost every state.
  if (!anyCreature(state, (c) => c.inventory.some((line) => line.feature !== undefined))) {
    return state;
  }

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  let moved = false;

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    if (creature === undefined) continue;
    const kept = creature.inventory.filter(
      (line) => line.feature === undefined || creature.activeFeatures.includes(line.feature),
    );
    if (kept.length === creature.inventory.length) continue;

    // **And what was in the hand goes with it.** `equipped` is a fact of its
    // own — which is exactly why `dropItem` refuses to put down what is being
    // wielded rather than quietly unequipping it — and a weapon that has
    // ceased to exist is the one case where nobody can be asked to take it off
    // first. So `equipped` never names something its holder does not own.
    //
    // **A backstop rather than the rule**, and the rule is `equipItem`'s:
    // a conjured line is already in its holder's hands, so equipping one is
    // refused `already_in_hand` and there is nothing here for a log this
    // engine writes to clean up. What this catches is a log assembled by hand,
    // which is the population every derived pass in this file is written for.
    //
    // **Only where nothing that is left backs the wielding.** A Warlock who
    // bonds a Longsword while carrying one of their own has two lines — the
    // conjured one is keyed by the record it was given at the conjuring, and a
    // conjured *handful* by the casting or the activation it names, but never
    // by the kind the pack's copy is under — and the pack's copy is what keeps
    // the wielding standing when the pact weapon goes.
    //
    // It writes `equipped` without going back through `withEquipment`, so the
    // sheet's armour view is not recomputed. Harmless by construction rather
    // than by luck: `conjuresWeapon` requires an `imbuesWeapon` beside it and
    // `imbuedWeapon` refuses anything the catalogue does not print a weapon
    // record for, so only a weapon can ever be dropped here and no armour or
    // shield can.
    //
    // **A wielding that names no copy is about the kind**, which is
    // `dropItem`'s reading of the same pair of facts and written in the same
    // words: a hand-written `item-equipped` says "a Glaive", and the conjured
    // Glaive carries a record of its own, so an equality between the two
    // records would have left the wielding standing over a weapon that had
    // ceased to exist. A wielding that *does* name a copy is about that copy
    // and nothing else.
    const gone = creature.inventory.filter((line) => !kept.includes(line));
    const backs = (line: InventoryLine, worn: EquippedItem): boolean =>
      line.id === worn.id && (worn.instance === undefined || worn.instance === line.instance);
    const equipped = creature.equipped.filter(
      (worn) => kept.some((line) => backs(line, worn)) || !gone.some((line) => backs(line, worn)),
    );

    creatures[key] = { ...creature, inventory: kept, equipped };
    moved = true;
  }

  return moved ? { ...state, creatures } : state;
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
  // A form is held by nothing but its holder's wits. SRD Wild Shape ends "if
  // you have the Incapacitated condition, or die", so a shape's feature is
  // dropped on either and `settleShapes` puts the sheet back.
  if ((creature.sheet.shapeShifts ?? []).some((shape) => shape.feature === feature)) {
    return !creature.vitals.dead && !isIncapacitated(creature.conditions);
  }
  const definition =
    (creature.sheet.activated ?? []).find((a) => a.feature === feature) ??
    universalAction(feature);
  if (definition === null || definition === undefined) return true;

  for (const requirement of definition.endsOn ?? []) {
    if (requirement === 'incapacitated' && isIncapacitated(creature.conditions)) return false;
    if (requirement === 'heavy-armor' && wearsHeavyArmor(creature)) return false;
    // SRD Pact of the Blade: "Your bond with the weapon ends ... if you die."
    // Read here rather than raised anywhere, so the bond, its rider and the
    // weapon it conjured all go on the same pass a dropped condition takes.
    if (requirement === 'death' && creature.vitals.dead) return false;
  }
  return true;
}

/** SRD Rage: "if you aren't wearing Heavy armor", and "if you don Heavy armor". */
export function wearsHeavyArmor(creature: CreatureState): boolean {
  return creature.equipped.some((held) => held.armor?.category === 'heavy');
}

/**
 * The map's copy of a size an activation prints — SRD Large Form.
 *
 * Derived, for the reason `settleShapes` is: every route out of a feature — a
 * deadline, a lost condition, an explicit ending — drops it from
 * `activeFeatures` knowing nothing about a size, so the size is read off what
 * is active *now*: the one a running activation prints, else the creature's
 * own. The scene's copy is brought to it, and nothing is emitted.
 *
 * **Only for a creature that holds such a feature at all.** A size the table
 * stated when it placed a creature — "shrinking a hound is the table's" — is
 * the map's to keep, and a derivation that pulled every creature back to its
 * record would overrule it; so a creature whose sheet prints no size under any
 * activation is not read here, and one that does has its map size owned by
 * this pass for as long as it holds the feature. Only where the creature is
 * standing somewhere and its own size is known.
 */
function settleSizes(state: GameState, before: GameState): GameState {
  const scene = state.scene;
  if (scene === null) return state;
  let current = state;
  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    if (creature === undefined || creature.size === null || scene.sizes[key] === undefined) continue;
    // Only a creature whose sheet prints a size is settled: a DM who stated a
    // size on the map for anybody else is not overruled by the record.
    //
    // **Or one a running effect has moved, or has just stopped moving.** SRD
    // Enlarge/Reduce's step is a sourced grant, read here over the same base
    // every other reader takes, so the map grows with the fighter — and the
    // event that released the grant is the one moment the map has to be given
    // back, which is why the world before the event is read beside the world
    // after it: a creature that carried an override a moment ago is owned by
    // this pass for exactly that one event.
    const moved =
      creature.sizeOverrides.length > 0 ||
      (before.creatures[key]?.sizeOverrides.length ?? 0) > 0;
    if (!printsASize(creature) && !moved) continue;
    const wanted = overriddenSizeOf(creature, printedSizeOf(creature) ?? creature.size);
    if (scene.sizes[key] !== wanted) current = resized(current, creature.id, wanted);
  }
  return current;
}

/**
 * One event in, the state it leaves — routed to the seam that owns its type.
 *
 * **This is still the one entry**, and the thirteen seams below are not
 * competing authorities: none of them is reachable from `commands/`, none is
 * published by `index.ts`, and a log becomes a state by exactly the route it
 * always did. What changed is that a task changing a casting rule and a task
 * changing a condition no longer edit the same file — which is what the
 * one-owner-per-primitive rule serialises, and what made three of tranche 6's
 * merges wait on each other in one 1,796-line switch.
 *
 * **A seam is a region of `GameState`**, not a subject somebody grouped by
 * eye: `roster.ts` owns the `creatures` keyspace, `vitals.ts` a creature's hit
 * points and conditions, `casting.ts` the `pendingCastings` record and
 * `ongoing.ts` the spell left running — which is the cut `commands/casting.ts`
 * and `commands/ongoing.ts` already make one layer up. Where the rule and a
 * coarser grouping disagree, the rule wins, because a grouping that is
 * adjusted case by case is the taste this split exists to stop encoding.
 *
 * **The exhaustiveness guarantee did not get weaker, it got two halves.** The
 * `never` default this replaced caught one thing: a union member with no case.
 * Each seam still carries one over its own narrowed union, so a type a seam
 * *claims* and has no case for is a compile error; and the `unhandledEvent`
 * below sees whatever no guard matched, which narrows to `never` only when the
 * thirteen cover the union — so a type **no** seam claims is a compile error
 * too. What neither can see is a type claimed *twice*, which is a partition
 * fact rather than a type fact, so `fold-partition.test.ts` derives it from
 * the union and asserts exactly-one.
 */
function applyOne(state: GameState, event: GameEvent, legacy: Content | null): GameState {
  const applying: Applying = {
    state,
    next: { ...state, eventCount: state.eventCount + 1 },
    legacy,
  };

  if (isRosterEvent(event)) return applyRoster(applying, event);
  if (isVitalsEvent(event)) return applyVitals(applying, event);
  if (isUpkeepEvent(event)) return applyUpkeep(applying, event);
  if (isCastingEvent(event)) return applyCasting(applying, event);
  if (isOngoingEvent(event)) return applyOngoing(applying, event);
  if (isTimersEvent(event)) return applyTimers(applying, event);
  if (isCombatEvent(event)) return applyCombat(applying, event);
  if (isSceneEvent(event)) return applyScene(applying, event);
  if (isFeaturesEvent(event)) return applyFeatures(applying, event);
  if (isHoldsEvent(event)) return applyHolds(applying, event);
  if (isInventoryEvent(event)) return applyInventory(applying, event);
  if (isGrantsEvent(event)) return applyGrants(applying, event);
  if (isRollsEvent(event)) return applyRolls(applying, event);

  return unhandledEvent(event);
}

/**
 * Fold a whole log into the state it describes.
 *
 * `legacy` is for a log written before the engine pinned every fact the fold
 * reads — see `Applying.legacy`. A log this engine writes needs none, and
 * passing content for one changes nothing: a pinned record is read as pinned.
 */
export function fold(
  seed: string,
  events: readonly GameEvent[],
  legacy: Content | null = null,
): GameState {
  return events.reduce((state, event) => applyEventUnder(state, event, legacy), initialState(seed));
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
