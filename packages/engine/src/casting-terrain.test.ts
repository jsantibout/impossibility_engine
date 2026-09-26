import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  areaPointAt,
  livePatchesOf,
  liveTerrainNames,
  terrainAt,
  type LatticePatch,
  type Point,
} from './positioning.js';
import { endOngoingSpell, resolveMove, resolveSpell } from './commands.js';

/**
 * The ground a **casting** makes expensive, and the lifetime it makes it for.
 *
 * `difficult-terrain.test.ts` holds the other half: a patch the *table*
 * declares, which has carried an optional `source` since it was written and
 * has never had anything to point at. This is the writer that fills it —
 * SRD Grease "turns it into Difficult Terrain for the duration", Web "the
 * webs are Difficult Terrain", Spike Growth "the area becomes Difficult
 * Terrain for the duration", Plant Growth "must spend 4 feet of movement for
 * every 1 foot it moves".
 *
 * Three claims, and each is a different half of the design:
 *
 * | | |
 * |---|---|
 * | the patch is **pinned** | the region comes off the area the casting resolved, is written into the event, and the fold never opens the catalogue to charge for it |
 * | the patch **lapses with its casting** | derived at the moment the question is asked, from `state.ongoing`, exactly as a declared patch with a `source` already does |
 * | the patch **outlives an Instantaneous casting** | SRD Plant Growth's overgrowth has no duration and no ending, so it carries no `source` at all and stands until the table says otherwise |
 *
 * And one that is not about terrain: the record the lifetime hangs on is
 * {@link LatticePatch}, whose second consumer is `LightPatch` — see the shape
 * in `positioning.ts` and `docs/design/light-and-sight.md`.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const WALKER = id('walker');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  // Large, so a move can cost four feet a foot and still be affordable: the
  // tests are about what the ground charges, not about what a walker can do.
  baseSpeed: 300,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const PREPARED = ['grease', 'web', 'spike-growth', 'plant-growth'];

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/**
 * The geometry, worked out once against the engine's own ruler.
 *
 * A Cube is laid along +x from the point it is centred at, so `TOWARDS` is
 * east of every centre and `INSIDE` is one space into the shape. `OUTSIDE` is
 * one space beyond the largest of them, so no patch in the file reaches it.
 */
const HALL: Point = { x: 200, y: 200, z: 0 };
const AT: Point = { x: 240, y: 200, z: 0 };
const TOWARDS: Point = { x: 300, y: 200, z: 0 };
const INSIDE: Point = { x: 245, y: 200, z: 0 };
const OUTSIDE: Point = { x: 380, y: 200, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(WALKER),
  ...casts(CASTER),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  spot('the hall', HALL),
  spot('inside', INSIDE),
  spot('beside', { x: 250, y: 200, z: 0 }),
  spot('outside', OUTSIDE),
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: WALKER, placement: { from: { landmark: 'beside' }, feet: 0 } },
];

/** Initiative, pushed after the areas are conjured — see `area-triggers.test.ts`. */
const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: WALKER, initiative: 20, speed: 60 },
      { id: CASTER, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'terrain') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  // Every save fails, so nothing under test depends on a die.
  bonuses: [{ source: 'the fixture', flat: -40 }],
});

class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  /**
   * Cast an area spell at a point, and hand back the casting id.
   *
   * A Cube has to be pointed as well as placed and a Sphere refuses a
   * direction outright, so the aim goes with the shape rather than with every
   * casting.
   */
  conjure(spellId: string, slotLevel?: number, towards?: Point, option?: string): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        CASTER,
        {
          spellId,
          targets: [],
          at: AT,
          ...(towards === undefined ? {} : { towards }),
          ...(slotLevel === undefined ? {} : { slotLevel }),
          // SRD Plant Growth prints two branches and the ground is one of
          // them — "Casting Time: Action (Overgrowth) or 8 hours (Enrichment)"
          // — so a casting of it names which, exactly as Magic Circle's does.
          ...(option === undefined ? {} : { option }),
        },
        supply(spellId),
      ),
      `casting ${spellId}`,
    );
    this.events.push(...out.events);
    return out.castingId!;
  }

  fight(): this {
    this.events.push(...FIGHT);
    return this;
  }

  end(castingId: string): void {
    const out = unwrap(
      endOngoingSpell(this.state, CASTER, castingId, null),
      `ending ${castingId}`,
    );
    this.events.push(...out);
  }
}

describe('a casting writes a patch on the lattice', () => {
  /**
   * SRD Grease: "Nonflammable grease covers the ground in a 10-foot square
   * centered on a point within range and **turns it into Difficult Terrain**
   * for the duration."
   */
  it('charges the glossary rate over the square Grease covers', () => {
    const game = new Game();
    game.conjure('grease', undefined, TOWARDS);

    const here = terrainAt(game.state, INSIDE);
    expect(here.costPerFoot).toBe(2);
    expect(here.patches).toHaveLength(1);
    // And nowhere else: a patch is the shape the casting resolved, not the room.
    expect(terrainAt(game.state, OUTSIDE).costPerFoot).toBe(1);
  });

  /**
   * SRD Plant Growth's Overgrowth: "A creature moving through that area must
   * spend **4 feet of movement for every 1 foot** it moves." The rate is a
   * number rather than a flag for exactly this spell.
   */
  it('charges the rate the spell prints where that is not the glossary’s', () => {
    const game = new Game();
    game.conjure('plant-growth', 3, undefined, 'overgrowth');
    expect(terrainAt(game.state, INSIDE).costPerFoot).toBe(4);
  });

  /** SRD Spike Growth and Web each print the same sentence, at their own sizes. */
  it.each([
    ['web', 2, TOWARDS],
    ['spike-growth', 2, undefined],
  ] as const)('writes one for %s', (spellId, slotLevel, towards) => {
    const game = new Game();
    game.conjure(spellId, slotLevel, towards);
    expect(terrainAt(game.state, INSIDE).costPerFoot).toBe(2);
  });

  /**
   * The rule the whole lifetime hangs on: a patch a casting made stops
   * charging the instant that casting leaves `state.ongoing`, derived at the
   * question rather than swept up by a pass of its own.
   */
  it('stops charging the moment the casting ends', () => {
    const game = new Game();
    const castingId = game.conjure('web', 2, TOWARDS);
    expect(liveTerrainNames(game.state)).toHaveLength(1);

    game.end(castingId);
    expect(liveTerrainNames(game.state)).toEqual([]);
    expect(terrainAt(game.state, INSIDE).costPerFoot).toBe(1);
  });

  /**
   * SRD Plant Growth is **Instantaneous**: the plants become thick and
   * overgrown and the book prints no ending at all. So its patch names no
   * casting, and nothing can end it — which is the honest reading, and the
   * reason `source` is optional rather than always the casting.
   */
  it('leaves an Instantaneous casting’s overgrowth standing', () => {
    const game = new Game();
    game.conjure('plant-growth', 3, undefined, 'overgrowth');
    // Nothing is running: the spell has no duration and no record to end.
    expect(Object.keys(game.state.ongoing)).toEqual([]);
    expect(terrainAt(game.state, INSIDE).costPerFoot).toBe(4);
  });

  /**
   * Rule 5: what a command reads from the catalogue is pinned into the events
   * it emits, so the fold charges for the ground without opening a book.
   */
  it('pins the patch into the log, and folds without the catalogue', () => {
    const game = new Game();
    game.conjure('grease', undefined, TOWARDS);
    const declared = game.log.filter((e) => e.type === 'difficult-terrain-declared');
    expect(declared).toHaveLength(1);

    // `fold(seed, events)` takes no content at all — that is the proof.
    expect(terrainAt(fold('seed', [...game.log]), INSIDE).costPerFoot).toBe(2);
  });

  /**
   * And the ruler charges for it: the consumer, not the record.
   *
   * Five feet of grease costs ten, which is the glossary's own worked
   * example — "moving 5 feet through Difficult Terrain costs 10 feet of
   * movement" — and the same walk over the same ground with no casting
   * behind it costs five.
   */
  it('charges a move that crosses it', () => {
    const dry = unwrap(
      resolveMove(
        new Game().fight().state,
        WALKER,
        { placement: { from: { landmark: 'inside' }, feet: 0 } },
        supply('walk'),
      ),
      'walking over dry ground',
    );
    expect(dry.cost).toBe(5);
    expect(dry.terrain).toEqual([]);

    const game = new Game();
    game.conjure('grease', undefined, TOWARDS);
    const walked = unwrap(
      resolveMove(
        game.fight().state,
        WALKER,
        { placement: { from: { landmark: 'inside' }, feet: 0 } },
        supply('walk'),
      ),
      'walking through the grease',
    );
    expect(walked.feet).toBe(5);
    expect(walked.cost).toBe(10);
    expect(walked.terrain).toHaveLength(1);
  });
});

describe('the lifetime a second kind of patch will reuse', () => {
  /**
   * `LightPatch` is this record's second consumer — a region, a value and the
   * `source` casting that made it, derived at read time — so the liveness
   * rule is parameterised over the record rather than written into the
   * terrain reader. This drives it with a record that is *not* terrain, which
   * is the whole of the claim.
   */
  it('drops a patch whose casting is not running, whatever the patch holds', () => {
    const game = new Game();
    const castingId = game.conjure('web', 2, TOWARDS);
    const region = { origin: areaPointAt(AT), shape: { kind: 'sphere', radius: 20 } } as const;

    const lit: Record<string, LatticePatch & { readonly level: string }> = {
      'the lantern': { region, level: 'bright' },
      'the darkness': { region, level: 'darkness', source: castingId },
    };

    expect(livePatchesOf(game.state, lit).map(([name]) => name)).toEqual([
      'the darkness',
      'the lantern',
    ]);

    game.end(castingId);
    expect(livePatchesOf(game.state, lit).map(([name]) => name)).toEqual(['the lantern']);
  });
});
