import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { resolveSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';

/**
 * **The proof that `casting-options` is vocabulary and not one class's
 * feature.**
 *
 * `casting-damage-homebrew.test.ts`'s argument, applied to the member beside
 * it: a homebrew class whose menu is written in the same four arms SRD
 * Metamagic uses, loaded from JSON text through the public door, created and
 * cast with **no engine change at all**. If any of the four were a branch on
 * Metamagic, on a Sorcerer or on Sorcery Points, none of this would execute.
 *
 * The Ley Walker below is deliberately not a reskin. Every number is
 * different — a range tripled rather than doubled, a duration tripled and
 * capped two hours short of where it would land, a level raised by two with no
 * clause about targets at all, a casting time pushed the *other* way, two
 * options on one casting rather than one — and its points come out of a pool
 * with another name. Every one of those is a field rather than a rule.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WALKER = id('walker');
const TARGET = id('target');

const feature = (over: Record<string, unknown>): Record<string, unknown> => ({
  level: 1,
  automation: 'engine',
  note: 'a homebrew feature, written in the engine’s own vocabulary.',
  ...over,
});

const WALKER_CLASS = {
  id: 'ley-walker',
  name: 'Ley Walker',
  primaryAbility: 'int',
  hitDie: 8,
  saveProficiencies: ['int', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    // The pool the menu is priced in, declared by a feature of its own —
    // because one feature carries one grant, which is how the SRD prints it.
    feature({
      id: 'ley-walker:ley-reservoir',
      name: 'Ley Reservoir',
      grants: {
        kind: 'pool',
        key: 'ley-walker:ley-points',
        label: 'Ley Points',
        usesByLevel: Array.from({ length: 20 }, () => 20),
        recovers: 'long-rest',
      },
    }),
    // The menu. Two of them may ride on one casting, which SRD Metamagic does
    // not allow and this class does: the limit is a number on the grant.
    feature({
      id: 'ley-walker:leyline-shaping',
      name: 'Leyline Shaping',
      grants: {
        kind: 'casting-options',
        pool: 'ley-walker:ley-points',
        perCasting: 2,
        options: [
          { id: 'far-reach', name: 'Far Reach', cost: 2, alters: { kind: 'range', multiplier: 3, touchBecomesFeet: 15 } },
          {
            id: 'long-hold',
            name: 'Long Hold',
            cost: 1,
            alters: { kind: 'duration', multiplier: 3, minimumSeconds: 6, maximumSeconds: 7200 },
          },
          // No clause about targets at all, which is what makes the SRD's one a
          // narrowing rather than a rule.
          { id: 'deep-draw', name: 'Deep Draw', cost: 3, alters: { kind: 'effective-level', by: 2 } },
          // And a casting time pushed the other way, which no SRD option does.
          {
            id: 'slow-rite',
            name: 'Slow Rite',
            cost: 1,
            alters: { kind: 'casting-time', from: 'bonus-action', to: 'action' },
          },
          // The one the second feature below also offers, so that electing it
          // names two prices and two alterations.
          { id: 'ley-shift', name: 'Ley Shift', cost: 1, alters: { kind: 'range', multiplier: 2 } },
        ],
      },
    }),
    // A second menu offering an id the first one already offers. Legal one
    // feature at a time and unaddressable together, which is a refusal the
    // casting makes rather than one the catalogue can see.
    feature({
      id: 'ley-walker:echoing-shape',
      name: 'Echoing Shape',
      grants: {
        kind: 'casting-options',
        pool: 'ley-walker:ley-points',
        perCasting: 1,
        options: [
          { id: 'ley-shift', name: 'Echoed Shift', cost: 1, alters: { kind: 'range', multiplier: 5 } },
        ],
      },
    }),
  ],
};

const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(WALKER_CLASS))), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const walker = (): CharacterChoices => ({
  name: 'Ilka',
  classId: 'ley-walker',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
  } satisfies CharacterSheet,
});

/**
 * The Walker casts nothing of its own — the class declares no spellcasting —
 * so the castings below come through a declared `spellcasting-declared`, the
 * ordinary door for a creature a DM describes. What is under test is the
 * caster's *features*, and those are on the sheet the class built.
 */
const table = (extra: readonly GameEvent[] = [], feet = 80): GameEvent[] => [
  ...unwrap(createCharacter(content, walker(), WALKER), 'create'),
  dummy(TARGET),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WALKER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: WALKER }, feet, bearing: 0 },
  },
  { type: 'sight-declared', from: WALKER, to: TARGET, seen: true },
  {
    type: 'spellcasting-declared',
    id: WALKER,
    spellcasting: {
      classes: [
        {
          classId: 'ley-walker',
          ability: 'int',
          cantrips: [],
          prepared: ['charm-person', 'chromatic-orb', 'misty-step'],
          slotKind: 'spell',
        },
      ],
      granted: [],
    },
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WALKER,
      pool: {
        key: `spell-slot:${level}`,
        label: `level ${level} spell slot`,
        max: 9,
        recovers: 'long-rest',
      },
    }),
  ),
  ...extra,
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content,
});

const attempt = (log: readonly GameEvent[], request: Parameters<typeof resolveSpell>[2]) => {
  const state = fold('seed', log);
  return resolveSpell(state, WALKER, request, supply(state));
};

const cast = (log: readonly GameEvent[], request: Parameters<typeof resolveSpell>[2]) => {
  const result = unwrap(attempt(log, request), 'cast');
  const after = [...log, ...result.events];
  return { log: after, state: fold('seed', after), events: result.events };
};

/** The pool the options are priced in, which is where the cost is asserted. */
const points = (state: GameState): number =>
  remaining(state.creatures[WALKER]!.resources, 'ley-walker:ley-points');

const deadlineOf = (events: readonly GameEvent[]): number => {
  const filed = events.find(
    (event) => event.type === 'effect-scheduled' && event.target.kind === 'casting',
  );
  return filed !== undefined && filed.type === 'effect-scheduled' && filed.deadline.kind === 'elapsed'
    ? filed.deadline.at
    : -1;
};

/** Everything Charm Person insists on being told, with the options under test. */
const charm = (
  options: readonly string[] | undefined,
  over: Record<string, unknown> = {},
): Parameters<typeof resolveSpell>[2] =>
  ({
    spellId: 'charm-person',
    targets: [TARGET],
    slotLevel: 1,
    fought: [],
    ...(options === undefined ? {} : { usingOptions: options }),
    ...over,
  }) as Parameters<typeof resolveSpell>[2];

describe('a homebrew class writes the whole menu with no engine change', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
    expect(content.classById('ley-walker')?.features.length).toBe(3);
    expect(SRD_CONTENT.classById('ley-walker')).toBeNull();
  });

  /**
   * A feature that asks the player nothing grants its whole menu, which is
   * where a homebrew feature parts company with SRD Metamagic's "two of your
   * choice".
   */
  it('compiles the whole menu onto the sheet, off a class the engine has never heard of', () => {
    const state = fold('seed', table());
    expect((state.creatures[WALKER]?.sheet.castingOptions ?? []).map((one) => one.name)).toEqual([
      'Far Reach',
      'Long Hold',
      'Deep Draw',
      'Slow Rite',
      'Ley Shift',
      'Echoed Shift',
    ]);
    expect(points(state)).toBe(20);
  });

  /** Tripled rather than doubled: 30 feet reaches 90, and 80 is inside it. */
  it('triples a range the SRD option would have doubled', () => {
    expect(isErr(attempt(table(), charm(undefined)))).toBe(true);
    const { state } = cast(table(), charm(['long-hold', 'far-reach']));
    // Two options on one casting, because this feature's limit is two — and
    // the price is the sum of the two the caster named.
    expect(points(state)).toBe(20 - 3);
  });

  /**
   * **The cap is the option's own number.** Charm Person's hour tripled is
   * three hours; this menu stops at two, which is neither the SRD's 24 nor
   * anything the engine holds.
   */
  it('caps a tripled duration where the option says, not where the SRD does', () => {
    const { events } = cast(table(), charm(['long-hold', 'far-reach']));
    expect(deadlineOf(events)).toBe(7200);
  });

  /**
   * SRD Twinned Spell names a clause about targets; this option does not, and
   * so reaches a spell whose target count never moves. The narrowing is a
   * field.
   */
  it('raises a level by two on a spell whose targets do not scale', () => {
    const { events, state } = cast(table(undefined, 10), {
      spellId: 'chromatic-orb',
      targets: [TARGET],
      slotLevel: 1,
      damageType: 'fire',
      usingOptions: ['deep-draw'],
    } as Parameters<typeof resolveSpell>[2]);
    const spell = events.find((event) => event.type === 'spell-cast');
    expect(spell && spell.type === 'spell-cast' && spell.level).toBe(3);
    expect(spell && spell.type === 'spell-cast' && spell.slot?.level).toBe(1);
    expect(points(state)).toBe(17);
  });

  /** And a casting time pushed the way no SRD option pushes one. */
  it('turns a Bonus Action casting into an Action', () => {
    const fight: GameEvent = {
      type: 'combat-started',
      combatants: [
        { id: WALKER, initiative: 20, speed: 30 },
        { id: TARGET, initiative: 10, speed: 30 },
      ],
    };
    const { events } = cast(table([fight], 10), {
      spellId: 'misty-step',
      targets: [WALKER],
      slotLevel: 2,
      teleportTo: { from: { creature: WALKER }, feet: 15, bearing: 180 },
      usingOptions: ['slow-rite'],
    } as Parameters<typeof resolveSpell>[2]);
    expect(events.map((event) => event.type)).toContain('action-spent');
    expect(events.map((event) => event.type)).not.toContain('bonus-action-spent');
  });

  /**
   * Two features offering one id is a catalogue that loads and a casting that
   * cannot be addressed: the price and the alteration would both be somebody's
   * guess. `checkContent` reads one feature at a time and cannot see it, so
   * the casting refuses.
   */
  it('refuses an option two of the caster’s features both offer', () => {
    const refused = attempt(table(), charm(['ley-shift']));
    expect(isErr(refused) && refused.code).toBe('ambiguous_casting_option');
  });

  /** And the feature's own limit is the grant's number rather than the SRD's one. */
  it('refuses three options off a feature that allows two', () => {
    const refused = attempt(table(), charm(['long-hold', 'deep-draw', 'slow-rite']));
    expect(isErr(refused) && refused.code).toBe('too_many_casting_options');
  });

  /**
   * **Each of the four numbers is rewritten once or not at all.**
   *
   * A feature whose limit is two lets a casting buy a range *and* a duration,
   * which the test above is about — and two options that both answer "how far
   * does this reach" are two different answers to one question. Charging for
   * both and applying one is the exact failure this module's own rule forbids:
   * a price paid for nothing.
   */
  it('refuses two options that rewrite the same number', () => {
    const log = table();
    const refused = attempt(log, charm(['far-reach', 'far-reach']));
    expect(isErr(refused) && refused.code).toBe('two_options_alter_one_thing');
    expect(points(fold('seed', log))).toBe(20);
  });
});

// — what the validator refuses ————————————————————————————————————————

describe('the validator refuses a menu nobody could use', () => {
  const broken = (features: readonly Record<string, unknown>[]): readonly string[] => {
    const definition = { ...WALKER_CLASS, id: 'broken-walker', features };
    const read = parseClassDefinition(JSON.parse(JSON.stringify(definition)));
    if (!read.ok) return [read.code];
    return checkContent({ classes: [read.value] }).map((problem) => problem.code);
  };

  const menu = (over: Record<string, unknown>): Record<string, unknown> =>
    feature({
      id: 'broken-walker:shaping',
      name: 'Shaping',
      grants: {
        kind: 'casting-options',
        pool: 'broken-walker:points',
        perCasting: 1,
        options: [{ id: 'far-reach', name: 'Far Reach', cost: 1, alters: { kind: 'range', multiplier: 2 } }],
        ...over,
      },
    });

  /** An option the feature's own choice does not print is one nobody can take. */
  it('refuses an option the player is never offered', () => {
    expect(
      broken([
        feature({
          id: 'broken-walker:shaping',
          name: 'Shaping',
          choice: { kind: 'option', choose: 1, from: ['Near Reach'] },
          grants: {
            kind: 'casting-options',
            pool: 'broken-walker:points',
            perCasting: 1,
            options: [
              { id: 'far-reach', name: 'Far Reach', cost: 1, alters: { kind: 'range', multiplier: 2 } },
            ],
          },
        }),
      ]),
    ).toContain('casting_option_not_offered');
  });

  it('refuses a menu no casting may take from', () => {
    expect(broken([menu({ perCasting: 0 })])).toContain('bad_options_per_casting');
  });

  it('refuses a menu with nothing on it', () => {
    expect(broken([menu({ options: [] })])).toContain('casting_options_empty');
  });

  it('refuses a price that is not a whole number of what the pool holds', () => {
    expect(
      broken([
        menu({
          options: [
            { id: 'far-reach', name: 'Far Reach', cost: -1, alters: { kind: 'range', multiplier: 2 } },
          ],
        }),
      ]),
    ).toContain('bad_casting_option_cost');
  });

  it('refuses two options of one feature sharing an id', () => {
    expect(
      broken([
        menu({
          options: [
            { id: 'far-reach', name: 'Far Reach', cost: 1, alters: { kind: 'range', multiplier: 2 } },
            { id: 'far-reach', name: 'Far Reach', cost: 2, alters: { kind: 'range', multiplier: 4 } },
          ],
        }),
      ]),
    ).toContain('duplicate_casting_option');
  });

  it('refuses arithmetic that is not arithmetic', () => {
    expect(
      broken([
        menu({
          options: [
            { id: 'far-reach', name: 'Far Reach', cost: 1, alters: { kind: 'range', multiplier: 0 } },
          ],
        }),
      ]),
    ).toContain('bad_casting_alteration');
  });

  /** A casting time changed to the one it already had is the option left off. */
  it('refuses a casting time changed to itself', () => {
    expect(
      broken([
        menu({
          options: [
            {
              id: 'slow-rite',
              name: 'Slow Rite',
              cost: 1,
              alters: { kind: 'casting-time', from: 'action', to: 'action' },
            },
          ],
        }),
      ]),
    ).toContain('bad_casting_alteration');
  });

  /** A menu filtered by an answer the feature never asks for cannot be filtered. */
  it('refuses a menu on a feature that asks for something other than an option', () => {
    expect(
      broken([
        feature({
          id: 'broken-walker:shaping',
          name: 'Shaping',
          choice: { kind: 'skill', choose: 1, from: ['arcana'] },
          grants: {
            kind: 'casting-options',
            pool: 'broken-walker:points',
            perCasting: 1,
            options: [
              { id: 'far-reach', name: 'Far Reach', cost: 1, alters: { kind: 'range', multiplier: 2 } },
            ],
          },
        }),
      ]),
    ).toContain('casting_options_not_chosen');
  });

  it('refuses a menu priced in no pool at all', () => {
    expect(broken([menu({ pool: '' })])).toContain('casting_options_without_a_pool');
  });
});
