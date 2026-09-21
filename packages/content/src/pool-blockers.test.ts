/**
 * The half of the feature debt the blocker map could not see.
 *
 * `FEATURE_BLOCKED_ON`'s population was `automation === 'manual'`, which is
 * the predicate `COVERAGE.md`'s *executed* column counts with and is the
 * wrong one for this question. A feature declares `engine` when the engine
 * applies **what it declares**, and five features truthfully declare it while
 * the thing they are for is unbuilt: four are a `pool` grant with nothing to
 * spend a use on, and the fifth is a pool whose uses buy one of the three
 * things the book prints. Their debt is in their own notes and was ranked
 * nowhere, so a foreman planning from the map could not see it.
 *
 * So the map takes a second population beside the manual one. It is derived
 * where it can be — a bare pool is a shape, not an opinion — and **declared,
 * anchored to the note, where it cannot**: that a pool buys some of what its
 * book prints and not all of it is a fact about the SRD page, and the
 * catalogue has no idea how many options the page holds.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureDefinition } from '@ie/engine';
import {
  FEATURE_BLOCKED_ON,
  POOLS_ONLY_PARTLY_BOUGHT,
  POOL_SPENDING_MEMBERS,
  barePoolFeatureIds,
  featureBlockersOf,
  featureClausesIn,
  featureCoverageGaps,
  isBarePool,
  ledgerFeatureIds,
  manualFeatureIds,
  unanchoredFeatureClauses,
} from '../scripts/missing-feature-shapes.js';

/** The five the owner's ruling of 2026-09-21 named, in id order. */
const WIDENED = [
  'druid:wild-shape',
  'monk:focus',
  'paladin:channel-divinity',
  'sorcerer:font-of-magic',
  'wizard:arcane-recovery',
];

/** A pool grant with only the fields that say how big it is and when it refills. */
const barePool = (id: string, automation: 'engine' | 'manual' = 'engine') =>
  ({
    id,
    name: id,
    level: 2,
    automation,
    note: 'a note',
    grants: { kind: 'pool', key: id, label: id, uses: 2, recovers: 'long-rest' },
  }) as unknown as FeatureDefinition;

describe('a pool with nothing to buy is a shape, so it is derived', () => {
  /**
   * The predicate, driven over a grant it must catch and one it must not.
   * A derived population that could only be run against the data it already
   * agrees with would not be a derivation.
   */
  it('reads a pool that says nothing about what a use buys as bare', () => {
    expect(isBarePool(barePool('synthetic:pool'))).toBe(true);
  });

  it('reads a pool that says what a use buys as not bare', () => {
    for (const member of POOL_SPENDING_MEMBERS) {
      const bought = {
        ...barePool('synthetic:pool'),
        grants: {
          ...(barePool('synthetic:pool') as { grants: object }).grants,
          [member]: [],
        },
      } as unknown as FeatureDefinition;
      expect(isBarePool(bought), member).toBe(false);
    }
  });

  it('reads a feature that grants something other than a pool as not bare', () => {
    const style = {
      id: 'synthetic:style',
      name: 'synthetic',
      level: 1,
      automation: 'engine',
      note: 'a note',
      grants: { kind: 'extra-attack', attacks: 2 },
    } as unknown as FeatureDefinition;
    expect(isBarePool(style)).toBe(false);
  });

  it('reads a feature that grants nothing at all as not bare', () => {
    const nothing = {
      id: 'synthetic:nothing',
      name: 'synthetic',
      level: 1,
      automation: 'engine',
      note: 'a note',
    } as unknown as FeatureDefinition;
    expect(isBarePool(nothing)).toBe(false);
  });

  /**
   * And over the catalogue it finds exactly the four the audit found by hand.
   * Pinned by name rather than by size: a fifth would be a real finding and
   * has to be adjudicated here rather than quietly joining a count.
   */
  it('finds the four pools the catalogue really holds', () => {
    expect(barePoolFeatureIds()).toEqual([
      'druid:wild-shape',
      'paladin:channel-divinity',
      'sorcerer:font-of-magic',
      'wizard:arcane-recovery',
    ]);
  });

  /** None of them is manual, or the first population would already hold it. */
  it('names nothing the manual population already holds', () => {
    const manual = new Set(manualFeatureIds());
    for (const id of barePoolFeatureIds()) expect(manual.has(id), id).toBe(false);
  });
});

/**
 * The other arm, and why it is a list rather than a query.
 *
 * Monk's Focus Points buy Flurry of Blows, which the engine executes. They
 * also buy Patient Defense and Step of the Wind, which it does not — and
 * *nothing in the catalogue knows the book prints three*. A grant says what it
 * offers and never what it left out, so the only derivation available would be
 * a regex over the note, which over 194 engine features catches 22 and would
 * demand an adjudication for each. The declaration is held to the note instead:
 * every id here is an engine pool, is **not** bare (a bare one is derived and a
 * second spelling would be a second place to get it wrong), and carries an
 * entry whose clauses anchor in its own note.
 */
describe('a pool that buys some of what its page prints is declared', () => {
  it('is these, and no others', () => {
    expect(POOLS_ONLY_PARTLY_BOUGHT).toEqual(['monk:focus']);
  });

  it('declares nothing the bare-pool derivation already finds', () => {
    const bare = new Set(barePoolFeatureIds());
    for (const id of POOLS_ONLY_PARTLY_BOUGHT) expect(bare.has(id), id).toBe(false);
  });

  it('declares nothing the manual population already holds', () => {
    const manual = new Set(manualFeatureIds());
    for (const id of POOLS_ONLY_PARTLY_BOUGHT) expect(manual.has(id), id).toBe(false);
  });

  /** A declaration nobody can check against the corpus is a licence. */
  it('names a feature this catalogue really declares, with a pool', () => {
    for (const id of POOLS_ONLY_PARTLY_BOUGHT) {
      const entry = FEATURE_BLOCKED_ON[id];
      expect(entry, id).toBeDefined();
      expect(unanchoredFeatureClauses(id, entry ?? []), id).toEqual([]);
    }
  });
});

describe('the ledger population is the three arms together', () => {
  it('is the union, sorted, with nothing named twice', () => {
    const ids = ledgerFeatureIds();
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      [...new Set([...manualFeatureIds(), ...barePoolFeatureIds(), ...POOLS_ONLY_PARTLY_BOUGHT])].sort(),
    );
  });

  it('holds the five the map could not see', () => {
    for (const id of WIDENED) expect(ledgerFeatureIds(), id).toContain(id);
  });

  /**
   * The completeness guard now reads the wider population, which is the whole
   * point: an entry for an `engine` feature used to be `stale`, so the five
   * could not have been written even if somebody had adjudicated them.
   */
  it('wants a line for every member of it and reports none missing', () => {
    expect(featureCoverageGaps()).toEqual({ unrecorded: [], stale: [] });
  });

  it('reports a pool nobody adjudicated', () => {
    expect(featureCoverageGaps([...ledgerFeatureIds(), 'druid:a-pool-nobody-read']).unrecorded).toEqual(
      ['druid:a-pool-nobody-read'],
    );
  });
});

/**
 * What each of the five waits on, pinned by name.
 *
 * A builder who thinks one of these is cheaper than it reads has to come here
 * and say so. Three of them are the same gap in the `trade` grant, which is
 * the finding this widening produced: the shape's own description already
 * said "a slot a class table never printed is refused rather than given", and
 * until now the only thing claiming it was a manual feature.
 */
describe('what the five wait on', () => {
  it('files Wild Shape under the swap and the span it prints', () => {
    expect(featureBlockersOf('druid:wild-shape')).toEqual([
      'a-benefit-that-runs-for-a-printed-span',
      'a-creature-swapped-for-another-stat-block',
    ]);
  });

  it('files the three slot-minting pools under one trade gap', () => {
    for (const id of ['sorcerer:font-of-magic', 'wizard:arcane-recovery', 'monk:focus']) {
      expect(featureBlockersOf(id), id).toContain('a-resource-traded-for-another');
    }
  });

  it('files a Paladin’s Channel Divinity under the fact Divine Sense writes', () => {
    expect(featureBlockersOf('paladin:channel-divinity')).toEqual([
      'a-declared-fact-a-feature-sets',
    ]);
  });

  /** Every clause of the five says something, as every other clause must. */
  it('writes a real note against every new clause', () => {
    for (const id of WIDENED) {
      for (const clause of featureClausesIn(FEATURE_BLOCKED_ON[id] ?? [])) {
        expect(clause.note.length, `${id}: ${clause.clause}`).toBeGreaterThan(20);
      }
    }
  });
});
