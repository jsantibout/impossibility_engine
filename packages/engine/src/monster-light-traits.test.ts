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
import { hasPrintedTrait } from './monster.js';
import { rollModesFor } from './standing.js';

/**
 * The creature that carries the sight model's one gated rule.
 *
 * `docs/design/light-and-sight.md` shipped light and obscurement as patches on
 * the lattice, `lightAt` answers per space, and an `in-sunlight`
 * {@link StandingRequirement} reads it at the holder's own space. That rule was
 * proved on a **constructed** creature — a sheet this repository wrote — and
 * the note said in as many words what was left: "the rule is built and
 * executable, and what waits is the parser that puts it on a creature."
 *
 * This is that half. Five SRD blocks print Sunlight Sensitivity and one prints
 * Sunlight Weakness; the parser now types both sentences and `adaptMonster`
 * compiles them onto the sheet, so a kobold pulled out of the catalogue by id
 * has the Disadvantage the book gives it without anybody writing a standing
 * effect by hand.
 *
 * **The holder, not the target.** Every one of those sentences says what
 * happens to the creature whose block it is, so the kobold's Disadvantage
 * bites where the *kobold* stands in sunlight and not where its victim does.
 *
 * **Daylight is sunlight** (owner, 2026-09-22): SRD 5.2.1 prints "sunlight"
 * three times in that spell's paragraph, and `docs/rules/srd-policy.md` ranks
 * printed text above the 2014 errata. So a kobold under a Daylight is a kobold
 * in sunlight — which is a fact about what the table declares the patch to be,
 * and needs nothing here.
 */

const id = (s: string) => asCharacterId(s);
const KOBOLD = id('kobold');
const SHADOW = id('shadow');
const GOBLIN = id('goblin');
const SEED = 'light-traits';

/** A log built only out of what the commands produced. */
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

/**
 * The two creatures thirty feet apart in a scene nobody has lit.
 *
 * Both arrive by `addCreature`, which is the door: nothing here writes a
 * `creature-added` by hand, so what is asserted below is what the catalogue
 * put on the sheet.
 */
const table = (monster: string, who: CharacterId): Table => {
  const built = new Table();
  built.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  built.did('a goblin to swing at', (s) => addCreature(s, SRD_CONTENT, GOBLIN, 'goblin-warrior'));
  built.do('the ridge', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  built.do('a rock on it', (s) => addSceneLandmark(s, 'the rock', { x: 40, y: 40, z: 0 }));
  built.do('the monster on the rock', (s) =>
    placeCreatureInScene(s, who, { from: { landmark: 'the rock' }, feet: 0 }),
  );
  built.do('the goblin thirty feet off', (s) =>
    placeCreatureInScene(s, GOBLIN, { from: { creature: who }, feet: 30, bearing: 90 }),
  );
  return built;
};

/** The sources of every mode on one of the creature's own rolls. */
const modes = (
  state: GameState,
  roller: CharacterId,
  family: 'attack' | 'ability-check' | 'saving-throw',
): readonly string[] =>
  rollModesFor(state, {
    roller,
    ...(family === 'attack' ? { against: GOBLIN } : {}),
    family,
  }).modes.map((mode) => mode.source);

describe('a stat block that prints Sunlight Sensitivity', () => {
  it('carries the trait shape the parser read', () => {
    const built = table('kobold-warrior', KOBOLD);
    const kobold = built.state.creatures[KOBOLD];
    expect(kobold).toBeDefined();
    expect(hasPrintedTrait(kobold!.sheet, 'disadvantage-in-sunlight')).toBe(true);
  });

  it('bites on both of the rolls the sentence names, and only in sunlight', () => {
    const built = table('kobold-warrior', KOBOLD);

    // Nobody has said what the light is, so nothing bites — the "no default
    // ambient" ruling read through to its consequence.
    expect(modes(built.state, KOBOLD, 'attack')).toEqual([]);
    expect(modes(built.state, KOBOLD, 'ability-check')).toEqual([]);

    built.do('the sun on the ridge', (s) =>
      declareLight(s, 'the open ridge', {
        region: { origin: { creature: KOBOLD }, shape: { kind: 'sphere', radius: 20 } },
        level: 'bright',
        sunlight: true,
      }),
    );

    expect(modes(built.state, KOBOLD, 'attack')).toEqual(['Sunlight Sensitivity']);
    expect(modes(built.state, KOBOLD, 'ability-check')).toEqual(['Sunlight Sensitivity']);
    // The sentence names two rolls and a saving throw is not one of them.
    expect(modes(built.state, KOBOLD, 'saving-throw')).toEqual([]);
  });

  it('does not bite under a torch, because bright is not sunlight', () => {
    const built = table('kobold-warrior', KOBOLD);
    built.do('a torch', (s) =>
      declareLight(s, 'the torch', {
        region: { origin: { creature: KOBOLD }, shape: { kind: 'sphere', radius: 20 } },
        level: 'bright',
      }),
    );
    expect(modes(built.state, KOBOLD, 'attack')).toEqual([]);
  });

  it('does not bite where only the other creature is in the sun', () => {
    const built = table('kobold-warrior', KOBOLD);
    built.do('a shaft of light on the goblin', (s) =>
      declareLight(s, 'the shaft', {
        region: { origin: { creature: GOBLIN }, shape: { kind: 'sphere', radius: 0 } },
        level: 'bright',
        sunlight: true,
      }),
    );
    expect(modes(built.state, KOBOLD, 'attack')).toEqual([]);
  });
});

describe('a stat block that prints Sunlight Weakness', () => {
  /**
   * "While in sunlight, the shadow has Disadvantage on D20 Tests" — and the
   * glossary says what that phrase covers: "D20 Tests encompass the three main
   * d20 rolls of the game: ability checks, attack rolls, and saving throws."
   */
  it('bites on all three rolls a D20 Test is', () => {
    const built = table('shadow', SHADOW);
    built.do('the sun', (s) =>
      declareLight(s, 'the open ground', {
        region: { origin: { creature: SHADOW }, shape: { kind: 'sphere', radius: 20 } },
        level: 'bright',
        sunlight: true,
      }),
    );

    expect(modes(built.state, SHADOW, 'attack')).toEqual(['Sunlight Weakness']);
    expect(modes(built.state, SHADOW, 'ability-check')).toEqual(['Sunlight Weakness']);
    expect(modes(built.state, SHADOW, 'saving-throw')).toEqual(['Sunlight Weakness']);
  });
});

describe('a stat block that prints neither', () => {
  /**
   * The Bandit rather than the Goblin Warrior, and the change is a reader
   * landing rather than a fixture drifting: the goblin prints Nimble Escape,
   * which `adaptMonster` now compiles into the two `action-rule` effects its
   * sentence names. So "a block that prints neither sunlight sentence" and "a
   * block with no standing effects at all" stopped being the same block, and
   * this claim is about the second.
   */
  it('gains no standing effect it was not given', () => {
    const built = table('bandit', id('a-bandit'));
    const bandit = built.state.creatures[id('a-bandit')];
    expect(bandit?.sheet.standing).toBeUndefined();
    expect(modes(built.state, id('a-bandit'), 'attack')).toEqual([]);
  });
});
