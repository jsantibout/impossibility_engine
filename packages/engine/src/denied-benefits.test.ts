import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
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
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveSpell, resolveTurn } from './commands.js';
import { effectiveConditions } from './standing.js';

/**
 * A condition a creature still has and **can no longer benefit from**.
 *
 * > SRD Starry Wisp: "On a hit, the target takes 1d8 Radiant damage, and
 * > until the end of your next turn, it emits Dim Light in a 10-foot radius
 * > and **can't benefit from the Invisible condition**."
 *
 * Three spells print the clause and every one of them prints it as a
 * consequence of a *settled outcome* — Starry Wisp "on a hit", Faerie Fire
 * "if it fails a Dexterity saving throw", Mind Spike "on a failed save" — so
 * it is a {@link ModifierRider} and not an effect of its own: an effect at
 * the top level would fire on a miss.
 *
 * **Denying a benefit is not ending a condition**, and the difference is the
 * whole of why this is its own grant family rather than a `condition` removed.
 * The creature is still Invisible: it is still Invisible for anything that
 * reads the *fact* — what a later Faerie Fire would find, what
 * `end-condition` would cure, what an onlooker's narration says — and what it
 * has lost is the three sentences the condition would otherwise have bought
 * it. Removing the condition would also hand back everything a second effect
 * had hung on its being there, and would be undone by nothing.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BARD = id('bard');
const SNEAK = id('sneak');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 20 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** The Bard goes first, so "the end of your next turn" is a round away. */
const SETUP: readonly GameEvent[] = [
  added(BARD),
  // An Armour Class a spell attack cannot miss, so the fixture is about the
  // rule the hit hangs rather than about which way a die fell.
  added(SNEAK, { stated: { armorClass: 1, proficiencyBonus: 2, initiative: 0 } }),
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({
      ability: 'cha',
      classId: 'bard',
      cantrips: ['starry-wisp'],
      prepared: [],
    }),
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: SNEAK,
    placement: { from: { creature: BARD }, feet: 15, bearing: 0 },
  },
  { type: 'sight-declared', from: BARD, to: SNEAK, seen: true },
  { type: 'sight-declared', from: SNEAK, to: BARD, seen: true },
  // The condition the wisp takes the good out of, from something the wisp
  // did not cast and does not end.
  { type: 'condition-applied', id: SNEAK, condition: 'invisible', source: 'a potion' },
  {
    type: 'combat-started',
    combatants: [
      { id: BARD, initiative: 20, speed: 30 },
      { id: SNEAK, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'wisp') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the wisp');

const wisp = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveSpell(fold('seed', log), BARD, { spellId: 'starry-wisp', targets: [SNEAK] }, supply()))
    .events,
];

const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

/** What the three readers say about the Invisible condition, in one list. */
const invisibility = (state: GameState): readonly string[] =>
  [
    ...attackerConditionModes(effectiveConditions(state, SNEAK), {}),
    ...targetConditionModes(effectiveConditions(state, SNEAK), {}),
    ...initiativeConditionModes(effectiveConditions(state, SNEAK)),
  ]
    .filter((mode) => mode.source === 'Invisible')
    .map((mode) => `${mode.mode} on ${mode.source}`);

describe('a benefit a settled outcome denies', () => {
  /**
   * The baseline, without which the rest of this file proves nothing: the
   * three readers that hand Invisible its benefits do hand them over.
   */
  it('grants the condition its three benefits while nothing denies them', () => {
    expect(invisibility(fold('seed', SETUP))).toEqual([
      'advantage on Invisible',
      'disadvantage on Invisible',
      'advantage on Invisible',
    ]);
  });

  it('takes all three away on a hit', () => {
    expect(invisibility(fold('seed', wisp(SETUP)))).toEqual([]);
  });

  /**
   * **And leaves the condition exactly where it was.** The creature is still
   * Invisible — a later reader of the fact still finds it, and the potion that
   * caused it is still what ends it. What the wisp took is the benefit.
   */
  it('leaves the condition itself standing', () => {
    const after = fold('seed', wisp(SETUP));

    expect(after.creatures[SNEAK]?.conditions.conditions).toContain('invisible');
  });

  /**
   * SRD's "until the end of **your** next turn" — the caster's, which is a
   * full round from here: the Bard acts first, so the Bard's turn ends, the
   * target's ends, and the Bard's next one ends.
   *
   * **The host is an Instantaneous cantrip**, so the casting is over the
   * instant it resolves and could never hand the benefit back. The deadline is
   * the rider's own, hung on `EffectTarget.grants`, which is the argument
   * `speed-change` and `action` already make.
   */
  it('hands the benefit back at the end of the caster’s next turn', () => {
    let log = wisp(SETUP);

    log = nextTurn(log);
    expect(invisibility(fold('seed', log)), 'the bard’s own turn ended').toEqual([]);
    log = nextTurn(log);
    expect(invisibility(fold('seed', log)), 'the target’s turn ended').toEqual([]);
    log = nextTurn(log);

    expect(invisibility(fold('seed', log))).toEqual([
      'advantage on Invisible',
      'disadvantage on Invisible',
      'advantage on Invisible',
    ]);
  });
});

describe('what a definition may say', () => {
  const definition = (rider: unknown): unknown => ({
    id: 'homebrew-wisp',
    name: 'Homebrew Wisp',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    duration: { kind: 'instantaneous' },
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [
      {
        kind: 'attack',
        attack: 'ranged',
        damage: { dice: '1d8' },
        damageType: 'radiant',
        modifiers: [rider],
      },
    ],
  });

  const codes = (rider: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(rider)).map((one) => one.code);

  it('accepts the rider with a deadline of its own', () => {
    expect(codes({ kind: 'benefit', denies: 'invisible', lasts: 'end-of-casters-next-turn' })).toEqual([]);
  });

  /**
   * An Instantaneous host that never becomes an ongoing casting has nothing
   * that could ever hand the benefit back — the rule `checkGrantLifetimes`
   * already states over every other rider that hangs a grant.
   */
  it('refuses one with no deadline on a casting that ends the instant it resolves', () => {
    expect(codes({ kind: 'benefit', denies: 'invisible' })).toContain('grant_without_lifetime');
  });

  it('refuses a word that is not a condition', () => {
    expect(
      codes({ kind: 'benefit', denies: 'sneaky', lasts: 'end-of-casters-next-turn' }),
    ).toContain('unknown_condition');
  });
});
