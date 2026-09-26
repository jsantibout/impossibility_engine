/**
 * SRD Gold Dragon Wyrmling's Weakening Breath, read whole and spent whole.
 *
 * "_Strength Saving Throw:_ DC 13, each creature that isn't currently affected
 * by this breath in a 15-foot Cone. _Failure:_ The target has Disadvantage on
 * Strength-based D20 Tests and subtracts 2 (1d4) from its damage rolls. It
 * repeats the save at the end of each of its turns, ending the effect on
 * itself on a success. After 1 minute, it succeeds automatically."
 *
 * Every half of that sentence was a primitive the engine already held — the
 * `d20-test` family narrowed by an ability and the damage penalty were both
 * built for SRD Ray of Enfeeblement — and the line stayed prose for want of
 * two arms on the printed-save reader: a roll mode over a family, and a
 * penalty on the target's own damage. What is new beside them is a
 * **lifetime that is neither a span nor a condition**: the failure imposes no
 * condition for the repeat save to be hung on, so the two grants share one
 * source under one `grants` timer, and the timer carries the repeat. A made
 * repeat releases both; the minute's cap is the timer's own deadline.
 *
 * "Isn't currently affected by this breath" is a fact about the target the
 * engine can read — whether the line's own source is still hung on them — so
 * a creature already under the breath is not caught twice, and is named
 * rather than silently dropped.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { Bonus } from './bonuses.js';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { rollModesFor } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const WYRMLING = id('wyrmling');

const LINE = 'Weakening Breath';

const supply = (seed: string, bonuses: readonly Bonus[] = []) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(bonuses.length === 0 ? {} : { bonuses }),
});

/** A repeat the boundary cannot miss, and one it cannot make. */
const SHAKEN_OFF: readonly Bonus[] = [{ source: 'the test insists', flat: 40 }];
const STILL_HELD: readonly Bonus[] = [{ source: 'the test insists', flat: -40 }];

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const bren = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** The wyrmling first in the order, Bren five feet away with a dagger in his pack. */
function inTheLair(): GameState {
  let state = fold('lair', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, WYRMLING, 'gold-dragon-wyrmling'), 'wyrmling').events);
  // A Finesse weapon beside the kit's Greatsword, so a Dexterity swing exists.
  state = after(state, [
    { type: 'items-gained', id: BREN, items: [{ id: 'dagger', quantity: 1 }], source: 'the test' },
  ]);
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the hoard', { x: 40, y: 40, z: 0 }), 'hoard');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the hoard' }, feet: 0 }), 'place Bren');
  step(placeCreatureInScene(state, WYRMLING, { from: { creature: BREN }, feet: 5, bearing: 90 }), 'place wyrmling');
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(declareCreatureSide(state, WYRMLING, 'dragons'), 'side');
  step(
    beginCombat(state, [
      { id: WYRMLING, initiative: 20, speed: 30 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/** The breath under one seed, and the world after it. */
function breathed(seed: string, targets: readonly CharacterId[] = [BREN]) {
  const before = inTheLair();
  const out = unwrap(
    forcePrintedSave(before, WYRMLING, { line: LINE, targets, commandId: `breath-${seed}` }, supply(seed)),
    'the breath',
  );
  return { before, out, state: after(before, out.events) };
}

/** The first seed under which Bren fails the save. */
function failed() {
  for (const seed of SEEDS) {
    const world = breathed(seed);
    if (!world.out.outcomes[0]!.save!.success) return { seed, ...world };
  }
  throw new Error('no seed failed the save');
}

const modeOf = (state: GameState, family: 'attack' | 'ability-check' | 'saving-throw', ability: 'str' | 'dex'): string[] =>
  rollModesFor(state, { family, roller: BREN, ability }).modes.map((one) => one.mode);

const grantTimersOn = (state: GameState, who: CharacterId) =>
  Object.values(state.timers).filter((t) => t.target.kind === 'grants' && t.target.on === who);

/** A swing Bren cannot miss with, and everything it wrote. */
function swing(state: GameState, weapon: string, finesseAbility?: 'str' | 'dex', seed = 'swing') {
  const out = unwrap(
    resolveAttack(
      state,
      BREN,
      {
        target: WYRMLING,
        weapon,
        ...(finesseAbility === undefined ? {} : { finesseAbility }),
        attackBonuses: [{ source: 'the test insists', flat: 40 }],
      },
      supply(seed),
    ),
    `swing with ${weapon}`,
  );
  return out;
}

/** The line the penalty writes in the log, if it wrote one. */
const penaltyLine = (events: readonly GameEvent[]) => {
  const line = events.find(
    (e) => e.type === 'roll-recorded' && (e.outcome ?? '').endsWith('subtracted from the damage'),
  );
  return line?.type === 'roll-recorded' ? line : undefined;
};

describe('the line as the parser reads it', () => {
  it('reads every clause and hands nothing over', () => {
    const block = SRD_CONTENT.monsters.find((m) => m.id === 'gold-dragon-wyrmling')!;
    const line = block.actions.find((one) => one.name === LINE)!;
    expect(line.save).toEqual({
      ability: 'str',
      dc: 13,
      targets: "each creature that isn't currently affected by this breath in a 15-foot Cone",
      onlyIfNotAffected: true,
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'roll-mode',
          mode: 'disadvantage',
          rolls: ['d20-test'],
          ability: 'str',
          repeats: { at: 'end', of: 'target', capSeconds: 60 },
        },
        {
          kind: 'damage-penalty',
          dice: '1d4',
          flat: 0,
          average: 2,
          repeats: { at: 'end', of: 'target', capSeconds: 60 },
        },
      ],
    });
  });
});

describe('a fighter who fails the save', () => {
  it('has Disadvantage on a Strength attack and none on a Dexterity one', () => {
    const { state } = failed();
    expect(modeOf(state, 'attack', 'str')).toEqual(['disadvantage']);
    expect(modeOf(state, 'ability-check', 'str')).toEqual(['disadvantage']);
    expect(modeOf(state, 'saving-throw', 'str')).toEqual(['disadvantage']);
    expect(modeOf(state, 'attack', 'dex')).toEqual([]);
    expect(modeOf(state, 'ability-check', 'dex')).toEqual([]);

    // Both halves are on the sheet, under one source, with one timer over
    // them carrying the repeat and the minute's cap.
    const creature = state.creatures[BREN]!;
    expect(creature.rollModifiers).toHaveLength(1);
    expect(creature.damagePenalties).toHaveLength(1);
    expect(creature.rollModifiers[0]!.source).toBe(creature.damagePenalties[0]!.source);
    const timers = grantTimersOn(state, BREN);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.repeatSave).toMatchObject({ at: 'end-of-turn', of: BREN, ability: 'str', dc: 13 });
    expect(timers[0]!.deadline).toMatchObject({ kind: 'elapsed', at: state.elapsed + 60 });
  });

  it('subtracts 1d4 from a hit, and says so in the log', () => {
    const { state } = failed();
    const next = after(state, unwrap(resolveTurn(state, supply('to-bren')), 'to Bren').events);
    // A +40 cannot miss, except on the natural 1 the SRD makes a miss whatever
    // the total — so the first seed that lands is the one read.
    for (const seed of SEEDS) {
      const out = swing(next, 'greatsword', undefined, seed);
      expect(out.attack!.roll.mode).toBe('disadvantage');
      if (!out.attack!.hit) continue;
      const line = penaltyLine(out.events);
      expect(line, 'the penalty wrote no line').toBeDefined();
      expect(line!.label).toBe(LINE);
      expect(line!.total).toBeGreaterThanOrEqual(1);
      expect(line!.total).toBeLessThanOrEqual(4);
      return;
    }
    throw new Error('no seed landed the swing');
  });

  it('is free after a made repeat save at the end of its own turn, and not before', () => {
    const { state } = failed();
    // The wyrmling's turn ends: nothing is owed yet, because the repeat is at
    // the end of *Bren's* turns.
    const toBren = unwrap(resolveTurn(state, supply('to-bren', SHAKEN_OFF)), 'to Bren');
    expect(toBren.saves).toEqual([]);
    const brensTurn = after(state, toBren.events);

    // Bren's turn ends, the save is repeated and made: both grants go, and the
    // timer with them.
    const shaken = unwrap(resolveTurn(brensTurn, supply('shake', SHAKEN_OFF)), 'shake');
    expect(shaken.saves).toHaveLength(1);
    expect(shaken.saves[0]!.success).toBe(true);
    const free = after(brensTurn, shaken.events);
    expect(free.creatures[BREN]!.rollModifiers).toEqual([]);
    expect(free.creatures[BREN]!.damagePenalties).toEqual([]);
    expect(grantTimersOn(free, BREN)).toEqual([]);
    expect(modeOf(free, 'attack', 'str')).toEqual([]);

    // And a failed repeat leaves everything where it was.
    const held = unwrap(resolveTurn(brensTurn, supply('hold', STILL_HELD)), 'hold');
    expect(held.saves[0]!.success).toBe(false);
    const still = after(brensTurn, held.events);
    expect(still.creatures[BREN]!.rollModifiers).toHaveLength(1);
    expect(still.creatures[BREN]!.damagePenalties).toHaveLength(1);
    expect(grantTimersOn(still, BREN)).toHaveLength(1);
  });

  it('is not caught twice while the breath still holds', () => {
    const { seed, state } = failed();
    const next = after(state, unwrap(resolveTurn(state, supply('to-bren', STILL_HELD)), 'to Bren').events);
    const back = after(next, unwrap(resolveTurn(next, supply('back', STILL_HELD)), 'back').events);
    const again = unwrap(
      forcePrintedSave(back, WYRMLING, { line: LINE, targets: [BREN], commandId: `again-${seed}` }, supply(`${seed}-again`)),
      'the second breath',
    );
    // No save was thrown at Bren, the line was still taken, and the caller is
    // told who it did not reach.
    expect(again.outcomes).toEqual([]);
    expect(again.events.some((e) => e.type === 'action-spent')).toBe(true);
    expect(again.events.some((e) => e.type === 'roll-recorded')).toBe(false);
    expect(again.unverified.some((line) => line.includes('already') && line.includes(BREN))).toBe(true);
  });

  it('hands over nothing of the line but its Cone', () => {
    const { out } = failed();
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain('15-foot Cone');
  });
});

describe('a fighter who makes the save', () => {
  it('holds nothing of the line', () => {
    for (const seed of SEEDS) {
      const { out, state } = breathed(seed);
      if (!out.outcomes[0]!.save!.success) continue;
      expect(state.creatures[BREN]!.rollModifiers).toEqual([]);
      expect(state.creatures[BREN]!.damagePenalties).toEqual([]);
      expect(grantTimersOn(state, BREN)).toEqual([]);
      return;
    }
    throw new Error('no seed made the save');
  });
});
