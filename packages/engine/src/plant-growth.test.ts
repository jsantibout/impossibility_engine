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
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import type { Point } from './positioning.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { costOfRoute } from './positioning.js';
import {
  advanceTime,
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
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['plant-growth'] }),
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
    const out = unwrap(cast(SETUP, 'overgrowth'), 'overgrowth');
    // An Action is spent now, so the casting resolves rather than being
    // declared: nothing is pending afterwards.
    const after = fold('seed', [...SETUP, ...out.events]);
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
