/**
 * A save whose failure puts the target **inside** the creature that forced it,
 * and the holds around it — W7-B10.
 *
 * SRD Gelatinous Cube, Engulf: "The cube moves up to its Speed without
 * provoking Opportunity Attacks. The cube can move through the spaces of Large
 * or smaller creatures if it has room inside itself to contain them (see the
 * Ooze Cube trait). _Dexterity Saving Throw:_ DC 12, each creature whose space
 * the cube enters for the first time during this move. _Failure:_ 10 (3d6) Acid
 * damage, and the target is engulfed. An engulfed target is suffocating, can't
 * cast spells with a Verbal component, has the Restrained condition, and takes
 * 10 (3d6) Acid damage at the start of each of the cube's turns. When the cube
 * moves, the engulfed target moves with it. An engulfed target can try to
 * escape by taking an action to make a DC 12 Strength (Athletics) check. On a
 * successful check, the target escapes and enters the nearest unoccupied
 * space. _Success:_ Half damage, and the target moves to an unoccupied space
 * within 5 feet of the cube. If there is no unoccupied space, the target fails
 * the save instead."
 *
 * SRD Ooze Cube: "the cube can hold one Large creature or up to four Medium or
 * Small creatures inside itself at a time. As an action, a creature within 5
 * feet of the cube can pull a creature or an object out of the cube by
 * succeeding on a DC 12 Strength (Athletics) check, and the puller takes 10
 * (3d6) Acid damage."
 *
 * SRD Shambling Mound, Engulf: "_Strength Saving Throw:_ DC 15, one Medium or
 * smaller creature within 5 feet. _Failure:_ The target is pulled into the
 * shambling mound's space and has the Grappled condition (escape DC 14). Until
 * the grapple ends, the target has the Blinded and Restrained conditions, and
 * it takes 10 (3d6) Lightning damage at the start of each of its turns. … The
 * shambling mound can have only one creature Grappled by this action at a
 * time."
 *
 * The save-side road into the second place, beside the hit-side one
 * `swallow.test.ts` drives. The dice are the engine's, so each rule is asserted
 * on whichever way they fell and both ways are shown to have been seen.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, expect as unwrap, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  damageCreature,
  declareCreatureSide,
  escapeFromInside,
  escapeGrapple,
  forcePrintedSave,
  placeCreatureInScene,
  pullOutOfCreature,
  resolveMove,
  resolveTurn,
  returnFromElsewhere,
  setScene,
  takePrintedMove,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { elsewhereOf, heldInside, roomInside } from './elsewhere.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { distanceBetween, positionOf, type Point } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { silencedBy } from './standing.js';
import { grapplesOn } from './commands/unarmed.js';

const id = (s: string) => asCharacterId(s);
const CUBE = id('cube');
const ONE = id('c1');
const TWO = id('c2');
const THREE = id('c3');
const FOUR = id('c4');
const FIVE = id('c5');
const CLERIC = id('cleric');
const MOUND = id('mound');
const GOBLIN = id('goblin');
const SECOND = id('second-goblin');

const ENGULF = 'Engulf';
const p = (x: number, y: number): Point => ({ x, y, z: 0 });

class Table {
  constructor(private readonly seed: string) {}
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(this.seed, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
  private draws = 0;
  /** A fresh generator per call, salted by how many have been asked for — `webs.test.ts`'s shape. */
  supply() {
    this.draws += 1;
    return {
      issuer: createRollIssuer(`r${this.draws}`),
      rng: createRng(`${this.seed}:${this.draws}`) as Rng,
      content: SRD_CONTENT,
    };
  }
}

/**
 * The cube at the drain with two knights in its path, three commoners well out
 * of it, and a third knight (the cleric of the brief) five feet beyond where
 * the cube's walk ends. Knights, because a commoner has four Hit Points and
 * 3d6 Acid would kill the creature the rest of the file needs alive. The
 * cube's turn is first.
 */
function cellar(seed: string): Table {
  const table = new Table(seed);
  table.did('the cube arrives', (s) => addCreature(s, SRD_CONTENT, CUBE, 'gelatinous-cube'));
  for (const who of [ONE, TWO, CLERIC]) {
    table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'knight'));
  }
  for (const who of [THREE, FOUR, FIVE]) {
    table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'commoner'));
  }
  table.do('the cellar', (s) => setScene(s, { width: 100, depth: 100, height: 20 }));
  table.do('the drain', (s) => addSceneLandmark(s, 'the drain', { x: 10, y: 50, z: 0 }));
  const places: readonly (readonly [CharacterId, Point])[] = [
    [CUBE, p(10, 50)],
    [ONE, p(20, 50)],
    [TWO, p(20, 55)],
    [THREE, p(20, 80)],
    [FOUR, p(25, 80)],
    [FIVE, p(30, 80)],
    [CLERIC, p(35, 50)],
  ];
  for (const [who, at] of places) {
    table.do(`${who} stands`, (s) => placeCreatureInScene(s, who, { from: { point: at }, feet: 0, bearing: 0 }));
  }
  for (const who of [ONE, TWO, THREE, FOUR, FIVE, CLERIC]) {
    table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  }
  table.do("the cube's side", (s) => declareCreatureSide(s, CUBE, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: CUBE, initiative: 20, speed: 15 },
      { id: ONE, initiative: 15, speed: 30 },
      { id: TWO, initiative: 14, speed: 30 },
      { id: CLERIC, initiative: 12, speed: 30 },
      { id: THREE, initiative: 8, speed: 30 },
      { id: FOUR, initiative: 7, speed: 30 },
      { id: FIVE, initiative: 6, speed: 30 },
    ]),
  );
  return table;
}

/** The cube's walk east through both commoners, ending in the empty space beyond them. */
const THROUGH_BOTH: readonly Point[] = [p(15, 50), p(20, 50), p(25, 50)];

/**
 * Where a knight who saves steps to: north or south of the cube's final box,
 * which spans (25..30, 50..55). Points rather than bearings from the cube,
 * because a bearing is measured from a creature's origin cube and five feet
 * north of a Large creature's origin is inside its own body.
 */
const NORTH_OF_THE_CUBE = { from: { point: p(25, 60) }, feet: 0, bearing: 0 };
const SOUTH_OF_THE_CUBE = { from: { point: p(25, 45) }, feet: 0, bearing: 0 };
const LANDINGS = { [ONE]: NORTH_OF_THE_CUBE, [TWO]: SOUTH_OF_THE_CUBE };

const SEEDS = Array.from({ length: 16 }, (_, i) => `cellar-${i}`);

/**
 * A seed under which the cube's walk engulfs the first knight, found rather
 * than guessed — searching from `startAt`, so two callers asking for different
 * starts get different cellars and the dice after the engulf fall differently.
 */
function aCellarWhereOneIsEngulfed(startAt = 0): Table {
  for (const seed of [...SEEDS.slice(startAt), ...SEEDS.slice(0, startAt)]) {
    const table = cellar(seed);
    const out = unwrap(
      takePrintedMove(table.state, CUBE, { line: ENGULF, route: THROUGH_BOTH, landings: LANDINGS }, table.supply()),
      'the engulf',
    );
    table.log.push(...out.events);
    if (elsewhereOf(table.state, ONE)?.kind === 'inside') return table;
  }
  throw new Error('no seed engulfed the first commoner');
}

describe("a Gelatinous Cube's Engulf", () => {
  it('walks through two commoners and rolls each a save: a failure is engulfed and a success steps clear', () => {
    let sawFailure = false;
    let sawSuccess = false;
    for (const seed of SEEDS) {
      const table = cellar(seed);
      const before = table.state;
      const out = unwrap(
        takePrintedMove(before, CUBE, { line: ENGULF, route: THROUGH_BOTH, landings: LANDINGS }, table.supply()),
        'the engulf',
      );
      table.log.push(...out.events);
      const state = table.state;
      expect(out.outcomes.map((one) => one.target).sort()).toEqual([ONE, TWO]);
      // The cube ended where the route ended, and offered nobody a swing.
      expect(positionOf(state.scene!, CUBE)).toEqual(p(25, 50));
      expect(out.unverified.join(' ')).toContain('suffocating');
      for (const outcome of out.outcomes) {
        const who = outcome.target;
        const record = elsewhereOf(state, who);
        if (outcome.save?.success === false) {
          sawFailure = true;
          // Inside: no position, Restrained, no Verbal casting, the full dice.
          expect(record?.kind).toBe('inside');
          expect(record?.host).toBe(CUBE);
          expect(positionOf(state.scene!, who)).toBeNull();
          expect(hasCondition(state.creatures[who]!.conditions, 'restrained')).toBe(true);
          expect(silencedBy(state, who)).toBe(ENGULF);
          expect(outcome.damage).toBeGreaterThan(0);
          // The price of staying and the ways out, pinned on the record.
          expect(record?.damage).toEqual({ dice: '3d6', damageType: 'acid', each: 'start-of-turn' });
          expect(record?.escape).toEqual({ ability: 'str', skill: 'athletics', dc: 12 });
          expect(record?.pullOut).toMatchObject({ within: 5, ability: 'str', skill: 'athletics', dc: 12 });
          expect(record?.returns).toEqual({ within: 5, near: CUBE });
        } else {
          sawSuccess = true;
          // Half damage, and out of the cube's way to the stated space.
          expect(record).toBeNull();
          const at = positionOf(state.scene!, who);
          expect(at).not.toBeNull();
          expect(at).not.toEqual(who === ONE ? p(20, 50) : p(20, 55));
          expect(distanceBetween(state.scene!, who, CUBE)).toEqual({ ok: true, value: 5 });
          expect(hasCondition(state.creatures[who]!.conditions, 'restrained')).toBe(false);
        }
      }
    }
    expect(sawFailure).toBe(true);
    expect(sawSuccess).toBe(true);
  });

  it('is refused by the other door, which rolls over a head count', () => {
    const table = cellar('cellar-door');
    const refused = forcePrintedSave(table.state, CUBE, { line: ENGULF, targets: [ONE] }, table.supply());
    expect(isErr(refused) && refused.code === 'line_moves_first').toBe(true);
  });

  it("charges the engulfed creature 3d6 Acid at the start of the cube's turn, and moves it with the cube", () => {
    const table = aCellarWhereOneIsEngulfed();
    const before = table.state.creatures[ONE]!.vitals.hp;
    // Round the table: the cube's turn ends, everybody else's passes, and the
    // cube's next turn begins with the commoner still inside.
    for (const step of ['cube', 'one', 'two', 'cleric', 'three', 'four', 'five']) {
      table.did(`${step}'s turn ends`, (s) => resolveTurn(s, table.supply(), { commandId: `end ${step}` }));
    }
    const state = table.state;
    expect(elsewhereOf(state, ONE)?.host).toBe(CUBE);
    expect(state.creatures[ONE]!.vitals.hp).toBeLessThan(before);
    expect(table.log.some((event) => event.type === 'damage-taken' && event.id === ONE && event.source?.includes(CUBE) === true)).toBe(true);
    // The cube walks on; the commoner is still inside it and still has no position.
    expect(positionOf(state.scene!, ONE)).toBeNull();
  });

  it('lets the engulfed creature spend an action on a DC 12 Athletics check, and steps out on a success', () => {
    let sawSuccess = false;
    let sawFailure = false;
    for (const seed of SEEDS.slice(0, 10)) {
      const table = aCellarWhereOneIsEngulfed(SEEDS.indexOf(seed));
      table.did("the cube's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end cube' }));
      const state = table.state;
      // Nine spaces qualify around a Large cube, so the way out is named.
      const asked = escapeFromInside(state, ONE, { commandId: `ask ${seed}` }, table.supply());
      expect(isNeedsContext(asked) && isErr(asked) && asked.code === 'return_space_required').toBe(true);
      const out = unwrap(
        escapeFromInside(state, ONE, { to: NORTH_OF_THE_CUBE, commandId: `escape ${seed}` }, table.supply()),
        'the escape',
      );
      table.log.push(...out.events);
      const after = table.state;
      // An action either way.
      expect(after.combat!.budgets[ONE]!.action).toBe(false);
      if (out.success) {
        sawSuccess = true;
        expect(elsewhereOf(after, ONE)).toBeNull();
        expect(positionOf(after.scene!, ONE)).not.toBeNull();
        expect(distanceBetween(after.scene!, ONE, CUBE)).toEqual({ ok: true, value: 5 });
        expect(hasCondition(after.creatures[ONE]!.conditions, 'restrained')).toBe(false);
        expect(silencedBy(after, ONE)).toBeNull();
      } else {
        sawFailure = true;
        expect(elsewhereOf(after, ONE)?.host).toBe(CUBE);
      }
      if (sawSuccess && sawFailure) break;
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  it('refuses the escape to a creature that is not inside anything, and to one whose line offers no check', () => {
    const table = cellar('cellar-free');
    table.did("the cube's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end cube' }));
    const refused = escapeFromInside(table.state, ONE, {}, table.supply());
    expect(isErr(refused) && refused.code === 'not_inside').toBe(true);
    // A swallow pins no escape: the frog's line offers none, and the way out
    // is the frog's disgorging or its death.
    table.log.push({
      type: 'creature-sent-elsewhere',
      id: ONE,
      kind: 'inside',
      host: CUBE,
      source: 'line:cube/Swallow',
      returns: { within: 5, near: CUBE },
    });
    const noCheck = escapeFromInside(table.state, ONE, { to: NORTH_OF_THE_CUBE }, table.supply());
    expect(isErr(noCheck) && noCheck.code === 'no_escape_from_inside').toBe(true);
    // And nobody may pull it out either, for the same reason.
    table.did("one's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end one' }));
    table.did("two's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end two' }));
    const noPull = pullOutOfCreature(table.state, CLERIC, { host: CUBE, target: ONE, to: NORTH_OF_THE_CUBE }, table.supply());
    expect(isErr(noPull) && noPull.code === 'no_pull_out').toBe(true);
  });

  it('lets a neighbour within 5 feet pull the engulfed creature out on a DC 12 Athletics check, taking 3d6 Acid for it', () => {
    let sawSuccess = false;
    let sawFailure = false;
    for (const seed of SEEDS.slice(0, 10)) {
      const table = aCellarWhereOneIsEngulfed(SEEDS.indexOf(seed));
      for (const step of ['cube', 'one', 'two']) {
        table.did(`${step}'s turn ends`, (s) => resolveTurn(s, table.supply(), { commandId: `end ${step}` }));
      }
      const state = table.state;
      const clericHp = state.creatures[CLERIC]!.vitals.hp;
      const out = unwrap(
        pullOutOfCreature(
          state,
          CLERIC,
          { host: CUBE, target: ONE, to: NORTH_OF_THE_CUBE, commandId: `pull ${seed}` },
          table.supply(),
        ),
        'the pull',
      );
      table.log.push(...out.events);
      const after = table.state;
      expect(after.combat!.budgets[CLERIC]!.action).toBe(false);
      if (out.success) {
        sawSuccess = true;
        expect(elsewhereOf(after, ONE)).toBeNull();
        expect(positionOf(after.scene!, ONE)).not.toBeNull();
        expect(distanceBetween(after.scene!, ONE, CUBE)).toEqual({ ok: true, value: 5 });
        // "and the puller takes 10 (3d6) Acid damage"
        expect(after.creatures[CLERIC]!.vitals.hp).toBeLessThan(clericHp);
      } else {
        sawFailure = true;
        expect(elsewhereOf(after, ONE)?.host).toBe(CUBE);
        expect(after.creatures[CLERIC]!.vitals.hp).toBe(clericHp);
      }
      if (sawSuccess && sawFailure) break;
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  it('refuses the pull from too far away, for a creature that is not inside, and asks whom where several are', () => {
    const table = aCellarWhereOneIsEngulfed();
    for (const step of ['cube', 'one', 'two', 'cleric']) {
      table.did(`${step}'s turn ends`, (s) => resolveTurn(s, table.supply(), { commandId: `end ${step}` }));
    }
    // THREE stands thirty feet north of the cube, out of reach.
    const far = pullOutOfCreature(table.state, THREE, { host: CUBE, target: ONE }, table.supply());
    expect(isErr(far) && far.code === 'out_of_reach').toBe(true);
    const notInside = pullOutOfCreature(table.state, THREE, { host: CUBE, target: TWO }, table.supply());
    expect(isErr(notInside) && notInside.code === 'not_inside').toBe(true);
    // A second creature inside, hand-sent, and the puller names nobody.
    table.log.push({
      type: 'creature-sent-elsewhere',
      id: FOUR,
      kind: 'inside',
      host: CUBE,
      source: 'line:cube/Engulf',
      returns: { within: 5, near: CUBE },
      pullOut: { within: 5, ability: 'str', skill: 'athletics', dc: 12 },
    });
    table.log.push({ type: 'creature-moved', id: THREE, placement: { from: { point: p(20, 50) }, feet: 0, bearing: 0 }, forced: true });
    const whom = pullOutOfCreature(table.state, THREE, { host: CUBE }, table.supply());
    expect(isNeedsContext(whom) && isErr(whom) && whom.code === 'undeclared_pull_target').toBe(true);
  });

  it('refuses to walk through a fifth Medium creature when four are already inside', () => {
    const table = cellar('cellar-full');
    for (const who of [THREE, FOUR, FIVE, CLERIC]) {
      table.log.push({
        type: 'creature-sent-elsewhere',
        id: who,
        kind: 'inside',
        host: CUBE,
        source: 'line:cube/Engulf',
        returns: { within: 5, near: CUBE },
      });
    }
    expect(heldInside(table.state, CUBE)).toHaveLength(4);
    const refused = takePrintedMove(table.state, CUBE, { line: ENGULF, route: THROUGH_BOTH }, table.supply());
    expect(isErr(refused) && refused.code === 'no_room_inside').toBe(true);
    // Nothing moved and nothing was spent.
    expect(positionOf(table.state.scene!, CUBE)).toEqual(p(10, 50));
    expect(table.state.combat!.budgets[CUBE]!.action).toBe(true);
  });

  it("frees everyone inside when the cube dies: the Restrained lifts and the way out opens", () => {
    const table = aCellarWhereOneIsEngulfed();
    table.do('the cube dies', (s) => damageCreature(s, CUBE, { amount: 500, source: 'a boulder' }));
    const state = table.state;
    expect(state.creatures[CUBE]!.vitals.dead).toBe(true);
    expect(hasCondition(state.creatures[ONE]!.conditions, 'restrained')).toBe(false);
    const out = unwrap(returnFromElsewhere(state, ONE, { to: NORTH_OF_THE_CUBE }), 'climbing out');
    table.log.push(...out.events);
    expect(elsewhereOf(table.state, ONE)).toBeNull();
    expect(positionOf(table.state.scene!, ONE)).not.toBeNull();
  });
});

/** A space five feet east of the mound's box, which spans (50..55, 50..55). */
const EAST_OF_THE_MOUND = { from: { point: p(60, 50) }, feet: 0, bearing: 0 };

/**
 * The mound beside two bandit captains (the brief's goblins, with the Hit
 * Points to survive 3d6 Lightning and escape afterwards), the mound's turn
 * first.
 */
function bog(seed: string): Table {
  const table = new Table(seed);
  table.did('the mound arrives', (s) => addCreature(s, SRD_CONTENT, MOUND, 'shambling-mound'));
  table.did('a bandit arrives', (s) => addCreature(s, SRD_CONTENT, GOBLIN, 'bandit-captain'));
  table.did('another arrives', (s) => addCreature(s, SRD_CONTENT, SECOND, 'bandit-captain'));
  table.do('the bog', (s) => setScene(s, { width: 100, depth: 100, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 50, y: 50, z: 0 }));
  table.do('the mound stands', (s) => placeCreatureInScene(s, MOUND, { from: { landmark: 'the stump' }, feet: 0 }));
  table.do('the bandit stands', (s) => placeCreatureInScene(s, GOBLIN, EAST_OF_THE_MOUND));
  table.do('the second stands', (s) => placeCreatureInScene(s, SECOND, { from: { point: p(50, 60) }, feet: 0, bearing: 0 }));
  table.do("the mound's side", (s) => declareCreatureSide(s, MOUND, 'wild'));
  for (const who of [GOBLIN, SECOND]) table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: MOUND, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 15, speed: 30 },
      { id: SECOND, initiative: 10, speed: 30 },
    ]),
  );
  return table;
}

/** A bog in which the goblin failed the mound's save, found rather than guessed. */
function aBogWhereTheGoblinIsHeld(): Table {
  for (const seed of SEEDS) {
    const table = bog(seed);
    const out = unwrap(forcePrintedSave(table.state, MOUND, { line: ENGULF, targets: [GOBLIN] }, table.supply()), 'the engulf');
    table.log.push(...out.events);
    if (out.outcomes[0]?.save?.success === false) return table;
  }
  throw new Error('no seed held the goblin');
}

/**
 * SRD Ooze Cube: "the cube can hold one Large creature or up to four Medium or
 * Small creatures inside itself at a time" — the "or" exclusive, and Large the
 * most it takes.
 */
describe('the room a hold has', () => {
  const cube = { large: 1, mediumOrSmaller: 4 } as const;
  it('takes one Large creature into an empty hold, and nothing bigger', () => {
    expect(roomInside(cube, [], 'large')).toBe(true);
    expect(roomInside(cube, [], 'huge')).toBe(false);
    expect(roomInside(cube, [], 'gargantuan')).toBe(false);
    expect(roomInside(cube, ['small'], 'large')).toBe(false);
  });
  it('takes four smaller creatures, and none beside a Large one', () => {
    expect(roomInside(cube, ['medium', 'small', 'medium'], 'tiny')).toBe(true);
    expect(roomInside(cube, ['medium', 'small', 'medium', 'medium'], 'small')).toBe(false);
    expect(roomInside(cube, ['large'], 'small')).toBe(false);
    expect(roomInside({ creatures: 1 }, [], 'gargantuan')).toBe(true);
    expect(roomInside({ creatures: 1 }, ['medium'], 'tiny')).toBe(false);
  });
});

describe("a Shambling Mound's Engulf", () => {
  it('grapples the goblin into its space, Blinded and Restrained, with 3d6 Lightning at the start of the goblin’s turns', () => {
    const table = aBogWhereTheGoblinIsHeld();
    const state = table.state;
    expect(grapplesOn(state, GOBLIN).map((held) => held.grappler)).toEqual([MOUND]);
    for (const condition of ['grappled', 'blinded', 'restrained'] as const) {
      expect(hasCondition(state.creatures[GOBLIN]!.conditions, condition)).toBe(true);
    }
    const record = elsewhereOf(state, GOBLIN);
    expect(record?.kind).toBe('inside');
    expect(record?.host).toBe(MOUND);
    expect(positionOf(state.scene!, GOBLIN)).toBeNull();
    // No damage on the failure itself: the line prints none.
    const before = state.creatures[GOBLIN]!.vitals.hp;
    expect(before).toBe(state.creatures[GOBLIN]!.vitals.hpMax);
    // The goblin's own turn begins, and the hold collects.
    table.did("the mound's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end mound' }));
    expect(table.state.creatures[GOBLIN]!.vitals.hp).toBeLessThan(before);
  });

  it('moves with the bandit inside it at no extra cost', () => {
    // "When the shambling mound moves, the Grappled target moves with it,
    // costing it no extra movement." A Medium bandit is one size under a
    // Large mound, so SRD Grappled's drag would charge it — and this does not.
    const table = aBogWhereTheGoblinIsHeld();
    const walked = unwrap(
      resolveMove(table.state, MOUND, { placement: { from: { creature: MOUND }, feet: 10, bearing: 270 }, commandId: 'wade' }, table.supply()),
      'the mound wades off',
    );
    expect(walked.cost).toBe(10);
    table.log.push(...walked.events);
    expect(elsewhereOf(table.state, GOBLIN)?.host).toBe(MOUND);
    expect(grapplesOn(table.state, GOBLIN).map((held) => held.grappler)).toEqual([MOUND]);
  });

  it('refuses a second target while it holds one, and lets the goblin out when the grapple ends', () => {
    const table = aBogWhereTheGoblinIsHeld();
    for (const step of ['mound', 'goblin', 'second']) {
      table.did(`${step}'s turn ends`, (s) => resolveTurn(s, table.supply(), { commandId: `end ${step}` }));
    }
    const refused = forcePrintedSave(table.state, MOUND, { line: ENGULF, targets: [SECOND] }, table.supply());
    expect(isErr(refused) && refused.code === 'holding_enough').toBe(true);
    // The way out is closed while the hold stands.
    const shut = returnFromElsewhere(table.state, GOBLIN, { to: EAST_OF_THE_MOUND });
    expect(isErr(shut) && shut.code === 'no_way_back').toBe(true);

    // The goblin's turn: an escape, tried until one succeeds.
    table.did("the mound's turn ends", (s) => resolveTurn(s, table.supply(), { commandId: 'end mound again' }));
    let freed = false;
    for (let attempt = 0; attempt < 12 && !freed; attempt += 1) {
      const out = unwrap(escapeGrapple(table.state, GOBLIN, { ability: 'str', commandId: `escape ${attempt}` }, table.supply()), 'the escape');
      if (out.success) {
        table.log.push(...out.events);
        freed = true;
        // Free and still inside, and told which door steps it out.
        expect(out.unverified.join(' ')).toContain('returnFromElsewhere');
      }
    }
    expect(freed).toBe(true);
    const state = table.state;
    expect(grapplesOn(state, GOBLIN)).toEqual([]);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'restrained')).toBe(false);
    // Still inside the mound's space until it climbs out, and the way is open now.
    expect(elsewhereOf(state, GOBLIN)?.host).toBe(MOUND);
    const out = unwrap(returnFromElsewhere(state, GOBLIN, { to: EAST_OF_THE_MOUND }), 'climbing out');
    table.log.push(...out.events);
    expect(elsewhereOf(table.state, GOBLIN)).toBeNull();
    expect(positionOf(table.state.scene!, GOBLIN)).not.toBeNull();
  });
});
