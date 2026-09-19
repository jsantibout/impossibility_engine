import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell, resolveTurn } from './commands.js';

/**
 * Riders that end at a moment in the turn order rather than on the clock.
 *
 * Most of what a spell does ends when the *casting* does — the Concentration
 * drops, the minute runs out, and everything the casting created goes with it.
 * A whole family of SRD riders does not:
 *
 * > Color Spray: "...or have the Blinded condition **until the end of your
 * > next turn**." **Duration:** Instantaneous.
 *
 * > Sunbeam: "...takes 6d8 Radiant damage and has the Blinded condition
 * > **until the start of your next turn**." **Duration:** Concentration, up
 * > to 1 minute.
 *
 * Those two are opposite proofs of the same gap. Color Spray's casting is over
 * the instant it happens, so there is no casting deadline for the Blinded to
 * hang on and the spell could not be written at all. Sunbeam's casting runs a
 * full minute, so hanging the Blinded on it would blind the target sixty
 * seconds too long. A rider needs a deadline of its own, and that deadline is
 * a moment in the Initiative order rather than a number of seconds.
 *
 * `time.ts` has had `startOfNextTurn`/`endOfNextTurn` since durations
 * landed, and `applyConditionTo` has taken a per-condition `Duration` for just
 * as long. What was missing was any way for a *definition* to ask for one.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slots: readonly GameEvent[] = [1, 6].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

/** The caster acts first, so "your next turn" and "its next turn" differ. */
const PLACED: readonly GameEvent[] = [
  added(CASTER),
  // A Constitution of 1 against a DC of 17: this target fails every save these
  // spells ask for, so the tests are about when the rider *ends* rather than
  // about which way a die fell.
  added(TARGET, { abilities: { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 } }),
  ...slots,
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['color-spray', 'sunbeam', 'ray-of-sickness'] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { creature: CASTER }, feet: 10, bearing: 0 } },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
];

const SETUP: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed: string, saveBonus?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(saveBonus === undefined ? {} : { bonuses: [{ source: 'forced', flat: saveBonus }] }),
  content: SRD_CONTENT,
});

/** Advance to whoever is next, settling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveTurn(fold('seed', log), supply('turn')), 'turn').events,
];

const blinded = (state: GameState, who: CharacterId) =>
  state.creatures[who]!.conditions.conditions.includes('blinded');

const whoseTurn = (state: GameState) => state.combat?.order[state.combat.turnIndex]?.id;

describe('Color Spray: a rider that outlives an instantaneous casting', () => {
  /**
   * SRD Color Spray: **Duration: Instantaneous**, and "Each creature in a
   * 15-foot Cone originating from you must succeed on a Constitution saving
   * throw or have the Blinded condition until the end of your next turn."
   *
   * There is no casting to hang the Blinded on — the spell is over the moment
   * it is cast — so before a rider could carry its own deadline, this spell
   * could not be written down at all.
   */
  const spray = (log: readonly GameEvent[] = SETUP, seed = 'spray') =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'color-spray', targets: [], towards: { x: 100, y: 200, z: 0 }, slotLevel: 1 },
        supply(seed),
      ),
      'color spray',
    );

  const sprayed = (log: readonly GameEvent[] = SETUP) => [...log, ...spray(log).events];

  it('blinds a creature that fails the save', () => {
    const out = spray();
    expect(out.outcomes.find((o) => o.target === TARGET)?.affected).toBe(true);
    expect(blinded(fold('seed', sprayed()), TARGET)).toBe(true);
  });

  /** Nobody is concentrating on Color Spray, and nothing is waiting to end it. */
  it('leaves no casting running behind it', () => {
    const state = fold('seed', sprayed());
    expect(state.creatures.caster!.concentration).toBeNull();
    expect(Object.values(state.timers).some((t) => t.target.kind === 'casting')).toBe(false);
  });

  /**
   * "The end of **your** next turn", said on the caster's own turn, is two
   * turn-endings away: the turn in progress has not ended yet. So the target
   * gets a whole turn, and then the caster gets one, before it lifts.
   */
  it('holds through the target’s turn and the caster’s next', () => {
    const cast = sprayed();
    expect(blinded(fold('seed', cast), TARGET)).toBe(true);

    // The target's turn.
    const theirs = nextTurn(cast);
    expect(whoseTurn(fold('seed', theirs))).toBe(TARGET);
    expect(blinded(fold('seed', theirs), TARGET)).toBe(true);

    // The caster's next turn — still running, because it has not *ended*.
    const casters = nextTurn(theirs);
    expect(whoseTurn(fold('seed', casters))).toBe(CASTER);
    expect(blinded(fold('seed', casters), TARGET)).toBe(true);

    // And now that turn has ended.
    expect(blinded(fold('seed', nextTurn(casters)), TARGET)).toBe(false);
  });

  /**
   * The discriminating case, and the reason the anchor is spelled out in the
   * value rather than left to be assumed. At the moment the rider lifts, the
   * caster has ended two turns and the *target* has ended one — so nothing
   * about the target's turns could have ended it, and a rider anchored to the
   * wrong creature would still be running.
   */
  it('is anchored to the caster’s turns, not the target’s', () => {
    const lifted = nextTurn(nextTurn(nextTurn(sprayed())));
    const state = fold('seed', lifted);

    expect(blinded(state, TARGET)).toBe(false);
    expect(state.combat!.turnCounts.caster!.ended).toBe(2);
    expect(state.combat!.turnCounts.target!.ended).toBe(1);
  });

  /**
   * SRD gives "the end of your next turn" no meaning outside combat, and
   * `resolveDuration` goes on refusing rather than inventing six seconds. What
   * the *command* does with that refusal is ask: a turn timeline is a thin
   * record, so IE-046 makes this a `needs-context` naming `beginCombat` and
   * the caller sends the same casting again once the fight has begun.
   *
   * It has to cost nothing either way — the slot is expended half way through
   * a cast, so an answer that arrived after it would leave a caster paying for
   * a spell that never happened.
   */
  it('asks for a turn order outside combat, and costs nothing', () => {
    const dice = supply('spray');
    const before = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    const out = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'color-spray', targets: [], towards: { x: 100, y: 200, z: 0 }, slotLevel: 1 },
      dice,
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_turns');
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['turn-order']);
    expect(contextRequestsOf(out)[0]?.satisfyWith).toContain('beginCombat');

    expect(remaining(fold('seed', PLACED).creatures.caster!.resources, spellSlotKey(1))).toBe(4);
    // And the generator has not moved. The rider is checked before the save is
    // rolled, or a refused cast would leave the caller's dice somewhere else
    // than it found them — the same reason every other refusal is free.
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
  });
});

describe('Sunbeam: a rider shorter than the casting that made it', () => {
  /**
   * SRD Sunbeam: **Duration: Concentration, up to 1 minute**, and "On a failed
   * save, a creature takes 6d8 Radiant damage and has the Blinded condition
   * **until the start of your next turn**."
   *
   * The opposite proof to Color Spray. Here there *is* a casting deadline and
   * it is the wrong one: hanging the Blinded on the spell would blind the
   * target for the whole minute rather than for the fraction of a round the
   * text gives.
   */
  const beam = (log: readonly GameEvent[] = SETUP, seed = 'beam') =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'sunbeam', targets: [], towards: { x: 100, y: 200, z: 0 }, slotLevel: 6 },
        supply(seed),
      ),
      'sunbeam',
    );

  const burned = (log: readonly GameEvent[] = SETUP) => [...log, ...beam(log).events];

  it('deals its damage and blinds on the same failed save', () => {
    const out = beam();
    const hit = out.outcomes.find((o) => o.target === TARGET);
    expect(hit?.affected).toBe(true);
    expect(hit?.damage).toBeGreaterThan(0);
    expect(blinded(fold('seed', burned()), TARGET)).toBe(true);
  });

  /**
   * One save, not two. Writing the damage and the condition as two effects
   * would roll two — and a target could then fail one and make the other,
   * which is not the spell.
   */
  it('rolls exactly one saving throw per target', () => {
    const saves = beam().events.filter(
      (e) => e.type === 'roll-recorded' && /save vs Sunbeam/.test(e.label),
    );
    expect(saves.length).toBe(1);
  });

  /**
   * SRD: "On a successful save, it takes half as much damage **only**." Only —
   * so the Blinded is on the failure branch alone. Folding the condition into
   * the damage would blind a creature the spell says it did not.
   */
  it('blinds nobody who makes the save, though the damage still lands', () => {
    const out = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CASTER,
        { spellId: 'sunbeam', targets: [], towards: { x: 100, y: 200, z: 0 }, slotLevel: 6 },
        supply('beam', 40),
      ),
      'sunbeam',
    );
    const made = out.outcomes.find((o) => o.target === TARGET);
    expect(made?.save?.success).toBe(true);
    expect(made?.affected).toBe(false);
    expect(made?.damage).toBeGreaterThan(0);
    expect(made?.conditions).toBeUndefined();

    expect(blinded(fold('seed', [...SETUP, ...out.events]), TARGET)).toBe(false);
  });

  /**
   * "Until the **start** of your next turn" — one turn-beginning away, because
   * the turn in progress has already begun. So it lifts a full round before
   * Color Spray's rider would have.
   */
  it('lifts at the start of the caster’s next turn', () => {
    const cast = burned();
    expect(blinded(fold('seed', cast), TARGET)).toBe(true);

    const theirs = nextTurn(cast);
    expect(blinded(fold('seed', theirs), TARGET)).toBe(true);

    const casters = nextTurn(theirs);
    expect(whoseTurn(fold('seed', casters))).toBe(CASTER);
    expect(blinded(fold('seed', casters), TARGET)).toBe(false);
  });

  /** And the spell itself is untouched: the caster is still concentrating. */
  it('leaves the casting running after the rider has lapsed', () => {
    const later = nextTurn(nextTurn(burned()));
    const state = fold('seed', later);
    expect(blinded(state, TARGET)).toBe(false);
    expect(state.creatures.caster!.concentration?.spell).toBe('Sunbeam');
  });

  /**
   * The other direction: Concentration breaking ends the casting, and the
   * rider goes with it even though its own moment has not arrived. The link is
   * the casting id in the condition's source, exactly as for a rider that
   * lasts the whole spell.
   */
  it('takes the rider with it when Concentration breaks', () => {
    const broken: readonly GameEvent[] = [
      ...burned(),
      { type: 'condition-applied', id: CASTER, condition: 'stunned', source: 'something else' },
    ];
    const state = fold('seed', broken);
    expect(state.creatures.caster!.concentration).toBeNull();
    expect(blinded(state, TARGET)).toBe(false);
  });
});

describe('Ray of Sickness: a rider on a hit rather than on a failed save', () => {
  /**
   * SRD Ray of Sickness: **Duration: Instantaneous**, and "Make a ranged spell
   * attack against the target. On a hit, the target takes 2d8 Poison damage
   * **and** has the Poisoned condition until the end of your next turn."
   *
   * The third place a rider can hang, after a save that only conditions and a
   * save that also damages. What decides it here is the attack roll, so a miss
   * leaves the target untouched — there is no half-measure branch to fall
   * through to, which is the difference between this and Sunbeam.
   */
  const ray = (seed: string) =>
    unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CASTER,
        { spellId: 'ray-of-sickness', targets: [TARGET], slotLevel: 1 },
        supply(seed),
      ),
      'ray of sickness',
    );

  const poisoned = (log: readonly GameEvent[]) =>
    fold('seed', log).creatures.target!.conditions.conditions.includes('poisoned');

  it('poisons on a hit', () => {
    const out = ray('hit');
    expect(out.outcomes[0]?.attack?.hit).toBe(true);
    expect(poisoned([...SETUP, ...out.events])).toBe(true);
  });

  it('leaves a target it missed alone', () => {
    // A wall of Armour Class rather than a hunt for an unlucky seed: the
    // attack cannot land, so nothing rides on it.
    const armoured: readonly GameEvent[] = [
      ...PLACED.filter((e) => !(e.type === 'creature-added' && e.id === TARGET)),
      {
        type: 'creature-added',
        id: TARGET,
        name: TARGET,
        sheet: { ...sheet(), stated: { armorClass: 40 } },
        maxHp: 300,
        diesAtZero: false,
        creatureType: 'Humanoid',
      },
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: TARGET, initiative: 10, speed: 30 },
        ],
      },
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', armoured),
        CASTER,
        { spellId: 'ray-of-sickness', targets: [TARGET], slotLevel: 1 },
        supply('miss'),
      ),
      'ray of sickness',
    );
    expect(out.outcomes[0]?.attack?.hit).toBe(false);
    expect(poisoned([...armoured, ...out.events])).toBe(false);
  });

  /** Instantaneous, so the Poisoned is the only thing with a deadline. */
  it('lifts at the end of the caster’s next turn, with no casting behind it', () => {
    const cast = [...SETUP, ...ray('hit').events];
    expect(fold('seed', cast).creatures.caster!.concentration).toBeNull();

    expect(poisoned(nextTurn(cast))).toBe(true);
    expect(poisoned(nextTurn(nextTurn(cast)))).toBe(true);
    expect(poisoned(nextTurn(nextTurn(nextTurn(cast))))).toBe(false);
  });

  /**
   * The up-front check has to see a rider wherever it hangs. On this branch
   * the cost of missing it is the *attack roll*: without the check the ray
   * would be thrown, the damage rolled, and only then would the Poisoned fail
   * to find a turn to end at — leaving the caller's generator several rolls
   * further on than it started, for a cast that never happened.
   */
  it('asks for a turn order before the ray is even thrown', () => {
    const dice = supply('hit');
    const before = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    const out = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'ray-of-sickness', targets: [TARGET], slotLevel: 1 },
      dice,
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_turns');
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['turn-order']);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
  });

  /** And it says nothing about a condition it no longer leaves to the DM. */
  it('no longer reports the Poisoned condition as unmodelled', () => {
    expect(ray('hit').unverified.join(' ')).not.toMatch(/Poisoned/i);
  });
});

describe('it replays', () => {
  it('replays prefix by prefix', () => {
    const log = nextTurn([
      ...SETUP,
      ...unwrap(
        resolveSpell(
          fold('seed', SETUP),
          CASTER,
          { spellId: 'color-spray', targets: [], towards: { x: 100, y: 200, z: 0 }, slotLevel: 1 },
          supply('spray'),
        ),
        'color spray',
      ).events,
    ]);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
