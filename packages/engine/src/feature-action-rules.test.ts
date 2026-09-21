import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { actionRulesOn } from './standing.js';
import { takeDash, takeDisengage } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A rule about the action economy that a **feature** states.
 *
 * `ActionRule` has been the ninth sourced grant since Stinking Cloud, and it
 * was reachable from a casting and from nothing else: both emitters of
 * `action-rule-granted` take a casting id as the grant's source, and no
 * `FeatureGrant` could hold one. SRD Cunning Action and SRD Adrenaline Rush
 * are the same sentence written on a class table and on a species trait.
 *
 * **It is derived, never stored, and that is the whole shape.** A rule
 * compiled onto the creature at creation would be an unconditional row in
 * every Rogue's state — the thing `standing.ts` exists to refuse — and it
 * would miss every Rogue already written into a log, including the one frozen
 * in `golden-log-2.json`. So `actionRulesOn` merges what the creature is
 * holding with what its features say on every read, exactly as `speedOf`
 * gathers a Monk's Unarmoured Movement.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const FIGHTER = id('fighter');
const ORC = id('orc');
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

/** A Rogue at the level Cunning Action arrives, and past it. */
const rogueChoices: CharacterChoices = {
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level: 5,
  speciesId: 'human',
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

/** The control: a class whose table prints no such sentence. */
const fighterChoices: CharacterChoices = {
  ...common,
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  speciesId: 'human',
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

/** The same sentence on a species trait rather than a class table. */
const orcChoices: CharacterChoices = {
  ...fighterChoices,
  name: 'Gral',
  speciesId: 'orc',
  featureChoices: { 'fighter:weapon-mastery': [] },
  feats: {
    ...MAGIC_INITIATE,
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

/** One creature with the turn, and a goblin to have it against. */
const fight = (who: CharacterId, choices: CharacterChoices): readonly GameEvent[] => [
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

const ROGUE_TURN = fight(ROGUE, rogueChoices);
const FIGHTER_TURN = fight(FIGHTER, fighterChoices);
const ORC_TURN = fight(ORC, orcChoices);

const types = (events: readonly GameEvent[]): readonly string[] => events.map((e) => e.type);

describe("SRD Cunning Action: Dash, Disengage or Hide as a Bonus Action", () => {
  /**
   * The claim the derived shape is *for*: a Rogue holds the rule and the log
   * says nothing about it. Every Rogue ever written down gets the feature the
   * day it is transcribed, including the one in the frozen fixture.
   */
  it('reaches the Rogue through the sheet, with nothing stored on the creature', () => {
    const state = fold('seed', ROGUE_TURN);
    expect(state.creatures[ROGUE]?.actionRules).toEqual([]);

    const rules = actionRulesOn(state, ROGUE);
    expect(rules.map((held) => held.rule)).toContainEqual({
      kind: 'allows',
      action: 'dash',
      from: 'bonus-action',
    });
    expect(rules.map((held) => held.rule)).toContainEqual({
      kind: 'allows',
      action: 'disengage',
      from: 'bonus-action',
    });
    expect(rules.map((held) => held.rule)).toContainEqual({
      kind: 'allows',
      action: 'hide',
      from: 'bonus-action',
    });
    // Named, so a log and a refusal can both say what permitted it.
    expect(rules.every((held) => held.label.length > 0)).toBe(true);
  });

  it('buys the Dash out of a Bonus Action', () => {
    const out = unwrap(takeDash(fold('seed', ROGUE_TURN), ROGUE, {}, { from: 'bonus-action' }), 'dash');
    expect(types(out)).toEqual(['bonus-action-spent', 'dash-taken']);

    // And the Action is still there to spend.
    const after = fold('seed', [...ROGUE_TURN, ...out]);
    expect(after.combat?.budgets[ROGUE]?.action).toBe(true);
    expect(after.combat?.budgets[ROGUE]?.bonusAction).toBe(false);
  });

  it('buys the Disengage out of a Bonus Action', () => {
    const out = unwrap(
      takeDisengage(fold('seed', ROGUE_TURN), ROGUE, {}, { from: 'bonus-action' }),
      'disengage',
    );
    expect(types(out)).toEqual(['bonus-action-spent', 'disengage-taken']);
  });

  it('still charges an Action for a Dash nobody asked a price for', () => {
    const out = unwrap(takeDash(fold('seed', ROGUE_TURN), ROGUE, {}), 'dash');
    expect(types(out)).toEqual(['action-spent', 'dash-taken']);
  });

  /** The refusal is a value naming the missing permission, not an exception. */
  it('refuses the same Bonus Action to a Fighter, who holds no such feature', () => {
    const refused = takeDash(fold('seed', FIGHTER_TURN), FIGHTER, {}, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');
    expect(isErr(refused) && refused.reason).toContain('Dash');
  });

  /** A price no command charges is refused at the door, permission or not. */
  it('refuses a price no command charges', () => {
    const refused = takeDash(fold('seed', ROGUE_TURN), ROGUE, {}, { from: 'reaction' });
    expect(isErr(refused) && refused.code).toBe('no_such_price');
  });

  it('is idempotent under a repeated command id', () => {
    const state = fold('seed', ROGUE_TURN);
    const first = unwrap(takeDash(state, ROGUE, { commandId: 'c1' }, { from: 'bonus-action' }), 'dash');
    expect(first.length).toBeGreaterThan(0);
    const again = unwrap(
      takeDash(fold('seed', [...ROGUE_TURN, ...first]), ROGUE, { commandId: 'c1' }, { from: 'bonus-action' }),
      'again',
    );
    expect(again).toEqual([]);
  });
});

describe('SRD Adrenaline Rush: "You can take the Dash action as a Bonus Action"', () => {
  it('reaches an Orc through a species trait, and the same command spends the cheaper slot', () => {
    const state = fold('seed', ORC_TURN);
    expect(state.creatures[ORC]?.actionRules).toEqual([]);
    expect(actionRulesOn(state, ORC).map((held) => held.rule)).toContainEqual({
      kind: 'allows',
      action: 'dash',
      from: 'bonus-action',
    });

    const out = unwrap(takeDash(state, ORC, {}, { from: 'bonus-action' }), 'dash');
    expect(types(out)).toEqual(['bonus-action-spent', 'dash-taken']);
  });

  /** The trait says nothing about Disengaging, and the door is per action. */
  it('does not buy the Orc a Disengage', () => {
    const refused = takeDisengage(fold('seed', ORC_TURN), ORC, {}, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');
  });
});
