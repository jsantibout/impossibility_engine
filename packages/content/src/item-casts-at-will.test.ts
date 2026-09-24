import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet, Content } from '@ie/engine';
import {
  chargesLeft,
  createRng,
  createRollIssuer,
  equipItem,
  fold,
  resolveSpell,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import { type Result } from '@ie/shared';

/**
 * The three SRD items whose casting the book charges nothing for, two of them
 * narrowed to whoever is wearing them.
 *
 * > **Helm of Comprehending Languages.** _Wondrous Item, Uncommon._ "While
 * > wearing this helm, you can cast _Comprehend Languages_ from it."
 * >
 * > **Ring of Jumping.** _Ring, Uncommon (Requires Attunement)._ "While
 * > wearing this ring, you can cast _Jump_ from it, but can target only
 * > yourself when you do so."
 * >
 * > **Ring of Water Walking.** _Ring, Uncommon._ "While wearing this ring, you
 * > cast _Water Walk_ from it, targeting only yourself."
 *
 * Between them they print every clause the two new fields exist for and
 * nothing else: no charge count, no "can't be used again until the next
 * dawn", no save DC, no attack bonus, no table. So each is a whole entry with
 * no `unmodelled` at all, and what the engine cannot do about jumping or
 * about liquid surfaces is the *spell's* note, handed to the table through
 * `unverified` exactly as a Wizard's casting hands it over.
 *
 * Driven end to end rather than inspected, because a record that parses and
 * never casts is the failure a catalogue cannot see.
 */

const id = (s: string) => asCharacterId(s);
const WEARER = id('wearer');
const COMPANION = id('companion');

const HELM = 'helm-of-comprehending-languages';
const JUMPING = 'ring-of-jumping';
const WATER_WALKING = 'ring-of-water-walking';

const sheet = (): CharacterSheet => ({
  level: 4,
  abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  /** None of the three asks for a spellcaster, and this one is not. */
  spellcastingAbility: null,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 80, y: 80, z: 0 } },
  { type: 'creature-placed', id: WEARER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'creature-placed', id: COMPANION, placement: { from: { creature: WEARER }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WEARER, to: COMPANION, seen: true },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** Worn, and attuned where the book prints the bracket. */
const wearing = (itemId: string): readonly GameEvent[] => {
  const base: readonly GameEvent[] = [
    added(WEARER),
    added(COMPANION),
    ...SCENE,
    { type: 'items-gained', id: WEARER, items: [{ id: itemId, quantity: 1 }], source: 'the hoard' },
  ];
  const worn = run(base, (s) => equipItem(s, SRD_CONTENT, WEARER, itemId));
  return SRD_CONTENT.item(itemId)?.attunement === undefined
    ? worn
    : [...worn, { type: 'attuned', id: WEARER, item: itemId }];
};

const supply = (seed: string, content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as
    | Extract<GameEvent, { type: 'spell-cast' }>
    | undefined;

describe('a Helm of Comprehending Languages casts, and casts again', () => {
  const HELM_SPELL = 'comprehend-languages';

  /** The record says what the page says: a casting, and no economy at all. */
  it('is a casting grant with no price and no pool', () => {
    const helm = SRD_CONTENT.item(HELM);
    expect(helm?.attunement, 'the book prints no bracket').toBeUndefined();
    expect(helm?.unmodelled, 'the whole entry is one sentence').toBeUndefined();
    expect(helm?.grants).toEqual([{ kind: 'casts', spell: HELM_SPELL, atWill: true }]);
  });

  it('casts twice, with nothing spent either time', () => {
    const worn = wearing(HELM);
    expect(
      worn.some((e) => e.type === 'resource-pool-declared'),
      'nothing declares a pool, because the helm has none',
    ).toBe(false);

    const first = unwrap(
      resolveSpell(
        fold('seed', worn),
        WEARER,
        { spellId: HELM_SPELL, targets: [], item: HELM },
        supply('first'),
      ),
      'the helm casting Comprehend Languages',
    );
    const second = unwrap(
      resolveSpell(
        fold('seed', [...worn, ...first.events]),
        WEARER,
        { spellId: HELM_SPELL, targets: [], item: HELM },
        supply('second'),
      ),
      'the helm casting it again',
    );

    for (const out of [first, second]) {
      expect(castOf(out.events)?.route).toBe(`item:${HELM}`);
      // SRD: it "doesn't expend any of the user's spell slots".
      expect(castOf(out.events)?.slotless).toBe('magic-item');
      expect(castOf(out.events)?.slot).toBeNull();
      expect(out.events.filter((e) => e.type === 'resource-spent')).toEqual([]);
    }
    expect(first.castingId).not.toBe(second.castingId);
    expect(chargesLeft(fold('seed', worn), SRD_CONTENT, WEARER, HELM)).toBe(0);
  });

  /** What the spell leaves to the table, carried over by the helm unchanged. */
  it('hands the table what Comprehend Languages does not do', () => {
    const out = unwrap(
      resolveSpell(
        fold('seed', wearing(HELM)),
        WEARER,
        { spellId: HELM_SPELL, targets: [], item: HELM },
        supply('honest'),
      ),
      'the helm',
    );
    for (const gap of SRD_CONTENT.spell(HELM_SPELL)?.unmodelled ?? []) {
      expect(out.unverified).toContain(`Comprehend Languages: ${gap}`);
    }
  });
});

describe('two rings cast at will and at nobody but their wearer', () => {
  const RINGS = [
    { item: JUMPING, spell: 'jump', name: 'Jump' },
    { item: WATER_WALKING, spell: 'water-walk', name: 'Water Walk' },
  ] as const;

  it.each(RINGS)('$item is at will and narrowed, and nothing else', ({ item, spell }) => {
    const ring = SRD_CONTENT.item(item);
    expect(ring?.unmodelled, 'the whole entry is one sentence').toBeUndefined();
    expect(ring?.grants).toEqual([
      { kind: 'casts', spell, atWill: true, targetsSelfOnly: true },
    ]);
  });

  /** The bracket, or its absence, exactly as the type line prints it. */
  it('requires attunement for the Ring of Jumping and not for the other', () => {
    expect(SRD_CONTENT.item(JUMPING)?.attunement).toEqual({});
    expect(SRD_CONTENT.item(WATER_WALKING)?.attunement).toBeUndefined();
  });

  it.each(RINGS)('$item casts on its wearer for nothing', ({ item, spell }) => {
    const worn = wearing(item);
    const out = unwrap(
      resolveSpell(
        fold('seed', worn),
        WEARER,
        { spellId: spell, targets: [WEARER], item },
        supply(`self-${item}`),
      ),
      `${item} casting on its wearer`,
    );
    expect(castOf(out.events)?.route).toBe(`item:${item}`);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(out.events.filter((e) => e.type === 'resource-spent')).toEqual([]);
  });

  /**
   * "…but can target only yourself when you do so." The companion is standing
   * five feet away, in sight and in range of both spells, **and has consented**
   * — both spells are cast on "a willing creature", so a casting that said
   * nothing would be asked about the consent instead of refused, and the claim
   * made here is that the ring refuses a companion the spell would otherwise
   * have taken. It is the ring that says no, and nothing else.
   */
  it.each(RINGS)('$item refuses a companion the spell itself would take', ({ item, spell, name }) => {
    const out = resolveSpell(
      fold('seed', wearing(item)),
      WEARER,
      { spellId: spell, targets: [COMPANION], item, willing: [COMPANION] },
      supply(`other-${item}`),
    );
    expect(isErr(out) && out.code).toBe('targets_only_yourself');
    expect(isErr(out) && out.reason).toContain(name);
    expect(isErr(out) && out.reason).toContain(COMPANION);
  });

  /**
   * And the narrowing is the *ring's*: the same spell, cast the same way by a
   * creature who knows it, reaches the companion perfectly well.
   */
  it.each(RINGS)('$item narrows a spell that otherwise reaches further', ({ spell }) => {
    const definition = SRD_CONTENT.spell(spell);
    expect(definition?.targets.self, `${spell} may be cast on yourself`).toBe(true);
    expect(
      definition === null || definition === undefined
        ? 0
        : definition.targets.count + (definition.targets.extraPerSlotLevelAbove ?? 0),
      `${spell} takes more than the ring offers`,
    ).toBeGreaterThan(1);
  });
});
