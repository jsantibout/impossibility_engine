import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { type SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { castingOf } from './commands/spell-resolution.js';
import {
  advanceTime,
  endConcentration,
  resolveCast,
  resolveDamage,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  removeCreatureEverywhere,
  resolveTurn,
  beginCombat,
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
 * **In combat the refusal stands.** SRD's per-turn Magic-action obligation is a
 * state machine on top of the caster's turns, and the engine has none; the
 * refusal names it rather than pretending the deadline is the whole rule.
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
 * time and the seconds directly — because **no definition in the catalogue
 * declares a long casting time yet**: IE-036 writes the twelve spells this
 * unblocks. The mechanism is the same one a ritual reaches through
 * `resolveSpell`, and both are driven here.
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

    expect(after.pendingCasting?.spell).toBe('Comprehend Languages');
    expect(after.pendingCasting?.completesAt).toEqual({ kind: 'elapsed', at: 60 });
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
      after.pendingCasting?.castingId,
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

    const early = resolveDeclaredCast(open, supply());
    expect(isErr(early) && early.code).toBe('still_casting');

    const ticked = fold('seed', [
      ...SETUP,
      ...declared,
      ...unwrap(advanceTime(open, 60, 'the incantation'), 'tick'),
    ]);
    const settled = unwrap(resolveDeclaredCast(ticked, supply()), 'settle');
    const done = fold('seed', [
      ...SETUP,
      ...declared,
      ...unwrap(advanceTime(open, 60, 'the incantation'), 'tick'),
      ...settled.events,
    ]);

    expect(done.pendingCasting).toBeNull();
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

    expect(after.pendingCasting).toBeNull();
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(slots(after, 1)).toBe(4);
  });

  /** And a caster who simply stops casting drops the casting with it. */
  it('clears the casting when the caster gives up the Concentration', () => {
    const declared = unwrap(declareLong(), 'declare');
    const open = world(declared);
    const stopped = unwrap(endConcentration(open, WIZARD, 'voluntary'), 'stop');
    expect(fold('seed', [...SETUP, ...declared, ...stopped]).pendingCasting).toBeNull();
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
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), supply()), 'settle');

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
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), supply()), 'settle');

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

  /** And nothing is spent by the refusal — no casting is left standing open. */
  it('leaves no casting open when the duration is refused', () => {
    const before = world();
    expect(isErr(declareLong(SETUP, { duration: { kind: 'seconds', seconds: -1 } }))).toBe(true);
    expect(world()).toEqual(before);
    expect(before.pendingCasting).toBeNull();
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
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), supply()), 'settle');
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

describe('in combat the refusal stands, and says what is missing', () => {
  const fighting = (): GameState => {
    const begun = unwrap(
      beginCombat(world(), [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ]),
      'combat',
    );
    return world(begun);
  };

  it('refuses a casting time of a minute or more while a fight is running', () => {
    const out = resolveCast(fighting(), WIZARD, {
      spell: 'Comprehend Languages',
      level: 1,
      slotLevel: 1,
      castingTime: 'long',
      castingSeconds: 60,
      hold: { spellId: 'comprehend-languages', targets: [], unverified: [] },
    });
    expect(isErr(out) && out.code).toBe('unsupported_casting_time');
    expect(isErr(out) && out.reason).toContain('Magic action');
  });

  /**
   * A casting declared before the fight and still open when it starts is the
   * deferred half arriving from the other side. The turn refuses to advance
   * past it exactly as it refuses any declared casting — and the way out is
   * the way in: the clock, or the caster breaking off.
   */
  it('refuses to advance a turn past a casting declared before the fight', () => {
    const declared = unwrap(declareLong(), 'declare');
    const begun = unwrap(
      beginCombat(world(declared), [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ]),
      'combat',
    );
    const log = [...SETUP, ...declared, ...begun];
    const refused = resolveTurn(fold('seed', log), supply());
    expect(isErr(refused) && refused.code).toBe('casting_pending');

    const stopped = unwrap(endConcentration(fold('seed', log), WIZARD, 'voluntary'), 'stop');
    expect(fold('seed', [...log, ...stopped]).pendingCasting).toBeNull();
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
    expect(world(declared.events).pendingCasting?.completesAt).toEqual({
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
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), supply()), 'settle');

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
    const castingId = open.pendingCasting!.castingId;
    expect(open.creatures.wizard!.concentration?.castingId).toBe(castingId);

    const tick = unwrap(advanceTime(open, 600, 'the rite'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), supply()), 'settle');

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
    expect(open.pendingCasting?.spell).toBe('Comprehend Languages');

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

describe('a Ritual adds ten minutes, and no catalogue spell can tell you so', () => {
  /**
   * SRD: "The Ritual version of a spell takes 10 minutes longer to cast **than
   * normal**." Longer than normal, not ten minutes flat — and every one of the
   * ten definitions that carries the Ritual tag prints "Action or Ritual", so
   * none of them has a casting time of its own to be longer than. For all ten,
   * "0 + 600" and "600" are the same number, and a mutation replacing the sum
   * with the constant survives the entire suite.
   *
   * SRD Alarm prints "1 minute or Ritual" and its Ritual version therefore
   * takes **660** seconds. Nothing in the catalogue defines it — IE-036 writes
   * the twelve spells a long casting time unblocks — and `castingOf` is pure
   * over a definition, so the definition is simply built. That is the move
   * `restoreOn`'s dawn-recovering pool already makes for a branch no class can
   * reach: a guard nothing can reach is not a rule, and a pure function will
   * take a fixture that reaches it.
   */
  const ALARM: SpellDefinition = {
    id: 'alarm',
    name: 'Alarm',
    level: 1,
    school: 'abjuration',
    castingTime: 'long',
    castingSeconds: 60,
    ritual: true,
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 28_800,
    unmodelled: ['an alarm is the DM’s to sound'],
  };

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

  /** The fixture is a coherent definition, so the rule is not being tested against junk. */
  it('is a definition the validator accepts', () => {
    expect(checkSpellDefinition(ALARM)).toEqual([]);
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
    expect(open.creatures.wizard!.concentration?.castingId).toBe(open.pendingCasting?.castingId);

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
    expect(after.pendingCasting).toBeNull();
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
    expect(after.pendingCasting).toBeNull();
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
    expect(after.pendingCasting).toBeNull();
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(slots(after, 1)).toBe(4);
  });
});

describe('a casting in process is one engine-wide, which is the record and not the rule', () => {
  /**
   * **This is a limit of the record, not a rule of the SRD**, and it is pinned
   * here so that whoever removes the limit deletes a test rather than
   * discovering a comment.
   *
   * `castOrRelease` refuses `casting_pending` while any casting is open, and
   * it names no caster. That guard was written for the Counterspell window,
   * which is open for an instant under one caller's control — and its whole
   * content is refusing the second `spell-declared` the reducer would throw
   * on, because `unsettledRefusal` has **never** carried `pendingCasting`: a
   * fighter attacks, a rogue moves and anybody Dodges while one stands. A
   * casting of a minute or more makes that instant ten minutes of game time,
   * and the guard now reaches every other creature's casting and activation
   * for the whole rite.
   *
   * SRD lets the cleric cast Cure Wounds while the wizard performs a Ritual.
   * A queued task replaces the single slot with one keyed by casting id, the
   * reducer enforcing one open casting per *caster*; until then this is what
   * the engine does, asserted rather than described.
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

  it('refuses a second creature’s casting for the whole rite, and costs them nothing', () => {
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

    const cleric = resolveSpell(open, ALLY, { spellId: 'fire-bolt', targets: [FOE] }, supply('c'));
    expect(isErr(cleric) && cleric.code).toBe('casting_pending');

    // Nothing is spent by the refusal — no action, no die, no state change.
    expect(open.rollsIssued).toBe(0);
    expect(open.rng).toBeNull();
    expect(fold('seed', [...SETUP, ...COUNTERER, ...declared.events])).toEqual(open);
  });

  /**
   * And it does not relent as the rite runs on: nine minutes in, the answer is
   * the same. A window measured in instants and a window measured in minutes
   * are the same guard, which is the whole of the finding.
   */
  it('still refuses them nine minutes into the rite', () => {
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
    expect(isErr(cleric) && cleric.code).toBe('casting_pending');
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
    expect(open.pendingCasting).not.toBeNull();

    // Movement is the cheapest thing to drive outside combat, and it is
    // authoritative: the creature really is somewhere else afterwards.
    const moved = unwrap(
      resolveMove(open, ALLY, { placement: { from: { creature: FOE }, feet: 5, bearing: 180 } }, supply('m')),
      'move',
    );
    expect(moved.events.some((e) => e.type === 'creature-moved')).toBe(true);
  });
});
