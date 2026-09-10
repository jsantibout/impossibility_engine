import { describe, expect, it } from 'vitest';
import type { ConditionName } from '@ie/shared';
import {
  attackerConditionModes,
  canReceiveCondition,
  checkConditionEffect,
  conditionSpeed,
  conditionState,
  exhaustionBonus,
  expandConditions,
  hasCondition,
  initiativeConditionModes,
  isAutomaticCritical,
  isDeadFromExhaustion,
  isIncapacitated,
  resistsAllDamage,
  saveConditionEffect,
  targetConditionModes,
} from './conditions.js';

const state = (conditions: readonly ConditionName[] = [], exhaustion = 0) =>
  conditionState(conditions, exhaustion);

const modesOf = (sources: readonly { mode: string }[]) => sources.map((m) => m.mode);

describe('expandConditions', () => {
  // SRD Unconscious: "You have the Incapacitated and Prone conditions."
  it('expands Unconscious into Incapacitated and Prone', () => {
    expect(expandConditions(['unconscious']).sort()).toEqual(
      ['incapacitated', 'prone', 'unconscious'].sort(),
    );
  });

  it.each<[ConditionName]>([['paralyzed'], ['petrified'], ['stunned']])(
    '%s implies Incapacitated',
    (name) => {
      expect(expandConditions([name])).toContain('incapacitated');
    },
  );

  it('leaves a condition with no implications alone', () => {
    expect(expandConditions(['poisoned'])).toEqual(['poisoned']);
  });

  it('does not duplicate an implication already present', () => {
    const expanded = expandConditions(['unconscious', 'prone', 'incapacitated']);
    expect(expanded.filter((c) => c === 'prone')).toHaveLength(1);
  });

  it('is order-independent and sorted, so state serialises identically', () => {
    expect(expandConditions(['stunned', 'blinded'])).toEqual(
      expandConditions(['blinded', 'stunned']),
    );
  });

  it('applies implications through the state helper', () => {
    expect(hasCondition(state(['unconscious']), 'prone')).toBe(true);
    expect(hasCondition(state(['unconscious']), 'incapacitated')).toBe(true);
  });
});

describe('hasCondition', () => {
  it('reports a condition the creature has', () => {
    expect(hasCondition(state(['poisoned']), 'poisoned')).toBe(true);
  });

  it('reports one it does not', () => {
    expect(hasCondition(state(['poisoned']), 'blinded')).toBe(false);
  });

  // Exhaustion is a level rather than a flag, so presence is derived from it.
  it('derives Exhaustion from the level', () => {
    expect(hasCondition(state([], 0), 'exhaustion')).toBe(false);
    expect(hasCondition(state([], 1), 'exhaustion')).toBe(true);
  });
});

describe('attackerConditionModes', () => {
  it.each<[ConditionName]>([['blinded'], ['poisoned'], ['prone'], ['restrained']])(
    '%s gives the attacker disadvantage',
    (name) => {
      expect(modesOf(attackerConditionModes(state([name]), {}))).toEqual(['disadvantage']);
    },
  );

  // SRD Invisible: "your attack rolls have Advantage. If a creature can somehow
  // see you, you don't gain this benefit against that creature."
  it('gives an invisible attacker advantage', () => {
    expect(modesOf(attackerConditionModes(state(['invisible']), {}))).toEqual(['advantage']);
  });

  it('withholds that advantage from a target who can see them', () => {
    expect(attackerConditionModes(state(['invisible']), { targetCanSeeAttacker: true })).toEqual([]);
  });

  // SRD Frightened: disadvantage "while the source of fear is within line of sight".
  it('gives a frightened attacker disadvantage only while the source is visible', () => {
    expect(modesOf(attackerConditionModes(state(['frightened']), { fearSourceVisible: true }))).toEqual(
      ['disadvantage'],
    );
    expect(attackerConditionModes(state(['frightened']), { fearSourceVisible: false })).toEqual([]);
  });

  // SRD Grappled: "Disadvantage on attack rolls against any target other than
  // the grappler."
  it('gives a grappled attacker disadvantage against anyone but the grappler', () => {
    expect(modesOf(attackerConditionModes(state(['grappled']), {}))).toEqual(['disadvantage']);
    expect(attackerConditionModes(state(['grappled']), { targetIsGrappler: true })).toEqual([]);
  });

  it('attributes each mode to its condition', () => {
    expect(attackerConditionModes(state(['poisoned']), {})).toEqual([
      { source: 'Poisoned', mode: 'disadvantage' },
    ]);
  });

  it('reports several conditions at once', () => {
    const modes = attackerConditionModes(state(['blinded', 'poisoned']), {});
    expect(modes).toHaveLength(2);
  });
});

describe('targetConditionModes', () => {
  it.each<[ConditionName]>([
    ['blinded'],
    ['paralyzed'],
    ['petrified'],
    ['restrained'],
    ['stunned'],
    ['unconscious'],
  ])('attacks against a %s target have advantage', (name) => {
    expect(modesOf(targetConditionModes(state([name]), { withinFiveFeet: true }))).toContain(
      'advantage',
    );
  });

  it('gives attacks against an invisible target disadvantage', () => {
    expect(modesOf(targetConditionModes(state(['invisible']), {}))).toEqual(['disadvantage']);
  });

  it('withholds that when the attacker can see them', () => {
    expect(targetConditionModes(state(['invisible']), { attackerCanSeeTarget: true })).toEqual([]);
  });

  /**
   * SRD Prone: "An attack roll against you has Advantage if the attacker is
   * within 5 feet of you. Otherwise, that attack roll has Disadvantage."
   *
   * The second half is the part that gets missed — a prone target is *harder*
   * to hit at range, not merely not-easier.
   */
  it('makes a prone target easier to hit in melee', () => {
    expect(modesOf(targetConditionModes(state(['prone']), { withinFiveFeet: true }))).toEqual([
      'advantage',
    ]);
  });

  it('makes a prone target harder to hit at range', () => {
    expect(modesOf(targetConditionModes(state(['prone']), { withinFiveFeet: false }))).toEqual([
      'disadvantage',
    ]);
  });

  it('carries both halves of an unconscious target, which is also prone', () => {
    // Unconscious grants advantage outright; Prone adds disadvantage at range.
    const atRange = modesOf(targetConditionModes(state(['unconscious']), { withinFiveFeet: false }));
    expect(atRange).toContain('advantage');
    expect(atRange).toContain('disadvantage');
  });
});

describe('saveConditionEffect', () => {
  // SRD: Paralyzed, Petrified, Stunned and Unconscious all auto-fail Strength
  // and Dexterity saving throws.
  it.each<[ConditionName]>([['paralyzed'], ['petrified'], ['stunned'], ['unconscious']])(
    '%s auto-fails Strength and Dexterity saves',
    (name) => {
      expect(saveConditionEffect(state([name]), 'str').autoFail).not.toBeNull();
      expect(saveConditionEffect(state([name]), 'dex').autoFail).not.toBeNull();
    },
  );

  it('leaves other saves alone', () => {
    for (const ability of ['con', 'int', 'wis', 'cha'] as const) {
      expect(saveConditionEffect(state(['paralyzed']), ability).autoFail).toBeNull();
    }
  });

  // SRD Restrained: "You have Disadvantage on Dexterity saving throws."
  it('gives a restrained creature disadvantage on Dexterity saves only', () => {
    expect(modesOf(saveConditionEffect(state(['restrained']), 'dex').modes)).toEqual([
      'disadvantage',
    ]);
    expect(saveConditionEffect(state(['restrained']), 'str').modes).toEqual([]);
  });

  it('names the condition responsible for an auto-failure', () => {
    expect(saveConditionEffect(state(['stunned']), 'str').autoFail).toMatch(/stunned/i);
  });
});

describe('checkConditionEffect', () => {
  // SRD Blinded: "automatically fail any ability check that requires sight."
  it('auto-fails a sight-dependent check while blinded', () => {
    expect(checkConditionEffect(state(['blinded']), { requiresSight: true }).autoFail).toMatch(
      /blinded/i,
    );
  });

  it('leaves a check that does not require sight alone', () => {
    expect(checkConditionEffect(state(['blinded']), {}).autoFail).toBeNull();
  });

  // SRD Deafened: "automatically fail any ability check that requires hearing."
  it('auto-fails a hearing-dependent check while deafened', () => {
    expect(checkConditionEffect(state(['deafened']), { requiresHearing: true }).autoFail).toMatch(
      /deafened/i,
    );
  });

  it('gives a poisoned creature disadvantage on ability checks', () => {
    expect(modesOf(checkConditionEffect(state(['poisoned']), {}).modes)).toEqual(['disadvantage']);
  });

  it('gives a frightened creature disadvantage while the source is visible', () => {
    expect(
      modesOf(checkConditionEffect(state(['frightened']), { fearSourceVisible: true }).modes),
    ).toEqual(['disadvantage']);
    expect(checkConditionEffect(state(['frightened']), {}).modes).toEqual([]);
  });

  // Blinded affects attacks and sight-based checks, but is not blanket
  // disadvantage on every ability check.
  it('does not give blanket disadvantage for being blinded', () => {
    expect(checkConditionEffect(state(['blinded']), {}).modes).toEqual([]);
  });
});

describe('isAutomaticCritical', () => {
  // SRD Paralyzed and Unconscious: "Any attack roll that hits you is a Critical
  // Hit if the attacker is within 5 feet of you."
  it.each<[ConditionName]>([['paralyzed'], ['unconscious']])(
    'a hit on a %s target within 5 feet is a critical',
    (name) => {
      expect(isAutomaticCritical(state([name]), true)).toBe(true);
    },
  );

  it('does not apply beyond 5 feet', () => {
    expect(isAutomaticCritical(state(['paralyzed']), false)).toBe(false);
  });

  // Petrified and Stunned grant advantage but not automatic criticals.
  it.each<[ConditionName]>([['petrified'], ['stunned'], ['restrained']])(
    '%s does not grant automatic criticals',
    (name) => {
      expect(isAutomaticCritical(state([name]), true)).toBe(false);
    },
  );
});

describe('exhaustion', () => {
  // SRD: "When you make a D20 Test, the roll is reduced by 2 times your
  // Exhaustion level." A flat penalty, not disadvantage.
  it('reduces every D20 Test by 2 per level', () => {
    expect(exhaustionBonus(state([], 3))).toMatchObject({ flat: -6 });
  });

  it('produces no bonus at level 0', () => {
    expect(exhaustionBonus(state([], 0))).toBeNull();
  });

  it('names the level in the source', () => {
    expect(exhaustionBonus(state([], 2))?.source).toMatch(/2/);
  });

  // SRD: "Your Speed is reduced by a number of feet equal to 5 times your
  // Exhaustion level."
  it('reduces speed by 5 per level', () => {
    expect(conditionSpeed(state([], 2), 30)).toBe(20);
  });

  it('never reduces speed below zero', () => {
    expect(conditionSpeed(state([], 5), 20)).toBe(0);
  });

  // SRD: "You die if your Exhaustion level is 6."
  it('is fatal at level 6', () => {
    expect(isDeadFromExhaustion(state([], 5))).toBe(false);
    expect(isDeadFromExhaustion(state([], 6))).toBe(true);
  });
});

describe('conditionSpeed', () => {
  it.each<[ConditionName]>([
    ['grappled'],
    ['paralyzed'],
    ['petrified'],
    ['restrained'],
    ['unconscious'],
  ])('%s sets Speed to 0', (name) => {
    expect(conditionSpeed(state([name]), 30)).toBe(0);
  });

  it('leaves speed alone without a relevant condition', () => {
    expect(conditionSpeed(state(['poisoned']), 30)).toBe(30);
  });

  it('takes Speed 0 over an exhaustion reduction', () => {
    expect(conditionSpeed(state(['grappled'], 2), 30)).toBe(0);
  });
});

describe('isIncapacitated', () => {
  it('is true for Incapacitated itself', () => {
    expect(isIncapacitated(state(['incapacitated']))).toBe(true);
  });

  it.each<[ConditionName]>([['paralyzed'], ['petrified'], ['stunned'], ['unconscious']])(
    'is true through %s',
    (name) => {
      expect(isIncapacitated(state([name]))).toBe(true);
    },
  );

  it('is false otherwise', () => {
    expect(isIncapacitated(state(['poisoned']))).toBe(false);
  });
});

describe('initiativeConditionModes', () => {
  // SRD Incapacitated: "If you're Incapacitated when you roll Initiative, you
  // have Disadvantage on the roll."
  it('gives an incapacitated creature disadvantage on initiative', () => {
    expect(modesOf(initiativeConditionModes(state(['incapacitated'])))).toEqual(['disadvantage']);
  });

  // SRD Invisible: "If you're Invisible when you roll Initiative, you have
  // Advantage on the roll."
  it('gives an invisible creature advantage on initiative', () => {
    expect(modesOf(initiativeConditionModes(state(['invisible'])))).toEqual(['advantage']);
  });

  it('reports both when a creature is somehow each', () => {
    const modes = modesOf(initiativeConditionModes(state(['invisible', 'stunned'])));
    expect(modes).toContain('advantage');
    expect(modes).toContain('disadvantage');
  });
});

describe('petrified defences', () => {
  // SRD Petrified: "You have Resistance to all damage."
  it('resists all damage', () => {
    expect(resistsAllDamage(state(['petrified']))).toBe(true);
    expect(resistsAllDamage(state(['unconscious']))).toBe(false);
  });

  // SRD Petrified: "You have Immunity to the Poisoned condition."
  it('cannot become poisoned', () => {
    expect(canReceiveCondition(state(['petrified']), 'poisoned')).toBe(false);
  });

  it('can still receive other conditions', () => {
    expect(canReceiveCondition(state(['petrified']), 'charmed')).toBe(true);
  });

  it('lets an unpetrified creature be poisoned', () => {
    expect(canReceiveCondition(state([]), 'poisoned')).toBe(true);
  });
});
