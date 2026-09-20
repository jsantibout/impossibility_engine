import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveAttackDamage } from './commands.js';
import { checkCharacter, createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { extendContent, parseClassDefinition } from './content.js';
import { bearingBetween, distanceBetween } from './positioning.js';
import { speedOf } from './standing.js';
import { hasCondition } from './conditions.js';

/**
 * Weapon mastery: the record of which weapons a character has mastery with,
 * and the properties that follow from it.
 *
 * The eight properties have been parsed onto the weapons that print them since
 * the equipment tables landed, and executed by nothing, because the thing they
 * hang off did not exist: **which** weapons this character has mastery with.
 * Five classes print the feature and no choice in the vocabulary could hold its
 * answer — the count is a column of the class table for two of the five and a
 * flat two for the other three, and every `FeatureChoice` takes a fixed
 * `choose`.
 *
 * So this file is about the record first and the properties second, and the
 * properties are deliberately not eight. Nick redirects the extra attack the
 * Light property gives and nothing pays for one; the Long Rest re-choice is an
 * option re-answered, which a choice frozen at creation is not. The other six
 * run on events that already exist: damage on a miss, a second attack roll, a
 * forced move, a Speed grant with a deadline, a saving throw into Prone, and
 * the one-shot roll modifiers Guiding Bolt and Vicious Mockery already spend.
 *
 * **Two of the six are not asked for.** SRD writes "you can" on Cleave, Graze,
 * Push, Slow and Topple, and writes Sap and Vex as things that simply happen —
 * so the first five are a decision the caller states and the last two are read
 * off the weapon. The split is the book's own wording rather than a rule of
 * this engine's, which is why it is asserted here in both directions.
 */

const id = (s: string) => asCharacterId(s);
const BRAM = id('bram'); // the Fighter, who has mastery with rather a lot
const GOBLIN = id('goblin');
const SECOND = id('second'); // another goblin, five feet from the first
const ORC = id('orc');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
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

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  maxHp = 40,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const feeble = {
  abilities: { str: 8, dex: 10, con: 8, int: 10, wis: 8, cha: 8 },
};

const at = (who: CharacterId, from: CharacterId, feet: number, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

const MASTERED = ['greatsword', 'club', 'quarterstaff', 'warhammer', 'shortsword', 'longsword', 'greataxe'];

const table = (over: Partial<CharacterSheet> = {}): readonly GameEvent[] => [
  added(BRAM, 'party', { weaponMasteries: MASTERED, ...over }),
  added(GOBLIN, 'goblins', feeble, 30),
  added(SECOND, 'goblins', feeble, 30),
  { type: 'items-gained', id: BRAM, items: MASTERED.map((i) => ({ id: i, quantity: 1 })), source: 'kit' },
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the road' }, feet: 0 } },
  at(GOBLIN, BRAM, 5, 90),
  at(SECOND, GOBLIN, 5, 0),
];

/**
 * The same table with Initiative rolled.
 *
 * Slow, Sap and Vex all end at a turn boundary, and outside combat there is no
 * boundary to end at — so the three of them are tested where the SRD sentences
 * that name a turn can mean anything.
 */
const fighting = (over: Partial<CharacterSheet> = {}): readonly GameEvent[] => [
  ...table(over),
  {
    type: 'combat-started',
    combatants: [
      { id: BRAM, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: SECOND, initiative: 5, speed: 30 },
    ],
  },
];

/** What the goblin has taken, counted off the hit points it started with. */
const hurt = (state: GameState): number => 30 - (state.creatures[GOBLIN]?.vitals.hp ?? 30);

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  seed = 'swing',
) => {
  const out = unwrap(resolveAttack(fold('seed', log), BRAM, request, supply(seed)), 'attack');
  const next = [...log, ...out.events];
  return { ...out, log: next, state: fold('seed', next) };
};

/**
 * The first seed in a fixed sweep whose attack hits — or misses.
 *
 * The engine rolls the die and the test finds a seed that produced the case it
 * is about; what is asserted afterwards is the *consequence*, which is a static
 * number every time. A test that named a number the engine was going to roll
 * would be asserting the generator rather than the rule.
 */
const seedThat = (
  want: 'hit' | 'miss',
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
): string => {
  for (let n = 0; n < 60; n += 1) {
    const seed = `swing-${n}`;
    const out = unwrap(resolveAttack(fold('seed', log), BRAM, request, supply(seed)), 'probe');
    if (out.attack!.hit === (want === 'hit')) return seed;
  }
  throw new Error(`no seed in the sweep produced a ${want}`);
};

// ——— the record ————————————————————————————————————————————————————————————

const common = {
  speciesId: 'human',
  backgroundId: 'soldier',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
  },
};

const fighter = (level: number, masteries: readonly string[]): CharacterChoices => ({
  ...common,
  name: 'Bram',
  classId: 'fighter',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'intimidation'],
  ...(level >= 3 ? { subclassId: 'champion' } : {}),
  featureChoices: {
    'human:skillful': ['perception'],
    'fighter:weapon-mastery': [...masteries],
  },
  feats: {
    ...common.feats,
    'fighter:fighting-style': { featId: 'defense' },
    ...(level >= 4 ? { 'fighter:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['str', 'str'] } } : {}),
  },
});

const barbarian = (masteries: readonly string[]): CharacterChoices => ({
  ...common,
  name: 'Grim',
  classId: 'barbarian',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'survival'],
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:weapon-mastery': [...masteries],
  },
});

const rogue = (masteries: readonly string[]): CharacterChoices => ({
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { dex: 2, con: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:weapon-mastery': [...masteries],
  },
});

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((p) => p.code);

describe('which weapons a character has mastery with', () => {
  /**
   * The Fighter Features table's own column: three kinds at level 1 and four at
   * 4, where the Rogue's sentence prints a flat two.
   *
   * **The count is a ceiling, not a quota**, which is the SRD's own reading:
   * "Whenever you finish a Long Rest, you can practice weapon drills and change
   * one of those weapon choices." Which weapons a character has mastery with is
   * a standing decision rather than something frozen when the sheet was
   * written, so naming none is a character who has not picked and naming too
   * many is an answer the rules do not allow.
   */
  it('is a ceiling off the class table for the Fighter, and a flat two for the Rogue', () => {
    expect(codes(fighter(1, ['longsword', 'greatsword', 'club']))).toEqual([]);
    expect(codes(fighter(1, ['longsword', 'greatsword']))).toEqual([]);
    expect(codes(fighter(1, ['longsword', 'greatsword', 'club', 'mace']))).toContain(
      'too_many_masteries',
    );
    expect(codes(fighter(4, ['longsword', 'greatsword', 'club', 'mace']))).toEqual([]);

    expect(codes(rogue(['dagger', 'shortsword']))).toEqual([]);
    expect(codes(rogue(['dagger', 'shortsword', 'club']))).toContain('too_many_masteries');
  });

  it('lands on the sheet, where an attack can read it', () => {
    const planned = unwrap(planCharacter(SRD_CONTENT, fighter(1, ['longsword', 'greatsword', 'club'])), 'plan');
    expect(planned.sheet.weaponMasteries).toEqual(['club', 'greatsword', 'longsword']);

    // And a character whose class prints no such feature carries none at all.
    const none = unwrap(planCharacter(SRD_CONTENT, rogue(['dagger', 'shortsword'])), 'plan');
    expect(none.sheet.weaponMasteries).toEqual(['dagger', 'shortsword']);
  });

  it('refuses a weapon the character is not proficient with', () => {
    // SRD Rogue: "two kinds of weapons of your choice **with which you have
    // proficiency**" — and a Rogue is proficient with Simple weapons and a
    // short list of Martial ones, of which a Greatsword is not one.
    expect(codes(rogue(['dagger', 'greatsword']))).toContain('weapon_not_mastered');
  });

  it('refuses a ranged weapon where the class says Melee', () => {
    // SRD Barbarian: "two kinds of Simple or Martial **Melee** weapons".
    expect(codes(barbarian(['greataxe', 'handaxe']))).toEqual([]);
    expect(codes(barbarian(['greataxe', 'shortbow']))).toContain('weapon_not_mastered');
  });

  it('refuses something that is not a weapon, and the same weapon twice', () => {
    expect(codes(fighter(1, ['longsword', 'greatsword', 'rope']))).toContain('weapon_not_mastered');
    expect(codes(fighter(1, ['longsword', 'longsword', 'club']))).toContain('weapon_not_mastered');
  });

  it('is created end to end, and the creature carries it', () => {
    const log = unwrap(createCharacter(SRD_CONTENT, fighter(1, ['longsword', 'greatsword', 'club']), BRAM), 'create');
    const state: GameState = fold('seed', log as GameEvent[]);
    expect(state.creatures[BRAM]?.sheet.weaponMasteries).toEqual(['club', 'greatsword', 'longsword']);
  });
});

// ——— the properties ————————————————————————————————————————————————————————

describe('Graze', () => {
  /**
   * SRD: "If your attack roll with this weapon misses a creature, you can deal
   * damage to that creature equal to the ability modifier you used to make the
   * attack roll."
   *
   * The static number this file exists to assert: four, off a Strength of 18,
   * and not a die anywhere in it.
   */
  it('deals the ability modifier on a miss, and nothing without the mastery', () => {
    const log = table();
    const request = { target: GOBLIN, weapon: 'greatsword', mastery: {} } as const;
    const seed = seedThat('miss', log, request);

    const grazed = swing(log, request, seed);
    expect(grazed.attack!.hit).toBe(false);
    expect(hurt(grazed.state)).toBe(4);

    // The same miss, from a Fighter who has mastery with something else: the
    // property is refused rather than quietly skipped, and the swing without
    // it deals nothing.
    const untrained = table({ weaponMasteries: ['club'] });
    const refused = resolveAttack(fold('seed', untrained), BRAM, request, supply(seed));
    expect(isErr(refused) ? refused.code : 'ok').toBe('no_mastery');
    const plain = swing(untrained, { target: GOBLIN, weapon: 'greatsword' }, seed);
    expect(plain.attack!.hit).toBe(false);
    expect(hurt(plain.state)).toBe(0);

    // And not when nobody asked for it: SRD writes "you can".
    const declined = swing(log, { target: GOBLIN, weapon: 'greatsword' }, seed);
    expect(hurt(declined.state)).toBe(0);
  });
});

describe('Slow', () => {
  /**
   * SRD: "If you hit a creature with this weapon and deal damage to it, you can
   * reduce its Speed by 10 feet until the start of your next turn. If the
   * creature is hit more than once by weapons that have this property, the
   * Speed reduction doesn't exceed 10 feet."
   */
  it('takes ten feet off the target’s Speed, once however often it lands', () => {
    const log = fighting();
    const request = { target: GOBLIN, weapon: 'club', mastery: {} } as const;
    const seed = seedThat('hit', log, request);

    const before = speedOf(fold('seed', log), GOBLIN);
    const hit = swing(log, request, seed);
    expect(hit.attack!.hit).toBe(true);
    expect(speedOf(hit.state, GOBLIN)).toBe(before - 10);

    // Twice is still ten feet: one source, re-granted rather than stacked. The
    // second swing is free, because what is being tested is the grant and not
    // how many attacks an Attack action holds.
    const second = { ...request, free: true } as const;
    const again = swing(hit.log, second, seedThat('hit', hit.log, second));
    expect(speedOf(again.state, GOBLIN)).toBe(before - 10);
  });
});

describe('Topple', () => {
  /**
   * SRD: "you can force the creature to make a Constitution saving throw (DC 8
   * plus the ability modifier used to make the attack roll and your Proficiency
   * Bonus). On a failed save, the creature has the Prone condition."
   */
  it('asks for a Constitution save and lays the target out when it fails', () => {
    const log = table();
    const request = { target: GOBLIN, weapon: 'quarterstaff', mastery: {} } as const;
    const seed = seedThat('hit', log, request);
    const out = swing(log, request, seed);

    const save = out.events.find(
      (e) => e.type === 'roll-recorded' && e.label.toLowerCase().includes('topple'),
    );
    expect(save).toBeDefined();
    if (save?.type !== 'roll-recorded') throw new Error('no save was recorded');

    // 8 + the Strength modifier the swing used (+4, off an 18) + the
    // Proficiency Bonus of a level 5 character (+3) = 15. Asserted through the
    // outcome, which is the only place the DC is visible from here — and it is
    // the whole rule: a save that came to 15 stands up and one that came to 14
    // does not.
    expect(save.outcome === 'stayed up').toBe(save.total >= 15);

    const prone = hasCondition(out.state.creatures[GOBLIN]!.conditions, 'prone');
    expect(prone).toBe(save.outcome === 'knocked down');
  });
});

describe('Push', () => {
  /**
   * SRD: "you can push the creature up to 10 feet straight away from yourself
   * if it is Large or smaller."
   */
  it('moves the target ten feet further away, and says so as a forced move', () => {
    const log = table();
    const request = { target: GOBLIN, weapon: 'warhammer', mastery: {} } as const;
    const seed = seedThat('hit', log, request);

    const apart = unwrap(distanceBetween(fold('seed', log).scene!, BRAM, GOBLIN), 'apart');
    const out = swing(log, request, seed);
    const moved = out.events.find((e) => e.type === 'creature-moved');
    expect(moved?.type === 'creature-moved' ? moved.forced : undefined).toBe(true);
    expect(unwrap(distanceBetween(out.state.scene!, BRAM, GOBLIN), 'after')).toBe(apart + 10);

    // "up to 10 feet" — the attacker may push less.
    const gentle = swing(log, { target: GOBLIN, weapon: 'warhammer', mastery: { feet: 5 } }, seed);
    expect(unwrap(distanceBetween(gentle.state.scene!, BRAM, GOBLIN), 'after')).toBe(apart + 5);

    // And not more, nor a distance on a property that moves nobody — both
    // refused before the attack roll rather than after the damage.
    const heaved = resolveAttack(
      fold('seed', log),
      BRAM,
      { target: GOBLIN, weapon: 'warhammer', mastery: { feet: 15 } },
      supply(),
    );
    expect(isErr(heaved) ? heaved.code : 'ok').toBe('bad_amount');
    const confused = resolveAttack(
      fold('seed', log),
      BRAM,
      { target: GOBLIN, weapon: 'club', mastery: { feet: 5 } },
      supply(),
    );
    expect(isErr(confused) ? confused.code : 'ok').toBe('bad_amount');
  });

  /**
   * A shove into a wall is a shove that does not happen.
   *
   * `creature-moved` is applied by the fold through `must`, so an event the
   * scene would refuse is a log nobody can fold — the failure this repository
   * names as the worst kind, a refusal thrown rather than returned. The push is
   * asked of the scene before it is written down.
   */
  it('does not write a move the scene would refuse', () => {
    const boxed: readonly GameEvent[] = [
      added(BRAM, 'party', { weaponMasteries: MASTERED }),
      added(GOBLIN, 'goblins', feeble, 30),
      { type: 'items-gained', id: BRAM, items: [{ id: 'warhammer', quantity: 1 }], source: 'kit' },
      { type: 'scene-set', extent: { width: 10, depth: 10, height: 10 } },
      { type: 'landmark-added', name: 'the cell', at: { x: 0, y: 0, z: 0 } },
      { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the cell' }, feet: 0 } },
      at(GOBLIN, BRAM, 5, 90),
    ];
    const request = { target: GOBLIN, weapon: 'warhammer', mastery: {} } as const;
    const out = swing(boxed, request, seedThat('hit', boxed, request));

    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(out.unverified.join(' ')).toContain('could not be pushed');
    // And the log still folds, which is the whole point.
    expect(out.state.creatures[GOBLIN]).toBeDefined();
  });

  /**
   * "if it is **Large or smaller**" — a size the log may never have stated.
   * Medium is what the map assumes, and the assumption is reported rather than
   * hidden, because a creature nobody has sized may be a Gargantuan one.
   */
  it('reports the size nobody declared rather than pretending to know it', () => {
    const log = table();
    const request = { target: GOBLIN, weapon: 'warhammer', mastery: {} } as const;
    const out = swing(log, request, seedThat('hit', log, request));
    expect(out.unverified.join(' ')).toContain('big');

    const sized = [
      ...table().map((e) =>
        e.type === 'creature-added' && e.id === GOBLIN ? { ...e, size: 'small' as const } : e,
      ),
    ];
    const known = swing(sized, request, seedThat('hit', sized, request));
    expect(known.unverified.join(' ')).not.toContain('big');

    const huge = [
      ...table().map((e) =>
        e.type === 'creature-added' && e.id === GOBLIN ? { ...e, size: 'huge' as const } : e,
      ),
    ];
    const immovable = swing(huge, request, seedThat('hit', huge, request));
    expect(immovable.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(immovable.unverified.join(' ')).toContain('Large');
  });
});

describe('Sap and Vex', () => {
  /**
   * SRD Sap: "that creature has Disadvantage on its next attack roll before the
   * start of your next turn." SRD Vex: "you have Advantage on your next attack
   * roll against that creature before the end of your next turn."
   *
   * Neither says "you can", so neither is asked for: both are read off the
   * weapon the way the damage die is.
   */
  it('hang a one-shot modifier on the right creature without being asked', () => {
    const log = fighting();
    const sap = { target: GOBLIN, weapon: 'longsword' } as const;
    const sapped = swing(log, sap, seedThat('hit', log, sap));
    const onGoblin = sapped.state.creatures[GOBLIN]?.rollModifiers ?? [];
    expect(onGoblin.map((m) => m.modifier.mode)).toEqual(['disadvantage']);
    expect(onGoblin[0]?.modifier.oneShot).toBe(true);
    expect(onGoblin[0]?.modifier.selector.relation).toBe('roller');

    const vex = { target: GOBLIN, weapon: 'shortsword' } as const;
    const vexed = swing(log, vex, seedThat('hit', log, vex));
    const onBram = vexed.state.creatures[BRAM]?.rollModifiers ?? [];
    expect(onBram.map((m) => m.modifier.mode)).toEqual(['advantage']);
    expect(onBram[0]?.modifier.selector.counterpart).toBe(GOBLIN);

    // And a miss hangs nothing: both sentences begin "If you hit a creature".
    const missed = swing(log, vex, seedThat('miss', log, vex));
    expect(missed.state.creatures[BRAM]?.rollModifiers ?? []).toEqual([]);
  });
});

describe('Cleave', () => {
  /**
   * SRD: "If you hit a creature with a melee attack roll using this weapon, you
   * can make a melee attack roll with the weapon against a second creature
   * within 5 feet of the first that is also within your reach. On a hit, the
   * second creature takes the weapon's damage, but don't add your ability
   * modifier to that damage unless that modifier is negative. You can make this
   * extra attack only once per turn."
   */
  it('swings again at a second creature, without the ability modifier', () => {
    const log = fighting();
    const first = { target: GOBLIN, weapon: 'greataxe' } as const;
    const opened = swing(log, first, seedThat('hit', log, first));
    expect(opened.attack!.hit).toBe(true);

    const cleave = { target: SECOND, weapon: 'greataxe', mastery: { cleaving: GOBLIN } } as const;
    const seed = seedThat('hit', opened.log, cleave);
    const after = swing(opened.log, cleave, seed);
    expect(after.attack!.hit).toBe(true);

    // The weapon's die and nothing else. Measured against the same seed swung
    // *without* the Cleave, which throws the identical die and adds the
    // Strength modifier to it: the difference is four, every time.
    const dealt = 30 - after.state.creatures[SECOND]!.vitals.hp;
    const ordinary = swing(opened.log, { target: SECOND, weapon: 'greataxe', free: true }, seed);
    expect(ordinary.attack!.hit).toBe(true);
    expect(30 - ordinary.state.creatures[SECOND]!.vitals.hp).toBe(dealt + 4);

    // Once per turn, and the turn is the one the log is on.
    const twice = resolveAttack(after.state, BRAM, cleave, supply(seed));
    expect(isErr(twice) ? twice.code : 'ok').toBe('already_cleaved');
  });

  /**
   * "Only once per turn", where there are no turns.
   *
   * The same answer Slow, Sap and Vex give to the same absence: the swing
   * happened, and what could not be counted is reported rather than passed off
   * as counted.
   */
  it('says it cannot count its allowance outside combat', () => {
    const log = table();
    const first = { target: GOBLIN, weapon: 'greataxe' } as const;
    const opened = swing(log, first, seedThat('hit', log, first));
    const cleave = { target: SECOND, weapon: 'greataxe', mastery: { cleaving: GOBLIN } } as const;
    const out = swing(opened.log, cleave, seedThat('hit', opened.log, cleave));
    expect(out.unverified.join(' ')).toContain('no turns outside combat');
  });

  /**
   * And in combat the allowance is spent by **making** the attack: SRD says
   * "you can make this extra attack only once per turn", not "only once it
   * lands", so a Cleave that misses has still been made.
   */
  it('spends its allowance on a swing that misses', () => {
    const log = fighting();
    const first = { target: GOBLIN, weapon: 'greataxe' } as const;
    const opened = swing(log, first, seedThat('hit', log, first));

    const cleave = { target: SECOND, weapon: 'greataxe', mastery: { cleaving: GOBLIN } } as const;
    const missed = swing(opened.log, cleave, seedThat('miss', opened.log, cleave));
    expect(missed.attack!.hit).toBe(false);

    const again = resolveAttack(missed.state, BRAM, cleave, supply());
    expect(isErr(again) ? again.code : 'ok').toBe('already_cleaved');
  });

  it('refuses the creature it already hit', () => {
    const log = fighting();
    const first = { target: GOBLIN, weapon: 'greataxe' } as const;
    const opened = swing(log, first, seedThat('hit', log, first));
    const again = resolveAttack(
      opened.state,
      BRAM,
      { target: GOBLIN, weapon: 'greataxe', mastery: { cleaving: GOBLIN }, free: true },
      supply(),
    );
    expect(isErr(again) ? again.code : 'ok').toBe('same_target');
  });

  it('refuses a second creature that is not beside the first', () => {
    const log = [...table(), added(ORC, 'goblins', feeble, 30), at(ORC, GOBLIN, 20, 90)];

    const first = { target: GOBLIN, weapon: 'greataxe' } as const;
    const opened = swing(log, first, seedThat('hit', log, first));
    const out = resolveAttack(
      opened.state,
      BRAM,
      { target: ORC, weapon: 'greataxe', mastery: { cleaving: GOBLIN } },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_reach');
  });
});

/**
 * The vocabulary rather than the five classes: a homebrew class that unlocks a
 * weapon's mastery property and lets its holder swap one, created and swung
 * through the public API with no engine change.
 *
 * Both new members at once, because they are one feature's two halves — the
 * choice that says which weapons and the grant that says what having them is
 * worth — and a `chooseByLevel` column read at the class's own level.
 */
describe('a homebrew class that unlocks a mastery property', () => {
  const DUELLIST = JSON.stringify({
    id: 'duellist',
    name: 'Duellist',
    primaryAbility: 'dex',
    hitDie: 8,
    saveProficiencies: ['dex', 'int'],
    skillChoices: { choose: 2, from: ['acrobatics', 'athletics', 'insight', 'performance'] },
    weaponProficiencies: ['simple', 'martial'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    // No subclass at all, so the fixture is about the two new members and
    // nothing else.
    subclassLevel: 20,
    table: Array.from({ length: 20 }, (_, i) => ({
      level: i + 1,
      proficiencyBonus: 2 + Math.floor(i / 4),
    })),
    startingEquipment: [
      { option: 'A', items: [{ id: 'warhammer', quantity: 1 }], goldPieces: 10 },
    ],
    multiclass: {
      weapons: ['martial'],
      armorTraining: { light: true, medium: false, heavy: false, shields: false },
      tools: [],
    },
    features: [
      {
        id: 'duellist:practised-forms',
        name: 'Practised Forms',
        level: 1,
        automation: 'engine',
        note: 'One kind of weapon at level 1 and two from level 5, whose mastery property this Duellist may use — and, because a duellist improvises, may trade for Topple on any given swing.',
        grants: { kind: 'weapon-mastery', substitutes: ['topple'] },
        choice: {
          kind: 'weapon',
          chooseByLevel: Array.from({ length: 20 }, (_, i) => (i + 1 >= 5 ? 2 : 1)),
        },
      },
    ],
  });

  const duellist = (level: number, masteries: readonly string[]): CharacterChoices => ({
    ...common,
    name: 'Vane',
    classId: 'duellist',
    level,
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { str: 2, con: 1 },
    classSkills: ['acrobatics', 'athletics'],
    featureChoices: {
      'human:skillful': ['perception'],
      'duellist:practised-forms': [...masteries],
    },
    feats: common.feats,
  });

  const parsed = unwrap(parseClassDefinition(JSON.parse(DUELLIST)), 'parse');
  const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');
  const VANE = id('vane');

  it('reads its column, lands on the sheet and runs on the swing', () => {
    // One at level 1, two at 5 — the column, read at this class's own level.
    expect(checkCharacter(content, duellist(1, ['warhammer'])).map((p) => p.code)).toEqual([]);
    expect(
      checkCharacter(content, duellist(1, ['warhammer', 'club'])).map((p) => p.code),
    ).toContain('too_many_masteries');
    expect(
      checkCharacter(content, duellist(5, ['warhammer', 'club'])).map((p) => p.code),
    ).toEqual([]);

    const planned = unwrap(planCharacter(content, duellist(1, ['warhammer'])), 'plan');
    expect(planned.sheet.weaponMasteries).toEqual(['warhammer']);
    expect(planned.sheet.masterySubstitutions).toEqual(['topple']);

    const log: GameEvent[] = [
      ...(unwrap(createCharacter(content, duellist(1, ['warhammer']), VANE), 'create') as GameEvent[]),
      added(GOBLIN, 'goblins', feeble, 30),
      { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
      { type: 'landmark-added', name: 'the yard', at: { x: 500, y: 500, z: 0 } },
      { type: 'creature-placed', id: VANE, placement: { from: { landmark: 'the yard' }, feet: 0 } },
      at(GOBLIN, VANE, 5, 90),
    ];

    // The weapon's own property: a Warhammer pushes.
    const pushing = { target: GOBLIN, weapon: 'warhammer', mastery: {} } as const;
    let seed = '';
    for (let n = 0; n < 60 && seed === ''; n += 1) {
      const probe = unwrap(
        resolveAttack(fold('seed', log), VANE, pushing, supply(`duel-${n}`)),
        'probe',
      );
      if (probe.attack!.hit) seed = `duel-${n}`;
    }
    const shoved = unwrap(resolveAttack(fold('seed', log), VANE, pushing, supply(seed)), 'push');
    expect(shoved.events.some((e) => e.type === 'creature-moved')).toBe(true);

    // And the one its own feature offers instead.
    const tripping = unwrap(
      resolveAttack(
        fold('seed', log),
        VANE,
        { target: GOBLIN, weapon: 'warhammer', mastery: { property: 'topple' } },
        supply(seed),
      ),
      'topple',
    );
    expect(
      tripping.events.some(
        (e) => e.type === 'roll-recorded' && e.label.toLowerCase().includes('topple'),
      ),
    ).toBe(true);
    expect(tripping.events.some((e) => e.type === 'creature-moved')).toBe(false);
  });
});

/**
 * The half of the attack path a rider is easiest to forget.
 *
 * `resolveAttack` can hold its hit so a Divine Smite can land between the roll
 * and the damage, and `resolveAttackDamage` settles it a command later. A
 * mastery wired into the first and not the second would be a rule a Smite
 * silently switched off, so the property is pinned into the hold and both
 * halves run the same rider off it.
 */
describe('a held hit', () => {
  it('still topples, off the property the hold pinned', () => {
    const log = fighting();
    const request = { target: GOBLIN, weapon: 'quarterstaff', mastery: {}, hold: true } as const;
    const seed = seedThat('hit', log, request);

    const held = swing(log, request, seed);
    expect(held.attack!.hit).toBe(true);
    expect(held.state.pendingAttack?.mastery?.property).toBe('topple');
    // Nothing has happened to the goblin yet: the damage is not rolled.
    expect(hurt(held.state)).toBe(0);

    const settled = unwrap(
      resolveAttackDamage(held.state, BRAM, {}, supply(seed)),
      'damage',
    );
    const after = fold('seed', [...held.log, ...settled.events]);
    const save = settled.events.find(
      (e) => e.type === 'roll-recorded' && e.label.toLowerCase().includes('topple'),
    );
    expect(save).toBeDefined();
    if (save?.type !== 'roll-recorded') throw new Error('no save was recorded');
    expect(hasCondition(after.creatures[GOBLIN]!.conditions, 'prone')).toBe(
      save.outcome === 'knocked down',
    );
  });
});

/**
 * The direction Push needed and nothing had.
 *
 * `project` turns a bearing into a point and is private; this is the other
 * direction, and the one thing it cannot answer is the one thing a Push does
 * not need — two creatures sharing a space have no direction between them.
 */
describe('the bearing between two creatures', () => {
  it('is the one a placement means, and refuses a space shared', () => {
    const scene = fold('seed', table()).scene!;
    // The goblin is due east of the Fighter, which `at` placed it at.
    expect(unwrap(bearingBetween(scene, BRAM, GOBLIN), 'east')).toBe(90);
    expect(unwrap(bearingBetween(scene, GOBLIN, BRAM), 'west')).toBe(270);

    const shared = bearingBetween(scene, BRAM, BRAM);
    expect(isErr(shared) ? shared.code : 'ok').toBe('same_space');
  });
});

describe('a mastery nobody has', () => {
  it('is refused rather than quietly ignored', () => {
    const log = table({ weaponMasteries: ['club'] });
    const out = resolveAttack(
      fold('seed', log),
      BRAM,
      { target: GOBLIN, weapon: 'greatsword', mastery: {} },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('no_mastery');
  });

  /**
   * SRD Tactical Master: "when you attack with a weapon, you can replace its
   * mastery property with Push, Sap, or Slow" — the substitution list the
   * record carries as its other shape.
   */
  it('may be substituted where a feature says it may', () => {
    const log = table({ masterySubstitutions: ['push', 'sap', 'slow'] });
    const request = { target: GOBLIN, weapon: 'greatsword', mastery: { property: 'push' } } as const;
    const out = swing(log, request, seedThat('hit', log, request));
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(true);

    // And not one the feature does not offer.
    const refused = resolveAttack(
      fold('seed', log),
      BRAM,
      { target: GOBLIN, weapon: 'greatsword', mastery: { property: 'topple' } },
      supply(),
    );
    expect(isErr(refused) ? refused.code : 'ok').toBe('no_mastery');
  });
});
