/**
 * SRD Shadow's Draining Swipe: an ability score an effect lowers.
 *
 * "_Hit:_ 5 (1d6 + 2) Necrotic damage, and the target's Strength score
 * decreases by 1d4. The target dies if this reduces that score to 0. If a
 * Humanoid is slain by this attack, a Shadow rises from the corpse 1d4 hours
 * later." The reduction "lasts until the target finishes a Short or Long Rest"
 * is the glossary's sentence about the Shadow's drain.
 *
 * The sheet held the six scores authoritatively and nothing in the engine
 * moved one, so the clause had no record to write to. Now it has: an
 * `ability-score-lowered` is a sourced grant like every other running effect —
 * read where the scores are derived (`abilityScoresOf`, and so every roller
 * that asks `sheetAsItStands`), released by either rest through the door the
 * rest already writes, and a score the roll takes to 0 is a death through the
 * road a death takes rather than a damage roll. The Shadow that rises from a
 * Humanoid's corpse is the table's, and is handed back as it always was.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  advanceTime,
  beginCombat,
  declareCreatureSide,
  endCombat,
  placeCreatureInScene,
  resolveAttack,
  resolveTest,
  setScene,
} from './commands.js';
import { beginRest, endRest } from './rest.js';
import { abilityModifier } from './character.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRiders } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { sheetAsItStands } from './standing.js';
import { HOUR } from './time.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const NYX = id('nyx');
const SHADOW = id('shadow');

const SWIPE = 'Draining Swipe';

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const nyx = (): CharacterChoices => ({
  name: 'Nyx',
  classId: 'rogue',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
});

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** The shadow first in the order, Nyx five feet away. */
function inTheCrypt(): GameState {
  let state = fold('crypt', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  step(createCharacter(SRD_CONTENT, nyx(), NYX), 'Nyx');
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, SHADOW, 'shadow'), 'shadow').events);
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the sarcophagus', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, NYX, { from: { landmark: 'the sarcophagus' }, feet: 0 }), 'place Nyx');
  step(placeCreatureInScene(state, SHADOW, { from: { creature: NYX }, feet: 5, bearing: 90 }), 'place shadow');
  step(declareCreatureSide(state, NYX, 'party'), 'side');
  step(declareCreatureSide(state, SHADOW, 'undead'), 'side');
  step(
    beginCombat(state, [
      { id: SHADOW, initiative: 20, speed: 40 },
      { id: NYX, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/** The swipe under one seed, on a swing that cannot miss but on a natural 1. */
function swiped(state: GameState, seed: string) {
  const out = unwrap(
    resolveAttack(
      state,
      SHADOW,
      {
        target: NYX,
        weapon: null,
        action: SWIPE,
        attackBonuses: [{ source: 'the test insists', flat: 40 }],
        commandId: `swipe-${seed}`,
      },
      supply(seed),
    ),
    'the swipe',
  );
  return { out, state: after(state, out.events) };
}

/** The first seed under which the swipe lands. */
function landed(before: GameState) {
  for (const seed of SEEDS) {
    const world = swiped(before, seed);
    if (world.out.attack?.hit === true) return { seed, ...world };
  }
  throw new Error('no seed landed the swipe');
}

const lowered = (events: readonly GameEvent[]) =>
  events.filter((e) => e.type === 'ability-score-lowered');

const strengthOf = (state: GameState): number => sheetAsItStands(state, NYX)!.abilities.str;

describe('the rider as the swing reads it', () => {
  it('reads the drain and the death it carries, and hands the rising Shadow back', () => {
    const block = SRD_CONTENT.monsters.find((m) => m.id === 'shadow')!;
    const swipe = block.actions.find((one) => one.name === SWIPE)!;
    const read = readPrintedRiders(swipe.attack!.rider!);
    expect(read.riders).toEqual([{ kind: 'ability-score-decrease', ability: 'str', dice: '1d4' }]);
    expect(read.handedOver).toEqual([
      'If a Humanoid is slain by this attack, a **Shadow** rises from the corpse 1d4 hours later.',
    ]);
  });
});

describe('a rogue the swipe lands on', () => {
  it('loses 1d4 Strength, and every reader of the sheet sees the lowered score', () => {
    const before = inTheCrypt();
    expect(strengthOf(before)).toBe(15);
    const { out, state } = landed(before);

    const [drain] = lowered(out.events);
    expect(drain).toBeDefined();
    if (drain?.type !== 'ability-score-lowered') throw new Error('unreachable');
    expect(drain.id).toBe(NYX);
    expect(drain.lowering.ability).toBe('str');
    expect(drain.lowering.amount).toBeGreaterThanOrEqual(1);
    expect(drain.lowering.amount).toBeLessThanOrEqual(4);
    // The die is the block's and the log names it.
    expect(
      out.events.some(
        (e) => e.type === 'roll-recorded' && e.label.includes(SWIPE) && e.total === drain.lowering.amount,
      ),
    ).toBe(true);

    // The sheet as it stands, not the one Nyx was built with.
    expect(strengthOf(state)).toBe(15 - drain.lowering.amount);
    expect(state.creatures[NYX]!.sheet.abilities.str).toBe(15);
    expect(state.creatures[NYX]!.vitals.dead).toBe(false);
    // Only the rising Shadow is handed back.
    expect(out.unverified.filter((line) => line.includes('rises from the corpse'))).toHaveLength(1);
    expect(out.unverified.some((line) => line.includes('Strength score decreases'))).toBe(false);
  });

  it('makes an Athletics check off the lowered score', () => {
    const before = inTheCrypt();
    const { out, state } = landed(before);
    const [drain] = lowered(out.events);
    if (drain?.type !== 'ability-score-lowered') throw new Error('unreachable');
    const check = unwrap(
      resolveTest(
        state,
        NYX,
        { kind: 'ability-check', ability: 'str', skill: 'athletics', dc: 10, commandId: 'climb' },
        supply('climb'),
      ),
      'Athletics',
    );
    expect(check.test!.roll.modifier).toBe(abilityModifier(15 - drain.lowering.amount));
  });

  it('has the score back after a Short Rest, and after a Long one', () => {
    const before = inTheCrypt();
    const { state } = landed(before);
    const drained = strengthOf(state);
    expect(drained).toBeLessThan(15);

    for (const [kind, seconds] of [
      ['short', HOUR],
      ['long', 8 * HOUR],
    ] as const) {
      let world = after(state, unwrap(endCombat(state, { kind: 'surrender', side: 'undead' }), 'end combat'));
      world = after(world, unwrap(beginRest(world, NYX, kind), `begin ${kind}`));
      world = after(world, unwrap(advanceTime(world, seconds, 'resting'), 'the clock'));
      const rested = unwrap(endRest(world, NYX), `end ${kind}`);
      expect(rested.benefit).toBe(kind);
      const restored = rested.events.filter((e) => e.type === 'ability-score-restored');
      expect(restored).toHaveLength(1);
      world = after(world, rested.events);
      expect(strengthOf(world)).toBe(15);
      expect(world.creatures[NYX]!.abilityLowerings).toEqual([]);
    }
  });

  it('dies if the drain takes the score to 0, through the road a death takes', () => {
    const before = inTheCrypt();
    // Fourteen points already gone, so any die at all empties the score.
    const weakened = after(before, [
      {
        type: 'ability-score-lowered',
        id: NYX,
        lowering: { source: 'the test', ability: 'str', amount: 14, label: 'an earlier drain' },
      },
    ]);
    expect(strengthOf(weakened)).toBe(1);
    const { out, state } = landed(weakened);
    const death = out.events.find((e) => e.type === 'creature-died');
    expect(death).toBeDefined();
    if (death?.type !== 'creature-died') throw new Error('unreachable');
    expect(death.id).toBe(NYX);
    expect(death.cause).toContain(SWIPE);
    expect(state.creatures[NYX]!.vitals.dead).toBe(true);
    // A score cannot go below nothing, and the death was not damage.
    expect(strengthOf(state)).toBe(0);
    expect(out.events.filter((e) => e.type === 'hit-points-dropped-to-zero')).toEqual([]);
  });
});
