import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseArmor,
  parseCost,
  parseEquipment,
  parseWeaponProperties,
  parseWeight,
  splitTopLevel,
} from './equipment.js';
import { ArmorSchema, WeaponSchema } from '../schemas.js';

describe('splitTopLevel', () => {
  it('splits a plain list on commas', () => {
    expect(splitTopLevel('Heavy, Reach, Two-Handed')).toEqual(['Heavy', 'Reach', 'Two-Handed']);
  });

  // The trap in equipment.md: properties carry commas inside parentheses.
  // A naive split turns one property into two corrupt fragments.
  it('does not split on commas inside parentheses', () => {
    expect(splitTopLevel('Ammunition (Range 80/320; Bolt), Loading, Two-Handed')).toEqual([
      'Ammunition (Range 80/320; Bolt)',
      'Loading',
      'Two-Handed',
    ]);
  });

  it('handles a trailing parenthesised item', () => {
    expect(splitTopLevel('Thrown (Range 20/60), Versatile (1d10)')).toEqual([
      'Thrown (Range 20/60)',
      'Versatile (1d10)',
    ]);
  });

  it('treats an em dash as an empty list', () => {
    expect(splitTopLevel('—')).toEqual([]);
    expect(splitTopLevel('')).toEqual([]);
  });
});

describe('parseCost', () => {
  it.each([
    ['1 SP', { amount: 1, currency: 'sp' }],
    ['15 GP', { amount: 15, currency: 'gp' }],
    ['5 CP', { amount: 5, currency: 'cp' }],
    ['1,500 GP', { amount: 1500, currency: 'gp' }],
  ])('parses %s', (input, expected) => {
    expect(parseCost(input)).toEqual(expected);
  });

  it('returns null for an unparsable cost', () => {
    expect(parseCost('—')).toBeNull();
    expect(parseCost('Varies')).toBeNull();
  });
});

describe('parseWeight', () => {
  it('parses whole pounds', () => {
    expect(parseWeight('5 lb.')).toBe(5);
  });

  it('parses a fractional weight', () => {
    expect(parseWeight('1/4 lb.')).toBe(0.25);
  });

  it('returns null for a weightless item', () => {
    expect(parseWeight('—')).toBeNull();
  });
});

describe('parseWeaponProperties', () => {
  it('extracts thrown range', () => {
    const p = parseWeaponProperties('Finesse, Light, Thrown (Range 20/60)');
    expect(p.properties).toEqual(['finesse', 'light', 'thrown']);
    expect(p.thrownRange).toEqual({ normal: 20, long: 60 });
  });

  it('extracts ammunition range and ammunition type', () => {
    const p = parseWeaponProperties('Ammunition (Range 100/400; Bolt), Heavy, Loading, Two-Handed');
    expect(p.properties).toEqual(['ammunition', 'heavy', 'loading', 'two-handed']);
    expect(p.ammunitionRange).toEqual({ normal: 100, long: 400 });
    expect(p.ammunitionType).toBe('Bolt');
  });

  it('extracts versatile damage', () => {
    const p = parseWeaponProperties('Versatile (1d10)');
    expect(p.properties).toEqual(['versatile']);
    expect(p.versatileDamage).toBe('1d10');
  });

  it("keeps the Lance's parenthetical caveat as a note", () => {
    const p = parseWeaponProperties('Heavy, Reach, Two-Handed (unless mounted)');
    expect(p.properties).toEqual(['heavy', 'reach', 'two-handed']);
    expect(p.propertyNotes).toBe('unless mounted');
  });

  it('returns an empty list for an em dash', () => {
    expect(parseWeaponProperties('—').properties).toEqual([]);
  });
});

describe('parseArmor AC column', () => {
  it.each([
    ['11 + Dex modifier', { baseAc: 11, addsDexModifier: true, maxDexBonus: null }],
    ['14 + Dex modifier (max 2)', { baseAc: 14, addsDexModifier: true, maxDexBonus: 2 }],
    ['18', { baseAc: 18, addsDexModifier: false, maxDexBonus: null }],
  ])('parses %s', (input, expected) => {
    expect(parseArmor(input)).toMatchObject(expected);
  });

  it('parses a shield as a bonus rather than a base', () => {
    expect(parseArmor('+2')).toEqual({
      baseAc: null,
      acBonus: 2,
      addsDexModifier: false,
      maxDexBonus: null,
    });
  });
});

describe('the vendored SRD equipment tables', () => {
  const markdown = readFileSync(
    fileURLToPath(new URL('../../raw/equipment.md', import.meta.url)),
    'utf8',
  );
  const { weapons, armor, problems } = parseEquipment(markdown, 'equipment.md');

  it('parses without problems', () => {
    expect(problems).toEqual([]);
  });

  it('finds all 38 weapons', () => {
    expect(weapons).toHaveLength(38);
  });

  it('finds all 13 armor entries', () => {
    expect(armor).toHaveLength(13);
  });

  it('validates every weapon against the schema', () => {
    for (const w of weapons) {
      const parsed = WeaponSchema.safeParse(w);
      expect(parsed.success, `${w.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('validates every armor entry against the schema', () => {
    for (const a of armor) {
      const parsed = ArmorSchema.safeParse(a);
      expect(parsed.success, `${a.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    expect(new Set(weapons.map((w) => w.id)).size).toBe(weapons.length);
    expect(new Set(armor.map((a) => a.id)).size).toBe(armor.length);
  });

  it('assigns every weapon a category and kind from its table section', () => {
    const counts = { simple: 0, martial: 0, melee: 0, ranged: 0 };
    for (const w of weapons) {
      counts[w.category]++;
      counts[w.kind]++;
    }
    expect(counts.simple).toBeGreaterThan(0);
    expect(counts.martial).toBeGreaterThan(0);
    expect(counts.melee).toBeGreaterThan(0);
    expect(counts.ranged).toBeGreaterThan(0);
    expect(counts.simple + counts.martial).toBe(38);
    expect(counts.melee + counts.ranged).toBe(38);
  });

  // A stronger check than the total: if a section heading were missed, cells
  // would land under the wrong category and the totals would still be 38.
  it('splits weapons into the right four sections', () => {
    const counts: Record<string, number> = {};
    for (const w of weapons) {
      const key = `${w.category} ${w.kind}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts).toEqual({
      'simple melee': 10,
      'simple ranged': 4,
      'martial melee': 18,
      'martial ranged': 6,
    });
  });

  it('splits armor into the right four categories', () => {
    const counts: Record<string, number> = {};
    for (const a of armor) counts[a.category] = (counts[a.category] ?? 0) + 1;
    expect(counts).toEqual({ light: 3, medium: 5, heavy: 4, shield: 1 });
  });

  it('covers all eight weapon mastery properties', () => {
    expect(new Set(weapons.map((w) => w.mastery)).size).toBe(8);
  });

  it('gives every weapon a mastery property', () => {
    for (const w of weapons) {
      expect(w.mastery, `${w.name} has no mastery`).toBeTruthy();
    }
  });

  it('gives every weapon parsable damage', () => {
    for (const w of weapons) {
      expect(
        w.damage.dice !== null || w.damage.fixed !== null,
        `${w.name} has neither dice nor fixed damage`,
      ).toBe(true);
    }
  });

  const weapon = (id: string) => weapons.find((w) => w.id === id);

  it('spot-checks the Longsword', () => {
    expect(weapon('longsword')).toMatchObject({
      category: 'martial',
      kind: 'melee',
      damage: { dice: '1d8', fixed: null, type: 'slashing' },
      properties: ['versatile'],
      versatileDamage: '1d10',
      mastery: 'sap',
      weightLb: 3,
      cost: { amount: 15, currency: 'gp' },
    });
  });

  it('spot-checks the Dagger, which is finesse, light and thrown', () => {
    expect(weapon('dagger')).toMatchObject({
      category: 'simple',
      kind: 'melee',
      damage: { dice: '1d4', type: 'piercing' },
      properties: ['finesse', 'light', 'thrown'],
      thrownRange: { normal: 20, long: 60 },
      mastery: 'nick',
    });
  });

  it('spot-checks the Heavy Crossbow, whose properties contain nested commas', () => {
    expect(weapon('heavy-crossbow')).toMatchObject({
      category: 'martial',
      kind: 'ranged',
      damage: { dice: '1d10', type: 'piercing' },
      properties: ['ammunition', 'heavy', 'loading', 'two-handed'],
      ammunitionRange: { normal: 100, long: 400 },
      ammunitionType: 'Bolt',
      mastery: 'push',
    });
  });

  it('spot-checks the Blowgun, the one weapon with flat damage', () => {
    expect(weapon('blowgun')?.damage).toEqual({ dice: null, fixed: 1, type: 'piercing' });
  });

  it('spot-checks the Lance, whose two-handed property carries a caveat', () => {
    expect(weapon('lance')).toMatchObject({
      properties: ['heavy', 'reach', 'two-handed'],
      propertyNotes: 'unless mounted',
    });
  });

  const armour = (id: string) => armor.find((a) => a.id === id);

  it('spot-checks Plate Armor', () => {
    expect(armour('plate-armor')).toMatchObject({
      category: 'heavy',
      baseAc: 18,
      addsDexModifier: false,
      strengthRequirement: 15,
      stealthDisadvantage: true,
      cost: { amount: 1500, currency: 'gp' },
    });
  });

  it('spot-checks Half Plate Armor, which caps the Dex bonus', () => {
    expect(armour('half-plate-armor')).toMatchObject({
      category: 'medium',
      baseAc: 15,
      addsDexModifier: true,
      maxDexBonus: 2,
      stealthDisadvantage: true,
    });
  });

  it('spot-checks Leather Armor, which has no Strength requirement', () => {
    expect(armour('leather-armor')).toMatchObject({
      category: 'light',
      baseAc: 11,
      addsDexModifier: true,
      maxDexBonus: null,
      strengthRequirement: null,
      stealthDisadvantage: false,
    });
  });

  it('spot-checks the Shield, which adds to AC rather than setting it', () => {
    expect(armour('shield')).toMatchObject({
      category: 'shield',
      baseAc: null,
      acBonus: 2,
      addsDexModifier: false,
    });
  });

  it('never mistakes a nested comma for a property boundary', () => {
    // Every parsed property must be a known one; a bad split would leave
    // fragments like "Range 80/320; Bolt)" behind.
    for (const w of weapons) {
      for (const p of w.properties) {
        expect(typeof p).toBe('string');
        expect(p).not.toContain('(');
        expect(p).not.toContain('Range');
      }
    }
  });
});
