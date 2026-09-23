/**
 * The five actions the glossary prints that no spender could tell apart.
 *
 * `combat.ts` named Search, Study, Influence, Ready and Utilize as absent "for
 * the reason Hide was: no spender could be told one of them apart". Ready
 * turned out to exist; the other four arrive here with their spenders, and
 * Help — which had only its stabilisation half — with them.
 *
 * What each of them has to prove is the same thing: the right slot goes, a
 * spent slot refuses, and what the action *buys* is the engine's rather than a
 * sentence in a note. Help is the one that buys something lasting, so it is
 * the one with the most here: a one-shot Advantage that the ally's next roll
 * spends and the helper's next turn ends, on the skill or the enemy the Help
 * named and on nothing else.
 */
import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { planCharacter, type CharacterChoices } from './creation.js';
import { NAMED_ACTIONS, STATABLE_PRICES } from './combat.js';
import {
  resolveAttack,
  resolveTest,
  resolveTurn,
  takeHelp,
  takeInfluence,
  takeSearch,
  takeStudy,
  takeUtilize,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const HELPER = id('helper');
const ALLY = id('ally');
const FOE = id('foe');
const OTHER_FOE = id('other-foe');
const THIEF = id('thief');
const PLAIN_ROGUE = id('plain-rogue');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 14, wis: 14, cha: 14 },
  skills: { perception: 'proficient', arcana: 'proficient', persuasion: 'proficient' },
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, character: CharacterSheet = sheet()): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: character,
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const rogueChoices = (subclass: string | undefined, level: number): CharacterChoices => ({
  name: 'Pip',
  speciesId: 'human',
  backgroundId: 'sage',
  alignment: 'Neutral',
  languages: ['Elvish', 'Dwarvish'],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  classId: 'rogue',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  ...(subclass === undefined ? {} : { subclassId: subclass }),
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
});

const built = (choices: CharacterChoices): CharacterSheet =>
  unwrap(planCharacter(SRD_CONTENT, choices), choices.classId).sheet;

const SETUP: readonly GameEvent[] = [
  added(HELPER),
  added(ALLY),
  added(FOE),
  added(OTHER_FOE),
  added(THIEF, built(rogueChoices('thief', 3))),
  added(PLAIN_ROGUE, built(rogueChoices(undefined, 2))),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: HELPER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: HELPER }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: HELPER }, feet: 5, bearing: 0 } },
  {
    type: 'creature-placed',
    id: OTHER_FOE,
    placement: { from: { creature: HELPER }, feet: 5, bearing: 180 },
  },
  { type: 'creature-placed', id: THIEF, placement: { from: { creature: HELPER }, feet: 15, bearing: 45 } },
  {
    type: 'creature-placed',
    id: PLAIN_ROGUE,
    placement: { from: { creature: HELPER }, feet: 20, bearing: 45 },
  },
  { type: 'sight-declared', from: ALLY, to: FOE, seen: true },
  { type: 'sight-declared', from: ALLY, to: OTHER_FOE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: HELPER, initiative: 30, speed: 30 },
      { id: ALLY, initiative: 25, speed: 30 },
      { id: THIEF, initiative: 20, speed: 30 },
      { id: PLAIN_ROGUE, initiative: 15, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
      { id: OTHER_FOE, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'glossary actions');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const budget = (state: GameState, who: CharacterId) => state.combat?.budgets[who];

/** Advance the order until it is this creature's turn. */
const untilTurnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let all = log;
  for (let step = 0; step < 24; step += 1) {
    const state = fold('seed', all);
    if (state.combat?.order[state.combat.turnIndex]?.id === who) return all;
    all = [...all, ...must(resolveTurn(fold('seed', all), supply(`turn:${step}`))).events];
  }
  throw new Error(`the order never reached ${who}`);
};

/** The same, but always past the turn in progress. */
const untilNextTurnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] =>
  untilTurnOf(
    [...log, ...must(resolveTurn(fold('seed', log), supply('past-this-one'))).events],
    who,
  );

const modifiersOn = (state: GameState, who: CharacterId) =>
  state.creatures[who]?.rollModifiers ?? [];

describe('the five arrive as named actions with prices something can state', () => {
  it('names each of them, so a rule may forbid or permit one by name', () => {
    for (const action of ['help', 'influence', 'search', 'study', 'utilize'] as const) {
      expect([...NAMED_ACTIONS]).toContain(action);
    }
  });

  /**
   * SRD Fast Hands is the whole of why `utilize` is the one with a stateable
   * price: "you can use the Utilize action as a Bonus Action."
   */
  it('prices only the Utilize out of a Bonus Action', () => {
    expect(STATABLE_PRICES.utilize).toEqual(['bonus-action']);
    expect(STATABLE_PRICES.search).toBeUndefined();
    expect(STATABLE_PRICES.study).toBeUndefined();
    expect(STATABLE_PRICES.help).toBeUndefined();
    expect(STATABLE_PRICES.influence).toBeUndefined();
  });
});

describe('Utilize spends an action, and a Thief spends a Bonus Action', () => {
  it('takes the Action and refuses a second one', () => {
    const state = fold('seed', SETUP);
    const first = must(takeUtilize(state, HELPER, { object: 'the lever' }));
    const after = applyAll(state, first);
    expect(budget(after, HELPER)?.action).toBe(false);

    const again = takeUtilize(after, HELPER, { object: 'the other lever', commandId: 'second' });
    expect(isErr(again) && again.code).toBe('no_action');
  });

  /** And the free interaction is untouched: Utilize is what buys the second. */
  it('leaves the turn’s one free object interaction where it was', () => {
    const state = fold('seed', SETUP);
    const after = applyAll(state, must(takeUtilize(state, HELPER, {})));
    expect(budget(after, HELPER)?.freeInteraction).toBe(true);
  });

  it('lets a Thief pay from a Bonus Action and refuses a Rogue without Fast Hands', () => {
    const thiefTurn = untilTurnOf(SETUP, THIEF);
    const state = fold('seed', thiefTurn);
    const took = must(takeUtilize(state, THIEF, { from: 'bonus-action' }));
    const after = applyAll(state, took);
    expect(budget(after, THIEF)?.bonusAction).toBe(false);
    expect(budget(after, THIEF)?.action).toBe(true);

    const plainTurn = untilTurnOf(thiefTurn, PLAIN_ROGUE);
    const refused = takeUtilize(fold('seed', plainTurn), PLAIN_ROGUE, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');
  });

  it('refuses a price no command charges', () => {
    const refused = takeUtilize(fold('seed', SETUP), HELPER, { from: 'reaction' });
    expect(isErr(refused) && refused.code).toBe('no_such_price');
  });
});

describe('Search and Study spend the action and roll the check the book prints', () => {
  it('rolls a Wisdom check on a skill Search names', () => {
    const state = fold('seed', SETUP);
    const found = must(takeSearch(state, HELPER, { skill: 'perception', dc: 10 }, supply('s')));
    expect(found.check).not.toBeNull();
    const after = applyAll(state, found.events);
    expect(budget(after, HELPER)?.action).toBe(false);

    const again = takeSearch(after, HELPER, { skill: 'perception', dc: 10, commandId: 'b' }, supply('s'));
    expect(isErr(again) && again.code).toBe('no_action');
  });

  it('refuses a skill the Search action does not name', () => {
    const refused = takeSearch(
      fold('seed', SETUP),
      HELPER,
      { skill: 'arcana', dc: 10 },
      supply('s'),
    );
    expect(isErr(refused) && refused.code).toBe('wrong_skill');
  });

  it('rolls an Intelligence check on a skill Study names', () => {
    const state = fold('seed', SETUP);
    const learned = must(takeStudy(state, HELPER, { skill: 'arcana', dc: 10 }, supply('t')));
    expect(learned.check).not.toBeNull();
    expect(applyAll(state, learned.events).combat?.budgets[HELPER]?.action).toBe(false);
  });

  it('refuses a skill the Study action does not name', () => {
    const refused = takeStudy(
      fold('seed', SETUP),
      HELPER,
      { skill: 'perception', dc: 10 },
      supply('t'),
    );
    expect(isErr(refused) && refused.code).toBe('wrong_skill');
  });

  /**
   * SRD Stinking Cloud and its kin write `forbids`, and `permits-only` narrows
   * a slot to a named few. A named action nothing could name was the reason
   * these five were left out, so the rule biting is the proof they are in.
   */
  it('is refused by a rule that forbids it by name', () => {
    const forbidden = applyAll(fold('seed', SETUP), [
      {
        type: 'action-rule-granted',
        id: HELPER,
        rule: {
          rule: { kind: 'forbids', actions: ['study'] },
          label: 'a spell',
          source: 'test',
          until: 'the end of the fight',
        },
      },
    ]);
    const refused = takeStudy(forbidden, HELPER, { skill: 'arcana', dc: 10 }, supply('t'));
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    // And the Search beside it is untouched, which is what naming actions buys.
    expect(must(takeSearch(forbidden, HELPER, { skill: 'perception', dc: 10 }, supply('s'))).check)
      .not.toBeNull();
  });
});

describe('Influence spends the action and rolls a Charisma check the DM set a DC for', () => {
  it('rolls, spends and hands the attitude back', () => {
    const state = fold('seed', SETUP);
    const swayed = must(
      takeInfluence(state, HELPER, { skill: 'persuasion', dc: 12, target: FOE }, supply('i')),
    );
    expect(swayed.check).not.toBeNull();
    expect(swayed.unverified.join(' ')).toMatch(/attitude/i);
    expect(applyAll(state, swayed.events).combat?.budgets[HELPER]?.action).toBe(false);
  });

  it('refuses a skill Influence does not name', () => {
    const refused = takeInfluence(
      fold('seed', SETUP),
      HELPER,
      { skill: 'arcana', dc: 12, target: FOE },
      supply('i'),
    );
    expect(isErr(refused) && refused.code).toBe('wrong_skill');
  });
});

describe('Help hangs Advantage the ally spends and the helper’s next turn ends', () => {
  const helped = (kind: 'attack' | 'check') =>
    must(
      takeHelp(
        fold('seed', SETUP),
        HELPER,
        kind === 'attack'
          ? { kind: 'attack', ally: ALLY, enemy: FOE }
          : { kind: 'check', ally: ALLY, skill: 'perception' },
      ),
    ).events;

  it('spends the Action and hangs one one-shot Advantage on the ally', () => {
    const after = applyAll(fold('seed', SETUP), helped('attack'));
    expect(budget(after, HELPER)?.action).toBe(false);

    const held = modifiersOn(after, ALLY);
    expect(held).toHaveLength(1);
    expect(held[0]?.modifier.mode).toBe('advantage');
    expect(held[0]?.modifier.oneShot).toBe(true);
    expect(held[0]?.modifier.selector).toMatchObject({
      roll: 'attack',
      relation: 'roller',
      counterpart: FOE,
    });
  });

  it('is spent by the ally’s next attack on that enemy and by nothing else', () => {
    const log = [...SETUP, ...helped('attack')];
    const allyTurn = fold('seed', untilTurnOf(log, ALLY));

    // The other enemy is not what the Help named, so the grant stands.
    const elsewhere = must(
      resolveAttack(
        allyTurn,
        ALLY,
        { target: OTHER_FOE, weapon: null, free: true },
        supply('elsewhere'),
      ),
    );
    expect(elsewhere.attack?.roll.mode).toBe('normal');
    expect(modifiersOn(applyAll(allyTurn, elsewhere.events), ALLY)).toHaveLength(1);

    const onTarget = must(
      resolveAttack(allyTurn, ALLY, { target: FOE, weapon: null, free: true }, supply('on')),
    );
    expect(onTarget.attack?.roll.mode).toBe('advantage');
    expect(modifiersOn(applyAll(allyTurn, onTarget.events), ALLY)).toEqual([]);
  });

  /** "This benefit expires at the start of your next turn." */
  it('expires at the start of the helper’s next turn', () => {
    const log = untilNextTurnOf([...SETUP, ...helped('attack')], HELPER);
    expect(modifiersOn(fold('seed', log), ALLY)).toEqual([]);
  });

  it('gives the ally Advantage on the named skill and spends it there', () => {
    const log = [...SETUP, ...helped('check')];
    const state = fold('seed', log);
    const held = modifiersOn(state, ALLY);
    expect(held[0]?.modifier.selector).toMatchObject({
      roll: 'ability-check',
      relation: 'roller',
      skill: 'perception',
    });

    const wrongSkill = must(
      resolveTest(
        state,
        ALLY,
        { kind: 'ability-check', ability: 'int', skill: 'arcana', dc: 10 },
        supply('wrong'),
      ),
    );
    expect(wrongSkill.test?.mode).toBe('normal');
    expect(modifiersOn(applyAll(state, wrongSkill.events), ALLY)).toHaveLength(1);

    const right = must(
      resolveTest(
        state,
        ALLY,
        { kind: 'ability-check', ability: 'wis', skill: 'perception', dc: 10, commandId: 'right' },
        supply('right'),
      ),
    );
    expect(right.test?.mode).toBe('advantage');
    expect(modifiersOn(applyAll(state, right.events), ALLY)).toEqual([]);
  });

  it('refuses a helper who is not proficient with the skill they offered', () => {
    const refused = takeHelp(fold('seed', SETUP), HELPER, {
      kind: 'check',
      ally: ALLY,
      skill: 'survival',
    });
    expect(isErr(refused) && refused.code).toBe('not_proficient');
  });

  it('refuses a creature helping itself', () => {
    const refused = takeHelp(fold('seed', SETUP), HELPER, {
      kind: 'attack',
      ally: HELPER,
      enemy: FOE,
    });
    expect(isErr(refused) && refused.code).toBe('no_ally');
  });

  it('refuses an enemy further than five feet away', () => {
    const far = applyAll(fold('seed', SETUP), [
      {
        type: 'creature-moved',
        id: FOE,
        placement: { from: { creature: HELPER }, feet: 30, bearing: 0 },
        forced: true,
      },
    ]);
    const refused = takeHelp(far, HELPER, { kind: 'attack', ally: ALLY, enemy: FOE });
    expect(isErr(refused) && refused.code).toBe('out_of_reach');
  });

  it('refuses a second Help once the Action is gone', () => {
    const after = applyAll(fold('seed', SETUP), helped('attack'));
    const again = takeHelp(after, HELPER, {
      kind: 'attack',
      ally: ALLY,
      enemy: OTHER_FOE,
      commandId: 'second',
    });
    expect(isErr(again) && again.code).toBe('no_action');
  });
});
