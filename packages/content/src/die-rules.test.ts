import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { declaredCasting } from '@ie/engine';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import type { Rng, RngState } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { fold, type GameEvent } from '@ie/engine';
import { resolveSpell } from '@ie/engine';
import { FIGHTING_STYLE_FEATS } from './origins.js';
import { CHROMATIC_ORB, SORCEROUS_BURST } from './spells.js';
import { ADJUDICATED } from '../scripts/missing-shapes.js';

/**
 * **The three sentences the owner named, and which of them the engine can now
 * keep.**
 *
 * `dice.ts` has addressed dice one at a time since it was written, and until
 * `SpellDefinition.dieRule` no catalogue entry could ask it to. This file
 * drives the one SRD sentence that fits — Sorcerous Burst's exploding d8 — and
 * pins, with its reason, each of the two that do not.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const KEEN = id('keen');
const DULL = id('dull');
const TARGET = id('target');

/** A generator scripted by die size — see `die-rules.test.ts` in the engine. */
const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const sheet = (cha: number): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const added = (who: CharacterId, cha: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(cha),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** A Sorcerer with a Charisma of 20, one with a Charisma of 12, and a dummy. */
const SETUP: readonly GameEvent[] = [
  added(KEEN, 20),
  added(DULL, 12),
  added(TARGET, 10),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: KEEN, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: DULL, placement: { from: { landmark: 'here' }, feet: 5, bearing: 180 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: KEEN }, feet: 60, bearing: 0 },
  },
  { type: 'sight-declared', from: KEEN, to: TARGET, seen: true },
  { type: 'sight-declared', from: DULL, to: TARGET, seen: true },
  ...[KEEN, DULL].map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'cha',
        cantrips: ['sorcerous-burst'],
        prepared: [],
      }),
    }),
  ),
];

/** Cast Sorcerous Burst on a scripted generator and report what it dealt. */
const burst = (who: CharacterId, faces: Readonly<Record<number, readonly number[]>>): number => {
  const state = fold('seed', SETUP);
  const result = unwrap(
    resolveSpell(
      state,
      who,
      { spellId: 'sorcerous-burst', targets: [TARGET], damageType: 'fire' },
      { issuer: createRollIssuer('r'), rng: scripted(faces), content: SRD_CONTENT },
    ),
    'sorcerous-burst',
  );
  return result.outcomes.find((one) => one.target === TARGET)?.damage ?? -1;
};

describe('SRD Sorcerous Burst rolls the die its own sentence asks for', () => {
  /**
   * SRD: "If you roll an 8 on a d8 for this spell, you can roll another d8, and
   * add it to the damage. When you cast this spell, the maximum number of these
   * d8s you can add to the spell's damage equals your spellcasting ability
   * modifier."
   */
  it('declares the rule in data rather than leaving it to a note', () => {
    expect(SORCEROUS_BURST.dieRule).toEqual({
      kind: 'bonus-die-on-max',
      cap: 'spellcasting-modifier',
    });
    // And the debt it was filed under is discharged rather than reworded: the
    // spell now says everything the book prints.
    expect(SORCEROUS_BURST.unmodelled).toBeUndefined();
    expect(ADJUDICATED['sorcerous-burst']).toBeUndefined();
  });

  /** A level 1 caster throws one d8, and an 8 on it buys another. */
  it('adds a d8 for an 8, and the added d8 can do it again', () => {
    // Charisma 20 is +5, so five bonus dice and no more: the seventh 8 in the
    // script is thrown by nothing.
    expect(burst(KEEN, { 20: [15, 15], 8: [8, 8, 8, 8, 8, 8, 8] })).toBe(6 * 8);
  });

  it('adds nothing when no d8 shows an 8', () => {
    expect(burst(KEEN, { 20: [15, 15], 8: [7] })).toBe(7);
  });

  /**
   * **The cap is the caster's spellcasting ability modifier**, which is a
   * number the engine derives from the sheet and not one the catalogue states.
   * Two Sorcerers, one spell, one script, two answers.
   */
  it('caps the extra dice at the caster’s own modifier', () => {
    const script = { 20: [15, 15], 8: [8, 8, 8, 8, 8, 8, 8] } as const;
    // +5: the printed die and five more.
    expect(burst(KEEN, script)).toBe(6 * 8);
    // +1: the printed die and one more, off the same script.
    expect(burst(DULL, script)).toBe(2 * 8);
  });
});

/**
 * **SRD Chromatic Orb is refused, and the reason is not the die.**
 *
 * The owner named it beside Sorcerous Burst because both react to the faces of
 * their damage dice, and reading the faces is exactly what this batch built. It
 * is still not writable, and the half that blocks it is the *consequence*:
 *
 * > "If you roll the same number on two or more of the d8s, the orb leaps to a
 * > different target of your choice within 30 feet of the target. **Make an
 * > attack roll against the new target, and make a new damage roll.**"
 *
 * That is a second attack roll and a second damage roll, at a creature the
 * casting never named, out of one casting — `several-attack-rolls-from-one-
 * casting`, the shape Scorching Ray and Eldritch Blast are both blocked on, and
 * `spell-definitions.ts` names this spell in the field that refuses it: "a
 * chained attack on a dice-face trigger ... A child that rolls is a parent."
 *
 * The trigger half would also need a fourth kind of `DieEffect` and a different
 * one from the three that exist: `DieEffect` judges **one die at a time** —
 * `substitute` and `bonusOn` are both `(rolled, sides)` — and "the same number
 * on two or more of the d8s" is a predicate over the whole roll. That is a real
 * shape and it is not built here, because a leap is not a die behaviour: the
 * effect would fire and have nowhere to send the orb.
 */
describe('SRD Chromatic Orb is not this shape, and says so', () => {
  it('declares no die rule, and keeps the two blockers that are really its own', () => {
    expect(CHROMATIC_ORB.dieRule).toBeUndefined();

    const blockers = (ADJUDICATED['chromatic-orb'] ?? []).map((entry) => entry.why);
    // The leap is the blocker, and it is the one the catalogue already ranks.
    expect(blockers).toContain('several-attack-rolls-from-one-casting');
    // And the trigger is still filed under the die shape, because the reading
    // it wants — a predicate over a whole roll — is not one of the three.
    expect(blockers).toContain('a-die-behaviour-a-spell-asks-for');
    expect(CHROMATIC_ORB.unmodelled?.length).toBe(3);
  });

  /**
   * **And the written reason says the true one.**
   *
   * The note this entry carried said "a damage roll comes back as a total, and
   * no effect kind asks the generator about the dice inside one" — which is the
   * sentence Sorcerous Burst's own debt was deleted for being. A map that
   * states and denies the same fact is worse than one that is merely behind,
   * because the coverage report publishes the note and nothing read it. So the
   * note is asserted rather than the id alone: the trigger's blocker is that a
   * rule is handed one die at a time, not that faces are unreadable.
   */
  it('says why the trigger cannot be written, in the map the report prints', () => {
    const note = (ADJUDICATED['chromatic-orb'] ?? []).find(
      (entry) => entry.why === 'a-die-behaviour-a-spell-asks-for',
    )?.note;
    expect(note).toBeDefined();
    expect(note).toContain('one die at a time');
    expect(note).not.toContain('comes back as a total');
  });

  /** The engine's own vocabulary is what says the trigger cannot be written. */
  it('has no way to ask a question about two dice at once', () => {
    const dice = readFileSync(
      fileURLToPath(new URL('../../engine/src/dice.ts', import.meta.url)),
      'utf8',
    );
    // Both predicates a `DieEffect` carries take one die's face and its size,
    // and neither is handed the roll it is part of.
    expect(dice).toContain('substitute?: (rolled: number, sides: number) => number');
    expect(dice).toContain('bonusOn?: (rolled: number, sides: number) => boolean');
  });
});

/**
 * **SRD Great Weapon Fighting is the attack's scope, and it is wired now.**
 *
 * `treatLowRollsAs(2, 3, …)` was built, tested and driven in `attack.test.ts`
 * long before anything asked for it — a Greatsword's 1 and 2 both count as 3,
 * and the substitution is visible on the dice rather than folded into a total.
 * What the feat could not do was switch it on, and the three things that stood
 * between them are each gone:
 *
 * 1. **The narrowing.** "a Melee weapon that you are holding with two hands …
 *    The weapon must have the Two-Handed or Versatile property" is a clause
 *    about a kind of weapon, which `WeaponNarrowing` now writes — and which
 *    Archery's "with Ranged weapons" writes too. Defense was filed here and
 *    never belonged: its clause is about **armour**, and it is still a note.
 * 2. **The reader.** `FEAT_GRANT_KINDS` admits a grant only once creation reads
 *    it off a feat, and `standing` joined that list with `standingFromFeats`.
 * 3. **The supply.** `AttackOptions.damageEffects` is the attack-wide scope a
 *    fighting style wants, and `standingDamageEffects` is what fills it.
 *
 * What is left under `a-die-behaviour-a-spell-asks-for` is therefore two
 * things rather than three: a predicate over a whole roll, and a reroll the
 * roller chooses. The attack's scope has a writer.
 *
 * The end-to-end behaviour is `fighting-styles.test.ts`'s; what this asserts
 * is that the catalogue declares it rather than describing it.
 */
describe('SRD Great Weapon Fighting is the attack’s scope, and is wired', () => {
  const gwf = FIGHTING_STYLE_FEATS.find((feat) => feat.id === 'great-weapon-fighting');

  it('declares the rule and the weapons it is narrowed to', () => {
    expect(gwf).toBeDefined();
    const grant = gwf?.grants;
    expect(grant?.kind).toBe('standing');
    if (grant?.kind !== 'standing') throw new Error('unreachable');
    expect(grant.effects?.[0]).toMatchObject({
      kind: 'attack-die-rule',
      rule: { kind: 'treat-low-rolls-as', atMost: 2, as: 3 },
      onlyWithWeapon: { heldInTwoHands: true },
    });
    // And the note says what happens rather than what is missing.
    expect(gwf?.note).toContain('Applied');
  });

  /** And the substitution itself is real, which is why the note is about wiring. */
  it('has its behaviour built in the dice layer', () => {
    const dice = readFileSync(
      fileURLToPath(new URL('../../engine/src/dice.ts', import.meta.url)),
      'utf8',
    );
    expect(dice).toContain('export function treatLowRollsAs');
  });
});

/**
 * Inviolable rule 4, on this batch's three names.
 *
 * The two sweeps hold the general case — `spell-schema.test.ts` for spell and
 * class ids, `origin-and-feature-sweep.test.ts` for feats — and this is the
 * same claim made where a reader of this file will look for it: the mechanism
 * is a vocabulary, so no engine source needs to know what any of the three is
 * called.
 */
describe('no engine file names any of the three', () => {
  const ENGINE = fileURLToPath(new URL('../../engine/src/', import.meta.url));

  const sources = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(`${dir}${entry.name}/`)
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          ? [`${dir}${entry.name}`]
          : [],
    );

  it.each(['sorcerous-burst', 'chromatic-orb', 'great-weapon-fighting'])(
    'never writes the id %s',
    (spellId) => {
      const guilty = sources(ENGINE).filter((file) => readFileSync(file, 'utf8').includes(spellId));
      expect(guilty).toEqual([]);
    },
  );

  /**
   * And the *names* only where a docstring quotes the sentence a mechanism
   * serves, which `dice.ts` and `spell-definitions.ts` both do. A name in code
   * rather than in prose is what the sweeps refuse; this pins that the three
   * appear nowhere else at all.
   */
  it.each(['Sorcerous Burst', 'Chromatic Orb', 'Great Weapon Fighting'])(
    'writes the name %s only in a comment',
    (name) => {
      for (const file of sources(ENGINE)) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!line.includes(name)) continue;
          const start = line.trimStart();
          expect(
            start.startsWith('*') || start.startsWith('//') || start.startsWith('/*'),
            `${file}: ${line}`,
          ).toBe(true);
        }
      }
    },
  );
});
