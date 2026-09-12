import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveTurn, damageCreature } from './commands.js';
import { planCharacter, type CharacterChoices } from './creation.js';
import { SNEAK_ATTACK_DICE } from './rogue.js';

/**
 * Extra damage a feature adds to a hit, **once per turn**.
 *
 * Four SRD features say it — Sneak Attack, Colossus Slayer, Divine Strike,
 * Primal Strike — which is what makes the allowance a shape rather than one
 * class's quirk. The qualifications are each feature's own sentence and stay
 * separate; the allowance is shared and lives in the turn budget beside the
 * one-spell-slot-per-turn rule, for the same reason that rule records a turn
 * number rather than a flag:
 *
 * > **It is once per *a* turn, not once per *your* turn.**
 *
 * A Rogue who Sneak Attacked on their own turn may Sneak Attack again on the
 * Opportunity Attack they take during the Fighter's, because that is a
 * different turn. A flag cleared by the budget refresh would be cleared at the
 * start of the Rogue's *own* turn — the one moment it does not matter — and
 * would go on blocking every Reaction in between. That single distinction is
 * the reason this file exists.
 */

const id = (s: string) => asCharacterId(s);
const ROGUE = id('rogue');
const RANGER = id('ranger');
const THUG = id('thug');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

/**
 * A real Rogue and a real Hunter, built through creation rather than
 * hand-assembled.
 *
 * The whole point of the batch is that the dice come off the class table at
 * the character's own class level, so a fixture that wrote `standing` by hand
 * would be testing the fixture.
 */
const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const rogueChoices = (level: number): CharacterChoices => ({
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    ...(level >= 6
      ? { 'rogue:second-expertise': ['acrobatics', 'investigation'] }
      : {}),
  },
  ...(level >= 3 ? { subclassId: 'thief' } : {}),
  ...(level >= 4
    ? {
        feats: {
          ...common.feats,
          'rogue:ability-score-improvement': { featId: 'savage-attacker' },
        },
      }
    : {}),
});

const rogueSheet = (level: number): CharacterSheet =>
  unwrap(planCharacter(rogueChoices(level)), `rogue ${level}`).sheet;

const hunterChoices = (option: string): CharacterChoices => ({
  ...common,
  name: 'Sorrel',
  classId: 'ranger',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['survival', 'perception', 'stealth'],
  subclassId: 'hunter',
  cantrips: [],
  preparedSpells: ['cure-wounds', 'animal-friendship', 'ensnaring-strike', 'goodberry'],
  featureChoices: {
    'human:skillful': ['athletics'],
    'ranger:deft-explorer': ['survival'],
    "hunter:hunters-prey": [option],
  },
  feats: { ...common.feats, 'ranger:fighting-style': { featId: 'archery' } },
});

const hunterSheet = (option: string): CharacterSheet =>
  unwrap(planCharacter(hunterChoices(option)), option).sheet;

const added = (
  who: CharacterId,
  side: string,
  character: CharacterSheet,
  maxHp = 60,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: character,
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const at = (who: CharacterId, from: CharacterId, feet: number, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

const kit = (who: CharacterId, items: readonly string[]): GameEvent => ({
  type: 'items-gained',
  id: who,
  items: items.map((i) => ({ id: i, quantity: 1 })),
  source: 'kit',
});

const table = (level = 5): readonly GameEvent[] => [
  added(ROGUE, 'party', rogueSheet(level)),
  added(THUG, 'thugs', sheet({ abilities: { str: 14, dex: 10, con: 12, int: 10, wis: 10, cha: 10 } })),
  added(ALLY, 'party', sheet()),
  kit(ROGUE, ['dagger', 'shortbow', 'mace', 'shortsword']),
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the alley', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the alley' }, feet: 0 } },
  at(THUG, ROGUE, 5, 0),
  // Well clear, so the ally clause only fires when a test moves them in.
  at(ALLY, ROGUE, 100, 90),
];

/** In combat, Rogue first. Once-per-turn means nothing where nobody takes turns. */
const fighting = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  {
    type: 'combat-started',
    combatants: [
      { id: ROGUE, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
      { id: ALLY, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'stab') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/**
 * Swing with the attack roll forced to land, so the test is about the rider.
 *
 * A huge flat bonus rather than a lucky seed: the qualification under test is
 * whether the *feature* applied, and a miss would answer nothing.
 */
const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  who: CharacterId = ROGUE,
  seed = 'stab',
) => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      who,
      { ...request, attackBonuses: [{ source: 'forced', flat: 40 }, ...(request.attackBonuses ?? [])] },
      supply(seed),
    ),
    'attack',
  );
  if (out.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
  return { ...out, log: [...log, ...out.events], state: fold('seed', [...log, ...out.events]) };
};

/** Whether this batch spent the allowance of a named feature. */
const spent = (events: readonly GameEvent[], feature: string): boolean =>
  events.some((e) => e.type === 'feature-used' && e.feature === feature);

/** Total damage the attack dealt, which is how a rider is measured. */
const dealt = (out: { readonly damage?: number }): number => out.damage ?? 0;

describe('a real Rogue has Sneak Attack, and it comes off the class table', () => {
  it('scales with Rogue level rather than character level', () => {
    for (const level of [1, 3, 5, 11, 17]) {
      const rider = rogueSheet(level).standing?.find((e) => e.feature === 'rogue:sneak-attack');
      expect(rider, `level ${level}`).toBeDefined();
      if (rider?.grant.kind !== 'attack-damage') throw new Error('expected attack damage');
      expect(rider.grant.dice, `level ${level}`).toBe(`${SNEAK_ATTACK_DICE[level - 1]}d6`);
    }
  });

  /** SRD: "The extra damage's type is the same as the weapon's type." */
  it('is a bonus of the weapon’s own type, not extra typed damage', () => {
    const rider = rogueSheet(5).standing?.find((e) => e.feature === 'rogue:sneak-attack');
    if (rider?.grant.kind !== 'attack-damage') throw new Error('expected attack damage');
    expect(rider.grant.damageType).toBeUndefined();
  });
});

describe('Sneak Attack qualifies the way the SRD says it does', () => {
  /** SRD: "if you have Advantage on the roll and the attack uses a Finesse or a Ranged weapon." */
  it('applies with Advantage and a Finesse weapon', () => {
    const plain = swing(fighting(table()), { target: THUG, weapon: 'dagger' });
    const sneaky = swing(fighting(table()), {
      target: THUG,
      weapon: 'dagger',
      modes: [{ source: 'hidden', mode: 'advantage' }],
    });
    expect(dealt(sneaky)).toBeGreaterThan(dealt(plain));
    expect(spent(sneaky.events, 'rogue:sneak-attack')).toBe(true);
    expect(spent(plain.events, 'rogue:sneak-attack')).toBe(false);
  });

  it('applies with Advantage and a Ranged weapon', () => {
    // At range: a Ranged attack with an enemy within 5 feet has Disadvantage,
    // which would cancel the Advantage and settle the question the wrong way
    // round. Shooting the distant ally-side dummy keeps the roll clean.
    const far: readonly GameEvent[] = [
      ...table().filter((e) => !(e.type === 'creature-placed' && e.id === THUG)),
      at(THUG, ROGUE, 60, 0),
    ];
    const out = swing(fighting(far), {
      target: THUG,
      weapon: 'shortbow',
      modes: [{ source: 'hidden', mode: 'advantage' }],
    });
    expect(out.attack?.roll.mode).toBe('advantage');
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(true);
  });

  /**
   * A Mace is neither Finesse nor Ranged. The discriminating half: the *same*
   * Advantage, the same target, the same turn — only the weapon differs.
   */
  it('does not apply with a weapon that is neither Finesse nor Ranged', () => {
    const out = swing(fighting(table()), {
      target: THUG,
      weapon: 'mace',
      modes: [{ source: 'hidden', mode: 'advantage' }],
    });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
  });

  /**
   * SRD: "You don't need Advantage ... if at least one of your allies is
   * within 5 feet of the target, the ally doesn't have the Incapacitated
   * condition, and you don't have Disadvantage on the attack roll."
   */
  it('applies without Advantage when an ally is within 5 feet of the target', () => {
    const flanked: readonly GameEvent[] = [
      ...table().filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      at(ALLY, THUG, 5, 0),
    ];
    const out = swing(fighting(flanked), { target: THUG, weapon: 'dagger' });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(true);
  });

  /** The ally has to be near the *target*, not merely on the board. */
  it('does not apply when the ally is nowhere near the target', () => {
    const out = swing(fighting(table()), { target: THUG, weapon: 'dagger' });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
  });

  /** SRD: "the ally doesn't have the Incapacitated condition." */
  it('does not apply when the adjacent ally is Incapacitated', () => {
    const flanked: readonly GameEvent[] = [
      ...table().filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      at(ALLY, THUG, 5, 0),
      { type: 'condition-applied', id: ALLY, condition: 'incapacitated', source: 'a spell' },
    ];
    const out = swing(fighting(flanked), { target: THUG, weapon: 'dagger' });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
  });

  /** SRD: "and you don't have Disadvantage on the attack roll." */
  it('does not apply through the ally clause while you have Disadvantage', () => {
    const flanked: readonly GameEvent[] = [
      ...table().filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      at(ALLY, THUG, 5, 0),
    ];
    const out = swing(fighting(flanked), {
      target: THUG,
      weapon: 'dagger',
      modes: [{ source: 'in the dark', mode: 'disadvantage' }],
    });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
  });

  /**
   * Advantage and Disadvantage cancel to a normal roll, and SRD reads *the
   * roll*: "if you have Advantage on the roll". A normal roll is not Advantage
   * — but it is not Disadvantage either, so the ally clause is still open.
   */
  it('reads the resolved roll, so Advantage cancelled by Disadvantage is neither', () => {
    const out = swing(fighting(table()), {
      target: THUG,
      weapon: 'dagger',
      modes: [
        { source: 'hidden', mode: 'advantage' },
        { source: 'in the dark', mode: 'disadvantage' },
      ],
    });
    expect(out.attack?.roll.mode).toBe('normal');
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
  });

  /**
   * Allegiance is declared, like cover and sight. A table that has not said
   * who is on whose side gets no ally — which withholds the benefit rather
   * than inventing one, and says so rather than passing quietly.
   */
  it('says so when nobody has declared who is on whose side', () => {
    // The field is simply absent, which is what "nobody has said" looks like
    // in the log: `side` is optional and null is its resting state.
    const sideless: readonly GameEvent[] = table().map((e) => {
      if (e.type !== 'creature-added' || e.id !== ROGUE) return e;
      const bare: Record<string, unknown> = { ...e };
      delete bare['side'];
      return bare as unknown as GameEvent;
    });
    const out = swing(fighting(sideless), { target: THUG, weapon: 'dagger' });
    expect(spent(out.events, 'rogue:sneak-attack')).toBe(false);
    expect(out.unverified.join(' ')).toContain('who is on whose side');
  });
});

describe('once per turn is once per a turn, not once per your turn', () => {
  const advantage = { source: 'hidden', mode: 'advantage' } as const;

  it('applies once and then stops, on the same turn', () => {
    const first = swing(fighting(table()), {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
    });
    expect(spent(first.events, 'rogue:sneak-attack')).toBe(true);

    // A Rogue's Attack action holds one attack, so a second on the same turn
    // is one whose cost is paid elsewhere — a Reaction, which is what `free`
    // means here and what `takeOpportunityAttack` passes.
    const second = swing(first.log, {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
      free: true,
    });
    expect(spent(second.events, 'rogue:sneak-attack')).toBe(false);
    expect(dealt(second)).toBeLessThan(dealt(first));
  });

  /**
   * The load-bearing test of the whole batch. The Rogue used it on their own
   * turn; the turn passes to the thug; the Rogue's Opportunity Attack there is
   * a **different turn**, so the allowance is back — even though the Rogue's
   * own budget has not refreshed, because their next turn has not begun.
   */
  it('comes back on somebody else’s turn', () => {
    const first = swing(fighting(table()), {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
    });
    expect(spent(first.events, 'rogue:sneak-attack')).toBe(true);

    // On to the thug's turn. The Rogue has not begun a new turn of their own.
    const advanced = unwrap(resolveTurn(fold('seed', first.log), supply()), 'turn');
    const later = [...first.log, ...advanced.events];
    expect(fold('seed', later).combat?.order[fold('seed', later).combat!.turnIndex]?.id).toBe(THUG);

    // The Rogue's Opportunity Attack: a Reaction, on the thug's turn, whose
    // cost is the Reaction rather than the Attack action.
    const reaction = swing(later, {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
      free: true,
    });
    expect(spent(reaction.events, 'rogue:sneak-attack')).toBe(true);
  });

  /** And it is spent again on that turn, so the allowance is per turn either way. */
  it('is spent again by the second attack on the new turn', () => {
    const first = swing(fighting(table()), {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
    });
    const advanced = unwrap(resolveTurn(fold('seed', first.log), supply()), 'turn');
    const later = [...first.log, ...advanced.events];
    const once = swing(later, { target: THUG, weapon: 'dagger', modes: [advantage], free: true });
    const twice = swing(once.log, { target: THUG, weapon: 'dagger', modes: [advantage], free: true });
    expect(spent(once.events, 'rogue:sneak-attack')).toBe(true);
    expect(spent(twice.events, 'rogue:sneak-attack')).toBe(false);
  });

  /**
   * Outside combat there are no turns, so nothing restricts it — the same
   * reading the one-slot-per-turn rule takes, and for the same reason.
   */
  it('does not restrict itself where nobody is taking turns', () => {
    const first = swing(table(), { target: THUG, weapon: 'dagger', modes: [advantage] });
    const second = swing(first.log, { target: THUG, weapon: 'dagger', modes: [advantage] });
    expect(first.events.some((e) => e.type === 'feature-used')).toBe(false);
    expect(dealt(second)).toBeGreaterThan(0);
  });

  /** A failed qualification must not quietly eat the allowance. */
  it('spends nothing when the feature did not apply', () => {
    const out = swing(fighting(table()), { target: THUG, weapon: 'mace', modes: [advantage] });
    expect(out.events.some((e) => e.type === 'feature-used')).toBe(false);

    // And the allowance is still there for a qualifying swing on the same turn.
    const then = swing(out.log, {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
      free: true,
    });
    expect(spent(then.events, 'rogue:sneak-attack')).toBe(true);
  });

  /** A miss rolls no damage, so it cannot have spent the allowance either. */
  it('spends nothing on a miss', () => {
    const out = unwrap(
      resolveAttack(
        fold('seed', fighting(table())),
        ROGUE,
        {
          target: THUG,
          weapon: 'dagger',
          modes: [{ source: 'hidden', mode: 'advantage' }],
          attackBonuses: [{ source: 'forced', flat: -40 }],
        },
        supply('whiff'),
      ),
      'miss',
    );
    expect(out.attack?.hit).toBe(false);
    expect(out.events.some((e) => e.type === 'feature-used')).toBe(false);
  });
});

describe('the allowance is state, and survives everything state survives', () => {
  const advantage = { source: 'hidden', mode: 'advantage' } as const;

  it('replays prefix by prefix', () => {
    const out = swing(fighting(table()), { target: THUG, weapon: 'dagger', modes: [advantage] });
    for (let n = 0; n <= out.log.length; n += 1) {
      expect(fold('seed', out.log.slice(0, n))).toEqual(fold('seed', out.log.slice(0, n)));
    }
  });

  /** The spend is in the log, so a reloaded campaign knows it happened. */
  it('is rebuilt by the fold rather than held in a caller’s hand', () => {
    const out = swing(fighting(table()), { target: THUG, weapon: 'dagger', modes: [advantage] });
    const reloaded = fold('seed', out.log);
    expect(reloaded.combat?.budgets.rogue?.featureUsedOnTurn['rogue:sneak-attack']).toBe(
      reloaded.combat?.turnsTaken,
    );
  });

  /** Same state, same seed, same batch. */
  it('is deterministic', () => {
    const log = fighting(table());
    const a = swing(log, { target: THUG, weapon: 'dagger', modes: [advantage] });
    const b = swing(log, { target: THUG, weapon: 'dagger', modes: [advantage] });
    expect(a.events).toEqual(b.events);
  });

  /** A retried command neither rolls again nor spends the allowance twice. */
  it('spends one allowance across a retried command id', () => {
    const log = fighting(table());
    const first = swing(log, {
      target: THUG,
      weapon: 'dagger',
      modes: [advantage],
      commandId: 'stab-1',
    });
    const after = fold('seed', first.log);
    const retry = unwrap(
      resolveAttack(
        after,
        ROGUE,
        {
          target: THUG,
          weapon: 'dagger',
          modes: [advantage],
          commandId: 'stab-1',
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply(),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...first.log, ...retry.events])).toEqual(after);
  });
});

describe('Colossus Slayer is the second feature of the same shape', () => {
  /** SRD: "You gain one of the following feature options of your choice." */
  it('grants nothing at all to a Ranger who chose Horde Breaker', () => {
    expect(
      (hunterSheet('Horde Breaker').standing ?? []).some(
        (e) => e.feature === 'hunter:hunters-prey',
      ),
    ).toBe(false);
    expect(
      (hunterSheet('Colossus Slayer').standing ?? []).some(
        (e) => e.feature === 'hunter:hunters-prey',
      ),
    ).toBe(true);
  });

  const hunterTable = (thugHp: number): readonly GameEvent[] => {
    const base: GameEvent[] = [
      added(RANGER, 'party', hunterSheet('Colossus Slayer')),
      added(THUG, 'thugs', sheet()),
      kit(RANGER, ['shortsword', 'longbow']),
      { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
      { type: 'landmark-added', name: 'the wood', at: { x: 500, y: 500, z: 0 } },
      { type: 'creature-placed', id: RANGER, placement: { from: { landmark: 'the wood' }, feet: 0 } },
      at(THUG, RANGER, 5, 0),
      {
        type: 'combat-started',
        combatants: [
          { id: RANGER, initiative: 20, speed: 30 },
          { id: THUG, initiative: 10, speed: 30 },
        ],
      },
    ];
    if (thugHp >= 60) return base;
    // Wounded, which is the whole qualification.
    const hurt = unwrap(
      damageCreature(fold('seed', base), THUG, { amount: 60 - thugHp, source: 'an arrow' }),
      'wound',
    );
    return [...base, ...hurt];
  };

  /** SRD: "if it's missing any of its Hit Points." */
  it('applies to a wounded target and not to an unhurt one', () => {
    const whole = swing(hunterTable(60), { target: THUG, weapon: 'shortsword' }, RANGER);
    const hurt = swing(hunterTable(59), { target: THUG, weapon: 'shortsword' }, RANGER);
    expect(spent(whole.events, 'hunter:hunters-prey')).toBe(false);
    expect(spent(hurt.events, 'hunter:hunters-prey')).toBe(true);
  });

  /** One hit point missing is "missing any of its Hit Points". */
  it('reads the boundary exactly', () => {
    const state: GameState = fold('seed', hunterTable(59));
    expect(state.creatures.thug?.vitals.hp).toBe(59);
    expect(state.creatures.thug?.vitals.hpMax).toBe(60);
  });

  /** SRD: "When you hit a creature **with a weapon**." An Unarmed Strike is not one. */
  it('does not apply to an Unarmed Strike', () => {
    const out = swing(hunterTable(30), { target: THUG, weapon: null }, RANGER);
    expect(spent(out.events, 'hunter:hunters-prey')).toBe(false);
  });

  /** And its own allowance is its own: two features, two budgets. */
  it('keeps a separate allowance from Sneak Attack', () => {
    const out = swing(hunterTable(30), { target: THUG, weapon: 'shortsword' }, RANGER);
    const used = fold('seed', out.log).combat?.budgets.ranger?.featureUsedOnTurn;
    expect(Object.keys(used ?? {})).toEqual(['hunter:hunters-prey']);
  });
});

describe('the pieces this batch deliberately did not touch', () => {
  /**
   * Horde Breaker needs an extra attack inside the Attack action against a
   * second creature, which the economy has no room for: it counts one Attack
   * action, not the attacks in it. Left unexecuted rather than approximated.
   */
  it('leaves Horde Breaker unexecuted rather than approximating it', () => {
    expect(hunterSheet('Horde Breaker').standing ?? []).toEqual(
      (hunterSheet('Horde Breaker').standing ?? []).filter(
        (e) => e.feature !== 'hunter:hunters-prey',
      ),
    );
  });
});
