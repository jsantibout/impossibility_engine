/**
 * Setting the stage: the commands that let something above the engine start an
 * encounter.
 *
 * `placeCreature`, `addLandmark`, `declareCover` and `declareSight` in
 * `positioning.ts` and `startCombat` in `combat.ts` have been correct pure
 * functions since those modules landed, and every one of them had exactly one
 * caller: the **reducer**, folding an event that no command wrote. `scene-set`,
 * `time-advanced` and `spellcasting-declared` had no producer outside a test
 * fixture at all. So the only way to begin a fight was to hand-write the log —
 * narration writing directly to truth, which is the first thing the doctrine
 * forbids. This is the twelfth recorded instance of the repository's most
 * persistent finding, a rule implemented and reachable from nothing, and the
 * largest.
 *
 * Four decisions, stated rather than left to be inferred, because nine more
 * DM-declared events were the same shape and did follow whatever this did —
 * `commands/declarations.ts` and the mount, dismount and free-interaction
 * commands beside them:
 *
 * **1. The command is its event's name read as an imperative.** `scene-set` is
 * `setScene`, `time-advanced` is `advanceTime`. Four of them are lengthened —
 * `addSceneLandmark`, `placeCreatureInScene`, `declareSightBetween`,
 * `declareCoverBetween` — because the pure function beneath already owns the
 * plain verb and `index.ts` exports both. The command is named for the fact it
 * records, so the log reads as a list of the commands that wrote it.
 *
 * **2. A command here refuses exactly what the reducer would call corrupt, and
 * nothing more.** That is what "the validation is the pure function's, not a
 * second copy" means when it is made precise enough to test: for each refusal,
 * `scene-commands.test.ts` forges the event the command declined to write and
 * asserts the fold throws. Two consequences are deliberate rather than
 * oversights. `setScene` refuses nothing, because nothing about a scene can
 * corrupt a log — a new room is a new room, and the reducer has always
 * unplaced everybody when one arrives. And the commands that take creature ids
 * without looking them up — sight, cover, placement — do not look them up
 * *because the reducer does not*, and inventing the check here would be the
 * second copy the rule exists to prevent. `declareSpellcasting` is the one
 * that does check, because `spellcasting-declared`'s own reducer case reads
 * the creature and throws.
 *
 * **`advanceTime`'s `in_combat` is the one refusal here that is not the
 * reducer's**, and it is written down rather than left to be discovered. The
 * reducer cannot be taught this one: `golden-log-2.json` advances the clock
 * five times inside a fight nothing ever ended, so a fold that threw would be
 * a migration of a frozen log rather than a rule. Nor is it the same claim —
 * "the clock in a fight belongs to the turn order" is about which *author* may
 * write the event, and the reducer's business is whether an event can be
 * applied at all. So the rule sits at the only door that has an author, which
 * is a command, and a log that already holds one folds exactly as it did.
 *
 * **`endCombat` is the second departure, and it splits the other way.** Its
 * `not_in_combat` *is* the reducer's — a `combat-ended` with no fight running
 * contradicts itself and `fold/combat.ts` throws on one. Its other three are
 * not, and must not be: `removeCreatureEverywhere` writes a `combat-ended`
 * without asking whose side anybody was on, so a fold taught to demand a
 * settled fight would refuse an event the engine itself emits. Which side may
 * close a fight is a question about the *author* again, and it sits at the
 * door that has one.
 *
 * **3. A missing fact is homework, not a verdict, and it says which fact.**
 * `needs-context` with a request — a `scene` when there is no room to be in,
 * and a `position` when the *anchor* a placement is measured from is not
 * standing anywhere. Both name a command in `satisfyWith` rather than an
 * event, and both commands are in this file, which is what made naming one
 * possible at all: `resolveMove` and `resolveSpell` had answered `no_scene`
 * since positioning landed with nothing to point a caller at.
 *
 * **They point at `setScene` now**, and it took a second task to notice. The
 * commands existing is not the same as the requests naming them, and for two
 * tranches they did not — `resolveSpell`'s requests said "a scene-set event"
 * and `resolveMove` carried no request whatever. `invariants.test.ts` sweeps
 * every `satisfyWith` under `commands/` against the `commands.ts` barrel so
 * the gap cannot reopen quietly.
 *
 * **4. `mayAct` is not consulted.** None of these is an action in the turn
 * economy — they are facts a DM declares, and an outstanding area effect is
 * not a reason the room cannot be described. They spend nothing, so the
 * action-economy sweep in `invariants.test.ts` does not classify them as
 * spenders at all; `DECLARED_NOT_ACTED` there is where that decision is
 * written down and checked, in the shape the sweep's own exemption lists use.
 *
 * Every one goes through `once`, so the duplicate check comes first and there
 * is nowhere above it to write a guard. `placeCreatureInScene` is the case
 * that makes that concrete: its own first run is what makes the world answer
 * `already_placed`, and a retry is told its command landed rather than told
 * about the world its first run made.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import { type CombatantInput, currentCombatant, startCombat } from '../combat.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  addLandmark,
  type CoverDegree,
  declareCover,
  declareSight,
  type LightLevel,
  placeCreature,
  type Placement,
  type Point,
  type SceneExtent,
} from '../positioning.js';
import { type Rng } from '../dice.js';
import { rollRecorded, type RollIssuer } from '../rolls.js';
import { statedDawnAmount } from '../resources.js';
import { isDown } from '../vitals.js';
import { type SpellcastingState } from '../spellcasting.js';
import { type Supply } from './casting.js';
import { creatureOf, sceneFor, unknownCreature } from './command.js';
import {
  settleBoundaryPayouts,
  settleStartOfTurnGrants,
  settleStartOfTurnRecharges,
} from './turns.js';

/**
 * Set the scene, and with it what the room can contain.
 *
 * SRD has no rule about this at all — a scene's extent is fiction, and the
 * engine holds it only so that a 60-by-40 tavern cannot contain a 1000-foot
 * gap. There is nothing to refuse: setting a scene again is the party walking
 * into the next room, and the reducer has always answered that by unplacing
 * everybody, because where somebody stood in the last room is not where they
 * stand in this one.
 */
export function setScene(
  state: GameState,
  extent: SceneExtent,
  command: CommandIdentity & { readonly light?: LightLevel } = {},
): Result<GameEvent[]> {
  const { light } = command;
  return once(state, 'set-scene', { ...command, extent }, () => [], (stamp) =>
    ok([
      {
        type: 'scene-set',
        extent,
        ...(light === undefined ? {} : { light }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]),
  );
}

/**
 * Put a landmark in the scene, which is what creatures are then placed against.
 *
 * "The model never types raw coordinates" is a rule about *placement*, and this
 * is the other half of why it works: laying out a room is map-making, so a
 * landmark takes a coordinate and everything afterwards is measured from it.
 * `addLandmark` refuses one that does not fit in the scene, and that refusal is
 * this command's.
 */
export function addSceneLandmark(
  state: GameState,
  name: string,
  at: Point,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `add-landmark:${name}`, { ...command, at }, () => [], (stamp) => {
    const scene = sceneFor(state, name, `${name} to stand in`);
    if (!scene.ok) return scene;

    const placed = addLandmark(scene.value, name, at);
    if (!placed.ok) return placed;

    return ok([
      { type: 'landmark-added', name, at, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Put a creature into the scene, somewhere established.
 *
 * Maestro is expected to call this freely — a creature walking into the scene
 * is placed, not refused, and an unplaced creature is an engine-to-model signal
 * rather than anything a player hears about. What `placeCreature` will not do
 * is relocate: a creature that already has a position moves, explicitly,
 * spending movement, rather than being teleported by a stray placement. That
 * refusal is this command's, and it is the one whose retry matters — a second
 * send of the same placement is answered as the duplicate it is, not with the
 * `already_placed` its own first run brought about.
 *
 * **The anchor is the other creature, and it is the one that can be missing.**
 * A placement is always measured from something established, so "beside the
 * fighter" needs the fighter to be standing somewhere. `resolveAnchor` answers
 * that with a bare `unplaced` and no request, which is the right division of
 * labour — a pure helper returns the kind, and the command that knows which
 * rule wanted the fact says what would settle it. Passing it through unadorned
 * leaves a `needs-context` with the "what" in a prose string, which is the one
 * thing a tool surface cannot branch on.
 *
 * **The size is the creature's own unless the caller states one.** A stat
 * block prints how much space a creature takes up and `creature-added` pins
 * it, so asking a caller for it again is asking a model to state a fact the
 * book already answered — which is how a Large ogre ends up Medium because
 * nobody said. The caller still wins when they do say, because a DM shrinking
 * an ogre is a fact only the table has, and a creature nobody pinned a size
 * for is Medium exactly as it always was. What the command settles on is
 * **pinned into the event**, so the fold reads a size rather than defaulting
 * to one of its own.
 */
export function placeCreatureInScene(
  state: GameState,
  id: CharacterId,
  placement: Placement,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  // The caller's own input, unresolved: a retry that sent the same placement
  // is the duplicate it is, whatever the creature's size turned out to be.
  return once(state, `place-creature:${id}`, { ...command, placement }, () => [], (stamp) => {
    const scene = sceneFor(state, id, `${id} to stand in`);
    if (!scene.ok) return scene;

    const pinned = creatureOf(state, id)?.size;
    const resolved: Placement =
      placement.size !== undefined || pinned == null ? placement : { ...placement, size: pinned };

    const placed = placeCreature(scene.value, id, resolved);
    // The refusal stays `placeCreature`'s — this adds the request it could not
    // know to attach, and re-derives nothing about whether the anchor is there.
    if (!placed.ok) {
      const anchor = placement.from;
      return placed.code === 'unplaced' && 'creature' in anchor
        ? needsContext(placed.code, placed.reason, [
            {
              kind: 'position',
              subject: anchor.creature,
              need: `where ${anchor.creature} is standing`,
              because: `${id} is being placed relative to ${anchor.creature}`,
              satisfyWith: `a placeCreatureInScene command for ${anchor.creature}`,
            },
          ])
        : placed;
    }

    return ok([
      {
        type: 'creature-placed',
        id,
        placement: resolved,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * Declare whether one creature can see another.
 *
 * Declared rather than ray-cast, for the reason cover is: computing it means
 * modelling walls, and that is where a rules engine becomes a VTT. Directional,
 * and three-valued — nobody having said is not the same as "no", which is why
 * a spell that needs sight asks rather than refusing.
 */
export function declareSightBetween(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
  seen: boolean,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-sight:${from}>${to}`, { ...command, seen }, () => [], (stamp) => {
    const scene = sceneFor(state, from, `${from} to see ${to} across`);
    if (!scene.ok) return scene;

    const declared = declareSight(scene.value, from, to, seen);
    if (!declared.ok) return declared;

    return ok([
      { type: 'sight-declared', from, to, seen, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Declare how much cover one creature has from another.
 *
 * Directional: the bar shields the ogre from the fighter without shielding the
 * fighter from the ogre. The engine applies exactly what the degree is worth —
 * +2 or +5 to Armour Class and to Dexterity saves — and declines to work out
 * which degree it is, because that needs the walls again.
 */
export function declareCoverBetween(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
  degree: CoverDegree,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-cover:${from}>${to}`, { ...command, degree }, () => [], (stamp) => {
    const scene = sceneFor(state, from, `${to} to take cover in from ${from}`);
    if (!scene.ok) return scene;

    const declared = declareCover(scene.value, from, to, degree);
    if (!declared.ok) return declared;

    return ok([
      { type: 'cover-declared', from, to, degree, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Start the fight.
 *
 * SRD: "The GM ranks the combatants, from highest to lowest Initiative." The
 * ranking is `startCombat`'s, and so are its two refusals — a combat with
 * nobody in it, and a combatant listed twice. The Initiative totals are the
 * caller's to have rolled, through `rollInitiativeFor`, which is where a
 * creature's own Alert bonus and any Advantage on the roll are applied.
 *
 * A scene is *not* required: SRD rolls Initiative whenever a fight begins, and
 * a fight in a place nobody has mapped is a fight. The reducer agrees — no
 * `combat-started` has ever reached `sceneOf`.
 *
 * **Starting the fight is a turn boundary**, which is the whole of why this
 * command takes a `Supply` at all: `startCombat` has said in a comment since
 * the beginning that "the first combatant's turn starts with the fight", and a
 * turn starting is a moment the rules pay out at. A creature holding SRD
 * Heroism — "at the start of each of its turns, that creature gains Temporary
 * Hit Points" — when the fight opens on its own turn is owed them there, and
 * the fold cannot hand them over because a payout is settled rather than
 * filed. So the boundary is asked here exactly as `resolveTurn` asks it, and
 * answers the same three ways: nothing due, paid, or `payout_owed` for want of
 * a generator.
 *
 * **The `Supply` is optional and last.** Optional because most fights open on
 * nobody who is owed anything, and a caller with no payout in the room must
 * not be made to carry the book to start a fight; last because a `Supply` in
 * front of the `CommandIdentity` would have moved an argument every existing
 * caller already passes, which is the objection `initiative.ts` records
 * against widening this command at all.
 *
 * The area half of the same moment is *not* settled here. A trigger is a debt
 * the fold files (`owedAreaEffects`) and `settleAreaEffects` is the command
 * that pays it, so the moment leaves it standing exactly as any other turn
 * boundary would.
 */
export function beginCombat(
  state: GameState,
  combatants: readonly CombatantInput[],
  command: CommandIdentity = {},
  supply?: Supply,
): Result<GameEvent[]> {
  return once(state, 'begin-combat', { ...command, combatants }, () => [], (stamp) => {
    const started = startCombat(combatants);
    if (!started.ok) return started;

    const opened: GameEvent = {
      type: 'combat-started',
      combatants,
      ...(stamp === null ? {} : { command: stamp }),
    };

    // Whose turn has begun is read off the order the fold built, never off the
    // list as it arrived: the ranking is `startCombat`'s and the reducer's, and
    // a second reader of "who is first" is how a command and the fold come to
    // disagree. Nothing has *ended*, so the boundary is asked for one half.
    const after = applyEvent(state, opened);
    const beginning = after.combat === null ? undefined : currentCombatant(after.combat).id;

    const paid = settleBoundaryPayouts(after, supply, undefined, beginning);
    if (!paid.ok) return paid;

    // And the d6 the first combatant's turn beginning owes each of its
    // expended lines. SRD *Monsters*: "At the start of each of the monster's
    // turns" — a fight opening on the turn of a creature whose breath weapon
    // is spent from the last fight is that start, by the second door.
    const recharged = settleStartOfTurnRecharges(
      paid.value.reduce(applyEvent, after),
      supply,
      beginning,
    );
    if (!recharged.ok) return recharged;

    // And the extra action a running effect owes that same beginning. SRD
    // Haste: "on each of its turns" — a fight that opens on a hasted
    // creature's turn is one of those, by the same second door the recharge
    // above arrives through.
    const granted = settleStartOfTurnGrants(
      [...paid.value, ...recharged.value].reduce(applyEvent, after),
      beginning,
    );

    return ok([opened, ...paid.value, ...recharged.value, ...granted]);
  });
}

/**
 * How a fight came to an end, as the caller states it.
 *
 * The owner's ruling read as a union: "a fight ends when no hostile combatant
 * remains or the hostiles surrender. A flight is a prompt, not an end."
 *
 * `defeated` names nobody, because it is a claim about the world and the
 * engine checks it. The other two name the side that yielded or ran, because
 * **only the table knows**: `side` is declared like cover and sight, the
 * engine holds no notion of who the party is, and a surrender is a sentence
 * somebody said rather than a number anybody can read off the log.
 */
export type CombatEnding =
  | { readonly kind: 'defeated' }
  | { readonly kind: 'surrender'; readonly side: string }
  | {
      readonly kind: 'flight';
      readonly side: string;
      /**
       * Whether the party lets them go. Absent — or `false`, which is the
       * table having been asked and having said no — leaves the fight running.
       */
      readonly letThemGo?: boolean;
    };

/**
 * End the fight.
 *
 * **The door the whole engine was missing.** `combat-ended` had exactly one
 * producer — the branch in `removeCreatureEverywhere` that fires when a
 * removal takes the *last* combatant out of the order — and no tool removes a
 * creature. So a session that rolled Initiative once could not close the
 * fight, and under {@link advanceTime}'s `in_combat` refusal could then never
 * rest: the two are one decision and landed in one review.
 *
 * **What "no hostile combatant remains" is, precisely.** The engine holds one
 * allegiance fact and it is a declared string — `CreatureState.side`, the same
 * fact an aura reads for "ally" and a ranged attack reads for "enemy". So the
 * question it can actually answer is *whether anybody left on their feet is
 * opposed to anybody else*: the combatants still in the order, alive and not
 * at 0 hit points, once the side that surrendered or fled is set aside. One
 * side left standing, or none, is a fight that is over. Two is a fight.
 *
 * **On their feet** rather than "able to act": a creature at 0 is Unconscious
 * and out of the fight, and a dead one more so — but a Paralyzed hostile is
 * still a hostile, and a fight closed over one would be the engine deciding
 * the coup de grâce nobody has struck.
 *
 * **A creature nobody has put on a side is homework, not a verdict.** Null is
 * a real state and it means "nobody has said", so a fight holding one cannot
 * be *known* to be over — answering either way would be the engine settling
 * the missing fact instead of asking for it. `declareCreatureSide` settles it.
 *
 * **And that request carries a `ContextRequest` per creature**, which is the
 * breach this command recorded and the next task closed. `ContextRequest.kind`
 * is a closed union in `@ie/shared`, none of whose seven kinds meant "nobody
 * has said whose side this creature is on" — the creature is *known*; a fact
 * about it is not — so the "what" sat in the prose that
 * {@link placeCreatureInScene} above says a tool surface cannot branch on.
 * `side` is the eighth kind, `declare_side` declares it, and the refusal now
 * hands back one request per unsided creature rather than a sentence with
 * their names joined by commas. It is one request each rather than one for the
 * fight because the remedy is one `declareCreatureSide` each, and a caller
 * that has to split a string to find that out is reading prose again.
 *
 * **A surrender or a flight must name a side somebody standing is on.**
 * Without that the command is a skeleton key: any fight could be closed by
 * naming a side that was never in it, and "the hostiles surrender" would mean
 * nothing more than "somebody typed it".
 *
 * **And a flight is a refusal rather than a `needs-context`.** Every request
 * the engine makes is a fact about the world that the layer above can settle
 * on its own — `result.ts` says it in as many words: "addressed to the
 * orchestrator, never to a player". Whether the party lets the goblins go is
 * the one thing on this list that **only a player can answer**, and dressing
 * it as homework would tell an orchestrator to go and find out something it
 * must instead go and ask. So the fight stays open, the code says why, and the
 * same command carries the answer back.
 *
 * What it concluded is pinned into the event. It reads no content — a fight
 * ending is a fact about the room and the book has nothing to say about it —
 * so the pinning is of what the *command* decided, which is the half of the
 * fold's contract this one has to keep: a reader of the log is told why the
 * fight closed rather than left to infer it from whoever was still standing.
 */
export function endCombat(
  state: GameState,
  ending: CombatEnding,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'end-combat', { ...command, ending }, () => [], (stamp) => {
    const combat = state.combat;
    if (combat === null) {
      return err('not_in_combat', 'no fight is running, so there is no fight to end');
    }

    if (ending.kind === 'flight' && ending.letThemGo !== true) {
      return err(
        'flight_not_elected',
        `${ending.side} have fled, and a flight is not an end: the party may let them go or go after them, and that is the table's to decide rather than the engine's. Send the same endCombat with letThemGo once they have`,
      );
    }

    // Everybody still in this fight: in the order, alive, and not at 0.
    const onTheirFeet = combat.order.flatMap((combatant) => {
      const creature = state.creatures[combatant.id];
      return creature === undefined || creature.vitals.dead || isDown(creature.vitals)
        ? []
        : [creature];
    });

    const yielded = ending.kind === 'defeated' ? null : ending.side;
    if (yielded !== null && !onTheirFeet.some((creature) => creature.side === yielded)) {
      return err(
        'no_such_side',
        `nobody still standing in this fight is on ${yielded}'s side, so ${yielded} is not a side that can ${ending.kind === 'surrender' ? 'surrender' : 'be let go'}`,
      );
    }

    // `yielded === null` is "nobody stated an ending", not "the unsided
    // yielded": a creature nobody has put on a side is asked about below
    // rather than quietly swept out of the fight by a comparison with null.
    const left =
      yielded === null ? onTheirFeet : onTheirFeet.filter((creature) => creature.side !== yielded);
    const unsided = left.filter((creature) => creature.side === null).map((c) => c.id);
    if (unsided.length > 0) {
      return needsContext(
        'undeclared_side',
        `nobody has said whose side ${unsided.join(', ')} ${unsided.length === 1 ? 'is' : 'are'} on, and a fight cannot be known to be over while somebody standing in it is on nobody's — a declareCreatureSide command for each of them settles it`,
        unsided.map((who) => ({
          kind: 'side' as const,
          subject: who,
          need: `which side ${who} is fighting on`,
          because: 'a fight is over when nobody standing is opposed to anybody else',
          satisfyWith: `declareCreatureSide(state, '${who}', side)`,
        })),
      );
    }

    const sides = [...new Set(left.map((creature) => creature.side))].sort();
    if (sides.length > 1) {
      return err(
        'hostiles_remain',
        `the fight is still on: ${left.map((creature) => `${creature.id} (${creature.side})`).join(', ')} are on their feet on ${sides.length} opposed sides`,
      );
    }

    return ok([
      {
        type: 'combat-ended',
        ending:
          ending.kind === 'defeated'
            ? { kind: 'defeated' }
            : ending.kind === 'surrender'
              ? { kind: 'surrender', side: ending.side }
              : { kind: 'flight', side: ending.side },
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * Move the clock, because somebody said time passed.
 *
 * In combat the clock is derived — a round is six seconds and nobody decides
 * that. Out of combat, how long the party spent searching the vault is
 * narration, so it arrives as an event. Whole seconds forwards, which is the
 * reducer's own rule: every duration the game names is a whole number of them,
 * so a fraction is not a shorter span but a log that cannot mean anything.
 *
 * **And the first sentence is a refusal now, not a remark.** It had been
 * written here since the command landed and nothing enforced it, so a session
 * holding this could say "eight hours pass" on the goblin's turn: every span
 * hung on the clock expires at once, the turn order does not move, and
 * `withCombat` then charges the fight's own six seconds *on top* of an hour
 * the fold never counted. A rest measured against that clock is a rest nobody
 * took. The gap was found from above the engine, by a caller that could not
 * fix it in a layer that holds no rules.
 *
 * **Outright, rather than only what would cross a deadline.** The narrower
 * rule was the other candidate and it is not a rule about the clock: it would
 * pass eight declared hours in a fight where nothing happened to be hanging —
 * which is a Long Rest taken between two swings — and refuse the same
 * sentence in the fight next door for a reason about the room rather than
 * about time. A fight's seconds are the turn order's, all of them, or they are
 * not.
 *
 * What a caller who genuinely wants the clock to move inside a fight has is
 * the turn order: `resolveTurn` charges six seconds a round, which is what a
 * round costs. What a caller who wants the *hour* has is {@link endCombat},
 * which landed in the same review as this refusal and for its sake: a rule
 * that left a session unable to rest would have been a wedge rather than a
 * rule.
 */
export function advanceTime(
  state: GameState,
  seconds: number,
  reason: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'advance-time', { ...command, seconds, reason }, () => [], (stamp) => {
    if (!Number.isInteger(seconds) || seconds < 0) {
      return err(
        'not_whole_seconds',
        `time runs forwards in whole seconds, and ${seconds} is not one of them`,
      );
    }

    if (state.combat !== null) {
      return err(
        'in_combat',
        `a fight is running, and inside one the clock is the turn order's: a round is six seconds and the fold charges them as the order wraps, so ${seconds} declared here would be counted twice over and would expire this fight's own deadlines without a turn being taken. Advance the order with resolveTurn, or close the fight with endCombat and declare the time then`,
      );
    }

    return ok([
      { type: 'time-advanced', seconds, reason, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Declare that dawn has come, and give back what a dawn gives back.
 *
 * **Dawn is declared, never derived**, and `time.ts` says why in as many
 * words: "There is no calendar and no time of day: those are fiction, and the
 * DM owns them." The clock counts seconds since the campaign began, and no
 * number of seconds is a sunrise — a party that rests eight hours underground
 * has not seen one, and a party that walks out at noon will. The SRD hands the
 * moment to the GM, so this is the GM saying it.
 *
 * **It is a moment, not a duration.** No `time-advanced` goes out, nothing
 * expires and no turn ends — declaring dawn during a fight is legal and changes
 * nothing about the fight, because sunrise is not a thing anybody spends a turn
 * on. Whoever wants the night to have passed advances the clock through
 * `advanceTime` or rests, which are the two commands that own elapsed time.
 *
 * Three kinds of recovery come out of it, because the SRD prints three:
 *
 * - **"regains all expended charges daily at dawn"** — the `resources-restored`
 *   event a rest already emits, with the `dawn` tag `Recovery` has carried
 *   since pools landed. The fold refills every pool that recovers on it.
 * - **"regains 1d3 expended charges daily at dawn"** — a roll, and the engine
 *   makes it: forty-four of the SRD's magic items say a number of dice rather
 *   than "all", and a caller supplying that number would be the model producing
 *   one. It lands as `resource-regained`, the event Sorcerous Restoration
 *   already uses, with the roll and the generator's state beside it.
 * - **"regains 1 expended charge daily at dawn"** — Rod of Resurrection's
 *   line, which is neither of the other two: a stated number, handed back
 *   without a die and without moving the generator. Nothing is rolled, so
 *   nothing is recorded as a roll.
 *
 * Everybody at once, because dawn happens to the world rather than to a person
 * — which is the difference between this and a rest, and the reason it takes no
 * creature id. Creatures are walked in sorted key order and pools in sorted key
 * order, so the same seed gives the same log.
 */
export function declareDawn(
  state: GameState,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'declare-dawn', { ...command }, () => [], (stamp) => {
    const events: GameEvent[] = [];

    for (const key of Object.keys(state.creatures).sort()) {
      const creature = state.creatures[key];
      if (creature === undefined) continue;
      const pools = Object.keys(creature.resources.pools)
        .sort()
        .flatMap((poolKey) => {
          const pool = creature.resources.pools[poolKey];
          return pool === undefined || pool.recovers !== 'dawn' ? [] : [pool];
        });
      // **And the counts, which are the other thing a morning empties.** SRD
      // Wind Fan counts "each subsequent time the fan is used before the next
      // dawn" and the fan has no charges at all, so a creature holding one
      // holds no dawn *pool* — and skipping on the pools alone left that count
      // standing through every sunrise. `restoreOn` zeroes both by the one tag;
      // what this decides is only whether the creature is written about.
      const counted = Object.values(creature.resources.tallies).some(
        (one) => one.recovers === 'dawn',
      );
      if (pools.length === 0 && !counted) continue;

      // One restoration for the creature, whatever it holds: `restoreOn` is
      // all-or-nothing by tag and steps over the pools whose recovery is a
      // roll, which is what lets the two share one dawn.
      //
      // The stamp rides the first of them, because which event a dawn is
      // guaranteed to write depends on what the world is holding: a dawn over a
      // party with no dawn pool writes nothing, gives nothing back, and is a
      // no-op however many times it is sent.
      events.push({
        type: 'resources-restored',
        id: creature.id,
        recovers: 'dawn',
        ...(stamp === null || events.length > 0 ? {} : { command: stamp }),
      });

      for (const pool of pools) {
        if (pool.regainsAtDawn === undefined) continue;
        // Nothing expended, nothing rolled. A die thrown for a full pool would
        // move the generator for a recovery that could not happen, which is the
        // quiet way a replay stops matching.
        if (pool.spent === 0) continue;

        /**
         * **A stated number is handed back, not rolled for.** SRD Rod of
         * Resurrection: "The rod regains 1 expended charge daily at dawn" —
         * there is no die in that sentence, so there is none here either and
         * the generator does not move. A `roll-recorded` for a number nobody
         * rolled would be the engine claiming provenance for arithmetic.
         */
        const stated = statedDawnAmount(pool.regainsAtDawn);
        if (stated !== null) {
          events.push({
            type: 'resource-regained',
            id: creature.id,
            key: pool.key,
            amount: Math.min(stated, pool.spent),
          });
          continue;
        }

        const issuedBefore = supply.issuer.count;
        const rolled = rollRecorded(supply.issuer, supply.rng, pool.regainsAtDawn);
        if (!rolled.ok) return rolled;

        // "Regains 1d6 + 1 expended charges": what is expended is the ceiling,
        // the same way a recovery feature's cap is. The roll stands in the log
        // as it fell; the pool takes what it had room for.
        const amount = Math.min(rolled.value.total, pool.spent);
        events.push(
          {
            type: 'roll-recorded',
            who: creature.id,
            label: `${pool.label} at dawn (${pool.regainsAtDawn})`,
            natural: rolled.value.total,
            total: rolled.value.total,
            contributions: [],
            outcome: `${amount} back`,
          },
          {
            type: 'rolls-issued',
            count: supply.issuer.count - issuedBefore,
            rng: supply.rng.snapshot(),
          },
          { type: 'resource-regained', id: creature.id, key: pool.key, amount },
        );
      }
    }

    return ok(events);
  });
}

/**
 * State what a creature casts, for a creature with no class table to derive it
 * from.
 *
 * A character's spellcasting comes from their choices, which is why
 * `character-created` carries it. An NPC Cleric or a monster with innate spells
 * has no such record, so it is declared — the same rule as a stat block's
 * printed Armour Class: declared wins, and the engine does not reverse-engineer
 * a class that happens to add up.
 *
 * Unlike a creature's type, this is **not** durable: a stat block's spell list
 * can be restated, the SRD nowhere forbids it, and nothing has been cast on the
 * strength of the old one that the casting itself did not already pin. The
 * creature must exist, because the reducer reads it.
 */
export function declareSpellcasting(
  state: GameState,
  id: CharacterId,
  spellcasting: SpellcastingState,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(
    state,
    `declare-spellcasting:${id}`,
    { ...command, spellcasting },
    () => [],
    (stamp) => {
      if (creatureOf(state, id) === null) return unknownCreature(id);

      return ok([
        {
          type: 'spellcasting-declared',
          id,
          spellcasting,
          ...(stamp === null ? {} : { command: stamp }),
        },
      ]);
    },
  );
}
