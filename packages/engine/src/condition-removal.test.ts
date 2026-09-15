import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A spell that takes a condition away.
 *
 * SRD Lesser Restoration, whole: "You touch a creature and end one condition
 * on it: Blinded, Deafened, Paralyzed, or Poisoned." SRD Protection from
 * Poison's first sentence: "You touch a creature and end the Poisoned
 * condition on it."
 *
 * The arithmetic existed and was reachable from no spell: `useHealingTouch`
 * has removed a named condition wholesale for Lay On Hands since pools learned
 * to buy things, and `removeConditionInstance` is the operation beneath it.
 * This is the effect kind that reaches the same removal — the *same* one, not
 * a second implementation, which is what `healing-touch.test.ts` is the guard
 * for.
 *
 * **The SRD removes the condition, not a cause of it.** "You touch a creature
 * and end the Poisoned condition on it" names the condition and says nothing
 * about what caused it, so an ally poisoned by a serpent *and* by a bad oyster
 * is not half-cured. That reading was already implemented for Lay On Hands and
 * is preserved here by sharing the implementation rather than by remembering
 * it twice.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(ALLY),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: ['sacred-flame'],
      prepared: ['lesser-restoration', 'protection-from-poison'],
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const applied = (condition: string, source: string): GameEvent =>
  ({ type: 'condition-applied', id: ALLY, condition, source }) as GameEvent;

const cast = (state: GameState, spellId: string) =>
  resolveSpell(state, CLERIC, { spellId, targets: [ALLY], slotLevel: 2 }, supply());

describe('Lesser Restoration ends a condition', () => {
  /**
   * SRD Lesser Restoration: "You touch a creature and end one condition on it:
   * Blinded, Deafened, Paralyzed, or Poisoned."
   *
   * And the neighbouring condition is the half that says the removal is exact
   * rather than a wash: a Charmed ally stays Charmed.
   */
  it('ends the Poisoned condition and leaves an unrelated one standing', () => {
    const state = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a serpent'),
      applied('charmed', 'a dryad'),
    ]);

    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');
    const next = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a serpent'),
      applied('charmed', 'a dryad'),
      ...out.events,
    ]);

    expect(next.creatures[ALLY]?.conditions.conditions).not.toContain('poisoned');
    expect(next.creatures[ALLY]?.conditions.conditions).toContain('charmed');
    expect(out.outcomes[0]?.ended).toEqual(['poisoned']);
    expect(out.outcomes[0]?.affected).toBe(true);
  });

  /**
   * SRD: "end **the** Poisoned condition on it" — the condition, not a cause
   * of it. A creature poisoned twice over is not half-cured, which is the
   * reading `useHealingTouch` already implements and this shares.
   */
  it('ends every cause of the condition', () => {
    const state = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a serpent'),
      applied('poisoned', 'a bad oyster'),
    ]);

    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');
    const next = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a serpent'),
      applied('poisoned', 'a bad oyster'),
      ...out.events,
    ]);

    expect(next.creatures[ALLY]?.conditions.instances).toEqual([]);
    expect(next.creatures[ALLY]?.conditions.conditions).toEqual([]);
  });

  /**
   * Requirement five: a spell that finds nothing to cure is not an error. The
   * slot goes — the casting happened — and the log records no removal, because
   * nothing was removed.
   */
  it('is not an error when the creature has none of them', () => {
    const state = base();
    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');

    expect(out.outcomes[0]?.affected).toBe(false);
    expect(out.outcomes[0]?.ended).toBeUndefined();
    expect(out.events.filter((e) => e.type === 'condition-removed')).toEqual([]);
  });

  /**
   * **Every one it names that the target has, which is where the SRD and the
   * engine part company.** The book ends "one condition"; a choice made at the
   * casting has nowhere to be recorded, so the engine ends all of them it
   * finds, and `spell-honesty.test.ts` adjudicates that clause to
   * `a-choice-made-at-the-casting` rather than letting it pass as narration.
   *
   * This is also the only fixture that can tell "every condition" from "the
   * first one": with one condition in play the two are the same events, which
   * is how a mutation ending only the first survived a whole file.
   */
  it('ends every named condition the creature has, not the first', () => {
    const state = fold('seed', [
      ...SETUP,
      applied('blinded', 'a flash'),
      applied('poisoned', 'a serpent'),
      applied('charmed', 'a dryad'),
    ]);

    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');
    const next = fold('seed', [
      ...SETUP,
      applied('blinded', 'a flash'),
      applied('poisoned', 'a serpent'),
      applied('charmed', 'a dryad'),
      ...out.events,
    ]);

    expect(next.creatures[ALLY]?.conditions.conditions).toEqual(['charmed']);
    // In the SRD's own printed order, because that is the order the definition
    // lists them in and the log records which were ended.
    expect(out.outcomes[0]?.ended).toEqual(['blinded', 'poisoned']);
  });

  /**
   * **It throws nothing.** The spell asks for no roll, so no die is recorded
   * and none is issued — which is what lets a replay of this log restore the
   * same generator state. The same assertion Greater Invisibility carries for
   * the same reason, on the kind that imposes a condition rather than ending
   * one.
   */
  it('rolls nothing and does not move the generator', () => {
    const state = fold('seed', [...SETUP, applied('poisoned', 'a serpent')]);
    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');

    expect(out.events.some((e) => e.type === 'roll-recorded')).toBe(false);
    expect(out.events.some((e) => e.type === 'rolls-issued')).toBe(false);
  });

  /** Every condition the spell names, and no others: Paralyzed goes too. */
  it('reaches every condition the spell names', () => {
    const state = fold('seed', [...SETUP, applied('paralyzed', 'a ghoul')]);
    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');
    const next = fold('seed', [...SETUP, applied('paralyzed', 'a ghoul'), ...out.events]);

    expect(next.creatures[ALLY]?.conditions.conditions).toEqual([]);
    expect(out.outcomes[0]?.ended).toEqual(['paralyzed']);
  });

  /** The definition names exactly the four the SRD prints, in the SRD's order. */
  it('names the four conditions the SRD prints', () => {
    const definition = SRD_CONTENT.spell('lesser-restoration');
    const effect = definition?.effects[0];
    expect(effect?.kind).toBe('end-condition');
    expect(effect && 'conditions' in effect ? effect.conditions : null).toEqual([
      'blinded',
      'deafened',
      'paralyzed',
      'poisoned',
    ]);
  });
});

describe('Protection from Poison ends the Poisoned condition', () => {
  /** SRD: "You touch a creature and end the Poisoned condition on it." */
  it('ends Poisoned and nothing else', () => {
    const state = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a wyvern'),
      applied('blinded', 'a flash'),
    ]);

    const out = unwrap(cast(state, 'protection-from-poison'), 'protection from poison');
    const next = fold('seed', [
      ...SETUP,
      applied('poisoned', 'a wyvern'),
      applied('blinded', 'a flash'),
      ...out.events,
    ]);

    expect(next.creatures[ALLY]?.conditions.conditions).toEqual(['blinded']);
    expect(out.outcomes[0]?.ended).toEqual(['poisoned']);
  });

  /**
   * The removal names one condition; the Resistance beside it is the spell's
   * third sentence, and one clause is still declared rather than executed.
   */
  it('names one condition, grants one Resistance, and leaves its last clause unmodelled', () => {
    const definition = SRD_CONTENT.spell('protection-from-poison');
    const effect = definition?.effects[0];
    expect(effect && 'conditions' in effect ? effect.conditions : null).toEqual(['poisoned']);
    const granted = definition?.effects[1];
    expect(granted && 'damageTypes' in granted ? granted.damageTypes : null).toEqual(['poison']);
    expect(definition?.unmodelled?.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * It runs its hour, so there is an ongoing record where an Instantaneous
   * removal leaves none — **and that record is now on its target.**
   *
   * A casting is on a creature while it has a live effect there that the
   * casting owns. A removal owns nothing: it takes something away and keeps
   * nothing, so while the removal was the whole of what this spell executed
   * the record was on nobody and a Dispel Magic aimed at the target found no
   * Protection from Poison to end. The Resistance *is* something the casting
   * owns and keeps, so `on` says so — which is exactly what the earlier
   * version of this test predicted would happen when either unmodelled clause
   * was built, with nothing about `on` changing.
   */
  it('leaves an ongoing casting behind, and the Resistance puts it on its target', () => {
    const state = fold('seed', [...SETUP, applied('poisoned', 'a wyvern')]);
    const out = unwrap(cast(state, 'protection-from-poison'), 'protection from poison');
    const next = fold('seed', [...SETUP, applied('poisoned', 'a wyvern'), ...out.events]);

    expect(Object.keys(next.ongoing)).toContain(out.castingId);
    expect(spellOn(next, next.ongoing[out.castingId]!)).toEqual([ALLY]);
  });

  /** Lesser Restoration is Instantaneous, so it leaves no record at all. */
  it('is the only one of the two that leaves a record', () => {
    const state = fold('seed', [...SETUP, applied('poisoned', 'a wyvern')]);
    const out = unwrap(cast(state, 'lesser-restoration'), 'lesser restoration');
    const next = fold('seed', [...SETUP, applied('poisoned', 'a wyvern'), ...out.events]);

    expect(next.ongoing).toEqual({});
  });
});

/**
 * The extraction's own guard, from this side.
 *
 * `healing-touch.test.ts` holds the Lay On Hands side and none of it may be
 * edited; this asserts that the two really do produce the same removal, so a
 * second implementation written here would have to diverge from it visibly.
 */
describe('one removal, two callers', () => {
  it('writes the same sourceless removal a healing touch writes', () => {
    const state = fold('seed', [...SETUP, applied('poisoned', 'a serpent')]);
    const out = unwrap(cast(state, 'protection-from-poison'), 'protection from poison');
    const removals = out.events.filter((e) => e.type === 'condition-removed');

    expect(removals).toEqual([{ type: 'condition-removed', id: ALLY, condition: 'poisoned' }]);
  });
});
