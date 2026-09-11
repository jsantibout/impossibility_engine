import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { Armor } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { castingSource, spellOfSource } from './spells.js';
import { concentrationSaveDc } from './vitals.js';
import {
  ZERO_HIT_POINTS,
  applyConditionTo,
  applySpellEffect,
  castSpell,
  concentrationSaveAfterDamage,
  damageCreature,
  declareResourcePool,
  endConcentration,
  grantTemporaryHpTo,
  nextCastingId,
  removeCreatureEverywhere,
  restoreResourcesOn,
  setExhaustionLevel,
  whyCondition,
} from './commands.js';

const id = (s: string) => asCharacterId(s);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const chainMail: Armor = {
  id: 'chain-mail',
  name: 'Chain Mail',
  category: 'heavy',
  baseAc: 16,
  acBonus: null,
  addsDexModifier: false,
  maxDexBonus: null,
  strengthRequirement: 13,
  stealthDisadvantage: true,
  weightLb: 55,
  cost: { amount: 75, currency: 'gp' },
};

const add = (name: string, maxHp: number, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
});

const pool = (who: string, level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: id(who),
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max,
    recovers: 'long-rest',
  },
});

/** Append a command's events to the log, and fold both. */
const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

/** A wizard with two level 1 slots and one level 2, a cleric, and a goblin. */
const table = (): GameEvent[] => [
  add('wizard', 24),
  add('cleric', 30, { spellcastingAbility: 'wis' }),
  add('goblin', 12),
  pool('wizard', 1, 2),
  pool('wizard', 2, 1),
  pool('cleric', 1, 2),
];

const HOLD = { spell: 'Hold Person', level: 2, concentration: true } as const;

describe('spending a spell slot', () => {
  it('expends a slot of the spell level', () => {
    const { state } = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(2))).toBe(0);
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(1))).toBe(2);
  });

  /**
   * SRD: "When a spellcaster casts a spell using a slot that is of a higher
   * level than the spell, the spell takes on the higher level for that
   * casting." The casting's level is the slot's, not the spell's.
   */
  it('takes on the higher level when upcast', () => {
    const { state, log } = run(table(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Magic Missile', level: 1, slotLevel: 2 }),
    );
    expect(log.find((e) => e.type === 'spell-cast')).toMatchObject({
      spell: 'Magic Missile',
      level: 2,
      slot: { level: 2 },
    });
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(2))).toBe(0);
  });

  it('refuses a slot smaller than the spell', () => {
    const before = fold('seed', table());
    const result = castSpell(before, id('wizard'), { ...HOLD, slotLevel: 1 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('slot_too_small');
  });

  it('refuses when that level has none left, spending nothing', () => {
    const { state, log } = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const result = castSpell(state, id('wizard'), { ...HOLD, slotLevel: 2 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_slot');
    expect(fold('seed', log)).toEqual(state);
  });

  it('refuses a slot level the caster never had a pool for', () => {
    const before = fold('seed', table());
    expect(isErr(castSpell(before, id('wizard'), { spell: 'Wish', level: 9, slotLevel: 9 }))).toBe(
      true,
    );
  });

  it('restores expended slots on a long rest', () => {
    const first = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const { state } = run(first.log, (s) => restoreResourcesOn(s, id('wizard'), 'long-rest'));
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(2))).toBe(1);
  });
});

describe('casting without a slot', () => {
  /** SRD: "A cantrip is cast without a spell slot." */
  it('casts a cantrip with no slot at all', () => {
    const { state } = run(table(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Fire Bolt', level: 0, slotless: 'cantrip' }),
    );
    expect(remaining(state.creatures.wizard!.resources, spellSlotKey(1))).toBe(2);
  });

  it('refuses a cantrip that tries to take a slot', () => {
    const before = fold('seed', table());
    expect(isErr(castSpell(before, id('wizard'), { spell: 'Fire Bolt', level: 0, slotLevel: 1 }))).toBe(
      true,
    );
  });

  it('refuses a level 1+ spell that names no slot and no reason to skip one', () => {
    const before = fold('seed', table());
    const result = castSpell(before, id('wizard'), { ...HOLD });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_slot_named');
  });

  it('refuses a casting that both takes a slot and claims to skip one', () => {
    const before = fold('seed', table());
    expect(isErr(castSpell(before, id('wizard'), { ...HOLD, slotLevel: 2, slotless: 'ritual' }))).toBe(
      true,
    );
  });

  /** Rituals, innate casting and magic items all skip the slot explicitly. */
  it('records why a slot was skipped', () => {
    const { log } = run(table(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Detect Magic', level: 1, slotless: 'ritual' }),
    );
    expect(log.find((e) => e.type === 'spell-cast')).toMatchObject({ slotless: 'ritual' });
  });
});

describe('one spell slot per turn', () => {
  const inCombat = (): GameEvent[] => [
    ...table(),
    {
      type: 'combat-started',
      combatants: [
        { id: id('wizard'), initiative: 20, speed: 30 },
        { id: id('goblin'), initiative: 5, speed: 30 },
      ],
    },
  ];

  /**
   * SRD: "On a turn, you can expend only one spell slot to cast a spell." The
   * 2014 restriction this replaced was about Bonus Action spells specifically;
   * this one is about slots, whatever the casting time.
   */
  it('refuses a second slot in the same turn', () => {
    const { state } = run(inCombat(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const result = castSpell(state, id('wizard'), {
      spell: 'Magic Missile',
      level: 1,
      slotLevel: 1,
      castingTime: 'bonus-action',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('slot_already_spent_this_turn');
  });

  it('still allows a cantrip after a slot', () => {
    const { state } = run(inCombat(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    expect(
      isErr(castSpell(state, id('wizard'), { spell: 'Fire Bolt', level: 0, slotless: 'cantrip' })),
    ).toBe(false);
  });

  it('frees the restriction on the next turn', () => {
    const first = run(inCombat(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const next = fold('seed', [...first.log, { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    expect(isErr(castSpell(next, id('wizard'), { spell: 'Magic Missile', level: 1, slotLevel: 1 }))).toBe(
      false,
    );
  });

  /** Outside combat there are no turns, so the restriction has nothing to bite on. */
  it('does not restrict casting out of combat', () => {
    const { state } = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    expect(isErr(castSpell(state, id('wizard'), { spell: 'Magic Missile', level: 1, slotLevel: 1 }))).toBe(
      false,
    );
  });
});

describe('a casting has a deterministic identity', () => {
  it('numbers castings in order, predictably, before the command runs', () => {
    const before = fold('seed', table());
    expect(nextCastingId(before)).toBe('cast:1');

    const { state, log } = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    expect(log.find((e) => e.type === 'spell-cast')).toMatchObject({ castingId: 'cast:1' });
    expect(nextCastingId(state)).toBe('cast:2');
  });

  it('reproduces the same ids on replay', () => {
    const { log } = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });
});

describe('starting, replacing and ending Concentration', () => {
  const held = () => run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));

  it('starts Concentration when the spell requires it', () => {
    const { state } = held();
    expect(state.creatures.wizard!.concentration).toEqual({
      castingId: 'cast:1',
      spell: 'Hold Person',
      level: 2,
    });
  });

  it('leaves Concentration alone for a spell that does not require it', () => {
    const { state } = run(table(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Magic Missile', level: 1, slotLevel: 1 }),
    );
    expect(state.creatures.wizard!.concentration).toBeNull();
  });

  /**
   * SRD: "You lose Concentration on an effect the moment you start casting a
   * spell that requires Concentration." The moment you *start* — so the old
   * effect is gone even if the new casting goes on to accomplish nothing.
   */
  it('drops the previous Concentration when a second one starts', () => {
    const first = held();
    const target = run(first.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    expect(target.state.creatures.goblin!.conditions.conditions).toContain('paralyzed');

    const second = run(target.log, (s) =>
      castSpell(s, id('wizard'), { spell: 'Faerie Fire', level: 1, concentration: true, slotLevel: 1 }),
    );
    expect(second.state.creatures.wizard!.concentration).toMatchObject({ spell: 'Faerie Fire' });
    expect(second.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  it('does not drop Concentration for a non-Concentration spell', () => {
    const first = held();
    const second = run(first.log, (s) =>
      castSpell(s, id('wizard'), { spell: 'Magic Missile', level: 1, slotLevel: 1 }),
    );
    expect(second.state.creatures.wizard!.concentration).toMatchObject({ spell: 'Hold Person' });
  });

  /** SRD: "The creator can end Concentration at any time (no action required)." */
  it('ends voluntarily, taking its effects with it', () => {
    const first = held();
    const target = run(first.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    const ended = run(target.log, (s) => endConcentration(s, id('wizard'), 'voluntary'));

    expect(ended.state.creatures.wizard!.concentration).toBeNull();
    expect(ended.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  it('refuses to end Concentration nobody is holding', () => {
    const before = fold('seed', table());
    const result = endConcentration(before, id('wizard'), 'voluntary');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_concentrating');
  });

  /** Breaking a casting must not disturb anything it did not create. */
  it('leaves an independent effect on the same target standing', () => {
    const first = held();
    const target = run(first.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    const poisoned = run(target.log, (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bad mushroom'));
    const ended = run(poisoned.log, (s) => endConcentration(s, id('wizard'), 'voluntary'));

    expect(ended.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
    expect(ended.state.creatures.goblin!.conditions.conditions).toContain('poisoned');
  });

  it('refuses to link an effect to a caster who is not concentrating', () => {
    const before = fold('seed', table());
    expect(isErr(applySpellEffect(before, id('goblin'), 'paralyzed', id('wizard')))).toBe(true);
  });
});

describe('two casters, the same spell, the same target', () => {
  /**
   * SRD: the effects of the same spell cast twice do not combine, and the
   * effect lasts until the later one ends. A condition is a boolean, so "most
   * potent" is degenerate — but each casting still owns its own instance, and
   * one caster losing Concentration must not end the other's spell.
   */
  it('keeps each casting independent', () => {
    const a = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const b = run(a.log, (s) => castSpell(s, id('cleric'), { ...HOLD, slotless: 'innate' }));

    const ea = run(b.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    const eb = run(ea.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('cleric')));

    expect(eb.state.creatures.goblin!.conditions.conditions).toContain('paralyzed');
    expect(
      eb.state.creatures.goblin!.conditions.instances.filter((i) => i.condition === 'paralyzed'),
    ).toHaveLength(2);

    // The wizard drops theirs; the cleric's Hold Person is still running.
    const dropped = run(eb.log, (s) => endConcentration(s, id('wizard'), 'voluntary'));
    expect(dropped.state.creatures.goblin!.conditions.conditions).toContain('paralyzed');
    expect(dropped.state.creatures.cleric!.concentration).toMatchObject({ castingId: 'cast:2' });

    // Now the cleric's too, and the paralysis finally lifts.
    const both = run(dropped.log, (s) => endConcentration(s, id('cleric'), 'voluntary'));
    expect(both.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });
});

describe('losing Concentration to damage', () => {
  const held = () => run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));

  it('asks for a save at the SRD DC', () => {
    const { state } = held();
    expect(concentrationSaveAfterDamage(state, id('wizard'), 7)).toMatchObject({
      castingId: 'cast:1',
      dc: 10,
      ability: 'con',
    });
    expect(concentrationSaveAfterDamage(state, id('wizard'), 30)?.dc).toBe(concentrationSaveDc(30));
  });

  /** SRD: "If you take damage" — nothing taken, nothing to save against. */
  it('asks for nothing on zero damage', () => {
    const { state } = held();
    expect(concentrationSaveAfterDamage(state, id('wizard'), 0)).toBeNull();
  });

  it('asks for nothing from a creature that is not concentrating', () => {
    const before = fold('seed', table());
    expect(concentrationSaveAfterDamage(before, id('cleric'), 12)).toBeNull();
  });

  /**
   * Temporary hit points soak the damage but they do not stop it being taken.
   * The DC comes from the damage after the target's defences and *before* the
   * temporary pool absorbs any of it — reading what reached hit points instead
   * would let a Warlock with Armor of Agathys concentrate through anything.
   */
  it('measures the damage before temporary hit points absorb it', () => {
    const first = held();
    const temp = run(first.log, (s) => grantTemporaryHpTo(s, id('wizard'), 40));
    const hurt = run(temp.log, (s) => damageCreature(s, id('wizard'), { amount: 30, source: 'Fireball' }));

    // Not a hit point lost.
    expect(hurt.state.creatures.wizard!.vitals.hp).toBe(24);
    expect(hurt.state.creatures.wizard!.vitals.temporaryHp).toBe(10);
    // But 30 damage was taken, so the DC is 15.
    expect(concentrationSaveAfterDamage(temp.state, id('wizard'), 30)?.dc).toBe(15);
  });

  /** Each hit is its own save: two tens are two DC 10 saves, not one DC 15. */
  it('keeps separate damage instances separate', () => {
    const { state } = held();
    expect(concentrationSaveAfterDamage(state, id('wizard'), 10)?.dc).toBe(10);
    expect(concentrationSaveAfterDamage(state, id('wizard'), 10)?.dc).toBe(10);
    expect(concentrationSaveAfterDamage(state, id('wizard'), 20)?.dc).toBe(10);
  });

  it('ends the spell when the save is failed', () => {
    const first = held();
    const target = run(first.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    const lost = run(target.log, (s) => endConcentration(s, id('wizard'), 'failed-save'));

    expect(lost.state.creatures.wizard!.concentration).toBeNull();
    expect(lost.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
    expect(lost.log.find((e) => e.type === 'concentration-ended')).toMatchObject({
      reason: 'failed-save',
    });
  });
});

describe('Concentration ends on Incapacitation or death', () => {
  const heldOn = (target: string) => {
    const a = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    return run(a.log, (s) => applySpellEffect(s, id(target), 'paralyzed', id('wizard')));
  };

  /** SRD Incapacitated: "No Concentration. Your Concentration is broken." */
  it('breaks when the caster falls unconscious at 0 hit points', () => {
    const { log } = heldOn('goblin');
    const dropped = run(log, (s) => damageCreature(s, id('wizard'), { amount: 24 }));

    expect(dropped.state.creatures.wizard!.conditions.conditions).toContain('unconscious');
    expect(dropped.state.creatures.wizard!.concentration).toBeNull();
    expect(dropped.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  it('breaks when something else Incapacitates the caster', () => {
    const { log } = heldOn('goblin');
    const stunned = run(log, (s) => applyConditionTo(s, id('wizard'), 'stunned', 'a thunderclap'));
    expect(stunned.state.creatures.wizard!.concentration).toBeNull();
    expect(stunned.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  /** SRD: "Your Concentration ends if you have the Incapacitated condition or you die." */
  it('breaks when the caster dies of Exhaustion', () => {
    const { log } = heldOn('goblin');
    const dead = run(log, (s) => setExhaustionLevel(s, id('wizard'), 6));
    expect(dead.state.creatures.wizard!.vitals.dead).toBe(true);
    expect(dead.state.creatures.wizard!.concentration).toBeNull();
    expect(dead.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  it('breaks when the caster leaves the game entirely', () => {
    const { log } = heldOn('goblin');
    const gone = run(log, (s) => removeCreatureEverywhere(s, id('wizard')));
    expect(gone.state.creatures.wizard).toBeUndefined();
    expect(gone.state.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
  });

  /** A caster who wakes up does not get the spell back. */
  it('does not resume when the caster is healed', () => {
    const { log } = heldOn('goblin');
    const dropped = run(log, (s) => damageCreature(s, id('wizard'), { amount: 24 }));
    const healed = run(dropped.log, (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bite'));
    expect(healed.state.creatures.wizard!.concentration).toBeNull();
  });

  /** The caster's own unconsciousness is still attributed to hit points. */
  it('leaves the rest of the zero-hit-point bookkeeping intact', () => {
    const { log } = heldOn('goblin');
    const dropped = run(log, (s) => damageCreature(s, id('wizard'), { amount: 24 }));
    expect(dropped.state.creatures.wizard!.conditions.instances.map((i) => i.source)).toContain(
      ZERO_HIT_POINTS,
    );
  });

  it('refuses to cast at all while Incapacitated', () => {
    const stunned = run(table(), (s) => applyConditionTo(s, id('wizard'), 'stunned', 'a thunderclap'));
    const result = castSpell(stunned.state, id('wizard'), { ...HOLD, slotLevel: 2 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('incapacitated');
    // And the slot survived the refusal.
    expect(remaining(stunned.state.creatures.wizard!.resources, spellSlotKey(2))).toBe(1);
  });
});

describe('a refusal costs nothing', () => {
  const cases: readonly (readonly [string, (s: GameState) => Result<GameEvent[]>])[] = [
    ['unknown caster', (s) => castSpell(s, id('ghost'), { ...HOLD, slotLevel: 2 })],
    ['slot too small', (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 1 })],
    ['no slot named', (s) => castSpell(s, id('wizard'), { ...HOLD })],
    ['bad level', (s) => castSpell(s, id('wizard'), { spell: 'Hold Person', level: 12, slotLevel: 2 })],
    ['empty name', (s) => castSpell(s, id('wizard'), { spell: '  ', level: 2, slotLevel: 2 })],
    [
      'forged link',
      (s) => castSpell(s, id('wizard'), { spell: 'Hold Person#cast:9', level: 2, slotLevel: 2 }),
    ],
    [
      'unsupported casting time',
      (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2, castingTime: 'long' }),
    ],
  ];

  it.each(cases)('%s changes nothing', (_name, command) => {
    const before = fold('seed', table());
    expect(isErr(command(before))).toBe(true);
    expect(fold('seed', table())).toEqual(before);
  });

  /** Casting rolls nothing, so no refusal can advance the generator either. */
  it('never advances the generator', () => {
    const before = fold('seed', table());
    for (const [, command] of cases) command(before);
    expect(before.rollsIssued).toBe(0);
    expect(before.rng).toBeNull();
  });

  /**
   * A spell whose casting time is a minute or more only expends its slot once
   * the casting completes, and time is not modelled yet — so the engine says
   * so rather than spending the slot at the wrong moment.
   */
  it('refuses a casting time of a minute or more, naming the rule', () => {
    const before = fold('seed', table());
    const result = castSpell(before, id('wizard'), { ...HOLD, slotLevel: 2, castingTime: 'long' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unsupported_casting_time');
  });

  /** SRD: "You must have training with any armor you are wearing to cast spells." */
  it('refuses to cast in armour the caster is not trained in', () => {
    const log: GameEvent[] = [
      add('sorcerer', 20, {
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        armor: chainMail,
      }),
      pool('sorcerer', 1, 2),
    ];
    const result = castSpell(fold('seed', log), id('sorcerer'), {
      spell: 'Magic Missile',
      level: 1,
      slotLevel: 1,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('untrained_armor');
  });
});

describe('commands are safe to retry', () => {
  /** Same state in, same events out — a retry cannot produce a different id. */
  it('produces identical events for a repeated command', () => {
    const before = fold('seed', table());
    const first = unwrap(castSpell(before, id('wizard'), { ...HOLD, slotLevel: 2 }), 'first');
    const second = unwrap(castSpell(before, id('wizard'), { ...HOLD, slotLevel: 2 }), 'second');
    expect(second).toEqual(first);
  });

  /**
   * Appending the same batch twice is a corrupt log, not a second casting.
   * Casting ids run in sequence, so a duplicate is caught rather than
   * silently spending a second slot under the first one's identity.
   */
  it('refuses a log that applies the same casting twice', () => {
    const before = fold('seed', table());
    const events = unwrap(castSpell(before, id('wizard'), { ...HOLD, slotLevel: 2 }), 'cast');
    expect(() => fold('seed', [...table(), ...events, ...events])).toThrow(/cast:1/);
  });

  it('refuses a casting id out of sequence', () => {
    expect(() =>
      fold('seed', [
        ...table(),
        {
          type: 'spell-cast',
          castingId: 'cast:7',
          id: id('wizard'),
          spell: 'Hold Person',
          level: 2,
          slot: { key: spellSlotKey(2), level: 2 },
          slotless: null,
          castingTime: 'action',
          concentration: true,
        },
      ]),
    ).toThrow();
  });
});

describe('the whole thing survives a round trip', () => {
  const played = (): GameEvent[] => {
    const a = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const b = run(a.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));
    const c = run(b.log, (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bad mushroom'));
    const d = run(c.log, (s) => grantTemporaryHpTo(s, id('wizard'), 5));
    const e = run(d.log, (s) => damageCreature(s, id('wizard'), { amount: 4 }));
    return e.log;
  };

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  /** Resources, Concentration and effect ownership all have to serialise. */
  it('survives JSON', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(revived.creatures.wizard!.concentration).toEqual({
      castingId: 'cast:1',
      spell: 'Hold Person',
      level: 2,
    });
    expect(remaining(revived.creatures.wizard!.resources, spellSlotKey(2))).toBe(0);
  });

  it('replays prefix by prefix to the same place', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
    expect(fold('seed', log.slice(0, log.length))).toEqual(fold('seed', log));
  });

  /** The link survives the round trip, so cleanup still works after a restore. */
  it('can still break Concentration after a restore', () => {
    const log = played();
    const restored = fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);
    const events = unwrap(endConcentration(restored, id('wizard'), 'voluntary'), 'end');
    const after = fold('seed', [...log, ...events]);
    expect(after.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
    expect(after.creatures.goblin!.conditions.conditions).toContain('poisoned');
  });

  it('ties the effect to the casting, not the spell name', () => {
    const state = fold('seed', played());
    const paralysis = state.creatures.goblin!.conditions.instances.find(
      (i) => i.condition === 'paralyzed',
    );
    expect(paralysis?.source).toBe(castingSource('Hold Person', 'cast:1'));
  });
});

describe('declaring pools', () => {
  it('refuses to declare a pool on a creature that is not here', () => {
    const before = fold('seed', table());
    expect(
      isErr(
        declareResourcePool(before, id('ghost'), {
          key: 'ki',
          label: 'Ki',
          max: 3,
          recovers: 'short-rest',
        }),
      ),
    ).toBe(true);
  });

  it('refuses to declare the same pool twice', () => {
    const before = fold('seed', table());
    expect(
      isErr(
        declareResourcePool(before, id('wizard'), {
          key: spellSlotKey(1),
          label: 'level 1 spell slot',
          max: 4,
          recovers: 'long-rest',
        }),
      ),
    ).toBe(true);
  });
});

describe('effects from a spell nobody is concentrating on', () => {
  /**
   * Not every ongoing spell needs Concentration — Blindness/Deafness runs for
   * a minute on its own. Those effects still belong to their casting, so the
   * caller builds the source from the id `nextCastingId` handed them before
   * the cast. `applySpellEffect` is the shortcut for the Concentration case
   * only, and says so rather than guessing which casting was meant.
   */
  it('links through the casting id the caller was given', () => {
    const before = fold('seed', table());
    const castingId = nextCastingId(before);

    const cast = run(table(), (s) =>
      castSpell(s, id('wizard'), { spell: 'Blindness/Deafness', level: 2, slotLevel: 2 }),
    );
    const blinded = run(cast.log, (s) =>
      applyConditionTo(s, id('goblin'), 'blinded', castingSource('Blindness/Deafness', castingId)),
    );

    expect(blinded.state.creatures.goblin!.conditions.conditions).toContain('blinded');
    expect(blinded.state.creatures.wizard!.concentration).toBeNull();
  });
});

describe('a linked source still reads as a spell name', () => {
  /**
   * The casting id lives inside the source so the link is exact, which means
   * the audit trail carries it too. A narration layer wants the readable half
   * and gets it from `spellOfSource`; nothing in the engine has to choose
   * between being precise and being legible.
   */
  it('keeps the whole source in the audit trail, readable half and all', () => {
    const cast = run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));
    const held = run(cast.log, (s) => applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')));

    const reasons = whyCondition(held.state, id('goblin'), 'paralyzed');
    expect(reasons).toEqual([castingSource('Hold Person', 'cast:1')]);
    expect(reasons.map(spellOfSource)).toEqual(['Hold Person']);
  });
});

describe('asking for the save after the damage, not before', () => {
  const held = () => run(table(), (s) => castSpell(s, id('wizard'), { ...HOLD, slotLevel: 2 }));

  /**
   * A caster dropped to 0 hit points is Unconscious, therefore Incapacitated,
   * therefore no longer concentrating — there is no save to make. Asking the
   * post-damage state gets that right; asking the pre-damage state would send
   * the DM off to roll a save for a spell that has already ended.
   */
  it('asks for nothing once the damage has knocked the caster out', () => {
    const first = held();
    const hurt = run(first.log, (s) => damageCreature(s, id('wizard'), { amount: 24 }));
    expect(concentrationSaveAfterDamage(hurt.state, id('wizard'), 24)).toBeNull();
  });

  it('still asks when the caster survived it', () => {
    const first = held();
    const hurt = run(first.log, (s) => damageCreature(s, id('wizard'), { amount: 12 }));
    expect(concentrationSaveAfterDamage(hurt.state, id('wizard'), 12)?.dc).toBe(10);
  });
});
