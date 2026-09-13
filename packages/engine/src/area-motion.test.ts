import { describe, expect, it } from 'vitest';
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
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import { areaStampKey, type AreaMoment } from './spells.js';
import { commandOutcome } from './idempotency.js';
import {
  activateSpell,
  endConcentration,
  ongoingSpellOf,
  owedAreaEffectsOf,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  type SpellResolution,
} from './commands.js';

/**
 * An area that moves onto a creature standing still.
 *
 * SRD Moonbeam writes three trigger clauses in one sentence and the first of
 * them is not the other two:
 *
 * > "A creature also makes this save **when the spell's area moves into its
 * > space** and when it enters the spell's area or ends its turn there. A
 * > creature makes this save only once per turn."
 *
 * | | SRD wording | The authoritative operation |
 * |---|---|---|
 * | **F1** | "ends its turn there" | `turn-advanced` |
 * | **F2a** | "enters the spell's area" | the creature's own position change |
 * | **F2b** | "the spell's area moves into its space" | the **area's** position change |
 *
 * The third is this file. Nobody moved: the beam arrived. An engine that
 * detected "membership changed somehow" would pass every test here and would
 * have erased the distinction the book drew — which matters because the two
 * clauses can be capped differently, and because "you walked into the beam"
 * and "the beam swept over you" are different answers to why a creature is
 * hurt.
 *
 * **The save happens when the area moves into the space**, which is a point
 * *inside* the route rather than after it. That is not a nicety: a beam walked
 * onto its own concentrating caster can end the spell halfway along, and the
 * waypoints after that must never happen.
 *
 * Cloudkill, Incendiary Cloud and Spirit Guardians print the same clause about
 * their own areas and are **not** implemented here: their areas move for
 * different reasons, by different causes, at different moments. What this
 * proves is the consequence they will all eventually share.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const RIVAL = id('rival');
/** Stands out by the east wall, where a short move still leaves the room. */
const WARDEN = id('warden');
/** Stands in the beam from the moment it is conjured. */
const INSIDE = id('inside');
/** Stands between where the beam starts and where it ends up. */
const BYSTANDER = id('bystander');
/** Stands still, east of the beam, until the beam comes to them. */
const STILL = id('still');
/** Walks into a beam that has not moved — the F2a control. */
const STEPPER = id('stepper');
/** Stands beyond the druid, reachable only by the last leg of a sweep. */
const LATER = id('later');

const PREPARED = ['moonbeam', 'web', 'insect-plague', 'grease', 'spiritual-weapon'];

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

/** Hit points large enough that nothing here dies of a save it failed. */
const MAX_HP = 400;

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: MAX_HP,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID || who === RIVAL || who === WARDEN ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/**
 * Saves that land where the test wants them.
 *
 * The default penalty fails every save, so a trigger that fired is a trigger
 * that shows — and, when the beam catches its own caster, the Concentration
 * save fails too and the spell ends mid-route, which is the case this file
 * exists for. A test that needs the casting to survive passes the bonus the
 * other way: half damage on a made save is still damage.
 */
const supply = (seed = 'beam', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'the fixture', flat }],
});

/**
 * The lane the beam walks down, worked out against the engine's own ruler.
 *
 * Moonbeam is a **5-foot-radius** Cylinder, which on this lattice is the
 * origin cube and one ring: a beam centred on x = 300 covers x ∈ {295, 300,
 * 305} and nothing else. Every coordinate below is chosen so that exactly one
 * membership question is being asked:
 *
 * | | x | In the beam at 300? | At 305? | At 315? | At 320? |
 * |---|---|---|---|---|---|
 * | `INSIDE` | 300 | yes | yes | no | no |
 * | `BYSTANDER` | 310 | no | **yes** | yes | no |
 * | `STILL` | 320 | no | no | **yes** | yes |
 *
 * So the four-step sweep 300 → 305 → 310 → 315 → 320 catches `BYSTANDER` on
 * its first leg and `STILL` on its third, and a single twenty-foot step from
 * 300 to 320 would pass over both while leaving one of them outside at each
 * end — which is why a step that long is a question rather than a move.
 */
const LANE = 300;
const DRUID_AT: Point = { x: 200, y: LANE, z: 0 };
const BEAM: Point = { x: 300, y: LANE, z: 0 };
const BEAM_STEP: Point = { x: 305, y: LANE, z: 0 };
const BEAM_MID: Point = { x: 310, y: LANE, z: 0 };
const BEAM_NEAR: Point = { x: 315, y: LANE, z: 0 };
const BEAM_EAST: Point = { x: 320, y: LANE, z: 0 };

/** The waypoints of the four adjacent steps from `BEAM` to `BEAM_EAST`. */
const SWEEP_EAST: readonly Point[] = [BEAM_STEP, BEAM_MID, BEAM_NEAR];

/**
 * The same destination by a route that keeps off `BYSTANDER`.
 *
 * Eight adjacent steps: south, east along the next lane, then north again.
 * Legal, longer, and it catches a different set — which is the whole point.
 * The route is a fact, and two different facts give two different answers.
 */
const SWEEP_AROUND: readonly Point[] = [
  { x: 300, y: LANE - 5, z: 0 },
  { x: 300, y: LANE - 10, z: 0 },
  { x: 305, y: LANE - 10, z: 0 },
  { x: 310, y: LANE - 10, z: 0 },
  { x: 315, y: LANE - 10, z: 0 },
  { x: 320, y: LANE - 10, z: 0 },
  { x: 320, y: LANE - 5, z: 0 },
];

/** Sixty feet from the beam and a hundred and sixty from the caster. */
const BEAM_FAR: Point = { x: 360, y: LANE, z: 0 };
/** A hundred feet from the beam: inside Moonbeam's Range, outside its move. */
const BEAM_TOO_FAR: Point = { x: 400, y: LANE, z: 0 };

/** Out by the east wall, where a legal-length move still leaves the room. */
const RIVAL_AT: Point = { x: 250, y: LANE + 40, z: 0 };
const WARDEN_AT: Point = { x: 800, y: LANE, z: 0 };
const EDGE_BEAM: Point = { x: 880, y: LANE, z: 0 };
const PAST_THE_WALL: Point = { x: 920, y: LANE, z: 0 };

/**
 * The sweep that walks a beam onto its own caster, and would go on past them.
 *
 * Conjured fifteen feet east of the druid and walked west in adjacent steps.
 * The second leg puts the druid inside; the fourth would put `LATER` inside,
 * and is the leg that must never happen once the druid's Concentration goes.
 */
const SELF_BEAM: Point = { x: 215, y: LANE, z: 0 };
const SELF_SWEEP: readonly Point[] = [
  { x: 210, y: LANE, z: 0 },
  { x: 205, y: LANE, z: 0 }, // the druid, at x = 200, is now inside
  { x: 200, y: LANE, z: 0 },
];
const SELF_END: Point = { x: 195, y: LANE, z: 0 }; // …and `LATER`, at 190, with it
const LATER_AT: Point = { x: 190, y: LANE, z: 0 };

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(RIVAL),
  added(WARDEN),
  added(INSIDE),
  added(BYSTANDER),
  added(STILL),
  added(STEPPER),
  added(LATER),
  ...casts(DRUID),
  ...casts(RIVAL),
  ...casts(WARDEN),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(DRUID, DRUID_AT),
  place(RIVAL, RIVAL_AT),
  place(WARDEN, WARDEN_AT),
  place(INSIDE, BEAM),
  place(BYSTANDER, BEAM_MID),
  place(STILL, BEAM_EAST),
  place(STEPPER, { x: 400, y: LANE, z: 0 }),
  place(LATER, LATER_AT),
];

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 30, speed: 30 },
      { id: STEPPER, initiative: 20, speed: 400 },
      { id: STILL, initiative: 10, speed: 30 },
      { id: INSIDE, initiative: 5, speed: 30 },
    ],
  },
];

class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  fight(): this {
    if (this.state.combat === null) this.push(FIGHT);
    return this;
  }

  /** Conjure a persistent area at a point, and hand back the casting id. */
  conjure(
    spellId: string,
    at: Point,
    options: { readonly by?: CharacterId; readonly towards?: Point; readonly seed?: string } = {},
  ): string {
    const by = options.by ?? DRUID;
    const out = unwrap(
      resolveSpell(
        this.state,
        by,
        {
          spellId,
          targets: [],
          at,
          ...(options.towards === undefined ? {} : { towards: options.towards }),
        },
        supply(options.seed ?? spellId),
      ),
      `${by} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId;
  }

  /** Take the Magic action that moves the beam, without keeping the result. */
  moveArea(
    castingId: string,
    to: Point,
    options: {
      readonly by?: CharacterId;
      readonly via?: readonly Point[];
      readonly commandId?: string;
      readonly seed?: string;
      readonly flat?: number;
      readonly targets?: readonly CharacterId[];
    } = {},
  ): Result<SpellResolution> {
    return activateSpell(
      this.state,
      options.by ?? DRUID,
      {
        castingId,
        targets: options.targets ?? [],
        to,
        ...(options.via === undefined ? {} : { via: options.via }),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply(options.seed ?? 'move', options.flat ?? -40),
    );
  }

  /** …and keep what it produced. */
  beamTo(castingId: string, to: Point, options: Parameters<Game['moveArea']>[2] = {}) {
    const out = unwrap(this.moveArea(castingId, to, options), 'moving the beam');
    this.push(out.events);
    return out;
  }

  to(who: CharacterId): this {
    this.fight();
    for (let n = 0; n < 12; n += 1) {
      const combat = this.state.combat;
      if (combat === null) return this;
      if (combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(`to-${who}-${n}`);
    }
    throw new Error(`never reached ${who}'s turn`);
  }

  walk(who: CharacterId, to: Point): void {
    this.to(who);
    const out = unwrap(
      resolveMove(this.state, who, { placement: { from: { point: to }, feet: 0 } }, supply('walk')),
      `${who} walking`,
    );
    this.push(out.events);
  }

  turn(seed = 'turn', flat = -40): readonly GameEvent[] {
    this.fight();
    const out = unwrap(resolveTurn(this.state, supply(seed, flat)), 'advancing the turn');
    this.push(out.events);
    return out.events;
  }

  owed(): readonly { readonly target: string; readonly moment: AreaMoment }[] {
    return owedAreaEffectsOf(this.state);
  }

  originOf(castingId: string): Point | undefined {
    return ongoingSpellOf(this.state, castingId)?.origin;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

/** Who a batch of events says an area arrived on, in the order it reached them. */
const caughtIn = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((e) =>
    e.type === 'area-effect-settled' && e.moment === 'area-moved' ? [e.target] : [],
  );

/** Where a batch of events says the area went, in order. */
const legsIn = (events: readonly GameEvent[]): readonly Point[] =>
  events.flatMap((e) => (e.type === 'spell-origin-moved' ? [e.to] : []));

/** A game with the beam already up, on the druid's turn. */
const withBeam = (): { readonly game: Game; readonly beam: string } => {
  const game = new Game();
  const beam = game.conjure('moonbeam', BEAM);
  game.fight().to(DRUID);
  return { game, beam };
};

// — the clause is the spell's, not the mechanism's ————————————————————————————

describe('only a spell whose area the rules move has an area-entry clause', () => {
  const triggered = SPELL_DEFINITIONS.filter((d) => d.areaTrigger !== undefined);

  it('gives moonbeam the clause the book prints', () => {
    const moonbeam = SPELL_DEFINITIONS.find((d) => d.id === 'moonbeam');
    expect(moonbeam?.areaTrigger?.onAreaEntry).toBe(true);
  });

  /**
   * **A neighbouring spell's moving-area clause lends a fixed area nothing.**
   * Every one of these is conjured at a point and stays there for its whole
   * duration; none prints "when the area moves into its space"; and an
   * implementation that gave the clause to every persistent area would have
   * been invisible until one of their points moved.
   */
  it.each([['web'], ['grease'], ['insect-plague'], ['black-tentacles']])(
    'leaves %s without one',
    (spellId) => {
      const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
      expect(definition?.areaTrigger?.onAreaEntry).toBeUndefined();
    },
  );

  /**
   * A clause about an area moving, on an area nothing can move, is dead text —
   * and the SRD has **three** ways for an area to move, not two:
   *
   * | | How it moves | Spell |
   * |---|---|---|
   * | An action moves it | `activation.movesArea` | Moonbeam |
   * | An action moves it as a rider | `origin.movableBy` | *(none with this clause yet)* |
   * | Its carrier walks | `area.origin === 'self'` | Spirit Guardians |
   *
   * The third needs no field at all, which is the whole finding: SRD's
   * glossary says an Emanation moves with its origin, so a self-origin area
   * moving is the shape's own definition rather than a permission a spell
   * grants.
   */
  it('gives every area-entry clause a way for the area to move', () => {
    const stuck = triggered.filter(
      (d) =>
        d.areaTrigger?.onAreaEntry === true &&
        d.activation?.movesArea === undefined &&
        d.origin?.movableBy === undefined &&
        d.area?.origin !== 'self',
    );
    expect(stuck.map((d) => d.id)).toEqual([]);
  });

  /**
   * One spell so far, which is what the rest of this file is about. The
   * converse of the rule above is deliberately **not** asserted: an area that
   * can be moved and prints no clause would move silently and legally, and
   * inventing a rule against it would be the engine adding a sentence.
   */
  it('is one spell so far, so nothing here generalises from a family', () => {
    const movable = SPELL_DEFINITIONS.filter((d) => d.activation?.movesArea !== undefined);
    expect(movable.map((d) => d.id)).toEqual(['moonbeam']);
  });
});

// — creation is not movement ——————————————————————————————————————————————————

describe('a beam that has just appeared has not moved', () => {
  /**
   * SRD separates the two sentences: "**When the Cylinder appears**, each
   * creature in it makes a Constitution saving throw" is the casting, and "A
   * creature also makes this save **when the spell's area moves** into its
   * space" is a later event. A creature standing where the beam is conjured
   * is caught by the first and must not also be caught by the second.
   */
  it('resolves the casting on whoever is standing in it', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    expect(game.hp(INSIDE)).toBeLessThan(MAX_HP);
  });

  it('owes nothing for the area coming into existence', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    expect(game.owed()).toEqual([]);
  });

  it('leaves everyone outside it untouched', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    expect(game.hp(BYSTANDER)).toBe(MAX_HP);
    expect(game.hp(STILL)).toBe(MAX_HP);
  });
});

// — the detector ——————————————————————————————————————————————————————————————

describe('an area that moves onto a creature owes it the spell', () => {
  it('catches the creature the beam arrives on', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(caughtIn(out.events)).toContain(STILL);
  });

  it('catches them once, not once per space crossed', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(caughtIn(out.events).filter((who) => who === STILL)).toHaveLength(1);
  });

  it('settles it through the spell the casting was made with', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(game.hp(STILL)).toBeLessThan(MAX_HP);
  });

  /** Inside before and inside after: the beam did not arrive, it stayed. */
  it('owes nothing to a creature the beam was already on', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_STEP);
    expect(caughtIn(out.events)).not.toContain(INSIDE);
  });

  /** And leaving is not arriving. */
  it('owes nothing to a creature the beam moved off', () => {
    const { game, beam } = withBeam();
    const hurtByTheCast = game.hp(INSIDE);
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(caughtIn(out.events)).not.toContain(INSIDE);
    expect(game.hp(INSIDE)).toBe(hurtByTheCast);
  });

  it('owes nothing to a creature outside it at both ends', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_STEP);
    expect(caughtIn(out.events)).not.toContain(STILL);
  });

  /** A move that changes nobody's membership changes nothing. */
  it('owes nothing when the beam moves through empty air', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, { x: 300, y: LANE - 5, z: 0 });
    expect(caughtIn(out.events)).toEqual([]);
  });

  /** Nothing is left outstanding: the action settles what its own move caused. */
  it('leaves no debt behind for somebody else to remember', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(game.owed()).toEqual([]);
  });
});

// — per-leg settlement ————————————————————————————————————————————————————————

describe('a stated route settles its consequences as the area reaches them', () => {
  /**
   * **The ordering is the rule, not an implementation detail.** SRD Moonbeam
   * says the save happens "when the spell's area moves into its space" — at
   * that point in the route. An implementation that moved the whole way and
   * then settled everything gives the same answers right up until a
   * consequence changes what the rest of the route may do, and then it gives
   * the wrong one silently.
   */
  it('interleaves each move with what that move caused', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });

    const shape = out.events
      .filter((e) => e.type === 'spell-origin-moved' || e.type === 'area-effect-settled')
      .map((e) => (e.type === 'spell-origin-moved' ? `move ${e.to.x}` : `caught ${e.target}`));

    expect(shape).toEqual([
      'move 305',
      `caught ${BYSTANDER}`,
      'move 310',
      'move 315',
      `caught ${STILL}`,
      'move 320',
    ]);
  });

  /** Said the other way: somebody is caught before the last move happens. */
  it('never leaves every consequence until the sweep is over', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const kinds = out.events
      .filter((e) => e.type === 'spell-origin-moved' || e.type === 'area-effect-settled')
      .map((e) => e.type);
    expect(kinds.indexOf('area-effect-settled')).toBeLessThan(
      kinds.lastIndexOf('spell-origin-moved'),
    );
  });

  it('takes the action once for the whole route', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(out.events.filter((e) => e.type === 'action-spent')).toHaveLength(1);
  });

  /** The action is recorded before its own content, so history reads in order. */
  it('records the activation before the movement it paid for', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const types = out.events.map((e) => e.type);
    expect(types.indexOf('spell-activated')).toBeLessThan(types.indexOf('spell-origin-moved'));
  });

  it('reports what the route caught among the action’s own outcomes', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(out.outcomes.map((o) => o.target).sort()).toEqual([BYSTANDER, STILL]);
  });
});

// — the casting that ends halfway along its own route ——————————————————————————

describe('a beam walked onto its own caster can end the spell mid-route', () => {
  /**
   * **The case that makes per-leg settlement a correctness question.**
   *
   * 1. the druid is concentrating on Moonbeam;
   * 2. they take the Magic action and sweep it west, four adjacent steps;
   * 3. the second leg puts the Cylinder on the druid's own space;
   * 4. the druid makes the Moonbeam save and takes the damage;
   * 5. the damage forces a Concentration save, which fails;
   * 6. Moonbeam ends — at that leg;
   * 7. the third and fourth legs must never happen.
   *
   * Every step of that is an existing mechanic. What was wrong before this
   * correction is only *when* step 4 happened.
   */
  const sweepOntoSelf = (flat: number) => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    const out = game.beamTo(beam, SELF_END, { via: SELF_SWEEP, flat });
    return { game, beam, out };
  };

  it('catches the caster on the leg that arrives on them', () => {
    const { out } = sweepOntoSelf(-40);
    expect(caughtIn(out.events)).toContain(DRUID);
  });

  it('ends the casting there', () => {
    const { game, beam } = sweepOntoSelf(-40);
    expect(ongoingSpellOf(game.state, beam)).toBeNull();
  });

  /** The fourth leg is the one that would have caught `LATER`. */
  it('never writes the legs after it', () => {
    const { out } = sweepOntoSelf(-40);
    expect(legsIn(out.events).map((p) => p.x)).toEqual([210, 205]);
  });

  it('never catches the creature only a later leg could have reached', () => {
    const { game, out } = sweepOntoSelf(-40);
    expect(caughtIn(out.events)).not.toContain(LATER);
    expect(game.hp(LATER)).toBe(MAX_HP);
  });

  /** A successful action whose spell ended during it. Nothing is rolled back. */
  it('still spends the action', () => {
    const { out } = sweepOntoSelf(-40);
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
  });

  it('still records that the caster used the spell’s later action', () => {
    const { out } = sweepOntoSelf(-40);
    expect(out.events.some((e) => e.type === 'spell-activated')).toBe(true);
  });

  it('is not reported as an impossible command', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    expect(isErr(game.moveArea(beam, SELF_END, { via: SELF_SWEEP }))).toBe(false);
  });

  it('leaves nothing of the casting behind', () => {
    const { game, beam } = sweepOntoSelf(-40);
    expect(game.owed()).toEqual([]);
    expect(JSON.stringify(game.state.areaTriggers)).not.toContain(beam);
  });

  it('folds at every prefix of the log', () => {
    const { game } = sweepOntoSelf(-40);
    game.foldsAtEveryPrefix();
  });

  // — the control, which is what makes all of the above mean anything ————————

  it('walks the whole route when the caster keeps Concentration', () => {
    const { out } = sweepOntoSelf(40);
    expect(legsIn(out.events).map((p) => p.x)).toEqual([210, 205, 200, 195]);
  });

  it('catches the far creature on the last leg', () => {
    const { game, out } = sweepOntoSelf(40);
    expect(caughtIn(out.events)).toContain(LATER);
    expect(game.hp(LATER)).toBeLessThan(MAX_HP);
  });

  it('leaves the casting running', () => {
    const { game, beam } = sweepOntoSelf(40);
    expect(ongoingSpellOf(game.state, beam)).not.toBeNull();
  });
});

// — the route the engine will not invent ——————————————————————————————————————

describe('a route with spaces nobody named is a question, not a refusal', () => {
  /**
   * **`via` is an adjudicated route, and the engine validates rather than
   * chooses it.** A player says "move the beam onto the ogre"; deciding which
   * way it goes — through the other two ogres, around the paladin, straight
   * there — is judgement about intent and fiction, and that is Maestro's.
   * What the engine owns is that the decision was *made by somebody*: it will
   * not draw a line between two points, and it will not execute a move while
   * silently skipping whoever it crossed.
   *
   * So this is a collaboration boundary and not a hard stop, and nothing here
   * should ever reach a player as "your turn was rejected". Nothing is spent,
   * no die is thrown, and the same activation sent again with the route filled
   * in is the activation the caller meant the first time.
   */
  const coarse = () => {
    const { game, beam } = withBeam();
    return { game, beam, out: game.moveArea(beam, BEAM_EAST) };
  };

  it('asks rather than refusing', () => {
    const { out } = coarse();
    expect(isNeedsContext(out)).toBe(true);
  });

  it('names the fact it is missing and how to supply it', () => {
    const { beam, out } = coarse();
    const requests = contextRequestsOf(out);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe('route');
    expect(requests[0]?.subject).toBe(beam);
    expect(requests[0]?.need).toMatch(/5-foot spaces/);
    expect(requests[0]?.because).toMatch(/moves into/);
    expect(requests[0]?.satisfyWith).toMatch(/via/);
  });

  it('says where the area is, where it was asked to go, and what it may spend', () => {
    const { out } = coarse();
    const request = contextRequestsOf(out)[0];
    expect(request?.need).toMatch(/\(300, 300, 0\)/);
    expect(request?.need).toMatch(/\(320, 300, 0\)/);
    expect(request?.need).toMatch(/20 feet, of the 60/);
  });

  it('asks once per leg it cannot see through', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM_EAST, { via: [BEAM_MID] });
    expect(contextRequestsOf(out)).toHaveLength(2);
  });

  it('asks only about the coarse leg of an otherwise fine route', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_NEAR] });
    expect(contextRequestsOf(out)).toHaveLength(1);
    expect(contextRequestsOf(out)[0]?.need).toMatch(/\(305, 300, 0\)/);
  });

  // — and nothing at all is committed while it waits ————————————————————————

  it('spends no action', () => {
    const { game, beam } = withBeam();
    const before = JSON.stringify(game.state.combat?.budgets);
    game.moveArea(beam, BEAM_EAST);
    expect(JSON.stringify(game.state.combat?.budgets)).toBe(before);
  });

  it('leaves the area where it was', () => {
    const { game, beam } = coarse();
    expect(game.originOf(beam)).toEqual(BEAM);
  });

  it('raises no debt and hurts nobody', () => {
    const { game } = coarse();
    expect(game.owed()).toEqual([]);
    expect(game.hp(BYSTANDER)).toBe(MAX_HP);
    expect(game.hp(STILL)).toBe(MAX_HP);
  });

  it('consumes no randomness', () => {
    const { game, beam } = withBeam();
    const rolls = supply();
    activateSpell(game.state, DRUID, { castingId: beam, targets: [], to: BEAM_EAST }, rolls);
    expect(rolls.issuer.count).toBe(0);
  });

  it('writes no events at all', () => {
    const { game, beam } = withBeam();
    const before = game.log.length;
    game.moveArea(beam, BEAM_EAST);
    expect(game.log).toHaveLength(before);
  });

  // — and a step with nothing in between needs no route ——————————————————————

  /** Two adjacent cubes have no cube between them; there is nothing to ask. */
  it('takes an adjacent step without asking anything', () => {
    const { game, beam } = withBeam();
    expect(isErr(game.moveArea(beam, BEAM_STEP))).toBe(false);
  });

  it('takes a route of adjacent steps without asking anything', () => {
    const { game, beam } = withBeam();
    expect(isErr(game.moveArea(beam, BEAM_EAST, { via: SWEEP_EAST }))).toBe(false);
  });

  /** A diagonal neighbour is five feet away, which is what Chebyshev means. */
  it('takes a diagonal step, which is one space on this lattice', () => {
    const { game, beam } = withBeam();
    expect(isErr(game.moveArea(beam, { x: 305, y: LANE + 5, z: 0 }))).toBe(false);
  });

  /**
   * **Two valid routes to one destination catch different creatures**, which
   * is the clearest statement that the route is a fact rather than a
   * formality. Nothing in the engine prefers either: a route that keeps off
   * the bystander is exactly as legal as one that sweeps through them, and
   * choosing between them is the judgement this boundary leaves with Maestro.
   */
  it('catches different creatures on two legal routes to the same space', () => {
    const direct = withBeam();
    const straight = direct.game.beamTo(direct.beam, BEAM_EAST, { via: SWEEP_EAST });

    const detoured = withBeam();
    const around = detoured.game.beamTo(detoured.beam, BEAM_EAST, { via: SWEEP_AROUND });

    expect(caughtIn(straight.events)).toEqual([BYSTANDER, STILL]);
    expect(caughtIn(around.events)).toEqual([STILL]);
    expect(direct.game.originOf(direct.beam)).toEqual(detoured.game.originOf(detoured.beam));
  });

  /**
   * **The engine is blind to sides, and that is the boundary in one test.**
   * Keeping a beam off the paladin and sweeping it through the ogres is
   * exactly the judgement Maestro is for, and exactly what the engine must
   * not start doing on its own: here the route catches the caster's own party
   * — the druid themselves — because that is the route it was given. A rule
   * that spared allies would be the engine overriding the command it was
   * sent, which is the same failure as aiming a spell at a better target than
   * the one named.
   */
  it('catches the caster’s own side when the route says so', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    const out = game.beamTo(beam, { x: 205, y: LANE, z: 0 }, { via: [{ x: 210, y: LANE, z: 0 }] });
    expect(game.state.creatures[DRUID]?.side).toBe('party');
    expect(caughtIn(out.events)).toContain(DRUID);
  });

  /**
   * **And the requirement belongs to the spell, not to moving a point.**
   * Spiritual Weapon's force triggers on nothing as it travels, so no rule
   * reads what it passed over and there is no fact to go and get. Giving it
   * this requirement because Moonbeam has it would be a neighbouring spell's
   * clause lending it a rule again.
   */
  it('lets Spiritual Weapon cross twenty feet with no route at all', () => {
    const game = new Game();
    const force = game.conjure('spiritual-weapon', { x: 240, y: LANE, z: 0 });
    game.fight().to(DRUID);
    const out = activateSpell(
      game.state,
      DRUID,
      { castingId: force, targets: [], to: { x: 260, y: LANE, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(false);
  });
});

// — the allowance ————————————————————————————————————————————————————————————

describe('how far the beam may go, and what that is measured between', () => {
  /**
   * **Range is where it may first be put; the allowance is how far it then
   * travels.** SRD writes them in two separate sentences — "centered on a
   * point within range" and "move the Cylinder up to 60 feet" — and reusing
   * the first as the second would let a beam jump a hundred feet because the
   * caster could have conjured it there.
   *
   * Checked before the route is, so a caller who cannot afford the move is
   * told that rather than being asked for waypoints they would waste.
   */
  it('refuses a move longer than the allowance, though it is inside Range', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM_TOO_FAR);
    expect(isErr(out) ? out.code : 'ok').toBe('origin_too_far');
  });

  /**
   * **Measured from the beam, not from the caster.** Sixty feet east of the
   * beam is a hundred and sixty feet from the druid, which is well past
   * Moonbeam's Range — and legal, because the sentence that governs a later
   * move measures from where the area is now.
   */
  it('allows a move the caster could not have reached at the cast', () => {
    const { game, beam } = withBeam();
    const steps = Array.from({ length: 11 }, (_, n) => ({ x: 305 + n * 5, y: LANE, z: 0 }));
    game.beamTo(beam, BEAM_FAR, { via: steps });
    expect(game.originOf(beam)).toEqual(BEAM_FAR);
  });

  /** "Up to 60 feet" is a distance travelled, so a route spends what it walks. */
  it('charges the sum of the legs rather than the displacement', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM, { via: [BEAM_FAR] });
    expect(isErr(out) ? out.code : 'ok').toBe('origin_too_far');
  });

  it('allows a route whose legs add up to the allowance', () => {
    const { game, beam } = withBeam();
    const there = Array.from({ length: 6 }, (_, n) => ({ x: 305 + n * 5, y: LANE, z: 0 }));
    const back = Array.from({ length: 5 }, (_, n) => ({ x: 325 - n * 5, y: LANE, z: 0 }));
    game.beamTo(beam, BEAM, { via: [...there, ...back] });
    expect(game.originOf(beam)).toEqual(BEAM);
  });

  /**
   * **A guard needs a case where it is the only thing that can refuse.** Out
   * by the east wall a forty-foot move is well inside the allowance and still
   * leaves the room — the same discriminating fixture the spell-origin batch
   * needed, for the same reason.
   */
  it('refuses a legal-length move that leaves the scene', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', EDGE_BEAM, { by: WARDEN });
    const out = game.moveArea(beam, PAST_THE_WALL, { by: WARDEN });
    expect(isErr(out) ? out.code : 'ok').toBe('outside_scene');
  });

  it('refuses a waypoint that leaves the scene even when the destination does not', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', EDGE_BEAM, { by: WARDEN });
    const out = game.moveArea(beam, EDGE_BEAM, { by: WARDEN, via: [PAST_THE_WALL] });
    expect(isErr(out) ? out.code : 'ok').toBe('outside_scene');
  });
});

// — the action it costs ———————————————————————————————————————————————————————

describe('moving the beam is the Magic action, not a rider on one', () => {
  it('spends the caster’s action', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_STEP);
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
  });

  /** SRD Spiritual Weapon moves as part of an action that also strikes. */
  it('refuses an activation that names no destination', () => {
    const { game, beam } = withBeam();
    const out = activateSpell(game.state, DRUID, { castingId: beam, targets: [] }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('destination_required');
  });

  it('refuses a target, because the beam strikes nobody', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM_STEP, { targets: [STILL] });
    expect(isErr(out) ? out.code : 'ok').toBe('wrong_target_count');
  });

  it('lets nobody but the caster move it', () => {
    const { game, beam } = withBeam();
    const out = game.moveArea(beam, BEAM_STEP, { by: RIVAL });
    expect(isErr(out) ? out.code : 'ok').toBe('not_your_spell');
  });

  /** A fixed area has no move command at all, rather than one it refuses. */
  it('refuses to move a Web, which the book never moves', () => {
    const game = new Game();
    const web = game.conjure('web', { x: 250, y: LANE, z: 0 }, { towards: BEAM });
    const out = game.moveArea(web, { x: 255, y: LANE, z: 0 });
    expect(isErr(out) ? out.code : 'ok').toBe('no_activation');
  });
});

// — a fixed area gains nothing, even from a corrupt log ————————————————————————

describe('an area the book never moves triggers on nothing when it does', () => {
  /**
   * **The clause is the spell's, and the detector reads it.** A hand-written
   * log that slides Web's Cube across the floor is a log and a set of rules
   * that disagree — the command refuses it — and the fold still must not
   * invent a save Web never printed. This is the mutation "fixed Web starts
   * firing when its point changes", written as a test.
   */
  it('raises nothing when a Web’s point is moved by a hand-built log', () => {
    const game = new Game();
    const web = game.conjure('web', { x: 250, y: LANE, z: 0 }, { towards: BEAM });
    expect(game.owed()).toEqual([]);

    game.push([{ type: 'spell-origin-moved', castingId: web, to: BEAM_MID }]);
    expect(game.owed()).toEqual([]);
  });

  it('moves the Cube all the same, because the log is what happened', () => {
    const game = new Game();
    const web = game.conjure('web', { x: 250, y: LANE, z: 0 }, { towards: BEAM });
    game.push([{ type: 'spell-origin-moved', castingId: web, to: BEAM_MID }]);
    expect(game.originOf(web)).toEqual(BEAM_MID);
  });

  it('raises nothing when an Insect Plague’s point is moved', () => {
    const game = new Game();
    const swarm = game.conjure('insect-plague', { x: 150, y: LANE, z: 0 });
    game.push([{ type: 'spell-origin-moved', castingId: swarm, to: { x: 310, y: LANE, z: 0 } }]);
    expect(game.owed()).toEqual([]);
  });
});

// — the three clauses, and the one cap that spans them ————————————————————————

describe('a creature makes this save only once per turn', () => {
  /**
   * SRD Moonbeam: "A creature also makes this save when the spell's area moves
   * into its space **and** when it enters the spell's area **or** ends its
   * turn there. A creature makes this save only once per turn." One sentence
   * names three clauses and the next caps the creature across all of them.
   *
   * **The druid is the only creature that can be caught by two of them inside
   * one global turn**, and that is a fact about the action economy rather than
   * a choice of fixture: one Magic action a turn means the beam moves on the
   * caster's turn, so every other creature meets the area-side clause on a
   * turn that is not its own.
   *
   * The saves below are made rather than failed, for a reason worth stating: a
   * beam that drops its own caster's Concentration ends the spell, and every
   * later assertion would then be passing because the Moonbeam was **gone**.
   */
  const beamOntoTheDruid = (flat = 40) => {
    const game = new Game();
    const beam = game.conjure('moonbeam', { x: 210, y: LANE, z: 0 });
    game.fight().to(DRUID);
    const out = game.beamTo(beam, { x: 205, y: LANE, z: 0 }, { flat });
    return { game, beam, out };
  };

  it('owes the druid the save when the beam arrives on them', () => {
    const { out } = beamOntoTheDruid();
    expect(caughtIn(out.events)).toEqual([DRUID]);
  });

  it('does not owe it again when that same turn ends with them still in it', () => {
    const { game, beam } = beamOntoTheDruid();
    expect(game.originOf(beam)).toBeDefined(); // the spell survived the save
    const ending = game.turn('held-turn', 40);
    expect(ending.filter((e) => e.type === 'area-effect-settled')).toEqual([]);
  });

  /** And the cap is a turn, so the next one collects. */
  it('owes it again on a later turn', () => {
    const { game } = beamOntoTheDruid();
    game.turn('held-turn', 40); // the druid's turn ends, capped
    const before = game.hp(DRUID);
    game.to(DRUID); // round to the druid's next turn
    game.turn('next-turn', 40); // …and end it, still standing in the beam
    expect(game.hp(DRUID)).toBeLessThan(before);
  });

  /**
   * **One action is one move, so the same-turn repeat lives inside a route.**
   * The caster has one Magic action a turn, so a beam cannot be swung twice by
   * two activations without a turn passing between them — but a route may
   * arrive on a creature, leave, and arrive again.
   */
  it('caps a route that arrives on one creature twice', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_MID, {
      via: [BEAM_STEP, BEAM_MID, BEAM_NEAR, BEAM_EAST, BEAM_NEAR],
    });
    expect(legsIn(out.events)).toHaveLength(6);
    expect(caughtIn(out.events).filter((who) => who === BYSTANDER)).toHaveLength(1);
  });
});

// — the cap the area-side move must not spend —————————————————————————————————

describe('an area arriving is not the creature entering', () => {
  /**
   * **`byCreatureEntry` is named for the cause, and this is why.** SRD Web
   * caps "**the first time a creature enters** the webs on a turn". A beam
   * sliding onto a creature standing still is not that creature entering
   * anything, so it must not spend that cap — and no registered spell prints
   * both clauses, which is exactly when the narrow reading is cheap to write
   * down and impossible to reconstruct later.
   *
   * The stamp is the observable: Moonbeam's own `oncePerTurn` would mask the
   * difference in behaviour, so the test reads the bookkeeping directly.
   */
  it('stamps the turn without recording a creature entry', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const stamp = game.state.areaTriggers[areaStampKey(beam, STILL)];
    expect(stamp).toEqual({ turn: expect.any(Number), byCreatureEntry: false });
  });

  /** A creature walking in stamps the other way, on the same field. */
  it('records a creature entry when the creature is the one that moved', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP);
    const stamp = game.state.areaTriggers[areaStampKey(beam, STEPPER)];
    expect(stamp).toEqual({ turn: expect.any(Number), byCreatureEntry: true });
  });

  it('names the moment for what happened, not for what it resembles', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const settled = out.events.filter((e) => e.type === 'area-effect-settled');
    expect(settled).toHaveLength(2);
    expect(
      settled.every((e) => e.type === 'area-effect-settled' && e.moment === 'area-moved'),
    ).toBe(true);
  });
});

// — the other two clauses still work, and are still themselves ————————————————

describe('a beam that has not moved catches people the old ways', () => {
  it('catches a creature that walks into it, as an entry', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP);
    expect(game.owed()).toEqual([
      expect.objectContaining({ target: STEPPER, moment: 'entry' }),
    ]);
  });

  it('catches a creature that ends its turn in it, as the boundary', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    game.fight().to(INSIDE);
    const settled = game.turn().filter((e) => e.type === 'area-effect-settled');
    expect(settled).toEqual([
      expect.objectContaining({ target: INSIDE, moment: 'end-of-turn' }),
    ]);
  });

  /** Three routes to one save, and no route duplicates another. */
  it('does not also call a walk-in an area move', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP);
    expect(game.owed().filter((o) => o.moment === 'area-moved')).toEqual([]);
  });

  it('does not also call an area move an entry', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const settled = out.events.filter((e) => e.type === 'area-effect-settled');
    expect(settled.every((e) => e.type === 'area-effect-settled' && e.moment !== 'entry')).toBe(
      true,
    );
  });
});

// — castings stay apart ———————————————————————————————————————————————————————

describe('two beams are two castings', () => {
  it('moves one without moving the other', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    const theirs = game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    game.beamTo(mine, BEAM_EAST, { via: SWEEP_EAST });
    expect(game.originOf(mine)).toEqual(BEAM_EAST);
    expect(game.originOf(theirs)).toEqual(BEAM);
  });

  it('owes the arrival to the casting that arrived', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    const out = game.beamTo(mine, BEAM_EAST, { via: SWEEP_EAST });
    const settled = out.events.filter((e) => e.type === 'area-effect-settled');
    expect(settled.every((e) => e.type === 'area-effect-settled' && e.castingId === mine)).toBe(
      true,
    );
  });

  /** Each keeps its own per-turn cap, because the stamp is keyed by casting. */
  it('lets the second beam catch a creature the first already caught', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    const theirs = game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    game.beamTo(mine, BEAM_EAST, { via: SWEEP_EAST });
    game.push([{ type: 'spell-origin-moved', castingId: theirs, to: BEAM_EAST }]);
    expect(owedAreaEffectsOf(game.state).map((o) => o.castingId)).toEqual([theirs]);
  });
});

// — retry ————————————————————————————————————————————————————————————————————

describe('a retry changes nothing the first run did not', () => {
  /**
   * **The first run raises — and now also settles — what the retry arrives
   * at**, which is why the duplicate check has to come before every guard. A
   * route that ended its own casting is the sharpest case: the retry finds no
   * such casting, and must be told it already acted rather than that the spell
   * is not running.
   */
  it('does not move the beam twice', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' });
    const again = unwrap(
      game.moveArea(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' }),
      'retrying',
    );
    expect(again.events).toEqual([]);
    expect(game.originOf(beam)).toEqual(BEAM_EAST);
  });

  it('does not roll the damage twice', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' });
    const after = game.hp(STILL);
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' });
    expect(game.hp(STILL)).toBe(after);
  });

  it('refuses the same id with a different destination', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' });
    expect(isErr(game.moveArea(beam, BEAM_STEP, { commandId: 'sweep' }))).toBe(true);
  });

  it('refuses the same id with a different route to the same place', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST, commandId: 'sweep' });
    expect(
      isErr(game.moveArea(beam, BEAM_EAST, { via: SWEEP_AROUND, commandId: 'sweep' })),
    ).toBe(true);
  });

  // — and the same, after the action ended its own casting ————————————————————

  const endedItself = () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    game.beamTo(beam, SELF_END, { via: SELF_SWEEP, commandId: 'sweep' });
    return { game, beam };
  };

  it('recognises the duplicate before noticing the casting has gone', () => {
    const { game, beam } = endedItself();
    const again = game.moveArea(beam, SELF_END, { via: SELF_SWEEP, commandId: 'sweep' });
    expect(isErr(again) ? again.code : 'ok').not.toBe('not_ongoing');
  });

  it('returns no further events', () => {
    const { game, beam } = endedItself();
    const again = unwrap(
      game.moveArea(beam, SELF_END, { via: SELF_SWEEP, commandId: 'sweep' }),
      'retrying after self-termination',
    );
    expect(again.events).toEqual([]);
  });

  it('advances no randomness', () => {
    const { game, beam } = endedItself();
    const rolls = supply();
    activateSpell(
      game.state,
      DRUID,
      { castingId: beam, targets: [], to: SELF_END, via: SELF_SWEEP, commandId: 'sweep' },
      rolls,
    );
    expect(rolls.issuer.count).toBe(0);
  });

  /**
   * **The outcome is recoverable though the casting is not.** `appliedCommands`
   * records the id that landed — which is what makes the duplicate check work
   * — and the retry hands the casting back, off the command the caller sent.
   * The stored `castingId` is deliberately null here: it exists for the ids a
   * caller *could not* have known, which is a declaration allocating one, and
   * an activation names a casting the caller already had.
   */
  it('keeps the casting recoverable from the command that ended it', () => {
    const { game, beam } = endedItself();
    expect(commandOutcome(game.state, 'sweep')).not.toBeNull();
    const again = unwrap(
      game.moveArea(beam, SELF_END, { via: SELF_SWEEP, commandId: 'sweep' }),
      'retrying',
    );
    expect(again.castingId).toBe(beam);
  });

  it('hurts nobody a second time', () => {
    const { game, beam } = endedItself();
    const after = game.hp(DRUID);
    game.moveArea(beam, SELF_END, { via: SELF_SWEEP, commandId: 'sweep' });
    expect(game.hp(DRUID)).toBe(after);
  });
});

// — replay ————————————————————————————————————————————————————————————————————

describe('replay', () => {
  it('reconstructs the moved point', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(ongoingSpellOf(fold('seed', game.log), beam)?.origin).toEqual(BEAM_EAST);
  });

  it('reconstructs a casting that ended halfway along its own route', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    game.beamTo(beam, SELF_END, { via: SELF_SWEEP });
    expect(ongoingSpellOf(fold('seed', game.log), beam)).toBeNull();
  });

  /** The seed carries a live generator and nothing else; the rules are the log's. */
  it('reaches the same areas from a different seed', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    const area = (s: GameState) => ({
      ongoing: s.ongoing,
      owed: s.owedAreaEffects,
      stamps: s.areaTriggers,
      creatures: s.creatures,
    });
    expect(area(fold('other-seed', game.log))).toEqual(area(fold('seed', game.log)));
  });

  it('folds at every prefix of the log', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    game.turn();
    game.foldsAtEveryPrefix();
  });
});

// — cleanup ——————————————————————————————————————————————————————————————————

describe('a casting that ends takes its moved area and its debts with it', () => {
  const swept = () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    game.push(unwrap(endConcentration(game.state, DRUID, 'voluntary'), 'ending Concentration'));
    return { game, beam };
  };

  it('leaves no beam behind', () => {
    const { game, beam } = swept();
    expect(ongoingSpellOf(game.state, beam)).toBeNull();
  });

  /** No stamp belonging to a finished casting survives it. */
  it('leaves no stamp behind', () => {
    const { game, beam } = swept();
    expect(JSON.stringify(game.state.areaTriggers)).not.toContain(beam);
  });

  it('goes on holding nothing after the whole thing is replayed', () => {
    const { game, beam } = swept();
    expect(JSON.stringify(fold('seed', game.log))).not.toContain(beam);
  });

  /**
   * And the same convergence point does it when the beam ended itself. There
   * is no Moonbeam-specific cleanup: `releaseCasting` is the one door.
   */
  it('cleans up identically when the route is what ended it', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', SELF_BEAM);
    game.fight().to(DRUID);
    game.beamTo(beam, SELF_END, { via: SELF_SWEEP });
    expect(JSON.stringify(fold('seed', game.log))).not.toContain(beam);
  });
});

// — the global debt policy is not special-cased ———————————————————————————————

describe('an area that has arrived is unresolved state everybody acts into', () => {
  /**
   * The activation settles what its own movement caused, so nothing is left
   * for the next command to trip over — but a debt raised any other way still
   * stops everything, which is the policy this correction did not change.
   */
  it('leaves nothing owed after the action that caused it', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: SWEEP_EAST });
    expect(isErr(resolveTurn(game.state, supply()))).toBe(false);
  });

  it('still refuses the turn while a creature-side entry stands unsettled', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP);
    expect(isErr(resolveTurn(game.state, supply()))).toBe(true);
  });

  it('refuses an activation while an unrelated debt stands', () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP); // raises an entry debt nobody has settled
    const out = game.moveArea(beam, BEAM_STEP);
    expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
  });

  /** And the settlement command itself is never refused, or the fight wedges. */
  it('lets the settlement through', () => {
    const game = new Game();
    game.conjure('moonbeam', BEAM);
    game.fight();
    game.walk(STEPPER, BEAM_STEP);
    expect(isErr(settleAreaEffects(game.state, supply(), {}))).toBe(false);
  });
});
