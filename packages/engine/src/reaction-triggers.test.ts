import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState, type PendingAttack } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import {
  damageCreature,
  resolveAttack,
  resolveAttackDamage,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * A Reaction whose trigger the engine can actually see.
 *
 * `resolveCast` has spent the Reaction since the action economy landed, which
 * is the half the engine could see without help. What it could not see is the
 * *trigger*: SRD writes a Reaction's casting time as a clause — "which you
 * take when you are hit by an attack roll" — and nothing checked that the
 * clause had come true. A Shield cast in an empty corridor was as legal as one
 * cast into a swinging sword.
 *
 * Shield is the spell that makes this real, and it needs three things the
 * engine did not have:
 *
 * 1. **A window.** "Including against the triggering attack" means the attack
 *    must still be undecided when the Reaction lands. That window already
 *    exists — `pendingAttack`, built so a Divine Smite could land between an
 *    attack's two rolls — and it already records the AC the roll beat.
 * 2. **An Armour Class an effect can change.** `BonusApplies` covered attacks,
 *    saves and ability checks; AC was read off the sheet and nothing could
 *    touch it. Shield of Faith has the same gap and no Reaction at all, which
 *    is what makes this a shape rather than a special case.
 * 3. **The arithmetic of turning a hit into a miss**, which is the engine's
 *    to own. Whether +5 is enough is not a judgement call.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const THUG = id('thug');
const CLERIC = id('cleric');

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

/** Turn order: thug, wizard, cleric. The thug swings first. */
const TABLE: readonly GameEvent[] = [
  added(THUG, 'foes'),
  added(WIZARD, 'party'),
  added(CLERIC, 'party', { spellcastingAbility: 'wis' }),
  {
    type: 'items-gained',
    id: THUG,
    items: [{ id: 'longsword', quantity: 1 }],
    source: 'kit',
  },
  ...[1, 2].flatMap((level): GameEvent[] =>
    [WIZARD, CLERIC].map((who) => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `l${level}`, max: 4, recovers: 'long-rest' },
    })),
  ),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['shield', 'hellish-rebuke'] }),
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['shield-of-faith'] }),
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: THUG, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { creature: THUG }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { creature: THUG }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: THUG, to: WIZARD, seen: true },
  { type: 'sight-declared', from: WIZARD, to: THUG, seen: true },
  { type: 'sight-declared', from: CLERIC, to: WIZARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: THUG, initiative: 20, speed: 30 },
      { id: WIZARD, initiative: 10, speed: 30 },
      { id: CLERIC, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (flat = 0) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('reactions'),
  bonuses: [{ source: 'the test insists', flat }],
});

/**
 * A swing that lands, held between its two rolls.
 *
 * `free` so the thug need not own the turn — which swing it is has nothing to
 * do with the Armour Class it is measured against — and a bonus large enough
 * that the die cannot decide the outcome. A weapon attack takes its bonuses
 * from the command; `supply.bonuses` is the spell path.
 */
const swingAt = (log: readonly GameEvent[], commandId?: string) =>
  resolveAttack(
    fold('s', log),
    THUG,
    {
      target: WIZARD,
      weapon: 'longsword',
      hold: true,
      free: true,
      attackBonuses: [{ source: 'the test insists', flat: 40 }],
      ...(commandId === undefined ? {} : { commandId }),
    },
    supply(),
  );

const castShield = (log: readonly GameEvent[], commandId?: string) =>
  resolveSpell(
    fold('s', log),
    WIZARD,
    {
      spellId: 'shield',
      targets: [WIZARD],
      slotLevel: 1,
      ...(commandId === undefined ? {} : { commandId }),
    },
    supply(),
  );

/**
 * A hit already rolled, with the numbers stated.
 *
 * `attack-landed` carries the whole hold, so a test can put one in the log
 * with a known total against a known Armour Class. Whether +5 is enough is the
 * rule under test, and a d20 in the middle of it would only obscure which
 * branch ran.
 */
const landed = (over: Partial<PendingAttack> = {}): GameEvent => ({
  type: 'attack-landed',
  attack: {
    attacker: THUG,
    target: WIZARD,
    weapon: 'longsword',
    twoHanded: false,
    thrown: false,
    critical: false,
    ability: 'str',
    targetAc: 10,
    total: 12,
    natural: 11,
    ...over,
  },
});

const heldFor = (state: GameState) => state.pendingAttack;

describe('an effect can change an Armour Class', () => {
  /**
   * SRD Shield of Faith: "granting it a +2 bonus to AC for the duration." No
   * Reaction, no trigger, no window — the same missing piece as Shield and
   * nothing else, which is why it is the second user that makes this a shape
   * rather than a special case for one spell.
   *
   * The AC is read back off a held attack, because `targetAc` is the number
   * the engine actually used. Asserting it that way survives whatever the die
   * showed.
   */
  const acUnderAttack = (log: readonly GameEvent[]): number => {
    const held = unwrap(swingAt(log), 'attack');
    return heldFor(fold('s', [...log, ...held.events]))?.targetAc ?? -1;
  };

  /**
   * No Initiative order here. Shield of Faith is a Bonus Action and would need
   * the cleric's turn, and none of that bears on the question — whether a
   * bonus reaches an Armour Class is true in a corridor as much as in a fight.
   */
  const PEACE = TABLE.filter((e) => e.type !== 'combat-started');

  it('raises the Armour Class the attack is measured against', () => {
    const bare = acUnderAttack(PEACE);

    const blessed = unwrap(
      resolveSpell(
        fold('s', PEACE),
        CLERIC,
        { spellId: 'shield-of-faith', targets: [WIZARD], slotLevel: 1 },
        supply(),
      ),
      'shield of faith',
    );

    expect(acUnderAttack([...PEACE, ...blessed.events])).toBe(bare + 2);
  });

  it('takes the bonus away when the spell ends', () => {
    const bare = acUnderAttack(PEACE);
    const blessed = unwrap(
      resolveSpell(
        fold('s', PEACE),
        CLERIC,
        { spellId: 'shield-of-faith', targets: [WIZARD], slotLevel: 1 },
        supply(),
      ),
      'shield of faith',
    );
    const up = [...PEACE, ...blessed.events];

    // The cleric stops concentrating, so the field goes out.
    const state = fold('s', up);
    const castingId = state.creatures.cleric?.concentration?.castingId ?? '';
    const dropped: GameEvent[] = [
      ...up,
      { type: 'concentration-ended', id: CLERIC, castingId, reason: 'voluntary' },
    ];

    expect(acUnderAttack(dropped)).toBe(bare);
  });
});

describe('a Reaction spell checks that its trigger happened', () => {
  /**
   * The failure this exists to prevent: a Reaction is a whole action-economy
   * slot and a spell slot, and the engine was handing both over for a trigger
   * nobody had claimed, let alone one that had occurred.
   */
  it('refuses Shield when nothing has hit anybody, and spends nothing', () => {
    const refused = castShield(TABLE);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('no_trigger');
      // A trigger that has not happened is a rules verdict, not homework: the
      // engine knows perfectly well that no attack is pending.
      expect(refused.kind).toBe('refusal');
    }

    const state = fold('s', TABLE);
    expect(state.creatures.wizard?.resources.pools['spell-slot:1']?.spent).toBe(0);
    expect(state.combat?.budgets.wizard?.reaction).toBe(true);
  });

  it('refuses Shield when the attack is aimed at somebody else', () => {
    const log = [...TABLE, landed({ target: CLERIC })];
    const refused = castShield(log);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  it('allows Shield into a hit that is still undecided', () => {
    const out = castShield([...TABLE, landed()]);
    expect(out.ok).toBe(true);
  });

  it('spends the Reaction it costs', () => {
    const log = [...TABLE, landed()];
    const first = unwrap(castShield(log), 'shield');

    expect(first.events.some((e) => e.type === 'reaction-spent')).toBe(true);
    expect(fold('s', [...log, ...first.events]).combat?.budgets.wizard?.reaction).toBe(false);
  });
});

describe('Shield turns the triggering attack aside', () => {
  /**
   * "Including against the triggering attack" is the whole spell. A Shield
   * that only helped against the *next* attack would be a different and much
   * weaker one, and the difference is arithmetic rather than judgement — which
   * is exactly the sort of thing the model must not be left to decide.
   */
  it('makes a hit that beat the Armour Class by less than 5 into a miss', () => {
    const log = [...TABLE, landed({ targetAc: 10, total: 12, natural: 11 })];
    const out = unwrap(castShield(log), 'shield');

    const after = fold('s', [...log, ...out.events]);
    // The hold is closed, so nothing is owed and the turn can move on.
    expect(after.pendingAttack).toBeNull();
    // And closed without damage: 12 does not reach 10 + 5.
    expect(after.creatures.wizard?.vitals.hp).toBe(60);
  });

  it('leaves a hit that beat it by 5 or more still hitting', () => {
    const log = [...TABLE, landed({ targetAc: 10, total: 15, natural: 14 })];
    const out = unwrap(castShield(log), 'shield');

    const after = fold('s', [...log, ...out.events]);
    // Still owed: 15 reaches 10 + 5, so the sword lands and the damage is
    // still the attacker's to roll.
    expect(after.pendingAttack).not.toBeNull();
    expect(after.creatures.wizard?.vitals.hp).toBe(60);

    const hurt = unwrap(
      resolveAttackDamage(after, THUG, {}, supply()),
      'damage',
    );
    const settled = fold('s', [...log, ...out.events, ...hurt.events]);
    expect(settled.creatures.wizard?.vitals.hp).toBeLessThan(60);
    expect(settled.pendingAttack).toBeNull();
  });

  /** SRD: a natural 20 hits "regardless of any modifiers or the target's AC". */
  it('does not turn aside a natural 20', () => {
    const log = [...TABLE, landed({ targetAc: 10, total: 12, natural: 20, critical: true })];
    const out = unwrap(castShield(log), 'shield');

    const after = fold('s', [...log, ...out.events]);
    expect(after.pendingAttack).not.toBeNull();
  });

  /**
   * And the bonus is not spent on the one attack. "Until the start of your
   * next turn" — so the next swing this round is measured against the higher
   * number too.
   */
  it('keeps the +5 up for the attacks that follow', () => {
    const log = [...TABLE, landed({ targetAc: 10, total: 12, natural: 11 })];
    const out = unwrap(castShield(log), 'shield');
    const after = [...log, ...out.events];

    const next = unwrap(swingAt(after), 'second swing');
    expect(heldFor(fold('s', [...after, ...next.events]))?.targetAc).toBe(10 + 5);
  });

  it('drops the bonus at the start of the caster\'s next turn', () => {
    const log = [...TABLE, landed({ targetAc: 10, total: 12, natural: 11 })];
    const out = unwrap(castShield(log), 'shield');
    let after: GameEvent[] = [...log, ...out.events];

    // Exactly one advance: thug → wizard *is* the start of the wizard's next
    // turn. Going round to the thug again would pass the end of it too, and a
    // test that steps over both moments cannot tell them apart — the same trap
    // CLAUDE.md records for Dodge. `free` is what lets the swing happen on
    // somebody else's turn so the moment stays the discriminating one.
    after = [...after, ...unwrap(resolveTurn(fold('s', after), supply(), { commandId: 't1' }), 't1').events];

    const next = unwrap(swingAt(after), 'later swing');
    expect(heldFor(fold('s', [...after, ...next.events]))?.targetAc).toBe(10);
  });
});

describe('Shield does not cancel the pillar the target is behind', () => {
  /**
   * The bonus is applied to the number the attack was **actually measured
   * against**, which already has this attacker's cover folded into it.
   * Recomputing an Armour Class from the creature instead would silently drop
   * the cover, and Shield would leave a target behind a bar easier to hit than
   * the arithmetic says — the barrier cancelling the pillar.
   *
   * Half cover is +2, so the hit lands against 12 rather than 10, and 16 falls
   * short of 12 + 5. Recomputed from the creature the threshold would be 15,
   * and 16 would sail through.
   */
  it('measures the deflection from the Armour Class the attack met', () => {
    const log: GameEvent[] = [
      ...TABLE,
      { type: 'cover-declared', from: THUG, to: WIZARD, degree: 'half' },
      landed({ targetAc: 12, total: 16, natural: 11 }),
    ];
    const out = unwrap(castShield(log), 'shield');

    expect(fold('s', [...log, ...out.events]).pendingAttack).toBeNull();
  });
});

describe('the hold carries what the re-evaluation needs', () => {
  /**
   * The numbers the rule reads have to be on the hold rather than recovered
   * from the log, which is the same argument `PendingAttack` already makes for
   * the weapon and the critical: nothing is remembered between the two calls.
   */
  it('records the total and the natural of a real attack roll', () => {
    const held = unwrap(swingAt(TABLE), 'attack');
    const pending = heldFor(fold('s', [...TABLE, ...held.events]));

    expect(pending).not.toBeNull();
    expect(pending?.natural).toBeGreaterThanOrEqual(1);
    expect(pending?.natural).toBeLessThanOrEqual(20);
    // It hit, so the total cleared the Armour Class it was measured against.
    expect(pending!.total).toBeGreaterThanOrEqual(pending!.targetAc);
  });
});

describe('retrying a Reaction does not cast it twice', () => {
  it('is a no-op on a repeated command id', () => {
    const log = [...TABLE, landed()];
    const first = unwrap(castShield(log, 'shield-1'), 'shield');
    const after = fold('s', [...log, ...first.events]);

    const retry = unwrap(castShield([...log, ...first.events], 'shield-1'), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('s', [...log, ...first.events, ...retry.events])).toEqual(after);
  });
});

/**
 * The second trigger, and the fact the engine had to start recording first.
 *
 * SRD Hellish Rebuke is "Reaction, which you take in response to **taking
 * damage from a creature that you can see** within 60 feet of yourself", and
 * its target is "the creature that damaged you". Every damage event in this
 * engine carried a `source` — prose, for the audit trail: `'a trap'`,
 * `'Longsword'`. Prose cannot be aimed at, so there was no way to ask who to
 * set on fire.
 *
 * So damage now names its dealer where one is known, and the creature
 * remembers the last one. A trap still has no dealer, and that is the honest
 * answer rather than a missing one: nothing to rebuke.
 */
describe('damage records who dealt it', () => {
  it('names the attacker behind a weapon', () => {
    const swung = unwrap(
      resolveAttack(
        fold('s', TABLE),
        THUG,
        { target: WIZARD, weapon: 'longsword', free: true, attackBonuses: [{ source: 'x', flat: 40 }] },
        supply(),
      ),
      'attack',
    );
    expect(fold('s', [...TABLE, ...swung.events]).creatures.wizard?.lastDamage?.by).toBe(THUG);
  });

  /** A falling rock has no dealer, and inventing one would be worse than none. */
  it('leaves it unnamed when nothing in the game dealt it', () => {
    const log = [
      ...TABLE,
      ...unwrap(damageCreature(fold('s', TABLE), WIZARD, { amount: 5, source: 'a falling rock' }), 'rock'),
    ];
    expect(fold('s', log).creatures.wizard?.lastDamage).toBeNull();
  });
});

describe('a Reaction to being damaged', () => {
  /** The warlock's own trigger: somebody hit them, and they answer in kind. */
  const hurtBy = (log: readonly GameEvent[], by: CharacterId): GameEvent[] => [
    ...log,
    ...unwrap(
      damageCreature(fold('s', log), WIZARD, { amount: 7, source: 'a blade', by }),
      'damage',
    ),
  ];

  const rebuke = (log: readonly GameEvent[], target: CharacterId, commandId?: string) =>
    resolveSpell(
      fold('s', log),
      WIZARD,
      {
        spellId: 'hellish-rebuke',
        targets: [target],
        slotLevel: 1,
        ...(commandId === undefined ? {} : { commandId }),
      },
      supply(-40),
    );

  it('refuses when nobody has damaged you, and spends nothing', () => {
    const refused = rebuke(TABLE, THUG);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');

    const state = fold('s', TABLE);
    expect(state.creatures.wizard?.resources.pools['spell-slot:1']?.spent).toBe(0);
    expect(state.combat?.budgets.wizard?.reaction).toBe(true);
  });

  it('refuses when the damage came from no creature at all', () => {
    const log = [
      ...TABLE,
      ...unwrap(damageCreature(fold('s', TABLE), WIZARD, { amount: 5, source: 'a trap' }), 'trap'),
    ];
    const refused = rebuke(log, THUG);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  it('burns the creature that dealt the damage', () => {
    const log = hurtBy(TABLE, THUG);
    const out = unwrap(rebuke(log, THUG), 'rebuke');

    const after = fold('s', [...log, ...out.events]);
    expect(after.creatures.thug!.vitals.hp).toBeLessThan(60);
    expect(out.events.some((e) => e.type === 'reaction-spent')).toBe(true);
  });

  /**
   * SRD: "**The creature that damaged you** is momentarily surrounded by green
   * flames." Not a creature of your choice. Aiming it at somebody else is the
   * same substitution `eligibleTargets` exists to refuse — the engine checks
   * the id it was handed and never quietly aims at a better one.
   */
  it('refuses to burn anybody else', () => {
    const log = hurtBy(TABLE, THUG);
    const refused = rebuke(log, CLERIC);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  /**
   * The window. "In response to" means immediately, and a turn is the finest
   * grain the engine has for that — the same grain `pendingSaves` and the
   * one-slot-per-turn rule already use. Closing it on a number of seconds
   * nobody printed would be inventing one.
   */
  it('closes when the turn it happened on ends', () => {
    let log = hurtBy(TABLE, THUG);
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply(), { commandId: 't1' }), 't1').events];

    const refused = rebuke(log, THUG);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  /** And out of combat, where there are no turns, the clock closes it. */
  it('closes when time passes, with no turns to measure it in', () => {
    const peace = TABLE.filter((e) => e.type !== 'combat-started');
    const hurt = hurtBy(peace, THUG);
    expect(rebuke(hurt, THUG).ok).toBe(true);

    const later: GameEvent[] = [
      ...hurt,
      { type: 'time-advanced', seconds: 60, reason: 'binding a wound' },
    ];
    const refused = rebuke(later, THUG);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  it('is a no-op on a repeated command id', () => {
    const log = hurtBy(TABLE, THUG);
    const first = unwrap(rebuke(log, THUG, 'rebuke-1'), 'rebuke');
    const after = fold('s', [...log, ...first.events]);

    const retry = unwrap(rebuke([...log, ...first.events], THUG, 'rebuke-1'), 'retry');
    expect(retry.events).toEqual([]);
    expect(fold('s', [...log, ...first.events, ...retry.events])).toEqual(after);
  });
});
