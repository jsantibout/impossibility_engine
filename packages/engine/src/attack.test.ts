import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import { parseEquipment, type Weapon } from '@ie/srd';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { rerollDice, treatLowRollsAs } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
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
    expect(attackRollModes(sheet({ abilities: scores({ str: 12 }) }), { weapon: w, targetAc: 10 })).toEqual(
      ['disadvantage'],
    );
  });

  it('compares the Strength score, not the modifier', () => {
    // Str 12 and 13 share a +1 modifier but sit either side of the threshold.
    const w = weaponFixture({ kind: 'melee', properties: ['heavy'] });
    expect(attackRollModes(sheet({ abilities: scores({ str: 12 }) }), { weapon: w, targetAc: 10 })).toEqual(
      ['disadvantage'],
    );
    expect(attackRollModes(sheet({ abilities: scores({ str: 13 }) }), { weapon: w, targetAc: 10 })).toEqual(
      [],
    );
  });

  it('uses Dexterity for a heavy ranged weapon', () => {
    const w = weaponFixture({ kind: 'ranged', properties: ['heavy'] });
    const s = sheet({ abilities: scores({ str: 18, dex: 12 }) });
    expect(attackRollModes(s, { weapon: w, targetAc: 10 })).toEqual(['disadvantage']);
  });

  // SRD: "Your attack roll has Disadvantage when your target is beyond normal range."
  it('gives disadvantage beyond normal range', () => {
    const w = weaponFixture({ kind: 'ranged' });
    expect(
      attackRollModes(sheet(), { weapon: w, targetAc: 10, beyondNormalRange: true }),
    ).toEqual(['disadvantage']);
  });

  // SRD: ranged attacks have disadvantage within 5 feet of an enemy.
  it('gives disadvantage on a ranged attack in close combat', () => {
    const w = weaponFixture({ kind: 'ranged' });
    expect(attackRollModes(sheet(), { weapon: w, targetAc: 10, nearbyEnemy: true })).toEqual([
      'disadvantage',
    ]);
  });

  it('applies close-combat disadvantage to a thrown melee weapon too', () => {
    const w = weaponFixture({ kind: 'melee', properties: ['thrown'] });
    expect(
      attackRollModes(sheet(), { weapon: w, targetAc: 10, thrown: true, nearbyEnemy: true }),
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
    const result = rollAttack(issuer(), scriptedRng([12]), s, {
      weapon: weaponFixture(),
      targetAc: 16,
    });
    expect(result.roll.total).toBe(16);
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it('misses when the total is one under AC', () => {
    const result = rollAttack(issuer(), scriptedRng([12]), sheet(), {
      weapon: weaponFixture(),
      targetAc: 15,
    });
    expect(result.hit).toBe(false);
  });

  // SRD: "If you roll a 20 ... the attack hits regardless of any modifiers or
  // the target's AC." This is where naturals *do* decide the outcome.
  it('hits and crits on a natural 20 against any AC', () => {
    const s = sheet({ abilities: scores({ str: 4 }) });
    const result = rollAttack(issuer(), scriptedRng([20]), s, {
      weapon: weaponFixture(),
      targetAc: 40,
    });
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it('misses on a natural 1 against any AC', () => {
    const s = sheet({ level: 20, abilities: scores({ str: 20 }) });
    const result = rollAttack(issuer(), scriptedRng([1]), s, {
      weapon: weaponFixture(),
      targetAc: 5,
    });
    expect(result.hit).toBe(false);
    expect(result.critical).toBe(false);
  });

  it('stamps the roll with engine provenance', () => {
    const result = rollAttack(issuer(), scriptedRng([10]), sheet(), {
      weapon: weaponFixture(),
      targetAc: 10,
    });
    expect(result.roll.provenance).toMatchObject({ id: 't:1', source: 'engine' });
  });

  it('applies disadvantage from the weapon automatically', () => {
    const w = weaponFixture({ properties: ['heavy'] });
    const s = sheet({ abilities: scores({ str: 8 }) });
    const result = rollAttack(issuer(), scriptedRng([18, 4]), s, { weapon: w, targetAc: 10 });
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
    expect(damage.type).toBe('slashing');
    expect(damage.modifier).toBe(3);
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
    expect(critical.modifier).toBe(3);
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
    expect(oneHanded.notation).toBe('1d8');
    expect(twoHanded.notation).toBe('1d10');
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
    expect(damage.notation).toBeNull();
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
    expect(damage.type).toBe('bludgeoning');
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
    expect(damage.provenance.source).toBe('engine');
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
    expect(damage.notation).toBe('1d8');
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
    expect(damage.notation).toBe('1d10');
  });

  it('uses Dexterity for a Longbow', () => {
    const s = sheet({ abilities: scores({ str: 18, dex: 14 }) });
    expect(attackAbility(s, { weapon: weapon('longbow'), targetAc: 10 })).toBe('dex');
  });

  it('gives a Dexterity 12 archer disadvantage with a Longbow, which is Heavy', () => {
    const s = sheet({ abilities: scores({ dex: 12 }) });
    expect(attackRollModes(s, { weapon: weapon('longbow'), targetAc: 10 })).toEqual([
      'disadvantage',
    ]);
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
    expect(damage.roll!.dice.map((d) => d.rolled)).toEqual([1, 2]);
    expect(damage.roll!.dice.map((d) => d.value)).toEqual([3, 3]);
    expect(damage.total).toBe(3 + 3 + 3);
  });

  it('exposes the damage roll so a rule can reroll one die of it', () => {
    // Empowered Spell rerolls chosen damage dice; the caller names them by index.
    const s = sheet({ abilities: scores({ str: 16 }) });
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1, 1]), s, { weapon: weapon('greatsword'), targetAc: 10 }, false),
      'dice',
    );
    expect(damage.roll!.dice).toHaveLength(2);
    expect(damage.total).toBe(1 + 1 + 3);

    const rerolled = unwrap(
      rerollDice(scriptedRng([6]), damage.roll!, [0], 'Empowered Spell'),
      'reroll',
    );
    expect(rerolled.dice[0]!.disposition).toBe('rerolled');
    expect(rerolled.dice.at(-1)).toMatchObject({ rolled: 6, replaces: 0 });
    // 6 replaces the 1: dice now total 7, and the +3 modifier is added on top.
    expect(rerolled.total + damage.modifier).toBe(10);
  });

  it('reports no roll for flat damage, which has no dice to act on', () => {
    const damage = unwrap(
      rollAttackDamage(issuer(), scriptedRng([1]), sheet(), { weapon: weapon('blowgun'), targetAc: 10 }, false),
      'flat',
    );
    expect(damage.roll).toBeNull();
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
