import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import {
  activateSpell,
  eligibleTargets,
  endConcentration,
  ongoingSpellOf,
  ongoingSpellsBy,
  ongoingSpellsOn,
  removeCreatureEverywhere,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

/**
 * A casting that holds a point in the scene.
 *
 * SRD Spiritual Weapon is the adversarial case for this, and the interesting
 * thing about it is what it is **not**:
 *
 * > "You create a floating, spectral force that resembles a weapon of your
 * > choice and lasts for the duration. The force appears within range in a
 * > space of your choice, and you can immediately make one melee spell attack
 * > against one creature within 5 feet of the force. On a hit, the target
 * > takes Force damage equal to 1d8 plus your spellcasting ability modifier.
 * >
 * > As a Bonus Action on your later turns, you can move the force up to 20
 * > feet and repeat the attack against a creature within 5 feet of it."
 *
 * Nothing can target the force, it has no Armour Class or Hit Points, it makes
 * no attack of its own, nobody else can move it, and the SRD never addresses
 * it except through the caster's own Bonus Action on this casting. Contrast
 * Unseen Servant ("It has AC 10, 1 Hit Point, and a Strength of 2") and Arcane
 * Hand ("an object that has AC 20 and Hit Points equal to your Hit Point
 * maximum"), which print every one of those and belong with summons.
 *
 * So the force is **a point the casting owns**, not a thing. `OngoingSpell`
 * gains an `origin`; there is no entity, no identity beside the casting id,
 * and no world object.
 *
 * The two seams this file exists to pin:
 *
 * - **the attack's spatial origin is not its actor.** The Cleric rolls, the
 *   Cleric's modifier applies, and the five feet are measured from the force.
 * - **relocating the origin is not creature movement.** No Speed, no Difficult
 *   Terrain, no Opportunity Attack, no occupancy.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const RIVAL = id('rival'); // a second Cleric, so two castings stay apart
const NEAR = id('near'); // five feet from the Cleric
const FAR = id('far'); // sixty-five feet away: beyond the spell, beside the force
const MIDDLE = id('middle'); // thirty feet away, adjacent to nothing

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
  ...over,
});

const PREPARED = ['spiritual-weapon', 'bless', 'mage-hand', 'hold-person', 'dispel-magic'];

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: PREPARED, cantrips: ['mage-hand'] }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const supply = (seed = 'weapon') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

/**
 * The geometry every test below leans on, worked out once.
 *
 * The Cleric stands at the hall. `AT_RANGE` is exactly 60 feet from them, which
 * is the spell's printed Range and therefore the furthest space the force may
 * appear in. `FAR` stands one cube beyond that — 65 feet from the Cleric, and 5
 * feet from `AT_RANGE`. That pair is the whole of the attack-origin seam: the
 * Cleric cannot reach `FAR` and the force can.
 */
const HALL: Point = { x: 200, y: 200, z: 0 };
const AT_RANGE: Point = { x: 200, y: 260, z: 0 };
const BEYOND_RANGE: Point = { x: 200, y: 265, z: 0 };

const SETUP: readonly GameEvent[] = [
  added(CLERIC, 'party'),
  added(RIVAL, 'party'),
  added(NEAR, 'foes'),
  added(FAR, 'foes'),
  added(MIDDLE, 'foes'),
  ...casts(CLERIC),
  ...casts(RIVAL),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: HALL },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: CLERIC }, feet: 5, bearing: 270 } },
  { type: 'creature-placed', id: NEAR, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: FAR, placement: { from: { landmark: 'the hall' }, feet: 65, bearing: 0 } },
  { type: 'creature-placed', id: MIDDLE, placement: { from: { landmark: 'the hall' }, feet: 30, bearing: 180 } },
];

/**
 * A room barely wider than the spell reaches.
 *
 * The scene extent and the spell's Range have to be told apart, and in a
 * 600-foot hall they never are: every space past the wall is also past sixty
 * feet, so a missing scene check hides behind the range check. Here the wall
 * is 55 feet from the Cleric and the spell reaches 60.
 */
const CLOSET: readonly GameEvent[] = [
  added(CLERIC, 'party'),
  ...casts(CLERIC),
  { type: 'scene-set', extent: { width: 100, depth: 100, height: 40 } },
  { type: 'landmark-added', name: 'the corner', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the corner' }, feet: 0 } },
];

/** A log that folds, with the handful of helpers these tests want. */
class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Cast Spiritual Weapon and hand back the casting id. */
  conjure(
    who: CharacterId,
    at: Point,
    targets: readonly CharacterId[] = [],
    seed = 'weapon',
    slotLevel = 2,
  ): string {
    const out = unwrap(
      resolveSpell(this.state, who, { spellId: 'spiritual-weapon', targets, at, slotLevel }, supply(seed)),
      `${who} casting Spiritual Weapon`,
    );
    this.push(out.events);
    return out.castingId;
  }

  originOf(castingId: string): Point | undefined {
    return ongoingSpellOf(this.state, castingId)?.origin;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  /**
   * Round the Initiative order back to the caster.
   *
   * SRD: "As a Bonus Action **on your later turns**." Casting the spell was
   * itself the Bonus Action, so every activation in this file needs a turn to
   * have gone by — which is a rule, pinned by its own test below, rather than
   * a fixture convenience.
   */
  laterTurn(): this {
    return this.push([
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ]);
  }

  /** Fold every prefix, so a partially written log is never a special case. */
  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

const roundTrip = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 20, speed: 30 },
      { id: NEAR, initiative: 10, speed: 30 },
      { id: FAR, initiative: 5, speed: 30 },
    ],
  },
];

// — the point exists, and it is only a point ——————————————————————————————————

describe('a casting can own a point in the scene', () => {
  it('records where the force appeared', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    expect(g.originOf(casting)).toEqual(AT_RANGE);
  });

  /**
   * SRD says "in a space of your choice", and a space is a cube on the same
   * lattice every position in this engine lives on. A creature's position is
   * snapped by `project` for exactly this reason; the force's is snapped here.
   */
  it('snaps the chosen space onto the lattice', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, { x: 202, y: 259, z: 1 });
    expect(g.originOf(casting)).toEqual({ x: 200, y: 260, z: 0 });
  });

  /**
   * **The force is not a creature**, and this is the assertion that says so.
   * Nothing is added to the scene's positions, nothing occupies a space, and
   * no id but the casting's exists.
   */
  it('adds nothing to the scene and no creature to the game', () => {
    const before = new Game().state;
    const g = new Game();
    g.conjure(CLERIC, AT_RANGE);

    expect(Object.keys(g.state.creatures).sort()).toEqual(Object.keys(before.creatures).sort());
    expect(g.state.scene?.positions).toEqual(before.scene?.positions);
  });

  /**
   * And it is on nobody. SRD Dispel Magic ends "any ongoing spell ... on the
   * target", and the force is not on the creature it hit — a Dispel Magic
   * aimed at the goblin must not put the Cleric's weapon out.
   */
  it('is on its point rather than on the creature it struck', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, { x: 200, y: 205, z: 0 }, [NEAR]);
    expect(ongoingSpellOf(g.state, casting)?.on).toEqual([]);
    expect(ongoingSpellsOn(g.state, NEAR)).toEqual([]);
  });

  it('pins the level it was cast at, beside the point', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE, [], 'weapon', 4);
    const record = ongoingSpellOf(g.state, casting);
    expect(record?.level).toBe(4);
    expect(record?.origin).toEqual(AT_RANGE);
  });

  /** A spell with no origin has none — absent, not a coordinate nobody chose. */
  it('leaves an ordinary casting without one', () => {
    const g = new Game();
    const out = unwrap(
      resolveSpell(g.state, CLERIC, { spellId: 'bless', targets: [NEAR], slotLevel: 1 }, supply()),
      'bless',
    );
    g.push(out.events);
    expect(ongoingSpellOf(g.state, out.castingId)?.origin).toBeUndefined();
  });
});

// — where it may appear ————————————————————————————————————————————————————————

describe('the force appears within range and nowhere else', () => {
  it('allows the space at exactly the printed range', () => {
    const g = new Game();
    expect(g.originOf(g.conjure(CLERIC, AT_RANGE))).toEqual(AT_RANGE);
  });

  it('refuses the next space beyond it', () => {
    const g = new Game();
    const out = resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [], at: BEYOND_RANGE, slotLevel: 2 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_range');
  });

  /** And refusing costs nothing: no slot, no Concentration, no record. */
  it('spends nothing when it refuses', () => {
    const g = new Game();
    const before = g.state;
    resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [], at: BEYOND_RANGE, slotLevel: 2 },
      supply(),
    );
    expect(g.state).toEqual(before);
  });

  /**
   * A separate, small scene, because the discriminating case is a space that
   * is **within the spell's range and outside the room**. Measured against a
   * 600-foot hall the two are never told apart: anything past the wall is also
   * past sixty feet, and the range check answers first.
   */
  it('refuses a space inside its range but outside the scene', () => {
    const g = new Game([...CLOSET]);
    const out = resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [], at: { x: 105, y: 50, z: 0 }, slotLevel: 2 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('outside_scene');
  });

  it('needs a space to be named at all', () => {
    const g = new Game();
    const out = resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [], slotLevel: 2 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_origin');
  });

  /**
   * A fact nobody has established is homework, not a verdict — the same
   * three-valued discipline every other positional rule follows.
   */
  it('asks where the caster is rather than guessing', () => {
    // Everyone anchored to a landmark rather than to the Cleric, so the Cleric
    // can be left unplaced and the log still folds.
    const g = new Game([
      added(CLERIC, 'party'),
      added(FAR, 'foes'),
      ...casts(CLERIC),
      { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
      { type: 'landmark-added', name: 'the hall', at: HALL },
      { type: 'creature-placed', id: FAR, placement: { from: { landmark: 'the hall' }, feet: 65, bearing: 0 } },
    ]);
    const out = resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [], at: AT_RANGE, slotLevel: 2 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) {
      expect(out.kind).toBe('needs-context');
      expect(out.requests?.map((r) => r.kind)).toContain('position');
    }
  });
});

// — the attack, measured from the force ————————————————————————————————————————

describe('the attack comes from the force and the roll comes from the caster', () => {
  /**
   * The load-bearing test of the whole batch. `FAR` is 65 feet from the
   * Cleric — beyond the spell's own Range — and 5 feet from the force. A
   * reading that measured the attack from the caster refuses this; the SRD
   * allows it, because the force is what is adjacent.
   */
  it('reaches a creature beside the force that the caster cannot reach', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE, [FAR]);
    expect(ongoingSpellOf(g.state, casting)?.origin).toEqual(AT_RANGE);
    expect(g.hp(FAR)).toBeLessThan(80);
  });

  /** And the other direction: adjacency to the caster buys nothing. */
  it('refuses a creature beside the caster and far from the force', () => {
    const g = new Game();
    const out = resolveSpell(
      g.state,
      CLERIC,
      { spellId: 'spiritual-weapon', targets: [NEAR], at: AT_RANGE, slotLevel: 2 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_range');
  });

  /**
   * SRD: "you **can** immediately make one melee spell attack." The force
   * appears whether or not anybody is standing next to it.
   */
  it('appears with no attack at all when nobody is beside it', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, { x: 200, y: 160, z: 0 });
    expect(g.originOf(casting)).toEqual({ x: 200, y: 160, z: 0 });
    expect(g.hp(NEAR)).toBe(80);
    expect(g.hp(FAR)).toBe(80);
  });

  it('deals Force damage of 1d8 plus the caster’s spellcasting modifier', () => {
    const g = new Game();
    g.conjure(CLERIC, AT_RANGE, [FAR]);
    const dealt = 80 - g.hp(FAR);
    // 1d8 + Wisdom 18 (+4): between 5 and 12, and a critical doubles the die.
    expect(dealt).toBeGreaterThanOrEqual(5);
    expect(dealt).toBeLessThanOrEqual(20);
  });

  it('scales the damage by the slot it was cast with', () => {
    const low = new Game();
    low.conjure(CLERIC, AT_RANGE, [FAR], 'same', 2);
    const high = new Game();
    high.conjure(CLERIC, AT_RANGE, [FAR], 'same', 5);
    expect(80 - high.hp(FAR)).toBeGreaterThan(80 - low.hp(FAR));
  });

  /**
   * Spiritual Weapon's text carries no "that you can see", so a declared
   * *unseen* target is still a legal one. That clause is what Hold Person has
   * and this spell does not, and assuming it from 2014 memory would refuse a
   * legal casting.
   */
  it('does not require sight of the target', () => {
    const g = new Game([...SETUP, { type: 'sight-declared', from: CLERIC, to: FAR, seen: false }]);
    const casting = g.conjure(CLERIC, AT_RANGE, [FAR]);
    expect(ongoingSpellOf(g.state, casting)).not.toBeNull();
    expect(g.hp(FAR)).toBeLessThan(80);
  });
});

// — moving the force ——————————————————————————————————————————————————————————

describe('the caster moves the force, and it is not creature movement', () => {
  it('moves it up to twenty feet from where it is now', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving the force',
    );
    g.push(out.events);
    expect(g.originOf(casting)).toEqual({ x: 200, y: 280, z: 0 });
  });

  it('refuses a move of twenty-five', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = activateSpell(
      g.state,
      CLERIC,
      { castingId: casting, targets: [], to: { x: 200, y: 285, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('origin_too_far');
  });

  /**
   * Measured from the force's **current** point, not from where it started and
   * not from the caster. Two moves of twenty are legal and take it forty feet
   * from where it began; measuring from the first point would refuse the
   * second.
   */
  it('measures each move from where the force is now', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();

    for (const to of [{ x: 200, y: 280, z: 0 }, { x: 200, y: 300, z: 0 }]) {
      const out = unwrap(
        activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to }, supply()),
        `moving to ${to.y}`,
      );
      g.push(out.events);
      g.push([{ type: 'turn-advanced' }, { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    }

    expect(g.originOf(casting)).toEqual({ x: 200, y: 300, z: 0 });
  });

  /** Nor from the caster: the force may be moved further away than it was. */
  it('does not re-check the spell’s own range when the force moves', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving away',
    );
    g.push(out.events);
    // 80 feet from the Cleric, and the spell's Range is 60.
    expect(g.originOf(casting)).toEqual({ x: 200, y: 280, z: 0 });
  });

  /** And the same discrimination on the way out: inside twenty feet, through a wall. */
  it('refuses a move inside its allowance but outside the scene', () => {
    const g = new Game([
      ...CLOSET,
      { type: 'combat-started', combatants: [{ id: CLERIC, initiative: 20, speed: 30 }] },
    ]);
    const casting = g.conjure(CLERIC, { x: 90, y: 50, z: 0 });
    g.push([{ type: 'turn-advanced' }]);

    const out = activateSpell(
      g.state,
      CLERIC,
      { castingId: casting, targets: [], to: { x: 105, y: 50, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('outside_scene');
  });

  /**
   * **No movement rule applies to the force.** It is not the Cleric moving:
   * no Speed is spent, the Cleric stays where they are, nothing is charged for
   * Difficult Terrain, and no Opportunity Attack is provoked by passing
   * through anybody's reach.
   */
  it('spends no Speed and moves no creature', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const before = g.state;

    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving the force',
    );
    g.push(out.events);

    expect(g.state.scene?.positions).toEqual(before.scene?.positions);
    expect(g.state.combat?.budgets[CLERIC]?.movementRemaining).toBe(
      before.combat?.budgets[CLERIC]?.movementRemaining,
    );
    expect(out.events.map((e) => e.type)).not.toContain('movement-spent');
    expect(out.events.map((e) => e.type)).not.toContain('creature-moved');
  });

  /** Nothing is held open waiting for an Opportunity Attack, either. */
  it('provokes nobody', () => {
    // The force starts beside NEAR and is moved straight out of their reach.
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, { x: 205, y: 200, z: 0 });
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 225, y: 200, z: 0 } }, supply()),
      'moving out of reach',
    );
    g.push(out.events);
    expect(g.state.pendingMove).toBeNull();
    expect(out.events.map((e) => e.type)).not.toContain('movement-declared');
  });

  /** And it may share a space with a creature, because it occupies none. */
  it('may be moved onto a creature’s own space', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, { x: 200, y: 220, z: 0 });
    g.laterTurn();
    const onTop = g.state.scene?.positions[NEAR];
    expect(onTop).toBeDefined();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: onTop! }, supply()),
      'moving onto NEAR',
    );
    g.push(out.events);
    expect(g.originOf(casting)).toEqual(onTop);
  });
});

// — the later Bonus Action ————————————————————————————————————————————————————

describe('the later turn is a Bonus Action that moves and strikes', () => {
  it('spends the Bonus Action and attacks from the new point', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    // Placed out of everybody's way, then walked over to FAR.
    const casting = g.conjure(CLERIC, { x: 200, y: 250, z: 0 });
    g.laterTurn();
    const out = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [FAR], to: { x: 200, y: 260, z: 0 } },
        supply('strike'),
      ),
      'moving and striking',
    );
    g.push(out.events);

    expect(out.events.map((e) => e.type)).toContain('bonus-action-spent');
    expect(g.state.combat?.budgets[CLERIC]?.bonusAction).toBe(false);
    expect(g.originOf(casting)).toEqual({ x: 200, y: 260, z: 0 });
    expect(g.hp(FAR)).toBeLessThan(80);
  });

  /**
   * SRD: "As a Bonus Action **on your later turns**." Casting the spell was
   * itself the Bonus Action, so there is none left on the turn it appeared —
   * and the engine says so without the definition having to mention turns,
   * because the action economy already does.
   */
  it('cannot be used again on the turn it was cast', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    const out = activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR] }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_bonus_action');
  });

  /** One move, one event, carrying where it ended up rather than an offset. */
  it('records the move as its own event, once', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving',
    );
    const moves = out.events.filter((e) => e.type === 'spell-origin-moved');
    expect(moves).toEqual([
      { type: 'spell-origin-moved', castingId: casting, to: { x: 200, y: 280, z: 0 } },
    ]);
  });

  /** And an activation that does not move writes none. */
  it('writes no move event when the force stays put', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR] }, supply('strike')),
      'striking',
    );
    expect(out.events.map((e) => e.type)).not.toContain('spell-origin-moved');
  });

  /** The move is optional: "up to 20 feet" includes none of them. */
  it('strikes without moving when no destination is named', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR] }, supply('strike')),
      'striking in place',
    );
    g.push(out.events);
    expect(g.originOf(casting)).toEqual(AT_RANGE);
    expect(g.hp(FAR)).toBeLessThan(80);
  });

  /** The target is checked against where the force ends up, not where it was. */
  it('reads the origin after the move, not before it', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    // Twenty feet short of FAR; the move is what brings it into reach.
    const casting = g.conjure(CLERIC, { x: 200, y: 240, z: 0 });
    g.laterTurn();

    const missed = activateSpell(
      g.state,
      CLERIC,
      { castingId: casting, targets: [FAR] },
      supply('strike'),
    );
    expect(isErr(missed)).toBe(true);
    if (isErr(missed)) expect(missed.code).toBe('out_of_range');

    const out = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [FAR], to: { x: 200, y: 260, z: 0 } },
        supply('strike'),
      ),
      'moving into reach',
    );
    g.push(out.events);
    expect(g.hp(FAR)).toBeLessThan(80);
  });

  it('uses the caster’s own spell attack modifier and level-pinned dice', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE, [], 'weapon', 5);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR] }, supply('strike')),
      'striking',
    );
    g.push(out.events);
    // Cast at level 5: 1d8 + 3d8 + 4, so at least 8 even on the worst roll.
    expect(80 - g.hp(FAR)).toBeGreaterThanOrEqual(8);
  });

  it('refuses another creature acting through the casting', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = activateSpell(
      g.state,
      RIVAL,
      { castingId: casting, targets: [], to: { x: 200, y: 265, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_your_spell');
  });

  it('refuses a casting that has ended', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    g.push(unwrap(endConcentration(g.state, CLERIC, 'voluntary'), 'dropping it'));

    const out = activateSpell(
      g.state,
      CLERIC,
      { castingId: casting, targets: [], to: { x: 200, y: 265, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_ongoing');
  });

  it('refuses a destination for a casting that has no origin to move', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const out = unwrap(
      resolveSpell(g.state, CLERIC, { spellId: 'bless', targets: [NEAR], slotLevel: 1 }, supply()),
      'bless',
    );
    g.push(out.events);

    const moved = activateSpell(
      g.state,
      CLERIC,
      { castingId: out.castingId, targets: [], to: AT_RANGE },
      supply(),
    );
    expect(isErr(moved)).toBe(true);
  });
});

// — two castings, kept apart ——————————————————————————————————————————————————

describe('two forces are two points', () => {
  it('keeps two casters’ weapons apart', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const mine = g.conjure(CLERIC, AT_RANGE, [], 'mine');
    const theirs = g.conjure(RIVAL, { x: 200, y: 240, z: 0 }, [], 'theirs');

    expect(mine).not.toBe(theirs);
    g.laterTurn();

    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: mine, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving mine',
    );
    g.push(out.events);

    expect(g.originOf(mine)).toEqual({ x: 200, y: 280, z: 0 });
    expect(g.originOf(theirs)).toEqual({ x: 200, y: 240, z: 0 });
  });

  /**
   * One caster cannot hold two Spiritual Weapons — it takes Concentration —
   * so the discriminating case is a casting *with* an origin beside one
   * without. Moving the first must leave the second exactly as it was.
   */
  it('leaves a caster’s other ongoing spell untouched', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const hand = unwrap(
      resolveSpell(g.state, CLERIC, { spellId: 'mage-hand', targets: [] }, supply('hand')),
      'mage hand',
    );
    g.push(hand.events);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();

    expect(ongoingSpellsBy(g.state, CLERIC).map((o) => o.castingId).sort()).toEqual(
      [hand.castingId, casting].sort(),
    );

    const before = ongoingSpellOf(g.state, hand.castingId);
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 } }, supply()),
      'moving the force',
    );
    g.push(out.events);

    expect(ongoingSpellOf(g.state, hand.castingId)).toEqual(before);
  });
});

// — cleanup —————————————————————————————————————————————————————————————————

describe('the point goes when the casting does', () => {
  it('goes when Concentration is dropped', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push(unwrap(endConcentration(g.state, CLERIC, 'voluntary'), 'dropping it'));
    expect(ongoingSpellOf(g.state, casting)).toBeNull();
    expect(g.state.ongoing).toEqual({});
  });

  it('goes when the minute runs out', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push([{ type: 'time-advanced', seconds: 61, reason: 'searching the vault' }]);
    expect(ongoingSpellOf(g.state, casting)).toBeNull();
    expect(g.state.timers).toEqual({});
  });

  it('goes when the caster leaves the game', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push(unwrap(removeCreatureEverywhere(g.state, CLERIC), 'removing the Cleric'));
    expect(ongoingSpellOf(g.state, casting)).toBeNull();
  });

  it('goes when the spell is dispelled', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push([{ type: 'spell-ended', castingId: casting, on: null, reason: 'dispelled' }]);
    expect(ongoingSpellOf(g.state, casting)).toBeNull();
  });

  /**
   * SRD ends Concentration when the caster "has the Incapacitated condition or
   * you die", and the force is what that ends. Derived, so no event says it.
   */
  it('goes when the caster is Incapacitated', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push([
      { type: 'condition-applied', id: CLERIC, condition: 'stunned', source: 'a blow' },
    ]);
    expect(ongoingSpellOf(g.state, casting)).toBeNull();
  });

  /**
   * **A new scene leaves the point where it was, and this is a debt with a
   * name rather than an accident.** `scene-set` unplaces every creature, and
   * nothing can re-place a force: the only command that moves one moves it
   * twenty feet. Dropping the point instead would be worse — a Spiritual
   * Weapon with no point is a spell whose every reach check silently stops
   * happening — so the coordinate stands and the reach comes back *unverified*,
   * which is the engine's three-valued answer for a fact nobody has restated.
   *
   * The real fix is the doctrine's own multiple-scenes seam.
   */
  it('keeps the point across a new scene, and says the reach went unchecked', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    g.push([{ type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } }]);

    expect(g.originOf(casting)).toEqual(AT_RANGE);

    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR] }, supply('strike')),
      'striking into a scene nobody has been placed in',
    );
    expect(out.unverified.join(' ')).toContain('went unchecked');
  });

  it('leaves no orphaned coordinate anywhere in state', () => {
    const g = new Game();
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.push(unwrap(endConcentration(g.state, CLERIC, 'voluntary'), 'dropping it'));

    const serialised = JSON.stringify(g.state);
    expect(serialised).not.toContain(casting);
    expect(g.state.ongoing).toEqual({});
  });

  it('refuses to move a force whose minute has run out', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    g.push([{ type: 'time-advanced', seconds: 61, reason: 'the fight moved on' }]);

    const out = activateSpell(
      g.state,
      CLERIC,
      { castingId: casting, targets: [], to: { x: 200, y: 265, z: 0 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_ongoing');
  });
});

// — replay ————————————————————————————————————————————————————————————————————

describe('replay reconstructs the point, however it got there', () => {
  it('rebuilds the final origin after several moves', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();

    for (const to of [
      { x: 200, y: 280, z: 0 },
      { x: 200, y: 300, z: 0 },
      { x: 220, y: 300, z: 0 },
    ]) {
      const out = unwrap(
        activateSpell(g.state, CLERIC, { castingId: casting, targets: [], to }, supply()),
        `moving to ${to.x},${to.y}`,
      );
      g.push(out.events);
      g.push([{ type: 'turn-advanced' }, { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    }

    expect(g.originOf(casting)).toEqual({ x: 220, y: 300, z: 0 });
    // And the same log, serialised and read back, folds to the same point.
    expect(ongoingSpellOf(roundTrip(g.log), casting)?.origin).toEqual({ x: 220, y: 300, z: 0 });
    expect(roundTrip(g.log)).toEqual(g.state);
  });

  it('folds at every prefix of the log', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const out = unwrap(
      activateSpell(g.state, CLERIC, { castingId: casting, targets: [FAR], to: { x: 200, y: 265, z: 0 } }, supply()),
      'moving and striking',
    );
    g.push(out.events);
    g.foldsAtEveryPrefix();
  });

  /** A log that moves a casting nobody started is corrupt, and says so. */
  it('refuses a move of a casting that is not running', () => {
    expect(() =>
      fold('seed', [...SETUP, { type: 'spell-origin-moved', castingId: 'cast:9', to: AT_RANGE }]),
    ).toThrow();
  });

  /** So is one that moves a casting which never had a point. */
  it('refuses a move of a casting with no origin', () => {
    const g = new Game();
    const out = unwrap(
      resolveSpell(g.state, CLERIC, { spellId: 'bless', targets: [NEAR], slotLevel: 1 }, supply()),
      'bless',
    );
    g.push(out.events);
    expect(() =>
      fold('seed', [...g.log, { type: 'spell-origin-moved', castingId: out.castingId, to: AT_RANGE }]),
    ).toThrow();
  });
});

// — retries ———————————————————————————————————————————————————————————————————

describe('a retry changes nothing the first run did not', () => {
  it('does not create a second force', () => {
    const g = new Game();
    const first = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'spiritual-weapon', targets: [], at: AT_RANGE, slotLevel: 2, commandId: 'c1' },
        supply(),
      ),
      'casting',
    );
    g.push(first.events);
    const after = g.state;

    const retry = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'spiritual-weapon', targets: [], at: AT_RANGE, slotLevel: 2, commandId: 'c1' },
        supply(),
      ),
      'retrying',
    );
    expect(retry.events).toEqual([]);
    expect(retry.castingId).toBe(first.castingId);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(Object.keys(after.ongoing)).toHaveLength(1);
  });

  it('does not move the force twice', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const first = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 }, commandId: 'm1' },
        supply(),
      ),
      'moving',
    );
    g.push(first.events);
    const after = g.state;

    const retry = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [], to: { x: 200, y: 280, z: 0 }, commandId: 'm1' },
        supply(),
      ),
      'retrying the move',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(g.originOf(casting)).toEqual({ x: 200, y: 280, z: 0 });
  });

  it('does not attack twice', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    g.laterTurn();
    const first = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [FAR], commandId: 'a1' },
        supply('strike'),
      ),
      'striking',
    );
    g.push(first.events);
    const hurt = g.hp(FAR);

    const retry = unwrap(
      activateSpell(
        g.state,
        CLERIC,
        { castingId: casting, targets: [FAR], commandId: 'a1' },
        supply('strike'),
      ),
      'retrying the strike',
    );
    expect(retry.events).toEqual([]);
    expect(g.hp(FAR)).toBe(hurt);
  });
});

// — the shape a definition has to be written in ———————————————————————————————

describe('a definition says where its reach is measured from, once', () => {
  /**
   * Two fields could both say "five feet" and only one of them would be read.
   * A definition that holds a point measures from the point; every other
   * activation measures from the caster. Writing both is the shape of a rules
   * fix landing in the half nobody reads.
   */
  it('carries an origin’s reach or an activation’s range, never both', () => {
    const both = SPELL_DEFINITIONS.filter(
      (d) => d.origin !== undefined && d.activation?.range !== undefined,
    );
    expect(both.map((d) => d.id)).toEqual([]);
  });

  it('gives every activation without an origin a range of its own', () => {
    const missing = SPELL_DEFINITIONS.filter(
      (d) => d.activation !== undefined && d.origin === undefined && d.activation.range === undefined,
    );
    expect(missing.map((d) => d.id)).toEqual([]);
  });

  /** And a point that can be steered needs an activation to steer it in. */
  it('gives every movable origin an activation', () => {
    const orphaned = SPELL_DEFINITIONS.filter(
      (d) => d.origin?.movableBy !== undefined && d.activation === undefined,
    );
    expect(orphaned.map((d) => d.id)).toEqual([]);
  });

  /** The shortlist bounds a target by both numbers, not by the spell's Range. */
  it('shortlists a creature the force could reach but the caster cannot', () => {
    const shortlist = eligibleTargets(new Game().state, CLERIC, 'spiritual-weapon', 2);
    expect(shortlist.eligible).toContain(FAR);
  });
});

// — a casting held open, and a casting readied ————————————————————————————————

describe('a declared casting keeps the space it was declared with', () => {
  /**
   * SRD Counterspell answers "a creature in the process of casting a spell",
   * and settlement takes no fresh request: the space chosen at declaration is
   * the space the force appears in. A settlement that re-read the caller would
   * let a force declared beside the goblins appear beside the party.
   */
  it('settles at the declared space, not one the settlement could choose', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const declared = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'spiritual-weapon', targets: [FAR], at: AT_RANGE, slotLevel: 2, hold: true },
        supply(),
      ),
      'declaring',
    );
    g.push(declared.events);
    expect(g.state.pendingCasting?.origin).toEqual(AT_RANGE);
    // No record yet: the slot is unspent and the spell has not happened.
    expect(ongoingSpellOf(g.state, declared.castingId)).toBeNull();

    const settled = unwrap(resolveDeclaredCast(g.state, supply('settle')), 'settling');
    g.push(settled.events);

    expect(g.originOf(declared.castingId)).toEqual(AT_RANGE);
    expect(g.hp(FAR)).toBeLessThan(80);
  });

  it('does not settle twice on a retry', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const declared = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'spiritual-weapon', targets: [FAR], at: AT_RANGE, slotLevel: 2, hold: true },
        supply(),
      ),
      'declaring',
    );
    g.push(declared.events);
    g.push(unwrap(resolveDeclaredCast(g.state, supply('settle'), { commandId: 's1' }), 'settling').events);
    const after = g.state;
    const hurt = g.hp(FAR);

    const retry = unwrap(resolveDeclaredCast(g.state, supply('settle'), { commandId: 's1' }), 'retrying');
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(after);
    expect(g.hp(FAR)).toBe(hurt);
  });

  /**
   * And a countered declaration leaves no point behind, because the force
   * never appeared: "the spell dissipates with no effect."
   */
  it('leaves nothing standing when the casting is interrupted', () => {
    const g = new Game([...SETUP, ...FIGHT]);
    const declared = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'spiritual-weapon', targets: [FAR], at: AT_RANGE, slotLevel: 2, hold: true },
        supply(),
      ),
      'declaring',
    );
    g.push(declared.events);
    g.push([
      {
        type: 'spell-interrupted',
        castingId: declared.castingId,
        id: CLERIC,
        by: RIVAL,
        reason: 'countered',
      },
    ]);

    expect(g.state.pendingCasting).toBeNull();
    expect(g.state.ongoing).toEqual({});
    expect(g.hp(FAR)).toBe(80);
  });
});

// — the debts that stop it ————————————————————————————————————————————————————

describe('an activation waits on the same debts a casting does', () => {
  it('refuses while a turn-boundary save is outstanding', () => {
    const g = new Game([
      ...SETUP,
      { type: 'sight-declared', from: CLERIC, to: NEAR, seen: true },
      ...FIGHT,
    ]);
    const casting = g.conjure(CLERIC, AT_RANGE);
    // SRD: one spell slot a turn, so Hold Person waits for the next one.
    g.laterTurn();

    const held = unwrap(
      resolveSpell(
        g.state,
        CLERIC,
        { spellId: 'hold-person', targets: [NEAR], slotLevel: 2 },
        supply('hold'),
      ),
      'hold person',
    );
    g.push(held.events);

    // Round on until NEAR's turn ends and the boundary raises the repeat save
    // that nobody has rolled.
    for (let turn = 0; turn < 4 && Object.keys(g.state.pendingSaves).length === 0; turn += 1) {
      g.push([{ type: 'turn-advanced' }]);
    }
    expect(Object.keys(g.state.pendingSaves).length).toBeGreaterThan(0);

    const out = activateSpell(g.state, CLERIC, { castingId: casting, targets: [] }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('saves_pending');
  });
});
