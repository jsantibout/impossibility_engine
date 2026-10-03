/**
 * E-AIM, through the doors: a spell's point stated the way a creature's
 * destination is, a check made with a tool, and three answers that told a
 * caller nothing it could act on.
 *
 * Found by the app's five-scenario playtest. A model could not aim Web or
 * Fireball at all — `at` took feet from the west and south walls, and nothing
 * a caller reads reports a coordinate — so it guessed, and a guess can put a
 * Fireball at the caster's own feet. A Rogue picking a lock rolled raw
 * Dexterity, because `ability_check` took no tool. And a model sprinting after
 * "Rusk", a name the narration used and the engine had never been told, was
 * asked where Rusk was standing — a placement it could not make, for a
 * creature that did not exist.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  abilityModifier,
  declaredCasting,
  positionOf,
  proficiencyBonus,
  remaining,
  type GameEvent,
} from '@ie/engine';
import { asCharacterId } from '@ie/shared';
import {
  createCampaign,
  createDmSurface,
  restoreCampaign,
  type Campaign,
  type ToolOutcome,
} from '@ie/tools';

const HERO = asCharacterId('hero');

const plainSheet = (level: number) => ({
  level,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  baseSpeed: 30,
  spellcastingAbility: 'int' as const,
});

const added = (id: string, level = 1): GameEvent => ({
  type: 'creature-added',
  id: asCharacterId(id),
  name: id,
  sheet: plainSheet(level),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * A level 5 wizard by a door in a 200-foot hall, a creature sixty feet east of
 * her and another ninety, a brazier where the first one stands, and a guardian
 * at her shoulder.
 */
const hall = (): readonly GameEvent[] => [
  added('hero', 5),
  {
    type: 'spellcasting-declared',
    id: HERO,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['web', 'fireball', 'shatter'] }),
  },
  {
    type: 'resource-pool-declared',
    id: HERO,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: HERO,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
  },
  added('near'),
  added('far'),
  added('marker'),
  added('guardian'),
  // Somebody the engine has a record of and nobody has placed.
  added('ghost'),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 20, z: 0 } },
  { type: 'landmark-added', name: 'the brazier', at: { x: 160, y: 20, z: 0 } },
  { type: 'landmark-added', name: 'the far wall', at: { x: 100, y: 150, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the door' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: asCharacterId('near'),
    placement: { from: { creature: HERO }, feet: 60, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: asCharacterId('far'),
    placement: { from: { creature: HERO }, feet: 90, bearing: 90 },
  },
  // Shoulder to shoulder with the hero, to the west: what a Shatter centred
  // on it reaches back to.
  {
    type: 'creature-placed',
    id: asCharacterId('guardian'),
    placement: { from: { creature: HERO }, feet: 5, bearing: 270 },
  },
];

function table(log: readonly GameEvent[] = hall(), seed = 'aiming') {
  const campaign: Campaign = restoreCampaign({
    content: SRD_CONTENT,
    record: { seed, contentRef: 'srd', log: [...log] },
  });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call, campaign };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

const caught = (resolution: Record<string, unknown>): string[] =>
  (resolution['outcomes'] as { target: string }[]).map((one) => one.target).sort();

// — 1. a point stated as a placement ———————————————————————————————————————

describe('cast_spell.at as a placement', () => {
  it('lays Web thirty feet north of the caster, and pins the point it resolved', () => {
    const t = table();
    const out = t.call('cast_spell', {
      caster: 'hero',
      spellId: 'web',
      targets: [],
      slotLevel: 2,
      at: { fromCreature: 'hero', feet: 30, bearing: 0 },
      towardsLandmark: 'the far wall',
    });
    expectOk(out);
    if (out.status !== 'ok') return;
    const ongoing = out.events.find((event) => event.type === 'spell-ongoing');
    expect(ongoing?.type).toBe('spell-ongoing');
    if (ongoing?.type !== 'spell-ongoing') return;
    // The hero stands at (100, 20); thirty feet north is (100, 50). What the
    // event holds is that point and not the placement, so replaying it never
    // asks where the hero was.
    expect(ongoing.casting.origin).toEqual({ x: 100, y: 50, z: 0 });
    expect(JSON.stringify(ongoing)).not.toContain('fromCreature');
  });

  it('resolves exactly where a creature placed the same way would stand', () => {
    const t = table();
    const placement = { fromCreature: 'hero', feet: 30, bearing: 45 };
    expectOk(t.call('place_creature', { who: 'marker', ...placement }));
    const out = t.call('cast_spell', {
      caster: 'hero',
      spellId: 'web',
      targets: [],
      slotLevel: 2,
      at: placement,
      towardsLandmark: 'the far wall',
    });
    expectOk(out);
    if (out.status !== 'ok') return;
    const ongoing = out.events.find((event) => event.type === 'spell-ongoing');
    if (ongoing?.type !== 'spell-ongoing') throw new Error('no ongoing record');
    expect(ongoing.casting.origin).toEqual(
      positionOf(t.campaign.state().scene!, asCharacterId('marker')),
    );
  });

  it('centres Fireball sixty feet from the caster, and the caster is not in it', () => {
    const t = table();
    const out = expectOk(
      t.call('cast_spell', {
        caster: 'hero',
        spellId: 'fireball',
        targets: [],
        slotLevel: 3,
        at: { fromCreature: 'hero', feet: 60, bearing: 90 },
      }),
    );
    // `near` stands where the point is; `far` is thirty feet past it, outside
    // a 20-foot radius; the caster is sixty feet back.
    expect(caught(out)).toEqual(['near']);
  });

  it('catches the same creatures as the raw point it resolves to', () => {
    const placed = expectOk(
      table().call('cast_spell', {
        caster: 'hero',
        spellId: 'fireball',
        targets: [],
        slotLevel: 3,
        at: { fromCreature: 'hero', feet: 60, bearing: 90 },
      }),
    );
    const raw = expectOk(
      table().call('cast_spell', {
        caster: 'hero',
        spellId: 'fireball',
        targets: [],
        slotLevel: 3,
        at: { x: 160, y: 20 },
      }),
    );
    expect(caught(placed)).toEqual(caught(raw));
  });

  it('takes a landmark as the anchor, and a placement of no feet needs no bearing', () => {
    const out = expectOk(
      table().call('cast_spell', {
        caster: 'hero',
        spellId: 'fireball',
        targets: [],
        slotLevel: 3,
        at: { fromLandmark: 'the brazier', feet: 0 },
      }),
    );
    expect(caught(out)).toEqual(['near']);
  });

  it('refuses a placement that falls outside the scene', () => {
    const out = table().call('cast_spell', {
      caster: 'hero',
      spellId: 'web',
      targets: [],
      slotLevel: 2,
      at: { fromCreature: 'hero', feet: 30, bearing: 180 },
      towardsLandmark: 'the far wall',
    });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.code).toBe('outside_scene');
  });

  /**
   * **Asked, not swept.** A move with no bearing sweeps for the first space a
   * creature fits in, which is a fair reading of "somewhere thirty feet from
   * the door". Sweeping a spell's point would be the engine choosing which way
   * a Fireball goes, so the casting asks for the bearing and spends nothing.
   */
  it('asks for the bearing a point thirty feet away lies on, and spends nothing', () => {
    const t = table();
    const out = t.call('cast_spell', {
      caster: 'hero',
      spellId: 'web',
      targets: [],
      slotLevel: 2,
      at: { fromCreature: 'hero', feet: 30 },
      towardsLandmark: 'the far wall',
    });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.code).toBe('no_bearing');
    expect(out.establish.map((one) => one.tools).flat()).toContain('cast_spell');
    expect(out.establish[0]!.need).toContain('bearing');
    expect(remaining(t.campaign.state().creatures[HERO]!.resources, 'spell-slot:2')).toBe(3);
  });

  it('refuses a point and a placement in one field as malformed', () => {
    const out = table().call('cast_spell', {
      caster: 'hero',
      spellId: 'fireball',
      targets: [],
      slotLevel: 3,
      at: { x: 160, y: 20, fromCreature: 'hero', feet: 60, bearing: 90 },
    });
    expect(out.status).toBe('invalid');
  });
});

// — 3. asking where a refusal told the caller nothing ————————————————————————

describe('a missing aim is asked for, naming the field', () => {
  it('asks for `at` when an area spell is sent without one', () => {
    const t = table();
    const out = t.call('cast_spell', {
      caster: 'hero',
      spellId: 'fireball',
      targets: [],
      slotLevel: 3,
    });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.code).toBe('no_origin');
    expect(out.establish).toHaveLength(1);
    expect(out.establish[0]!.kind).toBe('route');
    expect(out.establish[0]!.tools).toContain('cast_spell');
    expect(out.establish[0]!.satisfyWith).toContain('`at`');
    expect(remaining(t.campaign.state().creatures[HERO]!.resources, 'spell-slot:3')).toBe(2);
  });

  it('asks for a direction when a Cube is placed and not pointed', () => {
    const out = table().call('cast_spell', {
      caster: 'hero',
      spellId: 'web',
      targets: [],
      slotLevel: 2,
      at: { fromCreature: 'hero', feet: 30, bearing: 0 },
    });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.code).toBe('no_direction');
    expect(out.establish[0]!.tools).toContain('cast_spell');
    expect(out.establish[0]!.satisfyWith).toContain('`towards`');
  });
});

describe('a creature that does not exist is refused, not asked about', () => {
  it('refuses a move measured from a name the engine has never been told', () => {
    const out = table().call('move', { who: 'hero', fromCreature: 'rusk', feet: 10, bearing: 0 });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.code).toBe('unknown_creature');
  });

  it('refuses a spell aimed from one', () => {
    const out = table().call('cast_spell', {
      caster: 'hero',
      spellId: 'fireball',
      targets: [],
      slotLevel: 3,
      at: { fromCreature: 'rusk', feet: 10, bearing: 0 },
    });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.code).toBe('unknown_creature');
  });

  it('still asks where a creature it knows is standing', () => {
    const out = table().call('move', { who: 'hero', fromCreature: 'ghost', feet: 10, bearing: 0 });
    expect(out.status).toBe('needs-context');
    if (out.status === 'needs-context') expect(out.code).toBe('unplaced');
  });
});

// — 2. an ability check with a tool ——————————————————————————————————————————

const rogue = (classEquipment: 'A' | 'B' = 'A'): Record<string, unknown> => ({
  name: 'Nim',
  classId: 'rogue',
  level: 1,
  // A Dwarf, whose traits open no window on a check: a Human's Heroic
  // Inspiration would hold every roll open for a reroll the test never takes.
  speciesId: 'dwarf',
  // A Sage, whose own tool is Calligrapher's Supplies: the Thieves' Tools come
  // from the class and from nowhere else.
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  languages: ['Elvish', 'Goblin'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment,
  equipped: [],
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'rogue:weapon-mastery': [],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
  },
});

function rogueTable(classEquipment: 'A' | 'B' = 'A') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed: 'the-crypt-door' });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  expectOk(call('create_character', { id: 'nim', choices: rogue(classEquipment) }));
  return { call, campaign };
}

/** What the sheet put on the die: the total less the face. */
const onTheDie = (resolution: Record<string, unknown>): number =>
  (resolution['total'] as number) - (resolution['natural'] as number);

describe('ability_check.tool', () => {
  it('adds a Rogue’s Proficiency Bonus to a check with the Thieves’ Tools the class grants', () => {
    const t = rogueTable();
    const sheet = t.campaign.state().creatures[asCharacterId('nim')]!.sheet;
    const dex = abilityModifier(sheet.abilities.dex);
    const pb = proficiencyBonus(sheet);

    const picked = expectOk(
      t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15, tool: 'thieves-tools' }),
    );
    expect(onTheDie(picked)).toBe(dex + pb);

    const bare = expectOk(t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15 }));
    expect(onTheDie(bare)).toBe(dex);
  });

  it('names the tool on the roll it records', () => {
    const t = rogueTable();
    const out = t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15, tool: 'thieves-tools' });
    expectOk(out);
    if (out.status !== 'ok') return;
    const roll = out.events.find((event) => event.type === 'roll-recorded');
    expect(roll?.type === 'roll-recorded' && roll.label).toContain("Thieves' Tools");
  });

  it('gives Advantage where the skill used with the check is one the Rogue is proficient in, and adds the bonus once', () => {
    const t = rogueTable();
    const sheet = t.campaign.state().creatures[asCharacterId('nim')]!.sheet;
    const dex = abilityModifier(sheet.abilities.dex);
    const pb = proficiencyBonus(sheet);
    const out = expectOk(
      t.call('ability_check', {
        who: 'nim',
        ability: 'dex',
        skill: 'sleight-of-hand',
        dc: 15,
        tool: 'thieves-tools',
      }),
    );
    expect(out['modeSources']).toContainEqual({ source: 'Tool Proficiency', mode: 'advantage' });
    // Expertise in Sleight of Hand doubles the bonus; the tool's own does not
    // add a third time.
    expect(onTheDie(out)).toBe(dex + 2 * pb);
  });

  it('refuses a check with a tool the creature is not carrying', () => {
    const t = rogueTable('B');
    const out = t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15, tool: 'thieves-tools' });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.code).toBe('no_tool');
  });

  it('refuses a thing that is not a tool, and a thing that is not in the catalogue', () => {
    const t = rogueTable();
    const sword = t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15, tool: 'shortsword' });
    expect(sword.status === 'refused' && sword.code).toBe('not_a_tool');
    const nothing = t.call('ability_check', { who: 'nim', ability: 'dex', dc: 15, tool: 'lockpick-of-doom' });
    expect(nothing.status === 'refused' && nothing.code).toBe('unknown_item');
  });

  const carrier = (tools?: Record<string, 'proficient' | 'expertise'>): readonly GameEvent[] => [
    {
      type: 'creature-added',
      id: asCharacterId('carrier'),
      name: 'Carrier',
      sheet: { ...plainSheet(5), ...(tools === undefined ? {} : { tools }) },
      maxHp: 30,
      diesAtZero: false,
      creatureType: 'Humanoid',
    },
    {
      type: 'items-gained',
      id: asCharacterId('carrier'),
      items: [{ id: 'thieves-tools', quantity: 1 }],
      source: 'found',
    },
  ];

  it('adds nothing for a creature carrying a tool it is not proficient with', () => {
    const t = table(carrier());
    const out = expectOk(
      t.call('ability_check', { who: 'carrier', ability: 'dex', dc: 15, tool: 'thieves-tools' }),
    );
    expect(onTheDie(out)).toBe(abilityModifier(14));
  });

  it('doubles the bonus where the sheet records Expertise with the tool', () => {
    const t = table(carrier({ "Thieves' Tools": 'expertise' }));
    const out = expectOk(
      t.call('ability_check', { who: 'carrier', ability: 'dex', dc: 15, tool: 'thieves-tools' }),
    );
    // A level 5 sheet: Proficiency Bonus +3, doubled.
    expect(onTheDie(out)).toBe(abilityModifier(14) + 6);
  });
});

// — 4. who an area would catch, asked before the cast ————————————————————————

/**
 * The live playtest's Wizard cast Shatter at a guessed point and caught
 * herself. `eligible_targets` already asked `areaCatch` — the function the
 * casting settles its catch with — so it is the read that answers "who would
 * this catch"; what it lacked was the point in the form the casting now takes
 * it, and the direction in the forms the casting takes that.
 */
describe('eligible_targets as the catch, before the cast', () => {
  const asked = (input: Record<string, unknown>) =>
    expectOk(
      table().call('eligible_targets', { caster: 'hero', spellId: 'shatter', slotLevel: 2, ...input }),
    );

  it('shows a Shatter centred on the guardian at her shoulder catching the caster too', () => {
    const out = asked({ at: { fromCreature: 'guardian', feet: 0 } });
    expect(out['eligible']).toContain('hero');
    expect(out['eligible']).toContain('guardian');
  });

  it('shows a Shatter thirty feet away catching neither', () => {
    const out = asked({ at: { fromCreature: 'hero', feet: 30, bearing: 90 } });
    expect(out['eligible']).not.toContain('hero');
    expect(out['eligible']).not.toContain('guardian');
    expect(out['establish']).toEqual([]);
  });

  it('is the catch the casting then takes, and writes nothing and throws nothing', () => {
    const t = table();
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };
    const shortlist = expectOk(
      t.call('eligible_targets', {
        caster: 'hero',
        spellId: 'shatter',
        slotLevel: 2,
        at: { fromCreature: 'guardian', feet: 0 },
      }),
    );
    expect(t.campaign.log().length).toBe(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
    const cast = expectOk(
      t.call('cast_spell', {
        caster: 'hero',
        spellId: 'shatter',
        targets: [],
        slotLevel: 2,
        at: { fromCreature: 'guardian', feet: 0 },
      }),
    );
    expect(caught(cast)).toEqual([...(shortlist['eligible'] as string[])].sort());
  });

  it('asks for the bearing and the direction, as the casting would', () => {
    const bearing = asked({ at: { fromCreature: 'hero', feet: 30 } });
    expect((bearing['establish'] as { need: string }[])[0]?.need).toContain('bearing');

    const t = table();
    const unpointed = expectOk(
      t.call('eligible_targets', {
        caster: 'hero',
        spellId: 'web',
        slotLevel: 2,
        at: { fromCreature: 'hero', feet: 30, bearing: 0 },
      }),
    );
    expect(unpointed['establish']).not.toEqual([]);
    const pointed = expectOk(
      t.call('eligible_targets', {
        caster: 'hero',
        spellId: 'web',
        slotLevel: 2,
        at: { fromCreature: 'hero', feet: 30, bearing: 0 },
        towardsLandmark: 'the far wall',
      }),
    );
    expect(pointed['establish']).toEqual([]);
  });

  it('says an anchor that is no creature is not one, rather than asking where it stands', () => {
    const out = asked({ at: { fromCreature: 'rusk', feet: 10, bearing: 0 } });
    expect((out['establish'] as { need: string }[])[0]?.need).toContain('not a creature');
  });
});
