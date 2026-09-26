import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { eligibleTargets, resolveSpell } from './commands.js';

/**
 * SRD Thaumaturgy, _Booming Voice_: "Your voice booms up to three times as loud
 * as normal for 1 minute. For the duration, you have Advantage on Charisma
 * (Intimidation) checks."
 *
 * **The mode was always ordinary; the creature was the gap.** A `RollModifier`
 * naming a Charisma ability check narrowed to the Intimidation skill is the pair
 * `RollSelector` already carries, and Thaumaturgy printed `targets: { count: 0 }`
 * — the wonder happens "within range" rather than on somebody — so the per-target
 * loop ran no times and the mode had nowhere to land. `{ count: 1, self: true }`
 * would have let a cleric boom an ally's voice, which the book does not grant.
 *
 * `TargetRule.casterOnly` is the sentence that was missing: the caster is the
 * one legal target, and anybody else is `not_the_caster`. It is
 * `notTheCaster`'s opposite number, and the family now has both halves.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ALLY = id('ally');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 14 },
  skills: { intimidation: 'proficient' },
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
  side: 'party',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(ALLY),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', cantrips: ['thaumaturgy'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 10 } },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('boom') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const boom = (log: readonly GameEvent[], on: CharacterId) =>
  resolveSpell(
    fold('seed', log),
    CLERIC,
    { spellId: 'thaumaturgy', targets: [on], option: 'booming-voice' } as never,
    supply(fold('seed', log)),
  );

/** The modes standing on a creature's check of one ability and skill. */
const modesOn = (state: GameState, who: CharacterId, ability: string, skill: string) =>
  rollModesFor(state, {
    family: 'ability-check',
    roller: who,
    ability: ability as never,
    skill: skill as never,
  }).modes;

describe('SRD Thaumaturgy: the caster and nobody else', () => {
  it('grants the caster Advantage on Charisma (Intimidation) checks', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const state = fold('seed', [...SETUP, ...cast.events]);

    expect(modesOn(state, CLERIC, 'cha', 'intimidation')).toEqual([
      { source: 'Thaumaturgy#cast:1', mode: 'advantage' },
    ]);
  });

  it('withholds it from a check the sentence does not name', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const state = fold('seed', [...SETUP, ...cast.events]);

    // "Charisma (Intimidation)": a Charisma check of another skill is a
    // different roll, and so is somebody else's Intimidation.
    expect(modesOn(state, CLERIC, 'cha', 'persuasion')).toEqual([]);
    expect(modesOn(state, ALLY, 'cha', 'intimidation')).toEqual([]);
  });

  it('refuses to boom an ally’s voice', () => {
    const refused = boom(SETUP, ALLY);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('not_the_caster');
  });

  it('offers the caster alone on the shortlist, and says why the ally is off it', () => {
    const state = fold('seed', SETUP);
    const shortlist = eligibleTargets(state, SRD_CONTENT, CLERIC, 'thaumaturgy', 0);

    expect(shortlist.eligible).toEqual([CLERIC]);
    expect(shortlist.excluded.map((one) => one.target)).toEqual([ALLY]);
    expect(shortlist.excluded[0]?.reason).toContain('nobody else');
  });

  it('lets go of the mode when the minute is up', () => {
    const cast = unwrap(boom(SETUP, CLERIC), 'booming voice');
    const later = fold('seed', [
      ...SETUP,
      ...cast.events,
      { type: 'time-advanced', seconds: 61, reason: 'the minute' },
    ]);

    expect(modesOn(later, CLERIC, 'cha', 'intimidation')).toEqual([]);
  });
});
