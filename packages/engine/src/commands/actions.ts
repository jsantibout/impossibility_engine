/**
 * The actions that change what a turn can do.
 *
 * Dash, Disengage, Dodge, and Ready with the release that answers it. Ready is
 * why this module sits at the top: releasing a readied spell runs the whole
 * casting path, and holding one runs part of it at the moment of readying.
 */

import { type CommandIdentity, once } from '../idempotency.js';
import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { DODGE, DODGE_ACTION, READY, READY_ACTION } from '../actions.js';
import { dash, disengage, spendAction, spendReaction, useFreeInteraction } from '../combat.js';
import { conditionSpeed } from '../conditions.js';
import {
  applyEvent,
  type GameEvent,
  type GameState,
  type ReadiedAction,
  type ReadiedResponse,
} from '../events.js';
import { type Placement, type Point } from '../positioning.js';
import { type SlotKind } from '../resources.js';
import { definitionFor } from '../spell-definitions.js';
import { castSpell, chooseRoute, type ConcentrationSaveSupply, nextCastingId } from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { schedule } from './conditions.js';
import { featureTimer } from './features.js';
import { mayAct } from './holds.js';
import { type MoveResolution, moveWithin } from './movement.js';
import { castOrRelease } from './spell-resolution.js';
import { type SpellResolution } from './targeting.js';

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed after applying any modifiers."
 */
export function takeDash(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  return once(state, `dash:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there is no movement budget to add to outside combat');
    }

    // Validate the whole operation before any of it is emitted: the action has
    // to be there to spend, and the increase has to be one this creature can
    // actually receive.
    const spent = spendAction(state.combat, id, creature.conditions);
    if (!spent.ok) return spent;
    const dashed = dash(spent.value, id, creature.conditions);
    if (!dashed.ok) return dashed;

    return ok([
      { type: 'action-spent', id },
      { type: 'dash-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
 * rest of the current turn."
 */
export function takeDisengage(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  return once(state, `disengage:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there are no Opportunity Attacks to avoid outside combat');
    }

    const spent = spendAction(state.combat, id, creature.conditions);
    if (!spent.ok) return spent;
    const taken = disengage(spent.value, id);
    if (!taken.ok) return taken;

    return ok([
      { type: 'action-spent', id },
      { type: 'disengage-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * SRD Dodge: "until the start of your next turn, any attack roll made against
 * you has Disadvantage if you can see the attacker, and you make Dexterity
 * saving throws with Advantage."
 *
 * An action anybody can take, so the benefits come out of `actions.ts` rather
 * than off a sheet — but everything else about it is the shape `activateFeature`
 * already has, including the turn-anchored deadline and the end when the
 * dodger is Incapacitated.
 */
export function takeDodge(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  return once(state, `dodge:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (creature.activeFeatures.includes(DODGE)) {
      return err('already_active', `${id} is already Dodging`);
    }

    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[id] !== undefined) {
      const spent = spendAction(state.combat, id, creature.conditions);
      if (!spent.ok) return spent;
      events.push({ type: 'action-spent', id });
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: DODGE,
      ...(stamp === null ? {} : { command: stamp }),
    });

    const timer = featureTimer(state, id, DODGE_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/**
 * Open the door on the way past.
 *
 * SRD: "You can interact with one object or feature of the environment for
 * free, during either your move or action", and "when time is short, such as
 * in combat, interactions with objects are limited: one free interaction per
 * turn. Any additional interactions require the Utilize action."
 *
 * `useFreeInteraction` has enforced exactly that since the action economy
 * landed, with one caller: the **reducer**, folding an event no command wrote.
 *
 * **Outside combat there is nothing to limit**, so this refuses rather than
 * quietly succeeding: the allowance is per *turn*, there are no turns, and the
 * reducer throws for a `free-interaction-used` with no combat. That is the one
 * place this differs from Dodge, which has a benefit worth having either way.
 *
 * **It spends from the turn budget, so `mayAct` applies.** The action-economy
 * sweep derives that from the call rather than from this sentence —
 * `useFreeInteraction` is one of its seeds, beside the five that spend an
 * Action, a Bonus Action, a Reaction, movement or an attack, because the
 * budget field it consumes is one of the same six.
 */
export function useFreeObjectInteraction(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `free-interaction:${id}`, command, () => [], (stamp) => {
    // **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    if (state.combat === null) {
      return err(
        'not_in_combat',
        'interactions are limited to one a turn only when time is short; outside combat there is no turn to spend one on',
      );
    }

    const spent = useFreeInteraction(state.combat, id);
    if (!spent.ok) return spent;

    return ok([
      { type: 'free-interaction-used', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * What a Ready is being held for, and what it will do.
 *
 * The trigger is free text and stays that way. SRD asks for "a perceivable
 * circumstance", and the circumstances a table readies against live almost
 * entirely in fiction the engine has never been told about — a trapdoor, a
 * chant, a door. **Absence from structured state is not evidence that a thing
 * does not exist**, so an engine that judged the trigger would be refusing
 * readied actions on the strength of its own ignorance. Maestro says when it
 * fired; everything around it is the engine's.
 */
export interface ReadyCommand extends CommandIdentity {
  readonly trigger: string;
  readonly response: ReadyResponse;
}

/** The response as a caller states it, before the engine has paid for it. */
export type ReadyResponse =
  | { readonly kind: 'action'; readonly note?: string }
  | { readonly kind: 'move' }
  | {
      readonly kind: 'spell';
      readonly spellId: string;
      /** The slot to expend now. Omitted for a cantrip. */
      readonly slotLevel?: number;
      readonly slotKind?: SlotKind;
      readonly source?: string;
    };

/** What this creature is holding for a trigger, or null. */
export function readiedBy(state: GameState, id: CharacterId): ReadiedAction | null {
  return creatureOf(state, id)?.readied ?? null;
}

/**
 * Ready an action: spend it now, to take a Reaction later.
 *
 * SRD: "You take the Ready action to wait for a particular circumstance before
 * you act. To do so, you take this action on your turn, which lets you act by
 * taking a Reaction before the start of your next turn."
 *
 * The deadline is the same turn-anchored one Dodge uses, expressed the same
 * way — an activated feature with a timer — because the benefit has to outlive
 * the turn that bought it, and a turn budget is cleared when the turn ends.
 *
 * A readied **spell** is the SRD's own special case and the only part of this
 * the engine has real rules for: "you cast it as normal (expending any
 * resources used to cast it) but hold its energy, which you release with your
 * Reaction when the trigger occurs... To be readied, a spell must have a
 * casting time of an action, and holding on to the spell's magic requires
 * Concentration." So the slot goes now and the effects do not, which is why
 * the casting and its resolution are two commands rather than one.
 */
export function takeReady(
  state: GameState,
  id: CharacterId,
  command: ReadyCommand,
): Result<GameEvent[]> {
  return once(state, `ready:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    // SRD: "you take this action on your turn, which lets you act by taking a
    // Reaction before the start of your next turn." Both halves need turns.
    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'a readied action waits for a Reaction, and there are no turns to take one in');
    }
    if (creature.readied !== null) {
      return err('already_readied', `${id} is already holding a readied action`);
    }
    if (command.trigger.trim() === '') {
      return err('no_trigger', 'a readied action waits for something; say what');
    }

    // Validate the whole thing before any of it is emitted, casting included:
    // a Ready that refuses must leave the action, the slot and the
    // Concentration exactly as they were.
    const spent = spendAction(state.combat, id, creature.conditions);
    if (!spent.ok) return spent;

    const events: GameEvent[] = [{ type: 'action-spent', id }];
    let response: ReadiedResponse;

    if (command.response.kind === 'spell') {
      const held = holdSpell(state, id, command.response);
      if (!held.ok) return held;
      events.push(...held.value.events);
      response = held.value.response;
    } else if (command.response.kind === 'move') {
      response = { kind: 'move' };
    } else {
      response = {
        kind: 'action',
        ...(command.response.note === undefined ? {} : { note: command.response.note }),
      };
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: READY,
      ...(stamp === null ? {} : { command: stamp }),
    });
    events.push({ type: 'readied-declared', id, readied: { trigger: command.trigger, response } });

    const timer = featureTimer(state, id, READY_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/**
 * Cast the spell being readied, without resolving it.
 *
 * SRD: "you cast it as normal (expending any resources used to cast it) but
 * hold its energy." So this is an ordinary casting with the effects left
 * undone — the slot goes, and the Concentration that holds the magic starts,
 * whether or not the spell itself is a Concentration spell.
 *
 * The action is **not** spent here: the Ready action is the casting's action,
 * and charging for both would take two actions for one thing the SRD charges
 * once for. `castSpell` is the half beneath `resolveCast` that leaves the
 * economy alone, which is exactly the half this wants.
 */
function holdSpell(
  state: GameState,
  id: CharacterId,
  response: ReadyResponse & { readonly kind: 'spell' },
): Result<{ readonly events: readonly GameEvent[]; readonly response: ReadiedResponse }> {
  const definition = definitionFor(response.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${response.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD: "To be readied, a spell must have a casting time of an action."
  if (definition.castingTime !== 'action') {
    return err(
      'not_readiable',
      `${definition.name} is cast with a ${definition.castingTime}, and only a spell cast with an action can be readied`,
    );
  }

  const caster = creatureOf(state, id);
  if (caster === null) return unknownCreature(id);

  // SRD: you ready what you know or have prepared, and nothing else.
  const chosen = chooseRoute(caster.spellcasting, response.spellId, response.source);
  if (!chosen.ok) return chosen;
  const route = chosen.value;

  const castLevel = Math.max(definition.level, response.slotLevel ?? definition.level);
  const castingId = nextCastingId(state);

  const cast = castSpell(state, id, {
    spell: definition.name,
    level: definition.level,
    // SRD: "holding on to the spell's magic requires Concentration" — for
    // every readied spell, not only the ones whose own Duration says so.
    concentration: true,
    castingTime: definition.castingTime,
    ...(response.slotLevel === undefined
      ? { slotless: 'cantrip' as const }
      : {
          slotLevel: response.slotLevel,
          ...(response.slotKind === undefined ? {} : { slotKind: response.slotKind }),
        }),
    route: route.kind === 'granted' ? route.grant.source : `class:${route.classId}`,
    // No duration. The spell has not taken effect, so its own clock has not
    // started; what *is* capped is the hold, and that is the Ready feature's
    // deadline rather than the spell's.
  });
  if (!cast.ok) return cast;

  return ok({
    events: cast.value,
    response: { kind: 'spell', spellId: response.spellId, castingId, castLevel },
  });
}

/**
 * What letting the held action go actually did.
 *
 * One shape with two optional halves rather than a union, because what the
 * release *always* does — spend the Reaction, close the hold — is the same
 * whichever response was held, and the rest is what that response happened to
 * be. An `action` response fills in neither: the engine has commands for a
 * handful of the SRD's open action list, so the caller takes it from here.
 */
export interface ReadyRelease {
  readonly events: readonly GameEvent[];
  /** Whether the Reaction was taken, or the trigger let pass. */
  readonly took: boolean;
  /** The spell that landed, for a readied spell. */
  readonly spell?: SpellResolution;
  /** The move that was made, for a readied move. */
  readonly move?: MoveResolution;
}

/** How the held action is being let go. */
export interface ReleaseCommand extends CommandIdentity {
  /**
   * SRD: "you can either take your Reaction right after the trigger finishes
   * **or ignore the trigger**." Ignoring costs nothing and keeps the Reaction.
   */
  readonly ignore?: boolean;
  /** Who a readied spell lands on. Empty for an area spell, which picks its own. */
  readonly targets?: readonly CharacterId[];
  /** Where a readied area spell's origin goes. */
  readonly at?: Point;
  /** Where a readied move goes, relative to something already established. */
  readonly placement?: Placement;
  /** How many feet of that move are through Difficult Terrain. */
  readonly difficultFeet?: number;
}

/**
 * Take the Reaction a readied action was held for — or let the trigger pass.
 *
 * The trigger is Maestro's call and has already been made by the time this is
 * reached; what the engine owns is the Reaction, the hold, and, for a readied
 * spell, everything the spell does.
 *
 * For an `action` response this spends the Reaction and clears the hold; the
 * action itself goes through its own command afterwards, because the SRD's
 * action list is open and the engine has commands for a handful of it. An
 * attack taken this way is `resolveAttack({ free: true })` — the Reaction is
 * what paid for it, exactly as an Opportunity Attack is.
 */
export function releaseReady(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
): Result<ReadyRelease> {
  // Without this the retry came back `nothing_readied` — a refusal, telling
  // the caller the hold never existed when in fact their first call consumed
  // it. A retry that reads as a rules problem is worse than one that doubles,
  // because the DM narrates the lie.
  return once(state, `release:${id}`, command, () => ({ events: [], took: true }), (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    const readied = creature.readied;
    if (readied === null) {
      return err('nothing_readied', `${id} is not holding a readied action`);
    }

    // SRD: "or ignore the trigger." Nothing is spent and nothing happens — but
    // the hold is gone, because the trigger it was waiting for has been and
    // passed. A held spell dissipates with it.
    if (command.ignore === true) {
      return ok({
        events: [
          {
            type: 'readied-released',
            id,
            took: false,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        took: false,
      });
    }

    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'there is no Reaction to spend outside combat');
    }
    const spent = spendReaction(state.combat, id, creature.conditions);
    if (!spent.ok) return spent;

    const events: GameEvent[] = [
      { type: 'reaction-spent', id },
      { type: 'readied-released', id, took: true, ...(stamp === null ? {} : { command: stamp }) },
    ];

    if (readied.response.kind === 'spell') {
      return releaseSpell(state, id, readied.response, command, supply, events);
    }
    if (readied.response.kind === 'move') {
      return releaseMove(state, id, command, supply, events);
    }

    return ok({ events, took: true });
  });
}

/**
 * Move as the Reaction a Ready held back.
 *
 * SRD: "you choose to move up to your Speed in response to it." The Reaction
 * is what paid for this, so no Speed is spent — a turn budget belongs to a
 * turn and this is somebody else's, which is why `spendMovement` refuses it by
 * construction and is right to. The allowance is the mover's Speed **now**,
 * after whatever conditions have arrived since they readied: a creature
 * Grappled while waiting has a Speed of 0 and goes nowhere.
 *
 * Everything else is an ordinary move. It provokes, because it is the
 * creature's own movement and SRD offers the Opportunity Attack for leaving a
 * reach without caring what paid for the leaving.
 */
function releaseMove(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  if (command.placement === undefined) {
    return err('no_placement', `${id} readied a move; say where to`);
  }

  const combat = state.combat;
  const creature = creatureOf(state, id);
  if (combat === null || creature === null) {
    return err('not_in_combat', 'there is no Reaction to spend outside combat');
  }

  const declared = combat.order.find((c) => c.id === id)?.speed ?? creature.sheet.baseSpeed;
  const allowance = Math.max(0, conditionSpeed(creature.conditions, declared));

  const after = spentSoFar.reduce(applyEvent, state);
  const moved = moveWithin(
    after,
    id,
    {
      placement: command.placement,
      ...(command.difficultFeet === undefined ? {} : { difficultFeet: command.difficultFeet }),
    },
    supply,
    allowance,
  );
  if (!moved.ok) return moved;

  return ok({
    events: [...spentSoFar, ...moved.value.events],
    took: true,
    move: moved.value,
  });
}

/**
 * Let a held spell go, and resolve it where it lands.
 *
 * The slot went when it was readied, so nothing is paid here. What still has
 * to happen is the half `castSpell` would have done had the spell been cast
 * normally at this moment: the Concentration settles, and the spell's own
 * duration starts now rather than when the magic was first gathered.
 */
function releaseSpell(
  state: GameState,
  id: CharacterId,
  response: ReadiedResponse & { readonly kind: 'spell' },
  command: ReleaseCommand,
  supply: ConcentrationSaveSupply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  const definition = definitionFor(response.spellId);
  if (definition === null) {
    return err('no_definition', `${response.spellId} has no executable definition`);
  }

  const events: GameEvent[] = [...spentSoFar];

  // The Concentration was holding the magic, not the spell. A spell whose own
  // Duration does not say Concentration has nothing left to concentrate on
  // once it has happened, so the hold ends — **before** the effects land, or
  // ending the casting would take the conditions the release just created.
  if (!definition.concentration) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: response.castingId,
      reason: 'released',
    });
  }

  const after = events.reduce(applyEvent, state);
  const resolved = castOrRelease(
    after,
    id,
    {
      spellId: response.spellId,
      targets: command.targets ?? [],
      ...(command.at === undefined ? {} : { at: command.at }),
      ...(definition.level === 0 ? {} : { slotLevel: response.castLevel }),
    },
    supply,
    { castingId: response.castingId },
  );
  // A refusal of any kind takes the whole batch with it: the Reaction is
  // still there and the spell is still held. That was already true of a rules
  // refusal; it is now true of a missing fact too, which used to come back as
  // a success and needed unpicking here.
  if (!resolved.ok) return resolved;

  events.push(...resolved.value.events);

  // SRD writes a readied spell's Duration from the moment it takes effect, and
  // that moment is now. `castSpell` would have scheduled this at the casting;
  // the casting was a turn ago and did nothing.
  if (definition.durationSeconds !== undefined) {
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'casting', castingId: response.castingId },
      { kind: 'seconds', seconds: definition.durationSeconds },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok({ events, took: true, spell: resolved.value });
}

