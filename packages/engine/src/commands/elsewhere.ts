/**
 * The doors on a creature's second place: out, back, and what a stay costs.
 *
 * One primitive under several sentences. `sendingEvents` is the batch that
 * takes a creature out of the scene, and every road out builds it — Blink's
 * die at a turn boundary, a familiar's dismissal, a climb into a Rope Trick,
 * a Giant Frog's Swallow. `settleReturn` is the one place a way back is
 * checked: against the rule the record pinned when the creature left, never
 * against a book. `returnFromElsewhere` is the command for a creature whose
 * casting has ended or whose host has died; the familiar's recall and the
 * boundary's own returns go through the same check.
 *
 * **The way back is stated, never invented.** A caller names a space; the
 * engine refuses one too far, one somebody is standing in, one outside the
 * scene, or one the creature cannot see where the book says it must. Where
 * nobody names one, the engine takes the single space that qualifies and
 * otherwise asks — the same boundary `eligibleTargets` draws for targeting.
 */
import {
  type CharacterId,
  type ConditionName,
  err,
  type Err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import type { Content } from '../content.js';
import {
  describeElsewhere,
  heldInside,
  keptElsewhereSource,
  returnAnchor,
  returnCandidates,
  type ElsewhereDamage,
  type ElsewhereKind,
  type ElsewhereReturn,
} from '../elsewhere.js';
import {
  distanceBetweenPoints,
  distanceToPoint,
  placeCreature,
  type Placement,
  type Point,
  type PositionState,
} from '../positioning.js';
import { castingIdOf, castingSource } from '../spells.js';
import { canSee } from '../standing.js';
import { effectiveSizeOf } from '../size.js';
import { isDue, timeView, type TurnMoment } from '../time.js';
import { rollRecorded } from '../rolls.js';
import { anchorNeeded, creatureOf, sceneFor, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import type { Supply } from './casting.js';
import { rollSpellDice } from './rolls.js';
import { dealSpellDamage } from './damage.js';
import { ongoingSpellsOn } from './ongoing.js';
import type { EffectContext, EffectOfKind } from './spell-effect-context.js';

// — out ———————————————————————————————————————————————————————————————————————

/** What a road out of the scene states about the leaving. */
export interface Sending {
  readonly kind: ElsewhereKind;
  readonly host?: CharacterId;
  readonly source: string;
  readonly returns: ElsewhereReturn;
  readonly damage?: ElsewhereDamage;
  /** What the record hangs while the creature is away, filed under `source`. */
  readonly conditions?: readonly ConditionName[];
}

/**
 * The batch that takes a creature out of the scene.
 *
 * `creature-sent-elsewhere` first, so the fold reads the space left off a
 * scene the creature is still standing in; then whatever the record hangs, as
 * ordinary `condition-applied` events under the record's source — which is
 * what `creature-returned` lifts. A creature already away is refused: two
 * records would be two ways back.
 */
export function sendingEvents(
  state: GameState,
  who: CharacterId,
  sending: Sending,
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who);
  if (creature.elsewhere !== null) {
    return err(
      'already_elsewhere',
      `${who} is already ${describeElsewhere(creature.elsewhere)} and cannot leave the scene twice`,
    );
  }
  return ok([
    {
      type: 'creature-sent-elsewhere',
      id: who,
      kind: sending.kind,
      ...(sending.host === undefined ? {} : { host: sending.host }),
      source: sending.source,
      returns: sending.returns,
      ...(sending.damage === undefined ? {} : { damage: sending.damage }),
      ...(stamp === null ? {} : { command: stamp }),
    },
    ...(sending.conditions ?? []).map(
      (condition): GameEvent => ({
        type: 'condition-applied',
        id: who,
        condition,
        source: sending.source,
      }),
    ),
  ]);
}

// — back ——————————————————————————————————————————————————————————————————————

/** Where a return settled, and what about it nobody could check. */
export interface SettledReturn {
  readonly at: Point;
  readonly unverified: readonly string[];
}

/**
 * The one check on a way back.
 *
 * A stated space is placed through the scene's own occupancy — so `occupied`
 * and `outside_scene` are the geometry's answers rather than a second copy of
 * them — and then held to the record: within the pinned distance of the
 * anchor, or among the nearest free spaces where nothing within it is free,
 * which is Blink's own second sentence. A stated space that fails the
 * distance is `return_too_far`. Where the record says the creature must see
 * the space, the anchor the placement is measured from is what sight is
 * declared between, exactly as a teleport reads it.
 *
 * **Unstated, the engine takes the one space that qualifies and otherwise
 * asks**, naming the command that answers, because which of several free
 * spaces a creature reappears in is a choice the book hands to whoever is
 * running it.
 */
export function settleReturn(
  state: GameState,
  who: CharacterId,
  to: Placement | undefined,
  /**
   * The question, asked by the caller: which of `count` qualifying spaces.
   * The caller's because the request has to name the command that answers it,
   * and three commands do.
   */
  ask: (count: number, within: number, near: string) => Err,
): Result<SettledReturn> {
  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who);
  const record = creature.elsewhere;
  if (record === null) {
    return err('not_elsewhere', `${who} is in the scene and has nowhere to return from`);
  }
  const scene = sceneFor(state, who, `${who} to return into`);
  if (!scene.ok) return scene;

  // The scene refuses to place a creature that is away; the return is the
  // door, so occupancy is asked with this one mark lifted.
  const probe: PositionState = {
    ...scene.value,
    away: Object.fromEntries(Object.entries(scene.value.away).filter(([key]) => key !== who)),
  };
  const size: CreatureSize = scene.value.sizes[who] ?? 'medium';
  const anchor = returnAnchor(scene.value, record);
  const allowed = returnCandidates(scene.value, who, record);

  if (to === undefined) {
    if (allowed.length === 1) return ok({ at: allowed[0]!, unverified: [] });
    if (allowed.length === 0) {
      return err(
        'no_space_to_return_to',
        anchor === null
          ? `${who} stood in no scene when it left, so nothing says where it comes back; name the space`
          : `no unoccupied space near where ${who} left is inside this scene`,
      );
    }
    return ask(allowed.length, record.returns.within, record.returns.near ?? 'the space it left');
  }

  const unverified: string[] = [];
  if (record.returns.requiresSight === true) {
    if ('creature' in to.from) {
      const seen = canSee(state, who, to.from.creature);
      if (seen === false) {
        return err(
          'cannot_see_destination',
          `${who} cannot see ${to.from.creature}, and the space is measured from them`,
        );
      }
      if (seen === null) {
        return needsContext(
          'visibility',
          `${who} returns to a space it can see, and whether it can see ${to.from.creature} is undeclared`,
          [
            {
              kind: 'visibility',
              subject: to.from.creature,
              need: `whether ${who} can see ${to.from.creature}`,
              because: 'the creature returns to a space it can see',
              satisfyWith: `a declareSightBetween command from ${who} to ${to.from.creature}`,
            },
          ],
        );
      }
    } else {
      unverified.push(
        `${who} must be able to see the space it returns to, and the space is measured from something sight is not declared between; nobody can say`,
      );
    }
  }

  const placed = placeCreature(probe, who, { ...to, size });
  if (!placed.ok) return anchorNeeded(placed, to.from, `${who} is returning to a space measured from it`);
  const at = placed.value.positions[who]!;

  if (anchor !== null && !allowed.some((space) => space.x === at.x && space.y === at.y && space.z === at.z)) {
    return err(
      'return_too_far',
      `${who} may return within ${record.returns.within} feet of ${
        record.returns.near ?? 'the space it left'
      }, and that space is ${distanceBetweenPoints(anchor, at)} feet away`,
    );
  }
  return ok({ at, unverified });
}

/** The batch that stands a creature back in the scene, Prone where the record says so. */
export function returnEvents(
  state: GameState,
  who: CharacterId,
  at: Point,
  stamp: CommandStamp | null,
): GameEvent[] {
  const record = state.creatures[who]?.elsewhere;
  return [
    { type: 'creature-returned', id: who, at, ...(stamp === null ? {} : { command: stamp }) },
    // SRD Swallow: "exiting with the Prone condition". Under a source of its
    // own, because the return lifts everything under the record's — and this
    // is the one thing the exit adds rather than ends.
    ...(record?.returns.prone === true
      ? [
          {
            type: 'condition-applied' as const,
            id: who,
            condition: 'prone' as const,
            source: `${record.source}, exiting`,
          },
        ]
      : []),
  ];
}

export interface ReturnCommand extends CommandIdentity {
  /** The space to stand in. Absent is asked about where several qualify. */
  readonly to?: Placement;
}

export interface ReturnOutcome {
  readonly events: readonly GameEvent[];
  readonly at: Point | null;
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Bring a creature back from elsewhere, where the way back is open.
 *
 * Three roads are open and everything else is refused `no_way_back` with the
 * sentence that would open it: a casting that has ended (SRD Blink's "when
 * the spell ends", SRD Rope Trick's "drops out when the spell ends") leaves
 * the creature stranded and this settles it; a Rope Trick still running is
 * climbed down from at will; and a host that has died is escaped (SRD
 * Swallow's "can escape from the corpse"). A familiar is recalled by its
 * summoner, a Blink caster comes back at the start of their turn, and a
 * swallowed creature waits on the frog — none of those is this door.
 */
export function returnFromElsewhere(
  state: GameState,
  who: CharacterId,
  command: ReturnCommand,
): Result<ReturnOutcome> {
  return once(
    state,
    `return:${who}`,
    command,
    () => ({ events: [], at: null, unverified: [], duplicate: true }),
    (stamp) => {
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      if (state.pendingAttack !== null) {
        return err('attack_pending', 'a hit is waiting for its damage; settle it first');
      }
      const creature = creatureOf(state, who);
      if (creature === null) return unknownCreature(who);
      const record = creature.elsewhere;
      if (record === null) {
        return err('not_elsewhere', `${who} is in the scene and has nowhere to return from`);
      }

      const closed = wayBackClosed(state, who);
      if (closed !== null) return err('no_way_back', closed);

      const settled = settleReturn(state, who, command.to, (count, within, near) =>
        needsContext(
          'return_space_required',
          `${who} comes back to an unoccupied space within ${within} feet of ${near}, and ${count} qualify; nobody has said which`,
          [
            {
              kind: 'position',
              subject: who,
              need: `the space ${who} returns to`,
              because: 'the book offers a choice of unoccupied spaces and the engine makes none of them',
              satisfyWith: `returnFromElsewhere for ${who} with its destination filled in`,
            },
          ],
        ),
      );
      if (!settled.ok) return settled;
      return ok({
        events: returnEvents(state, who, settled.value.at, stamp),
        at: settled.value.at,
        unverified: settled.value.unverified,
        duplicate: false,
      });
    },
  );
}

/** Why this creature may not come back by its own command, or null where it may. */
function wayBackClosed(state: GameState, who: CharacterId): string | null {
  const record = state.creatures[who]?.elsewhere;
  if (record === null || record === undefined) return null;
  if (record.kind === 'inside') {
    const host = record.host === undefined ? undefined : state.creatures[record.host];
    if (host !== undefined && !host.vitals.dead) {
      return `${who} is inside ${record.host}, and only ${record.host}'s death or its own line lets ${who} out`;
    }
    return null;
  }
  const castingId = castingIdOf(record.source);
  if (castingId !== null) {
    if (state.ongoing[castingId] === undefined) return null;
    if (record.returns.at !== undefined) {
      return `${who} returns at the ${record.returns.at} of its turn or when ${record.source} ends, not before`;
    }
    // A place with a door — SRD Rope Trick — is left at will while the casting runs.
    return record.kind === 'extradimensional'
      ? null
      : `${who} is ${describeElsewhere(record)} under ${record.source}, and only that casting's ending brings it back`;
  }
  if (record.source.startsWith('kept:')) {
    return `${who} was dismissed by its summoner, and only its summoner's recall brings it back`;
  }
  return `${who} is ${describeElsewhere(record)} by ${record.source}, and that line is the way back`;
}

// — the boundary ——————————————————————————————————————————————————————————————

/** The space a creature returning at this boundary should stand in, as the caller states it. */
export interface StatedReturn {
  readonly who: CharacterId;
  readonly to: Placement;
}

/**
 * What one moment of a creature's turn does to the second place.
 *
 * Three things, in the order the sentences fall: the die a running casting
 * throws at the end of the creature's turn (SRD Blink); the damage everybody
 * inside this creature takes at its boundary (SRD Swallow), and the disgorging
 * where the line prints one; and the creature's own return where its record
 * names this moment (SRD Blink's "At the start of your next turn"). Each
 * return goes through {@link settleReturn}, so a space the caller stated in
 * `returns` is checked and an unstated one is taken or asked for.
 *
 * `elsewhere_owed` is the fifth member of the family `payout_owed`,
 * `damage_owed`, `death_save_owed` and `recharge_owed` belong to: a boundary
 * that throws dice needs a generator to throw them.
 */
export function settleElsewhereAtBoundary(
  state: GameState,
  supply: Supply | undefined,
  who: CharacterId | undefined,
  moment: TurnMoment,
  stated: readonly StatedReturn[],
): Result<{ readonly events: readonly GameEvent[]; readonly unverified: readonly string[] }> {
  if (who === undefined) return ok({ events: [], unverified: [] });
  const events: GameEvent[] = [];
  const unverified: string[] = [];
  let current = state;
  const push = (more: readonly GameEvent[]): void => {
    events.push(...more);
    current = more.reduce(applyEvent, current);
  };
  // The one question this boundary asks, for whoever comes back at it.
  const askForSpace =
    (returning: CharacterId) =>
    (count: number, within: number, near: string): Err =>
      needsContext(
        'return_space_required',
        `${returning} comes back to an unoccupied space within ${within} feet of ${near} at this boundary, and ${count} qualify; nobody has said which`,
        [
          {
            kind: 'position',
            subject: returning,
            need: `the space ${returning} comes back to`,
            because: 'the book offers a choice of unoccupied spaces and the engine makes none of them',
            satisfyWith: `resolveTurn again with \`returns\` naming the space ${returning} comes back to`,
          },
        ],
      );

  // SRD Blink: "Roll 1d6 at the end of each of your turns."
  //
  // **Skipped where there is no generator**, on the areas' precedent one
  // settlement up: the effect is read off the definition, which arrives with
  // the `Supply`, and a boundary advanced without one has no content to read
  // the sentence from. `end_turn` always brings one.
  if (moment === 'end-of-turn' && supply !== undefined) {
    const creature = current.creatures[who];
    if (creature !== undefined && !creature.vitals.dead && creature.elsewhere === null) {
      for (const record of ongoingSpellsOn(current, who)) {
        const definition = supply.content.spell(record.spellId);
        if (definition === null) continue;
        for (const effect of definition.effects) {
          if (effect.kind !== 'elsewhere' || effect.at !== moment) continue;
          const still = current.creatures[who];
          if (still === undefined || still.elsewhere !== null) break;
          let vanishes = true;
          if (effect.chance !== undefined) {
            const issuedBefore = supply.issuer.count;
            const rolled = rollRecorded(supply.issuer, supply.rng, effect.chance.die);
            if (!rolled.ok) return rolled;
            vanishes = rolled.value.total >= effect.chance.onOrAbove;
            push([
              {
                type: 'roll-recorded',
                who,
                label: `${definition.name} (${effect.chance.die})`,
                natural: rolled.value.total,
                total: rolled.value.total,
                contributions: [],
                outcome: vanishes ? 'vanishes' : 'stays',
              },
              {
                type: 'rolls-issued',
                count: supply.issuer.count - issuedBefore,
                rng: supply.rng.snapshot(),
              },
            ]);
          }
          if (!vanishes) continue;
          const sent = sendingEvents(
            current,
            who,
            {
              kind: effect.where,
              source: castingSource(definition.name, record.castingId),
              returns: effect.returns,
            },
            null,
          );
          if (!sent.ok) return sent;
          push(sent.value);
        }
      }
    }
  }

  // SRD Swallow: what the stay costs, at the host's boundary.
  for (const victim of heldInside(current, who)) {
    const record = current.creatures[victim]?.elsewhere;
    const damage = record?.damage;
    if (record === undefined || record === null || damage === undefined) continue;
    const due =
      'each' in damage ? damage.each === moment : isDue(timeView(current), damage.once);
    if (!due) continue;
    const hurt = current.creatures[victim];
    if (hurt === undefined || hurt.vitals.dead) continue;
    if (supply === undefined) {
      return err(
        'elsewhere_owed',
        `${victim} is inside ${who} and owes ${damage.dice} ${damage.damageType} damage at this boundary; advancing needs a generator to roll it`,
      );
    }
    const host = current.creatures[who];
    if (host === undefined || host.vitals.dead) continue;
    const label = `${damage.damageType} damage inside ${who}`;
    const rolled = rollSpellDice(supply, host.sheet, label, damage.damageType, damage.dice);
    if (!rolled.ok) return rolled;
    const dealt = dealSpellDamage(current, victim, rolled.value, label, supply, { by: who });
    if (!dealt.ok) return dealt;
    push(dealt.value.events);
    unverified.push(...dealt.value.unverified);

    // "If that damage doesn't kill it, the frog disgorges it."
    if ('once' in damage && damage.disgorges) {
      const after = current.creatures[victim];
      if (after === undefined || after.vitals.dead) continue;
      const settled = settleReturn(
        current,
        victim,
        stated.find((entry) => entry.who === victim)?.to,
        askForSpace(victim),
      );
      if (!settled.ok) return settled;
      unverified.push(...settled.value.unverified);
      push(returnEvents(current, victim, settled.value.at, null));
    }
  }

  // SRD Blink: "At the start of your next turn … you return".
  const returning = current.creatures[who]?.elsewhere;
  if (returning !== null && returning !== undefined && returning.returns.at === moment) {
    const settled = settleReturn(
      current,
      who,
      stated.find((entry) => entry.who === who)?.to,
      askForSpace(who),
    );
    if (!settled.ok) return settled;
    unverified.push(...settled.value.unverified);
    push(returnEvents(current, who, settled.value.at, null));
  }

  return ok({ events, unverified });
}

// — the familiar's two doors ——————————————————————————————————————————————————

export interface KeptSummonsCommand extends CommandIdentity {
  /** The creature this caster keeps. */
  readonly who: CharacterId;
}

export interface RecallCommand extends KeptSummonsCommand {
  /** Where it reappears. Absent is asked about where several qualify. */
  readonly to?: Placement;
}

export interface KeptSummonsOutcome {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/** The kept bond this caster holds on a creature, with a pocket to dismiss it to. */
function pocketOf(
  state: GameState,
  casterId: CharacterId,
  who: CharacterId,
): Result<{ readonly spell: string; readonly within: number }> {
  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who);
  const bond = creature.summonedBy;
  if (bond === null || bond.by !== casterId || bond.kept === undefined) {
    return err('not_your_summons', `${who} is not a creature ${casterId} keeps from a spell`);
  }
  if (bond.kept.pocket === undefined) {
    return err(
      'no_pocket',
      `${bond.kept.spell} offers ${casterId} no pocket dimension to dismiss ${who} to; the steed stays`,
    );
  }
  return ok({ spell: bond.kept.spell, within: bond.kept.pocket.within });
}

/**
 * SRD Find Familiar: "As a Magic action, you can temporarily dismiss the
 * familiar to a pocket dimension."
 *
 * The Magic action is the caster's and is spent where there is an economy to
 * spend it from; outside a fight the dismissal is free of one, as every
 * command outside combat is. The bond is read for the pocket the spell pinned
 * on it, and the record's way back is measured from the caster.
 */
export function dismissKeptSummons(
  state: GameState,
  casterId: CharacterId,
  command: KeptSummonsCommand,
): Result<KeptSummonsOutcome> {
  return once(
    state,
    `dismiss-kept:${casterId}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, casterId);
      if (owedHere !== null) return owedHere;
      const pocket = pocketOf(state, casterId, command.who);
      if (!pocket.ok) return pocket;

      const events: GameEvent[] = [];
      if (state.combat !== null) {
        const spent = spendFor(state, casterId, 'action');
        if (!spent.ok) return spent;
        events.push(spent.value);
      }
      const sent = sendingEvents(
        events.reduce(applyEvent, state),
        command.who,
        {
          kind: 'extradimensional',
          source: keptElsewhereSource(casterId, pocket.value.spell),
          returns: { within: pocket.value.within, near: casterId },
        },
        stamp,
      );
      if (!sent.ok) return sent;
      return ok({ events: [...events, ...sent.value], unverified: [], duplicate: false });
    },
  );
}

/**
 * SRD Find Familiar: "As a Magic action while it is temporarily dismissed, you
 * can cause it to reappear in an unoccupied space within 30 feet of you."
 */
export function recallKeptSummons(
  state: GameState,
  casterId: CharacterId,
  command: RecallCommand,
): Result<KeptSummonsOutcome> {
  return once(
    state,
    `recall-kept:${casterId}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, casterId);
      if (owedHere !== null) return owedHere;
      const pocket = pocketOf(state, casterId, command.who);
      if (!pocket.ok) return pocket;
      const record = state.creatures[command.who]?.elsewhere;
      if (record === null || record === undefined || record.source !== keptElsewhereSource(casterId, pocket.value.spell)) {
        return err('not_dismissed', `${command.who} is not in the pocket ${pocket.value.spell} offers; there is nothing to recall`);
      }

      // The space first, before the Action: a refusal about where costs nothing.
      const settled = settleReturn(state, command.who, command.to, (count, within, near) =>
        needsContext(
          'return_space_required',
          `${command.who} reappears in an unoccupied space within ${within} feet of ${near}, and ${count} qualify; nobody has said which`,
          [
            {
              kind: 'position',
              subject: command.who,
              need: `the space ${command.who} reappears in`,
              because: 'the book offers a choice of unoccupied spaces and the engine makes none of them',
              satisfyWith: `recallKeptSummons for ${casterId} again with its destination filled in`,
            },
          ],
        ),
      );
      if (!settled.ok) return settled;

      const events: GameEvent[] = [];
      if (state.combat !== null) {
        const spent = spendFor(state, casterId, 'action');
        if (!spent.ok) return spent;
        events.push(spent.value);
      }
      return ok({
        events: [...events, ...returnEvents(state, command.who, settled.value.at, stamp)],
        unverified: settled.value.unverified,
        duplicate: false,
      });
    },
  );
}

// — a place with a door ———————————————————————————————————————————————————————

export interface EnterCommand extends CommandIdentity {
  /** The casting whose place is being entered. */
  readonly castingId: string;
}

export interface EnterOutcome {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * SRD Rope Trick: "Up to eight Medium or smaller creatures can climb into the
 * extradimensional space by moving up the rope."
 *
 * The creature's own act, so the command is addressed to it: within reach of
 * the casting's origin (the rope), no larger than the place admits, and only
 * while the place has room. The way back is pinned from the definition at the
 * climb — within five feet of where the creature climbed in — so "drops out
 * when the spell ends" needs no book. The climb's five feet of movement are
 * the table's; a Speed spent on a rope nobody modelled would be a number the
 * engine invented.
 */
export function enterElsewhere(
  state: GameState,
  who: CharacterId,
  content: Content,
  command: EnterCommand,
): Result<EnterOutcome> {
  return once(
    state,
    `enter-elsewhere:${who}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      const owedHere = mayAct(state, who);
      if (owedHere !== null) return owedHere;
      const creature = creatureOf(state, who);
      if (creature === null) return unknownCreature(who);

      const record = state.ongoing[command.castingId];
      if (record === undefined) {
        return err('not_ongoing', `${command.castingId} is not a spell that is still running`);
      }
      const definition = content.spell(record.spellId);
      const effect = definition?.effects.find(
        (candidate) => candidate.kind === 'elsewhere' && candidate.entry !== undefined,
      );
      if (definition === null || effect === undefined || effect.kind !== 'elsewhere' || effect.entry === undefined) {
        return err('no_way_in', `${record.spell} opens no place a creature can climb into`);
      }
      if (record.origin === undefined) {
        return err('no_way_in', `${record.spell} (${command.castingId}) pinned no point for its way in`);
      }
      if (creature.elsewhere !== null) {
        return err('already_elsewhere', `${who} is already ${describeElsewhere(creature.elsewhere)}`);
      }

      const scene = sceneFor(state, who, `${who} to climb from`);
      if (!scene.ok) return scene;
      const apart = distanceToPoint(scene.value, who, record.origin);
      if (!apart.ok) {
        return apart.code === 'not_here'
          ? apart
          : needsContext('unplaced', `nobody has said where ${who} is standing, and the way in is ${effect.entry.within} feet from ${record.spell}'s point`, [
              {
                kind: 'position',
                subject: who,
                need: `where ${who} is standing`,
                because: `${record.spell}'s way in has a reach`,
                satisfyWith: `a placeCreatureInScene command for ${who}`,
              },
            ]);
      }
      if (apart.value > effect.entry.within) {
        return err('out_of_reach', `${record.spell}'s way in is ${effect.entry.within} feet from its point; ${who} is ${apart.value} away`);
      }

      const size = effectiveSizeOf(state, who) ?? scene.value.sizes[who] ?? 'medium';
      if (sizeRank(size) > sizeRank(effect.entry.maxSize)) {
        return err('too_large', `${record.spell} admits ${effect.entry.maxSize} or smaller creatures, and ${who} is ${size}`);
      }

      const source = castingSource(definition.name, command.castingId);
      const inside = Object.values(state.creatures).filter((other) => other.elsewhere?.source === source).length;
      if (inside >= effect.entry.holds) {
        return err('no_room_inside', `${record.spell} holds ${effect.entry.holds} creatures, and ${inside} are inside`);
      }

      const sent = sendingEvents(
        state,
        who,
        { kind: effect.where, source, returns: effect.returns },
        stamp,
      );
      if (!sent.ok) return sent;
      return ok({
        events: sent.value,
        unverified: [`${record.spell}: the movement the climb costs ${who} is the table's`],
        duplicate: false,
      });
    },
  );
}

const SIZE_ORDER: readonly CreatureSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const sizeRank = (size: CreatureSize): number => SIZE_ORDER.indexOf(size);

// — the effect ————————————————————————————————————————————————————————————————

/**
 * The `elsewhere` effect at the cast.
 *
 * With a moment or a way in, nothing happens here: the casting's record is
 * what the boundary and the door read, and the outcome says only that the
 * spell is on the target. Otherwise the target is sent now, under the
 * casting's source, with the way back pinned off the definition.
 */
export function resolveElsewhereEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'elsewhere'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { events, outcomes } = ctx;
  if (effect.at !== undefined || effect.entry !== undefined) {
    outcomes.push({ target, affected: true });
    return ok(world);
  }
  const sent = sendingEvents(
    world,
    target,
    { kind: effect.where, source: ctx.source, returns: effect.returns },
    null,
  );
  if (!sent.ok) return sent;
  events.push(...sent.value);
  outcomes.push({ target, affected: true });
  return ok(sent.value.reduce(applyEvent, world));
}
