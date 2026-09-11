import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { pactSlotKey, spellSlotKey } from './resources.js';
import { classCasting, routesFor } from './spellcasting.js';
import { spellSaveDcWith } from './character.js';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { remaining } from './resources.js';
import { resolveSpell } from './commands.js';
import { isErr as errored } from '@ie/shared';
import type { CharacterSheet } from './character.js';

/**
 * A character who casts from two classes.
 *
 * SRD Multiclassing, "Spellcasting": "You determine what spells you can prepare
 * for each class individually, as if you were a single-classed member of that
 * class... Each spell you prepare is associated with one of your classes, and
 * you use the spellcasting ability of that class when you cast the spell."
 *
 * Two lists, two counts, two abilities, and one combined pool of slots that
 * either list may spend. The engine used to refuse this outright, on the honest
 * grounds that a creature carried one prepared list and one ability; the fix
 * was to stop carrying one of each rather than to approximate the rule.
 *
 * The SRD works one example all the way through — a level 4 Ranger / level 3
 * Sorcerer — so that is the fixture, and every number below is the book's.
 */

const id = (s: string) => asCharacterId(s);
const SORREL = id('sorrel');
const KAEL = id('kael');

const origin = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

/**
 * SRD: "if you are a level 4 Ranger / level 3 Sorcerer... you can prepare five
 * level 1 Ranger spells, and you can prepare six Sorcerer spells of level 1 or
 * 2 (as well as four Sorcerer cantrips)."
 */
const gish = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...origin,
  name: 'Sorrel',
  classId: 'ranger',
  level: 4,
  subclassId: 'hunter',
  multiclass: [{ classId: 'sorcerer', level: 3, subclassId: 'draconic-sorcery' }],
  // Dexterity 13 for the Ranger and Charisma 13 for the Sorcerer: SRD's
  // prerequisite, in both directions.
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['survival', 'perception', 'stealth'],
  // The flat fields are the starting class's: five level 1 Ranger spells.
  cantrips: [],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry', 'longstrider'],
  spellsByClass: {
    sorcerer: {
      cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
      preparedSpells: ['magic-missile', 'shield', 'thunderwave', 'burning-hands', 'sleep', 'invisibility'],
    },
  },
  featureChoices: {
    'human:skillful': ['athletics'],
    'ranger:deft-explorer': ['survival'],
    'hunter:hunters-prey': ['Colossus Slayer'],
    'sorcerer:metamagic': ['Careful Spell', 'Distant Spell'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'ranger:fighting-style': { featId: 'archery' },
    'ranger:ability-score-improvement': { featId: 'savage-attacker' },
  },
  ...over,
});

const plan = (over: Partial<CharacterChoices> = {}) => unwrap(planCharacter(gish(over)), 'plan');

describe('two casting classes, each on its own terms', () => {
  it('is a character the engine will make at all', () => {
    expect(checkCharacter(gish())).toEqual([]);
  });

  /** SRD: five level 1 Ranger spells, cast with Wisdom. */
  it('keeps the Ranger list at the Ranger’s count and ability', () => {
    const ranger = classCasting(plan().spellcasting, 'ranger');
    expect(ranger?.ability).toBe('wis');
    expect(ranger?.prepared).toContain('goodberry');
    // Five chosen, plus Favored Enemy's always-prepared Hunter's Mark.
    expect(ranger?.prepared).toContain('hunters-mark');
    expect(ranger?.prepared).toHaveLength(6);
    expect(ranger?.cantrips).toEqual([]);
  });

  /** SRD: six Sorcerer spells of level 1 or 2, and four cantrips, on Charisma. */
  it('keeps the Sorcerer list at the Sorcerer’s count and ability', () => {
    const sorcerer = classCasting(plan().spellcasting, 'sorcerer');
    expect(sorcerer?.ability).toBe('cha');
    expect(sorcerer?.cantrips).toHaveLength(4);
    expect(sorcerer?.prepared).toContain('invisibility');
    // Six chosen, plus Draconic Spells' four, which do not count against the table.
    expect(sorcerer?.prepared).toContain('command');
    expect(sorcerer?.prepared).toHaveLength(10);
  });

  /**
   * The point of keeping them apart: the same creature rolls two different
   * save DCs, and which one applies is a fact about the spell's class.
   */
  it('gives the two classes two different save DCs', () => {
    const sheet = plan().sheet;
    const ranger = classCasting(plan().spellcasting, 'ranger')!;
    const sorcerer = classCasting(plan().spellcasting, 'sorcerer')!;
    expect(spellSaveDcWith(sheet, ranger.ability)).not.toBe(
      spellSaveDcWith(sheet, sorcerer.ability),
    );
  });

  /** A Ranger spell is not a Sorcerer spell, whoever is holding both lists. */
  it('refuses a Sorcerer spell written on the Ranger’s list', () => {
    const problems = checkCharacter(
      gish({ preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry', 'magic-missile'] }),
    );
    expect(problems.map((p) => p.code)).toContain('spell_not_on_class_list');
    expect(problems.find((p) => p.code === 'spell_not_on_class_list')?.field).toBe('preparedSpells');
  });

  /** And the problem points at the class whose list it belongs to. */
  it('names the class a bad Sorcerer choice belongs to', () => {
    const problems = checkCharacter(
      gish({
        spellsByClass: {
          sorcerer: {
            cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
            preparedSpells: ['magic-missile', 'shield', 'thunderwave', 'burning-hands', 'sleep', 'goodberry'],
          },
        },
      }),
    );
    expect(problems.find((p) => p.code === 'spell_not_on_class_list')?.field).toBe(
      'spellsByClass.sorcerer.preparedSpells',
    );
  });

  /**
   * SRD: "This table might give you spell slots of a higher level than the
   * spells you prepare... you can't prepare any level 2 Ranger spells." The
   * ceiling is the class's own table, not the combined one.
   */
  it('will not prepare above the class’s own slot level, though the character has such slots', () => {
    const problems = checkCharacter(
      gish({ preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry', 'spike-growth'] }),
    );
    expect(problems.map((p) => p.code)).toContain('spell_level_not_allowed');
    // And the character does have a level 2 slot, from the combined table.
    expect(plan().spellSlots[2]).toBe(3);
  });

  /** Spells belonging to nobody are refused rather than filed by guess. */
  it('refuses spells that name no class when two classes cast', () => {
    const problems = checkCharacter(
      gish({
        spellsByClass: {
          ranger: { preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry', 'longstrider'] },
          sorcerer: {
            cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
            preparedSpells: ['magic-missile', 'shield', 'thunderwave', 'burning-hands', 'sleep', 'invisibility'],
          },
        },
      }),
    );
    expect(problems.map((p) => p.code)).toContain('unattributed_spells');
  });

  it('refuses a spell list for a class the character does not have', () => {
    const problems = checkCharacter(gish({ spellsByClass: { bard: { preparedSpells: ['bless'] } } }));
    expect(problems.map((p) => p.code)).toContain('not_a_class_of_this_character');
  });
});

describe('slots come from the combined table, spells from each class', () => {
  /**
   * SRD: "counting all your levels as a Sorcerer and half your Ranger levels...
   * you have four level 1 spell slots, three level 2 slots, and two level 3
   * slots." Three plus two is a level 5 caster.
   */
  it('matches the SRD’s own worked example exactly', () => {
    expect(plan().spellSlots).toEqual({ 1: 4, 2: 3, 3: 2 });
  });

  it('declares those slots on the creature', () => {
    const state = fold('seed', unwrap(createCharacter(gish(), SORREL), 'create') as GameEvent[]);
    const pools = state.creatures.sorrel!.resources.pools;
    expect(pools[spellSlotKey(3)]?.max).toBe(2);
    expect(pools[spellSlotKey(3)]?.recovers).toBe('long-rest');
    expect(pools[pactSlotKey(3)]).toBeUndefined();
  });
});

/**
 * Pact Magic, which is the other half of "handle the slots".
 *
 * SRD keeps it out of the combined table entirely and then lets the two pools
 * pay for each other's spells. A Warlock 3 / Wizard 3 therefore has *four*
 * level 2 slots — two of each — and only two of them come back on a Short
 * Rest. Merging them at one key would have lost half of them, and reading the
 * recovery off the starting class would have handed a Wizard's slots back
 * every hour.
 */
const hexblade = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...origin,
  name: 'Kael',
  classId: 'warlock',
  level: 3,
  subclassId: 'fiend-patron',
  multiclass: [{ classId: 'wizard', level: 3, subclassId: 'evoker' }],
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  cantrips: ['eldritch-blast', 'chill-touch'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'mind-spike'],
  spellsByClass: {
    wizard: {
      cantrips: ['fire-bolt', 'light', 'prestidigitation'],
      spellbook: [
        'magic-missile',
        'shield',
        'thunderwave',
        'charm-person',
        'chromatic-orb',
        'grease',
        'ray-of-sickness',
        'sleep',
        'misty-step',
        'mirror-image',
      ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
      preparedSpells: ['magic-missile', 'shield', 'thunderwave', 'charm-person', 'misty-step', 'mirror-image'],
    },
  },
  featureChoices: {
    'human:skillful': ['perception'],
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  ...over,
});

const pactPlan = (over: Partial<CharacterChoices> = {}) =>
  unwrap(planCharacter(hexblade(over)), 'plan');

const pactState = (): GameState =>
  fold('seed', unwrap(createCharacter(hexblade(), KAEL), 'create') as GameEvent[]);

describe('Pact Magic is a second pool, not more of the first', () => {
  it('is a character the engine will make at all', () => {
    expect(checkCharacter(hexblade())).toEqual([]);
  });

  /**
   * SRD: "If you multiclass but have the Spellcasting feature from only one
   * class, follow the rules for that class." Pact Magic is not Spellcasting,
   * so the ordinary slots are a level 3 Wizard's own.
   */
  it('reads the Wizard’s own table, because only one class has Spellcasting', () => {
    expect(pactPlan().spellSlots).toEqual({ 1: 4, 2: 2 });
  });

  /** And the Warlock's two level 2 slots sit beside them, not on top. */
  it('keeps the Pact slots apart from the Spellcasting slots', () => {
    expect(pactPlan().pactSlots).toEqual({ 2: 2 });

    const pools = pactState().creatures.kael!.resources.pools;
    expect(pools[spellSlotKey(2)]?.max).toBe(2);
    expect(pools[pactSlotKey(2)]?.max).toBe(2);
  });

  /** The recovery is the pool's, never the starting class's. */
  it('brings back only the Pact slots on a Short Rest', () => {
    const pools = pactState().creatures.kael!.resources.pools;
    expect(pools[pactSlotKey(2)]?.recovers).toBe('short-rest');
    expect(pools[spellSlotKey(1)]?.recovers).toBe('long-rest');
    expect(pools[spellSlotKey(2)]?.recovers).toBe('long-rest');
  });

  it('gives the Warlock and the Wizard halves their own abilities', () => {
    const casting = pactPlan().spellcasting;
    expect(classCasting(casting, 'warlock')?.ability).toBe('cha');
    expect(classCasting(casting, 'wizard')?.ability).toBe('int');
    expect(classCasting(casting, 'warlock')?.slotKind).toBe('pact');
    expect(classCasting(casting, 'wizard')?.slotKind).toBe('spell');
  });

  /**
   * Charm Person is prepared through both classes here, which is a real state
   * rather than a mistake — two preparations, two save DCs.
   */
  it('finds a route through each class that prepared the spell', () => {
    const routes = routesFor(pactState().creatures.kael!.spellcasting, 'charm-person');
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => (r.kind === 'granted' ? 'granted' : r.classId))).toEqual([
      'warlock',
      'wizard',
    ]);
  });
});

describe('advancement keeps both halves', () => {
  it('refuses a Wizard spellbook written under the Warlock', () => {
    const problems = checkCharacter(
      hexblade({
        spellbook: [{ spellId: 'magic-missile', acquiredAt: 1, origin: 'level' as const }],
      }),
    );
    expect(problems.map((p) => p.code)).toContain('no_spellbook');
  });

  it('replays prefix by prefix', () => {
    const log = unwrap(createCharacter(hexblade(), KAEL), 'create') as GameEvent[];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON, so a campaign can be reloaded', () => {
    const state = pactState();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is not a valid character when a prerequisite is missed', () => {
    const short = planCharacter(
      hexblade({
        abilities: {
          method: 'standard-array',
          assignment: { str: 8, dex: 12, con: 14, int: 10, wis: 13, cha: 15 },
        },
        abilityIncreases: { con: 2, wis: 1 },
      }),
    );
    expect(isErr(short)).toBe(true);
  });
});

/**
 * Casting, once the character sheet has two halves.
 *
 * Two things the engine must not do here, and they are the same rule twice:
 * it must not decide which class is casting, and it must not decide which
 * pool pays. Both are choices with consequences the engine cannot weigh — a
 * save DC six points apart, a slot back in an hour rather than tomorrow — so
 * both are refusals that name the options rather than defaults that look
 * tidy.
 */

const MYSTIC = id('mystic');
const GOBLIN = id('goblin');

const flat = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 6,
  // Twelve points between Intelligence and Wisdom, so the two routes cannot
  // possibly produce the same save DC by coincidence.
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 8, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const slotPool = (who: typeof MYSTIC, key: string, label: string, max: number, recovers: 'long-rest' | 'short-rest'): GameEvent => ({
  type: 'resource-pool-declared',
  id: who,
  pool: { key, label, max, recovers },
});

const TABLE: readonly GameEvent[] = [
  { type: 'creature-added', id: MYSTIC, name: 'Mystic', sheet: flat(), maxHp: 40, diesAtZero: false, creatureType: 'Humanoid' },
  { type: 'creature-added', id: GOBLIN, name: 'Goblin', sheet: flat({ abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } }), maxHp: 12, diesAtZero: true, creatureType: 'Humanoid' },
  slotPool(MYSTIC, spellSlotKey(1), 'level 1 spell slot', 4, 'long-rest'),
  slotPool(MYSTIC, spellSlotKey(2), 'level 2 spell slot', 3, 'long-rest'),
  slotPool(MYSTIC, pactSlotKey(2), 'level 2 Pact Magic slot', 2, 'short-rest'),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: MYSTIC, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: MYSTIC }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: MYSTIC, to: GOBLIN, seen: true },
  {
    type: 'spellcasting-declared',
    id: MYSTIC,
    // Hold Person prepared through both halves: two preparations, two DCs.
    spellcasting: {
      classes: [
        { classId: 'wizard', ability: 'int', cantrips: ['fire-bolt'], prepared: ['hold-person'], slotKind: 'spell' },
        { classId: 'warlock', ability: 'wis', cantrips: [], prepared: ['hold-person'], slotKind: 'pact' },
      ],
      granted: [],
    },
  },
];

const table = (): GameState => fold('seed', TABLE);

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('cast') as Rng });

describe('which class is casting is not the engine’s to decide', () => {
  it('refuses a spell prepared through two classes, naming both', () => {
    const out = resolveSpell(table(), MYSTIC, { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, slotKind: 'spell' }, supply());
    expect(errored(out)).toBe(true);
    if (!errored(out)) return;
    expect(out.code).toBe('class_required');
    expect(out.reason).toContain('class:wizard');
    expect(out.reason).toContain('class:warlock');
  });

  it('spends nothing when it refuses', () => {
    resolveSpell(table(), MYSTIC, { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, slotKind: 'spell' }, supply());
    expect(remaining(table().creatures.mystic!.resources, spellSlotKey(2))).toBe(3);
  });

  /** SRD: "you use the spellcasting ability of that class when you cast it." */
  it('rolls the named class’s save DC, and the other class’s is different', () => {
    const dcFor = (source: string): number => {
      const out = unwrap(
        resolveSpell(table(), MYSTIC, { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, slotKind: 'spell', source }, supply()),
        source,
      );
      return out.outcomes[0]!.save!.dc;
    };
    // 8 + 3 proficiency + 5 Intelligence, against 8 + 3 - 1 Wisdom.
    expect(dcFor('class:wizard')).toBe(16);
    expect(dcFor('class:warlock')).toBe(10);
  });

  it('records the route on the casting, so the log can explain the DC', () => {
    const out = unwrap(
      resolveSpell(table(), MYSTIC, { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, slotKind: 'spell', source: 'class:warlock' }, supply()),
      'cast',
    );
    const cast = out.events.find((e) => e.type === 'spell-cast');
    expect(cast).toMatchObject({ route: 'class:warlock' });
  });

  it('refuses a class that did not prepare it', () => {
    const out = resolveSpell(table(), MYSTIC, { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, slotKind: 'spell', source: 'class:cleric' }, supply());
    expect(errored(out)).toBe(true);
    if (!errored(out)) return;
    expect(out.code).toBe('source_does_not_supply');
  });

  /** A spell only one class prepared asks nobody anything. */
  it('asks nothing when only one class supplies the spell', () => {
    const out = unwrap(
      resolveSpell(table(), MYSTIC, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply()),
      'fire-bolt',
    );
    expect(out.castingId.length).toBeGreaterThan(0);
  });
});

describe('which pool pays is not the engine’s to decide either', () => {
  const named = (source: string) => ({ spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2, source });

  it('refuses when both a Pact slot and a spell slot would serve', () => {
    const out = resolveSpell(table(), MYSTIC, named('class:wizard'), supply());
    expect(errored(out)).toBe(true);
    if (!errored(out)) return;
    expect(out.code).toBe('slot_kind_required');
  });

  it('spends the Pact slot when told to, and leaves the other pool alone', () => {
    const out = unwrap(
      resolveSpell(table(), MYSTIC, { ...named('class:wizard'), slotKind: 'pact' }, supply()),
      'cast',
    );
    const after = fold('seed', [...TABLE, ...out.events]);
    expect(remaining(after.creatures.mystic!.resources, pactSlotKey(2))).toBe(1);
    expect(remaining(after.creatures.mystic!.resources, spellSlotKey(2))).toBe(3);
  });

  it('spends the ordinary slot when told to, and leaves the Pact pool alone', () => {
    const out = unwrap(
      resolveSpell(table(), MYSTIC, { ...named('class:wizard'), slotKind: 'spell' }, supply()),
      'cast',
    );
    const after = fold('seed', [...TABLE, ...out.events]);
    expect(remaining(after.creatures.mystic!.resources, spellSlotKey(2))).toBe(2);
    expect(remaining(after.creatures.mystic!.resources, pactSlotKey(2))).toBe(2);
  });

  /** Only a pool that *has* a slot counts as an option. */
  it('asks nothing when only one of the two pools has a slot left', () => {
    const emptyPact: readonly GameEvent[] = [
      ...TABLE,
      { type: 'resource-spent', id: MYSTIC, key: pactSlotKey(2), amount: 2 },
    ];
    const out = unwrap(
      resolveSpell(fold('seed', emptyPact), MYSTIC, named('class:wizard'), supply()),
      'cast',
    );
    expect(out.events.some((e) => e.type === 'spell-cast')).toBe(true);
  });

  it('refuses a Pact slot the caster has run out of', () => {
    const emptyPact = fold('seed', [
      ...TABLE,
      { type: 'resource-spent', id: MYSTIC, key: pactSlotKey(2), amount: 2 } as GameEvent,
    ]);
    const out = resolveSpell(emptyPact, MYSTIC, { ...named('class:wizard'), slotKind: 'pact' }, supply());
    expect(errored(out)).toBe(true);
    if (!errored(out)) return;
    expect(out.code).toBe('no_slot');
    expect(out.reason).toContain('Pact Magic');
  });

  /** A retry of the same command spends nothing a second time. */
  it('is retry-safe across both pools', () => {
    const request = { ...named('class:wizard'), slotKind: 'pact' as const, commandId: 'c1' };
    const first = unwrap(resolveSpell(table(), MYSTIC, request, supply()), 'first');

    const log = [...TABLE, ...first.events];
    const again = unwrap(resolveSpell(fold('seed', log), MYSTIC, request, supply()), 'retry');
    expect(again.events).toEqual([]);

    const after = fold('seed', [...log, ...again.events]);
    expect(remaining(after.creatures.mystic!.resources, pactSlotKey(2))).toBe(1);
  });
});

/**
 * Taking a level in a second class, without losing what the first one is
 * holding.
 *
 * SRD: "you gain a level in a new class ... instead of gaining a level in one
 * of your current classes." So a level goes into exactly one class, named, and
 * everything that is *live* — wounds, spent slots, what is worn, an ongoing
 * effect — must still be there afterwards. `advanceCharacter` emits the
 * differences rather than rebuilding the creature, and this is the test that
 * the differences are the only thing that changed.
 */
describe('a level taken in another class', () => {
  const started = (): readonly GameEvent[] =>
    unwrap(
      createCharacter(
        gish({
          // A plain level 4 Ranger to start with, so the Sorcerer level below
          // is the character's first.
          multiclass: [],
          spellsByClass: {},
          featureChoices: {
            'human:skillful': ['athletics'],
            'ranger:deft-explorer': ['survival'],
            'hunter:hunters-prey': ['Colossus Slayer'],
          },
        }),
        SORREL,
      ),
      'create',
    ) as readonly GameEvent[];

  /** Wounds, a spent slot and a worn shirt, all made before levelling. */
  const played = (): readonly GameEvent[] => [
    ...started(),
    { type: 'damage-taken', id: SORREL, amount: 7, source: 'a goblin' } as GameEvent,
    { type: 'resource-spent', id: SORREL, key: spellSlotKey(1), amount: 1 } as GameEvent,
  ];

  const asSorcerer = () =>
    advanceCharacter(fold('seed', played()), SORREL, {
      classId: 'sorcerer',
      spellsByClass: {
        sorcerer: {
          cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
          preparedSpells: ['magic-missile', 'shield'],
        },
      },
    });

  it('begins the new class at level 1 and leaves the old one alone', () => {
    const after = fold('seed', [...played(), ...unwrap(asSorcerer(), 'advance')]);
    const record = after.creatures.sorrel!.character!;
    expect(record.level).toBe(4);
    expect(record.choices.multiclass).toEqual([{ classId: 'sorcerer', level: 1 }]);
    // A level 4 Ranger / level 1 Sorcerer is a level 5 character.
    expect(after.creatures.sorrel!.sheet.level).toBe(5);
  });

  it('gives the new class its own list and ability', () => {
    const after = fold('seed', [...played(), ...unwrap(asSorcerer(), 'advance')]);
    const casting = after.creatures.sorrel!.spellcasting;
    expect(classCasting(casting, 'ranger')?.ability).toBe('wis');
    expect(classCasting(casting, 'sorcerer')?.ability).toBe('cha');
    expect(classCasting(casting, 'sorcerer')?.cantrips).toHaveLength(4);
    expect(classCasting(casting, 'ranger')?.prepared).toContain('goodberry');
  });

  /** The whole point of emitting differences rather than rebuilding. */
  it('keeps the wounds and the spent slot', () => {
    const before = fold('seed', played()).creatures.sorrel!;
    const after = fold('seed', [...played(), ...unwrap(asSorcerer(), 'advance')]).creatures.sorrel!;

    expect(before.vitals.hp).toBe(before.vitals.hpMax - 7);
    // The maximum went up by the new level's hit points; the damage stands.
    expect(after.vitals.hpMax).toBeGreaterThan(before.vitals.hpMax);
    expect(after.vitals.hpMax - after.vitals.hp).toBe(7);
    expect(after.resources.pools[spellSlotKey(1)]?.spent).toBe(1);
  });

  /**
   * SRD: a level 4 Ranger / level 1 Sorcerer counts as a level 3 caster —
   * two Ranger levels' worth plus one Sorcerer — so the pool grows rather
   * than being re-declared, and what was spent stays spent.
   */
  it('grows the combined slot table without refunding anything', () => {
    const after = fold('seed', [...played(), ...unwrap(asSorcerer(), 'advance')]).creatures.sorrel!;
    expect(after.resources.pools[spellSlotKey(1)]?.max).toBe(4);
    expect(after.resources.pools[spellSlotKey(2)]?.max).toBe(2);
    expect(after.resources.pools[spellSlotKey(1)]?.spent).toBe(1);
  });

  it('refuses a level in a class nobody registered', () => {
    const out = advanceCharacter(fold('seed', played()), SORREL, { classId: 'alchemist' });
    expect(errored(out)).toBe(true);
    if (!errored(out)) return;
    expect(out.code).toBe('unknown_class');
  });

  /** The fold is a pure function of the log: the seed is not an input to it. */
  it('replays identically whatever seed the fold starts from', () => {
    const log = [...played(), ...unwrap(asSorcerer(), 'advance')];
    expect(fold('seed', log).creatures).toEqual(fold('other-seed', log).creatures);
  });
});
