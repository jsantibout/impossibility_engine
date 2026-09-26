import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, isNeedsContext, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { altitudeOf } from './positioning.js';
import { resolveMove, resolveSpell } from './commands.js';

/**
 * SRD Levitate, the half about the lifted creature's own Speed:
 *
 * > "The target can move only by pushing or pulling against a fixed object or
 * > surface within reach (such as a wall or a ceiling), which allows it to
 * > move as if it were climbing. You can change the target's altitude by up
 * > to 20 feet in either direction on your turn. If you are the target, you
 * > can move up or down as part of your move."
 *
 * The lift itself, the hold and the gentle landing are `movement-rider.test.ts`;
 * the Magic action that moves somebody else is `activation`'s. This is what a
 * creature *held up* may do with its own feet: only climb, and only along a
 * surface the table says is within reach — a fact about the room, stated on
 * the move and reported as such — and, for a caster holding themself up, only
 * so many vertical feet a turn as the spell prints for its altitude change.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ROGUE = id('rogue');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  // Generous, so an unaided climb's doubled cost never decides a test about
  // what a lifted creature may do rather than how far.
  baseSpeed: 120,
  spellcastingAbility: 'int',
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

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ROGUE),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['levitate'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: spellSlotKey(2), label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 100 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { creature: WIZARD }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: ROGUE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 120 },
      { id: ROGUE, initiative: 10, speed: 120 },
    ],
  },
];

const supply = (seed = 'lift') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);
const height = (world: GameState, who: CharacterId): number | null => altitudeOf(world.scene!, who);

/** The wizard lifts a willing creature — themself or the rogue — on the wizard's turn. */
const lifted = (target: CharacterId): readonly GameEvent[] => {
  const cast = unwrap(
    resolveSpell(
      state(SETUP),
      WIZARD,
      { spellId: 'levitate', targets: [target], slotLevel: 2, willing: [target] },
      supply(),
    ),
    'Levitate',
  );
  return [...SETUP, ...cast.events];
};

/** …and the turn passes to the rogue. */
const roguesTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [...log, { type: 'turn-advanced' }];

describe('the definition', () => {
  it('prints the twenty feet the caster may move the target a turn on its activation', () => {
    const definition = SPELL_DEFINITIONS.find((one) => one.id === 'levitate')!;
    expect(definition.activation?.effects).toEqual([{ kind: 'change-altitude', upTo: 20 }]);
    // The clause about the target's own Speed is executed now and no longer handed over.
    expect(definition.unmodelled?.some((line) => line.includes('own Speed'))).toBe(false);
  });
});

describe('a lifted creature’s own move', () => {
  it('pins the altitude the caster may change a turn onto the hold', () => {
    const log = lifted(ROGUE);
    const held = state(log).creatures[ROGUE]!.lifts;
    expect(held).toHaveLength(1);
    expect(held[0]!.altitudePerTurn).toBe(20);
    expect(held[0]!.altered).toBeUndefined();
    expect(height(state(log), ROGUE)).toBe(20);
  });

  it('is refused a walk, and every mode that is not a climb', () => {
    const log = roguesTurn(lifted(ROGUE));
    for (const mode of ['walk', 'swim'] as const) {
      const out = resolveMove(
        state(log),
        ROGUE,
        { placement: { from: { creature: ROGUE }, feet: 10, bearing: 90 }, mode },
        supply('walk'),
      );
      expect(isErr(out) && out.code, mode).toBe('levitating_cannot_walk');
    }
  });

  it('asks for the surface it pulls along when the climb states none', () => {
    const out = resolveMove(
      state(roguesTurn(lifted(ROGUE))),
      ROGUE,
      { placement: { from: { creature: ROGUE }, feet: 10, bearing: 90 }, mode: 'climb' },
      supply('climb'),
    );
    expect(isNeedsContext(out) && out.code).toBe('surface_required');
    expect(isNeedsContext(out) && out.requests[0]?.satisfyWith).toContain('alongSurface');
  });

  it('climbs along a stated surface at the unaided climb’s doubled cost, and says the surface is the table’s', () => {
    const log = roguesTurn(lifted(ROGUE));
    const moved = unwrap(
      resolveMove(
        state(log),
        ROGUE,
        { placement: { from: { creature: ROGUE }, feet: 10, bearing: 90 }, mode: 'climb', alongSurface: true },
        supply('climb'),
      ),
      'a climb along the wall',
    );
    expect(moved.feet).toBe(10);
    expect(moved.cost).toBe(20);
    expect(moved.unverified.some((line) => line.includes('surface'))).toBe(true);
    // Still twenty feet up: nothing about the climb ended the hold.
    const after = state([...log, ...moved.events]);
    expect(height(after, ROGUE)).toBe(20);
    expect(after.creatures[ROGUE]!.lifts).toHaveLength(1);
  });

  /** A shove is not the creature's own move, and none of this is about a shove. */
  it('leaves forced movement alone', () => {
    const out = unwrap(
      resolveMove(
        state(roguesTurn(lifted(ROGUE))),
        ROGUE,
        { placement: { from: { creature: ROGUE }, feet: 10, bearing: 90 }, forced: true },
        supply('shove'),
      ),
      'a shove of a levitating creature',
    );
    expect(out.events.some((event) => event.type === 'creature-moved')).toBe(true);
  });

  /**
   * "If you are the target, you can move up or down as part of your move" —
   * against the same twenty feet a turn the activation prints. A rogue held
   * up by the wizard is not the caster, and the cap is the caster's.
   */
  it('counts the target’s own vertical feet against nothing when the caster is somebody else', () => {
    const log = roguesTurn(lifted(ROGUE));
    const up = unwrap(
      resolveMove(
        state(log),
        ROGUE,
        { placement: { from: { creature: ROGUE }, feet: 0, elevation: 25 }, mode: 'climb', alongSurface: true },
        supply('climb'),
      ),
      'a rogue climbing twenty-five feet up a wall',
    );
    expect(height(state([...log, ...up.events]), ROGUE)).toBe(45);
  });
});

describe('a caster holding themself up', () => {
  it('may rise twenty feet within their own move, and is refused a twenty-first', () => {
    const log = lifted(WIZARD);
    expect(height(state(log), WIZARD)).toBe(20);

    const twenty = unwrap(
      resolveMove(
        state(log),
        WIZARD,
        { placement: { from: { creature: WIZARD }, feet: 0, elevation: 20 }, mode: 'climb', alongSurface: true },
        supply('rise'),
      ),
      'twenty feet up the wall',
    );
    const risen = state([...log, ...twenty.events]);
    expect(height(risen, WIZARD)).toBe(40);
    // The fold stamped the feet altered this turn onto the hold.
    expect(risen.creatures[WIZARD]!.lifts[0]!.altered).toEqual({
      turn: risen.combat!.turnsTaken,
      feet: 20,
    });

    const more = resolveMove(
      risen,
      WIZARD,
      { placement: { from: { creature: WIZARD }, feet: 0, elevation: 5 }, mode: 'climb', alongSurface: true },
      supply('rise'),
    );
    expect(isErr(more) && more.code).toBe('altitude_spent');
    // Down counts too: "up or down".
    const down = resolveMove(
      risen,
      WIZARD,
      { placement: { from: { creature: WIZARD }, feet: 0, elevation: -5 }, mode: 'climb', alongSurface: true },
      supply('rise'),
    );
    expect(isErr(down) && down.code).toBe('altitude_spent');
    // Sideways along the ceiling is a climb like any other.
    const along = resolveMove(
      risen,
      WIZARD,
      { placement: { from: { creature: WIZARD }, feet: 10, bearing: 90 }, mode: 'climb', alongSurface: true },
      supply('rise'),
    );
    expect(along.ok).toBe(true);
  });

  it('refuses a single rise past the twenty', () => {
    const out = resolveMove(
      state(lifted(WIZARD)),
      WIZARD,
      { placement: { from: { creature: WIZARD }, feet: 0, elevation: 25 }, mode: 'climb', alongSurface: true },
      supply('rise'),
    );
    expect(isErr(out) && out.code).toBe('altitude_spent');
  });

  it('has the twenty back on a later turn', () => {
    const log = lifted(WIZARD);
    const twenty = unwrap(
      resolveMove(
        state(log),
        WIZARD,
        { placement: { from: { creature: WIZARD }, feet: 0, elevation: 20 }, mode: 'climb', alongSurface: true },
        supply('rise'),
      ),
      'twenty feet up',
    );
    // Round the order: the rogue's turn, then the wizard's again.
    const later = [...log, ...twenty.events, { type: 'turn-advanced' } as GameEvent, { type: 'turn-advanced' } as GameEvent];
    const again = resolveMove(
      state(later),
      WIZARD,
      { placement: { from: { creature: WIZARD }, feet: 0, elevation: 20 }, mode: 'climb', alongSurface: true },
      supply('rise'),
    );
    expect(again.ok).toBe(true);
  });
});
