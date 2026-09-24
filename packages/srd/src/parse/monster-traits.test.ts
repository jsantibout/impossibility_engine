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

  /**
   * SRD prints one rule under three headings — Nimble Escape, Cunning Action
   * and Deathless Agility — and the rule is the sentence rather than any of
   * the names: a named action paid for out of a Bonus Action.
   */
  it('reads SRD Nimble Escape as the two actions the goblin may buy', () => {
    expect(bonusActionTraitOf('goblin-minion', 'Nimble Escape')).toEqual({
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: ['disengage', 'hide'],
    });
  });

  it('reads the same rule under two other headings, with their own menus', () => {
    expect(bonusActionTraitOf('spy', 'Cunning Action')).toEqual({
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: ['dash', 'disengage', 'hide'],
    });
    expect(bonusActionTraitOf('vampire-spawn', 'Deathless Agility')).toEqual({
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: ['dash', 'disengage'],
    });
  });

  it('reads the menu off the sentence, whatever noun the block uses', () => {
    expect(bonusActionTraitOf('tiger', 'Nimble Escape')).toEqual({
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: ['disengage', 'hide'],
    });
  });
});

describe('a trait that says what being Bloodied buys', () => {
  /**
   * SRD Bloodied Fury: "While Bloodied, the boar has Advantage on attack
   * rolls." The glossary settles Bloodied at half Hit Points or fewer.
   */
  it('reads SRD Bloodied Fury as Advantage on the one roll it names', () => {
    expect(traitOf('boar', 'Bloodied Fury')).toEqual({
      kind: 'advantage-while-bloodied',
      rolls: ['attack-roll'],
    });
  });

  it('reads SRD Bloodied Frenzy as the wider list its sentence prints', () => {
    expect(traitOf('berserker', 'Bloodied Frenzy')).toEqual({
      kind: 'advantage-while-bloodied',
      rolls: ['attack-roll', 'saving-throw'],
    });
  });

  /**
   * The Giant Boar prints the same heading over a different rule — "melee
   * attack rolls", and the clause the other way round. A narrowing the kind
   * carries no field for is a rule nobody printed, so the line stays prose.
   */
  it('refuses the Giant Boar, whose sentence narrows the rolls', () => {
    expect(traitOf('giant-boar', 'Bloodied Fury')).toBeNull();
  });
});

describe('a trait that reads the creature being swung at', () => {
  /**
   * SRD Blood Frenzy: "The sahuagin has Advantage on attack rolls against any
   * creature that doesn't have all its Hit Points" — the same predicate SRD
   * Colossus Slayer writes as "if it's missing any of its Hit Points", read
   * off the target rather than off the holder.
   */
  it('reads SRD Blood Frenzy off the target rather than the holder', () => {
    expect(traitOf('sahuagin-warrior', 'Blood Frenzy')).toEqual({
      kind: 'advantage-against-a-wounded-target',
    });
  });

  it('refuses a sentence that drops the target clause', () => {
    expect(
      parseTraitShape(
        "The sahuagin has Advantage on attack rolls against any creature that doesn't have all its Hit Points.",
      ),
    ).toEqual({ kind: 'advantage-against-a-wounded-target' });
    expect(parseTraitShape('The sahuagin has Advantage on attack rolls.')).toBeNull();
  });
});

describe('a trait that is an aura', () => {
  /**
   * SRD Aura of Authority, which is SRD Aura of Protection's shape worn by a
   * stat block: a reach in feet, the holder and its allies inside it, and a
   * gate on the holder.
   */
  it('reads the radius, the rolls and nothing else', () => {
    expect(traitOf('hobgoblin-captain', 'Aura of Authority')).toEqual({
      kind: 'allies-in-emanation-have-advantage',
      feet: 10,
      rolls: ['attack-roll', 'saving-throw'],
    });
  });

  it('refuses the same aura with the Incapacitated clause read away', () => {
    const printed = find('hobgoblin-captain').traits.find(
      (trait) => trait.name === 'Aura of Authority',
    )!.text;
    expect(
      parseTraitShape(
        printed.replace(", provided the hobgoblin doesn't have the Incapacitated condition", ''),
      ),
    ).toBeNull();
  });

  /**
   * SRD Aberrant Ground: an Emanation that is Difficult Terrain, which moves
   * when the creature does.
   */
  it('reads the Gibbering Mouther’s ground as an emanation', () => {
    expect(traitOf('gibbering-mouther', 'Aberrant Ground')).toEqual({
      kind: 'emanation-is-difficult-terrain',
      feet: 10,
    });
  });
});

describe('a trait that says how a creature jumps or leaves a reach', () => {
  /**
   * SRD Running Leap, which is SRD Standing Leap's opposite: it *requires* the
   * ten feet where the frog's sentence removes them, so both numbers are the
   * rule.
   */
  it('reads both numbers of a running leap', () => {
    expect(traitOf('lion', 'Running Leap')).toEqual({
      kind: 'long-jump-with-a-running-start',
      runningStartFeet: 10,
      longJumpFeet: 25,
    });
    expect(traitOf('saber-toothed-tiger', 'Running Leap')).toEqual({
      kind: 'long-jump-with-a-running-start',
      runningStartFeet: 10,
      longJumpFeet: 25,
    });
  });

  /**
   * SRD Agile is SRD Flyby with one word changed, and the word is the whole
   * rule — so the two sentences reach two kinds and neither block gets the
   * other's.
   */
  it('tells a creature that walks away from one that flies away', () => {
    expect(traitOf('deer', 'Agile')).toEqual({ kind: 'does-not-provoke-when-leaving-reach' });
    expect(traitOf('rat', 'Agile')).toEqual({ kind: 'does-not-provoke-when-leaving-reach' });
    expect(traitOf('gargoyle', 'Flyby')).toEqual({
      kind: 'does-not-provoke-when-flying-out-of-reach',
    });
  });
});

describe('a trait about what a creature does to a thing rather than a creature', () => {
  it('reads SRD Siege Monster', () => {
    expect(traitOf('earth-elemental', 'Siege Monster')).toEqual({
      kind: 'deals-double-damage-to-objects',
    });
  });

  it('refuses a doubling against anything the sentence does not name', () => {
    expect(
      parseTraitShape('The elemental deals double damage to objects and structures.'),
    ).toEqual({ kind: 'deals-double-damage-to-objects' });
    expect(parseTraitShape('The elemental deals double damage to Plants.')).toBeNull();
  });
});

describe('a trait a damage type sets off', () => {
  /**
   * SRD Lightning Absorption, printed on the Flesh Golem and the Shambling
   * Mound, both of which are immune to the type they absorb.
   */
  it('reads the type a block absorbs', () => {
    expect(traitOf('flesh-golem', 'Lightning Absorption')).toEqual({
      kind: 'absorbs-a-damage-type',
      damageType: 'lightning',
    });
    expect(traitOf('shambling-mound', 'Lightning Absorption')).toEqual({
      kind: 'absorbs-a-damage-type',
      damageType: 'lightning',
    });
  });

  /**
   * And the Iron Golem's Fire Absorption, which is the same sentence under
   * another heading — the rule this reader has followed since Pack Tactics:
   * matched on the sentence and never on the name above it.
   */
  it('reads the same sentence printed under another heading', () => {
    expect(traitOf('iron-golem', 'Fire Absorption')).toEqual({
      kind: 'absorbs-a-damage-type',
      damageType: 'fire',
    });
  });

  /** A sentence naming two types is a rule nobody wrote. */
  it('refuses a sentence whose two types disagree', () => {
    expect(
      parseTraitShape(
        'Whenever the golem is subjected to Lightning damage, it regains a number of Hit Points equal to the Fire damage dealt.',
      ),
    ).toBeNull();
    expect(
      parseTraitShape(
        'Whenever the golem is subjected to Sonic damage, it regains a number of Hit Points equal to the Sonic damage dealt.',
      ),
    ).toBeNull();
  });

  /**
   * SRD Aversion to Fire, and the glossary's order for the two nouns whichever
   * order the block prints them in.
   */
  it('reads the type and the rolls a penalty follows', () => {
    expect(traitOf('flesh-golem', 'Aversion to Fire')).toEqual({
      kind: 'penalised-after-taking-a-damage-type',
      damageType: 'fire',
      rolls: ['ability-check', 'attack-roll'],
    });
  });

  it('refuses the same sentence with another span on the end of it', () => {
    expect(
      parseTraitShape(
        'If the golem takes Fire damage, it has Disadvantage on attack rolls and ability checks until the end of its next turn.',
      ),
    ).toEqual({
      kind: 'penalised-after-taking-a-damage-type',
      damageType: 'fire',
      rolls: ['ability-check', 'attack-roll'],
    });
    expect(
      parseTraitShape(
        'If the golem takes Fire damage, it has Disadvantage on attack rolls and ability checks for 1 hour.',
      ),
    ).toBeNull();
  });
});

describe('a trait a turn boundary owes', () => {
  /**
   * SRD Fire Aura, printed four ways: the Azer's choice and its Incapacitated
   * clause, the Salamander's choice without one, the Balor's no choice at all.
   * Every part that varies is carried.
   */
  it('reads the moment, the radius, the dice, the choice and the gate', () => {
    expect(traitOf('azer-sentinel', 'Fire Aura')).toEqual({
      kind: 'damages-creatures-in-an-emanation',
      moment: 'end',
      feet: 5,
      dice: '1d10',
      damageType: 'fire',
      chosen: true,
      unlessIncapacitated: true,
    });
    expect(traitOf('salamander', 'Fire Aura')).toEqual({
      kind: 'damages-creatures-in-an-emanation',
      moment: 'end',
      feet: 5,
      dice: '2d6',
      damageType: 'fire',
      chosen: true,
      unlessIncapacitated: false,
    });
    expect(traitOf('balor', 'Fire Aura')).toEqual({
      kind: 'damages-creatures-in-an-emanation',
      moment: 'end',
      feet: 5,
      dice: '3d8',
      damageType: 'fire',
      chosen: false,
      unlessIncapacitated: false,
    });
  });

  /**
   * And the Fire Elemental's, which is the anchoring rule doing its work: its
   * sentence ends "Creatures and flammable objects in the Emanation start
   * burning", and there is no burning here.
   */
  it('refuses the aura whose sentence sets the room alight', () => {
    expect(traitOf('fire-elemental', 'Fire Aura')).toBeNull();
  });

  /** SRD Barbed Hide: the same moment, caught by the hold rather than by feet. */
  it('reads the damage a hold owes at the start of a turn', () => {
    expect(traitOf('barbed-devil', 'Barbed Hide')).toEqual({
      kind: 'damages-creatures-it-is-holding',
      moment: 'start',
      dice: '1d10',
      damageType: 'piercing',
    });
  });

  it('refuses a hold sentence that names only one direction', () => {
    expect(
      parseTraitShape(
        'At the start of each of its turns, the devil deals 5 (1d10) Piercing damage to any creature it is grappling.',
      ),
    ).toBeNull();
  });
});

describe('three more sentences the engine already had a seam for', () => {
  /**
   * SRD Freeze: the same trigger SRD Aversion to Fire prints, with a Speed on
   * the end of it instead of a roll mode.
   */
  it('reads the Speed a damage type costs', () => {
    expect(traitOf('water-elemental', 'Freeze')).toEqual({
      kind: 'speed-cut-after-taking-a-damage-type',
      damageType: 'cold',
      feet: 20,
    });
  });

  /**
   * SRD Blurred Form, which is the first printed trait whose mode sits on the
   * rolls made **against** its holder.
   */
  it('reads the Disadvantage an attacker takes, gate and all', () => {
    expect(traitOf('steam-mephit', 'Blurred Form')).toEqual({
      kind: 'disadvantage-on-attacks-against-it',
    });
    expect(
      parseTraitShape('Attack rolls against the mephit are made with Disadvantage.'),
    ).toBeNull();
  });

  /** SRD Beast of Burden, which is SRD Powerful Build on a stat block. */
  it('reads the step a carrying capacity is read at', () => {
    expect(traitOf('mule', 'Beast of Burden')).toEqual({
      kind: 'carries-as-a-larger-creature',
      sizesLarger: 1,
    });
  });
});

/**
 * The **third answer**: sentences read so that the table gets them, and that
 * no rule will ever consult.
 *
 * `docs/design/content.md` settles the test — "a table fact that a rule then
 * reads is a debt; a table fact nothing reads afterwards is a handover" — and
 * every kind below is on the second side of it. They are anchored as hard as
 * everything else here, because a kind is a claim about what was read and not
 * a label stuck on a heading.
 */
describe('the sentences that are fiction, read so the table gets them', () => {
  const handovers: readonly (readonly [string, string, string])[] = [
    ['green-hag', 'Mimicry', 'mimics-sounds'],
    ['raven', 'Mimicry', 'mimics-sounds'],
    ['homunculus', 'Telepathic Bond', 'speaks-telepathically-with-its-master'],
    ['vampire-familiar', 'Vampiric Connection', 'is-perceived-through-by-its-master'],
    ['sahuagin-warrior', 'Shark Telepathy', 'controls-a-kind-of-creature'],
    ['rust-monster', 'Iron Scent', 'pinpoints-a-substance'],
    ['xorn', 'Treasure Sense', 'pinpoints-a-substance'],
    ['dryad', 'Speak with Beasts and Plants', 'speaks-with-a-kind-of-creature'],
    ['ghost', 'Ethereal Sight', 'sees-into-another-plane'],
    ['phase-spider', 'Ethereal Sight', 'sees-into-another-plane'],
    ['gelatinous-cube', 'Transparent', 'goes-unnoticed-until-it-moves'],
    ['couatl', 'Shielded Mind', 'thoughts-cannot-be-read'],
    ['flesh-golem', 'Immutable Form', 'cannot-shape-shift'],
    ['barbed-devil', 'Diabolical Restoration', 'revives-on-another-plane'],
    ['lemure', 'Hellish Restoration', 'revives-on-another-plane'],
    ['chuul', 'Sense Magic', 'senses-magic-nearby'],
    ['commoner', 'Training', 'has-a-skill-the-gm-chooses'],
    ['half-dragon', 'Draconic Origin', 'has-a-damage-type-the-gm-chooses'],
    ['fire-elemental', 'Water Susceptibility', 'is-hurt-by-water'],
    ['vampire-spawn', 'Running Water', 'is-hurt-by-water'],
    ['vampire-spawn', 'Forbiddance', 'cannot-enter-a-home-uninvited'],
    ['vampire-spawn', 'Vampire Weakness', 'a-heading-over-the-lines-that-follow'],
  ];

  it.each(handovers)('reads %s’s %s as %s', (block, line, kind) => {
    expect(traitOf(block, line)).toEqual({ kind });
  });

  /**
   * And each of them is still anchored: the shortest sentence on the list is
   * the Flesh Golem's four words, and a fifth word is a different rule.
   */
  it('refuses a handover sentence that says one more thing', () => {
    expect(parseTraitShape("The golem can't shape-shift.")).toEqual({
      kind: 'cannot-shape-shift',
    });
    expect(parseTraitShape("The golem can't shape-shift or be shape-shifted.")).toBeNull();
    expect(
      parseTraitShape('The dryad can communicate with Beasts and Plants as if they shared a language, and they obey it.'),
    ).toBeNull();
  });
});

/**
 * The sentences that describe a **world** this lattice does not hold.
 *
 * The same third answer the paragraph above is, arrived at from the other
 * side. Those sentences name minds, planes, sounds and a GM's choice; these
 * name materials, gaps, webs, ice and a heart — facts about the place a
 * creature is standing in rather than about the creature — and the scene holds
 * creatures, landmarks, declared objects and declared regions and no substance
 * at all. So there is nothing for a rule to read afterwards, which is the test
 * `docs/design/content.md` sets.
 *
 * **They are not the same claim as the residue beside them.** A sentence that
 * states a mechanic the engine would run the day it had one seam stays unread
 * and stays a debt: the Gelatinous Cube's Ooze Cube holds creatures inside
 * itself, the Night Hag's Soul Bag is an object with an Armour Class that
 * gates an action, and the Troll Limb's Troll Spawn rolls a d12 and puts a
 * second stat block in the fight. None of those is here.
 */
describe('the sentences that describe a world the lattice does not hold', () => {
  const worldFacts: readonly (readonly [string, string, string])[] = [
    ['black-pudding', 'Amorphous', 'moves-through-a-one-inch-gap'],
    ['gray-ooze', 'Amorphous', 'moves-through-a-one-inch-gap'],
    ['ochre-jelly', 'Amorphous', 'moves-through-a-one-inch-gap'],
    ['shadow', 'Amorphous', 'moves-through-a-one-inch-gap'],
    ['octopus', 'Compression', 'moves-through-a-one-inch-gap'],
    ['air-elemental', 'Air Form', 'enters-a-creature-space-and-a-one-inch-gap'],
    ['invisible-stalker', 'Air Form', 'enters-a-creature-space-and-a-one-inch-gap'],
    ['water-elemental', 'Water Form', 'enters-a-creature-space-and-a-one-inch-gap'],
    ['fire-elemental', 'Fire Form', 'burns-a-creature-whose-space-it-enters'],
    ['ghost', 'Incorporeal Movement', 'moves-through-creatures-and-objects'],
    ['specter', 'Incorporeal Movement', 'moves-through-creatures-and-objects'],
    ['will-o-wisp', 'Incorporeal Movement', 'moves-through-creatures-and-objects'],
    ['wraith', 'Incorporeal Movement', 'moves-through-creatures-and-objects'],
    ['earth-elemental', 'Earth Glide', 'burrows-through-earth-and-stone'],
    ['xorn', 'Earth Glide', 'burrows-through-earth-and-stone'],
    ['ankheg', 'Tunneler', 'burrows-through-solid-rock'],
    ['purple-worm', 'Tunneler', 'burrows-through-solid-rock'],
    ['drider', 'Web Walker', 'ignores-a-webs-restrictions'],
    ['ettercap', 'Web Walker', 'ignores-a-webs-restrictions'],
    ['phase-spider', 'Web Walker', 'ignores-a-webs-restrictions'],
    ['giant-spider', 'Web Walker', 'ignores-a-webs-restrictions'],
    ['spider', 'Web Walker', 'ignores-a-webs-restrictions'],
    ['white-dragon-wyrmling', 'Ice Walk', 'walks-on-ice'],
    ['ancient-white-dragon', 'Ice Walk', 'walks-on-ice'],
    ['will-o-wisp', 'Ephemeral', 'cannot-wear-or-carry-anything'],
    ['mimic', 'Adhesive (Object Form Only)', 'adheres-to-what-touches-it'],
    ['nightmare', 'Confer Fire Resistance', 'confers-a-resistance-to-a-rider'],
    ['vampire-spawn', 'Stake to the Heart', 'destroyed-by-a-stake-through-the-heart'],
    ['vampire', 'Stake to the Heart', 'paralyzed-by-a-stake-through-the-heart'],
  ];

  it.each(worldFacts)('reads %s’s %s as %s', (block, line, kind) => {
    expect(traitOf(block, line)).toEqual({ kind });
  });

  /**
   * **The two stakes are two kinds**, because the book prints two rules under
   * one heading: the spawn is destroyed and the vampire is Paralyzed until the
   * weapon is drawn out. One kind over both would have claimed the weaker of
   * the two about the stronger creature.
   */
  it('keeps the two stakes apart', () => {
    expect(traitOf('vampire-spawn', 'Stake to the Heart')).not.toEqual(
      traitOf('vampire', 'Stake to the Heart'),
    );
  });

  /**
   * And every one of them is anchored end to end, exactly as the fiction above
   * is: a sentence that says one more thing is a different sentence.
   *
   * The Fire Elemental is the case that makes the rule worth a test. Its Fire
   * Form is the Air Elemental's two clauses **plus** damage to the creature
   * whose space it entered, so a regex loose enough to read one would read the
   * other and lose the damage without saying so.
   */
  it('refuses a world-fact sentence that says one more thing', () => {
    const narrow =
      'The pudding can move through a space as narrow as 1 inch without expending extra movement to do so.';
    expect(parseTraitShape(narrow)).toEqual({ kind: 'moves-through-a-one-inch-gap' });
    expect(parseTraitShape(narrow.replace('1 inch', '1 foot'))).toBeNull();
    expect(
      parseTraitShape(`${narrow.slice(0, -1)}, and it can enter a creature's space and stop there.`),
    ).toBeNull();

    // The Fire Elemental's, one clause at a time: the whole sentence is a kind
    // of its own and the two clauses it shares with the Air Elemental are not
    // read out of it.
    const fire = traitOf('fire-elemental', 'Fire Form');
    expect(fire).toEqual({ kind: 'burns-a-creature-whose-space-it-enters' });
    const air = find('fire-elemental').traits.find((t) => t.name === 'Fire Form')!.text;
    expect(parseTraitShape(air.replace(/ The first time[^]*$/, ''))).toBeNull();
  });

  /**
   * And the sentences that stay unread, named here so that a later reader
   * cannot quietly promote one: each states a mechanic this engine holds a
   * primitive for and the seam it is missing is written beside it in
   * `HANDOVER_TRAIT_KINDS`' own note. Calling one of these fiction would
   * retire a debt by renaming it.
   */
  it.each([
    ['gelatinous-cube', 'Ooze Cube'],
    ['night-hag', 'Soul Bag'],
    ['troll-limb', 'Troll Spawn'],
    ['succubus', 'Incubus Form'],
    ['incubus', 'Succubus Form'],
    ['flesh-golem', 'Berserk'],
    ['bugbear-warrior', 'Abduct'],
    ['swarm-of-insects', 'Spider Climb'],
  ])('leaves %s’s %s unread, because it states a mechanic', (block, line) => {
    expect(traitOf(block, line)).toBeNull();
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

  /**
   * The Clay Golem's Hasten: "The golem takes the Dash and Disengage
   * actions." **And**, not **or** — it takes both, and on a recharge — which
   * is two rules the kind carries no field for. A menu read out of a
   * conjunction is a choice nobody printed.
   */
  it('refuses a bonus-action sentence that conjoins rather than offers', () => {
    expect(parseTraitShape('The golem takes the Dash and Disengage actions.')).toBeNull();
  });

  it('refuses a bonus-action sentence naming an action outside the menu', () => {
    expect(parseTraitShape('The scout takes the Search or Hide action.')).toBeNull();
  });

  it('refuses a Bloodied sentence that says one thing more', () => {
    expect(
      parseTraitShape(
        'While Bloodied, the boar has Advantage on attack rolls and moves at double its Speed.',
      ),
    ).toBeNull();
  });

  it('refuses a leap sentence whose distances it cannot read', () => {
    expect(
      parseTraitShape("The frog's Long Jump is prodigious and its High Jump is up to 5 feet with or without a running start."),
    ).toBeNull();
  });

  /**
   * SRD Undead Fortitude, printed word for word on the Zombie and the Ogre
   * Zombie, and on nothing else in the book.
   */
  it('reads the sentence that stands a zombie back up', () => {
    expect(traitOf('zombie', 'Undead Fortitude')).toEqual({ kind: 'undead-fortitude' });
    expect(traitOf('ogre-zombie', 'Undead Fortitude')).toEqual({ kind: 'undead-fortitude' });
    expect(
      bestiary.filter((monster) =>
        monster.traits.some((trait) => trait.trait?.kind === 'undead-fortitude'),
      ).length,
    ).toBe(2);
  });

  /**
   * The whole rule is in the clauses — a Constitution save, a DC read off the
   * damage, two exceptions, and the one Hit Point a success leaves — so a
   * sentence that changes any of them is refused rather than read down to the
   * part that fits. A zombie that stood up on a Dexterity save at DC 5 would
   * be a creature the book did not print.
   */
  it('refuses a fortitude sentence that moves any of its clauses', () => {
    const printed =
      'If damage reduces the zombie to 0 Hit Points, it makes a Constitution saving throw (DC 5 plus the damage taken) unless the damage is Radiant or from a Critical Hit. On a successful save, the zombie drops to 1 Hit Point instead.';
    expect(parseTraitShape(printed)).toEqual({ kind: 'undead-fortitude' });
    expect(parseTraitShape(printed.replace('Constitution', 'Dexterity'))).toBeNull();
    expect(parseTraitShape(printed.replace('DC 5 plus', 'DC 10 plus'))).toBeNull();
    expect(parseTraitShape(printed.replace(' unless the damage is Radiant or from a Critical Hit', ''))).toBeNull();
    expect(parseTraitShape(printed.replace('1 Hit Point', '10 Hit Points'))).toBeNull();
  });

  /**
   * SRD Magic Resistance, one sentence over devils, golems, genies, hags and
   * the rest — and the Rakshasa's Greater Magic Resistance, which shares nine
   * words with it and is a different rule in three clauses.
   */
  it('reads the sentence that turns a spell aside', () => {
    expect(traitOf('imp', 'Magic Resistance')).toEqual({ kind: 'magic-resistance' });
    expect(traitOf('dryad', 'Magic Resistance')).toEqual({ kind: 'magic-resistance' });
    expect(traitOf('rakshasa', 'Greater Magic Resistance')).toBeNull();
  });

  it('refuses a resistance sentence that promises more than Advantage', () => {
    expect(
      parseTraitShape('The devil has Advantage on saving throws against spells and other magical effects.'),
    ).toEqual({ kind: 'magic-resistance' });
    expect(
      parseTraitShape(
        'The devil automatically succeeds on saving throws against spells and other magical effects.',
      ),
    ).toBeNull();
    expect(
      parseTraitShape('The devil has Advantage on saving throws against spells.'),
    ).toBeNull();
  });

  /**
   * **A heading read in part, and honest about the rest.** SRD Swarm prints
   * three sentences: two about a lattice this engine has not got — a creature
   * standing in another's space, an opening with a width — and one the engine
   * holds a door for. Before the trait could carry a residue the reader's
   * only choices were to claim all three or to refuse the heading whole.
   */
  it('reads the swarm’s healing sentence and hands back its two space clauses', () => {
    const swarm = traitOf('swarm-of-rats', 'Swarm');
    expect(swarm).toEqual({
      kind: 'regains-no-hit-points',
      handedOver: [
        "The swarm can occupy another creature's space and vice versa.",
        'the swarm can move through any opening large enough for a Tiny rat.',
      ],
    });

    // All seven swarms print it, each with its own animal in the opening.
    const swarms = bestiary.filter((block) =>
      block.traits.some((trait) => trait.trait?.kind === 'regains-no-hit-points'),
    );
    expect(swarms.map((block) => block.id).sort()).toEqual([
      'swarm-of-bats',
      'swarm-of-crawling-claws',
      'swarm-of-insects',
      'swarm-of-piranhas',
      'swarm-of-rats',
      'swarm-of-ravens',
      'swarm-of-venomous-snakes',
    ]);
    for (const block of swarms) {
      expect(
        block.traits.find((trait) => trait.trait?.kind === 'regains-no-hit-points')!.trait!
          .handedOver,
      ).toHaveLength(2);
    }
  });

  it('refuses a swarm sentence that says one thing more', () => {
    expect(
      parseTraitShape(
        "The swarm can occupy another creature's space and vice versa, and the swarm can move " +
          "through any opening large enough for a Tiny rat. The swarm can't regain Hit Points " +
          'or gain Temporary Hit Points.',
      ),
    ).toEqual({
      kind: 'regains-no-hit-points',
      handedOver: [
        "The swarm can occupy another creature's space and vice versa.",
        'the swarm can move through any opening large enough for a Tiny rat.',
      ],
    });
    // The healing half alone is not the heading, and neither is the heading
    // with a Climb Speed gate on the end of it.
    expect(parseTraitShape("The swarm can't regain Hit Points or gain Temporary Hit Points.")).toBeNull();
    expect(
      parseTraitShape(
        "The swarm can occupy another creature's space and vice versa, and the swarm can move " +
          "through any opening large enough for a Tiny rat. The swarm can't regain Hit Points " +
          'or gain Temporary Hit Points. If the swarm has a Climb Speed, it can climb.',
      ),
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
