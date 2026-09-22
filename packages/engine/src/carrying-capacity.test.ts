import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { groundItems } from './positioning.js';
import {
  addSceneLandmark,
  awardItems,
  carriedWeight,
  carryingCapacity,
  dropItem,
  itemsWithinReach,
  placeCreatureInScene,
  purchaseItem,
  setScene,
  takeItemUp,
} from './commands.js';

/**
 * What a creature can carry, and what happens when it tries to carry more.
 *
 * `weightLb` has been on every catalogue item since the equipment tables were
 * parsed and **nothing read it** — the equipment note recorded the gap in as
 * many words: "Nothing weighs anything. Weight is in the catalogue; carrying
 * capacity…". This is the reader, and the one refusal it makes possible.
 *
 * SRD Rules Glossary, "Carrying Capacity": "Your size and Strength score
 * determine the maximum weight in pounds that you can carry", and the table
 * prints two numbers per size — what you can carry and what you can drag, lift
 * or push. Small and Medium are Str × 15 and Str × 30; Tiny is half of each
 * and every size above doubles.
 *
 * **Two honesties are load-bearing here.** `weightLb` is `number | null`, and
 * null is "nobody has said" rather than zero — some items print no weight, and
 * the generic placeholders an arcane focus or a musical instrument stand in
 * for print none by their nature. So the sum is a **lower bound** with the
 * unweighed lines counted beside it, and a refusal made on a lower bound can
 * only ever under-refuse. (How many there are is a count, and counts live in
 * the reports rather than in prose.)
 *
 * And **the refusal stands where every reading agrees**, which is the printed
 * Drag/Lift/Push maximum rather than the Carry column. The SRD does not make
 * Carry a hard stop; it hands the GM a switch — "You can usually carry your
 * gear and treasure without worrying about the weight of those objects. If you
 * try to haul an unusually heavy object or a massive number of lighter
 * objects, the GM **might** require you to abide by the rules for carrying
 * capacity." This engine has nowhere to hold "this table turned that on", and
 * refusing at Carry anyway would leave a canonical low-Strength character
 * unable to buy or pick up anything for ever, because the SRD's own starting
 * bundles are heavier than its own Carry figure for one. "leaves a canonical
 * low-Strength character able to pick things up" pins those numbers against
 * each other, so the wrong reading cannot come back without a measurement
 * arguing with it.
 *
 * What is **not** built is the consequence Carry does have: "While dragging,
 * lifting, or pushing weight in excess of the maximum weight you can carry,
 * your Speed can be no more than 5 feet." Speed modifiers are `standing.ts`'s,
 * which is another track's region this batch; `carryingCapacity` returns both
 * figures so the rule is one read away for whoever owns it.
 */

const id = (s: string) => asCharacterId(s);
const A = id('a');

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);
const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

/** The generator `awardItems` takes, for the copies whose count the book rolls. */
const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('s') as Rng,
  content: SRD_CONTENT,
});

/** Enough of a sheet for the two facts capacity reads: a Strength and a size. */
const sheetWith = (str: number): CharacterSheet => ({
  level: 1,
  abilities: { str, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
});

const arrives = (who: CharacterId, str: number, size: CreatureSize): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheetWith(str),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
  size,
});

/** A creature with a stated Strength, a purse, and a room to stand in. */
const walker = (str: number, size: CreatureSize = 'medium'): readonly GameEvent[] => {
  let log: readonly GameEvent[] = [
    arrives(A, str, size),
    { type: 'coins-changed', id: A, copper: 1_000_000, source: 'a patron' },
  ];
  log = run(log, (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  log = run(log, (s) => addSceneLandmark(s, 'here', { x: 50, y: 50, z: 0 }));
  log = run(log, (s) => placeCreatureInScene(s, A, { from: { landmark: 'here' }, feet: 0 }));
  return log;
};

describe('the capacity the SRD prints', () => {
  it('is Strength times fifteen for a Medium creature, and double that to drag', () => {
    const world = state(walker(15));
    expect(carryingCapacity(world, A)).toEqual({ carry: 225, dragLiftPush: 450 });
  });

  /** Tiny halves it; every size above Medium doubles. */
  it('halves for Tiny and doubles for Large', () => {
    expect(carryingCapacity(state(walker(10, 'tiny')), A)).toEqual({ carry: 75, dragLiftPush: 150 });
    expect(carryingCapacity(state(walker(10, 'large')), A)).toEqual({
      carry: 300,
      dragLiftPush: 600,
    });
  });
});

describe('what a creature is actually carrying', () => {
  it('adds up the catalogue weights of every line, quantity and all', () => {
    // A Greataxe is 7 lb and a Handaxe 2 lb, so four of them is 8.
    let log = run(walker(15), (s) => purchaseItem(s, SRD_CONTENT, A, 'greataxe'));
    log = run(log, (s) => purchaseItem(s, SRD_CONTENT, A, 'handaxe', 4));
    expect(carriedWeight(state(log), SRD_CONTENT, A)).toEqual({ pounds: 15, unweighed: 0 });
  });

  /**
   * **An unweighed item is counted, not weighed as nothing.** Null is nobody
   * having said, and a sum that silently treated it as zero would be a lie a
   * refusal was then made on.
   */
  it('counts what nobody has weighed rather than calling it weightless', () => {
    const log = run(walker(15), (s) =>
      awardItems(s, supply(), A, [{ id: 'wand-of-secrets' }], 'in the barrow'),
    );
    expect(carriedWeight(state(log), SRD_CONTENT, A)).toEqual({ pounds: 0, unweighed: 1 });
  });

  /** And what is put down stops being carried, which is the whole point. */
  it('drops with the item', () => {
    let log = run(walker(15), (s) => purchaseItem(s, SRD_CONTENT, A, 'greataxe'));
    expect(carriedWeight(state(log), SRD_CONTENT, A).pounds).toBe(7);
    log = run(log, (s) => dropItem(s, SRD_CONTENT, A, { item: 'greataxe' }));
    expect(carriedWeight(state(log), SRD_CONTENT, A).pounds).toBe(0);
  });
});

describe('what is lying at a creature’s feet', () => {
  it('is the pile within arm’s reach, and nothing further off', () => {
    let log = run(walker(15), (s) => purchaseItem(s, SRD_CONTENT, A, 'greataxe'));
    log = run(log, (s) => purchaseItem(s, SRD_CONTENT, A, 'dagger'));
    // One at their feet and one across the room, so the answer is the filter's
    // rather than the fixture's: a test holding only the near pile would pass
    // with no distance rule at all.
    log = run(log, (s) => dropItem(s, SRD_CONTENT, A, { item: 'greataxe' }));
    log = run(log, (s) =>
      dropItem(s, SRD_CONTENT, A, {
        item: 'dagger',
        placement: { from: { landmark: 'here' }, feet: 30, bearing: 90 },
      }),
    );

    expect(groundItems(state(log).scene!).map((pile) => pile.item)).toEqual(['greataxe', 'dagger']);
    expect(unwrap(itemsWithinReach(state(log), A), 'reach').map((pile) => pile.item)).toEqual([
      'greataxe',
    ]);
  });

  /**
   * **"Nobody has described a room" is not "the room is bare."** This answered
   * the second to the first, which is rule 6's mistake made by a reader rather
   * than by a refusal.
   */
  it('asks for a scene rather than reporting an empty floor', () => {
    const roomless = fold('seed', [arrives(A, 15, 'medium')]);
    const asked = itemsWithinReach(roomless, A);
    expect(isNeedsContext(asked)).toBe(true);
    expect(contextRequestsOf(asked)[0]?.satisfyWith).toMatch(/setScene/);
  });
});

describe('a gain heavier than the creature could lift', () => {
  /**
   * **Measured against Drag/Lift/Push, not against Carry**, and the SRD's own
   * third sentence is why: "While dragging, lifting, or pushing weight in
   * excess of the maximum weight you can carry, your Speed can be no more than
   * 5 feet." A rule about being *over* Carry presumes you may be over it, so
   * Carry is where you slow down and the second column is the ceiling.
   *
   * Strength 3 lifts 90 lb; two suits of Chain Mail are 110.
   */
  it('is refused at the shop, with what it weighs and what is left', () => {
    const refused = purchaseItem(state(walker(3)), SRD_CONTENT, A, 'chain-mail', 2);
    expect(isErr(refused) && refused.code).toBe('over_capacity');
    expect(isErr(refused) && refused.reason).toMatch(/90/);
  });

  it('is refused bending down for it', () => {
    // Somebody strong buys the pile and puts it down; somebody weak cannot
    // pick it up again.
    const strong = id('strong');
    let log: readonly GameEvent[] = [
      ...walker(3),
      arrives(strong, 18, 'medium'),
      { type: 'coins-changed', id: strong, copper: 1_000_000, source: 'a patron' },
    ];
    log = run(log, (s) => placeCreatureInScene(s, strong, { from: { creature: A }, feet: 5 }));
    log = run(log, (s) => purchaseItem(s, SRD_CONTENT, strong, 'chain-mail', 2));
    log = run(log, (s) => dropItem(s, SRD_CONTENT, strong, { item: 'chain-mail' }));

    const refused = takeItemUp(state(log), SRD_CONTENT, A, { item: 'chain-mail' });
    expect(isErr(refused) && refused.code).toBe('over_capacity');
  });

  /** And a gain that fits is not refused, so the guard is about the weight. */
  it('is not refused when it fits', () => {
    const bought = purchaseItem(state(walker(3)), SRD_CONTENT, A, 'dagger');
    expect(bought.ok).toBe(true);
  });

  /**
   * **The measurement that made the first reading wrong, pinned so it cannot
   * be forgotten.** A canonical Bard's option A with a Sage's pack is heavier
   * than a Strength-8 Bard's Carry figure — the SRD's own kit against the
   * SRD's own number — so a ceiling at Carry would have left a character the
   * engine had just minted unable to buy or pick up anything at all, for ever.
   * It is comfortably inside what that Bard can lift, which is the column the
   * book calls a maximum.
   */
  it('leaves a canonical low-Strength character able to pick things up', () => {
    const weigh = (items: readonly { readonly id: string; readonly quantity: number }[]): number =>
      items.reduce(
        (total, line) =>
          total +
          SRD_CONTENT.expandPack(line.id).reduce(
            (inner, inside) =>
              inner + (SRD_CONTENT.item(inside.id)?.weightLb ?? 0) * inside.quantity * line.quantity,
            0,
          ),
        0,
      );
    const bard = SRD_CONTENT.classes.find((one) => one.id === 'bard')!;
    const sage = SRD_CONTENT.backgrounds.find((one) => one.id === 'sage')!;
    const kit =
      weigh(bard.startingEquipment.find((one) => one.option === 'A')!.items) +
      weigh(sage.startingEquipment.find((one) => one.option === 'A')!.items);

    const capacity = carryingCapacity(state(walker(8)), A);
    // Exactly, so that the argument in the docstring above is a measurement
    // rather than a remark: a prose figure nothing pins is the failure rule 8
    // is about, and this one is load-bearing for which column is the ceiling.
    expect({ kit, ...capacity }).toEqual({ kit: 147, carry: 120, dragLiftPush: 240 });
  });

  /**
   * **The refusal is made on the known weight only.** An unweighed item adds
   * nothing to the sum, so the bound can only ever be too low — which
   * under-refuses, and never refuses something that would have fitted.
   */
  it('never refuses on weight nobody has stated', () => {
    let log = walker(3);
    for (let n = 0; n < 20; n += 1) {
      log = run(log, (s) =>
        awardItems(s, supply(), A, [{ id: 'wand-of-secrets' }], 'in the barrow', {
          commandId: `found-${n}`,
        }),
      );
    }
    expect(carriedWeight(state(log), SRD_CONTENT, A)).toEqual({ pounds: 0, unweighed: 20 });
    expect(purchaseItem(state(log), SRD_CONTENT, A, 'dagger').ok).toBe(true);
  });
});
