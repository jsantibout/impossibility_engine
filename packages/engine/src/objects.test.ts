import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { armorClass, type CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { creaturesInArea } from './positioning.js';
import { NO_ABILITY_SCORES, rollSavingThrow } from './checks.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  applyConditionTo,
  damageCreature,
  declareObject,
  endCombat,
  resolveAttack,
} from './commands.js';
import { OBJECT_CONDITION_IMMUNITIES, OBJECT_CREATURE_TYPE } from './objects.js';
import { checkContent, extendContent, loadContent } from './content.js';

/**
 * A thing you can hit, that has hit points, and that is not a creature.
 *
 * The whole of the design is in the first line of the file it tests: a
 * breakable object is a **stated sheet**, exactly as a monster is, so it
 * arrives through `creature-added` and every reader downstream — the Armour
 * Class, the defences, the conditions, the vitals, the area sweep — is the one
 * that was already there. Nothing in the attack path knows what an object is,
 * and that is the claim these tests are here to hold.
 *
 * The two facts that are *not* free are the two this file dwells on: an object
 * must not be able to wedge a fight it has no part in, and a damage threshold
 * is a mechanic the engine did not have.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const DOOR = id('oak-door');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(FIGHTER, 'party'),
  added(GOBLIN, 'goblins', 7),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [{ id: 'greataxe', quantity: 1 }],
    source: 'kit',
  },
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 },
  },
];

const base = (log: readonly GameEvent[] = SETUP): GameState => fold('seed', log);

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The door as the SRD's tables build it: Medium, wooden, resilient. */
const OAK_DOOR = {
  name: 'the oak door',
  material: 'wood',
  size: 'medium',
  build: 'resilient',
} as const;

const declare = (
  log: readonly GameEvent[] = SETUP,
  over: Partial<Parameters<typeof declareObject>[3]> = {},
) => unwrap(declareObject(fold('seed', log), SRD_CONTENT, DOOR, { ...OAK_DOOR, ...over }), 'door');

/** Declare the door and hand back the log it leaves behind. */
const withDoor = (over: Partial<Parameters<typeof declareObject>[3]> = {}): readonly GameEvent[] => [
  ...SETUP,
  ...declare(SETUP, over),
  {
    type: 'creature-placed',
    id: DOOR,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 270 },
  },
];

describe('the SRD’s tables say what an object is, and the caller does not', () => {
  it('reads the Armour Class off the material and the hit points off the size', () => {
    const state = fold('seed', [...SETUP, ...declare()]);
    const door = state.creatures[DOOR]!;

    // SRD Object Armour Class: Wood is 15. Object Hit Points: a resilient
    // Medium object is 18 (4d8).
    expect(armorClass(door.sheet)).toBe(15);
    expect(door.vitals.hpMax).toBe(18);
    expect(door.vitals.hp).toBe(18);
  });

  it('reads the other column of the same row when the thing is flimsy', () => {
    const state = fold('seed', [...SETUP, ...declare(SETUP, { build: 'fragile' })]);

    // SRD Object Hit Points: a fragile Medium object is 4 (1d8), where the
    // resilient one beside it is 18. The Armour Class is the substance's and
    // does not move with the column.
    expect(state.creatures[DOOR]!.vitals.hpMax).toBe(4);
    expect(armorClass(state.creatures[DOOR]!.sheet)).toBe(15);
  });

  it('is an Object, is destroyed at 0, and rolls no death saves', () => {
    const state = fold('seed', [...SETUP, ...declare()]);
    const door = state.creatures[DOOR]!;

    expect(door.creatureType).toBe(OBJECT_CREATURE_TYPE);
    // SRD: "An object is destroyed when it has 0 Hit Points." No dying, no
    // Unconscious, no three failures.
    expect(door.vitals.diesAtZero).toBe(true);
  });

  it('is immune to Poison and Psychic damage, which is a rule and not a material', () => {
    const state = fold('seed', [...SETUP, ...declare()]);
    const door = state.creatures[DOOR]!;

    // SRD "Damage Types and Objects": "Objects have Immunity to Poison and
    // Psychic damage."
    expect(door.defenses['poison']).toEqual({ immune: true });
    expect(door.defenses['psychic']).toEqual({ immune: true });
    expect(door.defenses['slashing']).toBeUndefined();
  });

  it('cannot be Charmed, Frightened, Poisoned or made Prone', () => {
    const log = [...SETUP, ...declare()];
    const state = fold('seed', log);

    expect([...state.creatures[DOOR]!.conditionImmunities].sort()).toEqual(
      [...OBJECT_CONDITION_IMMUNITIES].sort(),
    );

    // And the refusal is the one `applyConditionTo` already had.
    const refused = applyConditionTo(state, DOOR, 'frightened', 'the shout');
    expect(isErr(refused) && refused.code).toBe('immune');
  });

  it('refuses a material the world does not hold, and a size with no row', () => {
    const state = base();
    const stuff = declareObject(state, SRD_CONTENT, DOOR, { ...OAK_DOOR, material: 'voidsteel' });
    expect(isErr(stuff) && stuff.code).toBe('unknown_material');

    const huge = declareObject(state, SRD_CONTENT, DOOR, { ...OAK_DOOR, size: 'gargantuan' });
    // SRD: the table covers Large or smaller, and says to divide anything
    // bigger into sections. That is the DM's to do, and it is a refusal here.
    expect(isErr(huge) && huge.code).toBe('unknown_object_size');
  });

  it('refuses a damage threshold that is not a whole number of at least 1', () => {
    const state = base();
    const zero = declareObject(state, SRD_CONTENT, DOOR, { ...OAK_DOOR, damageThreshold: 0 });
    expect(isErr(zero) && zero.code).toBe('bad_damage_threshold');

    const fraction = declareObject(state, SRD_CONTENT, DOOR, {
      ...OAK_DOOR,
      damageThreshold: 7.5,
    });
    expect(isErr(fraction) && fraction.code).toBe('bad_damage_threshold');
  });

  it('refuses a second thing under one name, and a retry is not a second door', () => {
    const state = fold('seed', [...SETUP, ...declare()]);
    const again = declareObject(state, SRD_CONTENT, DOOR, OAK_DOOR);
    expect(isErr(again) && again.code).toBe('already_present');

    // The same command id twice is the empty batch, as every command is.
    const once = unwrap(
      declareObject(base(), SRD_CONTENT, DOOR, OAK_DOOR, { commandId: 'door-1' }),
      'first',
    );
    const retried = unwrap(
      declareObject(fold('seed', [...SETUP, ...once]), SRD_CONTENT, DOOR, OAK_DOOR, {
        commandId: 'door-1',
      }),
      'retry',
    );
    expect(retried).toEqual([]);
  });
});

describe('the attack path does not know what an object is', () => {
  it('swings at a door with the command that swings at a goblin', () => {
    const log = withDoor();
    const out = unwrap(
      resolveAttack(fold('seed', log), FIGHTER, { target: DOOR, weapon: 'greataxe' }, supply()),
      'swing',
    );

    // The Armour Class it rolled against is the door's own, read off the same
    // sheet a monster's is read off.
    expect(out.attack!.targetAc).toBe(15);
  });

  it('is caught by an area exactly as a creature standing there is', () => {
    const state = fold('seed', withDoor());
    const caught = unwrap(
      creaturesInArea(state.scene!, { creature: FIGHTER }, { kind: 'sphere', radius: 10 }),
      'sphere',
    );

    // SRD Shatter: "A nonmagical object that isn't being worn or carried also
    // takes the damage if it's in the spell's area." The sweep that finds the
    // goblin finds the door, because the door is on the map the same way.
    expect(caught).toContain(DOOR);
    expect(caught).toContain(GOBLIN);
  });

  it('is destroyed at 0 hit points without a death save in sight', () => {
    const log = withDoor();
    const broken = unwrap(damageCreature(fold('seed', log), DOOR, { amount: 18, source: 'the greataxe' }), 'break');
    const after = fold('seed', [...log, ...broken]);

    expect(after.creatures[DOOR]!.vitals.hp).toBe(0);
    expect(after.creatures[DOOR]!.vitals.dead).toBe(true);
    expect(after.creatures[DOOR]!.vitals.deathSaveFailures).toBe(0);
  });
});

describe('a damage threshold is Immunity until the blow is big enough', () => {
  // SRD "Damage Threshold": "Immunity to all damage unless it takes an amount
  // of damage from a single attack or effect equal to or greater than its
  // damage threshold, in which case it takes that entire instance of damage."
  const wall = () => withDoor({ name: 'the castle wall', damageThreshold: 10 });

  it('ignores a blow under the threshold entirely', () => {
    const log = wall();
    const out = unwrap(damageCreature(fold('seed', log), DOOR, { amount: 9, source: 'the hand axe' }), 'nine');
    const after = fold('seed', [...log, ...out]);

    expect(after.creatures[DOOR]!.vitals.hp).toBe(18);
  });

  it('takes the whole instance once the threshold is met', () => {
    const log = wall();
    const out = unwrap(damageCreature(fold('seed', log), DOOR, { amount: 11, source: 'the maul' }), 'eleven');
    const after = fold('seed', [...log, ...out]);

    // The *entire* instance, not the excess over the threshold.
    expect(after.creatures[DOOR]!.vitals.hp).toBe(7);
  });

  it('is exactly at the threshold, which the book says counts', () => {
    const log = wall();
    const out = unwrap(damageCreature(fold('seed', log), DOOR, { amount: 10, source: 'the maul' }), 'ten');
    expect(fold('seed', [...log, ...out]).creatures[DOOR]!.vitals.hp).toBe(8);
  });

  it('leaves a creature with no threshold exactly where it was', () => {
    const out = unwrap(damageCreature(base(), GOBLIN, { amount: 1, source: 'the dagger' }), 'scratch');
    expect(fold('seed', [...SETUP, ...out]).creatures[GOBLIN]!.vitals.hp).toBe(6);
  });
});

describe('a thing with no ability scores fails every saving throw', () => {
  /**
   * SRD "Breaking Objects": "An object lacks ability scores unless a rule
   * assigns scores to the object. Without ability scores, an object can't make
   * ability checks, and it fails all saving throws."
   *
   * The half that bites is the save, and it bites because an area catches a
   * door: a Fireball centred on the room asks the door for a Dexterity save,
   * and six zeroes are a modifier of −5 rather than a refusal to roll. So
   * the sheet says it has no scores and `checks.ts` reads that where the die
   * is thrown — once, for all ten call sites that throw one.
   */
  const door = () => fold('seed', [...SETUP, ...declare()]).creatures[DOOR]!;

  it('says so on the sheet rather than leaving six zeroes to speak for it', () => {
    expect(door().sheet.stated?.noAbilityScores).toBe(true);
    expect(door().sheet.abilities).toEqual({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  });

  it('fails the save whatever the die shows, and the die is still recorded', () => {
    // A DC of 1 is a save nothing could miss on the arithmetic — even
    // −5 plus a natural 1 would be beaten by a DC of −5, and 1 is the
    // lowest the tools allow — so a success here would be the modifier
    // talking rather than the rule.
    const rolled = unwrap(
      rollSavingThrow(createRollIssuer('r'), createRng('save') as Rng, door().sheet, 'dex', {
        dc: 1,
      }),
      'save',
    );
    expect(rolled.success).toBe(false);
    expect(rolled.autoFailed).toBe(NO_ABILITY_SCORES);
    expect(rolled.natural).toBeGreaterThan(0);
  });

  it('leaves a creature that has ability scores exactly where it was', () => {
    const goblin = base().creatures[GOBLIN]!;
    const rolled = unwrap(
      rollSavingThrow(createRollIssuer('r'), createRng('save') as Rng, goblin.sheet, 'dex', {
        dc: 1,
      }),
      'save',
    );
    expect(rolled.autoFailed).toBeNull();
    expect(rolled.success).toBe(true);
  });
});

describe('a door cannot wedge a fight', () => {
  const fight = (): readonly GameEvent[] => [
    ...withDoor(),
    {
      type: 'combat-started',
      combatants: [
        { id: FIGHTER, initiative: 18, speed: 30 },
        { id: GOBLIN, initiative: 6, speed: 30 },
      ],
    },
  ];

  it('is not in the turn order, so it is not a hostile still standing', () => {
    const state = fold('seed', fight());
    expect(state.combat!.order.map((c) => c.id)).toEqual([FIGHTER, GOBLIN]);
    expect(state.combat!.order.some((c) => c.id === DOOR)).toBe(false);
  });

  it('does not stop `endCombat` closing a fight whose last hostile is down', () => {
    const log = fight();
    const killed = unwrap(damageCreature(fold('seed', log), GOBLIN, { amount: 20, source: 'the greataxe' }), 'kill');
    const after = [...log, ...killed];

    // The door is on the roster, placed, on nobody's side, and at full hit
    // points. If it counted as a combatant this would be `undeclared_side`.
    const state = fold('seed', after);
    expect(state.creatures[DOOR]!.side).toBeNull();
    expect(state.creatures[DOOR]!.vitals.hp).toBe(18);

    const ended = unwrap(endCombat(state, { kind: 'defeated' }), 'end');
    expect(ended.map((e) => e.type)).toContain('combat-ended');
  });

  it('is still standing after the fight it was never in', () => {
    const log = fight();
    const ended = unwrap(
      endCombat(fold('seed', log), { kind: 'surrender', side: 'goblins' }),
      'surrender',
    );
    const after = fold('seed', [...log, ...ended]);

    expect(after.combat).toBeNull();
    expect(after.creatures[DOOR]!.vitals.hp).toBe(18);
    // And it is still there to be broken open afterwards.
    expect(after.scene!.positions[DOOR]).toBeDefined();
  });
});

describe('the two tables come through the door homebrew uses', () => {
  /**
   * The point of the tables being content rather than constants: a world with
   * a substance the SRD never printed writes a row and swings at it, and the
   * engine does not change. This is the `content.test.ts` argument for one
   * more population.
   */
  const homebrew = () =>
    unwrap(
      extendContent(SRD_CONTENT, {
        objectMaterials: [{ id: 'voidsteel', name: 'Voidsteel', armorClass: 25 }],
      }),
      'homebrew',
    );

  it('lets a homebrew substance carry its own Armour Class', () => {
    const state = fold('seed', [...SETUP, ...unwrap(
      declareObject(base(), homebrew(), DOOR, { ...OAK_DOOR, material: 'voidsteel' }),
      'voidsteel door',
    )]);
    expect(armorClass(state.creatures[DOOR]!.sheet)).toBe(25);
  });

  it('refuses a row that is not a row, from untyped JSON', () => {
    const material = loadContent({ objectMaterials: [{ id: 'gloom', name: 'Gloom' }] });
    expect(isErr(material) && material.reason).toContain('bad_object_material');

    const size = loadContent({ objectSizes: [{ id: 'enormous', fragile: 1, resilient: 2 }] });
    expect(isErr(size) && size.reason).toContain('bad_object_size');
  });

  it('refuses a row the compiler let through, at the same door', () => {
    const problems = checkContent({
      objectMaterials: [{ id: 'fog', name: 'Fog', armorClass: 0 }],
      objectSizes: [{ id: 'medium', fragile: 0, resilient: 18 }],
    });
    expect(problems.map((problem) => problem.code).sort()).toEqual([
      'bad_armor_class',
      'bad_hit_points',
    ]);
  });
});
