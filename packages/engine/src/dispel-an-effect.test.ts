import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveDeclaredCast, resolveSpell } from './commands.js';

/**
 * SRD Dispel Magic: "Choose one creature, object, **or magical effect** within
 * range. Any ongoing spell of level 3 or lower on the target ends."
 *
 * A creature or a declared object was always nameable, because each has a
 * record to hand the engine. A Fog Cloud or a Web runs on nobody — its record
 * is in `state.ongoing` and no creature holds anything of it — so there was no
 * way to aim at it. `CastSpellRequest.magicalEffect` names the running casting
 * by its id: the spell must end spells, the casting must be running and on no
 * creature (one that is on a creature is aimed at through that creature), and
 * the place it holds must be within the Range. The ending is the dispel's own:
 * automatic at or below the slot's level, an ability check above it. (E-L1)
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const WIZARD = id('wizard');
const ALLY = id('ally');

const sheet = (ability: 'wis' | 'int'): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 16, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: ability,
});

const added = (who: CharacterId, ability: 'wis' | 'int'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(ability),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/** The hall, with the cleric this many feet south of its landmark. */
const hall = (south = 0): readonly GameEvent[] => [
  added(CLERIC, 'wis'),
  added(WIZARD, 'int'),
  added(ALLY, 'wis'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['dispel-magic', 'bless'] }),
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: ['fog-cloud', 'silent-image'],
    }),
  },
  ...slots(CLERIC),
  ...slots(WIZARD),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the hall' }, feet: south, bearing: 180 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 5, bearing: 270 } },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: CLERIC, to: WIZARD, seen: true },
];
const HALL = hall();

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('dispel') as Rng,
  content: SRD_CONTENT,
});

const cast = (log: readonly GameEvent[], who: CharacterId, request: Record<string, unknown>) =>
  resolveSpell(fold('s', log), who, request as never, supply(fold('s', log))) as Result<{
    readonly events: readonly GameEvent[];
    readonly castingId?: string | null;
  }>;

/** A Fog Cloud at a point this far north of the cleric. */
const fogged = (
  feet: number,
  room: readonly GameEvent[] = HALL,
): { readonly log: readonly GameEvent[]; readonly castingId: string } => {
  const out = unwrap(
    cast(room, WIZARD, {
      spellId: 'fog-cloud',
      targets: [],
      at: { x: 50, y: 50 + feet, z: 0 },
      slotLevel: 1,
    }),
    'fog cloud',
  );
  return { log: [...room, ...out.events], castingId: out.castingId! };
};

const dispel = (log: readonly GameEvent[], over: Record<string, unknown>) =>
  cast(log, CLERIC, { spellId: 'dispel-magic', targets: [], slotLevel: 3, ...over });

const code = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Dispel Magic aimed at a magical effect', () => {
  it('ends a Fog Cloud that runs on nobody, named by its casting', () => {
    const { log, castingId } = fogged(60);
    expect(fold('s', log).ongoing[castingId]).toBeDefined();
    const out = unwrap(dispel(log, { magicalEffect: castingId }), 'dispel');
    const after = fold('s', [...log, ...out.events]);
    expect(after.ongoing[castingId]).toBeUndefined();
    // The wizard's Concentration went with the cloud.
    expect(after.creatures[WIZARD]!.concentration).toBeNull();
    expect(out.events).toContainEqual({
      type: 'spell-ended',
      castingId,
      on: null,
      reason: 'dispelled',
    });
  });

  it('settles a held casting at the effect its declaration named', () => {
    const { log, castingId } = fogged(60);
    const declared = unwrap(dispel(log, { magicalEffect: castingId, hold: true }), 'declared');
    const open = fold('s', [...log, ...declared.events]);
    const settled = unwrap(
      resolveDeclaredCast(open, declared.castingId!, supply(open)),
      'settled',
    );
    expect(fold('s', [...log, ...declared.events, ...settled.events]).ongoing[castingId]).toBeUndefined();
  });

  it('refuses an effect beyond the Range, before anything is spent', () => {
    // The cloud 100 feet north of the hall and the cleric 40 feet south of it:
    // 140 feet from the place the cloud holds, past the 120 printed. The same
    // cloud from the hall itself is in reach.
    const far = fogged(100, hall(40));
    expect(code(dispel(far.log, { magicalEffect: far.castingId }))).toBe('out_of_range');
    const near = fogged(100);
    expect(code(dispel(near.log, { magicalEffect: near.castingId }))).toBeNull();
  });

  it('ends an effect that holds no place, and says the range was the table’s', () => {
    // SRD Silent Image: an image "within range" that the engine places nowhere,
    // so the distance to it cannot be measured — the casting goes ahead and
    // says so rather than inventing a place.
    const image = unwrap(cast(HALL, WIZARD, { spellId: 'silent-image', targets: [], slotLevel: 1 }), 'image');
    const log = [...HALL, ...image.events];
    expect(fold('s', log).ongoing[image.castingId!]?.origin).toBeUndefined();
    const out = unwrap(dispel(log, { magicalEffect: image.castingId! }), 'dispel') as unknown as {
      readonly events: readonly GameEvent[];
      readonly unverified: readonly string[];
    };
    expect(fold('s', [...log, ...out.events]).ongoing[image.castingId!]).toBeUndefined();
    expect(out.unverified.join(' ')).toContain('within range is the table');
  });

  it('refuses a casting that is on a creature, which is aimed at through the creature', () => {
    const blessed = unwrap(cast(HALL, CLERIC, { spellId: 'bless', targets: [ALLY], slotLevel: 1 }), 'bless');
    const log = [...HALL, ...blessed.events];
    expect(code(dispel(log, { magicalEffect: blessed.castingId! }))).toBe('effect_on_a_creature');
  });

  it('refuses a casting that is not running', () => {
    expect(code(dispel(HALL, { magicalEffect: 'cast:9' }))).toBe('not_ongoing');
  });

  it('refuses the effect beside a target, and on a spell that ends no spells', () => {
    const { log, castingId } = fogged(60);
    expect(code(dispel(log, { magicalEffect: castingId, targets: [ALLY] }))).toBe('effect_and_target');
    expect(
      code(cast(log, WIZARD, { spellId: 'fire-bolt', targets: [], magicalEffect: castingId })),
    ).toBe('no_effect_clause');
  });
});
