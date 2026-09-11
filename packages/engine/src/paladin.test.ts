import { describe, expect, it } from 'vitest';
import { classCasting, type SpellcastingState } from './spellcasting.js';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, proficiencyBonusForLevel } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { slotsAt } from './progression.js';
import { highestSlotLevel } from './spellbook.js';
import { OATH_OF_DEVOTION, PALADIN } from './paladin.js';
import { WIZARD } from './wizard.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * The first half-caster, and the first caster with no cantrips.
 *
 * "Half-caster" turns out to need no machinery: the class table already held
 * slots per level, and a Paladin's rows are simply shorter and grow slower.
 * What it *does* test is that nothing assumed nine slot levels.
 *
 * The cantrip gap is the more interesting one. SRD's Paladin table has a
 * Prepared Spells column and **no Cantrips column**, so `cantripsKnown` is
 * absent rather than zero — the same absent-versus-zero distinction the
 * Fighter needed, now earning its keep a second time for a class that casts
 * but casts no cantrips.
 *
 * One rules note worth pinning: **2024 moved Paladin spellcasting to level 1**.
 * The 2014 Paladin cast from level 2, which is the version most tables
 * remember, and getting it wrong would give a level 1 Paladin no slots at all.
 */

const id = (s: string) => asCharacterId(s);
const AELRIC = id('aelric');

const paladin = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Aelric',
  classId: 'paladin',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  subclassId: 'oath-of-devotion',
  // A Paladin has no cantrips at all.
  cantrips: [],
  spellbook: [],
  // A level 3 Paladin prepares 4, from the Paladin list.
  preparedSpells: ['bless', 'cure-wounds', 'heroism', 'searing-smite'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail', 'shield'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'paladin:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** The paladin half of the sheet, which is the only half this class has. */
const casting = (plan: { spellcasting: SpellcastingState }) =>
  classCasting(plan.spellcasting, 'paladin')!;

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(paladin(over), AELRIC), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(paladin(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Paladin table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of PALADIN.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(PALADIN.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('never takes a spell slot away as levels rise', () => {
    for (let i = 1; i < PALADIN.table.length; i += 1) {
      const before = PALADIN.table[i - 1]?.spellSlots ?? [];
      const after = PALADIN.table[i]?.spellSlots ?? [];
      for (let level = 0; level < before.length; level += 1) {
        expect(after[level] ?? 0).toBeGreaterThanOrEqual(before[level] ?? 0);
      }
    }
  });

  /** Half-caster: the table stops at level 5, where a Wizard's reaches 9. */
  it('tops out at level 5 slots where a full caster reaches 9', () => {
    expect(highestSlotLevel(slotsAt(PALADIN, 20))).toBe(5);
    expect(highestSlotLevel(slotsAt(WIZARD, 20))).toBe(9);
  });

  /** And grows at half the rate: a level 5 Paladin has what a level 3 Wizard has. */
  it('gains slot levels at half a full caster’s rate', () => {
    expect(highestSlotLevel(slotsAt(PALADIN, 5))).toBe(2);
    expect(highestSlotLevel(slotsAt(WIZARD, 3))).toBe(2);
    expect(highestSlotLevel(slotsAt(PALADIN, 9))).toBe(3);
    expect(highestSlotLevel(slotsAt(WIZARD, 5))).toBe(3);
  });

  /** SRD 5.2.1: a level 1 Paladin has two level 1 slots. 2014 had none. */
  it('casts from level 1, as 2024 says and 2014 did not', () => {
    expect(PALADIN.spellcasting?.startsAtLevel).toBe(1);
    expect(PALADIN.table[0]?.spellSlots).toEqual([2]);
    expect(PALADIN.table[0]?.preparedSpells).toBe(2);
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...PALADIN.features, ...OATH_OF_DEVOTION.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });
});

describe('a caster with no cantrips', () => {
  /** Absent, not zero. A Paladin does not know zero cantrips. */
  it('has no cantrips column at any level', () => {
    for (const row of PALADIN.table) {
      expect(row.cantripsKnown).toBeUndefined();
    }
  });

  it('refuses a cantrip while still being a caster', () => {
    rejects({ cantrips: ['sacred-flame'] }, 'wrong_cantrip_count');
    // And it is genuinely a caster: it has slots and a prepared list.
    const plan = unwrap(planCharacter(paladin()), 'plan');
    expect(plan.spellSlots).not.toEqual({});
    expect(casting(plan).prepared.length).toBeGreaterThan(0);
  });

  /** Magic Initiate still grants cantrips, because the feat is not the class. */
  it('still casts a feat’s cantrips', () => {
    const plan = unwrap(planCharacter(paladin()), 'plan');
    expect(plan.spellcasting.granted.map((g) => g.spellId)).toContain('mage-hand');
  });
});

describe('a Paladin prepares from the Paladin list', () => {
  it('prepares the number the table prints', () => {
    const plan = unwrap(planCharacter(paladin()), 'plan');
    expect(casting(plan).ability).toBe('cha');
    expect(casting(plan).prepared).toContain('bless');
  });

  it('refuses a spell that is not on the Paladin list', () => {
    rejects(
      { preparedSpells: ['fireball', 'cure-wounds', 'heroism', 'searing-smite'] },
      'spell_not_on_class_list',
    );
  });

  it('refuses a spellbook, which a Paladin has nowhere to put', () => {
    rejects(
      { spellbook: [{ spellId: 'bless', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });

  /** SRD Oath of Devotion Spells: always prepared, over and above the count. */
  it('always has its oath spells prepared', () => {
    const plan = unwrap(planCharacter(paladin()), 'plan');
    expect(casting(plan).prepared).toContain('shield-of-faith');
    expect(casting(plan).prepared).toContain('protection-from-evil-and-good');
    expect(casting(plan).prepared).toHaveLength(6);
  });
});

describe('a Paladin is a creature the rest of the engine accepts', () => {
  it('wears Chain Mail and carries a Shield', () => {
    const sheet = built().creatures.aelric!.sheet;
    expect(sheet.armor?.name).toBe('Chain Mail');
    // Chain Mail is a flat 16 with no Dexterity, plus 2 for the Shield.
    expect(armorClass(sheet)).toBe(18);
  });

  it('takes a Fighting Style, like a Fighter', () => {
    const plan = unwrap(planCharacter(paladin()), 'plan');
    expect(plan.feats).toContain('Defense (paladin:fighting-style)');
  });

  it('has hit points from a d10', () => {
    const plan = unwrap(planCharacter(paladin()), 'plan');
    // Level 3, d10, Constitution 15 (+2): 10 + 6 + 6 + 3×2 = 28.
    expect(plan.hitPointMaximum).toBe(28);
  });

  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
