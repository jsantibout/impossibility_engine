import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLanguagesLine, parseMonsters } from './monsters.js';

/**
 * A stat block's Languages line, read (E-L1).
 *
 * SRD Monsters, "Languages": "This entry lists languages that the monster can
 * use to communicate. Sometimes a monster can understand a language but can't
 * communicate with it, which is noted in its entry. 'None' indicates that a
 * creature doesn't comprehend any language."
 *
 * SRD Suggestion's target must "hear and understand you", and the owner's
 * ruling sends a stat block's half of that question to this line. `languages`
 * keeps the book's strings; `speech` is the line read: the tongues spoken, the
 * ones only understood, the "plus N other languages" the GM chooses, "All", and
 * the telepathy nobody hears. A line with a clause the shape has no field for
 * — the lycanthropes' "can't speak in wolf form", the warhorse's "commands
 * given in any language" — is left unread, whole.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

describe('the Languages line, read', () => {
  it('reads the tongues a block speaks', () => {
    expect(parseLanguagesLine('Common, Draconic')).toEqual({
      speaks: ['Common', 'Draconic'],
      understands: [],
    });
    expect(parseLanguagesLine('None')).toEqual({ speaks: [], understands: [] });
  });

  it('reads Primordial’s dialects as Primordial', () => {
    // "Primordial includes the Aquan, Auran, Ignan, and Terran dialects.
    // Creatures that know one of these dialects can communicate with those that
    // know a different one."
    expect(parseLanguagesLine('Primordial (Ignan, Terran)')).toEqual({
      speaks: ['Primordial'],
      understands: [],
    });
    expect(parseLanguagesLine('Common, Giant, Primordial (Aquan)')?.speaks).toEqual([
      'Common',
      'Giant',
      'Primordial',
    ]);
  });

  it('reads what a block understands and cannot speak', () => {
    expect(parseLanguagesLine("Understands Abyssal, Common, and Infernal but can't speak")).toEqual({
      speaks: [],
      understands: ['Abyssal', 'Common', 'Infernal'],
    });
    expect(
      parseLanguagesLine("Celestial; understands Common and Primordial (Auran) but can't speak them"),
    ).toEqual({ speaks: ['Celestial'], understands: ['Common', 'Primordial'] });
  });

  it('reads the languages the GM chooses as a count, and "All" as all', () => {
    expect(parseLanguagesLine('Common plus two other languages')).toEqual({
      speaks: ['Common'],
      understands: [],
      others: { count: 2, spoken: true },
    });
    expect(
      parseLanguagesLine("Understands Common plus one other language but can't speak"),
    ).toEqual({ speaks: [], understands: ['Common'], others: { count: 1, spoken: false } });
    expect(parseLanguagesLine('All; telepathy 120 ft.')).toEqual({
      speaks: [],
      understands: [],
      all: true,
      telepathy: 120,
    });
  });

  it('reads telepathy apart, which nobody hears', () => {
    expect(
      parseLanguagesLine(
        "Otyugh; telepathy 120 ft. (doesn't allow the receiving creature to respond telepathically)",
      ),
    ).toEqual({ speaks: ['Otyugh'], understands: [], telepathy: 120 });
  });

  it('leaves a line with a clause it has no field for unread', () => {
    expect(parseLanguagesLine("Common (can't speak in wolf form)")).toBeNull();
    expect(parseLanguagesLine("Understands commands given in any language but can't speak")).toBeNull();
  });

  it('reads every block in the book but the ones it names', () => {
    const unread = bestiary
      .filter((block) => block.speech === undefined)
      .map((block) => block.id)
      .sort();
    expect(unread).toEqual([
      'werebear',
      'wereboar',
      'wererat',
      'weretiger',
      'werewolf',
      ...bestiary
        .filter((block) => block.languages.join(', ').startsWith('Understands commands'))
        .map((block) => block.id),
    ].sort());
  });
});
