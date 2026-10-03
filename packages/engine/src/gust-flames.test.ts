import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { LightFlame, Point, TerrainRegion } from './positioning.js';
import { declareLight, resolveSpell, settleAreaEffects } from './commands.js';

/**
 * SRD Gust of Wind: "it **extinguishes candles and similar unprotected
 * flames** in the area. It causes **protected flames**, such as those of
 * lanterns, to dance wildly and has a **50 percent chance to extinguish
 * them**." SRD Sleet Storm: "**exposed flames** in the area are doused."
 * (E-L2, the owner's ruling of 2026-10-03)
 *
 * A flame is light the table declares, with the kind it is
 * (`declare_light.flame`: `unprotected` or `protected`). An unprotected one —
 * a torch, a candle — the Line or the sleet reaches simply goes out. A
 * protected one the Line reaches is owed **one** throw, when the Line first
 * reaches it and again only if the Line is later moved onto it — not every
 * round — and the engine throws it when the debt is settled. Sleet Storm reads
 * "exposed" as unprotected, and leaves a lantern alone.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const FIGHTER = id('fighter');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

/** The druid at the hall; the Line blows due east, sixty feet. */
const HALL = at(100, 100);
const EAST = at(200, 100);
/** South of the hall, where a Line aimed at EAST misses everything on y = 100. */
const ASIDE = at(100, 250);

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(FIGHTER),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['gust-of-wind', 'sleet-storm'] }),
  },
  ...[2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: HALL }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { point: at(140, 100) }, feet: 0 } },
];

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const supply = (seed = 'wind') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  // A flat bonus settles the opening save, so nobody is pushed off a flame.
  bonuses: [{ source: 'the fixture', flat: 40 }],
  content: SRD_CONTENT,
});

const glow = (where: Point): TerrainRegion => ({ origin: { space: where }, shape: { kind: 'sphere', radius: 10 } });

const lit = (log: GameEvent[], patch: string, region: TerrainRegion, flame?: LightFlame) =>
  log.push(
    ...unwrap(
      declareLight(state(log), patch, { region, level: 'bright', ...(flame === undefined ? {} : { flame }) }),
      patch,
    ),
  );

/** A candle and a lantern down the Line, a torch in the fighter's hand there, and a brazier well off it. */
const room = (): GameEvent[] => {
  const log = [...SETUP];
  lit(log, 'the candle', glow(at(120, 100)), 'unprotected');
  lit(log, 'the lantern', glow(at(150, 100)), 'protected');
  lit(log, 'the torch', { origin: { creature: FIGHTER }, shape: { kind: 'sphere', radius: 20 } }, 'unprotected');
  lit(log, 'the brazier', glow(at(120, 200)), 'unprotected');
  lit(log, 'the sconce', glow(at(130, 100)));
  return log;
};

const gust = (log: GameEvent[]) => {
  const cast = unwrap(
    resolveSpell(state(log), DRUID, { spellId: 'gust-of-wind', targets: [], towards: EAST, slotLevel: 2 }, supply()),
    'the gust',
  );
  log.push(...cast.events);
  return cast.castingId!;
};

const settle = (log: GameEvent[], seed: string) => {
  const settled = unwrap(settleAreaEffects(state(log), supply(seed)), 'the lantern');
  log.push(...settled.events);
  return settled;
};

const flamesOwed = (world: GameState) => world.owedAreaEffects.filter((owed) => owed.moment === 'flame-reached');

/** A seed whose throw leaves the lantern burning, or puts it out, found by trying rather than assumed. */
const seedWhere = (goesOut: boolean): string => {
  for (let i = 0; i < 64; i += 1) {
    const log = room();
    gust(log);
    settle(log, `lantern-${i}`);
    if ((state(log).scene!.light['the lantern'] === undefined) === goesOut) return `lantern-${i}`;
  }
  throw new Error('no seed in 64 gave that outcome');
};

describe('the table declares a flame', () => {
  it('pins the kind of flame on the event and the patch', () => {
    const log = room();
    const declared = log.find(
      (event) => event.type === 'light-declared' && event.patch === 'the lantern',
    ) as Extract<GameEvent, { type: 'light-declared' }>;
    expect(declared.flame).toBe('protected');
    expect(state(log).scene!.light['the candle']!.flame).toBe('unprotected');
    expect(state(log).scene!.light['the sconce']!.flame).toBeUndefined();
  });

  it('refuses a flame that is neither kind', () => {
    const refused = declareLight(state(SETUP), 'the oddity', {
      region: glow(HALL),
      level: 'bright',
      flame: 'smouldering' as LightFlame,
    });
    expect(isErr(refused) && refused.code).toBe('bad_flame');
  });
});

describe('SRD Gust of Wind and the flames in the Line', () => {
  it('puts out the unprotected flames it reaches, and leaves the rest of the light alone', () => {
    const log = room();
    gust(log);
    const light = state(log).scene!.light;
    expect(light['the candle']).toBeUndefined();
    expect(light['the torch']).toBeUndefined();
    expect(light['the brazier']).toBeDefined();
    // Light the table declared with no flame is not a flame the wind can find.
    expect(light['the sconce']).toBeDefined();
  });

  it('owes the lantern one throw, and the throw decides it', () => {
    const log = room();
    const castingId = gust(log);
    expect(flamesOwed(state(log))).toEqual([{ castingId, target: 'the lantern', moment: 'flame-reached' }]);

    const settled = settle(log, 'once');
    const thrown = settled.events.filter((event) => event.type === 'roll-recorded');
    expect(thrown).toHaveLength(1);
    const roll = thrown[0] as Extract<GameEvent, { type: 'roll-recorded' }>;
    expect(roll.label).toContain('1d100 against 50%');
    // The engine's die, read back: at or under fifty, the lantern goes out.
    expect(state(log).scene!.light['the lantern'] === undefined).toBe(roll.natural <= 50);
    expect(flamesOwed(state(log))).toEqual([]);
  });

  it('does not throw again while the Line stays on a lantern that held', () => {
    const log = room();
    gust(log);
    settle(log, seedWhere(false));
    expect(state(log).scene!.light['the lantern']).toBeDefined();

    // Time passes and the wind blows on; nothing about the Line or the flame moved.
    log.push({ type: 'time-advanced', seconds: 30, reason: 'the wind blows on' });
    expect(flamesOwed(state(log))).toEqual([]);
  });

  it('throws again when the Line is moved off the lantern and back onto it', () => {
    const log = room();
    const castingId = gust(log);
    settle(log, seedWhere(false));

    log.push({ type: 'creature-moved', id: DRUID, placement: { from: { point: ASIDE }, feet: 0 } });
    expect(flamesOwed(state(log))).toEqual([]);
    log.push({ type: 'creature-moved', id: DRUID, placement: { from: { point: HALL }, feet: 0 } });
    expect(flamesOwed(state(log))).toEqual([{ castingId, target: 'the lantern', moment: 'flame-reached' }]);
  });

  it('owes nothing for a lantern the wind has already put out', () => {
    const log = room();
    gust(log);
    settle(log, seedWhere(true));
    expect(state(log).scene!.light['the lantern']).toBeUndefined();
    log.push({ type: 'creature-moved', id: DRUID, placement: { from: { point: ASIDE }, feet: 0 } });
    log.push({ type: 'creature-moved', id: DRUID, placement: { from: { point: HALL }, feet: 0 } });
    expect(flamesOwed(state(log))).toEqual([]);
  });

  it('prints the chance on the definition, and refuses one that is no percentage', () => {
    const definition = SRD_CONTENT.spell('gust-of-wind')!;
    expect(definition.areaStanding).toContainEqual({ kind: 'extinguishes-flames', protectedChance: 50 });
    const codes = (protectedChance: unknown) =>
      checkSpellDefinitionValue({
        ...definition,
        areaStanding: [{ kind: 'extinguishes-flames', protectedChance }],
      }).map((one) => one.code);
    expect(codes(50)).toEqual([]);
    expect(codes(0)).toContain('bad_flame_chance');
    expect(codes(101)).toContain('bad_flame_chance');
    expect(codes(12.5)).toContain('bad_flame_chance');
  });
});

describe('SRD Sleet Storm and the flames under it', () => {
  it('douses the exposed flames and leaves a lantern burning, with nothing owed', () => {
    const log = room();
    const cast = unwrap(
      resolveSpell(state(log), DRUID, { spellId: 'sleet-storm', targets: [], at: at(130, 100), slotLevel: 3 }, supply()),
      'the sleet',
    );
    log.push(...cast.events);
    const light = state(log).scene!.light;
    expect(light['the candle']).toBeUndefined();
    expect(light['the torch']).toBeUndefined();
    expect(light['the lantern']).toBeDefined();
    expect(flamesOwed(state(log))).toEqual([]);
  });
});
