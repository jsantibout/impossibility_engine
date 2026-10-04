/**
 * **A touch that eats metal** — M-MATTER.
 *
 * SRD Rust Monster, Destroy Metal: "The rust monster touches a nonmagical
 * metal object within 5 feet of itself that isn't being worn or carried. The
 * touch destroys a 1-foot Cube of the object."
 *
 * W7-B13 left it owed for one reason: the touch is **legality** — a reach, a
 * thing that is metal and nonmagical, a thing nobody wears or carries — and
 * the door that hands a sentence over could name no object and read no
 * substance. Since E-L1 a declared object pins whether it is metal, so the
 * touch is checked here:
 *
 * - **an object**, which is a declared one: a thing in the room, never worn or
 *   carried — the reading SRD Light's target rule already takes (W9-S4). A
 *   creature, and whatever it holds, is refused;
 * - **within 5 feet**, measured;
 * - **metal**, off the pin: a substance that is not is refused, and one nobody
 *   has said of goes ahead with that said, as SRD Heat Metal's does (E-L1);
 * - **nonmagical**, off the record, which for a declared object says nothing
 *   magical — read and said, as Corrosive Form reads a weapon's.
 *
 * **The cube is a question, not a guess.** A declared object is a substance, a
 * size and hit points, and no shape: a Tiny object is "a bottle, a lock" alike,
 * and whether a cubic foot is the whole of this one is a fact only the table
 * holds. So the door asks (`wholeObject`), and where the cube is the whole of
 * the thing the thing is destroyed — "An object is destroyed when it has 0 Hit
 * Points" is the engine's, and so is this. Where it is not, the object stands:
 * a hole in an iron gate is a change to the map the table is drawing, and no
 * rule reads it afterwards.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareObject,
  placeCreatureInScene,
  setScene,
  takePrintedTouch,
  takeStatedAction,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { extendContent, type Content } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'rust';
const RUST = id('rust');
const BREN = id('bren');
const GATE = id('gate');
const LOCK = id('lock');
const CHEST = id('chest');
const ODD = id('odd');
const FAR = id('far');
const LINE = 'Destroy Metal';

const homebrew = unwrap(
  extendContent(SRD_CONTENT, {
    objectMaterials: [{ id: 'voidsteel', name: 'Voidsteel', armorClass: 25 }],
  }),
  'voidsteel',
);

const bren = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/**
 * The rust monster in a smithy: an iron gate, an iron lock, a wooden box and
 * a thing of a substance nobody has said of, each five feet off; a second gate
 * thirty feet off; Bren beside it. The rust monster's turn.
 */
const smithy = (content: Content = homebrew): Table => {
  const table = new Table();
  const thing = (who: CharacterId, name: string, material: string, size: 'tiny' | 'large') =>
    table.do(name, (s) => declareObject(s, content, who, { name, material, size, build: 'resilient' }));
  table.do('Bren arrives', () => createCharacter(content, bren(), BREN));
  table.did('the rust monster arrives', (s) => addCreature(s, content, RUST, 'rust-monster'));
  thing(GATE, 'the iron gate', 'iron', 'large');
  thing(LOCK, 'the iron lock', 'iron', 'tiny');
  thing(CHEST, 'the oak box', 'wood', 'tiny');
  thing(ODD, 'the odd thing', 'voidsteel', 'tiny');
  thing(FAR, 'the far gate', 'iron', 'large');
  table.do('the smithy', (s) => setScene(s, { width: 400, depth: 400, height: 40 }));
  table.do('the anvil', (s) => addSceneLandmark(s, 'the anvil', { x: 200, y: 200, z: 0 }));
  table.do('the rust monster', (s) =>
    placeCreatureInScene(s, RUST, { from: { landmark: 'the anvil' }, feet: 0 }),
  );
  const near = (who: CharacterId, bearing: number, feet = 5) =>
    table.do(`${who} placed`, (s) =>
      placeCreatureInScene(s, who, { from: { creature: RUST }, feet, bearing }),
    );
  near(BREN, 0);
  near(LOCK, 90);
  near(GATE, 180, 10);
  near(ODD, 270);
  near(CHEST, 45);
  near(FAR, 0, 40);
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the rust monster’s side', (s) => declareCreatureSide(s, RUST, 'beasts'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: RUST, initiative: 20, speed: 40 },
      { id: BREN, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

const touch = (
  state: GameState,
  object: CharacterId,
  wholeObject?: boolean,
  commandId = 'touch',
) =>
  takePrintedTouch(state, RUST, {
    line: LINE,
    object,
    ...(wholeObject === undefined ? {} : { wholeObject }),
    commandId,
  });

const actionLeft = (state: GameState): boolean => state.combat!.budgets[RUST]!.action;

describe('SRD Rust Monster, Destroy Metal: what the touch may reach', () => {
  it('refuses a creature, which is not an object nobody wears or carries, before anything is spent', () => {
    const state = smithy().state;
    const refused = touch(state, BREN, true);
    expect(isErr(refused) && refused.code).toBe('not_an_object');
    expect(actionLeft(state)).toBe(true);
  });

  it('refuses a line whose sentence is no touch, naming the door that hands it over', () => {
    // SRD Antennae is a printed save, read for `forcePrintedSave`.
    const refused = takePrintedTouch(smithy().state, RUST, { line: 'Antennae', object: LOCK, wholeObject: true });
    expect(isErr(refused) && refused.code).toBe('line_touches_nothing');
  });

  it('refuses an object that is not metal', () => {
    const refused = touch(smithy().state, CHEST, true);
    expect(isErr(refused) && refused.code).toBe('not_metal');
  });

  it('refuses an object out of reach', () => {
    const refused = touch(smithy().state, FAR, true);
    expect(isErr(refused) && refused.code).toBe('out_of_reach');
  });

  it('refuses an object already destroyed, before the economy is asked', () => {
    const table = smithy();
    table.did('the lock eaten', (s) => touch(s, LOCK, true, 'one'));
    const refused = touch(table.state, LOCK, true, 'two');
    expect(isErr(refused) && refused.code).toBe('object_destroyed');
  });

  it('asks whether the cube is the whole of the object, rather than guessing from a size', () => {
    const state = smithy().state;
    const asked = touch(state, LOCK);
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.code).toBe('undeclared_whole_object');
      expect(asked.kind).toBe('needs-context');
    }
    expect(actionLeft(state)).toBe(true);
  });
});

describe('SRD Rust Monster, Destroy Metal: what the touch does', () => {
  it('destroys an iron lock the cube is the whole of, and spends the Action', () => {
    const table = smithy();
    const out = unwrap(touch(table.state, LOCK, true), 'the touch');
    table.log.push(...out.events);
    expect(out.destroyed).toBe(true);
    expect(table.state.creatures[LOCK]!.vitals.dead).toBe(true);
    expect(actionLeft(table.state)).toBe(false);
    expect(
      out.events.some((event) => event.type === 'stated-action-taken' && event.line === LINE),
    ).toBe(true);
  });

  it('leaves an iron gate standing where the cube is a part of it, Hit Points and all', () => {
    const table = smithy();
    const before = table.state.creatures[GATE]!.vitals.hp;
    const out = unwrap(touch(table.state, GATE, false), 'the touch');
    table.log.push(...out.events);
    expect(out.destroyed).toBe(false);
    expect(table.state.creatures[GATE]!.vitals.dead).toBe(false);
    expect(table.state.creatures[GATE]!.vitals.hp).toBe(before);
    expect(actionLeft(table.state)).toBe(false);
  });

  it('goes ahead on a substance nobody has said is metal, and says so', () => {
    const out = unwrap(touch(smithy().state, ODD, true), 'the touch');
    expect(out.destroyed).toBe(true);
    expect(out.unverified.join(' ')).toContain('whether the odd thing is metal');
  });

  it('says the object is read as nonmagical off its record', () => {
    const out = unwrap(touch(smithy().state, GATE, false), 'the touch');
    expect(out.unverified.join(' ')).toContain('nonmagical by its record');
  });

  it('is a no-op when retried under the same command id', () => {
    const table = smithy();
    table.did('the touch', (s) => touch(s, LOCK, true));
    const again = unwrap(touch(table.state, LOCK, true), 'again');
    expect(again.duplicate).toBe(true);
    expect(again.events).toEqual([]);
  });

  it('is refused by the door that hands a sentence over, which names this one', () => {
    const refused = takeStatedAction(smithy().state, RUST, { line: LINE });
    expect(isErr(refused) && refused.code).toBe('line_has_its_own_door');
    expect(isErr(refused) && refused.reason).toContain('takePrintedTouch');
  });
});
