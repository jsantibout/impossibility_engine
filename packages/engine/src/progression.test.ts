import { describe, expect, it } from 'vitest';
import { EVOKER, SRD_CONTENT, WIZARD } from '@ie/content';
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

/** The twelve classes SRD 5.2.1 publishes, by name. */
const SRD_CLASSES: readonly string[] = [
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
];

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

    /**
     * Slots only ever improve — and "improve" means two different things.
     *
     * Every caster but one accumulates: a level 5 Wizard has everything a
     * level 4 Wizard had and more. Pact Magic instead *moves up* — a Warlock
     * at 4 has two level 2 slots and at 5 has two level 3 slots and none at
     * level 2 — so the accumulating check is simply false for it, and it is
     * the rule rather than a transcription error.
     *
     * Two rules, so two assertions, and each class gets **the one that applies
     * to it** rather than one of them being skipped. A skipped test reports as
     * a gap in coverage and reads like one; a class that never ran either
     * assertion is the thing actually worth catching, and `spellcasting.feature`
     * being one of exactly two values is what rules that out.
     */
    if (definition.spellcasting?.feature === 'pact-magic') {
      it('never loses a Pact Magic slot or drops its level', () => {
        const total = (level: number) =>
          Object.values(slotsAt(definition, level)).reduce((sum, n) => sum + n, 0);
        const topLevel = (level: number) =>
          Math.max(0, ...Object.keys(slotsAt(definition, level)).map(Number));
        for (let level = 2; level <= MAX_LEVEL; level += 1) {
          expect(total(level)).toBeGreaterThanOrEqual(total(level - 1));
          expect(topLevel(level)).toBeGreaterThanOrEqual(topLevel(level - 1));
        }
      });
    } else {
      it('never takes a slot away as it levels', () => {
        for (let level = 2; level <= MAX_LEVEL; level += 1) {
          const before = slotsAt(definition, level - 1);
          const now = slotsAt(definition, level);
          for (let slot = 1; slot <= 9; slot += 1) {
            expect(now[slot] ?? 0).toBeGreaterThanOrEqual(before[slot] ?? 0);
          }
        }
      });
    }

    /** Which makes the branch above total: there is no third kind of caster. */
    it('casts by Spellcasting, by Pact Magic, or not at all', () => {
      const feature = definition.spellcasting?.feature;
      if (definition.spellcasting === undefined) expect(feature).toBeUndefined();
      else expect(['spellcasting', 'pact-magic', undefined]).toContain(feature);
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

// Every class the engine knows, not just the one the suite was written for.
for (const definition of SRD_CONTENT.classes) wellFormed(definition);

describe('every class the engine knows is registered and coherent', () => {
  /**
   * Every class registered is one the SRD actually publishes.
   *
   * Not "there are twelve": how many are transcribed is progress, and progress
   * belongs in COVERAGE.md rather than in a test that fails until the work is
   * finished. What a test can say is that nothing invented a class.
   */
  it('registers only classes the SRD publishes', () => {
    for (const definition of SRD_CONTENT.classes) {
      expect(SRD_CLASSES, `${definition.name} is not an SRD class`).toContain(definition.name);
    }
  });

  it('gives every class a unique id and a unique name', () => {
    const ids = SRD_CONTENT.classes.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = SRD_CONTENT.classes.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /** A subclass that names a class nobody registered can never be chosen. */
  it('points every subclass at a class that exists', () => {
    for (const subclass of SRD_CONTENT.subclasses) {
      expect(SRD_CONTENT.classes.some((c) => c.id === subclass.classId)).toBe(true);
    }
  });

  /** SRD publishes exactly one subclass per class. */
  it('gives every class at least one subclass', () => {
    for (const definition of SRD_CONTENT.classes) {
      expect(SRD_CONTENT.subclasses.some((s) => s.classId === definition.id)).toBe(true);
    }
  });

  /**
   * Every feature that is not executed says what a DM still has to do. An
   * unexplained "not automated" is not a useful thing to read at three in the
   * morning, and there are now hundreds of them.
   */
  it('explains every feature it does not execute', () => {
    for (const source of [...SRD_CONTENT.classes, ...SRD_CONTENT.subclasses]) {
      for (const feature of source.features) {
        expect(feature.note.length, `${feature.id} has no note`).toBeGreaterThan(20);
      }
    }
  });

  it('namespaces every feature id and never repeats one', () => {
    const ids = [...SRD_CONTENT.classes, ...SRD_CONTENT.subclasses].flatMap((s) =>
      s.features.map((f) => f.id),
    );
    for (const featureId of ids) expect(featureId).toContain(':');
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** A class either casts or it does not; there is no half-declared state. */
  it('gives a spell table only to a class that declares spellcasting', () => {
    for (const definition of SRD_CONTENT.classes) {
      const casts = definition.spellcasting !== undefined;
      const hasSlots = definition.table.some((row) => (row.spellSlots ?? []).length > 0);
      expect(hasSlots, `${definition.name}`).toBe(casts);
    }
  });
});

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
