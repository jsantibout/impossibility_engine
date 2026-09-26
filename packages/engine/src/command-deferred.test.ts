/**
 * SRD Command's Approach and Flee: the die is the engine's and the following is
 * the table's.
 *
 * > "The target must succeed on a Wisdom saving throw or follow the command on
 * > its next turn." / "**Approach.** The target moves toward you by the shortest
 * > and most direct route, ending its turn if it moves within 5 feet of you." /
 * > "**Flee.** The target spends its turn moving away from you by the fastest
 * > available means."
 *
 * **Two of the five words were filed as "the save is not rolled", and that was
 * one step too far.** The owner's ruling of 2026-09-25 is that a compulsion is
 * legality the table adjudicates and a compulsion clause is a handover — which
 * says nothing about the *die*. What a failure buys here is a route nobody chose
 * and a turn spent walking it, so the verdict is the whole of what the engine
 * decides: `save.verdictOnly`, the mark SRD Animal Messenger's errand already
 * uses, with the sentence going over beside it.
 *
 * So the engine rolls, reports who resisted and who did not, and hands the
 * walking to whoever is running the table. Nothing is compelled and nothing is
 * performed.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const THUG = id('thug');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 16, cha: 12 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CLERIC ? 'party' : 'foes',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(THUG),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['command'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: CLERIC }, feet: 15 } },
  { type: 'sight-declared', from: CLERIC, to: THUG, seen: true },
];

const supply = (state: GameState, flat: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('word') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the test insists', flat }],
});

/** One word spoken, with the save forced either way. */
const speak = (option: string, flat: number) => {
  const state = fold('word', SETUP);
  return unwrap(
    resolveSpell(state, CLERIC, { spellId: 'command', targets: [THUG], option } as never, supply(state, flat)),
    option,
  );
};

describe('SRD Command: a verdict-only save for the two words nobody performs', () => {
  it('rolls the Wisdom save for Approach and reports who failed it', () => {
    const out = speak('approach', -40);
    const rolls = out.events.filter((event) => event.type === 'roll-recorded');

    expect(rolls).toHaveLength(1);
    expect(out.outcomes.map((one) => one.target)).toEqual([THUG]);
    expect(out.outcomes[0]?.save?.success).toBe(false);
  });

  it('rolls it for Flee too, and a made save is reported as made', () => {
    const out = speak('flee', 40);
    expect(out.events.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
    expect(out.outcomes[0]?.save?.success).toBe(true);
  });

  it('hands the walking over and compels nothing', () => {
    const out = speak('approach', -40);
    const said = out.unverified.join('\n');

    expect(said).toContain('shortest and most direct route');
    // Nothing is applied, nothing is spent, nothing is granted: the failure's
    // whole content is the answer the die gave.
    const after = fold('word', [...SETUP, ...out.events]);
    expect(after.creatures[THUG]?.conditions.instances ?? []).toEqual([]);
    expect(after.creatures[THUG]?.actionRules ?? []).toEqual([]);
  });

  it('speaks the word that was spoken and no other', () => {
    expect(speak('flee', -40).unverified.join('\n')).not.toContain('shortest and most direct');
    expect(speak('approach', -40).unverified.join('\n')).not.toContain('fastest available means');
  });
});
