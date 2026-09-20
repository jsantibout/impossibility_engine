import { describe, expect, it } from 'vitest';
import { MARTIAL_ARTS_DIE, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import {
  extendContent,
  parseClassDefinition,
  READABLE_FEATURE_FIELDS,
  READABLE_GRANT_KINDS,
  type Content,
} from './content.js';
import { checkFeatureDefinition } from './feature-schema.js';
import type { FeatureDefinition } from './progression.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A class that redefines what an attack **is**.
 *
 * The attack layer read a weapon or the fixed Unarmed Strike and had no
 * notion of a class changing either, which is why the Monk was the only class
 * of the twelve whose *level 1* feature was `manual`. SRD Martial Arts prints
 * three benefits under one gate — a growing die rolled "in place of the normal
 * damage of your Unarmed Strike or Monk weapons", Dexterity used "instead of
 * your Strength modifier" for the same attacks, and an Unarmed Strike as a
 * Bonus Action — all of them held by "while you are unarmed or wielding only
 * Monk weapons and you aren't wearing armor or wielding a Shield".
 *
 * What is asserted here is the **vocabulary**, not the Monk: the last describe
 * block builds a homebrew class that redefines its own unarmed strike through
 * `extendContent` with no engine change, which is what proves the grant is a
 * member anybody may write rather than one class's special case.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const SHAN = id('shan');
const GRUM = id('grum');
const GOBLIN = id('goblin');

/**
 * The d20 is whatever the test asks for; every die after it comes up on its
 * highest face.
 *
 * So a damage total is readable as a number — `1d8 + 2` is 10 and nothing
 * else — which is what lets the die a level prints be asserted rather than
 * sampled. The first throw is the attack roll.
 */
const scripted = (d20: number): Rng => {
  let thrown = 0;
  return {
    int: (sides: number) => (thrown++ === 0 ? d20 : sides),
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (content: Content = SRD_CONTENT, d20 = 15) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(d20),
  content,
});

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/** A sandbag with two hundred hit points and an Armour Class of 10. */
const dummy: GameEvent = {
  type: 'creature-added',
  id: GOBLIN,
  name: 'goblin',
  sheet: plain(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'goblins',
};

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

const originFeats = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
};

/**
 * The Ability Score Improvements a Monk's table prints by a level, answered
 * with points that land on Charisma and Intelligence.
 *
 * Neither is a score any assertion below reads, so a Monk at 11 has exactly
 * the Strength and Dexterity a Monk at 1 does and the die is the only thing
 * that has moved.
 */
const improvements = (level: number): Record<string, unknown> =>
  Object.fromEntries(
    (SRD_CONTENT.classById('monk')?.features ?? [])
      .filter((one) => one.choice?.kind === 'feat' && one.level <= level)
      .map((one) => [
        one.id,
        { featId: 'ability-score-improvement', abilities: ['cha', 'int'] },
      ]),
  );

/** A Monk whose Dexterity (15) beats their Strength (12). */
const monk = (level: number, over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Shan',
  classId: 'monk',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  ...(level >= 3 ? { subclassId: 'warrior-of-the-open-hand' } : {}),
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...originFeats, ...improvements(level) },
  ...over,
});

/** The control: a class with no style at all, punching. */
const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'path-of-the-berserker',
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: originFeats,
  ...over,
});

/** A character, a sandbag five feet away, and a weapon rack. */
const table = (
  choices: CharacterChoices,
  who: CharacterId,
  content: Content = SRD_CONTENT,
  extra: readonly GameEvent[] = [],
): readonly GameEvent[] => [
  ...(unwrap(createCharacter(content, choices, who), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: who, side: 'party' },
  dummy,
  {
    type: 'items-gained',
    id: who,
    items: [
      { id: 'shortsword', quantity: 1 },
      { id: 'rapier', quantity: 1 },
    ],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the dojo', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the dojo' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: who }, feet: 5, bearing: 0 } },
  ...extra,
];

const swing = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Omit<Parameters<typeof resolveAttack>[2], 'target'>,
  content: Content = SRD_CONTENT,
  d20 = 15,
) =>
  unwrap(
    resolveAttack(fold('seed', log), who, { target: GOBLIN, ...request }, supply(content, d20)),
    'attack',
  );

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

// — the die the class table prints ——————————————————————————————————————————

/**
 * SRD Martial Arts Die: "You can roll 1d6 in place of the normal damage of
 * your Unarmed Strike or Monk weapons. This die changes as you gain Monk
 * levels, as shown in the Martial Arts column of the Monk Features table."
 *
 * Asserted as a number at three levels, with the fixed Unarmed Strike beside
 * it: SRD's glossary gives everybody else "1 plus your Strength modifier", and
 * a Barbarian punching is what says the change belongs to the class and not to
 * the fist.
 */
describe('a Monk strikes unarmed for the die their level prints', () => {
  it('rolls a d6 at level 1, where anybody else deals 1', () => {
    // Dexterity 15 (+2) is the better score, so it carries the damage too.
    expect(swing(table(monk(1), SHAN), SHAN, { weapon: null }).damage).toBe(6 + 2);
    expect(MARTIAL_ARTS_DIE[0]).toBe('1d6');

    // The control: a Barbarian 3 with Strength 15 (+2) deals 1 + 2.
    expect(swing(table(barbarian(), GRUM), GRUM, { weapon: null }).damage).toBe(1 + 2);
  });

  it('rolls a d8 at level 5 and a d10 at level 11', () => {
    expect(swing(table(monk(5), SHAN), SHAN, { weapon: null }).damage).toBe(8 + 2);
    expect(MARTIAL_ARTS_DIE[4]).toBe('1d8');

    expect(swing(table(monk(11), SHAN), SHAN, { weapon: null }).damage).toBe(10 + 2);
    expect(MARTIAL_ARTS_DIE[10]).toBe('1d10');
  });
});

// — the ability, and whose choice it is ————————————————————————————————————

/**
 * SRD Dexterous Attacks: "You **can** use your Dexterity modifier instead of
 * your Strength modifier for the attack and damage rolls of your Unarmed
 * Strikes and Monk weapons."
 *
 * "Can", so the engine may not simply switch the ability: it offers one, takes
 * whichever is better when nobody says, and does what it is told when somebody
 * does — which is exactly the reading `attackAbility` already gives SRD
 * Finesse's "your choice of your Strength or Dexterity modifier".
 */
describe('Dexterity is offered for a Monk’s strikes rather than imposed', () => {
  it('uses Dexterity when it is the better score', () => {
    const hit = swing(table(monk(1), SHAN), SHAN, { weapon: null });
    expect(hit.attack?.ability).toBe('dex');
  });

  it('uses Strength when Strength is the better score', () => {
    const strong = monk(1, {
      abilities: {
        method: 'standard-array',
        assignment: { str: 15, dex: 12, con: 13, int: 8, wis: 14, cha: 10 },
      },
    });
    const hit = swing(table(strong, SHAN), SHAN, { weapon: null });
    expect(hit.attack?.ability).toBe('str');
    expect(hit.damage).toBe(6 + 2);
  });

  it('does what the character says when the character names one', () => {
    // Dexterity 15 (+2) is better, and this Monk punches with Strength 12 (+1)
    // anyway. The offer is declined, which is what "you can" allows.
    const hit = swing(table(monk(1), SHAN), SHAN, { weapon: null, finesseAbility: 'str' });
    expect(hit.attack?.ability).toBe('str');
    expect(hit.damage).toBe(6 + 1);
  });

  /** A class with no style is untouched: a Barbarian's fist is Strength's. */
  it('offers nothing to a class that has no style', () => {
    const hit = swing(table(barbarian(), GRUM), GRUM, { weapon: null, finesseAbility: 'dex' });
    expect(hit.attack?.ability).toBe('str');
  });
});

// — the weapons the style covers —————————————————————————————————————————

/**
 * SRD Martial Arts names its own set: "your Unarmed Strike and Monk weapons,
 * which are the following: Simple Melee weapons; Martial Melee weapons that
 * have the Light property."
 *
 * **Not the Monk's weapon proficiencies**, which the Core Monk Traits table
 * prints separately as "Simple weapons and Martial weapons that have the Light
 * property" — a wider set with no Melee in it. A Monk is proficient with a
 * Light Crossbow and it is not a Monk weapon, which is why the two sentences
 * are two declarations rather than one.
 */
describe('the style covers the weapons it names and no others', () => {
  /** A Shortsword is Martial, Melee and Light — the second bullet, exactly. */
  it('raises a Monk weapon’s die to the Martial Arts die', () => {
    const hit = swing(table(monk(5), SHAN), SHAN, { weapon: 'shortsword' });
    // A Shortsword's own damage is 1d6; the Martial Arts die at Monk 5 is 1d8.
    expect(SRD_CONTENT.item('shortsword')?.weapon?.damage.dice).toBe('1d6');
    expect(hit.damage).toBe(8 + 2);
    expect(hit.attack?.ability).toBe('dex');
  });

  /** A Rapier is Martial and Melee and is not Light, so it is not a Monk weapon. */
  it('leaves a weapon the style does not name exactly as it was', () => {
    const hit = swing(table(monk(11), SHAN), SHAN, { weapon: 'rapier' });
    expect(SRD_CONTENT.item('rapier')?.weapon?.damage.dice).toBe('1d8');
    // 1d8 and not the Monk 11 die of 1d10 — the weapon's own, untouched.
    expect(hit.damage).toBe(8 + 2);
  });
});

// — the gate the benefits hang on ————————————————————————————————————————

/**
 * SRD: "You gain the following benefits **while you are unarmed or wielding
 * only Monk weapons and you aren't wearing armor or wielding a Shield**."
 *
 * One sentence, two halves, and both are load-bearing: a Monk with a Greatsword
 * in hand loses the growing die on the fist they punch with the other hand, and
 * so does a Monk in Leather Armour.
 */
describe('the style is lost the moment its gate opens', () => {
  const equipping = (item: string, armor: unknown): GameEvent =>
    ({ type: 'item-equipped', id: SHAN, item, armor } as unknown as GameEvent);

  it('is lost while wielding a weapon the style does not name', () => {
    const log = table(monk(5), SHAN, SRD_CONTENT, [equipping('rapier', null)]);
    expect(state(log).creatures[SHAN]?.equipped.map((held) => held.id)).toContain('rapier');
    // The fist falls back to SRD's own Unarmed Strike: 1 plus Strength 12 (+1).
    expect(swing(log, SHAN, { weapon: null }).damage).toBe(1 + 1);
  });

  it('is kept while wielding only weapons the style does name', () => {
    const log = table(monk(5), SHAN, SRD_CONTENT, [equipping('shortsword', null)]);
    expect(swing(log, SHAN, { weapon: null }).damage).toBe(8 + 2);
  });

  it('is lost while wearing armour', () => {
    const armor = SRD_CONTENT.item('leather-armor')?.armor ?? null;
    const log = table(monk(5), SHAN, SRD_CONTENT, [
      { type: 'items-gained', id: SHAN, items: [{ id: 'leather-armor', quantity: 1 }], source: 'loot' },
      equipping('leather-armor', armor),
    ]);
    expect(state(log).creatures[SHAN]?.sheet.armor).not.toBeNull();
    expect(swing(log, SHAN, { weapon: null }).damage).toBe(1 + 1);
  });
});

// — the Bonus Action strike ————————————————————————————————————————————

/**
 * SRD Bonus Unarmed Strike: "You can make an Unarmed Strike as a Bonus
 * Action."
 *
 * A Bonus Action, which the economy already has a slot and an event for — not
 * an extra attack inside the Attack action, which is a different absence and a
 * different brief. So the strike spends `bonus-action-spent` and leaves the
 * Attack action alone, and a class whose features grant no such strike is
 * refused.
 */
describe('a style may hand its holder an Unarmed Strike as a Bonus Action', () => {
  const fighting = (who: CharacterId, log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: who, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];

  it('spends the Bonus Action and not the Attack action', () => {
    const log = fighting(SHAN, table(monk(1), SHAN));
    const hit = swing(log, SHAN, { weapon: null, bonusAction: true });
    const after = state([...log, ...hit.events]);
    expect(after.combat?.budgets[SHAN]?.bonusAction).toBe(false);
    expect(after.combat?.budgets[SHAN]?.action).toBe(true);
    // And it is the style's strike, so it carries the style's die.
    expect(hit.damage).toBe(6 + 2);
  });

  it('refuses the strike to a class no style has granted it to', () => {
    const log = fighting(GRUM, table(barbarian(), GRUM));
    const refused = resolveAttack(
      fold('seed', log),
      GRUM,
      { target: GOBLIN, weapon: null, bonusAction: true },
      supply(),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_bonus_strike');
  });

  /** SRD grants an Unarmed *Strike*, so a weapon is not what it pays for. */
  it('refuses to spend the Bonus Action on a weapon', () => {
    const log = fighting(SHAN, table(monk(1), SHAN));
    const refused = resolveAttack(
      fold('seed', log),
      SHAN,
      { target: GOBLIN, weapon: 'shortsword', bonusAction: true },
      supply(),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_bonus_strike');
  });
});

// — the member is vocabulary, not a Monk ——————————————————————————————————

/**
 * A homebrew class that redefines its own unarmed strike, from JSON, through
 * the same door the book goes through and with no engine change.
 *
 * The Pugilist's die does not grow and its offered ability is Constitution,
 * neither of which any SRD class prints — so nothing about this passes because
 * the engine happens to know what a Monk is.
 */
const PUGILIST = JSON.stringify({
  id: 'pugilist',
  name: 'Pugilist',
  primaryAbility: 'con',
  hitDie: 10,
  saveProficiencies: ['str', 'con'],
  skillChoices: { choose: 2, from: ['athletics', 'intimidation', 'insight', 'perception'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'club', quantity: 1 }], goldPieces: 10 }],
  multiclass: { weapons: ['simple'], armorTraining: { light: true, medium: false, heavy: false, shields: false }, tools: [] },
  features: [
    {
      id: 'pugilist:brawling',
      name: 'Brawling',
      level: 1,
      automation: 'engine',
      note: 'A d12 fist swung with Constitution, and a Bonus Action to swing it again.',
      grants: {
        kind: 'strike-style',
        dieByLevel: Array.from({ length: 20 }, () => '1d12'),
        ability: 'con',
        bonusUnarmedStrike: true,
      },
    },
  ],
});

const pugilist = (): CharacterChoices => ({
  ...common,
  name: 'Bex',
  classId: 'pugilist',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 10, con: 13, int: 8, wis: 14, cha: 15 },
  },
  // Sage offers Constitution, Intelligence and Wisdom; two points into the
  // first put Constitution 13 on 15, which is +2 against Strength 12's +1.
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: originFeats,
});

describe('a homebrew class redefines its own unarmed strike with no engine change', () => {
  const BEX = id('bex');
  /** Built on first use, so a refusal at the door fails one test rather than the file. */
  const world = (): Content => {
    const parsed = unwrap(parseClassDefinition(JSON.parse(PUGILIST)), 'parse');
    return unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');
  };

  it('rolls the die the class declares, with the ability it offers', () => {
    const content = world();
    const hit = swing(table(pugilist(), BEX, content), BEX, { weapon: null }, content);
    // Constitution 15 (+2) against Strength 12 (+1): the offer is the better.
    expect(hit.attack?.ability).toBe('con');
    expect(hit.damage).toBe(12 + 2);
  });

  it('carries no gate it did not declare, so a weapon in hand changes nothing', () => {
    const content = world();
    const log = table(pugilist(), BEX, content, [
      { type: 'item-equipped', id: BEX, item: 'rapier', armor: null } as unknown as GameEvent,
    ]);
    expect(swing(log, BEX, { weapon: null }, content).damage).toBe(12 + 2);
  });

  it('hands out the Bonus Action strike its own grant declares', () => {
    const content = world();
    const log: readonly GameEvent[] = [
      ...table(pugilist(), BEX, content),
      {
        type: 'combat-started',
        combatants: [
          { id: BEX, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 10, speed: 30 },
        ],
      },
    ];
    const hit = swing(log, BEX, { weapon: null, bonusAction: true }, content);
    const after = state([...log, ...hit.events]);
    expect(after.combat?.budgets[BEX]?.bonusAction).toBe(false);
  });
});

// — what the door refuses ——————————————————————————————————————————————

/**
 * Every way a style can be written wrong, each refused where a catalogue error
 * belongs: at the door, rather than as a feature that looks executed and
 * silently changes nothing.
 *
 * They divide in two. A malformed die or an empty style is a coherence
 * question one definition can answer, so `checkFeatureDefinition` answers it;
 * a requirement that is an *item's* to hold needs to know the feature is not
 * an item, which is `checkContent`'s question and is asked over the whole
 * catalogue below.
 */
describe('a malformed style is refused by the content validator', () => {
  const specimen = (grants: unknown): FeatureDefinition =>
    ({
      id: 'homebrew:style',
      name: 'Style',
      level: 1,
      automation: 'engine',
      note: 'a style, written wrong.',
      grants,
    }) as FeatureDefinition;

  const codes = (grants: unknown): readonly string[] =>
    checkFeatureDefinition(specimen(grants), {
      levels: 20,
      readableGrants: READABLE_GRANT_KINDS,
      readableFields: READABLE_FEATURE_FIELDS,
      spellExists: () => true,
    }).map((problem) => problem.code);

  const sound = {
    kind: 'strike-style',
    dieByLevel: Array.from({ length: 20 }, () => '1d6'),
    ability: 'dex',
  };

  it('accepts the shape it is meant to accept', () => {
    expect(codes(sound)).toEqual([]);
  });

  it('refuses a die table that does not reach every level', () => {
    expect(codes({ ...sound, dieByLevel: ['1d6', '1d8'] })).toContain('short_die_table');
  });

  it('refuses a die that is not notation', () => {
    expect(codes({ ...sound, dieByLevel: Array.from({ length: 20 }, () => 'a big one') })).toContain(
      'bad_strike_die',
    );
  });

  it('refuses a style that redefines nothing', () => {
    expect(codes({ kind: 'strike-style' })).toContain('empty_strike_style');
  });

  it('refuses "wielding only" on a style that names no weapons', () => {
    expect(codes({ ...sound, whileWieldingOnly: true })).toContain('wields_nothing');
  });

  /**
   * And the selector's own three closed sets.
   *
   * A value outside them names no weapon, so the style would cover less than
   * it says and — under "wielding only" — be lost more often than it should,
   * with nothing anywhere saying why. The compiler holds a class file written
   * in TypeScript to these; this is the half that arrives as JSON.
   */
  it('refuses a weapon category, kind or property the tables do not print', () => {
    const selector = (over: Record<string, unknown>): unknown => ({
      ...sound,
      weapons: [{ category: 'simple', kind: 'melee', ...over }],
    });
    expect(codes(selector({ category: 'exotic' }))).toContain('unknown_weapon_category');
    expect(codes(selector({ kind: 'thrown' }))).toContain('unknown_weapon_kind');
    expect(codes(selector({ properties: ['light', 'sharp'] }))).toContain(
      'unknown_weapon_property',
    );
    // Not vacuous: the same selector written with values the tables do print
    // passes, so what fails above is the value and not the shape.
    expect(codes(selector({ properties: ['light'] }))).toEqual([]);
  });
});

/**
 * A style is gated by the standing vocabulary, so it inherits the one trap
 * that vocabulary has: two of its members are read against the id of the
 * **item** granting them, and a feature is not an item.
 *
 * `checkContent` has refused that on a `standing` grant since items could
 * grant anything. It has to refuse it here for the same reason and not because
 * `strike-style` is special — a second member carrying `requires` inherits the
 * clause and the trap together, and a style written "while worn" would hold
 * never and say nothing about it.
 */
describe('a style may not carry a requirement only an item can hold', () => {
  const styleClass = (requires: readonly unknown[]): unknown => ({
    ...JSON.parse(PUGILIST),
    id: 'warden',
    name: 'Warden',
    features: [
      {
        id: 'warden:stance',
        name: 'Stance',
        level: 1,
        automation: 'engine',
        note: 'a style gated on something only an item can be.',
        grants: { kind: 'strike-style', ability: 'con', requires },
      },
    ],
  });

  /** The whole catalogue's door, because the refusal is about the population. */
  const loaded = (requires: readonly unknown[]) =>
    extendContent(SRD_CONTENT, {
      classes: [unwrap(parseClassDefinition(styleClass(requires)), 'parse')],
    });

  it('refuses "while worn" and "while attuned" on a feature', () => {
    for (const kind of ['while-worn', 'while-attuned']) {
      const refused = loaded([{ kind }]);
      expect(isErr(refused), kind).toBe(true);
      if (isErr(refused)) expect(refused.reason, kind).toContain('is not an item');
    }
  });

  it('accepts the requirement the SRD actually writes on one', () => {
    expect(isErr(loaded([{ kind: 'unarmored' }]))).toBe(false);
  });
});
