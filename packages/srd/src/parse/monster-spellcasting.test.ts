import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters, parseSpellcastingLine } from './monsters.js';
import { SPELL_INDEX } from '../spell-index.js';
import type { Monster, MonsterSpellcasting } from '../schemas.js';

/**
 * The Spellcasting line, read whole.
 *
 * The book's third opening, after `_Melee Attack Roll:_` and `_Dexterity
 * Saving Throw:_`: "The cultist casts one of the following spells, using
 * Wisdom as the spellcasting ability (spell save DC 12, +4 to hit with spell
 * attacks)", and then one line per category. Twelve blocks at CR 5 or below
 * print it, and every one of them is asserted here by name — a parser that
 * quietly stopped reading one of them would otherwise show up as nothing at
 * all.
 *
 * **Anchored end to end like everything else in this parser.** A preamble it
 * cannot read, a category it cannot price, a spell name the SRD's own index
 * does not hold, or one character left unconsumed refuses the *whole line* and
 * leaves it prose. Half a spell list read is a creature casting spells nobody
 * gave it.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

const find = (id: string): Monster => {
  const monster = bestiary.find((m) => m.id === id);
  if (monster === undefined) throw new Error(`no stat block called ${id}`);
  return monster;
};

/** The structure the block's Spellcasting line came to, or null for prose. */
const castingOf = (id: string): MonsterSpellcasting | null => {
  const line = find(id).actions.find((action) => action.name === 'Spellcasting');
  if (line === undefined) throw new Error(`${id} prints no Spellcasting action`);
  return line.spellcasting ?? null;
};

/** What the twelve CR ≤ 5 blocks that print the line are. */
const CR_5_AND_BELOW = [
  'couatl',
  'cultist-fanatic',
  'druid',
  'dryad',
  'giant-owl',
  'green-hag',
  'incubus',
  'lamia',
  'night-hag',
  'priest',
  'priest-acolyte',
  'unicorn',
] as const;

describe('every CR 5 and below block that prints a Spellcasting line', () => {
  it('parses all twelve', () => {
    const unread = CR_5_AND_BELOW.filter((id) => castingOf(id) === null);
    expect(unread).toEqual([]);
  });

  it('is the whole list of blocks at that rating that print one', () => {
    const printing = bestiary
      .filter(
        (monster) =>
          monster.cr <= 5 && monster.actions.some((action) => action.name === 'Spellcasting'),
      )
      .map((monster) => monster.id)
      .sort();
    expect(printing).toEqual([...CR_5_AND_BELOW].sort());
  });

  /**
   * The lookup drops everything that is not a letter or a digit, so that the
   * hyphen the book introduced in "Long-strider" falls out. That is only safe
   * while no two spell names collide under it — a collision would silently
   * file one block's spell under another spell's id.
   */
  it('looks names up under a key no two SRD spells share', () => {
    const seen = new Map<string, string>();
    for (const spell of SPELL_INDEX) {
      const key = spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      expect(seen.get(key), `${spell.name} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, spell.name);
    }
  });

  it('names only spells the SRD index holds', () => {
    const ids = new Set(SPELL_INDEX.map((spell) => spell.id));
    for (const id of CR_5_AND_BELOW) {
      for (const spell of castingOf(id)!.spells) {
        expect(ids.has(spell.spellId), `${id} names ${spell.spellId}`).toBe(true);
      }
    }
  });
});

describe('the preamble', () => {
  it('carries the ability, the printed DC and the printed attack bonus', () => {
    expect(castingOf('cultist-fanatic')).toMatchObject({
      ability: 'wis',
      saveDc: 12,
      attackBonus: 4,
    });
  });

  it('leaves the attack bonus absent where the line prints only a DC', () => {
    const druid = castingOf('druid')!;
    expect(druid.saveDc).toBe(13);
    expect(druid.attackBonus).toBeUndefined();
  });

  /**
   * SRD Priest Acolyte prints no parenthesis at all, so there is nothing to
   * carry and the numbers fall to whatever the creature's own sheet derives.
   */
  it('leaves both absent where the line prints no numbers', () => {
    const acolyte = castingOf('priest-acolyte')!;
    expect(acolyte.ability).toBe('wis');
    expect(acolyte.saveDc).toBeUndefined();
    expect(acolyte.attackBonus).toBeUndefined();
  });

  it('reads the component clause the book varies and carries none of it', () => {
    // "requiring no Material components", "requiring no spell components",
    // "requiring no Somatic or Material components" — three wordings of a
    // clause that says what the casting does *not* need, and the engine asks
    // for no components at all.
    expect(castingOf('dryad')).toMatchObject({ ability: 'cha', saveDc: 14 });
    expect(castingOf('couatl')).toMatchObject({ ability: 'wis', saveDc: 15 });
  });
});

describe('the categories', () => {
  it('prices an At Will spell at no limit', () => {
    const cultist = castingOf('cultist-fanatic')!;
    expect(cultist.spells.filter((s) => s.usesPerDay === undefined).map((s) => s.spellId)).toEqual([
      'light',
      'thaumaturgy',
    ]);
  });

  it('prices N/Day and N/Day Each at N', () => {
    expect(castingOf('cultist-fanatic')!.spells).toEqual([
      { spellId: 'light', name: 'Light' },
      { spellId: 'thaumaturgy', name: 'Thaumaturgy' },
      { spellId: 'command', name: 'Command', usesPerDay: 2 },
      { spellId: 'hold-person', name: 'Hold Person', usesPerDay: 1 },
    ]);
  });

  it('splits a group of names printed inside one pair of underscores', () => {
    expect(castingOf('druid')!.spells.map((s) => s.spellId)).toEqual([
      'druidcraft',
      'speak-with-animals',
      'entangle',
      'thunderwave',
      'animal-messenger',
      'longstrider',
      'moonbeam',
    ]);
  });

  /**
   * The stat block hyphenates "Long-strider" where the spell list prints
   * "Longstrider", so the name is looked up in the index rather than
   * slugified: a blind slug would have produced `long-strider`, which is not a
   * spell.
   */
  it('looks a printed name up rather than slugifying it', () => {
    const druid = castingOf('druid')!;
    expect(druid.spells.find((s) => s.name === 'Long-strider')?.spellId).toBe('longstrider');
    expect(castingOf('unicorn')!.spells.find((s) => s.spellId === 'pass-without-trace')).toBeDefined();
  });
});

describe('a rider the structure has no field for', () => {
  it('is carried verbatim on the spell it follows', () => {
    const dryad = castingOf('dryad')!;
    expect(dryad.spells.find((s) => s.spellId === 'charm-monster')).toEqual({
      spellId: 'charm-monster',
      name: 'Charm Monster',
      handOver: 'lasts 24 hours; ends early if the dryad casts the spell again',
    });
  });

  it('attaches to the last name of the group it follows, never to the first', () => {
    const couatl = castingOf('couatl')!;
    expect(couatl.spells.find((s) => s.spellId === 'detect-evil-and-good')?.handOver).toBeUndefined();
    expect(couatl.spells.find((s) => s.spellId === 'shapechange')?.handOver).toContain(
      'Beast or Humanoid form only',
    );
  });

  it('carries the level a block casts a spell at, unapplied', () => {
    expect(castingOf('night-hag')!.spells.find((s) => s.spellId === 'magic-missile')).toEqual({
      spellId: 'magic-missile',
      name: 'Magic Missile',
      handOver: 'level 4 version',
    });
    expect(castingOf('night-hag')!.spells.find((s) => s.spellId === 'plane-shift')).toEqual({
      spellId: 'plane-shift',
      name: 'Plane Shift',
      usesPerDay: 2,
      handOver: 'self only',
    });
  });
});

describe('a line it cannot read whole', () => {
  const PREAMBLE =
    'The cultist casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 12): <br>';

  it('is refused when a category is one the book does not price this way', () => {
    expect(
      parseSpellcastingLine(`${PREAMBLE}\n&emsp;**Twice a week:** _Light_`),
    ).toBeNull();
  });

  it('is refused when a name is not a spell the SRD prints', () => {
    expect(
      parseSpellcastingLine(`${PREAMBLE}\n&emsp;**At Will:** _Light_, _Hurl Through Hell_`),
    ).toBeNull();
  });

  it('is refused when anything at all is left unconsumed', () => {
    expect(
      parseSpellcastingLine(`${PREAMBLE}\n&emsp;**At Will:** _Light_ and also whatever it likes`),
    ).toBeNull();
  });

  /**
   * "2/Day: _Light_, _Thaumaturgy_" would be two spells sharing one budget of
   * two, which is not what "2/Day Each" says and is a shape this structure
   * cannot hold: every spell here carries its own count. The SRD prints no
   * such line — every one of its unqualified `N/Day` categories names exactly
   * one spell — and a homebrew one is refused rather than read as `Each`.
   */
  it('is refused when an N/Day category without "Each" names more than one spell', () => {
    expect(parseSpellcastingLine(`${PREAMBLE}\n&emsp;**2/Day:** _Light_, _Thaumaturgy_`)).toBeNull();
    expect(parseSpellcastingLine(`${PREAMBLE}\n&emsp;**2/Day:** _Light_`)).toMatchObject({
      spells: [{ spellId: 'light', usesPerDay: 2 }],
    });
  });

  it('is refused when the sentence is not this sentence', () => {
    expect(
      parseSpellcastingLine(
        'The pit fiend casts _Fireball_ (level 5 version) twice, requiring no Material components and using Charisma as the spellcasting ability (spell save DC 21).',
      ),
    ).toBeNull();
  });

  /**
   * The one block above CR 5 whose line is refused for its **markup**: the
   * Storm Giant's list prints its spell names with no italics at all, and a
   * bare word in that position is not something this grammar can tell from
   * prose. Recorded rather than argued about, and cheap: reading it would be
   * a second grammar for one block.
   */
  it('is refused where the book italicised nothing', () => {
    const giant = find('storm-giant');
    expect(giant.actions.find((a) => a.name === 'Spellcasting')?.spellcasting).toBeUndefined();
  });

  it('leaves the line prose in the catalogue, with its text intact', () => {
    const fiend = find('pit-fiend');
    const line = fiend.actions.find((a) => a.name.startsWith('Hellfire Spellcasting'));
    expect(line?.spellcasting).toBeUndefined();
    expect(line?.text).toContain('casts _Fireball_');
  });
});
