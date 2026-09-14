import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { SPELL_DEFINITIONS, definitionFor } from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { castingOf } from './commands/spell-resolution.js';
// Not a command: `resolveCast` is the low-level half beneath `resolveSpell`,
// for a spell the engine has no definition for, so it is a module export and
// not on the barrel. This file is the one that drives it hardest.
import { resolveCast } from './commands/casting.js';
import {
  advanceTime,
  continueCasting,
  endConcentration,
  resolveDamage,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  removeCreatureEverywhere,
  resolveTurn,
  beginCombat,
  pendingCastingsOf,
  useFreeObjectInteraction,
} from './commands.js';

/**
 * A casting time of a minute or more, and a spell cast as a Ritual.
 *
 * SRD 5.2.1, "Longer Casting Times":
 *
 * > "Certain spells—including a spell cast as a Ritual—require more time to
 * > cast: minutes or even hours. While you cast a spell with a casting time of
 * > 1 minute or more, you must take the Magic action on each of your turns,
 * > and you must maintain Concentration while you do so. If your Concentration
 * > is broken, the spell fails, but you don't expend a spell slot. To cast the
 * > spell again, you must start over."
 *
 * And the Ritual tag:
 *
 * > "The Ritual version of a spell takes 10 minutes longer to cast than
 * > normal. It also doesn't expend a spell slot, which means the ritual
 * > version of a spell can't be cast at a higher level."
 *
 * **The two-event casting is the state machine, and it was already there.** A
 * long casting is a *declared* casting whose settlement waits on the clock: the
 * declaration allocates the id and drops whatever Concentration the caster was
 * holding, the slot stays unspent until settlement, and an interruption is the
 * same `spell-interrupted` a Counterspell writes. What is added is one fact on
 * the pending record — when it completes — and one Concentration that names a
 * casting nothing is running yet.
 *
 * **In combat it is the same mechanism plus one fact.** SRD's per-turn
 * Magic-action obligation is a state machine on top of the caster's turns, and
 * `PendingCasting.sustainedOnTurn` is the whole of it: `continueCasting` stamps
 * it, and a turn that ends without it fails the rite through `releaseCasting`,
 * derived and with no event. The clock a fight derives from its own rounds is
 * what the settlement then waits on.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 50,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(FOE),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: ['comprehend-languages', 'detect-magic', 'hold-person', 'mage-armor', 'fly'],
    }),
  },
];

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...SETUP, ...extra]);

const slots = (state: GameState, level: number) =>
  remaining(state.creatures.wizard!.resources, spellSlotKey(level));

/**
 * A minute-long casting of a spell the engine has a definition for.
 *
 * Driven through `resolveCast` — the low-level half, which takes the casting
 * time and the seconds directly — because that half takes its caller's word
 * about the economy and is therefore where the *mechanism* can be exercised
 * without a definition at all. IE-036 has since written twelve definitions
 * that declare one, and `long-casting-spells.test.ts` drives the same
 * mechanism through the **catalogue**; the two are worth having apart, because
 * this file's cases are about the state machine and that one's are about the
 * spells. The ritual path through `resolveSpell` is driven here too.
 */
const declareLong = (log: readonly GameEvent[] = SETUP, over = {}) =>
  resolveCast(fold('seed', log), WIZARD, {
    spell: 'Comprehend Languages',
    level: 1,
    slotLevel: 1,
    castingTime: 'long',
    castingSeconds: 60,
    duration: { kind: 'seconds', seconds: 3600 },
    hold: { spellId: 'comprehend-languages', targets: [], unverified: [] },
    ...over,
  });

describe('a casting of a minute or more is declared, and completes on the clock', () => {
  /**
   * SRD Counterspell decides which costs are already paid and it is not all of
   * them: "the action ... is wasted", and "the slot isn't expended". A long
   * casting is the same two-event shape, so the same asymmetry holds — and the
   * SRD says it again in its own words: "If your Concentration is broken, the
   * spell fails, but you don't expend a spell slot."
   */
  it('declares the casting without spending the slot', () => {
    const declared = unwrap(declareLong(), 'declare');
    const after = world(declared);

    expect(pendingCastingsOf(after)[0]?.spell).toBe('Comprehend Languages');
    expect(pendingCastingsOf(after)[0]?.completesAt).toEqual({ kind: 'elapsed', at: 60 });
    expect(slots(after, 1)).toBe(4);
  });

  /**
   * "you must maintain Concentration while you do so" — on the casting itself,
   * which is a thing with an identity and nothing running yet. It is the same
   * `concentration-started` every other spell writes, naming the id the
   * declaration allocated.
   */
  it('concentrates on the casting from the moment it begins', () => {
    const after = world(unwrap(declareLong(), 'declare'));
    expect(after.creatures.wizard!.concentration?.castingId).toBe(
      pendingCastingsOf(after)[0]?.castingId,
    );
    // And nothing is running under that id yet, which is the whole point.
    expect(after.ongoing).toEqual({});
  });

  /** And whatever the caster was holding is gone the moment they start. */
  it('drops a Concentration the caster was already holding', () => {
    const held = unwrap(
      resolveSpell(world(), WIZARD, { spellId: 'detect-magic', targets: [], slotLevel: 1 }, supply()),
      'detect magic',
    );
    const log = [...SETUP, ...held.events];
    expect(world(held.events).creatures.wizard!.concentration?.spell).toBe('Detect Magic');

    const declared = unwrap(declareLong(log), 'declare');
    expect(declared.some((e) => e.type === 'concentration-ended')).toBe(true);
    const after = fold('seed', [...log, ...declared]);
    expect(after.creatures.wizard!.concentration?.spell).toBe('Comprehend Languages');
  });

  it('refuses to settle before the casting has finished, and settles after', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);

    const early = resolveDeclaredCast(open, pendingCastingsOf(open)[0]!.castingId, supply());
    expect(isErr(early) && early.code).toBe('still_casting');

    const ticked = fold('seed', [
      ...SETUP,
      ...declared,
      ...unwrap(advanceTime(open, 60, 'the incantation'), 'tick'),
    ]);
    const settled = unwrap(resolveDeclaredCast(ticked, pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');
    const done = fold('seed', [
      ...SETUP,
      ...declared,
      ...unwrap(advanceTime(open, 60, 'the incantation'), 'tick'),
      ...settled.events,
    ]);

    expect(pendingCastingsOf(done)).toEqual([]);
    // The slot goes here and nowhere else.
    expect(slots(done, 1)).toBe(3);
  });

  /**
   * SRD: "the spell fails, but you don't expend a spell slot." Nothing is
   * refunded, because nothing was taken — the same reason `spell-interrupted`
   * writes no compensating event.
   */
  it('fails the casting when damage breaks the Concentration, and spends no slot', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);

    const hurt = unwrap(
      resolveDamage(
        open,
        WIZARD,
        { amount: 80, source: 'a falling rock' },
        supply('hurt'),
      ),
      'damage',
    );
    const after = fold('seed', [...SETUP, ...declared, ...hurt.events]);

    expect(pendingCastingsOf(after)).toEqual([]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(slots(after, 1)).toBe(4);
  });

  /** And a caster who simply stops casting drops the casting with it. */
  it('clears the casting when the caster gives up the Concentration', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);
    const stopped = unwrap(endConcentration(open, WIZARD, 'voluntary'), 'stop');
    expect(pendingCastingsOf(fold('seed', [...SETUP, ...declared, ...stopped]))).toEqual([]);
  });

  /**
   * A non-Concentration spell's casting-Concentration existed only to sustain
   * the casting, so it ends when the casting completes — the same distinction
   * `released` already draws for a readied spell, which is a Concentration that
   * was holding a spell rather than one the spell needed.
   */
  it('ends the casting Concentration when a spell that needs none completes', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);
    const tick = unwrap(advanceTime(open, 60, 'the incantation'), 'tick');
    const log = [...SETUP, ...declared, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');

    expect(
      settled.events.filter(
        (e) => e.type === 'concentration-ended' && e.reason === 'completed',
      ),
    ).toHaveLength(1);
    expect(fold('seed', [...log, ...settled.events]).creatures.wizard!.concentration).toBeNull();
  });

  /**
   * SRD gives a spell's Duration from the moment it takes effect, and a casting
   * that takes a minute has not taken effect for a minute. So the span is
   * carried on the pending record and resolved at settlement — pinning it at
   * declaration would have made a ten-minute Detect Magic ritual expire the
   * instant it started.
   */
  it('starts the spell’s own duration when the casting completes, not when it began', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);
    const tick = unwrap(advanceTime(open, 60, 'the incantation'), 'tick');
    const log = [...SETUP, ...declared, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');

    const scheduled = settled.events.find((e) => e.type === 'effect-scheduled');
    expect(scheduled).toMatchObject({ deadline: { kind: 'elapsed', at: 60 + 3600 } });
  });

  /**
   * **The span is validated by the one function that owns the conversion**,
   * which is what carrying seconds rather than a resolved `Deadline` could
   * most easily have lost. `resolveDuration` refuses a duration that is not a
   * whole number of seconds forwards, and every other casting path is refused
   * `bad_duration` by it — so a long casting that skipped it would be the one
   * place in the engine where a span goes unchecked.
   *
   * What that costs is not abstract. A `NaN` span settles to a deadline of
   * `null`, which leaves the casting running for ever in the live session and
   * expires it **immediately** on reload, because `null` folds back as `0` —
   * so the same log means two different things. A negative span expires the
   * spell the instant it is cast, and a fractional one lands between two
   * moments the clock can be at.
   */
  it.each([
    ['not a number at all', Number.NaN],
    ['a span that runs backwards', -100],
    ['a span between two seconds', 90.5],
  ])('refuses %s as the spell’s own duration', (_name, seconds) => {
    const out = declareLong(SETUP, { duration: { kind: 'seconds', seconds } });
    expect(isErr(out) && out.code).toBe('bad_duration');
  });

  /**
   * And nothing is spent by the refusal — no casting is left standing open.
   *
   * Read off the world **after** the refusal. It used to be read off `before`,
   * which is the state the refusal was aimed at and holds no casting by
   * construction, so the assertion could not fail whatever the command did.
   */
  it('leaves no casting open when the duration is refused', () => {
    const before = world();
    expect(isErr(declareLong(SETUP, { duration: { kind: 'seconds', seconds: -1 } }))).toBe(true);
    expect(world()).toEqual(before);
    expect(pendingCastingsOf(world())).toEqual([]);
  });

  /**
   * **And the batch's own order is load-bearing, which only a fold can say.**
   * `concentration-ended` goes through `releaseCasting`, and that takes every
   * timer the casting owns — so a deadline written *before* it is wiped by the
   * very event saying the rite is over, and the spell then runs for ever:
   * invisible, because nothing ever expires it, and findable only by Dispel
   * Magic. Reading the emitted `effect-scheduled` cannot see that; the timer
   * has to be read out of the folded state, and the casting driven past its
   * own duration.
   */
  it('leaves the spell a timer that actually ends it', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);
    const tick = unwrap(advanceTime(open, 60, 'the incantation'), 'tick');
    const log = [...SETUP, ...declared, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');
    const running = fold('seed', [...log, ...settled.events]);

    const castingId = settled.castingId;
    expect(running.ongoing[castingId]).toBeDefined();
    // The timer survived the Concentration ending in the same batch.
    expect(Object.values(running.timers).map((t) => t.target)).toContainEqual({
      kind: 'casting',
      castingId,
    });

    // And it genuinely ends the spell when the hour is up, rather than the
    // casting running on with nothing left to stop it.
    const later = fold('seed', [
      ...log,
      ...settled.events,
      ...unwrap(advanceTime(running, 3600, 'an hour of reading'), 'hour'),
    ]);
    expect(later.ongoing[castingId]).toBeUndefined();
  });
});

/**
 * SRD "Longer Casting Times": "you must take the Magic action on **each of your
 * turns**, and you must maintain Concentration while you do so. If your
 * Concentration is broken, the spell fails, but you don't expend a spell slot."
 *
 * The clock half of that paragraph was IE-034's; this is the obligation. In
 * combat the clock is *derived from turns wrapping*, so the two are the same
 * mechanism — a declared casting whose settlement waits on `completesAt` — with
 * one fact added: which turn last saw the caster at it.
 */
describe('in combat the rite is a per-turn obligation', () => {
  const FIGHTERS = [
    { id: WIZARD, initiative: 20, speed: 30 },
    { id: FOE, initiative: 10, speed: 30 },
  ];

  /** Combat, begun around whatever has already happened. */
  const fighting = (before: readonly GameEvent[] = []): readonly GameEvent[] => [
    ...before,
    ...unwrap(beginCombat(world(before), FIGHTERS), 'combat'),
  ];

  const castingIdIn = (events: readonly GameEvent[]): string => {
    const declared = events.find((e) => e.type === 'spell-declared');
    if (declared?.type !== 'spell-declared') throw new Error('no casting was declared');
    return declared.casting.castingId;
  };

  /** A one-minute rite declared in combat, on the wizard's own turn. */
  const riteInCombat = (): { log: readonly GameEvent[]; castingId: string } => {
    const begun = fighting();
    const declared = unwrap(declareLong([...SETUP, ...begun]), 'declare');
    return { log: [...begun, ...declared], castingId: castingIdIn(declared) };
  };

  /**
   * Whose turn it is, and what the rite is owed on it.
   *
   * A loop that simply called `continueCasting` every step would assert nothing
   * about *whose* turns carry the obligation, and would be refused `no_action`
   * on the turn the rite was declared. So it asks the two questions the rule
   * asks — is it this caster's turn, and has this turn already seen the Magic
   * action — and takes it only then.
   */
  const carryOn = (
    start: readonly GameEvent[],
    castingId: string,
    steps: number,
  ): readonly GameEvent[] => {
    let log = [...start];
    for (let n = 0; n < steps; n += 1) {
      const state = world(log);
      const combat = state.combat!;
      const pending = state.pendingCastings[castingId];
      if (
        pending !== undefined &&
        combat.order[combat.turnIndex]?.id === pending.caster &&
        pending.sustainedOnTurn !== combat.turnsTaken
      ) {
        log = [
          ...log,
          ...unwrap(
            continueCasting(state, pending.caster, castingId, { commandId: `keep-${n}` }),
            `keep at it on turn ${combat.turnsTaken}`,
          ),
        ];
      }
      log = [...log, ...unwrap(resolveTurn(world(log), supply(`t${n}`)), `turn ${n}`).events];
    }
    return log;
  };

  /**
   * **The refusal is gone, and its reason named the thing that was built.** It
   * said SRD "requires the caster to take the Magic action on each of their
   * turns, and that per-turn obligation is not modelled"; it is modelled now,
   * so a fight running is no longer a reason to refuse a rite.
   */
  it('declares a casting of a minute or more while a fight is running', () => {
    const { log, castingId } = riteInCombat();
    const open = world(log);

    expect(pendingCastingsOf(open).map((c) => c.castingId)).toEqual([castingId]);
    // The Magic action went; the slot did not.
    expect(open.combat?.budgets[WIZARD]?.action).toBe(false);
    expect(slots(open, 1)).toBe(4);
    expect(open.creatures.wizard!.concentration?.castingId).toBe(castingId);
  });

  /**
   * SRD: "you must take the Magic action on each of your turns." The turn the
   * rite is declared on is one of those turns and the declaration **is** that
   * turn's Magic action — so the caster does not owe a second one, and a caller
   * who asks is refused by the economy rather than by a rule about rites.
   */
  it('does not owe a second Magic action on the turn it was declared', () => {
    const { log, castingId } = riteInCombat();
    const open = world(log);

    expect(open.pendingCastings[castingId]?.sustainedOnTurn).toBe(open.combat?.turnsTaken);

    const again = continueCasting(open, WIZARD, castingId, {});
    expect(isErr(again) && again.code).toBe('no_action');

    // And the turn it was declared on ends with the rite intact.
    const turned = [...log, ...unwrap(resolveTurn(open, supply('t')), 'turn').events];
    expect(pendingCastingsOf(world(turned)).map((c) => c.castingId)).toEqual([castingId]);
  });

  /**
   * Ten rounds of a two-creature fight is sixty seconds, which is the shortest
   * span the SRD's "minutes or even hours" can mean — so the clock a fight
   * derives from its own rounds is what the settlement waits on, and there is
   * no `advanceTime` anywhere in this fixture.
   */
  it('settles when the fight’s own clock reaches the moment', () => {
    const { log, castingId } = riteInCombat();
    expect(world(log).pendingCastings[castingId]?.completesAt).toEqual({ kind: 'elapsed', at: 60 });

    const carried = carryOn(log, castingId, 20);
    const ready = world(carried);

    // The clock moved because rounds wrapped, and nothing else touched it.
    expect(ready.elapsed).toBe(60);
    expect(carried.some((e) => e.type === 'time-advanced')).toBe(false);
    expect(pendingCastingsOf(ready).map((c) => c.castingId)).toEqual([castingId]);

    const settled = unwrap(resolveDeclaredCast(ready, castingId, supply('done')), 'settle');
    const after = world([...carried, ...settled.events]);
    expect(after.pendingCastings).toEqual({});
    // The slot is expended at last, and only now.
    expect(slots(after, 1)).toBe(3);
    expect(after.ongoing[castingId]?.spellId).toBe('comprehend-languages');
  });

  /** And not before: `isDue` reads `completesAt`, in combat as out of it. */
  it('refuses to settle while the fight is still short of the moment', () => {
    const { log, castingId } = riteInCombat();
    const part = carryOn(log, castingId, 18);
    const early = resolveDeclaredCast(world(part), castingId, supply('early'));
    expect(isErr(early) && early.code).toBe('still_casting');
  });

  /**
   * SRD: "If your Concentration is broken, the spell fails, but you don't
   * expend a spell slot."
   *
   * **Derived, so no event.** Nobody decides that a turn ended without the
   * Magic action being taken, so the failure is the reducer's the way a lost
   * Concentration is — which means no log, however assembled, can show a rite
   * running past a turn its caster let slip.
   */
  it('fails the rite at the end of a turn the caster took no Magic action on', () => {
    const { log, castingId } = riteInCombat();

    // Two turns bring the wizard round again; the third ends that turn with
    // nothing taken, which is the turn the rite is lost on.
    const kept = carryOn(log, castingId, 2);
    const before = world(kept);
    expect(pendingCastingsOf(before).map((c) => c.castingId)).toEqual([castingId]);
    expect(before.combat?.order[before.combat.turnIndex]?.id).toBe(WIZARD);

    const turn = unwrap(resolveTurn(before, supply('slip')), 'the turn slips by');
    const after = world([...kept, ...turn.events]);

    expect(after.pendingCastings).toEqual({});
    expect(after.creatures.wizard!.concentration).toBeNull();
    // SRD: the slot is not expended.
    expect(slots(after, 1)).toBe(4);
    // Nothing in the log says it failed, and nothing says it ended either: the
    // boundary emitted the one event it always emits and no more.
    expect(turn.events.map((e) => e.type)).toEqual(['turn-advanced']);
    expect([...kept, ...turn.events].some((e) => e.type === 'spell-interrupted')).toBe(false);
    expect(after.ongoing[castingId]).toBeUndefined();
  });

  /** A rite that failed was never cast, so nothing is left of it anywhere. */
  it('leaves nothing of a failed rite behind', () => {
    const { log, castingId } = riteInCombat();
    const kept = carryOn(log, castingId, 2);
    const lost = world([...kept, ...unwrap(resolveTurn(world(kept), supply('slip')), 'slip').events]);

    expect(lost.timers).toEqual({});
    expect(lost.pendingSaves).toEqual({});
    expect(JSON.stringify(lost.creatures.wizard)).not.toContain(castingId);
  });

  /**
   * A rite has a turn to be pending across, so the turn no longer refuses for
   * it — and an instant window, which has none, still does. With IE-038's
   * keyed record that is per casting, so a rite standing beside an unsettled
   * window blocks on the window alone.
   */
  it('lets the turn advance past a rite, and still refuses for an instant window', () => {
    const FOE_SLOT: GameEvent = {
      type: 'resource-pool-declared',
      id: FOE,
      pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
    };
    const begun = fighting([FOE_SLOT]);
    const declared = unwrap(declareLong([...SETUP, ...begun]), 'declare');
    const castingId = castingIdIn(declared);
    const log = [...begun, ...declared];
    expect(isErr(resolveTurn(world(log), supply('a')))).toBe(false);

    // On to the foe, who holds an ordinary casting open beside the rite.
    const turned = [...log, ...unwrap(resolveTurn(world(log), supply('a')), 'turn').events];
    const held = unwrap(
      resolveCast(world(turned), FOE, {
        spell: 'Bless',
        level: 1,
        slotLevel: 1,
        concentration: false,
        hold: { spellId: 'bless', targets: [FOE], unverified: [] },
      }),
      'the foe holds one open',
    );
    const both = world([...turned, ...held]);
    expect(pendingCastingsOf(both)).toHaveLength(2);

    const refused = resolveTurn(both, supply('b'));
    expect(isErr(refused) && refused.code).toBe('casting_pending');
    // And the reason names the instant window, not the rite.
    if (isErr(refused)) {
      expect(refused.reason).toContain(castingIdIn(held));
      expect(refused.reason).not.toContain(castingId);
    }
  });

  /**
   * **The recorded wedge, which had no test that would have caught it.**
   * CLAUDE.md: "A casting declared before a fight and still open when one
   * starts wedges the fight", because `resolveTurn` refused `casting_pending`
   * and the settlement refused `still_casting` until a clock that only turns
   * could advance. A fight now simply enters the obligation.
   */
  it('enters the obligation when a fight starts around an open rite', () => {
    const declared = unwrap(declareLong(), 'declare before the fight');
    const castingId = castingIdIn(declared);
    const log = fighting(declared);

    // The marker is absent: the rite began when there were no turns, so the
    // caster's first turn of the fight is the first one it is owed on.
    expect(world(log).pendingCastings[castingId]?.sustainedOnTurn).toBeUndefined();

    // The wedge: this used to be `casting_pending`, with no way out but the
    // caster giving the rite up.
    const carried = carryOn(log, castingId, 20);
    const ready = world(carried);
    expect(pendingCastingsOf(ready).map((c) => c.castingId)).toEqual([castingId]);

    const settled = unwrap(resolveDeclaredCast(ready, castingId, supply('done')), 'settle');
    expect(world([...carried, ...settled.events]).ongoing[castingId]).toBeDefined();
  });

  /** And a fight that starts around a rite nobody keeps at loses it. */
  it('loses a rite the fight’s first turn does not keep at', () => {
    const declared = unwrap(declareLong(), 'declare before the fight');
    const castingId = castingIdIn(declared);
    const log = fighting(declared);

    const turn = unwrap(resolveTurn(world(log), supply('slip')), 'the wizard’s turn passes');
    const after = world([...log, ...turn.events]);
    expect(after.pendingCastings[castingId]).toBeUndefined();
    expect(slots(after, 1)).toBe(4);

    // And the Concentration went with it, through the one door — so the
    // dismissal IE-034 recorded as the only way out has nothing left to end.
    const stopped = endConcentration(after, WIZARD, 'voluntary');
    expect(isErr(stopped) && stopped.code).toBe('not_concentrating');
  });

  /**
   * Everybody else's fight is untouched: the foe acts, casts and takes its turn
   * throughout, and nothing is refused on account of the rite.
   */
  it('leaves every other creature’s fight alone', () => {
    const armed: readonly GameEvent[] = [
      {
        type: 'spellcasting-declared',
        id: FOE,
        spellcasting: declaredCasting({
          ability: 'int',
          classId: 'wizard',
          cantrips: ['fire-bolt'],
        }),
      },
      { type: 'sight-declared', from: FOE, to: ALLY, seen: true },
    ];
    const begun = fighting(armed);
    const declared = unwrap(declareLong([...SETUP, ...begun]), 'declare');
    const castingId = castingIdIn(declared);
    const log = [...begun, ...declared];

    const turned = [...log, ...unwrap(resolveTurn(world(log), supply('a')), 'on to the foe').events];
    const open = world(turned);
    expect(open.combat?.order[open.combat.turnIndex]?.id).toBe(FOE);

    const bolt = unwrap(
      resolveSpell(open, FOE, { spellId: 'fire-bolt', targets: [ALLY] }, supply('bolt')),
      'the foe casts while the wizard is mid-rite',
    );
    // The Magic action went on the Fire Bolt, so what is left to spend is the
    // turn's free object interaction — which is still a spender, and still
    // guarded by exactly the debts the rite does not create.
    const fiddled = unwrap(
      useFreeObjectInteraction(world([...turned, ...bolt.events]), FOE),
      'the foe draws something',
    );
    const acted = [...turned, ...bolt.events, ...fiddled];
    expect(isErr(resolveTurn(world(acted), supply('b')))).toBe(false);

    // And the rite is exactly where it was through all of it.
    expect(world(acted).pendingCastings[castingId]).toEqual(open.pendingCastings[castingId]);
  });

  /**
   * **The case the brief asked to be written deliberately rather than hoped
   * for.** The derived failure sits before the end-of-turn area debts are
   * raised, so a boundary that does both has to do both — and the save that is
   * owed belongs to a *different* casting, because a rite that fails has taken
   * no effect and therefore owns no area for anything to be owed to.
   */
  it('fails a rite at a boundary that also owes an area saving throw', () => {
    const slick: readonly GameEvent[] = [
      {
        type: 'resource-pool-declared',
        id: ALLY,
        pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: ALLY,
        spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['grease'] }),
      },
    ];
    // Under the wizard's own feet, so the boundary that ends their turn is the
    // boundary the slick collects on. **A Cube does not include its point of
    // origin**, so the origin is a space away and the Cube is laid over the
    // wizard — the trap `area-triggers.test.ts` records under "a test that
    // passes for the wrong reason".
    const under = world(slick).scene!.positions[WIZARD]!;
    const greased = unwrap(
      resolveSpell(
        world(slick),
        ALLY,
        {
          spellId: 'grease',
          targets: [],
          at: { ...under, x: under.x - 5 },
          towards: { ...under, x: under.x + 50 },
          slotLevel: 1,
        },
        supply('grease'),
      ),
      'grease under the wizard',
    );
    // The fixture is only discriminating if the wizard is actually in it.
    expect(world([...slick, ...greased.events]).creatures.wizard!.conditions.instances).not.toEqual(
      [],
    );
    const before = [...slick, ...greased.events];

    const begun = fighting(before);
    const declared = unwrap(declareLong([...SETUP, ...begun]), 'declare');
    const castingId = castingIdIn(declared);
    const log = [...begun, ...declared];

    const kept = carryOn(log, castingId, 2);
    const turn = unwrap(resolveTurn(world(kept), supply('slip')), 'the boundary');
    const after = world([...kept, ...turn.events]);

    // The rite is gone, derived and silently.
    expect(after.pendingCastings).toEqual({});
    expect(slots(after, 1)).toBe(4);

    // And the slick's save was owed, rolled and settled at that same boundary —
    // against the Grease, which is a casting the boundary did not fail.
    const settled = turn.events.filter((e) => e.type === 'area-effect-settled');
    expect(
      settled.map((e) => (e.type === 'area-effect-settled' ? e.castingId : '')),
    ).toContain(greased.castingId);
    expect(after.owedAreaEffects).toEqual([]);
  });

  /** A retried continuation spends no second action and is a no-op. */
  it('is a no-op when the same command id keeps at it twice', () => {
    const { log, castingId } = riteInCombat();
    const start = carryOn(log, castingId, 2);
    const kept = unwrap(
      continueCasting(world(start), WIZARD, castingId, { commandId: 'keep' }),
      'keep at it',
    );
    const after = world([...start, ...kept]);
    expect(after.combat?.budgets[WIZARD]?.action).toBe(false);

    const again = unwrap(continueCasting(after, WIZARD, castingId, { commandId: 'keep' }), 'retry');
    expect(again).toEqual([]);
    // A second run under a fresh id is the economy's refusal, not a rule about
    // rites: SRD gives one Magic action a turn and it is already gone.
    const third = continueCasting(after, WIZARD, castingId, { commandId: 'twice' });
    expect(isErr(third) && third.code).toBe('no_action');
  });

  describe('what it refuses, and why', () => {
    it('refuses a casting id nobody is holding open', () => {
      const { log } = riteInCombat();
      const out = continueCasting(world(log), WIZARD, 'cast:99', {});
      expect(isErr(out) && out.code).toBe('no_casting_pending');
      if (isErr(out)) expect(out.reason).toContain('cast:99');
    });

    /** SRD: "**you** must take the Magic action." A rite is not lying about. */
    it('refuses somebody else’s rite', () => {
      const { log, castingId } = riteInCombat();
      const turned = [...log, ...unwrap(resolveTurn(world(log), supply('a')), 'turn').events];
      const out = continueCasting(world(turned), FOE, castingId, {});
      expect(isErr(out) && out.code).toBe('not_your_spell');
      if (isErr(out)) expect(out.reason).toContain(WIZARD);
    });

    /**
     * An instant window has no per-turn obligation: SRD writes the Magic action
     * for "a casting time of 1 minute or more" and for nothing else, so a
     * Counterspell window is not a thing anybody keeps at.
     */
    it('refuses a casting that is not a long one', () => {
      const begun = fighting();
      const held = unwrap(
        resolveCast(world(begun), WIZARD, {
          spell: 'Hold Person',
          level: 2,
          slotLevel: 2,
          concentration: true,
          hold: { spellId: 'hold-person', targets: [FOE], unverified: [] },
        }),
        'hold it open',
      );
      const out = continueCasting(world([...begun, ...held]), WIZARD, castingIdIn(held), {});
      expect(isErr(out) && out.code).toBe('not_a_long_casting');
    });

    /** The obligation is on the caster's own turns, so there has to be one. */
    it('refuses on somebody else’s turn', () => {
      const { log, castingId } = riteInCombat();
      const turned = [...log, ...unwrap(resolveTurn(world(log), supply('a')), 'turn').events];
      const out = continueCasting(world(turned), WIZARD, castingId, {});
      expect(isErr(out) && out.code).toBe('not_their_turn');
    });

    /**
     * Outside combat there are no turns to owe anything on, and the rite runs
     * on the clock — which is IE-034's half, unchanged.
     */
    it('refuses outside combat', () => {
      const declared = unwrap(declareLong(), 'declare');
      const out = continueCasting(world(declared), WIZARD, castingIdIn(declared), {});
      expect(isErr(out) && out.code).toBe('not_in_combat');
    });

    /**
     * **The door this opened, closed before anything is spent.** A spell's
     * Duration starts when the spell does, which is why a clock-deferred
     * casting carries a span rather than a pinned deadline — and while a long
     * casting was refused in combat, a turn-anchored duration could never reach
     * that branch, because `resolveDuration` refuses one outside a fight. In
     * combat it resolves perfectly well, and pinning it at the declaration
     * would end the spell a minute before it began.
     *
     * So it is refused where every other casting refusal is: before the slot,
     * the action and the first die.
     */
    it('refuses a turn-anchored Duration on a casting of a minute or more', () => {
      const begun = fighting();
      const out = declareLong([...SETUP, ...begun], {
        duration: { kind: 'end-of-next-turn', of: WIZARD },
      });
      expect(isErr(out) && out.code).toBe('duration_not_a_span');
      // Nothing spent: no slot, no action, no casting open.
      const after = world(begun);
      expect(slots(after, 1)).toBe(4);
      expect(after.combat?.budgets[WIZARD]?.action).toBe(true);
      expect(pendingCastingsOf(after)).toEqual([]);
    });
  });

  /**
   * **Turn numbers restart with each fight, so a marker from the last one names
   * a turn that has not happened.** Left standing it would alias: a rite
   * sustained on turn 3 of one fight would be credited for turn 3 of the next,
   * and a rite its caster had abandoned would survive a turn in silence. The
   * fight ending is where the numbering it belongs to goes.
   */
  it('forgets which turn sustained a rite when the fight ends', () => {
    const { log, castingId } = riteInCombat();
    const ended: readonly GameEvent[] = [...carryOn(log, castingId, 2), { type: 'combat-ended' }];
    const after = world(ended);

    expect(after.pendingCastings[castingId]?.sustainedOnTurn).toBeUndefined();
    // And the rite itself is untouched: a fight ending is not a Concentration
    // broken, and outside combat it simply runs on the clock again.
    expect(after.creatures.wizard!.concentration?.castingId).toBe(castingId);
  });
});

describe('a spell cast as a Ritual', () => {
  const ritual = (over = {}, log: readonly GameEvent[] = SETUP) =>
    resolveSpell(
      fold('seed', log),
      WIZARD,
      { spellId: 'comprehend-languages', targets: [], ritual: true, ...over },
      supply(),
    );

  /** SRD: "takes 10 minutes longer to cast than normal" — an Action, plus 600. */
  it('takes ten minutes longer than the printed casting time', () => {
    const declared = unwrap(ritual(), 'ritual');
    expect(pendingCastingsOf(world(declared.events))[0]?.completesAt).toEqual({
      kind: 'elapsed',
      at: 600,
    });
  });

  /** SRD: "It also doesn't expend a spell slot." */
  it('expends no slot, and records why', () => {
    const declared = unwrap(ritual(), 'ritual');
    const open = world(declared.events);
    const tick = unwrap(advanceTime(open, 600, 'the rite'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');

    expect(settled.events.find((e) => e.type === 'spell-cast')).toMatchObject({
      slotless: 'ritual',
      slot: null,
    });
    expect(slots(fold('seed', [...log, ...settled.events]), 1)).toBe(4);
  });

  /**
   * SRD: "which means the ritual version of a spell can't be cast at a higher
   * level." The sentence is the book's own gloss on the slot, so the refusal
   * names the level rather than the slot.
   */
  it('refuses a slot level above the spell’s own', () => {
    const out = ritual({ slotLevel: 3 });
    expect(isErr(out) && out.code).toBe('ritual_not_upcast');
  });

  /**
   * **The gloss is not the rule.** "It also doesn't expend a spell slot" is
   * the rule; "which means the ritual version of a spell can't be cast at a
   * higher level" is the SRD's own consequence of it. So a slot level *at* the
   * spell's own level is refused too — it is not an upcast, and it is still a
   * caller saying how a casting that costs nothing is paid for.
   */
  it('refuses a Ritual that names a slot level at the spell’s own level', () => {
    const out = ritual({ slotLevel: 1 });
    expect(isErr(out) && out.code).toBe('ritual_pays_nothing');
  });

  /**
   * And a reason for skipping a slot, which is the same sentence from the far
   * side: the casting has already decided it expends nothing and records
   * `ritual` as why. Left unchecked, a caller's `slotless` overwrote that.
   */
  it('refuses a Ritual that names its own reason for skipping a slot', () => {
    const out = ritual({ slotless: 'innate' });
    expect(isErr(out) && out.code).toBe('ritual_pays_nothing');
  });

  /** A spell the book does not tag as a Ritual has no ritual version. */
  it('refuses a spell that carries no Ritual tag', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'mage-armor', targets: [ALLY], ritual: true },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('not_a_ritual');
  });

  /**
   * A Concentration spell cast as a Ritual concentrates on the casting from
   * the declaration and simply carries on under the same id: there is one
   * Concentration, and the spell inherits the one the casting already had.
   */
  it('continues one Concentration from the rite into the spell', () => {
    const declared = unwrap(
      ritual({ spellId: 'detect-magic' }, SETUP),
      'detect magic ritual',
    );
    const open = world(declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    expect(open.creatures.wizard!.concentration?.castingId).toBe(castingId);

    const tick = unwrap(advanceTime(open, 600, 'the rite'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), pendingCastingsOf(open)[0]!.castingId, supply()), 'settle');

    // No second `concentration-started` — the reducer would call that a corrupt
    // log, and the SRD calls it one Concentration.
    expect(settled.events.some((e) => e.type === 'concentration-started')).toBe(false);
    expect(settled.events.some((e) => e.type === 'concentration-ended')).toBe(false);

    const done = fold('seed', [...log, ...settled.events]);
    expect(done.creatures.wizard!.concentration?.castingId).toBe(castingId);
    expect(done.ongoing[castingId]?.spellId).toBe('detect-magic');
  });
});

describe('a casting on the clock is a casting in progress', () => {
  /**
   * SRD Counterspell interrupts "a creature **in the process of casting a
   * spell**", and a casting of a minute or more is that process for ten
   * minutes rather than for an instant. It is the same `pendingCasting` the
   * Counterspell window has always read, so the Reaction needed nothing added
   * to it — which is the evidence that this is the two-event casting reused
   * rather than a second mechanism beside it.
   *
   * It is also what keeps the defensive re-read inside the Counterspell's own
   * resolution unreachable, and therefore what keeps its written exemption in
   * `refusal-sweep.test.ts` true: the Counterspell's own batch allocates a
   * fresh casting id rather than settling the open one, spends no
   * Concentration of the rite's caster, and so leaves the pending record
   * exactly where the trigger check found it. Asserted as behaviour rather
   * than by naming the code, because a sweep that a test can satisfy by
   * quoting a string is not a sweep.
   */
  const COUNTERER: readonly GameEvent[] = [
    {
      type: 'resource-pool-declared',
      id: ALLY,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: ALLY,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['counterspell'] }),
    },
    { type: 'sight-declared', from: ALLY, to: WIZARD, seen: true },
  ];

  it('can be answered by a Counterspell, and the window is still open when it lands', () => {
    const started = fold('seed', [...SETUP, ...COUNTERER]);
    const declared = unwrap(
      resolveSpell(
        started,
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'rite',
    );
    const log = [...SETUP, ...COUNTERER, ...declared.events];
    const open = fold('seed', log);
    expect(pendingCastingsOf(open)[0]?.spell).toBe('Comprehend Languages');

    // The Reaction resolves — so the re-read inside it found the casting the
    // trigger check had already proved was open.
    const answered = unwrap(
      resolveSpell(
        open,
        ALLY,
        { spellId: 'counterspell', targets: [WIZARD], slotLevel: 3 },
        supply('counter'),
      ),
      'counterspell',
    );
    expect(answered.events.some((e) => e.type === 'spell-cast')).toBe(true);
  });
});

describe('a Ritual adds ten minutes, and the catalogue can tell you so at last', () => {
  /**
   * SRD: "The Ritual version of a spell takes 10 minutes longer to cast **than
   * normal**." Longer than normal, not ten minutes flat — and every one of the
   * *ten* definitions that carried the Ritual tag before IE-036 prints "Action
   * or Ritual", so none of them has a casting time of its own to be longer
   * than. For all ten, "0 + 600" and "600" are the same number, and a mutation
   * replacing the sum with the constant survived the entire suite.
   *
   * **SRD Alarm prints "1 minute or Ritual"**, so its Ritual takes **660**
   * seconds, and IE-036 put it in the catalogue. This fixture was a
   * hand-written definition until then — `castingOf` is pure over one, which
   * is the move `restoreOn`'s dawn-recovering pool makes for a branch no class
   * can reach — and it reads the real one now, because a guard that can be
   * pointed at the content itself should be.
   *
   * **Alarm is the fixture and not the only case.** Five more of the twelve
   * carry the tag and every one of them prints "1 minute or Ritual" too —
   * Commune with Nature, Identify, Illusory Script, Instant Summons and Magic
   * Mouth, all six coming to the same 60 + 600. Alarm is what these two cases
   * name because the test was written around it before the catalogue had one;
   * the sweep below is what actually holds the sum, and it loops over *every*
   * tagged definition with a casting time of its own, so a seventh needs no
   * edit here and a first one printing an hour would be caught by the same
   * loop.
   */
  const ALARM = definitionFor('alarm')!;

  it('is the spell’s own casting time plus ten minutes, not ten minutes flat', () => {
    expect(unwrap(castingOf(ALARM, { spellId: 'alarm', targets: [], ritual: true }), 'ritual')).toEqual(
      { castingTime: 'long', castingSeconds: 660, ritual: true },
    );
  });

  /** And without the Ritual, the spell's own minute stands unchanged. */
  it('leaves a long casting alone when no Ritual is asked for', () => {
    expect(unwrap(castingOf(ALARM, { spellId: 'alarm', targets: [] }), 'plain')).toEqual({
      castingTime: 'long',
      castingSeconds: 60,
      ritual: false,
    });
  });

  /** The definition under test is a coherent one, and it is the catalogue's. */
  it('is a definition the validator accepts', () => {
    expect(checkSpellDefinition(ALARM)).toEqual([]);
    expect(SPELL_DEFINITIONS).toContain(ALARM);
  });

  /**
   * And the sum is not vacuous, which is the half the ten Rituals could not
   * give: a tagged definition with a casting time of its own is what makes
   * "adds ten minutes" and "is ten minutes" different numbers, and the
   * catalogue now holds some. The two sets are named rather than counted —
   * a count would go stale the next time a Ritual is written.
   */
  it('has tagged definitions on both sides of the sum', () => {
    const tagged = SPELL_DEFINITIONS.filter((d) => d.ritual === true);
    const own = tagged.filter((d) => (d.castingSeconds ?? 0) > 0).map((d) => d.id);
    expect(own).not.toEqual([]);
    expect(tagged.filter((d) => d.castingSeconds === undefined).map((d) => d.id)).not.toEqual([]);
    // Every one of them comes to its own span plus the Ritual's ten minutes.
    for (const id of own) {
      const definition = definitionFor(id)!;
      expect(
        unwrap(castingOf(definition, { spellId: id, targets: [], ritual: true }), id).castingSeconds,
        id,
      ).toBe(definition.castingSeconds! + 600);
    }
  });
});

describe('a rite that ends takes its Concentration with it, by every door', () => {
  /**
   * **`spell-interrupted` is the one exit from a pending casting that does not
   * go through `releaseCasting`**, and until a casting could be concentrated
   * on there was nothing for it to miss. Now there is: SRD Counterspell says
   * "the spell dissipates with no effect", so the caster is not still
   * concentrating on it — and a Concentration naming a casting that no longer
   * exists is permanent, invisible, and calls for a Constitution save on every
   * later hit, throwing a die for a spell that is not there.
   *
   * So the reducer's case routes through the same door the other four endings
   * use. Nothing is given back either way: the action was wasted by the same
   * SRD sentence that spares the slot, and the slot was never spent.
   */
  const COUNTERER: readonly GameEvent[] = [
    {
      type: 'resource-pool-declared',
      id: ALLY,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: ALLY,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['counterspell'] }),
    },
    { type: 'sight-declared', from: ALLY, to: WIZARD, seen: true },
  ];

  /** The rite, declared and open, with an ally who can answer it. */
  const rite = () => {
    const started = fold('seed', [...SETUP, ...COUNTERER]);
    const declared = unwrap(
      resolveSpell(
        started,
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'rite',
    );
    return [...SETUP, ...COUNTERER, ...declared.events];
  };

  it('leaves nobody concentrating when a Counterspell interrupts it', () => {
    const log = rite();
    const open = fold('seed', log);
    expect(open.creatures.wizard!.concentration?.castingId).toBe(pendingCastingsOf(open)[0]?.castingId);

    // **The interruption is asserted, not assumed.** A Counterspell only
    // dissipates the casting on a failed save, so this forces the failure
    // rather than hoping for a seed — and then says so, because an early
    // return here would let a mutation that stopped a Counterspell
    // interrupting a rite pass *while claiming to prove* the record, the
    // Concentration and the slot are all right.
    const answered = unwrap(
      resolveSpell(open, ALLY, { spellId: 'counterspell', targets: [WIZARD], slotLevel: 3 }, {
        ...supply('counter'),
        bonuses: [{ source: 'the test insists the rite is broken', flat: -30 }],
      }),
      'counterspell',
    );
    expect(answered.events.filter((e) => e.type === 'spell-interrupted')).toHaveLength(1);

    const after = fold('seed', [...log, ...answered.events]);
    expect(pendingCastingsOf(after)).toEqual([]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(after.ongoing).toEqual({});
    // SRD: "If that spell was cast with a spell slot, the slot isn't expended"
    // — and a Ritual expends none in the first place.
    expect(slots(after, 1)).toBe(4);
  });

  /**
   * And the other writer of that event: a caster who leaves the game mid-rite.
   * `settleHoldsInvolving` interrupts the casting and `removeCreatureEverywhere`
   * ends the Concentration — two events about one fact, and the second is built
   * against the world the first leaves rather than against the world before
   * it, or the fold would refuse a `concentration-ended` for a Concentration
   * the interruption had already taken.
   */
  it('folds when the caster walks out mid-rite', () => {
    const log = rite();
    const removed = unwrap(removeCreatureEverywhere(fold('seed', log), WIZARD), 'leave');
    const after = fold('seed', [...log, ...removed]);
    expect(pendingCastingsOf(after)).toEqual([]);
    expect(after.creatures.wizard).toBeUndefined();
  });
});

describe('the Concentration save is the one the rite actually rests on', () => {
  /**
   * **Damage that drops the caster is the coarser of two routes, and it skips
   * the save.** A caster at 0 hit points is Unconscious, therefore
   * Incapacitated, therefore no longer concentrating — so the derived pass ends
   * the rite and `resolveDamage` reports `already-lost` without rolling
   * anything. The rite would be cleared even if no Constitution save existed.
   *
   * The route SRD's sentence is about is the other one: damage that leaves the
   * caster standing, a save rolled and failed, and *then* the spell failing
   * with no slot expended. That is what this drives, and it is the fixture the
   * design rests on.
   */
  it('rolls the save, fails it, and fails the spell with no slot spent', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);

    // **Forced rather than waited for.** The seeded die goes where it goes;
    // a modifier large enough to settle the roll outright is how the branch
    // that matters gets driven, which is the move `scenario.test.ts` makes to
    // land Hold Person.
    const hurt = unwrap(
      resolveDamage(open, WIZARD, { amount: 20, source: 'a falling beam' }, {
        ...supply('hurt'),
        bonuses: [{ source: 'the test insists the rite is lost', flat: -30 }],
      }),
      'damage',
    );

    // The save was genuinely rolled rather than skipped.
    expect(hurt.concentration.kind).toBe('resolved');
    expect(hurt.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    if (hurt.concentration.kind === 'resolved') {
      expect(hurt.concentration.maintained).toBe(false);
    }

    const after = fold('seed', [...SETUP, ...declared, ...hurt.events]);
    // And the caster is still on their feet, so nothing but the save ended it.
    expect(after.creatures.wizard!.vitals.hp).toBeGreaterThan(0);
    expect(pendingCastingsOf(after)).toEqual([]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(slots(after, 1)).toBe(4);
  });
});

describe('a casting in process is one caster’s, and stops nobody else', () => {
  /**
   * **Inverted.** These two tests pinned a limit of the record wearing a
   * rule's clothes: `castOrRelease` refused `casting_pending` while *any*
   * casting was open and named no caster, so during a ten-minute rite every
   * other creature's casting and activation was refused too. SRD lets the
   * cleric cast Cure Wounds while the wizard performs a Ritual, and nothing in
   * the book refuses a casting because somebody else is casting.
   *
   * The record is keyed by casting id now and the guard is gone, so what these
   * assert is the other direction: the second caster's spell simply happens,
   * nine minutes in as readily as at the start. What still stops a casting is
   * the real primitive in every case — the action economy, the turn's one
   * slot, and Concentration's single door — none of which has anything to say
   * about a *different* creature outside combat.
   */
  const COUNTERER: readonly GameEvent[] = [
    {
      type: 'resource-pool-declared',
      id: ALLY,
      pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: ALLY,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', cantrips: ['fire-bolt'] }),
    },
    { type: 'sight-declared', from: ALLY, to: FOE, seen: true },
  ];

  it('lets a second creature cast while the rite runs, and leaves the rite open', () => {
    const started = fold('seed', [...SETUP, ...COUNTERER]);
    const declared = unwrap(
      resolveSpell(
        started,
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'rite',
    );
    const log = [...SETUP, ...COUNTERER, ...declared.events];
    const open = fold('seed', log);

    const cleric = unwrap(
      resolveSpell(open, ALLY, { spellId: 'fire-bolt', targets: [FOE] }, supply('c')),
      'the ally casts while the wizard performs the rite',
    );

    // Two castings in the log, one still open: the ally's resolved in one
    // breath and did not touch the wizard's window.
    const after = fold('seed', [...log, ...cleric.events]);
    expect(pendingCastingsOf(after).map((c) => c.castingId)).toEqual([declared.castingId]);
    expect(after.creatures.wizard!.concentration?.castingId).toBe(declared.castingId);
  });

  /**
   * And it does not start refusing as the rite runs on: nine minutes in, the
   * answer is the same. A window measured in instants and a window measured in
   * minutes are the same record, which is the whole of the finding.
   */
  it('still lets them cast nine minutes into the rite', () => {
    const started = fold('seed', [...SETUP, ...COUNTERER]);
    const declared = unwrap(
      resolveSpell(
        started,
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'rite',
    );
    const open = fold('seed', [...SETUP, ...COUNTERER, ...declared.events]);
    const later = fold('seed', [
      ...SETUP,
      ...COUNTERER,
      ...declared.events,
      ...unwrap(advanceTime(open, 540, 'the rite'), 'tick'),
    ]);

    const cleric = resolveSpell(later, ALLY, { spellId: 'fire-bolt', targets: [FOE] }, supply('c'));
    expect(isErr(cleric) ? cleric.code : 'ok').toBe('ok');
  });

  /**
   * **What is already right, and must stay right.** `unsettledRefusal` and
   * `mayAct` carry every other engine debt and have never carried this one, so
   * a fighter swinging during a rite is legal play — which is the one thing
   * the single slot never got wrong. A task that narrows the casting guard
   * must not widen these.
   */
  it('lets a creature who is not casting act while the rite runs', () => {
    const started = fold('seed', [...SETUP, ...COUNTERER]);
    const declared = unwrap(
      resolveSpell(
        started,
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'rite',
    );
    const open = fold('seed', [...SETUP, ...COUNTERER, ...declared.events]);
    expect(pendingCastingsOf(open)).toHaveLength(1);

    // Movement is the cheapest thing to drive outside combat, and it is
    // authoritative: the creature really is somewhere else afterwards.
    const moved = unwrap(
      resolveMove(open, ALLY, { placement: { from: { creature: FOE }, feet: 5, bearing: 180 } }, supply('m')),
      'move',
    );
    expect(moved.events.some((e) => e.type === 'creature-moved')).toBe(true);
  });
});
