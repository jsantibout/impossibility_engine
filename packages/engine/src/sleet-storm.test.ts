import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { obscurementAt, terrainAt, type Point } from './positioning.js';
import { hazardsOn } from './hazards.js';
import { ongoingSpellOf, resolveSpell, resolveTurn } from './commands.js';

/**
 * An outcome that **breaks somebody's Concentration**.
 *
 * SRD Sleet Storm: "When a creature enters the Cylinder for the first time on
 * a turn or starts its turn there, it must succeed on a Dexterity saving
 * throw or have the Prone condition **and lose Concentration**."
 *
 * Every other clause of the spell was already writable: the Cylinder is a
 * template the engine has, both trigger moments are `AreaTrigger` members by
 * name, the Difficult Terrain is `areaTerrain` and the Heavily Obscured air is
 * `areaObscurement`. What had nowhere to go was the last three words. Ending a
 * Concentration is something the engine does readily — a failed Constitution
 * save does it, a second casting does it, a dispel does it — and no *outcome*
 * of a saving throw could ask for one, so writing the save without it would
 * have dropped half of what a failure costs.
 *
 * `OutcomeRiders.breaksConcentration` is that slot, and what it lands is the
 * `concentration-ended` event every other ending already writes.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const WIZARD = id('wizard');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 14, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(who === WIZARD ? { spellcastingAbility: 'int' } : {}),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId, ability: 'int' | 'wis', prepared: readonly string[]) =>
  [
    {
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({ ability, prepared }),
    },
    ...[1, 2, 3].map((level) => ({
      type: 'resource-pool-declared' as const,
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' as const },
    })),
  ] as readonly GameEvent[];

/** The point the Cylinder is centred on, a hundred feet down the hall. */
const STORM: Point = { x: 300, y: 200, z: 0 };
/** One space inside the 20-foot radius, and one space beyond it. */
const INSIDE: Point = { x: 315, y: 200, z: 0 };
const OUTSIDE: Point = { x: 330, y: 200, z: 0 };

const SETUP: readonly GameEvent[] = [
  added(DRUID, 'party'),
  added(WIZARD, 'foes'),
  added(ALLY, 'foes'),
  ...slots(DRUID, 'wis', ['sleet-storm']),
  ...slots(WIZARD, 'int', ['bless']),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 120 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'in the storm', at: INSIDE },
  { type: 'landmark-added', name: 'clear of it', at: OUTSIDE },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'in the storm' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { landmark: 'clear of it' }, feet: 0 } },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
];

const supply = (seed: string, flat: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const FAILS = -40;
const SAVES = 40;

/** A log that folds, with the four things these tests want off it. */
class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(who: CharacterId, spellId: string, request: Record<string, unknown>, seed: string): string {
    const out = unwrap(
      resolveSpell(this.state, who, { spellId, targets: [], ...request } as never, supply(seed, 0)),
      `${who} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  turn(seed: string, flat: number): this {
    const out = unwrap(resolveTurn(this.state, supply(seed, flat)), 'advancing the turn');
    return this.push(out.events);
  }

  conditions(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }

  concentrating(who: CharacterId): string | null {
    return this.state.creatures[who]?.concentration?.castingId ?? null;
  }
}

/**
 * A wizard concentrating on a Bless, standing in the sleet, whose turn is
 * about to begin.
 *
 * The storm is conjured before the fight for the reason `area-triggers.test.ts`
 * conjures its areas there: a turn allows one spell slot and this fixture
 * wants two castings standing before anybody's boundary comes round.
 */
const storming = (): { readonly game: Game; readonly bless: string; readonly sleet: string } => {
  const game = new Game();
  const bless = game.cast(WIZARD, 'bless', { targets: [ALLY], slotLevel: 1 }, 'bless');
  const sleet = game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');
  game.push([
    {
      type: 'combat-started',
      combatants: [
        { id: DRUID, initiative: 30, speed: 30 },
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 10, speed: 30 },
      ],
    },
  ]);
  return { game, bless, sleet };
};

describe('Sleet Storm', () => {
  it('lays a 40-foot-tall, 20-foot-radius Cylinder of Difficult Terrain', () => {
    const { game } = storming();

    expect(terrainAt(game.state, INSIDE).costPerFoot).toBe(2);
    expect(terrainAt(game.state, OUTSIDE).costPerFoot).toBe(1);
  });

  it('makes the air inside it Heavily Obscured', () => {
    const { game } = storming();

    expect(obscurementAt(game.state, INSIDE).degree).toBe('heavily');
    expect(obscurementAt(game.state, OUTSIDE).degree).toBeNull();
  });

  /**
   * "or have the Prone condition **and lose Concentration**" — one failed
   * save, both halves, and the pair is what made this spell unwritable.
   */
  it('knocks a creature Prone and ends its Concentration on a failed save', () => {
    const { game, bless } = storming();
    expect(game.concentrating(WIZARD)).toBe(bless);

    // The druid's turn ends and the wizard's begins, in the sleet.
    game.turn('boundary', FAILS);

    expect(game.conditions(WIZARD)).toContain('prone');
    expect(game.concentrating(WIZARD)).toBeNull();
    expect(ongoingSpellOf(game.state, bless)).toBeNull();
  });

  it('does neither on a made save', () => {
    const { game, bless } = storming();

    game.turn('boundary', SAVES);

    expect(game.conditions(WIZARD)).not.toContain('prone');
    expect(game.concentrating(WIZARD)).toBe(bless);
    expect(ongoingSpellOf(game.state, bless)).not.toBeNull();
  });

  /**
   * A creature concentrating on nothing loses nothing, and the rest of the
   * failure lands anyway — the silence `SpentBudget` takes for "if available",
   * for the same reason: a rider that could refuse the outcome would be a
   * Sleet Storm that left a wizard on their feet.
   */
  it('still knocks a creature with no Concentration to hold Prone', () => {
    const game = new Game();
    game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');
    game.push([
      {
        type: 'combat-started',
        combatants: [
          { id: DRUID, initiative: 30, speed: 30 },
          { id: WIZARD, initiative: 20, speed: 30 },
        ],
      },
    ]);
    expect(game.concentrating(WIZARD)).toBeNull();

    game.turn('boundary', FAILS);

    expect(game.conditions(WIZARD)).toContain('prone');
  });
});

/**
 * SRD Sleet Storm: "The area is Heavily Obscured, and **exposed flames in the
 * area are doused**."
 *
 * The flame the engine holds is the glossary's Burning hazard, which sits on a
 * creature — and SRD Burning says "The fire also goes out if it is doused". So
 * a creature on fire standing in the sleet stops burning, whichever way it came
 * to be there and whenever it caught: derived from where it stands, as the
 * area's other standing clauses are, rather than written at the moments
 * somebody remembered to ask.
 */
describe('Sleet Storm douses the flames in its area', () => {
  const alight = (who: CharacterId): GameEvent => ({
    type: 'hazard-caught',
    id: who,
    hazard: { hazard: 'burning', lit: 'the fixture' },
  });
  const burning = (game: Game, who: CharacterId): boolean =>
    hazardsOn(game.state, who).some((one) => one.hazard === 'burning');

  it('puts out a creature already burning in the Cylinder when the sleet falls', () => {
    const game = new Game([...SETUP, alight(WIZARD), alight(ALLY)]);
    expect(burning(game, WIZARD)).toBe(true);

    game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');

    expect(burning(game, WIZARD)).toBe(false);
    // Clear of the storm, the fire goes on.
    expect(burning(game, ALLY)).toBe(true);
  });

  it('puts out a burning creature that walks into it', () => {
    const game = new Game([...SETUP, alight(ALLY)]);
    game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');
    expect(burning(game, ALLY)).toBe(true);

    game.push([
      {
        type: 'creature-moved',
        id: ALLY,
        placement: { from: { landmark: 'in the storm' }, feet: 5, bearing: 180 },
      },
    ]);

    expect(burning(game, ALLY)).toBe(false);
  });

  it('will not let a creature standing in it catch fire', () => {
    const game = new Game();
    game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');

    game.push([alight(WIZARD)]);

    expect(burning(game, WIZARD)).toBe(false);
  });

  it('douses nothing once the storm has ended', () => {
    const game = new Game();
    const sleet = game.cast(DRUID, 'sleet-storm', { at: STORM, slotLevel: 3 }, 'sleet');
    game.push([{ type: 'spell-ended', castingId: sleet, on: null, reason: 'dismissed' }]);

    game.push([alight(WIZARD)]);

    expect(burning(game, WIZARD)).toBe(true);
  });
});
