/**
 * SRD Illumination: the light a creature carries about with it.
 *
 * > "The beetle sheds Bright Light in a 10-foot radius and Dim Light for an
 * > additional 10 feet."
 *
 * `sheds-light` was the one parsed trait kind nothing read, and the reason was
 * a shape rather than an oversight: a `LightPatch` is *declared* — the table
 * says the room is dark and a casting pins the dark it made — and nothing
 * declares that a beetle is glowing, because the beetle walks.
 *
 * So the patch is **derived on every read**, beside the declared ones and
 * never among them. A creature that moves moves its light and no event records
 * that it did, which is the same answer `livePatches` gives a Web that has
 * ended and `standing.ts` gives an aura whose holder has been stunned.
 *
 * **Nonmagical**, because the SRD prints no "magical" on any of the six
 * Illumination lines — so a magical Darkness beats it exactly as it beats a
 * torch, which is Darkness's own sentence and `lightAt`'s one rule.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareLight,
  placeCreatureInScene,
  setScene,
} from './commands.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { lightAt, positionOf, type Point } from './positioning.js';
import { resolveMove } from './commands/movement.js';
import { createRng, restoreRng } from './dice.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const BEETLE = id('glimmer');
const GOBLIN = id('grish');
const SEED = 'carried-light';

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/** A beetle on a rock, a goblin sixty feet off, and nobody has lit the room. */
const table = (): Table => {
  const built = new Table();
  built.did('the beetle', (s) => addCreature(s, SRD_CONTENT, BEETLE, 'giant-fire-beetle'));
  built.did('a goblin', (s) => addCreature(s, SRD_CONTENT, GOBLIN, 'goblin-warrior'));
  built.do('the cavern', (s) => setScene(s, { width: 400, depth: 400, height: 60 }));
  built.do('a rock in it', (s) => addSceneLandmark(s, 'the rock', { x: 100, y: 100, z: 0 }));
  built.do('the beetle on the rock', (s) =>
    placeCreatureInScene(s, BEETLE, { from: { landmark: 'the rock' }, feet: 0 }),
  );
  built.do('the goblin sixty feet off', (s) =>
    placeCreatureInScene(s, GOBLIN, { from: { creature: BEETLE }, feet: 60, bearing: 90 }),
  );
  return built;
};

const spaceOf = (state: GameState, who: CharacterId): Point => {
  const at = state.scene === null ? null : positionOf(state.scene, who);
  if (at === null) throw new Error(`${who} is not placed`);
  return at;
};

/** A point a stated number of feet east of the beetle. */
const eastOfBeetle = (state: GameState, feet: number): Point => {
  const at = spaceOf(state, BEETLE);
  return { x: at.x + feet, y: at.y, z: at.z };
};

describe('a creature whose block prints Illumination', () => {
  it('makes its own space bright', () => {
    const built = table();
    const here = lightAt(built.state, spaceOf(built.state, BEETLE));
    expect(here.level).toBe('bright');
    expect(here.magical).toBe(false);
    expect(here.sunlight).toBe(false);
  });

  it('is bright to the printed radius and dim beyond it', () => {
    const built = table();
    const state = built.state;
    // The Giant Fire Beetle prints 10 feet of Bright Light and 10 more of Dim.
    expect(lightAt(state, eastOfBeetle(state, 10)).level).toBe('bright');
    expect(lightAt(state, eastOfBeetle(state, 15)).level).toBe('dim');
    expect(lightAt(state, eastOfBeetle(state, 20)).level).toBe('dim');
  });

  it('leaves a creature sixty feet away unlit', () => {
    const built = table();
    // Not dark: nobody has declared an ambient, and the owner's ruling is that
    // an undeclared scene is undeclared rather than bright.
    expect(lightAt(built.state, spaceOf(built.state, GOBLIN)).level).toBeNull();
  });

  it('names the beetle as what lit the square', () => {
    const built = table();
    expect(lightAt(built.state, spaceOf(built.state, BEETLE)).patches.join(' ')).toContain(
      String(BEETLE),
    );
  });

  /** The whole reason it is derived: the light goes where the creature goes. */
  it('moves its light when it moves', () => {
    const built = table();
    const rock: Point = { x: 100, y: 100, z: 0 };
    const thirtyEast: Point = { x: 130, y: 100, z: 0 };
    expect(lightAt(built.state, rock).level).toBe('bright');
    expect(lightAt(built.state, thirtyEast).level).toBeNull();

    built.did('the beetle scuttles east', (s) =>
      resolveMove(
        s,
        BEETLE,
        { placement: { from: { landmark: 'the rock' }, feet: 30, bearing: 90 }, mode: 'walk' },
        {
          issuer: createRollIssuer('r', s.rollsIssued),
          rng: s.rng === null ? createRng(SEED) : restoreRng(s.rng),
          content: SRD_CONTENT,
        },
      ),
    );

    expect(lightAt(built.state, thirtyEast).level).toBe('bright');
    // And where it was is no longer lit — nothing had to remember to sweep.
    expect(lightAt(built.state, rock).level).toBeNull();
  });

  /**
   * SRD Darkness: "Darkvision can't see through it, and nonmagical light can't
   * illuminate it." A beetle's glow is nonmagical, so a Darkness over it wins
   * — which is `lightAt`'s own rule reading a derived patch exactly as it
   * reads a declared one.
   */
  it('loses to a declared magical darkness over it', () => {
    const built = table();
    built.do('a Darkness on the rock', (s) =>
      declareLight(s, 'the darkness', {
        region: { origin: { creature: BEETLE }, shape: { kind: 'sphere', radius: 15 } },
        level: 'darkness',
        magical: { spellLevel: 2 },
      }),
    );
    const here = lightAt(built.state, spaceOf(built.state, BEETLE));
    expect(here.level).toBe('darkness');
    expect(here.magical).toBe(true);
  });

  /** And a nonmagical darkness declared over it loses, because light adds. */
  it('beats an ordinary darkness declared over it', () => {
    const built = table();
    built.do('an unlit cavern', (s) =>
      declareLight(s, 'the gloom', {
        region: { origin: { creature: BEETLE }, shape: { kind: 'sphere', radius: 15 } },
        level: 'darkness',
      }),
    );
    expect(lightAt(built.state, spaceOf(built.state, BEETLE)).level).toBe('bright');
  });
});

describe('what carries no light', () => {
  it('leaves a block that prints no such sentence dark', () => {
    const built = table();
    // The goblin is placed and prints nothing; the square it stands in is lit
    // by nobody, which is the same `null` an empty scene gives.
    expect(lightAt(built.state, spaceOf(built.state, GOBLIN)).level).toBeNull();
  });

  it('answers as it always did outside a scene', () => {
    const empty = fold(SEED, []);
    expect(lightAt(empty, { x: 0, y: 0, z: 0 })).toEqual({
      level: null,
      magical: false,
      sunlight: false,
      patches: [],
    });
  });

  /** A creature nobody has placed lights nothing: there is nowhere to light. */
  it('sheds nothing from a creature that is not in the scene', () => {
    const built = new Table();
    built.did('the beetle', (s) => addCreature(s, SRD_CONTENT, BEETLE, 'giant-fire-beetle'));
    built.do('the cavern', (s) => setScene(s, { width: 400, depth: 400, height: 60 }));
    built.do('a rock in it', (s) => addSceneLandmark(s, 'the rock', { x: 100, y: 100, z: 0 }));
    expect(lightAt(built.state, { x: 100, y: 100, z: 0 }).level).toBeNull();
  });

  it('folds the same log to the same state twice', () => {
    const built = table();
    expect(JSON.stringify(built.state)).toBe(JSON.stringify(built.state));
  });
});
