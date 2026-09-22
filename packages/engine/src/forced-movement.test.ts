import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { distanceBetween } from './positioning.js';
import { movementLeftFor } from './standing.js';
import { resolveMove, resolveSpell } from './commands.js';

/**
 * Forced movement a spell causes: the push a settled outcome carries.
 *
 * SRD Thunderwave: "On a failed save, a creature takes 2d8 Thunder damage
 * **and is pushed 10 feet away from you**." One Constitution saving throw,
 * two consequences — which is the argument every rider in {@link
 * OutcomeRiders} makes, and the reason the shove is a **fourth rider slot**
 * rather than an effect of its own: a second effect would roll a second save,
 * and a creature could then take the damage and stand still.
 *
 * What this file pins is the *difference* between a shove and a move, because
 * that difference is the whole of what `forced: true` means:
 *
 * - no Speed is spent, in or out of combat;
 * - nobody is offered an Opportunity Attack, and no `pendingMove` is opened;
 * - SRD forbids only ending a move in an occupied space **willingly**, so a
 *   shove may land a creature on top of somebody;
 * - a shove with nowhere to go does not happen, and says so, rather than
 *   refusing a casting that has already dealt its damage.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

/**
 * A hall, a caster, and a target standing five feet due east of them.
 *
 * Due east, because a push is measured along the bearing from the caster to
 * the creature it moves and a diagonal would make every distance below an
 * argument about the ruler rather than about the rule.
 */
const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  added(BYSTANDER),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['thunderwave'] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 90 },
  },
  // Well out of a 15-foot Cube, so the wave catches exactly one creature
  // unless a test moves them.
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { creature: CASTER }, feet: 60, bearing: 270 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
      { id: BYSTANDER, initiative: 5, speed: 30 },
    ],
  },
];

/** A supply whose flat bonus settles the saving throw outright. */
const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[] = SETUP): GameState => fold('seed', log);

/** A 15-foot Cube pointed east, which is where the target is standing. */
const thunderwave = (flat: number, log: readonly GameEvent[] = SETUP, seed = 'wave') => {
  const before = fold('seed', log);
  const east = before.scene!.positions[TARGET]!;
  return unwrap(
    resolveSpell(
      before,
      CASTER,
      { spellId: 'thunderwave', targets: [], towards: east, slotLevel: 1 },
      supply(seed, flat),
    ),
    'Thunderwave',
  );
};

const apart = (world: GameState, a: CharacterId, b: CharacterId): number =>
  unwrap(distanceBetween(world.scene!, a, b), 'a distance');

describe('Thunderwave: one saving throw, damage and a shove', () => {
  it('pushes a creature that fails its save ten feet straight away', () => {
    const out = thunderwave(-40);

    const moves = out.events.filter((e) => e.type === 'creature-moved');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: TARGET, forced: true });

    // Five feet away before, fifteen after: the push is ten feet and it is
    // measured from the caster, not from wherever the wave started.
    expect(apart(state(), CASTER, TARGET)).toBe(5);
    expect(apart(fold('seed', [...SETUP, ...out.events]), CASTER, TARGET)).toBe(15);
  });

  it('pushes nobody who makes the save, however much damage still landed', () => {
    const out = thunderwave(40);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(apart(fold('seed', [...SETUP, ...out.events]), CASTER, TARGET)).toBe(5);
  });

  /**
   * SRD offers an Opportunity Attack only against a creature leaving your
   * reach "using its action, its Bonus Action, its Reaction, or one of its
   * speeds". Being thrown by a Thunderwave is none of those, and it is not the
   * creature's own movement either.
   */
  it('spends none of the shoved creature’s Speed and provokes nobody', () => {
    const out = thunderwave(-40);
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(false);
    expect(out.events.some((e) => e.type === 'movement-declared')).toBe(false);

    const after = fold('seed', [...SETUP, ...out.events]);
    expect(after.pendingMove).toBeNull();
    expect(movementLeftFor(after, TARGET)).toBe(30);
  });

  /**
   * SRD: "You can't **willingly** end a move in a space occupied by another
   * creature." A shove is the "somehow" the rule leaves room for, and
   * `moveCreature` has reported the sharing since positioning landed.
   */
  it('lands a shoved creature on top of somebody standing where they go', () => {
    // Ten feet east, so the wave catches them; the bystander twenty feet east,
    // **outside** a 15-foot Cube, so the only thing that happens to them is
    // being landed on.
    const blocked: readonly GameEvent[] = SETUP.map((e) =>
      e.type === 'creature-placed' && e.id === TARGET
        ? { ...e, placement: { from: { creature: CASTER }, feet: 10, bearing: 90 } }
        : e.type === 'creature-placed' && e.id === BYSTANDER
          ? { ...e, placement: { from: { creature: CASTER }, feet: 20, bearing: 90 } }
          : e,
    );
    const out = thunderwave(-40, blocked);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(true);

    const after = fold('seed', [...blocked, ...out.events]);
    expect(apart(after, CASTER, TARGET)).toBe(20);
    expect(apart(after, TARGET, BYSTANDER)).toBe(0);
  });

  /**
   * A wall is not a refusal: the wave was cast, the slot is gone and the
   * damage landed, so a push with nowhere to go is reported as a gap the way
   * the Push mastery and the Shove already report theirs.
   */
  it('reports a shove with nowhere to go rather than refusing the casting', () => {
    const cornered: readonly GameEvent[] = SETUP.map((e) =>
      e.type === 'landmark-added' ? { ...e, at: { x: 390, y: 100, z: 0 } } : e,
    );
    const out = thunderwave(-40, cornered);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(out.unverified.join(' ')).toMatch(/could not be pushed/);
    // And the spell still did what it does: the damage is in the batch.
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(true);
  });
});

/**
 * And the same rule through the other door.
 *
 * `MoveCommand.forced` has said "this is movement somebody else is doing to
 * you" since the command was written, and it reached the budget, the terrain
 * and the Opportunity Attack — but not the geometry: `resolveMove` called
 * `moveCreature` with no options at all, so the one rule the flag exists to
 * relax was the one rule it never reached. The fold applies the same event
 * **with** the flag, which is what makes this a divergence rather than a
 * preference: a shove the command refused is a shove the log would have
 * accepted.
 */
describe('a forced move through the move command', () => {
  const beside = (feet: number): readonly GameEvent[] =>
    SETUP.map((e) =>
      e.type === 'creature-placed' && e.id === BYSTANDER
        ? { ...e, placement: { from: { creature: CASTER }, feet, bearing: 90 } }
        : e,
    );

  it('may end in a space another creature is standing in', () => {
    const log = beside(15);
    const out = unwrap(
      resolveMove(
        fold('seed', log),
        TARGET,
        { placement: { from: { creature: CASTER }, feet: 15, bearing: 90 }, forced: true },
        supply('shoved'),
      ),
      'a shove into an occupied space',
    );
    expect(out.events.map((e) => e.type)).toEqual(['creature-moved']);

    const after = fold('seed', [...log, ...out.events]);
    expect(apart(after, TARGET, BYSTANDER)).toBe(0);
  });

  /** And a move the creature makes of its own accord is refused, as it always was. */
  it('still refuses a willing move into an occupied space', () => {
    const out = resolveMove(
      fold('seed', beside(15)),
      TARGET,
      { placement: { from: { creature: CASTER }, feet: 15, bearing: 90 } },
      supply('walking'),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('occupied');
  });
});
