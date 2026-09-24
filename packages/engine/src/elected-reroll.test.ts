/**
 * A reroll elected before the die, and read against it.
 *
 * SRD Heroic Inspiration: "you can expend it to reroll any die immediately
 * after rolling it, and you must use the new roll." The `test-rolled` window
 * answers the part of that sentence a window can — a failed ability check or
 * saving throw — and could never answer the rest: a roll that succeeded, an
 * attack roll and a damage die land in no window, and a window on every die
 * was tried and withdrawn because a table would then have to settle one before
 * every next roll.
 *
 * What is here instead is an **election**: the roller states, on the command
 * that rolls, the condition under which the reroll happens. Intent from the
 * caller, the number from the engine; a decision made with knowledge of the
 * die, because the condition is a function of the face; no second call and
 * nothing held open.
 *
 * The window keeps its arm, because Indomitable and Cutting Words share it and
 * a player may prefer to look first.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { beginRest, endRest } from './rest.js';
import { advanceTime, resolveAttack, resolveTest, takeTestReaction } from './commands.js';

const id = (s: string) => asCharacterId(s);
const HERO = id('hero');
const DUMMY = id('dummy');

const POOL = 'human:heroic-inspiration';

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const refused = (result: { ok: boolean; code?: string }): string => {
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(false);
  return (result as { code: string }).code;
};

/** A Human Fighter 1, because Resourceful is every Human's. */
const human = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const log = (): readonly GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, human(), HERO), 'Bren'),
  { type: 'creature-side-declared', id: HERO, side: 'party' },
  {
    type: 'creature-added',
    id: DUMMY,
    name: 'dummy',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'monsters',
  },
  { type: 'items-gained', id: HERO, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: DUMMY,
    placement: { from: { creature: HERO }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: HERO, to: DUMMY, seen: true },
];

const run = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

const spends = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((e) => (e.type === 'resource-spent' ? [e.key] : []));

/** Every seed whose swing hits, and every seed whose swing misses. */
const SEEDS = Array.from({ length: 24 }, (_, n) => `seed-${n}`);

// — the attack roll ————————————————————————————————————————————————————————

describe('an election on an attack roll', () => {
  const swing = (
    state: GameState,
    seed: string,
    command: Record<string, unknown> = {},
  ) =>
    unwrap(
      resolveAttack(state, HERO, { target: DUMMY, weapon: 'longsword', ...command }, supply(seed)),
      'swing',
    );

  /** A seed whose unelected swing misses, and one whose unelected swing hits. */
  const seedThat = (want: boolean): string => {
    const state = fold('seed', log());
    const found = SEEDS.find((seed) => swing(state, seed).attack?.hit === want);
    if (found === undefined) throw new Error(`no seed in the fixture ${want ? 'hits' : 'misses'}`);
    return found;
  };

  it('rethrows a miss, keeps the first face, spends the pool and uses the new roll', () => {
    const state = fold('seed', log());
    const seed = seedThat(false);
    const plainMiss = swing(state, seed);
    expect(plainMiss.attack?.hit).toBe(false);
    expect(spends(plainMiss.events)).toEqual([]);

    const elected = swing(state, seed, { election: { pool: POOL, when: 'misses' } });
    // The first throw is the one the unelected swing made, and it is on the
    // record rather than replaced in silence.
    expect(elected.attack?.roll.superseded?.natural).toBe(plainMiss.attack!.roll.natural);
    expect(elected.attack?.roll.natural).not.toBe(plainMiss.attack!.roll.natural);
    expect(elected.attack?.roll.elected).toBe(POOL);
    expect(spends(elected.events)).toEqual([POOL]);
    // The log says a face was replaced, on the field a Halfling's Luck writes.
    const recorded = elected.events.find(
      (e) => e.type === 'roll-recorded' && e.label.endsWith('attack'),
    );
    expect(recorded?.type === 'roll-recorded' ? recorded.supersedes?.natural : null).toBe(
      plainMiss.attack!.roll.natural,
    );
    // And the pool is gone whatever the new roll showed.
    const after = run(state, elected.events);
    expect(remaining(after.creatures[HERO]!.resources, POOL)).toBe(0);
  });

  it('uses the new roll even when it misses again', () => {
    const state = fold('seed', log());
    // Every seed that missed, elected: the answer is whatever the second die
    // said, and the record shows a miss that was thrown twice.
    const rethrown = SEEDS.map((seed) => ({
      seed,
      plain: swing(state, seed),
      elected: swing(state, seed, { election: { pool: POOL, when: 'misses' } }),
    })).filter((one) => one.plain.attack?.hit === false);
    expect(rethrown.length).toBeGreaterThan(0);
    const missedTwice = rethrown.filter((one) => one.elected.attack?.hit === false);
    expect(missedTwice.length, 'the fixture meant at least one to miss twice').toBeGreaterThan(0);
    for (const one of missedTwice) {
      // Spent, and the worse answer stands: nothing chose between the faces.
      expect(spends(one.elected.events)).toEqual([POOL]);
      expect(one.elected.attack?.roll.superseded).toBeDefined();
    }
  });

  it('leaves a hit alone and spends nothing', () => {
    const state = fold('seed', log());
    const seed = seedThat(true);
    const elected = swing(state, seed, { election: { pool: POOL, when: 'misses' } });
    expect(elected.attack?.hit).toBe(true);
    expect(elected.attack?.roll.superseded).toBeUndefined();
    expect(elected.attack?.roll.elected).toBeUndefined();
    expect(spends(elected.events)).toEqual([]);
    // Identical to the swing that elected nothing, die for die.
    const plainHit = swing(state, seed);
    expect(elected.attack?.roll.natural).toBe(plainHit.attack!.roll.natural);
    const after = run(state, elected.events);
    expect(remaining(after.creatures[HERO]!.resources, POOL)).toBe(1);
  });

  it('refuses "fails" on an attack roll, before anything is thrown', () => {
    const state = fold('seed', log());
    const out = resolveAttack(
      state,
      HERO,
      { target: DUMMY, weapon: 'longsword', election: { pool: POOL, when: 'fails' } },
      supply('shape'),
    );
    expect(refused(out)).toBe('bad_election');
  });
});

// — the damage dice ————————————————————————————————————————————————————————

describe('an election on a damage die', () => {
  /**
   * The weapon's own damage dice, read out of the log rather than the return —
   * `AttackResolution.damage` is a post-defence total, and what is under test
   * is which faces were thrown. `damage-dice-recorded` carries every die.
   */
  const weaponDice = (out: {
    events: readonly GameEvent[];
  }): readonly { rolled: number; disposition: string }[] => {
    for (const event of out.events) {
      if (event.type !== 'damage-dice-recorded') continue;
      const own = event.components.find((c) => c.source === 'Longsword');
      if (own !== undefined && own.dice.length > 0) return own.dice;
    }
    throw new Error('the fixture meant this swing to roll the longsword’s damage');
  };

  const swing = (state: GameState, seed: string, command: Record<string, unknown> = {}) =>
    unwrap(
      resolveAttack(
        state,
        HERO,
        {
          target: DUMMY,
          weapon: 'longsword',
          // Forced to land, because what is under test is the damage.
          attackBonuses: [{ source: 'forced', flat: 40 }],
          ...command,
        },
        supply(seed),
      ),
      'swing',
    );

  it('rethrows a die at or below the elected face and leaves a higher one', () => {
    const state = fold('seed', log());
    const low = SEEDS.map((seed) => ({ seed, out: swing(state, seed) })).find(
      (one) => weaponDice(one.out)[0]!.rolled <= 5,
    );
    const high = SEEDS.map((seed) => ({ seed, out: swing(state, seed) })).find(
      (one) => weaponDice(one.out)[0]!.rolled > 5,
    );
    if (low === undefined || high === undefined) {
      throw new Error('the fixture meant to hold one low longsword die and one high one');
    }

    const rethrown = swing(state, low.seed, {
      damageElection: { pool: POOL, when: { faceAtOrBelow: 5 } },
    });
    const dice = weaponDice(rethrown);
    expect(dice[0]!.disposition).toBe('rerolled');
    expect(dice.length).toBe(2);
    expect(spends(rethrown.events)).toEqual([POOL]);

    const stood = swing(state, high.seed, {
      damageElection: { pool: POOL, when: { faceAtOrBelow: 5 } },
    });
    expect(weaponDice(stood).length).toBe(1);
    expect(weaponDice(stood)[0]!.disposition).toBe('counted');
    expect(spends(stood.events)).toEqual([]);
  });

  it('refuses an outcome word on a damage die, and a held swing that rolls none', () => {
    const state = fold('seed', log());
    expect(
      refused(
        resolveAttack(
          state,
          HERO,
          {
            target: DUMMY,
            weapon: 'longsword',
            damageElection: { pool: POOL, when: 'misses' },
          },
          supply('shape'),
        ),
      ),
    ).toBe('bad_election');
    expect(
      refused(
        resolveAttack(
          state,
          HERO,
          {
            target: DUMMY,
            weapon: 'longsword',
            hold: true,
            damageElection: { pool: POOL, when: { faceAtOrBelow: 5 } },
          },
          supply('shape'),
        ),
      ),
    ).toBe('bad_election');
  });

  it('refuses one use buying two rerolls on one swing', () => {
    const state = fold('seed', log());
    expect(
      refused(
        resolveAttack(
          state,
          HERO,
          {
            target: DUMMY,
            weapon: 'longsword',
            election: { pool: POOL, when: 'misses' },
            damageElection: { pool: POOL, when: { faceAtOrBelow: 5 } },
          },
          supply('shape'),
        ),
      ),
    ).toBe('bad_election');
  });
});

// — the D20 Test, beside the window ————————————————————————————————————————

describe('an election on an ability check or a saving throw', () => {
  const save = (state: GameState, seed: string, command: Record<string, unknown> = {}) =>
    unwrap(
      resolveTest(
        state,
        HERO,
        { kind: 'saving-throw', ability: 'dex', dc: 18, ...command },
        supply(seed),
      ),
      'save',
    );

  it('rethrows a failed save and leaves a made one', () => {
    const state = fold('seed', log());
    const failing = SEEDS.find((seed) => save(state, seed).test?.success === false);
    const making = SEEDS.find((seed) => save(state, seed, { dc: -5 }).test?.success === true);
    if (failing === undefined || making === undefined) {
      throw new Error('the fixture meant to hold a failed save and a made one');
    }

    const plainFail = save(state, failing);
    const elected = save(state, failing, { election: { pool: POOL, when: 'fails' } });
    expect(elected.test?.supersedes?.natural).toBe(plainFail.test!.natural);
    expect(spends(elected.events)).toEqual([POOL]);

    const made = save(state, making, { dc: -5, election: { pool: POOL, when: 'fails' } });
    expect(made.test?.supersedes).toBeUndefined();
    expect(spends(made.events)).toEqual([]);
  });

  it('rethrows a face at or below the one elected, whatever the test came to', () => {
    const state = fold('seed', log());
    // The DC is trivial, so nothing here is about failure: the face alone.
    const faces = SEEDS.map((seed) => ({ seed, out: save(state, seed, { dc: -5 }) }));
    const low = faces.find((one) => one.out.test!.natural <= 7);
    const high = faces.find((one) => one.out.test!.natural > 7);
    if (low === undefined || high === undefined) {
      throw new Error('the fixture meant to hold a low face and a high one');
    }

    const rethrown = save(state, low.seed, {
      dc: -5,
      election: { pool: POOL, when: { faceAtOrBelow: 7 } },
    });
    expect(rethrown.test?.success).toBe(true);
    expect(rethrown.test?.supersedes?.natural).toBe(low.out.test!.natural);
    expect(spends(rethrown.events)).toEqual([POOL]);

    const stood = save(state, high.seed, {
      dc: -5,
      election: { pool: POOL, when: { faceAtOrBelow: 7 } },
    });
    expect(stood.test?.supersedes).toBeUndefined();
    expect(spends(stood.events)).toEqual([]);
  });

  it('refuses "misses" on a D20 Test', () => {
    const state = fold('seed', log());
    expect(
      refused(
        resolveTest(
          state,
          HERO,
          { kind: 'ability-check', ability: 'str', dc: 12, election: { pool: POOL, when: 'misses' } },
          supply('shape'),
        ),
      ),
    ).toBe('bad_election');
  });

  it('still opens the test-rolled window on a failed check with no election', () => {
    const state = fold('seed', log());
    const failed = unwrap(
      resolveTest(
        state,
        HERO,
        { kind: 'ability-check', ability: 'str', skill: 'athletics', dc: 40 },
        supply('miss'),
      ),
      'check',
    );
    expect(failed.offers.map((o) => o.feature)).toEqual(['human:resourceful']);
    const pending = run(state, failed.events);
    const again = unwrap(
      takeTestReaction(pending, HERO, { feature: 'human:resourceful' }, supply('again')),
      'reroll',
    );
    expect(again.test?.supersedes).toEqual({
      natural: failed.test!.natural,
      total: failed.test!.total,
    });
  });

  it('refuses the window answer that would spend the same pool on the same roll', () => {
    const state = fold('seed', log());
    // The election fires and the save still fails, so the window opens with the
    // reroll offered — the offers were read off the state before the spend.
    const failing = SEEDS.map((seed) => ({
      seed,
      out: unwrap(
        resolveTest(
          state,
          HERO,
          {
            kind: 'saving-throw',
            ability: 'dex',
            dc: 40,
            election: { pool: POOL, when: 'fails' },
          },
          supply(seed),
        ),
        'save',
      ),
    })).find((one) => one.out.offers.length > 0);
    if (failing === undefined) throw new Error('the fixture meant the window to open');
    expect(failing.out.test?.supersedes).toBeDefined();

    const pending = run(state, failing.out.events);
    expect(
      refused(takeTestReaction(pending, HERO, { feature: 'human:resourceful' }, supply('twice'))),
    ).toBe('election_spent');
  });
});

// — the pool, and what it costs ————————————————————————————————————————————

describe('what an election costs before the die', () => {
  const emptied = (): GameState =>
    fold('seed', [...log(), { type: 'resource-spent', id: HERO, key: POOL, amount: 1 }]);

  it('refuses an election the roller cannot afford, with nothing rolled and nothing spent', () => {
    const state = emptied();
    const rolls = createRollIssuer('r');
    const rng = createRng('empty') as Rng;
    const before = rng.snapshot();
    const out = resolveAttack(
      state,
      HERO,
      { target: DUMMY, weapon: 'longsword', election: { pool: POOL, when: 'misses' } },
      { issuer: rolls, rng, content: SRD_CONTENT },
    );
    expect(refused(out)).toBe('cannot_afford');
    // The footprint: no die thrown, no roll id issued, no use spent.
    expect(rng.snapshot()).toEqual(before);
    expect(rolls.count).toBe(0);
    expect(remaining(state.creatures[HERO]!.resources, POOL)).toBe(0);
  });

  it('refuses a pool the roller holds that buys no reroll', () => {
    const state = fold('seed', log());
    const out = resolveTest(
      state,
      HERO,
      {
        kind: 'saving-throw',
        ability: 'dex',
        dc: 12,
        election: { pool: 'fighter:second-wind', when: 'fails' },
      },
      supply('wrong'),
    );
    expect(refused(out)).toBe('bad_election');
  });

  it('gives the pool back on a Long Rest, and the election works again', () => {
    const spent: readonly GameEvent[] = [
      ...log(),
      { type: 'resource-spent', id: HERO, key: POOL, amount: 1 },
    ];
    const begun = [...spent, ...unwrap(beginRest(fold('seed', spent), HERO, 'long'), 'rest begins')];
    const night = [
      ...begun,
      ...unwrap(advanceTime(fold('seed', begun), 8 * 3600, 'the night'), 'the night'),
    ];
    const rested = fold('seed', [
      ...night,
      ...unwrap(endRest(fold('seed', night), HERO), 'rest ends').events,
    ]);
    expect(remaining(rested.creatures[HERO]!.resources, POOL)).toBe(1);
    const out = resolveAttack(
      rested,
      HERO,
      { target: DUMMY, weapon: 'longsword', election: { pool: POOL, when: 'misses' } },
      supply('after'),
    );
    expect(out.ok).toBe(true);
  });
});
