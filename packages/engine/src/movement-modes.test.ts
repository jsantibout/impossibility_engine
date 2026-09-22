import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  type CharacterSheet,
  highJumpHeight,
  longJumpDistance,
  speedInMode,
} from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { adaptMonster } from './monster.js';
import { areaPointAt, positionOf, type Point, type TerrainRegion } from './positioning.js';
import { speedOf } from './standing.js';
import { addCreature, declareDifficultTerrain, resolveFall, resolveMove } from './commands.js';

/**
 * The four Speeds beside walking, what a move in one costs, and the two jumps.
 *
 * SRD prints five Speeds and the engine held one. What is here is the whole of
 * the glossary's movement section that is not already built:
 *
 * | | |
 * |---|---|
 * | Fly, Climb, Swim and Burrow Speeds | on the sheet, and off a stat block's printed line |
 * | a move names its mode | `MoveCommand.mode` |
 * | climbing or swimming without the Speed | every foot costs one extra, and Difficult Terrain stacks |
 * | a flier knocked Prone or stopped | falls, unless it hovers |
 * | the Long Jump and the High Jump | the distance, and the movement each foot spends |
 */

const id = (s: string) => asCharacterId(s);
const WALKER = id('walker');
const SEED = 'modes';

/** Strength 16: a Long Jump of 16 feet and a High Jump of 6. */
const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  // Sixty, so a move can cost double and still be affordable — these tests are
  // about what a mode charges, not about what a Medium humanoid can do.
  baseSpeed: 60,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
});

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 200 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
];

const ALONE: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WALKER,
    name: 'walker',
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  ...SCENE,
  { type: 'creature-placed', id: WALKER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'combat-started', combatants: [{ id: WALKER, initiative: 20, speed: 60 }] },
];

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A stat block in the game, placed where the caller says and given the turn. */
const withMonster = (
  who: string,
  monsterId: string,
  at: { feet: number; bearing?: number; elevation?: number },
  speed: number,
): readonly GameEvent[] => {
  const added = unwrap(
    addCreature(fold(SEED, SCENE), SRD_CONTENT, id(who), monsterId),
    monsterId,
  );
  return [
    ...SCENE,
    ...added.events,
    {
      type: 'creature-placed',
      id: id(who),
      placement: { from: { landmark: 'the ford' }, ...at },
    },
    { type: 'combat-started', combatants: [{ id: id(who), initiative: 20, speed }] },
  ];
};

const move = (
  log: readonly GameEvent[],
  who: CharacterIdLike,
  request: Parameters<typeof resolveMove>[2],
) => resolveMove(fold(SEED, log), id(who), request, supply());

type CharacterIdLike = string;

/** Bearing 90 is +x, so east is where everything goes. */
const east = (feet: number, over: Record<string, unknown> = {}) => ({
  placement: { from: { landmark: 'the ford' }, feet, bearing: 90 },
  ...over,
});

const ball = (at: Point, radius: number): TerrainRegion => ({
  origin: areaPointAt(at),
  shape: { kind: 'sphere', radius },
});

describe('the four Speeds beside walking', () => {
  it('reads a stat block’s printed Fly Speed onto the sheet', () => {
    const cockatrice = adaptMonster(
      SRD_CONTENT.monsterById('cockatrice')!,
      id('cockatrice'),
    );
    expect(cockatrice.sheet.baseSpeed).toBe(20);
    expect(speedInMode(cockatrice.sheet, 'fly')).toBe(40);
    expect(speedInMode(cockatrice.sheet, 'swim')).toBe(0);
    // SRD prints no Hover for a Cockatrice, and a flier that does not hover
    // is the one that falls.
    expect(cockatrice.sheet.speeds?.hover).toBeUndefined();
  });

  it('reads the Hover a block prints', () => {
    const specter = adaptMonster(SRD_CONTENT.monsterById('specter')!, id('specter'));
    expect(speedInMode(specter.sheet, 'fly')).toBe(50);
    expect(specter.sheet.speeds?.hover).toBe(true);
  });

  it('gives a block that prints only a walking Speed no other one', () => {
    const goblin = adaptMonster(SRD_CONTENT.monsterById('goblin-warrior')!, id('goblin'));
    expect(goblin.sheet.speeds).toBeUndefined();
    expect(speedInMode(goblin.sheet, 'climb')).toBe(0);
  });

  it('answers speedOf per mode, and answers the walking one unchanged', () => {
    const log = withMonster('chuul', 'chuul', { feet: 0 }, 30);
    const state = fold(SEED, log);
    expect(speedOf(state, id('chuul'))).toBe(30);
    expect(speedOf(state, id('chuul'), 'swim')).toBe(30);
    expect(speedOf(state, id('chuul'), 'fly')).toBe(0);
  });

  it('takes a Speed of 0 away in every mode at once', () => {
    const log = [
      ...withMonster('chuul', 'chuul', { feet: 0 }, 30),
      { type: 'condition-applied', id: id('chuul'), condition: 'restrained', source: 'a net' },
    ] as readonly GameEvent[];
    const state = fold(SEED, log);
    expect(speedOf(state, id('chuul'), 'swim')).toBe(0);
  });
});

describe('a move names its mode', () => {
  it('charges a swimmer with a Swim Speed one foot per foot', () => {
    const log = withMonster('chuul', 'chuul', { feet: 0 }, 30);
    const swum = unwrap(move(log, 'chuul', { ...east(30), mode: 'swim' }), 'swim');
    expect(swum.feet).toBe(30);
    expect(swum.cost).toBe(30);
  });

  it('charges a swimmer without one an extra foot for every foot', () => {
    const swum = unwrap(move(ALONE, 'walker', { ...east(15), mode: 'swim' }), 'swim');
    expect(swum.feet).toBe(15);
    expect(swum.cost).toBe(30);
  });

  it('charges a climber without a Climb Speed the same', () => {
    const climbed = unwrap(move(ALONE, 'walker', { ...east(15), mode: 'climb' }), 'climb');
    expect(climbed.cost).toBe(30);
  });

  it('stacks Difficult Terrain with the surcharge, as the glossary prints it', () => {
    // SRD: "1 extra foot (2 extra feet in Difficult Terrain)" — a foot of
    // expensive ground costs two, and swimming it unaided costs four.
    const swum = unwrap(
      move(ALONE, 'walker', { ...east(10), mode: 'swim', difficultFeet: 5 }),
      'swim',
    );
    expect(swum.cost).toBe(30);
  });

  it('stacks a declared patch with the surcharge too', () => {
    const declared = unwrap(
      declareDifficultTerrain(fold(SEED, ALONE), 'the shallows', {
        region: ball({ x: 100, y: 100, z: 0 }, 200),
      }),
      'terrain',
    );
    const log = [...ALONE, ...declared];
    const swum = unwrap(move(log, 'walker', { ...east(10), mode: 'swim' }), 'swim');
    expect(swum.cost).toBe(40);
    expect(swum.terrain).toEqual(['the shallows']);
  });

  it('refuses to fly a creature with no Fly Speed', () => {
    const flown = move(ALONE, 'walker', { ...east(15), mode: 'fly' });
    expect(isErr(flown) && flown.code).toBe('no_such_speed');
  });

  it('flies a creature that has one, up to that Speed and no further', () => {
    const log = withMonster('cockatrice', 'cockatrice', { feet: 0 }, 20);
    const flown = unwrap(move(log, 'cockatrice', { ...east(40), mode: 'fly' }), 'fly');
    expect(flown.cost).toBe(40);

    const far = move(log, 'cockatrice', { ...east(45), mode: 'fly' });
    expect(isErr(far) && far.code).toBe('not_enough_movement');
  });

  it('charges a shove nothing, whatever mode it is called', () => {
    const shoved = unwrap(
      move(ALONE, 'walker', { ...east(15), mode: 'swim', forced: true }),
      'shove',
    );
    expect(shoved.cost).toBe(15);
  });
});

describe('going up needs a way up', () => {
  it('refuses a walker who simply rises', () => {
    const risen = move(ALONE, 'walker', east(0, { placement: { from: { creature: WALKER }, feet: 0, elevation: 10 } }));
    expect(isErr(risen) && risen.code).toBe('cannot_rise');
  });

  it('lets a flier rise', () => {
    const log = withMonster('cockatrice', 'cockatrice', { feet: 0 }, 20);
    const risen = unwrap(
      move(log, 'cockatrice', {
        placement: { from: { creature: id('cockatrice') }, feet: 0, elevation: 20 },
        mode: 'fly',
      }),
      'up',
    );
    expect(risen.cost).toBe(20);
  });

  it('lets a climber rise, at the climbing price', () => {
    const risen = unwrap(
      move(ALONE, 'walker', {
        placement: { from: { creature: WALKER }, feet: 0, elevation: 10 },
        mode: 'climb',
      }),
      'up',
    );
    expect(risen.cost).toBe(20);
  });
});

describe('the two jumps', () => {
  it('prints the Long Jump the glossary prints', () => {
    // SRD: "a number of feet up to your Strength score ... a standing Long
    // Jump ... only half that distance."
    expect(longJumpDistance(sheet(), true)).toBe(16);
    expect(longJumpDistance(sheet(), false)).toBe(8);
  });

  it('prints the High Jump the glossary prints', () => {
    // SRD: "3 plus your Strength modifier", halved from standing.
    expect(highJumpHeight(sheet(), true)).toBe(6);
    expect(highJumpHeight(sheet(), false)).toBe(3);
  });

  it('never prints a negative High Jump', () => {
    const weak = { ...sheet(), abilities: { ...sheet().abilities, str: 4 } };
    expect(highJumpHeight(weak, true)).toBe(0);
  });

  it('charges a jump the movement it clears, and refuses one too far', () => {
    // Ten feet of walking first, which is what a running jump needs.
    const run = unwrap(move(ALONE, 'walker', east(10)), 'run');
    const log = [...ALONE, ...run.events];

    const jumped = unwrap(
      move(log, 'walker', { ...east(25), jump: { kind: 'long', running: true } }),
      'jump',
    );
    expect(jumped.cost).toBe(15);

    const far = move(log, 'walker', { ...east(30), jump: { kind: 'long', running: true } });
    expect(isErr(far) && far.code).toBe('jump_too_far');
  });

  it('refuses a jump that is somebody else doing the moving', () => {
    const shoved = move(ALONE, 'walker', {
      ...east(15),
      forced: true,
      jump: { kind: 'long' },
    });
    expect(isErr(shoved) && shoved.code).toBe('bad_jump');
  });

  it('refuses a jump that is also a swim', () => {
    const both = move(ALONE, 'walker', {
      ...east(5),
      mode: 'swim',
      jump: { kind: 'long' },
    });
    expect(isErr(both) && both.code).toBe('bad_jump');
  });

  it('refuses a running start nobody ran up to', () => {
    const jumped = move(ALONE, 'walker', { ...east(15), jump: { kind: 'long', running: true } });
    expect(isErr(jumped) && jumped.code).toBe('no_running_start');
  });

  it('bounds a High Jump by the height rather than by the distance', () => {
    const run = unwrap(move(ALONE, 'walker', east(10)), 'run');
    const log = [...ALONE, ...run.events];

    const up = unwrap(
      move(log, 'walker', {
        placement: { from: { creature: WALKER }, feet: 0, elevation: 5 },
        jump: { kind: 'high', running: true },
      }),
      'high',
    );
    expect(up.cost).toBe(5);

    const higher = move(log, 'walker', {
      placement: { from: { creature: WALKER }, feet: 0, elevation: 10 },
      jump: { kind: 'high', running: true },
    });
    expect(isErr(higher) && higher.code).toBe('jump_too_far');
  });

  it('cannot express a standing High Jump on a 5-foot lattice, and says so', () => {
    // Strength 16 standing reaches 3 feet, and the smallest rise a position
    // can hold is 5: the refusal is the rule and the lattice agreeing, not a
    // rounding the engine may quietly do in the jumper's favour.
    const up = move(ALONE, 'walker', {
      placement: { from: { creature: WALKER }, feet: 0, elevation: 5 },
      jump: { kind: 'high' },
    });
    expect(isErr(up) && up.code).toBe('jump_too_far');
  });
});

describe('a flier that stops flying falls', () => {
  const aloft = (who: string, monsterId: string, height: number): readonly GameEvent[] =>
    withMonster(who, monsterId, { feet: 10, bearing: 90, elevation: height }, 20);

  const proned = (who: string, log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: id(who), condition: 'prone', source: 'a shove' },
  ];

  it('drops a Prone flier the height it was at, and lands it', () => {
    const log = proned('cockatrice', aloft('cockatrice', 'cockatrice', 30));
    const fell = unwrap(resolveFall(fold(SEED, log), id('cockatrice'), {}, supply()), 'fall');
    expect(fell.dice).toBe('3d6');
    expect(fell.damage).toBeGreaterThan(0);

    const after = fold(SEED, [...log, ...fell.events]);
    expect(positionOf(after.scene!, id('cockatrice'))?.z).toBe(0);
  });

  it('drops a flier whose Speed is 0', () => {
    const log = [
      ...aloft('cockatrice', 'cockatrice', 20),
      {
        type: 'condition-applied',
        id: id('cockatrice'),
        condition: 'restrained',
        source: 'a net',
      },
    ] as readonly GameEvent[];
    const fell = unwrap(resolveFall(fold(SEED, log), id('cockatrice'), {}, supply()), 'fall');
    expect(fell.dice).toBe('2d6');
  });

  it('does not drop one that hovers', () => {
    const log = proned('specter', aloft('specter', 'specter', 30));
    const fell = resolveFall(fold(SEED, log), id('specter'), {}, supply());
    expect(isErr(fell) && fell.code).toBe('hovering');
  });

  it('does not drop a flier nothing has taken out of the air', () => {
    const fell = resolveFall(
      fold(SEED, aloft('cockatrice', 'cockatrice', 30)),
      id('cockatrice'),
      {},
      supply(),
    );
    expect(isErr(fell) && fell.code).toBe('still_aloft');
  });

  it('asks for the height of anybody else’s fall', () => {
    const fell = resolveFall(fold(SEED, ALONE), WALKER, {}, supply());
    expect(isErr(fell) && fell.kind).toBe('needs-context');
    expect(isErr(fell) && fell.code).toBe('no_fall_height');
  });

  it('leaves a stated height exactly as it was', () => {
    const fell = unwrap(resolveFall(fold(SEED, ALONE), WALKER, { feet: 30 }, supply()), 'fall');
    expect(fell.dice).toBe('3d6');
    // The table said how far; where the bottom is is not the engine's to know,
    // so nothing moved.
    expect(fell.events.some((event) => event.type === 'creature-moved')).toBe(false);
  });
});
