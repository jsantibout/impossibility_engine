import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import { proficiencyBonusForLevel } from './character.js';
import {
  MAX_LEVEL,
  XP_THRESHOLDS,
  cumulativeFeatures,
  featuresAt,
  levelForXp,
  rowAt,
  slotsAt,
  spellSlotTable,
  type ClassDefinition,
} from './progression.js';
import { EVOKER, WIZARD } from './wizard.js';

describe('the advancement table', () => {
  /**
   * SRD Character Advancement. Levels are the spine of everything else here,
   * so the thresholds are transcribed rather than recalled and the Proficiency
   * Bonus is asserted against the formula the rest of the engine already uses.
   */
  it('runs from 1 to 20', () => {
    expect(MAX_LEVEL).toBe(20);
    expect(XP_THRESHOLDS).toHaveLength(20);
    expect(XP_THRESHOLDS[0]).toBe(0);
    expect(XP_THRESHOLDS[19]).toBe(355_000);
  });

  it('turns experience into a level', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(900)).toBe(3);
    expect(levelForXp(355_000)).toBe(20);
    expect(levelForXp(9_999_999)).toBe(20);
  });

  it('refuses experience that is not a number of points', () => {
    expect(() => levelForXp(-1)).toThrow();
    expect(() => levelForXp(1.5)).toThrow();
  });
});

/**
 * The same checks every class table must pass. Written against the interface
 * rather than the Wizard, because the next class to land should fail loudly
 * rather than quietly disagree with the rest of the engine.
 */
const wellFormed = (definition: ClassDefinition) => {
  describe(`${definition.name} is a well-formed class`, () => {
    it('has a row for every level from 1 to 20', () => {
      expect(definition.table).toHaveLength(MAX_LEVEL);
      definition.table.forEach((row, index) => expect(row.level).toBe(index + 1));
    });

    /**
     * The relationship, not just the presence. A transcribed Proficiency Bonus
     * that disagrees with the formula is a typo that would look like a rules
     * bug forever after.
     */
    it('prints the Proficiency Bonus the formula gives', () => {
      for (const row of definition.table) {
        expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
      }
    });

    it('never takes a slot away as it levels', () => {
      for (let level = 2; level <= MAX_LEVEL; level += 1) {
        const before = slotsAt(definition, level - 1);
        const now = slotsAt(definition, level);
        for (let slot = 1; slot <= 9; slot += 1) {
          expect(now[slot] ?? 0).toBeGreaterThanOrEqual(before[slot] ?? 0);
        }
      }
    });

    it('grants its subclass at the level it says', () => {
      const at = featuresAt(definition, definition.subclassLevel);
      expect(at.some((f) => f.grantsSubclass === true)).toBe(true);
    });

    it('names a hit die the game uses', () => {
      expect([6, 8, 10, 12]).toContain(definition.hitDie);
    });
  });
};

wellFormed(WIZARD);

describe('the Wizard table matches the SRD', () => {
  it('states the core traits', () => {
    expect(WIZARD.primaryAbility).toBe('int');
    expect(WIZARD.hitDie).toBe(6);
    expect(WIZARD.saveProficiencies).toEqual(['int', 'wis']);
    expect(WIZARD.skillChoices.choose).toBe(2);
    expect(WIZARD.skillChoices.from).toContain('arcana');
    expect(WIZARD.skillChoices.from).not.toContain('stealth');
    // "Armor Training: None."
    expect(WIZARD.armorTraining).toEqual({
      light: false,
      medium: false,
      heavy: false,
      shields: false,
    });
  });

  it('has the level 3 row the table prints', () => {
    const row = unwrap(rowAt(WIZARD, 3), 'row');
    expect(row.proficiencyBonus).toBe(2);
    expect(row.cantripsKnown).toBe(3);
    expect(row.preparedSpells).toBe(6);
    expect(slotsAt(WIZARD, 3)).toEqual({ 1: 4, 2: 2 });
  });

  it('has the level 1 and 2 rows the table prints', () => {
    expect(slotsAt(WIZARD, 1)).toEqual({ 1: 2 });
    expect(slotsAt(WIZARD, 2)).toEqual({ 1: 3 });
    expect(unwrap(rowAt(WIZARD, 1), 'row').preparedSpells).toBe(4);
    expect(unwrap(rowAt(WIZARD, 2), 'row').preparedSpells).toBe(5);
  });

  it('refuses a level outside the table', () => {
    expect(isErr(rowAt(WIZARD, 0))).toBe(true);
    expect(isErr(rowAt(WIZARD, 21))).toBe(true);
  });

  it('grants the features the table lists, at the levels it lists them', () => {
    expect(featuresAt(WIZARD, 1).map((f) => f.id)).toEqual([
      'wizard:spellcasting',
      'wizard:ritual-adept',
      'wizard:arcane-recovery',
    ]);
    expect(featuresAt(WIZARD, 2).map((f) => f.id)).toEqual(['wizard:scholar']);
    expect(featuresAt(WIZARD, 3).map((f) => f.id)).toEqual(['wizard:subclass']);
  });

  it('accumulates everything up to a level', () => {
    const all = cumulativeFeatures(WIZARD, 3).map((f) => f.id);
    expect(all).toEqual([
      'wizard:spellcasting',
      'wizard:ritual-adept',
      'wizard:arcane-recovery',
      'wizard:scholar',
      'wizard:subclass',
    ]);
  });
});

describe('features say what the engine does with them', () => {
  /**
   * Granting a feature and executing it are different jobs, and conflating
   * them is how a character sheet ends up claiming abilities nothing honours.
   * Every feature says which it is, and a manual one has to say what is
   * missing — an unexplained "not automated" is not a useful thing to read at
   * three in the morning.
   */
  it('marks every feature one way or the other', () => {
    for (const feature of cumulativeFeatures(WIZARD, 20)) {
      expect(['engine', 'manual']).toContain(feature.automation);
      if (feature.automation === 'manual') {
        expect(feature.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('automates Arcane Recovery as a pool and leaves Ritual Adept to the DM', () => {
    const byId = new Map(cumulativeFeatures(WIZARD, 3).map((f) => [f.id, f]));
    expect(byId.get('wizard:arcane-recovery')?.automation).toBe('engine');
    expect(byId.get('wizard:ritual-adept')?.automation).toBe('manual');
  });

  it('knows which features ask the player something', () => {
    const scholar = cumulativeFeatures(WIZARD, 2).find((f) => f.id === 'wizard:scholar');
    expect(scholar?.choice).toMatchObject({ kind: 'skill', choose: 1 });
  });
});

describe('the Evoker subclass', () => {
  it('belongs to the Wizard and starts at level 3', () => {
    expect(EVOKER.classId).toBe(WIZARD.id);
    expect(featuresAt(EVOKER, 3).map((f) => f.id)).toEqual([
      'evoker:evocation-savant',
      'evoker:potent-cantrip',
    ]);
  });

  it('grants nothing before its level', () => {
    expect(featuresAt(EVOKER, 2)).toEqual([]);
    expect(cumulativeFeatures(EVOKER, 2)).toEqual([]);
  });

  it('asks for two Evocation spells of level 2 or lower', () => {
    const savant = featuresAt(EVOKER, 3).find((f) => f.id === 'evoker:evocation-savant');
    expect(savant?.choice).toMatchObject({
      kind: 'spell',
      choose: 2,
      school: 'evocation',
      maxLevel: 2,
    });
  });
});

describe('slot tables are reusable, not Wizard-shaped', () => {
  it('reads a table of any shape', () => {
    expect(spellSlotTable([2])).toEqual({ 1: 2 });
    expect(spellSlotTable([4, 3, 3, 1])).toEqual({ 1: 4, 2: 3, 3: 3, 4: 1 });
    expect(spellSlotTable([])).toEqual({});
  });

  it('drops the levels with no slots rather than recording zeroes', () => {
    expect(spellSlotTable([4, 0, 0])).toEqual({ 1: 4 });
  });
});
