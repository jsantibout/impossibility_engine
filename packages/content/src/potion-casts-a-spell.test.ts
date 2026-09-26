import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CatalogueItem, CharacterSheet, Content } from '@ie/engine';
import {
  awardItems,
  checkContent,
  createRng,
  createRollIssuer,
  extendContent,
  fold,
  ongoingSpellOf,
  resolveSpell,
  useItem,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * A spell cast from a potion in the pack (treasure T-D1).
 *
 * SRD Potion of Animal Friendship: "When you drink this potion, you can cast
 * the level 3 version of the _Animal Friendship_ spell (save DC 13)." Two rules
 * of the book meet in that sentence, and the record has to keep both:
 *
 * - "Spells Cast from Items": the spell "uses its normal casting time, range,
 *   and duration" — so it is a **casting**, on the item's route, at the level
 *   and DC the line prints, and Animal Friendship's Action is still spent.
 * - "Potions": "Drinking a potion or administering it to another creature
 *   requires a Bonus Action. Once used, a potion takes effect immediately, and
 *   it is used up." — so the bottle is **drunk out of the pack** rather than
 *   held, costs no charge, is gone afterwards, and the drinking is a Bonus
 *   Action beside the casting's own time.
 *
 * The door is `cast_spell.item` naming the potion; `use_item` refuses it,
 * because a potion that casts confers nothing without the casting.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const BADGERS = [id('badger-1'), id('badger-2'), id('badger-3')] as const;
const POTION = 'potion-of-animal-friendship';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  // Nobody here casts spells, so a DC of 13 is the bottle's and nobody else's.
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, creatureType: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType,
  side: who === WIELDER ? 'party' : 'wild',
});

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the clearing', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIELDER, placement: { from: { landmark: 'the clearing' }, feet: 0 } },
  ...BADGERS.flatMap((badger, index): GameEvent[] => [
    {
      type: 'creature-placed',
      id: badger,
      placement: { from: { creature: WIELDER }, feet: 10, bearing: index * 90 },
    },
    { type: 'sight-declared', from: WIELDER, to: badger, seen: true },
  ]),
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const supply = (seed: string, content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

const BASE: readonly GameEvent[] = [
  added(WIELDER, 'Humanoid'),
  ...BADGERS.map((badger) => added(badger, 'Beast')),
  ...SCENE,
];

/** Handed over, and left in the pack: a bottle is never put on. */
const carrying = (count = 1): readonly GameEvent[] =>
  run(BASE, (s) =>
    awardItems(s, supply('the-hoard'), WIELDER, [{ id: POTION, quantity: count }], 'the hoard'),
  );

const drink = (log: readonly GameEvent[], extra: Record<string, unknown> = {}, seed = 'drink') =>
  resolveSpell(
    fold('seed', log),
    WIELDER,
    { spellId: 'animal-friendship', targets: [...BADGERS], item: POTION, ...extra },
    supply(seed),
  );

const bottles = (log: readonly GameEvent[]): number =>
  fold('seed', log)
    .creatures[WIELDER]!.inventory.filter((line) => line.id === POTION)
    .reduce((sum, line) => sum + line.quantity, 0);

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as Extract<GameEvent, { type: 'spell-cast' }> | undefined;

describe('the Potion of Animal Friendship is drunk out of the pack, and casts', () => {
  it('casts the level 3 version against the bottle’s own 13, and the bottle is gone', () => {
    const log = carrying();
    const out = unwrap(drink(log), 'the potion');

    const cast = castOf(out.events);
    expect(cast?.route).toBe(`item:${POTION}`);
    expect(cast?.level).toBe(3);
    // "the level 3 version": two more Beasts than the first level's one.
    expect(out.outcomes.map((o) => o.target)).toEqual([...BADGERS]);
    const record = ongoingSpellOf(fold('seed', [...log, ...out.events]), out.castingId!);
    expect(record?.numbers.saveDc).toBe(13);

    // Used up, and paid for with nothing else: no charge, no slot.
    expect(bottles([...log, ...out.events])).toBe(0);
    expect(out.events.filter((e) => e.type === 'items-lost')).toEqual([
      expect.objectContaining({ id: WIELDER, items: [{ id: POTION, quantity: 1 }] }),
    ]);
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(false);
  });

  it('takes one bottle of two', () => {
    const log = carrying(2);
    const out = unwrap(drink(log), 'the first potion');
    expect(bottles([...log, ...out.events])).toBe(1);
  });

  it('is refused, with nothing drunk, to somebody who has none', () => {
    const out = drink(BASE);
    expect(isErr(out) && out.code).toBe('not_owned');
  });

  it('is refused, with nothing drunk, when the cast itself is refused', () => {
    const log = carrying();
    // The spell will not take its own caster, and says so before the bottle goes.
    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'animal-friendship', targets: [WIELDER], item: POTION },
      supply('wrong'),
    );
    expect(isErr(out) && out.code).toBe('cannot_target_self');
  });

  it('names no charges, because a bottle has none', () => {
    const out = drink(carrying(), { charges: 1 });
    expect(isErr(out) && out.code).toBe('bad_charges');
  });

  /**
   * SRD: "Drinking a potion ... requires a Bonus Action", and the spell "uses
   * its normal casting time" — which for Animal Friendship is an Action. A
   * record that spent only the Action would be a better potion than the book.
   */
  describe('in a fight', () => {
    const fight = (log: readonly GameEvent[]): readonly GameEvent[] => [
      ...log,
      {
        type: 'combat-started',
        combatants: [
          { id: WIELDER, initiative: 20, speed: 30 },
          ...BADGERS.map((badger) => ({ id: badger, initiative: 5, speed: 30 })),
        ],
      },
    ];

    it('spends the Bonus Action to drink it beside the Action to cast it', () => {
      const out = unwrap(drink(fight(carrying())), 'the potion in a fight');
      const spent = out.events
        .map((e) => e.type)
        .filter((type) => type === 'action-spent' || type === 'bonus-action-spent')
        .sort();
      expect(spent).toEqual(['action-spent', 'bonus-action-spent']);
    });

    it('is refused, with nothing drunk, once the Bonus Action is gone', () => {
      const log = [...fight(carrying()), { type: 'bonus-action-spent' as const, id: WIELDER }];
      const out = drink(log);
      expect(isErr(out) && out.code).toBe('no_bonus_action');
    });

    /**
     * A turn has one Bonus Action, so a bottle drunk with one cannot also
     * cast a spell that takes one. The two spends are each asked of the state
     * before the batch, so without this refusal they would both be paid out of
     * the same Bonus Action.
     */
    it('is refused when the drink and the casting want the same Bonus Action', () => {
      const flask: CatalogueItem = {
        id: 'flask-of-healing-word',
        name: 'Flask of Healing Word',
        kind: 'potion',
        weightLb: 0.5,
        costCp: null,
        armor: null,
        weapon: null,
        contents: [],
        grants: [{ kind: 'casts', spell: 'healing-word', usedUp: { action: 'bonus-action' } }],
      };
      const content = unwrap(extendContent(SRD_CONTENT, { items: [flask] }), 'the flask');
      const owning = run(BASE, (s) =>
        awardItems(s, supply('hoard', content), WIELDER, [{ id: flask.id }], 'the hoard'),
      );
      const heal = (log: readonly GameEvent[]) =>
        resolveSpell(
          fold('seed', log),
          WIELDER,
          { spellId: 'healing-word', targets: [WIELDER], item: flask.id },
          supply('heal', content),
        );
      const refused = heal(fight(owning));
      expect(isErr(refused) && refused.code).toBe('no_bonus_action');
      // Out of a fight there is no economy to share, and it is drunk.
      const drunk = unwrap(heal(owning), 'the flask out of a fight');
      expect(drunk.events.some((e) => e.type === 'items-lost')).toBe(true);
    });
  });

  it('is not used with use_item: what it gives is a casting', () => {
    const log = carrying();
    const out = useItem(fold('seed', log), WIELDER, { item: POTION }, supply('use'));
    expect(isErr(out) && out.code).toBe('item_confers_nothing');
  });
});

// — what a used-up casting may say ———————————————————————————————————————

describe('what a casting that uses its item up may say', () => {
  const DRAUGHT: CatalogueItem = {
    id: 'trial-draught',
    name: 'Trial Draught',
    kind: 'potion',
    weightLb: 0.5,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [{ kind: 'casts', spell: 'animal-friendship', usedUp: { action: 'bonus-action' } }],
  };
  const codesOf = (casts: Record<string, unknown>): readonly string[] =>
    checkContent({
      spells: SRD_CONTENT.spells.filter((spell) => spell.id === 'animal-friendship'),
      items: [{ ...DRAUGHT, grants: [{ ...DRAUGHT.grants![0], ...casts }] } as unknown as CatalogueItem],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  it('admits a bottle with no price and no pool', () => {
    expect(codesOf({})).toEqual([]);
    expect(codesOf({ usedUp: {} })).toEqual([]);
  });

  it.each([[{ charges: 1 }], [{ atWill: true }], [{ upToCharges: 3 }]])(
    'refuses a price beside it: %j',
    (price) => {
      expect(codesOf(price)).toContain('used_up_and_a_price @ items[trial-draught].grants[0].usedUp');
    },
  );

  it.each([[true], ['drink'], [{ action: 'reaction' }]])('refuses a usedUp of %j', (usedUp) => {
    expect(codesOf({ usedUp })).toContain('bad_used_up @ items[trial-draught].grants[0].usedUp');
  });
});
