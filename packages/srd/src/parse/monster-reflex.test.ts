import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCloudLine, parseConcentrationLine, parseMonsters, parseTraitShape } from './monsters.js';
import type { Monster } from '../schemas.js';

/**
 * M-REFLEX: four sentences the parser read nothing out of, and one it read into
 * a kind with no numbers.
 *
 * SRD Will-o'-Wisp's Vanish and SRD Darkmantle's Darkness Aura keep an effect
 * up under Concentration; the two octopuses' Ink Cloud is a Reaction that
 * releases a cloud; SRD Goblin Boss's Redirect Attack now carries the sizes,
 * the reach and the sight clause it prints. Each reader is anchored end to end,
 * so a sentence that says one thing more stays prose.
 */

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../raw/${file}`, import.meta.url)), 'utf8');

const bestiary: readonly Monster[] = [
  ...parseMonsters(read('monsters-A-Z.md'), 'monsters-A-Z.md').items,
  ...parseMonsters(read('animals.md'), 'animals.md').items,
];

const lineOf = (id: string, heading: string) => {
  const monster = bestiary.find((m) => m.id === id)!;
  return [...monster.traits, ...monster.actions, ...monster.bonusActions, ...monster.reactions].find(
    (line) => line.name === heading,
  )!;
};

describe('an effect kept up under Concentration', () => {
  it("reads the wisp's Vanish: the condition, its light, and the two early endings", () => {
    expect(lineOf('will-o-wisp', 'Vanish').concentrates).toEqual({
      conditions: ['invisible'],
      withItsLight: true,
      endsAfter: { attackRoll: true, lines: ['Consume Life'] },
    });
  });

  it("reads the darkmantle's Darkness Aura: the Emanation and the ten minutes", () => {
    expect(lineOf('darkmantle', 'Darkness Aura (1/Day)').concentrates).toEqual({
      darkness: { emanationFeet: 15 },
      upToMinutes: 10,
    });
  });

  it('is read nowhere else in the book', () => {
    const holders = bestiary.flatMap((m) =>
      [...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions]
        .filter((line) => line.concentrates !== undefined)
        .map((line) => `${m.id}/${line.name}`),
    );
    expect(holders.sort()).toEqual(['darkmantle/Darkness Aura (1/Day)', 'will-o-wisp/Vanish']);
  });

  it('leaves a sentence that says one thing more as prose', () => {
    expect(
      parseConcentrationLine(
        "The wisp and its light have the Invisible condition until the wisp's Concentration ends on this effect, which ends early immediately after the wisp makes an attack roll or uses Consume Life. It also flies.",
      ),
    ).toBeNull();
    // SRD *Darkness*'s own sentence admits magical light; this reader is for
    // the darkness that admits none, and nothing short of that sentence.
    expect(
      parseConcentrationLine(
        "Magical Darkness fills a 15-foot Emanation originating from the darkmantle. This effect lasts while the darkmantle maintains Concentration on it, up to 10 minutes. Darkvision can't penetrate this area, and nonmagical light can't illuminate it.",
      ),
    ).toBeNull();
  });
});

describe('a cloud a Reaction releases', () => {
  it("reads the giant octopus's Ink Cloud off a blow", () => {
    expect(lineOf('giant-octopus', 'Ink Cloud (1/Day)').releasesCloud).toEqual({
      trigger: { kind: 'takes-damage' },
      underwater: true,
      cubeFeet: 10,
      degree: 'heavily',
      lastsMinutes: 1,
      dispersedBy: 'a strong current or similar effect',
      movesUpTo: 'swim',
    });
  });

  it("reads the octopus's off another creature's turn ending beside it", () => {
    expect(lineOf('octopus', 'Ink Cloud (1/Day)').releasesCloud).toEqual({
      trigger: { kind: 'creature-ends-turn-within', feet: 5 },
      underwater: true,
      cubeFeet: 5,
      degree: 'heavily',
      lastsMinutes: 1,
      dispersedBy: 'a strong current or similar effect',
      movesUpTo: 'swim',
    });
  });

  it('keeps the per-day count on the heading, where it was', () => {
    expect(lineOf('octopus', 'Ink Cloud (1/Day)').perDay).toBe(1);
  });

  it('leaves a trigger it does not know as prose', () => {
    expect(
      parseCloudLine(
        '_Trigger:_ The octopus is hit by an attack roll while underwater. _Response:_ The octopus releases ink that fills a 10-foot Cube centered on itself, and the octopus moves up to its Swim Speed. The Cube is Heavily Obscured for 1 minute or until a strong current or similar effect disperses the ink.',
      ),
    ).toBeNull();
  });
});

describe("the goblin boss's Redirect Attack", () => {
  it('carries the two sizes, the reach and the sight clause it prints', () => {
    expect(lineOf('goblin-boss', 'Redirect Attack').trait).toEqual({
      kind: 'swaps-places-with-an-ally-to-take-an-attack',
      allySizes: ['small', 'medium'],
      withinFeet: 5,
      seesAttacker: true,
    });
  });

  it('reads another size and another reach as what they say', () => {
    expect(
      parseTraitShape(
        '_Trigger:_ A creature the hobgoblin can see makes an attack roll against it. _Response:_ The hobgoblin chooses a Medium or Large ally within 10 feet of itself. The hobgoblin and that ally swap places, and the ally becomes the target of the attack instead.',
      ),
    ).toEqual({
      kind: 'swaps-places-with-an-ally-to-take-an-attack',
      allySizes: ['medium', 'large'],
      withinFeet: 10,
      seesAttacker: true,
    });
  });
});
