import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { dealSpellDamage } from './commands/damage.js';
import {
  ongoingSpellOf,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
} from './commands.js';

/**
 * A casting held open keeps the facts its caster stated.
 *
 * Two SRD spells ask the caster a question the engine will not answer for
 * them, and both are stated once, at the casting:
 *
 * - Spirit Guardians: "3d8 Radiant damage (if you are good or neutral) or 3d8
 *   Necrotic damage (if you are evil)", and "When you cast this spell, you can
 *   designate creatures to be unaffected by it."
 * - Protection from Energy: "Resistance to one damage type of your choice:
 *   Acid, Cold, Fire, Lightning, or Thunder."
 *
 * `PendingCasting` pins the targets, the origin and the area for exactly one
 * reason — "settlement takes no fresh request, so a Spiritual Weapon declared
 * beside the goblins cannot settle beside the party" — and these two facts
 * belong to the same sentence. **Whether a casting is settled in one breath or
 * held open for a Counterspell changes nothing about what the caster said.**
 *
 * Both are only observable against a creature that has defences: an undefended
 * dummy takes the same number from Radiant and from Necrotic, which is how a
 * settlement that dropped the stated type could pass a whole file. `WARDED` is
 * Immune to Radiant, so the two castings are told apart by what lands.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
/** Immune to Radiant, so which type the settlement used is observable. */
const WARDED = id('warded');
/** Designated unaffected at the declaration, and never moves. */
const SPARED = id('spared');
/** Neither warded nor spared: the control that proves the aura is running. */
const BYSTANDER = id('bystander');
/** Protection from Energy's target. */
const FIGHTER = id('fighter');

const PREPARED = ['spirit-guardians', 'protection-from-energy', 'hold-person'];

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const MAX_HP = 400;

const added = (
  who: CharacterId,
  over: { readonly defenses?: Record<string, { readonly immune: boolean }> } = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: MAX_HP,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CLERIC || who === SPARED ? 'party' : 'foes',
  ...(over.defenses === undefined ? {} : { defenses: over.defenses }),
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/**
 * The lane the cleric walks down, measured against the engine's own ruler.
 *
 * A 15-foot Emanation on a Medium carrier at x = 300 covers x ∈ [285, 315] and
 * excludes the carrier's own space, so one five-foot step east is what brings
 * the aura to the creatures standing at 320.
 */
const LANE = 300;
const CLERIC_AT: Point = { x: 300, y: LANE, z: 0 };
const ONE_STEP_EAST: Point = { x: 305, y: LANE, z: 0 };

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(WARDED, { defenses: { radiant: { immune: true } } }),
  added(SPARED),
  added(BYSTANDER),
  added(FIGHTER),
  ...casts(CLERIC),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(CLERIC, CLERIC_AT),
  place(WARDED, { x: 320, y: LANE, z: 0 }),
  place(SPARED, { x: 320, y: LANE + 5, z: 0 }),
  place(BYSTANDER, { x: 320, y: LANE + 10, z: 0 }),
  place(FIGHTER, { x: 300, y: LANE + 5, z: 0 }),
  // Hold Person targets "a Humanoid that you can see", and sight is declared
  // rather than ray-cast — so the control spell needs the fact stated before
  // it can be declared at all.
  { type: 'sight-declared', from: CLERIC, to: WARDED, seen: true },
];

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 30, speed: 60 },
      { id: WARDED, initiative: 20, speed: 30 },
      { id: SPARED, initiative: 10, speed: 30 },
      { id: BYSTANDER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'held', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Declare a casting and hold it open, the way a Counterspell window opens. */
  declare(
    spellId: string,
    request: Record<string, unknown> = {},
  ): { readonly castingId: string; readonly events: readonly GameEvent[] } {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        { spellId, targets: [], slotLevel: 3, hold: true, ...request } as never,
        supply(`declare-${spellId}`),
      ),
      `declaring ${spellId}`,
    );
    this.push(out.events);
    return { castingId: out.castingId, events: out.events };
  }

  /** Cast the same spell in one breath, which is the path that already works. */
  cast(
    spellId: string,
    request: Record<string, unknown> = {},
  ): { readonly castingId: string; readonly events: readonly GameEvent[] } {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        { spellId, targets: [], slotLevel: 3, ...request } as never,
        supply(`cast-${spellId}`),
      ),
      `casting ${spellId}`,
    );
    this.push(out.events);
    return { castingId: out.castingId, events: out.events };
  }

  /** These fixtures hold exactly one casting open, and settle it by its id. */
  settleCast(): readonly GameEvent[] {
    const open = pendingCastingsOf(this.state);
    expect(open).toHaveLength(1);
    const out = unwrap(
      resolveDeclaredCast(this.state, open[0]!.castingId, supply('settle-cast')),
      'settling the cast',
    );
    this.push(out.events);
    return out.events;
  }

  fight(): this {
    if (this.state.combat === null) this.push(FIGHT);
    return this;
  }

  to(who: CharacterId): this {
    this.fight();
    for (let n = 0; n < 14; n += 1) {
      const combat = this.state.combat;
      if (combat === null) return this;
      if (combat.order[combat.turnIndex]?.id === who) return this;
      unwrap(resolveTurn(this.state, supply(`to-${n}`)), 'advancing').events.forEach((e) =>
        this.push([e]),
      );
    }
    throw new Error(`never reached ${who}'s turn`);
  }

  walk(who: CharacterId, to: Point): void {
    this.to(who);
    const out = unwrap(
      resolveMove(this.state, who, { placement: { from: { point: to }, feet: 0 } }, supply('move')),
      `${who} moving`,
    );
    this.push(out.events);
  }

  settleArea(): readonly GameEvent[] {
    const out = unwrap(settleAreaEffects(this.state, supply('area'), {}), 'settling the area');
    this.push(out.events);
    return out.events;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }
}

/** What a creature actually takes from one typed hit, after its defences. */
const hitFor = (state: GameState, target: CharacterId, type: string, amount: number): number =>
  unwrap(
    dealSpellDamage(
      state,
      target,
      [{ type, total: amount, flat: amount, roll: null, source: 'a test' }],
      'a test',
      supply('hit'),
      {},
    ),
    'a typed hit',
  ).amount;

/**
 * Walk a Spirit Guardians aura onto the three creatures standing east of it.
 *
 * The aura arriving is `area-moved`, which is one of the three clauses the
 * spell prints — so the debts it raises are settled by the ordinary command
 * and what lands is the spell's own damage at its own DC.
 */
const sweep = (game: Game): Game => {
  game.fight().to(CLERIC);
  game.walk(CLERIC, ONE_STEP_EAST);
  game.settleArea();
  return game;
};

// — the damage type a held casting stated ——————————————————————————————————————

describe('a held Spirit Guardians settles with the damage type its caster stated', () => {
  /**
   * **The reproduction.** `PendingCasting` carried no `damageType`, so
   * settlement fell back to the definition's printed Radiant — and a casting
   * declared Necrotic bounced off a creature Immune to Radiant, which is the
   * exact failure the stated-type field exists to prevent.
   */
  it('burns a Radiant-immune creature when Necrotic was declared', () => {
    const game = new Game();
    game.declare('spirit-guardians', { damageType: 'necrotic' });
    game.settleCast();
    sweep(game);
    expect(game.hp(WARDED)).toBeLessThan(MAX_HP);
  });

  it('bounces off that same creature when Radiant was declared', () => {
    const game = new Game();
    game.declare('spirit-guardians', { damageType: 'radiant' });
    game.settleCast();
    sweep(game);
    expect(game.hp(WARDED)).toBe(MAX_HP);
  });

  it('records the stated type on the casting it settles', () => {
    const game = new Game();
    const { castingId } = game.declare('spirit-guardians', { damageType: 'necrotic' });
    game.settleCast();
    expect(ongoingSpellOf(game.state, castingId)?.damageType).toBe('necrotic');
  });

  /** Which is what the atomic path has always done, and the comparison says so. */
  it('agrees with the same spell cast in one breath', () => {
    const held = new Game();
    held.declare('spirit-guardians', { damageType: 'necrotic' });
    held.settleCast();
    sweep(held);

    const atomic = new Game();
    atomic.cast('spirit-guardians', { damageType: 'necrotic' });
    sweep(atomic);

    expect(held.hp(WARDED)).toBeLessThan(MAX_HP);
    expect(atomic.hp(WARDED)).toBeLessThan(MAX_HP);
  });
});

// — the creatures a held casting spared —————————————————————————————————————————

describe('a held Spirit Guardians settles sparing the creatures its caster designated', () => {
  /**
   * SRD: "When you cast this spell, you can designate creatures to be
   * unaffected by it." The designation was made at the declaration, which is
   * when the caster cast it; a settlement that dropped the list caught an ally
   * the caster had explicitly spared.
   */
  it('catches the bystander and spares the designated creature', () => {
    const game = new Game();
    game.declare('spirit-guardians', { damageType: 'radiant', unaffected: [SPARED] });
    game.settleCast();
    sweep(game);

    expect(game.hp(SPARED)).toBe(MAX_HP);
    expect(game.hp(BYSTANDER)).toBeLessThan(MAX_HP);
  });

  it('records the designation on the casting, sorted, so a replay reproduces it', () => {
    const game = new Game();
    const { castingId } = game.declare('spirit-guardians', {
      damageType: 'radiant',
      unaffected: [SPARED, BYSTANDER],
    });
    game.settleCast();
    expect(ongoingSpellOf(game.state, castingId)?.unaffected).toEqual(
      [SPARED, BYSTANDER].slice().sort(),
    );
  });

  it('agrees with the same spell cast in one breath', () => {
    const held = new Game();
    held.declare('spirit-guardians', { damageType: 'radiant', unaffected: [SPARED] });
    held.settleCast();
    sweep(held);

    const atomic = new Game();
    atomic.cast('spirit-guardians', { damageType: 'radiant', unaffected: [SPARED] });
    sweep(atomic);

    expect(held.hp(SPARED)).toBe(atomic.hp(SPARED));
    expect(held.hp(BYSTANDER)).toBe(atomic.hp(BYSTANDER));
  });
});

// — a stated type that lands at the cast rather than at a trigger ——————————————

describe('a held Protection from Energy grants the Resistance its caster chose', () => {
  /**
   * Spirit Guardians states its type for an *area trigger*; this one states it
   * for an effect that lands at the cast, so the substitution has to reach the
   * casting's own effects too. The definition prints `acid` as the placeholder
   * `statedDamageType` rewrites — so a settlement that dropped the stated type
   * granted Resistance to Acid whatever the caster chose.
   */
  const held = (damageType: string): GameState => {
    const game = new Game();
    game.declare('protection-from-energy', { targets: [FIGHTER], damageType });
    game.settleCast();
    return game.state;
  };

  it('resists the type that was declared', () => {
    expect(hitFor(held('cold'), FIGHTER, 'cold', 20)).toBe(10);
  });

  it('does not resist the placeholder the definition prints', () => {
    expect(hitFor(held('cold'), FIGHTER, 'acid', 20)).toBe(20);
  });

  it('agrees with the same spell cast in one breath', () => {
    const game = new Game();
    game.cast('protection-from-energy', { targets: [FIGHTER], damageType: 'cold' });
    expect(hitFor(game.state, FIGHTER, 'cold', 20)).toBe(10);
    expect(hitFor(game.state, FIGHTER, 'acid', 20)).toBe(20);
  });

  it('records the stated type on the casting', () => {
    const game = new Game();
    const { castingId } = game.declare('protection-from-energy', {
      targets: [FIGHTER],
      damageType: 'cold',
    });
    game.settleCast();
    expect(ongoingSpellOf(game.state, castingId)?.damageType).toBe('cold');
  });
});

// — a casting that stated nothing is untouched ——————————————————————————————————

describe('a held casting that states neither fact is unchanged', () => {
  /**
   * Both fields are optional, so a declaration that names neither folds to
   * exactly the bytes it always did — which is the whole compatibility story
   * for the two frozen logs.
   */
  it('writes no such field on the declaration', () => {
    const game = new Game();
    const { events } = game.declare('hold-person', { targets: [WARDED], slotLevel: 2 });
    const declared = events.find((e) => e.type === 'spell-declared');
    expect(declared).toBeDefined();
    if (declared?.type !== 'spell-declared') throw new Error('no declaration');
    expect('damageType' in declared.casting).toBe(false);
    expect('unaffected' in declared.casting).toBe(false);
  });

  it('leaves neither field on the record it settles', () => {
    const game = new Game();
    const { castingId } = game.declare('hold-person', { targets: [WARDED], slotLevel: 2 });
    game.settleCast();
    const record = ongoingSpellOf(game.state, castingId);
    expect(record).toBeDefined();
    expect(record?.damageType).toBeUndefined();
    expect(record?.unaffected).toBeUndefined();
  });

  /** And an empty designation is the absence of one, not an empty list. */
  it('elides an empty designation rather than recording one', () => {
    const game = new Game();
    const { events } = game.declare('spirit-guardians', {
      damageType: 'radiant',
      unaffected: [],
    });
    const declared = events.find((e) => e.type === 'spell-declared');
    if (declared?.type !== 'spell-declared') throw new Error('no declaration');
    expect('unaffected' in declared.casting).toBe(false);
  });
});

// — the log stays foldable ——————————————————————————————————————————————————————

describe('every prefix of a held, stated casting folds', () => {
  it('folds at every prefix', () => {
    const game = new Game();
    game.declare('spirit-guardians', { damageType: 'necrotic', unaffected: [SPARED] });
    game.settleCast();
    sweep(game);
    for (let n = 0; n <= game.events.length; n += 1) {
      expect(() => fold('seed', game.events.slice(0, n))).not.toThrow();
    }
  });

  /** Replaying the whole log reproduces the stated facts rather than re-deriving them. */
  it('reproduces the stated facts from the log alone', () => {
    const game = new Game();
    const { castingId } = game.declare('spirit-guardians', {
      damageType: 'necrotic',
      unaffected: [SPARED],
    });
    game.settleCast();
    const replayed = game.events.reduce(applyEvent, fold('seed', []));
    expect(ongoingSpellOf(replayed, castingId)?.damageType).toBe('necrotic');
    expect(ongoingSpellOf(replayed, castingId)?.unaffected).toEqual([SPARED]);
  });
});
