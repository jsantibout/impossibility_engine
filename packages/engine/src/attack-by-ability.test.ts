import { describe, expect, it } from 'vitest';
import { RAGE_DAMAGE, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { activateFeature, resolveAttack, resolveTurn } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { extendContent, parseClassDefinition } from './content.js';
import { SKILL_ABILITY } from './checks.js';
import { rollSelectorProblems, selectorMatches, type RollSelector } from './roll-modifiers.js';

/**
 * An attack roll narrowed to **the ability it was made with**.
 *
 * The selector allowed an ability on an ability check and on a saving throw
 * and refused one on an attack, on the strength of a reading that turns out
 * to be the SRD's own words the other way round: the book writes "Advantage on
 * attack rolls using Strength" on the Barbarian's Reckless Attack, and a mode
 * that could not say "using Strength" bought Advantage on every swing its
 * holder made — a Dexterity rapier included.
 *
 * What the narrowing matches against is the ability the attack was **actually**
 * made with, which the attack path already works out for itself: `attackAbility`
 * settles Finesse's "your choice of your Strength or Dexterity modifier" and a
 * strike style's offer before anything is rolled, and `AttackResult.ability` is
 * the answer the log records. So the query carries that rather than the
 * weapon's category, and a Finesse weapon swung with Strength is a Strength
 * attack roll exactly as the book reads it.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const GOBLIN = id('goblin');

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

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
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
  ...over,
});

const RAGE = 'barbarian:rage';
const RECKLESS = 'barbarian:reckless-attack';

const table = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, barbarian(over), GRUM), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: GRUM, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  {
    type: 'items-gained',
    id: GRUM,
    items: [
      { id: 'greatsword', quantity: 1 },
      { id: 'rapier', quantity: 1 },
    ],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the camp', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: GRUM, placement: { from: { landmark: 'the camp' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: GRUM }, feet: 5, bearing: 0 } },
];

/** In combat, Grum first: a stance that ends at a turn boundary needs turns. */
const fighting = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  {
    type: 'combat-started',
    combatants: [
      { id: GRUM, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'hit') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const reckless = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(activateFeature(fold('seed', log), GRUM, { feature: RECKLESS }), 'reckless'),
];

const raging = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(activateFeature(fold('seed', log), GRUM, { feature: RAGE }), 'rage'),
];

/** Swing, with the roll forced to land where the question is about a rider. */
const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  who: CharacterId = GRUM,
  seed = 'hit',
) => unwrap(resolveAttack(fold('seed', log), who, request, supply(seed)), 'attack');

// — the selector ————————————————————————————————————————————————————————————

describe('a selector may name the ability an attack roll uses', () => {
  const problems = (selector: RollSelector) =>
    rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((p) => p.code);

  /** SRD Reckless Attack: "Advantage on attack rolls using Strength". */
  it('allows an ability on an attack roll', () => {
    expect(problems({ roll: 'attack', relation: 'roller', ability: 'str' })).toEqual([]);
  });

  /**
   * And on neither of the two families that have no ability to name: Initiative
   * is granted by name rather than as a Dexterity check, and a death save
   * "isn't tied to an ability score" at all.
   */
  it('still refuses one on Initiative and on a death save', () => {
    expect(problems({ roll: 'death-save', relation: 'roller', ability: 'con' })).toContain(
      'ability_on_ability_less_roll',
    );
    expect(problems({ roll: 'initiative', relation: 'roller', ability: 'dex' })).toContain(
      'ability_on_ability_less_roll',
    );
  });

  it('matches the ability the roll says it was made with, and no other', () => {
    const strength: RollSelector = { roll: 'attack', relation: 'roller', ability: 'str' };
    expect(selectorMatches(strength, GRUM, { family: 'attack', roller: GRUM, ability: 'str' })).toBe(
      true,
    );
    expect(selectorMatches(strength, GRUM, { family: 'attack', roller: GRUM, ability: 'dex' })).toBe(
      false,
    );
    // An attack that named no ability at all is a miss rather than a match:
    // the rule asks a question the roll did not answer.
    expect(selectorMatches(strength, GRUM, { family: 'attack', roller: GRUM })).toBe(false);
  });

  /** A selector that names none still reaches every attack, as it always did. */
  it('leaves an unnarrowed selector reaching the whole family', () => {
    const any: RollSelector = { roll: 'attack', relation: 'roller' };
    expect(selectorMatches(any, GRUM, { family: 'attack', roller: GRUM, ability: 'dex' })).toBe(true);
  });
});

// — Reckless Attack ————————————————————————————————————————————————————————

describe('Reckless Attack buys Advantage on the swings the SRD says it does', () => {
  /**
   * SRD: "Doing so gives you Advantage on attack rolls using Strength until
   * the start of your next turn, but attack rolls against you have Advantage
   * during that time."
   */
  it('gives Advantage on a Strength attack roll', () => {
    const calm = swing(fighting(table()), { target: GOBLIN, weapon: 'greatsword', twoHanded: true });
    const rash = swing(reckless(fighting(table())), {
      target: GOBLIN,
      weapon: 'greatsword',
      twoHanded: true,
    });
    expect(calm.attack!.roll.mode).toBe('normal');
    expect(rash.attack!.roll.mode).toBe('advantage');
  });

  /** "using Strength" — and a rapier swung with Dexterity is not one. */
  it('gives none on the same swing made with Dexterity', () => {
    const rash = swing(reckless(fighting(table())), {
      target: GOBLIN,
      weapon: 'rapier',
      finesseAbility: 'dex',
    });
    expect(rash.attack!.roll.mode).toBe('normal');
  });

  /** The same weapon, the same stance, the other ability: Finesse's own choice. */
  it('gives Advantage on a Finesse weapon used with Strength', () => {
    const rash = swing(reckless(fighting(table())), {
      target: GOBLIN,
      weapon: 'rapier',
      finesseAbility: 'str',
    });
    expect(rash.attack!.roll.mode).toBe('advantage');
  });

  /**
   * The price: "attack rolls against you have Advantage during that time."
   *
   * Outside combat, where the goblin need not wait its turn — the stance is a
   * fact about the Barbarian either way, and the deadline is the test below.
   */
  it('hands the same Advantage to whoever swings back', () => {
    const calm = swing(table(), { target: GRUM, weapon: null }, GOBLIN);
    const against = swing(reckless(table()), { target: GRUM, weapon: null }, GOBLIN);
    expect(calm.attack!.roll.mode).toBe('normal');
    expect(against.attack!.roll.mode).toBe('advantage');
  });

  /** It costs no action and no use: the SRD charges nothing for it. */
  it('costs nothing at all to take', () => {
    const before = fold('seed', fighting(table()));
    const after = fold('seed', reckless(fighting(table())));
    expect(after.creatures.grum!.activeFeatures).toContain(RECKLESS);
    expect(after.combat?.budgets.grum?.bonusAction).toBe(before.combat?.budgets.grum?.bonusAction);
    expect(after.combat?.budgets.grum?.action).toBe(before.combat?.budgets.grum?.action);
  });

  /** "until the start of your next turn" — a round of the order, not two. */
  it('lapses at the start of the Barbarian’s next turn', () => {
    let current = reckless(fighting(table()));
    expect(fold('seed', current).creatures.grum!.activeFeatures).toContain(RECKLESS);
    // Grum's turn ends, the goblin's runs, and Grum's next one begins.
    for (let n = 0; n < 2; n += 1) {
      current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    }
    expect(fold('seed', current).creatures.grum!.activeFeatures).not.toContain(RECKLESS);
  });
});

// — Frenzy ————————————————————————————————————————————————————————————————

describe('Frenzy rides on the stance Reckless Attack puts the Barbarian in', () => {
  const frenzyDice = (state: GameState): string | undefined => {
    const rider = state.creatures.grum!.sheet.standing?.find(
      (effect) => effect.feature === 'berserker:frenzy',
    );
    if (rider?.grant.kind !== 'attack-damage') return undefined;
    return rider.grant.dice;
  };

  /**
   * SRD: "roll a number of d6s equal to your Rage Damage bonus" — the Barbarian
   * table's own column, read at that class's level, which is 2 at level 3.
   */
  it('rolls a d6 per point of Rage Damage, off the class table', () => {
    expect(RAGE_DAMAGE[2]).toBe(2);
    expect(frenzyDice(fold('seed', table()))).toBe('2d6');
  });

  /**
   * SRD: "If you use Reckless Attack **while your Rage is active**, you deal
   * extra damage to the first target you hit on your turn with a Strength-based
   * attack."
   */
  it('deals its dice only with both the Rage and the stance running', () => {
    const spent = (out: { readonly events: readonly GameEvent[] }): boolean =>
      out.events.some((e) => e.type === 'feature-used' && e.feature === 'berserker:frenzy');

    const both = swing(reckless(raging(fighting(table()))), {
      target: GOBLIN,
      weapon: 'greatsword',
      twoHanded: true,
    });
    const rageOnly = swing(raging(fighting(table())), {
      target: GOBLIN,
      weapon: 'greatsword',
      twoHanded: true,
      // **Advantage from the fiction, so the two runs throw the same dice.**
      // The stance grants Advantage and an advantaged attack draws two d20s
      // where a normal one draws one, so a comparison between a stanced swing
      // and an unstanced one is a comparison of two different streams — the
      // greatsword's own dice land a draw apart and the difference between the
      // totals is not the feature. Both roll with Advantage here, so what is
      // left between them is Frenzy and nothing else.
      modes: [{ source: 'the fiction', mode: 'advantage' }],
    });
    const stanceOnly = swing(reckless(fighting(table())), {
      target: GOBLIN,
      weapon: 'greatsword',
      twoHanded: true,
    });

    expect(spent(both)).toBe(true);
    expect(spent(rageOnly)).toBe(false);
    expect(spent(stanceOnly)).toBe(false);

    // **And the dice reach the damage**, which the mark alone does not say.
    // Both swings are advantaged, so the generator is at the same place when
    // the greatsword is thrown and what is left between the totals is the two
    // d6s. What is asserted is the *sentence* — "a number of d6s equal to your
    // Rage Damage bonus" — rather than a number the engine rolled: two dice
    // cannot come to less than 2 or more than 12.
    expect(both.attack!.roll.mode).toBe('advantage');
    expect(rageOnly.attack!.roll.mode).toBe('advantage');
    expect(both.damage! - rageOnly.damage!).toBeGreaterThanOrEqual(2);
    expect(both.damage! - rageOnly.damage!).toBeLessThanOrEqual(12);
  });

  /** "with a Strength-based attack": the rapier in the other hand gets nothing. */
  it('deals nothing on an attack made with Dexterity', () => {
    // Forced to land, because a miss answers nothing about a rider.
    const forced = [{ source: 'forced', flat: 40 }];
    const frenzied = swing(reckless(raging(fighting(table()))), {
      target: GOBLIN,
      weapon: 'rapier',
      finesseAbility: 'dex',
      attackBonuses: forced,
    });
    const calm = swing(raging(fighting(table())), {
      target: GOBLIN,
      weapon: 'rapier',
      finesseAbility: 'dex',
      attackBonuses: forced,
    });
    expect(
      frenzied.events.some((e) => e.type === 'feature-used' && e.feature === 'berserker:frenzy'),
    ).toBe(false);
    // Both have to land, or this is two undefineds agreeing — and the damage is
    // the same number, which is the half the mark cannot say. The two streams
    // align here by construction rather than by arrangement: the stance grants
    // nothing on a Dexterity attack, as the test above asserts, so both swings
    // throw one d20 and the rapier's die follows it in both.
    expect(frenzied.attack!.hit).toBe(true);
    expect(calm.attack!.hit).toBe(true);
    expect(frenzied.damage).toBe(calm.damage);
  });

  /** "the **first** target you hit on your turn": once, and then not again. */
  it('is spent by the first hit of the turn', () => {
    const log = reckless(raging(fighting(table())));
    const first = swing(log, { target: GOBLIN, weapon: 'greatsword', twoHanded: true });
    const second = swing([...log, ...first.events], {
      target: GOBLIN,
      weapon: 'greatsword',
      twoHanded: true,
      free: true,
    });
    expect(first.events.some((e) => e.type === 'feature-used' && e.feature === 'berserker:frenzy')).toBe(
      true,
    );
    expect(
      second.events.some((e) => e.type === 'feature-used' && e.feature === 'berserker:frenzy'),
    ).toBe(false);
  });
});

// — and the same sentence, homebrewed —————————————————————————————————————

/**
 * A homebrew class whose stance narrows to Dexterity rather than Strength,
 * loaded from JSON through the door the book goes through and executed with no
 * engine change.
 */
const DUELLIST = JSON.stringify({
  id: 'duellist',
  name: 'Duellist',
  primaryAbility: 'dex',
  hitDie: 8,
  saveProficiencies: ['dex', 'cha'],
  skillChoices: { choose: 2, from: ['acrobatics', 'athletics', 'insight', 'persuasion'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'rapier', quantity: 1 }], goldPieces: 10 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'duellist:flourish',
      name: 'Flourish',
      level: 1,
      automation: 'engine',
      note: 'A stance costing nothing: Advantage on attack rolls using Dexterity until the start of your next turn.',
      grants: {
        kind: 'activated',
        action: 'none',
        pool: null,
        lasts: 'start-of-next-turn',
        whileActive: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'attack', relation: 'roller', ability: 'dex' },
            },
          },
        ],
      },
    },
  ],
});

describe('a homebrew feature says it with no engine change', () => {
  const parsed = unwrap(parseClassDefinition(JSON.parse(DUELLIST)), 'parse');
  const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');
  const WHO = id('rayne');

  const duellist = (): CharacterChoices => ({
    name: 'Rayne',
    classId: 'duellist',
    level: 1,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 12, dex: 15, con: 13, int: 10, wis: 8, cha: 14 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['acrobatics', 'insight'],
    languages: ['Elvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
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

  const scene = (): readonly GameEvent[] => [
    ...(unwrap(createCharacter(content, duellist(), WHO), 'create') as GameEvent[]),
    { type: 'creature-side-declared', id: WHO, side: 'party' },
    {
      type: 'creature-added',
      id: GOBLIN,
      name: 'goblin',
      sheet: plain(),
      maxHp: 400,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'goblins',
    },
    {
      type: 'items-gained',
      id: WHO,
      items: [{ id: 'mace', quantity: 1 }],
      source: 'loot',
    },
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: GOBLIN,
      placement: { from: { creature: WHO }, feet: 5, bearing: 0 },
    },
    {
      type: 'combat-started',
      combatants: [
        { id: WHO, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];

  it('narrows to the ability its own sentence names', () => {
    const log = scene();
    const stanced: readonly GameEvent[] = [
      ...log,
      ...unwrap(activateFeature(fold('seed', log), WHO, { feature: 'duellist:flourish' }), 'stance'),
    ];
    const out = (weapon: string | null, ability?: 'str' | 'dex') =>
      unwrap(
        resolveAttack(
          fold('seed', stanced),
          WHO,
          {
            target: GOBLIN,
            weapon,
            ...(ability === undefined ? {} : { finesseAbility: ability }),
          },
          { issuer: createRollIssuer('r'), rng: createRng('hit') as Rng, content },
        ),
        'attack',
      );

    expect(out('rapier', 'dex').attack!.roll.mode).toBe('advantage');
    // A Mace is neither Finesse nor ranged, so it is a Strength attack roll
    // and this stance says nothing about one.
    expect(out('mace').attack!.roll.mode).toBe('normal');
  });
});
