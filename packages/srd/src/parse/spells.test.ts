import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpells } from './spells.js';
import { SpellSchema } from '../schemas.js';

const FIREBALL = `#### Fireball

_Level 3 Evocation (Sorcerer, Wizard)_

**Casting Time:** Action
**Range:** 150 feet
**Components:** V, S, M (a ball of bat guano and sulfur)
**Duration:** Instantaneous

A bright streak flashes from you to a point you choose within range and then blossoms with a low roar into a fiery explosion. Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save or half as much damage on a successful one.

Flammable objects in the area that aren't being worn or carried start burning.

_Using a Higher-Level Spell Slot._ The damage increases by 1d6 for each spell slot level above 3.
`;

const FIRE_BOLT = `#### Fire Bolt

_Evocation Cantrip (Sorcerer, Wizard)_

**Casting Time:** Action
**Range:** 120 feet
**Components:** V, S
**Duration:** Instantaneous

You hurl a mote of fire at a creature or object within range.
`;

const DETECT_MAGIC = `#### Detect Magic

_Level 1 Divination (Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock, Wizard)_

**Casting Time:** Action or Ritual
**Range:** Self
**Components:** V, S
**Duration:** Concentration, up to 10 minutes

You sense the presence of magical effects within 30 feet of yourself.
`;

const one = (md: string) => {
  const { items, problems } = parseSpells(md, 'test.md');
  expect(problems).toEqual([]);
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe('parseSpells', () => {
  it('parses a levelled spell', () => {
    const spell = one(FIREBALL);
    expect(spell).toMatchObject({
      id: 'fireball',
      name: 'Fireball',
      level: 3,
      school: 'evocation',
      classes: ['sorcerer', 'wizard'],
      castingTime: 'Action',
      ritual: false,
      range: '150 feet',
      duration: 'Instantaneous',
      concentration: false,
    });
  });

  it('parses components into flags plus the material description', () => {
    expect(one(FIREBALL).components).toEqual({
      verbal: true,
      somatic: true,
      material: true,
      materialDescription: 'a ball of bat guano and sulfur',
    });
  });

  it('leaves materialDescription null when there are no materials', () => {
    expect(one(FIRE_BOLT).components).toEqual({
      verbal: true,
      somatic: true,
      material: false,
      materialDescription: null,
    });
  });

  it('accepts the singular **Component:** label the source uses for 12 spells', () => {
    const singular = FIRE_BOLT.replace('**Components:**', '**Component:**');
    expect(one(singular).components).toMatchObject({ verbal: true, somatic: true });
  });

  it('records a cantrip as level 0', () => {
    expect(one(FIRE_BOLT)).toMatchObject({ level: 0, school: 'evocation' });
  });

  it('detects the Ritual option in the casting time', () => {
    expect(one(DETECT_MAGIC).ritual).toBe(true);
  });

  it('detects Concentration in the duration', () => {
    expect(one(DETECT_MAGIC)).toMatchObject({
      concentration: true,
      duration: 'Concentration, up to 10 minutes',
    });
  });

  it('captures the full description but excludes the higher-level clause', () => {
    const spell = one(FIREBALL);
    expect(spell.description).toContain('A bright streak flashes');
    expect(spell.description).toContain('start burning');
    expect(spell.description).not.toContain('Using a Higher-Level Spell Slot');
    expect(spell.description).not.toContain('The damage increases by 1d6');
  });

  it('captures the higher-level clause separately', () => {
    expect(one(FIREBALL).higherLevel).toBe(
      'The damage increases by 1d6 for each spell slot level above 3.',
    );
  });

  it('leaves higherLevel null when the spell has no upcast clause', () => {
    expect(one(FIRE_BOLT).higherLevel).toBeNull();
  });

  it('parses several spells from one document', () => {
    const { items, problems } = parseSpells(FIREBALL + '\n' + FIRE_BOLT + '\n' + DETECT_MAGIC, 'test.md');
    expect(problems).toEqual([]);
    expect(items.map((s) => s.id)).toEqual(['fireball', 'fire-bolt', 'detect-magic']);
  });

  it('ignores headings that are not spell entries', () => {
    const prose = `#### Preparing Spells\n\nSome explanatory prose with no stat line.\n`;
    const { items, problems } = parseSpells(prose, 'test.md');
    expect(items).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('reports a problem rather than throwing on a malformed entry', () => {
    const broken = `#### Broken Spell

_Level 3 Notaschool (Wizard)_

**Casting Time:** Action
**Range:** 30 feet
**Components:** V
**Duration:** Instantaneous

Body text.
`;
    const { items, problems } = parseSpells(broken, 'test.md');
    expect(items).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.entry).toBe('Broken Spell');
  });
});

describe('the vendored SRD spell list', () => {
  const markdown = readFileSync(
    fileURLToPath(new URL('../../raw/spells.md', import.meta.url)),
    'utf8',
  );
  const { items, problems } = parseSpells(markdown, 'spells.md');

  it('parses without problems', () => {
    expect(problems).toEqual([]);
  });

  it('yields a plausible number of spells', () => {
    expect(items.length).toBeGreaterThan(300);
  });

  it('validates every entry against the schema', () => {
    for (const spell of items) {
      const parsed = SpellSchema.safeParse(spell);
      expect(parsed.success, `${spell.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = items.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Spot checks against the official PDF (packages/srd/reference). These are the
  // guard against a bad transcription silently becoming an engine bug.
  it.each([
    ['fireball', { level: 3, school: 'evocation', concentration: false, ritual: false }],
    ['magic-missile', { level: 1, school: 'evocation', concentration: false }],
    ['bless', { level: 1, school: 'enchantment', concentration: true }],
    ['detect-magic', { level: 1, school: 'divination', concentration: true, ritual: true }],
    ['wish', { level: 9, school: 'conjuration' }],
    ['guidance', { level: 0, school: 'divination', concentration: true }],
    ['counterspell', { level: 3, school: 'abjuration' }],
    ['revivify', { level: 3, school: 'necromancy' }],
  ])('spot-checks %s', (id, expected) => {
    const spell = items.find((s) => s.id === id);
    expect(spell, `${id} missing from parsed spells`).toBeDefined();
    expect(spell).toMatchObject(expected);
  });

  it('spot-checks the Fireball damage text survives intact', () => {
    const fireball = items.find((s) => s.id === 'fireball');
    expect(fireball?.description).toContain('8d6 Fire damage');
    expect(fireball?.higherLevel).toContain('1d6');
  });

  it('covers every spell level from cantrip to 9th', () => {
    const levels = new Set(items.map((s) => s.level));
    for (let level = 0; level <= 9; level++) {
      expect(levels.has(level), `no spells parsed at level ${level}`).toBe(true);
    }
  });
});
