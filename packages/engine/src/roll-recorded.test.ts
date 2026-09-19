/**
 * What a recorded roll does to state, which is nearly nothing and not nothing.
 *
 * `fold/rolls.ts` said `roll-recorded` "changes no state at all", and that
 * sentence was read by an architect answering a design question. It is false:
 * `interruptedRests` in `fold/apply.ts` reads the event, and a roll labelled
 * Initiative breaks a rest the roller was taking — SRD lists "Rolling
 * Initiative" first among the things that interrupt one, and it names the
 * *roll* rather than the fight.
 *
 * So the claim is pinned here as two tests rather than left as prose: the
 * Initiative label reaches the rest, and every other label leaves the state
 * it folded into byte-identical. `rest.test.ts` proves the same interruption
 * through `recordInitiativeRolls`, which is the command that emits the event;
 * this proves it of the *event*, which is what the docstring is about, and is
 * the test that bites if the case in `interruptedRests` is ever dropped.
 */

import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { INITIATIVE_LABEL } from './combat.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest } from './rest.js';

const WHO = asCharacterId('wizard');

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
};

/** One creature, resting, and nothing else going on. */
const resting = (): readonly GameEvent[] => {
  const added: readonly GameEvent[] = [
    { type: 'creature-added', id: WHO, name: 'wizard', sheet, maxHp: 30 },
  ];
  return [...added, ...unwrap(beginRest(fold('seed', added), WHO, 'long'), 'rest')];
};

/** A recorded roll and nothing else — no `rolls-issued` beside it. */
const recorded = (label: string): GameEvent => ({
  type: 'roll-recorded',
  who: WHO,
  label,
  natural: 12,
  total: 14,
  contributions: [{ source: 'Dexterity', amount: 2 }],
  outcome: 'a 14',
});

const foldWith = (event: GameEvent): GameState => fold('seed', [...resting(), event]);

/**
 * The state with the one number every event moves set aside.
 *
 * `eventCount` counts events rather than recording anything a roll did, so a
 * comparison including it could only ever say "an event happened" — which is
 * true of every event there is and says nothing about this one.
 */
const exceptTheCount = (state: GameState): GameState => ({ ...state, eventCount: 0 });

describe('a recorded roll', () => {
  it('breaks a rest when it is the Initiative roll', () => {
    const after = foldWith(recorded(INITIATIVE_LABEL));
    expect(after.creatures[WHO]?.resting?.interruptedBy).toBe(INITIATIVE_LABEL);
  });

  it('changes nothing whatever under any other label', () => {
    const before = exceptTheCount(fold('seed', resting()));
    expect(exceptTheCount(foldWith(recorded('Longsword attack')))).toEqual(before);
    expect(exceptTheCount(foldWith(recorded('Dexterity save')))).toEqual(before);
    // And the Initiative one moves the rest and nothing else, the generator
    // included: only `rolls-issued` moves those.
    expect(foldWith(recorded(INITIATIVE_LABEL)).rollsIssued).toBe(before.rollsIssued);
    expect(foldWith(recorded(INITIATIVE_LABEL)).rng).toBe(before.rng);
  });
});
