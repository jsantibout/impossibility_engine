import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveSpell } from './commands.js';

/**
 * Healing that raises the dead.
 *
 * > SRD Revivify: "You touch a creature that has died within the last minute.
 * > That creature revives with 1 Hit Point. This spell can't revive a creature
 * > that has died of old age, nor does it restore any missing body parts."
 *
 * `healCreature` refuses a corpse and the refusal costs no slot, which is the
 * rule `docs/design/spell-definitions.md` says this shape has to get past:
 * lifting death is not hit points with a small number in them. So it is its
 * own effect kind and its own event, and the minute is measured against a
 * fact the vitals did not hold — `diedAt`, stamped by the seam that owns every
 * way a creature dies rather than by any one of the events that can do it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const FALLEN = id('fallen');
const HALE = id('hale');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(FALLEN),
  added(HALE),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['revivify'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  { type: 'creature-placed', id: FALLEN, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'creature-placed', id: HALE, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'sight-declared', from: CLERIC, to: FALLEN, seen: true },
  { type: 'sight-declared', from: CLERIC, to: HALE, seen: true },
];

/** The fallen dies, and then this many seconds go by. */
const dead = (after: number): GameState =>
  fold('seed', [
    ...SETUP,
    { type: 'creature-died', id: FALLEN, cause: 'an ogre’s club' },
    { type: 'time-advanced', seconds: after, reason: 'the fixture waits' },
  ]);

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('revive') as Rng,
  content: SRD_CONTENT,
});

const cast = (state: GameState, at: CharacterId) =>
  resolveSpell(state, CLERIC, { spellId: 'revivify', targets: [at], slotLevel: 3 }, supply());

describe('what a definition may say about raising the dead', () => {
  const definition = (effect: unknown): unknown => ({
    id: 'homebrew-quickening',
    name: 'Homebrew Quickening',
    level: 3,
    school: 'necromancy',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1 },
    effects: [effect],
    unmodelled: ['what a soul wants is the DM’s'],
  });

  const codes = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(effect)).map((one) => one.code);

  it('accepts a window and a hit point total', () => {
    expect(codes({ kind: 'revive', within: 60, hitPoints: 1 })).toEqual([]);
  });

  it('refuses a window that is not a whole number of seconds', () => {
    expect(codes({ kind: 'revive', within: 0, hitPoints: 1 })).toContain('bad_window');
  });

  it('refuses a revival that leaves the creature at no hit points', () => {
    expect(codes({ kind: 'revive', within: 60, hitPoints: 0 })).toContain('bad_revival');
  });
});

describe('Revivify', () => {
  it('brings a creature dead for thirty seconds back at one hit point', () => {
    const before = dead(30);
    expect(before.creatures[FALLEN]?.vitals.dead).toBe(true);
    const out = unwrap(cast(before, FALLEN), 'the revival');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[FALLEN]?.vitals.dead).toBe(false);
    expect(after.creatures[FALLEN]?.vitals.hp).toBe(1);
    expect(after.creatures[FALLEN]?.vitals.diedAt).toBeNull();
  });

  it('starts the death saves afresh', () => {
    const before = fold('seed', [
      ...SETUP,
      { type: 'death-save-recorded', id: FALLEN, natural: 3 },
      { type: 'creature-died', id: FALLEN, cause: 'an ogre’s club' },
      { type: 'time-advanced', seconds: 6, reason: 'the fixture waits' },
    ]);
    const out = unwrap(cast(before, FALLEN), 'the revival');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[FALLEN]?.vitals.deathSaveFailures).toBe(0);
    expect(after.creatures[FALLEN]?.vitals.deathSaveSuccesses).toBe(0);
    expect(after.creatures[FALLEN]?.vitals.stable).toBe(false);
  });

  it('refuses a creature dead for ninety seconds', () => {
    const out = cast(dead(90), FALLEN);
    expect(isErr(out) && out.code).toBe('died_too_long_ago');
  });

  it('refuses a creature who is alive', () => {
    const out = cast(dead(30), HALE);
    expect(isErr(out) && out.code).toBe('not_dead');
  });

  it('costs nothing when it refuses', () => {
    const before = dead(90);
    const out = cast(before, FALLEN);
    expect(isErr(out)).toBe(true);
    expect(before.creatures[CLERIC]?.resources.pools[spellSlotKey(3)]?.spent ?? 0).toBe(0);
  });

  /**
   * **All four ways a creature dies, because the stamp claims all four.**
   *
   * `stampDeaths` is derived from the transition rather than from any one
   * event, on the argument that a list of the events that can kill somebody is
   * not a list anybody could keep correct — and that argument is only worth
   * anything if the other three are driven. A monster dies inside
   * `applyDamageToVitals` off a `damage-taken`, a character off a third failed
   * `death-save-recorded`, another at Exhaustion 6 off an `exhaustion-set`,
   * and `creature-died` is the deaths nobody else settled.
   */
  it.each([
    [
      'damage a monster cannot survive',
      // SRD: "A monster dies the instant it drops to 0 Hit Points", which is
      // `diesAtZero` and the route that never writes `creature-died` at all.
      true,
      [
        { type: 'damage-taken', id: FALLEN, amount: 40, source: 'an ogre’s club' },
      ] as readonly GameEvent[],
    ],
    [
      'a third failed death saving throw',
      // A character, so the blow drops them rather than killing them and the
      // three failures are what does it.
      false,
      [
        { type: 'hit-points-dropped-to-zero', id: FALLEN, source: 'an ogre’s club' },
        { type: 'death-save-recorded', id: FALLEN, natural: 3 },
        { type: 'death-save-recorded', id: FALLEN, natural: 4 },
        { type: 'death-save-recorded', id: FALLEN, natural: 5 },
      ] as readonly GameEvent[],
    ],
    [
      'Exhaustion reaching six',
      false,
      [{ type: 'exhaustion-set', id: FALLEN, level: 6 }] as readonly GameEvent[],
    ],
  ])('stamps the moment of death when it comes from %s', (_how, diesAtZero, killing) => {
    const before = fold('seed', [
      ...SETUP.map((event) =>
        event.type === 'creature-added' && event.id === FALLEN
          ? { ...event, diesAtZero }
          : event,
      ),
      ...killing,
      { type: 'time-advanced', seconds: 30, reason: 'the fixture waits' },
    ]);
    expect(before.creatures[FALLEN]?.vitals.dead, _how).toBe(true);
    expect(before.creatures[FALLEN]?.vitals.diedAt, _how).toBe(0);
    // And none of the three is the event the stamp would have been easy to
    // hang on, which is the whole point of driving them.
    expect(killing.some((event) => event.type === 'creature-died'), _how).toBe(false);

    const out = unwrap(cast(before, FALLEN), 'the revival');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[FALLEN]?.vitals.hp, _how).toBe(1);
  });

  it('stamps the moment a creature died and clears it on the way back', () => {
    const before = dead(30);
    expect(before.creatures[FALLEN]?.vitals.diedAt).toBe(0);
    const out = unwrap(cast(before, FALLEN), 'the revival');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[FALLEN]?.vitals.diedAt).toBeNull();
  });
});
