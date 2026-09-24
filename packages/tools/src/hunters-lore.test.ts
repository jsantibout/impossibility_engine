/**
 * A fact that reaches the table — SRD Hunter's Lore, through the door.
 *
 * > "While a creature is marked by your _Hunter's Mark_, you know whether that
 * > creature has any Immunities, Resistances, or Vulnerabilities, and if so,
 * > what they are."
 *
 * The engine derives the answer; this is the half that makes it worth
 * deriving, and it is `divine-sense.test.ts`'s argument with less to spend: a
 * Paladin who was told nothing had at least spent a Channel Divinity to learn
 * it, and a ranger who is told nothing has spent nothing at all — the feature
 * simply is not there. So the answer arrives on `look` as `knownDefences`
 * beside the creature that holds it, next to `senses`, which is the same
 * ruling published through the same door.
 *
 * **This creature's view of the others, not its own defences.** What a
 * creature is Immune to is still not on the wire for everybody; what is here
 * is what one creature is entitled to know about another.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const ranger = (name: string, level = 3): Record<string, unknown> => ({
  name,
  classId: 'ranger',
  level,
  ...(level >= 3 ? { subclassId: 'hunter' } : {}),
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['survival', 'perception', 'stealth'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells:
    level >= 3
      ? ['hunters-mark', 'cure-wounds', 'goodberry', 'ensnaring-strike']
      : ['hunters-mark', 'cure-wounds', 'goodberry'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['athletics'],
    'ranger:deft-explorer': ['survival'],
    ...(level >= 3 ? { 'hunter:hunters-prey': ['Colossus Slayer'] } : {}),
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
    'ranger:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'hunters-lore') {
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

interface Known {
  readonly who: string;
  readonly feature: string;
  readonly damageImmunities: readonly string[];
  readonly damageResistances: readonly string[];
  readonly damageVulnerabilities: readonly string[];
  readonly conditionImmunities: readonly string[];
}

interface Seen {
  readonly id: string;
  readonly knownDefences: readonly Known[];
}

const knownAtLook = (t: ReturnType<typeof table>, who: string): readonly Known[] =>
  (
    (expectOk(t.call('look'))['creatures'] as readonly Seen[]).find(
      (one) => one.id === who,
    ) as Seen
  ).knownDefences;

/** A Ranger, a Ghoul at thirty feet and a Boar at forty. */
function wood(level = 3) {
  const t = table();
  expectOk(t.call('create_character', { id: 'sorrel', choices: ranger('Sorrel', level) }));
  expectOk(t.call('add_creature', { id: 'ghoul', monsterId: 'ghoul' }));
  expectOk(t.call('add_creature', { id: 'boar', monsterId: 'boar' }));
  expectOk(t.call('set_scene', { width: 400, depth: 400, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the treeline', at: { x: 150, y: 150 } }));
  expectOk(t.call('place_creature', { who: 'sorrel', fromLandmark: 'the treeline', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'ghoul', fromCreature: 'sorrel', feet: 30, bearing: 0 }));
  expectOk(t.call('place_creature', { who: 'boar', fromCreature: 'sorrel', feet: 40, bearing: 90 }));
  expectOk(t.call('declare_sight', { from: 'sorrel', to: 'ghoul', seen: true }));
  expectOk(t.call('declare_sight', { from: 'sorrel', to: 'boar', seen: true }));
  return t;
}

const mark = (t: ReturnType<typeof table>, target: string): void => {
  expectOk(
    t.call('cast_spell', { caster: 'sorrel', spellId: 'hunters-mark', targets: [target], slotLevel: 1 }),
  );
};

describe('Hunter’s Lore reaches the door', () => {
  it('says nothing before anything is marked', () => {
    expect(knownAtLook(wood(), 'sorrel')).toEqual([]);
  });

  it('names the Ghoul’s Immunities once it is the quarry, and nobody else’s', () => {
    const t = wood();
    mark(t, 'ghoul');
    const known = knownAtLook(t, 'sorrel');
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({
      who: 'ghoul',
      feature: 'hunter:hunters-lore',
      damageImmunities: ['poison'],
    });
    expect(known[0]?.conditionImmunities).toContain('poisoned');
  });

  /** And the Ghoul is told nothing about the ranger: the licence is one-way. */
  it('gives the quarry no view back', () => {
    const t = wood();
    mark(t, 'ghoul');
    expect(knownAtLook(t, 'ghoul')).toEqual([]);
  });

  /** The mark lasts as long as the casting and the fact lasts as long as the mark. */
  it('says nothing once the hour is up', () => {
    const t = wood();
    mark(t, 'ghoul');
    expectOk(t.call('advance_time', { minutes: 61, because: 'the trail goes cold' }));
    expect(knownAtLook(t, 'sorrel')).toEqual([]);
  });

  /** A Ranger who has not reached the feature marks just as well and learns nothing. */
  it('tells a Ranger without the feature nothing', () => {
    const t = wood(2);
    mark(t, 'ghoul');
    expect(knownAtLook(t, 'sorrel')).toEqual([]);
  });
});
