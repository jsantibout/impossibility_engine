/**
 * Staffs and wands (treasure T-C2): the casting items the wand door opened
 * onto, each driven through `cast_spell.item` and nothing else.
 *
 * `item-reachability.test.ts` proves every casting in the catalogue lands on
 * the item's route. What it cannot say is whether the *numbers* are the
 * book's — the level a charge count buys, the price, the ceiling — so this
 * file holds one sentence of each new record against what the log says
 * happened: a Staff of Healing's "1 charge per spell level (maximum 4 for a
 * level 4 spell)", a Staff of the Magi's "0" beside Detect Magic and its
 * "_Fireball_ (level 7 version)", a Staff of Power's "+2 bonus to Armor
 * Class, saving throws" "while holding it", and a Wand of Magic Missiles'
 * extra dart per extra charge.
 *
 * It imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

// — who holds the thing ——————————————————————————————————————————————————————

const wizard = (name: string): Record<string, unknown> => ({
  name,
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const cleric = (name: string): Record<string, unknown> => ({
  name,
  classId: 'cleric',
  level: 5,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 10, con: 14, int: 8, wis: 15, cha: 13 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['medicine', 'persuasion'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral Good',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
  spellbook: [],
  preparedSpells: [
    'zone-of-truth',
    'spirit-guardians',
    'inflict-wounds',
    'healing-word',
    'bane',
    'blindness-deafness',
    'guiding-bolt',
    'aid',
    'silence',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['spare-the-dying', 'resistance'],
      levelOneSpell: 'cure-wounds',
    },
    'human:versatile': { featId: 'alert' },
    'cleric:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const druid = (name: string): Record<string, unknown> => ({
  name,
  classId: 'druid',
  level: 5,
  speciesId: 'human',
  // Not the Sage: its Magic Initiate would give the druid a second
  // spellcasting ability, and a staff "using your spell save DC" would ask
  // which one.
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral Good',
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance', 'produce-flame'],
  spellbook: [],
  preparedSpells: [
    'goodberry',
    'flame-blade',
    'cure-wounds',
    'healing-word',
    'thunderwave',
    'hold-person',
    'faerie-fire',
    'entangle',
    'moonbeam',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'criminal:alert': { featId: 'alert' },
    'human:versatile': { featId: 'savage-attacker' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

// — the table ————————————————————————————————————————————————————————————————

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

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 900)}`);
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(`expected refused, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 900)}`);
  }
  return outcome;
};

const WHO = 'mira';
const GOBLIN = 'grik';

/** A room, the holder at one end of it and a goblin a hundred feet east. */
function room(seed: string, choices: Record<string, unknown>): Table {
  const t = table(seed);
  expectOk(t.call('create_character', { id: WHO, choices }));
  expectOk(t.call('add_creature', { id: GOBLIN, monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the hall', at: { x: 20, y: 100 } }));
  expectOk(t.call('place_creature', { who: WHO, fromLandmark: 'the hall', feet: 0 }));
  expectOk(t.call('place_creature', { who: GOBLIN, fromCreature: WHO, feet: 100, bearing: 90 }));
  expectOk(t.call('declare_sight', { from: WHO, to: GOBLIN, seen: true }));
  return t;
}

/** Handed over, taken in hand, and attuned to where the bracket asks. */
function holding(t: Table, item: string, attune = true): void {
  expectOk(t.rule('award_items', { who: WHO, items: [{ id: item }], because: 'the vault' }));
  expectOk(t.call('equip_item', { who: WHO, item }));
  if (attune && SRD_CONTENT.item(item)?.attunement !== undefined) {
    expectOk(t.call('begin_rest', { who: WHO, kind: 'short' }));
    expectOk(t.call('attune_item', { who: WHO, item }));
  }
}

interface Pool {
  readonly key: string;
  readonly left: number;
}

const sheetOf = (t: Table) => expectOk(t.call('sheet', { who: WHO })).resolution;

/** Charges left in the item, off the sheet the surface publishes. */
const chargesLeft = (t: Table, item: string): number => {
  const pool = (sheetOf(t)['pools'] as readonly Pool[]).find((one) => one.key.startsWith(`${item}:`));
  if (pool === undefined) throw new Error(`${item} has no pool on the sheet`);
  return pool.left;
};

const castOf = (out: Extract<ToolOutcome, { status: 'ok' }>) =>
  out.events.find((event) => event.type === 'spell-cast') as
    | { readonly route?: string; readonly level?: number }
    | undefined;

const eventsOfType = (out: Extract<ToolOutcome, { status: 'ok' }>, type: string) =>
  out.events.filter((event) => event.type === type);

// — the records ——————————————————————————————————————————————————————————————

describe('a cleric heals from the Staff of Healing', () => {
  const STAFF = 'staff-of-healing';

  it('at level 3 for 3 charges — "1 charge per spell level"', () => {
    const t = room('staff-of-healing', cleric('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectOk(
      t.call('cast_spell', { caster: WHO, spellId: 'cure-wounds', targets: [WHO], item: STAFF, charges: 3 }),
    );

    expect(castOf(out)?.route).toBe(`item:${STAFF}`);
    expect(castOf(out)?.level).toBe(3);
    expect(chargesLeft(t, STAFF)).toBe(before - 3);
  });

  it('at level 4 for 4, the ceiling the cell prints', () => {
    const t = room('staff-of-healing-4', cleric('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectOk(
      t.call('cast_spell', { caster: WHO, spellId: 'cure-wounds', targets: [WHO], item: STAFF, charges: 4 }),
    );

    expect(castOf(out)?.level).toBe(4);
    expect(chargesLeft(t, STAFF)).toBe(before - 4);
  });

  it('and is refused a fifth — "maximum 4 for a level 4 spell" — before a charge goes', () => {
    const t = room('staff-of-healing-5', cleric('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectRefused(
      t.call('cast_spell', { caster: WHO, spellId: 'cure-wounds', targets: [WHO], item: STAFF, charges: 5 }),
    );

    expect(out.code).toBe('bad_charges');
    expect(chargesLeft(t, STAFF)).toBe(before);
  });
});

describe('a druid casts Wall of Ice from the Staff of Frost', () => {
  it('for the four charges the table prints', () => {
    const STAFF = 'staff-of-frost';
    const t = room('staff-of-frost', druid('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectOk(
      t.call('cast_spell', {
        caster: WHO,
        spellId: 'wall-of-ice',
        targets: [],
        item: STAFF,
      }),
    );

    expect(castOf(out)?.route).toBe(`item:${STAFF}`);
    expect(chargesLeft(t, STAFF)).toBe(before - 4);
  });
});

describe('a wizard casts from the Staff of the Magi', () => {
  const STAFF = 'staff-of-the-magi';

  it('Detect Magic for nothing — the "0" in its row', () => {
    const t = room('staff-of-the-magi-0', wizard('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectOk(
      t.call('cast_spell', { caster: WHO, spellId: 'detect-magic', targets: [], item: STAFF }),
    );

    expect(castOf(out)?.route).toBe(`item:${STAFF}`);
    expect(chargesLeft(t, STAFF)).toBe(before);
    expect(eventsOfType(out, 'resource-spent')).toEqual([]);
  });

  it('Fireball at level 7 for 7 — "_Fireball_ (level 7 version)"', () => {
    const t = room('staff-of-the-magi-7', wizard('Mira'));
    holding(t, STAFF);
    const before = chargesLeft(t, STAFF);

    const out = expectOk(
      t.call('cast_spell', {
        caster: WHO,
        spellId: 'fireball',
        targets: [],
        at: { x: 120, y: 100 },
        item: STAFF,
      }),
    );

    expect(castOf(out)?.route).toBe(`item:${STAFF}`);
    expect(castOf(out)?.level).toBe(7);
    expect(chargesLeft(t, STAFF)).toBe(before - 7);
    // The dice of the level 7 version: 8d6, and one more d6 for each of the
    // four levels above 3.
    const dice = out.events.find((event) => event.type === 'damage-dice-recorded') as
      | { readonly components: readonly { readonly dice: readonly unknown[] }[] }
      | undefined;
    expect(dice?.components[0]?.dice).toHaveLength(12);
  });
});

describe('the Staff of Power guards whoever holds it, attuned', () => {
  const STAFF = 'staff-of-power';

  /** The save modifier a table-called save was thrown with. */
  const saveModifier = (t: Table): number => {
    const out = expectOk(t.rule('saving_throw', { who: WHO, ability: 'dex', dc: 10, because: 'a rockfall' }));
    // A save somebody may still answer is held open; nobody here does.
    if (out.resolution['mayAnswer'] !== undefined) expectOk(t.rule('settle_test'));
    const { natural, total } = out.resolution as { natural: number; total: number };
    return total - natural;
  };

  it('+2 to Armor Class and saving throws while held and attuned, and not in the pack', () => {
    const t = room('staff-of-power', wizard('Mira'));
    const bareAc = sheetOf(t)['armorClass'] as number;
    const bareSave = saveModifier(t);

    // In hand and not yet attuned: the bracket gives nothing until it has it.
    holding(t, STAFF, false);
    expect(sheetOf(t)['armorClass']).toBe(bareAc);
    expect(saveModifier(t)).toBe(bareSave);

    expectOk(t.call('begin_rest', { who: WHO, kind: 'short' }));
    expectOk(t.call('attune_item', { who: WHO, item: STAFF }));
    expect(sheetOf(t)['armorClass']).toBe(bareAc + 2);
    expect(saveModifier(t)).toBe(bareSave + 2);

    // Still attuned, back in the pack: "while holding it" is not met.
    expectOk(t.call('unequip_item', { who: WHO, item: STAFF }));
    expect(sheetOf(t)['attuned']).toContain(STAFF);
    expect(sheetOf(t)['armorClass']).toBe(bareAc);
    expect(saveModifier(t)).toBe(bareSave);
  });
});

describe('the Wand of Magic Missiles', () => {
  const WAND = 'wand-of-magic-missiles';

  const fire = (charges: number) => {
    const t = room(`magic-missiles-${charges}`, wizard('Mira'));
    holding(t, WAND);
    const before = chargesLeft(t, WAND);
    const out = expectOk(
      t.call('cast_spell', { caster: WHO, spellId: 'magic-missile', targets: [GOBLIN], item: WAND, charges }),
    );
    expect(castOf(out)?.route).toBe(`item:${WAND}`);
    expect(chargesLeft(t, WAND)).toBe(before - charges);
    // One `damage-dice-recorded` per dart that lands.
    return eventsOfType(out, 'damage-dice-recorded').length;
  };

  it('fires three darts for 1 charge — "For 1 charge, you cast the level 1 version"', () => {
    expect(fire(1)).toBe(3);
  });

  it('and five for 3 — "no more than 3 charges"', () => {
    expect(fire(3)).toBe(5);
  });
});

describe('the reachability sweep takes the new records in by existing', () => {
  /**
   * `item-reachability.test.ts` derives its population from the catalogue; this
   * says the records of this tranche are in it, which is the population the
   * sweep then drives every casting of through the door.
   */
  it('counts every staff, wand, rod, ring and cloak of the tranche among the casting items', () => {
    const casting = SRD_MAGIC_ITEMS.filter((item) =>
      (item.grants ?? []).some((grant) => grant.kind === 'casts'),
    ).map((item) => item.id);
    for (const id of [
      'wand-of-magic-missiles',
      'staff-of-healing',
      'staff-of-frost',
      'staff-of-charming',
      'staff-of-swarming-insects',
      'staff-of-the-woodlands',
      'staff-of-power',
      'staff-of-the-magi',
      'rod-of-alertness',
      'ring-of-shooting-stars',
      'cloak-of-arachnida',
    ]) {
      expect(casting, id).toContain(id);
    }
  });
});
