import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import { passivePerception, type CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { passivePerceptionOf } from './standing.js';
import { resolveSpell, resolveTest } from './commands.js';

/**
 * SRD Enthrall, whole.
 *
 * > "You weave a distracting string of words, causing creatures of your choice
 * > that you can see within range to make a Wisdom saving throw. Any creature
 * > you or your companions are fighting automatically succeeds on this save.
 * > On a failed save, a target has a −10 penalty to Wisdom (Perception) checks
 * > and Passive Perception until the spell ends."
 *
 * Two things this spell waited on, and both were half-built. The fought fact
 * was stated at the casting and read as Advantage by five spells; this one
 * reads it as an automatic success, which is `autoSucceedIf`'s third member
 * beside a defence held and a rating printed. And a bonus narrowed to a skill
 * existed for Guidance; what was missing was the passive side, so
 * `passivePerceptionOf` derives the passive score from the same stored bonus
 * rather than from the sheet alone.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BARD = id('bard');
/** The creature the party is fighting: spared before the die is read. */
const BANDIT = id('bandit');
/** A bystander nobody is fighting: fails and is distracted. */
const BYSTANDER = id('bystander');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 14, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
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

const SQUARE: readonly GameEvent[] = [
  added(BARD, 'party'),
  added(BANDIT, 'bandits'),
  added(BYSTANDER, 'townsfolk'),
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'bard', prepared: ['enthrall'] }),
  },
  {
    type: 'resource-pool-declared',
    id: BARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the fountain', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the fountain' }, feet: 0 } },
  { type: 'creature-placed', id: BANDIT, placement: { from: { creature: BARD }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: BYSTANDER, placement: { from: { creature: BARD }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: BARD, to: BANDIT, seen: true },
  { type: 'sight-declared', from: BARD, to: BYSTANDER, seen: true },
];

const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

/** A save nobody could make, unless the book makes it for them. */
const DOOMED = -40;

const enthralled = () => {
  const out = unwrap(
    resolveSpell(
      fold('seed', SQUARE),
      BARD,
      { spellId: 'enthrall', targets: [BANDIT, BYSTANDER], fought: [BANDIT] },
      supply('weave', DOOMED),
    ),
    'enthrall',
  );
  return { out, log: [...SQUARE, ...out.events] };
};

/** A skill check's total, off a fresh generator so two checks share one die. */
const check = (log: readonly GameEvent[], who: CharacterId, skill: 'perception' | 'insight') =>
  unwrap(
    resolveTest(
      fold('seed', log),
      who,
      { kind: 'ability-check', ability: 'wis', skill, dc: 10 },
      supply('one-die'),
    ),
    skill,
  ).test!.total;

describe('SRD Enthrall’s saving throw', () => {
  it('is made for the creature the party is fighting, whatever the die says', () => {
    const { out } = enthralled();
    expect(out.outcomes.find((one) => one.target === BANDIT)?.affected).toBe(false);
    expect(out.outcomes.find((one) => one.target === BYSTANDER)?.affected).toBe(true);
  });

  it('asks who is being fought before anything is spent', () => {
    const out = resolveSpell(
      fold('seed', SQUARE),
      BARD,
      { spellId: 'enthrall', targets: [BANDIT, BYSTANDER] },
      supply('weave', DOOMED),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('fought_fact_required');
  });
});

describe('SRD Enthrall’s −10, narrowed to one skill', () => {
  it('takes ten off a Wisdom (Perception) check and nothing off an Insight check', () => {
    const { log } = enthralled();
    const perception = check(log, BYSTANDER, 'perception');
    const insight = check(log, BYSTANDER, 'insight');
    expect(insight - perception).toBe(10);
    // The same two checks before the casting share one die and one modifier.
    expect(check(SQUARE, BYSTANDER, 'perception')).toBe(check(SQUARE, BYSTANDER, 'insight'));
  });

  it('leaves the spared creature’s Perception where it was', () => {
    const { log } = enthralled();
    expect(check(log, BANDIT, 'perception')).toBe(check(SQUARE, BANDIT, 'perception'));
  });

  it('reaches Passive Perception through the same stored bonus', () => {
    const { log } = enthralled();
    const state: GameState = fold('seed', log);
    expect(passivePerceptionOf(state, BYSTANDER)).toBe(passivePerception(sheet()) - 10);
    expect(passivePerceptionOf(state, BANDIT)).toBe(passivePerception(sheet()));
  });
});
