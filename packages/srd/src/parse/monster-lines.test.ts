import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseAcAddendLine,
  parseCastLine,
  parseMonsters,
  parseReactionUseLine,
  parseRollAddendLine,
  parseTeleportLine,
} from './monsters.js';
import type { Monster } from '../schemas.js';

/**
 * Five sentences the parser could not start on, each a use whose economy the
 * engine already spends.
 *
 * A line that **casts** a named spell, a line that **teleports** its creature,
 * a Reaction that **adds** a flat number to somebody else's D20 Test, one that
 * adds a number to its own **Armour Class** against the attack that triggered
 * it, and one whose whole response is another **line of the same block**. All
 * five are anchored end to end like every other reader in this parser: a
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

  it('is carried onto the seven CR 5 and below lines that print it', () => {
    expect(lineOf('doppelganger', 'Read Thoughts').casts).toEqual({
      spells: ['detect-thoughts'],
      ability: 'cha',
      saveDc: 12,
    });
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

  it('reads a line whose heading rations it by a recharge, and leaves the rationing to the heading', () => {
    // How often a line may be taken is the economy's answer and not this
    // reader's: `printed-line-expended` and `line_expended` already spend a
    // recharge correctly for every line in the book, so a sentence read off a
    // recharging heading is read exactly as readily as any other.
    expect(lineOf('drider', 'Magic of the Spider Queen (Recharge 5–6)').casts).toEqual({
      spells: ['darkness', 'faerie-fire', 'web'],
      ability: 'wis',
      saveDc: 14,
    });
    expect(lineOf('stone-golem', 'Slow (Recharge 5–6)').casts).toEqual({
      spells: ['slow'],
      ability: 'con',
      saveDc: 17,
    });
  });

  /**
   * SRD Imp, Quasit and Sprite each print "casts _Invisibility_ **on itself**",
   * and the Oni prints the same clause under Bonus Actions. The target is not
   * a choice the caller makes and is not a clause the shape had a field for,
   * so the four lines were prose — which is a creature that cannot turn
   * invisible in an engine that could have settled every part of it.
   *
   * **A fixed target is a field and not a second shape.** Everything else the
   * sentence says is what every other cast line says, and reading it down to
   * the part that fits — casting Invisibility on whoever the caller named —
   * would be the thing the anchors exist to refuse.
   */
  it('reads a line that casts on the creature itself', () => {
    expect(
      parseCastLine(
        'The sprite casts _Invisibility_ on itself, requiring no spell components and using Charisma as the spellcasting ability.',
      ),
    ).toEqual({ spells: ['invisibility'], ability: 'cha', selfOnly: true });
    expect(
      parseCastLine(
        'The oni casts _Invisibility_ on itself, requiring no spell components and using the same spellcasting ability as Spellcasting.',
      ),
    ).toEqual({ spells: ['invisibility'], ability: 'spellcasting', selfOnly: true });
  });

  /**
   * SRD Imp prints "using Charisma as the **spell-casting** ability", where
   * the book's line break fell inside the word. The hyphen is typesetting and
   * the sentence is the same sentence, which is the reading `spellIdOf`
   * already takes of "Long-strider".
   */
  it('reads the word the book hyphenated at a line break', () => {
    expect(lineOf('imp', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'cha',
      selfOnly: true,
    });
    expect(lineOf('quasit', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'cha',
      selfOnly: true,
    });
    expect(lineOf('sprite', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'cha',
      selfOnly: true,
    });
    expect(lineOf('oni', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'spellcasting',
      selfOnly: true,
    });
  });

  /**
   * And the clause is still read whole or not at all: SRD Unicorn's Blessing
   * casts "on that creature" — a target the caller names — and stays prose,
   * which is the line above this one is not.
   */
  it('refuses a target clause that is not the caster', () => {
    expect(
      parseCastLine(
        'The imp casts _Invisibility_ on another creature, requiring no spell components and using Charisma as the spellcasting ability.',
      ),
    ).toBeNull();
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

  it('refuses the seven Parry lines, which add to an Armour Class', () => {
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

describe('a Reaction that adds to an Armour Class', () => {
  it('reads the number and both clauses of the trigger', () => {
    expect(
      parseAcAddendLine(
        '_Trigger:_ The knight is hit by a melee attack roll while holding a weapon. _Response:_ The knight adds 2 to its AC against that attack, possibly causing it to miss.',
      ),
    ).toEqual({ addend: 2, meleeOnly: true, requiresWeapon: true });
  });

  /**
   * The three lines that add a number to an Armour Class and then say
   * something else. Each is refused whole rather than read down to the part
   * that fits: a Riposte read as a Parry would be a stat block that stopped
   * swinging back.
   */
  it('refuses the three lines that say more than this shape holds', () => {
    expect(
      parseAcAddendLine(
        '_Trigger:_ The pirate is hit by a melee attack roll while holding a weapon. _Response:_ The pirate adds 3 to its AC against that attack, possibly causing it to miss. On a miss, the pirate makes one Rapier attack against the triggering creature if within range.',
      ),
    ).toBeNull();
    expect(
      parseAcAddendLine(
        '_Trigger:_ The mummy is hit by an attack roll. _Response:_ The mummy adds 2 to its AC against the attack, possibly causing the attack to miss, and the mummy teleports up to 60 feet to an unoccupied space it can see.',
      ),
    ).toBeNull();
    expect(
      parseAcAddendLine(
        '_Trigger:_ An attack roll hits the wearer of the guardian’s amulet while the wearer is within 5 feet of the guardian. _Response:_ The wearer gains a +5 bonus to AC, including against the triggering attack and possibly causing it to miss, until the start of the guardian’s next turn.',
      ),
    ).toBeNull();
    // And the sentence the sibling reader takes, which is about a roll rather
    // than about an Armour Class.
    expect(
      parseAcAddendLine(
        '_Trigger:_ The sphinx or another creature within 30 feet makes an ability check or a saving throw. _Response:_ The sphinx adds 2 to the roll.',
      ),
    ).toBeNull();
  });

  it('is carried onto the Knight at the number its own block prints', () => {
    expect(lineOf('knight', 'Parry').addsToAc).toEqual({
      addend: 2,
      meleeOnly: true,
      requiresWeapon: true,
    });
    // The number is the block's and not the shape's: three blocks print three.
    expect(lineOf('gladiator', 'Parry').addsToAc).toEqual({
      addend: 3,
      meleeOnly: true,
      requiresWeapon: true,
    });
  });
});

describe('a Reaction whose response is another line of the block', () => {
  it('reads the name the response performs', () => {
    expect(
      parseReactionUseLine(
        '_Trigger:_ An attack roll hits the rust monster. _Response:_ The rust monster uses Antennae.',
      ),
    ).toBe('Antennae');
  });

  /**
   * The Nalfeshnee's Pursuit uses a printed line too, and says two more things
   * about it — a different trigger, and where the teleport may land. Read down
   * to the name it would be a demon that teleports whenever anybody moves.
   */
  it('refuses a use whose sentence says more than the name', () => {
    expect(
      parseReactionUseLine(
        'Trigger: Another creature the nalfeshnee can see ends its move within 120 feet of the nalfeshnee. Response: The nalfeshnee uses Teleport, but its destination space must be within 10 feet of the triggering creature.',
      ),
    ).toBeNull();
  });

  it('is carried onto the Rust Monster', () => {
    expect(lineOf('rust-monster', 'Reflexive Antennae').usesLine).toBe('Antennae');
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

  it('reads exactly the cast lines the book prints in this shape, and no others', () => {
    // The membership, pinned by name over the whole corpus rather than
    // counted: a sentence this reader started matching, or stopped, shows up
    // here as a block nobody put in the list rather than as a number nobody
    // looks at.
    const casting = lines.filter((line) => line.casts !== undefined);
    expect(
      bestiary
        .flatMap((monster) =>
          [
            ...monster.traits,
            ...monster.actions,
            ...monster.bonusActions,
            ...monster.reactions,
            ...monster.legendaryActions,
          ]
            .filter((line) => line.casts !== undefined)
            .map((line) => `${monster.id}/${line.name}`),
        )
        .sort(),
    ).toEqual([
      'archmage/Misty Step (3/Day)',
      'cloud-giant/Misty Step',
      'couatl/Divine Aid (2/Day)',
      'cultist-fanatic/Spiritual Weapon (2/Day)',
      'deva/Divine Aid (2/Day)',
      'doppelganger/Read Thoughts',
      'drider/Magic of the Spider Queen (Recharge 5–6)',
      'dust-mephit/Sleep (1/Day)',
      'ice-mephit/Fog Cloud (1/Day)',
      'imp/Invisibility',
      'mage/Misty Step (3/Day)',
      'oni/Invisibility',
      'planetar/Divine Aid (2/Day)',
      'priest-acolyte/Divine Aid (1/Day)',
      'priest/Divine Aid (3/Day)',
      'quasit/Invisibility',
      'sprite/Invisibility',
      'stone-golem/Slow (Recharge 5–6)',
    ]);

    // Asserted over the corpus rather than assumed, which is how every other
    // claim about "no SRD line does X" in this parser is held down. Every cast
    // line is a heading a creature spends: none of them declares a spell list
    // as well, because the two are different sentences and the second is
    // `parseSpellcastingLine`'s. And none prints an attack roll or the save
    // template, which is what keeps the four openings one apiece.
    expect(casting.every((line) => line.spellcasting === undefined)).toBe(true);
    expect(casting.every((line) => line.attack === undefined)).toBe(true);
    expect(casting.every((line) => line.save === undefined)).toBe(true);
  });

  it('never reads two of the five shapes out of one sentence', () => {
    for (const line of lines) {
      const read = [
        line.casts,
        line.teleports,
        line.addsToRoll,
        line.addsToAc,
        line.usesLine,
      ].filter((shape) => shape !== undefined);
      expect(read.length).toBeLessThan(2);
    }
  });

  /**
   * The membership of the two new readers, pinned by name over the whole
   * corpus for the cast line's stated reason: a sentence one of them started
   * matching, or stopped, shows up here as a block nobody put in the list.
   */
  it('reads exactly the Parry lines and the one line that uses another', () => {
    const named = (has: (line: Monster['traits'][number]) => boolean): readonly string[] =>
      bestiary
        .flatMap((monster) =>
          [
            ...monster.traits,
            ...monster.actions,
            ...monster.bonusActions,
            ...monster.reactions,
            ...monster.legendaryActions,
          ]
            .filter(has)
            .map((line) => `${monster.id}/${line.name}`),
        )
        .sort();

    expect(named((line) => line.addsToAc !== undefined)).toEqual([
      'bandit-captain/Parry',
      'erinyes/Parry',
      'gladiator/Parry',
      'knight/Parry',
      'marilith/Parry',
      'noble/Parry',
      'warrior-veteran/Parry',
    ]);
    expect(named((line) => line.usesLine !== undefined)).toEqual([
      'rust-monster/Reflexive Antennae',
    ]);
  });

  /**
   * And the three Reactions read as **traits**: two sentences nothing spends
   * and one the table narrates. They are on the record as kinds so that the
   * ledger stops calling them unread, and none of them has a reader — see
   * `TRAIT_KINDS_WITH_A_READER` and `HANDOVER_TRAIT_KINDS`.
   */
  it('reads the three Reactions whose sentences are kinds rather than rules', () => {
    const kinds = bestiary.flatMap((monster) =>
      monster.reactions
        .filter((line) => line.trait !== undefined)
        .map((line) => `${monster.id}/${line.name}/${line.trait!.kind}`),
    );
    expect(kinds.sort()).toEqual([
      'black-pudding/Split/splits-into-two-creatures',
      'goblin-boss/Redirect Attack/swaps-places-with-an-ally-to-take-an-attack',
      'ochre-jelly/Split/splits-into-two-creatures',
      'shrieker-fungus/Shriek/makes-a-noise',
    ]);
  });
});
