import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { speedOf } from './standing.js';
import { endConcentration, ongoingSpellOf, resolveMove, resolveSpell } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * What a persistent area does to whoever is standing in it, for as long as
 * they stand in it.
 *
 * SRD Spirit Guardians: "Any other creature's Speed is **halved in the
 * Emanation**." Which creatures those are is a fact about where two creatures
 * are standing, and it changes every time either of them moves without
 * anything happening that a log could record — the argument `standing.ts`
 * already makes for a Paladin's aura, arriving at a casting's area.
 *
 * So the halving is **derived on every read** and nothing is ever stored on
 * the creature it reaches. A stored halving would be a pair of events that had
 * to stay matched — granted on the way in, released on the way out — and the
 * first route that moved a creature without remembering would leave a goblin
 * walking at half Speed a hundred feet from the cleric.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
/** Inside the Emanation from the moment it appears, and never designated. */
const WALKER = id('walker');
/** Outside it until the cleric takes one step east. */
const VICTIM = id('victim');
/** Inside it, and designated unaffected in the casting that names them. */
const ALLY = id('ally');

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CLERIC || who === ALLY ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['spirit-guardians'] }),
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
 * The lane, measured against the engine's own ruler.
 *
 * A 15-foot Emanation on a Medium carrier standing at x = 300 covers
 * x ∈ [285, 315] and excludes the carrier's own space; one five-foot step east
 * takes it to [290, 320].
 */
const LANE = 300;
const CLERIC_AT: Point = { x: 300, y: LANE, z: 0 };
const ONE_STEP_EAST: Point = { x: 305, y: LANE, z: 0 };
const WALKER_AT: Point = { x: 315, y: LANE, z: 0 };
const VICTIM_AT: Point = { x: 320, y: LANE, z: 0 };
const ALLY_AT: Point = { x: 310, y: LANE, z: 0 };

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(WALKER),
  added(VICTIM),
  added(ALLY),
  ...casts(CLERIC),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(CLERIC, CLERIC_AT),
  place(WALKER, WALKER_AT),
  place(VICTIM, VICTIM_AT),
  place(ALLY, ALLY_AT),
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

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

  cast(unaffected: readonly CharacterId[] = []): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        {
          spellId: 'spirit-guardians',
          targets: [],
          damageType: 'radiant',
          ...(unaffected.length === 0 ? {} : { unaffected }),
        },
        supply('spirit-guardians'),
      ),
      'casting Spirit Guardians',
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** Shove a creature, which is the one route that moves one outside a turn. */
  shove(who: CharacterId, to: Point): this {
    const out = unwrap(
      resolveMove(
        this.state,
        who,
        { placement: { from: { point: to }, feet: 0 }, forced: true },
        supply('move'),
      ),
      `${who} moving`,
    );
    return this.push(out.events);
  }

  speeds(): Record<string, number> {
    const state = this.state;
    return {
      cleric: speedOf(state, CLERIC),
      walker: speedOf(state, WALKER),
      victim: speedOf(state, VICTIM),
      ally: speedOf(state, ALLY),
    };
  }
}

describe('a Speed halved by where a creature is standing', () => {
  it('halves the Speed of a creature inside the Emanation and nobody else', () => {
    const game = new Game();
    game.cast();

    expect(game.speeds()).toEqual({
      // SRD: an Emanation excludes its own origin, so the cleric is not in it.
      cleric: 30,
      // "Any other creature's Speed is halved in the Emanation" — any other,
      // so a creature the cleric is fighting beside is caught like the rest.
      walker: 15,
      ally: 15,
      // Five feet outside the Emanation, and untouched.
      victim: 30,
    });
  });

  it('follows the Emanation when the caster moves, with no event in between', () => {
    const game = new Game();
    game.cast();
    expect(game.speeds().victim).toBe(30);

    game.shove(CLERIC, ONE_STEP_EAST);

    expect(game.speeds()).toEqual({ cleric: 30, walker: 15, victim: 15, ally: 15 });
    // Nothing was granted to anybody: the halving is derived from the scene on
    // every read, so no pair of events has to stay matched.
    expect(game.log.some((e) => e.type === 'speed-modifier-granted')).toBe(false);
  });

  it('spares a creature the caster designated unaffected at the cast', () => {
    const game = new Game();
    game.cast([ALLY]);

    // One decision, filtered where the area is read, so it reaches the halving
    // and the saving throw alike — and it is the caster's list rather than the
    // declared sides: `ally` and `walker` are both in the Emanation.
    expect(game.speeds()).toEqual({ cleric: 30, walker: 15, victim: 30, ally: 30 });
  });

  it('hands the Speed back when the casting ends', () => {
    const game = new Game();
    const castingId = game.cast();
    expect(game.speeds().walker).toBe(15);

    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'ending it'));

    expect(ongoingSpellOf(game.state, castingId)).toBeNull();
    expect(game.speeds()).toEqual({ cleric: 30, walker: 30, victim: 30, ally: 30 });
    expect(game.log.some((e) => e.type === 'speed-modifier-granted')).toBe(false);
  });

  it('pins what the area does to whoever stands in it onto the casting', () => {
    const game = new Game();
    const castingId = game.cast();

    // The fold never opens the catalogue, so the standing effect an area has is
    // recorded at the cast beside the area it is measured over.
    expect(ongoingSpellOf(game.state, castingId)?.areaStanding).toEqual({
      kind: 'speed',
      change: 'halve',
    });
  });
});

describe('what the validator holds a standing area effect to', () => {
  const NO_AREA = Symbol('no area');
  const definition = (
    areaStanding: unknown,
    area: unknown = { kind: 'sphere', radius: 15, origin: 'point' },
  ) => ({
    id: 'homebrew-zone',
    name: 'Homebrew Zone',
    level: 2,
    school: 'evocation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 60,
    // A definition whose `effects` are empty says what it leaves to the table,
    // which Spirit Guardians does too: the zone is the whole of the spell.
    unmodelled: ['what the zone looks like'],
    ...(area === NO_AREA ? {} : { area }),
    areaStanding,
  });

  const codes = (value: unknown): readonly string[] =>
    checkSpellDefinitionValue(value).map((p) => `${p.field}:${p.code}`);

  it('accepts the sentence Spirit Guardians writes', () => {
    expect(codes(definition({ kind: 'speed', change: 'halve' }))).toEqual([]);
  });

  it('refuses a standing effect on a spell with no area to stand in', () => {
    expect(codes(definition({ kind: 'speed', change: 'halve' }, NO_AREA))).toContain(
      'areaStanding:standing_without_area',
    );
  });

  it('refuses a kind the engine derives nothing from', () => {
    expect(codes(definition({ kind: 'cannot-lie' }))).toContain(
      'areaStanding.kind:unknown_area_standing',
    );
  });

  it('holds the Speed pairing to the rule every other carrier is held to', () => {
    // `halve` names the whole operation, so feet beside it are read by nothing;
    // `add` without them is a change of nothing.
    expect(codes(definition({ kind: 'speed', change: 'halve', feet: 10 }))).toContain(
      'areaStanding.feet:bad_speed_change',
    );
    expect(codes(definition({ kind: 'speed', change: 'add' }))).toContain(
      'areaStanding.feet:bad_speed_change',
    );
    expect(codes(definition({ kind: 'speed', change: 'sprint' }))).toContain(
      'areaStanding.change:bad_speed_change',
    );
  });
});
