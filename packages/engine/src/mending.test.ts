/**
 * The Mending residue — a penalty a spell lifts.
 *
 * Three bestiary lines end with one sentence the engine could not honour: SRD
 * Rust Monster's Antennae, SRD Black Pudding's Dissolving Pseudopod and SRD
 * Gray Ooze's Pseudopod each print "The penalty can be removed by casting the
 * _Mending_ spell on the armor or weapon." The penalty itself has been executed
 * since the object clauses landed — `EquippedItem.penalty`, the two ceilings,
 * the destruction — and the sentence that lifts it belonged to a spell whose
 * definition ran nothing at all.
 *
 * So Mending gains **one** effect the engine can run: `repairs`, which clears
 * the recorded penalty from the copy the caster names. Everything else the
 * spell prints — which break was mended, the foot it may not exceed, the ban
 * on restoring magic to a magic item — stays `dmDecides`, because the engine
 * holds nothing about the *condition* of an object and never claimed to.
 *
 * The object is named the way SRD Heat Metal's and SRD Remove Curse's are:
 * `CastSpellRequest.object`, a copy out of what the target is wearing or
 * holding, with the creature as the target the touch is measured to. A penalty
 * lives on the equipped record, so there is nothing else it *could* be — an
 * unequipped copy has no record for a penalty to have landed on, which is the
 * limit `EquippedItem.penalty` already states from the other end.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result } from '@ie/shared';
import {
  addSceneLandmark,
  advanceTime,
  equipItem,
  pendingCastingsOf,
  placeCreatureInScene,
  resolveAttack,
  resolveDeclaredCast,
  resolveSpell,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { armorClassOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');

const supply = (seed = 'mend') => ({
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
      // The cantrip this whole file is about, taken by the one route a Fighter
      // has to a Wizard's list.
      cantrips: ['mage-hand', 'mending'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** Bren in rusted mail with a rusted longsword in hand. */
function inTheSmithy(penalties: { readonly mail?: number; readonly sword?: number } = {}): {
  readonly state: GameState;
  readonly log: readonly GameEvent[];
} {
  let state = fold('smithy', []);
  const log: GameEvent[] = [];
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    const events = unwrap(result, label);
    log.push(...events);
    state = after(state, events);
  };
  const plain = (events: readonly GameEvent[]): void => {
    log.push(...events);
    state = after(state, events);
  };
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  plain([
    { type: 'items-gained', id: BREN, items: [{ id: 'longsword', quantity: 1 }], source: 'the test' },
  ]);
  step(equipItem(state, SRD_CONTENT, BREN, 'longsword'), 'draw the longsword');
  step(setScene(state, { width: 60, depth: 60, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the anvil', { x: 20, y: 20, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, BREN, { from: { landmark: 'the anvil' }, feet: 0 }), 'place');
  if (penalties.mail !== undefined) {
    plain([{ type: 'armor-penalised', id: BREN, item: 'chain-mail', points: penalties.mail }]);
  }
  if (penalties.sword !== undefined) {
    plain([{ type: 'weapon-penalised', id: BREN, item: 'longsword', points: penalties.sword }]);
  }
  return { state, log };
}

const penaltyOn = (state: GameState, item: string): number | undefined =>
  state.creatures[BREN]!.equipped.find((held) => held.id === item)?.penalty;

/** Mending is a minute's casting, so it is declared, waited out and settled. */
function mend(
  world: { readonly state: GameState; readonly log: readonly GameEvent[] },
  object: string | undefined,
  seed = 'mend',
): Result<{ readonly events: readonly GameEvent[]; readonly unverified: readonly string[] }> {
  const declared = resolveSpell(
    world.state,
    BREN,
    {
      spellId: 'mending',
      targets: [BREN],
      ...(object === undefined ? {} : { object }),
      commandId: `declare-${seed}`,
    },
    supply(seed),
  );
  if (!declared.ok) return declared;
  const open = after(world.state, declared.value.events);
  const ticked = unwrap(advanceTime(open, 60, 'the minute'), 'tick');
  const waited = after(open, ticked);
  const settled = resolveDeclaredCast(
    waited,
    pendingCastingsOf(waited)[0]!.castingId,
    supply(`${seed}-done`),
  );
  if (!settled.ok) return settled;
  return {
    ok: true,
    value: {
      events: [...declared.value.events, ...ticked, ...settled.value.events],
      unverified: settled.value.unverified,
    },
  };
}

describe('the definition, and what it still hands over', () => {
  it('runs one effect and leaves the fiction to the table', () => {
    const mending = SRD_CONTENT.spell('mending')!;
    expect(mending.effects).toEqual([{ kind: 'repairs', clears: 'printed-penalty' }]);
    // The three sentences about a break, a foot and a magic item are untouched:
    // the engine holds nothing about the condition of an object.
    expect(mending.dmDecides).toHaveLength(3);
    expect(mending.dmDecides!.join(' ')).toContain('no larger than 1 foot');
  });
});

describe('Mending on a rusted weapon', () => {
  it('clears the penalty, and the next swing stops subtracting it', () => {
    const world = inTheSmithy({ sword: 2 });
    expect(penaltyOn(world.state, 'longsword')).toBe(2);

    const mended = unwrap(mend(world, 'longsword'), 'mending');
    const done = after(world.state, mended.events);
    expect(penaltyOn(done, 'longsword')).toBeUndefined();
    expect(
      mended.events.some((e) => e.type === 'item-penalty-cleared' && e.points === 2),
    ).toBe(true);

    const swung = unwrap(
      resolveAttack(
        done,
        BREN,
        { target: BREN, weapon: 'longsword', commandId: 'swing' },
        supply('swing'),
      ),
      'the swing',
    );
    const roll = swung.events.find((e) => e.type === 'roll-recorded');
    if (roll?.type !== 'roll-recorded') throw new Error('no attack roll');
    expect(roll.contributions.some((one) => one.amount < 0)).toBe(false);
  });
});

describe('Mending on rusted armour', () => {
  it('gives the Armour Class back', () => {
    const clean = inTheSmithy();
    const was = armorClassOf(clean.state, BREN);
    const world = inTheSmithy({ mail: 3 });
    expect(armorClassOf(world.state, BREN)).toBe(was - 3);

    const mended = unwrap(mend(world, 'chain-mail'), 'mending');
    const done = after(world.state, mended.events);
    expect(penaltyOn(done, 'chain-mail')).toBeUndefined();
    expect(armorClassOf(done, BREN)).toBe(was);
  });
});

describe('what the spell asks and what it will not guess', () => {
  it('refuses a casting that names no object, before the minute is spent', () => {
    const world = inTheSmithy({ sword: 1 });
    const refused = mend(world, undefined);
    expect(isErr(refused) && refused.code).toBe('object_required');
  });

  it('refuses an object the target is not wearing or holding', () => {
    const world = inTheSmithy({ sword: 1 });
    const refused = mend(world, 'greatsword');
    expect(refused.ok).toBe(false);
  });

  it('mends an unpenalised copy and says so rather than pretending', () => {
    const world = inTheSmithy();
    const mended = unwrap(mend(world, 'longsword'), 'mending');
    expect(mended.events.some((e) => e.type === 'item-penalty-cleared')).toBe(false);
    expect(mended.unverified.join(' ')).toContain('no penalty');
  });
});
