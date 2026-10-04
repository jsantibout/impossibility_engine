/**
 * **A thing that takes light** — M-MATTER.
 *
 * Four sentences in the bestiary set "a flammable object" burning, and until
 * now a declared object was a substance and a size with nothing on it that
 * said whether it burned:
 *
 * - SRD Barbed Devil, Hurl Flame: "If the target is a flammable object that
 *   isn't being worn or carried, it starts burning." — no creature at all;
 * - SRD Fire Elemental, Burn: "If the target is a creature or a flammable
 *   object, it starts burning.";
 * - SRD Magmin, Touch: the same, "that isn't being worn or carried";
 * - SRD Fire Elemental, Fire Aura: "Creatures and flammable objects in the
 *   Emanation start burning."
 *
 * So the substance says (`ObjectMaterial.flammable`, content's reading of each
 * row of the Object Armor Class table), the declaration pins it as it pins
 * `metal`, and the fire reads the pin. A declared object is never worn or
 * carried — it is a thing in the room — so "that isn't being worn or carried"
 * is true of every one of them, which is the reading SRD Light's target rule
 * already takes (W9-S4).
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareObject,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { caughtIn } from './hazards.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'tinder';
const BREN = id('bren');
const BEAST = id('beast');
const DOOR = id('door');
const STATUE = id('statue');

const supply = (content: Content = SRD_CONTENT, seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

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

  constructor(readonly content: Content = SRD_CONTENT) {}

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
 * A beast, Bren beside it, and two Large, resilient things near it —
 * a wooden door and a thing of `stone` (or whatever is asked for), each
 * inside a ten-foot Emanation from a Large beast. Large and
 * resilient so that no blow here can break either, which keeps the question
 * to the fire. The beast's turn first.
 */
const room = (block: string, statueOf = 'stone', content: Content = SRD_CONTENT): Table => {
  const table = new Table(content);
  table.do('Bren arrives', () => createCharacter(content, bren(), BREN));
  table.did('the beast arrives', (s) => addCreature(s, content, BEAST, block));
  table.do('the door', (s) =>
    declareObject(s, content, DOOR, {
      name: 'the oak door',
      material: 'wood',
      size: 'large',
      build: 'resilient',
    }),
  );
  table.do('the statue', (s) =>
    declareObject(s, content, STATUE, {
      name: 'the statue',
      material: statueOf,
      size: 'large',
      build: 'resilient',
    }),
  );
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('the beast by the oak', (s) =>
    placeCreatureInScene(s, BEAST, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('Bren nearby', (s) =>
    placeCreatureInScene(s, BREN, { from: { creature: BEAST }, feet: 10, bearing: 0 }),
  );
  table.do('the door nearby', (s) =>
    placeCreatureInScene(s, DOOR, { from: { creature: BEAST }, feet: 10, bearing: 90 }),
  );
  table.do('the statue nearby', (s) =>
    placeCreatureInScene(s, STATUE, { from: { creature: BEAST }, feet: 10, bearing: 270 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the beast’s side', (s) => declareCreatureSide(s, BEAST, 'fiends'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BEAST, initiative: 20, speed: 30 },
      { id: BREN, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

/** The beast's printed line, forced to land, at whatever it is aimed at. */
const swing = (table: Table, action: string, target: CharacterId, commandId = 'swing') => {
  const out = unwrap(
    resolveAttack(
      table.state,
      BEAST,
      { target, weapon: null, action, attackBonuses: [{ source: 'forced', flat: 40 }], commandId },
      supply(table.content),
    ),
    `the ${action}`,
  );
  table.log.push(...out.events);
  return { ...out, state: table.state };
};

describe('the substance says whether it takes light', () => {
  it('pins the mark on the declaration, as the metal mark is pinned', () => {
    const table = room('barbed-devil');
    expect(table.state.creatures[DOOR]!.material).toEqual({ id: 'wood', metal: false, flammable: true });
    expect(table.state.creatures[STATUE]!.material).toEqual({
      id: 'stone',
      metal: false,
      flammable: false,
    });
  });

  it('refuses a mark that is not a yes or a no, from untyped JSON', () => {
    const problems = checkContent({
      objectMaterials: [{ id: 'kindling', name: 'Kindling', armorClass: 11, flammable: 'yes' as unknown as boolean }],
    });
    expect(problems.map((problem) => [problem.field, problem.code])).toEqual([
      ['objectMaterials[kindling].flammable', 'malformed_field'],
    ]);
    const loaded = loadContent({ objectMaterials: [{ id: 'kindling', name: 'Kindling', armorClass: 11, flammable: true }] });
    expect(loaded.ok && loaded.value.objectMaterial('kindling')?.flammable).toBe(true);
  });

  it('reads the SRD’s rows: cloth and wood burn, and nothing else on the table does', () => {
    const marks = Object.fromEntries(
      SRD_CONTENT.objectMaterials.map((row) => [row.id, row.flammable]),
    );
    expect(marks).toEqual({
      cloth: true,
      crystal: false,
      wood: true,
      stone: false,
      iron: false,
      mithral: false,
      adamantine: false,
    });
  });
});

describe('SRD Barbed Devil, Hurl Flame: a flammable object, and nothing else', () => {
  it('sets the oak door burning', () => {
    const table = room('barbed-devil');
    const out = swing(table, 'Hurl Flame', DOOR);
    expect(out.attack?.hit).toBe(true);
    expect(out.state.creatures[DOOR]!.vitals.dead).toBe(false);
    expect(caughtIn(out.state, DOOR, 'burning')).toBe(true);
  });

  it('says out loud that an object has no turn for the fire to eat it at', () => {
    const out = swing(room('barbed-devil'), 'Hurl Flame', DOOR);
    expect(out.unverified.join(' ')).toContain('takes no turns');
  });

  it('leaves a stone statue unlit, and says nothing is owed', () => {
    const out = swing(room('barbed-devil'), 'Hurl Flame', STATUE);
    expect(out.attack?.hit).toBe(true);
    expect(caughtIn(out.state, STATUE, 'burning')).toBe(false);
    expect(out.unverified.join(' ')).not.toContain('the engine does not apply that');
  });

  it('lights nothing the blow has broken: a destroyed rag has nothing left to burn', () => {
    const table = room('barbed-devil');
    const RAG = id('rag');
    table.do('the rag', (s) =>
      declareObject(s, SRD_CONTENT, RAG, { name: 'the rag', material: 'cloth', size: 'tiny', build: 'fragile' }),
    );
    table.do('the rag nearby', (s) =>
      placeCreatureInScene(s, RAG, { from: { creature: BEAST }, feet: 10, bearing: 180 }),
    );
    const out = swing(table, 'Hurl Flame', RAG);
    expect(out.state.creatures[RAG]!.vitals.dead).toBe(true);
    expect(caughtIn(out.state, RAG, 'burning')).toBe(false);
    expect(out.unverified.join(' ')).not.toContain('is burning');
  });

  it('sets no creature alight, because the sentence names none', () => {
    const out = swing(room('barbed-devil'), 'Hurl Flame', BREN);
    expect(out.attack?.hit).toBe(true);
    expect(caughtIn(out.state, BREN, 'burning')).toBe(false);
    // Read to the end: the sentence is spent, so nothing goes back as owed.
    expect(out.unverified.join(' ')).not.toContain('flammable object');
  });

  it('lights nothing it cannot read the substance of, and says whose that is', () => {
    const homebrew = unwrap(
      extendContent(SRD_CONTENT, {
        objectMaterials: [{ id: 'voidsteel', name: 'Voidsteel', armorClass: 25 }],
      }),
      'voidsteel',
    );
    const out = swing(room('barbed-devil', 'voidsteel', homebrew), 'Hurl Flame', STATUE);
    expect(out.attack?.hit).toBe(true);
    expect(caughtIn(out.state, STATUE, 'burning')).toBe(false);
    expect(out.unverified.join(' ')).toContain('whether the statue takes light');
  });
});

describe('SRD Fire Elemental, Burn: a creature or a flammable object', () => {
  it('sets the oak door burning, which it used to hand back', () => {
    const out = swing(room('fire-elemental'), 'Burn', DOOR);
    expect(out.attack?.hit).toBe(true);
    expect(caughtIn(out.state, DOOR, 'burning')).toBe(true);
    expect(out.unverified.join(' ')).not.toContain('whether door is now alight');
  });

  it('leaves the stone statue unlit', () => {
    const out = swing(room('fire-elemental'), 'Burn', STATUE);
    expect(caughtIn(out.state, STATUE, 'burning')).toBe(false);
  });

  it('still sets Bren burning', () => {
    const out = swing(room('fire-elemental'), 'Burn', BREN);
    expect(caughtIn(out.state, BREN, 'burning')).toBe(true);
  });
});

describe('SRD Fire Elemental, Fire Aura: creatures and flammable objects in the Emanation', () => {
  const endTurn = (table: Table) => {
    const out = unwrap(resolveTurn(table.state, supply(table.content, 'aura')), 'the turn');
    table.log.push(...out.events);
    return { ...out, state: table.state };
  };

  it('lights the door and Bren, and not the statue', () => {
    const out = endTurn(room('fire-elemental'));
    expect(caughtIn(out.state, BREN, 'burning')).toBe(true);
    expect(caughtIn(out.state, DOOR, 'burning')).toBe(true);
    expect(caughtIn(out.state, STATUE, 'burning')).toBe(false);
  });

  it('no longer hands the objects to the table', () => {
    const out = endTurn(room('fire-elemental'));
    expect(out.unverified.join(' ')).not.toContain('the objects are the table');
  });
});
