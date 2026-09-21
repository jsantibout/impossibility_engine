import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  contextRequestsOf,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { takeHide, HIDE_DC } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * SRD Hide, the action — and the owner's ruling that it is the engine's verb.
 *
 * > "With this action, you try to conceal yourself. To do so, you must succeed
 * > on a DC 15 Dexterity (Stealth) check while you're Heavily Obscured or
 * > behind Three-Quarters Cover or Total Cover, and you must be out of any
 * > enemy's line of sight."
 *
 * It has more inputs than most, and the split between them is the whole of the
 * design: **who can see the hider is the table's** — a declaration, like cover
 * and like whose side anybody is on — and **the check and the Invisible
 * condition it buys are the engine's**. Nothing here asks a caller for a
 * number, and nothing here decides for the table whether a bar is in the way.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

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
  speciesId: 'human',
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

const rogueChoices: CharacterChoices = {
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:weapon-mastery': [],
  },
  feats: {
    ...MAGIC_INITIATE,
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

const fighterChoices: CharacterChoices = {
  ...common,
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'champion',
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    ...MAGIC_INITIATE,
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

/**
 * A scene with a hider, a goblin watching, and nothing declared about either
 * the bar between them or what the goblin can see. Every test below adds the
 * declarations its own sentence is about.
 */
const table = (who: CharacterId, choices: CharacterChoices): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, who), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: who, side: 'party' },
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
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: who }, feet: 20, bearing: 0 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

/** The goblin cannot see the Rogue, and there is a wall in the way. */
const CONCEALED: readonly GameEvent[] = [
  ...table(ROGUE, rogueChoices),
  { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false },
  { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'three-quarters' },
];

const supply = (seed = 'hide') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The check is forced either way, so a test is about the rule and not the die. */
const forced = (flat: number) => [{ source: 'forced', flat }];

const hide = (
  log: readonly GameEvent[],
  who: CharacterId = ROGUE,
  command: Parameters<typeof takeHide>[2] = {},
) => takeHide(fold('seed', log), who, command, supply());

describe('SRD Hide: what a creature must have before the die is thrown', () => {
  it('refuses a creature with no cover and nothing obscuring them', () => {
    const exposed = [
      ...table(ROGUE, rogueChoices),
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    const refused = hide(exposed);
    expect(isErr(refused) && refused.code).toBe('not_concealed');
    expect(isErr(refused) && refused.reason).toContain('goblin');
  });

  it('refuses a creature a watcher can see, however good the cover', () => {
    const watched = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'total' } as GameEvent,
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: true } as GameEvent,
    ];
    const refused = hide(watched);
    expect(isErr(refused) && refused.code).toBe('seen');
    expect(isErr(refused) && refused.reason).toContain('goblin');
  });

  /**
   * Homework rather than a verdict: nobody has said what the goblin can see,
   * and the engine holds no light to work it out for itself.
   */
  it('asks when nobody has said whether the watcher can see them', () => {
    const undeclared = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'three-quarters' } as GameEvent,
    ];
    const asked = hide(undeclared);
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_sight');
    expect(contextRequestsOf(asked).map((request) => request.kind)).toEqual(['visibility']);
    expect(contextRequestsOf(asked)[0]?.subject).toBe(GOBLIN);
  });

  /** Half Cover is not enough: the book names Three-Quarters and Total. */
  it('refuses Half Cover, which the book does not offer', () => {
    const thin = [
      ...table(ROGUE, rogueChoices),
      { type: 'cover-declared', from: GOBLIN, to: ROGUE, degree: 'half' } as GameEvent,
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    expect(isErr(hide(thin)) && (hide(thin) as { code: string }).code).toBe('not_concealed');
  });

  /**
   * "Heavily Obscured" is the half the engine does not model — it holds no
   * light and no fog — so it is declared for the attempt, exactly as cover is
   * declared between two creatures.
   */
  it('takes Heavily Obscured as a declared fact, with no cover anywhere', () => {
    const fogged = [
      ...table(ROGUE, rogueChoices),
      { type: 'sight-declared', from: GOBLIN, to: ROGUE, seen: false } as GameEvent,
    ];
    const out = unwrap(hide(fogged, ROGUE, { obscured: true, bonuses: forced(40) }), 'hide');
    expect(out.hidden).toBe(true);
  });
});

describe('SRD Hide: the DC 15 Dexterity (Stealth) check, and what it buys', () => {
  it('buys the Invisible condition on a success', () => {
    const out = unwrap(hide(CONCEALED, ROGUE, { bonuses: forced(40) }), 'hide');
    expect(out.hidden).toBe(true);
    expect(out.check?.dc).toBe(HIDE_DC);
    expect(HIDE_DC).toBe(15);

    const applied = out.events.find((event) => event.type === 'condition-applied');
    expect(applied && applied.type === 'condition-applied' && applied.condition).toBe('invisible');

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.creatures[ROGUE]?.conditions.conditions).toContain('invisible');
    // The Action went on the attempt, and the roll is in the log to be read.
    expect(after.combat?.budgets[ROGUE]?.action).toBe(false);
    const rolled = out.events.find((event) => event.type === 'roll-recorded');
    expect(rolled && rolled.type === 'roll-recorded' && rolled.label).toContain('Stealth');
  });

  it('buys nothing on a failure, and still spends the action', () => {
    const out = unwrap(hide(CONCEALED, ROGUE, { bonuses: forced(-40) }), 'hide');
    expect(out.hidden).toBe(false);
    expect(out.events.some((event) => event.type === 'condition-applied')).toBe(false);

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.creatures[ROGUE]?.conditions.conditions).not.toContain('invisible');
    expect(after.combat?.budgets[ROGUE]?.action).toBe(false);
  });

  it('is idempotent under a repeated command id', () => {
    const first = unwrap(hide(CONCEALED, ROGUE, { commandId: 'h1', bonuses: forced(40) }), 'hide');
    expect(first.events.length).toBeGreaterThan(0);
    const again = takeHide(
      fold('seed', [...CONCEALED, ...first.events]),
      ROGUE,
      { commandId: 'h1', bonuses: forced(40) },
      supply(),
    );
    expect(unwrap(again, 'again').events).toEqual([]);
    expect(unwrap(again, 'again').duplicate).toBe(true);
  });
});

describe("SRD Cunning Action's third verb", () => {
  it('lets the Rogue Hide as a Bonus Action', () => {
    const out = unwrap(
      hide(CONCEALED, ROGUE, { from: 'bonus-action', bonuses: forced(40) }),
      'hide',
    );
    expect(out.events[0]?.type).toBe('bonus-action-spent');
    expect(out.hidden).toBe(true);

    const after = fold('seed', [...CONCEALED, ...out.events]);
    expect(after.combat?.budgets[ROGUE]?.action).toBe(true);
  });

  it('refuses the same Bonus Action to a Fighter, who holds no such feature', () => {
    const covered = [
      ...table(FIGHTER, fighterChoices),
      { type: 'sight-declared', from: GOBLIN, to: FIGHTER, seen: false } as GameEvent,
      { type: 'cover-declared', from: GOBLIN, to: FIGHTER, degree: 'total' } as GameEvent,
    ];
    const refused = hide(covered, FIGHTER, { from: 'bonus-action', bonuses: forced(40) });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');

    // And the ordinary price is still theirs to pay.
    expect(unwrap(hide(covered, FIGHTER, { bonuses: forced(40) }), 'hide').hidden).toBe(true);
  });
});
