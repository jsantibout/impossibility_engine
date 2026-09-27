/**
 * The wind and the table's word, through the door (W9-S2): a model casts Fog
 * Cloud, the table says a gale blows, and `look` no longer shows the fog; the
 * table's word on a phrase the spell does not print is refused, naming none.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { declaredCasting, resolveSpell, type GameEvent } from '@ie/engine';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { createCampaign, createDmSurface, restoreCampaign, type ToolOutcome } from '@ie/tools';

const wizard = (): Record<string, unknown> => ({
  name: 'Ander',
  classId: 'wizard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'ray-of-frost'],
  spellbook: ['magic-missile', 'shield', 'detect-magic', 'fog-cloud', 'mage-armor', 'sleep'].map(
    (spellId) => ({ spellId, acquiredAt: 1, origin: 'level' }),
  ),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'fog-cloud'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'wizard:scholar': ['arcana'], 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'prestidigitation'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'a-gale-through-the-window') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call, look: () => surface.observe() };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 500)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

const fogged = () => {
  const t = table();
  expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the stair', at: { x: 20, y: 20 } }));
  expectOk(t.call('place_creature', { who: 'ander', fromLandmark: 'the stair', feet: 0 }));
  const cast = expectOk(
    t.call('cast_spell', { caster: 'ander', spellId: 'fog-cloud', targets: [], at: { x: 80, y: 80 } }),
  );
  return { t, castingId: cast['castingId'] as string };
};

describe('a gale the table declares', () => {
  it('disperses the fog a model cast, whole-scene', () => {
    const { t, castingId } = fogged();
    expect(t.look().ongoing.map((one) => one.castingId)).toContain(castingId);

    expectOk(t.call('declare_wind', {}));
    expect(t.look().ongoing.map((one) => one.castingId)).not.toContain(castingId);
  });

  it('reaches only where it blows when given a place', () => {
    const { t, castingId } = fogged();
    expectOk(t.call('declare_wind', { at: { x: 180, y: 180 }, radius: 5 }));
    expect(t.look().ongoing.map((one) => one.castingId)).toContain(castingId);
    expectOk(t.call('declare_wind', { at: { x: 80, y: 80 }, radius: 5 }));
    expect(t.look().ongoing.map((one) => one.castingId)).not.toContain(castingId);
  });

  it('refuses a place with no reach, or a reach from nowhere', () => {
    const { t } = fogged();
    expect(t.call('declare_wind', { at: { x: 80, y: 80 } }).status).toBe('invalid');
    expect(t.call('declare_wind', { radius: 10 }).status).toBe('invalid');
  });
});

describe('the table’s word', () => {
  it('refuses a phrase the spell does not print, and says the spell prints none', () => {
    const { t, castingId } = fogged();
    const out = t.call('declare_ending', { castingId, what: 'the fog is anchored' });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('not_its_cause');
    expect(out.reason).toContain('prints no ending the table declares');
  });
});

describe('the table’s word on a web', () => {
  /**
   * The deferred path through the door: the answer names the moment the web
   * collapses rather than saying it is gone, because it is not — SRD Web ends
   * "at the start of your next turn", and until then its terrain, its fog and
   * its Restrained all stand.
   */
  it('answers with the moment, and the web still runs until it comes', () => {
    const seed = 'an-unanchored-web';
    const weaver = asCharacterId('weaver');
    const room: readonly GameEvent[] = [
      {
        type: 'creature-added',
        id: weaver,
        name: 'Weaver',
        sheet: {
          level: 5,
          abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 30,
          spellcastingAbility: 'int',
        },
        maxHp: 30,
        diesAtZero: false,
        creatureType: 'Humanoid',
      },
      {
        type: 'spellcasting-declared',
        id: weaver,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['web'] }),
      },
      {
        type: 'resource-pool-declared',
        id: weaver,
        pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
      },
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
      { type: 'landmark-added', name: 'the loom', at: { x: 10, y: 10, z: 0 } },
      { type: 'creature-placed', id: weaver, placement: { from: { landmark: 'the loom' }, feet: 0 } },
      { type: 'combat-started', combatants: [{ id: weaver, initiative: 12, speed: 30 }] },
    ];
    // The room and then the web restored as a stored log, which is the door
    // a campaign comes back through — nothing here appends to one, and the
    // web is spun by the engine command with the room campaign's own supply.
    const before = restoreCampaign({ content: SRD_CONTENT, record: { seed, contentRef: 'srd', log: room } });
    const spun = unwrap(
      resolveSpell(
        before.state(),
        weaver,
        { spellId: 'web', targets: [], at: { x: 40, y: 40, z: 0 }, towards: { x: 60, y: 40, z: 0 }, slotLevel: 2 },
        before.supply(),
      ),
      'the web',
    );
    const campaign = restoreCampaign({
      content: SRD_CONTENT,
      record: { seed, contentRef: 'srd', log: [...room, ...spun.events] },
    });
    const surface = createDmSurface(campaign);
    const castingId = spun.castingId!;

    const said = expectOk(
      surface.call({
        tool: 'declare_ending',
        input: { castingId, what: 'the webs are not anchored' },
        commandId: 'toolu_word',
      }),
    );
    expect(said).toEqual({ ending: castingId, at: 'start-of-casters-next-turn' });
    expect(surface.observe().ongoing.map((one) => one.castingId)).toContain(castingId);
  });
});
