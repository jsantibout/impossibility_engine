import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { itemSource } from './catalogue.js';
import { type Content, loadContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import type { CharacterSheet } from './character.js';
import { chargesLeft, damageCreature, equipItem, useItem } from './commands.js';

/**
 * A conferral paid for with the item's own charges.
 *
 * SRD prints two prices for a thing an item does without casting a spell. A
 * Potion is **used up** — "Once used, a potion takes effect immediately, and
 * it is used up" — and that is every conferral the engine had until now. A
 * staff or a rod is **spent**: the item's line prints a charge count and the
 * object survives, which is the other half of the same sentence and the half
 * `conferral_charges_unread` refused in as many words.
 *
 * **One spender, not a second copy of it.** What a priced conferral pays with
 * is `expendCharges` — the command that already owns the economy: "while
 * holding it", the attunement the line asks for, a pool that was declared, and
 * running out as a rules-legal refusal. `useItem` asks it for the events and
 * puts them in its own batch, exactly as a casting from an item puts its
 * charge inside the casting's batch rather than in a command before it.
 *
 * **The item is used up or it is spent, never both.** The two are one fork:
 * an item that names a price keeps its `items-lost` unspent and takes the
 * charge instead, and an item that names none is the bottle it has always
 * been. Which also settles where the item has to be — a bottle is drunk out of
 * a pack and `useItem` refuses one still in hand, while a rod's charges are
 * spent "while holding it" and `expendCharges` refuses one that is not.
 *
 * Every item here is homebrew and every one arrives as JSON text, because no
 * SRD item this catalogue has transcribed prices a conferral: the entry that
 * would — Staff of Striking — needs its `1d6` to grow with the count spent,
 * and nothing in the vocabulary scales dice by anything but a slot level. The
 * charge accounting is what this file holds; the dice it buys are flat, and
 * that flatness is the gap rather than an oversight.
 */

const id = (s: string) => asCharacterId(s);
const HOLDER = id('holder');
const FRIEND = id('friend');

const ROD = 'rod-of-small-mending';
const STAFF = 'staff-of-lesser-warding';
const HEALING = 'potion-of-healing';

/** A rod that mends for one charge out of three, and is not drunk. */
const ROD_JSON = JSON.stringify({
  id: ROD,
  name: 'Rod of Small Mending',
  kind: 'rod',
  weightLb: 2,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: 'rod-of-small-mending:charges',
      label: 'Rod of Small Mending charges',
      uses: 3,
      recovers: 'dawn',
    },
    {
      kind: 'confers',
      action: 'action',
      charges: 1,
      effects: [{ kind: 'heal', healing: { dice: '1d4', flat: 1 }, addSpellcastingModifier: false }],
    },
  ],
});

/**
 * A staff whose line lets the user choose, on the pattern the Wand of
 * Fireballs already prints over a casting: a cost and a maximum above it.
 *
 * **What the count buys is the same four points however many go**, because
 * there is no field that says otherwise. SRD Staff of Striking buys "an extra
 * 1d6 Force damage" *per charge*, and `attack-rider` carries a bare notation
 * while every `DiceScaling` field reads a slot or a caster level a conferral
 * has neither of. So the choice is real and the accounting is real, and the
 * scaling is the thing this brief stopped at.
 */
const STAFF_JSON = JSON.stringify({
  id: STAFF,
  name: 'Staff of Lesser Warding',
  kind: 'staff',
  weightLb: 4,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'pool',
      key: 'staff-of-lesser-warding:charges',
      label: 'Staff of Lesser Warding charges',
      uses: 4,
      recovers: 'dawn',
    },
    {
      kind: 'confers',
      action: 'action',
      charges: 1,
      upToCharges: 3,
      effects: [{ kind: 'temp-hp', amount: { flat: 4 }, addSpellcastingModifier: false }],
    },
  ],
});

const CONTENT: Content = unwrap(
  loadContent({ items: [JSON.parse(ROD_JSON), JSON.parse(STAFF_JSON)] }),
  'load',
);

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SCENE: readonly GameEvent[] = [
  added(HOLDER),
  added(FRIEND),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the table', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: HOLDER, placement: { from: { landmark: 'the table' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FRIEND,
    placement: { from: { creature: HOLDER }, feet: 5, bearing: 90 },
  },
];

const supply = (seed = 'rod', content: Content = CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), 'command'))];

/** Owned, and then in hand — which is what declares the pool. */
const holding = (itemId: string, content: Content = CONTENT): readonly GameEvent[] => {
  const owned: readonly GameEvent[] = [
    ...SCENE,
    { type: 'items-gained', id: HOLDER, items: [{ id: itemId, quantity: 1 }], source: 'the hoard' },
  ];
  return run(owned, (s) => equipItem(s, content, HOLDER, itemId));
};

const hurt = (log: readonly GameEvent[], who: CharacterId, amount: number): readonly GameEvent[] => [
  ...log,
  ...unwrap(damageCreature(fold('seed', log), who, { amount, source: 'a spear' }), 'hurt'),
];

describe('a rod that mends for a charge', () => {
  const wounded = hurt(holding(ROD), HOLDER, 20);

  it('spends exactly one charge out of the item’s own pool', () => {
    const before = chargesLeft(fold('seed', wounded), CONTENT, HOLDER, ROD);
    expect(before).toBe(3);

    const out = unwrap(useItem(fold('seed', wounded), HOLDER, { item: ROD }, supply()), 'use');
    const spent = out.events.filter((e) => e.type === 'resource-spent');
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ key: 'rod-of-small-mending:charges', amount: 1 });

    const after = fold('seed', [...wounded, ...out.events]);
    expect(chargesLeft(after, CONTENT, HOLDER, ROD)).toBe(2);
  });

  /** The effects resolve exactly as an unpriced conferral's do. */
  it('heals what its line prints, with the engine’s own die', () => {
    const out = unwrap(useItem(fold('seed', wounded), HOLDER, { item: ROD }, supply()), 'use');
    const healed = out.events.find((e) => e.type === 'roll-recorded');
    expect(healed?.label).toBe('Rod of Small Mending healing');
    expect(healed!.total).toBeGreaterThanOrEqual(2);
    expect(healed!.total).toBeLessThanOrEqual(5);

    const after = fold('seed', [...wounded, ...out.events]);
    expect(after.creatures['holder']!.vitals.hp).toBe(20 + healed!.total);
  });

  /**
   * **Spent, not used up.** The rod is still in the pack and still in hand;
   * what it cost came out of the pool instead.
   */
  it('keeps the rod, which is the half a charge buys', () => {
    const out = unwrap(useItem(fold('seed', wounded), HOLDER, { item: ROD }, supply()), 'use');
    expect(out.events.some((e) => e.type === 'items-lost')).toBe(false);

    const after = fold('seed', [...wounded, ...out.events]);
    expect(after.creatures['holder']!.inventory).toEqual([{ id: ROD, quantity: 1 }]);
    expect(after.creatures['holder']!.equipped.map((held) => held.id)).toEqual([ROD]);
  });

  /** And it can be used again for as long as the pool holds out. */
  it('is used three times and then is empty', () => {
    let log = wounded;
    for (const seed of ['one', 'two', 'three']) {
      log = run(log, (s) => useItem(s, HOLDER, { item: ROD }, supply(seed)));
    }
    expect(chargesLeft(fold('seed', log), CONTENT, HOLDER, ROD)).toBe(0);

    const out = useItem(fold('seed', log), HOLDER, { item: ROD }, supply('four'));
    expect(isErr(out) ? out.code : 'ok').toBe('exhausted');
  });

  /**
   * **A refusal costs nothing**: no charge, no die, no effect, and the item
   * exactly where it was.
   */
  it('refuses an empty pool with nothing spent and no effect resolved', () => {
    let log = wounded;
    for (const seed of ['one', 'two', 'three']) {
      log = run(log, (s) => useItem(s, HOLDER, { item: ROD }, supply(seed)));
    }
    const before = fold('seed', log);
    const hp = before.creatures['holder']!.vitals.hp;

    const issuer = createRollIssuer('r');
    const out = useItem(before, HOLDER, { item: ROD }, { ...supply('four'), issuer });
    expect(isErr(out) ? out.code : 'ok').toBe('exhausted');
    expect(issuer.count).toBe(0);
    expect(fold('seed', log).creatures['holder']!.vitals.hp).toBe(hp);
    expect(chargesLeft(fold('seed', log), CONTENT, HOLDER, ROD)).toBe(0);
    expect(fold('seed', log).creatures['holder']!.inventory).toEqual([{ id: ROD, quantity: 1 }]);
  });

  /**
   * SRD writes "while holding it" on every charged item in the book, and a
   * conferral that costs charges is the other side of the fork from a bottle
   * `useItem` refuses while it is still in hand.
   */
  it('refuses a rod nobody is holding', () => {
    const packed: readonly GameEvent[] = [
      ...SCENE,
      { type: 'items-gained', id: HOLDER, items: [{ id: ROD, quantity: 1 }], source: 'the hoard' },
    ];
    const out = useItem(fold('seed', packed), HOLDER, { item: ROD }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_equipped');
  });

  /** SRD: "administer it to another creature within 5 feet of yourself." */
  it('mends somebody else out of the holder’s charges', () => {
    const log = hurt(holding(ROD), FRIEND, 15);
    const out = unwrap(
      useItem(fold('seed', log), HOLDER, { item: ROD, target: FRIEND }, supply()),
      'mend',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures['friend']!.vitals.hp).toBeGreaterThan(25);
    expect(chargesLeft(after, CONTENT, HOLDER, ROD)).toBe(2);
    expect(chargesLeft(after, CONTENT, FRIEND, ROD)).toBe(0);
  });

  /** Rule 5: what the command read is pinned, so the fold opens no catalogue. */
  it('folds the same with the catalogue and without it', () => {
    const used = run(wounded, (s) => useItem(s, HOLDER, { item: ROD }, supply()));
    expect(fold('seed', used)).toStrictEqual(fold('seed', used, CONTENT));
  });

  /** The stamp has to ride something, or a retry would spend a second charge. */
  it('does the work once and reports nothing the second time', () => {
    const first = unwrap(
      useItem(fold('seed', wounded), HOLDER, { item: ROD, commandId: 'mend-1' }, supply()),
      'first',
    );
    const after = fold('seed', [...wounded, ...first.events]);
    expect(chargesLeft(after, CONTENT, HOLDER, ROD)).toBe(2);

    const retry = unwrap(
      useItem(after, HOLDER, { item: ROD, commandId: 'mend-1' }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...wounded, ...first.events, ...retry.events])).toEqual(after);
  });

  /** And one id may not be recycled for a different count. */
  it('refuses one id used for a different number of charges', () => {
    const first = unwrap(
      useItem(fold('seed', wounded), HOLDER, { item: ROD, commandId: 'mend-1' }, supply()),
      'first',
    );
    const after = fold('seed', [...wounded, ...first.events]);
    const again = useItem(after, HOLDER, { item: ROD, charges: 1, commandId: 'mend-1' }, supply());
    expect(isErr(again) ? again.code : 'ok').toBe('command_id_reused');
  });
});

describe('a staff whose line lets the user choose how many', () => {
  const held = holding(STAFF);

  const ward = (charges: number | undefined, seed = 'ward') =>
    useItem(
      fold('seed', held),
      HOLDER,
      charges === undefined ? { item: STAFF } : { item: STAFF, charges },
      supply(seed),
    );

  it('spends the count the user chose', () => {
    const out = unwrap(ward(3), 'ward');
    expect(out.events.filter((e) => e.type === 'resource-spent')[0]).toMatchObject({
      key: 'staff-of-lesser-warding:charges',
      amount: 3,
    });
    expect(chargesLeft(fold('seed', [...held, ...out.events]), CONTENT, HOLDER, STAFF)).toBe(1);
  });

  /** Absent is the cost the line prints, which is the bottom of the range. */
  it('spends the printed cost when the user names nothing', () => {
    const out = unwrap(ward(undefined), 'ward');
    expect(out.events.filter((e) => e.type === 'resource-spent')[0]).toMatchObject({ amount: 1 });
  });

  it('refuses a count above the maximum the line prints', () => {
    const out = ward(4);
    expect(isErr(out) ? out.code : 'ok').toBe('bad_charges');
    expect(isErr(out) ? out.reason : '').toContain('1 to 3');
  });

  it('refuses a count below the cost, and one that is not a whole number', () => {
    expect(isErr(ward(0)) ? (ward(0) as { code: string }).code : 'ok').toBe('bad_charges');
    expect(isErr(ward(1.5)) ? (ward(1.5) as { code: string }).code : 'ok').toBe('bad_charges');
  });

  /**
   * A count inside the range and above what is left is the pool's refusal
   * rather than the line's, and it is still free.
   */
  it('refuses a count above what the pool holds, with nothing spent', () => {
    const twice = run(held, (s) => useItem(s, HOLDER, { item: STAFF, charges: 3 }, supply('a')));
    expect(chargesLeft(fold('seed', twice), CONTENT, HOLDER, STAFF)).toBe(1);

    const issuer = createRollIssuer('r');
    const out = useItem(
      fold('seed', twice),
      HOLDER,
      { item: STAFF, charges: 2 },
      { ...supply('b'), issuer },
    );
    expect(isErr(out) ? out.code : 'ok').toBe('exhausted');
    expect(issuer.count).toBe(0);
    expect(chargesLeft(fold('seed', twice), CONTENT, HOLDER, STAFF)).toBe(1);
  });

  /** The effects still land, whatever the count — see the fixture's note. */
  it('confers what its line prints', () => {
    const out = unwrap(ward(2), 'ward');
    expect(fold('seed', [...held, ...out.events]).creatures['holder']!.vitals.temporaryHp).toBe(4);
  });
});

describe('a conferral that names no price is the potion it has always been', () => {
  const carried: readonly GameEvent[] = [
    ...SCENE,
    { type: 'items-gained', id: HOLDER, items: [{ id: HEALING, quantity: 1 }], source: 'the hoard' },
  ];
  const wounded = hurt(carried, HOLDER, 20);

  it('is used up, spends nothing and acquires no pool', () => {
    const out = unwrap(
      useItem(fold('seed', wounded), HOLDER, { item: HEALING }, supply('sip', SRD_CONTENT)),
      'sip',
    );
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(false);
    expect(out.events.find((e) => e.type === 'items-lost')?.items).toEqual([
      { id: HEALING, quantity: 1 },
    ]);

    const after = fold('seed', [...wounded, ...out.events]);
    expect(after.creatures['holder']!.inventory).toEqual([]);
    expect(after.creatures['holder']!.resources.pools).toEqual({});
    expect(after.creatures['holder']!.vitals.hp).toBeGreaterThan(20);
  });

  /**
   * A count named over an item that prices nothing is a caller who thinks
   * they said something, and every other stated fact on a use is refused
   * rather than ignored.
   */
  it('refuses a charge count over an item that costs none', () => {
    const out = useItem(
      fold('seed', wounded),
      HOLDER,
      { item: HEALING, charges: 1 },
      supply('sip', SRD_CONTENT),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('bad_charges');
  });
});

/** Rule 4: none of this is an engine change, and the source says so. */
describe('a charged item nobody wrote engine code for', () => {
  it('is loaded from JSON text and used through the public API', () => {
    expect(SRD_CONTENT.item(ROD)).toBeNull();
    expect(SRD_CONTENT.item(STAFF)).toBeNull();

    const log = hurt(holding(ROD), HOLDER, 10);
    const out = unwrap(useItem(fold('seed', log), HOLDER, { item: ROD }, supply()), 'use');
    const after = fold('seed', [...log, ...out.events]);

    expect(chargesLeft(after, CONTENT, HOLDER, ROD)).toBe(2);
    expect(after.creatures['holder']!.vitals.hp).toBeGreaterThan(30);
    // And the source the run filed anything under is the item's own.
    expect(itemSource(ROD)).toBe('item:rod-of-small-mending');
    // The log stands on its own, with the catalogue and without it.
    expect(fold('seed', [...log, ...out.events])).toStrictEqual(
      fold('seed', [...log, ...out.events], CONTENT),
    );
  });
});
