/**
 * A saving throw whose failure buys a fact the table reads, and nothing else.
 *
 * SRD Zone of Truth: "a creature that enters the spell's area for the first
 * time on a turn or starts its turn there makes a Charisma saving throw. On a
 * failed save, a creature can't speak a deliberate lie while in the radius.
 * **You know whether a creature succeeds or fails on this save.**"
 *
 * Every piece of that but the last sentence has existed since Web: the two
 * moments are `AreaTrigger.at` and `AreaTrigger.onEntry`, the Sphere is an
 * area, and the save is an ordinary `save` effect. What the spell had nowhere
 * to put was its *outcome*. Not being able to speak a deliberate lie is not a
 * condition and is not any other state the engine holds, so the failure
 * imposed nothing, and `checkSpellDefinition` refused the definition outright
 * — `save_imposes_nothing`, "a die thrown for nothing".
 *
 * The gate's ruling is what lifts it: **the engine may hold a fact only the
 * table reads, when the fact is the recorded outcome of a roll the engine
 * made and a door publishes it.** So `recordsOutcome` is the third thing a
 * save may do besides impose a condition and hang a rider, the verdict is
 * written onto the casting by an event of its own, and `observe()` publishes
 * it. The engine still does not know what a lie is.
 *
 * **Why the record and not the creature.** A creature that walks out of the
 * Sphere and back in saves again, and the answer is per *casting* — two Zones
 * over one room are two questions about the same creature. `aimed` could not
 * carry it: it is written once at the cast and only ever shrinks, and
 * `aimedAt` returns nothing at all for an area, because standing in an area is
 * not being cast on.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { moveCreature, type Point } from './positioning.js';
import {
  ongoingSpellOf,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const LIAR = id('liar');
const HONEST = id('honest');

const sheet = (cha: number): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId, cha: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(cha),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['zone-of-truth'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/**
 * A penalty large enough that every save fails, or a bonus large enough that
 * every save is made. What is under test is the *record*, never the die.
 */
const supply = (seed = 'zone', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

/** The zone is 40 feet from the caster, inside the spell's 60 feet of range. */
const HALL: Point = { x: 200, y: 200, z: 0 };
const ZONE: Point = { x: 240, y: 200, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });
const place = (who: CharacterId, name: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark: name }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CASTER, 10),
  added(LIAR, 10),
  added(HONEST, 10),
  ...casts(CASTER),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  spot('the hall', HALL),
  // Ten feet from the centre of a 15-foot radius, so squarely inside it.
  spot('in the zone', { x: 250, y: 200, z: 0 }),
  // Thirty feet from it, so squarely outside.
  spot('outside', { x: 270, y: 200, z: 0 }),
  spot('also outside', { x: 275, y: 205, z: 0 }),
  place(CASTER, 'the hall'),
  place(LIAR, 'outside'),
  place(HONEST, 'also outside'),
];

const FIGHT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 30, speed: 30 },
      { id: LIAR, initiative: 20, speed: 400 },
      { id: HONEST, initiative: 10, speed: 400 },
    ],
  },
];

const straightRoute = (from: Point, to: Point): readonly Point[] => {
  const step = (a: number, b: number) => (a === b ? a : a < b ? a + 5 : a - 5);
  const spaces: Point[] = [];
  let at = from;
  while (at.x !== to.x || at.y !== to.y || at.z !== to.z) {
    at = { x: step(at.x, to.x), y: step(at.y, to.y), z: step(at.z, to.z) };
    spaces.push(at);
  }
  return spaces;
};

class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  conjure(seed = 'zone'): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        CASTER,
        { spellId: 'zone-of-truth', targets: [], at: ZONE },
        supply(seed),
      ),
      'casting Zone of Truth',
    );
    this.push(out.events);
    return out.castingId!;
  }

  private fight(): void {
    if (this.state.combat === null) this.push(FIGHT);
  }

  to(who: CharacterId): this {
    this.fight();
    for (let n = 0; n < 12; n += 1) {
      const combat = this.state.combat;
      if (combat === null) return this;
      if (combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(`to-${who}-${n}`);
    }
    throw new Error(`never reached ${who}'s turn`);
  }

  /**
   * Walk a creature to a named spot on its own turn, and settle what the walk
   * made the zone owe.
   *
   * The entry raises the debt in the fold and `settleAreaEffects` is what
   * rolls it, which is where `flat` goes: a large penalty makes the save fail
   * and a large bonus makes it succeed, and what is under test is the record
   * rather than the die.
   */
  walk(who: CharacterId, to: string, flat = -40): void {
    this.to(who);
    const scene = this.state.scene!;
    const from = scene.positions[who]!;
    const placement = { from: { landmark: to }, feet: 0 } as const;
    const at = unwrap(moveCreature(scene, who, placement), `${who} reaching ${to}`).state
      .positions[who]!;
    const out = unwrap(
      resolveMove(this.state, who, { placement, route: straightRoute(from, at) }, supply('move')),
      `${who} walking to ${to}`,
    );
    this.push(out.events);
    this.settle(`settle-${who}`, flat);
  }

  settle(seed = 'settle', flat = -40): readonly GameEvent[] {
    const out = unwrap(
      settleAreaEffects(this.state, supply(seed, flat), {}),
      'settling area effects',
    );
    this.push(out.events);
    return out.events;
  }

  turn(seed = 'turn', flat = -40): readonly GameEvent[] {
    this.fight();
    const out = unwrap(resolveTurn(this.state, supply(seed, flat)), 'advancing the turn');
    this.push(out.events);
    return out.events;
  }

  /** What the casting has written down about who it has asked. */
  saves(castingId: string): readonly { readonly who: string; readonly failed: boolean }[] {
    return ongoingSpellOf(this.state, castingId)?.saves ?? [];
  }

  conditionsOn(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }
}

describe('Zone of Truth is a definition again', () => {
  it('is in the book, with the Sphere and the two moments the sentence names', () => {
    const definition = SRD_CONTENT.spell('zone-of-truth');
    expect(definition).not.toBeNull();
    expect(definition!.area).toEqual({ kind: 'sphere', radius: 15, origin: 'point' });
    expect(definition!.areaTrigger?.at).toBe('start-of-turn');
    expect(definition!.areaTrigger?.onEntry).toBe('first-per-turn');

    // The save is the book's, and it imposes nothing: the whole of what a
    // failure buys is the fact being written down.
    const effects = definition!.areaTrigger!.effects;
    expect(effects).toHaveLength(1);
    expect(effects[0]!.kind).toBe('save');
    const save = effects[0] as { ability: string; condition?: string; recordsOutcome?: true };
    expect(save.ability).toBe('cha');
    expect(save.condition).toBeUndefined();
    expect(save.recordsOutcome).toBe(true);
  });

  it('no longer says the save is unrolled', () => {
    const notes = SRD_CONTENT.spell('zone-of-truth')!.unmodelled ?? [];
    expect(notes.join(' ')).not.toContain('the Charisma saving throw is not rolled');
  });
});

describe('the casting writes down who it has asked', () => {
  it('records a failure when a creature walks into the zone', () => {
    const game = new Game();
    const castingId = game.conjure();
    expect(game.saves(castingId)).toEqual([]);
    game.walk(LIAR, 'in the zone');

    expect(game.saves(castingId)).toEqual([{ who: String(LIAR), failed: true }]);
  });

  it('records a success the same way, because the caster knows either answer', () => {
    // "You know whether a creature succeeds **or fails**" — a record that held
    // only the failures would answer "has this creature been asked yet" with
    // silence, and the sentence says the caster knows.
    const game = new Game();
    const castingId = game.conjure();
    // The bonus the other way, so the save is made.
    game.walk(LIAR, 'in the zone', 40);

    expect(game.saves(castingId)).toEqual([{ who: String(LIAR), failed: false }]);
  });

  it('imposes nothing at all on a creature that failed', () => {
    const game = new Game();
    game.conjure();
    game.walk(LIAR, 'in the zone');

    // The engine holds no speech, and a definition that invented a condition
    // here would be printing a rule the book does not.
    expect(game.conditionsOn(LIAR)).toEqual([]);
  });

  it('keeps one answer per creature, replaced when the zone asks again', () => {
    const game = new Game();
    const castingId = game.conjure();
    game.walk(LIAR, 'in the zone');
    expect(game.saves(castingId)).toEqual([{ who: String(LIAR), failed: true }]);

    // Round the order back to this creature: it starts its turn in the zone,
    // which is the sentence's other moment, and saves again.
    game.turn('again');
    game.turn('again-2');
    game.turn('again-3', 40);

    const after = game.saves(castingId);
    expect(after.filter((one) => one.who === String(LIAR))).toHaveLength(1);
  });

  it('answers per creature, sorted, so two in the zone are two entries', () => {
    const game = new Game();
    const castingId = game.conjure();
    game.walk(LIAR, 'in the zone');
    game.walk(HONEST, 'in the zone');

    const saves = game.saves(castingId);
    expect(saves.map((one) => one.who)).toEqual([String(HONEST), String(LIAR)]);
  });

  it('is written by an event, so a refold of the log says the same thing', () => {
    const game = new Game();
    const castingId = game.conjure();
    game.walk(LIAR, 'in the zone');

    const recorded = game.state;
    expect(ongoingSpellOf(recorded, castingId)!.saves).toEqual([
      { who: String(LIAR), failed: true },
    ]);
  });
});
