import { describe, expect, it } from 'vitest';
import { ROGUE, SNEAK_ATTACK_DICE, SRD_CONTENT, THIEF, WIZARD } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, proficiencyBonusForLevel, skillModifier } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { carrying } from '@ie/engine';
import { cumulativeFeatures } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';

/**
 * The second user of the Expertise grant, which is what makes it a grant.
 *
 * `grants: { kind: 'expertise' }` replaced a string match on `wizard:scholar`,
 * and until now the Wizard's Scholar was the only feature in it — a
 * generalisation with one user is a guess dressed up as a structure. The
 * Rogue's Expertise is the same rule and differs three ways: it takes **two**
 * skills rather than one, it offers them from the character's own
 * proficiencies rather than a fixed list, and it comes round **again** at
 * level 6.
 *
 * Also the first class to choose **four** skills, and the first to grant a
 * tool proficiency of its own rather than inheriting one from a background.
 */

const id = (s: string) => asCharacterId(s);
const NYX = id('nyx');

const rogue = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Nyx',
  classId: 'rogue',
  level: 6,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Chaotic Neutral',
  subclassId: 'thief',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:second-expertise': ['acrobatics', 'investigation'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,rogue(over), NYX), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(SRD_CONTENT,rogue(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Rogue table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of ROGUE.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(ROGUE.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  /** SRD: 1d6 at level 1, rising by one die every odd level to 10d6 at 19. */
  it('grows Sneak Attack by a die every odd level', () => {
    expect(SNEAK_ATTACK_DICE[0]).toBe(1);
    expect(SNEAK_ATTACK_DICE[19]).toBe(10);
    for (let i = 1; i < SNEAK_ATTACK_DICE.length; i += 1) {
      const before = SNEAK_ATTACK_DICE[i - 1] ?? 0;
      const after = SNEAK_ATTACK_DICE[i] ?? 0;
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after - before).toBeLessThanOrEqual(1);
    }
  });

  it('casts nothing at all', () => {
    expect(ROGUE.spellcasting).toBeUndefined();
    for (const row of ROGUE.table) {
      expect(row.spellSlots).toBeUndefined();
      expect(row.cantripsKnown).toBeUndefined();
    }
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...ROGUE.features, ...THIEF.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });
});

describe('Expertise is the same grant the Wizard has', () => {
  /** Both features declare the same grant; neither is found by its id. */
  it('is declared as a grant on both classes', () => {
    const rogueExpertise = ROGUE.features.filter((f) => f.grants?.kind === 'expertise');
    const wizardExpertise = WIZARD.features.filter((f) => f.grants?.kind === 'expertise');
    expect(rogueExpertise).toHaveLength(2);
    expect(wizardExpertise).toHaveLength(1);
  });

  /** SRD: proficiency bonus doubled on a skill you have Expertise in. */
  it('doubles the proficiency bonus on the chosen skills', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,rogue()), 'plan');
    expect(plan.sheet.skills.stealth).toBe('expertise');
    expect(plan.sheet.skills['sleight-of-hand']).toBe('expertise');

    // Dexterity 15 is +2; a level 6 Rogue's proficiency bonus is +3.
    // Proficient would be +5; Expertise is +8.
    expect(skillModifier(plan.sheet, 'stealth')).toBe(8);
    // A skill that is merely proficient stays at +5 — Perception is Wisdom
    // 12 (+1) plus 3, so +4, which is the other half of the comparison.
    expect(skillModifier(plan.sheet, 'perception')).toBe(4);
  });

  /** The second grant at level 6 is a separate feature with its own choice. */
  it('grants two more skills at level 6', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,rogue()), 'plan');
    expect(plan.sheet.skills.acrobatics).toBe('expertise');
    expect(plan.sheet.skills.investigation).toBe('expertise');
  });

  it('does not offer the second Expertise before level 6', () => {
    const at5 = cumulativeFeatures(ROGUE, 5).map((f) => f.id);
    expect(at5).toContain('rogue:expertise');
    expect(at5).not.toContain('rogue:second-expertise');
  });

  /** SRD: Expertise is in "your skill proficiencies" — you must have it first. */
  it('refuses Expertise in a skill the character is not proficient in', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          // Survival is on nobody's list here: not a Rogue class skill, not
          // Sage's (Arcana and History), and not the Human's chosen one.
          'rogue:expertise': ['stealth', 'survival'],
          'rogue:second-expertise': ['acrobatics', 'investigation'],
        },
      },
      'expertise_without_proficiency',
    );
  });

  it('refuses the wrong number of Expertise skills', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'rogue:expertise': ['stealth'],
          'rogue:second-expertise': ['acrobatics', 'investigation'],
        },
      },
      'missing_feature_choice',
    );
  });
});

describe('a Rogue chooses four skills and comes with tools', () => {
  it('chooses four class skills where every other class chooses two', () => {
    expect(ROGUE.skillChoices.choose).toBe(4);
    expect(WIZARD.skillChoices.choose).toBe(2);
  });

  it('refuses the wrong number of class skills', () => {
    rejects({ classSkills: ['stealth', 'acrobatics'] }, 'wrong_skill_count');
  });

  it('carries Thieves’ Tools from its own package', () => {
    const held = carrying(built(), NYX).map((line) => line.id);
    expect(held).toContain('thieves-tools');
    expect(held).toContain('leather-armor');
    // The Burglar's Pack is opened like any other.
    expect(held).toContain('lantern-hooded');
  });

  it('counts its arrows one at a time', () => {
    expect(carrying(built(), NYX)).toContainEqual({ id: 'arrows', quantity: 20 });
  });
});

describe('a Rogue is a creature the rest of the engine accepts', () => {
  it('wears Leather Armour and adds all its Dexterity', () => {
    const sheet = built().creatures.nyx!.sheet;
    expect(sheet.armor?.name).toBe('Leather Armor');
    // Leather is 11 + Dexterity, uncapped. Dexterity 15 is +2.
    expect(armorClass(sheet)).toBe(13);
  });

  it('has hit points from a d8', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,rogue()), 'plan');
    // Level 6, d8, Constitution 15 (+2): 8 + 5×5 + 6×2 = 45.
    expect(plan.hitPointMaximum).toBe(45);
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

/**
 * SRD Steady Aim: "As a Bonus Action, you give yourself Advantage on your next
 * attack roll on the current turn. You can use this feature only if you haven’t
 * moved during this turn, and after you use it, your Speed is 0 until the end
 * of the current turn."
 *
 * The catalogue’s half of it: three clauses declared in the vocabulary the
 * engine reads, compiled onto the sheet at the level the table prints it. What
 * the engine does with them is `steady-aim.test.ts`’s.
 */
describe('Steady Aim is declared rather than left to the table', () => {
  const steadyAim = ROGUE.features.find((feature) => feature.id === 'rogue:steady-aim');

  it('is executed by the engine, at the level the table grants it', () => {
    expect(steadyAim?.automation).toBe('engine');
    expect(steadyAim?.level).toBe(3);
  });

  it('hangs both of its clauses off one Bonus Action, gated on not having moved', () => {
    expect(steadyAim?.grants).toEqual({
      kind: 'activated',
      action: 'bonus-action',
      pool: null,
      lasts: 'start-of-next-turn',
      onlyIfUnmoved: true,
      hangs: [
        {
          kind: 'roll-mode',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'attack', relation: 'roller' },
            oneShot: true,
          },
          lasts: 'end-of-current-turn',
        },
        { kind: 'speed', change: 'zero', lasts: 'end-of-current-turn' },
      ],
    });
  });

  it('reaches the sheet of a Rogue who has the level for it', () => {
    const activated = built().creatures.nyx!.sheet.activated ?? [];
    const compiled = activated.find((feature) => feature.feature === 'rogue:steady-aim');
    expect(compiled?.action).toBe('bonus-action');
    expect(compiled?.onlyIfUnmoved).toBe(true);
    expect(compiled?.hangs).toHaveLength(2);
  });
});
