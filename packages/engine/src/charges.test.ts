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
import { checkContent, extendContent, type Content } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest } from './rest.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { remaining } from './resources.js';
import {
  attuneItem,
  awardItems,
  chargesLeft,
  declareDawn,
  equipItem,
  expendCharges,
  unequipItem,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * Charges, and the dawn that gives them back.
 *
 * Three SRD sentences hold this file together, and none of them is a new
 * mechanism:
 *
 * - **"This wand has 3 charges"** is a pool. `resources.ts` named "a magic
 *   item with seven charges" as a designed use of the one it already had, so
 *   an item's charges are declared, spent and refused exactly as a Warlock's
 *   slots are.
 * - **"regains 1d3 expended charges daily at dawn"** is a roll, and the engine
 *   makes it. A rolled recovery is the one thing `restoreOn` could not say,
 *   because its tag is all-or-nothing.
 * - **"daily at dawn"** is declared. The clock counts seconds and has no
 *   calendar and no time of day; the SRD hands the moment to the GM in as many
 *   words, so `declareDawn` states it and moves the clock not at all.
 *
 * What a charge *buys* is deliberately absent. The Wand of Secrets points at a
 * secret door and the Eyes of Charming cast _Charm Person_, and neither is a
 * thing this engine can resolve from an item yet — so these prove the charge
 * economy and say so, rather than proving that a wand can cast.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');

/** 3 charges, no attunement, and "regains 1d3 expended charges daily at dawn". */
const WAND = 'wand-of-secrets';
/** 3 charges, attunement, and "regain all expended charges daily at dawn". */
const LENSES = 'eyes-of-charming';

const supply = (seed = 'dawn-seed'): { issuer: RollIssuer; rng: Rng } => ({
  issuer: createRollIssuer('roll'),
  rng: createRng(seed) as Rng,
});

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

const made = (): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, barbarian(), GRUM), 'create');

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/**
 * What the DM found in the barrow, handed over.
 *
 * `awardItems` rather than a hand-written `items-gained`, which is what this
 * file used to write: a hand-written gain is a line with **no record**, and
 * since the equip no longer declares a pool for one, a wand handed over that
 * way would have no charges at all. That is the point of the command, and this
 * helper is every test below going through the door a DM goes through.
 */
const given = (
  log: readonly GameEvent[],
  itemId: string,
  quantity = 1,
  content: Content = SRD_CONTENT,
): readonly GameEvent[] =>
  run(log, (s) =>
    awardItems(s, { ...supply('the-hoard'), content }, GRUM, [{ id: itemId, quantity }], 'the hoard'),
  );

/** Owned and in hand, which is the SRD's "while holding it". */
const holding = (
  itemId: string,
  log: readonly GameEvent[] = made(),
  content: Content = SRD_CONTENT,
): readonly GameEvent[] =>
  run(given(log, itemId, 1, content), (s) => equipItem(s, content, GRUM, itemId));

/**
 * The pool key, of a copy where one is named and of the kind where none is.
 *
 * Both spellings are real: a copy gained through any of the three doors keeps
 * its charges under its own id, and the unsuffixed one is what content wrote
 * — which is still what a homebrew item declares and what an unlabelled line
 * would have used, if any door still wrote one.
 */
const keyOf = (itemId: string, instance?: string): string =>
  itemChargePool(SRD_CONTENT.item(itemId)!, instance)!.key;

const left = (log: readonly GameEvent[], itemId: string): number =>
  chargesLeft(fold('seed', log), SRD_CONTENT, GRUM, itemId);

describe('an SRD item with charges, end to end through the public API', () => {
  it('declares its pool when it is handed over, sized as the book prints it', () => {
    const log = holding(WAND);
    // One, beside the Hit Dice and the Rages the character was built with: the
    // wand's charges are a pool like any other, arriving by the same event —
    // and keyed to the copy the DM handed over rather than to the kind.
    const declared = log.filter(
      (e) => e.type === 'resource-pool-declared' && e.pool.key === keyOf(WAND, 'item:1'),
    );
    expect(declared).toHaveLength(1);
    expect(left(log, WAND)).toBe(3);
  });

  it('spends a charge, and refuses an empty pool as a value', () => {
    let log = holding(WAND);
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND));
    expect(left(log, WAND)).toBe(2);

    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 2));
    expect(left(log, WAND)).toBe(0);

    const empty = expendCharges(fold('seed', log), SRD_CONTENT, GRUM, WAND);
    expect(isErr(empty)).toBe(true);
    expect(isErr(empty) && empty.code).toBe('exhausted');
  });

  it('gives them back when somebody declares dawn', () => {
    let log = holding(WAND);
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 3));
    expect(left(log, WAND)).toBe(0);

    log = run(log, (s) => declareDawn(s, supply()));
    expect(left(log, WAND)).toBeGreaterThan(0);
  });

  it('spends nothing from an item that is not in hand', () => {
    const log = run(holding(WAND), (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    const out = expendCharges(fold('seed', log), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('not_equipped');
    // And the charges are still there: putting a wand down is not emptying it.
    expect(left(log, WAND)).toBe(3);
  });

  it('refuses an item that has no charges at all', () => {
    const log = run(given(made(), 'chain-shirt'), (s) =>
      equipItem(s, SRD_CONTENT, GRUM, 'chain-shirt'),
    );
    const out = expendCharges(fold('seed', log), SRD_CONTENT, GRUM, 'chain-shirt');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('no_charges');
    expect(chargesLeft(fold('seed', log), SRD_CONTENT, GRUM, 'chain-shirt')).toBe(0);
  });

  it('refuses an item whose attunement nobody has taken', () => {
    const log = holding(LENSES);
    const out = expendCharges(fold('seed', log), SRD_CONTENT, GRUM, LENSES);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('not_attuned');
  });
});

/**
 * Creation is the other door onto the same room, and it leaves it the same way.
 *
 * `createCharacter` writes its own `item-equipped` from `choices.equipped`
 * rather than calling the command — it has no state to call one against — so it
 * has to compile what it pins from the same two functions `equipItem` compiles
 * from. It does. A character born holding a wand holds a wand with charges in
 * it, and the pool arrives on the same event it arrives on for a wand picked up
 * off the floor.
 */
describe('a character created already holding a charged item', () => {
  const bornHolding = (): readonly GameEvent[] =>
    unwrap(
      createCharacter(
        SRD_CONTENT,
        barbarian({
          equipped: [WAND],
          dmGrants: {
            items: [{ id: WAND, quantity: 1 }],
            goldPieces: 0,
            magicItems: [WAND],
            note: 'found in the barrow',
          },
        }),
        GRUM,
      ),
      'create',
    );

  it('is born with the pool declared, sized as the book prints it', () => {
    const log = bornHolding();
    // Under the copy's own key, because the wand it was born holding is the
    // first copy this campaign has issued a record to.
    const declared = log.filter(
      (e) => e.type === 'resource-pool-declared' && e.pool.key === keyOf(WAND, 'item:1'),
    );
    expect(declared).toHaveLength(1);
    expect(left(log, WAND)).toBe(3);
  });

  it('spends its charges without taking the wand off first', () => {
    const log = run(bornHolding(), (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND));
    expect(left(log, WAND)).toBe(2);
  });

  /**
   * The two doors agree, asserted as state rather than described.
   *
   * The same character, the same wand, owned the same way; the only difference
   * is which door put it in their hand. What the creature *is* afterwards —
   * what it holds, and what it has left to spend — has to be the same value,
   * because a difference here is a campaign that plays differently depending on
   * which turn the DM handed the wand over.
   */
  it('is the same creature as one who picked the same wand up', () => {
    const hoard = {
      items: [{ id: WAND, quantity: 1 }],
      goldPieces: 0,
      magicItems: [WAND],
      note: 'found in the barrow',
    };
    const byCommand = run(
      unwrap(createCharacter(SRD_CONTENT, barbarian({ dmGrants: hoard }), GRUM), 'create'),
      (s) => equipItem(s, SRD_CONTENT, GRUM, WAND),
    );

    const born = fold('seed', bornHolding()).creatures.grum!;
    const picked = fold('seed', byCommand).creatures.grum!;
    expect(born.equipped).toStrictEqual(picked.equipped);
    expect(born.resources).toStrictEqual(picked.resources);
  });

  /**
   * And the refusal that was creation's is still reachable, by the only thing
   * left that can reach it.
   *
   * All three doors the engine has declare the pool as the copy is gained, so
   * what `unknown_pool` catches now is a copy nobody's command handed over — a
   * fixture, a migration, a caller assembling `items-gained` itself. That is
   * what is assembled here, and the refusal names the door that works rather
   * than letting the wand look empty.
   */
  it('refuses a hand-written gain that declared no pool', () => {
    const log: readonly GameEvent[] = [
      ...made(),
      { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 1 }], source: 'by hand' },
      { type: 'item-equipped', id: GRUM, item: WAND, armor: null },
    ];
    const out = expendCharges(fold('seed', log), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('unknown_pool');
    expect(isErr(out) && out.reason).toContain('awardItems');
  });

  /** And putting it down and picking it up again finds the charges, not a refill. */
  it('keeps what it has spent across a wand set down and taken back up', () => {
    let log = run(bornHolding(), (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND));
    log = run(log, (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    log = run(log, (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(left(log, WAND)).toBe(2);
  });
});

describe('a rolled recovery is rolled by the engine', () => {
  const spent = (): readonly GameEvent[] =>
    run(holding(WAND), (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 3));

  it('lands as resource-regained, with the roll and the generator beside it', () => {
    const before = spent();
    const events = unwrap(declareDawn(fold('seed', before), supply()), 'dawn');

    const rolled = events.find((e) => e.type === 'roll-recorded');
    expect(rolled).toBeDefined();
    expect(rolled?.type === 'roll-recorded' && rolled.label).toContain('1d3');
    expect(events.some((e) => e.type === 'rolls-issued')).toBe(true);

    const regained = events.find((e) => e.type === 'resource-regained');
    expect(regained?.type === 'resource-regained' && regained.key).toBe(keyOf(WAND, 'item:1'));
    const amount = regained?.type === 'resource-regained' ? regained.amount : 0;
    expect(amount).toBeGreaterThanOrEqual(1);
    expect(amount).toBeLessThanOrEqual(3);
    // The number in the event is the number the engine rolled, not a constant.
    expect(rolled?.type === 'roll-recorded' && rolled.total).toBe(amount);
  });

  it('gives the same number for the same seed, and is not always the same number', () => {
    const before = fold('seed', spent());
    const once = unwrap(declareDawn(before, supply('a')), 'dawn');
    const again = unwrap(declareDawn(before, supply('a')), 'dawn');
    expect(again).toEqual(once);

    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => {
      const events = unwrap(declareDawn(before, supply(seed)), 'dawn');
      const regained = events.find((e) => e.type === 'resource-regained');
      return regained?.type === 'resource-regained' ? regained.amount : 0;
    });
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('never hands back more than was spent', () => {
    // One charge out of three, against a die that can roll three.
    const log = run(holding(WAND), (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND));
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const events = unwrap(declareDawn(fold('seed', log), supply(seed)), 'dawn');
      const regained = events.find((e) => e.type === 'resource-regained');
      expect(regained?.type === 'resource-regained' && regained.amount).toBe(1);
    }
  });

  it('rolls nothing for a pool nobody has spent from', () => {
    const events = unwrap(declareDawn(fold('seed', holding(WAND)), supply()), 'dawn');
    expect(events.some((e) => e.type === 'roll-recorded')).toBe(false);
    expect(events.some((e) => e.type === 'resource-regained')).toBe(false);
  });
});

/**
 * SRD Rod of Resurrection: "The rod regains 1 expended charge daily at dawn."
 *
 * The third kind of dawn, and the one that had nowhere to go. `regainsAtDawn`
 * took dice on the reasoning that the book prints dice — it prints them
 * forty-four times — and this rod prints a stated 1, which a one-sided die
 * cannot say. Leaving the field off was not neutral either: a `dawn` pool with
 * no dice is refilled by the tag, so the rod would have given back five
 * charges every morning where the book gives one.
 *
 * So a stated number is read as a stated number: no die is thrown, the
 * generator does not move, and the pool gets back exactly what the line says.
 */
describe('a dawn that gives back a stated number gives back that number', () => {
  const ROD = 'test-rod';
  const stated: Content = unwrap(
    extendContent(SRD_CONTENT, {
      items: [
        {
          id: ROD,
          name: 'Rod of Small Raisings',
          kind: 'rod',
          weightLb: 1,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [
            { kind: 'pool', key: `${ROD}:charges`, uses: 5, recovers: 'dawn', regainsAtDawn: '1' },
          ],
        } as unknown as CatalogueItem,
      ],
    }),
    'homebrew',
  );

  const held = (): readonly GameEvent[] => holding(ROD, made(), stated);

  it('is content the validator accepts, where it refused it before', () => {
    expect(checkContent({ ...stated, items: [...stated.items] })).toEqual([]);
  });

  it('gives back the one the line prints, and throws no die for it', () => {
    let log = run(held(), (s) => expendCharges(s, stated, GRUM, ROD, 3));
    expect(chargesLeft(fold('seed', log), stated, GRUM, ROD)).toBe(2);

    const dawn = unwrap(declareDawn(fold('seed', log), supply()), 'dawn');
    expect(dawn.some((e) => e.type === 'roll-recorded')).toBe(false);
    expect(dawn.some((e) => e.type === 'rolls-issued')).toBe(false);
    log = [...log, ...dawn];
    expect(chargesLeft(fold('seed', log), stated, GRUM, ROD)).toBe(3);

    // And the next morning gives back one more, rather than the rest.
    log = run(log, (s) => declareDawn(s, supply(), { commandId: 'the-second-dawn' }));
    expect(chargesLeft(fold('seed', log), stated, GRUM, ROD)).toBe(4);
  });

  it('gives back no more than was spent, and moves no generator at all', () => {
    const log = run(held(), (s) => expendCharges(s, stated, GRUM, ROD, 1));
    const rng = createRng('unmoved') as Rng;
    const dawn = unwrap(declareDawn(fold('seed', log), { issuer: createRollIssuer('r'), rng }), 'dawn');
    const regained = dawn.find((e) => e.type === 'resource-regained');
    expect(regained?.type === 'resource-regained' && regained.amount).toBe(1);
    expect(rng.snapshot()).toEqual(createRng('unmoved').snapshot());
  });

  it('is still not a stated number for a pool that sees no dawn', () => {
    const problems = checkContent({
      ...SRD_CONTENT,
      items: [
        ...SRD_CONTENT.items,
        {
          id: 'test-rod-of-the-wrong-rest',
          name: 'Wrong Rest',
          kind: 'rod',
          weightLb: 1,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [
            {
              kind: 'pool',
              key: 'test-rod-of-the-wrong-rest:charges',
              uses: 5,
              recovers: 'long-rest',
              regainsAtDawn: '1',
            },
          ],
        } as unknown as CatalogueItem,
      ],
    });
    expect(problems.map((p) => p.code)).toContain('dawn_roll_without_dawn');
    // And a stated nothing is not a number a pool gives back.
    expect(
      checkContent({
        ...SRD_CONTENT,
        items: [
          ...SRD_CONTENT.items,
          {
            id: 'test-rod-of-nothing',
            name: 'Nothing',
            kind: 'rod',
            weightLb: 1,
            costCp: null,
            armor: null,
            weapon: null,
            contents: [],
            grants: [
              {
                kind: 'pool',
                key: 'test-rod-of-nothing:charges',
                uses: 5,
                recovers: 'dawn',
                regainsAtDawn: '0',
              },
            ],
          } as unknown as CatalogueItem,
        ],
      }).map((p) => p.code),
    ).toContain('bad_dawn_roll');
  });
});

describe('one dawn, two kinds of recovery', () => {
  /** The lenses need the Short Rest attunement takes; the wand needs nothing. */
  const both = (): readonly GameEvent[] => {
    const owned = given(given(made(), WAND), LENSES);
    const resting = run(owned, (s) => beginRest(s, GRUM, 'short'));
    const attuned = run(resting, (s) => attuneItem(s, SRD_CONTENT, GRUM, LENSES));
    const wand = run(attuned, (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    return run(wand, (s) => equipItem(s, SRD_CONTENT, GRUM, LENSES));
  };

  it('refills the one that refills and rolls the one that rolls', () => {
    let log = both();
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 3));
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, LENSES, 3));
    expect([left(log, WAND), left(log, LENSES)]).toEqual([0, 0]);

    log = run(log, (s) => declareDawn(s, supply()));
    // "The lenses regain all expended charges daily at dawn."
    expect(left(log, LENSES)).toBe(3);
    // "regains 1d3 expended charges daily at dawn" — some, by the die.
    expect(left(log, WAND)).toBeGreaterThanOrEqual(1);
    expect(left(log, WAND)).toBeLessThanOrEqual(3);
  });

  it('leaves a rolled pool to its roll when the refill passes over it', () => {
    // The wand recovers *at dawn* and yet must not be refilled by the tag: the
    // roll is the whole of its recovery.
    let log = both();
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 3));
    const restored = unwrap(declareDawn(fold('seed', log), supply('one')), 'dawn');
    const state = fold('seed', [...log, ...restored]);
    const regained = restored.find((e) => e.type === 'resource-regained');
    const amount = regained?.type === 'resource-regained' ? regained.amount : 0;
    expect(remaining(state.creatures['grum']!.resources, keyOf(WAND, 'item:1'))).toBe(amount);
  });
});

describe('dawn is a moment, not a duration', () => {
  it('moves the clock not at all, out of combat', () => {
    const log = holding(WAND);
    const before = fold('seed', log);
    const after = fold('seed', run(log, (s) => declareDawn(s, supply())));
    expect(after.elapsed).toBe(before.elapsed);
    expect(after.combat).toEqual(before.combat);
  });

  it('and not in combat either', () => {
    const started: GameEvent = {
      type: 'combat-started',
      combatants: [{ id: GRUM, initiative: 15, speed: 30 }],
    };
    const log = [...holding(WAND), started];
    const before = fold('seed', log);
    const after = fold('seed', run(log, (s) => declareDawn(s, supply())));
    expect(after.elapsed).toBe(before.elapsed);
    expect(after.combat).toEqual(before.combat);
  });
});

describe('two of one charged item', () => {
  /**
   * The decision that was deferred, taken — and this is what it bought.
   *
   * Two Wands of Secrets used to be one line of two with one pool between
   * them, so both doors refused the second copy rather than let a charge
   * spent from one empty the other. Each copy has a record of its own now,
   * and `item-instances.test.ts` holds the whole of what that is worth. What
   * is left here is the door: it no longer refuses, and what it asks instead
   * is *which* wand, because "equip a wand" has two answers and spending
   * somebody's last charge for them is not one of them.
   */
  it('is a question rather than a refusal, and the question names the copies', () => {
    const owned = unwrap(
      createCharacter(
        SRD_CONTENT,
        barbarian({
          dmGrants: {
            items: [{ id: WAND, quantity: 2 }],
            goldPieces: 0,
            magicItems: [WAND],
            note: 'two from the same barrow',
          },
        }),
        GRUM,
      ),
      'create',
    );
    const out = equipItem(fold('seed', owned), SRD_CONTENT, GRUM, WAND);
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('ambiguous_copy');
    expect(isErr(out) && out.reason).toMatch(/item:1/);
    // And naming one of them equips that one, with charges of its own.
    const held = run(owned, (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:2'));
    expect(left(held, 'item:2')).toBe(3);
  });

  /**
   * An **unlabelled** stack is the stack it has always been, because that is
   * what an absent record means — and now that every door labels what it
   * hands over, a hand-written log is the only thing that writes one. It gets
   * no pool at all: the equip used to declare a catalogue-keyed one, which was
   * two wands sharing three charges and is exactly what a record is for.
   */
  it('is no pool at all when the log never told them apart', () => {
    const owned: readonly GameEvent[] = [
      ...made(),
      { type: 'items-gained', id: GRUM, items: [{ id: WAND, quantity: 2 }], source: 'by hand' },
    ];
    const held = run(owned, (s) => equipItem(s, SRD_CONTENT, GRUM, WAND));
    expect(fold('seed', held).creatures.grum?.resources.pools[keyOf(WAND)]).toBeUndefined();
    expect(left(held, WAND)).toBe(0);
    expect(isErr(expendCharges(fold('seed', held), SRD_CONTENT, GRUM, WAND))).toBe(true);
  });

  it('but two of something uncharged is nobody’s problem', () => {
    const owned = given(made(), 'chain-shirt', 2);
    expect(isErr(equipItem(fold('seed', owned), SRD_CONTENT, GRUM, 'chain-shirt'))).toBe(false);
  });
});

describe('what the command read from the catalogue is in the event', () => {
  it('folds identically with no content and with it', () => {
    let log = holding(WAND);
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, WAND, 2));
    log = run(log, (s) => declareDawn(s, supply()));
    expect(fold('seed', log)).toEqual(fold('seed', log, SRD_CONTENT));
  });

  it('carries the whole pool on the declaration, not the item’s id to look up', () => {
    const declared = holding(WAND).find(
      (e) => e.type === 'resource-pool-declared' && e.pool.key === keyOf(WAND, 'item:1'),
    );
    expect(declared?.type === 'resource-pool-declared' && declared.pool).toMatchObject({
      key: keyOf(WAND, 'item:1'),
      max: 3,
      recovers: 'dawn',
      regainsAtDawn: '1d3',
    });
  });
});

describe('the validator judges an item’s charge pool', () => {
  const charged = (over: Record<string, unknown>): CatalogueItem =>
    ({
      id: 'test-charged',
      name: 'Test Charged',
      kind: 'wand',
      weightLb: 0,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [{ kind: 'pool', key: 'test-charged:charges', uses: 3, recovers: 'dawn', ...over }],
    }) as unknown as CatalogueItem;

  const codes = (item: CatalogueItem): readonly string[] =>
    checkContent({ ...SRD_CONTENT, items: [...SRD_CONTENT.items, item] }).map((p) => p.code);

  it('accepts a flat number of uses and a dawn roll', () => {
    expect(codes(charged({ regainsAtDawn: '1d6 + 1' }))).toEqual([]);
  });

  it('refuses a pool an item cannot size', () => {
    expect(codes(charged({ uses: undefined }))).toContain('item_pool_without_uses');
    expect(codes(charged({ usesByLevel: new Array(20).fill(1) }))).toContain(
      'item_grant_reads_a_level',
    );
  });

  /**
   * And a recovery a later *feature* rewrites, which is the fifth field this
   * host could never apply.
   *
   * The gate is "does this character hold that feature", read off the feature
   * list a class table produced; a wand's charges are declared when the copy
   * is gained and no feature list is ever consulted. So the field would sit
   * there looking like a rule in force, which is what the four sizings beside
   * it are refused for.
   */
  it('refuses a recovery a later feature rewrites, which no item has a table for', () => {
    expect(
      codes(charged({ recoversSooner: { withFeature: 'a-class:later', recovers: 'short-rest' } })),
    ).toContain('item_grant_reads_a_level');
  });

  it('refuses a dawn roll that is not dice, or that is not at dawn', () => {
    expect(codes(charged({ regainsAtDawn: 'some' }))).toContain('bad_dawn_roll');
    expect(codes(charged({ recovers: 'long-rest', regainsAtDawn: '1d3' }))).toContain(
      'dawn_roll_without_dawn',
    );
  });

  it('refuses a pool with no key to find it by, and a recovery nothing recovers on', () => {
    expect(codes(charged({ key: '  ' }))).toContain('bad_pool_key');
    expect(codes(charged({ recovers: 'moonrise' }))).toContain('bad_recovery');
  });

  it('refuses a payout an item’s charges do not buy, and a second pool', () => {
    // `heals` and `touchHeals` hang a *feature's* payout off a pool — Second
    // Wind, Lay On Hands — and nothing spends an item's charges on either.
    expect(codes(charged({ heals: { dice: '1d10', action: 'bonus-action' } }))).toContain(
      'item_pool_not_read',
    );
    const two = {
      ...charged({}),
      grants: [
        { kind: 'pool', key: 'test-charged:charges', uses: 3, recovers: 'dawn' },
        { kind: 'pool', key: 'test-charged:more', uses: 2, recovers: 'dawn' },
      ],
    } as unknown as CatalogueItem;
    expect(codes(two)).toContain('two_item_pools');
  });

  it('refuses two items sharing one pool key', () => {
    const twin = { ...charged({}), id: 'test-charged-twin', name: 'Twin' };
    expect(
      checkContent({ ...SRD_CONTENT, items: [...SRD_CONTENT.items, charged({}), twin] }).map(
        (p) => p.code,
      ),
    ).toContain('duplicate_pool_key');
  });
});

describe('a charge command aimed at somebody nobody has added', () => {
  it('asks rather than refuses', () => {
    const out = expendCharges(fold('seed', made()), SRD_CONTENT, id('the-porter'), WAND);
    expect(isNeedsContext(out)).toBe(true);
  });
});

describe('homebrew reaches the same mechanism through the same door', () => {
  it('declares, spends and regains without an engine change', () => {
    const content: Content = unwrap(
      extendContent(SRD_CONTENT, {
        items: [
          {
            id: 'test-horn',
            name: 'Horn of Small Noises',
            kind: 'wondrous',
            weightLb: 1,
            costCp: null,
            armor: null,
            weapon: null,
            contents: [],
            grants: [{ kind: 'pool', key: 'test-horn:charges', uses: 2, recovers: 'dawn' }],
          } as unknown as CatalogueItem,
        ],
      }),
      'homebrew',
    );
    let log = holding('test-horn', made(), content);
    log = run(log, (s) => expendCharges(s, content, GRUM, 'test-horn', 2));
    expect(chargesLeft(fold('seed', log), content, GRUM, 'test-horn')).toBe(0);
    log = run(log, (s) => declareDawn(s, supply()));
    expect(chargesLeft(fold('seed', log), content, GRUM, 'test-horn')).toBe(2);
  });
});
