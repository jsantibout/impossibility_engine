import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { itemChargePool } from './catalogue.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import {
  chargesLeft,
  equipItem,
  expendCharges,
  loseItems,
  purchaseItem,
  resolveSpell,
  unequipItem,
  useItem,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * An item's own record: what tells two copies of one thing apart.
 *
 * `InventoryLine` was a catalogue id and a count, so two Wands of Secrets were
 * one line of two and their charges were one pool between them — spend from
 * either and both were emptier, and a wand handed over would have left its
 * charges behind. The line now carries an optional `instance`, issued by the
 * command from a counter on `GameState` and **verified** by the fold exactly
 * as a casting id is: no generator, no randomness, and the id a function of
 * the log's own position.
 *
 * Three claims hold this file together:
 *
 * - **Only what has state of its own is labelled.** A charge pool is the only
 *   per-copy state an item has today, so a wand is born with an identity and
 *   twenty arrows are still twenty arrows on one line.
 * - **The pool is keyed by the copy and declared when the copy is gained**,
 *   not when it is equipped — which is what lets a wand be put down, picked
 *   back up, and found exactly as spent as it was.
 * - **The presence of `instance` on the emitted line is the pinned decision.**
 *   The command read the catalogue; the fold reads the event, and never asks
 *   what kind of thing the line names.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');

/** 3 charges, no attunement, and "regains 1d3 expended charges daily at dawn". */
const WAND = 'wand-of-secrets';

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, str: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: {
    'human:versatile': { featId: 'alert' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const hoard = (itemId: string, quantity: number): CharacterChoices['dmGrants'] => ({
  items: [{ id: itemId, quantity }],
  goldPieces: 0,
  magicItems: [itemId],
  note: 'found in the barrow',
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);
const grum = (log: readonly GameEvent[]) => state(log).creatures.grum!;
const lines = (log: readonly GameEvent[], itemId: string) =>
  grum(log).inventory.filter((line) => line.id === itemId);

/** Two wands in the pack, which is the log every test below starts from. */
const withTwoWands = (): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, barbarian({ dmGrants: hoard(WAND, 2) }), GRUM), 'create');

describe('two copies of a charged item are two records', () => {
  it('are two lines of one, each with an identity of its own', () => {
    const owned = lines(withTwoWands(), WAND);
    expect(owned.map((line) => line.quantity)).toEqual([1, 1]);
    expect(owned.map((line) => line.instance)).toEqual(['item:1', 'item:2']);
    expect(state(withTwoWands()).itemsIssued).toBe(2);
  });

  it('are two pools, keyed by the copy and declared when it was gained', () => {
    const log = withTwoWands();
    const declared = log.filter(
      (e) => e.type === 'resource-pool-declared' && e.pool.key.startsWith(`${WAND}:charges`),
    );
    expect(declared).toHaveLength(2);
    // The key is the one content wrote, suffixed by the engine — content
    // declares `${id}:charges` and knows nothing about copies.
    expect(Object.keys(grum(log).resources.pools)).toEqual(
      expect.arrayContaining([`${WAND}:charges@item:1`, `${WAND}:charges@item:2`]),
    );
  });

  it('spends from the copy in hand and leaves the other full', () => {
    let log = run(withTwoWands(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, 'item:1', 2));
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(1);
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:2')).toBe(3);
  });

  /**
   * The charges-survive-the-equip-cycle test, which was impossible before an
   * item had a record: the pool arrived with the equip event, so putting a
   * wand down and picking it up was the only way to look at the seam.
   */
  it('finds a wand put down and picked back up exactly as spent as it was', () => {
    let log = run(withTwoWands(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, 'item:1', 2));
    log = run(log, (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(1);

    log = run(log, (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(1);
    // And picking up the *other* one finds the other one's charges.
    log = run(log, (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    log = run(log, (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:2'));
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:2')).toBe(3);
  });

  it('refuses to guess which copy, and names them', () => {
    const out = equipItem(state(withTwoWands()), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('ambiguous_copy');
    expect(isErr(out) && out.reason).toMatch(/item:1/);
  });

  it('is what the equip event pinned, so the fold opens no catalogue', () => {
    const log = run(withTwoWands(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:2'));
    expect(grum(log).equipped).toEqual([{ id: WAND, armor: null, instance: 'item:2' }]);
    expect(fold('seed', log)).toStrictEqual(fold('seed', log, SRD_CONTENT));
  });
});

describe('the ids are a function of the log, and the fold checks them', () => {
  const claiming = (instance: string): readonly GameEvent[] => [
    ...unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create'),
    { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 1, instance }], source: 'x' },
  ];

  it('refuses a line that claims an id out of sequence', () => {
    expect(() => fold('seed', claiming('item:7'))).toThrow(CorruptLogError);
    expect(() => fold('seed', claiming('item:7'))).toThrow(/item:1/);
  });

  it('accepts the one the counter says, and counts it', () => {
    expect(state(claiming('item:1')).itemsIssued).toBe(1);
  });

  it('refuses an identified copy that claims to be several', () => {
    const log: readonly GameEvent[] = [
      ...unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create'),
      {
        type: 'items-gained',
        id: GRUM,
        items: [{ id: WAND, quantity: 2, instance: 'item:1' }],
        source: 'x',
      },
    ];
    expect(() => fold('seed', log)).toThrow(/one copy/);
  });
});

describe('a stack of ordinary things is the stack it always was', () => {
  it('is one line, a count, and no identity issued', () => {
    const log = unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create');
    const arrows = lines(log, 'arrows');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.instance).toBeUndefined();
    expect(arrows[0]!.quantity).toBeGreaterThan(1);
    expect(state(log).itemsIssued).toBe(0);
  });
});

describe('homebrew reaches the same record through the same door', () => {
  /** A charged item somebody can actually buy, which the SRD prints none of. */
  const SHOP: Content = unwrap(
    extendContent(SRD_CONTENT, {
      items: [
        {
          id: 'test-taper',
          name: 'Taper of Small Lights',
          kind: 'wondrous',
          weightLb: 1,
          costCp: 100,
          armor: null,
          weapon: null,
          contents: [],
          grants: [{ kind: 'pool', key: 'test-taper:charges', uses: 2, recovers: 'dawn' }],
        } as unknown as CatalogueItem,
      ],
    }),
    'homebrew',
  );

  const rich = (): readonly GameEvent[] => [
    ...unwrap(createCharacter(SHOP, barbarian(), GRUM), 'create'),
    { type: 'coins-changed', id: GRUM, copper: 1000, source: 'the purse' },
  ];

  it('buys two and gets two records, with the key content wrote suffixed', () => {
    const log = run(rich(), (s) => purchaseItem(s, SHOP, GRUM, 'test-taper', 2));
    expect(lines(log, 'test-taper').map((line) => line.instance)).toEqual(['item:1', 'item:2']);
    expect(Object.keys(grum(log).resources.pools)).toEqual(
      expect.arrayContaining(['test-taper:charges@item:1', 'test-taper:charges@item:2']),
    );
    // The key the engine suffixed is the key the item declared.
    expect(itemChargePool(SHOP.item('test-taper')!)!.key).toBe('test-taper:charges');
  });

  it('issues nothing a second time for a retried purchase', () => {
    const first = run(rich(), (s) => purchaseItem(s, SHOP, GRUM, 'test-taper', 1, 'one-taper'));
    const again = unwrap(
      purchaseItem(state(first), SHOP, GRUM, 'test-taper', 1, 'one-taper'),
      'retry',
    );
    expect(again).toEqual([]);
    expect(state(first).itemsIssued).toBe(1);
    expect(fold('seed', [...first, ...again]).itemsIssued).toBe(1);
  });
});

describe('everything that spends a charge spends the held copy’s', () => {
  /** SRD Wand of Magic Detection: 3 charges, no bracket, casts Detect Magic. */
  const DETECTOR = 'wand-of-magic-detection';

  const withTwoDetectors = (): readonly GameEvent[] =>
    unwrap(
      createCharacter(SRD_CONTENT, barbarian({ dmGrants: hoard(DETECTOR, 2) }), GRUM),
      'create',
    );

  it('casts from the wand in hand and leaves the other one full', () => {
    const log = run(withTwoDetectors(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:2'));
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        GRUM,
        { spellId: 'detect-magic', targets: [], item: DETECTOR },
        { issuer: createRollIssuer('r'), rng: createRng('wand') as Rng, content: SRD_CONTENT },
      ),
      'the wand casting Detect Magic',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(chargesLeft(after, SRD_CONTENT, GRUM, 'item:2')).toBe(2);
    expect(chargesLeft(after, SRD_CONTENT, GRUM, 'item:1')).toBe(3);
  });
});

describe('a copy that leaves is the copy that leaves', () => {
  it('takes the one named and leaves the other owned', () => {
    const log = run(withTwoWands(), (s) =>
      loseItems(s, GRUM, [{ id: WAND, quantity: 1, instance: 'item:1' }], 'left in the grease'),
    );
    expect(lines(log, WAND).map((line) => line.instance)).toEqual(['item:2']);
  });

  it('refuses to guess which copy was lost', () => {
    const out = loseItems(state(withTwoWands()), GRUM, [{ id: WAND, quantity: 1 }], 'the thief');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('ambiguous_copy');
  });

  /**
   * The other door a copy leaves by, and the one that would have failed
   * silently: `useItem` writes its own `items-lost` for a thing used up, and
   * a loss that named only the kind of thing would have removed nothing at
   * all — leaving the flask in the pack with its benefit already running.
   */
  it('uses up the copy that was used', () => {
    const FLASK = 'test-flask';
    const content: Content = unwrap(
      extendContent(SRD_CONTENT, {
        items: [
          {
            id: FLASK,
            name: 'Flask of Small Mercies',
            kind: 'potion',
            weightLb: 0.5,
            costCp: 100,
            armor: null,
            weapon: null,
            contents: [],
            grants: [
              { kind: 'pool', key: `${FLASK}:charges`, uses: 2, recovers: 'dawn' },
              {
                kind: 'confers',
                action: 'bonus-action',
                effects: [{ kind: 'heal', healing: { flat: 1 }, addSpellcastingModifier: false }],
              },
            ],
          } as unknown as CatalogueItem,
        ],
      }),
      'homebrew',
    );
    const bought = run(
      [
        ...unwrap(createCharacter(content, barbarian(), GRUM), 'create'),
        { type: 'coins-changed', id: GRUM, copper: 1000, source: 'the purse' },
      ],
      (s) => purchaseItem(s, content, GRUM, FLASK, 1),
    );
    expect(lines(bought, FLASK).map((line) => line.instance)).toEqual(['item:1']);

    const used = unwrap(
      useItem(state(bought), GRUM, { item: FLASK }, {
        issuer: createRollIssuer('r'),
        rng: createRng('flask') as Rng,
        content,
      }),
      'drinking it',
    );
    expect(lines([...bought, ...used.events], FLASK)).toEqual([]);
  });

  it('takes the only copy there is without being told its id', () => {
    const one = unwrap(
      createCharacter(SRD_CONTENT, barbarian({ dmGrants: hoard(WAND, 1) }), GRUM),
      'create',
    );
    const log = run(one, (s) => loseItems(s, GRUM, [{ id: WAND, quantity: 1 }], 'the thief'));
    expect(lines(log, WAND)).toEqual([]);
  });
});

describe('an unlabelled copy is the stack it has always been', () => {
  /**
   * A log that names no copy is a log written before copies had names — or one
   * written by hand, which is the only door left that can write one. The fold
   * reads it exactly as it always did, and the pool it uses is the
   * catalogue-keyed one the equip event has always declared.
   */
  it('folds as it did, with the pool the equip event declares', () => {
    const owned: readonly GameEvent[] = [
      ...unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create'),
      { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 1 }], source: 'by hand' },
    ];
    const log = run(owned, (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(state(log).itemsIssued).toBe(0);
    expect(Object.keys(grum(log).resources.pools)).toContain(`${WAND}:charges`);
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, WAND)).toBe(3);
  });
});
