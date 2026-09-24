import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import {
  advanceCharacter,
  createCharacter,
  rechooseCharacter,
  restRechoices,
  type CharacterChoices,
} from './creation.js';
import { LONG_REST, SHORT_REST, beginRest, endRest } from './rest.js';
import { dropItem, resolveSpell, unequipItem } from './commands.js';
import { checkContent, READABLE_FEATURE_FIELDS, READABLE_GRANT_KINDS } from './content.js';
import { checkFeatureDefinition } from './feature-schema.js';
import type { FeatureDefinition } from './progression.js';

/**
 * An option re-chosen on a rest.
 *
 * Two printed features and one mechanism. SRD Circle of the Land Spells:
 * "Whenever you finish a Long Rest, choose one type of land: arid, polar,
 * temperate, or tropical … you have the spells listed for your Druid level and
 * lower prepared." SRD Memorize Spell: "Whenever you finish a Short Rest, you
 * can study your spellbook and replace one of the level 1+ Wizard spells you
 * have prepared … with another level 1+ spell from the book."
 *
 * Both are a choice the character made once being made again, so both go
 * through the door a level-up already opened: re-plan the character these
 * choices describe and emit only what differs. What is new is that the rest
 * decides *which* questions it re-asks, and that a rest which did not run its
 * course re-asks none of them.
 */

const id = (s: string) => asCharacterId(s);
const KESSA = id('kessa');
const FENN = id('fenn');

const roller = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
});

const clock = (seconds: number, reason = 'resting'): GameEvent => ({
  type: 'time-advanced',
  seconds,
  reason,
});

const run = (log: readonly GameEvent[], events: readonly GameEvent[]) => {
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

// — a level 5 Evoker, who gains Memorize Spell at 5 ————————————————————————

const BOOK = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'hold-person',
  'thunderwave',
  'charm-person',
  'misty-step',
  'web',
  'fireball',
  'fly',
  'invisibility',
  'counterspell',
];

const book = (level: number): SpellbookEntry[] =>
  BOOK.slice(0, levelGrantedSpells(level)).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));

const kessa = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation', 'mending'],
  spellbook: book(5),
  // Mage Armor is in the book and deliberately *not* prepared: it is what the
  // Short Rest studies in.
  preparedSpells: [
    'magic-missile',
    'shield',
    'hold-person',
    'thunderwave',
    'web',
    'burning-hands',
    'scorching-ray',
    'fireball',
    'fly',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
    'wizard:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['int', 'con'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

// — a level 3 Circle of the Land Druid —————————————————————————————————————

const fenn = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance'],
  spellbook: [],
  preparedSpells: [
    'cure-wounds',
    'charm-person',
    'thunderwave',
    'animal-friendship',
    'healing-word',
    'entangle',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const born = (choices: CharacterChoices, who: CharacterId) =>
  unwrap(createCharacter(SRD_CONTENT, choices, who), 'create') as GameEvent[];

/** Take a rest of `kind` all the way through, with whatever patch is offered. */
const rested = (
  log: readonly GameEvent[],
  who: CharacterId,
  kind: 'short' | 'long',
  options: Record<string, unknown> = {},
) => {
  const begun = run(log, unwrap(beginRest(fold('seed', log), who, kind), 'begin'));
  const waited = run(begun.log, [clock(kind === 'short' ? SHORT_REST : LONG_REST)]);
  return endRest(waited.state, who, options, roller(waited.state));
};

const preparedOf = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.spellcasting?.classes[0]?.prepared ?? [];

/**
 * The land spells this creature holds.
 *
 * A subclass's fixed `spells` grant lands in the class's own prepared list,
 * exactly as Life Domain's does — so the question "which land is this Druid
 * in" is asked of that list, filtered to the twelve spells the four tables
 * print. **And of the cantrips beside it**, because each land's row prints one
 * and a cantrip is known rather than prepared: a granted level 0 spell filed
 * with the prepared ones would be a Fire Bolt resolved as a route that spends
 * a slot.
 */
const LAND_SPELLS = [
  'blur', 'burning-hands', 'fire-bolt',
  'fog-cloud', 'hold-person', 'ray-of-frost',
  'misty-step', 'shocking-grasp', 'sleep',
  'acid-splash', 'ray-of-sickness', 'web',
];

const landOf = (state: GameState, who: CharacterId): readonly string[] =>
  [...preparedOf(state, who), ...(state.creatures[who]?.spellcasting?.classes[0]?.cantrips ?? [])]
    .filter((one) => LAND_SPELLS.includes(one))
    .slice()
    .sort();

describe('Memorize Spell: one prepared spell studied out and another in', () => {
  it('swaps a prepared spell on a Short Rest, and the newcomer can be cast', () => {
    const log = [
      ...born(kessa(), KESSA),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } } as GameEvent,
      { type: 'landmark-added', name: 'the study', at: { x: 100, y: 100, z: 0 } } as GameEvent,
      {
        type: 'creature-placed',
        id: KESSA,
        placement: { from: { landmark: 'the study' }, feet: 0 },
      } as GameEvent,
    ];
    const settled = rested(log, KESSA, 'short', {
      studies: [{ replaces: 'web', prepares: 'mage-armor' }],
    });
    const after = unwrap(settled, 'end rest');
    const state = fold('seed', [
      ...log,
      ...unwrap(beginRest(fold('seed', log), KESSA, 'short'), 'begin'),
      clock(SHORT_REST),
      ...after.events,
    ]);

    expect(preparedOf(state, KESSA)).toContain('mage-armor');
    expect(preparedOf(state, KESSA)).not.toContain('web');

    const cast = unwrap(
      resolveSpell(
        state,
        KESSA,
        { spellId: 'mage-armor', targets: [KESSA], slotLevel: 1 },
        roller(state),
      ),
      'cast the newcomer',
    );
    expect(cast.events.length).toBeGreaterThan(0);
  });

  it('refuses two swaps where the feature offers one', () => {
    const log = born(kessa(), KESSA);
    const refused = rested(log, KESSA, 'short', {
      studies: [
        { replaces: 'web', prepares: 'mage-armor' },
        { replaces: 'shield', prepares: 'feather-fall' },
      ],
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('too_many_studied');
  });

  it('refuses a spell that is not in the book, with a path', () => {
    const log = born(kessa(), KESSA);
    const refused = rested(log, KESSA, 'short', {
      studies: [{ replaces: 'web', prepares: 'wall-of-force' }],
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('spell_not_in_spellbook');
      expect(refused.reason).toContain('preparedSpells');
    }
  });

  it('refuses studying out a spell that is not prepared', () => {
    const log = born(kessa(), KESSA);
    const refused = rested(log, KESSA, 'short', {
      studies: [{ replaces: 'invisibility', prepares: 'mage-armor' }],
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('not_prepared');
  });

  it('refuses a study on a rest that earned nothing', () => {
    const log = born(kessa(), KESSA);
    const begun = run(log, unwrap(beginRest(fold('seed', log), KESSA, 'short'), 'begin'));
    const waited = run(begun.log, [clock(60)]);
    const refused = endRest(
      waited.state,
      KESSA,
      { interrupted: 'a patrol came through', studies: [{ replaces: 'web', prepares: 'mage-armor' }] },
      roller(waited.state),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('rest_rechoice_not_earned');
  });

  it('refuses a study when the caller supplied no world to re-plan against', () => {
    const log = born(kessa(), KESSA);
    const begun = run(log, unwrap(beginRest(fold('seed', log), KESSA, 'short'), 'begin'));
    const waited = run(begun.log, [clock(SHORT_REST)]);
    const refused = endRest(waited.state, KESSA, {
      studies: [{ replaces: 'web', prepares: 'mage-armor' }],
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_content');
  });

  it('keeps the previous answer when the rest is taken in silence', () => {
    const log = born(kessa(), KESSA);
    const settled = unwrap(rested(log, KESSA, 'short'), 'end rest');
    const state = fold('seed', [
      ...log,
      ...unwrap(beginRest(fold('seed', log), KESSA, 'short'), 'begin'),
      clock(SHORT_REST),
      ...settled.events,
    ]);
    expect(preparedOf(state, KESSA)).toContain('web');
    expect(preparedOf(state, KESSA)).not.toContain('mage-armor');
    expect(settled.events.some((e) => e.type === 'character-advanced')).toBe(false);
  });
});

describe('Circle of the Land Spells: a type of land chosen on a Long Rest', () => {
  it('prepares the land the Long Rest chose, and a level-up afterwards keeps it', () => {
    const log = born(fenn(), FENN);
    const before = fold('seed', log);
    expect(landOf(before, FENN)).toEqual([]);

    const begun = run(log, unwrap(beginRest(before, FENN, 'long'), 'begin'));
    const waited = run(begun.log, [clock(LONG_REST)]);
    const settled = unwrap(
      endRest(
        waited.state,
        FENN,
        { choosesAgain: { 'circle-of-the-land:spells': ['Arid'] } },
        roller(waited.state),
      ),
      'end rest',
    );
    const after = run(waited.log, settled.events);

    expect(landOf(after.state, FENN)).toEqual([
      'blur',
      'burning-hands',
      'fire-bolt',
    ]);

    const levelled = run(
      after.log,
      unwrap(
        advanceCharacter(after.state, SRD_CONTENT, FENN, {
          preparedSpells: [...fenn().preparedSpells, 'faerie-fire'],
          cantrips: [...fenn().cantrips, 'druidcraft'],
          feats: {
            ...fenn().feats,
            'druid:ability-score-improvement': {
              featId: 'ability-score-improvement',
              abilities: ['wis', 'con'],
            },
          },
        }),
        'level up',
      ),
    );
    expect(landOf(levelled.state, FENN)).toEqual([
      'blur',
      'burning-hands',
      'fire-bolt',
    ]);
  });

  it('re-chooses on the next Long Rest, and the old land goes with it', () => {
    const log = born(fenn({ featureChoices: { ...fenn().featureChoices, 'circle-of-the-land:spells': ['Arid'] } }), FENN);
    const settled = unwrap(
      rested(log, FENN, 'long', { choosesAgain: { 'circle-of-the-land:spells': ['Polar'] } }),
      'end rest',
    );
    const state = fold('seed', [
      ...log,
      ...unwrap(beginRest(fold('seed', log), FENN, 'long'), 'begin'),
      clock(LONG_REST),
      ...settled.events,
    ]);
    expect(landOf(state, FENN)).toEqual([
      'fog-cloud',
      'hold-person',
      'ray-of-frost',
    ]);
  });

  it('refuses a land the feature does not offer, with a path', () => {
    const log = born(fenn(), FENN);
    const refused = rested(log, FENN, 'long', {
      choosesAgain: { 'circle-of-the-land:spells': ['Volcanic'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('option_not_offered');
      expect(refused.reason).toContain('featureChoices');
    }
  });

  it('refuses a Long-Rest choice on a Long Rest broken down to a Short one', () => {
    const log = born(fenn(), FENN);
    const begun = run(log, unwrap(beginRest(fold('seed', log), FENN, 'long'), 'begin'));
    const waited = run(begun.log, [clock(SHORT_REST + 60)]);
    const refused = endRest(
      waited.state,
      FENN,
      {
        interrupted: 'an hour of hard walking',
        choosesAgain: { 'circle-of-the-land:spells': ['Arid'] },
      },
      roller(waited.state),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('rest_rechoice_not_earned');
  });

  it('refuses a choice offered for a feature the creature does not hold', () => {
    const log = born(kessa(), KESSA);
    const refused = rested(log, KESSA, 'short', {
      choosesAgain: { 'circle-of-the-land:spells': ['Arid'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_rechoice');
  });
});

describe('rechooseCharacter, the door both the rest and the level-up go through', () => {
  /**
   * What is worn is live state, and a re-plan is checked against the inventory
   * the creature is holding — so a stored `equipped` nobody refreshed refuses
   * the character it describes. `advanceCharacter` has always refreshed it;
   * a rest has to as well, or a Druid who put a shield down could never choose
   * a land again.
   */
  it('re-plans against what the creature is wearing now, not what it was born in', () => {
    const log: GameEvent[] = [
      ...born(fenn({ equipped: ['shield'] }), FENN),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the grove', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: FENN, placement: { from: { landmark: 'the grove' }, feet: 0 } },
    ];
    const worn = fold('seed', log).creatures[FENN]!.equipped[0]!.id;

    const stripped = run(
      log,
      unwrap(unequipItem(fold('seed', log), SRD_CONTENT, FENN, worn), 'unequip'),
    );
    const dropped = run(
      stripped.log,
      unwrap(dropItem(stripped.state, SRD_CONTENT, FENN, { item: worn }), 'drop'),
    );

    const settled = unwrap(
      rested(dropped.log, FENN, 'long', {
        choosesAgain: { 'circle-of-the-land:spells': ['Arid'] },
      }),
      'end rest',
    );
    const after = fold('seed', [
      ...dropped.log,
      ...unwrap(beginRest(dropped.state, FENN, 'long'), 'begin'),
      clock(LONG_REST),
      ...settled.events,
    ]);
    expect(landOf(after, FENN)).toEqual(['blur', 'burning-hands', 'fire-bolt']);
    // And the record the re-choice wrote says what is worn now.
    expect(after.creatures[FENN]?.character?.choices.equipped).not.toContain(worn);
  });

  it('emits nothing for a patch that changes nothing', () => {
    const choices = fenn({
      featureChoices: { ...fenn().featureChoices, 'circle-of-the-land:spells': ['Arid'] },
    });
    const state = fold('seed', born(choices, FENN));
    const again = unwrap(
      rechooseCharacter(state, SRD_CONTENT, FENN, {
        featureChoices: { 'circle-of-the-land:spells': ['Arid'] },
      }),
      'identical patch',
    );
    expect(again).toEqual([]);
  });

  it('refuses a patch naming anything a rest may not change', () => {
    const state = fold('seed', born(fenn(), FENN));
    const refused = rechooseCharacter(state, SRD_CONTENT, FENN, {
      level: 4,
    } as unknown as Parameters<typeof rechooseCharacter>[3]);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('not_rechosen');
  });

  it('folds the same twice from the same log', () => {
    const log = born(fenn(), FENN);
    const begun = run(log, unwrap(beginRest(fold('seed', log), FENN, 'long'), 'begin'));
    const waited = run(begun.log, [clock(LONG_REST)]);
    const settled = unwrap(
      endRest(
        waited.state,
        FENN,
        { choosesAgain: { 'circle-of-the-land:spells': ['Temperate'] } },
        roller(waited.state),
      ),
      'end rest',
    );
    const whole = [...waited.log, ...settled.events];
    expect(JSON.stringify(fold('seed', whole))).toEqual(JSON.stringify(fold('seed', whole)));
    expect(landOf(fold('seed', whole), FENN)).toEqual([
      'misty-step',
      'shocking-grasp',
      'sleep',
    ]);
  });
});

/**
 * The validator's half, which is what stops a homebrew feature compiling a
 * question nobody could ever answer.
 *
 * Every branch here is a `checkFeatureDefinition` problem rather than an
 * `err`, so `refusal-sweep.test.ts` cannot see it: a rule nothing asserts is a
 * rule that passes while the branch goes unread.
 */
describe('a question re-asked on a rest is held to two things', () => {
  const codes = (grants: unknown, choice?: unknown): string[] =>
    checkFeatureDefinition(
      {
        id: 'wizard:a-homebrew-rest-question',
        name: 'A Homebrew Rest Question',
        level: 3,
        automation: 'engine',
        note: 'A question re-asked on a rest, written by somebody other than the SRD, so the validator has something to judge.',
        grants,
        ...(choice === undefined ? {} : { choice }),
      } as unknown as FeatureDefinition,
      {
        levels: 20,
        readableGrants: READABLE_GRANT_KINDS,
        readableFields: READABLE_FEATURE_FIELDS,
        spellExists: () => true,
      },
    ).map((problem) => problem.code);

  it('takes a rest that is one of the two the game has', () => {
    expect(
      codes({
        kind: 'rechosen-on-a-rest',
        rest: 'fortnightly',
        rechooses: { kind: 'prepared-spells', swap: 1 },
      }),
    ).toContain('bad_rest_kind');
  });

  it('refuses re-asking a choice on a feature that asks none', () => {
    expect(
      codes({
        kind: 'rechosen-on-a-rest',
        rest: 'long',
        rechooses: { kind: 'this-features-choice' },
      }),
    ).toContain('rechooses_nothing');
    // And accepts it on one that does, so the rule is not simply always on.
    expect(
      codes(
        { kind: 'rechosen-on-a-rest', rest: 'long', rechooses: { kind: 'this-features-choice' } },
        { kind: 'option', choose: 1, from: ['Arid', 'Polar'] },
      ),
    ).toEqual([]);
  });

  it('refuses a swap of no spells at all, and a third kind of re-choice', () => {
    expect(
      codes({
        kind: 'rechosen-on-a-rest',
        rest: 'short',
        rechooses: { kind: 'prepared-spells', swap: 0 },
      }),
    ).toContain('rechooses_nothing');
    expect(
      codes({ kind: 'rechosen-on-a-rest', rest: 'short', rechooses: { kind: 'your-name' } }),
    ).toContain('rechooses_nothing');
  });

  /**
   * And the mark's own three rules, which are the same sentence read off a
   * `spells` grant instead of off a grant of its own.
   */
  it('holds a re-chosen grant to one spell, a rest, a list and a ceiling', () => {
    const well = {
      kind: 'spells',
      fixed: ['prestidigitation'],
      rechosenOn: { rest: 'long', fromClass: 'wizard', maxLevel: 0 },
    };
    expect(codes(well)).toEqual([]);
    expect(codes({ ...well, fixed: ['prestidigitation', 'mending'] })).toContain(
      'rechooses_nothing',
    );
    expect(codes({ ...well, rechosenOn: { ...well.rechosenOn, fromClass: '' } })).toContain(
      'rechooses_nothing',
    );
    expect(codes({ ...well, rechosenOn: { ...well.rechosenOn, rest: 'nightly' } })).toContain(
      'bad_rest_kind',
    );
    expect(codes({ ...well, rechosenOn: { ...well.rechosenOn, maxLevel: 10 } })).toContain(
      'bad_rechosen_level',
    );
    expect(codes({ ...well, rechosenOn: { ...well.rechosenOn, maxLevel: -1 } })).toContain(
      'bad_rechosen_level',
    );
  });
});

// — a High Elf, whose cantrip is granted and may be swapped for another ——————

/**
 * SRD Elven Lineage, High Elf: "You know the Prestidigitation cantrip.
 * Whenever you finish a Long Rest, you can replace that cantrip with a
 * different cantrip from the Wizard spell list."
 *
 * The third printed re-choice, and the first whose answer stands in for
 * something the feature **granted** rather than for something the player
 * picked: the cantrip is on the sheet from level 1 without anybody having
 * chosen it, so what the rest re-asks is which spell that one grant hands
 * over now.
 */
const elf = (lineage: string, over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Wren',
  classId: 'fighter',
  level: 1,
  speciesId: 'elf',
  size: 'Medium',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, dex: 1 },
  classSkills: ['acrobatics', 'animal-handling'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'elf:elven-lineage': [lineage],
    'elf:keen-senses': ['perception'],
  },
  featureSpellcasting: { 'elf:elven-lineage': 'int' },
  feats: {
    'fighter:fighting-style': { featId: 'defense' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const WREN = id('wren');
const THAL = id('thal');

const grantedSpellsOf = (state: GameState, who: CharacterId): readonly string[] =>
  (state.creatures[who]?.spellcasting?.granted ?? [])
    .map((one) => one.spellId)
    .slice()
    .sort();

describe('Elven Lineage: the High Elf cantrip re-chosen on a Long Rest', () => {
  it('offers the swap, replaces the cantrip, and the newcomer can be cast', () => {
    const log: GameEvent[] = [
      ...born(elf('High Elf'), WREN),
      ...born(elf('Wood Elf', { name: 'Thal' }), THAL),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the camp', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: WREN, placement: { from: { landmark: 'the camp' }, feet: 0 } },
      { type: 'creature-placed', id: THAL, placement: { from: { landmark: 'the camp' }, feet: 10 } },
    ];
    expect(grantedSpellsOf(fold('seed', log), WREN)).toContain('prestidigitation');

    // The offer itself, which is what a door prints for the player.
    const offers = restRechoices(SRD_CONTENT, elf('High Elf'));
    expect(offers).toHaveLength(1);
    expect(offers[0]?.feature).toBe('elf:elven-lineage');
    expect(offers[0]?.rest).toBe('long');
    expect(offers[0]?.rechooses).toEqual({
      kind: 'granted-spell',
      granted: 'prestidigitation',
      fromClass: 'wizard',
      maxLevel: 0,
    });

    const settled = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['fire-bolt'] },
    });
    const after = unwrap(settled, 'end rest');
    const state = fold('seed', [
      ...log,
      ...unwrap(beginRest(fold('seed', log), WREN, 'long'), 'begin'),
      clock(LONG_REST),
      ...after.events,
    ]);

    expect(grantedSpellsOf(state, WREN)).toContain('fire-bolt');
    expect(grantedSpellsOf(state, WREN)).not.toContain('prestidigitation');

    const cast = unwrap(
      resolveSpell(state, WREN, { spellId: 'fire-bolt', targets: [THAL] }, roller(state)),
      'cast the newcomer',
    );
    expect(cast.events.length).toBeGreaterThan(0);
  });

  it('refuses a spell that is not a cantrip', () => {
    const log = born(elf('High Elf'), WREN);
    const refused = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['mage-armor'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('spell_level_not_allowed');
  });

  it('refuses a cantrip that is not on the Wizard list', () => {
    const log = born(elf('High Elf'), WREN);
    const refused = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['sacred-flame'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('spell_not_on_class_list');
  });

  it('offers nothing on a Short Rest', () => {
    const log = born(elf('High Elf'), WREN);
    const refused = rested(log, WREN, 'short', {
      choosesAgain: { 'elf:elven-lineage': ['fire-bolt'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('rest_rechoice_not_earned');
  });

  it('offers a Wood Elf nothing at all', () => {
    expect(restRechoices(SRD_CONTENT, elf('Wood Elf'))).toEqual([]);
    const log = born(elf('Wood Elf'), WREN);
    const refused = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['fire-bolt'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_rechoice');
  });
});

/**
 * The rules a replacement is held to that are about the **answer** rather than
 * about the grant.
 *
 * Two of them are `checkCharacter` problems, which `planCharacter` turns into
 * the refusal a rest returns. The third — "a **different** cantrip" — is not a
 * question a set of choices can answer, and the block after this one is where
 * it is asked instead.
 */
describe('a replacement for a granted spell is one spell, from the right list', () => {
  const KEY = 'elf:elven-lineage:prestidigitation';

  it('refuses two spells where the grant prints one', () => {
    const refused = createCharacter(
      SRD_CONTENT,
      elf('High Elf', {
        featureChoices: {
          ...elf('High Elf').featureChoices,
          [KEY]: ['fire-bolt', 'ray-of-frost'],
        },
      }),
      WREN,
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('wrong_rechosen_count');
  });

  it('refuses a High Elf’s answer on a Wood Elf, who was never offered it', () => {
    const refused = createCharacter(
      SRD_CONTENT,
      elf('Wood Elf', {
        featureChoices: { ...elf('Wood Elf').featureChoices, [KEY]: ['fire-bolt'] },
      }),
      WREN,
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('choice_not_asked');
  });
});

/**
 * "A **different** cantrip", asked where both spells are visible.
 *
 * What the answer must differ from is the cantrip the character is holding
 * **now**, and only the rest can see it: a `CharacterChoices` holds what they
 * will be holding afterwards. Asking creation instead compared the answer to
 * the spell the grant *prints*, which refuses a High Elf taking
 * Prestidigitation back and permits replacing Fire Bolt with Fire Bolt.
 */
describe('the list a replacement comes from is held to a class this world has', () => {
  /**
   * The cross-check `checkContent` makes and a definition cannot: a class is
   * another population, so a mark naming one nobody prints validates, compiles
   * and refuses every replacement anybody offers — at the rest rather than
   * here, and reading as the trait simply not working.
   *
   * A `ContentProblem` rather than an `err`, so `refusal-sweep.test.ts` cannot
   * see it and this is the only thing that does.
   */
  const rewritten = (fromClass: string): readonly string[] => {
    const species = JSON.parse(
      JSON.stringify(SRD_CONTENT.species.find((one) => one.id === 'elf')),
    ) as { features: { id: string; grants: Record<string, unknown>[] }[] };
    const feature = species.features.find((one) => one.id === 'elf:elven-lineage')!;
    const at = feature.grants.findIndex((one) => one['rechosenOn'] !== undefined);
    feature.grants[at] = {
      ...feature.grants[at],
      rechosenOn: { ...(feature.grants[at]!['rechosenOn'] as object), fromClass },
    };
    return checkContent({
      species: [species as never],
      classes: SRD_CONTENT.classes as never,
      spells: SRD_CONTENT.spells as never,
    }).map((problem) => problem.code);
  };

  it('accepts the Wizard list the trait names', () => {
    expect(rewritten('wizard')).toEqual([]);
  });

  it('refuses a list no class in this world prints', () => {
    expect(rewritten('illusionist')).toContain('unknown_rechoice_list');
  });
});

describe('a swap is to a different cantrip than the one standing', () => {
  const KEY = 'elf:elven-lineage:prestidigitation';

  it('refuses naming the printed cantrip when nothing has replaced it', () => {
    const log = born(elf('High Elf'), WREN);
    const refused = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['prestidigitation'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('spell_not_replaced');
  });

  it('refuses naming the cantrip a previous swap already stands on', () => {
    const log = born(
      elf('High Elf', {
        featureChoices: { ...elf('High Elf').featureChoices, [KEY]: ['fire-bolt'] },
      }),
      WREN,
    );
    const refused = rested(log, WREN, 'long', {
      choosesAgain: { 'elf:elven-lineage': ['fire-bolt'] },
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('spell_not_replaced');
  });

  /** And the other direction, which the printed-spell reading refused: back again. */
  it('lets an Elf who swapped take Prestidigitation back', () => {
    const log = born(
      elf('High Elf', {
        featureChoices: { ...elf('High Elf').featureChoices, [KEY]: ['fire-bolt'] },
      }),
      WREN,
    );
    const settled = unwrap(
      rested(log, WREN, 'long', { choosesAgain: { 'elf:elven-lineage': ['prestidigitation'] } }),
      'back again',
    );
    const state = fold('seed', [
      ...log,
      ...unwrap(beginRest(fold('seed', log), WREN, 'long'), 'begin'),
      clock(LONG_REST),
      ...settled.events,
    ]);
    expect(grantedSpellsOf(state, WREN)).toContain('prestidigitation');
    expect(grantedSpellsOf(state, WREN)).not.toContain('fire-bolt');
  });
});
