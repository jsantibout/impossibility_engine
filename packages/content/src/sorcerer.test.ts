import { describe, expect, it } from 'vitest';
import { DRACONIC_SORCERY, METAMAGIC_OPTIONS, SORCERER, SRD_CONTENT } from '@ie/content';
import { classCasting, type SpellcastingState } from '@ie/engine';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, armorClassCalculation, proficiencyBonusForLevel } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { cumulativeFeatures } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';
import {
  activateFeature,
  advanceTime,
  createRng,
  createRollIssuer,
  resolveSpell,
} from '@ie/engine';

/**
 * The third and last spellcasting style: a Sorcerer **knows** their spells.
 *
 * SRD's 2024 tables head the column "Prepared Spells" for every caster, which
 * is exactly the sort of thing that makes three different rules look like one.
 * A Wizard's list is drawn from a book they had to fill; a Cleric's is chosen
 * fresh every morning from the whole class list; a Sorcerer's changes only on
 * levelling or by swapping one on a Long Rest. The engine records which, and
 * the difference shows up in what it refuses.
 *
 * Two other firsts here:
 *
 * - **Metamagic**, the `option` choice kind picking two of ten named things —
 *   the same shape as Divine Order and not a feat, which is why that kind had
 *   to exist.
 * - **A subclass grant that is not on the class list at all.** Draconic
 *   Sorcery gives Command, which is a Cleric spell. A grant that had to pass
 *   the class-list check would refuse the SRD.
 */

const id = (s: string) => asCharacterId(s);
const VESKA = id('veska');
const BANDIT = id('bandit');

const sorcerer = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Veska',
  classId: 'sorcerer',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  languages: ['Draconic', 'Giant'],
  alignment: 'Chaotic Neutral',
  subclassId: 'draconic-sorcery',
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  // No book: a Sorcerer never had one.
  spellbook: [],
  // A level 3 Sorcerer knows 6. The four Draconic Spells ride on top.
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'hold-person',
    'shatter',
    'mind-spike',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** The sorcerer half of the sheet, which is the only half this class has. */
const casting = (plan: { spellcasting: SpellcastingState }) =>
  classCasting(plan.spellcasting, 'sorcerer')!;

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,sorcerer(over), VESKA), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(SRD_CONTENT,sorcerer(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Sorcerer table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of SORCERER.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('never takes a spell slot away as levels rise', () => {
    for (let i = 1; i < SORCERER.table.length; i += 1) {
      const before = SORCERER.table[i - 1]?.spellSlots ?? [];
      const after = SORCERER.table[i]?.spellSlots ?? [];
      for (let level = 0; level < before.length; level += 1) {
        expect(after[level] ?? 0).toBeGreaterThanOrEqual(before[level] ?? 0);
      }
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(SORCERER.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...SORCERER.features, ...DRACONIC_SORCERY.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });

  it('grants the level 3 features and not the level 5 ones', () => {
    const at3 = cumulativeFeatures(SORCERER, 3).map((f) => f.id);
    expect(at3).toContain('sorcerer:font-of-magic');
    expect(at3).toContain('sorcerer:metamagic');
    expect(at3).toContain('sorcerer:subclass');
    expect(at3).not.toContain('sorcerer:sorcerous-restoration');
  });
});

describe('a Sorcerer knows their spells rather than preparing them', () => {
  it('is made with no spellbook and a known list', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    expect(casting(plan).ability).toBe('cha');
    expect(casting(plan).prepared).toContain('thunderwave');
    expect(SORCERER.spellcasting?.style).toBe('known');
  });

  it('refuses a spellbook entry, which a Sorcerer has nowhere to put', () => {
    rejects(
      { spellbook: [{ spellId: 'burning-hands', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });

  /** The count is what the class table prints, and it is a *known* count. */
  it('refuses the wrong number of known spells', () => {
    rejects({ preparedSpells: ['burning-hands'] }, 'wrong_prepared_count');
  });

  it('refuses a spell that is not on the Sorcerer list', () => {
    rejects(
      {
        preparedSpells: [
          'cure-wounds',
          'charm-person',
          'thunderwave',
          'hold-person',
          'shatter',
          'mind-spike',
        ],
      },
      'spell_not_on_class_list',
    );
  });

  /**
   * SRD Draconic Spells: "you thereafter always have the listed spells
   * prepared" — including Command, which is not a Sorcerer spell at all.
   */
  it('carries a subclass grant that is not on the class list', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    for (const spell of ['alter-self', 'chromatic-orb', 'command', 'dragons-breath']) {
      expect(casting(plan).prepared).toContain(spell);
    }
    // Six known plus four granted, and the six were not reduced to make room.
    expect(casting(plan).prepared.length).toBe(10);
  });
});

describe('Metamagic is a set of named options, not a set of feats', () => {
  it('takes two of the ten the SRD publishes', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    expect(plan.features.map((f) => f.id)).toContain('sorcerer:metamagic');
    expect(METAMAGIC_OPTIONS).toHaveLength(10);
  });

  it('refuses an option nobody published', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell', 'Devastating Spell'],
        },
      },
      'option_not_offered',
    );
  });

  it('refuses taking the same option twice', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell', 'Empowered Spell'],
        },
      },
      'duplicate_option',
    );
  });

  it('refuses the wrong number of options', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell'],
        },
      },
      'missing_feature_choice',
    );
  });
});

/**
 * SRD Innate Sorcery, the two benefits the minute buys:
 *
 * > "The spell save DC of Sorcerer spells you cast increases by 1. You have
 * > Advantage on the attack rolls of Sorcerer spells you cast."
 *
 * The feature's switch, its two uses and its printed minute were the engine's
 * from the day the class was written; both benefits were a note, because
 * nothing could say either sentence. Now `spell-save-dc-bonus` says the first
 * and a `roll-mode` narrowed by `onlySpellAttacks` says the second — and both
 * carry the narrowing the SRD prints in the same breath, **Sorcerer** spells:
 * a Sorcerer/Wizard's Fire Bolt through the Wizard half is not one, and
 * neither is a feat's own cantrip.
 */
describe('SRD Innate Sorcery: "for 1 minute … the spell save DC … increases by 1"', () => {
  const VESKA_CHOICES = (): CharacterChoices =>
    sorcerer({
      // A wizard-list cantrip this Sorcerer does not know, so the feat's own
      // route is the only one it has and can be told apart from the class's.
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['poison-spray', 'light'],
          levelOneSpell: 'find-familiar',
        },
        'human:versatile': { featId: 'alert' },
      },
    });

  const field = (): readonly GameEvent[] => [
    ...(unwrap(createCharacter(SRD_CONTENT, VESKA_CHOICES(), VESKA), 'create') as GameEvent[]),
    { type: 'creature-side-declared', id: VESKA, side: 'party' },
    {
      type: 'creature-added',
      id: BANDIT,
      name: 'a bandit',
      sheet: {
        level: 1,
        abilities: { str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        baseSpeed: 30,
        spellcastingAbility: null,
      },
      maxHp: 40,
      diesAtZero: true,
      creatureType: 'Humanoid',
      side: 'bandits',
    },
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
    { type: 'landmark-added', name: 'the gully', at: { x: 200, y: 200, z: 0 } },
    { type: 'creature-placed', id: VESKA, placement: { from: { landmark: 'the gully' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: BANDIT,
      placement: { from: { creature: VESKA }, feet: 10, bearing: 0 },
    },
    // Charm Person is aimed at "a Humanoid you can see", and an undeclared
    // sight line is a fact the engine asks for rather than assumes.
    { type: 'sight-declared', from: VESKA, to: BANDIT, seen: true },
    { type: 'sight-declared', from: BANDIT, to: VESKA, seen: true },
  ];

  const supply = (state: GameState, seed: string) => ({
    issuer: createRollIssuer('r', state.rollsIssued),
    rng: createRng(seed),
    content: SRD_CONTENT,
  });

  const run = (
    log: readonly GameEvent[],
    step: (state: GameState) => ReturnType<typeof activateFeature>,
  ): readonly GameEvent[] => [...log, ...unwrap(step(fold('seed', log)), 'step')];

  /** The minute switched on, out of the pool the feature declares. */
  const unleashed = (log: readonly GameEvent[]): readonly GameEvent[] =>
    run(log, (state) => activateFeature(state, VESKA, { feature: 'sorcerer:innate-sorcery' }, SRD_CONTENT));

  /** And the minute over, which is the control every benefit is measured against. */
  const later = (log: readonly GameEvent[]): readonly GameEvent[] =>
    run(log, (state) => advanceTime(state, 60, 'the minute runs out'));

  const cast = (
    log: readonly GameEvent[],
    request: Parameters<typeof resolveSpell>[2],
    seed = 'cast',
  ) => unwrap(resolveSpell(fold('seed', log), VESKA, request, supply(fold('seed', log), seed)), 'cast');

  /** Charm Person is a Sorcerer spell and forces one creature's Wisdom save. */
  const saveDcOf = (log: readonly GameEvent[], commandId: string): number | null =>
    cast(log, { spellId: 'charm-person', targets: [BANDIT], slotLevel: 1, fought: [], commandId })
      .outcomes[0]
      ?.save?.dc ?? null;

  /** Fire Bolt is a Sorcerer cantrip and makes a ranged spell attack. */
  const boltMode = (log: readonly GameEvent[], commandId: string): string | null =>
    cast(log, { spellId: 'fire-bolt', targets: [BANDIT], commandId }).outcomes[0]?.attack?.roll
      .mode ?? null;

  /** Poison Spray comes through the feat, which is not the Sorcerer class. */
  const featBoltMode = (log: readonly GameEvent[], commandId: string): string | null =>
    cast(log, { spellId: 'poison-spray', targets: [BANDIT], commandId }).outcomes[0]?.attack?.roll
      .mode ?? null;

  it('declares both benefits on the activation rather than describing them', () => {
    const feature = SORCERER.features.find((one) => one.id === 'sorcerer:innate-sorcery');
    const declared = feature?.grants;
    const grant = Array.isArray(declared) ? declared[0] : declared;
    expect(grant?.kind).toBe('activated');
    if (grant === undefined || grant.kind !== 'activated') throw new Error('unreachable');
    expect(grant.lastsSeconds).toBe(60);
    expect(grant.whileActive).toEqual([
      { kind: 'spell-save-dc-bonus', flat: 1, onlyThroughClass: 'sorcerer' },
      {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: {
            roll: 'attack',
            relation: 'roller',
            onlySpellAttacks: true,
            onlyThroughClass: 'sorcerer',
          },
        },
      },
    ]);
    expect(feature?.automation).toBe('engine');
  });

  it('leaves the save DC where the sheet puts it until the minute starts', () => {
    // 8 + Proficiency 2 + Charisma 15 (+2).
    expect(saveDcOf(field(), 'before')).toBe(12);
  });

  it('adds one to the save DC of a Sorcerer spell while it runs', () => {
    expect(saveDcOf(unleashed(field()), 'during')).toBe(13);
  });

  it('takes the point back when the minute is over', () => {
    expect(saveDcOf(later(unleashed(field())), 'after')).toBe(12);
  });

  it('rolls a Sorcerer spell attack flat until the minute starts', () => {
    expect(boltMode(field(), 'bolt-before')).toBe('normal');
  });

  it('rolls a Sorcerer spell attack with Advantage while it runs', () => {
    expect(boltMode(unleashed(field()), 'bolt-during')).toBe('advantage');
  });

  it('rolls it flat again once the minute is over', () => {
    expect(boltMode(later(unleashed(field())), 'bolt-after')).toBe('normal');
  });

  /**
   * "**Sorcerer** spells you cast." The feat brings its own spellcasting
   * ability and its own route, and the sentence does not reach it.
   */
  it('leaves a feat’s own spell attack flat while the minute runs', () => {
    expect(featBoltMode(unleashed(field()), 'feat-bolt')).toBe('normal');
  });
});

describe('a Sorcerer is a creature the rest of the engine accepts', () => {
  /**
   * SRD Draconic Resilience: "Parts of you are also covered by dragon-like
   * scales. While you aren't wearing armor, your base Armor Class equals 10
   * plus your Dexterity and Charisma modifiers." The third feature to want an
   * alternative Armour Class calculation, and the one that proves the shape is
   * not a Barbarian-and-Monk thing: it arrives at level 3, from a *subclass*.
   */
  it('wears no armour, and has scales instead', () => {
    const sheet = built().creatures.veska!.sheet;
    expect(sheet.armor).toBeNull();
    // 10 + Dexterity 14 (+2) + Charisma 15 (+2).
    expect(armorClass(sheet)).toBe(14);
    expect(armorClassCalculation(sheet).source).toBe('draconic-sorcery:draconic-resilience');
  });

  it('has hit points from a d6, and Draconic Resilience’s three on top', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    // Level 3, d6, Constitution 15 (+2): 6 + 4 + 4 + 3×2 = 20 off the table,
    // and SRD Draconic Resilience's "Hit Point maximum increases by 3" is the
    // subclass's own second grant.
    expect(plan.hitPointMaximum).toBe(23);
  });

  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
