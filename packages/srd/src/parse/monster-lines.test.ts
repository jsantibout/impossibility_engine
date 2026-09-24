import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseCastLine,
  parseMonsters,
  parseRollAddendLine,
  parseTeleportLine,
} from './monsters.js';
import type { Monster } from '../schemas.js';

/**
 * Three sentences the parser could not start on, each a use whose economy the
 * engine already spends.
 *
 * A line that **casts** a named spell, a line that **teleports** its creature,
 * and a Reaction that **adds** a flat number to somebody else's D20 Test. All
 * three are anchored end to end like every other reader in this parser: a
 * clause the grammar does not cover, or one character left unconsumed, leaves
 * the whole line prose, because half a sentence read is a creature doing
 * something nobody printed.
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

const lineOf = (id: string, name: string) => {
  const block = find(id);
  const line = [
    ...block.traits,
    ...block.actions,
    ...block.bonusActions,
    ...block.reactions,
    ...block.legendaryActions,
  ].find((one) => one.name === name);
  if (line === undefined) throw new Error(`${id} prints no line called ${name}`);
  return line;
};

describe('a line that casts', () => {
  it('reads one spell named with the ability the block states', () => {
    expect(
      parseCastLine(
        'The mephit casts the _Sleep_ spell, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 10).',
      ),
    ).toEqual({ spells: ['sleep'], ability: 'cha', saveDc: 10 });
  });

  it('reads a menu, and the ability as the reference the line makes', () => {
    expect(
      parseCastLine(
        'The priest casts _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_ using the same spellcasting ability as Spellcasting.',
      ),
    ).toEqual({
      spells: ['bless', 'dispel-magic', 'healing-word', 'lesser-restoration'],
      ability: 'spellcasting',
    });
  });

  it('reads a menu italicised one name at a time', () => {
    expect(
      parseCastLine(
        'The couatl casts _Bless_, _Lesser Restoration_, or _Sanctuary_, requiring no spell components and using the same spellcasting ability as Spellcasting.',
      ),
    ).toEqual({ spells: ['bless', 'lesser-restoration', 'sanctuary'], ability: 'spellcasting' });
  });

  it('refuses a line whose sentence says more than it casts', () => {
    // SRD Vampire's Beguile: a second sentence about a second rule.
    expect(
      parseCastLine(
        "The vampire casts _Command_, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 17). The vampire can't take this action again until the start of its next turn.",
      ),
    ).toBeNull();
    // SRD Succubus: the spell's name is not italicised, so a bare word in that
    // position is not something the grammar can tell from prose.
    expect(
      parseCastLine(
        'The succubus casts Dominate Person (level 8 version), requiring no spell components and using Charisma as the spellcasting ability (spell save DC 15).',
      ),
    ).toBeNull();
    // SRD Pit Fiend's Hellfire Spellcasting: one spell cast twice, replaceable.
    expect(
      parseCastLine(
        'The pit fiend casts _Fireball_ (level 5 version) twice, requiring no Material components and using Charisma as the spellcasting ability (spell save DC 21). It can replace one _Fireball_ with _Hold Monster_ (level 7 version) or _Wall of Fire_.',
      ),
    ).toBeNull();
    // SRD Unicorn's Blessing: a touch, and a target the shape cannot hold.
    expect(
      parseCastLine(
        "The unicorn touches another creature with its horn and casts _Cure Wounds_ or _Lesser Restoration_ on that creature, using the same spellcasting ability as Spellcasting.",
      ),
    ).toBeNull();
    // A name the SRD's own spell index does not hold.
    expect(
      parseCastLine(
        'The cultist casts the _Hex of the Nine_ spell, using the same spellcasting ability as Spellcasting.',
      ),
    ).toBeNull();
  });

  it('refuses the Spellcasting line itself, which is another opening', () => {
    expect(
      parseCastLine(
        'The cultist casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 12, +4 to hit with spell attacks):',
      ),
    ).toBeNull();
  });

  it('is carried onto the six CR 5 and below lines that print it', () => {
    expect(lineOf('priest-acolyte', 'Divine Aid (1/Day)').casts).toEqual({
      spells: ['bless', 'healing-word', 'sanctuary'],
      ability: 'spellcasting',
    });
    expect(lineOf('priest', 'Divine Aid (3/Day)').casts).toEqual({
      spells: ['bless', 'dispel-magic', 'healing-word', 'lesser-restoration'],
      ability: 'spellcasting',
    });
    expect(lineOf('couatl', 'Divine Aid (2/Day)').casts).toEqual({
      spells: ['bless', 'lesser-restoration', 'sanctuary'],
      ability: 'spellcasting',
    });
    expect(lineOf('cultist-fanatic', 'Spiritual Weapon (2/Day)').casts).toEqual({
      spells: ['spiritual-weapon'],
      ability: 'spellcasting',
    });
    expect(lineOf('dust-mephit', 'Sleep (1/Day)').casts).toEqual({
      spells: ['sleep'],
      ability: 'cha',
      saveDc: 10,
    });
    expect(lineOf('ice-mephit', 'Fog Cloud (1/Day)').casts).toEqual({
      spells: ['fog-cloud'],
      ability: 'cha',
    });
  });

  it('leaves a line whose heading rations it by a recharge as prose', () => {
    // A recharge is a die at a turn boundary and no pool: a casting paid for
    // out of a pool the block never declared would be a use nothing could ever
    // run out of, which is the one direction a limit may not be got wrong.
    expect(lineOf('drider', 'Magic of the Spider Queen (Recharge 5–6)').casts).toBeUndefined();
    expect(lineOf('stone-golem', 'Slow (Recharge 5–6)').casts).toBeUndefined();
  });
});

describe('a line that teleports', () => {
  it('reads the distance and the sight clause', () => {
    expect(parseTeleportLine('The dog teleports up to 40 feet to an unoccupied space it can see.')).toEqual(
      { feet: 40, mustSee: true },
    );
    expect(
      parseTeleportLine('The marilith teleports up to 120 feet to an unoccupied space it can see.'),
    ).toEqual({ feet: 120, mustSee: true });
  });

  it('refuses every line that says more than that', () => {
    expect(
      parseTeleportLine(
        'The lich teleports up to 60 feet to an unoccupied space it can see, and each creature within 10 feet of the space it left takes 11 (2d10) Necrotic damage.',
      ),
    ).toBeNull();
    expect(
      parseTeleportLine(
        'The balor teleports itself or a willing demon within 10 feet of itself up to 60 feet to an unoccupied space the balor can see.',
      ),
    ).toBeNull();
    expect(
      parseTeleportLine(
        'The spider teleports from the Material Plane to the Ethereal Plane or vice versa.',
      ),
    ).toBeNull();
    expect(
      parseTeleportLine(
        'If within 5 feet of a Large or bigger tree, the dryad teleports to an unoccupied space within 5 feet of a second Large or bigger tree that is within 60 feet of the previous tree.',
      ),
    ).toBeNull();
  });

  it('is carried onto the Blink Dog, with its recharge left on the line', () => {
    const line = lineOf('blink-dog', 'Teleport (Recharge 4–6)');
    expect(line.teleports).toEqual({ feet: 40, mustSee: true });
    expect(line.recharge).toEqual({ kind: 'die', low: 4 });
  });
});

describe('a Reaction that adds to a roll', () => {
  it('reads the trigger, its reach and the addend', () => {
    expect(
      parseRollAddendLine(
        '_Trigger:_ The sphinx or another creature within 30 feet makes an ability check or a saving throw. _Response:_ The sphinx adds 2 to the roll.',
      ),
    ).toEqual({
      addend: 2,
      withinFeet: 30,
      includesSelf: true,
      tests: ['ability-check', 'saving-throw'],
    });
  });

  it('refuses the nine Parry lines, which add to an Armour Class', () => {
    expect(
      parseRollAddendLine(
        '_Trigger:_ The bandit is hit by a melee attack roll while holding a weapon. _Response:_ The bandit adds 2 to its AC against that attack, possibly causing it to miss.',
      ),
    ).toBeNull();
    expect(
      parseRollAddendLine(
        '_Trigger:_ The mummy is hit by an attack roll. _Response:_ The mummy adds 2 to its AC against the attack, possibly causing the attack to miss, and the mummy teleports up to 60 feet to an unoccupied space it can see.',
      ),
    ).toBeNull();
  });

  it('is carried onto the Sphinx of Wonder, with its day’s uses on the line', () => {
    const line = lineOf('sphinx-of-wonder', 'Burst of Ingenuity (2/Day)');
    expect(line.addsToRoll).toEqual({
      addend: 2,
      withinFeet: 30,
      includesSelf: true,
      tests: ['ability-check', 'saving-throw'],
    });
    expect(line.perDay).toBe(2);
  });
});

describe('the corpus', () => {
  const lines = bestiary.flatMap((monster) => [
    ...monster.traits,
    ...monster.actions,
    ...monster.bonusActions,
    ...monster.reactions,
    ...monster.legendaryActions,
  ]);

  it('reads exactly the cast lines the book prints in this shape', () => {
    // Asserted over the corpus rather than assumed, which is how every other
    // claim about "no SRD line does X" in this parser is held down.
    const casting = lines.filter((line) => line.casts !== undefined);
    expect(casting.every((line) => line.recharge === undefined)).toBe(true);
    // Every cast line is a heading a creature spends: none of them declares a
    // spell list as well, because the two are different sentences.
    expect(casting.every((line) => line.spellcasting === undefined)).toBe(true);
  });

  it('never reads two of the three shapes out of one sentence', () => {
    for (const line of lines) {
      const read = [line.casts, line.teleports, line.addsToRoll].filter(
        (shape) => shape !== undefined,
      );
      expect(read.length).toBeLessThan(2);
    }
  });
});
