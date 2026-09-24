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
    ['nightmare', 'Confer Fire Resistance', 'grants-a-resistance-to-its-rider'],
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
