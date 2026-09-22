import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { fallDamageDice, resolveFall } from './commands.js';

/**
 * What a landing costs.
 *
 * SRD "Falling", whole: "When you fall from a great height, you descend up to
 * 500 feet at the end of the current turn. If you're still falling on your
 * next turn, you continue to descend. When you land, unless you avoid taking
 * damage from the fall, you take 1d6 Bludgeoning damage for every 10 feet you
 * fell, to a maximum of 20d6. You then have the Prone condition."
 *
 * **The declaration was the half that existed and this is the other.**
 * `fall-declared` says a creature is falling *now*, which is what opens the
 * window *Feather Fall* and the Monk's Slow Fall answer; nothing in the engine
 * took a point of damage from it, held a height, or put anybody on the ground.
 *
 * **The height is the table's and everything downstream of it is the
 * engine's** — the same split cover, sight, Difficult Terrain and the fall
 * itself already take. The SRD gives a rate ("up to 500 feet") and gives the
 * distance to the DM, so a height the engine computed would be a number it
 * exists not to invent; the dice, the cap, the damage type, the defences it
 * meets, the Concentration it puts at risk and the Prone are every one of them
 * the rule.
 */

const id = (s: string) => asCharacterId(s);
const CLIMBER = id('climber');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: CLIMBER,
    name: 'the climber',
    sheet: sheet(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const fell = (feet: number, seed = 'fall', log: readonly GameEvent[] = SETUP) =>
  unwrap(resolveFall(fold('seed', log), CLIMBER, { feet }, supply(seed)), `a ${feet}-foot fall`);

const conditionsOf = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]!.conditions.conditions;

describe('the dice a height comes to', () => {
  /** "1d6 Bludgeoning damage for every 10 feet you fell." */
  it('is one die per ten feet, and counts only whole ten-foot drops', () => {
    expect(fallDamageDice(0)).toBe(0);
    expect(fallDamageDice(5)).toBe(0);
    expect(fallDamageDice(10)).toBe(1);
    expect(fallDamageDice(19)).toBe(1);
    expect(fallDamageDice(20)).toBe(2);
    expect(fallDamageDice(100)).toBe(10);
  });

  /** "to a maximum of 20d6" — which a 500-foot descent reaches with room over. */
  it('stops at twenty dice however far the drop was', () => {
    expect(fallDamageDice(200)).toBe(20);
    expect(fallDamageDice(500)).toBe(20);
    expect(fallDamageDice(10_000)).toBe(20);
  });
});

describe('landing', () => {
  it('rolls one d6 per ten feet, as Bludgeoning, and lands the creature Prone', () => {
    const out = fell(30);
    expect(out.dice).toBe('3d6');
    expect(out.damage).toBeGreaterThanOrEqual(3);
    expect(out.damage).toBeLessThanOrEqual(18);
    expect(out.prone).toBe(true);

    const rolled = out.events.find((e) => e.type === 'damage-dice-recorded');
    expect(rolled).toBeDefined();
    expect(out.events.some((e) => e.type === 'damage-taken')).toBe(true);

    const after = fold('seed', [...SETUP, ...out.events]);
    expect(conditionsOf(after, CLIMBER)).toContain('prone');
    expect(after.creatures[CLIMBER]!.vitals.hp).toBe(400 - out.damage);
  });

  it('throws twenty dice and no more for a five-hundred-foot drop', () => {
    const out = fell(500, 'long way');
    expect(out.dice).toBe('20d6');
    expect(out.damage).toBeGreaterThanOrEqual(20);
    expect(out.damage).toBeLessThanOrEqual(120);
  });

  /**
   * "unless you avoid taking damage from the fall ... **You then** have the
   * Prone condition." A drop too short to cost a die is a drop nobody lands
   * badly from, so the two answers move together rather than separately.
   */
  it('costs nothing and floors nobody for a drop under ten feet', () => {
    const out = fell(5);
    expect(out.dice).toBeNull();
    expect(out.damage).toBe(0);
    expect(out.prone).toBe(false);
    expect(out.events).toEqual([]);
  });

  /** The height is the table's, and a height that is not one is refused. */
  it('refuses a height that is not a whole number of feet', () => {
    const out = resolveFall(fold('seed', SETUP), CLIMBER, { feet: -10 }, supply('backwards'));
    expect(isErr(out) ? out.code : 'ok').toBe('bad_fall_distance');
  });

  /** And the same command id twice is one fall, like every other command. */
  it('is idempotent under its command id', () => {
    const first = fell(30, 'twice');
    const after = fold('seed', [...SETUP, ...first.events]);
    const again = unwrap(
      resolveFall(after, CLIMBER, { feet: 30, commandId: 'the-fall' }, supply('twice')),
      'a retry',
    );
    const third = unwrap(
      resolveFall(
        fold('seed', [...SETUP, ...first.events, ...again.events]),
        CLIMBER,
        { feet: 30, commandId: 'the-fall' },
        supply('twice'),
      ),
      'the same retry',
    );
    expect(third.duplicate).toBe(true);
    expect(third.events).toEqual([]);
  });
});
