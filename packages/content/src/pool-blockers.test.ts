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
import { SRD_CONTENT } from '@ie/content';
import type { FeatureDefinition } from '@ie/engine';
import {
  FEATS_ANSWERED_FOR,
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

/**
 * The five the owner's ruling of 2026-09-21 named, less the four that were
 * built: Font of Magic and Arcane Recovery are `trade` grants now, Wild Shape
 * is a `shape-shift` grant, and Monk's Focus buys all three thirds of its page
 * — so the derivation below no longer finds any of them and their blocked-on
 * lines are gone.
 */
const WIDENED = ['paladin:channel-divinity'];

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
   * And over the catalogue it finds exactly what is still bare. Pinned by name
   * rather than by size: a new one would be a real finding and has to be
   * adjudicated here rather than quietly joining a count.
   *
   * **It found four and finds one**, which is the derivation doing its job:
   * Font of Magic and Arcane Recovery were built as `trade` grants and Wild
   * Shape as a `shape-shift` grant, and neither is a bare `pool`, so all three
   * left this list without anybody editing it. The lines they held in the
   * blocked-on map were hand work, and the coverage guard named each `stale`
   * until that hand work was done.
   */
  it('finds the pools the catalogue really holds', () => {
    expect(barePoolFeatureIds()).toEqual(['paladin:channel-divinity']);
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
  it('is empty, and the arm that would hold one stays', () => {
    expect(POOLS_ONLY_PARTLY_BOUGHT).toEqual([]);
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

describe('the ledger population is the four arms together', () => {
  /**
   * **A fourth arm since gate G1**, and it is the one that had no population
   * at all: `allFeatures` walks classes, subclasses, species and backgrounds
   * and never `SRD_CONTENT.feats`, so sixteen feats were in no map, no ledger
   * row and no guard. A `FeatDefinition` has no `automation` flag to select
   * on, so `FEATS_ANSWERED_FOR` is declared the way
   * `POOLS_ONLY_PARTLY_BOUGHT` is and held down the same way.
   */
  it('is the union, sorted, with nothing named twice', () => {
    const ids = ledgerFeatureIds();
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      [
        ...new Set([
          ...manualFeatureIds(),
          ...barePoolFeatureIds(),
          ...POOLS_ONLY_PARTLY_BOUGHT,
          ...FEATS_ANSWERED_FOR,
        ]),
      ].sort(),
    );
  });

  /**
   * **The two id spaces are disjoint**, which `featureNoteOf` now depends on.
   *
   * It merges the feats into one map keyed on bare ids so a clause about a
   * feat can anchor in that feat's note. Today every feature id is
   * colon-namespaced and no feat is, so nothing can collide — but if one ever
   * did, the later entry would silently win and a clause would be anchored
   * against the wrong document with every other guard still green. That is a
   * quiet failure, so it is asserted rather than left to the naming
   * convention.
   */
  it('keeps the feature and feat id spaces apart', () => {
    const features = new Set([
      ...SRD_CONTENT.classes.flatMap((one) => one.features),
      ...SRD_CONTENT.subclasses.flatMap((one) => one.features),
      ...SRD_CONTENT.species.flatMap((one) => one.features),
      ...SRD_CONTENT.backgrounds.flatMap((one) => one.features),
    ].map((one) => one.id));
    for (const feat of SRD_CONTENT.feats) {
      expect(features.has(feat.id), `${feat.id} is a feature id as well as a feat id`).toBe(false);
    }
  });

  /**
   * The feats arm, held down at both ends: each id is a feat the catalogue
   * really holds, in a level 1–5 character's reach, whose clauses anchor in
   * its own note — and the complement is pinned by name, so a feat joining
   * or leaving is somebody's reading rather than a silent drift.
   */
  it('answers for no feat at all, and holds the machinery that would', () => {
    expect([...FEATS_ANSWERED_FOR]).toEqual([...FEATS_ANSWERED_FOR].sort());
    const feats = new Map(SRD_CONTENT.feats.map((one) => [one.id, one]));
    for (const id of FEATS_ANSWERED_FOR) {
      const feat = feats.get(id);
      expect(feat, `${id} is not a feat of this catalogue`).toBeDefined();
      expect(feat!.minimumLevel ?? 1).toBeLessThanOrEqual(5);
      const entry = FEATURE_BLOCKED_ON[id];
      expect(entry, id).toBeDefined();
      expect(unanchoredFeatureClauses(id, entry ?? []), id).toEqual([]);
    }
    // And the nine in reach this list does **not** answer for, by name. Each
    // says in its own note that the whole of the feat is applied — Defense
    // most recently, which left this list when `wearing-armor` gave the
    // clause the +1 to Armour Class was gated on somewhere to be written.
    const inReach = SRD_CONTENT.feats
      .filter((one) => (one.minimumLevel ?? 1) <= 5)
      .map((one) => one.id)
      .filter((id) => !FEATS_ANSWERED_FOR.includes(id))
      .sort();
    expect(inReach).toEqual([
      'ability-score-improvement',
      'alert',
      'archery',
      'defense',
      'great-weapon-fighting',
      'magic-initiate',
      'savage-attacker',
      'skilled',
      'two-weapon-fighting',
    ]);
  });

  it('holds the ones the map could not see', () => {
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
 * What each of the remaining ones waits on, pinned by name.
 *
 * A builder who thinks one of these is cheaper than it reads has to come here
 * and say so. Three of them were the same gap in the `trade` grant, which is
 * the finding this widening produced; two of those three are built, and what
 * is left of the gap is Monk's Focus buying an action rule — a price on an
 * allowance, which is neither a pool nor a slot at either end.
 */
describe('what the rest wait on', () => {
  /**
   * Wild Shape was filed here under the swap and the span it prints, and is
   * built: a `shape-shift` grant, `assumeShape`, and a form the fold takes off
   * again. Off the map in both directions, like the two trades before it.
   */
  it('no longer files Wild Shape at all', () => {
    expect(featureBlockersOf('druid:wild-shape')).toEqual([]);
    expect(ledgerFeatureIds()).not.toContain('druid:wild-shape');
  });

  it('files what is left of the trade gap outside a level 5 party’s reach', () => {
    // Monk's Focus was the pool that carried it and no longer does: an
    // allowance takes a price now and one spend buys two actions, so Patient
    // Defense and Step of the Wind are executed. Cunning Strike was the last
    // of it inside a level 5 party's reach and no longer is either: a hit
    // rider prices itself in a sibling feature's damage dice, which are
    // neither a pool nor a slot. What is left of the gap is a mode forgone,
    // a Wild Shape use converted into a slot the table never printed, and
    // three Focus Points spent at once — none of them in that reach.
    expect(featureBlockersOf('rogue:cunning-strike')).toEqual([]);
    expect(ledgerFeatureIds()).not.toContain('rogue:cunning-strike');
    expect(featureBlockersOf('barbarian:brutal-strike')).toContain(
      'a-resource-traded-for-another',
    );
    expect(featureBlockersOf('monk:focus')).toEqual([]);
    // And the three that were built are off the map entirely, in both
    // directions: no blockers, and nothing claiming they have any.
    for (const id of ['sorcerer:font-of-magic', 'wizard:arcane-recovery', 'monk:focus']) {
      expect(featureBlockersOf(id), id).toEqual([]);
      expect(ledgerFeatureIds(), id).not.toContain(id);
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
