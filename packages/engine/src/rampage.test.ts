/**
 * A per-day use whose sentence nothing spent — SRD Gnoll Warrior, Rampage
 * (1/Day): "Immediately after dealing damage to a creature that is already
 * Bloodied, the gnoll moves up to half its Speed, and it makes one Rend attack."
 * SRD Giant Hyena prints the same with a Bite and with "can move".
 *
 * **The move and the swing are both grants the turn already holds** —
 * `GrantedMove` is what Tactical Shift hands over and `GrantedAttacks` is what a
 * Flurry of Blows buys — so what was missing was the **trigger**, and the
 * trigger is the interesting half: "a creature that is **already** Bloodied" is
 * Bloodied *before* the blow, and `isBloodied` asked after it answers yes for a
 * creature the blow itself took past half. That is a case the sentence excludes,
 * so the fact is recorded where it exists and nowhere else:
 * `LastDamage.wasBloodied`, derived by the reducer off the creature as it stood
 * before the `damage-taken` it is applying.
 *
 * **Which attack is reported rather than enforced.** `GrantedAttacks` narrows by
 * `unarmedOnly` and by nothing else — the SRD's own narrowing, and the only one
 * the book prints anywhere — so the heading the line names comes back in
 * `unverified` instead of becoming a field nothing reads.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  damageCreature,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  setScene,
  takeStatedBonusAction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { isBloodied, speedOf } from './standing.js';

const id = (s: string) => asCharacterId(s);
const GNOLL = id('gnoll');
const OGRE = id('ogre');

/** The block's own heading, read off the block rather than retyped. */
const LINE = SRD_CONTENT.monsterById('gnoll-warrior')!.bonusActions[0]!.name;

const supply = (seed = 'rend') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** A gnoll and an ogre, the gnoll's turn running. */
function inTheScrub(): GameState {
  let state = fold('scrub', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  for (const [who, block] of [
    [GNOLL, 'gnoll-warrior'],
    [OGRE, 'ogre'],
  ] as const) {
    state = after(state, unwrap(addCreature(state, SRD_CONTENT, who, block), block).events);
  }
  step(setScene(state, { width: 160, depth: 120, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the thorn', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, GNOLL, { from: { landmark: 'the thorn' }, feet: 0 }), 'place');
  step(
    placeCreatureInScene(state, OGRE, { from: { creature: GNOLL }, feet: 5, bearing: 90 }),
    'place the ogre',
  );
  step(declareCreatureSide(state, GNOLL, 'monsters'), 'side');
  step(declareCreatureSide(state, OGRE, 'monsters'), 'side');
  step(
    beginCombat(state, [
      { id: GNOLL, initiative: 20, speed: 30 },
      { id: OGRE, initiative: 1, speed: 40 },
    ]),
    'combat',
  );
  return state;
}

/** Take the ogre past half its Hit Points, by something that is not the gnoll. */
function bloodied(state: GameState): GameState {
  const half = Math.ceil(state.creatures[OGRE]!.vitals.hpMax / 2) + 1;
  const hurt = after(
    state,
    unwrap(damageCreature(state, OGRE, { amount: half, type: 'fire', commandId: 'brand' }), 'the brand'),
  );
  if (!isBloodied(hurt.creatures[OGRE])) throw new Error('the ogre is not Bloodied');
  return hurt;
}

/** The gnoll's own blow, which is the trigger's other half. */
function gnollHits(state: GameState): GameState {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const swung = unwrap(
      resolveAttack(
        state,
        GNOLL,
        {
          target: OGRE,
          weapon: null,
          action: 'Rend',
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
          commandId: `rend-${attempt}`,
        },
        supply(`rend-${attempt}`),
      ),
      'the rend',
    );
    if (swung.attack?.hit === true) return after(state, swung.events);
  }
  throw new Error('no seed hit the ogre');
}

describe('the line as the parser reads it', () => {
  it('reads the fraction, the attack it names and how many', () => {
    const line = SRD_CONTENT.monsterById('gnoll-warrior')!.bonusActions.find(
      (l) => l.name === LINE,
    )!;
    expect(line.rampages).toEqual({ fraction: 'half', attack: 'Rend', attacks: 1 });
    expect(line.perDay).toBe(1);

    // The hyena's is the same sentence with another verb and another heading.
    const hyena = SRD_CONTENT.monsterById('giant-hyena')!.bonusActions.find((l) =>
      l.name.startsWith('Rampage'),
    )!;
    expect(hyena.rampages).toEqual({ fraction: 'half', attack: 'Bite', attacks: 1 });
  });
});

describe('the fold records whether the creature was already Bloodied', () => {
  it('marks a blow on a creature past half, and not one that took it there', () => {
    const fresh = inTheScrub();
    // The blow that *takes* the ogre to Bloodied is not a blow on a creature
    // that was already Bloodied, which is the whole of the distinction.
    const took = gnollHits(fresh);
    expect(isBloodied(took.creatures[OGRE])).toBe(false);
    expect(took.creatures[OGRE]!.lastDamage?.wasBloodied).toBeUndefined();

    const already = gnollHits(bloodied(fresh));
    expect(already.creatures[OGRE]!.lastDamage?.wasBloodied).toBe(true);
    expect(already.creatures[OGRE]!.lastDamage?.by).toBe(GNOLL);
  });
});

describe('the gnoll rampages', () => {
  it('hands the turn half its Speed and one attack, once a day', () => {
    const struck = gnollHits(bloodied(inTheScrub()));
    const half = Math.floor(speedOf(struck, GNOLL) / 2);

    const raged = unwrap(
      takeStatedBonusAction(struck, GNOLL, { line: LINE, commandId: 'rampage' }),
      'the rampage',
    );
    const done = after(struck, raged.events);
    expect(done.combat!.budgets[GNOLL]!.grantedMoves.map((g) => g.feet)).toEqual([half]);
    expect(done.combat!.budgets[GNOLL]!.grantedAttacks).toEqual({
      remaining: 1,
      unarmedOnly: false,
    });
    expect(done.combat!.budgets[GNOLL]!.bonusAction).toBe(false);
    // The heading the line names is reported, because the grant does not hold
    // the swing to it.
    expect(raged.unverified.join(' ')).toContain('Rend');

    // And the day's one use is gone: a second Rampage is refused whatever else
    // the gnoll has bloodied.
    const again = takeStatedBonusAction(
      after(done, [{ type: 'turn-advanced' }, { type: 'turn-advanced' }]),
      GNOLL,
      { line: LINE, commandId: 'again' },
    );
    expect(isErr(again) && again.code).toBe('daily_limit_reached');
  });

  it('is refused with no blow behind it, and refused for a blow that drew first blood', () => {
    const cold = inTheScrub();
    const unprovoked = takeStatedBonusAction(cold, GNOLL, { line: LINE, commandId: 'nothing' });
    expect(isErr(unprovoked) && unprovoked.code).toBe('no_bloodied_blow');

    const firstBlood = gnollHits(cold);
    const early = takeStatedBonusAction(firstBlood, GNOLL, { line: LINE, commandId: 'early' });
    expect(isErr(early) && early.code).toBe('no_bloodied_blow');
    // Nothing was spent being refused.
    expect(firstBlood.combat!.budgets[GNOLL]!.bonusAction).toBe(true);
  });

  it('is refused once the moment has passed', () => {
    const struck = gnollHits(bloodied(inTheScrub()));
    // Two turns on, the blow is last round's. "Immediately after" is read the
    // way every other momentary window is: the turn, and the clock outside one.
    const later = after(struck, [{ type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    const late = takeStatedBonusAction(later, GNOLL, { line: LINE, commandId: 'late' });
    expect(isErr(late) && late.code).toBe('no_bloodied_blow');
  });
});
