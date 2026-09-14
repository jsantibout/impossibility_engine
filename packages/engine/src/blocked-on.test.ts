import { describe, expect, it } from 'vitest';
import {
  ADJUDICATED,
  BLOCKED_ON,
  MISSING_SHAPES,
  SPLIT_BUNDLES,
  TRACKED_ADJUDICATED,
  allShapeConsumers,
  claimedShapes,
  consumersOf,
  coverageGaps,
  parsedSpellIds,
  DEFINED_SPELL_IDS,
  type ShapeId,
} from '../scripts/missing-shapes.js';

/**
 * The undefined population's blockers, asserted the way the executed one's are.
 *
 * `PARTIAL_SPELLS` stopped being a hand list when IE-004 made it a consequence
 * of the adjudication map. `BLOCKED_ON` is the other half: the spells the
 * engine has **no definition for at all**, each read against its own SRD
 * paragraph, so that a shape's consumer count is a query rather than a number
 * in prose that nothing regenerates.
 *
 * The failure this exists to end has happened three times on one family: 17
 * open spells in `PROGRESS.md`, 4 in the leverage audit, 2 whole and 1 partial
 * in the SRD text. None was derived.
 */

const PARSED = parsedSpellIds();

describe('the blocked-on map covers the undefined population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * A guard that can only be run against the data it already agrees with is
   * not a guard, so `coverageGaps` is parameterised over both lists and driven
   * here with a synthetic catalogue containing a spell nobody has read. This
   * is the shape `spell-tracking.test.ts` uses for its markers and
   * `invariants.test.ts` for its sweeps: prove the analysis bites on a case
   * built to be caught, then run it on the real thing.
   */
  it('reports a spell added to the catalogue with neither an entry nor a definition', () => {
    const synthetic = [...PARSED, 'hurl-through-hell'];
    const gaps = coverageGaps(synthetic, DEFINED_SPELL_IDS);
    expect(gaps.unrecorded).toEqual(['hurl-through-hell']);
  });

  /** And the other direction: an entry for a spell that is no longer undefined. */
  it('reports an entry for a spell that has since been defined', () => {
    // The case this guard has already caught for real, three times: IE-014
    // defined Lesser Restoration and Protection from Poison, IE-017 Stoneskin
    // and Protection from Energy. The synthetic stands in for the next one.
    const defined = new Set([...DEFINED_SPELL_IDS, 'magic-missile']);
    expect(coverageGaps(PARSED, defined).stale).toEqual(['magic-missile']);
  });

  /** Neither synthetic case is vacuous: the real catalogue has no gap either way. */
  it('has an entry for every undefined spell and no entry for anything else', () => {
    expect(coverageGaps(PARSED, DEFINED_SPELL_IDS)).toEqual({ unrecorded: [], stale: [] });
  });

  /** And the population is the size the audit measured, not something smaller. */
  it('covers a population worth deriving', () => {
    expect(Object.keys(BLOCKED_ON).length).toBeGreaterThan(200);
  });

  it('names only shapes the vocabulary has', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, shapes] of Object.entries(BLOCKED_ON)) {
      for (const shape of shapes) {
        expect(known.has(shape), `${spellId} names ${shape}`).toBe(true);
      }
    }
  });

  /** In an order two branches can both append to, like every other list here. */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(BLOCKED_ON);
    expect(ids).toEqual([...ids].sort());
    for (const [spellId, shapes] of Object.entries(BLOCKED_ON)) {
      expect([...shapes], spellId).toEqual([...shapes].sort());
      expect(new Set(shapes).size, `${spellId} repeats a shape`).toBe(shapes.length);
    }
  });

  /**
   * An empty list is an answer, and it is pinned by **name**.
   *
   * "Blocked on nothing the engine owns" means the spell could be taken today,
   * tracked at least — the most interesting thing the map says, and the one
   * claim `CLAUDE.md` restates. A bound on the *size* is what a docstring
   * would carry and is exactly the kind of number this file exists to stop
   * trusting, so the set is written out: a spell joining or leaving it is a
   * reading somebody changed, and it should have to say so here.
   *
   * Light, obscurement and a fiction trigger are why most of them are here.
   * All three are clauses `spell-honesty.test.ts`'s marker list already leaves
   * alone by name, so calling them fiction is the line this repository already
   * draws rather than a new one.
   *
   * **A spell that offers a choice of branches is here only while every branch
   * is fiction.** Druidcraft and Elementalism each pick one of four or five
   * effects and not one of them is arithmetic, so the choice decides nothing
   * the engine would have to record. Thaumaturgy prints the same shape and one
   * of its six branches grants Advantage on Charisma (Intimidation) checks —
   * which `roll-modifiers.ts` expresses exactly — so its choice does decide
   * something, and it is *not* here. That is the whole of the difference, and
   * it was worth getting wrong once to write down.
   */
  it('records a spell blocked on nothing rather than omitting it', () => {
    const free = Object.entries(BLOCKED_ON)
      .filter(([, shapes]) => shapes.length === 0)
      .map(([id]) => id);
    expect(free).toEqual([
      'conjure-fey',
      'create-or-destroy-water',
      'dancing-lights',
      'darkness',
      'daylight',
      'druidcraft',
      'elementalism',
      'fog-cloud',
      'programmed-illusion',
      'purify-food-and-drink',
      'zone-of-truth',
    ]);
  });

  /**
   * The one spell in the book whose **range** grows with the caster.
   *
   * `SpellDefinition.range` is one fixed `SpellRange` and `ranged()` is checked
   * on every casting before a target is looked at, so a defined Spare the Dying
   * would refuse the level 5 cleric the SRD lets stabilise an ally at thirty
   * feet. The engine's path arrives and answers wrongly, which is this map's
   * own definition of debt rather than fiction — and it is the only spell that
   * prints the clause, which is exactly when a one-consumer shape is cheap to
   * name and impossible to reconstruct later.
   */
  it('files the one spell whose range scales with the caster', () => {
    expect(consumersOf('a-range-that-scales-with-caster-level').blocks).toEqual([
      'spare-the-dying',
    ]);
    expect(BLOCKED_ON['spare-the-dying']).toEqual([
      'a-range-that-scales-with-caster-level',
      'an-effect-that-stabilises-a-dying-creature',
    ]);
  });
});

describe('a shape says where this repository already described it', () => {
  /**
   * The rule that keeps the vocabulary from becoming a private language — the
   * one `spell-honesty.test.ts` introduced, now asked of the whole map.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = ['claude.md', 'progress.md', 'the audit', 'spell-definitions.ts'];
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      expect(description.length, shape).toBeGreaterThan(120);
    }
  });

  /**
   * No shape may sit in the vocabulary unclaimed — now over all three
   * populations, which is the whole reason the three maps share one list.
   *
   * Asked of one population it deletes every shape only the others name. IE-010
   * is the precedent for what happens when a shape genuinely empties: it
   * removed `outcome-scoped-child-effects` rather than renaming it, because
   * re-filing its last claimant left a shape nothing was blocked on.
   */
  it('keeps no shape nothing is blocked on', () => {
    const claimed = claimedShapes();
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape the vocabulary has dropped. */
  it('has a vocabulary that covers every claim', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    expect([...claimedShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });
});

describe('the split bundles add back up', () => {
  /**
   * The evidence that splitting three bundle ids preserved the facts.
   *
   * The audit's complaint was arithmetic — "every per-shape count derived from
   * that map inherits the bundle" — so the repair is checked as arithmetic.
   * Each recorded `[spellId, clause, wentTo]` triple must still be an
   * adjudication filed exactly where the split put it.
   *
   * **Unless the shape it went to has since been built**, which is the one
   * honest reason a clause may leave the map: IE-019 built
   * `an-outcome-that-varies-by-creature-type` and executed Shatter with it, so
   * that clause is gone. A clause that vanished while its shape still stands
   * is a silent loss and fails here, which is what makes the exception a
   * branch rather than a hole.
   */
  it.each(Object.keys(SPLIT_BUNDLES))('accounts for every adjudication %s held', (bundle) => {
    const split = SPLIT_BUNDLES[bundle]!;
    const live = new Set<string>(Object.keys(MISSING_SHAPES));
    const landed = new Map<string, number>();

    for (const [spellId, clause, wentTo] of split.held) {
      const entry = (ADJUDICATED[spellId] ?? []).find((e) => e.clause === clause);
      if (entry === undefined) {
        expect(
          live.has(wentTo),
          `${spellId}: "${clause}" left the map while ${wentTo} is still missing`,
        ).toBe(false);
      } else {
        expect(entry.why, `${spellId}/${clause}`).toBe(wentTo);
      }
      landed.set(wentTo, (landed.get(wentTo) ?? 0) + 1);
    }

    // The counts sum to what the bundle claimed, over the spells it claimed.
    expect([...landed.values()].reduce((a, b) => a + b, 0)).toBe(split.adjudications);
    expect(split.held).toHaveLength(split.adjudications);
    expect(new Set(split.held.map(([id]) => id)).size).toBe(split.spells);
    // And the split really is a split: more than one destination, every one of
    // them either a live shape or one that has since been built.
    expect(new Set(split.held.map(([, , wentTo]) => wentTo)).size).toBeGreaterThan(1);
  });

  /** And the bundle id itself is gone from every map, not merely unused. */
  it.each(Object.keys(SPLIT_BUNDLES))('no longer files anything to %s', (bundle) => {
    if (Object.keys(MISSING_SHAPES).includes(bundle)) {
      // `a-mode-on-the-save-a-spell-forces` kept its id and lost five of its
      // six claimants: the audit found its *description* misstated its own
      // blocker, not that the mechanism was imaginary. What must be true is
      // that nothing it used to hold wrongly is still filed to it.
      const held = new Set(
        SPLIT_BUNDLES[bundle]!.held.map(([id, clause]) => `${id}/${clause}`),
      );
      for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
        for (const entry of entries) {
          if (entry.why !== bundle) continue;
          expect(held.has(`${spellId}/${entry.clause}`)).toBe(false);
        }
      }
      return;
    }
    expect(claimedShapes().has(bundle)).toBe(false);
  });

  /**
   * `outcome-scoped-child-effects` is IE-010's, and this file must not bring
   * it back. It removed the id when the rider vocabulary was built rather than
   * renaming it, because a shape nothing is blocked on is one the guard above
   * deletes.
   */
  it('does not resurrect the bundle IE-010 removed', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-scoped-child-effects');
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-riders');
    expect(Object.keys(SPLIT_BUNDLES)).not.toContain('outcome-scoped-child-effects');
  });
});

describe('a consumer count is a query', () => {
  /**
   * **The query predicted a build, and the build tested the query.**
   *
   * Before IE-017 existed this map said `a-defence-a-spell-grants` was the only
   * blocker for exactly two spells — Stoneskin and Mind Blank — reproducing
   * Fable's "2 whole, 1 partial" from data rather than quoting it. IE-017 then
   * built that shape, independently, and the result is the strongest evidence
   * this file has and the sharpest correction in it:
   *
   * | Predicted | What happened |
   * |---|---|
   * | Stoneskin finished | **defined and verified** — right |
   * | Mind Blank finished | still undefined — *wrong* |
   * | Protection from Energy partial | **defined and verified** — also wrong |
   *
   * Both misses are one mistake, and it is a bundle in this very vocabulary.
   * `a-defence-a-spell-grants` claimed condition Immunity was "the same storage
   * and the same sentence shape"; IE-017 built `CreatureState.defenses` and
   * touched `conditionApplicability` not at all, so Mind Blank's "Immunity to
   * Psychic damage **and the Charmed condition**" kept half a blocker. And the
   * damage type Protection from Energy chooses turned out to be expressible
   * already, once IE-017 gave `damageTypeStated` a second user.
   *
   * So the shape is retired, the condition half is its own id, and the lesson
   * is the audit's own in miniature: a count is only as good as the shape it
   * counts, and the way to find out is to build one.
   */
  it('retires the shape IE-017 built, and keeps the half it did not', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-defence-a-spell-grants');
    expect(claimedShapes().has('a-defence-a-spell-grants')).toBe(false);

    // The right half of the prediction: Stoneskin is defined, so it is out.
    expect(BLOCKED_ON['stoneskin']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-energy']).toBeUndefined();

    // The wrong half, and where it went.
    expect(BLOCKED_ON['mind-blank']).toEqual(['a-condition-immunity-a-spell-grants']);
    expect(consumersOf('a-condition-immunity-a-spell-grants').unblocks).toEqual(['mind-blank']);
  });

  /**
   * And a damage type chosen at the casting is no longer a blocker at all.
   *
   * `damageTypeStated` was written for Spirit Guardians, where the SRD decides
   * the type on a fact the engine does not hold, and its docstring said a
   * second user would be the evidence it should generalise. IE-017's
   * Protection from Energy is that user and chooses for the opposite reason,
   * so the field carries both — which takes six spells' worth of
   * `a-choice-made-at-the-casting` filings off the map.
   */
  it('no longer blocks a spell whose only choice is a damage type', () => {
    for (const id of [
      'chromatic-orb',
      'conjure-elemental',
      'dragons-breath',
      'resistance',
      'sorcerous-burst',
      'true-strike',
    ]) {
      expect(BLOCKED_ON[id], id).not.toContain('a-choice-made-at-the-casting');
    }
    // And still blocks one whose choice is anything else: an ability, a
    // condition, one of six wonders, which of five effects to remove.
    for (const id of ['hex', 'blindness-deafness', 'thaumaturgy', 'greater-restoration']) {
      const shapes = BLOCKED_ON[id] ?? ADJUDICATED[id]?.map((e) => e.why) ?? [];
      expect(shapes, id).toContain('a-choice-made-at-the-casting');
    }
  });

  /**
   * The whole "four Conjures" row, which is wrong about all six of them.
   *
   * `CLAUDE.md`'s "A stat block created mid-fight" row said "the four
   * Conjures". SRD 5.2.1 rewrote the family as *spirits* — a pack, a pillar
   * of light, an Emanation, a point you strike from — and not one of the six
   * prints an Armour Class, Hit Points or a turn. The brief said the SRD wins
   * where the prose disagrees; this is what keeps the correction from drifting
   * back, and it names spells the row *is* right about so the shape does not
   * lose its real consumers either.
   */
  it('files no Conjure spell under a stat block, and keeps the ones that print one', () => {
    const statBlock = consumersOf('a-stat-block-created-mid-fight');
    expect(statBlock.blocks.filter((id) => id.startsWith('conjure-'))).toEqual([]);
    for (const id of ['unseen-servant', 'arcane-hand', 'summon-dragon', 'giant-insect']) {
      expect(statBlock.undefined, id).toContain(id);
    }
    // Guardian of Faith and Faithful Hound are the pair that proves the row was
    // read rather than copied: both are invulnerable spectral things, and only
    // one of the two is a creature — neither, as it turns out.
    expect(BLOCKED_ON['faithful-hound']).not.toContain('a-stat-block-created-mid-fight');
    expect(BLOCKED_ON['guardian-of-faith']).not.toContain('a-stat-block-created-mid-fight');
  });

  /**
   * And the smallest number the ranked map printed, which comes out one higher.
   *
   * `PROGRESS.md` ranks "Reads the target's current Hit Points | 3" and names
   * the three Power Words. Aura of Life is a fourth — "If an ally with 0 Hit
   * Points starts its turn in the aura, that ally regains 1 Hit Point" — and it
   * is in the ranked map's own population. A three-spell family counted by hand
   * was still wrong, which is the argument for deriving even the small ones.
   */
  it('finds one more than the ranked map did for reading the target’s Hit Points', () => {
    expect(consumersOf('an-outcome-that-reads-the-targets-hit-points').blocks).toEqual([
      'aura-of-life',
      'divine-word',
      'power-word-kill',
      'power-word-stun',
    ]);
  });

  /** A shape both a definition and an undefined spell name is counted once each. */
  it('adds all three populations up', () => {
    const speed = consumersOf('speed-and-movement-modes');
    expect(speed.executed).toEqual(['hypnotic-pattern', 'ray-of-frost']);
    expect(speed.tracked).toEqual(['fly', 'longstrider', 'spider-climb']);
    expect(speed.undefined.length).toBeGreaterThan(5);
    expect(speed.blocks.length).toBe(
      speed.executed.length + speed.tracked.length + speed.undefined.length,
    );
  });

  /** `unblocks` is a subset of `blocks`, and of the undefined population. */
  it('never claims to unblock a spell it does not block', () => {
    for (const row of allShapeConsumers()) {
      for (const id of row.unblocks) {
        expect(row.undefined, row.shape).toContain(id);
        expect(BLOCKED_ON[id]).toEqual([row.shape]);
      }
    }
  });

  /** Every shape is reported, heaviest first, with no gaps or repeats. */
  it('reports every shape once, ranked', () => {
    const rows = allShapeConsumers();
    expect(rows.map((row) => row.shape).sort()).toEqual(Object.keys(MISSING_SHAPES).sort());
    for (let i = 1; i < rows.length; i += 1) {
      const before = rows[i - 1]!;
      const after = rows[i]!;
      expect(
        before.unblocks.length > after.unblocks.length ||
          (before.unblocks.length === after.unblocks.length &&
            (before.blocks.length > after.blocks.length ||
              (before.blocks.length === after.blocks.length &&
                before.shape.localeCompare(after.shape) < 0))),
        `${before.shape} before ${after.shape}`,
      ).toBe(true);
    }
  });

  /**
   * The single largest blocker in the undefined population, named rather than
   * felt: fifty-odd spells cannot be cast at all because the casting takes a
   * minute or more, which `resolveCast` refuses.
   */
  it('names the largest blocker in the undefined population', () => {
    const ranked = [...allShapeConsumers()].sort((a, b) => b.blocks.length - a.blocks.length);
    expect(ranked[0]!.shape).toBe('a-long-casting-time');
    expect(ranked[0]!.blocks.length).toBeGreaterThan(40);
  });
});

describe('a spell with one blocker is the leverage the map is for', () => {
  /**
   * Magic Missile is the spell that proves the second column is worth reading,
   * and it is **not** on the list below.
   *
   * "Damage with neither an attack roll nor a save" is the clause everybody
   * quotes it for, and `PROGRESS.md` ranks that shape at 19 open spells. But
   * the darts are *distributed* — "you can direct them to hit one creature or
   * several" — and a casting that names the same target twice is refused, so
   * three darts into one goblin cannot be said at all. That is the same gap
   * Mass Heal's "divided as you choose" has, and it is not downstream of the
   * first: you meet it in the same sentence rather than after the missing
   * mechanism is built.
   *
   * **The distinction is what keeps `unblocks` honest.** Dimension Door's 4d6
   * on a failed arrival is damage with no roll too, and it is *not* a second
   * blocker, because nothing teleports — the damage is unreachable until the
   * first shape exists. A blocker you would meet anyway counts; one you could
   * only meet afterwards does not.
   */
  it('does not call Magic Missile finished by one shape', () => {
    expect(BLOCKED_ON['magic-missile']).toEqual([
      'a-spells-effects-applied-to-different-targets',
      'damage-with-neither-an-attack-roll-nor-a-save',
    ]);
    expect(BLOCKED_ON['dimension-door']).toEqual(['teleportation']);
  });

  /**
   * Spot-checks, each transcribed from the spell's own SRD paragraph, because
   * a map that nothing reads back is the prose it replaced in another costume.
   */
  const SOLE: readonly (readonly [string, ShapeId])[] = [
    // "the target's skin assumes a bark-like appearance, and the target has an
    // Armor Class of 17 if its AC is lower than that" — a floor on the total.
    ['barkskin', 'an-armor-class-a-spell-floors'],
    // "you deal an extra 1d4 Radiant damage on a hit" with weapons.
    ['divine-favor', 'a-rider-on-a-later-weapon-attack'],
    // "restoring 70 Hit Points" — the conditions it ends are `end-condition`
    // now, and the printed 70 is the whole of what is left.
    ['heal', 'a-flat-amount-with-no-dice'],
    // "Make a ranged spell attack for each ray."
    ['scorching-ray', 'several-attack-rolls-from-one-casting'],
    // "You touch a creature that has died within the last minute."
    ['revivify', 'healing-that-raises-the-dead'],
    // "Choose up to five falling creatures within range."
    ['feather-fall', 'falling'],
    // "You teleport to a location within range."
    ['dimension-door', 'teleportation'],
    // "Immunity to Psychic damage **and the Charmed condition**" — the damage
    // half is built and the condition half is not, which is the whole of what
    // is left. Stoneskin stood here until IE-017 defined it.
    ['mind-blank', 'a-condition-immunity-a-spell-grants'],
  ];

  it.each(SOLE)('%s is blocked on %s and nothing else', (spellId, shape) => {
    expect(BLOCKED_ON[spellId]).toEqual([shape]);
  });
});

describe('a shape that gets built is content work, not a merge', () => {
  /**
   * IE-014 built condition removal as `end-condition`, and eleven entries here
   * named it. Re-reading them is the work a textual rebase would have skipped:
   * the shape ends up with **no** claimants and is retired, exactly as IE-010
   * retired `outcome-scoped-child-effects`.
   *
   * What `end-condition` takes is a list of `ConditionName`, so it finishes a
   * spell that ends a printed list and no more. The four readings below are the
   * ones worth pinning, because each is a different reason:
   */
  it('has retired the shape `end-condition` solved', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('condition-removal');
    expect(claimedShapes().has('condition-removal')).toBe(false);
  });

  // Heal ends "the Blinded, Deafened, and Poisoned conditions" — a printed
  // list, so the removal is done and the flat 70 is all that is left.
  it('finishes the removal half of Heal', () => {
    expect(BLOCKED_ON['heal']).toEqual(['a-flat-amount-with-no-dice']);
  });

  // Greater Restoration removes "one of the following", and one of them is
  // "1 Exhaustion level" — a level rather than a condition, which a list of
  // condition names cannot say.
  it('keeps what a list of condition names cannot remove', () => {
    expect(BLOCKED_ON['greater-restoration']).toContain('an-exhaustion-level-a-spell-changes');
    expect(BLOCKED_ON['greater-restoration']).toContain('a-choice-made-at-the-casting');
    expect(consumersOf('an-exhaustion-level-a-spell-changes').blocks).toEqual([
      'greater-restoration',
      'wish',
    ]);
  });

  // Calm Emotions *suppresses* a condition it did not cause and restores it
  // when the spell ends, which is the granted Immunity rather than a removal.
  it('reads suppression as the granted immunity it is', () => {
    expect(BLOCKED_ON['calm-emotions']).toEqual([
      'a-condition-immunity-a-spell-grants',
      'a-spells-effects-applied-to-different-targets',
    ]);
  });

  // And the two spells IE-014 defined leave the map entirely, with their debt
  // in ADJUDICATED where an executed spell's debt belongs.
  it('moves a newly defined spell out of the map and into the adjudications', () => {
    expect(BLOCKED_ON['lesser-restoration']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-poison']).toBeUndefined();
    expect(ADJUDICATED['lesser-restoration']?.map((e) => e.why)).toEqual([
      'a-choice-made-at-the-casting',
    ]);
    // IE-014 gave this two adjudications and IE-017 built one of them away, so
    // the Resistance clause is executed and only the condition-keyed save is
    // left. Two merges, one entry, and the map says which half survived.
    expect(ADJUDICATED['protection-from-poison']?.map((e) => e.why)).toEqual([
      'a-save-keyed-to-a-condition',
    ]);
  });
});

describe('the executed and tracked maps still cover their own populations', () => {
  /**
   * The move is a move. Both maps are keyed by spell id and the populations
   * they describe are unchanged, which is what makes the diff a relocation
   * rather than a rewrite.
   */
  it('adjudicates only executed spells and tracks only tracked ones', () => {
    const defined = new Set(DEFINED_SPELL_IDS);
    for (const id of Object.keys(ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(TRACKED_ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(BLOCKED_ON)) expect(defined.has(id), id).toBe(false);
  });
});
