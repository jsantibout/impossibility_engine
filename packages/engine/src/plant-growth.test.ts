/**
 * SRD Plant Growth: "**Casting Time:** Action (Overgrowth) or 8 hours
 * (Enrichment)", and "This spell channels vitality into plants. The casting time
 * you use determines whether the spell has the Overgrowth or the Enrichment
 * effect below."
 *
 * **A branch chosen by how long you spend on it.** Branches were already the
 * engine's — Command's five words, Magic Circle's two directions — and the extra
 * turn of the screw here is that the two do not share a casting time, and a
 * definition carries one. `SpellOption.castingTime` is that field, read by
 * `castingOf` beside the route's stated time and the definition's own, with the
 * seconds travelling with it: an Action for the thick ground, and a rite of
 * eight hours for the year of doubled harvests.
 *
 * The Enrichment's content is fiction — half a mile of crops, a calendar of what
 * a field has already had cast on it — so the branch hands its sentences over
 * and resolves nothing. What is under test is that it is *castable at all*, and
 * over the span the book prints.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, isNeedsContext, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { terrainAt, type Point, type TerrainRegion } from './positioning.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { costOfRoute } from './positioning.js';
import {
  advanceTime,
  declarePlants,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const FIELD: Point = { x: 200, y: 200, z: 0 };

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: DRUID,
    name: 'the druid',
    sheet: sheet(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['plant-growth', 'web'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the meadow', at: FIELD },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the meadow' }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('green') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The table says normal plants grow over the whole meadow. */
const GROWING: readonly GameEvent[] = [
  { type: 'plants-declared', name: 'the meadow', region: { origin: { space: FIELD }, shape: { kind: 'sphere', radius: 150 } }, growing: true },
];

const cast = (log: readonly GameEvent[], option: string) => {
  const state = fold('seed', log);
  return resolveSpell(
    state,
    DRUID,
    { spellId: 'plant-growth', targets: [], at: FIELD, option } as never,
    supply(state),
  );
};

describe('SRD Plant Growth: a branch with its own casting time', () => {
  it('lays the thick ground when it is cast as an Action', () => {
    const out = unwrap(cast([...SETUP, ...GROWING], 'overgrowth'), 'overgrowth');
    // An Action is spent now, so the casting resolves rather than being
    // declared: nothing is pending afterwards.
    const after = fold('seed', [...SETUP, ...GROWING, ...out.events]);
    expect(pendingCastingsOf(after)).toEqual([]);

    // "must spend 4 feet of movement for every 1 foot it moves" — a foot of the
    // Sphere costs four, which is the patch the branch laid.
    const plain = costOfRoute(fold('seed', SETUP), [FIELD, { x: 205, y: 200, z: 0 }]);
    const thick = costOfRoute(after, [FIELD, { x: 205, y: 200, z: 0 }]);
    expect(thick.cost).toBe(plain.cost * 4);
  });

  it('declares a rite of eight hours when it is cast as the Enrichment', () => {
    const declared = unwrap(cast(SETUP, 'enrichment'), 'enrichment');
    expect(declared.castingId).not.toBeNull();

    const open = fold('seed', [...SETUP, ...declared.events]);
    const pending = pendingCastingsOf(open);
    expect(pending).toHaveLength(1);
    // Eight hours on the clock, not an Action and not the definition's absent
    // span: the branch's own time and the branch's own seconds.
    expect(pending[0]!.completesAt).toEqual({ kind: 'elapsed', at: 8 * 60 * 60 });
  });

  it('settles the Enrichment when the eight hours have passed, and hands over its text', () => {
    const declared = unwrap(cast(SETUP, 'enrichment'), 'enrichment');
    const open = [...SETUP, ...declared.events];
    const ticked = [
      ...open,
      ...unwrap(advanceTime(fold('seed', open), 8 * 60 * 60, 'the long work'), 'the clock'),
    ];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', ticked), declared.castingId!, supply(fold('seed', ticked))),
      'settle',
    );

    const said = settled.unverified.join('\n');
    expect(said).toContain('twice the normal amount of food');
    // And the Overgrowth's own sentence is not spoken by the branch nobody ran.
    expect(said).not.toContain('4 feet of movement');
  });

  it('refuses a casting that names no branch', () => {
    const state = fold('seed', SETUP);
    const refused = resolveSpell(
      state,
      DRUID,
      { spellId: 'plant-growth', targets: [], at: FIELD } as never,
      supply(state),
    );
    expect(isErr(refused) && refused.code).toBe('option_required');
  });

  /** And the Enrichment lays no thick ground, which is the other branch's clause. */
  it('does not thicken the ground when the Enrichment is the branch cast', () => {
    const declared = unwrap(cast(SETUP, 'enrichment'), 'enrichment');
    const open = [...SETUP, ...declared.events];
    const ticked = [
      ...open,
      ...unwrap(advanceTime(fold('seed', open), 8 * 60 * 60, 'the long work'), 'the clock'),
    ];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', ticked), declared.castingId!, supply(fold('seed', ticked))),
      'settle',
    );
    const after = fold('seed', [...ticked, ...settled.events]);

    const plain = costOfRoute(fold('seed', SETUP), [FIELD, { x: 205, y: 200, z: 0 }]);
    const later = costOfRoute(after, [FIELD, { x: 205, y: 200, z: 0 }]);
    expect(later.cost).toBe(plain.cost);
  });
});

/**
 * SRD Plant Growth's Overgrowth: "All **normal plants** in a 100-foot-radius
 * Sphere centered on that point become thick and overgrown. A creature moving
 * through that area must spend 4 feet of movement for every 1 foot it moves.
 * **You can exclude one or more areas of any size within the spell's area from
 * being affected.**" (E-L2, the owner's ruling of 2026-10-03: "only where
 * plants grow")
 *
 * Where normal plants grow is the table's to say (`declarePlants`, the DM's
 * door), and the casting asks when nobody has said anything about the Sphere.
 * The ground thickens only where the table said plants grow, less what the
 * table said is bare and less the areas the caster excludes; all of it is
 * pinned onto the patch, so the plants declared later change nothing laid.
 */
describe('SRD Plant Growth thickens only where plants grow', () => {
  const at = (x: number, y: number): Point => ({ x, y, z: 0 });
  const sphere = (where: Point, radius: number): TerrainRegion => ({ origin: { space: where }, shape: { kind: 'sphere', radius } });
  /** A garden in the middle of the Sphere, and a space well inside the Sphere but outside it. */
  const GARDEN = sphere(FIELD, 30);
  const IN_THE_GARDEN = at(215, 200);
  const BARE_GROUND = at(260, 200);

  const declared = (log: readonly GameEvent[], name: string, region: TerrainRegion | null, growing = true) =>
    unwrap(declarePlants(fold('seed', log), name, region, { growing }), name);

  const overgrow = (log: readonly GameEvent[], exclude?: readonly TerrainRegion[]) => {
    const state = fold('seed', log);
    return resolveSpell(
      state,
      DRUID,
      { spellId: 'plant-growth', targets: [], at: FIELD, option: 'overgrowth', ...(exclude === undefined ? {} : { exclude }) } as never,
      supply(state),
    );
  };

  it('asks where plants grow when nobody has said, and spends nothing', () => {
    const asked = overgrow(SETUP);
    expect(isNeedsContext(asked)).toBe(true);
    expect(!asked.ok && asked.code).toBe('plants_unstated');
  });

  it('pins the plants the table declares, and takes them away again', () => {
    const log = [...SETUP, ...declared(SETUP, 'the garden', GARDEN)];
    expect(fold('seed', log).scene!.plants?.['the garden']).toEqual({ region: GARDEN, growing: true });
    const gone = [...log, ...declared(log, 'the garden', null)];
    expect(fold('seed', gone).scene!.plants?.['the garden']).toBeUndefined();
  });

  it('thickens the garden and leaves the bare ground of the Sphere open', () => {
    const log = [...SETUP, ...declared(SETUP, 'the garden', GARDEN)];
    const out = unwrap(overgrow(log), 'overgrowth');
    const after = fold('seed', [...log, ...out.events]);
    expect(terrainAt(after, IN_THE_GARDEN).costPerFoot).toBe(4);
    expect(terrainAt(after, BARE_GROUND).costPerFoot).toBe(1);
  });

  it('casts over ground the table said is bare, and thickens none of it', () => {
    const log = [...SETUP, ...declared(SETUP, 'the courtyard', sphere(FIELD, 120), false)];
    const out = unwrap(overgrow(log), 'overgrowth');
    const after = fold('seed', [...log, ...out.events]);
    expect(terrainAt(after, IN_THE_GARDEN).costPerFoot).toBe(1);
  });

  it('leaves out the areas the caster excludes', () => {
    const log = [...SETUP, ...declared(SETUP, 'the garden', GARDEN)];
    const out = unwrap(overgrow(log, [sphere(FIELD, 5)]), 'overgrowth');
    const after = fold('seed', [...log, ...out.events]);
    expect(terrainAt(after, FIELD).costPerFoot).toBe(1);
    expect(terrainAt(after, at(225, 200)).costPerFoot).toBe(4);
  });

  it('keeps the ground it laid when the table changes its mind about the plants', () => {
    const log = [...SETUP, ...declared(SETUP, 'the garden', GARDEN)];
    const laid = [...log, ...unwrap(overgrow(log), 'overgrowth').events];
    const later = [...laid, ...declared(laid, 'the garden', null)];
    expect(terrainAt(fold('seed', later), IN_THE_GARDEN).costPerFoot).toBe(4);
  });

  it('refuses an exclusion on a spell that prints none', () => {
    const state = fold('seed', [...SETUP, ...GROWING]);
    const refused = resolveSpell(
      state,
      DRUID,
      { spellId: 'web', targets: [], at: at(210, 210), towards: at(230, 210), exclude: [sphere(FIELD, 5)], slotLevel: 2 } as never,
      supply(state),
    );
    expect(isErr(refused) && refused.code).toBe('nothing_to_exclude');
  });

  it('prints the narrowing on the Overgrowth, and refuses ground that grows nothing', () => {
    const definition = SRD_CONTENT.spell('plant-growth')!;
    expect(definition.options?.['overgrowth']?.areaTerrain).toEqual({
      costPerFoot: 4,
      onlyWhere: 'plants-grow',
      casterMayExclude: true,
    });
    const codes = (areaTerrain: unknown) =>
      checkSpellDefinitionValue({ ...definition, options: { ...definition.options, overgrowth: { ...definition.options!['overgrowth']!, areaTerrain } } }).map((one) => one.code);
    expect(codes({ costPerFoot: 4, onlyWhere: 'mushrooms' })).toContain('unknown_ground');
    expect(codes({ costPerFoot: 4, casterMayExclude: false })).toContain('bad_exclusion');
  });
});
