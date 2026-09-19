import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SPELL_DEFINITIONS } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CatalogueItem, CharacterSheet, Content } from '@ie/engine';
import {
  awardItems,
  chargesLeft,
  createRng,
  createRollIssuer,
  equipItem,
  extendContent,
  fold,
  ongoingSpellOf,
  resolveSpell,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import { type Result } from '@ie/shared';

/**
 * What an item's `casts` grant actually requires of the spell under it.
 *
 * `ITEM_SHAPES`'s largest blocker says an item "casts a named spell and the
 * catalogue has no executable definition of that spell", and the word that
 * matters turns out to be **definition** rather than *executable*: the
 * predicate `checkContent` hands `itemCastsProblems` is `spells.some(s => s.id
 * === id)` — the definitions, not the ones with effects in them — and
 * `castFromItem` reads `content.spell(id)`, which answers for a tracked
 * definition exactly as it answers for an executed one.
 *
 * That is not a loophole; it is SRD's own sentence about what a casting from
 * an item *is*. "The spell uses its normal casting time, range, and duration,
 * and the user of the item must concentrate if the spell requires
 * Concentration." Every one of those is arithmetic a tracked definition
 * already carries — `spell-tracking.test.ts` drives all of them — so a wand
 * that casts a tracked spell spends its charge, takes the action, holds the
 * Concentration, runs the clock and hands the table the spell's own
 * `unmodelled` through `unverified`. What it does not do is decided by the
 * spell's row in `COVERAGE.md`, not by the wand's.
 *
 * A spell with **no definition at all** is a different answer, and the same
 * refusal says so in as many words. Both directions are driven below, because
 * a blocker map that cannot tell them apart sends a brief to write spells it
 * did not need.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const BADGER = id('badger');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  /** Nobody here casts spells: neither ring nor wand prints a bracket. */
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
  { type: 'creature-placed', id: BADGER, placement: { from: { creature: WIELDER }, feet: 10, bearing: 0 } },
  { type: 'sight-declared', from: WIELDER, to: BADGER, seen: true },
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

/**
 * Owned and in hand, which is all either of these two items asks for.
 *
 * Handed over through `awardItems`, the door a DM hands a party what it
 * found: a charged copy is labelled and given its own pool where it is
 * gained, so a hand-written gain would leave the wand with no charges.
 */
const holding = (itemId: string): readonly GameEvent[] => {
  const base = run(
    [added(WIELDER, 'Humanoid'), added(BADGER, 'Beast'), ...SCENE],
    (s) => awardItems(s, supply('the-hoard'), WIELDER, [{ id: itemId }], 'the hoard'),
  );
  return run(base, (s) => equipItem(s, SRD_CONTENT, WIELDER, itemId));
};

const left = (log: readonly GameEvent[], itemId: string): number =>
  chargesLeft(fold('seed', log), SRD_CONTENT, WIELDER, itemId);

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as Extract<GameEvent, { type: 'spell-cast' }> | undefined;

const homebrewWand = (itemId: string, spell: string): CatalogueItem => ({
  id: itemId,
  name: itemId,
  kind: 'wand',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    { kind: 'pool', key: `${itemId}:charges`, label: `${itemId} charges`, uses: 3, recovers: 'dawn' },
    { kind: 'casts', spell, charges: 1 },
  ],
});

describe('the gate an item’s casting has to pass is a definition, not an effect list', () => {
  /** The spell this rests on really is one the engine does not execute. */
  it('is asked of a spell the catalogue tracks rather than executes', () => {
    const detect = SPELL_DEFINITIONS.find((d) => d.id === 'detect-magic');
    expect(detect?.effects, 'Detect Magic resolves nothing').toEqual([]);
    expect(detect?.activation).toBeUndefined();
    expect(detect?.areaTrigger).toBeUndefined();
    expect(detect?.unmodelled ?? []).not.toEqual([]);
  });

  it('accepts an item that casts a tracked definition', () => {
    const built = extendContent(SRD_CONTENT, {
      items: [homebrewWand('wand-of-the-tracked-spell', 'detect-magic')],
    });
    expect(isErr(built) && built.reason).toBeFalsy();
    expect(built.ok).toBe(true);
  });

  /**
   * And refuses one whose spell the catalogue has no definition of at all,
   * which is what the blocker on the entries still under that shape names.
   *
   * **The example used to be Gate**, and the batch that transcribed the Cubic
   * Gate wrote it as a tracked definition — which is the distinction this file
   * exists for, arriving from the other side. Wish is the one now, and it is a
   * better one: nothing this repository has described would let it be written.
   */
  it('refuses an item that casts a spell nothing defines', () => {
    expect(SRD_CONTENT.spellEntry('wish'), 'the index knows Wish').not.toBeNull();
    expect(SRD_CONTENT.spell('wish'), 'and nothing defines it').toBeNull();
    expect(SRD_CONTENT.spell('gate'), 'where Gate is tracked now').not.toBeNull();

    const built = extendContent(SRD_CONTENT, {
      items: [homebrewWand('wand-of-the-undefined-spell', 'wish')],
    });
    expect(isErr(built) && built.code).toBe('invalid_content');
    expect(isErr(built) && built.reason).toContain('no executable definition of');
  });
});

/**
 * SRD Wand of Magic Detection: "_Wand, Uncommon._ This wand has 3 charges.
 * While holding it, you can expend 1 charge to cast _Detect Magic_ from it.
 * The wand regains 1d3 expended charges daily at dawn."
 *
 * Four sentences and no fifth. No attunement bracket, no printed DC, no
 * crumbling on the last charge — the whole entry is a pool, a price and a
 * spell, so the record carries no `unmodelled` at all.
 */
describe('a Wand of Magic Detection casts Detect Magic', () => {
  const waved = (seed = 'wand') => {
    const log = holding('wand-of-magic-detection');
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'detect-magic', targets: [], item: 'wand-of-magic-detection' },
        supply(seed),
      ),
      'the wand casting Detect Magic',
    );
    return { log: [...log, ...out.events], out };
  };

  it('spends one of its three charges and pays no slot', () => {
    const { log, out } = waved();
    expect(left(log, 'wand-of-magic-detection')).toBe(2);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(castOf(out.events)?.slot).toBeNull();
    expect(castOf(out.events)?.route).toBe('item:wand-of-magic-detection');
    expect(castOf(out.events)?.level).toBe(1);
  });

  /**
   * SRD "Spells Cast from Items": "the user of the item must concentrate if
   * the spell requires Concentration." Detect Magic does, so a wand anyone may
   * pick up costs its wielder whatever they were already holding.
   */
  it('holds the Concentration the spell asks for, on its own ten-minute clock', () => {
    const { log, out } = waved();
    const state = fold('seed', log);
    expect(castOf(out.events)?.concentration).toBe(true);
    expect(state.creatures[WIELDER]?.concentration?.castingId).toBe(out.castingId);
    const record = ongoingSpellOf(state, out.castingId!);
    expect(record?.spellId).toBe('detect-magic');
    // SRD: "The spell is cast at the lowest possible spell and caster level."
    expect(record?.numbers.casterLevel).toBe(1);
    // "Duration: Concentration, up to 10 minutes", from a casting at second 0.
    expect(out.events).toContainEqual({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: out.castingId },
      deadline: { kind: 'elapsed', at: 600 },
    });
  });

  /**
   * **The honesty the wand inherits rather than states.** What Detect Magic
   * leaves to the table is Detect Magic's note, and casting it from an item
   * carries it to the narrating layer unchanged — which is the whole reason a
   * wand over a tracked spell is an item and not a stub.
   */
  it('hands the table what Detect Magic does not do', () => {
    const { out } = waved();
    expect(out.unverified.length).toBeGreaterThan(0);
    for (const gap of SRD_CONTENT.spell('detect-magic')?.unmodelled ?? []) {
      expect(out.unverified).toContain(`Detect Magic: ${gap}`);
    }
  });

  it('refuses a second charge the wand’s line does not offer', () => {
    const out = resolveSpell(
      fold('seed', holding('wand-of-magic-detection')),
      WIELDER,
      { spellId: 'detect-magic', targets: [], item: 'wand-of-magic-detection', charges: 2 },
      supply('greedy'),
    );
    expect(isErr(out) && out.code).toBe('bad_charges');
  });
});

/**
 * SRD Ring of Animal Influence: "_Ring, Rare._ This ring has 3 charges, and it
 * regains 1d3 expended charges daily at dawn. While wearing the ring, you can
 * expend 1 charge to cast one of the following spells (save DC 13) from it:
 * _Animal Friendship_ / _Fear_ (affects Beasts only) / _Speak with Animals_."
 *
 * Two of the three rows, and the third is left out rather than written wider
 * than the book — which is the Staff of Fire's Wall of Fire row seen from the
 * other side.
 */
describe('a Ring of Animal Influence casts what its table prices', () => {
  const RING = 'ring-of-animal-influence';

  /**
   * What this wielder's *own* numbers come to, off an item that prints none.
   *
   * SRD's fallback for an item with no printed DC is the wielder's own — "+0
   * with your Proficiency Bonus" where they have no spellcasting ability — and
   * the Wand of Magic Detection is the item in the catalogue that prints
   * nothing, so it is where the number is read from rather than recalculated
   * here.
   */
  const fallbackDcOfTheWielder = (): number | undefined => {
    const log = holding('wand-of-magic-detection');
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'detect-magic', targets: [], item: 'wand-of-magic-detection' },
        supply('fallback'),
      ),
      'the wand, which prints no DC',
    );
    return ongoingSpellOf(fold('seed', [...log, ...out.events]), out.castingId!)?.numbers.saveDc;
  };

  it('charms a Beast against the ring’s own DC, not the wielder’s', () => {
    const log = holding(RING);
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'animal-friendship', targets: [BADGER], item: RING },
        supply('friendship'),
      ),
      'the ring casting Animal Friendship',
    );
    expect(left([...log, ...out.events], RING)).toBe(2);
    expect(out.outcomes.map((o) => o.target)).toEqual([BADGER]);

    // The ring's 13, pinned at the casting — and demonstrably not the
    // wielder's, who has no spellcasting ability at all and whose fallback
    // number the wand below arrives at instead.
    const record = ongoingSpellOf(fold('seed', [...log, ...out.events]), out.castingId!);
    expect(record?.numbers.saveDc).toBe(13);
    expect(fallbackDcOfTheWielder()).not.toBe(13);

    expect(
      out.events.some((e) => e.type === 'roll-recorded' && e.who === BADGER && e.label.includes('Animal Friendship')),
      'the badger rolled the save the ring forces',
    ).toBe(true);
  });

  /** A Humanoid is not a Beast, and Animal Friendship says so before any die. */
  it('refuses a target the spell’s own rule excludes', () => {
    const out = resolveSpell(
      fold('seed', holding(RING)),
      WIELDER,
      { spellId: 'animal-friendship', targets: [WIELDER], item: RING },
      supply('wrong-target'),
    );
    expect(isErr(out)).toBe(true);
  });

  /** The tracked row of the same table, priced the same and tracked the same. */
  it('casts Speak with Animals for a charge and says what it leaves the table', () => {
    const log = holding(RING);
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'speak-with-animals', targets: [], item: RING },
        supply('chatter'),
      ),
      'the ring casting Speak with Animals',
    );
    expect(left([...log, ...out.events], RING)).toBe(2);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(out.unverified.join(' ')).toContain('Speak with Animals');

    // **And it is the ring's 13 it pins, on the row that rolls nothing.**
    // "(save DC 13)" is printed once, before the list, so it governs all
    // three; leaving it off this grant would not leave the field empty but
    // substitute the wielder's own number, which the book contradicts.
    const record = ongoingSpellOf(fold('seed', [...log, ...out.events]), out.castingId!);
    expect(record?.numbers.saveDc).toBe(13);
    expect(fallbackDcOfTheWielder()).not.toBe(13);
  });

  /** Fear is not on the ring, because "(affects Beasts only)" is not writable. */
  it('does not cast the row the engine would cast too widely', () => {
    const out = resolveSpell(
      fold('seed', holding(RING)),
      WIELDER,
      { spellId: 'fear', targets: [], item: RING },
      supply('fear'),
    );
    expect(isErr(out) && out.code).toBe('item_casts_nothing');
  });

  /** And the same seed gives the same ring twice. */
  it('folds identically from the same seed', () => {
    const first = unwrap(
      resolveSpell(
        fold('seed', holding(RING)),
        WIELDER,
        { spellId: 'animal-friendship', targets: [BADGER], item: RING },
        supply('repeat'),
      ),
      'first',
    );
    const second = unwrap(
      resolveSpell(
        fold('seed', holding(RING)),
        WIELDER,
        { spellId: 'animal-friendship', targets: [BADGER], item: RING },
        supply('repeat'),
      ),
      'second',
    );
    expect(second.events).toEqual(first.events);
  });
});
