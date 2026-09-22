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

describe('the reader is a list of matched sentences and not an interpreter', () => {
  it('reads nothing out of a trait nobody has matched', () => {
    expect(parseTraitShape('The elemental can move through a space as narrow as 1 inch.')).toBeNull();
    expect(parseTraitShape('The ankheg can burrow through solid rock at half its Burrow Speed.')).toBeNull();
  });

  it('refuses a climb sentence that stops short of the printed rule', () => {
    expect(parseTraitShape('The spider can climb difficult surfaces.')).toBeNull();
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
