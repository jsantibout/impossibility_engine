/**
 * **A cloud a Reaction releases** — M-REFLEX.
 *
 * SRD Giant Octopus, Ink Cloud (1/Day): "_Trigger:_ The octopus takes damage
 * while underwater. _Response:_ The octopus releases ink that fills a 10-foot
 * Cube centered on itself, and the octopus moves up to its Swim Speed. The
 * Cube is Heavily Obscured for 1 minute or until a strong current or similar
 * effect disperses the ink."
 *
 * SRD Octopus prints the same response at 5 feet behind another trigger: "A
 * creature ends its turn within 5 feet of the octopus while underwater."
 *
 * The giant's is answered at the window SRD Retaliation answers; the small
 * one's opens on the turn boundary, which is the engine's own fact. **"While
 * underwater" is the table's**: no scene says a space is submerged, so the door
 * asks for it rather than assuming either answer.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  clearObscurement,
  placeCreatureInScene,
  reactionOpportunities,
  setScene,
  takeDamageResponse,
  takeTurnEndReaction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { printedTraitKey } from './monster.js';
import { obscurementAt, positionOf } from './positioning.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string): CharacterId => asCharacterId(s);
const OCTOPUS = id('octopus');
const DIVER = id('diver');
const GIANT_INK = printedTraitKey('giant-octopus', 'Ink Cloud (1/Day)');
const SMALL_INK = printedTraitKey('octopus', 'Ink Cloud (1/Day)');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('ink') as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** An octopus at (100, 100) and a diver the stated feet east of it, the diver's turn first. */
function reef(block: string, diverFeet = 5): GameState {
  let state = fold(`ink-${block}`, []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, OCTOPUS, block), 'octopus').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, DIVER, 'goblin-warrior'), 'diver').events);
  step(setScene(state, { width: 200, depth: 200, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the reef', { x: 100, y: 100, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, OCTOPUS, { from: { landmark: 'the reef' }, feet: 0 }), 'octopus');
  step(
    placeCreatureInScene(state, DIVER, { from: { creature: OCTOPUS }, feet: diverFeet, bearing: 90 }),
    'diver',
  );
  step(
    beginCombat(state, [
      { id: DIVER, initiative: 20, speed: 30 },
      { id: OCTOPUS, initiative: 5, speed: 5 },
    ]),
    'combat',
  );
  return state;
}

const degreeAt = (state: GameState, x: number, y: number) =>
  obscurementAt(state, { x, y, z: 0 }).degree;

describe("the giant octopus's Ink Cloud", () => {
  /** The diver's blow has just landed on the giant octopus. */
  const struck = (): GameState =>
    after(reef('giant-octopus', 10), [{ type: 'damage-taken', id: OCTOPUS, amount: 4, by: DIVER }]);

  it('is offered at the instant the blow lands', () => {
    const offered = reactionOpportunities(struck(), SRD_CONTENT).filter((o) => o.reactor === OCTOPUS);
    expect(offered).toMatchObject([
      { window: 'damaged-by-creature', id: GIANT_INK, kind: 'feature', against: DIVER },
    ]);
  });

  it('asks whether it is underwater rather than assuming', () => {
    const asked = takeDamageResponse(struck(), OCTOPUS, { feature: GIANT_INK, commandId: 'ink' }, supply());
    expect(isNeedsContext(asked) && !asked.ok && asked.code).toBe('underwater_undeclared');
  });

  it('lays no Cube the lattice cannot hold around the octopus, and says so', () => {
    // Shrunk to Medium, the octopus fills one space and a ten-foot Cube
    // centred on it would have its faces between spaces.
    const shrunk = after(struck(), [
      { type: 'creature-unplaced', id: OCTOPUS },
      { type: 'creature-placed', id: OCTOPUS, placement: { from: { landmark: 'the reef' }, feet: 0, size: 'medium' } },
    ]);
    const refused = takeDamageResponse(
      shrunk,
      OCTOPUS,
      { feature: GIANT_INK, underwater: true, commandId: 'ink' },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('cube_off_the_lattice');
  });

  it('is refused out of the water', () => {
    const dry = takeDamageResponse(
      struck(),
      OCTOPUS,
      { feature: GIANT_INK, underwater: false, commandId: 'ink' },
      supply(),
    );
    expect(isErr(dry) && dry.code).toBe('not_underwater');
  });

  it('fills the ten-foot Cube it occupies with Heavily Obscured ink', () => {
    const state = struck();
    const inked = after(
      state,
      unwrap(
        takeDamageResponse(state, OCTOPUS, { feature: GIANT_INK, underwater: true, commandId: 'ink' }, supply()),
        'ink',
      ).events,
    );
    // The Large octopus stands on (100..110, 100..110).
    expect(degreeAt(inked, 102, 102)).toBe('heavily');
    expect(degreeAt(inked, 107, 107)).toBe('heavily');
    expect(degreeAt(inked, 112, 102)).toBeNull();
    expect(degreeAt(inked, 97, 102)).toBeNull();
    // The Reaction and the day's use are both spent.
    expect(inked.combat!.budgets[OCTOPUS]!.reaction).toBe(false);
    expect(reactionOpportunities(inked, SRD_CONTENT).filter((o) => o.reactor === OCTOPUS)).toEqual([]);
  });

  it('moves up to its Swim Speed, and the ink stays where it was released', () => {
    const state = struck();
    const fled = after(
      state,
      unwrap(
        takeDamageResponse(
          state,
          OCTOPUS,
          {
            feature: GIANT_INK,
            underwater: true,
            moveTo: { from: { landmark: 'the reef' }, feet: 60, bearing: 270 },
            commandId: 'ink',
          },
          supply(),
        ),
        'ink and flee',
      ).events,
    );
    expect(positionOf(fled.scene!, OCTOPUS)).toEqual({ x: 40, y: 100, z: 0 });
    expect(degreeAt(fled, 102, 102)).toBe('heavily');
  });

  it('will not move further than its Swim Speed', () => {
    const state = struck();
    const far = takeDamageResponse(
      state,
      OCTOPUS,
      {
        feature: GIANT_INK,
        underwater: true,
        moveTo: { from: { landmark: 'the reef' }, feet: 80, bearing: 270 },
        commandId: 'ink',
      },
      supply(),
    );
    expect(far.ok).toBe(false);
  });

  it('clears after a minute, or when the table says a current dispersed it', () => {
    const state = struck();
    const inked = after(
      state,
      unwrap(
        takeDamageResponse(state, OCTOPUS, { feature: GIANT_INK, underwater: true, commandId: 'ink' }, supply()),
        'ink',
      ).events,
    );
    const calm = after(inked, [
      { type: 'combat-ended' },
      { type: 'time-advanced', seconds: 50, reason: 'waiting' },
    ]);
    expect(degreeAt(calm, 102, 102)).toBe('heavily');
    const later = after(calm, [{ type: 'time-advanced', seconds: 20, reason: 'waiting' }]);
    expect(degreeAt(later, 102, 102)).toBeNull();

    const patch = Object.keys(inked.scene!.obscurement)[0]!;
    const swept = after(inked, unwrap(clearObscurement(inked, patch, { commandId: 'current' }), 'current'));
    expect(degreeAt(swept, 102, 102)).toBeNull();
  });
});

describe("the octopus's Ink Cloud", () => {
  /** The diver's turn has just ended beside the octopus. */
  const diverDone = (feet = 5): GameState => after(reef('octopus', feet), [{ type: 'turn-advanced' }]);

  it('is offered when a creature ends its turn within five feet', () => {
    const offered = reactionOpportunities(diverDone(), SRD_CONTENT).filter((o) => o.reactor === OCTOPUS);
    expect(offered).toMatchObject([
      { window: 'creature-ended-turn', id: SMALL_INK, kind: 'feature', against: DIVER },
    ]);
  });

  it('is not offered when the creature ended its turn further away', () => {
    const offered = reactionOpportunities(diverDone(10), SRD_CONTENT).filter((o) => o.reactor === OCTOPUS);
    expect(offered).toEqual([]);
    const refused = takeTurnEndReaction(
      diverDone(10),
      OCTOPUS,
      { feature: SMALL_INK, underwater: true, commandId: 'ink' },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('out_of_range');
  });

  it('is not open before anybody has ended a turn', () => {
    const refused = takeTurnEndReaction(
      reef('octopus'),
      OCTOPUS,
      { feature: SMALL_INK, underwater: true, commandId: 'ink' },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('no_trigger');
  });

  it('fills its own five-foot space with Heavily Obscured ink', () => {
    const state = diverDone();
    const inked = after(
      state,
      unwrap(
        takeTurnEndReaction(state, OCTOPUS, { feature: SMALL_INK, underwater: true, commandId: 'ink' }, supply()),
        'ink',
      ).events,
    );
    expect(degreeAt(inked, 102, 102)).toBe('heavily');
    expect(degreeAt(inked, 107, 102)).toBeNull();
  });

  it('asks whether it is underwater', () => {
    const asked = takeTurnEndReaction(diverDone(), OCTOPUS, { feature: SMALL_INK, commandId: 'ink' }, supply());
    expect(isNeedsContext(asked) && !asked.ok && asked.code).toBe('underwater_undeclared');
  });
});

describe("the table's word that the air has cleared", () => {
  it('refuses a patch nobody declared', () => {
    const refused = clearObscurement(reef('octopus'), 'the fog bank', { commandId: 'clear' });
    expect(isErr(refused) && refused.code).toBe('unknown_patch');
  });

  it('refuses a patch a running casting holds up', () => {
    const fogged = after(reef('octopus'), [
      {
        type: 'obscurement-declared',
        patch: 'a fog cloud',
        region: { origin: { space: { x: 100, y: 100, z: 0 } }, shape: { kind: 'sphere', radius: 20 } },
        degree: 'heavily',
        source: 'cast:1',
      },
    ]);
    const refused = clearObscurement(fogged, 'a fog cloud', { commandId: 'clear' });
    expect(isErr(refused) && refused.code).toBe('held_by_casting');
  });
});
