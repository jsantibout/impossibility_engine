/**
 * **A body that becomes another block on a die** — W7-B12.
 *
 * SRD Troll Limb, Troll Spawn: "The limb uncannily has the same senses as a
 * whole troll. If the limb isn't destroyed within 24 hours, roll 1d12. On a
 * 12, the limb turns into a **Troll**. Otherwise, the limb withers away."
 *
 * A deadline hung at the limb's arrival, a die the engine throws when it
 * falls due, and one of two endings: the Troll's block over the same creature,
 * or the creature leaving the game. What throws the die is the command that
 * settles a due deadline — the DM's door outside a fight, and the turn
 * boundary inside one, which refuses nothing and forgets nothing.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  advanceTime,
  blockDeadlinesDue,
  resolveTurn,
  settleBlockDeadlines,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

const id = asCharacterId;
const SEED = 'troll-spawn';
const LIMB = id('limb');
const GOBLIN = id('goblin');
const DAY = 24 * 3600;

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A limb on the floor, and a goblin to keep the room from being empty. */
function severed(): GameState {
  let state = fold(SEED, []);
  const step = (events: readonly GameEvent[]): void => {
    state = events.reduce(applyEvent, state);
  };
  step(unwrap(addCreature(state, SRD_CONTENT, LIMB, 'troll-limb'), 'the limb').events);
  step(unwrap(addCreature(state, SRD_CONTENT, GOBLIN, 'goblin-warrior'), 'the goblin').events);
  return state;
}

const later = (state: GameState, seconds: number): GameState =>
  unwrap(advanceTime(state, seconds, 'time passes'), 'time').reduce(applyEvent, state);

const SEEDS = Array.from({ length: 40 }, (_, n) => `seed-${n}`);

describe('SRD Troll Spawn: a day, a d12, a troll or nothing', () => {
  it('hangs the day at the limb’s arrival, and owes nothing before it runs out', () => {
    const state = later(severed(), DAY - 1);
    expect(blockDeadlinesDue(state)).toEqual([]);
    const settled = unwrap(settleBlockDeadlines(state, supply('early')), 'nothing owed');
    expect(settled.events).toEqual([]);
  });

  it('owes the die once the day is up', () => {
    expect(blockDeadlinesDue(later(severed(), DAY))).toEqual([LIMB]);
  });

  it('turns the limb into a Troll on a 12 and withers it on anything else, across seeds', () => {
    const faces = new Set<string>();
    for (const seed of SEEDS) {
      const due = later(severed(), DAY);
      const out = unwrap(settleBlockDeadlines(due, supply(seed)), seed);
      const face = out.events.find((event) => event.type === 'roll-recorded');
      expect(face, seed).toBeDefined();
      const natural = (face as { readonly natural: number }).natural;
      const after = out.events.reduce(applyEvent, due);
      if (natural === 12) {
        faces.add('troll');
        expect(after.creatures[LIMB]!.name).toBe('Troll');
        expect(after.creatures[LIMB]!.vitals.hp).toBe(SRD_CONTENT.monsterById('troll')!.hp.average);
        expect(after.creatures[LIMB]!.size).toBe('large');
      } else {
        faces.add('withered');
        expect(after.creatures[LIMB]).toBeUndefined();
      }
      // Either way the debt is paid.
      expect(blockDeadlinesDue(after)).toEqual([]);
    }
    expect(faces).toEqual(new Set(['troll', 'withered']));
  });

  it('refuses to throw the die without a generator', () => {
    const refused = settleBlockDeadlines(later(severed(), DAY), undefined);
    expect(isErr(refused) && refused.code).toBe('block_change_owed');
  });

  /**
   * **A debt the turn will not advance past**, on `summons_stranded`'s pattern:
   * derived from the world as it stands, refused until the command that
   * settles it has thrown the die. Forgetting a rule stops the game rather than
   * quietly losing it.
   */
  it('stops a fight’s turn from moving on until the die has been thrown', () => {
    let state = later(severed(), DAY);
    state = [
      {
        type: 'combat-started' as const,
        combatants: [
          { id: GOBLIN, initiative: 20, speed: 30 },
          { id: LIMB, initiative: 10, speed: 20 },
        ],
      },
    ].reduce(applyEvent, state);
    const refused = resolveTurn(state, supply('in the fight'));
    expect(isErr(refused) && refused.code).toBe('block_change_owed');

    state = unwrap(settleBlockDeadlines(state, supply('settled')), 'settled').events.reduce(
      applyEvent,
      state,
    );
    expect(isErr(resolveTurn(state, supply('in the fight')))).toBe(false);
  });
});
