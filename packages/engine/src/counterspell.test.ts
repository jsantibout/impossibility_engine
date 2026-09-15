import { readFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import {
  castSpell,
  pendingCastingsOf,
  removeCreatureEverywhere,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * An interruptible casting, and Counterspell as its first consumer.
 *
 * SRD 5.2.1 Counterspell:
 *
 * > _Level 3 Abjuration (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Reaction, which you take when you see a creature within 60 feet of
 * > yourself casting a spell with Verbal, Somatic, or Material components.
 * > **Range:** 60 feet. **Components:** S. **Duration:** Instantaneous.
 * > "You attempt to interrupt a creature in the process of casting a spell.
 * > The creature makes a Constitution saving throw. On a failed save, the
 * > spell dissipates with no effect, and the action, Bonus Action, or Reaction
 * > used to cast it is wasted. If that spell was cast with a spell slot, the
 * > slot isn't expended."
 *
 * Three facts in that last sentence decide the whole architecture, and they
 * are not the same fact:
 *
 * 1. The **action is wasted** — so it is spent when the casting is declared,
 *    and interruption does not give it back.
 * 2. The **slot isn't expended** — so it is *not* spent at declaration. There
 *    is nothing to refund, because nothing was taken.
 * 3. The spell **dissipates with no effect** — so the effects run at
 *    settlement, not at declaration.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ENEMY = id('enemy');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 14, int: 16, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** Turn order: the enemy casts first, the wizard answers. */
const TABLE: readonly GameEvent[] = [
  added(ENEMY, 'foes'),
  added(WIZARD, 'party'),
  added(OGRE, 'foes'),
  ...[1, 2, 3].flatMap((level): GameEvent[] =>
    [WIZARD, ENEMY].map((who) => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `l${level}`, max: 4, recovers: 'long-rest' },
    })),
  ),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['counterspell', 'fireball'] }),
  },
  {
    type: 'spellcasting-declared',
    id: ENEMY,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt'],
      prepared: ['hold-person', 'fireball', 'bane'],
    }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'creature-placed', id: ENEMY, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { creature: ENEMY }, feet: 30, bearing: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: ENEMY }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: ENEMY, seen: true },
  { type: 'sight-declared', from: ENEMY, to: OGRE, seen: true },
  { type: 'sight-declared', from: ENEMY, to: WIZARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ENEMY, initiative: 20, speed: 30 },
      { id: WIZARD, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (flat = 0) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('counterspell'),
  content: SRD_CONTENT,
  bonuses: [{ source: 'the test insists', flat }],
});

const slot3 = (state: GameState, who: CharacterId) =>
  remaining(state.creatures[who]!.resources, spellSlotKey(3));

/**
 * Advance the Initiative order all the way round to the enemy again.
 *
 * SRD's one-slot-per-turn rule reads *a turn*, so a test that wants a caster
 * to spend two slots has to give them two turns rather than quietly exempting
 * them from the rule.
 */
const cycleToEnemy = (log: readonly GameEvent[]): readonly GameEvent[] => {
  let events = [...log];
  for (let i = 0; i < 3; i += 1) {
    const turn = unwrap(resolveTurn(fold('s', events), supply()), `turn ${i}`);
    events = [...events, ...turn.events];
  }
  return events;
};

/** The enemy begins Hold Person on the ogre, holding the casting open. */
const declareHoldPerson = (log: readonly GameEvent[], commandId?: string) =>
  resolveSpell(
    fold('s', log),
    ENEMY,
    {
      spellId: 'hold-person',
      targets: [OGRE],
      slotLevel: 2,
      hold: true,
      ...(commandId === undefined ? {} : { commandId }),
    },
    supply(),
  );

describe('a casting that has been declared and has not yet resolved', () => {
  it('holds the casting open, spending the action but not the slot', () => {
    const before = fold('s', TABLE);
    const declared = unwrap(declareHoldPerson(TABLE), 'declare');
    const after = fold('s', [...TABLE, ...declared.events]);

    // The window is real, durable state, and it names the casting.
    expect(pendingCastingsOf(after)[0]?.castingId).toBe(declared.castingId);
    expect(pendingCastingsOf(after)[0]?.caster).toBe(ENEMY);
    expect(pendingCastingsOf(after)[0]?.spell).toBe('Hold Person');

    // SRD: "the action ... used to cast it is wasted" — so it is spent now.
    expect(after.combat?.budgets[ENEMY]?.action).toBe(false);

    // SRD: "the slot isn't expended" — so it has not been.
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(
      remaining(before.creatures[ENEMY]!.resources, spellSlotKey(2)),
    );

    // The spell has not landed: nothing is Paralyzed yet.
    expect(after.creatures[OGRE]!.conditions.conditions).toEqual([]);
  });

  it('survives a replay byte for byte', () => {
    const declared = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...declared.events];
    expect(fold('s', log)).toEqual(fold('s', log));
    // A different seed folds the same log identically: nothing here is rolled.
    expect(pendingCastingsOf(fold('other', log))[0]).toEqual(pendingCastingsOf(fold('s', log))[0]);
  });

  it('settles into the spell actually landing, spending the slot then', () => {
    const declared = unwrap(declareHoldPerson(TABLE), 'declare');
    const opened = fold('s', [...TABLE, ...declared.events]);

    // A large negative bonus on the ogre's save settles the branch outright.
    const settled = unwrap(resolveDeclaredCast(opened, declared.castingId, supply(-40)), 'settle');
    const after = fold('s', [...TABLE, ...declared.events, ...settled.events]);

    expect(pendingCastingsOf(after)).toEqual([]);
    expect(settled.castingId).toBe(declared.castingId);
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(3);
    expect(after.creatures[OGRE]!.conditions.conditions).toContain('paralyzed');
  });

  it('refuses to advance the turn while a casting is unresolved', () => {
    const declared = unwrap(declareHoldPerson(TABLE), 'declare');
    const opened = fold('s', [...TABLE, ...declared.events]);

    const advanced = resolveTurn(opened, supply());
    expect(isErr(advanced) && advanced.code).toBe('casting_pending');
  });
});

describe('Counterspell', () => {
  const declared = () => unwrap(declareHoldPerson(TABLE), 'declare');

  /** The wizard answers the enemy's casting. `flat` settles the enemy's save. */
  const counter = (log: readonly GameEvent[], flat: number, commandId?: string) =>
    resolveSpell(
      fold('s', log),
      WIZARD,
      {
        spellId: 'counterspell',
        targets: [ENEMY],
        slotLevel: 3,
        ...(commandId === undefined ? {} : { commandId }),
      },
      supply(flat),
    );

  it('interrupts the casting when the caster fails the Constitution save', () => {
    const open = declared();
    const log = [...TABLE, ...open.events];

    // A large negative bonus on the enemy's save settles the branch outright.
    const countered = unwrap(counter(log, -40), 'counterspell');
    const after = fold('s', [...log, ...countered.events]);

    expect(pendingCastingsOf(after)).toEqual([]);
    // SRD: "the slot isn't expended."
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(4);
    // SRD: "the spell dissipates with no effect."
    expect(after.creatures[OGRE]!.conditions.conditions).toEqual([]);
    // SRD: "the action ... used to cast it is wasted."
    expect(after.combat?.budgets[ENEMY]?.action).toBe(false);
    // The counterspeller paid in full: their own slot and their Reaction.
    expect(slot3(after, WIZARD)).toBe(3);
    expect(after.combat?.budgets[WIZARD]?.reaction).toBe(false);
  });

  it('does nothing when the caster makes the save, and the spell still lands', () => {
    const open = declared();
    const log = [...TABLE, ...open.events];

    const countered = unwrap(counter(log, 40), 'counterspell');
    const after = fold('s', [...log, ...countered.events]);

    // The window is still open: Counterspell failed, the casting stands.
    expect(pendingCastingsOf(after)[0]?.castingId).toBe(open.castingId);
    // The counterspeller still paid.
    expect(slot3(after, WIZARD)).toBe(3);

    const settled = unwrap(resolveDeclaredCast(after, open.castingId, supply(-40)), 'settle');
    const done = fold('s', [...log, ...countered.events, ...settled.events]);
    expect(done.creatures[OGRE]!.conditions.conditions).toContain('paralyzed');
    expect(remaining(done.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(3);
  });

  it('cannot be cast when nobody is casting', () => {
    const refused = counter(TABLE, -40);
    expect(isErr(refused) && refused.code).toBe('no_trigger');
  });

  it('cannot be aimed at anyone but the creature that is casting', () => {
    const open = declared();
    const log = [...TABLE, ...open.events];
    const refused = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'counterspell', targets: [OGRE], slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(refused) && refused.code).toBe('forced_target');
  });
});

describe('what the window costs, and what it does not', () => {
  /**
   * The compatibility claim, stated as a test rather than as a hope.
   *
   * Every casting in this engine was atomic before the window existed, and the
   * overwhelming majority still should be. A spell cast without asking for a
   * window must produce the same events, spend the same slot and land the same
   * effect it always did — one call, one `spell-cast`, no pending state.
   */
  it('leaves an ordinary casting exactly as it was', () => {
    const cast = unwrap(
      resolveSpell(
        fold('s', TABLE),
        ENEMY,
        { spellId: 'hold-person', targets: [OGRE], slotLevel: 2 },
        supply(-40),
      ),
      'atomic',
    );
    const after = fold('s', [...TABLE, ...cast.events]);

    expect(pendingCastingsOf(after)).toEqual([]);
    expect(cast.events.filter((e) => e.type === 'spell-declared')).toHaveLength(0);
    expect(cast.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(3);
    expect(after.creatures[OGRE]!.conditions.conditions).toContain('paralyzed');
    // And the turn is free to move on, because nothing is owed.
    expect(isErr(resolveTurn(after, supply()))).toBe(false);
  });

  it('spends the slot exactly once across declaration and settlement', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const settled = unwrap(resolveDeclaredCast(fold('s', log), open.castingId, supply(-40)), 'settle');

    const casts = [...open.events, ...settled.events].filter((e) => e.type === 'spell-cast');
    expect(casts).toHaveLength(1);
    expect(fold('s', [...log, ...settled.events]).castingsBegun).toBe(1);
  });

  /**
   * SRD: "You lose Concentration on an effect the moment you **start casting**
   * a spell that requires Concentration."
   *
   * The moment you start — so the spell the caster was holding is gone as soon
   * as the new casting is declared, and a Counterspell does not hand it back.
   * That is not a gap: the rules already took it, and an interruption is not a
   * time machine. The new Concentration, by contrast, never begins at all.
   */
  it('drops the old Concentration at declaration and never starts the new one', () => {
    const first = unwrap(
      resolveSpell(
        fold('s', TABLE),
        ENEMY,
        { spellId: 'bane', targets: [WIZARD], slotLevel: 1 },
        supply(-40),
      ),
      'bane',
    );
    // Round the order back to the enemy: SRD allows one slot per *turn*, and
    // Bane has already spent this one's.
    const roundTrip = cycleToEnemy([...TABLE, ...first.events]);
    const holding = fold('s', roundTrip);
    expect(holding.creatures[ENEMY]!.concentration?.spell).toBe('Bane');

    const open = unwrap(
      resolveSpell(
        holding,
        ENEMY,
        { spellId: 'hold-person', targets: [OGRE], slotLevel: 2, hold: true },
        supply(),
      ),
      'declare',
    );
    const log = [...roundTrip, ...open.events];
    const declared = fold('s', log);

    // Gone the moment the casting started.
    expect(declared.creatures[ENEMY]!.concentration).toBeNull();
    // And the new one has not begun: the spell has not taken effect.
    expect(open.events.filter((e) => e.type === 'concentration-started')).toHaveLength(0);

    const countered = unwrap(
      resolveSpell(
        declared,
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = fold('s', [...log, ...countered.events]);

    // Still gone. Bane is not restored by the counter, and Hold Person never
    // started, so the caster is concentrating on nothing at all.
    expect(after.creatures[ENEMY]!.concentration).toBeNull();
    expect(after.creatures[WIZARD]!.bonuses).toEqual([]);
  });

  it('starts the new Concentration when the casting settles', () => {
    const open = unwrap(
      resolveSpell(
        fold('s', TABLE),
        ENEMY,
        { spellId: 'bane', targets: [WIZARD], slotLevel: 1, hold: true },
        supply(),
      ),
      'declare',
    );
    const log = [...TABLE, ...open.events];
    expect(fold('s', log).creatures[ENEMY]!.concentration).toBeNull();

    const settled = unwrap(resolveDeclaredCast(fold('s', log), open.castingId, supply(-40)), 'settle');
    const after = fold('s', [...log, ...settled.events]);
    expect(after.creatures[ENEMY]!.concentration?.castingId).toBe(open.castingId);
  });

  /**
   * SRD: "On a turn, you can expend only one spell slot to cast a spell."
   *
   * It reads **expenditure**, and a countered casting expends nothing. So the
   * turn's one slot is still there to spend — which matters, because the
   * alternative reading would charge a caster for a spell the rules explicitly
   * say cost them no slot.
   */
  it('does not use up the turn’s one slot when the casting is countered', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    // Nothing marks the enemy's turn as having expended a slot, because
    // nothing has: the marker rides on the settling `spell-cast`.
    expect(fold('s', log).combat?.budgets[ENEMY]?.spellSlotSpentOnTurn ?? null).toBeNull();

    const countered = unwrap(
      resolveSpell(
        fold('s', log),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = fold('s', [...log, ...countered.events]);
    // Nothing was expended, so nothing marks the turn's slot as gone.
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(4);
    expect(after.combat?.budgets[ENEMY]?.spellSlotSpentOnTurn ?? null).toBeNull();
  });

  /** A cantrip has no slot to spare, and the rest of the rule is unchanged. */
  it('holds a cantrip open and wastes only the action', () => {
    const open = unwrap(
      resolveSpell(
        fold('s', TABLE),
        ENEMY,
        { spellId: 'fire-bolt', targets: [WIZARD], hold: true },
        supply(),
      ),
      'declare',
    );
    const log = [...TABLE, ...open.events];
    const declared = fold('s', log);
    expect(pendingCastingsOf(declared)[0]?.slot).toBeNull();
    expect(pendingCastingsOf(declared)[0]?.slotless).toBe('cantrip');

    const countered = unwrap(
      resolveSpell(
        declared,
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = fold('s', [...log, ...countered.events]);
    expect(pendingCastingsOf(after)).toEqual([]);
    // No damage: the Fire Bolt dissipated with no effect.
    expect(after.creatures[WIZARD]!.vitals.hp).toBe(60);
    expect(after.combat?.budgets[ENEMY]?.action).toBe(false);
  });

  /**
   * An upcast spell's slot is the one that is spared, at the level it was
   * going to be spent at. SRD Counterspell itself has **no** higher-level
   * clause in 5.2.1 — upcasting it buys nothing — so the only level that
   * matters here is the countered spell's.
   */
  it('spares the upcast slot at the level it would have cost', () => {
    const open = unwrap(
      resolveSpell(
        fold('s', TABLE),
        ENEMY,
        { spellId: 'hold-person', targets: [OGRE], slotLevel: 3, hold: true },
        supply(),
      ),
      'declare',
    );
    const log = [...TABLE, ...open.events];
    expect(pendingCastingsOf(fold('s', log))[0]?.slot).toEqual({ key: spellSlotKey(3), level: 3 });

    const countered = unwrap(
      resolveSpell(
        fold('s', log),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = fold('s', [...log, ...countered.events]);
    expect(slot3(after, ENEMY)).toBe(4);
    // The counterspeller's own level 3 slot did go.
    expect(slot3(after, WIZARD)).toBe(3);
  });
});

describe('retrying any of the three commands changes nothing', () => {
  /**
   * A model-driven loop retries for reasons that have nothing to do with the
   * game — a dropped connection, a resumed `pause_turn`, a tool re-invocation
   * after a stream error. Each of the three commands this shape adds has its
   * own way of going wrong twice, so each is proved separately.
   */
  it('a retried declaration opens one casting, not two', () => {
    const first = unwrap(declareHoldPerson(TABLE, 'declare-1'), 'first');
    const log = [...TABLE, ...first.events];
    const opened = fold('s', log);

    const retry = unwrap(declareHoldPerson(log, 'declare-1'), 'retry');
    expect(retry.events).toEqual([]);
    // The retry still names the casting the first call opened — not the one
    // that would come next, which is a different spell entirely.
    expect(retry.castingId).toBe(first.castingId);
    expect(fold('s', [...log, ...retry.events])).toEqual(opened);
    expect(opened.castingsBegun).toBe(1);
  });

  it('a retried settlement does not resolve the spell twice', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const settled = unwrap(
      resolveDeclaredCast(fold('s', log), open.castingId, supply(-40), { commandId: 'settle-1' }),
      'settle',
    );
    const done = [...log, ...settled.events];
    const after = fold('s', done);

    const retry = unwrap(resolveDeclaredCast(after, open.castingId, supply(-40), { commandId: 'settle-1' }), 'retry');
    expect(retry.events).toEqual([]);
    expect(retry.castingId).toBe(open.castingId);
    expect(fold('s', [...done, ...retry.events])).toEqual(after);
    // One slot, one paralysis, whatever the caller does.
    expect(remaining(after.creatures[ENEMY]!.resources, spellSlotKey(2))).toBe(3);
  });

  /**
   * The retry that would hurt most: a second Counterspell spends a second
   * Reaction and a second level 3 slot to counter a casting that is already
   * gone — and the window has closed, so without the guard it would come back
   * `no_trigger`, a rules refusal for a command that succeeded.
   */
  it('a retried Counterspell spends no second Reaction, slot or die', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const counter = (from: readonly GameEvent[]) =>
      resolveSpell(
        fold('s', from),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3, commandId: 'cs-1' },
        supply(-40),
      );

    const first = unwrap(counter(log), 'counterspell');
    const done = [...log, ...first.events];
    const after = fold('s', done);
    expect(pendingCastingsOf(after)).toEqual([]);

    const retry = unwrap(counter(done), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('s', [...done, ...retry.events])).toEqual(after);
    expect(slot3(after, WIZARD)).toBe(3);
    expect(after.combat?.budgets[WIZARD]?.reaction).toBe(false);
    // No second die: the roll count is the authoritative witness.
    expect(fold('s', [...done, ...retry.events]).rollsIssued).toBe(after.rollsIssued);
  });

  it('refuses a second, different command under an id already used', () => {
    const first = unwrap(declareHoldPerson(TABLE, 'declare-1'), 'first');
    const log = [...TABLE, ...first.events];
    const different = resolveSpell(
      fold('s', log),
      ENEMY,
      { spellId: 'fireball', targets: [], at: { x: 0, y: 0, z: 0 }, slotLevel: 3, hold: true, commandId: 'declare-1' },
      supply(),
    );
    expect(isErr(different)).toBe(true);
  });
});

describe('the window is a window, not a standing permission', () => {
  it('cannot counter a casting that has already settled', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const settled = unwrap(resolveDeclaredCast(fold('s', log), open.castingId, supply(-40)), 'settle');
    const after = [...log, ...settled.events];

    const late = resolveSpell(
      fold('s', after),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(late) && late.code).toBe('no_trigger');
    // Nothing spent on the refusal.
    expect(slot3(fold('s', after), WIZARD)).toBe(4);
  });

  it('cannot counter a casting that has already been countered', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const first = unwrap(
      resolveSpell(
        fold('s', log),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = [...log, ...first.events];

    const second = resolveSpell(
      fold('s', after),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(second) && second.code).toBe('no_trigger');
  });

  /**
   * **Inverted.** This asserted `casting_pending` — a casting being open
   * refused everybody's casting, engine-wide, and that corresponded to no SRD
   * rule at all. It refuses nobody now, and what stops the wizard here is the
   * **action economy**: it is the enemy's turn, and a Magic action is taken on
   * your own. Asserted by its own code, because the point of the inversion is
   * that the refusal comes from a rule rather than from a record.
   */
  it('refuses a second creature’s casting from the economy, not from the record', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const at = fold('s', log).scene!.positions[OGRE]!;
    const again = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'fireball', targets: [], at, slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(again) && again.code).toBe('not_their_turn');
  });

  /** And the Reaction the SRD *does* give them on somebody else's turn lands. */
  it('lets that creature take the Reaction the same moment offers', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const answered = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
      supply(40),
    );
    expect(isErr(answered) ? answered.code : 'ok').toBe('ok');
  });

  /**
   * **No stack, and the refusal is a value.**
   *
   * CLAUDE.md has said since the window landed that "a Counterspell answering
   * a Counterspell is refused rather than nested". It was — by the reducer
   * throwing `CorruptLogError` on the second `spell-declared`, which is the
   * wrong instrument: a rules-legal refusal is a value the DM narrates around,
   * and an exception is reserved for programmer error.
   *
   * The reachable shape of the nesting is a Counterspell that asks to be
   * **held open**, because that is the only way a second window could exist.
   * Answering the open casting outright is still allowed, and that is the
   * whole point of the exemption.
   *
   * **The code changed, and the rule it carries is narrower.** It was
   * `casting_pending`, whose reason said "one casting is open at a time" —
   * which stopped being true when the record became keyed by casting id. The
   * rule that is left is about the **answering relationship**: an answer is
   * not a window. It is an engine limit standing in for a settle-order rule
   * the engine does not have, and **not** an SRD rule — SRD Counterspell
   * triggers on a creature "casting a spell with Verbal, Somatic, or Material
   * components", and a creature casting Counterspell is doing exactly that.
   * The reason has to say so.
   */
  it('refuses to hold a Counterspell open while a casting is already open', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const nested = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3, hold: true },
      supply(-40),
    );
    expect(isErr(nested) && nested.code).toBe('answer_cannot_be_held');
    if (isErr(nested)) {
      expect(nested.reason).toContain('Counterspell');
      // The reason says whose limit it is, so nobody reads it as the book's.
      expect(nested.reason).toContain('rather than of the SRD');
    }

    // Nothing spent, and the window it was aimed at is exactly as it was.
    const after = fold('s', log);
    expect(slot3(after, WIZARD)).toBe(4);
    expect(pendingCastingsOf(after)[0]?.castingId).toBe(open.castingId);
    expect(after.combat?.budgets[WIZARD]?.reaction).toBe(true);
  });

  /**
   * The other half of the nesting, and it is reachable rather than defensive.
   *
   * `castSpell` is the documented low-level half — a caller reconstructing a
   * log or scripting a fixture — and it checks no Reaction trigger, so it can
   * legitimately leave a *Counterspell* open where `resolveSpell` never would.
   * A second Counterspell aimed at that window is the thing CLAUDE.md has
   * always said is refused rather than nested, and the refusal has to be a
   * value there too.
   *
   * **Its own code now**, because it is its own rule: an answer may not answer
   * an answer. Like the clause above it that is an engine limit standing in
   * for the settle-order rule the engine does not have, and **not** an SRD
   * rule.
   */
  it('refuses a Counterspell aimed at a casting that is itself a Counterspell', () => {
    // The enemy can answer too, so the refusal below is the nesting guard and
    // not a caster reaching for a spell they never had.
    const ARMED: readonly GameEvent[] = TABLE.map((e) =>
      e.type === 'spellcasting-declared' && e.id === ENEMY
        ? {
            ...e,
            spellcasting: declaredCasting({
              ability: 'int',
              cantrips: ['fire-bolt'],
              prepared: ['hold-person', 'fireball', 'bane', 'counterspell'],
            }),
          }
        : e,
    );
    const opened = [
      ...ARMED,
      ...unwrap(
        castSpell(fold('s', ARMED), WIZARD, {
          spell: 'Counterspell',
          level: 3,
          slotLevel: 3,
          castingTime: 'reaction',
          route: 'class:innate',
          hold: { spellId: 'counterspell', targets: [ENEMY], unverified: [] },
        }),
        'a Counterspell left open by the low-level half',
      ),
    ];
    const open = fold('s', opened);
    expect(pendingCastingsOf(open)[0]?.spellId).toBe('counterspell');

    const nested = resolveSpell(
      open,
      ENEMY,
      { spellId: 'counterspell', targets: [WIZARD], slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(nested) && nested.code).toBe('answer_to_an_answer');
    if (isErr(nested)) expect(nested.reason).toContain('rather than of the SRD');
    // Nothing spent, and the window it was aimed at is exactly as it was.
    expect(slot3(open, ENEMY)).toBe(4);
    expect(pendingCastingsOf(open)).toHaveLength(1);
  });

  /**
   * **A field quietly ignored is a caller who thinks they said something.**
   * `answers` names the casting a Reaction interrupts, so a spell that prints
   * no such trigger is refused rather than having the field dropped — the
   * shape `damageType`, `fought` and `teleportTo` already take.
   */
  it('refuses a casting id on a spell that answers no casting', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];
    const at = fold('s', log).scene!.positions[OGRE]!;

    const confused = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'fireball', targets: [], at, slotLevel: 3, answers: open.castingId },
      supply(-40),
    );
    expect(isErr(confused) && confused.code).toBe('no_answer_clause');
  });

  /** And the ordinary answer is untouched: a Counterspell may still answer. */
  it('still lets a Counterspell answer the casting it was cast to answer', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const answered = resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
      supply(-40),
    );
    expect(isErr(answered)).toBe(false);
  });

  it('refuses to settle when nothing is being cast', () => {
    const nothing = resolveDeclaredCast(fold('s', TABLE), 'cast:1', supply(-40));
    expect(isErr(nothing) && nothing.code).toBe('no_casting_pending');
  });

  /**
   * A debt that blocks the turn must survive the debtor leaving, or a caster
   * killed mid-casting wedges the fight for good. The same rule `pendingAttack`
   * and `pendingMove` already follow: leaving the game settles what you owe,
   * and the log says plainly that the spell never happened.
   */
  it('does not strand the fight when the caster leaves mid-casting', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const gone = unwrap(removeCreatureEverywhere(fold('s', log), ENEMY), 'remove');
    const after = fold('s', [...log, ...gone]);

    expect(pendingCastingsOf(after)).toEqual([]);
    expect(isErr(resolveTurn(after, supply()))).toBe(false);
  });
});

describe('the trigger clause, checked against what the SRD actually says', () => {
  /** Everything except the sight line from the counterspeller to the caster. */
  const BLIND: readonly GameEvent[] = TABLE.filter(
    (e) => !(e.type === 'sight-declared' && e.from === WIZARD && e.to === ENEMY),
  );

  /** The enemy placed beyond Counterspell's 60 feet. */
  const FAR: readonly GameEvent[] = TABLE.map((e) =>
    e.type === 'creature-placed' && e.id === WIZARD
      ? { ...e, placement: { from: { creature: ENEMY }, feet: 90, bearing: 0 } }
      : e,
  );

  const declareOn = (log: readonly GameEvent[]) =>
    unwrap(
      resolveSpell(
        fold('s', log),
        ENEMY,
        { spellId: 'hold-person', targets: [OGRE], slotLevel: 2, hold: true },
        supply(),
      ),
      'declare',
    );

  const counterFrom = (log: readonly GameEvent[]) =>
    resolveSpell(
      fold('s', log),
      WIZARD,
      { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
      supply(-40),
    );

  /**
   * SRD: "**Range:** 60 feet", and the trigger says the same — "a creature
   * within 60 feet of yourself". A caster further off is simply out of reach.
   */
  it('refuses a caster beyond 60 feet', () => {
    const open = declareOn(FAR);
    const refused = counterFrom([...FAR, ...open.events]);
    expect(isErr(refused) && refused.code).toBe('out_of_range');
    // The window is untouched, and so is the would-be counterspeller's purse.
    const after = fold('s', [...FAR, ...open.events]);
    expect(pendingCastingsOf(after)).toHaveLength(1);
    expect(slot3(after, WIZARD)).toBe(4);
  });

  /**
   * SRD: "when you **see** a creature ... casting a spell."
   *
   * Unknown is not false. A sight line nobody has declared is a fact to go and
   * get, not a refusal — so this asks rather than saying no, and the request
   * names what it needs and which command supplies it.
   */
  it('asks for a sight line nobody has declared, rather than inventing one', () => {
    const open = declareOn(BLIND);
    const asked = counterFrom([...BLIND, ...open.events]);

    expect(isNeedsContext(asked)).toBe(true);
    const requests = isErr(asked) ? (asked.requests ?? []) : [];
    expect(requests.map((r) => r.kind)).toContain('visibility');
    expect(requests.every((r) => r.need.length > 0 && r.because.length > 0)).toBe(true);

    // Nothing spent while the question stands.
    const after = fold('s', [...BLIND, ...open.events]);
    expect(slot3(after, WIZARD)).toBe(4);
    expect(pendingCastingsOf(after)).toHaveLength(1);
  });

  /** A sight line declared **false** is the refusal, not the request. */
  it('refuses a caster declared unseen', () => {
    const unseen: readonly GameEvent[] = [
      ...BLIND,
      { type: 'sight-declared', from: WIZARD, to: ENEMY, seen: false },
    ];
    const open = declareOn(unseen);
    const refused = counterFrom([...unseen, ...open.events]);
    expect(isNeedsContext(refused)).toBe(false);
    expect(isErr(refused) && refused.code).toBe('cannot_see_target');
  });

  /**
   * The one clause this definition does not check, pinned so that the reason
   * it is safe cannot quietly stop being true.
   *
   * SRD Counterspell triggers on "casting a spell with Verbal, Somatic, or
   * Material components". Every spell in SRD 5.2.1 has at least one of the
   * three, so the qualifier excludes nothing the engine can be asked about —
   * which is why the definition reports it in `unmodelled` instead of
   * modelling a field whose only reachable value is "yes".
   */
  it('is safe to leave the components clause unchecked, and says so', () => {
    const spells = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as { name: string; components: { verbal: boolean; somatic: boolean; material: boolean } }[];

    const withoutComponents = spells.filter(
      (spell) => !spell.components.verbal && !spell.components.somatic && !spell.components.material,
    );
    expect(withoutComponents.map((s) => s.name)).toEqual([]);
    expect(spells).toHaveLength(339);

    // And the gap reaches the narrating layer rather than a docstring.
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const countered = unwrap(
      resolveSpell(
        fold('s', [...TABLE, ...open.events]),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    expect(countered.unverified.join(' ')).toContain('Verbal, Somatic, or Material');
  });

});

describe('the log is the whole truth', () => {
  /**
   * The guarantee that makes a pending casting durable rather than a return
   * value: fold the log, reload, fold it again, and the window is still there
   * with everything settlement needs written down.
   */
  it('folds prefix by prefix without ever disagreeing with itself', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const countered = unwrap(
      resolveSpell(
        fold('s', [...TABLE, ...open.events]),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(40),
      ),
      'counterspell',
    );
    const settled = unwrap(
      resolveDeclaredCast(fold('s', [...TABLE, ...open.events, ...countered.events]), open.castingId, supply(-40)),
      'settle',
    );
    const log = [...TABLE, ...open.events, ...countered.events, ...settled.events];

    // Every prefix folds, and folding the same prefix twice agrees.
    for (let i = 0; i <= log.length; i += 1) {
      const prefix = log.slice(0, i);
      expect(fold('s', prefix)).toEqual(fold('s', prefix));
    }

    // Two different seeds fold the same log identically: nothing in the fold
    // rolls anything, so the recorded numbers are the only numbers there are.
    const bySeed = fold('s', log);
    const byOther = fold('other', log);
    expect({ ...byOther, seed: 's' }).toEqual(bySeed);
  });

  it('leaves the window in the log, recoverable after a reload', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const reloaded = fold('s', log);
    const pending = pendingCastingsOf(reloaded)[0] ?? null;
    expect(pending).not.toBeNull();
    // Everything settlement needs, written down rather than remembered.
    expect(pending).toMatchObject({
      castingId: open.castingId,
      caster: ENEMY,
      spellId: 'hold-person',
      level: 2,
      slot: { key: spellSlotKey(2), level: 2 },
      targets: [OGRE],
      concentration: true,
    });

    // And a fresh fold of the same log settles to the same place.
    const a = unwrap(resolveDeclaredCast(reloaded, open.castingId, supply(-40)), 'settle a');
    const b = unwrap(resolveDeclaredCast(fold('s', log), open.castingId, supply(-40)), 'settle b');
    expect(a).toEqual(b);
  });

  /**
   * SRD keeps Pact Magic out of the ordinary slot pool, and "the slot isn't
   * expended" does not care which pool it came from. The pending casting names
   * the pool by key, so the one that is spared is the one that would have paid.
   */
  it('spares a Pact Magic slot as readily as an ordinary one', () => {
    const warlock: readonly GameEvent[] = [
      ...TABLE,
      {
        type: 'resource-pool-declared',
        id: ENEMY,
        pool: { key: 'pact-slot:3', label: 'pact', max: 2, recovers: 'short-rest' },
      },
    ];

    const open = unwrap(
      resolveSpell(
        fold('s', warlock),
        ENEMY,
        { spellId: 'hold-person', targets: [OGRE], slotLevel: 3, slotKind: 'pact', hold: true },
        supply(),
      ),
      'declare',
    );
    const log = [...warlock, ...open.events];
    expect(pendingCastingsOf(fold('s', log))[0]?.slot).toEqual({ key: 'pact-slot:3', level: 3 });
    expect(remaining(fold('s', log).creatures[ENEMY]!.resources, 'pact-slot:3')).toBe(2);

    const countered = unwrap(
      resolveSpell(
        fold('s', log),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    const after = fold('s', [...log, ...countered.events]);
    expect(remaining(after.creatures[ENEMY]!.resources, 'pact-slot:3')).toBe(2);
    // The ordinary pool was never touched either.
    expect(slot3(after, ENEMY)).toBe(4);
  });

  it('lets the turn move on once the casting is settled either way', () => {
    const open = unwrap(declareHoldPerson(TABLE), 'declare');
    const log = [...TABLE, ...open.events];

    const countered = unwrap(
      resolveSpell(
        fold('s', log),
        WIZARD,
        { spellId: 'counterspell', targets: [ENEMY], slotLevel: 3 },
        supply(-40),
      ),
      'counterspell',
    );
    expect(isErr(resolveTurn(fold('s', [...log, ...countered.events]), supply()))).toBe(false);

    const settled = unwrap(resolveDeclaredCast(fold('s', log), open.castingId, supply(-40)), 'settle');
    expect(isErr(resolveTurn(fold('s', [...log, ...settled.events]), supply()))).toBe(false);
  });
});
