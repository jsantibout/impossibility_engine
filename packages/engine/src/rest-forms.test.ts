/**
 * **A body that becomes another block at a rest** — W7-B12.
 *
 * SRD Incubus, Succubus Form: "When the incubus finishes a Long Rest, it can
 * shape-shift into a **Succubus**, using that stat block instead of this one.
 * Any equipment it is wearing or carrying isn't transformed." SRD Succubus,
 * Incubus Form: the other way round.
 *
 * "Using that stat block instead of this one" is the whole block — its
 * statistics, its Hit Points, its lines, its magic — and not Wild Shape's
 * merge, which keeps the holder's Hit Points and mind. So the change is pinned
 * as the other block's arrival, over the same creature: its id, its place, its
 * side and its gear stay; everything the book prints is the new block's.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  advanceTime,
  declareCreatureSide,
  placeCreatureInScene,
  setScene,
  takeRestForm,
} from './commands.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { beginRest, endRest } from './rest.js';

const id = asCharacterId;
const SEED = 'rest-forms';
const FIEND = id('fiend');

/** An incubus, placed and on a side, carrying a dagger, before any rest. */
function incubus(): GameState {
  let state = fold(SEED, []);
  const step = (events: readonly GameEvent[]): void => {
    state = events.reduce(applyEvent, state);
  };
  step(unwrap(addCreature(state, SRD_CONTENT, FIEND, 'incubus'), 'the incubus').events);
  step([{ type: 'items-gained', id: FIEND, items: [{ id: 'dagger', quantity: 1 }], source: 'the test' }]);
  step(unwrap(setScene(state, { width: 100, depth: 100, height: 20 }), 'scene'));
  step(unwrap(addSceneLandmark(state, 'the bed', { x: 50, y: 50, z: 0 }), 'landmark'));
  step(unwrap(placeCreatureInScene(state, FIEND, { from: { landmark: 'the bed' }, feet: 0 }), 'place'));
  step(unwrap(declareCreatureSide(state, FIEND, 'fiends'), 'side'));
  return state;
}

/** A Long Rest, begun and finished. */
function longRest(state: GameState): GameState {
  let now = unwrap(beginRest(state, FIEND, 'long'), 'rest').reduce(applyEvent, state);
  now = unwrap(advanceTime(now, 8 * 3600, 'the night'), 'night').reduce(applyEvent, now);
  return unwrap(endRest(now, FIEND), 'morning').events.reduce(applyEvent, now);
}

describe('SRD Succubus Form and Incubus Form: another block at a Long Rest', () => {
  it('becomes a Succubus when it finishes a Long Rest, keeping its place, side and gear', () => {
    const rested = longRest(incubus());
    const out = unwrap(takeRestForm(rested, SRD_CONTENT, FIEND, {}), 'the change');
    const after = out.reduce(applyEvent, rested);
    const fiend = after.creatures[FIEND]!;
    expect(fiend.name).toBe('Succubus');
    // The succubus block's own Hit Points, at full: the rest just ended.
    expect(fiend.vitals.hpMax).toBe(SRD_CONTENT.monsterById('succubus')!.hp.average);
    expect(fiend.vitals.hp).toBe(fiend.vitals.hpMax);
    // The succubus prints no Spellcasting line, and the incubus's is gone.
    expect(fiend.spellcasting.granted).toEqual([]);
    expect(fiend.sheet.stated?.attacks?.map((attack) => attack.name)).toContain('Fiendish Touch');
    // "Any equipment it is wearing or carrying isn't transformed."
    expect(fiend.inventory.some((line) => line.id === 'dagger')).toBe(true);
    expect(fiend.side).toBe('fiends');
    expect(after.scene?.positions[FIEND]).toEqual(rested.scene?.positions[FIEND]);
  });

  it('comes back the other way at the next Long Rest, by the succubus’s own line', () => {
    let state = longRest(incubus());
    state = unwrap(takeRestForm(state, SRD_CONTENT, FIEND, {}), 'to succubus').reduce(applyEvent, state);
    // SRD: a creature "can't benefit from more than one Long Rest in a 24-hour
    // period", so the day goes by before the next.
    state = unwrap(advanceTime(state, 16 * 3600, 'the day'), 'day').reduce(applyEvent, state);
    state = longRest(state);
    state = unwrap(takeRestForm(state, SRD_CONTENT, FIEND, {}), 'to incubus').reduce(applyEvent, state);
    expect(state.creatures[FIEND]!.name).toBe('Incubus');
  });

  it('refuses before any rest, and after time has passed since one', () => {
    const early = takeRestForm(incubus(), SRD_CONTENT, FIEND, {});
    expect(isErr(early) && early.code).toBe('no_long_rest_just_finished');

    const late = unwrap(advanceTime(longRest(incubus()), 60, 'breakfast'), 'later');
    const stale = takeRestForm(late.reduce(applyEvent, longRest(incubus())), SRD_CONTENT, FIEND, {});
    expect(isErr(stale) && stale.code).toBe('no_long_rest_just_finished');
  });

  it('changes once per rest, and not straight back', () => {
    let state = longRest(incubus());
    state = unwrap(takeRestForm(state, SRD_CONTENT, FIEND, {}), 'once').reduce(applyEvent, state);
    const twice = takeRestForm(state, SRD_CONTENT, FIEND, { commandId: 'twice' });
    expect(isErr(twice) && twice.code).toBe('no_long_rest_just_finished');
  });

  it('refuses a creature whose block prints no such line', () => {
    let state = fold(SEED, []);
    state = unwrap(addCreature(state, SRD_CONTENT, FIEND, 'bandit'), 'bandit').events.reduce(
      applyEvent,
      state,
    );
    const refused = takeRestForm(state, SRD_CONTENT, FIEND, {});
    expect(isErr(refused) && refused.code).toBe('no_rest_form');
  });

  it('refuses a block the line does not name', () => {
    const refused = takeRestForm(longRest(incubus()), SRD_CONTENT, FIEND, { block: 'troll' });
    expect(isErr(refused) && refused.code).toBe('not_this_lines_form');
  });
});
