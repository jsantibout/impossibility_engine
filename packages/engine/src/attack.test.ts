import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import { parseEquipment, type Weapon } from '@ie/srd';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { createRng } from './dice.js';
import { conditionState } from './conditions.js';
import { rerollDice, treatLowRollsAs } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  applyDamage,
  reduceDamage,
  applyDefenses,
  attackAbility,
  attackModifier,
  attackRollModes,
  rollAttack,
  rollAttackDamage,
} from './attack.js';

const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const scores = (over: Partial<AbilityScores> = {}): AbilityScores => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: scores(),
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const weaponFixture = (over: Partial<Weapon> = {}): Weapon => ({
  id: 'test-weapon',
  name: 'Test Weapon',
  category: 'simple',
  kind: 'melee',
  damage: { dice: '1d6', fixed: null, type: 'slashing' },
  properties: [],
  versatileDamage: null,
  thrownRange: null,
  ammunitionRange: null,
  ammunitionType: null,
  propertyNotes: null,
  mastery: 'sap',
  weightLb: 2,
  cost: { amount: 1, currency: 'gp' },
  ...over,
});

const issuer = () => createRollIssuer('t');

/** Just the modes, for assertions that do not care about attribution. */
const modesOf = (sources: readonly { mode: string }[]) => sources.map((m) => m.mode);

describe('attackAbility', () => {
  it('uses Strength for a melee weapon', () => {
    expect(attackAbility(sheet(), { weapon: weaponFixture({ kind: 'melee' }), targetAc: 10 })).toBe(
      'str',
    );
  });

  it('uses Dexterity for a ranged weapon', () => {
    expect(attackAbility(sheet(), { weapon: weaponFixture({ kind: 'ranged' }), targetAc: 10 })).toBe(
      'dex',
    );
  });

  it('uses Strength for an Unarmed Strike', () => {
    expect(attackAbility(sheet(), { weapon: null, targetAc: 10 })).toBe('str');
  });

  // SRD Finesse: "use your choice of your Strength or Dexterity modifier".
  it('picks the better ability for a finesse weapon by default', () => {
    const finesse = weaponFixture({ properties: ['finesse'] });
    expect(attackAbility(sheet({ abilities: scores({ str: 18, dex: 10 }) }), { weapon: finesse, targetAc: 10 })).toBe('str');
    expect(attackAbility(sheet({ abilities: scores({ str: 10, dex: 18 }) }), { weapon: finesse, targetAc: 10 })).toBe('dex');
  });

  it('honours an explicit finesse choice', () => {
    const finesse = weaponFixture({ properties: ['finesse'] });
    const s = sheet({ abilities: scores({ str: 18, dex: 10 }) });
    expect(attackAbility(s, { weapon: finesse, targetAc: 10, finesseAbility: 'dex' })).toBe('dex');
  });

  it('ignores an explicit finesse choice on a non-finesse weapon', () => {
    const s = sheet({ abilities: scores({ dex: 18 }) });
    expect(attackAbility(s, { weapon: weaponFixture(), targetAc: 10, finesseAbility: 'dex' })).toBe(
      'str',
    );
  });

  // SRD Thrown: "If the weapon is a Melee weapon, use the same ability modifier
  // ... that you use for a melee attack with that weapon."
  it('keeps the melee ability when a melee weapon is thrown', () => {
    const s = sheet({ abilities: scores({ str: 18, dex: 14 }) });
    const w = weaponFixture({ kind: 'melee', properties: ['thrown'] });
    expect(attackAbility(s, { weapon: w, targetAc: 10, thrown: true })).toBe('str');
  });
});

describe('attackModifier', () => {
  it('is ability plus proficiency when proficient', () => {
    const s = sheet({ level: 5, abilities: scores({ str: 18 }) });
    expect(attackModifier(s, { weapon: weaponFixture(), targetAc: 10 })).toBe(4 + 3);
  });

  it('omits proficiency when not proficient', () => {
    const s = sheet({ level: 5, abilities: scores({ str: 18 }) });
    expect(attackModifier(s, { weapon: weaponFixture(), targetAc: 10, proficient: false })).toBe(4);
  });

  // SRD Unarmed Strike: "Your bonus to the roll equals your Strength modifier
  // plus your Proficiency Bonus" — no proficiency question arises.
  it('always adds proficiency to an Unarmed Strike', () => {
    const s = sheet({ level: 5, abilities: scores({ str: 16 }) });
    expect(attackModifier(s, { weapon: null, targetAc: 10, proficient: false })).toBe(3 + 3);
  });
});

describe('attackRollModes', () => {
  // SRD Heavy: disadvantage if a melee Heavy weapon and Strength score isn't at
  // least 13, or a ranged Heavy weapon and Dexterity score isn't at least 13.
  it('gives disadvantage on a heavy melee weapon below Strength 13', () => {
    const w = weaponFixture({ kind: 'melee', properties: ['heavy'] });
    expect(
      modesOf(attackRollModes(sheet({ abilities: scores({ str: 12 }) }), { weapon: w, targetAc: 10 })),
    ).toEqual(['disadvantage']);
  });

  it('compares the Strength score, not the modifier', () => {
    // Str 12 and 13 share a +1 modifier but sit either side of the threshold.
    const w = weaponFixture({ kind: 'melee', properties: ['heavy'] });
    expect(
      modesOf(attackRollModes(sheet({ abilities: scores({ str: 12 }) }), { weapon: w, targetAc: 10 })),
    ).toEqual(['disadvantage']);
    expect(attackRollModes(sheet({ abilities: scores({ str: 13 }) }), { weapon: w, targetAc: 10 })).toEqual(
      [],
    );
  });

  it('uses Dexterity for a heavy ranged weapon', () => {
    const w = weaponFixture({ kind: 'ranged', properties: ['heavy'] });
    const s = sheet({ abilities: scores({ str: 18, dex: 12 }) });
    expect(modesOf(attackRollModes(s, { weapon: w, targetAc: 10 }))).toEqual(['disadvantage']);
  });

  // SRD: "Your attack roll has Disadvantage when your target is beyond normal range."
  it('gives disadvantage beyond normal range', () => {
    const w = weaponFixture({ kind: 'ranged' });
    expect(
      modesOf(attackRollModes(sheet(), { weapon: w, targetAc: 10, beyondNormalRange: true })),
    ).toEqual(['disadvantage']);
  });

  // SRD: ranged attacks have disadvantage within 5 feet of an enemy.
  it('gives disadvantage on a ranged attack in close combat', () => {
    const w = weaponFixture({ kind: 'ranged' });
    expect(modesOf(attackRollModes(sheet(), { weapon: w, targetAc: 10, nearbyEnemy: true }))).toEqual(['disadvantage']);
  });

  it('applies close-combat disadvantage to a thrown melee weapon too', () => {
    const w = weaponFixture({ kind: 'melee', properties: ['thrown'] });
    expect(
      modesOf(attackRollModes(sheet(), { weapon: w, targetAc: 10, thrown: true, nearbyEnemy: true })),
    ).toEqual(['disadvantage']);
  });

  it('does not apply close-combat disadvantage to a melee attack', () => {
    expect(
      attackRollModes(sheet(), { weapon: weaponFixture(), targetAc: 10, nearbyEnemy: true }),
    ).toEqual([]);
  });
});

describe('rollAttack', () => {
  it('hits when the total equals AC', () => {
    const s = sheet({ abilities: scores({ str: 14 }) });
    // natural 12 + str 2 + prof 2 = 16
    const result = unwrap(rollAttack(issuer(), scriptedRng([12]), s, {
      weapon: weaponFixture(),
      targetAc: 16,
    }), 'attack');
    expect(result.roll.total).toBe(16);
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it('misses when the total is one under AC', () => {
    const result = unwrap(rollAttack(issuer(), scriptedRng([12]), sheet(), {
      weapon: weaponFixture(),
      targetAc: 15,
    }), 'attack');
    expect(result.hit).toBe(false);
  });

  // SRD: "If you roll a 20 ... the attack hits regardless of any modifiers or
  // the target's AC." This is where naturals *do* decide the outcome.
  it('hits and crits on a natural 20 against any AC', () => {
    const s = sheet({ abilities: scores({ str: 4 }) });
    const result = unwrap(rollAttack(issuer(), scriptedRng([20]), s, {
      weapon: weaponFixture(),
      targetAc: 40,
    }), 'attack');
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it('misses on a natural 1 against any AC', () => {
    const s = sheet({ level: 20, abilities: scores({ str: 20 }) });
    const result = unwrap(rollAttack(issuer(), scriptedRng([1]), s, {
      weapon: weaponFixture(),
      targetAc: 5,
    }), 'attack');
    expect(result.hit).toBe(false);
    expect(result.critical).toBe(false);
  });

  it('stamps the roll with engine provenance', () => {
    const result = unwrap(rollAttack(issuer(), scriptedRng([10]), sheet(), {
      weapon: weaponFixture(),
      targetAc: 10,
    }), 'attack');
    expect(result.roll.provenance).toMatchObject({ id: 't:1', source: 'engine' });
  });

  it('applies disadvantage from the weapon automatically', () => {
    const w = weaponFixture({ properties: ['heavy'] });
    const s = sheet({ abilities: scores({ str: 8 }) });
    const result = unwrap(rollAttack(issuer(), scriptedRng([18, 4]), s, { weapon: w, targetAc: 10 }), 'attack');
    expect(result.mode).toBe('disadvantage');
    expect(result.roll.natural).toBe(4);
  });
});

describe('rollAttackDamage', () => {
  it('adds the attack ability modifier to the weapon dice', () => {
    const s = sheet({ abilities: scores({ str: 16 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([4]), s, { weapon: weaponFixture(), targetAc: 10 }, false),
      'damage',
    );
    expect(damage.components[0]!.type).toBe('slashing');
    expect(damage.components[0]!.flat).toBe(3);
    expect(damage.total).toBe(7);
  });

  // SRD Critical Hits: "Roll the attack's damage dice twice, add them together,
  // and add any relevant modifiers as normal." The modifier is *not* doubled.
  it('doubles the damage dice but not the modifier on a critical hit', () => {
    const s = sheet({ abilities: scores({ str: 16 }) });
    const w = weaponFixture({ damage: { dice: '1d8', fixed: null, type: 'piercing' } });
    // Scripted 5 on every die: normal is 5 + 3, critical is 5 + 5 + 3.
    const normal = unwrap(
      rollAttackDamage(issuer(), scriptedRng([5]), s, { weapon: w, targetAc: 10 }, false),
      'normal',
    );
    const critical = unwrap(
      rollAttackDamage(issuer(), scriptedRng([5]), s, { weapon: w, targetAc: 10 }, true),
      'critical',
    );
    expect(normal.total).toBe(8);
    expect(critical.total).toBe(13);
    expect(critical.components[0]!.flat).toBe(3);
    expect(critical.critical).toBe(true);
  });

  // SRD Versatile: "The weapon deals that damage when used with two hands".
  it('uses the versatile damage die in two hands', () => {
    const w = weaponFixture({
      damage: { dice: '1d8', fixed: null, type: 'slashing' },
      properties: ['versatile'],
      versatileDamage: '1d10',
    });
    const oneHanded = unwrap(
      rollAttackDamage(issuer(), scriptedRng([6]), sheet(), { weapon: w, targetAc: 10 }, false),
      'one',
    );
    const twoHanded = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([6]),
        sheet(),
        { weapon: w, targetAc: 10, twoHanded: true },
        false,
      ),
      'two',
    );
    expect(oneHanded.components[0]!.roll!.notation.sides).toBe(8);
    expect(twoHanded.components[0]!.roll!.notation.sides).toBe(10);
  });

  it('handles the Blowgun, whose damage is a flat 1 with no dice', () => {
    const w = weaponFixture({
      kind: 'ranged',
      damage: { dice: null, fixed: 1, type: 'piercing' },
    });
    const s = sheet({ abilities: scores({ dex: 16 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([5]), s, { weapon: w, targetAc: 10 }, false),
      'flat',
    );
    expect(damage.components[0]!.roll).toBeNull();
    expect(damage.total).toBe(1 + 3);
  });

  it('leaves flat damage unchanged by a critical hit, having no dice to double', () => {
    const w = weaponFixture({ kind: 'ranged', damage: { dice: null, fixed: 1, type: 'piercing' } });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([5]), sheet(), { weapon: w, targetAc: 10 }, true),
      'flat-crit',
    );
    expect(damage.total).toBe(1);
  });

  // SRD Unarmed Strike: "the target takes Bludgeoning damage equal to 1 plus
  // your Strength modifier."
  it('deals 1 plus Strength for an Unarmed Strike', () => {
    const s = sheet({ abilities: scores({ str: 18 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([5]), s, { weapon: null, targetAc: 10 }, false),
      'unarmed',
    );
    expect(damage.components[0]!.type).toBe('bludgeoning');
    expect(damage.total).toBe(1 + 4);
  });

  it('never deals negative damage', () => {
    const s = sheet({ abilities: scores({ str: 1 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1]), s, { weapon: weaponFixture(), targetAc: 10 }, false),
      'floor',
    );
    expect(damage.total).toBe(0);
  });

  it('stamps damage with engine provenance', () => {
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([3]), sheet(), { weapon: weaponFixture(), targetAc: 10 }, false),
      'prov',
    );
    expect(damage.components[0]!.roll!.provenance.source).toBe('engine');
  });

  it('reports a problem for a weapon with unusable damage', () => {
    const w = weaponFixture({ damage: { dice: 'nonsense', fixed: null, type: 'slashing' } });
    expect(isErr(rollAttackDamage(issuer(), scriptedRng([3]), sheet(), { weapon: w, targetAc: 10 }, false))).toBe(true);
  });
});

describe('applyDefenses', () => {
  it('leaves plain damage alone', () => {
    expect(applyDefenses(10, {})).toBe(10);
  });

  it('halves against resistance, rounding down', () => {
    expect(applyDefenses(11, { resistant: true })).toBe(5);
  });

  it('doubles against vulnerability', () => {
    expect(applyDefenses(11, { vulnerable: true })).toBe(22);
  });

  it('zeroes against immunity, whatever else applies', () => {
    expect(applyDefenses(40, { immune: true, vulnerable: true })).toBe(0);
  });

  /**
   * The SRD's own worked example, verbatim:
   *
   * "a creature has Resistance to all damage and Vulnerability to Fire damage,
   * and it's within a magical aura that reduces all damage by 5. If it takes 28
   * Fire damage, the damage is first reduced by 5 (to 23), then halved for the
   * creature's Resistance (and rounded down to 11), then doubled for its
   * Vulnerability (to 22)."
   *
   * Order matters: halving before doubling gives 22, doubling first gives 23.
   */
  it('follows the SRD order of application exactly', () => {
    expect(applyDefenses(28, { resistant: true, vulnerable: true }, -5)).toBe(22);
  });

  it('applies adjustments before resistance', () => {
    // 20 - 4 = 16, halved = 8. Halving first would give 10 - 4 = 6.
    expect(applyDefenses(20, { resistant: true }, -4)).toBe(8);
  });

  it('clamps to zero when an adjustment exceeds the damage', () => {
    expect(applyDefenses(3, {}, -10)).toBe(0);
    expect(applyDefenses(3, { vulnerable: true }, -10)).toBe(0);
  });

  it('does not stack repeated resistance, being a boolean', () => {
    expect(applyDefenses(100, { resistant: true })).toBe(50);
  });
});

describe('against real SRD weapons', () => {
  const markdown = readFileSync(
    fileURLToPath(new URL('../../srd/raw/equipment.md', import.meta.url)),
    'utf8',
  );
  const { weapons } = parseEquipment(markdown, 'equipment.md');
  const weapon = (id: string): Weapon => {
    const found = weapons.find((w) => w.id === id);
    if (!found) throw new Error(`fixture missing: ${id}`);
    return found;
  };

  it('rolls a Longsword one-handed as 1d8 plus Strength', () => {
    const s = sheet({ level: 1, abilities: scores({ str: 16 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([6]), s, { weapon: weapon('longsword'), targetAc: 10 }, false),
      'longsword',
    );
    expect(damage.components[0]!.roll!.notation.sides).toBe(8);
    expect(damage.total).toBe(6 + 3);
  });

  it('rolls a Longsword two-handed as 1d10', () => {
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([6]),
        sheet(),
        { weapon: weapon('longsword'), targetAc: 10, twoHanded: true },
        false,
      ),
      'versatile',
    );
    expect(damage.components[0]!.roll!.notation.sides).toBe(10);
  });

  it('uses Dexterity for a Longbow', () => {
    const s = sheet({ abilities: scores({ str: 18, dex: 14 }) });
    expect(attackAbility(s, { weapon: weapon('longbow'), targetAc: 10 })).toBe('dex');
  });

  it('gives a Dexterity 12 archer disadvantage with a Longbow, which is Heavy', () => {
    const s = sheet({ abilities: scores({ dex: 12 }) });
    expect(modesOf(attackRollModes(s, { weapon: weapon('longbow'), targetAc: 10 }))).toEqual(['disadvantage']);
  });

  it('lets a Dagger use Dexterity through Finesse', () => {
    const s = sheet({ abilities: scores({ str: 10, dex: 18 }) });
    expect(attackAbility(s, { weapon: weapon('dagger'), targetAc: 10 })).toBe('dex');
  });

  it('applies Great Weapon Fighting to a two-handed Greatsword', () => {
    // SRD 2024: treat any 1 or 2 on a damage die as a 3. A Greatsword is 2d6,
    // so a 1 and a 2 become 3 and 3 — and no extra dice are rolled, because
    // the 2024 wording substitutes rather than rerolling.
    const s = sheet({ abilities: scores({ str: 16 }) });
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([1, 2]),
        s,
        {
          weapon: weapon('greatsword'),
          targetAc: 10,
          damageEffects: [treatLowRollsAs(2, 3, 'Great Weapon Fighting')],
        },
        false,
      ),
      'gwf',
    );
    expect(damage.components[0]!.roll!.dice.map((d) => d.rolled)).toEqual([1, 2]);
    expect(damage.components[0]!.roll!.dice.map((d) => d.value)).toEqual([3, 3]);
    expect(damage.total).toBe(3 + 3 + 3);
  });

  it('exposes the damage roll so a rule can reroll one die of it', () => {
    // Empowered Spell rerolls chosen damage dice; the caller names them by index.
    const s = sheet({ abilities: scores({ str: 16 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1, 1]), s, { weapon: weapon('greatsword'), targetAc: 10 }, false),
      'dice',
    );
    expect(damage.components[0]!.roll!.dice).toHaveLength(2);
    expect(damage.total).toBe(1 + 1 + 3);

    const rerolled = unwrap(
      rerollDice(scriptedRng([6]), damage.components[0]!.roll!, [0], 'Empowered Spell'),
      'reroll',
    );
    expect(rerolled.dice[0]!.disposition).toBe('rerolled');
    expect(rerolled.dice.at(-1)).toMatchObject({ rolled: 6, replaces: 0 });
    // 6 replaces the 1: dice now total 7, and the +3 modifier is added on top.
    expect(rerolled.total + damage.components[0]!.flat).toBe(10);
  });

  it('reports no roll for flat damage, which has no dice to act on', () => {
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1]), sheet(), { weapon: weapon('blowgun'), targetAc: 10 }, false),
      'flat',
    );
    expect(damage.components[0]!.roll).toBeNull();
  });

  it('rolls the Blowgun as a flat 1 plus Dexterity', () => {
    const s = sheet({ abilities: scores({ dex: 14 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1]), s, { weapon: weapon('blowgun'), targetAc: 10 }, false),
      'blowgun',
    );
    expect(damage.total).toBe(1 + 2);
  });
});

describe('bonuses to attack rolls', () => {
  // SRD: "You gain a +1 bonus to attack rolls and damage rolls made with this
  // magic weapon."
  it('adds a magic weapon bonus to the attack roll', () => {
    const s = sheet({ abilities: scores({ str: 14 }) });
    const plain = unwrap(
      rollAttack(issuer(), scriptedRng([10]), s, { weapon: weaponFixture(), targetAc: 10 }),
      'plain',
    );
    const magic = unwrap(
      rollAttack(issuer(), scriptedRng([10]), s, {
        weapon: weaponFixture(),
        targetAc: 10,
        attackBonuses: [{ source: 'Longsword +1', flat: 1 }],
      }),
      'magic',
    );
    expect(magic.total).toBe(plain.total + 1);
  });

  // SRD Archery: "+2 bonus to attack rolls you make with Ranged weapons."
  it('adds a fighting style bonus', () => {
    const s = sheet({ abilities: scores({ dex: 14 }) });
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([10]), s, {
        weapon: weaponFixture({ kind: 'ranged' }),
        targetAc: 10,
        attackBonuses: [{ source: 'Archery', flat: 2 }],
      }),
      'archery',
    );
    // 10 + dex 2 + prof 2 + archery 2
    expect(result.total).toBe(16);
  });

  it('stacks several flat bonuses', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([10]), sheet(), {
        weapon: weaponFixture(),
        targetAc: 10,
        attackBonuses: [
          { source: 'Longsword +2', flat: 2 },
          { source: 'Archery', flat: 2 },
        ],
      }),
      'stack',
    );
    expect(result.total).toBe(10 + 2 + 2 + 2);
  });

  // Bless adds a die rather than a flat number.
  it('rolls a dice bonus and adds it', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([10, 3]), sheet(), {
        weapon: weaponFixture(),
        targetAc: 10,
        attackBonuses: [{ source: 'Bless', dice: '1d4' }],
      }),
      'bless',
    );
    expect(result.bonuses).toHaveLength(1);
    expect(result.bonuses[0]).toMatchObject({ source: 'Bless', total: 3 });
    expect(result.total).toBe(10 + 2 + 3);
  });

  it('keeps a dice bonus out of the d20 result itself', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([10, 4]), sheet(), {
        weapon: weaponFixture(),
        targetAc: 10,
        attackBonuses: [{ source: 'Bless', dice: '1d4' }],
      }),
      'separate',
    );
    expect(result.roll.total).toBe(12);
    expect(result.total).toBe(16);
  });

  it('lets a bonus turn a miss into a hit', () => {
    const options = { weapon: weaponFixture(), targetAc: 15 };
    expect(unwrap(rollAttack(issuer(), scriptedRng([12]), sheet(), options), 'miss').hit).toBe(
      false,
    );
    expect(
      unwrap(
        rollAttack(issuer(), scriptedRng([12]), sheet(), {
          ...options,
          attackBonuses: [{ source: 'Longsword +1', flat: 1 }],
        }),
        'hit',
      ).hit,
    ).toBe(true);
  });

  it('never lets a bonus rescue a natural 1', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([1]), sheet(), {
        weapon: weaponFixture(),
        targetAc: 5,
        attackBonuses: [
          { source: 'Longsword +3', flat: 3 },
          { source: 'Bless', dice: '1d4' },
        ],
      }),
      'fumble',
    );
    expect(result.hit).toBe(false);
  });
});

describe('bonuses to damage', () => {
  it('adds a magic weapon bonus to damage of the weapon type', () => {
    const s = sheet({ abilities: scores({ str: 14 }) });
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([4]),
        s,
        {
          weapon: weaponFixture(),
          targetAc: 10,
          damageBonuses: [{ source: 'Longsword +1', flat: 1 }],
        },
        false,
      ),
      'magic',
    );
    expect(damage.total).toBe(4 + 2 + 1);
    expect(damage.components).toHaveLength(2);
    expect(damage.components[1]).toMatchObject({
      source: 'Longsword +1',
      type: 'slashing',
      total: 1,
    });
  });

  // Bracers of Archery add damage but not attack; Dueling likewise.
  it('keeps a damage-only bonus off the attack roll', () => {
    const options = {
      weapon: weaponFixture({ kind: 'ranged' }),
      targetAc: 10,
      damageBonuses: [{ source: 'Bracers of Archery', flat: 2 }],
    };
    const attack = unwrap(rollAttack(issuer(), scriptedRng([10]), sheet(), options), 'attack');
    expect(attack.total).toBe(12);

    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([3]), sheet(), options, false),
      'damage',
    );
    expect(damage.total).toBe(5);
  });

  it('records each bonus as its own component with its source', () => {
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([3]),
        sheet(),
        {
          weapon: weaponFixture(),
          targetAc: 10,
          damageBonuses: [
            { source: 'Longsword +1', flat: 1 },
            { source: 'Dueling', flat: 2 },
          ],
        },
        false,
      ),
      'sources',
    );
    expect(damage.components.map((c) => c.source)).toEqual([
      'Test Weapon',
      'Longsword +1',
      'Dueling',
    ]);
  });
});

describe('extra damage of another type', () => {
  // SRD Flame Tongue: "deals an extra 2d6 Fire damage on a hit."
  const flameTongue = { source: 'Flame Tongue', type: 'fire', dice: '2d6' };

  it('keeps extra damage in its own typed component', () => {
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([4]),
        sheet(),
        { weapon: weaponFixture(), targetAc: 10, extraDamage: [flameTongue] },
        false,
      ),
      'flame',
    );
    expect(damage.components).toHaveLength(2);
    expect(damage.components[0]).toMatchObject({ type: 'slashing', total: 4 });
    expect(damage.components[1]).toMatchObject({ source: 'Flame Tongue', type: 'fire', total: 8 });
    expect(damage.total).toBe(12);
  });

  // SRD Critical Hits: "If the attack involves other damage dice ... you also
  // roll those dice twice."
  it('doubles extra damage dice on a critical hit', () => {
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([4]),
        sheet(),
        { weapon: weaponFixture(), targetAc: 10, extraDamage: [flameTongue] },
        true,
      ),
      'crit',
    );
    // Weapon 1d6 -> 2d6 at 4 each; fire 2d6 -> 4d6 at 4 each.
    expect(damage.components[0]!.total).toBe(8);
    expect(damage.components[1]!.total).toBe(16);
  });

  it('never doubles a flat bonus on a critical hit', () => {
    const s = sheet({ abilities: scores({ str: 14 }) });
    const damage = unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([4]),
        s,
        {
          weapon: weaponFixture(),
          targetAc: 10,
          damageBonuses: [{ source: 'Longsword +1', flat: 1 }],
          extraDamage: [{ source: 'Rage', type: 'slashing', flat: 2 }],
        },
        true,
      ),
      'flat-crit',
    );
    expect(damage.components[1]!.total).toBe(1);
    expect(damage.components[2]!.total).toBe(2);
  });
});

describe('applyDamage across types', () => {
  const components = [
    { source: 'Longsword', type: 'slashing', roll: null, flat: 9, total: 9 },
    { source: 'Flame Tongue', type: 'fire', roll: null, flat: 8, total: 8 },
  ];

  it('sums damage unchanged when the target has no relevant defences', () => {
    expect(applyDamage(components, {})).toEqual({
      byType: { slashing: 9, fire: 8 },
      total: 17,
    });
  });

  // The reason damage is typed at all: a fire-immune target still takes the
  // sword's slashing damage.
  it('zeroes only the immune type', () => {
    expect(applyDamage(components, { fire: { immune: true } })).toEqual({
      byType: { slashing: 9, fire: 0 },
      total: 9,
    });
  });

  it('resists one type without touching the other', () => {
    expect(applyDamage(components, { slashing: { resistant: true } })).toEqual({
      byType: { slashing: 4, fire: 8 },
      total: 12,
    });
  });

  it('applies vulnerability per type', () => {
    expect(
      applyDamage(components, { fire: { vulnerable: true }, slashing: { resistant: true } }),
    ).toEqual({ byType: { slashing: 4, fire: 16 }, total: 20 });
  });

  // Halving each component separately would round down twice and undercount:
  // 5 and 5 halved separately is 4, but 10 halved once is 5.
  it('sums a type before halving it, not after', () => {
    const split = [
      { source: 'a', type: 'fire', roll: null, flat: 5, total: 5 },
      { source: 'b', type: 'fire', roll: null, flat: 5, total: 5 },
    ];
    expect(applyDamage(split, { fire: { resistant: true } }).total).toBe(5);
  });

  it('applies a per-type adjustment before resistance', () => {
    expect(applyDamage(components, { fire: { resistant: true } }, { fire: -2 }).byType.fire).toBe(3);
  });
});

describe('conditions feed into attacks', () => {
  const w = () => weaponFixture();

  it('gives a Blinded attacker disadvantage', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([18, 5]), sheet(), {
        weapon: w(),
        targetAc: 10,
        attackerConditions: conditionState(['blinded']),
      }),
      'blind',
    );
    expect(result.mode).toBe('disadvantage');
    expect(result.roll.natural).toBe(5);
  });

  it('gives advantage against a Restrained target', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([5, 18]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['restrained']),
      }),
      'restrained',
    );
    expect(result.mode).toBe('advantage');
  });

  it('cancels a Blinded attacker against a Restrained target', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([5, 18]), sheet(), {
        weapon: w(),
        targetAc: 10,
        attackerConditions: conditionState(['blinded']),
        targetConditions: conditionState(['restrained']),
      }),
      'cancel',
    );
    expect(result.mode).toBe('normal');
    expect(result.roll.rolls).toEqual([5]);
  });

  /**
   * SRD Prone: advantage within 5 feet, "Otherwise, that attack roll has
   * Disadvantage." A prone target is harder to hit at range.
   */
  it('makes a Prone target easier to hit in melee and harder at range', () => {
    const melee = unwrap(
      rollAttack(issuer(), scriptedRng([5, 18]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['prone']),
        withinFiveFeet: true,
      }),
      'melee',
    );
    expect(melee.mode).toBe('advantage');

    const ranged = unwrap(
      rollAttack(issuer(), scriptedRng([18, 5]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['prone']),
        withinFiveFeet: false,
      }),
      'ranged',
    );
    expect(ranged.mode).toBe('disadvantage');
  });

  // SRD Paralyzed: "Any attack roll that hits you is a Critical Hit if the
  // attacker is within 5 feet of you." Not just a natural 20.
  it('turns an ordinary hit on a Paralyzed target into a critical in melee', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([12, 12]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['paralyzed']),
        withinFiveFeet: true,
      }),
      'autocrit',
    );
    expect(result.roll.natural).toBe(12);
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it('does not auto-crit beyond 5 feet', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([12, 12]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['paralyzed']),
        withinFiveFeet: false,
      }),
      'no-autocrit',
    );
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it('does not auto-crit a miss', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([1, 1]), sheet(), {
        weapon: w(),
        targetAc: 10,
        targetConditions: conditionState(['unconscious']),
        withinFiveFeet: true,
      }),
      'miss',
    );
    expect(result.hit).toBe(false);
    expect(result.critical).toBe(false);
  });

  it('subtracts the attacker’s exhaustion penalty from the attack roll', () => {
    const result = unwrap(
      rollAttack(issuer(), scriptedRng([15]), sheet(), {
        weapon: w(),
        targetAc: 10,
        attackerConditions: conditionState([], 2),
      }),
      'exhausted',
    );
    // 15 + prof 2 - 4
    expect(result.total).toBe(13);
  });

  it('gives an Invisible attacker advantage unless the target can see them', () => {
    const unseen = unwrap(
      rollAttack(issuer(), scriptedRng([5, 18]), sheet(), {
        weapon: w(),
        targetAc: 10,
        attackerConditions: conditionState(['invisible']),
      }),
      'unseen',
    );
    expect(unseen.mode).toBe('advantage');

    const seen = unwrap(
      rollAttack(issuer(), scriptedRng([5, 18]), sheet(), {
        weapon: w(),
        targetAc: 10,
        attackerConditions: conditionState(['invisible']),
        attackerContext: { targetCanSeeAttacker: true },
      }),
      'seen',
    );
    expect(seen.mode).toBe('normal');
  });
});

describe('reduceDamage — Cutting Words', () => {
  const rolled = () =>
    unwrap(
      rollAttackDamage(
        issuer(),
        scriptedRng([5]),
        sheet({ abilities: scores({ str: 16 }) }),
        {
          weapon: weaponFixture({ damage: { dice: '1d8', fixed: null, type: 'slashing' } }),
          targetAc: 10,
          extraDamage: [{ source: 'Flame Tongue', type: 'fire', dice: '2d6' }],
        },
        false,
      ),
      'damage',
    );

  /**
   * SRD Cutting Words applies to damage rolls, not only D20 Tests: "subtract
   * the number rolled from the creature's roll, reducing the damage".
   */
  it('takes the rolled amount off the total', () => {
    const damage = rolled();
    // 1d8 at 5 plus Strength 3, and 2d6 at 5 each.
    expect(damage.total).toBe(18);

    const cut = unwrap(
      reduceDamage(issuer(), scriptedRng([4]), damage, { source: 'Cutting Words', dice: '1d6' }),
      'cut',
    );
    expect(cut.total).toBe(14);
  });

  it('records what was subtracted and by whom', () => {
    const cut = unwrap(
      reduceDamage(issuer(), scriptedRng([3]), rolled(), { source: 'Cutting Words', dice: '1d6' }),
      'cut',
    );
    expect(cut.reductions).toHaveLength(1);
    expect(cut.reductions[0]).toMatchObject({ source: 'Cutting Words', amount: 3 });
  });

  /**
   * The reduction comes off the total, never off a component. Subtracting it
   * from the slashing half of a flaming sword would give a fire-immune target
   * the wrong answer — the exact error typed components exist to prevent.
   */
  it('leaves the typed components untouched', () => {
    const damage = rolled();
    const cut = unwrap(
      reduceDamage(issuer(), scriptedRng([4]), damage, { source: 'Cutting Words', dice: '1d6' }),
      'cut',
    );
    expect(cut.components).toEqual(damage.components);
  });

  it('never reduces damage below zero', () => {
    const cut = unwrap(
      reduceDamage(issuer(), scriptedRng([1]), rolled(), { source: 'Enormous', flat: 100 }),
      'cut',
    );
    expect(cut.total).toBe(0);
  });

  it('accumulates more than one reduction', () => {
    let damage = rolled();
    damage = unwrap(reduceDamage(issuer(), scriptedRng([2]), damage, { source: 'a', dice: '1d6' }), 'a');
    damage = unwrap(reduceDamage(issuer(), scriptedRng([3]), damage, { source: 'b', dice: '1d6' }), 'b');
    expect(damage.reductions).toHaveLength(2);
    expect(damage.total).toBe(13);
  });
});

describe('an invalid attack consumes nothing', () => {
  it('leaves the generator and roll counter untouched on a malformed bonus', () => {
    const i = createRollIssuer('t');
    const rng = createRng('seed');
    const before = rng.snapshot();

    const result = rollAttack(i, rng, sheet(), {
      weapon: weaponFixture(),
      targetAc: 10,
      attackBonuses: [{ source: 'Broken', dice: 'nonsense' }],
    });

    expect(isErr(result)).toBe(true);
    expect(i.count).toBe(0);
    expect(rng.snapshot()).toEqual(before);
  });

  it('does the same for malformed extra damage', () => {
    const i = createRollIssuer('t');
    const rng = createRng('seed');
    const before = rng.snapshot();

    const result = rollAttackDamage(
      i,
      rng,
      sheet(),
      {
        weapon: weaponFixture(),
        targetAc: 10,
        extraDamage: [{ source: 'Broken', type: 'fire', dice: 'not-dice' }],
      },
      false,
    );

    expect(isErr(result)).toBe(true);
    expect(i.count).toBe(0);
    expect(rng.snapshot()).toEqual(before);
  });

  it('still consumes a roll for an attack that simply misses', () => {
    const i = createRollIssuer('t');
    const rng = createRng('seed');
    const result = unwrap(rollAttack(i, rng, sheet(), { weapon: weaponFixture(), targetAc: 40 }), 'miss');
    expect(result.hit).toBe(false);
    expect(i.count).toBeGreaterThan(0);
  });
});
