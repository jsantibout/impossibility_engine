/**
 * A spell that puts a creature on the board, and the sweep that takes it away
 * again.
 *
 * `summonCreature` has been in the engine since a casting could raise a hound:
 * the whole sheet pinned into the arrival, the creature on the summoner's
 * side, a rung in the order when its Initiative comes. Nothing above the
 * engine called it, so a model-driven session could not summon at all — and
 * the half that matters more was unreachable with it. **A summons goes when
 * its spell does**, and the engine will not take it away by itself: a casting
 * ends four ways nobody commands, the fold finds the ending and emits nothing,
 * and `resolveTurn` then refuses `summons_stranded` until somebody sweeps. A
 * door that summoned and no door that swept would be a fight that wedges on
 * the first turn boundary after the spell ran out, with the refusal naming a
 * command no caller could reach. So the two land together, and the last two
 * tests here are the reason.
 *
 * **The rule `add_creature` argues is the rule here.** The call is what to
 * call the creature, which stat block it is, who summoned it and which of that
 * caster's running spells holds it here — four ids and not one number. An
 * entry point that accepted a stat block is the door a model-authored Armour
 * Class walks through, and a summoning tool taking `{ armorClass: 15 }` would
 * reopen it exactly where `add_creature` closed it.
 *
 * **What it deliberately does not take.** A stated Initiative total, which the
 * engine offers for a human DM who gives one: that is a number the caller
 * produced, so on this surface the creature arrives without a rung and
 * `roll_initiative` seats it, which is the same two calls a monster already
 * takes. A placement and a side, because `place_creature` and `declare_side`
 * are their own doors and the engine's default — the summoner's own side — is
 * what a summons *is*.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const BOOK = [
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
];

/** `fight.test.ts`'s wizard, transcribed, so two files summon with one caster. */
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
  spellbook: BOOK.map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'burning-hands',
    'scorching-ray',
  ],
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
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'a-hound-out-of-nowhere') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const transcript: { tool: string; input: unknown }[] = [];
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    transcript.push({ tool, input });
    return surface.call({ tool, input, commandId: `toolu_${transcript.length}` });
  };
  /** Exactly what a transport re-sending a call would send: same id, same arguments. */
  const resend = (index: number): ToolOutcome =>
    surface.call({ ...transcript[index]!, commandId: `toolu_${index + 1}` });
  return { campaign, surface, call, resend, at: () => transcript.length };
}

type Table = ReturnType<typeof table>;

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

const creature = (t: Table, id: string) =>
  t.surface.observe().creatures.find((one) => one.id === id);

const carrying = (t: Table, id: string): readonly string[] => creature(t, id)!.carrying;

/** A wizard, a goblin who wants a word, and a room they can see each other across. */
function openTheRoom(t: Table) {
  expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('declare_side', { who: 'kessa', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'grish', side: 'monsters' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the fire', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the fire', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'kessa', feet: 15, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: 'kessa', to: 'grish', seen: true }));
  expectOk(t.call('declare_sight', { from: 'grish', to: 'kessa', seen: true }));
}

/**
 * The room, a spell of Kessa's still running, and a fight under way.
 *
 * Mage Armor is the casting a summons is bound to here because it is the
 * plainest ongoing spell this wizard prepares — it runs for eight hours,
 * holds no Concentration, and `end_ongoing_spell` ends it on command, which
 * is what the last two tests need: the *ending* is the event that strands a
 * summons, and how the casting came to end is no part of the claim.
 */
function fightWithASpellRunning(seed?: string) {
  const t = table(seed);
  openTheRoom(t);
  const cast = expectOk(
    t.call('cast_spell', { caster: 'kessa', spellId: 'mage-armor', targets: ['kessa'], slotLevel: 1 }),
  );
  const castingId = cast.resolution['castingId'] as string;
  expect(typeof castingId).toBe('string');
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'grish' }] }));
  return { t, castingId };
}

/** The summons itself, as every test below makes it. */
const summon = (t: Table, castingId: string, extra: Record<string, unknown> = {}) =>
  t.call('summon_creature', {
    id: 'hound',
    monsterId: 'goblin-warrior',
    by: 'kessa',
    castingId,
    ...extra,
  });

describe('a casting puts a creature on the board', () => {
  it('reports what arrived, whose it is and which spell holds it here', () => {
    const { t, castingId } = fightWithASpellRunning();
    const summoned = expectOk(summon(t, castingId));

    expect(summoned.resolution['summoned']).toBe('hound');
    expect(summoned.resolution['monsterId']).toBe('goblin-warrior');
    expect(summoned.resolution['by']).toBe('kessa');
    expect(summoned.resolution['castingId']).toBe(castingId);
    // The one event a summons adds to an arrival: a casting is the reason it
    // is there, which is what the sweep below reads.
    expect(summoned.events.some((event) => event.type === 'creature-added')).toBe(true);
    expect(summoned.events.some((event) => event.type === 'creature-summoned')).toBe(true);

    // Nobody said whose side it was on. A summons is the summoner's.
    expect(creature(t, 'hound')!.side).toBe('party');
  });

  it('reads every number off the book, exactly as `add_creature` does', () => {
    const { t, castingId } = fightWithASpellRunning();
    expectOk(summon(t, castingId));

    const hound = creature(t, 'hound')!;
    expect(hound.name).toBe('Goblin Warrior');
    expect(hound.armorClass).toBe(15);
    expect(hound.hpMax).toBe(10);
    expect(hound.creatureType).toBe('Fey');
  });

  it('takes no number out of the block from the caller', () => {
    const { t, castingId } = fightWithASpellRunning();
    // Zod strips a key no schema has heard of in silence, so the proof is not
    // that the call succeeded but that nothing the caller stated arrived.
    expectOk(summon(t, castingId, { armorClass: 25, hp: 400, size: 'gargantuan', initiative: 20 }));

    const hound = creature(t, 'hound')!;
    expect(hound.armorClass).toBe(15);
    expect(hound.hpMax).toBe(10);

    const schema = t.surface.tools.find((tool) => tool.name === 'summon_creature')!.schema;
    const parsed = schema.safeParse({
      id: 'hound',
      monsterId: 'goblin-warrior',
      by: 'kessa',
      castingId,
      armorClass: 25,
      initiative: 20,
    });
    expect(parsed.success).toBe(true);
    const data = parsed.data as Record<string, unknown>;
    expect(data['armorClass']).toBeUndefined();
    // The stated Initiative total the engine offers a human DM: not here, and
    // not because it was stripped by accident.
    expect(data['initiative']).toBeUndefined();
  });

  it('arms it with what its own block prints, because a summons that cannot swing is not on the board', () => {
    const { t, castingId } = fightWithASpellRunning();
    const summoned = expectOk(summon(t, castingId));

    // SRD Goblin Warrior: "Leather Armor, Scimitar, Shield, Shortbow".
    expect([...carrying(t, 'hound')].sort()).toEqual([
      'leather-armor',
      'scimitar',
      'shield',
      'shortbow',
    ]);
    expect(summoned.resolution['armed']).toEqual([
      'leather-armor',
      'scimitar',
      'shield',
      'shortbow',
    ]);
  });

  it('stands a creature up with no spell at all, for the summons nothing sustains', () => {
    const { t } = fightWithASpellRunning();
    // SRD Animate Dead is Instantaneous and its Skeleton is still standing
    // next week. A summons with no casting is bound to nothing and is swept
    // by nothing, which is why `castingId` is optional rather than required.
    const raised = expectOk(
      t.call('summon_creature', { id: 'bones', monsterId: 'skeleton', by: 'kessa' }),
    );
    expect(raised.resolution['castingId']).toBeUndefined();
    expect(raised.events.some((event) => event.type === 'creature-summoned')).toBe(false);
    expect(creature(t, 'bones')!.side).toBe('party');
    expect(t.surface.observe().owed.strandedSummons).toEqual([]);
  });

  it('refuses a stat block this world does not hold, and the field answers it', () => {
    const { t, castingId } = fightWithASpellRunning();
    const refused = expectRefused(
      t.call('summon_creature', {
        id: 'hound',
        monsterId: 'wyrm-of-the-north',
        by: 'kessa',
        castingId,
      }),
    );
    expect(refused.code).toBe('unknown_monster');
    expect(refused.reason).toContain('wyrm-of-the-north');

    const missing = t.call('summon_creature', { id: 'hound', by: 'kessa', castingId });
    expect(missing.status).toBe('invalid');
    if (missing.status !== 'invalid') return;
    expect(missing.issues.map((issue) => issue.path)).toContain('monsterId');
  });

  it('refuses a casting that is not running, naming the id it was sent', () => {
    const { t } = fightWithASpellRunning();
    const refused = expectRefused(summon(t, 'cast:nothing'));
    expect(refused.code).toBe('not_ongoing');
    expect(refused.reason).toContain('cast:nothing');
    expect(creature(t, 'hound')).toBeUndefined();
  });

  it('asks who the summoner is rather than refusing, and names the door', () => {
    const { t, castingId } = fightWithASpellRunning();
    const asked = summon(t, castingId, { by: 'nobody' });
    expect(asked.status).toBe('needs-context');
    if (asked.status !== 'needs-context') return;
    expect(asked.establish.map((one) => one.kind)).toContain('creature');
    expect(asked.establish[0]!.tools).toContain('summon_creature');
  });

  it('is safe to retry: the transport re-sending the call raises one hound', () => {
    const { t, castingId } = fightWithASpellRunning();
    expectOk(summon(t, castingId));
    const index = t.at() - 1;
    const before = t.campaign.log().length;

    const again = expectOk(t.resend(index));
    expect(again.resolution['duplicate']).toBe(true);
    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
  });
});

describe('a summons acts when its Initiative comes', () => {
  it('takes a rung in a fight already running and swings on its own turn', () => {
    const { t, castingId } = fightWithASpellRunning('the-hound-fights');
    expectOk(summon(t, castingId));
    expectOk(t.call('place_creature', { who: 'hound', fromCreature: 'grish', feet: 5, bearing: 0 }));
    expectOk(t.call('declare_sight', { from: 'hound', to: 'grish', seen: true }));
    expectOk(t.call('declare_sight', { from: 'grish', to: 'hound', seen: true }));

    // The number is the engine's: the creature arrives without a rung, and the
    // door that seats a monster seats this one.
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'hound' }] }));
    expect(t.surface.observe().initiativeOrder).toContain('hound');

    for (let guard = 0; guard < 8 && t.surface.observe().turnOf !== 'hound'; guard += 1) {
      expectOk(t.call('end_turn'));
    }
    expect(t.surface.observe().turnOf).toBe('hound');

    const swung = expectOk(
      t.call('attack', { attacker: 'hound', target: 'grish', weapon: 'scimitar' }),
    );
    expect(typeof swung.resolution['natural']).toBe('number');
  });
});

describe('and the fight does not wedge when the spell that held it ends', () => {
  /** A hound summoned, seated in the order, and its spell over. */
  function stranded(seed = 'the-spell-runs-out') {
    const { t, castingId } = fightWithASpellRunning(seed);
    expectOk(summon(t, castingId));
    expectOk(t.call('place_creature', { who: 'hound', fromCreature: 'grish', feet: 5, bearing: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'hound' }] }));
    expectOk(t.call('end_ongoing_spell', { caster: 'kessa', castingId }));
    return t;
  }

  it('says who is standing on a casting that is over', () => {
    const t = stranded();
    // The debt a caller would otherwise meet one refusal at a time, and the
    // reason `look` reports the others: it is derived rather than filed, so
    // nothing but this read answers it.
    expect(t.surface.observe().owed.strandedSummons).toEqual(['hound']);
    const looked = expectOk(t.call('look'));
    expect((looked.resolution['owed'] as Record<string, unknown>)['strandedSummons']).toEqual([
      'hound',
    ]);
  });

  it('refuses to advance the order while the debt stands', () => {
    const t = stranded('the-turn-refuses');
    const refused = expectRefused(t.call('end_turn'));
    expect(refused.code).toBe('summons_stranded');
    expect(refused.reason).toContain('hound');
  });

  it('sweeps the debt, and the turn then moves on', () => {
    const t = stranded('the-sweep');
    const swept = expectOk(t.call('dismiss_stranded_summons'));

    expect(swept.resolution['dismissed']).toEqual(['hound']);
    expect(swept.events.some((event) => event.type === 'creature-removed')).toBe(true);
    expect(creature(t, 'hound')).toBeUndefined();
    expect(t.surface.observe().initiativeOrder).not.toContain('hound');
    expect(t.surface.observe().owed.strandedSummons).toEqual([]);

    // The whole of the claim: a model-driven fight that summoned goes on
    // being a fight after the spell runs out.
    expectOk(t.call('end_turn'));
    expect(t.surface.observe().turnOf).not.toBeNull();
  });

  it('answers an empty sweep rather than refusing one', () => {
    const { t, castingId } = fightWithASpellRunning('nothing-to-sweep');
    expectOk(summon(t, castingId));
    // Nothing is stranded: the casting is still running. A caller sweeping
    // after every ending must not have to tell "nothing to do" from a refusal.
    const swept = expectOk(t.call('dismiss_stranded_summons'));
    expect(swept.events).toEqual([]);
    expect(swept.resolution['dismissed']).toEqual([]);
    expect(creature(t, 'hound')).toBeDefined();
  });
});
