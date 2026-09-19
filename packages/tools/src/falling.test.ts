/**
 * A fall declared at the table, and the spell that answers one — through the
 * door, with no engine import.
 *
 * `declareFalling` landed in the engine with a Reaction window, a trigger
 * rule, a target rule and a test file of its own, and reached no tool. So
 * SRD *Feather Fall* — a spell the engine casts for real, spending a level 1
 * slot, a Reaction and a minute on the clock — could not be cast by the only
 * surface that exists to cast spells: nothing a model could say made anybody
 * falling, and `no_trigger` was the end of every attempt.
 *
 * **The fall has to arrive through a tool for this to prove anything.** A
 * test that reached into the engine to declare one would be showing that the
 * loop closes for a caller who can reach past the door, which is the defect
 * rather than the fix — the same reasoning `routes.test.ts` gives for laying
 * its mire down with `declare_difficult_terrain`. So this file imports
 * `@ie/tools` and `@ie/content` and nothing else, and `boundary.test.ts`
 * holds it to that.
 *
 * What is *not* here is as deliberate as what is. Nothing asserts how far
 * anybody fell, how long it took or what the landing cost: the SRD gives the
 * rate against a height only the DM holds, the engine records the moment and
 * nothing else, and a test that checked a distance would be checking a number
 * somebody invented.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type OkOutcome, type ToolOutcome } from '@ie/tools';

/** A wizard with Feather Fall in the book and prepared, which is all it takes. */
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
    'feather-fall',
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

interface Table {
  call(tool: string, input?: unknown): ToolOutcome;
  slotsLeft(who: string): number;
  surface: ReturnType<typeof createSurface>;
}

function table(seed = 'the-ledge'): Table {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  return {
    surface,
    call: (tool, input: unknown = {}) =>
      surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` }),
    slotsLeft: (who) => {
      const creature = surface.observe().creatures.find((each) => each.id === who);
      return Object.entries(creature?.spellSlots ?? {}).reduce(
        (left, [key, count]) => (key.includes('1') ? left + count : left),
        0,
      );
    },
  };
}

const expectOk = (outcome: ToolOutcome): OkOutcome => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const codeOf = (outcome: ToolOutcome): string =>
  outcome.status === 'refused' || outcome.status === 'needs-context' ? outcome.code : outcome.status;

/** A mage on the walkway, a climber thirty feet off, and a thug on the floor. */
function theLedge(seed?: string): Table {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'mage', choices: wizard('Ilvara') }));
  expectOk(t.call('create_character', { id: 'climber', choices: wizard('Doric') }));
  expectOk(t.call('create_character', { id: 'thug', choices: wizard('Garret') }));
  expectOk(t.call('set_scene', { width: 300, depth: 300, height: 200 }));
  expectOk(t.call('add_landmark', { name: 'the walkway', at: { x: 100, y: 100 } }));
  expectOk(t.call('place_creature', { who: 'mage', fromLandmark: 'the walkway', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'climber', fromCreature: 'mage', feet: 30, bearing: 0 }));
  expectOk(t.call('place_creature', { who: 'thug', fromCreature: 'mage', feet: 20, bearing: 180 }));
  expectOk(t.call('declare_sight', { from: 'mage', to: 'climber', seen: true }));
  expectOk(t.call('declare_sight', { from: 'mage', to: 'thug', seen: true }));
  return t;
}

const FEATHER_FALL = { caster: 'mage', spellId: 'feather-fall', slotLevel: 1 };

describe('a fall is a fact a session can state', () => {
  it('is a tool, and it writes the engine’s own event', () => {
    const t = theLedge();
    const declared = expectOk(t.call('declare_falling', { who: 'climber' }));
    expect(declared.events.map((event) => event.type)).toEqual(['fall-declared']);
  });

  /**
   * **A verdict, not homework**, and the tool passes it through as one. A
   * creature the engine has never been told about is a `needs-context` with a
   * door; a creature it knows, falling or not, is answered.
   */
  it('asks for a creature it has never been told about', () => {
    const t = theLedge();
    const outcome = t.call('declare_falling', { who: 'nobody' });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]?.kind).toBe('creature');
    expect(outcome.establish[0]?.tools).toContain('create_character');
  });

  /**
   * The transport's id is the idempotency key, so the retry of a call that
   * already landed is a second reading of one fall rather than a second fall.
   * Re-declaring under a *fresh* id is somebody coming off a second ledge,
   * which `commands/facts.ts` argues at length and the engine decides.
   */
  it('is a no-op when the transport re-sends the same call', () => {
    const t = theLedge();
    const surface = t.surface;
    const first = surface.call({
      tool: 'declare_falling',
      input: { who: 'climber' },
      commandId: 'toolu_retry',
    });
    const again = surface.call({
      tool: 'declare_falling',
      input: { who: 'climber' },
      commandId: 'toolu_retry',
    });
    expect(expectOk(first).events).toHaveLength(1);
    expect(expectOk(again).events).toHaveLength(0);
  });
});

describe('Feather Fall is castable from the surface that exists to cast it', () => {
  it('is refused while nobody is falling, and spends nothing', () => {
    const t = theLedge();
    const before = t.slotsLeft('mage');
    const refused = t.call('cast_spell', { ...FEATHER_FALL, targets: ['climber'] });
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('no_trigger');
    expect(t.slotsLeft('mage')).toBe(before);
  });

  /**
   * The loop, closed through the door: the table says the climber has come
   * off the walkway, and the spell the engine has always been able to cast
   * becomes castable. The slot is the engine's to spend and the proof that
   * this was a casting rather than a narration.
   */
  it('is cast once the table says somebody is falling', () => {
    const t = theLedge();
    const before = t.slotsLeft('mage');
    expectOk(t.call('declare_falling', { who: 'climber' }));

    const cast = expectOk(t.call('cast_spell', { ...FEATHER_FALL, targets: ['climber'] }));
    expect(cast.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(String(cast.resolution['castingId']).length).toBeGreaterThan(0);
    expect(t.slotsLeft('mage')).toBe(before - 1);
  });

  /**
   * "Choose up to five **falling** creatures within range." The trigger is
   * the moment and the target rule is a different question, so the thug
   * standing on the floor while the climber drops past him is refused — which
   * is the engine's rule, arriving intact through a tool that added none of
   * its own.
   */
  it('refuses a target nobody said was falling', () => {
    const t = theLedge();
    expectOk(t.call('declare_falling', { who: 'climber' }));
    const refused = t.call('cast_spell', { ...FEATHER_FALL, targets: ['thug'] });
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('target_not_falling');
  });

  /** And the falling creature beside the one who is not, in one casting. */
  it('takes the falling creature and refuses the pair', () => {
    const t = theLedge();
    expectOk(t.call('declare_falling', { who: 'climber' }));
    expect(codeOf(t.call('cast_spell', { ...FEATHER_FALL, targets: ['climber', 'thug'] }))).toBe(
      'target_not_falling',
    );
    expectOk(t.call('cast_spell', { ...FEATHER_FALL, targets: ['climber'] }));
  });
});
