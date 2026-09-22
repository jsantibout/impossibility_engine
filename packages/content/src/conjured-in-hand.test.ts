import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import { createRng, restoreRng, type Rng } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { declaredCasting, spellSlotKey } from '@ie/engine';
import {
  activateSpell,
  carrying,
  damageCreature,
  dropConjured,
  equipItem,
  evokeConjured,
  freeHands,
  resolveSpell,
  useItem,
} from '@ie/engine';

/**
 * **The two SRD spells that were waiting on a hand, driven end to end.**
 *
 * `hands.test.ts` in the engine proves the vocabulary is not a special case,
 * with a berry and a blade the book never printed. This is the other half: the
 * printed spells, out of `SRD_CONTENT`, through the public commands, doing
 * what the book says they do.
 *
 * SRD Goodberry: "Ten berries appear in your hand and are infused with magic
 * for the duration. A creature can take a Bonus Action to eat one berry.
 * Eating a berry restores 1 Hit Point ... Uneaten berries disappear when the
 * spell ends."
 *
 * SRD Flame Blade: "You evoke a fiery blade in your free hand ... If you let
 * go of the blade, it disappears, but you can evoke the blade again as a Bonus
 * Action. As a Magic action, you can make a melee spell attack with the fiery
 * blade."
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const WOLF = id('wolf');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
  ...over,
});

const creature = (who: CharacterId, hp: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: hp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'hostile',
});

const TABLE: readonly GameEvent[] = [
  creature(DRUID, 30),
  creature(WOLF, 30),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['goodberry', 'flame-blade'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 3,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the grove', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the grove' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: WOLF,
    placement: { from: { creature: DRUID }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: DRUID, to: WOLF, seen: true },
  { type: 'sight-declared', from: WOLF, to: DRUID, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('grove') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (state: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('grove', log)), 'command'))];

const owning = (...items: readonly string[]): readonly GameEvent[] => [
  {
    type: 'items-gained',
    id: DRUID,
    items: items.map((item) => ({ id: item, quantity: 1 })),
    source: 'the pack',
  },
];

const cast = (log: readonly GameEvent[], spellId: string, slotLevel: number) =>
  run(log, (state) => resolveSpell(state, DRUID, { spellId, targets: [], slotLevel }, supply(state)));

const berryLine = (log: readonly GameEvent[]) =>
  carrying(fold('grove', log), DRUID).find((held) => held.id === 'goodberry');

describe('SRD Goodberry, from the casting to the last berry', () => {
  const hurt: readonly GameEvent[] = run([...TABLE], (state) =>
    damageCreature(state, DRUID, { amount: 10, source: 'a fall' }),
  );
  const berried = cast(hurt, 'goodberry', 1);

  it('puts ten berries in the caster’s hand and spends the slot', () => {
    const state = fold('grove', berried);
    expect(berryLine(berried)?.quantity).toBe(10);
    expect(freeHands(state, SRD_CONTENT, DRUID)).toBe(1);
    // The casting happened: a slot went and the spell is running for a day.
    expect(state.ongoing['cast:1']?.spellId).toBe('goodberry');
    const paid = berried.find((event) => event.type === 'spell-cast');
    expect(paid?.type === 'spell-cast' && paid.slot?.level).toBe(1);
  });

  /** SRD: "Eating a berry restores 1 Hit Point" — a Bonus Action each. */
  it('heals one hit point a berry, and leaves the other nine', () => {
    const before = fold('grove', berried).creatures[DRUID]!.vitals.hp;
    const eaten = run(berried, (state) => useItem(state, DRUID, { item: 'goodberry' }, supply(state)));
    const after = fold('grove', eaten);
    expect(after.creatures[DRUID]!.vitals.hp).toBe(before + 1);
    expect(berryLine(eaten)?.quantity).toBe(9);
  });

  /** SRD: "Uneaten berries disappear when the spell ends." */
  it('takes the uneaten ones away when the day is up', () => {
    const ended: readonly GameEvent[] = [
      ...berried,
      { type: 'spell-ended', castingId: 'cast:1', on: null, reason: 'dismissed' },
    ];
    expect(berryLine(ended)).toBeUndefined();
    expect(freeHands(fold('grove', ended), SRD_CONTENT, DRUID)).toBe(2);
  });

  /** And a berry is not a thing a shop sells, so nobody buys one. */
  it('prices no berry, because the book prints no berry to buy', () => {
    expect(SRD_CONTENT.item('goodberry')?.costCp).toBeNull();
  });
});

describe('SRD Flame Blade, and the hand it is evoked in', () => {
  const evoked = cast([...TABLE], 'flame-blade', 2);

  it('evokes the blade into a free hand', () => {
    const state = fold('grove', evoked);
    expect(carrying(state, DRUID).find((held) => held.id === 'flame-blade')?.casting).toBe('cast:1');
    expect(freeHands(state, SRD_CONTENT, DRUID)).toBe(1);
  });

  /**
   * SRD: "in your **free hand**" — and a Quarterstaff in one hand with a
   * Shield in the other leaves none.
   */
  it('refuses the casting when there is no free hand, and costs nothing for it', () => {
    const armed = run([...TABLE, ...owning('quarterstaff', 'shield')], (state) =>
      equipItem(state, SRD_CONTENT, DRUID, 'quarterstaff'),
    );
    const both = run(armed, (state) => equipItem(state, SRD_CONTENT, DRUID, 'shield'));
    const state = fold('grove', both);
    const refused = resolveSpell(
      state,
      DRUID,
      { spellId: 'flame-blade', targets: [], slotLevel: 2 },
      supply(state),
    );
    expect(isErr(refused) && refused.code).toBe('no_free_hand');
    expect(Object.keys(fold('grove', both).ongoing)).toEqual([]);
  });

  /**
   * SRD: "If you let go of the blade, it disappears, but you can evoke the
   * blade again as a Bonus Action." The Concentration is untouched by either.
   */
  it('lets go of the blade and evokes it again, with the spell still running', () => {
    const dropped = run(evoked, (state) => dropConjured(state, SRD_CONTENT, DRUID, 'flame-blade'));
    expect(carrying(fold('grove', dropped), DRUID).some((h) => h.id === 'flame-blade')).toBe(false);
    expect(fold('grove', dropped).ongoing['cast:1']).toBeDefined();

    const again = run(dropped, (state) =>
      evokeConjured(state, DRUID, { item: 'flame-blade' }, supply(state)),
    );
    const state = fold('grove', again);
    expect(carrying(state, DRUID).find((h) => h.id === 'flame-blade')?.casting).toBe('cast:1');
    expect(state.creatures[DRUID]!.concentration?.castingId).toBe('cast:1');
  });

  /** And the blade still strikes: the Magic action the spell already printed. */
  it('makes its melee spell attack with the blade in hand', () => {
    const struck = run(evoked, (state) =>
      activateSpell(state, DRUID, { castingId: 'cast:1', targets: [WOLF] }, supply(state)),
    );
    expect(struck.some((event) => event.type === 'spell-activated')).toBe(true);
  });
});
