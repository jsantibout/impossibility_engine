import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { lightAt, type Point } from './positioning.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { activateSpell, ongoingSpellOf, resolveSpell } from './commands.js';

/**
 * SRD Flaming Sphere: "You create a 5-foot-diameter sphere of fire in an
 * **unoccupied space on the ground** within range." (W9-S4)
 *
 * Two refusals the point of an area never had. Occupancy is the engine's own
 * fact, read off the lattice; the ground is the lattice floor, which
 * `altitudeOf` calls "the only floor the engine has". The rule is the
 * definition's — `area.pointOnUnoccupiedGround` — so Fireball's point, which
 * the book lets go anywhere in range, is untouched.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 9,
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
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

const DRUID_AT: Point = { x: 100, y: 100, z: 0 };
const GOBLIN_AT: Point = { x: 130, y: 100, z: 0 };
const EMPTY_FLOOR: Point = { x: 130, y: 120, z: 0 };
const IN_THE_AIR: Point = { x: 130, y: 120, z: 10 };

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['flaming-sphere', 'fireball'] }),
  },
  ...[2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 3, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: DRUID_AT }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { point: GOBLIN_AT }, feet: 0 } },
];

const state = (log: readonly GameEvent[] = SETUP): GameState => fold('seed', log);

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('sphere') as Rng, content: SRD_CONTENT });

const cast = (spellId: string, at: Point, slotLevel?: number): Result<{ events: readonly GameEvent[] }> =>
  resolveSpell(state(), DRUID, { spellId, targets: [], at, ...(slotLevel === undefined ? {} : { slotLevel }) }, supply());

const code = (out: Result<unknown>): string => (isErr(out) ? out.code : 'cast');

describe('the definition', () => {
  const sphere = () => SPELL_DEFINITIONS.find((d) => d.id === 'flaming-sphere')!;

  it('writes the clause on its area and owes nothing for it', () => {
    expect(sphere().area).toEqual({ kind: 'sphere', radius: 20, origin: 'point', pointOnUnoccupiedGround: true });
    expect(sphere().unmodelled ?? []).toEqual([]);
    expect(checkSpellDefinitionValue(sphere())).toEqual([]);
  });

  it('refuses a clause that is not true, or one on an area that does not start at a point', () => {
    const codes = (over: Record<string, unknown>): readonly string[] =>
      checkSpellDefinitionValue({ ...sphere(), ...over }).map((one) => one.code);
    expect(codes({ area: { kind: 'sphere', radius: 20, origin: 'point', pointOnUnoccupiedGround: 'yes' } })).toContain(
      'malformed_field',
    );
    expect(
      codes({ area: { kind: 'emanation', distance: 20, origin: 'self', pointOnUnoccupiedGround: true } }),
    ).toContain('ground_point_without_point');
  });
});

describe('an unoccupied space on the ground', () => {
  it('refuses a point in the goblin’s space', () => {
    const out = cast('flaming-sphere', GOBLIN_AT);
    expect(code(out)).toBe('point_occupied');
    // Who is standing there is not said: an unseen occupant is not named.
    expect(isErr(out) && out.reason).not.toContain(GOBLIN);
  });

  it('refuses a point ten feet up', () => {
    const out = cast('flaming-sphere', IN_THE_AIR);
    expect(code(out)).toBe('point_not_on_ground');
  });

  it('conjures the sphere on an empty floor space, and lays its light', () => {
    const out = unwrap(cast('flaming-sphere', EMPTY_FLOOR), 'Flaming Sphere on the floor');
    const after = state([...SETUP, ...out.events]);
    expect(lightAt(after, EMPTY_FLOOR).level).toBe('bright');
  });

  it('leaves Fireball’s point where the book lets it go: in a creature’s space, or in the air', () => {
    expect(code(cast('fireball', GOBLIN_AT, 3))).toBe('cast');
    expect(code(cast('fireball', IN_THE_AIR, 3))).toBe('cast');
  });
});

/**
 * SRD Flaming Sphere: "As a Bonus Action, you can move the sphere up to 30
 * feet, **rolling it along the ground**. If you move the sphere into a
 * creature's space, that creature makes the save against the sphere, and the
 * sphere stops moving for the turn." (W9-T)
 *
 * The roll is held to the ground the cast is: a space above the lattice floor
 * is refused, as the point is at the casting, whether it is where the roll
 * ends or a step along the way. A creature's space is **not** refused — the
 * book says what happens when the sphere is rolled into one, and it is the
 * ram, which stops the sphere there.
 */
describe('the sphere rolled along the ground', () => {
  const conjured = (): { readonly log: readonly GameEvent[]; readonly sphere: string } => {
    const out = unwrap(
      resolveSpell(state(), DRUID, { spellId: 'flaming-sphere', targets: [], at: EMPTY_FLOOR }, supply()),
      'Flaming Sphere on the floor',
    );
    return { log: [...SETUP, ...out.events], sphere: out.castingId! };
  };

  const roll = (log: readonly GameEvent[], castingId: string, to: Point, via?: readonly Point[]) =>
    activateSpell(
      state(log),
      DRUID,
      { castingId, targets: [], to, ...(via === undefined ? {} : { via }) },
      supply(),
    );

  it('rolls five feet along the empty floor', () => {
    const { log, sphere } = conjured();
    const to: Point = { x: 130, y: 125, z: 0 };
    const out = unwrap(roll(log, sphere, to), 'the roll');
    expect(ongoingSpellOf(state([...log, ...out.events]), sphere)?.origin).toEqual(to);
  });

  it('refuses a roll that ends ten feet up', () => {
    const { log, sphere } = conjured();
    expect(code(roll(log, sphere, { x: 130, y: 125, z: 10 }))).toBe('point_not_on_ground');
  });

  it('refuses a roll that leaves the ground on the way, and lands on it again', () => {
    const { log, sphere } = conjured();
    const out = roll(log, sphere, { x: 130, y: 130, z: 0 }, [{ x: 130, y: 125, z: 5 }]);
    expect(code(out)).toBe('point_not_on_ground');
  });

  it('rolls into the goblin’s space, which the book calls a ram and not a refusal, and stops there', () => {
    const { log, sphere } = conjured();
    const out = unwrap(
      roll(log, sphere, GOBLIN_AT, [
        { x: 130, y: 115, z: 0 },
        { x: 130, y: 110, z: 0 },
        { x: 130, y: 105, z: 0 },
      ]),
      'the ram',
    );
    expect(ongoingSpellOf(state([...log, ...out.events]), sphere)?.origin).toEqual(GOBLIN_AT);
    expect(
      out.events.some((event) => event.type === 'area-effect-settled' && event.target === GOBLIN),
    ).toBe(true);
  });
});
