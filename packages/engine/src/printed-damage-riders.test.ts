import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRider } from './monster.js';
import { createRollIssuer } from './rolls.js';

/**
 * The two printed-rider families that are about the **damage roll** rather
 * than about an effect the hit buys.
 *
 * `readPrintedRider` refused both by name, and its own comment said why: "an
 * extra damage die … belongs to the damage roll rather than to an effect list:
 * it is doubled by a critical hit and meets the target's defences with the
 * blow, and a rider is a leaf that rolls nothing." That is an argument about
 * `HitOption`, which is what the reader's other two members become — and it is
 * answered by giving the swing a second reader rather than by bending the
 * first. Both sentences are gates the engine already holds every fact for:
 *
 * | SRD | Gate | What it does |
 * |---|---|---|
 * | Goblin Warrior's Scimitar | "if the attack roll had Advantage" | a component **beside** the weapon's |
 * | Swarm of Rats' Bites | "if the swarm is Bloodied" | the damage the line rolls **instead** |
 * | Blood Hawk's Beak | "if the target is Bloodied" | the same, gated on the other creature |
 *
 * The charge gate — "moved 20+ feet straight toward it immediately before the
 * hit" — stays refused, because nothing on the turn budget says what a
 * creature's last move was shaped like.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const SEED = 'printed-riders';
const BITER = id('biter');
const PREY = id('prey');

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A stat block within reach of an ogre, both on declared sides. */
function field(blockId: string): GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, BITER, blockId), 'the biter').events);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, PREY, 'ogre'), 'the prey').events);
  log.push(...unwrap(declareCreatureSide(state(), BITER, 'monsters'), 'a side'));
  log.push(...unwrap(declareCreatureSide(state(), PREY, 'party'), 'the other'));
  log.push(...unwrap(setScene(state(), { width: 400, depth: 400, height: 200 }), 'the field'));
  log.push(...unwrap(addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }), 'a stone'));
  log.push(
    ...unwrap(
      placeCreatureInScene(state(), BITER, { from: { landmark: 'the stone' }, feet: 0 }),
      'the biter on it',
    ),
  );
  log.push(
    ...unwrap(
      placeCreatureInScene(state(), PREY, { from: { creature: BITER }, feet: 5, bearing: 90 }),
      'the prey beside it',
    ),
  );
  return log;
}

/** Half the printed maximum, rounded up, which is one point past Bloodied. */
const hurt = (log: GameEvent[], who: CharacterId): GameEvent[] => {
  const creature = fold(SEED, log).creatures[who]!;
  return [
    ...log,
    {
      type: 'damage-taken',
      id: who,
      amount: Math.ceil(creature.vitals.hpMax / 2),
      source: 'the fixture',
    },
  ];
};

/**
 * The damage components a swing dealt, by source and type, with the notation
 * the dice were thrown on.
 *
 * Read off `damage-dice-recorded`, which is the event that says what was
 * rolled rather than what it came to — a total would let a bigger die and a
 * second component look alike.
 */
interface Slice {
  readonly source: string;
  readonly type: string;
  /** The notation the slice threw, read back off the faces: `2d4`, `1d8`. */
  readonly rolled: string;
  readonly flat: number;
}

const slicesOf = (events: readonly GameEvent[]): readonly Slice[] => {
  const record = events.find((event) => event.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') return [];
  return record.components.map((component) => ({
    source: component.source,
    type: component.type,
    rolled: `${component.dice.length}d${component.dice[0]?.sides ?? 0}`,
    flat: component.flat,
  }));
};

/** A swing whose attack roll is forced past the Ogre's Armour Class. */
const swing = (
  log: readonly GameEvent[],
  action: string,
  modes: readonly { readonly mode: 'advantage' | 'disadvantage'; readonly source: string }[] = [],
): readonly GameEvent[] => {
  // Every seed is tried until one of them hits, so the assertions below are
  // about the damage rather than about the d20.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const out = unwrap(
      resolveAttack(
        fold(SEED, log),
        BITER,
        { target: PREY, weapon: null, action, free: true, modes },
        supply(`${SEED}:${attempt}`),
      ),
      'the swing',
    );
    if (out.attack?.hit === true && out.attack.critical === false) return out.events;
  }
  throw new Error('no seed in forty landed an ordinary hit');
};

describe('what `readPrintedRider` makes of a printed damage clause', () => {
  it('reads the extra component a roll made with Advantage buys', () => {
    expect(readPrintedRider('plus 2 (1d4) Slashing damage if the attack roll had Advantage.')).toEqual(
      {
        kind: 'damage',
        how: 'extra',
        dice: '1d4',
        flat: 0,
        type: 'slashing',
        when: { kind: 'attack-had-advantage' },
      },
    );
  });

  it('reads the damage a Bloodied block rolls instead, on either creature', () => {
    expect(readPrintedRider('or 3 (1d4 + 1) Poison damage if the swarm is Bloodied.')).toEqual({
      kind: 'damage',
      how: 'instead',
      dice: '1d4',
      flat: 1,
      type: 'poison',
      when: { kind: 'bloodied', who: 'attacker' },
    });
    expect(readPrintedRider('or 6 (1d8 + 2) Piercing damage if the target is Bloodied.')).toEqual({
      kind: 'damage',
      how: 'instead',
      dice: '1d8',
      flat: 2,
      type: 'piercing',
      when: { kind: 'bloodied', who: 'target' },
    });
  });

  /**
   * The refusals that stay refusals. A charge is a fact about the move before
   * the swing that no turn budget keeps; a gate naming somebody this reader
   * cannot identify is the same refusal `NAMES_NOBODY_IN_THE_HIT` already
   * makes; and a damage type the engine has no defences for would meet none.
   */
  it('refuses a charge, a stranger and a type the engine does not have', () => {
    expect(
      readPrintedRider(
        'If the target is a Large or smaller creature and the elk moved 20+ feet straight toward it immediately before the hit, the target takes an extra 3 (1d6) Bludgeoning damage and has the Prone condition.',
      ),
    ).toBeNull();
    expect(readPrintedRider('or 2 (1d4) Piercing damage if the victim is Bloodied.')).toBeNull();
    expect(readPrintedRider('plus 2 (1d4) Moonlight damage if the attack roll had Advantage.')).toBeNull();
  });
});

describe('SRD Goblin Warrior: "plus 2 (1d4) Slashing damage if the attack roll had Advantage"', () => {
  const log = field('goblin-warrior');

  it('adds the component when the roll had Advantage, in the line’s own type', () => {
    const slices = slicesOf(
      swing(log, 'Scimitar', [{ mode: 'advantage', source: 'the fixture' }]),
    );
    // The line's own 1d6 + 2, and the rider's 1d4 beside it in the same type.
    expect(slices).toEqual([
      { source: 'Scimitar', type: 'slashing', rolled: '1d6', flat: 2 },
      { source: 'Scimitar', type: 'slashing', rolled: '1d4', flat: 0 },
    ]);
  });

  it('adds nothing to a roll made straight', () => {
    expect(slicesOf(swing(log, 'Scimitar'))).toEqual([
      { source: 'Scimitar', type: 'slashing', rolled: '1d6', flat: 2 },
    ]);
  });
});

describe('SRD Swarm of Rats: "or 2 (1d4) Piercing damage if the swarm is Bloodied"', () => {
  const log = field('swarm-of-rats');

  it('rolls the printed 2d4 while the swarm is whole', () => {
    expect(slicesOf(swing(log, 'Bites'))).toEqual([
      { source: 'Bites', type: 'piercing', rolled: '2d4', flat: 0 },
    ]);
  });

  it('rolls the lesser die instead once the swarm is Bloodied', () => {
    expect(slicesOf(swing(hurt(log, BITER), 'Bites'))).toEqual([
      { source: 'Bites', type: 'piercing', rolled: '1d4', flat: 0 },
    ]);
  });
});

describe('SRD Blood Hawk: "or 6 (1d8 + 2) Piercing damage if the target is Bloodied"', () => {
  const log = field('blood-hawk');

  it('rolls the printed 1d4 against a target at full strength', () => {
    expect(slicesOf(swing(log, 'Beak'))).toEqual([
      { source: 'Beak', type: 'piercing', rolled: '1d4', flat: 2 },
    ]);
  });

  /**
   * One die either way, so the count cannot tell them apart and the die's own
   * size is what the record is read for.
   */
  it('rolls the bigger die against a Bloodied one', () => {
    expect(slicesOf(swing(hurt(log, PREY), 'Beak'))).toEqual([
      { source: 'Beak', type: 'piercing', rolled: '1d8', flat: 2 },
    ]);
  });
});
