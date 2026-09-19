import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import {
  advanceTime,
  createRng,
  createRollIssuer,
  declaredCasting,
  fold,
  pendingCastingsOf,
  remaining,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  spellSlotKey,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * The three spells the second catalogue pass **executes**, driven.
 *
 * Forty-nine of that pass's fifty-two definitions are tracked, and the tracked
 * sweeps hold them: the slot, the action, the Concentration, the clock and the
 * sentences handed to the table. These three are the ones whose arithmetic the
 * engine really does, and two lessons from the pass before decide how they are
 * asserted here.
 *
 * **A single seeded casting cannot tell 3d12 from 1d12.** One roll of 4d8 + 15
 * lands somewhere between 19 and 47, and so does one roll of 1d8 + 30; a test
 * that pinned one seed's answer would agree with a definition that had lost
 * three dice. So every dice claim below is made over many seeds, and it is made
 * about the **mean** as well as the bounds — the bounds catch a missing addend
 * and the mean catches a missing die.
 *
 * **A definition that rolls nothing of its own can pass the whole suite while
 * being wrong.** Regenerate's hit point a turn is not rolled at the casting at
 * all: it is handed over at a turn boundary by machinery that has to be driven
 * to reach it, so the turn is advanced and the target's hit points are read
 * afterwards.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const HURT = id('hurt');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 13,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, maxHp: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

/**
 * A creature is added at full, so a heal with nowhere to go is the fixture's
 * fault rather than the spell's: these two are wounded first, far enough that
 * the maximum cannot cap a roll and hide a missing die.
 */
const wounded = (who: CharacterId, amount: number): GameEvent => ({
  type: 'damage-taken',
  id: who,
  amount,
  source: 'the road here',
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
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

const PREPARED = ['regenerate', 'prayer-of-healing', 'shining-smite'];

const SETUP: readonly GameEvent[] = [
  added(CLERIC, 90),
  // Deliberately far from full, so a heal has room to land and a cap cannot
  // hide a missing die.
  added(HURT, 200),
  added(ALLY, 200),
  added(FOE, 300),
  wounded(HURT, 180),
  wounded(ALLY, 180),
  ...slots(CLERIC),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: HURT,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: FOE,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 180 },
  },
  { type: 'sight-declared', from: CLERIC, to: HURT, seen: true },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: CLERIC, to: FOE, seen: true },
  { type: 'items-gained', id: CLERIC, items: [{ id: 'greatsword', quantity: 1 }], source: 'loot' },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: [],
      prepared: PREPARED,
    }),
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer(`r-${seed}`),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The whole of a long casting: declare, run the clock, settle. */
const castAndSettle = (
  spellId: string,
  targets: readonly CharacterId[],
  seed: string,
  slotLevel?: number,
): { readonly state: GameState; readonly log: readonly GameEvent[] } => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const level = slotLevel ?? definition.level;
  const first = unwrap(
    resolveSpell(fold('seed', SETUP), CLERIC, { spellId, targets, slotLevel: level }, supply(seed)),
    `${spellId} declared`,
  );
  const open = fold('seed', [...SETUP, ...first.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(advanceTime(open, definition.castingSeconds!, 'the rite'), 'tick');
  const ticked = [...SETUP, ...first.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply(seed)),
    `${spellId} settled`,
  );
  const log = [...ticked, ...settled.events];
  return { state: fold('seed', log), log };
};

/** What one casting healed a target, read off the vitals rather than the dice. */
const healed = (spellId: string, who: CharacterId, seed: string, slotLevel?: number): number => {
  const before = fold('seed', SETUP).creatures[who]!.vitals.hp;
  const { state } = castAndSettle(spellId, [who], seed, slotLevel);
  return state.creatures[who]!.vitals.hp - before;
};

const SEEDS = Array.from({ length: 60 }, (_, n) => `seed-${n}`);

const mean = (values: readonly number[]): number =>
  values.reduce((total, one) => total + one, 0) / values.length;

describe('Regenerate is the spell a-long-casting-time was the only blocker of', () => {
  /**
   * The finding this definition is: the shape's own description has said "the
   * mechanism is whole" since IE-034 and IE-041, so the entry recorded a spell
   * nobody had written rather than a mechanic nobody had built.
   */
  it('is a long casting the engine runs, and an executed one', () => {
    const definition = SRD_CONTENT.spell('regenerate')!;
    expect(definition.castingTime).toBe('long');
    expect(definition.castingSeconds).toBe(60);
    expect(definition.effects.map((effect) => effect.kind)).toEqual(['heal', 'turn-payout']);
  });

  /** Declared, not cast: the slot waits on the minute like every other rite. */
  it('spends nothing until the minute is up, and the slot when it is', () => {
    const first = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CLERIC,
        { spellId: 'regenerate', targets: [HURT], slotLevel: 7 },
        supply('rite'),
      ),
      'declared',
    );
    expect(first.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(first.events.some((e) => e.type === 'spell-cast')).toBe(false);
    const open = fold('seed', [...SETUP, ...first.events]);
    expect(remaining(open.creatures.cleric!.resources, spellSlotKey(7))).toBe(4);

    const { state } = castAndSettle('regenerate', [HURT], 'rite');
    expect(remaining(state.creatures.cleric!.resources, spellSlotKey(7))).toBe(3);
  });

  /**
   * **4d8 + 15, over sixty seeds.**
   *
   * The bounds catch the addend `docs/rules/srd-policy.md` records Finger of
   * Death silently dropping for weeks — 19 is impossible without the fifteen —
   * and the mean catches a definition that kept the addend and lost dice: 4d8
   * averages 18 and 1d8 averages 4.5, so a single die would pull the mean from
   * 33 down to about 19.5 while every bound still held.
   */
  it('heals 4d8 + 15, checked by its bounds and by its mean', () => {
    const rolls = SEEDS.map((seed) => healed('regenerate', HURT, seed));
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(4 + 15);
    expect(Math.max(...rolls)).toBeLessThanOrEqual(32 + 15);
    // 4d8 + 15 averages 33. Sixty samples of a 4d8 sit inside a point of it.
    expect(mean(rolls)).toBeGreaterThan(30);
    expect(mean(rolls)).toBeLessThan(36);
    // And the dice really move, so the mean is a mean rather than a constant.
    expect(new Set(rolls).size).toBeGreaterThan(5);
  });

  /**
   * **The hit point a turn, driven.** Nothing about it is rolled at the
   * casting, so a definition that had written the payout wrong — the caster's
   * turn instead of the target's, or Temporary Hit Points instead of healing —
   * would pass every assertion above. The turn is advanced and the vitals are
   * read.
   */
  it('hands the target one Hit Point at the start of each of its own turns', () => {
    const { log } = castAndSettle('regenerate', [HURT], 'payout');
    const started: readonly GameEvent[] = [
      ...log,
      {
        type: 'combat-started',
        combatants: [
          { id: CLERIC, initiative: 20, speed: 30 },
          { id: HURT, initiative: 10, speed: 30 },
        ],
      },
    ];
    const atCast = fold('seed', started).creatures.hurt!.vitals.hp;

    // The cleric's turn goes by first, and the payout is not theirs.
    const afterCaster = unwrap(
      resolveTurn(fold('seed', started), supply('turn-1')),
      'the caster ends their turn',
    );
    const mid = [...started, ...afterCaster.events];
    expect(fold('seed', mid).creatures.hurt!.vitals.hp).toBe(atCast + 1);
  });

  /** And the hour runs out on the clock, a second short and past it. */
  it('runs its hour and then stops paying out', () => {
    const { log } = castAndSettle('regenerate', [HURT], 'clock');
    expect(Object.keys(fold('seed', log).timers)).toHaveLength(1);
    const almost = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3599, reason: 'the watch' },
    ]);
    expect(Object.keys(almost.timers)).toHaveLength(1);
    const over = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3600, reason: 'the watch' },
    ]);
    expect(Object.keys(over.timers)).toHaveLength(0);
    expect(over.ongoing).toEqual({});
  });

  /** The regrown limbs are the only thing left, and the table is told so. */
  it('hands the regrowing limbs to the table, word for word', () => {
    const first = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CLERIC,
        { spellId: 'regenerate', targets: [HURT], slotLevel: 7 },
        supply('table'),
      ),
      'declared',
    );
    const open = fold('seed', [...SETUP, ...first.events]);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    const tick = unwrap(advanceTime(open, 60, 'the rite'), 'tick');
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', [...SETUP, ...first.events, ...tick]), castingId, supply('table')),
      'settled',
    );
    for (const gap of SRD_CONTENT.spell('regenerate')!.unmodelled ?? []) {
      expect(settled.unverified).toContain(`Regenerate: ${gap}`);
    }
  });
});

describe('Prayer of Healing is the first executed rite of ten minutes', () => {
  it('takes the ten minutes the book prints and heals five', () => {
    const definition = SRD_CONTENT.spell('prayer-of-healing')!;
    expect(definition.castingTime).toBe('long');
    expect(definition.castingSeconds).toBe(600);
    expect(definition.targets.count).toBe(5);
  });

  /** Settling a second early is refused, so the ten minutes mean something. */
  it('refuses to settle a second early', () => {
    const first = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CLERIC,
        { spellId: 'prayer-of-healing', targets: [HURT, ALLY], slotLevel: 2 },
        supply('early'),
      ),
      'declared',
    );
    const open = fold('seed', [...SETUP, ...first.events]);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    const tick = unwrap(advanceTime(open, 599, 'nearly there'), 'tick');
    const out = resolveDeclaredCast(
      fold('seed', [...SETUP, ...first.events, ...tick]),
      castingId,
      supply('early'),
    );
    expect(isErr(out) && out.code).toBe('still_casting');
  });

  /**
   * **2d8, and 1d8 more per slot level above 2, over sixty seeds each.**
   *
   * The bounds alone cannot tell 2d8 from 3d8 — both can roll a 3 — so the
   * claim is the *gap between the means*: one more d8 is 4.5 more hit points,
   * and a level 5 casting should average about thirteen and a half more than a
   * level 2 one. A definition that dropped `perSlotLevelAbove` would heal the
   * same at both and this is what would catch it.
   */
  it('heals 2d8, and one die more per slot level, checked by the gap between the means', () => {
    const low = SEEDS.map((seed) => healed('prayer-of-healing', HURT, seed, 2));
    const high = SEEDS.map((seed) => healed('prayer-of-healing', HURT, seed, 5));
    expect(Math.min(...low)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...low)).toBeLessThanOrEqual(16);
    expect(Math.min(...high)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...high)).toBeLessThanOrEqual(40);
    // 2d8 averages 9; 5d8 averages 22.5. The gap is three more dice.
    expect(mean(low)).toBeGreaterThan(7);
    expect(mean(low)).toBeLessThan(11);
    expect(mean(high) - mean(low)).toBeGreaterThan(9);
    expect(mean(high) - mean(low)).toBeLessThan(18);
  });

  /** Every one of the five it reaches is healed, not just the first. */
  it('heals each creature it names', () => {
    const { state } = castAndSettle('prayer-of-healing', [HURT, ALLY], 'both');
    expect(state.creatures.hurt!.vitals.hp).toBeGreaterThan(20);
    expect(state.creatures.ally!.vitals.hp).toBeGreaterThan(20);
  });

  /** And the Short Rest it also confers is the table's, said out loud. */
  it('tells the table about the Short Rest it does not confer', () => {
    const definition = SRD_CONTENT.spell('prayer-of-healing')!;
    const rest = (definition.unmodelled ?? []).filter((note) =>
      note.includes('the benefits of a Short Rest are not conferred'),
    );
    expect(rest).toHaveLength(1);
  });
});

describe('Shining Smite joins the blow rather than being cast at anybody', () => {
  /** The ordinary casting command refuses it, in the words it refuses smites in. */
  it('is refused by resolveSpell, because there is no hit to join', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      CLERIC,
      { spellId: 'shining-smite', targets: [], slotLevel: 2 },
      supply('nope'),
    );
    expect(isErr(out) && out.code).toBe('cast_on_a_hit');
  });

  /**
   * **2d6 Radiant on top of the greatsword, and 1d6 more per slot level.**
   *
   * Driven through the attack that carries it — a held swing settled with the
   * smite named — and measured as a *difference*: the same seed with and
   * without the spell, so the weapon's own 2d6 and the Strength modifier
   * cancel and what is left is the spell's dice. The mean of the difference is
   * the assertion that can tell 2d6 from 1d6.
   */
  const swingAndSmite = (seed: string, slotLevel: number | null): number => {
    const start = fold('seed', SETUP);
    const swing = unwrap(
      resolveAttack(
        start,
        CLERIC,
        { target: FOE, weapon: 'greatsword', twoHanded: true, hold: true },
        supply(seed),
      ),
      'swing',
    );
    if (swing.attack?.hit !== true) return Number.NaN;
    const held = [...SETUP, ...swing.events];
    const settled = unwrap(
      resolveAttackDamage(
        fold('seed', held),
        CLERIC,
        slotLevel === null ? {} : { smite: { spellId: 'shining-smite', slotLevel } },
        supply(seed),
      ),
      'settle',
    );
    return settled.damage ?? 0;
  };

  it('adds 2d6 Radiant to the hit, and one die more per slot level', () => {
    const plain = SEEDS.map((seed) => swingAndSmite(seed, null)).filter((n) => !Number.isNaN(n));
    const smitten = SEEDS.map((seed) => swingAndSmite(seed, 2)).filter((n) => !Number.isNaN(n));
    const upcast = SEEDS.map((seed) => swingAndSmite(seed, 5)).filter((n) => !Number.isNaN(n));
    expect(plain.length).toBeGreaterThan(20);

    // **Compared as populations rather than pair by pair**, because naming the
    // smite advances the generator: the same seed rolls the greatsword
    // differently once two more dice have been drawn before it, so a per-seed
    // difference is not the spell's dice. The means are, and the means are
    // what can tell 2d6 from 1d6.
    //
    // A greatsword is 2d6 and Strength 16 is +3, so a plain hit averages 10 and
    // 2d6 of Radiant is 7 more. The window is wide enough for the critical
    // hits sixty swings contain and far too narrow for a missing die.
    expect(mean(smitten) - mean(plain)).toBeGreaterThan(4);
    expect(mean(smitten) - mean(plain)).toBeLessThan(11);
    // And three dice more at level 5, which is 10.5.
    expect(mean(upcast) - mean(smitten)).toBeGreaterThan(6);
    expect(mean(upcast) - mean(smitten)).toBeLessThan(16);

    // The floor moves too, which no averaging can fake: the smallest smitten
    // hit in sixty swings is above the smallest plain one, because two dice
    // were added to every single one of them.
    expect(Math.min(...smitten)).toBeGreaterThanOrEqual(Math.min(...plain) + 2);
  });

  /** The slot really goes, and Concentration really starts. */
  it('spends the slot and takes the Concentration the book prints', () => {
    const swing = unwrap(
      resolveAttack(
        fold('seed', SETUP),
        CLERIC,
        { target: FOE, weapon: 'greatsword', twoHanded: true, hold: true },
        supply('conc'),
      ),
      'swing',
    );
    expect(swing.attack?.hit).toBe(true);
    const held = [...SETUP, ...swing.events];
    const settled = unwrap(
      resolveAttackDamage(
        fold('seed', held),
        CLERIC,
        { smite: { spellId: 'shining-smite', slotLevel: 2 } },
        supply('conc'),
      ),
      'settle',
    );
    const after = fold('seed', [...held, ...settled.events]);
    expect(remaining(after.creatures.cleric!.resources, spellSlotKey(2))).toBe(3);
    expect(SRD_CONTENT.spell('shining-smite')!.concentration).toBe(true);
    expect(after.creatures.cleric!.concentration).not.toBeNull();
  });
});
