import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { electableCastingDamage } from './standing.js';
import { equipItem, resolveSpell, unequipItem } from './commands.js';

/**
 * A `casting-damage` grant on an **item**, driven end to end.
 *
 * `ITEM_EFFECT_KINDS` has admitted the kind since items learned to grant
 * standing effects, under a written rule — "read from an item exactly as it is
 * read from a feature: the gatherer is `standingFor`… the list's rule is what
 * a reader reaches, not what the book happens to have written". No SRD item
 * prints the sentence, so nothing had ever cast a spell while wearing one: the
 * path was legal at the validator and untested past it, which is the shape of
 * every silently-broken feature this repository has found.
 *
 * Tested rather than refused, and the item that would end the argument is
 * already imaginable: "while you hold this staff, your Necromancy spells deal
 * maximum damage" is one sentence in a homebrew book and five in the engine's
 * existing vocabulary. Refusing the kind here would have made an item's
 * standing grants a *smaller* vocabulary than a feature's for no reason but
 * that Wizards of the Coast has not printed the line — which is the argument
 * the list's own rule was written against.
 *
 * Two of the five alterations, because they are the two that prove different
 * things: `maximum` throws nothing, so the number is exact and the generator
 * is where it was; `ability-modifier` reads the wearer's own sheet at the
 * casting, which is the half that has to see a creature rather than an item.
 */

const id = (s: string) => asCharacterId(s);
const NECROMANCER = id('necromancer');
const VICTIM = id('victim');

/** "While you hold this staff, your Necromancy spells deal maximum damage." */
const STAFF: CatalogueItem = {
  id: 'staff-of-the-charnel-house',
  name: 'Staff of the Charnel House',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'casting-damage', when: { school: 'necromancy' }, alters: { kind: 'maximum' } }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
} as unknown as CatalogueItem;

/**
 * "…you can add your Intelligence modifier to one damage roll of that spell",
 * which is SRD Empowered Evocation's sentence on a ring instead of a Wizard.
 * `optional`, so the casting names it or it does nothing.
 */
const RING: CatalogueItem = {
  id: 'ring-of-the-cold-mind',
  name: 'Ring of the Cold Mind',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'casting-damage',
          when: { school: 'necromancy' },
          alters: { kind: 'ability-modifier', ability: 'int' },
          optional: true,
        },
      ],
      requires: [{ kind: 'while-worn' }],
    },
  ],
} as unknown as CatalogueItem;

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { items: [STAFF, RING] }),
  'the homebrew shelf',
);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
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
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** A Constitution of 1 against an Intelligence-18 DC: this one fails. */
const FRAIL = { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 } as const;

const SETUP: readonly GameEvent[] = [
  added(NECROMANCER),
  added(VICTIM, { abilities: FRAIL, spellcastingAbility: null }),
  {
    type: 'resource-pool-declared',
    id: NECROMANCER,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: NECROMANCER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['inflict-wounds'] }),
  },
  {
    type: 'items-gained',
    id: NECROMANCER,
    items: [
      { id: STAFF.id, quantity: 1 },
      { id: RING.id, quantity: 1 },
    ],
    source: 'the barrow',
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the slab', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: NECROMANCER, placement: { from: { landmark: 'the slab' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: VICTIM,
    placement: { from: { creature: NECROMANCER }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: NECROMANCER, to: VICTIM, seen: true },
];

const supply = (seed = 'necromancy') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const holding = (itemId: string): readonly GameEvent[] =>
  run(SETUP, (s) => equipItem(s, CONTENT, NECROMANCER, itemId));

/** Inflict Wounds, 2d10 Necrotic on a Constitution save the victim fails. */
const strike = (log: readonly GameEvent[], using: readonly string[] = [], seed = 'necromancy') =>
  unwrap(
    resolveSpell(
      fold('seed', log),
      NECROMANCER,
      { spellId: 'inflict-wounds', targets: [VICTIM], slotLevel: 1, usingFeatures: using },
      supply(seed),
    ),
    'the casting',
  );

const damageDealt = (events: readonly GameEvent[]): number =>
  events
    .filter((event) => event.type === 'damage-taken' && event.id === VICTIM)
    .reduce((total, event) => total + (event.type === 'damage-taken' ? event.amount : 0), 0);

describe('an item may reach into a casting’s damage, as a feature does', () => {
  it('loads: the kind the list admits is a kind the validator accepts', () => {
    expect(checkContent({ items: [STAFF, RING] })).toEqual([]);
  });

  /**
   * The control first, so the number below is the staff's doing and not the
   * seed's: 2d10 on this generator is 4, and the maximum is 20.
   */
  it('deals what the definition prints when nothing is held', () => {
    expect(damageDealt(strike(SETUP).events)).toBe(4);
  });

  it('deals the maximum while the staff is held', () => {
    expect(damageDealt(strike(holding(STAFF.id)).events)).toBe(20);
  });

  /**
   * And nothing was thrown for it. "Maximum damage" takes every die's highest
   * face, so the component comes back with no roll at all — which is the half
   * a replay depends on.
   */
  it('throws no damage dice for a maximised casting', () => {
    const thrown = (events: readonly GameEvent[]) =>
      events.reduce(
        (total, event) => total + (event.type === 'rolls-issued' ? event.count : 0),
        0,
      );
    // The save is still rolled; the 2d10 is not.
    expect(thrown(strike(SETUP).events)).toBe(2);
    expect(thrown(strike(holding(STAFF.id)).events)).toBe(1);
  });

  /** Take it off and the spell is the spell again. */
  it('stops reaching the casting the moment the staff is put down', () => {
    const held = holding(STAFF.id);
    expect(damageDealt(strike(held).events)).toBe(20);
    const dropped = run(held, (s) => unequipItem(s, CONTENT, NECROMANCER, STAFF.id));
    expect(damageDealt(strike(dropped).events)).toBe(4);
  });

  /**
   * The narrowing is the grant's own: the staff says Necromancy, and the
   * engine compares the school the definition declares rather than naming one.
   */
  it('reaches only the castings its own clause names', () => {
    const elsewhere: CatalogueItem = {
      ...STAFF,
      id: 'staff-of-the-wrong-school',
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            { kind: 'casting-damage', when: { school: 'evocation' }, alters: { kind: 'maximum' } },
          ],
          requires: [{ kind: 'while-worn' }],
        },
      ],
    } as unknown as CatalogueItem;
    const content = unwrap(extendContent(SRD_CONTENT, { items: [elsewhere] }), 'the other staff');
    const owned: readonly GameEvent[] = [
      ...SETUP.filter((event) => event.type !== 'items-gained'),
      { type: 'items-gained', id: NECROMANCER, items: [{ id: elsewhere.id, quantity: 1 }], source: 'the barrow' },
    ];
    const held = [
      ...owned,
      ...unwrap(equipItem(fold('seed', owned), content, NECROMANCER, elsewhere.id), 'worn'),
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', held),
        NECROMANCER,
        { spellId: 'inflict-wounds', targets: [VICTIM], slotLevel: 1 },
        { issuer: createRollIssuer('r'), rng: createRng('necromancy') as Rng, content },
      ),
      'the casting',
    );
    expect(damageDealt(out.events)).toBe(4);
  });

  /**
   * And "you can" is declined the way a feature's is: the item is offered by
   * `electableCastingDamage` under its own id, and a casting that does not name
   * it gets nothing.
   */
  describe('an optional one is elected by name, and the name is the item’s', () => {
    it('offers the ring to whoever is wearing it', () => {
      expect(electableCastingDamage(fold('seed', holding(RING.id)), NECROMANCER)).toEqual([RING.id]);
      expect(electableCastingDamage(fold('seed', SETUP), NECROMANCER)).toEqual([]);
    });

    it('adds nothing to a casting that does not name it', () => {
      expect(damageDealt(strike(holding(RING.id)).events)).toBe(4);
    });

    it('adds the wearer’s Intelligence to a casting that does', () => {
      // Intelligence 18 is +4, on top of the 4 the dice gave.
      expect(damageDealt(strike(holding(RING.id), [RING.id]).events)).toBe(8);
    });
  });
});
