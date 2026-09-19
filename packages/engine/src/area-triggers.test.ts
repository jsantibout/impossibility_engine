import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import type { AreaMoment } from './spells.js';
import {
  activateFeature,
  activateSpell,
  mayAct,
  declineOpportunity,
  resolveEffectCheck,
  ongoingSpellOf,
  ongoingSpellsOn,
  owedAreaEffectsOf,
  removeCreatureEverywhere,
  resolveAttack,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
  useHealingTouch,
  useRecovery,
  useSelfHeal,
} from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A persistent spell area that catches a creature at a moment the spell names.
 *
 * Two SRD families, and the taxonomy audit that preceded this batch is why
 * they are two rather than one:
 *
 * | | SRD wording | Detected at |
 * |---|---|---|
 * | **F1** | "starts its turn there" / "ends its turn there" | the turn boundary |
 * | **F2a** | "enters the area" | the creature's own authoritative position change |
 *
 * The four spells below are chosen because no two of them agree:
 *
 * | Spell | Boundary | Entry | Cap |
 * |---|---|---|---|
 * | Insect Plague | **end** | first per turn | "only once per turn" — both clauses |
 * | Web | **start** | first per turn | the entry alone |
 * | Grease | **end** | every entry | none |
 * | Black Tentacles | **end** | every entry | "only once per turn" — both clauses |
 *
 * An implementation that swapped start for end, or that let one cap stand in
 * for the other, passes on any one of them and fails on the set.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const RIVAL = id('rival');
const MOVER = id('mover');
const SITTER = id('sitter');
const MOUNT = id('mount');
const RIDER = id('rider');
const THREAT = id('threat'); // stands in reach, so leaving provokes

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
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
  activated: [
    { feature: 'test:stance', name: 'Stance', action: 'bonus-action', pool: null, lasts: 'end-of-next-turn' },
  ],
  ...over,
});

const PREPARED = [
  'insect-plague',
  'web',
  'grease',
  'black-tentacles',
  'bless',
  'hold-person',
  'stinking-cloud',
];

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER || who === RIVAL || who === THREAT ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
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
 * The default is a penalty large enough that every save fails, so a trigger
 * that fired is a trigger that shows. A test that needs the creature to stay
 * on its feet — because a Restrained creature has a Speed of 0 and cannot walk
 * back in — passes the bonus the other way.
 */
const supply = (seed = 'area', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

/**
 * The geometry, worked out once against the engine's own ruler.
 *
 * `SPHERE` is 100 feet from the caster — inside Insect Plague's 300 and
 * outside Web's 60 — so each spell gets its own point. Every `INSIDE` spot is
 * exactly one cube inside its shape and every `OUTSIDE` one is exactly one
 * cube beyond, which is the boundary pair every membership test leans on.
 */
const HALL: Point = { x: 200, y: 200, z: 0 };
const SPHERE: Point = { x: 300, y: 200, z: 0 };
const CUBE: Point = { x: 250, y: 200, z: 0 };
const TOWARDS: Point = { x: 300, y: 200, z: 0 }; // a Cube is laid along +x
const AWAY: Point = { x: 200, y: 200, z: 0 }; // …or along -x, which is a different Cube
/**
 * Stinking Cloud's Sphere gets a centre of its own, and the arithmetic is why.
 *
 * It cannot share `CUBE`: a **20-foot radius** reaches 20 feet from that
 * centre, where a **20-foot Cube** laid along +x does not reach back at all —
 * so `outside cube` at x=240 is outside Web's Cube and squarely *inside* a
 * Sphere centred there, and MOVER would begin the fixture already standing in
 * the gas. It cannot be `SPHERE` either: that is 100 feet from the caster and
 * Stinking Cloud reaches 90.
 *
 * At x=275 the three distances it has to get right all come out: 75 feet from
 * the caster (inside the spell's Range), 35 from `outside cube` (out of the
 * gas, so MOVER starts clean) and 15 from `inside cube` (in it).
 */
const CLOUD: Point = { x: 275, y: 200, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });

const place = (who: CharacterId, name: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark: name }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(RIVAL),
  added(MOVER),
  added(SITTER),
  added(MOUNT),
  added(RIDER),
  added(THREAT),
  ...casts(CASTER),
  ...casts(RIVAL),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  spot('the hall', HALL),
  spot('rival post', { x: 200, y: 240, z: 0 }),
  spot('inside cube', { x: 260, y: 200, z: 0 }),
  // Inside **both** Cubes: Grease's is 10 feet and Web's is 20, so the
  // smaller one is what a shared spot has to fit in. A landmark that fitted
  // only the larger made 'a move that never leaves the area' pass by leaving
  // it — which is what the mutation pass found.
  spot('deeper in cube', { x: 255, y: 200, z: 0 }),
  spot('outside cube', { x: 240, y: 200, z: 0 }),
  spot('inside sphere', { x: 320, y: 200, z: 0 }),
  spot('outside sphere', { x: 340, y: 200, z: 0 }),
  spot('mount post', { x: 240, y: 240, z: 0 }),
  spot('threat post', { x: 160, y: 195, z: 0 }),
  spot('beside threat', { x: 160, y: 200, z: 0 }),
  spot('beside mover', { x: 245, y: 200, z: 0 }),
  place(CASTER, 'the hall'),
  place(RIVAL, 'rival post'),
  place(MOVER, 'outside cube'),
  place(SITTER, 'outside sphere'),
  {
    type: 'creature-placed',
    id: MOUNT,
    placement: { from: { landmark: 'mount post' }, feet: 0, size: 'large' },
  },
  place(THREAT, 'threat post'),
];

/** Speeds large enough that walking about is never the thing under test. */
const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 30, speed: 30 },
      { id: MOVER, initiative: 20, speed: 400 },
      { id: SITTER, initiative: 10, speed: 400 },
      { id: MOUNT, initiative: 5, speed: 400 },
      { id: THREAT, initiative: 1, speed: 30 },
    ],
  },
];

/** A log that folds, with the handful of helpers these tests want. */
class Game {
  constructor(
    private readonly events: GameEvent[] = [...SETUP],
    /** False for the tests that are deliberately outside Initiative. */
    private readonly fighting = true,
  ) {}

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

  /** Cast an area spell at a point, and hand back the casting id. */
  conjure(
    spellId: string,
    at: Point,
    options: {
      readonly by?: CharacterId;
      readonly towards?: Point;
      readonly slotLevel?: number;
      readonly seed?: string;
    } = {},
  ): string {
    const by = options.by ?? CASTER;
    const out = unwrap(
      resolveSpell(
        this.state,
        by,
        {
          spellId,
          targets: [],
          at,
          ...(options.towards === undefined ? {} : { towards: options.towards }),
          ...(options.slotLevel === undefined ? {} : { slotLevel: options.slotLevel }),
        },
        supply(options.seed ?? spellId),
      ),
      `${by} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  /**
   * Roll Initiative, once, on the first thing that needs a turn order.
   *
   * The areas are conjured before the fight rather than during it: SRD allows
   * one spell slot a turn and several tests want two areas over one square,
   * and a wizard who set a trap before the door opened is the commoner table
   * situation anyway.
   */
  private fight(): void {
    if (this.fighting && this.state.combat === null) this.push(FIGHT);
  }

  /** Round the Initiative order to this creature's turn, settling as it goes. */
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

  /** Walk a creature to a named spot on its own turn, settling nothing after. */
  walk(who: CharacterId, to: string, commandId?: string): void {
    this.to(who);
    const out = unwrap(
      resolveMove(
        this.state,
        who,
        {
          placement: { from: { landmark: to }, feet: 0 },
          ...(commandId === undefined ? {} : { commandId }),
        },
        supply('move'),
      ),
      `${who} walking to ${to}`,
    );
    this.push(out.events);
  }

  /** Settle everything the areas owe, rolling their saves. */
  settle(seed = 'settle', commandId?: string, flat = -40): readonly GameEvent[] {
    const out = unwrap(
      settleAreaEffects(this.state, supply(seed, flat), commandId === undefined ? {} : { commandId }),
      'settling area effects',
    );
    this.push(out.events);
    return out.events;
  }

  /** Advance one turn. `resolveTurn` settles whatever the boundary owes. */
  turn(seed = 'turn', flat = -40): readonly GameEvent[] {
    this.fight();
    const out = unwrap(resolveTurn(this.state, supply(seed, flat)), 'advancing the turn');
    this.push(out.events);
    return out.events;
  }

  owed(): readonly { readonly castingId: string; readonly target: string; readonly moment: AreaMoment }[] {
    return owedAreaEffectsOf(this.state);
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  has(who: CharacterId, condition: string): boolean {
    return this.state.creatures[who]?.conditions.conditions.includes(condition as never) ?? false;
  }

  /** Every roll a settlement recorded, so a test can count what fired. */
  saves(events: readonly GameEvent[]): number {
    return events.filter((e) => e.type === 'area-effect-settled').length;
  }

  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

/**
 * Each spell's own printed prose, out of the parsed book.
 *
 * The same technique `spell-tracking.test.ts` uses, and for the same reason:
 * a comment saying a clause is in the SRD is only as honest as whoever wrote
 * it, while the book can be read.
 */
const PROSE: ReadonlyMap<string, string> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string }[]
  ).map((spell) => [spell.id, spell.description]),
);

const roundTrip = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

// — the area survives the casting ——————————————————————————————————————————————

describe('a persistent area is live state, not a number thrown away', () => {
  it('keeps the point an area spell was centred on', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    expect(ongoingSpellOf(g.state, plague)?.origin).toEqual(SPHERE);
  });

  /**
   * The hole the taxonomy audit found: `placeArea` resolved `towards` and threw
   * it away, so a Cube's direction — chosen once, at the cast, and
   * unreconstructible from anything else — was gone the moment the spell
   * landed. Every membership question afterwards would have had to guess.
   */
  it('keeps the direction a Cube was laid along', () => {
    const g = new Game();
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    expect(ongoingSpellOf(g.state, web)?.towards).toEqual(TOWARDS);
  });

  /**
   * And it is the *direction* that decides membership, not the point. The two
   * Cubes below share an origin and point opposite ways, so a replay that lost
   * the direction would put the same creature in both — or in neither.
   */
  it('catches a creature with the Cube laid one way and not the other', () => {
    const along = new Game();
    along.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    along.walk(MOVER, 'inside cube');
    expect(along.owed()).toHaveLength(1);

    const back = new Game();
    back.conjure('grease', CUBE, { towards: AWAY, slotLevel: 1 });
    back.walk(MOVER, 'inside cube');
    expect(back.owed()).toEqual([]);
  });

  /** A direction lost in the log is a direction lost for ever. */
  it('reconstructs the exact geometry from the log alone', () => {
    const g = new Game();
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.walk(MOVER, 'inside cube');

    const replayed = roundTrip(g.log);
    expect(ongoingSpellOf(replayed, web)?.origin).toEqual(CUBE);
    expect(ongoingSpellOf(replayed, web)?.towards).toEqual(TOWARDS);
    expect(replayed).toEqual(g.state);
  });

  /** An area that is not directional keeps no direction to be wrong about. */
  it('keeps no direction for a Sphere', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    expect(ongoingSpellOf(g.state, plague)?.towards).toBeUndefined();
  });

  it('takes the area away with the casting', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.push([{ type: 'spell-ended', castingId: plague, on: null, reason: 'dispelled' }]);
    expect(ongoingSpellOf(g.state, plague)).toBeNull();
  });

  /**
   * SRD Web does nothing when it appears — the webs are simply there — so a
   * creature already standing in the Cube is not caught, and is not on it.
   */
  it('leaves a Web on nobody when it is conjured over them', () => {
    // Placed inside rather than walked in: the webs appear around a creature
    // that was already standing there, which SRD says does nothing at all.
    const g = new Game([...SETUP, place(RIDER, 'inside cube')], false);
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    expect(spellOn(g.state, ongoingSpellOf(g.state, web)!)).toEqual([]);
    expect(g.owed()).toEqual([]);
    expect(g.has(RIDER, 'restrained')).toBe(false);
  });
});

// — F1: the turn boundary —————————————————————————————————————————————————————

describe('a creature that starts or ends its turn in the area', () => {
  /**
   * The discriminating fixture: one creature standing in a start-trigger area
   * and an end-trigger area at the same spot. A swapped implementation fires
   * the wrong one at the wrong boundary, and this is the only shape that says
   * so — either spell alone passes under either reading.
   */
  it('tells a start-of-turn area from an end-of-turn one at the same spot', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2, seed: 'web' });
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'grease' });
    g.walk(MOVER, 'inside cube');
    g.settle('entry');

    const seen: string[] = [];
    for (let n = 0; n < 8; n += 1) {
      for (const event of g.turn(`t${n}`)) {
        if (event.type !== 'area-effect-settled') continue;
        const spell = ongoingSpellOf(g.state, event.castingId)?.spell ?? 'Web';
        seen.push(`${spell} @ ${event.moment}`);
      }
      g.settle(`s${n}`);
    }

    expect(seen).toContain('Web @ start-of-turn');
    expect(seen).toContain('Grease @ end-of-turn');
    expect(seen).not.toContain('Web @ end-of-turn');
    expect(seen).not.toContain('Grease @ start-of-turn');
  });

  it('owes nothing to a creature standing outside the area', () => {
    const g = new Game();
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    for (let n = 0; n < 8; n += 1) {
      g.turn(`t${n}`);
      expect(g.owed()).toEqual([]);
    }
  });

  /** Outside combat there are no turns, so no boundary can arrive. */
  it('raises no boundary debt where there is no Initiative order', () => {
    const g = new Game([...SETUP], false);
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.settle('entry');
    g.push([{ type: 'time-advanced', seconds: 60, reason: 'a long look round' }]);
    expect(g.owed()).toEqual([]);
  });
});

/**
 * SRD Stinking Cloud, whole clause: "Each creature that starts its turn in the
 * Sphere must succeed on a Constitution saving throw or have the Poisoned
 * condition **until the end of the current turn**."
 *
 * It is the first spell in the book the engine can say that about, and the
 * point of driving it here rather than trusting `duration.test.ts` is that the
 * rider travels a long way before it becomes a deadline: from the definition,
 * through the trigger's effect list, through `riderDuration`, into
 * `resolveDuration` at the moment the debt settles. Every one of those is a
 * place the anchor could have been read off the caster instead, and a caster
 * standing outside the cloud is what makes the difference visible.
 *
 * **The whole of what the spell does to a creature lasts that creature's own
 * turn.** The clause fires at a start-of-turn boundary, so the turn in
 * progress is the poisoned creature's; `end-of-casters-next-turn` would have
 * anchored to the cleric across the room and run a round or more longer.
 */
describe('a condition that lasts until the end of the turn in progress', () => {
  it('poisons a creature that starts its turn in the gas, for that turn only', () => {
    const g = new Game();
    g.conjure('stinking-cloud', CLOUD, { slotLevel: 3, seed: 'cloud' });

    // Walking in owes nothing: the spell prints no entry clause, which is the
    // half `every trigger is a clause the SRD actually prints` holds to the
    // book. So the gas has done nothing to anybody yet.
    g.walk(MOVER, 'inside cube');
    g.settle('entry');
    expect(g.has(MOVER, 'poisoned')).toBe(false);

    // Round the order back to the top of MOVER's own turn. The boundary raises
    // the debt and `resolveTurn` settles it with the fixture's −40, so the
    // Constitution save fails and the gas lands.
    g.turn('movers-first-turn-ends');
    g.to(MOVER);
    expect(g.has(MOVER, 'poisoned')).toBe(true);

    // And it is gone the moment that turn ends — one turn-ending away, not the
    // two "the end of your next turn" comes to when it is said on your own.
    g.turn('movers-second-turn-ends');
    expect(g.has(MOVER, 'poisoned')).toBe(false);
  });

  /**
   * The same cloud, on the next round, with nobody having done anything about
   * it: a creature that is still standing there starts its turn and is
   * poisoned again. A deadline that had ended the *casting* rather than the
   * condition would show up here and nowhere else.
   */
  it('poisons them again the next time they start a turn in it', () => {
    const g = new Game();
    g.conjure('stinking-cloud', CLOUD, { slotLevel: 3, seed: 'cloud' });
    g.walk(MOVER, 'inside cube');

    g.turn('first');
    g.to(MOVER);
    expect(g.has(MOVER, 'poisoned')).toBe(true);
    g.turn('second');
    expect(g.has(MOVER, 'poisoned')).toBe(false);

    g.to(MOVER);
    expect(g.has(MOVER, 'poisoned')).toBe(true);
  });

  /**
   * And the cloud really is what did it, rather than the fixture: the save is
   * rolled at the boundary and reported, and a creature standing outside the
   * Sphere the whole time is never poisoned at all.
   */
  it('settles a save for the creature in the gas and none for the one outside', () => {
    const g = new Game();
    g.conjure('stinking-cloud', CLOUD, { slotLevel: 3, seed: 'cloud' });
    g.walk(MOVER, 'inside cube');
    g.turn('first');

    const settled = g.to(MOVER).log.filter((e) => e.type === 'area-effect-settled');
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.every((e) => e.moment === 'start-of-turn')).toBe(true);
    expect(g.has(SITTER, 'poisoned')).toBe(false);
  });
});

// — F2a: entering under your own power ————————————————————————————————————————

describe('a creature whose position transitions from outside to inside', () => {
  it('owes the area’s effect on entering it', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    expect(g.owed()).toEqual([]);

    g.walk(MOVER, 'inside cube');
    // Three facts and no fourth: the debt says which casting caught whom, and
    // at which of the SRD's moments. The turn it was raised on lives in
    // `areaTriggers`, which is what the once-per-turn caps read; carrying it
    // here too was a second place for a cap to be got wrong.
    expect(g.owed()).toEqual([{ castingId: grease, target: MOVER, moment: 'entry' }]);
  });

  it('owes nothing for a move that never leaves the area', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('first');

    g.walk(MOVER, 'deeper in cube');
    expect(g.owed()).toEqual([]);
  });

  it('owes nothing for leaving, and nothing for staying out', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('first');

    g.walk(MOVER, 'outside cube');
    expect(g.owed()).toEqual([]);

    g.walk(MOVER, 'beside threat');
    expect(g.owed()).toEqual([]);
  });

  /**
   * **Placement is not entry.** A creature being put into the scene is the
   * fiction saying where it already was, not a transition into anywhere — and
   * an engine that fired on it would charge every monster a save for being
   * narrated into the room the spell is already filling.
   */
  it('owes nothing when a creature is placed inside', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.push([added(id('newcomer')), place(id('newcomer'), 'deeper in cube')]);
    expect(g.owed()).toEqual([]);
  });

  /**
   * **Forced movement is still entry.** SRD gives the Opportunity Attack to a
   * creature's own movement and nothing else, but a shove into a Web puts you
   * in the Web all the same.
   */
  it('owes the effect when somebody is shoved in', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.to(CASTER);
    const shoved = unwrap(
      resolveMove(
        g.state,
        MOVER,
        { placement: { from: { landmark: 'inside cube' }, feet: 0 }, forced: true },
        supply('shove'),
      ),
      'shoving the mover in',
    );
    g.push(shoved.events);
    expect(g.owed().map((d) => d.target)).toEqual([MOVER]);
  });
});

// — riders ————————————————————————————————————————————————————————————————————

describe('every creature whose position changed, not just the one that moved', () => {
  /**
   * `moveCreature` carries riders with their mount, so a rider's authoritative
   * position transitions with no event naming them. Reading `event.id` alone
   * misses them entirely — and a rider dragged into a Web is exactly the case
   * a table would notice.
   */
  it('owes a rider their own debt when the mount carries them in', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });

    g.push([place(RIDER, 'mount post')]);
    g.push([{ type: 'mounted', rider: RIDER, mount: MOUNT, willing: true }]);
    if (g.owed().length > 0) g.settle('mounting');

    g.walk(MOUNT, 'inside cube');

    const owed = g.owed();
    expect(owed.map((d) => d.target).sort()).toEqual([MOUNT, RIDER].sort());
    expect(owed.every((d) => d.castingId === grease)).toBe(true);
  });
});

// — frequency —————————————————————————————————————————————————————————————————

describe('how often one casting may catch one creature in a turn', () => {
  /**
   * SRD Insect Plague: "A creature makes this save **only once per turn**."
   * Entry and the end of the turn are two moments and the cap spans both, so
   * walking in and then standing there is one save.
   */
  it('caps Insect Plague at one save a turn across entry and the boundary', () => {
    const g = new Game();
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });

    g.walk(MOVER, 'inside sphere');
    expect(g.owed()).toHaveLength(1);
    g.settle('entry');
    const hurt = g.hp(MOVER);
    expect(hurt).toBeLessThan(300);

    // Ending that same turn inside owes nothing more.
    g.turn('end-of-turn');
    expect(g.hp(MOVER)).toBe(hurt);

    // And the next time round the order it is a new turn, so it fires again.
    g.to(MOVER);
    g.turn('next-end');
    expect(g.hp(MOVER)).toBeLessThan(hurt);
  });

  /**
   * SRD Web caps only the **entry**: "The first time a creature enters the
   * webs on a turn **or** starts its turn there." A creature that starts its
   * turn inside has not *entered*, so tearing out and walking back in is still
   * that turn's first entry — and saves again.
   *
   * If one per-turn stamp suppressed the second save, the implementation would
   * be Insect Plague's rule wearing Web's name.
   */
  it('lets Web catch a creature at its start and again on its first entry', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });

    g.walk(MOVER, 'inside cube');
    g.settle('entry', undefined, 40);

    // Round on to the start of MOVER's own turn, which the boundary owes.
    g.to(CASTER);
    // The start-of-turn save is **made**, so MOVER is not Restrained and still
    // has a Speed to walk out with. The save happening is the point; failing
    // it would only prove that a Restrained creature cannot move.
    const started = g.turn('mover-start', 40);
    expect(g.saves(started)).toBe(1);
    expect(g.state.combat?.order[g.state.combat.turnIndex]?.id).toBe(MOVER);
    expect(g.has(MOVER, 'restrained')).toBe(false);

    // Same turn: out and back in. The first *entry* of the turn fires.
    g.walk(MOVER, 'outside cube');
    expect(g.owed()).toEqual([]);
    g.walk(MOVER, 'inside cube');
    expect(g.owed().filter((d) => d.moment === 'entry')).toHaveLength(1);
    g.settle('re-entry', undefined, 40);

    // And a second re-entry on the same turn does not.
    g.walk(MOVER, 'outside cube');
    g.walk(MOVER, 'inside cube');
    expect(g.owed()).toEqual([]);
  });

  /** SRD Grease caps nothing: "A creature that enters the area ... must also". */
  it('lets Grease catch a creature on every entry in one turn', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.to(MOVER);

    let caught = 0;
    for (let n = 0; n < 3; n += 1) {
      g.walk(MOVER, 'inside cube');
      caught += g.owed().filter((d) => d.moment === 'entry').length;
      g.settle(`s${n}`);
      g.walk(MOVER, 'outside cube');
    }
    expect(caught).toBe(3);
  });

  /**
   * Outside combat there is no turn to be once-per, and the engine's standing
   * convention — the one-slot-per-turn rule, every once-per-turn feature — is
   * that nothing restricts what has no turn. Preserved rather than invented:
   * even Insect Plague's cap lapses, because there is nothing to count.
   */
  it('caps nothing outside combat, where there are no turns', () => {
    const g = new Game([...SETUP], false);
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });

    let caught = 0;
    for (let n = 0; n < 3; n += 1) {
      g.walk(MOVER, 'inside sphere');
      caught += g.owed().length;
      g.settle(`s${n}`);
      g.walk(MOVER, 'outside sphere');
    }
    expect(caught).toBe(3);
  });
});

// — the definitions against the book ——————————————————————————————————————————

describe('every trigger is a clause the SRD actually prints', () => {
  const triggered = SPELL_DEFINITIONS.filter((d) => d.areaTrigger !== undefined);

  it('has some, so the rules below are not vacuous', () => {
    expect(triggered.length).toBeGreaterThan(0);
  });

  /**
   * **A cloud next door must not lend a spell an entry clause.** Stinking
   * Cloud names no entry at all and Wind Wall names no later trigger of any
   * kind, and the way that stays true is not a comment: the spell's own
   * printed prose is read out of the parsed book and the definition is held
   * against it.
   *
   * **The SRD names the area by its shape as often as by the word "area"**, so
   * the nouns are listed. The word order is what discriminates: "a creature
   * enters **the Emanation**" is this clause, and "the Emanation enters a
   * creature's space" is the other one — same two words, opposite rules, and
   * only one of them matches here.
   */
  it.each(triggered.map((d) => [d.id, d] as const))(
    'gives %s an entry clause only where the book has one',
    (spellId, definition) => {
      const prose = PROSE.get(spellId) ?? '';
      const printed =
        /\benters? the (spell’s |spell's )?(area|webs|emanation|sphere|cylinder|cloud)\b/i.test(
          prose,
        );
      expect(definition.areaTrigger?.onEntry !== undefined).toBe(printed);
    },
  );

  /**
   * **And caps the entering only where the book caps the entering.** Two
   * different sentences, which is the whole reason `onEntry` has two values:
   *
   * | Spell | The clause | Reading |
   * |---|---|---|
   * | Insect Plague | "enters the spell's area **for the first time on a turn**" | `first-per-turn` |
   * | Web | "**The first time** a creature enters the webs on a turn" | `first-per-turn` |
   * | Moonbeam | "when it enters the spell's area" | `every-entry` |
   * | Grease | "A creature that enters the area" | `every-entry` |
   *
   * Moonbeam's own "only once per turn" sentence is a cap on the **creature**
   * and lives in `oncePerTurn`; writing it a second time here would be one
   * rule in two fields. A mutation that read Moonbeam's entry clause as Insect
   * Plague's survived a whole suite before this test existed, because
   * `oncePerTurn` bars the second entry first and hides the difference — a
   * transcription nothing can check is only as good as whoever typed it.
   */
  it.each(triggered.map((d) => [d.id, d] as const))(
    'caps %s at the entering only where the book caps the entering',
    (spellId, definition) => {
      const prose = PROSE.get(spellId) ?? '';
      const onEntry = definition.areaTrigger?.onEntry;
      if (onEntry === undefined) return;
      const capped =
        /first time (a creature )?enters?/i.test(prose) ||
        /enters?[^.]*for the first time on a turn/i.test(prose);
      expect(onEntry).toBe(capped ? 'first-per-turn' : 'every-entry');
    },
  );

  it.each(triggered.map((d) => [d.id, d] as const))(
    'fires %s at the boundary the book names',
    (spellId, definition) => {
      const prose = PROSE.get(spellId) ?? '';
      const starts = /\bstarts its turn\b/i.test(prose);
      const ends = /\bends? it'?s? turn\b/i.test(prose);
      expect(definition.areaTrigger?.at).toBe(
        starts ? 'start-of-turn' : ends ? 'end-of-turn' : undefined,
      );
    },
  );

  it.each(triggered.map((d) => [d.id, d] as const))(
    'caps %s only where the book says "only once per turn"',
    (spellId, definition) => {
      const prose = PROSE.get(spellId) ?? '';
      expect(definition.areaTrigger?.oncePerTurn === true).toBe(
        /only once per turn/i.test(prose),
      );
    },
  );

  /**
   * **And an area-side clause only where the book moves the area onto people.**
   * Four SRD spells print it and every one of them is a spell whose area the
   * rules go on to move: "when the spell's **area moves into its space**"
   * (Moonbeam), "when the **Sphere moves into its space**" (Cloudkill,
   * Incendiary Cloud), "whenever the **Emanation enters a creature's space**"
   * (Spirit Guardians). The last is the same mechanic in the opposite word
   * order, which is exactly why the regex reads both.
   *
   * The four fixed areas here print nothing of the kind, and the way that
   * stays true is the spell's own prose rather than a comment.
   */
  it.each(triggered.map((d) => [d.id, d] as const))(
    'gives %s an area-side clause only where the book has one',
    (spellId, definition) => {
      const prose = PROSE.get(spellId) ?? '';
      const printed =
        /\b(area|sphere|cloud|cylinder|emanation)\s+moves into\s+(its|a creature(’|')s)\s+space/i.test(
          prose,
        ) ||
        /\b(area|sphere|cloud|cylinder|emanation)\s+enters\s+a creature(’|')s\s+space/i.test(
          prose,
        );
      expect(definition.areaTrigger?.onAreaEntry === true).toBe(printed);
    },
  );

  /** A trigger with no area is a rule with nowhere to happen. */
  it('gives every trigger an area to be in', () => {
    expect(triggered.filter((d) => d.area === undefined).map((d) => d.id)).toEqual([]);
  });
});

// — temporal order ————————————————————————————————————————————————————————————

describe('the finishing creature ends before the next one begins', () => {
  /**
   * The causal proof, which is the one that matters. RIVAL concentrates on a
   * Web that MOVER is standing in, and RIVAL ends their turn in an Insect
   * Plague. If the end settles first, the swarm drops RIVAL, the Concentration
   * breaks, the Web ends and MOVER never rolls. If the start settles first,
   * MOVER saves against a Web the rules had already ended.
   */
  it('lets an end-of-turn effect end the spell a start-of-turn debt was for', () => {
    const g = new Game([...SETUP], false);
    const web = g.conjure('web', CUBE, { by: RIVAL, towards: TOWARDS, slotLevel: 2, seed: 'web' });
    g.conjure('insect-plague', SPHERE, { slotLevel: 5, seed: 'plague' });
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: RIVAL, initiative: 30, speed: 400 },
          { id: MOVER, initiative: 20, speed: 400 },
        ],
      },
    ]);

    // MOVER stands in the Web; RIVAL stands in the swarm.
    g.walk(MOVER, 'inside cube');
    g.settle('entry');
    g.push([
      { type: 'creature-unplaced', id: RIVAL },
      place(RIVAL, 'inside sphere'),
    ]);

    // RIVAL is down to a hit point, so the swarm's 4d10 is certain to drop them.
    g.push([{ type: 'damage-taken', id: RIVAL, amount: 299, source: 'the fixture' }]);
    expect(ongoingSpellOf(g.state, web)).not.toBeNull();

    // The boundary: RIVAL's turn ends inside the swarm, MOVER's begins inside
    // the Web. One `turn-advanced`, two moments, and only one order is right.
    g.to(RIVAL);
    g.turn('boundary');

    expect(ongoingSpellOf(g.state, web)).toBeNull();
    expect(g.has(MOVER, 'restrained')).toBe(false);
    expect(g.owed()).toEqual([]);
  });

  /**
   * And the cosmetic half, which catches an implementation that sorts one
   * dictionary: `cast:1` is the start-of-turn spell and `cast:2` the
   * end-of-turn one, so casting order and moment order disagree.
   */
  it('orders the batch by the moment, not by anything about the key', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2, seed: 'web' });
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'grease' });

    g.walk(MOVER, 'inside cube');
    g.settle('entry');

    // Round to the boundary where MOVER's turn ends (Grease) and SITTER's
    // begins (Web) — one transition, two moments, and only one order is right.
    g.walk(SITTER, 'inside cube');
    g.settle('entry2');
    g.to(MOVER);
    const batch = g.turn('boundary');

    const order = batch
      .filter((e) => e.type === 'area-effect-settled')
      .map((e) => (e as { readonly moment: AreaMoment }).moment);
    expect(order.length).toBeGreaterThanOrEqual(2);
    expect(order[0]).toBe('end-of-turn');
    expect(order[order.length - 1]).toBe('start-of-turn');
  });
});

// — the guards ————————————————————————————————————————————————————————————————

describe('nothing acts past an effect the area is owed', () => {
  const owing = (): Game => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    return g;
  };

  it('refuses to advance the turn', () => {
    const out = resolveTurn(owing().state, supply('t'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  it('refuses a second move', () => {
    const out = resolveMove(
      owing().state,
      MOVER,
      { placement: { from: { landmark: 'outside cube' }, feet: 0 } },
      supply('m'),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  it('refuses a cast by the creature it caught', () => {
    const g = owing();
    g.push([
      {
        type: 'spellcasting-declared',
        id: MOVER,
        spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
      },
      {
        type: 'resource-pool-declared',
        id: MOVER,
        pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
      },
    ]);
    const out = resolveSpell(
      g.state,
      MOVER,
      { spellId: 'bless', targets: [RIVAL], slotLevel: 1 },
      supply('b'),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  /**
   * **And an unrelated creature is refused too**, because "unrelated" is not a
   * thing the engine can know: settling the debt can damage its target, break
   * a Concentration and free somebody two rooms away. See the causal fixture
   * below, which is why this is global engine debt rather than a courtesy.
   */
  it('refuses a cast by a creature the area never caught', () => {
    const g = owing();
    const out = resolveSpell(
      g.state,
      CASTER,
      { spellId: 'bless', targets: [RIVAL], slotLevel: 1 },
      supply('b'),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  it('refuses an attack', () => {
    const out = resolveAttack(owing().state, MOVER, { target: THREAT, weapon: 'dagger' }, supply('a'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  /**
   * The one this batch singled out. A creature whose turn has just begun has a
   * fresh action budget **and** a save it has not made, and it may not spend
   * the first past the second: a Web that has caught it may be about to
   * Restrain it.
   */
  it('refuses an attack while the attacker owes a start-of-turn effect', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.walk(MOVER, 'inside cube');
    g.settle('entry');

    // Advance to MOVER's turn **without** letting `resolveTurn` settle: the
    // boundary raised the debt and nobody has rolled it.
    g.to(CASTER);
    const advanced = unwrap(resolveTurn(g.state), 'advancing with no generator');
    g.push(advanced.events);

    expect(g.owed().some((d) => d.moment === 'start-of-turn' && d.target === MOVER)).toBe(true);
    const out = resolveAttack(g.state, MOVER, { target: THREAT, weapon: 'dagger' }, supply('a'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });
});

// — movement that never lands ————————————————————————————————————————————————

describe('only a position that actually changed is entry', () => {
  /** A declared move is an intent an Opportunity Attack can end. */
  const provoking = (): Game => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'beside threat');
    const declared = unwrap(
      resolveMove(
        g.state,
        MOVER,
        { placement: { from: { landmark: 'inside cube' }, feet: 0 } },
        supply('provoke'),
      ),
      'declaring the move',
    );
    g.push(declared.events);
    return g;
  };

  it('owes nothing while the move is only declared', () => {
    const g = provoking();
    expect(g.state.pendingMove).not.toBeNull();
    expect(g.owed()).toEqual([]);
  });

  /**
   * And a mover killed in the window never arrives, so the Grease never
   * catches them: raising at declaration would have charged a creature for
   * walking into a spell it never reached.
   */
  it('owes nothing when the mover is removed before the move completes', () => {
    const g = provoking();
    g.push(unwrap(removeCreatureEverywhere(g.state, MOVER), 'removing the mover'));
    expect(g.owed()).toEqual([]);
    expect(g.state.pendingMove).toBeNull();
  });

  /**
   * The other side: the completion path has **no generator**.
   * `declineOpportunity` finishes somebody else's declared move and cannot
   * roll a save, so the debt has to outlive the command that produced it
   * rather than being resolved on the spot or silently dropped.
   */
  it('raises the debt when a declined Opportunity Attack lets the move land', () => {
    const g = provoking();
    const grease = Object.keys(g.state.ongoing)[0]!;
    const declined = unwrap(declineOpportunity(g.state, THREAT, {}), 'declining');
    g.push(declined);

    expect(g.state.pendingMove).toBeNull();
    expect(g.owed().map((d) => d.castingId)).toEqual([grease]);
  });
});

// — several castings at once ——————————————————————————————————————————————————

describe('castings stay apart', () => {
  it('owes two debts for two castings of one spell by two casters', () => {
    const g = new Game();
    const mine = g.conjure('insect-plague', SPHERE, { slotLevel: 5, seed: 'a' });
    const theirs = g.conjure('insect-plague', SPHERE, { by: RIVAL, slotLevel: 5, seed: 'b' });
    expect(mine).not.toBe(theirs);

    g.walk(MOVER, 'inside sphere');
    expect([...g.owed()].map((d) => d.castingId).sort()).toEqual([mine, theirs].sort());
  });

  it('settles one without erasing the other', () => {
    const g = new Game();
    const mine = g.conjure('insect-plague', SPHERE, { slotLevel: 5, seed: 'a' });
    const theirs = g.conjure('insect-plague', SPHERE, { by: RIVAL, slotLevel: 5, seed: 'b' });
    g.walk(MOVER, 'inside sphere');

    const before = g.hp(MOVER);
    const batch = g.settle('both');
    expect(g.saves(batch)).toBe(2);
    expect(g.owed()).toEqual([]);
    expect(before - g.hp(MOVER)).toBeGreaterThan(0);
    expect(ongoingSpellOf(g.state, mine)).not.toBeNull();
    expect(ongoingSpellOf(g.state, theirs)).not.toBeNull();
  });

  it('keeps two different area spells apart', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'g' });
    const tentacles = g.conjure('black-tentacles', CUBE, {
      towards: TOWARDS,
      slotLevel: 4,
      seed: 'bt',
    });

    g.walk(MOVER, 'inside cube');
    expect([...g.owed()].map((d) => d.castingId).sort()).toEqual([grease, tentacles].sort());
  });
});

// — cleanup ———————————————————————————————————————————————————————————————————

describe('a casting that ends takes its debts with it', () => {
  it('forgives a debt when the casting is dispelled', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    expect(g.owed()).toHaveLength(1);

    g.push([{ type: 'spell-ended', castingId: plague, on: null, reason: 'dispelled' }]);
    expect(g.owed()).toEqual([]);
  });

  it('forgives a debt when Concentration breaks', () => {
    const g = new Game();
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.push([{ type: 'condition-applied', id: CASTER, condition: 'stunned', source: 'a blow' }]);
    expect(g.owed()).toEqual([]);
  });

  it('forgives a debt when its subject leaves the game', () => {
    const g = new Game();
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.push(unwrap(removeCreatureEverywhere(g.state, MOVER), 'removing'));
    expect(g.owed()).toEqual([]);
  });

  it('leaves no frequency stamp behind for an ended casting', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.settle('once');
    expect(JSON.stringify(g.state.areaTriggers)).toContain(plague);

    g.push([{ type: 'spell-ended', castingId: plague, on: null, reason: 'dispelled' }]);
    expect(g.state.areaTriggers).toEqual({});
    expect(g.state.owedAreaEffects).toEqual([]);
  });

  /** And the turn moves on again once the debt is gone. */
  it('does not wedge the fight when the casting ends mid-debt', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.push([{ type: 'spell-ended', castingId: plague, on: null, reason: 'dispelled' }]);
    expect(() => g.turn('after')).not.toThrow();
  });
});

// — what the effect actually does ——————————————————————————————————————————————

describe('settlement runs the spell, not a second copy of the rules', () => {
  it('deals Insect Plague damage scaled by the slot it was cast with', () => {
    const low = new Game();
    low.conjure('insect-plague', SPHERE, { slotLevel: 5, seed: 'same' });
    low.walk(MOVER, 'inside sphere');
    low.settle('same');

    const high = new Game();
    high.conjure('insect-plague', SPHERE, { slotLevel: 8, seed: 'same' });
    high.walk(MOVER, 'inside sphere');
    high.settle('same');

    expect(300 - high.hp(MOVER)).toBeGreaterThan(300 - low.hp(MOVER));
  });

  it('restrains a creature that fails against Web', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.walk(MOVER, 'inside cube');
    g.settle('web');
    expect(g.has(MOVER, 'restrained')).toBe(true);
  });

  /**
   * SRD Dispel Magic ends "any ongoing spell ... **on the target**", and a
   * creature the Web caught a minute later is exactly as caught as one it
   * caught at once. `on` therefore grows when a triggered effect leaves a
   * linked condition behind — see CLAUDE.md for the half of this that is
   * still asymmetric.
   */
  it('counts a creature the Web restrained later as one the Web is on', () => {
    const g = new Game();
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    expect(ongoingSpellsOn(g.state, MOVER)).toEqual([]);

    g.walk(MOVER, 'inside cube');
    g.settle('web');
    expect(ongoingSpellsOn(g.state, MOVER).map((o) => o.castingId)).toContain(web);
  });

  /** Black Tentacles' escape check still works on a creature it caught later. */
  it('offers the escape check to a creature the tentacles caught later', () => {
    const g = new Game();
    g.conjure('black-tentacles', CUBE, { towards: TOWARDS, slotLevel: 4 });
    g.walk(MOVER, 'inside cube');
    g.settle('tentacles');
    expect(g.has(MOVER, 'restrained')).toBe(true);
    expect(
      Object.values(g.state.timers).some((t) => t.check !== undefined),
    ).toBe(true);
  });

  it('names the casting on the event that discharges the debt', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    const settled = g.settle('roll');
    expect(
      settled.some(
        (e) => e.type === 'area-effect-settled' && (e as { castingId: string }).castingId === plague,
      ),
    ).toBe(true);
  });
});

// — retries ———————————————————————————————————————————————————————————————————

describe('a retry changes nothing the first run did not', () => {
  it('does not raise a second debt for a retried move', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube', 'm1');
    const after = g.state;

    const retry = unwrap(
      resolveMove(
        g.state,
        MOVER,
        { placement: { from: { landmark: 'inside cube' }, feet: 0 }, commandId: 'm1' },
        supply('move'),
      ),
      'retrying the move',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(g.owed()).toHaveLength(1);
  });

  it('does not settle twice', () => {
    const g = new Game();
    g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.settle('once', 's1');
    const after = g.state;
    const hurt = g.hp(MOVER);

    const retry = unwrap(settleAreaEffects(g.state, supply('once'), { commandId: 's1' }), 'retrying');
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(g.hp(MOVER)).toBe(hurt);
  });

  /** A settlement after the casting ended resurrects nothing. */
  it('does not resurrect a debt whose casting has gone', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    g.walk(MOVER, 'inside sphere');
    g.push([{ type: 'spell-ended', castingId: plague, on: null, reason: 'dispelled' }]);

    const out = unwrap(settleAreaEffects(g.state, supply('late')), 'settling nothing');
    expect(out.events).toEqual([]);
    expect(out.settled).toEqual([]);
  });

  it('refuses a settlement id reused for different work', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('once', 's1');
    const hurt = JSON.stringify(g.state.creatures);

    g.walk(MOVER, 'outside cube');
    g.walk(MOVER, 'inside cube');
    const again = settleAreaEffects(g.state, supply('again'), { commandId: 's1' });
    // A duplicate id must never deal a second, different effect under the
    // first's name — whether it is recognised as a retry or refused outright.
    if (!isErr(again)) expect(again.value.events).toEqual([]);
    expect(JSON.stringify(g.state.creatures)).toBe(hurt);
  });
});

// — replay ————————————————————————————————————————————————————————————————————

describe('replay', () => {
  it('folds at every prefix of a fight with areas in it', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2, seed: 'web' });
    g.conjure('insect-plague', SPHERE, { slotLevel: 5, seed: 'plague' });
    g.walk(MOVER, 'inside cube');
    g.settle('a');
    g.turn('t1');
    g.walk(MOVER, 'inside sphere');
    g.settle('c');
    g.foldsAtEveryPrefix();
    expect(roundTrip(g.log)).toEqual(g.state);
  });

  /** A log that discharges a debt nobody owes is a log and rules that disagree. */
  it('refuses a settlement for a debt that was never raised', () => {
    const g = new Game();
    const plague = g.conjure('insect-plague', SPHERE, { slotLevel: 5 });
    expect(() =>
      fold('seed', [
        ...g.log,
        { type: 'area-effect-settled', castingId: plague, target: MOVER, moment: 'entry' },
      ]),
    ).toThrow();
  });
});

// — the two moments are two moments ————————————————————————————————————————————

describe('the start of a turn is determined after the end that preceded it', () => {
  /**
   * Settling in order is not enough. What catches a creature **at its start**
   * has to be *worked out* from the world the previous creature's end left
   * behind, and the previous implementation computed both memberships in the
   * same fold — so a Web that the end of the turn destroyed still caught
   * somebody as their turn began.
   *
   * With no generator the engine cannot roll, so it stops between the two
   * moments and says so: the end is owed, the start has not happened.
   */
  it('does not raise a start debt until the end has been settled', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'g' });
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2, seed: 'w' });
    g.walk(MOVER, 'inside cube');
    g.settle('entry');

    // Round to the boundary where MOVER's turn ends (Grease) and begins (Web).
    g.to(MOVER);
    const advanced = unwrap(resolveTurn(g.state), 'advancing with no generator');
    g.push(advanced.events);

    // The end is owed; the start has not arrived at all.
    expect(g.owed().map((d) => d.moment)).toEqual(['end-of-turn']);
    expect(g.state.pendingTurnStart?.who).toBe(SITTER);

    // And SITTER may not act, though nothing is owed *by them* yet: whether
    // the Web catches them has not been worked out, and their budget has
    // already refreshed.
    expect(g.owed().some((d) => d.target === SITTER)).toBe(false);
    const dashed = takeDash(g.state, SITTER, {});
    expect(isErr(dashed)).toBe(true);
    if (isErr(dashed)) expect(dashed.code).toBe('area_effect_owed');

    // Settling the end is what brings the start about.
    g.settle('both', undefined, 40);
    expect(g.state.pendingTurnStart).toBeNull();
  });

  /**
   * The causal proof, and the one the correction exists for. A Grease-shaped
   * end is not enough: the end has to **change whether the start debt should
   * exist at all**. So the end of MOVER's turn dispels the Web their turn is
   * about to begin in, and the start debt must never be raised.
   *
   * Constructed rather than waited for: no two currently executed spells
   * naturally produce this, so the fixture uses the engine's own casting
   * cleanup — the same spell-ended event Dispel Magic emits.
   */
  it('never raises a start debt for a casting the end of the turn destroyed', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'g' });
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2, seed: 'w' });
    g.walk(MOVER, 'inside cube');
    g.settle('entry');

    g.to(MOVER);
    g.push(unwrap(resolveTurn(g.state), 'advancing with no generator').events);
    expect(g.state.pendingTurnStart?.who).toBe(SITTER);

    // The Web goes while the end of the turn is still being resolved.
    g.push([{ type: 'spell-ended', castingId: web, on: null, reason: 'dispelled' }]);
    // Still nothing: the end of the turn is owed and has not been settled.
    expect(g.state.pendingTurnStart?.who).toBe(SITTER);

    const batch = g.settle('end-only');
    // The Grease's end resolved; the Web's start never existed to resolve.
    expect(batch.filter((e) => e.type === 'area-effect-settled')).toHaveLength(1);
    expect(g.state.pendingTurnStart).toBeNull();
    expect(g.owed()).toEqual([]);
    expect(g.has(SITTER, 'restrained')).toBe(false);
  });

  /** And the common case still passes straight through, in one fold. */
  it('reaches the start inside the same fold when the end owes nothing', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.to(MOVER);
    expect(g.state.pendingTurnStart).toBeNull();
  });

  /** A fight that ends leaves no marker nothing could clear. */
  it('clears the marker when the combat ends', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('entry');
    g.to(MOVER);
    g.push(unwrap(resolveTurn(g.state), 'advancing').events);
    expect(g.state.pendingTurnStart).not.toBeNull();

    g.push([{ type: 'combat-ended' }]);
    expect(g.state.pendingTurnStart).toBeNull();
  });
});

// — the numbers the casting was made with ——————————————————————————————————————

describe('a spell already cast does not change when its caster does', () => {
  /**
   * The save DC is pinned at the casting. Before the correction, a later
   * trigger asked chooseRoute against the caster's **current** sheet and
   * derived the DC again — so a Wizard who re-prepared the spell off a
   * different ability, or levelled, quietly moved a Web that had been hanging
   * there for a minute.
   *
   * Observed on the escape check the Web hangs, whose DC is the spell save DC
   * written down when the condition was created.
   */
  it('keeps the save DC the Web was conjured with', () => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });

    // Level 11, Wisdom 18: 8 + 4 + 4.
    const pinned = 16;

    // The caster's spellcasting is re-declared off a different ability. A DC
    // re-derived now would be 8 + 4 + 0.
    g.push([
      {
        type: 'spellcasting-declared',
        id: CASTER,
        spellcasting: declaredCasting({ ability: 'int', prepared: PREPARED }),
      },
    ]);

    g.walk(MOVER, 'inside cube');
    g.settle('web');
    expect(g.has(MOVER, 'restrained')).toBe(true);

    const dcs = Object.values(g.state.timers)
      .map((timer) => timer.check?.dc)
      .filter((dc): dc is number => dc !== undefined);
    expect(dcs).toContain(pinned);
    expect(dcs).not.toContain(12);
  });

  it('writes those numbers into the record at the casting', () => {
    const g = new Game();
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    expect(ongoingSpellOf(g.state, web)?.numbers).toEqual({
      saveDc: 16,
      attackModifier: 8,
      spellcastingModifier: 4,
      casterLevel: 11,
    });
  });

  /**
   * SRD Grease has no Concentration and a duration of a minute: it runs
   * whether or not the wizard does. A save it calls for afterwards is still
   * owed, and forgiving it because the DC could not be recovered would be the
   * engine losing a rule to its own bookkeeping.
   */
  it('still rolls a Grease save after its caster has left the game', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.to(MOVER);
    g.push(unwrap(removeCreatureEverywhere(g.state, CASTER), 'removing the caster'));
    expect(g.state.creatures[CASTER]).toBeUndefined();

    g.walk(MOVER, 'inside cube');
    expect(g.owed()).toHaveLength(1);

    const batch = g.settle('orphaned');
    expect(batch.some((e) => e.type === 'roll-recorded')).toBe(true);
    expect(g.has(MOVER, 'prone')).toBe(true);
  });

  /**
   * And the branch that cannot be resolved without a sheet is unreachable
   * through content rather than merely unlikely: every area trigger that can
   * outlive its caster is a bare saving throw.
   */
  it('leaves no caster-outliving trigger that needs the caster to roll', () => {
    const orphanable = SPELL_DEFINITIONS.filter(
      (d) => d.areaTrigger !== undefined && !d.concentration,
    );
    expect(orphanable.length).toBeGreaterThan(0);
    for (const definition of orphanable) {
      expect(definition.areaTrigger?.effects.map((e) => e.kind)).toEqual(
        definition.areaTrigger?.effects.map(() => 'save'),
      );
    }
  });
});

// — every path that spends something ————————————————————————————————————————————

describe('a creature owing a mandatory effect may take no action at all', () => {
  /** A creature whose turn has begun inside a Web, with the save unrolled. */
  const owingAtStart = (): Game => {
    const g = new Game();
    g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.walk(MOVER, 'inside cube');
    g.settle('entry', undefined, 40);
    g.to(CASTER);
    g.push(unwrap(resolveTurn(g.state), 'advancing with no generator').events);
    return g;
  };

  it('really does owe a start-of-turn effect in this fixture', () => {
    const g = owingAtStart();
    expect(g.state.combat?.order[g.state.combat.turnIndex]?.id).toBe(MOVER);
    expect(g.owed().some((d) => d.moment === 'start-of-turn' && d.target === MOVER)).toBe(true);
  });

  const refuses = (out: Result<unknown>): void => {
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  };

  it('refuses Dash', () => refuses(takeDash(owingAtStart().state, MOVER, {})));
  it('refuses Disengage', () => refuses(takeDisengage(owingAtStart().state, MOVER, {})));
  it('refuses Dodge', () => refuses(takeDodge(owingAtStart().state, MOVER, {})));
  it('refuses Ready', () =>
    refuses(
      takeReady(owingAtStart().state, MOVER, { trigger: 'when it moves', response: { kind: 'action' } }, SRD_CONTENT),
    ));
  it('refuses activating a feature', () =>
    refuses(activateFeature(owingAtStart().state, MOVER, { feature: 'test:stance' })));

  /**
   * **After the duplicate check, never before it.** A retry arrives at the
   * world its own first run made — here, at a Web debt its own move raised —
   * and must report the duplicate rather than the guard.
   */
  it('lets a retried Dash through as a duplicate rather than refusing it', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.to(MOVER);
    g.push(unwrap(takeDash(g.state, MOVER, { commandId: 'd1' }), 'dashing'));
    g.walk(MOVER, 'inside cube');
    expect(g.owed()).toHaveLength(1);

    const retry = takeDash(g.state, MOVER, { commandId: 'd1' });
    expect(isErr(retry)).toBe(false);
    if (!isErr(retry)) expect(retry.value).toEqual([]);
  });

  /** The turn still refuses globally: a debt must not be carried into one. */
  it('refuses to advance the turn for anybody', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    const out = resolveTurn(g.state, supply('t'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });
});

// — Grease knocks you down and does not hold you there ————————————————————————

describe('a condition a casting caused and does not keep', () => {
  /**
   * SRD Grease: "or have the Prone condition", and nothing more. Prone ends
   * when the creature stands up — not when the grease dries. Linking it to the
   * casting made the engine lift it on the casting's own cleanup, which is a
   * rule the book does not have.
   */
  it('leaves the creature Prone after the Grease has ended', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('slip');
    expect(g.has(MOVER, 'prone')).toBe(true);

    g.push([{ type: 'spell-ended', castingId: grease, on: null, reason: 'dispelled' }]);
    expect(ongoingSpellOf(g.state, grease)).toBeNull();
    expect(g.has(MOVER, 'prone')).toBe(true);
  });

  /** And the Grease is not *on* them, so a Dispel Magic aimed there finds it not. */
  it('is not on the creature it knocked over', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('slip');
    expect(g.has(MOVER, 'prone')).toBe(true);
    expect(spellOn(g.state, ongoingSpellOf(g.state, grease)!)).toEqual([]);
    expect(ongoingSpellsOn(g.state, MOVER)).toEqual([]);
  });

  /**
   * The casting path as well as the trigger path. Conjuring the grease under
   * somebody's feet goes through the spell's own effects rather than its area
   * trigger, and the two must agree about who owns the Prone.
   */
  it('leaves a creature Prone when the Grease was conjured under them', () => {
    const g = new Game([...SETUP, place(RIDER, 'inside cube')], false);
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    expect(g.has(RIDER, 'prone')).toBe(true);

    // Not on them — Dispel Magic aimed at a greased creature finds no Grease.
    expect(spellOn(g.state, ongoingSpellOf(g.state, grease)!)).toEqual([]);
    expect(ongoingSpellsOn(g.state, RIDER)).toEqual([]);

    g.push([{ type: 'spell-ended', castingId: grease, on: null, reason: 'dispelled' }]);
    expect(g.has(RIDER, 'prone')).toBe(true);
  });

  /** The log still says what caused it. */
  it('records the spell that caused it', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    g.settle('slip');
    const instances = g.state.creatures[MOVER]?.conditions.instances ?? [];
    expect(instances.some((i) => i.source === 'Grease')).toBe(true);
  });

  /**
   * And the spells that genuinely *do* sustain their condition are untouched:
   * Web's Restrained ends with the Web, because SRD says it lasts while you
   * are in the webs.
   */
  it('still takes a Web’s Restrained away with the Web', () => {
    const g = new Game();
    const web = g.conjure('web', CUBE, { towards: TOWARDS, slotLevel: 2 });
    g.walk(MOVER, 'inside cube');
    g.settle('web');
    expect(g.has(MOVER, 'restrained')).toBe(true);

    g.push([{ type: 'spell-ended', castingId: web, on: null, reason: 'dispelled' }]);
    expect(g.has(MOVER, 'restrained')).toBe(false);
  });
});

// — one debt, one discharge ————————————————————————————————————————————————————

describe('a settlement discharges exactly the debt it names', () => {
  /**
   * The settlement event names a casting, a creature and a moment, and not
   * the turn. That is unambiguous because the guards make at most one debt per
   * (casting, creature, moment) outstanding at a time — a second move is
   * refused, and the turn cannot advance past one — so two debts that share
   * all three are two identical debts, and discharging either is discharging
   * that one.
   *
   * Proved by writing the impossible log by hand: two Grease entries with
   * nothing settled between them, which no command can produce.
   */
  it('discharges two identical debts one at a time', () => {
    const g = new Game([...SETUP], false);
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    for (const to of ['inside cube', 'outside cube', 'inside cube']) {
      g.push([{ type: 'creature-moved', id: MOVER, placement: { from: { landmark: to }, feet: 0 } }]);
    }
    expect(g.owed()).toHaveLength(2);

    const batch = g.settle('both');
    expect(batch.filter((e) => e.type === 'area-effect-settled')).toHaveLength(2);
    expect(g.owed()).toEqual([]);
  });

  /** And a settlement for a debt of a different casting leaves this one alone. */
  it('discharges only its own casting’s debt', () => {
    const g = new Game();
    const grease = g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1, seed: 'g' });
    const tentacles = g.conjure('black-tentacles', CUBE, {
      towards: TOWARDS,
      slotLevel: 4,
      seed: 'bt',
    });
    g.walk(MOVER, 'inside cube');
    expect(g.owed()).toHaveLength(2);

    g.push([
      { type: 'spell-ended', castingId: grease, on: null, reason: 'dispelled' },
    ]);
    expect([...g.owed()].map((d) => d.castingId)).toEqual([tentacles]);
  });

  /** A log with two debts in it still folds at every prefix. */
  it('folds at every prefix with several debts outstanding', () => {
    const g = new Game([...SETUP], false);
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    for (const to of ['inside cube', 'outside cube', 'inside cube']) {
      g.push([{ type: 'creature-moved', id: MOVER, placement: { from: { landmark: to }, feet: 0 } }]);
    }
    g.settle('both');
    g.foldsAtEveryPrefix();
    expect(roundTrip(g.log)).toEqual(g.state);
  });
});

// — the corrections, adversarially ————————————————————————————————————————————

describe('a hit still due at the boundary happens before the start is worked out', () => {
  /**
   * Scheduled damage is the other end-of-turn consequence the engine holds as
   * state — SRD Acid Arrow's "2d4 at the end of its next turn" — and it can
   * kill the very caster whose area the next creature is about to start their
   * turn in. Reaching the start before collecting it would ask whether
   * somebody is caught by a Web the boundary was about to destroy.
   */
  it('does not reach the start while a scheduled hit is still due', () => {
    const g = new Game([...SETUP], false);
    const web = g.conjure('web', CUBE, { by: RIVAL, towards: TOWARDS, slotLevel: 2, seed: 'w' });
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 30, speed: 400 },
          { id: MOVER, initiative: 20, speed: 400 },
        ],
      },
    ]);
    g.walk(MOVER, 'inside cube');
    g.settle('entry', undefined, 40);

    // RIVAL is one hit from dropping, and a hit falls due as CASTER's turn
    // ends — the same boundary at which MOVER's turn begins inside the Web.
    g.push([
      { type: 'damage-taken', id: RIVAL, amount: 299, source: 'the fixture' },
      {
        type: 'damage-scheduled',
        schedule: {
          target: RIVAL,
          by: CASTER,
          deadline: { kind: 'turn-end', of: CASTER, count: 1 },
          notation: '8d10',
          damageType: 'acid',
          source: 'a fixture#cast:99',
          label: 'the acid',
        },
      },
    ]);

    g.to(CASTER);
    g.turn('boundary');

    // The acid dropped RIVAL, the Concentration broke, the Web ended — and
    // MOVER, whose turn began inside it, was never caught.
    expect(ongoingSpellOf(g.state, web)).toBeNull();
    expect(g.has(MOVER, 'restrained')).toBe(false);
    expect(g.owed()).toEqual([]);
    expect(g.state.pendingTurnStart).toBeNull();
  });
});

describe('every guarded command checks the duplicate first', () => {
  /**
   * The trap this repository has sprung five times: a state guard above the
   * replay check tells a retry about the world its own first run made. Every
   * command that gained the area guard is swept rather than one of them being
   * spot-checked.
   */
  const RETRIES: readonly {
    readonly name: string;
    readonly run: (g: Game, commandId: string) => Result<unknown>;
  }[] = [
    { name: 'takeDash', run: (g, commandId) => takeDash(g.state, MOVER, { commandId }) },
    { name: 'takeDisengage', run: (g, commandId) => takeDisengage(g.state, MOVER, { commandId }) },
    { name: 'takeDodge', run: (g, commandId) => takeDodge(g.state, MOVER, { commandId }) },
    {
      name: 'takeReady',
      run: (g, commandId) =>
        takeReady(g.state, MOVER, { trigger: 'when it moves', response: { kind: 'action' }, commandId }, SRD_CONTENT),
    },
    {
      name: 'activateFeature',
      run: (g, commandId) => activateFeature(g.state, MOVER, { feature: 'test:stance', commandId }),
    },
  ];

  for (const entry of RETRIES) {
    it(entry.name + ': a retry reports the duplicate rather than the debt it raised', () => {
      const g = new Game();
      g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
      g.to(MOVER);

      const first = entry.run(g, 'c1');
      expect(isErr(first)).toBe(false);
      if (isErr(first)) return;
      g.push(first.value as readonly GameEvent[]);

      // The mover then walks into the Grease and owes a save.
      g.walk(MOVER, 'inside cube');
      expect(g.owed()).toHaveLength(1);

      const retry = entry.run(g, 'c1');
      expect(isErr(retry)).toBe(false);
      if (!isErr(retry)) expect(retry.value).toEqual([]);
    });
  }
});

// — why the debt is global ————————————————————————————————————————————————————

describe('an owed area effect is unresolved state everybody acts into', () => {
  /**
   * The counterexample that made this global, three moves long and every move
   * an existing mechanic:
   *
   * 1. CASTER concentrates on Hold Person, and MOVER is Paralyzed by it.
   * 2. CASTER walks into RIVAL's Insect Plague and owes its damage.
   * 3. RIDER attacks MOVER.
   *
   * Settling step 2 can drop CASTER, break the Concentration and free MOVER —
   * so step 3 is an attack against a creature who may already be free.
   * Attacking a Paralyzed creature within 5 feet is not a small difference:
   * the roll has Advantage and a hit is an automatic Critical Hit.
   *
   * The engine does not work out whether a given action happens to be
   * independent. It settles the mandatory mechanical fact first.
   */
  const entangled = (): Game => {
    const g = new Game([...SETUP], false);
    // RIVAL's swarm, conjured before the fight so one slot a turn is not the
    // thing under test.
    g.conjure('insect-plague', SPHERE, { by: RIVAL, slotLevel: 5, seed: 'swarm' });
    g.push([
      { type: 'sight-declared', from: CASTER, to: MOVER, seen: true },
      place(RIDER, 'beside mover'),
      { type: 'items-gained', id: RIDER, items: [{ id: 'dagger', quantity: 1 }], source: 'kit' },
    ]);

    // CASTER holds MOVER while there are no turns to spend.
    const held = unwrap(
      resolveSpell(
        g.state,
        CASTER,
        { spellId: 'hold-person', targets: [MOVER], slotLevel: 2 },
        supply('hold'),
      ),
      'hold person',
    );
    g.push(held.events);

    // RIDER goes first, so the creature that owes the swarm is not the
    // creature trying to act — which is the whole point.
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: RIDER, initiative: 30, speed: 30 },
          { id: CASTER, initiative: 20, speed: 30 },
          { id: MOVER, initiative: 10, speed: 30 },
        ],
      },
    ]);

    // Something shoves CASTER into the swarm on RIDER's turn. Forced movement
    // costs no Speed and belongs to nobody's budget, so it lands here.
    const shoved = unwrap(
      resolveMove(
        g.state,
        CASTER,
        { placement: { from: { landmark: 'inside sphere' }, feet: 0 }, forced: true },
        supply('shove'),
      ),
      'shoving the caster into the swarm',
    );
    g.push(shoved.events);
    return g;
  };

  it('sets the fixture up: MOVER is Paralyzed and CASTER owes the swarm', () => {
    const g = entangled();
    expect(g.has(MOVER, 'paralyzed')).toBe(true);
    expect(g.owed().map((d) => d.target)).toEqual([CASTER]);
  });

  /** Step 3, before settlement: refused, though RIDER owes nothing at all. */
  it('refuses a third creature’s attack on the creature the Hold Person holds', () => {
    const g = entangled();
    expect(g.owed().some((d) => d.target === RIDER)).toBe(false);

    const out = resolveAttack(g.state, RIDER, { target: MOVER, weapon: 'dagger' }, supply('swing'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('area_effect_owed');
  });

  /**
   * And the mechanics really do differ, which is the whole point. The same
   * attack, from the same seed, against the same creature: **Advantage while
   * the Hold Person holds, and none once the swarm has broken it.**
   */
  it('rolls a different attack depending on what settling the debt did', () => {
    // The Concentration survives: CASTER is at full health and makes the save.
    const holds = entangled();
    holds.settle('swarm', undefined, 40);
    expect(holds.has(MOVER, 'paralyzed')).toBe(true);
    const withHold = unwrap(
      resolveAttack(holds.state, RIDER, { target: MOVER, weapon: 'dagger' }, supply('swing')),
      'attacking a held creature',
    );

    // The Concentration breaks: CASTER is one hit point from dropping, and the
    // swarm's 4d10 is certain to take it.
    const breaks = entangled();
    breaks.push([{ type: 'damage-taken', id: CASTER, amount: 299, source: 'the fixture' }]);
    breaks.settle('swarm');
    expect(breaks.has(MOVER, 'paralyzed')).toBe(false);
    const without = unwrap(
      resolveAttack(breaks.state, RIDER, { target: MOVER, weapon: 'dagger' }, supply('swing')),
      'attacking a freed creature',
    );

    expect(withHold.attack?.mode).toBe('advantage');
    expect(without.attack?.mode).toBe('normal');
  });

  /** Step 7: once settled, the third creature acts against a decided world. */
  it('lets the attack through once the debt is settled', () => {
    const g = entangled();
    g.settle('swarm', undefined, 40);
    expect(g.owed()).toEqual([]);
    const out = resolveAttack(g.state, RIDER, { target: MOVER, weapon: 'dagger' }, supply('swing'));
    expect(isErr(out)).toBe(false);
  });

  /**
   * And the settlement itself is never refused by its own guard. A policy that
   * blocked the command that clears it would be a deadlock wearing a rule's
   * clothes.
   */
  it('never refuses the settlement that clears it', () => {
    const g = entangled();
    expect(isErr(settleAreaEffects(g.state, supply('swarm')))).toBe(false);
  });
});

// — the audit, enforced ————————————————————————————————————————————————————————

describe('no ordinary voluntary action crosses an outstanding area effect', () => {
  /**
   * A sweep rather than a test each, for the reason the idempotency sweep
   * exists: the point is that **no** command is exempt, so one added without
   * the guard fails here rather than being found in play.
   *
   * Every entry is invoked in a state where a Grease owes MOVER a save. Some
   * of them would also fail for a second reason — a feature nobody has, a
   * pool that does not exist — and that is deliberate: the guard sits directly
   * after the duplicate check and before every lookup, so it is what answers.
   */
  const owing = (): GameState => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    expect(g.owed()).toHaveLength(1);
    return g.state;
  };

  const ACTING: readonly {
    readonly name: string;
    readonly run: (state: GameState) => Result<unknown>;
  }[] = [
    {
      name: 'resolveAttack',
      run: (state) => resolveAttack(state, MOVER, { target: THREAT, weapon: 'dagger' }, supply('a')),
    },
    {
      name: 'resolveMove',
      run: (state) =>
        resolveMove(state, MOVER, { placement: { from: { landmark: 'outside cube' }, feet: 0 } }, supply('m')),
    },
    {
      name: 'resolveSpell',
      run: (state) =>
        resolveSpell(state, CASTER, { spellId: 'bless', targets: [RIVAL], slotLevel: 1 }, supply('c')),
    },
    {
      name: 'activateSpell',
      run: (state) => activateSpell(state, CASTER, { castingId: 'cast:1', targets: [] }, supply('v')),
    },
    { name: 'takeDash', run: (state) => takeDash(state, MOVER, {}) },
    { name: 'takeDisengage', run: (state) => takeDisengage(state, MOVER, {}) },
    { name: 'takeDodge', run: (state) => takeDodge(state, MOVER, {}) },
    {
      name: 'takeReady',
      run: (state) =>
        takeReady(state, MOVER, { trigger: 'when it moves', response: { kind: 'action' } }, SRD_CONTENT),
    },
    {
      name: 'activateFeature',
      run: (state) => activateFeature(state, MOVER, { feature: 'test:stance' }),
    },
    {
      name: 'useHealingTouch',
      run: (state) => useHealingTouch(state, MOVER, { feature: 'test:none', target: THREAT }),
    },
    { name: 'useSelfHeal', run: (state) => useSelfHeal(state, MOVER, { feature: 'test:none' }, supply('h')) },
    { name: 'useRecovery', run: (state) => useRecovery(state, MOVER, { feature: 'test:none' }, supply('r')) },
    {
      name: 'resolveEffectCheck',
      run: (state) => resolveEffectCheck(state, MOVER, { effectKey: 'none' }, supply('e')),
    },
    { name: 'resolveTurn', run: (state) => resolveTurn(state, supply('t')) },
  ];

  for (const entry of ACTING) {
    it(entry.name + ' refuses while an area effect is owed', () => {
      const out = entry.run(owing());
      expect(isErr(out)).toBe(true);
      if (isErr(out)) expect(out.code).toBe('area_effect_owed');
    });
  }

  /**
   * And the commands that **close** open state are not guarded, or the engine
   * would deadlock on its own policy: the settlement itself, and the Reaction
   * answers that close a window somebody else opened.
   */
  it('never refuses the settlement that clears the debt', () => {
    expect(isErr(settleAreaEffects(owing(), supply('s')))).toBe(false);
  });

  it('lets a declined Opportunity Attack close its window', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'beside threat');
    const declared = unwrap(
      resolveMove(
        g.state,
        MOVER,
        { placement: { from: { landmark: 'inside cube' }, feet: 0 } },
        supply('provoke'),
      ),
      'declaring',
    );
    g.push(declared.events);
    // The move landed and raised the debt; the window it opened must still be
    // answerable, or the fight cannot continue.
    if (g.state.pendingMove === null) {
      expect(g.owed()).toHaveLength(1);
      return;
    }
    expect(isErr(declineOpportunity(g.state, THREAT, {}))).toBe(false);
  });
});

// — the two halves of the policy are two halves ————————————————————————————————

describe('an un-arrived start blocks its own creature and nobody else', () => {
  /**
   * The area debt is global because settling it can change the world anybody
   * would act into. \`pendingTurnStart\` is **not**, and the difference is that
   * nothing has been raised yet: what is unresolved is whether *this* creature
   * is about to be caught, and their budget has already refreshed. No mechanic
   * makes that somebody else's problem.
   *
   * Reaching the state takes a hand-written boundary: the marker only outlives
   * its own fold while something the end still owes is outstanding, and the
   * case with no area debt at all is a scheduled hit due at that moment.
   */
  const midBoundary = (): GameState => {
    const g = new Game([...SETUP], false);
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 30, speed: 30 },
          { id: MOVER, initiative: 20, speed: 30 },
        ],
      },
      {
        type: 'damage-scheduled',
        schedule: {
          target: THREAT,
          by: CASTER,
          deadline: { kind: 'turn-end', of: CASTER, count: 1 },
          notation: '1d4',
          damageType: 'acid',
          source: 'a fixture#cast:99',
          label: 'the acid',
        },
      },
      // Written by hand: advancing properly would collect the hit in the same
      // breath, and the point is to stand between the two moments.
      { type: 'turn-advanced' },
    ]);
    return g.state;
  };

  it('holds the start open while a scheduled hit is still due', () => {
    const state = midBoundary();
    expect(state.pendingTurnStart?.who).toBe(MOVER);
    expect(state.owedAreaEffects).toEqual([]);
  });

  it('refuses the creature whose start has not arrived', () => {
    const refused = mayAct(midBoundary(), MOVER);
    expect(refused).not.toBeNull();
    if (refused !== null) expect(refused.code).toBe('area_effect_owed');
  });

  it('lets anybody else act', () => {
    expect(mayAct(midBoundary(), CASTER)).toBeNull();
    expect(mayAct(midBoundary(), THREAT)).toBeNull();
  });

  /** And an owed area effect stops all three, which is the other half. */
  it('stops everybody once an area actually owes something', () => {
    const g = new Game();
    g.conjure('grease', CUBE, { towards: TOWARDS, slotLevel: 1 });
    g.walk(MOVER, 'inside cube');
    for (const who of [MOVER, CASTER, THREAT]) {
      const refused = mayAct(g.state, who);
      expect(refused).not.toBeNull();
      if (refused !== null) expect(refused.code).toBe('area_effect_owed');
    }
  });
});
