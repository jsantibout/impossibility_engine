/**
 * What a casting left behind, read back.
 *
 * A casting is history; what it left behind is live state. `state.ongoing`
 * holds the second — see `OngoingSpell` in `spells.ts` for why each field is
 * there and why none of the others are. This is the read side of it, together
 * with the geometry of a casting that holds a point: where the force is, how
 * far it may be moved, and what a route through the lattice costs.
 *
 * Acting *through* one of these records is `activation.ts`, which sits at the
 * top of the stack because it resolves a spell's effects and settles what they
 * owe. This module is underneath everything and resolves nothing.
 */

import {
  type CharacterId,
  type ContextRequest,
  err,
  type Err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { allyOfCaster, isOn, spellOn, type GameEvent, type GameState } from '../events.js';
import { type Content } from '../content.js';
import {
  creaturesInArea,
  distanceBetween,
  distanceBetweenPoints,
  distanceToPoint,
  isInsideScene,
  type Point,
  type PositionState,
  snapToSpace,
} from '../positioning.js';
import { canSeePoint } from '../standing.js';
import {
  ranged,
  type SpellActivation,
  type SpellDefinition,
} from '../spell-definitions.js';
import { castingNumber, type OngoingSpell } from '../spells.js';
import { type ActivateSpellCommand } from './activation.js';
import { ROUTE_REQUIRED } from './command.js';

/**
 * The spells currently running on a creature, oldest casting first.
 *
 * SRD Dispel Magic's actual question: "Any ongoing spell ... **on the
 * target**". Sorted by casting id so two readers of the same state agree about
 * the order, which matters because Dispel Magic walks the list rolling checks.
 *
 * A pure query over live state: it looks nothing up in the log, searches no
 * history, and answers only what the rules ask for. **`isOn` is the whole of
 * what it knows about membership** — the stored half of the record unioned
 * with what the casting is holding on the creature now — so this reader cannot
 * drift from the other three that ask the same question.
 */
export function ongoingSpellsOn(
  state: GameState,
  who: CharacterId,
): readonly OngoingSpell[] {
  return byCastingOrder(state).filter((record) => isOn(state, record, who));
}

/** The spells this creature cast that are still running, oldest first. */
export function ongoingSpellsBy(
  state: GameState,
  caster: CharacterId,
): readonly OngoingSpell[] {
  return byCastingOrder(state).filter((record) => record.caster === caster);
}

/** One ongoing spell by the casting that made it, or null if it has ended. */
export function ongoingSpellOf(state: GameState, castingId: string): OngoingSpell | null {
  return state.ongoing[castingId] ?? null;
}

/**
 * A casting whose early ending the engine cannot judge, and whose damage.
 *
 * SRD writes "until **you or your allies** damage it" in five spells, and an
 * ally is declared allegiance — so where nobody has said which side a creature
 * is on, the ending is **withheld rather than invented**: the same three-valued
 * reading declared cover, declared sight and Sneak Attack's flanking clause
 * already take, and the same refusal to answer a question nobody asked the
 * engine.
 *
 * **A derived pass has no `unverified` line**, which is the whole reason this
 * is a query. `resolveAttack` can hand back a sentence beside its result
 * because it is a command with a result; the reducer's ending is derived, has
 * no return value a caller reads, and happens after the fact — so the honest
 * place to say "this could not be judged" is a question a caller may ask of
 * the state, before or after the blow.
 *
 * **It is a standing fact, not a record of a moment.** What it reports is that
 * *right now*, this casting carries the clause and these creatures could not be
 * judged against it — the caster themself never among them, because the
 * sentence names them. A casting with no such trigger, or one where every side
 * is declared, contributes nothing.
 */
export interface WithheldEnding {
  readonly castingId: string;
  /** The display name, so a tool surface needs no second lookup. */
  readonly spell: string;
  readonly caster: string;
  /**
   * Whose damage to one of this casting's targets could not be judged the
   * caster's or an ally's, sorted. Never empty — an entry with nothing to
   * report is not reported.
   */
  readonly unjudged: readonly CharacterId[];
  readonly reason: string;
}

export function withheldEndings(state: GameState): readonly WithheldEnding[] {
  const out: WithheldEnding[] = [];

  for (const record of byCastingOrder(state)) {
    const clause = record.endsEarly?.some(
      (trigger) => trigger.on === 'caster-or-ally-damages-target',
    );
    if (clause !== true) continue;

    // The creature's own id rather than the key it is filed under, so the
    // brand travels and the answer is the same list `on` is written from.
    const unjudged = Object.keys(state.creatures)
      .sort()
      .map((key) => state.creatures[key])
      .filter(
        (who): who is NonNullable<typeof who> =>
          who !== undefined && allyOfCaster(state, record.caster, who.id) === 'unknown',
      )
      .map((who) => who.id);
    if (unjudged.length === 0) continue;

    out.push({
      castingId: record.castingId,
      spell: record.spell,
      caster: record.caster,
      unjudged,
      reason: `${record.spell} ends when ${record.caster} or one of their allies damages a target, and nobody has declared which side ${unjudged.length === 1 ? `${unjudged[0]} is` : 'these creatures are'} on — so damage from ${unjudged.length === 1 ? 'them' : 'any of them'} leaves the casting running rather than ending it on a guess`,
    });
  }

  return out;
}

/**
 * Every ongoing spell, in the order the castings happened.
 *
 * Numerically, not lexically: `cast:2` runs before `cast:10`, and a string
 * sort would put ten first — which would silently reorder the checks Dispel
 * Magic rolls and make a replay of the same log produce different dice.
 */
function byCastingOrder(state: GameState): readonly OngoingSpell[] {
  return Object.values(state.ongoing).sort(
    (a, b) => castingNumber(a.castingId) - castingNumber(b.castingId),
  );
}

/**
 * SRD Mage Hand: "The hand vanishes ... if you cast this spell again."
 * SRD Prestidigitation: "you can have up to **three** of its
 * non-instantaneous effects active at a time."
 *
 * The same caster, the same spell, and one arithmetic for both sentences —
 * see {@link SpellDefinition.maxRunning}, which is the second of them and is
 * the first with a number other than one. A lookup over the live records
 * rather than a search through history, which is the difference the ongoing
 * record makes: before it, obeying either sentence meant scanning the log for
 * a `spell-cast` and then proving nothing had ended it since.
 */
export function replacedCastings(
  state: GameState,
  casterId: CharacterId,
  definition: SpellDefinition,
  /** The creatures the new casting names, for a recast rule that reads either end. */
  targets: readonly CharacterId[] = [],
): readonly GameEvent[] {
  // **One rule with two numbers.** `replacesPriorCasting` is a cap of one and
  // `maxRunning` is a cap of *n*; the validator refuses a definition that
  // writes both, so at most one of these two lines is ever about anything.
  const cap = definition.replacesPriorCasting === true ? 1 : definition.maxRunning;
  if (cap === undefined) return [];

  // SRD Warding Bond: "It also ends if the spell is cast again on **either of
  // the connected creatures**." The same cap of one read over a wider
  // population: every running casting of this spell, by anybody, whose caster
  // or whose target is the caster or a target of the casting being made. A
  // bond the same cleric lays on somebody else ends the first; a second
  // cleric's bond on the same fighter ends it too. (W7-S19)
  if (definition.replacesPriorCastingOn === 'either') {
    const connected = new Set<string>([casterId, ...targets]);
    return byCastingOrder(state)
      .filter(
        (record) =>
          record.spellId === definition.id &&
          (connected.has(record.caster) ||
            spellOn(state, record).some((who) => connected.has(who))),
      )
      .map((record) => ({
        type: 'spell-ended' as const,
        castingId: record.castingId,
        on: null,
        reason: 'recast' as const,
      }));
  }

  // Oldest first, which `ongoingSpellsBy` already guarantees numerically —
  // `cast:2` before `cast:10`, never the string order.
  const mine = ongoingSpellsBy(state, casterId).filter(
    (record) => record.spellId === definition.id,
  );
  // How many have to go for the casting about to be made to be the last that
  // fits. A cap of one takes every one of them, which is the sentence
  // `replacesPriorCasting` has always written.
  const over = mine.length - (cap - 1);
  if (over <= 0) return [];

  return mine.slice(0, over).map((record) => ({
    type: 'spell-ended' as const,
    castingId: record.castingId,
    on: null,
    reason: 'recast' as const,
  }));
}

/**
 * The carried areas this move would sweep across spaces nobody named.
 *
 * **The same hole Moonbeam's route had, arriving from the other direction.**
 * There the caller asked to move an area thirty feet; here they ask to move a
 * *creature*, and the area comes along because SRD says an Emanation "moves
 * with the creature or object that is its origin". Either way the engine knows
 * two endpoints and no route, and either way the creatures who would be caught
 * are the ones who did nothing.
 *
 * So the answer is the same answer: ask. A move of one space has no space in
 * between to be unknown; anything longer is a `needs-context` naming the
 * casting, the carrier, both ends and what to send instead. Nothing is spent
 * while it waits — no Speed, no Opportunity Attack, no die.
 *
 * **Reuses the movement the engine already has rather than a route field.** A
 * creature move is already authoritative, already segmentable, and already
 * settles what it raised before the next voluntary action — the global
 * area-debt guard sees to that. A `MovePath` here would have been a second
 * mechanism for something movement can already express, built for symmetry
 * with Moonbeam rather than because a rule asked.
 *
 * Reads the carrier by **position change**, never by the id on the command: a
 * cleric carried by their horse moves on an event that names only the horse.
 */
export function sweptRoute(
  state: GameState,
  content: Content,
  before: PositionState,
  after: PositionState,
): readonly ContextRequest[] {
  const requests: ContextRequest[] = [];

  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;

    const definition = content.spell(record.spellId);
    const area = definition?.area;
    // Only an area that is carried, and only one a rule watches as it travels.
    if (area === undefined || area.origin !== 'self') continue;
    if (definition?.areaTrigger?.onAreaEntry !== true) continue;

    const from = before.positions[record.caster];
    const to = after.positions[record.caster];
    if (from === undefined || to === undefined) continue;

    const travelled = distanceBetweenPoints(from, to);
    if (travelled <= SPACE) continue;

    requests.push({
      kind: 'route',
      subject: castingId,
      need: `which 5-foot spaces ${record.caster} passed through between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) — ${travelled} feet, carrying ${record.spell}`,
      because: `${record.spell} catches every creature its area moves into, and the spaces between two points are not something the engine may decide`,
      satisfyWith: `resolveMove again as ${travelled / SPACE} moves of one space each, settling what each raises before the next`,
    });
  }

  return requests;
}

/**
 * One space on the lattice, in feet.
 *
 * SRD: "Each square represents 5 feet." The only thing this is used for here
 * is deciding whether a leg of an area's route had anything *between* its
 * endpoints: a step to an adjacent space has no cube in between and is exact,
 * and anything longer does.
 */
const SPACE = 5;

/**
 * Every place the casting's point was during this activation, in order.
 *
 * **A spell-origin move is not creature movement, and nothing here makes it
 * one.** The rules a creature's move obeys are absent because the SRD never
 * applies them to the force: no Speed is spent, no Difficult Terrain is
 * charged, no Opportunity Attack is provoked, no space is occupied and nothing
 * ends up Prone for sharing one. Routing it through `moveCreature` to reuse
 * the geometry would have imported every one of those.
 *
 * What the engine does own is the whole of what SRD prints: the allowance in
 * feet, measured from where the point is **now**; the scene it has to stay
 * inside; and the identity of the casting being moved, which the caller named
 * and the command has already checked belongs to them.
 *
 * **A list rather than a destination, because a moving *area* makes the route
 * observable.** Twenty feet of beam passes over the space in between, and two
 * points do not imply the line between them — so each leg the caller states is
 * an authoritative relocation of its own, and a leg the caller did not break
 * up says in `unverified` that nothing records what it crossed. For a point
 * nothing triggers on, the route is unobservable and one leg is the whole
 * answer, which is every Spiritual Weapon and why nothing there changed.
 *
 * Empty when this activation moved nothing — an ordinary later-turn spell like
 * Vampiric Touch — which leaves the reach check measuring from the caster.
 */
export function relocateOrigin(
  state: GameState,
  record: OngoingSpell,
  definition: SpellDefinition,
  command: ActivateSpellCommand,
): Result<readonly Point[]> {
  const current = record.origin ?? null;

  // **Two sentences, two allowances.** Spiritual Weapon's is a rider on a
  // Bonus Action that also strikes, so declining it is legal; Moonbeam's is
  // the Magic action's entire content, so declining it spends an action on
  // nothing. Which one this is decides both the number and whether `to` may
  // be left out.
  const asAction = definition.activation?.movesArea;
  const asRider = definition.origin?.movableBy;
  const allowance = asAction ?? asRider;

  if (command.to === undefined) {
    if (asAction !== undefined) {
      return err(
        'destination_required',
        `${record.spell}'s later action is moving the area; name where it goes`,
      );
    }
    if (command.via !== undefined && command.via.length > 0) {
      return err(
        'destination_required',
        `${record.spell} was given a route with nowhere to end`,
      );
    }
    return ok([]);
  }

  if (current === null || allowance === undefined) {
    return err(
      'not_movable',
      `${record.spell} holds nothing its caster can move`,
    );
  }
  if (state.scene === null) {
    return err('no_scene', `${record.spell} needs a scene to be moved about in`);
  }

  const legs = [...(command.via ?? []), command.to].map(snapToSpace);

  for (const space of legs) {
    if (!isInsideScene(state.scene, space)) {
      return err(
        'outside_scene',
        `${record.spell} cannot be moved to (${space.x}, ${space.y}, ${space.z}); that is outside this scene`,
      );
    }
  }

  // From where it is, not from where it started and not from the caster. A
  // force may be walked steadily further away than the spell's own Range,
  // which is exactly what "move the force up to 20 feet" says and what a
  // re-check against the caster would wrongly forbid.
  //
  // **The sum of the legs, not the displacement.** "Up to 60 feet" is a
  // distance travelled, so a route that doubles back spends what it walked
  // rather than what it achieved. With no waypoints the two are the same
  // number and every existing caller is untouched.
  let travelled = 0;
  let at = current;
  for (const space of legs) {
    travelled += distanceBetweenPoints(at, space);
    at = space;
  }
  if (travelled > allowance) {
    return err(
      'origin_too_far',
      `${record.spell} moves up to ${allowance} feet; that route is ${travelled} long`,
    );
  }

  // **What a leg cannot prove, and why that is a question rather than a
  // warning.** The engine knows the area was here and then there; it does not
  // know what it passed over. A leg longer than one space has spaces in
  // between that no fact in the log names, and there are only three things to
  // do about that: draw a line the engine was never told about, execute the
  // move while silently skipping whoever it crossed, or **ask**.
  //
  // The first two are the same failure in different clothes — the engine
  // answering a question nobody asked it. So this asks, through the mechanism
  // the engine already has for a thin record: nothing is spent, no die is
  // thrown, and the same activation sent again with the route filled in is the
  // activation the caller meant the first time.
  //
  // Only where a rule reads the route. A casting whose area triggers on
  // nothing as it travels has no route to be wrong about, which is every
  // Spiritual Weapon — and giving it this requirement because Moonbeam has it
  // would be a neighbouring spell's clause lending it a rule again.
  //
  // **Both arrival clauses read it**, for one reason written twice: SRD
  // Moonbeam catches whoever the *area* sweeps over and SRD Flaming Sphere
  // catches whoever the *point* is rolled into, and thirty feet of rolling
  // crosses five spaces either way. A ram that only ever looked at the
  // endpoint would be the engine silently skipping the goblin in the middle.
  if (
    definition.areaTrigger?.onAreaEntry === true ||
    definition.areaTrigger?.onPointEntry === true
  ) {
    const coarse: ContextRequest[] = [];
    let previous = current;
    for (const space of legs) {
      const leg = distanceBetweenPoints(previous, space);
      if (leg > SPACE) coarse.push(routeRequest(record, previous, space, leg, allowance));
      previous = space;
    }
    if (coarse.length > 0) {
      // `route_required` and not `single_steps_required`: an area walked by a
      // later activation settles what each leg raised at the end of the one
      // command, because nothing that happens to the creatures it passes over
      // can stop the area travelling. A creature carrying an area can be
      // stopped by what it walks into, which is why the move's own sweep asks
      // for something else. See {@link ROUTE_REQUIRED}.
      return needsContext(
        ROUTE_REQUIRED,
        `${record.spell}'s area triggers on the creatures it moves into, and ${coarse.length === 1 ? 'one leg of' : `${coarse.length} legs of`} the requested route ${coarse.length === 1 ? 'crosses' : 'cross'} spaces nothing records; send the activation again with \`via\` naming each 5-foot step`,
        coarse,
      );
    }
  }

  return ok(legs);
}

/**
 * The route fact the engine will not invent, addressed to the orchestrator.
 *
 * **`via` is an adjudicated route, not player micromanagement.** A player says
 * "move the beam onto the ogre"; somebody then decides which way it goes, and
 * that decision is judgement rather than arithmetic — whether to sweep it
 * through the other two ogres, whether to keep it off the paladin, whether the
 * player said anything that settles it. Maestro owns that call, because
 * Maestro is the layer that reads the fiction. **The engine validates the
 * route and never chooses it**, which is the same boundary `eligibleTargets`
 * draws for targeting: a shortlist, not a substitution.
 *
 * So this is not a refusal and must never be described as one. The action is
 * mechanically possible; one fact it needs has not been supplied yet.
 */
function routeRequest(
  record: OngoingSpell,
  from: Point,
  to: Point,
  leg: number,
  allowance: number,
): ContextRequest {
  return {
    kind: 'route',
    subject: record.castingId,
    need: `which 5-foot spaces ${record.spell}'s area crossed between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) — ${leg} feet, of the ${allowance} it may move`,
    because: `${record.spell} catches every creature its area moves into, and the spaces between two points are not something the engine may decide`,
    satisfyWith: `activateSpell again with \`via\` listing each space the area passes through, one 5-foot step at a time`,
  };
}

/**
 * The area a caster carries while walking — SRD Conjure Animals' pack.
 *
 * > "when you move on your turn, you can also move the pack up to 30 feet to an
 * > unoccupied space you can see."
 *
 * **A rider on a move, not an action**, which is the whole reason it is here
 * rather than in `relocateOrigin`: that one spends a Magic action or rides a
 * Bonus Action that also strikes, and this costs nothing at all — the pack goes
 * nowhere on a turn its druid stands still, and everywhere the druid's own
 * command goes it may go too. So the allowance is the definition's
 * (`areaMovesWithCaster`) and the decision is the caller's, exactly as the
 * destination of every other moved area is.
 *
 * Four refusals and all of them before the move is spent: the casting has to be
 * running, it has to be this mover's, it has to hold a point, and the
 * destination has to be inside the allowance, inside the scene, empty and seen.
 * The space and the sight are read now rather than pinned, because both are facts
 * about the scene at the moment the pack is walked.
 *
 * Returns the one event the move appends, or null where the caller asked for
 * nothing.
 */
export function carryAreaWithMover(
  state: GameState,
  moverId: CharacterId,
  asked: { readonly castingId: string; readonly to: Point } | undefined,
  content: Content,
  unverified: string[],
): Result<GameEvent | null> {
  if (asked === undefined) return ok(null);

  const record = state.ongoing[asked.castingId];
  if (record === undefined) {
    return err('not_ongoing', `${asked.castingId} is not a spell that is still running`);
  }
  if (record.caster !== moverId) {
    return err(
      'not_your_spell',
      `${asked.castingId} is ${record.caster}'s casting; ${moverId} cannot carry it`,
    );
  }
  const allowance = content.spell(record.spellId)?.areaMovesWithCaster;
  if (allowance === undefined || record.origin === undefined) {
    return err(
      'not_movable',
      `${record.spell} holds nothing its caster can carry along while walking`,
    );
  }
  if (state.scene === null) {
    return err('no_scene', `${record.spell} needs a scene to be carried about in`);
  }
  // **Once on the turn, not once on the command.** SRD Conjure Animals: "when you
  // move on your turn, you can **also** move the pack" — one sentence about one
  // turn's walking, and a creature may break thirty feet into six commands of
  // five. So the cap is the turn the point last moved on rather than the rider
  // being spent by the command that carries it. Outside a fight nothing is capped,
  // which is what every other once-per-turn rule here does.
  const turn = state.combat?.turnsTaken;
  if (turn !== undefined && record.movedOnTurn === turn) {
    return err(
      'pack_already_carried',
      `${record.spell} has already been carried this turn; the spell moves it when its caster moves, once`,
    );
  }

  const to = snapToSpace(asked.to);
  if (!isInsideScene(state.scene, to)) {
    return err(
      'outside_scene',
      `${record.spell} cannot be carried to (${to.x}, ${to.y}, ${to.z}); that is outside this scene`,
    );
  }
  // "up to 30 feet", measured from where the pack is now rather than from the
  // caster: it is the pack that travels, and a druid who has walked it thirty
  // feet a round has walked it three hundred in ten.
  const travelled = distanceBetweenPoints(record.origin, to);
  if (travelled > allowance) {
    return err(
      'pack_too_far',
      `${record.spell} is carried up to ${allowance} feet and that space is ${travelled} away`,
    );
  }
  // "to an **unoccupied** space", asked of the lattice the ruler already reads.
  const standing = creaturesInArea(state.scene, { space: to }, { kind: 'sphere', radius: 0 });
  if (standing.ok && standing.value.length > 0) {
    return err(
      'pack_space_occupied',
      `${record.spell} is carried to an unoccupied space, and ${standing.value.join(', ')} ${standing.value.length === 1 ? 'is' : 'are'} standing there`,
    );
  }
  // "a space **you can see**", asked of the caster's senses exactly as a casting
  // asks them — a declaration first, then what reaches. Three-valued like every
  // sight question: nobody can declare a line to a patch of ground, so silence is
  // reported and the pack goes, and only a declared *no* refuses.
  const seen = canSeePoint(state, moverId, to);
  if (seen === false) {
    return err('pack_unseen', `${moverId} cannot see the space ${record.spell} would be carried to`);
  }
  if (seen === null) {
    unverified.push(
      `nobody has said whether ${moverId} can see (${to.x}, ${to.y}, ${to.z}), and ${record.spell} is carried to a space its caster can see`,
    );
  }

  // `carried` is what tells this apart from a beam an activation walked, and it is
  // what the turn stamp is read off — see `spell-origin-moved.carried`.
  return ok({ type: 'spell-origin-moved', castingId: record.castingId, to, carried: true });
}

/**
 * Whether a point is under the point a casting keeps — SRD Call Lightning's
 * "choose a point you can see **under the cloud**", or null where it is.
 *
 * **One reader for two moments**, which is the discipline every printed number in
 * this engine keeps: the bolt at the cast and the bolts called down afterwards are
 * held to the same sixty feet, and two spellings of that would be two places for
 * the cloud's radius to be got wrong.
 */
export function underTheKeptPoint(
  from: Point,
  to: Point,
  allowance: number,
  spell: string,
): Err | null {
  const away = distanceBetweenPoints(from, snapToSpace(to));
  return away > allowance
    ? err(
        'outside_the_kept_point',
        `${spell} reaches ${allowance} feet from the point it holds, and the point named is ${away} away`,
      )
    : null;
}

/** An ordinary later-turn spell: the caster's own reach, checked afresh. */
export function reachFromCaster(
  state: GameState,
  casterId: CharacterId,
  target: CharacterId,
  record: OngoingSpell,
  activation: SpellActivation,
  unverified: string[],
): Err | null {
  const reach = activation.range === undefined ? null : ranged(activation.range);
  if (reach === null) return null;

  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${record.spell} could not check that ${target} is within ${reach} feet`,
    );
    return null;
  }

  const apart = distanceBetween(state.scene, casterId, target);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${casterId} and ${target} are standing, so ${record.spell}'s ${reach}-foot reach went unchecked`,
    );
    return null;
  }
  if (apart.value > reach) {
    return err(
      'out_of_range',
      `${target} is ${apart.value} feet away and ${record.spell} reaches ${reach}`,
    );
  }
  return null;
}

/** And the other half of the seam: reach measured from the point it holds. */
export function reachFromOrigin(
  state: GameState,
  target: CharacterId,
  origin: Point,
  record: OngoingSpell,
  definition: SpellDefinition,
  unverified: string[],
): Err | null {
  const reach = definition.origin?.reach;
  if (reach === undefined) return null;

  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${record.spell} could not check that ${target} is within ${reach} feet of it`,
    );
    return null;
  }

  const apart = distanceToPoint(state.scene, target, origin);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${target} is standing, so ${record.spell}'s ${reach}-foot reach went unchecked`,
    );
    return null;
  }
  if (apart.value > reach) {
    return err(
      'out_of_range',
      `${target} is ${apart.value} feet from ${record.spell} and it reaches ${reach}`,
    );
  }
  return null;
}

