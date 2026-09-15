import { readFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import type { CharacterSheet } from './character.js';
import type { Armor } from '@ie/srd';
import { fold, type GameEvent, type GameState } from './events.js';
import { combineSpeed, movementLeftFor, speedOf, type StandingEffect } from './standing.js';
import { conditionSpeed, conditionState } from './conditions.js';
import { planCharacter, type CharacterChoices } from './creation.js';
import {
  applyConditionTo,
  mountCreature,
  resolveMove,
  setExhaustionLevel,
  takeDash,
} from './commands.js';

/**
 * One reader for Speed.
 *
 * Every allowance in the game is measured against a creature's Speed, and
 * there were three spellings of it — `spendMovement`'s cap, `dash`'s increase
 * and `releaseMove`'s allowance — none of which could see a class feature. A
 * Barbarian's Fast Movement said so in its own note: *"The +10 feet of Speed
 * while unarmoured is not applied; Speed comes from the species and nothing
 * modifies it."*
 *
 * The order is the architect's, because the SRD prints none:
 *
 * > base, plus flat changes (features, and Exhaustion's −5 per level), then
 * > **halved once** if any halving effect applies (presence, not count), then
 * > **0** if any zeroing effect applies, never below 0.
 *
 * The SRD lines behind it:
 *
 * | | |
 * |---|---|
 * | Exhaustion | "Your Speed is reduced by a number of feet equal to 5 times your Exhaustion level." |
 * | Grappled, Restrained | "Your Speed is 0 **and can't increase**." |
 * | Fast Movement (Barbarian 5) | "Your speed increases by 10 feet while you aren't wearing Heavy armor." |
 * | Unarmored Movement (Monk 2) | "Your speed increases by 10 feet while you aren't wearing armor or wielding a Shield. This bonus increases when you reach certain Monk levels." |
 * | Roving (Ranger 6) | "Your Speed increases by 10 feet while you aren't wearing Heavy armor." |
 */

const id = (s: string) => asCharacterId(s);
const KESS = id('kess');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/** SRD Chain Mail: Heavy armour, which is what Fast Movement's clause names. */
const CHAIN_MAIL: Armor = {
  id: 'chain-mail',
  name: 'Chain Mail',
  category: 'heavy',
  baseAc: 16,
  acBonus: null,
  addsDexModifier: false,
  maxDexBonus: null,
  strengthRequirement: 13,
  stealthDisadvantage: true,
  weightLb: 55,
  cost: { amount: 75, currency: 'gp' },
};

/**
 * SRD Chain Shirt: **Medium** armour, and the discriminating piece.
 *
 * Fast Movement reads "while you aren't wearing Heavy armor" and Unarmored
 * Movement reads "while you aren't wearing armor" — so a Barbarian in this
 * keeps their ten feet and a Monk in it does not. Plate against nothing tells
 * the two clauses apart in neither direction.
 */
const CHAIN_SHIRT: Armor = {
  id: 'chain-shirt',
  name: 'Chain Shirt',
  category: 'medium',
  baseAc: 13,
  acBonus: null,
  addsDexModifier: true,
  maxDexBonus: 2,
  strengthRequirement: null,
  stealthDisadvantage: false,
  weightLb: 20,
  cost: { amount: 50, currency: 'gp' },
};

/** A Shield, for the half of Unarmored Movement's clause that is not armour. */
const SHIELD: Armor = {
  id: 'shield',
  name: 'Shield',
  category: 'shield',
  baseAc: null,
  acBonus: 2,
  addsDexModifier: false,
  maxDexBonus: null,
  strengthRequirement: null,
  stealthDisadvantage: false,
  weightLb: 6,
  cost: { amount: 10, currency: 'gp' },
};

/** SRD Fast Movement, as creation hands it to the sheet. */
const fastMovement: StandingEffect = {
  feature: 'barbarian:fast-movement',
  name: 'Fast Movement',
  reach: { kind: 'self' },
  grant: { kind: 'speed', feet: 10 },
  requires: [{ kind: 'not-wearing-heavy-armor' }],
};

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const stateWith = (over: Partial<CharacterSheet> = {}, extra: readonly GameEvent[] = []): GameState =>
  fold('seed', [added(KESS, over), ...extra]);

describe('speedOf', () => {
  it('is the base Speed for a creature nothing has touched', () => {
    expect(speedOf(stateWith(), KESS)).toBe(30);
  });

  it('adds a feature grant whose requirement holds', () => {
    expect(speedOf(stateWith({ standing: [fastMovement] }), KESS)).toBe(40);
  });

  it('withholds it while the feature’s own clause does not hold', () => {
    // SRD Fast Movement: "while you aren't wearing Heavy armor."
    expect(speedOf(stateWith({ standing: [fastMovement], armor: CHAIN_MAIL }), KESS)).toBe(30);
  });

  /**
   * The clause is Heavy armour and not "unarmoured", and only a Medium suit
   * can tell those two readings apart.
   */
  it('keeps Fast Movement in Medium armour', () => {
    expect(speedOf(stateWith({ standing: [fastMovement], armor: CHAIN_SHIRT }), KESS)).toBe(40);
  });

  /**
   * SRD Unarmored Movement: "while you aren't wearing armor **or wielding a
   * Shield**." Both halves, and the Shield is the half a clause written about
   * armour alone loses.
   */
  it('withholds Unarmored Movement for armour and for a Shield alike', () => {
    const unarmoredMovement: StandingEffect = {
      feature: 'monk:unarmored-movement',
      name: 'Unarmored Movement',
      reach: { kind: 'self' },
      grant: { kind: 'speed', feet: 10 },
      requires: [{ kind: 'unarmored' }],
    };
    expect(speedOf(stateWith({ standing: [unarmoredMovement] }), KESS)).toBe(40);
    expect(speedOf(stateWith({ standing: [unarmoredMovement], armor: CHAIN_SHIRT }), KESS)).toBe(30);
    expect(speedOf(stateWith({ standing: [unarmoredMovement], shield: SHIELD }), KESS)).toBe(30);
  });

  /**
   * The composition the brief names: base + 10 − 10.
   *
   * Both halves are flat, and they are applied in the same step, so a
   * Barbarian 5 with two levels of Exhaustion is back at their printed Speed
   * rather than at 40 or at 20.
   */
  it('composes Exhaustion 2 with Fast Movement as base + 10 − 10', () => {
    const state = stateWith({ standing: [fastMovement] });
    const after = fold('seed', [
      added(KESS, { standing: [fastMovement] }),
      ...unwrap(setExhaustionLevel(state, KESS, 2), 'exhaustion'),
    ]);
    expect(speedOf(after, KESS)).toBe(30);
  });

  /**
   * SRD Grappled and Restrained both print "Your Speed is 0 **and can't
   * increase**", which is the whole reason zero is applied last and wins.
   */
  it('is 0 while a condition pins the creature, however much a feature adds', () => {
    const state = stateWith({ standing: [fastMovement] });
    const after = fold('seed', [
      added(KESS, { standing: [fastMovement] }),
      ...unwrap(applyConditionTo(state, KESS, 'grappled', 'a net'), 'grappled'),
    ]);
    expect(speedOf(after, KESS)).toBe(0);
  });

  it('answers 0 for a creature with no record here', () => {
    expect(speedOf(stateWith(), id('nobody'))).toBe(0);
  });
});

/**
 * The combiner is pure over its inputs, which is what lets the halving step be
 * driven at all: nothing in the engine halves a Speed yet — IE-033's spell
 * grant is the first thing that will — so the branch is reached the way
 * `restoreOn`'s Short Rest branch is, by handing the pure function the case.
 */
describe('combineSpeed', () => {
  const none = conditionState();

  it('halves once however many halving effects apply', () => {
    // "Presence, not count" — the reading Resistance and Advantage already take.
    expect(combineSpeed(30, 0, 1, false, none)).toBe(15);
    expect(combineSpeed(30, 0, 2, false, none)).toBe(15);
    expect(combineSpeed(30, 0, 5, false, none)).toBe(15);
  });

  it('halves after the flat changes, not before them', () => {
    // base 30 + 10 = 40, halved = 20. Halving first would give 15 + 10 = 25.
    expect(combineSpeed(30, 10, 1, false, none)).toBe(20);
  });

  it('rounds a halved odd Speed down', () => {
    expect(combineSpeed(25, 0, 1, false, none)).toBe(12);
  });

  it('never goes below 0', () => {
    expect(combineSpeed(30, -50, 0, false, none)).toBe(0);
    expect(combineSpeed(30, -50, 1, false, none)).toBe(0);
  });
});

/**
 * The multiclass fixture is the discriminating one for a per-class table: a
 * Monk 2 / Fighter 3 is a level 5 character whose Unarmored Movement is read
 * at **Monk** level 2 and is therefore +10, not the +10 a level 5 Monk would
 * have. A single-class fixture cannot tell the two numbers apart — the lesson
 * `poolSizeOf` already carries.
 */
describe('Unarmored Movement is read at the Monk’s own level', () => {
  const monk = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
    name: 'Nim',
    classId: 'monk',
    level: 6,
    speciesId: 'human',
    backgroundId: 'sage',
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    abilities: {
      method: 'standard-array',
      assignment: { str: 13, dex: 15, con: 12, int: 8, wis: 14, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['acrobatics', 'stealth'],
    subclassId: 'warrior-of-the-open-hand',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
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
      'monk:ability-score-improvement': { featId: 'savage-attacker' },
    },
    classEquipment: 'A',
    backgroundEquipment: 'A',
    // Unarmoured and holding no Shield, which is the feature's own clause.
    equipped: [],
    hitPoints: { method: 'fixed' },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    ...over,
  });

  const speedFeetOf = (choices: CharacterChoices): number => {
    const plan = unwrap(planCharacter(SRD_CONTENT,choices), 'plan');
    const state = fold('seed', [
      {
        type: 'creature-added',
        id: KESS,
        name: 'Nim',
        sheet: plan.sheet,
        maxHp: 30,
        diesAtZero: false,
        creatureType: 'Humanoid',
      },
    ]);
    return speedOf(state, KESS);
  };

  it('gives a Monk 6 the +15 the table prints, not the +10 of level 2', () => {
    expect(speedFeetOf(monk())).toBe(45);
  });

  it('gives a Monk 2 / Fighter 3 the Monk’s +10, not a level 5 character’s', () => {
    const multiclassed = monk({
      level: 2,
      // A Monk chooses a subclass at 3, and this Monk is level 2.
      subclassId: undefined,
      multiclass: [{ classId: 'fighter', level: 3 }],
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
        'human:versatile': { featId: 'alert' },
        'fighter:fighting-style': { featId: 'defense' },
      },
    });
    expect(unwrap(planCharacter(SRD_CONTENT,multiclassed), 'plan').sheet.level).toBe(5);
    // A level 5 *Monk* would also have +10, so the discriminating pair is this
    // fixture against the Monk 6 above: read at character level, a Monk 2 /
    // Fighter 4 would reach the table's +15 row and be wrong by 5 feet.
    expect(speedFeetOf(multiclassed)).toBe(40);
  });

  it('reads the Monk table at Monk level for a Monk 2 / Fighter 4', () => {
    const deeper = monk({
      level: 2,
      subclassId: undefined,
      multiclass: [{ classId: 'fighter', level: 4 }],
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
        'human:versatile': { featId: 'alert' },
        'fighter:fighting-style': { featId: 'defense' },
        'fighter:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });
    expect(unwrap(planCharacter(SRD_CONTENT,deeper), 'plan').sheet.level).toBe(6);
    // Character level 6 is the Monk table's +15 row; Monk level 2 is +10.
    expect(speedFeetOf(deeper)).toBe(40);
  });
});

/**
 * One change, three allowances.
 *
 * The brief's second acceptance criterion: a Monk's Unarmored Movement raises
 * the movement allowance, the Dash and the mounting cost from one change. Two
 * of the three arrive; the third is `dash`'s and is pinned below at the number
 * it actually gives, because that increase is derived inside the fold.
 */
describe('a feature grant reaches the command layer', () => {
  const MONK = id('monk');
  const HORSE = id('horse');

  const unarmoredMovement: StandingEffect = {
    feature: 'monk:unarmored-movement',
    name: 'Unarmored Movement',
    reach: { kind: 'self' },
    grant: { kind: 'speed', feet: 10 },
    requires: [{ kind: 'unarmored' }],
  };

  /**
   * The Monk is pinned at their printed 30 in the Initiative order, which is
   * what `speedOf` reads as its base inside a fight. The feature
   * is what makes the *allowance* 40, so the two numbers differ on purpose and
   * the cap is the only thing that can see the difference.
   */
  const setup = (standing: readonly StandingEffect[]): readonly GameEvent[] => [
    {
      type: 'creature-added',
      id: MONK,
      name: 'monk',
      sheet: sheet({ standing }),
      maxHp: 40,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'party',
    },
    {
      type: 'creature-added',
      id: HORSE,
      name: 'horse',
      sheet: sheet(),
      maxHp: 20,
      diesAtZero: false,
      creatureType: 'Beast',
      side: 'party',
    },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: MONK, placement: { from: { landmark: 'the yard' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: HORSE,
      // SRD Mounted Combat wants "a creature that is at least one size larger".
      placement: { from: { creature: MONK }, feet: 5, bearing: 0, size: 'large' },
    },
    {
      type: 'combat-started',
      combatants: [
        { id: MONK, initiative: 20, speed: 30 },
        { id: HORSE, initiative: 5, speed: 30 },
      ],
    },
  ];

  const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('speed') as Rng, content: SRD_CONTENT });

  const walk = (standing: readonly StandingEffect[], feet: number) =>
    resolveMove(
      fold('seed', setup(standing)),
      MONK,
      { placement: { from: { landmark: 'the yard' }, feet, bearing: 90 } },
      supply(),
    );

  it('raises the movement allowance past the pinned Speed', () => {
    // 35 feet is more than the printed 30 and within the feature's 40.
    expect(isErr(walk([], 35))).toBe(true);
    expect(walk([unarmoredMovement], 35).ok).toBe(true);
  });

  it('still refuses a move past the raised allowance', () => {
    const out = walk([unarmoredMovement], 45);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_enough_movement');
  });

  /**
   * SRD Mounted Combat: mounting "costs an amount of movement equal to half
   * your Speed (round down)" — half the Speed the rider *has*, so the feature
   * moves this number too.
   */
  it('raises the mounting cost, which is half the Speed the rider has', () => {
    const cost = (standing: readonly StandingEffect[]): number => {
      const events = unwrap(
        mountCreature(fold('seed', setup(standing)), MONK, HORSE, { willing: true }),
        'mount',
      );
      const spent = events.find((e) => e.type === 'movement-spent');
      return spent !== undefined && spent.type === 'movement-spent' ? spent.feet : -1;
    };
    expect(cost([])).toBe(15);
    expect(cost([unarmoredMovement])).toBe(20);
  });

  /**
   * **A Speed of 0 is refused, not charged nothing.**
   *
   * This is the case a live allowance can lose silently: "half your Speed" of
   * 0 is 0, so a cost check asking whether the rider can afford it compares 0
   * against 0 and passes, and the guard cancels itself out the moment the cost
   * and the allowance read the same live number. SRD puts the sentence inside
   * "**During your move**", and Grappled prints "Your Speed is 0" — a pinned
   * knight does not climb onto a horse for free, and a `movement-spent` of 0
   * feet would be an event recording that nothing happened.
   *
   * Nothing in the suite mounted under a zeroing condition before this, which
   * is how the refusal could have gone missing without a test going red.
   */
  it('refuses mounting while a condition has pinned the rider', () => {
    const base = fold('seed', setup([unarmoredMovement]));
    const grappled = fold('seed', [
      ...setup([unarmoredMovement]),
      ...unwrap(applyConditionTo(base, MONK, 'grappled', 'a net'), 'grappled'),
    ]);
    expect(speedOf(grappled, MONK)).toBe(0);

    const out = mountCreature(grappled, MONK, HORSE, { willing: true });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_enough_movement');
  });

  /**
   * SRD Dash: "The increase equals your Speed **after applying any
   * modifiers**", so a Monk whose Speed is 40 has 80 feet — the whole Speed
   * twice, not the pinned base twice.
   *
   * **The reducer derives this increase**, because `dash-taken` carries no
   * amount, so the fold asks `speedOf` exactly as `takeDash` does. It briefly
   * did not, and the Monk got 70: the arithmetic is written out rather than as
   * a bare 80 so that a regression says which half moved.
   */
  it('raises the Dash, because the fold reads the same Speed the command did', () => {
    const base = fold('seed', setup([unarmoredMovement]));
    expect(speedOf(base, MONK)).toBe(40);

    const dashed = fold('seed', [
      ...setup([unarmoredMovement]),
      ...unwrap(takeDash(base, MONK, {}), 'dash'),
    ]);

    expect(movementLeftFor(dashed, MONK)).toBe(40 + 40);

    const at = (feet: number) =>
      resolveMove(
        dashed,
        MONK,
        { placement: { from: { landmark: 'the yard' }, feet, bearing: 90 } },
        supply(),
      );
    expect(isErr(at(85))).toBe(true);
    const far = at(80);
    expect(far.ok).toBe(true);
    // **And the fold must accept what the command emitted.** Asserting on the
    // `Result` alone proves the command said yes; it does not prove the events
    // it handed back are a log. That is the fixture weakness this whole task
    // turned on — the command validated against `speedOf` and the reducer
    // against the pinned Speed, and a green suite folded a corrupt log.
    if (far.ok) {
      expect(() =>
        fold('seed', [
          ...setup([unarmoredMovement]),
          ...unwrap(takeDash(base, MONK, {}), 'dash'),
          ...far.value.events,
        ]),
      ).not.toThrow();
    }
  });

  /**
   * The same fold guarantee on the ordinary path, which is where the defect
   * actually lived: a 35-foot move the command allowed against 40 and the
   * reducer refused against 30.
   */
  it('folds a feature-raised move that the command allowed', () => {
    const out = walk([unarmoredMovement], 35);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(() =>
        fold('seed', [...setup([unarmoredMovement]), ...out.value.events]),
      ).not.toThrow();
    }
  });
});

/**
 * Both frozen logs fold, and the reason they are unaffected is asserted rather
 * than assumed.
 *
 * `persistence.test.ts` and `persistence-2.test.ts` already fold each one at
 * every prefix, so this adds no coverage of the *fold*. What it adds is the
 * **reason**, which is specific to this change and is the thing that could
 * quietly stop being true: the fold now calls `speedOf` on two reducer paths,
 * and `speedOf` answers the pinned `combatant.speed` for a creature carrying
 * no `speed` grant. No creature in either fixture carries one, so every
 * `movement-spent` and the one `dash-taken` measure against exactly the number
 * they measured against before.
 *
 * This is the criterion this task has already been wrong about once — a green
 * suite folded a corrupt log — so the claim is a test rather than a sentence.
 */
describe('the frozen logs are untouched by a live Speed', () => {
  const LOGS = ['golden-log.json', 'golden-log-2.json'] as const;
  const here = fileURLToPath(new URL('.', import.meta.url));
  const logOf = (name: string): readonly GameEvent[] =>
    JSON.parse(readFileSync(`${here}../fixtures/${name}`, 'utf8')) as readonly GameEvent[];

  it.each(LOGS)('%s folds, and its movement events are in it', (name) => {
    const log = logOf(name);
    const state = fold('seed', log, SRD_CONTENT);
    // A fold that exercised none of the changed paths would prove nothing, so
    // the fixture is asserted to contain them rather than assumed to.
    const types = new Set(log.map((event) => event.type));
    expect(types.has('movement-spent')).toBe(true);
    expect(Object.keys(state.creatures).length).toBeGreaterThan(0);
  });

  it('has a dash in the second log, which is where that path is folded', () => {
    expect(logOf('golden-log-2.json').some((event) => event.type === 'dash-taken')).toBe(true);
  });

  /**
   * The equality is against **the number the old code computed**, not against
   * the printed Speed: a creature in either log may be Unconscious, and
   * `conditionSpeed` answering 0 for one is the rule rather than a difference.
   * `conditionSpeed(conditions, pinned)` is exactly what `dash` and
   * `spendMovement` used to pass, so asserting `speedOf` equals it is the
   * strongest form of "the fold measures against the same number it did".
   */
  it.each(LOGS)('%s gives every creature the Speed the old code computed', (name) => {
    const state = fold('seed', logOf(name), SRD_CONTENT);
    for (const [who, creature] of Object.entries(state.creatures)) {
      const id = asCharacterId(who);
      // No `speed` grant anywhere in either fixture — which is *why* the pinned
      // base is still the whole answer.
      expect(
        (creature.sheet.standing ?? []).some((effect) => effect.grant.kind === 'speed'),
        who,
      ).toBe(false);
      const base = state.combat?.order.find((c) => c.id === id)?.speed ?? creature.sheet.baseSpeed;
      expect(speedOf(state, id), who).toBe(conditionSpeed(creature.conditions, base));
    }
  });
});
