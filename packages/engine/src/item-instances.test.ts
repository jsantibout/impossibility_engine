import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type Result,
} from '@ie/shared';
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
// The two compilers a conjuring writes its line with. Not on the barrel,
// because nothing outside the engine conjures anything — the rule they share
// is the one this file is about, so they are reached where they live.
import { conjuredLine, featureConjuredLine } from './commands/inventory.js';
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

  /**
   * **A refusal and not a question**, which is a classification worth pinning
   * rather than leaving to be re-argued.
   *
   * `needs-context` is for a record that is *thin* — a fact the engine has
   * never been told, which some other command would declare. Nothing is thin
   * here: the engine knows exactly what is in the pack, and it is the request
   * that has two answers. `abilityForItem`'s `class_required` is the same
   * shape and the same subsystem — "used with your own spellcasting ability
   * and this creature has more than one; name one of …" — and it is a refusal
   * for the same reason. Nothing was spent either way, and the caller names a
   * copy and asks again.
   */
  it('refuses to guess which copy, and names them', () => {
    const out = equipItem(state(withTwoWands()), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('ambiguous_copy');
    expect(isErr(out) && out.reason).toMatch(/item:1/);
    expect(isNeedsContext(out)).toBe(false);
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

describe('a character joining a world that has issued records', () => {
  /**
   * Creation is a gain door, and the only one a charged item can come through
   * until a DM has a command for handing over what the party found: the SRD
   * prints no price for a magic item, so `purchaseItem` refuses it. So
   * `createCharacter` has to issue records — and it has no state of its own to
   * count from, which is what the fourth argument is.
   */
  const NYX = id('nyx');
  const elf = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
    barbarian({ name: 'Nyx', ...over });

  it('numbers its copies from where the world left off', () => {
    const first = withTwoWands();
    const second = unwrap(
      createCharacter(SRD_CONTENT, elf({ dmGrants: hoard(WAND, 1) }), NYX, state(first)),
      'create',
    );
    const world = fold('seed', [...first, ...second]);
    expect(world.creatures.nyx?.inventory.find((line) => line.id === WAND)?.instance).toBe(
      'item:3',
    );
    expect(world.itemsIssued).toBe(3);
    expect(Object.keys(world.creatures.nyx!.resources.pools)).toContain(
      `${WAND}:charges@item:3`,
    );
  });

  /**
   * And forgetting it is loud rather than quiet. The copies are numbered from
   * one — right for the empty world every other caller creates into — and the
   * fold refuses the id that is not next, which is the whole reason the fold
   * verifies rather than assigns.
   */
  it('is refused by the fold when the world is not the one it counted from', () => {
    const first = withTwoWands();
    const second = unwrap(
      createCharacter(SRD_CONTENT, elf({ dmGrants: hoard(WAND, 1) }), NYX),
      'create',
    );
    expect(() => fold('seed', [...first, ...second])).toThrow(CorruptLogError);
    expect(() => fold('seed', [...first, ...second])).toThrow(/expected item item:3, got item:1/);
  });

  /** Nothing charged, nothing issued: the argument is never needed for rope. */
  it('needs nothing of the argument for a character carrying no such thing', () => {
    const first = withTwoWands();
    const second = unwrap(createCharacter(SRD_CONTENT, elf(), NYX), 'create');
    expect(fold('seed', [...first, ...second]).itemsIssued).toBe(2);
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

  /**
   * And the fold refuses the loss the commands are careful not to write: one
   * that names the kind when every copy of it has a record, which would
   * remove nothing at all and say nothing about it.
   */
  it('refuses a hand-written loss that names no copy', () => {
    const log: readonly GameEvent[] = [
      ...withTwoWands(),
      { type: 'items-lost', id: GRUM, items: [{ id: WAND, quantity: 1 }], source: 'by hand' },
    ];
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
    expect(() => fold('seed', log)).toThrow(/has to name which/);
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

/**
 * The doors a copy can arrive through, pinned — and the trap sprung.
 *
 * This said two, and said what the third would have to do: "the way to make it
 * pass is to label what it hands over and delete the unlabelled declaration in
 * `equipItem` in the same commit". `awardItems` is the third, and it did both
 * — so the population is three, the branch is gone, and **there is one gain
 * semantics**: a copy with state of its own is labelled where it is gained and
 * its pool is declared beside it, at every door there is.
 *
 * The pin stays, in the idiom `invariants.test.ts` uses for event emitters,
 * because the claim it makes has not changed and a fourth door is as easy to
 * open quietly as the third was.
 */
describe('the doors a copy is gained through are the doors that label it', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));

  /**
   * `events.ts` declares the type and `fold/` consumes it; neither writes one,
   * and both are excluded by module rather than by regex for the reason the
   * event-emitter sweep gives: a population that includes the consumer is one
   * regex change away from calling a `case` label an emission.
   */
  const emitters = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => String(entry).split('\\').join('/'))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        file !== 'events.ts' &&
        !file.startsWith('fold/'),
    )
    .filter((file) => readFileSync(`${SRC}${file}`, 'utf8').includes("type: 'items-gained'"))
    .sort();

  /**
   * **A conjuring labels what it hands over too, through compilers of its
   * own**, which is why it is counted here rather than excused.
   *
   * It used to be excused, on the reading that a conjuring puts a *handful* in
   * a hand and a handful has no copy for an id to belong to. That is true of
   * SRD Goodberry's ten berries and false of the two things the book conjures
   * one of — SRD Flame Blade's blade and SRD Pact of the Blade's Longsword —
   * and the second of those arrives beside a Longsword somebody bought, which
   * `copyNamed` then refuses to tell apart. So `conjuredLine` and
   * `featureConjuredLine` name a single conjured thing out of `itemsIssued`,
   * exactly as a purchase does, and a handful stays the counted stack it has
   * always been, told apart by the casting it already names.
   *
   * The claim is therefore unchanged and slightly wider: **every copy with a
   * record is labelled where it is gained**, and the record now exists in one
   * more place than it did.
   *
   * **There are three conjuring emissions and they are in three files**, one of
   * which also labels through the other compiler: the casting's, in
   * `spell-resolution.ts`, the re-evocation's, in `inventory.ts` beside
   * `equipItem`'s, and the activation's, in `features.ts`. So the emissions are
   * counted per *call* rather than per file — a file-granular excuse would have
   * let `inventory.ts` sit in the labelling list on the strength of a compiler
   * it calls somewhere else, which is exactly the hole this sweep exists to
   * keep shut. The two compilers are the marker, because between them they are
   * the only spellings a conjuring writes.
   */
  const conjurings = (source: string): number =>
    (source.match(/items: \[(?:feature)?[cC]onjuredLine\(/g) ?? []).length;

  /** Every `items-gained` written in a file, however it is laid out. */
  const emissions = (source: string): number =>
    (source.match(/type: 'items-gained'/g) ?? []).length;

  it('is three of them, and every one labels what it buys, grants or packs', () => {
    const labelling = emitters.filter(
      (file) => emissions(readFileSync(`${SRC}${file}`, 'utf8')) > conjurings(readFileSync(`${SRC}${file}`, 'utf8')),
    );
    expect(labelling).toEqual([
      'commands/declarations.ts',
      'commands/inventory.ts',
      'creation.ts',
    ]);
  });

  /** And all of them label through the one compiler, rather than each deciding. */
  it('both label through the same compiler', () => {
    for (const file of emitters) {
      const source = readFileSync(`${SRC}${file}`, 'utf8');
      if (emissions(source) > conjurings(source)) expect(source).toContain('issueItemCopies');
    }
  });

  /**
   * And the emissions that label through the *other* compiler are pinned by
   * count, so a fourth cannot arrive quietly by sitting next to a conjuring —
   * and each of the three is made to hand the compiler the count the log has
   * issued, which is what makes the id the next one and the fold's check pass.
   */
  it('has three emissions that conjure, and each names what it makes from itemsIssued', () => {
    const conjured = emitters
      .map((file) => [file, conjurings(readFileSync(`${SRC}${file}`, 'utf8'))] as const)
      .filter(([, count]) => count > 0);
    expect(conjured).toEqual([
      ['commands/features.ts', 1],
      ['commands/inventory.ts', 1],
      ['commands/spell-resolution.ts', 1],
    ]);

    for (const [file] of conjured) {
      expect(readFileSync(`${SRC}${file}`, 'utf8')).toMatch(
        /items: \[(?:feature)?[cC]onjuredLine\(\s*state\.itemsIssued/,
      );
    }
  });
});

/**
 * And the rule the two conjuring compilers are written to, asked of them
 * directly: **a record is one copy**.
 *
 * The line a conjuring hands over is the one place in the engine where the
 * same call produces both answers, so the boundary is worth a test of its own
 * rather than only the two spells that happen to sit on either side of it.
 * `items-gained` throws on a labelled line of more than one, which is the
 * fold's half of the same sentence.
 */
describe('a conjuring names one thing and never a handful', () => {
  it('gives a single conjured thing the next record and a handful none', () => {
    const blade = conjuredLine(
      4,
      'flame-blade',
      { item: 'flame-blade', count: 1, hands: 1, retake: 'bonus-action' },
      'cast:2',
    );
    expect(blade.instance).toBe('item:5');
    expect(blade.casting).toBe('cast:2');

    // SRD Goodberry: ten berries in a hand are one line of ten, and one
    // record could not stand for them.
    const berries = conjuredLine(4, 'goodberry', { item: 'goodberry', count: 10, hands: 1 }, 'cast:2');
    expect(berries.instance).toBe(undefined);
    expect(berries.quantity).toBe(10);
  });

  /** And a weapon a feature conjures is always the one thing, so always named. */
  it('names what a feature conjures out of the same count', () => {
    const pact = featureConjuredLine(
      0,
      SRD_CONTENT.item('longsword')!,
      'warlock:eldritch-invocations',
    );
    expect(pact).toMatchObject({
      id: 'longsword',
      quantity: 1,
      feature: 'warlock:eldritch-invocations',
      instance: 'item:1',
    });
  });
});

describe('an unlabelled copy is the stack it has always been', () => {
  /**
   * A log that names no copy is a log written before copies had names — or one
   * written by hand, which is the only door left that can write one. The fold
   * reads it exactly as it always did: one line, no record, nothing issued.
   *
   * **What it no longer has is charges.** The equip used to declare a
   * catalogue-keyed pool for such a copy, which was two wands sharing one pool
   * and the second of the engine's two gain semantics; `awardItems` took its
   * place and the branch went in the same commit. So the wand is owned, worn
   * and empty, and the refusal names the door that fills it.
   */
  it('folds as it did, and has no charges nobody declared', () => {
    const owned: readonly GameEvent[] = [
      ...unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create'),
      { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 1 }], source: 'by hand' },
    ];
    const log = run(owned, (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(state(log).itemsIssued).toBe(0);
    expect(lines(log, WAND)).toEqual([{ id: WAND, quantity: 1 }]);
    expect(Object.keys(grum(log).resources.pools)).not.toContain(`${WAND}:charges`);
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, WAND)).toBe(0);
    const out = expendCharges(state(log), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out) && out.code).toBe('unknown_pool');
  });
});
