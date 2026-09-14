import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { remaining, spellSlotKey } from './resources.js';
import { movementLeftFor } from './standing.js';
import type { Point } from './positioning.js';
import {
  relocateCreature,
  resolveDeclaredCast,
  resolveSpell,
  settleAreaEffects,
  pendingCastingsOf,
} from './commands.js';

const supply = (seed = 'teleport') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

/**
 * Teleportation inside the scene: a position change that spends no movement,
 * provokes nothing, and is refused rather than guessed.
 *
 * SRD Misty Step, whole: "Briefly surrounded by silvery mist, you teleport up
 * to 30 feet to an unoccupied space you can see." Every clause in that
 * sentence is a rule the engine owns — the thirty feet, the unoccupied space,
 * the sight — and until this existed none of them was checked, because no
 * command could move a creature without charging a budget.
 *
 * What this file pins is the *difference* from a move, because that is the
 * whole of why `relocateCreature` is its own command:
 *
 * - no `movement-spent`, and the turn's allowance is untouched;
 * - no Opportunity Attack, and no `pendingMove` for anybody to answer;
 * - an area entry **does** fire, because the position really changed.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const OGRE = id('ogre');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const HALL: Point = { x: 200, y: 200, z: 0 };

/** A big room, and a wizard with an ogre standing beside them. */
const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(OGRE, 'foes'),
  added(ALLY, 'party'),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: HALL },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OGRE,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { landmark: 'the hall' }, feet: 30, bearing: 0 },
  },
];

const IN_COMBAT: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const state = (log: readonly GameEvent[] = SETUP): GameState => fold('seed', log);

describe('a teleport is a position change and not a move', () => {
  it('moves the creature and spends no movement at all', () => {
    const before = state(IN_COMBAT);
    const out = unwrap(
      relocateCreature(before, WIZARD, {
        placement: { from: { landmark: 'the hall' }, feet: 30, bearing: 180 },
        within: 30,
      }),
      'a teleport',
    );

    expect(out.events.map((e) => e.type)).toEqual(['creature-moved']);
    expect(out.feet).toBe(30);

    // The whole point: the turn's movement is exactly where it was.
    const after = fold('seed', [...IN_COMBAT, ...out.events]);
    expect(movementLeftFor(before, WIZARD)).toBe(30);
    expect(movementLeftFor(after, WIZARD)).toBe(30);
  });

  /**
   * The ogre is within reach at the start and out of it at the end, which is
   * exactly what provokes an Opportunity Attack when a creature *walks*. SRD
   * gives one only when a creature "leaves your reach using its action, its
   * Bonus Action, its Reaction, or one of its speeds", and a teleport is none
   * of those.
   */
  it('provokes nobody, and holds nothing open for anybody to answer', () => {
    const out = unwrap(
      relocateCreature(state(IN_COMBAT), WIZARD, {
        placement: { from: { landmark: 'the hall' }, feet: 30, bearing: 180 },
        within: 30,
      }),
      'a teleport past an enemy',
    );
    expect(out.events.some((e) => e.type === 'movement-declared')).toBe(false);
    const after = fold('seed', [...IN_COMBAT, ...out.events]);
    expect(after.pendingMove).toBeNull();
  });
});

describe('what a teleport refuses', () => {
  it('refuses a destination further than the spell reaches', () => {
    const out = relocateCreature(state(), WIZARD, {
      placement: { from: { landmark: 'the hall' }, feet: 60, bearing: 180 },
      within: 30,
    });
    expect(isErr(out) ? out.code : 'ok').toBe('teleport_too_far');
  });

  /**
   * And a room nobody has described is homework rather than a verdict, through
   * the **one** `sceneFor` there now is.
   *
   * It was written privately in `commands/scene.ts` and copied whole into
   * `commands/movement.ts`, and this is the third caller — so it is hoisted to
   * `commands/command.ts`, beside the two creature readers, for the reason
   * they are there. The evidence that it is one helper and not three spelled
   * alike is a mutation: emptying it reddens the scene family, the movement
   * family and this one together.
   */
  it('asks for a scene rather than refusing, and names the command', () => {
    const nowhere = relocateCreature(state([added(WIZARD, 'party')]), WIZARD, {
      placement: { from: { landmark: 'the hall' }, feet: 10, bearing: 0 },
      within: 30,
    });
    expect(isErr(nowhere) ? nowhere.code : 'ok').toBe('no_scene');
    const requests = contextRequestsOf(nowhere);
    expect(requests.map((r) => r.kind)).toEqual(['scene']);
    expect(requests[0]?.satisfyWith).toMatch(/setScene command/);
  });

  it('refuses a space another creature is standing in', () => {
    const out = relocateCreature(state(), WIZARD, {
      placement: { from: { creature: OGRE }, feet: 0, bearing: 0 },
      within: 30,
    });
    expect(isErr(out) ? out.code : 'ok').toBe('occupied');
  });

  /**
   * **The discriminating fixture is a room barely larger than the spell.**
   * In a 600-foot hall every space past the wall is *also* past thirty feet,
   * so the range check answers first and a missing scene check hides behind
   * it permanently. Here the wall is 20 feet away and the spell reaches 30.
   */
  it('refuses a destination outside a scene barely larger than the spell', () => {
    const closet: readonly GameEvent[] = [
      added(WIZARD, 'party'),
      { type: 'scene-set', extent: { width: 40, depth: 40, height: 40 } },
      { type: 'landmark-added', name: 'the corner', at: { x: 20, y: 20, z: 0 } },
      {
        type: 'creature-placed',
        id: WIZARD,
        placement: { from: { landmark: 'the corner' }, feet: 0 },
      },
    ];
    const out = relocateCreature(state(closet), WIZARD, {
      placement: { from: { landmark: 'the corner' }, feet: 25, bearing: 0 },
      within: 30,
    });
    expect(isErr(out) ? out.code : 'ok').toBe('outside_scene');
  });
});

describe('sight is declared, and unknown is not no', () => {
  it('asks for a line of sight nobody has declared', () => {
    const out = relocateCreature(state(), WIZARD, {
      placement: { from: { creature: ALLY }, feet: 5, bearing: 90 },
      within: 30,
      requiresSight: true,
    });
    expect(isErr(out) ? out.kind : 'ok').toBe('needs-context');
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['visibility']);
    expect(requests[0]?.subject).toBe(ALLY);
    expect(requests[0]?.satisfyWith).toMatch(/declareSightBetween/);
  });

  it('refuses a destination beside something declared unseen', () => {
    const blind: readonly GameEvent[] = [
      ...SETUP,
      { type: 'sight-declared', from: WIZARD, to: ALLY, seen: false },
    ];
    const out = relocateCreature(state(blind), WIZARD, {
      placement: { from: { creature: ALLY }, feet: 5, bearing: 90 },
      within: 30,
      requiresSight: true,
    });
    expect(isErr(out) ? out.code : 'ok').toBe('cannot_see_destination');
  });

  it('goes through once the sight is declared', () => {
    const seen: readonly GameEvent[] = [
      ...SETUP,
      { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
    ];
    const out = relocateCreature(state(seen), WIZARD, {
      placement: { from: { creature: ALLY }, feet: 5, bearing: 90 },
      within: 30,
      requiresSight: true,
    });
    expect(isErr(out) ? out.code : 'ok').toBe('ok');
  });

  /**
   * And where sight is not a pairwise fact at all, the clause goes unchecked
   * and says so. Arcane Sword records the same gap for "a spot you can see":
   * a destination is a coordinate and declared sight runs between creatures.
   */
  it('says so when the destination is measured from a landmark', () => {
    const out = unwrap(
      relocateCreature(state(), WIZARD, {
        placement: { from: { landmark: 'the hall' }, feet: 20, bearing: 180 },
        within: 30,
        requiresSight: true,
      }),
      'a teleport measured from a landmark',
    );
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toMatch(/must be able to see where they are going/);
  });
});

/**
 * A Grease laid on the floor, and nobody standing in it yet.
 *
 * SRD Grease catches "a creature that enters the area", and the book does not
 * ask *how* it got there. The reducer does not either: the debt is raised by
 * the position having changed, which is exactly what makes writing
 * `creature-moved` the right answer rather than inventing an event.
 */
const greased = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['grease'] }),
    },
    {
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
    },
    { type: 'landmark-added', name: 'the slick', at: { x: 260, y: 200, z: 0 } },
  ];
  return [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('seed', armed),
        WIZARD,
        {
          spellId: 'grease',
          targets: [],
          at: { x: 260, y: 200, z: 0 },
          towards: { x: 300, y: 200, z: 0 },
          slotLevel: 1,
        },
        supply(),
      ),
      'the Grease',
    ).events,
  ];
};

describe('a teleport is still an authoritative position change', () => {
  it('raises the area entry a Grease is owed', () => {
    const cast = greased();
    expect(fold('seed', cast).owedAreaEffects).toEqual([]);

    // A Cube does not include its point of origin, so five feet in is what
    // actually puts the ally inside the slick.
    const out = unwrap(
      relocateCreature(fold('seed', cast), ALLY, {
        placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 },
        within: 70,
      }),
      'teleporting into the slick',
    );
    const after = fold('seed', [...cast, ...out.events]);
    expect(after.owedAreaEffects.map((owed) => owed.target)).toEqual([ALLY]);
    expect(after.owedAreaEffects[0]?.moment).toBe('entry');
  });

  /**
   * And the debt it raises is one everybody has to settle before acting.
   * `relocateCreature` spends nothing, so the action-economy sweep never
   * classifies it as a spender — it is guarded anyway, because it *raises*
   * the debts `mayAct` exists to make somebody settle.
   */
  it('is refused while a mandatory area effect is owed', () => {
    const cast = greased();
    const entered = unwrap(
      relocateCreature(fold('seed', cast), ALLY, {
        placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 },
        within: 70,
      }),
      'teleporting into the slick',
    );
    const owing = fold('seed', [...cast, ...entered.events]);
    expect(owing.owedAreaEffects.length).toBeGreaterThan(0);

    const again = relocateCreature(owing, WIZARD, {
      placement: { from: { landmark: 'the hall' }, feet: 10, bearing: 180 },
      within: 30,
    });
    expect(isErr(again) ? again.code : 'ok').toBe('area_effect_owed');

    // And it is the debt talking, not the fixture: once settled, the same
    // command is not refused for that reason.
    const settled = [
      ...cast,
      ...entered.events,
      ...unwrap(settleAreaEffects(owing, supply()), 'settling the slick').events,
    ];
    const after = relocateCreature(fold('seed', settled), WIZARD, {
      placement: { from: { landmark: 'the hall' }, feet: 10, bearing: 180 },
      within: 30,
    });
    expect(isErr(after) ? after.code : 'ok').not.toBe('area_effect_owed');
  });
});

describe('the same command twice is one teleport', () => {
  it('reports a retry as the duplicate it is, and moves nobody twice', () => {
    const step = {
      placement: { from: { landmark: 'the hall' }, feet: 30, bearing: 180 },
      within: 30,
      commandId: 'the-one-step',
    } as const;
    const first = unwrap(relocateCreature(state(), WIZARD, step), 'the first teleport');
    expect(first.duplicate).toBe(false);

    const retry = unwrap(
      relocateCreature(fold('seed', [...SETUP, ...first.events]), WIZARD, step),
      'the retry',
    );
    expect(retry.duplicate).toBe(true);
    expect(retry.events).toEqual([]);
  });
});

/**
 * A wizard who can cast the two spells this shape was built for.
 *
 * Misty Step is a Bonus Action, Range: Self, "up to 30 feet to an unoccupied
 * space you can see"; Dimension Door is an Action, Range: 500 feet, and prints
 * the opposite sight clause in as many words — "a place you can see, one you
 * can visualize, or one you can describe by stating distance and direction".
 */
const CASTER: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['misty-step', 'dimension-door'] }),
  },
  ...[2, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: `spell-slot:${level}`,
        label: `level ${level}`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
];

describe('Misty Step is executed rather than tracked', () => {
  it('teleports its caster, spending the slot and no movement', () => {
    const seeing: readonly GameEvent[] = [
      ...CASTER,
      ...IN_COMBAT.slice(SETUP.length),
      { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
    ];
    const before = fold('seed', seeing);
    const out = unwrap(
      resolveSpell(
        before,
        WIZARD,
        {
          spellId: 'misty-step',
          targets: [WIZARD],
          slotLevel: 2,
          teleportTo: { from: { creature: ALLY }, feet: 5, bearing: 90 },
        },
        supply(),
      ),
      'Misty Step',
    );

    const after = fold('seed', [...seeing, ...out.events]);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(true);
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(false);
    expect(movementLeftFor(after, WIZARD)).toBe(30);
    // Range: Self, so the wizard ends up somewhere new and the slot is gone.
    expect(remaining(after.creatures[WIZARD]!.resources, spellSlotKey(2))).toBe(3);
  });

  /**
   * SRD prints "an unoccupied space **you can see**", and the sight is read
   * from the creature the destination is measured from. Undeclared is a fact
   * to go and get, not a refusal.
   */
  it('asks for the sight its own sentence needs', () => {
    const out = resolveSpell(
      fold('seed', CASTER),
      WIZARD,
      {
        spellId: 'misty-step',
        targets: [WIZARD],
        slotLevel: 2,
        teleportTo: { from: { creature: ALLY }, feet: 5, bearing: 90 },
      },
      supply(),
    );
    expect(isErr(out) ? out.kind : 'ok').toBe('needs-context');
    expect(contextRequestsOf(out).map((r) => r.kind)).toContain('visibility');
  });

  /** And a spell that reaches thirty feet does not reach a hundred and twenty. */
  it('refuses a space further than the spell reaches, and spends nothing', () => {
    const before = fold('seed', CASTER);
    const out = resolveSpell(
      before,
      WIZARD,
      {
        spellId: 'misty-step',
        targets: [WIZARD],
        slotLevel: 2,
        teleportTo: { from: { landmark: 'the hall' }, feet: 120, bearing: 180 },
      },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('teleport_too_far');
    // And the title's second half, asserted rather than implied: the slot is
    // untouched and so is the caster's place in the room.
    expect(remaining(before.creatures[WIZARD]!.resources, spellSlotKey(2))).toBe(4);
    expect(before.scene?.positions[WIZARD]).toEqual(HALL);
  });

  /**
   * **A declared casting can always settle**, which is what the pre-flight is
   * for and is not a property the sight check alone would have given it.
   *
   * SRD Counterspell makes the action "wasted" whatever follows, so a
   * declaration the engine cannot settle has spent it for nothing — and a
   * pending casting the caster can never discharge wedges the turn behind it,
   * `resolveTurn` refusing `casting_pending` for ever. Every refusal the
   * resolver could give is therefore reachable **before** the declaration:
   * the distance, the occupied space, the scene's extent and the sight alike.
   */
  it.each([
    ['too far', { from: { landmark: 'the hall' }, feet: 120, bearing: 180 }, 'teleport_too_far'],
    ['occupied', { from: { creature: OGRE }, feet: 0, bearing: 0 }, 'occupied'],
  ] as const)('refuses a declaration it could not settle: %s', (_why, teleportTo, code) => {
    // The sight is declared, so the refusal under test is the only one that
    // can arrive — the discriminating-fixture rule, applied to a pre-flight
    // that asks several questions at once.
    const seeing: readonly GameEvent[] = [
      ...CASTER,
      { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
    ];
    const out = resolveSpell(
      fold('seed', seeing),
      WIZARD,
      { spellId: 'misty-step', targets: [WIZARD], slotLevel: 2, hold: true, teleportTo },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe(code);
    // Nothing was declared, so nothing is pending and the turn is not wedged.
    expect(pendingCastingsOf(fold('seed', seeing))).toEqual([]);
  });
});

describe('a destination is stated or refused, never defaulted', () => {
  it('refuses a teleporting spell that names nowhere to go', () => {
    const out = resolveSpell(
      fold('seed', CASTER),
      WIZARD,
      { spellId: 'misty-step', targets: [WIZARD], slotLevel: 2 },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('destination_required');
  });

  it('refuses a destination named for a spell that teleports nobody', () => {
    const armed: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'spellcasting-declared',
        id: WIZARD,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['grease'] }),
      },
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
      },
    ];
    const out = resolveSpell(
      fold('seed', armed),
      WIZARD,
      {
        spellId: 'grease',
        targets: [],
        at: { x: 260, y: 200, z: 0 },
        towards: { x: 300, y: 200, z: 0 },
        slotLevel: 1,
        teleportTo: { from: { landmark: 'the hall' }, feet: 5, bearing: 90 },
      },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('no_teleport_clause');
  });

  /**
   * **Settlement takes no fresh request**, so the destination is pinned at the
   * declaration like every other fact the caster stated. A Dimension Door held
   * open for a Counterspell settles at the space it was declared for.
   */
  it('settles a held casting at the space it was declared for', () => {
    const held = unwrap(
      resolveSpell(
        fold('seed', CASTER),
        WIZARD,
        {
          spellId: 'dimension-door',
          targets: [WIZARD],
          slotLevel: 4,
          hold: true,
          teleportTo: { from: { landmark: 'the hall' }, feet: 60, bearing: 180 },
        },
        supply(),
      ),
      'declaring Dimension Door',
    );
    const declared = [...CASTER, ...held.events];
    expect(pendingCastingsOf(fold('seed', declared))).toHaveLength(1);

    const settled = unwrap(
      resolveDeclaredCast(fold('seed', declared), held.castingId, supply()),
      'settling Dimension Door',
    );
    expect(settled.events.some((e) => e.type === 'creature-moved')).toBe(true);

    const after = fold('seed', [...declared, ...settled.events]);
    // Sixty feet south of the hall, which is where the declaration said.
    expect(after.scene?.positions[WIZARD]).toEqual({ x: 200, y: 140, z: 0 });
  });

  /** Dimension Door prints no sight clause, so none is demanded. */
  it('does not ask for a sight the spell never printed', () => {
    const out = resolveSpell(
      fold('seed', CASTER),
      WIZARD,
      {
        spellId: 'dimension-door',
        targets: [WIZARD],
        slotLevel: 4,
        teleportTo: { from: { creature: ALLY }, feet: 5, bearing: 90 },
      },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('ok');
  });
});
