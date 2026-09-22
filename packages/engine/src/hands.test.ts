import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { handsOf, type CharacterSheet } from './character.js';
import { handsFor } from './catalogue.js';
import { extendContent, type Content } from './content.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import {
  dropConjured,
  equipItem,
  evokeConjured,
  freeHands,
  handsInUse,
  carrying,
  resolveSpell,
  unequipItem,
  useItem,
} from './commands.js';

/**
 * **What a creature is holding, and a conjured thing that occupies a hand.**
 *
 * Two facts the engine did not keep. `inventory` and `equipped` were both real
 * and neither was a *hand*: a creature could wield a Greatsword, a Longsword
 * and a Shield at once, and a spell that puts something in your hand — SRD
 * Goodberry's ten berries, Flame Blade's blade — had nowhere to put it.
 *
 * The rules under test, all four printed:
 *
 * - a creature has two hands, and what it wields takes them up;
 * - a Two-Handed weapon takes both, body armour takes none;
 * - a spell that conjures something into a hand is refused when both are full,
 *   and what it conjures is held for as long as the casting runs;
 * - a conjured thing can be let go — it disappears — and evoked again.
 *
 * The homebrew below is the argument that none of it is a special case: a
 * berry and a blade the SRD never printed, loaded through the public door,
 * conjured and eaten and dropped with no engine change of their own.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');

const BERRY = 'test-berry';
const BLADE = 'test-blade';

const HOMEBREW = {
  items: [
    {
      id: BERRY,
      name: 'Test Berry',
      kind: 'potion',
      weightLb: 0,
      costCp: 0,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'confers',
          action: 'bonus-action',
          effects: [{ kind: 'heal', healing: { flat: 1 }, addSpellcastingModifier: false }],
        },
      ],
    },
    {
      id: BLADE,
      name: 'Test Blade',
      kind: 'weapon',
      weightLb: 0,
      costCp: 0,
      armor: null,
      weapon: {
        id: BLADE,
        name: 'Test Blade',
        category: 'simple',
        kind: 'melee',
        damage: { dice: '1d6', fixed: null, type: 'fire' },
        properties: [],
        versatileDamage: null,
        thrownRange: null,
        ammunitionRange: null,
        ammunitionType: null,
        propertyNotes: null,
        mastery: 'nick',
        weightLb: 0,
        cost: { amount: 0, unit: 'gp' },
      },
      contents: [],
    },
  ],
  spells: [
    {
      id: 'test-berries',
      name: 'Test Berries',
      level: 1,
      school: 'conjuration',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'self' },
      targets: { count: 0 },
      effects: [],
      durationSeconds: 86_400,
      conjures: { item: BERRY, count: 10, hands: 1 },
    },
    {
      id: 'test-evoke-blade',
      name: 'Test Evoke Blade',
      level: 2,
      school: 'evocation',
      castingTime: 'bonus-action',
      concentration: true,
      range: { kind: 'self' },
      targets: { count: 0 },
      effects: [],
      durationSeconds: 600,
      conjures: { item: BLADE, count: 1, hands: 1, retake: 'bonus-action' },
    },
  ],
};

const content: Content = unwrap(
  extendContent(SRD_CONTENT, JSON.parse(JSON.stringify(HOMEBREW))),
  'content',
);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const TABLE: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: CASTER,
    name: 'caster',
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: {
      classes: [
        {
          classId: 'druid',
          ability: 'wis',
          cantrips: [],
          prepared: ['test-berries', 'test-evoke-blade'],
          slotKind: 'spell',
        },
      ],
      granted: [],
    },
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: {
        key: `spell-slot:${level}`,
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
];

const owning = (...items: readonly string[]): readonly GameEvent[] => [
  {
    type: 'items-gained',
    id: CASTER,
    items: items.map((item) => ({ id: item, quantity: 1 })),
    source: 'the test',
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('seed') : restoreRng(state.rng)) as Rng,
  content,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (state: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

const cast = (log: readonly GameEvent[], spellId: string): readonly GameEvent[] =>
  run(log, (state) => resolveSpell(state, CASTER, { spellId, targets: [] }, supply(state)));

describe('hands are a number, and what is wielded takes them up', () => {
  /** SRD "Creature Size and Space" gives no head count; two hands is the rule. */
  it('gives a creature two hands unless its sheet says otherwise', () => {
    expect(handsOf(sheet())).toBe(2);
    expect(handsOf(sheet({ hands: 4 }))).toBe(4);
    expect(handsOf(sheet({ hands: 0 }))).toBe(0);
  });

  /**
   * SRD Weapon Properties, "Two-Handed": "this weapon requires two hands". A
   * Shield is held in one. Body armour is worn and takes none.
   */
  it('reads the hands an item takes off its own record', () => {
    expect(handsFor(SRD_CONTENT.item('greatsword')!)).toBe(2);
    expect(handsFor(SRD_CONTENT.item('longsword')!)).toBe(1);
    expect(handsFor(SRD_CONTENT.item('shield')!)).toBe(1);
    expect(handsFor(SRD_CONTENT.item('chain-mail')!)).toBe(0);
  });

  it('counts what is equipped, and leaves the rest free', () => {
    const armed = run(
      run([...TABLE, ...owning('longsword', 'shield', 'chain-mail')], (state) =>
        equipItem(state, content, CASTER, 'longsword'),
      ),
      (state) => equipItem(state, content, CASTER, 'chain-mail'),
    );
    const state = fold('seed', armed);
    expect(handsInUse(state, content, CASTER)).toBe(1);
    expect(freeHands(state, content, CASTER)).toBe(1);
  });

  /** The rule the design note said nothing checked. */
  it('refuses a third thing in two hands', () => {
    const both = run(
      run([...TABLE, ...owning('longsword', 'shield', 'dagger')], (state) =>
        equipItem(state, content, CASTER, 'longsword'),
      ),
      (state) => equipItem(state, content, CASTER, 'shield'),
    );
    const third = equipItem(fold('seed', both), content, CASTER, 'dagger');
    expect(isErr(third) && third.code).toBe('no_free_hand');
    expect(isErr(third) && third.reason).toContain('Dagger');
  });

  it('refuses a Two-Handed weapon beside a Shield, and takes it once the Shield is off', () => {
    const shielded = run([...TABLE, ...owning('greatsword', 'shield')], (state) =>
      equipItem(state, content, CASTER, 'shield'),
    );
    const refused = equipItem(fold('seed', shielded), content, CASTER, 'greatsword');
    expect(isErr(refused) && refused.code).toBe('no_free_hand');

    const bare = run(shielded, (state) => unequipItem(state, content, CASTER, 'shield'));
    const taken = run(bare, (state) => equipItem(state, content, CASTER, 'greatsword'));
    expect(handsInUse(fold('seed', taken), content, CASTER)).toBe(2);
  });
});

describe('a conjured thing occupies a hand for as long as its casting runs', () => {
  const berried = cast([...TABLE], 'test-berries');

  it('puts what the spell prints in the caster’s hand, tied to the casting', () => {
    const state = fold('seed', berried);
    const line = carrying(state, CASTER).find((held) => held.id === BERRY);
    expect(line?.quantity).toBe(10);
    expect(line?.casting).toBe('cast:1');
    expect(line?.hands).toBe(1);
    // Ten berries are one handful, not ten.
    expect(handsInUse(state, content, CASTER)).toBe(1);
  });

  it('refuses the casting when both hands are full', () => {
    const armed = run(
      run([...TABLE, ...owning('longsword', 'shield')], (state) =>
        equipItem(state, content, CASTER, 'longsword'),
      ),
      (state) => equipItem(state, content, CASTER, 'shield'),
    );
    const state = fold('seed', armed);
    const refused = resolveSpell(state, CASTER, { spellId: 'test-berries', targets: [] }, supply(state));
    expect(isErr(refused) && refused.code).toBe('no_free_hand');
    // And it cost nothing: no casting was opened and no slot went.
    expect(Object.keys(fold('seed', armed).ongoing)).toEqual([]);
  });

  /**
   * "Uneaten berries disappear when the spell ends" — derived, on the reading
   * a lapsed patch of Difficult Terrain already takes, because a casting that
   * simply runs out writes no event anybody could hang a removal on.
   */
  it('takes the conjured thing away when the casting ends', () => {
    const ended: readonly GameEvent[] = [
      ...berried,
      { type: 'spell-ended', castingId: 'cast:1', on: null, reason: 'dispelled' },
    ];
    const state = fold('seed', ended);
    expect(carrying(state, CASTER).some((held) => held.id === BERRY)).toBe(false);
    expect(handsInUse(state, content, CASTER)).toBe(0);
  });

  it('is eaten one at a time, and the rest stay in hand', () => {
    const eaten = run([...berried], (state) =>
      useItem(state, CASTER, { item: BERRY }, supply(state)),
    );
    const state = fold('seed', eaten);
    const line = carrying(state, CASTER).find((held) => held.id === BERRY);
    expect(line?.quantity).toBe(9);
    expect(line?.casting).toBe('cast:1');
  });

  it('never merges a conjured stack with an ordinary one', () => {
    const both: readonly GameEvent[] = [...berried, ...owning(BERRY)];
    const lines = carrying(fold('seed', both), CASTER).filter((held) => held.id === BERRY);
    expect(lines.map((line) => line.quantity)).toEqual([10, 1]);
  });
});

describe('letting go of a conjured thing, and evoking it again', () => {
  const evoked = cast([...TABLE], 'test-evoke-blade');

  it('lets go for nothing, and the thing disappears', () => {
    const dropped = run(evoked, (state) => dropConjured(state, content, CASTER, BLADE));
    const state = fold('seed', dropped);
    expect(carrying(state, CASTER).some((held) => held.id === BLADE)).toBe(false);
    expect(freeHands(state, content, CASTER)).toBe(2);
    // The casting runs on: the blade went, the spell did not.
    expect(state.ongoing['cast:1']).toBeDefined();
  });

  it('evokes it again, into a hand that is free', () => {
    const dropped = run(evoked, (state) => dropConjured(state, content, CASTER, BLADE));
    const again = run(dropped, (state) =>
      evokeConjured(state, CASTER, { item: BLADE }, supply(state)),
    );
    const state = fold('seed', again);
    expect(carrying(state, CASTER).find((held) => held.id === BLADE)?.casting).toBe('cast:1');
    expect(handsInUse(state, content, CASTER)).toBe(1);
  });

  it('refuses to evoke what is already in hand, and what no casting conjures', () => {
    const state = fold('seed', evoked);
    const twice = evokeConjured(state, CASTER, { item: BLADE }, supply(state));
    expect(isErr(twice) && twice.code).toBe('already_held');

    const nothing = evokeConjured(state, CASTER, { item: BERRY }, supply(state));
    expect(isErr(nothing) && nothing.code).toBe('not_conjured');
  });

  /**
   * SRD prints the clause on Flame Blade and on nothing else: berries let go
   * of are berries on the floor, and the engine does not invent the sentence.
   */
  it('refuses to evoke again what the spell never said could be', () => {
    const berries = cast([...TABLE], 'test-berries');
    const dropped = run(berries, (state) => dropConjured(state, content, CASTER, BERRY));
    const state = fold('seed', dropped);
    const refused = evokeConjured(state, CASTER, { item: BERRY }, supply(state));
    expect(isErr(refused) && refused.code).toBe('not_re_evoked');
  });

  it('refuses to let go of something no casting conjured', () => {
    const armed = run([...TABLE, ...owning('longsword')], (state) =>
      equipItem(state, content, CASTER, 'longsword'),
    );
    const refused = dropConjured(fold('seed', armed), content, CASTER, 'longsword');
    expect(isErr(refused) && refused.code).toBe('not_conjured');
  });
});
