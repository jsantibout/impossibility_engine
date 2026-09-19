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
  placeCreature,
  type Placement,
  type Point,
  type SceneExtent,
} from '../positioning.js';
import { type Rng } from '../dice.js';
import { rollRecorded, type RollIssuer } from '../rolls.js';
import { statedDawnAmount } from '../resources.js';
import { type SpellcastingState } from '../spellcasting.js';
import { type Supply } from './casting.js';
import { creatureOf, sceneFor, unknownCreature } from './command.js';
import { settleBoundaryPayouts } from './turns.js';

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

    return ok([opened, ...paid.value]);
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
