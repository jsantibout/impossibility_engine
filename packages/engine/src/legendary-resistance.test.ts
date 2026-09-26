/**
 * A failure a creature may choose to turn — SRD Unicorn, Legendary Resistance
 * (3/Day): "If the unicorn fails a saving throw, it can choose to succeed
 * instead."
 *
 * **The window is the one the engine already holds**, and that is the whole of
 * the design. `test-rolled` is the instant SRD Dark One's Own Luck writes out in
 * one clause — "after seeing the roll but before any of the roll's effects
 * occur" — and this sentence names the same instant with a different answer: not
 * a die pushed, but an outcome replaced. So it is a third `ReactionEffect`
 * beside `intervene` and `reroll`, offered only against a **saving throw** the
 * roller **failed**, and only to the roller.
 *
 * **It costs no Reaction**, which is the commonest mistake about this corner of
 * the rules and the reason `ReactionFeature.costsReaction` exists: the book
 * limits it with a pool and nothing else, so a unicorn that has already parried
 * this round may still turn a save. What it does spend is one of the day's
 * three, which is `printedLinePoolKey` and the `dawn` tally every printed
 * per-day limit is on.
 *
 * **The die is not touched and no number is produced.** The roll stays in the
 * log exactly as it fell; what changes is `success`, with `autoSucceeded`
 * naming the rule — the field that already means "why this succeeded regardless
 * of the roll".
 *
 * ## What it does not reach, said out loud
 *
 * A saving throw rolled **inside** a casting's own resolution opens no window:
 * `resolveSpell` settles a Fireball's saves in one breath, which is the rule
 * `ReactionWindow` states about `targeted-by-spell` and the reason
 * `offersForDamage` holds nothing open for a damage roll nobody can answer. So
 * Legendary Resistance reaches a save a DM asks for — `resolveTest`, the
 * `roll_save` door — and not yet one a spell rolls for itself. That is a real
 * limit and it is the window's rather than this line's: the day a casting's
 * saves are held open, this answers them with no change here.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  reactionOpportunities,
  resolveTest,
  settleTest,
  takeTestReaction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { adaptMonster, printedLinePoolKey, printedTraitKey } from './monster.js';
import { remaining } from './resources.js';

const id = (s: string) => asCharacterId(s);
const UNICORN = id('unicorn');

/** The block's own heading, read off the block rather than retyped. */
const LINE = SRD_CONTENT.monsterById('unicorn')!.traits[0]!.name;
const FEATURE = printedTraitKey('unicorn', LINE);
const POOL = printedLinePoolKey(LINE);

const supply = (seed = 'horn') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

function inTheGlade(): GameState {
  const arrived = unwrap(addCreature(fold('glade', []), SRD_CONTENT, UNICORN, 'unicorn'), 'unicorn');
  return after(fold('glade', []), arrived.events);
}

/** A saving throw at a DC nothing on this sheet can reach, so it always fails. */
const doomed = (state: GameState, seed: string) =>
  unwrap(
    resolveTest(
      state,
      UNICORN,
      { kind: 'saving-throw', ability: 'dex', dc: 40, label: 'the chasm', commandId: `s-${seed}` },
      supply(seed),
    ),
    'the save',
  );

describe('the adapter reads the trait as the window it answers', () => {
  it('compiles Legendary Resistance into a Reaction that costs no Reaction', () => {
    const unicorn = adaptMonster(SRD_CONTENT.monsterById('unicorn')!, UNICORN);
    expect(unicorn.sheet.reactions).toEqual([
      {
        feature: FEATURE,
        name: LINE,
        window: 'test-rolled',
        costsReaction: false,
        pool: POOL,
        reach: { kind: 'self' },
        does: { kind: 'succeed-instead' },
      },
    ]);
    expect(unicorn.pools).toEqual(
      expect.arrayContaining([{ key: POOL, label: LINE, max: 3, recovers: 'dawn' }]),
    );
  });
});

describe('the unicorn turns a failed save into a success', () => {
  it('is offered against its own failed saving throw, and nobody else’s roll', () => {
    const rolled = doomed(inTheGlade(), 'a');
    expect(rolled.test!.success).toBe(false);
    expect(rolled.offers).toEqual([
      { reactor: UNICORN, feature: FEATURE, name: LINE, costsReaction: false, pool: POOL },
    ]);

    const open = after(inTheGlade(), rolled.events);
    expect(reactionOpportunities(open, SRD_CONTENT)).toEqual([
      {
        window: 'test-rolled',
        reactor: UNICORN,
        id: FEATURE,
        name: LINE,
        kind: 'feature',
        costsReaction: false,
        pool: POOL,
        // Its own roll: the sentence is about the unicorn's own save, so the
        // window names the unicorn on both sides.
        against: UNICORN,
      },
    ]);
  });

  it('is not offered against a save it made, or against an ability check', () => {
    const made = unwrap(
      resolveTest(
        inTheGlade(),
        UNICORN,
        { kind: 'saving-throw', ability: 'dex', dc: 1, commandId: 'made' },
        supply('made'),
      ),
      'the easy save',
    );
    expect(made.test!.success).toBe(true);
    expect(made.offers).toEqual([]);

    const checked = unwrap(
      resolveTest(
        inTheGlade(),
        UNICORN,
        { kind: 'ability-check', ability: 'dex', dc: 40, commandId: 'check' },
        supply('check'),
      ),
      'the check',
    );
    expect(checked.test!.success).toBe(false);
    expect(checked.offers).toEqual([]);
  });

  it('replaces the outcome without touching the die, and spends one of the day’s three', () => {
    const glade = inTheGlade();
    const rolled = doomed(glade, 'b');
    const open = after(glade, rolled.events);
    expect(remaining(open.creatures[UNICORN]!.resources, POOL)).toBe(3);

    const turned = unwrap(
      takeTestReaction(open, UNICORN, { feature: FEATURE, commandId: 't' }, supply('t')),
      'the resistance',
    );
    expect(turned.test!.success).toBe(true);
    expect(turned.test!.autoSucceeded).toBe(LINE);
    // The die is exactly the one that fell: nothing was rerolled and nothing
    // was added, which is what "choose to succeed" says and what keeps the
    // engine from producing a number here.
    expect(turned.test!.natural).toBe(rolled.test!.natural);
    expect(turned.test!.total).toBe(rolled.test!.total);
    // No Reaction went, and no new roll was issued.
    expect(turned.events.some((e) => e.type === 'rolls-issued')).toBe(false);

    const done = after(open, turned.events);
    expect(remaining(done.creatures[UNICORN]!.resources, POOL)).toBe(2);
    // And the window closes with the success the unicorn chose.
    const settled = unwrap(settleTest(done, { commandId: 'settle' }), 'settle');
    expect(settled.test!.success).toBe(true);
  });

  it('turns three and is refused a fourth', () => {
    let state = inTheGlade();
    for (const seed of ['one', 'two', 'three']) {
      const rolled = doomed(state, seed);
      state = after(state, rolled.events);
      const turned = unwrap(
        takeTestReaction(state, UNICORN, { feature: FEATURE, commandId: `t-${seed}` }, supply(seed)),
        `the ${seed} resistance`,
      );
      expect(turned.test!.success).toBe(true);
      state = after(state, turned.events);
      state = after(state, unwrap(settleTest(state, { commandId: `x-${seed}` }), 'settle').events);
    }
    expect(remaining(state.creatures[UNICORN]!.resources, POOL)).toBe(0);

    // The fourth failure is a failure: with the day's uses gone the window is
    // not even offered, which is `canAfford`'s rule and not a second one — and
    // a test nobody can push is final on return and holds nothing open, which
    // is `offersForTest`'s own empty-list rule. So the refusal a caller gets is
    // that there is no window at all.
    const fourth = doomed(state, 'four');
    expect(fourth.offers).toEqual([]);
    const refused = takeTestReaction(
      after(state, fourth.events),
      UNICORN,
      { feature: FEATURE, commandId: 'nope' },
      supply('nope'),
    );
    expect(isErr(refused) && refused.code).toBe('no_pending_test');
  });
});
