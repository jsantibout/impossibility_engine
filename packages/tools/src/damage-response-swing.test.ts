/**
 * What `take_damage_response` swings, when the reactor wears a stat block.
 *
 * SRD Retaliation: "you can take a Reaction to make one melee attack against
 * that creature, using a weapon or an Unarmed Strike." The engine answers the
 * swing through `reactionSwing`, the same three answers an Opportunity Attack
 * takes: what the caller named, an Unarmed Strike asked for with `null`, and —
 * where the creature's sheet prints attacks of its own — its best printed
 * melee line when nobody said. `DamageResponseCommand` has carried `action`
 * for that since the owner's ruling of 2026-09-20.
 *
 * **The door had not caught up** (W8-T3, found beside W8-T2). It told a caller
 * "Omit for an Unarmed Strike", which is false for anybody wearing a block; it
 * took no `null`, so an Unarmed Strike could not be asked for on purpose; and
 * it published no `action`, so a Zod object stripped the name and the engine
 * swung its default line whatever it was told.
 *
 * A character's sheet prints no attacks, so the reactor here is a Druid in
 * Wild Shape — the one way a character wears a block — of a homebrew species
 * whose one trait is SRD Retaliation's grant, word for word, so a Druid 5 can
 * have it without ten levels of Barbarian.
 *
 * It imports the engine once, for `extendContent`: the homebrew door, not a
 * rule reached past this one.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
// The one engine import: how a catalogue is added to, which is content.
import { extendContent, type Content, type SpeciesDefinition } from '@ie/engine';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

/**
 * SRD Retaliation's grant, word for word, on a homebrew species' trait — the
 * one host a character reaches at level 1 that compiles a Reaction onto the
 * sheet (a feat's grant does not, and `extendContent` says so).
 */
const SNAPPER: SpeciesDefinition = {
  id: 'snapper',
  name: 'Snapper',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'snapper:snapback',
      name: 'Snapback',
      level: 1,
      automation: 'engine',
      note: 'Homebrew for a test: SRD Retaliation, at level 1.',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        reach: { kind: 'self' },
        does: [{ kind: 'melee-attack', withinFeet: 5 }],
      },
    },
  ],
};

const withSnapper = (): Content => {
  const built = extendContent(SRD_CONTENT, { species: [SNAPPER] });
  if (!built.ok) throw new Error(`the homebrew did not load: ${built.reason}`);
  return built.value;
};

/** `wild-shape.test.ts`'s Druid 5, of the homebrew species rather than Human. */
const druid = (): Record<string, unknown> => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'snapper',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

interface Offer {
  readonly id: string;
  readonly window: string;
}

/** A Druid in a wolf's shape, a goblin beside it, and the goblin's blow landed. */
function bitten(seed = 'snapback') {
  const campaign = createCampaign({ content: withSnapper(), seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  expectOk(call('create_character', { id: 'fenn', choices: druid() }));
  expectOk(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(call('declare_side', { who: 'fenn', side: 'party' }));
  expectOk(call('declare_side', { who: 'grish', side: 'goblins' }));
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the glade', at: { x: 10, y: 10 } }));
  expectOk(call('place_creature', { who: 'fenn', fromLandmark: 'the glade', feet: 0 }));
  expectOk(call('place_creature', { who: 'grish', fromCreature: 'fenn', feet: 5, bearing: 90 }));
  // Before the fight, where taking a shape costs no Bonus Action and so does
  // not depend on whose turn the Initiative roll hands out first.
  expectOk(call('assume_shape', { who: 'fenn', feature: 'druid:wild-shape', form: 'wolf' }));
  expectOk(call('roll_initiative', { combatants: [{ who: 'fenn' }, { who: 'grish' }] }));
  expectOk(
    rule('improvised_damage', {
      target: 'fenn',
      amount: 3,
      by: 'grish',
      ruling: 'the goblin’s scimitar',
    }),
  );
  const offered = expectOk(call('options', { who: 'fenn' })).resolution[
    'reactions'
  ] as readonly Offer[];
  const feature = offered.find((offer) => offer.window === 'damaged-by-creature')?.id;
  expect(feature, 'the wolf is offered the swing back').toBeDefined();

  /** The label of the attack roll the answer threw. */
  const swing = (extra: Record<string, unknown>): ToolOutcome =>
    call('take_damage_response', { who: 'fenn', feature, ...extra });
  const swungWith = (outcome: ToolOutcome): readonly string[] =>
    expectOk(outcome).events.flatMap((event) =>
      event.type === 'roll-recorded' && event.attackRoll === true ? [event.label] : [],
    );
  return { campaign, swing, swungWith };
}

describe('take_damage_response, answered by a creature wearing a stat block', () => {
  it('swings the best printed melee line when nothing is named', () => {
    const t = bitten();
    expect(t.swungWith(t.swing({}))).toEqual(['Bite attack']);
  });

  it('makes an Unarmed Strike when asked for one on purpose, with null', () => {
    const t = bitten();
    expect(t.swungWith(t.swing({ weapon: null }))).toEqual(['Unarmed Strike attack']);
  });

  it('swings the printed line it names', () => {
    const t = bitten();
    expect(t.swungWith(t.swing({ action: 'Bite' }))).toEqual(['Bite attack']);
  });

  /**
   * The case that proves the name reaches the engine: a Wolf prints no Claw,
   * and a door that dropped the field would have swung the Bite instead.
   */
  it('refuses a line the block does not print, with nothing written', () => {
    const t = bitten();
    const before = t.campaign.log().length;
    const out = t.swing({ action: 'Claw' });
    expect(out.status).toBe('refused');
    expect(out.status === 'refused' ? out.code : '').toBe('unknown_action');
    expect(t.campaign.log()).toHaveLength(before);
  });
});
