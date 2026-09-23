import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { actionRulesOn } from './standing.js';
import { takeDash, takeDisengage } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { checkFeatureDefinition } from './feature-schema.js';
import { loadContent, READABLE_FEATURE_FIELDS, READABLE_GRANT_KINDS } from './content.js';
import { MAX_LEVEL, type FeatureDefinition } from './progression.js';

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

/**
 * The invariant the merge is written around, asserted rather than argued.
 *
 * `refuseSpend` takes the **first** rule that bites, and the stored ones come
 * first — so a creature under a spell is refused by that spell, with that
 * spell's own sentence and deadline, exactly as it was before any feature
 * could hold a rule at all. A merge that sorted the two halves together would
 * be a change to every log already written.
 */
describe('a casting still outranks a feature, and says so in its own words', () => {
  const GAGGED: readonly GameEvent[] = [
    ...ROGUE_TURN,
    {
      type: 'action-rule-granted',
      id: ROGUE,
      rule: {
        source: 'Stinking Cloud#cast:1',
        rule: { kind: 'forbids', slots: ['action', 'bonus-action'] },
        label: 'Stinking Cloud',
        until: 'the spell ends',
      },
    },
  ];

  it('refuses the Rogue their own Bonus Action Dash, naming the spell', () => {
    const state = fold('seed', GAGGED);
    // Both halves are in hand: the spell's, stored, and the feature's, derived.
    expect(state.creatures[ROGUE]?.actionRules).toHaveLength(1);
    // Stinking Cloud's, Cunning Action's three, and Fast Hands' Utilize.
    expect(actionRulesOn(state, ROGUE)).toHaveLength(5);
    expect(actionRulesOn(state, ROGUE)[0]?.label).toBe('Stinking Cloud');

    const refused = takeDash(state, ROGUE, {}, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    expect(isErr(refused) && refused.reason).toContain('Stinking Cloud');
    expect(isErr(refused) && refused.reason).toContain('the spell ends');
  });

  it('refuses the ordinary Action price the same way', () => {
    const refused = takeDash(fold('seed', GAGGED), ROGUE, {});
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
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

/**
 * The guard that keeps the door from being a way to write data nothing reads.
 *
 * `checkSpellDefinition` has refused an allowance outside `STATABLE_PRICES`
 * since Conjure Woodland Beings, and a feature holding one is the same clause
 * from the other side: a homebrew class offering a cheap Dodge would compile
 * onto the sheet, be handed back by `actionRulesOn` and be honoured by
 * nothing — "an allowance nobody can ask for is data no code reads". So
 * `checkFeatureDefinition` asks the same function rather than a second copy of
 * it, and the author is told at the door.
 */
describe('a feature may not hold a price no command charges', () => {
  const holding = (rule: unknown): FeatureDefinition =>
    ({
      id: 'brigand:light-footed',
      name: 'Light Footed',
      level: 2,
      automation: 'engine',
      note: 'A homebrew class that buys an action with a cheaper slot.',
      grants: { kind: 'standing', reach: 'self', effects: [{ kind: 'action-rule', rule }] },
    }) as FeatureDefinition;

  const codes = (rule: unknown): readonly string[] =>
    checkFeatureDefinition(holding(rule), {
      levels: MAX_LEVEL,
      readableGrants: READABLE_GRANT_KINDS,
      readableFields: READABLE_FEATURE_FIELDS,
      spellExists: () => true,
    }).map((problem) => problem.code);

  it('takes the four the commands do charge', () => {
    expect(codes({ kind: 'allows', action: 'dash', from: 'bonus-action' })).toEqual([]);
    expect(codes({ kind: 'allows', action: 'disengage', from: 'bonus-action' })).toEqual([]);
    expect(codes({ kind: 'allows', action: 'hide', from: 'bonus-action' })).toEqual([]);
    // The fourth, and the one SRD Fast Hands needed: `takeUtilize` charges a
    // Bonus Action where something has allowed it.
    expect(codes({ kind: 'allows', action: 'utilize', from: 'bonus-action' })).toEqual([]);
  });

  it('refuses a Dodge nothing will charge a Bonus Action for', () => {
    expect(codes({ kind: 'allows', action: 'dodge', from: 'bonus-action' })).toContain(
      'bad_action_rule',
    );
  });

  /**
   * A Search is a named action now and still has no cheaper price: `takeSearch`
   * charges an Action and nothing else, so an allowance offering one out of a
   * Bonus Action is a permission no command could honour. That is
   * `STATABLE_PRICES`' half of the guard rather than `NAMED_ACTIONS`'.
   */
  it('refuses a price no command charges, for an action it does name', () => {
    expect(codes({ kind: 'allows', action: 'search', from: 'bonus-action' })).toContain(
      'bad_action_rule',
    );
  });

  it('refuses a rule that forbids nothing at all', () => {
    expect(codes({ kind: 'forbids' })).toContain('bad_action_rule');
  });

  /**
   * **Both spellings of a standing effect**, because there are two and
   * creation compiles both onto the sheet: `standing.effects` and an
   * `activated` grant's `whileActive`. A guard on one of them is a rule
   * enforced on whichever spelling the author happened not to use.
   */
  it('asks the same of a rule that runs only while the feature is active', () => {
    const whileRaging = (rule: unknown): FeatureDefinition =>
      ({
        id: 'brigand:reckless-dash',
        name: 'Reckless Dash',
        level: 2,
        automation: 'engine',
        note: 'A homebrew class whose switched-on feature buys an action cheaply.',
        grants: {
          kind: 'activated',
          feature: 'brigand:reckless-dash',
          action: 'bonus-action',
          pool: null,
          lasts: 'end-of-next-turn',
          whileActive: [{ kind: 'action-rule', rule }],
        },
      }) as FeatureDefinition;

    const codesOf = (rule: unknown): readonly string[] =>
      checkFeatureDefinition(whileRaging(rule), {
        levels: MAX_LEVEL,
        readableGrants: READABLE_GRANT_KINDS,
        readableFields: READABLE_FEATURE_FIELDS,
        spellExists: () => true,
      }).map((problem) => problem.code);

    expect(codesOf({ kind: 'allows', action: 'dash', from: 'bonus-action' })).toEqual([]);
    expect(codesOf({ kind: 'allows', action: 'dodge', from: 'bonus-action' })).toContain(
      'bad_action_rule',
    );
  });
});

/**
 * And the third door onto the same vocabulary: a magic item.
 *
 * `ITEM_EFFECT_KINDS` admits `action-rule` because `itemStandingOf` feeds a
 * worn item's pinned grants into `standingFor`, which is where `actionRulesOn`
 * reads them — so boots whose wearer may Dash out of a Bonus Action are
 * executed rather than transcribed and ignored. The same admission is what
 * makes the guard necessary, and one case is worse here than on a feature: a
 * rule that is not an object at all reaches `allowsPrice`, which reads its
 * `kind`, and a content error would arrive as an exception rather than as the
 * refusal rule 6 asks for.
 */
describe('an item may not grant a rule nothing reads either', () => {
  const boots = (effect: unknown): string =>
    JSON.stringify({
      items: [
        {
          id: 'boots-of-the-quick',
          name: 'Boots of the Quick',
          kind: 'gear',
          priceCopper: 100,
          weightLb: 1,
          grants: [{ kind: 'standing', reach: 'self', effects: [effect] }],
        },
      ],
    });

  const codesOf = (effect: unknown): readonly string[] => {
    const loaded = loadContent(JSON.parse(boots(effect)) as Parameters<typeof loadContent>[0]);
    return isErr(loaded) ? [loaded.code, loaded.reason] : [];
  };

  it('takes a price a command charges', () => {
    expect(codesOf({ kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } })).toEqual([]);
  });

  // `loadContent` reports one refusal for the whole file, so what a test can
  // read is the sentence: the path to the clause and the reason for it.
  it('refuses one no command charges', () => {
    const said = codesOf({
      kind: 'action-rule',
      rule: { kind: 'allows', action: 'dodge', from: 'bonus-action' },
    }).join(' ');
    expect(said).toContain('grants[0].effects[0].rule');
    expect(said).toContain('no command will charge bonus-action for the dodge action');
  });

  it('refuses a rule that is no rule, rather than throwing at the first spend', () => {
    expect(codesOf({ kind: 'action-rule' }).join(' ')).toContain(
      'a rule about a turn is an object saying what it forbids, permits or allows',
    );
  });
});
