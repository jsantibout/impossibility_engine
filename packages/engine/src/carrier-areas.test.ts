import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
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
import { areaStampKey, type AreaMoment } from './spells.js';
import {
  endConcentration,
  ongoingSpellOf,
  ongoingSpellsOn,
  owedAreaEffectsOf,
  removeCreatureEverywhere,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  type MoveResolution,
} from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A persistent area whose origin is a creature's live position.
 *
 * SRD's glossary decides the whole architecture in one sentence:
 *
 * > "An Emanation **moves with the creature or object that is its origin**
 * > unless it is an instantaneous or a stationary effect."
 *
 * So the carrier-bound area is not a Spirit Guardians special case — it is
 * what an Emanation *is*. The counterpart to Moonbeam, and the two differ in
 * the cause of motion rather than in the consequence:
 *
 * | | Where the area is | What moves it | Moment raised |
 * |---|---|---|---|
 * | Moonbeam | a point the casting keeps | `spell-origin-moved` | `area-moved` |
 * | Spirit Guardians | the caster, wherever they are | the **caster's** position changing | `area-moved` |
 *
 * **Nothing is stored and nothing is synchronised.** `area.origin: 'self'` on
 * the definition and `caster` on the ongoing record were both already there;
 * a copied point would be a second answer to "where is the aura" that the
 * first forgotten update would leave stale.
 *
 * And a carrier walking is emphatically **not** the creature entering: SRD
 * writes "whenever the Emanation enters a creature's space" separately from
 * "whenever a creature enters the Emanation", and a creature standing still
 * has done neither one of them nor the other.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const RIVAL = id('rival');
/** Huge, and carries an Emanation that therefore reaches much further. */
const GIANT = id('giant');
/** Stands still while the aura is walked onto them. */
const VICTIM = id('victim');
/** Stands still further east: only a Huge carrier's Emanation reaches them. */
const FAR = id('far');
/** Designated unaffected at the casting. */
const ALLY = id('ally');
/** Walks into a stationary aura, which is the creature-side clause. */
const WALKER = id('walker');
/** Large, and carries the cleric about. */
const HORSE = id('horse');
/** Thirty feet from the giant's step: only a Huge carrier's Emanation reaches. */
const OUTPOST = id('outpost');
/** Immune to Radiant, so which damage type landed is observable. */
const WARDED = id('warded');
/** A second mount and rider, whose movement is nobody else's business. */
const PONY = id('pony');
const PAGE = id('page');

const PREPARED = ['spirit-guardians', 'moonbeam', 'web'];

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
  // Declared allegiance, so a test can prove the engine ignores it when the
  // caster designates somebody explicitly.
  side: who === CLERIC || who === ALLY || who === HORSE ? 'party' : 'foes',
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

const supply = (seed = 'aura', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

/**
 * The lane the cleric walks down, measured against the engine's own ruler.
 *
 * A 15-foot Emanation on a **Medium** carrier standing at x = 300 covers
 * x ∈ [285, 315] and excludes the carrier's own space. On a **Huge** carrier
 * it covers x ∈ [285, 325], because SRD measures an Emanation from the whole
 * creature and a Huge creature's footprint is fifteen feet across.
 *
 * | | x | Medium carrier at 300 | Medium at 305 | Huge at 300 |
 * |---|---|---|---|---|
 * | `VICTIM` | 320 | outside | **inside** | **inside** |
 * | `FAR` | 325 | outside | outside | **inside** |
 *
 * So one five-foot step east catches `VICTIM` and nobody else, and swapping a
 * Medium carrier for a Huge one catches `FAR` without anybody moving at all.
 */
const LANE = 300;
/** The giant's own lane, well clear of everything the cleric does. */
const GIANT_LANE = 100;
const CLERIC_AT: Point = { x: 300, y: LANE, z: 0 };
const ONE_STEP_EAST: Point = { x: 305, y: LANE, z: 0 };
const VICTIM_AT: Point = { x: 320, y: LANE, z: 0 };
const FAR_AT: Point = { x: 325, y: LANE, z: 0 };
/** Inside the aura from the start, and never designated. */
const WALKER_START: Point = { x: 360, y: LANE, z: 0 };
const WALKER_INSIDE: Point = { x: 315, y: LANE, z: 0 };
const ALLY_AT: Point = { x: 310, y: LANE, z: 0 };

const place = (who: CharacterId, at: Point, size?: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0, ...(size === undefined ? {} : { size })  } as never,
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(RIVAL),
  added(GIANT),
  added(OUTPOST),
  added(VICTIM),
  added(FAR),
  added(ALLY),
  added(WALKER),
  added(HORSE),
  added(PONY),
  added(PAGE),
  ...casts(CLERIC),
  ...casts(RIVAL),
  ...casts(GIANT),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(CLERIC, CLERIC_AT),
  place(VICTIM, VICTIM_AT),
  place(FAR, FAR_AT),
  place(ALLY, ALLY_AT),
  place(WALKER, WALKER_START),
  place(RIVAL, { x: 300, y: LANE + 200, z: 0 }),
  place(GIANT, { x: 300, y: GIANT_LANE, z: 0 }, 'huge'),
  place(OUTPOST, { x: 330, y: GIANT_LANE, z: 0 }),
  place(HORSE, { x: 300, y: LANE + 5, z: 0 }, 'large'),
  place(PONY, { x: 500, y: LANE + 200, z: 0 }, 'large'),
  place(PAGE, { x: 500, y: LANE + 200, z: 0 }),
];

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 30, speed: 60 },
      { id: WALKER, initiative: 20, speed: 400 },
      { id: VICTIM, initiative: 10, speed: 60 },
      { id: HORSE, initiative: 5, speed: 60 },
      { id: PONY, initiative: 2, speed: 60 },
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

  /** Cast a spell, and hand back the casting id. */
  cast(
    spellId: string,
    options: {
      readonly by?: CharacterId;
      readonly at?: Point;
      readonly unaffected?: readonly CharacterId[];
      readonly damageType?: string;
      readonly seed?: string;
    } = {},
  ): string {
    const by = options.by ?? CLERIC;
    const out = unwrap(
      resolveSpell(
        this.state,
        by,
        {
          spellId,
          targets: [],
          ...(options.at === undefined ? {} : { at: options.at }),
          ...(options.unaffected === undefined ? {} : { unaffected: options.unaffected }),
          ...(options.damageType === undefined
            ? spellId === 'spirit-guardians'
              ? { damageType: 'radiant' }
              : {}
            : { damageType: options.damageType }),
        },
        supply(options.seed ?? spellId),
      ),
      `${by} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId;
  }

  castResult(spellId: string, request: Record<string, unknown> = {}): Result<unknown> {
    return resolveSpell(
      this.state,
      CLERIC,
      { spellId, targets: [], ...request } as never,
      supply('try'),
    );
  }

  to(who: CharacterId): this {
    this.fight();
    for (let n = 0; n < 14; n += 1) {
      const combat = this.state.combat;
      if (combat === null) return this;
      if (combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(`to-${who}-${n}`);
    }
    throw new Error(`never reached ${who}'s turn`);
  }

  /** Move a creature, without keeping the result. */
  moveTo(
    who: CharacterId,
    to: Point,
    options: { readonly forced?: boolean; readonly commandId?: string } = {},
  ): Result<MoveResolution> {
    return resolveMove(
      this.state,
      who,
      {
        placement: { from: { point: to }, feet: 0 },
        ...(options.forced === true ? { forced: true as const } : {}),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply('move'),
    );
  }

  /**
   * …and keep what it produced, rounding to the mover's own turn first.
   *
   * Forced movement is somebody else's doing and happens on whatever turn is
   * running, which is how a creature can be shoved out of an aura and back in
   * during the turn the aura arrived.
   */
  walk(who: CharacterId, to: Point, options: Parameters<Game['moveTo']>[2] = {}): MoveResolution {
    if (options.forced !== true) this.to(who);
    const out = unwrap(this.moveTo(who, to, options), `${who} moving`);
    this.push(out.events);
    return out;
  }

  mountUp(rider: CharacterId, mount: CharacterId): void {
    this.push([{ type: 'mounted', rider, mount, willing: true }]);
  }

  settle(seed = 'settle', flat = -40): readonly GameEvent[] {
    const out = unwrap(settleAreaEffects(this.state, supply(seed, flat), {}), 'settling');
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
    return this.owed().map((o) => o.target).sort();
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

/** What a batch of events says the areas settled, as `moment:target` pairs. */
const settledIn = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((e) => (e.type === 'area-effect-settled' ? [`${e.moment}:${e.target}`] : []));

/** A fight with Spirit Guardians up, on the cleric's turn. */
const withAura = (
  options: { readonly unaffected?: readonly CharacterId[] } = {},
): { readonly game: Game; readonly aura: string } => {
  const game = new Game();
  const aura = game.cast('spirit-guardians', options);
  game.fight().to(CLERIC);
  return { game, aura };
};

// — the definition is the SRD's, clause by clause ——————————————————————————————

describe('Spirit Guardians is transcribed, not approximated', () => {
  const definition = SPELL_DEFINITIONS.find((d) => d.id === 'spirit-guardians')!;

  it('is a 15-foot Emanation originating from the caster', () => {
    expect(definition.area).toEqual({ kind: 'emanation', distance: 15, origin: 'self' });
  });

  it('prints all three trigger clauses and the cap that spans them', () => {
    expect(definition.areaTrigger).toMatchObject({
      onAreaEntry: true,
      onEntry: 'every-entry',
      at: 'end-of-turn',
      oncePerTurn: true,
    });
  });

  /**
   * **There is no initial-appearance clause, and that is the text.** Moonbeam
   * prints "When the Cylinder appears, each creature in it makes a
   * Constitution saving throw" and Cloudkill "Each creature in the Sphere
   * makes a Constitution saving throw". Spirit Guardians prints no such
   * sentence at all: its three triggers are the Emanation entering a space, a
   * creature entering the Emanation, and a creature ending its turn there.
   *
   * So the casting resolves nothing, exactly as Web's does, and a creature
   * standing beside the cleric when the spirits appear waits for one of the
   * three — which for a creature that stays put is the end of its own turn.
   */
  it('resolves nothing at the casting, because the book names no such moment', () => {
    expect(definition.effects).toEqual([]);
  });

  it('catches nobody standing beside the caster when it is cast', () => {
    const game = new Game();
    game.cast('spirit-guardians');
    expect(game.owed()).toEqual([]);
    expect(game.hp(ALLY)).toBe(MAX_HP);
  });

  it('is the only carried area in the catalogue so far', () => {
    const carried = SPELL_DEFINITIONS.filter(
      (d) => d.areaTrigger?.onAreaEntry === true && d.area?.origin === 'self',
    );
    expect(carried.map((d) => d.id)).toEqual(['spirit-guardians']);
  });
});

// — the origin is derived, never stored ————————————————————————————————————————

describe('a carried area is read off the caster, not off a copied point', () => {
  it('records no point at all', () => {
    const { game, aura } = withAura();
    expect(ongoingSpellOf(game.state, aura)?.origin).toBeUndefined();
  });

  /** The aura is wherever the cleric is now, which is the only fact there is. */
  it('reaches whoever the caster is currently beside', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.caught()).toEqual([VICTIM]);
  });

  it('reaches nobody new when the caster has not moved', () => {
    const { game } = withAura();
    expect(game.owed()).toEqual([]);
  });

  /**
   * **A Huge carrier's Emanation is far bigger, and that is SRD.** An
   * Emanation "extends in straight lines from a creature ... in all
   * directions", so it starts at the carrier's boundary rather than at one
   * corner cube. `FAR` stands twenty-five feet from the giant's anchor and is
   * caught by a fifteen-foot Emanation; from a Medium carrier at the same
   * anchor they would not be.
   */
  it('measures from the whole of a Huge carrier, not from its anchor', () => {
    const game = new Game();
    game.cast('spirit-guardians', { by: GIANT, seed: 'giant' });
    // Shoved one space east, in its own lane and outside Initiative: what is
    // under test is the geometry, not the economy.
    game.walk(GIANT, { x: 305, y: GIANT_LANE, z: 0 }, { forced: true });
    expect(game.caught()).toEqual([OUTPOST]);
  });

  /**
   * The control that makes the number mean something: `OUTPOST` stands **30
   * feet** from the anchor both carriers step to, and a fifteen-foot Emanation
   * reaches it only because a Huge creature is fifteen feet across. A Medium
   * carrier taking the identical step reaches fifteen feet and no further —
   * `FAR`, at twenty-five, is outside.
   */
  it('would not reach nearly so far from a Medium carrier', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.caught()).toEqual([VICTIM]);
    expect(game.caught()).not.toContain(FAR);
  });
});

// — carrier movement is area movement ——————————————————————————————————————————

describe('a carrier walking is the area arriving, not the creature entering', () => {
  it('raises the arrival against the creature that stood still', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.owed()).toEqual([
      expect.objectContaining({ target: VICTIM, moment: 'area-moved' }),
    ]);
  });

  it('never calls it that creature’s entry', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.owed().filter((o) => o.moment === 'entry')).toEqual([]);
  });

  /** `byCreatureEntry` is the field Web's cap reads, and this must not set it. */
  it('stamps the turn without recording a creature entry', () => {
    const { game, aura } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.state.areaTriggers[areaStampKey(aura, VICTIM)]).toEqual({
      turn: expect.any(Number),
      byCreatureEntry: false,
    });
  });

  it('settles through the spell the casting was made with', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    expect(game.hp(VICTIM)).toBeLessThan(MAX_HP);
  });

  /** Inside before and inside after: the aura did not arrive, it stayed. */
  it('owes nothing to a creature the aura was already on', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    const before = game.hp(VICTIM);
    game.walk(CLERIC, { x: 310, y: LANE, z: 0 }); // one more space, still on VICTIM
    game.settle('again');
    expect(game.hp(VICTIM)).toBe(before);
  });

  /** And leaving is not arriving. */
  it('owes nothing to a creature the aura moved off', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    game.walk(CLERIC, CLERIC_AT); // one space back west; VICTIM is outside again
    game.walk(CLERIC, { x: 295, y: LANE, z: 0 });
    expect(game.caught()).not.toContain(VICTIM);
  });

  /**
   * SRD's glossary: "An Emanation's origin (creature or object) **isn't
   * included in the area of effect** unless its creator decides otherwise."
   * A cleric walking Spirit Guardians across a room is never hurt by it, which
   * matters more here than for any point-origin area — the carrier is inside
   * their own shape by construction, every single step.
   */
  it('never catches the carrier in their own Emanation', () => {
    const { game } = withAura();
    const before = game.hp(CLERIC);
    for (let x = 305; x <= 320; x += 5) {
      game.walk(CLERIC, { x, y: LANE, z: 0 });
      game.settle(`step-${x}`);
    }
    expect(game.caught()).not.toContain(CLERIC);
    expect(game.hp(CLERIC)).toBe(before);
  });

  it('never catches the carrier at the end of their own turn either', () => {
    const { game } = withAura();
    const before = game.hp(CLERIC);
    expect(settledIn(game.turn()).some((s) => s.endsWith(CLERIC))).toBe(false);
    expect(game.hp(CLERIC)).toBe(before);
  });

  it('owes nothing when the carrier moves through empty ground', () => {
    const { game } = withAura();
    game.walk(CLERIC, { x: 300, y: LANE - 5, z: 0 });
    expect(game.owed()).toEqual([]);
  });
});

// — the other two clauses still belong to themselves ————————————————————————————

describe('a stationary aura catches people the old ways', () => {
  it('catches a creature that walks into it, as an entry', () => {
    const { game } = withAura();
    game.walk(WALKER, WALKER_INSIDE);
    expect(game.owed()).toEqual([
      expect.objectContaining({ target: WALKER, moment: 'entry' }),
    ]);
  });

  /**
   * A creature the aura arrived on during somebody else's turn has not entered
   * anything and has not ended a turn there yet; the boundary is the clause
   * that collects it when its own turn comes round.
   */
  it('catches a creature that ends its turn in it, as the boundary', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST); // the aura arrives on VICTIM
    game.settle();
    game.to(VICTIM);
    expect(settledIn(game.turn('victim-turn'))).toContain(`end-of-turn:${VICTIM}`);
  });

  it('does not also call a walk-in an area arrival', () => {
    const { game } = withAura();
    game.walk(WALKER, WALKER_INSIDE);
    expect(game.owed().filter((o) => o.moment === 'area-moved')).toEqual([]);
  });
});

// — the cap that spans all three ———————————————————————————————————————————————

describe('a creature makes this save only once per turn', () => {
  /**
   * SRD Spirit Guardians ends its long sentence with "A creature makes this
   * save only once per turn", and the sentence before it names three clauses.
   * So one stamp, keyed by casting and creature, bars every one of them.
   */
  it('does not catch a creature twice when the aura arrives and it re-enters', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST); // the aura arrives on VICTIM
    game.settle();
    const hurt = game.hp(VICTIM);

    // Shoved out and straight back in, on the cleric's own turn.
    game.walk(VICTIM, { x: 340, y: LANE, z: 0 }, { forced: true });
    game.walk(VICTIM, VICTIM_AT, { forced: true });
    expect(game.owed()).toEqual([]);
    expect(game.hp(VICTIM)).toBe(hurt);
  });

  it('does not catch a creature twice when it enters and then ends its turn there', () => {
    const { game } = withAura();
    game.walk(WALKER, WALKER_INSIDE); // WALKER's own turn: entry
    game.settle();
    const hurt = game.hp(WALKER);
    const ending = game.turn(); // …and that same turn ends inside
    expect(settledIn(ending)).toEqual([]);
    expect(game.hp(WALKER)).toBe(hurt);
  });

  it('permits it again on a later turn', () => {
    const { game } = withAura();
    game.walk(WALKER, WALKER_INSIDE);
    game.settle();
    const hurt = game.hp(WALKER);
    game.turn(); // WALKER's turn ends, capped
    game.to(WALKER); // round to their next turn
    game.turn('next'); // …which ends inside the aura
    expect(game.hp(WALKER)).toBeLessThan(hurt);
  });

  /** Web's narrower cap is untouched: it bars a second *entry*, not everything. */
  it('leaves Web capping only the entering', () => {
    const web = SPELL_DEFINITIONS.find((d) => d.id === 'web')!;
    expect(web.areaTrigger?.onEntry).toBe('first-per-turn');
    expect(web.areaTrigger?.oncePerTurn).toBeUndefined();
  });
});

// — riders and mounts ——————————————————————————————————————————————————————————

describe('a carrier carried by something else still carries its aura', () => {
  const mounted = () => {
    const game = new Game();
    const aura = game.cast('spirit-guardians');
    game.fight();
    game.mountUp(CLERIC, HORSE);
    game.to(HORSE);
    return { game, aura };
  };

  /**
   * **Read the position that changed, never the id on the event.** A cleric
   * riding a horse moves on a `creature-moved` that names only the horse, and
   * an implementation matching `event.id` against the casting's caster would
   * leave the aura behind — the same bug the creature-side detector learned
   * about from a mounted fixture.
   */
  it('moves the aura when the mount moves', () => {
    const { game } = mounted();
    game.walk(HORSE, { x: 305, y: LANE + 5, z: 0 });
    expect(game.caught()).toContain(VICTIM);
  });

  it('records it as the area arriving, not as anybody entering', () => {
    const { game } = mounted();
    game.walk(HORSE, { x: 305, y: LANE + 5, z: 0 });
    expect(game.owed()).toHaveLength(1);
    expect(game.owed().every((o) => o.moment === 'area-moved')).toBe(true);
  });

  /** A different pair's movement is nobody else's aura's business. */
  it('leaves another creature’s aura alone when an unrelated mount moves', () => {
    const { game } = mounted();
    game.to(PONY);
    game.push([{ type: 'mounted', rider: PAGE, mount: PONY, willing: true }]);
    game.walk(PONY, { x: 505, y: LANE + 200, z: 0 });
    expect(game.owed()).toEqual([]);
  });
});

// — the route a coarse carrier move does not establish ——————————————————————————

describe('a carrier move longer than one space is a question, not a guess', () => {
  /**
   * **The same hole Moonbeam's route had, arriving from the other side.** The
   * cleric asks to cross the room; the aura comes with them because SRD says
   * an Emanation moves with its origin; and the engine knows two endpoints and
   * no route. The creatures it would sweep over did nothing at all, so
   * executing the move and quietly missing them is the worst of the three
   * available answers.
   *
   * A move of one space has no space in between. Anything longer asks — and
   * asking is a collaboration boundary, not a refusal: nothing is spent and
   * the same move re-sent as single steps is the move the player meant.
   */
  const coarse = () => {
    const { game } = withAura();
    return { game, out: game.moveTo(CLERIC, { x: 330, y: LANE, z: 0 }) };
  };

  it('asks rather than refusing', () => {
    const { out } = coarse();
    expect(isNeedsContext(out)).toBe(true);
    // The same code the area's own side of this question carries — one
    // question asked from two directions, so a caller branches once.
    expect(isErr(out) ? out.code : 'not asked').toBe('route_required');
  });

  it('names the casting, both ends and what to send instead', () => {
    const { out } = coarse();
    const request = contextRequestsOf(out)[0];
    expect(request?.kind).toBe('route');
    expect(request?.need).toMatch(/\(300, 300, 0\)/);
    expect(request?.need).toMatch(/\(330, 300, 0\)/);
    expect(request?.need).toMatch(/Spirit Guardians/);
    expect(request?.satisfyWith).toMatch(/one space/);
  });

  it('spends no movement and moves nobody', () => {
    const { game } = withAura();
    const budget = JSON.stringify(game.state.combat?.budgets);
    const before = game.log.length;
    game.moveTo(CLERIC, { x: 330, y: LANE, z: 0 });
    expect(JSON.stringify(game.state.combat?.budgets)).toBe(budget);
    expect(game.log).toHaveLength(before);
    expect(game.owed()).toEqual([]);
  });

  it('takes a single step without asking anything', () => {
    const { game } = withAura();
    expect(isErr(game.moveTo(CLERIC, ONE_STEP_EAST))).toBe(false);
  });

  /** Segmented movement is the answer, and the engine already had it. */
  it('crosses the room as single steps, catching each creature as it reaches them', () => {
    const { game } = withAura();
    const reached: string[] = [];
    for (let x = 305; x <= 330; x += 5) {
      game.walk(CLERIC, { x, y: LANE, z: 0 });
      reached.push(...settledIn(game.settle(`step-${x}`)));
    }
    expect(reached).toContain(`area-moved:${VICTIM}`);
    expect(reached).toContain(`area-moved:${FAR}`);
  });

  /** A creature not carrying a watched area moves as far as it likes. */
  it('lets an ordinary creature cross the room in one move', () => {
    const { game } = withAura();
    game.to(WALKER);
    expect(isErr(game.moveTo(WALKER, { x: 380, y: LANE + 100, z: 0 }))).toBe(false);
  });

  /** And so does the cleric, once the aura is gone. */
  it('lets the carrier cross once the spell has ended', () => {
    const { game } = withAura();
    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'ending it'));
    expect(isErr(game.moveTo(CLERIC, { x: 330, y: LANE, z: 0 }))).toBe(false);
  });
});

// — designated unaffected ——————————————————————————————————————————————————————

describe('the creatures the caster designated unaffected', () => {
  /**
   * SRD: "When you cast this spell, you can designate creatures to be
   * unaffected by it." A choice, made once, about creatures — never a
   * question about sides, which the SRD does not ask here and the engine must
   * not answer on the caster's behalf.
   */
  it('never catches a designated creature the aura moves onto', () => {
    const { game } = withAura({ unaffected: [VICTIM] });
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.owed()).toEqual([]);
    expect(game.hp(VICTIM)).toBe(MAX_HP);
  });

  it('never catches a designated creature that walks in', () => {
    const { game } = withAura({ unaffected: [WALKER] });
    game.walk(WALKER, WALKER_INSIDE);
    expect(game.owed()).toEqual([]);
  });

  it('never catches a designated creature at the end of its turn', () => {
    const { game } = withAura({ unaffected: [WALKER] });
    game.walk(WALKER, WALKER_INSIDE);
    expect(settledIn(game.turn())).toEqual([]);
  });

  /**
   * **Explicit designation beats allegiance, in both directions.** An ally
   * nobody designated is caught; an enemy the cleric designated is spared.
   * Substituting `side` would be the engine answering the question the caster
   * was asked.
   */
  it('catches an ally the caster did not designate', () => {
    const { game } = withAura();
    expect(game.state.creatures[ALLY]?.side).toBe('party');
    game.walk(CLERIC, { x: 300, y: LANE, z: 0 }); // no move; prove by the walk below
    game.walk(WALKER, { x: 310, y: LANE + 5, z: 0 });
    expect(game.caught()).toContain(WALKER);
  });

  it('spares an enemy the caster did designate', () => {
    const { game } = withAura({ unaffected: [VICTIM] });
    expect(game.state.creatures[VICTIM]?.side).toBe('foes');
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.caught()).not.toContain(VICTIM);
  });

  /** The choice was made at the casting, so it outlives every later move. */
  it('keeps sparing them however far the aura travels', () => {
    const { game } = withAura({ unaffected: [VICTIM, FAR] });
    for (let x = 305; x <= 330; x += 5) {
      game.walk(CLERIC, { x, y: LANE, z: 0 });
    }
    expect(game.owed()).toEqual([]);
    expect(game.hp(VICTIM)).toBe(MAX_HP);
    expect(game.hp(FAR)).toBe(MAX_HP);
  });

  it('is recorded on the casting, sorted, so a replay reproduces it', () => {
    const { game, aura } = withAura({ unaffected: [FAR, VICTIM] });
    expect(ongoingSpellOf(fold('seed', game.log), aura)?.unaffected).toEqual([FAR, VICTIM]);
  });

  it('refuses a creature nobody has heard of', () => {
    const game = new Game();
    const out = game.castResult('spirit-guardians', {
      damageType: 'radiant',
      unaffected: [id('nobody')],
    });
    expect(isErr(out) ? out.code : 'ok').toBe('unknown_creature');
  });

  it('refuses the whole idea for a spell that prints no such clause', () => {
    const game = new Game();
    const out = game.castResult('moonbeam', {
      at: { x: 320, y: LANE, z: 0 },
      unaffected: [ALLY],
    });
    expect(isErr(out) ? out.code : 'ok').toBe('no_designation');
  });
});

// — the damage type the engine will not guess ——————————————————————————————————

describe('a damage type the SRD decides on a fact the engine does not hold', () => {
  /**
   * SRD: "3d8 Radiant damage (**if you are good or neutral**) or 3d8 Necrotic
   * damage (**if you are evil**)." Alignment is a fact the engine holds for a
   * character it built from choices and for nobody else — not for a monster,
   * not for a declared NPC cleric — and side, class and deity are none of
   * them alignment. So it is stated at the casting and pinned there.
   */
  it('refuses a casting that does not say which', () => {
    const game = new Game();
    const out = game.castResult('spirit-guardians');
    expect(isErr(out) ? out.code : 'ok').toBe('damage_type_required');
  });

  it('refuses one the spell does not print', () => {
    const game = new Game();
    const out = game.castResult('spirit-guardians', { damageType: 'fire' });
    expect(isErr(out) ? out.code : 'ok').toBe('unknown_damage_type');
  });

  it('refuses naming one for a spell that prints a single type', () => {
    const game = new Game();
    const out = game.castResult('moonbeam', {
      at: { x: 320, y: LANE, z: 0 },
      damageType: 'necrotic',
    });
    expect(isErr(out) ? out.code : 'ok').toBe('damage_type_fixed');
  });

  it('pins what was stated on the casting', () => {
    const { game, aura } = withAura();
    expect(ongoingSpellOf(game.state, aura)?.damageType).toBe('radiant');
  });

  /**
   * **A damage type is only observable against a creature that has defences.**
   * An undefended dummy takes the same number from Radiant and Necrotic alike,
   * which is how a mutation discarding the stated type would pass a whole
   * file. `WARDED` is immune to Radiant, so the two castings are told apart by
   * what actually lands, and nothing else about them differs.
   */
  const withWarded = (damageType: string) => {
    const game = new Game();
    game.push([
      {
        type: 'creature-added',
        id: WARDED,
        name: WARDED,
        sheet: sheet(),
        maxHp: MAX_HP,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'foes',
        defenses: { radiant: { immune: true } },
      },
      place(WARDED, { x: 320, y: LANE + 5, z: 0 }),
    ]);
    game.cast('spirit-guardians', { damageType });
    game.fight().to(CLERIC);
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    return game;
  };

  it('bounces off a creature immune to the type that was stated', () => {
    expect(withWarded('radiant').hp(WARDED)).toBe(MAX_HP);
  });

  it('hurts that same creature when the other type was stated', () => {
    expect(withWarded('necrotic').hp(WARDED)).toBeLessThan(MAX_HP);
  });

  it('costs nothing to be refused', () => {
    const game = new Game();
    const before = game.state;
    game.castResult('spirit-guardians');
    expect(game.state).toEqual(before);
  });
});

// — castings stay apart ————————————————————————————————————————————————————————

describe('two carried auras are two castings', () => {
  const twoAuras = () => {
    const game = new Game();
    const mine = game.cast('spirit-guardians', { seed: 'a' });
    const theirs = game.cast('spirit-guardians', { by: RIVAL, seed: 'b', unaffected: [VICTIM] });
    game.fight();
    // Bring the rival up the lane beside the cleric.
    game.push([
      { type: 'creature-unplaced', id: RIVAL },
      place(RIVAL, { x: 300, y: LANE + 40, z: 0 }),
    ]);
    game.to(CLERIC);
    return { game, mine, theirs };
  };

  it('raises the arrival against the casting whose carrier moved', () => {
    const { game, mine } = twoAuras();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(owedAreaEffectsOf(game.state).map((o) => o.castingId)).toEqual([mine]);
  });

  it('lets each exempt a different creature', () => {
    const { game, theirs } = twoAuras();
    expect(ongoingSpellOf(game.state, theirs)?.unaffected).toEqual([VICTIM]);
    expect(ongoingSpellOf(game.state, game.state.ongoing['cast:1']!.castingId)?.unaffected).toBeUndefined();
  });

  it('keeps a separate per-turn stamp for each', () => {
    const { game, mine, theirs } = twoAuras();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    expect(game.state.areaTriggers[areaStampKey(mine, VICTIM)]).toBeDefined();
    expect(game.state.areaTriggers[areaStampKey(theirs, VICTIM)]).toBeUndefined();
  });
});

// — a point-origin area is untouched ———————————————————————————————————————————

describe('an area that keeps a point does not follow anybody', () => {
  it('leaves Moonbeam where it was when its caster walks', () => {
    const game = new Game();
    const beam = game.cast('moonbeam', { at: { x: 340, y: LANE, z: 0 } });
    game.fight().to(CLERIC);
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(ongoingSpellOf(game.state, beam)?.origin).toEqual({ x: 340, y: LANE, z: 0 });
  });

  it('raises nothing for a creature standing still while the caster walks', () => {
    const game = new Game();
    game.cast('moonbeam', { at: { x: 360, y: LANE, z: 0 } });
    game.fight().to(CLERIC);
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.owed()).toEqual([]);
  });

  it('lets the caster of a point-origin area cross the room in one move', () => {
    const game = new Game();
    game.cast('moonbeam', { at: { x: 360, y: LANE, z: 0 } });
    game.fight().to(CLERIC);
    expect(isErr(game.moveTo(CLERIC, { x: 240, y: LANE, z: 0 }))).toBe(false);
  });

  it.each([['web'], ['grease'], ['insect-plague'], ['black-tentacles'], ['moonbeam']])(
    'leaves %s a point-origin area',
    (spellId) => {
      expect(SPELL_DEFINITIONS.find((d) => d.id === spellId)?.area?.origin).toBe('point');
    },
  );

  it('leaves Spiritual Weapon a point rather than a carried area', () => {
    const weapon = SPELL_DEFINITIONS.find((d) => d.id === 'spiritual-weapon')!;
    expect(weapon.area).toBeUndefined();
    expect(weapon.origin?.reach).toBe(5);
  });
});

// — what the casting is on ——————————————————————————————————————————————————————

describe('a Range Self spell is on its caster and on nobody it hurts', () => {
  it('is on the caster, where Dispel Magic looks', () => {
    const { game, aura } = withAura();
    expect(ongoingSpellsOn(game.state, CLERIC).map((r) => r.castingId)).toContain(aura);
  });

  it('does not become “on” a creature it damaged', () => {
    const { game, aura } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    expect(spellOn(game.state, ongoingSpellOf(game.state, aura)!)).toEqual([CLERIC]);
    expect(ongoingSpellsOn(game.state, VICTIM)).toEqual([]);
  });

  it('does not grow stale as creatures move in and out', () => {
    const { game, aura } = withAura();
    game.walk(WALKER, WALKER_INSIDE);
    game.settle();
    game.walk(WALKER, WALKER_START);
    expect(spellOn(game.state, ongoingSpellOf(game.state, aura)!)).toEqual([CLERIC]);
  });
});

// — cleanup ————————————————————————————————————————————————————————————————————

describe('a carried area ends with its casting, through the one door', () => {
  it('leaves nothing behind when Concentration ends', () => {
    const { game, aura } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'ending it'));

    expect(ongoingSpellOf(game.state, aura)).toBeNull();
    expect(game.owed()).toEqual([]);
    expect(JSON.stringify(game.state.areaTriggers)).not.toContain(aura);
  });

  /**
   * **The fold still drops it, and the command can no longer get there.**
   *
   * `releaseCasting` takes the casting's outstanding `OwedAreaEffect`s with
   * everything else it owns, which is what this has always asserted — and is
   * exactly why `endConcentration` is now guarded by `mayAct` (IE-057), as
   * `endOngoingSpell` already was. A caster who could let go while the debt
   * stood would forgive a save the boundary had already raised.
   *
   * So the claim is made of the two halves separately: the command is refused
   * `area_effect_owed`, and the event it would have written is pushed to reach
   * the reducer's behaviour directly. A test that reached it through the
   * command would now be asserting the hole rather than the rule.
   */
  it('drops a debt the aura raised but nobody settled', () => {
    const { game, aura } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(game.owed()).toHaveLength(1);

    const refused = endConcentration(game.state, CLERIC, 'voluntary');
    expect(isErr(refused) ? refused.code : 'ok').toBe('area_effect_owed');

    game.push([{ type: 'concentration-ended', id: CLERIC, castingId: aura, reason: 'voluntary' }]);
    expect(game.owed()).toEqual([]);
  });

  it('holds nothing after the whole log is replayed', () => {
    const { game, aura } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'ending it'));
    // Everything but the tombstone: `castingsEnded` mentions the casting on
    // purpose, so a later record naming it is refused as a corrupt log.
    expect(JSON.stringify({ ...fold('seed', game.log), castingsEnded: [] })).not.toContain(aura);
  });

  /**
   * **A carrier who has left does not leave the aura hanging in the air.**
   * Membership is asked of the carrier's live position, so a carrier with no
   * position has an area that catches nobody — rather than one frozen at the
   * last place they stood, which is what a copied point would have given.
   */
  it('catches nobody once the carrier is gone from the scene', () => {
    const { game } = withAura();
    game.push(unwrap(removeCreatureEverywhere(game.state, CLERIC), 'removing the cleric'));
    game.walk(WALKER, WALKER_INSIDE);
    expect(game.owed()).toEqual([]);
  });

  it('folds at every prefix of the log', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    game.turn();
    game.foldsAtEveryPrefix();
  });
});

// — replay and retry ———————————————————————————————————————————————————————————

describe('replay and retry', () => {
  it('reconstructs the debt a carrier’s step raised', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    expect(owedAreaEffectsOf(fold('seed', game.log))).toEqual(owedAreaEffectsOf(game.state));
  });

  it('reaches the same areas from a different seed', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST);
    game.settle();
    const area = (s: GameState) => ({
      ongoing: s.ongoing,
      owed: s.owedAreaEffects,
      stamps: s.areaTriggers,
      creatures: s.creatures,
    });
    expect(area(fold('other-seed', game.log))).toEqual(area(fold('seed', game.log)));
  });

  it('does not move the carrier twice, nor raise the arrival twice', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST, { commandId: 'step' });
    const again = unwrap(game.moveTo(CLERIC, ONE_STEP_EAST, { commandId: 'step' }), 'retrying');
    expect(again.events).toEqual([]);
    expect(game.owed()).toHaveLength(1);
  });

  it('refuses the same id for a different destination', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST, { commandId: 'step' });
    game.settle();
    expect(isErr(game.moveTo(CLERIC, { x: 310, y: LANE, z: 0 }, { commandId: 'step' }))).toBe(true);
  });

  /** The route question is asked before the duplicate check has anything to say. */
  it('recognises a duplicate before asking for a route', () => {
    const { game } = withAura();
    game.walk(CLERIC, ONE_STEP_EAST, { commandId: 'step' });
    const again = game.moveTo(CLERIC, ONE_STEP_EAST, { commandId: 'step' });
    expect(isNeedsContext(again)).toBe(false);
  });
});
