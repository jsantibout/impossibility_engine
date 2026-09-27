import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet, MovementMode } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { speedOf, type StandingEffect } from './standing.js';
import { resolveSpell } from './commands.js';

/**
 * Every Speed a creature has moves with its Speed (owner, 2026-09-27).
 *
 * > Rules Glossary, Speed — "_Changes to Your Speeds._ If an effect increases
 * > or decreases your Speed for a time, any special speed you have increases
 * > or decreases by an equal amount for the same duration. For example, if
 * > your Speed is reduced to 0 and you have a Climb Speed, your Climb Speed is
 * > also reduced to 0. Similarly, if your Speed is halved and you have a Fly
 * > Speed, your Fly Speed is also halved."
 *
 * Until this file an increase and a doubling reached the walking Speed alone —
 * a builder's reading, not a ruling — and only reductions reached every mode.
 * Now all four reach every Speed the creature **has**: a mode nothing gives it
 * is still 0. What does not change: a Speed granted *in a mode* (SRD Fly's "a
 * Fly Speed of 60 feet") is a floor chosen before anything is added, and SRD
 * Gaseous Form's "only method of movement" still takes every other mode away.
 *
 * The order, once for every mode: the base (the highest of the printed Speed,
 * a matched walk and any floor), then every flat change, then doubled once,
 * then halved once, then zeroed — `combineSpeed`'s order, unchanged.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SEED = 'every-speed';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const setup = (target: Partial<CharacterSheet> = {}): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET, target),
  ...[1, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', cantrips: [], prepared: ['fly', 'longstrider'] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 200 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { landmark: 'the ford' }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
];

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const cast = (log: readonly GameEvent[], spellId: 'fly' | 'longstrider', slotLevel: number): readonly GameEvent[] => {
  const state = fold(SEED, log);
  const result: Result<{ readonly events: readonly GameEvent[] }> = resolveSpell(
    state,
    CASTER,
    { spellId, targets: [TARGET], ...(spellId === 'fly' ? { willing: [TARGET] } : {}), slotLevel },
    supply(state, spellId),
  );
  return [...log, ...unwrap(result, spellId).events];
};

/**
 * A stored grant written straight onto the log, for the two spells whose own
 * castings would need a second concentrator: SRD Haste's "the target's Speed
 * is doubled" and SRD Slow's "An affected target's Speed is halved".
 */
const granted = (
  log: readonly GameEvent[],
  source: string,
  change: 'double' | 'halve' | 'only' | 'match-walk',
  extra: { readonly mode?: MovementMode; readonly feet?: number } = {},
): readonly GameEvent[] => [
  ...log,
  { type: 'speed-modifier-granted', id: TARGET, modifier: { source, change, ...extra } },
];

const hasted = (log: readonly GameEvent[]) => granted(log, 'Haste#cast:90', 'double');
const slowed = (log: readonly GameEvent[]) => granted(log, 'Slow#cast:91', 'halve');

const speeds = (log: readonly GameEvent[]) => {
  const state = fold(SEED, log);
  return {
    walk: speedOf(state, TARGET),
    fly: speedOf(state, TARGET, 'fly'),
    climb: speedOf(state, TARGET, 'climb'),
    swim: speedOf(state, TARGET, 'swim'),
  };
};

/** An Owl's printed Fly Speed, which is the sheet's and not a grant's. */
const OWL = { baseSpeed: 5, speeds: { fly: 60 } } as const;

describe('an increase reaches every Speed the creature has', () => {
  it('adds Longstrider’s ten feet to a flight Fly gave, and to the walk', () => {
    expect(speeds(cast(cast(setup(), 'fly', 3), 'longstrider', 1))).toMatchObject({ walk: 40, fly: 70 });
  });

  it('adds it to a printed Fly Speed', () => {
    expect(speeds(cast(setup(OWL), 'longstrider', 1))).toMatchObject({ walk: 15, fly: 70 });
  });

  /**
   * SRD Barbarian Fast Movement, Monk Unarmored Movement: "Your Speed
   * increases by 10 feet". A feature's grant, derived off the sheet, is an
   * increase to the Speed like a spell's.
   */
  it('adds a feature’s increase to a printed Fly Speed', () => {
    const fast: StandingEffect = {
      feature: 'homebrew:fleet',
      name: 'Fleet',
      reach: { kind: 'self' },
      grant: { kind: 'speed', feet: 10 },
    };
    expect(speeds(setup({ ...OWL, standing: [fast] }))).toMatchObject({ walk: 15, fly: 70 });
  });

  /**
   * SRD Spider Climb: "a Climb Speed equal to your Speed". The matched climb
   * takes the walk before anything happened to it as its base, and the
   * increase then reaches it as it reaches the walk — so it is still equal.
   */
  it('keeps a Climb Speed equal to the Speed it matches', () => {
    const climbing = granted(setup(), 'Spider Climb#cast:92', 'match-walk', { mode: 'climb' });
    expect(speeds(cast(climbing, 'longstrider', 1))).toMatchObject({ walk: 40, climb: 40 });
  });

  it('gives no Speed to a mode the creature does not have', () => {
    expect(speeds(hasted(cast(setup(), 'longstrider', 1)))).toMatchObject({ walk: 80, fly: 0, swim: 0 });
  });
});

describe('a doubling reaches every Speed the creature has', () => {
  it('doubles a flight Fly gave', () => {
    expect(speeds(hasted(cast(setup(), 'fly', 3)))).toMatchObject({ walk: 60, fly: 120 });
  });

  it('doubles a printed Fly Speed', () => {
    expect(speeds(hasted(setup(OWL)))).toMatchObject({ walk: 10, fly: 120 });
  });

  /**
   * The order, asked of a creature that has everything at once: an Owl's
   * printed 60 and Fly's 60 are two Fly Speeds and the higher is flown (the
   * floor, before anything is added), then Longstrider's ten, then Haste's
   * doubling. (60 + 10) × 2, not 60 × 2 + 10 and not 120 + 60.
   */
  it('floors first, then adds, then doubles', () => {
    const everything = hasted(cast(cast(setup(OWL), 'fly', 3), 'longstrider', 1));
    expect(speeds(everything)).toMatchObject({ walk: 30, fly: 140 });
  });

  it('is undone by Slow, in the air as on the ground', () => {
    expect(speeds(slowed(hasted(cast(setup(), 'fly', 3))))).toMatchObject({ walk: 30, fly: 60 });
  });
});

describe('what the glossary’s rule does not undo', () => {
  /**
   * SRD Gaseous Form: "the target's only method of movement is a Fly Speed of
   * 10 feet". Every other mode stays 0 — the walk Longstrider would lengthen
   * is not a method the cloud has — and the ten feet it does have are its
   * Speed, which the increase reaches.
   */
  it('leaves a gaseous creature only its flight, which Longstrider lengthens', () => {
    const cloud = granted(setup(), 'Gaseous Form#cast:93', 'only', { mode: 'fly', feet: 10 });
    expect(speeds(cast(cloud, 'longstrider', 1))).toMatchObject({ walk: 0, fly: 20, climb: 0 });
  });

  it('reads an addition an old log pinned in a mode as reaching that mode alone', () => {
    const old: readonly GameEvent[] = [
      ...setup(),
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Fly#cast:1', change: 'add', feet: 60, mode: 'fly', hover: true },
      },
    ];
    expect(speeds(old)).toMatchObject({ walk: 30, fly: 60 });
  });
});
