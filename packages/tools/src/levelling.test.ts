/**
 * A character that keeps growing.
 *
 * `advanceCharacter` has been an engine command for a long time — it keeps the
 * wounds, the conditions and the slots already spent, raises the hit point
 * maximum by the difference, grows the pools that grew and declares the ones
 * that are new — and **nothing in `packages/tools` called it**. A party could
 * be created at level 5 and could never reach 6, which meant a campaign was a
 * fixed cast from the first call to the last.
 *
 * **Levels, not experience points.** Owner ruling, 2026-09-20: XP is not state
 * in this engine and is not to become state. So the door takes the level the
 * character is arriving at and the choices that level asks for, and the engine
 * answers what the class table says the level gives.
 *
 * The declared level is also what makes a retry safe. `advanceCharacter` takes
 * no command id and the engine therefore cannot fingerprint the call — so a
 * transport re-sending one would otherwise advance twice. A call that names
 * the level it is arriving at cannot do that: the second one is arriving at a
 * level the character is already at, and is refused with nothing spent.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

/**
 * The level 1 Bard list, in the catalogue's own order.
 *
 * A prepared list is sized by the class table — seven at level 4, nine at
 * five, twelve at eight — so a level-up restates it, and a test that hard-coded
 * one list would be testing the level it happened to be written at. Level 1
 * spells only, because a level 4 Bard has no level 3 slot to prepare into.
 */
const BARD_SPELLS: readonly string[] = SRD_CONTENT.spells
  .filter((spell) => spell.level === 1)
  .filter((spell) => (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes('bard'))
  .map((spell) => spell.id);

/** What that class table says a Bard of this level has prepared. */
const preparedAt = (level: number): readonly string[] =>
  BARD_SPELLS.slice(0, SRD_CONTENT.classById('bard')!.table[level - 1]!.preparedSpells!);

/** A Bard of the College of Lore at whatever level the test needs one. */
const bard = (level: number) => ({
  name: 'Lyra',
  classId: 'bard',
  level,
  subclassId: 'college-of-lore',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 },
  },
  abilityIncreases: { cha: 2, wis: 1 },
  classSkills: ['performance', 'persuasion', 'deception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['vicious-mockery', 'dancing-lights', 'mage-hand'],
  spellbook: [],
  preparedSpells: preparedAt(level),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'bard:expertise': ['performance', 'persuasion'],
    'college-of-lore:bonus-proficiencies': ['arcana', 'history', 'insight'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'bard:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['cha', 'cha'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'levelling') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}, commandId?: string): ToolOutcome =>
    surface.call({ tool, input, commandId: commandId ?? `toolu_${(calls += 1)}` });
  return { campaign, call };
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

interface Slots {
  readonly level: number;
  readonly max: number;
  readonly left: number;
}

interface FeatureLine {
  readonly feature: string;
  readonly kind: string;
  readonly spentBy: string | null;
}

const sheetOf = (t: ReturnType<typeof table>, who: string) =>
  expectOk(t.call('sheet', { who })).resolution;

const featureIds = (t: ReturnType<typeof table>, who: string): readonly string[] =>
  (sheetOf(t, who)['features'] as readonly FeatureLine[]).map((one) => one.feature);

/** A Bard in a room, because a spell with a range needs one to mean anything. */
const party = (level = 4, seed = 'levelling') => {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'lyra', choices: bard(level) }));
  expectOk(t.call('set_scene', { width: 120, depth: 60, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the hearth', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'lyra', fromLandmark: 'the hearth', feet: 0 }));
  return t;
};

/** A level-up, with the prepared list the level it arrives at asks for. */
const growTo = (t: ReturnType<typeof table>, toLevel: number, over: Record<string, unknown> = {}, commandId?: string) =>
  t.call(
    'advance_character',
    { who: 'lyra', toLevel, preparedSpells: preparedAt(toLevel), ...over },
    commandId,
  );

describe('a character advances through the door', () => {
  /**
   * The whole of the gap: a level 4 Bard has none of what level 5 gives, and a
   * level 5 Bard has all of it. Font of Inspiration is the level 5 feature,
   * and it is exactly the trade the surface learned to spend this week.
   */
  it('takes a level 4 Bard to level 5, with the new level’s grants on the sheet', () => {
    const t = party(4);
    expect(sheetOf(t, 'lyra')['level']).toBe(4);
    expect(featureIds(t, 'lyra')).not.toContain('bard:font-of-inspiration');
    const before = sheetOf(t, 'lyra');

    const grown = expectOk(growTo(t, 5));
    expect(grown.resolution['who']).toBe('lyra');
    expect(grown.resolution['level']).toBe(5);

    const after = sheetOf(t, 'lyra');
    expect(after['level']).toBe(5);
    // The class table's own numbers, none of them sent: a d8 Bard's fixed
    // average is five a level and this one's Constitution adds a sixth, and
    // level 5 opens the third rank of slots.
    expect(after['hpMax']).toBe((before['hpMax'] as number) + 6);
    expect((after['spellSlots'] as readonly Slots[]).map((one) => one.max)).toEqual([4, 3, 2]);

    // And the feature the level grants, reported as the thing it is.
    expect(featureIds(t, 'lyra')).toContain('bard:font-of-inspiration');
    expect(
      (after['features'] as readonly FeatureLine[]).find(
        (one) => one.feature === 'bard:font-of-inspiration',
      ),
    ).toMatchObject({ kind: 'trade', spentBy: 'trade_resource' });
  });

  /**
   * Emphatically not a rebuild: a Bard who levels up mid-dungeon keeps the
   * slots they have already spent and the wounds they are carrying.
   */
  it('keeps what has been spent, rather than quietly refilling it', () => {
    const t = party(4);
    // A level 1 spell cast from a level 2 slot: the slot is spent, and it is
    // still spent on the other side of the level-up.
    expectOk(
      t.call('cast_spell', {
        caster: 'lyra',
        spellId: 'cure-wounds',
        targets: ['lyra'],
        slotLevel: 2,
      }),
    );
    expect((sheetOf(t, 'lyra')['spellSlots'] as readonly Slots[])[1]).toMatchObject({
      level: 2,
      max: 3,
      left: 2,
    });

    expectOk(growTo(t, 5));

    const after = sheetOf(t, 'lyra')['spellSlots'] as readonly Slots[];
    expect(after[1]).toMatchObject({ level: 2, max: 3, left: 2 });
    // The rank the level opened is new and therefore full.
    expect(after[2]).toMatchObject({ level: 3, max: 2, left: 2 });
  });

  /**
   * The level is declared, so a transport re-sending its call cannot advance
   * a character twice — which is what a door over a command with no command id
   * of its own has to answer for itself.
   */
  it('refuses a level that is not the next one, and says which one is', () => {
    const t = party(4);
    expectOk(growTo(t, 5, {}, 'toolu_grow'));

    const again = expectRefused(growTo(t, 5, {}, 'toolu_grow'));
    expect(again.code).toBe('not_the_next_level');
    expect(again.reason).toContain('6');
    expect(sheetOf(t, 'lyra')['level']).toBe(5);

    // And a level further off than the next one, which is the same mistake in
    // the other direction: this door takes one level at a time.
    const leap = expectRefused(growTo(t, 9));
    expect(leap.code).toBe('not_the_next_level');
    expect(sheetOf(t, 'lyra')['level']).toBe(5);
  });

  /**
   * The choices a level asks for go through the door with it, and a level that
   * asks for one and is not given it is refused by name rather than guessed
   * at. SRD: the Bard's level 8 is an Ability Score Improvement.
   */
  it('carries the choices the new level asks for, and refuses a level missing one', () => {
    const t = party(7);
    const before = sheetOf(t, 'lyra');
    const short = expectRefused(growTo(t, 8));
    expect(short.code).toBe('missing_feat_choice');
    expect(short.reason).toContain('bard:ability-score-improvement-2');
    expect(sheetOf(t, 'lyra')['level']).toBe(7);

    expectOk(
      growTo(t, 8, {
        feats: {
          'bard:ability-score-improvement-2': {
            featId: 'ability-score-improvement',
            abilities: ['dex', 'dex'],
          },
        },
      }),
    );
    expect(sheetOf(t, 'lyra')['level']).toBe(8);
    // The feat's own sentence, applied by the engine: two points of Dexterity
    // is one point of Armour Class on an unarmoured Bard in Leather.
    expect(sheetOf(t, 'lyra')['armorClass']).toBe((before['armorClass'] as number) + 1);
  });

  /** A creature the engine has never been told about is homework, not a verdict. */
  it('asks rather than refuses for a creature nobody has created', () => {
    const t = party(4);
    const outcome = t.call('advance_character', { who: 'nobody', toLevel: 2 });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.code).toBe('unknown_creature');
    expect(outcome.reason).toContain('nobody');
  });

  /** A number the caller made up is not a level: the schema turns it away. */
  it('is invalid rather than refused for a level that is not one', () => {
    const t = party(4);
    const outcome = t.call('advance_character', { who: 'lyra', toLevel: 0 });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.map((issue) => issue.path)).toContain('toLevel');
  });
});
