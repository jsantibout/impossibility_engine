import { describe, expect, it } from 'vitest';
import { declaredCasting } from './spellcasting.js';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { resolveSpell } from './commands.js';
import { SPELL_DEFINITIONS, definitionFor } from './spell-definitions.js';

/**
 * The spells poured into the shapes, driven rather than inspected.
 *
 * `coverage.test.ts` already asserts every definition against the parsed book
 * for name, level, school, casting time and Concentration — that catches a
 * transcription slip. What it cannot catch is a definition that is internally
 * fine and does nothing useful when cast, so this drives a representative one
 * of each shape through `resolveSpell` and checks the state moved.
 *
 * It also holds the rule that makes the whole batch honest: **a definition
 * that leaves part of its spell out must say so at runtime**, not only in a
 * docstring nobody at the table will read.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 20,
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

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 500,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** Every slot level, so any spell in the catalogue can actually be paid for. */
const slots: GameEvent[] = Array.from({ length: 9 }, (_, i) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(i + 1),
    label: `level ${i + 1} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  added(BYSTANDER),
  ...slots,
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { creature: CASTER }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: BYSTANDER, placement: { from: { creature: CASTER }, feet: 200, bearing: 90 } },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    // A creature that knows the whole catalogue, so any definition can be
    // driven without inventing a class that happens to have it.
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed: string, bonus: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'forced', flat: bonus }],
});

/**
 * A log whose target is whatever kind of creature this spell demands.
 *
 * Animal Friendship wants a Beast and Charm Person wants a Humanoid, and the
 * type check is real — refusing the wrong type is the behaviour, not an
 * obstacle. So the fixture says what the target is rather than the spell being
 * excused the check.
 */
const logFor = (spellId: string): readonly GameEvent[] => {
  const wanted = definitionFor(spellId)?.targets.mustBeType;
  if (wanted === undefined || wanted.toLowerCase() === 'humanoid') return SETUP;
  return [
    ...SETUP,
    { type: 'creature-type-declared', id: TARGET, creatureType: wanted },
    { type: 'creature-type-declared', id: BYSTANDER, creatureType: wanted },
  ];
};

/** Cast at whatever the definition needs: a target, or a place. */
const castAt = (
  state: GameState,
  spellId: string,
  bonus: number,
  seed = 'cast',
): ReturnType<typeof resolveSpell> => {
  const definition = definitionFor(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);

  const slotLevel = definition.level === 0 ? undefined : definition.level;
  const towards = { x: 100, y: 200, z: 0 };
  // The caster's own square. Deliberate: a Cube or Cone excludes its point of
  // origin, so an area placed *on* the target would leave them out of it —
  // correct by the rules, and a fixture that looked like a broken spell.
  const at = { x: 100, y: 100, z: 0 };

  if (definition.area === undefined) {
    // A spell that aims at nobody gets nobody: Detect Magic has no target and
    // passing one is a refusal, not a courtesy.
    const targets = definition.targets.count === 0 ? [] : [TARGET];
    return resolveSpell(
      state,
      CASTER,
      { spellId, targets, ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply(seed, bonus),
    );
  }

  const directional = ['cone', 'cube', 'line'].includes(definition.area.kind);
  return resolveSpell(
    state,
    CASTER,
    {
      spellId,
      targets: [],
      ...(definition.area.origin === 'point' ? { at } : {}),
      ...(directional ? { towards } : {}),
      ...(slotLevel === undefined ? {} : { slotLevel }),
    },
    supply(seed, bonus),
  );
};

describe('every definition in the catalogue actually casts', () => {
  it.each(SPELL_DEFINITIONS.map((d) => [d.id] as const))('resolves %s', (spellId) => {
    // A failed save for anything that allows one, so the interesting branch is
    // the one that runs.
    const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
    expect(out.kind).toBe('resolved');
    if (out.kind !== 'resolved') return;

    expect(out.events.length).toBeGreaterThan(0);

    // Something happened to somebody: a spell that resolves to nothing at all
    // is a definition that compiles and does not work. A **tracked** spell is
    // the deliberate exception — it resolves to a casting and nothing else —
    // and it owes the stronger obligation instead: it must say what the DM is
    // being left to do, or it is a definition that quietly does nothing.
    if (definitionFor(spellId)!.effects.length === 0) {
      expect(out.outcomes).toEqual([]);
      expect(out.unverified.length).toBeGreaterThan(0);
    } else {
      expect(out.outcomes.length).toBeGreaterThan(0);
    }
  });

  it.each(SPELL_DEFINITIONS.map((d) => [d.id] as const))('spends exactly one casting for %s', (spellId) => {
    const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
    if (out.kind !== 'resolved') return;
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
  });

  /** Same state, same seed, same batch — twice. */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id] as const))('is deterministic for %s', (spellId) => {
    const log = logFor(spellId);
    const first = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    const second = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    expect(first).toEqual(second);
  });

  it.each(SPELL_DEFINITIONS.map((d) => [d.id] as const))('replays %s prefix by prefix', (spellId) => {
    const base = logFor(spellId);
    const out = unwrap(castAt(fold('seed', base), spellId, -40), spellId);
    if (out.kind !== 'resolved') return;
    const log = [...base, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});

describe('a definition that leaves part of its spell out says so', () => {
  const withGaps = SPELL_DEFINITIONS.filter((d) => (d.unmodelled ?? []).length > 0);

  it('has spells that admit to gaps, and spells that do not', () => {
    expect(withGaps.length).toBeGreaterThan(0);
    expect(withGaps.length).toBeLessThan(SPELL_DEFINITIONS.length);
  });

  it.each(withGaps.map((d) => [d.id, d] as const))(
    'reports what %s does not do, on the casting itself',
    (spellId, definition) => {
      const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
      if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /** Fireball does everything Fireball does, so it claims nothing. */
  it('says nothing about a spell it fully executes', () => {
    const out = unwrap(castAt(base(), 'fireball', -40), 'fireball');
    if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
    expect(out.unverified).toEqual([]);
  });
});

describe('the shapes behave as their spells describe', () => {
  /** SRD Hold Monster is Hold Person without the Humanoid restriction. */
  it('holds a creature of any type, where Hold Person would not', () => {
    const dragon = fold('seed', [
      ...SETUP,
      { type: 'creature-type-declared', id: TARGET, creatureType: 'Dragon' },
    ]);

    const person = resolveSpell(
      dragon,
      CASTER,
      { spellId: 'hold-person', targets: [TARGET], slotLevel: 2 },
      supply('hold', -40),
    );
    expect(isErr(person)).toBe(true);
    if (isErr(person)) expect(person.code).toBe('wrong_creature_type');

    const monster = unwrap(
      resolveSpell(
        dragon,
        CASTER,
        { spellId: 'hold-monster', targets: [TARGET], slotLevel: 5 },
        supply('hold', -40),
      ),
      'hold-monster',
    );
    if (monster.kind !== 'resolved') throw new Error('expected a resolved cast');
    expect(monster.outcomes[0]?.condition).toBe('paralyzed');
  });

  /**
   * SRD Blindness/Deafness lasts 1 minute with **no** Concentration, which is
   * a duration running on the clock rather than on the caster's attention.
   */
  it('runs a timed condition without the caster concentrating', () => {
    const out = unwrap(castAt(base(), 'blindness-deafness', -40), 'blind');
    if (out.kind !== 'resolved') throw new Error('expected a resolved cast');

    const after = fold('seed', [...SETUP, ...out.events]);
    expect(after.creatures.target!.conditions.conditions).toContain('blinded');
    expect(after.creatures.caster!.concentration).toBeNull();
  });

  /** SRD Circle of Death grows by **2**d8 a level, not by one. */
  it('scales Circle of Death two dice at a time', () => {
    const low = unwrap(
      resolveSpell(
        base(),
        CASTER,
        { spellId: 'circle-of-death', targets: [], at: { x: 100, y: 105, z: 0 }, slotLevel: 6 },
        supply('cod', -40),
      ),
      'low',
    );
    const high = unwrap(
      resolveSpell(
        base(),
        CASTER,
        { spellId: 'circle-of-death', targets: [], at: { x: 100, y: 105, z: 0 }, slotLevel: 7 },
        supply('cod', -40),
      ),
      'high',
    );
    if (low.kind !== 'resolved' || high.kind !== 'resolved') throw new Error('unresolved');
    expect(high.outcomes[0]?.damage ?? 0).toBeGreaterThan(low.outcomes[0]?.damage ?? 0);
  });

  /**
   * SRD Eldritch Blast's upgrade adds *beams*, not dice, so its damage must
   * not grow with caster level the way every other attack cantrip's does.
   */
  it('keeps Eldritch Blast at one die however high the caster', () => {
    const blast = definitionFor('eldritch-blast');
    const bolt = definitionFor('fire-bolt');
    const blastEffect = blast?.effects[0];
    const boltEffect = bolt?.effects[0];
    if (blastEffect?.kind !== 'attack' || boltEffect?.kind !== 'attack') {
      throw new Error('expected attack effects');
    }
    expect(blastEffect.damage.cantripUpgradesAt).toBeUndefined();
    expect(boltEffect.damage.cantripUpgradesAt).toEqual([5, 11, 17]);
  });
});
