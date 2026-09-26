/**
 * **One ooze that becomes two** — W7-B12.
 *
 * SRD Black Pudding, Split: "_Trigger:_ While the pudding is Large or Medium and
 * has 10+ Hit Points, it becomes Bloodied or is subjected to Lightning or
 * Slashing damage. _Response:_ The pudding splits into two new **Black
 * Puddings**. Each new pudding is one size smaller than the original pudding
 * and acts on its Initiative. The original pudding's Hit Points are divided
 * evenly between the new puddings (round down)." SRD Ochre Jelly prints the
 * same.
 *
 * A Reaction to a blow that has landed — the window SRD Retaliation answers —
 * whose response is two creatures of the holder's own block, one size smaller,
 * each with half its Hit Points, seated where it sat in the order, and the
 * holder gone. The names and the second space are the caller's; everything
 * else the engine reads.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareCreatureSide,
  placeCreatureInScene,
  reactionOpportunities,
  setScene,
  takeDamageResponse,
} from './commands.js';
import { dealSpellDamage } from './commands/damage.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { printedTraitKey } from './monster.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string): CharacterId => asCharacterId(s);
const SEED = 'split';
const PUDDING = id('pudding');
const GOBLIN = id('goblin');
const LEFT = id('pudding-left');
const RIGHT = id('pudding-right');
const SPLIT = printedTraitKey('black-pudding', 'Split');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng(SEED) as Rng,
  content: SRD_CONTENT,
});

/** A pudding at the stated Hit Points and a goblin beside it, fighting. */
function atHitPoints(hp: number, block = 'black-pudding', inCombat = true): GameState {
  let state = fold(SEED, []);
  const step = (events: readonly GameEvent[]): void => {
    state = events.reduce(applyEvent, state);
  };
  step(unwrap(addCreature(state, SRD_CONTENT, PUDDING, block), 'the pudding').events);
  step(unwrap(addCreature(state, SRD_CONTENT, GOBLIN, 'goblin-warrior'), 'the goblin').events);
  step(unwrap(setScene(state, { width: 200, depth: 200, height: 20 }), 'scene'));
  step(unwrap(addSceneLandmark(state, 'the drain', { x: 100, y: 100, z: 0 }), 'landmark'));
  step(unwrap(placeCreatureInScene(state, PUDDING, { from: { landmark: 'the drain' }, feet: 0 }), 'pudding'));
  step(
    unwrap(
      placeCreatureInScene(state, GOBLIN, { from: { creature: PUDDING }, feet: 10, bearing: 90 }),
      'goblin',
    ),
  );
  step(unwrap(declareCreatureSide(state, PUDDING, 'oozes'), 'side'));
  step(unwrap(declareCreatureSide(state, GOBLIN, 'party'), 'side'));
  if (inCombat) {
    step([
      {
        type: 'combat-started',
        combatants: [
          { id: GOBLIN, initiative: 20, speed: 30 },
          { id: PUDDING, initiative: 8, speed: 20 },
        ],
      },
    ]);
  }
  const max = state.creatures[PUDDING]!.vitals.hpMax;
  step([{ type: 'damage-taken', id: PUDDING, amount: max - hp }]);
  return state;
}

/** A blow of one type from the goblin, landed through the funnel spells use. */
function struck(state: GameState, type: string, amount: number): GameState {
  const blow = unwrap(
    dealSpellDamage(
      state,
      PUDDING,
      [{ source: 'a blow', type, roll: null, flat: amount, total: amount }],
      'a blow',
      supply(),
      { by: GOBLIN },
    ),
    'the blow',
  );
  return blow.events.reduce(applyEvent, state);
}

const split = (state: GameState, extra: Record<string, unknown> = {}) =>
  takeDamageResponse(
    state,
    PUDDING,
    {
      feature: SPLIT,
      into: [LEFT, RIGHT],
      placement: { from: { creature: GOBLIN }, feet: 10, bearing: 180 },
      ...extra,
    },
    supply(),
  );

describe('SRD Split: the Reaction, the gate and the two triggers', () => {
  it('splits a pudding at 12 Hit Points hit by Slashing into two of 6, one size smaller', () => {
    const state = struck(atHitPoints(12), 'slashing', 7);
    // Immune to Slashing: it lost nothing, and it was still subjected to it.
    expect(state.creatures[PUDDING]!.vitals.hp).toBe(12);

    const out = unwrap(split(state), 'the split');
    const after = out.events.reduce(applyEvent, state);
    expect(after.creatures[PUDDING]).toBeUndefined();
    for (const half of [LEFT, RIGHT]) {
      const pudding = after.creatures[half]!;
      expect(pudding.name).toBe('Black Pudding');
      expect(pudding.vitals.hp).toBe(6);
      expect(pudding.vitals.hpMax).toBe(6);
      expect(pudding.size).toBe('medium');
      expect(pudding.side).toBe('oozes');
      // Each new pudding still prints the line it came from, one size down.
      expect(pudding.sheet.reactions?.some((reaction) => reaction.feature === SPLIT)).toBe(true);
    }
    // Where the original stood, and where the caller said.
    expect(after.scene?.positions[LEFT]).toEqual(state.scene?.positions[PUDDING]);
    expect(after.scene?.positions[RIGHT]).toBeDefined();
  });

  it('seats both on the original’s Initiative, where it sat in the order', () => {
    const state = struck(atHitPoints(20), 'lightning', 4);
    const after = unwrap(split(state), 'the split').events.reduce(applyEvent, state);
    const order = after.combat!.order.map((combatant) => [combatant.id, combatant.initiative]);
    expect(order).toEqual([
      [GOBLIN, 20],
      [LEFT, 8],
      [RIGHT, 8],
    ]);
  });

  it('divides an odd total rounding down', () => {
    const state = struck(atHitPoints(21), 'slashing', 3);
    const after = unwrap(split(state), 'the split').events.reduce(applyEvent, state);
    expect(after.creatures[LEFT]!.vitals.hp).toBe(10);
    expect(after.creatures[RIGHT]!.vitals.hp).toBe(10);
  });

  it('is set off by a blow that makes it Bloodied, of any type', () => {
    const state = struck(atHitPoints(40), 'fire', 10);
    expect(isErr(split(state))).toBe(false);
  });

  it('refuses a pudding at 9 Hit Points, which is under the gate', () => {
    const refused = split(struck(atHitPoints(9), 'slashing', 3));
    expect(isErr(refused) && refused.code).toBe('split_not_triggered');
  });

  it('refuses a blow of another type on a pudding already Bloodied', () => {
    const refused = split(struck(atHitPoints(20), 'fire', 3));
    expect(isErr(refused) && refused.code).toBe('split_not_triggered');
  });

  it('splits a Medium half into two Small ones, and a Small one no further', () => {
    let state = struck(atHitPoints(20), 'slashing', 3);
    state = unwrap(split(state), 'into two medium').events.reduce(applyEvent, state);
    // The left half is Medium at 10, which is the gate exactly.
    state = struck2(state, LEFT, 'slashing');
    state = unwrap(
      takeDamageResponse(
        state,
        LEFT,
        {
          feature: SPLIT,
          into: [id('left-a'), id('left-b')],
          placement: { from: { creature: GOBLIN }, feet: 15, bearing: 0 },
        },
        supply(),
      ),
      'into two small',
    ).events.reduce(applyEvent, state);
    expect(state.creatures[id('left-a')]!.size).toBe('small');
    expect(state.creatures[id('left-a')]!.vitals.hp).toBe(5);

    // "While the pudding is Large or Medium": a Small one does not split.
    state = struck2(state, id('left-a'), 'slashing');
    const refused = takeDamageResponse(
      state,
      id('left-a'),
      {
        feature: SPLIT,
        into: [id('left-a-1'), id('left-a-2')],
        placement: { from: { creature: GOBLIN }, feet: 20, bearing: 0 },
      },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('split_not_triggered');
  });

  it('asks for the names of the two new creatures and the second one’s space', () => {
    const state = struck(atHitPoints(12), 'slashing', 7);
    const unnamed = takeDamageResponse(state, PUDDING, { feature: SPLIT }, supply());
    expect(isNeedsContext(unnamed)).toBe(true);
    const unplaced = takeDamageResponse(state, PUDDING, { feature: SPLIT, into: [LEFT, RIGHT] }, supply());
    expect(isNeedsContext(unplaced)).toBe(true);
  });

  it('is offered to the table only while its trigger holds', () => {
    const offered = (state: GameState): boolean =>
      reactionOpportunities(state, SRD_CONTENT).some(
        (chance) => chance.reactor === PUDDING && chance.id === SPLIT,
      );
    expect(offered(struck(atHitPoints(12), 'slashing', 7))).toBe(true);
    expect(offered(struck(atHitPoints(9), 'slashing', 3))).toBe(false);
  });

  it('splits the ochre jelly the same way', () => {
    const state = struck(atHitPoints(12, 'ochre-jelly'), 'lightning', 2);
    const out = takeDamageResponse(
      state,
      PUDDING,
      {
        feature: printedTraitKey('ochre-jelly', 'Split'),
        into: [LEFT, RIGHT],
        placement: { from: { creature: GOBLIN }, feet: 10, bearing: 180 },
      },
      supply(),
    );
    const after = unwrap(out, 'the jelly splits').events.reduce(applyEvent, state);
    expect(after.creatures[LEFT]!.name).toBe('Ochre Jelly');
  });
});

/** A slashing blow from the goblin on a named pudding. */
function struck2(state: GameState, who: CharacterId, type: string): GameState {
  const blow = unwrap(
    dealSpellDamage(
      state,
      who,
      [{ source: 'a blow', type, roll: null, flat: 3, total: 3 }],
      'a blow',
      supply(),
      { by: GOBLIN },
    ),
    'the blow',
  );
  return blow.events.reduce(applyEvent, state);
}
