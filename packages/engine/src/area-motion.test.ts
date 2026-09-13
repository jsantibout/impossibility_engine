import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import { areaStampKey, type AreaMoment } from './spells.js';
import {
  activateSpell,
  endConcentration,
  ongoingSpellOf,
  owedAreaEffectsOf,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
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

const PREPARED = ['moonbeam', 'web', 'insect-plague', 'grease'];

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
 * | | x | In the beam at 300? | At 305? | At 320? |
 * |---|---|---|---|---|
 * | `INSIDE` | 300 | yes | yes | no |
 * | `BYSTANDER` | 310 | no | **yes** | no |
 * | `STILL` | 320 | no | no | **yes** |
 *
 * So a single 20-foot step from 300 to 320 **passes over** `BYSTANDER` and
 * leaves them outside at both ends — the adversarial case this batch exists to
 * be honest about.
 */
const LANE = 300;
const DRUID_AT: Point = { x: 200, y: LANE, z: 0 };
const BEAM: Point = { x: 300, y: LANE, z: 0 };
const BEAM_STEP: Point = { x: 305, y: LANE, z: 0 };
const BEAM_MID: Point = { x: 310, y: LANE, z: 0 };
const BEAM_NEAR: Point = { x: 315, y: LANE, z: 0 };
const BEAM_EAST: Point = { x: 320, y: LANE, z: 0 };
/** Sixty feet from the beam and a hundred and sixty from the caster. */
const BEAM_FAR: Point = { x: 360, y: LANE, z: 0 };
/** A hundred feet from the beam: inside Moonbeam's Range, outside its move. */
const BEAM_TOO_FAR: Point = { x: 400, y: LANE, z: 0 };

/** Within reach of the lane, so a second beam can be cast over the same spot. */
const RIVAL_AT: Point = { x: 250, y: LANE + 40, z: 0 };

/** The east wall, where a legal-length move still leaves the room. */
const WARDEN_AT: Point = { x: 800, y: LANE, z: 0 };
const EDGE_BEAM: Point = { x: 880, y: LANE, z: 0 };
const PAST_THE_WALL: Point = { x: 920, y: LANE, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });

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
  ...casts(DRUID),
  ...casts(RIVAL),
  ...casts(WARDEN),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  spot('beam edge', BEAM_STEP),
  place(DRUID, DRUID_AT),
  place(RIVAL, RIVAL_AT),
  place(WARDEN, WARDEN_AT),
  place(INSIDE, BEAM),
  place(BYSTANDER, BEAM_MID),
  place(STILL, BEAM_EAST),
  place(STEPPER, { x: 400, y: LANE, z: 0 }),
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

  /** Take the Magic action that moves the beam. */
  moveArea(
    castingId: string,
    to: Point,
    options: {
      readonly by?: CharacterId;
      readonly via?: readonly Point[];
      readonly commandId?: string;
      readonly seed?: string;
    } = {},
  ) {
    return activateSpell(
      this.state,
      options.by ?? DRUID,
      {
        castingId,
        targets: [],
        to,
        ...(options.via === undefined ? {} : { via: options.via }),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply(options.seed ?? 'move'),
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

  settle(seed = 'settle', commandId?: string, flat = -40): readonly GameEvent[] {
    const out = unwrap(
      settleAreaEffects(
        this.state,
        supply(seed, flat),
        commandId === undefined ? {} : { commandId },
      ),
      'settling area effects',
    );
    this.push(out.events);
    return out.events;
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

  caught(): readonly string[] {
    return this.owed()
      .map((o) => o.target)
      .sort();
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

/** A game with the beam already up and nobody having settled the cast. */
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

  /** A clause about an area moving, on an area nothing can move, is dead text. */
  it('gives every area-entry clause a way for the area to move', () => {
    const stuck = triggered.filter(
      (d) =>
        d.areaTrigger?.onAreaEntry === true &&
        d.activation?.movesArea === undefined &&
        d.origin?.movableBy === undefined,
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
    game.beamTo(beam, BEAM_EAST);
    expect(game.owed()).toEqual([
      expect.objectContaining({ target: STILL, moment: 'area-moved' }),
    ]);
  });

  it('owes it once, not once per space crossed', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    expect(game.owed()).toHaveLength(1);
  });

  it('settles it through the spell the casting was made with', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    const before = game.hp(STILL);
    game.settle();
    expect(game.hp(STILL)).toBeLessThan(before);
    expect(game.owed()).toEqual([]);
  });

  /** Inside before and inside after: the beam did not arrive, it stayed. */
  it('owes nothing to a creature the beam was already on', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_STEP);
    expect(game.caught()).not.toContain(INSIDE);
  });

  /** And leaving is not arriving. */
  it('owes nothing to a creature the beam moved off', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    expect(game.caught()).not.toContain(INSIDE);
  });

  it('owes nothing to a creature outside it at both ends', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_STEP);
    expect(game.caught()).not.toContain(STILL);
  });

  /** A move that changes nobody's membership changes nothing. */
  it('owes nothing when the beam moves through empty air', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, { x: 300, y: LANE - 40, z: 0 });
    expect(game.owed()).toEqual([]);
  });
});

// — what a leg cannot prove ———————————————————————————————————————————————————

describe('the route is the caller’s to state, and the gap is said out loud', () => {
  /**
   * **The adversarial case, and the engine does not pretend.** A beam that
   * steps twenty feet from x = 300 to x = 320 passes over x = 310 by any route
   * a person would draw — and the engine has no route. Two points do not imply
   * the line between them, and drawing one would be exactly the invention this
   * engine exists to refuse.
   *
   * So it fires for nobody it cannot prove, and it **says so**.
   */
  it('does not fire for a creature outside both ends of a long step', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    expect(game.caught()).not.toContain(BYSTANDER);
  });

  it('reports the spaces the step crossed as unknown', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST);
    expect(out.unverified.join(' ')).toMatch(/nothing records which spaces it crossed/);
  });

  /** A step to the next space along has nothing in between to be unknown. */
  it('says nothing about a step of one space', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_STEP);
    expect(out.unverified).toEqual([]);
  });

  /**
   * **And a stated route closes the gap.** The same twenty feet, walked as
   * four adjacent steps, is four authoritative relocations — and the creature
   * the single step passed over is caught at the first of them.
   */
  it('catches a creature crossed mid-route when the route is stated', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    expect(game.caught()).toContain(BYSTANDER);
  });

  it('catches the far creature too, at the leg that reaches them', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    expect(game.caught()).toEqual([BYSTANDER, STILL]);
  });

  it('reports no gap for a route of single steps', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    expect(out.unverified).toEqual([]);
  });

  it('writes one relocation per leg, so the fold sees every place it was', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    expect(out.events.filter((e) => e.type === 'spell-origin-moved')).toHaveLength(4);
  });

  /** The creature the beam passed *through* is not still owed at the end. */
  it('leaves the mid-route creature outside when the route is done', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    expect(game.originOf(beam)).toEqual(BEAM_EAST);
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
    game.beamTo(beam, BEAM_FAR);
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
    game.beamTo(beam, BEAM, { via: [{ x: 330, y: LANE, z: 0 }] });
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
    const out = activateSpell(
      game.state,
      DRUID,
      { castingId: beam, targets: [STILL], to: BEAM_STEP },
      supply(),
    );
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
   * turn that is not its own. The druid takes the action that brings the beam
   * onto itself, and then its own turn ends with it still standing in it.
   *
   * The saves below are made rather than failed (`flat` the other way), for a
   * reason worth stating: a beam that drops its own caster's Concentration
   * ends the spell, and every later assertion would then be passing because
   * the Moonbeam was **gone**. Half damage on a successful save is still
   * damage, and is what the assertions read.
   */
  const beamOntoTheDruid = () => {
    const game = new Game();
    const beam = game.conjure('moonbeam', { x: 260, y: LANE, z: 0 });
    game.fight().to(DRUID);
    game.beamTo(beam, { x: 205, y: LANE, z: 0 });
    return { game, beam };
  };

  it('owes the druid the save when the beam arrives on them', () => {
    const { game } = beamOntoTheDruid();
    expect(game.owed()).toEqual([
      expect.objectContaining({ target: DRUID, moment: 'area-moved' }),
    ]);
  });

  it('does not owe it again when that same turn ends with them still in it', () => {
    const { game, beam } = beamOntoTheDruid();
    game.settle('held', undefined, 40);
    expect(game.originOf(beam)).toBeDefined(); // the spell survived the save
    game.turn('held-turn', 40);
    expect(game.caught()).not.toContain(DRUID);
  });

  /** And the cap is a turn, so the next one collects. */
  it('owes it again on a later turn', () => {
    const { game } = beamOntoTheDruid();
    game.settle('held', undefined, 40);
    game.turn('held-turn', 40); // the druid's turn ends, capped
    const before = game.hp(DRUID);
    game.to(DRUID); // round to the druid's next turn
    game.turn('next-turn', 40); // …and end it, still standing in the beam
    expect(game.hp(DRUID)).toBeLessThan(before);
  });

  /**
   * **One action is one move, so the same-turn repeat is inside a route.** The
   * caster has one Magic action a turn, so a beam cannot be swung twice by two
   * activations without a turn passing between them — but a stated route may
   * pass over a creature, leave, and come back, and that is two arrivals in
   * one turn.
   */
  it('caps a route that arrives on one creature twice', () => {
    const { game, beam } = withBeam();
    const out = game.beamTo(beam, BEAM_MID, {
      via: [BEAM_STEP, BEAM_NEAR, BEAM_EAST],
    });
    expect(out.events.filter((e) => e.type === 'spell-origin-moved')).toHaveLength(4);
    expect(game.owed().filter((o) => o.target === BYSTANDER)).toHaveLength(1);
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
    game.beamTo(beam, BEAM_EAST);
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
    game.beamTo(beam, BEAM_EAST);
    const settled = game.settle().filter((e) => e.type === 'area-effect-settled');
    expect(settled).toEqual([expect.objectContaining({ moment: 'area-moved' })]);
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
    // `resolveTurn` settles what the boundary owes in the same breath, so what
    // the moment was is read off what it discharged.
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
    game.beamTo(beam, BEAM_EAST);
    expect(game.owed().filter((o) => o.moment === 'entry')).toEqual([]);
  });
});

// — castings stay apart ———————————————————————————————————————————————————————

describe('two beams are two castings', () => {
  it('moves one without moving the other', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    const theirs = game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    game.beamTo(mine, BEAM_EAST);
    expect(game.originOf(mine)).toEqual(BEAM_EAST);
    expect(game.originOf(theirs)).toEqual(BEAM);
  });

  it('owes the arrival to the casting that arrived', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    game.beamTo(mine, BEAM_EAST);
    expect(owedAreaEffectsOf(game.state).map((o) => o.castingId)).toEqual([mine]);
  });

  /** Each keeps its own per-turn cap, because the stamp is keyed by casting. */
  it('lets the second beam catch a creature the first already caught', () => {
    const game = new Game();
    const mine = game.conjure('moonbeam', BEAM, { seed: 'a' });
    const theirs = game.conjure('moonbeam', BEAM, { by: RIVAL, seed: 'b' });
    game.fight().to(DRUID);
    game.beamTo(mine, BEAM_EAST);
    game.settle();
    game.push([{ type: 'spell-origin-moved', castingId: theirs, to: BEAM_EAST }]);
    expect(owedAreaEffectsOf(game.state).map((o) => o.castingId)).toEqual([theirs]);
  });
});

// — retry ————————————————————————————————————————————————————————————————————

describe('a retry changes nothing the first run did not', () => {
  /**
   * **The first run raises the debt the retry then arrives at**, which is why
   * the duplicate check has to come before the guard that refuses to act
   * while a debt stands. The sixth instance of that trap in this engine and
   * the first where the command's own first run is what springs it.
   */
  it('does not move the beam twice', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    const again = unwrap(game.moveArea(beam, BEAM_EAST, { commandId: 'sweep' }), 'retrying');
    expect(again.events).toEqual([]);
    expect(game.originOf(beam)).toEqual(BEAM_EAST);
  });

  it('does not raise a second debt', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    const before = game.owed().length;
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    expect(game.owed()).toHaveLength(before);
  });

  it('reports the duplicate rather than the debt its first run raised', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    const again = game.moveArea(beam, BEAM_EAST, { commandId: 'sweep' });
    expect(isErr(again)).toBe(false);
  });

  it('refuses the same id with a different destination', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    const other = game.moveArea(beam, BEAM_STEP, { commandId: 'sweep' });
    expect(isErr(other)).toBe(true);
  });

  it('refuses the same id with a different route to the same place', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { commandId: 'sweep' });
    const other = game.moveArea(beam, BEAM_EAST, {
      commandId: 'sweep',
      via: [BEAM_STEP, BEAM_MID, BEAM_NEAR],
    });
    expect(isErr(other)).toBe(true);
  });

  it('does not roll the settlement twice', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    game.settle('once', 'pay');
    const after = game.hp(STILL);
    game.settle('once', 'pay');
    expect(game.hp(STILL)).toBe(after);
  });
});

// — replay ————————————————————————————————————————————————————————————————————

describe('replay', () => {
  it('reconstructs the moved point', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    const again = fold('seed', game.log);
    expect(ongoingSpellOf(again, beam)?.origin).toEqual(BEAM_EAST);
  });

  it('reconstructs the debt the move raised', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    const again = fold('seed', game.log);
    expect(owedAreaEffectsOf(again)).toEqual(owedAreaEffectsOf(game.state));
  });

  /** The seed carries a live generator and nothing else; the rules are the log's. */
  it('reaches the same areas from a different seed', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    game.settle();
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
    game.beamTo(beam, BEAM_EAST, { via: [BEAM_STEP, BEAM_MID, BEAM_NEAR] });
    game.settle();
    game.turn();
    game.foldsAtEveryPrefix();
  });
});

// — cleanup ——————————————————————————————————————————————————————————————————

describe('a casting that ends takes its moved area and its debts with it', () => {
  it('drops the debt when Concentration ends', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    expect(game.owed()).toHaveLength(1);

    game.push(unwrap(endConcentration(game.state, DRUID, 'voluntary'), 'ending Concentration'));
    expect(game.owed()).toEqual([]);
  });

  it('leaves no beam behind', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    game.push(unwrap(endConcentration(game.state, DRUID, 'voluntary'), 'ending Concentration'));
    expect(ongoingSpellOf(game.state, beam)).toBeNull();
  });

  /** No stamp belonging to a finished casting survives it. */
  it('leaves no stamp behind', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    game.settle();
    game.push(unwrap(endConcentration(game.state, DRUID, 'voluntary'), 'ending Concentration'));
    expect(JSON.stringify(game.state.areaTriggers)).not.toContain(beam);
  });

  it('goes on holding nothing after the whole thing is replayed', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    game.push(unwrap(endConcentration(game.state, DRUID, 'voluntary'), 'ending Concentration'));
    expect(JSON.stringify(fold('seed', game.log))).not.toContain(beam);
  });
});

// — the global debt policy is not special-cased ———————————————————————————————

describe('an area that has arrived is unresolved state everybody acts into', () => {
  it('refuses an ordinary action while the arrival is owed', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    const out = resolveMove(
      game.state,
      STEPPER,
      { placement: { from: { point: { x: 405, y: LANE, z: 0 } }, feet: 0 } },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
  });

  it('refuses the turn to advance past it', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    const out = resolveTurn(game.state, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
  });

  /** But the settlement itself is never refused, or the fight would wedge. */
  it('lets the settlement through', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    expect(isErr(settleAreaEffects(game.state, supply(), {}))).toBe(false);
  });

  it('lets everything proceed once it is settled', () => {
    const { game, beam } = withBeam();
    game.beamTo(beam, BEAM_EAST);
    game.settle();
    expect(isErr(resolveTurn(game.state, supply()))).toBe(false);
  });
});
