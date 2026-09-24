/**
 * Three words the species traits were waiting for, and the features they
 * finish.
 *
 * - **A pool the Proficiency Bonus sizes.** SRD prints "a number of times
 *   equal to your Proficiency Bonus" on five origin traits, and no species has
 *   a class table for the first sizing to read. `perProficiencyBonus` is the
 *   fourth sizing, read at the *character's* level and grown by advancement.
 * - **A benefit that runs for a printed span.** SRD Stonecunning, Innate
 *   Sorcery, Large Form and Draconic Flight are switched on "for 10 minutes"
 *   or "for 1 minute", in or out of a fight, and nothing maintains them.
 *   `lastsSeconds` is the activation's second lifetime spelling.
 * - **Temporary Hit Points a feature grants, and a use it spends, on an
 *   allowance.** SRD Adrenaline Rush is a Dash bought out of a Bonus Action
 *   that costs a use and pays Temporary Hit Points; the `action-rule` grant
 *   carries both, and `takeDash` pays them when the price is taken.
 *
 * Every feature here is driven through `createCharacter` from `SRD_CONTENT`,
 * so what is asserted is the catalogue's own transcription.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { advanceCharacter, createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { sensesOf, speedOf } from './standing.js';
import {
  activateFeature,
  advanceTime,
  endFeature,
  extendFeature,
  grappleTarget,
  resolveTest,
  takeDash,
} from './commands.js';

const HERO = asCharacterId('hero');
const GOBLIN = asCharacterId('goblin');
const OGRE = asCharacterId('ogre');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const refused = (result: Result<unknown>): string | null => (result.ok ? null : result.code);

const types = (events: readonly GameEvent[]): readonly string[] => events.map((e) => e.type);

const run = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

// — Fixtures —————————————————————————————————————————————————————————————————

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
};

const MAGIC_INITIATE = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
};

/** What each species' own traits ask the player, and nothing else differs. */
const SPECIES_CHOICES: Readonly<Record<string, Partial<CharacterChoices>>> = {
  orc: {},
  dwarf: {},
  goliath: { featureChoices: { 'goliath:giant-ancestry': ["Stone's Endurance"] } },
  dragonborn: { featureChoices: { 'dragonborn:draconic-ancestry': ['Red'] } },
  gnome: {
    featureChoices: { 'gnome:gnomish-lineage': ['Forest Gnome'] },
    featureSpellcasting: { 'gnome:gnomish-lineage': 'int' },
  },
};

/** A Fighter of the species and level asked for. */
const fighter = (species: string, level: 1 | 4 | 5): CharacterChoices => {
  const own = SPECIES_CHOICES[species] ?? {};
  return {
    ...common,
    name: 'Bren',
    classId: 'fighter',
    level,
    speciesId: species,
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'survival'],
    ...(level >= 3 ? { subclassId: 'champion' } : {}),
    ...own,
    featureChoices: { 'fighter:weapon-mastery': [], ...(own.featureChoices ?? {}) },
    feats: {
      ...MAGIC_INITIATE,
      'fighter:fighting-style': { featId: 'archery' },
      ...(level >= 4 ? { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    },
  };
};

/** A Human Sorcerer 1: Innate Sorcery arrives with the class. */
const sorcerer = (): CharacterChoices => ({
  ...common,
  name: 'Yrsa',
  classId: 'sorcerer',
  level: 1,
  speciesId: 'human',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  preparedSpells: ['magic-missile', 'burning-hands'],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...MAGIC_INITIATE, 'human:versatile': { featId: 'alert' } },
});

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const made = (choices: CharacterChoices): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, choices, HERO), choices.name);

/** The hero standing in a yard, with nobody's turn running. */
const yard = (choices: CharacterChoices): GameEvent[] => [
  ...made(choices),
  { type: 'creature-side-declared', id: HERO, side: 'party' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the yard' }, feet: 0 } },
];

/** The same yard with a goblin in it and the hero's turn running. */
const fight = (choices: CharacterChoices): GameEvent[] => [
  ...yard(choices),
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: HERO }, feet: 20, bearing: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: HERO, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const pool = (state: GameState, key: string) => state.creatures[HERO]?.resources.pools[key];
const active = (state: GameState): readonly string[] => state.creatures[HERO]?.activeFeatures ?? [];
const timerOf = (state: GameState, feature: string) =>
  state.timers[`feature|${HERO}|${feature}`];

// — A pool the Proficiency Bonus sizes ———————————————————————————————————————

describe('a pool the Proficiency Bonus sizes', () => {
  it('is the character’s Proficiency Bonus at creation, and a Long Rest refills it', () => {
    const one = fold('seed', made(fighter('dragonborn', 1)));
    expect(pool(one, 'dragonborn:breath-weapon')).toMatchObject({ max: 2, recovers: 'long-rest' });

    const five = fold('seed', made(fighter('dragonborn', 5)));
    expect(pool(five, 'dragonborn:breath-weapon')?.max).toBe(3);
  });

  it('grows with the Proficiency Bonus when a level is taken', () => {
    const four = fold('seed', made(fighter('dragonborn', 4)));
    expect(pool(four, 'dragonborn:breath-weapon')?.max).toBe(2);

    const gained = unwrap(advanceCharacter(four, SRD_CONTENT, HERO, {}), 'advance');
    expect(gained).toContainEqual({
      type: 'resource-pool-resized',
      id: HERO,
      key: 'dragonborn:breath-weapon',
      max: 3,
    });
    expect(pool(run(four, gained), 'dragonborn:breath-weapon')?.max).toBe(3);
  });

  it('sizes every origin trait that prints the sentence', () => {
    expect(pool(fold('seed', made(fighter('goliath', 1))), 'goliath:giant-ancestry')?.max).toBe(2);
    expect(pool(fold('seed', made(fighter('dwarf', 1))), 'dwarf:stonecunning')?.max).toBe(2);
    expect(pool(fold('seed', made(fighter('orc', 1))), 'orc:adrenaline-rush')?.max).toBe(2);
    // The Forest Gnome's Speak with Animals, "a number of times equal to your
    // Proficiency Bonus", on the lineage's own free-casting pool.
    expect(
      pool(fold('seed', made(fighter('gnome', 1))), 'gnome:gnomish-lineage:speak-with-animals')?.max,
    ).toBe(2);
  });
});

// — Adrenaline Rush ———————————————————————————————————————————————————————————

describe('SRD Adrenaline Rush', () => {
  it('spends a use and grants Temporary Hit Points when the Dash is bought out of the Bonus Action', () => {
    const state = fold('seed', fight(fighter('orc', 1)));
    const out = unwrap(takeDash(state, HERO, {}, { from: 'bonus-action' }), 'dash');
    expect(types(out)).toEqual([
      'bonus-action-spent',
      'resource-spent',
      'temporary-hp-granted',
      'dash-taken',
    ]);
    expect(out).toContainEqual({ type: 'resource-spent', id: HERO, key: 'orc:adrenaline-rush', amount: 1 });
    // "equal to your Proficiency Bonus": two at level 1.
    expect(out).toContainEqual({ type: 'temporary-hp-granted', id: HERO, amount: 2 });

    const after = run(state, out);
    expect(remaining(after.creatures[HERO]!.resources, 'orc:adrenaline-rush')).toBe(1);
    expect(after.creatures[HERO]!.vitals.temporaryHp).toBe(2);
  });

  it('pays three at level 5, where the Proficiency Bonus is three', () => {
    const out = unwrap(takeDash(fold('seed', fight(fighter('orc', 5))), HERO, {}, { from: 'bonus-action' }), 'dash');
    expect(out).toContainEqual({ type: 'temporary-hp-granted', id: HERO, amount: 3 });
  });

  it('refuses the cheaper Dash once the uses are spent, and still charges an Action for a plain one', () => {
    const spent = fold('seed', [
      ...fight(fighter('orc', 1)),
      { type: 'resource-spent', id: HERO, key: 'orc:adrenaline-rush', amount: 2 },
    ]);
    expect(refused(takeDash(spent, HERO, {}, { from: 'bonus-action' }))).toBe('exhausted');

    const plainDash = unwrap(takeDash(spent, HERO, {}), 'dash');
    expect(types(plainDash)).toEqual(['action-spent', 'dash-taken']);
  });
});

// — A benefit that runs for a printed span ————————————————————————————————————

describe('a benefit that runs for a printed span', () => {
  it('Stonecunning: ten minutes of Tremorsense, outside a fight, ended by the clock', () => {
    const state = fold('seed', yard(fighter('dwarf', 1)));
    expect(sensesOf(state, HERO).map((s) => s.sense)).not.toContain('tremorsense');

    const out = unwrap(activateFeature(state, HERO, { feature: 'dwarf:stonecunning' }, SRD_CONTENT), 'activate');
    expect(types(out)).toContain('resource-spent');
    expect(types(out)).toContain('feature-activated');
    // No Bonus Action outside a fight: there is no economy to spend it from.
    expect(types(out)).not.toContain('bonus-action-spent');

    const on = run(state, out);
    expect(active(on)).toContain('dwarf:stonecunning');
    expect(sensesOf(on, HERO)).toContainEqual({ sense: 'tremorsense', feet: 60 });
    expect(remaining(on.creatures[HERO]!.resources, 'dwarf:stonecunning')).toBe(1);
    expect(timerOf(on, 'dwarf:stonecunning')?.deadline).toEqual({ kind: 'elapsed', at: 600 });

    const almost = run(on, unwrap(advanceTime(on, 599, 'nearly ten minutes'), 'time'));
    expect(active(almost)).toContain('dwarf:stonecunning');
    const over = run(almost, unwrap(advanceTime(almost, 1, 'the last second'), 'time'));
    expect(active(over)).not.toContain('dwarf:stonecunning');
    expect(sensesOf(over, HERO).map((s) => s.sense)).not.toContain('tremorsense');
  });

  it('Innate Sorcery: a minute on the clock inside a fight, and it is not maintained', () => {
    const state = fold('seed', fight(sorcerer()));
    const out = unwrap(activateFeature(state, HERO, { feature: 'sorcerer:innate-sorcery' }, SRD_CONTENT), 'activate');
    expect(types(out)).toContain('bonus-action-spent');
    expect(out).toContainEqual({ type: 'resource-spent', id: HERO, key: 'innate-sorcery', amount: 1 });

    const on = run(state, out);
    expect(timerOf(on, 'sorcerer:innate-sorcery')?.deadline).toEqual({
      kind: 'elapsed',
      at: state.elapsed + 60,
    });
    expect(remaining(on.creatures[HERO]!.resources, 'innate-sorcery')).toBe(1);

    // SRD Rage is maintained round by round; a minute printed on the feature is not.
    expect(
      refused(extendFeature(on, HERO, { feature: 'sorcerer:innate-sorcery', by: 'bonus-action' })),
    ).toBe('not_extendable');
  });
});

// — Large Form ————————————————————————————————————————————————————————————————

describe('SRD Large Form', () => {
  const goliath = () => fold('seed', yard(fighter('goliath', 5)));

  it('makes the Goliath Large for ten minutes, ten feet faster and surer of Strength', () => {
    const state = goliath();
    expect(state.scene?.sizes[HERO]).toBe('medium');
    const walk = speedOf(state, HERO);

    const on = run(state, unwrap(activateFeature(state, HERO, { feature: 'goliath:large-form' }, SRD_CONTENT), 'activate'));
    expect(on.scene?.sizes[HERO]).toBe('large');
    expect(speedOf(on, HERO)).toBe(walk + 10);
    expect(remaining(on.creatures[HERO]!.resources, 'goliath:large-form')).toBe(0);

    // "Advantage on Strength checks": the mode is on the roll's own record.
    const checked = unwrap(
      resolveTest(on, HERO, { kind: 'ability-check', ability: 'str', dc: 10 }, supply('str')),
      'check',
    );
    const record = checked.events.find((e) => e.type === 'roll-recorded');
    expect(JSON.stringify(record)).toContain('advantage');
    const dexterous = unwrap(
      resolveTest(on, HERO, { kind: 'ability-check', ability: 'dex', dc: 10 }, supply('dex')),
      'check',
    );
    expect(JSON.stringify(dexterous.events.find((e) => e.type === 'roll-recorded'))).not.toContain(
      'advantage',
    );

    const over = run(on, unwrap(advanceTime(on, 600, 'ten minutes'), 'time'));
    expect(active(over)).not.toContain('goliath:large-form');
    expect(over.scene?.sizes[HERO]).toBe('medium');
    expect(speedOf(over, HERO)).toBe(walk);
  });

  it('is the size the rules read, not only the size the map shows', () => {
    // An independent review found Large Form on the map and Medium to every
    // rule: the readers asked the record before the scene. SRD Grapple reaches
    // "a creature no more than one size larger than you" — Huge from Large.
    const state = fold('seed', [
      ...yard(fighter('goliath', 5)),
      {
        type: 'creature-added',
        id: OGRE,
        name: 'ogre',
        sheet: plain(),
        maxHp: 59,
        diesAtZero: true,
        creatureType: 'Giant',
        side: 'ogres',
        size: 'huge',
      },
      { type: 'creature-placed', id: OGRE, placement: { from: { creature: HERO }, feet: 5, bearing: 0 } },
      {
        type: 'combat-started',
        combatants: [
          { id: HERO, initiative: 20, speed: 30 },
          { id: OGRE, initiative: 10, speed: 40 },
        ],
      },
    ]);
    const medium = grappleTarget(state, HERO, { target: OGRE, save: 'str' }, supply('grapple'));
    expect(medium.ok).toBe(false);
    if (!medium.ok) expect(medium.code).toBe('too_large');

    const on = run(state, unwrap(activateFeature(state, HERO, { feature: 'goliath:large-form' }, SRD_CONTENT), 'activate'));
    const large = grappleTarget(on, HERO, { target: OGRE, save: 'str' }, supply('grapple'));
    expect(large.ok).toBe(true);
  });

  it('puts the size back when the Goliath ends it early', () => {
    const state = goliath();
    const on = run(state, unwrap(activateFeature(state, HERO, { feature: 'goliath:large-form' }, SRD_CONTENT), 'activate'));
    const off = run(on, unwrap(endFeature(on, HERO, { feature: 'goliath:large-form' }), 'end'));
    expect(active(off)).not.toContain('goliath:large-form');
    expect(off.scene?.sizes[HERO]).toBe('medium');
  });
});

// — Draconic Flight ———————————————————————————————————————————————————————————

describe('SRD Draconic Flight', () => {
  it('gives a Fly Speed equal to the Speed for ten minutes, and ends on Incapacitated', () => {
    const state = fold('seed', yard(fighter('dragonborn', 5)));
    expect(speedOf(state, HERO, 'fly')).toBe(0);

    const on = run(state, unwrap(activateFeature(state, HERO, { feature: 'dragonborn:draconic-flight' }, SRD_CONTENT), 'activate'));
    expect(speedOf(on, HERO, 'fly')).toBe(speedOf(on, HERO));
    expect(timerOf(on, 'dragonborn:draconic-flight')?.deadline).toEqual({ kind: 'elapsed', at: 600 });

    const stunned = run(on, [{ type: 'condition-applied', id: HERO, condition: 'stunned', source: 'a test' }]);
    expect(active(stunned)).not.toContain('dragonborn:draconic-flight');
    expect(speedOf(stunned, HERO, 'fly')).toBe(0);
  });
});
