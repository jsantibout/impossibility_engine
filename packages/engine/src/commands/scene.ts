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
 * **3. A missing fact is homework, not a verdict, and it says which fact.**
 * `needs-context` with a request — a `scene` when there is no room to be in,
 * and a `position` when the *anchor* a placement is measured from is not
 * standing anywhere. Both name a command in `satisfyWith` rather than an
 * event, and both commands are in this file, which is new: `resolveMove` and
 * `resolveSpell` have answered `no_scene` since positioning landed and had
 * nothing to point a caller at.
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
import { type CombatantInput, startCombat } from '../combat.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  addLandmark,
  type CoverDegree,
  declareCover,
  declareSight,
  type PositionState,
  placeCreature,
  type Placement,
  type Point,
  type SceneExtent,
} from '../positioning.js';
import { type SpellcastingState } from '../spellcasting.js';
import { creatureOf, unknownCreature } from './command.js';

/**
 * The scene, or the request that would make one.
 *
 * Four of these commands are about a place, and none of them can mean anything
 * without one — which the reducer says by throwing `no scene has been set`.
 * Here it is homework: nothing is wrong, the record is thin, and the command
 * that fixes it is `setScene` two functions up.
 */
function sceneFor(state: GameState, subject: string, because: string): Result<PositionState> {
  if (state.scene !== null) return ok(state.scene);
  return needsContext('no_scene', `there is no scene for ${because}`, [
    {
      kind: 'scene',
      subject,
      need: 'a scene, so that a place in it means something',
      because,
      satisfyWith: 'a setScene command',
    },
  ]);
}

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
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'set-scene', { ...command, extent }, () => [], (stamp) =>
    ok([{ type: 'scene-set', extent, ...(stamp === null ? {} : { command: stamp }) }]),
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
 */
export function placeCreatureInScene(
  state: GameState,
  id: CharacterId,
  placement: Placement,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `place-creature:${id}`, { ...command, placement }, () => [], (stamp) => {
    const scene = sceneFor(state, id, `${id} to stand in`);
    if (!scene.ok) return scene;

    const placed = placeCreature(scene.value, id, placement);
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
      { type: 'creature-placed', id, placement, ...(stamp === null ? {} : { command: stamp }) },
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
 */
export function beginCombat(
  state: GameState,
  combatants: readonly CombatantInput[],
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, 'begin-combat', { ...command, combatants }, () => [], (stamp) => {
    const started = startCombat(combatants);
    if (!started.ok) return started;

    return ok([
      { type: 'combat-started', combatants, ...(stamp === null ? {} : { command: stamp }) },
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

    return ok([
      { type: 'time-advanced', seconds, reason, ...(stamp === null ? {} : { command: stamp }) },
    ]);
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
