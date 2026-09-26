/**
 * A Reaction whose printed response the engine **performs**.
 *
 * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
 * rust monster. _Response:_ The rust monster uses Antennae." Both halves were
 * built and they had never met: `hit-by-attack` is the window `takeAttackReaction`
 * holds, and Antennae is a printed save `forcePrintedSaveOn` has rolled since
 * the object-penalty clause landed. What the Reaction did was hand the name
 * back, which is the whole of what this changes — the response is rolled, and
 * the one fact the DM's door has to state for an Antennae spent as an Action
 * is the one the trigger already knows: the weapon that hit.
 *
 * The object is `pendingAttack.weapon`, which is the copy in the attacker's
 * hand as the log recorded it. A blow struck with no catalogue weapon behind
 * it — a claw, a stat block's own line — leaves the response nothing to eat,
 * and that is reported rather than guessed at.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  equipItem,
  placeCreatureInScene,
  resolveAttack,
  setScene,
  takeAttackReaction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const RUST = id('rust');
const REFLEX = 'rust-monster:reflexive-antennae';

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

/** Bren with a longsword drawn, the rust monster in front of him. */
function inTheMine(): GameState {
  let state = fold('mine', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  state = after(state, [
    { type: 'items-gained', id: BREN, items: [{ id: 'longsword', quantity: 1 }], source: 'the test' },
  ]);
  step(equipItem(state, SRD_CONTENT, BREN, 'longsword'), 'draw the longsword');
  state = after(
    state,
    unwrap(addCreature(state, SRD_CONTENT, RUST, 'rust-monster'), 'the rust monster').events,
  );
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the seam', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the seam' }, feet: 0 }), 'place Bren');
  step(
    placeCreatureInScene(state, RUST, { from: { creature: BREN }, feet: 5, bearing: 90 }),
    'place the rust monster',
  );
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(declareCreatureSide(state, RUST, 'vermin'), 'side');
  step(
    beginCombat(state, [
      { id: BREN, initiative: 20, speed: 30 },
      { id: RUST, initiative: 1, speed: 40 },
    ]),
    'combat',
  );
  return state;
}

/** Bren's longsword, held at the hold so the Reaction has a swing to answer. */
function heldHit(state: GameState, weapon: string | null): GameState {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const swung = unwrap(
      resolveAttack(
        state,
        BREN,
        {
          target: RUST,
          weapon,
          hold: true,
          attackBonuses: [{ source: 'the test insists', flat: 40 }],
          commandId: `swing-${attempt}`,
        },
        supply(`swing-${attempt}`),
      ),
      'the swing',
    );
    if (swung.attack?.hit === true) return after(state, swung.events);
  }
  throw new Error('no seed hit the rust monster');
}

const penaltyOn = (state: GameState, item: string): number | undefined =>
  state.creatures[BREN]!.equipped.find((held) => held.id === item)?.penalty;

describe('the rust monster answers a hit by using its own line', () => {
  it('rolls Antennae against the weapon that hit, with nobody naming the object', () => {
    const held = heldHit(inTheMine(), 'longsword');

    // Twelve seeds, because the response is a save Bren may make; the first
    // one he fails is what the sentence is about.
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const taken = unwrap(
        takeAttackReaction(held, RUST, { feature: REFLEX, commandId: seed }, supply(seed)),
        'the antennae',
      );
      expect(taken.performed?.line).toBe('Antennae');
      const save = taken.performed!.outcome.save;
      expect(save).not.toBeNull();
      if (save!.success) continue;

      const world = after(held, taken.events);
      expect(penaltyOn(world, 'longsword')).toBe(1);
      expect(taken.performed!.outcome.object).toEqual({
        item: 'longsword',
        penalty: 1,
        destroyed: false,
      });
      // The Reaction is spent and the blow is untouched: the hold still stands
      // and Bren's damage is still his to roll.
      expect(taken.missed).toBe(false);
      expect(world.pendingAttack).not.toBeNull();
      expect(world.combat!.budgets[RUST]!.reaction).toBe(false);
      // And nothing is handed back: the Antennae's every sentence is a rule the
      // engine keeps now, the Mending among them, so a response that used to
      // come back as a heading comes back as a rolled save.
      expect(taken.unverified).toEqual([]);
      return;
    }
    throw new Error('no seed failed the save');
  });

  it('reports a blow with no weapon behind it rather than eating nothing', () => {
    const held = heldHit(inTheMine(), null);
    const taken = unwrap(
      takeAttackReaction(held, RUST, { feature: REFLEX, commandId: 'fist' }, supply('fist')),
      'the antennae',
    );
    // SRD Antennae reaches "one nonmagical metal object—armor or a weapon—worn
    // or carried"; an Unarmed Strike put nothing in the trigger to reach for.
    expect(taken.performed).toBeUndefined();
    expect(taken.unverified.join(' ')).toContain('no weapon');
    expect(after(held, taken.events).combat!.budgets[RUST]!.reaction).toBe(false);
  });
});
