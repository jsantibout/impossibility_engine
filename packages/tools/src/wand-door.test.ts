/**
 * The wand door: a spell cast from a magic item, through `cast_spell` and
 * nothing else.
 *
 * The engine could cast from an item since the casting route landed —
 * `CastSpellRequest.item` and `.charges`, read by `itemCastOf` — and the tool
 * above it declared neither field. Zod strips a key it has never heard of, so
 * a caller who sent `item` got a Wizard's own Fireball, out of a slot, or a
 * refusal for want of one: every wand, both cubes and the crystal balls were
 * transcribed, attunable and unusable. `item-reachability.test.ts` sweeps the
 * whole catalogue; this file is the Wand of Fireballs end to end, and the
 * refusals that must cost nothing.
 *
 * It imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const WAND = 'wand-of-fireballs';

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

interface Pool {
  readonly key: string;
  readonly left: number;
}

/** Charges left in the wand, off the sheet the surface publishes. */
const chargesLeft = (t: ReturnType<typeof table>): number => {
  const sheet = expectOk(t.call('sheet', { who: 'mira' })).resolution;
  const pool = (sheet['pools'] as readonly Pool[]).find((one) => one.key.startsWith(`${WAND}:`));
  if (pool === undefined) throw new Error('the wand has no pool on the sheet');
  return pool.left;
};

/** A room, a wizard at one end holding the wand, a goblin down the hall. */
function armed(seed = 'wand-door', attune = true) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'mira', choices: wizard('Mira') }));
  expectOk(t.call('add_creature', { id: 'grik', monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the hall', at: { x: 20, y: 100 } }));
  expectOk(t.call('place_creature', { who: 'mira', fromLandmark: 'the hall', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grik', fromCreature: 'mira', feet: 100, bearing: 90 }));
  expectOk(t.rule('award_items', { who: 'mira', items: [{ id: WAND }], because: 'the vault' }));
  expectOk(t.call('equip_item', { who: 'mira', item: WAND }));
  if (attune) {
    expectOk(t.call('begin_rest', { who: 'mira', kind: 'short' }));
    expectOk(t.call('attune_item', { who: 'mira', item: WAND }));
  }
  return t;
}

/** Fireball centred on the goblin, from the wand. */
const FIREBALL = {
  caster: 'mira',
  spellId: 'fireball',
  targets: [],
  at: { x: 120, y: 100 },
  item: WAND,
};

describe('a wizard casts Fireball from the Wand of Fireballs, through the door', () => {
  it('at three charges, and the casting is the level 5 one', () => {
    const t = armed();
    const before = chargesLeft(t);
    const out = expectOk(t.call('cast_spell', { ...FIREBALL, charges: 3 }));

    // The route the log names is the wand's, not the Wizard's.
    const cast = out.events.find((event) => event.type === 'spell-cast') as
      | { readonly route?: string; readonly level?: number }
      | undefined;
    expect(cast?.route).toBe(`item:${WAND}`);
    // SRD: "For 1 charge, you cast the level 3 version of the spell. You can
    // increase the spell's level by 1 for each additional charge you expend."
    expect(cast?.level).toBe(5);

    // Three charges came out of the wand and no slot out of the Wizard.
    expect(chargesLeft(t)).toBe(before - 3);
    // And the dice the level 5 version rolls are the ones that landed — ten
    // six-sided dice where a level 3 Fireball rolls eight — against the
    // wand's own DC of 15 rather than the Wizard's.
    const dice = out.events.find((event) => event.type === 'damage-dice-recorded') as
      | { readonly components: readonly { readonly dice: readonly { readonly sides: number }[] }[] }
      | undefined;
    expect(dice?.components[0]?.dice).toHaveLength(10);
    expect(dice?.components[0]?.dice.every((die) => die.sides === 6)).toBe(true);
    const outcomes = out.resolution['outcomes'] as readonly { readonly save?: { readonly dc: number } }[];
    expect(outcomes[0]?.save?.dc).toBe(15);
  });

  it('at the one charge the wand prices it at when no count is named', () => {
    const t = armed();
    const before = chargesLeft(t);
    const out = expectOk(t.call('cast_spell', FIREBALL));
    const cast = out.events.find((event) => event.type === 'spell-cast') as
      | { readonly level?: number }
      | undefined;
    expect(cast?.level).toBe(3);
    expect(chargesLeft(t)).toBe(before - 1);
  });

  it('by the copy’s own id, as the sheet lists it', () => {
    const t = armed();
    const sheet = expectOk(t.call('sheet', { who: 'mira' })).resolution;
    const copy = (sheet['equipped'] as readonly { id: string; instance?: string }[]).find(
      (worn) => worn.id === WAND,
    )?.instance;
    expect(copy).toBeDefined();
    const before = chargesLeft(t);
    expectOk(t.call('cast_spell', { ...FIREBALL, item: copy }));
    expect(chargesLeft(t)).toBe(before - 1);
  });
});

describe('what the wand refuses, it refuses before a charge is spent', () => {
  it('a fourth charge', () => {
    const t = armed();
    const before = chargesLeft(t);
    const out = expectRefused(t.call('cast_spell', { ...FIREBALL, charges: 4 }));
    expect(out.code).toBe('bad_charges');
    expect(chargesLeft(t)).toBe(before);
  });

  it('an unattuned wand', () => {
    const t = armed('wand-door', false);
    const before = chargesLeft(t);
    const out = expectRefused(t.call('cast_spell', FIREBALL));
    expect(out.code).toBe('not_attuned');
    expect(chargesLeft(t)).toBe(before);
  });

  it('a slot level named beside the item', () => {
    const t = armed();
    const before = chargesLeft(t);
    const out = expectRefused(t.call('cast_spell', { ...FIREBALL, slotLevel: 3 }));
    expect(out.code).toBe('item_pays_no_slot');
    expect(chargesLeft(t)).toBe(before);
  });

  it('charges with no item under them', () => {
    const t = armed();
    const out = expectRefused(
      t.call('cast_spell', {
        caster: FIREBALL.caster,
        spellId: FIREBALL.spellId,
        targets: [],
        at: FIREBALL.at,
        charges: 2,
      }),
    );
    expect(out.code).toBe('charges_without_an_item');
  });
});

/**
 * What an item's own line leaves to the table reaches the table: SRD Chime of
 * Opening's tone "audible out to 300 feet" is nobody's rule to read, so it is
 * handed over under the mark — on the casting it rode, and on the sheet
 * beside the chime itself.
 */
describe('an item hands its printed table facts over, flagged', () => {
  const CHIME = 'chime-of-opening';
  const TONE =
    "Chime of Opening: [the DM decides] The spell's customary knocking sound is replaced by the clear, ringing tone of the chime, which is audible out to 300 feet.";

  const chimed = () => {
    const t = table('the-chime');
    expectOk(t.call('create_character', { id: 'mira', choices: wizard('Mira') }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the door', at: { x: 20, y: 100 } }));
    expectOk(t.call('place_creature', { who: 'mira', fromLandmark: 'the door', feet: 0 }));
    expectOk(t.rule('award_items', { who: 'mira', items: [{ id: CHIME }], because: 'the vault' }));
    expectOk(t.call('equip_item', { who: 'mira', item: CHIME }));
    return t;
  };

  it('on the casting the item made', () => {
    const t = chimed();
    const out = expectOk(
      t.call('cast_spell', { caster: 'mira', spellId: 'knock', targets: [], item: CHIME }),
    );
    expect(out.unverified).toContain(TONE);
  });

  it('on the sheet, beside the line that owns it', () => {
    const t = chimed();
    const sheet = expectOk(t.call('sheet', { who: 'mira' })).resolution;
    const line = (sheet['carrying'] as readonly { id: string; handedOver?: readonly string[] }[]).find(
      (one) => one.id === CHIME,
    );
    expect(line?.handedOver).toContain(TONE);
    // And nothing on a line whose item hands nothing over.
    const plain = (sheet['carrying'] as readonly { id: string; handedOver?: readonly string[] }[]).filter(
      (one) => one.id !== CHIME,
    );
    expect(plain.every((one) => one.handedOver === undefined)).toBe(true);
  });
});
