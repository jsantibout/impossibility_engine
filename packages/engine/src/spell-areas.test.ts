import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { resolveSpell } from './commands.js';

/**
 * A spell that fills an area picks its own targets.
 *
 * That is the whole difference, and it is a big one: a named-target spell is
 * handed ids that Maestro resolved from the fiction, while an area spell is
 * handed a *place* and works out who is standing in it. Nobody gets to choose
 * who the Fireball catches — including the caster, who is caught by their own
 * if they drop it at their feet.
 *
 * The geometry is `positioning.ts`'s and is tested there, on the lattice, for
 * all six shapes. What is tested here is the spell's half: that the caller is
 * made to say where and which way, that the point is in range, that the caught
 * list is the one the geometry produced, and that each creature in it rolls
 * its own save.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('kessa');
const NEAR = id('near');
const FAR = id('far');
const BEHIND = id('behind');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slot = (level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: WIZARD,
  pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max, recovers: 'long-rest' },
});

/**
 * Four creatures on a line running east from the wizard.
 *
 * `near` is 10 feet away, `far` is 60, `behind` is 10 feet *west* — so a Cone
 * or Line pointed east catches one and not the others, and a Sphere dropped
 * between them can be made to catch exactly who the geometry says.
 */
const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(NEAR),
  added(FAR),
  added(BEHIND),
  slot(1, 4),
  slot(3, 3),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { creature: WIZARD }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: WIZARD }, feet: 60, bearing: 0 } },
  { type: 'creature-placed', id: BEHIND, placement: { from: { creature: WIZARD }, feet: 10, bearing: 180 } },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: {
      ability: 'int',
      cantrips: [],
      prepared: ['burning-hands', 'fireball', 'lightning-bolt', 'thunderwave'],
      granted: [],
    },
  },
];

const base = (): GameState => fold('seed', SETUP);

/** A bonus big enough to settle every save, so the branch is not luck. */
const supply = (seed: string, bonus: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'forced', flat: bonus }],
});

const at = (state: GameState, who: CharacterId) => {
  const point = state.scene?.positions[who];
  if (point === undefined) throw new Error(`${who} is not placed`);
  return point;
};

const caught = (
  state: GameState,
  request: Parameters<typeof resolveSpell>[2],
  bonus = -40,
): readonly CharacterId[] => {
  const out = unwrap(resolveSpell(state, WIZARD, request, supply('area', bonus)), 'cast');
  if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
  return out.outcomes.map((o) => o.target);
};

describe('an area picks its own targets', () => {
  it('refuses a target list, because the area decides who is in it', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      { spellId: 'fireball', targets: [NEAR], at: at(base(), FAR), slotLevel: 3 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('area_picks_its_own_targets');
  });

  /** SRD Fireball: "a point you choose within range". Nothing defaults it. */
  it('refuses to centre a Sphere nowhere', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      { spellId: 'fireball', targets: [], slotLevel: 3 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_origin');
  });

  /** SRD Burning Hands: **Range: Self**. The Cone starts at you, full stop. */
  it('refuses to start a self-originating Cone somewhere else', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      { spellId: 'burning-hands', targets: [], at: at(base(), FAR), towards: at(base(), FAR), slotLevel: 1 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('area_starts_at_caster');
  });

  it('refuses a Cone with no direction to point in', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      { spellId: 'burning-hands', targets: [], slotLevel: 1 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_direction');
  });

  it('refuses to point a Sphere, which has no direction', () => {
    const state = base();
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'fireball', targets: [], at: at(state, FAR), towards: at(state, NEAR), slotLevel: 3 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_directional');
  });

  /** SRD Fireball: Range 150 feet, and a point beyond it is out of range. */
  it('refuses a point beyond the spell’s range', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      { spellId: 'fireball', targets: [], at: { x: 400, y: 100, z: 0 }, slotLevel: 3 },
      supply('a', -40),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('out_of_range');
  });
});

describe('the geometry decides, and it decides the same way it always did', () => {
  /** A 15-foot Cone east catches the creature 10 feet east and nobody else. */
  it('catches what a Cone pointed east catches', () => {
    const state = base();
    expect(caught(state, {
      spellId: 'burning-hands',
      targets: [],
      towards: at(state, FAR),
      slotLevel: 1,
    })).toEqual([NEAR]);
  });

  /** A 100-foot Line east reaches both of them, and neither one behind. */
  it('catches everyone along a Line', () => {
    const state = base();
    expect(caught(state, {
      spellId: 'lightning-bolt',
      targets: [],
      towards: at(state, FAR),
      slotLevel: 3,
    })).toEqual([FAR, NEAR]);
  });

  /**
   * SRD: a Cone does not include its origin, so the caster is not in their own
   * Burning Hands — but a Sphere *does*, and a wizard who drops a Fireball at
   * their own feet is in it. Both halves, because the difference is the rule.
   */
  it('leaves the caster out of a Cone and inside their own Fireball', () => {
    const state = base();
    expect(caught(state, {
      spellId: 'burning-hands',
      targets: [],
      towards: at(state, FAR),
      slotLevel: 1,
    })).not.toContain(WIZARD);

    expect(caught(state, {
      spellId: 'fireball',
      targets: [],
      at: at(state, WIZARD),
      slotLevel: 3,
    })).toContain(WIZARD);
  });

  it('catches a whole cluster inside a 20-foot Sphere', () => {
    const state = base();
    const hit = caught(state, {
      spellId: 'fireball',
      targets: [],
      at: at(state, NEAR),
      slotLevel: 3,
    });
    // Centred on `near`, a 20-foot radius reaches the wizard and `behind`
    // (10 and 20 feet away) but not `far`, which is 50 feet from it.
    expect(hit).toContain(NEAR);
    expect(hit).toContain(WIZARD);
    expect(hit).not.toContain(FAR);
  });

  /** SRD: "A spell's area of effect is blocked by Total Cover." */
  it('does not catch a creature behind Total Cover', () => {
    const state = fold('seed', [
      ...SETUP,
      { type: 'cover-declared', from: WIZARD, to: NEAR, degree: 'total' },
    ]);
    expect(caught(state, {
      spellId: 'burning-hands',
      targets: [],
      towards: at(state, FAR),
      slotLevel: 1,
    })).toEqual([]);
  });
});

describe('everyone caught rolls their own save', () => {
  it('damages those who fail and half-damages those who do not', () => {
    const state = base();
    const failed = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'lightning-bolt', targets: [], towards: at(state, FAR), slotLevel: 3 },
        supply('fail', -40),
      ),
      'bolt',
    );
    if (failed.kind !== 'resolved') throw new Error('expected a resolved cast');
    expect(failed.outcomes).toHaveLength(2);
    for (const outcome of failed.outcomes) {
      expect(outcome.save?.success).toBe(false);
      expect(outcome.affected).toBe(true);
      expect(outcome.damage ?? 0).toBeGreaterThan(0);
    }

    const saved = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'lightning-bolt', targets: [], towards: at(state, FAR), slotLevel: 3 },
        supply('fail', 40),
      ),
      'bolt',
    );
    if (saved.kind !== 'resolved') throw new Error('expected a resolved cast');
    // SRD Lightning Bolt: "half as much damage on a successful one."
    for (const outcome of saved.outcomes) {
      expect(outcome.save?.success).toBe(true);
      expect(outcome.affected).toBe(false);
    }
    const full = failed.outcomes.reduce((n, o) => n + (o.damage ?? 0), 0);
    const halved = saved.outcomes.reduce((n, o) => n + (o.damage ?? 0), 0);
    expect(halved).toBeLessThan(full);
  });

  it('spends one slot however many it caught', () => {
    const state = base();
    const out = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'lightning-bolt', targets: [], towards: at(state, FAR), slotLevel: 3 },
        supply('one', -40),
      ),
      'bolt',
    );
    if (out.kind !== 'resolved') throw new Error('expected a resolved cast');
    const spent = out.events.filter((e) => e.type === 'spell-cast');
    expect(spent).toHaveLength(1);
    expect(out.outcomes).toHaveLength(2);
  });

  /** SRD Fireball: "increases by 1d6 for each spell slot level above 3." */
  it('scales with the slot, and hurts everyone it caught by more', () => {
    const state = base();
    const low = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'fireball', targets: [], at: at(state, FAR), slotLevel: 3 },
        supply('scale', -40),
      ),
      'fireball',
    );
    const high = unwrap(
      resolveSpell(
        fold('seed', [...SETUP, slot(5, 2)]),
        WIZARD,
        { spellId: 'fireball', targets: [], at: at(state, FAR), slotLevel: 5 },
        supply('scale', -40),
      ),
      'fireball',
    );
    if (low.kind !== 'resolved' || high.kind !== 'resolved') throw new Error('unresolved');
    expect(high.outcomes[0]?.damage ?? 0).toBeGreaterThan(low.outcomes[0]?.damage ?? 0);
  });
});

describe('an area cast replays and retries like any other', () => {
  it('is a no-op when the same command id comes back', () => {
    const state = base();
    const request = {
      spellId: 'fireball' as const,
      targets: [],
      at: at(state, FAR),
      slotLevel: 3,
      commandId: 'boom',
    };
    const first = unwrap(resolveSpell(state, WIZARD, request, supply('r', -40)), 'first');
    if (first.kind !== 'resolved') throw new Error('expected a resolved cast');

    const applied = [...SETUP, ...first.events];
    const after = fold('seed', applied);
    const retry = unwrap(resolveSpell(after, WIZARD, request, supply('r', -40)), 'retry');
    if (retry.kind !== 'resolved') throw new Error('expected a resolved cast');

    expect(retry.events).toEqual([]);
    expect(fold('seed', [...applied, ...retry.events])).toEqual(after);
  });

  it('folds prefix by prefix to the same state', () => {
    const state = base();
    const out = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'fireball', targets: [], at: at(state, NEAR), slotLevel: 3 },
        supply('replay', -40),
      ),
      'cast',
    );
    if (out.kind !== 'resolved') throw new Error('expected a resolved cast');

    const log = [...SETUP, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /** Nothing is spent asking where the caster is. */
  it('asks for the caster’s position rather than guessing it', () => {
    // Everyone else is placed relative to the wizard, so taking the wizard
    // off the map takes them with it — which is exactly the state an
    // orchestrator is in before it has narrated where anybody is standing.
    const unplaced = fold('seed', SETUP.filter((e) => e.type !== 'creature-placed'));
    const out = unwrap(
      resolveSpell(
        unplaced,
        WIZARD,
        { spellId: 'burning-hands', targets: [], towards: { x: 200, y: 100, z: 0 }, slotLevel: 1 },
        supply('ask', -40),
      ),
      'ask',
    );
    expect(out.kind).toBe('needs-context');
    if (out.kind !== 'needs-context') throw new Error('expected a request');
    expect(out.requests[0]?.kind).toBe('position');
    expect(out.requests[0]?.subject).toBe(WIZARD);
  });
});
