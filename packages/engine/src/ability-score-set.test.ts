import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { abilityModifier, modifierFor } from './character.js';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { fold, type GameEvent } from './events.js';
import type { GameState } from './state.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { attuneItem, equipItem, unequipItem } from './commands/inventory.js';
import { beginRest } from './rest.js';
import { abilityScoresOf, armorClassOf, sheetAsItStands } from './standing.js';

/**
 * A score an item **sets**, which is a third verb.
 *
 * The engine could raise a score and lift its ceiling, both at creation, and
 * neither says what the SRD says of nine wondrous items: "Your Constitution
 * is 19 while you wear this amulet. It has no effect on you if your
 * Constitution is 19 or higher without it." Three things follow from that one
 * sentence and each is a test below.
 *
 * - **Set, not add.** 8 becomes 19 and 20 stays 20; a raise could say
 *   neither.
 * - **While worn.** It is live when the item is on and gone when it comes
 *   off, which is the lifetime `standing.ts` already insists must be derived
 *   on every read rather than stored — "a stored copy would be an
 *   unconditional bonus wearing a feature's name".
 * - **Everything downstream moves with it.** A score is not a number on its
 *   own; the modifier is what rolls read, so the set has to reach the sheet
 *   the readers are handed rather than a second path beside it.
 *
 * Driven through homebrew items, for `content.test.ts`'s reason and for one
 * more: the SRD items this frees are not in the catalogue yet — see the note
 * at the end of this file — so a test written against them would be testing
 * nothing.
 */

const WHO = asCharacterId('vashti');

/** SRD Gauntlets of Ogre Power, said by an item nobody printed. */
const BRACERS: CatalogueItem = {
  id: 'bracers-of-the-titan',
  name: 'Bracers of the Titan',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'str', score: 19 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/** The same verb on Dexterity, and behind an attunement rather than a strap. */
const CIRCLET: CatalogueItem = {
  id: 'circlet-of-the-cat',
  name: 'Circlet of the Cat',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  attunement: { required: true },
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'dex', score: 18 }],
      requires: [{ kind: 'while-attuned' }],
    },
  ],
};

/** A bigger one of the same family, for the rule about two of them. */
const GREATER: CatalogueItem = {
  ...BRACERS,
  id: 'bracers-of-the-storm-titan',
  name: 'Bracers of the Storm Titan',
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'str', score: 23 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { items: [BRACERS, CIRCLET, GREATER] }),
  'extend',
);

/** A Fighter with a Strength of 8 and a Dexterity of 15, so a set is visible. */
const fighter = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Vashti',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: {
    items: [
      { id: BRACERS.id, quantity: 1 },
      { id: CIRCLET.id, quantity: 1 },
      { id: GREATER.id, quantity: 1 },
    ],
    goldPieces: 0,
    magicItems: [BRACERS.id, CIRCLET.id, GREATER.id],
    note: 'the three under test',
  },
  ...over,
});

/**
 * A character and the log that built them, stepped by hand.
 *
 * The log is carried rather than read off the state, because `GameState` is
 * a fold of events and holds none.
 */
const built = (
  choices: CharacterChoices = fighter(),
  content: Content = CONTENT,
): readonly GameEvent[] => unwrap(createCharacter(content, choices, WHO), 'create') as GameEvent[];

const after = (
  log: readonly GameEvent[],
  step: (state: GameState) => readonly GameEvent[],
): readonly GameEvent[] => [...log, ...step(fold('seed', log))];

const wearing = (...items: readonly string[]): GameState => {
  let log = built();
  for (const id of items) {
    log = after(log, (state) =>
      unwrap(equipItem(state, CONTENT, WHO, id, `equip-${id}`), id),
    );
  }
  return fold('seed', log);
};

/**
 * The same, with the item attuned to rather than worn.
 *
 * SRD: attunement is "a Short Rest spent focused on it", so the rest is part
 * of the path and the command refuses one that skipped it.
 */
const attunedTo = (item: string, log: readonly GameEvent[] = built()): GameState => {
  const resting = after(log, (state) => unwrap(beginRest(state, WHO, 'short'), 'rest'));
  return fold(
    'seed',
    after(resting, (state) =>
      unwrap(attuneItem(state, CONTENT, WHO, item, `attune-${item}`), item),
    ),
  );
};

/** The state a Fighter who owns all three starts in, wearing none of them. */
const start = (): GameState => fold('seed', built());

describe('a score an item sets', () => {
  it('sets it while the item is worn', () => {
    expect(start().creatures[WHO]?.sheet.abilities.str).toBe(10);
    expect(abilityScoresOf(wearing(BRACERS.id), WHO).str).toBe(19);
  });

  it('moves the modifier the score derives, which is what a roll reads', () => {
    const state = wearing(BRACERS.id);
    // 10 is a +0 and 19 is a +4: the set is not a number on its own.
    expect(modifierFor(start().creatures[WHO]!.sheet, 'str')).toBe(0);
    expect(modifierFor(sheetAsItStands(state, WHO), 'str')).toBe(abilityModifier(19));
  });

  it('leaves a score that is already higher exactly where it was', () => {
    // SRD: "It has no effect on you if your Constitution is 19 or higher
    // without it." Dexterity is 15 here and the circlet sets 18, so it
    // applies; on a character whose Dexterity was 20 it would not.
    const tall = built(
      fighter({
        abilities: {
          method: 'manual',
          assignment: { str: 8, dex: 20, con: 13, int: 12, wis: 10, cha: 14 },
        },
      }),
    );
    expect(abilityScoresOf(attunedTo(CIRCLET.id, tall), WHO).dex).toBe(20);
    // And the same circlet on the character whose Dexterity is 15 does set it,
    // so the rule above is the score rather than the item.
    expect(abilityScoresOf(attunedTo(CIRCLET.id), WHO).dex).toBe(18);
  });

  it('is gone the moment the item comes off', () => {
    const on = after(built(), (state) =>
      unwrap(equipItem(state, CONTENT, WHO, BRACERS.id, 'on'), 'equip'),
    );
    expect(abilityScoresOf(fold('seed', on), WHO).str).toBe(19);

    const off = fold(
      'seed',
      after(on, (state) =>
        unwrap(unequipItem(state, CONTENT, WHO, BRACERS.id, 'off'), 'unequip'),
      ),
    );
    expect(abilityScoresOf(off, WHO).str).toBe(10);
    expect(modifierFor(sheetAsItStands(off, WHO), 'str')).toBe(0);
  });

  it('takes the highest of two items that set the same score', () => {
    expect(abilityScoresOf(wearing(BRACERS.id, GREATER.id), WHO).str).toBe(23);
  });

  it('sets nothing for a creature whose attunement the item asks for and has not got', () => {
    // Worn but not attuned: the circlet's own requirement is the attunement.
    expect(abilityScoresOf(wearing(CIRCLET.id), WHO).dex).toBe(15);
  });

  /**
   * The derived reader that already recomputes on a standing change, rather
   * than a second path: Armour Class is Dexterity, and a set Dexterity moves
   * it without `armorClassOf` learning anything new about items.
   */
  it('moves an Armour Class that the score it set is an input to', () => {
    const bare = start();
    expect(armorClassOf(attunedTo(CIRCLET.id), WHO) - armorClassOf(bare, WHO)).toBe(
      abilityModifier(18) - abilityModifier(15),
    );
  });

  /** And the sheet is the same object when nothing is setting anything. */
  it('hands back the creature’s own sheet when no item sets a score', () => {
    const bare = start();
    expect(sheetAsItStands(bare, WHO)).toBe(bare.creatures[WHO]?.sheet);
  });
});

describe('what the vocabulary refuses at the door', () => {
  const codesOf = (effect: unknown): readonly string[] =>
    checkContent({
      items: [
        {
          ...BRACERS,
          grants: [
            { kind: 'standing', reach: 'self', effects: [effect], requires: [{ kind: 'while-worn' }] },
          ],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => problem.code);

  it('accepts the item as written, so the refusals below are not free', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 19 })).toEqual([]);
  });

  it('refuses a set that names something that is not an ability', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'luck', score: 19 })).toContain(
      'bad_ability_set',
    );
  });

  it('refuses a score that is not a score a creature can have', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 0 })).toContain(
      'bad_ability_set',
    );
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 19.5 })).toContain(
      'bad_ability_set',
    );
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 31 })).toContain(
      'bad_ability_set',
    );
  });
});

/**
 * And a homebrew world says the same sentence through the same door.
 */
describe('a homebrew item says it through loadContent', () => {
  it('loads from JSON text and sets the score it was given', () => {
    const loaded = unwrap(
      loadContent(JSON.parse(JSON.stringify({ items: [BRACERS] })) as unknown),
      'load',
    );
    const whole = unwrap(
      extendContent(SRD_CONTENT, { items: [...loaded.items, CIRCLET, GREATER] }),
      'extend',
    );
    const log = built(fighter(), whole);
    const on = fold(
      'seed',
      after(log, (state) =>
        unwrap(equipItem(state, whole, WHO, BRACERS.id, 'equip'), 'equip'),
      ),
    );
    expect(abilityScoresOf(on, WHO).str).toBe(19);
  });
});
