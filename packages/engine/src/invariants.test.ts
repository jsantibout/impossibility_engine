import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  contextRequestsOf,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  damageCreature,
  declineOpportunity,
  pendingAttackOf,
  pendingMoveOf,
  removeCreatureEverywhere,
  endFeature,
  equipItem,
  extendFeature,
  healCreature,
  purchaseItem,
  releaseReady,
  resolveAttack,
  resolveCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
  unequipItem,
} from './commands.js';

/**
 * Invariants the whole engine owes, checked as a sweep rather than one command
 * at a time.
 *
 * Every test here was written against a hole the audit actually found. Two of
 * them are the kind that only a sweep catches:
 *
 * **An idempotency guard that silently does not engage.** A command takes a
 * `commandId`, calls `identify`, computes a fingerprint — and then emits
 * events none of which carry the stamp, so nothing is ever recorded and the
 * guard never fires. Six commands were in that state. Offering the id and not
 * honouring it is worse than not offering it, because the caller believes it
 * is protected.
 *
 * **Unknown read as no.** The engine has one error shape for "the rules say
 * no" and for "you have not told me about this yet", and an AI DM cannot act
 * on the difference. Attacking a chandelier rope nobody has declared is the
 * "DOOR NOT CREATED — INVALID OBJECT" failure: the correct answer is to
 * establish the rope, not to tell the player it cannot exist.
 */

const id = (s: string) => asCharacterId(s);
const A = id('a');
const B = id('b');
const C = id('c');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 14, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  activated: [
    { feature: 'test:stance', name: 'Stance', action: 'bonus-action', pool: null, lasts: 'end-of-next-turn' },
  ],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(A, 'party'),
  added(B, 'foes'),
  {
    type: 'items-gained',
    id: A,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'chain-shirt', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'coins-changed', id: A, copper: 100_000, source: 'a patron' },
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: A,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['inflict-wounds'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: A, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: B, placement: { from: { creature: A }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: A, to: B, seen: true },
  { type: 'sight-declared', from: B, to: A, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: A, initiative: 20, speed: 30 },
      { id: B, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 's') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** Events out of whatever shape a command hands back. */
const eventsOf = (value: unknown): readonly GameEvent[] =>
  Array.isArray(value) ? (value as GameEvent[]) : ((value as { events: GameEvent[] }).events ?? []);

/**
 * One command, invoked against a state, with the id it was given.
 *
 * A table rather than a test each, because the point is that **no** command is
 * exempt: a new one added without a working guard fails here rather than
 * waiting to be found in play.
 */
interface Guarded {
  readonly name: string;
  /** The log this command needs to be legal. */
  readonly log: readonly GameEvent[];
  readonly run: (state: GameState, commandId: string) => Result<unknown>;
}

const readied = (): readonly GameEvent[] => {
  const held = [
    ...SETUP,
    ...unwrap(takeReady(fold('s', SETUP), A, { trigger: 'when it moves', response: { kind: 'action' } }), 'ready'),
  ];
  return [...held, ...unwrap(resolveTurn(fold('s', held), supply()), 'turn').events];
};

const provoking = (): readonly GameEvent[] => {
  const out = unwrap(
    resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
    'move',
  );
  return [...SETUP, ...out.events];
};

/** A feature already switched on, so ending and extending it are legal. */
const stanced = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'feature-activated', id: A, feature: 'test:stance' },
];

const GUARDED: readonly Guarded[] = [
  {
    name: 'damageCreature',
    log: SETUP,
    run: (s, commandId) => damageCreature(s, B, { amount: 7, source: 'a trap', commandId }),
  },
  {
    name: 'healCreature',
    log: [...SETUP, ...unwrap(damageCreature(fold('s', SETUP), B, { amount: 30, source: 'a trap' }), 'd')],
    run: (s, commandId) => healCreature(s, B, 5, { commandId }),
  },
  { name: 'takeDash', log: SETUP, run: (s, commandId) => takeDash(s, A, { commandId }) },
  { name: 'takeDisengage', log: SETUP, run: (s, commandId) => takeDisengage(s, A, { commandId }) },
  { name: 'takeDodge', log: SETUP, run: (s, commandId) => takeDodge(s, A, { commandId }) },
  {
    name: 'takeReady',
    log: SETUP,
    run: (s, commandId) => takeReady(s, A, { trigger: 'when it moves', response: { kind: 'action' }, commandId }),
  },
  { name: 'releaseReady', log: readied(), run: (s, commandId) => releaseReady(s, A, { commandId }, supply()) },
  {
    name: 'declineOpportunity',
    log: provoking(),
    run: (s, commandId) => declineOpportunity(s, B, { commandId }),
  },
  {
    name: 'resolveMove',
    log: SETUP,
    run: (s, commandId) =>
      resolveMove(s, A, { placement: { from: { creature: B }, feet: 15, bearing: 180 }, commandId }, supply()),
  },
  {
    name: 'resolveAttack',
    log: SETUP,
    run: (s, commandId) => resolveAttack(s, A, { target: B, weapon: 'longsword', commandId }, supply()),
  },
  {
    name: 'resolveCast',
    log: SETUP,
    run: (s, commandId) =>
      resolveCast(s, A, { spell: 'Inflict Wounds', level: 1, slotLevel: 1, commandId }),
  },
  { name: 'resolveTurn', log: SETUP, run: (s, commandId) => resolveTurn(s, supply(), { commandId }) },
  { name: 'endFeature', log: stanced(), run: (s, commandId) => endFeature(s, A, { feature: 'test:stance', commandId }) },
  {
    name: 'extendFeature',
    log: stanced(),
    run: (s, commandId) => extendFeature(s, A, { feature: 'test:stance', by: 'attack', commandId }),
  },
  { name: 'purchaseItem', log: SETUP, run: (s, commandId) => purchaseItem(s, A, 'rope', 1, commandId) },
  { name: 'equipItem', log: SETUP, run: (s, commandId) => equipItem(s, A, 'chain-shirt', commandId) },
  {
    name: 'unequipItem',
    log: [...SETUP, ...unwrap(equipItem(fold('s', SETUP), A, 'chain-shirt'), 'eq')],
    run: (s, commandId) => unequipItem(s, A, 'chain-shirt', commandId),
  },
];

describe('a retried command changes nothing the first one did not', () => {
  /**
   * The guarantee a model-driven loop actually needs. A retry happens for
   * reasons that have nothing to do with the game — a dropped connection, a
   * `pause_turn` resume, a tool re-invocation after a stream error — and an
   * unguarded one is a second casting, a second heal, or a skipped turn.
   */
  for (const entry of GUARDED) {
    it(`${entry.name}: applying it twice lands where applying it once did`, () => {
      const first = entry.run(fold('s', entry.log), 'cmd-1');
      expect(isErr(first) ? `${first.code}: ${first.reason}` : 'ok').toBe('ok');
      if (isErr(first)) return;

      const once = [...entry.log, ...eventsOf(first.value)];
      const after = fold('s', once);

      const retry = entry.run(after, 'cmd-1');
      expect(isErr(retry) ? `${retry.code}: ${retry.reason}` : 'ok').toBe('ok');
      if (isErr(retry)) return;

      // The retry may report what the first one did, but it may not *do* it
      // again: appending its events must leave the world exactly as it was.
      const twice = fold('s', [...once, ...eventsOf(retry.value)]);
      expect(twice).toEqual(after);
    });
  }

  /** And the guard must be real rather than an unused fingerprint. */
  for (const entry of GUARDED) {
    it(`${entry.name}: the second run emits nothing at all`, () => {
      const first = entry.run(fold('s', entry.log), 'cmd-1');
      if (isErr(first)) return;
      const after = fold('s', [...entry.log, ...eventsOf(first.value)]);

      const retry = entry.run(after, 'cmd-1');
      expect(isErr(retry)).toBe(false);
      if (isErr(retry)) return;
      expect(eventsOf(retry.value)).toEqual([]);
    });
  }

  /**
   * Reusing an id for different work is refused rather than swallowed. A
   * silent no-op there is the worst available outcome: the second command
   * never runs and nobody is told.
   */
  it('refuses a command id reused for different inputs', () => {
    const first = unwrap(damageCreature(fold('s', SETUP), B, { amount: 7, source: 't', commandId: 'x' }), 'd');
    const after = fold('s', [...SETUP, ...first]);
    const reused = damageCreature(after, B, { amount: 9, source: 't', commandId: 'x' });
    expect(isErr(reused)).toBe(true);
    if (isErr(reused)) expect(reused.code).toBe('command_id_reused');
  });
});

describe('unknown is not no', () => {
  /**
   * SRD play is full of things the engine has never been told about. The
   * chandelier rope exists because the DM said so, not because anybody added a
   * row for it — and **absence from structured state is not evidence that a
   * thing does not exist**. So a command aimed at a creature with no record
   * must come back as homework, not as a verdict.
   */
  const thin: readonly { readonly name: string; readonly run: () => Result<unknown> }[] = [
    {
      name: 'attacking something nobody has declared',
      run: () => resolveAttack(fold('s', SETUP), A, { target: id('chandelier-rope'), weapon: 'longsword' }, supply()),
    },
    {
      name: 'damaging something nobody has declared',
      run: () => damageCreature(fold('s', SETUP), id('the-door'), { amount: 9, source: 'an axe' }),
    },
    {
      name: 'healing something nobody has declared',
      run: () => healCreature(fold('s', SETUP), id('the-squire'), 5),
    },
    {
      name: 'moving a creature nobody has placed',
      run: () => {
        // B never got a position. Nothing about that says B is not standing
        // somewhere — only that nobody has said where.
        const unplaced: readonly GameEvent[] = SETUP.filter(
          (e) => !(e.type === 'creature-placed' && e.id === B),
        );
        return resolveMove(
          fold('s', unplaced),
          B,
          { placement: { from: { landmark: 'here' }, feet: 10 } },
          supply(),
        );
      },
    },
  ];

  for (const entry of thin) {
    it(`${entry.name} asks rather than refuses`, () => {
      const out = entry.run();
      expect(isErr(out)).toBe(true);
      // Through the predicate a tool surface will actually branch on, rather
      // than by reading the field — the point is that this is answerable
      // without matching a growing vocabulary of error codes.
      expect(isNeedsContext(out)).toBe(true);
    });
  }

  /**
   * And the other half, or the distinction buys nothing: a rule that has
   * actually been broken under established facts stays a refusal. Nobody
   * should be able to fix these by declaring another fact.
   */
  const refusals: readonly { readonly name: string; readonly run: () => Result<unknown> }[] = [
    {
      name: 'swinging a weapon you do not own',
      run: () => resolveAttack(fold('s', SETUP), B, { target: A, weapon: 'longsword' }, supply()),
    },
    {
      name: 'casting from a slot level you have none of',
      run: () => resolveCast(fold('s', SETUP), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 9 }),
    },
    {
      name: 'acting on somebody else’s turn',
      run: () => takeDash(fold('s', SETUP), B, {}),
    },
  ];

  for (const entry of refusals) {
    it(`${entry.name} is a refusal`, () => {
      const out = entry.run();
      expect(isErr(out)).toBe(true);
      expect(isNeedsContext(out)).toBe(false);
      if (isErr(out)) expect(out.kind).toBe('refusal');
    });
  }
});

describe('a refused command leaves nothing behind', () => {
  /**
   * "Validate before rolling" as a behavioural guarantee rather than a
   * discipline: whatever a refusal touched, it did not touch the world. The
   * generator is the part that is easy to miss, because it is the caller's
   * object and a refusal that already rolled has moved it.
   */
  const refusals: readonly { readonly name: string; readonly run: (dice: ReturnType<typeof supply>) => Result<unknown> }[] = [
    {
      name: 'an attack with a weapon that is not owned',
      run: (dice) => resolveAttack(fold('s', SETUP), B, { target: A, weapon: 'longsword' }, dice),
    },
    {
      name: 'a cast with no slot of that level',
      run: () => resolveCast(fold('s', SETUP), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 9 }),
    },
    {
      name: 'a move further than the mover’s Speed',
      run: (dice) =>
        resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 100, bearing: 180 } }, dice),
    },
  ];

  for (const entry of refusals) {
    it(`${entry.name} spends no state and no dice`, () => {
      const dice = supply();
      const before = { state: fold('s', SETUP), rng: dice.rng.snapshot(), rolls: dice.issuer.count };

      const out = entry.run(dice);
      expect(isErr(out)).toBe(true);

      expect(fold('s', SETUP)).toEqual(before.state);
      expect(dice.rng.snapshot()).toEqual(before.rng);
      expect(dice.issuer.count).toBe(before.rolls);
    });
  }
});

describe('one channel for a missing fact', () => {
  /**
   * `resolveSpell` used to answer the three-state question inside its `ok`
   * value — a *success* carrying homework — while the other forty-seven
   * commands answered it with an error. The idea was right and the route was
   * wrong: a caller had to know which of two shapes this one command used, and
   * no amount of documentation makes a model's tool surface remember that.
   *
   * The property that made the original design right is what these pin: a
   * missing fact is not a verdict, it costs nothing, and the same command
   * repeated once the fact is established is the command the caller meant.
   */
  // B is in the game and nobody has said what kind of creature it is. That is
  // an ordinary state, not a broken one.
  const untyped: readonly GameEvent[] = SETUP.map((e) =>
    e.type === 'creature-added' && e.id === B
      ? ({
          type: 'creature-added',
          id: e.id,
          name: e.name,
          sheet: e.sheet,
          maxHp: e.maxHp,
          diesAtZero: e.diesAtZero ?? false,
          side: e.side,
        } as GameEvent)
      : e,
  );

  const withSlot: readonly GameEvent[] = [
    ...untyped,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person'] }),
    },
  ];

  const cast = (log: readonly GameEvent[], dice = supply()) =>
    resolveSpell(fold('s', log), A, { spellId: 'hold-person', targets: [B], slotLevel: 2 }, dice);

  it('a spell missing a fact refuses in the same shape every other command uses', () => {
    const out = cast(withSlot);
    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(true);
  });

  /** And it still says exactly what to establish, which was the point of it. */
  it('names the fact and the event that would settle it', () => {
    const requests = contextRequestsOf(cast(withSlot));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.map((r) => r.kind)).toContain('creature-type');
    expect(requests[0]?.satisfyWith.length).toBeGreaterThan(0);
  });

  it('costs nothing to ask — no slot, no dice, no state', () => {
    const dice = supply();
    const before = { state: fold('s', withSlot), rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    expect(isNeedsContext(cast(withSlot, dice))).toBe(true);

    expect(fold('s', withSlot)).toEqual(before.state);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
    expect(remaining(fold('s', withSlot).creatures.b!.resources, spellSlotKey(2))).toBe(0);
  });

  /**
   * Establishing the fact adds a fact. It does not restate the world, and the
   * cast that follows is the one the caller asked for the first time.
   */
  it('goes through once the fact is established', () => {
    const answered: readonly GameEvent[] = [
      ...withSlot,
      { type: 'creature-type-declared', id: B, creatureType: 'Humanoid' },
    ];
    const out = cast(answered);
    expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
  });

  /** A rules refusal still carries no requests: there is nothing to go and get. */
  it('offers nothing to establish when the rules simply say no', () => {
    const typed: readonly GameEvent[] = [
      ...withSlot,
      { type: 'creature-type-declared', id: B, creatureType: 'Humanoid' },
    ];
    const out = resolveSpell(
      fold('s', typed),
      A,
      { spellId: 'hold-person', targets: [B], slotLevel: 9 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(false);
    expect(contextRequestsOf(out)).toEqual([]);
  });

});

describe('a campaign cannot wedge', () => {
  /**
   * `pendingAttack` and `pendingMove` are debts, and the engine refuses to
   * advance the turn while one stands. That is the right rule and it becomes a
   * **stuck campaign** the moment the creature who owes the debt leaves the
   * game: every command that could settle it is addressed to them.
   *
   * The most ordinary way to reach it is not exotic at all — a mover provokes,
   * the Opportunity Attack kills them, the body is cleared off the board.
   */
  const heldAttack = (): readonly GameEvent[] => {
    // A bonus large enough to settle the roll outright, so the test is about
    // what a held hit does rather than about which way a die fell.
    const held = unwrap(
      resolveAttack(
        fold('s', SETUP),
        A,
        { target: B, weapon: 'longsword', hold: true, attackBonuses: [{ source: 'staged', flat: 40 }] },
        supply('hit'),
      ),
      'attack',
    );
    return [...SETUP, ...held.events];
  };

  const declaredMove = (): readonly GameEvent[] => {
    const moved = unwrap(
      resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
      'move',
    );
    return [...SETUP, ...moved.events];
  };

  it('a held attack does not outlive the attacker', () => {
    const log = heldAttack();
    expect(pendingAttackOf(fold('s', log))).not.toBeNull();

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), A), 'remove')];
    expect(pendingAttackOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  it('a held attack does not outlive its target', () => {
    const log = heldAttack();
    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];
    expect(pendingAttackOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  it('a declared move does not outlive the mover', () => {
    const log = declaredMove();
    expect(pendingMoveOf(fold('s', log))).not.toBeNull();

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), A), 'remove')];
    expect(pendingMoveOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  /**
   * A reactor leaving settles only their own Reaction. Anybody else still
   * owed one keeps it — the move is legitimately still pending, and the
   * difference between "stuck" and "waiting" is that this one can be settled.
   */
  it('a reactor leaving settles their Reaction and nobody else’s', () => {
    // A second enemy in reach, so there is somebody left to be owed one.
    const crowded: readonly GameEvent[] = [
      ...SETUP.filter((e) => e.type !== 'combat-started'),
      added(C, 'foes'),
      { type: 'creature-placed', id: C, placement: { from: { creature: A }, feet: 5, bearing: 90 } },
      { type: 'sight-declared', from: C, to: A, seen: true },
      {
        type: 'combat-started',
        combatants: [
          { id: A, initiative: 20, speed: 30 },
          { id: B, initiative: 10, speed: 30 },
          { id: C, initiative: 5, speed: 30 },
        ],
      },
    ];
    const moved = unwrap(
      resolveMove(fold('s', crowded), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
      'move',
    );
    const log = [...crowded, ...moved.events];
    const owed = pendingMoveOf(fold('s', log))!.provoked.map((p) => p.reactor);
    expect(owed).toContain(B);
    expect(owed).toContain(C);

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];
    const rest = pendingMoveOf(fold('s', gone))?.provoked.map((p) => p.reactor) ?? [];
    expect(rest).not.toContain(B);

    let settled: readonly GameEvent[] = gone;
    for (const reactor of rest) {
      settled = [...settled, ...unwrap(declineOpportunity(fold('s', settled), reactor, {}), 'decline')];
    }
    expect(pendingMoveOf(fold('s', settled))).toBeNull();
    expect(isErr(resolveTurn(fold('s', settled), supply()))).toBe(false);
  });

  /**
   * The worst of the family, because it is not a refusal but a **crash in the
   * fold**. A declared move keeps its placement so the mover still arrives
   * beside whoever they aimed at — and the Opportunity Attack that move
   * provoked is the single likeliest thing to kill that creature. Re-resolving
   * an anchor that is gone used to throw, and the offending `creature-moved`
   * was already written down: the campaign would never load again.
   */
  it('completes a move whose anchor was killed and removed', () => {
    const log = declaredMove();
    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];

    // B was the only creature owed a Reaction, so their leaving settles the
    // move on the spot — into a placement whose anchor is the creature that
    // just left.
    let settled: readonly GameEvent[] = gone;
    for (const p of pendingMoveOf(fold('s', gone))?.provoked ?? []) {
      settled = [...settled, ...unwrap(declineOpportunity(fold('s', settled), p.reactor, {}), 'decline')];
    }

    // It folds, it folds again, and the mover actually arrived somewhere.
    const after = fold('s', settled);
    expect(after.scene!.positions[A]).toBeDefined();
    expect(fold('s', settled)).toEqual(after);
  });
});

describe('play that is not a fight', () => {
  /**
   * Combat is one mode of a campaign and the rarer one. A command that needs
   * an Initiative order to work at all quietly makes exploration and social
   * play second-class — so the ones that have no business requiring turns are
   * checked against a scene with no combat in it.
   */
  const PEACE: readonly GameEvent[] = SETUP.filter((e) => e.type !== 'combat-started');

  it('an ambush: an attack lands before anybody rolled Initiative', () => {
    const out = resolveAttack(fold('s', PEACE), A, { target: B, weapon: 'longsword' }, supply());
    expect(isErr(out)).toBe(false);
  });

  it('walking across a room costs nothing when there is no turn to spend', () => {
    const out = resolveMove(
      fold('s', PEACE),
      A,
      { placement: { from: { landmark: 'here' }, feet: 100 } },
      supply(),
    );
    expect(isErr(out)).toBe(false);
  });

  it('Dodging out of combat is allowed and simply has no deadline', () => {
    const out = takeDodge(fold('s', PEACE), A, {});
    expect(isErr(out)).toBe(false);
  });
});

describe('a corrupt log is loud', () => {
  /**
   * The reducer's own claim, and the one case where it was not true. An event
   * type the switch does not recognise used to fall out of it and return
   * `undefined`, which failed several derived passes later with a TypeError
   * naming a function that had nothing to do with it.
   *
   * Today every log is built in this process by these commands, so the only
   * way in is a typo. From M3 logs come back from Postgres as JSON, where a
   * type is a string somebody wrote down last season — and a retired event
   * would silently produce an undefined world rather than saying so.
   */
  it('refuses an event type it has no rule for', () => {
    const bogus = { type: 'chandelier-swung', id: A } as unknown as GameEvent;
    expect(() => fold('s', [...SETUP, bogus])).toThrowError(/chandelier-swung/);
  });

  /** And it names the event rather than failing somewhere unrelated. */
  it('fails at the event rather than in a derived pass', () => {
    const bogus = { type: 'chandelier-swung', id: A } as unknown as GameEvent;
    let caught: unknown = null;
    try {
      fold('s', [...SETUP, bogus]);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe('CorruptLogError');
  });
});

describe('the log is the whole truth', () => {
  /**
   * The determinism guarantee, stated as behaviour: the same log folds to the
   * same state whatever seed the session was started with, because every
   * random outcome is already written down. A module reading a clock or
   * iterating a map in insertion order breaks this and nothing else would say
   * so.
   */
  it('folds identically under a different seed', () => {
    const log = busyLog();
    expect(fold('another-seed-entirely', log)).toEqual({
      ...fold('s', log),
      seed: 'another-seed-entirely',
    });
  });

  it('survives a round trip through JSON at every prefix', () => {
    const log = busyLog();
    for (let n = 0; n <= log.length; n += 1) {
      const state = fold('s', log.slice(0, n));
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  /** Replaying a prefix and then the rest is the same as replaying the whole. */
  it('folds in pieces exactly as it folds whole', () => {
    const log = busyLog();
    const whole = fold('s', log);
    for (let n = 0; n <= log.length; n += 1) {
      const piecewise = log.slice(n).reduce(applyEvent, fold('s', log.slice(0, n)));
      expect(piecewise).toEqual(whole);
    }
  });
});

/** A log with a bit of everything in it, so the sweeps above are not vacuous. */
function busyLog(): readonly GameEvent[] {
  let log: readonly GameEvent[] = SETUP;
  log = [...log, ...unwrap(takeDodge(fold('s', log), A, {}), 'dodge')];
  log = [...log, ...unwrap(resolveTurn(fold('s', log), supply('t1')), 't1').events];
  log = [
    ...log,
    ...unwrap(resolveAttack(fold('s', log), B, { target: A, weapon: null }, supply('atk')), 'atk').events,
  ];
  log = [...log, ...unwrap(resolveTurn(fold('s', log), supply('t2')), 't2').events];
  log = [
    ...log,
    ...unwrap(damageCreature(fold('s', log), B, { amount: 12, source: 'a falling rock' }), 'dmg'),
  ];
  log = [...log, ...unwrap(equipItem(fold('s', log), A, 'chain-shirt'), 'eq')];
  return log;
}
