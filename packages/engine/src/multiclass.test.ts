import { describe, expect, it } from 'vitest';
import { isErr } from '@ie/shared';
import { proficiencyBonusForLevel } from './character.js';
import { slotsAt } from './progression.js';
import {
  MULTICLASS_GRANTS,
  MULTICLASS_MINIMUM,
  casterLevel,
  characterLevel,
  combinedArmorTraining,
  hitDicePools,
  meetsPrerequisites,
  multiclassSlots,
  pactSlotsOf,
} from './multiclass.js';
import { allClasses, classById } from './creation.js';
import { WIZARD } from './wizard.js';
import { WARLOCK } from './warlock.js';
import { BARBARIAN } from './barbarian.js';
import { DRUID } from './druid.js';
import { CLERIC } from './cleric.js';
import { PALADIN } from './paladin.js';
import { FIGHTER } from './fighter.js';

/**
 * The rules that only exist between classes.
 *
 * Every one of these reads *across* the set, which is why they are their own
 * module: a class definition says what a Fighter is, and these say what
 * happens when a Fighter is also a Wizard.
 *
 * Two of them are the ones a table gets wrong. **Spell slots** come from a
 * weighted sum — all your Wizard levels, half your Ranger levels rounded up —
 * and not from adding the two classes' slot tables together. **Pact Magic
 * stays separate**, so a Warlock/Wizard has two pools rather than a bigger one.
 */

/** The full-caster slot rows, which the multiclass table is identical to. */
const FULL_CASTER_TABLE = WIZARD.table.map((row) => row.spellSlots ?? []);

describe('prerequisites read both directions', () => {
  const scores = { str: 15, dex: 10, con: 14, int: 13, wis: 8, cha: 12 };

  /** SRD: 13 in the primary ability of "the new class and your current classes". */
  it('lets a Barbarian who has the scores take Wizard levels', () => {
    expect(isErr(meetsPrerequisites(scores, [BARBARIAN, WIZARD]))).toBe(false);
  });

  it('refuses when the *new* class’s ability is short', () => {
    const result = meetsPrerequisites(scores, [BARBARIAN, DRUID]);
    expect(isErr(result)).toBe(true);
    // Wisdom 8 is the problem, and the message names the class that needs it.
    if (isErr(result)) expect(result.reason).toContain('Druid');
  });

  /**
   * The half that gets forgotten: the *current* class's ability matters too. A
   * character with the Wisdom for Druid but not the Strength for Barbarian is
   * equally refused.
   */
  it('refuses when the class you already have is the one short', () => {
    const weak = { str: 8, dex: 10, con: 14, int: 13, wis: 15, cha: 12 };
    const result = meetsPrerequisites(weak, [BARBARIAN, DRUID]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.reason).toContain('Barbarian');
  });

  it('names every class that falls short, not just the first', () => {
    const feeble = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    const result = meetsPrerequisites(feeble, [BARBARIAN, DRUID, WIZARD]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.reason).toContain('Barbarian');
      expect(result.reason).toContain('Druid');
      expect(result.reason).toContain('Wizard');
    }
  });

  it('is exactly 13, not more and not less', () => {
    expect(MULTICLASS_MINIMUM).toBe(13);
    const exact = { str: 13, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    expect(isErr(meetsPrerequisites(exact, [BARBARIAN]))).toBe(false);
    const under = { ...exact, str: 12 };
    expect(isErr(meetsPrerequisites(under, [BARBARIAN]))).toBe(true);
  });
});

describe('character level and Proficiency Bonus come from the total', () => {
  /** SRD: "your character level is the total of all your class levels." */
  it('adds every class level together', () => {
    expect(
      characterLevel([
        { classId: 'fighter', level: 3 },
        { classId: 'rogue', level: 2 },
      ]),
    ).toBe(5);
  });

  /**
   * SRD's own example: "a level 3 Fighter / level 2 Rogue has the Proficiency
   * Bonus of a level 5 character, which is +3."
   */
  it('gives a level 3 Fighter / level 2 Rogue the bonus of a level 5 character', () => {
    const total = characterLevel([
      { classId: 'fighter', level: 3 },
      { classId: 'rogue', level: 2 },
    ]);
    expect(proficiencyBonusForLevel(total)).toBe(3);
    // And *not* the bonus either class would have alone.
    expect(proficiencyBonusForLevel(3)).toBe(2);
    expect(proficiencyBonusForLevel(2)).toBe(2);
  });
});

describe('spell slots come from a weighted sum, not from adding two tables', () => {
  /** SRD: all levels in Bard, Cleric, Druid, Sorcerer and Wizard. */
  it('counts a full caster’s levels in full', () => {
    expect(casterLevel([{ classId: 'wizard', level: 5 }])).toBe(5);
    expect(
      casterLevel([
        { classId: 'wizard', level: 3 },
        { classId: 'cleric', level: 2 },
      ]),
    ).toBe(5);
  });

  /** SRD: half your levels, **rounded up**, in Paladin and Ranger. */
  it('counts a half caster’s levels at half, rounding up', () => {
    expect(casterLevel([{ classId: 'ranger', level: 4 }])).toBe(2);
    expect(casterLevel([{ classId: 'ranger', level: 5 }])).toBe(3);
    expect(casterLevel([{ classId: 'paladin', level: 1 }])).toBe(1);
  });

  it('counts a class that does not cast as nothing', () => {
    expect(casterLevel([{ classId: 'fighter', level: 10 }])).toBe(0);
    expect(casterLevel([{ classId: 'rogue', level: 20 }])).toBe(0);
  });

  /** SRD is explicit that Pact Magic is not in this sum. */
  it('leaves the Warlock out of the combined total', () => {
    expect(casterLevel([{ classId: 'warlock', level: 5 }])).toBe(0);
  });

  /**
   * SRD's own worked example: "a level 4 Ranger / level 3 Sorcerer... you
   * count as a level 5 character when determining your spell slots... you have
   * four level 1 spell slots, three level 2 slots, and two level 3 slots."
   */
  it('reproduces the SRD’s level 4 Ranger / level 3 Sorcerer example', () => {
    const levels = [
      { classId: 'ranger', level: 4 },
      { classId: 'sorcerer', level: 3 },
    ];
    expect(casterLevel(levels)).toBe(5);
    expect(multiclassSlots(levels, FULL_CASTER_TABLE)).toEqual({ 1: 4, 2: 3, 3: 2 });
  });

  /**
   * The printed Multiclass Spellcaster table is identical to the full-caster
   * table, which is why it is read off one rather than transcribed twice.
   * Every caster's table must agree, or reading off the Wizard's is a lie.
   */
  it('agrees with every full caster’s own table at every level', () => {
    const fullCasters = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'];
    for (const classId of fullCasters) {
      const definition = classById(classId);
      if (definition === null) throw new Error(`${classId} is not registered`);
      for (let level = 1; level <= 20; level += 1) {
        expect(
          multiclassSlots([{ classId, level }], FULL_CASTER_TABLE),
          `${classId} at ${level}`,
        ).toEqual(slotsAt(definition, level));
      }
    }
  });

  it('gives a character with no caster levels no slots at all', () => {
    expect(multiclassSlots([{ classId: 'fighter', level: 5 }], FULL_CASTER_TABLE)).toEqual({});
  });
});

describe('Pact Magic is a second pool, not more of the first', () => {
  /**
   * SRD keeps Pact Magic out of the combined table and then lets the two be
   * spent on each other's spells. Merging them would invent a slot.
   */
  it('keeps a Warlock/Wizard’s two pools apart', () => {
    const levels = [
      { classId: 'warlock', level: 3 },
      { classId: 'wizard', level: 3 },
    ];
    // Three Wizard levels: a level 3 full caster's slots.
    expect(multiclassSlots(levels, FULL_CASTER_TABLE)).toEqual({ 1: 4, 2: 2 });
    // And two level 2 Pact slots, separately.
    expect(pactSlotsOf(levels, WARLOCK.table)).toEqual({ 2: 2 });
  });

  it('gives a character with no Warlock levels no Pact slots', () => {
    expect(pactSlotsOf([{ classId: 'wizard', level: 5 }], WARLOCK.table)).toEqual({});
  });
});

describe('Hit Dice pool by die type', () => {
  const dieOf = (classId: string) => classById(classId)?.hitDie ?? null;

  /** SRD's own example: a level 5 Fighter / level 5 Paladin has ten d10s. */
  it('pools two classes that share a die', () => {
    expect(
      hitDicePools(
        [
          { classId: 'fighter', level: 5 },
          { classId: 'paladin', level: 5 },
        ],
        dieOf,
      ),
    ).toEqual({ 10: 10 });
  });

  /** And its other example: a level 5 Cleric / level 5 Paladin tracks both. */
  it('tracks two classes with different dice separately', () => {
    expect(
      hitDicePools(
        [
          { classId: 'cleric', level: 5 },
          { classId: 'paladin', level: 5 },
        ],
        dieOf,
      ),
    ).toEqual({ 8: 5, 10: 5 });
  });
});

describe('a later class grants only some of its proficiencies', () => {
  /** Every registered class must say what it grants as a second class. */
  it('has a grant for every class the engine knows', () => {
    for (const definition of allClasses()) {
      expect(MULTICLASS_GRANTS[definition.id], definition.name).toBeDefined();
    }
  });

  /**
   * SRD gives a multiclassing Fighter Martial weapons and Light and Medium
   * armour and Shields — but not Heavy armour, which the class itself has.
   */
  it('withholds what the class’s own traits would have given', () => {
    expect(FIGHTER.armorTraining.heavy).toBe(true);
    expect(MULTICLASS_GRANTS.fighter?.armorTraining.heavy).toBe(false);
  });

  /** Nobody gains a saving throw proficiency from a second class. */
  it('grants no saving throws at all', () => {
    for (const grant of Object.values(MULTICLASS_GRANTS)) {
      expect(Object.keys(grant)).not.toContain('saveProficiencies');
    }
  });

  /** Nobody gains a full class skill list either — one skill at most. */
  it('grants at most one skill, where a class grants two to four', () => {
    for (const [classId, grant] of Object.entries(MULTICLASS_GRANTS)) {
      expect(grant.skills?.choose ?? 0, classId).toBeLessThanOrEqual(1);
    }
    expect(CLERIC.skillChoices.choose).toBe(2);
  });

  /** Monk, Sorcerer and Wizard grant nothing but a Hit Die. */
  it('gives the three feature-heavy classes nothing but their die', () => {
    for (const classId of ['monk', 'sorcerer', 'wizard']) {
      const grant = MULTICLASS_GRANTS[classId];
      expect(grant?.weapons, classId).toEqual([]);
      expect(grant?.tools, classId).toEqual([]);
      expect(grant?.armorTraining, classId).toEqual({
        light: false,
        medium: false,
        heavy: false,
        shields: false,
      });
    }
  });

  /** Armour training is the union: what you had, plus what the subset adds. */
  it('unions the first class’s training with every later class’s subset', () => {
    // A Wizard (none) who takes Cleric levels gains Light, Medium and Shields.
    expect(combinedArmorTraining(WIZARD, ['cleric'])).toEqual({
      light: true,
      medium: true,
      // A multiclassing Cleric grants no Heavy armour, and a Wizard had none.
      heavy: false,
      shields: true,
    });
    // A Paladin (everything) who takes Wizard levels loses nothing.
    expect(combinedArmorTraining(PALADIN, ['wizard'])).toEqual(PALADIN.armorTraining);
  });

  it('ignores a class nobody registered rather than throwing', () => {
    expect(combinedArmorTraining(WIZARD, ['artificer'])).toEqual(WIZARD.armorTraining);
  });
});
