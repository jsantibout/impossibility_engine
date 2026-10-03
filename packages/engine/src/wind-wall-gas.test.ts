import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { obscurementAt, type Point } from './positioning.js';
import { creaturesStandingInCastingArea } from './spells.js';
import { resolveSpell } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * SRD Wind Wall: "**The strong wind keeps fog, smoke, and other gases at
 * bay.**" (E-L2, the owner's ruling of 2026-10-03)
 *
 * **The wall clears its own strip, and gas cannot cross it.** A Fog Cloud or a
 * Stinking Cloud the wall touches is not ended: its gas is held off the wall's
 * own spaces and off every space the wall stands between and the cloud's
 * centre, and the rest of the cloud stands. When the wall goes, the cloud is
 * whole again. The gases the engine holds are castings a strong wind
 * disperses (`dispersed-by-wind`); smoke off a fire is nothing it holds.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const MAGE = id('mage');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 18, cha: 10 },
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
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const caster = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  added(who),
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: [...prepared] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

/** The wall runs east–west along y = 215, ten spaces long: 175 to 220. */
const WALL_PATH = Array.from({ length: 10 }, (_, i) => at(175 + i * 5, 215));
/** The cloud's centre, north of the wall. */
const CLOUD = at(200, 225);
/** A space of the wall, one the cloud's side of it, and one behind it. */
const IN_THE_WALL = at(200, 215);
const NEAR_SIDE = at(200, 235);
const BEHIND = at(200, 205);

const SETUP: readonly GameEvent[] = [
  ...caster(DRUID, ['wind-wall']),
  ...caster(MAGE, ['fog-cloud', 'stinking-cloud']),
  added(GOBLIN),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: at(190, 180) }, feet: 0 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { point: at(200, 160) }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { point: IN_THE_WALL }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('gale') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const cast = (log: GameEvent[], who: CharacterId, request: Record<string, unknown>): string => {
  const state = fold('gale', log);
  const out = unwrap(resolveSpell(state, who, request as never, supply(state)), String(request['spellId']));
  log.push(...out.events);
  return out.castingId!;
};

const wall = (log: GameEvent[]) =>
  cast(log, DRUID, { spellId: 'wind-wall', targets: [], path: WALL_PATH, slotLevel: 3 });

const fogAt = (log: readonly GameEvent[], where: Point) => obscurementAt(fold('gale', log), where).degree;

describe('SRD Wind Wall keeps fog and other gases at bay', () => {
  it('holds a Fog Cloud off its own spaces and off the far side, and leaves the rest standing', () => {
    const log = [...SETUP];
    wall(log);
    const fog = cast(log, MAGE, { spellId: 'fog-cloud', targets: [], at: CLOUD, slotLevel: 1 });

    expect(fold('gale', log).ongoing[fog]).toBeDefined();
    expect(fogAt(log, NEAR_SIDE)).toBe('heavily');
    expect(fogAt(log, IN_THE_WALL)).toBeNull();
    expect(fogAt(log, BEHIND)).toBeNull();
  });

  it('clears a Stinking Cloud already standing when the wall rises through it, and catches nobody in the strip', () => {
    const log = [...SETUP];
    const cloud = cast(log, MAGE, { spellId: 'stinking-cloud', targets: [], at: CLOUD, slotLevel: 3 });
    const before = fold('gale', log);
    expect(creaturesStandingInCastingArea(before.scene!, before.ongoing[cloud]!)?.has(GOBLIN)).toBe(true);

    wall(log);

    const after = fold('gale', log);
    expect(after.ongoing[cloud]).toBeDefined();
    expect(creaturesStandingInCastingArea(after.scene!, after.ongoing[cloud]!)?.has(GOBLIN)).toBe(false);
    expect(fogAt(log, IN_THE_WALL)).toBeNull();
    expect(fogAt(log, NEAR_SIDE)).toBe('heavily');
  });

  /**
   * A cloud centred in the wall's own strip has no far side: the wall clears
   * its strip and both halves of the cloud stand.
   */
  it('clears only the strip of a cloud centred on the wall, and leaves both halves standing', () => {
    const log = [...SETUP];
    wall(log);
    cast(log, MAGE, { spellId: 'fog-cloud', targets: [], at: IN_THE_WALL, slotLevel: 1 });

    expect(fogAt(log, IN_THE_WALL)).toBeNull();
    expect(fogAt(log, NEAR_SIDE)).toBe('heavily');
    expect(fogAt(log, at(200, 225))).toBe('heavily');
    expect(fogAt(log, BEHIND)).toBe('heavily');
  });

  it('gives the cloud its strip back when the wall goes', () => {
    const log = [...SETUP];
    const windWall = wall(log);
    cast(log, MAGE, { spellId: 'fog-cloud', targets: [], at: CLOUD, slotLevel: 1 });
    expect(fogAt(log, IN_THE_WALL)).toBeNull();

    log.push({ type: 'spell-ended', castingId: windWall, on: null, reason: 'dismissed' });

    expect(fogAt(log, IN_THE_WALL)).toBe('heavily');
    expect(fogAt(log, BEHIND)).toBe('heavily');
  });

  it('is printed on Wind Wall, and keeps out nothing but gas', () => {
    const windWall = SRD_CONTENT.spells.find((one) => one.id === 'wind-wall')!;
    expect(windWall.areaStanding).toContainEqual({ kind: 'keeps-out', what: 'gas' });
    expect(checkSpellDefinitionValue(windWall)).toEqual([]);
    const codes = (value: unknown) =>
      checkSpellDefinitionValue({ ...windWall, areaStanding: [value] }).map((one) => one.code);
    expect(codes({ kind: 'keeps-out', what: 'smoke' })).toContain('unknown_dispersal');
    expect(codes({ kind: 'keeps-out' })).toContain('unknown_dispersal');
  });
});
