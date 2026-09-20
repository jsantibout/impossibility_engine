import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { extendContent, type Content } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest } from './rest.js';
import {
  attuneItem,
  attunedItems,
  damageCreature,
  declareCreatureDead,
  endAttunement,
  equipItem,
  loseItems,
  unequipItem,
} from './commands.js';
import { rollModesFor } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A magic item that carries its benefit, and the attunement that switches it on.
 *
 * Three rules from SRD "Magic Items" hold this file together:
 *
 * - **Wearing is not attuning.** A cloak on your shoulders does nothing until
 *   you have attuned to it, and the benefit is conditional on both — which is
 *   why `while worn` and `while attuned` are two requirements evaluated on
 *   every read rather than one flag written down once.
 * - **Attunement costs a Short Rest** "focused on only that item", and a
 *   creature can be attuned to **three** items at once.
 * - **It ends when the item does.** Dying ends it, and so does losing the
 *   item — neither is a command anybody gives, so both are derived.
 *
 * The end-to-end case is an SRD item — the Cloak of Elvenkind — driven through
 * the public API with no engine knowledge of what a cloak is: the grant is
 * data in `@ie/content`, and what the engine pins is whatever the catalogue
 * said at the moment it was put on.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const STRANGER = id('stranger');

const CLOAK = 'cloak-of-elvenkind';

/**
 * A Barbarian with no spellcasting of any kind.
 *
 * The Soldier background rather than the Sage one the other fixtures use,
 * because Sage grants Magic Initiate — and a character who can cast *one*
 * cantrip meets "requires attunement by a spellcaster", which would make the
 * prerequisite below pass for the wrong reason.
 */
const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, str: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: {
    'human:versatile': { featId: 'alert' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create');

/** A creature nobody has said anything about beyond its existing. */
const stranger = (): GameEvent => ({
  type: 'creature-added',
  id: STRANGER,
  name: 'a stranger',
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
  maxHp: 20,
  diesAtZero: false,
});

const given = (who: CharacterId, itemId: string, quantity = 1): GameEvent => ({
  type: 'items-gained',
  id: who,
  items: [{ id: itemId, quantity }],
  source: 'the hoard',
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** Start the Short Rest attuning takes place during. */
const rests = (log: readonly GameEvent[], who: CharacterId = GRUM): readonly GameEvent[] =>
  run(log, (s) => beginRest(s, who, 'short'));

/** The Advantage and Disadvantage reaching a Stealth check right now. */
const stealth = (state: GameState, who: CharacterId = GRUM) =>
  rollModesFor(state, {
    family: 'ability-check',
    roller: who,
    ability: 'dex',
    skill: 'stealth',
  }).modes;

// — the homebrew a refusal needs, which the SRD has one of and this needs four —

const trinket = (
  suffix: string,
  attunement: CatalogueItem['attunement'] | null = {},
): CatalogueItem => ({
  id: `test-trinket-${suffix}`,
  name: `Trinket ${suffix}`,
  kind: 'wondrous',
  weightLb: 0,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  // Null is the item that needs no attunement at all: an absent requirement,
  // which is what every mundane thing in the catalogue has.
  ...(attunement === null ? {} : { attunement }),
});

const TEST_CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, {
    items: [
      trinket('one'),
      trinket('two'),
      trinket('three'),
      trinket('four'),
      trinket('druidic', { byClass: ['druid'] }),
      trinket('arcane', { bySpellcaster: true }),
      trinket('mundane', null),
    ],
  }),
  'test content',
);

/** Owned, worn, and attuned — the whole path, for an item that needs no rules. */
const attunedTo = (
  log: readonly GameEvent[],
  itemId: string,
  content: Content = TEST_CONTENT,
): readonly GameEvent[] => {
  const owned = [...log, given(GRUM, itemId)];
  const resting = fold('seed', owned).creatures.grum?.resting == null ? rests(owned) : owned;
  return run(resting, (s) => attuneItem(s, content, GRUM, itemId));
};

describe('an SRD magic item, end to end through the public API', () => {
  /**
   * SRD Cloak of Elvenkind: "Wondrous Item, Uncommon (requires attunement).
   * While you wear this cloak ... you have Advantage on Dexterity (Stealth)
   * checks."
   */
  it('is a catalogue item that grew a grant and an attunement requirement', () => {
    const cloak = SRD_CONTENT.item(CLOAK);
    expect(cloak?.kind).toBe('wondrous');
    expect(cloak?.attunement).toEqual({});
    expect(cloak?.grants?.[0]?.kind).toBe('standing');
  });

  it('does nothing in the pack, does nothing worn, and works attuned', () => {
    const owned = [...made(), given(GRUM, CLOAK)];
    // Owning is not wearing, and wearing is not attuning.
    expect(stealth(fold('seed', owned))).toEqual([]);

    const worn = run(owned, (s) => equipItem(s, SRD_CONTENT, GRUM, CLOAK));
    expect(stealth(fold('seed', worn))).toEqual([]);

    const attuned = run(rests(worn), (s) => attuneItem(s, SRD_CONTENT, GRUM, CLOAK));
    expect(stealth(fold('seed', attuned))).toEqual([
      { source: 'Cloak of Elvenkind', mode: 'advantage' },
    ]);
    expect(attunedItems(fold('seed', attuned), GRUM)).toEqual([CLOAK]);

    // And off again: the benefit goes with the attunement, the cloak stays worn.
    const ended = run(attuned, (s) => endAttunement(s, SRD_CONTENT, GRUM, CLOAK));
    expect(stealth(fold('seed', ended))).toEqual([]);
    expect(attunedItems(fold('seed', ended), GRUM)).toEqual([]);
    expect(fold('seed', ended).creatures.grum?.equipped.map((held) => held.id)).toContain(CLOAK);
  });

  /**
   * "While you **wear** this cloak" is the other half of the same sentence, and
   * it is a separate requirement: taking the cloak off does not break the
   * attunement, and it does stop the benefit.
   */
  it('stops when the cloak comes off, and the attunement survives', () => {
    const worn = run([...made(), given(GRUM, CLOAK)], (s) =>
      equipItem(s, SRD_CONTENT, GRUM, CLOAK),
    );
    const attuned = run(rests(worn), (s) => attuneItem(s, SRD_CONTENT, GRUM, CLOAK));
    const stowed = run(attuned, (s) => unequipItem(s, SRD_CONTENT, GRUM, CLOAK));

    expect(stealth(fold('seed', stowed))).toEqual([]);
    expect(attunedItems(fold('seed', stowed), GRUM)).toEqual([CLOAK]);

    // Put it back on and the benefit is there again, with nothing re-attuned.
    const again = run(stowed, (s) => equipItem(s, SRD_CONTENT, GRUM, CLOAK));
    expect(stealth(fold('seed', again))).toHaveLength(1);
  });
});

describe('the rules attunement is bounded by, each refused as a value', () => {
  /** SRD: "You can be attuned to no more than three magic items at a time." */
  it('refuses a fourth attunement, naming the limit', () => {
    let log: readonly GameEvent[] = made();
    for (const suffix of ['one', 'two', 'three']) log = attunedTo(log, `test-trinket-${suffix}`);
    expect(attunedItems(fold('seed', log), GRUM)).toHaveLength(3);

    const fourth = attuneItem(
      fold('seed', [...log, given(GRUM, 'test-trinket-four')]),
      TEST_CONTENT,
      GRUM,
      'test-trinket-four',
    );
    expect(isErr(fourth) ? fourth.code : 'ok').toBe('attunement_limit');
    expect(isErr(fourth) ? fourth.reason : '').toContain('three');
    expect(isNeedsContext(fourth)).toBe(false);
  });

  /** SRD: "requires attunement by a [class]". */
  it('refuses an item whose class prerequisite the creature does not meet', () => {
    const log = rests([...made(), given(GRUM, 'test-trinket-druidic')]);
    const out = attuneItem(fold('seed', log), TEST_CONTENT, GRUM, 'test-trinket-druidic');
    expect(isErr(out) ? out.code : 'ok').toBe('prerequisite_unmet');
    expect(isErr(out) ? out.reason : '').toContain('druid');
  });

  /** SRD: "requires attunement by a spellcaster". */
  it('refuses a spellcaster item for a character who casts nothing', () => {
    const log = rests([...made(), given(GRUM, 'test-trinket-arcane')]);
    const out = attuneItem(fold('seed', log), TEST_CONTENT, GRUM, 'test-trinket-arcane');
    expect(isErr(out) ? out.code : 'ok').toBe('prerequisite_unmet');
    expect(isNeedsContext(out)).toBe(false);
  });

  /**
   * And the other half of the distinction: a creature nobody has said anything
   * about is not a non-spellcaster, it is an unanswered question.
   */
  it('asks rather than refuses when nobody has said whether the creature casts', () => {
    const log = rests([stranger(), given(STRANGER, 'test-trinket-arcane')], STRANGER);
    const out = attuneItem(fold('seed', log), TEST_CONTENT, STRANGER, 'test-trinket-arcane');
    expect(isNeedsContext(out)).toBe(true);
    expect(isErr(out) ? out.code : 'ok').toBe('unknown_spellcasting');
    // The command that would settle it is named in the **prose**, and the
    // refusal carries no `ContextRequest` at all. That is the one place in the
    // engine where a command-level `needs-context` does not: a request's
    // `kind` is the name of a declared-not-derived fact that has a door, and
    // no kind names "what this creature casts" — `declareSpellcasting` writes
    // a spell list and a save DC ability, which no tool surface offers. It
    // used to be tagged `creature`, which answered the question with the
    // commands that *create* a creature. The argument is beside the refusal in
    // `commands/inventory.ts`; the gap is recorded in `doors.test.ts`.
    expect(isErr(out) ? (out.requests ?? []) : []).toEqual([]);
    expect(isErr(out) ? out.reason : '').toContain('declareSpellcasting');
    expect(isErr(out) ? out.reason : '').toContain(STRANGER);
  });

  /** SRD: attuning "requires a Short Rest focused on only that item". */
  it('refuses to attune outside a rest', () => {
    const log = [...made(), given(GRUM, 'test-trinket-one')];
    const out = attuneItem(fold('seed', log), TEST_CONTENT, GRUM, 'test-trinket-one');
    expect(isErr(out) ? out.code : 'ok').toBe('not_resting');
    expect(isErr(out) ? out.reason : '').toContain('Short Rest');
  });

  it('refuses an item you do not have, and one that needs no attunement', () => {
    const resting = rests(made());
    const missing = attuneItem(fold('seed', resting), TEST_CONTENT, GRUM, 'test-trinket-one');
    expect(isErr(missing) ? missing.code : 'ok').toBe('not_owned');

    const mundane = attuneItem(
      fold('seed', [...resting, given(GRUM, 'test-trinket-mundane')]),
      TEST_CONTENT,
      GRUM,
      'test-trinket-mundane',
    );
    expect(isErr(mundane) ? mundane.code : 'ok').toBe('no_attunement');
  });

  /**
   * SRD: "An interrupted Short Rest confers no benefits", and an hour that
   * broke off is not an hour spent focused on anything.
   */
  it('refuses to attune during a rest something has already broken', () => {
    const resting = rests([...made(), given(GRUM, 'test-trinket-one')]);
    const hurt = run(resting, (s) => damageCreature(s, GRUM, { amount: 4, source: 'a crossbow' }));
    const out = attuneItem(fold('seed', hurt), TEST_CONTENT, GRUM, 'test-trinket-one');
    expect(isErr(out) ? out.code : 'ok').toBe('rest_interrupted');
  });

  it('refuses a second attunement to the item it is already attuned to', () => {
    const log = attunedTo(made(), 'test-trinket-one');
    const again = attuneItem(fold('seed', log), TEST_CONTENT, GRUM, 'test-trinket-one');
    expect(isErr(again) ? again.code : 'ok').toBe('already_attuned');
  });

  it('refuses to end an attunement nobody has', () => {
    const out = endAttunement(fold('seed', made()), TEST_CONTENT, GRUM, 'test-trinket-one');
    expect(isErr(out) ? out.code : 'ok').toBe('not_attuned');
  });

  it('asks rather than refuses for a creature nobody has added', () => {
    const resting = fold('seed', made());
    for (const out of [
      attuneItem(resting, TEST_CONTENT, STRANGER, 'test-trinket-one'),
      endAttunement(resting, TEST_CONTENT, STRANGER, 'test-trinket-one'),
    ]) {
      expect(isNeedsContext(out)).toBe(true);
    }
  });
});

describe('what ends an attunement that nobody ends', () => {
  it('ends on death', () => {
    const log = attunedTo(made(), 'test-trinket-one');
    expect(attunedItems(fold('seed', log), GRUM)).toHaveLength(1);

    const dead = run(log, (s) => declareCreatureDead(s, GRUM, 'a rockfall'));
    expect(attunedItems(fold('seed', dead), GRUM)).toEqual([]);
  });

  it('ends when the item is gone', () => {
    const log = attunedTo(made(), 'test-trinket-one');
    const stolen = run(log, (s) =>
      loseItems(s, GRUM, [{ id: 'test-trinket-one', quantity: 1 }], 'a thief in the night'),
    );
    expect(attunedItems(fold('seed', stolen), GRUM)).toEqual([]);
  });
});

describe('what an item grants is pinned, so the fold opens no catalogue', () => {
  it('carries the grants on the equip event, and folds without content', () => {
    const worn = run([...made(), given(GRUM, CLOAK)], (s) =>
      equipItem(s, SRD_CONTENT, GRUM, CLOAK),
    );
    const equipped = worn.find((event) => event.type === 'item-equipped' && event.item === CLOAK);
    expect(equipped).toBeDefined();
    expect(
      equipped !== undefined && 'grants' in equipped ? equipped.grants?.length : 0,
    ).toBe(1);

    const attuned = run(rests(worn), (s) => attuneItem(s, SRD_CONTENT, GRUM, CLOAK));
    // The claim itself: the same log, folded with no content at all, is the
    // same state — and still knows the cloak grants Advantage on Stealth.
    expect(fold('seed', attuned)).toStrictEqual(fold('seed', attuned, SRD_CONTENT));
    expect(stealth(fold('seed', attuned))).toHaveLength(1);
  });
});
