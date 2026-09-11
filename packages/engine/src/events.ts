import type { CharacterId, ConditionName } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { RngState } from './dice.js';
import {
  conditionState,
  expandConditions,
  type ConditionState,
} from './conditions.js';
import {
  advanceTurn,
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
    }
  | { readonly type: 'healed'; readonly id: CharacterId; readonly amount: number }
  | {
      readonly type: 'temporary-hp-granted';
      readonly id: CharacterId;
      readonly amount: number;
    }
  /** The die is already rolled; this records what it was. */
  | {
      readonly type: 'death-save-recorded';
      readonly id: CharacterId;
      readonly natural: number;
    }
  | { readonly type: 'stabilised'; readonly id: CharacterId }

  // — conditions ——————————————————————————————————————————————
  | {
      readonly type: 'condition-applied';
      readonly id: CharacterId;
      readonly condition: ConditionName;
    }
  | {
      readonly type: 'condition-removed';
      readonly id: CharacterId;
      readonly condition: ConditionName;
    }
  | { readonly type: 'exhaustion-set'; readonly id: CharacterId; readonly level: number }

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

export function applyEvent(state: GameState, event: GameEvent): GameState {
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
          },
        },
      };
    }

    case 'creature-removed': {
      creatureOf(state, event, event.id);
      const creatures = { ...state.creatures };
      delete creatures[event.id];
      return { ...next, creatures };
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

    case 'death-save-recorded': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: applyDeathSave(creature.vitals, event.natural) },
        creature,
      );
    }

    case 'stabilised': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: stabilize(creature.vitals) }, creature);
    }

    case 'condition-applied': {
      const creature = creatureOf(state, event, event.id);
      const conditions = conditionState(
        [...creature.conditions.conditions, event.condition],
        creature.conditions.exhaustion,
      );
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'condition-removed': {
      const creature = creatureOf(state, event, event.id);
      // Removing a condition drops anything it was carrying — losing
      // Unconscious lifts the Incapacitated it implied — but Prone persists,
      // as the rules say it does.
      const implied = new Set(expandConditions([event.condition]));
      implied.delete('prone');
      const conditions = conditionState(
        creature.conditions.conditions.filter((c) => !implied.has(c)),
        creature.conditions.exhaustion,
      );
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'exhaustion-set': {
      const creature = creatureOf(state, event, event.id);
      const conditions = conditionState(creature.conditions.conditions, event.level);
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'combat-started':
      return { ...next, combat: must(event, startCombat(event.combatants)) };

    case 'combat-ended':
      return { ...next, combat: null };

    case 'turn-advanced':
      return { ...next, combat: advanceTurn(combatOf(state, event)) };

    case 'action-spent':
      return { ...next, combat: must(event, spendAction(combatOf(state, event), event.id)) };

    case 'bonus-action-spent':
      return { ...next, combat: must(event, spendBonusAction(combatOf(state, event), event.id)) };

    case 'reaction-spent':
      return { ...next, combat: must(event, spendReaction(combatOf(state, event), event.id)) };

    case 'movement-spent':
      return {
        ...next,
        combat: must(event, spendMovement(combatOf(state, event), event.id, event.feet)),
      };

    case 'free-interaction-used':
      return {
        ...next,
        combat: must(event, useFreeInteraction(combatOf(state, event), event.id)),
      };

    case 'combatant-removed':
      return { ...next, combat: must(event, removeCombatant(combatOf(state, event), event.id)) };

    case 'initiative-swapped':
      return {
        ...next,
        combat: must(event, swapInitiative(combatOf(state, event), event.a, event.b)),
      };

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

    case 'rolls-issued':
      return { ...next, rollsIssued: state.rollsIssued + event.count, rng: event.rng };
  }
}

/**
 * Apply a recorded death saving throw.
 *
 * The die has already been rolled; this is the bookkeeping that followed, kept
 * here rather than in `vitals.ts` because `rollDeathSave` owns the rolling and
 * this owns replaying it.
 */
function applyDeathSave(current: Vitals, natural: number): Vitals {
  // SRD: a natural 20 restores 1 hit point outright.
  if (natural === 20) {
    return { ...current, hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false };
  }

  // SRD: a natural 1 costs two failures.
  if (natural === 1) {
    const failures = current.deathSaveFailures + 2;
    const dead = failures >= 3;
    return { ...current, deathSaveFailures: dead ? 0 : failures, dead };
  }

  if (natural >= 10) {
    const successes = current.deathSaveSuccesses + 1;
    return successes >= 3 ? stabilize(current) : { ...current, deathSaveSuccesses: successes };
  }

  const failures = current.deathSaveFailures + 1;
  const dead = failures >= 3;
  return { ...current, deathSaveFailures: dead ? 0 : failures, dead };
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
