import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { parseMonsters, type Monster } from '@ie/srd';
import { adaptMonster, monsterCanReceive } from './monster.js';
import {
  armorClass,
  modifierFor,
  proficiencyBonus,
  saveModifier,
  skillModifier,
} from './character.js';
import { applyDamage } from './attack.js';
import { applyDamageToVitals, isDown } from './vitals.js';
import { createRollIssuer } from './rolls.js';
import { rollSavingThrow } from './checks.js';
import type { Rng, RngState } from './dice.js';

const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const bestiary = parseMonsters(
  readFileSync(fileURLToPath(new URL('../../srd/raw/monsters-A-Z.md', import.meta.url)), 'utf8'),
  'monsters-A-Z.md',
).items;

const monster = (id: string): Monster => {
  const found = bestiary.find((m) => m.id === id);
  if (!found) throw new Error(`no such monster: ${id}`);
  return found;
};

const adapt = (id: string) => adaptMonster(monster(id), asCharacterId(id));

describe('a stat block states its numbers rather than deriving them', () => {
  it('uses the printed Armour Class', () => {
    // Derivation would give 10 + Dex, which is 12 for a Goblin Warrior.
    const goblin = adapt('goblin-warrior');
    expect(goblin.sheet.stated?.armorClass).toBe(15);
    expect(armorClass(goblin.sheet)).toBe(15);
  });

  it('uses the printed proficiency bonus, not one derived from a level', () => {
    // A level-1 character would derive +2; this dragon is CR 17.
    expect(proficiencyBonus(adapt('adult-red-dragon').sheet)).toBe(6);
  });

  /**
   * The reason saves are stated rather than reverse-engineered: an Adult Red
   * Dragon's Dexterity modifier is +0 and its Dexterity save is +6. No
   * combination of proficiency and ability produces that from a character
   * sheet, and rounding it to one would change the monster.
   */
  it('uses printed saving throws even where no derivation reaches them', () => {
    const dragon = adapt('adult-red-dragon');
    expect(modifierFor(dragon.sheet, 'dex')).toBe(0);
    expect(saveModifier(dragon.sheet, 'dex')).toBe(6);
  });

  it('uses printed skill bonuses', () => {
    const dragon = adapt('adult-red-dragon');
    expect(skillModifier(dragon.sheet, 'perception')).toBe(13);
    expect(skillModifier(dragon.sheet, 'stealth')).toBe(6);
  });

  it('carries ability scores across intact', () => {
    const goblin = adapt('goblin-warrior');
    expect(goblin.sheet.abilities.dex).toBe(15);
    expect(modifierFor(goblin.sheet, 'dex')).toBe(2);
  });

  it('leaves a skill the stat block does not list to ordinary derivation', () => {
    // Goblin Warriors list only Stealth, so Athletics falls back to Strength.
    const goblin = adapt('goblin-warrior');
    expect(skillModifier(goblin.sheet, 'athletics')).toBe(modifierFor(goblin.sheet, 'str'));
  });

  it('leaves a character sheet unaffected by any of this', () => {
    const character = {
      level: 5,
      abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: true, medium: true, heavy: true, shields: true },
      baseSpeed: 30,
      spellcastingAbility: null,
    } as const;
    expect(armorClass(character)).toBe(13);
    expect(proficiencyBonus(character)).toBe(3);
  });
});

describe('defences', () => {
  /**
   * A stat block prints damage types and conditions in one run. A Zombie's
   * immunities read "Poison, Exhaustion, Poisoned" — one damage type and two
   * conditions — and the engine treats the two completely differently.
   */
  it('separates damage immunities from condition immunities', () => {
    const zombie = adapt('zombie');
    expect(zombie.defenses.byDamageType.poison).toEqual({ immune: true });
    expect(zombie.defenses.conditionImmunities).toContain('exhaustion');
    expect(zombie.defenses.conditionImmunities).toContain('poisoned');
    expect(zombie.defenses.conditionImmunities).not.toContain('poison');
  });

  it('records a damage resistance', () => {
    const succubus = adapt('succubus');
    expect(succubus.defenses.byDamageType.cold).toEqual({ resistant: true });
    expect(succubus.defenses.byDamageType.fire).toEqual({ resistant: true });
  });

  it('gives a fire-immune dragon nothing from its own breath', () => {
    const dragon = adapt('adult-red-dragon');
    expect(dragon.defenses.byDamageType.fire).toEqual({ immune: true });
  });

  it('feeds straight into applyDamage', () => {
    const zombie = adapt('zombie');
    const landed = applyDamage(
      [
        { source: 'Longsword', type: 'slashing', roll: null, flat: 8, total: 8 },
        { source: 'Poison Spray', type: 'poison', roll: null, flat: 11, total: 11 },
      ],
      zombie.defenses.byDamageType,
    );
    expect(landed.byType).toEqual({ slashing: 8, poison: 0 });
    expect(landed.total).toBe(8);
  });

  it('reports which conditions a monster cannot be given', () => {
    const zombie = adapt('zombie');
    expect(monsterCanReceive(zombie, 'poisoned')).toBe(false);
    expect(monsterCanReceive(zombie, 'prone')).toBe(true);
  });

  /**
   * "Charmed (except from its vampire master)" is a real restriction that no
   * boolean captures. The immunity still registers, and the caveat is kept
   * verbatim so narration and the DM still have it.
   */
  it('keeps a qualified immunity, and its qualification', () => {
    const qualified: Monster = {
      ...monster('zombie'),
      immunities: ['Charmed (except from its vampire master)'],
    };
    const adapted = adaptMonster(qualified, asCharacterId('spawn'));
    expect(adapted.defenses.conditionImmunities).toContain('charmed');
    expect(adapted.caveats.some((c) => c.includes('vampire master'))).toBe(true);
  });

  it('keeps an entry it recognises as neither, rather than silently dropping it', () => {
    const odd: Monster = { ...monster('zombie'), resistances: ['Nonmagical Attacks'] };
    const adapted = adaptMonster(odd, asCharacterId('odd'));
    expect(adapted.caveats).toContain('Nonmagical Attacks');
    expect(adapted.defenses.byDamageType['nonmagical attacks']).toBeUndefined();
  });
});

describe('vitals', () => {
  it('starts at the stat block’s average hit points', () => {
    expect(adapt('goblin-warrior').vitals.hp).toBe(10);
  });

  // SRD: "A monster dies the instant it drops to 0 Hit Points."
  it('dies outright at zero rather than falling unconscious', () => {
    const goblin = adapt('goblin-warrior');
    const out = applyDamageToVitals(goblin.vitals, 10);
    expect(out.died).toBe(true);
    expect(isDown(out.vitals)).toBe(false);
  });
});

describe('the rest of the stat block', () => {
  it('carries size, speed and initiative', () => {
    const dragon = adapt('adult-red-dragon');
    expect(dragon.size).toBe('huge');
    expect(dragon.speed).toMatchObject({ walk: 40, fly: 80, climb: 40 });
    expect(dragon.initiativeModifier).toBe(12);
    expect(dragon.sheet.baseSpeed).toBe(40);
  });

  it('carries challenge rating and XP', () => {
    expect(adapt('adult-red-dragon')).toMatchObject({ cr: 17, xp: 18000 });
  });
});

describe('a monster in play', () => {
  it('rolls a saving throw off its printed numbers', () => {
    const dragon = adapt('adult-red-dragon');
    // Natural 8 plus the printed +6 Dexterity save clears a DC 14.
    const save = unwrap(
      rollSavingThrow(createRollIssuer('t'), scriptedRng([8]), dragon.sheet, 'dex', { dc: 14 }),
      'save',
    );
    expect(save.modifier).toBe(6);
    expect(save.total).toBe(14);
    expect(save.success).toBe(true);
  });

  it('adapts every monster in the bestiary without throwing', () => {
    for (const m of bestiary) {
      const adapted = adaptMonster(m, asCharacterId(m.id));
      expect(adapted.vitals.hp).toBeGreaterThan(0);
      expect(armorClass(adapted.sheet)).toBe(m.ac);
      expect(proficiencyBonus(adapted.sheet)).toBe(m.proficiencyBonus);
    }
  });

  it('never mistakes a condition for a damage type across the whole bestiary', () => {
    for (const m of bestiary) {
      const adapted = adaptMonster(m, asCharacterId(m.id));
      for (const type of Object.keys(adapted.defenses.byDamageType)) {
        expect(adapted.defenses.conditionImmunities, `${m.name}: ${type}`).not.toContain(type);
      }
    }
  });
});
