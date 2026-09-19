/**
 * Who a persistent area catches, and at which of the three moments.
 *
 * The SRD writes three clauses and they are three different detections over
 * three different operations, which is why they are three functions rather
 * than one "did membership change" test: a turn boundary
 * (`raiseAreaBoundary`), a creature's own position change
 * (`raiseAreaEntries`), and the area arriving at a creature standing still —
 * carried by its holder (`raiseCarriedArrivals`) or moved by an activation
 * (`raiseAreaArrivals`). The weaker question would pass every test in this
 * module and erase the distinction the book drew.
 *
 * Everything an area is read from is pinned on the ongoing record at the cast,
 * so `areaDefinitionOf` answers out of the log rather than out of this week's
 * catalogue.
 */
import type { CharacterId } from '@ie/shared';
import type { TurnMoment } from '../time.js';
import { areaStampKey, type AreaMoment, type OngoingSpell } from '../spells.js';
import {
  areaPointAt,
  creaturesInArea,
  type AreaOrigin,
  type AreaShape,
  type PointAnchoring,
  type PositionState,
  type Point,
} from '../positioning.js';
// **Type-only, deliberately.** The fold does not open the spell catalogue: a
// casting's area and its clauses are pinned on the ongoing record at the cast,
// so a replay answers out of the log rather than out of this week's
// definitions. The one lookup left is `upgradeOngoing`, which is for a record
// written before that field existed — see `ongoing-compatibility.ts`.
import type { AreaTrigger, SpellArea } from '../spell-definitions.js';

import type { GameState } from '../state.js';
import { sortedRecord } from './common.js';

/**
 * Which placed creatures a persistent casting's area currently holds.
 *
 * The geometry is `positioning.ts`'s and is not reimplemented: the shape and
 * its dimensions come off the definition, the point and the direction off the
 * ongoing record. There is one area function in this engine and this is a
 * caller of it, not a second one.
 *
 * **Two origins, both read off facts the engine already had.** SRD's glossary
 * decides it and says so in one sentence: "An Emanation **moves with the
 * creature or object that is its origin** unless it is an instantaneous or a
 * stationary effect." So a casting's area sits at a point *or* on a creature,
 * and which it is was settled at the casting by the definition:
 *
 * | | `area.origin` | Read from | Spells |
 * |---|---|---|---|
 * | A point the casting keeps | `point` | `record.origin` | Web, Grease, Insect Plague, Black Tentacles, Moonbeam |
 * | The caster, wherever they now are | `self` | `record.caster` | Spirit Guardians |
 *
 * **Nothing is stored for the second and nothing is synchronised.** A copied
 * point would be a second answer to "where is the aura", kept in step by
 * remembering to update it — and the first time anything moved the caster by a
 * route that forgot, the aura would be frozen where it was. Deriving it is not
 * an optimisation: it is the difference between one fact and two facts that
 * can disagree.
 *
 * An Emanation measures from the origin creature's **whole occupied volume**
 * and excludes that creature, both of which `creaturesInArea` has always done.
 * A Gargantuan carrier's 15-foot Emanation covers vastly more ground than a
 * Medium one's, and neither includes the carrier.
 *
 * Null when the casting has no persistent area to ask about — no definition,
 * no area, no trigger, or a point-origin area with no point recorded — which
 * is every casting but a handful.
 */
function creaturesInCastingArea(
  scene: PositionState,
  record: OngoingSpell,
): ReadonlySet<CharacterId> | null {
  const definition = areaDefinitionOf(record);
  if (definition === null) return null;

  const origin = originOfCastingArea(definition.area, record);
  if (origin === null) return null;

  const shape = areaShapeOf(definition.area, record.towards, record.anchoring ?? 'space');
  if (shape === null) return null;

  const caught = creaturesInArea(scene, origin, shape);
  if (!caught.ok) return null;

  // SRD Spirit Guardians: "When you cast this spell, you can designate
  // creatures to be unaffected by it." Filtered here rather than at each
  // clause, so the one decision reaches every sentence that reads the area —
  // the damage today, the halved Speed whenever that is built.
  const spared = record.unaffected;
  return new Set(spared === undefined ? caught.value : caught.value.filter((id) => !spared.includes(id)));
}

/** Where this casting's area sits: a point it keeps, or the creature carrying it. */
function originOfCastingArea(area: SpellArea, record: OngoingSpell): AreaOrigin | null {
  if (area.origin === 'self') return { creature: record.caster as CharacterId };
  return record.origin === undefined
    ? null
    : areaPointAt(record.origin, record.anchoring ?? 'space');
}

/**
 * Turn a definition's area into the geometric template, with its direction.
 *
 * The direction is the half that had to be stored: everything else is a
 * printed dimension and reconstructs itself. A directional shape with no
 * recorded direction answers null rather than pointing somewhere plausible.
 */
function areaShapeOf(
  area: SpellArea,
  towards: Point | undefined,
  anchoring: PointAnchoring,
): AreaShape | null {
  // The direction is read under the casting's own anchoring, the same one its
  // origin was written with, so the axis between them stays in one frame.
  const aim = towards === undefined ? null : areaPointAt(towards, anchoring);
  switch (area.kind) {
    case 'sphere':
      return { kind: 'sphere', radius: area.radius };
    case 'cylinder':
      return { kind: 'cylinder', radius: area.radius, height: area.height };
    case 'emanation':
      return { kind: 'emanation', distance: area.distance };
    case 'cone':
      return aim === null ? null : { kind: 'cone', length: area.length, towards: aim };
    case 'cube':
      return aim === null ? null : { kind: 'cube', size: area.size, towards: aim };
    case 'line':
      return aim === null
        ? null
        : { kind: 'line', length: area.length, width: area.width, towards: aim };
  }
}

/**
 * A casting that has both an area and something it does to it later.
 *
 * **Read off the record, never out of the catalogue.** The shape, its
 * dimensions and the clauses that fire in it were pinned when the spell was
 * cast, by the rule the pinned numbers already set: a spell already cast does
 * not change when the book does. Asking `definitionFor` here — which this did
 * at five call sites — meant a replay of last week's log consulted this week's
 * definitions, so a corrected Cube size raised different debts in a historical
 * fold than the live session raised.
 */
function areaDefinitionOf(
  record: OngoingSpell,
): { readonly area: SpellArea; readonly trigger: AreaTrigger } | null {
  if (record.area === undefined || record.areaTrigger === undefined) return null;
  return { area: record.area, trigger: record.areaTrigger };
}

/**
 * Whether this casting may catch this creature again on this turn.
 *
 * SRD writes two different caps and they are not interchangeable — see
 * {@link AreaTrigger}. `oncePerTurn` bars every clause once anything has
 * fired; `onEntry: 'first-per-turn'` bars only a second *entry*, which is why
 * a creature that started its turn in a Web and walked back into it saves
 * twice.
 *
 * Outside combat there is no turn, so nothing is capped — the reading the
 * one-slot-per-turn rule and every once-per-turn feature already take.
 */
function areaTriggerAllowed(
  state: GameState,
  castingId: string,
  target: CharacterId,
  trigger: AreaTrigger,
  moment: AreaMoment,
  turn: number | null,
): boolean {
  if (turn === null) return true;

  const stamp = state.areaTriggers[areaStampKey(castingId, target)];
  if (stamp === undefined || stamp.turn !== turn) return true;

  if (trigger.oncePerTurn === true) return false;

  // **Only a creature's own entry spends the entry cap.** SRD Web caps "the
  // first time a creature **enters** the webs on a turn", and an area that
  // slid onto a creature standing still was not entered by it. No registered
  // spell prints both clauses, so nothing observes this today — which is
  // precisely why the narrow reading is the one to write down now, while the
  // sentence that decides it is still in front of us.
  return !(moment === 'entry' && trigger.onEntry === 'first-per-turn' && stamp.byCreatureEntry);
}

/** Raise one debt, and stamp the turn it was raised on. */
function oweAreaEffect(
  state: GameState,
  castingId: string,
  target: CharacterId,
  moment: AreaMoment,
  turn: number | null,
): GameState {
  const key = areaStampKey(castingId, target);
  const previous = state.areaTriggers[key];

  return {
    ...state,
    owedAreaEffects: [...state.owedAreaEffects, { castingId, target, moment }],
    areaTriggers:
      turn === null
        ? state.areaTriggers
        : sortedRecord({
            ...state.areaTriggers,
            [key]: {
              turn,
              byCreatureEntry:
                moment === 'entry' ||
                (previous?.turn === turn && previous.byCreatureEntry === true),
            },
          }),
  };
}

/**
 * The debts a turn boundary raises: one creature's end, then another's start.
 *
 * Both are raised by the same fold of the same `turn-advanced`, because the
 * reducer cannot roll and raising is derived — but they are stamped with
 * *different moments*, and settlement is what keeps them a round apart. See
 * `settleAreaEffects`.
 */
export function raiseAreaBoundary(
  state: GameState,
  moment: TurnMoment,
  whose: CharacterId | undefined,
  turn: number,
): GameState {
  const scene = state.scene;
  if (scene === null || whose === undefined) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;
    const definition = areaDefinitionOf(record);
    if (definition === null) continue;
    if (definition.trigger.at !== moment) continue;

    const inside = creaturesInCastingArea(scene, record);
    if (inside === null || !inside.has(whose)) continue;

    if (!areaTriggerAllowed(current, castingId, whose, definition.trigger, moment, turn)) continue;
    current = oweAreaEffect(current, castingId, whose, moment, turn);
  }
  return current;
}

/**
 * The debts a position change raises: outside → inside, and nothing else.
 *
 * **Every creature whose position actually changed**, not the one the event
 * names. `moveCreature` carries riders with their mount, so a rider crosses
 * into a Web with no event mentioning them at all — and reading `event.id`
 * alone is a bug a single-rider fixture is the only thing that catches.
 *
 * Only `false → true` fires. Already inside and staying, outside and staying,
 * and inside to outside are all silent, because none of them is entering.
 *
 * **Placement is not entry, and that is structural rather than a guard.** A
 * creature being put into the scene is not in `before.positions` at all, so it
 * has no outside to have come from and the diff cannot fire for it — which is
 * why there is no check here saying so, and why a mutation that calls this
 * from `creature-placed` changes nothing. An unplaced creature is likewise in
 * no area, so "unknown is outside" needs no statement either.
 *
 * **What this cannot see is the path.** The engine records where a move
 * started and where it ended and nothing in between, so a creature that walks
 * clean across a Web from one side to the other transitions outside → outside
 * and nothing fires. That is a real gap and it is reported rather than
 * guessed at: inferring the crossing from a straight line between the
 * endpoints would be the engine inventing a route nobody took. SRD lets a
 * creature break its movement into segments, and each segment is an
 * authoritative move that this does see, which is the operational answer until
 * movement records a path.
 */
export function raiseAreaEntries(state: GameState, before: PositionState | null): GameState {
  const scene = state.scene;
  if (scene === null || before === null) return state;

  const moved = creaturesThatMoved(before, scene);
  if (moved.length === 0) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;
    const definition = areaDefinitionOf(record);
    if (definition === null || definition.trigger.onEntry === undefined) continue;

    const was = creaturesInCastingArea(before, record);
    const now = creaturesInCastingArea(scene, record);
    if (was === null || now === null) continue;

    const turn = state.combat?.turnsTaken ?? null;
    for (const who of moved) {
      if (was.has(who) || !now.has(who)) continue;
      if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'entry', turn)) continue;
      current = oweAreaEffect(current, castingId, who, 'entry', turn);
    }
  }
  return current;
}

/**
 * What a movement did to every persistent area in play.
 *
 * One authoritative fact — a creature's position changed — and two rules read
 * it, because the SRD writes two clauses. Which one applies depends on *whose*
 * position moved: see {@link raiseAreaEntries} and {@link raiseCarriedArrivals}.
 *
 * The carrier side runs first so the debts are raised in the order settlement
 * discharges them; the two touch disjoint creatures, so the order changes no
 * outcome and exists only to keep a fold's list in the order a reader expects.
 */
export function raiseAfterMovement(state: GameState, before: PositionState | null): GameState {
  return raiseAreaEntries(raiseCarriedArrivals(state, before), before);
}

/** Every creature whose authoritative position differs between two scenes. */
function creaturesThatMoved(before: PositionState, after: PositionState): readonly CharacterId[] {
  return Object.keys(after.positions).filter((who) => {
    const now = after.positions[who];
    const then = before.positions[who];
    if (now === undefined || then === undefined) return false;
    return now.x !== then.x || now.y !== then.y || now.z !== then.z;
  }) as CharacterId[];
}

/**
 * The creatures a **carried** area arrived on because its carrier moved.
 *
 * SRD's glossary is the whole rule: "An Emanation moves with the creature or
 * object that is its origin." So a cleric walking across a room takes Spirit
 * Guardians with them, and a creature the aura sweeps onto has done nothing at
 * all — which is exactly the clause the spell prints separately from the other
 * two: "whenever the **Emanation enters a creature's space** and whenever a
 * creature enters the Emanation or ends its turn there."
 *
 * **Same authoritative fact as `raiseAreaEntries`, opposite reading of it.**
 * Both hang off a creature's position changing; they differ in *whose*
 * position it was and therefore in what happened:
 *
 * | | Whose position changed | Who is caught | Moment |
 * |---|---|---|---|
 * | `raiseAreaEntries` | the creature that is caught | creatures that moved | `entry` |
 * | this | the **carrier** of the area | creatures that **did not** move | `area-moved` |
 *
 * The partition is exact and is the reason nothing double-fires: a creature
 * that moved has entered, and a creature that stood still has been entered
 * upon. Collapsing the two into "membership changed somehow" would erase the
 * distinction the SRD drew — and the two clauses can be capped differently.
 *
 * **The carrier is whoever actually moved, never whoever the event names.**
 * `moveCreature` carries riders with their mount, so a cleric riding a horse
 * takes their aura with them on an event that mentions only the horse. Reading
 * `event.id` is a bug a mounted fixture is the only thing that catches — the
 * same lesson the creature-side detector already learned.
 */
function raiseCarriedArrivals(state: GameState, before: PositionState | null): GameState {
  const scene = state.scene;
  if (scene === null || before === null) return state;

  const moved = new Set(creaturesThatMoved(before, scene));
  if (moved.size === 0) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;

    const definition = areaDefinitionOf(record);
    if (definition === null || definition.trigger.onAreaEntry !== true) continue;
    // A point-origin area does not move because anybody walked; Moonbeam's
    // Cylinder stays exactly where it was put until `spell-origin-moved` says
    // otherwise. This reads the carrier and nothing else.
    if (definition.area.origin !== 'self') continue;
    if (!moved.has(record.caster as CharacterId)) continue;

    const was = creaturesInCastingArea(before, record);
    const now = creaturesInCastingArea(scene, record);
    if (was === null || now === null) continue;

    const turn = state.combat?.turnsTaken ?? null;
    for (const who of [...now].sort()) {
      // A creature that moved is the entry detector's business, not this
      // one's.
      //
      // **Two of the three conditions on this line are unreachable today, and
      // are kept as statements of the rule rather than as optimisations.** One
      // authoritative operation moves one creature plus its riders, and riders
      // travel rigidly with their mount — so no event can move a carrier and
      // an independent creature at once, and no point-origin area's membership
      // can change because somebody walked. A mutation removing either passes
      // the whole suite; a mutation removing `was.has(who)` does not, because
      // firing for a creature the aura was already on is observable at once.
      //
      // What they buy is that the next operation to move two creatures
      // independently gets the right answer rather than a double consequence,
      // and that this function stays about carried areas. Stated here so
      // neither reads as dead weight to whoever finds them next.
      if (moved.has(who) || was.has(who)) continue;
      if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'area-moved', turn)) {
        continue;
      }
      current = oweAreaEffect(current, castingId, who, 'area-moved', turn);
    }
  }
  return current;
}

/**
 * The creatures a casting's area has just arrived on.
 *
 * SRD Moonbeam: "A creature also makes this save **when the spell's area moves
 * into its space**." Cloudkill, Incendiary Cloud and Spirit Guardians print
 * the same clause about their own areas. It is not the entry clause wearing a
 * different coat: nobody moved, and a creature that did not move has not
 * entered anything.
 *
 * **The authoritative operation says what changed, and that is the whole of
 * the design.** `creature-moved` means a creature's membership may have
 * changed and `raiseAreaEntries` answers it; `spell-origin-moved` means *this
 * casting's* area moved and this answers that. Nothing anywhere asks the
 * weaker question "did membership change somehow", because the SRD wrote two
 * clauses and an engine that could not tell them apart would have to guess
 * which one it was obeying.
 *
 * So this compares one casting's area at two points and every creature in the
 * scene, where the entry detector compares every casting against the creatures
 * that moved. Outside-before and inside-after is the only transition that
 * fires: inside → inside is a creature the beam was already on, inside →
 * outside is one it left, and outside → outside is dealt with above the
 * reducer — see `relocateOrigin`, which says out loud when a leg was long
 * enough to have passed over somebody unseen.
 *
 * **Creation is not movement.** A casting's first `spell-ongoing` records
 * where the area is and raises nothing here; the creatures standing in it are
 * caught by the spell's own casting effect, which is the sentence "when the
 * Cylinder appears" and is resolved at the cast. Only a *move* of an area that
 * already exists reaches this function, which is structural rather than
 * guarded: `spell-origin-moved` throws for a casting that holds no point.
 */
export function raiseAreaArrivals(
  state: GameState,
  castingId: string,
  from: Point,
  to: Point,
): GameState {
  const scene = state.scene;
  if (scene === null) return state;

  const record = state.ongoing[castingId];
  if (record === undefined) return state;

  const definition = areaDefinitionOf(record);
  // **A fixed area gains nothing from a neighbour's moving one.** Web's Cube
  // stays where it was conjured, and a hand-built log that moved its point
  // anyway must not make it start catching people on a clause it never printed.
  if (definition === null || definition.trigger.onAreaEntry !== true) return state;

  const was = creaturesInCastingArea(scene, { ...record, origin: from });
  const now = creaturesInCastingArea(scene, { ...record, origin: to });
  if (was === null || now === null) return state;

  const turn = state.combat?.turnsTaken ?? null;

  let current = state;
  for (const who of [...now].sort()) {
    if (was.has(who)) continue;
    if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'area-moved', turn)) {
      continue;
    }
    current = oweAreaEffect(current, castingId, who, 'area-moved', turn);
  }
  return current;
}

/**
 * Forgive a debt whose subject has left the game or died.
 *
 * Derived, like every other lapse: nobody decides that a creature is no longer
 * there, and a debt addressed to a corpse is one nothing can settle and the
 * turn would refuse to advance past for ever. A dead creature takes no turns
 * and enters nothing, so every moment this debt could record is one that can
 * no longer happen to them.
 */
export function dropOrphanedAreaEffects(state: GameState): GameState {
  const live = state.owedAreaEffects.filter((owed) => {
    const creature = state.creatures[owed.target];
    return creature !== undefined && !creature.vitals.dead;
  });
  return live.length === state.owedAreaEffects.length ? state : { ...state, owedAreaEffects: live };
}

