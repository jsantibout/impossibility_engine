/**
 * Keeping at a rite that takes a minute, in a fight, through `surface.call`.
 *
 * SRD "Longer Casting Times": "While you cast a spell with a casting time of 1
 * minute or more, you must take the Magic action on **each of your turns**, and
 * you must maintain Concentration while you do so. If your Concentration is
 * broken, the spell fails, but you don't expend a spell slot."
 *
 * **The obligation is a door and the failure is derived.** A turn that ends
 * without the Magic action fails the rite at the boundary, with no event and
 * nobody deciding it; taking the action is somebody's decision and is therefore
 * a command — `continueCasting`, which has been in the engine since long
 * castings landed and reached no tool. The consequence was exact: a casting of
 * a minute declared in combat could not survive its own caster's next turn,
 * whatever the caller did, because the only call that would have kept it alive
 * did not exist above the engine.
 *
 * It carries no number. The whole of the call is whose casting and which one;
 * the Magic action, the Concentration, the clock the settlement waits on and
 * the failure at a boundary nobody attended are all the engine's.
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
  'identify',
  'mage-armor',
  'sleep',
  'thunderwave',
  'hold-person',
  'misty-step',
  'web',
];

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
  preparedSpells: ['magic-missile', 'shield', 'identify', 'hold-person', 'burning-hands', 'sleep'],
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

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const pending = (t: ReturnType<typeof table>): readonly string[] =>
  t.surface.observe().owed.pendingCastings;

const turnOf = (t: ReturnType<typeof table>): string | null => t.surface.observe().turnOf;

/**
 * Two wizards in a fight, with the rite declared on the first one's turn.
 *
 * The declaration *is* that turn's Magic action, which the engine stamps for
 * itself — so the first turn boundary is where the obligation starts and where
 * the rite used to be lost.
 */
function riteBegun(seed = 'a-long-rite') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  expectOk(t.call('create_character', { id: 'vex', choices: wizard('Vex') }));
  expectOk(t.call('declare_side', { who: 'kessa', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'vex', side: 'rivals' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'vex', fromCreature: 'kessa', feet: 15, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: 'kessa', to: 'vex', seen: true }));
  expectOk(t.call('declare_sight', { from: 'vex', to: 'kessa', seen: true }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));

  const order = t.surface.observe().initiativeOrder!;
  const caster = order[0]!;
  const other = order[1]!;

  // SRD Identify: "Casting Time: 1 minute or Ritual", and it is on this
  // wizard's list. Nobody is touched, which the spell's own targets allow.
  const declared = expectOk(
    t.call('cast_spell', { caster, spellId: 'identify', targets: [], slotLevel: 1 }),
  );
  const castingId = declared.resolution['castingId'] as string;
  expect(pending(t)).toContain(castingId);
  return { t, caster, other, castingId };
}

/** Round the order until it is this creature's turn again. */
const untilTurnOf = (t: ReturnType<typeof table>, id: string): void => {
  for (let step = 0; step < 4 && turnOf(t) !== id; step += 1) expectOk(t.call('end_turn'));
  expect(turnOf(t)).toBe(id);
};

describe('a rite of a minute survives the turns it is cast over', () => {
  it('keeps the casting open when the caster takes the Magic action', () => {
    const { t, caster, castingId } = riteBegun();

    expectOk(t.call('end_turn'));
    untilTurnOf(t, caster);

    const kept = expectOk(t.call('continue_casting', { caster, castingId }));
    expect(kept.resolution['castingId']).toBe(castingId);
    expect(kept.events.some((event) => event.type === 'casting-continued')).toBe(true);
    // SRD spends the **Magic action** on it, and this is a fight, so it costs.
    expect(kept.events.some((event) => event.type === 'action-spent')).toBe(true);

    // And the boundary no longer takes the rite away.
    expectOk(t.call('end_turn'));
    expect(pending(t)).toContain(castingId);
  });

  /**
   * The half nobody decides, driven here so the door above means something: a
   * turn that ends without the Magic action fails the rite, derived, with no
   * event. That is what made `continue_casting`'s absence fatal rather than
   * inconvenient.
   */
  it('and loses it at the boundary when nobody does', () => {
    const { t, caster, castingId } = riteBegun();

    expectOk(t.call('end_turn'));
    untilTurnOf(t, caster);
    expectOk(t.call('end_turn'));

    expect(pending(t)).not.toContain(castingId);
  });

  /** The action is spent once: a second call on the same turn has none left. */
  it('costs the action it says it costs', () => {
    const { t, caster, castingId } = riteBegun();
    expectOk(t.call('end_turn'));
    untilTurnOf(t, caster);

    expectOk(t.call('continue_casting', { caster, castingId }));
    const again = expectRefused(t.call('continue_casting', { caster, castingId }));
    expect(again.code).toBe('no_action');
  });
});

describe('a rite is the caster’s own, and only a rite', () => {
  it('refuses somebody else keeping at it', () => {
    const { t, other, castingId } = riteBegun();
    expectOk(t.call('end_turn'));
    untilTurnOf(t, other);

    const out = expectRefused(t.call('continue_casting', { caster: other, castingId }));
    expect(out.code).toBe('not_your_spell');
  });

  it('refuses a casting id nothing is waiting under', () => {
    const { t, caster } = riteBegun();
    const out = expectRefused(t.call('continue_casting', { caster, castingId: 'cast:nothing' }));
    expect(out.code).toBe('no_casting_pending');
  });

  /**
   * A casting held open for a Counterspell is a different kind of pending
   * thing: it is owed nothing on anybody's turn, and `resolve_declared_cast`
   * is what finishes it. The refusal says which door to use.
   */
  it('refuses a held instant casting, which is not a rite at all', () => {
    const { t, caster, other } = riteBegun();
    expectOk(t.call('end_turn'));
    untilTurnOf(t, caster);
    expectOk(t.call('continue_casting', { caster, castingId: (
      t.surface.observe().owed.pendingCastings[0] as string
    ) }));
    expectOk(t.call('end_turn'));
    untilTurnOf(t, other);

    const held = expectOk(
      t.call('cast_spell', {
        caster: other,
        spellId: 'hold-person',
        targets: [caster],
        slotLevel: 2,
        hold: true,
      }),
    );
    const instant = held.resolution['castingId'] as string;

    const out = expectRefused(t.call('continue_casting', { caster: other, castingId: instant }));
    expect(out.code).toBe('not_a_long_casting');
  });
});
