import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { altitudeOf, distanceBetween } from './positioning.js';
import { movementLeftFor } from './standing.js';
import { endConcentration, resolveDamage, resolveSpell } from './commands.js';
import { extendContent } from './content.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * A movement a save gates: the lift, and the push measured along a Line.
 *
 * `forced-movement.test.ts` is this file's sibling and owns the shove SRD
 * Thunderwave writes. What is here is the **second kind** of movement a
 * settled outcome may carry — SRD *Levitate*'s "rises vertically up to 20
 * feet and remains suspended there for the duration" — and the three things
 * that distinguish it from a push:
 *
 * - it goes **up**, on the one axis a bearing cannot express;
 * - the casting **keeps** it, so the lift is a grant with the casting's own
 *   source on it and `spellOn` reports the creature the spell is holding;
 * - it is **given back**: SRD's "the target floats gently to the ground if it
 *   is still aloft" is the one ending in this engine that undoes a position,
 *   and it is derived by the fold at release rather than commanded, because
 *   nobody decides that a spell has run out.
 *
 * SRD *Gust of Wind* is the other half and needed no new movement at all: "be
 * pushed 15 feet away from you in a direction following the Line" is the
 * bearing from the caster that `shoveAwayFrom` has always measured, hung off
 * a bare `save` rather than off a `save-damage` — which is the one thing the
 * rider slot was missing, because the wind deals no damage.
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
 * A hall with sixty feet of headroom, a caster, a target ten feet due east and
 * a bystander forty feet east of the target.
 *
 * Due east, because both spells in this file measure from the caster along a
 * bearing and a diagonal would make every distance an argument about the ruler.
 * The headroom is stated because a lift is refused by the ceiling exactly as a
 * shove is refused by a wall, and a twenty-foot rise in a ten-foot room is a
 * different test from the one each of these is.
 */
const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  added(BYSTANDER),
  ...[CASTER, BYSTANDER].flatMap((who) =>
    [1, 2, 3].map(
      (level): GameEvent => ({
        type: 'resource-pool-declared',
        id: who,
        pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
      }),
    ),
  ),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['levitate', 'gust-of-wind'] }),
  },
  // **The bystander is a second wizard**, which is the only way one creature
  // can be held up by two castings at once: Concentration is one casting per
  // creature, so a caster who levitated the same target twice would have ended
  // their own first spell. Two casters is what the `lifts` list is a list for.
  {
    type: 'spellcasting-declared',
    id: BYSTANDER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['levitate'] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: 10, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { creature: CASTER }, feet: 50, bearing: 90 },
  },
  // Levitate names one creature and asks whether the caster can see it.
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
  { type: 'sight-declared', from: BYSTANDER, to: TARGET, seen: true },
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

/**
 * The turns between whoever is acting and the creature named, as events.
 *
 * A casting is a Magic action and an action is taken on a turn, so the second
 * wizard has to be given one. Written rather than played, because what is
 * being tested is two castings holding one creature and not the turn order:
 * `turn-advanced` is the event `resolveTurn` emits and the fold moves the
 * order on either way.
 */
const turnPassesTo = (who: CharacterId, log: readonly GameEvent[] = SETUP): GameEvent[] => {
  const order = fold('seed', log).combat!;
  const seat = order.order.findIndex((one) => one.id === who);
  const steps = (seat - order.turnIndex + order.order.length) % order.order.length;
  return Array.from({ length: steps }, () => ({ type: 'turn-advanced' }));
};

const apart = (world: GameState, a: CharacterId, b: CharacterId): number =>
  unwrap(distanceBetween(world.scene!, a, b), 'a distance');

const height = (world: GameState, who: CharacterId): number | null =>
  altitudeOf(world.scene!, who);

const levitate = (
  flat: number,
  log: readonly GameEvent[] = SETUP,
  seed = 'lift',
  by: CharacterId = CASTER,
) =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      by,
      { spellId: 'levitate', targets: [TARGET], slotLevel: 2 },
      supply(seed, flat),
    ),
    'Levitate',
  );

/** A 60-foot Line, ten feet wide, blowing due east down the row of creatures. */
const gust = (flat: number, log: readonly GameEvent[] = SETUP, seed = 'wind') =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId: 'gust-of-wind', targets: [], towards: { x: 200, y: 100, z: 0 }, slotLevel: 2 },
      supply(seed, flat),
    ),
    'Gust of Wind',
  );

describe('Levitate: a Constitution save, and twenty feet of air', () => {
  it('lifts a creature that fails the save twenty feet straight up', () => {
    const out = levitate(-40);

    const moves = out.events.filter((e) => e.type === 'creature-moved');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: TARGET, forced: true });

    // On the floor before, twenty feet up after — and no further from the
    // caster along the ground than they were, because a lift is the one
    // movement with no bearing.
    expect(height(state(), TARGET)).toBe(0);
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(height(after, TARGET)).toBe(20);
    expect(after.scene!.positions[TARGET]!.x).toBe(state().scene!.positions[TARGET]!.x);
    expect(after.scene!.positions[TARGET]!.y).toBe(state().scene!.positions[TARGET]!.y);
  });

  it('lifts nobody who makes the save', () => {
    const out = levitate(40);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(height(fold('seed', [...SETUP, ...out.events]), TARGET)).toBe(0);
  });

  /**
   * A lift is forced movement, exactly as a shove is: SRD offers an
   * Opportunity Attack against a creature leaving your reach "using its
   * action, its Bonus Action, its Reaction, or one of its speeds", and being
   * held in the air by somebody else's spell is none of those.
   */
  it('spends none of the lifted creature’s Speed and provokes nobody', () => {
    const out = levitate(-40);
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(false);
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(after.pendingMove).toBeNull();
    expect(movementLeftFor(after, TARGET)).toBe(30);
  });

  /**
   * "…and remains suspended there for the duration." The casting keeps the
   * lift, which is what makes the landing below possible and what puts the
   * creature on the list of who the spell is on.
   */
  it('holds the creature it lifted, under the casting’s own source', () => {
    const out = levitate(-40);
    const after = fold('seed', [...SETUP, ...out.events]);
    const held = after.creatures[TARGET]!.lifts;
    expect(held).toHaveLength(1);
    expect(held[0]!.source).toContain('Levitate');
    expect(held[0]!.source).toContain(out.castingId);
  });

  /**
   * SRD: "When the spell ends, the target floats gently to the ground if it is
   * still aloft."
   *
   * **Gently** is the assertion: no fall is declared, no dice are thrown and
   * nobody lands Prone. And it is derived by the fold rather than commanded,
   * so the deadline arriving does it as surely as the caster letting go.
   */
  it('floats the target gently to the ground when the casting ends', () => {
    const lifted = levitate(-40);
    const log = [...SETUP, ...lifted.events];
    expect(height(fold('seed', log), TARGET)).toBe(20);

    const ended = unwrap(
      endConcentration(fold('seed', log), CASTER, 'voluntary'),
      'let go of Levitate',
    );
    const after = fold('seed', [...log, ...ended]);

    expect(height(after, TARGET)).toBe(0);
    expect(after.creatures[TARGET]!.lifts).toHaveLength(0);
    // No fall was declared, nothing was rolled for the landing, and the
    // creature is on its feet.
    expect(after.creatures[TARGET]!.falling).toBeNull();
    expect(after.creatures[TARGET]!.conditions.instances).toHaveLength(0);
    expect(after.creatures[TARGET]!.vitals.hp).toBe(
      fold('seed', log).creatures[TARGET]!.vitals.hp,
    );
  });

  /**
   * "…if it is still aloft." Two castings holding one creature is not a
   * contradiction, and the **first** of them ending is not the creature being
   * let go of — which is the whole reason `lifts` is a list like every other
   * grant family rather than a single hold.
   */
  it('keeps a creature up while a second casting is still holding it', () => {
    const first = levitate(-40);
    // The second wizard is third in the order, so the fight is walked round to
    // them: a casting is a Magic action and an action is taken on a turn.
    const held = [...SETUP, ...first.events, ...turnPassesTo(BYSTANDER)];
    const second = levitate(-40, held, 'second', BYSTANDER);
    const both = [...held, ...second.events];

    expect(fold('seed', both).creatures[TARGET]!.lifts).toHaveLength(2);

    // The first wizard lets go, and the creature is still in the air.
    const letGo = unwrap(
      endConcentration(fold('seed', both), CASTER, 'voluntary'),
      'the first wizard lets go',
    );
    const after = [...both, ...letGo];
    expect(fold('seed', after).creatures[TARGET]!.lifts).toHaveLength(1);
    expect(height(fold('seed', after), TARGET)).toBeGreaterThan(0);

    // And the second, which is the last: now it comes down.
    const alsoLetGo = unwrap(
      endConcentration(fold('seed', after), BYSTANDER, 'voluntary'),
      'the second wizard lets go',
    );
    const grounded = fold('seed', [...after, ...alsoLetGo]);
    expect(grounded.creatures[TARGET]!.lifts).toHaveLength(0);
    expect(height(grounded, TARGET)).toBe(0);
  });

  /**
   * The same landing through the **other** door, and no SRD spell goes through
   * it yet.
   *
   * `releaseCasting` ends a spell everywhere; `releaseOnTarget` ends it on one
   * creature and leaves it running for the rest, which is the shape a repeat
   * save and an `endsEarly` that names `ends: 'target'` both take. Levitate
   * writes neither, and a convergence point that forgot one kind of debt is
   * exactly the hole `releaseOnTarget`'s own docstring records its bonuses
   * being. So the rule is driven by a **homebrew** spell through the public
   * door — which is also what says the landing is the engine's and not
   * Levitate's.
   */
  it('sets a creature down when the casting ends on them alone', () => {
    const UPDRAFT = 'homebrew-updraft';
    const content = unwrap(
      extendContent(SRD_CONTENT, {
        spells: [
          {
            id: UPDRAFT,
            name: 'Homebrew Updraft',
            level: 2,
            school: 'transmutation',
            castingTime: 'action',
            concentration: false,
            range: { kind: 'ranged', feet: 60 },
            targets: { count: 1 },
            requiresSight: true,
            effects: [{ kind: 'save', ability: 'con', movement: { kind: 'lift', feet: 20 } }],
            durationSeconds: 60,
            // "the updraft fails the moment anything strikes the creature it
            // is holding" — which ends it on that creature and would leave an
            // upcast one holding everybody else.
            endsEarly: [{ on: 'target-takes-damage', ends: 'target' }],
          },
        ],
      }),
      'the homebrew updraft',
    );

    const log: readonly GameEvent[] = SETUP.map((e) =>
      e.type === 'spellcasting-declared' && e.id === CASTER
        ? { ...e, spellcasting: declaredCasting({ ability: 'int', prepared: [UPDRAFT] }) }
        : e,
    );
    const lifted = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: UPDRAFT, targets: [TARGET], slotLevel: 2 },
        { ...supply('updraft', -40), content },
      ),
      'the updraft',
    );
    const aloft = [...log, ...lifted.events];
    expect(height(fold('seed', aloft), TARGET)).toBe(20);

    const struck = unwrap(
      resolveDamage(
        fold('seed', aloft),
        TARGET,
        { amount: 3, source: 'a sling stone', types: ['bludgeoning'] },
        { ...supply('stone'), content },
      ),
      'a sling stone',
    );
    const after = fold('seed', [...aloft, ...struck.events]);

    expect(after.creatures[TARGET]!.lifts).toHaveLength(0);
    expect(height(after, TARGET)).toBe(0);
    expect(after.creatures[TARGET]!.falling).toBeNull();
  });
});

describe('Gust of Wind: a Strength save, and fifteen feet along the Line', () => {
  it('pushes a creature that fails its save fifteen feet away from the caster', () => {
    const out = gust(-40);

    // Both creatures stand in the Line and both are thrown. The order is the
    // sorted one an area resolution always uses — nobody named anybody, so a
    // casting that folded differently for two spellings of one set would not
    // be replayable.
    const moved = out.events.filter((e) => e.type === 'creature-moved');
    expect(moved.map((e) => (e as { readonly id: CharacterId }).id)).toEqual(
      [BYSTANDER, TARGET],
    );

    const after = fold('seed', [...SETUP, ...out.events]);
    expect(apart(state(), CASTER, TARGET)).toBe(10);
    expect(apart(after, CASTER, TARGET)).toBe(25);
  });

  it('pushes nobody who makes the save', () => {
    const out = gust(40);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(apart(fold('seed', [...SETUP, ...out.events]), CASTER, TARGET)).toBe(10);
  });

  /** The wind deals no damage at all: the save is the whole of the sentence. */
  it('deals no damage to anybody, saved or not', () => {
    for (const flat of [-40, 40]) {
      const out = gust(flat);
      expect(out.events.some((e) => e.type === 'damage-taken')).toBe(false);
      expect(out.events.some((e) => e.type === 'damage-rolled')).toBe(false);
    }
  });
});

describe('the movement rider’s validator', () => {
  const definition = (movement: unknown, over: Record<string, unknown> = {}): SpellDefinition =>
    ({
      id: 'homebrew-gale',
      name: 'Homebrew Gale',
      level: 1,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      effects: [{ kind: 'save', ability: 'str', movement, ...over }],
    }) as unknown as SpellDefinition;

  /** The same spell with somewhere for a lift to last: a minute of it. */
  const lasting = (movement: unknown, over: Record<string, unknown> = {}): SpellDefinition =>
    ({ ...definition(movement, over), durationSeconds: 60 }) as SpellDefinition;

  it('accepts a save whose whole outcome is a movement', () => {
    expect(checkSpellDefinition(definition({ feet: 15 }))).toEqual([]);
  });

  it('accepts a lift on a spell with a duration to hold it for', () => {
    expect(checkSpellDefinition(lasting({ feet: 20, kind: 'lift' }))).toEqual([]);
  });

  /**
   * A lift is held for the casting's life and given back when it ends, so an
   * Instantaneous one would leave a creature in the air with nothing that
   * could ever bring it down — the debt a Feather Fall with no duration is,
   * arriving through a rider rather than through an effect kind.
   */
  it('refuses a lift on a casting that is over the moment it resolves', () => {
    const found = checkSpellDefinition(definition({ feet: 20, kind: 'lift' }));
    expect(found.map((problem) => problem.code)).toEqual(['grant_without_lifetime']);
  });

  /**
   * And the pairing the plumbing cannot survive: a `modifiers` rider with a
   * deadline of its own schedules a `grants` timer against the **casting's**
   * source, and everything that source hung — the lift included — goes when it
   * fires. `releaseGrants` has a creature and no scene, so the landing could
   * not happen there.
   */
  it('refuses a lift beside a grant that ends before the casting does', () => {
    const found = checkSpellDefinition(
      lasting(
        { feet: 20, kind: 'lift' },
        {
          modifiers: [
            {
              kind: 'speed-change',
              change: 'halve',
              lasts: 'start-of-casters-next-turn',
            },
          ],
        },
      ),
    );
    expect(found.map((problem) => problem.code)).toContain('lift_beside_a_shorter_grant');
  });

  /**
   * And the same pair written two effects apart, which is the form a
   * per-effect check would have waved through.
   *
   * The timer that would strand the creature is keyed by the **casting's**
   * source and the target, and neither of those is an effect: two effects of
   * one definition landing on one creature share the string exactly as two
   * riders on one outcome do. So the rule is the definition's.
   */
  it('refuses the same pair written in two effects of one spell', () => {
    const split = {
      ...lasting({ feet: 20, kind: 'lift' }),
      effects: [
        { kind: 'save', ability: 'con', movement: { feet: 20, kind: 'lift' } },
        {
          kind: 'save',
          ability: 'con',
          modifiers: [
            { kind: 'speed-change', change: 'halve', lasts: 'start-of-casters-next-turn' },
          ],
        },
      ],
    } as unknown as SpellDefinition;
    const found = checkSpellDefinition(split);
    expect(found.map((problem) => problem.code)).toContain('lift_beside_a_shorter_grant');
    // Reported at the lift, which is the field that would have to change.
    expect(found.find((problem) => problem.code === 'lift_beside_a_shorter_grant')?.field).toBe(
      'effects[0].movement.kind',
    );
  });

  /**
   * And across the two lists an `areaTrigger` puts beside the spell's own,
   * because one casting hangs both under one source.
   */
  it('refuses a lift in the effects beside a deadline in the area trigger', () => {
    const split = {
      ...lasting({ feet: 20, kind: 'lift' }),
      area: { kind: 'sphere', radius: 20, origin: 'point' },
      areaTrigger: {
        at: 'start-of-turn',
        label: 'Homebrew Gale (the air)',
        effects: [
          {
            kind: 'save',
            ability: 'con',
            modifiers: [
              { kind: 'speed-change', change: 'halve', lasts: 'start-of-casters-next-turn' },
            ],
          },
        ],
      },
    } as unknown as SpellDefinition;
    expect(checkSpellDefinition(split).map((problem) => problem.code)).toContain(
      'lift_beside_a_shorter_grant',
    );
  });

  /** And the same pair without the deadline, which nothing schedules a timer for. */
  it('accepts a lift beside a grant that lasts as long as the casting', () => {
    expect(
      checkSpellDefinition(
        lasting(
          { feet: 20, kind: 'lift' },
          { modifiers: [{ kind: 'speed-change', change: 'halve' }] },
        ),
      ),
    ).toEqual([]);
  });

  it('refuses a kind of movement the engine cannot perform', () => {
    const found = checkSpellDefinition(definition({ feet: 15, kind: 'yank' }));
    expect(found.map((problem) => problem.code)).toContain('bad_push_kind');
  });

  it('still refuses a shove of no feet at all', () => {
    const found = checkSpellDefinition(definition({ feet: 0, kind: 'lift' }));
    expect(found.map((problem) => problem.code)).toContain('bad_push_distance');
  });
});

describe('a lift that cannot happen', () => {
  /**
   * A ceiling is a wall lying down: the rise is asked for before it is
   * written, and what could not happen is reported on the casting rather than
   * refusing a casting whose slot is already spent.
   */
  it('reports a lift the ceiling refuses instead of refusing the casting', () => {
    const lowRoom: readonly GameEvent[] = SETUP.map((e) =>
      e.type === 'scene-set' ? { ...e, extent: { width: 400, depth: 400, height: 10 } } : e,
    );
    const out = levitate(-40, lowRoom);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
    expect(out.unverified.join(' ')).toContain('Levitate');
  });
});
