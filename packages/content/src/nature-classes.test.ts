import { describe, expect, it } from 'vitest';
import { BARD, BARDIC_DIE, CIRCLE_OF_THE_LAND, DRUID, FAVORED_ENEMY_USES, PALADIN, RANGER, SRD_CONTENT, WILD_SHAPE_USES } from '@ie/content';
import { classCasting } from '@ie/engine';
import { asCharacterId, isErr, expect as unwrap, type Skill } from '@ie/shared';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { slotsAt } from '@ie/engine';
import { highestSlotLevel } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';
import { canSee, sensesOf } from '@ie/engine';

/**
 * The last three classes, and what completing the set proves.
 *
 * Twelve classes now cover every combination the SRD uses: three spellcasting
 * styles, half-casters and full, casters with cantrips and without, and four
 * classes that cast nothing. The Ranger is the one combination no other class
 * has — a **half-caster that knows rather than prepares** — and it needed
 * nothing new, which is the point of being the twelfth rather than the second.
 *
 * The Bard needed one small thing: SRD's "Choose any 3 skills", where every
 * other class names a list. `SkillChoices.from` became optional, meaning any
 * skill rather than a copy of the whole list — different rules, and only one
 * of them survives the game gaining a skill.
 *
 * Circle of the Land is the one subclass whose grant the engine cannot
 * express, and it says so rather than guessing.
 */

const id = (s: string) => asCharacterId(s);

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
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
};

const bard = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  // "Choose any 3 skills" — including Stealth, which no class list offers here.
  classSkills: ['performance', 'stealth', 'deception'],
  subclassId: 'college-of-lore',
  cantrips: ['vicious-mockery', 'dancing-lights'],
  preparedSpells: ['bane', 'charm-person', 'dissonant-whispers', 'shatter', 'hold-person', 'heroism'],
  featureChoices: {
    'human:skillful': ['perception'],
    'bard:expertise': ['performance', 'stealth'],
    'college-of-lore:bonus-proficiencies': ['acrobatics', 'athletics', 'insight'],
  },
  ...over,
});

const druid = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Fenn',
  classId: 'druid',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['nature', 'survival'],
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance'],
  preparedSpells: ['cure-wounds', 'charm-person', 'thunderwave', 'animal-friendship', 'healing-word', 'hold-person'],
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
  },
  ...over,
});

const ranger = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Sorrel',
  classId: 'ranger',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['survival', 'perception', 'stealth'],
  subclassId: 'hunter',
  cantrips: [],
  preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry'],
  featureChoices: {
    'human:skillful': ['athletics'],
    'ranger:deft-explorer': ['survival'],
    "hunter:hunters-prey": ['Colossus Slayer'],
  },
  feats: {
    ...common.feats,
    'ranger:fighting-style': { featId: 'archery' },
  },
  ...over,
});

const plan = (choices: CharacterChoices) => unwrap(planCharacter(SRD_CONTENT,choices), choices.classId);

const built = (choices: CharacterChoices, who: string): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT,choices, id(who)), 'create') as GameEvent[]);

describe('the Bard', () => {
  /** SRD: D6 at level 1, stepping to D8, D10 and D12 at 5, 10 and 15. */
  it('grows its Bardic Inspiration die at the printed levels', () => {
    expect(BARDIC_DIE[0]).toBe('1d6');
    expect(BARDIC_DIE[4]).toBe('1d8');
    expect(BARDIC_DIE[9]).toBe('1d10');
    expect(BARDIC_DIE[14]).toBe('1d12');
  });

  /** SRD: "Choose any 3 skills", which is not a list. */
  it('chooses any skill at all, where other classes choose from a list', () => {
    expect(BARD.skillChoices.from).toBeUndefined();
    expect(DRUID.skillChoices.from).toBeDefined();
    // Stealth is on no class list here, and a Bard may still take it.
    expect(plan(bard()).sheet.skills.stealth).toBe('expertise');
  });

  /**
   * "Any skill" still means a skill. The cast is deliberate: the type system
   * already refuses this, and the runtime check is what protects a caller
   * that came from JSON rather than from TypeScript.
   */
  it('still refuses something that is not a skill', () => {
    const result = planCharacter(
      SRD_CONTENT,
      bard({ classSkills: ['performance', 'stealth', 'juggling'] as unknown as Skill[] }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unknown_skill');
  });

  it('is a known caster on the full-caster table', () => {
    expect(BARD.spellcasting?.style).toBe('known');
    expect(highestSlotLevel(slotsAt(BARD, 20))).toBe(9);
  });

  /** The subclass grants three more proficiencies, like any skill choice. */
  it('takes College of Lore’s three bonus proficiencies', () => {
    const sheet = plan(bard()).sheet;
    for (const skill of ['acrobatics', 'athletics', 'insight'] as const) {
      expect(sheet.skills[skill]).toBe('proficient');
    }
  });
});

describe('the Druid', () => {
  it('is a prepared-from-list caster, like the Cleric', () => {
    expect(DRUID.spellcasting?.style).toBe('prepared-from-list');
    expect(classCasting(plan(druid()).spellcasting, 'druid')?.ability).toBe('wis');
  });

  /** SRD: no Wild Shape at level 1, two from 2, rising to four at 17. */
  it('has no Wild Shape at level 1 and never loses a use', () => {
    expect(WILD_SHAPE_USES[0]).toBe(0);
    expect(WILD_SHAPE_USES[1]).toBe(2);
    expect(WILD_SHAPE_USES[19]).toBe(4);
    for (let i = 2; i < WILD_SHAPE_USES.length; i += 1) {
      expect(WILD_SHAPE_USES[i] ?? 0).toBeGreaterThanOrEqual(WILD_SHAPE_USES[i - 1] ?? 0);
    }
  });

  it('takes Primal Order as one of two named options', () => {
    const result = planCharacter(
      SRD_CONTENT,
      druid({
        featureChoices: {
          'human:skillful': ['perception'],
          'druid:primal-order': ['Necromancer'],
        },
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('option_not_offered');
  });

  /**
   * The one subclass grant the engine cannot express. SRD: "Whenever you
   * finish a Long Rest, choose one type of land" — so the spells are neither
   * fixed nor chosen once at creation, and the feature grants nothing rather
   * than picking a land for the player.
   */
  it('grants no Circle spells, and says why', () => {
    const spells = CIRCLE_OF_THE_LAND.features.find((f) => f.id === 'circle-of-the-land:spells');
    expect(spells?.automation).toBe('manual');
    expect(spells?.grants).toBeUndefined();
    expect(spells?.note).toContain('Long Rest');
    expect(classCasting(plan(druid()).spellcasting, 'druid')?.prepared).toHaveLength(6);
  });
});

describe('the Ranger', () => {
  /** A half-caster that *knows* — a combination no other class has. */
  it('is the only half-caster that knows rather than prepares', () => {
    expect(RANGER.spellcasting?.style).toBe('known');
    expect(PALADIN.spellcasting?.style).toBe('prepared-from-list');
    expect(highestSlotLevel(slotsAt(RANGER, 20))).toBe(5);
    expect(highestSlotLevel(slotsAt(PALADIN, 20))).toBe(5);
  });

  /** SRD 5.2.1, as for the Paladin: spellcasting at level 1, not 2. */
  it('casts from level 1, as 2024 says and 2014 did not', () => {
    expect(RANGER.spellcasting?.startsAtLevel).toBe(1);
    expect(RANGER.table[0]?.spellSlots).toEqual([2]);
    expect(RANGER.table[0]?.preparedSpells).toBe(2);
  });

  it('has no cantrips at all', () => {
    for (const row of RANGER.table) expect(row.cantripsKnown).toBeUndefined();
  });

  /** SRD Favored Enemy: Hunter's Mark always prepared, with free castings. */
  it('always has Hunter’s Mark, over and above what it knows', () => {
    const prepared = classCasting(plan(ranger()).spellcasting, 'ranger')?.prepared ?? [];
    expect(prepared).toContain('hunters-mark');
    // Four known at level 3, plus the one granted.
    expect(prepared).toHaveLength(5);
    expect(FAVORED_ENEMY_USES[0]).toBe(2);
    expect(FAVORED_ENEMY_USES[19]).toBe(6);
  });

  it('takes a Fighting Style, like a Fighter and a Paladin', () => {
    expect(plan(ranger()).feats).toContain('Archery (ranger:fighting-style)');
  });

  it('folds, survives JSON, and replays prefix by prefix', () => {
    const events = unwrap(createCharacter(SRD_CONTENT,ranger(), id('sorrel')), 'create');
    const state = fold('seed', events);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= events.length; n += 1) {
      expect(fold('seed', events.slice(0, n))).toEqual(fold('seed', events.slice(0, n)));
    }
  });
});

describe('all twelve classes are in', () => {
  it('registers every class the SRD publishes', () => {
    expect(SRD_CONTENT.classes.map((c) => c.name).sort()).toEqual([
      'Barbarian',
      'Bard',
      'Cleric',
      'Druid',
      'Fighter',
      'Monk',
      'Paladin',
      'Ranger',
      'Rogue',
      'Sorcerer',
      'Warlock',
      'Wizard',
    ]);
  });

  /** Every combination the SRD uses, and each with at least one class in it. */
  it('covers every spellcasting shape the SRD has', () => {
    const styles = SRD_CONTENT.classes.map((c) => c.spellcasting?.style ?? 'none');
    for (const style of ['spellbook', 'prepared-from-list', 'known', 'none']) {
      expect(styles, style).toContain(style);
    }
  });

  it('has both full and half casters, and classes with and without cantrips', () => {
    const casters = SRD_CONTENT.classes.filter((c) => c.spellcasting !== undefined);
    const tops = casters.map((c) => highestSlotLevel(slotsAt(c, 20)));
    expect(tops).toContain(9);
    expect(tops).toContain(5);

    const cantrips = casters.map((c) => c.table[0]?.cantripsKnown);
    expect(cantrips).toContain(undefined);
    expect(cantrips.some((n) => typeof n === 'number' && n > 0)).toBe(true);
  });

  it('makes one of each without complaint', () => {
    for (const [choices, who] of [
      [bard(), 'ilva'],
      [druid(), 'fenn'],
      [ranger(), 'sorrel'],
    ] as const) {
      expect(built(choices, who).creatures[who]?.character?.level).toBe(3);
    }
  });
});

/**
 * SRD Feral Senses: "Your connection to the forces of nature grants you
 * Blindsight with a range of 30 feet."
 *
 * The whole of the trait in one `sense` grant, which is why the note goes
 * rather than narrowing. Driven through `canSee`, because a sense on a sheet
 * that no sight question consults would be the grant nothing reads this
 * repository keeps finding.
 */
describe("a Ranger's Feral Senses reach past a declaration", () => {
  const RANGER_SPELLS = SRD_CONTENT.spellEntries
    .filter((entry) => entry.classes.includes('ranger') && entry.level >= 1 && entry.level <= 5)
    .map((entry) => entry.id);

  const atLevel = (level: number): CharacterChoices =>
    ranger({
      level,
      preparedSpells: RANGER_SPELLS.slice(0, 14),
      featureChoices: {
        'human:skillful': ['athletics'],
        'ranger:deft-explorer': ['survival'],
        'hunter:hunters-prey': ['Colossus Slayer'],
        'ranger:expertise': ['perception', 'stealth'],
        'hunter:defensive-tactics': ['Escape the Horde'],
      },
      feats: {
        ...common.feats,
        'ranger:fighting-style': { featId: 'archery' },
        'ranger:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });

  const SORREL = id('sorrel');
  const QUARRY = id('quarry');

  /** A scene with the quarry twenty-five feet off and nobody declaring sight. */
  const scene = (level: number, feet: number): GameState =>
    fold('seed', [
      ...(unwrap(createCharacter(SRD_CONTENT, atLevel(level), SORREL), 'create') as GameEvent[]),
      {
        type: 'creature-added',
        id: QUARRY,
        name: 'the quarry',
        sheet: fold(
          'seed',
          unwrap(createCharacter(SRD_CONTENT, atLevel(level), QUARRY), 'quarry') as GameEvent[],
        ).creatures.quarry!.sheet,
        maxHp: 20,
        diesAtZero: true,
        creatureType: 'Beast',
        side: 'foes',
      },
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the thicket', at: { x: 80, y: 80, z: 0 } },
      { type: 'creature-placed', id: SORREL, placement: { from: { landmark: 'the thicket' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: QUARRY,
        placement: { from: { creature: SORREL }, feet, bearing: 0 },
      },
    ]);

  it('sees inside thirty feet without anybody declaring it, and not outside', () => {
    // Level 17 has no sense at all, so the question is still the table's.
    expect(canSee(scene(17, 25), SORREL, QUARRY)).toBeNull();

    expect(canSee(scene(18, 25), SORREL, QUARRY)).toBe(true);
    // "with a range of 30 feet" — and the thirty-fifth foot is outside it.
    expect(canSee(scene(18, 35), SORREL, QUARRY)).toBeNull();
  });

  it('reaches the sheet as Blindsight out to thirty feet', () => {
    expect(sensesOf(scene(18, 25), SORREL)).toEqual([{ sense: 'blindsight', feet: 30 }]);
    expect(sensesOf(scene(17, 25), SORREL)).toEqual([]);
  });
});

/**
 * SRD Favored Enemy, whose two sentences the engine answers one of.
 *
 * > "You always have the _Hunter's Mark_ spell prepared. You can cast it twice
 * > without expending a spell slot, and you regain all expended uses of this
 * > ability when you finish a Long Rest."
 *
 * **It was marked executed on the strength of a note claiming a pool nobody
 * declared** — the failure `class-pools.test.ts` was written for, wearing the
 * one disguise that guard cannot see through, because the guard reads a
 * feature's own note and this note said the pool was there. `freeCastPoolKey`
 * names a pool for a **feat's** granted spell and for nothing a class feature
 * grants, so a Ranger has Hunter's Mark prepared and nothing to cast it out
 * of but a slot. Both halves are asserted, because the first is what the
 * feature really does and the second is why it is honest for it to be manual.
 */
describe("a Ranger's Favored Enemy prepares the spell and buys no casting", () => {
  it('has Hunter’s Mark prepared without anybody choosing it', () => {
    const prepared = classCasting(plan(ranger()).spellcasting, 'ranger')?.prepared ?? [];
    expect(prepared).toContain('hunters-mark');
    expect(ranger().preparedSpells).not.toContain('hunters-mark');
  });

  it('declares no pool for the free castings the SRD prints', () => {
    const pools = built(ranger(), 'sorrel').creatures.sorrel?.resources.pools ?? {};
    expect(Object.keys(pools).filter((key) => key.includes('favored-enemy'))).toEqual([]);
    expect(Object.keys(pools).filter((key) => key.includes('hunters-mark'))).toEqual([]);
    // And the feature says so rather than claiming otherwise.
    const feature = RANGER.features.find((one) => one.id === 'ranger:favored-enemy');
    expect(feature?.automation).toBe('manual');
    expect(feature?.grants).toEqual({ kind: 'spells', fixed: ['hunters-mark'] });
  });
});
