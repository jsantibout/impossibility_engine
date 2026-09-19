import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { spellSlotKey } from './resources.js';
import { damageCreature, eligibleTargets, resolveSpell } from './commands.js';
import { declareSight, sightBetween } from './positioning.js';
import { canSee } from './standing.js';

/**
 * A creature can see itself.
 *
 * It reads like a joke and it was the most serious defect in the engine. Two
 * rules disagreed about one pair: `sightBetween(x, x)` answered **null** —
 * "nobody has said" — so a spell carrying `requiresSight` aimed at its own
 * caster raised a `needs_context` asking the table to establish the fact;
 * and `declareSight` refused to record it, in the engine's own words, "a
 * creature can see itself". The request had no answer, so **Healing Word and
 * Mass Healing Word could not be cast on their own casters at all**, and
 * Boots of Levitation had no way into the catalogue.
 *
 * The refusal was never the wrong half. What was wrong is that the question
 * was asked: where a creature stands relative to itself is not a fact the
 * table establishes, it is one the engine knows, and the sight question is
 * where that knowledge belongs. So `sightBetween` answers `true` for a
 * creature and itself, before the declaration, before cover, before any
 * sense — and neither the request nor the refusal it could not satisfy ever
 * arises.
 *
 * Driven through the public API on all four of the healing spells the SRD
 * writes with `self` in their target line, because a defect nobody casts
 * through is a defect nobody notices was fixed.
 */

const id = (s: string) => asCharacterId(s);
const HEALER = id('brannor');
const ALLY = id('wenna');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, maxHp: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const slot = (level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: HEALER,
  pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max, recovers: 'long-rest' },
});

/** The altar the healer stands on, which is also the point Mass Cure Wounds washes out from. */
const ALTAR = { x: 20, y: 20, z: 0 };

/**
 * Two creatures and a scene, and **not one word declared about sight**.
 *
 * That is the whole setup: every sight answer below is either the engine's
 * own about a creature and itself, or a `needs_context` about the pair.
 */
const SETUP: readonly GameEvent[] = [
  added(HEALER, 60),
  added(ALLY, 20),
  {
    type: 'spellcasting-declared',
    id: HEALER,
    spellcasting: declaredCasting({
      ability: 'wis',
      prepared: ['cure-wounds', 'healing-word', 'mass-cure-wounds', 'mass-healing-word'],
    }),
  },
  slot(1, 4),
  slot(3, 3),
  slot(5, 2),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: ALTAR },
  { type: 'creature-placed', id: HEALER, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: HEALER }, feet: 10, bearing: 0 },
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A wound on the healer, through the command that owns what follows one. */
const wounded = (): { readonly log: readonly GameEvent[]; readonly state: GameState } => {
  const hurt = unwrap(
    damageCreature(fold('seed', SETUP), HEALER, { amount: 30, source: 'an ogre' }),
    'wound',
  );
  const log = [...SETUP, ...hurt];
  return { log, state: fold('seed', log) };
};

// — the four spells, each on its own caster ———————————————————————————————

/**
 * Every SRD healing spell whose target line includes the caster, with the
 * slot it is cast at and the point Mass Cure Wounds needs.
 *
 * Listed rather than looped over the catalogue because the *number* of them
 * is the point: four spells, four unreachable casters, one comparison.
 */
const SELF_HEALING = [
  ['cure-wounds', 1, undefined],
  ['healing-word', 1, undefined],
  ['mass-cure-wounds', 5, ALTAR],
  ['mass-healing-word', 3, undefined],
] as const;

describe('the four healing spells land on their own casters', () => {
  it.each(SELF_HEALING)('%s heals the caster who cast it', (spellId, slotLevel, at) => {
    const { log, state } = wounded();
    expect(state.creatures[HEALER]!.vitals.hp).toBe(30);

    const out = unwrap(
      resolveSpell(
        state,
        HEALER,
        { spellId, targets: [HEALER], slotLevel, ...(at === undefined ? {} : { at }) },
        supply(spellId),
      ),
      `${spellId} on its own caster`,
    );

    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures[HEALER]!.vitals.hp).toBeGreaterThan(30);
    expect(out.outcomes[0]?.target).toBe(HEALER);
    expect(out.outcomes[0]?.healed).toBeGreaterThan(0);
  });

  /**
   * The half of the spell that was never broken, asserted beside it: aimed at
   * somebody else, with nobody having said whether the healer can see them,
   * the sight question is still a question. The fix is about one pair and not
   * about sight in general.
   */
  it('still asks about the ally nobody has declared a sight line to', () => {
    const { state } = wounded();
    const out = resolveSpell(
      state,
      HEALER,
      { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 },
      supply('ally'),
    );
    expect(isErr(out) && out.code).toBe('needs_context');
    expect(isErr(out) && out.reason).toContain('can see');
  });

  /** And the shortlist agrees with the resolver, which is the other door in. */
  it('puts the caster on the shortlist and leaves the undeclared ally off it', () => {
    const { state } = wounded();
    const shortlist = eligibleTargets(state, SRD_CONTENT, HEALER, 'healing-word', 1);
    expect(shortlist.eligible).toEqual([HEALER]);
    expect(shortlist.needsContext.map((n) => n.subject)).toEqual([ALLY]);
  });
});

// — the fact itself ———————————————————————————————————————————————————————

describe('a creature sees itself, and nobody has to say so', () => {
  it('answers yes with nothing declared, at both ends of the seam', () => {
    const state = fold('seed', SETUP);
    expect(sightBetween(state.scene!, HEALER, HEALER)).toBe(true);
    expect(canSee(state, HEALER, HEALER)).toBe(true);
  });

  /**
   * It is a fact about the pair, not about the map: a creature nobody has
   * placed still knows where it is. The declaration lookup and the self rule
   * both precede every measurement, so there is nothing for an unplaced
   * creature to be out of range of.
   */
  it('answers yes for a creature nobody has placed', () => {
    const state = fold('seed', [
      added(HEALER, 60),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    ]);
    expect(sightBetween(state.scene!, HEALER, HEALER)).toBe(true);
    expect(canSee(state, HEALER, HEALER)).toBe(true);
  });

  /**
   * Declared Total Cover silences a *sense*, and it does not silence this:
   * cover is about what stands between two creatures and nothing stands
   * between a creature and itself. `declareCover` refuses the pair anyway,
   * so this is belt and braces on a state only a hand could build.
   */
  it('is not something cover could take away', () => {
    const state = fold('seed', SETUP);
    expect(sightBetween(state.scene!, HEALER, HEALER, [{ sense: 'darkvision', feet: 5 }])).toBe(
      true,
    );
  });
});

describe('the declaration that is refused is now one nobody needed', () => {
  it('refuses a self-declaration, and the answer it would have given is already there', () => {
    const state = fold('seed', SETUP);
    const refused = declareSight(state.scene!, HEALER, HEALER, true);
    expect(isErr(refused) && refused.code).toBe('same_creature');
    expect(isErr(refused) && refused.reason).toContain('can see itself');

    // The refusal used to leave a hole. It no longer can: the fact the
    // declaration would have recorded is the one the question already
    // answers, so refusing it costs nothing.
    expect(sightBetween(state.scene!, HEALER, HEALER)).toBe(true);
  });

  /** And the fold refuses the same event, which is where the hole was visible. */
  it('refuses the event too', () => {
    expect(() =>
      fold('seed', [...SETUP, { type: 'sight-declared', from: HEALER, to: HEALER, seen: false }]),
    ).toThrow(/a creature can see itself/);
  });

  /** A declaration between two creatures is untouched, in both directions. */
  it('still records a declaration between two different creatures', () => {
    const state = fold('seed', SETUP);
    const declared = unwrap(declareSight(state.scene!, HEALER, ALLY, false), 'declare');
    expect(sightBetween(declared, HEALER, ALLY)).toBe(false);
    expect(sightBetween(declared, ALLY, HEALER)).toBeNull();
  });
});
