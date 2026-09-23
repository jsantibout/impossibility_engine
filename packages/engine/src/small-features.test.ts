/**
 * Five one-clause features, each a sentence away from executed and each now
 * executed by the primitive its sentence names.
 *
 * - SRD Heroic Inspiration (Human's Resourceful): the `test-rolled` window
 *   Indomitable already answers, widened to any D20 Test the holder makes and
 *   any outcome, spent from a pool of one that a Long Rest refills.
 * - SRD Jack of All Trades: half the Proficiency Bonus on a check made with a
 *   skill the holder is not proficient in, gathered where every check bonus is.
 * - SRD Naturally Stealthy: a Hide allowed when a creature one size larger
 *   stands within five feet, where the concealment test would have refused.
 * - SRD Slow Fall: a Reaction that takes five times the Monk level off a
 *   fall's damage, elected on the fall itself.
 * - SRD Second-Story Work: a running Long Jump lengthened by the Dexterity
 *   modifier, read where the jump's reach is.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import {
  resolveFall,
  resolveMove,
  resolveTest,
  takeHide,
  takeTestReaction,
} from './commands.js';
import { checkBonuses } from './commands/rolls.js';

const id = (s: string) => asCharacterId(s);
const HERO = id('hero');
const ALLY = id('ally');
const WATCHER = id('watcher');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const refused = (result: { ok: boolean; code?: string }): string => {
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(false);
  return (result as { code: string }).code;
};

const common = {
  backgroundId: 'sage',
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
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
  },
};

/** A Human Fighter 1: Resourceful is every Human's. */
const human = (): CharacterChoices => ({
  ...common,
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    ...common.feats,
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

/** A Halfling Bard 2: Jack of All Trades and Naturally Stealthy on one sheet. */
const halflingBard = (): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level: 2,
  speciesId: 'halfling',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['persuasion', 'performance', 'deception'],
  cantrips: ['vicious-mockery', 'light'],
  preparedSpells: ['healing-word', 'charm-person', 'faerie-fire', 'thunderwave', 'heroism'],
  featureChoices: { 'bard:expertise': ['persuasion', 'performance'] },
});

/** A Human Monk 4: Slow Fall. */
const monk = (): CharacterChoices => ({
  ...common,
  name: 'Tam',
  classId: 'monk',
  level: 4,
  speciesId: 'human',
  abilities: {
    method: 'manual',
    assignment: { str: 10, dex: 16, con: 13, int: 8, wis: 14, cha: 12 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    'human:versatile': { featId: 'alert' },
    'monk:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** A Human Rogue 3, Thief: Second-Story Work. */
const thief = (): CharacterChoices => ({
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 3,
  speciesId: 'human',
  abilities: {
    method: 'manual',
    assignment: { str: 12, dex: 17, con: 13, int: 14, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:weapon-mastery': [],
  },
  feats: { ...common.feats, 'human:versatile': { featId: 'alert' } },
});

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId, side: string, size?: 'medium' | 'large'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: plain(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...(size === undefined ? {} : { size }),
});

const made = (choices: CharacterChoices): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, choices, HERO), choices.name);

const run = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// — Heroic Inspiration ————————————————————————————————————————————————————————

describe('SRD Heroic Inspiration, granted by Resourceful', () => {
  const log = (): GameEvent[] => [
    ...made(human()),
    { type: 'creature-side-declared', id: HERO, side: 'party' },
  ];

  it('is a pool of one on the sheet, refilled by a Long Rest, spent by the test-rolled window', () => {
    const state = fold('seed', log());
    expect(remaining(state.creatures[HERO]!.resources, 'human:heroic-inspiration')).toBe(1);
    const declared = log().find(
      (e) => e.type === 'resource-pool-declared' && e.pool.key === 'human:heroic-inspiration',
    );
    expect(declared?.type === 'resource-pool-declared' ? declared.pool.recovers : null).toBe(
      'long-rest',
    );
    const line = state.creatures[HERO]!.sheet.reactions?.find(
      (one) => one.feature === 'human:resourceful',
    );
    expect(line).toMatchObject({
      window: 'test-rolled',
      costsReaction: false,
      pool: 'human:heroic-inspiration',
      does: { kind: 'reroll', tests: ['ability-check', 'saving-throw'] },
    });
  });

  it('is offered on a failed check and not on a made one, and rerolls the die when taken', () => {
    const state = fold('seed', log());
    // A failure: the reroll is offered, taken, and the new roll stands.
    const failed = unwrap(
      resolveTest(state, HERO, { kind: 'ability-check', ability: 'str', skill: 'athletics', dc: 40 }, supply('miss')),
      'check',
    );
    expect(failed.offers.map((o) => o.feature)).toEqual(['human:resourceful']);
    const pending = run(state, failed.events);
    const again = unwrap(
      takeTestReaction(pending, HERO, { feature: 'human:resourceful' }, supply('again')),
      'reroll',
    );
    expect(again.test?.supersedes).toEqual({ natural: failed.test!.natural, total: failed.test!.total });
    const after = run(pending, again.events);
    expect(remaining(after.creatures[HERO]!.resources, 'human:heroic-inspiration')).toBe(0);
    // The window is answered and waits only to be settled, as Indomitable's does.
    expect(after.pendingTest?.offers).toEqual([]);
    expect(after.pendingTest?.result.natural).toBe(again.test!.natural);

    // A made roll is not offered, so an ordinary check stays a single call:
    // "any die" is narrowed to a failure on purpose, and `progression.ts` says why.
    const easy = unwrap(
      resolveTest(state, HERO, { kind: 'ability-check', ability: 'str', skill: 'athletics', dc: -5 }, supply('hit')),
      'check',
    );
    expect(easy.test?.success).toBe(true);
    expect(easy.offers).toEqual([]);
    expect(easy.events.some((e) => e.type === 'test-rolled')).toBe(false);
  });

  it('is withheld with the pool spent', () => {
    const state = fold('seed', [
      ...log(),
      { type: 'resource-spent', id: HERO, key: 'human:heroic-inspiration', amount: 1 },
    ]);
    const failed = unwrap(
      resolveTest(state, HERO, { kind: 'saving-throw', ability: 'wis', dc: 40 }, supply('miss')),
      'save',
    );
    expect(failed.offers).toEqual([]);
  });
});

// — Jack of All Trades ————————————————————————————————————————————————————————

describe('SRD Jack of All Trades', () => {
  it('adds half the Proficiency Bonus to a check with a skill the Bard lacks, and nothing to one they have', () => {
    const state = fold('seed', made(halflingBard()));
    // A Bard 2's Proficiency Bonus is +2; half, rounded down, is +1.
    expect(checkBonuses(state, HERO, undefined, 'athletics')).toEqual([
      { source: 'Jack of All Trades', flat: 1 },
    ]);
    expect(checkBonuses(state, HERO, undefined, 'persuasion')).toEqual([]);
    // No skill, no bonus: the sentence is about a skill proficiency the Bard lacks.
    expect(checkBonuses(state, HERO, undefined)).toEqual([]);
  });

  it('reaches the roll', () => {
    const state = fold('seed', made(halflingBard()));
    const rolled = unwrap(
      resolveTest(state, HERO, { kind: 'ability-check', ability: 'str', skill: 'athletics', dc: 10 }, supply('jack')),
      'check',
    );
    // Strength 8 is −1; the total is the die, minus one, plus the half bonus.
    expect(rolled.test!.total).toBe(rolled.test!.natural - 1 + 1);
  });
});

// — Naturally Stealthy ————————————————————————————————————————————————————————

describe('SRD Naturally Stealthy', () => {
  const yard = (allySize: 'medium' | 'large' | null, allyFeet = 5): GameEvent[] => [
    ...made(halflingBard()),
    { type: 'creature-side-declared', id: HERO, side: 'party' },
    added(WATCHER, 'foes'),
    ...(allySize === null ? [] : [added(ALLY, 'party', allySize)]),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the yard', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the yard' }, feet: 0 } },
    { type: 'creature-placed', id: WATCHER, placement: { from: { creature: HERO }, feet: 30, bearing: 0 } },
    ...(allySize === null
      ? []
      : [{ type: 'creature-placed' as const, id: ALLY, placement: { from: { creature: HERO }, feet: allyFeet, bearing: 180 } }]),
    { type: 'sight-declared', from: WATCHER, to: HERO, seen: false },
    { type: 'sight-declared', from: HERO, to: WATCHER, seen: true },
  ];

  it('lets a Halfling hide behind a Medium ally standing beside them, with no cover declared', () => {
    const state = fold('seed', yard('medium'));
    const hid = unwrap(takeHide(state, HERO, {}, supply('hide')), 'hide');
    expect(hid.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    // Who stands between the hider and the watcher is the table's.
    expect((hid.unverified ?? []).some((line) => line.includes('ally'))).toBe(true);
  });

  it('refuses without a larger creature to hide behind, exactly as before', () => {
    expect(refused(takeHide(fold('seed', yard(null)), HERO, {}, supply('hide')))).toBe('not_concealed');
    // Ten feet away is not "obscured by" anybody.
    expect(refused(takeHide(fold('seed', yard('medium', 10)), HERO, {}, supply('hide')))).toBe(
      'not_concealed',
    );
  });

  it('is the trait speaking and not the size alone', () => {
    // A Human beside the same Medium ally: Medium is not larger than Medium,
    // and a Human holds no such trait anyway.
    const state = fold('seed', [
      ...made(human()),
      { type: 'creature-side-declared', id: HERO, side: 'party' },
      added(WATCHER, 'foes'),
      added(ALLY, 'party', 'medium'),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the yard', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the yard' }, feet: 0 } },
      { type: 'creature-placed', id: WATCHER, placement: { from: { creature: HERO }, feet: 30, bearing: 0 } },
      { type: 'creature-placed', id: ALLY, placement: { from: { creature: HERO }, feet: 5, bearing: 180 } },
      { type: 'sight-declared', from: WATCHER, to: HERO, seen: false },
    ]);
    expect(refused(takeHide(state, HERO, {}, supply('hide')))).toBe('not_concealed');
  });
});

// — Slow Fall ——————————————————————————————————————————————————————————————————

describe('SRD Slow Fall', () => {
  const fallen = (feet: number, reaction: boolean, seed = 'fall', fighting = false) => {
    const state = fold('seed', [
      ...made(monk()),
      ...(fighting
        ? [{ type: 'combat-started' as const, combatants: [{ id: HERO, initiative: 10, speed: 40 }] }]
        : []),
    ]);
    return {
      state,
      out: resolveFall(
        state,
        HERO,
        { feet, ...(reaction ? { reaction: 'monk:slow-fall' } : {}) },
        supply(seed),
      ),
    };
  };

  it('takes five times the Monk level off the landing, never below nothing', () => {
    for (const seed of SEEDS) {
      const plain = unwrap(fallen(30, false, seed).out, 'fall');
      const eased = unwrap(fallen(30, true, seed).out, 'eased');
      // Same seed, same dice: the difference is the feature's twenty.
      expect(eased.dice).toBe('3d6');
      expect(eased.reduced).toBe(20);
      expect(eased.damage).toBe(Math.max(0, plain.damage - 20));
    }
  });

  it('spends the Reaction in a fight, and refuses a second one', () => {
    const { state, out } = fallen(40, true, 'fight', true);
    const eased = unwrap(out, 'eased');
    expect(eased.events.some((e) => e.type === 'reaction-spent')).toBe(true);
    const after = run(state, eased.events);
    expect(after.combat?.budgets[HERO]?.reaction).toBe(false);
    expect(
      refused(
        resolveFall(after, HERO, { feet: 40, reaction: 'monk:slow-fall', commandId: 'twice' }, supply('twice')),
      ),
    ).toBe('no_reaction');
  });

  it('refuses a feature the faller does not hold', () => {
    const state = fold('seed', made(human()));
    expect(refused(resolveFall(state, HERO, { feet: 30, reaction: 'monk:slow-fall' }, supply('x')))).toBe(
      'no_such_feature',
    );
  });
});

// — Second-Story Work ——————————————————————————————————————————————————————————

describe('SRD Second-Story Work', () => {
  const court = (choices: CharacterChoices): GameState =>
    fold('seed', [
      ...made(choices),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the ledge', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the ledge' }, feet: 0 } },
    ]);

  const leap = (state: GameState, feet: number) =>
    resolveMove(
      state,
      HERO,
      { placement: { from: { landmark: 'the ledge' }, feet, bearing: 90 }, jump: { kind: 'long', running: true } },
      supply('jump'),
    );

  it('lengthens a running Long Jump by the Dexterity modifier', () => {
    // Strength 12 is a twelve-foot running jump; Dexterity 17 adds three.
    const thiefState = court(thief());
    expect(leap(thiefState, 15).ok).toBe(true);
    expect(refused(leap(thiefState, 20))).toBe('jump_too_far');
    // A standing jump is half the Strength score and gains nothing.
    const standing = resolveMove(
      thiefState,
      HERO,
      { placement: { from: { landmark: 'the ledge' }, feet: 10, bearing: 90 }, jump: { kind: 'long' } },
      supply('stand'),
    );
    expect(refused(standing)).toBe('jump_too_far');
  });

  it('adds nothing for a character without the feature', () => {
    // Strength 15: fifteen feet running, and not a foot more.
    const fighter = court(human());
    expect(leap(fighter, 15).ok).toBe(true);
    expect(refused(leap(fighter, 20))).toBe('jump_too_far');
  });
});
