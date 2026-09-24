/**
 * A sense that reports — SRD Divine Sense, through the door.
 *
 * > "As a Bonus Action, you can open your awareness to detect Celestials,
 * > Fiends, and Undead. For the next 10 minutes or until you have the
 * > Incapacitated condition, you know the location of any creature of those
 * > types within 60 feet of yourself, and you know its creature type."
 *
 * The engine derives the answer; this is the half that makes it worth
 * deriving. A feature whose whole effect is a fact nobody publishes is a
 * Channel Divinity use spent on silence, so the awareness arrives on `look` as
 * a `senses` section beside the creature it belongs to — beside `creatureType`
 * and `feetTo`, which are the same two facts about everybody the Paladin can
 * *see*.
 *
 * A `senses` section on `look` rather than a `divine_sense` tool of its own,
 * and the reason is the one `look`'s own note gives: it is the scan of the
 * room, every field of it is read off state through an engine reader, and a
 * second tool would be a second call a caller has to know to make before it
 * can narrate what its character already knows.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const paladin = (name: string): Record<string, unknown> => ({
  name,
  classId: 'paladin',
  level: 3,
  subclassId: 'oath-of-devotion',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
  },
  abilityIncreases: { cha: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Lawful Good',
  cantrips: [],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'heroism', 'divine-favor', 'bless'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'human:versatile': { featId: 'alert' },
    'paladin:fighting-style': { featId: 'defense' },
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'divine-sense') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { call };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome.resolution as Record<string, unknown>;
};

interface Awareness {
  readonly feature: string;
  readonly name: string;
  readonly feet: number;
  readonly creatureTypes: readonly string[];
  readonly found: readonly {
    readonly who: string;
    readonly creatureType: string | null;
    readonly feet: number;
  }[];
}

interface Seen {
  readonly id: string;
  readonly senses: readonly Awareness[];
}

const sensesOfLook = (t: ReturnType<typeof table>, who: string): readonly Awareness[] =>
  (
    (expectOk(t.call('look'))['creatures'] as readonly Seen[]).find(
      (one) => one.id === who,
    ) as Seen
  ).senses;

/** A Paladin, a Fiend at forty feet, an Undead at fifty-five, and two who do not count. */
function shrine() {
  const t = table();
  expectOk(t.call('create_character', { id: 'ardan', choices: paladin('Ardan') }));
  expectOk(t.call('add_creature', { id: 'imp', monsterId: 'imp' }));
  expectOk(t.call('add_creature', { id: 'zombie', monsterId: 'zombie' }));
  expectOk(t.call('add_creature', { id: 'thug', monsterId: 'bandit' }));
  expectOk(t.call('add_creature', { id: 'far-imp', monsterId: 'imp' }));
  expectOk(t.call('set_scene', { width: 400, depth: 400, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the shrine', at: { x: 150, y: 150 } }));
  expectOk(t.call('place_creature', { who: 'ardan', fromLandmark: 'the shrine', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'imp', fromCreature: 'ardan', feet: 40, bearing: 0 }));
  expectOk(t.call('place_creature', { who: 'zombie', fromCreature: 'ardan', feet: 55, bearing: 90 }));
  expectOk(t.call('place_creature', { who: 'thug', fromCreature: 'ardan', feet: 20, bearing: 180 }));
  expectOk(t.call('place_creature', { who: 'far-imp', fromCreature: 'ardan', feet: 65, bearing: 270 }));
  return t;
}

describe('Divine Sense reaches the door', () => {
  it('reports nothing before the Channel Divinity is spent', () => {
    expect(sensesOfLook(shrine(), 'ardan')).toEqual([]);
  });

  it('names the Fiend and the Undead with their types, and nobody else', () => {
    const t = shrine();
    expectOk(t.call('activate_feature', { who: 'ardan', feature: 'paladin:channel-divinity' }));

    const senses = sensesOfLook(t, 'ardan');
    expect(senses).toHaveLength(1);
    expect(senses[0]).toMatchObject({
      feature: 'paladin:channel-divinity',
      feet: 60,
      creatureTypes: ['Celestial', 'Fiend', 'Undead'],
    });
    const found = senses[0]!.found;
    expect(found).toContainEqual({ who: 'imp', creatureType: 'Fiend', feet: 40 });
    expect(found).toContainEqual({ who: 'zombie', creatureType: 'Undead', feet: 55 });
    expect(found.map((one) => one.who)).not.toContain('thug');
    expect(found.map((one) => one.who)).not.toContain('far-imp');
  });

  it('closes when the ten minutes are up', () => {
    const t = shrine();
    expectOk(t.call('activate_feature', { who: 'ardan', feature: 'paladin:channel-divinity' }));
    expectOk(t.call('advance_time', { minutes: 10, because: 'the watch changes' }));
    expect(sensesOfLook(t, 'ardan')).toEqual([]);
  });

  it('closes the moment the Paladin is Incapacitated', () => {
    const t = shrine();
    expectOk(t.call('activate_feature', { who: 'ardan', feature: 'paladin:channel-divinity' }));
    expectOk(
      t.call('apply_condition', { who: 'ardan', condition: 'stunned', ruling: 'a gaze' }),
    );
    expect(sensesOfLook(t, 'ardan')).toEqual([]);
  });
});
