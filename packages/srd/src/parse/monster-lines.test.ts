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
  parseTouchLine,
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
    ).toEqual({ spells: ['sleep'], ability: 'cha', saveDc: 10, waives: ['material', 'somatic', 'verbal'] });
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
    ).toEqual({
      spells: ['bless', 'lesser-restoration', 'sanctuary'],
      ability: 'spellcasting',
      waives: ['material', 'somatic', 'verbal'],
    });
  });

  it('refuses a line whose sentence says more than it casts', () => {
    // SRD Vampire's Beguile: a second sentence about a second rule.
    expect(
      parseCastLine(
        "The vampire casts _Command_, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 17). The vampire can't take this action again until the start of its next turn.",
      ),
    ).toBeNull();
    // **SRD Succubus's Charm left this list by being read** (M-MIND): its
    // spell is printed without italics, which is typesetting, and a bare name
    // is read only where it is the whole menu and the SRD's own index holds
    // it. What stays refused is a bare word the index does not know.
    expect(
      parseCastLine(
        'The succubus casts Domination Most Foul (level 8 version), requiring no spell components and using Charisma as the spellcasting ability (spell save DC 15).',
      ),
    ).toBeNull();
    // A level printed over a menu of two: which of them is cast at it is a
    // sentence the book never wrote, so the line stays prose.
    expect(
      parseCastLine(
        'The priest casts _Bless_ or _Cure Wounds_ (level 2 version), using the same spellcasting ability as Spellcasting.',
      ),
    ).toBeNull();
    // A duration sentence with one more sentence after it — SRD Vampire's
    // Charm, whose Bite and ending are a second and third rule.
    expect(
      parseCastLine(
        "The vampire casts _Charm Person_, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 17). The spell's duration is 24 hours. The Charmed target is a willing recipient of the vampire's Bite.",
      ),
    ).toBeNull();
    // SRD Pit Fiend's Hellfire Spellcasting: one spell cast twice, replaceable.
    expect(
      parseCastLine(
        'The pit fiend casts _Fireball_ (level 5 version) twice, requiring no Material components and using Charisma as the spellcasting ability (spell save DC 21). It can replace one _Fireball_ with _Hold Monster_ (level 7 version) or _Wall of Fire_.',
      ),
    ).toBeNull();
    // **SRD Unicorn's Blessing left this list by being read** (W7-B11): the
    // touch is consumed, because both spells print a Range of Touch already,
    // and "on that creature" is the `notSelf` flag. What stays refused is the
    // dangling form of it — the clause with nothing to refer back to.
    expect(
      parseCastLine(
        'The lich casts _Cure Wounds_ on that creature, using the same spellcasting ability as Spellcasting.',
      ),
    ).toBeNull();
    // A name the SRD's own spell index does not hold.
    expect(
      parseCastLine(
        'The cultist casts the _Hex of the Nine_ spell, using the same spellcasting ability as Spellcasting.',
      ),
    ).toBeNull();
  });

  /**
   * SRD Succubus's Charm: "The succubus casts Dominate Person **(level 8
   * version)**, requiring no spell components …". SRD Sea Hag's Illusory
   * Appearance: "The hag casts _Disguise Self_, using Constitution as the
   * spellcasting ability (spell save DC 13). **The spell's duration is 24
   * hours.**" — M-MIND.
   *
   * Two clauses a cast line prints about **this** casting of the spell and not
   * about the spell: the level it is cast at, which a slot would otherwise
   * say, and a span over the one the spell prints. Each is a field, and the
   * casting pipeline reads both.
   */
  it('reads the level a line casts at and the duration it prints over the spell’s', () => {
    expect(
      parseCastLine(
        'The succubus casts Dominate Person (level 8 version), requiring no spell components and using Charisma as the spellcasting ability (spell save DC 15).',
      ),
    ).toEqual({
      spells: ['dominate-person'],
      ability: 'cha',
      saveDc: 15,
      castLevel: 8,
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(
      parseCastLine(
        "The hag casts _Disguise Self_, using Constitution as the spellcasting ability (spell save DC 13). The spell's duration is 24 hours.",
      ),
    ).toEqual({ spells: ['disguise-self'], ability: 'con', saveDc: 13, durationSeconds: 86400 });
    expect(lineOf('succubus', 'Charm').casts).toEqual({
      spells: ['dominate-person'],
      ability: 'cha',
      saveDc: 15,
      castLevel: 8,
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('sea-hag', 'Illusory Appearance').casts).toEqual({
      spells: ['disguise-self'],
      ability: 'con',
      saveDc: 13,
      durationSeconds: 86400,
    });
    // The same sentence on a block above level-5 reach is the same sentence:
    // SRD Ice Devil's Ice Wall is read by the same grammar.
    expect(lineOf('ice-devil', 'Ice Wall (Recharge 6)').casts).toEqual({
      spells: ['wall-of-ice'],
      ability: 'int',
      saveDc: 17,
      castLevel: 8,
      waives: ['material', 'somatic', 'verbal'],
    });
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
      waives: ['material', 'somatic', 'verbal'],
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
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('cultist-fanatic', 'Spiritual Weapon (2/Day)').casts).toEqual({
      spells: ['spiritual-weapon'],
      ability: 'spellcasting',
    });
    expect(lineOf('dust-mephit', 'Sleep (1/Day)').casts).toEqual({
      spells: ['sleep'],
      ability: 'cha',
      saveDc: 10,
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('ice-mephit', 'Fog Cloud (1/Day)').casts).toEqual({
      spells: ['fog-cloud'],
      ability: 'cha',
      waives: ['material', 'somatic', 'verbal'],
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
      waives: ['material'],
    });
    expect(lineOf('stone-golem', 'Slow (Recharge 5–6)').casts).toEqual({
      spells: ['slow'],
      ability: 'con',
      saveDc: 17,
      waives: ['material', 'somatic', 'verbal'],
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
    ).toEqual({ spells: ['invisibility'], ability: 'cha', selfOnly: true, waives: ['material', 'somatic', 'verbal'] });
    expect(
      parseCastLine(
        'The oni casts _Invisibility_ on itself, requiring no spell components and using the same spellcasting ability as Spellcasting.',
      ),
    ).toEqual({
      spells: ['invisibility'],
      ability: 'spellcasting',
      selfOnly: true,
      waives: ['material', 'somatic', 'verbal'],
    });
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
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('quasit', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'cha',
      selfOnly: true,
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('sprite', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'cha',
      selfOnly: true,
      waives: ['material', 'somatic', 'verbal'],
    });
    expect(lineOf('oni', 'Invisibility').casts).toEqual({
      spells: ['invisibility'],
      ability: 'spellcasting',
      selfOnly: true,
      waives: ['material', 'somatic', 'verbal'],
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

/**
 * "Requiring no spell components", read rather than dropped (E-L1).
 *
 * SRD Counterspell is a Reaction taken "when you see a creature within 60
 * feet of yourself casting a spell with Verbal, Somatic, or Material
 * components", and SRD Slow's failure reads a Somatic component — so what a
 * casting does without is a fact two rules read, and the parser carries it as
 * the components the line waives. Three wordings in the book, one field.
 */
describe('the components a line does without', () => {
  it('reads "no spell components" as all three', () => {
    expect(
      parseCastLine(
        'The mephit casts the _Sleep_ spell, requiring no spell components and using Charisma as the spellcasting ability (spell save DC 10).',
      ),
    ).toEqual({
      spells: ['sleep'],
      ability: 'cha',
      saveDc: 10,
      waives: ['material', 'somatic', 'verbal'],
    });
  });

  it('reads a line that names the ones it waives', () => {
    expect(
      parseCastLine(
        'The imp casts _Invisibility_ on itself, requiring no Somatic or Material components and using Charisma as the spell-casting ability.',
      )?.waives,
    ).toEqual(['material', 'somatic']);
    expect(
      parseCastLine(
        'While within 30 feet of at least two hag allies, the hag can cast one of the following spells, requiring no Material components, using the spell’s normal casting time, and using Intelligence as the spellcasting ability (spell save DC 11): _Augury_, _Find Familiar_, _Identify_, _Locate Object_, _Scrying_, or _Unseen Servant_. The hag must finish a Long Rest before using this trait to cast that spell again.',
      )?.waives,
    ).toEqual(['material']);
  });

  it('carries nothing for a line that prints no such clause', () => {
    expect(
      parseCastLine(
        'The priest casts _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_ using the same spellcasting ability as Spellcasting.',
      ),
    ).not.toHaveProperty('waives');
  });

  it('refuses a clause naming something that is not a component', () => {
    expect(
      parseCastLine(
        'The mephit casts the _Sleep_ spell, requiring no costly components and using Charisma as the spellcasting ability (spell save DC 10).',
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
      // W7-B12: the three hags' Coven Magic, a trait whose price is a Long
      // Rest per spell and whose gate is two allies within thirty feet.
      'green-hag/Coven Magic',
      // M-MIND: a cast line's level, read where it prints one — the Succubus's
      // Charm and, by the same grammar, the Ice Devil's wall.
      'ice-devil/Ice Wall (Recharge 6)',
      'ice-mephit/Fog Cloud (1/Day)',
      'imp/Invisibility',
      'mage/Misty Step (3/Day)',
      'night-hag/Coven Magic',
      'oni/Invisibility',
      'planetar/Divine Aid (2/Day)',
      'priest-acolyte/Divine Aid (1/Day)',
      'priest/Divine Aid (3/Day)',
      'quasit/Invisibility',
      'sea-hag/Coven Magic',
      // M-MIND: Disguise Self with the span the line prints over the spell's.
      'sea-hag/Illusory Appearance',
      'sprite/Invisibility',
      'stone-golem/Slow (Recharge 5–6)',
      'succubus/Charm',
      // W7-B11: the menu of two, the ability borrowed off the block's own
      // Spellcasting line, and the target the touch clause fixes to somebody
      // other than the caster.
      "unicorn/Unicorn's Blessing (3/Day)",
    ]);

    // Asserted over the corpus rather than assumed, which is how every other
    // claim about "no SRD line does X" in this parser is held down. Every cast
    // line is a heading a creature spends, or a trait whose price is a rest
    // per spell (the hags' Coven Magic): none of them declares a spell list
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

  it('reads the ettercap’s, whose hold is a web its own line spun — W7-B10', () => {
    expect(lineOf('ettercap', 'Reel').pulls).toEqual({
      feet: 25,
      of: 'restrained-by-object',
      within: 30,
      heldBy: 'Web Strand',
    });
  });

  it('refuses a sentence that moves any of its clauses', () => {
    const printed = 'The roper pulls each creature Grappled by it up to 30 feet straight toward it.';
    expect(parsePullLine(printed)).toEqual({ feet: 30, of: 'grappled' });
    expect(parsePullLine(printed.replace('Grappled by it', 'Restrained by it'))).toBeNull();
    expect(parsePullLine(printed.replace('each creature', 'one creature'))).toBeNull();
    expect(parsePullLine(printed.replace(' straight toward it', ''))).toBeNull();
    const webbed =
      'The ettercap pulls one creature within 30 feet of itself that is Restrained by its Web Strand up to 25 feet straight toward itself.';
    expect(parsePullLine(webbed.replace('Restrained', 'Grappled'))).toBeNull();
    expect(parsePullLine(webbed.replace('one creature', 'each creature'))).toBeNull();
  });

  it('is printed on two lines in the bestiary, one over each hold', () => {
    const printed = bestiary.flatMap((block) =>
      [...block.actions, ...block.bonusActions].filter((line) => line.pulls !== undefined),
    );
    expect(printed.map((line) => line.pulls!.of).sort()).toEqual(['grappled', 'restrained-by-object']);
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

/**
 * A save whose failure puts the target **inside** the creature that forced it,
 * and the holds around it — W7-B10.
 *
 * SRD Gelatinous Cube's Engulf is a walk through other creatures' spaces and
 * then a save per creature entered, whose failure engulfs; SRD Shambling
 * Mound's is a grapple that pulls the target into the mound's space. The
 * Ooze Cube trait says what the cube holds and how a neighbour pulls somebody
 * out, and SRD Water Elemental's Whelm prints the same two sentences on the
 * line itself.
 */
describe('a save whose failure puts the target inside', () => {
  it("reads the Gelatinous Cube's Engulf: the move first, the engulf and what it hangs, the escape, and a success that steps clear", () => {
    const engulf = lineOf('gelatinous-cube', 'Engulf').save;
    // The prelude: a walk through the spaces of Large or smaller creatures,
    // gated on the room the cube has inside itself.
    expect(engulf?.movesThen).toEqual({
      kind: 'move-through',
      upToSpeed: true,
      noOpportunityAttacks: true,
      throughSpacesOf: 'large',
      ifRoomInside: true,
    });
    expect(engulf?.ability).toBe('dex');
    expect(engulf?.dc).toBe(12);
    expect(engulf?.targets).toBe(
      'each creature whose space the cube enters for the first time during this move',
    );
    expect(engulf?.damage).toEqual({ dice: '3d6', flat: 0, type: 'acid', average: 10 });
    expect(engulf?.onSuccess).toBe('half');
    expect(engulf?.onFailure).toEqual([
      {
        kind: 'engulfs',
        whileInside: ['restrained'],
        noVerbalCasting: true,
        // M-HOLD: "An engulfed target is suffocating" — the glossary's hazard.
        suffocates: 'always',
        payout: {
          damage: { dice: '3d6', flat: 0, type: 'acid', average: 10 },
          at: 'start',
          // "each of **the cube's** turns" — the host's boundary.
          onTurnOf: 'source',
        },
        escape: { ability: 'str', skill: 'athletics', dc: 12 },
      },
    ]);
    // "Half damage, and the target moves to an unoccupied space within 5 feet
    // of the cube. If there is no unoccupied space, the target fails the save
    // instead."
    expect(engulf?.onSuccessEffects).toEqual([{ kind: 'steps-clear', within: 5, otherwiseFails: true }]);
    // The suffocation was the one clause left, and it is read (M-HOLD).
    expect(engulf?.handedOver).toBeUndefined();
  });

  it("reads the Shambling Mound's Engulf: a grapple that pulls the target into its space, its two conditions, its payout and its cap", () => {
    const engulf = lineOf('shambling-mound', 'Engulf').save;
    expect(engulf?.ability).toBe('str');
    expect(engulf?.dc).toBe(15);
    expect(engulf?.damage).toBeUndefined();
    expect(engulf?.onSuccess).toBe('none');
    expect(engulf?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'grappled',
        escapeDc: 14,
        // "pulled into the shambling mound's space"
        inside: true,
        implies: ['blinded', 'restrained'],
        payout: {
          damage: { dice: '3d6', flat: 0, type: 'lightning', average: 10 },
          at: 'start',
          // "each of **its** turns" — the target's own boundary.
          onTurnOf: 'target',
        },
        // "can have only one creature Grappled by this action at a time"
        capacity: { creatures: 1 },
      },
    ]);
    // "When the shambling mound moves, the Grappled target moves with it,
    // costing it no extra movement" is the rule the second place already
    // keeps — a creature inside another moves with it and costs the mover no
    // drag — so it is read and consumed rather than carried.
    expect(engulf?.handedOver).toBeUndefined();
  });

  it("reads the Ooze Cube trait: what the cube holds inside itself, and the neighbour's pull at a price", () => {
    expect(lineOf('gelatinous-cube', 'Ooze Cube').trait).toEqual({
      kind: 'holds-creatures-inside',
      capacity: { large: 1, mediumOrSmaller: 4 },
      pullOutBy: {
        within: 5,
        ability: 'str',
        skill: 'athletics',
        dc: 12,
        damage: { dice: '3d6', flat: 0, type: 'acid', average: 10 },
      },
      // "a creature that does so is subjected to the cube's Engulf and has
      // Disadvantage on the saving throw" — the line's own heading, and a
      // fact reported rather than enforced: nothing in this engine lets a
      // creature willingly end a move in another's space.
      entrantsSubjectedTo: { line: 'Engulf', disadvantage: true },
    });
  });

  it("reads the Water Elemental's Whelm to the end: the cap on what it holds and the neighbour's pull", () => {
    const whelm = lineOf('water-elemental', 'Whelm (Recharge 4–6)').save;
    expect(whelm?.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'grappled',
        escapeDc: 14,
        ifNoLargerThan: 'large',
        implies: ['restrained'],
        payout: {
          damage: { dice: '2d8', flat: 0, type: 'bludgeoning', average: 9 },
          at: 'start',
          onTurnOf: 'source',
        },
        capacity: { large: 1, mediumOrSmaller: 2 },
        pullOutBy: { within: 5, ability: 'str', skill: 'athletics', dc: 14 },
        // M-HOLD: the suffocation was the one clause left, and it is read.
        suffocates: 'unless-it-breathes-water',
      },
    ]);
    expect(whelm?.handedOver).toBeUndefined();
  });
});

/**
 * **The honesty pass** — W7-B13.
 *
 * CR ≤ 5 lines the ledger could not tell from debts, because the parser either
 * refused them whole or carried their sentences in the residue (`handedOver`)
 * the ledger counts as owed. Two kinds among them: the **compulsions**, which
 * the owner ruled on 2026-09-24 are legality the table adjudicates and so
 * handovers; and **fiction** no rule reads afterwards. Both are filed in
 * `forTheTable` — a field apart from the residue, carrying the kind the ledger
 * counts in its handed-over column — and never in `handedOver`, which on all
 * three halves of the sheet is the owed residue.
 *
 * What these assert is the reading: what is read, what is filed and under
 * which kind, and what stays the residue it honestly is.
 */
describe('the honesty pass: compulsions and fiction filed apart from the residue — W7-B13', () => {
  const compulsion = 'a-compulsion-the-table-plays' as const;

  it("reads the ghost's Possession: the save and the day's grace are the engine's, the body is the table's", () => {
    const save = lineOf('ghost', 'Possession (Recharge 6)').save;
    expect(save).toMatchObject({
      ability: 'cha',
      dc: 13,
      targets: 'one Humanoid the ghost can see within 5 feet',
      // "one Humanoid … within 5 feet": the reach and the type are facts the
      // engine measures; the sight is flagged so the door can say it is not.
      reach: { feet: 5, count: 1, seen: true },
      onlyIfTargetType: ['Humanoid'],
      onSuccess: 'none',
      onSuccessEffects: [{ kind: 'line-immunity', line: 'Possession', seconds: 86400 }],
    });
    // **The possession is the engine's facts now** — M-MIND. Who goes where and
    // what the target has, how long it lasts, and what its ending buys: the
    // ghost inside the body, the Incapacitated for exactly that long, the two
    // endings, the five feet and the day's grace.
    expect(save?.onFailure).toEqual([
      {
        kind: 'possesses',
        condition: 'incapacitated',
        endsAtZeroHitPoints: true,
        leavesAs: 'bonus-action',
        appearsWithin: 5,
        immunity: { line: 'Possession', seconds: 86400 },
      },
    ]);
    // What the possessor does with the body is filed as the compulsion it is.
    expect(save?.forTheTable).toEqual([
      {
        kind: compulsion,
        on: 'failure',
        sentence: 'The ghost now controls the body, but the target retains awareness.',
      },
      {
        kind: compulsion,
        on: 'failure',
        sentence:
          "The ghost's game statistics are the same, except it uses the possessed target's Speed, as well as the target's Strength, Dexterity, and Constitution modifiers.",
      },
    ]);
    // **And one sentence is owed.** The engine executes "can't be targeted" —
    // a possessor inside its host is reached by nothing — and the exception,
    // "except ones that specifically target Undead", is a rule SRD Turn Undead
    // reads and cannot reach a ghost with no position. A debt, not fiction.
    expect(save?.handedOver).toEqual([
      "The ghost can't be targeted by any attack, spell, or other effect, except ones that specifically target Undead.",
    ]);
  });

  it("reads the harpy's Luring Song: the Charm and its repeat are the engine's, the walk is the table's", () => {
    const save = lineOf('harpy', 'Luring Song').save;
    expect(save).toMatchObject({
      ability: 'wis',
      dc: 11,
      targets:
        'each Humanoid and Giant in a 300-foot Emanation originating from the harpy when the song starts',
      onlyIfTargetType: ['Humanoid', 'Giant'],
      onSuccess: 'none',
      onSuccessEffects: [{ kind: 'line-immunity', line: 'Luring Song', seconds: 86400 }],
      onFailure: [
        {
          kind: 'condition',
          condition: 'charmed',
          repeats: { at: 'end', of: 'target' },
          implies: ['incapacitated'],
        },
      ],
    });
    expect(save?.forTheTable).toEqual([
      {
        kind: compulsion,
        on: 'failure',
        sentence:
          'If the target is more than 5 feet from the harpy, the target moves on its turn toward the harpy by the most direct route, trying to get within 5 feet of the harpy.',
      },
      { kind: compulsion, on: 'failure', sentence: "It doesn't avoid Opportunity Attacks." },
    ]);
    // What stays owed: the song's Concentration (which only a casting may hold
    // here), the other harpies' songs, and the two repeats a move into lava and
    // a blow from somebody else raise.
    expect(save?.handedOver).toEqual([
      "The harpy sings a magical melody, which lasts until the harpy's Concentration ends on it.",
      'The Charmed condition, until the song ends.',
      'While Charmed, the target ignores the Luring Song of other harpies.',
      'before moving into damaging terrain (such as lava or a pit) and whenever it takes damage from a source other than the harpy, the target repeats the save.',
    ]);
  });

  it("reads the mouther's Gibbering: the d8 is the engine's, and the table's rows are filed with their faces", () => {
    const save = lineOf('gibbering-mouther', 'Gibbering').save;
    expect(save?.onFailure).toEqual([{ kind: 'rolls-a-table', dice: '1d8' }]);
    expect(save?.forTheTable).toEqual([
      {
        kind: compulsion,
        on: 'failure',
        faces: { from: 1, to: 4 },
        sentence: 'The target does nothing.',
      },
      {
        kind: compulsion,
        on: 'failure',
        faces: { from: 5, to: 6 },
        sentence:
          'The target takes no action or Bonus Action and uses all its movement to move in a random direction.',
      },
      {
        kind: compulsion,
        on: 'failure',
        faces: { from: 7, to: 8 },
        sentence:
          "The target makes a melee attack against a randomly determined creature within its reach or does nothing if it can't make such an attack.",
      },
    ]);
    expect(save?.handedOver).toBeUndefined();
  });

  it("reads the flesh golem's Berserk: the d6 at a Bloodied turn's start, and every sentence after it filed", () => {
    expect(lineOf('flesh-golem', 'Berserk').trait).toEqual({
      kind: 'rolls-to-go-berserk',
      dice: '1d6',
      on: 6,
      whileBloodied: true,
      forTheTable: [
        {
          kind: compulsion,
          faces: { from: 6, to: 6 },
          sentence:
            'On each of its turns while berserk, the golem attacks the nearest creature it can see. If no creature is near enough to move to and attack, the golem attacks an object. Once the golem goes berserk, it remains so until it is destroyed or it is no longer Bloodied.',
        },
        {
          kind: compulsion,
          faces: { from: 6, to: 6 },
          sentence:
            "The golem's creator, if within 60 feet of the berserk golem, can try to calm it by taking an action to make a DC 15 Charisma (Persuasion) check; the golem must be able to hear its creator. If this check succeeds, the golem ceases being berserk until the start of its next turn, at which point it resumes rolling for the Berserk trait again if it is still Bloodied.",
        },
      ],
    });
  });

  it("reads the clay golem's Berserk too, which prints no creator to calm it", () => {
    const trait = lineOf('clay-golem', 'Berserk').trait as {
      readonly kind: string;
      readonly forTheTable?: readonly { readonly sentence: string }[];
    };
    expect(trait.kind).toBe('rolls-to-go-berserk');
    expect(trait.forTheTable?.map((one) => one.sentence)).toEqual([
      'On each of its turns while berserk, the golem attacks the nearest creature it can see. If no creature is near enough to move to and attack, the golem attacks an object. Once the golem goes berserk, it continues to be berserk until it is destroyed or it is no longer Bloodied.',
    ]);
  });

  it.each([
    ['werebear', 'Bite (Bear or Hybrid Form Only)', 14, 'Werebear'],
    ['wereboar', 'Gore (Boar or Hybrid Form Only)', 12, 'Wereboar'],
    ['wererat', 'Bite (Rat or Hybrid Form Only)', 11, 'Wererat'],
    ['weretiger', 'Bite (Tiger or Hybrid Form Only)', 13, 'Weretiger'],
    ['werewolf', 'Bite (Wolf or Hybrid Form Only)', 12, 'Werewolf'],
  ] as const)(
    "reads the %s's curse: a save a Humanoid makes, a curse on the record, a day's grace",
    (id, heading, dc, block) => {
      const attack = lineOf(id, heading).attack;
      // The rider is the book's own save template, so it is lifted out of the
      // rider entirely — nothing is left for the swing to hand over.
      expect(attack?.rider).toBeNull();
      expect(attack?.riderSave).toEqual({
        ability: 'con',
        dc,
        targets: 'a Humanoid',
        onlyIfTargetType: ['Humanoid'],
        onSuccess: 'none',
        onSuccessEffects: [{ kind: 'curse-immunity', seconds: 86400 }],
        onFailure: [{ kind: 'curse' }],
        forTheTable: [
          {
            kind: compulsion,
            on: 'failure',
            sentence: `If the cursed target drops to 0 Hit Points, it instead becomes a **${block}** under the GM's control and has 10 Hit Points.`,
          },
        ],
      });
    },
  );

  it("files the basilisk's reflection and the mephit's water, and leaves both saves otherwise as they were", () => {
    const gaze = lineOf('basilisk', 'Petrifying Gaze (Recharge 4–6)').save;
    expect(gaze?.handedOver).toBeUndefined();
    expect(gaze?.onFailure).toHaveLength(1);
    expect(gaze?.forTheTable).toEqual([
      {
        kind: 'a-reflection-nothing-holds',
        sentence: 'If the basilisk sees its reflection in the Cone, the basilisk must make this save.',
      },
    ]);
    const steam = lineOf('steam-mephit', 'Steam Breath (Recharge 6)').save;
    expect(steam?.handedOver).toBeUndefined();
    expect(steam?.onFailure).toHaveLength(1);
    expect(steam?.forTheTable).toEqual([
      {
        kind: 'water-nothing-holds',
        sentence: "Being underwater doesn't grant Resistance to this Fire damage.",
      },
    ]);
  });

  it("files the wight's zombie and its cap of twelve, and reads the reach Life Drain names", () => {
    const save = lineOf('wight', 'Life Drain').save;
    expect(save?.handedOver).toBeUndefined();
    expect(save?.reach).toEqual({ feet: 5, count: 1 });
    expect(save?.onFailure).toEqual([{ kind: 'hit-point-maximum-decrease', by: 'damage-taken' }]);
    expect(save?.forTheTable).toEqual([
      {
        kind: 'a-corpse-that-rises-later',
        on: 'failure',
        sentence:
          "A Humanoid slain by this attack rises 24 hours later as a **Zombie** under the wight's control, unless the Humanoid is restored to life or its body is destroyed.",
      },
      {
        kind: 'a-corpse-that-rises-later',
        on: 'failure',
        sentence: 'The wight can have no more than twelve zombies under its control at a time.',
      },
    ]);
  });

  it('files a returning spear, a Shadow that rises and a body absorbed off the rider, and leaves the rest to be read', () => {
    const salamander = lineOf('salamander', 'Flame Spear').attack;
    expect(salamander?.rider).toBeNull();
    expect(salamander?.forTheTable).toEqual([
      {
        kind: 'a-weapon-that-returns-to-the-hand',
        sentence:
          "_Hit or Miss:_ The spear magically returns to the salamander's hand immediately after a ranged attack.",
      },
    ]);
    const merfolk = lineOf('merfolk-skirmisher', 'Ocean Spear').attack;
    expect(merfolk?.rider).toBe(
      'If the target is a creature, its Speed decreases by 10 feet until the end of its next turn.',
    );
    expect(merfolk?.forTheTable).toEqual([
      {
        kind: 'a-weapon-that-returns-to-the-hand',
        sentence:
          "_Hit or Miss:_ The spear magically returns to the merfolk's hand immediately after a ranged attack.",
      },
    ]);
    const shadow = lineOf('shadow', 'Draining Swipe').attack;
    expect(shadow?.rider).toBe(
      "and the target's Strength score decreases by 1d4. The target dies if this reduces that score to 0.",
    );
    expect(shadow?.forTheTable).toEqual([
      {
        kind: 'a-corpse-that-rises-later',
        sentence: 'If a Humanoid is slain by this attack, a **Shadow** rises from the corpse 1d4 hours later.',
      },
    ]);
    const mouther = lineOf('gibbering-mouther', 'Bite').attack;
    expect(mouther?.rider).toBe(
      'If the target is a Medium or smaller creature, it has the Prone condition. The target dies if it is reduced to 0 Hit Points by this attack.',
    );
    expect(mouther?.forTheTable).toEqual([
      {
        kind: 'a-body-absorbed',
        sentence: 'Its body is then absorbed into the mouther, leaving only equipment behind.',
      },
    ]);
  });

  it("files the swarms' two space clauses as the world-family kinds, and keeps the healing sentence the engine spends", () => {
    const swarms = [
      'swarm-of-crawling-claws',
      'swarm-of-bats',
      'swarm-of-insects',
      'swarm-of-piranhas',
      'swarm-of-rats',
      'swarm-of-ravens',
      'swarm-of-venomous-snakes',
    ];
    for (const id of swarms) {
      const trait = lineOf(id, 'Swarm').trait as {
        readonly kind: string;
        readonly handedOver?: unknown;
        readonly forTheTable?: unknown;
      };
      expect(trait.kind, id).toBe('regains-no-hit-points');
      expect(trait.handedOver, id).toBeUndefined();
      expect(trait.forTheTable, id).toEqual([
        {
          kind: 'enters-a-creature-space-and-a-one-inch-gap',
          sentence: "The swarm can occupy another creature's space and vice versa.",
        },
        {
          kind: 'moves-through-a-one-inch-gap',
          sentence: expect.stringMatching(
            /^the swarm can move through any opening large enough for a Tiny [a-z]+\.$/,
          ),
        },
      ]);
    }
  });

  /**
   * **Read, not filed** — M-MATTER. W7-B13 left the line prose because the
   * touch is legality — a reach, a thing that is nonmagical metal, a thing
   * nobody is wearing — and a line filed whole would pass that as fiction.
   * A declared object pins whether it is metal now (E-L1), so the touch is a
   * shape `takePrintedTouch` checks, and the cube is the question it asks.
   */
  it("reads the rust monster's Destroy Metal as a touch on a metal object", () => {
    const line = lineOf('rust-monster', 'Destroy Metal') as Record<string, unknown>;
    expect(line['touchesObject']).toEqual({
      within: 5,
      material: 'metal',
      cubeFeet: 1,
      // Filed for the case the cube is not the whole object: the hole it
      // leaves in a gate is the table's map, and the gate stands.
      forTheTable: [
        { kind: 'a-hole-eaten-through-the-world', sentence: 'The touch destroys a 1-foot Cube of the object.' },
      ],
    });
  });

  it('reads no touch where the sentence names another substance', () => {
    expect(
      parseTouchLine(
        "The rust monster touches a nonmagical wooden object within 5 feet of itself that isn't being worn or carried. The touch destroys a 1-foot Cube of the object.",
      ),
    ).toBeNull();
  });

  it('files only the book’s own words, and never a sentence it also carries as owed', () => {
    let filed = 0;
    for (const block of bestiary) {
      for (const line of [
        ...block.traits,
        ...block.actions,
        ...block.bonusActions,
        ...block.reactions,
      ]) {
        const trait = line.trait as
          | { readonly handedOver?: readonly string[]; readonly forTheTable?: readonly { readonly sentence: string }[] }
          | undefined;
        const residue = [
          ...(line.save?.handedOver ?? []),
          ...(line.attack?.riderSave?.handedOver ?? []),
          ...(trait?.handedOver ?? []),
        ];
        const sentences = [
          ...(line.save?.forTheTable ?? []),
          ...(line.attack?.forTheTable ?? []),
          ...(line.attack?.riderSave?.forTheTable ?? []),
          ...(trait?.forTheTable ?? []),
          ...(line.touchesObject?.forTheTable ?? []),
        ].map((one) => one.sentence);
        const flat = line.text
          .replace(/\s*<br>\s*/g, ' ')
          .replace(/&emsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .toLowerCase();
        for (const sentence of sentences) {
          filed += 1;
          // Every filed sentence is the book's own words, and none is also owed.
          expect(flat, `${block.id}/${line.name}`).toContain(sentence.replace(/\.$/, '').toLowerCase());
          expect(residue, `${block.id}/${line.name}`).not.toContain(sentence);
        }
      }
    }
    expect(filed).toBeGreaterThan(0);
  });
});

/**
 * **Regeneration, forms, coven magic and splits** — W7-B12.
 *
 * Sixteen CR ≤ 5 lines that were prose or a bare kind, each a trait a turn
 * boundary, a rest, a blow or a Reaction reads. Every pattern is anchored end
 * to end like the rest of this parser: a sentence that says one more thing is a
 * different sentence and gets nothing. What each line leaves the table is said
 * beside the reading — owed in `handedOver`, filed in `forTheTable` under a
 * reason somebody argued, or consumed because the engine already holds it.
 */
describe('regeneration, forms, coven magic and splits — W7-B12', () => {
  it("reads the troll's Regeneration: the amount, the types that stop it, and the death that waits", () => {
    expect(lineOf('troll', 'Regeneration').trait).toEqual({
      kind: 'regenerates',
      hitPoints: 15,
      suppressedBy: ['acid', 'fire'],
    });
    expect(lineOf('troll-limb', 'Regeneration').trait).toEqual({
      kind: 'regenerates',
      hitPoints: 5,
      suppressedBy: ['acid', 'fire'],
    });
  });

  it("reads the vampire spawn's Sunlight: the burn at the turn's start beside the Disadvantage", () => {
    expect(lineOf('vampire-spawn', 'Sunlight').trait).toEqual({
      kind: 'disadvantage-in-sunlight',
      rolls: ['ability-check', 'attack-roll'],
      hurtAtTurnStart: { amount: 20, damageType: 'radiant' },
    });
  });

  it("reads the fire elemental's Fire Aura and the burning it lights, objects and all", () => {
    expect(lineOf('fire-elemental', 'Fire Aura').trait).toEqual({
      kind: 'damages-creatures-in-an-emanation',
      moment: 'end',
      feet: 10,
      dice: '1d10',
      damageType: 'fire',
      chosen: false,
      unlessIncapacitated: false,
      // A declared object's substance says whether it takes light (M-MATTER),
      // so the objects half is read with the creatures' and nothing is owed.
      ignites: true,
    });
    // The azer's aura prints no such sentence and lights nobody.
    expect(lineOf('azer-sentinel', 'Fire Aura').trait).not.toHaveProperty('ignites');
  });

  /**
   * M-MATTER: the ammunition sentence is a field the blow reads, and the
   * Mending sentence is consumed — SRD Mending's `repairs` lifts the very
   * `weapon-penalised` record this trait writes, so nothing is owed.
   */
  it("reads the black pudding's Corrosive Form: the acid back, the weapon and the ammunition", () => {
    expect(lineOf('black-pudding', 'Corrosive Form').trait).toEqual({
      kind: 'corrodes-what-hits-it',
      meleeHitterTakes: { dice: '1d8', damageType: 'acid' },
      weaponPenalty: 1,
      weaponDestroyedAt: 5,
      destroysAmmunition: true,
      forTheTable: [
        {
          kind: 'a-hole-eaten-through-the-world',
          sentence: 'In 1 minute, the pudding can eat through 2 feet of nonmagical wood or metal.',
        },
      ],
    });
  });

  it("reads the gray ooze's Corrosive Form, which burns nobody back", () => {
    expect(lineOf('gray-ooze', 'Corrosive Form').trait).toEqual({
      kind: 'corrodes-what-hits-it',
      weaponPenalty: 1,
      weaponDestroyedAt: 5,
      destroysAmmunition: true,
      forTheTable: [
        {
          kind: 'a-hole-eaten-through-the-world',
          sentence: 'The ooze can eat through 2-inch-thick, nonmagical metal or wood in 1 round.',
        },
      ],
    });
  });

  it("reads the giant boar's Bloodied Fury as the melee half of the rule the boar prints whole", () => {
    expect(lineOf('giant-boar', 'Bloodied Fury').trait).toEqual({
      kind: 'advantage-while-bloodied',
      rolls: ['attack-roll'],
      reach: 'melee',
    });
    // The boar's own sentence names every attack roll and keeps no axis.
    expect(lineOf('boar', 'Bloodied Fury').trait).toEqual({
      kind: 'advantage-while-bloodied',
      rolls: ['attack-roll'],
    });
  });

  it("reads the swarm of insects' Spider Climb with the gate it prints", () => {
    expect(lineOf('swarm-of-insects', 'Spider Climb').trait).toEqual({
      kind: 'climbs-without-a-check',
      ifHasClimbSpeed: true,
    });
    expect(lineOf('black-pudding', 'Spider Climb').trait).toEqual({ kind: 'climbs-without-a-check' });
  });

  it("reads the three hags' Coven Magic: the menu, the DC, the two allies and the rest per spell", () => {
    const menu = ['augury', 'find-familiar', 'identify', 'locate-object', 'scrying', 'unseen-servant'];
    const coven = (dc: number) => ({
      spells: menu,
      ability: 'int',
      saveDc: dc,
      alliesWithin: { count: 2, feet: 30, kind: 'hag' },
      eachSpellOncePer: 'long-rest',
      ownCastingTime: true,
      waives: ['material'],
    });
    expect(lineOf('green-hag', 'Coven Magic').casts).toEqual(coven(11));
    expect(lineOf('night-hag', 'Coven Magic').casts).toEqual(coven(14));
    // The sea hag's menu is italicised as one run; it is the same menu.
    expect(lineOf('sea-hag', 'Coven Magic').casts).toEqual(coven(11));
  });

  it('reads the incubus and the succubus as each other at a Long Rest', () => {
    expect(lineOf('incubus', 'Succubus Form').trait).toEqual({
      kind: 'becomes-another-block-at-a-long-rest',
      block: 'succubus',
      keepsEquipment: true,
    });
    expect(lineOf('succubus', 'Incubus Form').trait).toEqual({
      kind: 'becomes-another-block-at-a-long-rest',
      block: 'incubus',
    });
  });

  it("reads the troll limb's Troll Spawn: a day, a d12, a troll or nothing", () => {
    expect(lineOf('troll-limb', 'Troll Spawn').trait).toEqual({
      kind: 'becomes-another-block-on-a-die',
      afterHours: 24,
      dice: '1d12',
      on: 12,
      block: 'troll',
    });
  });

  it("reads the black pudding's and the ochre jelly's Split: the gate, the two triggers", () => {
    const split = {
      kind: 'splits-into-two-creatures',
      sizes: ['large', 'medium'],
      minimumHitPoints: 10,
      whenBloodied: true,
      damageTypes: ['lightning', 'slashing'],
    };
    expect(lineOf('black-pudding', 'Split').trait).toEqual(split);
    expect(lineOf('ochre-jelly', 'Split').trait).toEqual(split);
  });

  it('names a block that the bestiary prints, wherever a line becomes one', () => {
    const ids = new Set(bestiary.map((block) => block.id));
    let named = 0;
    for (const block of bestiary) {
      for (const line of block.traits) {
        const trait = line.trait as { readonly kind: string; readonly block?: string } | undefined;
        if (trait?.block === undefined) continue;
        named += 1;
        expect(ids, `${block.id}/${line.name}`).toContain(trait.block);
      }
    }
    expect(named).toBeGreaterThanOrEqual(3);
  });
});
