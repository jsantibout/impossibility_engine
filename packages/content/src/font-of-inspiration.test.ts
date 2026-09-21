import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  advanceCharacter,
  beginRest,
  createCharacter,
  endRest,
  fold,
  remaining,
  SHORT_REST,
  LONG_REST,
  type CharacterChoices,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { FEATURE_BLOCKED_ON, manualFeatureIds } from '../scripts/missing-feature-shapes.js';

/**
 * The second sentence of Font of Inspiration, which rewrites the recovery of a
 * pool declared four levels earlier.
 *
 * SRD Bardic Inspiration declares the pool with a Long Rest on it; SRD Font of
 * Inspiration, at Bard level 5, says "you regain all your expended uses of
 * Bardic Inspiration when you finish a Short Rest". The whole of the answer is
 * the tag the pool carries — `endRest` emits both `short-rest` and `long-rest`
 * on a Long Rest precisely so a short-rest pool needs no second declaration —
 * so what had to be built is the rewrite reaching the tag, on **both** paths
 * into a level 5 Bard: one created there, and one who got there in play.
 *
 * The two mistakes it would have been cheapest to make are tested for by name.
 * `regainsOnShortRest` is the partial-recovery field — "one back on a Short,
 * all on a Long" — and would hand back a single die; the `recovery` grant is a
 * command spending its own once-per-Long-Rest pool, and would invent a daily
 * limit the book does not print.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WHO = id('who');

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

/** The spells a Bard of this level knows, in the order the levels grant them. */
const KNOWN = [
  'bane',
  'charm-person',
  'dissonant-whispers',
  'heroism',
  'healing-word',
  'hold-person',
  'invisibility',
  'fear',
  'hypnotic-pattern',
];

/** A Bard with a Charisma of 17, which buys three inspiration dice. */
const bard = (level: number): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 17 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['performance', 'stealth', 'deception'],
  subclassId: 'college-of-lore',
  cantrips: ['vicious-mockery', 'dancing-lights', 'light'],
  preparedSpells: KNOWN.slice(0, level >= 5 ? 9 : 7),
  featureChoices: {
    'human:skillful': ['perception'],
    'bard:expertise': ['performance', 'stealth'],
    'college-of-lore:bonus-proficiencies': ['acrobatics', 'athletics', 'insight'],
  },
  feats: {
    ...common.feats,
    'bard:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

const made = (choices: CharacterChoices): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT, choices, WHO), `create ${choices.classId}`) as GameEvent[];

const spend = (key: string, amount = 1): GameEvent => ({
  type: 'resource-spent',
  id: WHO,
  key,
  amount,
});

const left = (state: GameState, key: string): number =>
  remaining(state.creatures[WHO]!.resources, key);

const poolOf = (state: GameState, key: string) => state.creatures[WHO]!.resources.pools[key];

/**
 * The log with a whole rest of the given kind on the end of it.
 *
 * `which` is the idempotency key rather than decoration: two Short Rests with
 * the same inputs are one command retried, and the second would hand back
 * nothing at all.
 */
const rest = (log: readonly GameEvent[], kind: 'short' | 'long', which = 'first'): GameEvent[] => {
  const begun: GameEvent[] = [
    ...log,
    ...unwrap(beginRest(fold('seed', log), WHO, kind, `begin-${kind}-${which}`), 'begin'),
    {
      type: 'time-advanced',
      seconds: kind === 'short' ? SHORT_REST : LONG_REST,
      reason: 'resting',
    },
  ];
  return [
    ...begun,
    ...unwrap(endRest(fold('seed', begun), WHO, { commandId: `end-${kind}-${which}` }), 'end')
      .events,
  ];
};

describe('a level 5 Bard regains every inspiration die on a Short Rest', () => {
  it('gives all three back, and gives them back on a Long Rest too', () => {
    const log: GameEvent[] = [...made(bard(5)), spend('bardic-inspiration', 3)];
    expect(left(fold('seed', log), 'bardic-inspiration')).toBe(0);

    const short = rest(log, 'short');
    // Trap 1: the rewrite is the tag, not `regainsOnShortRest`, so it is three
    // back rather than one.
    expect(left(fold('seed', short), 'bardic-inspiration')).toBe(3);

    // And the pool a Short Rest now answers for is still answered for by a
    // Long Rest, because `endRest` emits both tags.
    const long = rest([...short, spend('bardic-inspiration', 3)], 'long');
    expect(left(fold('seed', long), 'bardic-inspiration')).toBe(3);
  });

  it('carries the rewritten tag on the pool itself', () => {
    const state = fold('seed', [...made(bard(5))]);
    expect(poolOf(state, 'bardic-inspiration')?.recovers).toBe('short-rest');
    // Trap 1 again, from the other side: the partial field is not how this is
    // said, and a pool carrying both would be a different rule.
    expect(poolOf(state, 'bardic-inspiration')?.regainsOnShortRest).toBeUndefined();
  });

  /**
   * Trap 2: the sentence costs nothing and has no limit, so it is not the
   * `recovery` grant — which is a command spending a pool of its own.
   */
  it('costs nothing and happens at every rest, not once a day', () => {
    const created = made(bard(5));
    const pools = Object.keys(fold('seed', [...created]).creatures[WHO]!.resources.pools);
    expect(pools).toContain('bardic-inspiration');
    expect(pools).not.toContain('bard:font-of-inspiration');

    // Two Short Rests in a row, each giving everything back: a daily limit
    // would refuse the second.
    const once = rest([...created, spend('bardic-inspiration', 3)], 'short');
    expect(left(fold('seed', once), 'bardic-inspiration')).toBe(3);

    const spentAgain = [...once, spend('bardic-inspiration', 3)];
    const twice = rest(spentAgain, 'short', 'second');
    expect(left(fold('seed', twice), 'bardic-inspiration')).toBe(3);

    // Nothing was spent to make it happen: the rest emits its restorations and
    // no expenditure of any pool at all.
    expect(twice.slice(spentAgain.length).filter((e) => e.type === 'resource-spent')).toEqual([]);
  });
});

describe('a level 4 Bard does not', () => {
  it('keeps the Long Rest the pool was declared with', () => {
    const log: GameEvent[] = [...made(bard(4)), spend('bardic-inspiration', 3)];
    expect(poolOf(fold('seed', log), 'bardic-inspiration')?.recovers).toBe('long-rest');

    const short = rest(log, 'short');
    expect(left(fold('seed', short), 'bardic-inspiration')).toBe(0);

    const long = rest(short, 'long');
    expect(left(fold('seed', long), 'bardic-inspiration')).toBe(3);
  });
});

describe('a Bard who reaches level 5 in play gets the new recovery', () => {
  /**
   * The load-bearing half. `advanceCharacter` emitted a resize and nothing
   * else, so a pool whose *maximum* had not moved said nothing — and a Bard
   * who levelled 4 → 5 at the table would have kept the Long Rest for ever
   * while one created at 5 had the Short. Two paths to one character that
   * disagree is the bug `poolsFor` was made one function to prevent.
   */
  it('emits the rewrite and leaves what was already spent alone', () => {
    const created = [...made(bard(4)), spend('bardic-inspiration', 2)];
    const gained = unwrap(
      advanceCharacter(fold('seed', created), SRD_CONTENT, WHO, {
        preparedSpells: KNOWN.slice(0, 9),
      }),
      'advance',
    );

    const log = [...created, ...gained];
    const pool = poolOf(fold('seed', log), 'bardic-inspiration');
    expect(pool?.recovers).toBe('short-rest');
    // The maximum did not move, so the resize says nothing: the rewrite is its
    // own event or it is nothing.
    expect(gained.filter((event) => event.type === 'resource-pool-resized')).not.toContainEqual(
      expect.objectContaining({ key: 'bardic-inspiration' }),
    );
    // Levelling up is not a rest: the two dice spent at level 4 are still spent.
    expect(pool?.spent).toBe(2);

    expect(left(fold('seed', rest(log, 'short')), 'bardic-inspiration')).toBe(3);
  });

  /** And nothing is said twice: a second advancement re-declares nothing. */
  it('says it once, on the level that grants the feature', () => {
    const created = made(bard(4));
    const gained = unwrap(
      advanceCharacter(fold('seed', created), SRD_CONTENT, WHO, {
        preparedSpells: KNOWN.slice(0, 9),
      }),
      'advance',
    );
    expect(
      gained.filter((event) => event.type === 'resource-pool-recovery-changed').length,
    ).toBe(1);

    const log = [...created, ...gained];
    const again = unwrap(
      advanceCharacter(fold('seed', log), SRD_CONTENT, WHO, {
        preparedSpells: [...KNOWN.slice(0, 9), 'cure-wounds'],
      }),
      'advance again',
    );
    expect(again.filter((event) => event.type === 'resource-pool-recovery-changed')).toEqual([]);
  });
});

describe('the feature is executed, and the map says so', () => {
  it('records no gap for Font of Inspiration', () => {
    expect(manualFeatureIds()).not.toContain('bard:font-of-inspiration');
    expect(FEATURE_BLOCKED_ON['bard:font-of-inspiration']).toBeUndefined();
  });

  /**
   * And the declaration names a feature the class really prints.
   *
   * `checkFeatureDefinition` sees one feature at a time and cannot ask this;
   * a typo in the id would leave the pool with its old tag and say nothing at
   * all, which is the silence rule 5 of the validator exists to prevent. So it
   * is asked of the catalogue here.
   */
  it('names a feature of the same class', () => {
    const bardClass = SRD_CONTENT.classById('bard')!;
    const declaring = bardClass.features.find((f) => f.id === 'bard:bardic-inspiration')!;
    const grant = declaring.grants!;
    expect(grant.kind).toBe('pool');
    const named = grant.kind === 'pool' ? grant.recoversSooner?.withFeature : undefined;
    expect(named).toBe('bard:font-of-inspiration');
    expect(bardClass.features.map((f) => f.id)).toContain(named);
  });
});
