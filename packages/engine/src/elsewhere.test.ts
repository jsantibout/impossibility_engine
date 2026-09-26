import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  creaturesInArea,
  distanceBetween,
  placeCreature,
  positionOf,
} from './positioning.js';
import { elsewhereOf, strandedElsewhere } from './elsewhere.js';
import { resolveAttack, resolveSpell, resolveTurn, returnFromElsewhere } from './commands.js';

/**
 * A second place to put a creature.
 *
 * The engine holds one scene, and a creature may be **elsewhere** — off the
 * lattice, in a named kind of nowhere, with the space it left and the way back
 * recorded. While elsewhere it has no position, so every ruler refuses
 * `not_here`; it is caught by no area; and it comes back only to a space the
 * caller names, checked against the rule the record pinned when it left.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');
/** A casting that has ended, so the way back is open. */
const ENDED = 'A Test#cast:9';

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes'),
  added(HOBGOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['fire-bolt', 'fireball'],
    }),
  },
  ...slots(WIZARD),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  {
    type: 'creature-placed',
    id: HOBGOBLIN,
    placement: { from: { creature: WIZARD }, feet: 30, bearing: 0 },
  },
  ...[GOBLIN, HOBGOBLIN].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: WIZARD, to: who, seen: true },
    { type: 'sight-declared', from: who, to: WIZARD, seen: true },
  ]),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: HOBGOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

/** The goblin, sent into the Ethereal Plane by a hand-written record. */
const AWAY: readonly GameEvent[] = [
  ...FIELD,
  {
    type: 'creature-sent-elsewhere',
    id: GOBLIN,
    kind: 'ethereal',
    source: ENDED,
    returns: { within: 10 },
  },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('elsewhere') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

describe('a creature that is elsewhere', () => {
  it('has no position, and the record says where it went and what it left', () => {
    const before = fold('s', FIELD);
    const left = positionOf(before.scene!, GOBLIN);
    const state = fold('s', AWAY);

    expect(positionOf(state.scene!, GOBLIN)).toBeNull();
    const record = elsewhereOf(state, GOBLIN);
    expect(record?.kind).toBe('ethereal');
    expect(record?.from).toEqual(left);
    expect(record?.since).toBe(state.elapsed);
    expect(record?.source).toBe(ENDED);
    // The scene keeps its copy of the size, so the way back knows how big a
    // space to find.
    expect(state.scene!.sizes[GOBLIN]).toBe('medium');
  });

  it('is measured by nothing: the ruler refuses not_here rather than asking for a placement', () => {
    const state = fold('s', AWAY);
    const apart = distanceBetween(state.scene!, WIZARD, GOBLIN);
    expect(isErr(apart) && apart.code === 'not_here').toBe(true);
  });

  it('cannot be placed while away — the way back is the return, not a placement', () => {
    const state = fold('s', AWAY);
    const placed = placeCreature(state.scene!, GOBLIN, { from: { landmark: 'the door' }, feet: 5 });
    expect(isErr(placed) && placed.code === 'not_here').toBe(true);
  });

  it('is caught by no area', () => {
    const state = fold('s', AWAY);
    const caught = creaturesInArea(
      state.scene!,
      { space: positionOf(fold('s', FIELD).scene!, GOBLIN)! },
      { kind: 'sphere', radius: 20 },
    );
    expect(caught.ok && caught.value).not.toContain(GOBLIN);
  });

  it('is reached by no spell: a Fire Bolt at it refuses not_here', () => {
    const state = fold('s', AWAY);
    const bolt = resolveSpell(
      state,
      WIZARD,
      { spellId: 'fire-bolt', targets: [GOBLIN] },
      supply(state),
    );
    expect(isErr(bolt) && bolt.code === 'not_here').toBe(true);
  });

  /**
   * The attack's own range check rewrites every failed distance into a
   * position request — a wrapper in `commands/attacks.ts`, which this track
   * does not open. So a swing at a creature elsewhere is refused, and the
   * placement the request names is what refuses `not_here`: the door it sends
   * a caller to is the one that says why.
   */
  it('is reached by no attack, and the placement the attack asks for is refused', () => {
    const state = fold('s', AWAY);
    const swing = resolveAttack(state, WIZARD, { target: GOBLIN, weapon: null }, supply(state));
    expect(swing.ok).toBe(false);
    if (!swing.ok && isNeedsContext(swing)) {
      expect(contextRequestsOf(swing).map((request) => request.subject)).toContain(GOBLIN);
    }
  });
});

describe('the way back', () => {
  it('refuses a creature that is not elsewhere', () => {
    const state = fold('s', FIELD);
    const back = returnFromElsewhere(state, GOBLIN, { to: { from: { landmark: 'the door' }, feet: 5 } });
    expect(isErr(back) && back.code === 'not_elsewhere').toBe(true);
  });

  it('refuses a space beyond the record’s reach', () => {
    const state = fold('s', AWAY);
    const back = returnFromElsewhere(state, GOBLIN, {
      to: { from: { landmark: 'the door' }, feet: 25, bearing: 90 },
    });
    expect(isErr(back) && back.code === 'return_too_far').toBe(true);
  });

  it('refuses an occupied space', () => {
    const state = fold('s', AWAY);
    const back = returnFromElsewhere(state, GOBLIN, { to: { from: { creature: WIZARD }, feet: 0, bearing: 0 } });
    expect(isErr(back) && back.code === 'occupied').toBe(true);
  });

  it('asks for the space when several qualify, naming this command as the answer', () => {
    const state = fold('s', AWAY);
    const back = returnFromElsewhere(state, GOBLIN, {});
    expect(!back.ok && back.code === 'return_space_required').toBe(true);
    if (!back.ok) {
      expect(contextRequestsOf(back)[0]?.satisfyWith).toContain('returnFromElsewhere');
    }
  });

  it('stands the creature where it said, and the record is gone', () => {
    const state = fold('s', AWAY);
    const back = unwrap(
      returnFromElsewhere(state, GOBLIN, {
        to: { from: { landmark: 'the door' }, feet: 10, bearing: 90 },
        commandId: 'back',
      }),
      'the return',
    );
    const after = fold('s', [...AWAY, ...back.events]);
    expect(positionOf(after.scene!, GOBLIN)).toEqual({ x: 110, y: 100, z: 0 });
    expect(elsewhereOf(after, GOBLIN)).toBeNull();
    expect(distanceBetween(after.scene!, WIZARD, GOBLIN)).toEqual({ ok: true, value: 10 });
    // Idempotent under its command id.
    const again = returnFromElsewhere(after, GOBLIN, {
      to: { from: { landmark: 'the door' }, feet: 10, bearing: 90 },
      commandId: 'back',
    });
    expect(again.ok && again.value.events).toEqual([]);
  });

  it('takes the one space that qualifies without being asked', () => {
    // A record that may return only to the space it left, and that space is free.
    const log: readonly GameEvent[] = [
      ...FIELD,
      {
        type: 'creature-sent-elsewhere',
        id: GOBLIN,
        kind: 'ethereal',
        source: ENDED,
        returns: { within: 0 },
      },
    ];
    const state = fold('s', log);
    const back = unwrap(returnFromElsewhere(state, GOBLIN, {}), 'the return');
    const after = fold('s', [...log, ...back.events]);
    expect(positionOf(after.scene!, GOBLIN)).toEqual({ x: 105, y: 100, z: 0 });
  });

  it('lifts what the record hung', () => {
    const log: readonly GameEvent[] = [
      ...FIELD,
      {
        type: 'creature-sent-elsewhere',
        id: GOBLIN,
        kind: 'inside',
        host: HOBGOBLIN,
        source: 'line:hobgoblin/Swallow',
        returns: { within: 5, near: HOBGOBLIN, prone: true },
      },
      { type: 'condition-applied', id: GOBLIN, condition: 'blinded', source: 'line:hobgoblin/Swallow' },
      { type: 'condition-applied', id: GOBLIN, condition: 'restrained', source: 'line:hobgoblin/Swallow' },
    ];
    const state = fold('s', log);
    expect(state.creatures[GOBLIN]?.conditions.conditions).toEqual(['blinded', 'restrained']);
    // Inside its host, the one creature it reaches is the host.
    expect(distanceBetween(state.scene!, GOBLIN, HOBGOBLIN)).toEqual({ ok: true, value: 0 });
    const apart = distanceBetween(state.scene!, GOBLIN, WIZARD);
    expect(isErr(apart) && apart.code === 'not_here').toBe(true);

    // A living host is not left; the halfling waits.
    const held = returnFromElsewhere(state, GOBLIN, { to: { from: { creature: HOBGOBLIN }, feet: 5 } });
    expect(isErr(held) && held.code === 'no_way_back').toBe(true);

    const dead = fold('s', [...log, { type: 'damage-taken', id: HOBGOBLIN, amount: 500 }]);
    const back = unwrap(
      returnFromElsewhere(dead, GOBLIN, { to: { from: { creature: HOBGOBLIN }, feet: 5, bearing: 90 } }),
      'the escape',
    );
    const out = fold('s', [...log, { type: 'damage-taken', id: HOBGOBLIN, amount: 500 }, ...back.events]);
    expect(out.creatures[GOBLIN]?.conditions.conditions).toEqual(['prone']);
    expect(elsewhereOf(out, GOBLIN)).toBeNull();
  });

  it('refuses where no space at all can be found, and says to name one', () => {
    // A creature nobody placed, sent away: the record has no space it left.
    const STRAY = id('stray');
    const log: readonly GameEvent[] = [
      ...FIELD,
      added(STRAY, 'foes'),
      { type: 'creature-sent-elsewhere', id: STRAY, kind: 'ethereal', source: ENDED, returns: { within: 10 } },
    ];
    const state = fold('s', log);
    expect(elsewhereOf(state, STRAY)?.from).toBeNull();
    const back = returnFromElsewhere(state, STRAY, {});
    expect(isErr(back) && back.code === 'no_space_to_return_to').toBe(true);
  });

  it('owes the host’s boundary a die where the stay costs damage, and refuses to advance without a generator', () => {
    const log: readonly GameEvent[] = [
      ...FIELD,
      {
        type: 'creature-sent-elsewhere',
        id: GOBLIN,
        kind: 'inside',
        host: WIZARD,
        source: 'line:wizard/Swallow',
        returns: { within: 5, near: WIZARD },
        damage: { dice: '2d4', damageType: 'acid', each: 'end-of-turn' },
      },
    ];
    // The wizard's turn is the one ending, and the goblin is inside them.
    const state = fold('s', log);
    const dry = resolveTurn(state);
    expect(isErr(dry) && dry.code === 'elsewhere_owed').toBe(true);
    const wet = unwrap(resolveTurn(state, supply(state)), 'the turn ends');
    const after = fold('s', [...log, ...wet.events]);
    expect(after.creatures[GOBLIN]!.vitals.hp).toBeLessThan(100);
    const blow = wet.events.find(
      (event): event is Extract<GameEvent, { type: 'damage-taken' }> =>
        event.type === 'damage-taken' && event.id === GOBLIN,
    );
    expect(blow).toBeDefined();

    // **And the stay's damage goes through the same funnel a Fire Bolt does**:
    // a goblin Resistant to acid takes half. The same seed, so the dice are
    // the same; the amount is not.
    const resistant: readonly GameEvent[] = [
      ...log,
      {
        type: 'damage-defense-granted',
        id: GOBLIN,
        defense: { source: 'a hide of scales', damageTypes: ['acid'], defense: 'resistant' },
      },
    ];
    const armoured = fold('s', resistant);
    const softened = unwrap(resolveTurn(armoured, supply(armoured)), 'the turn ends, resisted');
    const halved = softened.events.find(
      (event): event is Extract<GameEvent, { type: 'damage-taken' }> =>
        event.type === 'damage-taken' && event.id === GOBLIN,
    );
    expect(halved?.amount).toBe(Math.floor(blow!.amount / 2));
  });

  it('is a debt the turn refuses to advance past when the casting that sent it has ended', () => {
    const log: readonly GameEvent[] = [
      ...FIELD,
      {
        type: 'creature-sent-elsewhere',
        id: GOBLIN,
        kind: 'extradimensional',
        source: 'Rope Trick#cast:7',
        returns: { within: 5 },
      },
    ];
    const state = fold('s', log);
    expect(strandedElsewhere(state)).toEqual([GOBLIN]);
    const advanced = resolveTurn(state, supply(state));
    expect(isErr(advanced) && advanced.code === 'elsewhere_stranded').toBe(true);
  });
});
