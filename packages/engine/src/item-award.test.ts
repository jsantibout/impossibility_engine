import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  awardItems,
  chargesLeft,
  equipItem,
  expendCharges,
  type Supply,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * The door a DM hands a party what it found, and the one gain semantics left
 * standing.
 *
 * Until this existed every fixture's found items were written by hand — an
 * `items-gained` assembled by a test, which is a line with no record — and
 * `equipItem` carried a branch that declared a catalogue-keyed pool for such a
 * copy, so two unlabelled wands shared one pool of charges. That branch is
 * gone with this command's arrival, because the engine may have exactly one
 * answer to "what happens when a copy is gained": it is labelled if it has
 * state of its own, and its pool is declared beside it.
 *
 * The command takes a `Supply` for one reason: **some items roll how much they
 * hold**. SRD Necklace of Fireballs prints "1d6+3 beads" and Sovereign Glue
 * "1d6+1 ounces" — a count that is a fact about the copy the party found,
 * rolled once when it is found and never again. The engine rolls it, out of
 * the generator the campaign is replaying, and pins the number into the pool
 * the copy is born with; replay reads the log and rerolls nothing.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');

/** 3 charges, no attunement, "regains 1d3 expended charges daily at dawn". */
const WAND = 'wand-of-secrets';

const supply = (content: Content = SRD_CONTENT, seed = 'award'): Supply => ({
  issuer: createRollIssuer('roll'),
  rng: createRng(seed) as Rng,
  content,
});

const character = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
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

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);
const creature = (log: readonly GameEvent[], who: CharacterId = GRUM) => state(log).creatures[who]!;
const lines = (log: readonly GameEvent[], itemId: string) =>
  creature(log).inventory.filter((line) => line.id === itemId);

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

const made = (content: Content = SRD_CONTENT): readonly GameEvent[] =>
  unwrap(createCharacter(content, character(), GRUM), 'create');

/** A necklace whose beads are counted when it is found, not when it is printed. */
const NECKLACE = 'test-necklace';
const BEADS: CatalogueItem = {
  id: NECKLACE,
  name: 'Necklace of Small Fireballs',
  kind: 'wondrous',
  weightLb: 1,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  chargesRolled: '1d6+3',
  grants: [{ kind: 'pool', key: `${NECKLACE}:charges`, uses: 3, recovers: 'special' }],
};

const HOARD: Content = unwrap(extendContent(SRD_CONTENT, { items: [BEADS] }), 'homebrew');

describe('an awarded copy is labelled at birth, with its pool declared there', () => {
  it('hands over a charged copy with a record and charges of its own', () => {
    const log = run(made(), (s) =>
      awardItems(s, supply(), GRUM, [{ id: WAND, quantity: 2 }], 'the barrow'),
    );

    expect(lines(log, WAND).map((line) => line.instance)).toEqual(['item:1', 'item:2']);
    expect(state(log).itemsIssued).toBe(2);
    expect(Object.keys(creature(log).resources.pools)).toEqual(
      expect.arrayContaining([`${WAND}:charges@item:1`, `${WAND}:charges@item:2`]),
    );
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(3);
  });

  /**
   * And the charges were there before any hand reached for it, which is what
   * deleting `equipItem`'s declaration means: picking the wand up declares
   * nothing at all.
   */
  it('declares nothing when the copy is picked up', () => {
    const log = run(made(), (s) =>
      awardItems(s, supply(), GRUM, [{ id: WAND, quantity: 1 }], 'the barrow'),
    );
    const held = run(log, (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    expect(held.slice(log.length).filter((e) => e.type === 'resource-pool-declared')).toEqual([]);
    expect(chargesLeft(state(held), SRD_CONTENT, GRUM, 'item:1')).toBe(3);
  });

  it('hands over a stack as the stack it has always been', () => {
    const before = made();
    const carried = lines(before, 'rope')[0]?.quantity ?? 0;
    const log = run(before, (s) =>
      awardItems(s, supply(), GRUM, [{ id: 'rope', quantity: 2 }], 'the barrow'),
    );
    expect(lines(log, 'rope')).toEqual([{ id: 'rope', quantity: carried + 2 }]);
    expect(state(log).itemsIssued).toBe(0);
  });

  /** A pack is what is in it, the way a purchase already opens one. */
  it('opens a pack it hands over', () => {
    const before = made();
    const inkBefore = lines(before, 'ink')[0]?.quantity ?? 0;
    const log = run(before, (s) =>
      awardItems(s, supply(), GRUM, [{ id: 'scholars-pack', quantity: 1 }], 'the barrow'),
    );
    expect(lines(log, 'scholars-pack')).toEqual([{ id: 'scholars-pack', quantity: 1 }]);
    expect(lines(log, 'ink')[0]?.quantity).toBe(inkBefore + 1);
  });

  it('refuses an unknown item, an unknown creature and an empty award', () => {
    const unknown = awardItems(
      state(made()),
      supply(),
      GRUM,
      [{ id: 'sword-of-nothing', quantity: 1 }],
      'the barrow',
    );
    expect(isErr(unknown) && unknown.code).toBe('unknown_item');

    const nobody = awardItems(
      state(made()),
      supply(),
      id('nobody'),
      [{ id: 'rope', quantity: 1 }],
      'the barrow',
    );
    expect(isErr(nobody) && nobody.code).toBe('unknown_creature');

    const nothing = awardItems(state(made()), supply(), GRUM, [], 'the barrow');
    expect(isErr(nothing) && nothing.code).toBe('no_items');

    const none = awardItems(
      state(made()),
      supply(),
      GRUM,
      [{ id: 'rope', quantity: 0 }],
      'the barrow',
    );
    expect(isErr(none) && none.code).toBe('bad_quantity');
  });
});

describe('a count the book rolls is rolled once, when the copy is found', () => {
  const found = (
    quantity = 1,
    seed = 'award',
  ): { log: readonly GameEvent[]; before: readonly GameEvent[] } => {
    const before = made(HOARD);
    return {
      before,
      log: run(before, (s) =>
        awardItems(s, supply(HOARD, seed), GRUM, [{ id: NECKLACE, quantity }], 'the barrow'),
      ),
    };
  };

  it('pins the rolled maximum into the pool the copy is born with', () => {
    const { log, before } = found();
    const declared = log.slice(before.length).filter((e) => e.type === 'resource-pool-declared');
    expect(declared).toHaveLength(1);
    const pool = declared[0]!.type === 'resource-pool-declared' ? declared[0]!.pool : null;
    expect(pool?.key).toBe(`${NECKLACE}:charges@item:1`);
    // 1d6+3: between four and nine, and never the three the row prints.
    expect(pool!.max).toBeGreaterThanOrEqual(4);
    expect(pool!.max).toBeLessThanOrEqual(9);
    expect(chargesLeft(state(log), HOARD, GRUM, 'item:1')).toBe(pool!.max);
  });

  /** The engine's roll, out of the campaign's own generator and recorded as one. */
  it('records the roll and the generator it came out of', () => {
    const { log, before } = found();
    const added = log.slice(before.length);
    const rolled = added.filter((e) => e.type === 'roll-recorded');
    expect(rolled).toHaveLength(1);
    expect(rolled[0]!.type === 'roll-recorded' && rolled[0]!.label).toMatch(/1d6\+3/);
    expect(added.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
  });

  /** Replay reads the number; it does not throw the dice again. */
  it('folds to the same number however often the log is folded', () => {
    const { log } = found();
    expect(fold('seed', log)).toStrictEqual(fold('seed', log));
    expect(fold('seed', log)).toStrictEqual(
      fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]),
    );
    expect(fold('seed', log)).toStrictEqual(fold('seed', log, HOARD));
  });

  /** Once **per copy**: two necklaces are two finds, and two counts. */
  it('rolls once for each copy', () => {
    const { log, before } = found(2);
    const added = log.slice(before.length);
    expect(added.filter((e) => e.type === 'roll-recorded')).toHaveLength(2);
    const pools = added.flatMap((e) => (e.type === 'resource-pool-declared' ? [e.pool] : []));
    expect(pools.map((pool) => pool.key)).toEqual([
      `${NECKLACE}:charges@item:1`,
      `${NECKLACE}:charges@item:2`,
    ]);
  });

  /**
   * And a door that cannot roll does not guess. `createCharacter` has no
   * generator — it is making the events a state will be folded from — so a
   * character built owning one of these is built owning a copy whose count
   * nobody has rolled, and the refusal says so rather than handing over the
   * printed number as though the book had printed one.
   */
  it('leaves the count unrolled at a door that cannot roll, and refuses loudly', () => {
    const born = unwrap(
      createCharacter(
        HOARD,
        character({
          dmGrants: {
            items: [{ id: NECKLACE, quantity: 1 }],
            goldPieces: 0,
            magicItems: [NECKLACE],
            note: 'an heirloom',
          },
        }),
        GRUM,
      ),
      'create',
    );
    expect(lines(born, NECKLACE).map((line) => line.instance)).toEqual(['item:1']);
    expect(Object.keys(creature(born).resources.pools)).not.toContain(
      `${NECKLACE}:charges@item:1`,
    );

    const held = run(born, (s) => equipItem(s, HOARD, GRUM, 'item:1'));
    const out = expendCharges(state(held), HOARD, GRUM, 'item:1');
    expect(isErr(out) && out.code).toBe('unknown_pool');
  });
});

/**
 * The debt step one left, paid: there is one gain semantics now.
 *
 * A hand-written `items-gained` is still a log the fold accepts — it is the
 * counted stack it has always been, which is what keeps every log written
 * before copies had records folding unchanged. What it no longer does is
 * acquire a pool by being picked up.
 */
describe('an unlabelled charged copy has no charges, and says so', () => {
  const byHand = (): readonly GameEvent[] => [
    ...made(),
    { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 1 }], source: 'by hand' },
  ];

  it('declares no pool when it is equipped, and refuses the spend', () => {
    const log = run(byHand(), (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(log.slice(byHand().length).filter((e) => e.type === 'resource-pool-declared')).toEqual(
      [],
    );
    expect(state(log).itemsIssued).toBe(0);
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, WAND)).toBe(0);

    const out = expendCharges(state(log), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out) && out.code).toBe('unknown_pool');
    // And the refusal names the door that works, rather than the one that did.
    expect(isErr(out) && out.reason).toMatch(/award/i);
  });
});
