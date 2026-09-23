/**
 * SRD Undead Fortitude: the floor with a die in front of it.
 *
 * > "If damage reduces the zombie to 0 Hit Points, it makes a Constitution
 * > saving throw (DC 5 plus the damage taken) unless the damage is Radiant or
 * > from a Critical Hit. On a successful save, the zombie drops to 1 Hit Point
 * > instead."
 *
 * The interception itself already existed — `damage-taken.floor`, built for
 * Relentless Endurance — and every part of this that is new is the *save*.
 * `damageCreature` takes no `Supply` and cannot throw one, so the roll is made
 * where the damage arrives with a generator: `resolveDamage`, in the same
 * command, for the reason the Concentration save is settled there and stated in
 * as many words — so the save cannot be forgotten.
 *
 * **It beats the rule a monster dies by.** "A monster dies the instant it drops
 * to 0 Hit Points" is what this sentence is *about*, so a floor that yielded to
 * it would be a zombie that always dies. Relentless Endurance is the other
 * reading — "but not killed outright" — and keeps it, because the command that
 * offers *that* floor asks for it only where the blow did not kill.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap } from '@ie/shared';
import { addCreature } from './commands.js';
import { dealSpellDamage } from './commands/damage.js';
import { createRng, restoreRng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string) => asCharacterId(s);
const ZOMBIE = id('shambler');

const world = (seed: string): readonly GameEvent[] =>
  unwrap(addCreature(fold(seed, []), SRD_CONTENT, ZOMBIE, 'zombie'), 'the zombie').events;

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng(seed) : restoreRng(state.rng),
  content: SRD_CONTENT,
});

/** One typed blow, through the funnel every weapon and spell comes down. */
const hit = (
  log: readonly GameEvent[],
  seed: string,
  type: string,
  amount: number,
  options: { readonly critical?: boolean } = {},
): readonly GameEvent[] => {
  const state = fold(seed, log);
  const dealt = unwrap(
    dealSpellDamage(
      state,
      ZOMBIE,
      [{ type, total: amount, flat: amount, roll: null, source: 'a blade' }],
      'a blade',
      supply(state, seed),
      options,
    ),
    `${amount} ${type}`,
  );
  return dealt.events;
};

const hpAfter = (seed: string, events: readonly GameEvent[]): number =>
  events.reduce(applyEvent, fold(seed, [])).creatures[ZOMBIE]!.vitals.hp;

const at = (seed: string, log: readonly GameEvent[]): GameState => fold(seed, log);

const savesIn = (events: readonly GameEvent[]) =>
  events.filter(
    (event) =>
      event.type === 'roll-recorded' && /Undead Fortitude/.test((event as { label: string }).label),
  );

const damageIn = (events: readonly GameEvent[]) =>
  events.find((event) => event.type === 'damage-taken') as
    | { readonly floor?: { readonly at: number; readonly feature: string } }
    | undefined;

/**
 * A zombie with 15 Hit Points, softened to 5 so that one more blow of 5 takes
 * it to nothing at DC 10 — a save a +3 Constitution makes rather often, which
 * is what lets both faces be found with two seeds rather than twenty.
 */
const softened = (seed: string): readonly GameEvent[] => {
  const log = world(seed);
  return [...log, ...hit(log, seed, 'slashing', 10)];
};

/** The seeds that show each face of the same blow. Found, not chosen. */
const faceSeeds = (): { readonly made: string; readonly failed: string } => {
  let made: string | null = null;
  let failed: string | null = null;
  for (let n = 0; n < 200 && (made === null || failed === null); n += 1) {
    const seed = `fortitude-${n}`;
    const log = softened(seed);
    const events = hit(log, seed, 'slashing', 5);
    const floored = damageIn(events)?.floor !== undefined;
    if (floored && made === null) made = seed;
    if (!floored && failed === null) failed = seed;
  }
  if (made === null || failed === null) throw new Error('no seed showed both faces');
  return { made, failed };
};

describe('the save the sentence raises', () => {
  const { made, failed } = faceSeeds();

  it('is thrown when a blow would take the zombie to 0, at DC 5 plus the damage', () => {
    const log = softened(made);
    const events = hit(log, made, 'slashing', 5);
    const rolls = savesIn(events);
    expect(rolls).toHaveLength(1);
    expect((rolls[0] as { label: string }).label).toContain('DC 10');
  });

  it('leaves the zombie standing on 1 Hit Point where the save is made', () => {
    const log = softened(made);
    const events = hit(log, made, 'slashing', 5);
    expect(damageIn(events)?.floor).toEqual({ at: 1, feature: 'Undead Fortitude' });

    const after = at(made, [...log, ...events]).creatures[ZOMBIE]!;
    expect(after.vitals.hp).toBe(1);
    expect(after.vitals.dead).toBe(false);
  });

  it('lets it die where the save is failed', () => {
    const log = softened(failed);
    const events = hit(log, failed, 'slashing', 5);
    expect(savesIn(events)).toHaveLength(1);
    expect(damageIn(events)?.floor).toBeUndefined();

    const after = at(failed, [...log, ...events]).creatures[ZOMBIE]!;
    expect(after.vitals.hp).toBe(0);
    expect(after.vitals.dead).toBe(true);
  });

  /**
   * **The count the roll cost, recorded exactly once.** A `rolls-issued` that
   * missed the save would leave the generator ahead of the log, and every
   * number after it would differ on replay.
   */
  it('records what the die cost, once', () => {
    const log = softened(made);
    const events = hit(log, made, 'slashing', 5);
    const issued = events.filter((event) => event.type === 'rolls-issued');
    expect(issued).toHaveLength(1);
    expect((issued[0] as { count: number }).count).toBe(1);
  });

  it('folds the same log to the same state twice', () => {
    const log = [...softened(made), ...hit(softened(made), made, 'slashing', 5)];
    expect(JSON.stringify(at(made, log))).toBe(JSON.stringify(at(made, log)));
  });
});

describe('the two clauses that stop the save being thrown', () => {
  const seed = 'no-save';

  it('throws none for Radiant damage, and the zombie dies', () => {
    const log = softened(seed);
    const events = hit(log, seed, 'radiant', 5);
    expect(savesIn(events)).toEqual([]);
    expect(hpAfter(seed, [...log, ...events])).toBe(0);
    expect(at(seed, [...log, ...events]).creatures[ZOMBIE]!.vitals.dead).toBe(true);
  });

  it('throws none for a Critical Hit, and the zombie dies', () => {
    const log = softened(seed);
    const events = hit(log, seed, 'slashing', 5, { critical: true });
    expect(savesIn(events)).toEqual([]);
    expect(at(seed, [...log, ...events]).creatures[ZOMBIE]!.vitals.dead).toBe(true);
  });

  /**
   * And the clause that gates the whole sentence: a blow that leaves the
   * zombie standing raises nothing at all.
   */
  it('throws none for a blow that does not reach 0', () => {
    const log = world(seed);
    const events = hit(log, seed, 'slashing', 5);
    expect(savesIn(events)).toEqual([]);
    expect(hpAfter(seed, [...log, ...events])).toBe(10);
  });

  /** And a creature whose block prints no such sentence gets no save. */
  it('throws none for a creature that does not print it', () => {
    const goblin = id('grish');
    const log = unwrap(
      addCreature(fold(seed, []), SRD_CONTENT, goblin, 'goblin-warrior'),
      'the goblin',
    ).events;
    const state = fold(seed, log);
    const dealt = unwrap(
      dealSpellDamage(
        state,
        goblin,
        [{ type: 'slashing', total: 40, flat: 40, roll: null, source: 'a blade' }],
        'a blade',
        supply(state, seed),
        {},
      ),
      'the blow',
    );
    expect(savesIn(dealt.events)).toEqual([]);
    expect(
      dealt.events.reduce(applyEvent, state).creatures[goblin as CharacterId]!.vitals.dead,
    ).toBe(true);
  });
});
