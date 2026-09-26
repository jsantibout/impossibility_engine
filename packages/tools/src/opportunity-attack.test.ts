/**
 * What a provoked creature swings when nobody says with what — through
 * `take_opportunity_attack`.
 *
 * Owner ruling, 2026-09-20: **a monster's Opportunity Attack is its best
 * printed melee attack.** The engine has answered that since the ruling landed
 * (`reactionSwing`, beside `takeOpportunityAttack`): an omitted weapon on a
 * creature whose block prints attacks of its own is its best printed melee
 * line. An explicit `null` is a different request — an Unarmed Strike, asked
 * for on purpose — and is answered as one.
 *
 * The door could not reach the ruling. It turned an omitted `weapon` into
 * `null`, so every monster's Opportunity Attack arrived as a request for an
 * Unarmed Strike: a goblin punched for 0 damage with a Scimitar in its hand.
 * It also had no `action` field, so there was no way to name a printed line at
 * all. These tests are the door, not the rule; the rule's own tests are the
 * engine's.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

/** A Fighter with a Greatsword and nothing else of interest. */
const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 2,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['warhammer', 'greataxe', 'longsword'] },
  feats: {
    'criminal:alert': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });
  return { campaign, surface, call, rule };
}

type Table = ReturnType<typeof table>;

/**
 * Two creatures adjacent in a fight, on `mover`'s turn, and `mover` walking
 * twenty-five feet straight away from `watcher` — which provokes. `apart` is
 * centre to centre, so a Large watcher needs ten feet to leave room.
 */
function provoke(t: Table, mover: string, watcher: string, apart = 5): void {
  expectOk(t.call('declare_side', { who: mover, side: 'one' }));
  expectOk(t.call('declare_side', { who: watcher, side: 'two' }));
  expectOk(t.call('set_scene', { width: 80, depth: 80, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the ford', at: { x: 40, y: 40 } }));
  expectOk(t.call('place_creature', { who: watcher, fromLandmark: 'the ford', feet: 0 }));
  expectOk(t.call('place_creature', { who: mover, fromCreature: watcher, feet: apart, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: watcher, to: mover, seen: true }));
  expectOk(t.call('declare_sight', { from: mover, to: watcher, seen: true }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: mover }, { who: watcher }] }));
  if (t.surface.observe().turnOf !== mover) expectOk(t.call('end_turn'));
  expect(t.surface.observe().turnOf).toBe(mover);

  expectOk(t.call('move', { who: mover, fromCreature: watcher, feet: 25 }));
  expect(t.surface.observe().owed.pendingMove?.mustAnswerOpportunityAttack).toEqual([watcher]);
}

/** The attack roll the swing threw, by the label the engine gave it. */
const swungWith = (outcome: ToolOutcome): string => {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
  const rolls = outcome.events.flatMap((event) =>
    event.type === 'roll-recorded' && event.attackRoll === true ? [event.label] : [],
  );
  expect(rolls).toHaveLength(1);
  return rolls[0]!;
};

/** The damage the swing dealt to `target`, with what the engine says dealt it. */
const dealt = (outcome: ToolOutcome, target: string) => {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`);
  return outcome.events.flatMap((event) =>
    event.type === 'damage-taken' && event.id === target
      ? [{ amount: event.amount, source: event.source }]
      : [],
  );
};

describe('a monster provoked with no weapon named swings its best printed melee line', () => {
  it('a goblin swings its printed Scimitar, not a fist', () => {
    const t = table('the-goblin-at-the-ford');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    provoke(t, 'brann', 'grish');

    const swung = expectOk(t.call('take_opportunity_attack', { attacker: 'grish' }));

    // SRD Goblin Warrior prints two attacks, a Scimitar and a Shortbow; the
    // Shortbow is ranged, so the melee line is the Scimitar. Before the fix
    // this read "Unarmed Strike attack".
    expect(swungWith(swung)).toBe('Scimitar attack');
    // This seed hits, and the blow is the Scimitar's: "5 (1d6 + 2) Slashing
    // damage", so between 3 and 8 with no Advantage on the roll. It used to be
    // an Unarmed Strike at the goblin's Strength of 8, for 0.
    expect(swung.resolution['hit']).toBe(true);
    const blows = dealt(swung, 'brann');
    expect(blows).toHaveLength(1);
    expect(blows[0]!.source).toBe('Scimitar');
    expect(blows[0]!.amount).toBeGreaterThanOrEqual(3);
    expect(blows[0]!.amount).toBeLessThanOrEqual(8);
    expect(swung.resolution['damageDealt']).toBe(blows[0]!.amount);
  });

  it('a brown bear swings the Bite, its best printed melee line', () => {
    const t = table('the-bear-at-the-ford');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('add_creature', { id: 'ursa', monsterId: 'brown-bear' }));
    provoke(t, 'brann', 'ursa', 10);

    const swung = expectOk(t.call('take_opportunity_attack', { attacker: 'ursa' }));

    // `bestPrintedMeleeAttack` takes the melee line with the highest printed
    // average that neither recharges nor is limited per day, the first printed
    // keeping a tie. SRD Brown Bear: Bite "7 (1d8 + 3)", Claw "5 (1d4 + 3)" —
    // so the Bite, and never the Multiattack, which is not an attack.
    expect(swungWith(swung)).toBe('Bite attack');
  });
});

describe('a caller can still name the swing', () => {
  it('names a different printed line with `action`', () => {
    const t = table('the-bear-claws');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('add_creature', { id: 'ursa', monsterId: 'brown-bear' }));
    provoke(t, 'brann', 'ursa', 10);

    const swung = expectOk(t.call('take_opportunity_attack', { attacker: 'ursa', action: 'Claw' }));
    expect(swungWith(swung)).toBe('Claw attack');
  });

  it('asks for an Unarmed Strike on purpose with `weapon: null`', () => {
    const t = table('the-goblin-punches');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    provoke(t, 'brann', 'grish');

    const swung = expectOk(t.call('take_opportunity_attack', { attacker: 'grish', weapon: null }));
    expect(swungWith(swung)).toBe('Unarmed Strike attack');
  });

  it('refuses a weapon and an action named together, before a die is thrown', () => {
    const t = table('the-goblin-twice');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    provoke(t, 'brann', 'grish');
    const before = t.campaign.state().rollsIssued;

    const refusal = t.call('take_opportunity_attack', {
      attacker: 'grish',
      weapon: 'scimitar',
      action: 'Scimitar',
    });
    expect(refusal.status).toBe('refused');
    if (refusal.status !== 'refused') return;
    expect(refusal.code).toBe('two_attacks');
    expect(t.campaign.state().rollsIssued).toBe(before);
  });
});

describe('a character provoked with no weapon named', () => {
  /**
   * Pinned as it stands, not argued for. A character's sheet prints no attack
   * lines, so `reactionSwing` has nothing to choose among and answers an
   * Unarmed Strike — even for a Fighter carrying a Greatsword. The door's fix
   * does not change that: omitted and `null` meant the same thing for a
   * character before, and still do.
   */
  it('makes an Unarmed Strike, as it did before', () => {
    const t = table('the-fighters-at-the-ford');
    expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
    expectOk(t.call('create_character', { id: 'dagna', choices: fighter('Dagna') }));
    provoke(t, 'brann', 'dagna');

    const swung = expectOk(t.call('take_opportunity_attack', { attacker: 'dagna' }));
    expect(swungWith(swung)).toBe('Unarmed Strike attack');
  });
});
