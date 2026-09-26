/**
 * SRD Sprite's Heart Sight: a save whose failure is **knowledge**.
 *
 * "_Charisma Saving Throw:_ DC 10, one creature within 5 feet the sprite can
 * see (Celestials, Fiends, and Undead automatically fail the save). _Failure:_
 * The sprite knows the target's emotions and alignment."
 *
 * Nothing lands on the target: what changes is what the sprite *knows*, which
 * is the third thing the engine holds that only the table reads (SRD Divine
 * Sense's `detectedBy` and SRD Hunter's Lore's `knownDefencesOf` are the first
 * two). So the failure is a `reveals` clause, and the outcome carries what the
 * engine could tell — the alignment the block or the character's choices
 * pinned — and names what it could not: an emotion is the table's. The
 * automatic failure by type is read off the targeting clause and is no roll at
 * all: a Fiend's outcome carries no save, because the book threw no die.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const SPRITE = id('sprite');
const BANDIT = id('bandit');
const IMP = id('imp');
const BREN = id('bren');

const LINE = 'Heart Sight';

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

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
  alignment: 'Neutral Good',
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

/** The sprite first in the order; a bandit, an imp and Bren within five feet. */
function inTheGlade(): GameState {
  let state = fold('glade', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  const arrive = (who: CharacterId, block: string): void => {
    state = after(state, unwrap(addCreature(state, SRD_CONTENT, who, block), block).events);
  };
  arrive(SPRITE, 'sprite');
  arrive(BANDIT, 'bandit');
  arrive(IMP, 'imp');
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the ring', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, SPRITE, { from: { landmark: 'the ring' }, feet: 0 }), 'sprite');
  step(placeCreatureInScene(state, BANDIT, { from: { creature: SPRITE }, feet: 5, bearing: 0 }), 'bandit');
  step(placeCreatureInScene(state, IMP, { from: { creature: SPRITE }, feet: 5, bearing: 90 }), 'imp');
  step(placeCreatureInScene(state, BREN, { from: { creature: SPRITE }, feet: 5, bearing: 180 }), 'Bren');
  step(declareCreatureSide(state, SPRITE, 'fey'), 'side');
  step(declareCreatureSide(state, BANDIT, 'bandits'), 'side');
  step(declareCreatureSide(state, IMP, 'fiends'), 'side');
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(
    beginCombat(state, [
      { id: SPRITE, initiative: 20, speed: 10 },
      { id: BANDIT, initiative: 10, speed: 30 },
      { id: IMP, initiative: 5, speed: 20 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

function looked(target: CharacterId, seed: string) {
  const before = inTheGlade();
  const out = unwrap(
    forcePrintedSave(before, SPRITE, { line: LINE, targets: [target], commandId: `look-${seed}` }, supply(seed)),
    'Heart Sight',
  );
  return { out, state: after(before, out.events) };
}

describe('the line as the parser reads it', () => {
  it('reads the reveal and the types that fail automatically, and hands nothing over', () => {
    const block = SRD_CONTENT.monsters.find((m) => m.id === 'sprite')!;
    const line = block.actions.find((one) => one.name === LINE)!;
    expect(line.save).toEqual({
      ability: 'cha',
      dc: 10,
      targets:
        'one creature within 5 feet the sprite can see (Celestials, Fiends, and Undead automatically fail the save)',
      autoFailTypes: ['Celestial', 'Fiend', 'Undead'],
      onSuccess: 'none',
      onFailure: [{ kind: 'reveals', facts: ['emotions', 'alignment'] }],
    });
  });
});

describe('a sprite looking into a bandit', () => {
  it("learns the bandit's alignment on a failed save, and is told the emotions are the table's", () => {
    const seen: boolean[] = [];
    for (const seed of SEEDS) {
      const { out, state } = looked(BANDIT, seed);
      const [one] = out.outcomes;
      seen.push(one!.save!.success);
      expect(one!.damage).toBe(0);
      // Nothing lands on the bandit either way.
      expect(state.creatures[BANDIT]!.conditions.conditions).toEqual([]);
      if (one!.save!.success) {
        expect(one!.revealed).toBeUndefined();
        expect(out.unverified.some((line) => line.includes('emotions'))).toBe(false);
      } else {
        expect(one!.revealed).toEqual({ alignment: 'Neutral', toTheTable: ['emotions'] });
        expect(out.unverified.some((line) => line.includes('emotions'))).toBe(true);
      }
    }
    expect(seen).toContain(true);
    expect(seen).toContain(false);
  });

  it("reads a character's alignment off the choices that made them", () => {
    for (const seed of SEEDS) {
      const { out } = looked(BREN, seed);
      const [one] = out.outcomes;
      if (one!.save!.success) continue;
      expect(one!.revealed?.alignment).toBe('Neutral Good');
      return;
    }
    throw new Error('no seed failed the save');
  });
});

describe('a sprite looking into a fiend', () => {
  it('rolls nothing: the imp fails automatically and its alignment is known', () => {
    const { out } = looked(IMP, 'fiend');
    const [one] = out.outcomes;
    expect(one!.save).toBeNull();
    expect(one!.autoFailed).toBe(true);
    expect(one!.revealed).toEqual({ alignment: 'Lawful Evil', toTheTable: ['emotions'] });
    expect(out.events.some((e) => e.type === 'roll-recorded')).toBe(false);
    // The Action was still spent: the sprite looked.
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
    // And the caller is told why there was no die.
    expect(out.unverified.some((line) => line.includes('automatically'))).toBe(true);
  });
});
