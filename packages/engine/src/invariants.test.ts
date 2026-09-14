import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  activateFeature,
  activateSpell,
  addSceneLandmark,
  advanceTime,
  beginCombat,
  castSpell,
  declareCoverBetween,
  declareCreatureDead,
  declareCreatureSide,
  declareSightBetween,
  declareSpellcasting,
  dismountRider,
  loseItems,
  mountCreature,
  placeCreatureInScene,
  removeBonusFrom,
  setScene,
  stabiliseCreature,
  swapInitiativeBetween,
  useFreeObjectInteraction,
  applyConditionTo,
  applySpellEffect,
  damageCreature,
  declareCreatureType,
  declineOpportunity,
  endConcentration,
  grantTemporaryHpTo,
  setExhaustionLevel,
  pendingAttackOf,
  pendingMoveOf,
  removeCreatureEverywhere,
  resolvePendingSaves,
  restoreResourcesOn,
  availableChecks,
  resolveEffectCheck,
  endFeature,
  equipItem,
  extendFeature,
  healCreature,
  purchaseItem,
  releaseReady,
  resolveAttack,
  resolveAttackDamage,
  resolveCast,
  resolveMove,
  resolveDamage,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  takeDash,
  takeDisengage,
  takeDodge,
  declineDamageReaction,
  declineTestReaction,
  resolveTest,
  settleDamage,
  settleTest,
  takeDamageReaction,
  takeDamageResponse,
  takeOpportunityAttack,
  takeReady,
  takeTestReaction,
  unequipItem,
  useHealingTouch,
  useRecovery,
  useSelfHeal,
} from './commands.js';
import { beginRest } from './rest.js';

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
  healingTouch: [
    {
      feature: 'test:healing-touch',
      name: 'A Kindly Hand',
      action: 'bonus-action',
      pool: 'test:vigour',
      lifts: ['poisoned'],
      costPerCondition: 2,
    },
  ],
  selfHeals: [
    {
      feature: 'test:self-heal',
      name: 'A Draught Of Vigour',
      action: 'bonus-action',
      pool: 'test:vigour',
      dice: '1d10',
      plus: { kind: 'level', level: 5, label: 'some level' },
    },
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
    spellcasting: declaredCasting({ ability: 'int', prepared: ['inflict-wounds', 'disguise-self'] }),
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

/**
 * Circling at five feet, which provokes nothing.
 *
 * SRD offers the Opportunity Attack for *leaving* a reach, so a move that
 * starts and ends inside one is the ordinary case rather than an exotic one —
 * and it is the branch `resolveMove` takes whenever nobody is owed a swing.
 * The provoked branch has its own event to carry the stamp; this one did not,
 * which is exactly why a sweep has to exercise both.
 */
const CIRCLING = { from: { creature: B }, feet: 5, bearing: 90 } as const;

/**
 * An attack that has hit and whose damage nobody has rolled.
 *
 * The window SRD Divine Smite is cast into, and the state `resolveAttackDamage`
 * settles. A large bonus settles the attack roll outright, so the fixture is
 * the held branch every time rather than whichever way the dice fell.
 */
const holding = (): readonly GameEvent[] => [
  ...SETUP,
  ...unwrap(
    resolveAttack(
      fold('s', SETUP),
      A,
      {
        target: B,
        weapon: 'longsword',
        hold: true,
        attackBonuses: [{ source: 'the test insists', flat: 40 }],
      },
      supply(),
    ),
    'a hit held open',
  ).events,
];

/**
 * A turn-boundary save raised and left unrolled.
 *
 * Advancing without a generator is what leaves the debt in state, which is the
 * whole reason `resolvePendingSaves` exists — and the reason it needs an id:
 * it is the one settlement a caller comes back to later, from a different
 * machine, with the world some way further on.
 */
const owed = (): readonly GameEvent[] => {
  const cast = [
    ...SETUP,
    ...unwrap(
      castSpell(fold('s', SETUP), A, {
        spell: 'Hold Person',
        level: 1,
        concentration: true,
        slotLevel: 1,
      }),
      'hold person',
    ),
  ];
  const held = [
    ...cast,
    ...unwrap(
      applySpellEffect(fold('s', cast), B, 'paralyzed', A, {
        repeatSave: {
          at: 'end-of-turn',
          of: B,
          ability: 'wis',
          dc: 13,
          onSuccess: 'end-on-target',
          label: 'Wisdom save vs Hold Person',
        },
      }),
      'paralysed',
    ),
  ];
  let log: readonly GameEvent[] = held;
  // A's turn ends, then B's — and the end of B's own turn is what raises it.
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log)), `turn ${n}`).events];
  }
  return log;
};

/**
 * A pool that gives **one** use back on a Short Rest, with two spent.
 *
 * SRD writes that rule five times in the same words — Rage, both Channel
 * Divinities, Wild Shape, Second Wind. Built by hand rather than from a class
 * table, because every class that has it is also tagged `long-rest` and takes
 * the whole-refill branch first; `restoreOn` is pure over a pool, so the
 * partial branch is reachable by simply declaring one that recovers at dawn.
 * It is the branch that makes a retried restoration hand back a use nobody
 * rested for.
 */
const partiallySpent = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'resource-pool-declared',
    id: A,
    pool: {
      key: 'test:fury',
      label: 'a fury of sorts',
      max: 3,
      recovers: 'dawn',
      regainsOnShortRest: 1,
    },
  },
  { type: 'resource-spent', id: A, key: 'test:fury', amount: 2 },
];

/** A feature already switched on, so ending and extending it are legal. */
const stanced = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'feature-activated', id: A, feature: 'test:stance' },
];

/** A is concentrating on something, so dismissing it is legal. */
const concentrating = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'concentration-started', id: A, castingId: 'cast:1', spell: 'Bless', level: 1 },
];

/** A has declared a casting and not yet settled it, so there is one to settle. */
const declaring = (): readonly GameEvent[] => [
  ...SETUP,
  ...unwrap(
    resolveSpell(
      fold('s', SETUP),
      A,
      { spellId: 'inflict-wounds', targets: [B], slotLevel: 1, hold: true },
      supply(),
    ),
    'declare',
  ).events,
];

/**
 * An illusion standing there for somebody to look at.
 *
 * Disguise Self offers a check against its own casting, which is the branch of
 * `resolveEffectCheck` that emits **no settling event at all** — the stamp
 * rides on the roll alone. That is exactly the shape the sweep exists to
 * catch: a guard whose event never happens is a guard that never fires.
 */
const illusion = (): readonly GameEvent[] => {
  const cast = [
    ...SETUP,
    ...unwrap(
      resolveSpell(fold('s', SETUP), A, { spellId: 'disguise-self', targets: [], slotLevel: 1 }, supply()),
      'disguise',
    ).events,
  ];
  // On to B's turn, because the Study action that examines it is B's to spend
  // and A's went on the casting.
  return [...cast, ...unwrap(resolveTurn(fold('s', cast), supply()), 'turn').events];
};

/** A third creature nobody has typed, so declaring its type says something. */
const untyped = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'creature-added', id: C, name: C, sheet: sheet(), maxHp: 20, diesAtZero: true, side: 'foes' },
];

/**
 * A creature with a feature that gives another pool's uses back and one that
 * spends a use to heal, both built by hand rather than from a class table — so
 * the guard is tested on the mechanism rather than on the Sorcerer.
 */
const recovering = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'creature-added',
    id: C,
    name: C,
    sheet: sheet({
      recoveries: [
        {
          feature: 'test:recovery',
          name: 'A Second Wind Of Sorts',
          pool: 'test:recovery',
          restores: 'test:points',
          upTo: 'half-class-level',
          classLevel: 6,
          moment: 'declared',
        },
      ],
    }),
    maxHp: 20,
    diesAtZero: true,
    side: 'foes',
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:recovery', label: 'the feature', max: 1, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:points', label: 'points', max: 6, recovers: 'long-rest' },
  },
  { type: 'resource-spent', id: C, key: 'test:points', amount: 6 },
];

/**
 * A is hurt and has something to spend on it — a self-heal built by hand, so
 * the guard is tested on the mechanism rather than on the Fighter.
 */
const vigorous = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: 'test:vigour', label: 'vigour', max: 2, recovers: 'long-rest' },
  },
  { type: 'damage-taken', id: A, amount: 20, source: 'a trap' },
];

/**
 * A reaction feature built by hand, so the sweep tests the mechanism rather
 * than the Rogue. Three windows in one sheet, because the guards on all three
 * commands are the same guard and a table is how that gets said once.
 */
const reactive = (): CharacterSheet =>
  sheet({
    reactions: [
      {
        feature: 'test:blunt',
        name: 'Blunting',
        window: 'damage-rolled',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'reduce-damage', amount: { halve: true }, fromAttackOnly: true },
      },
      {
        feature: 'test:push',
        name: 'A Nudge From Fate',
        window: 'test-rolled',
        costsReaction: false,
        pool: null,
        reach: { kind: 'self' },
        does: {
          kind: 'intervene',
          amount: { dice: '1d4' },
          direction: 'bonus',
          tests: ['ability-check', 'saving-throw'],
          outcome: 'either',
        },
      },
      {
        feature: 'test:riposte',
        name: 'Riposte',
        window: 'damaged-by-creature',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'melee-attack', withinFeet: 5 },
      },
    ],
  });

/** B swings at A, whose Blunting holds the damage open. */
const blunting = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = [
    ...SETUP.map((e) =>
      e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
    ),
    {
      type: 'items-gained',
      id: B,
      items: [{ id: 'longsword', quantity: 1 }],
      source: 'kit',
    },
    { type: 'item-equipped', id: B, item: 'longsword' },
  ];
  // B's turn, so B may take the Attack action.
  const turned = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  const swing = unwrap(
    resolveAttack(
      fold('s', turned),
      B,
      { target: A, weapon: 'longsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(),
    ),
    'swing',
  );
  return [...turned, ...swing.events];
};

/** A has rolled a save that A's own feature could push. */
const tested = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = SETUP.map((e) =>
    e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
  );
  return [
    ...log,
    ...unwrap(
      resolveTest(fold('s', log), A, { kind: 'saving-throw', ability: 'dex', dc: 25 }, supply()),
      'test',
    ).events,
  ];
};

/** A has just been hurt by B, who is standing next to them. */
const stung = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = [
    ...SETUP.map((e) =>
      e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
    ),
    { type: 'items-gained', id: A, items: [{ id: 'mace', quantity: 1 }], source: 'kit' },
  ];
  return [
    ...log,
    ...unwrap(
      resolveDamage(fold('s', log), A, { amount: 9, source: 'Longsword', by: B }, supply()),
      'damage',
    ).events,
  ];
};

/**
 * A casting that is still running and can be acted through on a later turn.
 *
 * Vampiric Touch, because it is the shape: the casting spends the Action, the
 * turn comes round, and the spell strikes again through a record that has to
 * survive everything in between.
 */
const draining = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: ['inflict-wounds', 'disguise-self', 'vampiric-touch'],
      }),
    },
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'vampiric-touch', targets: [B], slotLevel: 3 }, supply()),
      'drain',
    ).events,
  ];
  // The casting was the Action; the turn has to come round before the spell
  // can be used again.
  let log: readonly GameEvent[] = cast;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A Spiritual Weapon standing in the scene, one turn old.
 *
 * A different shape from `draining()` above and the reason it is here: the
 * activation moves a **point** as well as rolling an attack, so a retry that
 * slipped past the guard would walk the force twenty feet a second time. The
 * casting is a Bonus Action, so the turn has to come round before it can be
 * used again.
 */
const conjured = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['spiritual-weapon'] }),
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        { spellId: 'spiritual-weapon', targets: [], at: { x: 100, y: 120, z: 0 }, slotLevel: 2 },
        supply(),
      ),
      'conjure',
    ).events,
  ];
  let log: readonly GameEvent[] = cast;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A creature standing in a Grease it has just walked into, with the save owed.
 *
 * The debt is raised by the fold of `creature-moved` rather than by any
 * command, so the retry that matters is the **settlement**: a second run would
 * roll a second Dexterity save against a slick the first one already dealt
 * with.
 *
 * Three details, each of which the fixture was silently wrong about before:
 *
 * - **A Cube does not include its point of origin**, so walking to the
 *   landmark the Grease was cast at enters nothing. Five feet further in is
 *   what puts a creature in the area, and the earlier fixture's zero-foot walk
 *   raised no debt at all — the same trap `area-triggers.test.ts` records
 *   under "a test that passes for the wrong reason".
 * - **A declared move raises nothing.** Leaving A's reach provokes, and the
 *   entry comes from the `creature-moved` that completing the move writes.
 * - **B walks in rather than A**, so the creature that owes the save still has
 *   an Action, a Bonus Action and a Reaction — which is what lets the `mayAct`
 *   sweep below say that the debt is the only reason anything was refused.
 */
const greased = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['grease'] }),
    },
    { type: 'landmark-added', name: 'the slick', at: { x: 120, y: 100, z: 0 } },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        {
          spellId: 'grease',
          targets: [],
          at: { x: 120, y: 100, z: 0 },
          towards: { x: 200, y: 100, z: 0 },
          slotLevel: 1,
        },
        supply(),
      ),
      'grease',
    ).events,
  ];
  const turned = [...cast, ...unwrap(resolveTurn(fold('s', cast), supply()), 'on to B').events];
  const declared = [
    ...turned,
    ...unwrap(
      resolveMove(
        fold('s', turned),
        B,
        { placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 } },
        supply(),
      ),
      'walking in',
    ).events,
  ];
  return [...declared, ...unwrap(declineOpportunity(fold('s', declared), A, {}), 'A lets B go')];
};

/** B on the floor at 0 hit points, which is the only state a stabilisation has. */
const DYING: readonly GameEvent[] = [
  ...SETUP,
  ...unwrap(damageCreature(fold('s', SETUP), B, { amount: 60, source: 'a spear' }), 'down'),
];

/** A carrying a bonus that no casting hung, so no cleanup would ever remove it. */
const BLESSED: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'bonus-applied',
    id: A,
    bonus: {
      source: 'a quiet word',
      bonus: { source: 'a quiet word', flat: 1 },
      applies: ['save'],
      direction: 'add',
    },
  },
];

/**
 * A Large horse beside A, because SRD requires a mount "at least one size
 * larger than a rider" and every creature in `SETUP` is Medium.
 */
const HORSE = id('horse');
const STABLED: readonly GameEvent[] = [
  ...SETUP,
  added(HORSE, 'party'),
  {
    type: 'creature-placed',
    id: HORSE,
    placement: { from: { creature: A }, feet: 10, bearing: 180, size: 'large' },
  },
];

const RIDING: readonly GameEvent[] = [
  ...STABLED,
  ...unwrap(mountCreature(fold('s', STABLED), A, HORSE, { willing: true }), 'up'),
];

const GUARDED: readonly Guarded[] = [
  {
    name: 'settleAreaEffects',
    log: greased(),
    run: (s, commandId) => settleAreaEffects(s, supply(), { commandId }),
  },
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
    name: 'resolveMove (provoking nobody)',
    log: SETUP,
    run: (s, commandId) => resolveMove(s, A, { placement: CIRCLING, commandId }, supply()),
  },
  {
    name: 'takeOpportunityAttack',
    log: provoking(),
    run: (s, commandId) => takeOpportunityAttack(s, B, { commandId }, supply()),
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
  /**
   * The five the derived sweep found missing. Each calls `identify` and each
   * was absent from the hand-written list, which is exactly the silence that
   * made the list worth deriving: three of them are top-level entry points
   * with a live guard nothing exercised.
   */
  {
    name: 'castSpell',
    log: SETUP,
    run: (s, commandId) =>
      castSpell(s, A, { spell: 'Inflict Wounds', level: 1, slotLevel: 1, commandId }),
  },
  {
    name: 'activateFeature',
    log: SETUP,
    run: (s, commandId) => activateFeature(s, A, { feature: 'test:stance', commandId }),
  },
  {
    name: 'resolveDamage',
    log: SETUP,
    run: (s, commandId) => resolveDamage(s, B, { amount: 7, source: 'a trap', commandId }, supply()),
  },
  {
    // A hit whose damage is still to be rolled — the second half of a held
    // attack, and the most retry-vulnerable shape there is, because the caller
    // has already been round the loop once to get here.
    name: 'resolveAttackDamage',
    log: holding(),
    run: (s, commandId) => resolveAttackDamage(s, A, { commandId }, supply()),
  },
  { name: 'beginRest', log: SETUP, run: (s, commandId) => beginRest(s, A, 'short', commandId) },
  /**
   * The two the audit found taking no id at all. One **rolls dice** for
   * whatever the state happens to owe, and the other takes a creature out of
   * the game — a retry of which used to report `unknown_creature` for a
   * removal that had succeeded.
   */
  {
    name: 'resolvePendingSaves',
    log: owed(),
    run: (s, commandId) => resolvePendingSaves(s, supply(), { commandId }),
  },
  {
    name: 'removeCreatureEverywhere',
    log: SETUP,
    run: (s, commandId) => removeCreatureEverywhere(s, B, { commandId }),
  },
  {
    /**
     * And the one the sweep had been excusing with a sentence that was not
     * true. A whole refill applied twice is a whole refill, but SRD's partial
     * rule is not: "you regain **one** expended use when you finish a Short
     * Rest" subtracts from `spent`, so the fixture is a pool with that rule
     * and two uses gone — where a second run gives back a use nobody rested
     * for.
     */
    name: 'restoreResourcesOn',
    log: partiallySpent(),
    run: (s, commandId) => restoreResourcesOn(s, A, 'short-rest', { commandId }),
  },
  { name: 'resolveTurn', log: SETUP, run: (s, commandId) => resolveTurn(s, supply(), { commandId }) },
  {
    // The touch that only *lifts* a condition heals nothing and rolls
    // nothing, so the stamp has nowhere to ride but the spend itself — which
    // is exactly the shape this sweep exists to catch.
    name: 'useHealingTouch',
    log: [...vigorous(), { type: 'condition-applied', id: B, condition: 'poisoned', source: 'a spider' }],
    run: (s, commandId) =>
      useHealingTouch(s, A, { feature: 'test:healing-touch', target: B, lift: ['poisoned'], commandId }),
  },
  {
    name: 'useSelfHeal',
    log: vigorous(),
    run: (s, commandId) => useSelfHeal(s, A, { feature: 'test:self-heal', commandId }, supply()),
  },
  {
    name: 'useRecovery',
    log: recovering(),
    run: (s, commandId) => useRecovery(s, C, { feature: 'test:recovery', commandId }, supply()),
  },
  { name: 'endFeature', log: stanced(), run: (s, commandId) => endFeature(s, A, { feature: 'test:stance', commandId }) },
  {
    name: 'extendFeature',
    log: stanced(),
    run: (s, commandId) => extendFeature(s, A, { feature: 'test:stance', by: 'attack', commandId }),
  },
  /**
   * The DM-facing state changes a narrating layer reaches for constantly, and
   * the ones the first sweep did not cover. Each is a mutating tool on the
   * Maestro surface, and CLAUDE.md is explicit that every one of those takes a
   * command id — a retried "you are Frightened" is a second Frightened.
   */
  {
    name: 'applyConditionTo',
    log: SETUP,
    run: (s, commandId) => applyConditionTo(s, B, 'frightened', 'a dragon', [], undefined, undefined, { commandId }),
  },
  {
    name: 'endConcentration',
    log: concentrating(),
    run: (s, commandId) => endConcentration(s, A, 'voluntary', { commandId }),
  },
  { name: 'setExhaustionLevel', log: SETUP, run: (s, commandId) => setExhaustionLevel(s, B, 2, { commandId }) },
  { name: 'grantTemporaryHpTo', log: SETUP, run: (s, commandId) => grantTemporaryHpTo(s, B, 8, { commandId }) },
  {
    name: 'declareCreatureType',
    log: untyped(),
    run: (s, commandId) => declareCreatureType(s, C, 'Fey', { commandId }),
  },
  /**
   * The interruptible casting pair. Both halves need the guard and for
   * different reasons: a retried declaration would open a second casting with
   * a second action gone, and a retried settlement would spend a second slot
   * and roll the spell's dice again.
   */
  {
    name: 'resolveSpell (declaring a casting)',
    log: SETUP,
    run: (s, commandId) =>
      resolveSpell(s, A, { spellId: 'inflict-wounds', targets: [B], slotLevel: 1, hold: true, commandId }, supply()),
  },
  {
    name: 'resolveDeclaredCast',
    log: declaring(),
    run: (s, commandId) => resolveDeclaredCast(s, supply(), { commandId }),
  },
  {
    name: 'resolveEffectCheck',
    log: illusion(),
    run: (s, commandId) =>
      resolveEffectCheck(
        s,
        B,
        { effectKey: availableChecks(s, B)[0]?.effectKey ?? 'none', commandId },
        supply(),
      ),
  },
  /**
   * The reaction windows. Every one of these is a second round trip by
   * construction, which makes them the most retry-vulnerable commands in the
   * engine — and each of their guards has to precede the validation that
   * would otherwise report the world its own first run made.
   */
  {
    name: 'takeDamageReaction',
    log: blunting(),
    run: (s, commandId) => takeDamageReaction(s, A, { feature: 'test:blunt', commandId }, supply()),
  },
  {
    name: 'declineDamageReaction',
    log: blunting(),
    run: (s, commandId) => declineDamageReaction(s, A, { commandId }),
  },
  {
    name: 'declineDamageReaction (one feature)',
    log: blunting(),
    run: (s, commandId) => declineDamageReaction(s, A, { feature: 'test:blunt', commandId }),
  },
  {
    name: 'settleDamage',
    log: blunting(),
    run: (s, commandId) => settleDamage(s, supply(), { commandId }),
  },
  {
    name: 'resolveTest',
    log: SETUP,
    run: (s, commandId) =>
      resolveTest(s, A, { kind: 'saving-throw', ability: 'dex', dc: 15, commandId }, supply()),
  },
  {
    name: 'takeTestReaction',
    log: tested(),
    run: (s, commandId) => takeTestReaction(s, A, { feature: 'test:push', commandId }, supply()),
  },
  {
    name: 'declineTestReaction',
    log: tested(),
    run: (s, commandId) => declineTestReaction(s, A, { commandId }),
  },
  {
    name: 'declineTestReaction (one feature)',
    log: tested(),
    run: (s, commandId) => declineTestReaction(s, A, { feature: 'test:push', commandId }),
  },
  { name: 'settleTest', log: tested(), run: (s, commandId) => settleTest(s, { commandId }) },
  {
    name: 'takeDamageResponse',
    log: stung(),
    run: (s, commandId) =>
      takeDamageResponse(s, A, { feature: 'test:riposte', weapon: 'mace', commandId }, supply()),
  },
  /**
   * Acting through a spell that is still running. The most retry-vulnerable
   * casting there is: it spends an Action and rolls an attack, and the attack
   * may miss — so the stamp rides on the activation rather than on damage that
   * a miss never deals.
   */
  {
    name: 'activateSpell',
    log: draining(),
    run: (s, commandId) =>
      activateSpell(s, A, { castingId: 'cast:1', targets: [B], commandId }, supply()),
  },
  {
    // And the same command when it also moves a point. A retry that got past
    // the guard would move the force a second twenty feet, which no event
    // would explain and every later range check would read.
    name: 'activateSpell (moving an origin)',
    log: conjured(),
    run: (s, commandId) =>
      activateSpell(
        s,
        A,
        { castingId: 'cast:1', targets: [], to: { x: 100, y: 140, z: 0 }, commandId },
        supply(),
      ),
  },
  /**
   * The scene-setup family, which had no commands at all until IE-012 and
   * which the sweep named the moment the module appeared — eight exports
   * handing back events with nowhere to be accounted for, which is exactly
   * the silence a derived list buys.
   *
   * `placeCreatureInScene` is the one whose guard is load-bearing rather than
   * conventional: its own first run is what makes the world answer
   * `already_placed`, so a guard written above the duplicate check would tell
   * a retry that its command was impossible when it had in fact succeeded.
   * Ninth instance of that trap in this repository, and the first met by a
   * test that existed before the command did.
   */
  {
    name: 'setScene',
    log: SETUP,
    run: (s, commandId) => setScene(s, { width: 60, depth: 40, height: 20 }, { commandId }),
  },
  {
    name: 'addSceneLandmark',
    log: SETUP,
    run: (s, commandId) => addSceneLandmark(s, 'the hearth', { x: 20, y: 30, z: 0 }, { commandId }),
  },
  {
    name: 'placeCreatureInScene',
    log: untyped(),
    run: (s, commandId) =>
      placeCreatureInScene(s, C, { from: { landmark: 'here' }, feet: 10, bearing: 90 }, { commandId }),
  },
  {
    name: 'declareSightBetween',
    log: SETUP,
    run: (s, commandId) => declareSightBetween(s, A, B, false, { commandId }),
  },
  {
    name: 'declareCoverBetween',
    log: SETUP,
    run: (s, commandId) => declareCoverBetween(s, A, B, 'half', { commandId }),
  },
  {
    name: 'beginCombat',
    log: SETUP,
    run: (s, commandId) =>
      beginCombat(
        s,
        [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ],
        { commandId },
      ),
  },
  {
    name: 'advanceTime',
    log: SETUP,
    run: (s, commandId) => advanceTime(s, 600, 'searching the vault', { commandId }),
  },
  {
    name: 'declareSpellcasting',
    log: SETUP,
    run: (s, commandId) =>
      declareSpellcasting(s, B, declaredCasting({ ability: 'wis', prepared: ['bless'] }), {
        commandId,
      }),
  },
  { name: 'purchaseItem', log: SETUP, run: (s, commandId) => purchaseItem(s, A, 'rope', 1, commandId) },
  { name: 'equipItem', log: SETUP, run: (s, commandId) => equipItem(s, A, 'chain-shirt', commandId) },
  {
    name: 'unequipItem',
    log: [...SETUP, ...unwrap(equipItem(fold('s', SETUP), A, 'chain-shirt'), 'eq')],
    run: (s, commandId) => unequipItem(s, A, 'chain-shirt', commandId),
  },
  // The nine facts a DM declares, which had no command at all until IE-016.
  {
    name: 'declareCreatureSide',
    log: SETUP,
    run: (s, commandId) => declareCreatureSide(s, B, 'the watch', { commandId }),
  },
  {
    name: 'swapInitiativeBetween',
    log: SETUP,
    run: (s, commandId) => swapInitiativeBetween(s, A, B, { commandId }),
  },
  {
    name: 'stabiliseCreature',
    log: DYING,
    run: (s, commandId) => stabiliseCreature(s, B, { commandId }),
  },
  {
    name: 'declareCreatureDead',
    log: SETUP,
    run: (s, commandId) => declareCreatureDead(s, B, 'the pit', { commandId }),
  },
  {
    name: 'loseItems',
    log: SETUP,
    run: (s, commandId) =>
      loseItems(s, A, [{ id: 'longsword', quantity: 1 }], 'a thief', { commandId }),
  },
  {
    name: 'removeBonusFrom',
    log: BLESSED,
    run: (s, commandId) => removeBonusFrom(s, A, 'a quiet word', { commandId }),
  },
  {
    name: 'useFreeObjectInteraction',
    log: SETUP,
    run: (s, commandId) => useFreeObjectInteraction(s, A, { commandId }),
  },
  {
    name: 'mountCreature',
    log: STABLED,
    run: (s, commandId) => mountCreature(s, A, HORSE, { willing: true }, { commandId }),
  },
  {
    name: 'dismountRider',
    log: RIDING,
    run: (s, commandId) =>
      dismountRider(s, A, { from: { creature: HORSE }, feet: 15, bearing: 90 }, { commandId }),
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

      // **And the first run must actually do something.** A fixture in which a
      // command succeeds by having nothing to do passes both assertions below
      // while testing neither — which is what `greased()` was silently doing,
      // by walking to the point a Grease was cast at rather than into it.
      expect(eventsOf(first.value).length, `${entry.name} did nothing`).toBeGreaterThan(0);

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
   * And the fixture must exercise the branch it was written for.
   *
   * A move that provokes takes a different exit from `resolveMove` than one
   * that does not, and only the first had an event carrying the stamp. Pinning
   * which branch this fixture reaches is what stops the sweep quietly going
   * back to covering one of the two.
   */
  it('the unprovoked move fixture really does provoke nobody', () => {
    const out = unwrap(resolveMove(fold('s', SETUP), A, { placement: CIRCLING }, supply()), 'move');
    expect(out.events.map((e) => e.type)).toEqual(['movement-spent', 'creature-moved']);
  });

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

// — the two sweeps that are derived from the module, not recalled ————————————

/**
 * The engine's own source, read so that a sweep enumerates what is *there*
 * rather than what somebody remembered to list.
 *
 * Both sweeps below were hand-written arrays until the third whole-engine
 * audit measured them: the `mayAct` list covered nine of sixteen spenders and
 * `GUARDED` was silent in both directions. A list that has to be maintained by
 * hand is a list that goes stale between the commit that adds a command and
 * the play session that finds out. The precedent is `spell-schema.test.ts`'s
 * special-case scan, and so is the discipline that goes with it: each analysis
 * is driven over a synthetic sample that it must catch, so the sweep cannot
 * quietly stop seeing anything.
 *
 * **The enumeration is a directory listing, not a list of file names**, and
 * that is the whole of what the domain split changed here. A hard-coded list
 * of the modules under `commands/` would be the hand-maintained array these
 * sweeps were written to replace, arriving one level up: a domain module added
 * and not listed is a command that silently leaves both sweeps, which is
 * exactly the silence they exist to prevent.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));

const COMMAND_MODULES = readdirSync(`${SRC}commands`)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `commands/${file}`);

const MODULE_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  [...COMMAND_MODULES, 'rest.ts'].map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
);

/**
 * The command layer's public surface, read off the barrel.
 *
 * A helper is `export`ed in its own module so a sibling may call it, and is
 * **not** a command. Before the split those were the same word because there
 * was one file, and `export` alone meant "reachable from outside the command
 * layer"; `commands.ts` is now where the two are told apart, so it is what the
 * sweeps read to know which of the modules' exports they are about.
 *
 * Without this both sweeps would widen to every cross-module helper —
 * `landDamage`, `moveWithin`, `castOrRelease` — and demand a `mayAct` guard or
 * a command id from functions that are halves of a command rather than
 * commands, which is a different claim from the one they are making.
 */
const PUBLIC_COMMANDS: readonly string[] = [
  ...readFileSync(`${SRC}commands.ts`, 'utf8').matchAll(/^export (?!type )\{([\s\S]*?)\} from/gm),
]
  .flatMap((match) => match[1]!.split(','))
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

/**
 * Everything the sweeps below are about: the command layer's public surface,
 * plus `rest.ts`, which has no barrel of its own and whose exports therefore
 * still mean what `export` used to mean in `commands.ts`.
 */
const COMMAND_SURFACE: ReadonlySet<string> = new Set([
  ...PUBLIC_COMMANDS,
  ...[
    ...MODULE_SOURCE['rest.ts']!.matchAll(/^export (?:(?:async )?function|const) (\w+)/gm),
  ].map((match) => match[1]!),
]);

/**
 * Every top-level declaration in a module, with the text that follows it.
 *
 * A body runs to the next top-level declaration, which is all the call graph
 * below needs: it asks which *names* a declaration mentions, not where they
 * sit.
 *
 * **Both `function` and `const`**, because the module already contains
 * function-valued consts (`anchoringFor`) and a classifier that recognised
 * only one form would answer "not a spender" to a shape it had simply never
 * heard of — which is what `animals.md` taught and what the two sweeps below
 * exist to stop happening to guards.
 */
const DECLARATION = /^(export )?(?:(?:async )?function|const) (\w+)/gm;

const functionsIn = (
  source: string,
): readonly { readonly name: string; readonly exported: boolean; readonly body: string }[] => {
  DECLARATION.lastIndex = 0;
  const found: { name: string; exported: boolean; at: number }[] = [];
  for (let m = DECLARATION.exec(source); m !== null; m = DECLARATION.exec(source)) {
    found.push({ name: m[2]!, exported: m[1] !== undefined, at: m.index });
  }
  return found.map((entry, i) => ({
    name: entry.name,
    exported: entry.exported,
    body: source.slice(entry.at, found[i + 1]?.at ?? source.length),
  }));
};

/**
 * Which functions spend something a creature only has so much of.
 *
 * The seeds are the action economy's own primitives in `combat.ts` and the two
 * events whose reducer takes a resource away — a pool use (`resource-spent`,
 * which is every feature's uses and a feat's free casting) and a spell slot
 * (`spell-cast`, where the slot actually goes). Everything else is reached
 * transitively, because a command that spends through a helper is spending
 * just the same: `activateFeature` never names `spendBonusAction`, and it
 * spends one.
 *
 * **`useFreeInteraction` is the sixth primitive and was missing.** A turn
 * budget has six fields and this consumes one of them — SRD's "one free
 * interaction per turn. Any additional interactions require the Utilize
 * action" — so a command that spends it is spending exactly as much as one
 * that spends a Bonus Action. Nothing called it until `useFreeObjectInteraction`
 * did, which is why the omission cost nothing and why adding the seed sweeps
 * up exactly one command.
 */
const ECONOMY = [
  'spendAction',
  'spendBonusAction',
  'spendReaction',
  'spendMovement',
  'spendAttack',
  'useFreeInteraction',
];
const SPENT_EVENTS = ["'resource-spent'", "'spell-cast'"];

const spendersIn = (source: string): ReadonlySet<string> => {
  const functions = functionsIn(source);
  const spends = new Set(ECONOMY);
  for (const fn of functions) {
    if (SPENT_EVENTS.some((event) => fn.body.includes(event))) spends.add(fn.name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const fn of functions) {
      if (spends.has(fn.name)) continue;
      if ([...spends].some((callee) => new RegExp(`\\b${callee}\\s*\\(`).test(fn.body))) {
        spends.add(fn.name);
        grew = true;
      }
    }
  }
  return new Set(functions.filter((fn) => fn.exported && spends.has(fn.name)).map((fn) => fn.name));
};

/**
 * One spender, run against a world that owes a mandatory area effect.
 *
 * The command's arguments need only be well-formed. `mayAct` is checked
 * immediately after the duplicate check and before the creature, the feature
 * or the target is looked up, which is the whole point of it — so a command
 * naming a feature nobody has is still refused for the debt, and the second
 * assertion below is what proves the debt is what did it.
 */
interface Spender {
  readonly name: string;
  readonly run: (state: GameState) => Result<unknown>;
}

/**
 * A world with an area effect owed by somebody, and a creature whose turn has
 * just begun with everything unspent.
 *
 * A is the caster and stays clear of the slick; B walks into it on B's own
 * turn, so B still has an Action, a Bonus Action and a Reaction when the debt
 * lands. Every refusal below is therefore the debt and nothing else.
 */
const owing = greased;

const SPENDERS: readonly Spender[] = [
  { name: 'takeDash', run: (s) => takeDash(s, B, {}) },
  { name: 'takeDisengage', run: (s) => takeDisengage(s, B, {}) },
  { name: 'takeDodge', run: (s) => takeDodge(s, B, {}) },
  {
    name: 'takeReady',
    run: (s) => takeReady(s, B, { trigger: 'when it moves', response: { kind: 'action' } }),
  },
  { name: 'resolveMove', run: (s) => resolveMove(s, B, { placement: CIRCLING }, supply()) },
  { name: 'resolveAttack', run: (s) => resolveAttack(s, B, { target: A, weapon: null }, supply()) },
  {
    name: 'activateSpell',
    run: (s) => activateSpell(s, B, { castingId: 'cast:1', targets: [A] }, supply()),
  },
  { name: 'activateFeature', run: (s) => activateFeature(s, B, { feature: 'test:stance' }) },
  {
    name: 'useHealingTouch',
    run: (s) => useHealingTouch(s, B, { feature: 'test:healing-touch', target: A, lift: ['poisoned'] }),
  },
  { name: 'useSelfHeal', run: (s) => useSelfHeal(s, B, { feature: 'test:self-heal' }, supply()) },
  { name: 'useRecovery', run: (s) => useRecovery(s, B, { feature: 'test:recovery' }, supply()) },
  {
    name: 'extendFeature',
    run: (s) => extendFeature(s, B, { feature: 'test:stance', by: 'bonus-action' }),
  },
  {
    name: 'resolveEffectCheck',
    run: (s) => resolveEffectCheck(s, B, { effectKey: 'condition|b|nothing' }, supply()),
  },
  {
    name: 'resolveSpell',
    run: (s) => resolveSpell(s, B, { spellId: 'inflict-wounds', targets: [A], slotLevel: 1 }, supply()),
  },
  /**
   * The named debt this list carried, now discharged.
   *
   * `resolveCast` is still the low-level half beneath `resolveSpell` — the
   * route left for a spell the engine has no definition for — but it spends an
   * Action and a slot, and "the tool surface does not expose it" is a policy
   * rather than a guard. The exemption's own text called itself "a named debt
   * rather than a settled exemption"; this is the guard it was waiting for.
   */
  {
    name: 'resolveCast',
    run: (s) => resolveCast(s, B, { spell: 'Bless', level: 1, concentration: false, slotLevel: 1 }),
  },
  /**
   * The three of the nine DM-declared events that are **not** declarations.
   *
   * SRD spends "an amount of movement equal to half your Speed" on mounting and
   * on dismounting, and caps object interactions at "one free interaction per
   * turn" — so all three draw on the turn budget and all three are found here
   * by the closure rather than by being listed. The arguments need only be
   * well-formed: `mayAct` is checked immediately after the duplicate check and
   * before the scene, the mount or the budget is looked at.
   */
  { name: 'mountCreature', run: (s) => mountCreature(s, B, A, { willing: true }) },
  {
    name: 'dismountRider',
    run: (s) => dismountRider(s, B, { from: { creature: A }, feet: 5, bearing: 180 }),
  },
  { name: 'useFreeObjectInteraction', run: (s) => useFreeObjectInteraction(s, B) },
];

/**
 * The spenders that deliberately do **not** consult `mayAct`, each with the
 * sentence that exempts it. CLAUDE.md states the policy; this is the list it
 * applies to, so that adding a command to it is a visible act.
 */
const UNGUARDED_ON_PURPOSE: Readonly<Record<string, string>> = {
  releaseReady:
    'a Reaction: it answers a window that is already open, and refusing it would strand a legal one',
  takeOpportunityAttack: 'a Reaction, taken on somebody else’s turn',
  takeDamageReaction: 'a Reaction, and it closes a window somebody else opened',
  takeTestReaction: 'a Reaction, and it closes a window somebody else opened',
  takeDamageResponse: 'a Reaction, and it closes a window somebody else opened',
  resolveAttackDamage:
    'the settlement of an attack already made — a guard here would strand the held roll',
  resolveDeclaredCast:
    'the settlement of a casting the engine is already holding open; refusing it would deadlock the window',
  castSpell:
    'the documented low-level half, for a caller reconstructing a log or scripting a fixture; the economy is already accounted for',
  endRest:
    'not an action in the turn economy: SRD spends no Action, Bonus Action or Reaction on a rest, and the Hit Dice it spends are the rest’s own payout rather than something taken during a turn. Whether an outstanding area effect should block a rest is a question neither the SRD nor this engine has asked; naming it here is how it gets asked',
};

describe('every command that spends something asks whether it may', () => {
  // Every module at once, because the closure crosses them: `resolveAttack`
  // lands its damage through `damage.ts` and casts through `casting.ts`, and
  // asking each module on its own would stop the transitive walk at the
  // import that carries it — a spender would then be invisible for no better
  // reason than which file it came to live in. `rest.ts` is in the same
  // string, because `endRest` spends Hit Dice: a pool use by the sweep's own
  // definition, in a file the first draft of this did not read at all.
  const spenders = new Set(
    [...spendersIn(Object.values(MODULE_SOURCE).join('\n'))].filter((name) =>
      COMMAND_SURFACE.has(name),
    ),
  );

  /**
   * The sweep is enumerated from the module, so a command added with a guard
   * missing has nowhere to hide: it is neither exercised below nor written
   * into the exemption list, and this fails naming it.
   */
  it('accounts for every exported spender, and invents none', () => {
    const accounted = new Set([...SPENDERS.map((s) => s.name), ...Object.keys(UNGUARDED_ON_PURPOSE)]);
    expect([...spenders].filter((name) => !accounted.has(name)).sort()).toEqual([]);
    expect([...accounted].filter((name) => !spenders.has(name)).sort()).toEqual([]);
  });

  /** And the analysis is not vacuous: it finds a spender it is shown. */
  it('would find an unguarded spender if one were added', () => {
    const smuggled = [
      'export function takeALittleSomething(state: GameState): Result<GameEvent[]> {',
      '  const spent = spendBonusAction(state.combat, id, undefined);',
      '  return ok([]);',
      '}',
    ].join('\n');
    expect([...spendersIn(smuggled)]).toEqual(['takeALittleSomething']);
    // And a command that spends nothing is not swept up with it.
    expect([...spendersIn('export function lookAtSomething(): number {\n  return 1;\n}')]).toEqual([]);
  });

  it('really does owe an area effect in this fixture', () => {
    const state = fold('s', owing());
    expect(state.owedAreaEffects.length).toBeGreaterThan(0);
    // And B is the one acting, with a turn they have barely begun to spend.
    expect(state.combat?.order[state.combat.turnIndex]?.id).toBe(B);
    expect(state.combat?.budgets[B]?.action).toBe(true);
    expect(state.combat?.budgets[B]?.bonusAction).toBe(true);
  });

  for (const spender of SPENDERS) {
    it(`${spender.name}: refused while an area effect is owed`, () => {
      const out = spender.run(fold('s', owing()));
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });

    /**
     * And it is the debt talking, not the fixture. Settling the debt and
     * running exactly the same command must produce anything *but* that
     * refusal — otherwise the assertion above would pass for a command that
     * was never reachable in this world at all.
     */
    it(`${spender.name}: and lets it through once the debt is settled`, () => {
      const log = owing();
      const settled = [...log, ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events];
      const out = spender.run(fold('s', settled));
      expect(isErr(out) ? out.code : 'ok').not.toBe('area_effect_owed');
    });
  }

  /**
   * And the guard sits **inside** the duplicate check, which is the trap this
   * repository has sprung eight times: *a retry looks at the world its own
   * first run made*, and must be told its command landed rather than told
   * about that world.
   *
   * `resolveCast` is the newest guard, so it is the one worth pinning here.
   * The debt arrives between the first run and the retry and is owed by
   * somebody else's move, which is precisely the case a guard written above
   * `once` would answer wrongly.
   */
  describe('and asks after the duplicate check, never before it', () => {
    const CAST = {
      spell: 'Bless',
      level: 1,
      concentration: false,
      slotLevel: 1,
      commandId: 'the-one-casting',
    } as const;

    /** B, with a slot, having cast once — and then caught by the slick again. */
    const castThenCaught = (): readonly GameEvent[] => {
      const log = owing();
      const settled = [
        ...log,
        ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events,
        {
          type: 'resource-pool-declared',
          id: B,
          pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
        } satisfies GameEvent,
      ];
      const cast = [...settled, ...unwrap(resolveCast(fold('s', settled), B, CAST), 'the casting')];
      // Out of the slick and back into it: the second step is what the area
      // catches, and neither is a command B sent.
      return [
        ...cast,
        { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 60, bearing: 90 } },
        { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 } },
      ];
    };

    it('tells a retry that its casting already landed', () => {
      const state = fold('s', castThenCaught());
      // The fixture really does owe something, or neither assertion means
      // anything.
      expect(state.owedAreaEffects.length).toBeGreaterThan(0);

      const retry = resolveCast(state, B, CAST);
      expect(isErr(retry) ? retry.code : 'ok').toBe('ok');
      expect(isErr(retry) ? [] : retry.value).toEqual([]);
    });

    /** And a genuinely new casting into the same world is refused. */
    it('refuses a second casting sent into that same world', () => {
      const out = resolveCast(fold('s', castThenCaught()), B, { ...CAST, commandId: 'a-second' });
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });
  });
});

/**
 * The commands that are not actions at all, and the other half of the sweep
 * above.
 *
 * `UNGUARDED_ON_PURPOSE` is the exemption list for a command that **spends**
 * something and consults `mayAct` anyway — every entry in it is a name the
 * derived sweep found and a sentence saying why the guard is absent. The
 * scene-setup family is a different claim: these commands spend nothing, so
 * the sweep never classifies one as a spender and adding a name here would
 * have failed its own "invents none" assertion. The decision would then have
 * lived nowhere.
 *
 * So it lives here, in the shape the exemption lists use and with the same
 * discipline: derived from the modules rather than typed out, so a command
 * added to either of them fails this until somebody writes the sentence — and
 * checked behaviourally, because a reason nothing tests is prose.
 *
 * **`DECLARING_MODULES` is the scope, and a module joins it only when every
 * public command in it declares rather than acts.** That is what the second
 * assertion below checks, and it is why the three DM-declared events that
 * *do* spend — `mounted`, `dismounted` and `free-interaction-used` — live in
 * `commands/movement.ts` and `commands/actions.ts` rather than beside the six
 * here. Filing them together would have forced this list to be filtered by the
 * spender analysis, and the filter would have made "none of these spends" true
 * by construction instead of by test.
 */
const DECLARING_MODULES = ['commands/scene.ts', 'commands/declarations.ts'];

const DECLARED_NOT_ACTED: Readonly<Record<string, string>> = {
  setScene:
    'not an action in the turn economy: the room the fight is happening in is a fact the DM declares, and no SRD rule spends anything to describe it',
  addSceneLandmark:
    'not an action in the turn economy: laying out the room is map-making, and a bar nobody had mentioned costs its describer nothing',
  placeCreatureInScene:
    'not an action in the turn economy: a creature walking into the scene is placed rather than moved, and SRD spends movement only on a move from somewhere',
  declareSightBetween:
    'not an action in the turn economy: whether one creature can see another is a fact about the room, declared because computing it would need walls',
  declareCoverBetween:
    'not an action in the turn economy: cover is declared for the same reason sight is, and a creature does not spend anything to be behind a bar',
  beginCombat:
    'not an action in the turn economy: it is the moment the economy starts existing, so there is no budget yet for it to spend',
  advanceTime:
    'not an action in the turn economy: outside combat there are no turns, and how long the party spent searching the vault is narration',
  declareSpellcasting:
    'not an action in the turn economy: it states what a creature with no class table can cast, which is a fact about the creature and not a casting',
  declareCreatureSide:
    'not an action in the turn economy: who counts as an ally is fiction, and a bandit being bribed costs the bandit nothing on anybody’s turn',
  swapInitiativeBetween:
    'not an action in the turn economy: SRD Alert spends nothing on the swap — "immediately after you roll Initiative, you can swap" — and at that moment no budget has been handed out yet',
  stabiliseCreature:
    'not an action in the turn economy: the Help action or the Healer’s Kit use that stabilised the creature was spent through its own command, and this records what happened to the creature on the floor',
  declareCreatureDead:
    'not an action in the turn economy: whatever killed them spent its own cost, and a death the engine did not compute is a fact somebody declares',
  loseItems:
    'not an action in the turn economy: a thief in the night, a mimic, a DM’s ruling — SRD spends nothing when something is taken away from you',
  removeBonusFrom:
    'not an action in the turn economy: a bonus stopping is the end of something, and nobody spends anything to have an effect wear off',
};

describe('the DM-declared commands declare facts rather than taking actions', () => {
  /** Every command those modules publish, read off them and off the barrel. */
  const declared = DECLARING_MODULES.flatMap((module) =>
    functionsIn(MODULE_SOURCE[module]!)
      .filter((fn) => fn.exported && COMMAND_SURFACE.has(fn.name))
      .map((fn) => fn.name),
  ).sort();

  it('accounts for every one of them, and invents none', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toEqual(Object.keys(DECLARED_NOT_ACTED).sort());
    expect(Object.values(DECLARED_NOT_ACTED).every((reason) => reason.length > 20)).toBe(true);
  });

  /**
   * And the claim is about the code rather than the comment. None of them
   * spends anything the action-economy sweep can see, and none of them names
   * `mayAct` — so a later edit that started guarding one, or that started
   * spending, fails here rather than silently changing what the list says.
   */
  it('spends nothing, and asks nothing about whose turn it is', () => {
    const spenders = spendersIn(Object.values(MODULE_SOURCE).join('\n'));
    for (const name of declared) expect([name, spenders.has(name)]).toEqual([name, false]);
    // The **code**, not the prose: the module's own docstring says it does not
    // consult `mayAct`, and a claim checked against the sentence that makes it
    // would be checking nothing.
    for (const module of DECLARING_MODULES) {
      const code = MODULE_SOURCE[module]!
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, module).not.toMatch(/\bmayAct\b/);
      // And the stripping did not simply remove the whole file.
      expect(code, module).toMatch(/\bonce\(/);
    }
  });

  /**
   * The half that bites. A creature owing a mandatory area effect may not
   * act — and the DM may still describe the room, place the creature that
   * just walked in, and start the fight. Every one of these **succeeds**
   * against the world that refuses every spender above, which is what makes
   * "these are not actions" a behaviour rather than an assertion.
   */
  const declaring: readonly { readonly name: string; readonly run: (s: GameState) => Result<unknown> }[] = [
    { name: 'setScene', run: (s) => setScene(s, { width: 400, depth: 400, height: 40 }) },
    { name: 'addSceneLandmark', run: (s) => addSceneLandmark(s, 'the hearth', { x: 20, y: 30, z: 0 }) },
    {
      name: 'placeCreatureInScene',
      run: (s) => placeCreatureInScene(s, C, { from: { landmark: 'the slick' }, feet: 30, bearing: 90 }),
    },
    { name: 'declareSightBetween', run: (s) => declareSightBetween(s, A, B, false) },
    { name: 'declareCoverBetween', run: (s) => declareCoverBetween(s, A, B, 'half') },
    {
      name: 'beginCombat',
      run: (s) =>
        beginCombat(s, [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ]),
    },
    { name: 'advanceTime', run: (s) => advanceTime(s, 600, 'the storm passes') },
    {
      name: 'declareSpellcasting',
      run: (s) => declareSpellcasting(s, B, declaredCasting({ ability: 'wis', prepared: ['bless'] })),
    },
    { name: 'declareCreatureSide', run: (s) => declareCreatureSide(s, C, 'the watch') },
    { name: 'swapInitiativeBetween', run: (s) => swapInitiativeBetween(s, A, B) },
    { name: 'stabiliseCreature', run: (s) => stabiliseCreature(s, C) },
    { name: 'declareCreatureDead', run: (s) => declareCreatureDead(s, C, 'off-screen') },
    {
      name: 'loseItems',
      run: (s) => loseItems(s, A, [{ id: 'longsword', quantity: 1 }], 'a thief'),
    },
    { name: 'removeBonusFrom', run: (s) => removeBonusFrom(s, A, 'a quiet word') },
  ];

  /**
   * The spenders' own fixture, plus what these six need to do something.
   *
   * C is a creature nobody has placed, on the floor at 0 hit points; A carries
   * a bonus no casting hung. Without those two facts `stabiliseCreature` would
   * be refused and `removeBonusFrom` would succeed by having nothing to do —
   * and a case that passes by being unreachable proves nothing, which is the
   * lesson `greased()` itself already carries.
   */
  const owedAndWatching = (): readonly GameEvent[] => [
    ...owing(),
    added(C, 'onlookers'),
    { type: 'damage-taken', id: C, amount: 60, source: 'something off-screen' },
    {
      type: 'bonus-applied',
      id: A,
      bonus: {
        source: 'a quiet word',
        bonus: { source: 'a quiet word', flat: 1 },
        applies: ['save'],
        direction: 'add',
      },
    },
  ];

  it('covers every command those modules publish', () => {
    expect(declaring.map((entry) => entry.name).sort()).toEqual(declared);
  });

  it('really does owe an area effect in this fixture', () => {
    expect(fold('s', owedAndWatching()).owedAreaEffects.length).toBeGreaterThan(0);
  });

  for (const entry of declaring) {
    it(`${entry.name}: allowed while an area effect is owed`, () => {
      const out = entry.run(fold('s', owedAndWatching()));
      expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
    });
  }
});

/**
 * Which exports hand back events, so the idempotency sweep can be told what it
 * has not covered.
 *
 * Read off the declared return type rather than guessed: `Result<GameEvent[]>`
 * or a `Result<X>` whose `X` carries an `events` field. A named type nothing
 * declares is reported rather than skipped — a classifier that silently
 * answers "no" to a shape it does not understand reports no problems and
 * checks nothing, which is what `animals.md` taught.
 */
const DECLARATIONS = Object.values(MODULE_SOURCE)
  .join('\n')
  .concat(
    ['attack.ts', 'combat.ts', 'duration.ts', 'events.ts', 'positioning.ts', 'resources.ts', 'spells.ts']
      .map((f) => readFileSync(`${SRC}${f}`, 'utf8'))
      .join('\n'),
  );

const returnTypesIn = (
  source: string,
): readonly { readonly name: string; readonly returns: string }[] => {
  const lines = source.split('\n');
  const found: { name: string; returns: string }[] = [];
  // Both declaration forms and both signature layouts. A function-valued
  // export whose shape is matched by none of these comes back with an empty
  // return type and is reported by the test below, rather than being quietly
  // classified as "hands the caller no events" — the failure mode `animals.md`
  // taught and the one these sweeps exist to prevent.
  const OPENS = [/^export (?:async )?function (\w+)\(/, /^export const (\w+) = (?:async )?\(/];
  const INLINE = [
    /^export (?:async )?function \w+\(.*\): (.+) \{$/,
    /^export const \w+ = (?:async )?\(.*\): (.+?) =>/,
  ];
  const CLOSES = [/^\): (.+) \{$/, /^\): (.+?) =>/];

  for (let i = 0; i < lines.length; i += 1) {
    const head = OPENS.map((re) => re.exec(lines[i]!)).find((m) => m !== null);
    if (head === undefined || head === null) continue;
    const inline = INLINE.map((re) => re.exec(lines[i]!)).find((m) => m !== null);
    if (inline !== undefined && inline !== null) {
      found.push({ name: head[1]!, returns: inline[1]! });
      continue;
    }
    let returns = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const close = CLOSES.map((re) => re.exec(lines[j]!)).find((m) => m !== null);
      if (close !== undefined && close !== null) {
        returns = close[1]!;
        break;
      }
      if (/^(export )?(?:(?:async )?function|const) /.test(lines[j]!)) break;
    }
    found.push({ name: head[1]!, returns });
  }
  return found;
};

/**
 * Whether a type expression has a `|` at its own level, rather than inside a
 * type argument, an object or a tuple.
 */
const isUnion = (payload: string): boolean => {
  let depth = 0;
  for (const character of payload) {
    if ('<{(['.includes(character)) depth += 1;
    else if ('>})]'.includes(character)) depth -= 1;
    else if (character === '|' && depth === 0) return true;
  }
  return false;
};

/** Whether a declared return type hands the caller events. */
const carriesEvents = (returns: string): boolean | 'unresolved' => {
  const inner = /^Result<([\s\S]*)>$/.exec(returns.trim());
  if (inner === null) return false;
  const payload = inner[1]!.trim().replace(/^readonly /, '');
  // **A union is not a shape this can classify**, and answering `false` was
  // the silence the whole classifier exists to prevent: one arm may carry
  // events and another may not, so `Result<A | B>` needs a person to look
  // rather than a regex that has quietly decided. IE-003's reviewer left this
  // as the one place the classifier still answered "no" to something it had
  // simply never heard of.
  if (isUnion(payload)) return 'unresolved';
  if (/^GameEvent\[\]$/.test(payload)) return true;
  if (/readonly events:/.test(payload)) return true;
  if (!/^[A-Z]\w*$/.test(payload)) return false;
  const declared = new RegExp(
    `export interface ${payload}(?: extends [^{]+)? \\{([\\s\\S]*?)\\n\\}`,
  ).exec(DECLARATIONS);
  if (declared === null) return 'unresolved';
  return /readonly events:/.test(declared[1]!);
};

/**
 * Event-returning exports that deliberately take no command id, each with the
 * reason. CLAUDE.md names four as fixture and log-reconstruction halves; the
 * rest are pure builders that emit an event without deciding anything.
 */
const UNIDENTIFIED_ON_PURPOSE: Readonly<Record<string, string>> = {
  applySpellEffect:
    'a builder for a caller reconstructing a log or scripting a fixture; it decides nothing and spends nothing',
  endSpellEffectOn:
    'a builder for a caller reconstructing a log or scripting a fixture; it decides nothing and spends nothing',
  declareResourcePool: 'declaring a pool twice is refused outright, so a retry cannot double one',
  endRest:
    'a rest ends once: a retry finds nobody resting and is refused `not_resting`, so no Hit Die is rolled twice — but the caller cannot tell that from never having rested, which is a gap this sweep now names rather than an exemption it endorses',
};

describe('the idempotency sweep covers every command that hands back events', () => {
  // Every module, and only the exports the barrel publishes as commands: a
  // cross-module helper is `export`ed so a sibling can call it, and demanding
  // a command id from half a command is a different claim from the one this
  // sweep makes.
  const eventReturning = Object.keys(MODULE_SOURCE).flatMap((file) =>
    returnTypesIn(MODULE_SOURCE[file]!)
      .filter((entry) => COMMAND_SURFACE.has(entry.name))
      .map((entry) => ({ file, ...entry })),
  );

  it('classifies every export’s return type, resolving every named one', () => {
    const unresolved = eventReturning
      .filter((entry) => carriesEvents(entry.returns) === 'unresolved')
      .map((entry) => `${entry.name}: ${entry.returns}`);
    expect(unresolved).toEqual([]);
  });

  /**
   * And it read a return type off **every** function-valued export, rather
   * than off the ones whose declaration form it happened to recognise. A
   * signature laid out in a way the regexes do not know comes back empty here
   * instead of silently answering "no events", which is the whole difference
   * between a guard and a guard-shaped thing.
   */
  it('reads a return type off every function-valued export', () => {
    const silent = eventReturning.filter((entry) => entry.returns.trim() === '');
    expect(silent.map((entry) => `${entry.file}:${entry.name}`)).toEqual([]);

    // And it saw as many commands as the modules declare, so a form it does
    // not open at all cannot go unnoticed either.
    for (const file of Object.keys(MODULE_SOURCE)) {
      const declared = functionsIn(MODULE_SOURCE[file]!)
        .filter((fn) => fn.exported && COMMAND_SURFACE.has(fn.name))
        .filter((fn) => /^(export const \w+ = (?:async )?\(|export (?:async )?function)/m.test(fn.body))
        .map((fn) => fn.name)
        .sort();
      const classified = returnTypesIn(MODULE_SOURCE[file]!)
        .filter((entry) => COMMAND_SURFACE.has(entry.name))
        .map((entry) => entry.name)
        .sort();
      expect(classified, file).toEqual(declared);
    }
  });

  /**
   * The list `CLAUDE.md` claims is authoritative, made so. Every export whose
   * return carries events is either run twice under one id above, or written
   * down here with the reason it is not.
   */
  it('leaves no event-returning export unaccounted for', () => {
    const swept = new Set(GUARDED.map((entry) => entry.name.replace(/ \(.*\)$/, '')));
    const missing = eventReturning
      .filter((entry) => carriesEvents(entry.returns) === true)
      .map((entry) => entry.name)
      .filter((name) => !swept.has(name) && UNIDENTIFIED_ON_PURPOSE[name] === undefined)
      .sort();
    expect(missing).toEqual([]);
  });

  /** No stale exemptions: a name here must still be an export that returns events. */
  it('keeps no exemption for a command that no longer needs one', () => {
    const carriers = new Set(
      eventReturning.filter((entry) => carriesEvents(entry.returns) === true).map((e) => e.name),
    );
    expect(Object.keys(UNIDENTIFIED_ON_PURPOSE).filter((name) => !carriers.has(name))).toEqual([]);
    expect(Object.values(UNIDENTIFIED_ON_PURPOSE).every((reason) => reason.length > 20)).toBe(true);

    // **And an exemption is not a note.** A command that is in the sweep does
    // not need excusing from it, and a reason written beside one reads as a
    // decision when it is a remark — which is how `castSpell` came to sit in
    // both lists, exempted from a sweep that was already running it.
    const swept = new Set(GUARDED.map((entry) => entry.name.replace(/ \(.*\)$/, '')));
    expect(Object.keys(UNIDENTIFIED_ON_PURPOSE).filter((name) => swept.has(name))).toEqual([]);
  });

  /** The same rule on the other side: a spender is guarded or exempt, never both. */
  it('leaves no command both swept and exempted in the action-economy list', () => {
    const run = new Set(SPENDERS.map((entry) => entry.name));
    expect(Object.keys(UNGUARDED_ON_PURPOSE).filter((name) => run.has(name))).toEqual([]);
    expect(Object.values(UNGUARDED_ON_PURPOSE).every((reason) => reason.length > 20)).toBe(true);
  });

  /**
   * And the idempotency machinery sits **below** the command layer.
   *
   * `rest.ts` used to import `identify` from `commands.ts` — one upward edge
   * in an otherwise acyclic value graph, and the kind that turns into a real
   * cycle the first time the command layer wants something a rest knows. The
   * helper is not a rule about any particular command, so it has a module of
   * its own and everybody imports downwards.
   */
  it('keeps the idempotency helper below the commands that use it', () => {
    expect(/from '\.\/commands\.js'/.test(MODULE_SOURCE['rest.ts']!)).toBe(false);
    expect(/from '\.\/idempotency\.js'/.test(MODULE_SOURCE['rest.ts']!)).toBe(true);
    const helper = readFileSync(
      `${fileURLToPath(new URL('.', import.meta.url))}idempotency.ts`,
      'utf8',
    );
    // And it imports nothing from either of them, so the edge cannot come back.
    expect(/from '\.\/(commands|rest)\.js'/.test(helper)).toBe(false);
  });

  /** And the classifier is not vacuous: it finds one it is shown. */
  it('would find an unguarded event-returning export if one were added', () => {
    const smuggled = [
      'export function doSomethingUntracked(',
      '  state: GameState,',
      '): Result<GameEvent[]> {',
      '  return ok([]);',
      '}',
      'export function lookSomethingUp(state: GameState): number {',
      '  return 1;',
      '}',
      // And a union, which no export declares today: one arm may carry events
      // and another may not, so the honest answer is that a person has to
      // look. Answering `false` was the last place this classifier still said
      // "no" to a shape it had simply never heard of.
      'export function answerOneWayOrAnother(state: GameState): Result<SettledDamage | number> {',
      '  return ok(1);',
      '}',
    ].join('\n');
    const classified = returnTypesIn(smuggled).map((e) => [e.name, carriesEvents(e.returns)]);
    expect(classified).toEqual([
      ['doSomethingUntracked', true],
      ['lookSomethingUp', false],
      ['answerOneWayOrAnother', 'unresolved'],
    ]);
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
      // A Reaction that answers "a creature within 5 feet" needs both
      // creatures to be standing somewhere. Nobody has placed either, and
      // where a creature is standing has no right answer until somebody says.
      name: 'answering damage from somebody nobody has placed',
      run: () => {
        const unplaced: readonly GameEvent[] = stung().filter(
          (e) => !(e.type === 'creature-placed'),
        );
        return takeDamageResponse(
          fold('s', unplaced),
          A,
          { feature: 'test:riposte', weapon: 'mace' },
          supply(),
        );
      },
    },
    {
      name: 'rolling a test for somebody nobody has declared',
      run: () =>
        resolveTest(
          fold('s', SETUP),
          id('the-porter'),
          { kind: 'saving-throw', ability: 'dex', dc: 12 },
          supply(),
        ),
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

    /**
     * And it says *what* is missing. A `needs-context` with no request is
     * "go and find out" with the "what" left in a prose string, and the layer
     * above is back to matching error codes — the thing the predicate above
     * exists to make unnecessary. The four-step contract in docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md is
     * identify the fact, say why, say how; a bare code is none of them.
     */
    it(`${entry.name} names the fact it is missing`, () => {
      const out = entry.run();
      const requests = contextRequestsOf(out);
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.subject.length).toBeGreaterThan(0);
        expect(request.satisfyWith.length).toBeGreaterThan(0);
      }
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

/**
 * Every declared event type, and whether anything can produce one.
 *
 * `GameState` is a fold over `GameEvent`, so a type nothing emits is a piece
 * of the rules the layer above cannot reach: a tool surface calls commands and
 * never appends events itself, which is the whole of why appending one would
 * be the model asserting a mechanical fact. Seventeen of the ninety-one types
 * were in that state when IE-009 measured it, eight of them closed by
 * `commands/scene.ts` and the other nine by this batch.
 *
 * **Derived on both sides, and by the method `CLAUDE.md` already states.** The
 * declared types are the `readonly type: '<x>'` literals in the union; the
 * emitted ones are those literals in a **`type:` position** in any runtime
 * module under `src/` other than `events.ts`, which declares them and whose
 * reducer `case` labels are not emissions. The `type:` position is the
 * load-bearing half rather than pedantry: a `ContextRequest`'s `satisfyWith`
 * *names* an event it does not write, and under the looser reading
 * `creature-placed` came out emitted while nothing emitted it.
 */
const EVENT_TYPE_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'events.ts')
    .map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
);

/**
 * The union's members, split at the `|` that begins each one — rather than by
 * matching to the next closing brace, which runs straight past a member
 * written on one line and reads the *next* member's fields.
 *
 * The union is cut out of the file first, at the `};` that closes its last
 * member. Without that the **last** member's chunk runs to end of file and
 * carries three thousand lines of reducer with it, so a stamp declaration
 * anywhere below would answer for a member that had lost its own.
 */
const EVENT_MEMBERS = new Map<string, string>();
{
  const file = readFileSync(`${SRC}events.ts`, 'utf8');
  const opens = file.indexOf('export type GameEvent =');
  const CLOSES = '\n    };';
  const union = file.slice(opens, file.indexOf(CLOSES, opens) + CLOSES.length);
  for (const chunk of union.split(/^  \| /m).slice(1)) {
    const named = /readonly type: '([a-z-]+)'/.exec(chunk);
    if (named !== null) EVENT_MEMBERS.set(named[1]!, chunk);
  }
}

/** Which of a set of declared types no source in the given map writes. */
const emittedNowhere = (
  declared: Iterable<string>,
  sources: Readonly<Record<string, string>>,
): readonly string[] => {
  const text = Object.values(sources).join('\n');
  return [...declared].filter((type) => !new RegExp(`\\btype: '${type}'`).test(text)).sort();
};

describe('every declared event type is reachable from a command', () => {
  /**
   * And it read the **whole** union. Cutting the union out of the file bounds
   * the last member's chunk, and a cut that landed early would drop members
   * silently — leaving every assertion below true of a smaller set. So the
   * count is held against every distinct `readonly type:` literal in the file,
   * which is the reading `persistence.test.ts` takes and needs no cut at all.
   */
  it('read every member of the union', () => {
    const everywhere = new Set(
      [...readFileSync(`${SRC}events.ts`, 'utf8').matchAll(/readonly type: '([a-z-]+)'/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(EVENT_MEMBERS.size).toBeGreaterThan(80);
    expect([...EVENT_MEMBERS.keys()].sort()).toEqual([...everywhere].sort());
  });

  /**
   * The whole point, and the assertion the nine DM-declared commands exist to
   * make true. Nothing is exempt: a new event type declared with no producer
   * fails here on the day it is written rather than on the day M2 goes looking
   * for a tool that can reach it.
   */
  it('leaves no declared type that nothing in the engine emits', () => {
    expect(emittedNowhere(EVENT_MEMBERS.keys(), EVENT_TYPE_SOURCE)).toEqual([]);
  });

  /**
   * And the analysis is not vacuous: shown a type nothing writes, it says so.
   *
   * Synthetic on both sides, the way the action-economy sweep drives its own
   * smuggled spender, because a sweep proved only against the repository it
   * runs on is a sweep that can quietly stop seeing anything.
   */
  it('would find a declared type that no source emits', () => {
    const sources = { 'a-module.ts': "ok([{ type: 'a-real-event', id }]);" };
    expect(emittedNowhere(['a-real-event', 'a-fictional-event'], sources)).toEqual([
      'a-fictional-event',
    ]);
  });

  /** And a `satisfyWith` naming an event is not an emission of it. */
  it('does not count a context request that merely names one', () => {
    const sources = { 'a-module.ts': "satisfyWith: 'a-real-event'," };
    expect(emittedNowhere(['a-real-event'], sources)).toEqual(['a-real-event']);
  });

  /**
   * **Where the command layer is drawn changes the answer, so it is named
   * rather than assumed.** Read as the sweeps above read it — every module
   * under `commands/`, plus `rest.ts` — five types come back, and every one of
   * them is emitted by `creation.ts`. That is a question about where a command
   * lives rather than about whether one exists, and it is the only such
   * question left: `createCharacter` and `advanceCharacter` predate the command
   * layer, take no `CommandIdentity`, and are not in `commands.ts`'s barrel, so
   * the sweeps that read that barrel do not see them either.
   */
  const OUTSIDE_THE_COMMAND_LAYER: Readonly<Record<string, string>> = {
    'creature-added':
      'emitted by `createCharacter` in `creation.ts`, which predates the command layer, takes no CommandIdentity and is not published through the `commands.ts` barrel',
    'character-created': 'emitted by `createCharacter` in `creation.ts`, for the same reason',
    'character-advanced': 'emitted by `advanceCharacter` in `creation.ts`, for the same reason',
    'hit-point-maximum-raised':
      'emitted by `advanceCharacter` in `creation.ts`, which pays out the hit points a level granted',
    'resource-pool-resized':
      'emitted by `advanceCharacter` in `creation.ts`, which grows a pool the level made bigger',
  };

  it('names the five that `creation.ts` emits and no command does', () => {
    const commandLayer = Object.fromEntries(
      [...COMMAND_MODULES, 'rest.ts'].map((file) => [file, MODULE_SOURCE[file]!]),
    );
    expect(emittedNowhere(EVENT_MEMBERS.keys(), commandLayer)).toEqual(
      Object.keys(OUTSIDE_THE_COMMAND_LAYER).sort(),
    );
    expect(Object.values(OUTSIDE_THE_COMMAND_LAYER).every((why) => why.length > 20)).toBe(true);
  });

  /** And each exemption's claim is checked rather than taken on its word. */
  it('and `creation.ts` really does emit every one of them', () => {
    const creation = { 'creation.ts': readFileSync(`${SRC}creation.ts`, 'utf8') };
    expect(emittedNowhere(Object.keys(OUTSIDE_THE_COMMAND_LAYER), creation)).toEqual([]);
  });
});

/**
 * Every event a command stamps declares that it may carry one.
 *
 * **The compiler does not check this, and that is the point.**
 * Excess-property checking on a union accepts a field *any* member declares,
 * so `{ type: 'scene-set', extent, command }` compiles whether or not
 * `scene-set` says it may carry a stamp — verified by mutation: deleting the
 * declaration from `events.ts` leaves `npm run typecheck` completely silent.
 * `recordCommand` is generic and remembers it either way, so nothing fails at
 * runtime either.
 *
 * This repository has recorded that trap twice — once for a `command` stamp on
 * an event that did not declare it, once for a casting's `route` — and both
 * times the cost was the same: a field in the log that no reader of the type
 * could see. So the claim is read off both sources and held against itself.
 *
 * **It reads the stamp rather than the module**, which is what let it become a
 * directory listing. Scoping it by module was fine while every event a module
 * wrote carried a stamp, which was true of `commands/scene.ts` alone;
 * `commands/movement.ts` writes `movement-spent` without one. So each
 * `...(stamp === null` spread is attributed to the nearest `type:` literal
 * above it — the object it is a property of — and a module whose stamps that
 * cannot read fails rather than going quiet.
 */
describe('every event a command stamps declares that it carries one', () => {
  const STAMP = '...(stamp === null';

  /** The event each stamp spread is written onto, per module. */
  const attributed = (source: string): readonly (string | null)[] =>
    source
      .split(STAMP)
      .slice(0, -1)
      .map((chunk) => [...chunk.matchAll(/\btype: '([a-z-]+)'/g)].at(-1)?.[1] ?? null);

  /**
   * The one module whose stamp cannot be attributed, with the reason.
   *
   * `resolveTest` spreads its stamp onto `recordD20Test(...)`, whose `type` is
   * written inside that helper rather than at the call site — so there is no
   * literal above it to attribute it to. It is `roll-recorded`, which declares
   * a stamp, and the assertion below says so rather than leaving the gap
   * silent.
   */
  const UNATTRIBUTABLE: Readonly<Record<string, string>> = {
    'commands/reactions.ts':
      'one stamp is spread onto `recordD20Test(...)`, which builds the event and its `type` inside the helper, so no literal at the call site can name it; it is `roll-recorded`',
  };

  it('attributes every stamp in every command module but the one named', () => {
    const blind = Object.keys(MODULE_SOURCE)
      .filter((file) => attributed(MODULE_SOURCE[file]!).includes(null))
      .sort();
    expect(blind).toEqual(Object.keys(UNATTRIBUTABLE).sort());
    expect(Object.values(UNATTRIBUTABLE).every((why) => why.length > 20)).toBe(true);
    // And the one it cannot see would have passed anyway.
    expect(EVENT_MEMBERS.get('roll-recorded')!).toMatch(/readonly command\?: CommandStamp/);
  });

  const stamped = new Set(
    Object.values(MODULE_SOURCE)
      .flatMap((source) => attributed(source))
      .filter((type): type is string => type !== null),
  );

  it('found the events the command layer stamps', () => {
    // A floor rather than a list, so adding a stamped event is not a chore —
    // but high enough that a derivation that quietly stopped reading fails.
    expect(stamped.size).toBeGreaterThan(25);
    expect(stamped.has('scene-set')).toBe(true);
    expect(stamped.has('mounted')).toBe(true);
  });

  it('and every one of them declares a command stamp', () => {
    for (const type of stamped) {
      expect(EVENT_MEMBERS.has(type), type).toBe(true);
      expect(EVENT_MEMBERS.get(type)!, type).toMatch(/readonly command\?: CommandStamp/);
    }
  });

  /**
   * And the reader would notice one that did not. `combat-ended` is the
   * control: no command stamps it and it declares none, so a reader that
   * answered "yes" to everything would say it did.
   */
  it('would see a type that is missing it', () => {
    expect(EVENT_MEMBERS.has('combat-ended')).toBe(true);
    expect(stamped.has('combat-ended')).toBe(false);
    expect(EVENT_MEMBERS.get('combat-ended')!).not.toMatch(/readonly command\?: CommandStamp/);
  });
});
