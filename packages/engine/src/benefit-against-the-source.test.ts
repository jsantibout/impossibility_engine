import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import {
  attackerConditionModes,
  initiativeConditionModes,
  targetConditionModes,
} from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveAttack, resolveSpell } from './commands.js';
import { effectiveConditions } from './standing.js';

/**
 * A benefit denied **against one creature**, and the creature is the caster.
 *
 * SRD Mind Spike: "While you have this knowledge, the target can't become
 * hidden from you, and if it has the Invisible condition, **it gains no
 * benefit from that condition against you**."
 *
 * The `benefit` rider was built for SRD Starry Wisp, whose denial is blanket:
 * the target gets nothing out of being Invisible against anybody. Mind Spike's
 * is narrowed to one creature and a blanket denial would be *wrong* for it
 * rather than merely coarse — the goblin the wizard has spiked still has
 * Advantage on its attacks against everybody else, and still rolls Initiative
 * with the Advantage the condition confers, which is against nobody at all.
 *
 * So the denial names the participant the rider's world has that the rider
 * does not: the effect's **source**. A definition names the role, the resolver
 * binds the id — the rule every number on a casting follows — and
 * `benefitsFrom` is asked about a creature rather than in the abstract.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const SNEAK = id('sneak');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 20, wis: 1, cha: 10 },
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

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(ALLY, 'party'),
  added(SNEAK, 'foes', { stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 } }),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['mind-spike'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  ...[WIZARD, ALLY].map(
    (who): GameEvent => ({
      type: 'items-gained',
      id: who,
      items: [{ id: 'dagger', quantity: 1 }],
      source: 'kit',
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: SNEAK, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WIZARD, to: SNEAK, seen: true },
];

/**
 * The sneak drinks the potion **after** the spike lands, and both onlookers
 * lose sight of them.
 *
 * Written this way round because SRD Invisible's own exception would otherwise
 * do Mind Spike's work for it: "If a creature can somehow see you, you don't
 * gain this benefit against that creature", and a declared sight line is what
 * `canSomehowSee` answers first. So the scene is the one the spell is for —
 * the target vanishes, nobody can see them, and the wizard knows where they
 * are anyway.
 */
const VANISH: readonly GameEvent[] = [
  { type: 'condition-applied', id: SNEAK, condition: 'invisible', source: 'a potion' },
  { type: 'sight-declared', from: WIZARD, to: SNEAK, seen: false },
  { type: 'sight-declared', from: ALLY, to: SNEAK, seen: false },
];

const supply = (seed: string, flat: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const FAILS = -40;
const SAVES = 40;

const spike = (bonus: number): GameState => {
  const out = unwrap(
    resolveSpell(
      fold('seed', SETUP),
      WIZARD,
      { spellId: 'mind-spike', targets: [SNEAK], slotLevel: 2 },
      supply('spike', bonus),
    ),
    'mind spike',
  );
  return fold('seed', [...SETUP, ...out.events, ...VANISH]);
};

/** What Invisible is doing for the sneak, as the creature facing them sees it. */
const invisibility = (state: GameState, against: CharacterId): readonly string[] =>
  [
    ...attackerConditionModes(effectiveConditions(state, SNEAK, against), {}),
    ...targetConditionModes(effectiveConditions(state, SNEAK, against), {}),
  ]
    .filter((mode) => mode.source === 'Invisible')
    .map((mode) => `${mode.mode} on ${mode.source}`);

describe('Mind Spike narrows the denial to the caster', () => {
  it('takes the benefit away against the caster on a failed save', () => {
    expect(invisibility(spike(FAILS), WIZARD)).toEqual([]);
  });

  /** "against **you**" — and the wizard's ally is not you. */
  it('leaves it standing against everybody else', () => {
    expect(invisibility(spike(FAILS), ALLY)).toEqual([
      'advantage on Invisible',
      'disadvantage on Invisible',
    ]);
  });

  /**
   * The reading a blanket denial would get wrong, and the one the map named:
   * Invisible's Advantage on Initiative is against nobody, so "against you"
   * does not reach it and the spiked creature still rolls with it.
   */
  it('leaves the Initiative Advantage alone', () => {
    const modes = initiativeConditionModes(effectiveConditions(spike(FAILS), SNEAK));
    expect(modes.map((mode) => `${mode.mode} on ${mode.source}`)).toEqual([
      'advantage on Invisible',
    ]);
  });

  it('does none of it to a target that makes its save', () => {
    expect(invisibility(spike(SAVES), WIZARD)).toEqual([
      'advantage on Invisible',
      'disadvantage on Invisible',
    ]);
  });

  /**
   * And the swing itself, which is what the denial is for: the wizard's attack
   * on the spiked creature rolls flat where their ally's rolls at
   * Disadvantage.
   */
  it('reaches the attack roll, and only the caster’s', () => {
    const state = spike(FAILS);
    const swing = (who: CharacterId) =>
      unwrap(
        resolveAttack(state, who, { target: SNEAK, weapon: 'dagger' }, supply('swing', 0)),
        `${who} swinging`,
      ).attack!.mode;

    expect(swing(WIZARD)).toBe('normal');
    expect(swing(ALLY)).toBe('disadvantage');
  });
});
