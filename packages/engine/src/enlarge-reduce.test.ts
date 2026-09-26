import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { sizeOf } from './positioning.js';
import { effectiveSizeOf } from './size.js';
import { declaredCasting } from './spellcasting.js';
import { endConcentration, resolveAttack, resolveSpell, resolveTest } from './commands.js';

/**
 * SRD Enlarge/Reduce, both halves whole.
 *
 * > "If the target is an unwilling creature, it can make a Constitution saving
 * > throw. On a successful save, the spell has no effect. … _Enlarge._ The
 * > target's size increases by one category — from Medium to Large, for
 * > example. The target also has Advantage on Strength checks and Strength
 * > saving throws. The target's attacks with its enlarged weapons or Unarmed
 * > Strikes deal an extra 1d4 damage on a hit. _Reduce._ The target's size
 * > decreases by one category … Disadvantage on Strength checks and Strength
 * > saving throws … deal 1d4 less damage on a hit (this can't reduce the
 * > damage below 1)."
 *
 * Four clauses per branch, and every one of them rides the branch's own
 * Constitution save: a **size** rider — the type override's twin, a sourced
 * grant `effectiveSizeOf` shifts the creature's size by — two narrowed modes,
 * an untyped extra die on the target's own weapon and Unarmed Strike blows,
 * and the damage penalty floored at 1. The save is offered to the unwilling
 * alone, which is `unlessWilling` read inside a branch for the first time.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  // Stated, so the map is settled off the record and gives the size back.
  size: 'medium',
  side,
});

const YARD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'foes'),
  { type: 'items-gained', id: FIGHTER, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
  { type: 'item-equipped', id: FIGHTER, item: 'longsword', armor: null },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['enlarge-reduce'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the post', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the post' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: WIZARD }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WIZARD, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
];

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

const DOOMED = -40;
const SPARED = 40;
const HITS = 40;

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** The wizard's casting, on a willing fighter or an unwilling goblin. */
const cast = (
  option: 'enlarge' | 'reduce',
  target: CharacterId,
  over: { readonly willing?: readonly CharacterId[]; readonly flat?: number } = {},
) => {
  const out = must(
    resolveSpell(
      fold('seed', YARD),
      WIZARD,
      {
        spellId: 'enlarge-reduce',
        targets: [target],
        option,
        ...(over.willing === undefined ? {} : { willing: over.willing }),
      },
      supply('grow', over.flat),
    ),
    option,
  );
  return { out, log: [...YARD, ...out.events], state: fold('seed', [...YARD, ...out.events]) };
};

const grown = () => cast('enlarge', FIGHTER, { willing: [FIGHTER] });
const shrunk = () => cast('reduce', FIGHTER, { willing: [FIGHTER] });

/** A saving throw or check the fighter makes, and the modes it was rolled under. */
const modesOn = (
  state: GameState,
  kind: 'saving-throw' | 'ability-check',
  ability: 'str' | 'dex',
): readonly string[] =>
  must(
    resolveTest(state, FIGHTER, { kind, ability, dc: 10 }, supply('test')),
    kind,
  ).test!.modeSources.map((one) => `${one.mode}:${one.source}`);

/** The fighter's longsword hit on the goblin, off one seed, so only the riders differ. */
const swing = (state: GameState): number =>
  must(
    resolveAttack(state, FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply('blow', HITS)),
    'swing',
  ).damage!;

describe('SRD Enlarge', () => {
  it('makes the fighter one size larger, to every reader and to the map', () => {
    const { state } = grown();
    expect(effectiveSizeOf(state, FIGHTER)).toBe('large');
    expect(sizeOf(state.scene!, FIGHTER)).toBe('large');
  });

  it('gives the size back when the Concentration is let go', () => {
    const { log, state } = grown();
    const after = fold('seed', [...log, ...must(endConcentration(state, WIZARD, 'voluntary'), 'let go')]);
    expect(effectiveSizeOf(after, FIGHTER)).toBe('medium');
    expect(sizeOf(after.scene!, FIGHTER)).toBe('medium');
  });

  it('grants Advantage on Strength saves and Strength checks, and not on a Dexterity save', () => {
    const { state } = grown();
    expect(modesOn(state, 'saving-throw', 'str').some((one) => one.startsWith('advantage:'))).toBe(true);
    expect(modesOn(state, 'ability-check', 'str').some((one) => one.startsWith('advantage:'))).toBe(true);
    expect(modesOn(state, 'saving-throw', 'dex')).toEqual([]);
  });

  it('adds a die of the weapon’s own damage to a longsword hit', () => {
    expect(swing(grown().state)).toBeGreaterThan(swing(fold('seed', YARD)));
  });

  it('offers a willing target no saving throw', () => {
    const { out } = grown();
    expect(out.events.some((event) => event.type === 'roll-recorded' && event.who === FIGHTER)).toBe(false);
    expect(out.outcomes.find((one) => one.target === FIGHTER)?.affected).toBe(true);
  });
});

describe('SRD Reduce', () => {
  it('makes the fighter one size smaller, with Disadvantage on Strength', () => {
    const { state } = shrunk();
    expect(effectiveSizeOf(state, FIGHTER)).toBe('small');
    expect(sizeOf(state.scene!, FIGHTER)).toBe('small');
    expect(modesOn(state, 'saving-throw', 'str').some((one) => one.startsWith('disadvantage:'))).toBe(true);
    expect(modesOn(state, 'ability-check', 'str').some((one) => one.startsWith('disadvantage:'))).toBe(true);
  });

  it('takes a die off a longsword hit and never below one', () => {
    const reduced = swing(shrunk().state);
    expect(reduced).toBeLessThan(swing(fold('seed', YARD)));
    expect(reduced).toBeGreaterThanOrEqual(1);
  });
});

describe('the Constitution save an unwilling creature is offered', () => {
  it('leaves a goblin that makes it exactly as it was', () => {
    const { out, state } = cast('reduce', GOBLIN, { flat: SPARED });
    expect(out.outcomes.find((one) => one.target === GOBLIN)?.affected).toBe(false);
    expect(effectiveSizeOf(state, GOBLIN)).toBe('medium');
    expect(out.events.some((event) => event.type === 'roll-recorded' && event.who === GOBLIN)).toBe(true);
  });

  it('shrinks a goblin that fails it', () => {
    const { state } = cast('reduce', GOBLIN, { flat: DOOMED });
    expect(effectiveSizeOf(state, GOBLIN)).toBe('small');
  });
});
