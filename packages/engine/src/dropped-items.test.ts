import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import { beginRest } from './rest.js';
import {
  addSceneLandmark,
  attuneItem,
  attunedItems,
  chargesLeft,
  dropItem,
  equipItem,
  expendCharges,
  placeCreatureInScene,
  quantityOf,
  resolveSpell,
  setScene,
  takeItemUp,
  unequipItem,
} from './commands.js';
import { groundItems, groundItemOf, placeItemOnGround } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * An item has a place when nobody is holding it.
 *
 * Two thirds of "where objects are" was already here: a table is a landmark,
 * and what somebody is holding is in their square by construction, because a
 * held thing is a line on a creature and the creature has the placement. The
 * missing case is the thing in **nobody's** inventory — a sword on the floor,
 * which until now was fiction the engine had no room for. `dropConjured`
 * refused it in as many words: "a dropped Longsword is on the floor, and a
 * floor is not something this engine holds."
 *
 * The identity problem is the work. A weapon is a *catalogue* id, so "my sword
 * on the floor" could not be told from the identical sword still in the pack.
 * The owner's ruling: **a dropped item gets an instance id if it does not
 * already have one** — the engine-issued record that already exists for a copy
 * with state of its own. A copy that has one keeps it, and everything keyed to
 * it travels; a stack that has none is labelled for exactly as long as it lies
 * there, and hands the label back when somebody picks it up, because twenty
 * arrows back in a quiver are a count again.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const NYX = id('nyx');

/** 3 charges, no attunement, and "regains 1d3 expended charges daily at dawn". */
const WAND = 'wand-of-secrets';

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

const hoard = (items: readonly { id: string; quantity: number }[]): CharacterChoices['dmGrants'] => ({
  items: [...items],
  goldPieces: 0,
  magicItems: items.map((line) => line.id),
  note: 'found in the barrow',
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

const creature = (log: readonly GameEvent[], who: CharacterId) => state(log).creatures[who]!;
const lines = (log: readonly GameEvent[], who: CharacterId, itemId: string) =>
  creature(log, who).inventory.filter((line) => line.id === itemId);
const poolKeys = (log: readonly GameEvent[], who: CharacterId) =>
  Object.keys(creature(log, who).resources.pools).filter((key) => key.includes(':charges'));

const ground = (log: readonly GameEvent[]) => groundItems(state(log).scene!);

/** A room, a table in it, Grum beside the table, and Nyx beside Grum. */
const room = (grumGrants = hoard([{ id: WAND, quantity: 1 }])): readonly GameEvent[] => {
  const first = unwrap(createCharacter(SRD_CONTENT, character({ dmGrants: grumGrants }), GRUM), 'grum');
  const second = unwrap(
    createCharacter(SRD_CONTENT, character({ name: 'Nyx' }), NYX, fold('seed', first)),
    'nyx',
  );
  let log: readonly GameEvent[] = [...first, ...second];
  log = run(log, (s) => setScene(s, { width: 60, depth: 60, height: 20 }));
  log = run(log, (s) => addSceneLandmark(s, 'the table', { x: 30, y: 30, z: 0 }));
  log = run(log, (s) => placeCreatureInScene(s, GRUM, { from: { landmark: 'the table' }, feet: 5 }));
  log = run(log, (s) => placeCreatureInScene(s, NYX, { from: { creature: GRUM }, feet: 5 }));
  return log;
};

describe('a thing nobody is holding has a place of its own', () => {
  it('leaves the pack and lies where it was put down', () => {
    const log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }));

    expect(lines(log, GRUM, WAND)).toEqual([]);
    // Minus the pool the wand's charges live in, which travels with it and has
    // its own test below.
    expect(ground(log).map((pile) => ({ ...pile, pools: undefined }))).toEqual([
      {
        instance: 'item:1',
        item: WAND,
        quantity: 1,
        pools: undefined,
        at: { x: 30, y: 35, z: 0 },
      },
    ]);
  });

  /** At the dropper's own feet unless the caller says otherwise. */
  it('lands where a placement anchored to something established says', () => {
    const log = run(room(), (s) =>
      dropItem(s, SRD_CONTENT, GRUM, {
        item: WAND,
        placement: { from: { landmark: 'the table' }, feet: 10, bearing: 90 },
      }),
    );

    expect(groundItemOf(state(log).scene!, 'item:1')?.at).toEqual({ x: 40, y: 30, z: 0 });
  });

  /** And it is somebody else's to pick up. */
  it('is taken up by whoever is standing near it', () => {
    let log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }));
    log = run(log, (s) => takeItemUp(s, SRD_CONTENT, NYX, { item: 'item:1' }));

    expect(ground(log)).toEqual([]);
    expect(quantityOf(state(log), NYX, WAND)).toBe(1);
  });
});

describe('the record a dropped copy has', () => {
  /** A copy with state of its own keeps the record it was born with. */
  it('keeps the record a charged copy already had, and its charges with it', () => {
    let log = run(room(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, 'item:1', 2));
    log = run(log, (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    log = run(log, (s) => dropItem(s, SRD_CONTENT, GRUM, { item: 'item:1' }));

    // No new record was minted, and the pool left the dropper with the wand.
    expect(state(log).itemsIssued).toBe(1);
    expect(ground(log).map((pile) => pile.instance)).toEqual(['item:1']);
    expect(poolKeys(log, GRUM)).toEqual([]);

    log = run(log, (s) => takeItemUp(s, SRD_CONTENT, NYX, { item: 'item:1' }));
    expect(lines(log, NYX, WAND).map((line) => line.instance)).toEqual(['item:1']);
    expect(chargesLeft(state(log), SRD_CONTENT, NYX, 'item:1')).toBe(1);
  });

  /**
   * A stack with no record is labelled **for as long as it lies there**, which
   * is the whole of the owner's ruling: on the floor a pile has to be tellable
   * from the identical thing still in the pack, and back in a pack it is a
   * count again. So the label is handed back at the pick-up and twenty arrows
   * are twenty arrows.
   */
  it('mints one for a stack that has none, and takes it back at the pick-up', () => {
    const log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: 'handaxe', quantity: 2 }));

    expect(state(log).itemsIssued).toBe(2);
    expect(ground(log)).toEqual([
      { instance: 'item:2', item: 'handaxe', quantity: 2, minted: true, at: { x: 30, y: 35, z: 0 } },
    ]);
    // What is left in the pack is the unlabelled remainder it always was.
    expect(lines(log, GRUM, 'handaxe').map((line) => line.instance)).toEqual([undefined]);

    const back = run(log, (s) => takeItemUp(s, SRD_CONTENT, GRUM, { item: 'item:2' }));
    expect(lines(back, GRUM, 'handaxe').map((line) => line.instance)).toEqual([undefined]);
    expect(quantityOf(state(back), GRUM, 'handaxe')).toBe(quantityOf(state(room()), GRUM, 'handaxe'));
  });

  /**
   * SRD: "Your attunement to an item ends if you no longer have the item."
   * Nobody commands that, and the derived pass that already ends it for a
   * thief in the night ends it for a thing put down — so a drop writes nothing
   * about attunement and the attunement goes anyway.
   */
  it('ends an attunement, because putting something down is no longer having it', () => {
    const cloaked = room(hoard([{ id: 'cloak-of-elvenkind', quantity: 1 }]));
    let log = run(cloaked, (s) => beginRest(s, GRUM, 'short'));
    log = run(log, (s) => attuneItem(s, SRD_CONTENT, GRUM, 'cloak-of-elvenkind'));
    expect(attunedItems(state(log), GRUM)).toEqual(['cloak-of-elvenkind']);

    log = run(log, (s) => dropItem(s, SRD_CONTENT, GRUM, { item: 'cloak-of-elvenkind' }));
    expect(attunedItems(state(log), GRUM)).toEqual([]);
  });

  /** Two piles of one kind are two piles, and a name that means both is a question. */
  it('refuses a kind of thing that names more than one pile', () => {
    let log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: 'handaxe', quantity: 1 }));
    log = run(log, (s) =>
      dropItem(s, SRD_CONTENT, GRUM, {
        item: 'handaxe',
        quantity: 1,
        placement: { from: { creature: GRUM }, feet: 5, bearing: 0 },
      }),
    );

    const refused = takeItemUp(state(log), SRD_CONTENT, GRUM, { item: 'handaxe' });
    expect(isErr(refused) && refused.code).toBe('ambiguous_pile');
  });
});

describe('what a drop and a pick-up refuse', () => {
  it('refuses to drop what nobody owns', () => {
    const refused = dropItem(state(room()), SRD_CONTENT, GRUM, { item: 'longbow' });
    expect(isErr(refused) && refused.code).toBe('not_owned');
  });

  it('refuses to drop what is worn or wielded', () => {
    const log = run(room(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    const refused = dropItem(state(log), SRD_CONTENT, GRUM, { item: 'item:1' });
    expect(isErr(refused) && refused.code).toBe('equipped');
  });

  /** A conjured thing does not land; it disappears, and there is a door for that. */
  it('refuses a conjured thing and names the door that takes one', () => {
    const armed: readonly GameEvent[] = [
      ...room(),
      {
        type: 'spellcasting-declared',
        id: GRUM,
        spellcasting: declaredCasting({ ability: 'wis', prepared: ['goodberry'] }),
      },
      {
        type: 'resource-pool-declared',
        id: GRUM,
        pool: { key: 'spell-slot:1', label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
      },
    ];
    const cast = [
      ...armed,
      ...unwrap(
        resolveSpell(
          fold('seed', armed),
          GRUM,
          { spellId: 'goodberry', targets: [], slotLevel: 1 },
          { issuer: createRollIssuer('r'), rng: createRng('s') as Rng, content: SRD_CONTENT },
        ),
        'goodberry',
      ).events,
    ];

    const refused = dropItem(fold('seed', cast), SRD_CONTENT, GRUM, { item: 'goodberry' });
    expect(isErr(refused) && refused.code).toBe('conjured');
    expect(isErr(refused) && refused.reason).toMatch(/dropConjured/);
  });

  /** A drop needs a place, so it asks where the dropper is standing. */
  it('asks where the dropper is when nobody has placed them', () => {
    const bare = run(
      [
        ...unwrap(createCharacter(SRD_CONTENT, character({ dmGrants: hoard([{ id: WAND, quantity: 1 }]) }), GRUM), 'grum'),
      ],
      (s) => setScene(s, { width: 60, depth: 60, height: 20 }),
    );
    const asked = dropItem(fold('seed', bare), SRD_CONTENT, GRUM, { item: WAND });
    expect(isNeedsContext(asked) && asked.code).toBe('unplaced');
    expect(isNeedsContext(asked) && asked.requests[0]?.satisfyWith).toMatch(/placeCreatureInScene/);
  });

  it('refuses a pick-up from across the room', () => {
    let log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }));
    log = run(log, (s) =>
      dropItem(s, SRD_CONTENT, GRUM, {
        item: 'handaxe',
        quantity: 1,
        placement: { from: { landmark: 'the table' }, feet: 25, bearing: 90 },
      }),
    );

    const refused = takeItemUp(state(log), SRD_CONTENT, GRUM, { item: 'item:2' });
    expect(isErr(refused) && refused.code).toBe('out_of_reach');
  });

  it('refuses a pick-up of something no pile answers to', () => {
    const refused = takeItemUp(state(room()), SRD_CONTENT, GRUM, { item: WAND });
    expect(isErr(refused) && refused.code).toBe('not_on_ground');
  });
});

describe('the fold is what says a dropped record is real', () => {
  const dropped = (over: Partial<Record<string, unknown>> = {}): readonly GameEvent[] => [
    ...room(),
    {
      type: 'item-dropped',
      id: GRUM,
      item: WAND,
      quantity: 1,
      instance: 'item:1',
      placement: { from: { creature: GRUM }, feet: 0 },
      source: 'put down',
      ...over,
    } as GameEvent,
  ];

  it('folds the one the command would have written', () => {
    expect(() => fold('seed', dropped())).not.toThrow();
  });

  it('refuses a minted record that is not the next one', () => {
    expect(() => fold('seed', dropped({ item: 'handaxe', instance: 'item:7' }))).toThrow(
      CorruptLogError,
    );
  });

  it('refuses a pile taken up that is not lying there', () => {
    const log: readonly GameEvent[] = [
      ...room(),
      { type: 'item-taken-up', id: NYX, item: WAND, quantity: 1, instance: 'item:1', source: 'picked up' } as GameEvent,
    ];
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
  });

  it('refuses a pile taken up under a kind it is not', () => {
    const log: readonly GameEvent[] = [
      ...dropped(),
      { type: 'item-taken-up', id: NYX, item: 'handaxe', quantity: 1, instance: 'item:1', source: 'picked up' } as GameEvent,
    ];
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
  });

  /**
   * One record, one pile. The command cannot reach this — a copy that is on
   * the floor is a copy nobody is carrying, so `copyNamed` finds nothing to
   * drop — so the geometry is asked directly, which is where a hand-written
   * log would arrive.
   */
  it('refuses a second pile under a record already lying there', () => {
    const scene = state(run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }))).scene!;
    const again = placeItemOnGround(
      scene,
      'item:1',
      { item: WAND, quantity: 1 },
      { from: { creature: GRUM }, feet: 0 },
    );
    expect(isErr(again) && again.code).toBe('already_on_ground');
  });

  /** A new room is a new room: nothing that was on the last floor is on this one. */
  it('clears the floor when the scene is set again', () => {
    let log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }));
    log = run(log, (s) => setScene(s, { width: 20, depth: 20, height: 10 }));
    expect(ground(log)).toEqual([]);
  });

  /** The same log through the shape Postgres would hand back folds the same way. */
  it('folds identically after a round trip through JSON', () => {
    const log = run(room(), (s) => dropItem(s, SRD_CONTENT, GRUM, { item: WAND }));
    const reloaded = JSON.parse(JSON.stringify(log)) as GameEvent[];
    expect(fold('seed', reloaded)).toStrictEqual(fold('seed', log));
  });
});
