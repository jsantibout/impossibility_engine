import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  resolveAttack,
  resolveTurn,
  takeDash,
  takeDisengage,
  takeDodge,
  useBudgetPurchase,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { grantTurnBudget, spendAction } from './combat.js';

/**
 * What a feature adds to a turn's own budget.
 *
 * The economy held one action, one Bonus Action and the attacks an Attack
 * action carries, and three SRD sentences add to it: Action Surge's "you can
 * take one additional action", Flurry of Blows' "two Unarmed Strikes as a
 * Bonus Action", and Haste's extra action — which is the same sentence from a
 * spell. Each was declared `manual` or not declared at all, because a feature
 * that bought one had nowhere to put it: an extra action carried on the
 * *creature* is invisible to `fold/combat.ts`, which folds `action-spent`
 * through `must(event, spendAction(...))` and throws on a refusal. So it lives
 * in the {@link TurnBudget}, which only a combat event writes.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const MONK = id('monk');
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

const fighter = (level: number): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const monk = (level: number): CharacterChoices => ({
  name: 'Wen',
  classId: 'monk',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 13, dex: 15, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['acrobatics', 'stealth'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'warrior-of-the-open-hand',
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
    'monk:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** The character, a goblin to swing at, and a fight the character opens. */
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
  { type: 'items-gained', id: who, items: [{ id: 'longsword', quantity: 1 }], source: 'loot' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: who }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: GOBLIN, to: who, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

type CharacterId = ReturnType<typeof id>;

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Run a command and hand back the longer log. */
const step = (
  log: readonly GameEvent[],
  run: (state: GameState) => ReturnType<typeof takeDodge>,
): readonly GameEvent[] => [...log, ...unwrap(run(fold('seed', log)), 'step')];

const budget = (log: readonly GameEvent[], who: CharacterId) =>
  fold('seed', log).combat?.budgets[who];

/** The refusal's own code, so a test names the rule rather than its shape. */
const refusal = (out: { readonly ok: boolean } & Partial<{ readonly code: string }>): string =>
  out.ok ? 'it was allowed' : (out.code ?? '');

describe('an extra action a feature buys', () => {
  const surge = (log: readonly GameEvent[], commandId?: string) =>
    useBudgetPurchase(
      fold('seed', log),
      FIGHTER,
      { feature: 'fighter:action-surge', purchase: 'action-surge', ...(commandId === undefined ? {} : { commandId }) },
    );

  it('lets a level 5 Fighter take a second action, and refuses a third', () => {
    let log = table(FIGHTER, fighter(5));
    log = step(log, (s) => takeDodge(s, FIGHTER, { commandId: 'first' }));
    expect(budget(log, FIGHTER)?.action).toBe(false);

    // Nothing has been added yet, so the second Dodge is refused.
    expect(isErr(takeDodge(fold('seed', log), FIGHTER, { commandId: 'second' }))).toBe(true);

    log = [...log, ...unwrap(surge(log), 'surge')];
    log = step(log, (s) => takeDash(s, FIGHTER, { commandId: 'second' }));

    // And a third: the surge bought one action, not an open turn.
    const third = takeDisengage(fold('seed', log), FIGHTER, { commandId: 'third' });
    expect(refusal(third)).toBe('no_action');
    expect(budget(log, FIGHTER)?.extraActions).toEqual([]);
  });

  it('spends the use from its own pool, and refuses when the pool is empty', () => {
    let log = table(FIGHTER, fighter(5));
    log = [...log, ...unwrap(surge(log, 'once'), 'surge')];
    expect(fold('seed', log).creatures.fighter?.resources.pools['action-surge']?.spent).toBe(1);

    // SRD at Fighter 17: "you can use it twice before a rest but **only once
    // on a turn**." The same turn refuses before the pool is even consulted.
    expect(refusal(surge(log, 'twice'))).toBe('already_used');

    // A round later the turn clause is spent and the pool is what refuses: a
    // Fighter 5 has one use.
    for (const commandId of ['to-goblin', 'back-to-fighter']) {
      const resolved = unwrap(resolveTurn(fold('seed', log), supply(), { commandId }), 'turn');
      log = [...log, ...resolved.events];
    }
    expect(refusal(surge(log, 'thrice'))).toBe('exhausted');
    // Nothing else moved: a refused surge costs neither the action nor a use.
    expect(fold('seed', log).creatures.fighter?.resources.pools['action-surge']?.spent).toBe(1);
    expect(budget(log, FIGHTER)?.action).toBe(true);
  });

  it('gives the budget back to one action on the next turn', () => {
    let log = table(FIGHTER, fighter(5));
    log = [...log, ...unwrap(surge(log), 'surge')];
    expect(budget(log, FIGHTER)?.extraActions).toHaveLength(1);

    for (const commandId of ['to-goblin', 'back-to-fighter']) {
      const resolved = unwrap(resolveTurn(fold('seed', log), supply(), { commandId }), 'turn');
      log = [...log, ...resolved.events];
    }
    expect(budget(log, FIGHTER)?.extraActions).toEqual([]);
    expect(budget(log, FIGHTER)?.action).toBe(true);
  });

  /**
   * The load-bearing one. `fold/combat.ts` folds `action-spent` through
   * `must(event, spendAction(...))`, which throws on a refusal — so a log
   * holding a second action replays only if the extra is in the budget the
   * fold itself rebuilds.
   */
  it('folds and replays a log holding the extra action, byte for byte', () => {
    let log = table(FIGHTER, fighter(5));
    log = step(log, (s) => takeDodge(s, FIGHTER, { commandId: 'first' }));
    log = [...log, ...unwrap(surge(log), 'surge')];
    log = step(log, (s) => takeDash(s, FIGHTER, { commandId: 'second' }));

    const once = JSON.stringify(fold('seed', log));
    const twice = JSON.stringify(fold('seed', log));
    expect(twice).toBe(once);
    expect(fold('seed', log).combat?.budgets.fighter?.action).toBe(false);
  });

  /**
   * SRD Action Surge: "you can take one additional action, **except the Magic
   * action**." The budget spends the turn's own action first, so a Magic
   * action reaches the extra one only when the first is already gone — and
   * that is the case the exception is about.
   */
  it('refuses the Magic action out of the extra one', () => {
    let log = table(FIGHTER, fighter(5));
    log = step(log, (s) => takeDodge(s, FIGHTER, { commandId: 'first' }));
    log = [...log, ...unwrap(surge(log), 'surge')];

    const state = fold('seed', log);
    const extra = state.combat?.budgets.fighter?.extraActions ?? [];
    expect(extra).toHaveLength(1);
    expect(extra[0]?.except).toEqual(['magic']);

    // And the exception bites rather than being decoration: the same budget
    // pays for a Dodge and refuses a Magic action, because the turn's own
    // action has already gone and only the narrowed one is left.
    const combat = state.combat!;
    expect(refusal(spendAction(combat, FIGHTER, undefined, { rules: [], as: 'magic' }))).toBe(
      'action_forbidden',
    );
    expect(spendAction(combat, FIGHTER, undefined, { rules: [], as: 'dodge' }).ok).toBe(true);
  });

  /** A purchase the feature does not sell. */
  it('refuses a purchase the feature never printed', () => {
    const log = table(FIGHTER, fighter(5));
    const out = useBudgetPurchase(fold('seed', log), FIGHTER, {
      feature: 'fighter:action-surge',
      purchase: 'a-third-wind',
    });
    expect(refusal(out)).toBe('no_such_purchase');
  });

  /**
   * The primitive's own two refusals, which no catalogue can produce today and
   * a homebrew one could: a grant that grants nothing, and a second set of
   * attacks under a different rule about what may swing them while the first
   * is still standing.
   */
  it('refuses a grant of nothing, and two granted sets that disagree', () => {
    const log = table(MONK, monk(5));
    const combat = fold('seed', log).combat!;

    expect(refusal(grantTurnBudget(combat, MONK, {}))).toBe('nothing_granted');

    const flurried = unwrap(
      grantTurnBudget(combat, MONK, { attacks: { remaining: 2, unarmedOnly: true } }),
      'flurry',
    );
    expect(
      refusal(grantTurnBudget(flurried, MONK, { attacks: { remaining: 1, unarmedOnly: false } })),
    ).toBe('attacks_outstanding');
    // The same gate stacks, which is the case that is not a disagreement.
    expect(
      grantTurnBudget(flurried, MONK, { attacks: { remaining: 1, unarmedOnly: true } }).ok,
    ).toBe(true);
  });
});

describe('the attacks a feature buys outside the Attack action', () => {
  const flurry = (log: readonly GameEvent[], commandId?: string) =>
    useBudgetPurchase(
      fold('seed', log),
      MONK,
      { feature: 'monk:focus', purchase: 'flurry-of-blows', ...(commandId === undefined ? {} : { commandId }) },
    );

  const strike = (log: readonly GameEvent[], seed: string, weapon: string | null = null) => {
    const out = unwrap(
      resolveAttack(fold('seed', log), MONK, { target: GOBLIN, weapon }, supply(seed)),
      'strike',
    );
    return [...log, ...out.events];
  };

  it('buys a level 5 Monk two Unarmed Strikes for a Focus Point', () => {
    let log = table(MONK, monk(5));
    log = [...log, ...unwrap(flurry(log), 'flurry')];

    // The Bonus Action went with the point, and two strikes are waiting.
    expect(budget(log, MONK)?.bonusAction).toBe(false);
    expect(budget(log, MONK)?.grantedAttacks?.remaining).toBe(2);
    expect(fold('seed', log).creatures.monk?.resources.pools['focus-points']?.spent).toBe(1);

    log = strike(log, 'one');
    log = strike(log, 'two');
    expect(budget(log, MONK)?.grantedAttacks?.remaining).toBe(0);
    // Neither strike took the Attack action, which is the whole of the rule.
    expect(budget(log, MONK)?.action).toBe(true);
    expect(JSON.stringify(fold('seed', log))).toBe(JSON.stringify(fold('seed', log)));
  });

  it('refuses a Monk with no points left', () => {
    let log = table(MONK, monk(5));
    // A Monk 5 has five Focus Points; spend them all, then ask for a sixth.
    for (let i = 0; i < 5; i += 1) {
      log = [
        ...log,
        { type: 'resource-spent', id: MONK, key: 'focus-points', amount: 1 },
      ];
    }
    const out = flurry(log);
    expect(refusal(out)).toBe('exhausted');
    expect(budget(log, MONK)?.bonusAction).toBe(true);
  });

  /** "two **Unarmed Strikes**" — a longsword is not one of them. */
  it('gives the two strikes to Unarmed Strikes and to nothing else', () => {
    let log = table(MONK, monk(5));
    log = [...log, ...unwrap(flurry(log), 'flurry')];

    // A weapon swing does not come out of the flurry: it takes the Attack
    // action, exactly as it would have without one.
    log = strike(log, 'sword', 'longsword');
    expect(budget(log, MONK)?.grantedAttacks?.remaining).toBe(2);
    expect(budget(log, MONK)?.action).toBe(false);
  });
});
