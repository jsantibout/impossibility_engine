/**
 * A move a feature hands its holder.
 *
 * SRD Tactical Shift: "Whenever you activate your Second Wind with a Bonus
 * Action, you can move up to half your Speed without provoking Opportunity
 * Attacks."
 *
 * **Three things the engine had and none of them was this.** A Dash *banks*
 * feet the creature then spends out of its own Speed; `MoveCommand.forced` is
 * movement somebody else is doing to you, which spends no Speed and provokes
 * nobody and also legalises ending in an occupied space; and a Cunning Action
 * re-prices a Dash without handing over a foot. What this needed was a third
 * counter — feet the turn holds, spent out of nothing, provoking nobody, and
 * gone when the turn is.
 *
 * The content side is the smallest sentence that could say it: Second Wind's
 * `heals` block carries the rider, naming the feature whose level hands it
 * over, exactly as a pool's `recoversSooner` names the feature that rewrites
 * its recovery. Tactical Shift itself declares nothing and says so —
 * `executedBy` is the member for a feature another's declaration executes.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { resolveMove, resolveTurn, useSelfHeal } from './commands.js';

const id = (s: string) => asCharacterId(s);
const BRAM = id('bram');
const ORC = id('orc');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'tactical shift');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const fighter = (level: number): CharacterChoices => ({
  name: 'Bram',
  speciesId: 'human',
  backgroundId: 'soldier',
  alignment: 'Neutral',
  languages: ['Dwarvish', 'Orc'],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  classId: 'fighter',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'perception'],
  subclassId: level >= 3 ? 'champion' : undefined,
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['survival'],
    'fighter:fighting-style': ['great-weapon-fighting'],
    'fighter:weapon-mastery': ['greatsword', 'longsword', 'handaxe'],
  },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'great-weapon-fighting' },
    'fighter:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['str', 'con'],
    },
  },
});

const born = (who: CharacterId, level: number): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, fighter(level), who), 'fighter');

/** The Fighter, wounded so a Second Wind is worth taking, and an orc at his elbow. */
const field = (level: number): readonly GameEvent[] => [
  ...born(BRAM, level),
  ...born(ORC, 1),
  // Sides, because an Opportunity Attack is offered to an enemy and
  // `createCharacter` declares nobody's: without them the move below would
  // provoke nothing whatever the rule said, and the test would pass on an
  // absence rather than on the rule.
  { type: 'creature-side-declared', id: BRAM, side: 'party' },
  { type: 'creature-side-declared', id: ORC, side: 'foes' },
  { type: 'damage-taken', id: BRAM, amount: 20 },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  { type: 'creature-placed', id: ORC, placement: { from: { creature: BRAM }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: ORC, to: BRAM, seen: true },
  { type: 'sight-declared', from: BRAM, to: ORC, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: BRAM, initiative: 20, speed: 30 },
      { id: ORC, initiative: 5, speed: 30 },
    ],
  },
];

const budget = (state: GameState) => state.combat?.budgets[BRAM];

const secondWind = (state: GameState) =>
  must(useSelfHeal(state, BRAM, { feature: 'fighter:second-wind' }, supply('wind')));

/** Away from the orc, so the move would provoke if anything could. */
const away = (feet: number) =>
  ({ from: { creature: ORC }, feet: 5 + feet, bearing: 180 }) as const;

describe('Second Wind hands a level 5 Fighter half a Speed of movement', () => {
  it('grants 15 feet to a Speed of 30, and nothing at level 1', () => {
    const five = applyAll(fold('seed', field(5)), secondWind(fold('seed', field(5))));
    expect(budget(five)?.grantedMoves).toEqual([{ source: 'feature:fighter:tactical-shift', feet: 15 }]);

    const one = applyAll(fold('seed', field(1)), secondWind(fold('seed', field(1))));
    expect(budget(one)?.grantedMoves).toEqual([]);
  });

  it('spends no Speed and provokes nobody', () => {
    const state = applyAll(fold('seed', field(5)), secondWind(fold('seed', field(5))));
    const moved = must(
      resolveMove(
        state,
        BRAM,
        { placement: away(15), usingGrant: 'feature:fighter:tactical-shift' },
        supply('move'),
      ),
    );
    // Nothing was held open for an Opportunity Attack, and the move is done.
    expect(moved.events.some((e) => e.type === 'movement-declared')).toBe(false);
    expect(moved.events.some((e) => e.type === 'creature-moved')).toBe(true);

    // And the same walk on the turn's own Speed **is** held, which is what
    // makes the line above a rule rather than an absence: the orc is an enemy,
    // it is in reach, and it holds its Reaction.
    const walked = must(resolveMove(state, BRAM, { placement: away(15) }, supply('walk')));
    expect(walked.events.some((e) => e.type === 'movement-declared')).toBe(true);

    const after = applyAll(state, moved.events);
    expect(budget(after)?.movementSpent).toBe(0);
    expect(budget(after)?.grantedMoves).toEqual([
      { source: 'feature:fighter:tactical-shift', feet: 0 },
    ]);
  });

  it('refuses twenty feet, because half a Speed of 30 is fifteen', () => {
    const state = applyAll(fold('seed', field(5)), secondWind(fold('seed', field(5))));
    const refused = resolveMove(
      state,
      BRAM,
      { placement: away(20), usingGrant: 'feature:fighter:tactical-shift' },
      supply('move'),
    );
    expect(isErr(refused) && refused.code).toBe('not_enough_movement');
  });

  /**
   * `MoveCommand.forced` is the other way to spend no Speed and provoke
   * nobody, and it is **not** this: it also legalises ending in an occupied
   * space, which SRD forbids only *willingly* and a Tactical Shift is
   * entirely willing.
   */
  it('may not end in an occupied space', () => {
    const state = applyAll(fold('seed', field(5)), secondWind(fold('seed', field(5))));
    const refused = resolveMove(
      state,
      BRAM,
      {
        // Named bearing and no distance: the orc's own space, asked for
        // outright rather than swept for by a placement with nowhere stated.
        placement: { from: { creature: ORC }, feet: 0, bearing: 0 },
        usingGrant: 'feature:fighter:tactical-shift',
      },
      supply('move'),
    );
    expect(isErr(refused) && refused.code).toBe('occupied');
  });

  it('refuses a grant nothing handed over', () => {
    const refused = resolveMove(
      fold('seed', field(5)),
      BRAM,
      { placement: away(10), usingGrant: 'feature:fighter:tactical-shift' },
      supply('move'),
    );
    expect(isErr(refused) && refused.code).toBe('no_such_grant');
  });

  it('is gone at the end of the turn', () => {
    const start = field(5);
    let log: readonly GameEvent[] = [...start, ...secondWind(fold('seed', start))];
    for (let step = 0; step < 2; step += 1) {
      log = [...log, ...must(resolveTurn(fold('seed', log), supply(`turn${step}`))).events];
    }
    expect(budget(fold('seed', log))?.grantedMoves).toEqual([]);
  });

  /** And an ordinary move still spends Speed, which is what a grant is not. */
  it('leaves the turn’s own movement where it was', () => {
    const state = applyAll(fold('seed', field(5)), secondWind(fold('seed', field(5))));
    const walked = must(resolveMove(state, BRAM, { placement: away(15) }, supply('walk')));
    const after = applyAll(state, walked.events);
    expect(after.combat?.budgets[BRAM]?.movementSpent).toBe(15);
    expect(after.combat?.budgets[BRAM]?.grantedMoves).toEqual([
      { source: 'feature:fighter:tactical-shift', feet: 15 },
    ]);
  });
});
