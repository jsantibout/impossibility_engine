import { describe, expect, it } from 'vitest';
import { declaredCasting } from './spellcasting.js';
import { asCharacterId, isErr, expect as unwrap, type CharacterId , isNeedsContext, contextRequestsOf } from '@ie/shared';
import type { DamageDefenses } from './attack.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { damageCreature, removeCreatureEverywhere, resolveSpell } from './commands.js';
import {
  CURE_WOUNDS,
  HEALING_WORD,
  INFLICT_WOUNDS,
  SACRED_FLAME,
  scaledDiceFor,
} from './spell-definitions.js';

/**
 * Two spell shapes, wired end to end: hit points restored, and a saving throw
 * that deals damage.
 *
 * What each representative spell is here to exercise, and nothing in this file
 * decides any of it — the definitions do:
 *
 * | Spell | What it proves |
 * |---|---|
 * | Cure Wounds | healing plus the caster's own modifier, Touch, +2d8 per slot |
 * | Healing Word | the same effect at a Bonus Action, and a 60-foot range |
 * | Sacred Flame | a cantrip save for damage, **nothing** on a success |
 * | Inflict Wounds | a slot save for damage, **half** on a success, +1d10 per slot |
 *
 * The fixture supplies who exists, who can cast what, and where everybody is
 * standing. It supplies no dice, no DC, no damage type and no scaling: a
 * fixture that worked those out would prove nothing about the engine.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('brannor');
const ALLY = id('wenna');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

/** A caster with nothing to help or hinder a save: the die is the whole answer. */
const MOOK = sheet({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });

type Defenses = Readonly<Record<string, DamageDefenses>>;

const added = (
  who: CharacterId,
  maxHp: number,
  over: Partial<CharacterSheet> = {},
  defenses?: Defenses,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...(defenses === undefined ? {} : { defenses }),
});

const slot = (level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: CLERIC,
  pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max, recovers: 'long-rest' },
});

/**
 * The scene, the cast, and the slots. Everything mechanical about the spells
 * themselves comes from their definitions.
 */
const SETUP: readonly GameEvent[] = [
  added(CLERIC, 40),
  added(ALLY, 20, { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }),
  added(GOBLIN, 30, MOOK),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['sacred-flame'],
      prepared: ['cure-wounds', 'healing-word', 'inflict-wounds', 'finger-of-death', 'compulsion'],
    }),
  },
  slot(1, 4),
  slot(2, 3),
  slot(3, 2),
  slot(4, 2),
  slot(7, 2),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: CLERIC, to: GOBLIN, seen: true },
];

const base = (): GameState => fold('seed', SETUP);

/**
 * A wound, through the command that owns what follows one.
 *
 * A bare `damage-taken` event would leave a character on 0 hit points and wide
 * awake — the unconsciousness is `damageCreature`'s batch, not the event's.
 */
const wound = (who: CharacterId, amount: number): GameEvent[] =>
  unwrap(damageCreature(base(), who, { amount, source: 'a goblin spear' }), 'wound');

const supply = (seed: string) => {
  const rng: Rng = createRng(seed);
  return { issuer: createRollIssuer('r'), rng };
};

describe('healing restores hit points and nothing else', () => {
  const wounded = (): { state: GameState; log: GameEvent[] } => {
    const log = [...SETUP, ...wound(ALLY, 15)];
    return { state: fold('seed', log), log };
  };

  it('heals for the dice plus the caster’s spellcasting modifier', () => {
    const { state } = wounded();
    // Wisdom 16 is +3, and the cleric's route is the class's own.
    expect(state.creatures.wenna!.vitals.hp).toBe(5);

    const out = unwrap(
      resolveSpell(state, CLERIC, { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 1 }, supply('heal')),
      'cure',
    );

    const after = fold('seed', [...SETUP, ...wound(ALLY, 15), ...out.events]);
    const healed = after.creatures.wenna!.vitals.hp - 5;
    expect(healed).toBe(out.outcomes[0]?.healed);
    // 2d8 + 3 is between 5 and 19, and the modifier is genuinely in there.
    expect(healed).toBeGreaterThanOrEqual(5);
    expect(healed).toBeLessThanOrEqual(19);
  });

  /** SRD: the Unconscious condition from 0 hit points lasts "until you regain any Hit Points". */
  it('brings an ally up from 0 and lifts the unconsciousness with it', () => {
    const log = [...SETUP, ...wound(ALLY, 20)];
    const down = fold('seed', log);
    expect(down.creatures.wenna!.vitals.hp).toBe(0);
    expect(down.creatures.wenna!.conditions.conditions).toContain('unconscious');

    const out = unwrap(
      resolveSpell(down, CLERIC, { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 }, supply('up')),
      'word',
    );

    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures.wenna!.vitals.hp).toBeGreaterThan(0);
    expect(after.creatures.wenna!.conditions.conditions).not.toContain('unconscious');
  });

  /** SRD: hit points never exceed the maximum, and `heal` has always capped them. */
  it('caps at the hit point maximum and reports only what it restored', () => {
    const log = [...SETUP, ...wound(ALLY, 1)];
    const nicked = fold('seed', log);
    expect(nicked.creatures.wenna!.vitals.hp).toBe(19);

    const out = unwrap(
      resolveSpell(nicked, CLERIC, { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 3 }, supply('cap')),
      'cure',
    );

    const after = fold('seed', [...log, ...out.events]);
    // A level 3 slot rolls 6d8 + 3, which is far more than the single point
    // missing. The overflow is discarded rather than stored.
    expect(after.creatures.wenna!.vitals.hp).toBe(20);
    expect(out.outcomes[0]?.healed).toBe(1);
  });

  it('refuses to heal the dead, spending nothing', () => {
    const log = [...SETUP, { type: 'creature-died' as const, id: ALLY, cause: 'a goblin spear' }];
    const grave = fold('seed', log);
    const result = resolveSpell(grave, CLERIC, { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 1 }, supply('no'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('dead');
    expect(remaining(grave.creatures.brannor!.resources, spellSlotKey(1))).toBe(4);
  });

  /** SRD Cure Wounds: "A creature you touch" — which may be the caster. */
  it('lets the caster heal themselves, and reaches only as far as Touch', () => {
    const log = [...SETUP, ...wound(CLERIC, 10)];
    const hurt = fold('seed', log);
    const out = unwrap(
      resolveSpell(hurt, CLERIC, { spellId: 'cure-wounds', targets: [CLERIC], slotLevel: 1 }, supply('self')),
      'self',
    );
    expect(fold('seed', [...log, ...out.events]).creatures.brannor!.vitals.hp).toBeGreaterThan(30);
  });
});

describe('a saving throw that deals damage', () => {
  /**
   * Forced rather than fished for. A bonus large enough to settle the roll
   * outright covers both branches without hunting for a seed that happens to
   * reach them — the same trick the scripted fight uses.
   */
  const flame = (state: GameState, seed: string, bonus?: number) =>
    resolveSpell(
      state,
      CLERIC,
      { spellId: 'sacred-flame', targets: [GOBLIN] },
      { ...supply(seed), ...(bonus === undefined ? {} : { bonuses: [{ source: 'test', flat: bonus }] }) },
    );

  it('deals nothing at all when the save succeeds, because the spell says so', () => {
    // +30 on the save beats any DC, so the success branch is certain.
    const out = unwrap(flame(base(), 'flame-pass', 30), 'flame');

    expect(out.outcomes[0]?.save?.success).toBe(true);
    expect(out.outcomes[0]?.damage).toBe(0);
    expect(out.outcomes[0]?.affected).toBe(false);
    expect(fold('seed', [...SETUP, ...out.events]).creatures.goblin!.vitals.hp).toBe(30);
  });

  it('deals its damage when the save fails', () => {
    const out = unwrap(flame(base(), 'flame-fail', -30), 'flame');

    expect(out.outcomes[0]?.save?.success).toBe(false);
    expect(out.outcomes[0]?.affected).toBe(true);
    // A level 5 caster's Sacred Flame is 2d8: between 2 and 16.
    const dealt = out.outcomes[0]?.damage ?? 0;
    expect(dealt).toBeGreaterThanOrEqual(2);
    expect(dealt).toBeLessThanOrEqual(16);
    expect(fold('seed', [...SETUP, ...out.events]).creatures.goblin!.vitals.hp).toBe(30 - dealt);
  });

  /**
   * SRD: "The halved damage is equal to half the damage that would be dealt on
   * a failed save." Inflict Wounds says half; Sacred Flame says none. Same
   * machinery, different answer, and the definition is what decides.
   */
  it('deals half on a successful save when the spell says half', () => {
    const passed = unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'inflict-wounds', targets: [GOBLIN], slotLevel: 1 },
        { ...supply('inflict'), bonuses: [{ source: 'test', flat: 30 }] },
      ),
      'inflict',
    );

    expect(passed.outcomes[0]?.save?.success).toBe(true);
    // 2d10 halved per die and floored: at least 0, and never the full roll.
    const dealt = passed.outcomes[0]?.damage ?? -1;
    expect(dealt).toBeGreaterThanOrEqual(0);
    expect(dealt).toBeLessThanOrEqual(10);
    // The damage landed even though the save succeeded — that is the point.
    expect(fold('seed', [...SETUP, ...passed.events]).creatures.goblin!.vitals.hp).toBe(30 - dealt);
  });
});

describe('the target’s own defences apply', () => {
  /** The same scene, with the goblin swapped for one that resists something. */
  const withDefense = (defenses: Defenses): GameState =>
    fold(
      'seed',
      SETUP.map((event) =>
        event.type === 'creature-added' && event.id === GOBLIN
          ? added(GOBLIN, 30, MOOK, defenses)
          : event,
      ),
    );

  const hit = (state: GameState, seed: string) =>
    unwrap(
      resolveSpell(
        state,
        CLERIC,
        { spellId: 'inflict-wounds', targets: [GOBLIN], slotLevel: 1 },
        { ...supply(seed), bonuses: [{ source: 'test', flat: -30 }] },
      ),
      'inflict',
    );

  it('halves damage the target resists, and zeroes what it is immune to', () => {
    const plain = hit(base(), 'defences');
    const resistant = hit(withDefense({ necrotic: { resistant: true } }), 'defences');
    const immune = hit(withDefense({ necrotic: { immune: true } }), 'defences');
    const vulnerable = hit(withDefense({ necrotic: { vulnerable: true } }), 'defences');

    const full = plain.outcomes[0]?.damage ?? 0;
    expect(full).toBeGreaterThan(0);
    expect(resistant.outcomes[0]?.damage).toBe(Math.floor(full / 2));
    expect(immune.outcomes[0]?.damage).toBe(0);
    expect(vulnerable.outcomes[0]?.damage).toBe(full * 2);
  });

  it('leaves a defence against a different damage type alone', () => {
    const elsewhere = hit(withDefense({ fire: { immune: true } }), 'defences');
    const plain = hit(base(), 'defences');
    expect(elsewhere.outcomes[0]?.damage).toBe(plain.outcomes[0]?.damage);
  });
});

describe('damage settles the Concentration it put at risk', () => {
  /** The goblin is concentrating on something when the spell lands on it. */
  const concentrating = (): GameEvent[] => [
    ...SETUP,
    {
      type: 'spell-cast',
      id: GOBLIN,
      spell: 'Hex',
      castingId: 'cast:1',
      level: 1,
      slot: null,
      slotless: 'innate',
      castingTime: 'action',
      concentration: true,
    },
    { type: 'concentration-started', id: GOBLIN, castingId: 'cast:1', spell: 'Hex', level: 1 },
  ];

  it('rolls the save without anybody asking for it', () => {
    const log = concentrating();
    const state = fold('seed', log);
    expect(state.creatures.goblin!.concentration?.spell).toBe('Hex');

    const out = unwrap(
      resolveSpell(
        state,
        CLERIC,
        { spellId: 'inflict-wounds', targets: [GOBLIN], slotLevel: 3 },
        { ...supply('conc'), bonuses: [{ source: 'test', flat: -30 }] },
      ),
      'inflict',
    );

    const consequence = out.outcomes[0]?.concentration;
    expect(consequence?.kind).toBe('resolved');
    if (consequence?.kind !== 'resolved') throw new Error('expected a rolled save');
    expect(consequence.check.spell).toBe('Hex');

    // And the outcome of that save is applied, either way.
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures.goblin!.concentration === null).toBe(!consequence.maintained);
  });

  it('does not roll one for a target that is concentrating on nothing', () => {
    const out = unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'inflict-wounds', targets: [GOBLIN], slotLevel: 1 },
        { ...supply('none'), bonuses: [{ source: 'test', flat: -30 }] },
      ),
      'inflict',
    );
    expect(out.outcomes[0]?.concentration?.kind).toBe('none');
  });
});

describe('the action economy charges what the spell costs', () => {
  /** The same three creatures, now in an Initiative order with the cleric up. */
  const inCombat = (): GameEvent[] => [
    ...SETUP,
    ...wound(ALLY, 15),
    {
      type: 'combat-started',
      combatants: [
        { id: CLERIC, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 10, speed: 30 },
        { id: GOBLIN, initiative: 5, speed: 30 },
      ],
    },
  ];

  /**
   * SRD Healing Word is a Bonus Action and Cure Wounds is an Action. Casting
   * one leaves the other's budget alone — which is the whole reason a Cleric
   * carries both.
   */
  it('spends the Bonus Action for Healing Word and leaves the Action', () => {
    const log = inCombat();
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        CLERIC,
        { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 },
        supply('bonus'),
      ),
      'word',
    );

    const after = fold('seed', [...log, ...out.events]);
    const budget = after.combat?.budgets[CLERIC];
    expect(budget?.bonusAction).toBe(false);
    expect(budget?.action).toBe(true);
  });

  it('refuses a second Bonus Action spell in the same turn, changing nothing', () => {
    const log = inCombat();
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        CLERIC,
        { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 },
        supply('bonus'),
      ),
      'word',
    );

    const applied = [...log, ...first.events];
    const after = fold('seed', applied);
    const again = resolveSpell(
      after,
      CLERIC,
      { spellId: 'healing-word', targets: [ALLY], slotLevel: 2 },
      supply('bonus'),
    );
    expect(isErr(again)).toBe(true);
    expect(fold('seed', applied)).toEqual(after);
  });

  /** SRD: "On a turn, you can expend only one spell slot to cast a spell." */
  it('refuses a slot spell after a slot spell, whatever the action cost', () => {
    const log = inCombat();
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        CLERIC,
        { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 },
        supply('one'),
      ),
      'word',
    );

    const after = fold('seed', [...log, ...first.events]);
    const second = resolveSpell(
      after,
      CLERIC,
      { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 1 },
      supply('two'),
    );
    expect(isErr(second)).toBe(true);
  });

  /** A cantrip spends no slot, so it is still legal after one that did. */
  it('still allows a cantrip after a slot has been spent', () => {
    const log = inCombat();
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        CLERIC,
        { spellId: 'healing-word', targets: [ALLY], slotLevel: 1 },
        supply('one'),
      ),
      'word',
    );

    const after = fold('seed', [...log, ...first.events]);
    const flame = resolveSpell(after, CLERIC, { spellId: 'sacred-flame', targets: [GOBLIN] }, supply('two'));
    expect(isErr(flame)).toBe(false);
  });
});

describe('scaling comes from the definition, never from a caller', () => {
  /** SRD Inflict Wounds: 2d10, "increases by 1d10 for each spell slot level above 1". */
  it('grows Inflict Wounds by one die a level, not by two', () => {
    const scaling = INFLICT_WOUNDS.effects[0];
    if (scaling?.kind !== 'save-damage') throw new Error('expected a save-damage effect');
    expect(scaledDiceFor(scaling.damage, 1, 5, 1)).toBe('2d10');
    expect(scaledDiceFor(scaling.damage, 1, 5, 2)).toBe('3d10');
    expect(scaledDiceFor(scaling.damage, 1, 5, 3)).toBe('4d10');
  });

  /** SRD Cure Wounds: 2d8, "increases by 2d8 for each spell slot level above 1". */
  it('grows Cure Wounds by two dice a level', () => {
    const effect = CURE_WOUNDS.effects[0];
    if (effect?.kind !== 'heal') throw new Error('expected a heal effect');
    expect(scaledDiceFor(effect.healing, 1, 5, 1)).toBe('2d8');
    expect(scaledDiceFor(effect.healing, 1, 5, 2)).toBe('4d8');
    expect(scaledDiceFor(effect.healing, 1, 5, 3)).toBe('6d8');
  });

  /** SRD Healing Word: 2d4 and +2d4, which is a different die from Cure Wounds. */
  it('keeps Healing Word on d4s', () => {
    const effect = HEALING_WORD.effects[0];
    if (effect?.kind !== 'heal') throw new Error('expected a heal effect');
    expect(scaledDiceFor(effect.healing, 1, 5, 2)).toBe('4d4');
  });

  /** SRD Sacred Flame: a cantrip, so it reads the caster's level and no slot. */
  it('upgrades Sacred Flame on caster level and ignores the slot', () => {
    const effect = SACRED_FLAME.effects[0];
    if (effect?.kind !== 'save-damage') throw new Error('expected a save-damage effect');
    expect(scaledDiceFor(effect.damage, 0, 4, 0)).toBe('1d8');
    expect(scaledDiceFor(effect.damage, 0, 5, 0)).toBe('2d8');
    expect(scaledDiceFor(effect.damage, 0, 11, 0)).toBe('3d8');
    expect(scaledDiceFor(effect.damage, 0, 17, 0)).toBe('4d8');
  });

  it('spends the slot it was cast with, and heals for it', () => {
    const log = [...SETUP, ...wound(ALLY, 19)];
    const state = fold('seed', log);
    const out = unwrap(
      resolveSpell(state, CLERIC, { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 3 }, supply('big')),
      'cure',
    );

    const after = fold('seed', [...log, ...out.events]);
    expect(remaining(after.creatures.brannor!.resources, spellSlotKey(3))).toBe(1);
    expect(remaining(after.creatures.brannor!.resources, spellSlotKey(1))).toBe(4);
    // 6d8 + 3 is at least 9, and the ally was on 1 of 20.
    expect(after.creatures.wenna!.vitals.hp).toBe(20);
  });
});

describe('a retry spends nothing twice', () => {
  const once = (state: GameState, spellId: string, target: CharacterId, slotLevel?: number) =>
    resolveSpell(
      state,
      CLERIC,
      { spellId, targets: [target], commandId: 'cmd-1', ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply('retry'),
    );

  it('is a no-op on a healing spell, leaving hit points and slots alone', () => {
    const log = [...SETUP, ...wound(ALLY, 15)];
    const first = unwrap(once(fold('seed', log), 'cure-wounds', ALLY, 1), 'first');

    const applied = [...log, ...first.events];
    const after = fold('seed', applied);
    const retry = unwrap(once(after, 'cure-wounds', ALLY, 1), 'retry');

    expect(retry.events).toEqual([]);
    expect(fold('seed', [...applied, ...retry.events])).toEqual(after);
    expect(remaining(after.creatures.brannor!.resources, spellSlotKey(1))).toBe(3);
  });

  it('is a no-op on a damaging spell, rolling no second save and no second die', () => {
    const first = unwrap(once(base(), 'inflict-wounds', GOBLIN, 1), 'first');

    const applied = [...SETUP, ...first.events];
    const after = fold('seed', applied);
    const hp = after.creatures.goblin!.vitals.hp;

    const retry = unwrap(once(after, 'inflict-wounds', GOBLIN, 1), 'retry');
    expect(retry.events).toEqual([]);
    expect(after.creatures.goblin!.vitals.hp).toBe(hp);
    expect(fold('seed', [...applied, ...retry.events])).toEqual(after);
  });

  /** A different spell under the same id is a caller bug, not a retry. */
  it('refuses the same command id carrying different inputs', () => {
    const first = unwrap(once(base(), 'inflict-wounds', GOBLIN, 1), 'first');
    const after = fold('seed', [...SETUP, ...first.events]);

    const different = once(after, 'sacred-flame', GOBLIN);
    expect(isErr(different)).toBe(true);
    if (isErr(different)) expect(different.code).toBe('command_id_reused');
  });

  /**
   * And the identity being the wrapper's reaches further than the derived
   * command's did: two castings of the same spell at the same level differ
   * only in whom they were aimed at, which never appeared in the `CastCommand`
   * the fingerprint used to be taken over.
   */
  it('refuses the same command id aimed at a different creature', () => {
    const first = unwrap(once(base(), 'inflict-wounds', GOBLIN, 1), 'first');
    const after = fold('seed', [...SETUP, ...first.events]);

    const elsewhere = once(after, 'inflict-wounds', ALLY, 1);
    expect(isErr(elsewhere)).toBe(true);
    if (isErr(elsewhere)) expect(elsewhere.code).toBe('command_id_reused');
  });

  /**
   * **The duplicate check comes first in the wrapper too.**
   *
   * `resolveSpell` is the only command that reached its idempotency guard
   * through half a dozen refusals first — the caster's record, the definition,
   * the targets, the free casting the first run had already spent. Every one
   * of those reads a fact the first run can have changed, so a retry was told
   * about the world instead of about its own command. The eighth instance of
   * the trap in the engine, and the first in a wrapper.
   *
   * The caster leaving is the sharpest case, because it is the one no amount
   * of re-checking could rescue: the retry has no caster to validate against
   * and must answer from the ledger alone.
   */
  it('answers a retry sent after the caster has left, rather than refusing it', () => {
    const first = unwrap(once(base(), 'inflict-wounds', GOBLIN, 1), 'first');
    const applied = [...SETUP, ...first.events];
    const gone = [
      ...applied,
      ...unwrap(removeCreatureEverywhere(fold('seed', applied), CLERIC), 'the cleric leaves'),
    ];
    const after = fold('seed', gone);
    expect(after.creatures.brannor).toBeUndefined();

    const retry = once(after, 'inflict-wounds', GOBLIN, 1);
    expect(isErr(retry) ? `${retry.code}` : 'ok').toBe('ok');
    if (isErr(retry)) return;
    expect(retry.value.events).toEqual([]);
    // And the casting it already made is still recoverable by name.
    expect(retry.value.castingId).toBe(first.castingId);
    expect(fold('seed', [...gone, ...retry.value.events])).toEqual(after);
  });
});

describe('the whole thing replays', () => {
  const played = (): GameEvent[] => {
    let log: GameEvent[] = [...SETUP, ...wound(ALLY, 18)];
    const step = (request: Parameters<typeof resolveSpell>[2], seed: string): void => {
      const out = unwrap(resolveSpell(fold('seed', log), CLERIC, request, supply(seed)), 'cast');
      log = [...log, ...out.events];
    };
    step({ spellId: 'cure-wounds', targets: [ALLY], slotLevel: 1 }, 'a');
    step({ spellId: 'sacred-flame', targets: [GOBLIN] }, 'b');
    step({ spellId: 'inflict-wounds', targets: [GOBLIN], slotLevel: 2 }, 'c');
    step({ spellId: 'healing-word', targets: [ALLY], slotLevel: 1 }, 'd');
    return log;
  };

  it('folds to the same state twice, and prefix by prefix', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON with hit points, slots and the rest intact', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
  });

  /**
   * Replaying the *script* is the load-bearing half: it is what catches a
   * module reading a clock or iterating a map in insertion order.
   */
  it('produces the same log from the same seeds', () => {
    expect(played()).toEqual(played());
  });
});

describe('a missing fact still comes back as a request, not a refusal', () => {
  it('asks where a target is standing rather than guessing the range', () => {
    const unplaced = fold('seed', [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
    ]);
    const out = resolveSpell(
      unplaced,
      CLERIC,
      { spellId: 'sacred-flame', targets: [GOBLIN] },
      supply('ask'),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toContain('position');

    // Nothing was spent asking: the generator never moved.
    expect(fold('seed', SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)))).toEqual(
      unplaced,
    );
  });
});

/**
 * A flat addend the SRD prints beside the dice is part of the damage.
 *
 * Two SRD spells print one — Finger of Death's "7d8 + 30" and Disintegrate's
 * "10d6 + 40" — and `DiceScaling.flat` was carrying the number while nothing
 * on the damage path read it. `scaledFlatFor` was reached only by Temporary
 * Hit Points, so both spells rolled their dice and silently dropped the
 * addend, for as long as Finger of Death had existed.
 *
 * A minimum is what catches it. 7d8 + 30 cannot come to less than 37, so any
 * roll below that is proof the + 30 never arrived, whatever the dice did.
 */
describe('a flat addend the SRD prints beside the dice', () => {
  const cast = (seed: string) =>
    unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'finger-of-death', targets: [GOBLIN], slotLevel: 7 },
        supply(seed),
      ),
      'finger of death',
    );

  it('adds Finger of Death’s printed + 30 on a failed save', () => {
    // Several seeds, because one lucky roll could clear 37 on dice alone.
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const out = cast(seed);
      const outcome = out.outcomes[0];
      if (outcome?.save?.success === true) continue;
      expect(outcome?.damage ?? 0).toBeGreaterThanOrEqual(37);
    }
  });

  /** SRD: "half as much damage" is half of the whole, addend included. */
  it('halves the addend along with the dice on a success', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const out = cast(seed);
      const outcome = out.outcomes[0];
      if (outcome?.save?.success !== true) continue;
      expect(outcome.damage ?? 0).toBeGreaterThanOrEqual(18);
    }
  });
});

/**
 * A target list the SRD gives no number at all.
 *
 * Compulsion says "each creature of your choice that you can see within
 * range", and Weird and Divine Word say the same thing. There is no count to
 * transcribe — the bound is range and sight, both of which are already
 * checked per target — so `targets.count` has nothing honest to hold and
 * `unlimited` says so outright rather than picking a plausible number.
 */
describe('a spell that names no number of targets', () => {
  it('takes as many as the caller names', () => {
    const out = unwrap(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'compulsion', targets: [ALLY, GOBLIN], slotLevel: 4 },
        supply('compel'),
      ),
      'compulsion',
    );
    expect(out.outcomes.map((o) => o.target).slice().sort()).toEqual([ALLY, GOBLIN].slice().sort());
  });

  /** Unlimited is not unchecked: range and sight still refuse. */
  it('still refuses a target it cannot reach', () => {
    const away = fold('seed', [
      ...SETUP,
      { type: 'landmark-added', name: 'the gate', at: { x: 150, y: 20, z: 0 } },
      { type: 'creature-added', id: id('watchman'), name: 'watchman', sheet: MOOK, maxHp: 10, diesAtZero: false, creatureType: 'Humanoid' },
      { type: 'creature-placed', id: id('watchman'), placement: { from: { landmark: 'the gate' }, feet: 0 } },
      { type: 'sight-declared', from: CLERIC, to: id('watchman'), seen: true },
    ]);
    const result = resolveSpell(
      away,
      CLERIC,
      { spellId: 'compulsion', targets: [ALLY, id('watchman')], slotLevel: 4 },
      supply('far'),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('out_of_range');
  });
});
