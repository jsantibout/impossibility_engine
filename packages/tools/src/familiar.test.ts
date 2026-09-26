/**
 * SRD Find Familiar, cast through the DM's door end to end.
 *
 * The engine test for the mechanism (`packages/engine/src/summons-kept.test.ts`)
 * drives homebrew spells over the SRD's own Beasts; this file drives the book's
 * spell through the surface a model or a DM actually holds, and asserts the
 * whole sentence rather than the parts: the form is named, the type is stated,
 * the rite takes its hour, the familiar arrives as the wizard's, cannot attack,
 * is owed a departure when it drops to 0 Hit Points, and is replaced by a
 * second casting.
 *
 * **Nothing here carries a number a caller produced.** The form and the type
 * are choices the book leaves to the caster and the engine refuses to make;
 * the damage that drops the familiar is the DM's own `improvised_damage`,
 * which is a ruling and not a die.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

/** `summoning.test.ts`'s wizard, whose Magic Initiate grants Find Familiar. */
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

function table(seed = 'an-owl-out-of-the-incense') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call, look: () => surface.observe() };
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

const expectRefused = (outcome: ToolOutcome, code: string) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused/${code}, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  expect(outcome.code).toBe(code);
  return outcome;
};

/** A wizard alone in a room; no fight, so the hour can pass on the clock. */
function openTheStudy(t: Table) {
  expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  expectOk(t.call('declare_side', { who: 'kessa', side: 'party' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the brazier', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the brazier', feet: 0 }));
}

/** The rite: declared, an hour on the clock, then settled. */
function callTheFamiliar(t: Table, form: string, creatureType: string): ReturnType<typeof expectOk> {
  const declared = expectOk(
    t.call('cast_spell', {
      caster: 'kessa',
      spellId: 'find-familiar',
      targets: ['kessa'],
      slotLevel: 1,
      form,
      choice: creatureType,
    }),
  );
  const castingId = declared.resolution['castingId'] as string;
  expect(typeof castingId).toBe('string');
  expectOk(t.call('advance_time', { hours: 1, because: 'the incense burns down' }));
  return expectOk(t.call('resolve_declared_cast', { castingId }));
}

const familiarOf = (t: Table, name: string) =>
  t.look().creatures.find((one) => one.name === name);

describe('Find Familiar through the door', () => {
  it('raises the named form as the stated type, after the hour', () => {
    const t = table();
    openTheStudy(t);
    const settled = callTheFamiliar(t, 'owl', 'Fey');

    expect(settled.events.some((event) => event.type === 'creature-added')).toBe(true);
    expect(settled.events.some((event) => event.type === 'creature-summoned')).toBe(true);
    const owl = familiarOf(t, 'Owl');
    expect(owl).toBeDefined();
    expect(owl?.creatureType).toBe('Fey');
    expect(owl?.side).toBe('party');
    // Nothing is owed: the familiar is kept, not held by a casting that ended.
    expect(t.look().owed.strandedSummons).toEqual([]);
    // And what the engine could not check reaches the caller marked as such.
    // The pocket dimension is not among them any more — `dismiss_familiar`
    // and `recall_familiar` are its two doors — and nor is seeing through the
    // familiar's eyes, which is `borrow_senses`; what is left of that sentence
    // is the senses the familiar's own stat block prints, which no sheet holds.
    expect(settled.unverified.some((line) => line.includes('familiar’s eyes'))).toBe(false);
    expect(settled.unverified.some((line) => line.includes('familiar’s own stat block'))).toBe(true);
    expect(settled.unverified.some((line) => line.includes('pocket dimension'))).toBe(false);
  });

  it('refuses to choose the form or the type on the caster’s behalf', () => {
    const t = table();
    openTheStudy(t);
    expectRefused(
      t.call('cast_spell', {
        caster: 'kessa',
        spellId: 'find-familiar',
        targets: ['kessa'],
        slotLevel: 1,
        choice: 'Fey',
      }),
      'form_required',
    );
    expectRefused(
      t.call('cast_spell', {
        caster: 'kessa',
        spellId: 'find-familiar',
        targets: ['kessa'],
        slotLevel: 1,
        form: 'owl',
      }),
      'choice_required',
    );
    // A Wolf is a Beast of Challenge Rating 1/4, which the spell does not admit.
    expectRefused(
      t.call('cast_spell', {
        caster: 'kessa',
        spellId: 'find-familiar',
        targets: ['kessa'],
        slotLevel: 1,
        form: 'wolf',
        choice: 'Fey',
      }),
      'form_not_offered',
    );
    // Nothing was spent by any of the three refusals.
    expect(t.look().creatures).toHaveLength(1);
  });

  it('is owed a departure at 0 Hit Points, which the sweep performs', () => {
    const t = table();
    openTheStudy(t);
    callTheFamiliar(t, 'cat', 'Celestial');
    const cat = familiarOf(t, 'Cat');
    expect(cat).toBeDefined();

    // A DM's ruling, not a die: the cat is trodden on.
    expectOk(
      t.call('improvised_damage', { target: cat!.id, amount: 5, ruling: 'a boot in the dark' }),
    );
    expect(t.look().owed.strandedSummons).toEqual([cat!.id]);

    const swept = expectOk(t.call('dismiss_stranded_summons'));
    expect(swept.resolution['dismissed']).toEqual([cat!.id]);
    expect(familiarOf(t, 'Cat')).toBeUndefined();
  });

  it('replaces the familiar when the spell is cast again', () => {
    const t = table();
    openTheStudy(t);
    callTheFamiliar(t, 'cat', 'Celestial');
    const cat = familiarOf(t, 'Cat');

    const again = callTheFamiliar(t, 'raven', 'Fiend');
    expect(again.events.some((event) => event.type === 'creature-removed' && event.id === cat!.id)).toBe(
      true,
    );
    expect(familiarOf(t, 'Cat')).toBeUndefined();
    expect(familiarOf(t, 'Raven')?.creatureType).toBe('Fiend');
    // One familiar, one wizard, nobody stranded.
    expect(t.look().creatures.map((one) => one.name).sort()).toEqual(['Kessa', 'Raven']);
    expect(t.look().owed.strandedSummons).toEqual([]);
  });

  /**
   * The third door on the bond — SRD Find Familiar: "As a Bonus Action, you
   * can see through the familiar's eyes … until the start of your next turn".
   * A moment in the turn order, so it is asked for outside a fight and taken
   * on the wizard's own turn inside one. (W7-S21)
   */
  it('borrows the owl’s eyes for a Bonus Action on the wizard’s turn, and asks for a fight outside one', () => {
    const t = table();
    openTheStudy(t);
    callTheFamiliar(t, 'owl', 'Fey');
    const owl = familiarOf(t, 'Owl')!;
    expectOk(t.call('place_creature', { who: owl.id, fromLandmark: 'the brazier', feet: 5 }));

    const outside = t.call('borrow_senses', { caster: 'kessa', who: owl.id });
    expect(outside.status).toBe('needs-context');

    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: owl.id }] }));
    for (let i = 0; i < 2 && t.look().turnOf !== 'kessa'; i += 1) expectOk(t.call('end_turn'));
    expect(t.look().turnOf).toBe('kessa');

    const borrowed = expectOk(t.call('borrow_senses', { caster: 'kessa', who: owl.id }));
    expect(borrowed.resolution['borrowedFrom']).toBe(owl.id);
    expect(borrowed.events.some((event) => event.type === 'senses-borrowed')).toBe(true);
    // A second Bonus Action on the same turn is not there to spend.
    expect(t.call('borrow_senses', { caster: 'kessa', who: owl.id }).status).not.toBe('ok');
  });

  it('replays byte-identically from the same seed', () => {
    const play = () => {
      const t = table('the-same-owl');
      openTheStudy(t);
      callTheFamiliar(t, 'owl', 'Fey');
      callTheFamiliar(t, 'bat', 'Fey');
      return JSON.stringify(t.campaign.log());
    };
    expect(play()).toBe(play());
  });
});
