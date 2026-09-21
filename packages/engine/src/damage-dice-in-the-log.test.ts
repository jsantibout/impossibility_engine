import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveSpell, rollImprovisedDamage, settleDamage } from './commands.js';
import { createRollIssuer } from './rolls.js';
import type { ReactionFeature } from './reactions.js';
import { declaredCasting, type SpellcastingState } from './spellcasting.js';

/**
 * Every damage die reaches the log, whether or not anybody could answer it.
 *
 * **Owner, 2026-09-21:** "each individual damage dice needs to reach the log,
 * specifically for spells like sorcerous burst and chromatic orb, which burst
 * on certain numbers. it also creates transparency for things like the great
 * weapon fighting style feat."
 *
 * The log drew that fact on exactly one path before this file existed. A
 * damage roll somebody may react to is held in `damage-rolled`, which carries
 * the whole `PendingDamage` — components, and on each of them the
 * `RecordedRoll` with every face. A damage roll nobody can answer never
 * reached an event at all: `damage-taken` carries a post-defence *total*, and
 * the faces that made it were discarded with the value `dealSpellDamage`
 * returned. So the same swing was fully auditable against a Rogue with Uncanny
 * Dodge and opaque against a goblin, which is not a rule — it is an accident of
 * which window happened to be open.
 *
 * `damage-dice-recorded` closes that. It is emitted by `dealSpellDamage`, the
 * one funnel every unheld damage roll passes through, so a weapon attack, a
 * spell, a scheduled hit, a backlash and a DM's improvised dice all record
 * their faces by the same route and none of them had to be taught to.
 *
 * **What it is not** is a second account of what landed. The log keeps the
 * distinction it has always drawn — a damage *roll* is what the dice showed,
 * and `damage-taken.amount` is what the target took after its defences — and
 * the Resistance test below is the one that pins both halves being readable at
 * once.
 *
 * Every assertion here reads the **log**, never the value a command returned:
 * a fact that is only in the return value is exactly the fact this brief found
 * missing.
 */

const id = (s: string) => asCharacterId(s);
const KESSA = id('kessa');
const GRUM = id('grum');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

/**
 * SRD Uncanny Dodge, on the sheet where a class puts it.
 *
 * Compiled onto the creature rather than granted by a level, because what is
 * under test is the window and not how anybody came by the feature.
 */
const UNCANNY_DODGE: ReactionFeature = {
  feature: 'rogue:uncanny-dodge',
  name: 'Uncanny Dodge',
  window: 'damage-rolled',
  costsReaction: true,
  pool: null,
  reach: { kind: 'self' },
  requiresSight: true,
  does: { kind: 'reduce-damage', amount: { halve: true }, fromAttackOnly: true },
};

const added = (
  who: CharacterId,
  side: string,
  defenses?: Record<string, { resistant?: boolean }>,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...(defenses === undefined ? {} : { defenses }),
});

const WIZARDLY: SpellcastingState = declaredCasting({
  ability: 'int',
  classId: 'wizard',
  cantrips: ['fire-bolt'],
  prepared: [],
});

const table = (
  extra: readonly GameEvent[] = [],
  defenses?: Record<string, { resistant?: boolean }>,
  goblinSheet: Partial<CharacterSheet> = {},
): readonly GameEvent[] => [
  added(KESSA, 'party'),
  added(GRUM, 'party'),
  added(GOBLIN, 'foes', defenses, goblinSheet),
  { type: 'spellcasting-declared', id: KESSA, spellcasting: WIZARDLY },
  {
    type: 'items-gained',
    id: GRUM,
    items: [{ id: 'greatsword', quantity: 1 }],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'here', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: KESSA, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: KESSA }, feet: 30, bearing: 0 },
  },
  // In the goblin's face, where a greatsword reaches it, while Kessa shoots
  // from thirty feet back — one fixture that serves both damage routes.
  { type: 'creature-placed', id: GRUM, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: KESSA, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: GRUM, to: GOBLIN, seen: true },
  ...extra,
];

/** The same table, with a goblin that can answer a damage roll. */
const DODGES: readonly GameEvent[] = table([], undefined, { reactions: [UNCANNY_DODGE] });

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * The log read the way a narrator reads it: by event type and nothing else.
 *
 * Deliberately structural rather than typed against `GameEvent`. What the
 * ruling asks for is that a reader **holding only the log** can see the faces,
 * so the reader here is given only what a JSON line would give it.
 */
interface DiceFace {
  readonly rolled: number;
  readonly value: number;
  readonly sides: number;
  readonly disposition: string;
}
interface DiceSlice {
  readonly source: string;
  readonly type: string;
  readonly dice: readonly DiceFace[];
  readonly flat: number;
  readonly total: number;
  readonly stated?: unknown;
}
interface DiceRecord {
  readonly type: string;
  readonly target: string;
  readonly source: string;
  readonly rolled: number;
  readonly components: readonly DiceSlice[];
}

const diceRecords = (log: readonly GameEvent[]): readonly DiceRecord[] =>
  (log as readonly { readonly type: string }[]).filter(
    (event) => event.type === 'damage-dice-recorded',
  ) as unknown as readonly DiceRecord[];

const facesOf = (record: DiceRecord): readonly number[] =>
  record.components.flatMap((slice) => slice.dice.map((die) => die.rolled));

const taken = (log: readonly GameEvent[]): readonly { readonly amount: number }[] =>
  log.filter((event): event is Extract<GameEvent, { type: 'damage-taken' }> =>
    event.type === 'damage-taken',
  );

/** Swing a greatsword, and hand back the whole log the swing produced. */
const swing = (
  log: readonly GameEvent[],
  seed: string,
  request: Partial<Parameters<typeof resolveAttack>[2]> = {},
): readonly GameEvent[] => {
  const out = unwrap(
    resolveAttack(
      state(log),
      GRUM,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true, ...request },
      supply(seed),
    ),
    'attack',
  );
  return out.events;
};

/** A seed whose greatsword swing lands, found once and reused. */
const LANDS = (() => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
    const out = unwrap(
      resolveAttack(
        state(table()),
        GRUM,
        { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
        supply(seed),
      ),
      'probe',
    );
    if (out.attack?.hit === true) return seed;
  }
  throw new Error('no seed in the probe set lands a greatsword on the goblin');
})();

describe('an ordinary attack’s damage dice reach the log', () => {
  /**
   * The crux of the brief. Nobody in this fixture can answer a damage roll —
   * no Uncanny Dodge, no Cutting Words — so no window opens and the swing is
   * the atomic one `landDamage` keeps atomic. Before this event existed the
   * log held `attack-made`, `attack-landed` and a `damage-taken` total, and a
   * reader without the rng could not say what the greatsword's 2d6 showed.
   */
  it('records every face a greatsword threw, readable from the log alone', () => {
    const events = swing(table(), LANDS);
    const records = diceRecords(events);
    expect(records).toHaveLength(1);

    const record = records[0]!;
    expect(record.target).toBe(GOBLIN);
    // A greatsword is 2d6, and both dice are here as dice.
    const weaponDice = record.components.find((slice) => slice.type === 'slashing')!.dice;
    expect(weaponDice).toHaveLength(2);
    for (const die of weaponDice) {
      expect(die.sides).toBe(6);
      expect(die.rolled).toBeGreaterThanOrEqual(1);
      expect(die.rolled).toBeLessThanOrEqual(6);
      expect(die.value).toBe(die.rolled);
    }
  });

  /**
   * And the record reconciles: the faces plus the flat parts are the
   * pre-defence total the event states, which against an undefended target is
   * what `damage-taken` says landed.
   */
  it('adds up to the pre-defence total, and to what landed where nothing defended', () => {
    const events = swing(table(), LANDS);
    const record = diceRecords(events)[0]!;

    for (const slice of record.components) {
      const kept = slice.dice
        .filter((die) => die.disposition !== 'dropped' && die.disposition !== 'rerolled')
        .reduce((sum, die) => sum + die.value, 0);
      expect(slice.total).toBe(kept + slice.flat);
    }
    const sum = record.components.reduce((total, slice) => total + slice.total, 0);
    expect(record.rolled).toBe(sum);
    expect(taken(events).map((event) => event.amount)).toEqual([sum]);
  });

  /** The engine threw them, so nothing claims otherwise. */
  it('marks no slice as stated when the engine threw the dice', () => {
    for (const slice of diceRecords(swing(table(), LANDS))[0]!.components) {
      expect(slice.stated).toBeUndefined();
    }
  });
});

describe('a spell’s damage dice reach the log by the same route', () => {
  /**
   * The ruling names Sorcerous Burst and Chromatic Orb, and both are spells:
   * a mechanic that bursts on a face needs the face, and a narrator describing
   * one needs it too. Fire Bolt is the SRD's smallest damaging cantrip and
   * takes the same funnel, so the route is proved rather than the spell.
   */
  it('records the faces of a Fire Bolt that landed', () => {
    // A seed whose bolt hits; the assertion is about the faces, not the hit.
    const hit = (() => {
      for (const seed of ['bolt', 'flame', 'spark', 'ember', 'ash', 'cinder', 'char']) {
        const out = unwrap(
          resolveSpell(state(table()), KESSA, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply(seed)),
          'fire bolt',
        );
        if (out.outcomes[0]?.attack?.hit === true) return out.events;
      }
      throw new Error('no seed in the probe set lands a Fire Bolt');
    })();

    const records = diceRecords(hit);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.target).toBe(GOBLIN);

    const fire = record.components.find((slice) => slice.type === 'fire')!;
    expect(fire.dice.length).toBeGreaterThanOrEqual(1);
    for (const die of fire.dice) expect(die.sides).toBe(10);
    expect(record.rolled).toBe(
      record.components.reduce((total, slice) => total + slice.total, 0),
    );
  });

  /** And dice a DM called for, which take the same funnel and no other. */
  it('records the faces of a DM’s improvised 4d6', () => {
    const out = unwrap(
      rollImprovisedDamage(
        state(table()),
        GOBLIN,
        { dice: '4d6', damageType: 'fire', source: 'the falling brazier' },
        supply('brazier'),
      ),
      'brazier',
    );
    const record = diceRecords(out.events)[0]!;
    expect(record.source).toBe('the falling brazier');
    expect(facesOf(record)).toHaveLength(4);
    expect(record.rolled).toBe(out.rolled);
  });
});

describe('a damage roll that opened a window neither loses nor doubles its faces', () => {
  /**
   * The held path already reported the faces, inside the `PendingDamage` on
   * `damage-rolled`. Nothing here may take that away, and nothing may report
   * it twice: `settleDamage` deals the damage through `resolveDamage`
   * directly rather than through `dealSpellDamage`, so the new record is
   * structurally impossible on this path rather than suppressed on it.
   */
  it('keeps the faces on `damage-rolled` and adds no second record', () => {
    const events = swing(DODGES, LANDS);
    const held = events.find(
      (event): event is Extract<GameEvent, { type: 'damage-rolled' }> =>
        event.type === 'damage-rolled',
    );
    expect(held).toBeDefined();

    // The faces are where they always were.
    const faces = held!.damage.components.flatMap((component) => component.roll?.dice ?? []);
    expect(faces.length).toBeGreaterThanOrEqual(2);

    // And the window opening did not also emit the unheld record.
    expect(diceRecords(events)).toHaveLength(0);

    // Settling it deals the damage and still adds no second copy.
    const after: readonly GameEvent[] = [...DODGES, ...events];
    const settled = unwrap(settleDamage(state(after), supply('settle')), 'settle');
    expect(diceRecords(settled.events)).toHaveLength(0);
    expect(taken(settled.events)).toHaveLength(1);
  });
});

describe('what was rolled and what landed are both readable', () => {
  /**
   * The point of keeping the two apart. A Resistance halves the total, and a
   * reader must be able to see the dice that made the bigger number as well as
   * the smaller one the target took.
   */
  it('shows the dice that made the total and the halved amount beside them', () => {
    const soft = swing(table(), LANDS);
    const tough = swing(table([], { slashing: { resistant: true } }), LANDS);

    const softRecord = diceRecords(soft)[0]!;
    const toughRecord = diceRecords(tough)[0]!;

    // The same seed throws the same dice; Resistance does not touch the roll.
    expect(facesOf(toughRecord)).toEqual(facesOf(softRecord));
    expect(toughRecord.rolled).toBe(softRecord.rolled);

    // What landed is halved, and the record did not follow it down.
    const landed = taken(tough)[0]!.amount;
    expect(landed).toBe(Math.floor(softRecord.rolled / 2));
    expect(toughRecord.rolled).toBeGreaterThan(landed);
  });
});

describe('a Critical Hit’s extra dice are in the log as dice', () => {
  /**
   * SRD: "roll the damage dice twice". A total that doubled could be a big
   * roll; four d6s where there are normally two cannot be anything else.
   */
  it('records twice the dice a greatsword normally throws', () => {
    // SRD Paralyzed: "Any attack roll against the creature has Advantage" and
    // "Any attack that hits the creature is a Critical Hit if the attacker is
    // within 5 feet." Grum is, so every hit crits — which is a rule rather
    // than a seed, and keeps the assertion about the dice.
    const paralysed: readonly GameEvent[] = [
      ...table(),
      { type: 'condition-applied', id: GOBLIN, condition: 'paralyzed', source: 'a spell' },
    ];

    const ordinary = diceRecords(swing(table(), LANDS))[0]!;
    const critEvents = swing(paralysed, LANDS);
    const crit = diceRecords(critEvents)[0]!;

    const weaponDice = (record: DiceRecord): readonly DiceFace[] =>
      record.components.find((slice) => slice.type === 'slashing')!.dice;

    expect(
      critEvents.some((event) => event.type === 'damage-taken' && event.critical === true),
    ).toBe(true);
    expect(weaponDice(ordinary)).toHaveLength(2);
    expect(weaponDice(crit)).toHaveLength(4);
    for (const die of weaponDice(crit)) expect(die.sides).toBe(6);
  });
});

describe('`stated` is absent on everything the engine threw', () => {
  /**
   * Part B's field arrives ahead of its filler: nothing produces a non-engine
   * roll through a command yet, so *every* roll in a driven log is the
   * engine's and every `stated` must be absent. Absent means "the engine threw
   * it", which is what every log ever written says — and this is the sweep
   * that keeps it true while the door for the other two sources is built.
   */
  it('finds no `stated` anywhere in a log driven through attacks, a spell and a DM’s dice', () => {
    const log: GameEvent[] = [...table()];
    log.push(...swing(log, LANDS));
    log.push(
      ...unwrap(
        resolveSpell(state(log), KESSA, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply('bolt')),
        'fire bolt',
      ).events,
    );
    log.push(
      ...unwrap(
        rollImprovisedDamage(
          state(log),
          GOBLIN,
          { dice: '4d6', damageType: 'fire', source: 'the falling brazier' },
          supply('brazier'),
        ),
        'brazier',
      ).events,
    );

    // The sweep is over the whole log, at any depth, so a `stated` smuggled
    // onto a nested record fails here too.
    const found: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'stated' && value !== undefined) found.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(log, 'log');
    expect(found).toEqual([]);

    // And the sweep is looking at something: the log really did roll dice.
    expect(diceRecords(log).length).toBeGreaterThanOrEqual(2);
  });

  /** And the sweep would see one, so an empty answer is evidence. */
  it('would find a `stated` that was there', () => {
    const found: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'stated' && value !== undefined) found.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(
      [{ type: 'roll-recorded', stated: { id: 'r1', source: 'physical-dice', note: null } }],
      'log',
    );
    expect(found).toEqual(['log[0].stated']);
  });
});

describe('the record is a record and nothing else', () => {
  /**
   * It writes no state, exactly as `roll-recorded` writes none: the damage it
   * sits beside is what moves hit points. So a log folds to the same state
   * with the record in it and with it taken out, which is what makes it
   * additive for every log written before it existed — the two frozen fixtures
   * included.
   */
  it('folds to the same state as the same log without it', () => {
    const log: readonly GameEvent[] = [...table(), ...swing(table(), LANDS)];
    const without = log.filter((event) => diceRecords([event]).length === 0);
    expect(without.length).toBe(log.length - 1);

    // `eventCount` is the fold's own tally of how long the log was and moves
    // for **every** event there has ever been, so it is the one field that
    // cannot agree and the one the comparison excludes. Everything a rule
    // reads — hit points, conditions, the generator, the pending debts — is
    // identical, which is the claim: this seam writes no state.
    const { eventCount: withRecord, ...before } = fold('seed', log);
    const { eventCount: withoutRecord, ...after } = fold('seed', without);
    expect(before).toEqual(after);
    expect(withRecord).toBe(withoutRecord + 1);
  });
});
