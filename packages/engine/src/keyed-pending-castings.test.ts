import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  beginCombat,
  pendingCastingsBy,
  pendingCastingsOf,
  reactionOpportunities,
  removeCreatureEverywhere,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

/**
 * Several castings may be open at once, and a casting id is what names one.
 *
 * The engine held **one** pending casting, engine-wide, and refused every
 * other creature's casting and activation while it stood. IE-034 recorded that
 * as a structural accident rather than a rule: the guard was written for the
 * Counterspell window, which is open for an instant under one caller's
 * control, and a casting of a minute or more made that instant ten minutes.
 *
 * Verified against SRD 5.2.1 sentence by sentence, because deleting a refusal
 * has to delete no rule:
 *
 * - *Longer Casting Times* (`spells.md`): "you must take the Magic action on
 *   **each of your turns**, and you must maintain Concentration while you do
 *   so. If your Concentration is broken, the spell fails, but **you don't
 *   expend a spell slot**." The obligation is on the caster's own turns, and
 *   the slot is unspent until the casting completes.
 * - *Concentration* (`rules-glossary.md`): "You lose Concentration on an
 *   effect the moment you start casting a spell **that requires
 *   Concentration**." Shield and Counterspell require none.
 * - *Reaction* (`rules-glossary.md`): "You can take a Reaction on **another
 *   creature's turn**."
 * - *One slot a turn* (`spells.md`): "On a turn, you can expend only one spell
 *   slot to cast a spell." It reads *expenditure*, and a pending casting has
 *   expended none.
 *
 * So a wizard mid-rite may legally cast Shield as a Reaction when attacked,
 * which is the invariant this file exists for: **two pending castings, one
 * caster**, no nesting and no unbuilt mechanic.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const ENEMY = id('enemy');
const FOE = id('foe');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slotsFor = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  );

const PREPARED = [
  'hold-person',
  'bless',
  'shield',
  'counterspell',
  'comprehend-languages',
  'healing-word',
];

const CASTERS = [WIZARD, ALLY, ENEMY];
const EVERYONE = [WIZARD, ALLY, ENEMY, FOE];

const TABLE: readonly GameEvent[] = [
  ...EVERYONE.map(added),
  ...CASTERS.flatMap(slotsFor),
  ...CASTERS.map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        cantrips: ['fire-bolt'],
        prepared: PREPARED,
      }),
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: ENEMY,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: FOE,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 180 },
  },
  ...EVERYONE.flatMap((from) =>
    EVERYONE.filter((to) => to !== from).map(
      (to): GameEvent => ({ type: 'sight-declared', from, to, seen: true }),
    ),
  ),
];

const supply = (seed = 'cast', flat = 0) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'the test insists', flat }],
});

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...TABLE, ...extra]);

const slotsLeft = (state: GameState, who: CharacterId, level: number) =>
  remaining(state.creatures[who]!.resources, spellSlotKey(level));

/** A hit already rolled and held between its two rolls, so Shield has a trigger. */
const landedOn = (target: CharacterId, attacker: CharacterId): GameEvent => ({
  type: 'attack-landed',
  attack: {
    attacker,
    target,
    weapon: 'longsword',
    twoHanded: false,
    thrown: false,
    critical: false,
    ability: 'str',
    targetAc: 10,
    total: 12,
    natural: 11,
  },
});

const holdPerson = (state: GameState, who: CharacterId, seed: string) =>
  resolveSpell(
    state,
    who,
    { spellId: 'hold-person', targets: [FOE], slotLevel: 2, hold: true },
    supply(seed),
  );

const bless = (state: GameState, who: CharacterId, seed: string) =>
  resolveSpell(
    state,
    who,
    { spellId: 'bless', targets: [ALLY], slotLevel: 1, hold: true },
    supply(seed),
  );

/** Two castings held open by two different creatures. */
const twoCasters = () => {
  const first = unwrap(holdPerson(world(), WIZARD, 'a'), 'first');
  const second = unwrap(bless(world(first.events), ENEMY, 'b'), 'second');
  return {
    firstId: first.castingId,
    secondId: second.castingId,
    log: [...first.events, ...second.events],
  };
};

describe('two creatures hold two castings open at once', () => {
  /**
   * SRD lets the cleric cast Cure Wounds while the wizard performs a Ritual.
   * Nothing in the book refuses a casting because somebody else is casting,
   * and the engine's refusal corresponded to no rule at all.
   */
  it('keys both records by their own casting ids', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);

    expect(Object.keys(open.pendingCastings)).toEqual([firstId, secondId]);
    expect(open.pendingCastings[firstId]?.caster).toBe(WIZARD);
    expect(open.pendingCastings[secondId]?.caster).toBe(ENEMY);
  });

  /**
   * **Casting-number order, whatever order they were declared in.** The record
   * reaches serialised state, so an order that depended on which caster went
   * first would be a fold that is not a pure function of the log's content.
   * `castingsEnded` already sorts this way, and this is the same sort.
   */
  it('keeps the record and the query in casting-number order', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);

    expect(pendingCastingsOf(open).map((c) => c.castingId)).toEqual([firstId, secondId]);
    const keys = Object.keys(open.pendingCastings);
    expect(keys).toEqual(
      [...keys].sort(
        (a, b) => Number(a.slice('cast:'.length)) - Number(b.slice('cast:'.length)),
      ),
    );
  });

  it('settles each by its own id, leaving the other standing', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);

    const settledSecond = unwrap(
      resolveDeclaredCast(open, secondId, supply('settle-b')),
      'settle the second',
    );
    const between = world([...log, ...settledSecond.events]);

    expect(Object.keys(between.pendingCastings)).toEqual([firstId]);
    // The one that settled spent its slot; the one still open has not.
    expect(slotsLeft(between, ENEMY, 1)).toBe(3);
    expect(slotsLeft(between, WIZARD, 2)).toBe(4);

    const settledFirst = unwrap(
      resolveDeclaredCast(between, firstId, supply('settle-a', -40)),
      'settle the first',
    );
    const done = world([...log, ...settledSecond.events, ...settledFirst.events]);
    expect(done.pendingCastings).toEqual({});
    expect(slotsLeft(done, WIZARD, 2)).toBe(3);
  });

  /**
   * A Counterspell answers one of the two and the other is untouched. The
   * casting it answers is named by its id, because with several open a lookup
   * by caster is ambiguous and the engine never picks between candidates — the
   * rule `eligibleTargets` obeys for targeting.
   */
  it('answers one with a Counterspell while the other stands', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);

    const countered = unwrap(
      resolveSpell(
        open,
        ALLY,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3, answers: secondId },
        supply('counter', -40),
      ),
      'counterspell',
    );
    const after = world([...log, ...countered.events]);

    expect(Object.keys(after.pendingCastings)).toEqual([firstId]);
    // SRD: "the slot isn't expended."
    expect(slotsLeft(after, ENEMY, 1)).toBe(4);
    // And the other casting is exactly where it was.
    expect(after.pendingCastings[firstId]).toEqual(open.pendingCastings[firstId]);
  });

  /**
   * **A named id does not license a substitution.** SRD Counterspell forces
   * its target — "a creature in the process of casting a spell" — so a command
   * naming one creature and another creature's casting is refused rather than
   * quietly aiming at whichever the id belongs to. Without this the save would
   * be rolled against the *target*, range and sight checked against the
   * target, and a **third** creature's casting interrupted: the one place a
   * Reaction could smuggle in a substitution, which is what `eligibleTargets`
   * draws the line against everywhere else.
   *
   * Only an id belonging to somebody other than the target can tell the guard
   * apart from no guard at all, which is why the fixture needs two casters.
   */
  it('refuses a Counterspell naming one creature and another’s casting', () => {
    const { firstId, log } = twoCasters();
    const open = world(log);

    const crossed = resolveSpell(
      open,
      ALLY,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3, answers: firstId },
      supply('counter', -40),
    );
    expect(isErr(crossed) && crossed.code).toBe('forced_target');
    if (isErr(crossed)) expect(crossed.reason).toContain(WIZARD);

    // Nothing spent, and both castings are exactly where they were.
    expect(slotsLeft(open, ALLY, 3)).toBe(4);
    expect(world(log)).toEqual(open);
  });

  /**
   * A casting id that is no longer open is the **moment having passed** — it
   * settled, or somebody else already interrupted it — so the answer is
   * `no_trigger` and there is nothing to re-send. Deleting this branch is not
   * merely a changed code: the next line reads the record's caster and would
   * throw a `TypeError` out of a command whose refusals are values.
   */
  it('refuses a Counterspell naming a casting that has already settled', () => {
    const { firstId, secondId, log } = twoCasters();
    const settled = unwrap(
      resolveDeclaredCast(world(log), secondId, supply('settle-b')),
      'settle the second',
    );
    const after = [...log, ...settled.events];
    // One casting is still open, so this is the named id being gone rather
    // than there being nothing to answer at all.
    expect(Object.keys(world(after).pendingCastings)).toEqual([firstId]);

    const late = resolveSpell(
      world(after),
      ALLY,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3, answers: secondId },
      supply('counter', -40),
    );
    expect(isErr(late) && late.code).toBe('no_trigger');
    if (isErr(late)) expect(late.reason).toContain(secondId);
  });

  /**
   * And with no id named, the forced target has to be exactly one creature:
   * the casting is resolved *from* the target, so two of them name two
   * different castings and the engine picks neither.
   *
   * **Two targets rather than none**, which is the discriminating half. With
   * none, dropping the guard makes the filter below match nobody and answer
   * `forced_target` anyway — the same code for a different reason, which a
   * mutation run showed passing. With two, dropping it silently resolves the
   * **first** creature's casting and carries on, so only the guard gives this
   * answer.
   */
  it('refuses a Counterspell that names two creatures to interrupt', () => {
    const { log } = twoCasters();
    const vague = resolveSpell(
      world(log),
      ALLY,
      { spellId: 'counterspell', targets: [ENEMY, WIZARD], slotLevel: 3 },
      supply('counter', -40),
    );
    expect(isErr(vague) && vague.code).toBe('forced_target');
    if (isErr(vague)) expect(vague.reason).toContain('name which');
  });

  /** Every open casting is offered to every creature but its own caster. */
  it('offers a Reaction against every casting that is open', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);

    const offered = reactionOpportunities(open).filter((o) => o.window === 'casting-a-spell');
    expect(
      offered
        .filter((o) => o.reactor === ALLY)
        .map((o) => o.casting)
        .sort(),
    ).toEqual([firstId, secondId].sort());
    // Never against your own casting.
    expect(offered.some((o) => o.reactor === WIZARD && o.casting === firstId)).toBe(false);
    expect(offered.some((o) => o.reactor === ENEMY && o.casting === secondId)).toBe(false);
  });
});

describe('two pending castings belonging to one caster', () => {
  /**
   * **The invariant test.** A wizard mid-rite is attacked and casts Shield as
   * a Reaction, held open. Two pending records, one caster, and every SRD
   * sentence quoted at the top of this file says so: the rite's obligation is
   * on the wizard's own turn, Shield requires no Concentration, and neither
   * casting has expended a slot.
   *
   * **The rite is declared outside combat and the fight starts around it**,
   * which is the only arrangement that needs no unbuilt mechanic. A long
   * casting *begun* in combat is still refused — the per-turn Magic-action
   * obligation is IE-041's, and nothing here exercises it, because the turn
   * never advances. And Shield cannot be cast outside combat at all: its
   * "until the start of your next turn" is turn-anchored, and
   * `resolveDuration` refuses rather than inventing six seconds. That refusal
   * is pre-existing and has nothing to do with this record.
   *
   * The rite still settles on the clock, through `advanceTime` — which is not
   * gated on combat and is exactly the instrument CLAUDE.md already names for
   * a casting declared before a fight.
   */
  const bothOpen = () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply('rite'),
      ),
      'rite',
    );
    const begun = unwrap(
      beginCombat(world(declared.events), [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 15, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ]),
      'combat',
    );
    const hit = landedOn(WIZARD, FOE);
    const before = world([...declared.events, ...begun, hit]);
    const shield = unwrap(
      resolveSpell(
        before,
        WIZARD,
        { spellId: 'shield', targets: [WIZARD], slotLevel: 1, hold: true },
        supply('shield'),
      ),
      'shield',
    );
    return {
      riteId: declared.castingId,
      shieldId: shield.castingId,
      log: [...declared.events, ...begun, hit, ...shield.events],
    };
  };

  it('holds both, keyed by their own ids and both naming the same caster', () => {
    const { riteId, shieldId, log } = bothOpen();
    const open = world(log);

    expect(Object.keys(open.pendingCastings)).toEqual([riteId, shieldId]);
    expect(pendingCastingsBy(open, WIZARD).map((c) => c.castingId)).toEqual([riteId, shieldId]);
    expect(open.pendingCastings[riteId]?.spellId).toBe('comprehend-languages');
    expect(open.pendingCastings[shieldId]?.spellId).toBe('shield');
  });

  /**
   * SRD Concentration: broken "the moment you start casting a spell **that
   * requires Concentration**". Shield requires none, so the rite — which is
   * concentrated on from its own declaration — is untouched.
   */
  it('leaves the rite’s Concentration exactly where it was', () => {
    const { riteId, log } = bothOpen();
    expect(world(log).creatures.wizard!.concentration?.castingId).toBe(riteId);
  });

  /**
   * Neither has expended a slot while it stands, which is the SRD's own
   * reading — and the turn's one-slot marker is therefore unset, so the rite
   * has not used up the turn Shield is answering on.
   */
  it('spends no slot for either while they stand', () => {
    const { log } = bothOpen();
    const open = world(log);
    expect(slotsLeft(open, WIZARD, 1)).toBe(4);
    expect(open.combat?.budgets[WIZARD]?.spellSlotSpentOnTurn).toBeNull();
  });

  it('settles each independently by its own id', () => {
    const { riteId, shieldId, log } = bothOpen();

    const shieldSettled = unwrap(
      resolveDeclaredCast(world(log), shieldId, supply('settle-shield')),
      'settle shield',
    );
    const between = world([...log, ...shieldSettled.events]);

    expect(Object.keys(between.pendingCastings)).toEqual([riteId]);
    expect(slotsLeft(between, WIZARD, 1)).toBe(3);
    // Shield takes no Concentration, so the rite still holds it.
    expect(between.creatures.wizard!.concentration?.castingId).toBe(riteId);

    const tick: GameEvent = { type: 'time-advanced', seconds: 600, reason: 'the rite' };
    const advanced = world([...log, ...shieldSettled.events, tick]);
    const riteSettled = unwrap(
      resolveDeclaredCast(advanced, riteId, supply('settle-rite')),
      'settle rite',
    );
    const done = world([...log, ...shieldSettled.events, tick, ...riteSettled.events]);
    expect(done.pendingCastings).toEqual({});
  });

  /**
   * With two of one caster's castings open, a Counterspell that names no
   * casting id is refused and told the candidates. The engine never picks
   * between them — the same rule `eligibleTargets` obeys for targeting.
   */
  it('refuses a Counterspell that does not say which of them it answers', () => {
    const { riteId, shieldId, log } = bothOpen();
    const open = world(log);

    const vague = resolveSpell(
      open,
      ALLY,
      { spellId: 'counterspell', targets: [WIZARD], slotLevel: 3 },
      supply('counter', -40),
    );
    expect(isErr(vague) && vague.code).toBe('ambiguous_casting');
    if (isErr(vague)) {
      expect(vague.reason).toContain(riteId);
      expect(vague.reason).toContain(shieldId);
    }
    // Nothing spent by the refusal.
    expect(slotsLeft(open, ALLY, 3)).toBe(4);
  });

  it('answers the one it names, and leaves the other standing', () => {
    const { riteId, shieldId, log } = bothOpen();
    const open = world(log);

    const countered = unwrap(
      resolveSpell(
        open,
        ALLY,
        { spellId: 'counterspell', targets: [WIZARD], slotLevel: 3, answers: shieldId },
        supply('counter', -40),
      ),
      'counterspell',
    );
    const after = world([...log, ...countered.events]);

    expect(Object.keys(after.pendingCastings)).toEqual([riteId]);
    expect(after.creatures.wizard!.concentration?.castingId).toBe(riteId);
  });

  /**
   * A caster who leaves takes **every** casting they had open with them.
   * `settleHoldsInvolving` read the single slot and stopped at the first;
   * plural is what a keyed record makes possible and what would otherwise
   * strand a debt the turn refuses to advance past.
   */
  it('interrupts every casting a departing caster held open', () => {
    const { riteId, shieldId, log } = bothOpen();
    const open = world(log);

    const gone = unwrap(removeCreatureEverywhere(open, WIZARD), 'remove');
    const interrupted = gone.filter((e) => e.type === 'spell-interrupted');
    expect(interrupted.map((e) => e.castingId)).toEqual([riteId, shieldId]);
    expect(world([...log, ...gone]).pendingCastings).toEqual({});
  });
});

describe('what refuses a second casting is the rule, never the record', () => {
  const inCombat = (): readonly GameEvent[] => [
    ...TABLE,
    ...unwrap(
      beginCombat(world(), [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: ENEMY, initiative: 10, speed: 30 },
      ]),
      'combat',
    ),
  ];

  /** A casting held open has already spent the Magic action it cost. */
  const declaredInCombat = () => {
    const log = inCombat();
    const held = unwrap(holdPerson(fold('seed', log), WIZARD, 'hold'), 'hold');
    return { log: [...log, ...held.events], castingId: held.castingId };
  };

  /**
   * AC 1b. The refusal comes from the **action economy**, asserted by its own
   * code — nothing about pending state says it.
   */
  it('refuses a second Magic-action casting with no_action', () => {
    const { log } = declaredInCombat();
    const again = resolveSpell(
      fold('seed', log),
      WIZARD,
      { spellId: 'bless', targets: [WIZARD], slotLevel: 1 },
      supply('again'),
    );
    expect(isErr(again) && again.code).toBe('no_action');
  });

  /** And permits the Bonus Action the SRD leaves them. */
  it('permits a Bonus Action casting while a casting of theirs is open', () => {
    const { log } = declaredInCombat();
    const bonus = resolveSpell(
      fold('seed', log),
      WIZARD,
      { spellId: 'healing-word', targets: [ENEMY], slotLevel: 1 },
      supply('bonus'),
    );
    expect(isErr(bonus) ? bonus.code : 'ok').toBe('ok');
  });

  /**
   * SRD: "you can expend only one spell slot" — it reads **expenditure**, and
   * a pending casting has expended none. So the marker is unset while the
   * casting stands, and set by the settling `spell-cast`.
   */
  it('leaves the turn’s one-slot marker unset until the casting settles', () => {
    const { log, castingId } = declaredInCombat();
    const open = fold('seed', log);
    expect(open.combat?.budgets[WIZARD]?.action).toBe(false);
    expect(open.combat?.budgets[WIZARD]?.spellSlotSpentOnTurn).toBeNull();

    const settled = unwrap(resolveDeclaredCast(open, castingId, supply('settle', -40)), 'settle');
    const after = fold('seed', [...log, ...settled.events]);
    expect(after.combat?.budgets[WIZARD]?.spellSlotSpentOnTurn).toBe(after.combat?.turnsTaken);

    const third = resolveSpell(
      after,
      WIZARD,
      { spellId: 'healing-word', targets: [ENEMY], slotLevel: 1 },
      supply('third'),
    );
    expect(isErr(third) && third.code).toBe('slot_already_spent_this_turn');
  });

  /**
   * One Concentration, kept by `releaseCasting` and not by uniqueness: a
   * second Concentration casting breaks the first at its declaration, which is
   * SRD's own sentence and is what keeps at most one Concentration-bearing
   * casting per caster with no rule about pending records at all.
   */
  it('breaks the first Concentration when a second Concentration casting begins', () => {
    const first = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'hold-person', targets: [FOE], slotLevel: 2 },
        supply('a', -40),
      ),
      'hold person',
    );
    const holding = world(first.events);
    expect(holding.creatures.wizard!.concentration?.castingId).toBe(first.castingId);

    const second = unwrap(bless(holding, WIZARD, 'b'), 'bless');
    const after = world([...first.events, ...second.events]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(after.ongoing[first.castingId]).toBeUndefined();
    expect(Object.keys(after.pendingCastings)).toEqual([second.castingId]);
  });
});

describe('settling a declared casting addresses one casting id', () => {
  it('refuses a casting id that is not pending, and names it', () => {
    const nothing = resolveDeclaredCast(world(), 'cast:7', supply());
    expect(isErr(nothing) && nothing.code).toBe('no_casting_pending');
    if (isErr(nothing)) expect(nothing.reason).toContain('cast:7');
  });

  it('is a no-op when the same command id settles the same casting twice', () => {
    const held = unwrap(holdPerson(world(), WIZARD, 'a'), 'hold');
    const open = world(held.events);
    const settled = unwrap(
      resolveDeclaredCast(open, held.castingId, supply('s', -40), { commandId: 'settle-1' }),
      'settle',
    );
    const after = world([...held.events, ...settled.events]);

    const again = unwrap(
      resolveDeclaredCast(after, held.castingId, supply('s', -40), { commandId: 'settle-1' }),
      'retry',
    );
    expect(again.events).toEqual([]);
    expect(again.castingId).toBe(held.castingId);
  });

  it('refuses a command id reused for a different casting id', () => {
    const { firstId, secondId, log } = twoCasters();
    const open = world(log);
    const settled = unwrap(
      resolveDeclaredCast(open, firstId, supply('s', -40), { commandId: 'settle-1' }),
      'settle',
    );
    const after = world([...log, ...settled.events]);

    const wrong = resolveDeclaredCast(after, secondId, supply('s'), { commandId: 'settle-1' });
    expect(isErr(wrong) && wrong.code).toBe('command_id_reused');
  });
});
