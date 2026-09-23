/**
 * Three features that change what a casting costs, driven through the
 * catalogue's own transcription.
 *
 * - **SRD Wild Companion**: Find Familiar paid for out of Wild Shape's pool or
 *   a slot, the familiar Fey whatever the caster says, and gone when the
 *   Druid finishes a Long Rest — a third lifetime for a kept summons.
 * - **SRD Ritual Adept**: a Ritual-tagged spell cast from the spellbook
 *   unprepared, with no slot; refused for a spell that is not a ritual, and
 *   for a ritual that is not in the book.
 * - **SRD Paladin's Smite**: Divine Smite cast on a hit once per Long Rest
 *   without a slot, out of the feature's own pool of one.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { beginRest, endRest } from './rest.js';
import { createRollIssuer } from './rolls.js';
import {
  advanceTime,
  dismissStrandedSummons,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveSpell,
  strandedSummons,
} from './commands.js';

const HERO = asCharacterId('hero');
const GOBLIN = asCharacterId('goblin');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const refused = (result: Result<unknown>): string | null => (result.ok ? null : result.code);

const run = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

// — Fixtures —————————————————————————————————————————————————————————————————

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

/** A Druid 2: Wild Shape and Wild Companion arrive together. */
const druid = (): CharacterChoices => ({
  ...common,
  name: 'Fenn',
  classId: 'druid',
  level: 2,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['nature', 'perception'],
  cantrips: ['druidcraft', 'guidance'],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'faerie-fire', 'fog-cloud', 'goodberry', 'healing-word'],
  featureChoices: { ...common.featureChoices, 'druid:primal-order': ['Magician'] },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
});

/** A Wizard 1 whose book holds two rituals it has not prepared. */
const wizard = (): CharacterChoices => ({
  ...common,
  name: 'Ander',
  classId: 'wizard',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  cantrips: ['fire-bolt', 'prestidigitation', 'ray-of-frost'],
  spellbook: ['magic-missile', 'shield', 'detect-magic', 'find-familiar', 'mage-armor', 'sleep'].map(
    (spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const }),
  ),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  featureChoices: { ...common.featureChoices, 'wizard:scholar': ['arcana'] },
});

/** A Paladin 2: Paladin's Smite arrives with the level. */
const paladin = (): CharacterChoices => ({
  ...common,
  name: 'Aelric',
  classId: 'paladin',
  level: 2,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  cantrips: [],
  spellbook: [],
  preparedSpells: ['bless', 'cure-wounds', 'heroism'],
  featureChoices: { ...common.featureChoices, 'paladin:weapon-mastery': [] },
  feats: { ...common.feats, 'paladin:fighting-style': { featId: 'defense' } },
});

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const made = (choices: CharacterChoices): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, choices, HERO), choices.name);

/** The hero in a study, placed, with nobody's turn running. */
const study = (choices: CharacterChoices): GameEvent[] => [
  ...made(choices),
  { type: 'creature-side-declared', id: HERO, side: 'party' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the desk', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the desk' }, feet: 0 } },
];

const KNOWN = new Set<string>([HERO, GOBLIN]);
const summonedIn = (state: GameState): readonly CharacterId[] =>
  (Object.keys(state.creatures) as CharacterId[]).filter((key) => !KNOWN.has(key)).sort();

const HOUR = 3600;

/** Declare a long casting, let the hour pass, settle it. */
const rite = (
  state: GameState,
  request: Record<string, unknown>,
  seed: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } => {
  const declared = unwrap(
    resolveSpell(state, HERO, { targets: [HERO], ...request } as never, supply(seed)),
    'declare',
  );
  const castingId = declared.castingId;
  if (castingId === null || castingId === undefined) throw new Error('no casting was declared');
  let current = run(state, declared.events);
  const passed = unwrap(advanceTime(current, HOUR, 'the incense burns down'), 'time');
  current = run(current, passed);
  const settled = unwrap(resolveDeclaredCast(current, castingId, supply(`${seed}-settle`)), 'settle');
  return { state: run(current, settled.events), events: [...declared.events, ...passed, ...settled.events] };
};

// — Wild Companion ————————————————————————————————————————————————————————————

describe('SRD Wild Companion', () => {
  const FIND_FAMILIAR = {
    spellId: 'find-familiar',
    form: 'cat',
    source: 'druid:wild-companion',
  };

  it('casts Find Familiar out of a Wild Shape use, and the familiar is Fey', () => {
    const state = fold('seed', study(druid()));
    expect(remaining(state.creatures[HERO]!.resources, 'wild-shape')).toBe(2);

    const { state: after, events } = rite(state, { ...FIND_FAMILIAR, payment: 'free-casting' }, 'cat');
    expect(events).toContainEqual({ type: 'resource-spent', id: HERO, key: 'wild-shape', amount: 1 });
    expect(remaining(after.creatures[HERO]!.resources, 'wild-shape')).toBe(1);
    // No slot went: the use paid.
    expect(remaining(after.creatures[HERO]!.resources, 'spell-slot:1')).toBe(
      remaining(state.creatures[HERO]!.resources, 'spell-slot:1'),
    );

    const [cat] = summonedIn(after);
    expect(cat).toBeDefined();
    const familiar = after.creatures[cat!]!;
    // "the familiar is Fey": fixed by the feature, stated by nobody.
    expect(familiar.creatureType).toBe('Fey');
    expect(familiar.summonedBy?.kept).toMatchObject({ spell: 'find-familiar', untilSummonerLongRests: true });
    expect(strandedSummons(after)).toEqual([]);
  });

  it('casts it out of a spell slot instead, on the same terms', () => {
    const state = fold('seed', study(druid()));
    const before = remaining(state.creatures[HERO]!.resources, 'spell-slot:1');
    const { state: after } = rite(state, { ...FIND_FAMILIAR, payment: 'slot', slotLevel: 1 }, 'slot');
    expect(remaining(after.creatures[HERO]!.resources, 'spell-slot:1')).toBe(before - 1);
    expect(remaining(after.creatures[HERO]!.resources, 'wild-shape')).toBe(2);
    const [cat] = summonedIn(after);
    expect(after.creatures[cat!]!.creatureType).toBe('Fey');
  });

  it('refuses another creature type, because the feature fixed it', () => {
    const state = fold('seed', study(druid()));
    expect(
      refused(
        resolveSpell(
          state,
          HERO,
          { targets: [HERO], ...FIND_FAMILIAR, payment: 'free-casting', choice: 'Celestial' },
          supply('celestial'),
        ),
      ),
    ).toBe('choice_fixed');
  });

  it('loses the familiar when the Druid finishes a Long Rest, and not before', () => {
    const state = fold('seed', study(druid()));
    const { state: summoned } = rite(state, { ...FIND_FAMILIAR, payment: 'free-casting' }, 'cat');
    const [cat] = summonedIn(summoned);

    // A Short Rest changes nothing.
    let current = run(summoned, unwrap(beginRest(summoned, HERO, 'short'), 'short'));
    current = run(current, unwrap(advanceTime(current, HOUR, 'a breather'), 'time'));
    current = run(current, unwrap(endRest(current, HERO), 'short end').events);
    expect(strandedSummons(current)).toEqual([]);

    // A Long Rest completing is the ending the SRD prints.
    current = run(current, unwrap(beginRest(current, HERO, 'long'), 'long'));
    current = run(current, unwrap(advanceTime(current, 8 * HOUR, 'the night'), 'time'));
    expect(strandedSummons(current)).toEqual([]);
    current = run(current, unwrap(endRest(current, HERO), 'long end').events);
    expect(strandedSummons(current)).toEqual([cat]);

    const gone = run(current, unwrap(dismissStrandedSummons(current), 'sweep'));
    expect(summonedIn(gone)).toEqual([]);
  });
});

// — Ritual Adept ——————————————————————————————————————————————————————————————

describe('SRD Ritual Adept', () => {
  it('casts a Ritual from the book unprepared, spending no slot', () => {
    const state = fold('seed', study(wizard()));
    const slotsBefore = remaining(state.creatures[HERO]!.resources, 'spell-slot:1');

    const { state: after, events } = rite(state, { spellId: 'detect-magic', ritual: true, targets: [] }, 'rite');
    const cast = events.find((e) => e.type === 'spell-cast');
    expect(cast?.type === 'spell-cast' ? cast.slotless : null).toBe('ritual');
    expect(remaining(after.creatures[HERO]!.resources, 'spell-slot:1')).toBe(slotsBefore);
    expect(Object.values(after.ongoing).some((record) => record.spellId === 'detect-magic')).toBe(true);
  });

  it('is the ritual licence and nothing more: unprepared without it, unbooked with it, and untagged', () => {
    const state = fold('seed', study(wizard()));
    // Not prepared and not cast as a Ritual: the book alone casts nothing.
    expect(
      refused(resolveSpell(state, HERO, { spellId: 'detect-magic', targets: [HERO], slotLevel: 1 }, supply('a'))),
    ).toBe('spell_not_available');
    // A Ritual the book does not hold.
    expect(
      refused(resolveSpell(state, HERO, { spellId: 'alarm', targets: [HERO], ritual: true }, supply('b'))),
    ).toBe('spell_not_available');
    // In the book, unprepared, and not a Ritual.
    expect(
      refused(resolveSpell(state, HERO, { spellId: 'mage-armor', targets: [HERO], ritual: true }, supply('c'))),
    ).toBe('not_a_ritual');
  });
});

// — Paladin's Smite ————————————————————————————————————————————————————————————

describe("SRD Paladin's Smite", () => {
  const field = (): GameEvent[] => [
    ...study(paladin()),
    {
      type: 'creature-added',
      id: GOBLIN,
      name: 'goblin',
      sheet: plain(),
      maxHp: 200,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'goblins',
    },
    { type: 'items-gained', id: HERO, items: [{ id: 'greatsword', quantity: 1 }], source: 'loot' },
    { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: HERO }, feet: 5, bearing: 0 } },
    {
      type: 'combat-started',
      combatants: [
        { id: HERO, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];

  /** Swing with the damage held, so the smite can ride on the hit. */
  const held = (state: GameState, seed = 'hit'): GameState => {
    const out = unwrap(
      resolveAttack(state, HERO, { target: GOBLIN, weapon: 'greatsword', twoHanded: true, hold: true }, supply(seed)),
      'attack',
    );
    if (out.attack?.hit !== true) throw new Error(`the seed ${seed} missed`);
    return run(state, out.events);
  };

  it('declares the free casting as a pool of one that a Long Rest refills', () => {
    const state = fold('seed', field());
    expect(state.creatures[HERO]!.resources.pools['paladin:smite']).toMatchObject({ max: 1, recovers: 'long-rest' });
  });

  it('smites on a hit without a slot, once, and then wants a slot again', () => {
    const state = held(fold('seed', field()));
    const slots = remaining(state.creatures[HERO]!.resources, 'spell-slot:1');

    const settled = unwrap(
      resolveAttackDamage(
        state,
        HERO,
        { smite: { spellId: 'divine-smite', payment: 'free-casting' } },
        supply('smite'),
      ),
      'smite',
    );
    expect(settled.events).toContainEqual({ type: 'resource-spent', id: HERO, key: 'paladin:smite', amount: 1 });
    const cast = settled.events.find((e) => e.type === 'spell-cast');
    expect(cast?.type === 'spell-cast' ? cast.slot : 'no cast').toBeNull();
    const after = run(state, settled.events);
    expect(remaining(after.creatures[HERO]!.resources, 'spell-slot:1')).toBe(slots);
    expect(remaining(after.creatures[HERO]!.resources, 'paladin:smite')).toBe(0);
    // Radiant on top of the greatsword's Slashing: at least the 2d8's floor more
    // than the same blow settled plain.
    const plainBlow = unwrap(resolveAttackDamage(state, HERO, {}, supply('smite')), 'plain');
    expect(settled.damage! - plainBlow.damage!).toBeGreaterThanOrEqual(2);

    // With the pool spent, the free casting is refused and nothing is charged.
    const spent = held(
      fold('seed', [...field(), { type: 'resource-spent', id: HERO, key: 'paladin:smite', amount: 1 }]),
      'again',
    );
    expect(
      refused(
        resolveAttackDamage(spent, HERO, { smite: { spellId: 'divine-smite', payment: 'free-casting' } }, supply('x')),
      ),
    ).toBe('no_free_casting');
    // And a slot still buys it, as it always did.
    const paid = unwrap(
      resolveAttackDamage(spent, HERO, { smite: { spellId: 'divine-smite', slotLevel: 1 } }, supply('y')),
      'slot smite',
    );
    expect(remaining(run(spent, paid.events).creatures[HERO]!.resources, 'spell-slot:1')).toBe(
      remaining(spent.creatures[HERO]!.resources, 'spell-slot:1') - 1,
    );
  });
});
