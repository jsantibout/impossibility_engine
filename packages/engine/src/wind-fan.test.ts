import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { tallied } from './resources.js';
import { awardItems, declareDawn, equipItem, resolveSpell } from './commands.js';

/**
 * The Wind Fan, and the one thing in the book a use of an item can do that is
 * neither working nor being refused.
 *
 * SRD: "While holding this fan, you can cast _Gust of Wind_ (save DC 13) from
 * it. Each subsequent time the fan is used before the next dawn, it has a
 * cumulative 20 percent chance of not working; if the fan fails to work, it
 * tears into useless, nonmagical tatters."
 *
 * **A failed use is an ordinary `ok`.** The engine was asked to wave the fan
 * and it waved the fan: the action went, a `1d100` fell, and the fan tore. That
 * is a missed attack's shape — `AttackResolution.attack.hit === false`, with the
 * roll stamped so a missed swing cannot be retried — rather than a fourth kind
 * of answer beside `ok`, `err` and `needs-context`, which answer whether the
 * engine could do what it was asked. So `SpellResolution.castingId` is `null`,
 * and nothing in the log says a spell was cast.
 *
 * **And the count behind the percentage is a tally rather than a pool.** A pool
 * of five would refuse the sixth use with nothing left to spend; the book rolls
 * for the sixth at a hundred percent and tears the fan. A pool refuses; the fan
 * fails.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const OTHER = id('other');

const FAN = 'wind-fan';
/** What the fan counts its uses under, which is content's to spell. */
const USES = 'wind-fan:uses';
/** A homebrew fan with the same clause and a different number on it. */
const PAPER_FAN = 'fan-of-folded-paper';
const PAPER_USES = 'fan-of-folded-paper:uses';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  /** Nobody who picks this fan up casts anything of their own. */
  spellcastingAbility: null,
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

const paperFan: CatalogueItem = {
  id: PAPER_FAN,
  name: 'Fan of Folded Paper',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'casts',
      spell: 'gust-of-wind',
      atWill: true,
      saveDc: 13,
      failsCumulatively: { percent: 50, key: PAPER_USES, recovers: 'long-rest', destroyed: true },
    },
  ],
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { items: [paperFan] }),
  'the homebrew fan',
);

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/**
 * A room for the wind to blow down.
 *
 * Gust of Wind fills a Line and a Line has to be somewhere, so the fan is
 * waved in a scene like any other area spell. Nobody stands in the Line: what
 * this file is about is the fan, and a creature being thrown by it is
 * `movement-rider.test.ts`'s.
 */
const ROOM: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the courtyard', at: { x: 100, y: 100, z: 0 } },
  {
    type: 'creature-placed',
    id: WIELDER,
    placement: { from: { landmark: 'the courtyard' }, feet: 0 },
  },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { creature: WIELDER }, feet: 100, bearing: 270 },
  },
];

/** Owned and in hand, which is the whole of SRD's "while holding this fan". */
const holding = (item = FAN): readonly GameEvent[] => {
  const base = run([added(WIELDER), added(OTHER), ...ROOM], (s) =>
    awardItems(s, supply('the-hoard'), WIELDER, [{ id: item }], 'the hoard'),
  );
  return run(base, (s) => equipItem(s, CONTENT, WIELDER, item));
};

/**
 * Uses already made today, written straight into the log.
 *
 * The events the command itself emits, so the world this stands up is one the
 * engine could have written — and the reason it is written rather than played
 * is that uses two through five fail on a percentage. A test that waved the fan
 * five times would be a test of the seed.
 */
const waved = (times: number, key = USES, recovers: 'dawn' | 'long-rest' = 'dawn'): GameEvent[] =>
  Array.from({ length: times }, () => ({
    type: 'resource-spent' as const,
    id: WIELDER,
    key,
    amount: 1,
    tally: recovers,
  }));

const wave = (log: readonly GameEvent[], seed: string, item = FAN, commandId?: string) =>
  resolveSpell(
    fold('seed', log),
    WIELDER,
    {
      spellId: 'gust-of-wind',
      targets: [],
      // Due east, away from the only other creature in the courtyard.
      towards: { x: 200, y: 100, z: 0 },
      item,
      ...(commandId === undefined ? {} : { commandId }),
    },
    supply(seed),
  );

const typesOf = (events: readonly GameEvent[]): readonly string[] => events.map((e) => e.type);

const uses = (log: readonly GameEvent[], key = USES): number =>
  tallied(fold('seed', log).creatures[WIELDER]!.resources, key);

describe('the first use of the fan cannot fail', () => {
  it('casts, and throws no die for a chance of nothing', () => {
    const log = holding();
    const out = unwrap(wave(log, 'first'), 'the first wave');

    expect(out.castingId).not.toBeNull();
    expect(typesOf(out.events)).toContain('spell-cast');
    // A die thrown against a zero would move the generator for an outcome
    // already decided, which is the quiet way a replay stops matching.
    expect(typesOf(out.events)).not.toContain('roll-recorded');
    expect(typesOf(out.events)).not.toContain('items-lost');
  });

  it('counts the use, under the key the item named', () => {
    const log = holding();
    const out = unwrap(wave(log, 'first'), 'the first wave');
    expect(uses([...log, ...out.events])).toBe(1);
  });

  it('is the ordinary casting from an item, at the fan’s own DC', () => {
    const log = holding();
    const out = unwrap(wave(log, 'first'), 'the first wave');
    const cast = out.events.find((e) => e.type === 'spell-cast');
    expect(cast?.type === 'spell-cast' && cast.route).toBe(`item:${FAN}`);
    expect(cast?.type === 'spell-cast' && cast.slotless).toBe('magic-item');

    // And the DC the fan prints is the one the casting keeps, whoever waved
    // it: the wielder here has no spellcasting ability of their own at all.
    const after = fold('seed', [...log, ...out.events]);
    expect(after.ongoing[out.castingId!]?.numbers.saveDc).toBe(13);
  });
});

describe('the sixth use tears the fan', () => {
  const fifth = (): readonly GameEvent[] => [...holding(), ...waved(5)];

  it('rolls at a hundred, and fails whatever the die was going to say', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const out = unwrap(wave(fifth(), seed), 'the sixth wave');
      expect(out.castingId).toBeNull();
      const rolled = out.events.find((e) => e.type === 'roll-recorded');
      expect(rolled?.type === 'roll-recorded' && rolled.label).toContain('against 100%');
      expect(rolled?.type === 'roll-recorded' && rolled.outcome).toBe('it fails');
    }
  });

  /**
   * The whole of what a failed use writes: the roll, the fan leaving the hand
   * it was held in, and the loss. No `spell-cast`, because nothing was cast.
   */
  it('emits the roll and the loss and no casting at all', () => {
    const out = unwrap(wave(fifth(), 'tear'), 'the sixth wave');
    expect(typesOf(out.events)).toEqual([
      'resource-spent',
      'roll-recorded',
      'rolls-issued',
      'item-unequipped',
      'items-lost',
    ]);
    expect(out.outcomes).toEqual([]);
    // And no homework for a spell nobody cast: Gust of Wind's five unmodelled
    // clauses are what a *casting* leaves to the DM, and there was none.
    expect(out.unverified).toEqual([]);
  });

  it('leaves nothing in the hand and nothing in the pack', () => {
    const log = fifth();
    const after = fold('seed', [...log, ...unwrap(wave(log, 'tear'), 'the sixth wave').events]);
    const wielder = after.creatures[WIELDER]!;
    expect(wielder.equipped.some((worn) => worn.id === FAN)).toBe(false);
    expect(wielder.inventory.some((line) => line.id === FAN)).toBe(false);
  });

  /**
   * A torn fan left standing in `equipped` is a route `itemRoute` still finds,
   * and the tatters would go on casting — which is why the loss is not the
   * whole of what a failure writes.
   */
  it('cannot be waved again once it has torn', () => {
    const log = fifth();
    const torn = [...log, ...unwrap(wave(log, 'tear'), 'the sixth wave').events];
    const again = wave(torn, 'again');
    expect(isErr(again)).toBe(true);
    expect(isErr(again) && again.code).toBe('not_equipped');
  });

  /**
   * **Nothing was cast, so nothing the caster was holding was replaced.** SRD
   * gives a creature one Concentration and starting a second casting ends the
   * first — and a casting that never happened ends nothing. The first wave's
   * Gust of Wind is still running after the sixth tore the fan.
   */
  it('does not end the casting a real one would have replaced', () => {
    const first = holding();
    const opening = unwrap(wave(first, 'first'), 'the first wave');
    const log = [...first, ...opening.events, ...waved(4)];

    const out = unwrap(wave(log, 'tear'), 'the sixth wave');
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures[WIELDER]!.concentration?.castingId).toBe(opening.castingId);
    expect(after.ongoing[opening.castingId!]).toBeDefined();
  });
});

describe('a failed use costs the action it was taken with', () => {
  const fighting = (): readonly GameEvent[] => [
    ...holding(),
    ...waved(5),
    {
      type: 'combat-started',
      combatants: [
        { id: WIELDER, initiative: 20, speed: 30 },
        { id: OTHER, initiative: 10, speed: 30 },
      ],
    },
  ];

  it('spends the Action, first of everything it writes', () => {
    const out = unwrap(wave(fighting(), 'tear'), 'the sixth wave');
    expect(typesOf(out.events)[0]).toBe('action-spent');
    const after = fold('seed', [...fighting(), ...out.events]);
    expect(after.combat?.budgets[WIELDER]?.action).toBe(false);
  });

  /**
   * And it is settled **before** the die: a fan waved out of turn costs no die,
   * no count and no fan, which is the validate-before-rolling rule this engine
   * runs on.
   */
  it('refuses a wave out of turn with the fan still whole', () => {
    const log = fighting();
    const dice = supply('out-of-turn');
    const before = { rolls: dice.issuer.count, rng: dice.rng.snapshot() };
    const out = resolveSpell(
      fold('seed', log),
      OTHER,
      { spellId: 'gust-of-wind', targets: [], item: FAN },
      dice,
    );
    expect(isErr(out)).toBe(true);
    expect(dice.issuer.count).toBe(before.rolls);
    expect(dice.rng.snapshot()).toEqual(before.rng);
  });
});

describe('a failed use is a command that landed', () => {
  it('reports the same nothing on a retry, and writes no second batch', () => {
    const log = [...holding(), ...waved(5)];
    const first = unwrap(wave(log, 'tear', FAN, 'wave-1'), 'the sixth wave');
    expect(first.castingId).toBeNull();
    expect(first.events.length).toBeGreaterThan(0);

    const once = [...log, ...first.events];
    const retry = unwrap(wave(once, 'tear', FAN, 'wave-1'), 'the retry');
    expect(retry.events).toEqual([]);
    // The ledger remembers that no casting came of it, so the retry says what
    // the first run said rather than handing back the id of a casting that has
    // not happened.
    expect(retry.castingId).toBeNull();
    expect(fold('seed', [...once, ...retry.events])).toEqual(fold('seed', once));
  });
});

describe('the count starts again at the next dawn', () => {
  it('zeroes the uses, and the fan works again', () => {
    const log = [...holding(), ...waved(5)];
    expect(uses(log)).toBe(5);

    const morning = run(log, (s) => declareDawn(s, supply('dawn')));
    expect(uses(morning)).toBe(0);

    const out = unwrap(wave(morning, 'after-dawn'), 'the wave after dawn');
    expect(out.castingId).not.toBeNull();
    expect(typesOf(out.events)).not.toContain('roll-recorded');
  });
});

describe('the percentage and the count are the item’s', () => {
  /**
   * A homebrew fan that fails twice as fast and counts until a Long Rest. The
   * clause is data: the engine names no item and no number, and a second fan
   * proves it by being a different one.
   */
  it('rolls the homebrew fan’s own number against its own count', () => {
    const log = [...holding(PAPER_FAN), ...waved(1, PAPER_USES, 'long-rest')];
    const out = unwrap(wave(log, 'paper', PAPER_FAN), 'the second wave');

    const rolled = out.events.find((e) => e.type === 'roll-recorded');
    expect(rolled?.type === 'roll-recorded' && rolled.label).toContain('against 50%');
    expect(uses([...log, ...out.events], PAPER_USES)).toBe(2);
  });

  it('follows the die it threw, and is not always the same answer', () => {
    const log = [...holding(PAPER_FAN), ...waved(1, PAPER_USES, 'long-rest')];
    const answers = new Set<boolean>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const out = unwrap(wave(log, seed, PAPER_FAN), 'a wave');
      const rolled = out.events.find((e) => e.type === 'roll-recorded');
      const total = rolled?.type === 'roll-recorded' ? rolled.total : 0;
      const torn = out.castingId === null;
      // The roll is what decided it: at or under the chance, the fan fails.
      expect(torn).toBe(total <= 50);
      answers.add(torn);
    }
    expect(answers.size, 'eight seeds and one answer is not a die').toBe(2);
  });

  it('gives the same answer twice for the same seed', () => {
    const log = [...holding(PAPER_FAN), ...waved(1, PAPER_USES, 'long-rest')];
    const once = unwrap(wave(log, 'repeat', PAPER_FAN), 'a wave');
    const again = unwrap(wave(log, 'repeat', PAPER_FAN), 'the same wave');
    expect(again.events).toEqual(once.events);
    expect(again.castingId).toBe(once.castingId);
  });
});
