/**
 * The facts a casting states rather than derives, each asked for by name and
 * answered through the door.
 *
 * `resolveSpell` refuses a casting that has not told it something the spell
 * requires, and the refusal names the field: `fought_fact_required`,
 * `destination_required`, `payment_required`, `class_required`,
 * `slot_kind_required`. **Every one of those was unanswerable from this
 * surface** — the refusal arrived, the field it named did not exist on
 * `cast_spell`, and the caller's only move was to cast something else. Charm
 * Person, Charm Monster and Animal Friendship print the fighting clause;
 * Misty Step and Dimension Door teleport; a Magic Initiate's granted spell
 * can be paid for two ways and a Warlock multiclass has two pools to pay
 * from. None of it could be cast, and the engine executes all of it.
 *
 * That is the same defect four times over, and `doors.test.ts` is the guard
 * that finds the fifth: it derives this list of codes from the engine's own
 * `err` literals and fails until each one names a field that exists. This
 * file is the other half — that the field is not merely present but is the
 * **answer**: every test drives the refusal, then the same call with the one
 * field it named, and asserts a resolution that could not have happened
 * otherwise.
 *
 * No engine import, for `routes.test.ts`'s reason: a round trip that closes
 * only for a caller who can reach past the door has not closed.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type OkOutcome, type ToolOutcome } from '@ie/tools';

/**
 * A level 3 Wizard carrying one of each question.
 *
 * Charm Person for the fighting clause, Misty Step for the teleport, and the
 * background's Magic Initiate granting **Grease** — a spell rather than the
 * Find Familiar the other fixtures take, because the grant's question only
 * arises for a spell the engine actually executes and Find Familiar is
 * tracked rather than executed.
 */
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
    'charm-person',
    'mage-armor',
    'feather-fall',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'charm-person', 'misty-step', 'web'],
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
      levelOneSpell: 'grease',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/**
 * A Warlock 2 / Wizard 2, who is the only creature in D&D with two of every
 * answer: Charm Person is on both class lists and prepared through both, and
 * a level 1 slot could come out of Pact Magic or out of Spellcasting.
 */
const pactMage = (name: string): Record<string, unknown> => ({
  name,
  classId: 'warlock',
  level: 2,
  multiclass: [{ classId: 'wizard', level: 2 }],
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    // Charisma 13 for the Warlock and Intelligence 13 for the Wizard: the
    // SRD's multiclassing minimum, in both directions.
    assignment: { str: 8, dex: 14, con: 12, int: 13, wis: 10, cha: 15 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  spellsByClass: {
    warlock: {
      cantrips: ['eldritch-blast', 'prestidigitation'],
      preparedSpells: ['charm-person', 'detect-magic', 'hex'],
    },
    wizard: {
      cantrips: ['fire-bolt', 'light', 'mage-hand'],
      spellbook: [
        'charm-person',
        'shield',
        'detect-magic',
        'mage-armor',
        'thunderwave',
        'sleep',
        'grease',
        'feather-fall',
      ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
      preparedSpells: ['charm-person', 'shield', 'mage-armor', 'grease', 'feather-fall'],
    },
  },
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'wizard:scholar': ['arcana'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['ray-of-frost', 'minor-illusion'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

interface Table {
  call(tool: string, input?: unknown): ToolOutcome;
  surface: ReturnType<typeof createSurface>;
}

function table(seed = 'stated-facts'): Table {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  return {
    surface,
    call: (tool, input: unknown = {}) =>
      surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` }),
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

/** The key of the pool a casting spent, off the engine's own event. */
function slotSpent(outcome: OkOutcome): string | null {
  for (const event of outcome.events) {
    if (event.type === 'spell-cast') return event.slot?.key ?? null;
  }
  return null;
}

/** A mage, a mercenary they are trading blows with, and a bystander. */
function theTavern(): Table {
  const t = table();
  expectOk(t.call('create_character', { id: 'mage', choices: wizard('Ilvara') }));
  expectOk(t.call('create_character', { id: 'brawler', choices: wizard('Garret') }));
  expectOk(t.call('create_character', { id: 'bystander', choices: wizard('Doric') }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 50, y: 50 } }));
  expectOk(t.call('add_landmark', { name: 'the stairs', at: { x: 70, y: 50 } }));
  expectOk(t.call('place_creature', { who: 'mage', fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'brawler', fromCreature: 'mage', feet: 15, bearing: 0 }));
  expectOk(
    t.call('place_creature', { who: 'bystander', fromCreature: 'mage', feet: 20, bearing: 180 }),
  );
  for (const to of ['brawler', 'bystander']) {
    expectOk(t.call('declare_sight', { from: 'mage', to, seen: true }));
  }
  // Charm Person takes "one Humanoid", which is a fact somebody has to state —
  // another door, and the one `declare_creature_type` was built for.
  for (const who of ['brawler', 'bystander']) {
    expectOk(t.call('declare_creature_type', { who, creatureType: 'Humanoid' }));
  }
  return t;
}

// — who you are fighting, which the target's save reads ————————————————————

describe('`fought` answers the clause the Charms print', () => {
  const CHARM = { caster: 'mage', spellId: 'charm-person', slotLevel: 1 };

  it('is refused until the casting says, and the refusal names the fact', () => {
    const t = theTavern();
    const refused = t.call('cast_spell', { ...CHARM, targets: ['bystander'] });
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('fought_fact_required');
  });

  /**
   * **An empty list is an answer.** "We are fighting none of them" is a fact
   * the caster stated and the engine acts on; absence is a caller who has not
   * read the spell. The two have to stay distinguishable through the door, so
   * the empty array is passed on rather than elided as an unset field —
   * which is the one place this field differs from every other optional one
   * on the tool.
   */
  it('takes "none of them" as a list with nothing in it', () => {
    const t = theTavern();
    expectOk(t.call('cast_spell', { ...CHARM, targets: ['bystander'], fought: [] }));
  });

  it('takes the creature the caster is trading blows with', () => {
    const t = theTavern();
    expectOk(t.call('cast_spell', { ...CHARM, targets: ['brawler'], fought: ['brawler'] }));
  });

  /** And it is validated rather than believed: a stranger is not a fact. */
  it('refuses a creature the engine has never heard of', () => {
    const t = theTavern();
    const outcome = t.call('cast_spell', { ...CHARM, targets: ['brawler'], fought: ['nobody'] });
    expect(outcome.status).toBe('needs-context');
    expect(codeOf(outcome)).toBe('unknown_creature');
  });
});

// — where a teleport lands ————————————————————————————————————————————————

describe('`teleportTo` answers the space Misty Step will not choose', () => {
  const STEP = { caster: 'mage', spellId: 'misty-step', slotLevel: 2, targets: ['mage'] };

  it('is refused until the casting names one', () => {
    const t = theTavern();
    const refused = t.call('cast_spell', STEP);
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('destination_required');
  });

  /**
   * The same call with the field the refusal named, and the caster is
   * somewhere else — at a space measured from a landmark, which is how every
   * destination on this surface is said. No coordinate is typed and no
   * distance is asserted: thirty feet is Misty Step's own, and the engine is
   * what checks it.
   */
  it('resolves when the same call carries it, and the caster has moved', () => {
    const t = theTavern();
    const before = t.surface.observe().creatures.find((each) => each.id === 'mage')!.feetTo;
    const stepped = expectOk(
      t.call('cast_spell', { ...STEP, teleportTo: { fromLandmark: 'the stairs', feet: 0 } }),
    );
    expect(stepped.events.some((event) => event.type === 'spell-cast')).toBe(true);
    const after = t.surface.observe().creatures.find((each) => each.id === 'mage')!.feetTo;
    expect(after['brawler']).not.toBe(before['brawler']);
  });

  /** And it is checked, not taken on trust: thirty feet is the spell's limit. */
  it('refuses a space further than the spell reaches', () => {
    const t = theTavern();
    expectOk(t.call('add_landmark', { name: 'the far door', at: { x: 180, y: 180 } }));
    const outcome = t.call('cast_spell', {
      ...STEP,
      teleportTo: { fromLandmark: 'the far door', feet: 0 },
    });
    expect(outcome.status).toBe('refused');
  });
});

// — what pays for it ——————————————————————————————————————————————————————

describe('`payment` answers a grant that could be paid for two ways', () => {
  /** The Grease the background's Magic Initiate granted, aimed across the room. */
  const GREASE = {
    caster: 'mage',
    spellId: 'grease',
    targets: [],
    at: { x: 60, y: 50 },
    towards: { x: 80, y: 50 },
  };

  it('is refused rather than defaulted, because spending the day’s free cast is a decision', () => {
    const t = theTavern();
    const refused = t.call('cast_spell', GREASE);
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('payment_required');
  });

  /**
   * The free casting spends the feat's own pool and no slot, which is the
   * whole of what the field decides — and the engine says which, in the event
   * it wrote.
   */
  it('spends the feat’s daily casting when the caller says so', () => {
    const t = theTavern();
    const cast = expectOk(t.call('cast_spell', { ...GREASE, payment: 'free-casting' }));
    expect(slotSpent(cast)).toBeNull();
    expect(
      cast.events.some(
        (event) => event.type === 'resource-spent' && event.key.includes('free-cast'),
      ),
    ).toBe(true);
  });

  /** And a slot when it says that instead: the same call, a different cost. */
  it('spends a slot when the caller says that instead', () => {
    const t = theTavern();
    const cast = expectOk(t.call('cast_spell', { ...GREASE, payment: 'slot', slotLevel: 1 }));
    expect(slotSpent(cast)).toBe('spell-slot:1');
  });
});

// — which route, and which pool ————————————————————————————————————————————

describe('`source` and `slotKind` answer a caster with two of everything', () => {
  const CHARM = {
    caster: 'pactmage',
    spellId: 'charm-person',
    targets: ['bystander'],
    slotLevel: 1,
    fought: [],
  };

  function theBackRoom(): Table {
    const t = theTavern();
    expectOk(t.call('create_character', { id: 'pactmage', choices: pactMage('Sera') }));
    expectOk(
      t.call('place_creature', { who: 'pactmage', fromLandmark: 'the bar', feet: 10, bearing: 90 }),
    );
    expectOk(t.call('declare_sight', { from: 'pactmage', to: 'bystander', seen: true }));
    return t;
  }

  /**
   * Two routes, two spellcasting abilities and therefore two save DCs, so the
   * engine refuses to pick — and names both so the caller can.
   */
  it('refuses a spell prepared through two classes until one is named', () => {
    const t = theBackRoom();
    const refused = t.call('cast_spell', CHARM);
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('class_required');
    if (refused.status !== 'refused') return;
    expect(refused.reason).toContain('class:wizard');
    expect(refused.reason).toContain('class:warlock');
  });

  it('then refuses the slot itself, because Pact Magic and Spellcasting both have one', () => {
    const t = theBackRoom();
    const refused = t.call('cast_spell', { ...CHARM, source: 'class:wizard' });
    expect(refused.status).toBe('refused');
    expect(codeOf(refused)).toBe('slot_kind_required');
  });

  /**
   * **And the two fields are load-bearing rather than ceremonial**: the same
   * casting, answered two ways, spends two different resources. A surface
   * that had defaulted either one would have been quietly emptying the wrong
   * pool — which is why the engine refuses instead.
   */
  it('casts it, out of the pool the caller named', () => {
    const spell = expectOk(
      theBackRoom().call('cast_spell', {
        ...CHARM,
        source: 'class:wizard',
        slotKind: 'spell',
      }),
    );
    expect(slotSpent(spell)).toBe('spell-slot:1');

    const pact = expectOk(
      theBackRoom().call('cast_spell', { ...CHARM, source: 'class:warlock', slotKind: 'pact' }),
    );
    expect(slotSpent(pact)).toBe('pact-slot:1');
  });
});
