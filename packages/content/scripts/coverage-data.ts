/**
 * What the engine actually does, measured against the SRD rather than recalled.
 *
 * Three states, kept apart on purpose, because conflating them is how a
 * project believes it is finished:
 *
 * | State | Means |
 * |---|---|
 * | **parsed** | `@ie/srd` has the record: id, level, school, class list, prose |
 * | **tracked** | the engine casts it — action, slot, Concentration, duration — and says what the DM does |
 * | **executed** | a `SpellDefinition` with effects the engine resolves: dice, saves, targets |
 * | **verified** | an integration test drives it end to end through `resolveSpell` |
 *
 * A catalogue entry is not an implementation, and neither is a refusal that
 * says the spell is unsupported. **Tracked and executed are not the same
 * claim** and are never added together: a tracked spell spends everything the
 * casting costs and leaves the effect to the table, which is the right answer
 * for Disguise Self and would be a lie about Fireball.
 *
 * **What shape a spell needs is not measured here, and used to be.** Thirteen
 * prose regexes filed every parsed spell under "the hardest thing its text
 * needs" and the report printed the buckets beside a hand-written blocker
 * column — which put two answers to one question in one file: the classifier
 * filed 43 spells under a casting time of a minute or more and called them
 * blocked on machinery IE-034 had built, while the derived table two sections
 * down counted 54 touched and 12 finished. That is the three-documents-three-
 * answers failure `missing-shapes.ts` was written to end, arriving inside one
 * report, and nothing asserted the classifier's output, which is both how it
 * drifted and why deleting it cost nothing. The shape question is a query over
 * that map now, and `COVERAGE.md`'s "What blocks the rest" is where it prints.
 *
 * Classes are measured the same way and the three states mean the same things,
 * with one difference worth stating: a class *feature* declares its own
 * automation, `engine` or `manual`, so the middle column is not inferred. A
 * manual feature is not a failure — several of them are judgement the engine
 * should never take from a DM — but a project that does not count them will
 * believe it has twelve working classes when it has twelve validated ones.
 *
 * **Species and backgrounds declare automation exactly as a class does**, and
 * were counted nowhere until they were, which is how a week of honest
 * transcription came to be invisible in the one file that holds this
 * project's numbers. `auditOrigins` reads them with the class column's own
 * predicate. Feats are not counted, because a `FeatDefinition` declares no
 * automation and there is nothing to read.
 *
 * **Magic items have two populations rather than one**, and the difference is
 * the whole of what `auditMagicItems` is careful about: the SRD writes
 * _Weapon, +1, +2, or +3_ once, as a template over the weapon table, and the
 * catalogue holds a record per version because an inventory holds a sword.
 * Entries transcribed and records held are different claims about different
 * things and are never divided by each other.
 *
 * **This module is the measurement; `coverage.ts` is the report.** The split is
 * not tidiness. The two claims live here because tests want them —
 * `coverage.test.ts` and `spell-honesty.test.ts` both hold this file's lists
 * against what the suite actually drives — and a module a test imports must do
 * nothing when it is imported. The renderer used to be the same module, and it
 * wrote `COVERAGE.md` at top level, so the suite regenerated the very file the
 * gauntlet then diffed: `git diff --exit-code COVERAGE.md` was asserting that
 * the suite had run rather than that the report was right. Nothing here has a
 * top-level effect, and `coverage-script.test.ts` holds the whole directory to
 * that.
 *
 * Run the report with `npm run coverage`.
 */

import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import { type FeatureDefinition, type SpellDefinition } from '@ie/engine';
import { ADJUDICATED } from './missing-shapes.js';
import {
  MAGIC_ITEM_CATEGORIES,
  entryFor,
  isCompleteItem,
  magicItemEntries,
} from './magic-items.js';

export interface ParsedSpell {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly classes: readonly string[];
  readonly castingTime: string;
  readonly ritual: boolean;
  readonly range: string;
  readonly duration: string;
  readonly concentration: boolean;
  readonly description: string;
  readonly higherLevel?: string;
}

/**
 * Executed spells that still carry an engine-owned clause nobody has built.
 *
 * **The third state, and it exists because two could not tell the truth.**
 * `verified` claims a spell is driven end to end; `untested` says nothing
 * drives it. Spirit Guardians was neither: its Emanation, its three trigger
 * clauses, its cap, its save and its damage all run under a suite of their
 * own, and the halved Speed inside the Emanation is a rule the engine owns and
 * has not written.
 *
 * **It is derived, and the copy it replaces existed only because the map lived
 * in a test file.** A spell is partial because one of its `unmodelled` clauses
 * is adjudicated to a named missing shape rather than to the table — a
 * consequence of the debts rather than of somebody's memory — and while those
 * adjudications were `spell-honesty.test.ts`'s, a report generator that
 * imported the test suite would have had the dependency backwards, so the
 * consequence was written out here and asserted against the derivation in both
 * directions. IE-015 moved the map to `missing-shapes.ts`, which is not a test
 * file for the reason this is not: `npm run coverage` runs outside vitest. With
 * the map on this side of that line the reason to keep a copy is gone, and the
 * assertion that held the two in step goes with it — a second spelling of one
 * derivation is the second place to get it wrong rather than a guard against
 * the first.
 *
 * **It came out equal to the hand list it replaced, entry for entry**, which is
 * what says this was a deletion and not a measurement.
 *
 * **Partial and verified are different axes.** Web is driven end to end *and*
 * leaves its Difficult Terrain unbuilt, and saying only the first would be the
 * green tick this state was invented to prevent.
 *
 * A spell derived into this list **must** say in `unmodelled` what it is
 * missing, which `coverage.test.ts` asserts — otherwise this becomes the place
 * claims come to be quietly parked.
 *
 * Sorted, because the map it reads is one two branches both append to.
 */
export const PARTIAL_SPELLS: readonly string[] = Object.entries(ADJUDICATED)
  .filter(([, entries]) => entries.some((entry) => entry.why !== 'table'))
  .map(([spellId]) => spellId)
  .sort();

/**
 * Spells an integration test drives end to end.
 *
 * **This one stays written out, and the asymmetry with `PARTIAL_SPELLS` above
 * is the point rather than an oversight.** Partial is a consequence of the
 * adjudication map, so it can be derived from it; *verified* is a claim about
 * which tests drive which spell, and nothing in the engine, the catalogue or
 * that map says so. There is no second place this could be read from, which is
 * exactly why it is here: a generated claim about test coverage that nothing
 * checks would be the failure this file exists to prevent.
 *
 * `coverage.test.ts` checks what can be checked — every entry is a spell the
 * catalogue can execute, named once, in an order two branches can both append
 * to. That a test really drives it is the reviewer's, because no derivation can
 * say so; the entry belongs in the commit that writes the test.
 */
export const VERIFIED_SPELLS: readonly string[] = [
  'acid-splash',
  'animal-friendship',
  'arcane-sword',
  'bane',
  'banishment',
  'beacon-of-hope',
  'black-tentacles',
  'bless',
  'blight',
  'blindness-deafness',
  'blur',
  'burning-hands',
  'charm-monster',
  'charm-person',
  'chill-touch',
  'chromatic-orb',
  'circle-of-death',
  'compulsion',
  'cone-of-cold',
  'conjure-fey',
  'counterspell',
  'cure-wounds',
  'dimension-door',
  'dispel-magic',
  'dissonant-whispers',
  'divine-favor',
  'divine-smite',
  'eldritch-blast',
  'false-life',
  'fear',
  'finger-of-death',
  'fire-bolt',
  'fire-shield',
  'fireball',
  'flame-blade',
  'flame-strike',
  'grease',
  'greater-invisibility',
  'guidance',
  'guiding-bolt',
  'harm',
  'healing-word',
  'heroism',
  'hideous-laughter',
  'hold-monster',
  'hold-person',
  'hunters-mark',
  'hypnotic-pattern',
  'ice-storm',
  'inflict-wounds',
  'insect-plague',
  'invisibility',
  'lesser-restoration',
  'lightning-bolt',
  'longstrider',
  'mage-armor',
  'mass-cure-wounds',
  'mind-blank',
  'mind-spike',
  'misty-step',
  'moonbeam',
  'poison-spray',
  'produce-flame',
  'protection-from-energy',
  'protection-from-poison',
  'ray-of-frost',
  'ray-of-sickness',
  'sacred-flame',
  'shatter',
  'shocking-grasp',
  // Driven end to end by `carrier-areas.test.ts`, and partial as well: the two
  // are different axes, and while they were one state this spell could only be
  // recorded as the second. Saying "untested" of a spell with its own suite
  // would be the same report telling a different lie.
  'sorcerous-burst',
  'spirit-guardians',
  'spiritual-weapon',
  // Driven end to end in `area-triggers.test.ts`: conjured at a point, a
  // creature starting its turn in the Sphere, the Constitution save rolled at
  // the boundary, the Poisoned landing, and the condition gone when that same
  // turn ends. Partial as well as verified, which is the pair Spirit Guardians
  // above already records — the gas runs and the sentence after it does not.
  'stinking-cloud',
  'stoneskin',
  'sunburst',
  'thunderwave',
  'vampiric-touch',
  'vicious-mockery',
  'vitriolic-sphere',
  'web',
];

export interface SpellCoverage {
  readonly total: number;
  /** Definitions whose effects the engine resolves. */
  readonly executed: number;
  /** Definitions the engine casts but whose effect is the DM's. */
  readonly tracked: number;
  /** Executed definitions carrying a clause adjudicated to a missing shape. */
  readonly partial: number;
  readonly verified: number;
  readonly spells: readonly ParsedSpell[];
}

/**
 * A definition the engine resolves nothing of is tracked; one it resolves
 * something of is executed.
 *
 * "Something" is the spell's own effects **or its activation or its area
 * trigger**: Flame Blade evokes a blade and does nothing else at the moment of
 * casting, and every blow it ever strikes is machinery the engine owns.
 * Counting it as tracked would understate the engine in exactly the direction
 * this file exists to prevent.
 *
 * **Exported because three other places had written it out**, and one of the
 * copies had already lost the `areaTrigger` arm. The honesty guard's whole
 * population is this predicate, so a drifting copy would silently stop
 * covering Web, Grease and Insect Plague with nothing going red.
 */
export const isExecuted = (definition: SpellDefinition): boolean =>
  definition.effects.length > 0 ||
  definition.activation !== undefined ||
  definition.areaTrigger !== undefined;

/** Every definition the engine resolves something of, by id. */
export const EXECUTED_SPELL_IDS: ReadonlySet<string> = new Set(
  SPELL_DEFINITIONS.filter(isExecuted).map((d) => d.id),
);

export const TRACKED_IDS: ReadonlySet<string> = new Set(
  SPELL_DEFINITIONS.filter((d) => !isExecuted(d)).map((d) => d.id),
);

export function auditSpells(): SpellCoverage {
  const spells = JSON.parse(
    readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
  ) as ParsedSpell[];
  const defined = new Set(SPELL_DEFINITIONS.map((d) => d.id));

  return {
    total: spells.length,
    executed: defined.size - TRACKED_IDS.size,
    tracked: TRACKED_IDS.size,
    partial: PARTIAL_SPELLS.length,
    verified: VERIFIED_SPELLS.length,
    spells,
  };
}

/**
 * A feature the engine applies, rather than one it records and hands to a DM.
 *
 * **A feature declares its own automation**, which is why this column is read
 * rather than inferred the way a spell's is. It is one line, and it is
 * exported for the reason `isExecuted` above is: the class table, the origins
 * table and the guard that holds them honest must ask one question. A species
 * trait and a class feature are the same `FeatureDefinition` and the same
 * claim is being made about both, so a second spelling of this would be a
 * second answer to one question — the failure this file keeps a record of.
 */
export const isExecutedFeature = (feature: FeatureDefinition): boolean =>
  feature.automation === 'engine';

export interface ClassCoverage {
  readonly classes: number;
  readonly subclasses: number;
  readonly features: number;
  readonly executed: number;
  readonly rows: readonly {
    readonly name: string;
    readonly style: string;
    readonly features: number;
    readonly executed: number;
  }[];
}

export function auditClasses(): ClassCoverage {
  const rows = SRD_CONTENT.classes.map((definition) => {
    const own = [
      ...definition.features,
      ...SRD_CONTENT.subclasses
        .filter((s) => s.classId === definition.id)
        .flatMap((s) => s.features),
    ];
    return {
      name: definition.name,
      style: definition.spellcasting?.style ?? 'none',
      features: own.length,
      executed: own.filter(isExecutedFeature).length,
    };
  });

  return {
    classes: SRD_CONTENT.classes.length,
    subclasses: SRD_CONTENT.subclasses.length,
    features: rows.reduce((sum, r) => sum + r.features, 0),
    executed: rows.reduce((sum, r) => sum + r.executed, 0),
    rows,
  };
}

export interface OriginCoverage {
  readonly species: number;
  readonly backgrounds: number;
  readonly features: number;
  readonly executed: number;
  readonly rows: readonly {
    readonly name: string;
    readonly kind: 'species' | 'background';
    readonly features: number;
    readonly executed: number;
  }[];
}

/**
 * Species and backgrounds, measured exactly as classes are.
 *
 * **They were transcribed honestly and counted nowhere.** Every trait the
 * engine cannot execute is marked `manual` and carries a note saying what a DM
 * is left holding — the standard the class corpus set — and `auditClasses`
 * audits classes, so the whole of that work was invisible in the report. A
 * population that is not counted is a population a reader concludes does not
 * exist.
 *
 * **A separate audit rather than extra rows in the class table**, because the
 * class table's totals answer "how much of a class does the engine run". A
 * species is not a class, it has no casting style and no subclasses, and
 * folding its traits into that total would change what the existing numbers
 * mean without changing their names. Same predicate, different denominator,
 * so: same column, different table.
 *
 * Feats are **not** here. A `FeatDefinition` declares no automation — it
 * carries a note about what a DM applies and nothing the engine reads — so
 * there is no predicate to read one with, and a count of executed feats would
 * be somebody's opinion in a column that claims to be derived. The report says
 * so in prose instead.
 */
export function auditOrigins(): OriginCoverage {
  const row = (
    kind: 'species' | 'background',
    definition: { readonly name: string; readonly features: readonly FeatureDefinition[] },
  ) => ({
    name: definition.name,
    kind,
    features: definition.features.length,
    executed: definition.features.filter(isExecutedFeature).length,
  });

  const rows = [
    ...SRD_CONTENT.species.map((one) => row('species', one)),
    ...SRD_CONTENT.backgrounds.map((one) => row('background', one)),
  ];

  return {
    species: SRD_CONTENT.species.length,
    backgrounds: SRD_CONTENT.backgrounds.length,
    features: rows.reduce((sum, r) => sum + r.features, 0),
    executed: rows.reduce((sum, r) => sum + r.executed, 0),
    rows,
  };
}

export interface MagicItemCoverage {
  /** Entries `@ie/srd` reads out of "Magic Items A–Z". */
  readonly parsed: number;
  /** Entries at least one catalogue record was read from. */
  readonly transcribed: number;
  /** Catalogue records those entries expand to. */
  readonly instances: number;
  /** Records carrying no `unmodelled` note. */
  readonly complete: number;
  /** Records carrying at least one, in the book's own words. */
  readonly partial: number;
  readonly rows: readonly {
    readonly category: string;
    readonly parsed: number;
    readonly transcribed: number;
    readonly instances: number;
    readonly complete: number;
    readonly partial: number;
  }[];
  readonly entries: readonly {
    readonly name: string;
    readonly category: string;
    readonly instances: number;
    readonly partial: number;
  }[];
}

/**
 * Magic items, in the two populations they actually have.
 *
 * **One entry is not one item.** The SRD writes _Weapon, +1, +2, or +3_ once,
 * as a template over the weapon table, and an inventory holds a +2 Longsword
 * rather than a template — so four entries become most of the catalogue's
 * magic items. `transcribed / parsed` and `instances` are therefore different
 * claims about different things, kept apart here for the same reason tracked
 * and executed are kept apart above: added together, or divided by each other,
 * they would report the Weapons chapter as covered several times over.
 *
 * **Complete and partial are per record, not per entry**, because
 * `unmodelled` is per record: a +1 Longsword finishes everything its entry
 * says and a Sun Blade does not, and those are two answers the entry count
 * cannot hold. The two together are the instances and nothing else.
 *
 * Whether a test drives an item end to end is **not** measured. That is the
 * spells table's `verified`, and it is a hand list precisely because no
 * derivation can say it — the claim belongs to the commit that writes the
 * test. There is no such list for items, so the report says nothing rather
 * than inventing a column.
 */
export function auditMagicItems(): MagicItemCoverage {
  const entries = magicItemEntries();
  const transcribed = new Map<
    string,
    { name: string; category: string; instances: number; partial: number }
  >();

  for (const item of SRD_MAGIC_ITEMS) {
    const entry = entryFor(item);
    const seen = transcribed.get(entry.id) ?? {
      name: entry.name,
      category: entry.category,
      instances: 0,
      partial: 0,
    };
    seen.instances += 1;
    if (!isCompleteItem(item)) seen.partial += 1;
    transcribed.set(entry.id, seen);
  }

  // Code-unit order, which is what `[...names].sort()` in the guard means.
  // `localeCompare` agrees with it for the names the book happens to print
  // today and disagrees about punctuation in general, and a list ordered one
  // way and checked another is a guard that passes by coincidence.
  const covered = [...transcribed.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rows = MAGIC_ITEM_CATEGORIES.map((category) => {
    const mine = covered.filter((one) => one.category === category);
    const instances = mine.reduce((sum, one) => sum + one.instances, 0);
    const partial = mine.reduce((sum, one) => sum + one.partial, 0);
    return {
      category,
      parsed: entries.filter((entry) => entry.category === category).length,
      transcribed: mine.length,
      instances,
      complete: instances - partial,
      partial,
    };
  });

  const instances = SRD_MAGIC_ITEMS.length;
  const partial = SRD_MAGIC_ITEMS.filter((item) => !isCompleteItem(item)).length;

  return {
    parsed: entries.length,
    transcribed: covered.length,
    instances,
    complete: instances - partial,
    partial,
    rows,
    entries: covered,
  };
}

/**
 * What the report found that it cannot honestly print.
 *
 * **This existed as a line of prose and it should always have been a
 * failure.** The old renderer computed the verified spells the catalogue
 * cannot execute and, if it found any, wrote "**Inconsistent:** verified but
 * not executable: …" into `COVERAGE.md` — a report describing its own
 * brokenness and shipping anyway. It really fired, because `npm run coverage`
 * measured a stale `dist` against a `VERIFIED_SPELLS` read from source; the
 * two lists were a day apart and the contradiction was the symptom.
 *
 * Taking the arguments rather than reading the module's own data is what lets
 * the guard drive it in both directions. `coverageInconsistencies` is the real
 * question.
 */
export function inconsistencies(
  verified: readonly string[],
  executable: ReadonlySet<string>,
): readonly string[] {
  return verified
    .filter((id) => !executable.has(id))
    .map(
      (id) =>
        `${id} is listed as verified and the catalogue cannot execute it: either a test drives a spell that is not defined, or the definitions being measured are older than the list`,
    );
}

/** The same question, of the catalogue and the list the report would print. */
export function coverageInconsistencies(): readonly string[] {
  return inconsistencies(VERIFIED_SPELLS, new Set(SPELL_DEFINITIONS.map((d) => d.id)));
}
