import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { declaredCasting } from './spellcasting.js';
import { asCharacterId, isErr, expect as unwrap, type CharacterId , isNeedsContext, contextRequestsOf } from '@ie/shared';
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
/**
 * 85 feet *east*: past Mass Cure Wounds' 60-foot range but inside a Sphere
 * centred within it. Deliberately off the north-south line the other three sit
 * on — bearing 0 is +y here — so no Cone or Line pointed at `far` sweeps it up
 * and changes what the geometry fixtures below catch.
 */
const YONDER = id('yonder');

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
  added(YONDER),
  slot(1, 4),
  slot(3, 3),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { creature: WIZARD }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: WIZARD }, feet: 60, bearing: 0 } },
  { type: 'creature-placed', id: BEHIND, placement: { from: { creature: WIZARD }, feet: 10, bearing: 180 } },
  // Placed from its own landmark rather than by bearing, so the coordinate is
  // stated outright: 85 feet east of the wizard, off the north-south line the
  // other three share.
  { type: 'landmark-added', name: 'the well', at: { x: 185, y: 100, z: 0 } },
  { type: 'creature-placed', id: YONDER, placement: { from: { landmark: 'the well' }, feet: 0 } },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      prepared: ['burning-hands', 'fireball', 'lightning-bolt', 'thunderwave', 'mass-cure-wounds'],
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

/** A bonus big enough to settle every save, so the branch is not luck. */
const supply = (seed: string, bonus: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
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
    expect(high.outcomes[0]?.damage ?? 0).toBeGreaterThan(low.outcomes[0]?.damage ?? 0);
  });
});

describe('one saving throw, several damage types', () => {
  /**
   * SRD Flame Strike deals "5d6 Fire damage and 5d6 Radiant damage" on a
   * single Dexterity save. Two effects would roll two saves and let a target
   * fail one and make the other, which is not the spell.
   */
  it('rolls one save for both halves of Flame Strike', () => {
    const state = fold('seed', [
      ...SETUP,
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: spellSlotKey(5), label: 'level 5 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: WIZARD,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['flame-strike', 'ice-storm'] }),
      },
    ]);
    const out = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'flame-strike', targets: [], at: at(state, NEAR), slotLevel: 5 },
        supply('strike', -40),
      ),
      'flame-strike',
    );

    for (const outcome of out.outcomes) {
      expect(outcome.save).toBeDefined();
    }
    // One save per creature caught, not two.
    const saves = out.events.filter(
      (e) => e.type === 'roll-recorded' && e.label.includes('Flame Strike'),
    );
    expect(saves).toHaveLength(out.outcomes.length);
  });

  /**
   * Resistance to one of the two types halves only that half. This is what
   * `applyDamage` summing per type was always for, and what a single collapsed
   * number would get wrong.
   */
  it('applies a Resistance to one type and leaves the other whole', () => {
    const declare = (defenses: Record<string, { resistant?: boolean }>): GameState =>
      fold('seed', [
        ...SETUP.map((event) =>
          event.type === 'creature-added' && event.id === NEAR
            ? { ...event, defenses }
            : event,
        ),
        {
          type: 'resource-pool-declared',
          id: WIZARD,
          pool: { key: spellSlotKey(5), label: 'level 5 spell slot', max: 2, recovers: 'long-rest' },
        },
        {
          type: 'spellcasting-declared',
          id: WIZARD,
          spellcasting: declaredCasting({ ability: 'int', prepared: ['flame-strike'] }),
        },
      ]);

    const cast = (state: GameState) => {
      const out = unwrap(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'flame-strike', targets: [], at: at(state, NEAR), slotLevel: 5 },
          supply('strike', -40),
        ),
        'flame-strike',
      );
      return out.outcomes.find((o) => o.target === NEAR)?.damage ?? 0;
    };

    const whole = cast(declare({}));
    const halfFire = cast(declare({ fire: { resistant: true } }));
    const both = cast(declare({ fire: { resistant: true }, radiant: { resistant: true } }));

    expect(halfFire).toBeLessThan(whole);
    expect(both).toBeLessThan(halfFire);
    // Resisting only Fire still leaves more than resisting both: the Radiant
    // half came through untouched.
    expect(whole - halfFire).toBeLessThan(whole - both);
  });

  /** SRD Ice Storm upcasts only its Bludgeoning; the Cold stays at 4d6. */
  it('scales only the half the spell says scales', () => {
    const state = fold('seed', [
      ...SETUP,
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: spellSlotKey(4), label: 'level 4 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: spellSlotKey(6), label: 'level 6 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: WIZARD,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['ice-storm'] }),
      },
    ]);

    const cast = (slotLevel: number) => {
      const out = unwrap(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'ice-storm', targets: [], at: at(state, NEAR), slotLevel },
          supply('storm', -40),
        ),
        'ice-storm',
      );
      return out.outcomes.find((o) => o.target === NEAR)?.damage ?? 0;
    };

    // Two slot levels up is +2d10 Bludgeoning and no extra Cold at all, so the
    // increase can never exceed twenty.
    const grew = cast(6) - cast(4);
    expect(grew).toBeGreaterThan(0);
    expect(grew).toBeLessThanOrEqual(20);
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

    const applied = [...SETUP, ...first.events];
    const after = fold('seed', applied);
    const retry = unwrap(resolveSpell(after, WIZARD, request, supply('r', -40)), 'retry');

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
    const out = resolveSpell(
      unplaced,
      WIZARD,
      { spellId: 'burning-hands', targets: [], towards: { x: 200, y: 100, z: 0 }, slotLevel: 1 },
      supply('ask', -40),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out)[0]?.kind).toBe('position');
    expect(contextRequestsOf(out)[0]?.subject).toBe(WIZARD);
  });
});

/**
 * The third way a spell finds its targets: the caller chooses them, from
 * inside an area.
 *
 * SRD Mass Cure Wounds — "Choose up to six creatures in a 30-foot-radius
 * Sphere centered on [a point you can see within range]" — is neither of the
 * other two. An area picking its own targets would heal every enemy standing
 * in the Sphere, which is not the spell; a plain target list would let the
 * caster heal anyone within range and ignore the Sphere entirely.
 *
 * So the Sphere bounds *eligibility* and the caller still names who is healed.
 * The range then belongs to the **point**, not to each target: the SRD reaches
 * 60 feet to place a 30-foot Sphere, so a creature 85 feet from the caster is
 * a legal target and measuring it from the caster would wrongly refuse it.
 */
describe('targets chosen from inside an area', () => {
  /** A level 5 slot, which SETUP leaves out so other tests can declare it. */
  const ready = (extra: readonly GameEvent[] = []): GameState =>
    fold('seed', [...SETUP, slot(5, 2), ...extra]);

  /** North, where `near`, `far` and `behind` stand. */
  const north = (feet: number) => ({ x: 100, y: 100 + feet, z: 0 });
  /** East, where `yonder` stands alone. */
  const east = (feet: number) => ({ x: 100 + feet, y: 100, z: 0 });

  it('heals a creature the caller named inside the Sphere', () => {
    const hurt = ready([{ type: 'damage-taken', id: NEAR, amount: 20, source: 'setup' }]);
    const out = unwrap(
      resolveSpell(
        hurt,
        WIZARD,
        { spellId: 'mass-cure-wounds', targets: [NEAR], at: north(10), slotLevel: 5 },
        supply('heal', 0),
      ),
      'mass cure wounds',
    );
    expect(out.outcomes.map((o) => o.target)).toEqual([NEAR]);
    expect(out.events.some((e) => e.type === 'healed')).toBe(true);
  });

  /** The Sphere is the bound, and a creature outside it is not eligible. */
  it('refuses a named target standing outside the Sphere', () => {
    const result = resolveSpell(
      ready(),
      WIZARD,
      { spellId: 'mass-cure-wounds', targets: [BEHIND], at: north(60), slotLevel: 5 },
      supply('out', 0),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('outside_area');
  });

  /**
   * The point carries the range, so the Sphere reaches further than the
   * caster does. `yonder` is 85 feet away and the spell reaches 60.
   */
  it('reaches a creature further away than the spell’s own range', () => {
    const out = unwrap(
      resolveSpell(
        ready(),
        WIZARD,
        { spellId: 'mass-cure-wounds', targets: [YONDER], at: east(60), slotLevel: 5 },
        supply('far', 0),
      ),
      'yonder',
    );
    expect(out.outcomes.map((o) => o.target)).toEqual([YONDER]);
  });

  /** And the point itself is still held to the spell's range. */
  it('refuses to centre the Sphere beyond the spell’s range', () => {
    const result = resolveSpell(
      ready(),
      WIZARD,
      { spellId: 'mass-cure-wounds', targets: [YONDER], at: east(85), slotLevel: 5 },
      supply('reach', 0),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('out_of_range');
  });

  /** Nothing defaults the point, exactly as for a Fireball. */
  it('refuses to centre the Sphere nowhere', () => {
    const result = resolveSpell(
      ready(),
      WIZARD,
      { spellId: 'mass-cure-wounds', targets: [NEAR], slotLevel: 5 },
      supply('none', 0),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_origin');
  });
});
