import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type Skill } from '@ie/shared';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  fold,
  type AdvanceChoices,
  type CharacterChoices,
  type FeatChoice,
  type GameEvent,
  type SpellbookEntry,
} from '@ie/engine';

/**
 * Every level a class table prints Ability Score Improvement on, and the
 * points landing on a folded sheet.
 *
 * `advancement-features.test.ts` proves the *door*: the feature grants a feat,
 * the feat asks which scores, and the arithmetic refuses a 21. What it could
 * not prove is that the door is opened as many times as the book opens it,
 * because this catalogue held **one** Improvement entry per class where the
 * SRD's tables print four, and six for the Fighter, and five for the Rogue.
 * A Fighter 16 was offered one grant rather than six.
 *
 * ### The levels, read off `packages/srd/raw/classes.md` rather than assumed
 *
 * Each class's Ability Score Improvement paragraph names its own repeats in
 * one sentence, and ten of the twelve say the same thing:
 *
 * | Class | SRD sentence | Levels |
 * |---|---|---|
 * | the other ten | "again at … levels 8, 12, and 16" | 4, 8, 12, 16 |
 * | Fighter | "again at Fighter levels 6, 8, 12, 14, and 16" | 4, 6, 8, 12, 14, 16 |
 * | Rogue | "again at Rogue levels 8, 10, 12, and 16" | 4, 8, 10, 12, 16 |
 *
 * {@link ASI_LEVELS} is that table typed, written out by hand from the book —
 * a fixture derived from the catalogue under test would agree with it by
 * construction, which is `blocked-on.test.ts`'s rule and the reason this list
 * is not `features.filter(...)`. The first assertion below holds the
 * catalogue to it.
 *
 * ### The ids
 *
 * The first is the class's plain `:ability-score-improvement` and the repeats
 * carry an ordinal in level order — `-2`, `-3`, … — which is not invented
 * here: `packages/engine/fixtures/golden-log-2.json`,
 * `make-golden-log-2.ts` and six engine test files already name
 * `fighter:ability-score-improvement-2` and its neighbours. Those fixtures
 * named ids this catalogue did not publish; the keys were simply ignored.
 * They resolve now.
 */
const ASI_LEVELS: Readonly<Record<string, readonly number[]>> = {
  barbarian: [4, 8, 12, 16],
  bard: [4, 8, 12, 16],
  cleric: [4, 8, 12, 16],
  druid: [4, 8, 12, 16],
  fighter: [4, 6, 8, 12, 14, 16],
  monk: [4, 8, 12, 16],
  paladin: [4, 8, 12, 16],
  ranger: [4, 8, 12, 16],
  rogue: [4, 8, 10, 12, 16],
  sorcerer: [4, 8, 12, 16],
  warlock: [4, 8, 12, 16],
  wizard: [4, 8, 12, 16],
};

const CLASSES: readonly string[] = Object.keys(ASI_LEVELS);

/** The Improvement ids a class publishes, in the order its table prints them. */
const improvementIds = (classId: string): readonly string[] =>
  (ASI_LEVELS[classId] ?? []).map((_, index) =>
    index === 0
      ? `${classId}:ability-score-improvement`
      : `${classId}:ability-score-improvement-${index + 1}`,
  );

const definitionOf = (classId: string) => {
  const found = SRD_CONTENT.classById(classId);
  if (found === undefined || found === null) throw new Error(`no class ${classId}`);
  return found;
};

const rowAt = (classId: string, level: number) => definitionOf(classId).table[level - 1];

const subclassFor = (classId: string): string => {
  const found = SRD_CONTENT.subclasses.find((one) => one.classId === classId);
  if (found === undefined) throw new Error(`no subclass for ${classId}`);
  return found.id;
};

/** Spell ids of one level on one class's list, in a stable order. */
const spellsOn = (classId: string, spellLevel: number): readonly string[] =>
  SRD_CONTENT.spellEntries
    .filter((entry) => entry.level === spellLevel && entry.classes.includes(classId))
    .map((entry) => entry.id)
    .sort();

/** Spells of levels 1..top on a class's list, lowest level first. */
const preparableOn = (classId: string, top: number): readonly string[] =>
  Array.from({ length: top }, (_, index) => spellsOn(classId, index + 1)).flat();

/** The Improvement feat, with the scores the player put its points into. */
const improving = (abilities: readonly string[]): FeatChoice => ({
  featId: 'ability-score-improvement',
  abilities,
});

/**
 * The featureChoices each class asks for up to the level this file drives it
 * to, answered — everything that is not the Improvement under test.
 *
 * Hand-written rather than derived for the same reason {@link ASI_LEVELS} is:
 * a fixture that reads the question off the definition and answers it with
 * the first legal option cannot fail when the question changes.
 */
const FEATURE_CHOICES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  barbarian: { 'barbarian:primal-knowledge': ['nature'] },
  bard: {
    'bard:expertise': ['performance', 'persuasion'],
    'college-of-lore:bonus-proficiencies': ['arcana', 'history', 'insight'],
  },
  cleric: { 'cleric:divine-order': ['Protector'] },
  druid: { 'druid:primal-order': ['Magician'], 'druid:primal-order:cantrip': ['mending'] },
  fighter: {},
  monk: {},
  paladin: {},
  ranger: { 'ranger:deft-explorer': ['athletics'], 'hunter:hunters-prey': ['Colossus Slayer'] },
  rogue: {
    'rogue:expertise': ['stealth', 'perception'],
    'rogue:second-expertise': ['acrobatics', 'investigation'],
  },
  sorcerer: { 'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'] },
  warlock: {},
  wizard: {
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['gust-of-wind', 'shatter'],
  },
};

/** The class skills each class picks, sized to its own `skillChoices`. */
const CLASS_SKILLS: Readonly<Record<string, readonly Skill[]>> = {
  barbarian: ['athletics', 'survival'],
  bard: ['deception', 'performance', 'persuasion'],
  cleric: ['medicine', 'religion'],
  druid: ['medicine', 'nature'],
  fighter: ['athletics', 'intimidation'],
  monk: ['acrobatics', 'stealth'],
  paladin: ['athletics', 'persuasion'],
  ranger: ['athletics', 'perception', 'survival'],
  rogue: ['stealth', 'perception', 'acrobatics', 'investigation'],
  sorcerer: ['arcana', 'persuasion'],
  warlock: ['arcana', 'deception'],
  wizard: ['arcana', 'history'],
};

/**
 * A complete character of one class at one level: every question the
 * catalogue asks, answered, with the Improvement slots left to the caller.
 */
const character = (
  classId: string,
  level: number,
  feats: Readonly<Record<string, FeatChoice>> = {},
  over: Partial<CharacterChoices> = {},
): CharacterChoices => {
  const definition = definitionOf(classId);
  const row = rowAt(classId, level);
  const top = row?.spellSlots?.length ?? 0;
  const style = definition.spellcasting?.style;
  const cantrips = spellsOn(classId, 0).slice(0, row?.cantripsKnown ?? 0);
  const bookSize = 6 + Math.max(0, level - 1) * 2;
  const book: readonly SpellbookEntry[] =
    style === 'spellbook'
      ? preparableOn(classId, top)
          .slice(0, bookSize)
          .map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const }))
      : [];
  const prepared =
    style === 'spellbook'
      ? book.map((entry) => entry.spellId).slice(0, row?.preparedSpells ?? 0)
      : preparableOn(classId, top).slice(0, row?.preparedSpells ?? 0);

  return {
    name: 'Vashti',
    classId,
    level,
    ...(level >= definition.subclassLevel ? { subclassId: subclassFor(classId) } : {}),
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: CLASS_SKILLS[classId] ?? [],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips,
    spellbook: book,
    preparedSpells: prepared,
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'], ...(FEATURE_CHOICES[classId] ?? {}) },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...(classId === 'fighter' && level >= 1
        ? { 'fighter:fighting-style': { featId: 'defense' } }
        : {}),
      ...(classId === 'paladin' && level >= 2
        ? { 'paladin:fighting-style': { featId: 'defense' } }
        : {}),
      ...(classId === 'ranger' && level >= 2
        ? { 'ranger:fighting-style': { featId: 'defense' } }
        : {}),
      ...feats,
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    ...over,
  };
};

const WHO = asCharacterId('vashti');

const sheetOf = (log: readonly GameEvent[]) => {
  const creature = fold('seed', log).creatures[WHO];
  if (creature === undefined) throw new Error('no creature');
  return creature.sheet;
};

const created = (choices: CharacterChoices): readonly GameEvent[] => {
  expect(checkCharacter(SRD_CONTENT, choices), choices.classId).toEqual([]);
  return unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'create') as GameEvent[];
};

const levelled = (
  choices: CharacterChoices,
  advance: AdvanceChoices,
): readonly GameEvent[] => {
  const log = created(choices);
  const gained = unwrap(advanceCharacter(fold('seed', log), SRD_CONTENT, WHO, advance), 'advance');
  return [...log, ...gained];
};

/** The advance that carries a class from `level - 1` to `level` unchanged. */
const sameAgain = (classId: string, level: number): AdvanceChoices => {
  const built = character(classId, level);
  return {
    cantrips: built.cantrips,
    preparedSpells: built.preparedSpells,
    ...(built.spellbook.length > 0
      ? { newSpells: built.spellbook.slice(-2).map((entry) => entry.spellId) }
      : {}),
    featureChoices: built.featureChoices,
  };
};

describe('every level a class table prints the Improvement on', () => {
  it('publishes one Improvement feature per printed level, at that level', () => {
    for (const classId of CLASSES) {
      const features = definitionOf(classId).features.filter((feature) =>
        feature.id.startsWith(`${classId}:ability-score-improvement`),
      );
      expect(features.map((one) => one.id), classId).toEqual(improvementIds(classId));
      expect(features.map((one) => one.level), classId).toEqual(ASI_LEVELS[classId]);
    }
  });

  /**
   * And each of them is executed: the feature grants a feat, creation reads
   * the feat's `ability-score-increase`, and nothing is left for a DM.
   */
  it('declares every Improvement and every Epic Boon executed by the engine', () => {
    for (const classId of CLASSES) {
      for (const id of [...improvementIds(classId), `${classId}:epic-boon`]) {
        const feature = definitionOf(classId).features.find((one) => one.id === id);
        expect(feature?.automation, id).toBe('engine');
        expect(feature?.choice?.kind, id).toBe('feat');
      }
    }
  });

  /**
   * The first printed Improvement, for all twelve: a character advanced into
   * the level takes the feat and the two scores they named move by one each
   * on the **folded sheet**, with every other score exactly where it was.
   */
  for (const classId of CLASSES) {
    it(`moves the two scores a level 4 ${classId} names, and no others`, () => {
      const before = sheetOf(created(character(classId, 3)));
      const after = sheetOf(
        levelled(character(classId, 3), {
          ...sameAgain(classId, 4),
          feats: { [`${classId}:ability-score-improvement`]: improving(['wis', 'cha']) },
        }),
      );

      expect(after.level).toBe(4);
      expect(after.abilities.wis).toBe(before.abilities.wis + 1);
      expect(after.abilities.cha).toBe(before.abilities.cha + 1);
      for (const ability of ['str', 'dex', 'con', 'int'] as const) {
        expect(after.abilities[ability], ability).toBe(before.abilities[ability]);
      }
    });
  }
});

describe('a repeat is a second grant, answered on its own', () => {
  /**
   * SRD Fighter: "You gain this feature again at Fighter levels 6, 8, 12, 14,
   * and 16." Two grants by level 6, and the second is the one this catalogue
   * did not offer.
   */
  it('gives a Fighter 6 two Improvements and spends them differently', () => {
    const sheet = sheetOf(
      created(
        character('fighter', 6, {
          'fighter:ability-score-improvement': improving(['str', 'str']),
          'fighter:ability-score-improvement-2': improving(['dex', 'con']),
        }),
      ),
    );

    // 15 assigned and two points from the first grant.
    expect(sheet.abilities.str).toBe(17);
    // 14 and 13+2, each moved by the second grant's one point.
    expect(sheet.abilities.dex).toBe(15);
    expect(sheet.abilities.con).toBe(16);
  });

  it('refuses a Fighter 6 who answered only the first', () => {
    const codes = checkCharacter(
      SRD_CONTENT,
      character('fighter', 6, {
        'fighter:ability-score-improvement': improving(['str', 'str']),
      }),
    );
    expect(codes.map((one) => one.code)).toEqual(['missing_feat_choice']);
    expect(codes[0]?.reason).toContain('fighter:ability-score-improvement-2');
  });

  /**
   * SRD Rogue: "again at Rogue levels 8, 10, 12, and 16" — so a Rogue 10 owes
   * three, and the third is the one only the Rogue's table prints.
   */
  it('gives a Rogue 10 three Improvements, each answered independently', () => {
    const sheet = sheetOf(
      created(
        character('rogue', 10, {
          'rogue:ability-score-improvement': improving(['dex', 'dex']),
          'rogue:ability-score-improvement-2': improving(['wis', 'wis']),
          'rogue:ability-score-improvement-3': improving(['cha', 'cha']),
        }),
      ),
    );

    expect(sheet.abilities.dex).toBe(16);
    expect(sheet.abilities.wis).toBe(12);
    expect(sheet.abilities.cha).toBe(10);
    // And the three were spent apart: no score took more than its own grant.
    expect(sheet.abilities.str).toBe(15);
  });

  it('refuses the Rogue 10 spread the feat does not print', () => {
    expect(
      checkCharacter(
        SRD_CONTENT,
        character('rogue', 10, {
          'rogue:ability-score-improvement': improving(['dex', 'dex']),
          'rogue:ability-score-improvement-2': improving(['wis', 'wis']),
          'rogue:ability-score-improvement-3': improving(['cha']),
        }),
      ).map((one) => one.code),
    ).toEqual(['ability_spread_not_offered']);
  });

  /** And the Rogue's table prints no Improvement at 6 or 14, unlike the Fighter's. */
  it('keeps the two irregular tables apart', () => {
    expect(ASI_LEVELS['fighter']).toContain(6);
    expect(ASI_LEVELS['rogue']).not.toContain(6);
    expect(ASI_LEVELS['rogue']).toContain(10);
    expect(ASI_LEVELS['fighter']).not.toContain(10);
  });
});

describe('the Epic Boon at 19 lifts one score past twenty', () => {
  /**
   * SRD, every Epic Boon: "Increase one ability score of your choice by 1, to
   * a maximum of 30." The ceiling moves for the score the boon named and for
   * no other, on a sheet that folds.
   *
   * A Fighter, because the Fighter's table prints the most Improvements of
   * the twelve — six by level 16 — so a level 19 Fighter is the character
   * with the most advancement slots the SRD offers, and every one of them has
   * to be answered before the boon is even reached.
   */
  const fighterAt19 = (
    boon: readonly string[],
    first: readonly string[] = ['dex', 'dex'],
  ): CharacterChoices =>
    character(
      'fighter',
      19,
      {
        'fighter:ability-score-improvement': improving(first),
        'fighter:ability-score-improvement-2': improving(['dex', 'dex']),
        'fighter:ability-score-improvement-3': improving(['con', 'con']),
        'fighter:ability-score-improvement-4': improving(['con', 'con']),
        'fighter:ability-score-improvement-5': improving(['int', 'wis']),
        'fighter:ability-score-improvement-6': improving(['int', 'wis']),
        'fighter:epic-boon': { featId: 'boon-of-combat-prowess', abilities: boon },
        'champion:additional-fighting-style': { featId: 'archery' },
      },
      {
        abilities: {
          method: 'manual',
          assignment: { str: 20, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
        },
      },
    );

  it('folds a twenty-first point onto the score the boon named', () => {
    const sheet = sheetOf(created(fighterAt19(['str'])));
    expect(sheet.level).toBe(19);
    // 20, which every other score of this character may not pass, and the
    // boon's one point on top of it.
    expect(sheet.abilities.str).toBe(21);
    // Four points of Improvement each, from 8 and from 8 + the background's
    // two, and nothing lifted their ceilings.
    expect(sheet.abilities.dex).toBe(12);
    expect(sheet.abilities.con).toBe(14);
    // Named by nothing, so exactly where the array and the background left it.
    expect(sheet.abilities.cha).toBe(8);
  });

  /**
   * And the ceiling is the boon's own, for the score it named: the same
   * twenty-first point, put there by an Improvement instead, is refused when
   * the boon pointed somewhere else and allowed when it pointed here.
   */
  it('lifts the ceiling only for the score the boon named', () => {
    const codes = (choices: CharacterChoices) =>
      checkCharacter(SRD_CONTENT, choices).map((one) => one.code);

    // The first Improvement puts a point on a Strength of 20, which is 21.
    expect(codes(fighterAt19(['cha'], ['str', 'wis']))).toContain('score_above_maximum');
    // The same 21, with the boon on Strength: its ceiling is 30 now, and the
    // boon's own point makes it 22.
    expect(codes(fighterAt19(['str'], ['str', 'wis']))).not.toContain('score_above_maximum');
    expect(sheetOf(created(fighterAt19(['str'], ['str', 'wis']))).abilities.str).toBe(22);
  });
});
