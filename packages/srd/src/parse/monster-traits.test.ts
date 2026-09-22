import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters, parseTraitShape } from './monsters.js';
import { type MonsterTrait } from '../schemas.js';

/**
 * The trait sentences this parser reads beyond the first one.
 *
 * `parseTraitShape` matched a single rule for as long as it had existed, and
 * the rule for adding another has not changed: **the sentence is matched, not
 * the heading**. A block that printed the same rule under another name gets
 * the same mechanic, and one that printed a different rule under a name this
 * file quotes gets nothing. Every regex below is anchored end to end, so a
 * sentence that says one more thing — the swarm's "If the swarm has a Climb
 * Speed" — is refused whole rather than read down to the part that fits.
 *
 * **What is read is not yet what is executed**, and the two are separate
 * debts. These kinds put the structure on the line where `hasPrintedTrait`
 * can ask for it; the readers that spend them — a climb that costs no check,
 * an Opportunity Attack a flier does not provoke — are elsewhere and are
 * their own briefs.
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

/** The shape the block prints under a heading, or null where it prints none. */
const traitOf = (id: string, name: string): MonsterTrait | null => {
  const line = find(id).traits.find((trait) => trait.name === name);
  if (line === undefined) throw new Error(`${id} prints no trait called ${name}`);
  return line.trait ?? null;
};

/**
 * The same, for a line the book prints under **Bonus Actions**.
 *
 * The parser runs every detector over every section, because what a line says
 * is not a property of the heading it is printed under — so a mechanic printed
 * as a Bonus Action is read exactly as one printed as a trait, and the heading
 * is left to say what the line *costs*.
 */
const bonusActionTraitOf = (id: string, name: string): MonsterTrait | null => {
  const line = find(id).bonusActions.find((entry) => entry.name === name);
  if (line === undefined) throw new Error(`${id} prints no Bonus Action called ${name}`);
  return line.trait ?? null;
};

describe('a trait that says how a creature moves', () => {
  it('reads SRD Spider Climb as climbing that costs no check', () => {
    expect(traitOf('giant-spider', 'Spider Climb')).toEqual({ kind: 'climbs-without-a-check' });
  });

  it('reads it off the sentence, whatever noun the block uses for itself', () => {
    // Four nouns for one rule: the pudding, the jelly, the roper, the vampire.
    expect(traitOf('black-pudding', 'Spider Climb')).toEqual({ kind: 'climbs-without-a-check' });
    expect(traitOf('ochre-jelly', 'Spider Climb')).toEqual({ kind: 'climbs-without-a-check' });
    expect(traitOf('vampire-spawn', 'Spider Climb')).toEqual({ kind: 'climbs-without-a-check' });
  });

  it('refuses the swarm, whose sentence gates the rule on a Speed', () => {
    // "If the swarm has a Climb Speed, the swarm can climb…" — a gate the kind
    // carries no field for, and a gate read away is a rule nobody printed.
    expect(traitOf('swarm-of-insects', 'Spider Climb')).toBeNull();
  });

  it('reads SRD Flyby as the Opportunity Attack a flier does not provoke', () => {
    expect(traitOf('gargoyle', 'Flyby')).toEqual({
      kind: 'does-not-provoke-when-flying-out-of-reach',
    });
    expect(traitOf('giant-wasp', 'Flyby')).toEqual({
      kind: 'does-not-provoke-when-flying-out-of-reach',
    });
  });

  it('reads SRD Standing Leap with both of its distances', () => {
    // A jump carried without its feet is a jump of nothing, so the numbers are
    // part of the shape rather than prose beside it.
    expect(traitOf('frog', 'Standing Leap')).toEqual({
      kind: 'jumps-without-a-running-start',
      longJumpFeet: 10,
      highJumpFeet: 5,
    });
    expect(traitOf('giant-frog', 'Standing Leap')).toEqual({
      kind: 'jumps-without-a-running-start',
      longJumpFeet: 20,
      highJumpFeet: 10,
    });
  });
});

describe('a trait that says what a creature breathes', () => {
  it('reads SRD Amphibious as breathing both, with no limit on either', () => {
    expect(traitOf('chuul', 'Amphibious')).toEqual({ kind: 'breathes-air-and-water' });
    expect(traitOf('merrow', 'Amphibious')).toEqual({ kind: 'breathes-air-and-water' });
  });

  it('carries the sahuagin’s limit rather than dropping it', () => {
    // "but it must be submerged at least once every 4 hours" — a limit dropped
    // at the door is a limit that silently becomes none, which is the wrong
    // direction. Same kind, because the first clause is the same sentence.
    expect(traitOf('sahuagin-warrior', 'Limited Amphibiousness')).toEqual({
      kind: 'breathes-air-and-water',
      mustSubmergeWithinHours: 4,
    });
  });

  it('reads SRD Water Breathing as water alone', () => {
    expect(traitOf('reef-shark', 'Water Breathing')).toEqual({ kind: 'breathes-only-water' });
    expect(traitOf('seahorse', 'Water Breathing')).toEqual({ kind: 'breathes-only-water' });
  });

  it('carries the octopus’s hour out of water', () => {
    expect(traitOf('giant-octopus', 'Water Breathing')).toEqual({
      kind: 'breathes-only-water',
      holdsBreathMinutes: 60,
    });
  });

  it('reads SRD Hold Breath in minutes, whatever unit the block prints', () => {
    expect(traitOf('crocodile', 'Hold Breath')).toEqual({
      kind: 'holds-its-breath',
      minutes: 60,
    });
    expect(traitOf('hippopotamus', 'Hold Breath')).toEqual({
      kind: 'holds-its-breath',
      minutes: 10,
    });
    expect(traitOf('killer-whale', 'Hold Breath')).toEqual({
      kind: 'holds-its-breath',
      minutes: 30,
    });
  });
});

describe('a trait that says what the light does to a creature', () => {
  /**
   * SRD Sunlight Sensitivity, printed identically on five blocks: "While in
   * sunlight, the kobold has Disadvantage on ability checks and attack rolls."
   *
   * **The holder, not the target.** Every one of these sentences says what
   * happens to the creature whose block it is, so the shape names the rolls
   * *it* makes and the requirement the engine reads is about where *it*
   * stands.
   */
  it('reads SRD Sunlight Sensitivity as the two rolls the sentence names', () => {
    expect(traitOf('kobold-warrior', 'Sunlight Sensitivity')).toEqual({
      kind: 'disadvantage-in-sunlight',
      rolls: ['ability-check', 'attack-roll'],
    });
  });

  it('reads it off the sentence, on every block that prints it', () => {
    for (const block of ['drider', 'specter', 'wight', 'wraith']) {
      expect(traitOf(block, 'Sunlight Sensitivity')).toEqual({
        kind: 'disadvantage-in-sunlight',
        rolls: ['ability-check', 'attack-roll'],
      });
    }
  });

  /**
   * SRD Sunlight Weakness: "While in sunlight, the shadow has Disadvantage on
   * D20 Tests." The same kind with a wider list, because the glossary settles
   * what the phrase covers: "D20 Tests encompass the three main d20 rolls of
   * the game: ability checks, attack rolls, and saving throws."
   */
  it('reads SRD Sunlight Weakness as the three rolls a D20 Test is', () => {
    expect(traitOf('shadow', 'Sunlight Weakness')).toEqual({
      kind: 'disadvantage-in-sunlight',
      rolls: ['ability-check', 'attack-roll', 'saving-throw'],
    });
  });

  /**
   * SRD Sunlight, on both vampires: "The vampire takes 20 Radiant damage if it
   * starts its turn in sunlight. While in sunlight, it has Disadvantage on
   * attack rolls and ability checks."
   *
   * Refused whole, for the swarm's reason: the second sentence is Sunlight
   * Sensitivity and the first is damage dealt at a turn boundary, which
   * nothing here can carry. Reading the sentence down to the half that fits
   * would take the burning off a vampire silently.
   */
  it('refuses the vampires’ Sunlight, whose first clause is damage', () => {
    expect(traitOf('vampire-spawn', 'Sunlight')).toBeNull();
    expect(traitOf('vampire', 'Sunlight')).toBeNull();
  });
});

describe('a trait that says a creature sheds light', () => {
  /**
   * SRD Illumination: "The azer sheds Bright Light in a 10-foot radius and Dim
   * Light for an additional 10 feet." Five blocks print it and the radii
   * differ, so the feet are part of the shape rather than prose beside it.
   */
  it('reads SRD Illumination with both of its radii', () => {
    expect(traitOf('azer-sentinel', 'Illumination')).toEqual({
      kind: 'sheds-light',
      brightRadiusFeet: 10,
      dimBeyondFeet: 10,
    });
    expect(traitOf('fire-elemental', 'Illumination')).toEqual({
      kind: 'sheds-light',
      brightRadiusFeet: 30,
      dimBeyondFeet: 30,
    });
    expect(traitOf('will-o-wisp', 'Illumination')).toEqual({
      kind: 'sheds-light',
      brightRadiusFeet: 20,
      dimBeyondFeet: 20,
    });
  });

  it('reads the nightmare’s and the fire beetle’s too', () => {
    expect(traitOf('nightmare', 'Illumination')).toEqual({
      kind: 'sheds-light',
      brightRadiusFeet: 10,
      dimBeyondFeet: 10,
    });
    expect(traitOf('giant-fire-beetle', 'Illumination')).toEqual({
      kind: 'sheds-light',
      brightRadiusFeet: 10,
      dimBeyondFeet: 10,
    });
  });

  /**
   * SRD Ignited Illumination: "The magmin sets itself ablaze or extinguishes
   * its flames. While ablaze, the magmin sheds Bright Light in a 10-foot
   * radius and Dim Light for an additional 10 feet."
   *
   * Refused, for the swarm's reason again: the light is gated on a state
   * nobody holds and the kind carries no field for it. A magmin read as an
   * unconditional lamp is a rule nobody printed.
   */
  it('refuses the magmin’s, whose light is gated on a state nobody holds', () => {
    expect(bonusActionTraitOf('magmin', 'Ignited Illumination')).toBeNull();
  });
});

describe('a Bonus Action that says what the dark buys', () => {
  /**
   * SRD Shadow Stealth, printed under **Bonus Actions**: "While in Dim Light
   * or Darkness, the shadow takes the Hide action." The heading says what it
   * costs; the sentence says what it is, and the sentence is what is read.
   */
  it('reads SRD Shadow Stealth off a line printed under Bonus Actions', () => {
    expect(bonusActionTraitOf('shadow', 'Shadow Stealth')).toEqual({
      kind: 'hides-in-dim-light-or-darkness',
    });
  });
});

describe('the reader is a list of matched sentences and not an interpreter', () => {
  it('reads nothing out of a trait nobody has matched', () => {
    expect(parseTraitShape('The elemental can move through a space as narrow as 1 inch.')).toBeNull();
    expect(parseTraitShape('The ankheg can burrow through solid rock at half its Burrow Speed.')).toBeNull();
  });

  it('refuses a climb sentence that stops short of the printed rule', () => {
    expect(parseTraitShape('The spider can climb difficult surfaces.')).toBeNull();
  });

  it('refuses a sunlight sentence that says one thing more', () => {
    // The vampires' Sunlight in the words Sunlight Sensitivity is printed in:
    // the rule this file reads, behind a clause that deals damage. Anchored,
    // so the Disadvantage is not read out from under the burning.
    expect(
      parseTraitShape(
        'The kobold takes 20 Radiant damage if it starts its turn in sunlight. While in sunlight, the kobold has Disadvantage on ability checks and attack rolls.',
      ),
    ).toBeNull();
  });

  it('refuses a shed-light sentence that is gated on something', () => {
    // The magmin's own, in the words the other five are printed in.
    expect(
      parseTraitShape(
        'While ablaze, the magmin sheds Bright Light in a 10-foot radius and Dim Light for an additional 10 feet.',
      ),
    ).toBeNull();
  });

  it('refuses a leap sentence whose distances it cannot read', () => {
    expect(
      parseTraitShape("The frog's Long Jump is prodigious and its High Jump is up to 5 feet with or without a running start."),
    ).toBeNull();
  });

  it('leaves every other trait of a block it did read alone', () => {
    // The frog prints two traits this file reads and the giant crab prints one
    // beside a sentence nothing matches; neither block gains a shape it was
    // not given.
    const crab = find('giant-crab');
    expect(crab.traits.filter((trait) => trait.trait !== undefined).map((t) => t.name)).toEqual([
      'Amphibious',
    ]);
  });
});
