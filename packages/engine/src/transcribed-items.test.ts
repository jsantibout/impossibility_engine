import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { rollAbilityCheck } from './checks.js';
import {
  attuneItem,
  awardItems,
  chargesLeft,
  declareDawn,
  equipItem,
  expendCharges,
  resolveAttack,
  resolveSpell,
  rollInitiativeFor,
  unequipItem,
} from './commands.js';
import { checkBonuses } from './commands/rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { beginRest } from './rest.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import {
  armorClassOf,
  canSee,
  defensesOf,
  effectiveConditions,
  rollModesFor,
  sensesOf,
  suppressedConditions,
} from './standing.js';
import { speed } from './character.js';

/**
 * The transcribed catalogue, proved through the commands rather than read.
 *
 * `magic-items.test.ts` in `@ie/content` holds every item against the page it
 * was read from — its kind, its rarity's number, its attunement bracket, its
 * charge count. That is the transcription being *right*. This is the other
 * half: that an item transcribed right **does something**, through the same
 * public commands a table would use, and does it to the roll the book names
 * and to no other.
 *
 * One item per shape, and the shapes are what the four briefs before this one
 * built: a bonus narrowed to the weapon it was granted with, a bonus to an
 * Armour Class, a bonus to a saving throw and an ability check, a granted
 * mode, a granted Resistance, a suppressed condition, an aura that leaves its
 * holder, an armour record the magic *edits*, an attunement prerequisite, and
 * a pool of charges.
 */

const id = (s: string) => asCharacterId(s);
const HERO = id('hero');
const FRIEND = id('friend');
const FOE = id('foe');
const WITCH = id('witch');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** Everything the catalogue holds, handed over at once: owning is not wearing. */
const HOARD = [
  'rapier-plus-2',
  'rapier',
  'dagger',
  'chain-mail-plus-1',
  'chain-mail',
  'mithral-chain-mail',
  'shield',
  'shield-plus-2',
  'bracers-of-defense',
  'stone-of-good-luck',
  'boots-of-elvenkind',
  'sentinel-shield',
  'weapon-of-warning',
  'staff-of-fire',
  'wand-of-fireballs',
  'periapt-of-proof-against-poison',
];

const PRELUDE: readonly GameEvent[] = [
  added(HERO, 'party'),
  added(FRIEND, 'party'),
  added(FOE, 'goblins'),
  added(WITCH, 'coven', { spellcastingAbility: 'int', abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 } }),
  {
    type: 'resource-pool-declared',
    id: WITCH,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person'] }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: FRIEND, placement: { from: { creature: HERO }, feet: 20, bearing: 90 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: HERO }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: WITCH, placement: { from: { creature: HERO }, feet: 25, bearing: 180 } },
  { type: 'sight-declared', from: WITCH, to: HERO, seen: true },
];

/**
 * The hoard, handed over through the door a DM hands one over through.
 *
 * `awardItems` rather than a hand-written `items-gained`: a charged copy is
 * labelled and given its pool where it is gained, and a line with no record
 * has no charges to spend at all.
 */
const SETUP: readonly GameEvent[] = [
  ...PRELUDE,
  ...unwrap(
    awardItems(
      fold('seed', PRELUDE),
      { issuer: createRollIssuer('r'), rng: createRng('the-hoard') as Rng, content: SRD_CONTENT },
      HERO,
      HOARD.map((item) => ({ id: item })),
      'the hoard',
    ),
    'the hoard',
  ),
];

const supply = (seed = 'seed') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** Wear it, and attune to it if its own line asks for that. */
const worn = (
  log: readonly GameEvent[],
  itemId: string,
  who: CharacterId = HERO,
): readonly GameEvent[] => {
  const equipped = run(log, (s) => equipItem(s, SRD_CONTENT, who, itemId));
  if (SRD_CONTENT.item(itemId)?.attunement === undefined) return equipped;
  return attuned(equipped, itemId, who);
};

/** Attune, resting first if nobody is resting yet. */
const attuned = (
  log: readonly GameEvent[],
  itemId: string,
  who: CharacterId = HERO,
): readonly GameEvent[] => {
  const resting =
    fold('seed', log).creatures[who]?.resting == null
      ? run(log, (s) => beginRest(s, who, 'short'))
      : log;
  return run(resting, (s) => attuneItem(s, SRD_CONTENT, who, itemId));
};

const ac = (log: readonly GameEvent[], who: CharacterId = HERO): number =>
  armorClassOf(fold('seed', log), who);

const swing = (log: readonly GameEvent[], weapon: string, seed = 'swing') =>
  unwrap(
    resolveAttack(fold('seed', log), HERO, { target: FOE, weapon, free: true }, supply(seed)),
    'attack',
  );

/**
 * A swing by somebody the scene does not yet hold: a field, a goblin standing
 * on their toes, and one attack. For the characters `made` builds, which start
 * with no scene at all.
 */
const swingAt = (log: readonly GameEvent[], who: CharacterId, weapon: string, seed = 'swing') => {
  const placed: readonly GameEvent[] = [
    ...log,
    added(FOE, 'goblins'),
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
    { type: 'landmark-added', name: 'the field', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: who, placement: { from: { landmark: 'the field' }, feet: 0 } },
    { type: 'creature-placed', id: FOE, placement: { from: { creature: who }, feet: 5, bearing: 0 } },
  ];
  return unwrap(
    resolveAttack(fold('seed', placed), who, { target: FOE, weapon, free: true }, supply(seed)),
    'attack',
  );
};

/** The contributions of the one d20 the log records, by source. */
const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

const stealthModes = (log: readonly GameEvent[], who: CharacterId = HERO) =>
  rollModesFor(fold('seed', log), {
    family: 'ability-check',
    roller: who,
    ability: 'dex',
    skill: 'stealth',
  }).modes;

const initiativeModes = (log: readonly GameEvent[], who: CharacterId) =>
  rollModesFor(fold('seed', log), { family: 'initiative', roller: who }).modes;

describe('the templates: "+1, +2, or +3" over a whole equipment table', () => {
  /**
   * A row other than the Longsword the first brief wrote by hand, and a
   * rarity other than its +1: the template is a loop over the parsed table, so
   * what is being proved is that an instance nobody typed out works.
   */
  it('adds the rarity’s number to an attack made with that weapon and no other', () => {
    const armed = worn(SETUP, 'rapier-plus-2');
    const magic = swing(armed, 'rapier-plus-2');
    const mundane = swing(run(armed, (s) => equipItem(s, SRD_CONTENT, HERO, 'rapier')), 'rapier');

    expect(magic.attack!.roll.modifier).toBe(mundane.attack!.roll.modifier + 2);
    expect(contributionsOf(magic.events)['+2 Rapier']).toBe(2);
    // "Made with this magic weapon": the dagger in the same pack gets nothing.
    const dagger = swing(run(armed, (s) => equipItem(s, SRD_CONTENT, HERO, 'dagger')), 'dagger');
    expect(contributionsOf(dagger.events)['+2 Rapier']).toBeUndefined();
  });

  /**
   * **The bracket is a requirement, on a weapon exactly as on a ring.**
   *
   * A "+1, +2, or +3" weapon prints no bracket and needs no requirement: what
   * makes its bonus conditional is that `itemStandingOf` offers only what is
   * equipped or attuned, and the narrowing does the rest. But seven of the
   * weapons the book names *do* print one, and for those the same reasoning
   * runs out — a character who picks the sword up and swings it is equipped,
   * so the grant is offered, and the attunement the SRD asks for would never
   * be asked about. Mutating `while-attuned` off the Holy Avenger is the
   * mutation this catches.
   */
  it('gives a weapon’s own bonus only to somebody who has attuned to it', () => {
    const knight = made(paladinChoices());
    const armed = run(knight, (s) => equipItem(s, SRD_CONTENT, KNIGHT, 'holy-avenger'));
    expect(fold('seed', armed).creatures.knight?.attuned).toEqual([]);
    expect(contributionsOf(swingAt(armed, KNIGHT, 'holy-avenger').events)['Holy Avenger']).toBeUndefined();

    const sworn = attuned(armed, 'holy-avenger', KNIGHT);
    expect(contributionsOf(swingAt(sworn, KNIGHT, 'holy-avenger').events)['Holy Avenger']).toBe(3);
  });

  it('raises Armour Class by the number on the armour, once it is worn', () => {
    const plain = ac(run(SETUP, (s) => equipItem(s, SRD_CONTENT, HERO, 'chain-mail')));
    // Owned and in a pack: `itemStandingOf` offers nothing it is not wearing.
    expect(ac(SETUP)).toBe(12);
    expect(ac(worn(SETUP, 'chain-mail-plus-1'))).toBe(plain + 1);
  });

  /**
   * SRD Shield, +N: "in addition to the Shield's normal bonus to AC". The two
   * arrive by different roads — the +2 a Shield gives is on the armour record
   * and the magic is a standing effect — so both are counted.
   */
  it('adds the Shield’s own bonus and the magic one', () => {
    const plain = ac(run(SETUP, (s) => equipItem(s, SRD_CONTENT, HERO, 'shield')));
    expect(plain).toBe(14);
    expect(ac(worn(SETUP, 'shield-plus-2'))).toBe(plain + 2);
  });
});

/**
 * SRD Mithral Armor: "If the armor normally imposes Disadvantage on Dexterity
 * (Stealth) checks or has a Strength requirement, the mithral version of the
 * armor doesn't."
 *
 * The one item in the tranche that grants nothing: what it changes is two
 * fields of the armour record, and both are read off the sheet the fold
 * derives from the equip event.
 */
describe('an item whose magic edits the armour record rather than granting anything', () => {
  const stealthOf = (log: readonly GameEvent[]) => {
    const creature = fold('seed', log).creatures[HERO]!;
    return unwrap(
      rollAbilityCheck(createRollIssuer('r'), createRng('sneak') as Rng, creature.sheet, 'dex', {
        skill: 'stealth',
        dc: 15,
      }),
      'stealth',
    ).mode;
  };

  it('sneaks without Disadvantage where the mundane row would impose it', () => {
    expect(stealthOf(run(SETUP, (s) => equipItem(s, SRD_CONTENT, HERO, 'chain-mail')))).toBe(
      'disadvantage',
    );
    expect(stealthOf(worn(SETUP, 'mithral-chain-mail'))).toBe('normal');
  });

  it('is not slowed by a Strength requirement it does not have', () => {
    const walks = (log: readonly GameEvent[]) => speed(fold('seed', log).creatures[HERO]!.sheet);
    // The hero's Strength is 10 and Chain Mail asks for 13: ten feet.
    expect(walks(run(SETUP, (s) => equipItem(s, SRD_CONTENT, HERO, 'chain-mail')))).toBe(20);
    expect(walks(worn(SETUP, 'mithral-chain-mail'))).toBe(30);
  });
});

describe('a bonus with a condition of its own', () => {
  /**
   * SRD Bracers of Defense: "you gain a +2 bonus to Armor Class **if you are
   * wearing no armor and using no Shield**" — `unarmored`, the requirement the
   * Monk's Unarmored Movement already asks in the same two halves.
   */
  it('gives the bracers’ bonus only while nothing else is worn', () => {
    const bare = ac(SETUP);
    const bracered = worn(SETUP, 'bracers-of-defense');
    expect(ac(bracered)).toBe(bare + 2);

    const armoured = run(bracered, (s) => equipItem(s, SRD_CONTENT, HERO, 'chain-mail'));
    expect(ac(armoured)).toBe(ac(run(SETUP, (s) => equipItem(s, SRD_CONTENT, HERO, 'chain-mail'))));
  });

  /**
   * SRD Stone of Good Luck: "While this polished agate is **on your person**".
   * A stone in a pocket is not worn, and attunement is the relation that says
   * you have it — so this is the item whose benefit needs no `while-worn` and
   * is the proof that the two requirements are separable in that direction.
   */
  it('gives the stone’s bonus to a check and a save without being worn', () => {
    const state = fold('seed', attuned(SETUP, 'stone-of-good-luck'));
    expect(state.creatures.hero?.equipped).toEqual([]);
    expect(checkBonuses(state, HERO, undefined)).toEqual([
      { source: 'Stone of Good Luck (Luckstone)', flat: 1 },
    ]);

    const held = (log: readonly GameEvent[]) =>
      unwrap(
        resolveSpell(
          fold('seed', log),
          WITCH,
          { spellId: 'hold-person', targets: [HERO], slotLevel: 2 },
          supply('hold'),
        ),
        'hold-person',
      );
    expect(held(attuned(SETUP, 'stone-of-good-luck')).outcomes[0]?.save?.modifier).toBe(
      (held(SETUP).outcomes[0]?.save?.modifier ?? 0) + 1,
    );
  });
});

describe('a mode granted by an item, and the rolls it reaches', () => {
  /**
   * SRD Boots of Elvenkind print no attunement bracket, which is what makes
   * them worth having beside the Cloak: "while worn" alone, with no second
   * requirement to satisfy.
   */
  it('grants Advantage on Stealth the moment the boots go on, with no attunement', () => {
    expect(SRD_CONTENT.item('boots-of-elvenkind')?.attunement).toBeUndefined();
    expect(stealthModes(SETUP)).toEqual([]);
    expect(stealthModes(worn(SETUP, 'boots-of-elvenkind'))).toEqual([
      { source: 'Boots of Elvenkind', mode: 'advantage' },
    ]);
  });

  /**
   * SRD Sentinel Shield: "you have Advantage on Initiative rolls and Wisdom
   * (Perception) checks" — two roll families from one sentence, and Initiative
   * is a family of its own rather than a Dexterity check.
   */
  it('reaches Initiative and a Perception check, and no other check', () => {
    const shielded = worn(SETUP, 'sentinel-shield');
    expect(initiativeModes(shielded, HERO)).toEqual([
      { source: 'Sentinel Shield', mode: 'advantage' },
    ]);

    const perception = rollModesFor(fold('seed', shielded), {
      family: 'ability-check',
      roller: HERO,
      ability: 'wis',
      skill: 'perception',
    }).modes;
    expect(perception).toEqual([{ source: 'Sentinel Shield', mode: 'advantage' }]);
    // Not every Wisdom check: the selector names the skill the book names.
    expect(
      rollModesFor(fold('seed', shielded), {
        family: 'ability-check',
        roller: HERO,
        ability: 'wis',
        skill: 'insight',
      }).modes,
    ).toEqual([]);
  });

  /**
   * SRD Weapon of Warning: "you **and allies within 30 feet of you** gain the
   * following benefits ... Each subject has Advantage on its Initiative
   * rolls."
   *
   * The only item here whose benefit leaves its holder, which is why an item's
   * aura has to declare its own size: no feature stands behind it to say how
   * far it goes.
   */
  it('reaches an ally inside the aura and nobody outside it', () => {
    const armed = worn(SETUP, 'weapon-of-warning');
    expect(initiativeModes(armed, HERO)).toEqual([
      { source: 'Weapon of Warning', mode: 'advantage' },
    ]);
    // The friend is 20 feet away and on the same side.
    expect(initiativeModes(armed, FRIEND)).toEqual([
      { source: 'Weapon of Warning', mode: 'advantage' },
    ]);
    // The goblin is five feet away and is nobody's ally.
    expect(initiativeModes(armed, FOE)).toEqual([]);

    const apart: readonly GameEvent[] = [
      ...armed,
      {
        type: 'creature-moved',
        id: FRIEND,
        placement: { from: { creature: HERO }, feet: 40, bearing: 90 },
      },
    ];
    expect(initiativeModes(apart, FRIEND)).toEqual([]);

    // And it is the roll the initiative command actually makes.
    const rolled = unwrap(
      rollInitiativeFor(
        fold('seed', armed),
        FRIEND,
        createRollIssuer('r'),
        createRng('initiative') as Rng,
      ),
      'initiative',
    );
    expect(rolled.roll.mode).toBe('advantage');
  });
});

describe('a defence and a condition an item holds off', () => {
  /**
   * SRD Staff of Fire: "You have Resistance to Fire damage while you hold this
   * staff", and ten charges beside it — two grants on one item, read by two
   * readers.
   */
  it('halves the fire and counts the charges, for a class the staff will take', () => {
    const wizard = made(wizardChoices());
    const armed = worn(wizard, 'staff-of-fire', MAGE);
    const state = fold('seed', armed);

    expect(defensesOf(state, MAGE)['fire']?.resistant).toBe(true);
    expect(defensesOf(fold('seed', wizard), MAGE)['fire']?.resistant).toBeUndefined();
    expect(chargesLeft(state, SRD_CONTENT, MAGE, 'staff-of-fire')).toBe(10);
  });

  /**
   * SRD Periapt of Proof against Poison: "you have Immunity to the Poisoned
   * condition and Poison damage." The condition half is a grant; the damage
   * half is declared in `unmodelled`, because a standing grant offers
   * Resistance and not Immunity.
   */
  it('holds the Poisoned condition off whoever wears the periapt', () => {
    const poisoned: GameEvent = {
      type: 'condition-applied',
      id: HERO,
      condition: 'poisoned',
      source: 'a green draught',
    };
    const on = [...worn(SETUP, 'periapt-of-proof-against-poison'), poisoned];
    expect(suppressedConditions(fold('seed', on), HERO)).toEqual(['poisoned']);
    // The record still says it is on them — the grant suppresses rather than
    // prevents, which is the whole of what the `unmodelled` note declares.
    expect(fold('seed', on).creatures.hero?.conditions.conditions).toContain('poisoned');
    expect(effectiveConditions(fold('seed', on), HERO).conditions).not.toContain('poisoned');

    const without = [...SETUP, poisoned];
    expect(effectiveConditions(fold('seed', without), HERO).conditions).toContain('poisoned');
  });
});

const MAGE = id('mage');
const KNIGHT = id('knight');

const wizardChoices = (): CharacterChoices => ({
  name: 'Mage',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['arcana', 'history'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'mage-hand'],
  spellbook: [
    'magic-missile',
    'shield',
    'charm-person',
    'chromatic-orb',
    'ray-of-sickness',
    'grease',
    'misty-step',
    'mirror-image',
    'web',
    'invisibility',
  ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
  preparedSpells: ['magic-missile', 'shield', 'grease', 'misty-step', 'web', 'invisibility'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['burning-hands', 'thunderwave'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const paladinChoices = (): CharacterChoices => ({
  name: 'Knight',
  classId: 'paladin',
  level: 3,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  subclassId: 'oath-of-devotion',
  cantrips: [],
  spellbook: [],
  preparedSpells: ['bless', 'cure-wounds', 'heroism', 'searing-smite'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'soldier:savage-attacker': [] },
  feats: {
    'human:versatile': { featId: 'alert' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'paladin:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A character, plus the hoard, plus a scene to stand in. */
function made(choices: CharacterChoices): readonly GameEvent[] {
  const who = choices.classId === 'paladin' ? KNIGHT : MAGE;
  const born = unwrap(createCharacter(SRD_CONTENT, choices, who), 'create');
  return [
    ...born,
    ...unwrap(
      awardItems(
        fold('seed', born),
        { issuer: createRollIssuer('r'), rng: createRng('the-hoard') as Rng, content: SRD_CONTENT },
        who,
        ['holy-avenger', 'staff-of-fire', 'wand-of-fireballs'].map((item) => ({ id: item })),
        'the hoard',
      ),
      'the hoard',
    ),
  ];
}

/**
 * SRD prints two prerequisites and no more: "by a Paladin" and "by a
 * spellcaster". They ask different questions of different parts of the sheet,
 * which is why they are two fields rather than a class called "spellcaster".
 */
describe('an attunement prerequisite, asked of whoever picks the item up', () => {
  it('refuses the Holy Avenger to a Wizard and gives it to a Paladin', () => {
    const wizard = fold('seed', run(made(wizardChoices()), (s) => beginRest(s, MAGE, 'short')));
    const refused = attuneItem(wizard, SRD_CONTENT, MAGE, 'holy-avenger');
    expect(isErr(refused)).toBe(true);
    expect(isErr(refused) && refused.code).toBe('prerequisite_unmet');
    expect(isErr(refused) && refused.reason).toMatch(/paladin/i);

    const knight = attuned(made(paladinChoices()), 'holy-avenger', KNIGHT);
    expect(fold('seed', knight).creatures.knight?.attuned.map((a) => a.id)).toEqual([
      'holy-avenger',
    ]);

    // And the sword's own number arrives on a swing made with it.
    const armed = run(knight, (s) => equipItem(s, SRD_CONTENT, KNIGHT, 'holy-avenger'));
    expect(contributionsOf(swingAt(armed, KNIGHT, 'holy-avenger', 'smite').events)['Holy Avenger']).toBe(3);
  });

  /**
   * Three answers and not two: a creature nobody has said anything about is an
   * unanswered question rather than a refusal, and the engine says which
   * command would settle it.
   */
  it('asks about a creature whose spellcasting nobody has declared, and takes a Wizard', () => {
    const stranger = run(SETUP, (s) => beginRest(s, HERO, 'short'));
    const asked = attuneItem(fold('seed', stranger), SRD_CONTENT, HERO, 'wand-of-fireballs');
    expect(isNeedsContext(asked)).toBe(true);
    // And it names the command that would settle it **in its prose**: an ask
    // nobody can answer is a refusal wearing a question's clothes.
    //
    // It carries no `ContextRequest`, and that is the answer rather than an
    // omission — a request's `kind` is the name of a declared-not-derived fact
    // with a door, and there is no kind for "what this creature casts". The
    // tag it used to carry was `creature`, which sent a caller to the tools
    // that *create* one. `commands/inventory.ts` argues it where the refusal
    // is written and `packages/tools/src/doors.test.ts` records the gap.
    expect(contextRequestsOf(asked)).toEqual([]);
    expect(isErr(asked) ? asked.reason : '').toContain(HERO);
    expect(isErr(asked) ? asked.reason : '').toMatch(/declareSpellcasting/);

    const mage = attuned(made(wizardChoices()), 'wand-of-fireballs', MAGE);
    const held = run(mage, (s) => equipItem(s, SRD_CONTENT, MAGE, 'wand-of-fireballs'));
    expect(chargesLeft(fold('seed', held), SRD_CONTENT, MAGE, 'wand-of-fireballs')).toBe(7);
  });
});

/**
 * The two entries whose whole mechanic is a count on **this** copy.
 *
 * SRD prints "When found, a container contains 1d6 + 1 ounces" twice, on the
 * Sovereign Glue and on the Universal Solvent, and until a copy had a record
 * there was nowhere to keep the answer: a catalogue row is the same for
 * everybody, so one jar could not be half empty while another was full.
 * `CatalogueItem.chargesRolled` is the item saying the book rolls for it,
 * `awardItems` is the one door that may throw the die, and the pool it pins is
 * keyed to the copy.
 *
 * **And nothing gives an ounce back.** `recovers: 'special'` is `resources.ts`
 * saying so — a `dawn` tag would refill the jar every morning, which is rule 3
 * in `packages/content/src/items.ts` the wrong way round.
 */
describe('a count the book rolls at the copy’s birth', () => {
  /**
   * Found, and then picked up: an ounce is spent "while holding it", which is
   * `expendCharges`'s own rule and the same one a staff keeps.
   */
  const found = (
    itemId: string,
    seed: string,
    held: readonly string[] = [itemId],
    quantity = 1,
  ) => {
    const awarded = run(PRELUDE, (s) =>
      awardItems(s, supply(seed), HERO, [{ id: itemId, quantity }], 'the hoard'),
    );
    return held.reduce<readonly GameEvent[]>(
      (log, copy) => run(log, (s) => equipItem(s, SRD_CONTENT, HERO, copy)),
      awarded,
    );
  };

  it('rolls a jar’s ounces once, when the jar is found, and spends them one at a time', () => {
    const log = found('sovereign-glue', 'the-jar');
    const ounces = chargesLeft(fold('seed', log), SRD_CONTENT, HERO, 'sovereign-glue');
    // "1d6 + 1": two to seven, and the number is the log's rather than the
    // catalogue's — which is the whole of what the entry was blocked on.
    expect(ounces).toBeGreaterThanOrEqual(2);
    expect(ounces).toBeLessThanOrEqual(7);
    expect(
      log.some((e) => e.type === 'roll-recorded' && e.label.includes('1d6 + 1')),
      'the ounces were rolled in the log',
    ).toBe(true);

    const used = run(log, (s) => expendCharges(s, SRD_CONTENT, HERO, 'sovereign-glue', 1));
    expect(chargesLeft(fold('seed', used), SRD_CONTENT, HERO, 'sovereign-glue')).toBe(ounces - 1);
  });

  /**
   * Two tubes are two counts, which is what keying the pool to the copy bought:
   * pouring one out leaves the other exactly as full as it was found.
   */
  it('gives two tubes two counts of their own', () => {
    // Two tubes, one hand: `equipItem` refuses the second copy of a kind
    // already held, and a count is read off the copy either way.
    const log = found('universal-solvent', 'two-tubes', ['item:1'], 2);
    const first = chargesLeft(fold('seed', log), SRD_CONTENT, HERO, 'item:1');
    const second = chargesLeft(fold('seed', log), SRD_CONTENT, HERO, 'item:2');
    expect(first).toBeGreaterThanOrEqual(2);
    expect(second).toBeGreaterThanOrEqual(2);

    const poured = run(log, (s) => expendCharges(s, SRD_CONTENT, HERO, 'item:1', 2));
    expect(chargesLeft(fold('seed', poured), SRD_CONTENT, HERO, 'item:1')).toBe(first - 2);
    expect(chargesLeft(fold('seed', poured), SRD_CONTENT, HERO, 'item:2')).toBe(second);
  });

  /** And the morning gives nothing back, where every other pool in the book refills. */
  it('leaves an emptied tube empty at dawn', () => {
    const log = found('universal-solvent', 'one-tube');
    const ounces = chargesLeft(fold('seed', log), SRD_CONTENT, HERO, 'universal-solvent');
    const empty = run(log, (s) =>
      expendCharges(s, SRD_CONTENT, HERO, 'universal-solvent', ounces),
    );
    expect(chargesLeft(fold('seed', empty), SRD_CONTENT, HERO, 'universal-solvent')).toBe(0);

    const morning = run(empty, (s) => declareDawn(s, supply('dawn')));
    expect(chargesLeft(fold('seed', morning), SRD_CONTENT, HERO, 'universal-solvent')).toBe(0);
  });
});

/**
 * The first item in the catalogue that grants a **sense**, and the reason its
 * entry stopped being blocked.
 *
 * The map's line against the Goggles of Night said "a standing grant has no
 * member that would say so", and that was true when it was written and is not
 * now: `sense` is a member of `ITEM_EFFECT_KINDS` with a validated range, a
 * species already writes exactly this grant, and `sensesOf` reads one off
 * whatever is worn and attuned — so the goggles are the same grant on a
 * different source, which is the whole claim a catalogue makes.
 */
describe('a sense an item grants, read off what is worn', () => {
  /**
   * The scene, plus two creatures that bracket the range the goggles reach.
   *
   * Everybody `PRELUDE` places stands within twenty-five feet, so a grant of
   * thirty feet would answer every question below exactly as one of sixty
   * does — a test agreeing with the wrong number. So the range is pinned
   * from **both** sides: a scout fifty feet out, whom the lenses reach, and
   * a sentry a hundred feet out, whom they do not. Nobody has declared
   * anything about either.
   */
  const SCOUT = id('scout');
  const SENTRY = id('sentry');

  const nightfall = (): readonly GameEvent[] =>
    worn(
      run(
        [
          ...PRELUDE,
          added(SCOUT, 'goblins'),
          added(SENTRY, 'goblins'),
          {
            type: 'creature-placed',
            id: SCOUT,
            placement: { from: { creature: HERO }, feet: 50, bearing: 180 },
          },
          {
            type: 'creature-placed',
            id: SENTRY,
            placement: { from: { creature: HERO }, feet: 100, bearing: 270 },
          },
        ],
        (s) => awardItems(s, supply('the-goggles'), HERO, [{ id: 'goggles-of-night' }], 'the hoard'),
      ),
      'goggles-of-night',
    );

  it('gives its wearer Darkvision out to sixty feet, and nobody else', () => {
    const dark = nightfall();
    expect(sensesOf(fold('seed', dark), HERO)).toEqual([{ sense: 'darkvision', feet: 60 }]);
    // "While wearing these dark lenses": the friend standing beside them has
    // nothing, which is the requirement doing its work rather than the grant.
    expect(sensesOf(fold('seed', dark), FRIEND)).toEqual([]);
  });

  /**
   * And the sense reaches the question sight asks — the seam the same landing
   * built, and the difference between a grant that applies and one that is
   * merely stored.
   */
  it('answers the sight question inside the range, and leaves it open beyond', () => {
    const state = fold('seed', nightfall());
    // FOE stands five feet away and FRIEND twenty, both inside sixty.
    expect(canSee(state, HERO, FOE)).toBe(true);
    expect(canSee(state, HERO, FRIEND)).toBe(true);
    // WITCH is twenty-five feet away and can see the hero by declaration; the
    // hero's own answer is the goggles', not the declaration's.
    expect(canSee(state, HERO, WITCH)).toBe(true);

    // **And the sixty is a number rather than a licence**, which takes an
    // assertion on each side of it: the scout is fifty feet off and inside
    // what the lenses reach, so a grant of thirty fails here; the sentry is
    // a hundred and outside it, so a grant of a hundred and fifty fails
    // below. The answer beyond the range is the three-valued one the seam is
    // for — `null` is "ask the table", not "no".
    expect(canSee(state, HERO, SCOUT)).toBe(true);
    expect(canSee(state, HERO, SENTRY)).toBeNull();

    // Taken off, the sense goes with them: a worn benefit is derived on every
    // read rather than stored, so nothing has to remember to take it away.
    const bare = run(nightfall(), (s) =>
      unequipItem(s, SRD_CONTENT, HERO, 'goggles-of-night'),
    );
    expect(sensesOf(fold('seed', bare), HERO)).toEqual([]);
  });
});
