/**
 * SRD Rust Monster's Antennae: a save whose failure wears an **object** down.
 *
 * "The rust monster targets one nonmagical metal object—armor or a weapon—worn
 * or carried by a creature within 5 feet of itself. _Dexterity Saving Throw:_
 * DC 11, the creature with the object. _Failure:_ The object takes a −1
 * penalty to the AC it offers (armor) or to its attack rolls (weapon). Armor
 * is destroyed if the penalty reduces its AC to 10, and a weapon is destroyed
 * if its penalty reaches −5. The penalty can be removed by casting the
 * _Mending_ spell on the armor or weapon."
 *
 * The hit-riders track built the armour half for the Black Pudding —
 * `EquippedItem.penalty`, destroyed at 10 — on a **hit**. This is the same
 * sentence on a **save**, with the weapon half beside it: a weapon's penalty
 * lands on the copy in hand, is read at the swing as a named subtraction from
 * the attack roll, and breaks the weapon at −5 through the door every lost
 * item leaves by. Which object the antennae touch is the one fact the table
 * supplies — "the creature with the object" names a creature, and a creature
 * may be wearing mail and holding a sword — so the DM's door states it and a
 * call that does not is asked. The Mending sentence is the spells side's and
 * is handed over, so the line stays on the ledger's over-read row until a
 * casting can reach an item's record.
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
  forcePrintedSave,
  placeCreatureInScene,
  quantityOf,
  resolveAttack,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { armorClassOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const RUST = id('rust');

const LINE = 'Antennae';

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

/** The rust monster first in the order; Bren in chain mail with a longsword in hand. */
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
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, RUST, 'rust-monster'), 'rust monster').events);
  step(setScene(state, { width: 120, depth: 80, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the seam', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the seam' }, feet: 0 }), 'place Bren');
  step(placeCreatureInScene(state, RUST, { from: { creature: BREN }, feet: 5, bearing: 90 }), 'place rust');
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(declareCreatureSide(state, RUST, 'vermin'), 'side');
  step(
    beginCombat(state, [
      { id: RUST, initiative: 20, speed: 40 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/** The antennae at one object under one seed. */
function touched(state: GameState, object: string, seed: string) {
  const out = unwrap(
    forcePrintedSave(
      state,
      RUST,
      { line: LINE, targets: [BREN], object, commandId: `antennae-${object}-${seed}` },
      supply(seed),
    ),
    'the antennae',
  );
  return { out, state: after(state, out.events) };
}

/** The first seed under which Bren fails, and the world after it. */
function failed(state: GameState, object: string) {
  for (const seed of SEEDS) {
    const world = touched(state, object, seed);
    if (!world.out.outcomes[0]!.save!.success) return world;
  }
  throw new Error('no seed failed the save');
}

const penaltyOn = (state: GameState, item: string): number | undefined =>
  state.creatures[BREN]!.equipped.find((held) => held.id === item)?.penalty;

describe('the line as the parser reads it', () => {
  it('reads the object the prelude names, the penalty, the two ceilings, and hands the Mending over', () => {
    const block = SRD_CONTENT.monsters.find((m) => m.id === 'rust-monster')!;
    const line = block.actions.find((one) => one.name === LINE)!;
    expect(line.save).toEqual({
      ability: 'dex',
      dc: 11,
      targets: 'the creature with the object',
      targetsObject: true,
      onSuccess: 'none',
      onFailure: [{ kind: 'object-penalty', points: 1 }],
      handedOver: ['The penalty can be removed by casting the _Mending_ spell on the armor or weapon.'],
    });
  });
});

describe('a failed save with the antennae on the mail', () => {
  it('takes a point off the chain mail and off the Armour Class it offers', () => {
    const before = inTheMine();
    const was = armorClassOf(before, BREN);
    const { out, state } = failed(before, 'chain-mail');
    expect(out.events.some((e) => e.type === 'armor-penalised')).toBe(true);
    expect(penaltyOn(state, 'chain-mail')).toBe(1);
    expect(armorClassOf(state, BREN)).toBe(was - 1);
    expect(out.outcomes[0]!.object).toEqual({ item: 'chain-mail', penalty: 1, destroyed: false });
    // Only the Mending sentence and the reach are the table's.
    expect(out.unverified.some((line) => line.includes('Mending'))).toBe(true);
  });

  it('destroys the mail when the penalty would take what it offers to 10', () => {
    // Chain mail offers 16; five points are already gone.
    const worn = after(inTheMine(), [
      { type: 'armor-penalised', id: BREN, item: 'chain-mail', points: 5 },
    ]);
    const { out, state } = failed(worn, 'chain-mail');
    expect(out.events.some((e) => e.type === 'item-unequipped')).toBe(true);
    expect(out.events.some((e) => e.type === 'items-lost')).toBe(true);
    expect(state.creatures[BREN]!.equipped.some((held) => held.id === 'chain-mail')).toBe(false);
    expect(quantityOf(state, BREN, 'chain-mail')).toBe(0);
    expect(out.outcomes[0]!.object).toEqual({ item: 'chain-mail', penalty: 6, destroyed: true });
  });
});

describe('a failed save with the antennae on the sword', () => {
  it('takes a point off the longsword, and the swing subtracts it by name', () => {
    const { out, state } = failed(inTheMine(), 'longsword');
    expect(out.events.some((e) => e.type === 'weapon-penalised')).toBe(true);
    expect(penaltyOn(state, 'longsword')).toBe(1);
    expect(out.outcomes[0]!.object).toEqual({ item: 'longsword', penalty: 1, destroyed: false });

    const swung = unwrap(
      resolveAttack(
        after(state, [{ type: 'turn-advanced' }]),
        BREN,
        { target: RUST, weapon: 'longsword', attackBonuses: [{ source: 'the test insists', flat: 40 }] },
        supply('swing'),
      ),
      'the swing',
    );
    const roll = swung.events.find((e) => e.type === 'roll-recorded');
    if (roll?.type !== 'roll-recorded') throw new Error('no attack roll');
    const named = roll.contributions.find((one) => one.amount === -1);
    expect(named?.source).toContain('Longsword');
    // The mail is untouched: the antennae reached one object.
    expect(penaltyOn(state, 'chain-mail')).toBeUndefined();
  });

  it('breaks the longsword when its penalty reaches −5', () => {
    const worn = after(inTheMine(), [
      { type: 'weapon-penalised', id: BREN, item: 'longsword', points: 4 },
    ]);
    const { out, state } = failed(worn, 'longsword');
    expect(out.events.some((e) => e.type === 'item-unequipped')).toBe(true);
    expect(out.events.some((e) => e.type === 'items-lost')).toBe(true);
    expect(quantityOf(state, BREN, 'longsword')).toBe(0);
    expect(out.outcomes[0]!.object).toEqual({ item: 'longsword', penalty: 5, destroyed: true });
  });
});

describe('what the door asks and refuses', () => {
  it('asks which object rather than guessing, and refuses one the target is not wearing or holding', () => {
    const state = inTheMine();
    const unnamed = forcePrintedSave(state, RUST, { line: LINE, targets: [BREN], commandId: 'x' }, supply('x'));
    expect(unnamed.ok).toBe(false);
    if (unnamed.ok) return;
    expect(unnamed.kind).toBe('needs-context');
    expect(unnamed.code).toBe('undeclared_object');

    const pocketed = forcePrintedSave(
      state,
      RUST,
      { line: LINE, targets: [BREN], object: 'greatsword', commandId: 'y' },
      supply('y'),
    );
    expect(pocketed.ok).toBe(false);
    if (pocketed.ok) return;
    expect(pocketed.code).toBe('object_not_held');
    // Nothing was spent asking.
    expect(state.combat!.budgets[RUST]!.action).toBe(true);
  });

  it('touches nothing on a made save', () => {
    for (const seed of SEEDS) {
      const { out, state } = touched(inTheMine(), 'longsword', seed);
      if (!out.outcomes[0]!.save!.success) continue;
      expect(penaltyOn(state, 'longsword')).toBeUndefined();
      expect(out.outcomes[0]!.object).toBeUndefined();
      expect(out.events.some((e) => e.type === 'weapon-penalised')).toBe(false);
      return;
    }
    throw new Error('no seed made the save');
  });
});
