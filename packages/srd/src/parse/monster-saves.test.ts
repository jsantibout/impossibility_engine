import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters, parseSaveLine } from './monsters.js';

/**
 * The save a printed line forces, read out of the book's other template.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` is the same
 * sentence in every dragon wyrmling, the Hell Hound and the Winter Wolf — a
 * template exactly as regular as `_Melee Attack Roll:_` is, carrying the two
 * numbers the engine must supply itself: the DC and the dice.
 *
 * **What is read is the template and nothing around it.** Every regex here is
 * anchored, so the lines that say one more thing are refused whole rather than
 * read down to the part that fits — a second rung of failure, a condition
 * after the damage, a trigger before the save, a damage type the block leaves
 * to another trait. Each of those is a mechanism of its own, and half of one
 * read into this shape would be a rule nobody printed. All of them are still
 * carried verbatim and still handed to the DM.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

const find = (id: string) => {
  const monster = bestiary.find((m) => m.id === id);
  if (monster === undefined) throw new Error(`no stat block called ${id}`);
  return monster;
};

/**
 * A line by its heading, from **whichever section** the block prints it under.
 *
 * Every detector in this parser runs over every section, because what a line
 * says is not a property of the heading it is printed under — and the book
 * proves it here: the Gorgon's Trample is a Bonus Action, the Magma Mephit's
 * Death Burst is a trait, and both write the save template.
 */
const lineOf = (id: string, startsWith: string) => {
  const monster = find(id);
  const line = [
    ...monster.traits,
    ...monster.actions,
    ...monster.bonusActions,
    ...monster.reactions,
    ...monster.legendaryActions,
  ].find((printed) => printed.name.startsWith(startsWith));
  if (line === undefined) throw new Error(`${id} prints no line called ${startsWith}`);
  return line;
};

describe('a line whose sentence is the save template', () => {
  it('reads the Winter Wolf’s breath as an ability, a DC, dice and what a success buys', () => {
    expect(lineOf('winter-wolf', 'Cold Breath').save).toEqual({
      ability: 'con',
      dc: 12,
      targets: 'each creature in a 15-foot Cone',
      damage: { dice: '4d8', flat: 0, type: 'cold', average: 18 },
      onSuccess: 'half',
    });
  });

  it('reads the addend the book prints inside the parenthesis', () => {
    // "16 (2d10 + 5) Bludgeoning damage" — the same trap Finger of Death fell
    // into: dice with no addend is a smaller number than the book prints.
    expect(lineOf('gorgon', 'Trample').save).toEqual({
      ability: 'dex',
      dc: 16,
      targets: 'one creature within 5 feet that has the Prone condition',
      damage: { dice: '2d10', flat: 5, type: 'bludgeoning', average: 16 },
      onSuccess: 'half',
    });
  });

  it('reads a line that offers a success nothing at all', () => {
    // SRD Satyr's Mockery prints no `_Success:_` clause, and a success that
    // bought half anyway would be a rule nobody printed.
    expect(lineOf('satyr', 'Mockery').save).toEqual({
      ability: 'wis',
      dc: 12,
      targets: 'one creature the satyr can see within 90 feet',
      damage: { dice: '1d6', flat: 2, type: 'psychic', average: 5 },
      onSuccess: 'none',
    });
  });

  it('keeps the line’s recharge and its sentence beside the save', () => {
    const line = lineOf('hell-hound', 'Fire Breath');
    expect(line.recharge).toEqual({ kind: 'die', low: 5 });
    expect(line.text).toContain('_Success:_ Half damage.');
    expect(line.save?.dc).toBe(12);
  });
});

describe('the lines the template does not reach', () => {
  it('refuses a second sentence after the damage', () => {
    // SRD Steam Mephit: "…and the target's Speed decreases by 10 feet…"
    expect(lineOf('steam-mephit', 'Steam Breath').save).toBeUndefined();
    // SRD Gibbering Mouther's Blinding Spittle: a condition after the damage.
    expect(lineOf('gibbering-mouther', 'Blinding Spittle').save).toBeUndefined();
  });

  it('refuses a trigger printed before the save', () => {
    // "The mephit explodes when it dies." A line read without it is a Death
    // Burst a creature could set off on purpose.
    expect(lineOf('magma-mephit', 'Death Burst').save).toBeUndefined();
  });

  it('refuses a line whose damage type the block leaves to a trait', () => {
    // SRD Half-Dragon: "damage of the type chosen for the Draconic Origin
    // trait" — a type nobody has declared is not a type.
    expect(lineOf('half-dragon', "Dragon's Breath").save).toBeUndefined();
  });

  it('refuses a second rung of failure', () => {
    // SRD Gorgon's Petrifying Breath prints `_First Failure:_` and
    // `_Second Failure:_`, which is a repeat save this shape cannot hold.
    expect(lineOf('gorgon', 'Petrifying Breath').save).toBeUndefined();
  });

  it('refuses a save whose failure imposes a condition rather than damage', () => {
    // Not a refusal of the mechanic, only of *this* shape: the line is still
    // handed over whole.
    expect(lineOf('dust-mephit', 'Blinding Breath').save).toBeUndefined();
    expect(lineOf('dust-mephit', 'Blinding Breath').text).toContain('Blinded');
  });

  it('reads nothing out of a line that is not the template at all', () => {
    expect(parseSaveLine('The wolf makes two Bite attacks.')).toBeNull();
    expect(
      parseSaveLine('_Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage.'),
    ).toBeNull();
  });

  it('leaves an attack line’s own printed save alone', () => {
    // SRD Ghoul's Bite carries a Constitution save in its *rider*, which
    // `readPrintedRider` has read at the hit since P1-T10. A second reading of
    // the same sentence here would be two engines for one clause.
    const bite = find('ghoul').actions.find((action) => action.name === 'Bite');
    expect(bite?.attack).toBeDefined();
    expect(bite?.save).toBeUndefined();
  });
});

describe('the corpus, so a format change is a failing test rather than a smaller number', () => {
  const saves = bestiary.flatMap((monster) =>
    [
      ...monster.traits,
      ...monster.actions,
      ...monster.bonusActions,
      ...monster.reactions,
      ...monster.legendaryActions,
    ].filter((line) => line.save !== undefined),
  );

  it('reads a save off more than a handful of lines', () => {
    expect(saves.length).toBeGreaterThan(20);
  });

  it('never reads one off a line that also prints an attack roll', () => {
    expect(saves.filter((line) => line.attack !== undefined)).toEqual([]);
  });

  /**
   * **The engine's door searches two sections and Actions wins**, so a
   * heading printed under both would be a Bonus Action line the door refused
   * `line_states_no_save` while its twin sat one section up. It is a fact
   * about this transcription rather than a rule of the book, which is exactly
   * the sort of thing that changes under a re-vendor.
   */
  it('prints no heading under both Actions and Bonus Actions', () => {
    const collisions = bestiary.flatMap((monster) => {
      const bonus = new Set(monster.bonusActions.map((line) => line.name.toLowerCase()));
      return monster.actions
        .filter((line) => bonus.has(line.name.toLowerCase()))
        .map((line) => `${monster.name} / ${line.name}`);
    });
    expect(collisions).toEqual([]);
    // Not vacuous: there are blocks with lines under both headings to collide.
    expect(bestiary.filter((m) => m.actions.length > 0 && m.bonusActions.length > 0).length)
      .toBeGreaterThan(20);
  });

  it('gives every save it read a die to roll and a type to roll it in', () => {
    for (const line of saves) {
      expect(line.save?.damage.dice).toMatch(/^\d+d\d+$/);
      expect(line.save?.damage.type).toMatch(/^[a-z]+$/);
      expect(line.save?.dc).toBeGreaterThan(0);
    }
  });
});
