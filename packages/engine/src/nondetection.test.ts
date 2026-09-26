import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { endOngoingSpell, resolveSpell } from './commands.js';

/**
 * SRD Nondetection:
 *
 * > "For the duration, you hide a target that you touch from Divination magic.
 * > The target can be a willing creature, or it can be a place or an object no
 * > larger than 10 feet in any dimension. **The target can't be targeted by
 * > any Divination spell** or perceived through magical scrying sensors."
 *
 * A creature that refuses a casting rather than an area that does: the ward
 * is a school pinned onto the casting's record, and `resolveSpell`'s
 * pre-flight — the one place a casting checks its targets — refuses a
 * Divination that names the warded creature before anything is spent, with
 * the ward named. A ranger's Hunter's Mark at the goblin is refused; a Fire
 * Bolt is not, and neither is the same Hunter's Mark once the ward has ended.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const RANGER = id('ranger');
const GOBLIN = id('goblin');

const sheet = (ability: 'int' | 'wis'): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 10, int: 18, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: ability,
});

const added = (who: CharacterId, ability: 'int' | 'wis'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(ability),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === GOBLIN ? 'foes' : 'party',
});

const pool = (who: CharacterId, level: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: who,
  pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'int'),
  added(RANGER, 'wis'),
  added(GOBLIN, 'int'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['nondetection'] }),
  },
  pool(WIZARD, 3),
  {
    type: 'spellcasting-declared',
    id: RANGER,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['hunters-mark', 'fire-bolt'] }),
  },
  pool(RANGER, 1),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the glade', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the glade' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: RANGER, placement: { from: { creature: GOBLIN }, feet: 30, bearing: 90 } },
  { type: 'sight-declared', from: RANGER, to: GOBLIN, seen: true },
];

const supply = (seed = 'ward') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The wizard hides the (willing) goblin from Divination magic. */
const warded = () => {
  const cast = unwrap(
    resolveSpell(
      state(SETUP),
      WIZARD,
      { spellId: 'nondetection', targets: [GOBLIN], slotLevel: 3, willing: [GOBLIN] },
      supply(),
    ),
    'Nondetection',
  );
  return { log: [...SETUP, ...cast.events], casting: cast.castingId! };
};

const slotsLeft = (world: GameState, who: CharacterId, level: number): number =>
  remaining(world.creatures[who]!.resources, spellSlotKey(level));

describe('the definition', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'nondetection')!;

  it('wards its target against Divination for eight hours, and hands the sensors to the table', () => {
    expect(definition().wardsTargets).toEqual({ school: 'divination' });
    expect(definition().durationSeconds).toBe(28_800);
    expect(definition().unmodelled).toHaveLength(1);
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses a ward against nothing the book prints, on nobody, or for no time', () => {
    const codes = (over: Record<string, unknown>): readonly string[] =>
      checkSpellDefinitionValue({ ...definition(), ...over }).map((one) => one.code);
    expect(codes({ wardsTargets: { school: 'hedge-wizardry' } })).toContain('bad_ward');
    expect(codes({ targets: { count: 0 } })).toContain('bad_ward');
    expect(codes({ durationSeconds: undefined })).toContain('bad_ward');
  });
});

describe('a creature hidden from Divination magic', () => {
  it('refuses a Hunter’s Mark aimed at the goblin, with nothing spent and the ward named', () => {
    const { log } = warded();
    const before = state(log);
    const out = resolveSpell(before, RANGER, { spellId: 'hunters-mark', targets: [GOBLIN], slotLevel: 1 }, supply('mark'));
    expect(isErr(out) && out.code).toBe('warded');
    expect(isErr(out) && out.reason).toContain('Nondetection');
    expect(isErr(out) && out.reason).toContain('divination');
    // A refusal is a value: the slot is where it was.
    expect(slotsLeft(before, RANGER, 1)).toBe(3);
  });

  it('lets a Fire Bolt through, because the ward is against a school', () => {
    const { log } = warded();
    const out = resolveSpell(state(log), RANGER, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply('bolt'));
    expect(out.ok).toBe(true);
  });

  it('holds the ward on the casting’s record, and lifts it with the casting', () => {
    const { log, casting } = warded();
    const before = state(log);
    expect(before.ongoing[casting]?.wardsTargets).toEqual({ school: 'divination' });
    expect(before.ongoing[casting]?.aimed).toEqual([GOBLIN]);

    const ended = unwrap(endOngoingSpell(before, WIZARD, casting, null), 'the ward let go');
    const after = state([...log, ...ended]);
    const out = resolveSpell(after, RANGER, { spellId: 'hunters-mark', targets: [GOBLIN], slotLevel: 1 }, supply('mark'));
    expect(out.ok).toBe(true);
  });

  it('wards only the creature the casting is on', () => {
    const { log } = warded();
    const withSight: GameEvent[] = [...log, { type: 'sight-declared', from: RANGER, to: WIZARD, seen: true }];
    const out = resolveSpell(state(withSight), RANGER, { spellId: 'hunters-mark', targets: [WIZARD], slotLevel: 1 }, supply('mark'));
    expect(out.ok).toBe(true);
  });
});
