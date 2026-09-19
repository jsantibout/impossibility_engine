import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { areaPointAt, type Point, type TerrainRegion } from './positioning.js';
import { movementLeftFor } from './standing.js';
import {
  declareDifficultTerrain,
  releaseReady,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeReady,
  type MoveResolution,
} from './commands.js';

/**
 * Two questions a move can ask about the spaces it crossed, and why a caller
 * has to be able to tell them apart.
 *
 * A move records where it began and where it ended. Two different rules want
 * to know what happened in between, and they want *different things done about
 * it*:
 *
 * | | What it wants | What answers it |
 * |---|---|---|
 * | Difficult Terrain that disagrees with itself | which spaces were crossed, so the cost can be read off them | the **same command again** with `route` filled in |
 * | a carried area that catches what it moves over | each space **settled** before the next is entered | **several commands**, one 5-foot step each |
 *
 * The second cannot be collapsed into the first, and the reason is a rule
 * rather than an implementation: a creature that fails its save against the
 * Web it walked into is Restrained, and a Restrained creature's walk stops
 * there. An engine that took a whole route in one command would have to decide
 * the rest of the walk before knowing whether it happened.
 *
 * So the remedies differ, and a caller that cannot tell which it was told
 * loops: it reads "route", fills in `route`, and gets the same refusal back
 * forever. That is what these tests are about. They branch on the **code**,
 * which is the value a tool surface reads, and never on the English of the
 * reason.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const WALKER = id('walker');
const FOE = id('foe');

/** The code that means: send this same command again, with `route` filled in. */
const FILL_IN_ROUTE = 'route_required';
/** The code that means: send this again as several moves of one space each. */
const SEND_SINGLE_STEPS = 'single_steps_required';

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 12, dex: 14, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  // Sixty, so a twenty-five-foot walk can cost forty and still be affordable:
  // these tests are about which question is asked, not about the budget.
  baseSpeed: 60,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

/** Each walker gets their own lane, so one patch of ground is one test's. */
const LANE = { cleric: 100, walker: 200, foe: 300 } as const;

const at = (x: number, lane: number): Point => ({ x, y: lane, z: 0 });

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 120,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const place = (who: CharacterId, point: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC, 'party'),
  added(WALKER, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['spirit-guardians'] }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  place(CLERIC, at(100, LANE.cleric)),
  place(WALKER, at(100, LANE.walker)),
  place(FOE, at(100, LANE.foe)),
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 30, speed: 60 },
      { id: WALKER, initiative: 20, speed: 60 },
      { id: FOE, initiative: 10, speed: 60 },
    ],
  },
];

const supply = (seed = 'routes') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A patch shaped like a Sphere, which on the lattice is a Chebyshev ball. */
const ball = (centre: Point, radius: number): TerrainRegion => ({
  origin: areaPointAt(centre),
  shape: { kind: 'sphere', radius },
});

/**
 * Three spaces of mire in the middle of a lane, which is the whole point.
 *
 * A patch that covers everything charges every route the same and is answered
 * without asking; a patch that covers three of the five spaces between the
 * endpoints is ground that disagrees with itself, and what it costs depends on
 * which spaces were crossed.
 */
const mire = (lane: number): TerrainRegion => ball(at(115, lane), 5);

const declare = (
  log: readonly GameEvent[],
  patch: string,
  region: TerrainRegion,
): readonly GameEvent[] => [
  ...log,
  ...unwrap(declareDifficultTerrain(fold('seed', log), patch, { region }), patch),
];

/** The spaces of a straight eastward walk down a lane, which is what a route is. */
const eastwards = (lane: number, from: number, to: number): readonly Point[] => {
  const spaces: Point[] = [];
  for (let x = from + 5; x <= to; x += 5) spaces.push(at(x, lane));
  return spaces;
};

const walkTo = (
  log: readonly GameEvent[],
  who: CharacterId,
  point: Point,
  extra: { readonly route?: readonly Point[] } = {},
): Result<MoveResolution> =>
  resolveMove(
    fold('seed', log),
    who,
    { placement: { from: { point }, feet: 0 }, ...extra },
    supply('walk'),
  );

const codeOf = (out: Result<unknown>): string => (isErr(out) ? out.code : 'not asked');

/** Advance until it is this creature's turn. */
const turnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let events = [...log];
  for (let n = 0; n < 6; n += 1) {
    const state: GameState = fold('seed', events);
    if (state.combat?.order[state.combat.turnIndex]?.id === who) return events;
    events = [...events, ...unwrap(resolveTurn(state, supply(`turn-${n}`)), 'turn').events];
  }
  throw new Error(`never reached ${who}'s turn`);
};

/** The cleric, carrying an Emanation that catches whatever it is walked onto. */
const carrying = (log: readonly GameEvent[]): readonly GameEvent[] => {
  const out = unwrap(
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId: 'spirit-guardians', targets: [], damageType: 'radiant' },
      supply('guardians'),
    ),
    'casting Spirit Guardians',
  );
  return [...log, ...out.events];
};

/** The mire in the walker's lane, on the walker's own turn. */
const MIRED_WALKER = turnOf(declare(SETUP, 'the mire', mire(LANE.walker)), WALKER);
/** The same ground in the cleric's lane, with nothing carried over it. */
const MIRED_CLERIC = declare(SETUP, 'the mire', mire(LANE.cleric));
/** And with an Emanation the cleric carries across it. */
const CARRIED = declare(carrying(SETUP), 'the mire', mire(LANE.cleric));

// — the ground's question, and that answering it ends the conversation ————————

describe('ground that disagrees with itself asks once and is satisfied', () => {
  const END = at(125, LANE.walker);

  it('asks rather than refusing, under the code that names the field', () => {
    const out = walkTo(MIRED_WALKER, WALKER, END);
    expect(isNeedsContext(out)).toBe(true);
    expect(codeOf(out)).toBe(FILL_IN_ROUTE);
  });

  /**
   * **The loop, shown closed.** The caller reads `satisfyWith`, sends the same
   * command again with that one field filled in, and the move resolves. Three
   * of the five spaces are mire, so the cost is 5 + 10 + 10 + 10 + 5 — a
   * number neither endpoint could have produced.
   */
  it('resolves when the caller supplies exactly what it asked for', () => {
    const asked = walkTo(MIRED_WALKER, WALKER, END);
    const request = contextRequestsOf(asked)[0];
    expect(request?.kind).toBe('route');
    expect(request?.satisfyWith).toContain('route');

    const out = unwrap(
      walkTo(MIRED_WALKER, WALKER, END, { route: eastwards(LANE.walker, 100, 125) }),
      'second try',
    );
    expect(out.feet).toBe(25);
    expect(out.cost).toBe(40);
    expect(out.terrain).toEqual(['the mire']);
  });
});

// — the carried area's question, which a route does not answer —————————————————

describe('a carried area and expensive ground ask different questions', () => {
  const END = at(125, LANE.cleric);

  /**
   * Both refusals are homework rather than verdicts, which was never the bug.
   * The bug is that homework a caller cannot tell apart is homework it cannot
   * do.
   */
  it('both ask rather than refuse', () => {
    expect(isNeedsContext(walkTo(CARRIED, CLERIC, END))).toBe(true);
    expect(isNeedsContext(walkTo(MIRED_WALKER, WALKER, at(125, LANE.walker)))).toBe(true);
  });

  /**
   * **The two are told apart by a value, not by reading English.** A caller
   * that branches on the code learns which of the two remedies it was handed;
   * one that branches on `needs-context` alone, or on the request's `kind`,
   * learns only that something about the route is missing.
   */
  it('carries a different code for the carried area than for the ground', () => {
    const carried = walkTo(CARRIED, CLERIC, END);
    const ground = walkTo(MIRED_WALKER, WALKER, at(125, LANE.walker));
    expect(codeOf(carried)).toBe(SEND_SINGLE_STEPS);
    expect(codeOf(ground)).toBe(FILL_IN_ROUTE);
    expect(codeOf(carried)).not.toBe(codeOf(ground));
  });

  /**
   * **And the codes are not decoration: the remedies really are different.**
   * A route stated in one command does not satisfy the carried area, because
   * what the area owes has to be settled space by space — so a caller that
   * read the wrong code and filled in `route` gets the same question back, and
   * would loop forever if the two questions looked alike.
   */
  it('does not accept a route as an answer to the carried area', () => {
    const out = walkTo(CARRIED, CLERIC, END, { route: eastwards(LANE.cleric, 100, 125) });
    expect(codeOf(out)).toBe(SEND_SINGLE_STEPS);
  });

  /** What does answer it: the same walk, one space at a time. */
  it('resolves as single steps, charging each space what it costs', () => {
    let log = CARRIED;
    let spent = 0;
    for (let x = 105; x <= 125; x += 5) {
      const step = unwrap(walkTo(log, CLERIC, at(x, LANE.cleric)), `step to ${x}`);
      spent += step.cost;
      log = [...log, ...step.events];
    }
    expect(spent).toBe(40);
    expect(movementLeftFor(fold('seed', log), CLERIC)).toBe(20);
  });

  /** The ground's question is still asked once the aura is not in the way. */
  it('asks the ground’s question of a mover carrying nothing', () => {
    const out = walkTo(MIRED_CLERIC, CLERIC, END);
    expect(codeOf(out)).toBe(FILL_IN_ROUTE);
  });
});

// — a readied move is a move, and crosses the same ground ————————————————————

describe('a readied move may state the route it took', () => {
  const TRIGGER = 'if the foe crosses the ditch';
  const END = at(125, LANE.walker);

  /** Ready a move on the walker's turn, then hand the turn to the foe. */
  const held = (): readonly GameEvent[] => {
    const mired = turnOf(declare(SETUP, 'the ditch', mire(LANE.walker)), WALKER);
    const ready = unwrap(
      takeReady(fold('seed', mired), WALKER, { trigger: TRIGGER, response: { kind: 'move' } }, SRD_CONTENT),
      'readying a move',
    );
    return turnOf([...mired, ...ready], FOE);
  };

  const release = (extra: Record<string, unknown> = {}) =>
    releaseReady(
      fold('seed', held()),
      WALKER,
      { placement: { from: { point: END }, feet: 0 }, ...extra },
      supply('release'),
    );

  /**
   * SRD Ready: "you choose to move up to your Speed in response to it." That
   * is the creature's own movement, so Difficult Terrain charges it — and
   * ground that disagrees with itself asks the readied move the same question
   * it asks any other.
   */
  it('is asked the ground’s question like any other move', () => {
    const out = release();
    expect(isNeedsContext(out)).toBe(true);
    expect(codeOf(out)).toBe(FILL_IN_ROUTE);
  });

  /**
   * **And can answer it.** The release command carried `difficultFeet` and no
   * `route`, so the one question a readied move could be asked was the one
   * question it had no field to answer with: the caller was told to re-send
   * the command with a field the command did not have.
   */
  it('resolves when the release carries the route, charged for the ground it crossed', () => {
    const out = unwrap(release({ route: eastwards(LANE.walker, 100, 125) }), 'released');
    expect(out.move?.feet).toBe(25);
    expect(out.move?.cost).toBe(40);
    expect(out.move?.terrain).toEqual(['the ditch']);
  });

  /** Nothing is spent by the question: the Reaction and the hold both survive. */
  it('spends nothing while it waits for the route', () => {
    const log = held();
    expect(isErr(release())).toBe(true);
    const state = fold('seed', log);
    expect(state.combat?.budgets.walker?.reaction).toBe(true);
  });
});
