import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { CreatureSize } from '@ie/srd';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveAttack, resolveMove, resolveSpell } from './commands.js';

/**
 * SRD Wind Wall's three sentences about the wall itself, and the two shapes
 * they need: a **barrier** on the one template the caster draws, and a
 * **deflection** of the ordinary projectiles that cross it.
 *
 * > "Small or smaller flying creatures or objects can't pass through the wall.
 * > … Arrows, bolts, and other ordinary projectiles launched at targets behind
 * > the wall are deflected upward and miss automatically. Boulders hurled by
 * > Giants or siege engines, and similar projectiles, are unaffected. Creatures
 * > in gaseous form can't pass through it."
 *
 * The wall's path was drawn at the cast and, until this, nothing about the
 * casting kept it: the record pins the path now (`OngoingSpell.path`), so the
 * two clauses have a shape to be read against. A deflected arrow is still a
 * die thrown and recorded — as an automatic success on a save is — and the
 * outcome on the roll says why it missed. A creature in gaseous form is read
 * off the mark SRD Gaseous Form leaves: a granted Fly Speed that **replaces**
 * every other Speed and hovers.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const SPRITE = id('sprite');
const OWL = id('owl');
const MIST = id('mist');

const sheet = (flies: boolean): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...(flies ? { speeds: { fly: 40 } } : {}),
});

const added = (
  who: CharacterId,
  side: string,
  size: CreatureSize,
  flies = false,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(flies),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  size,
});

/** The wall runs east–west along y = 215, ten spaces long: 175 to 220. */
const WALL_PATH = Array.from({ length: 10 }, (_, i) => ({ x: 175 + i * 5, y: 215, z: 0 }));

const LANDMARKS = {
  'the druid’s rock': { x: 190, y: 200, z: 0 },
  'the fighter’s post': { x: 200, y: 200, z: 0 },
  'the goblin’s ridge': { x: 200, y: 230, z: 0 },
  'north of the wall': { x: 210, y: 225, z: 0 },
  'south of the wall': { x: 210, y: 205, z: 0 },
  'the wall’s north face': { x: 200, y: 220, z: 0 },
  'the wall’s south face': { x: 200, y: 210, z: 0 },
} as const;

const FIELD: readonly GameEvent[] = [
  added(DRUID, 'party', 'medium'),
  added(FIGHTER, 'party', 'medium'),
  added(GOBLIN, 'foes', 'small'),
  added(SPRITE, 'foes', 'small', true),
  added(OWL, 'foes', 'medium', true),
  added(MIST, 'foes', 'medium'),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: ['wind-wall'] }),
  },
  {
    type: 'spellcasting-declared',
    id: GOBLIN,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', cantrips: ['fire-bolt'] }),
  },
  ...[1, 2, 3].map((level): GameEvent => ({
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  })),
  { type: 'items-gained', id: GOBLIN, items: [{ id: 'shortbow', quantity: 1 }], source: 'kit' },
  { type: 'item-equipped', id: GOBLIN, item: 'shortbow', armor: null },
  // SRD Gaseous Form's mark, as the odds-and-ends track writes it: "the
  // target's only method of movement is a Fly Speed of 10 feet, and it can
  // hover" — a granted Fly Speed that replaces every other and hovers.
  {
    type: 'speed-modifier-granted',
    id: MIST,
    modifier: {
      source: 'Gaseous Form#cast:9',
      change: 'add',
      feet: 10,
      mode: 'fly',
      hover: true,
      replaces: true,
    },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  ...Object.entries(LANDMARKS).map(
    ([name, at]): GameEvent => ({ type: 'landmark-added', name, at }),
  ),
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the druid’s rock' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { landmark: 'the fighter’s post' }, feet: 0 },
  },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { landmark: 'the goblin’s ridge' }, feet: 0 },
  },
  // A size is a fact about the scene, declared where the creature is placed —
  // `placeCreature` defaults it to Medium, which is what the owl is.
  {
    type: 'creature-placed',
    id: SPRITE,
    placement: { from: { landmark: 'north of the wall' }, feet: 0, size: 'small' },
  },
  { type: 'creature-placed', id: OWL, placement: { from: { landmark: 'north of the wall' }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: MIST, placement: { from: { landmark: 'the wall’s north face' }, feet: 0 } },
  { type: 'sight-declared', from: GOBLIN, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: FIGHTER, to: GOBLIN, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('wind') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

class Game {
  readonly events: GameEvent[] = [...FIELD];
  castingId = '';

  get state(): GameState {
    return fold('wind', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  raiseTheWall(): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        DRUID,
        { spellId: 'wind-wall', targets: [], path: WALL_PATH },
        supply(this.state),
      ),
      'wind wall',
    );
    this.push(out.events);
    this.castingId = out.castingId!;
    return this;
  }

  fly(who: CharacterId, to: keyof typeof LANDMARKS) {
    return resolveMove(
      this.state,
      who,
      { placement: { from: { landmark: to }, feet: 0 }, mode: 'fly' },
      supply(this.state),
    );
  }

  shoot() {
    return unwrap(
      resolveAttack(this.state, GOBLIN, { target: FIGHTER, weapon: 'shortbow' }, supply(this.state)),
      'the goblin shoots',
    );
  }
}

describe('SRD Wind Wall: the definition and the record', () => {
  it('validates, and pins the path the caster drew so the wall can be asked about again', () => {
    const wall = SRD_CONTENT.spell('wind-wall')!;
    expect(checkSpellDefinitionValue(wall)).toEqual([]);
    expect(wall.areaStanding?.map((clause) => clause.kind).sort()).toEqual([
      'bars-passage',
      'bars-passage',
      'deflects-projectiles',
    ]);
    const game = new Game().raiseTheWall();
    expect(game.state.ongoing[game.castingId]?.path).toEqual(WALL_PATH);
  });
});

describe('SRD Wind Wall: "ordinary projectiles … are deflected upward and miss automatically"', () => {
  it('misses the goblin’s arrow automatically, with the die still on the record', () => {
    const game = new Game().raiseTheWall();
    const shot = game.shoot();
    expect(shot.attack?.hit).toBe(false);
    expect(shot.attack?.autoMissed).toContain('Wind Wall');
    const roll = shot.events.find((e) => e.type === 'roll-recorded');
    expect(roll).toBeDefined();
    if (roll?.type === 'roll-recorded') {
      expect(roll.natural).toBeGreaterThanOrEqual(1);
      expect(roll.natural).toBeLessThanOrEqual(20);
      expect(roll.outcome).toBe('miss');
      expect(roll.label).toContain('deflected');
    }
  });

  it('hits or misses an arrow on the die when no wall stands between', () => {
    const game = new Game();
    const shot = game.shoot();
    expect(shot.attack?.autoMissed ?? null).toBeNull();
  });

  it('leaves a Fire Bolt through the wall to its own roll', () => {
    const game = new Game().raiseTheWall();
    const bolt = unwrap(
      resolveSpell(game.state, GOBLIN, { spellId: 'fire-bolt', targets: [FIGHTER] }, supply(game.state)),
      'fire bolt',
    );
    expect(bolt.outcomes[0]?.attack).toBeDefined();
    expect(bolt.outcomes[0]?.attack?.autoMissed ?? null).toBeNull();
  });
});

describe('SRD Wind Wall: "Small or smaller flying creatures … can’t pass through the wall"', () => {
  it('refuses the Small flier the crossing and lets the Medium one through', () => {
    const game = new Game().raiseTheWall();
    expect(codeOf(game.fly(SPRITE, 'south of the wall'))).toBe('barred');
    expect(game.fly(OWL, 'south of the wall').ok).toBe(true);
  });

  it('lets the Small flier cross where the wall is not', () => {
    const game = new Game();
    expect(game.fly(SPRITE, 'south of the wall').ok).toBe(true);
  });
});

describe('SRD Wind Wall: "Creatures in gaseous form can’t pass through it"', () => {
  it('refuses the misty creature a space in the wall', () => {
    const game = new Game().raiseTheWall();
    expect(codeOf(game.fly(MIST, 'the wall’s south face'))).toBe('barred');
  });
});
