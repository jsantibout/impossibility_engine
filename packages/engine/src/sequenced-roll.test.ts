import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';

/**
 * A second roll **sequenced after the first**, over an area the casting never
 * named.
 *
 * SRD Ice Knife: "Make a ranged spell attack against the target. On a hit, the
 * target takes 1d10 Piercing damage. **Hit or miss, the shard then explodes.**
 * The target and each creature within 5 feet of it must succeed on a
 * Dexterity saving throw or take 2d6 Cold damage."
 *
 * `OutcomeRiders` rejects this by name — "a child that rolls is a parent" —
 * and it is right to: a rider hangs off a settled outcome and this does not
 * hang off one at all. "Hit or miss" is the word that settles it. So `then` is
 * not a rider slot: it is a **second parent**, with its own area and its own
 * effect list, resolved after the attack whatever the attack did, one level
 * deep and no deeper.
 *
 * The attack is also the smaller half of the spell. A definition that resolved
 * it alone would deal under half the printed damage at every slot level, which
 * is the reading Scorching Ray got for the same reason from the other side.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const NEIGHBOUR = id('neighbour');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 1, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

/** Armour Class stated, so the fixture decides the hit and the die decides nothing. */
const added = (who: CharacterId, ac: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet({ stated: { armorClass: ac, proficiencyBonus: 2, initiative: 0 } }),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === WIZARD ? 'party' : 'foes',
});

const field = (goblinAc: number): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: WIZARD,
    name: WIZARD,
    sheet: sheet({ abilities: { str: 10, dex: 14, con: 10, int: 20, wis: 10, cha: 10 } }),
    maxHp: 80,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  added(GOBLIN, goblinAc),
  added(NEIGHBOUR, 15),
  added(BYSTANDER, 15),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['ice-knife'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 30, bearing: 0 } },
  // Five feet from the goblin, which is inside the burst.
  { type: 'creature-placed', id: NEIGHBOUR, placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 } },
  // Fifteen, which is not.
  { type: 'creature-placed', id: BYSTANDER, placement: { from: { creature: GOBLIN }, feet: 15, bearing: 270 } },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Low enough that the shard always lands; high enough that it never does. */
const HITS = 1;
const MISSES = 30;

interface Thrown {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly hit: boolean;
}

const throwIt = (goblinAc: number, slotLevel = 1, seed = 'shard'): Thrown => {
  const setup = field(goblinAc);
  const out = unwrap(
    resolveSpell(
      fold('seed', setup),
      WIZARD,
      { spellId: 'ice-knife', targets: [GOBLIN], slotLevel },
      supply(seed),
    ),
    'ice knife',
  );
  return {
    state: fold('seed', [...setup, ...out.events]),
    events: out.events,
    hit: out.outcomes.some((outcome) => outcome.attack?.hit === true),
  };
};

const lost = (thrown: Thrown, who: CharacterId): number =>
  200 - (thrown.state.creatures[who]?.vitals.hp ?? 0);

/** The types of damage the log says this creature was dealt, in order. */
const damageLabels = (thrown: Thrown, who: CharacterId): readonly string[] =>
  thrown.events
    .filter(
      (event): event is Extract<GameEvent, { type: 'damage-dice-recorded' }> =>
        event.type === 'damage-dice-recorded' && event.target === who,
    )
    .flatMap((event) => event.components.map((component) => component.type));

describe('Ice Knife throws a shard and then bursts', () => {
  it('deals the attack’s Piercing and the burst’s Cold to a target it hits', () => {
    const thrown = throwIt(HITS);
    expect(thrown.hit).toBe(true);

    expect(damageLabels(thrown, GOBLIN)).toEqual(
      expect.arrayContaining(['piercing', 'cold']),
    );
    expect(lost(thrown, GOBLIN)).toBeGreaterThan(0);
  });

  /** "The target **and each creature within 5 feet of it**." */
  it('catches a creature standing beside the target, and not one fifteen feet away', () => {
    const thrown = throwIt(HITS);

    expect(damageLabels(thrown, NEIGHBOUR)).toEqual(['cold']);
    expect(lost(thrown, BYSTANDER)).toBe(0);
  });

  /**
   * "**Hit or miss**, the shard then explodes." The clause the whole shape is
   * for: the burst is not a consequence of a settled outcome, so there is no
   * branch it could ride.
   */
  it('bursts on a miss too, and deals no Piercing', () => {
    const thrown = throwIt(MISSES);
    expect(thrown.hit).toBe(false);

    expect(damageLabels(thrown, GOBLIN)).toEqual(['cold']);
    expect(damageLabels(thrown, NEIGHBOUR)).toEqual(['cold']);
    expect(lost(thrown, GOBLIN)).toBeGreaterThan(0);
  });

  /**
   * "The **Cold** damage increases by 1d6 for each spell slot level above 1" —
   * the upcast is the burst's and not the attack's, so a level 2 casting
   * throws three Cold dice and the same one Piercing.
   */
  it('scales the burst with the slot and leaves the shard alone', () => {
    const one = throwIt(MISSES, 1, 'scale');
    const two = throwIt(MISSES, 2, 'scale');

    const coldDice = (thrown: Thrown, who: CharacterId): number =>
      thrown.events
        .filter(
          (event): event is Extract<GameEvent, { type: 'damage-dice-recorded' }> =>
            event.type === 'damage-dice-recorded' && event.target === who,
        )
        .flatMap((event) => event.components)
        .flatMap((component) => component.dice).length;

    // Two Cold dice at level 1 and three at level 2, which is the printed
    // upcast; a miss, so the shard's own die is thrown for nobody.
    expect(coldDice(one, NEIGHBOUR)).toBe(2);
    expect(coldDice(two, NEIGHBOUR)).toBe(3);
    expect(damageLabels(one, GOBLIN)).toEqual(['cold']);
    // And the level 2 burst hurts more, which is the 1d6 the slot buys.
    expect(lost(two, NEIGHBOUR)).toBeGreaterThan(lost(one, NEIGHBOUR));
  });
});
