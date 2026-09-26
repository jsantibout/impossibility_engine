import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseAcAddendLine,
  parseCastLine,
  parseDashLine,
  parseJumpLine,
  parseMonsters,
  parsePlaneShiftLine,
  parsePullLine,
  parseReactionUseLine,
  parseRollAddendLine,
  parseSaveLine,
  parseSwallowLine,
  parseTeleportLine,
  parseTreeStrideLine,
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

describe('a line that swallows', () => {
  const FROG =
    "The frog swallows a Small or smaller target it is grappling. While swallowed, the target isn't Grappled but has the Blinded and Restrained conditions, and it has Total Cover against attacks and other effects outside the frog. While swallowing the target, the frog can't use Bite, and if the frog dies, the swallowed target is no longer Restrained and can escape from the corpse using 5 feet of movement, exiting with the Prone condition. <br>\n&emsp;At the end of the frog's next turn, the swallowed target takes 5 (2d4) Acid damage. If that damage doesn't kill it, the frog disgorges it, causing it to exit Prone.";
  const TOAD =
    "The toad swallows a Medium or smaller target it is grappling. While swallowed, the target isn't Grappled but has the Blinded and Restrained conditions, and it has Total Cover against attacks and other effects outside the toad. In addition, the target takes 10 (3d6) Acid damage at the end of each of the toad's turns. The <br>\n&emsp;toad can have only one target swallowed at a time, and it can't use Bite while it has a swallowed target. If the toad dies, a swallowed creature is no longer Restrained and can escape from the corpse using 5 feet of movement, exiting with the Prone condition.";

  it('reads the frog’s one hit and its disgorging', () => {
    expect(parseSwallowLine(FROG)).toEqual({
      maxSize: 'small',
      conditions: ['blinded', 'restrained'],
      damage: { dice: '2d4', type: 'acid', of: 'next', disgorges: true },
      handedOver: ["While swallowing the target, the frog can't use Bite"],
    });
  });

  it('reads the toad’s hit at every one of its turns', () => {
    expect(parseSwallowLine(TOAD)).toEqual({
      maxSize: 'medium',
      conditions: ['blinded', 'restrained'],
      damage: { dice: '3d6', type: 'acid', of: 'each', disgorges: false },
      handedOver: ["it can't use Bite while it has a swallowed target"],
    });
  });

  it('refuses a swallow that says anything else', () => {
    expect(parseSwallowLine(FROG.replace('exiting with the Prone condition', 'exiting'))).toBeNull();
    expect(parseSwallowLine('The frog swallows a Small or smaller target it is grappling.')).toBeNull();
    expect(parseSwallowLine(TOAD.replace('Acid damage', 'Acid damage and is Poisoned'))).toBeNull();
  });
});

describe('a line that steps onto another plane', () => {
  it('reads the three sentences the book prints', () => {
    expect(
      parsePlaneShiftLine('The spider teleports from the Material Plane to the Ethereal Plane or vice versa.'),
    ).toEqual({ plane: 'ethereal' });
    expect(
      parsePlaneShiftLine(
        'The nightmare and up to three willing creatures within 5 feet of it teleport to the Ethereal Plane from the Material Plane or vice versa.',
      ),
    ).toEqual({ plane: 'ethereal', companions: { count: 3, within: 5 } });
    expect(
      parsePlaneShiftLine(
        "The ghost casts the _Etherealness_ spell, requiring no spell components and using Charisma as the spellcasting ability. The ghost is visible on the Material Plane while on the Border Ethereal and vice versa, but it can't affect or be affected by anything on the other plane.",
      ),
    ).toEqual({ plane: 'ethereal' });
  });

  it('refuses a step to any other plane, and a teleport on this one', () => {
    expect(
      parsePlaneShiftLine('The spider teleports from the Material Plane to the Shadowfell or vice versa.'),
    ).toBeNull();
    expect(parsePlaneShiftLine('The dog teleports up to 40 feet to an unoccupied space it can see.')).toBeNull();
    expect(
      parsePlaneShiftLine(
        'The ghost casts the _Etherealness_ spell, requiring no spell components and using Charisma as the spellcasting ability.',
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

/**
 * A line that **pulls** what it is already holding.
 *
 * SRD Roper, Reel: "The roper pulls each creature Grappled by it up to 30 feet
 * straight toward it." Every clause of that is a rule the engine holds —
 * `pullToward` is what SRD Merrow's rider already goes through, and the
 * grapple is the one `escapeGrapple` answers — so the sentence is the same
 * mechanism at a heading's price.
 *
 * Anchored end to end, which is what refuses the Ettercap's line under the
 * same heading: it pulls "one creature within 30 feet of itself that is
 * **Restrained by its Web Strand**", and a web is neither a grapple nor
 * anything else this engine holds.
 */
describe('a line that pulls what it is holding', () => {
  it('reads the roper’s distance and what it pulls', () => {
    expect(lineOf('roper', 'Reel').pulls).toEqual({ feet: 30, of: 'grappled' });
  });

  it('refuses the ettercap’s, whose hold is a web rather than a grapple', () => {
    expect(lineOf('ettercap', 'Reel').pulls).toBeUndefined();
  });

  it('refuses a sentence that moves any of its clauses', () => {
    const printed = 'The roper pulls each creature Grappled by it up to 30 feet straight toward it.';
    expect(parsePullLine(printed)).toEqual({ feet: 30, of: 'grappled' });
    expect(parsePullLine(printed.replace('Grappled by it', 'Restrained by it'))).toBeNull();
    expect(parsePullLine(printed.replace('each creature', 'one creature'))).toBeNull();
    expect(parsePullLine(printed.replace(' straight toward it', ''))).toBeNull();
  });

  it('is the only line in the bestiary that prints it', () => {
    const printed = bestiary.flatMap((block) =>
      [...block.actions, ...block.bonusActions].filter((line) => line.pulls !== undefined),
    );
    expect(printed.length).toBe(1);
  });
});

/**
 * A line that puts its creature into **a form**.
 *
 * SRD Shape-Shift, printed thirteen times: "The werewolf shape-shifts into a
 * Large wolf-humanoid hybrid or a Medium wolf, or it returns to its true
 * humanoid form. Its game statistics, other than its size, are the same in
 * each form. Any equipment it is wearing or carrying isn't transformed."
 *
 * Three things vary between the printings and each is part of the shape: the
 * **names** the forms go by, because the block's own attack lines gate on them
 * ("Bite (Wolf or Hybrid Form Only)"); the **sizes**, because the sentence
 * says the statistics are the same *other than* those; and the **Speeds**, on
 * the two blocks that print a Speed per form. What the sentence promises about
 * the rest of the block — the statistics unchanged, the equipment untouched —
 * is honoured by the engine doing nothing, which is why neither is a field.
 *
 * Anchored end to end like every reader in this file, and every sentence after
 * the first is either one of the inert promises above or is carried verbatim
 * in `handedOver`: the Succubus's Fly Speed clause is a rule, and reading it
 * away would give the succubus a Speed the book withheld.
 */
describe('a line that takes a form', () => {
  const formsOf = (id: string, name: string) => lineOf(id, name).forms ?? null;

  it('reads the werewolf’s three forms, with the sizes the line prints', () => {
    expect(formsOf('werewolf', 'Shape-Shift')).toEqual({
      forms: [
        { name: 'hybrid', sizes: ['large'], speed: null },
        { name: 'wolf', sizes: ['medium'], speed: null },
        { name: 'humanoid', sizes: [], speed: null },
      ],
      handedOver: [],
    });
  });

  it('names the true form by the noun the line gives it, or `true` where it gives none', () => {
    expect(formsOf('mimic', 'Shape-Shift')).toEqual({
      forms: [
        { name: 'object', sizes: ['medium', 'small'], speed: null },
        { name: 'blob', sizes: [], speed: null },
      ],
      handedOver: [],
    });
    expect(formsOf('doppelganger', 'Shape-Shift')).toEqual({
      forms: [
        { name: 'humanoid', sizes: ['medium', 'small'], speed: null },
        { name: 'true', sizes: [], speed: null },
      ],
      handedOver: [],
    });
  });

  it('reads the Speeds the imp’s three animals print, one per form', () => {
    expect(formsOf('imp', 'Shape-Shift')).toEqual({
      forms: [
        {
          name: 'rat',
          sizes: [],
          speed: { walk: 20, burrow: null, climb: null, fly: null, swim: null, hover: false },
        },
        {
          name: 'raven',
          sizes: [],
          speed: { walk: 20, burrow: null, climb: null, fly: 60, swim: null, hover: false },
        },
        {
          name: 'spider',
          sizes: [],
          speed: { walk: 20, burrow: null, climb: 20, fly: null, swim: null, hover: false },
        },
        { name: 'true', sizes: [], speed: null },
      ],
      handedOver: [],
    });
    expect(formsOf('quasit', 'Shape-Shift')?.forms.map((form) => form.name)).toEqual([
      'bat',
      'centipede',
      'toad',
      'true',
    ]);
  });

  it('reads a line whose alternatives the book joins with no comma', () => {
    // The Oni: "into a Small or Medium Humanoid or a Large Giant".
    expect(formsOf('oni', 'Shape-Shift')).toEqual({
      forms: [
        { name: 'humanoid', sizes: ['small', 'medium'], speed: null },
        { name: 'giant', sizes: ['large'], speed: null },
        { name: 'true', sizes: [], speed: null },
      ],
      handedOver: [],
    });
  });

  it('carries the succubus’s Fly Speed clause rather than reading it away', () => {
    // "Its game statistics are the same in each form, except its Fly Speed is
    // available only in its true form." A rule, and the engine has no arm for
    // a Speed a *form* takes away — so the forms are read and the sentence
    // comes back whole.
    const read = formsOf('succubus', 'Shape-Shift');
    expect(read?.forms.map((form) => form.name)).toEqual(['humanoid', 'true']);
    expect(read?.handedOver).toEqual([
      'Its game statistics are the same in each form, except its Fly Speed is available only in its true form.',
    ]);
  });

  it('refuses the vampire’s, whose line is gated and transforms what it wears', () => {
    // "If the vampire isn't in sunlight or running water, it shape-shifts…"
    // and "Anything it is wearing transforms with it" — a gate the engine
    // cannot evaluate, and the opposite of the equipment rule every other
    // printing states.
    expect(formsOf('vampire', 'Shape-Shift')).toBeNull();
  });

  it('reads it on both of the sections the book prints it under', () => {
    // The imp's and the quasit's are Actions; every other printing is a Bonus
    // Action. A heading says what a line costs and not what it says.
    expect(find('imp').actions.some((line) => line.forms !== undefined)).toBe(true);
    expect(find('werewolf').bonusActions.some((line) => line.forms !== undefined)).toBe(true);
  });

  it('reads every Shape-Shift line the bestiary prints but the vampire’s', () => {
    const printed = bestiary.flatMap((block) =>
      [...block.actions, ...block.bonusActions].filter((line) => line.name === 'Shape-Shift'),
    );
    expect(printed.length).toBe(13);
    expect(printed.filter((line) => line.forms === undefined).length).toBe(1);
  });
});

/**
 * The qualification a heading prints, read off the **name**.
 *
 * SRD Werewolf: "Bite (Wolf or Hybrid Form Only)", "Longbow (Humanoid or
 * Hybrid Form Only)". The clause is printed inside the heading rather than in
 * the sentence, and a name is exactly what nothing downstream may branch on —
 * so it is read here, once, into the same lowercase words the line's own
 * Shape-Shift prints its forms under.
 */
describe('a heading that names the forms its line may be used in', () => {
  it('reads one form and a menu of two', () => {
    expect(lineOf('mimic', 'Adhesive (Object Form Only)').onlyInForms).toEqual(['object']);
    expect(lineOf('werewolf', 'Bite (Wolf or Hybrid Form Only)').onlyInForms).toEqual([
      'wolf',
      'hybrid',
    ]);
    expect(lineOf('werewolf', 'Longbow (Humanoid or Hybrid Form Only)').onlyInForms).toEqual([
      'humanoid',
      'hybrid',
    ]);
  });

  it('reads it on a Bonus Action as readily as on an attack', () => {
    // SRD Weretiger, Prowl: Hide as a Bonus Action, in two of its three forms.
    expect(lineOf('weretiger', 'Prowl (Tiger or Hybrid Form Only)').onlyInForms).toEqual([
      'tiger',
      'hybrid',
    ]);
  });

  it('leaves a heading with no such clause alone', () => {
    expect(lineOf('werewolf', 'Scratch').onlyInForms).toBeUndefined();
    expect(lineOf('werewolf', 'Multiattack').onlyInForms).toBeUndefined();
  });

  it('names a form the line’s own Shape-Shift prints, on every block that gates one', () => {
    for (const block of bestiary) {
      const forms = [...block.actions, ...block.bonusActions]
        .flatMap((line) => line.forms?.forms ?? [])
        .map((form) => form.name);
      if (forms.length === 0) continue;
      const gated = [...block.traits, ...block.actions, ...block.bonusActions].flatMap(
        (line) => line.onlyInForms ?? [],
      );
      expect(gated.filter((name) => !forms.includes(name)), block.id).toEqual([]);
    }
  });
});

/**
 * The moves a line makes — W7-B9.
 *
 * Fourteen bestiary lines at CR ≤ 5 whose sentence is a **move**: a jump into
 * other creatures' spaces with a save per creature, a charge through them, a
 * jump bought with a Bonus Action, a dash that provokes nothing, a teleport
 * between trees, a drag that costs no extra, a straight run at an enemy. Each
 * reader is anchored end to end like every other in this parser.
 */
describe('a save a move precedes', () => {
  it('reads the bulette’s Deadly Leap: a jump into occupied spaces, then a save per creature', () => {
    const save = lineOf('bulette', 'Deadly Leap').save;
    expect(save).toBeDefined();
    expect(save!.movesThen).toEqual({
      kind: 'jump-to',
      within: 15,
      feetSpent: 5,
      intoOccupiedBy: 'large',
    });
    expect(save!.ability).toBe('dex');
    expect(save!.dc).toBe(15);
    expect(save!.targets).toBe("each creature in the bulette's destination space");
    expect(save!.damage).toEqual({ dice: '3d12', flat: 0, type: 'bludgeoning', average: 19 });
    expect(save!.onSuccess).toBe('half');
    expect(save!.onFailure).toEqual([{ kind: 'condition', condition: 'prone' }]);
    expect(save!.onSuccessEffects).toEqual([{ kind: 'push', feet: 5 }]);
    expect(save!.handedOver).toBeUndefined();
  });

  it('reads the centaur’s Trampling Charge: a move through Medium spaces, then a save per creature entered', () => {
    const save = lineOf('centaur-trooper', 'Trampling Charge (Recharge 5–6)').save;
    expect(save).toBeDefined();
    expect(save!.movesThen).toEqual({
      kind: 'move-through',
      upToSpeed: true,
      noOpportunityAttacks: true,
      throughSpacesOf: 'medium',
    });
    expect(save!.ability).toBe('str');
    expect(save!.dc).toBe(14);
    // The template prints no targeting clause; the prelude's is the one it means.
    expect(save!.targets).toBe('each creature whose space the centaur enters');
    expect(save!.damage).toEqual({ dice: '1d6', flat: 4, type: 'bludgeoning', average: 7 });
    expect(save!.onFailure).toEqual([{ kind: 'condition', condition: 'prone' }]);
    expect(save!.onSuccess).toBe('none');
    expect(save!.handedOver).toBeUndefined();
  });

  it('leaves a save with no move in front of it without the field', () => {
    expect(lineOf('gorgon', 'Trample').save?.movesThen).toBeUndefined();
  });

  it('still refuses a template with no targeting clause and no prelude to supply one', () => {
    expect(
      parseSaveLine('_Strength Saving Throw:_ DC 14. _Failure:_ 7 (1d6 + 4) Bludgeoning damage.'),
    ).toBeNull();
  });
});

describe('a jump a line buys', () => {
  it('reads "jumps up to 30 feet by spending 10 feet of movement" on all three Leaps', () => {
    for (const id of ['bulette', 'half-dragon', 'lamia']) {
      expect(lineOf(id, 'Leap').jumps, id).toEqual({ feet: 30, costsMovement: 10 });
    }
  });

  it('refuses a sentence with anything else in it', () => {
    expect(
      parseJumpLine('The lamia jumps up to 30 feet by spending 10 feet of movement, landing Prone.'),
    ).toBeNull();
    expect(parseJumpLine('The bulette leaps up to 30 feet.')).toBeNull();
  });
});

describe('a dash a line grants', () => {
  it('reads the seahorses’ Bubble Dash, half and whole of a Swim Speed, with the water handed over', () => {
    expect(lineOf('giant-seahorse', 'Bubble Dash').dashes).toEqual({
      fraction: 'half',
      modes: ['swim'],
      noOpportunityAttacks: true,
      handedOver: ['While underwater'],
    });
    expect(lineOf('seahorse', 'Bubble Dash').dashes).toEqual({
      fraction: 'whole',
      modes: ['swim'],
      noOpportunityAttacks: true,
      handedOver: ['While underwater'],
    });
  });

  it('reads the weretiger’s Prowl with the Hide at the end of it', () => {
    expect(lineOf('weretiger', 'Prowl (Tiger or Hybrid Form Only)').dashes).toEqual({
      fraction: 'whole',
      modes: ['walk'],
      noOpportunityAttacks: true,
      thenHide: true,
      handedOver: [],
    });
  });

  it('reads the three Charges as a move that provokes, with the direction handed over', () => {
    expect(lineOf('troll', 'Charge').dashes).toEqual({
      fraction: 'half',
      modes: ['walk'],
      noOpportunityAttacks: false,
      handedOver: ['straight toward an enemy it can see'],
    });
    expect(lineOf('sahuagin-warrior', 'Aquatic Charge').dashes).toEqual({
      fraction: 'whole',
      modes: ['swim'],
      noOpportunityAttacks: false,
      handedOver: ['straight toward an enemy it can see'],
    });
    expect(lineOf('xorn', 'Charge').dashes).toEqual({
      fraction: 'whole',
      modes: ['walk', 'burrow'],
      noOpportunityAttacks: false,
      handedOver: ['straight toward an enemy it can sense'],
    });
  });

  it('refuses a move whose sentence says something more', () => {
    // SRD Unicorn's Charging Horn adds an attack; it is a legendary line and stays that.
    expect(
      parseDashLine(
        'The unicorn moves up to half its Speed without provoking Opportunity Attacks, and it makes one Radiant Horn attack.',
      ),
    ).toBeNull();
    expect(parseDashLine('The troll moves up to half its Speed.')).toBeNull();
  });
});

describe('a teleport between two trees', () => {
  it('reads the dryad’s Tree Stride', () => {
    expect(lineOf('dryad', 'Tree Stride').treeStride).toEqual({
      fromWithin: 5,
      toWithin: 5,
      treesWithin: 60,
      treeSize: 'large',
    });
    expect(lineOf('dryad', 'Tree Stride').teleports).toBeUndefined();
  });

  it('refuses the sentence with a clause changed', () => {
    expect(
      parseTreeStrideLine(
        'If within 5 feet of a Large or bigger tree, the dryad teleports to an unoccupied space within 5 feet of a second Large or bigger tree.',
      ),
    ).toBeNull();
  });
});

describe('two traits about moving', () => {
  it('reads the cat’s Jumper as a jump measured by Dexterity', () => {
    expect(lineOf('cat', 'Jumper').trait).toEqual({ kind: 'jumps-by-dexterity' });
  });

  it('reads the bugbears’ Abduct as a drag that costs no extra', () => {
    expect(lineOf('bugbear-stalker', 'Abduct').trait).toEqual({ kind: 'drags-for-free' });
    expect(lineOf('bugbear-warrior', 'Abduct').trait).toEqual({ kind: 'drags-for-free' });
  });
});
