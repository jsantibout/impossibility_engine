import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { resolveSpell } from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { loadContent } from './content.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { aimedRollsIn, aimsHarmAtATarget, type SpellDefinition } from './spell-definitions.js';

/**
 * Damage that simply lands: SRD Magic Missile.
 *
 * > "You create three glowing darts of magical force. Each dart strikes a
 * > creature of your choice that you can see within range. **A dart deals 1d4 +
 * > 1 Force damage to its target.** The darts all strike simultaneously, and
 * > you can direct them to hit one creature or several."
 *
 * Every damage-bearing effect the format had hung off an attack roll or a
 * saving throw, and this sentence has neither. What it does have is the count
 * and the split an `attack` already carries — a dart is a ray in different
 * words — so the darts are dealt round the creatures the caster named, or
 * divided as the caster says with `rollsAt`, and each one rolls its own dice.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const CLERIC = id('cleric');
const GOBLIN = id('goblin');
const OGRE = id('ogre');
const BOAR = id('boar');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 16, wis: 14, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  over: Partial<Extract<GameEvent, { type: 'creature-added' }>> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...over,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  );

const placed = (who: CharacterId, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: WIZARD }, feet: 20, bearing },
});

const scene = (
  goblin: Partial<Extract<GameEvent, { type: 'creature-added' }>> = {},
): readonly GameEvent[] => [
  added(WIZARD, 'party'),
  added(CLERIC, 'party', { sheet: sheet({ spellcastingAbility: 'wis' }) }),
  added(GOBLIN, 'monsters', goblin),
  added(OGRE, 'monsters'),
  added(BOAR, 'monsters'),
  ...slots(WIZARD),
  ...slots(CLERIC),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 60, y: 60, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  placed(CLERIC, 270),
  placed(GOBLIN, 0),
  placed(OGRE, 90),
  placed(BOAR, 180),
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: BOAR, seen: true },
  { type: 'sight-declared', from: CLERIC, to: GOBLIN, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt'],
      prepared: ['magic-missile'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: ['sanctuary'],
    }),
  },
];

const SETUP: readonly GameEvent[] = scene();

const supply = (state: GameState, rng?: Rng) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: rng ?? (state.rng === null ? createRng('darts') : restoreRng(state.rng)),
  content: SRD_CONTENT,
});

/** A generator that rolls exactly what it is told, so a branch is observable. */
const always = (face: number): Rng => ({
  int: () => face,
  snapshot: (): RngState => [0, 0, 0, 0],
});

const cast = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
  rng?: Rng,
) => {
  const state = fold('seed', log);
  const out = unwrap(resolveSpell(state, who, request, supply(state, rng)), 'cast');
  return { out, events: out.events, log: [...log, ...out.events] };
};

const refusal = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
) => {
  const state = fold('seed', log);
  const out = resolveSpell(state, who, request, supply(state));
  if (!isErr(out)) throw new Error('expected a refusal');
  return out.code;
};

/** Every dart that landed, in order: one `damage-dice-recorded` apiece. */
const darts = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: 'damage-dice-recorded' }> =>
      e.type === 'damage-dice-recorded' && e.source === 'Magic Missile',
  );

const hpOf = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

const took = (events: readonly GameEvent[], who: CharacterId): readonly number[] =>
  events
    .filter((e) => e.type === 'damage-taken' && e.id === who)
    .map((e) => (e as Extract<GameEvent, { type: 'damage-taken' }>).amount);

// — the darts ————————————————————————————————————————————————————————————————

describe('a pool of hits with neither an attack roll nor a save', () => {
  it('throws three darts at level 1, one each round the list', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN, OGRE, BOAR],
      slotLevel: 1,
    });
    const thrown = darts(events);
    expect(thrown).toHaveLength(3);
    expect(thrown.map((e) => e.target)).toEqual([GOBLIN, OGRE, BOAR]);
    // No attack roll and no saving throw decided any of it.
    expect(events.filter((e) => e.type === 'roll-recorded')).toHaveLength(0);
  });

  it('deals each dart its own 1d4 + 1 of Force', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN],
      slotLevel: 1,
    });
    const thrown = darts(events);
    expect(thrown).toHaveLength(3);
    for (const dart of thrown) {
      expect(dart.components).toHaveLength(1);
      const only = dart.components[0]!;
      expect(only.type).toBe('force');
      expect(only.dice).toHaveLength(1);
      expect(only.dice[0]!.sides).toBe(4);
      expect(only.dice[0]!.value).toBeGreaterThanOrEqual(1);
      expect(only.dice[0]!.value).toBeLessThanOrEqual(4);
      expect(only.flat).toBe(1);
      expect(only.total).toBe(only.dice[0]!.value + 1);
      // The engine threw it: a stated roll would carry `stated` beside the id.
      expect(only.roll).not.toBeNull();
      expect((only as { readonly stated?: unknown }).stated).toBeUndefined();
    }
  });

  it('gives two named creatures two darts and one, in the order named', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [OGRE, GOBLIN],
      slotLevel: 1,
    });
    expect(darts(events).map((e) => e.target)).toEqual([OGRE, OGRE, GOBLIN]);
  });

  it('sends every dart at the one creature named', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [BOAR],
      slotLevel: 1,
    });
    expect(darts(events).map((e) => e.target)).toEqual([BOAR, BOAR, BOAR]);
  });

  it('creates one more dart for each slot level above the first', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN],
      slotLevel: 3,
    });
    expect(darts(events)).toHaveLength(5);
  });

  it('issues the casting’s rolls once, with the generator’s state beside them', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN, OGRE],
      slotLevel: 1,
    });
    const issued = events.filter((e) => e.type === 'rolls-issued');
    expect(issued).toHaveLength(1);
    // Three darts, three dice.
    expect((issued[0] as { readonly count: number }).count).toBe(3);
  });
});

// — where the darts go ————————————————————————————————————————————————————————

describe('the split is the caster’s', () => {
  it('honours a split the deal would never have made', () => {
    const { events } = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [OGRE, GOBLIN],
      slotLevel: 1,
      rollsAt: [
        { target: OGRE, count: 1 },
        { target: GOBLIN, count: 2 },
      ],
    });
    expect(darts(events).map((e) => e.target)).toEqual([OGRE, GOBLIN, GOBLIN]);
  });

  it('folds a split that merely spells out the deal to the very same bytes', () => {
    const stated = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [OGRE, GOBLIN],
      slotLevel: 1,
      rollsAt: [
        { target: OGRE, count: 2 },
        { target: GOBLIN, count: 1 },
      ],
    });
    const silent = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [OGRE, GOBLIN],
      slotLevel: 1,
    });
    expect(JSON.stringify(stated.events)).toBe(JSON.stringify(silent.events));
    expect(JSON.stringify(fold('seed', stated.log))).toBe(
      JSON.stringify(fold('seed', silent.log)),
    );
  });

  it('refuses a split that spends more darts than the casting throws', () => {
    expect(
      refusal(SETUP, WIZARD, {
        spellId: 'magic-missile',
        targets: [OGRE, GOBLIN],
        slotLevel: 1,
        rollsAt: [
          { target: OGRE, count: 3 },
          { target: GOBLIN, count: 1 },
        ],
      }),
    ).toBe('wrong_roll_count');
  });

  it('counts the darts a list throws', () => {
    const definition = SRD_CONTENT.spell('magic-missile')!;
    expect(aimedRollsIn(definition.effects, 1, 5, 1)).toBe(3);
    expect(aimedRollsIn(definition.effects, 1, 5, 4)).toBe(6);
  });
});

// — what still answers a dart —————————————————————————————————————————————————

describe('a dart is harm aimed at a creature the casting named', () => {
  it('says so, which is what a ward reads', () => {
    const definition = SRD_CONTENT.spell('magic-missile')!;
    expect(aimsHarmAtATarget(definition.effects)).toBe(true);
  });

  /**
   * SRD Sanctuary wards against "an attack roll **or a damaging spell**", and
   * a dart is the second. A kind that skipped the ward would walk a Magic
   * Missile through the one spell written to stop it.
   */
  it('turns a Magic Missile away from a warded creature', () => {
    const warded = cast(SETUP, CLERIC, { spellId: 'sanctuary', targets: [GOBLIN], slotLevel: 1 })
      .log;
    const state = fold('seed', warded);
    const out = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'magic-missile', targets: [GOBLIN], slotLevel: 1 },
        supply(state, always(1)),
      ),
      'magic missile at a warded creature',
    );
    expect(out.warded).toBe(true);
    expect(out.castingId).toBeNull();
    expect(darts(out.events)).toHaveLength(0);
  });
});

describe('a defence answers every dart separately', () => {
  /**
   * Three darts are three hits, so Resistance halves three times. Pooling them
   * into one 3d4+3 would halve once — a different number, and more of it.
   */
  it('halves each dart rather than the pool', () => {
    const resistant = scene({ defenses: { force: { resistant: true } } });
    const { events } = cast(resistant, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN],
      slotLevel: 1,
    });
    const thrown = darts(events);
    expect(thrown).toHaveLength(3);
    const taken = took(events, GOBLIN);
    expect(taken).toHaveLength(3);
    for (const [index, dart] of thrown.entries()) {
      expect(taken[index]).toBe(Math.floor(dart.components[0]!.total / 2));
    }
  });
});

// — the same seed, the same darts —————————————————————————————————————————————

describe('determinism', () => {
  it('folds the same log to the same state, byte for byte', () => {
    const first = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN, OGRE],
      slotLevel: 2,
    });
    const second = cast(SETUP, WIZARD, {
      spellId: 'magic-missile',
      targets: [GOBLIN, OGRE],
      slotLevel: 2,
    });
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    expect(JSON.stringify(fold('seed', first.log))).toBe(JSON.stringify(fold('seed', second.log)));
    expect(hpOf(fold('seed', first.log), GOBLIN)).toBeLessThan(60);
  });
});

// — the vocabulary ————————————————————————————————————————————————————————————

const homebrew = (over: Record<string, unknown> = {}): unknown => ({
  id: 'splinter-storm',
  name: 'Splinter Storm',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 2 },
  effects: [
    {
      kind: 'auto-damage',
      damage: { dice: '1d6' },
      damageType: 'piercing',
      rolls: { count: 2 },
      ...over,
    },
  ],
});

const problemsIn = (definition: unknown): readonly string[] =>
  checkSpellDefinitionValue(definition).map((problem) => problem.code);

describe('the validator', () => {
  it('accepts a well-formed pool of hits', () => {
    expect(problemsIn(homebrew())).toEqual([]);
  });

  it('refuses one that names no damage type', () => {
    const malformed = homebrew() as { effects: Record<string, unknown>[] };
    delete malformed.effects[0]!['damageType'];
    expect(problemsIn(malformed).length).toBeGreaterThan(0);
  });

  it('refuses a count of hits that is not a whole number', () => {
    expect(problemsIn(homebrew({ rolls: { count: 2.5 } })).length).toBeGreaterThan(0);
  });

  it('refuses an amount that comes to nothing', () => {
    expect(problemsIn(homebrew({ damage: {} }))).toContain('amounts_to_nothing');
  });
});

describe('homebrew reaches it through the same door', () => {
  it('loads a definition of this shape from JSON text', () => {
    const content = unwrap(
      loadContent({ spells: [JSON.parse(JSON.stringify(homebrew()))] }),
      'a homebrew pool of hits',
    );
    const definition = content.spell('splinter-storm') as SpellDefinition | null;
    expect(definition).not.toBeNull();
    expect(definition!.effects[0]!.kind).toBe('auto-damage');
    expect(aimedRollsIn(definition!.effects, 1, 5, 1)).toBe(2);
  });
});
