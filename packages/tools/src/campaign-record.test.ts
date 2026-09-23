/**
 * A campaign put on a wire and taken off it again.
 *
 * The session boundary says a campaign owns three things — the seed, the
 * content and the log — and that `GameState` and the generator are both
 * *derived*. So the record is those three things minus the one that cannot be
 * written down: a `Content` holds closures, and what a store holds in its
 * place is a caller-supplied `contentRef` naming the book to rebuild it from.
 * Nothing here derives that name; the engine may not (rule 2) and this layer
 * will not guess.
 *
 * The criterion is not "the state matches". It is that **a restored campaign
 * throws the next die the live one would have** — the generator's position is
 * carried by `rolls-issued` in the log itself, so a restore that replayed the
 * log has already resumed it. These tests hold all three: the folded state,
 * the issuer's count, and the events the next rolling call writes. Not the
 * generator itself: `boundary.test.ts` sweeps this file for a binding of it,
 * as it sweeps every file but the one that rebuilds one, and the state
 * comparison already carries the position a snapshot would have shown.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createSurface,
  restoreCampaign,
  serializeCampaign,
  type Campaign,
  type CampaignRecord,
  type Surface,
  type ToolOutcome,
} from '@ie/tools';

const SEED = 'campaign-record';
const REF = 'srd-5.2.1';

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
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
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

/** A table that numbers its own `tool_use.id`s, as a transport would. */
function table(campaign: Campaign, from = 0) {
  const surface = createSurface(campaign);
  let calls = from;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call, at: () => calls };
}

/** A dozen-odd calls, of which several throw dice: a fight, not a set-up. */
function playADozen(t: ReturnType<typeof table>): void {
  expectOk(t.call('create_character', { id: 'brann', choices: fighter('Brann') }));
  expectOk(t.call('create_character', { id: 'harl', choices: fighter('Harl') }));
  expectOk(t.call('declare_side', { who: 'brann', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'harl', side: 'rivals' }));
  expectOk(t.call('set_scene', { width: 40, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the well', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'brann', fromLandmark: 'the well', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'harl', fromCreature: 'brann', feet: 5, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: 'brann', to: 'harl', seen: true }));
  expectOk(t.call('declare_sight', { from: 'harl', to: 'brann', seen: true }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'brann' }, { who: 'harl' }] }));
  const order = t.surface.observe().initiativeOrder!;
  expectOk(t.call('attack', { attacker: order[0]!, target: order[1]!, weapon: 'greatsword' }));
  expectOk(t.call('end_turn', {}));
}

/** The next call that rolls, on whichever surface is handed in. */
const swingAgain = (t: ReturnType<typeof table>): ToolOutcome => {
  const seen = t.surface.observe();
  const attacker = seen.turnOf!;
  const target = seen.initiativeOrder!.find((who) => who !== attacker)!;
  return t.call('attack', { attacker, target, weapon: 'greatsword' });
};

describe('a campaign serialized and restored', () => {
  it('folds to the same state, byte for byte, through JSON', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    expect(live.campaign.log().length).toBeGreaterThan(20);

    const record = serializeCampaign(live.campaign, REF);
    expect(record.seed).toBe(SEED);
    expect(record.contentRef).toBe(REF);

    const onTheWire = JSON.parse(JSON.stringify(record)) as CampaignRecord;
    const restored = restoreCampaign({ content: SRD_CONTENT, record: onTheWire });

    expect(JSON.stringify(restored.state())).toBe(JSON.stringify(live.campaign.state()));
    expect(JSON.stringify(restored.log())).toBe(JSON.stringify(live.campaign.log()));
    expect(restored.seed).toBe(live.campaign.seed);
  });

  /**
   * The generator's position, asserted without reaching for the generator.
   *
   * `boundary.test.ts` sweeps every file in this package — tests included —
   * for a binding of the supply's generator, and exempts exactly one: the file
   * that rebuilds it. So this does not call `snapshot()`. It does not have to:
   * the position a snapshot would show is folded into `GameState` from the
   * log's own `rolls-issued` events, and the test above compares the whole
   * state byte for byte. What is left to say here is the issuer's count, and
   * the test below says the rest in the only terms that matter — the events
   * the next rolling call writes.
   */
  it('resumes the roll issuer exactly where the log left it', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    const restored = restoreCampaign({
      content: SRD_CONTENT,
      record: JSON.parse(JSON.stringify(serializeCampaign(live.campaign, REF))) as CampaignRecord,
    });

    // `count` is what an issuer has issued since it was built, so both are
    // zero: a supply is rebuilt per call and thrown away. Where it *resumes*
    // from is `rollsIssued`, which is the number the next roll id is cut from.
    expect(restored.supply().issuer.count).toBe(live.campaign.supply().issuer.count);
    expect(restored.state().rollsIssued).toBe(live.campaign.state().rollsIssued);
    expect(restored.state().rollsIssued).toBeGreaterThan(0);
  });

  it('throws the next die the live campaign would have', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    const restored = restoreCampaign({
      content: SRD_CONTENT,
      record: JSON.parse(JSON.stringify(serializeCampaign(live.campaign, REF))) as CampaignRecord,
    });

    // The same next call, under the same command id, on both surfaces.
    const here = expectOk(swingAgain(live));
    const there = expectOk(swingAgain(table(restored, live.at() - 1)));
    expect(JSON.stringify(there.events)).toBe(JSON.stringify(here.events));
    expect(JSON.stringify(there.resolution)).toBe(JSON.stringify(here.resolution));
    // And a die really was thrown, or this proves nothing.
    expect(here.events.some((event) => event.type === 'rolls-issued')).toBe(true);
  });

  it('restores an empty record to a fresh campaign with that seed', () => {
    const fresh = createCampaign({ content: SRD_CONTENT, seed: SEED });
    const restored = restoreCampaign({
      content: SRD_CONTENT,
      record: { seed: SEED, contentRef: REF, log: [] },
    });
    expect(restored.seed).toBe(SEED);
    expect(restored.log()).toHaveLength(0);
    expect(JSON.stringify(restored.state())).toBe(JSON.stringify(fresh.state()));
    expect(restored.supply().issuer.count).toBe(fresh.supply().issuer.count);
  });

  it('is a snapshot: playing on does not change a record already taken', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    const record = serializeCampaign(live.campaign, REF);
    const taken = record.log.length;
    swingAgain(live);
    expect(record.log).toHaveLength(taken);
    expect(live.campaign.log().length).toBeGreaterThan(taken);
  });

  it('throws CorruptLogError on a log the fold refuses, rather than half a campaign', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    const record = serializeCampaign(live.campaign, REF);
    // The log with its first event — the roster arriving — cut out of it.
    const maimed: CampaignRecord = { ...record, log: record.log.slice(1) };
    let thrown: unknown;
    try {
      restoreCampaign({ content: SRD_CONTENT, record: maimed });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('CorruptLogError');
  });
});

describe('the surface over a restored campaign', () => {
  it('is a surface like any other: it observes and it calls', () => {
    const live = table(createCampaign({ content: SRD_CONTENT, seed: SEED }));
    playADozen(live);
    const restored = restoreCampaign({
      content: SRD_CONTENT,
      record: serializeCampaign(live.campaign, REF),
    });
    const resumed: Surface = createSurface(restored);
    expect(resumed.observe().initiativeOrder).toHaveLength(2);
    expect(
      resumed
        .observe()
        .creatures.map((creature) => creature.id)
        .sort(),
    ).toEqual(['brann', 'harl']);
  });
});
