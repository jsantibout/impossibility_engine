import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { combineSpeed, movementLeftFor, speedOf } from './standing.js';
import { conditionState } from './conditions.js';
import { parseSpellDefinition } from './spell-schema.js';
import {
  applyConditionTo,
  endConcentration,
  mountCreature,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeDash,
} from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A Speed an effect changes — the fifth sourced grant.
 *
 * IE-031 gave the engine one reader for a creature's Speed and one order to
 * combine what moves it: *base, plus the flat changes, then halved once if any
 * halving effect applies, then 0 if any zeroing effect applies, never below
 * 0.* What it had no input for was an **effect**: a class feature could add
 * ten feet and no spell could touch a Speed at all, which is what
 * `speed-and-movement-modes` meant when it said the engine "holds that one
 * Speed and nothing modifies it".
 *
 * Three SRD sentences, one per member of the change vocabulary:
 *
 * > Longstrider: "The target's Speed **increases by 10 feet** until the spell
 * > ends." **Duration:** 1 hour.
 *
 * > Ray of Frost: "On a hit, it takes 1d8 Cold damage, and its Speed is
 * > **reduced by 10 feet** until the start of your next turn."
 * > **Duration:** Instantaneous.
 *
 * > Hypnotic Pattern: "While Charmed, the creature has the Incapacitated
 * > condition and **a Speed of 0**."
 *
 * Ray of Frost is why this is the first production writer of
 * `EffectTarget.grants`. The spell is a cantrip and Instantaneous, so there is
 * no casting for the reduction to belong to and nothing that could ever take
 * it off again — which is exactly the deadline IE-017 built that member for
 * and no runtime path had ever created.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const OTHER = id('other');
const HORSE = id('horse');

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

const slots: readonly GameEvent[] = [1, 3].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

const PREPARED = ['longstrider', 'ray-of-frost', 'hypnotic-pattern'];

/**
 * A Wisdom of 1 against a DC of 17: this pair fails every save these spells
 * ask for, so the tests are about what the Speed does rather than about which
 * way a die fell.
 */
const FRAIL = { str: 10, dex: 10, con: 10, int: 10, wis: 1, cha: 10 } as const;

const PLACED: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET, { abilities: FRAIL }),
  added(OTHER, { abilities: FRAIL }),
  added(HORSE, { baseSpeed: 60 }),
  ...slots,
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['ray-of-frost'], prepared: PREPARED }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  // Landmarks rather than bearings, because two of these fixtures turn on
  // exactly who a 30-foot Cube covers: the caster stands well clear of it, and
  // the pair it catches stand inside it.
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'the stable', at: { x: 105, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'the pair', at: { x: 125, y: 125, z: 0 } },
  { type: 'landmark-added', name: 'beside the pair', at: { x: 130, y: 125, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { landmark: 'the pair' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { landmark: 'beside the pair' }, feet: 0 },
  },
  {
    type: 'creature-placed',
    id: HORSE,
    // SRD Mounted Combat wants "a creature that is at least one size larger".
    placement: { from: { landmark: 'the stable' }, feet: 0, size: 'large' },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: OTHER, seen: true },
  { type: 'sight-declared', from: CASTER, to: HORSE, seen: true },
];

/** The caster acts first, so "your next turn" and "its next turn" differ. */
const SETUP: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
      { id: OTHER, initiative: 5, speed: 30 },
      { id: HORSE, initiative: 1, speed: 60 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'speed grants');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/** Advance to whoever is next, settling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

const whoseTurn = (state: GameState) => state.combat?.order[state.combat.turnIndex]?.id;

/**
 * A walk to a spot that many feet from the landmark the caster stands on.
 *
 * The *cost* is read off the resolution rather than assumed, because the
 * lattice decides it: what these fixtures are about is whether the allowance
 * the cost is measured against moved, and an arithmetic guess here would be a
 * fixture-supplied number nothing checks.
 */
const walk = (state: GameState, feet: number) =>
  resolveMove(
    state,
    CASTER,
    { placement: { from: { landmark: 'here' }, feet, bearing: 0 } },
    supply('walk'),
  );

describe('Longstrider adds its ten feet through the one reader', () => {
  /**
   * SRD Longstrider: "You touch a creature. The target's Speed increases by 10
   * feet until the spell ends." **Duration:** 1 hour, no Concentration.
   *
   * The point of `speedOf` being the one reader is that a grant reaches the
   * movement allowance, the Dash and the mounting cost together rather than
   * being applied three times or once.
   *
   * **The caster is the target**, which is the fixture Fable named while
   * deciding IE-031: "a Longstrider cast on the mover's own turn before they
   * move". Casting spends an Action, so only the creature whose turn it is can
   * cast — and a Speed raised in the middle of that same turn is exactly what
   * a stored remainder could not express.
   */
  const cast = (log: readonly GameEvent[] = SETUP) =>
    must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'longstrider', targets: [CASTER], slotLevel: 1 },
        supply('long'),
      ),
    );

  it('raises the Speed the engine reads', () => {
    const before = fold('seed', SETUP);
    expect(whoseTurn(before)).toBe(CASTER);
    expect(speedOf(before, CASTER)).toBe(30);

    const after = applyAll(before, cast().events);
    expect(speedOf(after, CASTER)).toBe(40);
  });

  it('raises the movement allowance for the turn', () => {
    const before = fold('seed', SETUP);
    expect(movementLeftFor(before, CASTER)).toBe(30);

    const after = applyAll(before, cast().events);
    expect(movementLeftFor(after, CASTER)).toBe(40);
  });

  it('raises what a Dash adds', () => {
    // SRD Dash: "an increase equal to your Speed after applying any
    // modifiers", so the grant is in the increase as well as in the base —
    // 40 and 40, against 30 and 30 with no spell in the air.
    const plain = fold('seed', SETUP);
    expect(movementLeftFor(applyAll(plain, must(takeDash(plain, CASTER, {}))), CASTER)).toBe(60);

    // A casting and a Dash are both Actions and a turn holds one, so the
    // spell goes up on this turn and the Dash comes a round later — which the
    // hour Longstrider runs for covers several thousand times over.
    let log: readonly GameEvent[] = [...SETUP, ...cast().events];
    for (let i = 0; i < 4; i += 1) log = nextTurn(log);
    const longer = fold('seed', log);
    expect(whoseTurn(longer)).toBe(CASTER);
    expect(speedOf(longer, CASTER)).toBe(40);
    expect(movementLeftFor(applyAll(longer, must(takeDash(longer, CASTER, {}))), CASTER)).toBe(80);
  });

  /**
   * The discriminating case: a move the base Speed cannot pay for and the
   * granted one can. A fixture that only read the allowance back would pass
   * against a grant that reached `movementLeftFor` and no further — and this
   * is the reducer's half as well, because folding the `movement-spent` event
   * re-derives the same allowance and would refuse what the command allowed.
   */
  it('lets a move spend feet the base Speed could not', () => {
    const plain = fold('seed', SETUP);

    const refused = walk(plain, 40);
    expect(isErr(refused) && refused.code).toBe('not_enough_movement');

    const longer = applyAll(plain, cast().events);
    const moved = must(walk(longer, 40));
    expect(moved.cost).toBeGreaterThan(30);
    expect(moved.cost).toBeLessThanOrEqual(40);
    // Folded, not merely returned: the reducer measures against `speedOf` too.
    expect(movementLeftFor(applyAll(longer, moved.events), CASTER)).toBe(40 - moved.cost);
  });

  it('raises the mounting cost, which is half the rider’s Speed', () => {
    const plain = fold('seed', SETUP);
    const mounted = applyAll(plain, must(mountCreature(plain, CASTER, HORSE, { willing: true })));
    expect(movementLeftFor(mounted, CASTER)).toBe(15);

    const longer = applyAll(plain, cast().events);
    const faster = applyAll(longer, must(mountCreature(longer, CASTER, HORSE, { willing: true })));
    // 40 feet of Speed, so half of it is 20 rather than 15 — and 20 left.
    expect(movementLeftFor(faster, CASTER)).toBe(20);
  });

  it('ends with the casting, and takes the ten feet with it', () => {
    const before = fold('seed', SETUP);
    const during = applyAll(before, cast().events);
    expect(speedOf(during, CASTER)).toBe(40);

    // An hour on the clock: the casting's own deadline, and no Concentration.
    const later = applyEvent(during, { type: 'time-advanced', seconds: 3600, reason: 'an hour' });
    expect(later.creatures[CASTER]?.speedModifiers).toEqual([]);
    expect(speedOf(later, CASTER)).toBe(30);
  });

  /**
   * Fable's note while deciding IE-031: the rejected alternative "cannot
   * express a Longstrider cast on the mover's own turn before they move, which
   * IE-033 meets on its first fixture". The budget stores what was **spent**
   * and derives the allowance at every read, so a Speed raised mid-turn is a
   * larger allowance now rather than a number fixed when the turn began.
   */
  it('reaches a turn already in progress, after movement has been spent', () => {
    const started = fold('seed', SETUP);

    const step = must(walk(started, 25));
    expect(step.cost).toBeGreaterThan(0);
    const walked = applyAll(started, step.events);
    expect(movementLeftFor(walked, CASTER)).toBe(30 - step.cost);

    const longer = applyAll(walked, cast([...SETUP, ...step.events]).events);
    expect(movementLeftFor(longer, CASTER)).toBe(40 - step.cost);
  });

  /**
   * The outcome reports the Speed the creature actually has, not the change
   * the definition asked for.
   *
   * `armorClass` is the precedent and the argument is the same one: a grant is
   * one input among several, and what a caller wants is what the creature can
   * do. Two cases are needed to say so, because against an unencumbered target
   * "the base plus ten" and "the resulting Speed" are the same number — which
   * is how a fixture that reported the delta would pass. SRD Grappled prints
   * "Your Speed is 0 **and can't increase**", so a Longstrider on a grappled
   * creature is ten feet added to a Speed the rules have already pinned.
   */
  it('reports the Speed the creature has, which a pinned one makes visible', () => {
    expect(cast().outcomes[0]?.speed).toBe(40);
    expect(cast().outcomes[0]?.affected).toBe(true);

    const grappled = applyAll(
      fold('seed', SETUP),
      must(applyConditionTo(fold('seed', SETUP), CASTER, 'grappled', 'the ogre')),
    );
    expect(speedOf(grappled, CASTER)).toBe(0);

    const out = must(
      resolveSpell(
        grappled,
        CASTER,
        { spellId: 'longstrider', targets: [CASTER], slotLevel: 1 },
        supply('long'),
      ),
    );
    expect(out.outcomes[0]?.speed).toBe(0);
  });

  it('spends its slot and puts the casting on the creature it sped up', () => {
    const before = fold('seed', SETUP);
    const spell = cast();
    const after = applyAll(before, spell.events);
    expect(remaining(after.creatures[CASTER]!.resources, spellSlotKey(1))).toBe(3);
    expect(spellOn(after, after.ongoing[spell.castingId!]!)).toEqual([CASTER]);
  });

  it('is a definition the engine executes rather than one it merely tracks', () => {
    const definition = SPELL_DEFINITIONS.find((d) => d.id === 'longstrider')!;
    expect(definition.effects).toEqual([{ kind: 'speed', change: 'add', feet: 10 }]);
    expect(definition.unmodelled).toBeUndefined();
  });
});

describe('Ray of Frost is the first production writer of a grants deadline', () => {
  /**
   * SRD Ray of Frost: "On a hit, it takes 1d8 Cold damage, and its Speed is
   * reduced by 10 feet **until the start of your next turn**."
   *
   * A cantrip is Instantaneous, so the casting is over the moment it resolves
   * and cannot own the reduction. `EffectTarget.grants` — every grant one
   * source made on one creature — is what ends it instead, and until now
   * nothing in the engine created one.
   */
  const ray = (log: readonly GameEvent[] = SETUP, seed = 'hit') =>
    must(resolveSpell(fold('seed', log), CASTER, { spellId: 'ray-of-frost', targets: [TARGET] }, supply(seed)));

  /**
   * The ray lands on every seed but a natural 1.
   *
   * A +9 spell attack (Intelligence 20 and a level 11 Proficiency Bonus)
   * against an unarmoured Armour Class of 10 cannot miss on the total, so the
   * fixture is about what the rider does rather than about which way a die
   * fell — and the assertion below is what says so rather than assuming it.
   */
  it('lands whatever the die shows, so the rider is always reached', () => {
    const rolled = ray().events.filter((e) => e.type === 'roll-recorded' && e.outcome === 'hit');
    expect(rolled).toHaveLength(1);
  });

  it('takes ten feet off the Speed on a hit', () => {
    const after = applyAll(fold('seed', SETUP), ray().events);
    expect(speedOf(after, TARGET)).toBe(20);
    expect(after.creatures[TARGET]?.speedModifiers).toHaveLength(1);
  });

  it('schedules the reduction against a grants target, not a casting', () => {
    const cast = ray();
    const scheduled = cast.events.filter((e) => e.type === 'effect-scheduled');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.target.kind).toBe('grants');

    const after = applyAll(fold('seed', SETUP), cast.events);
    // Instantaneous: nothing is ongoing, so the deadline is the only thing
    // that could ever take the reduction off.
    expect(Object.keys(after.ongoing)).toEqual([]);
    expect(Object.keys(after.timers)).toHaveLength(1);
  });

  it('lifts the reduction at the start of the caster’s next turn', () => {
    let log: readonly GameEvent[] = [...SETUP, ...ray().events];
    expect(speedOf(fold('seed', log), TARGET)).toBe(20);

    // Everybody else's turn first: the reduction stands throughout.
    for (const expected of [TARGET, OTHER, HORSE]) {
      log = nextTurn(log);
      expect(whoseTurn(fold('seed', log))).toBe(expected);
      expect(speedOf(fold('seed', log), TARGET)).toBe(20);
    }

    log = nextTurn(log);
    const round = fold('seed', log);
    expect(whoseTurn(round)).toBe(CASTER);
    expect(round.creatures[TARGET]?.speedModifiers).toEqual([]);
    expect(speedOf(round, TARGET)).toBe(30);
  });

  it('leaves the reduction on a target whose own turn came round first', () => {
    const log = nextTurn([...SETUP, ...ray().events]);
    const theirTurn = fold('seed', log);
    expect(whoseTurn(theirTurn)).toBe(TARGET);
    // Twenty feet of allowance, because the ray is still on them.
    expect(movementLeftFor(theirTurn, TARGET)).toBe(20);
  });

  /**
   * A turn-anchored rider cannot be pinned outside combat, and finding that
   * out after the attack has been rolled is too late — the generator has moved
   * for a casting that never happened. `riderDurations` gathers every deadline
   * a casting is going to need so the refusal comes first.
   *
   * **"It came back an error" is not the assertion, because it does either
   * way.** Without the pre-flight the ray still fails: it rolls the attack,
   * deals the damage and *then* fails to schedule the reduction. What
   * separates the two is the **code** — `no_turns` rather than a refusal from
   * somewhere inside the resolution — and the generator, which is the rule
   * this engine calls "validate before rolling". So the fixture holds **one**
   * `Rng` across the call; a fresh one per call, which is what `supply()`
   * builds, could never have said so. A second `fold` of the same log could
   * not either: two folds of one list are equal whatever happened.
   *
   * **And it asks rather than refusing**, which IE-046 made the difference the
   * code alone no longer carries: a turn timeline is a thin record, so the
   * answer names `beginCombat` and the caller casts again unchanged. The
   * pre-flight claim now rests on the request as well as on the generator.
   */
  it('asks for a turn order outside combat rather than rolling and then failing', () => {
    const rng = createRng('hit') as Rng;
    const before = rng.snapshot();
    const asked = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'ray-of-frost', targets: [TARGET] },
      { issuer: createRollIssuer('r'), rng, content: SRD_CONTENT },
    );
    expect(isErr(asked) && asked.code).toBe('no_turns');
    expect(isNeedsContext(asked)).toBe(true);
    expect(contextRequestsOf(asked).map((r) => r.kind)).toEqual(['turn-order']);
    expect(contextRequestsOf(asked)[0]?.satisfyWith).toContain('beginCombat');
    expect(rng.snapshot()).toEqual(before);
  });
});

describe('Hypnotic Pattern holds its targets at a Speed of 0', () => {
  /**
   * SRD: "Each creature in the area who can see the pattern must succeed on a
   * Wisdom saving throw or have the Charmed condition for the duration. While
   * Charmed, the creature has the Incapacitated condition **and a Speed of
   * 0**."
   *
   * One save, three consequences — so the Speed is a rider on the same failure
   * rather than a second effect that would ask for a second save.
   */
  const pattern = (log: readonly GameEvent[] = SETUP) =>
    must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        {
          spellId: 'hypnotic-pattern',
          targets: [],
          // A Cube excludes its own point of origin, so the origin sits a
          // space short of the pair and the template covers them both.
          at: { x: 120, y: 120, z: 0 },
          towards: { x: 200, y: 200, z: 0 },
          slotLevel: 3,
        },
        supply('pattern'),
      ),
    );

  it('sets the Speed to 0 on a failed save, beside the Charmed', () => {
    const after = applyAll(fold('seed', SETUP), pattern().events);
    expect(after.creatures[TARGET]?.conditions.conditions).toContain('charmed');
    expect(after.creatures[TARGET]?.conditions.conditions).toContain('incapacitated');
    expect(speedOf(after, TARGET)).toBe(0);
  });

  it('lifts the Speed with the casting', () => {
    const during = applyAll(fold('seed', SETUP), pattern().events);
    expect(speedOf(during, TARGET)).toBe(0);

    const ended = applyAll(during, must(endConcentration(during, CASTER, 'voluntary')));
    expect(ended.creatures[TARGET]?.conditions.conditions).toEqual([]);
    expect(ended.creatures[TARGET]?.speedModifiers).toEqual([]);
    expect(speedOf(ended, TARGET)).toBe(30);
  });

  it('releases one creature and leaves the other held', () => {
    const cast = pattern();
    const during = applyAll(fold('seed', SETUP), cast.events);
    expect(speedOf(during, TARGET)).toBe(0);
    expect(speedOf(during, OTHER)).toBe(0);

    const freed = applyEvent(during, {
      type: 'spell-ended',
      castingId: cast.castingId!,
      on: TARGET,
      reason: 'dispelled',
    });
    expect(speedOf(freed, TARGET)).toBe(30);
    expect(speedOf(freed, OTHER)).toBe(0);
  });
});

describe('the order of a Speed is presence, then arithmetic, then zero', () => {
  const none = conditionState();

  /**
   * SRD writes no order, so IE-031 decided one and this is the half it could
   * not reach: *base, plus the flat changes, then halved once if any halving
   * effect applies, then 0 if any zeroing effect applies, never below 0.*
   */
  it('halves once however many halvings apply', () => {
    expect(combineSpeed(30, 0, 1, false, none)).toBe(15);
    expect(combineSpeed(30, 0, 2, false, none)).toBe(15);
    expect(combineSpeed(30, 0, 5, false, none)).toBe(15);
  });

  it('lets a zero beat an addition, however large', () => {
    expect(combineSpeed(30, 100, 0, true, none)).toBe(0);
    expect(combineSpeed(30, 100, 1, true, none)).toBe(0);
  });

  /** Two granted halvings on one creature are one halving, through `speedOf`. */
  it('counts two granted halvings as one, and a granted zero as final', () => {
    const world = applyAll(fold('seed', SETUP), [
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Slow#cast:1', change: 'halve' },
      },
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Slow#cast:2', change: 'halve' },
      },
    ]);
    expect(speedOf(world, TARGET)).toBe(15);

    const added = applyEvent(world, {
      type: 'speed-modifier-granted',
      id: TARGET,
      modifier: { source: 'Longstrider#cast:3', change: 'add', feet: 10 },
    });
    // 30 + 10, halved once.
    expect(speedOf(added, TARGET)).toBe(20);

    const stopped = applyEvent(added, {
      type: 'speed-modifier-granted',
      id: TARGET,
      modifier: { source: 'Hypnotic Pattern#cast:4', change: 'zero' },
    });
    expect(speedOf(stopped, TARGET)).toBe(0);
  });

  /** Re-granting from the same source replaces rather than stacking. */
  it('replaces a grant from a source that has already granted one', () => {
    const once = applyEvent(fold('seed', SETUP), {
      type: 'speed-modifier-granted',
      id: TARGET,
      modifier: { source: 'Longstrider#cast:1', change: 'add', feet: 10 },
    });
    const twice = applyEvent(once, {
      type: 'speed-modifier-granted',
      id: TARGET,
      modifier: { source: 'Longstrider#cast:1', change: 'add', feet: 10 },
    });
    expect(twice.creatures[TARGET]?.speedModifiers).toHaveLength(1);
    expect(speedOf(twice, TARGET)).toBe(40);
  });
});

describe('a definition may not leave a Speed with nothing to end it', () => {
  /**
   * `checkGrantLifetimes` already refused a `buff`, a granted `roll-mode`, an
   * `armor-class`, a granted defence and a condition rider with no deadline on
   * a casting that is over the moment it resolves. A Speed rider is the sixth
   * thing that can be left standing, and the **first** whose escape is a
   * deadline of its own rather than the casting's.
   */
  const instantaneous = (effects: readonly unknown[]) => ({
    id: 'homebrew-chill',
    name: 'Homebrew Chill',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets: { count: 1 },
    effects,
  });

  /**
   * The **standalone** kind, which carries no `lasts` and therefore has only
   * the one escape: a casting that persists.
   *
   * Its own case rather than the rider's, and it needs a definition that is
   * otherwise **well formed** — every other fixture here reaches
   * `bad_speed_change` first, and a sweep asserting only "it refused" is
   * satisfied by the shape error. So a mutation returning `null` for this kind
   * survived every one of them, which is the branch-covered-by-nothing this
   * repository keeps finding.
   */
  it('refuses a Speed effect on a casting that is over when it resolves', () => {
    const parsed = parseSpellDefinition(
      instantaneous([{ kind: 'speed', change: 'add', feet: 10 }]),
    );
    expect(isErr(parsed)).toBe(true);
    expect(isErr(parsed) && parsed.code).toBe('grant_without_lifetime');
  });

  /** And the same effect on a casting with an hour to run is fine. */
  it('accepts a Speed effect on a casting that runs', () => {
    const parsed = parseSpellDefinition({
      ...instantaneous([{ kind: 'speed', change: 'add', feet: 10 }]),
      durationSeconds: 3600,
    });
    expect(isErr(parsed)).toBe(false);
  });

  it('refuses a Speed rider with no deadline on an instantaneous casting', () => {
    const parsed = parseSpellDefinition(
      instantaneous([
        {
          kind: 'attack',
          attack: 'ranged',
          damage: { dice: '1d8' },
          damageType: 'cold',
          modifiers: [{ kind: 'speed-change', change: 'add', feet: -10 }],
        },
      ]),
    );
    expect(isErr(parsed)).toBe(true);
    expect(isErr(parsed) && parsed.code).toBe('grant_without_lifetime');
  });

  it('accepts the same rider once it says how long it lasts', () => {
    const parsed = parseSpellDefinition(
      instantaneous([
        {
          kind: 'attack',
          attack: 'ranged',
          damage: { dice: '1d8' },
          damageType: 'cold',
          modifiers: [
            { kind: 'speed-change', change: 'add', feet: -10, lasts: 'start-of-casters-next-turn' },
          ],
        },
      ]),
    );
    expect(isErr(parsed)).toBe(false);
  });

  it('reports a Speed rider behind one that is fine', () => {
    const parsed = parseSpellDefinition(
      instantaneous([
        {
          kind: 'attack',
          attack: 'ranged',
          damage: { dice: '1d8' },
          damageType: 'cold',
          modifiers: [
            { kind: 'speed-change', change: 'zero', lasts: 'end-of-casters-next-turn' },
            { kind: 'speed-change', change: 'halve' },
          ],
        },
      ]),
    );
    expect(isErr(parsed)).toBe(true);
  });

  it('refuses feet on a change that names none, and demands them on one that does', () => {
    const noFeet = parseSpellDefinition(
      instantaneous([{ kind: 'speed', change: 'add' }]),
    );
    expect(isErr(noFeet) && noFeet.code).toBe('bad_speed_change');

    const spareFeet = parseSpellDefinition(
      instantaneous([{ kind: 'speed', change: 'zero', feet: 10 }]),
    );
    expect(isErr(spareFeet) && spareFeet.code).toBe('bad_speed_change');
  });

  it('refuses a change the vocabulary does not have', () => {
    const doubled = parseSpellDefinition(instantaneous([{ kind: 'speed', change: 'double' }]));
    expect(isErr(doubled) && doubled.code).toBe('bad_speed_change');
  });
});

/**
 * The zero-user guard the format sweep cannot reach.
 *
 * `spell-schema.test.ts` sweeps every member of every type declared in
 * `spell-definitions.ts` and reports the ones no definition writes. A
 * vocabulary the *rules* own and the format borrows — `DefenseKind` is the
 * precedent — is outside that population, so `SpeedChange`'s members would
 * accumulate in silence. This is that sweep, over this union, derived from the
 * declaration rather than listed.
 */
describe('every member of the change vocabulary has a user or a written reason', () => {
  const source = readFileSync(fileURLToPath(new URL('./standing.ts', import.meta.url)), 'utf8');

  /**
   * A member no definition writes, and the written reason it stays anyway.
   *
   * Held to the two rules the format's own exemptions are held to: one whose
   * member has found a user fails, and one whose member the union no longer
   * declares fails too.
   */
  const EXEMPT: Readonly<Record<string, string>> = {};

  const declared = (): readonly string[] => {
    const match = /export type SpeedChange =([\s\S]*?);/.exec(source);
    if (match === null) throw new Error('standing.ts declares no SpeedChange');
    return [...match[1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
  };

  const written = (): ReadonlySet<string> => {
    const found = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'change' && typeof value === 'string') found.add(value);
        walk(value);
      }
    };
    SPELL_DEFINITIONS.forEach(walk);
    return found;
  };

  it('declares the four the SRD writes and no more', () => {
    expect(declared()).toEqual(['add', 'halve', 'zero', 'match-walk']);
  });

  it('writes every member from some definition, or says why not', () => {
    const used = written();
    expect(declared().filter((member) => !used.has(member) && !(member in EXEMPT))).toEqual([]);
  });

  it('keeps no exemption for a member something now writes', () => {
    const used = written();
    expect(Object.keys(EXEMPT).filter((member) => used.has(member))).toEqual([]);
  });

  it('names a member the union still declares', () => {
    const members = new Set(declared());
    expect(Object.keys(EXEMPT).filter((member) => !members.has(member))).toEqual([]);
  });

  /**
   * `halve` was exempt until Spirit Guardians wrote it, on the reason that the
   * spell the SRD prints it in — Slow, "An affected target’s Speed is halved"
   * — was blocked on other shapes and had no definition. The pin said "the
   * day Slow lands is the day this test says so", and **this is that day**:
   * `save.condition` became optional, the failure that halves the Speed found
   * a host, and the assertion is turned round to hold the arrival rather than
   * the absence.
   */
  it('pins that the spell printing a halved Speed now writes it off its own save', () => {
    const slow = SPELL_DEFINITIONS.find((d) => d.id === 'slow');
    expect(slow?.effects).toEqual([
      expect.objectContaining({
        kind: 'save',
        modifiers: expect.arrayContaining([{ kind: 'speed-change', change: 'halve' }]),
      }),
    ]);
    expect(slow?.effects.every((effect) => !('condition' in effect))).toBe(true);
  });

  /**
   * The sweep is not vacuous: `add` is written as a **change** rather than
   * merely resolvable.
   *
   * The format sweep's probe for a top-level union is `*='add'`, which any
   * definition writing `direction: 'add'` already satisfies — Bless does. So a
   * sweep over values alone could not tell a real user from a collision, and
   * this is the assertion that can.
   */
  it('finds the definitions that write each member it calls used', () => {
    const usedBy = (member: string): readonly string[] =>
      SPELL_DEFINITIONS.filter((definition) =>
        JSON.stringify(definition).includes(`"change":"${member}"`),
      ).map((definition) => definition.id);

    // SRD Fly, "a Fly Speed of 60 feet", joined the two the walking Speed
    // already had: a mode-named addition is the same operation, in one of the
    // other four Speeds.
    expect(usedBy('add')).toEqual(['fly', 'longstrider', 'ray-of-frost']);
    expect(usedBy('zero')).toEqual(['hypnotic-pattern']);
    // SRD Spider Climb, "a Climb Speed equal to its Speed" — the member that
    // exists because the number is the target's own and no definition could
    // print it.
    expect(usedBy('match-walk')).toEqual(['spider-climb']);
    // SRD Spirit Guardians, "Any other creature's Speed is halved in the
    // Emanation" — written as `areaStanding` rather than as an effect, because
    // it is derived from where a creature stands and granted to nobody.
    // SRD Slow, "An affected target's Speed is halved" — a rider on a failed
    // save that imposes no condition, which is the sentence `halve` was
    // derived from and the last one able to write it.
    expect(usedBy('halve')).toEqual(['slow', 'spirit-guardians']);
  });
});
