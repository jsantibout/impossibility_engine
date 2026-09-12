import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { beginRest, endRest } from './rest.js';
import { useRecovery } from './commands.js';
import { recoveryCap, type RecoveryFeature } from './standing.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { pactSlotKey, remaining } from './resources.js';
import { SORCERY_POINTS } from './sorcerer.js';

/**
 * A feature that gives a pool's uses back at a moment that is not a rest.
 *
 * Two features, one sentence shape: spend the feature's own once-per-Long-Rest
 * use, and regain expended uses of some *other* pool, up to a cap the feature
 * names. Sorcerous Restoration and Magical Cunning are written in nearly
 * identical words and differ in all three of the places that matter — which
 * pool, how the cap is sized, and which way it rounds — so one field could not
 * have carried either of them honestly.
 *
 * | | Sorcerous Restoration | Magical Cunning |
 * |---|---|---|
 * | Gives back | Sorcery Points | Pact Magic slots |
 * | Cap | half your Sorcerer level | half your maximum |
 * | Rounding | **down** | **up** |
 * | Moment | finishing a Short Rest | a one-minute rite |
 *
 * `restore()` in `resources.ts` had been written, correct and reached by no
 * command since the day pools landed — the eighth instance in this repo of *a
 * pure function nothing calls is a rule nothing enforces*.
 */

const id = (s: string) => asCharacterId(s);

/**
 * A generator for the one recovery that rolls.
 *
 * `useRecovery` requires it rather than offering it, for the reason the
 * Concentration save's deferred version was torn out: an obligation the engine
 * cannot keep is worse than one it never offered. It costs a caller nothing —
 * they resume it from the state they are already holding — and the two
 * recoveries that roll nothing never touch it.
 */
const supply = (seed = 'r'): { issuer: RollIssuer; rng: Rng } => ({
  issuer: createRollIssuer('roll'),
  rng: createRng(seed) as Rng,
});
const VESKA = id('veska');
const KAEL = id('kael');

const sorcerer = (level: number): CharacterChoices => ({
  name: 'Veska',
  classId: 'sorcerer',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  languages: ['Draconic', 'Giant'],
  alignment: 'Chaotic Neutral',
  subclassId: 'draconic-sorcery',
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'light'].slice(
    0,
    level >= 4 ? 5 : 4,
  ),
  spellbook: [],
  // Ordered by spell level, because the prepared list is cut to length and a
  // level 4 Sorcerer has no level 3 slots to prepare into.
  preparedSpells: [
    'magic-missile',
    'burning-hands',
    'charm-person',
    'thunderwave',
    'sleep',
    'shatter',
    'hold-person',
    'invisibility',
    'fireball',
  ].slice(0, level >= 5 ? 9 : 7),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...(level >= 4
      ? { 'sorcerer:ability-score-improvement': { featId: 'savage-attacker' } }
      : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const warlock = (level: number): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  ...(level >= 3 ? { subclassId: 'fiend-patron' } : {}),
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'].slice(0, level >= 4 ? 3 : 2),
  spellbook: [],
  // Ordered by spell level: a Warlock's slots *become* the next level rather
  // than accumulating, so a level 4 Warlock has nothing above level 2.
  preparedSpells: [
    'hex',
    'charm-person',
    'hellish-rebuke',
    'hold-person',
    'mind-spike',
    'fear',
  ].slice(0, Math.min(level + 1, 6)),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...(level >= 4 ? { 'warlock:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/**
 * A log a test can keep appending to.
 *
 * `GameState` is a fold and holds no history, so a scenario that walks a
 * creature through a rest and then a command has to carry the events itself.
 */
class Game {
  private events: GameEvent[] = [];

  constructor(initial: readonly GameEvent[]) {
    this.events = [...initial];
  }

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  creature(who: string) {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature;
  }

  left(who: string, key: string): number {
    return remaining(this.creature(who).resources, key);
  }

  /** Spend out of a pool directly, so a test can arrive at an empty one. */
  drain(who: string, key: string, amount: number): this {
    return this.push([{ type: 'resource-spent', id: id(who), key, amount }]);
  }

  time(seconds: number, reason: string): this {
    return this.push([{ type: 'time-advanced', seconds, reason }]);
  }

  rest(who: string, kind: 'short' | 'long', options: { interrupted?: string } = {}): this {
    this.push(unwrap(beginRest(this.state, id(who), kind), 'begin'));
    this.time(kind === 'short' ? 3600 : 8 * 3600, `a ${kind} rest`);
    return this.push(unwrap(endRest(this.state, id(who), options), 'end').events);
  }
}

/** Built, or the refusal — so a broken fixture says which rule it broke. */
const game = (choices: CharacterChoices, who: string): Game => {
  const out = createCharacter(choices, id(who));
  if (!out.ok) throw new Error(`${choices.classId} ${choices.level}: ${out.code} — ${out.reason}`);
  return new Game(out.value);
};

const recoveriesOf = (g: Game, who: string): readonly string[] =>
  (g.creature(who).sheet.recoveries ?? []).map((r) => r.feature);

const cap = (over: Partial<RecoveryFeature> & { max?: number }): number => {
  const base: RecoveryFeature = {
    feature: 'f',
    name: 'A Feature',
    pool: 'limiter',
    restores: 'target',
    upTo: 'half-class-level',
    classLevel: 5,
    moment: 'short-rest',
  };
  const { max = 99, ...rest } = over;
  return recoveryCap({ ...base, ...rest }, max);
};

describe('the cap a recovery feature names', () => {
  /**
   * SRD Sorcerous Restoration: "no more than a number equal to half your
   * Sorcerer level (**round down**)." Magical Cunning: "no more than a number
   * equal to half your maximum (**round up**)." Two sentences, two roundings,
   * and only the odd numbers tell them apart.
   */
  it('rounds a half class level down', () => {
    expect(cap({ upTo: 'half-class-level', classLevel: 5 })).toBe(2);
    expect(cap({ upTo: 'half-class-level', classLevel: 20 })).toBe(10);
    expect(cap({ upTo: 'half-class-level', classLevel: 1 })).toBe(0);
  });

  it('rounds half a pool maximum up', () => {
    expect(cap({ upTo: 'half-pool-maximum', max: 3 })).toBe(2);
    expect(cap({ upTo: 'half-pool-maximum', max: 2 })).toBe(1);
    expect(cap({ upTo: 'half-pool-maximum', max: 4 })).toBe(2);
    expect(cap({ upTo: 'half-pool-maximum', max: 1 })).toBe(1);
  });

  /** Each sizing reads its own number, and never the other one's. */
  it('reads the class level for one and the pool for the other', () => {
    expect(cap({ upTo: 'half-class-level', classLevel: 5, max: 40 })).toBe(2);
    expect(cap({ upTo: 'half-pool-maximum', classLevel: 5, max: 40 })).toBe(20);
  });
});

describe('Sorcerous Restoration', () => {
  const built = (level = 5) => game(sorcerer(level), 'veska');
  const use = (g: Game, commandId?: string) =>
    useRecovery(
      g.state,
      VESKA,
      {
        feature: 'sorcerer:sorcerous-restoration',
        ...(commandId === undefined ? {} : { commandId }),
      },
      supply(),
    );

  it('arrives at the level the Sorcerer table prints it', () => {
    expect(recoveriesOf(built(4), 'veska')).toEqual([]);
    expect(recoveriesOf(built(5), 'veska')).toEqual(['sorcerer:sorcerous-restoration']);
  });

  /**
   * SRD: "When you finish a Short Rest, you can regain expended Sorcery
   * Points, but no more than a number equal to half your Sorcerer level (round
   * down)." A level 5 Sorcerer with all five points gone gets two back.
   */
  it('gives back half the Sorcerer level, rounded down', () => {
    expect(SORCERY_POINTS[4]).toBe(5);
    const g = built(5).drain('veska', 'sorcery-points', 5).rest('veska', 'short');
    expect(g.left('veska', 'sorcery-points')).toBe(0);

    g.push(unwrap(use(g), 'use'));
    expect(g.left('veska', 'sorcery-points')).toBe(2);
  });

  /**
   * "You regain expended Sorcery Points" — never more than were expended.
   *
   * Asserted on the **event**, not only on the pool that follows it. `restore`
   * clamps at the maximum, so a command that handed back two when one was
   * spent would leave a pool nobody could fault and a log saying a thing that
   * did not happen — and the log is the half this engine is answerable for.
   * A mutation dropping the clamp passed every test that read the pool.
   */
  it('never gives back more than was spent, and the log says so', () => {
    const g = built(5).drain('veska', 'sorcery-points', 1).rest('veska', 'short');
    const events = unwrap(use(g), 'use');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resource-regained', key: 'sorcery-points', amount: 1 }),
    );
    g.push(events);
    expect(g.left('veska', 'sorcery-points')).toBe(5);
  });

  /** And the full amount is recorded when the full amount is owed. */
  it('records the whole cap when that much was spent', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5).rest('veska', 'short');
    expect(unwrap(use(g), 'use')).toContainEqual(
      expect.objectContaining({ type: 'resource-regained', key: 'sorcery-points', amount: 2 }),
    );
  });

  /** Nothing expended is nothing to regain — and must not burn the daily use. */
  it('refuses when the pool is already full, and costs nothing', () => {
    const g = built(5).rest('veska', 'short');
    const out = use(g);
    expect(isErr(out) && out.code).toBe('nothing_to_regain');
    expect(g.left('veska', 'sorcerer:sorcerous-restoration')).toBe(1);
  });

  /** "Once you use this feature, you can't do so again until you finish a Long Rest." */
  it('spends its own use, and refuses a second before a Long Rest', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5).rest('veska', 'short');
    g.push(unwrap(use(g), 'use'));
    expect(g.left('veska', 'sorcerer:sorcerous-restoration')).toBe(0);

    g.drain('veska', 'sorcery-points', 2).rest('veska', 'short');
    const again = use(g);
    expect(isErr(again) && again.code).toBe('exhausted');
  });

  it('comes back on a Long Rest', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5).rest('veska', 'short');
    g.push(unwrap(use(g), 'use'));
    g.rest('veska', 'long');
    expect(g.left('veska', 'sorcerer:sorcerous-restoration')).toBe(1);
  });

  /**
   * The moment is part of the rule, and it is one the engine can see: a Short
   * Rest this creature has just finished. Same window a Reaction to damage
   * uses — the clock has not moved since.
   */
  it('refuses when no Short Rest has just finished', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5);
    const out = use(g);
    expect(isErr(out) && out.code).toBe('not_the_moment');
  });

  /** A Long Rest is not a Short Rest, however much else it gives back. */
  it('refuses after a Long Rest', () => {
    const g = built(5).rest('veska', 'long').drain('veska', 'sorcery-points', 5);
    const out = use(g);
    expect(isErr(out) && out.code).toBe('not_the_moment');
  });

  /** The window closes when the clock moves on. */
  it('refuses once time has passed since the rest', () => {
    const g = built(5)
      .drain('veska', 'sorcery-points', 5)
      .rest('veska', 'short')
      .time(60, 'walking on');
    const out = use(g);
    expect(isErr(out) && out.code).toBe('not_the_moment');
  });

  /**
   * SRD: an interrupted Long Rest of at least an hour "gains the benefits of a
   * Short Rest" — so it is a Short Rest for this feature too. What the record
   * keeps is what was *earned*, never what was attempted.
   */
  it('is offered by an interrupted Long Rest that earned a Short one', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5);
    g.push(unwrap(beginRest(g.state, VESKA, 'long'), 'begin'));
    g.time(2 * 3600, 'two hours');
    g.push(unwrap(endRest(g.state, VESKA, { interrupted: 'a wolf' }), 'end').events);

    g.push(unwrap(use(g), 'use'));
    expect(g.left('veska', 'sorcery-points')).toBe(2);
  });

  /**
   * SRD: "half your **Sorcerer** level" — that class's, never the character's.
   *
   * Only a multiclassed character can tell the two apart, and only one whose
   * *starting* class is the other one: a mutation returning `choices.level`
   * passed every single-class fixture in this file, because for all of them
   * the two numbers are the same. So this is a Fighter 2 who took six levels
   * of Sorcerer — character level 8, Sorcerer level 6, three points back and
   * not four.
   */
  it('halves the Sorcerer level and not the character level', () => {
    const g = game(
      {
        ...sorcerer(2),
        name: 'Bram',
        classId: 'fighter',
        level: 2,
        classSkills: ['athletics', 'intimidation'],
        subclassId: undefined,
        abilities: {
          method: 'manual',
          assignment: { str: 13, dex: 14, con: 13, int: 10, wis: 10, cha: 15 },
        },
        cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'light'],
        preparedSpells: [
          'magic-missile',
          'burning-hands',
          'charm-person',
          'thunderwave',
          'sleep',
          'shatter',
          'hold-person',
          'invisibility',
          'fireball',
          'fly',
        ],
        multiclass: [{ classId: 'sorcerer', level: 6, subclassId: 'draconic-sorcery' }],
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
          'draconic-sorcery:elemental-affinity': ['Fire'],
        },
        feats: {
          'sage:magic-initiate-wizard': {
            featId: 'magic-initiate',
            spellList: 'wizard',
            spellcastingAbility: 'int',
            cantrips: ['mage-hand', 'prestidigitation'],
            levelOneSpell: 'find-familiar',
          },
          'human:versatile': { featId: 'alert' },
          'fighter:fighting-style': { featId: 'defense' },
          'sorcerer:ability-score-improvement': { featId: 'savage-attacker' },
        },
      },
      'veska',
    );

    const feature = (g.creature('veska').sheet.recoveries ?? [])[0];
    expect(feature?.feature).toBe('sorcerer:sorcerous-restoration');
    expect(feature?.classLevel).toBe(6);

    g.drain('veska', 'sorcery-points', 6).rest('veska', 'short');
    expect(unwrap(use(g), 'use')).toContainEqual(
      expect.objectContaining({ type: 'resource-regained', key: 'sorcery-points', amount: 3 }),
    );
  });

  it('refuses a feature this creature does not have', () => {
    const g = built(5).rest('veska', 'short');
    const out = useRecovery(g.state, VESKA, { feature: 'warlock:magical-cunning' }, supply());
    expect(isErr(out) && out.code).toBe('no_such_feature');
  });

  /** A retry with the same id is a no-op, not a second helping. */
  it('is idempotent under a repeated command id', () => {
    const g = built(5).drain('veska', 'sorcery-points', 5).rest('veska', 'short');
    g.push(unwrap(use(g, 'c1'), 'first'));
    expect(unwrap(use(g, 'c1'), 'second')).toEqual([]);
    expect(g.left('veska', 'sorcery-points')).toBe(2);
  });
});

/**
 * A cap of zero, which no class can reach and a sheet can be built to.
 *
 * Sorcerous Restoration arrives at Sorcerer 5, so half its class level is
 * never less than two, and Magical Cunning halves a maximum of at least one.
 * The branch is still a rule — "you regain nothing" is a refusal, not a
 * successful nothing that quietly eats the day's use — and `recoveryCap` is
 * pure over a feature, so a feature that halves a level of one can simply be
 * written. That is the difference between this and a guard nothing can
 * construct the case for.
 */
describe('a feature whose cap works out to nothing', () => {
  const WHO = id('lone');
  const sheet = {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    baseSpeed: 30,
    spellcastingAbility: null,
    weaponProficiencies: [],
    recoveries: [
      {
        feature: 'test:recovery',
        name: 'A Meagre Restoration',
        pool: 'test:recovery',
        restores: 'test:points',
        upTo: 'half-class-level' as const,
        classLevel: 1,
        moment: 'declared' as const,
      },
    ],
  };

  it('refuses rather than spending the day’s use for nothing', () => {
    const g = new Game([
      { type: 'creature-added', id: WHO, name: 'lone', sheet, maxHp: 10, diesAtZero: true },
      {
        type: 'resource-pool-declared',
        id: WHO,
        pool: { key: 'test:recovery', label: 'the feature', max: 1, recovers: 'long-rest' },
      },
      {
        type: 'resource-pool-declared',
        id: WHO,
        pool: { key: 'test:points', label: 'points', max: 4, recovers: 'long-rest' },
      },
      { type: 'resource-spent', id: WHO, key: 'test:points', amount: 4 },
    ]);

    const out = useRecovery(g.state, WHO, { feature: 'test:recovery' }, supply());
    expect(isErr(out) && out.code).toBe('nothing_to_regain');
    expect(isErr(out) && out.reason).toContain('level 1');
    expect(g.left('lone', 'test:recovery')).toBe(1);
  });
});

describe('Magical Cunning', () => {
  const built = (level = 5) => game(warlock(level), 'kael');
  const use = (g: Game) => useRecovery(g.state, KAEL, { feature: 'warlock:magical-cunning' }, supply());

  it('arrives at the level the Warlock table prints it', () => {
    expect(recoveriesOf(built(1), 'kael')).toEqual([]);
    expect(recoveriesOf(built(5), 'kael')).toEqual(['warlock:magical-cunning']);
  });

  /**
   * SRD: "you regain expended Pact Magic spell slots but no more than a number
   * equal to half your maximum (round up)." A level 5 Warlock has two level 3
   * Pact slots, so half of two is one.
   */
  it('gives back half the Pact Magic maximum, rounded up', () => {
    const g = built(5);
    const key = pactSlotKey(3);
    expect(g.creature('kael').resources.pools[key]?.max).toBe(2);

    g.drain('kael', key, 2);
    g.push(unwrap(use(g), 'use'));
    expect(g.left('kael', key)).toBe(1);
  });

  /**
   * The rounding is only visible on an odd maximum, and two is the only one a
   * level 5 Warlock has. A Warlock deep enough to have three Pact slots is a
   * long fixture; resizing the pool is a short one, and it pins the more
   * important half anyway — **the cap is derived at the moment of use, from
   * the pool as it stands.** A number worked out at creation and written on
   * the sheet would still say one here.
   */
  it('reads the maximum as it stands, and rounds three up to two', () => {
    const g = built(5);
    const key = pactSlotKey(3);
    g.push([{ type: 'resource-pool-resized', id: KAEL, key, max: 3 }]);
    g.drain('kael', key, 3);

    g.push(unwrap(use(g), 'use'));
    expect(g.left('kael', key)).toBe(2);
  });

  /** The rite is a minute of fiction, not a rest — so no rest is required. */
  it('needs no rest to have just finished', () => {
    const g = built(5).drain('kael', pactSlotKey(3), 1);
    expect(use(g).ok).toBe(true);
  });

  it('refuses a second rite before a Long Rest, and is restored by one', () => {
    const g = built(5).drain('kael', pactSlotKey(3), 2);
    g.push(unwrap(use(g), 'use'));
    g.drain('kael', pactSlotKey(3), 1);

    const again = use(g);
    expect(isErr(again) && again.code).toBe('exhausted');

    g.rest('kael', 'long');
    expect(g.left('kael', 'warlock:magical-cunning')).toBe(1);
  });

  /**
   * Pact slots come back on a **Short** Rest by themselves and the feature's
   * own use does not, which is the whole reason the two are separate pools.
   */
  it('does not come back on a Short Rest, though the slots do', () => {
    const g = built(5).drain('kael', pactSlotKey(3), 2);
    g.push(unwrap(use(g), 'use'));
    g.rest('kael', 'short');
    expect(g.left('kael', pactSlotKey(3))).toBe(2);
    expect(g.left('kael', 'warlock:magical-cunning')).toBe(0);
  });
});

/**
 * Uncanny Metabolism: a recovery that also heals.
 *
 * SRD: "When you roll Initiative, you can regain all expended Focus Points.
 * When you do so, roll your Martial Arts die, and regain a number of Hit
 * Points equal to your Monk level plus the number rolled."
 *
 * One act, not two — the healing has no cost of its own and cannot be had
 * without the recovery, which is why it is a field on the recovery rather than
 * a feature beside it. It was held back from the first recovery batch on the
 * grounds that a healing field would have had exactly one user; the field has
 * two now, and Second Wind and Wholeness of Body built it.
 */
describe('Uncanny Metabolism', () => {
  const TAM = id('tam');

  const monk = (level: number): CharacterChoices => ({
    name: 'Tam',
    classId: 'monk',
    level,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 },
    },
    abilityIncreases: { int: 2, wis: 1 },
    classSkills: ['acrobatics', 'stealth'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    ...(level >= 3 ? { subclassId: 'warrior-of-the-open-hand' } : {}),
    cantrips: [],
    preparedSpells: [],
    spellbook: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...(level >= 4 ? { 'monk:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  /** Initiative rolled, nobody has finished a turn. */
  const fighting = (g: Game): Game =>
    g.push([{ type: 'combat-started', combatants: [{ id: TAM, initiative: 20, speed: 30 }] }]);

  const built = (level = 5) => {
    const g = game(monk(level), 'tam');
    return g.push([{ type: 'damage-taken', id: TAM, amount: 15, source: 'a trap' }]);
  };

  const use = (g: Game, seed = 'r') =>
    useRecovery(g.state, TAM, { feature: 'monk:uncanny-metabolism' }, supply(seed));

  it('arrives at the level the Monk table prints it', () => {
    expect(recoveriesOf(built(1), 'tam')).toEqual([]);
    expect(recoveriesOf(built(2), 'tam')).toEqual(['monk:uncanny-metabolism']);
  });

  /** "regain **all** expended Focus Points" — the whole pool, not half of it. */
  it('gives every expended Focus Point back', () => {
    const g = fighting(built(5));
    g.drain('tam', 'focus-points', 5);
    expect(g.left('tam', 'focus-points')).toBe(0);

    g.push(unwrap(use(g), 'use'));
    expect(g.left('tam', 'focus-points')).toBe(5);
  });

  /** And heals by the Martial Arts die plus the Monk level, in the same act. */
  it('heals the Martial Arts die plus the Monk level', () => {
    const g = fighting(built(5));
    g.drain('tam', 'focus-points', 5);
    const before = g.creature('tam').vitals.hp;

    const events = unwrap(use(g), 'use');
    const roll = events.find((e) => e.type === 'roll-recorded');
    if (roll === undefined || roll.type !== 'roll-recorded') throw new Error('nothing was rolled');
    expect(roll.label).toBe('Uncanny Metabolism (1d8)');
    expect(roll.contributions).toEqual([{ source: 'Monk level', amount: 5 }]);

    g.push(events);
    expect(g.creature('tam').vitals.hp).toBe(before + roll.natural + 5);
  });

  /**
   * The moment is "when you roll Initiative", and the closest the engine holds
   * is the first turn of the fight. Outside combat there is no such moment at
   * all.
   */
  it('refuses outside combat', () => {
    const g = built(5).drain('tam', 'focus-points', 5);
    const out = use(g);
    expect(isErr(out) && out.code).toBe('not_the_moment');
  });

  /**
   * A turn, not a round.
   *
   * With one combatant the two are indistinguishable — the order wraps at the
   * end of the only turn and the round ticks with it — which is how a mutation
   * reading the window as "the first round" passed a whole file. Two
   * combatants separate them: after the first one finishes, a turn has gone by
   * and the round has not.
   */
  it('refuses once a turn has gone by, while the first round still runs', () => {
    const other = id('foe');
    const g = built(5).drain('tam', 'focus-points', 5);
    g.push([
      {
        type: 'creature-added',
        id: other,
        name: 'foe',
        sheet: g.creature('tam').sheet,
        maxHp: 20,
        diesAtZero: true,
      },
      {
        type: 'combat-started',
        combatants: [
          { id: other, initiative: 25, speed: 30 },
          { id: TAM, initiative: 5, speed: 30 },
        ],
      },
    ]);
    expect(use(g).ok).toBe(true);

    // The foe finishes its turn. The round is still 1 and a turn has passed.
    g.push([{ type: 'turn-advanced' }]);
    expect(g.state.combat?.round).toBe(1);
    expect(g.state.combat?.turnsTaken).toBe(1);

    const out = use(g);
    expect(isErr(out) && out.code).toBe('not_the_moment');
  });

  /**
   * Nothing expended is nothing to regain, and the healing rides on the
   * recovery — so a Monk at full Focus cannot spend the day's use on the hit
   * points alone. SRD ties them with "when you do so".
   */
  it('refuses at full Focus, and heals nobody', () => {
    const g = fighting(built(5));
    const out = use(g);
    expect(isErr(out) && out.code).toBe('nothing_to_regain');
    expect(g.left('tam', 'monk:uncanny-metabolism')).toBe(1);
  });

  it('is once per Long Rest, like the others', () => {
    const g = fighting(built(5)).drain('tam', 'focus-points', 5);
    g.push(unwrap(use(g), 'use'));
    expect(g.left('tam', 'monk:uncanny-metabolism')).toBe(0);

    g.drain('tam', 'focus-points', 3);
    expect(isErr(use(g)) && (use(g) as { code: string }).code).toBe('exhausted');
  });
});
