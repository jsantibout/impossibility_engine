import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  awardItems,
  chargesLeft,
  equipItem,
  ongoingSpellOf,
  ongoingSpellsOn,
  resolveSpell,
} from './commands.js';

/**
 * A casting an item prices at nothing, and one it narrows to its wearer.
 *
 * Two clauses the SRD prints on items the engine could not transcribe, and
 * they are one file because they meet on the same rings.
 *
 * **"While wearing this helm, you can cast _Comprehend Languages_ from it."**
 * No charge count, no "can't be used again until the next dawn", no limit at
 * all. A `casts` grant used to require a price, so the only way to write that
 * sentence was to invent a charge the page does not print. `atWill` is the
 * licence, and it is written down rather than inferred: a grant that names
 * neither a price nor `atWill` is refused, because the absence of a cost is
 * also what a malformed entry looks like.
 *
 * **"but can target only yourself when you do so."** SRD Ring of Jumping and
 * Ring of Water Walking both narrow the spell under them to their wearer, and
 * a ring that granted the spell unnarrowed would hand out a better ring than
 * the book prints. `targetsSelfOnly` is the narrowing, and it is a
 * rules-legal refusal rather than an exception: the caster is told which
 * targets the item does not reach, and nothing has been spent when they are.
 *
 * **What an at-will casting is not, is a lesser casting.** SRD "Spells Cast
 * from Items" governs it word for word — a casting id, the Concentration the
 * definition asks for, an ongoing record Dispel Magic finds — and the last
 * case here holds all three, because a free casting that quietly skipped the
 * pipeline would be a second resolver wearing an item's name.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const ALLY = id('ally');
const MAGE = id('mage');

/** A helm that prices its casting at nothing, which is the Helm's own shape. */
const CIRCLET = 'circlet-of-plain-speech';
/** The same licence over a Concentration spell, so the pipeline is visible. */
const WARD_RING = 'ring-of-the-steady-ward';
/** At will *and* narrowed, which is the Ring of Water Walking's shape. */
const STEP_RING = 'ring-of-the-solitary-step';
/** The narrowing over a spell that lands something, so the acceptance shows. */
const GUARD_RING = 'ring-of-the-lonely-ward';
/** A narrowing over a price, so the refusal can be shown to precede it. */
const STEP_WAND = 'wand-of-the-solitary-step';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  /** Nobody who holds these items casts anything of their own. */
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const item = (
  itemId: string,
  grants: NonNullable<CatalogueItem['grants']>,
): CatalogueItem => ({
  id: itemId,
  name: itemId,
  kind: 'ring',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants,
});

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, {
    items: [
      item(CIRCLET, [{ kind: 'casts', spell: 'comprehend-languages', atWill: true }]),
      item(WARD_RING, [{ kind: 'casts', spell: 'shield-of-faith', atWill: true }]),
      item(STEP_RING, [
        { kind: 'casts', spell: 'water-walk', atWill: true, targetsSelfOnly: true },
      ]),
      item(GUARD_RING, [
        { kind: 'casts', spell: 'shield-of-faith', atWill: true, targetsSelfOnly: true },
      ]),
      item(STEP_WAND, [
        { kind: 'pool', key: `${STEP_WAND}:charges`, label: 'charges', uses: 3, recovers: 'dawn' },
        { kind: 'casts', spell: 'water-walk', charges: 1, targetsSelfOnly: true },
      ]),
    ],
  }),
  'the at-will catalogue',
);

/** The one creature here who casts anything of their own, and only to dispel. */
const MAGES_SLOTS: readonly GameEvent[] = [1, 2, 3].map((level) => ({
  type: 'resource-pool-declared',
  id: MAGE,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 2,
    recovers: 'long-rest',
  },
}));

const SCENE: readonly GameEvent[] = [
  ...MAGES_SLOTS,
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the shore', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIELDER, placement: { from: { landmark: 'the shore' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIELDER }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { creature: WIELDER }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: WIELDER, to: ALLY, seen: true },
  { type: 'sight-declared', from: MAGE, to: WIELDER, seen: true },
  {
    type: 'spellcasting-declared',
    id: MAGE,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['dispel-magic'],
    }),
  },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

/** Owned and worn, which is all any of these rings asks for. */
const wearing = (itemId: string): readonly GameEvent[] => {
  const base = run(
    [added(WIELDER), added(ALLY), added(MAGE, { spellcastingAbility: 'int' }), ...SCENE],
    // The door a DM hands a party what it found: a hand-written gain is a
    // line with no record, and a copy with no record has no charges.
    (s) => awardItems(s, supply('the-hoard'), WIELDER, [{ id: itemId }], 'the hoard'),
  );
  return run(base, (s) => equipItem(s, CONTENT, WIELDER, itemId));
};

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as
    | Extract<GameEvent, { type: 'spell-cast' }>
    | undefined;

describe('an item may cast a spell the book prices at nothing', () => {
  /**
   * The claim in one case: twice, through the public API, with no pool
   * declared anywhere and no charge spent by either casting.
   */
  it('casts twice with no pool behind it and nothing spent', () => {
    const worn = wearing(CIRCLET);
    expect(
      worn.some((e) => e.type === 'resource-pool-declared' && e.id === WIELDER),
      'wearing it declares no pool, because the item has none',
    ).toBe(false);

    const first = unwrap(
      resolveSpell(
        fold('seed', worn),
        WIELDER,
        { spellId: 'comprehend-languages', targets: [], item: CIRCLET },
        supply('first'),
      ),
      'the first casting',
    );
    const between = [...worn, ...first.events];
    const second = unwrap(
      resolveSpell(
        fold('seed', between),
        WIELDER,
        { spellId: 'comprehend-languages', targets: [], item: CIRCLET },
        supply('second'),
      ),
      'the second casting',
    );

    for (const out of [first, second]) {
      expect(castOf(out.events)?.route).toBe(`item:${CIRCLET}`);
      expect(castOf(out.events)?.slotless).toBe('magic-item');
      expect(castOf(out.events)?.slot).toBeNull();
      expect(out.events.filter((e) => e.type === 'resource-spent')).toEqual([]);
    }
    expect(first.castingId).not.toBe(second.castingId);

    const after = fold('seed', [...between, ...second.events]);
    expect(after.creatures[WIELDER]?.resources.pools).toEqual({});
    expect(chargesLeft(after, CONTENT, WIELDER, CIRCLET)).toBe(0);
  });

  /**
   * A charge count named against an item that spends none is a caller who
   * thinks they said something, and the shape every other stated fact on this
   * request takes is to refuse it rather than ignore it.
   */
  it("refuses a charge count the item's line does not have", () => {
    const out = resolveSpell(
      fold('seed', wearing(CIRCLET)),
      WIELDER,
      { spellId: 'comprehend-languages', targets: [], item: CIRCLET, charges: 1 },
      supply('greedy'),
    );
    expect(isErr(out) && out.code).toBe('bad_charges');
    expect(isErr(out) && out.reason).toContain('at will');
  });

  /**
   * SRD "Spells Cast from Items" is the whole of what an at-will casting is,
   * and none of its sentences mention a charge. So the casting is ordinary in
   * every other respect: it takes a casting id, it holds the Concentration the
   * definition asks for, and it leaves the ongoing record Dispel Magic reads.
   */
  it('is an ordinary casting in every other respect', () => {
    const worn = wearing(WARD_RING);
    const out = unwrap(
      resolveSpell(
        fold('seed', worn),
        WIELDER,
        { spellId: 'shield-of-faith', targets: [WIELDER], item: WARD_RING },
        supply('ward'),
      ),
      'the ring casting Shield of Faith',
    );
    const log = [...worn, ...out.events];
    const held = fold('seed', log);

    expect(out.castingId).not.toBe('');
    expect(castOf(out.events)?.concentration).toBe(true);
    expect(held.creatures[WIELDER]?.concentration?.castingId).toBe(out.castingId);

    const record = ongoingSpellOf(held, out.castingId!);
    expect(record?.spellId).toBe('shield-of-faith');
    // SRD: "The spell is cast at the lowest possible spell and caster level."
    expect(record?.numbers.casterLevel).toBe(1);
    expect(ongoingSpellsOn(held, WIELDER).map((one) => one.castingId)).toContain(out.castingId);

    // And Dispel Magic finds it, which is the claim the ongoing record exists
    // for: a level 1 spell against a level 3 slot ends without a roll.
    const dispelled = unwrap(
      resolveSpell(
        held,
        MAGE,
        { spellId: 'dispel-magic', targets: [WIELDER], slotLevel: 3 },
        supply('dispel'),
      ),
      'dispelling the ring’s spell',
    );
    const after = fold('seed', [...log, ...dispelled.events]);
    expect(ongoingSpellOf(after, out.castingId!)).toBeNull();
    expect(after.creatures[WIELDER]?.concentration).toBeNull();
  });
});

describe('an item may narrow the spell it casts to whoever is holding it', () => {
  /**
   * SRD Ring of Water Walking: "you cast _Water Walk_ from it, targeting only
   * yourself." Water Walk takes ten creatures; the ring takes one, and which
   * one is not the caster's choice.
   */
  it('refuses a target that is not the holder, with a reason worth reading', () => {
    const out = resolveSpell(
      fold('seed', wearing(STEP_RING)),
      WIELDER,
      { spellId: 'water-walk', targets: [ALLY], item: STEP_RING },
      supply('narrowed'),
    );
    expect(isErr(out) && out.code).toBe('targets_only_yourself');
    expect(isErr(out) && out.reason).toContain(STEP_RING);
    expect(isErr(out) && out.reason).toContain('Water Walk');
    expect(isErr(out) && out.reason).toContain(ALLY);
  });

  /** And the holder is accepted, which is the half the ring does offer. */
  it('accepts the holder', () => {
    const out = unwrap(
      resolveSpell(
        fold('seed', wearing(STEP_RING)),
        WIELDER,
        { spellId: 'water-walk', targets: [WIELDER], item: STEP_RING },
        supply('self'),
      ),
      'the ring casting Water Walk on its wearer',
    );
    expect(castOf(out.events)?.route).toBe(`item:${STEP_RING}`);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
  });

  /**
   * The refusal is the *item's* rather than the spell's, which two rings over
   * one spell prove: the ally is in range, is a legal target of Shield of
   * Faith, and is reached from the ring that prints no narrowing — while the
   * ring that prints one refuses the same casting in the same scene.
   */
  it('is the item’s narrowing and not the spell’s own rule', () => {
    const open = unwrap(
      resolveSpell(
        fold('seed', wearing(WARD_RING)),
        WIELDER,
        { spellId: 'shield-of-faith', targets: [ALLY], item: WARD_RING },
        supply('unnarrowed'),
      ),
      'the unnarrowed ring',
    );
    expect(open.outcomes.map((o) => o.target)).toEqual([ALLY]);

    const narrowed = resolveSpell(
      fold('seed', wearing(GUARD_RING)),
      WIELDER,
      { spellId: 'shield-of-faith', targets: [ALLY], item: GUARD_RING },
      supply('narrowed'),
    );
    expect(isErr(narrowed) && narrowed.code).toBe('targets_only_yourself');

    // And the narrowed ring does land on its wearer, so the refusal above is
    // about whom it reaches rather than about the ring working at all.
    const onSelf = unwrap(
      resolveSpell(
        fold('seed', wearing(GUARD_RING)),
        WIELDER,
        { spellId: 'shield-of-faith', targets: [WIELDER], item: GUARD_RING },
        supply('narrowed-self'),
      ),
      'the narrowed ring on its wearer',
    );
    expect(onSelf.outcomes.map((o) => o.target)).toEqual([WIELDER]);
  });

  /**
   * And it is reached before anything is spent, like every other refusal on
   * this path: a wand aimed at somebody it does not reach costs its holder no
   * charge at all.
   */
  it('costs nothing when it refuses', () => {
    const worn = wearing(STEP_WAND);
    expect(chargesLeft(fold('seed', worn), CONTENT, WIELDER, STEP_WAND)).toBe(3);

    // Three is a number this pool can move off, which the accepted casting
    // shows before the refused one is asked to leave it alone: a test that
    // only ever read the state *before* a refusal would pass against an
    // implementation that spent the charge.
    const paid = unwrap(
      resolveSpell(
        fold('seed', worn),
        WIELDER,
        { spellId: 'water-walk', targets: [WIELDER], item: STEP_WAND },
        supply('paid'),
      ),
      'the wand casting on its holder',
    );
    expect(chargesLeft(fold('seed', [...worn, ...paid.events]), CONTENT, WIELDER, STEP_WAND)).toBe(
      2,
    );

    const refused = resolveSpell(
      fold('seed', worn),
      WIELDER,
      { spellId: 'water-walk', targets: [ALLY], item: STEP_WAND },
      supply('costly'),
    );
    expect(isErr(refused) && refused.code).toBe('targets_only_yourself');
    // A refusal is a value with no events behind it, so there is nothing to
    // fold — and the pool is where the accepted casting proved it need not be.
    expect(refused.ok).toBe(false);
    expect(chargesLeft(fold('seed', worn), CONTENT, WIELDER, STEP_WAND)).toBe(3);
  });
});
