import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { BONUS_APPLIES, checkContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest } from './rest.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { attuneItem, equipItem, resolveAttack, resolveSpell, unequipItem } from './commands.js';
import { armorClassOf } from './standing.js';

/**
 * A flat, named bonus an item gives, and the item it is given *with*.
 *
 * The class-feature vocabulary had every shape but the commonest one a magic
 * item prints: a number. `save-bonus` is Aura of Protection's — derived from
 * an ability — and `attack-damage` is a feature's extra die; neither can say
 * "+1 to attack rolls and damage rolls made with this magic weapon", and
 * nothing at all could say "+1 bonus to Armor Class".
 *
 * Three SRD items hold this file together, and the third clause is the one it
 * exists for:
 *
 * - **Weapon, +1** — "You have a bonus to attack rolls and damage rolls made
 *   with this magic weapon." *Made with it*: the bow in the same pack gets
 *   nothing, which is what `onlyWithItem` is.
 * - **Ring of Protection** — "a +1 bonus to Armor Class and saving throws
 *   while wearing this ring."
 * - **Cloak of Protection** — the same sentence on a different item, which is
 *   what makes the SRD's stacking rule testable: two *different* names both
 *   apply, and one name twice applies once.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const WITCH = id('witch');

const SWORD = 'longsword-plus-1';
const RING = 'ring-of-protection';
const CLOAK = 'cloak-of-protection';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
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

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  maxHp = 40,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(FIGHTER, 'party'),
  added(GOBLIN, 'goblins', { abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } }, 20),
  added(WITCH, 'coven', {
    spellcastingAbility: 'int',
    abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  }),
  {
    type: 'resource-pool-declared',
    id: WITCH,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person'] }),
  },
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [
      { id: SWORD, quantity: 1 },
      { id: 'longsword', quantity: 1 },
      // A **Sling** rather than a Shortbow, and the reason is the rule
      // this file now runs under: a Shortbow is Two-Handed, and a
      // character holding the magic Longsword has one hand left. The
      // second weapon has to be one a hand can hold, or the narrowing
      // below would be tested on a wielding nobody could have.
      { id: 'sling', quantity: 1 },
      { id: RING, quantity: 1 },
      { id: CLOAK, quantity: 1 },
    ],
    source: 'the hoard',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: WITCH, placement: { from: { creature: FIGHTER }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WITCH, to: FIGHTER, seen: true },
];

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/**
 * Wear it, and attune to it if its own line asks for that.
 *
 * A magic weapon's line does not — "Weapon, +1" prints no bracket — so the
 * sword is wielded and nothing else, while the ring and the cloak both take
 * the Short Rest as well.
 */
const worn = (log: readonly GameEvent[], itemId: string): readonly GameEvent[] => {
  const equipped = run(log, (s) => equipItem(s, SRD_CONTENT, FIGHTER, itemId));
  if (SRD_CONTENT.item(itemId)?.attunement === undefined) return equipped;

  const resting =
    fold('seed', equipped).creatures.fighter?.resting == null
      ? run(equipped, (s) => beginRest(s, FIGHTER, 'short'))
      : equipped;
  return run(resting, (s) => attuneItem(s, SRD_CONTENT, FIGHTER, itemId));
};

/** Swing, and hand back what the engine said and the log it wrote. */
const swing = (log: readonly GameEvent[], weapon: string, seed = 'swing') => {
  const out = unwrap(
    resolveAttack(fold('seed', log), FIGHTER, { target: GOBLIN, weapon, free: true }, supply(seed)),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

/** The contributions of the one d20 the log records, by source. */
const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

/** Hold Person at the fighter, and the Wisdom save it makes them roll. */
const holdPerson = (log: readonly GameEvent[], seed = 'hold') =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      WITCH,
      { spellId: 'hold-person', targets: [FIGHTER], slotLevel: 2 },
      supply(seed),
    ),
    'hold-person',
  );

describe('the three items are in the catalogue, written as the book writes them', () => {
  it('is a magical version of an equipment entry, not a population of its own', () => {
    const sword = SRD_CONTENT.item(SWORD);
    const longsword = SRD_CONTENT.item('longsword');
    expect(sword?.kind).toBe('weapon');
    // The mechanics are the Longsword row's, down to the mastery property, and
    // the row it is a magical version of is named by `weapon.id`.
    expect(sword?.weapon).toEqual({ ...longsword?.weapon, name: '+1 Longsword' });
    expect(sword?.weapon?.id).toBe('longsword');
    expect(sword?.grants?.[0]?.kind).toBe('standing');
  });

  /** The log says which sword swung, not merely that a longsword did. */
  it('names itself in the roll it was swung with', () => {
    const out = swing(worn(SETUP, SWORD), SWORD);
    const record = out.events.find((e) => e.type === 'roll-recorded');
    if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
    expect(record.label).toBe('+1 Longsword attack');
  });

  it('gives the ring and the cloak the same sentence, under two names', () => {
    for (const item of [RING, CLOAK]) {
      const record = SRD_CONTENT.item(item);
      expect(record?.attunement).toEqual({});
      const grant = record?.grants?.[0];
      expect(grant?.kind).toBe('standing');
      if (grant?.kind !== 'standing') throw new Error('unreachable');
      expect(grant.effects?.[0]).toMatchObject({
        kind: 'flat-bonus',
        flat: 1,
        applies: ['ac', 'save'],
      });
    }
  });
});

describe('a +1 weapon, end to end through the public API', () => {
  it('adds one to the attack roll, named in the log as the sword', () => {
    const armed = worn(SETUP, SWORD);
    const magic = swing(armed, SWORD);
    const mundane = swing(run(armed, (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'longsword')), 'longsword');

    expect(magic.attack!.roll.modifier).toBe(mundane.attack!.roll.modifier + 1);
    expect(contributionsOf(magic.events)['+1 Longsword']).toBe(1);
    expect(contributionsOf(mundane.events)['+1 Longsword']).toBeUndefined();
  });

  /**
   * The contributions still account for the whole of what was added to the
   * die: naming a slice of the modifier must not double-count it.
   */
  it('keeps the contributions summing to the modifier', () => {
    const magic = swing(worn(SETUP, SWORD), SWORD);
    const total = Object.values(contributionsOf(magic.events)).reduce((n, a) => n + a, 0);
    expect(total).toBe(magic.attack!.roll.modifier);
  });

  /**
   * "…and damage rolls made with this magic weapon." A *bonus* is of the
   * weapon's own type and rides with it through Resistance, which is what
   * `damageBonuses` already means; the same seed rolls the same dice, so the
   * whole of the difference is the +1.
   */
  it('adds one to the damage, of the weapon’s own type', () => {
    const armed = worn(SETUP, SWORD);
    const magic = swing(armed, SWORD, 'blow');
    const mundane = swing(
      run(armed, (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'longsword')),
      'longsword',
      'blow',
    );

    expect(magic.attack!.hit).toBe(true);
    expect(mundane.attack!.hit).toBe(true);
    expect(magic.damage).toBe((mundane.damage ?? 0) + 1);
  });
});

describe('the narrowing bites: “made with this magic weapon”', () => {
  /**
   * The whole reason a flat bonus needed a field the spell side never had. A
   * character holding a +1 Longsword and a plain Shortbow has the bonus on one
   * of them, and mutating `onlyWithItem` away puts it on both.
   */
  it('gives the bonus to the sword and nothing to the bow', () => {
    const armed = worn(SETUP, SWORD);
    const bow = swing(run(armed, (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'sling')), 'sling');
    expect(contributionsOf(bow.events)['+1 Longsword']).toBeUndefined();

    const sword = swing(armed, SWORD);
    expect(contributionsOf(sword.events)['+1 Longsword']).toBe(1);
  });

  /**
   * The same shot, taken by a character who owns the sword and by one who
   * does not, deals the same damage from the same seed.
   */
  it('gives it to no damage roll but the sword’s', () => {
    // At range, so the shot is not hampered by the goblin standing on the
    // archer's toes and the arrow can be relied on to land.
    const apart = (log: readonly GameEvent[]): readonly GameEvent[] => [
      ...log,
      {
        type: 'creature-moved',
        id: GOBLIN,
        placement: { from: { creature: FIGHTER }, feet: 30, bearing: 0 },
      },
    ];

    const withSword = swing(
      apart(run(worn(SETUP, SWORD), (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'sling'))),
      'sling',
      'blow',
    );
    const without = swing(
      apart(run(SETUP, (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'sling'))),
      'sling',
      'blow',
    );
    expect(withSword.attack!.hit).toBe(true);
    expect(withSword.damage).toBe(without.damage);
  });
});

describe('a bonus to Armour Class, which no grant could give before', () => {
  it('raises it by one while the ring is worn and attuned', () => {
    const bare = armorClassOf(fold('seed', SETUP), FIGHTER);
    expect(armorClassOf(fold('seed', worn(SETUP, RING)), FIGHTER)).toBe(bare + 1);
  });

  /**
   * Owning is not wearing, and wearing is not attuning. Both halves are
   * asserted against the *worn and attuned* answer as well as the bare one, so
   * a reading that handed the bonus out unconditionally would fail here rather
   * than pass two equalities that happened to hold.
   */
  it('gives nothing to an owner who has not put it on, or worn it unattuned', () => {
    const bare = armorClassOf(fold('seed', SETUP), FIGHTER);
    const ringed = armorClassOf(fold('seed', worn(SETUP, RING)), FIGHTER);
    expect(ringed).toBeGreaterThan(bare);

    // Owned and in a pocket: `itemStandingOf` offers nothing it is not wearing.
    expect(fold('seed', SETUP).creatures.fighter?.inventory).toContainEqual({
      id: RING,
      quantity: 1,
    });
    expect(bare).toBe(ringed - 1);

    // Equipped but not attuned: the item's own bracket is unsatisfied.
    const held = run(SETUP, (s) => equipItem(s, SRD_CONTENT, FIGHTER, RING));
    expect(armorClassOf(fold('seed', held), FIGHTER)).toBe(bare);
  });

  it('gives it back when the ring comes off, without ending the attunement', () => {
    const on = worn(SETUP, RING);
    const off = run(on, (s) => unequipItem(s, SRD_CONTENT, FIGHTER, RING));
    expect(armorClassOf(fold('seed', off), FIGHTER)).toBe(
      armorClassOf(fold('seed', SETUP), FIGHTER),
    );
    expect(fold('seed', off).creatures.fighter?.attuned.map((a) => a.id)).toEqual([RING]);
  });
});

/**
 * SRD "Combining Game Effects": "Different game features can affect a target
 * at the same time. But when two or more game features have the same name,
 * only the effects of one of them — the most potent — apply while the
 * durations of the effects overlap."
 *
 * So two names stack and one name does not, and the item's id is the name.
 */
describe('stacking, as the SRD’s own sentence has it', () => {
  it('stacks two different names', () => {
    const bare = armorClassOf(fold('seed', SETUP), FIGHTER);
    const both = worn(worn(SETUP, RING), CLOAK);
    expect(armorClassOf(fold('seed', both), FIGHTER)).toBe(bare + 2);
  });

  it('counts one name once, though it is both worn and attuned', () => {
    const bare = armorClassOf(fold('seed', SETUP), FIGHTER);
    const state = fold('seed', worn(SETUP, RING));
    // The same item is on both lists, which is the shape that could double it.
    expect(state.creatures.fighter?.equipped.some((e) => e.id === RING)).toBe(true);
    expect(state.creatures.fighter?.attuned.some((e) => e.id === RING)).toBe(true);
    expect(armorClassOf(state, FIGHTER)).toBe(bare + 1);
  });
});

describe('a bonus to saving throws, on a save nobody asked for', () => {
  it('rides on a spell’s save and names itself in the log', () => {
    const bare = holdPerson(SETUP);
    const ringed = holdPerson(worn(SETUP, RING));

    expect(ringed.outcomes[0]?.save?.modifier).toBe(
      (bare.outcomes[0]?.save?.modifier ?? 0) + 1,
    );
    expect(contributionsOf(ringed.events)['Ring of Protection']).toBe(1);
    expect(contributionsOf(bare.events)['Ring of Protection']).toBeUndefined();
  });

  it('stacks the ring and the cloak on one save', () => {
    const bare = holdPerson(SETUP);
    const both = holdPerson(worn(worn(SETUP, RING), CLOAK));
    expect(both.outcomes[0]?.save?.modifier).toBe((bare.outcomes[0]?.save?.modifier ?? 0) + 2);
  });
});

/**
 * The allowlist is a union written out as data, and this is what holds it
 * there — the shape `content.test.ts` established for `ITEM_EFFECT_KINDS` and
 * `feature-schema.test.ts` for `READABLE_GRANT_KINDS`.
 *
 * A member added to `StandingBonusApplies` and not to `BONUS_APPLIES` would
 * turn every item that used it into a `bad_bonus_applies` nobody meant; one
 * here that the type does not have would be a benefit nothing applies.
 */
describe('what a flat bonus may reach is derived from the union, not recalled', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // Comments stripped first: the module names its own members in prose.
  const BONUSES = readFileSync(`${here}bonuses.ts`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const unionMembers = (name: string): readonly string[] => {
    const start = BONUSES.indexOf(`export type ${name} =`);
    if (start === -1) throw new Error(`no union named ${name}`);
    const body = BONUSES.slice(start, BONUSES.indexOf(';', start));
    return [...body.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
  };

  /** The analysis is not vacuous: it finds unions with members in them. */
  it('reads both unions out of the module', () => {
    expect(unionMembers('BonusApplies')).toContain('ac');
    expect(unionMembers('StandingBonusApplies')).toEqual(['damage']);
  });

  it('carries every member of the union, and invents none', () => {
    expect([...BONUS_APPLIES].sort()).toEqual(
      [...unionMembers('BonusApplies'), ...unionMembers('StandingBonusApplies')].sort(),
    );
  });
});

describe('the one door refuses a flat bonus that says nothing', () => {
  const trinket = (effect: unknown): CatalogueItem =>
    ({
      id: 'test-trinket',
      name: 'Trinket',
      kind: 'wondrous',
      weightLb: 0,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [{ kind: 'standing', reach: 'self', effects: [effect] }],
    }) as unknown as CatalogueItem;

  const codesOf = (effect: unknown): readonly string[] =>
    checkContent({ items: [trinket(effect)] }).map((problem) => problem.code);

  it('accepts the shape the SRD prints', () => {
    expect(codesOf({ kind: 'flat-bonus', flat: 1, applies: ['ac', 'save'] })).toEqual([]);
  });

  it('refuses a bonus that applies to nothing', () => {
    expect(codesOf({ kind: 'flat-bonus', flat: 1, applies: [] })).toContain(
      'bonus_applies_to_nothing',
    );
  });

  it('refuses a kind of roll nothing reads', () => {
    expect(codesOf({ kind: 'flat-bonus', flat: 1, applies: ['passive-perception'] })).toContain(
      'bad_bonus_applies',
    );
  });

  it('refuses a bonus of nothing', () => {
    expect(codesOf({ kind: 'flat-bonus', flat: 0, applies: ['ac'] })).toContain('bonus_of_nothing');
  });

  /**
   * An Armour Class is not made *with* anything, so a narrowing on one could
   * never hold — and an item whose benefit never applies is exactly what the
   * content validator exists to refuse.
   */
  it('refuses a narrowing on a benefit no item is used to gain', () => {
    expect(
      codesOf({ kind: 'flat-bonus', flat: 1, applies: ['ac'], onlyWithItem: true }),
    ).toContain('narrowing_without_a_roll');
  });

  /**
   * The other end of the same door. `item_requirement_on_a_feature` already
   * refuses "while worn" on a class feature because it is read against the
   * granting *item's* id; the narrowing is read against the same id and would
   * fail the same way — silently, granting nothing while looking well formed.
   */
  it('refuses the narrowing on a class feature, which names no item', () => {
    const fighter = SRD_CONTENT.classes.find((definition) => definition.id === 'fighter');
    if (fighter === undefined) throw new Error('no Fighter to borrow a table from');

    const problems = checkContent({
      classes: [
        {
          ...fighter,
          features: [
            {
              id: 'fighter:a-narrowed-bonus',
              name: 'A Narrowed Bonus',
              level: 1,
              automation: 'engine',
              note: 'A bonus narrowed to an item no class feature has.',
              grants: {
                kind: 'standing',
                reach: 'self',
                effects: [
                  { kind: 'flat-bonus', applies: ['attack'], flat: 1, onlyWithItem: true },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(problems.map((problem) => problem.code)).toContain('item_narrowing_on_a_feature');
  });
});
