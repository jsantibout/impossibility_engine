import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  isOk,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { itemChargePool, itemSource, type CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent, type Content } from './content.js';
import { conditionInstanceId } from './conditions.js';
import { createRng, restoreRng, type Rng, type RngState } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { timerKey } from './timers.js';
import {
  awardItems,
  chargesLeft,
  declareDawn,
  equipItem,
  resolveSpell,
  resolveTurn,
  useItem,
} from './commands.js';

/**
 * The last charge, and a conferral that reaches sixty feet.
 *
 * SRD prints the same sentence under nine wands and staffs: "If you expend the
 * wand's last charge, roll 1d20. On a 1, the wand crumbles into ashes and is
 * destroyed." It is a clause that **limits** the item, so a record that let it
 * through as a note was a wand that lasted longer than the book's. The pool
 * says it now (`onLastCharge`), and the engine throws the d20 at the spend that
 * takes the pool to 0 — at the two places a charge is spent on something, the
 * casting route and `useItem`'s priced conferral, and nowhere else.
 *
 * **The die is the engine's; which face it shows is the test's.** A scripted
 * generator puts a 1 or a 2 on the first die thrown, which is the last-charge
 * d20 because it is thrown at the spend, before anything the charge buys. What
 * is asserted is what follows from the face the log records, never a number the
 * engine should have rolled.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const GOBLIN = id('goblin');

const FIREBALLS = 'wand-of-fireballs';
const PARALYSIS = 'wand-of-paralysis';

/** Every die shows the next of these, round and round. */
const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: 'party' | 'hostile'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A long room, the wielder at one end and the goblin a stated distance off. */
const room = (goblinFeet: number): readonly GameEvent[] => [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the gallery', at: { x: 100, y: 100, z: 0 } },
  {
    type: 'creature-placed',
    id: WIELDER,
    placement: { from: { landmark: 'the gallery' }, feet: 0 },
  },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: WIELDER }, feet: goblinFeet, bearing: 90 },
  },
  // The wielder can see the goblin unless a test says otherwise.
  { type: 'sight-declared', from: WIELDER, to: GOBLIN, seen: true },
];

const supply = (state: GameState, rng?: Rng, content: Content = SRD_CONTENT, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: rng ?? ((state.rng === null ? createRng('last-charge') : restoreRng(state.rng)) as Rng),
  content,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

/** The copy this creature was handed, by its engine-issued id. */
const copyOf = (log: readonly GameEvent[], item: string): string =>
  fold('seed', log).creatures[WIELDER]!.inventory.find((line) => line.id === item)!.instance!;

/**
 * Handed over, in hand, attuned to, and down to `left` charges.
 *
 * The charges already gone are written straight into the log as the
 * `resource-spent` a use writes, so what this stands up is a world the engine
 * could have written — and the spend under test is the one that empties it.
 */
const holding = (
  item: string,
  left: number,
  content: Content = SRD_CONTENT,
  goblinFeet = 60,
): readonly GameEvent[] => {
  const base = [added(WIELDER, 'party'), added(GOBLIN, 'hostile'), ...room(goblinFeet)];
  const awarded = run(base, (s) =>
    awardItems(s, supply(s, undefined, content), WIELDER, [{ id: item }], 'the hoard'),
  );
  const equipped = run(awarded, (s) => equipItem(s, content, WIELDER, item));
  const record = content.item(item)!;
  const instance = copyOf(equipped, item);
  const pool = itemChargePool(record, instance)!;
  return [
    ...equipped,
    ...(record.attunement === undefined
      ? []
      : [{ type: 'attuned' as const, id: WIELDER, item }]),
    ...(pool.max - left === 0
      ? []
      : [{ type: 'resource-spent' as const, id: WIELDER, key: pool.key, amount: pool.max - left }]),
  ];
};

const fireball = (log: readonly GameEvent[], rng: Rng, charges?: number) =>
  resolveSpell(
    fold('seed', log),
    WIELDER,
    {
      spellId: 'fireball',
      targets: [],
      // A hundred and forty feet south of everybody, so nobody is caught.
      at: { x: 100, y: 240, z: 0 },
      item: FIREBALLS,
      ...(charges === undefined ? {} : { charges }),
    },
    supply(fold('seed', log), rng),
  );

const lastChargeRolls = (events: readonly GameEvent[], name: string) =>
  events.filter(
    (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
      event.type === 'roll-recorded' && event.label.startsWith(`${name}'s last charge`),
  );

const owns = (log: readonly GameEvent[], item: string): boolean =>
  fold('seed', log).creatures[WIELDER]!.inventory.some((line) => line.id === item);

const holds = (log: readonly GameEvent[], item: string): boolean =>
  fold('seed', log).creatures[WIELDER]!.equipped.some((worn) => worn.id === item);

// — the casting route ——————————————————————————————————————————————————————

describe('the last charge of a wand that casts', () => {
  it('on a 1, the wand crumbles: gone from the pack and from the hand, and the spell is still cast', () => {
    const log = holding(FIREBALLS, 1);
    const out = unwrap(fireball(log, scripted([1])), 'the last Fireball');

    const [die] = lastChargeRolls(out.events, 'Wand of Fireballs');
    expect(die?.natural).toBe(1);
    expect(out.castingId).not.toBeNull();
    expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);

    const after = [...log, ...out.events];
    expect(owns(after, FIREBALLS)).toBe(false);
    expect(holds(after, FIREBALLS)).toBe(false);

    // The loss names the copy, by the Wind Fan's road.
    const lost = out.events.find((event) => event.type === 'items-lost');
    expect(lost).toMatchObject({
      type: 'items-lost',
      id: WIELDER,
      items: [{ id: FIREBALLS, quantity: 1, instance: copyOf(log, FIREBALLS) }],
    });
    // And the die was issued, so a replay reads it rather than throwing it.
    expect(out.events.some((event) => event.type === 'rolls-issued')).toBe(true);
  });

  it('on a 2, the wand stays in hand at no charges, and a declared dawn refills it', () => {
    const log = holding(FIREBALLS, 1);
    const out = unwrap(fireball(log, scripted([2])), 'the last Fireball');
    expect(lastChargeRolls(out.events, 'Wand of Fireballs')[0]?.natural).toBe(2);
    expect(out.events.some((event) => event.type === 'items-lost')).toBe(false);

    const after = [...log, ...out.events];
    expect(owns(after, FIREBALLS)).toBe(true);
    expect(holds(after, FIREBALLS)).toBe(true);
    expect(chargesLeft(fold('seed', after), SRD_CONTENT, WIELDER, FIREBALLS)).toBe(0);

    // And empty is a refusal rather than a free Fireball.
    const dry = fireball(after, scripted([2]));
    expect(isErr(dry) && dry.code).toBe('exhausted');

    const dawn = run(after, (s) => declareDawn(s, supply(s)));
    expect(chargesLeft(fold('seed', dawn), SRD_CONTENT, WIELDER, FIREBALLS)).toBeGreaterThan(0);
  });

  it('throws nothing for a spend that leaves a charge behind', () => {
    const log = holding(FIREBALLS, 2);
    const out = unwrap(fireball(log, scripted([1])), 'a Fireball with one to spare');
    expect(lastChargeRolls(out.events, 'Wand of Fireballs')).toEqual([]);
    expect(owns([...log, ...out.events], FIREBALLS)).toBe(true);
  });

  it('is the spend that empties the pool, however many charges it takes', () => {
    // Three at once out of three left is the last charge too.
    const log = holding(FIREBALLS, 3);
    const out = unwrap(fireball(log, scripted([1]), 3), 'a level 5 Fireball');
    expect(lastChargeRolls(out.events, 'Wand of Fireballs')).toHaveLength(1);
    expect(owns([...log, ...out.events], FIREBALLS)).toBe(false);
  });

  it('costs nothing and throws nothing when the casting is refused', () => {
    const log = holding(FIREBALLS, 1);
    const refused = fireball(log, scripted([1]), 4);
    expect(isErr(refused) && refused.code).toBe('bad_charges');
  });
});

// — a conferral paid for in charges ———————————————————————————————————————

const paralyse = (log: readonly GameEvent[], rng?: Rng, flat?: number) =>
  useItem(
    fold('seed', log),
    WIELDER,
    { item: PARALYSIS, target: GOBLIN },
    supply(fold('seed', log), rng, SRD_CONTENT, flat),
  );

describe('the last charge of a wand that confers', () => {
  it('on a 1, the Wand of Paralysis crumbles after its ray has gone', () => {
    const log = holding(PARALYSIS, 1);
    const out = unwrap(paralyse(log, scripted([1])), 'the last ray');
    expect(lastChargeRolls(out.events, 'Wand of Paralysis')[0]?.natural).toBe(1);

    const after = [...log, ...out.events];
    expect(owns(after, PARALYSIS)).toBe(false);
    expect(holds(after, PARALYSIS)).toBe(false);
    // The goblin rolled a 1 as well, and the ray still landed.
    expect(fold('seed', after).creatures[GOBLIN]!.conditions.conditions).toContain('paralyzed');
  });

  it('on a 2, it stays at no charges', () => {
    const log = holding(PARALYSIS, 1);
    const out = unwrap(paralyse(log, scripted([2])), 'the last ray');
    const after = [...log, ...out.events];
    expect(owns(after, PARALYSIS)).toBe(true);
    expect(chargesLeft(fold('seed', after), SRD_CONTENT, WIELDER, PARALYSIS)).toBe(0);
  });

  it('throws nothing while charges remain', () => {
    const log = holding(PARALYSIS, 7);
    const out = unwrap(paralyse(log, scripted([1])), 'the first ray');
    expect(lastChargeRolls(out.events, 'Wand of Paralysis')).toEqual([]);
  });
});

// — a thing with no die ————————————————————————————————————————————————————

/**
 * SRD Chime of Opening's tenth strike, and a talisman's "When you expend the
 * last charge, the talisman ... is destroyed": no die, and gone. A homebrew
 * rod says it here so the SRD's Chime can move on its own track.
 */
const ASHEN_ROD: CatalogueItem = {
  id: 'rod-of-final-mending',
  name: 'Rod of Final Mending',
  kind: 'rod',
  weightLb: 2,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: 'rod-of-final-mending:charges',
      label: 'Rod of Final Mending charges',
      uses: 2,
      recovers: 'special',
      onLastCharge: { destroyed: 'always' },
    },
    {
      kind: 'confers',
      action: 'action',
      charges: 1,
      effects: [{ kind: 'heal', healing: { flat: 1 }, addSpellcastingModifier: false }],
    },
  ],
};

const ASHEN: Content = unwrap(extendContent(SRD_CONTENT, { items: [ASHEN_ROD] }), 'the rod');

describe('a last charge that always destroys', () => {
  it('throws no die and takes the rod', () => {
    const log = holding(ASHEN_ROD.id, 1, ASHEN);
    const state = fold('seed', log);
    const out = unwrap(
      useItem(state, WIELDER, { item: ASHEN_ROD.id }, supply(state, scripted([1]), ASHEN)),
      'the last mending',
    );
    expect(lastChargeRolls(out.events, ASHEN_ROD.name)).toEqual([]);
    expect(owns([...log, ...out.events], ASHEN_ROD.id)).toBe(false);
  });

  it('keeps the rod for every charge before the last', () => {
    const log = holding(ASHEN_ROD.id, 2, ASHEN);
    const state = fold('seed', log);
    const out = unwrap(
      useItem(state, WIELDER, { item: ASHEN_ROD.id }, supply(state, scripted([1]), ASHEN)),
      'the first mending',
    );
    expect(owns([...log, ...out.events], ASHEN_ROD.id)).toBe(true);
  });
});

/**
 * The rod's line hands one sentence to the table, and a use of the rod hands
 * it on under the mark — `useItem`'s half of the item handover door. Its
 * `unmodelled` is the owed residue and is not what goes out here.
 */
describe('a use hands over what the item leaves to the table', () => {
  const TOLD: CatalogueItem = {
    ...ASHEN_ROD,
    id: 'rod-of-told-mending',
    name: 'Rod of Told Mending',
    grants: [
      { ...(ASHEN_ROD.grants![0] as object), key: 'rod-of-told-mending:charges' } as NonNullable<
        CatalogueItem['grants']
      >[number],
      ASHEN_ROD.grants![1]!,
    ],
    dmDecides: ['The rod hums a note only its holder hears.'],
  };
  const TOLD_CONTENT: Content = unwrap(extendContent(SRD_CONTENT, { items: [TOLD] }), 'the rod');

  it('under the mark, in the book’s words', () => {
    const log = holding(TOLD.id, 2, TOLD_CONTENT);
    const state = fold('seed', log);
    const out = unwrap(
      useItem(state, WIELDER, { item: TOLD.id }, supply(state, undefined, TOLD_CONTENT)),
      'a mending',
    );
    expect(out.unverified).toEqual([
      'Rod of Told Mending: [the DM decides] The rod hums a note only its holder hears.',
    ]);
  });
});

// — what the validator refuses ————————————————————————————————————————————

describe('what a last charge may say', () => {
  const pool = ASHEN_ROD.grants![0]!;
  const codesOf = (grants: readonly unknown[]): readonly string[] =>
    checkContent({
      items: [{ ...ASHEN_ROD, id: 'trial-rod', grants } as unknown as CatalogueItem],
    }).map((problem) => `${problem.code} @ ${problem.field}`);
  const withLast = (onLastCharge: unknown) => [{ ...pool, onLastCharge }, ASHEN_ROD.grants![1]];

  it('admits a die and admits always', () => {
    expect(codesOf(withLast({ destroyed: true, onD20AtOrBelow: 1 }))).toEqual([]);
    expect(codesOf(withLast({ destroyed: 'always' }))).toEqual([]);
  });

  /**
   * The Wind Fan's `failure_costs_nothing` rule, one clause along: a last
   * charge that says nothing about what it costs is a better item than the
   * book prints.
   */
  it.each([[false], ['sometimes'], [undefined]])('refuses destroyed: %s', (destroyed) => {
    expect(codesOf(withLast({ destroyed, onD20AtOrBelow: 1 }))).toContain(
      'last_charge_costs_nothing @ items[trial-rod].grants[0].onLastCharge.destroyed',
    );
  });

  it.each([[0], [20], [1.5], ['1']])('refuses a d20 face of %s', (face) => {
    expect(codesOf(withLast({ destroyed: true, onD20AtOrBelow: face }))).toContain(
      'bad_last_charge_die @ items[trial-rod].grants[0].onLastCharge.onD20AtOrBelow',
    );
  });

  it('refuses a die beside always, and no die beside a roll', () => {
    expect(codesOf(withLast({ destroyed: 'always', onD20AtOrBelow: 1 }))).toContain(
      'bad_last_charge_die @ items[trial-rod].grants[0].onLastCharge.onD20AtOrBelow',
    );
    expect(codesOf(withLast({ destroyed: true }))).toContain(
      'bad_last_charge_die @ items[trial-rod].grants[0].onLastCharge.onD20AtOrBelow',
    );
  });

  it('refuses it written anywhere but the pool', () => {
    expect(
      codesOf([pool, { ...ASHEN_ROD.grants![1]!, onLastCharge: { destroyed: 'always' } }]),
    ).toContain('last_charge_without_a_pool @ items[trial-rod].grants[1].onLastCharge');
  });
});

// — a conferral that reaches ——————————————————————————————————————————————

describe('the Wand of Paralysis reaches sixty feet, at a creature its wielder can see', () => {
  const seen = (log: readonly GameEvent[], saw: boolean): readonly GameEvent[] => [
    ...log,
    { type: 'sight-declared', from: WIELDER, to: GOBLIN, seen: saw },
  ];
  const DOOMED = -40;

  it('paralyses a goblin sixty feet off', () => {
    const log = seen(holding(PARALYSIS, 7, SRD_CONTENT, 60), true);
    const out = unwrap(paralyse(log, undefined, DOOMED), 'the ray');
    const after = [...log, ...out.events];
    expect(fold('seed', after).creatures[GOBLIN]!.conditions.conditions).toContain('paralyzed');
    expect(chargesLeft(fold('seed', after), SRD_CONTENT, WIELDER, PARALYSIS)).toBe(6);
  });

  it('is refused at sixty-five feet, with nothing spent', () => {
    const log = seen(holding(PARALYSIS, 7, SRD_CONTENT, 65), true);
    const out = paralyse(log, undefined, DOOMED);
    expect(isErr(out) && out.code).toBe('out_of_reach');
    if (isErr(out)) expect(out.reason).toContain('60 feet');
  });

  it('is refused against a goblin its wielder cannot see', () => {
    const log = seen(holding(PARALYSIS, 7, SRD_CONTENT, 30), false);
    const out = paralyse(log, undefined, DOOMED);
    expect(isErr(out) && out.code).toBe('cannot_see_target');
  });

  it('the goblin repeats the save at the end of its own turn', () => {
    const log = seen(holding(PARALYSIS, 7, SRD_CONTENT, 60), true);
    const fight: readonly GameEvent[] = [
      ...log,
      {
        type: 'combat-started',
        combatants: [
          { id: WIELDER, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 10, speed: 30 },
        ],
      },
    ];
    const struck = run(fight, (s) =>
      useItem(s, WIELDER, { item: PARALYSIS, target: GOBLIN }, supply(s, undefined, SRD_CONTENT, DOOMED)),
    );
    const key = timerKey({
      kind: 'condition',
      on: GOBLIN,
      instance: conditionInstanceId('paralyzed', itemSource(PARALYSIS)),
    });
    expect(fold('seed', struck).timers[key]?.repeatSave).toMatchObject({
      at: 'end-of-turn',
      dc: 15,
    });

    // The wielder's turn ends, then the goblin's — and its end owes the save.
    const wielderDone = run(struck, (s) => resolveTurn(s, supply(s)));
    const state = fold('seed', wielderDone);
    const goblinDone = unwrap(resolveTurn(state, supply(state, undefined, SRD_CONTENT, 40)), 'turn');
    expect(goblinDone.saves).toHaveLength(1);
    expect(goblinDone.saves[0]).toMatchObject({ target: GOBLIN, ability: 'con', dc: 15, success: true });
    expect(
      fold('seed', [...wielderDone, ...goblinDone.events]).creatures[GOBLIN]!.conditions.conditions,
    ).not.toContain('paralyzed');
  });
});

describe('what a reach may say', () => {
  const RAY: CatalogueItem = {
    ...ASHEN_ROD,
    id: 'trial-ray',
    grants: [
      ASHEN_ROD.grants![0]!,
      {
        kind: 'confers',
        action: 'action',
        charges: 1,
        reach: 30,
        effects: [{ kind: 'heal', healing: { flat: 1 }, addSpellcastingModifier: false }],
      },
    ],
  };
  const codesOf = (conferral: Record<string, unknown>): readonly string[] =>
    checkContent({
      items: [
        { ...RAY, grants: [RAY.grants![0], { ...RAY.grants![1], ...conferral }] } as unknown as CatalogueItem,
      ],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  it('admits a whole number of feet', () => {
    expect(codesOf({})).toEqual([]);
  });

  it.each([[0], [-5], [7.5], ['60']])('refuses a reach of %s', (reach) => {
    expect(codesOf({ reach })).toContain('bad_conferral_reach @ items[trial-ray].grants[1].reach');
  });

  /**
   * SRD Cloak of Invisibility's effect is its wearer's and nobody else's —
   * `useItem` lands it on the user — so a reach there is a distance nothing
   * could ever be measured across.
   */
  it('refuses a reach on a conferral that lands on its wearer alone', () => {
    const cloak = SRD_CONTENT.item('cloak-of-invisibility')!;
    const problems = checkContent({
      items: [
        {
          ...cloak,
          id: 'trial-cloak',
          grants: (cloak.grants ?? []).map((grant) =>
            grant.kind === 'confers' ? { ...grant, reach: 30 } : grant,
          ),
        } as CatalogueItem,
      ],
    }).map((problem) => problem.code);
    expect(problems).toContain('conferral_reach_on_self_only');
  });

  it('leaves a potion at five feet, as it always was', () => {
    const state = fold('seed', [
      added(WIELDER, 'party'),
      added(GOBLIN, 'hostile'),
      ...room(10),
      { type: 'items-gained', id: WIELDER, items: [{ id: 'potion-of-healing', quantity: 1 }], source: 'x' },
    ]);
    const out = useItem(state, WIELDER, { item: 'potion-of-healing', target: GOBLIN }, supply(state));
    expect(isOk(out)).toBe(false);
    expect(isErr(out) && out.code).toBe('out_of_reach');
  });
});
