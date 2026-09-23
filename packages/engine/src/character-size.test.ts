import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { placeCreatureInScene } from './commands.js';
import { extendContent } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  advanceCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';
import type { SpellbookEntry } from './spellbook.js';

/**
 * A character has a size.
 *
 * SRD prints a size on every species — "Medium (about 4–7 feet tall) or Small
 * (about 2–4 feet tall), chosen when you select this species" — and creation
 * derived everything else from the species and not that. So the one fact the
 * book prints most plainly about how much room a character takes up reached
 * the engine only when somebody placed them on a map and *said*, which is a
 * fact the Engine owes the caller rather than asks of it.
 *
 * It is pinned into `creature-added`, beside the creature type, for the reason
 * a monster's printed size is pinned there: the fold opens no catalogue, so
 * what the species said is a fact of the log.
 */

const id = (s: string) => asCharacterId(s);

/** The six spells a level 1 Wizard's book holds. */
const BOOK: readonly SpellbookEntry[] = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'sleep',
].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const }));

/**
 * A level 1 Wizard of whichever species is asked for.
 *
 * Species is the only axis these tests move, so each one carries the feature
 * choices its own traits ask for and nothing else differs.
 */
const wizard = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Ander',
  classId: 'wizard',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [...BOOK],
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {},
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
  },
  ...over,
});

/** A Human's two traits ask for a skill and an Origin feat. */
const human = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  wizard({
    speciesId: 'human',
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
    },
    ...over,
  });

const tiefling = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  wizard({
    speciesId: 'tiefling',
    featureChoices: { 'tiefling:fiendish-legacy': ['Infernal'] },
    // SRD Fiendish Legacy grants spells and asks which ability casts them.
    featureSpellcasting: { 'tiefling:fiendish-legacy': 'cha' },
    ...over,
  });

const gnome = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  wizard({
    speciesId: 'gnome',
    featureChoices: { 'gnome:gnomish-lineage': ['Forest Gnome'] },
    // The lineage grants a cantrip, and asks which ability casts it.
    featureSpellcasting: { 'gnome:gnomish-lineage': 'int' },
    ...over,
  });

const built = (choices: CharacterChoices): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT, choices, id('ander')), 'create'));

/** The size the folded log says this creature is, with no catalogue in hand. */
const sizeOf = (state: GameState): unknown => state.creatures['ander']?.size;

describe('a species that prints one size', () => {
  it('pins it without asking', () => {
    expect(sizeOf(built(wizard()))).toBe('medium');
  });

  it('pins the one it prints rather than assuming Medium', () => {
    expect(sizeOf(built(gnome()))).toBe('small');
  });

  it('refuses a size the species does not print', () => {
    const result = planCharacter(SRD_CONTENT, wizard({ size: 'Small' }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('bad_size');
  });

  it('accepts the one it prints, stated', () => {
    expect(sizeOf(built(wizard({ size: 'Medium' })))).toBe('medium');
  });
});

describe('a species that prints two sizes', () => {
  it('builds a Medium Human', () => {
    expect(sizeOf(built(human({ size: 'Medium' })))).toBe('medium');
  });

  it('builds a Small Human', () => {
    expect(sizeOf(built(human({ size: 'Small' })))).toBe('small');
  });

  it('builds a Medium Tiefling', () => {
    expect(sizeOf(built(tiefling({ size: 'Medium' })))).toBe('medium');
  });

  it('builds a Small Tiefling', () => {
    expect(sizeOf(built(tiefling({ size: 'Small' })))).toBe('small');
  });

  it('refuses a size neither of them is', () => {
    const result = planCharacter(SRD_CONTENT, human({ size: 'Large' }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('bad_size');
  });

  /**
   * The unstated case, and the one thing here that is a judgement rather than
   * a rule. A character always has a size, so "not yet" is not a state the
   * book allows — but `planCharacter` refusing it would refuse every character
   * ever written against this engine, and the engine has been here before:
   * requiring the Weapon Mastery choice broke a corpus, and the resolution was
   * a warning. So the species' *first* printed size is pinned, which is what
   * every one of those characters has always been placed as, and the plan says
   * out loud that nobody chose it.
   */
  it('pins the first printed size and says nobody chose it', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, human()), 'plan');
    expect(plan.size).toBe('medium');
    expect(plan.warnings.map((one) => one.code)).toContain('size_not_chosen');
    expect(sizeOf(built(human()))).toBe('medium');
  });

  it('says nothing of the kind when the species prints one size', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, wizard()), 'plan');
    expect(plan.warnings.map((one) => one.code)).not.toContain('size_not_chosen');
  });
});

describe('the size a species declares is read as a union, never by name', () => {
  it('refuses a species whose printed size is no size category', () => {
    const content = unwrap(
      extendContent(SRD_CONTENT, {
        species: [
          {
            id: 'colossus-kin',
            name: 'Colossus-kin',
            creatureType: 'Humanoid',
            sizes: ['Titanic'],
            speed: 30,
            features: [],
          },
        ],
      }),
      'content',
    );
    const result = planCharacter(content, wizard({ speciesId: 'colossus-kin' }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unknown_size');
  });

  it('builds a homebrew species at the size it prints', () => {
    const content = unwrap(
      extendContent(SRD_CONTENT, {
        species: [
          {
            id: 'ogrekin',
            name: 'Ogrekin',
            creatureType: 'Giant',
            sizes: ['Large'],
            speed: 30,
            features: [],
          },
        ],
      }),
      'content',
    );
    const events = unwrap(
      createCharacter(content, wizard({ speciesId: 'ogrekin' }), id('ander')),
      'create',
    );
    expect(fold('seed', events).creatures['ander']?.size).toBe('large');
  });
});

describe('the size the species printed reaches the map', () => {
  /**
   * The point of the whole change, in one assertion.
   *
   * `placeCreatureInScene` has read a creature's pinned size since stat blocks
   * started pinning one — "asking a caller for it again is asking a model to
   * state a fact the book already answered" — and a character had none to
   * read, so the only way a Small Halfling stood on a map as Small was a
   * caller *saying* Small. Now the species says it.
   */
  it('without anybody saying, and a stated size still wins', () => {
    const start = unwrap(
      createCharacter(SRD_CONTENT, human({ size: 'Small' }), id('ander')),
      'create',
    );
    const scene: GameEvent[] = [
      ...start,
      { type: 'scene-set', extent: { width: 500, depth: 500, height: 40 } },
      { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
    ];
    const state = fold('seed', scene);

    const placed = fold('seed', [
      ...scene,
      ...unwrap(
        placeCreatureInScene(state, id('ander'), { from: { landmark: 'the gate' }, feet: 0 }),
        'place',
      ),
    ]);
    expect(placed.scene?.sizes['ander']).toBe('small');

    // A table that shrinks or enlarges somebody still outranks the book.
    const enlarged = fold('seed', [
      ...scene,
      ...unwrap(
        placeCreatureInScene(state, id('ander'), {
          from: { landmark: 'the gate' },
          feet: 0,
          size: 'large',
        }),
        'place',
      ),
    ]);
    expect(enlarged.scene?.sizes['ander']).toBe('large');
  });
});

describe('a log that pins no size', () => {
  /**
   * Both frozen fixtures predate the field and `persistence.test.ts` holds
   * them to the states they always folded to. This is the same claim in one
   * line: absent is a state, and it is the state everything written before
   * this change is in.
   */
  it('folds, and says nobody has said', () => {
    const log: GameEvent[] = [
      {
        type: 'creature-added',
        id: id('nobody'),
        name: 'Nobody',
        sheet: {
          level: 1,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 30,
          spellcastingAbility: null,
        },
        maxHp: 8,
      },
    ];
    expect(fold('seed', log).creatures['nobody']?.size).toBeNull();
  });
});

describe('a pinned size outlives the level it was pinned at', () => {
  it('survives an advance', () => {
    const start = unwrap(
      createCharacter(SRD_CONTENT, human({ size: 'Small' }), id('ander')),
      'create',
    );
    const state = fold('seed', start);
    expect(sizeOf(state)).toBe('small');

    const advanced = fold('seed', [
      ...start,
      ...unwrap(
        advanceCharacter(state, SRD_CONTENT, id('ander'), {
          newSpells: ['thunderwave', 'charm-person'],
          preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic'],
          featureChoices: { 'wizard:scholar': ['arcana'] },
          dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
        }),
        'advance',
      ),
    ]);

    expect(advanced.creatures['ander']?.character?.level).toBe(2);
    expect(sizeOf(advanced)).toBe('small');
  });

  it('survives a level taken in a second class', () => {
    const start = unwrap(
      createCharacter(
        SRD_CONTENT,
        human({
          size: 'Small',
          // SRD's multiclassing prerequisite: a Fighter needs Strength 13.
          abilities: {
            method: 'standard-array',
            assignment: { str: 13, dex: 14, con: 12, int: 15, wis: 10, cha: 8 },
          },
        }),
        id('ander'),
      ),
      'create',
    );
    const state = fold('seed', start);

    const advanced = fold('seed', [
      ...start,
      ...unwrap(
        advanceCharacter(state, SRD_CONTENT, id('ander'), {
          classId: 'fighter',
          feats: { 'fighter:fighting-style': { featId: 'defense' } },
          dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
        }),
        'advance',
      ),
    ]);

    expect(advanced.creatures['ander']?.character?.choices.multiclass).toEqual([
      { classId: 'fighter', level: 1 },
    ]);
    expect(sizeOf(advanced)).toBe('small');
  });
});
