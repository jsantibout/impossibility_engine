import type { CharacterId, ConditionName } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { ROUND } from './clock.js';
import type { RngState } from './dice.js';
import {
  applyCondition,
  conditionState,
  isIncapacitated,
  removeCondition,
  removeConditionInstance,
  setExhaustion,
  type ConditionState,
} from './conditions.js';
import {
  declarePool,
  resourceState,
  restoreOn,
  spend as spendResource,
  type PoolDeclaration,
  type Recovery,
  type ResourceState,
} from './resources.js';
import type { RestBenefit, RestKind, RestState } from './rest.js';
import {
  hasExpired,
  timerKey,
  type Deadline,
  type EffectTarget,
  type TimeView,
  type TimedEffect,
} from './duration.js';
import {
  castingIdOf,
  type CastingTime,
  type Concentration,
  type ConcentrationEndReason,
  type SlotlessReason,
} from './spells.js';
import {
  advanceTurn,
  markSpellSlotSpent,
  startCombat,
  spendAction,
  spendBonusAction,
  spendMovement,
  spendReaction,
  useFreeInteraction,
  removeCombatant,
  swapInitiative,
  type CombatState,
  type CombatantInput,
} from './combat.js';
import {
  addLandmark,
  declareCover,
  dismount,
  mount,
  moveCreature,
  placeCreature,
  removeCreature,
  scene,
  type CoverDegree,
  type Placement,
  type PositionState,
  type SceneExtent,
} from './positioning.js';
import {
  applyDamageToVitals,
  grantTemporaryHp,
  heal,
  resolveDeathSave,
  stabilize,
  vitals,
  type Vitals,
} from './vitals.js';

/**
 * The event log.
 *
 * `GameState` is a fold over a list of `GameEvent`s; nothing mutates state by
 * any other route. That is what makes a campaign replayable, auditable — "show
 * me exactly why the goblin died" — and testable end to end.
 *
 * **Events carry resolved outcomes, not intents.** A die is rolled once, when
 * it is rolled, and the result is recorded forever. Replaying the log applies
 * those recorded numbers; it does not roll again. The alternative, replaying
 * intents through the rules, would mean every future rules fix silently
 * rewrote history and a campaign played last week resolved differently today.
 *
 * So randomness enters the log exactly once, at the point of the roll. From
 * there on the fold is a pure function of what is written down, and the seed
 * and generator state are recorded only so a *live* session can carry on
 * rolling where it left off.
 */

export interface CreatureState {
  readonly id: CharacterId;
  readonly name: string;
  readonly sheet: CharacterSheet;
  readonly vitals: Vitals;
  readonly conditions: ConditionState;
  /** Spell slots and every other limited-use pool this creature has. */
  readonly resources: ResourceState;
  /** The one casting this creature is sustaining, if any. */
  readonly concentration: Concentration | null;
  /** The rest this creature is part-way through, if any. */
  readonly resting: RestState | null;
  /** When their last Long Rest finished, for the sixteen-hour rule. */
  readonly lastLongRestAt: number | null;
}

/**
 * What a command did, kept so a retry can be recognised as one.
 *
 * A caller retrying after its first batch was already applied is looking at
 * *updated* state — the slot gone, the casting done. Identical events from
 * identical state says nothing about that case, so commands carry an identity
 * and the fold remembers which ones have landed.
 */
export interface AppliedCommand {
  readonly type: GameEvent['type'];
  /** The casting it produced, so a retry can still link that casting's effects. */
  readonly castingId: string | null;
  /** The inputs it ran with, so reusing its id for different work is caught. */
  readonly fingerprint: string;
}

/**
 * A command's identity on the event it produced.
 *
 * The fingerprint travels with the id because policing reuse needs both: an id
 * alone can only answer "has this landed", never "is this the same command".
 */
export interface CommandStamp {
  readonly id: string;
  readonly fingerprint: string;
}

export interface GameState {
  readonly seed: string;
  /** Generator state, so a resumed session continues the same sequence. */
  readonly rng: RngState | null;
  /** How many roll ids have been issued, so resuming does not reuse one. */
  readonly rollsIssued: number;
  readonly creatures: Readonly<Record<string, CreatureState>>;
  readonly combat: CombatState | null;
  readonly scene: PositionState | null;
  /** Events applied so far, for auditing a single creature's history. */
  readonly eventCount: number;
  /**
   * Castings begun, so the next one's id is known before it happens.
   *
   * A counter rather than a random id: replaying the log has to reproduce the
   * same casting ids, or every effect linked to one dangles after a restart.
   */
  readonly castingsBegun: number;
  /** Command ids already applied, by caller-supplied key. */
  readonly appliedCommands: Readonly<Record<string, AppliedCommand>>;
  /**
   * Seconds since the campaign began.
   *
   * One clock, counting up. There is no calendar and no time of day — those
   * are fiction and the DM owns them. What the rules need is "how long since",
   * which is subtraction.
   */
  readonly elapsed: number;
  /**
   * Effects waiting to run out, keyed by what they will end.
   *
   * Keyed rather than listed so re-applying the same effect from the same
   * source replaces its deadline instead of leaving a stale one behind to end
   * it early.
   */
  readonly timers: Readonly<Record<string, TimedEffect>>;
}

export function initialState(seed: string): GameState {
  return {
    seed,
    rng: null,
    rollsIssued: 0,
    creatures: {},
    combat: null,
    scene: null,
    eventCount: 0,
    castingsBegun: 0,
    appliedCommands: {},
    elapsed: 0,
    timers: {},
  };
}

export type GameEvent =
  // — the cast ————————————————————————————————————————————————
  | {
      readonly type: 'creature-added';
      readonly id: CharacterId;
      readonly name: string;
      readonly sheet: CharacterSheet;
      readonly maxHp: number;
      readonly diesAtZero?: boolean;
    }
  | { readonly type: 'creature-removed'; readonly id: CharacterId }

  // — vitals ——————————————————————————————————————————————————
  /** The amount is already rolled and already reduced by the target's defences. */
  | {
      readonly type: 'damage-taken';
      readonly id: CharacterId;
      readonly amount: number;
      readonly critical?: boolean;
      /** Where it came from, for the audit trail. */
      readonly source?: string;
      /** The command that caused it, so a retry is recognised as one. */
      readonly command?: CommandStamp;
    }
  | { readonly type: 'healed'; readonly id: CharacterId; readonly amount: number }
  | {
      readonly type: 'temporary-hp-granted';
      readonly id: CharacterId;
      readonly amount: number;
    }
  /**
   * SRD: "Temporary Hit Points last until they're depleted or you finish a
   * Long Rest." They are not hit points, so healing does not clear them and
   * the rest has to say so itself.
   */
  | { readonly type: 'temporary-hp-cleared'; readonly id: CharacterId }
  /** The die is already rolled; this records what it was. */
  | {
      readonly type: 'death-save-recorded';
      readonly id: CharacterId;
      /** The die that counted — it alone decides a natural 1 or 20. */
      readonly natural: number;
      /** The modified total, when something added to the roll. */
      readonly total?: number;
    }
  | { readonly type: 'stabilised'; readonly id: CharacterId }

  // — conditions ——————————————————————————————————————————————
  | {
      readonly type: 'condition-applied';
      readonly id: CharacterId;
      readonly condition: ConditionName;
      /**
       * What caused it. Two effects can impose the same condition, and lifting
       * one must not lift the other, so the cause is part of the record.
       */
      readonly source: string;
    }
  | {
      readonly type: 'condition-removed';
      readonly id: CharacterId;
      readonly condition: ConditionName;
      /** Lift only this cause. Omitted, every instance of the condition goes. */
      readonly source?: string;
    }
  | { readonly type: 'exhaustion-set'; readonly id: CharacterId; readonly level: number }
  /**
   * Death that does not come from running out of hit points — Exhaustion
   * reaching 6, a spell that simply kills. Damage is the wrong instrument for
   * these: a healthy creature taking exactly its maximum in damage drops to 0,
   * it does not die.
   */
  | { readonly type: 'creature-died'; readonly id: CharacterId; readonly cause: string }

  // — resources —————————————————————————
  /**
   * A pool exists because something declared it, never because it was derived
   * from a level. Class tables are not modelled; see `resources.ts`.
   */
  | {
      readonly type: 'resource-pool-declared';
      readonly id: CharacterId;
      readonly pool: PoolDeclaration;
    }
  /**
   * Uses taken out of a pool on their own, rather than as part of a casting.
   * Spending a Hit Die on a Short Rest is the first of these.
   */
  | {
      readonly type: 'resource-spent';
      readonly id: CharacterId;
      readonly key: string;
      readonly amount: number;
    }
  | { readonly type: 'resources-restored'; readonly id: CharacterId; readonly recovers: Recovery }

  // — casting ——————————————————————————
  /**
   * One casting of one spell, with its own identity.
   *
   * The slot is expended here, which is why the event carries the pool it came
   * from: replay must reproduce the expenditure without re-deciding it.
   */
  | {
      readonly type: 'spell-cast';
      /** Sequential — `cast:1`, `cast:2` — and checked on replay. */
      readonly castingId: string;
      readonly id: CharacterId;
      readonly spell: string;
      /** The level it was cast at, which is the slot's level when upcast. */
      readonly level: number;
      readonly slot: { readonly key: string; readonly level: number } | null;
      readonly slotless: SlotlessReason | null;
      readonly castingTime: CastingTime;
      readonly concentration: boolean;
      /** The command that caused it, so a retry is recognised as one. */
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'concentration-started';
      readonly id: CharacterId;
      readonly castingId: string;
      readonly spell: string;
      readonly level: number;
    }
  /**
   * Concentration ending by choice or by a failed save.
   *
   * Ending it also ends everything that casting created — SRD: "If the
   * effect's creator loses Concentration, the effect ends" — which the reducer
   * does by the casting id carried in each effect's source, rather than the
   * command enumerating a list a retry could find stale.
   */
  | {
      readonly type: 'concentration-ended';
      readonly id: CharacterId;
      readonly castingId: string;
      readonly reason: ConcentrationEndReason;
    }

  // — the clock ————————————————————————
  /**
   * Time passing outside combat, because somebody said it did.
   *
   * Inside combat the clock is derived — a round is six seconds, and nobody
   * decides that. Out of combat, how long the party spent searching the vault
   * is narration, so it arrives as an event.
   */
  | { readonly type: 'time-advanced'; readonly seconds: number; readonly reason: string }

  // — rests ————————————————————————————
  /**
   * An effect given a moment to stop at.
   *
   * The deadline is already resolved: a relative duration that could not be
   * answered — "the start of your next turn", asked outside combat — is
   * refused by the command, so nothing unanswerable reaches the log.
   */
  | {
      readonly type: 'effect-scheduled';
      readonly target: EffectTarget;
      readonly deadline: Deadline;
    }

  | {
      readonly type: 'rest-begun';
      readonly id: CharacterId;
      readonly kind: RestKind;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'rest-ended';
      readonly id: CharacterId;
      readonly kind: RestKind;
      /** What it earned, which is not always what was attempted. */
      readonly benefit: RestBenefit;
      readonly interrupted?: string;
    }



  // — combat ——————————————————————————————————————————————————
  | { readonly type: 'combat-started'; readonly combatants: readonly CombatantInput[] }
  | { readonly type: 'combat-ended' }
  | { readonly type: 'turn-advanced' }
  | { readonly type: 'action-spent'; readonly id: CharacterId }
  | { readonly type: 'bonus-action-spent'; readonly id: CharacterId }
  | { readonly type: 'reaction-spent'; readonly id: CharacterId }
  | { readonly type: 'movement-spent'; readonly id: CharacterId; readonly feet: number }
  | { readonly type: 'free-interaction-used'; readonly id: CharacterId }
  | { readonly type: 'combatant-removed'; readonly id: CharacterId }
  | {
      readonly type: 'initiative-swapped';
      readonly a: CharacterId;
      readonly b: CharacterId;
    }

  // — the map ——————————————————————————————————————————————————
  | { readonly type: 'scene-set'; readonly extent: SceneExtent }
  | { readonly type: 'landmark-added'; readonly name: string; readonly at: { x: number; y: number; z: number } }
  | { readonly type: 'creature-placed'; readonly id: CharacterId; readonly placement: Placement }
  | {
      readonly type: 'creature-moved';
      readonly id: CharacterId;
      readonly placement: Placement;
      readonly forced?: boolean;
    }
  | { readonly type: 'creature-unplaced'; readonly id: CharacterId }
  | {
      readonly type: 'cover-declared';
      readonly from: CharacterId;
      readonly to: CharacterId;
      readonly degree: CoverDegree;
    }
  | {
      readonly type: 'mounted';
      readonly rider: CharacterId;
      readonly mount: CharacterId;
      readonly willing: boolean;
    }
  | { readonly type: 'dismounted'; readonly rider: CharacterId; readonly placement: Placement }

  /**
   * A roll and everything that shaped it, recorded for the audit trail.
   *
   * This changes no state — the consequences arrive as their own events — but
   * without it the log cannot answer "why did the goblin die". A roll that
   * Bardic Inspiration lifted and Cutting Words then cut shows all three
   * contributions with their sources, rather than one unexplained total.
   */
  | {
      readonly type: 'roll-recorded';
      readonly who: CharacterId;
      /** What was being rolled: "Dexterity save", "Longsword attack". */
      readonly label: string;
      readonly natural: number;
      readonly total: number;
      /** Every named contribution, including ones that subtracted. */
      readonly contributions: readonly { readonly source: string; readonly amount: number }[];
      /** How it came out, in the caller's own words. */
      readonly outcome?: string;
    }

  // — dice ——————————————————————————————————————————————————————
  /**
   * Records that rolls happened, so a resumed session picks the generator up
   * where it left off rather than replaying the same numbers.
   */
  | { readonly type: 'rolls-issued'; readonly count: number; readonly rng: RngState };

/**
 * A log that cannot be applied is corrupt, not a rules dispute.
 *
 * Rules-legal refusals never become events: the command layer asks the engine
 * first and emits nothing if the answer is no. So by the time an event exists
 * it has already been validated, and a failure here means the log and the code
 * disagree — which should be loud.
 */
class CorruptLogError extends Error {
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
const withCombat = (next: GameState, state: GameState, combat: CombatState): GameState => ({
  ...next,
  combat,
  elapsed: state.elapsed + Math.max(0, combat.round - (state.combat?.round ?? combat.round)) * ROUND,
});

const creatureOf = (state: GameState, event: GameEvent, id: CharacterId): CreatureState => {
  const creature = state.creatures[id];
  if (creature === undefined) throw new CorruptLogError(event, `${id} is not in this game`);
  return creature;
};

const withCreature = (
  state: GameState,
  id: CharacterId,
  patch: Partial<CreatureState>,
  creature: CreatureState,
): GameState => ({
  ...state,
  creatures: { ...state.creatures, [id]: { ...creature, ...patch } },
});

const sceneOf = (state: GameState, event: GameEvent): PositionState => {
  if (state.scene === null) throw new CorruptLogError(event, 'no scene has been set');
  return state.scene;
};

const combatOf = (state: GameState, event: GameEvent): CombatState => {
  if (state.combat === null) throw new CorruptLogError(event, 'no combat is running');
  return state.combat;
};

/** Unwrap an engine Result, treating a refusal as a corrupt log. */
function must<T>(event: GameEvent, result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new CorruptLogError(event, result.reason);
  return result.value;
}

/** The id of the nth casting. Sequential and never random, so replay matches. */
export const castingIdFor = (n: number): string => `cast:${n}`;

/**
 * End a casting: drop the caster's Concentration and every effect that casting
 * created, wherever it landed.
 *
 * The link is the casting id carried in each effect's source, so this removes
 * exactly one Cleric's Hold Person and leaves the other Cleric's standing —
 * and leaves alone anything the casting did not create.
 */
function releaseCasting(
  state: GameState,
  casterId: CharacterId | null,
  castingId: string,
): GameState {
  const creatures: Record<string, CreatureState> = {};
  let changed = false;

  for (const key of Object.keys(state.creatures)) {
    const creature = state.creatures[key];
    if (creature === undefined) continue;

    let updated = creature;

    const doomed = creature.conditions.instances.filter(
      (instance) => castingIdOf(instance.source) === castingId,
    );
    if (doomed.length > 0) {
      let conditions = creature.conditions;
      for (const instance of doomed) conditions = removeConditionInstance(conditions, instance.id);
      updated = { ...updated, conditions };
    }

    if (key === casterId && updated.concentration?.castingId === castingId) {
      updated = { ...updated, concentration: null };
    }

    if (updated !== creature) changed = true;
    creatures[key] = updated;
  }

  // A casting that ends early takes its own deadline with it, or a stale timer
  // would sit waiting to end a spell that is already over.
  const key = timerKey({ kind: 'casting', castingId });
  let timers: Record<string, TimedEffect> = state.timers;
  if (state.timers[key] !== undefined) {
    timers = { ...state.timers };
    delete timers[key];
    changed = true;
  }

  return changed ? { ...state, creatures, timers } : state;
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
        castingId: event.type === 'spell-cast' ? event.castingId : null,
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
 * Rebuild the timer record with its keys sorted.
 *
 * Timers reach the event log, and a record whose key order depended on which
 * effect happened to be scheduled first would serialise differently for two
 * identical tables — the same reasoning that sorts condition instances and
 * resource pools.
 */
function sortedTimers(timers: Readonly<Record<string, TimedEffect>>): Record<string, TimedEffect> {
  const sorted: Record<string, TimedEffect> = {};
  for (const key of Object.keys(timers).sort()) {
    const timer = timers[key];
    if (timer !== undefined) sorted[key] = timer;
  }
  return sorted;
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
function expireEffects(state: GameState): GameState {
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
    const timers = { ...current.timers };
    delete timers[key];
    current = { ...current, timers };
    if (timer === undefined) continue;

    const target = timer.target;
    if (target.kind === 'casting') {
      // Ending the casting takes its Concentration and every effect it created.
      const castingId = target.castingId;
      const caster = Object.values(current.creatures).find(
        (c) => c.concentration?.castingId === castingId,
      );
      current = releaseCasting(current, caster?.id ?? null, castingId);
    } else {
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: {
              ...creature,
              conditions: removeConditionInstance(creature.conditions, target.instance),
            },
          },
        };
      }
    }
  }
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const applied = applyOne(state, event);
  return expireEffects(
    breakLostConcentration(recordCommand(interruptedRests(applied, event), event)),
  );
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
      return { ...cleaned, creatures };
    }

    case 'damage-taken': {
      const creature = creatureOf(state, event, event.id);
      const outcome = applyDamageToVitals(
        creature.vitals,
        event.amount,
        event.critical === undefined ? {} : { critical: event.critical },
      );
      return withCreature(next, event.id, { vitals: outcome.vitals }, creature);
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
      return withCreature(next, event.id, { conditions }, creature);
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

    case 'resources-restored': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { resources: restoreOn(creature.resources, event.recovers) },
        creature,
      );
    }

    case 'spell-cast': {
      const creature = creatureOf(state, event, event.id);

      // Casting ids run in sequence. Applying a batch twice — a retried
      // command appended a second time — lands here with an id that is no
      // longer next, which is a corrupt log rather than a second casting.
      const expected = castingIdFor(state.castingsBegun + 1);
      if (event.castingId !== expected) {
        throw new CorruptLogError(event, `expected casting ${expected}, got ${event.castingId}`);
      }

      const resources =
        event.slot === null
          ? creature.resources
          : must(event, spendResource(creature.resources, event.slot.key));

      const cast = withCreature(next, event.id, { resources }, creature);
      return {
        ...cast,
        castingsBegun: state.castingsBegun + 1,
        // SRD: "On a turn, you can expend only one spell slot to cast a spell."
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
          [timerKey(event.target)]: { target: event.target, deadline: event.deadline },
        }),
      };

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
        },
        creature,
      );
    }

    case 'combat-started':
      return { ...next, combat: must(event, startCombat(event.combatants)) };

    case 'combat-ended':
      return { ...next, combat: null };

    case 'turn-advanced':
      return withCombat(next, state, advanceTurn(combatOf(state, event)));

    case 'action-spent':
      return withCombat(next, state, must(event, spendAction(combatOf(state, event), event.id)));

    case 'bonus-action-spent':
      return withCombat(
        next,
        state,
        must(event, spendBonusAction(combatOf(state, event), event.id)),
      );

    case 'reaction-spent':
      return withCombat(next, state, must(event, spendReaction(combatOf(state, event), event.id)));

    case 'movement-spent':
      return withCombat(
        next,
        state,
        must(event, spendMovement(combatOf(state, event), event.id, event.feet)),
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
      return { ...next, scene: outcome.state };
    }

    case 'creature-unplaced':
      return { ...next, scene: must(event, removeCreature(sceneOf(state, event), event.id)) };

    case 'cover-declared':
      return {
        ...next,
        scene: must(event, declareCover(sceneOf(state, event), event.from, event.to, event.degree)),
      };

    case 'mounted':
      return {
        ...next,
        scene: must(
          event,
          mount(sceneOf(state, event), event.rider, event.mount, { willing: event.willing }),
        ),
      };

    case 'dismounted':
      return {
        ...next,
        scene: must(event, dismount(sceneOf(state, event), event.rider, event.placement)),
      };

    // A record, not a mutation: the consequences arrive as their own events.
    case 'roll-recorded':
      return next;

    case 'rolls-issued':
      return { ...next, rollsIssued: state.rollsIssued + event.count, rng: event.rng };
  }
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
