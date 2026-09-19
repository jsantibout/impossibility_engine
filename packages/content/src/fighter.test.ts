import { describe, expect, it } from 'vitest';
import { CHAMPION, FIGHTER, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, proficiencyBonusForLevel } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { carrying, coinsOf } from '@ie/engine';
import { goldToCopper } from '@ie/engine';
import { cumulativeFeatures } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';
import {
  ZERO_HIT_POINTS,
  createRollIssuer,
  resolveTest,
  resolveTurn,
  takeTestReaction,
  type Rng,
  type RngState,
  type Supply,
} from '@ie/engine';

/**
 * The repeats of Ability Score Improvement this class's table has printed by
 * this level, answered.
 *
 * SRD prints the feature again at levels 8, 12 and 16 — and at 6 and 14 for
 * a Fighter, and at 10 for a Rogue — and each repeat is a grant of its own
 * with an id of its own. They are filled with the SRD's own Ability Score
 * Improvement feat because it is the only one of these that may be taken more
 * than once, and with Charisma and Intelligence because nothing in this file
 * reads either.
 */
const repeatImprovements = (classId: string, level: number) =>
  Object.fromEntries(
    (SRD_CONTENT.classById(classId)?.features ?? [])
      .filter(
        (one) =>
          one.id.startsWith(`${classId}:ability-score-improvement-`) && one.level <= level,
      )
      .map((one) => [one.id, { featId: 'ability-score-improvement', abilities: ['cha', 'int'] }]),
  );


/**
 * A class that does not cast, which nothing had ever been.
 *
 * Two casters proved the spell rules; neither proved what happens without
 * them. `spellcasting?: undefined` was a branch the types allowed and no test
 * had walked — no cantrips, no prepared list, no slots, no spellbook, and a
 * table with no spell columns at all.
 *
 * The other two firsts: three equipment packages rather than two, and a
 * Fighting Style feat, whose category had existed on `FeatDefinition` since it
 * was written with nothing in it.
 */

const id = (s: string) => asCharacterId(s);
const ROENA = id('roena');

const fighter = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Roena',
  classId: 'fighter',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  // Sage offers Constitution, Intelligence and Wisdom — not Strength.
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral Good',
  subclassId: 'champion',
  // A Fighter has none of these, and says so by having none.
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,fighter(over), ROENA), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(SRD_CONTENT,fighter(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Fighter table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of FIGHTER.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(FIGHTER.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  /**
   * A Fighter does not know zero cantrips: a Fighter has no cantrips. Absent
   * rather than zero, so nothing can read a count off a class that has none.
   */
  it('has no spell columns at all', () => {
    for (const row of FIGHTER.table) {
      expect(row.cantripsKnown).toBeUndefined();
      expect(row.preparedSpells).toBeUndefined();
      expect(row.spellSlots).toBeUndefined();
    }
    expect(FIGHTER.spellcasting).toBeUndefined();
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...FIGHTER.features, ...CHAMPION.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });

  it('grants the level 3 features and not the level 5 ones', () => {
    const at3 = cumulativeFeatures(FIGHTER, 3).map((f) => f.id);
    expect(at3).toContain('fighter:fighting-style');
    expect(at3).toContain('fighter:second-wind');
    expect(at3).toContain('fighter:action-surge');
    expect(at3).toContain('fighter:subclass');
    expect(at3).not.toContain('fighter:extra-attack');
  });
});

describe('a Fighter is made without any spellcasting at all', () => {
  it('plans with no cantrips, no prepared spells and no slots', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,fighter()), 'plan');
    expect(plan.spellcasting.classes).toEqual([]);
    
    expect(plan.spellSlots).toEqual({});
  });

  /**
   * The feat still grants what it grants. Magic Initiate on a Fighter is a
   * character who can cast two cantrips and knows no class spells at all,
   * which is exactly the case the granted-spell route was built for.
   */
  it('still carries a feat’s granted spells', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,fighter()), 'plan');
    expect(plan.spellcasting.granted.map((g) => g.spellId)).toContain('ray-of-frost');
    // And the feat brings its own ability, not the class's — a Fighter has none.
    expect(plan.spellcasting.granted[0]?.ability).toBe('int');
    expect(plan.sheet.spellcastingAbility).toBeNull();
  });

  it('refuses a cantrip a Fighter cannot know', () => {
    rejects({ cantrips: ['fire-bolt'] }, 'no_spellcasting');
  });

  it('refuses a spellbook, which no Fighter has', () => {
    rejects(
      { spellbook: [{ spellId: 'magic-missile', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });
});

describe('three equipment packages, not two', () => {
  it('takes package A, opened', () => {
    const state = built();
    const held = carrying(state, ROENA).map((line) => line.id);
    expect(held).toContain('chain-mail');
    expect(held).toContain('greatsword');
    expect(carrying(state, ROENA)).toContainEqual({ id: 'javelin', quantity: 8 });
    // The Dungeoneer's Pack is opened like any other.
    expect(held).toContain('crowbar');
    // 4 GP from the Fighter package, 8 from Sage.
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(12));
  });

  it('takes package B, with its ammunition counted as arrows', () => {
    const state = built({ classEquipment: 'B', equipped: ['studded-leather-armor'] });
    expect(carrying(state, ROENA)).toContainEqual({ id: 'arrows', quantity: 20 });
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(11 + 8));
  });

  it('takes package C, which is money and nothing else', () => {
    const state = built({ classEquipment: 'C', equipped: [] });
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(155 + 8));
    expect(carrying(state, ROENA).map((l) => l.id)).not.toContain('chain-mail');
  });

  it('refuses a package that is not on offer', () => {
    rejects({ classEquipment: 'D', equipped: [] }, 'unknown_equipment_option');
  });

  /** SRD prices Arrows at 1 GP for 20, so one arrow is 5 copper. */
  it('prices ammunition by the round rather than by the bundle', () => {
    const arrows = SRD_CONTENT.item('arrows');
    expect(arrows?.kind).toBe('ammunition');
    expect(arrows?.costCp).toBe(5);
    expect(arrows?.bundleSize).toBe(20);
  });
});

describe('a Fighter wears the heaviest armour in the book', () => {
  /** SRD Chain Mail is a flat 16, adding no Dexterity at all. */
  it('derives Armour Class from Chain Mail with no Dexterity', () => {
    const sheet = built().creatures.roena!.sheet;
    expect(sheet.armor?.name).toBe('Chain Mail');
    expect(armorClass(sheet)).toBe(16);
  });

  /**
   * SRD Chain Mail requires Strength 13, and this Fighter has 17 after their
   * origin increase — so no Speed penalty. The rule reads the *score*.
   */
  it('meets the armour’s Strength requirement', () => {
    const sheet = built().creatures.roena!.sheet;
    expect(sheet.abilities.str).toBeGreaterThanOrEqual(sheet.armor?.strengthRequirement ?? 0);
  });
});

describe('a Fighting Style is a feat, from the Fighting Style list', () => {
  it('takes one of the four the SRD publishes', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,fighter()), 'plan');
    expect(plan.feats).toContain('Defense (fighter:fighting-style)');
  });

  /** The category is what the prerequisite comes to: Alert is not a Style. */
  it('refuses an Origin feat as a Fighting Style', () => {
    rejects(
      {
        feats: {
          ...fighter().feats,
          'fighter:fighting-style': { featId: 'alert' },
        },
      },
      'wrong_feat_category',
    );
  });

  it('refuses a Fighting Style nobody has heard of', () => {
    rejects(
      {
        feats: {
          ...fighter().feats,
          'fighter:fighting-style': { featId: 'blade-dancing' },
        },
      },
      'unknown_feat',
    );
  });
});

describe('a Fighter is a creature the rest of the engine accepts', () => {
  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('has hit points from a d10 rather than a d6', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,fighter()), 'plan');
    // Level 3, d10, Constitution 16 (+3): 10 + 6 + 6 + 3×3 = 31.
    expect(plan.hitPointMaximum).toBe(31);
  });
});

// — the two Fighter features a grant the engine already had came to fit —

/** A generator that rolls exactly what it is told to, in order. */
const scripted = (values: readonly number[]): Rng => {
  let at = 0;
  return {
    int: () => values[at++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rolls: readonly number[]): Supply => ({
  issuer: createRollIssuer('r'),
  rng: scripted(rolls),
  content: SRD_CONTENT,
});

/** A Fighter of any level, with every choice the levels below it ask for. */
const atLevel = (level: number): CharacterChoices =>
  fighter({
    level,
    ...(level >= 3 ? {} : { subclassId: undefined }),
    feats: {
      ...fighter().feats,
      ...(level >= 4 ? { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
      ...repeatImprovements('fighter', level),
      ...(level >= 7 ? { 'champion:additional-fighting-style': { featId: 'archery' } } : {}),
    },
  });

const logAt = (level: number): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, atLevel(level), ROENA), 'create');

const stateAt = (level: number): GameState => fold('seed', logAt(level));

/**
 * SRD Tactical Mind, which is Peerless Skill with the Bard’s die swapped out.
 *
 * > "When you fail an ability check, you can expend a use of your Second Wind
 * > to push yourself toward success. Rather than regaining Hit Points, you
 * > roll 1d10 and add the number rolled to the ability check, potentially
 * > turning it into a success. If the check still fails, this use of Second
 * > Wind isn’t expended."
 *
 * Driven rather than inspected, because the claim is about three things no
 * sheet can show: which window it answers, what it adds, and when the use
 * comes back.
 */
describe("a Fighter's Tactical Mind pushes a failed check", () => {
  const spentBy = (log: readonly GameEvent[]): number =>
    fold('seed', log).creatures.roena?.resources.pools['second-wind']?.spent ?? -1;

  const failing = (level: number, dc = 40) => {
    const log = logAt(level);
    return {
      log,
      out: unwrap(
        resolveTest(fold('seed', log), ROENA, { kind: 'ability-check', ability: 'str', dc }, supply([4])),
        'check',
      ),
    };
  };

  it('is offered on a failed ability check and on nothing else', () => {
    expect(failing(2).out.offers.map((o) => o.feature)).toContain('fighter:tactical-mind');

    // "When you fail an ability check" — a save is a different roll and the
    // SRD says nothing about it.
    const save = unwrap(
      resolveTest(stateAt(2), ROENA, { kind: 'saving-throw', ability: 'str', dc: 40 }, supply([4])),
      'save',
    );
    expect(save.offers.map((o) => o.feature)).not.toContain('fighter:tactical-mind');

    // And a check that succeeded has nothing to be pushed toward.
    const easy = unwrap(
      resolveTest(stateAt(2), ROENA, { kind: 'ability-check', ability: 'str', dc: -5 }, supply([4])),
      'easy',
    );
    expect(easy.offers.map((o) => o.feature)).not.toContain('fighter:tactical-mind');
  });

  /** Level 1 has Second Wind and not this: the feature arrives at level 2. */
  it('is not offered to a Fighter who has not reached level 2', () => {
    expect(failing(1).out.offers.map((o) => o.feature)).not.toContain('fighter:tactical-mind');
  });

  it('adds the 1d10 to the check and spends the use when the check turns', () => {
    // A Difficulty Class one above what the d20 came to, so any die face on
    // the 1d10 turns the check.
    const plain = failing(2);
    const near = unwrap(
      resolveTest(
        fold('seed', plain.log),
        ROENA,
        { kind: 'ability-check', ability: 'str', dc: plain.out.test!.total + 1 },
        supply([4]),
      ),
      'near',
    );
    expect(near.test?.success).toBe(false);

    const before = [...plain.log, ...near.events];
    const taken = unwrap(
      takeTestReaction(fold('seed', before), ROENA, { feature: 'fighter:tactical-mind' }, supply([6])),
      'push',
    );
    expect(taken.test!.total).toBe(near.test!.total + 6);
    expect(taken.test!.success).toBe(true);
    expect(spentBy([...before, ...taken.events])).toBe(1);
  });

  /** "If the check still fails, this use of Second Wind isn’t expended." */
  it('gives the use back when the check still fails', () => {
    const plain = failing(2);
    const before = [...plain.log, ...plain.out.events];
    const taken = unwrap(
      takeTestReaction(fold('seed', before), ROENA, { feature: 'fighter:tactical-mind' }, supply([10])),
      'push',
    );
    expect(taken.test!.success).toBe(false);
    expect(spentBy([...before, ...taken.events])).toBe(0);
  });
});

/**
 * SRD Champion, Survivor: "_Defy Death._ You have Advantage on Death Saving
 * Throws."
 *
 * Half a feature, which is why it keeps its note — and the half that is built
 * is the half a scripted generator can show: with Advantage two d20s are
 * drawn and the better kept, so a Champion 18 makes the save a Champion 17
 * fails on the same two numbers.
 */
describe("a Champion's Survivor defies death", () => {
  // Exactly the maximum, not more: twice it is the SRD's instant death, and a
  // corpse rolls no saves at all.
  const down = (level: number): readonly GameEvent[] => {
    const log = logAt(level);
    const hpMax = fold('seed', log).creatures.roena!.vitals.hpMax;
    return [
      ...log,
      { type: 'combat-started', combatants: [{ id: ROENA, initiative: 10, speed: 30 }] },
      { type: 'damage-taken', id: ROENA, amount: hpMax, source: 'the ogre' },
      { type: 'condition-applied', id: ROENA, condition: 'unconscious', source: ZERO_HIT_POINTS },
    ];
  };

  /** The first die is a failure and the second is a success. */
  const ROLLS = [3, 17];

  const saved = (level: number) => {
    const log = down(level);
    const out = unwrap(resolveTurn(fold('seed', log), supply(ROLLS)), 'turn');
    return fold('seed', [...log, ...out.events]).creatures.roena!.vitals;
  };

  it('keeps the better of two dice at level 18 and rolls one at 17', () => {
    expect(saved(17).deathSaveFailures).toBe(1);
    expect(saved(17).deathSaveSuccesses).toBe(0);

    expect(saved(18).deathSaveSuccesses).toBe(1);
    expect(saved(18).deathSaveFailures).toBe(0);
  });

  it('reaches the sheet as a standing mode on the death-save family alone', () => {
    const modes = (stateAt(18).creatures.roena?.sheet.standing ?? []).filter(
      (effect) => effect.feature === 'champion:survivor',
    );
    expect(modes).toHaveLength(1);
    expect(modes[0]?.grant).toEqual({
      kind: 'roll-mode',
      modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
    });
    expect(
      (stateAt(17).creatures.roena?.sheet.standing ?? []).some(
        (effect) => effect.feature === 'champion:survivor',
      ),
    ).toBe(false);
  });
});
