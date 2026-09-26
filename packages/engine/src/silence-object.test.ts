import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import type { Point } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import { defensesOf } from './standing.js';
import { declareObject, resolveSpell } from './commands.js';

/**
 * SRD Silence: "Any creature **or object** entirely inside the Sphere has
 * Immunity to Thunder damage."
 *
 * **A reading rather than a mechanism.** The definition filed the object half
 * as blocked — "a declared object has no position on the lattice for the Sphere
 * to catch it by" — and that note predates placeable objects: `declareObject`
 * emits a `creature-added` with `creatureType: 'Object'` and a size, and
 * `creature-placed` puts it on the lattice exactly as it puts a monster there.
 * `defensesOf` reads an `areaStanding` `damage-defense` off
 * `creaturesStandingInCastingArea`, which asks the lattice and not the creature
 * type, so a placed door inside the Sphere should already take the Immunity.
 *
 * This file is the evidence. Two oak doors, one wholly inside the Sphere and
 * one thirty feet from its centre; a Shatter thrown at the pair from outside.
 * The door inside takes nothing and the door outside is damaged.
 */

const id = (s: string) => asCharacterId(s);
const PRIEST = id('priest');
const BOOMER = id('boomer');
const DOOR_IN = id('the inner door');
const DOOR_OUT = id('the outer door');

const sheet = (): CharacterSheet => ({
  level: 9,
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

const caster = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/** The Sphere is 20 feet of radius around this point. */
const SILENCE_AT: Point = { x: 500, y: 500, z: 0 };
/** Twenty feet from the centre, so a Medium door is wholly inside. */
const DOOR_IN_AT: Point = { x: 520, y: 500, z: 0 };
/** Thirty feet out, and clear of the Sphere altogether. */
const DOOR_OUT_AT: Point = { x: 530, y: 500, z: 0 };
/** Between them: a ten-foot-radius Shatter centred here catches both doors. */
const SHATTER_AT: Point = { x: 525, y: 500, z: 0 };
const PRIEST_AT: Point = { x: 470, y: 500, z: 0 };
const BOOMER_AT: Point = { x: 560, y: 500, z: 0 };

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Room {
  readonly events: GameEvent[] = [
    ...caster(PRIEST, ['silence']),
    ...caster(BOOMER, ['shatter']),
    { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
    place(PRIEST, PRIEST_AT),
    place(BOOMER, BOOMER_AT),
  ];

  constructor() {
    // The doors: declared as the fiction they are — an oak door, Medium and
    // resilient — and then placed, which is a second command for an object
    // exactly as it is for a monster.
    for (const [door, at] of [
      [DOOR_IN, DOOR_IN_AT],
      [DOOR_OUT, DOOR_OUT_AT],
    ] as const) {
      this.push(
        unwrap(
          declareObject(this.state, SRD_CONTENT, door, {
            name: String(door),
            material: 'wood',
            size: 'medium',
            build: 'resilient',
          }),
          `declare ${door}`,
        ),
      );
      this.push([place(door, at)]);
    }
  }

  get state(): GameState {
    return fold('silence', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  hp(who: CharacterId): number {
    return this.state.creatures[who]!.vitals.hp;
  }

  silence(): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        PRIEST,
        { spellId: 'silence', targets: [], at: SILENCE_AT },
        supply(this.state, 'silence'),
      ),
      'silence',
    );
    return this.push(out.events);
  }

  shatter(): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        BOOMER,
        { spellId: 'shatter', targets: [], at: SHATTER_AT, slotLevel: 2 },
        supply(this.state, 'shatter'),
      ),
      'shatter',
    );
    return this.push(out.events);
  }
}

describe('SRD Silence: an object entirely inside the Sphere', () => {
  it('gives a placed door Immunity to Thunder damage and the door outside none', () => {
    const room = new Room().silence();

    expect(defensesOf(room.state, DOOR_IN)['thunder']).toEqual({ immune: true });
    expect(defensesOf(room.state, DOOR_OUT)['thunder']).toBeUndefined();
  });

  it('turns a Shatter aside from the door inside and lets it break the one outside', () => {
    const room = new Room().silence();
    const inside = room.hp(DOOR_IN);
    const outside = room.hp(DOOR_OUT);

    room.shatter();

    expect(room.hp(DOOR_IN)).toBe(inside);
    expect(room.hp(DOOR_OUT)).toBeLessThan(outside);
  });

  it('breaks both doors when nobody has silenced the room', () => {
    const room = new Room().shatter();

    expect(room.hp(DOOR_IN)).toBeLessThan(400);
    expect(room.hp(DOOR_OUT)).toBeLessThan(400);
  });
});
