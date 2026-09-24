import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
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
import { lightAt, type Point } from './positioning.js';
import {
  activateSpell,
  ongoingSpellOf,
  owedAreaEffectsOf,
  resolveSpell,
  resolveTurn,
  type SpellResolution,
} from './commands.js';

/**
 * A trigger measured from the casting's **point**, and a point rolled into
 * somebody's space.
 *
 * SRD Flaming Sphere, the two sentences nothing could say:
 *
 * > "Any creature that **ends its turn within 5 feet of the sphere** makes a
 * > Dexterity saving throw, taking 2d6 Fire damage on a failed save or half as
 * > much damage on a successful one."
 * > "As a Bonus Action, you can move the sphere up to 30 feet, rolling it along
 * > the ground. If you move the sphere **into a creature's space**, that
 * > creature makes the save against the sphere, and the sphere stops moving for
 * > the turn."
 *
 * Three facts about one point, and the engine had a template for all of them:
 *
 * | Sentence | What it reads |
 * |---|---|
 * | the five feet that burn | `AreaTrigger.within`, measured from the point |
 * | the twenty feet it lights | `area` and `areaLight` — Dancing Lights' reading |
 * | the space it is rolled into | `AreaTrigger.onPointEntry` |
 *
 * **The three must not be one number.** A trigger that fired over the lit
 * volume would burn everything within twenty feet; a ram that fired over the
 * burning radius would catch a goblin the sphere merely rolled past, which the
 * book does not say and the end of that goblin's turn already covers.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
/** Five feet from the sphere: inside the reach that burns. */
const BESIDE = id('beside');
/** Ten feet from the sphere: outside it, and lit all the same. */
const AWAY = id('away');
/** Stands beside the lane, so the sphere rolls past without entering. */
const PASSED = id('passed');
/** Stands in the lane the sphere is rolled down. */
const IN_THE_WAY = id('in-the-way');
/** Stands beyond them, and is never reached once the sphere stops. */
const BEYOND = id('beyond');

const PREPARED = ['flaming-sphere', 'moonbeam'];

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

const MAX_HP = 400;

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: MAX_HP,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
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

/** Every save fails by default, so a trigger that fired is a trigger that shows. */
const supply = (seed = 'sphere', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

/**
 * The lane, worked out against the engine's own ruler.
 *
 * The sphere sits at x = 300 on the lane y = 300, fifty feet from the druid —
 * inside Flaming Sphere's Range of sixty. "Within 5 feet" is the origin space
 * and the ring around it, so x = 305 is in and x = 310 is out; `AWAY` is
 * placed off the lane so that rolling the sphere east never touches them.
 */
const LANE = 300;
const DRUID_AT: Point = { x: 250, y: LANE, z: 0 };
const SPHERE: Point = { x: 300, y: LANE, z: 0 };
const BESIDE_AT: Point = { x: 300, y: LANE + 5, z: 0 };
const AWAY_AT: Point = { x: 300, y: LANE + 10, z: 0 };
/** Beside the lane, so the sphere passes within five feet and never enters. */
const PASSED_AT: Point = { x: 310, y: LANE + 5, z: 0 };
const IN_THE_WAY_AT: Point = { x: 315, y: LANE, z: 0 };
const BEYOND_AT: Point = { x: 325, y: LANE, z: 0 };

/** Thirty feet east, one space at a time. */
const ROLL_EAST: Point = { x: 330, y: LANE, z: 0 };
const ROLL_VIA: readonly Point[] = [
  { x: 305, y: LANE, z: 0 },
  { x: 310, y: LANE, z: 0 },
  { x: 315, y: LANE, z: 0 },
  { x: 320, y: LANE, z: 0 },
  { x: 325, y: LANE, z: 0 },
];

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(BESIDE),
  added(AWAY),
  added(PASSED),
  added(IN_THE_WAY),
  added(BEYOND),
  ...casts(DRUID),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(DRUID, DRUID_AT),
  place(BESIDE, BESIDE_AT),
  place(AWAY, AWAY_AT),
  place(PASSED, PASSED_AT),
  place(IN_THE_WAY, IN_THE_WAY_AT),
  place(BEYOND, BEYOND_AT),
];

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 30, speed: 30 },
      { id: BESIDE, initiative: 20, speed: 30 },
      { id: AWAY, initiative: 10, speed: 30 },
      { id: IN_THE_WAY, initiative: 5, speed: 30 },
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

  conjure(spellId: string, at: Point, seed = spellId): string {
    const out = unwrap(
      resolveSpell(this.state, DRUID, { spellId, targets: [], at }, supply(seed)),
      `casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  roll(
    castingId: string,
    to: Point,
    options: { readonly via?: readonly Point[]; readonly seed?: string } = {},
  ): Result<SpellResolution> {
    return activateSpell(
      this.state,
      DRUID,
      { castingId, targets: [], to, ...(options.via === undefined ? {} : { via: options.via }) },
      supply(options.seed ?? 'roll'),
    );
  }

  rolled(castingId: string, to: Point, options: Parameters<Game['roll']>[2] = {}) {
    const out = unwrap(this.roll(castingId, to, options), 'rolling the sphere');
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

  turn(seed = 'turn'): readonly GameEvent[] {
    this.fight();
    const out = unwrap(resolveTurn(this.state, supply(seed)), 'advancing the turn');
    this.push(out.events);
    return out.events;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  owed(): readonly { readonly target: string }[] {
    return owedAreaEffectsOf(this.state);
  }

  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

/** Who a batch of events says the sphere caught, in the order it reached them. */
const caught = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((e) => (e.type === 'area-effect-settled' ? [e.target] : []));

/** Where a batch of events says the sphere went, in order. */
const legsIn = (events: readonly GameEvent[]): readonly Point[] =>
  events.flatMap((e) => (e.type === 'spell-origin-moved' ? [e.to] : []));

// — the definition says what the book says ——————————————————————————————————

describe('the clause is the spell’s, not the mechanism’s', () => {
  const sphere = SPELL_DEFINITIONS.find((d) => d.id === 'flaming-sphere');

  it('measures the burn from the point and the light over the area', () => {
    expect(sphere?.areaTrigger?.within).toBe(5);
    expect(sphere?.area).toEqual({ kind: 'sphere', radius: 20, origin: 'point' });
    expect(sphere?.areaLight).toEqual({ level: 'bright', dimBeyond: 20 });
  });

  /**
   * **A neighbouring spell's moving-area clause lends this one nothing, and
   * the reverse.** Moonbeam catches whoever its area sweeps over; the sphere
   * catches only whoever it is rolled into. Each spell prints one of those
   * sentences and neither prints both.
   */
  it('gives the sphere the ram and the beam the sweep', () => {
    expect(sphere?.areaTrigger?.onPointEntry).toBe(true);
    expect(sphere?.areaTrigger?.onAreaEntry).toBeUndefined();

    const moonbeam = SPELL_DEFINITIONS.find((d) => d.id === 'moonbeam');
    expect(moonbeam?.areaTrigger?.onAreaEntry).toBe(true);
    expect(moonbeam?.areaTrigger?.onPointEntry).toBeUndefined();
  });

  /** Every other persistent area measures over its template, as it always did. */
  it('leaves every other area measuring over its own template', () => {
    for (const definition of SPELL_DEFINITIONS) {
      if (definition.id === 'flaming-sphere') continue;
      expect(definition.areaTrigger?.within, definition.id).toBeUndefined();
      expect(definition.areaTrigger?.onPointEntry, definition.id).toBeUndefined();
    }
  });
});

// — the five feet that burn ——————————————————————————————————————————————————

describe('a creature that ends its turn within 5 feet of the sphere', () => {
  const lit = (): { readonly game: Game; readonly sphere: string } => {
    const game = new Game();
    const sphere = game.conjure('flaming-sphere', SPHERE);
    game.fight();
    return { game, sphere };
  };

  /** Nobody is caught by the casting: the sphere simply appears, as Web does. */
  it('burns nobody at the cast', () => {
    const { game } = lit();
    expect(game.owed()).toEqual([]);
    expect(game.hp(BESIDE)).toBe(MAX_HP);
  });

  it('burns the creature beside it when that creature’s turn ends', () => {
    const { game } = lit();
    const events = game.to(BESIDE).turn('beside-ends');
    expect(caught(events)).toContain(BESIDE);
    expect(game.hp(BESIDE)).toBeLessThan(MAX_HP);
  });

  /**
   * And not the creature ten feet away, who is standing squarely inside the
   * twenty feet the sphere *lights*. The two numbers are the test: an
   * implementation that fired over the area would burn this one.
   */
  it('does not burn the creature ten feet away', () => {
    const { game } = lit();
    game.to(AWAY).turn('away-ends');
    expect(game.hp(AWAY)).toBe(MAX_HP);
  });

  /** A save made is half the damage rather than none — an ordinary save for half. */
  it('halves the damage on a made save', () => {
    const game = new Game();
    game.conjure('flaming-sphere', SPHERE);
    game.fight().to(BESIDE);
    const out = unwrap(resolveTurn(game.state, supply('made', +40)), 'advancing the turn');
    game.push(out.events);
    expect(game.hp(BESIDE)).toBeLessThan(MAX_HP);
  });
});

// — the twenty feet it lights ————————————————————————————————————————————————

describe('the light the sphere sheds', () => {
  it('is bright over its own area and dim for twenty feet beyond', () => {
    const game = new Game();
    game.conjure('flaming-sphere', SPHERE);
    expect(lightAt(game.state, SPHERE).level).toBe('bright');
    expect(lightAt(game.state, { x: 315, y: LANE, z: 0 }).level).toBe('bright');
    expect(lightAt(game.state, { x: 335, y: LANE, z: 0 }).level).toBe('dim');
    expect(lightAt(game.state, { x: 365, y: LANE, z: 0 }).level).toBeNull();
  });

  /** And it travels with the sphere, as Dancing Lights' motes do. */
  it('is laid again wherever the sphere is rolled', () => {
    const game = new Game();
    const sphere = game.conjure('flaming-sphere', SPHERE);
    // Thirty feet east of where the sphere starts: dim now, and bright once
    // the sphere has been rolled fifteen feet towards it.
    const ahead: Point = { x: 330, y: LANE, z: 0 };
    expect(lightAt(game.state, ahead).level).toBe('dim');

    game.fight().to(DRUID);
    game.rolled(sphere, ROLL_EAST, { via: ROLL_VIA });
    expect(lightAt(game.state, ahead).level).toBe('bright');
  });
});

// — the space it is rolled into ——————————————————————————————————————————————

describe('a sphere rolled into a creature’s space', () => {
  const ready = (): { readonly game: Game; readonly sphere: string } => {
    const game = new Game();
    const sphere = game.conjure('flaming-sphere', SPHERE);
    game.fight().to(DRUID);
    return { game, sphere };
  };

  it('spends a Bonus Action and moves the point', () => {
    const { game, sphere } = ready();
    game.rolled(sphere, { x: 310, y: LANE, z: 0 }, { via: [{ x: 305, y: LANE, z: 0 }] });
    expect(game.state.combat?.budgets[DRUID]?.bonusAction).toBe(false);
  });

  /**
   * Thirty feet of rolling crosses five spaces, and what is in them is not
   * something the engine may decide. The same question Moonbeam's sweep asks,
   * asked by the clause that narrows it.
   */
  it('asks for the route a thirty-foot roll took', () => {
    const { game, sphere } = ready();
    const out = game.roll(sphere, ROLL_EAST);
    expect(isNeedsContext(out)).toBe(true);
  });

  it('catches the creature whose space it enters', () => {
    const { game, sphere } = ready();
    const out = game.rolled(sphere, ROLL_EAST, { via: ROLL_VIA });
    expect(caught(out.events)).toEqual([IN_THE_WAY]);
    expect(game.hp(IN_THE_WAY)).toBeLessThan(MAX_HP);
  });

  /**
   * **And stops there.** SRD: "the sphere stops moving for the turn." The legs
   * beyond the creature are not travelled, so the point is left in the space
   * it hit somebody in and `BEYOND` is never reached.
   */
  it('stops moving for the turn', () => {
    const { game, sphere } = ready();
    const out = game.rolled(sphere, ROLL_EAST, { via: ROLL_VIA });
    expect(legsIn(out.events)).toEqual([
      { x: 305, y: LANE, z: 0 },
      { x: 310, y: LANE, z: 0 },
      IN_THE_WAY_AT,
    ]);
    expect(ongoingSpellOf(game.state, sphere)?.origin).toEqual(IN_THE_WAY_AT);
    expect(game.hp(BEYOND)).toBe(MAX_HP);
    expect(out.unverified.join(' ')).toContain('stopped there');
  });

  /**
   * **Rolling past somebody is not rolling into them.** `PASSED` stands five
   * feet off the lane, so a leg of the route ends adjacent to them and their
   * space is never entered — the end of their own turn is the sentence that
   * burns them, and it has not come yet. An implementation that read the ram
   * over the burning radius would catch them here and again at the boundary.
   */
  it('does not catch the creature it merely rolls past', () => {
    const { game, sphere } = ready();
    const out = game.rolled(sphere, ROLL_EAST, { via: ROLL_VIA });
    expect(caught(out.events)).not.toContain(PASSED);
    expect(game.hp(PASSED)).toBe(MAX_HP);
  });

  /** A roll longer than thirty feet is refused, as the beam's is. */
  it('refuses a roll beyond the thirty feet the book prints', () => {
    const { game, sphere } = ready();
    const out = game.roll(sphere, { x: 340, y: LANE, z: 0 }, { via: [...ROLL_VIA, ROLL_EAST] });
    expect(isErr(out) ? out.code : 'ok').toBe('origin_too_far');
  });

  /** Derived from the log alone, like everything else the fold raises. */
  it('folds to the same state from the log alone', () => {
    const { game, sphere } = ready();
    game.rolled(sphere, ROLL_EAST, { via: ROLL_VIA });
    game.to(BESIDE).turn('beside-ends');
    expect(fold('seed', JSON.parse(JSON.stringify(game.log)) as GameEvent[])).toEqual(game.state);
    game.foldsAtEveryPrefix();
  });
});
